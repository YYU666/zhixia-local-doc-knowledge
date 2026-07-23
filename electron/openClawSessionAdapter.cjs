const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_MAX_STATE_ROOTS = 3;
const DEFAULT_MAX_AGENTS = 16;
const DEFAULT_MAX_SESSIONS = 40;
const DEFAULT_MAX_TASKS = 80;
const DEFAULT_MAX_INDEX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TASK_DB_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_FILE_STATS = 48;

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function compactText(value, maxChars = 240) {
  return String(value || "")
    .replace(/\b(?:sk|ghp|gho|github_pat)-?[A-Za-z0-9_-]{12,}\b/gi, "[redacted]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function toIso(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizeStatus(value) {
  const status = String(value || "").toLowerCase();
  if (["running", "queued", "active", "working"].includes(status)) return "running";
  if (["failed", "timed_out", "timeout", "error", "lost"].includes(status)) return "systemError";
  if (["succeeded", "completed", "complete", "cancelled", "idle"].includes(status)) return "idle";
  return "unknown";
}

function defaultStateRoots(options = {}) {
  const roots = [
    process.env.OPENCLAW_STATE_DIR,
    path.join(os.homedir(), ".openclaw-ceoflow"),
    path.join(os.homedir(), ".openclaw"),
  ];
  const requested = Array.isArray(options.stateRoots) ? options.stateRoots : roots;
  const seen = new Set();
  return requested
    .map((value) => value ? path.resolve(String(value)) : null)
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

function readTaskMetadata(stateRoot, options = {}) {
  const maxTasks = clampInteger(options.maxTasks, DEFAULT_MAX_TASKS, 1, 500);
  const maxTaskDbBytes = clampInteger(options.maxTaskDbBytes, DEFAULT_MAX_TASK_DB_BYTES, 1024, 256 * 1024 * 1024);
  const dbPath = path.join(stateRoot, "state", "openclaw.sqlite");
  if (!fs.existsSync(dbPath)) return { tasks: [], warnings: [] };
  const stat = fs.statSync(dbPath);
  if (stat.size > maxTaskDbBytes) return { tasks: [], warnings: ["openclaw_task_db_exceeds_read_budget"] };
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 50;");
    const rows = db.prepare(`
      SELECT task_id, runtime, task_kind, requester_session_key, child_session_key,
             agent_id, run_id, label, status, created_at, started_at, ended_at, last_event_at
      FROM task_runs
      ORDER BY COALESCE(last_event_at, created_at, 0) DESC
      LIMIT ?
    `).all(maxTasks);
    return {
      tasks: rows.map((row) => ({
        taskId: compactText(row.task_id, 180),
        runtime: compactText(row.runtime, 40),
        taskKind: compactText(row.task_kind, 80) || null,
        requesterSessionKey: compactText(row.requester_session_key, 220) || null,
        childSessionKey: compactText(row.child_session_key, 220) || null,
        agentId: compactText(row.agent_id, 120) || null,
        runId: compactText(row.run_id, 180) || null,
        label: compactText(row.label, 180) || null,
        status: compactText(row.status, 40) || "unknown",
        createdAt: toIso(row.created_at),
        startedAt: toIso(row.started_at),
        endedAt: toIso(row.ended_at),
        lastEventAt: toIso(row.last_event_at),
      })),
      warnings: [],
    };
  } catch (error) {
    return { tasks: [], warnings: [`openclaw_task_metadata_unavailable:${compactText(error.message || error, 160)}`] };
  } finally {
    try { db?.close(); } catch {}
  }
}

function collectOpenClawMetadata(options = {}) {
  const maxStateRoots = clampInteger(options.maxStateRoots, DEFAULT_MAX_STATE_ROOTS, 1, 8);
  const maxAgents = clampInteger(options.maxAgents, DEFAULT_MAX_AGENTS, 1, 64);
  const maxSessions = clampInteger(options.maxSessions, DEFAULT_MAX_SESSIONS, 1, 500);
  const maxTasks = clampInteger(options.maxTasks, DEFAULT_MAX_TASKS, 1, 500);
  const maxIndexBytes = clampInteger(options.maxIndexBytes, DEFAULT_MAX_INDEX_BYTES, 1024, 16 * 1024 * 1024);
  const maxFileStats = clampInteger(options.maxFileStats, DEFAULT_MAX_FILE_STATS, 0, 500);
  const stateRoots = defaultStateRoots(options).slice(0, maxStateRoots);
  const warnings = [];
  const sessions = [];
  const tasks = [];
  let indexFilesRead = 0;
  let indexBytesRead = 0;
  let fileStatCount = 0;

  for (const stateRoot of stateRoots) {
    if (!fs.existsSync(stateRoot)) continue;
    const taskResult = readTaskMetadata(stateRoot, options);
    tasks.push(...taskResult.tasks.map((task) => ({ ...task, stateRoot })));
    warnings.push(...taskResult.warnings);
    const taskBySessionKey = new Map();
    for (const task of taskResult.tasks) {
      for (const key of [task.childSessionKey, task.requesterSessionKey]) {
        if (key && !taskBySessionKey.has(key)) taskBySessionKey.set(key, task);
      }
    }

    const agentsRoot = path.join(stateRoot, "agents");
    if (!fs.existsSync(agentsRoot)) continue;
    let agentDirs = [];
    try {
      agentDirs = fs.readdirSync(agentsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).slice(0, maxAgents);
    } catch (error) {
      warnings.push(`openclaw_agent_index_unavailable:${compactText(error.message || error, 160)}`);
      continue;
    }
    for (const agentEntry of agentDirs) {
      const agentId = compactText(agentEntry.name, 120);
      const sessionsRoot = path.join(agentsRoot, agentEntry.name, "sessions");
      const indexPath = path.join(sessionsRoot, "sessions.json");
      if (!fs.existsSync(indexPath)) continue;
      try {
        const stat = fs.statSync(indexPath);
        if (stat.size > maxIndexBytes) {
          warnings.push(`openclaw_session_index_exceeds_read_budget:${agentId}`);
          continue;
        }
        const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        indexFilesRead += 1;
        indexBytesRead += stat.size;
        const entries = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.entries(parsed) : [];
        entries.sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0));
        for (const [sessionKey, record] of entries) {
          if (!record || typeof record !== "object") continue;
          const sessionId = compactText(record.sessionId || sessionKey, 180);
          if (!sessionId) continue;
          let sessionPath = null;
          let sessionBytes = 0;
          let lastWriteTime = toIso(record.updatedAt || record.lastInteractionAt || record.endedAt);
          if (record.sessionFile && fileStatCount < maxFileStats) {
            const candidate = path.isAbsolute(String(record.sessionFile))
              ? path.resolve(String(record.sessionFile))
              : path.resolve(sessionsRoot, String(record.sessionFile));
            if (isContained(sessionsRoot, candidate)) {
              fileStatCount += 1;
              if (fs.existsSync(candidate)) {
                const sessionStat = fs.statSync(candidate);
                sessionPath = candidate;
                sessionBytes = sessionStat.size;
                lastWriteTime = lastWriteTime || sessionStat.mtime.toISOString();
              }
            } else {
              warnings.push(`openclaw_session_path_escape_rejected:${agentId}`);
            }
          }
          const task = taskBySessionKey.get(sessionKey) || null;
          sessions.push({
            id: `openclaw:${agentId}:${sessionId}`,
            platform: "openclaw",
            threadId: sessionId,
            title: compactText(sessionKey.split(":").slice(2).join(":") || sessionId, 220),
            projectPath: null,
            status: normalizeStatus(task?.status || record.status),
            sessionPath,
            sessionBytes,
            lastWriteTime,
            memoryPointers: [`openclaw://${agentId}/sessions/${sessionId}`],
            observedProcessIds: [],
            attributionConfidence: task ? "medium" : "low",
            evidence: ["openclaw_sessions_json_metadata", task ? "openclaw_task_ledger_link" : "openclaw_task_link_unavailable", "raw_session_body_not_read"],
            openClaw: {
              stateRoot,
              agentId,
              sessionKey: compactText(sessionKey, 220),
              model: compactText(record.model, 160) || null,
              provider: compactText(record.modelProvider, 120) || null,
              totalTokens: Number.isFinite(Number(record.totalTokens)) ? Number(record.totalTokens) : null,
              contextTokens: Number.isFinite(Number(record.contextTokens)) ? Number(record.contextTokens) : null,
              compactionCount: Number.isFinite(Number(record.compactionCount)) ? Number(record.compactionCount) : 0,
              taskId: task?.taskId || null,
              taskStatus: task?.status || null,
              runId: task?.runId || null,
            },
          });
          if (sessions.length >= maxSessions) break;
        }
      } catch (error) {
        warnings.push(`openclaw_session_metadata_unavailable:${agentId}:${compactText(error.message || error, 160)}`);
      }
      if (sessions.length >= maxSessions) break;
    }
    if (sessions.length >= maxSessions) break;
  }

  sessions.sort((left, right) => Date.parse(right.lastWriteTime || 0) - Date.parse(left.lastWriteTime || 0));
  return {
    ok: true,
    sessions: sessions.slice(0, maxSessions),
    tasks: tasks.slice(0, maxTasks),
    warnings: Array.from(new Set(warnings)),
    provenance: {
      adapter: "openclaw_session_task_metadata_v1",
      stateRoots: stateRoots.filter((root) => fs.existsSync(root)),
      indexFilesRead,
      indexBytesRead,
      fileStatCount,
      rawSessionPolicy: "metadata_only_no_raw_body",
      taskBodyPolicy: "task_prompt_and_error_body_not_read",
      backgroundPolicy: "on_demand_no_polling_no_recursive_scan",
    },
  };
}

module.exports = { collectOpenClawMetadata, defaultStateRoots, isContained, normalizeStatus, readTaskMetadata };
