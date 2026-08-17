const BOUNDARY_SCHEMA = "zhixia.runtime_boundaries.v1";

const RESPONSIBILITIES = Object.freeze({
  platformGuardian: Object.freeze({
    owner: "platform_adapter",
    purpose: "Report capability and execute only named Guardian operations.",
    forbidden: ["authority_lifecycle", "memory_query", "persistence", "renderer_state"],
  }),
  authorityLifecycle: Object.freeze({
    owner: "authority_service",
    purpose: "Review exact evidence and perform explicitly confirmed accept-refresh-reverify.",
    forbidden: ["platform_shell", "renderer_state", "database_implementation"],
  }),
  persistenceTransaction: Object.freeze({
    owner: "persistence_service",
    purpose: "Make one mutation durable or restore and degrade read-only.",
    forbidden: ["ipc", "renderer_state", "memory_query_ranking", "platform_shell"],
  }),
  strictReadonlyMemoryQuery: Object.freeze({
    owner: "query_service",
    purpose: "Return bounded memory results while proving the guarded write state is unchanged.",
    forbidden: ["receipt_write", "graph_seed_write", "retrieve_log_write", "persistence_commit"],
  }),
  ipcFacade: Object.freeze({
    owner: "ipc_adapter",
    purpose: "Expose an explicit allowlist and delegate to domain ports.",
    forbidden: ["business_logic", "database_implementation", "shell_command_construction"],
  }),
  rendererWorkflow: Object.freeze({
    owner: "renderer_workflow",
    purpose: "Render and advance the visible verify-review-accept-refresh-reverify sequence.",
    forbidden: ["authority_decision", "filesystem", "database", "platform_shell"],
  }),
});

function boundaryError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw boundaryError("ERR_RUNTIME_BOUNDARY_ADAPTER_INVALID", `${name} adapter function is required.`, { adapter: name });
  }
  return value;
}

function requireNonEmptyString(value, code, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw boundaryError(code, `${field} is required.`, { field });
  return normalized;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  BOUNDARY_SCHEMA,
  RESPONSIBILITIES,
  boundaryError,
  cloneJson,
  requireFunction,
  requireNonEmptyString,
  stableJson,
};
