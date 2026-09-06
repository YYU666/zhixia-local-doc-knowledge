const MAX_RETRIEVAL_TOKEN_BUDGET = 10_000;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 1_200;
const DEFAULT_TAKEOVER_TOKEN_BUDGET = 2_200;
const ADAPTIVE_TOKEN_BUDGET_STEPS = [1_200, 2_200, 3_000, 5_000, 7_500, 10_000];

function boundedTokenBudget(value, fallback) {
  const parsed = Number(value);
  const selected = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(800, Math.min(Math.floor(selected), MAX_RETRIEVAL_TOKEN_BUDGET));
}

function retrievalBudgetEnvelope(request = {}, operation = "retrieve") {
  const preferredTokenBudget = boundedTokenBudget(request.tokenBudget,
    operation === "prepare_takeover" ? DEFAULT_TAKEOVER_TOKEN_BUDGET : DEFAULT_CONTEXT_TOKEN_BUDGET);
  const strictTokenBudget = request.strictTokenBudget === true;
  const requestedMax = boundedTokenBudget(request.maxTokenBudget, MAX_RETRIEVAL_TOKEN_BUDGET);
  return {
    mode: strictTokenBudget ? "strict" : "adaptive",
    preferredTokenBudget,
    maxTokenBudget: strictTokenBudget ? preferredTokenBudget : Math.max(preferredTokenBudget, requestedMax),
    hardTokenLimit: MAX_RETRIEVAL_TOKEN_BUDGET,
    strictTokenBudget,
  };
}

function nextAdaptiveTokenBudget(current, maximum) {
  const next = ADAPTIVE_TOKEN_BUDGET_STEPS.find((value) => value > current);
  return Math.min(maximum, next || maximum);
}

// Archive metadata is not Host context telemetry and grants no execution authority.
function evaluateArchivePressure(input = {}) {
  const names = ["sessionBytes", "lineCount", "maxLineChars", "linesOver100k", "dataImageHits",
    "base64Hits", "imagePathHits", "toolOutputLikeHits", "visibleThreadCount", "activeWorkerCount", "longTitleCount"];
  const missingMetrics = [];
  const metrics = Object.fromEntries(names.map((name) => {
    const value = input[name];
    const valid = typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (!valid) missingMetrics.push(name);
    return [name, valid ? value : null];
  }));
  const warnings = ["host_context_assessment_required"];
  if (metrics.sessionBytes >= 50 * 1024 * 1024 || metrics.linesOver100k > 0) warnings.push("large_archive_metadata");
  if (metrics.dataImageHits > 0 || metrics.base64Hits > 0) warnings.push("archive_contains_visual_payloads");
  return {
    schemaVersion: "zhixia.ceo_memory_runtime_guard.v2",
    generatedAt: new Date().toISOString(),
    threadId: input.threadId || input.currentThreadId || input.currentCeoThreadId || null,
    projectPath: input.projectPath || input.workspace || null,
    pressureLevel: "unknown",
    action: "advisory_only",
    authority: "none",
    assessmentScope: "archive_metadata_only",
    hostAssessmentRequired: true,
    contextSafe: null,
    sessionMb: metrics.sessionBytes === null ? null : Number((metrics.sessionBytes / (1024 * 1024)).toFixed(2)),
    metrics,
    missingMetrics,
    gates: { writebackRequired: false, stopNewDispatch: false, harvestOnly: false, takeoverRecommended: false, freezeRisk: false },
    recommendations: ["use_host_current_context_assessment_before_model_execution"],
    warnings,
    performance: {
      purePolicy: true, startsTimers: false, scansVault: false, readsRawSessionBody: false,
      mutatesCodexSessions: false, archiveCompactDeleteMoveRestore: false,
    },
  };
}

module.exports = { MAX_RETRIEVAL_TOKEN_BUDGET, boundedTokenBudget, retrievalBudgetEnvelope, nextAdaptiveTokenBudget, evaluateArchivePressure };
