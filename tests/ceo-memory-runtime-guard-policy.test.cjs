const assert = require("node:assert/strict");

const {
  buildCeoLifecycleWritebackPacket,
  buildCeoTakeoverBootstrapPacket,
  evaluateCeoThreadPressure,
  prepareCeoTakeover,
} = require("../electron/ceoMemoryRuntimeGuardPolicy.cjs");
const { retrievalBudgetEnvelope, nextAdaptiveTokenBudget } = require("../codex-skills/zhixia-local-docs/scripts/memory-context-policy.cjs");

function assertNoUnsafePayload(value, label) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /data:image\/png;base64/i, `${label} must not retain data:image payloads`);
  assert.doesNotMatch(text, /A{120}/, `${label} must not retain long base64-like payloads`);
  assert.doesNotMatch(text, /\.codex[\\/]sessions/i, `${label} must not retain raw session paths by default`);
  assert.doesNotMatch(text, /sk-[A-Za-z0-9]{12,}/, `${label} must not retain secret-like values`);
  assert.doesNotMatch(text, /BEGIN PRIVATE KEY/i, `${label} must not retain private key text`);
}

function main() {
  const critical = evaluateCeoThreadPressure({
    threadId: "019f-example-ceo",
    projectPath: "C:/Users/example/Documents/ExampleProject",
    sessionBytes: 241.56 * 1024 * 1024,
    lineCount: 72370,
    maxLineChars: 325383,
    linesOver100k: 271,
    dataImageHits: 4779,
    base64Hits: 5941,
    imagePathHits: 8406,
    toolOutputLikeHits: 27438,
    visibleThreadCount: 6,
    activeWorkerCount: 3,
    longTitleCount: 5,
  });
  assert.equal(critical.pressureLevel, "unknown", "archive size is not current context");
  assert.equal(critical.action, "advisory_only");
  assert.equal(critical.gates.stopNewDispatch, false);
  assert.equal(critical.gates.takeoverRecommended, false);
  assert.equal(critical.performance.startsTimers, false, "pressure guard must be pure and timer-free");
  assert.equal(critical.performance.readsRawSessionBody, false, "pressure guard must not read raw session bodies");
  assert.equal(critical.performance.archiveCompactDeleteMoveRestore, false, "pressure guard must not authorize archive/compact/delete/move/restore");

  const multiThreadPressure = evaluateCeoThreadPressure({
    sessionBytes: 32 * 1024 * 1024,
    visibleThreadCount: 10,
    activeWorkerCount: 4,
    longTitleCount: 12,
  });
  assert.equal(multiThreadPressure.action, "advisory_only", "workers and titles do not constrain dispatch");
  assert.equal(multiThreadPressure.gates.harvestOnly, false);

  const safe = evaluateCeoThreadPressure({
    sessionBytes: 9 * 1024 * 1024,
    lineCount: 9000,
    maxLineChars: 12000,
    visibleThreadCount: 2,
    activeWorkerCount: 1,
  });
  assert.equal(safe.action, "advisory_only", "small archive must not imply execution permission");
  assert.equal(safe.gates.writebackRequired, false, "small thread should not force writeback");

  for (const metrics of [{}, { sessionBytes: NaN }, { sessionBytes: Infinity }, { sessionBytes: -1 },
    { activeWorkerCount: 4 }, { longTitleCount: 8 }, { visibleThreadCount: 200 },
    { currentPostCompactionContextTokens: 190000, modelContextWindowTokens: 200000 },
    { sessionBytes: 210 * 1024 * 1024, currentPostCompactionContextTokens: 8000 }]) {
    const report = evaluateCeoThreadPressure(metrics);
    assert.equal(report.contextSafe, null);
    assert.equal(report.authority, "none");
    assert.equal(report.hostAssessmentRequired, true);
    assert.equal(report.action, "advisory_only");
    assert.ok(Object.values(report.gates).every((gate) => gate === false));
  }
  assert.equal(evaluateCeoThreadPressure({}).metrics.sessionBytes, null);
  assert.ok(evaluateCeoThreadPressure({}).missingMetrics.includes("sessionBytes"));

  for (const requested of [undefined, 1200, 2200, 3000, 5000, 10000, 50000, NaN, -1]) {
    for (const strictTokenBudget of [true, false]) {
      const input = { tokenBudget: requested, strictTokenBudget };
      const packet = buildCeoTakeoverBootstrapPacket(input);
      const envelope = retrievalBudgetEnvelope(input, "prepare_takeover");
      assert.deepEqual(packet.request.budgetEnvelope, envelope);
      assert.equal(packet.request.tokenBudget, envelope.preferredTokenBudget);
      assert.ok(envelope.maxTokenBudget <= 10000);
      assert.equal(packet.replacementContextAllowed, false);
      if (strictTokenBudget) assert.equal(envelope.maxTokenBudget, envelope.preferredTokenBudget);
    }
  }
  assert.equal(buildCeoTakeoverBootstrapPacket({ tokenBudget: 10000 }).request.tokenBudget, 10000);
  assert.deepEqual([1200, 2200, 3000, 5000, 7500].map((n) => nextAdaptiveTokenBudget(n, 10000)), [2200, 3000, 5000, 7500, 10000]);
  const expectedResult = { current: false, takeover: { shouldInject: false } };
  let calls = 0;
  const routed = prepareCeoTakeover({
    projectPath: "/fixture/project", tokenBudget: 10000, maxTokenBudget: 10000, strictTokenBudget: true,
    operation: "seed", execute: true, storeRoot: "/untrusted", readOnly: false,
  }, { storeRoot: "/app-owned", executeRuntime: (request) => {
    calls += 1;
    assert.equal(request.operation, "prepare_takeover");
    assert.equal(request.storeRoot, "/app-owned");
    assert.equal(request.readOnly, true);
    assert.equal(request.execute, undefined);
    assert.equal(request.tokenBudget, 10000);
    assert.equal(request.strictTokenBudget, true);
    return expectedResult;
  } });
  assert.equal(calls, 1);
  assert.equal(routed, expectedResult, "adapter must return exact Runtime envelope without appending unbudgeted context");
  assert.throws(() => prepareCeoTakeover({}, { executeRuntime: () => assert.fail("must not resolve cwd"), storeRoot: "/fixture" }), /canonical_workspace_required/);

  const unsafePayload = `Accepted UI direction. Screenshot bytes data:image/png;base64,${"A".repeat(260)} and token sk-1234567890abcdef plus C:/Users/example/.codex/sessions/2026/07/raw.jsonl`;
  const writeback = buildCeoLifecycleWritebackPacket({
    stage: "thread_pressure",
    decision: "revise",
    taskId: "CEO-PRESSURE-001",
    goal: unsafePayload,
    summary: unsafePayload,
    projectPath: "C:/Users/example/Documents/ExampleProject",
    threadId: "019f-example-ceo",
    sourceRefs: [
      { kind: "project_artifact", path: "docs/TECHNICAL_DESIGN.md", title: "Design" },
      { kind: "raw_session", path: "C:/Users/example/.codex/sessions/2026/07/raw.jsonl", title: "Raw session" },
      { kind: "secret", path: "C:/Users/example/Documents/ExampleProject/.env", title: "Secret" },
    ],
    threadPressure: critical.metrics,
    nextAction: "Create clean takeover packet before dispatching more work.",
  });
  assert.equal(writeback.mode, "ceo_lifecycle_writeback_packet", "writeback helper should expose a stable mode");
  assert.equal(writeback.evidenceWritebackPacket.privacy.containsRawSession, false, "auto writeback should omit raw-session refs instead of storing them");
  assert.equal(writeback.evidenceWritebackPacket.privacy.containsSecrets, false, "auto writeback should omit secret refs instead of storing them");
  assert.equal(writeback.workingMemoryRecord.status, "active", "revise pressure writeback should stay active working memory");
  assert.equal(writeback.runtimeEvent.eventType, "runtime_diagnosis", "thread pressure should become runtime diagnosis event");
  assert.ok(writeback.warnings.includes("raw_session_source_refs_omitted"), "raw refs should leave an omission warning");
  assert.ok(writeback.warnings.includes("secret_source_refs_omitted"), "secret refs should leave an omission warning");
  assert.equal(writeback.safety.startsTimers, false, "lifecycle writeback must not start timers");
  assert.equal(writeback.safety.scansVault, false, "lifecycle writeback must not scan vault");
  assertNoUnsafePayload(writeback, "CEO lifecycle writeback");

  const takeover = buildCeoTakeoverBootstrapPacket({
    projectName: "Example Project",
    projectPath: "C:/Users/example/Documents/ExampleProject",
    currentCeoThreadId: "019f-example-ceo",
    staleThreadIds: ["019f-old-a", "019f-old-b"],
    projectSummary: "Long-term project anchor: keep engine scope modular and avoid copying raw chat.",
    sourceRefs: [
      { kind: "project_artifact", path: "docs/PRD.md", title: "PRD" },
      { kind: "raw_session", path: "C:/Users/example/.codex/sessions/2026/07/raw.jsonl" },
    ],
    coldHistorySources: [
      { kind: "thread_history_vault", threadId: "019f-old-a", path: "vault://example/019f-old-a/latest.json" },
    ],
    threadPressure: critical.metrics,
  });
  assert.equal(takeover.mode, "ceo_takeover_bootstrap_packet", "takeover packet should expose a stable mode");
  assert.equal(takeover.recallPlan.coldLayer.defaultRead, false, "cold layer should stay pointer-only");
  assert.equal(takeover.safety.rawSessionBodyRead, false, "takeover must not read raw sessions by default");
  assert.equal(takeover.safety.startsTimers, false, "takeover must not start background timers");
  assert.equal(takeover.safety.archiveCompactDeleteMoveRestore, false, "takeover must not authorize archive/compact/delete/move/restore");
  assert.ok(takeover.oneLinePrompt.includes("Hot/Warm/Skill"), "takeover prompt should name the short/warm/skill read order");
  assert.ok(takeover.oneLinePrompt.includes("不默认加载旧线程全文"), "takeover prompt should forbid raw old-thread reads by default");
  assert.equal(takeover.coldHistorySources.every((item) => item.readByDefault === false), true, "cold history pointers must be readByDefault=false");
  assertNoUnsafePayload(takeover, "CEO takeover packet");

  console.log("ceo-memory-runtime-guard-policy tests passed");
}

main();
