const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { execute } = require("../electron/memoryRuntimeCli.cjs");
const { listMemoryRuntimeTriggerReceipts } = require("../electron/memoryRuntimeIndexStore.cjs");

const appRoot = path.resolve(__dirname, "..");
const serverPath = process.env.ZHIXIA_CONTROL_MCP_SERVER
  ? path.resolve(process.env.ZHIXIA_CONTROL_MCP_SERVER)
  : path.join(appRoot, "codex-skills", "zhixia-local-docs", "scripts", "codex-control-mcp.cjs");
const runtimePath = path.join(appRoot, "electron", "memoryRuntimeCli.cjs");

function createClient(env, cwd = appRoot) {
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message);
  });
  let nextId = 1;
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP timeout for ${method}; stderr=${stderr}`));
        }, 10_000);
        pending.set(id, { resolve: (message) => { clearTimeout(timer); resolve(message); } });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      child.stdin.end();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`MCP server did not exit; stderr=${stderr}`));
        }, 3000);
        child.once("exit", (code) => {
          clearTimeout(timer);
          assert.equal(code, 0, `MCP server failed: ${stderr}`);
          resolve();
        });
      });
    },
  };
}

function seedReadyProject(workspace, storeRoot, projectName, relativePaths = []) {
  const scan = execute({ operation: "scan", workspace, storeRoot, relativePaths });
  const seeded = execute({
    operation: "seed",
    workspace,
    storeRoot,
    execute: true,
    expectedScanSha256: scan.scanSha256,
    relativePaths,
    projectName,
    moduleId: "portfolio-ready",
    continuity: {
      originalGoal: `${projectName} provides independently verified project context.`,
      phase: "portfolio bootstrap acceptance",
      projectSummary: `${projectName} has a complete app-owned recovery checkpoint.`,
      architectureAnchors: ["Every portfolio project keeps an independent authority envelope."],
      standingRules: ["Never infer project roots from raw chat, cwd, or artifact directories."],
      acceptanceCriteria: ["Only current scan-matched projects may return compact context."],
      safetyRules: ["Never persist raw sessions, credentials, images, SQLite, or complete logs."],
      acceptedProgress: ["The bounded read-only portfolio bootstrap contract is accepted."],
      openTasks: ["Continue source-backed project work from independently verified context."],
      openBlockers: ["No accepted blocker is shared across project authority boundaries."],
      latestFailures: ["A stale project must not block or contaminate a ready project."],
      nextActions: ["Retrieve this project lazily within its strict per-project budget."],
      threadLineage: ["portfolio-ready-task"],
    },
  });
  assert.equal(seeded.current, true, JSON.stringify(seeded));
  assert.equal(seeded.recoveryReady, true, JSON.stringify(seeded));
  return seeded;
}

function snapshotFileContents(root) {
  const entries = [];
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isDirectory()) visit(absolutePath);
      else if (stat.isFile()) {
        entries.push({
          path: path.relative(root, absolutePath),
          bytes: stat.size,
          sha256: crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex"),
        });
      }
    }
  };
  if (fs.existsSync(root)) visit(root);
  return entries;
}

async function main() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-codex-control-")));
  const workspace = path.join(root, "workspace");
  const secondReadyWorkspace = path.join(root, "second-ready-workspace");
  const staleWorkspace = path.join(root, "stale-workspace");
  const neutralArtifactRoot = path.join(root, "neutral-report-artifacts");
  const storeRoot = path.join(root, "memory-runtime");
  const fakeApp = path.join(root, "知匣.app");
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.mkdirSync(path.join(staleWorkspace, "docs"), { recursive: true });
  fs.mkdirSync(path.join(secondReadyWorkspace, "docs"), { recursive: true });
  fs.mkdirSync(neutralArtifactRoot, { recursive: true });
  fs.mkdirSync(fakeApp, { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "PRD.md"), "# Codex control MCP acceptance\n", "utf8");
  fs.writeFileSync(path.join(workspace, "src", "accepted-source.ts"), "export const accepted = true;\n", "utf8");
  fs.writeFileSync(path.join(staleWorkspace, "docs", "PRD.md"), "# Stale project remains isolated\n", "utf8");
  fs.writeFileSync(path.join(secondReadyWorkspace, "docs", "PRD.md"), "# Second independently ready project\n", "utf8");
  const client = createClient({
    ...(process.env.ZHIXIA_CONTROL_USE_PACKAGED_RUNTIME === "1" ? {} : { ZHIXIA_MEMORY_RUNTIME_CLI: runtimePath }),
    ZHIXIA_MEMORY_RUNTIME_ROOT: storeRoot,
    ZHIXIA_CONTROL_APP_PATH: fakeApp,
    ZHIXIA_CONTROL_DISABLE_APP_OPEN: "1",
  }, neutralArtifactRoot);

  try {
    const initialize = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex-control-test", version: "1.0.0" },
    });
    assert.equal(initialize.result.serverInfo.name, "zhixia-control");
    assert.equal(initialize.result.serverInfo.version, "1.4.0");
    client.notify("notifications/initialized");

    const listed = await client.request("tools/list");
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["open_app", "scan_workspace", "verify_project", "retrieve_context", "portfolio_context", "prepare_takeover", "stage_accepted_slice", "reconcile_accepted_slices", "writeback_evidence", "refresh_binding"],
    );
    const takeoverTool = listed.result.tools.find((tool) => tool.name === "prepare_takeover");
    assert.equal(takeoverTool.inputSchema.properties.tokenBudget.maximum, 10000);
    assert.equal(takeoverTool.inputSchema.properties.maxTokenBudget.maximum, 10000);
    assert.equal(takeoverTool.inputSchema.properties.strictTokenBudget.type, "boolean");
    const portfolioTool = listed.result.tools.find((tool) => tool.name === "portfolio_context");
    assert.equal(portfolioTool.annotations.readOnlyHint, true);
    assert.equal(portfolioTool.inputSchema.properties.workspaces.minItems, 2);
    assert.equal(portfolioTool.inputSchema.properties.workspaces.maxItems, 6);
    assert.equal(portfolioTool.inputSchema.properties.maxTotalTokenBudget.maximum, 10000);

    const opened = await client.request("tools/call", {
      name: "open_app",
      arguments: { workspace },
    });
    assert.equal(opened.result.isError, false);
    assert.equal(opened.result.structuredContent.status, "disabled_for_test");

    const scanned = await client.request("tools/call", {
      name: "scan_workspace",
      arguments: { workspace, relativePaths: ["src/accepted-source.ts"] },
    });
    assert.equal(scanned.result.isError, false);
    assert.equal(scanned.result.structuredContent.operation, "scan");
    assert.equal(scanned.result.structuredContent.app.status, "disabled_for_test");
    assert.match(scanned.result.structuredContent.scanSha256, /^[a-f0-9]{64}$/);
    assert.ok(
      scanned.result.structuredContent.sourceRefs.some((ref) => ref.title === "src/accepted-source.ts"),
      "Codex control must forward bounded explicit scan pins to the app-owned Runtime",
    );
    assert.ok(Buffer.byteLength(JSON.stringify(scanned.result.structuredContent), "utf8") < 16 * 1024,
      "scan_workspace must return one compact model-facing structure");
    assert.ok(scanned.result.content[0].text.length < 800,
      "the MCP text channel must contain only a short receipt instead of duplicating structured output");

    const verified = await client.request("tools/call", {
      name: "verify_project",
      arguments: { workspace, taskGoal: "Verify Codex control", relativePaths: ["src/accepted-source.ts"] },
    });
    assert.equal(verified.result.isError, false);
    assert.equal(verified.result.structuredContent.operation, "verify");
    assert.equal(verified.result.structuredContent.current, false);

    const source = scanned.result.structuredContent.sourceRefs.find((ref) => ref.title === "docs/PRD.md");
    const writeback = await client.request("tools/call", {
      name: "writeback_evidence",
      arguments: {
        workspace,
        execute: true,
        expectedProjectIdentitySha256: scanned.result.structuredContent.projectIdentity.projectIdentitySha256,
        expectedScanSha256: scanned.result.structuredContent.scanSha256,
        relativePaths: ["src/accepted-source.ts"],
        decision: "accept",
        title: "Codex control MCP accepted",
        summary: "The app-owned MCP accepted exact source-backed evidence.",
        sourceRefs: [{ path: source.path, hash: source.hash }],
      },
    });
    assert.equal(writeback.result.isError, false, JSON.stringify(writeback));
    assert.equal(writeback.result.structuredContent.operation, "writeback_evidence");
    assert.equal(writeback.result.structuredContent.accepted, true);

    seedReadyProject(workspace, storeRoot, "Portfolio Ready Project", ["src/accepted-source.ts"]);
    seedReadyProject(secondReadyWorkspace, storeRoot, "Second Portfolio Project");

    const readyVerify = await client.request("tools/call", {
      name: "verify_project",
      arguments: { workspace, taskGoal: "Verify accepted portfolio project", relativePaths: ["src/accepted-source.ts"] },
    });
    assert.equal(readyVerify.result.isError, false);
    assert.equal(readyVerify.result.structuredContent.current, true, JSON.stringify(readyVerify));
    assert.equal(readyVerify.result.structuredContent.recoveryReady, true);
    assert.equal(readyVerify.result.structuredContent.scanBinding.matched, true);

    const sliceCandidate = path.join(root, "accepted-slice", "candidate");
    const sliceReceiptRoot = path.dirname(sliceCandidate);
    fs.mkdirSync(path.join(sliceCandidate, "src"), { recursive: true });
    const acceptedSliceBytes = fs.readFileSync(path.join(workspace, "src", "accepted-source.ts"));
    fs.writeFileSync(path.join(sliceCandidate, "src", "accepted-source.ts"), acceptedSliceBytes);
    const acceptedSliceSha256 = crypto.createHash("sha256").update(acceptedSliceBytes).digest("hex");
    const sliceReceiptPath = path.join(sliceReceiptRoot, "acceptance-receipt.json");
    const sliceReceiptBytes = Buffer.from(`${JSON.stringify({
      schema: "codex_control_slice_acceptance_v1",
      task: "MCP-SLICE-001",
      decision: "accept",
      acceptedAt: "2026-08-17T06:00:00Z",
      candidate: sliceCandidate,
      changedPaths: { "src/accepted-source.ts": acceptedSliceSha256 },
    })}\n`, "utf8");
    fs.writeFileSync(sliceReceiptPath, sliceReceiptBytes);
    const stagedSlice = await client.request("tools/call", {
      name: "stage_accepted_slice",
      arguments: {
        workspace,
        execute: true,
        expectedProjectIdentitySha256: readyVerify.result.structuredContent.projectIdentity.projectIdentitySha256,
        receiptPath: sliceReceiptPath,
        expectedReceiptSha256: crypto.createHash("sha256").update(sliceReceiptBytes).digest("hex"),
        showApp: false,
      },
    });
    assert.equal(stagedSlice.result.isError, false, JSON.stringify(stagedSlice));
    assert.equal(stagedSlice.result.structuredContent.operation, "stage_accepted_slice");
    assert.equal(stagedSlice.result.structuredContent.authorityGranted, false);
    assert.equal(stagedSlice.result.structuredContent.writeAuthority, false);
    const storeBeforeSliceReconciliation = snapshotFileContents(storeRoot);
    const reconciledSlice = await client.request("tools/call", {
      name: "reconcile_accepted_slices",
      arguments: { workspace },
    });
    assert.equal(reconciledSlice.result.isError, false, JSON.stringify(reconciledSlice));
    assert.equal(reconciledSlice.result.structuredContent.operation, "reconcile_accepted_slices");
    assert.equal(reconciledSlice.result.structuredContent.readyForAuthorityReview, false);
    assert.ok(reconciledSlice.result.structuredContent.blockers.includes("incremental_acceptance_no_workspace_delta"));
    assert.equal(reconciledSlice.result.structuredContent.authorityGranted, false);
    assert.deepEqual(snapshotFileContents(storeRoot), storeBeforeSliceReconciliation,
      "accepted-Slice reconciliation must be byte-, path-, and mode-stable");
    const verifyAfterSliceStage = await client.request("tools/call", {
      name: "verify_project",
      arguments: { workspace, taskGoal: "Prove staging cannot advance or replace authority", relativePaths: ["src/accepted-source.ts"] },
    });
    assert.equal(verifyAfterSliceStage.result.structuredContent.current, true);
    assert.equal(
      verifyAfterSliceStage.result.structuredContent.scanBinding.authorizedCheckpointId,
      readyVerify.result.structuredContent.scanBinding.authorizedCheckpointId,
      "accepted-Slice staging must not change the authorized checkpoint",
    );
    assert.equal(
      verifyAfterSliceStage.result.structuredContent.scanBinding.currentScanSha256,
      readyVerify.result.structuredContent.scanBinding.currentScanSha256,
      "accepted-Slice staging must not change the exact scan binding",
    );

    const cleanTakeover = await client.request("tools/call", {
      name: "prepare_takeover",
      arguments: {
        workspace,
        taskGoal: "Replace a context-pressured CEO task without copying its history",
        tokenBudget: 2200,
        maxTokenBudget: 10000,
      },
    });
    assert.equal(cleanTakeover.result.isError, false, JSON.stringify(cleanTakeover));
    assert.equal(cleanTakeover.result.structuredContent.takeover.shouldInject, true);
    assert.equal(cleanTakeover.result.structuredContent.takeover.schemaVersion, "zhixia.takeover_control.v2");
    assert.equal(cleanTakeover.result.structuredContent.takeover.injectionMode, "replace_long_thread_context");
    assert.equal(cleanTakeover.result.structuredContent.takeover.maxInjectionsPerTask, 1);
    assert.equal(cleanTakeover.result.structuredContent.takeover.hostRequirements.requiresCleanReplacementTask, true);
    assert.equal(cleanTakeover.result.structuredContent.takeover.hostRequirements.contextDisposition, "replace_not_append");
    assert.equal(cleanTakeover.result.structuredContent.takeover.hostRequirements.fullHistoryForkAllowed, false);
    assert.equal(cleanTakeover.result.structuredContent.takeover.hostRequirements.existingTaskHistoryTrimmableByMemoryRuntime, false);
    assert.match(cleanTakeover.result.structuredContent.takeover.hostRequirements.requirementsSha256, /^[a-f0-9]{64}$/);

    const triggerReceiptCountBeforePortfolio = listMemoryRuntimeTriggerReceipts(storeRoot, { limit: 100 }).length;
    const storeContentsBeforePortfolio = snapshotFileContents(storeRoot);
    const portfolio = await client.request("tools/call", {
      name: "portfolio_context",
      arguments: {
        workspaces: [staleWorkspace, workspace],
        taskGoal: "Audit the stale project, then the accepted project",
        perProjectTokenBudget: 3000,
        maxTotalTokenBudget: 6000,
        limitPerProject: 4,
      },
    });
    assert.equal(portfolio.result.isError, false, JSON.stringify(portfolio));
    const portfolioOutput = portfolio.result.structuredContent;
    assert.equal(portfolioOutput.schemaVersion, "zhixia.portfolio_context.v1");
    assert.equal(portfolioOutput.operation, "portfolio_context");
    assert.equal(portfolioOutput.readOnly, true);
    assert.equal(portfolioOutput.writeAuthority, false);
    assert.equal(portfolioOutput.authorityIsolation, "per_project");
    assert.equal(portfolioOutput.combinedContextGenerationId, null);
    assert.equal(portfolioOutput.projectCount, 2);
    assert.equal(portfolioOutput.readyProjectCount, 1, JSON.stringify(portfolioOutput));
    assert.equal(portfolioOutput.staleProjectCount, 1);
    assert.equal(portfolioOutput.projects[0].workspace, fs.realpathSync(staleWorkspace));
    assert.equal(portfolioOutput.projects[0].status, "stale");
    assert.equal(portfolioOutput.projects[0].current, false);
    assert.equal(portfolioOutput.projects[0].contextGenerationId, null);
    assert.equal(portfolioOutput.projects[0].returnedCount, 0);
    assert.equal(portfolioOutput.projects[0].items.length, 0);
    assert.equal(portfolioOutput.projects[1].workspace, fs.realpathSync(workspace));
    assert.equal(portfolioOutput.projects[1].status, "ready");
    assert.equal(portfolioOutput.projects[1].current, true);
    assert.ok(portfolioOutput.projects[1].returnedCount > 0);
    assert.match(portfolioOutput.projects[1].contextGenerationId, /^context-/);
    assert.ok(portfolioOutput.projects.every((project) => project.workspace !== neutralArtifactRoot));
    assert.equal(portfolioOutput.safety.cwdInference, false);
    assert.equal(portfolioOutput.safety.sidecarLifecycleWrites, false);
    assert.equal(portfolioOutput.safety.crossProjectCheckpointMerge, false);
    for (const project of portfolioOutput.projects) {
      const projectId = project.projectIdentity?.projectId;
      for (const ref of [...project.sourceRefs, ...project.items.flatMap((item) => item.sourceRefs)]) {
        assert.equal(ref.projectId, projectId, "portfolio source refs must remain inside their project envelope");
      }
    }
    assert.ok(Buffer.byteLength(JSON.stringify(portfolioOutput), "utf8") < 64 * 1024);
    assert.equal(listMemoryRuntimeTriggerReceipts(storeRoot, { limit: 100 }).length, triggerReceiptCountBeforePortfolio,
      "read-only portfolio retrieval must not persist trigger receipts");
    assert.deepEqual(snapshotFileContents(storeRoot), storeContentsBeforePortfolio,
      "read-only portfolio verification and retrieval must not change sidecar file contents");

    const budgetDeferred = await client.request("tools/call", {
      name: "portfolio_context",
      arguments: {
        workspaces: [workspace, secondReadyWorkspace],
        taskGoal: "Retrieve projects in order without exceeding the total allocation",
        perProjectTokenBudget: 3000,
        maxTotalTokenBudget: 3000,
      },
    });
    assert.equal(budgetDeferred.result.isError, false, JSON.stringify(budgetDeferred));
    assert.equal(budgetDeferred.result.structuredContent.projects[0].status, "ready");
    assert.equal(budgetDeferred.result.structuredContent.projects[1].status, "budget_deferred");
    assert.equal(budgetDeferred.result.structuredContent.projects[1].contextGenerationId, null);
    assert.equal(budgetDeferred.result.structuredContent.projects[1].returnedCount, 0);
    assert.equal(budgetDeferred.result.structuredContent.budgetDeferredProjectCount, 1);
    assert.equal(budgetDeferred.result.structuredContent.budget.allocatedTokenBudget, 3000);
    assert.ok(budgetDeferred.result.structuredContent.budget.consumedTokenBudget <= 3000);

    const duplicatePortfolio = await client.request("tools/call", {
      name: "portfolio_context",
      arguments: { workspaces: [workspace, workspace], taskGoal: "Reject duplicate roots" },
    });
    assert.equal(duplicatePortfolio.result.isError, true);
    assert.match(duplicatePortfolio.result.content[0].text, /portfolio_workspace_duplicate/);

    const singleProjectPortfolio = await client.request("tools/call", {
      name: "portfolio_context",
      arguments: { workspaces: [workspace], taskGoal: "A single root must use retrieve_context" },
    });
    assert.equal(singleProjectPortfolio.result.isError, true);
    assert.match(singleProjectPortfolio.result.content[0].text, /portfolio_workspaces_bounded_array_required/);

    const invalidBudgetPortfolio = await client.request("tools/call", {
      name: "portfolio_context",
      arguments: { workspaces: [workspace, staleWorkspace], taskGoal: "Reject an unbounded budget", maxTotalTokenBudget: "10000" },
    });
    assert.equal(invalidBudgetPortfolio.result.isError, true);
    assert.match(invalidBudgetPortfolio.result.content[0].text, /portfolio_total_token_budget_invalid/);

    const writebackTool = listed.result.tools.find((tool) => tool.name === "writeback_evidence");
    assert.ok(writebackTool.inputSchema.properties.workspace);
    assert.equal(writebackTool.inputSchema.properties.workspaces, undefined);
    const refreshTool = listed.result.tools.find((tool) => tool.name === "refresh_binding");
    assert.equal(refreshTool.inputSchema.properties.acceptedChangedPaths.maxItems, 128);
    const stageTool = listed.result.tools.find((tool) => tool.name === "stage_accepted_slice");
    assert.equal(stageTool.inputSchema.properties.expectedReceiptSha256.pattern, "^[a-f0-9]{64}$");
    const reconcileTool = listed.result.tools.find((tool) => tool.name === "reconcile_accepted_slices");
    assert.equal(reconcileTool.annotations.readOnlyHint, true);

    const arbitraryUri = await client.request("tools/call", {
      name: "writeback_evidence",
      arguments: {
        workspace,
        execute: true,
        expectedProjectIdentitySha256: scanned.result.structuredContent.projectIdentity.projectIdentitySha256,
        expectedScanSha256: scanned.result.structuredContent.scanSha256,
        relativePaths: ["src/accepted-source.ts"],
        decision: "accept",
        title: "Reject arbitrary URI",
        summary: "An external URI must not become app-owned evidence.",
        sourceRefs: [{ path: "https://example.invalid/evidence", hash: source.hash }],
      },
    });
    assert.equal(arbitraryUri.result.isError, true);
    assert.match(arbitraryUri.result.content[0].text, /lifecycle_non_file_source_ref_not_trusted/);

    const serialized = JSON.stringify({ opened, scanned, verified, writeback, portfolio, arbitraryUri });
    assert.doesNotMatch(serialized, /data:image|\.codex[\\/]sessions|BEGIN PRIVATE KEY|A{240}/);
    console.log("Zhixia Codex control MCP tests passed.");
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
