const { boundaryError, requireFunction } = require("./contracts.cjs");

const IPC_ROUTES = Object.freeze({
  "runtimeBoundary:guardianCapability": Object.freeze({ access: "read", handler: "guardianCapability", request: "none" }),
  "runtimeBoundary:guardianInvoke": Object.freeze({ access: "mixed", handler: "guardianInvoke", request: "object" }),
  "runtimeBoundary:authorityReview": Object.freeze({ access: "read", handler: "authorityReview", request: "object" }),
  "runtimeBoundary:authorityAcceptRefreshReverify": Object.freeze({ access: "explicit_mutation", handler: "authorityAccept", request: "object" }),
  "runtimeBoundary:strictReadonlyMemoryQuery": Object.freeze({ access: "strict_readonly", handler: "memoryQuery", request: "object" }),
  "runtimeBoundary:releaseEvidence": Object.freeze({ access: "strict_readonly", handler: "releaseEvidence", request: "object" }),
});

function assertRequest(route, request) {
  if (route.request === "none") return {};
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw boundaryError("ERR_IPC_FACADE_REQUEST_INVALID", "IPC facade request must be an object.");
  }
  return request;
}

function createIpcFacade(ports = {}) {
  const handlers = Object.freeze({
    guardianCapability: async () => ports.platformGuardian?.capability || null,
    guardianInvoke: requireFunction(ports.platformGuardian?.invoke, "ipc.platformGuardian.invoke"),
    authorityReview: requireFunction(ports.authorityLifecycle?.review, "ipc.authorityLifecycle.review"),
    authorityAccept: requireFunction(ports.authorityLifecycle?.acceptRefreshReverify, "ipc.authorityLifecycle.acceptRefreshReverify"),
    memoryQuery: requireFunction(ports.strictReadonlyMemoryQuery?.query, "ipc.strictReadonlyMemoryQuery.query"),
    releaseEvidence: requireFunction(ports.releaseEvidence?.load, "ipc.releaseEvidence.load"),
  });

  async function invoke(channel, request) {
    const route = IPC_ROUTES[channel];
    if (!route) throw boundaryError("ERR_IPC_FACADE_CHANNEL_FORBIDDEN", `IPC channel is not allowlisted: ${channel}`);
    return handlers[route.handler](assertRequest(route, request));
  }

  function register(registrar) {
    requireFunction(registrar?.handle, "ipc.registrar.handle");
    for (const channel of Object.keys(IPC_ROUTES)) {
      registrar.handle(channel, async (_event, request) => invoke(channel, request));
    }
    return { schemaVersion: "zhixia.runtime_boundary_ipc_registration.v1", channels: Object.keys(IPC_ROUTES) };
  }

  return Object.freeze({ routes: IPC_ROUTES, invoke, register });
}

module.exports = { IPC_ROUTES, createIpcFacade };
