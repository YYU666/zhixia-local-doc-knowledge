const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const cli = path.join(appRoot, "codex-skills", "zhixia-local-docs", "scripts", "memory-runtime-headless.cjs");

function run(request, env, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli], {
    cwd: request.workspace,
    env: { ...process.env, ...env },
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, `unexpected CLI status: ${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  return output;
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-headless-"));
  const workspace = path.join(root, "project");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(path.join(workspace, ".codex-knowledge"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "PRD.md"), "# Alpha PRD\nCanonical acceptance source.\n", "utf8");
  fs.writeFileSync(path.join(workspace, ".codex-knowledge", "retrieval-packet.md"), "# Alpha runtime\nCurrent bounded context.\n", "utf8");
  const env = { ZHIXIA_USER_DATA: userData };

  try {
    const initial = run({ action: "retrieve_context", workspace, taskGoal: "Alpha runtime" }, env);
    assert.equal(initial.memoryMode, "fallback_stale", "missing Memory Core must remain fallback_stale");
    assert.equal(initial.triggerReceipt.action, "retrieve_context");

    const writeback = run({
      action: "writeback_evidence",
      workspace,
      decision: "accept",
      title: "Alpha acceptance decision",
      summary: "The bounded headless lifecycle is accepted for project use.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(writeback.status, "completed");
    assert.equal(writeback.sourceRefs.length, 1, "writeback must retain sourceRefs");
    assert.equal(writeback.storage.uiRequired, false, "writeback must not require Electron UI");
    assert.equal(writeback.storage.mainDatabaseWrite, false, "writeback must not touch the sql.js main DB");

    const repeated = run({
      action: "writeback_evidence",
      workspace,
      decision: "accept",
      title: "Alpha acceptance decision",
      summary: "The bounded headless lifecycle is accepted for project use.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(repeated.id, writeback.id, "identical writeback should be idempotent");

    const recalled = run({ action: "retrieve_precedent", workspace, taskType: "bounded headless lifecycle", limit: 12 }, env);
    assert.ok(recalled.items.some((item) => item.id === writeback.id), "headless writeback must be recallable without UI");
    assert.ok(recalled.items.find((item) => item.id === writeback.id).sourceRefs.some((ref) => /PRD\.md$/.test(ref.path || "")), "recalled evidence must retain its source ref");

    const event = run({
      action: "observe_event",
      workspace,
      eventType: "checkpoint",
      title: "Alpha checkpoint",
      observation: "Headless observation persisted with bounded project evidence.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(event.action, "observe_event");

    const taskStarted = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-alpha-001", status: "running", title: "Alpha small task",
      summary: "MiniMax started the bounded project task.", progressPct: 10,
    }, env);
    assert.equal(taskStarted.changed, true);
    assert.equal(taskStarted.task.status, "running");
    assert.equal(taskStarted.task.authority.selfReported, true);
    assert.equal(taskStarted.task.authority.acceptedEvidence, false);
    assert.equal(taskStarted.polling.heartbeatCreated, false);

    const taskRepeated = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-alpha-001", status: "running", title: "Alpha small task",
      summary: "MiniMax started the bounded project task.", progressPct: 10,
    }, env);
    assert.equal(taskRepeated.changed, false, "identical worker status must be idempotent");

    const taskProgress = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-alpha-001", status: "running", title: "Alpha small task",
      summary: "Implementation finished; verification is running.", progressPct: 70,
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(taskProgress.changed, true);
    assert.equal(taskProgress.task.progressPct, 70);

    const activeTasks = run({ action: "list_worker_tasks", workspace, agent: "minimax-code" }, env);
    assert.equal(activeTasks.counts.active, 1);
    assert.equal(activeTasks.tasks[0].taskId, "minimax-alpha-001");

    const taskRegression = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-alpha-001", status: "running", title: "Alpha small task",
      summary: "Stale progress report.", progressPct: 20,
    }, env, 1);
    assert.equal(taskRegression.error, "worker_task_progress_regression_rejected");
    const taskAfterRegression = run({ action: "list_worker_tasks", workspace, agent: "minimax-code" }, env);
    assert.equal(taskAfterRegression.tasks[0].progressPct, 70, "rejected progress must roll back without mutating the task");

    const taskCompleted = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-alpha-001", status: "completed", title: "Alpha small task",
      summary: "The bounded task completed and its local acceptance check passed.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(taskCompleted.task.progressPct, 100);
    assert.ok(taskCompleted.task.completedAt);

    const taskCompletedRepeated = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-alpha-001", status: "completed", title: "Alpha small task",
      summary: "The bounded task completed and its local acceptance check passed.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(taskCompletedRepeated.changed, false, "identical terminal reports must remain idempotent");
    assert.equal(taskCompletedRepeated.task.completedAt, taskCompleted.task.completedAt);

    const noActiveTasks = run({ action: "list_worker_tasks", workspace, agent: "minimax-code" }, env);
    assert.equal(noActiveTasks.tasks.length, 0, "terminal tasks must be hidden from the default active view");
    const allTasks = run({ action: "list_worker_tasks", workspace, agent: "minimax-code", includeTerminal: true }, env);
    assert.equal(allTasks.counts.terminal, 1);
    assert.equal(allTasks.tasks[0].status, "completed");

    const taskReopen = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-alpha-001", status: "running", title: "Alpha small task",
      summary: "A stale caller must not reopen terminal work.", progressPct: 100,
    }, env, 1);
    assert.equal(taskReopen.error, "terminal_worker_task_reopen_rejected");

    const receipts = run({ action: "list_trigger_receipts", workspace, limit: 20 }, env);
    assert.ok(receipts.receipts.some((receipt) => receipt.action === "writeback_evidence"), "receipt lookup must include writeback");
    assert.ok(receipts.receipts.some((receipt) => receipt.action === "retrieve_context"), "receipt lookup must include retrieval");

    const noSource = run({
      action: "writeback_evidence", workspace, decision: "accept", title: "No source", summary: "Must fail closed.", sourceRefs: [],
    }, env, 1);
    assert.equal(noSource.error, "accepted_writeback_requires_source_refs");

    const foreign = path.join(root, "foreign", "evidence.md");
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, "foreign", "utf8");
    const crossProject = run({
      action: "writeback_evidence", workspace, decision: "accept", title: "Foreign", summary: "Must fail closed.",
      sourceRefs: [{ kind: "file", path: foreign, title: "foreign" }],
    }, env, 1);
    assert.equal(crossProject.error, "cross_project_source_ref_rejected");

    const workerCrossProject = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-foreign-001", status: "running", title: "Foreign evidence",
      summary: "This worker source reference must fail closed.", progressPct: 5,
      sourceRefs: [{ kind: "file", path: foreign, title: "foreign" }],
    }, env, 1);
    assert.equal(workerCrossProject.error, "cross_project_source_ref_rejected");

    const unsafeWorker = run({
      action: "report_worker_task_status", workspace, agent: "minimax-code",
      taskId: "minimax-unsafe-001", status: "running", title: "Unsafe worker",
      summary: `data:image/png;base64,${"A".repeat(300)}`, progressPct: 5,
    }, env, 1);
    assert.equal(unsafeWorker.error, "unsafe_or_empty_worker_task_payload_rejected");

    const unsafe = run({
      action: "observe_event", workspace, title: "Unsafe", observation: `data:image/png;base64,${"A".repeat(300)}`,
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env, 1);
    assert.equal(unsafe.error, "unsafe_or_empty_compact_payload_rejected");

    for (const credentialSentinel of [
      "sk-abcdefghijklmnop1234",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      "AKIA1234567890ABCDEF",
    ]) {
      const secret = run({
        action: "writeback_evidence", workspace, decision: "accept", title: "Secret rejection",
        summary: `Credential ${credentialSentinel} must never persist.`,
        sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
      }, env, 1);
      assert.equal(secret.error, "unsafe_or_empty_compact_payload_rejected", `credential signature ${credentialSentinel.slice(0, 4)} must fail closed`);
    }

    const outputText = JSON.stringify({ initial, writeback, recalled, event, receipts, taskStarted, taskProgress, taskCompleted, allTasks });
    assert.doesNotMatch(outputText, /data:image|\.codex[\\/]sessions|A{120}/, "headless packets must not leak raw/base64 bodies");
    console.log("Memory Runtime headless strict-JSON tests passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
