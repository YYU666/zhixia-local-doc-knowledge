const assert = require("node:assert/strict");

const {
  FIELD_WEIGHTS,
  assessCandidateSafety,
  retrieveHybridMemory,
  tokenizeHybridText,
} = require("../electron/hybridMemoryRetrievalPolicy.cjs");

const NOW = "2026-07-15T12:00:00.000Z";

const chineseResult = retrieveHybridMemory(
  [
    {
      id: "zh-approx",
      kind: "experience_card",
      title: "修复内存占用导致的界面卡顿",
      summary: "启动阶段降低内存峰值并恢复响应速度。",
      tags: ["性能", "故障修复"],
      status: "accepted",
      freshness: "fresh",
      updatedAt: "2026-07-14T12:00:00.000Z",
    },
    {
      id: "zh-unrelated",
      kind: "knowledge_item",
      title: "发布流程检查清单",
      summary: "核对安装包、版本号和商店素材。",
      status: "accepted",
      freshness: "fresh",
      updatedAt: "2026-07-14T12:00:00.000Z",
    },
  ],
  "内存卡顿修复",
  { now: NOW, topK: 2, tokenBudget: 500 },
);

assert.equal(chineseResult.items[0].id, "zh-approx", "Chinese bigrams should recover reordered and approximate compact phrases");
assert.ok(chineseResult.items[0].scoreBreakdown.bm25 > 0, "Chinese fragment matches should contribute explainable BM25 score");
assert.ok(
  chineseResult.items[0].whyMatched.some((reason) => reason.includes("内存") || reason.includes("卡顿") || reason.includes("修复")),
  "Chinese retrieval should explain which character fragments matched",
);
const chineseQueryTerms = tokenizeHybridText("内存卡顿修复").terms;
assert.ok(chineseQueryTerms.some((term) => term.type === "chinese_bigram" && term.display === "内存"), "tokenizer should emit Chinese bigrams");
assert.ok(chineseQueryTerms.some((term) => term.type === "chinese_char"), "tokenizer should emit low-weight character fragments for approximate recall");

const englishResult = retrieveHybridMemory(
  [
    {
      id: "english-title",
      title: "Hybrid memory retrieval ranking",
      summary: "BM25 metadata policy for local runtime candidates.",
      tags: ["search", "ranking"],
      status: "ready",
      freshness: "fresh",
      updatedAt: "2026-07-15T10:00:00.000Z",
    },
    {
      id: "english-summary",
      title: "Runtime notes",
      summary: "Hybrid memory retrieval ranking details.",
      status: "ready",
      freshness: "fresh",
      updatedAt: "2026-07-15T10:00:00.000Z",
    },
    {
      id: "english-unrelated",
      title: "Installer release checklist",
      summary: "Package signing and artifact verification.",
      status: "ready",
      freshness: "fresh",
      updatedAt: "2026-07-15T10:00:00.000Z",
    },
  ],
  "hybrid memory retrieval ranking",
  { now: NOW, topK: 3, tokenBudget: 600 },
);

assert.equal(englishResult.items[0].id, "english-title", "English token matches in title should outrank the same phrase in summary");
assert.ok(FIELD_WEIGHTS.title > FIELD_WEIGHTS.summary, "title field weighting should be stronger than summary weighting");
assert.ok(englishResult.items[0].scoreBreakdown.phrase > 0, "exact compact English phrase should receive an explainable phrase bonus");

const scopedResult = retrieveHybridMemory(
  [
    {
      id: "project-a",
      title: "Memory runtime architecture",
      projectPath: "C:/work/project-a",
      threadId: "thread-a",
      status: "active",
      freshness: "fresh",
    },
    {
      id: "project-b",
      title: "Memory runtime architecture",
      projectPath: "C:/work/project-b",
      threadId: "thread-b",
      status: "active",
      freshness: "fresh",
    },
    {
      id: "global-item",
      title: "Memory runtime architecture",
      status: "active",
      freshness: "fresh",
    },
  ],
  "memory runtime architecture",
  { projectPath: "C:\\work\\project-a\\", threadId: "thread-a", now: NOW, tokenBudget: 600 },
);

assert.deepEqual(scopedResult.items.map((item) => item.id), ["project-a"], "project scope should fail closed against cross-project and unscoped candidates");
assert.equal(scopedResult.items[0].scoreBreakdown.project, 6, "exact project match should be fused into the score");
assert.equal(scopedResult.items[0].scoreBreakdown.thread, 7, "exact thread match should be fused into the score");
assert.ok(scopedResult.items[0].whyMatched.includes("project:exact"), "project match should be explainable");
assert.ok(scopedResult.items[0].whyMatched.includes("thread:exact"), "thread match should be explainable");

