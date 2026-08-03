const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { DatabaseSync } = require("node:sqlite");
const {
  buildMemoryCoreContinuityStatus,
  buildRuntimeContextPacket,
  buildRuntimePrecedentPacket,
  collectResults,
  hasKnowledgeFiles,
} = require("./read-project-knowledge.cjs");
const {
  deriveProjectIdentityEnvelope,
  pathBelongsToProject,
} = require("./project-identity.cjs");

const HEADLESS_SCHEMA = "zhixia.memory_runtime_headless.v1";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 2400;
const MAX_SOURCE_REFS = 24;
const RAW_SESSION_RE = /(?:\.codex[\\/]sessions|raw[_ -]?session|session\.jsonl|rollout-.*\.jsonl)/i;
const SECRET_RE = /(?:api[_ -]?key|access[_ -]?token|private[_ -]?key|password|authorization|bearer\s+[a-z0-9._-]+|\bsk-[a-z0-9_-]{12,}|\bghp_[a-z0-9]{12,}|\bgithub_pat_[a-z0-9_]{12,}|\bAKIA[A-Z0-9]{16}\b)/i;
const BASE64_RE = /(?:data:[^;]+;base64,|[A-Za-z0-9+/]{240,}={0,2})/;
const WORKER_TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKER_AGENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const WORKER_TASK_STATUSES = new Set(["queued", "running", "waiting", "completed", "failed", "cancelled"]);
const WORKER_TASK_ACTIVE_STATUSES = new Set(["queued", "running", "waiting"]);
const WORKER_TASK_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function compact(value, max = MAX_TEXT_CHARS) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function resolveUserData(env = process.env) {
  if (env.ZHIXIA_USER_DATA) return path.resolve(env.ZHIXIA_USER_DATA);
  const home = os.homedir();
  if (process.platform === "win32") return path.join(env.APPDATA || path.join(home, ["App", "Data"].join(""), "Roaming"), "知匣 Local Doc Knowledge");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "知匣 Local Doc Knowledge");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "知匣 Local Doc Knowledge");
}

function databasePath(env = process.env) {
  return path.join(resolveUserData(env), "memory-runtime", "memory-runtime-index.sqlite");
}

function readRequest(argv = process.argv.slice(2)) {
  const index = argv.indexOf("--request-json");
  const raw = index >= 0 ? String(argv[index + 1] || "") : fs.readFileSync(0, "utf8");
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new Error("request_json_missing_or_too_large");
  const request = JSON.parse(raw);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("request_json_object_required");
  return request;
}

function unsafeText(value) {
  const text = String(value == null ? "" : value);
  return RAW_SESSION_RE.test(text) || SECRET_RE.test(text) || BASE64_RE.test(text);
}

function normalizeSourceRefs(sourceRefs, identity) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length > MAX_SOURCE_REFS) throw new Error("source_refs_invalid_or_too_many");
  const normalized = [];
  const seen = new Set();
  for (const ref of sourceRefs) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error("source_ref_object_required");
    const projectId = compact(ref.projectId || identity.projectId, 120);
    if (projectId !== identity.projectId) throw new Error("cross_project_source_ref_rejected");
    const rawPath = compact(ref.path || ref.uri || "", 600);
    const kind = compact(ref.kind || "source", 80) || "source";
    const title = compact(ref.title || "evidence", 240) || "evidence";
    const hash = compact(ref.hash || ref.sha256 || "", 160) || null;
    if (unsafeText(`${kind} ${rawPath} ${title}`)) throw new Error("unsafe_source_ref_rejected");
    if (rawPath) {
      if (/^file:\/\//i.test(rawPath)) {
        if (!pathBelongsToProject(fileURLToPath(rawPath), identity)) throw new Error("cross_project_source_ref_rejected");
      } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
        const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(identity.worktreeRoot, rawPath);
        if (!pathBelongsToProject(candidate, identity)) throw new Error("cross_project_source_ref_rejected");
      } else if (!/^(?:https?|git|memory-runtime):\/\//i.test(rawPath)) {
        throw new Error("unsupported_source_ref_scheme");
      }
    }
    const item = { kind, path: rawPath || null, title, hash, projectId };
    const key = [item.kind, item.path, item.hash, item.title].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

