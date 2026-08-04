const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { execute } = require("../electron/memoryRuntimeCli.cjs");
const { bindExactProjectIdentity, deriveProjectIdentity } = require("../electron/memoryCoreRuntime.cjs");
const {
  listAuthorityReceipts,
  listMemoryRuntimeTriggerReceipts,
  listSemanticMemoryEntities,
  listSemanticMemoryRelations,
} = require("../electron/memoryRuntimeIndexStore.cjs");
const cliPath = path.resolve(__dirname, "..", "electron", "memoryRuntimeCli.cjs");
const skillInvokerPath = path.resolve(__dirname, "..", "codex-skills", "zhixia-local-docs", "scripts", "invoke-app-memory-runtime.cjs");

function runStrictCli(request) {
  const result = spawnSync(process.execPath, [cliPath], {
    cwd: request.workspace,
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runSkillInvoker(request) {
  const result = spawnSync(process.execPath, [skillInvokerPath], {
    cwd: request.workspace,
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function git(workspace, aexample_project) {
  return execFileSync("git", aexample_project, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initializeRepo(workspace, name) {
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), `# ${name}\n`, "utf8");
  git(workspace, ["init"]);
  git(workspace, ["config", "user.email", "memory-runtime@example.invalid"]);
  git(workspace, ["config", "user.name", "Memory Runtime Test"]);
}

function commitAll(workspace, message) {
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-m", message]);
  return git(workspace, ["rev-parse", "HEAD"]);
}

function seedRequest(workspace, storeRoot, scan) {
  return {
    operation: "seed",
    workspace,
    storeRoot,
    execute: true,
    expectedScanSha256: scan.scanSha256,
    projectName: "Example Project Game Studio",
    moduleId: "example_project-engine-core",
    continuity: {
      originalGoal: "Build EXAMPLE_PROJECT as a reliable multi-module game creation system.",
      phase: "long-context recovery repair",
      projectSummary: "EXAMPLE_PROJECT verified app-owned recovery checkpoint.",
      architectureAnchors: ["Memory Core authority is source-backed and verified before recall."],
      standingRules: ["Stale helper packets cannot become recovery authority."],
      acceptanceCriteria: ["Recovery binds exact project identity, baseline HEAD, and canonical source hashes."],
      safetyRules: ["Do not persist raw session bodies, images, base64, credentials, or giant Markdown."],
      acceptedProgress: ["EXAMPLE_PROJECT canonical checkpoint and Memory Core recovery contract accepted."],
      openTasks: ["Continue the active EXAMPLE_PROJECT engine workstream from verified context."],
      openBlockers: Array.from({ length: 3 }, (_, index) => `EXAMPLE_PROJECT blocker ${index + 1} remains canonical review material.`),
      latestFailures: Array.from({ length: 3 }, (_, index) => `EXAMPLE_PROJECT failure lesson ${index + 1} remains canonical review material.`),
      nextActions: ["Retrieve the bounded verified EXAMPLE_PROJECT resume packet before dispatch."],
      threadLineage: ["example_project-ceo-current"],
    },
  };
}

function assertSafeBounded(packet, limit) {
  const text = JSON.stringify(packet);
  assert.ok(Buffer.byteLength(text, "utf8") <= limit, `packet must stay within ${limit} bytes`);
  const unsafeMatch = text.match(/RAW-EXAMPLE_PROJECT-SESSION-BODY|STALE-JULY-6-UI-WORKBENCH|LONG-LOG-TAIL-SENTINEL|data:image\/png;base64|A{240}|\bsk-[A-Za-z0-9_-]{12,}/);
  assert.equal(unsafeMatch, null, `unsafe sentinel leaked into packet: ${unsafeMatch?.[0]}`);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-example_project-memory-runtime-"));
  const workspace = path.join(root, "example_project-canonical");
  const linked = path.join(root, "example_project-linked");
  const foreign = path.join(root, "foreign-project");
  const storeRoot = path.join(root, "app-owned-memory-runtime");
  try {
    initializeRepo(workspace, "EXAMPLE_PROJECT");
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "current-feature.js"), "export const currentFeature = 1;\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md"), "# EXAMPLE_PROJECT Current Checkpoint\nAccepted UI and engine direction.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "EXAMPLE_PROJECT_PROGRAM_GOAL.md"), "# EXAMPLE_PROJECT Program Goal\nBuild the complete creation system.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "EXAMPLE_PROJECT_UI_CONVERGENCE_141S_PAUSE_HANDOFF_2026-08-04.md"), "# EXAMPLE_PROJECT Pause Handoff\nPaused by the user after 141S.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "EXAMPLE_PROJECT_UI_CONVERGENCE_141S_ACCEPTANCE_2026-08-04.md"), "# EXAMPLE_PROJECT 141S Acceptance\n141S accepted.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "EXAMPLE_PROJECT_UI_CONVERGENCE_141T_ASSETS_TASK_CARD_2026-08-04.md"), "# EXAMPLE_PROJECT 141T Task Card\nCurrent bounded Assets work.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "PRD.md"), "# EXAMPLE_PROJECT PRD\nCanonical product goal.\n", "utf8");
    fs.mkdirSync(path.join(workspace, "docs", "next-stage", "task-cards"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "docs", "next-stage", "reviews"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "docs", "next-stage", "PRD.md"), "# Nested PRD\nCanonical product contract.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "next-stage", "PROGRAM_GOAL.md"), "# Program Goal\nCurrent execution state.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "next-stage", "task-graph.md"), "# Task Graph\nCurrent active node.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "next-stage", "task-cards", "current-recovery-task.md"), "# Current Task\nCurrent bounded work.\n", "utf8");
    fs.writeFileSync(path.join(workspace, "docs", "next-stage", "reviews", "current-recovery-implementation-acceptance.md"), "# Current Acceptance\nCurrent decision accepted.\n", "utf8");
    for (let index = 0; index < 60; index += 1) {
      const oldHandoff = path.join(workspace, "docs", `EXAMPLE_PROJECT_OLD_HANDOFF_${String(index).padStart(3, "0")}_2026-07-01.md`);
      fs.writeFileSync(oldHandoff, `# old handoff ${index}\n`, "utf8");
      fs.utimesSync(oldHandoff, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
    }
    for (let index = 0; index < 220; index += 1) {
      fs.writeFileSync(path.join(workspace, "docs", `A-${String(index).padStart(3, "0")}.md`), `# filler ${index}\n`, "utf8");
    }
    fs.mkdirSync(path.join(workspace, ".codex-knowledge"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".codex-knowledge", "project-resume.md"), [
      "current=true recoveryReady=true",
      "STALE-JULY-6-UI-WORKBENCH",
      "RAW-EXAMPLE_PROJECT-SESSION-BODY",
      `LONG-LOG-TAIL-SENTINEL ${"log-line ".repeat(1200)}`,
      `data:image/png;base64,${"A".repeat(400)}`,
    ].join("\n"), "utf8");
    const baselineHead = commitAll(workspace, "EXAMPLE_PROJECT baseline checkpoint");

    const scan = execute({ operation: "scan", workspace, storeRoot });
    const strictScan = runStrictCli({ operation: "scan", workspace, storeRoot });
    assert.equal(strictScan.scanSha256, scan.scanSha256, "strict-JSON CLI must match the importable app-owned contract");
    assert.equal(scan.projectIdentity.baselineHead, baselineHead);
    assert.ok(scan.files.some((file) => file.relativePath === "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md"), "priority checkpoint must survive bounded scanning");
    assert.ok(scan.files.some((file) => file.relativePath === "docs/EXAMPLE_PROJECT_PROGRAM_GOAL.md"), "project goal must survive bounded scanning");
    assert.ok(scan.files.some((file) => file.relativePath === "docs/EXAMPLE_PROJECT_UI_CONVERGENCE_141S_PAUSE_HANDOFF_2026-08-04.md"), "latest pause handoff must survive bounded scanning");
    assert.ok(scan.files.some((file) => file.relativePath === "docs/EXAMPLE_PROJECT_UI_CONVERGENCE_141S_ACCEPTANCE_2026-08-04.md"), "latest acceptance must survive bounded scanning");
    const signedSeedPaths = scan.files.slice(0, 15).map((file) => file.relativePath);
    assert.ok(signedSeedPaths.includes("docs/next-stage/PRD.md"), "nested PRD must enter the signed seed refs");
    assert.ok(signedSeedPaths.includes("docs/next-stage/PROGRAM_GOAL.md"), "program goal must enter the signed seed refs");
    assert.ok(signedSeedPaths.includes("docs/next-stage/task-graph.md"), "task graph must enter the signed seed refs");
    assert.ok(signedSeedPaths.includes("docs/next-stage/task-cards/current-recovery-task.md"), "current task card must enter the signed seed refs");
    assert.ok(signedSeedPaths.includes("docs/EXAMPLE_PROJECT_UI_CONVERGENCE_141T_ASSETS_TASK_CARD_2026-08-04.md"), "flat current task-card names must enter the signed seed refs");
    assert.ok(signedSeedPaths.includes("docs/next-stage/reviews/current-recovery-implementation-acceptance.md"), "current formal decision must enter the signed seed refs");
    assert.ok(scan.files.length <= 48);
    assert.equal(scan.generatedKnowledge[0]?.authorityEligible, false);

    const beforeSeed = execute({ operation: "verify", workspace, storeRoot });
    assert.equal(beforeSeed.memoryMode, "fallback_stale");
    assert.equal(beforeSeed.current, false);
    assert.equal(beforeSeed.recoveryReady, false);
    const unreadyRetrieve = runStrictCli({ operation: "retrieve", workspace, storeRoot, taskGoal: "EXAMPLE_PROJECT current engine checkpoint", tokenBudget: 3000 });
    assert.equal(unreadyRetrieve.current, false);
    assert.equal(unreadyRetrieve.recoveryReady, false);
    assert.equal(unreadyRetrieve.semanticGraph.attempted, true);
    assert.equal(unreadyRetrieve.semanticGraph.hitCount, 0);
    assert.equal(unreadyRetrieve.semanticGraph.tokenEstimate, 0);
    assert.deepEqual(unreadyRetrieve.semanticGraph.graphPaths, []);
    assert.equal(unreadyRetrieve.semanticGraph.seed.attempted, false);
    assert.equal(unreadyRetrieve.semanticGraph.seed.recordsWritten, 0);
    assert.equal(unreadyRetrieve.semanticGraph.authority.maySetCurrent, false);
    assert.equal(unreadyRetrieve.semanticGraph.authority.maySetRecoveryReady, false);
    assert.equal(unreadyRetrieve.semanticGraph.authority.maySetAuthorityVerification, false);
    assert.equal(unreadyRetrieve.semanticGraph.triggerReceipt.persisted, false);
    assert.ok(unreadyRetrieve.tokenEstimate <= 3000 && unreadyRetrieve.packetBytes <= 32 * 1024);
    assert.equal(unreadyRetrieve.packetBytes, Buffer.byteLength(JSON.stringify(unreadyRetrieve), "utf8"));
    const unreadyTakeover = runStrictCli({ operation: "prepare_takeover", workspace, storeRoot, taskGoal: "EXAMPLE_PROJECT current engine checkpoint", tokenBudget: 3000 });
    assert.equal(unreadyTakeover.operation, "prepare_takeover");
    assert.equal(unreadyTakeover.takeover.shouldInject, false);
    assert.equal(unreadyTakeover.takeover.injectionMode, "blocked_fail_closed");
    assert.match(unreadyTakeover.contextGenerationId, /^context-[a-f0-9]{24}$/);
    assert.equal(unreadyTakeover.head, baselineHead);
    assert.equal(unreadyTakeover.scanHash, scan.scanSha256);
    assert.match(unreadyTakeover.verifiedMemoryStateHash, /^memory-state-[a-f0-9]{24}$/);
    assertSafeBounded(unreadyTakeover, 32 * 1024);
    assert.throws(() => execute({ ...seedRequest(workspace, storeRoot, scan), expectedScanSha256: "0".repeat(64) }), /scan_sha256_mismatch/);

    const seeded = execute(seedRequest(workspace, storeRoot, scan));
    assert.equal(seeded.status, "verified", JSON.stringify({ checkpoint: seeded.checkpoint, continuity: seeded.continuity, warnings: seeded.warnings }));
    assert.equal(seeded.current, true);
    assert.equal(seeded.recoveryReady, true);
    assert.equal(seeded.warnings.includes("helper_only_or_unverified_authority_cannot_claim_current"), false);
    assert.equal(seeded.memoryCoreProjectId, scan.projectIdentity.projectId, "app-owned seed must use the exact ProjectIdentityEnvelope ID");
    assert.notEqual(deriveProjectIdentity({ projectPath: workspace }).projectId, scan.projectIdentity.projectId, "legacy path identity remains distinct and cannot silently impersonate the envelope");
    assert.throws(() => bindExactProjectIdentity({ projectPath: foreign }, scan.projectIdentity), /ProjectIdentityEnvelope is invalid/, "exact identity capability must reject a foreign path");
    assert.deepEqual(seeded.continuity.conflictSlots, [], "ProjectBrain identity must not conflict with a redundant display-name identity anchor");
    assert.ok(seeded.continuity.filledSlots.includes("open_blockers") && seeded.continuity.filledSlots.includes("latest_failures"), `complete continuity seeds must persist supplied blocker and failure evidence: ${JSON.stringify(seeded.continuity)}`);
    assert.equal(seeded.continuity.missingSlots.includes("open_blockers") || seeded.continuity.missingSlots.includes("latest_failures"), false);
    assert.equal(seeded.checkpoint.accepted, true);
    assertSafeBounded(seeded, 16 * 1024);

    const lifecycleWrite = runStrictCli({
      operation: "writeback_evidence",
      workspace,
      storeRoot,
      execute: true,
      expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
      expectedScanSha256: scan.scanSha256,
      evidence: {
        decision: "accept",
        eventType: "test_pass",
        moduleId: "example_project-engine-core",
        title: "EXAMPLE_PROJECT strict CLI writeback accepted",
        summary: "The exact-scan app-owned lifecycle route passed its bounded integration check.",
        projectSummary: "EXAMPLE_PROJECT verified lifecycle writeback is the current project summary.",
        phase: "verified lifecycle writeback",
        result: "Strict CLI writeback integration passed.",
        acceptedProgress: ["Exact-scan lifecycle writeback is available to clean takeover tasks."],
        nextActions: ["Use prepare_takeover once per context generation."],
        sourceRefs: [scan.sourceRefs.find((ref) => ref.title === "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md")],
      },
    });
    assert.equal(lifecycleWrite.accepted, true, JSON.stringify(lifecycleWrite));
    assert.equal(lifecycleWrite.authorityVerification, "app_owned_verified_write");
    assert.ok(lifecycleWrite.receiptId);
    assertSafeBounded(lifecycleWrite, 16 * 1024);

    const receipts = listAuthorityReceipts(storeRoot, { projectId: seeded.memoryCoreProjectId, view: "all", limit: 100 });
    assert.ok(receipts.some((record) => (record.payload || record).sourceRefs?.some((ref) => ref.kind === "workspace_scan_receipt" && ref.hash === scan.scanSha256)), "signed authority receipt must persist exact scan binding");
    assert.ok(receipts.some((record) => (record.payload || record).sourceRefs?.some((ref) => ref.kind === "canonical_project_file" && ref.title === "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md")), "signed authority receipt must include the priority current checkpoint under a large docs tree");
    assert.ok(receipts.some((record) => (record.payload || record).sourceRefs?.some((ref) => ref.kind === "canonical_project_file" && ref.title === "docs/EXAMPLE_PROJECT_PROGRAM_GOAL.md")), "signed authority receipt must include the current program goal under a large docs tree");
    assert.ok(receipts.some((record) => (record.payload || record).sourceRefs?.some((ref) => ref.kind === "canonical_project_file" && ref.title === "docs/EXAMPLE_PROJECT_UI_CONVERGENCE_141S_PAUSE_HANDOFF_2026-08-04.md")), "signed authority receipt must include the latest pause handoff under a large docs tree");
    assert.ok(receipts.some((record) => (record.payload || record).sourceRefs?.some((ref) => ref.kind === "canonical_project_file" && ref.title === "docs/EXAMPLE_PROJECT_UI_CONVERGENCE_141S_ACCEPTANCE_2026-08-04.md")), "signed authority receipt must include the latest acceptance under a large docs tree");

    const retrieveRequest = { operation: "retrieve", workspace, storeRoot, taskGoal: "EXAMPLE_PROJECT current engine checkpoint", queryType: "thread_recovery", limit: 12, tokenBudget: 3000 };
    const retrieved = runStrictCli(retrieveRequest);
    assert.equal(retrieved.current, true, JSON.stringify(retrieved));
    assert.equal(retrieved.recoveryReady, true);
    assert.equal(retrieved.authorityVerification, "app_owned_verified");
    assert.ok(retrieved.items.length > 0);
    assert.ok(retrieved.items.some((item) => /verified lifecycle writeback/i.test(`${item.title} ${item.summary}`)), "thread recovery must include the current accepted checkpoint content");
    const lifecycleRecall = retrieved.items.find((item) => item.kind === "accepted_progress");
    assert.equal(lifecycleRecall?.sourceRefs?.[0]?.title, "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md", "accepted progress must retain its exact evidence ref instead of inheriting an unrelated acceptance document");
    assert.ok(retrieved.items.some((item) => item.kind === "project_summary" && /current project summary/i.test(item.summary)), "thread recovery must include the refreshed project summary");
    assert.ok(retrieved.items.some((item) => item.kind === "current_phase" && item.summary === "verified lifecycle writeback"), "thread recovery must include the refreshed project phase");
    assert.ok(retrieved.tokenEstimate > 0 && retrieved.tokenEstimate <= 3000, "total strict-JSON packet must fit the requested token budget");
    assert.equal(retrieved.packetBytes, Buffer.byteLength(JSON.stringify(retrieved), "utf8"), "packetBytes must measure the complete strict-JSON response");
    assert.ok(retrieved.semanticGraph.hitCount > 0, `first verified CLI retrieve must seed and return a connected semantic graph path: ${JSON.stringify(retrieved.semanticGraph)}`);
    assert.ok(retrieved.semanticGraph.seed.recordsWritten > 0, "first verified CLI retrieve must populate the sidecar from compact authoritative items");
    assert.equal(retrieved.semanticGraph.seed.workspaceScans, 0);
    assert.equal(retrieved.semanticGraph.seed.documentEnumerations, 0);
    assert.equal(retrieved.semanticGraph.seed.rawBodyReads, 0);
    assert.equal(retrieved.semanticGraph.performance.additionalWorkspaceScans, 0);
    assert.equal(retrieved.semanticGraph.triggerReceipt.hook, "semantic_graph_recall");
    assert.equal(retrieved.semanticGraph.authority.maySetCurrent, false);
    assert.equal(retrieved.semanticGraph.authority.maySetRecoveryReady, false);
    const semanticEntities = listSemanticMemoryEntities(storeRoot, { projectPath: workspace, limit: 200 });
    const semanticRelations = listSemanticMemoryRelations(storeRoot, { projectPath: workspace, limit: 200 });
    assert.ok(semanticEntities.length > 0 && semanticRelations.length > 0);
    assert.equal(semanticEntities.every((item) => item.status === "active" && item.sourceRefs.length > 0), true);
    assert.equal(semanticRelations.every((item) => item.status === "active" && item.sourceRefs.length > 0), true);
    assert.equal(listSemanticMemoryEntities(storeRoot, { scope: "global", limit: 50 }).length, 0, "verified project retrieval must not seed global graph records");
    assertSafeBounded({ semanticEntities, semanticRelations }, 32 * 1024);
    assertSafeBounded(retrieved, 32 * 1024);
    const prepared = runStrictCli({ ...retrieveRequest, operation: "prepare_takeover" });
    assert.equal(prepared.operation, "prepare_takeover");
    assert.equal(prepared.takeover.shouldInject, true);
    assert.equal(prepared.takeover.injectionMode, "replace_long_thread_context");
    assert.equal(prepared.takeover.maxInjectionsPerTask, 1);
    assert.match(prepared.contextGenerationId, /^context-[a-f0-9]{24}$/);
    assert.equal(prepared.head, baselineHead);
    assert.equal(prepared.scanHash, scan.scanSha256);
    assert.match(prepared.verifiedMemoryStateHash, /^memory-state-[a-f0-9]{24}$/);
    assert.ok(prepared.tokenEstimate <= 3000);
    const repeatedPrepared = runStrictCli({ ...retrieveRequest, operation: "prepare_takeover" });
    assert.equal(repeatedPrepared.contextGenerationId, prepared.contextGenerationId, "unchanged verified state must keep one stable takeover generation");
    const secondRetrieved = runStrictCli(retrieveRequest);
    assert.equal(secondRetrieved.current, true);
    assert.equal(secondRetrieved.recoveryReady, true);
    assert.equal(secondRetrieved.semanticGraph.seed.recordsWritten, 0, "second retrieve must be idempotent");
    assert.ok(secondRetrieved.semanticGraph.seed.recordsUnchanged > 0, "second retrieve must report unchanged semantic records");
    assert.ok(secondRetrieved.semanticGraph.hitCount > 0);
    assert.ok(secondRetrieved.tokenEstimate <= retrieveRequest.tokenBudget);
    const sourceAliasRetrieved = runStrictCli({ ...retrieveRequest, taskGoal: "EXAMPLE_PROJECT 当前引擎架构" });
    assert.ok(sourceAliasRetrieved.semanticGraph.hitCount > 0, "safe source-ref basename aliases must make the EXAMPLE_PROJECT checkpoint useful to a Chinese architecture query");
    assert.ok(sourceAliasRetrieved.semanticGraph.graphPaths.some((graphPath) => JSON.stringify(graphPath).toLowerCase().includes("example_project_current_checkpoint")));
    const noHitRetrieved = runStrictCli({ ...retrieveRequest, taskGoal: "totally unrelated quasar xyzzynotfound" });
    assert.equal(noHitRetrieved.semanticGraph.hitCount, 0, "no semantic match is a valid additive no-hit");
    assert.equal(noHitRetrieved.current, retrieved.current, "a graph no-hit must not change current authority");
    assert.equal(noHitRetrieved.recoveryReady, retrieved.recoveryReady, "a graph no-hit must not change recovery readiness");
    assert.equal(noHitRetrieved.authorityVerification, retrieved.authorityVerification);
    assert.ok(noHitRetrieved.items.length > 0 && noHitRetrieved.tokenEstimate <= retrieveRequest.tokenBudget);
    const skillRetrieved = runSkillInvoker({ operation: "retrieve", workspace, storeRoot, taskGoal: "EXAMPLE_PROJECT current engine checkpoint", queryType: "thread_recovery", limit: 12 });
    assert.equal(skillRetrieved.authorityVerification, "app_owned_verified");
    assert.equal(skillRetrieved.recoveryReady, true);
    assert.ok(skillRetrieved.items.some((item) => item.kind === "accepted_progress"));
    assert.ok(skillRetrieved.semanticGraph.hitCount > 0, "repository Skill invoker packaged-source route must expose automatic semantic graph recall");
    assert.equal(skillRetrieved.semanticGraph.triggerReceipt.hook, "semantic_graph_recall");
    const semanticReceipts = listMemoryRuntimeTriggerReceipts(storeRoot, { projectPath: workspace, hook: "semantic_graph_recall", limit: 20 });
    assert.ok(semanticReceipts.length >= 5, "strict CLI and repository Skill invoker retrievals must persist semantic recall receipts");
    assert.equal(semanticReceipts.every((receipt) => !JSON.stringify(receipt).includes("EXAMPLE_PROJECT current engine checkpoint")), true, "semantic receipts must not store raw task text");
    console.log("EXAMPLE_PROJECT semantic graph retrieve metrics", JSON.stringify({
      durationMs: retrieved.performance.durationMs,
      packetBytes: retrieved.packetBytes,
      tokenEstimate: retrieved.tokenEstimate,
      hits: retrieved.semanticGraph.hitCount,
      seedWritten: retrieved.semanticGraph.seed.recordsWritten,
      secondSeedUnchanged: secondRetrieved.semanticGraph.seed.recordsUnchanged,
    }));

    const evolvedGoalSeed = seedRequest(workspace, storeRoot, scan);
    evolvedGoalSeed.continuity.originalGoal = "Build EXAMPLE_PROJECT as a reliable multi-module game creation system with source-backed recovery.";
    const evolvedGoal = execute(evolvedGoalSeed);
    assert.equal(evolvedGoal.recoveryReady, true, "an explicit exact-scan reseed must supersede the former singleton original goal instead of creating a continuity conflict");
    assert.deepEqual(evolvedGoal.continuity.conflictSlots, []);
    assert.ok(evolvedGoal.writes.some((write) => write.kind === "projectAnchorSupersession"));

    assert.throws(() => execute({
      operation: "write_compatibility",
      workspace,
      storeRoot,
      execute: true,
      expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
      expectedScanSha256: "0".repeat(64),
      taskGoal: "EXAMPLE_PROJECT current engine checkpoint",
    }), /scan_sha256_mismatch/);
    const legacyResume = fs.readFileSync(path.join(workspace, ".codex-knowledge", "project-resume.md"), "utf8");
    const originalRenameSync = fs.renameSync;
    let renameCalls = 0;
    fs.renameSync = (...aexample_project) => {
      renameCalls += 1;
      if (renameCalls === 2) throw new Error("injected_second_output_rename_failure");
      return originalRenameSync(...aexample_project);
    };
    try {
      assert.throws(() => execute({
        operation: "write_compatibility",
        workspace,
        storeRoot,
        execute: true,
        expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
        expectedScanSha256: scan.scanSha256,
        taskGoal: "EXAMPLE_PROJECT current engine checkpoint",
      }), /injected_second_output_rename_failure/);
    } finally {
      fs.renameSync = originalRenameSync;
    }
    assert.equal(fs.readFileSync(path.join(workspace, ".codex-knowledge", "project-resume.md"), "utf8"), legacyResume, "failed refresh must restore the former generated packet");
    assert.equal(fs.existsSync(path.join(workspace, ".codex-knowledge", "retrieval-packet.md")), false, "failed refresh must not leave a newly-created partial packet");
    assert.equal(fs.existsSync(path.join(workspace, ".codex-knowledge", "thread-recovery-packet.json")), false, "failed refresh must not leave later outputs");
    assert.equal(fs.readdirSync(path.join(workspace, ".codex-knowledge")).some((name) => name.includes(".tmp-")), false, "failed refresh must remove temporary files");
    const compatibility = runStrictCli({
      operation: "write_compatibility",
      workspace,
      storeRoot,
      execute: true,
      expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
      expectedScanSha256: scan.scanSha256,
      taskGoal: "EXAMPLE_PROJECT current engine checkpoint",
      limit: 12,
    });
    assert.equal(compatibility.status, "written");
    assert.equal(compatibility.writes.length, 3);
    assert.equal(compatibility.backup.fileCount, 1, "existing oversized compatibility packet must be backed up before replacement");
    const resumeText = fs.readFileSync(path.join(workspace, ".codex-knowledge", "project-resume.md"), "utf8");
    const retrievalText = fs.readFileSync(path.join(workspace, ".codex-knowledge", "retrieval-packet.md"), "utf8");
    const recoveryJson = JSON.parse(fs.readFileSync(path.join(workspace, ".codex-knowledge", "thread-recovery-packet.json"), "utf8"));
    assert.ok(Buffer.byteLength(resumeText, "utf8") <= 16 * 1024);
    assert.ok(Buffer.byteLength(retrievalText, "utf8") <= 16 * 1024);
    assert.equal(recoveryJson.current, true);
    assert.equal(recoveryJson.recoveryReady, true);
    assert.ok(recoveryJson.items.some((item) => item.kind === "accepted_progress"));
    assertSafeBounded({ resumeText, retrievalText, recoveryJson }, 64 * 1024);
    assert.equal(execute({ operation: "verify", workspace, storeRoot }).recoveryReady, true, "generated compatibility writes must not change canonical source authority");

    git(workspace, ["worktree", "add", "-b", "memory-runtime-linked-test", linked, baselineHead]);
    const linkedScan = execute({ operation: "scan", workspace: linked, storeRoot });
    assert.equal(linkedScan.projectIdentity.projectIdentitySha256, scan.projectIdentity.projectIdentitySha256);
    assert.equal(linkedScan.scanSha256, scan.scanSha256, JSON.stringify({
      message: "same HEAD and source hashes must inherit canonical memory across linked worktrees",
      canonical: scan.files.map((file) => [file.relativePath, file.sizeBytes, file.sha256]),
      linked: linkedScan.files.map((file) => [file.relativePath, file.sizeBytes, file.sha256]),
    }));
    const linkedVerify = execute({ operation: "verify", workspace: linked, storeRoot });
    assert.equal(linkedVerify.current, true);
    assert.equal(linkedVerify.recoveryReady, true);

    fs.appendFileSync(path.join(workspace, "src", "current-feature.js"), "export const dirtyPostimage = 2;\n", "utf8");
    const sourcePostimageStale = execute({ operation: "verify", workspace, storeRoot });
    assert.equal(sourcePostimageStale.current, false, "dirty source postimage changes must invalidate the authorized exact scan");
    const sourcePostimageScan = execute({ operation: "scan", workspace, storeRoot });
    assert.notEqual(sourcePostimageScan.scanSha256, scan.scanSha256);
    const sourcePostimage = sourcePostimageScan.workingTree.entries.find((entry) => entry.relativePath === "src/current-feature.js");
    assert.equal(sourcePostimage?.state, "text_postimage");
    assert.match(sourcePostimage?.sha256 || "", /^[a-f0-9]{64}$/);
    assert.equal(sourcePostimageScan.performance.rawSessionBodyRead, false);
    assert.equal(execute(seedRequest(workspace, storeRoot, sourcePostimageScan)).recoveryReady, true);
    const postimageWrite = execute({
      operation: "writeback_evidence",
      workspace,
      storeRoot,
      execute: true,
      expectedProjectIdentitySha256: sourcePostimageScan.projectIdentity.projectIdentitySha256,
      expectedScanSha256: sourcePostimageScan.scanSha256,
      evidence: {
        decision: "accept",
        eventType: "checkpoint",
        moduleId: "example_project-engine-core",
        title: "Dirty source postimage accepted",
        summary: "The bounded source postimage passed exact-scan lifecycle review.",
        acceptedProgress: ["The dirty source postimage is source-backed by its exact hash."],
        latestFailures: ["The previous source postimage did not satisfy the current exact scan."],
        sourceRefs: [{ path: "src/current-feature.js", hash: sourcePostimage.sha256 }],
      },
    });
    assert.equal(postimageWrite.accepted, true, JSON.stringify(postimageWrite));
    assert.equal(postimageWrite.authorityVerification, "app_owned_verified_write");
    assert.equal(postimageWrite.safety.rawSessionBodyRead, false);
    const postimageContinuity = execute({ operation: "verify", workspace, storeRoot }).continuity;
    assert.ok(postimageContinuity.filledSlots.includes("latest_failures"));

    initializeRepo(foreign, "Foreign");
    fs.writeFileSync(path.join(foreign, "docs", "EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md"), "# Foreign checkpoint\n", "utf8");
    commitAll(foreign, "foreign baseline");
    const foreignVerify = execute({ operation: "verify", workspace: foreign, storeRoot });
    assert.equal(foreignVerify.current, false);
    assert.equal(foreignVerify.recoveryReady, false);
    assert.notEqual(foreignVerify.projectIdentity.projectId, scan.projectIdentity.projectId);
    const foreignScan = execute({ operation: "scan", workspace: foreign, storeRoot });
    const foreignSeed = execute(seedRequest(foreign, storeRoot, foreignScan));
    assert.equal(foreignSeed.current, true, JSON.stringify(foreignSeed));
    assert.equal(foreignSeed.recoveryReady, true, "two projects using the same caller moduleId must receive distinct scoped module records");
    assert.equal(foreignSeed.writes.some((write) => write.kind === "moduleMemory" && write.action === "conflict"), false);

    fs.appendFileSync(path.join(workspace, "docs", "EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md"), "Canonical hash changed before commit.\n", "utf8");
    const hashStale = execute({ operation: "verify", workspace, storeRoot });
    assert.equal(hashStale.current, false);
    assert.equal(hashStale.scanBinding.matched, false);
    assert.ok(hashStale.warnings.includes("workspace_head_or_canonical_sources_changed_reseed_required"));

    const hashScan = execute({ operation: "scan", workspace, storeRoot });
    const previousCheckpointId = postimageWrite.writes.find((write) => write.kind === "projectCheckpoint")?.id
      || execute({ operation: "verify", workspace, storeRoot }).scanBinding.authorizedCheckpointId;
    const refreshRequest = {
      operation: "refresh_binding",
      workspace,
      storeRoot,
      execute: true,
      expectedProjectIdentitySha256: hashScan.projectIdentity.projectIdentitySha256,
      expectedScanSha256: hashScan.scanSha256,
      previousCheckpointId,
      acceptedEvidenceReceipt: "qa-accept-current-checkpoint-001",
      acceptedChangedPaths: ["docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md"],
      lane: "example_project-engine-core",
      evidence: {
        decision: "accept",
        eventType: "checkpoint",
        moduleId: "example_project-engine-core",
        title: "Current checkpoint clarification accepted",
        summary: "The changed checkpoint document passed formal QA and may advance the exact binding.",
        projectSummary: "EXAMPLE_PROJECT continues from the accepted checkpoint clarification.",
        phase: "accepted checkpoint clarification",
        acceptedProgress: ["Current checkpoint clarification accepted by formal QA."],
        openTasks: ["Continue the current engine recovery task."],
        nextActions: ["Prepare one clean takeover generation."],
        sourceRefs: [hashScan.sourceRefs.find((ref) => ref.title === "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md")],
      },
    };
    assert.throws(() => execute({ ...refreshRequest, acceptedEvidenceReceipt: "" }), /accepted_evidence_receipt_required/);
    assert.throws(() => execute({ ...refreshRequest, previousCheckpointId: "checkpoint-wrong" }), /previous_checkpoint_mismatch/);
    assert.throws(() => execute({ ...refreshRequest, acceptedChangedPaths: ["src/current-feature.js"] }), /changed_path_not_source_backed/);
    const hashRefresh = execute(refreshRequest);
    assert.equal(hashRefresh.status, "verified", JSON.stringify(hashRefresh));
    assert.equal(hashRefresh.current, true);
    assert.equal(hashRefresh.recoveryReady, true);
    assert.equal(hashRefresh.scanSha256, hashScan.scanSha256);
    assert.equal(hashRefresh.previousCheckpointId, previousCheckpointId);
    assert.notEqual(hashRefresh.authorizedCheckpointId, previousCheckpointId);
    assert.match(hashRefresh.receiptId, /^authority-decision-/);
    assert.match(hashRefresh.contextGenerationId, /^context-[a-f0-9]{24}$/);
    assert.equal(hashRefresh.takeover.shouldInject, true);
    assert.equal(hashRefresh.safety.unacceptedChangeAutoSeeded, false);
    assertSafeBounded(hashRefresh, 16 * 1024);
    const refreshedRecall = execute({ operation: "retrieve", workspace, storeRoot, taskGoal: "current checkpoint clarification", queryType: "thread_recovery", limit: 12, tokenBudget: 3000 });
    const clarifiedItem = refreshedRecall.items.find((item) => /checkpoint clarification accepted/i.test(`${item.title} ${item.summary}`));
    assert.equal(clarifiedItem?.sourceRefs?.[0]?.title, "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md", "refresh binding must preserve the accepted changed file as the item evidence ref");

    const advancedHead = commitAll(workspace, "EXAMPLE_PROJECT handoff clarification");
    assert.notEqual(advancedHead, baselineHead);
    const headStale = execute({ operation: "verify", workspace, storeRoot });
    assert.equal(headStale.current, false, "old authority receipt cannot survive HEAD advancement");
    assert.equal(headStale.recoveryReady, false);
    assert.equal(headStale.scanBinding.matched, false);

    const advancedScan = execute({ operation: "scan", workspace, storeRoot });
    assert.equal(advancedScan.projectIdentity.baselineHead, advancedHead);
    const advancedSeed = execute(seedRequest(workspace, storeRoot, advancedScan));
    assert.equal(advancedSeed.current, true);
    assert.equal(advancedSeed.recoveryReady, true);
    assertSafeBounded(advancedSeed, 16 * 1024);
    const advancedTakeover = runStrictCli({ ...retrieveRequest, operation: "prepare_takeover" });
    assert.equal(advancedTakeover.takeover.shouldInject, true);
    assert.notEqual(advancedTakeover.contextGenerationId, prepared.contextGenerationId, "advanced HEAD and scan binding must create a new takeover generation");

    console.log("EXAMPLE_PROJECT app-owned Memory Runtime recovery integration tests passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
