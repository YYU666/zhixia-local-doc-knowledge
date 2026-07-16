const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { retrieveHybridMemory } = require("../electron/hybridMemoryRetrievalPolicy.cjs");
const { evaluateMemoryBenchmark } = require("../electron/memoryEvaluationPolicy.cjs");
const {
  listMemoryFacts,
  listMemoryRuntimeTriggerReceipts,
  searchMemoryRuntimeIndex,
  upsertMemorySearchItems,
  writeMemoryFactsFromEvidence,
  writeMemoryRuntimeTriggerReceipt,
} = require("../electron/memoryRuntimeIndexStore.cjs");

function sourceRef(id) {
  return [{ kind: "accepted_evidence", path: `memory-runtime://synthetic/${id}`, title: id }];
}

function buildCandidates() {
  return [
    {
      id: "game-anchor-architecture",
      kind: "memory_fact",
      projectPath: "synthetic-game-studio",
      title: "合成游戏工作室长期架构锚点",
      summary: "游戏引擎采用场景优先、模块隔离、编辑器与运行时边界清晰的架构，后续 UI 不得退回展示型页面。",
      tags: ["architecture", "长期设计", "纠偏"],
      status: "accepted",
      freshness: "fresh",
      sourceRefs: sourceRef("architecture"),
      updatedAt: "2026-07-15T08:00:00.000Z",
    },
    {
      id: "game-anchor-ui-freeze",
      kind: "experience_card",
      projectPath: "synthetic-game-studio",
      title: "Codex 窗口假死但后台仍运行",
      summary: "超长 CEO 对话、多线程回收和视觉请求体会造成界面无响应，应写 checkpoint 并使用短接管包，禁止重新读取完整聊天。",
      tags: ["UI freeze", "thread takeover", "卡死"],
      status: "curated",
      freshness: "fresh",
      sourceRefs: sourceRef("ui-freeze"),
      updatedAt: "2026-07-15T09:00:00.000Z",
    },
    {
      id: "game-anchor-deployment",
      kind: "memory_fact",
      projectPath: "synthetic-game-studio",
      title: "部署约束",
      summary: "发布构建必须保留本地优先存储、离线启动和可恢复迁移，不能依赖云端记忆服务。",
      tags: ["deployment", "local-first", "发布"],
      status: "accepted",
      freshness: "fresh",
      sourceRefs: sourceRef("deployment"),
      updatedAt: "2026-07-15T07:00:00.000Z",
    },
    {
      id: "game-anchor-user-rule",
      kind: "memory_fact",
      projectPath: "synthetic-game-studio",
      title: "用户规则：不得修改 CEO 推理强度",
      summary: "任何线程和自动化都不能降低或修改 CEO 的模型推理强度。",
      tags: ["user_rule", "reasoning"],
      status: "accepted",
      freshness: "fresh",
      sourceRefs: sourceRef("user-rule"),
      updatedAt: "2026-07-15T10:00:00.000Z",
    },
    {
      id: "game-stale-ui-direction",
      kind: "memory_fact",
      projectPath: "synthetic-game-studio",
      title: "旧 UI 方向",
      summary: "以营销展示页作为编辑器主界面。",
      tags: ["architecture", "old"],
      status: "superseded",
      freshness: "stale",
      sourceRefs: sourceRef("stale-ui"),
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "other-project-noise",
      kind: "memory_fact",
      projectPath: "synthetic-other",
      title: "其他项目部署说明",
      summary: "与合成游戏项目无关的云端营销站点。",
      status: "accepted",
      freshness: "fresh",
      sourceRefs: sourceRef("other"),
    },
    {
      id: "unsafe-history-body",
      kind: "raw_session",
      projectPath: "synthetic-game-studio",
      title: "raw session body",
      summary: "data:image/png;base64," + "A".repeat(500),
      sourceRefs: [{ kind: "raw_session", path: "C:\\demo\\.codex\\sessions\\session.jsonl" }],
    },
  ];
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-hybrid-lifecycle-"));
  try {
    const candidates = buildCandidates();
    const indexResult = upsertMemorySearchItems(root, candidates);
    assert.equal(indexResult.indexed, 6, "safe same-project and cross-project compact candidates should index");
    assert.equal(indexResult.skipped, 1, "raw/base64 candidate should fail closed");

    const scenarios = [
      { id: "architecture", query: "游戏工作室后续 UI 怎么避免偏离最初的场景架构", expected: "game-anchor-architecture" },
      { id: "freeze", query: "Codex 界面卡死但后台任务还在运行怎么办", expected: "game-anchor-ui-freeze" },
      { id: "deployment", query: "发布部署是否允许依赖云端记忆服务", expected: "game-anchor-deployment" },
      { id: "user-rule", query: "CEO 的模型推理强度能不能被其他线程修改", expected: "game-anchor-user-rule" },
    ];
    const benchmarkCases = scenarios.map((scenario) => {
      const startedAt = Date.now();
      const fts = searchMemoryRuntimeIndex(root, scenario.query, { projectPath: "synthetic-game-studio", limit: 20 });
      const ranked = retrieveHybridMemory([...candidates, ...fts.items], scenario.query, {
        projectPath: "synthetic-game-studio",
        strictProject: true,
        includeGlobal: true,
        topK: 5,
        tokenBudget: 900,
        now: "2026-07-15T12:00:00.000Z",
      });
      assert.equal(ranked.items.some((item) => item.id === "unsafe-history-body"), false);
      assert.equal(ranked.items.some((item) => item.id === "other-project-noise"), false);
      return {
        id: scenario.id,
        project: "synthetic-game-studio",
        queryType: scenario.id === "freeze" ? "bug_repair" : "project_resume",
        query: scenario.query,
        expectedIds: [scenario.expected],
        staleIds: ["game-stale-ui-direction"],
        results: ranked.items,
        latencyMs: Date.now() - startedAt,
        tokenEstimate: ranked.tokenEstimate,
      };
    });
    const evaluation = evaluateMemoryBenchmark(benchmarkCases, {
      k: 5,
      thresholds: {
        minimumCases: 4,
        recallAtK: 1,
        precisionAtK: 0.19,
        mrr: 0.55,
        ndcgAtK: 0.65,
        missingAnchorRate: 0,
        staleHitRate: 0.25,
        p95LatencyMs: 200,
        p95TokenEstimate: 900,
      },
    });
    assert.equal(evaluation.gate.passed, true, evaluation.compactReport);
    assert.equal(evaluation.metrics.recallAtK, 1);
    assert.equal(evaluation.metrics.missingAnchorRate, 0);

    const firstWrite = writeMemoryFactsFromEvidence(root, {
      decision: "accept",
      task: { id: "game-ui-direction-v1", goal: "Game studio UI direction", projectPath: "synthetic-game-studio" },
      evidence: {
        summary: "采用模块化编辑器工作区。",
        memoryFacts: [{ subject: "Game studio UI", predicate: "current_direction", value: "模块化编辑器工作区", factType: "architecture" }],
        sourceRefs: sourceRef("ui-direction-v1"),
      },
    }, { decision: "accept", createdAt: "2026-07-14T12:00:00.000Z" });
    assert.equal(firstWrite.rejected, 0);
    const secondWrite = writeMemoryFactsFromEvidence(root, {
      decision: "accept",
      task: { id: "game-ui-direction-v2", goal: "Game studio UI direction", projectPath: "synthetic-game-studio" },
      evidence: {
        summary: "升级为场景优先的模块化编辑器工作区。",
        memoryFacts: [{ subject: "Game studio UI", predicate: "current_direction", value: "场景优先的模块化编辑器工作区", factType: "architecture" }],
        sourceRefs: sourceRef("ui-direction-v2"),
      },
    }, { decision: "accept", createdAt: "2026-07-15T12:00:00.000Z" });
    assert.equal(secondWrite.actions.some((item) => item.action === "supersede_existing"), true);
    const currentFacts = listMemoryFacts(root, { projectPath: "synthetic-game-studio", view: "current", asOf: "2026-07-16T00:00:00.000Z" });
    assert.equal(currentFacts.some((fact) => fact.value === "场景优先的模块化编辑器工作区"), true);
    assert.equal(currentFacts.some((fact) => fact.value === "模块化编辑器工作区"), false);

    writeMemoryRuntimeTriggerReceipt(root, {
      hook: "retrieve_context",
      queryType: "project_resume",
      projectPath: "synthetic-game-studio",
      returnedCount: 5,
      tokenEstimate: 800,
      durationMs: 40,
      sourceRefs: sourceRef("architecture"),
    });
    assert.equal(listMemoryRuntimeTriggerReceipts(root, { projectPath: "synthetic-game-studio" }).length, 1);
    console.log(`Memory Runtime hybrid lifecycle test passed. ${evaluation.compactReport}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
