const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runtimeCli = require("../electron/memoryRuntimeCli.cjs");
const { invoke } = require("../codex-skills/zhixia-local-docs/scripts/invoke-app-memory-runtime.cjs");
const { execute } = runtimeCli;
const runtimeCliPath = path.resolve(__dirname, "..", "electron", "memoryRuntimeCli.cjs");

function git(workspace, args) {
  return execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initializeRepo(workspace, name = "Authority Boundary Fixture") {
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), `# ${name}\n`, "utf8");
  fs.writeFileSync(path.join(workspace, "docs", "CURRENT_CHECKPOINT.md"), "# Current checkpoint\n", "utf8");
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "authority-boundary@example.invalid"]);
  git(workspace, ["config", "user.name", "Authority Boundary Test"]);
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-m", "fixture baseline"]);
}

function continuitySeed(workspace, storeRoot, scan) {
  return {
    operation: "seed",
    workspace,
    storeRoot,
    execute: true,
    expectedScanSha256: scan.scanSha256,
    now: new Date(Date.now() - 60_000).toISOString(),
    projectName: "Authority Boundary Fixture",
    moduleId: "authority-boundary",
    continuity: {
      originalGoal: "Keep exact-scan authority bounded to one canonical workspace.",
      phase: "authority boundary regression",
      projectSummary: "A synthetic fixture for local authority boundary tests.",
      architectureAnchors: ["Exact scans reject aliases before reading bytes."],
      standingRules: ["Accepted evidence requires an app-owned receipt."],
      acceptanceCriteria: ["Tampering, expiry, cross-project use, and replay fail closed."],
      safetyRules: ["Never read external linked bytes."],
      acceptedProgress: ["Baseline fixture seeded."],
      openTasks: ["Exercise authority refresh."],
      nextActions: ["Run the focused boundary regression."],
      threadLineage: ["authority-boundary-test"],
    },
  };
}

function issueReceipt(workspace, storeRoot, scan, previousCheckpointId, acceptedChangedPaths, overrides = {}) {
  const clockMs = overrides.clockMs ?? Date.now();
  return runtimeCli.issueAcceptedEvidenceReceiptFromApp({
    workspace,
    storeRoot,
    execute: true,
    expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
    expectedScanSha256: scan.scanSha256,
    previousCheckpointId,
    acceptedChangedPaths,
    lane: "authority-boundary",
    decision: "accept",
    ...overrides,
  }, { clock: () => clockMs });
}

function refreshRequest(workspace, storeRoot, scan, previousCheckpointId, receiptId, acceptedChangedPaths, overrides = {}) {
  return {
    operation: "refresh_binding",
    workspace,
    storeRoot,
    execute: true,
    expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
    expectedScanSha256: scan.scanSha256,
    previousCheckpointId,
    acceptedEvidenceReceipt: receiptId,
    acceptedChangedPaths,
    lane: "authority-boundary",
    now: new Date().toISOString(),
    evidence: {
      decision: "accept",
      eventType: "checkpoint",
      moduleId: "authority-boundary",
      title: "Authority boundary change accepted",
      summary: "The exact changed path passed bounded local review.",
      acceptedProgress: ["Authority boundary change accepted."],
      sourceRefs: acceptedChangedPaths.map((relativePath) => {
        const ref = scan.sourceRefs.find((candidate) => candidate.title === relativePath);
        assert.ok(ref, `missing source ref for ${relativePath}`);
        return { path: relativePath, hash: ref.hash };
      }),
    },
    ...overrides,
  };
}

