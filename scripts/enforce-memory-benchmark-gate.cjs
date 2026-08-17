const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  MEMORY_EVALUATION_STRATEGY_THRESHOLDS,
  RELEASE_MEMORY_EVALUATION_THRESHOLDS,
  createMemoryAuthorityPolicyAdapter,
  evaluateMemoryBenchmark,
} = require("../electron/memoryEvaluationPolicy.cjs");
const memoryAuthorityPolicy = require("../electron/memoryAuthorityPolicy.cjs");

const RELEASE_INPUT_SCHEMA = "zhixia.memory_release_benchmark_input.v1";
const RELEASE_CORPUS_SCHEMA = "zhixia.memory_release_corpus.v1";
const REAL_EXECUTION_INPUT_SCHEMA = "zhixia.memory_real_execution_input.v1";
const APPROVED_RELEASE_CORPUS_ID = "zhixia-memory-release-corpus-20260813-v1";
const APPROVED_RELEASE_CORPUS_SHA256 = "9e2aac828f2e8e972d58eb045611a5fa0c43b2a25d220687c405111152d271ab";
const APPROVED_REAL_EXECUTION_CORPUS_ID = "zhixia-memory-production-release-corpus-20260813-v2";
const APPROVED_REAL_EXECUTION_CORPUS_SHA256 = "b4dd15ec0bbea74b4e81d18c3989aacee7bf2c58a82c4bf92cb4ddb767a67824";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function fail(code, details = []) {
  const error = new Error(`${code}${details.length ? `:${details.join(",")}` : ""}`);
  error.code = code;
  throw error;
}

function validateReleaseInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("memory_release_corpus_input_required");
  const forbidden = ["metrics", "gate", "strategyGate", "passed", "thresholds", "strategyThresholds"]
    .filter((key) => Object.hasOwn(input, key));
  if (forbidden.length > 0) fail("memory_release_precomputed_verdict_forbidden", forbidden);
  if (input.schemaVersion !== RELEASE_INPUT_SCHEMA) fail("memory_release_input_schema_invalid");
  const corpus = input.corpus;
  if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)) fail("memory_release_corpus_required");
  if (corpus.schemaVersion !== RELEASE_CORPUS_SCHEMA) fail("memory_release_corpus_schema_invalid");
  if (!/^[a-z0-9][a-z0-9._-]{7,120}$/i.test(String(corpus.corpusId || ""))) fail("memory_release_corpus_id_invalid");
  if (!Array.isArray(corpus.cases)) fail("memory_release_cases_required");
  if (corpus.cases.length < RELEASE_MEMORY_EVALUATION_THRESHOLDS.minimumCases) {
    fail("memory_release_case_count_below_floor", [String(corpus.cases.length)]);
  }
  if (corpus.cases.length > 500) fail("memory_release_case_count_above_bound");
  const ids = new Set();
  for (const [index, benchmarkCase] of corpus.cases.entries()) {
    if (!benchmarkCase || typeof benchmarkCase !== "object" || Array.isArray(benchmarkCase)) {
      fail("memory_release_case_object_required", [String(index)]);
    }
    const id = String(benchmarkCase.id || benchmarkCase.caseId || "").trim();
    if (!id || ids.has(id)) fail(ids.has(id) ? "memory_release_case_id_duplicate" : "memory_release_case_id_required", [String(index)]);
    ids.add(id);
    if (!Array.isArray(benchmarkCase.expectedIds) || benchmarkCase.expectedIds.length === 0) {
      fail("memory_release_expected_ids_required", [id]);
    }
    if (!Array.isArray(benchmarkCase.results)) fail("memory_release_results_required", [id]);
    if (benchmarkCase.authority?.execution) fail("memory_release_prefilled_authority_execution_forbidden", [id]);
  }
  return corpus;
}

