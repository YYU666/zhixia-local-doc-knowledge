const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  compactRecallItem,
  createMemoryCoreRuntime,
  deriveProjectIdentity: deriveMemoryCoreProjectIdentity,
  loadExistingSigningKey,
  loadOrCreateSigningKey,
  memoryCorePrivateStateExists,
} = require("./memoryCoreRuntime.cjs");
const {
  deriveProjectIdentityEnvelope,
} = require("../codex-skills/zhixia-local-docs/scripts/project-identity.cjs");
const {
  listAuthorityReceipts,
  listProjectAnchors,
  listProjectCheckpoints,
  retrieveSemanticGraphPaths,
  upsertProjectAnchor,
  upsertSemanticGraphRecords,
  writeMemoryRuntimeTriggerReceipt,
} = require("./memoryRuntimeIndexStore.cjs");
const { buildSemanticGraphSeedFromRuntimeItems } = require("./semanticMemoryGraphPolicy.cjs");

const CLI_SCHEMA = "zhixia.memory_runtime_cli.v1";
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_SCAN_FILES = 48;
const MAX_SCAN_DIRECTORIES = 48;
const MAX_SCANNED_FILE_BYTES = 1024 * 1024;
const MAX_RESUME_PACKET_BYTES = 16 * 1024;
const MAX_RETRIEVAL_PACKET_BYTES = 32 * 1024;
const MAX_TEXT_CHARS = 1200;
const MAX_LIST_ITEMS = 24;
const ALLOWED_SOURCE_EXTENSIONS = new Set([".md", ".json", ".txt", ".yaml", ".yml"]);
const ROOT_SOURCE_FILES = ["README.md", "AGENTS.md", "package.json"];
const PRIORITY_SOURCE_FILES = [
  "docs/EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md",
  "docs/PROGRAM_GOAL_BRIEF.md",
  "docs/PRD.md",
  "docs/TECHNICAL_DESIGN.md",
  "docs/TEST_PLAN.md",
  "docs/RELEASE_NOTES.md",
];
const GENERATED_KNOWLEDGE_FILES = [
  "project-resume.md",
  "retrieval-packet.md",
  "project-index.md",
  "project-knowledge.md",
  "knowledge-items.md",
  "experience-cards.md",
];
const SKIP_DIRECTORY_NAMES = new Set([
  ".git", ".codex-knowledge", "node_modules", "dist", "release", "artifacts",
  "coverage", "backups", "vault", "vaults", "tmp", "temp",
]);
const RAW_SESSION_RE = /(?:\.codex[\\/](?:archived_)?sessions[\\/]|session[_ -]?jsonl|rollout-[^\s]+\.jsonl|raw[_ -]?session[_ -]?(?:body|payload)\s*[:=])/i;
const SECRET_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b/i;
const BASE64_RE = /(?:data:[^;]+;base64,|[A-Za-z0-9+/]{240,}={0,2})/;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function compactText(value, maxChars = MAX_TEXT_CHARS) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function safeText(value) {
  const text = String(value == null ? "" : value);
  return !RAW_SESSION_RE.test(text) && !SECRET_RE.test(text) && !BASE64_RE.test(text);
}

function compactSafeText(value, maxChars = MAX_TEXT_CHARS) {
  const text = compactText(value, maxChars);
  if (!text || !safeText(text)) throw new Error("unsafe_or_empty_memory_runtime_text");
  return text;
}

function compactSafeList(values, maxItems = MAX_LIST_ITEMS, maxChars = 360) {
  const result = [];
  const seen = new Set();
  for (const value of (Array.isArray(values) ? values : [values])) {
    const text = compactText(value, maxChars);
    if (!text) continue;
    if (!safeText(text)) throw new Error("unsafe_memory_runtime_list_item");
    if (seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function resolveUserData(env = process.env) {
  if (env.ZHIXIA_USER_DATA) return path.resolve(env.ZHIXIA_USER_DATA);
  const home = os.homedir();
  if (process.platform === "win32") return path.join(env.APPDATA || path.join(home, ["App", "Data"].join(""), "Roaming"), "知匣 Local Doc Knowledge");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "知匣 Local Doc Knowledge");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "知匣 Local Doc Knowledge");
}

function resolveStoreRoot(request = {}, env = process.env) {
  return path.resolve(request.storeRoot || env.ZHIXIA_MEMORY_RUNTIME_ROOT || path.join(resolveUserData(env), "memory-runtime"));
}

function readRequest(argv = process.argv.slice(2)) {
  const index = argv.indexOf("--request-json");
  const raw = index >= 0 ? String(argv[index + 1] || "") : fs.readFileSync(0, "utf8");
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new Error("request_json_missing_or_too_large");
  const request = JSON.parse(raw);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("request_json_object_required");
  return request;
}

function resolveWorkspace(request = {}) {
  if (!request.workspace) throw new Error("exact_workspace_required");
  const workspace = fs.realpathSync(path.resolve(request.workspace));
  if (!fs.statSync(workspace).isDirectory()) throw new Error("exact_workspace_directory_required");
  const projectIdentity = deriveProjectIdentityEnvelope(workspace, { expected: request.projectIdentity });
  return { workspace, projectIdentity };
}

function resolveContainedFile(workspace, relativePath) {
  const relative = String(relativePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!relative || path.isAbsolute(relative)) throw new Error("workspace_relative_source_path_required");
  const candidate = path.resolve(workspace, relative);
  const rel = path.relative(workspace, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("cross_project_source_path_rejected");
  return candidate;
}

function hashFile(filePath) {
  const canonicalText = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(canonicalText, "utf8").digest("hex");
}

function hashFileBytes(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collectDocCandidates(workspace, request = {}) {
  const candidates = new Set([...ROOT_SOURCE_FILES, ...PRIORITY_SOURCE_FILES]);
  const requestedCandidates = [];
  for (const requested of Array.isArray(request.relativePaths) ? request.relativePaths.slice(0, MAX_SCAN_FILES) : []) {
    const normalized = String(requested || "").replace(/\\/g, "/");
    if (normalized.startsWith(".codex-knowledge/")) throw new Error("generated_knowledge_cannot_be_canonical_source");
    candidates.add(normalized);
    requestedCandidates.push(normalized);
  }
  const docsRoot = path.join(workspace, "docs");
  const queue = fs.existsSync(docsRoot) ? [docsRoot] : [];
  let directoriesRead = 0;
  while (queue.length > 0 && directoriesRead < MAX_SCAN_DIRECTORIES && candidates.size < MAX_SCAN_FILES) {
    const current = queue.shift();
    directoriesRead += 1;
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (candidates.size >= MAX_SCAN_FILES) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORY_NAMES.has(entry.name.toLowerCase())) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !ALLOWED_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      candidates.add(path.relative(workspace, fullPath).replace(/\\/g, "/"));
    }
  }
  const preferred = [...new Set([...PRIORITY_SOURCE_FILES, ...requestedCandidates, ...ROOT_SOURCE_FILES])];
  const preferredSet = new Set(preferred);
  return {
    candidates: [...preferred, ...[...candidates].filter((item) => !preferredSet.has(item)).sort()],
    directoriesRead,
  };
}

function sourceArtifactType(relativePath) {
  if (/prd|program.goal/i.test(relativePath)) return "prd";
  if (/technical|architecture|design/i.test(relativePath)) return "architecture";
  if (/test|acceptance/i.test(relativePath)) return "acceptance";
  if (/release|status|progress/i.test(relativePath)) return "status";
  if (/agent|rule|security/i.test(relativePath)) return "rule";
  return "canonical_doc";
}

function scanExactWorkspace(request = {}) {
  const { workspace, projectIdentity } = resolveWorkspace(request);
  const { candidates, directoriesRead } = collectDocCandidates(workspace, request);
  const files = [];
  const skipped = [];
  for (const relativePath of candidates) {
    const filePath = resolveContainedFile(workspace, relativePath);
    if (!fs.existsSync(filePath)) continue;
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) continue;
    if (stats.size > MAX_SCANNED_FILE_BYTES) {
      skipped.push({ relativePath, reason: "canonical_source_too_large", sizeBytes: stats.size });
      continue;
    }
    files.push({
      kind: "canonical_project_file",
      relativePath,
      path: filePath,
      title: relativePath,
      artifactType: sourceArtifactType(relativePath),
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString(),
      sha256: hashFile(filePath),
    });
    if (files.length >= MAX_SCAN_FILES) break;
  }
  const generatedKnowledge = [];
  for (const fileName of GENERATED_KNOWLEDGE_FILES) {
    const filePath = path.join(workspace, ".codex-knowledge", fileName);
    if (!fs.existsSync(filePath)) continue;
    const stats = fs.statSync(filePath);
    generatedKnowledge.push({ fileName, sizeBytes: stats.size, updatedAt: stats.mtime.toISOString(), authorityEligible: false });
  }
  const scanCore = {
    projectIdentitySha256: projectIdentity.projectIdentitySha256,
    canonicalRoot: projectIdentity.canonicalRoot,
    baselineHead: projectIdentity.baselineHead,
    files: files.map(({ relativePath, sha256: fileSha256 }) => ({ relativePath, sha256: fileSha256 })),
  };
  return {
    schemaVersion: CLI_SCHEMA,
    operation: "scan",
    status: files.length > 0 ? "scanned" : "not_ready",
    current: false,
    recoveryReady: false,
    memoryMode: "scan_preview",
    authorityVerification: "not_attempted",
    workspace,
    projectIdentity,
    scanSha256: sha256(stableStringify(scanCore)),
    files,
    sourceRefs: files.map((file) => ({ kind: file.kind, path: file.path, title: file.title, hash: file.sha256, updatedAt: file.updatedAt, projectId: projectIdentity.projectId })),
    generatedKnowledge,
    skipped,
    performance: { bounded: true, maxFiles: MAX_SCAN_FILES, maxDirectories: MAX_SCAN_DIRECTORIES, directoriesRead, rawSessionBodyRead: false },
    warnings: [
      "scan_is_not_authority_and_cannot_claim_recovery_readiness",
      ...(generatedKnowledge.length > 0 ? ["generated_codex_knowledge_excluded_from_authority_seed"] : []),
      ...(skipped.length > 0 ? ["oversized_canonical_sources_skipped"] : []),
    ],
  };
}

