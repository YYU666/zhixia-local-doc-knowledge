const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  MEMORY_RUNTIME_BUSY_TIMEOUT_MS,
  indexPath,
  listMemoryRuntimeTriggerReceipts,
  openMemoryRuntimeIndex,
  reconcileMemorySearchItems,
  listMemoryFacts,
  searchMemoryRuntimeIndex,
  tokenizeIndexText,
  upsertMemorySearchItems,
  upsertMemoryFact,
  writeMemoryFactsFromEvidence,
  writeMemoryRuntimeTriggerReceipt,
} = require("../electron/memoryRuntimeIndexStore.cjs");

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-index-"));
  try {
    const tokens = tokenizeIndexText("窗口假死但后台仍在运行 UI freeze");
    assert(tokens.includes("窗口"));
    assert(tokens.includes("freeze"));

    const indexed = upsertMemorySearchItems(root, [
      {
        id: "fact-ui-freeze",
        kind: "memory_fact",
        projectPath: "synthetic-project",
        title: "Codex 界面无响应",
        summary: "窗口假死，但后台任务仍然运行。应切换到短上下文接管流程。",
        tags: ["UI freeze", "thread takeover"],
        status: "current",
        freshness: "fresh",
        sourceRefs: [{ kind: "accepted_evidence", path: "memory-runtime://evidence/ui-freeze" }],
      },
      {
        id: "fact-renderer",
        kind: "memory_fact",
        projectPath: "Other",
        title: "渲染器性能",
        summary: "Renderer profiling notes.",
        sourceRefs: [{ kind: "accepted_evidence", path: "memory-runtime://evidence/renderer" }],
      },
      {
        id: "unsafe-raw",
        kind: "raw_session",
        title: "raw session",
        summary: "should never be indexed",
        sourceRefs: [{ kind: "raw_session", path: "C:\\Users\\demo\\.codex\\sessions\\session.jsonl" }],
      },
    ]);
    assert.equal(indexed.indexed, 2);
    assert.equal(indexed.skipped, 1);

    const repeated = upsertMemorySearchItems(root, [{
      id: "fact-ui-freeze",
      kind: "memory_fact",
      projectPath: "synthetic-project",
      title: "Codex 界面无响应",
      summary: "窗口假死，但后台任务仍然运行。应切换到短上下文接管流程。",
      tags: ["UI freeze", "thread takeover"],
      status: "current",
      freshness: "fresh",
      sourceRefs: [{ kind: "accepted_evidence", path: "memory-runtime://evidence/ui-freeze" }],
    }]);
    assert.equal(repeated.unchanged, 1);

    const chinese = searchMemoryRuntimeIndex(root, "窗口卡死后台还在工作", { projectPath: "synthetic-project", limit: 10 });
    assert.equal(chinese.items[0]?.id, "fact-ui-freeze");
    assert.equal(chinese.items.some((item) => item.id === "unsafe-raw"), false);

    const english = searchMemoryRuntimeIndex(root, "UI freeze takeover", { projectPath: "synthetic-project", limit: 10 });
    assert.equal(english.items[0]?.id, "fact-ui-freeze");

    upsertMemorySearchItems(root, [{
      id: "deleted-project-artifact",
      kind: "project_artifact",
      projectPath: "synthetic-project",
      title: "Old current architecture artifact",
      summary: "This source was removed from the authoritative candidate snapshot.",
      status: "current",
      freshness: "fresh",
      sourceRefs: [{ kind: "document", path: "memory-runtime://documents/deleted-artifact" }],
    }]);
    const reconciliation = reconcileMemorySearchItems(root, [], {
      projectPath: "synthetic-project",
      kinds: ["project_artifact"],
    });
    assert.equal(reconciliation.removed, 1);
    assert.equal(searchMemoryRuntimeIndex(root, "Old current architecture artifact", { projectPath: "synthetic-project" }).items.some((item) => item.id === "deleted-project-artifact"), false, "disappeared authoritative candidates must be removed from FTS");

    const receipt = writeMemoryRuntimeTriggerReceipt(root, {
      hook: "retrieve_context",
      queryType: "project_resume",
      projectPath: "synthetic-project",
      returnedCount: 4,
      tokenEstimate: 720,
      durationMs: 31,
      sourceRefs: [{ kind: "memory_fact", path: "memory-runtime://facts/fact-ui-freeze" }],
    });
    assert.match(receipt.id, /^trigger-/);
    const receipts = listMemoryRuntimeTriggerReceipts(root, { projectPath: "synthetic-project" });
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].hook, "retrieve_context");
    assert.equal(receipts[0].durationMs, 31);

    const firstFact = upsertMemoryFact(root, {
      projectPath: "synthetic-project",
      subject: "UI architecture",
      predicate: "current_direction",
      value: "模块化编辑器工作区",
      factType: "architecture",
      status: "accepted",
      observedAt: "2026-07-14T10:00:00.000Z",
      sourceRefs: [{ kind: "accepted_evidence", path: "memory-runtime://evidence/ui-v1" }],
    });
    assert.equal(firstFact.action, "insert");
    const replacementFact = upsertMemoryFact(root, {
      projectPath: "synthetic-project",
      subject: "UI architecture",
      predicate: "current_direction",
      value: "场景优先的模块化工作区",
      factType: "architecture",
      status: "accepted",
      observedAt: "2026-07-15T10:00:00.000Z",
      sourceRefs: [{ kind: "accepted_evidence", path: "memory-runtime://evidence/ui-v2" }],
    });
    assert.equal(replacementFact.action, "supersede_existing");
    const currentFacts = listMemoryFacts(root, { projectPath: "synthetic-project", view: "current", asOf: "2026-07-16T00:00:00.000Z" });
    assert.equal(currentFacts.some((fact) => fact.value === "场景优先的模块化工作区"), true);
    assert.equal(currentFacts.some((fact) => fact.value === "模块化编辑器工作区"), false);
    const historicalFacts = listMemoryFacts(root, { projectPath: "synthetic-project", view: "superseded" });
    assert.equal(historicalFacts.length, 1);

    const mixedScopeFact = upsertMemoryFact(root, {
      projectPath: "synthetic-project",
      scope: "global",
      subject: "scope invariant",
      predicate: "project masquerade",
      value: "must remain review-only global material",
      factType: "governance",
      status: "accepted",
      observedAt: "2026-07-15T11:00:00.000Z",
      sourceRefs: [{ kind: "review_report", path: "memory-runtime://review/mixed-scope" }],
    });
    assert.equal(mixedScopeFact.fact.status, "review", "global+projectPath writes must fail closed to review");
    assert.equal(mixedScopeFact.fact.scope, "global");
    assert.equal(mixedScopeFact.fact.projectPath, null);
    assert.equal(listMemoryFacts(root, { projectPath: "synthetic-project", view: "current" }).some((fact) => fact.id === mixedScopeFact.fact.id), false);
    assert.equal(listMemoryFacts(root, { scope: "global", view: "review" }).some((fact) => fact.id === mixedScopeFact.fact.id), true);

    const legacyFactId = "legacy-global-project-scope-row";
    const legacyDb = openMemoryRuntimeIndex(root);
    try {
      legacyDb.prepare(`
        INSERT OR REPLACE INTO memory_facts (
          id, projectPath, scope, subject, predicate, valueJson, factType, status,
          confidence, validFrom, validTo, observedAt, sourceRefsJson, supersededBy,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        legacyFactId, "synthetic-project", "global", "legacy scope", "masquerade",
        JSON.stringify("legacy corrupt row"), "governance", "accepted", 1,
        "2026-07-15T11:10:00.000Z", null, "2026-07-15T11:10:00.000Z",
        JSON.stringify([{ kind: "review_report", path: "memory-runtime://review/legacy-scope" }]),
        null, "2026-07-15T11:10:00.000Z", "2026-07-15T11:10:00.000Z",
      );
    } finally {
      legacyDb.close();
    }
    assert.equal(listMemoryFacts(root, { projectPath: "synthetic-project", view: "current" }).some((fact) => fact.id === legacyFactId), false, "project list must exclude legacy global rows with projectPath");
    const legacyGlobalReview = listMemoryFacts(root, { scope: "global", view: "review" });
    assert.equal(legacyGlobalReview.some((fact) => fact.id === legacyFactId), true, "legacy rows should remain truthful global review material");
    assert.equal(legacyGlobalReview.find((fact) => fact.id === legacyFactId)?.projectPath, null);

    upsertMemorySearchItems(root, [{
      id: "legacy-global-project-fts",
      kind: "memory_fact",
      scope: "global",
      projectPath: null,
      title: "global scope masquerade",
      summary: "legacy global scope project masquerade",
      status: "review",
      freshness: "review",
      requiresHumanConfirmation: true,
      sourceRefs: [{ kind: "review_report", path: "memory-runtime://review/legacy-fts" }],
    }]);
    const legacyFtsDb = openMemoryRuntimeIndex(root);
    try {
      legacyFtsDb.prepare(`
        UPDATE memory_search_items
        SET projectPath = ?, scope = 'global', status = 'accepted', freshness = 'fresh', requiresHumanConfirmation = 0
        WHERE id = ?
      `).run("synthetic-project", "legacy-global-project-fts");
    } finally {
      legacyFtsDb.close();
    }
    assert.equal(searchMemoryRuntimeIndex(root, "global scope masquerade", { projectPath: "synthetic-project" }).items.some((item) => item.id === "legacy-global-project-fts"), false, "project FTS search must exclude legacy global masquerade rows");
    const explicitGlobalFts = searchMemoryRuntimeIndex(root, "global scope masquerade", { scope: "global" }).items.find((item) => item.id === "legacy-global-project-fts");
    assert.ok(explicitGlobalFts, "explicit global FTS retrieval should remain available");
    assert.equal(explicitGlobalFts.scope, "global");
    assert.equal(explicitGlobalFts.projectPath, null);
    assert.equal(explicitGlobalFts.status, "review");

    const evidenceFacts = writeMemoryFactsFromEvidence(root, {
      decision: "accept",
      task: { id: "synthetic-ui-review", goal: "完成合成项目 UI 审核", projectPath: "synthetic-project" },
      evidence: {
        summary: "审核确认场景优先工作区方向。",
        reusablePattern: ["先读取长期架构锚点，再开始 UI 修改。"],
        sourceRefs: [{ kind: "review_report", path: "memory-runtime://evidence/synthetic-ui-review" }],
      },
    }, { decision: "accept", createdAt: "2026-07-15T12:00:00.000Z" });
    assert.equal(evidenceFacts.attempted, 2);
    assert.equal(evidenceFacts.rejected, 0);

    const rejectedFact = upsertMemoryFact(root, {
      projectPath: "synthetic-project",
      subject: "unsafe",
      predicate: "raw_pointer",
      value: "raw session",
      status: "accepted",
      sourceRefs: [{ kind: "raw_session", path: "C:\\demo\\.codex\\sessions\\session.jsonl" }],
    });
    assert.equal(rejectedFact.action, "reject");
    assert.equal(listMemoryFacts(root, { projectPath: "synthetic-project" }).some((fact) => fact.id === rejectedFact.fact.id), false, "rejected raw facts must not be persisted in the sidecar");

    const nakedToken = "ghp_1234567890ABCDEFGHIJKLMN";
    const rejectedSecretFact = upsertMemoryFact(root, {
      projectPath: "synthetic-project",
      subject: "unsafe",
      predicate: "credential",
      value: nakedToken,
      status: "accepted",
      sourceRefs: [{ kind: "review_report", path: "memory-runtime://review/credential" }],
    });
    assert.equal(rejectedSecretFact.action, "reject");
    assert.equal(JSON.stringify(rejectedSecretFact.fact).includes(nakedToken), false);

    const structuredUnsafeItems = [
      { id: nakedToken, kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", sourceRefs: [{ kind: "document", path: "memory-runtime://safe/id" }] },
      { id: "unsafe-project", kind: "memory_fact", projectPath: "C:/demo/.codex/sessions/unsafe.jsonl", title: "safe", summary: "safe", sourceRefs: [{ kind: "document", path: "memory-runtime://safe/project" }] },
      { id: "unsafe-status", kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", status: nakedToken, sourceRefs: [{ kind: "document", path: "memory-runtime://safe/status" }] },
      { id: "unsafe-tags", kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", tags: [nakedToken], sourceRefs: [{ kind: "document", path: "memory-runtime://safe/tags" }] },
      { id: "unsafe-ref-kind", kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", sourceRefs: [{ kind: "raw_session", path: "memory-runtime://safe/ref-kind" }] },
      { id: "unsafe-ref-id", kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", sourceRefs: [{ kind: "document", id: nakedToken, path: "memory-runtime://safe/ref-id" }] },
      { id: "unsafe-ref-hash", kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", sourceRefs: [{ kind: "document", hash: nakedToken, path: "memory-runtime://safe/ref-hash" }] },
      { id: "unsafe-giant", kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", body: "giant body sentence ".repeat(900), sourceRefs: [{ kind: "document", path: "memory-runtime://safe/giant" }] },
      { id: "unsafe-object-key", kind: "memory_fact", projectPath: "synthetic-project", title: "safe", summary: "safe", metadata: { ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456: "safe" }, sourceRefs: [{ kind: "document", path: "memory-runtime://safe/object-key" }] },
    ];
    const structuredUnsafeIndexResult = upsertMemorySearchItems(root, structuredUnsafeItems);
    assert.equal(structuredUnsafeIndexResult.indexed, 0, "all structured unsafe search items must fail closed");
    assert.equal(structuredUnsafeIndexResult.skipped, structuredUnsafeItems.length);

    const post120Metadata = {};
    for (let index = 0; index < 130; index += 1) post120Metadata[`safe_${String(index).padStart(3, "0")}`] = "safe";
    post120Metadata.ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 = "safe";
    const post120IndexResult = upsertMemorySearchItems(root, [{
      id: "unsafe-post-120-key",
      kind: "memory_fact",
      projectPath: "synthetic-project",
      title: "safe",
      summary: "safe sibling",
      metadata: post120Metadata,
      sourceRefs: [{ kind: "document", path: "memory-runtime://safe/post-120" }],
    }]);
    assert.equal(post120IndexResult.indexed, 0, "dangerous keys after 120 entries must not reach the index");

    const truncatedMetadata = {};
    for (let index = 0; index < 280; index += 1) truncatedMetadata[`safe_${String(index).padStart(3, "0")}`] = "safe";
    const truncatedIndexResult = upsertMemorySearchItems(root, [{
      id: "unsafe-truncated-structure",
      kind: "memory_fact",
      projectPath: "synthetic-project",
      title: "safe",
      summary: "safe sibling",
      metadata: truncatedMetadata,
      sourceRefs: [{ kind: "document", path: "memory-runtime://safe/truncated" }],
    }]);
    assert.equal(truncatedIndexResult.indexed, 0, "truncated structures must fail closed before indexing");

    const factsBeforeRejectedWriteback = listMemoryFacts(root, { projectPath: "synthetic-project" }).length;
    const rejectedWritebackFacts = writeMemoryFactsFromEvidence(root, {
      decision: "accept",
      task: { id: "rejected-evidence", goal: "unsafe", projectPath: "synthetic-project" },
      evidence: {
        summary: "must not be written",
        sourceRefs: [{ kind: "review_report", path: "memory-runtime://review/rejected" }],
      },
    }, { decision: "accept", status: "rejected", createdAt: "2026-07-15T12:00:00.000Z" });
    assert.equal(rejectedWritebackFacts.attempted, 0);
    assert.equal(listMemoryFacts(root, { projectPath: "synthetic-project" }).length, factsBeforeRejectedWriteback, "rejected writeback must not create facts");

    const unsafeSiblingWritebackFacts = writeMemoryFactsFromEvidence(root, {
      decision: "accept",
      task: { id: "unsafe-sibling", goal: "safe sibling summary", projectPath: "synthetic-project", domain: [nakedToken] },
      evidence: {
        summary: "safe sibling summary must not become accepted",
        memoryFacts: [{ subject: "safe", predicate: "safe", value: "safe", status: "accepted" }],
        sourceRefs: [{ kind: "review_report", path: "memory-runtime://review/unsafe-sibling" }],
      },
    }, { decision: "accept", status: "queued", createdAt: "2026-07-15T12:00:00.000Z" });
    assert.equal(unsafeSiblingWritebackFacts.attempted, 0);
    assert.equal(unsafeSiblingWritebackFacts.rejected, 1);
    assert.equal(listMemoryFacts(root, { projectPath: "synthetic-project" }).length, factsBeforeRejectedWriteback, "unsafe packets must not create accepted facts from safe sibling summaries");

    const dangerousKeyWritebackFacts = writeMemoryFactsFromEvidence(root, {
      decision: "accept",
      task: { id: "dangerous-key-sibling", goal: "safe sibling summary", projectPath: "synthetic-project" },
      evidence: {
        summary: "safe sibling summary must not become accepted",
        memoryFacts: [{ subject: "safe", predicate: "safe", value: { ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456: "safe" }, status: "accepted" }],
        sourceRefs: [{ kind: "review_report", path: "memory-runtime://review/dangerous-key-sibling" }],
      },
    }, { decision: "accept", status: "queued", createdAt: "2026-07-15T12:00:00.000Z" });
    assert.equal(dangerousKeyWritebackFacts.attempted, 0);
    assert.equal(dangerousKeyWritebackFacts.rejected, 1);
    assert.equal(listMemoryFacts(root, { projectPath: "synthetic-project" }).length, factsBeforeRejectedWriteback, "dangerous object keys must not allow safe sibling fact creation");

    const sanitizedReceipt = writeMemoryRuntimeTriggerReceipt(root, {
      hook: "retrieve_context",
      id: nakedToken,
      queryType: "raw_session",
      hash: nakedToken,
      projectPath: `C:/workspace/${nakedToken}`,
      threadId: "raw_session transcript",
      warnings: [`token=${nakedToken}`],
      sourceRefs: [{ kind: "raw_session", path: "C:/demo/.codex/sessions/session.jsonl", extra: nakedToken }],
    });
    assert.equal(sanitizedReceipt.projectPath, null);
    assert.equal(sanitizedReceipt.threadId, null);
    assert.equal(sanitizedReceipt.queryType, null);
    assert.equal(sanitizedReceipt.hook, "unsafe_trigger_receipt");
    assert.equal(sanitizedReceipt.rejected, true);
    assert.equal(sanitizedReceipt.sourceRefs.length, 0);
    assert.equal(JSON.stringify(sanitizedReceipt).includes(nakedToken), false, "trigger receipts must not retain secret values or arbitrary ref fields");

    const keySanitizedReceipt = writeMemoryRuntimeTriggerReceipt(root, {
      hook: "retrieve_context",
      projectPath: "synthetic-project",
      warnings: [{ ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456: "safe" }],
    });
    assert.equal(keySanitizedReceipt.rejected, true, "dangerous receipt object keys must fail closed");
    assert.equal(JSON.stringify(keySanitizedReceipt).includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"), false);

    const lockDb = new DatabaseSync(indexPath(root));
    let upsertLockLatencyMs = 0;
    let receiptLockLatencyMs = 0;
    try {
      lockDb.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
      const upsertStartedAt = Date.now();
      assert.throws(() => upsertMemorySearchItems(root, [{
        id: "lock-test-item",
        kind: "memory_fact",
        projectPath: "synthetic-project",
        title: "lock timing",
        summary: "bounded lock timing",
        status: "accepted",
        freshness: "fresh",
        sourceRefs: [{ kind: "document", path: "memory-runtime://lock/test" }],
      }]), /busy|locked/i, "locked sidecar upserts should fail quickly");
      upsertLockLatencyMs = Date.now() - upsertStartedAt;

      const receiptStartedAt = Date.now();
      assert.throws(() => writeMemoryRuntimeTriggerReceipt(root, {
        hook: "retrieve_context",
        queryType: "project_resume",
        projectPath: "synthetic-project",
      }), /busy|locked/i, "locked trigger receipt writes should fail quickly");
      receiptLockLatencyMs = Date.now() - receiptStartedAt;
    } finally {
      try { lockDb.exec("ROLLBACK"); } catch {}
      lockDb.close();
    }
    assert.equal(MEMORY_RUNTIME_BUSY_TIMEOUT_MS <= 250, true, "busy timeout must stay within the retrieval budget");
    assert.equal(upsertLockLatencyMs < 500, true, `locked upsert should degrade quickly, observed ${upsertLockLatencyMs}ms`);
    assert.equal(receiptLockLatencyMs < 500, true, `locked receipt should degrade quickly, observed ${receiptLockLatencyMs}ms`);
    const postLockReceipt = writeMemoryRuntimeTriggerReceipt(root, { hook: "post_lock_cleanup", projectPath: "synthetic-project" });
    assert.match(postLockReceipt.id, /^trigger-/, "post-lock write should prove failed paths released their handles");
    console.log(`Memory Runtime SQLite lock latency: upsert=${upsertLockLatencyMs}ms receipt=${receiptLockLatencyMs}ms timeout=${MEMORY_RUNTIME_BUSY_TIMEOUT_MS}ms`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("Memory Runtime index store tests passed.");
}

main();
