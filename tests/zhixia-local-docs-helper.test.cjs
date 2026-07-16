const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const helperPath = path.join(root, "codex-skills", "zhixia-local-docs", "scripts", "read-project-knowledge.cjs");
const skillPath = path.join(root, "codex-skills", "zhixia-local-docs", "SKILL.md");
const lifecycleReferencePath = path.join(root, "codex-skills", "zhixia-local-docs", "references", "memory-core-lifecycle.md");

function runHelper(workspace, args, options = {}) {
  const output = execFileSync(process.execPath, [helperPath, workspace, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: options.timeout,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      ZHIXIA_USER_DATA: path.join(workspace, ".test-zhixia-user-data"),
      ...(options.env || {}),
    },
  });
  return JSON.parse(output);
}

function runHelperFailure(workspace, args) {
  assert.throws(
    () => execFileSync(process.execPath, [helperPath, workspace, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        ZHIXIA_USER_DATA: path.join(workspace, ".test-zhixia-user-data"),
      },
    }),
    /must stay inside the requested workspace/,
  );
}

function fileSha256(filePath) {
  return require("node:crypto").createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createMemoryFactSidecar(userData, rows) {
  const { DatabaseSync } = require("node:sqlite");
  const storeDir = path.join(userData, "memory-runtime");
  const dbPath = path.join(storeDir, "memory-runtime-index.sqlite");
  fs.mkdirSync(storeDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE memory_facts (
      id TEXT PRIMARY KEY,
      projectPath TEXT,
      scope TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      valueJson TEXT NOT NULL,
      factType TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      validFrom TEXT NOT NULL,
      validTo TEXT,
      observedAt TEXT NOT NULL,
      sourceRefsJson TEXT NOT NULL,
      supersededBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO memory_facts (
      id, projectPath, scope, subject, predicate, valueJson, factType, status,
      confidence, validFrom, validTo, observedAt, sourceRefsJson, supersededBy,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    const createdAt = row.createdAt || "2026-07-01T00:00:00.000Z";
    insert.run(
      row.id,
      row.projectPath,
      row.scope || "project",
      row.subject,
      row.predicate,
      JSON.stringify(row.value),
      row.factType || (typeof row.value === "string" ? "string" : "object"),
      row.status || "active",
      row.confidence == null ? 0.9 : row.confidence,
      row.validFrom || createdAt,
      row.validTo || null,
      row.observedAt || createdAt,
      JSON.stringify(row.sourceRefs == null ? [{ kind: "project_artifact", path: row.sourcePath }] : row.sourceRefs),
      row.supersededBy || null,
      createdAt,
      row.updatedAt || createdAt,
    );
  }
  db.close();
  return dbPath;
}

const MEMORY_CORE_TABLES = [
  "memory_project_brains",
  "memory_project_anchors",
  "memory_modules",
  "memory_standing_rules",
  "memory_episodes",
  "memory_decisions",
  "memory_constraints",
  "memory_project_checkpoints",
];

function createMemoryCoreSidecar(userData, rows) {
  const crypto = require("node:crypto");
  const { DatabaseSync } = require("node:sqlite");
  const storeDir = path.join(userData, "memory-runtime");
  const dbPath = path.join(storeDir, "memory-runtime-index.sqlite");
  fs.mkdirSync(storeDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  for (const table of MEMORY_CORE_TABLES) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        projectId TEXT,
        scopeKey TEXT,
        status TEXT NOT NULL DEFAULT 'review',
        type TEXT NOT NULL DEFAULT 'unknown',
        updatedAt TEXT NOT NULL,
        validFrom TEXT,
        validTo TEXT,
        createdAt TEXT NOT NULL,
        fingerprint TEXT,
        payloadJson TEXT NOT NULL DEFAULT '{}',
        contentHash TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_${table}_project_status ON ${table}(projectId, status, updatedAt DESC);
    `);
  }
  for (const row of rows) {
    const createdAt = row.createdAt || "2026-07-15T00:00:00.000Z";
    const payloadJson = JSON.stringify(row.payload);
    const contentHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
    db.prepare(`
      INSERT INTO ${row.table} (
        id, projectId, scopeKey, status, type, updatedAt, validFrom, validTo,
        createdAt, fingerprint, payloadJson, contentHash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.projectId,
      row.scopeKey || `project:${row.projectId}`,
      row.status || "accepted",
      row.type || "memory",
      row.updatedAt || createdAt,
      row.validFrom || createdAt,
      row.validTo || null,
      createdAt,
      null,
      payloadJson,
      contentHash,
    );
  }
  db.close();
  return dbPath;
}

function memoryCoreFixtureRows(workspace, otherWorkspace) {
  const projectId = "project-alpha";
  const otherProjectId = "project-beta";
  const sourceRef = (title = "Alpha PRD") => ({
    kind: "project_artifact",
    path: path.join(workspace, "docs", "PRD.md"),
    title,
    projectId,
    hash: "a".repeat(64),
  });
  const child = (id, title, status = "open") => ({
    id,
    title,
    status,
    projectId,
    authorityStatus: "accepted",
    sourceRefs: [sourceRef(`${title} source`)],
    updatedAt: "2026-07-15T12:00:00.000Z",
  });
  const accepted = (table, id, payload, type = "memory") => ({
    table,
    id,
    projectId,
    status: "accepted",
    type,
    payload: {
      ...payload,
      projectId,
      authorityStatus: "accepted",
      sourceRefs: payload.sourceRefs || [sourceRef()],
      updatedAt: "2026-07-15T12:00:00.000Z",
    },
  });
  return [
    accepted("memory_project_brains", "project-alpha", {
      canonicalPath: workspace,
      aliases: ["Alpha Memory Core"],
      productSummary: "Alpha Memory Core continuity and authority upgrade.",
      phase: "helper lifecycle integration",
    }, "project_brain"),
    accepted("memory_project_anchors", "anchor-alpha-goal", {
      category: "original_goal",
      statement: "Ship the full Alpha Memory Core upgrade.",
    }, "original_goal"),
    accepted("memory_project_anchors", "anchor-alpha-architecture", {
      category: "architecture",
      statement: "Alpha architecture keeps authority filtering before relevance ranking.",
    }, "architecture"),
    accepted("memory_project_anchors", "anchor-alpha-rule", {
      category: "non_negotiable",
      statement: "Alpha standing rule requires compact metadata-only retrieval and no database writes.",
    }, "non_negotiable"),
    accepted("memory_modules", "module-alpha-helper", {
      name: "Alpha packaged helper",
      purpose: "Expose bounded Memory Core continuity to Codex lanes.",
      currentStatus: "active",
      tasks: [
        child("task-alpha-1", "Preserve legacy helper contracts"),
        child("task-alpha-2", "Expose continuity status"),
        child("task-alpha-3", "Expose review queue"),
        child("task-alpha-4", "Expose diagnostics"),
        child("task-alpha-5", "Verify mandatory pagination"),
      ],
      blockers: [child("blocker-alpha-1", "Resolve bounded cursor semantics", "open")],
    }, "module_memory"),
    accepted("memory_episodes", "episode-alpha-failure", {
      eventType: "test_failure",
      title: "Alpha latest failure",
      summary: "Recovery readiness was previously claimed before mandatory pages completed.",
    }, "test_failure"),
    accepted("memory_project_checkpoints", "checkpoint-alpha-current", {
      checkpointId: "checkpoint-alpha-current",
      originalGoal: "Ship the full Alpha Memory Core upgrade.",
      architectureAnchors: ["Alpha architecture keeps authority filtering before relevance ranking."],
      acceptedProgress: [child("progress-alpha-1", "Read-only Memory Core schema detection accepted", "accepted")],
      openTasks: [child("task-alpha-6", "Finish packaged helper lifecycle", "open")],
      blockers: [child("blocker-alpha-2", "No blocker remains after fixture setup", "resolved")],
      nextActions: [
        child("action-alpha-1", "Run focused helper tests"),
        child("action-alpha-2", "Run smoke checks"),
        child("action-alpha-3", "Report residual risks"),
      ],
      threadLineage: ["thread-alpha-ceo", "thread-alpha-worker"],
      canonicalDocRefs: [sourceRef("Alpha canonical PRD")],
    }, "project_checkpoint"),
    {
      table: "memory_decisions",
      id: "decision-alpha-review",
      projectId,
      status: "review",
      type: "decision",
      payload: {
        decisionId: "decision-alpha-review",
        projectId,
        statement: "Review whether the continuity page size should be raised.",
        status: "review",
        continuitySlot: "next_actions",
        reviewReasonCodes: ["owner_review_required"],
        sourceRefs: [sourceRef("Alpha review source")],
        updatedAt: "2026-07-15T13:00:00.000Z",
      },
    },
    accepted("memory_decisions", "decision-alpha-secret", {
      statement: "Unsafe decision must be omitted.",
      receiptProof: "raw-proof-must-never-surface",
    }, "decision"),
    accepted("memory_episodes", "episode-alpha-base64", {
      title: "Unsafe image payload",
      summary: `data:image/png;base64,${"Z".repeat(260)}`,
    }, "episode"),
    accepted("memory_constraints", "constraint-alpha-signing-key", {
      constraintType: "standing_rule",
      statement: "Unsafe signing key payload must be omitted.",
      signingKey: "do-not-return-this-signing-key",
    }, "constraint"),
    accepted("memory_decisions", "decision-alpha-relative-escape", {
      statement: "Relative source escape sentinel must be omitted.",
      sourceRefs: [{ kind: "project_artifact", path: "../foreign-project/OTHER.md", projectId }],
    }, "decision"),
    {
      table: "memory_project_brains",
      id: otherProjectId,
      projectId: otherProjectId,
      status: "accepted",
      type: "project_brain",
      payload: {
        projectId: otherProjectId,
        canonicalPath: otherWorkspace,
        aliases: ["Beta Foreign Project"],
        productSummary: "Foreign project continuity sentinel must never cross scope.",
        authorityStatus: "accepted",
        sourceRefs: [{ kind: "project_artifact", path: path.join(otherWorkspace, "OTHER.md"), projectId: otherProjectId }],
        updatedAt: "2026-07-15T14:00:00.000Z",
      },
    },
    {
      table: "memory_project_anchors",
      id: "anchor-beta-foreign",
      projectId: otherProjectId,
      status: "accepted",
      type: "architecture",
      payload: {
        anchorId: "anchor-beta-foreign",
        projectId: otherProjectId,
        category: "architecture",
        statement: "Beta foreign architecture must never appear in Alpha output.",
        authorityStatus: "accepted",
        sourceRefs: [{ kind: "project_artifact", path: path.join(otherWorkspace, "OTHER.md"), projectId: otherProjectId }],
        updatedAt: "2026-07-15T14:00:00.000Z",
      },
    },
  ];
}

function sqliteLogicalSnapshot(db) {
  return {
    schema: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all(),
    rows: db.prepare("SELECT * FROM memory_facts ORDER BY id").all(),
  };
}

function createActiveWalMemoryFactSidecar(userData, workspace) {
  const dbPath = createMemoryFactSidecar(userData, [{
    id: "fact-wal-live",
    projectPath: workspace,
    subject: "Alpha WAL recall",
    predicate: "live_value",
    value: "Checkpointed value should be replaced by active WAL state.",
    status: "active",
    sourcePath: path.join(workspace, "docs", "PRD.md"),
  }]);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
  db.prepare("UPDATE memory_facts SET valueJson = ?, updatedAt = ? WHERE id = ?").run(
    JSON.stringify("Live WAL recall value visible without checkpoint or snapshot copy."),
    "2026-07-15T08:00:00.000Z",
    "fact-wal-live",
  );
  return { db, dbPath };
}

function createLockedMemoryFactSidecar(userData, workspace) {
  const dbPath = createMemoryFactSidecar(userData, [{
    id: "fact-locked",
    projectPath: workspace,
    subject: "Alpha locked fallback",
    predicate: "lock_behavior",
    value: "Locked sidecar must fail soft to file knowledge.",
    status: "active",
    sourcePath: path.join(workspace, "docs", "PRD.md"),
  }]);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
  db.prepare("UPDATE memory_facts SET updatedAt = ? WHERE id = ?").run("2026-07-15T09:00:00.000Z", "fact-locked");
  return { db, dbPath };
}

function writeFixture(workspace) {
  const bundleDir = path.join(workspace, ".codex-knowledge");
  const docsDir = path.join(workspace, "docs");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(
    path.join(docsDir, "EXAMPLE_PROJECT_CEO_RECOVERY_PACKET.md"),
    "# Example Project CEO Recovery\n\n中文恢复摘要：旧 CEO 线程坏掉后，新线程先读这里继续项目。",
    "utf8",
  );
  fs.writeFileSync(
    path.join(docsDir, "EXAMPLE_PROJECT_CEO_TRANSCRIPT_EXTRACT.md"),
    `# Giant Transcript Pointer\n\n${"transcript filler\n".repeat(60000)}DO_NOT_READ_TRANSCRIPT_TAIL`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(docsDir, "PRD.md"),
    "# PRD\n\nExample Project 是一个 2D 游戏与插件平台项目。",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "retrieval-packet.md"),
    [
      "# Retrieval Packet",
      "",
      "## Example Project Current Accepted Engine Update",
      "",
      "Current accepted engine progress: runtime adapter and scene workbench are accepted product milestones.",
      "",
      "## Alpha Dispatch",
      "",
      "Alpha runtime context should stay compact.",
      "Source pointer: C:/Users/example/.codex/sessions/2026/06/19/raw-session.jsonl",
      `Inline image: data:image/png;base64,${"A".repeat(260)}`,
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "knowledge-items.md"),
    [
      "# Knowledge",
      "",
      "## Alpha Contract",
      "",
      "Alpha accepted contract rule with source-backed retrieval.",
      "",
      "## 老线程优化：EXAMPLE-PROGRESS-DRIFT-AUDIT-AFTER-W45",
      "",
      "Guardian inventory found a CEO-created read-only audit thread past the cooling rule. This is maintenance evidence, not product progress.",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "experience-cards.md"),
    "# Experience\n\n## Alpha Prior Fix\n\nAccepted lesson: keep helper output bounded and metadata-first.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "tool-skill-inventory.md"),
    "# Tools\n\n## Alpha Tool\n\nTool candidate for reading compact project knowledge. Forbidden: install or execute automatically.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "project-artifacts.md"),
    "# Artifacts\n\n## Alpha Test Plan\n\nCurrent test plan source pointer for review.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "project-knowledge.md"),
    `${"# Giant Compatibility File\n\n".repeat(20)}${"safe filler\n".repeat(30000)}DO_NOT_READ_GIANT_TAIL alpha`,
    "utf8",
  );
}

function main() {
  const skillText = fs.readFileSync(skillPath, "utf8");
  const lifecycleReferenceText = fs.readFileSync(lifecycleReferencePath, "utf8");
  assert.ok(skillText.split(/\r?\n/).length < 180, "SKILL.md should remain lean routing guidance");
  assert.doesNotMatch(skillText, /Exact continuity status JSON shape/, "large lifecycle schemas should not remain in SKILL.md");
  assert.match(lifecycleReferenceText, /zhixia\.memory_core_continuity_status\.v1/, "the lifecycle reference should own the exact continuity contract");
  assert.match(lifecycleReferenceText, /authorityVerification=\"unavailable\"/, "the lifecycle reference should document unavailable authority verification");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-helper-"));
  const siblingEscape = `${workspace}-escape`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-helper-user-data-"));
  const missingUserData = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-helper-missing-user-data-"));
  const schemaMissingUserData = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-helper-schema-missing-user-data-"));
  const walUserData = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-helper-wal-user-data-"));
  const lockedUserData = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-helper-locked-user-data-"));
  const escapeLink = path.join(workspace, "escape-link");
  let escapeLinkCreated = false;
  let walDb = null;
  let lockedDb = null;
  let performanceSample = null;
  try {
    writeFixture(workspace);
    fs.mkdirSync(siblingEscape, { recursive: true });
    try {
      fs.symlinkSync(siblingEscape, escapeLink, process.platform === "win32" ? "junction" : "dir");
      escapeLinkCreated = true;
    } catch {
      escapeLinkCreated = false;
    }
    const sidecarPath = createMemoryFactSidecar(userData, [
      {
        id: "fact-alpha-active",
        projectPath: workspace,
        subject: "Alpha sidecar recall",
        predicate: "implementation_contract",
        value: "Use the source-backed MemoryFact sidecar anchor for compact dispatch.",
        status: "active",
        sourceRefs: [
          { kind: "project_artifact", path: path.join(workspace, "docs", "PRD.md"), title: "Alpha PRD" },
          { kind: "external_artifact", path: path.join(siblingEscape, "FOREIGN-PROJECT-PATH.md"), title: "External evidence metadata" },
        ],
      },
      {
        id: "fact-alpha-accepted",
        projectPath: workspace,
        subject: "Alpha precedent",
        predicate: "bounded_retrieval",
        value: "Accepted precedent keeps sidecar retrieval read-only and bounded.",
        status: "accepted",
        confidence: 0.95,
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-alpha-current",
        projectPath: workspace,
        subject: "Alpha current checkpoint",
        predicate: "next_action",
        value: "Current synthetic checkpoint is ready for implementation review.",
        status: "current",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-safe-temporal",
        projectPath: workspace,
        subject: "Alpha safe temporal sentinel",
        predicate: "temporal_metadata",
        value: "Safe ISO temporal metadata must remain eligible.",
        status: "accepted",
        validFrom: "2026-06-01T00:00:00.000Z",
        observedAt: "2026-06-02T00:00:00.000Z",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-07-14T12:34:56.000Z",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-dangerous-updated-at",
        projectPath: workspace,
        subject: "Alpha dangerous updated timestamp",
        predicate: "temporal_metadata",
        value: "The value is safe but updatedAt contains a credential signal.",
        status: "accepted",
        updatedAt: "2026-07-14T12:34:56.000Z-ghp_1234567890abcdef",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-dangerous-observed-at",
        projectPath: workspace,
        subject: "Alpha dangerous observed timestamp",
        predicate: "temporal_metadata",
        value: "The value is safe but observedAt contains a credential signal.",
        status: "active",
        observedAt: "Bearer abcdefghijklmnop",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-other-project",
        projectPath: siblingEscape,
        subject: "Alpha sidecar recall from another project",
        predicate: "must_not_cross_scope",
        value: "This exact-project isolation sentinel must never appear.",
        status: "active",
        sourcePath: path.join(siblingEscape, "OTHER.md"),
      },
      {
        id: "fact-global-matching-project",
        projectPath: workspace,
        scope: "global",
        subject: "Alpha global scope",
        predicate: "must_not_masquerade_as_project",
        value: "A global fact must not enter ordinary project retrieval.",
        status: "accepted",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "raw_session-dangerous-fact-id",
        projectPath: workspace,
        subject: "Alpha dangerous identifier",
        predicate: "structured_field_scan",
        value: "All visible value fields are otherwise safe.",
        status: "active",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-dangerous-source-metadata",
        projectPath: workspace,
        subject: "Alpha dangerous source metadata",
        predicate: "structured_field_scan",
        value: "Known source fields look safe but hidden metadata is not.",
        status: "active",
        sourceRefs: [{
          kind: "project_artifact",
          path: path.join(workspace, "docs", "PRD.md"),
          hiddenMetadata: "raw_session_pointer_must_be_scanned",
        }],
      },
      {
        id: "fact-source-ref-overflow",
        projectPath: workspace,
        subject: "Alpha source ref overflow",
        predicate: "bounded_scanner",
        value: "More source refs than the scanner bound must fail closed.",
        status: "active",
        sourceRefs: Array.from({ length: 17 }, (_, index) => ({
          kind: "project_artifact",
          path: path.join(workspace, "docs", `SAFE-${index + 1}.md`),
        })),
      },
      {
        id: "fact-object-overflow",
        projectPath: workspace,
        subject: "Alpha object overflow",
        predicate: "bounded_scanner",
        value: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field${index + 1}`, `safe-${index + 1}`])),
        status: "active",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-rejected",
        projectPath: workspace,
        subject: "Alpha rejected",
        predicate: "excluded_status",
        value: "Rejected facts must stay out.",
        status: "rejected",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-review",
        projectPath: workspace,
        subject: "Alpha review",
        predicate: "excluded_status",
        value: "Review facts must stay out.",
        status: "review",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-candidate",
        projectPath: workspace,
        subject: "Alpha candidate",
        predicate: "excluded_status",
        value: "Candidate facts must stay out.",
        status: "candidate",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-superseded",
        projectPath: workspace,
        subject: "Alpha superseded",
        predicate: "excluded_temporal_state",
        value: "Superseded facts must stay out.",
        status: "active",
        supersededBy: "fact-alpha-active",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-expired",
        projectPath: workspace,
        subject: "Alpha expired",
        predicate: "excluded_temporal_state",
        value: "Expired facts must stay out.",
        status: "accepted",
        validTo: "2026-01-02T00:00:00.000Z",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-no-source",
        projectPath: workspace,
        subject: "Alpha no source",
        predicate: "excluded_provenance",
        value: "Source-free facts must stay out.",
        status: "active",
        sourceRefs: [],
      },
      {
        id: "fact-raw-session",
        projectPath: workspace,
        subject: "Alpha unsafe payload",
        predicate: "raw_session",
        value: "C:/Users/example/.codex/sessions/private/session.jsonl",
        status: "active",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-secret",
        projectPath: workspace,
        subject: "Alpha unsafe credential",
        predicate: "credential",
        value: "api_key=should-never-surface",
        status: "active",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-base64",
        projectPath: workspace,
        subject: "Alpha unsafe image",
        predicate: "payload",
        value: `data:image/png;base64,${"B".repeat(240)}`,
        status: "active",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
      {
        id: "fact-giant",
        projectPath: workspace,
        subject: "Alpha giant payload",
        predicate: "payload",
        value: "G".repeat(5000),
        status: "active",
        sourcePath: path.join(workspace, "docs", "PRD.md"),
      },
    ]);
    createMemoryCoreSidecar(userData, memoryCoreFixtureRows(workspace, siblingEscape));
    createMemoryFactSidecar(schemaMissingUserData, [{
      id: "fact-schema-only",
      projectPath: workspace,
      subject: "Alpha facts-only schema",
      predicate: "fallback",
      value: "Memory Core tables are intentionally absent.",
      status: "accepted",
      sourcePath: path.join(workspace, "docs", "PRD.md"),
    }]);
    const sidecarHashBefore = fileSha256(sidecarPath);
    const sidecarEnv = { ZHIXIA_USER_DATA: userData };

    const legacy = runHelper(workspace, ["--query", "alpha", "--limit", "3", "--json"], { env: sidecarEnv });
    assert.equal(legacy.provider, "zhixia_local_docs", "legacy helper JSON should keep provider");
    assert.equal(legacy.mode, "file_contract", "legacy --query --limit --json should keep file_contract mode");
    assert.ok(Array.isArray(legacy.results), "legacy helper output should preserve results[]");
    assert.ok(legacy.items.length <= 3, "legacy helper should honor limit");
    assert.equal(legacy.memoryFactSidecar, undefined, "legacy file_contract should not activate or expose the sidecar");
    assert.equal(legacy.items.some((item) => item.kind === "memory_fact"), false, "legacy file_contract should remain file-backed");
    const legacyText = JSON.stringify(legacy);
    assert.doesNotMatch(legacyText, /\.codex[\\/]sessions/i, "default output must redact raw session paths");
    assert.doesNotMatch(legacyText, /A{120}/, "default output must redact base64-like payloads");
    assert.doesNotMatch(legacyText, /DO_NOT_READ_GIANT_TAIL/, "helper must not read giant Markdown tail content by default");
    assert.ok(legacy.warnings.some((warning) => /exceeded/.test(warning)), "giant bundle files should produce bounded-read warning");

    const context = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha dispatch implementation",
      "--query-type",
      "task_dispatch",
      "--limit",
      "4",
      "--json",
    ]);
    assert.equal(context.schemaVersion, 1, "runtime context should be schema v1");
    assert.equal(context.mode, "runtime_context_packet", "runtime context mode should be explicit");
    assert.equal(context.request.taskGoal, "alpha dispatch implementation");
    assert.ok(context.items.length > 0, "runtime context should return compact items");
    assert.ok(context.items.every((item) => item.rawSessionPolicy === "not_allowed"), "runtime context must forbid raw-session defaults");
    assert.ok(context.sourceRefs.length > 0, "runtime context should preserve sourceRefs");
    assert.equal(context.memoryMode, "layered", "runtime context should use layered memory mode");
    assert.ok(context.memoryLayers.hot.count >= 1, "runtime context should expose hot working memory");
    assert.ok(context.recallPlan.defaultReadOrder.includes("warm"), "recall plan should include warm long-term summaries");
    assert.equal(context.recallPlan.coldLayer.defaultRead, false, "cold history must not be read by default");

    const sidecarContext = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha sidecar recall current checkpoint implementation",
      "--query-type",
      "task_dispatch",
      "--token-budget",
      "500",
      "--limit",
      "8",
      "--json",
    ], { env: sidecarEnv });
    const sidecarFacts = sidecarContext.items.filter((item) => item.kind === "memory_fact");
    const sidecarFactIds = sidecarFacts.map((item) => item.id);
    assert.equal(sidecarContext.memoryFactSidecar.status, "available", "runtime context should report an available read-only sidecar");
    assert.equal(sidecarContext.memoryFactSidecar.readOnly, true, "sidecar metadata should declare read-only access");
    assert.equal(sidecarContext.memoryFactSidecar.busyTimeoutMs, 100, "sidecar reads should use a bounded busy timeout");
    assert.ok(sidecarFactIds.includes("fact-alpha-active"), "runtime context should recall active source-backed MemoryFacts");
    assert.ok(sidecarFactIds.includes("fact-alpha-current"), "runtime context should recall current source-backed MemoryFacts");
    assert.ok(sidecarFacts.every((item) => item.memoryLayer === "warm"), "MemoryFacts should merge into the Warm layer");
    assert.ok(sidecarFacts.every((item) => item.sourceRefs.length >= 2), "MemoryFacts should preserve fact and canonical sourceRefs");
    assert.ok(sidecarFacts.every((item) => item.status === "review"), "persisted MemoryFacts without verified authority must be downgraded to review");
    assert.ok(sidecarFacts.every((item) => item.authority?.authoritative === false), "unsigned MemoryFacts must never be authoritative");
    assert.ok(sidecarFacts.every((item) => item.authority?.authorityVerification === "unavailable"), "MemoryFacts must report unavailable authority verification");
    assert.ok(sidecarFacts.every((item) => item.requiresHumanConfirmation === true), "advisory MemoryFacts must require confirmation");
    assert.ok(sidecarContext.tokenEstimate <= 550, "merged MemoryFacts should respect the runtime token soft budget");
    for (const excludedId of [
      "fact-other-project",
      "fact-global-matching-project",
      "raw_session-dangerous-fact-id",
      "fact-dangerous-updated-at",
      "fact-dangerous-observed-at",
      "fact-dangerous-source-metadata",
      "fact-source-ref-overflow",
      "fact-object-overflow",
      "fact-rejected",
      "fact-review",
      "fact-candidate",
      "fact-superseded",
      "fact-expired",
      "fact-no-source",
      "fact-raw-session",
      "fact-secret",
      "fact-base64",
      "fact-giant",
    ]) {
      assert.equal(sidecarFactIds.includes(excludedId), false, `${excludedId} must be excluded from sidecar recall`);
    }
    const sidecarText = JSON.stringify(sidecarContext);
    assert.doesNotMatch(sidecarText, /should-never-surface|data:image\/png;base64|G{200}/, "sidecar recall must not surface secret, base64, or giant payloads");
    assert.doesNotMatch(sidecarText, /\.codex[\\/]sessions/i, "sidecar recall must not surface raw-session paths");
    assert.doesNotMatch(sidecarText, /FOREIGN-PROJECT-PATH\.md|zhixia-helper-[^\"]+-escape/, "cross-workspace MemoryFact source paths must not leak");
    assert.ok(
      sidecarFacts.flatMap((item) => item.sourceRefs).some((ref) => ref.redacted === "outside_workspace" && ref.path == null),
      "external MemoryFact references may survive only as pathless redacted metadata",
    );

    const memoryCoreContext = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha memory core architecture helper lifecycle integration",
      "--token-budget",
      "900",
      "--limit",
      "12",
      "--json",
    ], { env: sidecarEnv });
    const memoryCoreItems = memoryCoreContext.items.filter((item) => [
      "project_brain", "project_anchor", "module_memory", "memory_episode", "project_checkpoint",
    ].includes(item.kind));
    assert.equal(memoryCoreContext.memoryCoreSidecar.status, "available", "runtime context should report an available Memory Core sidecar");
    assert.equal(memoryCoreContext.memoryCoreSidecar.schemaVersion, "zhixia.memory_core_sidecar.v1", "helper should detect the Memory Core logical schema");
    assert.ok(memoryCoreItems.length > 0, "runtime context should retain safe persisted Memory Core records as advisory review items");
    assert.ok(memoryCoreItems.every((item) => Array.isArray(item.whyRecalled) && item.whyRecalled.length > 0), "Memory Core items should explain why they were recalled");
    assert.ok(memoryCoreItems.every((item) => item.authority?.scope === "exact_project"), "Memory Core items should expose exact-project authority summaries");
    assert.ok(memoryCoreItems.every((item) => item.status === "review" && item.authority?.authoritative === false), "unsigned accepted/curated Memory Core rows must stay review-only");
    assert.ok(memoryCoreItems.every((item) => item.authority?.authorityVerification === "unavailable"), "Memory Core items must report unavailable authority verification");
    assert.ok(memoryCoreItems.some((item) => item.continuitySlot), "Memory Core items should expose continuity slots when applicable");
    const memoryCoreText = JSON.stringify(memoryCoreContext);
    assert.doesNotMatch(memoryCoreText, /Beta foreign|raw-proof-must-never-surface|do-not-return-this-signing-key|Relative source escape sentinel|Z{120}/, "runtime recall must isolate projects and omit unsafe Memory Core payloads");
    assert.doesNotMatch(memoryCoreText, /receiptProof\s*[:=]|trustContext\s*[:=]|signingKey\s*[:=]/i, "runtime recall must not expose proof, trust context, or signing-key fields");

    const foreignProjectRequest = runHelper(workspace, [
      "--continuity-status",
      "--project-id",
      "project-beta",
      "--json",
    ], { env: sidecarEnv });
    assert.equal(foreignProjectRequest.recoveryReady, false, "a foreign project id must never become recovery ready for this workspace");
    assert.equal(foreignProjectRequest.sidecar.status, "project_scope_mismatch", "foreign project ids should fail closed on exact workspace scope");
    assert.doesNotMatch(JSON.stringify(foreignProjectRequest), /Beta foreign architecture/, "foreign project continuity must not cross into the requested workspace");

    const continuityPages = [];
    let continuityCursor = null;
    for (let page = 0; page < 20; page += 1) {
      const continuityArgs = ["--continuity-status", "--project-id", "project-alpha", "--page-size", "3", "--json"];
      if (continuityCursor) continuityArgs.splice(5, 0, "--cursor", continuityCursor);
      const continuity = runHelper(workspace, continuityArgs, { env: sidecarEnv });
      continuityPages.push(continuity);
      continuityCursor = continuity.pagination.nextCursor;
      if (!continuityCursor) break;
    }
    assert.ok(continuityPages.length > 1, "mandatory continuity items should paginate across multiple bounded pages");
    assert.equal(continuityPages[0].recoveryReady, false, "the first partial mandatory page must not claim recovery readiness");
    assert.equal(continuityPages[0].pagination.requiresContinuation, true, "the first partial mandatory page should require continuation");
    const finalContinuity = continuityPages.at(-1);
    assert.equal(finalContinuity.pagination.complete, true, "the final valid mandatory page should mark pagination complete");
    assert.equal(finalContinuity.pagination.pageComplete, true, "the final valid advisory page should report page completion");
    assert.equal(finalContinuity.recoveryReady, false, "page completion without app-authenticated authority proof must remain recovery-not-ready");
    assert.equal(finalContinuity.authorityVerification, "unavailable", "continuity must report unavailable authority verification honestly");
    assert.equal(finalContinuity.counts.filled, 0, "unsigned persisted rows cannot fill mandatory continuity slots");
    assert.equal(finalContinuity.counts.missing, 14, "all mandatory slots remain missing until authority is verified");
    assert.equal(finalContinuity.counts.conflict, 0, "the fixture should have no continuity conflicts");
    assert.ok(finalContinuity.counts.review >= 1, "continuity status should count project-scoped review candidates");
    assert.equal(finalContinuity.mandatorySlots.length, 14, "continuity status should expose the fixed mandatory slot contract");
    assert.ok(finalContinuity.performance.durationMs < 1500, "continuity status should remain bounded in the synthetic fixture");

    const forgedEndCursor = runHelper(workspace, [
      "--continuity-status",
      "--project-id",
      "project-alpha",
      "--cursor",
      `continuity-${continuityPages[0].pagination.manifestFingerprint}-${continuityPages[0].pagination.total}-${"0".repeat(32)}`,
      "--json",
    ], { env: sidecarEnv });
    assert.equal(forgedEndCursor.pagination.cursorInvalid, true, "a synthesized end offset without the accumulated chain digest must be rejected");
    assert.equal(forgedEndCursor.recoveryReady, false, "a forged end cursor must never claim recovery readiness");

    const invalidContinuityCursor = runHelper(workspace, [
      "--continuity-status",
      "--project-id",
      "project-alpha",
      "--cursor",
      "continuity-malicious-path-C:/Users/example/.codex/sessions/raw.jsonl",
      "--json",
    ], { env: sidecarEnv });
    assert.equal(invalidContinuityCursor.recoveryReady, false, "an invalid cursor must fail closed");
    assert.equal(invalidContinuityCursor.pagination.cursorInvalid, true, "invalid cursor metadata should be explicit");
    assert.doesNotMatch(JSON.stringify(invalidContinuityCursor), /\.codex[\\/]sessions/i, "malicious cursor text must be redacted from JSON output");

    const reviewQueue = runHelper(workspace, [
      "--memory-review-queue",
      "--project-id",
      "project-alpha",
      "--page-size",
      "25",
      "--json",
    ], { env: sidecarEnv });
    assert.equal(reviewQueue.mode, "memory_core_review_queue", "review queue mode should be explicit");
    assert.ok(reviewQueue.items.some((item) => item.id === "decision-alpha-review"), "review queue should return bounded project-scoped review records");
    assert.ok(reviewQueue.items.some((item) => item.id === "project-alpha"), "unsigned accepted ProjectBrain rows should be downgraded into the review queue");
    assert.ok(reviewQueue.items.every((item) => ["candidate", "review"].includes(item.status)), "review queue must apply lifecycle filtering before output");
    assert.ok(reviewQueue.items.filter((item) => item.authority.persistedStatus === "accepted").every((item) => item.authority.authorityVerification === "unavailable" && item.authority.authoritative === false), "accepted rows in the review queue must remain explicitly unverified");
    assert.doesNotMatch(JSON.stringify(reviewQueue), /project-beta|raw-proof-must-never-surface|Z{120}/, "review queue must remain project-scoped and redacted");

    const diagnostics = runHelper(workspace, [
      "--memory-diagnostics",
      "--project-id",
      "project-alpha",
      "--json",
    ], { env: sidecarEnv });
    assert.equal(diagnostics.mode, "memory_core_diagnostics", "diagnostics mode should be explicit");
    assert.equal(diagnostics.performance.fullScans, false, "diagnostics must declare that it avoids full scans");
    assert.equal(diagnostics.performance.projectScopedIndexedAggregatesOnly, true, "diagnostics should use project-scoped indexed aggregates only");
    assert.ok(diagnostics.lifecycleTotals.current > 0, "diagnostics should summarize current lifecycle rows");
    assert.ok(diagnostics.lifecycleTotals.review > 0, "diagnostics should summarize review lifecycle rows");
    assert.equal(diagnostics.safety.payloadBodiesReturned, false, "diagnostics must not return payload bodies");
    const diagnosticsWithoutProjectId = runHelper(workspace, ["--memory-diagnostics", "--json"], { env: sidecarEnv });
    assert.equal(diagnosticsWithoutProjectId.sidecar.status, "not_opened", "diagnostics without a project id should not open or scan the sidecar");
    assert.ok(diagnosticsWithoutProjectId.warnings.includes("memory_core_project_id_required_for_diagnostics"), "diagnostics should require an explicit project id for indexed scope");
    performanceSample = {
      continuityDurationMs: finalContinuity.performance.durationMs,
      continuityPages: continuityPages.length,
      continuityItems: finalContinuity.pagination.total,
      diagnosticsDurationMs: diagnostics.performance.durationMs,
      diagnosticTables: diagnostics.tables.length,
    };

    const schemaFallback = runHelper(workspace, ["--continuity-status", "--json"], { env: { ZHIXIA_USER_DATA: schemaMissingUserData } });
    assert.equal(schemaFallback.sidecar.status, "schema_unavailable", "facts-only sidecars should fail soft when the Memory Core schema is absent");
    assert.equal(schemaFallback.recoveryReady, false, "missing Memory Core schema must never claim recovery readiness");
    assert.ok(schemaFallback.warnings.includes("memory_core_sidecar_schema_unavailable_fallback_to_codex_knowledge"), "schema fallback should return a compact warning");

    const missingCoreFallback = runHelper(workspace, ["--memory-review-queue", "--json"], { env: { ZHIXIA_USER_DATA: missingUserData } });
    assert.equal(missingCoreFallback.sidecar.status, "missing", "missing sidecars should be explicit in new read-only modes");
    assert.deepEqual(missingCoreFallback.items, [], "missing sidecars should return an empty bounded review queue");

    const dangerousTemporalContext = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha dangerous updated observed timestamp temporal metadata",
      "--limit",
      "8",
      "--json",
    ], { env: sidecarEnv });
    assert.equal(
      dangerousTemporalContext.items.some((item) => item.id === "fact-dangerous-updated-at"),
      false,
      "credential-like updatedAt metadata must omit the entire fact",
    );
    assert.equal(
      dangerousTemporalContext.items.some((item) => item.id === "fact-dangerous-observed-at"),
      false,
      "credential-like observedAt metadata must omit the entire fact",
    );
    assert.doesNotMatch(
      JSON.stringify(dangerousTemporalContext),
      /ghp_1234567890abcdef|Bearer abcdefghijklmnop/,
      "dangerous temporal metadata must not leak through items or synthetic sourceRefs",
    );

    const safeTemporalContext = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha safe temporal sentinel",
      "--limit",
      "4",
      "--json",
    ], { env: sidecarEnv });
    const safeTemporalFact = safeTemporalContext.items.find((item) => item.id === "fact-safe-temporal");
    assert.ok(safeTemporalFact, "safe ISO temporal metadata should remain eligible for recall");
    assert.equal(
      safeTemporalFact.sourceRefs.find((ref) => ref.kind === "memory_fact")?.updatedAt,
      "2026-07-14T12:34:56.000Z",
      "safe updatedAt metadata should remain available on the synthetic MemoryFact sourceRef",
    );

    const sidecarPrecedent = runHelper(workspace, [
      "--precedent",
      "alpha precedent bounded retrieval",
      "--token-budget",
      "500",
      "--limit",
      "6",
      "--json",
    ], { env: sidecarEnv });
    assert.equal(sidecarPrecedent.mode, "runtime_precedent_packet", "precedent mode should preserve its packet contract");
    assert.ok(sidecarPrecedent.items.some((item) => item.id === "fact-alpha-accepted" && item.status === "review"), "precedent retrieval should retain accepted MemoryFacts only as review advisory");
    assert.ok(sidecarPrecedent.precedentPolicy.allowedHelperKinds.includes("memory_fact"), "precedent policy should declare MemoryFact support");

    const memoryCorePrecedent = runHelper(workspace, [
      "--precedent",
      "alpha architecture authority filtering",
      "--token-budget",
      "900",
      "--limit",
      "10",
      "--json",
    ], { env: sidecarEnv });
    const recalledAnchor = memoryCorePrecedent.items.find((item) => item.id === "anchor-alpha-architecture");
    assert.ok(recalledAnchor, "precedent retrieval should include safe Memory Core anchors as advisory review material");
    assert.ok(recalledAnchor.whyRecalled.includes("continuity:architecture_anchors"), "precedent items should explain their continuity relevance");
    assert.equal(recalledAnchor.authority.receiptProofIncluded, false, "precedent authority summaries must never include receipt proofs");
    assert.equal(recalledAnchor.authority.authorityVerification, "unavailable", "precedent authority must not be inferred from persisted status");

    const missingSidecar = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha dispatch implementation",
      "--json",
    ], { env: { ZHIXIA_USER_DATA: missingUserData } });
    assert.ok(missingSidecar.items.length > 0, "missing sidecar should fall back to existing .codex-knowledge retrieval");
    assert.equal(missingSidecar.memoryFactSidecar.status, "missing", "missing sidecar status should be explicit");
    assert.ok(
      missingSidecar.warnings.includes("memory_fact_sidecar_missing_fallback_to_codex_knowledge"),
      "missing sidecar should surface a compact fallback warning",
    );

    const unavailableSqlite = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha sidecar recall",
      "--json",
    ], { env: { ...sidecarEnv, ZHIXIA_MEMORY_FACT_SQLITE_DISABLED: "1" } });
    assert.ok(unavailableSqlite.items.length > 0, "unavailable node:sqlite should fall back to file knowledge");
    assert.equal(unavailableSqlite.items.some((item) => item.kind === "memory_fact"), false, "disabled node:sqlite must not return sidecar facts");
    assert.ok(
      unavailableSqlite.warnings.includes("memory_fact_sqlite_unavailable_fallback_to_codex_knowledge"),
      "unavailable node:sqlite should surface a compact fallback warning",
    );

    assert.equal(fileSha256(sidecarPath), sidecarHashBefore, "read-only helper access must not change sidecar bytes");

    const walSidecar = createActiveWalMemoryFactSidecar(walUserData, workspace);
    walDb = walSidecar.db;
    const walPath = `${walSidecar.dbPath}-wal`;
    const shmPath = `${walSidecar.dbPath}-shm`;
    assert.equal(fs.existsSync(walPath), true, "active WAL fixture should keep an uncheckpointed WAL file");
    assert.equal(fs.existsSync(shmPath), true, "active WAL fixture should expose SQLite coordination metadata");
    const walSnapshotBefore = sqliteLogicalSnapshot(walDb);
    const walMainHashBefore = fileSha256(walSidecar.dbPath);
    const walHashBefore = fileSha256(walPath);
    const shmHashBefore = fileSha256(shmPath);
    const walContext = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha WAL recall live value",
      "--limit",
      "6",
      "--json",
    ], { env: { ZHIXIA_USER_DATA: walUserData } });
    const walFact = walContext.items.find((item) => item.id === "fact-wal-live");
    assert.ok(walFact, "helper should read the current active-WAL MemoryFact without making a snapshot copy");
    assert.match(walFact.summary, /Live WAL recall value/, "helper should observe the latest uncheckpointed WAL value");
    assert.equal(walContext.memoryFactSidecar.logicalReadOnly, true, "WAL access should be described as logical read-only");
    assert.equal(walContext.memoryFactSidecar.sqlWrites, false, "helper should declare that it issues no SQL writes");
    assert.equal(walContext.memoryFactSidecar.schemaMutation, false, "helper should declare that it performs no schema mutation");
    assert.equal(walContext.memoryFactSidecar.mainDatabaseOrWalWrites, false, "helper should not write main DB or WAL content");
    assert.equal(walContext.memoryFactSidecar.sqliteShmCoordinationMayChange, true, "helper should accurately allow SQLite SHM coordination changes");
    assert.equal(fileSha256(walSidecar.dbPath), walMainHashBefore, "active-WAL helper read must not change main database content");
    assert.equal(fileSha256(walPath), walHashBefore, "active-WAL helper read must not change WAL content");
    assert.deepEqual(sqliteLogicalSnapshot(walDb), walSnapshotBefore, "active-WAL helper read must not change logical rows or schema");
    assert.equal(fs.existsSync(shmPath), true, "SQLite SHM coordination file may remain present after logical read-only access");
    const shmHashAfter = fileSha256(shmPath);
    assert.ok(
      [shmHashBefore, shmHashAfter].every((hash) => /^[0-9a-f]{64}$/.test(hash)),
      "SHM is treated as SQLite coordination metadata; its presence is verified without asserting byte immutability",
    );

    const lockedSidecar = createLockedMemoryFactSidecar(lockedUserData, workspace);
    lockedDb = lockedSidecar.db;
    const lockStartedAt = Date.now();
    const lockedFallback = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha locked fallback",
      "--json",
    ], { env: { ZHIXIA_USER_DATA: lockedUserData }, timeout: 3000 });
    const lockDurationMs = Date.now() - lockStartedAt;
    assert.equal(lockedFallback.memoryFactSidecar.status, "unavailable", "locked sidecar should fail soft instead of throwing");
    assert.ok(lockedFallback.items.length > 0, "locked sidecar should preserve file-contract fallback items");
    assert.equal(lockedFallback.items.some((item) => item.id === "fact-locked"), false, "locked sidecar must not leak a partial fact result");
    assert.ok(
      lockedFallback.warnings.includes("memory_fact_sidecar_unavailable_fallback_to_codex_knowledge"),
      "locked sidecar should surface the existing compact unavailable warning",
    );
    assert.ok(lockDurationMs < 2000, "locked sidecar fallback should remain bounded by the short busy timeout");

    const rgsProductContext = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "Example Project current product engine status accepted UI modules next CEO action not thread maintenance",
      "--query-type",
      "project_resume",
      "--limit",
      "4",
      "--json",
    ]);
    assert.match(rgsProductContext.items[0].title, /Current Accepted Engine/i, "product resume should rank accepted product progress before maintenance logs");
    assert.doesNotMatch(rgsProductContext.items[0].title, /老线程优化|AUDIT/, "maintenance records must not outrank product memory for product queries");
    assert.ok(
      rgsProductContext.items.every((item) => item.memoryLayer !== "cold"),
      "ordinary product queries should not include cold maintenance history by default",
    );

    const recovery = runHelper(workspace, [
      "--recover-thread",
      "--thread-id",
      "11111111-2222-7333-8444-555555555555",
      "--thread-title",
      "Example Project CEO",
      "--query",
      "alpha example-project recovery",
      "--limit",
      "5",
      "--json",
    ]);
    assert.equal(recovery.schemaVersion, "zhixia.thread_recovery_packet.v1", "helper should expose ThreadRecoveryPacket schema");
    assert.equal(recovery.mode, "thread_recovery_packet", "helper recovery mode should be explicit");
    assert.equal(recovery.thread.threadId, "11111111-2222-7333-8444-555555555555", "recovery packet should preserve target threadId");
    assert.equal(recovery.vault.policy, "helper_metadata_only_no_vault_walk", "helper recovery must not walk Thread History Vault");
    assert.equal(recovery.performance.rawSessionBodyRead, false, "helper recovery must not read raw session bodies");
    assert.equal(recovery.performance.startsTimers, false, "helper recovery must not start background timers");
    assert.equal(recovery.safety.archiveCompactDeleteMoveRestore, false, "helper recovery must not archive/compact/delete/move/restore");
    assert.ok(recovery.projectBrainContinuity, "thread recovery should always include a ProjectBrain continuity section");
    assert.equal(recovery.projectBrainContinuity.recoveryReady, false, "missing sidecar continuity must never claim recovery readiness");
    assert.ok(recovery.recommendedReadOrder.some((item) => /EXAMPLE_PROJECT_CEO_RECOVERY_PACKET\.md$/.test(item.path)), "recovery should recommend local recovery docs");
    assert.equal(
      recovery.recommendedReadOrder.some((item) => /EXAMPLE_PROJECT_CEO_TRANSCRIPT_EXTRACT\.md$/.test(item.path)),
      false,
      "giant transcript documents must not be recommended for default reading",
    );
    assert.ok(
      recovery.coldHistorySources.some((item) => /EXAMPLE_PROJECT_CEO_TRANSCRIPT_EXTRACT\.md$/.test(item.path) && item.kind === "large_project_artifact_pointer"),
      "giant transcript documents should remain as cold pointers",
    );
    assert.ok(recovery.warnings.includes("large_recovery_docs_pointer_only"), "giant recovery docs should produce pointer-only warning");
    assert.ok(recovery.context.items.length > 0, "recovery should include compact runtime context items");
    assert.ok(recovery.prompt.includes("不要直接加载原始"), "recovery prompt should warn against loading raw sessions");
    const recoveryText = JSON.stringify(recovery);
    assert.doesNotMatch(recoveryText, /\.codex[\\/]sessions/i, "recovery helper must not leak raw session paths from knowledge excerpts");
    assert.doesNotMatch(recoveryText, /A{120}/, "recovery helper must not leak base64-like payloads");
    assert.doesNotMatch(recoveryText, /DO_NOT_READ_GIANT_TAIL/, "recovery helper must not read giant Markdown tail content");
    assert.doesNotMatch(recoveryText, /DO_NOT_READ_TRANSCRIPT_TAIL/, "recovery helper must not read giant transcript content");

    const pagedRecovery = runHelper(workspace, [
      "--recover-thread",
      "--thread-id",
      "thread-alpha-ceo",
      "--thread-title",
      "Alpha CEO recovery",
      "--project-id",
      "project-alpha",
      "--page-size",
      "3",
      "--query",
      "alpha memory core recovery",
      "--json",
    ], { env: sidecarEnv });
    assert.equal(pagedRecovery.projectBrainContinuity.sidecar.status, "available", "thread recovery should read the project-scoped Memory Core sidecar");
    assert.equal(pagedRecovery.projectBrainContinuity.pagination.requiresContinuation, true, "thread recovery should expose mandatory continuation metadata");
    assert.equal(pagedRecovery.projectBrainContinuity.recoveryReady, false, "thread recovery must not claim readiness before all mandatory pages are consumed");

    const pressure = runHelper(workspace, [
      "--thread-pressure",
      "--thread-id",
      "019f-example-ceo",
      "--session-mb",
      "241.56",
      "--line-count",
      "72370",
      "--max-line-chars",
      "325383",
      "--lines-over-100k",
      "271",
      "--data-image-hits",
      "4779",
      "--base64-hits",
      "5941",
      "--tool-output-like-hits",
      "27438",
      "--json",
    ]);
    assert.equal(pressure.schemaVersion, "zhixia.ceo_memory_runtime_guard.v1", "helper should expose CEO pressure schema");
    assert.equal(pressure.action, "freeze_risk_stop_dispatch", "helper pressure mode should stop dispatch for giant image/base64 threads");
    assert.equal(pressure.performance.startsTimers, false, "helper pressure mode must not start timers");
    assert.equal(pressure.performance.scansVault, false, "helper pressure mode must not scan vault");
    assert.equal(pressure.performance.readsRawSessionBody, false, "helper pressure mode must not read raw session bodies");

    const takeover = runHelper(workspace, [
      "--ceo-takeover",
      "--project-name",
      "Example Project",
      "--thread-id",
      "019f-example-ceo",
      "--current-ceo-thread-id",
      "019f-example-ceo",
      "--stale-thread-ids",
      "019f-old-a,019f-old-b",
      "--query",
      "alpha example project CEO takeover",
      "--session-mb",
      "241.56",
      "--data-image-hits",
      "4779",
      "--base64-hits",
      "5941",
      "--json",
    ]);
    assert.equal(takeover.schemaVersion, "zhixia.ceo_takeover_bootstrap_packet.v1", "helper should expose CEO takeover bootstrap schema");
    assert.equal(takeover.mode, "ceo_takeover_bootstrap_packet", "helper takeover mode should be explicit");
    assert.equal(takeover.threadPressure.action, "freeze_risk_stop_dispatch", "takeover should include pressure gate");
    assert.equal(takeover.recallPlan.coldLayer.defaultRead, false, "takeover cold layer should stay pointer-only");
    assert.equal(takeover.safety.rawSessionBodyRead, false, "takeover helper must not read raw session bodies");
    assert.equal(takeover.safety.startsTimers, false, "takeover helper must not start timers");
    assert.ok(takeover.oneLinePrompt.includes("Hot/Warm/Skill"), "takeover helper prompt should name layered memory");
    const takeoverText = JSON.stringify(takeover);
    assert.doesNotMatch(takeoverText, /\.codex[\\/]sessions/i, "takeover helper must not leak raw session paths");
    assert.doesNotMatch(takeoverText, /A{120}/, "takeover helper must not leak base64-like payloads");
    assert.doesNotMatch(takeoverText, /DO_NOT_READ_TRANSCRIPT_TAIL/, "takeover helper must not read giant transcript content");

    const precedent = runHelper(workspace, ["--precedent", "alpha", "--limit", "5", "--json"]);
    assert.equal(precedent.mode, "runtime_precedent_packet", "precedent mode should be explicit");
    assert.equal(precedent.precedentPolicy.rawSessionDefaultRead, false, "precedent should declare no raw session default read");
    assert.equal(precedent.precedentPolicy.giantMarkdownDefaultRead, false, "precedent should declare no giant Markdown default read");
    assert.ok(
      precedent.items.every((item) => ["knowledge_item", "experience_card", "project_artifact", "tool_skill_record", "skill_candidate"].includes(item.kind)),
      "precedent should stay within bounded metadata-first kinds",
    );

    const evidencePath = path.join(workspace, "evidence.json");
    const siblingEvidencePath = path.join(siblingEscape, "evidence.json");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        decision: "accept",
        task: { id: "TASK-ALPHA", goal: "Accept helper lifecycle", domain: ["memory-runtime"] },
        evidence: {
          summary: "Helper produced compact lifecycle packets.",
          reusablePattern: ["Use runtime helper modes before dispatch and after acceptance."],
          tests: ["node tests/zhixia-local-docs-helper.test.cjs"],
          sourceRefs: [{ kind: "project_artifact", path: path.join(workspace, "docs", "TEST_PLAN.md"), title: "Test plan" }],
        },
        privacy: { containsRawSession: false, containsSecrets: false, publicCandidateAllowed: false },
      }),
      "utf8",
    );
    fs.writeFileSync(siblingEvidencePath, JSON.stringify({ decision: "accept" }), "utf8");
    const writeback = runHelper(workspace, [
      "--writeback-dry-run",
      "--evidence-json",
      evidencePath,
      "--evidence-out",
      ".codex-knowledge/writeback-preview.json",
      "--json",
    ]);
    assert.equal(writeback.mode, "evidence_writeback_packet_dry_run", "writeback helper should generate dry-run evidence packet");
    assert.equal(writeback.receiptPreview.runsFlowSkill, false, "writeback dry-run must not run FlowSkill");
    assert.equal(writeback.receiptPreview.installsOrExecutes, false, "writeback dry-run must not install or execute");
    assert.equal(writeback.receiptPreview.archiveCompactDeleteMoveRestore, false, "writeback dry-run must not archive/compact/delete/move/restore");
    assert.equal(writeback.writeback.flowSkillCandidate?.visibility, "private", "accepted reusable evidence should preview a private candidate");
    assert.equal(writeback.writeback.flowSkillCandidate?.status, "private_review", "accepted reusable evidence should stay review-only");
    assert.equal(writeback.writeback.flowSkillCandidate?.effects.runsFlowSkill, false, "candidate preview must not run FlowSkill");
    assert.equal(writeback.writeback.flowSkillCandidate?.promotion.captureDryRunOnly, true, "candidate preview must stay dry-run only");
    assert.ok(fs.existsSync(path.join(workspace, ".codex-knowledge", "writeback-preview.json")), "writeback preview may be written inside workspace only");

    const noSourceEvidencePath = path.join(workspace, "evidence-nosource.json");
    fs.writeFileSync(
      noSourceEvidencePath,
      JSON.stringify({
        decision: "accept",
        task: { id: "TASK-NOSOURCE", goal: "No source helper evidence", domain: ["memory-runtime"] },
        evidence: {
          summary: "Accepted reusable evidence without source refs.",
          reusablePattern: ["Do not preview FlowSkill candidate without source refs."],
        },
      }),
      "utf8",
    );
    const noSourceWriteback = runHelper(workspace, ["--writeback-dry-run", "--evidence-json", noSourceEvidencePath, "--json"]);
    assert.equal(noSourceWriteback.writeback.flowSkillCandidate, null, "no-source reusable evidence must not preview FlowSkill candidate");
    assert.ok(noSourceWriteback.warnings.includes("missing_source_refs_candidate_only"), "no-source dry-run should warn candidate-only review");
    assert.equal(noSourceWriteback.receiptPreview.status, "dry_run", "no-source dry-run should remain preview-only, not fail as unsafe");

    runHelperFailure(workspace, ["--writeback-dry-run", "--evidence-json", siblingEvidencePath, "--json"]);
    runHelperFailure(workspace, ["--writeback-dry-run", "--evidence-json", path.join("..", path.basename(siblingEscape), "evidence.json"), "--json"]);
    runHelperFailure(workspace, [
      "--writeback-dry-run",
      "--evidence-json",
      evidencePath,
      "--evidence-out",
      path.join(siblingEscape, "writeback-preview.json"),
      "--json",
    ]);
    runHelperFailure(workspace, [
      "--writeback-dry-run",
      "--evidence-json",
      evidencePath,
      "--evidence-out",
      path.join("..", path.basename(siblingEscape), "writeback-preview.json"),
      "--json",
    ]);
    if (escapeLinkCreated) {
      runHelperFailure(workspace, [
        "--writeback-dry-run",
        "--evidence-json",
        path.join("escape-link", "evidence.json"),
        "--json",
      ]);
      runHelperFailure(workspace, [
        "--writeback-dry-run",
        "--evidence-json",
        evidencePath,
        "--evidence-out",
        path.join("escape-link", "writeback-preview.json"),
        "--json",
      ]);
    }
  } finally {
    if (lockedDb) {
      try {
        lockedDb.exec("ROLLBACK");
      } catch {}
      lockedDb.close();
    }
    if (walDb) walDb.close();
    if (escapeLinkCreated) {
      try {
        fs.rmSync(escapeLink, { force: true });
      } catch {}
    }
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(siblingEscape, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(missingUserData, { recursive: true, force: true });
    fs.rmSync(schemaMissingUserData, { recursive: true, force: true });
    fs.rmSync(walUserData, { recursive: true, force: true });
    fs.rmSync(lockedUserData, { recursive: true, force: true });
  }
  if (process.env.ZHIXIA_HELPER_PERF === "1") console.log(`ZHIXIA_HELPER_PERF ${JSON.stringify(performanceSample)}`);
}

main();
console.log("Zhixia local-docs helper lifecycle tests passed.");
