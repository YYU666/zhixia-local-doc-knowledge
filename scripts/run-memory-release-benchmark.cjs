const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const { buildMemoryReleaseCorpus } = require("../benchmarks/memory-release-corpus.cjs");
const {
  REAL_EXECUTION_INPUT_SCHEMA,
  RELEASE_INPUT_SCHEMA,
  enforceEvaluationGate,
  enforceFixtureExecutionGate,
  enforceRealExecutionGate,
} = require("./enforce-memory-benchmark-gate.cjs");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_CORPUS_SCHEMA = "zhixia.memory_real_executor_corpus.v2";
const FIXTURE_CORPUS_SCHEMA = "zhixia.memory_real_executor_corpus.v1";
const RELEASE_EXECUTOR_SCHEMA = "zhixia.memory_real_executor.v2";
const FIXTURE_EXECUTOR_SCHEMA = "zhixia.memory_real_executor.v1";
const ADAPTER_CONTRACT = Object.freeze({
  retrieval: { module: "electron/hybridMemoryRetrievalPolicy.cjs", exportName: "retrieveHybridMemory" },
  project: { module: "electron/projectBrainPolicy.cjs", exportName: "buildProjectBrain" },
  continuity: { module: "electron/projectBrainPolicy.cjs", exportName: "buildProjectContinuityPacket" },
  context: { module: "electron/memoryRuntimePolicy.cjs", exportName: "buildRuntimeContextPacket" },
  takeover: { module: "electron/memoryRuntimePolicy.cjs", exportName: "buildThreadRecoveryPacket" },
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(stableValue(value)));
  return crypto.createHash("sha256").update(input).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trimEnd();
}

function parseArgs(argv) {
  const options = { mode: "synthetic" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--real") options.mode = "real";
    else if (arg === "--fixture") options.mode = "fixture";
    else if (arg === "--synthetic") options.mode = "synthetic";
    else if (arg === "--corpus") options.corpus = argv[++index];
    else if (arg === "--executor") options.executor = argv[++index];
    else throw new Error(`memory_benchmark_argument_invalid:${arg}`);
  }
  return options;
}

function resolveInsideRoot(input, label) {
  if (!input) throw new Error(`memory_real_${label}_required`);
  const resolved = path.resolve(ROOT, input);
  const relative = path.relative(ROOT, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`memory_real_${label}_path_invalid`);
  return resolved;
}

function loadRealCorpus(filePath, mode) {
  if (path.extname(filePath).toLowerCase() !== ".json") throw new Error("memory_real_corpus_json_required");
  const corpus = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const expectedSchema = mode === "real" ? RELEASE_CORPUS_SCHEMA : FIXTURE_CORPUS_SCHEMA;
  if (!corpus || corpus.schemaVersion !== expectedSchema || !Array.isArray(corpus.cases)) {
    throw new Error("memory_real_corpus_schema_invalid");
  }
  if (mode === "real" && (corpus.classification !== "curated_non_user_raw_retrieval_corpus"
      || !Array.isArray(corpus.documents) || corpus.documents.length < 100)) {
    throw new Error("memory_real_corpus_release_classification_required");
  }
  if (mode === "fixture" && corpus.classification !== "deterministic_local_production_adapter_fixture") {
    throw new Error("memory_fixture_corpus_classification_required");
  }
  const forbidden = ["results", "latencyMs", "tokenEstimate", "partial", "empty", "error"];
  for (const benchmarkCase of corpus.cases) {
    const supplied = forbidden.filter((key) => Object.hasOwn(benchmarkCase, key));
    if (supplied.length > 0 || benchmarkCase.authority?.execution) {
      throw new Error(`memory_real_corpus_prefilled_execution_forbidden:${benchmarkCase.id || "unknown"}:${supplied.join(",")}`);
    }
  }
  return corpus;
}