function coreSourceRefs(scan, coreProjectId, moduleId) {
  const scanBinding = {
    kind: "workspace_scan_receipt",
    path: `memory-runtime://workspace-scan/${scan.scanSha256}`,
    title: `Exact workspace scan at ${scan.projectIdentity.baselineHead || "working-tree"}`,
    hash: scan.scanSha256,
    artifactType: "workspace_scan_binding",
    updatedAt: scan.files.reduce((latest, file) => file.updatedAt > latest ? file.updatedAt : latest, scan.files[0]?.updatedAt || null),
    projectId: coreProjectId,
    moduleId,
  };
  return [scanBinding, ...scan.files.slice(0, 15).map((file) => ({
    kind: "canonical_project_file",
    path: `git://${scan.projectIdentity.canonicalRepoId}/${scan.projectIdentity.baselineHead || "working-tree"}/${encodeURI(file.relativePath)}`,
    title: file.relativePath,
    hash: file.sha256,
    artifactType: file.artifactType,
    updatedAt: file.updatedAt,
    projectId: coreProjectId,
    moduleId,
  }))];
}

function normalizeContinuitySeed(request, scan, coreProjectId) {
  const input = request.continuity && typeof request.continuity === "object" ? request.continuity : {};
  const projectName = compactSafeText(request.projectName || input.projectName || path.basename(scan.workspace), 160);
  const moduleId = compactSafeText(request.moduleId || input.moduleId || `module-${sha256(scan.projectIdentity.canonicalRepoId).slice(0, 20)}`, 180);
  const architectureAnchors = compactSafeList(input.architectureAnchors, 12, 500);
  const standingRules = compactSafeList(input.standingRules, 12, 500);
  const acceptanceCriteria = compactSafeList(input.acceptanceCriteria, 12, 500);
  const safetyRules = compactSafeList(input.safetyRules, 12, 500);
  const acceptedProgress = compactSafeList(input.acceptedProgress, 24, 360);
  const openTasks = compactSafeList(input.openTasks, 24, 360);
  const nextActions = compactSafeList(input.nextActions, 24, 360);
  const threadLineage = compactSafeList(input.threadLineage, 24, 180);
  const openBlockers = compactSafeList(input.openBlockers, 16, 360);
  const latestFailures = compactSafeList(input.latestFailures, 16, 360);
  const required = {
    originalGoal: compactSafeText(input.originalGoal, 700),
    phase: compactSafeText(input.phase, 120),
  };
  if (architectureAnchors.length === 0 || standingRules.length === 0 || acceptanceCriteria.length === 0 || safetyRules.length === 0
      || acceptedProgress.length === 0 || openTasks.length === 0 || nextActions.length === 0 || threadLineage.length === 0) {
    throw new Error("complete_continuity_seed_fields_required");
  }
  const refs = coreSourceRefs(scan, coreProjectId, moduleId);
  if (refs.length === 0) throw new Error("source_backed_seed_required");
  return {
    projectName,
    projectSummary: compactSafeText(input.projectSummary || `${projectName} app-owned Memory Core refresh.`, 500),
    moduleId,
    moduleName: compactSafeText(input.moduleName || projectName, 180),
    modulePurpose: compactSafeText(input.modulePurpose || architectureAnchors[0], 500),
    refs,
    architectureAnchors,
    standingRules,
    acceptanceCriteria,
    safetyRules,
    acceptedProgress,
    openTasks,
    nextActions,
    threadLineage,
    openBlockers,
    latestFailures,
    ...required,
  };
}

function runtimeForWrite(storeRoot) {
  const authoritySigningKey = loadOrCreateSigningKey(storeRoot);
  return createMemoryCoreRuntime({ storeRoot, authoritySigningKey });
}

function runtimeForRead(storeRoot) {
  if (!memoryCorePrivateStateExists(storeRoot)) return null;
  const authoritySigningKey = loadExistingSigningKey(storeRoot);
  return authoritySigningKey ? createMemoryCoreRuntime({ storeRoot, authoritySigningKey }) : null;
}

function optionalContinuitySlots() {
  return ["open_blockers", "latest_failures"];
}

