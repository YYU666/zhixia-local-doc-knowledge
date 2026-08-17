const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LEDGER_SCHEMA = "zhixia.incremental_acceptance_ledger.v1";
const ENTRY_SCHEMA = "zhixia.incremental_acceptance_entry.v1";
const RECONCILIATION_SCHEMA = "zhixia.incremental_acceptance_reconciliation.v1";
const LEDGER_ROOT_PARTS = ["incremental-acceptance-ledger", "v1"];
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 96 * 1024;
const MAX_ENTRIES = 512;
const MAX_PATHS_PER_SLICE = 128;
const MAX_PATHS_PER_RECONCILIATION = 128;
const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".css", ".go", ".h", ".hpp", ".html", ".java", ".js", ".jsx",
  ".json", ".md", ".mjs", ".cjs", ".py", ".rb", ".rs", ".sh", ".sql", ".ts", ".tsx",
  ".txt", ".vue", ".xml", ".yaml", ".yml",
]);
const RAW_SESSION_RE = /(?:\.codex[\\/](?:archived_)?sessions[\\/]|session[_ -]?jsonl|raw[_ -]?session)/i;
const SECRET_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b/i;
const BASE64_RE = /(?:data:[^;]+;base64,|[A-Za-z0-9+/]{240,}={0,2})/;

function canonicalRealPath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeDigestEqual(left, right) {
  return /^[a-f0-9]{64}$/.test(String(left || ""))
    && /^[a-f0-9]{64}$/.test(String(right || ""))
    && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function compact(value, max) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text || text.length > max || RAW_SESSION_RE.test(text) || SECRET_RE.test(text) || BASE64_RE.test(text)) {
    throw new Error("incremental_acceptance_unsafe_text");
  }
  return text;
}

function normalizeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalized || normalized.length > 500 || path.isAbsolute(normalized) || normalized.startsWith("../")
      || normalized.includes("\0") || normalized.split("/").includes("..")
      || !SOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    throw new Error("incremental_acceptance_path_invalid");
  }
  return normalized;
}

function normalizeChangedPaths(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("incremental_acceptance_changed_paths_required");
  }
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > MAX_PATHS_PER_SLICE) {
    throw new Error("incremental_acceptance_changed_paths_bounded");
  }
  const normalized = entries.map(([relativePath, digest]) => ({
    relativePath: normalizeRelativePath(relativePath),
    sha256: String(digest || "").toLowerCase(),
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (normalized.some((item) => !/^[a-f0-9]{64}$/.test(item.sha256))) {
    throw new Error("incremental_acceptance_changed_path_digest_invalid");
  }
  if (new Set(normalized.map((item) => item.relativePath)).size !== normalized.length) {
    throw new Error("incremental_acceptance_changed_path_duplicate");
  }
  return normalized;
}

function containedRelative(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("incremental_acceptance_candidate_escape");
  }
  return relative;
}

function readRegularFileNoFollow(filePath, maxBytes) {
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink() || !before.isFile() || before.size < 1 || before.size > maxBytes) {
    throw new Error("incremental_acceptance_evidence_file_invalid");
  }
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    const after = fs.lstatSync(filePath);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.dev !== after.dev || opened.ino !== after.ino || after.isSymbolicLink()) {
      throw new Error("incremental_acceptance_evidence_file_changed");
    }
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== opened.size) throw new Error("incremental_acceptance_evidence_file_changed");
    return bytes;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function inspectCandidatePath(candidateRoot, relativePath) {
  const canonicalRoot = canonicalRealPath(candidateRoot);
  const rootStats = fs.lstatSync(canonicalRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("incremental_acceptance_candidate_invalid");
  let current = canonicalRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    containedRelative(canonicalRoot, current);
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error("incremental_acceptance_candidate_symlink_rejected");
    const real = canonicalRealPath(current);
    if (real !== current || stats.dev !== rootStats.dev) throw new Error("incremental_acceptance_candidate_escape");
  }
  return current;
}