function openDatabase(env = process.env) {
  const dbPath = databasePath(env);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 1000;
    CREATE TABLE IF NOT EXISTS headless_project_identities (
      projectId TEXT PRIMARY KEY, canonicalRepoId TEXT NOT NULL, canonicalRoot TEXT NOT NULL,
      envelopeJson TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS headless_runtime_events (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL, canonicalRoot TEXT NOT NULL,
      eventType TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
      sourceRefsJson TEXT NOT NULL, createdAt TEXT NOT NULL, contentHash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_headless_events_project ON headless_runtime_events(projectId, canonicalRoot, createdAt DESC);
    CREATE TABLE IF NOT EXISTS headless_evidence_writebacks (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL, canonicalRoot TEXT NOT NULL,
      decision TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
      sourceRefsJson TEXT NOT NULL, createdAt TEXT NOT NULL, contentHash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_headless_writebacks_project ON headless_evidence_writebacks(projectId, canonicalRoot, createdAt DESC);
    CREATE TABLE IF NOT EXISTS headless_trigger_receipts (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL, action TEXT NOT NULL,
      status TEXT NOT NULL, requestHash TEXT NOT NULL, resultRef TEXT,
      createdAt TEXT NOT NULL, receiptJson TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_headless_receipts_project ON headless_trigger_receipts(projectId, createdAt DESC);
    CREATE TABLE IF NOT EXISTS headless_worker_tasks (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL, canonicalRoot TEXT NOT NULL,
      agent TEXT NOT NULL, taskId TEXT NOT NULL, status TEXT NOT NULL,
      title TEXT NOT NULL, summary TEXT NOT NULL, progressPct INTEGER,
      sourceRefsJson TEXT NOT NULL, startedAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      completedAt TEXT, contentHash TEXT NOT NULL,
      UNIQUE(projectId, agent, taskId)
    );
    CREATE INDEX IF NOT EXISTS idx_headless_worker_tasks_project ON headless_worker_tasks(projectId, status, updatedAt DESC);
    CREATE TABLE IF NOT EXISTS headless_worker_task_events (
      id TEXT PRIMARY KEY, workerTaskId TEXT NOT NULL, projectId TEXT NOT NULL,
      agent TEXT NOT NULL, taskId TEXT NOT NULL, status TEXT NOT NULL,
      summary TEXT NOT NULL, progressPct INTEGER, sourceRefsJson TEXT NOT NULL,
      createdAt TEXT NOT NULL, contentHash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_headless_worker_events_task ON headless_worker_task_events(projectId, workerTaskId, createdAt DESC);
  `);
  return { db, dbPath };
}

function persistIdentity(db, identity, now) {
  db.prepare(`INSERT INTO headless_project_identities(projectId, canonicalRepoId, canonicalRoot, envelopeJson, updatedAt)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(projectId) DO UPDATE SET canonicalRepoId=excluded.canonicalRepoId, canonicalRoot=excluded.canonicalRoot,
      envelopeJson=excluded.envelopeJson, updatedAt=excluded.updatedAt`).run(
    identity.projectId, identity.canonicalRepoId, identity.canonicalRoot, JSON.stringify(identity), now,
  );
}

function receiptFor(db, identity, action, request, status, resultRef, now) {
  const requestHash = sha256(JSON.stringify(request));
  const id = `receipt-${sha256(`${identity.projectId}|${action}|${requestHash}|${resultRef || ""}`).slice(0, 32)}`;
  const receipt = {
    schemaVersion: HEADLESS_SCHEMA,
    id,
    projectId: identity.projectId,
    action,
    status,
    requestHash,
    resultRef: resultRef || null,
    createdAt: now,
    safety: { rawSessionBodyRead: false, mainDatabaseWrite: false, uiRequired: false },
  };
  db.prepare(`INSERT OR REPLACE INTO headless_trigger_receipts(id, projectId, action, status, requestHash, resultRef, createdAt, receiptJson)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(id, identity.projectId, action, status, requestHash, resultRef || null, now, JSON.stringify(receipt));
  return receipt;
}

function baseContext(request) {
  const requestWorkspace = path.resolve(request.workspace || process.cwd());
  const identity = deriveProjectIdentityEnvelope(requestWorkspace, { expected: request.projectIdentity });
  const memoryWorkspace = hasKnowledgeFiles(requestWorkspace) ? requestWorkspace
    : hasKnowledgeFiles(identity.canonicalRoot) ? identity.canonicalRoot : requestWorkspace;
  const options = {
    query: compact(request.taskGoal || request.taskType || request.query || "", 600),
    taskGoal: compact(request.taskGoal || request.taskType || request.query || "", 600),
    queryType: compact(request.queryType || "task_dispatch", 80),
    includeKinds: Array.isArray(request.includeKinds) ? request.includeKinds.slice(0, 20).map((item) => compact(item, 80)) : [],
    runtimeContext: true,
    precedent: request.action === "retrieve_precedent",
    recoverThread: false,
    ceoTakeover: false,
    allowColdLayer: request.allowColdLayer === true,
    allowParentKnowledge: false,
    limit: Math.max(1, Math.min(Number(request.limit || 8), 20)),
    tokenBudget: Math.max(200, Math.min(Number(request.tokenBudget || 1200), 4000)),
    requestWorkspace,
    projectIdentity: identity,
    projectId: compact(request.projectId || "", 180),
  };
  return { requestWorkspace, memoryWorkspace, identity, options };
}

function retrieve(request, precedent = false) {
  const context = baseContext({ ...request, action: precedent ? "retrieve_precedent" : "retrieve_context" });
  const retrieval = collectResults(context.memoryWorkspace, context.options);
  const packet = precedent
    ? buildRuntimePrecedentPacket(retrieval, context.options)
    : buildRuntimeContextPacket(retrieval, context.options);
  const { db } = openDatabase();
  try {
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    persistIdentity(db, context.identity, now);
    const receipt = receiptFor(db, context.identity, precedent ? "retrieve_precedent" : "retrieve_context", request, "completed", null, now);
    db.exec("COMMIT");
    return { ...packet, triggerReceipt: receipt };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function writeRecord(request, action) {
  const context = baseContext(request);
  const title = compact(request.title || request.eventType || action, 240);
  const summary = compact(request.summary || request.result || request.observation || "", MAX_TEXT_CHARS);
  const decision = compact(request.decision || "accept", 40).toLowerCase();
  if (!title || !summary || unsafeText(`${title} ${summary}`)) throw new Error("unsafe_or_empty_compact_payload_rejected");
  const sourceRefs = normalizeSourceRefs(request.sourceRefs || [], context.identity);
  if (action === "writeback_evidence" && decision === "accept" && sourceRefs.length === 0) throw new Error("accepted_writeback_requires_source_refs");
  const now = new Date().toISOString();
  const contentHash = sha256(JSON.stringify({ projectId: context.identity.projectId, action, decision, title, summary, sourceRefs }));
  const id = `${action === "observe_event" ? "event" : "evidence"}-${contentHash.slice(0, 32)}`;
  const { db, dbPath } = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    persistIdentity(db, context.identity, now);
    if (action === "observe_event") {
      db.prepare(`INSERT OR IGNORE INTO headless_runtime_events(id, projectId, canonicalRoot, eventType, title, summary, sourceRefsJson, createdAt, contentHash)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, context.identity.projectId, context.identity.canonicalRoot, compact(request.eventType || "observation", 80), title, summary, JSON.stringify(sourceRefs), now, contentHash);
    } else {
      db.prepare(`INSERT OR IGNORE INTO headless_evidence_writebacks(id, projectId, canonicalRoot, decision, title, summary, sourceRefsJson, createdAt, contentHash)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, context.identity.projectId, context.identity.canonicalRoot, decision, title, summary, JSON.stringify(sourceRefs), now, contentHash);
    }
    const receipt = receiptFor(db, context.identity, action, request, "completed", `memory-runtime://headless/${action}/${id}`, now);
    db.exec("COMMIT");
    return {
      schemaVersion: HEADLESS_SCHEMA,
      action,
      status: "completed",
      id,
      projectIdentity: context.identity,
      sourceRefs,
      triggerReceipt: receipt,
      storage: { path: dbPath, mainDatabaseWrite: false, uiRequired: false },
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function continuity(request) {
  const context = baseContext(request);
  const packet = buildMemoryCoreContinuityStatus(context.memoryWorkspace, { ...context.options, cursor: request.cursor || null, pageSize: request.pageSize || 20 });
  return { ...packet, projectIdentity: context.identity, requestWorkspace: context.requestWorkspace };
}

function listReceipts(request) {
  const context = baseContext(request);
  const { db } = openDatabase();
  try {
    const limit = Math.max(1, Math.min(Number(request.limit || 20), 100));
    const rows = db.prepare(`SELECT receiptJson FROM headless_trigger_receipts WHERE projectId = ? ORDER BY createdAt DESC LIMIT ?`).all(context.identity.projectId, limit);
    return { schemaVersion: HEADLESS_SCHEMA, action: "list_trigger_receipts", projectIdentity: context.identity, receipts: rows.map((row) => JSON.parse(row.receiptJson)) };
  } finally { db.close(); }
}

function normalizeWorkerTaskStatus(request) {
  const agent = compact(request.agent || "external-worker", 80).toLowerCase();
  const taskId = compact(request.taskId || "", 128);
  const status = compact(request.status || "", 40).toLowerCase();
  const title = compact(request.title || taskId, 240);
  const summary = compact(request.summary || request.progress || status, MAX_TEXT_CHARS);
  if (!WORKER_AGENT_RE.test(agent)) throw new Error("worker_agent_invalid");
  if (!WORKER_TASK_ID_RE.test(taskId)) throw new Error("worker_task_id_invalid");
  if (!WORKER_TASK_STATUSES.has(status)) throw new Error("worker_task_status_invalid");
  if (!title || !summary || unsafeText(`${agent} ${taskId} ${title} ${summary}`)) {
    throw new Error("unsafe_or_empty_worker_task_payload_rejected");
  }
  let progressPct = request.progressPct;
  if (progressPct !== undefined && progressPct !== null) {
    progressPct = Number(progressPct);
    if (!Number.isInteger(progressPct) || progressPct < 0 || progressPct > 100) {
      throw new Error("worker_task_progress_invalid");
    }
  } else {
    progressPct = status === "completed" ? 100 : null;
  }
  if (status === "completed") progressPct = 100;
  return { agent, taskId, status, title, summary, progressPct };
}

function parseWorkerTaskRow(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    agent: row.agent,
    taskId: row.taskId,
    status: row.status,
    title: row.title,
    summary: row.summary,
    progressPct: row.progressPct,
    sourceRefs: JSON.parse(row.sourceRefsJson || "[]"),
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt || null,
    authority: { selfReported: true, acceptedEvidence: false, recoveryAuthority: false },
  };
}

function reportWorkerTaskStatus(request) {
  const context = baseContext(request);
  const normalized = normalizeWorkerTaskStatus(request);
  const sourceRefs = normalizeSourceRefs(request.sourceRefs || [], context.identity);
  const workerTaskId = `worker-task-${sha256(`${context.identity.projectId}|${normalized.agent}|${normalized.taskId}`).slice(0, 32)}`;
  const now = new Date().toISOString();
  const { db, dbPath } = openDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    persistIdentity(db, context.identity, now);
    const existing = db.prepare(`SELECT * FROM headless_worker_tasks WHERE id = ? AND projectId = ?`).get(workerTaskId, context.identity.projectId);
    if (existing && WORKER_TASK_TERMINAL_STATUSES.has(existing.status)) {
      if (!WORKER_TASK_TERMINAL_STATUSES.has(normalized.status)) throw new Error("terminal_worker_task_reopen_rejected");
      if (existing.status !== normalized.status) throw new Error("terminal_worker_task_status_conflict");
    }
    if (
      existing
      && existing.progressPct !== null
      && normalized.progressPct !== null
      && normalized.progressPct < existing.progressPct
    ) {
      throw new Error("worker_task_progress_regression_rejected");
    }
    const effectiveProgress = normalized.progressPct === null ? (existing?.progressPct ?? null) : normalized.progressPct;
    const contentHash = sha256(JSON.stringify({
      projectId: context.identity.projectId,
      workerTaskId,
      ...normalized,
      progressPct: effectiveProgress,
      sourceRefs,
    }));
    const unchanged = existing?.contentHash === contentHash;
    const completedAt = WORKER_TASK_TERMINAL_STATUSES.has(normalized.status)
      ? (existing?.completedAt || now)
      : null;
    if (!unchanged) {
      db.prepare(`INSERT INTO headless_worker_tasks(
        id, projectId, canonicalRoot, agent, taskId, status, title, summary, progressPct,
        sourceRefsJson, startedAt, updatedAt, completedAt, contentHash
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, title=excluded.title,
        summary=excluded.summary, progressPct=excluded.progressPct,
        sourceRefsJson=excluded.sourceRefsJson, updatedAt=excluded.updatedAt,
        completedAt=excluded.completedAt, contentHash=excluded.contentHash`).run(
        workerTaskId, context.identity.projectId, context.identity.canonicalRoot,
        normalized.agent, normalized.taskId, normalized.status, normalized.title,
        normalized.summary, effectiveProgress, JSON.stringify(sourceRefs),
        existing?.startedAt || now, now, completedAt, contentHash,
      );
      const eventId = `worker-event-${contentHash.slice(0, 32)}`;
      db.prepare(`INSERT OR IGNORE INTO headless_worker_task_events(
        id, workerTaskId, projectId, agent, taskId, status, summary, progressPct,
        sourceRefsJson, createdAt, contentHash
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        eventId, workerTaskId, context.identity.projectId, normalized.agent,
        normalized.taskId, normalized.status, normalized.summary, effectiveProgress,
        JSON.stringify(sourceRefs), now, contentHash,
      );
    }
    const stored = db.prepare(`SELECT * FROM headless_worker_tasks WHERE id = ? AND projectId = ?`).get(workerTaskId, context.identity.projectId);
    const receipt = receiptFor(
      db,
      context.identity,
      "report_worker_task_status",
      request,
      "completed",
      `memory-runtime://headless/worker-task/${workerTaskId}`,
      now,
    );
    db.exec("COMMIT");
    return {
      schemaVersion: HEADLESS_SCHEMA,
      action: "report_worker_task_status",
      status: "completed",
      changed: !unchanged,
      task: parseWorkerTaskRow(stored),
      projectIdentity: context.identity,
      triggerReceipt: receipt,
      storage: { path: dbPath, mainDatabaseWrite: false, uiRequired: false },
      polling: { required: false, heartbeatCreated: false },
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function listWorkerTasks(request) {
  const context = baseContext(request);
  const agent = request.agent ? compact(request.agent, 80).toLowerCase() : null;
  if (agent && !WORKER_AGENT_RE.test(agent)) throw new Error("worker_agent_invalid");
  const includeTerminal = request.includeTerminal === true;
  const limit = Math.max(1, Math.min(Number(request.limit || 20), 100));
  const { db } = openDatabase();
  try {
    const rows = db.prepare(`SELECT * FROM headless_worker_tasks WHERE projectId = ? ORDER BY updatedAt DESC LIMIT ?`).all(
      context.identity.projectId,
      Math.min(limit * 5, 500),
    );
    const tasks = rows
      .filter((row) => !agent || row.agent === agent)
      .filter((row) => includeTerminal || WORKER_TASK_ACTIVE_STATUSES.has(row.status))
      .slice(0, limit)
      .map(parseWorkerTaskRow);
    return {
      schemaVersion: HEADLESS_SCHEMA,
      action: "list_worker_tasks",
      projectIdentity: context.identity,
      tasks,
      counts: {
        returned: tasks.length,
        active: tasks.filter((task) => WORKER_TASK_ACTIVE_STATUSES.has(task.status)).length,
        terminal: tasks.filter((task) => WORKER_TASK_TERMINAL_STATUSES.has(task.status)).length,
      },
      query: { agent, includeTerminal, limit },
      authority: { selfReported: true, acceptedEvidence: false, recoveryAuthority: false },
    };
  } finally { db.close(); }
}

function execute(request) {
  switch (request.action) {
    case "retrieve_context": return retrieve(request, false);
    case "retrieve_precedent": return retrieve(request, true);
    case "observe_event": return writeRecord(request, "observe_event");
    case "writeback_evidence": return writeRecord(request, "writeback_evidence");
    case "continuity": return continuity(request);
    case "list_trigger_receipts": return listReceipts(request);
    case "report_worker_task_status": return reportWorkerTaskStatus(request);
    case "list_worker_tasks": return listWorkerTasks(request);
    default: throw new Error("unsupported_action");
  }
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(execute(readRequest()))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: HEADLESS_SCHEMA, status: "error", error: compact(error?.message || error, 240) })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { databasePath, execute, normalizeSourceRefs };
