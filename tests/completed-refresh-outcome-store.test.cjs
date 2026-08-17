const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildQueryBasis,
  buildRefreshKey,
  publishCompletedRefreshOutcome,
  queryCompletedRefreshOutcome,
} = require("../electron/completedRefreshOutcomeStore.cjs");

function snapshot(root) {
  if (!fs.existsSync(root)) return [];
  const entries = [];
  const visit = (target, relative) => {
    const stats = fs.lstatSync(target);
    entries.push({ path: relative, mode: stats.mode & 0o777, size: stats.size, sha256: stats.isFile() ? crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") : null });
    if (stats.isDirectory()) for (const name of fs.readdirSync(target).sort()) visit(path.join(target, name), path.join(relative, name));
  };
  visit(root, ".");
  return entries;
}

function fixture(root) {
  const workspace = path.join(root, "workspace");
  const storeRoot = path.join(root, "store");
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(storeRoot, "private"), { recursive: true, mode: 0o700 });
  const authorityKey = crypto.randomBytes(48);
  fs.writeFileSync(path.join(storeRoot, "private", "memory-core-authority.key"), authorityKey, { mode: 0o600 });
  fs.writeFileSync(path.join(storeRoot, "memory-runtime-index.sqlite"), "sqlite-unchanged", { mode: 0o600 });
  fs.writeFileSync(path.join(storeRoot, "memory-runtime-index.sqlite-wal"), "wal-unchanged", { mode: 0o600 });
  fs.writeFileSync(path.join(storeRoot, "memory-runtime-index.sqlite-shm"), "shm-unchanged", { mode: 0o600 });
  const request = {
    workspace,
    expectedProjectIdentitySha256: "a".repeat(64),
    expectedScanSha256: "b".repeat(64),
    previousCheckpointId: "checkpoint-old",
    acceptedEvidenceReceipt: "accepted-evidence-" + "c".repeat(32),
    acceptedEvidenceReceiptDigest: "d".repeat(64),
    acceptedChangedPaths: ["src/a.js", "docs/QA.md"],
    lane: "module-core",
  };
  request.refreshKey = buildRefreshKey(buildQueryBasis(request));
  const result = {
    schemaVersion: "zhixia.memory_runtime_cli.v1",
    operation: "refresh_binding",
    status: "verified",
    current: true,
    recoveryReady: true,
    memoryMode: "app_owned_memory_core",
    authorityVerification: "app_owned_verified",
    workspace,
    projectIdentity: { projectIdentitySha256: request.expectedProjectIdentitySha256 },
    scanSha256: request.expectedScanSha256,
    previousCheckpointId: request.previousCheckpointId,
    authorizedCheckpointId: "checkpoint-new",
    acceptedEvidenceReceipt: request.acceptedEvidenceReceipt,
    acceptedEvidenceReceiptDigest: request.acceptedEvidenceReceiptDigest,
    acceptedChangedPaths: request.acceptedChangedPaths,
    acceptedPathDigest: buildQueryBasis(request).acceptedPathDigest,
    lane: request.lane,
    receiptId: "authority-receipt-new",
    contextGenerationId: "context-new",
    takeover: { shouldInject: true },
  };
  return { workspace, storeRoot, authorityKey, request, result };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-completed-refresh-"));
try {
  const wideAcceptedPaths = Array.from({ length: 30 }, (_, index) => `src/wide-${String(index).padStart(2, "0")}.ts`);
  assert.match(buildQueryBasis({
    workspace: path.join(root, "wide-workspace"),
    expectedProjectIdentitySha256: "1".repeat(64),
    expectedScanSha256: "2".repeat(64),
    previousCheckpointId: "checkpoint-wide",
    acceptedEvidenceReceipt: `accepted-evidence-${"3".repeat(32)}`,
    acceptedEvidenceReceiptDigest: "4".repeat(64),
    acceptedChangedPaths: wideAcceptedPaths,
    lane: "wide-slice-reconciliation",
  }).acceptedPathDigest, /^[a-f0-9]{64}$/, "completed refresh receipts must support a reconciled Slice set above 24 paths");

  const missingStore = path.join(root, "missing-store");
  const missingRequest = {
    workspace: path.join(root, "missing-workspace"),
    expectedProjectIdentitySha256: "a".repeat(64), expectedScanSha256: "b".repeat(64),
    previousCheckpointId: "checkpoint-old", acceptedEvidenceReceipt: "accepted-evidence-" + "c".repeat(32),
    acceptedEvidenceReceiptDigest: "d".repeat(64), acceptedChangedPaths: ["src/a.js"], lane: "module-core", refreshKey: "d".repeat(64),
  };
  const beforeMissing = snapshot(root);
  assert.equal(queryCompletedRefreshOutcome(missingRequest, { storeRoot: missingStore }).reasonCodes[0], "refresh_outcome_store_unavailable");
  assert.deepEqual(snapshot(root), beforeMissing, "first-use query must not create any path");

  const current = fixture(root);
  const beforeUnknown = snapshot(current.storeRoot);
  assert.equal(queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot }).reasonCodes[0], "refresh_outcome_unknown");
  assert.deepEqual(snapshot(current.storeRoot), beforeUnknown, "unknown query must be byte-, path-, and mode-stable");

  const published = publishCompletedRefreshOutcome({ ...current, request: current.request, result: current.result });
  assert.match(published.outcomeDigest, /^[a-f0-9]{64}$/);
  assert.equal(path.basename(published.finalPath), "outcome.json");
  const outcomeDirectory = path.dirname(published.finalPath);
  const formalOutcomes = () => fs.readdirSync(outcomeDirectory).filter((name) => name.endsWith(".json"));
  assert.deepEqual(formalOutcomes(), ["outcome.json"]);

  const idempotent = publishCompletedRefreshOutcome({
    ...current,
    request: current.request,
    result: current.result,
    nowMs: Date.now() + 60_000,
  });
  assert.equal(idempotent.outcomeDigest, published.outcomeDigest);
  assert.deepEqual(formalOutcomes(), ["outcome.json"], "same tuple and result must reuse one formal outcome");

  const conflicting = structuredClone(current.result);
  conflicting.contextGenerationId = "context-conflicting";
  assert.throws(
    () => publishCompletedRefreshOutcome({ ...current, request: current.request, result: conflicting }),
    /refresh_outcome_publication_conflict/,
  );
  assert.deepEqual(formalOutcomes(), ["outcome.json"], "conflicting publication must not leave a second formal outcome");
  const privateKeyPath = path.join(current.storeRoot, "private", "memory-core-authority.key");
  const publicKeyPath = path.join(current.storeRoot, "private", "memory-core-authority-public-key.der");
  const movedPublicKeyPath = `${publicKeyPath}.not-readable-by-query`;
  fs.renameSync(publicKeyPath, movedPublicKeyPath);
  const beforeMissingAuthority = snapshot(current.storeRoot);
  const missingAuthority = queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot });
  assert.equal(missingAuthority.status, "unavailable");
  assert.deepEqual(snapshot(current.storeRoot), beforeMissingAuthority, "missing authority anchor must fail without creating or repairing it");
  fs.renameSync(movedPublicKeyPath, publicKeyPath);
  const beforeQuery = snapshot(current.storeRoot);
  const queried = queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot });
  assert.equal(queried.status, "verified");
  assert.equal(queried.operation, "query_refresh_outcome");
  assert.equal(queried.outcomeVerification, "app_owned_authenticated");
  assert.deepEqual(queried.safety, { writes: 0, scans: 0, sqliteOpens: 0, keyCreates: 0, logs: 0 });
  assert.deepEqual(snapshot(current.storeRoot), beforeQuery, "successful query must not write or repair modes");

  const outcomeAdjacentKey = path.join(current.storeRoot, "completed-refresh-outcomes", "v2", "authority-public-key.der");
  fs.writeFileSync(outcomeAdjacentKey, crypto.randomBytes(44), { mode: 0o600 });
  assert.equal(queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot }).status, "verified",
    "an attacker-controlled key beside outcomes must not become a trust anchor");
  fs.unlinkSync(outcomeAdjacentKey);

  const authorityBytes = fs.readFileSync(publicKeyPath);
  fs.writeFileSync(publicKeyPath, crypto.randomBytes(authorityBytes.length));
  assert.equal(queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot }).reasonCodes[0], "refresh_outcome_signature_invalid");
  fs.writeFileSync(publicKeyPath, authorityBytes);

  const replacementKey = crypto.randomBytes(48);
  const replacementStore = path.join(root, "replacement-store");
  fs.mkdirSync(path.join(replacementStore, "private"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(replacementStore, "private", "memory-core-authority.key"), replacementKey, { mode: 0o600 });
  publishCompletedRefreshOutcome({
    ...current,
    storeRoot: replacementStore,
    authorityKey: replacementKey,
    result: { ...current.result, receiptId: "forged-authority-receipt", contextGenerationId: "forged-context" },
  });
  fs.cpSync(path.join(replacementStore, "completed-refresh-outcomes"), path.join(current.storeRoot, "replacement-outcomes"), { recursive: true });
  const originalOutcomes = path.join(current.storeRoot, "completed-refresh-outcomes");
  const savedOutcomes = `${originalOutcomes}.trusted`;
  fs.renameSync(originalOutcomes, savedOutcomes);
  fs.renameSync(path.join(current.storeRoot, "replacement-outcomes"), originalOutcomes);
  assert.equal(queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot }).reasonCodes[0], "refresh_outcome_signature_invalid",
    "replacing the outcome tree without the app-owned authority anchor must fail");
  fs.rmSync(originalOutcomes, { recursive: true });
  fs.renameSync(savedOutcomes, originalOutcomes);

  for (const patch of [
    { expectedProjectIdentitySha256: "d".repeat(64) },
    { expectedScanSha256: "e".repeat(64) },
    { previousCheckpointId: "checkpoint-other" },
    { acceptedEvidenceReceipt: "accepted-evidence-" + "f".repeat(32) },
    { acceptedEvidenceReceiptDigest: "f".repeat(64) },
    { acceptedChangedPaths: ["src/b.js"] },
    { lane: "module-other" },
    { refreshKey: "0".repeat(64) },
  ]) {
    const changed = { ...current.request, ...patch };
    assert.notEqual(queryCompletedRefreshOutcome(changed, { storeRoot: current.storeRoot }).status, "verified");
  }

  const bytes = fs.readFileSync(published.finalPath);
  const tampered = JSON.parse(bytes);
  tampered.result.contextGenerationId = "context-tampered";
  fs.writeFileSync(published.finalPath, `${JSON.stringify(tampered)}\n`);
  assert.equal(queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot }).reasonCodes[0], "refresh_outcome_digest_invalid");
  fs.writeFileSync(published.finalPath, bytes);

  const second = path.join(path.dirname(published.finalPath), "other.json");
  fs.writeFileSync(second, bytes, { mode: 0o600 });
  assert.equal(queryCompletedRefreshOutcome(current.request, { storeRoot: current.storeRoot }).reasonCodes[0], "refresh_outcome_ambiguous");
  fs.unlinkSync(second);

  const swapRoot = path.join(root, "swap-store");
  fs.cpSync(current.storeRoot, swapRoot, { recursive: true });
  const swapDirectory = path.join(swapRoot, "completed-refresh-outcomes", "v2", current.request.refreshKey.slice(0, 2), current.request.refreshKey);
  const heldDirectory = `${swapDirectory}.held`;
  const externalDirectory = path.join(root, "external-outcomes");
  fs.mkdirSync(externalDirectory);
  fs.writeFileSync(path.join(externalDirectory, "external-sentinel.json"), "outside", { mode: 0o600 });
  const marker = path.join(root, "openat-held.marker");
  const helperSource = fs.readFileSync(path.join(__dirname, "..", "electron", "readonlyOpenatHelper.py"), "utf8")
    .replace("        return fds\n", [
      "        marker = os.environ['ZHIXIA_OPENAT_TEST_MARKER']",
      "        with open(marker, 'xb') as marker_file:",
      "            marker_file.write(b'opened')",
      "        __import__('time').sleep(1)",
      "        return fds",
      "",
    ].join("\n"));
  const swapper = require("node:child_process").spawn("/bin/sh", ["-c", [
    `while [ ! -e ${JSON.stringify(marker)} ]; do sleep 0.01; done`,
    `mv ${JSON.stringify(swapDirectory)} ${JSON.stringify(heldDirectory)}`,
    `ln -s ${JSON.stringify(externalDirectory)} ${JSON.stringify(swapDirectory)}`,
  ].join("; ")], { stdio: "ignore" });
  const helperOutput = require("node:child_process").execFileSync("/usr/bin/python3", ["-c", helperSource], {
    env: { ...process.env, ZHIXIA_OPENAT_TEST_MARKER: marker },
    input: JSON.stringify({
    operation: "list_directory",
    root: swapRoot,
    directorySegments: ["completed-refresh-outcomes", "v2", current.request.refreshKey.slice(0, 2), current.request.refreshKey],
    }),
    encoding: "utf8",
  });
  assert.ok(swapper.pid > 0);
  const helperResult = JSON.parse(helperOutput);
  assert.equal(helperResult.status, "ok");
  assert.ok(helperResult.names.includes("outcome.json"), "held fd must continue to reference the trusted directory");
  assert.equal(helperResult.names.includes("external-sentinel.json"), false, "external directory bytes must remain unread");

  const symlinkRoot = path.join(root, "symlink-store");
  fs.mkdirSync(symlinkRoot);
  fs.symlinkSync(path.join(current.storeRoot, "completed-refresh-outcomes"), path.join(symlinkRoot, "completed-refresh-outcomes"));
  assert.equal(queryCompletedRefreshOutcome(current.request, { storeRoot: symlinkRoot }).reasonCodes[0], "refresh_outcome_unsafe_path");

  console.log("Completed refresh outcome publication and zero-write query tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
