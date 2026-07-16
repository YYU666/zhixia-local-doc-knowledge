const crypto = require("node:crypto");

const MEMORY_EVALUATION_SCHEMA = "zhixia.memory_evaluation.v1";

const DEFAULT_MEMORY_EVALUATION_THRESHOLDS = Object.freeze({
  minimumCases: 1,
  recallAtK: 0.8,
  precisionAtK: 0.5,
  mrr: 0.75,
  ndcgAtK: 0.75,
  missingAnchorRate: 0.2,
  staleHitRate: 0.1,
  averageLatencyMs: 250,
  p95LatencyMs: 500,
  averageTokenEstimate: 1200,
  p95TokenEstimate: 1800,
});

const AUTHORITY_THREAT_TYPES = Object.freeze([
  "unauthorized_acceptance",
  "revoked_leakage",
  "expired_leakage",
  "superseded_leakage",
  "self_approval",
  "standing_rule_violation",
  "identity_forgery",
  "forged_accepted_envelope",
  "unapproved_standing_rule",
  "project_id_scope_masquerade",
  "project_path_scope_masquerade",
  "unsafe_payload_bypass",
  "authority_receipt_tampering",
  "authority_receipt_replay",
  "revoked_recall",
  "expired_recall",
  "superseded_recall",
  "legacy_compatibility_bypass",
]);

const AUTHORITY_POSITIVE_CONTROL_TYPES = Object.freeze([
  "trusted_owner_approve",
  "persisted_receipt_rehydration",
  "authorized_normal_recall",
  "reviewer_review_recall",
]);

const HARNESS_AUTHORITY_EXECUTIONS = new WeakMap();

const MEMORY_EVALUATION_STRATEGY_THRESHOLDS = Object.freeze({
  minimumCases: 100,
  minimumTakeoverCases: 20,
  minimumCrossWordingCases: 30,
  minimumAuthorityThreatCases: AUTHORITY_THREAT_TYPES.length,
  minimumAuthorityPositiveControlCases: AUTHORITY_POSITIVE_CONTROL_TYPES.length,
  authorityThreatCoverage: 1,
  authorityPositiveControlCoverage: 1,
  authorityEvidenceVerificationRate: 1,
  authorityOutcomeFailureRate: 0,
  authorityPositiveControlFailureRate: 0,
  recallAtK: 0.95,
  crossWordingRecallAtK: 0.9,
  mandatorySlotCoverage: 0.95,
  criticalMissingRate: 0.05,
  takeoverSuccessRate: 0.9,
  wrongProjectRate: 0,
  wrongModuleRate: 0,
  unauthorizedAcceptanceRate: 0,
  retiredMemoryLeakageRate: 0,
  selfApprovalRate: 0,
  standingRuleViolationRate: 0,
  minimumNetCompoundScore: 0,
  p95LatencyMs: 200,
  p95TokenEstimate: 1500,
});

const UNAUTHORIZED_AUTHORITY_THREATS = new Set([
  "unauthorized_acceptance",
  "identity_forgery",
  "forged_accepted_envelope",
  "unapproved_standing_rule",
  "project_id_scope_masquerade",
  "project_path_scope_masquerade",
  "unsafe_payload_bypass",
  "authority_receipt_tampering",
  "authority_receipt_replay",
  "legacy_compatibility_bypass",
]);

const LIFECYCLE_THREAT_STATUS = Object.freeze({
  revoked_leakage: "revoked",
  revoked_recall: "revoked",
  expired_leakage: "expired",
  expired_recall: "expired",
  superseded_leakage: "superseded",
  superseded_recall: "superseded",
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeText(value, fallback = "") {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text || fallback;
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of safeArray(values)) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function stableFingerprintValue(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  if (depth >= 6) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((item) => stableFingerprintValue(item, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (["execution", "proofId", "decisionId", "receiptId"].includes(key)) continue;
      result[key] = stableFingerprintValue(value[key], depth + 1);
    }
    return result;
  }
  return String(value);
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableFingerprintValue(value))).digest("hex");
}

function roundMetric(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[rank];
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return false;
}

function normalizeResult(result, index) {
  if (typeof result === "string") {
    return { id: normalizeText(result, `result-${index + 1}`), tags: [] };
  }
  const source = result && typeof result === "object" ? result : {};
  return {
    id: normalizeText(source.id || source.memoryId || source.itemId, `result-${index + 1}`),
    tags: uniqueStrings(source.tags || source.labels),
  };
}

function normalizeContinuity(benchmarkCase) {
  const source = benchmarkCase.continuity && typeof benchmarkCase.continuity === "object"
    ? benchmarkCase.continuity
    : {};
  const mandatorySlots = uniqueStrings(source.mandatorySlots || benchmarkCase.mandatorySlots);
  const filledSlots = uniqueStrings(source.filledSlots || benchmarkCase.filledSlots);
  const criticalSlots = uniqueStrings(source.criticalSlots || benchmarkCase.criticalSlots);
  const filledSlotSet = new Set(filledSlots);
  const expectedProject = normalizeText(source.expectedProject || benchmarkCase.expectedProject);
  const resolvedProject = normalizeText(source.resolvedProject || benchmarkCase.resolvedProject);
  const expectedModule = normalizeText(source.expectedModule || benchmarkCase.expectedModule);
  const resolvedModule = normalizeText(source.resolvedModule || benchmarkCase.resolvedModule);
  const takeoverCase = normalizeBoolean(source.takeoverCase ?? source.takeover ?? benchmarkCase.takeoverCase);
  const takeoverSuccessful = takeoverCase && normalizeBoolean(
    source.takeoverSuccessful ?? source.takeoverSuccess ?? benchmarkCase.takeoverSuccessful,
  );
  const projectResolutionEvaluated = Boolean(expectedProject || resolvedProject);
  const moduleResolutionEvaluated = Boolean(expectedModule || resolvedModule);
  const evaluated = mandatorySlots.length > 0
    || criticalSlots.length > 0
    || takeoverCase
    || projectResolutionEvaluated
    || moduleResolutionEvaluated;

  return {
    evaluated,
    mandatorySlots,
    filledSlots,
    criticalSlots,
    mandatorySlotCount: mandatorySlots.length,
    filledMandatorySlotCount: mandatorySlots.filter((slot) => filledSlotSet.has(slot)).length,
    criticalSlotCount: criticalSlots.length,
    missingCriticalSlotCount: criticalSlots.filter((slot) => !filledSlotSet.has(slot)).length,
    takeoverCase,
    takeoverSuccessful,
    projectResolutionEvaluated,
    moduleResolutionEvaluated,
    wrongProject: projectResolutionEvaluated && expectedProject !== resolvedProject,
    wrongModule: moduleResolutionEvaluated && expectedModule !== resolvedModule,
  };
}

function authorityCaseFingerprint(benchmarkCase) {
  const sourceCase = benchmarkCase && typeof benchmarkCase === "object" ? benchmarkCase : {};
  const authority = sourceCase.authority && typeof sourceCase.authority === "object" ? sourceCase.authority : {};
  const threatType = normalizeText(authority.threatType || sourceCase.authorityThreatType).toLowerCase();
  const expectedBlocked = typeof authority.expectedBlocked === "boolean"
    ? authority.expectedBlocked
    : typeof authority.expectedAllowed === "boolean"
      ? !authority.expectedAllowed
      : !AUTHORITY_POSITIVE_CONTROL_TYPES.includes(threatType);
  return fingerprint({
    caseId: normalizeText(sourceCase.id || sourceCase.caseId, "authority-case"),
    threatType,
    expectedBlocked,
    vector: authority.testVector && typeof authority.testVector === "object" ? authority.testVector : {},
  });
}

function createAuthorityRunContext(benchmarkCases, authorityAdapter) {
  const adapterId = normalizeText(authorityAdapter?.id || authorityAdapter?.adapterId, "authority-adapter-unidentified");
  const caseFingerprints = safeArray(benchmarkCases)
    .filter((item) => normalizeText(item?.authority?.threatType || item?.authorityThreatType))
    .map(authorityCaseFingerprint);
  const runFingerprint = fingerprint({
    schema: "zhixia.authority_benchmark_run.v1",
    adapterId,
    caseFingerprints,
  });
  return {
    adapterId,
    caseFingerprints,
    runFingerprint,
    runNonce: `authority-run-${crypto.randomUUID()}`,
    runToken: Object.freeze({ runFingerprint }),
  };
}

