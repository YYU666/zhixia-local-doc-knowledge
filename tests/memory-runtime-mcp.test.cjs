const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const serverPath = process.env.ZHIXIA_MCP_SERVER_PATH
  || path.join(appRoot, "codex-skills", "zhixia-local-docs", "scripts", "memory-runtime-mcp.cjs");

function createClient(env) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: appRoot,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message);
  });
  let nextId = 1;
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP timeout for ${method}; stderr=${stderr}`));
        }, 5000);
        pending.set(id, {
          resolve: (message) => { clearTimeout(timer); resolve(message); },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      child.stdin.end();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`MCP server did not exit; stderr=${stderr}`));
        }, 3000);
        child.once("exit", (code) => {
          clearTimeout(timer);
          assert.equal(code, 0, `MCP server failed: ${stderr}`);
          resolve();
        });
      });
    },
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-mcp-"));
  const workspace = path.join(root, "project");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(userData, { mode: 0o700 });
  fs.mkdirSync(path.join(workspace, ".codex-knowledge"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "PRD.md"), "# MCP bridge acceptance\n", "utf8");
  fs.writeFileSync(path.join(workspace, ".codex-knowledge", "retrieval-packet.md"), "# Shared project memory\nBounded MiniMax bridge context.\n", "utf8");
  const client = createClient({ ZHIXIA_USER_DATA: userData });

  try {
    const initialize = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "zhixia-mcp-test", version: "1.0.0" },
    });
    assert.equal(initialize.result.serverInfo.name, "zhixia-memory-runtime");
    assert.equal(initialize.result.protocolVersion, "2025-06-18");
    client.notify("notifications/initialized");

    const listed = await client.request("tools/list");
    assert.equal(listed.result.tools.length, 8, "MiniMax bridge must expose the eight reviewed lifecycle tools only");
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["retrieve_context", "retrieve_precedent", "observe_event", "writeback_evidence", "continuity", "list_trigger_receipts", "report_worker_task_status", "list_worker_tasks"],
    );

    const taskStarted = await client.request("tools/call", {
      name: "report_worker_task_status",
      arguments: {
        workspace,
        taskId: "minimax-mcp-001",
        status: "running",
        title: "MiniMax MCP probe",
        summary: "MiniMax started a bounded worker task.",
        progressPct: 15,
      },
    });
    assert.equal(taskStarted.result.isError, false);
    assert.equal(taskStarted.result.structuredContent.task.agent, "minimax-code");
    assert.equal(taskStarted.result.structuredContent.task.authority.selfReported, true);

    const activeTasks = await client.request("tools/call", {
      name: "list_worker_tasks",
      arguments: { workspace },
    });
    assert.equal(activeTasks.result.isError, false);
    assert.equal(activeTasks.result.structuredContent.tasks.length, 1);
    assert.equal(activeTasks.result.structuredContent.tasks[0].taskId, "minimax-mcp-001");

    const context = await client.request("tools/call", {
      name: "retrieve_context",
      arguments: { workspace, taskGoal: "MiniMax shared project memory", limit: 8, tokenBudget: 1200 },
    });
    assert.equal(context.result.isError, false);
    assert.equal(context.result.structuredContent.triggerReceipt.action, "retrieve_context");
    assert.equal(context.result.structuredContent.memoryMode, "fallback_stale");

    const writeback = await client.request("tools/call", {
      name: "writeback_evidence",
      arguments: {
        workspace,
        decision: "accept",
        title: "MiniMax small-task bridge accepted",
        summary: "The MCP worker completed a bounded source-backed probe.",
        sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "MCP bridge acceptance" }],
      },
    });
    assert.equal(writeback.result.isError, false);
    assert.equal(writeback.result.structuredContent.sourceRefs.length, 1);
    assert.equal(writeback.result.structuredContent.storage.uiRequired, false);

    const precedent = await client.request("tools/call", {
      name: "retrieve_precedent",
      arguments: { workspace, taskType: "MiniMax small-task bridge", limit: 12 },
    });
    assert.equal(precedent.result.isError, false);
    assert.ok(
      precedent.result.structuredContent.items.some((item) => item.id === writeback.result.structuredContent.id),
      "MiniMax writeback must be recallable through the shared Zhixia project identity",
    );

    const rejected = await client.request("tools/call", {
      name: "writeback_evidence",
      arguments: {
        workspace,
        decision: "accept",
        title: "Missing source",
        summary: "This must fail closed.",
        sourceRefs: [],
      },
    });
    assert.equal(rejected.result.isError, true);
    assert.match(rejected.result.content[0].text, /accepted_writeback_requires_source_refs/);

    const taskCompleted = await client.request("tools/call", {
      name: "report_worker_task_status",
      arguments: {
        workspace,
        taskId: "minimax-mcp-001",
        status: "completed",
        title: "MiniMax MCP probe",
        summary: "The bounded task finished; acceptance remains external.",
        sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "MCP bridge acceptance" }],
      },
    });
    assert.equal(taskCompleted.result.structuredContent.task.status, "completed");

    const taskCompletedRepeated = await client.request("tools/call", {
      name: "report_worker_task_status",
      arguments: {
        workspace,
        taskId: "minimax-mcp-001",
        status: "completed",
        title: "MiniMax MCP probe",
        summary: "The bounded task finished; acceptance remains external.",
        sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "MCP bridge acceptance" }],
      },
    });
    assert.equal(taskCompletedRepeated.result.structuredContent.changed, false);

    const activeAfterCompletion = await client.request("tools/call", {
      name: "list_worker_tasks",
      arguments: { workspace },
    });
    assert.equal(activeAfterCompletion.result.structuredContent.tasks.length, 0);

    const terminalTasks = await client.request("tools/call", {
      name: "list_worker_tasks",
      arguments: { workspace, includeTerminal: true },
    });
    assert.equal(terminalTasks.result.structuredContent.tasks[0].status, "completed");

    const serialized = JSON.stringify({ context, writeback, precedent, taskStarted, taskCompleted, taskCompletedRepeated, terminalTasks });
    assert.doesNotMatch(serialized, /data:image|\.codex[\\/]sessions|A{240}/);
    console.log("Zhixia Memory Runtime MCP bridge tests passed.");
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
