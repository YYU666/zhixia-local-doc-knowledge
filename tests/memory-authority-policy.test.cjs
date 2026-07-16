const assert = require("node:assert/strict");

const {
  ALL_CAPABILITIES,
  MEMORY_CAPABILITIES,
  authorizeMemoryAction,
  buildAuthorityDecision,
  buildMemorySubmissionPlan,
  createMemoryAuthorityTrustContext,
  hydrateAuthorityReceipt,
  normalizeLegacyMemoryRecord,
  normalizeMemoryEnvelope,
  normalizeOwner,
  normalizePrincipal,
  normalizeStandingRule,
  parseMemoryScope,
  planMemoryLifecycleTransition,
  planStandingRuleChange,
  queryAuthorizedMemory,
  registerAuthorityPrincipal,
  registerProjectBinding,
  resolveAuthorityPrincipal,
  resolveProjectBinding,
  standingRuleApplies,
} = require("../electron/memoryAuthorityPolicy.cjs");

const NOW = "2026-07-16T08:00:00.000Z";
const PROJECT_ID = "project-alpha";
const PROJECT_PATH = "C:\\Workspace\\ProjectAlpha";
const PROJECT_PATH_NORMALIZED = "c:/workspace/projectalpha";
const BETA_PATH = "C:\\Workspace\\ProjectBeta";
const APP_RECEIPT_KEY = "test-app-owned-authority-key-0123456789abcdef";
const SOURCE_REFS = [{ kind: "project_doc", path: "docs/TECHNICAL_DESIGN.md", hash: "source-hash" }];

const ownerInput = {
  principalType: "user",
  userId: "owner-user-1",
  displayName: "Project Owner",
  role: "owner",
  projectIds: [PROJECT_ID],
  projectPaths: [PROJECT_PATH],
  restrictedPolicyIds: ["owner-only"],
  createdAt: NOW,
};
const ceoInput = {
  principalType: "agent",
  agentFamily: "codex",
  externalId: "ceo-agent-1",
  role: "ceo",
  projectIds: [PROJECT_ID],
  projectPaths: [PROJECT_PATH],
  createdAt: NOW,
};

function createCompositionRoot(label = "test-root") {
  const trustContext = createMemoryAuthorityTrustContext({ label, receiptSigningKey: APP_RECEIPT_KEY });
  const binding = registerProjectBinding(trustContext, { projectId: PROJECT_ID, projectPath: PROJECT_PATH, validFrom: NOW }, { now: NOW });
  assert.equal(binding.ok, true);
  const owner = registerAuthorityPrincipal(trustContext, ownerInput, { now: NOW });
  const ceo = registerAuthorityPrincipal(trustContext, { ...ceoInput, ownerId: owner.principalId }, { now: NOW });
  const worker = registerAuthorityPrincipal(trustContext, {
    principalType: "agent",
    agentFamily: "codex",
    externalId: "worker-agent-1",
    role: "worker",
    ownerId: owner.principalId,
    projectIds: [PROJECT_ID],
    projectPaths: [PROJECT_PATH],
  }, { now: NOW });
  const reviewer = registerAuthorityPrincipal(trustContext, {
    principalType: "agent",
    agentFamily: "codex",
    externalId: "reviewer-agent-1",
    role: "reviewer",
    ownerId: owner.principalId,
    projectIds: [PROJECT_ID],
    projectPaths: [PROJECT_PATH],
  }, { now: NOW });
  const user = registerAuthorityPrincipal(trustContext, {
    principalType: "user",
    userId: "ordinary-user-1",
    role: "user",
    ownerId: owner.principalId,
    projectIds: [PROJECT_ID],
    projectPaths: [PROJECT_PATH],
  }, { now: NOW });
  return { trustContext, owner, ceo, worker, reviewer, user };
}

const root = createCompositionRoot();
const { trustContext, owner, ceo, worker, reviewer, user } = root;
const projectContext = { trustContext, projectId: PROJECT_ID, projectPath: PROJECT_PATH, now: NOW };

