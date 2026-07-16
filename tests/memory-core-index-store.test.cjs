const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  MEMORY_CORE_SIDECAR_SCHEMA,
  appendAuthorityReceipt,
  appendProjectCheckpoint,
  getAuthorityReceipt,
  getMemoryConstraint,
  getMemoryDecision,
  getMemoryEpisode,
  getMemoryPrincipal,
  getModuleMemory,
  getProjectAnchor,
  getProjectBinding,
  getProjectBrain,
  getProjectCheckpoint,
  getStandingRule,
  listAuthorityReceipts,
  listMemoryConstraints,
  listMemoryDecisions,
  listMemoryEpisodes,
  listMemoryPrincipals,
  listModuleMemories,
  listProjectAnchors,
  listProjectBindings,
  listProjectBrains,
  listProjectCheckpoints,
  listStandingRules,
  openMemoryRuntimeIndex,
  searchMemoryRuntimeIndex,
  upsertMemoryConstraint,
  upsertMemoryDecision,
  upsertMemoryEpisode,
  upsertMemoryEvent,
  upsertMemoryPrincipal,
  upsertMemorySearchItems,
  upsertModuleMemory,
  upsertProjectAnchor,
  upsertProjectBinding,
  upsertProjectBrain,
  upsertStandingRule,
} = require("../electron/memoryRuntimeIndexStore.cjs");

const TABLES = [
  "memory_principals",
  "memory_project_bindings",
  "memory_standing_rules",
  "memory_authority_receipts",
  "memory_project_brains",
  "memory_project_anchors",
  "memory_modules",
  "memory_episodes",
  "memory_decisions",
  "memory_constraints",
  "memory_project_checkpoints",
];

const REQUIRED_COLUMNS = [
  "id", "projectId", "scopeKey", "status", "type", "updatedAt",
  "validFrom", "validTo", "payloadJson", "contentHash",
];

function sourceRef(id) {
  return [{ kind: "accepted_evidence", id, path: `memory-runtime://evidence/${id}` }];
}

function close(db) {
  if (db) db.close();
}

function createLegacyAuthorityReceiptStore(root, rows) {
  const db = new DatabaseSync(path.join(root, "memory-runtime-index.sqlite"));
  try {
    db.exec("CREATE TABLE memory_authority_receipts (id TEXT PRIMARY KEY, fingerprint TEXT, payloadJson TEXT)");
    const insert = db.prepare("INSERT INTO memory_authority_receipts (id, fingerprint, payloadJson) VALUES (?, ?, ?)");
    for (const row of rows) insert.run(row.id, row.fingerprint, JSON.stringify(row.payload));
  } finally {
    db.close();
  }
}