function boundedCheckpointItems(values, maxItems = 4, maxChars = 280) {
  return (Array.isArray(values) ? values : [])
    .map((value) => compactText(value, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function compactContinuity(continuity = {}) {
  return {
    availability: continuity.availability || "not_ready",
    resolutionStatus: continuity.resolutionStatus || "not_ready",
    recoveryReady: continuity.recoveryReady === true,
    coverage: Number(continuity.coverage || 0),
    mandatorySlots: Array.isArray(continuity.mandatorySlots) ? continuity.mandatorySlots.slice(0, 24) : [],
    filledSlots: Array.isArray(continuity.filledSlots) ? continuity.filledSlots.slice(0, 24) : [],
    missingSlots: Array.isArray(continuity.missingSlots) ? continuity.missingSlots.slice(0, 24) : [],
    staleSlots: Array.isArray(continuity.staleSlots) ? continuity.staleSlots.slice(0, 24) : [],
    conflictSlots: Array.isArray(continuity.conflictSlots) ? continuity.conflictSlots.slice(0, 24) : [],
    unsatisfiedSlots: Array.isArray(continuity.unsatisfiedSlots) ? continuity.unsatisfiedSlots.slice(0, 24) : [],
    pagination: {
      complete: continuity.pagination?.complete === true,
      pagesRead: Number(continuity.pagination?.pagesRead || 0),
      mandatoryTotal: Number(continuity.pagination?.mandatoryTotal || 0),
      mandatoryReturned: Number(continuity.pagination?.mandatoryReturned || 0),
      manifestFingerprint: continuity.pagination?.manifestFingerprint || null,
      cursorInvalid: continuity.pagination?.cursorInvalid === true,
    },
    sourceRefs: Array.isArray(continuity.sourceRefs) ? continuity.sourceRefs.slice(0, 16) : [],
    warnings: Array.isArray(continuity.warnings) ? continuity.warnings.slice(0, 24) : [],
  };
}

function assertPacketBytes(packet, maxBytes, label) {
  const bytes = Buffer.byteLength(JSON.stringify(packet), "utf8");
  if (bytes > maxBytes) throw new Error(`${label}_packet_exceeds_${maxBytes}_bytes`);
  return { ...packet, packetBytes: bytes, packetLimitBytes: maxBytes };
}

function authorizedCheckpointWorkingState(runtime, storeRoot, projectIdentity, optionalSlots) {
  const firstPage = runtime.getProjectContinuity({
    projectPath: projectIdentity.canonicalRoot,
    readOnly: true,
    optionalSlots,
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
  });
  const authorizedIds = new Set(firstPage.authorizedCoreIds || []);
  const checkpoint = listProjectCheckpoints(storeRoot, {
    projectId: firstPage.projectId,
    view: "normal",
    limit: 12,
  }).find((record) => authorizedIds.has(record.id));
  if (!checkpoint) return { workingState: {}, checkpointId: null, authorityReceiptId: null };
  const payload = checkpoint.payload || checkpoint;
  const sourceRefs = Array.isArray(payload.sourceRefs) ? payload.sourceRefs : [];
  const record = (value, prefix) => ({
    id: value?.id || `${prefix}-${sha256(value?.title || value).slice(0, 16)}`,
    title: compactText(value?.title || value, 360),
    projectId: firstPage.projectId,
    authorityStatus: "accepted",
    authoritative: true,
    sourceRefs,
    updatedAt: payload.updatedAt || payload.observedAt,
  });
  return {
    checkpointId: checkpoint.id,
    authorityReceiptId: payload.authorityReceiptId || null,
    workingState: {
      acceptedProgress: (payload.acceptedProgress || []).map((value) => record(value, "progress")),
      openTasks: (payload.openTasks || payload.taskStates || []).map((value) => record(value, "task")),
      openBlockers: (payload.blockers || []).map((value) => record(value, "blocker")),
      nextActions: (payload.nextActions || []).map((value) => record(value, "action")),
      threadLineage: (payload.threadLineage || []).map((value) => record(value, "thread")),
      canonicalDocs: (payload.canonicalDocRefs || []).map((value) => ({
        ...record(value?.title || value?.path || value?.uri || value, "document"),
        sourceRefs: [value],
      })),
    },
  };
}

function verifyMemoryCore(request = {}) {
  const { workspace, projectIdentity } = resolveWorkspace(request);
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForRead(storeRoot);
  if (!runtime) {
    return assertPacketBytes({
      schemaVersion: CLI_SCHEMA,
      operation: "verify",
      status: "not_ready",
      current: false,
      recoveryReady: false,
      memoryMode: "fallback_stale",
      authorityVerification: "unavailable",
      workspace,
      projectIdentity,
      continuity: null,
      warnings: ["app_owned_memory_core_private_state_missing"],
    }, MAX_RESUME_PACKET_BYTES, "resume");
  }
  const optionalSlots = Array.isArray(request.optionalSlots)
    ? request.optionalSlots.filter((slot) => ["open_blockers", "latest_failures"].includes(slot))
    : ["open_blockers", "latest_failures"];
  const authorizedCheckpoint = authorizedCheckpointWorkingState(runtime, storeRoot, projectIdentity, optionalSlots);
  const continuityRaw = runtime.getContinuityStatus({
    projectPath: projectIdentity.canonicalRoot,
    taskGoal: compactText(request.taskGoal || request.query || "project recovery verification", 500),
    optionalSlots,
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
    workingState: authorizedCheckpoint.workingState,
  });
  const diagnostics = runtime.getDiagnostics({ projectPath: projectIdentity.canonicalRoot });
  const continuity = compactContinuity(continuityRaw);
  const authorityReceiptCount = Number(diagnostics.counts?.authorityReceipts || 0);
  const currentScan = scanExactWorkspace(request);
  const projectPage = runtime.getProjectContinuity({
    projectPath: projectIdentity.canonicalRoot,
    readOnly: true,
    optionalSlots,
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
    workingState: authorizedCheckpoint.workingState,
  });
  const verifiedReceipt = listAuthorityReceipts(storeRoot, {
    projectId: continuityRaw.projectId,
    view: "all",
    limit: 320,
  }).find((record) => record.id === authorizedCheckpoint.authorityReceiptId);
  const authorizedScanBindings = (verifiedReceipt?.payload?.sourceRefs || verifiedReceipt?.sourceRefs || [])
    .filter((ref) => ref.kind === "workspace_scan_receipt" && ref.projectId === continuityRaw.projectId);
  const matchingScanBinding = authorizedScanBindings.find((ref) => ref.hash === currentScan.scanSha256) || null;
  const baselineAndSourcesCurrent = Boolean(matchingScanBinding);
  const authorityVerified = diagnostics.privateStateReady === true
    && diagnostics.sidecarReady === true
    && authorityReceiptCount > 0
    && continuity.availability === "ready"
    && continuity.pagination.complete === true
    && continuity.pagination.cursorInvalid !== true
    && baselineAndSourcesCurrent;
  const recoveryReady = authorityVerified && continuity.recoveryReady === true;
  return assertPacketBytes({
    schemaVersion: CLI_SCHEMA,
    operation: "verify",
    status: recoveryReady ? "verified" : "not_ready",
    current: recoveryReady,
    recoveryReady,
    memoryMode: recoveryReady ? "app_owned_memory_core" : "fallback_stale",
    authorityVerification: authorityVerified ? "app_owned_verified" : "unavailable",
    workspace,
    projectIdentity,
    memoryCoreProjectId: continuityRaw.projectId || null,
    continuity,
    diagnostics: {
      privateStateReady: diagnostics.privateStateReady === true,
      sidecarReady: diagnostics.sidecarReady === true,
      authorityReceiptCount,
      authorityFilterOrder: diagnostics.authorityFilterOrder || null,
    },
    scanBinding: {
      currentScanSha256: currentScan.scanSha256,
      baselineHead: projectIdentity.baselineHead,
      authorizedBindingCount: authorizedScanBindings.length,
      matched: baselineAndSourcesCurrent,
      matchedPath: matchingScanBinding?.path || null,
      authorizedCheckpointId: authorizedCheckpoint.checkpointId,
    },
    warnings: [
      ...(recoveryReady ? [] : ["full_app_owned_memory_core_not_recovery_ready"]),
      ...(baselineAndSourcesCurrent ? [] : ["workspace_head_or_canonical_sources_changed_reseed_required"]),
      "helper_only_or_unverified_authority_cannot_claim_current",
    ],
  }, MAX_RESUME_PACKET_BYTES, "resume");
}

function seedMemoryCore(request = {}) {
  if (request.execute !== true) throw new Error("seed_execute_true_required");
  const scan = scanExactWorkspace(request);
  if (!request.expectedScanSha256 || request.expectedScanSha256 !== scan.scanSha256) throw new Error("exact_workspace_scan_sha256_mismatch");
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForWrite(storeRoot);
  const coreIdentity = deriveMemoryCoreProjectIdentity({ projectPath: scan.projectIdentity.canonicalRoot });
  const seed = normalizeContinuitySeed(request, scan, coreIdentity.projectId);
  const now = request.now || new Date().toISOString();
  const anchors = [
    { category: "original_goal", title: "Original product goal", statement: seed.originalGoal },
    ...seed.architectureAnchors.map((statement, index) => ({ category: "architecture", title: `Architecture ${index + 1}`, statement })),
    ...seed.standingRules.map((statement, index) => ({ category: "non_negotiable", title: `Standing rule ${index + 1}`, statement })),
    ...seed.acceptanceCriteria.map((statement, index) => ({ category: "acceptance", title: `Acceptance ${index + 1}`, statement })),
    ...seed.safetyRules.map((statement, index) => ({ category: "safety", title: `Safety ${index + 1}`, statement })),
  ].map((anchor) => ({ ...anchor, authorityStatus: "accepted", sourceRefs: seed.refs, updatedAt: now }));
  const seeded = runtime.seedProject({
    projectPath: scan.projectIdentity.canonicalRoot,
    projectName: seed.projectName,
    projectSummary: seed.projectSummary,
    productSummary: seed.projectSummary,
    phase: seed.phase,
    sourceRefs: seed.refs,
    anchors,
    modules: [{
      moduleId: seed.moduleId,
      name: seed.moduleName,
      purpose: seed.modulePurpose,
      currentStatus: "active",
      authorityStatus: "accepted",
      sourceRefs: seed.refs,
      updatedAt: now,
    }],
    now,
  });
  const originalGoalAnchors = listProjectAnchors(storeRoot, { projectId: coreIdentity.projectId, view: "normal", limit: 40 })
    .map((row) => row.payload || row)
    .filter((anchor) => anchor.category === "original_goal");
  const desiredOriginalGoal = originalGoalAnchors.find((anchor) => anchor.statement === seed.originalGoal) || null;
  const supersededOriginalGoals = [];
  if (desiredOriginalGoal) {
    for (const anchor of originalGoalAnchors) {
      if (anchor.anchorId === desiredOriginalGoal.anchorId) continue;
      const result = upsertProjectAnchor(storeRoot, {
        ...anchor,
        authorityStatus: "superseded",
        status: "superseded",
        authoritative: false,
        freshness: "historical",
        supersededBy: desiredOriginalGoal.anchorId,
        updatedAt: now,
      });
      supersededOriginalGoals.push({ anchorId: anchor.anchorId, supersededBy: desiredOriginalGoal.anchorId, action: result.action });
    }
  }
  const checkpoint = runtime.formAppOwnedLifecycleEvent("writeback_evidence", {
    eventType: "checkpoint",
    deterministic: true,
    riskLevel: "low",
    projectPath: scan.projectIdentity.canonicalRoot,
    projectId: coreIdentity.projectId,
    moduleId: seed.moduleId,
    title: `${seed.projectName} verified recovery checkpoint`,
    summary: seed.projectSummary,
    result: seed.acceptedProgress[0],
    phase: seed.phase,
    acceptedProgress: boundedCheckpointItems(seed.acceptedProgress),
    openTasks: boundedCheckpointItems(seed.openTasks),
    nextActions: boundedCheckpointItems(seed.nextActions),
    threads: seed.threadLineage.slice(0, 4).map((threadId) => ({ threadId, title: threadId })),
    artifacts: seed.refs.slice(0, 8).map((ref, index) => ({
      artifactId: `canonical-${index}`,
      title: ref.title,
      path: ref.path,
      hash: ref.hash,
    })),
    sourceRefs: seed.refs,
    observedAt: now,
  }, { now });
  const verified = verifyMemoryCore({ ...request, workspace: scan.workspace, optionalSlots: optionalContinuitySlots(seed) });
  return assertPacketBytes({
    schemaVersion: CLI_SCHEMA,
    operation: "seed",
    status: verified.recoveryReady ? "verified" : "not_ready",
    current: verified.current,
    recoveryReady: verified.recoveryReady,
    memoryMode: verified.memoryMode,
    authorityVerification: verified.authorityVerification,
    workspace: scan.workspace,
    projectIdentity: scan.projectIdentity,
    memoryCoreProjectId: seeded.projectId,
    scanSha256: scan.scanSha256,
    sourceRefs: scan.sourceRefs.slice(0, 16),
    writes: [...seeded.writes, ...supersededOriginalGoals.map((item) => ({ kind: "projectAnchorSupersession", ...item }))].slice(0, 32),
    checkpoint: {
      status: checkpoint.status,
      accepted: checkpoint.accepted === true,
      receiptId: checkpoint.receipt?.receiptId || null,
      reasonCodes: Array.isArray(checkpoint.reasonCodes) ? checkpoint.reasonCodes.slice(0, 24) : [],
      warnings: Array.isArray(checkpoint.warnings) ? checkpoint.warnings.slice(0, 16) : [],
      writes: Array.isArray(checkpoint.writes) ? checkpoint.writes.slice(0, 24) : [],
    },
    continuity: verified.continuity,
    warnings: [
      ...(checkpoint.accepted ? [] : ["app_owned_checkpoint_not_accepted"]),
      ...(verified.recoveryReady ? [] : ["seed_completed_but_continuity_not_ready"]),
    ],
  }, MAX_RESUME_PACKET_BYTES, "resume");
}

function tokenScore(queryTokens, item) {
  if (queryTokens.length === 0) return 1;
  const haystack = `${item.title || ""} ${item.summary || ""} ${item.kind || ""}`.toLowerCase();
  return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function compactVerifiedSourceRefs(values, maxItems = 1) {
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    if (!raw || typeof raw !== "object") continue;
    const ref = Object.fromEntries(Object.entries({
      kind: compactText(raw.kind || "canonical_project_file", 80),
      path: compactText(raw.path || raw.uri || "", 700) || null,
      title: compactText(raw.title || "", 260) || null,
      hash: compactText(raw.hash || raw.sha256 || "", 128) || null,
      artifactType: compactText(raw.artifactType || "", 80) || null,
      updatedAt: compactText(raw.updatedAt || "", 80) || null,
      projectId: compactText(raw.projectId || "", 180) || null,
    }).filter(([, value]) => value !== null));
    if (!safeText(stableStringify(ref))) continue;
    const key = stableStringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
    if (result.length >= maxItems) break;
  }
  return result;
}

function compactVerifiedRecallItem(raw, options = {}) {
  const title = compactText(raw?.title || raw?.summary || options.title || "", 420);
  const summary = compactText(raw?.summary || raw?.statement || raw?.title || options.summary || "", 700);
  if (!title || !summary || !safeText(title) || !safeText(summary)) return null;
  const sourceRefs = compactVerifiedSourceRefs(raw?.sourceRefs || options.sourceRefs, 1);
  if (sourceRefs.length === 0) return null;
  const category = compactText(raw?.category || options.category || "", 80) || null;
  const item = {
    id: compactText(raw?.id || options.id || `${options.kind || "memory"}-${sha256(`${title}:${summary}`).slice(0, 18)}`, 220),
    kind: compactText(options.kind || raw?.memoryCoreKind || raw?.kind || "memory_item", 80),
    ...(category ? { category } : {}),
    title,
    summary,
    status: "accepted",
    freshness: "fresh",
    authorityStatus: "accepted",
    authoritative: true,
    projectId: compactText(raw?.projectId || options.projectId || "", 180) || null,
    authorityReceiptId: compactText(options.authorityReceiptId || raw?.authorityReceiptId || "", 220) || null,
    sourceRefs,
    whyMatched: Array.isArray(options.whyMatched) ? options.whyMatched.slice(0, 6) : ["verified_memory_core_continuity"],
  };
  return { ...item, tokenEstimate: Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(item), "utf8") / 4)) };
}