function recomputeReleaseEvaluation(input) {
  const corpus = validateReleaseInput(input);
  const corpusSha256 = sha256(corpus);
  if (corpus.corpusId !== APPROVED_RELEASE_CORPUS_ID) fail("memory_release_corpus_not_approved");
  if (corpusSha256 !== APPROVED_RELEASE_CORPUS_SHA256) fail("memory_release_corpus_sha_mismatch");
  const authorityAdapter = createMemoryAuthorityPolicyAdapter(memoryAuthorityPolicy, {
    id: "release-memory-authority-policy-v1",
  });
  const evaluation = evaluateMemoryBenchmark(corpus.cases, {
    k: 1,
    profile: "release",
    thresholds: RELEASE_MEMORY_EVALUATION_THRESHOLDS,
    strategyThresholds: MEMORY_EVALUATION_STRATEGY_THRESHOLDS,
    authorityAdapter,
  });
  return { corpus, evaluation, corpusSha256 };
}

function enforceEvaluationGate(input) {
  const { corpus, evaluation, corpusSha256 } = recomputeReleaseEvaluation(input);
  const failed = [
    ...(evaluation.gate.failedThresholds || []).map((item) => `retrieval:${item}`),
    ...(evaluation.strategyGate.failedThresholds || []).map((item) => `strategy:${item}`),
  ];
  if (!evaluation.releaseEligible || !evaluation.gate.passed || !evaluation.strategyGate.passed) {
    fail("memory_benchmark_gate_failed", failed.length ? failed : ["release_ineligible"]);
  }
  return {
    schemaVersion: "zhixia.synthetic_metric_policy_gate_receipt.v1",
    gateType: "synthetic_metric_policy_gate",
    status: "evaluation_only",
    releaseVerdict: "EVALUATION_ONLY",
    productReleaseEligible: false,
    corpusId: corpus.corpusId,
    corpusSha256,
    caseCount: evaluation.metrics.caseCount,
    metrics: evaluation.metrics,
    thresholds: evaluation.thresholds,
    strategyThresholds: evaluation.strategyThresholds,
    retrieval: "EVALUATION_ONLY",
    strategy: "EVALUATION_ONLY",
    metricPolicyPassed: true,
    productionRetrievalExecuted: false,
    recomputedFromStaticSyntheticCases: true,
    recomputedFromRawCases: false,
    acceptedInputVerdicts: false,
    compactReport: `EVALUATION_ONLY | synthetic metric/policy checks satisfied | cases=${evaluation.metrics.caseCount} | product retrieval not executed`,
  };
}

