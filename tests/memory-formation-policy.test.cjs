const assert = require("node:assert/strict");

const {
  EPISODE_MEMORY_SCHEMA,
  SUPPORTED_EVENT_TYPES,
  buildMemoryFormationPlan: rawBuildMemoryFormationPlan,
  inspectMemoryFormationInput,
  normalizeMemoryFormationEvent: rawNormalizeMemoryFormationEvent,
  stableEventFingerprint: rawStableEventFingerprint,
} = require("../electron/memoryFormationPolicy.cjs");
const { PROJECT_CONTINUITY_SLOTS } = require("../electron/projectBrainPolicy.cjs");

const PROJECT_ID = "project-zhixia";
const MODULE_ID = "module-memory-formation";
const OBSERVED_AT = "2026-07-16T03:00:00.000Z";

function sourceRef(name = "formation-policy", overrides = {}) {
  return {
    kind: "document",
    id: `source-${name}`,
    path: `C:/repo/docs/${name}.md`,
    hash: `hash-${name}`,
    projectId: PROJECT_ID,
    moduleId: MODULE_ID,
    ...overrides,
  };
}

function authority(overrides = {}) {
  return {
    receiptId: "authority-receipt-formation-1",
    receiptProof: "receipt-proof-formation-1",
    projectId: PROJECT_ID,
    moduleId: MODULE_ID,
    action: "memory_formation",
    transition: "form:accepted",
    ...overrides,
  };
}

function event(overrides = {}) {
  const value = {
    eventType: "accepted",
    projectId: PROJECT_ID,
    moduleId: MODULE_ID,
    title: "Memory formation policy accepted",
    summary: "The deterministic event formation contract passed focused review.",
    result: "Episode and continuity candidates are ready for store integration.",
    why: "The implementation is source-backed, bounded, and has no host effects.",
    nextAction: "Route the plan through the already accepted store contract.",
    sourceRefs: [sourceRef()],
    authorityOutcome: null,
    riskLevel: "low",
    deterministic: true,
    observedAt: OBSERVED_AT,
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, "authorityOutcome")) {
    const confirmsRule = value.confirmsExistingStandingRule === true || value.standingRuleRepeat === true;
    const ruleId = value.existingRuleId || value.ruleId || null;
    value.authorityOutcome = authority({
      transition: confirmsRule ? `confirm_existing_rule:${String(ruleId || "missing").toLowerCase().replace(/[\s-]+/g, "_")}` : `form:${value.eventType}`,
      ruleId: confirmsRule ? ruleId : null,
    });
  }
  return value;
}

function trustedAuthorityVerifier(overrides = {}) {
  return (request) => ({
    ...request,
    verified: true,
    allowed: true,
    active: true,
    decision: "accepted",
    riskLevel: "low",
    deterministic: true,
    decisionFingerprint: `decision-${request.receiptId}`,
    ...overrides,
  });
}

const TRUSTED_OPTIONS = Object.freeze({ authorityVerifier: trustedAuthorityVerifier() });

function buildMemoryFormationPlan(input, options = {}) {
  return rawBuildMemoryFormationPlan(input, { ...TRUSTED_OPTIONS, ...options });
}

function normalizeMemoryFormationEvent(input, options = {}) {
  return rawNormalizeMemoryFormationEvent(input, { ...TRUSTED_OPTIONS, ...options });
}

function stableEventFingerprint(input, options = {}) {
  return rawStableEventFingerprint(input, { ...TRUSTED_OPTIONS, ...options });
}

function artifactRef(name, overrides = {}) {
  return {
    id: `artifact-${name}`,
    path: `C:/repo/${name}.md`,
    hash: `artifact-hash-${name}`,
    projectId: PROJECT_ID,
    moduleId: MODULE_ID,
    ...overrides,
  };
}

function assertNoAcceptedContinuitySlots(plan) {
  assert.equal(plan.continuityPatchCandidate.touchedSlots.includes("accepted_progress"), false);
  assert.equal(plan.continuityPatchCandidate.touchedSlots.includes("last_valid_checkpoint"), false);
}

assert.deepEqual(
  SUPPORTED_EVENT_TYPES,
  [
    "accepted",
    "revise",
    "block",
    "checkpoint",
    "user_rule",
    "user_correction",
    "test_failure",
    "test_pass",
    "build",
    "install",
    "release",
    "thread_recovery",
    "handoff",
  ],
  "formation must expose the complete explicit event vocabulary",
);

const aliases = {
  accept: "accepted",
  revised: "revise",
  blocked: "block",
  task_checkpoint: "checkpoint",
  user_rule_update: "user_rule",
  correction: "user_correction",
  tests_failed: "test_failure",
  tests_passed: "test_pass",
  build_result: "build",
  installation: "install",
  released: "release",
  takeover: "thread_recovery",
  thread_handoff: "handoff",
};
for (const [inputType, expectedType] of Object.entries(aliases)) {
  const normalized = normalizeMemoryFormationEvent(event({ eventType: inputType }));
  assert.equal(normalized.eventType, expectedType, `${inputType} should normalize to ${expectedType}`);
}

