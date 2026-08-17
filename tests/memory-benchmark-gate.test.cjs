const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  RELEASE_CORPUS_PATH,
  buildMemoryReleaseCorpus,
} = require("../benchmarks/memory-release-corpus.cjs");
const {
  APPROVED_RELEASE_CORPUS_SHA256,
  REAL_EXECUTION_INPUT_SCHEMA,
  RELEASE_INPUT_SCHEMA,
  enforceEvaluationGate,
  enforceRealExecutionGate,
} = require("../scripts/enforce-memory-benchmark-gate.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-gate-"));
const script = path.resolve(__dirname, "..", "scripts", "enforce-memory-benchmark-gate.cjs");
const repositoryRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const ciWorkflow = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
const releaseCorpus = "benchmarks/memory-production-release-corpus.v2.json";
const releaseExecutor = "benchmarks/memory-production-release-executor.cjs";
const fixtureCorpus = "benchmarks/memory-production-fixture-corpus.v1.json";
const fixtureExecutor = "benchmarks/memory-production-fixture-executor.cjs";
const realGateCommand = `node scripts/run-memory-release-benchmark.cjs --real --corpus ${releaseCorpus} --executor ${releaseExecutor}`;

function releaseInput(corpus = buildMemoryReleaseCorpus()) {
  return { schemaVersion: RELEASE_INPUT_SCHEMA, corpus };
}

