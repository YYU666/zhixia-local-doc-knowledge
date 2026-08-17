const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const types = fs.readFileSync(path.join(root, "src", "vite-env.d.ts"), "utf8");

function extractHandler(channel) {
  const marker = `ipcMain.handle("${channel}"`;
  const start = main.indexOf(marker);
  assert.notEqual(start, -1, `${channel} handler must exist`);
  const next = main.indexOf("\nipcMain.handle(", start + marker.length);
  return main.slice(start, next === -1 ? main.length : next);
}

assert.match(main, /registerRuntimeBoundaryFacade\([\s\S]*ipcRegistrar: ipcMain/, "main must register the real facade");
assert.match(main, /retrieveReadonlyMemory:\s*createStrictReadonlyMemoryProductQuery\(\{\s*userDataPath:\s*app\.getPath\("userData"\)/, "strict read-only product route must use the existing-only product adapter before any fallback");
assert.match(main, /activeReadonlyQuery:[\s\S]*retrieveAgentContext\(\{[\s\S]*readOnly:\s*true/, "an already-active WAL store may use only the Agent index's explicit read-only query");
assert.doesNotMatch(main, /retrieveReadonlyMemory:\s*retrieveMemoryRuntimeContext/, "strict read-only product route must not reuse the mutation-capable retrieval path");
assert.doesNotMatch(main, /ipcMain\.handle\("codexGuardian:/, "legacy Guardian IPC registrations must be removed");
assert.doesNotMatch(main, /ipcMain\.handle\("memoryRuntime:authorityLifecycleReview"/, "legacy authority IPC registration must be removed");
assert.match(preload, /runtimeBoundary:guardianInvoke/, "Guardian public APIs must use the facade route");
assert.match(preload, /runtimeBoundary:authorityReview/, "authority review must use the facade route");
assert.match(preload, /runtimeBoundary:authorityAcceptRefreshReverify/, "authority acceptance must use the facade route");
assert.match(preload, /runtimeBoundary:strictReadonlyMemoryQuery/, "strict read-only retrieval must use the facade route");
assert.match(preload, /retrieveAgentContext:[\s\S]*options\?\.readOnly === true[\s\S]*runtimeBoundary:strictReadonlyMemoryQuery/, "ordinary Agent UI reads must enter the strict facade");
assert.match(preload, /runtimeBoundary:releaseEvidence/, "release evidence read must use the facade route");
assert.doesNotMatch(main, /ipcMain\.handle\("projectRelease:loadEvidence"/, "release evidence must not bypass the facade");
assert.match(types, /acceptMemoryRuntimeAuthority/, "renderer types must expose the explicit acceptance operation");

assert.match(app, /initialRendererWorkflow[\s\S]*transitionRendererWorkflow[\s\S]*rendererWorkflowView/, "App must use the shared workflow implementation");
assert.match(app, /type: "VERIFY_STARTED"[\s\S]*type: "REVIEW_PREPARED"/, "preview must advance verify to review");
assert.match(app, /type: "ACCEPT_CONFIRMED"[\s\S]*acceptMemoryRuntimeAuthority/, "accept UI must explicitly confirm before calling the mutation route");
assert.match(app, /type: "ACCEPTED"[\s\S]*type: "REFRESHED"[\s\S]*type: "REVERIFIED"/, "accepted result must advance receipt, checkpoint, and reverify stages");
assert.match(app, /authorityWorkflowView\.canAccept/, "accept control must be driven by reducer state");
assert.match(app, /authorityWorkflowView\.ready/, "ready display must be driven by reducer state");
assert.match(app, /retrieveAgentContext\(\{[\s\S]*readOnly:\s*true/, "ordinary Agent UI retrieval must request strict read-only mode");
assert.match(app, /data-e2e="agent-retrieval-contract"[\s\S]*strict read-only/, "ordinary Agent UI must disclose the strict read-only contract");

const agentRetrieveHandler = extractHandler("agent:retrieveContext");
assert.match(agentRetrieveHandler, /if \(options\.readOnly === true\) return runtimeBoundaryIntegration\.strictReadonlyMemoryQuery\.query\(options\);[\s\S]*await ensureDatabase\(\)/, "direct Agent IPC must branch to strict read-only before database initialization");

const memoryRuntimeRetrieveHandler = extractHandler("memoryRuntime:retrieveContext");
assert.match(memoryRuntimeRetrieveHandler, /if \(options\.readOnly === true\) return runtimeBoundaryIntegration\.strictReadonlyMemoryQuery\.query\(options\);[\s\S]*await ensureDatabase\(\)/, "legacy Memory Runtime read-only IPC must branch before database initialization");

const skillCandidateHandler = extractHandler("memory:updateSkillCandidateStatus");
assert.match(skillCandidateHandler, /createPersistenceTransactionPort/, "Skill candidate status mutation must use the transaction port");
assert.match(skillCandidateHandler, /operation: "memory\.update_skill_candidate_status"/, "transaction must name its mutation family");
assert.doesNotMatch(skillCandidateHandler, /const candidate = updateSkillCandidateStatus[\s\S]*await saveDatabase/, "legacy mutate-plus-save sequence must be removed");

console.log("Runtime boundary product wiring tests passed.");
