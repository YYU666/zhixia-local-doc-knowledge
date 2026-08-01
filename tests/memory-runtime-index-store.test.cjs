const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  MEMORY_RUNTIME_BUSY_TIMEOUT_MS,
  indexPath,
  listSemanticMemoryEntities,
  listSemanticMemoryRelations,
  listMemoryRuntimeTriggerReceipts,
  openMemoryRuntimeIndex,
  reconcileMemorySearchItems,
  listMemoryFacts,
  searchMemoryRuntimeIndex,
  retrieveSemanticGraphPaths,
  tokenizeIndexText,
  upsertMemorySearchItems,
  upsertMemoryFact,
  upsertSemanticGraphRecords,
  writeMemoryFactsFromEvidence,
  writeMemoryRuntimeTriggerReceipt,
} = require("../electron/memoryRuntimeIndexStore.cjs");
const {
  buildSemanticGraphSeedFromRuntimeItems,
  normalizeSemanticEntity,
  normalizeSemanticRelation,
} = require("../electron/semanticMemoryGraphPolicy.cjs");

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

    const graphProjectA = path.join(root, "semantic-project-a");
    const graphProjectB = path.join(root, "semantic-project-b");
    const subsetProject = path.join(root, "semantic-subset-project");
    fs.mkdirSync(path.join(graphProjectA, "docs"), { recursive: true });
    fs.mkdirSync(path.join(graphProjectB, "docs"), { recursive: true });
    fs.mkdirSync(path.join(subsetProject, "docs"), { recursive: true });
    const graphRefA = [{ kind: "canonical_doc", path: "docs/DECISIONS.md", hash: "project-a-decisions" }];
    const graphRefB = [{ kind: "canonical_doc", path: "docs/DECISIONS.md", hash: "project-b-decisions" }];
    function graphEntity(projectPath, input, sourceRefs) {
      const result = normalizeSemanticEntity({
        projectPath,
        status: "active",
        sourceRefs,
        provenance: "human_confirmed",
        ...input,
      });
      assert.equal(result.ok, true, JSON.stringify(result.reasonCodes));
      return result.entity;
    }
    function graphRelation(projectPath, input, sourceRefs, acceptedSourceBackedEvidence = false) {
      const result = normalizeSemanticRelation({
        projectPath,
        status: "active",
        sourceRefs,
        provenance: "explicit",
        ...input,
      }, { acceptedSourceBackedEvidence });
      assert.equal(result.ok, true, JSON.stringify(result.reasonCodes));
      return result.relation;
    }

    const subsetA = buildSemanticGraphSeedFromRuntimeItems([{
      id: "subset-a-example_project-checkpoint",
      kind: "project_artifact",
      projectPath: subsetProject,
      title: "Current engine architecture",
      summary: "Accepted current engine direction",
      status: "active",
      sourceRefs: [{
        kind: "canonical_doc",
        path: "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md",
        updatedAt: "2026-08-01T01:00:00.000Z",
      }],
    }], { projectPath: subsetProject, projectName: "Subset Project" });
    const subsetAWrite = upsertSemanticGraphRecords(root, subsetA, { projectPath: subsetProject });
    assert.equal(subsetAWrite.entitiesWritten, 2);
    assert.equal(subsetAWrite.relationsWritten, 1);
    const persistedProjectAfterA = listSemanticMemoryEntities(root, { projectPath: subsetProject, limit: 20 })
      .find((item) => item.kind === "project");
    assert.equal(persistedProjectAfterA.createdAt, "1970-01-01T00:00:00.000Z");

    const subsetB = buildSemanticGraphSeedFromRuntimeItems([{
      id: "subset-b-rendering",
      kind: "decision",
      projectPath: subsetProject,
      title: "Rendering pipeline decision",
      summary: "Use the accepted modular rendering pipeline",
      status: "active",
      sourceRefs: [{
        kind: "canonical_doc",
        path: "docs/RENDERING.md",
        updatedAt: "2026-08-01T02:00:00.000Z",
      }],
    }], { projectPath: subsetProject, projectName: "Subset Project" });
    const subsetBWrite = upsertSemanticGraphRecords(root, subsetB, { projectPath: subsetProject });
    assert.equal(subsetBWrite.entitiesWritten, 2, "subset B must add its item and update the reused project entity");
    assert.equal(subsetBWrite.relationsWritten, 1);
    const subsetEntities = listSemanticMemoryEntities(root, { projectPath: subsetProject, limit: 20 });
    const subsetRelations = listSemanticMemoryRelations(root, { projectPath: subsetProject, limit: 20 });
    assert.equal(subsetEntities.length, 3, "project plus both subset entities must remain valid and visible");
    assert.equal(subsetRelations.length, 2, "both subset relations must remain connected");
    assert.equal(subsetEntities.find((item) => item.kind === "project").createdAt, persistedProjectAfterA.createdAt, "project createdAt must remain immutable across subsets");
    assert.ok(retrieveSemanticGraphPaths(root, { projectPath: subsetProject, taskGoal: "EXAMPLE_PROJECT 当前引擎架构" }).hitCount > 0, "source-ref basename alias must support the EXAMPLE_PROJECT architecture query");
    assert.ok(retrieveSemanticGraphPaths(root, { projectPath: subsetProject, taskGoal: "rendering pipeline" }).hitCount > 0, "subset B must retain a connected query path");
    const subsetBRepeat = upsertSemanticGraphRecords(root, subsetB, { projectPath: subsetProject });
    assert.equal(subsetBRepeat.entitiesWritten, 0);
    assert.equal(subsetBRepeat.entitiesUnchanged, 2);
    assert.equal(subsetBRepeat.relationsWritten, 0);
    assert.equal(subsetBRepeat.relationsUnchanged, 1);

    const subsetBAtC = buildSemanticGraphSeedFromRuntimeItems([{
      id: "subset-b-rendering",
      kind: "decision",
      projectPath: subsetProject,
      title: "Rendering pipeline decision",
      summary: "Use the accepted modular rendering pipeline",
      status: "active",
      sourceRefs: [{
        kind: "canonical_doc",
        path: "docs/RENDERING.md",
        updatedAt: "2026-08-01T03:00:00.000Z",
      }],
    }], { projectPath: subsetProject, projectName: "Subset Project" });
    const relationCreatedAtBeforeC = listSemanticMemoryRelations(root, { projectPath: subsetProject, limit: 20 })
      .find((item) => item.id === subsetBAtC.relations[0].id).createdAt;
    const subsetBAtCWrite = upsertSemanticGraphRecords(root, subsetBAtC, { projectPath: subsetProject });
    assert.ok(subsetBAtCWrite.persistedCreatedAtPreserved >= 2, "reused item and relation hashes must preserve their persisted creation times");
    const relationAfterC = listSemanticMemoryRelations(root, { projectPath: subsetProject, limit: 20 })
      .find((item) => item.id === subsetBAtC.relations[0].id);
    assert.equal(relationAfterC.createdAt, relationCreatedAtBeforeC);
    const subsetBAtCRepeat = upsertSemanticGraphRecords(root, subsetBAtC, { projectPath: subsetProject });
    assert.equal(subsetBAtCRepeat.entitiesWritten, 0);
    assert.equal(subsetBAtCRepeat.relationsWritten, 0);

    const alternateCreatedAtProject = normalizeSemanticEntity({
      ...subsetBAtC.entities.find((item) => item.kind === "project"),
      createdAt: "2026-08-01T02:00:00.000Z",
    }).entity;
    const corruptDb = openMemoryRuntimeIndex(root);
    try {
      corruptDb.prepare("UPDATE semantic_memory_entities SET contentHash = ? WHERE id = ?")
        .run(alternateCreatedAtProject.contentHash, alternateCreatedAtProject.id);
    } finally {
      corruptDb.close();
    }
    assert.equal(listSemanticMemoryEntities(root, { projectPath: subsetProject, limit: 20 }).some((item) => item.id === alternateCreatedAtProject.id), false, "fixture must reproduce an existing retained-createdAt/hash mismatch");
    const repairedSubset = upsertSemanticGraphRecords(root, subsetBAtC, { projectPath: subsetProject });
    assert.ok(repairedSubset.existingRowsRehashed >= 1, "next bounded upsert must self-heal an already-corrupted hash");
    const repairedProject = listSemanticMemoryEntities(root, { projectPath: subsetProject, limit: 20 })
      .find((item) => item.id === alternateCreatedAtProject.id);
    assert.equal(repairedProject.createdAt, persistedProjectAfterA.createdAt);
    const repairedRepeat = upsertSemanticGraphRecords(root, subsetBAtC, { projectPath: subsetProject });
    assert.equal(repairedRepeat.entitiesWritten, 0, "self-healed subset must return to idempotent upserts");

    const projectEntityA = graphEntity(graphProjectA, { kind: "project", canonicalName: "Editor direction", aliases: ["shared editor alias"] }, graphRefA);
    const currentDecision = graphEntity(graphProjectA, { kind: "decision", canonicalName: "Scene-first modular editor" }, graphRefA);
    const oldDecision = graphEntity(graphProjectA, { kind: "decision", canonicalName: "Marketing-page editor", status: "superseded" }, graphRefA);
    const currentPath = graphRelation(graphProjectA, {
      fromEntityId: projectEntityA.id,
      toEntityId: currentDecision.id,
      predicate: "implemented_by",
    }, graphRefA);
    const oldPath = graphRelation(graphProjectA, {
      fromEntityId: projectEntityA.id,
      toEntityId: oldDecision.id,
      predicate: "implemented_by",
      status: "superseded",
      validTo: "2026-07-31T00:00:00.000Z",
    }, graphRefA);
    const supersedesPath = graphRelation(graphProjectA, {
      fromEntityId: currentDecision.id,
      toEntityId: oldDecision.id,
      predicate: "supersedes",
    }, graphRefA);
    const graphWrite = upsertSemanticGraphRecords(root, {
      entities: [projectEntityA, currentDecision, oldDecision],
      relations: [currentPath, oldPath, supersedesPath],
    }, { projectPath: graphProjectA });
    assert.equal(graphWrite.entitiesWritten, 3);
    assert.equal(graphWrite.relationsWritten, 3);
    assert.equal(graphWrite.rejected, 0);
    const graphRepeat = upsertSemanticGraphRecords(root, {
      entities: [projectEntityA, currentDecision, oldDecision],
      relations: [currentPath, oldPath, supersedesPath],
    }, { projectPath: graphProjectA });
    assert.equal(graphRepeat.entitiesUnchanged, 3, "semantic graph upserts must be idempotent");
    assert.equal(graphRepeat.relationsUnchanged, 3);

    const projectEntityB = graphEntity(graphProjectB, { kind: "project", canonicalName: "Foreign editor", aliases: ["shared editor alias"] }, graphRefB);
    const foreignDecision = graphEntity(graphProjectB, { kind: "decision", canonicalName: "Foreign-only editor decision" }, graphRefB);
    const foreignPath = graphRelation(graphProjectB, {
      fromEntityId: projectEntityB.id,
      toEntityId: foreignDecision.id,
      predicate: "implemented_by",
    }, graphRefB);
    upsertSemanticGraphRecords(root, { entities: [projectEntityB, foreignDecision], relations: [foreignPath] }, { projectPath: graphProjectB });

    const currentGraph = retrieveSemanticGraphPaths(root, {
      projectPath: graphProjectA,
      taskGoal: "What is the current editor direction?",
      maxPaths: 12,
      tokenBudget: 1200,
    });
    assert.equal(currentGraph.attempted, true);
    assert.ok(currentGraph.graphPaths.some((graphPath) => graphPath.to.id === currentDecision.id));
    assert.equal(currentGraph.graphPaths.some((graphPath) => graphPath.to.id === oldDecision.id || graphPath.from.id === oldDecision.id), false, "default recall must exclude superseded endpoints");
    assert.ok(currentGraph.graphPaths.length <= 12);
    assert.ok(currentGraph.tokenEstimate <= 1200);
    assert.equal(currentGraph.performance.oneHop, true);
    assert.ok(currentGraph.performance.entityCandidates <= 96);
    assert.ok(currentGraph.performance.relationCandidates <= 192);
    assert.equal(currentGraph.performance.noRawBodyRead, true);
    assert.equal(currentGraph.performance.noBackgroundRebuild, true);

    const historicalGraph = retrieveSemanticGraphPaths(root, {
      projectPath: graphProjectA,
      taskGoal: "editor direction marketing page",
      queryType: "review_gate",
      maxPaths: 12,
    });
    assert.ok(historicalGraph.graphPaths.some((graphPath) => graphPath.status === "superseded" || graphPath.to.status === "superseded"), "review retrieval must expose superseded decision history");

    const aliasIsolation = retrieveSemanticGraphPaths(root, {
      projectPath: graphProjectA,
      taskGoal: "shared editor alias",
    });
    assert.ok(aliasIsolation.graphPaths.length > 0);
    assert.equal(JSON.stringify(aliasIsolation).includes("Foreign-only editor decision"), false, "same alias in another project must not leak");

    const globalRef = [{ kind: "review_report", uri: "memory-runtime://review/global-semantic", hash: "global-review" }];
    const globalFrom = normalizeSemanticEntity({ scope: "global", kind: "concept", canonicalName: "Global review pattern", status: "review", sourceRefs: globalRef, provenance: "explicit" }).entity;
    const globalTo = normalizeSemanticEntity({ scope: "global", kind: "rule", canonicalName: "Global review destination", status: "review", sourceRefs: globalRef, provenance: "explicit" }).entity;
    const globalRelation = normalizeSemanticRelation({ scope: "global", fromEntityId: globalFrom.id, toEntityId: globalTo.id, predicate: "applies_to", status: "review", sourceRefs: globalRef, provenance: "explicit" }).relation;
    upsertSemanticGraphRecords(root, { entities: [globalFrom, globalTo], relations: [globalRelation] });
    assert.equal(retrieveSemanticGraphPaths(root, { projectPath: graphProjectA, taskGoal: "Global review pattern", queryType: "review_gate" }).hitCount, 0, "global review material must remain opt-in");
    const allowedGlobalReview = retrieveSemanticGraphPaths(root, { projectPath: graphProjectA, taskGoal: "Global review pattern", queryType: "review_gate", allowGlobalReview: true });
    assert.ok(allowedGlobalReview.graphPaths.some((graphPath) => graphPath.id === globalRelation.id));
    assert.equal(allowedGlobalReview.graphPaths.find((graphPath) => graphPath.id === globalRelation.id)?.status, "review", "global evidence must never masquerade as project current memory");

    const unsupportedEvidence = graphRelation(graphProjectA, {
      fromEntityId: currentDecision.id,
      toEntityId: projectEntityA.id,
      predicate: "supports",
    }, graphRefA, true);
    const unsupportedWrite = upsertSemanticGraphRecords(root, {
      entities: [projectEntityA, currentDecision],
      relations: [unsupportedEvidence],
    }, { projectPath: graphProjectA });
    assert.ok(unsupportedWrite.review >= 1, "supports without accepted fact evidence must be forced to review");
    assert.equal(listSemanticMemoryRelations(root, { projectPath: graphProjectA }).find((relation) => relation.id === unsupportedEvidence.id)?.status, "review");

    const acceptedEvidenceFact = upsertMemoryFact(root, {
      projectPath: graphProjectA,
      subject: "Scene-first benchmark",
      predicate: "supports",
      value: "Scene-first modular editor",
      factType: "evidence",
      status: "accepted",
      observedAt: "2026-08-01T10:00:00.000Z",
      sourceRefs: [{ kind: "accepted_evidence", path: "docs/DECISIONS.md", hash: "accepted-benchmark" }],
    });
    const supportedPath = graphRelation(graphProjectA, {
      fromEntityId: projectEntityA.id,
      toEntityId: currentDecision.id,
      predicate: "supports",
      factId: acceptedEvidenceFact.fact.id,
    }, graphRefA, true);
    const supportedWrite = upsertSemanticGraphRecords(root, {
      entities: [projectEntityA, currentDecision],
      relations: [supportedPath],
    }, { projectPath: graphProjectA });
    assert.equal(supportedWrite.rejected, 0);
    assert.equal(listSemanticMemoryRelations(root, { projectPath: graphProjectA }).find((relation) => relation.id === supportedPath.id)?.status, "active");

    const graphifyClaim = upsertMemoryFact(root, {
      projectPath: graphProjectA,
      subject: "70x token saving",
      predicate: "derived_from",
      value: "Graphify video 7668959622917580901",
      factType: "claim",
      status: "candidate",
      confidence: 0.55,
      observedAt: "2026-08-01T11:00:00.000Z",
      sourceRefs: [{ kind: "social_video", uri: "https://www.douyin.com/video/7668959622917580901", hash: "graphify-video" }],
    });
    assert.ok(["candidate", "review"].includes(graphifyClaim.fact.status), "promotional token saving must stay a typed claim, not a current system fact");
    const claimReviewGraph = retrieveSemanticGraphPaths(root, {
      projectPath: graphProjectA,
      taskGoal: "70x token saving Graphify",
      queryType: "review_gate",
    });
    assert.ok(claimReviewGraph.graphPaths.some((graphPath) => graphPath.predicate === "derived_from" && graphPath.status === "review" && graphPath.factId === graphifyClaim.fact.id));
    const claimDefaultGraph = retrieveSemanticGraphPaths(root, { projectPath: graphProjectA, taskGoal: "70x token saving Graphify" });
    assert.equal(claimDefaultGraph.graphPaths.some((graphPath) => graphPath.factId === graphifyClaim.fact.id), false, "review claims must not masquerade as active current paths");

    const entityCountBeforeUnsafe = listSemanticMemoryEntities(root, { projectPath: graphProjectA, limit: 500 }).length;
    const unsafeGraphWrite = upsertSemanticGraphRecords(root, {
      entities: [
        { projectPath: graphProjectA, kind: "document", canonicalName: "raw", status: "active", provenance: "explicit", sourceRefs: [{ kind: "raw_session", path: "C:/demo/.codex/sessions/raw.jsonl" }] },
        { projectPath: graphProjectA, kind: "document", canonicalName: "secret", status: "active", provenance: "explicit", sourceRefs: graphRefA, note: nakedToken },
        { projectPath: graphProjectA, kind: "document", canonicalName: "base64", status: "active", provenance: "explicit", sourceRefs: graphRefA, image: `data:image/png;base64,${"A".repeat(240)}` },
        { projectPath: graphProjectA, kind: "document", canonicalName: "giant", status: "active", provenance: "explicit", sourceRefs: graphRefA, body: "giant log ".repeat(2200) },
      ],
    }, { projectPath: graphProjectA });
    assert.equal(unsafeGraphWrite.entitiesWritten, 0);
    assert.equal(unsafeGraphWrite.rejected, 4);
    assert.equal(listSemanticMemoryEntities(root, { projectPath: graphProjectA, limit: 500 }).length, entityCountBeforeUnsafe, "unsafe semantic fixtures must never persist");

    const noHitGraph = retrieveSemanticGraphPaths(root, { projectPath: graphProjectA, taskGoal: "totally absent semantic sentinel" });
    assert.equal(noHitGraph.hitCount, 0);
    assert.deepEqual(noHitGraph.graphPaths, []);
    assert.ok(noHitGraph.warnings.includes("semantic_graph_no_hit"));
    const semanticReceipt = writeMemoryRuntimeTriggerReceipt(root, {
      hook: "semantic_graph_recall",
      queryType: "task_dispatch",
      projectPath: graphProjectA,
      returnedCount: currentGraph.hitCount,
      tokenEstimate: currentGraph.tokenEstimate,
      durationMs: currentGraph.performance.durationMs,
      partial: currentGraph.partial,
      warnings: currentGraph.warnings,
      sourceRefs: currentGraph.graphPaths.flatMap((graphPath) => graphPath.sourceRefs),
    });
    assert.equal(semanticReceipt.hook, "semantic_graph_recall");
    assert.equal(semanticReceipt.returnedCount, currentGraph.hitCount);
    assert.equal(listMemoryRuntimeTriggerReceipts(root, { hook: "semantic_graph_recall", projectPath: graphProjectA }).length, 1);

    const schemaDb = openMemoryRuntimeIndex(root);
    try {
      const entityColumns = new Set(schemaDb.prepare("PRAGMA table_info(semantic_memory_entities)").all().map((column) => column.name));
      const relationColumns = new Set(schemaDb.prepare("PRAGMA table_info(semantic_memory_relations)").all().map((column) => column.name));
      for (const column of ["projectPath", "projectId", "kind", "canonicalName", "aliasesJson", "status", "sourceRefsJson", "provenance", "confidence", "createdAt", "updatedAt", "contentHash"]) assert.ok(entityColumns.has(column));
      for (const column of ["fromEntityId", "toEntityId", "predicate", "sourceRefsJson", "provenance", "confidence", "status", "validFrom", "validTo", "factId", "createdAt", "updatedAt", "contentHash"]) assert.ok(relationColumns.has(column));
    } finally {
      schemaDb.close();
    }

    const incompatibleRoot = path.join(root, "incompatible-semantic-schema");
    fs.mkdirSync(incompatibleRoot, { recursive: true });
    const incompatibleDb = new DatabaseSync(indexPath(incompatibleRoot));
    incompatibleDb.exec("CREATE TABLE semantic_memory_entities (id INTEGER PRIMARY KEY, canonicalName TEXT)");
    incompatibleDb.close();
    assert.throws(() => upsertSemanticGraphRecords(incompatibleRoot, { entities: [], relations: [] }), /Incompatible semantic memory graph schema/, "incompatible semantic schemas must fail closed without rebuilding");
    const preservedLegacyWrite = upsertMemorySearchItems(incompatibleRoot, [{
      id: "legacy-provider-survives-semantic-failure",
      kind: "project_artifact",
      projectPath: graphProjectA,
      title: "Legacy Hot Warm provider remains available",
      summary: "An incompatible additive semantic schema must not disable existing retrieval.",
      status: "current",
      freshness: "fresh",
      sourceRefs: graphRefA,
    }]);
    assert.equal(preservedLegacyWrite.indexed, 1, "semantic schema failure must remain isolated from legacy sidecar providers");
    const preservedIncompatibleDb = new DatabaseSync(indexPath(incompatibleRoot));
    try {
      const preservedColumns = preservedIncompatibleDb.prepare("PRAGMA table_info(semantic_memory_entities)").all();
      assert.deepEqual(preservedColumns.map((column) => column.name), ["id", "canonicalName"], "failed migration must preserve the incompatible table unchanged");
    } finally {
      preservedIncompatibleDb.close();
    }

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