assert.equal(owner.role, "owner");
assert.equal(owner.trustedIdentity, true);
assert.deepEqual(owner.capabilities, [...ALL_CAPABILITIES].sort());
assert.equal(resolveAuthorityPrincipal(trustContext, owner.principalId), owner);
assert.equal(resolveProjectBinding(trustContext, { projectId: PROJECT_ID, projectPath: PROJECT_PATH }, { now: NOW }).projectPath, PROJECT_PATH_NORMALIZED);
assert.equal(ceo.capabilities.includes(MEMORY_CAPABILITIES.APPROVE), false);
assert.equal(worker.capabilities.includes(MEMORY_CAPABILITIES.REVIEW), false);
assert.equal(reviewer.capabilities.includes(MEMORY_CAPABILITIES.REVIEW), true);
assert.equal(user.role, "user");
assert.equal(user.capabilities.includes(MEMORY_CAPABILITIES.APPROVE), false);

const fakeTrustedOwner = normalizeOwner(ownerInput, {
  now: NOW,
  trustedIdentity: true,
  identityResolver: "caller-asserted",
  identityReceiptId: "fake",
});
assert.equal(fakeTrustedOwner.role, "untrusted", "caller options cannot mint Owner trust");
const clonedContext = JSON.parse(JSON.stringify(trustContext));
assert.equal(normalizeOwner(ownerInput, { trustContext: clonedContext, now: NOW }).role, "untrusted");
const clonedOwner = JSON.parse(JSON.stringify(owner));
assert.equal(normalizePrincipal(clonedOwner, { trustContext, now: NOW }).role, "untrusted", "JSON identity clone loses capability trust");

const projectScope = parseMemoryScope({ scope: `project:${PROJECT_ID}`, projectPath: PROJECT_PATH }, { trustContext, now: NOW });
assert.equal(projectScope.ok, true);
assert.equal(projectScope.projectPath, PROJECT_PATH_NORMALIZED);
const fakeProjectOptions = parseMemoryScope({ scope: `project:${PROJECT_ID}`, projectPath: PROJECT_PATH }, {
  trustedProjectResolver: true,
  projectBindings: [{ projectId: PROJECT_ID, projectPath: PROJECT_PATH }],
  projectResolverReceiptId: "fake",
});
assert.equal(fakeProjectOptions.ok, false);
assert.ok(fakeProjectOptions.reasonCodes.includes("project_identity_binding_required"));
const mismatchedProjectScope = parseMemoryScope({ scope: `project:${PROJECT_ID}`, projectPath: BETA_PATH }, { trustContext, now: NOW });
assert.equal(mismatchedProjectScope.ok, false);
assert.ok(mismatchedProjectScope.reasonCodes.includes("project_identity_binding_mismatch"));
assert.equal(parseMemoryScope({ scope: "global", projectPath: PROJECT_PATH }).ok, false);
assert.equal(parseMemoryScope("private:principal-1").ok, true);
assert.equal(parseMemoryScope("shared:core-team").ok, true);
assert.equal(parseMemoryScope("restricted:owner-only").ok, true);

const candidateInput = {
  memoryType: "decision",
  scope: `project:${PROJECT_ID}`,
  projectPath: PROJECT_PATH,
  ownerId: owner.principalId,
  title: "Renderer architecture",
  summary: "Keep renderer state module-oriented.",
  value: { architecture: "module-oriented" },
  status: "candidate",
  confidence: 0.8,
  observedAt: NOW,
  sourceRefs: SOURCE_REFS,
};

const forgedOwnerDecision = authorizeMemoryAction(clonedOwner, "approve", candidateInput, projectContext);
assert.equal(forgedOwnerDecision.allowed, false);
assert.ok(forgedOwnerDecision.reasonCodes.includes("trusted_identity_required"));
const forgedCapabilityDecision = authorizeMemoryAction(clonedOwner, "manage capability", candidateInput, projectContext);
assert.equal(forgedCapabilityDecision.allowed, false);
assert.ok(forgedCapabilityDecision.reasonCodes.includes("capability_escalation_forbidden"));

const untrustedCandidateSubmitter = normalizePrincipal({
  principalType: "agent",
  externalId: "ipc-caller",
  role: "owner",
  projectIds: [PROJECT_ID],
  projectPaths: [PROJECT_PATH],
}, { now: NOW });
assert.equal(untrustedCandidateSubmitter.role, "untrusted");
assert.deepEqual(untrustedCandidateSubmitter.capabilities, [MEMORY_CAPABILITIES.SUBMIT_CANDIDATE]);
assert.equal(buildMemorySubmissionPlan(untrustedCandidateSubmitter, candidateInput, projectContext).allowed, true, "least-privilege callers may submit candidates only");