function verifiedContinuityRecallItems(projectPage, authorizedCheckpoint) {
  const packet = projectPage.continuityPacket || {};
  const project = packet.project || {};
  const workingState = authorizedCheckpoint.workingState || {};
  const priorityCheckpointRefs = (workingState.canonicalDocs || [])
    .filter((record) => /EXAMPLE_PROJECT_CURRENT_CHECKPOINT\.md$/i.test(record?.title || ""))
    .flatMap((record) => record?.sourceRefs || []);
  const checkpointRefs = compactVerifiedSourceRefs([
    ...priorityCheckpointRefs,
    ...Object.values(workingState).flatMap((values) => (Array.isArray(values) ? values : []).flatMap((value) => value?.sourceRefs || [])),
    ...(packet.sourceRefs || []),
  ], 2);
  const common = {
    projectId: projectPage.projectId,
    authorityReceiptId: authorizedCheckpoint.authorityReceiptId,
    sourceRefs: checkpointRefs,
  };
  const items = [];
  const add = (raw, options) => {
    const item = compactVerifiedRecallItem(raw, { ...common, ...options });
    if (item) items.push(item);
  };
  add({
    id: `project-summary-${projectPage.projectId}`,
    title: "Current project summary",
    summary: project.productSummary,
  }, { kind: "project_summary", whyMatched: ["thread_recovery_project_summary"] });
  add({
    id: `project-phase-${projectPage.projectId}`,
    title: "Current project phase",
    summary: project.phase,
  }, { kind: "current_phase", whyMatched: ["thread_recovery_current_phase"] });
  const groups = [
    ["acceptedProgress", "accepted_progress", 6],
    ["openTasks", "open_task", 6],
    ["openBlockers", "open_blocker", 4],
    ["nextActions", "next_action", 6],
    ["threadLineage", "thread_lineage", 4],
    ["canonicalDocs", "canonical_doc", 8],
  ];
  for (const [field, kind, maxItems] of groups) {
    for (const value of (workingState[field] || []).slice(0, maxItems)) {
      add(value, {
        kind,
        sourceRefs: kind === "canonical_doc" ? (value?.sourceRefs || checkpointRefs) : checkpointRefs,
        whyMatched: [`thread_recovery_${kind}`],
      });
    }
  }
  return items;
}