const accepted = buildMemoryFormationPlan(event({
  before: ["No event formation module existed."],
  after: ["The pure formation module and focused contract now exist."],
  decisions: ["Use explicit material events instead of chat-message ingestion."],
  constraints: ["Never inherit project authority from ambient context."],
  artifacts: [
    artifactRef("test", { title: "Focused formation test", path: "C:/repo/tests/memory-formation-policy.test.cjs", hash: "hash-test" }),
    artifactRef("policy", { title: "Formation policy", path: "C:/repo/electron/memoryFormationPolicy.cjs", hash: "hash-policy" }),
  ],
  threadRefs: [{ threadId: "worker-wave3-01", role: "worker", status: "active" }],
  metrics: { reuseCount: 3, reuseScore: 0.75, compoundCount: 2, compoundScore: 0.5, recurrenceCount: 1 },
}));
assert.equal(accepted.status, "accepted", "verified low-risk deterministic source-backed outcomes may be accepted");
assert.equal(accepted.accepted, true);
assert.equal(accepted.episode.schemaVersion, EPISODE_MEMORY_SCHEMA);
assert.equal(accepted.episode.projectId, PROJECT_ID);
assert.equal(accepted.episode.moduleId, MODULE_ID);
assert.equal(accepted.episode.sourceBacked, true);
assert.equal(accepted.episode.before.length, 1);
assert.equal(accepted.episode.after.length, 1);
assert.equal(accepted.episode.result.length, 1);
assert.equal(accepted.episode.why.length, 1);
assert.equal(accepted.episode.nextActions.length, 1);
assert.equal(accepted.episode.threadIds[0], "worker-wave3-01");
assert.equal(accepted.episode.artifactRefs.length, 2);
assert.equal(accepted.episode.metrics.reuseCount, 3);
assert.equal(accepted.episode.metrics.compoundCount, 2);
assert.equal(accepted.decisionCandidates.length, 1);
assert.equal(accepted.decisionCandidates[0].status, "candidate", "typed decisions remain explicit candidates");
assert.equal(accepted.decisionCandidates[0].recommendedStatus, "accepted");
assert.equal(accepted.constraintCandidates.length, 1);
assert.equal(accepted.checkpointCandidate.recommendedStatus, "accepted");
assert.ok(accepted.upserts.every((upsert) => upsert.idempotencyKey.includes(upsert.id)));
assert.equal(Object.isFrozen(accepted), true);
assert.equal(accepted.event.authority.verified, true);
assert.equal(accepted.event.authority.active, true);
assert.equal(accepted.event.authority.projectId, PROJECT_ID);
assert.equal(accepted.event.authority.moduleId, MODULE_ID);
assert.equal(accepted.event.authority.action, "memory_formation");
assert.equal(accepted.event.authority.transition, "form:accepted");

const selfAttestedOnly = rawBuildMemoryFormationPlan(event({
  authorityOutcome: {
    ...authority(),
    verified: true,
    allowed: true,
    active: true,
    decision: "accepted",
    riskLevel: "low",
    deterministic: true,
  },
}));
assert.equal(selfAttestedOnly.status, "review", "caller JSON self-attestation cannot replace an in-process verifier capability");
assert.equal(selfAttestedOnly.event.authority.verified, false);
assert.ok(selfAttestedOnly.event.authority.reasonCodes.includes("trusted_authority_verifier_required"));
assert.notEqual(selfAttestedOnly.eventFingerprint, accepted.eventFingerprint, "accepted and unverified review variants must not collide");

for (const [label, override] of Object.entries({
  receipt_id: { receiptId: "receipt-wrong" },
  receipt_proof: { receiptProof: "proof-wrong" },
  target: { targetFingerprint: "authority-target-wrong" },
  action: { action: "other_action" },
  transition: { transition: "form:other" },
  project: { projectId: "project-foreign" },
  module: { moduleId: "module-foreign" },
  inactive: { active: false },
  unverified: { verified: false },
  denied: { allowed: false },
  review_decision: { decision: "review" },
})) {
  const plan = buildMemoryFormationPlan(event(), { authorityVerifier: trustedAuthorityVerifier(override) });
  assert.equal(plan.status, "review", `${label} verifier mismatch must not authorize formation`);
  assert.equal(plan.event.authority.allowed, false, `${label} must not remain allowed`);
}

const verifierHighRisk = buildMemoryFormationPlan(event({ riskLevel: "low", deterministic: true }), {
  authorityVerifier: trustedAuthorityVerifier({ riskLevel: "high" }),
});
assert.equal(verifierHighRisk.status, "review");
assert.equal(verifierHighRisk.event.riskLevel, "high", "risk must come only from the verifier result");
assert.ok(verifierHighRisk.reasonCodes.includes("low_risk_outcome_required"));

