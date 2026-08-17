const { boundaryError, requireFunction, requireNonEmptyString } = require("./contracts.cjs");

const READ_OPERATIONS = new Set([
  "report",
  "search_history",
  "get_thread_context",
  "get_project_history",
  "list_long_threads",
]);
const MUTATION_OPERATIONS = new Set([
  "clean_logs",
  "optimize_thread",
  "compact_thread",
  "auto_ingest_history",
  "generate_archive_queue",
]);

function defaultCapability(platform) {
  const supported = platform === "win32";
  return Object.freeze({
    supported,
    adapter: supported ? "windows_powershell" : "unavailable",
    reason: supported ? null : "Guardian requires the Windows PowerShell platform adapter.",
  });
}

function createPlatformGuardianPort(options = {}) {
  const platform = String(options.platform || process.platform);
  const capability = Object.freeze({ ...defaultCapability(platform), ...(options.capability || {}) });
  const execute = capability.supported ? requireFunction(options.execute, "platformGuardian.execute") : null;
  if (capability.supported && capability.adapter !== "windows_powershell") {
    throw boundaryError("ERR_GUARDIAN_ADAPTER_INVALID", "A supported Guardian port must name the Windows PowerShell adapter.");
  }
  if (!capability.supported && capability.adapter !== "unavailable") {
    throw boundaryError("ERR_GUARDIAN_CAPABILITY_INVALID", "An unsupported Guardian port must be truthfully unavailable.");
  }

  async function invoke(request = {}) {
    const operation = requireNonEmptyString(request.operation, "ERR_GUARDIAN_OPERATION_REQUIRED", "operation");
    if (!READ_OPERATIONS.has(operation) && !MUTATION_OPERATIONS.has(operation)) {
      throw boundaryError("ERR_GUARDIAN_OPERATION_FORBIDDEN", `Guardian operation is not allowlisted: ${operation}`);
    }
    if (!capability.supported) {
      throw boundaryError("ERR_GUARDIAN_UNAVAILABLE", capability.reason || "Guardian is unavailable.", { capability });
    }
    const access = MUTATION_OPERATIONS.has(operation) ? "mutation" : "read";
    const result = await execute({ operation, access, options: request.options || {} });
    return { schemaVersion: "zhixia.platform_guardian_result.v1", operation, access, capability, result };
  }

  return Object.freeze({ capability, invoke });
}

module.exports = { MUTATION_OPERATIONS, READ_OPERATIONS, createPlatformGuardianPort, defaultCapability };