function mergeVerifiedRecallItems(items) {
  const merged = new Map();
  for (const item of items) {
    if (!item) continue;
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      continue;
    }
    const sourceRefs = compactVerifiedSourceRefs([...(existing.sourceRefs || []), ...(item.sourceRefs || [])], 1);
    const whyMatched = [...new Set([...(existing.whyMatched || []), ...(item.whyMatched || [])])].slice(0, 6);
    const next = { ...existing, sourceRefs, whyMatched };
    merged.set(item.id, { ...next, tokenEstimate: Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(next), "utf8") / 4)) });
  }
  return [...merged.values()];
}

function semanticGraphFallback(projectPath, warning) {
  return {
    schemaVersion: "zhixia.semantic_memory_graph.v1",
    attempted: true,
    projectPath,
    projectId: null,
    graphPaths: [],
    hitCount: 0,
    tokenEstimate: 0,
    partial: true,
    warnings: [warning],
    authority: {
      additiveEvidenceOnly: true,
      maySetCurrent: false,
      maySetRecoveryReady: false,
      maySetAuthorityVerification: false,
      mayFillContinuitySlots: false,
      mayAcceptEvidence: false,
    },
    performance: {
      durationMs: 0,
      oneHop: true,
      boundedCandidates: true,
      noRawBodyRead: true,
      noFullTextBodyRead: true,
      noVaultScan: true,
      noBackgroundTimer: true,
      noBackgroundRebuild: true,
    },
  };
}

function retrieveVerifiedSemanticGraph(storeRoot, items, request, verified, tokenBudget) {
  const startedAt = Date.now();
  const projectPath = verified.projectIdentity.canonicalRoot;
  let seedDiagnostics = {
    attempted: true,
    candidatesConsidered: 0,
    eligibleCandidates: 0,
    rejectedCandidates: 0,
    recordsPrepared: 0,
    recordsWritten: 0,
    recordsUnchanged: 0,
    recordsRejected: 0,
    workspaceScans: 0,
    documentEnumerations: 0,
    rawBodyReads: 0,
    fullTextBodyReads: 0,
    vaultScans: 0,
    generatedKnowledgeReads: 0,
    backgroundTimer: false,
    backgroundRebuild: false,
    warnings: [],
  };
  let graph;
  try {
    const seedGraph = buildSemanticGraphSeedFromRuntimeItems(items, {
      projectPath,
      projectName: path.basename(projectPath),
      authorityProjectId: verified.memoryCoreProjectId,
    });
    const writeback = seedGraph.entities.length > 0 || seedGraph.relations.length > 0
      ? upsertSemanticGraphRecords(storeRoot, seedGraph, { projectPath })
      : { entitiesWritten: 0, entitiesUnchanged: 0, relationsWritten: 0, relationsUnchanged: 0, rejected: 0, warnings: [] };
    seedDiagnostics = {
      ...seedGraph.seed,
      recordsWritten: Number(writeback.entitiesWritten || 0) + Number(writeback.relationsWritten || 0),
      recordsUnchanged: Number(writeback.entitiesUnchanged || 0) + Number(writeback.relationsUnchanged || 0),
      recordsRejected: Number(seedGraph.seed?.rejectedCandidates || 0) + Number(writeback.rejected || 0),
      warnings: [...new Set([...(seedGraph.warnings || []), ...(writeback.warnings || [])])].slice(0, 20),
    };
    graph = retrieveSemanticGraphPaths(storeRoot, {
      taskGoal: request.taskGoal || request.query || "",
      queryType: request.queryType || "project_resume",
      projectPath,
      reviewMode: false,
      allowGlobalReview: false,
      maxPaths: Math.max(1, Math.min(Number(request.semanticGraphMaxPaths || 8), 8)),
      tokenBudget: Math.max(120, Math.min(Number(tokenBudget || 600), 800)),
      maxCandidates: Math.max(8, Math.min(Number(request.semanticGraphMaxCandidates || 64), 64)),
      timeBudgetMs: Math.max(25, Math.min(Number(request.semanticGraphTimeBudgetMs || 160), 300)),
    });
  } catch (error) {
    seedDiagnostics.warnings = [`semantic_graph_seed_or_recall_failed_closed:${compactText(error?.message || error, 160)}`];
    graph = semanticGraphFallback(projectPath, "semantic_graph_verified_cli_failed_closed");
  }
  seedDiagnostics.durationMs = Date.now() - startedAt - Number(graph.performance?.durationMs || 0);
  return {
    schemaVersion: graph.schemaVersion,
    attempted: graph.attempted === true,
    projectPath: graph.projectPath,
    projectId: graph.projectId,
    graphPaths: graph.graphPaths,
    hitCount: graph.hitCount,
    tokenEstimate: graph.tokenEstimate,
    partial: graph.partial === true,
    warnings: [...new Set([...(graph.warnings || []), ...(seedDiagnostics.warnings || [])])].slice(0, 16),
    authority: graph.authority,
    seed: {
      attempted: seedDiagnostics.attempted === true,
      candidatesConsidered: seedDiagnostics.candidatesConsidered,
      eligibleCandidates: seedDiagnostics.eligibleCandidates,
      rejectedCandidates: seedDiagnostics.rejectedCandidates,
      recordsPrepared: seedDiagnostics.recordsPrepared,
      recordsWritten: seedDiagnostics.recordsWritten,
      recordsUnchanged: seedDiagnostics.recordsUnchanged,
      recordsRejected: seedDiagnostics.recordsRejected,
      durationMs: Math.max(0, seedDiagnostics.durationMs),
      warnings: (seedDiagnostics.warnings || []).slice(0, 12),
      workspaceScans: 0,
      documentEnumerations: 0,
      rawBodyReads: 0,
      fullTextBodyReads: 0,
    },
    performance: {
      durationMs: Number(graph.performance?.durationMs || 0),
      seedDurationMs: Math.max(0, seedDiagnostics.durationMs),
      totalDurationMs: Date.now() - startedAt,
      oneHop: true,
      entityCandidates: Number(graph.performance?.entityCandidates || 0),
      relationCandidates: Number(graph.performance?.relationCandidates || 0),
      maxPaths: Math.max(1, Math.min(Number(request.semanticGraphMaxPaths || 8), 8)),
      maxCandidates: Math.max(8, Math.min(Number(request.semanticGraphMaxCandidates || 64), 64)),
      verifiedCanonicalScanReused: true,
      additionalWorkspaceScans: 0,
      documentEnumerations: 0,
      rawBodyReads: 0,
      fullTextBodyReads: 0,
      vaultScans: 0,
      backgroundTimer: false,
      backgroundRebuild: false,
    },
  };
}