const verifierNonDeterministic = buildMemoryFormationPlan(event({ deterministic: true }), {
  authorityVerifier: trustedAuthorityVerifier({ deterministic: false }),
});
assert.equal(verifierNonDeterministic.status, "review");
assert.equal(verifierNonDeterministic.event.deterministic, false, "caller input cannot flip verifier determinism");

const callerCannotOverrideVerifier = buildMemoryFormationPlan(event({ riskLevel: "critical", deterministic: false }));
assert.equal(callerCannotOverrideVerifier.status, "accepted");
assert.equal(callerCannotOverrideVerifier.event.riskLevel, "low");
assert.equal(callerCannotOverrideVerifier.event.deterministic, true);
assert.notEqual(verifierHighRisk.eventFingerprint, accepted.eventFingerprint, "verified risk variants must have distinct durable IDs");

const repeatA = buildMemoryFormationPlan(event({
  eventId: "formation-event-001",
  decisions: ["Beta decision", "Alpha decision", "Alpha decision"],
  constraints: ["Constraint B", "Constraint A"],
  sourceRefs: [sourceRef("z-source"), sourceRef("a-source")],
  moduleIds: ["module-z", MODULE_ID, "module-a"],
  artifacts: [
    artifactRef("z", { hash: "z" }),
    artifactRef("a", { hash: "a" }),
  ],
  threadRefs: [{ threadId: "thread-z" }, { threadId: "thread-a" }],
  entities: ["Zulu", "Alpha"],
  cues: ["z-cue", "a-cue"],
}));
const repeatB = buildMemoryFormationPlan(event({
  eventId: "formation-event-001",
  decisions: ["Alpha decision", "Beta decision"],
  constraints: ["Constraint A", "Constraint B"],
  sourceRefs: [sourceRef("a-source"), sourceRef("z-source")],
  moduleIds: ["module-a", "module-z", MODULE_ID],
  artifacts: [
    artifactRef("a", { hash: "a" }),
    artifactRef("z", { hash: "z" }),
  ],
  threadRefs: [{ threadId: "thread-a" }, { threadId: "thread-z" }],
  entities: ["Alpha", "Zulu"],
  cues: ["a-cue", "z-cue"],
}));
assert.equal(stableEventFingerprint(repeatA.event), stableEventFingerprint(repeatB.event));
assert.deepEqual(repeatA, repeatB, "equivalent event sets must produce byte-stable idempotent plans");
assert.deepEqual(repeatA.event.decisions, ["Alpha decision", "Beta decision"]);
assert.deepEqual(repeatA.event.sourceRefs.map((ref) => ref.id), ["source-a-source", "source-z-source"]);
assert.deepEqual(repeatA.event.threads.map((thread) => thread.threadId), ["thread-a", "thread-z"]);

const revised = buildMemoryFormationPlan(event({
  eventType: "revise",
  summary: "Review found a missing deterministic scope assertion.",
  failures: [{ code: "SCOPE-01", summary: "The original candidate inherited scope." }],
  nextAction: "Require explicit projectId and moduleId.",
}), { authorityVerifier: trustedAuthorityVerifier({ decision: "review", allowed: false }) });
assert.equal(revised.status, "review");
assert.ok(revised.reasonCodes.includes("authority_outcome_not_accepted"));
assert.equal(revised.episode.eventType, "revise");
assert.ok(revised.continuityPatchCandidate.touchedSlots.includes("latest_failures"));

const blocked = buildMemoryFormationPlan(event({
  eventType: "block",
  summary: "Formation is blocked by unsafe evidence input.",
  blockers: ["Caller must replace the unsafe evidence with a cold pointer."],
  failures: [{ code: "UNSAFE-EVIDENCE", summary: "Unsafe evidence cannot enter warm memory." }],
}), { authorityVerifier: trustedAuthorityVerifier({ decision: "review", allowed: false }) });
assert.equal(blocked.status, "review");
assert.ok(blocked.reasonCodes.includes("authority_outcome_not_accepted"));
assert.ok(blocked.continuityPatchCandidate.touchedSlots.includes("open_blockers"));

const checkpoint = buildMemoryFormationPlan(event({
  eventType: "checkpoint",
  summary: "Formation implementation reached focused-test checkpoint.",
  phase: "wave3_formation",
  acceptedProgress: ["Policy module implemented."],
  openTasks: ["Run focused tests."],
  blockers: ["None in assigned write-set."],
}));
assert.equal(checkpoint.status, "accepted");
assert.equal(checkpoint.checkpointCandidate.phase, "wave3_formation");
assert.ok(checkpoint.continuityPatchCandidate.touchedSlots.includes("current_phase"));
assert.ok(checkpoint.continuityPatchCandidate.touchedSlots.includes("last_valid_checkpoint"));

