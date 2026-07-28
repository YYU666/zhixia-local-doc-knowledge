const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { enforceEvaluationGate } = require("../scripts/enforce-memory-benchmark-gate.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-gate-"));
const script = path.resolve(__dirname, "..", "scripts", "enforce-memory-benchmark-gate.cjs");
try {
  const passing = { gate: { passed: true, failedThresholds: [] }, strategyGate: { passed: true, failedThresholds: [] } };
  assert.equal(enforceEvaluationGate(passing).strategy, "PASS");

  const failing = { gate: { passed: true, failedThresholds: [] }, strategyGate: { passed: false, failedThresholds: ["minimumCases"] } };
  assert.throws(() => enforceEvaluationGate(failing), /memory_benchmark_gate_failed:strategy:minimumCases/);
  const failPath = path.join(root, "strategy-fail.json");
  fs.writeFileSync(failPath, JSON.stringify(failing), "utf8");
  const failedRun = spawnSync(process.execPath, [script, failPath], { encoding: "utf8" });
  assert.notEqual(failedRun.status, 0, "strategy=FAIL must produce a nonzero release/CI exit");
  assert.match(failedRun.stderr, /strategy:minimumCases/);

  const passPath = path.join(root, "strategy-pass.json");
  fs.writeFileSync(passPath, JSON.stringify(passing), "utf8");
  const passedRun = spawnSync(process.execPath, [script, passPath], { encoding: "utf8" });
  assert.equal(passedRun.status, 0, passedRun.stderr);
  assert.match(passedRun.stdout, /"strategy":"PASS"/);
  console.log("Memory benchmark release gate tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