try {
  assert.equal(packageJson.scripts["memory:gate"], realGateCommand, "the default package memory gate must execute the 120-case production adapter corpus");
  assert.equal(packageJson.scripts["memory:evaluate:synthetic"], "node scripts/run-memory-release-benchmark.cjs --synthetic", "synthetic metrics must have an explicit evaluation-only command");
  assert.match(packageJson.scripts["memory:evaluate:production-fixture"], /--fixture/, "deterministic production-path fixture must have a non-release command");
  assert.match(packageJson.scripts.test, /npm run memory:gate/, "npm test must execute the real production-path memory gate");
  assert.doesNotMatch(packageJson.scripts.test, /node scripts\/run-memory-release-benchmark\.cjs(?:\s*&&|$)/, "npm test must not execute the runner's synthetic default path");
  assert.match(packageJson.scripts["dist:mac"], /^npm run memory:gate && /, "Mac packaging must fail before build/package when the real memory gate fails");
  assert.match(packageJson.scripts["verify:release-candidate"], /^npm run memory:gate && /, "release candidate verification must require the real memory gate");
  assert.ok(ciWorkflow.indexOf("- run: npm test") > ciWorkflow.indexOf("- run: npm ci"), "CI must run the default suite containing the real memory gate after dependency installation");

  assert.equal(
    fs.readFileSync(path.join(__dirname, "..", "benchmarks", "memory-release-corpus.cjs"), "utf8")
      .includes("buildSyntheticMemoryEvaluationFixture"),
    false,
    "the release gate must load a frozen raw corpus instead of regenerating it from the evaluator",
  );
  assert.equal(path.extname(RELEASE_CORPUS_PATH), ".json");
  assert.equal(buildMemoryReleaseCorpus().provenance.generation, "frozen_raw_cases_not_generated_at_gate_runtime");

  const forgedPassed = {
    gate: { passed: true, failedThresholds: [] },
    strategyGate: { passed: true, failedThresholds: [] },
    metrics: { caseCount: 0, precisionAtK: 0 },
  };
  assert.throws(
    () => enforceEvaluationGate(forgedPassed),
    /memory_release_precomputed_verdict_forbidden|memory_release_input_schema_invalid/,
    "precomputed passed booleans and metrics must never authorize a release",
  );

  const forgedPath = path.join(root, "forged-pass.json");
  fs.writeFileSync(forgedPath, JSON.stringify(forgedPassed), "utf8");
  const forgedRun = spawnSync(process.execPath, [script, forgedPath], { encoding: "utf8" });
  assert.notEqual(forgedRun.status, 0, "forged caseCount=0/precision=0 release packet must fail closed");
  assert.match(forgedRun.stderr, /precomputed_verdict_forbidden|input_schema_invalid/);

  const tooSmall = buildMemoryReleaseCorpus();
  tooSmall.cases = tooSmall.cases.slice(0, 4);
  assert.throws(
    () => enforceEvaluationGate(releaseInput(tooSmall)),
    /memory_release_case_count_below_floor:4/,
    "four-case fixtures cannot generate a release PASS",
  );

  const zeroPrecision = buildMemoryReleaseCorpus();
  zeroPrecision.cases = zeroPrecision.cases.map((benchmarkCase, index) => ({
    ...benchmarkCase,
    results: [{ id: `release-distractor-${index + 1}`, tags: ["irrelevant"] }],
  }));
  assert.throws(
    () => enforceEvaluationGate(releaseInput(zeroPrecision)),
    /memory_release_corpus_sha_mismatch/,
    "a rewritten low-precision corpus must not replace the approved raw release corpus",
  );

  const trivialForgedCorpus = buildMemoryReleaseCorpus();
  trivialForgedCorpus.cases = trivialForgedCorpus.cases.map((benchmarkCase, index) => ({
    ...benchmarkCase,
    expectedIds: [`trivial-${index}`],
    results: [{ id: `trivial-${index}`, tags: benchmarkCase.expectedTags || [] }],
  }));
  assert.throws(
    () => enforceEvaluationGate(releaseInput(trivialForgedCorpus)),
    /memory_release_corpus_sha_mismatch/,
    "an easy replacement corpus must not obtain a release PASS",
  );

  const corpus = buildMemoryReleaseCorpus();
  const passing = enforceEvaluationGate(releaseInput(corpus));
  assert.equal(passing.gateType, "synthetic_metric_policy_gate");
  assert.equal(passing.status, "evaluation_only");
  assert.equal(passing.releaseVerdict, "EVALUATION_ONLY");
  assert.equal(passing.productReleaseEligible, false);
  assert.equal(passing.productionRetrievalExecuted, false);
  assert.equal(passing.recomputedFromStaticSyntheticCases, true);
  assert.equal(passing.recomputedFromRawCases, false);
  assert.equal(passing.acceptedInputVerdicts, false);
  assert.equal(passing.caseCount, 120);
  assert.equal(passing.corpusSha256, APPROVED_RELEASE_CORPUS_SHA256);
  assert.ok(passing.metrics.precisionAtK >= 0.5);
  assert.equal(passing.metrics.authorityThreatCoverage, 1);
  assert.equal(passing.metrics.authorityPositiveControlCoverage, 1);
  assert.equal(passing.metrics.authorityEvidenceVerificationRate, 1);

  const passPath = path.join(root, "raw-corpus.json");
  fs.writeFileSync(passPath, JSON.stringify(releaseInput(corpus)), "utf8");
  const passedRun = spawnSync(process.execPath, [script, passPath], { encoding: "utf8" });
  assert.equal(passedRun.status, 0, passedRun.stderr);
  assert.match(passedRun.stdout, /"releaseVerdict":"EVALUATION_ONLY"/);
  assert.match(passedRun.stdout, /"recomputedFromStaticSyntheticCases":true/);

  const runner = path.resolve(__dirname, "..", "scripts", "run-memory-release-benchmark.cjs");
  const syntheticRun = spawnSync(process.execPath, [runner, "--synthetic"], { encoding: "utf8" });
  assert.equal(syntheticRun.status, 0, syntheticRun.stderr);
  const syntheticReceipt = JSON.parse(syntheticRun.stdout);
  assert.equal(syntheticReceipt.gateType, "synthetic_metric_policy_gate");
  assert.equal(syntheticReceipt.releaseVerdict, "EVALUATION_ONLY");
  assert.equal(JSON.stringify(syntheticReceipt).includes("PASS"), false, "synthetic output must contain no product or retrieval PASS token");

  const missingExecutor = spawnSync(process.execPath, [runner, "--real", "--corpus", releaseCorpus], { encoding: "utf8" });
  assert.notEqual(missingExecutor.status, 0, "missing real executor must fail closed");
  const missingReceipt = JSON.parse(missingExecutor.stdout);
  assert.equal(missingReceipt.status, "not_run");
  assert.equal(missingReceipt.releaseVerdict, "NOT_RUN");
  assert.equal(missingReceipt.productReleaseEligible, false);

  const prefilledCorpusPath = path.join(__dirname, "..", "benchmarks", ".memory-prefilled-negative.json");
  const forgedExecutorPath = path.join(__dirname, "..", "benchmarks", ".memory-forged-executor-negative.cjs");
  const driftingExecutorPath = path.join(__dirname, "..", "benchmarks", ".memory-drifting-executor-negative.cjs");
  const leakedExpectedExecutorPath = path.join(__dirname, "..", "benchmarks", ".memory-leaked-expected-negative.cjs");
  try {
    const approvedCorpus = JSON.parse(fs.readFileSync(path.join(repositoryRoot, releaseCorpus), "utf8"));
    approvedCorpus.corpusId = "prefilled-negative";
    approvedCorpus.cases[0].results = [{ id: "x" }];
    fs.writeFileSync(prefilledCorpusPath, JSON.stringify(approvedCorpus), "utf8");
    const prefilledRun = spawnSync(process.execPath, [
      runner, "--real", "--corpus", path.relative(path.join(__dirname, ".."), prefilledCorpusPath),
      "--executor", releaseExecutor,
    ], { encoding: "utf8" });
    assert.notEqual(prefilledRun.status, 0, "a real raw corpus with prefilled results must fail closed");
    assert.match(prefilledRun.stderr, /memory_real_corpus_prefilled_execution_forbidden/);

    fs.writeFileSync(forgedExecutorPath, `
const base=require("./memory-production-release-executor.cjs");
module.exports={schemaVersion:base.schemaVersion,adapterContract:base.adapterContract,createExecutor({adapters}){return{async executeCase(testCase){
  adapters.retrieval([{id:testCase.expectedIds[0],title:testCase.query,summary:testCase.query,status:"accepted",freshness:"fresh",projectPath:testCase.project}],testCase.query,{projectPath:testCase.project,strictProject:true,topK:1});
  adapters.project({canonicalPath:"/synthetic/forged",aliases:["forged"]});
  adapters.continuity({canonicalPath:"/synthetic/forged",aliases:["forged"]});
  adapters.context({items:[]},{taskGoal:testCase.query});
  adapters.takeover({title:testCase.query});
  return {productionOutputs:{retrieval:{items:[{id:testCase.expectedIds[0]}]},project:{},continuity:{},context:{tokenEstimate:1},takeover:{}},compound:testCase.expectedCompound};
}}}};\n`, "utf8");
    const forgedExecutorRun = spawnSync(process.execPath, [
      runner, "--real", "--corpus", releaseCorpus,
      "--executor", path.relative(path.join(__dirname, ".."), forgedExecutorPath),
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.notEqual(forgedExecutorRun.status, 0, "an executor cannot replace controlled production outputs with self-reported objects");
    assert.match(forgedExecutorRun.stderr, /memory_real_execution_(?:gate_failed|production_adapter_not_invoked_once)|memory_real_executor_untrusted_production_output/);

    fs.writeFileSync(leakedExpectedExecutorPath, `
const base=require("./memory-production-release-executor.cjs");
module.exports={schemaVersion:base.schemaVersion,adapterContract:base.adapterContract,createExecutor(options){const delegate=base.createExecutor(options);return{async executeCase(testCase){if(Object.hasOwn(testCase,"expectedIds")||Object.hasOwn(testCase,"expectedTags")||Object.hasOwn(testCase,"expectedContinuity")){throw new Error("expected-answer-leaked");}return delegate.executeCase(testCase);}}}};\n`, "utf8");
    const noLeakRun = spawnSync(process.execPath, [
      runner, "--real", "--corpus", releaseCorpus,
      "--executor", path.relative(repositoryRoot, leakedExpectedExecutorPath),
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.equal(noLeakRun.status, 0, noLeakRun.stderr);
    assert.equal(JSON.parse(noLeakRun.stdout).releaseVerdict, "PASS", "executor must not receive expected answers or continuity judgments");

    fs.writeFileSync(driftingExecutorPath, `
const fs=require("node:fs"); const base=require("./memory-production-release-executor.cjs");
module.exports={schemaVersion:base.schemaVersion,adapterContract:base.adapterContract,createExecutor(options){const delegate=base.createExecutor(options);let changed=false;return{async executeCase(testCase){const result=await delegate.executeCase(testCase);if(!changed){fs.appendFileSync(__filename,"\\n// drift-during-run\\n");changed=true;}return result;}}}};\n`, "utf8");
    const driftingRun = spawnSync(process.execPath, [
      runner, "--real", "--corpus", releaseCorpus,
      "--executor", path.relative(path.join(__dirname, ".."), driftingExecutorPath),
    ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.notEqual(driftingRun.status, 0, "executor/source drift during a run must invalidate the receipt");
    assert.match(driftingRun.stderr, /memory_real_execution_candidate_drift_during_run/);
  } finally {
    fs.rmSync(prefilledCorpusPath, { force: true });
    fs.rmSync(forgedExecutorPath, { force: true });
    fs.rmSync(driftingExecutorPath, { force: true });
    fs.rmSync(leakedExpectedExecutorPath, { force: true });
  }

  const realRun = spawnSync(process.execPath, [
    runner,
    "--real",
    "--corpus", releaseCorpus,
    "--executor", releaseExecutor,
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(realRun.status, 0, realRun.stderr);
  const realReceipt = JSON.parse(realRun.stdout);
  assert.equal(realReceipt.gateType, "production_path_release_gate");
  assert.equal(realReceipt.releaseVerdict, "PASS");
  assert.equal(realReceipt.productReleaseEligible, true);
  assert.equal(realReceipt.productionRetrievalExecuted, true);
  assert.equal(realReceipt.caseCount, 120);
  assert.deepEqual(
    { errors: realReceipt.executionSummary.errors, empty: realReceipt.executionSummary.empty, partial: realReceipt.executionSummary.partial },
    { errors: 0, empty: 0, partial: 0 },
  );
  assert.equal(realReceipt.binding.runtimeSources.length, 3);
  assert.match(realReceipt.binding.sourceHead, /^[0-9a-f]{40,64}$/);
  assert.match(realReceipt.binding.sourceStatusSha256, /^[0-9a-f]{64}$/);
  assert.match(realReceipt.binding.corpusSha256, /^[0-9a-f]{64}$/);
  assert.match(realReceipt.binding.executorSha256, /^[0-9a-f]{64}$/);
  assert.match(realReceipt.binding.packageLockSha256, /^[0-9a-f]{64}$/);

  const fixtureRun = spawnSync(process.execPath, [runner, "--fixture", "--corpus", fixtureCorpus, "--executor", fixtureExecutor], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
  const fixtureReceipt = JSON.parse(fixtureRun.stdout);
  assert.equal(fixtureReceipt.releaseVerdict, "TEST_FIXTURE");
  assert.equal(fixtureReceipt.productReleaseEligible, false);

  const forgedRealInput = {
    schemaVersion: REAL_EXECUTION_INPUT_SCHEMA,
    metrics: { caseCount: 0, precisionAtK: 0 },
    verdict: "PASS",
    releaseVerdict: "PASS",
    gate: { passed: true },
  };
  assert.throws(
    () => enforceRealExecutionGate(forgedRealInput),
    /memory_real_execution_precomputed_verdict_forbidden/,
    "real execution inputs carrying precomputed metrics or verdicts must fail closed",
  );

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const packageGateRun = spawnSync(npmCommand, ["run", "--silent", "memory:gate"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(packageGateRun.status, 0, packageGateRun.stderr);
  const packageGateReceipt = JSON.parse(packageGateRun.stdout);
  assert.equal(packageGateReceipt.gateType, "production_path_release_gate", "npm run memory:gate must invoke the real adapter gate");
  assert.equal(packageGateReceipt.releaseVerdict, "PASS");
  assert.equal(packageGateReceipt.caseCount, 120);
  assert.equal(packageGateReceipt.executionSummary.attempted, 120);
  assert.equal(packageGateReceipt.executionSummary.errors, 0);
  assert.equal(packageGateReceipt.executionSummary.empty, 0);
  assert.equal(packageGateReceipt.executionSummary.partial, 0);

  assert.throws(
    () => enforceRealExecutionGate({ schemaVersion: REAL_EXECUTION_INPUT_SCHEMA }),
    /memory_real_execution_corpus_required/,
    "a missing real execution result can never obtain release PASS",
  );
  console.log("Memory benchmark release gate tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
