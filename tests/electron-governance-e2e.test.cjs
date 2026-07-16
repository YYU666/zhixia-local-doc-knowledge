const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const electronExe = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-electron-e2e-"));
const userData = path.join(tempRoot, "user-data");
const codexHome = path.join(tempRoot, "codex-home");
const projectPath = path.join(tempRoot, "project-alpha");
const projectSkillPath = path.join(projectPath, "codex-skills", "e2e-review-skill");
const projectScriptsPath = path.join(projectPath, "scripts");
const projectDocsPath = path.join(projectPath, "docs");

function writeFixture() {
  fs.mkdirSync(projectSkillPath, { recursive: true });
  fs.mkdirSync(projectScriptsPath, { recursive: true });
  fs.mkdirSync(projectDocsPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectSkillPath, "SKILL.md"),
    [
      "---",
      "name: e2e-review-skill",
      "description: Review Zhixia governance behavior in Electron IPC tests.",
      "---",
      "",
      "# E2E Review Skill",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(projectScriptsPath, "package-release.cjs"),
    "// Release package helper. Review before manual use.\nconsole.log('manual only');\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(projectDocsPath, "CEO_FLOW_HANDOFF.md"),
    [
      "# CEO Flow Handoff",
      "",
      "Thread 11111111-2222-7333-8444-555555555555 coordinates worker 11111111-2222-7333-8444-555555555555 and reviewer 11111111-2222-7333-8444-555555555555.",
      "Decision: accept metadata-only ThreadLineage governance; no archive, compact, restore, or delete mutation.",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(projectDocsPath, "RELEASE_NOTES.md"),
    "# Release Notes\n\nGovernance e2e fixture for project release verification.\n",
    "utf8",
  );
}

function runElectronProbe() {
  return new Promise((resolve, reject) => {
    const probeScript = `window.docKnowledge.e2eProbe({ projectPath: ${JSON.stringify(projectPath)} })`;

    const child = spawn(electronExe, [
      root,
      "--user-data-dir=" + userData,
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--ozone-platform=headless",
    ], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        ELECTRON_DISABLE_GPU: "1",
        ELECTRON_ENABLE_LOGGING: "1",
        ZHIXIA_E2E_PROBE: "1",
        ZHIXIA_E2E_PROJECT_PATH: projectPath,
        ZHIXIA_E2E_RENDERER_SCRIPT: probeScript,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron governance e2e timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 30000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const match = stdout.match(/ZHIXIA_E2E_RESULT (.+)/);
      if (!match) {
        reject(new Error(`Electron governance e2e did not return a result. Exit ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(match[1]));
      } catch (error) {
        reject(new Error(`Electron governance e2e returned invalid JSON: ${error.message}\n${match[1]}`));
      }
    });
  });
}

function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function cleanupTempRoot() {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  if (fs.existsSync(tempRoot)) {
    throw new Error(`Electron governance e2e temp directory was not removed: ${tempRoot}`);
  }
}

(async () => {
  try {
    writeFixture();
    const result = await runElectronProbe();
    assert.equal(result.ok, true, "Electron governance probe should complete");
    assert.equal(isPathInside(userData, result.storePath), true, "probe storePath must stay under isolated userData");
    assert.equal(result.importedCount >= 2, true, "probe should import fixture project docs through main process");
    assert.equal(result.inventory.recordCount >= 2, true, "probe should discover project Skill/script records");
    assert.equal(result.inventory.confirmationStatus, "confirmed", "snapshot confirmation should persist through real IPC");
    assert.equal(result.inventory.policy.doesNotInstall, true, "Tool/Skill IPC must remain non-installing");
    assert.equal(result.inventory.policy.doesNotExecute, true, "Tool/Skill IPC must remain non-executing");
    assert.equal(result.inventory.policy.doesNotActivateCandidates, true, "Tool/Skill IPC must not promote candidates active");
    assert.equal(result.staleSnapshotRejected, true, "stale Tool/Skill snapshot confirmation should be rejected");
    assert.equal(result.staleRecordUpdateRejected, true, "stale per-record governance updates should be rejected");
    assert.equal(result.governedRecord.status, "confirmed", "per-record governance should persist confirmed status");
    assert.equal(result.governedRecord.reviewState, "current", "per-record governance should be current after live update");
    assert.equal(result.governedRecord.recordContextHashPresent, true, "per-record governance should store context hash");
    assert.equal(result.clearedRecord.status, "candidate", "clear should return record to candidate state");
    assert.equal(result.clearedRecord.reviewState, "unreviewed", "clear should remove per-record review state");
    assert.equal(result.retrieval.logCount >= 1, true, "Agent retrieval should write a retrieve log through main process");
    assert.equal(result.retrieval.persistedLineageCount >= 1, true, "ThreadLineage e2e should persist metadata-only lineage rows");
    assert.equal(result.retrieval.lineageCount >= 1, true, "ThreadLineage retrieval should return metadata items");
    for (const policy of result.retrieval.lineagePolicies) {
      assert.equal(policy.rawSessionPolicy, "metadata_only_no_raw_body", "ThreadLineage e2e items must be metadata-only");
      assert.equal(policy.requiresHumanConfirmation, true, "ThreadLineage e2e items must stay human-review material");
      assert.ok(
        policy.whyMatched.includes("policy:no-archive-compact-restore-delete"),
        "ThreadLineage e2e items must preserve no-mutation provenance",
      );
    }
    assert.equal(result.memoryRuntime.writebackStatus, "queued", "accepted source-backed evidence should queue through real Electron IPC");
    assert.equal(result.memoryRuntime.factWriteCount >= 1, true, "accepted evidence should create temporal MemoryFact rows");
    assert.equal(result.memoryRuntime.factCount >= 1, true, "current MemoryFact should be readable from the sidecar");
    assert.equal(result.memoryRuntime.contextFactCount >= 1, true, "retrieve_context should recall MemoryFact through the hybrid path");
    assert.equal(result.memoryRuntime.authorityBypassExcluded, true, "normal project retrieval must exclude global draft and review-required ready candidates");
    assert.equal(result.memoryRuntime.reviewModeCandidateReturned, true, "explicit review mode should be able to retrieve project review candidates");
    assert.equal(result.memoryRuntime.explicitGlobalScopeTruthful, true, "explicit global retrieval must expose legacy mixed rows only as sanitized global review material");
    assert.equal(result.memoryRuntime.contextMode, "bm25f_compact_metadata_v1", "retrieve_context should report hybrid BM25F retrieval");
    assert.equal(result.memoryRuntime.sidecarWholeDatabaseExport, false, "sidecar retrieval must not use whole-database export");
    assert.equal(result.memoryRuntime.triggerReceiptCount >= 2, true, "writeback and retrieve_context should leave trigger receipts");
    assert.equal(result.memoryRuntime.triggerHooks.includes("writeback_evidence"), true, "writeback trigger receipt should be present");
    assert.equal(result.memoryRuntime.triggerHooks.includes("retrieve_context"), true, "retrieve_context trigger receipt should be present");
    assert.equal(result.memoryRuntime.benchmarkPassed, true, "bounded synthetic memory benchmark should pass in Electron");
    assert.equal(result.memoryRuntime.benchmarkRecallAtK, 1, "synthetic Electron benchmark should retain all anchors");
    assert.equal(result.memoryRuntime.rejectedWritebackStatus, "rejected", "unsafe evidence should be rejected in the real Electron main process");
    assert.equal(result.memoryRuntime.rejectedWritebackFactCountUnchanged, true, "rejected evidence must not create current MemoryFact rows");
    assert.equal(result.memoryRuntime.rejectedStoredPayloadSanitized, true, "rejected evidence storage must not retain credential values");
    assert.equal(result.memoryRuntime.rejectedKeyWritebackStatus, "rejected", "dangerous object keys must reject the real Electron writeback packet");
    assert.equal(result.memoryRuntime.rejectedKeyWritebackFactCountUnchanged, true, "dangerous object keys must not create accepted sibling facts");
    assert.equal(result.memoryRuntime.rejectedKeyStoredPayloadSanitized, true, "dangerous object keys must not persist in rejected payloads");
    assert.equal(result.memoryRuntime.unsafeRuntimeEventRejected, true, "unsafe runtime events must not create accepted facts from a safe sibling summary");
    assert.equal(result.memoryRuntime.unsafeRuntimeEventFactCountUnchanged, true, "unsafe runtime events must leave current fact count unchanged");
    assert.equal(result.memoryRuntime.unsafeRuntimeEventStoredPayloadSanitized, true, "unsafe runtime event storage must omit unsafe identifiers");
    console.log("Electron governance e2e tests passed.");
  } finally {
    cleanupTempRoot();
  }
})().catch((error) => {
  console.error(error);
  cleanupTempRoot();
  process.exit(1);
});
