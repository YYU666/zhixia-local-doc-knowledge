const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { deriveProjectIdentityEnvelope } = require("../codex-skills/zhixia-local-docs/scripts/project-identity.cjs");
const {
  RELEASE_EVIDENCE_RECEIPT_SCHEMA,
  REQUIRED_RELEASE_GATE_IDS,
  loadProjectReleaseEvidence,
  receiptIdFor,
} = require("../electron/projectReleaseEvidenceReceipt.cjs");

const NOW = "2026-08-13T01:00:00.000Z";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function commitAll(root, message) {
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Zhixia Test", "-c", "user.email=zhixia@example.invalid", "commit", "-m", message]);
}

function buildReceipt(root, overrides = {}) {
  const identity = deriveProjectIdentityEnvelope(root);
  const evidencePath = path.join(root, "docs", "release-qa-evidence.txt");
  const sourceRef = { path: "docs/release-qa-evidence.txt", sha256: fileHash(evidencePath) };
  const receipt = {
    schemaVersion: RELEASE_EVIDENCE_RECEIPT_SCHEMA,
    decision: "release_ready",
    projectIdentity: {
      projectId: identity.projectId,
      canonicalRepoId: identity.canonicalRepoId,
      projectIdentitySha256: identity.projectIdentitySha256,
    },
    issuer: { id: "neutral-qa-lane", role: "independent_release_qa", sourceRef },
    issuedAt: "2026-08-13T00:30:00.000Z",
    expiresAt: "2026-08-13T02:30:00.000Z",
    gates: REQUIRED_RELEASE_GATE_IDS.map((id) => ({ id, status: "pass", sourceRefs: [sourceRef] })),
    ...overrides,
  };
  receipt.receiptId = receiptIdFor(receipt);
  return receipt;
}

function writeReceipt(root, receipt) {
  fs.writeFileSync(path.join(root, "docs", "RELEASE_EVIDENCE_RECEIPT.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-release-evidence-"));
  git(root, ["init"]);
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "release-qa-evidence.txt"), "Focused, full, build, Electron and artifact gates passed.\n");
  commitAll(root, "evidence");
  writeReceipt(root, buildReceipt(root));
  commitAll(root, "release receipt");
  return root;
}

function expectInvalid(root, reason) {
  const result = loadProjectReleaseEvidence({ projectPath: root, now: NOW });
  assert.equal(result.verification.verified, false);
  assert.ok(result.verification.reasonCodes.includes(reason), JSON.stringify(result));
}

function main() {
  const roots = [];
  try {
    const validRoot = fixture(); roots.push(validRoot);
    const valid = loadProjectReleaseEvidence({ projectPath: validRoot, now: NOW });
    assert.equal(valid.status, "verified");
    assert.equal(valid.readOnly, true);
    assert.equal(valid.verification.verified, true);
    assert.equal(valid.verification.trackedAtHead, true);
    assert.equal(valid.verification.headBytesMatch, true);
    assert.equal(valid.verification.sourceRefsVerified, true);
    assert.equal(valid.receipt.gates.length, REQUIRED_RELEASE_GATE_IDS.length);
    assert.equal(git(validRoot, ["status", "--porcelain"]), "", "read-only load must not mutate the repository");

    const authorityRoot = fixture(); roots.push(authorityRoot);
    const authorityReceipt = buildReceipt(authorityRoot, { schemaVersion: "zhixia.accepted_evidence_receipt.v1" });
    writeReceipt(authorityRoot, authorityReceipt); commitAll(authorityRoot, "ordinary authority receipt must fail");
    expectInvalid(authorityRoot, "release_evidence_receipt_schema_invalid");

    const dirtyRoot = fixture(); roots.push(dirtyRoot);
    fs.appendFileSync(path.join(dirtyRoot, "docs", "RELEASE_EVIDENCE_RECEIPT.json"), " ");
    expectInvalid(dirtyRoot, "release_source_differs_from_head");

    const untrackedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-release-evidence-untracked-")); roots.push(untrackedRoot);
    git(untrackedRoot, ["init"]); fs.mkdirSync(path.join(untrackedRoot, "docs"));
    fs.writeFileSync(path.join(untrackedRoot, "README.md"), "fixture\n"); commitAll(untrackedRoot, "base");
    fs.writeFileSync(path.join(untrackedRoot, "docs", "RELEASE_EVIDENCE_RECEIPT.json"), "{}\n");
    expectInvalid(untrackedRoot, "release_source_not_tracked_at_head");

    const expiredRoot = fixture(); roots.push(expiredRoot);
    writeReceipt(expiredRoot, buildReceipt(expiredRoot, { issuedAt: "2026-08-12T00:00:00.000Z", expiresAt: "2026-08-12T01:00:00.000Z" }));
    commitAll(expiredRoot, "expired receipt"); expectInvalid(expiredRoot, "release_evidence_time_or_expiry_invalid");

    const identityRoot = fixture(); roots.push(identityRoot);
    const wrongIdentity = buildReceipt(identityRoot);
    wrongIdentity.projectIdentity = { ...wrongIdentity.projectIdentity, projectId: "project-000000000000000000000000" };
    wrongIdentity.receiptId = receiptIdFor(wrongIdentity);
    writeReceipt(identityRoot, wrongIdentity); commitAll(identityRoot, "wrong identity");
    expectInvalid(identityRoot, "release_evidence_project_identity_mismatch");

    const gateRoot = fixture(); roots.push(gateRoot);
    const incomplete = buildReceipt(gateRoot); incomplete.gates = incomplete.gates.slice(1); incomplete.receiptId = receiptIdFor(incomplete);
    writeReceipt(gateRoot, incomplete); commitAll(gateRoot, "missing gate");
    expectInvalid(gateRoot, "release_evidence_required_gates_incomplete");

    const hashRoot = fixture(); roots.push(hashRoot);
    const wrongHash = buildReceipt(hashRoot); wrongHash.gates[0].sourceRefs[0].sha256 = "0".repeat(64); wrongHash.receiptId = receiptIdFor(wrongHash);
    writeReceipt(hashRoot, wrongHash); commitAll(hashRoot, "wrong hash");
    expectInvalid(hashRoot, "release_evidence_source_hash_mismatch");

    const escapeRoot = fixture(); roots.push(escapeRoot);
    const escape = buildReceipt(escapeRoot); escape.gates[0].sourceRefs[0] = { path: "../outside.txt", sha256: "0".repeat(64) }; escape.receiptId = receiptIdFor(escape);
    writeReceipt(escapeRoot, escape); commitAll(escapeRoot, "escape ref");
    expectInvalid(escapeRoot, "release_source_path_invalid");

    console.log("Project release evidence receipt tests passed.");
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
