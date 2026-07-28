const fs = require("node:fs");
const path = require("node:path");

function enforceEvaluationGate(evaluation) {
  if (!evaluation || typeof evaluation !== "object") throw new Error("memory_evaluation_json_required");
  const retrievalPassed = evaluation.gate?.passed === true;
  const strategyPassed = evaluation.strategyGate?.passed === true;
  if (!retrievalPassed || !strategyPassed) {
    const failed = [
      ...(evaluation.gate?.failedThresholds || []).map((item) => `retrieval:${item}`),
      ...(evaluation.strategyGate?.failedThresholds || []).map((item) => `strategy:${item}`),
    ];
    const error = new Error(`memory_benchmark_gate_failed:${failed.join(",") || "unknown"}`);
    error.code = "MEMORY_BENCHMARK_GATE_FAILED";
    throw error;
  }
  return { status: "pass", retrieval: "PASS", strategy: "PASS" };
}

function readEvaluation(argv = process.argv.slice(2)) {
  const fileArg = argv[0];
  const raw = fileArg ? fs.readFileSync(path.resolve(fileArg), "utf8") : fs.readFileSync(0, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 4 * 1024 * 1024) throw new Error("memory_evaluation_json_too_large");
  return JSON.parse(raw);
}

function main() {
  try {
    const verdict = enforceEvaluationGate(readEvaluation());
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { enforceEvaluationGate };
