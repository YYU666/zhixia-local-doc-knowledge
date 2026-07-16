const assert = require("node:assert/strict");

const {
  AUTHORITY_POSITIVE_CONTROL_TYPES,
  AUTHORITY_THREAT_TYPES,
  MEMORY_EVALUATION_STRATEGY_THRESHOLDS,
  buildSyntheticAuthorityThreatMatrix,
  buildSyntheticMemoryEvaluationFixture,
  buildSyntheticProjectFixture,
  createMemoryAuthorityPolicyAdapter,
  evaluateMemoryBenchmark,
  evaluateMemoryBenchmarkCase,
  percentile,
} = require("../electron/memoryEvaluationPolicy.cjs");

const memoryAuthorityPolicy = require("../electron/memoryAuthorityPolicy.cjs");

function permissiveRetrievalThresholds() {
  return {
    recallAtK: 0,
    precisionAtK: 0,
    mrr: 0,
    ndcgAtK: 0,
    missingAnchorRate: 1,
    staleHitRate: 1,
    averageLatencyMs: 1000,
    p95LatencyMs: 1000,
    averageTokenEstimate: 1000,
    p95TokenEstimate: 1000,
  };
}

function executedAuthority(threatType, actualBlocked, suffix) {
  return {
    threatType,
    expectedBlocked: true,
    execution: {
      executed: true,
      adapterId: "external-authority-policy-test",
      proofId: `external-proof-${suffix}`,
      actualBlocked,
    },
  };
}

function createStrictLocalAuthorityAdapter(options = {}) {
  return {
    id: options.id || "strict-local-authority-policy-v1",
    executeAuthorityCase(spec) {
      const vector = spec.vector || {};
      let blocked = false;
      switch (spec.threatType) {
        case "unauthorized_acceptance":
          blocked = vector.actorRole === "worker" && vector.requestedStatus === "accepted";
          break;
        case "revoked_leakage":
        case "expired_leakage":
        case "superseded_leakage":
        case "revoked_recall":
        case "expired_recall":
        case "superseded_recall":
          blocked = vector.recallView === "normal"
            && ["revoked", "expired", "superseded"].includes(vector.lifecycleStatus);
          break;
        case "self_approval":
          blocked = vector.actorType === "agent" && vector.action === "approve" && vector.ownsTarget;
          break;
        case "standing_rule_violation":
          blocked = vector.actorRole === "reviewer" && vector.action === "revoke" && !vector.ownerApproved;
          break;
        case "identity_forgery":
          blocked = vector.forgedSchemaIdentity && vector.claimedRole === "owner";
          break;
        case "forged_accepted_envelope":
          blocked = vector.forgedSchemaEnvelope && vector.requestedStatus === "accepted" && !vector.approvalProof;
          break;
        case "unapproved_standing_rule":
          blocked = vector.forgedSchemaRule && vector.requestedStatus === "accepted" && !vector.approvalProof;
          break;
        case "project_id_scope_masquerade":
          blocked = vector.principalProjectId !== vector.targetProjectId
            && vector.forgedScopeProjectId === vector.principalProjectId;
          break;
        case "project_path_scope_masquerade":
          blocked = vector.principalProjectPath !== vector.targetProjectPath
            && vector.forgedScopeProjectPath === vector.principalProjectPath;
          break;
        case "unsafe_payload_bypass":
          blocked = vector.forgedSchemaEnvelope && vector.unsafePayloadType === "base64";
          break;
        case "authority_receipt_tampering":
          blocked = vector.forgedSchemaEnvelope && !vector.receiptIntegrityValid && !vector.receiptTargetMatches;
          break;
        case "authority_receipt_replay":
          blocked = vector.forgedSchemaEnvelope && vector.receiptReused && !vector.receiptTargetMatches;
          break;
        case "legacy_compatibility_bypass":
          blocked = vector.legacyObject && vector.requestedStatus === "accepted" && !vector.approvalProof;
          break;
        case "trusted_owner_approve":
          blocked = !(vector.actorRole === "owner" && vector.trustedIdentity && vector.action === "approve");
          break;
        case "persisted_receipt_rehydration":
          blocked = !(vector.persistedRecord && vector.receiptTargetMatches && vector.receiptTrusted);
          break;
        case "authorized_normal_recall":
          blocked = !(vector.actorRole === "worker" && vector.trustedIdentity && vector.recallView === "normal");
          break;
        case "reviewer_review_recall":
          blocked = !(vector.actorRole === "reviewer" && vector.trustedIdentity && vector.recallView === "review");
          break;
        default:
          blocked = false;
      }
      if (spec.threatType === options.breakThreat) blocked = false;
      return {
        actualBlocked: blocked,
        proofId: `${options.id || "strict-proof"}-${spec.id}`,
        reasonCodes: [blocked ? "strict_policy_blocked" : "strict_policy_allowed"],
      };
    },
  };
}