function loadExecutor(filePath, mode) {
  const loaded = require(filePath);
  const expectedSchema = mode === "real" ? RELEASE_EXECUTOR_SCHEMA : FIXTURE_EXECUTOR_SCHEMA;
  if (loaded.schemaVersion !== expectedSchema || typeof loaded.createExecutor !== "function") {
    throw new Error("memory_real_executor_contract_invalid");
  }
  if (JSON.stringify(loaded.adapterContract) !== JSON.stringify(ADAPTER_CONTRACT)) {
    throw new Error("memory_real_executor_adapter_contract_invalid");
  }
  return loaded;
}

function productionAdapters() {
  const counts = Object.fromEntries(Object.keys(ADAPTER_CONTRACT).map((name) => [name, 0]));
  const outputs = Object.fromEntries(Object.keys(ADAPTER_CONTRACT).map((name) => [name, new WeakSet()]));
  const adapters = {};
  for (const [name, contract] of Object.entries(ADAPTER_CONTRACT)) {
    const sourcePath = path.join(ROOT, contract.module);
    const implementation = require(sourcePath)[contract.exportName];
    if (typeof implementation !== "function") throw new Error(`memory_real_adapter_export_missing:${name}`);
    adapters[name] = (...args) => {
      counts[name] += 1;
      const result = implementation(...args);
      if (result && typeof result === "object") outputs[name].add(result);
      return result;
    };
  }
  return { adapters, counts, outputs };
}

function deltaCounts(before, after) {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
}

function captureCandidateBinding(corpus, corpusPath, executorPath) {
  const statusText = git(["status", "--porcelain=v1"]);
  const harnessPaths = [
    "scripts/run-memory-release-benchmark.cjs",
    "scripts/enforce-memory-benchmark-gate.cjs",
    path.relative(ROOT, corpusPath),
    path.relative(ROOT, executorPath),
  ];
  const runtimePaths = [...new Set(Object.values(ADAPTER_CONTRACT).map(({ module }) => module))];
  return {
    verified: true,
    sourceHead: git(["rev-parse", "HEAD"]),
    sourceStatusSha256: sha256(Buffer.from(statusText, "utf8")),
    sourceStatusFormat: "git_status_porcelain_v1_without_terminal_newline",
    corpusPath: path.relative(ROOT, corpusPath),
    corpusSha256: sha256(corpus),
    corpusFileSha256: fileSha256(corpusPath),
    executorPath: path.relative(ROOT, executorPath),
    executorSha256: fileSha256(executorPath),
    packageLockSha256: fileSha256(path.join(ROOT, "package-lock.json")),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch },
    harnessSources: harnessPaths.map((relativePath) => ({ path: relativePath, sha256: fileSha256(path.join(ROOT, relativePath)) })),
    runtimeSources: runtimePaths.map((module) => ({ path: module, sha256: fileSha256(path.join(ROOT, module)) })),
  };
}

function assertCandidateBindingStable(before, after) {
  const comparable = (binding) => ({
    sourceHead: binding.sourceHead,
    sourceStatusSha256: binding.sourceStatusSha256,
    corpusSha256: binding.corpusSha256,
    corpusFileSha256: binding.corpusFileSha256,
    executorSha256: binding.executorSha256,
    packageLockSha256: binding.packageLockSha256,
    harnessSources: binding.harnessSources,
    runtimeSources: binding.runtimeSources,
    toolchain: binding.toolchain,
  });
  if (JSON.stringify(comparable(before)) !== JSON.stringify(comparable(after))) {
    throw new Error("memory_real_execution_candidate_drift_during_run");
  }
}