function validateReceiptBytes(bytes, expectedReceiptSha256) {
  const actualDigest = sha256(bytes);
  if (!safeDigestEqual(actualDigest, String(expectedReceiptSha256 || "").toLowerCase())) {
    throw new Error("incremental_acceptance_receipt_digest_mismatch");
  }
  const text = bytes.toString("utf8");
  if (RAW_SESSION_RE.test(text) || SECRET_RE.test(text) || BASE64_RE.test(text)) {
    throw new Error("incremental_acceptance_receipt_payload_rejected");
  }
  let receipt;
  try { receipt = JSON.parse(text); } catch { throw new Error("incremental_acceptance_receipt_json_invalid"); }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || receipt.decision !== "accept" || !receipt.changedPaths) {
    throw new Error("incremental_acceptance_receipt_not_accepted");
  }
  const acceptedAtMs = Date.parse(receipt.acceptedAt || "");
  if (!Number.isFinite(acceptedAtMs)) throw new Error("incremental_acceptance_receipt_time_invalid");
  const candidateValue = compact(receipt.candidate, 1200);
  if (!path.isAbsolute(candidateValue)) throw new Error("incremental_acceptance_candidate_absolute_path_required");
  return {
    evidenceDigest: actualDigest,
    receiptSchema: compact(receipt.schema || "external.acceptance_receipt", 120),
    taskId: compact(receipt.task, 180),
    acceptedAt: new Date(acceptedAtMs).toISOString(),
    candidateRoot: canonicalRealPath(candidateValue),
    changedPaths: normalizeChangedPaths(receipt.changedPaths),
  };
}

function validateCandidatePostimages(receipt) {
  for (const item of receipt.changedPaths) {
    const candidatePath = inspectCandidatePath(receipt.candidateRoot, item.relativePath);
    const bytes = readRegularFileNoFollow(candidatePath, 1024 * 1024);
    if (!safeDigestEqual(sha256(bytes), item.sha256)) {
      throw new Error(`incremental_acceptance_candidate_digest_mismatch:${item.relativePath}`);
    }
  }
}

function ledgerRoot(storeRoot, projectId) {
  if (!/^project-[a-f0-9]{24}$/.test(String(projectId || ""))) throw new Error("incremental_acceptance_project_invalid");
  return path.join(path.resolve(storeRoot), ...LEDGER_ROOT_PARTS, projectId);
}

function ensureLedgerRoot(storeRoot, projectId) {
  const root = path.resolve(storeRoot);
  if (!fs.existsSync(root)) throw new Error("incremental_acceptance_store_unavailable");
  const rootStats = fs.lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || canonicalRealPath(root) !== root) {
    throw new Error("incremental_acceptance_store_unsafe");
  }
  let current = root;
  for (const segment of [...LEDGER_ROOT_PARTS, projectId]) {
    current = path.join(current, segment);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
    const stats = fs.lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink() || canonicalRealPath(current) !== current) {
      throw new Error("incremental_acceptance_store_unsafe");
    }
  }
  return current;
}

function entryProof(signingKey, core) {
  if (!Buffer.isBuffer(signingKey) || signingKey.length < 32) throw new Error("incremental_acceptance_signing_key_required");
  return crypto.createHmac("sha256", signingKey).update(`${LEDGER_SCHEMA}\0${stable(core)}`).digest("hex");
}

