const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { RESPONSIBILITIES } = require("../electron/runtimeBoundaries/contracts.cjs");
const { createPlatformGuardianPort } = require("../electron/runtimeBoundaries/platformGuardianPort.cjs");
const { createAuthorityLifecyclePort } = require("../electron/runtimeBoundaries/authorityLifecyclePort.cjs");
const { createPersistenceTransactionPort } = require("../electron/runtimeBoundaries/persistenceTransactionPort.cjs");
const { createStrictReadonlyMemoryQueryPort } = require("../electron/runtimeBoundaries/strictReadonlyMemoryQueryPort.cjs");
const { createIpcFacade, IPC_ROUTES } = require("../electron/runtimeBoundaries/ipcFacade.cjs");
const {
  BOUNDARY_MODULE_BUDGET,
  assertComplexityBudgets,
  buildComplexityReport,
} = require("../electron/runtimeBoundaries/complexityBudget.cjs");

const root = path.resolve(__dirname, "..");
const readyVerification = Object.freeze({
  memoryMode: "app_owned_memory_core",
  authorityVerification: "app_owned_verified",
  current: true,
  recoveryReady: true,
  matched: true,
});

async function expectReject(promise, expression) {
  await assert.rejects(promise, expression);
}

(async () => {
  const {
    initialRendererWorkflow,
    rendererWorkflowView,
    transitionRendererWorkflow,
  } = await import("../src/authorityRendererWorkflow.mjs");
  assert.deepEqual(Object.keys(RESPONSIBILITIES), [
    "platformGuardian",
    "authorityLifecycle",
    "persistenceTransaction",
    "strictReadonlyMemoryQuery",
    "ipcFacade",
    "rendererWorkflow",
  ]);
  for (const responsibility of Object.values(RESPONSIBILITIES)) {
    assert.ok(responsibility.owner && responsibility.purpose && responsibility.forbidden.length > 0);
  }

  let unsupportedCalls = 0;
  const darwinGuardian = createPlatformGuardianPort({
    platform: "darwin",
    execute: async () => { unsupportedCalls += 1; },
  });
  assert.equal(darwinGuardian.capability.supported, false);
  assert.equal(darwinGuardian.capability.adapter, "unavailable");
  await expectReject(darwinGuardian.invoke({ operation: "report" }), /Guardian requires the Windows PowerShell/);
  assert.equal(unsupportedCalls, 0, "unsupported Guardian must never reach an injected executor");

  const guardianCalls = [];
  const windowsGuardian = createPlatformGuardianPort({
    platform: "win32",
    execute: async (request) => { guardianCalls.push(request); return { ok: true }; },
  });
  assert.equal((await windowsGuardian.invoke({ operation: "report" })).access, "read");
  assert.equal((await windowsGuardian.invoke({ operation: "compact_thread" })).access, "mutation");
  await expectReject(windowsGuardian.invoke({ operation: "arbitrary_shell" }), /not allowlisted/);
  assert.deepEqual(guardianCalls.map((call) => call.operation), ["report", "compact_thread"]);

  const authorityCalls = [];
  const authority = createAuthorityLifecyclePort({
    review: async (request) => {
      authorityCalls.push(["review", request]);
      return {
        status: "review_required",
        reviewToken: "review-token",
        binding: { scanSha256: "scan", projectIdentitySha256: "identity", previousCheckpointId: "checkpoint-old" },
        authority: { writable: false, receiptIssued: false },
      };
    },
    acceptRefreshReverify: async (request) => {
      authorityCalls.push(["accept", request]);
      return {
        status: "verified",
        receipt: { receiptId: "receipt-1" },
        refresh: { checkpointId: "checkpoint-new" },
        verification: readyVerification,
      };
    },
  });
  const review = await authority.review({ workspace: "/workspace" });
  assert.equal(review.status, "review_required");
  await expectReject(authority.review({ execute: true }), /Review cannot carry execution/);
  await expectReject(authority.acceptRefreshReverify({ decision: "accept", userConfirmed: false }), /Explicit user-confirmed/);
  const accepted = await authority.acceptRefreshReverify({
    decision: "accept",
    userConfirmed: true,
    reviewToken: "review-token",
    expectedProjectIdentitySha256: "identity",
    expectedScanSha256: "scan",
    previousCheckpointId: "checkpoint-old",
    sourceRefs: [{ path: "source.js", sha256: "a".repeat(64) }],
  });
  assert.equal(accepted.status, "verified");
  assert.equal(authorityCalls[0][1].execute, false);
  assert.equal(authorityCalls[1][1].execute, true);

  const rejectedAuthority = createAuthorityLifecyclePort({
    review: async () => review,
    acceptRefreshReverify: async () => ({
      status: "verified",
      receipt: { receiptId: "receipt" },
      refresh: { checkpointId: "checkpoint" },
      verification: { ...readyVerification, current: false },
    }),
  });
  await expectReject(rejectedAuthority.acceptRefreshReverify({
    decision: "accept",
    userConfirmed: true,
    reviewToken: "token",
    expectedProjectIdentitySha256: "identity",
    expectedScanSha256: "scan",
    previousCheckpointId: "checkpoint",
    sourceRefs: [{ path: "source" }],
  }), /did not finish with a verified current checkpoint/);

  let database = { rows: ["durable"] };
  let durable = JSON.parse(JSON.stringify(database));
  let degraded = null;
  const persistence = createPersistenceTransactionPort({
    captureSnapshot: async () => JSON.parse(JSON.stringify(durable)),
    applyMutation: async ({ payload }) => { database.rows.push(payload); return database.rows.length; },
    persist: async () => { durable = JSON.parse(JSON.stringify(database)); return { durable: true, bytes: 10 }; },
    restoreSnapshot: async (snapshot) => { database = JSON.parse(JSON.stringify(snapshot)); },
    enterDegradedReadonly: async (details) => { degraded = details; },
  });
  const transaction = await persistence.transact({ operation: "append", payload: "accepted" });
  assert.equal(transaction.status, "committed");
  assert.deepEqual(durable.rows, ["durable", "accepted"]);

  database = { rows: ["durable"] };
  durable = { rows: ["durable"] };
  degraded = null;
  const failedPersistence = createPersistenceTransactionPort({
    captureSnapshot: async () => JSON.parse(JSON.stringify(durable)),
    applyMutation: async () => { database.rows.push("must-rollback"); },
    persist: async () => { throw new Error("disk full"); },
    restoreSnapshot: async (snapshot) => { database = JSON.parse(JSON.stringify(snapshot)); },
    enterDegradedReadonly: async (details) => { degraded = details; },
  });
  await expectReject(failedPersistence.transact({ operation: "append" }), /entered degraded read-only/);
  assert.deepEqual(database, durable, "failed mutation must be removed from live memory");
  assert.match(degraded.cause.message, /disk full/);

  let snapshotAttempts = 0;
  const snapshotFailure = createPersistenceTransactionPort({
    captureSnapshot: async () => { snapshotAttempts += 1; if (snapshotAttempts === 1) throw new Error("snapshot unavailable"); return {}; },
    applyMutation: async () => null,
    persist: async () => ({ durable: true }),
    restoreSnapshot: async () => {},
    enterDegradedReadonly: async () => {},
  });
  await expectReject(snapshotFailure.transact({ operation: "capture-failure" }), /entered degraded read-only/);
  assert.equal(snapshotFailure.isActive(), false, "snapshot failure must release the active transaction guard");
  assert.equal((await snapshotFailure.transact({ operation: "retry-after-capture-failure" })).status, "committed");

  let writeState = { graph: "g1", receipts: 2, logs: 4, database: "d1" };
  const readonly = createStrictReadonlyMemoryQueryPort({
    captureWriteState: async () => ({ ...writeState }),
    query: async (request) => ({ readOnly: request.readOnly, items: [{ id: "one" }] }),
  });
  const queryResult = await readonly.query({ projectPath: "/workspace", query: "goal" });
  assert.equal(queryResult.readOnly, true);
  assert.equal(queryResult.writes, 0);
  await expectReject(readonly.query({ projectPath: "/workspace", readOnly: false }), /only accepts strict read-only/);

  const leakingQuery = createStrictReadonlyMemoryQueryPort({
    captureWriteState: async () => ({ ...writeState }),
    query: async () => {
      writeState = { ...writeState, receipts: writeState.receipts + 1 };
      return { readOnly: true, items: [] };
    },
  });
  await expectReject(leakingQuery.query({ projectPath: "/workspace" }), /changed guarded write state/);

  let workflow = initialRendererWorkflow();
  workflow = transitionRendererWorkflow(workflow, { type: "VERIFY_STARTED" });
  workflow = transitionRendererWorkflow(workflow, {
    type: "REVIEW_PREPARED",
    reviewToken: "visible-review-token",
    binding: { scanSha256: "scan", projectIdentitySha256: "identity", previousCheckpointId: "checkpoint-old" },
  });
  assert.equal(rendererWorkflowView(workflow).canAccept, true);
  assert.throws(() => transitionRendererWorkflow(workflow, { type: "REVERIFIED", verification: readyVerification }), /Cannot apply/);
  workflow = transitionRendererWorkflow(workflow, {
    type: "ACCEPT_CONFIRMED",
    userConfirmed: true,
    decision: "accept",
    reviewToken: "visible-review-token",
  });
  workflow = transitionRendererWorkflow(workflow, { type: "ACCEPTED", receiptId: "receipt" });
  workflow = transitionRendererWorkflow(workflow, { type: "REFRESHED", checkpointId: "checkpoint" });
  assert.throws(
    () => transitionRendererWorkflow(workflow, { type: "REVERIFIED", verification: { ...readyVerification, matched: false } }),
    /cannot show ready/,
  );
  workflow = transitionRendererWorkflow(workflow, { type: "REVERIFIED", verification: readyVerification });
  assert.equal(rendererWorkflowView(workflow).ready, true);
  assert.equal(rendererWorkflowView(workflow).authorityWritable, false);

  const facade = createIpcFacade({
    platformGuardian: windowsGuardian,
    authorityLifecycle: authority,
    strictReadonlyMemoryQuery: readonly,
    releaseEvidence: { load: async (request) => ({ status: "verified", readOnly: true, projectPath: request.projectPath }) },
  });
  assert.deepEqual(facade.routes, IPC_ROUTES);
  assert.equal((await facade.invoke("runtimeBoundary:guardianCapability")).supported, true);
  assert.equal((await facade.invoke("runtimeBoundary:strictReadonlyMemoryQuery", { projectPath: "/workspace" })).writes, 0);
  assert.equal((await facade.invoke("runtimeBoundary:releaseEvidence", { projectPath: "/workspace" })).readOnly, true);
  await expectReject(facade.invoke("documents:delete", {}), /not allowlisted/);
  const registered = [];
  const registration = facade.register({ handle: (channel, handler) => registered.push([channel, handler]) });
  assert.deepEqual(registration.channels, Object.keys(IPC_ROUTES));
  assert.equal(registered.length, Object.keys(IPC_ROUTES).length);

  const complexity = assertComplexityBudgets(buildComplexityReport(root));
  assert.ok(complexity.boundaryModules.every((entry) => entry.classification === "within_target_budget"));
  const main = complexity.legacy.find((entry) => entry.relativePath === "electron/main.cjs");
  const app = complexity.legacy.find((entry) => entry.relativePath === "src/App.tsx");
  assert.equal(main.classification, "legacy_over_target_within_ratchet");
  assert.equal(app.classification, "legacy_over_target_within_ratchet");
  assert.ok(main.lines > BOUNDARY_MODULE_BUDGET.maxLines && main.functions > BOUNDARY_MODULE_BUDGET.maxFunctions);
  assert.equal(main.ipcHandlers, 60, "facade registration must replace the ten legacy Guardian/authority handlers");
  assert.equal(main.persistenceCalls, 25, "one mutation family must no longer call saveDatabase directly");
  assert.ok(app.lines > 8_000 && app.functions > 200);

  const forbiddenImports = /require\(["'](?:electron|node:fs|node:fs\/promises|node:child_process|node:sqlite|sql\.js)["']\)/;
  for (const entry of complexity.boundaryModules) {
    const source = fs.readFileSync(path.join(root, entry.relativePath), "utf8");
    if (entry.relativePath.endsWith("complexityBudget.cjs")) continue;
    assert.doesNotMatch(source, forbiddenImports, `${entry.relativePath} must stay pure and injected`);
  }

  console.log("Runtime boundary contract tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