function deriveExecutedCase(benchmarkCase, result, latencyMs, calls, trustedOutputs, error) {
  const productionOutputs = result?.productionOutputs;
  if (!error && (!productionOutputs || Object.keys(ADAPTER_CONTRACT).some((name) => !trustedOutputs[name].has(productionOutputs[name])))) {
    error = new Error("memory_real_executor_untrusted_production_output");
  }
  const retrieval = productionOutputs?.retrieval;
  const continuityPacket = productionOutputs?.continuity;
  const context = productionOutputs?.context;
  const takeover = productionOutputs?.takeover;
  const expected = benchmarkCase.expectedContinuity || {};
  const results = Array.isArray(retrieval?.items) ? retrieval.items : [];
  return {
    ...benchmarkCase,
    results,
    latencyMs: Math.round(latencyMs * 1000) / 1000,
    tokenEstimate: Number.isFinite(Number(context?.tokenEstimate)) ? Number(context.tokenEstimate) : 0,
    empty: results.length === 0,
    partial: retrieval?.items?.length !== 1 || context?.partial === true,
    error: error ? String(error.code || error.message || error).slice(0, 180) : null,
    continuity: {
      mandatorySlots: expected.mandatorySlots || [],
      filledSlots: continuityPacket?.continuity?.filledSlots || [],
      criticalSlots: expected.criticalSlots || [],
      takeoverCase: expected.takeoverCase === true,
      takeoverSuccessful: expected.takeoverCase === true
        ? takeover?.context?.itemCount > 0 && takeover?.performance?.rawSessionBodyRead === false
        : false,
      expectedProject: expected.expectedProject || "",
      resolvedProject: productionOutputs?.project?.aliases?.includes(expected.expectedProject) ? expected.expectedProject : "",
      expectedModule: expected.expectedModule || "",
      resolvedModule: continuityPacket?.continuity?.slots?.active_modules?.items?.some((item) => item.title === expected.expectedModule)
        ? expected.expectedModule
        : "",
    },
    compound: result?.compound || undefined,
    productionAdapterCalls: calls,
  };
}

function executorCaseInput(benchmarkCase) {
  return Object.freeze({
    id: benchmarkCase.id,
    query: benchmarkCase.query,
    project: benchmarkCase.project,
    queryType: benchmarkCase.queryType,
    scenario: benchmarkCase.scenario,
    crossWording: benchmarkCase.crossWording === true,
  });
}

async function runReal(options) {
  const corpusPath = resolveInsideRoot(options.corpus, "corpus");
  const executorPath = resolveInsideRoot(options.executor, "executor");
  const corpus = loadRealCorpus(corpusPath, options.mode);
  const executorModule = loadExecutor(executorPath, options.mode);
  const binding = captureCandidateBinding(corpus, corpusPath, executorPath);
  const { adapters, counts, outputs } = productionAdapters();
  const executorCorpus = options.mode === "real" ? Object.freeze({ documents: corpus.documents }) : undefined;
  const executor = executorModule.createExecutor({ adapters, corpus: executorCorpus, root: ROOT });
  if (!executor || typeof executor.executeCase !== "function") throw new Error("memory_real_executor_missing_execute_case");
  const executedCases = [];
  for (const benchmarkCase of corpus.cases) {
    const before = { ...counts };
    const startedAt = performance.now();
    let result;
    let error = null;
    try {
      result = await executor.executeCase(options.mode === "real"
        ? executorCaseInput(benchmarkCase)
        : Object.freeze(structuredClone(benchmarkCase)));
    } catch (caught) {
      error = caught;
    }
    executedCases.push(deriveExecutedCase(
      benchmarkCase,
      result,
      performance.now() - startedAt,
      deltaCounts(before, counts),
      outputs,
      error,
    ));
  }
  assertCandidateBindingStable(binding, captureCandidateBinding(corpus, corpusPath, executorPath));
  const input = {
    schemaVersion: REAL_EXECUTION_INPUT_SCHEMA,
    corpus,
    execution: { cases: executedCases },
    binding,
  };
  return options.mode === "fixture" ? enforceFixtureExecutionGate(input) : enforceRealExecutionGate(input);
}

function notRunReceipt(error) {
  return {
    schemaVersion: "zhixia.memory_real_execution_receipt.v1",
    gateType: "production_path_release_gate",
    status: "not_run",
    releaseVerdict: "NOT_RUN",
    productReleaseEligible: false,
    productionRetrievalExecuted: false,
    reason: String(error?.code || error?.message || error).slice(0, 240),
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.mode === "synthetic") {
    return enforceEvaluationGate({ schemaVersion: RELEASE_INPUT_SCHEMA, corpus: buildMemoryReleaseCorpus() });
  }
  return runReal(options);
}

if (require.main === module) {
  main().then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify(notRunReceipt(error), null, 2)}\n`);
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { ADAPTER_CONTRACT, main, notRunReceipt, parseArgs, runReal };