const ceoSubmission = buildMemorySubmissionPlan(ceo, candidateInput, projectContext);
assert.equal(ceoSubmission.allowed, true);
assert.equal(ceoSubmission.envelope.status, "candidate");
assert.equal(buildMemorySubmissionPlan(ceo, { ...candidateInput, status: "accepted" }, projectContext).allowed, false);
assert.equal(authorizeMemoryAction(ceo, "approve", ceoSubmission.envelope, projectContext).allowed, false);
assert.equal(authorizeMemoryAction(worker, "review", ceoSubmission.envelope, projectContext).allowed, false);

const reviewPlan = planMemoryLifecycleTransition(ceoSubmission.envelope, "review", reviewer, { ...projectContext, now: "2026-07-16T08:10:00.000Z" });
assert.equal(reviewPlan.allowed, true);
const approvalPlan = planMemoryLifecycleTransition(reviewPlan.envelopeAfter, "accepted", owner, { ...projectContext, now: "2026-07-16T08:11:00.000Z" });
assert.equal(approvalPlan.allowed, true);
assert.equal(approvalPlan.envelopeAfter.status, "accepted");
assert.equal(approvalPlan.decision.action, "approve");
assert.equal(approvalPlan.decision.transition, "review->accepted");
assert.equal(typeof approvalPlan.decision.receiptProof, "string");

const acceptedJson = JSON.parse(JSON.stringify(approvalPlan.envelopeAfter));
assert.equal(normalizeMemoryEnvelope(acceptedJson, { now: NOW }).status, "review");
assert.equal(normalizeMemoryEnvelope(acceptedJson, {
  now: NOW,
  trustedAuthorityResolver: true,
  trustedAuthorityReceiptIds: [approvalPlan.decision.receiptId],
}).status, "review", "fake authority options do not restore current truth");
assert.equal(normalizeMemoryEnvelope(acceptedJson, { trustContext, principal: owner, now: "2026-07-16T08:12:00.000Z" }).status, "accepted", "registered receipt restores the exact target");

const targetReplay = normalizeMemoryEnvelope({ ...acceptedJson, memoryId: "replayed-target" }, { trustContext, principal: owner, now: "2026-07-16T08:12:00.000Z" });
assert.equal(targetReplay.status, "review");
const actionReplay = normalizeMemoryEnvelope({ ...acceptedJson, status: "curated" }, { trustContext, principal: owner, now: "2026-07-16T08:12:00.000Z" });
assert.equal(actionReplay.status, "review");
const scopeReplay = normalizeMemoryEnvelope({ ...acceptedJson, scope: "global", projectId: null, projectPath: null }, { trustContext, principal: owner, now: "2026-07-16T08:12:00.000Z" });
assert.equal(scopeReplay.status, "review");
const principalReplay = normalizeMemoryEnvelope({ ...acceptedJson, approvalTrail: [{ ...acceptedJson.approvalTrail[0], principalId: ceo.principalId }] }, { trustContext, principal: owner, now: "2026-07-16T08:12:00.000Z" });
assert.equal(principalReplay.status, "review");

const fabricatedReceipt = buildAuthorityDecision({
  allowed: true,
  principalId: owner.principalId,
  ownerId: owner.principalId,
  action: "approve",
  transition: "review->accepted",
  targetId: approvalPlan.envelopeAfter.memoryId,
  scopeKey: approvalPlan.envelopeAfter.scope.key,
  projectId: PROJECT_ID,
  projectPath: PROJECT_PATH,
  reasonCodes: ["lifecycle_transition_authorized"],
  now: approvalPlan.decision.createdAt,
});
assert.equal(fabricatedReceipt.receiptProof, null);
const fabricatedHydration = hydrateAuthorityReceipt(trustContext, fabricatedReceipt, { now: "2026-07-16T08:12:00.000Z" });
assert.equal(fabricatedHydration.ok, false);
assert.ok(fabricatedHydration.reasonCodes.includes("authority_receipt_proof_mismatch"));
assert.equal(hydrateAuthorityReceipt(clonedContext, approvalPlan.decision, { now: "2026-07-16T08:12:00.000Z" }).ok, false, "JSON context clones cannot invoke trusted hydration");