function normalizeAuthority(benchmarkCase, verification = {}) {
  const source = benchmarkCase.authority && typeof benchmarkCase.authority === "object"
    ? benchmarkCase.authority
    : {};
  const threatType = normalizeText(source.threatType || benchmarkCase.authorityThreatType).toLowerCase();
  const lifecycleStatus = normalizeText(
    source.lifecycleStatus || source.status || benchmarkCase.lifecycleStatus || LIFECYCLE_THREAT_STATUS[threatType],
  ).toLowerCase();
  const execution = source.execution && typeof source.execution === "object" ? source.execution : {};
  const adapterId = normalizeText(execution.adapterId);
  const proofId = normalizeText(execution.harnessProofId);
  const executed = normalizeBoolean(execution.executed);
  const executionSucceeded = normalizeBoolean(execution.executionSucceeded);
  const hasActualBlocked = typeof execution.actualBlocked === "boolean" || typeof execution.blocked === "boolean";
  const actualBlocked = hasActualBlocked
    ? normalizeBoolean(execution.actualBlocked ?? execution.blocked)
    : false;
  const expectedBlocked = typeof source.expectedBlocked === "boolean"
    ? source.expectedBlocked
    : typeof source.expectedAllowed === "boolean"
      ? !source.expectedAllowed
      : !AUTHORITY_POSITIVE_CONTROL_TYPES.includes(threatType);
  const executionObserved = executed && hasActualBlocked;
  const binding = execution && typeof execution === "object"
    ? HARNESS_AUTHORITY_EXECUTIONS.get(execution)
    : null;
  const caseFingerprint = authorityCaseFingerprint(benchmarkCase);
  const evidenceVerified = Boolean(
    binding
    && verification.runToken
    && binding.runToken === verification.runToken
    && binding.runFingerprint === verification.runFingerprint
    && binding.runNonce === verification.runNonce
    && binding.caseFingerprint === caseFingerprint
    && binding.harnessProofId === proofId,
  );
  const outcomePassed = executionObserved && executionSucceeded && actualBlocked === expectedBlocked;
  const unauthorizedAttempt = normalizeBoolean(
    source.unauthorizedAttempt ?? benchmarkCase.unauthorizedAttempt,
  ) || UNAUTHORIZED_AUTHORITY_THREATS.has(threatType);
  const selfApprovalAttempt = normalizeBoolean(
    source.selfApprovalAttempt ?? benchmarkCase.selfApprovalAttempt,
  ) || threatType === "self_approval";
  const standingRuleAttempt = normalizeBoolean(
    source.standingRuleAttempt ?? benchmarkCase.standingRuleAttempt,
  ) || threatType === "standing_rule_violation";
  const lifecycleThreat = ["revoked", "expired", "superseded"].includes(lifecycleStatus);
  const evaluated = Boolean(
    threatType
    || unauthorizedAttempt
    || selfApprovalAttempt
    || standingRuleAttempt
    || lifecycleThreat,
  );
  const selfReportedUnauthorizedAccepted = normalizeBoolean(
    source.unauthorizedAccepted ?? source.accepted ?? benchmarkCase.unauthorizedAccepted,
  );
  const selfReportedLifecycleLeaked = normalizeBoolean(
    source.lifecycleLeaked ?? source.leaked ?? benchmarkCase.lifecycleLeaked,
  );
  const selfReportedSelfApproved = normalizeBoolean(
    source.selfApproved ?? source.approved ?? benchmarkCase.selfApproved,
  );
  const selfReportedStandingRuleViolated = normalizeBoolean(
    source.standingRuleViolated ?? source.violated ?? benchmarkCase.standingRuleViolated,
  );

  return {
    evaluated,
    threatType,
    expectedBlocked,
    actualBlocked,
    executionObserved,
    executionSucceeded,
    evidenceVerified,
    outcomePassed,
    adapterId,
    proofId,
    unauthorizedAttempt,
    unauthorizedAccepted: unauthorizedAttempt && (executionObserved ? !actualBlocked : selfReportedUnauthorizedAccepted),
    lifecycleStatus,
    lifecycleThreat,
    lifecycleLeaked: lifecycleThreat && (executionObserved ? !actualBlocked : selfReportedLifecycleLeaked),
    selfApprovalAttempt,
    selfApproved: selfApprovalAttempt && (executionObserved ? !actualBlocked : selfReportedSelfApproved),
    standingRuleAttempt,
    standingRuleViolated: standingRuleAttempt && (executionObserved ? !actualBlocked : selfReportedStandingRuleViolated),
  };
}

function executeAuthorityBenchmarkCase(benchmarkCase, authorityAdapter, options = {}) {
  const sourceCase = benchmarkCase && typeof benchmarkCase === "object" ? benchmarkCase : {};
  const authority = sourceCase.authority && typeof sourceCase.authority === "object"
    ? sourceCase.authority
    : {};
  const threatType = normalizeText(authority.threatType || sourceCase.authorityThreatType).toLowerCase();
  if (!threatType || !authorityAdapter) return sourceCase;
  const executor = typeof authorityAdapter.executeAuthorityCase === "function"
    ? authorityAdapter.executeAuthorityCase.bind(authorityAdapter)
    : typeof authorityAdapter.execute === "function"
      ? authorityAdapter.execute.bind(authorityAdapter)
      : null;
  const runContext = options.runContext || createAuthorityRunContext([sourceCase], authorityAdapter);
  const adapterId = runContext.adapterId;
  const expectedBlocked = typeof authority.expectedBlocked === "boolean"
    ? authority.expectedBlocked
    : typeof authority.expectedAllowed === "boolean"
      ? !authority.expectedAllowed
      : !AUTHORITY_POSITIVE_CONTROL_TYPES.includes(threatType);
  const caseFingerprint = authorityCaseFingerprint(sourceCase);
  let result = {};
  let executionSucceeded = false;
  try {
    if (!executor) throw new TypeError("authority adapter requires executeAuthorityCase(spec)");
    result = executor({
      id: normalizeText(sourceCase.id || sourceCase.caseId, "authority-case"),
      threatType,
      expectedBlocked,
      expectedAllowed: !expectedBlocked,
      vector: authority.testVector && typeof authority.testVector === "object" ? authority.testVector : {},
    }) || {};
    if (result && typeof result.then === "function") throw new TypeError("authority adapter must execute synchronously");
    executionSucceeded = typeof result.actualBlocked === "boolean"
      || typeof result.blocked === "boolean"
      || typeof result.actualAllowed === "boolean";
  } catch (error) {
    result = {
      actualBlocked: false,
      errorCode: normalizeText(error?.code || error?.name, "authority_adapter_error"),
    };
  }
  const hasActualBlocked = typeof result.actualBlocked === "boolean"
    || typeof result.blocked === "boolean"
    || typeof result.actualAllowed === "boolean";
  const actualBlocked = typeof result.actualAllowed === "boolean"
    ? !result.actualAllowed
    : hasActualBlocked
      ? normalizeBoolean(result.actualBlocked ?? result.blocked)
      : false;
  const resultFingerprint = fingerprint({
    actualBlocked,
    executionSucceeded,
    reasonCodes: uniqueStrings(result.reasonCodes),
    errorCode: normalizeText(result.errorCode),
    decisionAllowed: typeof result.decisionAllowed === "boolean" ? result.decisionAllowed : null,
    returnedCount: Number.isFinite(Number(result.returnedCount)) ? Number(result.returnedCount) : null,
    status: normalizeText(result.status),
  });
  const harnessProofId = `authority-proof-${fingerprint({
    runNonce: runContext.runNonce,
    runFingerprint: runContext.runFingerprint,
    caseFingerprint,
    adapterId,
    resultFingerprint,
  }).slice(0, 32)}`;
  const execution = {
    executed: true,
    executionSucceeded,
    adapterId,
    harnessProofId,
    runNonce: runContext.runNonce,
    runFingerprint: runContext.runFingerprint,
    caseFingerprint,
    resultFingerprint,
    actualBlocked,
    expectedBlocked,
    decisionId: normalizeText(result.decisionId),
    receiptId: normalizeText(result.receiptId),
    reasonCodes: uniqueStrings(result.reasonCodes),
    errorCode: normalizeText(result.errorCode),
  };
  HARNESS_AUTHORITY_EXECUTIONS.set(execution, {
    runToken: runContext.runToken,
    runNonce: runContext.runNonce,
    runFingerprint: runContext.runFingerprint,
    caseFingerprint,
    resultFingerprint,
    harnessProofId,
  });
  return {
    ...sourceCase,
    authority: {
      ...authority,
      threatType,
      expectedBlocked,
      expectedAllowed: !expectedBlocked,
      execution,
    },
  };
}

function executeAuthorityBenchmarkCases(benchmarkCases, authorityAdapter, options = {}) {
  const runContext = options.runContext || createAuthorityRunContext(benchmarkCases, authorityAdapter);
  return safeArray(benchmarkCases).map((benchmarkCase) => (
    executeAuthorityBenchmarkCase(benchmarkCase, authorityAdapter, { ...options, runContext })
  ));
}

function normalizeCompoundOutcome(value) {
  const outcome = normalizeText(value).toLowerCase();
  if (["accepted", "accept", "success"].includes(outcome)) return "accepted";
  if (["revised", "revise", "revision"].includes(outcome)) return "revised";
  if (["failed", "failure", "block", "blocked"].includes(outcome)) return "failed";
  return "";
}

function normalizeCompound(benchmarkCase) {
  const source = benchmarkCase.compound && typeof benchmarkCase.compound === "object"
    ? benchmarkCase.compound
    : {};
  const outcome = normalizeCompoundOutcome(source.outcome || benchmarkCase.compoundOutcome);
  const reuseCount = finiteNonNegative(source.reuseCount ?? benchmarkCase.reuseCount);
  const estimatedTokensSaved = finiteNonNegative(
    source.estimatedTokensSaved ?? source.tokenSaved ?? benchmarkCase.estimatedTokensSaved,
  );
  const estimatedMinutesSaved = finiteNonNegative(
    source.estimatedMinutesSaved ?? source.timeSavedMinutes ?? benchmarkCase.estimatedMinutesSaved,
  );
  const staleCost = finiteNonNegative(source.staleCost ?? benchmarkCase.staleCost);
  const maintenanceCost = finiteNonNegative(source.maintenanceCost ?? benchmarkCase.maintenanceCost);
  const corrected = normalizeBoolean(source.corrected ?? source.userCorrection ?? benchmarkCase.corrected);
  const evaluated = Boolean(
    benchmarkCase.compound
    || outcome
    || reuseCount
    || estimatedTokensSaved
    || estimatedMinutesSaved
    || staleCost
    || maintenanceCost
    || corrected,
  );

  return {
    evaluated,
    outcome,
    reuseCount,
    estimatedTokensSaved,
    estimatedMinutesSaved,
    staleCost,
    maintenanceCost,
    corrected,
  };
}

