#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");
const { invoke } = require("./invoke-app-memory-runtime.cjs");

const SERVER_NAME = "zhixia-control";
const SERVER_VERSION = "1.4.0";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_PORTFOLIO_WORKSPACES = 6;
const MAX_PORTFOLIO_TOKEN_BUDGET = 10_000;
const MAX_PORTFOLIO_PACKET_BYTES = 64 * 1024;

const sourceRefsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 128,
  items: {
    type: "object",
    properties: {
      kind: { type: "string", maxLength: 80 },
      path: { type: "string", minLength: 1, maxLength: 700 },
      uri: { type: "string", minLength: 1, maxLength: 700 },
      title: { type: "string", maxLength: 240 },
      hash: { type: "string", maxLength: 128 },
      sha256: { type: "string", maxLength: 128 },
      projectId: { type: "string", maxLength: 180 },
    },
    additionalProperties: false,
  },
};

const workspaceProperty = { type: "string", minLength: 1, maxLength: 1200 };
const workspacesProperty = {
  type: "array",
  minItems: 2,
  maxItems: MAX_PORTFOLIO_WORKSPACES,
  items: workspaceProperty,
  description: "Explicit ordered canonical project roots. The current cwd or artifact root is never inferred as a project.",
};
const relativePathsProperty = {
  type: "array",
  maxItems: 48,
  items: { type: "string", minLength: 1, maxLength: 700 },
  description: "Bounded workspace-relative source paths that must be pinned into this exact scan.",
};
const showAppProperty = {
  type: "boolean",
  description: "Open or focus the Zhixia Mac app before the operation. Defaults to true for visible control operations.",
};
const retrievalProperties = {
  workspace: workspaceProperty,
  taskGoal: { type: "string", minLength: 1, maxLength: 600 },
  queryType: { type: "string", maxLength: 80 },
  limit: { type: "integer", minimum: 1, maximum: 20 },
  tokenBudget: {
    type: "integer",
    minimum: 800,
    maximum: 10000,
    description: "Preferred starting budget. The Runtime may grow within maxTokenBudget unless strictTokenBudget=true.",
  },
  maxTokenBudget: {
    type: "integer",
    minimum: 800,
    maximum: 10000,
    description: "Maximum adaptive envelope for this read-only retrieval. Never exceeds 10000.",
  },
  strictTokenBudget: {
    type: "boolean",
    description: "Keep tokenBudget fixed instead of allowing bounded adaptive growth.",
  },
  relativePaths: relativePathsProperty,
  showApp: showAppProperty,
};
const lifecycleProperties = {
  workspace: workspaceProperty,
  execute: { type: "boolean", const: true },
  expectedProjectIdentitySha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  expectedScanSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  relativePaths: relativePathsProperty,
  showApp: showAppProperty,
};
const continuityListProperty = {
  type: "array",
  maxItems: 12,
  items: { type: "string", minLength: 1, maxLength: 360 },
};