function withStrictRetrievalMetrics(packet) {
  let measured = { ...packet, tokenEstimate: 0, packetBytes: 0, packetLimitBytes: MAX_RETRIEVAL_PACKET_BYTES };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const packetBytes = Buffer.byteLength(JSON.stringify(measured), "utf8");
    const tokenEstimate = Math.ceil(packetBytes / 4);
    if (packetBytes === measured.packetBytes && tokenEstimate === measured.tokenEstimate) return measured;
    measured = { ...measured, packetBytes, tokenEstimate };
  }
  return measured;
}

function unreadySemanticGraphSupplement(verified, request = {}) {
  const projectPath = verified?.projectIdentity?.canonicalRoot || verified?.workspace || null;
  const createdAt = request.now || new Date().toISOString();
  return {
    ...semanticGraphFallback(projectPath, "semantic_graph_memory_core_unready_no_seed"),
    seed: {
      attempted: false,
      candidatesConsidered: 0,
      eligibleCandidates: 0,
      rejectedCandidates: 0,
      recordsPrepared: 0,
      recordsWritten: 0,
      recordsUnchanged: 0,
      recordsRejected: 0,
      durationMs: 0,
      warnings: ["semantic_graph_seed_skipped_memory_core_unready"],
      workspaceScans: 0,
      documentEnumerations: 0,
      rawBodyReads: 0,
      fullTextBodyReads: 0,
    },
    performance: {
      durationMs: 0,
      seedDurationMs: 0,
      totalDurationMs: 0,
      oneHop: true,
      additionalWorkspaceScans: 0,
      documentEnumerations: 0,
      rawBodyReads: 0,
      fullTextBodyReads: 0,
      vaultScans: 0,
      backgroundTimer: false,
      backgroundRebuild: false,
    },
    triggerReceipt: {
      schemaVersion: "zhixia.memory_runtime_index.v1",
      id: `trigger-semantic-unready-${sha256(`${projectPath || "unknown"}:${createdAt}`).slice(0, 20)}`,
      hook: "semantic_graph_recall",
      queryType: compactText(request.queryType || "project_resume", 80),
      projectPath,
      returnedCount: 0,
      tokenEstimate: 0,
      durationMs: 0,
      partial: true,
      warnings: ["semantic_graph_attempted_memory_core_unready_no_seed"],
      sourceRefs: [],
      createdAt,
      persisted: false,
    },
  };
}

