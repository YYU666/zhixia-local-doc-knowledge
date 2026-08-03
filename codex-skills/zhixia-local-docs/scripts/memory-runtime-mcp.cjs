const readline = require("node:readline");
const { execute } = require("./memory-runtime-headless.cjs");

const SERVER_NAME = "zhixia-memory-runtime";
const SERVER_VERSION = "1.0.0";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const MAX_MESSAGE_BYTES = 128 * 1024;

const sourceRefsSchema = {
  type: "array",
  maxItems: 24,
  items: {
    type: "object",
    properties: {
      kind: { type: "string", maxLength: 80 },
      path: { type: "string", maxLength: 600 },
      title: { type: "string", maxLength: 240 },
      hash: { type: "string", maxLength: 160 },
      projectId: { type: "string", maxLength: 180 },
    },
    additionalProperties: false,
  },
};

const sharedRetrievalProperties = {
  workspace: { type: "string", minLength: 1, maxLength: 1200 },
  taskGoal: { type: "string", minLength: 1, maxLength: 600 },
  queryType: { type: "string", maxLength: 80 },
  limit: { type: "integer", minimum: 1, maximum: 20 },
  tokenBudget: { type: "integer", minimum: 200, maximum: 4000 },
  allowColdLayer: { type: "boolean" },
  projectId: { type: "string", maxLength: 180 },
  projectIdentity: { type: "object" },
};

const tools = [
  {
    name: "retrieve_context",
    description: "Retrieve bounded, project-scoped Zhixia context for the current task. Never returns raw chat history by default.",
    inputSchema: {
      type: "object",
      properties: sharedRetrievalProperties,
      required: ["workspace", "taskGoal"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "retrieve_precedent",
    description: "Retrieve bounded, project-scoped precedents, decisions, and prior evidence for a task type.",
    inputSchema: {
      type: "object",
      properties: {
        ...sharedRetrievalProperties,
        taskType: { type: "string", minLength: 1, maxLength: 600 },
      },
      required: ["workspace", "taskType"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "observe_event",
    description: "Record a compact project event in Zhixia without opening the Electron UI. Keep source references project-scoped.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", minLength: 1, maxLength: 1200 },
        eventType: { type: "string", maxLength: 80 },
        title: { type: "string", minLength: 1, maxLength: 240 },
        observation: { type: "string", minLength: 1, maxLength: 2400 },
        sourceRefs: sourceRefsSchema,
        projectId: { type: "string", maxLength: 180 },
        projectIdentity: { type: "object" },
      },
      required: ["workspace", "title", "observation"],
      additionalProperties: false,
    },
  },
  {
    name: "writeback_evidence",
    description: "Write compact, source-backed task evidence to Zhixia. Accepted evidence requires at least one safe project source reference.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", minLength: 1, maxLength: 1200 },
        decision: { type: "string", enum: ["accept", "revise", "block"] },
        title: { type: "string", minLength: 1, maxLength: 240 },
        summary: { type: "string", minLength: 1, maxLength: 2400 },
        sourceRefs: sourceRefsSchema,
        projectId: { type: "string", maxLength: 180 },
        projectIdentity: { type: "object" },
      },
      required: ["workspace", "decision", "title", "summary", "sourceRefs"],
      additionalProperties: false,
    },
  },
  {
    name: "continuity",
    description: "Read bounded project continuity status and recovery readiness from Zhixia.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", minLength: 1, maxLength: 1200 },
        taskGoal: { type: "string", maxLength: 600 },
        cursor: { type: ["string", "null"], maxLength: 600 },
        pageSize: { type: "integer", minimum: 1, maximum: 50 },
        tokenBudget: { type: "integer", minimum: 200, maximum: 4000 },
        projectId: { type: "string", maxLength: 180 },
        projectIdentity: { type: "object" },
      },
      required: ["workspace"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "list_trigger_receipts",
    description: "List bounded Zhixia lifecycle receipts for the exact project identity.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", minLength: 1, maxLength: 1200 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        projectId: { type: "string", maxLength: 180 },
        projectIdentity: { type: "object" },
      },
      required: ["workspace"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "report_worker_task_status",
    description: "Report a MiniMax task boundary to Zhixia: queued/running/waiting/completed/failed/cancelled. Call at start, material milestones, and terminal status only; do not create heartbeat traffic.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", minLength: 1, maxLength: 1200 },
        taskId: { type: "string", minLength: 1, maxLength: 128 },
        status: { type: "string", enum: ["queued", "running", "waiting", "completed", "failed", "cancelled"] },
        title: { type: "string", minLength: 1, maxLength: 240 },
        summary: { type: "string", minLength: 1, maxLength: 2400 },
        progressPct: { type: "integer", minimum: 0, maximum: 100 },
        sourceRefs: sourceRefsSchema,
        projectId: { type: "string", maxLength: 180 },
        projectIdentity: { type: "object" },
      },
      required: ["workspace", "taskId", "status", "title", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "list_worker_tasks",
    description: "List self-reported MiniMax task status for the exact Zhixia project. Active tasks are returned by default; terminal tasks require includeTerminal=true.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", minLength: 1, maxLength: 1200 },
        includeTerminal: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        projectId: { type: "string", maxLength: 180 },
        projectIdentity: { type: "object" },
      },
      required: ["workspace"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

const toolNames = new Set(tools.map((tool) => tool.name));
let initialized = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function failure(id, code, message, data) {
  send({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function compactError(error) {
  return String(error?.message || error || "unknown_error").replace(/\s+/g, " ").trim().slice(0, 320);
}

function handleRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
    failure(message?.id, -32600, "Invalid Request");
    return;
  }

  if (message.method === "notifications/initialized") {
    initialized = true;
    return;
  }
  if (message.method === "notifications/cancelled") return;
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    const requestedVersion = typeof message.params?.protocolVersion === "string"
      ? message.params.protocolVersion
      : DEFAULT_PROTOCOL_VERSION;
    result(message.id, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Use bounded project memory only. Do not request raw sessions, full chats, credentials, images, base64, or giant logs.",
    });
    return;
  }

  if (message.method === "ping") {
    result(message.id, {});
    return;
  }

  if (!initialized) {
    failure(message.id, -32002, "Server not initialized");
    return;
  }

  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments;
    if (typeof name !== "string" || !toolNames.has(name)) {
      failure(message.id, -32602, "Unknown tool");
      return;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      failure(message.id, -32602, "Tool arguments must be an object");
      return;
    }
    try {
      const taskStatusArgs = name === "report_worker_task_status" || name === "list_worker_tasks"
        ? { ...args, agent: "minimax-code" }
        : args;
      const output = execute({ ...taskStatusArgs, action: name });
      result(message.id, {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
        isError: false,
      });
    } catch (error) {
      result(message.id, {
        content: [{ type: "text", text: compactError(error) }],
        isError: true,
      });
    }
    return;
  }

  failure(message.id, -32601, "Method not found");
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
    failure(null, -32600, "Message too large");
    return;
  }
  try {
    handleRequest(JSON.parse(line));
  } catch (error) {
    failure(null, -32700, "Parse error", compactError(error));
  }
});

input.on("close", () => {
  process.exitCode = 0;
});
