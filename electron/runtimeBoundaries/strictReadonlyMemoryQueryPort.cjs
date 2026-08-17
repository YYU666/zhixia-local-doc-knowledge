const { boundaryError, requireFunction, requireNonEmptyString, stableJson } = require("./contracts.cjs");

function createStrictReadonlyMemoryQueryPort(adapter = {}) {
  const captureWriteState = requireFunction(adapter.captureWriteState, "memoryQuery.captureWriteState");
  const queryAdapter = requireFunction(adapter.query, "memoryQuery.query");
  const onViolation = typeof adapter.onViolation === "function" ? adapter.onViolation : async () => {};

  async function query(request = {}) {
    const projectPath = requireNonEmptyString(request.projectPath, "ERR_READONLY_QUERY_PROJECT_REQUIRED", "projectPath");
    if (request.readOnly === false) throw boundaryError("ERR_READONLY_QUERY_REQUIRED", "This port only accepts strict read-only queries.");
    const before = await captureWriteState();
    let result;
    let queryError = null;
    try {
      result = await queryAdapter({ ...request, projectPath, readOnly: true });
    } catch (error) {
      queryError = error;
    }
    const after = await captureWriteState();
    if (stableJson(before) !== stableJson(after)) {
      await onViolation({ before, after, request: { ...request, projectPath, readOnly: true }, queryError });
      throw boundaryError(
        "ERR_READONLY_QUERY_SIDE_EFFECT",
        "Strict read-only query changed guarded write state.",
        { before, after, queryError },
      );
    }
    if (queryError) throw queryError;
    if (result?.readOnly !== true) throw boundaryError("ERR_READONLY_QUERY_RESULT_INVALID", "Read-only query result must declare readOnly=true.");
    return { ...result, readOnly: true, writes: 0 };
  }

  return Object.freeze({ query });
}

module.exports = { createStrictReadonlyMemoryQueryPort };