const revokedReceipt = buildAuthorityDecision({
  allowed: true,
  principalId: owner.principalId,
  ownerId: owner.principalId,
  action: "approve",
  transition: "review->accepted",
  targetId: "revoked-target",
  scopeKey: `project:${PROJECT_ID}`,
  projectId: PROJECT_ID,
  projectPath: PROJECT_PATH,
  reasonCodes: ["owner_approved"],
  now: NOW,
  revokedAt: "2026-07-16T08:01:00.000Z",
}, { trustContext });
const revokedHydration = hydrateAuthorityReceipt(trustContext, JSON.parse(JSON.stringify(revokedReceipt)), { now: "2026-07-16T08:02:00.000Z" });
assert.equal(revokedHydration.ok, false);
assert.ok(revokedHydration.reasonCodes.includes("authority_receipt_inactive"));
const supersededReceipt = buildAuthorityDecision({
  allowed: true,
  principalId: owner.principalId,
  ownerId: owner.principalId,
  action: "approve",
  transition: "review->accepted",
  targetId: "superseded-receipt-target",
  scopeKey: `project:${PROJECT_ID}`,
  projectId: PROJECT_ID,
  projectPath: PROJECT_PATH,
  reasonCodes: ["owner_approved"],
  now: NOW,
  supersededBy: "replacement-receipt",
}, { trustContext });
assert.equal(hydrateAuthorityReceipt(trustContext, supersededReceipt, { now: "2026-07-16T08:02:00.000Z" }).ok, false);

const expiringReceipt = buildAuthorityDecision({
  allowed: true,
  principalId: owner.principalId,
  ownerId: owner.principalId,
  action: "approve",
  transition: "review->accepted",
  targetId: "expired-receipt-target",
  scopeKey: `project:${PROJECT_ID}`,
  projectId: PROJECT_ID,
  projectPath: PROJECT_PATH,
  reasonCodes: ["owner_approved"],
  now: NOW,
  validTo: "2026-07-16T08:01:00.000Z",
}, { trustContext });
assert.equal(hydrateAuthorityReceipt(trustContext, expiringReceipt, { now: "2026-07-16T08:02:00.000Z" }).ok, false);

const persistedReceiptJson = JSON.stringify(approvalPlan.decision);
const restartedRoot = createCompositionRoot("restarted-root");
const restartedContext = { trustContext: restartedRoot.trustContext, projectId: PROJECT_ID, projectPath: PROJECT_PATH, now: "2026-07-16T08:12:00.000Z" };
const hydrated = hydrateAuthorityReceipt(restartedRoot.trustContext, JSON.parse(persistedReceiptJson), { now: restartedContext.now });
assert.equal(hydrated.ok, true, `trusted loader can rehydrate a genuine persisted receipt after restart: ${hydrated.reasonCodes.join(",")}`);
const restartedAccepted = normalizeMemoryEnvelope(acceptedJson, { ...restartedContext, principal: restartedRoot.owner });
assert.equal(restartedAccepted.status, "accepted");
const replayAfterRestart = normalizeMemoryEnvelope({ ...acceptedJson, memoryId: "wrong-after-restart" }, { ...restartedContext, principal: restartedRoot.owner });
assert.equal(replayAfterRestart.status, "review");
const wrongBindingRoot = createMemoryAuthorityTrustContext({ label: "wrong-binding", receiptSigningKey: APP_RECEIPT_KEY });
registerProjectBinding(wrongBindingRoot, { projectId: PROJECT_ID, projectPath: BETA_PATH, validFrom: NOW }, { now: NOW });
registerAuthorityPrincipal(wrongBindingRoot, ownerInput, { now: NOW });
const wrongBindingHydration = hydrateAuthorityReceipt(wrongBindingRoot, JSON.parse(persistedReceiptJson), { now: restartedContext.now });
assert.equal(wrongBindingHydration.ok, false);
assert.ok(wrongBindingHydration.reasonCodes.includes("authority_receipt_project_binding_mismatch"));