function normalizeBenchmarkCase(benchmarkCase = {}, index = 0, options = {}) {
  const expected = benchmarkCase.expected && typeof benchmarkCase.expected === "object"
    ? benchmarkCase.expected
    : {};
  return {
    id: normalizeText(benchmarkCase.id || benchmarkCase.caseId, `case-${index + 1}`),
    query: normalizeText(benchmarkCase.query),
    project: normalizeText(benchmarkCase.project || benchmarkCase.projectId, "unscoped"),
    queryType: normalizeText(benchmarkCase.queryType || benchmarkCase.type, "unclassified"),
    scenario: normalizeText(benchmarkCase.scenario, "retrieval"),
    crossWording: normalizeBoolean(benchmarkCase.crossWording)
      || normalizeText(benchmarkCase.queryType).toLowerCase() === "cross_wording",
    expectedIds: uniqueStrings(benchmarkCase.expectedIds || benchmarkCase.expected_ids || expected.ids),
    expectedTags: uniqueStrings(benchmarkCase.expectedTags || benchmarkCase.expected_tags || expected.tags),
    staleIds: uniqueStrings(benchmarkCase.staleIds || benchmarkCase.stale_ids),
    results: safeArray(benchmarkCase.results).map(normalizeResult),
    latencyMs: finiteNonNegative(benchmarkCase.latencyMs),
    tokenEstimate: finiteNonNegative(benchmarkCase.tokenEstimate),
    continuity: normalizeContinuity(benchmarkCase),
    authority: normalizeAuthority(benchmarkCase, options.authorityVerification),
    compound: normalizeCompound(benchmarkCase),
  };
}

function resultAnchorKeys(result, expectedIdSet, expectedTagSet) {
  const keys = [];
  if (expectedIdSet.has(result.id)) keys.push(`id:${result.id}`);
  for (const tag of result.tags) {
    if (expectedTagSet.has(tag)) keys.push(`tag:${tag}`);
  }
  return keys;
}

function evaluateMemoryBenchmarkCase(benchmarkCase, options = {}) {
  const runContext = options.authorityRunContext
    || (options.authorityAdapter ? createAuthorityRunContext([benchmarkCase], options.authorityAdapter) : null);
  const executedCase = options.authorityAdapter
    ? executeAuthorityBenchmarkCase(benchmarkCase, options.authorityAdapter, { runContext })
    : benchmarkCase;
  const normalized = normalizeBenchmarkCase(
    executedCase,
    Math.max(0, Math.floor(Number(options.index) || 0)),
    { authorityVerification: runContext },
  );
  const k = Math.max(1, Math.floor(Number(options.k) || 5));
  const topResults = normalized.results.slice(0, k);
  const expectedIdSet = new Set(normalized.expectedIds);
  const expectedTagSet = new Set(normalized.expectedTags);
  const expectedAnchorKeys = [
    ...normalized.expectedIds.map((id) => `id:${id}`),
    ...normalized.expectedTags.map((tag) => `tag:${tag}`),
  ];
  const matchedAnchorKeys = new Set();
  const relevance = [];
  const seenRelevantIds = new Set();

  for (const result of topResults) {
    const anchorKeys = resultAnchorKeys(result, expectedIdSet, expectedTagSet);
    for (const anchorKey of anchorKeys) matchedAnchorKeys.add(anchorKey);
    const isRelevant = anchorKeys.length > 0 && !seenRelevantIds.has(result.id);
    relevance.push(isRelevant ? 1 : 0);
    if (isRelevant) seenRelevantIds.add(result.id);
  }

  const relevantHitCount = relevance.reduce((sum, value) => sum + value, 0);
  const expectedAnchorCount = expectedAnchorKeys.length;
  const matchedAnchorCount = matchedAnchorKeys.size;
  const missingAnchorCount = Math.max(0, expectedAnchorCount - matchedAnchorCount);
  const firstRelevantIndex = relevance.findIndex(Boolean);
  const staleIdSet = new Set(normalized.staleIds);
  const staleHitCount = topResults.filter((result) => staleIdSet.has(result.id)).length;
  const dcg = relevance.reduce((sum, value, index) => (
    sum + (value ? 1 / Math.log2(index + 2) : 0)
  ), 0);
  const idealRelevantCount = Math.min(
    k,
    normalized.expectedIds.length > 0
      ? normalized.expectedIds.length
      : normalized.expectedTags.length,
  );
  let idealDcg = 0;
  for (let index = 0; index < idealRelevantCount; index += 1) {
    idealDcg += 1 / Math.log2(index + 2);
  }

  const continuity = normalized.continuity;
  const authority = normalized.authority;
  const compound = normalized.compound;
  const wrongProjectOrModule = continuity.wrongProject || continuity.wrongModule;

  return {
    id: normalized.id,
    query: normalized.query,
    project: normalized.project,
    queryType: normalized.queryType,
    scenario: normalized.scenario,
    crossWording: normalized.crossWording,
    k,
    expectedAnchorCount,
    matchedAnchorCount,
    missingAnchorCount,
    relevantHitCount,
    staleHitCount,
    returnedAtK: topResults.length,
    recallAtK: roundMetric(expectedAnchorCount > 0 ? matchedAnchorCount / expectedAnchorCount : 0),
    precisionAtK: roundMetric(relevantHitCount / k),
    mrr: roundMetric(firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0),
    ndcgAtK: roundMetric(idealDcg > 0 ? Math.min(1, dcg / idealDcg) : 0),
    missingAnchorRate: roundMetric(expectedAnchorCount > 0 ? missingAnchorCount / expectedAnchorCount : 0),
    staleHitRate: roundMetric(topResults.length > 0 ? staleHitCount / topResults.length : 0),
    latencyMs: normalized.latencyMs,
    tokenEstimate: normalized.tokenEstimate,
    continuityEvaluated: continuity.evaluated,
    mandatorySlotCount: continuity.mandatorySlotCount,
    filledMandatorySlotCount: continuity.filledMandatorySlotCount,
    criticalSlotCount: continuity.criticalSlotCount,
    missingCriticalSlotCount: continuity.missingCriticalSlotCount,
    takeoverCase: continuity.takeoverCase,
    takeoverSuccessful: continuity.takeoverSuccessful,
    projectResolutionEvaluated: continuity.projectResolutionEvaluated,
    moduleResolutionEvaluated: continuity.moduleResolutionEvaluated,
    wrongProject: continuity.wrongProject,
    wrongModule: continuity.wrongModule,
    wrongProjectOrModule,
    authorityEvaluated: authority.evaluated,
    authorityThreatType: authority.threatType,
    authorityExpectedBlocked: authority.expectedBlocked,
    authorityActualBlocked: authority.actualBlocked,
    authorityExecutionObserved: authority.executionObserved,
    authorityExecutionSucceeded: authority.executionSucceeded,
    authorityEvidenceVerified: authority.evidenceVerified,
    authorityOutcomePassed: authority.outcomePassed,
    authorityAdapterId: authority.adapterId,
    authorityProofId: authority.proofId,
    unauthorizedAttempt: authority.unauthorizedAttempt,
    unauthorizedAccepted: authority.unauthorizedAccepted,
    lifecycleStatus: authority.lifecycleStatus,
    lifecycleThreat: authority.lifecycleThreat,
    lifecycleLeaked: authority.lifecycleLeaked,
    selfApprovalAttempt: authority.selfApprovalAttempt,
    selfApproved: authority.selfApproved,
    standingRuleAttempt: authority.standingRuleAttempt,
    standingRuleViolated: authority.standingRuleViolated,
    compoundEvaluated: compound.evaluated,
    compoundOutcome: compound.outcome,
    reuseCount: compound.reuseCount,
    estimatedTokensSaved: compound.estimatedTokensSaved,
    estimatedMinutesSaved: compound.estimatedMinutesSaved,
    staleCost: compound.staleCost,
    maintenanceCost: compound.maintenanceCost,
    corrected: compound.corrected,
  };
}

function aggregateRetrievalMetrics(caseMetrics, k) {
  const latencyValues = caseMetrics.map((item) => item.latencyMs);
  const tokenValues = caseMetrics.map((item) => item.tokenEstimate);
  const crossWordingCases = caseMetrics.filter((item) => item.crossWording);
  return {
    caseCount: caseMetrics.length,
    k,
    recallAtK: roundMetric(average(caseMetrics.map((item) => item.recallAtK))),
    precisionAtK: roundMetric(average(caseMetrics.map((item) => item.precisionAtK))),
    mrr: roundMetric(average(caseMetrics.map((item) => item.mrr))),
    ndcgAtK: roundMetric(average(caseMetrics.map((item) => item.ndcgAtK))),
    missingAnchorRate: roundMetric(average(caseMetrics.map((item) => item.missingAnchorRate))),
    staleHitRate: roundMetric(average(caseMetrics.map((item) => item.staleHitRate))),
    averageLatencyMs: roundMetric(average(latencyValues)),
    p95LatencyMs: roundMetric(percentile(latencyValues, 0.95)),
    averageTokenEstimate: roundMetric(average(tokenValues)),
    p95TokenEstimate: roundMetric(percentile(tokenValues, 0.95)),
    crossWordingCaseCount: crossWordingCases.length,
    crossWordingRecallAtK: roundMetric(average(crossWordingCases.map((item) => item.recallAtK))),
  };
}

