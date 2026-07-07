const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildMemoryRouterPlan,
  buildActivatedMemoryGraph,
  buildRuntimeItemsFromVolatileMemory,
  buildRuntimeContextPacket,
  buildRuntimePrecedentPacket,
  buildRuntimePrecedentRequest,
  buildThreadRecoveryPacket,
  evaluatePromotionCandidate,
  evaluateWritebackEvidence,
  listFlowSkillCandidateRecords,
  listRuntimeEventRecords,
  listWorkingMemoryRecords,
  normalizeRuntimeEventMemory,
  promoteMemoryCandidate,
  upsertWorkingMemoryRecord,
  writeRuntimeEventMemory,
  writeEvidenceWriteback,
} = require("../electron/memoryRuntimePolicy.cjs");

async function main() {
  const defaultRouterPlan = buildMemoryRouterPlan({
    taskGoal: "修复知匣卡顿和 CPU 内存占用过高",
    tokenBudget: 99999,
    maxResults: 999,
  });
  assert.equal(defaultRouterPlan.taskType, "runtime_diagnosis", "performance/cpu task goals should route to runtime_diagnosis");
  assert.equal(defaultRouterPlan.budgets.tokenBudget, 3000, "MemoryRouter should clamp excessive token budgets");
  assert.equal(defaultRouterPlan.budgets.topK, 12, "MemoryRouter should clamp excessive topK/maxResults");
  assert.equal(defaultRouterPlan.layers.hot.enabled, true, "MemoryRouter should always enable hot state");
  assert.equal(defaultRouterPlan.layers.warm.enabled, true, "MemoryRouter should always enable warm summaries");
  assert.equal(defaultRouterPlan.layers.skill.enabled, true, "MemoryRouter should expose procedural Skill/experience memory");
  assert.equal(defaultRouterPlan.layers.cold.enabled, false, "MemoryRouter should keep cold history disabled by default");
  assert.equal(defaultRouterPlan.rawSessionGate.defaultRead, false, "MemoryRouter must never read raw sessions by default");
  assert.equal(defaultRouterPlan.backgroundPolicy.startsTimers, false, "MemoryRouter must not start background timers");
  assert.equal(defaultRouterPlan.backgroundPolicy.scansFullDatabase, false, "MemoryRouter must not scan the full database");
  assert.equal(defaultRouterPlan.backgroundPolicy.scansVault, false, "MemoryRouter must not scan the vault");

  const recoveryRouterPlan = buildMemoryRouterPlan({
    taskGoal: "恢复被瘦身老线程里的历史",
    threadId: "11111111-2222-7333-8444-555555555555",
    tokenBudget: 1200,
    rawSessionHardGate: true,
    explicitRawSessionRequest: true,
    sourceRange: "guardian pointer only",
  });
  assert.equal(recoveryRouterPlan.taskType, "thread_recovery", "threadId/old-thread goals should route to thread_recovery");
  assert.equal(recoveryRouterPlan.layers.cold.enabled, true, "thread recovery may enable cold pointer retrieval");
  assert.equal(recoveryRouterPlan.layers.cold.rawSessionDefaultRead, false, "cold layer must remain pointer-only by default");
  assert.equal(recoveryRouterPlan.rawSessionGate.defaultRead, false, "explicit recovery gate still must not default-read raw bodies");

  const threadRecoveryPacket = buildThreadRecoveryPacket({
    threadId: "11111111-2222-7333-8444-555555555555",
    title: "Example Project CEO",
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    tokenBudget: 1600,
    contextPacket: {
      cacheKey: "context-cache",
      items: [
        {
          id: "lineage:example-project",
          kind: "thread_lineage_index",
          title: "ThreadLineageIndex: Example Project CEO",
          summary: "Metadata-only lineage for the replacement CEO thread.",
          freshness: "review",
          memoryLayer: "cold",
          whyMatched: ["threadId:exact"],
          sourceRefs: [{ kind: "thread_lineage_index", path: "sqlite://thread_lineage_index/example-project" }],
        },
      ],
    },
    lineageRecords: [
      {
        id: "lineage:example-project",
        ceoThreadId: "11111111-2222-7333-8444-555555555555",
        title: "ThreadLineageIndex: Example Project CEO",
        workspacePaths: ["C:/Users/example/Documents/2D游戏项目"],
        relationships: {
          childThreadIds: ["11111111-2222-7333-8444-555555555555"],
          workerThreadIds: ["11111111-2222-7333-8444-555555555555"],
          reviewerThreadIds: ["11111111-2222-7333-8444-555555555555"],
          vaultPointers: ["codex-history:11111111-2222-7333-8444-555555555555"],
        },
        governance: {
          status: "metadata_only",
          rawSessionPolicy: "metadata_only_no_raw_body",
          mutationPolicy: "read_only_no_archive_compact_restore_delete",
        },
        sourceRefs: [{ kind: "thread_lineage_index", path: "sqlite://thread_lineage_index/example-project" }],
      },
    ],
    vaultManifests: [
      {
        threadId: "11111111-2222-7333-8444-555555555555",
        title: "Example Project CEO",
        projectPath: "C:/Users/example/Documents/2D游戏项目",
        vaultManifestPath: "C:/Users/example/local app data/Roaming/Zhixia/codex-history-vault/019eff6e/latest.json",
        vaultSessionPath: "C:/Users/example/local app data/Roaming/Zhixia/codex-history-vault/019eff6e/session.jsonl",
        originalSha256: "hash-a",
        copiedSha256: "hash-a",
      },
    ],
    projectDocs: [
      { kind: "project_artifact", path: "C:/Users/example/Documents/2D游戏项目/docs/PROGRAM_GOAL_BRIEF.md", title: "Program Goal", sizeBytes: 12000 },
      { kind: "project_artifact", path: "C:/Users/example/Documents/2D游戏项目/docs/EXAMPLE_PROJECT_CEO_TRANSCRIPT_EXTRACT.md", title: "Transcript Extract", sizeBytes: 2 * 1024 * 1024 },
    ],
    coldHistorySources: [
      {
        kind: "raw_session",
        path: "C:/Users/example/.codex/sessions/2026/06/25/rollout-019eff6e.jsonl",
        title: "raw source pointer only",
        threadId: "11111111-2222-7333-8444-555555555555",
      },
    ],
  });
  assert.equal(threadRecoveryPacket.schemaVersion, "zhixia.thread_recovery_packet.v1", "recovery packet should have a stable schema");
  assert.equal(threadRecoveryPacket.thread.confidence, "source_backed", "lineage/vault evidence should make recovery source-backed");
  assert.equal(threadRecoveryPacket.vault.hasVault, true, "recovery packet should expose vault manifest evidence");
  assert.equal(threadRecoveryPacket.vault.policy, "pointer_only_no_default_raw_body_read", "vault recovery must stay pointer-only");
  assert.equal(threadRecoveryPacket.safety.rawSessionDefaultRead, false, "recovery packet must not default-read raw sessions");
  assert.equal(threadRecoveryPacket.safety.archiveCompactDeleteMoveRestore, false, "recovery packet must not authorize archive/compact/delete/move/restore");
  assert.ok(threadRecoveryPacket.prompt.includes("不要直接加载原始"), "recovery prompt should warn new CEO threads not to load giant raw sessions");
  assert.equal(
    threadRecoveryPacket.coldHistorySources.some((source) => source.kind === "raw_session" && source.readByDefault === false),
    true,
    "raw session sources should be pointers with readByDefault=false",
  );
  assert.equal(
    threadRecoveryPacket.recommendedReadOrder.some((source) => /TRANSCRIPT_EXTRACT\.md$/.test(String(source.path || ""))),
    false,
    "giant transcript docs should not be recommended for default reading",
  );
  assert.equal(
    threadRecoveryPacket.coldHistorySources.some((source) => source.kind === "large_project_artifact_pointer" && /TRANSCRIPT_EXTRACT\.md$/.test(String(source.path || ""))),
    true,
    "giant transcript docs should remain available as cold pointers",
  );
  assert.ok(threadRecoveryPacket.warnings.includes("large_recovery_docs_pointer_only"), "giant recovery docs should warn as pointer-only");
  assert.equal(JSON.stringify(threadRecoveryPacket).includes("raw source pointer only"), true, "safe raw pointer titles may appear");
  assert.equal(JSON.stringify(threadRecoveryPacket).includes("raw session body"), false, "recovery packet must not include raw session body text");

  const runtimeEvent = normalizeRuntimeEventMemory({
    eventType: "broken_thread",
    severity: "error",
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    threadId: "11111111-2222-7333-8444-555555555555",
    automationId: "example-ceo-harvest-post-43-wave",
    title: "Example Project CEO 线程断流空转",
    summary: "Example Project CEO 主线程连续 heartbeat 空完成，已暂停心跳，应由干净接管线程恢复。",
    observedSignals: ["systemError", "last_agent_message=null", "15min heartbeat loop", "236k token turn"],
    decisions: ["暂停旧 heartbeat，不再向旧 CEO 主线程派工。"],
    openRisks: ["旧线程仍可能有最后一轮 inProgress 残留。"],
    nextAction: "新建 Example Project CEO Takeover 线程并读取项目短记忆包。",
    sourceRefs: [
      { kind: "automation", path: "C:/Users/example/.codex/automations/example-ceo-harvest-post-43-wave/automation.toml" },
      { kind: "raw_session", path: "C:/Users/example/.codex/sessions/2026/06/25/rollout.jsonl" },
      { kind: "secret", path: "C:/Users/example/Documents/project/.env" },
    ],
  });
  assert.equal(runtimeEvent.status, "blocked", "broken thread events should become blocked working memory");
  assert.equal(runtimeEvent.defaultSourceRefs.length, 1, "runtime events should filter raw/secret refs out of default context");
  assert.equal(runtimeEvent.sourceRefs.length, 1, "runtime events should not retain unsafe refs in stored sourceRefs");
  assert.equal(runtimeEvent.unsafeSourceRefCount, 2, "runtime events should keep only an unsafe ref count");
  assert.ok(runtimeEvent.warnings.includes("unsafe_source_refs_pointer_omitted_from_runtime_event_storage"), "filtered refs should leave a storage warning");
  assert.equal(runtimeEvent.safety.rawSessionBodyRead, false, "runtime event memory must not read raw session bodies");
  assert.equal(runtimeEvent.safety.startsTimers, false, "runtime event memory must not start timers");

  const maxOutputDisconnectedEvent = normalizeRuntimeEventMemory({
    severity: "error",
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    title: "Example Project callback stream disconnected",
    summary: "stream disconnected before completion: Incomplete response returned, reason: max_output_tokens. 正在自动压缩上下文，正在重新连接 5/5。",
    observedSignals: ["max_output_tokens", "reconnecting 5/5"],
  });
  assert.equal(maxOutputDisconnectedEvent.eventType, "broken_thread", "max_output_tokens reconnect loops should infer broken_thread");
  assert.equal(maxOutputDisconnectedEvent.status, "blocked", "inferred broken_thread should become blocked working memory");

  const modelDriftRuleEvent = normalizeRuntimeEventMemory({
    severity: "warning",
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    title: "CEO Flow model policy drift",
    summary: "有线程把 CEO 线程改成 5.3 导致断流；其他 CEO 线程不得修改当前 CEO 推理强度或模型。",
    observedSignals: ["model changed to 5.3", "reasoning strength drift"],
    nextAction: "恢复线程时读取该规则，不要让工作线程修改 CEO 模型或推理强度。",
  });
  assert.equal(modelDriftRuleEvent.eventType, "user_rule_update", "model/reasoning drift should become a user rule memory event");
  assert.equal(modelDriftRuleEvent.status, "active", "user rule updates should stay active hot memory");

  const noVaultRecoveryPacket = buildThreadRecoveryPacket({
    threadId: "missing-vault-thread",
    title: "Missing vault thread",
    projectDocs: [],
    lineageRecords: [],
    vaultManifests: [],
  });
  assert.equal(noVaultRecoveryPacket.vault.hasVault, false, "missing vault should be explicit");
  assert.ok(noVaultRecoveryPacket.warnings.includes("no_thread_history_vault_manifest_matched"), "missing vault should warn");
  assert.ok(noVaultRecoveryPacket.warnings.includes("no_thread_lineage_record_matched"), "missing lineage should warn");

  const invalidKindRouterPlan = buildMemoryRouterPlan({
    taskGoal: "Only raw session should not fall back to broad retrieval",
    allowedKinds: ["raw_session"],
  });
  assert.deepEqual(invalidKindRouterPlan.retrieval.includeKinds, [], "invalid-only allowedKinds should not fall back to profile defaults");
  assert.ok(invalidKindRouterPlan.warnings.includes("no_allowed_runtime_kinds_after_filter"), "invalid-only allowedKinds should carry a warning");

  const retrieveResult = {
    queryType: "task_dispatch",
    query: "implement memory runtime",
    projectPath: "C:/Users/example/Documents/Zhixia-Local-Doc-Knowledge/app",
    parentCeoThreadId: "019e-ceo",
    tokenBudget: 900,
    tokenEstimate: 220,
    generatedAt: "2026-06-19T08:00:00.000Z",
    items: [
      {
        id: "project-record:zhixia",
        kind: "project_record",
        title: "Zhixia Memory Runtime",
        excerpt: "Project state and next action.",
        status: "ready",
        freshness: "fresh",
        whyMatched: ["projectPath:exact"],
        sourceRefs: [{ kind: "project_artifact", path: "docs/TECHNICAL_DESIGN.md", title: "Technical Design" }],
        tokenEstimate: 90,
      },
      {
        id: "raw:bad",
        kind: "raw_session",
        title: "Raw session must not surface",
        excerpt: "raw body",
        sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/raw.jsonl" }],
      },
      {
        id: "experience:raw-backed",
        kind: "experience_card",
        title: "Raw-backed allowed kind must not surface",
        excerpt: "ZHIXIA_RAW_BACKED_ALLOWED_KIND_BODY_SHOULD_NOT_LEAK",
        status: "accepted",
        freshness: "fresh",
        sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/raw-backed.jsonl" }],
        tokenEstimate: 70,
      },
    ],
  };

  const packet = buildRuntimeContextPacket(retrieveResult, {
    taskGoal: "Implement app-side Memory Runtime contract",
    queryType: "task_dispatch",
    tokenBudget: 900,
    allowedKinds: ["project_record", "knowledge_item", "raw_session"],
  });
  assert.equal(packet.schemaVersion, 1, "RuntimeContextPacket schema should be v1");
  assert.equal(packet.request.taskGoal, "Implement app-side Memory Runtime contract");
  assert.deepEqual(packet.request.allowedKinds, ["project_record", "knowledge_item"], "runtime context must reject raw-session allowed kinds");
  assert.equal(packet.routerPlan.strategy, "hot_warm_cold_metadata_first", "runtime context should include MemoryRouter strategy");
  assert.equal(packet.memoryMode, "layered", "runtime context should declare layered memory mode");
  assert.equal(packet.recallPlan.mode, "hot_warm_cold_skill_layered_recall", "runtime context should expose layered recall plan");
  assert.deepEqual(packet.recallPlan.defaultReadOrder, ["hot", "warm", "skill"], "ordinary recall should read hot/warm/skill before cold history");
  assert.equal(packet.recallPlan.coldLayer.defaultRead, false, "cold history must remain pointer-only by default");
  assert.equal(packet.routerPlan.backgroundPolicy.scansFullDatabase, false, "router plan should not request a full database scan");
  assert.equal(packet.performance.noBackgroundTimer, true, "runtime packet should declare no background timer");
  assert.equal(packet.performance.noFullTextRead, true, "runtime packet should declare no full text reads");
  assert.equal(packet.performance.boundedByRouterPlan, true, "runtime packet should declare router-bounded retrieval");
  assert.equal(packet.memoryLayers.hot.count, 1, "project record should seed hot state");
  assert.equal(packet.hotState.project.name, "Zhixia Memory Runtime", "hot state should capture compact project identity");
  assert.ok(packet.memoryGraph.nodes.length > 0, "runtime context should include bounded association graph nodes");
  assert.ok(packet.memoryGraph.edges.length > 0, "runtime context should include bounded source-ref graph edges");
  assert.ok(packet.cacheKey, "runtime context should include stable cache key");
  assert.ok(packet.expiresAt, "runtime context should include expiration hint");
  assert.ok(packet.warnings.includes("memory_router_no_background_scan"), "runtime context should declare no background scan");
  assert.ok(packet.warnings.includes("layered_memory_hot_warm_skill_default_cold_pointer_only"), "runtime context should declare layered cold pointer policy");
  assert.equal(packet.items.length, 1, "runtime context must not surface raw session items");
  assert.equal(JSON.stringify(packet).includes("ZHIXIA_RAW_BACKED_ALLOWED_KIND_BODY_SHOULD_NOT_LEAK"), false, "runtime context must fail closed on raw-backed allowed-kind bodies");

  const runtimeEventStore = await fs.mkdtemp(path.join(os.tmpdir(), "zhixia-runtime-event-memory-"));
  const eventReceipt = await writeRuntimeEventMemory(runtimeEventStore, runtimeEvent);
  assert.equal(eventReceipt.status, "recorded", "runtime event should be recorded");
  assert.equal(eventReceipt.workingMemory.status, "blocked", "runtime event should write blocked working memory");
  assert.equal(eventReceipt.safety.archiveCompactDeleteMoveRestore, false, "runtime event write must not authorize archive/compact/delete");
  const storedRuntimeEvent = JSON.parse(await fs.readFile(eventReceipt.storagePath, "utf8"));
  assert.equal(JSON.stringify(storedRuntimeEvent).includes(".codex/sessions"), false, "stored runtime event must not retain raw session paths");
  assert.equal(JSON.stringify(storedRuntimeEvent).includes(".env"), false, "stored runtime event must not retain secret paths");
  assert.equal(JSON.stringify(storedRuntimeEvent).includes("raw_session"), false, "stored runtime event must not retain raw session sourceRef kind");
  assert.equal(storedRuntimeEvent.unsafeSourceRefCount, 2, "stored runtime event should keep unsafe ref count only");
  const listedEvents = await listRuntimeEventRecords(runtimeEventStore, {
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    threadId: "11111111-2222-7333-8444-555555555555",
  });
  assert.equal(listedEvents.length, 1, "runtime event should be listable by project/thread");
  const listedWorking = await listWorkingMemoryRecords(runtimeEventStore, { status: "blocked" });
  assert.equal(listedWorking.length, 1, "runtime event should create a blocked WorkingMemoryRecord");
  const volatileItems = buildRuntimeItemsFromVolatileMemory({
    events: listedEvents,
    workingMemory: listedWorking,
  });
  const volatilePacket = buildRuntimeContextPacket({
    queryType: "thread_recovery",
    query: "Example Project CEO takeover",
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    items: volatileItems,
  }, {
    taskGoal: "接管 Example Project CEO 坏线程",
    queryType: "thread_recovery",
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    allowedKinds: ["runtime_event", "project_record"],
  });
  assert.equal(volatilePacket.items.some((item) => item.kind === "runtime_event"), true, "runtime events should enter RuntimeContextPacket");
  assert.equal(volatilePacket.memoryLayers.hot.count >= 1, true, "runtime events should be hot memory");
  assert.equal(JSON.stringify(volatilePacket).includes(".codex/sessions"), false, "runtime event context must not leak raw session paths");
  assert.equal(JSON.stringify(volatilePacket).includes(".env"), false, "runtime event context must not leak secret paths");

  const exampleProjectActivatedGraph = buildActivatedMemoryGraph({
    nodes: [
      {
        id: "project:example",
        kind: "project",
        title: "Example Project / 2D游戏项目",
        summary: "边做2D游戏边长出轻量游戏引擎。",
        projectPath: "C:/Users/example/Documents/2D游戏项目",
        tags: ["Example Project", "Example Project", "2D游戏项目"],
        status: "ready",
        freshness: "fresh",
      },
      {
        id: "thread:ceo",
        kind: "thread_lineage_index",
        title: "Example Project CEO",
        summary: "旧CEO主线程，包含Example Project 阶段任务、worker/reviewer分支和恢复入口。",
        projectPath: "C:/Users/example/Documents/2D游戏项目",
        threadId: "11111111-2222-7333-8444-555555555555",
        tags: ["CEO", "Example Project"],
        status: "ready",
        freshness: "review",
      },
      {
        id: "vault:old-thread",
        kind: "knowledge_item",
        title: "老线程历史：2D游戏项目",
        summary: "知匣已保存旧 Codex 线程完整历史到 Thread History Vault。",
        projectPath: "C:/Users/example/Documents/2D游戏项目",
        threadId: "11111111-2222-7333-8444-555555555555",
        tags: ["codex-history", "thread-history-vault"],
        sourceRefs: [{ kind: "thread_history_vault", path: "vault/latest.json", readByDefault: true }],
      },
      {
        id: "experience:scope",
        kind: "experience_card",
        title: "避免先做通用2D引擎",
        summary: "最佳策略是让游戏长出引擎，避免引擎项目无限膨胀。",
        projectPath: "C:/Users/example/Documents/2D游戏项目",
        tags: ["2D游戏", "引擎", "风险"],
        status: "accepted",
        freshness: "fresh",
      },
    ],
    edges: [
      { from: "project:example", to: "thread:ceo", kind: "project_contains", weight: 3 },
      { from: "thread:ceo", to: "vault:old-thread", kind: "thread_evidence", weight: 2.5 },
      { from: "project:example", to: "experience:scope", kind: "project_contains", weight: 2 },
    ],
  }, {
    taskGoal: "继续 Example Project CEO，恢复 Example Project 旧线程记忆",
    projectPath: "C:/Users/example/Documents/2D游戏项目",
    threadId: "11111111-2222-7333-8444-555555555555",
    maxNodes: 8,
  });
  assert.equal(exampleProjectActivatedGraph.mode, "persisted_activation_graph", "activated graph should use the persisted activation mode");
  assert.equal(exampleProjectActivatedGraph.performance.metadataOnly, true, "activated graph should be metadata-only");
  assert.equal(exampleProjectActivatedGraph.performance.rawSessionBodyRead, false, "activated graph must not read raw session bodies");
  assert.equal(exampleProjectActivatedGraph.nodes.some((node) => node.id === "thread:ceo"), true, "Example Project CEO thread should activate");
  assert.equal(exampleProjectActivatedGraph.nodes[0].threadId, "11111111-2222-7333-8444-555555555555", "exact threadId should outrank broad project keyword matches");
  assert.equal(exampleProjectActivatedGraph.nodes.some((node) => node.id === "vault:old-thread"), true, "vault pointer should be pulled in by graph neighbors");
  assert.equal(exampleProjectActivatedGraph.nodes.some((node) => node.id === "experience:scope"), true, "project experience should activate through project relationship");
  assert.ok(exampleProjectActivatedGraph.nodes[0].activation > 0, "activated nodes should carry activation scores");
  assert.ok(exampleProjectActivatedGraph.nodes[0].whyActivated.length > 0, "activated nodes should explain why they were recalled");
  assert.equal(JSON.stringify(packet).includes(".codex/sessions/raw-backed.jsonl"), false, "runtime context must fail closed on raw-backed allowed-kind source refs");
  assert.equal(packet.items[0].rawSessionPolicy, "not_allowed", "runtime items should default to no raw-session reads");
  assert.equal(packet.items[0].memoryLayer, "hot", "project items should be tagged as hot memory");
  assert.equal(packet.sourceRefs.length, 1, "runtime context should collect compact source refs");
  assert.ok(packet.warnings.includes("metadata_first_no_raw_session_body"), "runtime context should declare metadata-first boundary");

  const invalidTimePacket = buildRuntimeContextPacket({ ...retrieveResult, generatedAt: "not-a-date" }, {
    taskGoal: "Invalid generatedAt should not break recall",
    tokenBudget: 900,
  });
  assert.doesNotThrow(() => new Date(invalidTimePacket.expiresAt).toISOString(), "runtime context should tolerate invalid generatedAt values");

  const noAllowedKindsPacket = buildRuntimeContextPacket(retrieveResult, {
    taskGoal: "Only raw session should not retrieve broad defaults",
    allowedKinds: ["raw_session"],
  });
  assert.deepEqual(noAllowedKindsPacket.request.allowedKinds, [], "RuntimeContextPacket should preserve empty allowedKinds after filtering");
  assert.equal(noAllowedKindsPacket.items.length, 0, "RuntimeContextPacket should not return fallback items when allowedKinds are invalid-only");
  assert.equal(noAllowedKindsPacket.partial, true, "empty allowedKinds packet should be marked partial");
  assert.ok(noAllowedKindsPacket.warnings.includes("no_allowed_runtime_kinds_after_filter"), "empty allowedKinds packet should warn");

  const timeBudgetPacket = buildRuntimeContextPacket(retrieveResult, {
    taskGoal: "Time budget exceeded should be visible",
    tokenBudget: 900,
    timeBudgetMs: 50,
    retrievalDurationMs: 75,
  });
  assert.equal(timeBudgetPacket.performance.timeBudgetExceeded, true, "runtime packet should flag time budget exceedance");
  assert.equal(timeBudgetPacket.partial, true, "time budget exceedance should mark the packet partial");
  assert.ok(timeBudgetPacket.warnings.includes("memory_router_time_budget_exceeded_partial"), "time budget exceedance should produce a warning");

  const precedentRequest = buildRuntimePrecedentRequest({
    taskType: "bug repair",
    includeKinds: ["experience_card", "raw_session", "tool_skill_record"],
    tokenBudget: 800,
  });
  assert.equal(precedentRequest.queryType, "retrieve_precedent");
  assert.deepEqual(precedentRequest.includeKinds, ["experience_card", "tool_skill_record"], "precedent retrieval should reject raw-session reads by default");
  assert.equal(precedentRequest.routerPlan.queryType, "retrieve_precedent", "precedent request should include router plan");
  assert.equal(precedentRequest.routerPlan.rawSessionGate.defaultRead, false, "precedent router must not read raw session bodies");

  const invalidPrecedentRequest = buildRuntimePrecedentRequest({
    taskType: "raw only precedent must not broaden",
    includeKinds: ["raw_session"],
  });
  assert.deepEqual(invalidPrecedentRequest.includeKinds, [], "precedent invalid-only includeKinds should not fall back to defaults");
  assert.ok(invalidPrecedentRequest.routerPlan.warnings.includes("no_allowed_runtime_kinds_after_filter"), "precedent invalid-only includeKinds should warn");
  const invalidPrecedentPacket = buildRuntimePrecedentPacket(
    {
      query: invalidPrecedentRequest.query,
      queryType: invalidPrecedentRequest.queryType,
      tokenBudget: invalidPrecedentRequest.tokenBudget,
      tokenEstimate: 0,
      items: [],
      warnings: ["memory_router_no_allowed_runtime_kinds_no_retrieval"],
    },
    {
      taskType: "raw only precedent must not broaden",
      routerPlan: invalidPrecedentRequest.routerPlan,
      allowedKinds: invalidPrecedentRequest.includeKinds,
    },
  );
  assert.deepEqual(invalidPrecedentPacket.request.allowedKinds, [], "precedent no-retrieval packet must not display broad fallback allowedKinds");
  assert.equal(invalidPrecedentPacket.partial, true, "precedent no-retrieval packet should be partial");
  assert.ok(invalidPrecedentPacket.warnings.includes("no_allowed_runtime_kinds_after_filter"), "precedent no-retrieval packet should preserve router warning");

  const precedent = buildRuntimePrecedentPacket(
    {
      ...retrieveResult,
      queryType: "retrieve_precedent",
      items: [
        {
          id: "experience:accepted-fix",
          kind: "experience_card",
          title: "Accepted fix lesson",
          excerpt: "Use metadata-first retrieval.",
          status: "accepted",
          freshness: "fresh",
          whyMatched: ["accepted evidence"],
          sourceRefs: [{ kind: "experience_card", path: "memory/card.json" }],
          tokenEstimate: 70,
        },
      ],
    },
    { taskType: "bug repair", allowedKinds: precedentRequest.includeKinds },
  );
  assert.equal(precedent.precedentPolicy.rawSessionDefaultRead, false, "precedent packet must declare no raw-session default read");
  assert.equal(precedent.precedentPolicy.giantMarkdownDefaultRead, false, "precedent packet must declare no giant Markdown default read");
  assert.equal(precedent.precedentPolicy.memoryRouter, "hot_warm_cold_metadata_first", "precedent packet should expose MemoryRouter strategy");

  const slowPrecedent = buildRuntimePrecedentPacket(
    { ...retrieveResult, queryType: "retrieve_precedent", items: [] },
    {
      taskType: "slow precedent",
      tokenBudget: 800,
      timeBudgetMs: 50,
      retrievalDurationMs: 75,
      allowedKinds: ["experience_card"],
    },
  );
  assert.equal(slowPrecedent.performance.timeBudgetExceeded, true, "precedent packet should flag time budget exceedance");
  assert.equal(slowPrecedent.partial, true, "precedent time budget exceedance should mark packet partial");
  assert.ok(slowPrecedent.warnings.includes("memory_router_time_budget_exceeded_partial"), "precedent time budget exceedance should warn");

  const safeWriteback = {
    decision: "accept",
    task: { id: "TASK-1", goal: "Add contract loop", domain: ["memory-runtime"] },
    evidence: {
      summary: "Implemented compact contract loop.",
      reusablePattern: ["Use pure policy module plus IPC wrapper."],
      sourceRefs: [{ kind: "project_artifact", path: "electron/memoryRuntimePolicy.cjs", title: "policy" }],
    },
    privacy: { containsRawSession: false, containsSecrets: false, publicCandidateAllowed: false },
  };
  const safeEvaluation = evaluateWritebackEvidence(safeWriteback);
  assert.equal(safeEvaluation.status, "queued", "source-backed safe accepted evidence should be queued");
  assert.equal(safeEvaluation.candidates[0].kind, "flowskill_candidate", "accepted reusable evidence should queue FlowSkill candidate metadata only");
  assert.equal(safeEvaluation.candidates[0].status, "private_review", "FlowSkill candidate should stay private review by default");
  assert.equal(safeEvaluation.candidates[0].requiresHumanConfirmation, true, "FlowSkill candidate must require confirmation");
  assert.equal(safeEvaluation.candidates[0].readyPacket.effects.runsFlowSkill, false, "FlowSkill-ready packet must not run FlowSkill");
  assert.equal(safeEvaluation.candidates[0].readyPacket.visibility, "private", "FlowSkill-ready packet must be private");

  const noSourceEvaluation = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-2", goal: "No source" },
    evidence: {
      summary: "Claim without source refs.",
      reusablePattern: ["This reusable pattern is not source-backed."],
    },
    privacy: { containsRawSession: false, containsSecrets: false },
  });
  assert.equal(noSourceEvaluation.status, "candidate_review", "writeback without source refs should downgrade to candidate review");
  assert.equal(noSourceEvaluation.candidates.some((candidate) => candidate.kind === "flowskill_candidate"), false, "no-source reusable evidence must not create FlowSkill-ready candidates");

  const unsafeEvaluation = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-3", goal: "Unsafe" },
    evidence: {
      summary: "Contains raw session body.",
      sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/raw.jsonl" }],
    },
    action: "install skill and archive thread",
    privacy: { containsRawSession: true, containsSecrets: false },
  });
  assert.equal(unsafeEvaluation.status, "rejected", "unsafe writeback should be rejected");
  assert.ok(unsafeEvaluation.safetyBlockers.includes("contains_raw_session"), "raw-session evidence should be a blocker");
  assert.ok(unsafeEvaluation.safetyBlockers.includes("destructive_or_executable_intent"), "install/archive intent should be a blocker");

  const rawSourceRefWithoutPrivacy = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-4", goal: "Raw ref without privacy flags" },
    evidence: {
      summary: "Compact claim with source ref only.",
      sourceRefs: [{ kind: "project_artifact", path: "C:/Users/example/.codex/sessions/2026/06/19/thread-session.jsonl", title: "session JSONL" }],
    },
    privacy: { containsRawSession: false, containsSecrets: false },
  });
  assert.equal(rawSourceRefWithoutPrivacy.status, "rejected", "raw-session sourceRefs should fail closed even when privacy flags are false");
  assert.ok(rawSourceRefWithoutPrivacy.safetyBlockers.includes("contains_raw_session"), "raw-session sourceRef should infer contains_raw_session");

  const secretSourceRefWithoutPrivacy = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-5", goal: "Secret ref without privacy flags" },
    evidence: {
      summary: "Compact claim with secret source ref.",
      sourceRefs: [{ kind: "project_artifact", path: "C:/repo/.env.local", title: "API key settings" }],
    },
  });
  assert.equal(secretSourceRefWithoutPrivacy.status, "rejected", "secret-like sourceRefs should fail closed even when privacy flags are omitted");
  assert.ok(secretSourceRefWithoutPrivacy.safetyBlockers.includes("contains_secrets"), "secret sourceRef should infer contains_secrets");

  const envPathWithHarmlessTitle = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-5B", goal: "Secret env path without privacy flags" },
    evidence: {
      summary: "Compact claim with env path source ref.",
      sourceRefs: [{ kind: "document", path: "C:/repo/.env", title: "env config" }],
    },
    privacy: { containsRawSession: false, containsSecrets: false },
  });
  assert.equal(envPathWithHarmlessTitle.status, "rejected", ".env path sourceRefs should fail closed even when title text follows the path");
  assert.ok(envPathWithHarmlessTitle.safetyBlockers.includes("contains_secrets"), ".env path should infer contains_secrets independent of title text");
  assert.equal(JSON.stringify(envPathWithHarmlessTitle.compact).includes("C:/repo/.env"), false, "unsafe writeback receipts should redact secret sourceRef paths");

  const underscoredDestructiveIntent = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-5C", goal: "Underscored destructive intent" },
    evidence: {
      summary: "Compact claim with explicit source.",
      sourceRefs: [{ kind: "project_artifact", path: "docs/TECHNICAL_DESIGN.md" }],
    },
    requestedEffect: "archive_and_delete_old_thread",
  });
  assert.equal(underscoredDestructiveIntent.status, "rejected", "underscored destructive actions should fail closed");
  assert.ok(underscoredDestructiveIntent.safetyBlockers.includes("destructive_or_executable_intent"), "underscore-separated archive/delete intent should be detected");

  const harmlessSessionProse = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-6", goal: "Harmless prose" },
    evidence: {
      summary: "The release notes mention session history and archive policy as prose.",
      reusablePattern: ["Keep safety checks scoped to source refs and action fields."],
      sourceRefs: [{ kind: "project_artifact", path: "docs/RELEASE_NOTES.md", title: "Release notes" }],
    },
  });
  assert.equal(harmlessSessionProse.status, "queued", "harmless prose mentioning session/archive should not trip raw/destructive blockers");

  const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zhixia-memory-runtime-"));
  try {
    const receipt = await writeEvidenceWriteback(storeRoot, safeWriteback);
    assert.equal(receipt.status, "queued", "writeback should persist queued receipt");
    assert.equal(receipt.candidateCount, 1, "writeback receipt should count candidate metadata");
    assert.equal(receipt.flowSkillCandidateCount, 1, "writeback receipt should count FlowSkill-ready candidates");
    const repeatedReceipt = await writeEvidenceWriteback(storeRoot, safeWriteback);
    assert.equal(repeatedReceipt.id, receipt.id, "repeated same writeback should be idempotent by receipt id");
    assert.equal(repeatedReceipt.hash, receipt.hash, "repeated same writeback should keep stable input hash");
    const written = JSON.parse(await fs.readFile(receipt.storagePath, "utf8"));
    assert.equal(written.policy.installsOrExecutesSkills, false, "writeback storage must preserve no skill execution boundary");
    assert.equal(written.policy.archiveCompactDeleteMoveRestore, false, "writeback storage must preserve no archive/compact boundary");
    const flowSkillCandidates = await listFlowSkillCandidateRecords(storeRoot, { limit: 20 });
    assert.equal(flowSkillCandidates.length, 1, "repeated same writeback should not duplicate FlowSkill candidate records");
    const flowSkillCandidate = flowSkillCandidates[0];
    assert.equal(flowSkillCandidate.kind, "flowskill_candidate", "FlowSkill candidate record should declare kind");
    assert.equal(flowSkillCandidate.status, "private_review", "FlowSkill candidate record must remain private review");
    assert.equal(flowSkillCandidate.promotion.requiresUserConfirmation, true, "FlowSkill candidate record must require confirmation");
    assert.equal(flowSkillCandidate.effects.installsOrExecutes, false, "FlowSkill candidate record must not install or execute");
    assert.equal(flowSkillCandidate.effects.exportsPublicly, false, "FlowSkill candidate record must not export publicly");
    assert.equal(flowSkillCandidate.effects.archiveCompactDeleteMoveRestore, false, "FlowSkill candidate record must not archive/compact/delete/move/restore");
    assert.equal(flowSkillCandidate.effects.mutatesRawSession, false, "FlowSkill candidate record must not mutate raw sessions");
    assert.ok(flowSkillCandidate.hash, "FlowSkill candidate record should have stable hash");
    assert.ok(flowSkillCandidate.tokenEstimate > 0, "FlowSkill candidate record should include token estimate");
    assert.deepEqual(flowSkillCandidate.evidence.reusablePattern, ["Use pure policy module plus IPC wrapper."], "FlowSkill candidate should preserve compact reusable pattern");

    const noSourceReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "accept",
      task: { id: "TASK-NOSOURCE", goal: "No-source reusable evidence", domain: ["memory-runtime"] },
      evidence: {
        summary: "Reusable but not source-backed.",
        reusablePattern: ["Do not create FlowSkill-ready candidate without source refs."],
      },
    });
    assert.equal(noSourceReceipt.status, "candidate_review", "no-source reusable writeback should remain candidate review");
    assert.ok(noSourceReceipt.warnings.includes("missing_source_refs_candidate_only"), "no-source reusable writeback should keep missing source warning");
    assert.equal(noSourceReceipt.flowSkillCandidateCount, 0, "no-source reusable writeback must not create FlowSkill-ready records");
    assert.equal((await listFlowSkillCandidateRecords(storeRoot, { limit: 20 })).length, 1, "no-source reusable writeback should not add FlowSkill-ready records");

    const reviseReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "revise",
      task: { id: "TASK-REVISE", goal: "Revise path", domain: ["memory-runtime"] },
      evidence: {
        summary: "Needs correction.",
        reusablePattern: ["Do not turn revise into FlowSkill."],
        failurePattern: ["Review found missing guardrail."],
        sourceRefs: [{ kind: "project_artifact", path: "tests/review.md", title: "review" }],
      },
    });
    assert.equal(reviseReceipt.flowSkillCandidateCount, 0, "revise writeback must not create FlowSkill-ready candidates by default");
    assert.equal((await listFlowSkillCandidateRecords(storeRoot, { limit: 20 })).length, 1, "revise writeback should not add FlowSkill-ready records");

    const unsafeReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "accept",
      task: { id: "TASK-RAW", goal: "Unsafe raw candidate", domain: ["memory-runtime"] },
      evidence: {
        summary: "Unsafe raw source.",
        reusablePattern: ["Never capture raw session into FlowSkill."],
        sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/2026/06/19/thread.jsonl" }],
      },
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(unsafeReceipt.status, "rejected", "raw-session writeback should reject before FlowSkill candidate creation");
    assert.equal(unsafeReceipt.flowSkillCandidateCount, 0, "raw-session writeback must not create FlowSkill candidate records");

    const destructiveReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "accept",
      task: { id: "TASK-DESTRUCTIVE", goal: "Unsafe destructive request", domain: ["memory-runtime"] },
      evidence: {
        summary: "Unsafe requested effect.",
        reusablePattern: ["Never execute or archive from candidate bridge."],
        sourceRefs: [{ kind: "project_artifact", path: "docs/TECHNICAL_DESIGN.md" }],
      },
      requestedEffect: "install skill then archive thread",
    });
    assert.equal(destructiveReceipt.status, "rejected", "destructive/public execution intent should reject before FlowSkill candidate creation");
    assert.equal(destructiveReceipt.flowSkillCandidateCount, 0, "destructive writeback must not create FlowSkill candidate records");

    const working = await upsertWorkingMemoryRecord(storeRoot, {
      taskId: "TASK-1",
      status: "active",
      currentGoal: "Wire runtime IPC",
      currentEvidence: [{ kind: "project_artifact", path: "electron/main.cjs" }],
      decisions: ["Use JSON app-owned inbox."],
      openRisks: ["UI remains minimal."],
      nextAction: "Run tests.",
    });
    assert.equal(working.status, "active", "working memory upsert should persist active status");
    const listed = await listWorkingMemoryRecords(storeRoot, { status: "active" });
    assert.equal(listed.length, 1, "working memory list should filter by active status");
    const closed = await upsertWorkingMemoryRecord(storeRoot, { ...working, status: "accepted" });
    assert.equal(closed.status, "accepted", "working memory can be closed to accepted");

    const safePromotion = await promoteMemoryCandidate(storeRoot, {
      target: "experience_card",
      title: "Source-backed local lesson",
      summary: "Useful private memory candidate.",
      sourceRefs: [{ kind: "experience_card", path: "memory/card.json" }],
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(safePromotion.status, "queued_candidate", "safe source-backed promotion should queue candidate metadata");
    assert.equal(safePromotion.effects.installsOrExecutes, false, "promotion must not install or execute");

    const unsafePromotion = evaluatePromotionCandidate({
      target: "flowskill_candidate",
      title: "Public export request",
      sourceRefs: [{ kind: "experience_card", path: "memory/card.json" }],
      action: "execute and publish",
      privacy: { publicExportRequested: true, containsRawSession: true },
    });
    assert.equal(unsafePromotion.status, "review", "unsafe promotion should stay in review");
    assert.ok(unsafePromotion.blockers.includes("contains_raw_session"), "promotion should block raw-session candidates");
    assert.ok(unsafePromotion.blockers.includes("public_export_requires_confirmation"), "promotion should block public export automation");
    assert.equal(unsafePromotion.effects.exportsPublicly, false, "promotion must never export publicly in this slice");

    const rawPromotionWithoutPrivacy = evaluatePromotionCandidate({
      target: "experience_card",
      title: "Raw session backed candidate",
      sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/2026/06/19/thread.jsonl" }],
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(rawPromotionWithoutPrivacy.status, "review", "raw-session promotion should stay review even when privacy flags are false");
    assert.ok(rawPromotionWithoutPrivacy.blockers.includes("contains_raw_session"), "promotion should infer raw-session blocker from sourceRefs");

    const secretPromotionWithoutPrivacy = evaluatePromotionCandidate({
      target: "memory_card",
      title: "Credential backed candidate",
      sourceRefs: [{ kind: "project_artifact", path: "C:/repo/credentials.json", title: "credential fixture" }],
      requestedEffect: "promote token evidence",
    });
    assert.equal(secretPromotionWithoutPrivacy.status, "review", "secret promotion should stay review even when privacy flags are omitted");
    assert.ok(secretPromotionWithoutPrivacy.blockers.includes("contains_secrets"), "promotion should infer secret blocker from refs or action fields");

    const envPromotionWithoutPrivacy = evaluatePromotionCandidate({
      target: "memory_card",
      title: "Env backed candidate",
      sourceRefs: [{ kind: "document", path: "C:/repo/.env", title: "env config" }],
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(envPromotionWithoutPrivacy.status, "review", ".env promotion should stay review even when privacy flags are false");
    assert.ok(envPromotionWithoutPrivacy.blockers.includes("contains_secrets"), "promotion should infer .env sourceRef blocker from path alone");
    assert.equal(JSON.stringify(envPromotionWithoutPrivacy).includes("C:/repo/.env"), false, "unsafe promotion candidates should redact secret sourceRef paths");
  } finally {
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("Memory Runtime policy tests passed.");
});
