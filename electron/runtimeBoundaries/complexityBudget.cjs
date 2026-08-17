const fs = require("node:fs");
const path = require("node:path");

const BOUNDARY_MODULE_BUDGET = Object.freeze({
  maxLines: 240,
  maxFunctions: 18,
  maxBranches: 55,
  maxRequires: 5,
});

const LEGACY_RATCHETS = Object.freeze({
  "electron/main.cjs": Object.freeze({ maxLines: 11800, maxFunctions: 440, maxIpcHandlers: 60, maxPersistenceCalls: 25 }),
  "electron/preload.cjs": Object.freeze({ maxLines: 120, maxFunctions: 4, maxIpcInvocations: 90 }),
  "src/App.tsx": Object.freeze({ maxLines: 8700, maxFunctions: 240, maxGuardianMentions: 180, maxAuthorityMentions: 80 }),
});

const TARGET_MODULE_FILES = Object.freeze([
  "electron/runtimeBoundaries/contracts.cjs",
  "electron/runtimeBoundaries/platformGuardianPort.cjs",
  "electron/runtimeBoundaries/authorityLifecyclePort.cjs",
  "electron/runtimeBoundaries/persistenceTransactionPort.cjs",
  "electron/runtimeBoundaries/strictReadonlyMemoryQueryPort.cjs",
  "electron/runtimeBoundaries/ipcFacade.cjs",
  "electron/runtimeBoundaries/runtimeBoundaryIntegration.cjs",
  "electron/runtimeBoundaries/complexityBudget.cjs",
]);

function count(source, expression) {
  return (source.match(expression) || []).length;
}

function measureSource(source, relativePath = "") {
  return {
    relativePath,
    lines: source.split(/\r?\n/).length,
    bytes: Buffer.byteLength(source),
    functions: count(source, /\b(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g),
    branches: count(source, /\bif\s*\(|\belse\b|\bswitch\s*\(|\bcase\s+|\bcatch\s*\(|\?[^?.]/g),
    requires: count(source, /\brequire\s*\(/g),
    ipcHandlers: count(source, /\bipcMain\.handle\s*\(/g),
    ipcInvocations: count(source, /\bipcRenderer\.invoke\s*\(/g),
    persistenceCalls: count(source, /\bsaveDatabase\s*\(/g),
    guardianMentions: count(source, /guardian/gi),
    authorityMentions: count(source, /authority/gi),
  };
}

function measureFile(root, relativePath) {
  return measureSource(fs.readFileSync(path.join(root, relativePath), "utf8"), relativePath);
}

function compareBudget(metrics, budget, mapping) {
  const exceeded = [];
  for (const [budgetKey, metricKey] of Object.entries(mapping)) {
    if (metrics[metricKey] > budget[budgetKey]) exceeded.push({ metric: metricKey, actual: metrics[metricKey], maximum: budget[budgetKey] });
  }
  return exceeded;
}

function assessBoundaryModule(metrics) {
  const exceeded = compareBudget(metrics, BOUNDARY_MODULE_BUDGET, {
    maxLines: "lines",
    maxFunctions: "functions",
    maxBranches: "branches",
    maxRequires: "requires",
  });
  return { ...metrics, classification: exceeded.length === 0 ? "within_target_budget" : "target_budget_exceeded", exceeded };
}

function assessLegacyFile(metrics) {
  const budget = LEGACY_RATCHETS[metrics.relativePath];
  if (!budget) throw new Error(`legacy_complexity_budget_missing:${metrics.relativePath}`);
  const mapping = {
    maxLines: "lines",
    maxFunctions: "functions",
    maxIpcHandlers: "ipcHandlers",
    maxIpcInvocations: "ipcInvocations",
    maxPersistenceCalls: "persistenceCalls",
    maxGuardianMentions: "guardianMentions",
    maxAuthorityMentions: "authorityMentions",
  };
  const exceeded = compareBudget(metrics, budget, Object.fromEntries(Object.keys(budget).map((key) => [key, mapping[key]])));
  const targetExceeded = metrics.lines > BOUNDARY_MODULE_BUDGET.maxLines || metrics.functions > BOUNDARY_MODULE_BUDGET.maxFunctions;
  return {
    ...metrics,
    classification: exceeded.length > 0 ? "legacy_ratchet_exceeded" : targetExceeded ? "legacy_over_target_within_ratchet" : "within_target_budget",
    exceeded,
  };
}

function buildComplexityReport(root) {
  const resolvedRoot = path.resolve(root);
  return {
    schemaVersion: "zhixia.runtime_boundary_complexity.v1",
    method: "deterministic_lexical_counts_not_ast_complexity",
    targetBudget: BOUNDARY_MODULE_BUDGET,
    boundaryModules: TARGET_MODULE_FILES.map((file) => assessBoundaryModule(measureFile(resolvedRoot, file))),
    legacy: Object.keys(LEGACY_RATCHETS).map((file) => assessLegacyFile(measureFile(resolvedRoot, file))),
  };
}

function assertComplexityBudgets(report) {
  const targetFailures = report.boundaryModules.filter((entry) => entry.classification !== "within_target_budget");
  const ratchetFailures = report.legacy.filter((entry) => entry.classification === "legacy_ratchet_exceeded");
  if (targetFailures.length || ratchetFailures.length) {
    const error = new Error("runtime_boundary_complexity_budget_failed");
    error.targetFailures = targetFailures;
    error.ratchetFailures = ratchetFailures;
    throw error;
  }
  return report;
}

module.exports = {
  BOUNDARY_MODULE_BUDGET,
  LEGACY_RATCHETS,
  TARGET_MODULE_FILES,
  assertComplexityBudgets,
  assessBoundaryModule,
  assessLegacyFile,
  buildComplexityReport,
  measureFile,
  measureSource,
};