const ruleSubmission = planStandingRuleChange(null, {
  action: "submit",
  rule: {
    ownerId: owner.principalId,
    scope: `project:${PROJECT_ID}`,
    projectPath: PROJECT_PATH,
    statement: "Raw history remains pointer-only by default.",
    appliesTo: ["all"],
    effectiveFrom: NOW,
    sourceRefs: SOURCE_REFS,
  },
}, ceo, projectContext);
assert.equal(ruleSubmission.allowed, true);
assert.equal(planStandingRuleChange(ruleSubmission.rule, { action: "approve" }, ceo, projectContext).allowed, false);
const ruleApproval = planStandingRuleChange(ruleSubmission.rule, { action: "approve" }, owner, { ...projectContext, now: "2026-07-16T08:20:00.000Z" });
assert.equal(ruleApproval.allowed, true);
assert.equal(ruleApproval.rule.status, "accepted");
assert.equal(ruleApproval.authorityReceipt.action, "approve_rule");
assert.equal(standingRuleApplies(ruleApproval.rule, { projectId: PROJECT_ID, projectPath: PROJECT_PATH }, { trustContext, asOf: "2026-07-16T08:21:00.000Z" }), true);
const ruleJson = JSON.parse(JSON.stringify(ruleApproval.rule));
assert.equal(standingRuleApplies(ruleJson, { projectId: PROJECT_ID, projectPath: PROJECT_PATH }, { asOf: "2026-07-16T08:21:00.000Z" }), false);
assert.equal(normalizeStandingRule(ruleJson, { trustContext, now: "2026-07-16T08:21:00.000Z" }).status, "accepted");
assert.equal(normalizeStandingRule({ ...ruleJson, approvalTrail: acceptedJson.approvalTrail }, { trustContext, now: "2026-07-16T08:21:00.000Z" }).status, "review", "memory approval receipt cannot replay to a rule");
assert.equal(standingRuleApplies(ruleApproval.rule, { projectId: PROJECT_ID, projectPath: BETA_PATH }, { trustContext, asOf: "2026-07-16T08:21:00.000Z" }), false);

const legacyRecord = {
  id: acceptedJson.memoryId,
  factType: acceptedJson.memoryType,
  status: "current",
  projectId: PROJECT_ID,
  projectPath: PROJECT_PATH,
  ownerId: owner.principalId,
  principalId: acceptedJson.principalId,
  subject: "renderer",
  predicate: "architecture",
  value: "module-oriented",
  observedAt: acceptedJson.observedAt,
  sourceRefs: acceptedJson.sourceRefs,
  approvalTrail: acceptedJson.approvalTrail,
};
const legacyUntrusted = normalizeLegacyMemoryRecord(legacyRecord, { now: "2026-07-16T08:12:00.000Z" });
assert.equal(legacyUntrusted.status, "review");
assert.equal(legacyUntrusted.compatibility.authorityDowngraded, true);
assert.equal(legacyUntrusted.compatibility.storeMutated, false);
const legacyTrusted = normalizeLegacyMemoryRecord(legacyRecord, { trustContext, now: "2026-07-16T08:12:00.000Z" });
assert.equal(legacyTrusted.status, "accepted");
assert.equal(normalizeLegacyMemoryRecord({ ...legacyRecord, id: "legacy-replay" }, { trustContext, now: "2026-07-16T08:12:00.000Z" }).status, "review");

const superseded = planMemoryLifecycleTransition(approvalPlan.envelopeAfter, "superseded", owner, { ...projectContext, replacementMemoryId: "replacement-memory", now: "2026-07-16T08:30:00.000Z" });
assert.equal(superseded.allowed, true);
assert.equal(queryAuthorizedMemory([superseded.envelopeAfter], owner, { ...projectContext, view: "normal", asOf: "2026-07-16T08:31:00.000Z" }).items.length, 0);
assert.equal(queryAuthorizedMemory([superseded.envelopeAfter], owner, { ...projectContext, view: "historical", asOf: "2026-07-16T08:31:00.000Z" }).items.length, 1);
assert.equal(planMemoryLifecycleTransition(superseded.envelopeAfter, "historical", user, { ...projectContext, now: "2026-07-16T08:31:00.000Z" }).allowed, false);
assert.equal(planMemoryLifecycleTransition(superseded.envelopeAfter, "historical", owner, { ...projectContext, now: "2026-07-16T08:31:00.000Z" }).allowed, true);
assert.equal(authorizeMemoryAction(user, "approve", approvalPlan.envelopeAfter, projectContext).allowed, false);