const userRule = buildMemoryFormationPlan(event({
  eventType: "user_rule",
  summary: "The user set a standing memory formation rule.",
  constraints: ["Never convert ordinary chat messages into EpisodeMemory."],
}), { authorityVerifier: trustedAuthorityVerifier({ decision: "review", allowed: false }) });
assert.equal(userRule.status, "review", "new standing rules remain review candidates");
assert.equal(userRule.constraintCandidates[0].constraintType, "standing_rule");
assert.equal(userRule.constraintCandidates[0].ownerApprovalRequired, true);
assert.deepEqual(userRule.continuityPatchCandidate.touchedSlots, ["standing_rules", "active_modules", "next_actions"]);

const repeatedStandingRule = buildMemoryFormationPlan(event({
  eventType: "user_rule",
  summary: "Existing accepted standing rule was deterministically confirmed again.",
  constraints: ["Never convert ordinary chat messages into EpisodeMemory."],
  confirmsExistingStandingRule: true,
  existingRuleId: "rule-no-chat-ingestion",
}));
assert.equal(repeatedStandingRule.status, "accepted", "source-backed repeat confirmation may reuse accepted standing-rule authority");

const missingStandingRuleId = buildMemoryFormationPlan(event({
  eventType: "user_rule",
  summary: "A caller claimed to confirm a rule without identifying it.",
  constraints: ["Never convert ordinary chat messages into EpisodeMemory."],
  confirmsExistingStandingRule: true,
}));
assert.equal(missingStandingRuleId.status, "review");
assert.ok(missingStandingRuleId.event.reasonCodes.includes("existing_rule_id_required"));

const wrongStandingRuleBinding = buildMemoryFormationPlan(event({
  eventType: "user_rule",
  summary: "An existing rule confirmation used a mismatched verifier binding.",
  constraints: ["Never convert ordinary chat messages into EpisodeMemory."],
  confirmsExistingStandingRule: true,
  existingRuleId: "rule-no-chat-ingestion",
}), { authorityVerifier: trustedAuthorityVerifier({ ruleId: "rule-other" }) });
assert.equal(wrongStandingRuleBinding.status, "review");
assert.ok(wrongStandingRuleBinding.event.authority.reasonCodes.includes("authority_verifier_binding_mismatch"));

const userCorrection = buildMemoryFormationPlan(event({
  eventType: "user_correction",
  summary: "The user corrected the project direction.",
  correction: "Keep inherited model and reasoning settings unchanged.",
}), { authorityVerifier: trustedAuthorityVerifier({ decision: "review", allowed: false }) });
assert.equal(userCorrection.status, "review");
assert.equal(userCorrection.constraintCandidates[0].constraintType, "user_correction");
assert.equal(userCorrection.constraintCandidates[0].ownerApprovalRequired, true);
assert.ok(userCorrection.continuityPatchCandidate.touchedSlots.includes("standing_rules"));

const failure = buildMemoryFormationPlan(event({
  eventType: "test_failure",
  title: "Formation policy focused test failed",
  summary: "The continuity patch included an invalid slot.",
  failures: [{ code: "SLOT-INVALID", summary: "non_negotiable_constraints is not a runtime slot." }],
  nextAction: "Use the exact ProjectBrain slot contract.",
}));
assert.equal(failure.status, "accepted", "verified deterministic test failures are valid historical episodes");
assert.ok(failure.continuityPatchCandidate.touchedSlots.includes("latest_failures"));

const fix = buildMemoryFormationPlan(event({
  eventType: "test_pass",
  title: "Formation policy focused test passed",
  summary: "The patch now uses only the canonical ProjectBrain slots.",
  result: "All focused assertions pass.",
  fixesEpisodeIds: [failure.episode.episodeId],
}));
assert.equal(fix.status, "accepted");
assert.equal(fix.relationCandidates.length, 1);
assert.equal(fix.relationCandidates[0].relationType, "fixed_by");
assert.equal(fix.relationCandidates[0].fromEpisodeId, failure.episode.episodeId);
assert.equal(fix.relationCandidates[0].toEpisodeId, fix.episode.episodeId);

const recovery = buildMemoryFormationPlan(event({
  eventType: "thread_recovery",
  summary: "A replacement worker recovered from compact project evidence.",
  threadRefs: [
    { threadId: "worker-old", status: "unavailable" },
    { threadId: "worker-new", status: "active" },
  ],
  openTasks: ["Continue focused formation tests."],
  nextAction: "Resume from the accepted checkpoint." ,
  sourceRefs: [
    sourceRef("handoff"),
    { kind: "cold_pointer", id: "vault-pointer-old-worker", title: "Old worker evidence pointer", hash: "cold-hash" },
  ],
}));
assert.equal(recovery.status, "accepted");
assert.deepEqual(recovery.episode.threadIds, ["worker-new", "worker-old"]);
assert.equal(recovery.episode.coldEvidencePointers.length, 1);
assert.equal(recovery.episode.coldEvidencePointers[0].path, null);
assert.ok(recovery.warnings.includes("cold_evidence_pointer_only"));
assert.ok(recovery.continuityPatchCandidate.touchedSlots.includes("thread_lineage"));

