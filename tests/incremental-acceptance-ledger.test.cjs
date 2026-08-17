const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  reconcileAcceptedSlices,
  stageAcceptedSlice,
} = require("../electron/incrementalAcceptanceLedger.cjs");

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeCandidate(root, relativePath, body) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
  return digest(Buffer.from(body));
}

function writeReceipt(root, input) {
  const receiptPath = path.join(root, "acceptance-receipt.json");
  const receipt = {
    schema: "test_slice_acceptance_v1",
    task: input.task,
    decision: "accept",
    acceptedAt: input.acceptedAt,
    candidate: input.candidate,
    changedPaths: input.changedPaths,
  };
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(receiptPath, bytes);
  return { receiptPath, receiptSha256: digest(bytes) };
}

function stageRequest(workspace, identity, receipt) {
  return {
    execute: true,
    workspace,
    expectedProjectIdentitySha256: identity.projectIdentitySha256,
    receiptPath: receipt.receiptPath,
    expectedReceiptSha256: receipt.receiptSha256,
  };
}

function reconcile(workspace, identity, storeRoot, signingKey, requiredChangedPaths, currentPostimages) {
  return reconcileAcceptedSlices({ workspace }, {
    storeRoot,
    projectIdentity: identity,
    signingKey,
    scan: {
      workspace,
      scanSha256: "a".repeat(64),
      workingTree: { truncated: false, excludedBodyCount: 0 },
    },
    previousCheckpointId: "checkpoint-before-slices",
    requiredChangedPaths,
    currentPostimages,
  });
}