const tools = [
  {
    name: "open_app",
    description: "Open or focus the installed Zhixia Mac app. This only shows the app and does not mutate project memory.",
    inputSchema: {
      type: "object",
      properties: { workspace: workspaceProperty },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "scan_workspace",
    description: "Open Zhixia and perform a bounded, read-only exact scan of a local workspace. A scan is evidence, not authority.",
    inputSchema: {
      type: "object",
      properties: { workspace: workspaceProperty, relativePaths: relativePathsProperty, showApp: showAppProperty },
      required: ["workspace"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "verify_project",
    description: "Open Zhixia and verify app-owned project identity, exact scan binding, continuity, and recovery readiness.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: workspaceProperty,
        taskGoal: { type: "string", maxLength: 600 },
        relativePaths: relativePathsProperty,
        showApp: showAppProperty,
      },
      required: ["workspace"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "retrieve_context",
    description: "Retrieve bounded Hot/Warm app-owned project context. Raw sessions, credentials, images, base64, and giant logs are excluded.",
    inputSchema: {
      type: "object",
      properties: retrievalProperties,
      required: ["workspace", "taskGoal"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "portfolio_context",
    description: "Retrieve bounded read-only context for explicit ordered project roots. Each project keeps an independent identity, authority state, generation, items, and source refs; no cross-project write authority is created.",
    inputSchema: {
      type: "object",
      properties: {
        workspaces: workspacesProperty,
        taskGoal: { type: "string", minLength: 1, maxLength: 600 },
        queryType: { type: "string", maxLength: 80 },
        limitPerProject: { type: "integer", minimum: 1, maximum: 8 },
        perProjectTokenBudget: { type: "integer", minimum: 800, maximum: 5000 },
        maxTotalTokenBudget: { type: "integer", minimum: 1600, maximum: MAX_PORTFOLIO_TOKEN_BUDGET },
        showApp: showAppProperty,
      },
      required: ["workspaces", "taskGoal"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "prepare_takeover",
    description: "Prepare a verified compact replacement packet for a clean Codex task. Inject a returned contextGenerationId at most once per task.",
    inputSchema: {
      type: "object",
      properties: retrievalProperties,
      required: ["workspace", "taskGoal"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "stage_accepted_slice",
    description: "Stage one content-addressed accepted candidate Slice in the non-authoritative incremental ledger. Candidate postimages and receipt digest are verified; no checkpoint or write authority is advanced.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: workspaceProperty,
        execute: { type: "boolean", const: true },
        expectedProjectIdentitySha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        receiptPath: { type: "string", minLength: 1, maxLength: 1200 },
        expectedReceiptSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        showApp: showAppProperty,
      },
      required: ["workspace", "execute", "expectedProjectIdentitySha256", "receiptPath", "expectedReceiptSha256"],
      additionalProperties: false,
    },
  },
  {
    name: "reconcile_accepted_slices",
    description: "Read and verify the incremental accepted-Slice ledger against the current workspace delta. This never grants authority or refreshes a checkpoint.",
    inputSchema: {
      type: "object",
      properties: { workspace: workspaceProperty, showApp: showAppProperty },
      required: ["workspace"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "writeback_evidence",
    description: "Open Zhixia and write compact accepted/revised/blocked evidence through the app-owned exact-scan gate. execute=true and exact current identity/scan hashes are mandatory.",
    inputSchema: {
      type: "object",
      properties: {
        ...lifecycleProperties,
        decision: { type: "string", enum: ["accept", "revise", "block"] },
        eventType: { type: "string", maxLength: 80 },
        taskId: { type: "string", maxLength: 180 },
        moduleId: { type: "string", maxLength: 180 },
        title: { type: "string", minLength: 1, maxLength: 240 },
        summary: { type: "string", minLength: 1, maxLength: 800 },
        phase: { type: "string", maxLength: 80 },
        acceptedProgress: continuityListProperty,
        openTasks: continuityListProperty,
        openBlockers: continuityListProperty,
        latestFailures: continuityListProperty,
        nextActions: continuityListProperty,
        threadLineage: continuityListProperty,
        sourceRefs: sourceRefsSchema,
      },
      required: [
        "workspace",
        "execute",
        "expectedProjectIdentitySha256",
        "expectedScanSha256",
        "decision",
        "title",
        "summary",
        "sourceRefs",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "refresh_binding",
    description: "Open Zhixia and advance a previous authorized checkpoint to an exact newly accepted scan. Formal acceptance receipt and source-backed changed paths are mandatory.",
    inputSchema: {
      type: "object",
      properties: {
        ...lifecycleProperties,
        previousCheckpointId: { type: "string", minLength: 1, maxLength: 220 },
        acceptedEvidenceReceipt: { type: "string", minLength: 8, maxLength: 220 },
        acceptedChangedPaths: {
          type: "array",
          minItems: 1,
          maxItems: 128,
          items: { type: "string", minLength: 1, maxLength: 500 },
        },
        lane: { type: "string", minLength: 1, maxLength: 180 },
        taskId: { type: "string", maxLength: 180 },
        moduleId: { type: "string", maxLength: 180 },
        eventType: { type: "string", maxLength: 80 },
        title: { type: "string", minLength: 1, maxLength: 240 },
        summary: { type: "string", minLength: 1, maxLength: 800 },
        phase: { type: "string", maxLength: 80 },
        acceptedProgress: continuityListProperty,
        openTasks: continuityListProperty,
        openBlockers: continuityListProperty,
        latestFailures: continuityListProperty,
        nextActions: continuityListProperty,
        threadLineage: continuityListProperty,
        sourceRefs: sourceRefsSchema,
      },
      required: [
        "workspace",
        "execute",
        "expectedProjectIdentitySha256",
        "expectedScanSha256",
        "previousCheckpointId",
        "acceptedEvidenceReceipt",
        "acceptedChangedPaths",
        "lane",
        "title",
        "summary",
        "sourceRefs",
      ],
      additionalProperties: false,
    },
  },
];

const toolNames = new Set(tools.map((tool) => tool.name));
let initialized = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function failure(id, code, message, data) {
  send({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function compactError(error) {
  const diagnosticError = Array.isArray(error?.diagnostics)
    ? error.diagnostics.map((item) => item?.error).find(Boolean)
    : null;
  let runtimeCode = null;
  if (diagnosticError) {
    try {
      const parsed = JSON.parse(diagnosticError);
      runtimeCode = typeof parsed?.error === "string" ? parsed.error : null;
    } catch {
      runtimeCode = /^[a-z0-9_.:-]{1,300}$/i.test(diagnosticError) ? diagnosticError : null;
    }
  }
  const message = runtimeCode || error?.message || error || "unknown_error";
  return String(message).replace(/\s+/g, " ").trim().slice(0, 500);
}

function resolveWorkspace(value) {
  const workspace = path.resolve(String(value || ""));
  if (!value || !fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error("zhixia_control_workspace_directory_required");
  }
  return workspace;
}

function resolvePortfolioWorkspaces(values) {
  if (!Array.isArray(values) || values.length < 2 || values.length > MAX_PORTFOLIO_WORKSPACES) {
    throw new Error("zhixia_control_portfolio_workspaces_bounded_array_required");
  }
  if (values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("zhixia_control_portfolio_workspace_string_required");
  }
  const resolved = values.map((value) => fs.realpathSync.native
    ? fs.realpathSync.native(resolveWorkspace(value))
    : fs.realpathSync(resolveWorkspace(value)));
  if (new Set(resolved).size !== resolved.length) throw new Error("zhixia_control_portfolio_workspace_duplicate");
  return resolved;
}

function boundedPortfolioInteger(value, fallback, minimum, maximum, errorCode) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(errorCode);
  return value;
}

function installedAppCandidates(env = process.env) {
  const explicit = env.ZHIXIA_CONTROL_APP_PATH ? [path.resolve(env.ZHIXIA_CONTROL_APP_PATH)] : [];
  return [...new Set([
    ...explicit,
    path.join(os.homedir(), "Applications", "知匣.app"),
    "/Applications/知匣.app",
    path.join(os.homedir(), "Applications", "知匣 Local Doc Knowledge.app"),
    "/Applications/知匣 Local Doc Knowledge.app",
  ])];
}

function openApp(workspace, env = process.env) {
  if (workspace) resolveWorkspace(workspace);
  const appPath = installedAppCandidates(env).find((candidate) => fs.existsSync(candidate));
  if (!appPath) throw new Error("zhixia_control_installed_app_not_found");
  if (env.ZHIXIA_CONTROL_DISABLE_APP_OPEN === "1") {
    return { status: "disabled_for_test", opened: false, appPath, workspace: workspace ? path.resolve(workspace) : null };
  }
  if (process.platform !== "darwin") throw new Error("zhixia_control_open_app_requires_macos");
  const opened = spawnSync("/usr/bin/open", [appPath], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (opened.status !== 0) {
    throw new Error(`zhixia_control_open_app_failed:${compactError(opened.stderr || opened.error)}`);
  }
  return { status: "opened", opened: true, appPath, workspace: workspace ? path.resolve(workspace) : null };
}

function invokeRuntime(request) {
  return JSON.parse(invoke(JSON.stringify(request), process.env));
}

function compactScanOutput(output) {
  const sourceRefs = (output.sourceRefs || []).slice(0, 48).map((ref) => ({
    kind: ref.kind,
    path: ref.title,
    title: ref.title,
    hash: ref.hash,
    projectId: ref.projectId,
  }));
  const workingEntries = (output.workingTree?.entries || []).slice(0, 24).map((entry) => ({
    relativePath: entry.relativePath,
    state: entry.state,
    sha256: entry.sha256,
  }));
  return {
    schemaVersion: output.schemaVersion,
    operation: output.operation,
    status: output.status,
    current: output.current,
    recoveryReady: output.recoveryReady,
    memoryMode: output.memoryMode,
    authorityVerification: output.authorityVerification,
    workspace: output.workspace,
    projectIdentity: output.projectIdentity,
    scanSha256: output.scanSha256,
    sourceRefs,
    workingTree: {
      changedPathCount: Number(output.workingTree?.changedPathCount || 0),
      fingerprint: output.workingTree?.fingerprint || null,
      entries: workingEntries,
      truncated: Boolean(output.workingTree?.truncated || (output.workingTree?.entries || []).length > workingEntries.length),
    },
    generatedKnowledgeCount: (output.generatedKnowledge || []).length,
    skipped: (output.skipped || []).slice(0, 12),
    performance: output.performance,
    warnings: output.warnings,
  };
}

function compactContentReceipt(output) {
  return JSON.stringify({
    operation: output.operation || null,
    status: output.status || null,
    current: output.current === true,
    recoveryReady: output.recoveryReady === true,
    memoryMode: output.memoryMode || null,
    authorityVerification: output.authorityVerification || null,
    scanSha256: output.scanSha256 || output.scanBinding?.currentScanSha256 || null,
    contextGenerationId: output.contextGenerationId || null,
    returnedCount: output.returnedCount ?? null,
    projectCount: output.projectCount ?? null,
    readyProjectCount: output.readyProjectCount ?? null,
  });
}

function maybeOpenApp(args, defaultValue) {
  if (args.showApp === false || (!defaultValue && args.showApp !== true)) return null;
  return openApp(args.workspace);
}

function lifecycleEvidence(args) {
  const {
    workspace: _workspace,
    execute: _execute,
    expectedProjectIdentitySha256: _identity,
    expectedScanSha256: _scan,
    previousCheckpointId: _checkpoint,
    acceptedEvidenceReceipt: _receipt,
    acceptedChangedPaths: _paths,
    lane: _lane,
    relativePaths: _relativePaths,
    showApp: _showApp,
    ...evidence
  } = args;
  return evidence;
}

function compactPortfolioIdentity(identity = {}) {
  return {
    projectId: identity.projectId || null,
    canonicalRepoId: identity.canonicalRepoId || null,
    canonicalRoot: identity.canonicalRoot || null,
    worktreeRoot: identity.worktreeRoot || null,
    baselineHead: identity.baselineHead || null,
    projectIdentitySha256: identity.projectIdentitySha256 || null,
  };
}

function compactPortfolioSourceRefs(refs, projectId) {
  return (Array.isArray(refs) ? refs : [])
    .filter((ref) => ref?.projectId && ref.projectId === projectId)
    .slice(0, 4)
    .map((ref) => ({
      kind: ref.kind || null,
      path: ref.path || ref.uri || null,
      title: ref.title || null,
      hash: ref.hash || ref.sha256 || null,
      projectId,
    }));
}

function compactPortfolioItems(items, projectId, limit) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map((item) => ({
    id: item.id || null,
    projectId,
    layer: item.layer || item.memoryLayer || null,
    kind: item.kind || null,
    category: item.category || null,
    title: item.title || null,
    summary: item.summary || item.excerpt || null,
    status: item.status || null,
    freshness: item.freshness || null,
    tokenEstimate: Math.max(0, Number(item.tokenEstimate || 0)),
    sourceRefs: compactPortfolioSourceRefs(item.sourceRefs, projectId),
  }));
}

function portfolioProjectStatus(verified) {
  return verified?.memoryMode === "app_owned_memory_core"
    && verified?.authorityVerification === "app_owned_verified"
    && verified?.current === true
    && verified?.recoveryReady === true
    && verified?.scanBinding?.matched === true
    ? "ready"
    : "stale";
}

function compactPortfolioVerification(workspace, verified, status) {
  return {
    workspace,
    status,
    memoryMode: verified?.memoryMode || "fallback_stale",
    authorityVerification: verified?.authorityVerification || "unavailable",
    current: verified?.current === true,
    recoveryReady: verified?.recoveryReady === true,
    projectIdentity: compactPortfolioIdentity(verified?.projectIdentity),
    scanBinding: {
      matched: verified?.scanBinding?.matched === true,
      currentScanSha256: verified?.scanBinding?.currentScanSha256 || null,
      authorizedCheckpointId: verified?.scanBinding?.authorizedCheckpointId || null,
    },
    contextGenerationId: null,
    returnedCount: 0,
    tokenEstimate: 0,
    items: [],
    sourceRefs: [],
    warnings: (verified?.warnings || []).slice(0, 8),
  };
}

function portfolioContext(args) {
  const workspaces = resolvePortfolioWorkspaces(args.workspaces);
  if (typeof args.taskGoal !== "string" || !args.taskGoal.trim() || args.taskGoal.length > 600) {
    throw new Error("zhixia_control_portfolio_task_goal_required");
  }
  const app = args.showApp === true ? openApp() : null;
  const perProjectTokenBudget = boundedPortfolioInteger(
    args.perProjectTokenBudget,
    3000,
    800,
    5000,
    "zhixia_control_portfolio_per_project_token_budget_invalid",
  );
  const maxTotalTokenBudget = boundedPortfolioInteger(
    args.maxTotalTokenBudget,
    Math.min(6000, perProjectTokenBudget * workspaces.length),
    1600,
    MAX_PORTFOLIO_TOKEN_BUDGET,
    "zhixia_control_portfolio_total_token_budget_invalid",
  );
  const limitPerProject = boundedPortfolioInteger(
    args.limitPerProject,
    4,
    1,
    8,
    "zhixia_control_portfolio_limit_invalid",
  );
  const projects = [];
  let consumedTokenBudget = 0;
  let allocatedTokenBudget = 0;

  for (const workspace of workspaces) {
    let verified;
    try {
      verified = invokeRuntime({
        operation: "verify",
        workspace,
        taskGoal: args.taskGoal,
      });
    } catch (error) {
      projects.push({
        workspace,
        status: "error",
        memoryMode: "fallback_stale",
        authorityVerification: "unavailable",
        current: false,
        recoveryReady: false,
        projectIdentity: null,
        scanBinding: { matched: false, currentScanSha256: null, authorizedCheckpointId: null },
        contextGenerationId: null,
        returnedCount: 0,
        tokenEstimate: 0,
        items: [],
        sourceRefs: [],
        warnings: [compactError(error)],
      });
      continue;
    }

    const status = portfolioProjectStatus(verified);
    const project = compactPortfolioVerification(workspace, verified, status);
    const remainingBudget = maxTotalTokenBudget - allocatedTokenBudget;
    if (status !== "ready") {
      projects.push(project);
      continue;
    }
    if (remainingBudget < 800) {
      projects.push({ ...project, status: "budget_deferred", warnings: ["portfolio_total_token_budget_exhausted"] });
      continue;
    }

    const effectiveBudget = Math.min(perProjectTokenBudget, remainingBudget);
    let retrieved;
    try {
      retrieved = invokeRuntime({
        operation: "retrieve",
        workspace,
        taskGoal: args.taskGoal,
        queryType: args.queryType || "portfolio_context",
        limit: limitPerProject,
        tokenBudget: effectiveBudget,
        maxTokenBudget: effectiveBudget,
        strictTokenBudget: true,
        readOnly: true,
      });
    } catch (error) {
      projects.push({
        ...project,
        status: "error",
        warnings: [...new Set([...(project.warnings || []), `portfolio_retrieve_failed:${compactError(error)}`])].slice(0, 8),
      });
      continue;
    }
    const projectId = retrieved?.projectIdentity?.projectId || verified?.projectIdentity?.projectId || null;
    const tokenEstimate = Math.max(0, Number(retrieved?.tokenEstimate || 0));
    const returnedCount = Math.max(0, Number(retrieved?.returnedCount || 0));
    const retrievalStillAuthoritative = retrieved?.memoryMode === "app_owned_memory_core"
      && retrieved?.authorityVerification === "app_owned_verified"
      && retrieved?.current === true
      && retrieved?.recoveryReady === true
      && retrieved?.scanHash === verified?.scanBinding?.currentScanSha256
      && projectId === verified?.projectIdentity?.projectId
      && typeof retrieved?.contextGenerationId === "string"
      && retrieved.contextGenerationId.startsWith("context-")
      && returnedCount > 0
      && tokenEstimate <= effectiveBudget;
    if (!retrievalStillAuthoritative) {
      projects.push({
        ...project,
        status: "stale",
        warnings: [...new Set([...(project.warnings || []), "portfolio_retrieve_authority_mismatch"])]
          .slice(0, 8),
      });
      continue;
    }
    allocatedTokenBudget += effectiveBudget;
    consumedTokenBudget += tokenEstimate;
    projects.push({
      ...project,
      status: "ready",
      contextGenerationId: retrieved?.contextGenerationId || null,
      returnedCount,
      tokenEstimate,
      items: compactPortfolioItems(retrieved?.items, projectId, limitPerProject),
      sourceRefs: compactPortfolioSourceRefs(retrieved?.sourceRefs, projectId),
      warnings: [...new Set([...(project.warnings || []), ...(retrieved?.warnings || [])])].slice(0, 8),
    });
  }

  const output = {
    schemaVersion: "zhixia.portfolio_context.v1",
    operation: "portfolio_context",
    status: projects.some((project) => project.status === "ready") ? "partial_or_ready" : "not_ready",
    readOnly: true,
    writeAuthority: false,
    authorityIsolation: "per_project",
    combinedContextGenerationId: null,
    projectCount: projects.length,
    readyProjectCount: projects.filter((project) => project.status === "ready").length,
    staleProjectCount: projects.filter((project) => project.status === "stale").length,
    errorProjectCount: projects.filter((project) => project.status === "error").length,
    budgetDeferredProjectCount: projects.filter((project) => project.status === "budget_deferred").length,
    budget: {
      perProjectTokenBudget,
      maxTotalTokenBudget,
      allocatedTokenBudget,
      consumedTokenBudget,
      strictPerProjectBudget: true,
    },
    projects,
    safety: {
      explicitWorkspacesOnly: true,
      cwdInference: false,
      rawSessionBodyRead: false,
      sidecarLifecycleWrites: false,
      crossProjectSourceRefMerge: false,
      crossProjectCheckpointMerge: false,
      lifecycleWrites: false,
    },
    ...(app ? { app } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_PORTFOLIO_PACKET_BYTES) {
    throw new Error("zhixia_control_portfolio_packet_too_large");
  }
  return output;
}

function callTool(name, args) {
  if (name === "open_app") return openApp(args.workspace);
  if (name === "portfolio_context") return portfolioContext(args);
  const workspace = resolveWorkspace(args.workspace);
  if (name === "scan_workspace") {
    const app = maybeOpenApp({ ...args, workspace }, true);
    return {
      ...compactScanOutput(invokeRuntime({ operation: "scan", workspace, relativePaths: args.relativePaths })),
      app,
    };
  }
  if (name === "verify_project") {
    const app = maybeOpenApp({ ...args, workspace }, true);
    return {
      ...invokeRuntime({
        operation: "verify",
        workspace,
        taskGoal: args.taskGoal || "Verify current Zhixia project memory",
        relativePaths: args.relativePaths,
      }),
      app,
    };
  }
  if (name === "retrieve_context" || name === "prepare_takeover") {
    const operation = name === "retrieve_context" ? "retrieve" : "prepare_takeover";
    const app = maybeOpenApp({ ...args, workspace }, false);
    return {
      ...invokeRuntime({
        operation,
        workspace,
        taskGoal: args.taskGoal,
        queryType: args.queryType || (operation === "prepare_takeover" ? "thread_recovery" : "task_context"),
        limit: args.limit,
        tokenBudget: args.tokenBudget,
        maxTokenBudget: args.maxTokenBudget,
        strictTokenBudget: args.strictTokenBudget,
        relativePaths: args.relativePaths,
      }),
      ...(app ? { app } : {}),
    };
  }
  if (name === "writeback_evidence") {
    const app = maybeOpenApp({ ...args, workspace }, true);
    return {
      ...invokeRuntime({
        operation: "writeback_evidence",
        workspace,
        execute: args.execute,
        expectedProjectIdentitySha256: args.expectedProjectIdentitySha256,
        expectedScanSha256: args.expectedScanSha256,
        relativePaths: args.relativePaths,
        evidence: lifecycleEvidence(args),
      }),
      app,
    };
  }
  if (name === "stage_accepted_slice") {
    const app = maybeOpenApp({ ...args, workspace }, true);
    return {
      ...invokeRuntime({
        operation: "stage_accepted_slice",
        workspace,
        execute: args.execute,
        expectedProjectIdentitySha256: args.expectedProjectIdentitySha256,
        receiptPath: args.receiptPath,
        expectedReceiptSha256: args.expectedReceiptSha256,
      }),
      app,
    };
  }
  if (name === "reconcile_accepted_slices") {
    const app = maybeOpenApp({ ...args, workspace }, false);
    return {
      ...invokeRuntime({ operation: "reconcile_accepted_slices", workspace }),
      ...(app ? { app } : {}),
    };
  }
  if (name === "refresh_binding") {
    const app = maybeOpenApp({ ...args, workspace }, true);
    return {
      ...invokeRuntime({
        operation: "refresh_binding",
        workspace,
        execute: args.execute,
        expectedProjectIdentitySha256: args.expectedProjectIdentitySha256,
        expectedScanSha256: args.expectedScanSha256,
        previousCheckpointId: args.previousCheckpointId,
        acceptedEvidenceReceipt: args.acceptedEvidenceReceipt,
        acceptedChangedPaths: args.acceptedChangedPaths,
        lane: args.lane,
        relativePaths: args.relativePaths || args.acceptedChangedPaths,
        evidence: lifecycleEvidence(args),
      }),
      app,
    };
  }
  throw new Error("zhixia_control_unknown_tool");
}

function handleRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
    failure(message?.id, -32600, "Invalid Request");
    return;
  }
  if (message.method === "notifications/initialized") {
    initialized = true;
    return;
  }
  if (message.method === "notifications/cancelled") return;
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    const requestedVersion = typeof message.params?.protocolVersion === "string"
      ? message.params.protocolVersion
      : DEFAULT_PROTOCOL_VERSION;
    result(message.id, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Use the installed app-owned Zhixia Runtime. Read-only scan/verify/retrieve may run automatically. Lifecycle writes require exact current identity, exact scan, execute=true, and source-backed formal evidence. Never request raw sessions, credentials, images/base64, SQLite, or complete logs.",
    });
    return;
  }
  if (message.method === "ping") {
    result(message.id, {});
    return;
  }
  if (!initialized) {
    failure(message.id, -32002, "Server not initialized");
    return;
  }
  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments;
    if (typeof name !== "string" || !toolNames.has(name)) {
      failure(message.id, -32602, "Unknown tool");
      return;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      failure(message.id, -32602, "Tool arguments must be an object");
      return;
    }
    try {
      const output = callTool(name, args);
      result(message.id, {
        content: [{ type: "text", text: compactContentReceipt(output) }],
        structuredContent: output,
        isError: false,
      });
    } catch (error) {
      result(message.id, {
        content: [{ type: "text", text: compactError(error) }],
        isError: true,
      });
    }
    return;
  }
  failure(message.id, -32601, "Method not found");
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
    failure(null, -32600, "Message too large");
    return;
  }
  try {
    handleRequest(JSON.parse(line));
  } catch (error) {
    failure(null, -32700, "Parse error", compactError(error));
  }
});

input.on("close", () => {
  process.exitCode = 0;
});

module.exports = { callTool, installedAppCandidates, openApp, tools };