function retrieveMemoryCore(request = {}) {
  const retrievalStartedAt = Date.now();
  const verified = verifyMemoryCore(request);
  if (!verified.recoveryReady) {
    const requestedTokenBudget = Math.max(800, Math.min(Number(request.tokenBudget || 3000), 3000));
    const semanticGraph = unreadySemanticGraphSupplement(verified, request);
    const bounded = withStrictRetrievalMetrics({
      ...verified,
      operation: "retrieve",
      items: [],
      returnedCount: 0,
      semanticGraph,
      safety: {
        rawSessionBodyRead: false,
        semanticGraphRawBodyRead: false,
        semanticGraphWorkspaceRescan: false,
        semanticGraphBackgroundTimer: false,
      },
      performance: {
        bounded: true,
        requestedTokenBudget,
        maxPacketBytes: MAX_RETRIEVAL_PACKET_BYTES,
        semanticGraphAdditionalWorkspaceScans: 0,
        semanticGraphSeedWritten: 0,
        durationMs: Date.now() - retrievalStartedAt,
      },
    });
    if (bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES || bounded.tokenEstimate > requestedTokenBudget) {
      throw new Error("unready_retrieval_packet_cannot_fit_requested_budget");
    }
    return bounded;
  }
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForRead(storeRoot);
  const authorizedCheckpoint = authorizedCheckpointWorkingState(
    runtime,
    storeRoot,
    verified.projectIdentity,
    ["open_blockers", "latest_failures"],
  );
  const projectPage = runtime.getProjectContinuity({
    projectPath: verified.projectIdentity.canonicalRoot,
    readOnly: true,
    optionalSlots: ["open_blockers", "latest_failures"],
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
    workingState: authorizedCheckpoint.workingState,
  });
  const authorizedIds = new Set(projectPage.authorizedCoreIds || []);
  const query = compactText(request.taskGoal || request.query || "", 600);
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean).slice(0, 12);
  const limit = Math.max(1, Math.min(Number(request.limit || 12), 20));
  const continuityItems = verifiedContinuityRecallItems(projectPage, authorizedCheckpoint);
  const coreItems = runtime.listRecallCandidates({ projectPath: verified.projectIdentity.canonicalRoot, queryType: "project_resume" })
    .filter((item) => authorizedIds.has(item.id))
    .map((item) => compactVerifiedRecallItem(compactRecallItem(item), {
      projectId: projectPage.projectId,
      authorityReceiptId: authorizedCheckpoint.authorityReceiptId,
      whyMatched: ["verified_memory_core_candidate"],
    }))
    .filter(Boolean);
  const priority = new Map([
    ["project_summary", 100], ["current_phase", 95], ["accepted_progress", 90], ["open_task", 85],
    ["next_action", 80], ["thread_lineage", 75], ["open_blocker", 70], ["canonical_doc", 40],
    ["projectBrain", 65], ["projectAnchor", 55], ["moduleMemory", 50], ["projectCheckpoint", 45],
  ]);
  const rankedPool = mergeVerifiedRecallItems([...continuityItems, ...coreItems])
    .map((item) => ({
      item,
      queryScore: tokenScore(tokens, item),
      priorityScore: priority.get(item.kind) || 30,
      rankScore: (priority.get(item.kind) || 30) + (tokenScore(tokens, item) * 8),
    }))
    .sort((left, right) => right.rankScore - left.rankScore
      || right.queryScore - left.queryScore
      || String(left.item.id).localeCompare(String(right.item.id)));
  const selectedIds = new Set();
  const selectedRanked = [];
  const select = (entry) => {
    if (!entry || selectedIds.has(entry.item.id) || selectedRanked.length >= limit) return;
    selectedIds.add(entry.item.id);
    selectedRanked.push(entry);
  };
  for (const kind of ["project_summary", "current_phase", "accepted_progress", "open_task", "next_action", "thread_lineage"]) {
    select(rankedPool.find((entry) => entry.item.kind === kind));
  }
  select(rankedPool.find((entry) => entry.item.kind === "projectAnchor" && entry.item.category === "original_goal"));
  select(rankedPool.find((entry) => entry.item.kind === "projectAnchor" && entry.item.category === "architecture"));
  for (const entry of rankedPool) select(entry);
  const rankedItems = selectedRanked
    .map(({ item, queryScore, priorityScore }) => ({
      ...item,
      score: queryScore,
      recoveryPriority: priorityScore,
      authorityVerification: "app_owned_verified",
    }));
  const requestedTokenBudget = Math.max(800, Math.min(Number(request.tokenBudget || 3000), 3000));
  const semanticGraphReserve = Math.max(400, Math.min(900, Math.floor(requestedTokenBudget * 0.27)));
  const itemPacketTokenTarget = Math.max(400, requestedTokenBudget - semanticGraphReserve);
  const packetForItems = (packetItems, graph = null) => ({
    schemaVersion: CLI_SCHEMA,
    operation: "retrieve",
    status: "verified",
    current: true,
    recoveryReady: true,
    memoryMode: "app_owned_memory_core",
    authorityVerification: "app_owned_verified",
    workspace: verified.workspace,
    projectIdentity: verified.projectIdentity,
    memoryCoreProjectId: verified.memoryCoreProjectId,
    request: { taskGoal: query, queryType: compactText(request.queryType || "project_resume", 80), limit },
    items: packetItems,
    returnedCount: packetItems.length,
    tokenEstimate: 0,
    sourceRefs: compactVerifiedSourceRefs(packetItems.flatMap((item) => item.sourceRefs || []), 8),
    continuity: verified.continuity,
    ...(graph ? { semanticGraph: graph } : {}),
    safety: {
      rawSessionBodyRead: false,
      generatedKnowledgeAuthority: false,
      archiveCompactDeleteMoveRestore: false,
      uiRequired: false,
      semanticGraphRawBodyRead: false,
      semanticGraphFullTextBodyRead: false,
      semanticGraphWorkspaceRescan: false,
      semanticGraphDocumentEnumeration: false,
      semanticGraphBackgroundTimer: false,
    },
    performance: {
      bounded: true,
      requestedTokenBudget,
      maxPacketBytes: MAX_RETRIEVAL_PACKET_BYTES,
      semanticGraphReserve,
      semanticGraphSeedCandidateLimit: 24,
      semanticGraphAdditionalWorkspaceScans: 0,
      semanticGraphRawBodyReads: 0,
      semanticGraphFullTextBodyReads: 0,
      semanticGraphBackgroundRebuild: false,
      durationMs: Date.now() - retrievalStartedAt,
    },
    warnings: graph?.partial === true ? ["semantic_graph_recall_partial"] : [],
  });
  let selectedItems = rankedItems;
  let itemOnlyPacket = withStrictRetrievalMetrics(packetForItems(selectedItems));
  while ((itemOnlyPacket.tokenEstimate > itemPacketTokenTarget || itemOnlyPacket.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && selectedItems.length > 1) {
    selectedItems = selectedItems.slice(0, -1);
    itemOnlyPacket = withStrictRetrievalMetrics(packetForItems(selectedItems));
  }
  const graphPathBudget = Math.max(120, Math.min(600, semanticGraphReserve - 320));
  let semanticGraph = retrieveVerifiedSemanticGraph(storeRoot, selectedItems, request, verified, graphPathBudget);
  const originalGraphPathCount = semanticGraph.graphPaths.length;
  const receiptCreatedAt = request.now || new Date().toISOString();
  const receiptId = `trigger-semantic-cli-${sha256(stableStringify({
    projectPath: verified.projectIdentity.canonicalRoot,
    queryType: request.queryType || "project_resume",
    receiptCreatedAt,
  })).slice(0, 20)}`;
  const refreshGraphReceipt = () => {
    const graphTokenEstimate = semanticGraph.graphPaths.reduce((sum, graphPath) => sum + Math.max(24, Math.ceil(Buffer.byteLength(JSON.stringify(graphPath), "utf8") / 4)), 0);
    semanticGraph = {
      ...semanticGraph,
      hitCount: semanticGraph.graphPaths.length,
      tokenEstimate: graphTokenEstimate,
      partial: semanticGraph.partial === true || semanticGraph.graphPaths.length < originalGraphPathCount,
      warnings: [
        ...new Set([
          ...(semanticGraph.warnings || []),
          ...(semanticGraph.graphPaths.length < originalGraphPathCount ? ["semantic_graph_packet_budget_trimmed"] : []),
        ]),
      ].slice(0, 24),
      performance: {
        ...semanticGraph.performance,
        packetPathTokenBudget: graphPathBudget,
        packetPathsTrimmed: originalGraphPathCount - semanticGraph.graphPaths.length,
      },
    };
    const receiptEntry = {
      id: receiptId,
      hook: "semantic_graph_recall",
      queryType: request.queryType || "project_resume",
      projectPath: verified.projectIdentity.canonicalRoot,
      returnedCount: semanticGraph.hitCount,
      tokenEstimate: semanticGraph.tokenEstimate,
      durationMs: semanticGraph.performance?.totalDurationMs || 0,
      partial: semanticGraph.partial === true,
      warnings: [
        "semantic_graph_attempted",
        `semantic_graph_seed_written:${semanticGraph.seed.recordsWritten}`,
        `semantic_graph_seed_unchanged:${semanticGraph.seed.recordsUnchanged}`,
        `semantic_graph_seed_rejected:${semanticGraph.seed.recordsRejected}`,
        ...semanticGraph.warnings,
      ],
      sourceRefs: semanticGraph.graphPaths.flatMap((graphPath) => graphPath.sourceRefs || []).slice(0, 6),
      createdAt: receiptCreatedAt,
    };
    try {
      semanticGraph.triggerReceipt = writeMemoryRuntimeTriggerReceipt(storeRoot, receiptEntry);
    } catch {
      semanticGraph.triggerReceipt = {
        schemaVersion: "zhixia.memory_runtime_index.v1",
        id: receiptId,
        hook: "semantic_graph_recall",
        returnedCount: semanticGraph.hitCount,
        tokenEstimate: semanticGraph.tokenEstimate,
        durationMs: semanticGraph.performance?.totalDurationMs || 0,
        partial: true,
        warnings: ["semantic_graph_trigger_receipt_unavailable_result_preserved"],
        sourceRefs: [],
        createdAt: receiptCreatedAt,
        storageUnavailable: true,
      };
    }
  };
  refreshGraphReceipt();
  let bounded = withStrictRetrievalMetrics(packetForItems(selectedItems, semanticGraph));
  while ((bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && semanticGraph.graphPaths.length > 0) {
    semanticGraph.graphPaths = semanticGraph.graphPaths.slice(0, -1);
    refreshGraphReceipt();
    bounded = withStrictRetrievalMetrics(packetForItems(selectedItems, semanticGraph));
  }
  while ((bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && selectedItems.length > 1) {
    selectedItems = selectedItems.slice(0, -1);
    bounded = withStrictRetrievalMetrics(packetForItems(selectedItems, semanticGraph));
  }
  if (bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) {
    throw new Error("retrieval_packet_cannot_fit_requested_budget");
  }
  return bounded;
}

function compatibilityMarkdown(packet, title) {
  const lines = [
    `# ${title}`,
    "",
    `- Schema: ${packet.schemaVersion}`,
    `- Memory mode: ${packet.memoryMode}`,
    `- Current: ${packet.current}`,
    `- Recovery ready: ${packet.recoveryReady}`,
    `- Authority: ${packet.authorityVerification}`,
    `- Project ID: ${packet.memoryCoreProjectId}`,
    `- Baseline HEAD: ${packet.projectIdentity.baselineHead || "working-tree"}`,
    `- Packet bytes: ${packet.packetBytes}`,
    `- Token estimate: ${packet.tokenEstimate}`,
    "",
    "> Generated compatibility view. Authority remains in the app-owned Memory Core and signed receipts.",
    "> Raw sessions, generated legacy packets, images, base64, credentials, and long logs are not authority sources.",
    "",
    "## Recovery Items",
    "",
  ];
  for (const item of packet.items) {
    lines.push(`### ${item.title}`, "", item.summary, "", `- Kind: ${item.kind}`, `- Freshness: ${item.freshness}`);
    if (item.authorityReceiptId) lines.push(`- Authority receipt: ${item.authorityReceiptId}`);
    const ref = item.sourceRefs?.[0];
    if (ref) lines.push(`- Source: ${ref.title || ref.path || ref.kind}${ref.hash ? ` (${ref.hash})` : ""}`);
    lines.push("");
  }
  const text = `${lines.join("\n").trim()}\n`;
  if (!safeText(text) || Buffer.byteLength(text, "utf8") > MAX_RESUME_PACKET_BYTES) throw new Error("compatibility_markdown_unsafe_or_oversized");
  return text;
}

function resolveKnowledgeOutputRoot(workspace) {
  const knowledgeRoot = path.join(workspace, ".codex-knowledge");
  if (!fs.existsSync(knowledgeRoot)) fs.mkdirSync(knowledgeRoot, { recursive: false });
  const stat = fs.lstatSync(knowledgeRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("knowledge_output_directory_must_be_real_directory");
  const resolved = fs.realpathSync(knowledgeRoot);
  const relative = path.relative(workspace, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("knowledge_output_cross_project_rejected");
  return resolved;
}

function writeCompatibilityPackets(request = {}) {
  if (request.execute !== true) throw new Error("write_compatibility_execute_true_required");
  const retrieved = retrieveMemoryCore({ ...request, operation: "retrieve", queryType: "thread_recovery" });
  if (!retrieved.recoveryReady || retrieved.returnedCount < 1) throw new Error("verified_nonempty_thread_recovery_packet_required");
  if (request.expectedProjectIdentitySha256 !== retrieved.projectIdentity.projectIdentitySha256) throw new Error("project_identity_sha256_mismatch");
  const currentScan = scanExactWorkspace(request);
  if (request.expectedScanSha256 !== currentScan.scanSha256) throw new Error("exact_workspace_scan_sha256_mismatch");
  const knowledgeRoot = resolveKnowledgeOutputRoot(retrieved.workspace);
  const storeRoot = resolveStoreRoot(request);
  const stamp = String(request.now || new Date().toISOString()).replace(/[:.]/g, "-");
  const backupRoot = path.join(storeRoot, "compatibility-backups", retrieved.projectIdentity.projectId, stamp);
  fs.mkdirSync(backupRoot, { recursive: true });
  const packetJson = `${JSON.stringify({
    ...retrieved,
    operation: "thread_recovery_packet",
    generatedKnowledgeAuthority: false,
  }, null, 2)}\n`;
  if (!safeText(packetJson) || Buffer.byteLength(packetJson, "utf8") > MAX_RETRIEVAL_PACKET_BYTES) throw new Error("thread_recovery_packet_unsafe_or_oversized");
  const outputs = new Map([
    ["project-resume.md", compatibilityMarkdown(retrieved, "Project Resume Packet")],
    ["retrieval-packet.md", compatibilityMarkdown(retrieved, "Zhixia Thread Recovery Packet")],
    ["thread-recovery-packet.json", packetJson],
  ]);
  const backupManifest = [];
  for (const fileName of outputs.keys()) {
    const target = path.join(knowledgeRoot, fileName);
    if (!fs.existsSync(target)) continue;
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("compatibility_target_must_be_regular_file");
    const backup = path.join(backupRoot, fileName);
    fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
    backupManifest.push({ fileName, sizeBytes: stat.size, sha256: hashFileBytes(target), backupPath: backup });
  }
  const writes = [];
  const tempPaths = [];
  const manifestPath = path.join(backupRoot, "MANIFEST.json");
  try {
    for (const [fileName, content] of outputs) {
      const target = path.join(knowledgeRoot, fileName);
      const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(5).toString("hex")}`;
      tempPaths.push(temp);
      fs.writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temp, target);
      writes.push({ fileName, path: target, sizeBytes: Buffer.byteLength(content, "utf8"), sha256: hashFileBytes(target) });
    }
    const postWriteVerify = verifyMemoryCore(request);
    if (!postWriteVerify.recoveryReady || postWriteVerify.scanBinding?.currentScanSha256 !== currentScan.scanSha256) {
      throw new Error("workspace_changed_during_compatibility_write");
    }
    const manifest = {
      schemaVersion: "zhixia.compatibility_packet_backup.v1",
      projectIdentity: retrieved.projectIdentity,
      scanSha256: currentScan.scanSha256,
      createdAt: request.now || new Date().toISOString(),
      files: backupManifest,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    for (const temp of tempPaths) {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    const previousByName = new Map(backupManifest.map((item) => [item.fileName, item]));
    for (const written of writes.reverse()) {
      if (!fs.existsSync(written.path) || hashFileBytes(written.path) !== written.sha256) continue;
      const previous = previousByName.get(written.fileName);
      if (previous) fs.copyFileSync(previous.backupPath, written.path);
      else fs.unlinkSync(written.path);
    }
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    throw error;
  }
  return assertPacketBytes({
    schemaVersion: CLI_SCHEMA,
    operation: "write_compatibility",
    status: "written",
    current: true,
    recoveryReady: true,
    memoryMode: "app_owned_memory_core",
    authorityVerification: "app_owned_verified",
    workspace: retrieved.workspace,
    projectIdentity: retrieved.projectIdentity,
    memoryCoreProjectId: retrieved.memoryCoreProjectId,
    scanSha256: currentScan.scanSha256,
    backup: { manifestPath, fileCount: backupManifest.length },
    writes,
    threadRecovery: { returnedCount: retrieved.returnedCount, tokenEstimate: retrieved.tokenEstimate, packetBytes: retrieved.packetBytes },
    safety: { rawSessionBodyRead: false, generatedKnowledgeAuthority: false, archiveCompactDeleteMoveRestore: false, uiRequired: false },
  }, MAX_RESUME_PACKET_BYTES, "compatibility_write_receipt");
}

function execute(request = {}) {
  switch (request.operation || request.action) {
    case "scan": return scanExactWorkspace(request);
    case "seed": return seedMemoryCore(request);
    case "retrieve": return retrieveMemoryCore(request);
    case "verify": return verifyMemoryCore(request);
    case "write_compatibility": return writeCompatibilityPackets(request);
    default: throw new Error("unsupported_memory_runtime_cli_operation");
  }
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(execute(readRequest()))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: CLI_SCHEMA, status: "error", current: false, recoveryReady: false, error: compactText(error?.message || error, 300) })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CLI_SCHEMA,
  MAX_RESUME_PACKET_BYTES,
  MAX_RETRIEVAL_PACKET_BYTES,
  execute,
  retrieveMemoryCore,
  scanExactWorkspace,
  seedMemoryCore,
  verifyMemoryCore,
  writeCompatibilityPackets,
};