const handoff = buildMemoryFormationPlan(event({
  eventType: "handoff",
  summary: "The worker prepared a compact handoff for the next implementation lane.",
  threadRefs: [{ threadId: "worker-next", status: "planned" }],
  openTasks: ["Integrate the formation plan into the store in a later task."],
  nextAction: "Read the checkpoint and focused test evidence.",
}));
assert.equal(handoff.status, "accepted");
assert.ok(handoff.continuityPatchCandidate.touchedSlots.includes("thread_lineage"));
assert.ok(handoff.continuityPatchCandidate.touchedSlots.includes("open_tasks"));

const noSource = buildMemoryFormationPlan(event({ sourceRefs: [] }));
assert.equal(noSource.status, "review", "no-source events must downgrade instead of becoming accepted truth");
assert.equal(noSource.episode.sourceBacked, false);
assert.ok(noSource.reasonCodes.includes("missing_source_refs_candidate_only"));
assert.ok(noSource.warnings.includes("missing_source_refs_candidate_only"));
assert.ok(Object.values(noSource.effects).every((value) => value === false), "review plans must remain host-effect free");

const noAuthority = buildMemoryFormationPlan(event({ authorityOutcome: null }));
assert.equal(noAuthority.status, "review");
assert.ok(noAuthority.reasonCodes.includes("verified_authority_outcome_required"));
assert.ok(noAuthority.reasonCodes.includes("authority_receipt_id_required"));

const unscopedAuthority = buildMemoryFormationPlan(event({
  authorityOutcome: authority({ projectId: null, moduleId: null }),
}));
assert.equal(unscopedAuthority.status, "review", "authority scope must be carried by the verified receipt itself");
assert.ok(unscopedAuthority.reasonCodes.includes("explicit_authority_project_module_scope_required"));

const unscopedSource = buildMemoryFormationPlan(event({
  sourceRefs: [sourceRef("unscoped", { projectId: null, moduleId: null })],
}));
assert.equal(unscopedSource.status, "review", "unscoped source evidence cannot inherit event scope");
assert.ok(unscopedSource.reasonCodes.includes("explicit_source_project_module_scope_required"));

const coldPointerOnly = buildMemoryFormationPlan(event({
  sourceRefs: [{ kind: "cold_pointer", id: "cold-only", title: "Cold evidence pointer", hash: "cold-only-hash" }],
}));
assert.equal(coldPointerOnly.status, "review", "cold pointer alone cannot become accepted direct evidence");
assert.ok(coldPointerOnly.reasonCodes.includes("explicit_source_project_module_scope_required"));

