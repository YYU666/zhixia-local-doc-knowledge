const assert = require("node:assert/strict");

const {
  buildUpsertPlan,
  evaluate,
  normalize,
  PERSISTENCE_SCAN_LIMITS,
  query,
  scanPersistenceStructure,
  stableMemoryFactId,
} = require("../electron/memoryFactPolicy.cjs");

const projectPath = "C:\\Users\\example\\Documents\\Zhixia";
const sourceA = {
  kind: "document",
  id: "decision-1",
  path: `${projectPath}\\docs\\decisions.md`,
  hash: "sha256-a",
  updatedAt: "2026-07-01T10:00:00.000Z",
};
const sourceB = {
  kind: "test",
  id: "verification-2",
  path: `${projectPath}\\tests\\runtime.test.cjs`,
  hash: "sha256-b",
  updatedAt: "2026-07-02T10:00:00.000Z",
};

function acceptedFact(overrides = {}) {
  return {
    projectPath,
    scope: "project",
    subject: "memory-runtime",
    predicate: "storage-mode",
    value: "local-first",
    factType: "architecture_decision",
    status: "accepted",
    confidence: 0.9,
    validFrom: "2026-07-01T10:00:00.000Z",
    observedAt: "2026-07-01T10:00:00.000Z",
    sourceRefs: [sourceA],
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

const deterministicInputA = acceptedFact({
  value: { durable: true, layers: ["hot", "warm"] },
  sourceRefs: [sourceA, sourceB],
});
const deterministicInputB = acceptedFact({
  value: { layers: ["hot", "warm"], durable: true },
  sourceRefs: [sourceB, sourceA],
});
assert.equal(stableMemoryFactId(deterministicInputA), stableMemoryFactId(deterministicInputB), "IDs should ignore object key and source ordering");
assert.equal(normalize(deterministicInputA).id, normalize(deterministicInputB).id, "normalization should produce deterministic IDs");

const firstPlan = buildUpsertPlan([], acceptedFact(), { now: "2026-07-01T10:00:00.000Z" });
assert.equal(firstPlan.action, "insert");
assert.equal(firstPlan.facts.length, 1);
assert.equal(firstPlan.incoming.status, "accepted");

const sameFactAgain = acceptedFact({
  sourceRefs: [sourceB],
  observedAt: "2026-07-02T10:00:00.000Z",
  updatedAt: "2026-07-02T10:00:00.000Z",
});
const mergedPlan = buildUpsertPlan(firstPlan.facts, sameFactAgain, { now: "2026-07-02T10:00:00.000Z" });
assert.equal(mergedPlan.action, "merge", "same typed value should merge instead of creating a duplicate");
assert.equal(mergedPlan.facts.length, 1, "same fact upsert should remain one fact");
assert.equal(mergedPlan.incoming.id, firstPlan.incoming.id, "same fact should reuse its deterministic ID");
assert.equal(mergedPlan.incoming.sourceRefs.length, 2, "same fact should merge traceable sources");
assert.equal(mergedPlan.incoming.updatedAt, "2026-07-02T10:00:00.000Z", "same fact should merge the latest update time");
const idempotentPlan = buildUpsertPlan(mergedPlan.facts, sameFactAgain, { now: "2026-07-02T10:00:00.000Z" });
assert.equal(idempotentPlan.action, "noop", "repeating an already merged fact should be a no-op");
assert.deepEqual(idempotentPlan.facts, mergedPlan.facts, "idempotent upsert should not mutate stored facts");

const replacementInput = acceptedFact({
  value: "hybrid-indexed",
  confidence: 0.95,
  validFrom: "2026-08-01T00:00:00.000Z",
  observedAt: "2026-08-01T00:00:00.000Z",
  sourceRefs: [sourceB],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});
const replacementPlan = buildUpsertPlan(mergedPlan.facts, replacementInput, { now: "2026-08-01T00:00:00.000Z" });
assert.equal(replacementPlan.action, "supersede_existing", "newer accepted conflicting fact should replace the current fact");
assert.equal(replacementPlan.facts.length, 2, "replacement must retain the old fact");
const oldFact = replacementPlan.facts.find((fact) => fact.value === "local-first");
const newFact = replacementPlan.facts.find((fact) => fact.value === "hybrid-indexed");
assert.ok(oldFact && newFact);
assert.equal(oldFact.status, "superseded");
assert.equal(oldFact.supersededBy, newFact.id);
assert.equal(oldFact.validTo, newFact.validFrom);
assert.equal(newFact.status, "accepted");

const recurrencePlan = buildUpsertPlan(replacementPlan.facts, acceptedFact({
  value: "local-first",
  validFrom: "2026-09-01T00:00:00.000Z",
  observedAt: "2026-09-01T00:00:00.000Z",
  sourceRefs: [{ kind: "decision", path: "docs/decision-return.md", hash: "return-a" }],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
}), { now: "2026-09-01T00:00:00.000Z" });
assert.equal(recurrencePlan.action, "supersede_existing", "A -> B -> A should create a new current occurrence");
const recurringCurrent = recurrencePlan.facts.filter((fact) => ["active", "accepted"].includes(fact.status) && !fact.validTo);
assert.equal(recurringCurrent.length, 1, "A -> B -> A must leave exactly one current fact");
assert.equal(recurringCurrent[0].value, "local-first");
assert.notEqual(recurringCurrent[0].id, oldFact.id, "recurring A must not reopen and overwrite the historical A row");
const recurringHistoricalA = recurrencePlan.facts.find((fact) => fact.id === oldFact.id);
assert.equal(recurringHistoricalA.status, "superseded");
assert.equal(recurringHistoricalA.validTo, "2026-08-01T00:00:00.000Z", "the first A validity interval must remain intact");

const reversePlan = buildUpsertPlan([newFact], acceptedFact(), { now: "2026-08-01T00:00:00.000Z" });
assert.equal(reversePlan.action, "retain_existing", "arrival order must not let an older accepted fact win");
assert.deepEqual(
  reversePlan.facts.map((fact) => ({ id: fact.id, status: fact.status, validTo: fact.validTo, supersededBy: fact.supersededBy })),
  replacementPlan.facts.map((fact) => ({ id: fact.id, status: fact.status, validTo: fact.validTo, supersededBy: fact.supersededBy })),
  "conflict and supersession results should be deterministic regardless of arrival order",
);

const noSource = evaluate(acceptedFact({ sourceRefs: [] }), { now: "2026-07-01T10:00:00.000Z" });
assert.equal(noSource.status, "review", "source-free facts must not become active/current");
assert.equal(noSource.eligibleForCurrent, false);
assert.ok(noSource.blockers.includes("missing_source_ref"));

const mixedGlobalProject = evaluate(acceptedFact({ scope: "global", projectPath }), { now: "2026-07-01T10:00:00.000Z" });
assert.equal(mixedGlobalProject.status, "review", "global scope with a projectPath must never remain accepted/current");
assert.equal(mixedGlobalProject.eligibleForCurrent, false);
assert.equal(mixedGlobalProject.fact.scope, "global");
assert.equal(mixedGlobalProject.fact.projectPath, null, "global facts must not retain projectPath");
assert.ok(mixedGlobalProject.blockers.includes("global_scope_forbids_project_path"));

const projectWithoutPath = evaluate(acceptedFact({ scope: "project", projectPath: null }), { now: "2026-07-01T10:00:00.000Z" });
assert.equal(projectWithoutPath.status, "review", "project scope without projectPath must fail closed");
assert.equal(projectWithoutPath.eligibleForCurrent, false);
assert.ok(projectWithoutPath.blockers.includes("project_scope_requires_project_path"));

const legacyMixedFact = acceptedFact({ id: "legacy-global-project", scope: "global", projectPath, status: "accepted" });
assert.equal(query([legacyMixedFact], { projectPath, status: "current" }).length, 0, "project queries must exclude legacy global facts carrying a projectPath");
const explicitLegacyGlobalReview = query([legacyMixedFact], { scope: "global", status: "review" });
assert.equal(explicitLegacyGlobalReview.length, 1, "legacy mixed facts may remain visible only as explicit global review material");
assert.equal(explicitLegacyGlobalReview[0].projectPath, null);

const validGlobalFact = normalize(acceptedFact({ id: "valid-global", scope: "global", projectPath: null, status: "accepted" }));
assert.equal(query([validGlobalFact], { scope: "global", status: "current" }).length, 1, "explicit global current retrieval should remain separate and truthful");
assert.equal(query([validGlobalFact], { projectPath, status: "current" }).length, 0);

const rawSession = evaluate(acceptedFact({
  sourceRefs: [{ kind: "raw_session", path: "C:\\Users\\example\\.codex\\sessions\\session.jsonl" }],
  value: "raw session transcript",
}));
assert.equal(rawSession.status, "rejected", "raw sessions should be rejected");
assert.equal(JSON.stringify(rawSession.fact).includes("session.jsonl"), false, "raw session paths should not be retained");

const secret = evaluate(acceptedFact({ value: "api_key=sk-super-secret-value" }));
assert.equal(secret.status, "rejected", "secret-bearing facts should be rejected");
assert.equal(JSON.stringify(secret.fact).includes("super-secret-value"), false, "secret values should not be retained");

const adversarialToken = "ghp_1234567890ABCDEFGHIJKLMN";
const structuredBypasses = [
  { label: "id", override: { id: adversarialToken } },
  { label: "projectPath", override: { projectPath: "C:\\Users\\example\\.codex\\sessions\\unsafe.jsonl" } },
  { label: "scope", override: { scope: "raw_session" } },
  { label: "status", override: { status: adversarialToken } },
  { label: "tags", override: { tags: [adversarialToken] } },
  { label: "sourceRef kind", override: { sourceRefs: [{ ...sourceA, kind: "raw_session" }] } },
  { label: "sourceRef id", override: { sourceRefs: [{ ...sourceA, id: adversarialToken }] } },
  { label: "sourceRef path", override: { sourceRefs: [{ ...sourceA, path: "C:\\Users\\example\\.codex\\archived_sessions\\unsafe.jsonl" }] } },
  { label: "sourceRef hash", override: { sourceRefs: [{ ...sourceA, hash: adversarialToken }] } },
];
for (const bypass of structuredBypasses) {
  const result = evaluate(acceptedFact(bypass.override), { now: "2026-07-01T10:00:00.000Z" });
  assert.equal(result.status, "rejected", `${bypass.label} must participate in fail-closed evaluation`);
  assert.equal(JSON.stringify(result.fact).includes(adversarialToken), false, `${bypass.label} must not retain unsafe original values`);
  assert.equal(JSON.stringify(result.fact).includes("unsafe.jsonl"), false, `${bypass.label} must not retain raw-session paths`);
}

const dangerousKeyToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const dangerousKeyCases = [
  { label: "token key", value: { [dangerousKeyToken]: "safe" } },
  { label: "raw key", value: { raw_session: "safe" } },
  { label: "base64 key", value: { [`data:text/plain;base64,${"A".repeat(220)}`]: "safe" } },
  { label: "PEM key", value: { "-----BEGIN PRIVATE KEY-----": "safe" } },
  { label: "AWS key", value: { AKIA1234567890ABCDEF: "safe" } },
];
for (const keyCase of dangerousKeyCases) {
  const result = evaluate(acceptedFact({ value: keyCase.value }));
  assert.equal(result.status, "rejected", `${keyCase.label} must be scanned as persistence input`);
  assert.equal(JSON.stringify(result.fact).includes(dangerousKeyToken), false, `${keyCase.label} must not persist unsafe keys`);
}

const post120Danger = {};
for (let index = 0; index < 130; index += 1) post120Danger[`safe_${String(index).padStart(3, "0")}`] = "safe";
post120Danger[dangerousKeyToken] = "safe";
const post120Result = evaluate(acceptedFact({ value: post120Danger }));
assert.equal(post120Result.status, "rejected", "dangerous keys after 120 prior entries must still be scanned");
assert.equal(post120Result.flags.structureTruncated, false, "the post-120 danger should remain inside the bounded object budget");

const oversizedObject = {};
for (let index = 0; index < PERSISTENCE_SCAN_LIMITS.maxObjectEntries + 20; index += 1) oversizedObject[`safe_${String(index).padStart(3, "0")}`] = "safe";
oversizedObject[dangerousKeyToken] = "safe";
const oversizedObjectResult = evaluate(acceptedFact({ value: oversizedObject }));
assert.equal(oversizedObjectResult.status, "rejected", "object traversal truncation must fail closed even when danger is beyond the budget");
assert.equal(oversizedObjectResult.flags.structureTruncated, true);
assert.ok(oversizedObjectResult.blockers.includes("structure_truncated_blocked"));

const deepValue = {};
let deepCursor = deepValue;
for (let depth = 0; depth < PERSISTENCE_SCAN_LIMITS.maxDepth + 3; depth += 1) {
  deepCursor.next = {};
  deepCursor = deepCursor.next;
}
deepCursor[dangerousKeyToken] = "safe";
const deepResult = evaluate(acceptedFact({ value: deepValue }));
assert.equal(deepResult.status, "rejected", "depth truncation must fail closed");
assert.equal(deepResult.flags.structureTruncated, true);

const post120Array = Array.from({ length: 140 }, (_, index) => index === 130 ? dangerousKeyToken : `safe-${index}`);
const post120ArrayResult = evaluate(acceptedFact({ value: post120Array }));
assert.equal(post120ArrayResult.status, "rejected", "dangerous array values after 120 entries must be scanned");
assert.equal(post120ArrayResult.flags.structureTruncated, false);

const oversizedArray = Array.from({ length: PERSISTENCE_SCAN_LIMITS.maxArrayEntries + 20 }, (_, index) => `safe-${index}`);
oversizedArray[oversizedArray.length - 1] = dangerousKeyToken;
const oversizedArrayResult = evaluate(acceptedFact({ value: oversizedArray }));
assert.equal(oversizedArrayResult.status, "rejected", "array traversal truncation must fail closed");
assert.equal(oversizedArrayResult.flags.structureTruncated, true);

const splitSecret = evaluate(acceptedFact({ value: { prefix: "ghp_", bodyPart: "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" } }));
assert.equal(splitSecret.status, "rejected", "adjacent strong token prefix/body fields must be reconstructed for detection");
assert.equal(splitSecret.flags.secret, true);

const boundedScan = scanPersistenceStructure({ items: Array.from({ length: 600 }, (_, index) => `bounded-${index}`) });
assert.equal(boundedScan.structureTruncated, true, "bounded scanner should report truncation instead of silently ignoring entries");
assert.equal(boundedScan.stats.nodesVisited <= PERSISTENCE_SCAN_LIMITS.maxNodes + 1, true);
assert.equal(boundedScan.stats.signalChars <= PERSISTENCE_SCAN_LIMITS.maxSignalChars, true);

const base64 = evaluate(acceptedFact({ value: `data:image/png;base64,${"A".repeat(220)}` }));
assert.equal(base64.status, "rejected", "base64 payloads should be rejected");
assert.equal(base64.fact.value, "[base64-content-omitted]");

const giantBody = evaluate(acceptedFact({ body: "giant body sentence ".repeat(900), value: "safe sibling" }));
assert.equal(giantBody.status, "rejected", "giant sibling bodies should reject the whole fact input");
assert.equal(giantBody.fact.value, "[giant-body-content-omitted]");

const destructiveAction = evaluate(acceptedFact({ predicate: "delete-all", value: "remove all project records" }));
assert.equal(destructiveAction.status, "review", "destructive actions should require review");
assert.ok(destructiveAction.blockers.includes("destructive_action_requires_review"));

const rawBodyInput = normalize(acceptedFact({
  value: { summary: "compact", rawBody: "do not retain", transcript: "do not retain either" },
}));
assert.deepEqual(rawBodyInput.value, { summary: "compact" }, "structured values should omit raw body fields");
assert.equal(Object.hasOwn(rawBodyInput, "body"), false, "facts should expose only compact policy fields");

assert.deepEqual(query(replacementPlan.facts, { status: "current", asOf: "2026-07-15T00:00:00.000Z" }).map((fact) => fact.id), [oldFact.id]);
assert.deepEqual(query(replacementPlan.facts, { status: "current", asOf: "2026-08-15T00:00:00.000Z" }).map((fact) => fact.id), [newFact.id]);
assert.deepEqual(query(replacementPlan.facts, { status: "historical", asOf: "2026-08-15T00:00:00.000Z" }).map((fact) => fact.id), [oldFact.id]);
assert.deepEqual(query(replacementPlan.facts, { status: "superseded" }).map((fact) => fact.id), [oldFact.id]);

const statusFixtures = [
  normalize(acceptedFact({ predicate: "candidate", status: "candidate", value: "candidate" })),
  normalize(acceptedFact({ predicate: "review", status: "review", value: "review" })),
  normalize(acceptedFact({ predicate: "rejected", status: "rejected", value: "rejected" })),
];
assert.equal(query(statusFixtures, { status: "candidate" }).length, 1);
assert.equal(query(statusFixtures, { status: "review" }).length, 1);
assert.equal(query(statusFixtures, { status: "rejected" }).length, 1);

console.log("Memory fact temporal policy tests passed.");
