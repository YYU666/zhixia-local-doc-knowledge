const assert = require("node:assert/strict");

const { IPC_ROUTES } = require("../electron/runtimeBoundaries/ipcFacade.cjs");
const { registerRuntimeBoundaryFacade } = require("../electron/runtimeBoundaries/runtimeBoundaryIntegration.cjs");

const handlers = new Map();
const calls = [];
let writeState = { graph: "g1", receipts: 0 };
const integration = registerRuntimeBoundaryFacade({
  ipcRegistrar: { handle: (channel, handler) => handlers.set(channel, handler) },
  platform: "win32",
  isGuardianMutationConfirmed: (options) => options?.confirmed === true,
  guardianConfirmationMessages: { compact_thread: "confirmation required" },
  guardianOperations: {
    report: async () => ({ ok: true, result: { status: "healthy" } }),
    search_history: async () => ({ ok: true }),
    get_thread_context: async () => ({ ok: true }),
    get_project_history: async () => ({ ok: true }),
    list_long_threads: async () => ({ ok: true }),
    clean_logs: async () => ({ ok: true }),
    optimize_thread: async () => ({ ok: true }),
    compact_thread: async () => ({ ok: true, result: { compacted: true } }),
    auto_ingest_history: async () => ({ ok: true }),
    generate_archive_queue: async () => ({ ok: true }),
  },
  reviewAuthority: async (request) => {
    calls.push(request.execute ? "accept" : "review");
    if (!request.execute) return {
      status: "review_required",
      reviewToken: "token",
      binding: { scanSha256: "scan", projectIdentitySha256: "identity", previousCheckpointId: "old" },
      authority: { writable: false, receiptIssued: false },
    };
    return {
      status: "verified",
      receipt: { receiptId: "receipt" },
      refresh: { checkpointId: "new" },
      verification: { memoryMode: "app_owned_memory_core", authorityVerification: "app_owned_verified", current: true, recoveryReady: true, matched: true },
    };
  },
  captureMemoryWriteState: async () => ({ ...writeState }),
  retrieveReadonlyMemory: async (request) => ({ readOnly: request.readOnly, items: [], returnedCount: 0 }),
  loadReleaseEvidence: async (request) => ({ status: "verified", readOnly: true, projectPath: request.projectPath }),
});

assert.deepEqual([...handlers.keys()], Object.keys(IPC_ROUTES));
assert.deepEqual(integration.registration.channels, Object.keys(IPC_ROUTES));

(async () => {
  const invoke = (channel, request) => handlers.get(channel)({}, request);
  const capability = await invoke("runtimeBoundary:guardianCapability");
  assert.equal(capability.supported, true);
  const guardian = await invoke("runtimeBoundary:guardianInvoke", { operation: "report", options: {} });
  assert.equal(guardian.result.result.status, "healthy");
  const refused = await invoke("runtimeBoundary:guardianInvoke", { operation: "compact_thread", options: {} });
  assert.equal(refused.result.refused, true);
  const compacted = await invoke("runtimeBoundary:guardianInvoke", { operation: "compact_thread", options: { confirmed: true } });
  assert.equal(compacted.result.result.compacted, true);

  const review = await invoke("runtimeBoundary:authorityReview", { workspace: "/workspace", acceptedChangedPaths: ["a.js"] });
  assert.equal(review.status, "review_required");
  const accepted = await invoke("runtimeBoundary:authorityAcceptRefreshReverify", {
    workspace: "/workspace",
    acceptedChangedPaths: ["a.js"],
    execute: true,
    userConfirmed: true,
    decision: "accept",
    reviewToken: "token",
    expectedProjectIdentitySha256: "identity",
    expectedScanSha256: "scan",
    previousCheckpointId: "old",
    sourceRefs: [{ path: "a.js", sha256: "a".repeat(64) }],
  });
  assert.equal(accepted.status, "verified");

  const readonly = await invoke("runtimeBoundary:strictReadonlyMemoryQuery", { projectPath: "/workspace", readOnly: true });
  assert.equal(readonly.readOnly, true);
  assert.equal(readonly.writes, 0);
  const releaseEvidence = await invoke("runtimeBoundary:releaseEvidence", { projectPath: "/workspace" });
  assert.equal(releaseEvidence.readOnly, true);
  assert.deepEqual(calls, ["review", "accept"], "strict read-only route must not initialize the main database");
  assert.deepEqual(writeState, { graph: "g1", receipts: 0 });
  console.log("Runtime boundary integration tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
