const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { collectOpenClawMetadata, isContained, normalizeStatus } = require("../electron/openClawSessionAdapter.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-openclaw-adapter-"));
const sessionsRoot = path.join(root, "agents", "main", "sessions");
const stateRoot = path.join(root, "state");
fs.mkdirSync(sessionsRoot, { recursive: true });
fs.mkdirSync(stateRoot, { recursive: true });
const sessionFile = path.join(sessionsRoot, "session-safe.jsonl");
fs.writeFileSync(sessionFile, '{"raw":"must-not-be-read"}\n', "utf8");
fs.writeFileSync(path.join(sessionsRoot, "sessions.json"), JSON.stringify({
  "agent:main:task-safe": {
    sessionId: "session-safe",
    updatedAt: Date.parse("2026-07-20T06:00:00Z"),
    status: "succeeded",
    sessionFile,
    model: "qwen2.5vl:7b",
    modelProvider: "ollama",
    totalTokens: 1200,
    compactionCount: 1
  },
  "agent:main:path-escape": {
    sessionId: "session-escape",
    updatedAt: Date.parse("2026-07-20T05:00:00Z"),
    status: "running",
    sessionFile: path.join(root, "outside.jsonl")
  }
}), "utf8");
fs.writeFileSync(path.join(root, "outside.jsonl"), "secret-body", "utf8");

const db = new DatabaseSync(path.join(stateRoot, "openclaw.sqlite"));
db.exec(`
  CREATE TABLE task_runs (
    task_id TEXT, runtime TEXT, task_kind TEXT, requester_session_key TEXT,
    child_session_key TEXT, agent_id TEXT, run_id TEXT, label TEXT, status TEXT,
    created_at INTEGER, started_at INTEGER, ended_at INTEGER, last_event_at INTEGER
  );
  INSERT INTO task_runs VALUES (
    'task-1', 'cli', 'research', 'agent:main:task-safe', 'agent:main:task-safe',
    'main', 'run-1', 'bounded task', 'succeeded', 1, 2, 3, 4
  );
`);
db.close();

const result = collectOpenClawMetadata({ stateRoots: [root], maxSessions: 10, maxTasks: 10, maxFileStats: 10 });
assert.equal(result.ok, true);
assert.equal(result.sessions.length, 2);
assert.equal(result.tasks.length, 1);
assert.equal(result.sessions[0].id, "openclaw:main:session-safe");
assert.equal(result.sessions[0].status, "idle");
assert.equal(result.sessions[0].openClaw.taskId, "task-1");
assert.equal(result.sessions[0].sessionBytes, fs.statSync(sessionFile).size);
assert.equal(result.sessions[1].sessionPath, null, "escaped session paths must not be statted or returned");
assert.ok(result.warnings.includes("openclaw_session_path_escape_rejected:main"));
assert.equal(result.provenance.rawSessionPolicy, "metadata_only_no_raw_body");
assert.equal(result.provenance.indexFilesRead, 1);
assert.equal(result.provenance.fileStatCount, 1);
assert.equal(JSON.stringify(result).includes("must-not-be-read"), false, "raw JSONL bodies must never enter adapter output");
assert.equal(normalizeStatus("timed_out"), "systemError");
assert.equal(normalizeStatus("running"), "running");
assert.equal(isContained(sessionsRoot, sessionFile), true);
assert.equal(isContained(sessionsRoot, path.join(root, "outside.jsonl")), false);

console.log("OpenClaw session/task metadata adapter tests passed.");
