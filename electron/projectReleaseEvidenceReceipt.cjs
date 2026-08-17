const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  deriveProjectIdentityEnvelope,
} = require("../codex-skills/zhixia-local-docs/scripts/project-identity.cjs");

const RELEASE_EVIDENCE_RECEIPT_SCHEMA = "zhixia.release_evidence_receipt.v1";
const RELEASE_EVIDENCE_LOAD_SCHEMA = "zhixia.release_evidence_load.v1";
const RELEASE_EVIDENCE_RELATIVE_PATH = "docs/RELEASE_EVIDENCE_RECEIPT.json";
const REQUIRED_RELEASE_GATE_IDS = Object.freeze([
  "full_tests",
  "build",
  "electron_security",
  "electron_release",
  "artifact_manifest",
]);
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const RELEASE_ISSUER_ROLE = "independent_release_qa";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("release_evidence_json_invalid");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function receiptIdFor(receipt) {
  const unsigned = { ...receipt };
  delete unsigned.receiptId;
  return `release-evidence-${sha256(Buffer.from(canonicalJson(unsigned), "utf8")).slice(0, 32)}`;
}

function runGitBytes(workspace, args) {
  try {
    return execFileSync("git", ["-C", workspace, ...args], {
      encoding: null,
      maxBuffer: MAX_SOURCE_BYTES + MAX_RECEIPT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

function containedRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const clean = path.posix.normalize(normalized);
  if (clean === "." || clean === ".." || clean.startsWith("../") || clean.includes("\0")) return null;
  return clean;
}

function readTrustedHeadFile(workspace, relativePath, maxBytes) {
  const clean = containedRelativePath(relativePath);
  if (!clean) return { ok: false, reason: "release_source_path_invalid" };
  const candidate = path.join(workspace, ...clean.split("/"));
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    return { ok: false, reason: "release_source_missing" };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, reason: "release_source_file_type_invalid" };
  if (stat.size > maxBytes) return { ok: false, reason: "release_source_too_large" };
  const headBytes = runGitBytes(workspace, ["show", `HEAD:${clean}`]);
  if (!headBytes) return { ok: false, reason: "release_source_not_tracked_at_head" };
  const workingBytes = fs.readFileSync(candidate);
  if (!workingBytes.equals(headBytes)) return { ok: false, reason: "release_source_differs_from_head" };
  return { ok: true, relativePath: clean, sha256: sha256(workingBytes), bytes: workingBytes.length };
}

function invalidEnvelope(project, reasonCodes) {
  return Object.freeze({
    schemaVersion: RELEASE_EVIDENCE_LOAD_SCHEMA,
    status: "invalid",
    readOnly: true,
    project,
    receipt: null,
    verification: Object.freeze({ verified: false, reasonCodes: [...new Set(reasonCodes)] }),
  });
}

function loadProjectReleaseEvidence(options = {}) {
  const nowMs = Date.parse(String(options.now || new Date().toISOString()));
  if (!Number.isFinite(nowMs)) throw new Error("release_evidence_time_invalid");
  const identity = deriveProjectIdentityEnvelope(options.projectPath);
  const project = Object.freeze({
    projectId: identity.projectId,
    canonicalRepoId: identity.canonicalRepoId,
    projectIdentitySha256: identity.projectIdentitySha256,
    gitHead: identity.baselineHead,
  });
  if (!identity.baselineHead) return invalidEnvelope(project, ["release_evidence_git_head_required"]);

  const receiptFile = readTrustedHeadFile(identity.worktreeRoot, RELEASE_EVIDENCE_RELATIVE_PATH, MAX_RECEIPT_BYTES);
  if (!receiptFile.ok) {
    const status = receiptFile.reason === "release_source_missing" ? "missing" : "invalid";
    return Object.freeze({ ...invalidEnvelope(project, [receiptFile.reason]), status });
  }
  let receipt;
  try {
    receipt = JSON.parse(runGitBytes(identity.worktreeRoot, ["show", `HEAD:${RELEASE_EVIDENCE_RELATIVE_PATH}`]).toString("utf8"));
  } catch {
    return invalidEnvelope(project, ["release_evidence_receipt_json_invalid"]);
  }

  const reasons = [];
  if (receipt?.schemaVersion !== RELEASE_EVIDENCE_RECEIPT_SCHEMA) reasons.push("release_evidence_receipt_schema_invalid");
  if (receipt?.decision !== "release_ready") reasons.push("release_evidence_decision_invalid");
  if (receipt?.receiptId !== receiptIdFor(receipt || {})) reasons.push("release_evidence_receipt_id_invalid");
  if (receipt?.projectIdentity?.projectId !== identity.projectId
    || receipt?.projectIdentity?.canonicalRepoId !== identity.canonicalRepoId
    || receipt?.projectIdentity?.projectIdentitySha256 !== identity.projectIdentitySha256) {
    reasons.push("release_evidence_project_identity_mismatch");
  }
  if (receipt?.issuer?.role !== RELEASE_ISSUER_ROLE || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(String(receipt?.issuer?.id || ""))) {
    reasons.push("release_evidence_issuer_invalid");
  }
  const issuerSource = readTrustedHeadFile(identity.worktreeRoot, receipt?.issuer?.sourceRef?.path, MAX_SOURCE_BYTES);
  if (!issuerSource.ok || !/^[a-f0-9]{64}$/.test(String(receipt?.issuer?.sourceRef?.sha256 || ""))
    || receipt.issuer.sourceRef.sha256 !== issuerSource.sha256) {
    reasons.push("release_evidence_issuer_source_invalid");
  }
  const issuedAtMs = Date.parse(String(receipt?.issuedAt || ""));
  const expiresAtMs = Date.parse(String(receipt?.expiresAt || ""));
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)
    || issuedAtMs > nowMs || expiresAtMs <= nowMs || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > MAX_RECEIPT_LIFETIME_MS) {
    reasons.push("release_evidence_time_or_expiry_invalid");
  }

  const gates = Array.isArray(receipt?.gates) ? receipt.gates : [];
  const gateIds = gates.map((gate) => gate?.id);
  if (gates.length !== REQUIRED_RELEASE_GATE_IDS.length
    || new Set(gateIds).size !== gateIds.length
    || REQUIRED_RELEASE_GATE_IDS.some((gateId) => !gateIds.includes(gateId))) {
    reasons.push("release_evidence_required_gates_incomplete");
  }
  const verifiedRefs = [];
  for (const gate of gates) {
    if (gate?.status !== "pass") reasons.push("release_evidence_gate_not_pass");
    if (!Array.isArray(gate?.sourceRefs) || gate.sourceRefs.length === 0 || gate.sourceRefs.length > 12) {
      reasons.push("release_evidence_gate_source_refs_invalid");
      continue;
    }
    for (const ref of gate.sourceRefs) {
      const source = readTrustedHeadFile(identity.worktreeRoot, ref?.path, MAX_SOURCE_BYTES);
      if (!source.ok) {
        reasons.push(source.reason);
        continue;
      }
      if (!/^[a-f0-9]{64}$/.test(String(ref?.sha256 || "")) || ref.sha256 !== source.sha256) {
        reasons.push("release_evidence_source_hash_mismatch");
        continue;
      }
      verifiedRefs.push(Object.freeze({ gateId: gate.id, path: source.relativePath, sha256: source.sha256 }));
    }
  }
  if (reasons.length > 0) return invalidEnvelope(project, reasons);

  return Object.freeze({
    schemaVersion: RELEASE_EVIDENCE_LOAD_SCHEMA,
    status: "verified",
    readOnly: true,
    project,
    receipt: Object.freeze({
      schemaVersion: receipt.schemaVersion,
      receiptId: receipt.receiptId,
      decision: receipt.decision,
      projectIdentity: Object.freeze({ ...receipt.projectIdentity }),
      issuer: Object.freeze({
        id: receipt.issuer.id,
        role: receipt.issuer.role,
        sourceRef: Object.freeze({ path: issuerSource.relativePath, sha256: issuerSource.sha256 }),
      }),
      issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt,
      gates: Object.freeze(gates.map((gate) => Object.freeze({
        id: gate.id,
        status: gate.status,
        sourceRefs: Object.freeze(gate.sourceRefs.map((ref) => Object.freeze({ path: ref.path, sha256: ref.sha256 }))),
      }))),
    }),
    verification: Object.freeze({
      verified: true,
      reasonCodes: [],
      receiptPath: RELEASE_EVIDENCE_RELATIVE_PATH,
      receiptSha256: receiptFile.sha256,
      gitHead: identity.baselineHead,
      trackedAtHead: true,
      headBytesMatch: true,
      sourceRefsVerified: true,
      verifiedSourceRefs: Object.freeze(verifiedRefs),
    }),
  });
}

module.exports = {
  RELEASE_EVIDENCE_LOAD_SCHEMA,
  RELEASE_EVIDENCE_RECEIPT_SCHEMA,
  RELEASE_EVIDENCE_RELATIVE_PATH,
  REQUIRED_RELEASE_GATE_IDS,
  loadProjectReleaseEvidence,
  receiptIdFor,
};