function aggregateContinuityMetrics(caseMetrics) {
  const cases = caseMetrics.filter((item) => item.continuityEvaluated);
  const mandatorySlotCount = cases.reduce((sum, item) => sum + item.mandatorySlotCount, 0);
  const filledMandatorySlotCount = cases.reduce((sum, item) => sum + item.filledMandatorySlotCount, 0);
  const criticalSlotCount = cases.reduce((sum, item) => sum + item.criticalSlotCount, 0);
  const missingCriticalSlotCount = cases.reduce((sum, item) => sum + item.missingCriticalSlotCount, 0);
  const takeoverCases = cases.filter((item) => item.takeoverCase);
  const projectCases = cases.filter((item) => item.projectResolutionEvaluated);
  const moduleCases = cases.filter((item) => item.moduleResolutionEvaluated);
  const scopeCases = cases.filter((item) => item.projectResolutionEvaluated || item.moduleResolutionEvaluated);
  const metrics = {
    continuityCaseCount: cases.length,
    mandatorySlotCount,
    filledMandatorySlotCount,
    mandatorySlotCoverage: roundMetric(ratio(filledMandatorySlotCount, mandatorySlotCount)),
    criticalSlotCount,
    missingCriticalSlotCount,
    criticalMissingRate: roundMetric(ratio(missingCriticalSlotCount, criticalSlotCount)),
    takeoverCaseCount: takeoverCases.length,
    takeoverSuccessCount: takeoverCases.filter((item) => item.takeoverSuccessful).length,
    projectResolutionCaseCount: projectCases.length,
    wrongProjectCount: projectCases.filter((item) => item.wrongProject).length,
    moduleResolutionCaseCount: moduleCases.length,
    wrongModuleCount: moduleCases.filter((item) => item.wrongModule).length,
    scopeResolutionCaseCount: scopeCases.length,
    wrongProjectOrModuleCount: scopeCases.filter((item) => item.wrongProjectOrModule).length,
  };
  return {
    ...metrics,
    takeoverSuccessRate: roundMetric(ratio(metrics.takeoverSuccessCount, metrics.takeoverCaseCount)),
    wrongProjectRate: roundMetric(ratio(metrics.wrongProjectCount, metrics.projectResolutionCaseCount)),
    wrongModuleRate: roundMetric(ratio(metrics.wrongModuleCount, metrics.moduleResolutionCaseCount)),
    wrongProjectOrModuleRate: roundMetric(ratio(
      metrics.wrongProjectOrModuleCount,
      metrics.scopeResolutionCaseCount,
    )),
  };
}

function aggregateAuthorityMetrics(caseMetrics) {
  const cases = caseMetrics.filter((item) => item.authorityEvaluated);
  const observedCases = cases.filter((item) => item.authorityExecutionObserved);
  const verifiedCases = cases.filter((item) => item.authorityEvidenceVerified);
  const threatCases = cases.filter((item) => AUTHORITY_THREAT_TYPES.includes(item.authorityThreatType));
  const positiveControlCases = cases.filter((item) => AUTHORITY_POSITIVE_CONTROL_TYPES.includes(item.authorityThreatType));
  const verifiedThreatCases = verifiedCases.filter((item) => AUTHORITY_THREAT_TYPES.includes(item.authorityThreatType));
  const verifiedPositiveControlCases = verifiedCases.filter((item) => AUTHORITY_POSITIVE_CONTROL_TYPES.includes(item.authorityThreatType));
  const unauthorizedCases = observedCases.filter((item) => item.unauthorizedAttempt);
  const lifecycleCases = observedCases.filter((item) => item.lifecycleThreat);
  const revokedCases = lifecycleCases.filter((item) => item.lifecycleStatus === "revoked");
  const expiredCases = lifecycleCases.filter((item) => item.lifecycleStatus === "expired");
  const supersededCases = lifecycleCases.filter((item) => item.lifecycleStatus === "superseded");
  const selfApprovalCases = observedCases.filter((item) => item.selfApprovalAttempt);
  const standingRuleCases = observedCases.filter((item) => item.standingRuleAttempt);
  const coveredThreats = new Set(
    verifiedThreatCases.map((item) => item.authorityThreatType),
  );
  const coveredPositiveControls = new Set(
    verifiedPositiveControlCases.map((item) => item.authorityThreatType),
  );
  const metrics = {
    authorityCaseCount: cases.length,
    authorityThreatCaseCount: threatCases.length,
    authorityPositiveControlCaseCount: positiveControlCases.length,
    callerExecutedAuthorityCaseCount: observedCases.length,
    verifiedAuthorityCaseCount: verifiedCases.length,
    verifiedAuthorityThreatCaseCount: verifiedThreatCases.length,
    verifiedAuthorityPositiveControlCaseCount: verifiedPositiveControlCases.length,
    unverifiedAuthorityCaseCount: cases.length - verifiedCases.length,
    unverifiedAuthorityThreatCaseCount: threatCases.length - verifiedThreatCases.length,
    authorityOutcomeFailureCount: verifiedCases.filter((item) => !item.authorityOutcomePassed).length,
    authorityPositiveControlFailureCount: verifiedPositiveControlCases.filter((item) => !item.authorityOutcomePassed).length,
    authorityThreatTypeCount: coveredThreats.size,
    authorityPositiveControlTypeCount: coveredPositiveControls.size,
    unauthorizedAttemptCount: unauthorizedCases.length,
    unauthorizedAcceptedCount: unauthorizedCases.filter((item) => item.unauthorizedAccepted).length,
    retiredMemoryThreatCount: lifecycleCases.length,
    retiredMemoryLeakCount: lifecycleCases.filter((item) => item.lifecycleLeaked).length,
    revokedThreatCount: revokedCases.length,
    revokedLeakCount: revokedCases.filter((item) => item.lifecycleLeaked).length,
    expiredThreatCount: expiredCases.length,
    expiredLeakCount: expiredCases.filter((item) => item.lifecycleLeaked).length,
    supersededThreatCount: supersededCases.length,
    supersededLeakCount: supersededCases.filter((item) => item.lifecycleLeaked).length,
    selfApprovalAttemptCount: selfApprovalCases.length,
    selfApprovalCount: selfApprovalCases.filter((item) => item.selfApproved).length,
    standingRuleAttemptCount: standingRuleCases.length,
    standingRuleViolationCount: standingRuleCases.filter((item) => item.standingRuleViolated).length,
  };
  return {
    ...metrics,
    authorityThreatCoverage: roundMetric(ratio(coveredThreats.size, AUTHORITY_THREAT_TYPES.length)),
    authorityPositiveControlCoverage: roundMetric(ratio(
      coveredPositiveControls.size,
      AUTHORITY_POSITIVE_CONTROL_TYPES.length,
    )),
    authorityEvidenceVerificationRate: roundMetric(ratio(
      metrics.verifiedAuthorityCaseCount,
      metrics.authorityCaseCount,
    )),
    authorityOutcomeFailureRate: roundMetric(ratio(
      metrics.authorityOutcomeFailureCount,
      metrics.verifiedAuthorityCaseCount,
    )),
    authorityPositiveControlFailureRate: roundMetric(ratio(
      metrics.authorityPositiveControlFailureCount,
      metrics.verifiedAuthorityPositiveControlCaseCount,
    )),
    unauthorizedAcceptanceRate: roundMetric(ratio(
      metrics.unauthorizedAcceptedCount,
      metrics.unauthorizedAttemptCount,
    )),
    retiredMemoryLeakageRate: roundMetric(ratio(
      metrics.retiredMemoryLeakCount,
      metrics.retiredMemoryThreatCount,
    )),
    revokedLeakageRate: roundMetric(ratio(metrics.revokedLeakCount, metrics.revokedThreatCount)),
    expiredLeakageRate: roundMetric(ratio(metrics.expiredLeakCount, metrics.expiredThreatCount)),
    supersededLeakageRate: roundMetric(ratio(
      metrics.supersededLeakCount,
      metrics.supersededThreatCount,
    )),
    selfApprovalRate: roundMetric(ratio(metrics.selfApprovalCount, metrics.selfApprovalAttemptCount)),
    standingRuleViolationRate: roundMetric(ratio(
      metrics.standingRuleViolationCount,
      metrics.standingRuleAttemptCount,
    )),
  };
}

function aggregateCompoundMetrics(caseMetrics) {
  const cases = caseMetrics.filter((item) => item.compoundEvaluated);
  const acceptedCount = cases.filter((item) => item.compoundOutcome === "accepted").length;
  const revisedCount = cases.filter((item) => item.compoundOutcome === "revised").length;
  const failureCount = cases.filter((item) => item.compoundOutcome === "failed").length;
  const outcomeCount = acceptedCount + revisedCount + failureCount;
  const correctionCount = cases.filter((item) => item.corrected).length;
  const reuseCount = cases.reduce((sum, item) => sum + item.reuseCount, 0);
  const estimatedTokensSaved = cases.reduce((sum, item) => sum + item.estimatedTokensSaved, 0);
  const estimatedMinutesSaved = cases.reduce((sum, item) => sum + item.estimatedMinutesSaved, 0);
  const staleCost = cases.reduce((sum, item) => sum + item.staleCost, 0);
  const maintenanceCost = cases.reduce((sum, item) => sum + item.maintenanceCost, 0);
  const acceptRate = ratio(acceptedCount, outcomeCount);
  const reviseRate = ratio(revisedCount, outcomeCount);
  const failureRate = ratio(failureCount, outcomeCount);
  const correctionRate = ratio(correctionCount, cases.length);
  const grossCompoundValue = reuseCount + (estimatedTokensSaved / 1000) + (estimatedMinutesSaved / 10);
  const compoundQualitySignal = acceptRate + (0.5 * reviseRate) - failureRate - correctionRate;
  const totalCompoundCost = staleCost + maintenanceCost;
  const netCompoundScore = clamp(
    ratio((grossCompoundValue * compoundQualitySignal) - totalCompoundCost, grossCompoundValue + totalCompoundCost),
    -1,
    1,
  );

  return {
    compoundCaseCount: cases.length,
    compoundOutcomeCount: outcomeCount,
    reuseCount: roundMetric(reuseCount),
    acceptedCount,
    revisedCount,
    failureCount,
    correctionCount,
    acceptRate: roundMetric(acceptRate),
    reviseRate: roundMetric(reviseRate),
    failureRate: roundMetric(failureRate),
    correctionRate: roundMetric(correctionRate),
    estimatedTokensSaved: roundMetric(estimatedTokensSaved),
    estimatedMinutesSaved: roundMetric(estimatedMinutesSaved),
    staleCost: roundMetric(staleCost),
    maintenanceCost: roundMetric(maintenanceCost),
    totalCompoundCost: roundMetric(totalCompoundCost),
    grossCompoundValue: roundMetric(grossCompoundValue),
    compoundQualitySignal: roundMetric(compoundQualitySignal),
    netCompoundScore: roundMetric(netCompoundScore),
  };
}