function validateRealExecutionInput(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("memory_real_execution_input_required");
  const forbidden = ["metrics", "gate", "strategyGate", "verdict", "releaseVerdict", "passed", "thresholds", "strategyThresholds"]
    .filter((key) => Object.hasOwn(input, key));
  if (forbidden.length > 0) fail("memory_real_execution_precomputed_verdict_forbidden", forbidden);
  if (input.schemaVersion !== REAL_EXECUTION_INPUT_SCHEMA) fail("memory_real_execution_schema_invalid");
  const corpus = input.corpus;
  if (!corpus || typeof corpus !== "object" || !Array.isArray(corpus.cases)) fail("memory_real_execution_corpus_required");
  if (options.requireReleaseCorpus !== false && (corpus.classification !== "curated_non_user_raw_retrieval_corpus"
      || !Array.isArray(corpus.documents) || corpus.documents.length < 100)) {
    fail("memory_real_execution_release_corpus_required");
  }
  if (options.requireReleaseCorpus !== false && (corpus.corpusId !== APPROVED_REAL_EXECUTION_CORPUS_ID
      || sha256(corpus) !== APPROVED_REAL_EXECUTION_CORPUS_SHA256)) {
    fail("memory_real_execution_corpus_not_approved");
  }
  if (corpus.cases.length < RELEASE_MEMORY_EVALUATION_THRESHOLDS.minimumCases) {
    fail("memory_real_execution_case_count_below_floor", [String(corpus.cases.length)]);
  }
  const execution = input.execution;
  if (!execution || typeof execution !== "object" || !Array.isArray(execution.cases)) {
    fail("memory_real_execution_results_required");
  }
  if (execution.cases.length !== corpus.cases.length) fail("memory_real_execution_case_count_mismatch");
  if (!input.binding || input.binding.verified !== true) fail("memory_real_execution_binding_unverified");
  const requiredBindings = [
    "sourceHead", "sourceStatusSha256", "corpusSha256", "corpusFileSha256", "executorSha256",
    "packageLockSha256", "toolchain", "harnessSources", "runtimeSources",
  ];
  for (const key of requiredBindings) {
    if (input.binding[key] == null || input.binding[key] === "") fail("memory_real_execution_binding_missing", [key]);
  }
  if (input.binding.corpusSha256 !== sha256(corpus)) fail("memory_real_execution_corpus_binding_mismatch");
  for (const key of ["sourceStatusSha256", "corpusSha256", "corpusFileSha256", "executorSha256", "packageLockSha256"]) {
    if (!/^[0-9a-f]{64}$/.test(String(input.binding[key]))) fail("memory_real_execution_binding_hash_invalid", [key]);
  }
  if (!/^[0-9a-f]{40,64}$/.test(String(input.binding.sourceHead))) fail("memory_real_execution_source_head_invalid");
  if (!Array.isArray(input.binding.harnessSources) || input.binding.harnessSources.length < 4) {
    fail("memory_real_execution_harness_binding_incomplete");
  }
  if (!Array.isArray(input.binding.runtimeSources) || input.binding.runtimeSources.length < 3) {
    fail("memory_real_execution_runtime_binding_incomplete");
  }
  const caseIds = new Set();
  for (const [index, benchmarkCase] of corpus.cases.entries()) {
    if (!benchmarkCase?.id || caseIds.has(benchmarkCase.id)) {
      fail(caseIds.has(benchmarkCase?.id) ? "memory_real_execution_corpus_case_duplicate" : "memory_real_execution_corpus_case_id_required", [String(index)]);
    }
    caseIds.add(benchmarkCase.id);
  }
  const executedIds = new Set();
  for (const [index, result] of execution.cases.entries()) {
    if (!result || typeof result !== "object" || result.id !== corpus.cases[index].id || executedIds.has(result.id)) {
      fail("memory_real_execution_case_identity_invalid", [String(index)]);
    }
    executedIds.add(result.id);
    if (!Array.isArray(result.results)) fail("memory_real_execution_case_results_required", [result.id]);
    if (!Number.isFinite(result.latencyMs) || result.latencyMs < 0) fail("memory_real_execution_latency_invalid", [result.id]);
    if (!Number.isFinite(result.tokenEstimate) || result.tokenEstimate < 0) fail("memory_real_execution_token_invalid", [result.id]);
    if (typeof result.empty !== "boolean" || typeof result.partial !== "boolean") {
      fail("memory_real_execution_completion_state_required", [result.id]);
    }
    if (result.error != null && typeof result.error !== "string") fail("memory_real_execution_error_invalid", [result.id]);
    const counts = result.productionAdapterCalls;
    if (!counts || ["retrieval", "project", "continuity", "context", "takeover"].some((key) => counts[key] !== 1)) {
      fail("memory_real_execution_production_adapter_not_invoked_once", [result.id]);
    }
  }
  return { corpus, execution };
}

function evaluateExecutedCases(corpus, execution, profile) {
  const errors = execution.cases.filter((item) => item.error).length;
  const empty = execution.cases.filter((item) => item.empty).length;
  const partial = execution.cases.filter((item) => item.partial).length;
  const authorityAdapter = createMemoryAuthorityPolicyAdapter(memoryAuthorityPolicy, {
    id: `${profile}-memory-authority-policy-v1`,
  });
  const evaluation = evaluateMemoryBenchmark(execution.cases, {
    k: 1,
    profile,
    thresholds: RELEASE_MEMORY_EVALUATION_THRESHOLDS,
    strategyThresholds: MEMORY_EVALUATION_STRATEGY_THRESHOLDS,
    authorityAdapter,
  });
  return { corpus, execution, evaluation, errors, empty, partial };
}