function spawnRuntimeRequest(request, options = {}) {
  return new Promise((resolve, reject) => {
    const script = options.appOwnedQueryStoreRoot
      ? `const runtime=require(${JSON.stringify(runtimeCliPath)});const request=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(runtime.execute(request,{appOwnedQueryStoreRoot:process.argv[2]}))+'\\n')`
      : null;
    const argv = script
      ? ["-e", script, JSON.stringify(request), options.appOwnedQueryStoreRoot]
      : [runtimeCliPath];
    const child = spawn(process.execPath, argv, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(options.env || {}) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      try {
        resolve({ status, stdout, stderr, result: JSON.parse(stdout) });
      } catch (error) {
        reject(new Error(`runtime_child_invalid_json:${error.message}:${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.end(script ? undefined : JSON.stringify(request));
  });
}

function spawnReceiptConsumeRequest(input) {
  return new Promise((resolve, reject) => {
    const script = `const runtime=require(${JSON.stringify(runtimeCliPath)});const input=JSON.parse(process.argv[1]);try{const result=runtime.consumeAcceptedEvidenceReceiptForTest(input.request,{testOnly:true,scanEnvelope:input.scan});process.stdout.write(JSON.stringify({status:'consumed',result})+'\\n')}catch(error){process.stdout.write(JSON.stringify({status:'error',error:error.message})+'\\n');process.exitCode=1}`;
    const child = spawn(process.execPath, ["-e", script, JSON.stringify(input)], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      try { resolve({ status, stderr, result: JSON.parse(stdout) }); }
      catch (error) { reject(new Error(`receipt_child_invalid_json:${error.message}:${stdout.slice(0, 200)}`)); }
    });
  });
}

function testExactScanContainment(root) {
  const workspace = path.join(root, "scan-workspace");
  const externalRoot = path.join(root, "external");
  fs.mkdirSync(externalRoot, { recursive: true });
  initializeRepo(workspace, "Exact Scan Fixture");
  const externalFile = path.join(externalRoot, "outside.md");
  fs.writeFileSync(externalFile, "EXTERNAL-BYTES-MUST-NOT-BE-READ\n", "utf8");
  fs.symlinkSync(externalFile, path.join(workspace, "docs", "linked.md"));
  fs.symlinkSync(externalRoot, path.join(workspace, "docs", "nested-link"));

  let externalBodyReads = 0;
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function instrumentedReadFileSync(filePath, ...args) {
    if (path.resolve(String(filePath)).startsWith(path.resolve(externalRoot) + path.sep)) externalBodyReads += 1;
    return originalReadFileSync.call(this, filePath, ...args);
  };
  try {
    assert.throws(
      () => execute({ operation: "scan", workspace }),
      /workspace_source_symlink_rejected/,
      "automatic canonical-source traversal must reject a discovered symlink",
    );
    assert.throws(
      () => execute({ operation: "scan", workspace, relativePaths: ["docs/linked.md"] }),
      /workspace_source_(?:symlink|reparse)_rejected/,
    );
    assert.throws(
      () => execute({ operation: "scan", workspace, relativePaths: ["docs/nested-link/outside.md"] }),
      /workspace_source_(?:symlink|reparse)_rejected/,
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(externalBodyReads, 0, "external linked bytes must never be read or hashed");

  const raceWorkspace = path.join(root, "race-workspace");
  initializeRepo(raceWorkspace, "TOCTOU Fixture");
  const racePath = path.join(fs.realpathSync(raceWorkspace), "docs", "CURRENT_CHECKPOINT.md");
  const originalOpenSync = fs.openSync;
  let raceInjected = false;
  fs.openSync = function instrumentedOpenSync(filePath, ...args) {
    if (!raceInjected && path.resolve(String(filePath)) === racePath) {
      raceInjected = true;
      fs.unlinkSync(racePath);
      fs.symlinkSync(externalFile, racePath);
    }
    return originalOpenSync.call(this, filePath, ...args);
  };
  try {
    assert.throws(
      () => execute({ operation: "scan", workspace: raceWorkspace, storeRoot: path.join(root, "race-store"), relativePaths: ["docs/CURRENT_CHECKPOINT.md"] }),
      /workspace_source_(?:symlink_rejected|identity_changed)/,
      "a file swapped to an external symlink after inspection must fail before bytes are read",
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
  assert.equal(raceInjected, true, "the TOCTOU regression must exercise the inspection/open boundary");
  fs.unlinkSync(racePath);
  fs.writeFileSync(racePath, "# Restored checkpoint\n", "utf8");

  const docsLinkWorkspace = path.join(root, "docs-link-workspace");
  fs.mkdirSync(docsLinkWorkspace, { recursive: true });
  fs.writeFileSync(path.join(docsLinkWorkspace, "README.md"), "# Docs link fixture\n", "utf8");
  git(docsLinkWorkspace, ["init"]);
  git(docsLinkWorkspace, ["config", "user.email", "authority-boundary@example.invalid"]);
  git(docsLinkWorkspace, ["config", "user.name", "Authority Boundary Test"]);
  fs.symlinkSync(externalRoot, path.join(docsLinkWorkspace, "docs"));
  let externalDirectoryReads = 0;
  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = function instrumentedReaddirSync(directoryPath, ...args) {
    if (path.resolve(String(directoryPath)).startsWith(path.resolve(externalRoot))) externalDirectoryReads += 1;
    return originalReaddirSync.call(this, directoryPath, ...args);
  };
  try {
    assert.throws(
      () => execute({ operation: "scan", workspace: docsLinkWorkspace, storeRoot: path.join(root, "docs-link-store") }),
      /workspace_source_symlink_rejected/,
    );
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
  assert.equal(externalDirectoryReads, 0, "a linked docs root must be rejected before external directory enumeration");

  assert.throws(
    () => execute({ operation: "scan", workspace: raceWorkspace, storeRoot: path.join(root, "missing-store"), relativePaths: ["docs/missing-required.md"] }),
    /workspace_required_source_missing/,
    "an explicitly required source path must not be silently skipped",
  );

  assert.throws(() => runtimeCli.inspectContainedScanPath(workspace, "docs/junction/file.md", {
    fsAdapter: {
      lstatSync(candidate) {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => candidate.endsWith("junction"),
          isFile: () => candidate.endsWith("file.md"),
          size: 1,
        };
      },
      realpathSync: (candidate) => candidate,
    },
    reparseDetector: (_stats, candidate) => candidate.endsWith("junction"),
  }), /workspace_source_reparse_rejected/, "injectable Windows junction/reparse contract must fail before reads");

  if (fs.existsSync("/var") && fs.realpathSync("/var") !== path.resolve("/var")) {
    const varAlias = workspace.replace(fs.realpathSync("/var"), "/var");
    if (varAlias !== workspace && fs.existsSync(varAlias)) {
      const scan = execute({ operation: "scan", workspace: varAlias, relativePaths: ["docs/CURRENT_CHECKPOINT.md"] });
      assert.equal(scan.workspace, fs.realpathSync(workspace), "/var aliases must normalize to the canonical root");
    }
  }
}

function testInvokerPolicyFailureIsTerminal(root) {
  const firstRoot = path.join(root, "first-runtime");
  const secondRoot = path.join(root, "second-runtime");
  const firstCli = path.join(firstRoot, "electron", "memoryRuntimeCli.cjs");
  const secondCli = path.join(secondRoot, "electron", "memoryRuntimeCli.cjs");
  const secondMarker = path.join(root, "second-runtime-invoked");
  fs.mkdirSync(path.dirname(firstCli), { recursive: true });
  fs.mkdirSync(path.dirname(secondCli), { recursive: true });
  fs.writeFileSync(firstCli, "process.stdout.write(JSON.stringify({status:'error',current:false,recoveryReady:false,error:'workspace_source_symlink_rejected'})+'\\n');process.exitCode=1;\n", "utf8");
  fs.writeFileSync(secondCli, `require('node:fs').writeFileSync(${JSON.stringify(secondMarker)},'invoked');process.stdout.write(JSON.stringify({status:'scanned'})+'\\n');\n`, "utf8");
  assert.throws(
    () => invoke(JSON.stringify({ operation: "scan", workspace: root }), {
      ...process.env,
      ZHIXIA_MEMORY_RUNTIME_CLI: firstCli,
      ZHIXIA_APP_ROOT: secondRoot,
    }),
    /workspace_source_symlink_rejected/,
  );
  assert.equal(fs.existsSync(secondMarker), false, "a structured Runtime policy rejection must not fall through to an older Runtime");
}

async function testAcceptedEvidenceReceipt(root) {
  const workspace = path.join(root, "receipt-workspace");
  const foreign = path.join(root, "foreign-workspace");
  const storeRoot = path.join(root, "memory-store");
  initializeRepo(workspace);
  initializeRepo(foreign, "Foreign Fixture");
  const baselineScan = execute({ operation: "scan", workspace, storeRoot });
  const seeded = execute(continuitySeed(workspace, storeRoot, baselineScan));
  const previousCheckpointId = seeded.checkpoint?.writes?.find((write) => write.kind === "projectCheckpoint")?.id
    || execute({ operation: "verify", workspace, storeRoot }).scanBinding.authorizedCheckpointId;
  assert.ok(previousCheckpointId, "seed must establish an authorized checkpoint");

  const changedPath = "docs/ACCEPTED-BOUNDARY.md";
  fs.writeFileSync(path.join(workspace, changedPath), "# Accepted bounded change\n", "utf8");
  const scan = execute({ operation: "scan", workspace, storeRoot, relativePaths: [changedPath] });
  assert.equal(execute({ operation: "verify", workspace, storeRoot, relativePaths: [changedPath] }).scanBinding.authorizedCheckpointId, previousCheckpointId);

  assert.throws(
    () => execute({ operation: "issue_accepted_evidence_receipt", workspace, storeRoot }),
    /unsupported_memory_runtime_cli_operation/,
    "serialized CLI callers must not mint app-owned receipts",
  );

  assert.throws(
    () => execute(refreshRequest(workspace, storeRoot, scan, previousCheckpointId, "qa-free-form-forgery", [changedPath])),
    /accepted_evidence_receipt_(?:not_found|invalid)/,
    "a caller-supplied free-form receipt must not authorize refresh",
  );

  const receipt = issueReceipt(workspace, storeRoot, scan, previousCheckpointId, [changedPath]);
  assert.match(receipt.receiptId, /^accepted-evidence-[a-f0-9]{32}$/);
  assert.equal(Object.hasOwn(receipt, "proof"), false, "receipt proof must remain app-owned");
  assert.equal(Object.hasOwn(receipt, "nonce"), false, "receipt nonce must remain app-owned");
  const privateReceiptStorePath = path.join(storeRoot, "accepted-evidence-receipts", `${scan.projectIdentity.projectId}.json`);
  const privateReceipt = JSON.parse(fs.readFileSync(privateReceiptStorePath, "utf8")).receipts
    .find((entry) => entry.receiptId === receipt.receiptId);
  assert.deepEqual({
    workspace: privateReceipt.binding.workspace,
    projectId: privateReceipt.binding.projectId,
    projectIdentitySha256: privateReceipt.binding.projectIdentitySha256,
    previousCheckpointId: privateReceipt.binding.previousCheckpointId,
    targetScanSha256: privateReceipt.binding.targetScanSha256,
    lane: privateReceipt.binding.lane,
    decision: privateReceipt.binding.decision,
    issuer: privateReceipt.binding.issuer,
  }, {
    workspace: scan.workspace,
    projectId: scan.projectIdentity.projectId,
    projectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
    previousCheckpointId,
    targetScanSha256: scan.scanSha256,
    lane: "authority-boundary",
    decision: "accept",
    issuer: "zhixia.app.memory-runtime",
  });
  assert.match(privateReceipt.binding.acceptedPathDigest, /^[a-f0-9]{64}$/);
  assert.match(privateReceipt.binding.nonce, /^[a-f0-9]{48}$/);
  assert.match(privateReceipt.proof, /^[a-f0-9]{64}$/);

  const secondChangedPath = "docs/SECOND-ACCEPTED-BOUNDARY.md";
  fs.writeFileSync(path.join(workspace, secondChangedPath), "# Second accepted bounded change\n", "utf8");
  const expandedScan = execute({ operation: "scan", workspace, storeRoot, relativePaths: [changedPath, secondChangedPath] });
  assert.throws(
    () => execute(refreshRequest(workspace, storeRoot, expandedScan, previousCheckpointId, receipt.receiptId, [changedPath, secondChangedPath])),
    /accepted_evidence_receipt_binding_mismatch/,
    "a source-backed but different accepted path set must not consume the receipt",
  );
  fs.unlinkSync(path.join(workspace, secondChangedPath));

  fs.appendFileSync(path.join(workspace, changedPath), "Changed after receipt issue.\n", "utf8");
  const driftedScan = execute({ operation: "scan", workspace, storeRoot, relativePaths: [changedPath] });
  assert.notEqual(driftedScan.scanSha256, scan.scanSha256);
  assert.throws(
    () => execute(refreshRequest(workspace, storeRoot, driftedScan, previousCheckpointId, receipt.receiptId, [changedPath])),
    /accepted_evidence_receipt_binding_mismatch/,
    "a receipt for the same project/checkpoint must not authorize a different target scan",
  );
  fs.writeFileSync(path.join(workspace, changedPath), "# Accepted bounded change\n", "utf8");

  assert.throws(
    () => execute(refreshRequest(workspace, storeRoot, scan, previousCheckpointId, receipt.receiptId, [changedPath], { lane: "other-lane" })),
    /accepted_evidence_receipt_binding_mismatch/,
  );

  const foreignBaselineScan = execute({ operation: "scan", workspace: foreign, storeRoot });
  const foreignSeeded = execute(continuitySeed(foreign, storeRoot, foreignBaselineScan));
  const foreignCheckpointId = foreignSeeded.checkpoint?.writes?.find((write) => write.kind === "projectCheckpoint")?.id
    || execute({ operation: "verify", workspace: foreign, storeRoot }).scanBinding.authorizedCheckpointId;
  fs.writeFileSync(path.join(foreign, changedPath), "# Foreign accepted change\n", "utf8");
  const foreignScan = execute({ operation: "scan", workspace: foreign, storeRoot, relativePaths: [changedPath] });
  assert.throws(
    () => execute(refreshRequest(foreign, storeRoot, foreignScan, foreignCheckpointId, receipt.receiptId, [changedPath])),
    /accepted_evidence_receipt_(?:not_found|binding_mismatch)/,
  );

  const expiredClock = Date.now() - 61 * 60_000;
  const expired = issueReceipt(workspace, storeRoot, scan, previousCheckpointId, [changedPath], { clockMs: expiredClock });
  assert.throws(
    () => runtimeCli.executeRefreshBinding(
      refreshRequest(workspace, storeRoot, scan, previousCheckpointId, expired.receiptId, [changedPath], {
        now: new Date(expiredClock + 30_000).toISOString(),
      }),
      { clock: () => Date.now() },
    ),
    /accepted_evidence_receipt_expired/,
    "a caller-supplied past time must not revive an expired receipt",
  );

  const tampered = issueReceipt(workspace, storeRoot, scan, previousCheckpointId, [changedPath]);
  const receiptStorePath = privateReceiptStorePath;
  const receiptStore = JSON.parse(fs.readFileSync(receiptStorePath, "utf8"));
  receiptStore.receipts.find((entry) => entry.receiptId === tampered.receiptId).binding.lane = "tampered-lane";
  fs.writeFileSync(receiptStorePath, `${JSON.stringify(receiptStore)}\n`, { encoding: "utf8", mode: 0o600 });
  assert.throws(
    () => execute(refreshRequest(workspace, storeRoot, scan, previousCheckpointId, tampered.receiptId, [changedPath])),
    /accepted_evidence_receipt_proof_invalid/,
  );
  receiptStore.receipts.find((entry) => entry.receiptId === tampered.receiptId).binding.lane = "authority-boundary";
  fs.writeFileSync(receiptStorePath, `${JSON.stringify(receiptStore)}\n`, { encoding: "utf8", mode: 0o600 });

  const refreshed = execute(refreshRequest(workspace, storeRoot, scan, previousCheckpointId, receipt.receiptId, [changedPath]));
  assert.equal(refreshed.current, true);
  assert.equal(refreshed.acceptedEvidenceReceipt, receipt.receiptId);
  assert.match(refreshed.refreshKey, /^[a-f0-9]{64}$/, "refresh must return the durable outcome reconciliation key");
  assert.match(refreshed.outcomeDigest, /^[a-f0-9]{64}$/, "refresh must return the immutable outcome digest");
  const outcomeQuery = {
    operation: "query_refresh_outcome",
    workspace: refreshed.workspace,
    expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
    expectedScanSha256: scan.scanSha256,
    previousCheckpointId,
    acceptedEvidenceReceipt: receipt.receiptId,
    acceptedEvidenceReceiptDigest: receipt.receiptDigest,
    acceptedChangedPaths: [changedPath],
    lane: "authority-boundary",
    refreshKey: refreshed.refreshKey,
  };
  const queryOptions = { appOwnedQueryStoreRoot: storeRoot };
  const restartedOutcome = await spawnRuntimeRequest(outcomeQuery, queryOptions);
  assert.equal(restartedOutcome.status, 0, restartedOutcome.stderr);
  assert.equal(restartedOutcome.result.operation, "query_refresh_outcome");
  assert.equal(restartedOutcome.result.status, "verified");
  assert.equal(restartedOutcome.result.authorizedCheckpointId, refreshed.authorizedCheckpointId);
  assert.equal(restartedOutcome.result.contextGenerationId, refreshed.contextGenerationId);
  assert.equal(restartedOutcome.result.outcomeDigest, refreshed.outcomeDigest);
  assert.deepEqual(restartedOutcome.result.safety, { writes: 0, scans: 0, sqliteOpens: 0, keyCreates: 0, logs: 0 });
  for (const changed of [
    { refreshKey: "0".repeat(64) },
    { expectedScanSha256: "1".repeat(64) },
    { acceptedChangedPaths: ["docs/OTHER.md"] },
  ]) {
    const unavailable = await spawnRuntimeRequest({ ...outcomeQuery, ...changed }, queryOptions);
    assert.equal(unavailable.status, 0, unavailable.stderr);
    assert.equal(unavailable.result.status, "unavailable");
    assert.equal(unavailable.result.safety.writes, 0);
  }
  const callerSelectedRoot = await spawnRuntimeRequest({ ...outcomeQuery, storeRoot }, queryOptions);
  assert.equal(callerSelectedRoot.status, 0, callerSelectedRoot.stderr);
  assert.equal(callerSelectedRoot.result.status, "unavailable");
  assert.equal(callerSelectedRoot.result.reasonCodes[0], "refresh_outcome_store_root_override_rejected");
  const isolatedHome = path.join(root, "isolated-query-home");
  fs.mkdirSync(isolatedHome);
  const resolverScript = `const runtime=require(${JSON.stringify(runtimeCliPath)});process.stdout.write(runtime.resolveAppOwnedQueryStoreRoot())`;
  const resolvedWithHostileEnvironment = execFileSync(process.execPath, ["-e", resolverScript], {
    encoding: "utf8",
    env: { ...process.env, HOME: isolatedHome, ZHIXIA_MEMORY_RUNTIME_ROOT: storeRoot },
  });
  const accountHome = os.userInfo().homedir;
  assert.equal(resolvedWithHostileEnvironment, path.join(accountHome, "Library", "Application Support", "知匣 Local Doc Knowledge", "memory-runtime"),
    "app-owned query root must come from the OS account record, not caller HOME or Runtime root overrides");
  assert.throws(
    () => execute(refreshRequest(workspace, storeRoot, scan, refreshed.authorizedCheckpointId, receipt.receiptId, [changedPath])),
    /accepted_evidence_receipt_already_consumed/,
    "an accepted evidence receipt must be single use",
  );

  const replay = await spawnRuntimeRequest(refreshRequest(
    workspace, storeRoot, scan, refreshed.authorizedCheckpointId, receipt.receiptId, [changedPath],
  ));
  assert.notEqual(replay.status, 0);
  assert.match(replay.result.error, /accepted_evidence_receipt_already_consumed/, "a new Runtime process must reject replay after restart");

  const concurrentPath = "docs/CONCURRENT-ACCEPTED-BOUNDARY.md";
  fs.writeFileSync(path.join(workspace, concurrentPath), "# Concurrent accepted bounded change\n", "utf8");
  const concurrentScan = execute({ operation: "scan", workspace, storeRoot, relativePaths: [concurrentPath] });
  const concurrentReceipt = issueReceipt(
    workspace, storeRoot, concurrentScan, refreshed.authorizedCheckpointId, [concurrentPath],
  );
  const concurrentRequest = refreshRequest(
    workspace, storeRoot, concurrentScan, refreshed.authorizedCheckpointId, concurrentReceipt.receiptId, [concurrentPath],
  );
  const concurrentInput = { request: concurrentRequest, scan: concurrentScan };
  const competitors = await Promise.all([spawnReceiptConsumeRequest(concurrentInput), spawnReceiptConsumeRequest(concurrentInput)]);
  assert.equal(competitors.filter((entry) => entry.status === 0 && entry.result.status === "consumed").length, 1, "exactly one process may consume a one-time receipt");
  assert.equal(competitors.filter((entry) => entry.status !== 0
    && /accepted_evidence_receipt_(?:store_busy|already_consumed)/.test(entry.result.error || "")).length, 1, JSON.stringify(competitors));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-authority-boundaries-"));
  try {
    testExactScanContainment(root);
    testInvokerPolicyFailureIsTerminal(root);
    await testAcceptedEvidenceReceipt(root);
    console.log("Memory Runtime exact-scan and accepted-evidence authority boundary tests passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