function readEntries(storeRoot, projectId, signingKey) {
  const root = ledgerRoot(storeRoot, projectId);
  if (!fs.existsSync(root)) return [];
  const rootStats = fs.lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || canonicalRealPath(root) !== root) {
    throw new Error("incremental_acceptance_store_unsafe");
  }
  const names = fs.readdirSync(root).filter((name) => /^entry-[a-f0-9]{64}\.json$/.test(name)).sort();
  if (names.length > MAX_ENTRIES) throw new Error("incremental_acceptance_ledger_capacity_reached");
  return names.map((name) => {
    const bytes = readRegularFileNoFollow(path.join(root, name), MAX_ENTRY_BYTES);
    let entry;
    try { entry = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("incremental_acceptance_entry_invalid"); }
    if (entry?.schemaVersion !== ENTRY_SCHEMA || entry.projectId !== projectId
        || entry.entryId !== name.slice(0, -5) || !Array.isArray(entry.paths)
        || stable(entry.paths) !== stable(entry.core?.paths)
        || !safeDigestEqual(entry.proof, entryProof(signingKey, entry.core))) {
      throw new Error("incremental_acceptance_entry_invalid");
    }
    const expectedId = `entry-${sha256(stable(entry.core))}`;
    if (entry.entryId !== expectedId) throw new Error("incremental_acceptance_entry_invalid");
    return entry;
  });
}

function pathHeads(entries) {
  const heads = new Map();
  for (const entry of entries.sort((left, right) => left.core.sequence - right.core.sequence || left.entryId.localeCompare(right.entryId))) {
    for (const item of entry.paths) heads.set(item.relativePath, { ...item, entryId: entry.entryId, evidenceDigest: entry.core.evidenceDigest });
  }
  return heads;
}