function executionSummary(execution, evaluation, errors, empty, partial) {
  return {
    attempted: execution.cases.length,
    completed: execution.cases.length - errors,
    errors,
    empty,
    partial,
    averageLatencyMs: evaluation.metrics.averageLatencyMs,
    p95LatencyMs: evaluation.metrics.p95LatencyMs,
    averageTokenEstimate: evaluation.metrics.averageTokenEstimate,
    p95TokenEstimate: evaluation.metrics.p95TokenEstimate,
  };
}

function enforceFixtureExecutionGate(input) {
  const { corpus, execution } = validateRealExecutionInput(input, { requireReleaseCorpus: false });
  const { evaluation, errors, empty, partial } = evaluateExecutedCases(corpus, execution, "test_fixture");
  return {
    schemaVersion: "zhixia.memory_fixture_execution_receipt.v1",
    gateType: "production_adapter_test_fixture",
    status: "test_fixture",
    releaseVerdict: "TEST_FIXTURE",
    productReleaseEligible: false,
    productionRetrievalExecuted: true,
    corpusId: corpus.corpusId,
    corpusSha256: input.binding.corpusSha256,
    caseCount: evaluation.metrics.caseCount,
    metrics: evaluation.metrics,
    executionSummary: executionSummary(execution, evaluation, errors, empty, partial),
    binding: input.binding,
    executionCasesSha256: sha256(execution.cases),
    acceptedInputVerdicts: false,
    compactReport: `TEST_FIXTURE | production adapters exercised against deterministic synthetic metadata | cases=${evaluation.metrics.caseCount}`,
  };
}

function enforceRealExecutionGate(input) {
  const { corpus, execution } = validateRealExecutionInput(input);
  const { evaluation, errors, empty, partial } = evaluateExecutedCases(corpus, execution, "release");
  const failed = [
    ...(evaluation.gate.failedThresholds || []).map((item) => `retrieval:${item}`),
    ...(evaluation.strategyGate.failedThresholds || []).map((item) => `strategy:${item}`),
    ...(errors > 0 ? [`execution_errors:${errors}`] : []),
    ...(empty > 0 ? [`empty_results:${empty}`] : []),
    ...(partial > 0 ? [`partial_results:${partial}`] : []),
  ];
  if (!evaluation.releaseEligible || failed.length > 0) fail("memory_real_execution_gate_failed", failed);
  return {
    schemaVersion: "zhixia.memory_real_execution_receipt.v1",
    gateType: "production_path_release_gate",
    status: "pass",
    releaseVerdict: "PASS",
    productReleaseEligible: true,
    productionRetrievalExecuted: true,
    corpusId: corpus.corpusId,
    corpusSha256: input.binding.corpusSha256,
    caseCount: evaluation.metrics.caseCount,
    metrics: evaluation.metrics,
    executionSummary: executionSummary(execution, evaluation, errors, empty, partial),
    binding: input.binding,
    executionCasesSha256: sha256(execution.cases),
    acceptedInputVerdicts: false,
    compactReport: evaluation.compactReport,
  };
}

function readEvaluation(argv = process.argv.slice(2)) {
  const fileArg = argv[0];
  const raw = fileArg ? fs.readFileSync(path.resolve(fileArg), "utf8") : fs.readFileSync(0, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 4 * 1024 * 1024) fail("memory_evaluation_json_too_large");
  return JSON.parse(raw);
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(enforceEvaluationGate(readEvaluation()))}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  APPROVED_RELEASE_CORPUS_ID,
  APPROVED_RELEASE_CORPUS_SHA256,
  APPROVED_REAL_EXECUTION_CORPUS_ID,
  APPROVED_REAL_EXECUTION_CORPUS_SHA256,
  REAL_EXECUTION_INPUT_SCHEMA,
  RELEASE_CORPUS_SCHEMA,
  RELEASE_INPUT_SCHEMA,
  enforceEvaluationGate,
  enforceFixtureExecutionGate,
  enforceRealExecutionGate,
  recomputeReleaseEvaluation,
  validateReleaseInput,
};