function openFailure(root) {
  let db = null;
  let error = null;
  try {
    db = openMemoryRuntimeIndex(root);
  } catch (caught) {
    error = caught;
  } finally {
    close(db);
  }
  return error;
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-core-index-"));
  const markerPath = path.join(root, "do-not-delete.txt");
  fs.writeFileSync(markerPath, "sentinel", "utf8");
  const migrationStartedAt = Date.now();
  try {
    const legacyDb = new DatabaseSync(path.join(root, "memory-runtime-index.sqlite"));
    try {
      legacyDb.exec("CREATE TABLE memory_decisions (id TEXT PRIMARY KEY, payloadJson TEXT)");
    } finally {
      legacyDb.close();
    }
    for (let run = 0; run < 3; run += 1) close(openMemoryRuntimeIndex(root));
    const migrationMs = Date.now() - migrationStartedAt;

    const schemaDb = openMemoryRuntimeIndex(root);
    try {
      const tableNames = new Set(schemaDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      for (const table of TABLES) {
        assert.equal(tableNames.has(table), true, `${table} must be created idempotently`);
        const columns = new Set(schemaDb.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
        for (const column of REQUIRED_COLUMNS) assert.equal(columns.has(column), true, `${table}.${column} must exist`);
        const indexes = schemaDb.prepare(`PRAGMA index_list(${table})`).all();
        assert.equal(indexes.length >= 4, true, `${table} must have bounded query indexes`);
      }
      const receiptIndexes = schemaDb.prepare("PRAGMA index_list(memory_authority_receipts)").all();
      assert.equal(receiptIndexes.some((index) => index.name === "uidx_memory_authority_receipts_exact_receipt_proof" && Number(index.unique) === 1), true);
    } finally {
      schemaDb.close();
    }

    const incompatibleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-core-incompatible-"));
    const incompatibleMarker = path.join(incompatibleRoot, "preserve.txt");
    fs.writeFileSync(incompatibleMarker, "preserve", "utf8");
    try {
      const incompatibleDb = new DatabaseSync(path.join(incompatibleRoot, "memory-runtime-index.sqlite"));
      try {
        incompatibleDb.exec("CREATE TABLE memory_principals (id TEXT, payloadJson TEXT)");
      } finally {
        incompatibleDb.close();
      }
      const incompatibleError = openFailure(incompatibleRoot);
      assert.equal(incompatibleError?.code, "MEMORY_CORE_INCOMPATIBLE_SCHEMA");
      assert.match(incompatibleError.message, /sole TEXT primary key/);
      assert.equal(fs.readFileSync(incompatibleMarker, "utf8"), "preserve");
    } finally {
      fs.rmSync(incompatibleRoot, { recursive: true, force: true });
    }

    const legacyReceiptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-core-legacy-receipt-"));
    try {
      createLegacyAuthorityReceiptStore(legacyReceiptRoot, [
        {
          id: "legacy-receipt-a",
          fingerprint: "legacy-logical-decision-a",
          payload: {
            receiptId: "legacy-receipt-a",
            decisionId: "legacy-receipt-a",
            decisionFingerprint: "legacy-logical-decision-a",
            receiptProof: "legacy-exact-proof-a",
            status: "accepted",
            createdAt: "2026-07-15T00:00:00.000Z",
          },
        },
        {
          id: "legacy-receipt-b",
          fingerprint: null,
          payload: {
            receiptId: "legacy-receipt-b",
            decisionId: "legacy-receipt-b",
            decisionFingerprint: "legacy-logical-decision-b",
            proof: "legacy-exact-proof-b",
            status: "accepted",
            createdAt: "2026-07-15T00:00:01.000Z",
          },
        },
      ]);
      const migratedReceiptDb = openMemoryRuntimeIndex(legacyReceiptRoot);
      try {
        const migrated = migratedReceiptDb.prepare("SELECT fingerprint, payloadJson FROM memory_authority_receipts WHERE id = ?").get("legacy-receipt-a");
        assert.equal(migrated.fingerprint, "legacy-exact-proof-a");
        assert.equal(JSON.parse(migrated.payloadJson).decisionFingerprint, "legacy-logical-decision-a", "logical decision fingerprint must remain in payloadJson");
        assert.equal(migratedReceiptDb.prepare("SELECT fingerprint FROM memory_authority_receipts WHERE id = ?").get("legacy-receipt-b").fingerprint, "legacy-exact-proof-b");
      } finally {
        migratedReceiptDb.close();
      }
      assert.throws(() => appendAuthorityReceipt(legacyReceiptRoot, {
        receiptId: "legacy-receipt-replay",
        decisionId: "legacy-receipt-replay",
        decisionFingerprint: "different-logical-decision",
        receiptProof: "legacy-exact-proof-a",
        status: "accepted",
        createdAt: "2026-07-16T00:00:00.000Z",
      }), (error) => error.code === "MEMORY_CORE_REPLAY_COLLISION");
    } finally {
      fs.rmSync(legacyReceiptRoot, { recursive: true, force: true });
    }

    const duplicateLegacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-core-duplicate-receipt-"));
    try {
      createLegacyAuthorityReceiptStore(duplicateLegacyRoot, [
        {
          id: "legacy-duplicate-a",
          fingerprint: "legacy-logical-a",
          payload: { receiptId: "legacy-duplicate-a", decisionFingerprint: "legacy-logical-a", receiptProof: "duplicate-exact-proof" },
        },
        {
          id: "legacy-duplicate-b",
          fingerprint: "legacy-logical-b",
          payload: { receiptId: "legacy-duplicate-b", decisionFingerprint: "legacy-logical-b", receiptProof: "duplicate-exact-proof" },
        },
      ]);
      const duplicateError = openFailure(duplicateLegacyRoot);
      assert.equal(duplicateError?.code, "MEMORY_CORE_INCOMPATIBLE_SCHEMA");
      assert.match(duplicateError.message, /duplicate exact authority receipt proof/);
      const duplicateDb = new DatabaseSync(path.join(duplicateLegacyRoot, "memory-runtime-index.sqlite"));
      try {
        const fingerprints = duplicateDb.prepare("SELECT id, fingerprint FROM memory_authority_receipts ORDER BY id").all();
        assert.deepEqual(fingerprints.map((row) => row.fingerprint), ["legacy-logical-a", "legacy-logical-b"], "duplicate migration must roll back without partial backfill");
        assert.equal(duplicateDb.prepare("PRAGMA index_list(memory_authority_receipts)").all().some((index) => index.name === "uidx_memory_authority_receipts_exact_receipt_proof"), false);
      } finally {
        duplicateDb.close();
      }
    } finally {
      fs.rmSync(duplicateLegacyRoot, { recursive: true, force: true });
    }

    const compatibilitySearchRow = {
      id: "legacy-compatible-search-row",
      kind: "project_artifact",
      projectPath: "project-a",
      title: "Legacy compatibility sentinel",
      summary: "Must survive Memory Core schema reruns.",
      sourceRefs: sourceRef("legacy-compatible-search-row"),
    };
    upsertMemorySearchItems(root, [compatibilitySearchRow]);
    const missingFtsDb = openMemoryRuntimeIndex(root);
    try {
      missingFtsDb.prepare("DELETE FROM memory_search_fts WHERE id = ?").run(compatibilitySearchRow.id);
    } finally {
      missingFtsDb.close();
    }
    assert.equal(searchMemoryRuntimeIndex(root, "Legacy compatibility sentinel", { projectPath: "project-a" }).items.length, 0);
    const repairedSearch = upsertMemorySearchItems(root, [compatibilitySearchRow]);
    assert.equal(repairedSearch.repaired, 1);
    assert.equal(searchMemoryRuntimeIndex(root, "Legacy compatibility sentinel", { projectPath: "project-a" }).items.some((row) => row.id === compatibilitySearchRow.id), true);

    const principal = {
      principalId: "principal-owner",
      principalType: "user",
      role: "owner",
      ownerId: "principal-owner",
      scopeKey: "private:principal-owner",
      status: "active",
      capabilities: ["memory.read", "memory.approve"],
      sourceRefs: sourceRef("principal-owner"),
      updatedAt: "2026-07-16T01:00:00.000Z",
    };
    assert.equal(upsertMemoryPrincipal(root, principal).action, "insert");
    assert.equal(upsertMemoryPrincipal(root, principal).action, "noop");

    assert.equal(upsertProjectBinding(root, {
      bindingId: "binding-project-a",
      projectId: "project-a",
      projectPath: "c:/projects/a",
      status: "active",
      sourceRefs: sourceRef("binding-project-a"),
      validFrom: "2026-07-16T01:00:00.000Z",
      updatedAt: "2026-07-16T01:00:00.000Z",
    }).action, "insert");
    assert.equal(upsertStandingRule(root, {
      ruleId: "rule-project-a",
      ownerId: "principal-owner",
      projectId: "project-a",
      scopeKey: "project:project-a",
      statement: "Preserve accepted architecture anchors.",
      status: "accepted",
      sourceRefs: sourceRef("rule-project-a"),
      updatedAt: "2026-07-16T01:01:00.000Z",
    }).action, "insert");
    assert.equal(upsertProjectBrain(root, {
      projectId: "project-a",
      canonicalPath: "c:/projects/a",
      productSummary: "Project A",
      authorityStatus: "accepted",
      authoritative: true,
      sourceRefs: sourceRef("project-a"),
      updatedAt: "2026-07-16T01:02:00.000Z",
    }).action, "insert");
    assert.equal(upsertModuleMemory(root, {
      moduleId: "module-a",
      projectId: "project-a",
      name: "Memory Core",
      authorityStatus: "accepted",
      authoritative: true,
      sourceRefs: sourceRef("module-a"),
      updatedAt: "2026-07-16T01:03:00.000Z",
    }).action, "insert");

    const gatedCurrentRecords = [
      upsertMemoryPrincipal(root, {
        principalId: "principal-unscoped",
        status: "active",
        sourceRefs: sourceRef("principal-unscoped"),
        updatedAt: "2026-07-16T01:03:10.000Z",
      }),
      upsertProjectBinding(root, {
        bindingId: "binding-sourceless",
        projectId: "project-a",
        status: "active",
        updatedAt: "2026-07-16T01:03:11.000Z",
      }),
      upsertStandingRule(root, {
        ruleId: "rule-sourceless",
        projectId: "project-a",
        scopeKey: "project:project-a",
        statement: "Unverified standing rule",
        status: "accepted",
        updatedAt: "2026-07-16T01:03:12.000Z",
      }),
      upsertProjectBrain(root, {
        projectId: "project-review",
        authorityStatus: "accepted",
        updatedAt: "2026-07-16T01:03:13.000Z",
      }),
      upsertProjectAnchor(root, {
        anchorId: "anchor-sourceless",
        projectId: "project-a",
        category: "architecture_principle",
        authorityStatus: "accepted",
        updatedAt: "2026-07-16T01:03:14.000Z",
      }),
      upsertModuleMemory(root, {
        moduleId: "module-sourceless",
        projectId: "project-a",
        authorityStatus: "accepted",
        updatedAt: "2026-07-16T01:03:15.000Z",
      }),
    ];
    for (const result of gatedCurrentRecords) {
      assert.equal(result.action, "insert");
      assert.equal(result.record.status, "review");
      assert.equal(result.record.authoritative, false);
    }
    assert.equal(listMemoryPrincipals(root).some((row) => row.id === "principal-unscoped"), false);

    const anchorV1 = {
      anchorId: "anchor-a",
      projectId: "project-a",
      category: "architecture_principle",
      statement: "Use the local SQLite sidecar.",
      authorityStatus: "accepted",
      authoritative: true,
      sourceRefs: sourceRef("anchor-a-v1"),
      updatedAt: "2026-07-16T01:04:00.000Z",
    };
    assert.equal(upsertProjectAnchor(root, anchorV1).action, "insert");
    assert.equal(upsertProjectAnchor(root, anchorV1).action, "noop");
    assert.equal(upsertProjectAnchor(root, { ...anchorV1, statement: "Older value", updatedAt: "2026-07-15T01:04:00.000Z" }).action, "stale");
    assert.equal(upsertProjectAnchor(root, { ...anchorV1, statement: "Equal-time collision" }).action, "conflict");
    assert.equal(upsertProjectAnchor(root, { ...anchorV1, statement: "Use the incremental local SQLite sidecar.", updatedAt: "2026-07-16T02:04:00.000Z" }).action, "update");

    const episodeA = {
      episodeId: "episode-a",
      projectId: "project-a",
      episodeType: "accepted_task",
      title: "Project A accepted memory work",
      status: "accepted",
      sourceRefs: sourceRef("episode-a"),
      updatedAt: "2026-07-16T01:05:00.000Z",
    };
    const episodeB = { ...episodeA, episodeId: "episode-b", projectId: "project-b", title: "Project B work", sourceRefs: sourceRef("episode-b") };
    assert.equal(upsertMemoryEvent(root, episodeA).action, "insert");
    assert.equal(upsertMemoryEpisode(root, episodeB).action, "insert");
    const crossProjectCollision = upsertMemoryEpisode(root, {
      ...episodeA,
      projectId: "project-b",
      sourceRefs: sourceRef("episode-a-cross-project"),
      updatedAt: "2026-07-16T03:05:00.000Z",
    });
    assert.equal(crossProjectCollision.action, "conflict");
    assert.deepEqual(crossProjectCollision.reasonCodes, ["immutable_scope_ownership_collision"]);
    assert.equal(crossProjectCollision.record.projectId, "project-a");
    assert.equal(upsertMemoryEpisode(root, {
      ...episodeA,
      scopeKey: "project:alternate-scope",
      updatedAt: "2026-07-16T03:06:00.000Z",
    }).action, "conflict");
    assert.equal(upsertMemoryEpisode(root, {
      ...episodeA,
      episodeType: "different_event_type",
      updatedAt: "2026-07-16T03:07:00.000Z",
    }).action, "conflict");
    assert.deepEqual(listMemoryEpisodes(root, { projectId: "project-a" }).map((row) => row.id), ["episode-a"]);
    assert.equal(getMemoryEpisode(root, "episode-a", { projectId: "project-b" }), null);

    const unscopedDecision = upsertMemoryDecision(root, {
      decisionId: "decision-unscoped",
      title: "Unscoped accepted claim",
      status: "accepted",
      sourceRefs: sourceRef("decision-unscoped"),
      updatedAt: "2026-07-16T01:06:00.000Z",
    });
    assert.equal(unscopedDecision.action, "insert");
    assert.equal(unscopedDecision.record.status, "review");
    assert.equal(unscopedDecision.record.authoritative, false);
    assert.equal(listMemoryDecisions(root).some((row) => row.id === "decision-unscoped"), false);
    assert.equal(listMemoryDecisions(root, { view: "review" }).some((row) => row.id === "decision-unscoped"), true);
    const sourcelessConstraint = upsertMemoryConstraint(root, {
      constraintId: "constraint-sourceless",
      projectId: "project-a",
      statement: "A current constraint without direct evidence.",
      status: "accepted",
      updatedAt: "2026-07-16T01:07:00.000Z",
    });
    assert.equal(sourcelessConstraint.record.status, "review");
    assert.equal(listMemoryConstraints(root, { projectId: "project-a", status: "accepted" }).length, 0);

    assert.equal(upsertMemoryDecision(root, {
      decisionId: "decision-historical",
      projectId: "project-a",
      title: "Superseded historical decision",
      status: "superseded",
      sourceRefs: sourceRef("decision-historical"),
      updatedAt: "2026-07-16T01:07:10.000Z",
    }).action, "insert");
    assert.equal(listMemoryDecisions(root).some((row) => row.id === "decision-historical"), false);
    assert.equal(listMemoryDecisions(root, { view: "history" }).some((row) => row.id === "decision-historical"), true);
    assert.equal(upsertMemoryDecision(root, {
      decisionId: "decision-future",
      projectId: "project-a",
      title: "Future effective decision",
      status: "accepted",
      validFrom: "2999-01-01T00:00:00.000Z",
      sourceRefs: sourceRef("decision-future"),
      updatedAt: "2026-07-16T01:07:20.000Z",
    }).action, "insert");
    assert.equal(listMemoryDecisions(root).some((row) => row.id === "decision-future"), false);
    assert.equal(listMemoryDecisions(root, { status: "accepted" }).some((row) => row.id === "decision-future"), true);

    assert.equal(upsertMemoryDecision(root, {
      decisionId: "decision-a",
      projectId: "project-a",
      title: "Persist only compact metadata",
      status: "accepted",
      sourceRefs: sourceRef("decision-a"),
      updatedAt: "2026-07-16T01:08:00.000Z",
    }).action, "insert");
    const unsafeUpdates = [
      { decisionId: "unsafe-body", projectId: "project-a", status: "accepted", body: "raw body", sourceRefs: sourceRef("unsafe-body") },
      { decisionId: "unsafe-transcript", projectId: "project-a", status: "accepted", transcript: "thread transcript", sourceRefs: sourceRef("unsafe-transcript") },
      { decisionId: "unsafe-secret", projectId: "project-a", status: "accepted", secret: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456", sourceRefs: sourceRef("unsafe-secret") },
      { decisionId: "unsafe-base64", projectId: "project-a", status: "accepted", summary: "A".repeat(240), sourceRefs: sourceRef("unsafe-base64") },
      { decisionId: "decision-a", projectId: "project-a", status: "accepted", body: "must not replace active row", sourceRefs: sourceRef("unsafe-replace") },
    ];
    for (const input of unsafeUpdates) assert.equal(upsertMemoryDecision(root, input).action, "reject");
    const deepPayload = {
      decisionId: "unsafe-deep",
      projectId: "project-a",
      status: "accepted",
      sourceRefs: sourceRef("unsafe-deep"),
    };
    let deepCursor = deepPayload;
    for (let depth = 0; depth < 12_000; depth += 1) {
      deepCursor.next = {};
      deepCursor = deepCursor.next;
    }
    assert.doesNotThrow(() => assert.equal(upsertMemoryDecision(root, deepPayload).action, "reject"));
    const hostileGetter = {
      decisionId: "unsafe-getter",
      projectId: "project-a",
      status: "accepted",
      sourceRefs: sourceRef("unsafe-getter"),
    };
    Object.defineProperty(hostileGetter, "hostile", {
      enumerable: true,
      get() { throw new Error("getter must not escape the persistence boundary"); },
    });
    assert.doesNotThrow(() => assert.equal(upsertMemoryDecision(root, hostileGetter).action, "reject"));
    const hostileProxy = new Proxy({ decisionId: "unsafe-proxy" }, {
      ownKeys() { throw new Error("proxy must not escape the persistence boundary"); },
    });
    assert.doesNotThrow(() => assert.equal(upsertMemoryDecision(root, hostileProxy).action, "reject"));
    assert.equal(upsertMemoryDecision(root, {
      decisionId: "unsafe-split-secret",
      projectId: "project-a",
      status: "accepted",
      fragments: ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"],
      sourceRefs: sourceRef("unsafe-split-secret"),
    }).action, "reject");
    assert.equal(listMemoryDecisions(root).some((row) => row.id.startsWith("unsafe-")), false);
    assert.equal(getMemoryDecision(root, "decision-a").title, "Persist only compact metadata");

    const receipt = {
      receiptId: "receipt-a",
      decisionId: "receipt-a",
      decisionFingerprint: "authority-fingerprint-a",
      receiptProof: "proof-a",
      allowed: true,
      principalId: "principal-owner",
      ownerId: "principal-owner",
      action: "approve_rule",
      targetId: "rule-project-a",
      projectId: "project-a",
      scopeKey: "project:project-a",
      status: "accepted",
      createdAt: "2026-07-16T01:09:00.000Z",
      validFrom: "2026-07-16T01:09:00.000Z",
    };
    assert.equal(appendAuthorityReceipt(root, { ...receipt, receiptId: "receipt-without-proof", decisionId: "receipt-without-proof", receiptProof: null }).action, "reject");
    assert.equal(appendAuthorityReceipt(root, receipt).action, "insert");
    assert.equal(appendAuthorityReceipt(root, receipt).action, "noop");
    assert.throws(() => appendAuthorityReceipt(root, { ...receipt, decisionFingerprint: "tampered-fingerprint" }), (error) => error.code === "MEMORY_CORE_IMMUTABLE_COLLISION");
    assert.throws(() => appendAuthorityReceipt(root, { ...receipt, receiptProof: "tampered-proof" }), (error) => error.code === "MEMORY_CORE_IMMUTABLE_COLLISION");
    assert.equal(appendAuthorityReceipt(root, {
      ...receipt,
      receiptId: "receipt-b",
      decisionId: "receipt-b",
      receiptProof: "proof-b",
      createdAt: "2026-07-16T01:09:01.000Z",
      validFrom: "2026-07-16T01:09:01.000Z",
    }).action, "insert", "the logical decision fingerprint may recur for a distinct signed event proof");
    assert.throws(() => appendAuthorityReceipt(root, {
      ...receipt,
      receiptId: "receipt-replay",
      decisionId: "receipt-replay",
    }), (error) => error.code === "MEMORY_CORE_REPLAY_COLLISION");
    const persistedReceipt = getAuthorityReceipt(root, "receipt-a");
    assert.equal(persistedReceipt.trustState, "persisted_unverified");
    assert.equal(persistedReceipt.trusted, false);
    assert.equal(persistedReceipt.payload.receiptProof, "proof-a");

    const checkpoint = {
      checkpointId: "checkpoint-a-1",
      projectId: "project-a",
      phase: "Wave 2-3",
      authorityStatus: "accepted",
      authoritative: true,
      sourceRefs: sourceRef("checkpoint-a-1"),
      updatedAt: "2026-07-16T01:10:00.000Z",
    };
    assert.equal(appendProjectCheckpoint(root, checkpoint).action, "insert");
    assert.equal(appendProjectCheckpoint(root, checkpoint).action, "noop");
    assert.equal(appendProjectCheckpoint(root, { ...checkpoint, checkpointId: "checkpoint-a-2", phase: "Wave 3" }).action, "insert");
    assert.equal(listProjectCheckpoints(root, { projectId: "project-a" }).length, 2);
    assert.throws(() => appendProjectCheckpoint(root, { ...checkpoint, phase: "tampered" }), (error) => error.code === "MEMORY_CORE_IMMUTABLE_COLLISION");

    close(openMemoryRuntimeIndex(root));
    assert.equal(getMemoryPrincipal(root, "principal-owner").principalId, "principal-owner");
    assert.equal(getProjectBinding(root, "binding-project-a").projectId, "project-a");
    assert.equal(getStandingRule(root, "rule-project-a").statement, "Preserve accepted architecture anchors.");
    assert.equal(getProjectBrain(root, "project-a").productSummary, "Project A");
    assert.equal(getProjectAnchor(root, "anchor-a").statement, "Use the incremental local SQLite sidecar.");
    assert.equal(getModuleMemory(root, "module-a").name, "Memory Core");
    assert.equal(getMemoryConstraint(root, "constraint-sourceless").status, "review");
    assert.equal(getProjectCheckpoint(root, "checkpoint-a-2").phase, "Wave 3");
    assert.equal(listMemoryPrincipals(root).length, 1);
    assert.equal(listProjectBindings(root).length, 1);
    assert.equal(listStandingRules(root).length, 1);
    assert.equal(listAuthorityReceipts(root).length, 2);
    assert.equal(listProjectBrains(root).length, 1);
    assert.equal(listProjectAnchors(root).length, 1);
    assert.equal(listModuleMemories(root).length, 1);

    const bulkDb = openMemoryRuntimeIndex(root);
    try {
      const insert = bulkDb.prepare(`
        INSERT INTO memory_episodes (
          id, projectId, scopeKey, status, type, updatedAt, validFrom, validTo,
          createdAt, fingerprint, payloadJson, contentHash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      bulkDb.exec("BEGIN IMMEDIATE");
      for (let index = 0; index < 10_000; index += 1) {
        const id = `bulk-${String(index).padStart(5, "0")}`;
        const payloadJson = JSON.stringify({ episodeId: id, projectId: "bulk-project", status: "accepted", title: `Compact ${index}` });
        insert.run(
          id, "bulk-project", "project:bulk-project", "accepted", "episode",
          "2026-07-16T02:00:00.000Z", null, null, "2026-07-16T02:00:00.000Z",
          null, payloadJson, crypto.createHash("sha256").update(payloadJson).digest("hex"),
        );
      }
      bulkDb.exec("COMMIT");
    } finally {
      bulkDb.close();
    }
    const reopenStartedAt = Date.now();
    const reopened = openMemoryRuntimeIndex(root);
    const reopenMs = Date.now() - reopenStartedAt;
    try {
      assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM memory_episodes WHERE projectId = ?").get("bulk-project").count, 10_000);
    } finally {
      reopened.close();
    }
    const queryStartedAt = Date.now();
    const compactRows = listMemoryEpisodes(root, { projectId: "bulk-project", status: "accepted", limit: 25 });
    const queryMs = Date.now() - queryStartedAt;
    assert.equal(compactRows.length, 25);
    assert.equal(reopenMs < 2500, true, `10k sidecar reopen should remain bounded, observed ${reopenMs}ms`);
    assert.equal(queryMs < 1500, true, `10k indexed query should remain bounded, observed ${queryMs}ms`);

    assert.equal(fs.readFileSync(markerPath, "utf8"), "sentinel");
    assert.equal(searchMemoryRuntimeIndex(root, "Legacy compatibility sentinel", { projectPath: "project-a" }).items.some((row) => row.id === "legacy-compatible-search-row"), true);
    assert.equal(MEMORY_CORE_SIDECAR_SCHEMA, "zhixia.memory_core_sidecar.v1");
    console.log(`Memory Core sidecar timings: migrations=${migrationMs}ms reopen10k=${reopenMs}ms query10k=${queryMs}ms`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("Memory Core index store tests passed.");
}

main();