const globalCandidate = buildMemorySubmissionPlan(owner, { ...candidateInput, scope: "global", projectId: null, projectPath: null, title: "Global preference" }, { trustContext, now: NOW });
const globalReview = planMemoryLifecycleTransition(globalCandidate.envelope, "review", owner, { trustContext, now: "2026-07-16T08:40:00.000Z" });
const globalAccepted = planMemoryLifecycleTransition(globalReview.envelopeAfter, "accepted", owner, { trustContext, now: "2026-07-16T08:41:00.000Z" });
assert.equal(globalAccepted.allowed, true);
assert.equal(authorizeMemoryAction(worker, "read", globalAccepted.envelopeAfter, { trustContext, now: NOW }).allowed, false);
assert.equal(authorizeMemoryAction(owner, "read", globalAccepted.envelopeAfter, { trustContext, now: NOW }).allowed, true);

const restrictedCandidate = buildMemorySubmissionPlan(owner, { ...candidateInput, scope: "restricted:owner-only", projectId: null, projectPath: null, title: "Restricted note" }, { trustContext, now: NOW });
const restrictedReview = planMemoryLifecycleTransition(restrictedCandidate.envelope, "review", owner, { trustContext, now: "2026-07-16T08:42:00.000Z" });
const restrictedAccepted = planMemoryLifecycleTransition(restrictedReview.envelopeAfter, "accepted", owner, { trustContext, now: "2026-07-16T08:43:00.000Z" });
assert.equal(authorizeMemoryAction(worker, "read", restrictedAccepted.envelopeAfter, { trustContext, now: NOW }).allowed, false);
assert.equal(queryAuthorizedMemory([globalAccepted.envelopeAfter, restrictedAccepted.envelopeAfter, approvalPlan.envelopeAfter], owner, { ...projectContext, view: "normal", asOf: "2026-07-16T08:44:00.000Z" }).items.length, 1);

const sameDecisionA = buildAuthorityDecision({ allowed: true, principalId: owner.principalId, ownerId: owner.principalId, action: "approve", targetId: "same-target", scopeKey: "global", reasonCodes: ["owner_approved"], now: NOW });
const sameDecisionB = buildAuthorityDecision({ allowed: true, principalId: owner.principalId, ownerId: owner.principalId, action: "approve", targetId: "same-target", scopeKey: "global", reasonCodes: ["owner_approved"], now: NOW });
assert.notEqual(sameDecisionA.receiptId, sameDecisionB.receiptId, "receipt IDs are unique without caller nonce/sequence");
assert.equal(sameDecisionA.decisionFingerprint, sameDecisionB.decisionFingerprint);
assert.equal(Object.isFrozen(sameDecisionA), true);
assert.equal(sameDecisionA.effects.archiveCompactDeleteMoveRestore, false);
assert.equal(sameDecisionA.effects.installsOrExecutes, false);
assert.equal(JSON.stringify(sameDecisionA).length < 1600, true);

const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const unsafeKeyEnvelope = normalizeMemoryEnvelope({ ...candidateInput, value: { [token]: "safe sibling" } }, { trustContext, principal: ceo, now: NOW });
assert.equal(unsafeKeyEnvelope.status, "rejected");
assert.equal(JSON.stringify(unsafeKeyEnvelope).includes(token), false);
const oversizedValue = {};
for (let index = 0; index < 300; index += 1) oversizedValue[`safe_${index}`] = "safe";
assert.equal(normalizeMemoryEnvelope({ ...candidateInput, value: oversizedValue }, { trustContext, principal: ceo, now: NOW }).status, "rejected");
assert.equal(normalizeMemoryEnvelope({ ...candidateInput, sourceRefs: [{ kind: "raw_session", path: "C:/demo/.codex/sessions/thread.jsonl" }] }, { trustContext, principal: ceo, now: NOW }).status, "rejected");
assert.equal(normalizeMemoryEnvelope({ ...candidateInput, value: `data:text/plain;base64,${"A".repeat(240)}` }, { trustContext, principal: ceo, now: NOW }).status, "rejected");
assert.equal(authorizeMemoryAction(owner, "delete session", approvalPlan.envelopeAfter, projectContext).allowed, false);

console.log("Memory Authority policy tests passed.");