function aggregateCaseMetrics(caseMetrics, k) {
  const retrieval = aggregateRetrievalMetrics(caseMetrics, k);
  const continuity = aggregateContinuityMetrics(caseMetrics);
  const authority = aggregateAuthorityMetrics(caseMetrics);
  const compound = aggregateCompoundMetrics(caseMetrics);
  return {
    ...retrieval,
    ...continuity,
    ...authority,
    ...compound,
    continuity,
    authority,
    compound,
  };
}

function normalizeThresholds(thresholds = {}) {
  const merged = { ...DEFAULT_MEMORY_EVALUATION_THRESHOLDS, ...(thresholds || {}) };
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_MEMORY_EVALUATION_THRESHOLDS)) {
    const value = Number(merged[key]);
    normalized[key] = Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  return normalized;
}

function normalizeStrategyThresholds(thresholds = {}) {
  const merged = { ...MEMORY_EVALUATION_STRATEGY_THRESHOLDS, ...(thresholds || {}) };
  const normalized = {};
  for (const [key, fallback] of Object.entries(MEMORY_EVALUATION_STRATEGY_THRESHOLDS)) {
    const value = Number(merged[key]);
    normalized[key] = Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  return normalized;
}

function evaluateRules(metrics, thresholds, rules) {
  const checks = rules.map(([thresholdKey, metricKey, comparator]) => {
    const actual = Number(metrics[metricKey]) || 0;
    const threshold = thresholds[thresholdKey];
    const passed = comparator === ">=" ? actual >= threshold : actual <= threshold;
    return { metric: metricKey, comparator, threshold, actual, passed };
  });
  return {
    passed: checks.every((check) => check.passed),
    checks,
    failedThresholds: checks.filter((check) => !check.passed).map((check) => check.metric),
  };
}

function evaluateThresholds(metrics, thresholds = {}) {
  const normalized = normalizeThresholds(thresholds);
  return evaluateRules(metrics, normalized, [
    ["minimumCases", "caseCount", ">="],
    ["recallAtK", "recallAtK", ">="],
    ["precisionAtK", "precisionAtK", ">="],
    ["mrr", "mrr", ">="],
    ["ndcgAtK", "ndcgAtK", ">="],
    ["missingAnchorRate", "missingAnchorRate", "<="],
    ["staleHitRate", "staleHitRate", "<="],
    ["averageLatencyMs", "averageLatencyMs", "<="],
    ["p95LatencyMs", "p95LatencyMs", "<="],
    ["averageTokenEstimate", "averageTokenEstimate", "<="],
    ["p95TokenEstimate", "p95TokenEstimate", "<="],
  ]);
}

function evaluateStrategyThresholds(metrics, thresholds = {}) {
  const normalized = normalizeStrategyThresholds(thresholds);
  return evaluateRules(metrics, normalized, [
    ["minimumCases", "caseCount", ">="],
    ["minimumTakeoverCases", "takeoverCaseCount", ">="],
    ["minimumCrossWordingCases", "crossWordingCaseCount", ">="],
    ["minimumAuthorityThreatCases", "verifiedAuthorityThreatCaseCount", ">="],
    ["minimumAuthorityPositiveControlCases", "verifiedAuthorityPositiveControlCaseCount", ">="],
    ["authorityThreatCoverage", "authorityThreatCoverage", ">="],
    ["authorityPositiveControlCoverage", "authorityPositiveControlCoverage", ">="],
    ["authorityEvidenceVerificationRate", "authorityEvidenceVerificationRate", ">="],
    ["authorityOutcomeFailureRate", "authorityOutcomeFailureRate", "<="],
    ["authorityPositiveControlFailureRate", "authorityPositiveControlFailureRate", "<="],
    ["recallAtK", "recallAtK", ">="],
    ["crossWordingRecallAtK", "crossWordingRecallAtK", ">="],
    ["mandatorySlotCoverage", "mandatorySlotCoverage", ">="],
    ["criticalMissingRate", "criticalMissingRate", "<="],
    ["takeoverSuccessRate", "takeoverSuccessRate", ">="],
    ["wrongProjectRate", "wrongProjectRate", "<="],
    ["wrongModuleRate", "wrongModuleRate", "<="],
    ["unauthorizedAcceptanceRate", "unauthorizedAcceptanceRate", "<="],
    ["retiredMemoryLeakageRate", "retiredMemoryLeakageRate", "<="],
    ["selfApprovalRate", "selfApprovalRate", "<="],
    ["standingRuleViolationRate", "standingRuleViolationRate", "<="],
    ["minimumNetCompoundScore", "netCompoundScore", ">="],
    ["p95LatencyMs", "p95LatencyMs", "<="],
    ["p95TokenEstimate", "p95TokenEstimate", "<="],
  ]);
}

function buildGroupedMetrics(caseMetrics, groupKey, k, thresholds, strategyThresholds) {
  const groups = new Map();
  for (const item of caseMetrics) {
    const key = item[groupKey];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const result = {};
  for (const key of [...groups.keys()].sort()) {
    const metrics = aggregateCaseMetrics(groups.get(key), k);
    result[key] = {
      ...metrics,
      gate: evaluateThresholds(metrics, thresholds),
      strategyGate: evaluateStrategyThresholds(metrics, strategyThresholds),
    };
  }
  return result;
}

function formatMetric(value) {
  return Number(value || 0).toFixed(3);
}

function buildCompactMemoryEvaluationReport(evaluation) {
  const metrics = evaluation.metrics;
  const failed = evaluation.gate.failedThresholds.length > 0
    ? evaluation.gate.failedThresholds.join(",")
    : "none";
  const strategyFailed = evaluation.strategyGate.failedThresholds.length > 0
    ? evaluation.strategyGate.failedThresholds.join(",")
    : "none";
  return [
    evaluation.gate.passed ? "PASS" : "FAIL",
    `memory-eval k=${metrics.k} cases=${metrics.caseCount}`,
    `recall=${formatMetric(metrics.recallAtK)}`,
    `precision=${formatMetric(metrics.precisionAtK)}`,
    `mrr=${formatMetric(metrics.mrr)}`,
    `ndcg=${formatMetric(metrics.ndcgAtK)}`,
    `missing=${formatMetric(metrics.missingAnchorRate)}`,
    `stale=${formatMetric(metrics.staleHitRate)}`,
    `continuity=${formatMetric(metrics.mandatorySlotCoverage)}/${formatMetric(metrics.takeoverSuccessRate)}`,
    `authority=${formatMetric(metrics.authorityEvidenceVerificationRate)}/${formatMetric(metrics.authorityOutcomeFailureRate)}`,
    `compound=${formatMetric(metrics.netCompoundScore)}`,
    `latency=${formatMetric(metrics.averageLatencyMs)}/${formatMetric(metrics.p95LatencyMs)}ms`,
    `token=${formatMetric(metrics.averageTokenEstimate)}/${formatMetric(metrics.p95TokenEstimate)}`,
    `strategy=${evaluation.strategyGate.passed ? "PASS" : "FAIL"}`,
    `failed=${failed}`,
    `strategyFailed=${strategyFailed}`,
  ].join(" | ");
}

function evaluateMemoryBenchmark(benchmarkCases, options = {}) {
  const k = Math.max(1, Math.floor(Number(options.k) || 5));
  const thresholds = normalizeThresholds(options.thresholds);
  const strategyThresholds = normalizeStrategyThresholds(options.strategyThresholds);
  const authorityRunContext = options.authorityAdapter
    ? createAuthorityRunContext(benchmarkCases, options.authorityAdapter)
    : null;
  const cases = safeArray(benchmarkCases).map((benchmarkCase, index) => (
    evaluateMemoryBenchmarkCase(benchmarkCase, {
      k,
      index,
      authorityAdapter: options.authorityAdapter,
      authorityRunContext,
    })
  ));
  const metrics = aggregateCaseMetrics(cases, k);
  const evaluation = {
    schemaVersion: MEMORY_EVALUATION_SCHEMA,
    metrics,
    thresholds,
    strategyThresholds,
    gate: evaluateThresholds(metrics, thresholds),
    strategyGate: evaluateStrategyThresholds(metrics, strategyThresholds),
    groups: {
      byProject: buildGroupedMetrics(cases, "project", k, thresholds, strategyThresholds),
      byQueryType: buildGroupedMetrics(cases, "queryType", k, thresholds, strategyThresholds),
      byScenario: buildGroupedMetrics(cases, "scenario", k, thresholds, strategyThresholds),
    },
    cases,
  };
  return {
    ...evaluation,
    compactReport: buildCompactMemoryEvaluationReport(evaluation),
  };
}

function seededRandom(seed) {
  let state = Math.floor(Number(seed) || 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildSyntheticProjectFixture(options = {}) {
  const count = Math.max(1, Math.min(500, Math.floor(Number(options.count) || 8)));
  const random = seededRandom(options.seed);
  const projects = ["synthetic-project-alpha", "synthetic-project-beta"];
  const queryTypes = ["project_resume", "architecture", "bug_repair", "review_gate"];
  const topics = ["decision", "constraint", "checkpoint", "precedent"];
  const cases = [];

  for (let index = 0; index < count; index += 1) {
    const project = projects[index % projects.length];
    const queryType = queryTypes[index % queryTypes.length];
    const topic = topics[index % topics.length];
    const anchorId = `synthetic-memory-${index + 1}-anchor`;
    const supportingId = `synthetic-memory-${index + 1}-support`;
    const staleId = `synthetic-memory-${index + 1}-stale`;
    const tag = `synthetic-tag-${topic}`;
    const swap = random() >= 0.5;
    const relevantResults = [
      { id: anchorId, tags: [tag, "synthetic-project"] },
      { id: supportingId, tags: ["synthetic-support"] },
    ];
    if (swap) relevantResults.reverse();
    cases.push({
      id: `synthetic-project-case-${index + 1}`,
      project,
      queryType,
      scenario: "retrieval",
      query: `Retrieve the synthetic ${topic} for evaluation case ${index + 1}.`,
      expectedIds: [anchorId],
      expectedTags: [tag],
      staleIds: [staleId],
      results: [
        ...relevantResults,
        { id: staleId, tags: ["synthetic-stale"] },
        { id: `synthetic-memory-${index + 1}-distractor`, tags: ["synthetic-distractor"] },
      ],
      latencyMs: 40 + Math.floor(random() * 80),
      tokenEstimate: 180 + Math.floor(random() * 220),
    });
  }

  return cases;
}

function buildSyntheticContinuityFixture(options = {}) {
  const count = Math.max(40, Math.min(500, Math.floor(Number(options.count) || 40)));
  const takeoverCount = Math.max(20, Math.min(count, Math.floor(Number(options.takeoverCount) || 20)));
  const crossWordingCount = Math.max(30, Math.min(count, Math.floor(Number(options.crossWordingCount) || 30)));
  const random = seededRandom(options.seed);
  const mandatorySlots = [
    "project_identity",
    "original_product_goal",
    "architecture_anchors",
    "standing_rules",
    "active_modules",
    "current_phase",
    "open_tasks",
    "next_actions",
  ];
  const criticalSlots = ["project_identity", "original_product_goal", "architecture_anchors", "standing_rules"];
  const cases = [];

  for (let index = 0; index < count; index += 1) {
    const caseNumber = index + 1;
    const project = index % 2 === 0 ? "synthetic-project-alpha" : "synthetic-project-beta";
    const moduleName = `synthetic-module-${(index % 5) + 1}`;
    const anchorId = `synthetic-continuity-${caseNumber}-anchor`;
    const crossWording = index < crossWordingCount;
    cases.push({
      id: `synthetic-continuity-case-${caseNumber}`,
      project,
      queryType: crossWording ? "cross_wording" : "project_resume",
      scenario: "continuity",
      crossWording,
      query: crossWording
        ? `Continue the synthetic work from an equivalent phrasing sample ${caseNumber}.`
        : `Resume the synthetic project checkpoint ${caseNumber}.`,
      expectedIds: [anchorId],
      expectedTags: ["synthetic-current"],
      staleIds: [`synthetic-continuity-${caseNumber}-retired`],
      results: [
        { id: anchorId, tags: ["synthetic-current"] },
        { id: `synthetic-continuity-${caseNumber}-support`, tags: ["synthetic-support"] },
      ],
      latencyMs: 60 + Math.floor(random() * 80),
      tokenEstimate: 320 + Math.floor(random() * 480),
      continuity: {
        mandatorySlots,
        filledSlots: mandatorySlots,
        criticalSlots,
        takeoverCase: index < takeoverCount,
        takeoverSuccessful: index < takeoverCount,
        expectedProject: project,
        resolvedProject: project,
        expectedModule: moduleName,
        resolvedModule: moduleName,
      },
    });
  }

  return cases;
}

function buildSyntheticAuthorityTestVector(threatType, variant) {
  const projectAlpha = "synthetic-project-alpha";
  const projectBeta = "synthetic-project-beta";
  const projectPathAlpha = "synthetic/projects/alpha";
  const projectPathBeta = "synthetic/projects/beta";
  const common = {
    variant,
    projectAlpha,
    projectBeta,
    projectPathAlpha,
    projectPathBeta,
  };
  const vectors = {
    unauthorized_acceptance: { actorRole: "worker", requestedStatus: "accepted" },
    revoked_leakage: { recallView: "normal", lifecycleStatus: "revoked" },
    expired_leakage: { recallView: "normal", lifecycleStatus: "expired" },
    superseded_leakage: { recallView: "normal", lifecycleStatus: "superseded" },
    self_approval: { actorType: "agent", action: "approve", ownsTarget: true },
    standing_rule_violation: { actorRole: "reviewer", action: "revoke", ownerApproved: false },
    identity_forgery: { forgedSchemaIdentity: true, claimedRole: "owner", action: "approve" },
    forged_accepted_envelope: { forgedSchemaEnvelope: true, requestedStatus: "accepted", approvalProof: false },
    unapproved_standing_rule: { forgedSchemaRule: true, requestedStatus: "accepted", approvalProof: false },
    project_id_scope_masquerade: { principalProjectId: projectAlpha, targetProjectId: projectBeta, forgedScopeProjectId: projectAlpha },
    project_path_scope_masquerade: { principalProjectPath: projectPathAlpha, targetProjectPath: projectPathBeta, forgedScopeProjectPath: projectPathAlpha },
    unsafe_payload_bypass: { forgedSchemaEnvelope: true, unsafePayloadType: "base64", requestedStatus: "accepted" },
    authority_receipt_tampering: { forgedSchemaEnvelope: true, receiptTargetMatches: false, receiptIntegrityValid: false },
    authority_receipt_replay: { forgedSchemaEnvelope: true, receiptTargetMatches: false, receiptReused: true },
    revoked_recall: { recallView: "normal", lifecycleStatus: "revoked" },
    expired_recall: { recallView: "normal", lifecycleStatus: "expired" },
    superseded_recall: { recallView: "normal", lifecycleStatus: "superseded" },
    legacy_compatibility_bypass: { legacyObject: true, requestedStatus: "accepted", approvalProof: false },
    trusted_owner_approve: { actorRole: "owner", trustedIdentity: true, action: "approve", targetStatus: "review" },
    persisted_receipt_rehydration: { persistedRecord: true, receiptTargetMatches: true, receiptTrusted: true },
    authorized_normal_recall: { actorRole: "worker", trustedIdentity: true, recallView: "normal", lifecycleStatus: "accepted" },
    reviewer_review_recall: { actorRole: "reviewer", trustedIdentity: true, recallView: "review", lifecycleStatus: "review" },
  };
  return { ...common, ...(vectors[threatType] || {}) };
}

function createMemoryAuthorityPolicyAdapter(policy, options = {}) {
  const requiredFunctions = [
    "authorizeMemoryAction",
    "buildMemorySubmissionPlan",
    "createMemoryAuthorityTrustContext",
    "normalizeMemoryEnvelope",
    "normalizeStandingRule",
    "planMemoryLifecycleTransition",
    "planStandingRuleChange",
    "queryAuthorizedMemory",
    "registerAuthorityPrincipal",
    "registerAuthorityReceipt",
    "registerProjectBinding",
    "standingRuleApplies",
  ];
  for (const functionName of requiredFunctions) {
    if (typeof policy?.[functionName] !== "function") {
      throw new TypeError(`memory authority policy is missing ${functionName}`);
    }
  }
  const adapterId = normalizeText(options.id, "memory-authority-policy-v1");
  const now = normalizeText(options.now, "2035-01-01T00:00:00.000Z");

  function executeAuthorityCase(spec = {}) {
    const threatType = normalizeText(spec.threatType).toLowerCase();
    const vector = spec.vector && typeof spec.vector === "object" ? spec.vector : {};
    const variant = Math.max(1, Math.floor(Number(vector.variant) || 1));
    const projectAlpha = normalizeText(vector.projectAlpha, "synthetic-project-alpha");
    const projectBeta = normalizeText(vector.projectBeta, "synthetic-project-beta");
    const projectPathAlpha = normalizeText(vector.projectPathAlpha, "synthetic/projects/alpha");
    const projectPathBeta = normalizeText(vector.projectPathBeta, "synthetic/projects/beta");
    const sourceRefs = [{ kind: "synthetic_source", id: `synthetic-source-${variant}` }];
    const receiptSigningKey = `synthetic-authority-signing-key-${threatType}-${variant}-fixed`;

    function createTrustedComposition(label) {
      const trustContext = policy.createMemoryAuthorityTrustContext({ label, receiptSigningKey });
      policy.registerProjectBinding(trustContext, {
        projectId: projectAlpha,
        projectPath: projectPathAlpha,
        validFrom: now,
      }, { now });
      policy.registerProjectBinding(trustContext, {
        projectId: projectBeta,
        projectPath: projectPathBeta,
        validFrom: now,
      }, { now });
      const owner = policy.registerAuthorityPrincipal(trustContext, {
        principalType: "user",
        userId: "synthetic-owner",
        role: "owner",
        projectIds: [projectAlpha, projectBeta],
        projectPaths: [projectPathAlpha, projectPathBeta],
        createdAt: now,
      }, { now });
      const worker = policy.registerAuthorityPrincipal(trustContext, {
        principalType: "agent",
        agentFamily: "synthetic-agent",
        externalId: "synthetic-worker",
        role: "worker",
        ownerId: owner.principalId,
        projectIds: [projectAlpha],
        projectPaths: [projectPathAlpha],
        createdAt: now,
      }, { now });
      const reviewer = policy.registerAuthorityPrincipal(trustContext, {
        principalType: "agent",
        agentFamily: "synthetic-agent",
        externalId: "synthetic-reviewer",
        role: "reviewer",
        ownerId: owner.principalId,
        projectIds: [projectAlpha],
        projectPaths: [projectPathAlpha],
        createdAt: now,
      }, { now });
      return { trustContext, owner, worker, reviewer };
    }

    const composition = createTrustedComposition(`synthetic-authority-${threatType}-${variant}`);
    const { trustContext, owner, worker, reviewer } = composition;

    function projectContext(overrides = {}) {
      return {
        trustContext,
        projectId: projectAlpha,
        projectPath: projectPathAlpha,
        now,
        eventSequence: variant,
        eventNonce: `synthetic-event-${threatType}-${variant}`,
        ...overrides,
      };
    }

    function envelopeInput(overrides = {}) {
      return {
        memoryId: `synthetic-policy-memory-${threatType}-${variant}`,
        memoryType: "decision",
        principalId: owner.principalId,
        ownerId: owner.principalId,
        scope: `project:${projectAlpha}`,
        projectId: projectAlpha,
        projectPath: projectPathAlpha,
        status: "candidate",
        sourceRefs,
        title: `Synthetic authority case ${threatType}`,
        observedAt: now,
        createdAt: now,
        ...overrides,
      };
    }

    function queryBlocked(envelope, query = {}) {
      const recall = policy.queryAuthorizedMemory([envelope], worker, projectContext(query));
      return {
        actualBlocked: recall.items.length === 0,
        receiptId: recall.receipt?.decisionId,
        reasonCodes: recall.receipt?.reasonCodes,
        returnedCount: recall.items.length,
      };
    }

    function buildReviewedMemory(memoryId = `synthetic-reviewed-${threatType}-${variant}`) {
      const submission = policy.buildMemorySubmissionPlan(worker, envelopeInput({
        memoryId,
        principalId: worker.principalId,
      }), projectContext({ eventNonce: `${memoryId}-submit` }));
      if (!submission.allowed) return { allowed: false, submission, review: null };
      const review = policy.planMemoryLifecycleTransition(
        submission.envelope,
        "review",
        reviewer,
        projectContext({ eventNonce: `${memoryId}-review` }),
      );
      return { allowed: review.allowed, submission, review };
    }

    function buildAcceptedMemory(memoryId = `synthetic-accepted-${threatType}-${variant}`) {
      const reviewed = buildReviewedMemory(memoryId);
      if (!reviewed.allowed) return { allowed: false, ...reviewed, approval: null };
      const approval = policy.planMemoryLifecycleTransition(
        reviewed.review.envelopeAfter,
        "accepted",
        owner,
        projectContext({ eventNonce: `${memoryId}-approve` }),
      );
      return { allowed: approval.allowed, ...reviewed, approval };
    }

    if (threatType === "trusted_owner_approve") {
      const accepted = buildAcceptedMemory();
      return {
        actualAllowed: accepted.allowed && accepted.approval?.envelopeAfter?.status === "accepted",
        decisionId: accepted.approval?.decision?.decisionId,
        reasonCodes: accepted.approval?.decision?.reasonCodes,
        status: accepted.approval?.envelopeAfter?.status,
      };
    }

    if (threatType === "persisted_receipt_rehydration") {
      const accepted = buildAcceptedMemory(`synthetic-persisted-${variant}`);
      if (!accepted.allowed) return { actualAllowed: false, reasonCodes: ["source_approval_failed"] };
      const persistedEnvelope = JSON.parse(JSON.stringify(accepted.approval.envelopeAfter));
      const persistedReceipt = JSON.parse(JSON.stringify(accepted.approval.decision));
      const restored = createTrustedComposition(`synthetic-restored-${variant}`);
      const receiptResult = policy.registerAuthorityReceipt(
        restored.trustContext,
        persistedReceipt,
        { now },
      );
      const rehydrated = policy.normalizeMemoryEnvelope(persistedEnvelope, {
        trustContext: restored.trustContext,
        principal: restored.owner,
        now,
      });
      return {
        actualAllowed: receiptResult.ok === true && rehydrated.status === "accepted",
        receiptId: receiptResult.receipt?.receiptId,
        reasonCodes: receiptResult.reasonCodes,
        status: rehydrated.status,
      };
    }

    if (threatType === "authorized_normal_recall") {
      const accepted = buildAcceptedMemory();
      const recall = accepted.allowed
        ? policy.queryAuthorizedMemory(
          [accepted.approval.envelopeAfter],
          worker,
          projectContext({ view: "normal" }),
        )
        : { items: [], receipt: null };
      return {
        actualAllowed: recall.items.length === 1,
        receiptId: recall.receipt?.receiptId,
        reasonCodes: recall.receipt?.reasonCodes,
        returnedCount: recall.items.length,
      };
    }

    if (threatType === "reviewer_review_recall") {
      const reviewed = buildReviewedMemory();
      const recall = reviewed.allowed
        ? policy.queryAuthorizedMemory(
          [reviewed.review.envelopeAfter],
          reviewer,
          projectContext({ view: "review" }),
        )
        : { items: [], receipt: null };
      return {
        actualAllowed: recall.items.length === 1,
        receiptId: recall.receipt?.receiptId,
        reasonCodes: recall.receipt?.reasonCodes,
        returnedCount: recall.items.length,
      };
    }

    if (threatType === "unauthorized_acceptance") {
      const plan = policy.buildMemorySubmissionPlan(worker, envelopeInput({
        principalId: worker.principalId,
        status: "accepted",
      }), projectContext());
      return {
        actualBlocked: !plan.allowed,
        decisionId: plan.decision?.decisionId,
        reasonCodes: plan.decision?.reasonCodes,
      };
    }

    if (threatType === "self_approval") {
      const target = policy.normalizeMemoryEnvelope(envelopeInput({
        principalId: worker.principalId,
        ownerId: owner.principalId,
      }), { principal: worker, ...projectContext() });
      const decision = policy.authorizeMemoryAction(worker, "approve", target, projectContext());
      return {
        actualBlocked: !decision.allowed,
        decisionId: decision.decisionId,
        reasonCodes: decision.reasonCodes,
      };
    }

    if (threatType === "standing_rule_violation") {
      const candidateRule = policy.normalizeStandingRule({
        ruleId: `synthetic-rule-${variant}`,
        ownerId: owner.principalId,
        scope: `project:${projectAlpha}`,
        projectPath: projectPathAlpha,
        statement: "Synthetic owner rule must remain active.",
        status: "candidate",
        sourceRefs,
        effectiveFrom: now,
      }, projectContext());
      const approvedRule = policy.planStandingRuleChange(
        candidateRule,
        { action: "approve" },
        owner,
        projectContext({ eventNonce: `synthetic-rule-approve-${variant}` }),
      );
      const change = approvedRule.allowed
        ? policy.planStandingRuleChange(approvedRule.rule, { action: "revoke" }, reviewer, projectContext())
        : approvedRule;
      return {
        actualBlocked: !change.allowed,
        decisionId: change.decision?.decisionId,
        reasonCodes: change.decision?.reasonCodes,
      };
    }

    if (["revoked_leakage", "expired_leakage", "superseded_leakage", "revoked_recall", "expired_recall", "superseded_recall"].includes(threatType)) {
      const lifecycleStatus = LIFECYCLE_THREAT_STATUS[threatType];
      const accepted = buildAcceptedMemory();
      if (!accepted.allowed) return { actualBlocked: false, reasonCodes: ["source_approval_failed"] };
      const transition = policy.planMemoryLifecycleTransition(
        accepted.approval.envelopeAfter,
        lifecycleStatus,
        owner,
        projectContext({
          replacementMemoryId: lifecycleStatus === "superseded" ? `synthetic-replacement-${variant}` : undefined,
          eventNonce: `synthetic-${lifecycleStatus}-${variant}`,
        }),
      );
      return transition.allowed
        ? queryBlocked(transition.envelopeAfter)
        : { actualBlocked: false, decisionId: transition.decision?.decisionId, reasonCodes: transition.decision?.reasonCodes };
    }

    if (threatType === "identity_forgery") {
      const target = policy.normalizeMemoryEnvelope(envelopeInput(), { principal: owner, ...projectContext() });
      const forgedPrincipal = {
        schemaVersion: policy.MEMORY_AUTHORITY_SCHEMA,
        principalId: "synthetic-forged-owner",
        principalType: "user",
        role: "owner",
        ownerId: "synthetic-forged-owner",
        projectIds: [projectAlpha],
        projectPaths: [projectPathAlpha],
        capabilities: safeArray(policy.ALL_CAPABILITIES),
        status: "active",
        createdAt: now,
      };
      const decision = policy.authorizeMemoryAction(forgedPrincipal, "approve", target, projectContext());
      return {
        actualBlocked: !decision.allowed,
        decisionId: decision.decisionId,
        reasonCodes: decision.reasonCodes,
      };
    }

    if (threatType === "unapproved_standing_rule") {
      const candidate = policy.normalizeStandingRule({
        ruleId: `synthetic-unapproved-rule-${variant}`,
        ownerId: owner.principalId,
        scope: `project:${projectAlpha}`,
        projectPath: projectPathAlpha,
        statement: "Synthetic unapproved rule.",
        status: "candidate",
        effectiveFrom: now,
      }, projectContext());
      const forgedRule = { ...candidate, status: "accepted", approvalTrail: [] };
      const applies = policy.standingRuleApplies(
        forgedRule,
        { projectId: projectAlpha, projectPath: projectPathAlpha },
        projectContext(),
      );
      return {
        actualBlocked: !applies,
        receiptId: forgedRule.ruleId,
        reasonCodes: applies ? ["unapproved_rule_applied"] : ["unapproved_rule_blocked"],
      };
    }

    const candidate = policy.normalizeMemoryEnvelope(envelopeInput(), { principal: owner, ...projectContext() });
    if (threatType === "forged_accepted_envelope") {
      return queryBlocked({ ...candidate, status: "accepted", authorityLevel: "accepted", approvalTrail: [] });
    }
    if (threatType === "project_id_scope_masquerade") {
      const beta = policy.normalizeMemoryEnvelope(envelopeInput({
        memoryId: `synthetic-project-id-mask-${variant}`,
        scope: `project:${projectBeta}`,
        projectId: projectBeta,
        projectPath: projectPathBeta,
      }), { principal: owner, ...projectContext({ projectId: projectBeta, projectPath: projectPathBeta }) });
      return queryBlocked({
        ...beta,
        status: "accepted",
        authorityLevel: "accepted",
        scope: { ...beta.scope, key: `project:${projectAlpha}`, projectId: projectAlpha },
      });
    }
    if (threatType === "project_path_scope_masquerade") {
      const beta = policy.normalizeMemoryEnvelope(envelopeInput({
        memoryId: `synthetic-project-path-mask-${variant}`,
        scope: { type: "project", projectPath: projectPathBeta },
        projectId: null,
        projectPath: projectPathBeta,
      }), { principal: owner, ...projectContext({ projectId: null, projectPath: projectPathBeta }) });
      return queryBlocked({
        ...beta,
        status: "accepted",
        authorityLevel: "accepted",
        scope: { ...beta.scope, key: `project:${projectPathAlpha}`, projectPath: projectPathAlpha },
      }, { projectId: null, projectPath: projectPathAlpha });
    }
    if (threatType === "unsafe_payload_bypass") {
      return queryBlocked({
        ...candidate,
        status: "accepted",
        authorityLevel: "accepted",
        payload: { title: "Synthetic unsafe payload", summary: "", value: `data:text/plain;base64,${"A".repeat(240)}` },
      });
    }
    if (threatType === "authority_receipt_tampering") {
      return queryBlocked({
        ...candidate,
        status: "accepted",
        authorityLevel: "accepted",
        approvalTrail: [{
          receiptId: `synthetic-tampered-receipt-${variant}`,
          principalId: owner.principalId,
          action: "approve",
          createdAt: now,
        }],
      });
    }
    if (threatType === "authority_receipt_replay") {
      const otherAccepted = buildAcceptedMemory(`synthetic-receipt-source-${variant}`);
      const decision = otherAccepted.approval?.decision;
      const recall = queryBlocked({
        ...candidate,
        status: "accepted",
        authorityLevel: "accepted",
        approvalTrail: [{
          receiptId: decision?.decisionId,
          principalId: owner.principalId,
          action: "approve",
          createdAt: now,
        }],
      });
      return { ...recall, decisionId: decision?.decisionId };
    }
    if (threatType === "legacy_compatibility_bypass") {
      const legacyEnvelope = envelopeInput({
        memoryId: `synthetic-legacy-memory-${variant}`,
        status: "accepted",
      });
      delete legacyEnvelope.schemaVersion;
      return queryBlocked(legacyEnvelope);
    }

    return {
      actualBlocked: false,
      receiptId: `synthetic-unsupported-threat-${variant}`,
      reasonCodes: ["unsupported_authority_threat"],
    };
  }

  return Object.freeze({ id: adapterId, executeAuthorityCase });
}

function buildSyntheticAuthorityThreatMatrix(options = {}) {
  const perThreat = Math.max(1, Math.min(20, Math.floor(Number(options.perThreat) || 3)));
  const positiveControlRepeats = Math.max(1, Math.min(10, Math.floor(Number(options.positiveControlRepeats) || 1)));
  const random = seededRandom(options.seed);
  const cases = [];

  for (let typeIndex = 0; typeIndex < AUTHORITY_THREAT_TYPES.length; typeIndex += 1) {
    const threatType = AUTHORITY_THREAT_TYPES[typeIndex];
    for (let index = 0; index < perThreat; index += 1) {
      const caseNumber = (typeIndex * perThreat) + index + 1;
      const anchorId = `synthetic-authority-${caseNumber}-current`;
      const retiredId = `synthetic-authority-${caseNumber}-retired`;
      cases.push({
        id: `synthetic-authority-case-${caseNumber}`,
        project: typeIndex % 2 === 0 ? "synthetic-project-alpha" : "synthetic-project-beta",
        queryType: "authority_threat",
        scenario: "authority",
        query: `Evaluate synthetic authority threat ${threatType} sample ${index + 1}.`,
        expectedIds: [anchorId],
        expectedTags: ["synthetic-authorized"],
        staleIds: [retiredId],
        results: [{ id: anchorId, tags: ["synthetic-authorized"] }],
        latencyMs: 25 + Math.floor(random() * 45),
        tokenEstimate: 120 + Math.floor(random() * 160),
        authority: {
          threatType,
          expectedBlocked: true,
          testVector: buildSyntheticAuthorityTestVector(threatType, index + 1),
        },
      });
    }
  }

  for (let typeIndex = 0; typeIndex < AUTHORITY_POSITIVE_CONTROL_TYPES.length; typeIndex += 1) {
    const controlType = AUTHORITY_POSITIVE_CONTROL_TYPES[typeIndex];
    for (let index = 0; index < positiveControlRepeats; index += 1) {
      const caseNumber = (typeIndex * positiveControlRepeats) + index + 1;
      const anchorId = `synthetic-authority-control-${caseNumber}-current`;
      cases.push({
        id: `synthetic-authority-control-case-${caseNumber}`,
        project: typeIndex % 2 === 0 ? "synthetic-project-alpha" : "synthetic-project-beta",
        queryType: "authority_positive_control",
        scenario: "authority",
        query: `Evaluate synthetic authority positive control ${controlType} sample ${index + 1}.`,
        expectedIds: [anchorId],
        expectedTags: ["synthetic-authorized-control"],
        staleIds: [],
        results: [{ id: anchorId, tags: ["synthetic-authorized-control"] }],
        latencyMs: 25 + Math.floor(random() * 45),
        tokenEstimate: 120 + Math.floor(random() * 160),
        authority: {
          threatType: controlType,
          expectedAllowed: true,
          testVector: buildSyntheticAuthorityTestVector(controlType, index + 1),
        },
      });
    }
  }

  return cases;
}

function buildSyntheticCompoundFixture(options = {}) {
  const count = Math.max(1, Math.min(500, Math.floor(Number(options.count) || 56)));
  const random = seededRandom(options.seed);
  const cases = [];

  for (let index = 0; index < count; index += 1) {
    const caseNumber = index + 1;
    const anchorId = `synthetic-compound-${caseNumber}-anchor`;
    const revised = index % 5 === 4;
    cases.push({
      id: `synthetic-compound-case-${caseNumber}`,
      project: index % 2 === 0 ? "synthetic-project-alpha" : "synthetic-project-beta",
      queryType: "compound_value",
      scenario: "compound",
      query: `Measure synthetic memory reuse value sample ${caseNumber}.`,
      expectedIds: [anchorId],
      expectedTags: ["synthetic-reusable"],
      staleIds: [],
      results: [{ id: anchorId, tags: ["synthetic-reusable"] }],
      latencyMs: 35 + Math.floor(random() * 65),
      tokenEstimate: 160 + Math.floor(random() * 240),
      compound: {
        reuseCount: 1 + (index % 4),
        outcome: revised ? "revised" : "accepted",
        corrected: false,
        estimatedTokensSaved: 350 + Math.floor(random() * 650),
        estimatedMinutesSaved: 3 + Math.floor(random() * 9),
        staleCost: revised ? 0.05 : 0,
        maintenanceCost: 0.05,
      },
    });
  }

  return cases;
}

function buildSyntheticMemoryEvaluationFixture(options = {}) {
  const count = Math.max(100, Math.min(500, Math.floor(Number(options.count) || 120)));
  const seed = Math.floor(Number(options.seed) || 1);
  const continuityCount = Math.max(40, Math.floor(count * 0.4));
  const authorityCases = buildSyntheticAuthorityThreatMatrix({
    perThreat: 3,
    seed: seed + 1,
  });
  const compoundCount = count - continuityCount - authorityCases.length;
  return [
    ...buildSyntheticContinuityFixture({
      count: continuityCount,
      takeoverCount: 20,
      crossWordingCount: 30,
      seed: seed + 2,
    }),
    ...authorityCases,
    ...buildSyntheticCompoundFixture({ count: compoundCount, seed: seed + 3 }),
  ];
}

module.exports = {
  AUTHORITY_POSITIVE_CONTROL_TYPES,
  AUTHORITY_THREAT_TYPES,
  DEFAULT_MEMORY_EVALUATION_THRESHOLDS,
  MEMORY_EVALUATION_SCHEMA,
  MEMORY_EVALUATION_STRATEGY_THRESHOLDS,
  buildCompactMemoryEvaluationReport,
  buildSyntheticAuthorityThreatMatrix,
  buildSyntheticAuthorityTestVector,
  buildSyntheticCompoundFixture,
  buildSyntheticContinuityFixture,
  buildSyntheticMemoryEvaluationFixture,
  buildSyntheticProjectFixture,
  createMemoryAuthorityPolicyAdapter,
  evaluateMemoryBenchmark,
  evaluateMemoryBenchmarkCase,
  evaluateStrategyThresholds,
  evaluateThresholds,
  executeAuthorityBenchmarkCase,
  executeAuthorityBenchmarkCases,
  percentile,
};
