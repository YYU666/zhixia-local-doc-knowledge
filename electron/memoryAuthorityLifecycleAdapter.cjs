const crypto = require("node:crypto");
const { execute } = require("./memoryRuntimeCli.cjs");

const AUTHORITY_REVIEW_SCHEMA = "zhixia.authority_lifecycle_review.v1";

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

function boundedPaths(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 24) throw new Error("authority_review_changed_paths_required");
  const normalized = values.map((value) => String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, ""));
  if (normalized.some((value) => !value || value.startsWith("../") || value.startsWith("/") || value.includes("\0"))) {
    throw new Error("authority_review_changed_path_invalid");
  }
  return [...new Set(normalized)].sort();
}

function reviewBinding(scan, verify, paths) {
  return {
    schemaVersion: AUTHORITY_REVIEW_SCHEMA,
    workspace: scan.workspace,
    projectId: scan.projectIdentity?.projectId || null,
    projectIdentitySha256: scan.projectIdentity?.projectIdentitySha256 || null,
    scanSha256: scan.scanSha256,
    previousCheckpointId: verify.scanBinding?.authorizedCheckpointId || null,
    acceptedChangedPaths: paths,
  };
}

function assertReviewable(scan, verify) {
  if (!scan?.scanSha256 || !scan?.projectIdentity?.projectIdentitySha256) throw new Error("authority_review_exact_scan_required");
  if (verify?.memoryMode !== "app_owned_memory_core" || verify?.authorityVerification !== "app_owned_verified") {
    throw new Error("authority_review_app_owned_verification_required");
  }
  if (!verify.scanBinding?.authorizedCheckpointId) throw new Error("authority_review_checkpoint_required");
}

function assertSourceRefs(scan, paths, sourceRefs) {
  if (!Array.isArray(sourceRefs)) throw new Error("authority_review_source_refs_required");
  const hashes = new Map(scan.files.map((file) => [file.relativePath, file.sha256]));
  for (const entry of scan.workingTree?.entries || []) {
    if (entry.state === "text_postimage" && entry.sha256) hashes.set(entry.relativePath, entry.sha256);
  }
  const refs = new Map(sourceRefs.map((ref) => [String(ref?.path || "").replace(/^\.\//, ""), String(ref?.sha256 || ref?.hash || "").toLowerCase()]));
  for (const relativePath of paths) {
    if (!/^[a-f0-9]{64}$/.test(refs.get(relativePath) || "") || refs.get(relativePath) !== hashes.get(relativePath)) {
      throw new Error("authority_review_source_ref_mismatch");
    }
  }
}

function authorityLifecycleReview(request = {}, options = {}) {
  const run = options.executeRuntime || execute;
  const paths = boundedPaths(request.acceptedChangedPaths);
  const common = {
    workspace: request.workspace,
    storeRoot: request.storeRoot,
    now: request.now,
  };
  const scan = run({ operation: "scan", ...common, relativePaths: paths });
  const verify = run({ operation: "verify", ...common });
  assertReviewable(scan, verify);
  const binding = reviewBinding(scan, verify, paths);
  const reviewToken = sha256(binding);
  if (request.execute !== true) {
    return {
      schemaVersion: AUTHORITY_REVIEW_SCHEMA,
      operation: "review",
      status: "review_required",
      binding,
      reviewToken,
      files: scan.files.filter((file) => paths.includes(file.relativePath)).map((file) => ({ relativePath: file.relativePath, sha256: file.sha256, sizeBytes: file.sizeBytes })),
      authority: { writable: false, receiptIssued: false, refreshed: false },
    };
  }
  if (request.userConfirmed !== true || request.decision !== "accept") throw new Error("authority_review_explicit_acceptance_required");
  if (request.reviewToken !== reviewToken) throw new Error("authority_review_token_mismatch");
  if (request.expectedProjectIdentitySha256 !== binding.projectIdentitySha256 || request.expectedScanSha256 !== binding.scanSha256
      || request.previousCheckpointId !== binding.previousCheckpointId) throw new Error("authority_review_binding_mismatch");
  assertSourceRefs(scan, paths, request.sourceRefs);
  if (typeof options.issueAcceptedEvidenceReceipt !== "function") {
    throw new Error("authority_review_app_owned_receipt_issuer_required");
  }
  const receipt = options.issueAcceptedEvidenceReceipt({
    ...common,
    execute: true,
    expectedProjectIdentitySha256: binding.projectIdentitySha256,
    expectedScanSha256: binding.scanSha256,
    previousCheckpointId: binding.previousCheckpointId,
    acceptedChangedPaths: paths,
    decision: "accept",
    issuer: request.issuer,
    lane: request.lane,
    expiresAt: request.expiresAt,
  });
  const refreshed = run({
    operation: "refresh_binding",
    ...common,
    execute: true,
    expectedProjectIdentitySha256: binding.projectIdentitySha256,
    expectedScanSha256: binding.scanSha256,
    previousCheckpointId: binding.previousCheckpointId,
    acceptedChangedPaths: paths,
    acceptedEvidenceReceipt: receipt.receiptId,
    sourceRefs: request.sourceRefs,
    lane: request.lane,
    title: request.title,
    summary: request.summary,
  });
  const reverified = run({ operation: "verify", ...common, relativePaths: paths });
  const ready = reverified.memoryMode === "app_owned_memory_core"
    && reverified.authorityVerification === "app_owned_verified"
    && reverified.current === true
    && reverified.recoveryReady === true
    && reverified.scanBinding?.matched === true
    && reverified.scanBinding?.authorizedCheckpointId === refreshed.authorizedCheckpointId
    && reverified.scanBinding?.currentScanSha256 === refreshed.scanSha256
    && reverified.contextGenerationId === refreshed.contextGenerationId;
  if (!ready) throw new Error("authority_review_reverify_not_ready");
  return {
    schemaVersion: AUTHORITY_REVIEW_SCHEMA,
    operation: "accept_refresh_reverify",
    status: "verified",
    binding,
    receipt: { receiptId: receipt.receiptId, issuer: receipt.issuer, issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt },
    refresh: {
      checkpointId: refreshed.authorizedCheckpointId || null,
      scanSha256: refreshed.scanSha256 || null,
      contextGenerationId: refreshed.contextGenerationId || null,
    },
    verification: {
      memoryMode: reverified.memoryMode,
      authorityVerification: reverified.authorityVerification,
      current: reverified.current,
      recoveryReady: reverified.recoveryReady,
      matched: reverified.scanBinding.matched,
      checkpointId: reverified.scanBinding.authorizedCheckpointId,
      scanSha256: reverified.scanBinding.currentScanSha256,
      contextGenerationId: reverified.contextGenerationId,
    },
  };
}

module.exports = { AUTHORITY_REVIEW_SCHEMA, authorityLifecycleReview };
