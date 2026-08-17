const { createAuthorityLifecyclePort } = require("./authorityLifecyclePort.cjs");
const { createIpcFacade } = require("./ipcFacade.cjs");
const { createPlatformGuardianPort } = require("./platformGuardianPort.cjs");
const { createStrictReadonlyMemoryQueryPort } = require("./strictReadonlyMemoryQueryPort.cjs");
const { requireFunction } = require("./contracts.cjs");

function createGuardianExecutor(options) {
  const operations = options.guardianOperations || {};
  const confirmationMessages = options.guardianConfirmationMessages || {};
  const confirm = requireFunction(options.isGuardianMutationConfirmed, "integration.isGuardianMutationConfirmed");
  return async (request) => {
    const operation = requireFunction(operations[request.operation], `integration.guardianOperations.${request.operation}`);
    if (confirmationMessages[request.operation] && !confirm(request.options)) {
      return { ok: false, error: confirmationMessages[request.operation], refused: true };
    }
    return operation(request.options);
  };
}

function registerRuntimeBoundaryFacade(options = {}) {
  const reviewAuthority = requireFunction(options.reviewAuthority, "integration.reviewAuthority");
  const retrieveReadonlyMemory = requireFunction(options.retrieveReadonlyMemory, "integration.retrieveReadonlyMemory");
  const loadReleaseEvidence = requireFunction(options.loadReleaseEvidence, "integration.loadReleaseEvidence");
  const platformGuardian = createPlatformGuardianPort({
    platform: options.platform,
    capability: options.guardianCapability,
    execute: createGuardianExecutor(options),
  });
  const authorityLifecycle = createAuthorityLifecyclePort({
    review: reviewAuthority,
    acceptRefreshReverify: reviewAuthority,
  });
  const strictReadonlyMemoryQuery = createStrictReadonlyMemoryQueryPort({
    captureWriteState: options.captureMemoryWriteState,
    query: retrieveReadonlyMemory,
  });
  const releaseEvidence = Object.freeze({ load: loadReleaseEvidence });
  const facade = createIpcFacade({ platformGuardian, authorityLifecycle, strictReadonlyMemoryQuery, releaseEvidence });
  const registration = facade.register(options.ipcRegistrar);
  return Object.freeze({ platformGuardian, authorityLifecycle, strictReadonlyMemoryQuery, releaseEvidence, facade, registration });
}

module.exports = { createGuardianExecutor, registerRuntimeBoundaryFacade };
