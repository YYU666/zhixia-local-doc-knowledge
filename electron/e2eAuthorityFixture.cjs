const path = require("node:path");

function seedE2EAuthorityBaseline({ executeRuntime, projectPath, storeRoot }) {
  const scan = executeRuntime({ operation: "scan", workspace: projectPath, storeRoot });
  const before = executeRuntime({ operation: "verify", workspace: projectPath, storeRoot });
  if (before.recoveryReady !== true) {
    executeRuntime({
      operation: "seed", workspace: projectPath, storeRoot, execute: true, expectedScanSha256: scan.scanSha256,
      projectName: path.basename(projectPath), moduleId: "electron-authority-e2e",
      continuity: {
        originalGoal: "Verify the ordinary Electron authority lifecycle end to end.",
        phase: "electron authority lifecycle e2e",
        projectSummary: "Isolated fixture for exact source review and app-owned binding refresh.",
        architectureAnchors: ["The generic Runtime CLI cannot mint accepted-evidence receipts."],
        standingRules: ["Only explicit source-backed UI acceptance may refresh authority."],
        acceptanceCriteria: ["Review, receipt, checkpoint, scan, generation, and reverify must agree."],
        safetyRules: ["Never use production user data or expose the receipt issuer to the renderer."],
        acceptedProgress: ["The isolated baseline is ready."], openTasks: ["Exercise the ordinary UI acceptance flow."],
        nextActions: ["Review docs/CEO_FLOW_HANDOFF.md and refresh the exact binding."], threadLineage: ["electron-authority-e2e"],
      },
    });
  }
  return executeRuntime({ operation: "verify", workspace: projectPath, storeRoot });
}

module.exports = { seedE2EAuthorityBaseline };