function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-incremental-acceptance-"));
  const root = fs.realpathSync.native ? fs.realpathSync.native(temporaryRoot) : fs.realpathSync(temporaryRoot);
  const workspace = path.join(root, "workspace");
  const storeRoot = path.join(root, "store");
  const firstCandidate = path.join(root, "slice-001", "candidate");
  const secondCandidate = path.join(root, "slice-002", "candidate");
  fs.mkdirSync(workspace);
  fs.mkdirSync(storeRoot);
  const identity = {
    projectId: "project-1234567890abcdef12345678",
    canonicalRoot: workspace,
    projectIdentitySha256: "1".repeat(64),
  };
  const signingKey = crypto.randomBytes(32);
  const firstA = writeCandidate(firstCandidate, "src/a.ts", "export const a = 1;\n");
  const firstReceipt = writeReceipt(path.dirname(firstCandidate), {
    task: "SLICE-001",
    acceptedAt: "2026-08-17T01:00:00Z",
    candidate: firstCandidate,
    changedPaths: { "src/a.ts": firstA },
  });
  const workspaceBefore = fs.readdirSync(workspace);
  const first = stageAcceptedSlice(stageRequest(workspace, identity, firstReceipt), {
    storeRoot, projectIdentity: identity, signingKey, clock: () => Date.parse("2026-08-17T01:01:00Z"),
  });
  assert.equal(first.status, "staged");
  assert.equal(first.action, "insert");
  assert.deepEqual(
    first.persistence,
    {
      fileSync: "verified",
      directorySync: process.platform === "win32"
        ? { status: "deferred_unverified", reason: "windows_directory_fsync_unavailable" }
        : { status: "verified", reason: null },
    },
  );
  assert.equal(first.authorityGranted, false);
  assert.equal(first.writeAuthority, false);
  assert.deepEqual(fs.readdirSync(workspace), workspaceBefore, "staging must not modify the canonical workspace");

  const duplicate = stageAcceptedSlice(stageRequest(workspace, identity, firstReceipt), {
    storeRoot, projectIdentity: identity, signingKey, clock: () => Date.parse("2026-08-17T01:02:00Z"),
  });
  assert.equal(duplicate.action, "noop");
  assert.equal(duplicate.entryId, first.entryId);

  const firstReady = reconcile(workspace, identity, storeRoot, signingKey, ["src/a.ts"], [
    { relativePath: "src/a.ts", sha256: firstA },
  ]);
  assert.equal(firstReady.status, "ready_for_authority_review");
  assert.equal(firstReady.readyForAuthorityReview, true);
  assert.equal(firstReady.authorityGranted, false);
  assert.match(firstReady.reconciliationProof, /^[a-f0-9]{64}$/);

  const secondA = writeCandidate(secondCandidate, "src/a.ts", "export const a = 2;\n");
  const secondB = writeCandidate(secondCandidate, "src/b.ts", "export const b = 1;\n");
  const secondReceipt = writeReceipt(path.dirname(secondCandidate), {
    task: "SLICE-002",
    acceptedAt: "2026-08-17T02:00:00Z",
    candidate: secondCandidate,
    changedPaths: { "src/a.ts": secondA, "src/b.ts": secondB },
  });
  const second = stageAcceptedSlice(stageRequest(workspace, identity, secondReceipt), {
    storeRoot, projectIdentity: identity, signingKey, clock: () => Date.parse("2026-08-17T02:01:00Z"),
  });
  assert.equal(second.paths.find((item) => item.relativePath === "src/a.ts").supersedesEntryId, first.entryId);
  assert.equal(second.paths.find((item) => item.relativePath === "src/b.ts").supersedesEntryId, null);

  const drifted = reconcile(workspace, identity, storeRoot, signingKey, ["src/a.ts", "src/b.ts"], [
    { relativePath: "src/a.ts", sha256: firstA },
    { relativePath: "src/b.ts", sha256: secondB },
  ]);
  assert.equal(drifted.readyForAuthorityReview, false);
  assert.deepEqual(drifted.blockers, ["incremental_acceptance_paths_superseded_or_drifted"]);
  assert.equal(drifted.driftedPaths[0].acceptedSha256, secondA);

  const secondReady = reconcile(workspace, identity, storeRoot, signingKey, ["src/a.ts", "src/b.ts"], [
    { relativePath: "src/a.ts", sha256: secondA },
    { relativePath: "src/b.ts", sha256: secondB },
  ]);
  assert.equal(secondReady.readyForAuthorityReview, true);
  assert.deepEqual(secondReady.acceptedChangedPaths, ["src/a.ts", "src/b.ts"]);
  assert.equal(secondReady.evidenceDigests.length, 1, "the superseding Slice should own both active path heads");

  const uncovered = reconcile(workspace, identity, storeRoot, signingKey, ["src/a.ts", "src/b.ts", "src/c.ts"], [
    { relativePath: "src/a.ts", sha256: secondA },
    { relativePath: "src/b.ts", sha256: secondB },
    { relativePath: "src/c.ts", sha256: "c".repeat(64) },
  ]);
  assert.equal(uncovered.readyForAuthorityReview, false);
  assert.deepEqual(uncovered.uncoveredPaths, ["src/c.ts"]);
  const deleted = reconcile(workspace, identity, storeRoot, signingKey, ["src/deleted.ts"], []);
  assert.equal(deleted.readyForAuthorityReview, false);
  assert.deepEqual(deleted.missingPaths, ["src/deleted.ts"]);
  assert.ok(deleted.blockers.includes("incremental_acceptance_paths_missing_or_deleted"));

  const wideCandidate = path.join(root, "slice-wide", "candidate");
  const wideChangedPaths = {};
  const widePostimages = [];
  for (let index = 0; index < 30; index += 1) {
    const relativePath = `src/wide-${String(index).padStart(2, "0")}.ts`;
    const sha256 = writeCandidate(wideCandidate, relativePath, `export const wide${index} = ${index};\n`);
    wideChangedPaths[relativePath] = sha256;
    widePostimages.push({ relativePath, sha256 });
  }
  const wideReceipt = writeReceipt(path.dirname(wideCandidate), {
    task: "SLICE-WIDE-030",
    acceptedAt: "2026-08-17T02:30:00Z",
    candidate: wideCandidate,
    changedPaths: wideChangedPaths,
  });
  const wide = stageAcceptedSlice(stageRequest(workspace, identity, wideReceipt), {
    storeRoot, projectIdentity: identity, signingKey, clock: () => Date.parse("2026-08-17T02:31:00Z"),
  });
  assert.equal(wide.pathCount, 30, "incremental Slice staging must not retain the legacy 24-path authority limit");
  const wideReady = reconcile(workspace, identity, storeRoot, signingKey, widePostimages.map((item) => item.relativePath), widePostimages);
  assert.equal(wideReady.readyForAuthorityReview, true);
  assert.equal(wideReady.acceptedChangedPaths.length, 30);

  const mismatchedCandidate = path.join(root, "slice-003", "candidate");
  writeCandidate(mismatchedCandidate, "src/c.ts", "actual content\n");
  const badReceipt = writeReceipt(path.dirname(mismatchedCandidate), {
    task: "SLICE-003",
    acceptedAt: "2026-08-17T03:00:00Z",
    candidate: mismatchedCandidate,
    changedPaths: { "src/c.ts": "d".repeat(64) },
  });
  assert.throws(
    () => stageAcceptedSlice(stageRequest(workspace, identity, badReceipt), { storeRoot, projectIdentity: identity, signingKey }),
    /incremental_acceptance_candidate_digest_mismatch/,
  );

  const ledgerRoot = path.join(storeRoot, "incremental-acceptance-ledger", "v1", identity.projectId);
  const entryPath = path.join(ledgerRoot, fs.readdirSync(ledgerRoot).find((name) => name.startsWith("entry-")));
  const tampered = JSON.parse(fs.readFileSync(entryPath, "utf8"));
  tampered.paths[0].sha256 = "f".repeat(64);
  fs.writeFileSync(entryPath, `${JSON.stringify(tampered)}\n`, "utf8");
  assert.throws(
    () => reconcile(workspace, identity, storeRoot, signingKey, ["src/a.ts"], [{ relativePath: "src/a.ts", sha256: secondA }]),
    /incremental_acceptance_entry_invalid/,
  );

  fs.rmSync(root, { recursive: true, force: true });
  console.log("Incremental accepted-Slice ledger tests passed.");
}

main();