const freshnessResult = retrieveHybridMemory(
  [
    {
      id: "fresh",
      title: "Index repair procedure",
      summary: "Repair the local memory index.",
      status: "active",
      freshness: "fresh",
      updatedAt: "2026-07-14T12:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      existingScore: 25,
      graphActivation: 0.8,
    },
    {
      id: "expired",
      title: "Index repair procedure",
      summary: "Repair the local memory index.",
      status: "stale",
      freshness: "stale",
      updatedAt: "2024-01-01T00:00:00.000Z",
      expiresAt: "2025-01-01T00:00:00.000Z",
      existingScore: 25,
      graphActivation: 0.8,
    },
  ],
  "index repair procedure",
  { now: NOW, topK: 2, tokenBudget: 500 },
);

assert.deepEqual(freshnessResult.items.map((item) => item.id), ["fresh", "expired"], "expired and stale metadata should be demoted below fresh metadata");
assert.ok(freshnessResult.items[1].scoreBreakdown.expirationPenalty < 0, "expired candidates should expose an explicit penalty");
assert.ok(freshnessResult.items[0].scoreBreakdown.existingScore > 0, "existing score should be fused as a bounded signal");
assert.ok(freshnessResult.items[0].scoreBreakdown.graphActivation > 0, "graph activation should be fused as a bounded signal");

const unsafeCandidates = [
  { id: "raw-kind", kind: "raw_session", title: "session body" },
  { id: "raw-path", title: "history", sourcePath: "C:/Users/example/.codex/sessions/2026/thread-session.jsonl" },
  { id: "secret", title: "credential", summary: "api_key=sk-super-secret-value-12345" },
  { id: "nested-secret", title: "credential", auth: { password: "hunter2" } },
  { id: "base64", title: "encoded", summary: `data:image/png;base64,${"A".repeat(220)}` },
  { id: "giant", title: "large body", body: "x".repeat(13000) },
  { id: "safe", title: "Safe compact memory", summary: "Metadata only.", tokenEstimate: 40 },
];
const unsafeResult = retrieveHybridMemory(unsafeCandidates, "memory", { now: NOW, topK: 10, tokenBudget: 500 });

assert.deepEqual(unsafeResult.items.map((item) => item.id), ["safe"], "raw sessions, secrets, base64 payloads, and giant bodies must fail closed");
assert.equal(unsafeResult.performance.filteredByReason.raw_session, 2, "raw-session filtering should report deterministic counts");
assert.equal(unsafeResult.performance.filteredByReason.secret_material, 2, "secret filtering should report deterministic counts");
assert.equal(unsafeResult.performance.filteredByReason.base64_payload, 1, "base64 filtering should report deterministic counts");
assert.equal(unsafeResult.performance.filteredByReason.giant_body, 1, "giant-body filtering should report deterministic counts");
assert.equal(assessCandidateSafety({ title: "Bearer abcdefghijklmnop" }).safe, false, "direct safety helper should reject bearer material");

const budgetCandidates = Array.from({ length: 6 }, (_, index) => ({
  id: `budget-${index}`,
  title: "bounded memory result",
  summary: `candidate ${index}`,
  status: "ready",
  freshness: "fresh",
  tokenEstimate: 55,
  updatedAt: `2026-07-15T0${index}:00:00.000Z`,
}));
const budgetResult = retrieveHybridMemory(budgetCandidates, "bounded memory result", {
  now: NOW,
  topK: 2,
  tokenBudget: 100,
});

assert.equal(budgetResult.items.length, 1, "hard token budget should prevent a second 55-token result");
assert.ok(budgetResult.items.length <= 2, "topK should remain a hard result bound");
assert.ok(budgetResult.tokenEstimate <= 100, "reported token estimate should never exceed tokenBudget");
assert.equal(budgetResult.performance.topK, 2, "performance metadata should report the applied topK");
assert.equal(budgetResult.performance.tokenBudget, 100, "performance metadata should report the applied token budget");
assert.equal(budgetResult.performance.startsTimers, false, "policy must not start background timers");
assert.equal(budgetResult.performance.startsWorkers, false, "policy must not start workers");
assert.equal(budgetResult.performance.scansFiles, false, "policy must not scan files");
assert.equal(budgetResult.performance.scansDatabase, false, "policy must not scan a database");
assert.equal(budgetResult.performance.invokesModels, false, "policy must not invoke a model");

const deterministicCandidates = [
  { id: "tie-b", title: "same match", status: "candidate", freshness: "review", tokenEstimate: 20 },
  { id: "tie-a", title: "same match", status: "candidate", freshness: "review", tokenEstimate: 20 },
];
const firstRun = retrieveHybridMemory(deterministicCandidates, "same match", { now: NOW, topK: 2, tokenBudget: 100 });
const secondRun = retrieveHybridMemory(deterministicCandidates, "same match", { now: NOW, topK: 2, tokenBudget: 100 });

assert.deepEqual(firstRun, secondRun, "same inputs should produce byte-stable ranked output and performance metadata");
assert.deepEqual(firstRun.items.map((item) => item.id), ["tie-a", "tie-b"], "score ties should use a deterministic id tie-breaker");

console.log("Hybrid memory retrieval policy behavior tests passed.");