const unsafeCases = [
  event({ sessionBody: "raw session body must not persist" }),
  event({ messages: [{ role: "user", content: "ordinary chat message" }] }),
  event({ summary: `data:text/plain;base64,${"A".repeat(300)}` }),
  event({ summary: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" }),
  event({ summary: "x".repeat(20000) }),
  event({ command: "delete C:/Users/example/.codex/sessions" }),
  event({ hostAction: "archive active thread" }),
  event({ sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/thread.jsonl" }] }),
];
for (const unsafeInput of unsafeCases) {
  const inspection = inspectMemoryFormationInput(unsafeInput);
  const plan = buildMemoryFormationPlan(unsafeInput);
  assert.equal(inspection.safe, false);
  assert.equal(plan.status, "rejected");
  assert.equal(plan.episode, null);
  assert.equal(plan.upserts.length, 0);
  assert.ok(Object.values(plan.effects).every((value) => value === false), "rejected plans must remain host-effect free");
}

let getterCalls = 0;
const accessorInput = event();
Object.defineProperty(accessorInput, "summary", {
  enumerable: true,
  get() {
    getterCalls += 1;
    return "getter must never run";
  },
});
const accessorPlan = buildMemoryFormationPlan(accessorInput);
assert.equal(accessorPlan.status, "rejected");
assert.equal(getterCalls, 0, "descriptor preflight must reject accessors without invoking getters");
assert.ok(accessorPlan.reasonCodes.includes("unsafe_accessor_input"));

let proxyTrapCalls = 0;
const proxyInput = new Proxy(event(), {
  ownKeys(target) {
    proxyTrapCalls += 1;
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    proxyTrapCalls += 1;
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
});
const proxyPlan = buildMemoryFormationPlan(proxyInput);
assert.equal(proxyPlan.status, "rejected");
assert.equal(proxyTrapCalls, 0, "Proxy detection must occur without executing proxy traps");
assert.ok(proxyPlan.reasonCodes.includes("unsafe_proxy_input"));

const cyclicInput = event();
cyclicInput.metadata = cyclicInput;
const cyclicPlan = buildMemoryFormationPlan(cyclicInput);
assert.equal(cyclicPlan.status, "rejected");
assert.ok(cyclicPlan.reasonCodes.includes("unsafe_cycle_input"));

const splitSecretInput = event({
  notes: ["Author", "ization:", "Bear", "er", "abcdefghijkl", "mnopqrstu", "vwxyz123", "456"],
});
assert.equal(inspectMemoryFormationInput(splitSecretInput).safe, false, "secrets split across eight bounded fragments must be detected");
assert.equal(buildMemoryFormationPlan(splitSecretInput).status, "rejected");

const receiptMaterialInput = event({
  authorityOutcome: authority({
    receiptId: "Author",
    receiptProof: "ization:Bear",
    decisionFingerprint: "erabcdefghijklmnopqrstu",
    proof: "vwxyz123456",
  }),
});
assert.equal(inspectMemoryFormationInput(receiptMaterialInput).safe, true, "receipt and cryptographic metadata must not form split-secret false positives");

const unrelatedScalarFragments = event({
  alpha: "Author",
  beta: "ization:",
  gamma: "Bear",
  delta: "er",
  epsilon: "abcdefghijkl",
  zeta: "mnopqrstuvwxyz123456",
});
assert.equal(inspectMemoryFormationInput(unrelatedScalarFragments).safe, true, "unrelated scalar fields must not be concatenated into a synthetic secret");

assert.equal(inspectMemoryFormationInput(event({ summary: "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" })).safe, false, "real secret tokens must still fail closed");
assert.equal(inspectMemoryFormationInput(event({ summary: `data:text/plain;base64,${"A".repeat(300)}` })).safe, false, "real base64 payloads must still fail closed");
assert.equal(inspectMemoryFormationInput(event({ sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/thread.jsonl" }] })).safe, false, "raw-session payloads must still fail closed");

for (const destructiveInput of [
  event({ intent: "delete the active thread" }),
  event({ request: { effect: "move the session archive" } }),
]) {
  const plan = buildMemoryFormationPlan(destructiveInput);
  assert.equal(plan.status, "rejected", "destructive intent in action-scoped metadata must fail closed");
  assert.ok(plan.reasonCodes.includes("destructive_host_intent_forbidden"));
}

const tailSecretInput = event({
  before: [
    ...Array.from({ length: 200 }, (_, index) => `Safe bounded prefix ${index}`),
    "Authorization: Bearer tail-secret-that-must-still-be-detected-123456",
  ],
});
assert.equal(inspectMemoryFormationInput(tailSecretInput).safe, false, "unsafe tail content must be scanned before bounded normalization");
assert.equal(buildMemoryFormationPlan(tailSecretInput).status, "rejected");

const normalizedAcceptedEvent = normalizeMemoryFormationEvent(event());
const forgedPreShapedEvent = {
  ...normalizedAcceptedEvent,
  safe: true,
  reasonCodes: [],
  summary: "Authorization: Bearer forged-pre-shaped-secret-1234567890",
};
const forgedPlan = buildMemoryFormationPlan(forgedPreShapedEvent);
assert.equal(forgedPlan.status, "rejected", "matching event schema must never bypass re-normalization and secret scanning");
assert.equal(forgedPlan.episode, null);

const noEventType = buildMemoryFormationPlan({
  projectId: PROJECT_ID,
  moduleId: MODULE_ID,
  summary: "A chat-like summary without an explicit event type.",
  sourceRefs: [sourceRef()],
});
assert.equal(noEventType.status, "rejected");
assert.ok(noEventType.reasonCodes.includes("explicit_supported_event_type_required"));

const noMaterialOutcome = buildMemoryFormationPlan(event({
  title: "Title alone is not a material event",
  summary: "",
  result: "",
  why: "",
  nextAction: "",
}));
assert.equal(noMaterialOutcome.status, "rejected");
assert.ok(noMaterialOutcome.reasonCodes.includes("material_event_evidence_required"));

const genericAcceptedChat = buildMemoryFormationPlan(event({
  title: "Greeting",
  summary: "Hello",
  result: "",
  why: "",
  nextAction: "",
}));
assert.equal(genericAcceptedChat.status, "rejected", "an accepted label and source cannot turn generic chat into a material event");
assert.ok(genericAcceptedChat.reasonCodes.includes("material_event_evidence_required"));

const conflictingAcceptedOutcome = buildMemoryFormationPlan(event({
  outcome: "blocked",
  blockers: ["A real blocker still exists."],
}));
assert.equal(conflictingAcceptedOutcome.status, "review", "accepted event labels cannot contradict blocked/revise/failure outcomes");
assert.equal(conflictingAcceptedOutcome.event.semanticConsistent, false);
assert.ok(conflictingAcceptedOutcome.reasonCodes.includes("accepted_event_semantic_conflict"));
assert.notEqual(conflictingAcceptedOutcome.eventFingerprint, accepted.eventFingerprint);
assertNoAcceptedContinuitySlots(conflictingAcceptedOutcome);

const blockedSummaryAcceptedEvent = buildMemoryFormationPlan(event({
  summary: "The implementation is blocked pending an authority receipt repair.",
  blockers: [{ summary: "Authority receipt verification is incomplete.", status: "open" }],
}));
assert.equal(blockedSummaryAcceptedEvent.status, "review");
assert.deepEqual(blockedSummaryAcceptedEvent.event.semanticConflictCodes, ["negative_semantic_signal", "open_blocker_present"]);
assertNoAcceptedContinuitySlots(blockedSummaryAcceptedEvent);

const cannotProceedAcceptedEvent = buildMemoryFormationPlan(event({
  summary: "Cannot_proceed until the source scope mismatch is corrected.",
  blockers: [{ summary: "Source scope mismatch remains current.", status: "current" }],
}));
assert.equal(cannotProceedAcceptedEvent.status, "review");
assert.ok(cannotProceedAcceptedEvent.event.semanticConflictCodes.includes("negative_semantic_signal"));
assert.ok(cannotProceedAcceptedEvent.event.semanticConflictCodes.includes("open_blocker_present"));
assertNoAcceptedContinuitySlots(cannotProceedAcceptedEvent);

const openFailureAcceptedEvent = buildMemoryFormationPlan(event({
  summary: "Focused validation produced a material event record.",
  failures: [{ code: "ASSERT-OPEN", summary: "Assertion 42 remains unresolved.", status: "open" }],
}));
assert.equal(openFailureAcceptedEvent.status, "review", "an open failure must block accepted formation even without an explicit failure outcome");
assert.deepEqual(openFailureAcceptedEvent.event.semanticConflictCodes, ["open_failure_present"]);
assertNoAcceptedContinuitySlots(openFailureAcceptedEvent);

const fixedFailureTestPass = buildMemoryFormationPlan(event({
  eventType: "test_pass",
  title: "Focused regression passed",
  summary: "The corrected policy now passes focused verification.",
  result: "All semantic consistency assertions pass.",
  failures: [{ code: "ASSERT-FIXED", summary: "The prior assertion issue is historical.", status: "fixed" }],
  fixesEpisodeIds: ["episode-prior-failure"],
}));
assert.equal(fixedFailureTestPass.status, "accepted", "explicitly fixed historical failures may accompany a verified test_pass event");
assert.equal(fixedFailureTestPass.event.openFailureCount, 0);
assert.deepEqual(fixedFailureTestPass.event.semanticConflictCodes, []);
assert.ok(fixedFailureTestPass.continuityPatchCandidate.touchedSlots.includes("accepted_progress"));
assert.ok(fixedFailureTestPass.continuityPatchCandidate.touchedSlots.includes("last_valid_checkpoint"));

const unscopedProject = buildMemoryFormationPlan(event({ projectId: null }));
assert.equal(unscopedProject.status, "rejected");
assert.ok(unscopedProject.reasonCodes.includes("explicit_project_id_required"));
const unscopedModule = buildMemoryFormationPlan(event({ moduleId: null }));
assert.equal(unscopedModule.status, "rejected");
assert.ok(unscopedModule.reasonCodes.includes("explicit_module_id_required"));
const foreignContext = buildMemoryFormationPlan(event(), { projectId: "project-foreign" });
assert.equal(foreignContext.status, "rejected");
assert.ok(foreignContext.reasonCodes.includes("foreign_project_scope"));
const foreignAuthority = buildMemoryFormationPlan(event({
  authorityOutcome: authority({ projectId: "project-foreign" }),
}));
assert.equal(foreignAuthority.status, "review");
assert.ok(foreignAuthority.event.authority.reasonCodes.includes("authority_claim_scope_mismatch"));
const foreignSource = buildMemoryFormationPlan(event({
  sourceRefs: [sourceRef("foreign", { moduleId: "module-foreign" })],
}));
assert.equal(foreignSource.status, "rejected");
assert.ok(foreignSource.reasonCodes.includes("foreign_source_module_scope"));

const foreignArtifact = buildMemoryFormationPlan(event({
  eventType: "checkpoint",
  acceptedProgress: ["A scoped checkpoint was produced."],
  artifacts: [artifactRef("foreign", { projectId: "project-foreign" })],
}));
assert.equal(foreignArtifact.status, "rejected");
assert.equal(foreignArtifact.event.artifacts.length, 0, "foreign artifacts must be omitted before episode/checkpoint construction");
assert.equal(foreignArtifact.episode, null);
assert.equal(foreignArtifact.checkpointCandidate, null);
assert.ok(foreignArtifact.reasonCodes.includes("foreign_artifact_scope"));

const unscopedArtifact = buildMemoryFormationPlan(event({
  artifacts: [artifactRef("unscoped", { projectId: null, moduleId: null })],
}));
assert.equal(unscopedArtifact.status, "review");
assert.equal(unscopedArtifact.event.artifacts.length, 0, "unscoped artifacts cannot inherit event authority");
assert.ok(unscopedArtifact.event.reasonCodes.includes("artifact_project_module_scope_required"));

for (const eventType of ["build", "install", "release"]) {
  const plan = buildMemoryFormationPlan(event({
    eventType,
    summary: `The ${eventType} result was already completed and verified.`,
    result: `${eventType} receipt recorded.`,
  }));
  assert.equal(plan.status, "accepted");
  assert.ok(Object.values(plan.effects).every((value) => value === false), `${eventType} formation must not execute host work`);
}

for (const reviewInput of [
  { eventType: "accepted", heuristic: true, category: "heuristic" },
  { eventType: "accepted", crossProject: true, scope: "cross_project" },
  { eventType: "accepted", userPreference: true, category: "user_preference" },
  { eventType: "accepted", securitySensitive: true, domain: "security" },
  { eventType: "accepted", archiveCompactRestore: true, category: "archive" },
  { eventType: "accepted", archiveCompactRestore: true, category: "compact" },
  { eventType: "accepted", archiveCompactRestore: true, category: "restore" },
]) {
  const plan = buildMemoryFormationPlan(event(reviewInput));
  assert.equal(plan.status, "review", `${JSON.stringify(reviewInput)} must remain review-only`);
}
const reviewSignalVariant = buildMemoryFormationPlan(event({ heuristic: true, category: "heuristic" }));
assert.notEqual(reviewSignalVariant.eventFingerprint, accepted.eventFingerprint, "review signals must participate in durable fingerprints");

assert.deepEqual(accepted.continuityPatchCandidate.exactSlotContract, PROJECT_CONTINUITY_SLOTS);
assert.deepEqual(
  Object.keys(accepted.continuityPatchCandidate.slots),
  accepted.continuityPatchCandidate.touchedSlots,
  "continuity slot object order must match the canonical slot order",
);
assert.ok(accepted.continuityPatchCandidate.touchedSlots.every((slot) => PROJECT_CONTINUITY_SLOTS.includes(slot)));
assert.equal(accepted.continuityPatchCandidate.touchedSlots.includes("non_negotiable_constraints"), false);
assert.deepEqual(
  accepted.continuityPatchCandidate.slotUpdates.map((update) => update.slot),
  accepted.continuityPatchCandidate.touchedSlots,
);
assert.ok(Object.values(accepted.continuityPatchCandidate.effects).every((value) => value === false));
assert.ok(Object.values(accepted.effects).every((value) => value === false));
assert.equal(JSON.stringify(accepted).length < 50000, true, "formation output must remain bounded");

const boundedPlan = buildMemoryFormationPlan(event({
  before: Array.from({ length: 100 }, (_, index) => `Before state ${index}`),
  after: Array.from({ length: 100 }, (_, index) => `After state ${index}`),
  decisions: Array.from({ length: 100 }, (_, index) => `Decision ${index}`),
  constraints: Array.from({ length: 100 }, (_, index) => `Constraint ${index}`),
  openTasks: Array.from({ length: 100 }, (_, index) => `Open task ${index}`),
  sourceRefs: Array.from({ length: 100 }, (_, index) => sourceRef(`bounded-${index}`)),
  beforeEpisodeIds: Array.from({ length: 100 }, (_, index) => `episode-before-${index}`),
  fixesEpisodeIds: Array.from({ length: 100 }, (_, index) => `episode-failure-${index}`),
}));
assert.equal(boundedPlan.status, "accepted");
assert.ok(boundedPlan.episode.before.length <= boundedPlan.bounds.maxTextItems);
assert.ok(boundedPlan.decisionCandidates.length <= boundedPlan.bounds.maxTypedCandidates);
assert.ok(boundedPlan.constraintCandidates.length <= boundedPlan.bounds.maxTypedCandidates);
assert.ok(boundedPlan.relationCandidates.length <= boundedPlan.bounds.maxRelations);
assert.ok(boundedPlan.episode.sourceRefs.length <= boundedPlan.bounds.maxSourceRefs);
assert.ok(boundedPlan.decisionCandidates.every((candidate) => candidate.sourceRefs.length <= boundedPlan.bounds.maxCandidateSourceRefs));
assert.ok(boundedPlan.relationCandidates.every((candidate) => candidate.sourceRefs.length <= boundedPlan.bounds.maxRelationSourceRefs));
assert.ok(JSON.stringify(boundedPlan).length < 300000, "maximal compact formation output should remain under a deterministic envelope bound");

console.log("Memory formation policy tests passed.");
