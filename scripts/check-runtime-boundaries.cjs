const path = require("node:path");
const { assertComplexityBudgets, buildComplexityReport } = require("../electron/runtimeBoundaries/complexityBudget.cjs");

try {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const report = assertComplexityBudgets(buildComplexityReport(root));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: String(error?.message || error),
    targetFailures: error?.targetFailures || [],
    ratchetFailures: error?.ratchetFailures || [],
  }, null, 2)}\n`);
  process.exitCode = 1;
}