function publishEntry(root, entry, platform = process.platform) {
  const finalPath = path.join(root, `${entry.entryId}.json`);
  const bytes = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
  if (bytes.length > MAX_ENTRY_BYTES) throw new Error("incremental_acceptance_entry_too_large");
  if (fs.existsSync(finalPath)) {
    if (!readRegularFileNoFollow(finalPath, MAX_ENTRY_BYTES).equals(bytes)) throw new Error("incremental_acceptance_entry_conflict");
    return {
      action: "noop",
      fileSync: "existing_entry_verified",
      directorySync: { status: "not_applicable", reason: "existing_entry_verified" },
    };
  }
  const temporary = path.join(root, `.${entry.entryId}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.linkSync(temporary, finalPath);
    fs.unlinkSync(temporary);
    let directorySync;
    if (platform === "win32") {
      directorySync = { status: "deferred_unverified", reason: "windows_directory_fsync_unavailable" };
    } else {
      const dirFd = fs.openSync(root, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      directorySync = { status: "verified", reason: null };
    }
    return { action: "insert", fileSync: "verified", directorySync };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function stageAcceptedSlice(request = {}, options = {}) {
  if (request.execute !== true) throw new Error("incremental_acceptance_execute_true_required");
  const workspace = canonicalRealPath(path.resolve(request.workspace || ""));
  const projectIdentity = options.projectIdentity;
  if (!projectIdentity?.projectId || projectIdentity.canonicalRoot !== workspace
      || request.expectedProjectIdentitySha256 !== projectIdentity.projectIdentitySha256) {
    throw new Error("incremental_acceptance_project_identity_mismatch");
  }
  const receiptPath = path.resolve(compact(request.receiptPath, 1200));
  if (path.basename(receiptPath) !== "acceptance-receipt.json") throw new Error("incremental_acceptance_receipt_name_invalid");
  if (canonicalRealPath(receiptPath) !== receiptPath) throw new Error("incremental_acceptance_receipt_path_alias_rejected");
  const receipt = validateReceiptBytes(readRegularFileNoFollow(receiptPath, MAX_RECEIPT_BYTES), request.expectedReceiptSha256);
  validateCandidatePostimages(receipt);
  const root = ensureLedgerRoot(options.storeRoot, projectIdentity.projectId);
  const lockPath = path.join(root, ".stage.lock");
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, "wx", 0o600);
    const entries = readEntries(options.storeRoot, projectIdentity.projectId, options.signingKey);
    if (entries.length >= MAX_ENTRIES) throw new Error("incremental_acceptance_ledger_capacity_reached");
    const existing = entries.find((entry) => entry.core.evidenceDigest === receipt.evidenceDigest);
    if (existing) {
      if (existing.core.taskId !== receipt.taskId
          || stable(existing.paths.map(({ relativePath, sha256 }) => ({ relativePath, sha256 }))) !== stable(receipt.changedPaths)) {
        throw new Error("incremental_acceptance_evidence_digest_conflict");
      }
      return {
        schemaVersion: LEDGER_SCHEMA,
        operation: "stage_accepted_slice",
        status: "staged",
        action: "noop",
        workspace,
        projectIdentity,
        entryId: existing.entryId,
        evidenceDigest: receipt.evidenceDigest,
        taskId: receipt.taskId,
        acceptedAt: receipt.acceptedAt,
        pathCount: existing.paths.length,
        paths: existing.paths,
        authorityGranted: false,
        writeAuthority: false,
        nextAction: "reconcile_accepted_slices",
        safety: { rawSessionBodyRead: false, credentialRead: false, candidateBytesPersisted: false, exactScanAuthorityChanged: false },
      };
    }
    const priorHeads = pathHeads(entries);
    const sequence = entries.reduce((maximum, entry) => Math.max(maximum, Number(entry.core.sequence) || 0), 0) + 1;
    const recordedAt = new Date(typeof options.clock === "function" ? options.clock() : Date.now()).toISOString();
    const paths = receipt.changedPaths.map((item) => ({
      ...item,
      supersedesEntryId: priorHeads.get(item.relativePath)?.entryId || null,
    }));
    const core = {
      schemaVersion: ENTRY_SCHEMA,
      projectId: projectIdentity.projectId,
      projectIdentitySha256: projectIdentity.projectIdentitySha256,
      workspace,
      sequence,
      evidenceDigest: receipt.evidenceDigest,
      receiptSchema: receipt.receiptSchema,
      taskId: receipt.taskId,
      acceptedAt: receipt.acceptedAt,
      recordedAt,
      candidateDigest: sha256(receipt.candidateRoot),
      paths,
      authority: "staged_non_authoritative",
    };
    const entryId = `entry-${sha256(stable(core))}`;
    const entry = { schemaVersion: ENTRY_SCHEMA, projectId: projectIdentity.projectId, entryId, core, paths, proof: entryProof(options.signingKey, core) };
    const publication = publishEntry(root, entry, options.platform);
    return {
      schemaVersion: LEDGER_SCHEMA,
      operation: "stage_accepted_slice",
      status: "staged",
      action: publication.action,
      persistence: { fileSync: publication.fileSync, directorySync: publication.directorySync },
      workspace,
      projectIdentity,
      entryId,
      evidenceDigest: receipt.evidenceDigest,
      taskId: receipt.taskId,
      acceptedAt: receipt.acceptedAt,
      pathCount: paths.length,
      paths,
      authorityGranted: false,
      writeAuthority: false,
      nextAction: "reconcile_accepted_slices",
      safety: { rawSessionBodyRead: false, credentialRead: false, candidateBytesPersisted: false, exactScanAuthorityChanged: false },
    };
  } finally {
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    }
  }
}

function reconcileAcceptedSlices(request = {}, options = {}) {
  const workspace = canonicalRealPath(path.resolve(request.workspace || ""));
  const projectIdentity = options.projectIdentity;
  const scan = options.scan;
  if (!projectIdentity?.projectId || projectIdentity.canonicalRoot !== workspace || scan?.workspace !== workspace) {
    throw new Error("incremental_acceptance_project_identity_mismatch");
  }
  const entries = readEntries(options.storeRoot, projectIdentity.projectId, options.signingKey);
  const heads = pathHeads(entries);
  const requiredPaths = [...new Set((options.requiredChangedPaths || []).map(normalizeRelativePath))].sort();
  if (requiredPaths.length > MAX_PATHS_PER_RECONCILIATION) throw new Error("incremental_acceptance_reconciliation_capacity_reached");
  const currentHashes = new Map((options.currentPostimages || []).map((item) => [normalizeRelativePath(item.relativePath), item.sha256]));
  const matchedPaths = [];
  const uncoveredPaths = [];
  const driftedPaths = [];
  const missingPaths = [];
  for (const relativePath of requiredPaths) {
    const expected = heads.get(relativePath);
    const current = currentHashes.get(relativePath);
    if (!current) missingPaths.push(relativePath);
    else if (!expected) uncoveredPaths.push(relativePath);
    else if (!safeDigestEqual(current, expected.sha256)) driftedPaths.push({ relativePath, acceptedSha256: expected.sha256, currentSha256: current });
    else matchedPaths.push({ relativePath, sha256: current, entryId: expected.entryId, evidenceDigest: expected.evidenceDigest });
  }
  const blockers = [
    ...(entries.length === 0 ? ["incremental_acceptance_ledger_empty"] : []),
    ...(requiredPaths.length === 0 ? ["incremental_acceptance_no_workspace_delta"] : []),
    ...(scan.workingTree?.truncated ? ["incremental_acceptance_worktree_truncated"] : []),
    ...(Number(scan.workingTree?.excludedBodyCount || 0) > 0 ? ["incremental_acceptance_unverifiable_worktree_paths"] : []),
    ...(Number(options.unverifiableDeltaCount || 0) > 0 ? ["incremental_acceptance_unverifiable_committed_paths"] : []),
    ...(uncoveredPaths.length ? ["incremental_acceptance_paths_uncovered"] : []),
    ...(driftedPaths.length ? ["incremental_acceptance_paths_superseded_or_drifted"] : []),
    ...(missingPaths.length ? ["incremental_acceptance_paths_missing_or_deleted"] : []),
  ];
  const readyForAuthorityReview = blockers.length === 0 && matchedPaths.length === requiredPaths.length;
  const core = {
    schemaVersion: RECONCILIATION_SCHEMA,
    projectId: projectIdentity.projectId,
    projectIdentitySha256: projectIdentity.projectIdentitySha256,
    workspace,
    scanSha256: scan.scanSha256,
    previousCheckpointId: options.previousCheckpointId || null,
    acceptedChangedPaths: matchedPaths.map((item) => item.relativePath),
    acceptedPathDigest: sha256(stable(matchedPaths.map((item) => ({ relativePath: item.relativePath, sha256: item.sha256 })))),
    evidenceDigests: [...new Set(matchedPaths.map((item) => item.evidenceDigest))].sort(),
    readyForAuthorityReview,
  };
  return {
    schemaVersion: RECONCILIATION_SCHEMA,
    operation: "reconcile_accepted_slices",
    status: readyForAuthorityReview ? "ready_for_authority_review" : "not_ready",
    current: false,
    recoveryReady: false,
    authorityGranted: false,
    writeAuthority: false,
    workspace,
    projectIdentity,
    scanSha256: scan.scanSha256,
    previousCheckpointId: options.previousCheckpointId || null,
    stagedEntryCount: entries.length,
    activePathCount: heads.size,
    requiredPathCount: requiredPaths.length,
    matchedPaths,
    uncoveredPaths,
    driftedPaths,
    missingPaths,
    blockers,
    acceptedChangedPaths: core.acceptedChangedPaths,
    acceptedPathDigest: core.acceptedPathDigest,
    evidenceDigests: core.evidenceDigests,
    reconciliationDigest: sha256(stable(core)),
    reconciliationProof: entryProof(options.signingKey, core),
    readyForAuthorityReview,
    nextAction: readyForAuthorityReview ? "app_owned_authority_review_required" : "stage_or_supersede_missing_slices",
    safety: { rawSessionBodyRead: false, credentialRead: false, lifecycleWrites: false, checkpointWrites: false, refreshExecuted: false },
  };
}

module.exports = {
  ENTRY_SCHEMA,
  LEDGER_SCHEMA,
  RECONCILIATION_SCHEMA,
  MAX_PATHS_PER_RECONCILIATION,
  reconcileAcceptedSlices,
  stageAcceptedSlice,
};