function main() {
  const caseMetrics = evaluateMemoryBenchmarkCase({
    id: "metric-case",
    project: "synthetic-project-alpha",
    queryType: "architecture",
    query: "Retrieve a synthetic architecture decision.",
    expectedIds: ["anchor-a", "anchor-b"],
    expectedTags: ["architecture"],
    staleIds: ["stale-a"],
    results: [
      { id: "anchor-a", tags: ["decision"] },
      { id: "stale-a", tags: ["architecture"] },
      { id: "distractor-a", tags: ["unrelated"] },
    ],
    latencyMs: 120,
    tokenEstimate: 360,
  }, { k: 3 });

  assert.equal(caseMetrics.recallAtK, 0.666667, "Recall@K should measure covered expected ID/tag anchors");
  assert.equal(caseMetrics.precisionAtK, 0.666667, "Precision@K should divide relevant unique results by K");
  assert.equal(caseMetrics.mrr, 1, "MRR should use the first relevant rank");
  assert.equal(caseMetrics.ndcgAtK, 1, "nDCG should reward ideal placement of the expected relevant result count");
  assert.equal(caseMetrics.missingAnchorRate, 0.333333, "missing-anchor rate should complement anchor recall");
  assert.equal(caseMetrics.staleHitRate, 0.333333, "stale-hit rate should use returned top-K results as denominator");

  const benchmark = [
    {
      id: "alpha-resume",
      project: "synthetic-project-alpha",
      queryType: "project_resume",
      query: "Resume synthetic alpha.",
      expectedIds: ["alpha-anchor"],
      expectedTags: ["resume"],
      staleIds: [],
      results: [{ id: "alpha-anchor", tags: ["resume"] }],
      latencyMs: 100,
      tokenEstimate: 200,
    },
    {
      id: "alpha-review",
      project: "synthetic-project-alpha",
      queryType: "review_gate",
      query: "Review synthetic alpha.",
      expectedIds: ["alpha-review-anchor"],
      staleIds: [],
      results: [{ id: "alpha-review-anchor", tags: ["review"] }],
      latencyMs: 200,
      tokenEstimate: 400,
    },
    {
      id: "beta-resume",
      project: "synthetic-project-beta",
      queryType: "project_resume",
      query: "Resume synthetic beta.",
      expectedIds: ["beta-anchor"],
      staleIds: ["beta-stale"],
      results: [{ id: "beta-stale", tags: ["stale"] }],
      latencyMs: 300,
      tokenEstimate: 600,
    },
  ];
  const grouped = evaluateMemoryBenchmark(benchmark, {
    k: 1,
    thresholds: permissiveRetrievalThresholds(),
  });
  assert.equal(grouped.metrics.averageLatencyMs, 200, "average latency should aggregate all cases");
  assert.equal(grouped.metrics.p95LatencyMs, 300, "P95 latency should use nearest-rank percentile");
  assert.equal(grouped.metrics.averageTokenEstimate, 400, "average token estimate should aggregate all cases");
  assert.equal(grouped.metrics.p95TokenEstimate, 600, "P95 token estimate should use nearest-rank percentile");
  assert.equal(grouped.groups.byProject["synthetic-project-alpha"].caseCount, 2, "project grouping should include both alpha cases");
  assert.equal(grouped.groups.byProject["synthetic-project-beta"].recallAtK, 0, "project grouping should isolate beta quality");
  assert.equal(grouped.groups.byQueryType.project_resume.caseCount, 2, "queryType grouping should combine matching query types");
  assert.equal(grouped.groups.byQueryType.review_gate.caseCount, 1, "queryType grouping should preserve singleton groups");
  assert.equal(grouped.groups.byScenario.retrieval.caseCount, 3, "scenario grouping should preserve legacy retrieval cases");
  assert.equal(percentile([300, 100, 200], 0.95), 300, "percentile should be deterministic and independent of input order");

  const continuity = evaluateMemoryBenchmark([
    {
      id: "continuity-one",
      project: "synthetic-project-alpha",
      scenario: "continuity",
      expectedIds: ["continuity-anchor-one"],
      results: [{ id: "continuity-anchor-one" }],
      continuity: {
        mandatorySlots: ["identity", "goal", "architecture", "next"],
        filledSlots: ["identity", "goal", "architecture"],
        criticalSlots: ["identity", "next"],
        takeoverCase: true,
        takeoverSuccessful: true,
        expectedProject: "synthetic-project-alpha",
        resolvedProject: "synthetic-project-alpha",
        expectedModule: "synthetic-module-one",
        resolvedModule: "synthetic-module-other",
      },
    },
    {
      id: "continuity-two",
      project: "synthetic-project-beta",
      scenario: "continuity",
      expectedIds: ["continuity-anchor-two"],
      results: [{ id: "continuity-anchor-two" }],
      continuity: {
        mandatorySlots: ["identity", "blocker"],
        filledSlots: ["identity"],
        criticalSlots: ["blocker"],
        takeoverCase: true,
        takeoverSuccessful: false,
        expectedProject: "synthetic-project-beta",
        resolvedProject: "synthetic-project-other",
        expectedModule: "synthetic-module-two",
        resolvedModule: "synthetic-module-two",
      },
    },
  ], { k: 1, thresholds: permissiveRetrievalThresholds() });
  assert.equal(continuity.metrics.mandatorySlotCoverage, 0.666667, "slot coverage should use filled mandatory slots over all mandatory slots");
  assert.equal(continuity.metrics.criticalMissingRate, 0.666667, "critical missing rate should use missing critical slots over all critical slots");
  assert.equal(continuity.metrics.takeoverSuccessRate, 0.5, "takeover success should use successful takeover cases over takeover cases");
  assert.equal(continuity.metrics.wrongProjectRate, 0.5, "wrong project rate should use evaluated project resolutions");
  assert.equal(continuity.metrics.wrongModuleRate, 0.5, "wrong module rate should use evaluated module resolutions");
  assert.equal(continuity.metrics.wrongProjectOrModuleRate, 1, "combined scope error rate should count either project or module mismatch once per case");
  assert.equal(continuity.groups.byScenario.continuity.continuityCaseCount, 2, "continuity metrics should remain available in grouped output");

  const authority = evaluateMemoryBenchmark([
    {
      id: "unauthorized-blocked",
      authority: executedAuthority("unauthorized_acceptance", true, "unauthorized-blocked"),
    },
    {
      id: "unauthorized-accepted",
      authority: executedAuthority("unauthorized_acceptance", false, "unauthorized-accepted"),
    },
    {
      id: "revoked-leaked",
      authority: executedAuthority("revoked_leakage", false, "revoked-leaked"),
    },
    {
      id: "expired-blocked",
      authority: executedAuthority("expired_leakage", true, "expired-blocked"),
    },
    {
      id: "superseded-leaked",
      authority: executedAuthority("superseded_leakage", false, "superseded-leaked"),
    },
    {
      id: "self-blocked",
      authority: executedAuthority("self_approval", true, "self-blocked"),
    },
    {
      id: "self-approved",
      authority: executedAuthority("self_approval", false, "self-approved"),
    },
    {
      id: "rule-blocked",
      authority: executedAuthority("standing_rule_violation", true, "rule-blocked"),
    },
    {
      id: "rule-violated",
      authority: executedAuthority("standing_rule_violation", false, "rule-violated"),
    },
  ], { k: 1, thresholds: permissiveRetrievalThresholds() });
  assert.equal(authority.metrics.unauthorizedAcceptanceRate, 0.5, "unauthorized acceptance should use accepted unauthorized attempts over all attempts");
  assert.equal(authority.metrics.retiredMemoryLeakageRate, 0.666667, "retired leakage should combine revoked, expired, and superseded threats");
  assert.equal(authority.metrics.revokedLeakageRate, 1, "revoked leakage should remain independently visible");
  assert.equal(authority.metrics.expiredLeakageRate, 0, "expired leakage should remain independently visible");
  assert.equal(authority.metrics.supersededLeakageRate, 1, "superseded leakage should remain independently visible");
  assert.equal(authority.metrics.selfApprovalRate, 0.5, "self approval should use successful self approvals over attempts");
  assert.equal(authority.metrics.standingRuleViolationRate, 0.5, "standing-rule violations should use violations over attempts");
  assert.equal(authority.metrics.callerExecutedAuthorityCaseCount, 9, "caller-executed authority outcomes should remain available for metric compatibility");
  assert.equal(authority.metrics.authorityEvidenceVerificationRate, 0, "caller-provided execution metadata should not become harness-verified");
  assert.equal(authority.metrics.authorityOutcomeFailureRate, 0, "unverified caller outcomes should not satisfy or contaminate the verified outcome gate");
  assert.equal(authority.metrics.authorityThreatCoverage, 0, "caller-provided executions should not satisfy verified taxonomy coverage");
  assert.equal(authority.strategyGate.passed, false, "caller-executed metadata alone should fail the verified strategy gate");

  const selfReportedAuthority = evaluateMemoryBenchmark([{
    id: "self-reported-authority",
    authority: {
      threatType: "unauthorized_acceptance",
      unauthorizedAttempt: true,
      unauthorizedAccepted: false,
    },
  }], { k: 1, thresholds: permissiveRetrievalThresholds() });
  assert.equal(selfReportedAuthority.metrics.verifiedAuthorityThreatCaseCount, 0, "self-reported outcomes should not count as verified execution");
  assert.equal(selfReportedAuthority.metrics.authorityEvidenceVerificationRate, 0, "self-reported outcomes should have zero evidence verification");
  assert.equal(selfReportedAuthority.strategyGate.passed, false, "self-reported authority evidence must not satisfy the strategy gate");
  assert.ok(
    selfReportedAuthority.strategyGate.failedThresholds.includes("authorityEvidenceVerificationRate"),
    "strategy failure should identify missing authority execution proof",
  );

  const compound = evaluateMemoryBenchmark([
    {
      id: "compound-accepted",
      compound: {
        reuseCount: 2,
        outcome: "accepted",
        estimatedTokensSaved: 1000,
        estimatedMinutesSaved: 10,
        staleCost: 1,
      },
    },
    {
      id: "compound-revised",
      compound: {
        reuseCount: 1,
        outcome: "revised",
        corrected: true,
        maintenanceCost: 1,
      },
    },
    {
      id: "compound-failed",
      compound: {
        outcome: "failed",
        staleCost: 2,
      },
    },
  ], { k: 1, thresholds: permissiveRetrievalThresholds() });
  assert.equal(compound.metrics.reuseCount, 3, "reuse count should sum all observed reuse events");
  assert.equal(compound.metrics.acceptRate, 0.333333, "accept rate should use recognized compound outcomes");
  assert.equal(compound.metrics.reviseRate, 0.333333, "revise rate should use recognized compound outcomes");
  assert.equal(compound.metrics.failureRate, 0.333333, "failure rate should use recognized compound outcomes");
  assert.equal(compound.metrics.correctionRate, 0.333333, "correction rate should use all compound cases");
  assert.equal(compound.metrics.estimatedTokensSaved, 1000, "token savings should sum deterministically");
  assert.equal(compound.metrics.estimatedMinutesSaved, 10, "time savings should sum deterministically");
  assert.equal(compound.metrics.staleCost, 3, "stale cost should sum deterministically");
  assert.equal(compound.metrics.maintenanceCost, 1, "maintenance cost should sum deterministically");
  assert.equal(compound.metrics.grossCompoundValue, 5, "gross compound value should normalize reuse, token, and time savings");
  assert.equal(compound.metrics.netCompoundScore, -0.537037, "net compound score should apply quality and cost penalties with deterministic bounded math");
  assert.ok(compound.metrics.netCompoundScore >= -1 && compound.metrics.netCompoundScore <= 1, "net compound score should remain bounded");

  const negativeCompounding = evaluateMemoryBenchmark([{
    id: "negative-compounding",
    compound: {
      reuseCount: 4,
      outcome: "failed",
      corrected: true,
      estimatedTokensSaved: 500,
      staleCost: 8,
      maintenanceCost: 3,
    },
  }], { k: 1, thresholds: permissiveRetrievalThresholds() });
  assert.ok(negativeCompounding.metrics.netCompoundScore < 0, "failure, correction, stale, and maintenance costs should produce a negative compounding penalty");

  const failed = evaluateMemoryBenchmark([{
    id: "threshold-failure",
    project: "synthetic-project-alpha",
    queryType: "bug_repair",
    query: "Find a missing synthetic fix.",
    expectedIds: ["required-fix"],
    staleIds: ["obsolete-fix"],
    results: [{ id: "obsolete-fix", tags: ["obsolete"] }],
    latencyMs: 900,
    tokenEstimate: 2200,
  }], { k: 1 });
  assert.equal(failed.gate.passed, false, "quality and efficiency threshold violations should fail the legacy retrieval gate");
  assert.ok(failed.gate.failedThresholds.includes("recallAtK"), "failed gate should name recall failure");
  assert.ok(failed.gate.failedThresholds.includes("staleHitRate"), "failed gate should name stale-hit failure");
  assert.ok(failed.gate.failedThresholds.includes("p95LatencyMs"), "failed gate should name latency failure");
  assert.match(failed.compactReport, /^FAIL \| memory-eval/, "compact report should expose the legacy verdict first");
  assert.match(failed.compactReport, /failed=.*recallAtK/, "compact report should list failed retrieval thresholds");
  assert.match(failed.compactReport, /strategy=FAIL/, "compact report should expose the strategy verdict");

  const empty = evaluateMemoryBenchmark([], { k: 5 });
  assert.equal(empty.metrics.caseCount, 0, "empty benchmarks should return zero-valued metrics");
  assert.equal(empty.metrics.p95LatencyMs, 0, "empty latency percentile should be zero");
  assert.equal(empty.metrics.p95TokenEstimate, 0, "empty token percentile should be zero");
  assert.equal(empty.metrics.mandatorySlotCoverage, 0, "empty continuity coverage should be zero");
  assert.equal(empty.metrics.unauthorizedAcceptanceRate, 0, "empty authority rates should be zero");
  assert.equal(empty.metrics.netCompoundScore, 0, "empty compound score should be zero");
  assert.equal(empty.gate.passed, false, "empty benchmarks should fail minimumCases");
  assert.equal(empty.strategyGate.passed, false, "empty benchmarks should fail strategy coverage");
  assert.ok(empty.gate.failedThresholds.includes("caseCount"), "empty failure should identify missing cases");
  assert.deepEqual(
    empty.groups,
    { byProject: {}, byQueryType: {}, byScenario: {} },
    "empty benchmarks should have empty groups",
  );

  const fixtureA = buildSyntheticProjectFixture({ count: 12, seed: 42 });
  const fixtureB = buildSyntheticProjectFixture({ count: 12, seed: 42 });
  assert.deepEqual(fixtureA, fixtureB, "synthetic project fixtures should be deterministic for the same seed");
  assert.equal(fixtureA.length, 12, "legacy fixture builder should honor the requested bounded case count");
  assert.ok(fixtureA.every((item) => item.id.startsWith("synthetic-project-case-")), "legacy fixtures should use visibly synthetic case IDs");

  const threatMatrix = buildSyntheticAuthorityThreatMatrix({ perThreat: 4, seed: 17 });
  assert.equal(
    threatMatrix.length,
    (AUTHORITY_THREAT_TYPES.length * 4) + AUTHORITY_POSITIVE_CONTROL_TYPES.length,
    "authority matrix should cover repeated threats and positive controls",
  );
  assert.deepEqual(
    [...new Set(threatMatrix.filter((item) => item.authority.expectedBlocked).map((item) => item.authority.threatType))].sort(),
    [...AUTHORITY_THREAT_TYPES].sort(),
    "authority threat matrix should include every required threat type",
  );
  assert.deepEqual(
    [...new Set(threatMatrix.filter((item) => item.authority.expectedAllowed).map((item) => item.authority.threatType))].sort(),
    [...AUTHORITY_POSITIVE_CONTROL_TYPES].sort(),
    "authority matrix should include every required positive control",
  );
  const requiredRevisionThreats = [
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
  ];
  assert.ok(
    requiredRevisionThreats.every((threatType) => AUTHORITY_THREAT_TYPES.includes(threatType)),
    "authority taxonomy should include every neutral-review threat class",
  );
  assert.ok(
    threatMatrix.every((item) => !item.authority.execution),
    "fixture construction without an adapter should not fabricate execution evidence",
  );

  const comprehensiveA = buildSyntheticMemoryEvaluationFixture({ count: 120, seed: 73 });
  const comprehensiveB = buildSyntheticMemoryEvaluationFixture({ count: 120, seed: 73 });
  assert.deepEqual(comprehensiveA, comprehensiveB, "comprehensive fixtures should be deterministic for the same seed");
  assert.equal(comprehensiveA.length, 120, "comprehensive fixture should honor requested counts above the strategy minimum");
  assert.ok(comprehensiveA.length >= MEMORY_EVALUATION_STRATEGY_THRESHOLDS.minimumCases, "comprehensive fixture should satisfy the minimum total case count");
  assert.ok(comprehensiveA.filter((item) => item.continuity?.takeoverCase).length >= 20, "comprehensive fixture should include at least 20 takeover cases");
  assert.ok(comprehensiveA.filter((item) => item.crossWording).length >= 30, "comprehensive fixture should include at least 30 cross-wording cases");

  const serializedFixture = JSON.stringify([fixtureA, threatMatrix, comprehensiveA]);
  assert.doesNotMatch(serializedFixture, /[A-Za-z]:\\|\/Users\/|\.codex|session\.jsonl/i, "fixtures must not contain local paths or raw-session pointers");
  assert.doesNotMatch(serializedFixture, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, "fixtures must not contain real-looking thread UUIDs");

  const unexecuted = evaluateMemoryBenchmark(comprehensiveA, { k: 1 });
  assert.equal(unexecuted.gate.passed, true, "unexecuted authority fixtures should preserve the legacy retrieval gate");
  assert.equal(unexecuted.strategyGate.passed, false, "unexecuted authority fixtures must fail strategy verification");
  assert.ok(
    unexecuted.strategyGate.failedThresholds.includes("authorityEvidenceVerificationRate"),
    "unexecuted fixture failure should identify missing authority proof",
  );

  const strictAdapter = createStrictLocalAuthorityAdapter();
  const deterministicA = evaluateMemoryBenchmark(comprehensiveA, { k: 1, authorityAdapter: strictAdapter });
  const deterministicB = evaluateMemoryBenchmark(comprehensiveB, { k: 1, authorityAdapter: strictAdapter });
  assert.deepEqual(deterministicA.metrics, deterministicB.metrics, "evaluation metrics should be deterministic for identical benchmark input");
  assert.deepEqual(deterministicA.gate, deterministicB.gate, "retrieval gates should remain deterministic");
  assert.deepEqual(deterministicA.strategyGate, deterministicB.strategyGate, "strategy gates should remain deterministic");
  assert.notEqual(
    deterministicA.cases.find((item) => item.authorityEvidenceVerified).authorityProofId,
    deterministicB.cases.find((item) => item.authorityEvidenceVerified).authorityProofId,
    "harness proofs should bind a unique nonce for each evaluation run",
  );
  assert.equal(deterministicA.gate.passed, true, "secure comprehensive fixtures should pass the legacy retrieval gate");
  assert.equal(deterministicA.strategyGate.passed, true, "executed strict-policy fixtures should pass strategy thresholds");
  assert.equal(deterministicA.metrics.authorityEvidenceVerificationRate, 1, "every authority threat should have adapter execution proof");
  assert.equal(deterministicA.metrics.authorityOutcomeFailureRate, 0, "strict policy should block every expected threat");
  assert.equal(deterministicA.metrics.authorityThreatCoverage, 1, "comprehensive fixtures should cover the full authority threat matrix");
  assert.equal(deterministicA.metrics.verifiedAuthorityThreatCaseCount, AUTHORITY_THREAT_TYPES.length * 3, "verified threat counts should exclude positive controls");
  assert.equal(deterministicA.metrics.verifiedAuthorityPositiveControlCaseCount, AUTHORITY_POSITIVE_CONTROL_TYPES.length, "verified positive-control counts should remain separate");
  assert.equal(deterministicA.metrics.authorityPositiveControlCoverage, 1, "all positive control types should execute");
  assert.equal(deterministicA.metrics.authorityPositiveControlFailureRate, 0, "strict policy should allow every legitimate positive control");
  assert.equal(deterministicA.metrics.wrongProjectOrModuleRate, 0, "secure comprehensive fixtures should preserve project and module isolation");
  assert.match(deterministicA.compactReport, /^PASS \| memory-eval/, "compact report should expose a passing retrieval verdict");
  assert.match(deterministicA.compactReport, /strategy=PASS/, "compact report should expose a passing strategy verdict");

  const brokenAdapter = createStrictLocalAuthorityAdapter({
    id: "broken-local-authority-policy-v1",
    breakThreat: "identity_forgery",
  });
  const brokenEvaluation = evaluateMemoryBenchmark(comprehensiveA, { k: 1, authorityAdapter: brokenAdapter });
  assert.equal(brokenEvaluation.strategyGate.passed, false, "a deliberately broken injected adapter should fail the strategy gate");
  assert.ok(
    brokenEvaluation.strategyGate.failedThresholds.includes("authorityOutcomeFailureRate"),
    "strategy failures should identify an executed authority-policy mismatch",
  );

  let alwaysAllowExecutionCount = 0;
  const alwaysAllowAdapter = {
    id: "always-allow-authority-policy",
    executeAuthorityCase() {
      alwaysAllowExecutionCount += 1;
      return { actualAllowed: true, proofId: "adapter-proof-ignored" };
    },
  };
  const prefilled = structuredClone(comprehensiveA);
  for (const item of prefilled.filter((entry) => entry.authority)) {
    item.authority.execution = {
      executed: true,
      executionSucceeded: true,
      adapterId: "forged-prefilled-adapter",
      harnessProofId: "forged-harness-proof",
      actualBlocked: item.authority.expectedBlocked === true,
    };
  }
  const prefilledOnly = evaluateMemoryBenchmark(prefilled, { k: 1 });
  assert.equal(prefilledOnly.strategyGate.passed, false, "prefilled authority execution metadata must not satisfy the strategy gate");
  assert.equal(prefilledOnly.metrics.verifiedAuthorityCaseCount, 0, "prefilled metadata should have no harness-owned run binding");
  const alwaysAllowEvaluation = evaluateMemoryBenchmark(prefilled, { k: 1, authorityAdapter: alwaysAllowAdapter });
  assert.equal(
    alwaysAllowExecutionCount,
    alwaysAllowEvaluation.metrics.authorityCaseCount,
    "strategy evaluation should force every authority case through the adapter in the current call",
  );
  assert.equal(alwaysAllowEvaluation.strategyGate.passed, false, "an always-allow adapter should fail blocked threat cases");
  assert.ok(
    alwaysAllowEvaluation.strategyGate.failedThresholds.includes("authorityOutcomeFailureRate"),
    "always-allow failure should be an executed outcome mismatch",
  );

  const denyAllAdapter = {
    id: "deny-all-authority-policy",
    executeAuthorityCase() {
      return { actualBlocked: true, proofId: "adapter-proof-ignored" };
    },
  };
  const denyAllEvaluation = evaluateMemoryBenchmark(comprehensiveA, { k: 1, authorityAdapter: denyAllAdapter });
  assert.equal(denyAllEvaluation.strategyGate.passed, false, "a deny-all adapter should fail legitimate positive controls");
  assert.equal(denyAllEvaluation.metrics.authorityPositiveControlFailureRate, 1, "deny-all should fail every positive control");
  assert.ok(
    denyAllEvaluation.strategyGate.failedThresholds.includes("authorityPositiveControlFailureRate"),
    "deny-all failure should identify positive-control rejection",
  );

  const throwingAdapter = {
    id: "throwing-authority-policy",
    executeAuthorityCase() {
      throw new Error("synthetic adapter failure");
    },
  };
  const throwingEvaluation = evaluateMemoryBenchmark(comprehensiveA, { k: 1, authorityAdapter: throwingAdapter });
  assert.equal(throwingEvaluation.strategyGate.passed, false, "a throwing adapter should fail the strategy gate");
  assert.equal(throwingEvaluation.metrics.authorityEvidenceVerificationRate, 1, "the harness should bind proof that adapter execution failed");
  assert.equal(throwingEvaluation.metrics.authorityOutcomeFailureRate, 1, "execution errors should fail every authority outcome");

  const realAdapter = createMemoryAuthorityPolicyAdapter(memoryAuthorityPolicy, {
    id: "real-memory-authority-policy",
  });
  const realPolicyEvaluation = evaluateMemoryBenchmark(comprehensiveA, {
    k: 1,
    authorityAdapter: realAdapter,
  });
  assert.equal(realPolicyEvaluation.metrics.authorityEvidenceVerificationRate, 1, "real policy probes should produce proof-bearing execution metadata");
  assert.equal(realPolicyEvaluation.metrics.authorityThreatCoverage, 1, "real policy probes should execute every authority threat type");
  assert.equal(realPolicyEvaluation.metrics.authorityPositiveControlCoverage, 1, "real policy probes should execute every positive control");
  assert.equal(realPolicyEvaluation.metrics.authorityOutcomeFailureRate, 0, "real policy should block every expected synthetic authority attack");
  assert.equal(realPolicyEvaluation.metrics.authorityPositiveControlFailureRate, 0, "real policy should allow every legitimate positive control");
  assert.equal(realPolicyEvaluation.strategyGate.passed, true, "real Memory Authority policy should pass the executable strategy gate");

  console.log("Memory evaluation policy behavior tests passed.");
}

main();
