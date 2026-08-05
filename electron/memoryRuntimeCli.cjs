const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  bindExactProjectIdentity,
  compactRecallItem,
  createMemoryCoreRuntime,
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
const MAX_SCAN_CANDIDATES = 4096;
const MAX_WORKTREE_POSTIMAGES = 128;
const MAX_SCANNED_FILE_BYTES = 1024 * 1024;
const MAX_RESUME_PACKET_BYTES = 16 * 1024;
const MAX_RETRIEVAL_PACKET_BYTES = 32 * 1024;
const TRUSTED_WORKSPACE_SCAN_URI_RE = /^memory-runtime:\/\/workspace-scan\/([a-f0-9]{64})$/;
const MAX_TEXT_CHARS = 1200;
const MAX_LIST_ITEMS = 24;
const MAX_CHECKPOINT_SOURCE_REFS = 8;
const MAX_CHECKPOINT_ARTIFACTS = 4;
const ALLOWED_SOURCE_EXTENSIONS = new Set([".md", ".json", ".txt", ".yaml", ".yml"]);
const WORKTREE_TEXT_EXTENSIONS = new Set([
  ...ALLOWED_SOURCE_EXTENSIONS,
  ".c", ".cc", ".cpp", ".css", ".go", ".h", ".hpp", ".html", ".java", ".js", ".jsx",
  ".mjs", ".cjs", ".py", ".rb", ".rs", ".sh", ".sql", ".ts", ".tsx", ".vue", ".xml",
]);
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
const TASK_CARD_PATH_RE = /(?:^|[\/_-])TASK[_-]?CARDS?(?:[\/_.-]|$)/i;
const SENSITIVE_WORKTREE_PATH_RE = /(?:^|\/)(?:\.env(?:$|[._-])|[^/]*(?:credential|keychain|private[_-]?key|secret|access[_-]?token|auth[_-]?token)[^/]*)/i;

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

function exactMemoryCoreInput(projectIdentity, input = {}) {
  return bindExactProjectIdentity({
    ...input,
    projectId: projectIdentity.projectId,
    projectPath: projectIdentity.canonicalRoot,
  }, projectIdentity);
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

function collectChangedSourcePaths(workspace) {
  const changed = new Set();
  const collect = (args) => {
    try {
      const output = execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const item of output.split("\0")) {
        const normalized = item.replace(/\\/g, "/").trim();
        if (normalized) changed.add(normalized);
      }
    } catch {
      // Non-Git workspaces retain stable path-based ordering.
    }
  };
  collect(["diff", "--name-only", "-z"]);
  collect(["diff", "--cached", "--name-only", "-z"]);
  collect(["ls-files", "--others", "--exclude-standard", "-z"]);
  return changed;
}

function workingTreeSnapshot(workspace) {
  const changedPaths = [...collectChangedSourcePaths(workspace)].sort();
  const eligiblePaths = changedPaths.filter((relativePath) => {
    const normalized = relativePath.replace(/\\/g, "/");
    const pathSegments = normalized.toLowerCase().split("/");
    return !pathSegments.some((segment) => SKIP_DIRECTORY_NAMES.has(segment))
      && !SENSITIVE_WORKTREE_PATH_RE.test(normalized)
      && WORKTREE_TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase());
  });
  const entries = [];
  let textPostimagesHashed = 0;
  let excludedBodyCount = changedPaths.length - eligiblePaths.length;
  for (const relativePath of eligiblePaths.slice(0, MAX_WORKTREE_POSTIMAGES)) {
    const normalized = relativePath.replace(/\\/g, "/");
    const filePath = resolveContainedFile(workspace, normalized);
    if (!fs.existsSync(filePath)) {
      entries.push({ relativePath: normalized, state: "deleted", sizeBytes: 0, sha256: null });
      continue;
    }
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_SCANNED_FILE_BYTES) {
      entries.push({ relativePath: normalized, state: "body_excluded", sizeBytes: stats.size, sha256: null });
      excludedBodyCount += 1;
      continue;
    }
    entries.push({ relativePath: normalized, state: "text_postimage", sizeBytes: stats.size, sha256: hashFileBytes(filePath) });
    textPostimagesHashed += 1;
  }
  const core = {
    trackedPathCount: eligiblePaths.length,
    truncated: eligiblePaths.length > MAX_WORKTREE_POSTIMAGES,
    entries,
  };
  return {
    ...core,
    changedPathCount: changedPaths.length,
    excludedPathCount: changedPaths.length - eligiblePaths.length,
    fingerprint: sha256(stableStringify(core)),
    textPostimagesHashed,
    excludedBodyCount,
  };
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
  while (queue.length > 0 && directoriesRead < MAX_SCAN_DIRECTORIES && candidates.size < MAX_SCAN_CANDIDATES) {
    const current = queue.shift();
    directoriesRead += 1;
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (candidates.size >= MAX_SCAN_CANDIDATES) break;
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
  const changedSourcePaths = collectChangedSourcePaths(workspace);
  const dynamicPriority = (relativePath) => {
    const name = relativePath.toUpperCase();
    if (/(?:^|\/)PRD(?:[_./-]|$)/.test(name)) return 700;
    if (/(?:^|[_/-])PROGRAM_GOAL(?:[_./-]|$)/.test(name)) return 680;
    if (/(?:^|[_/-])TASK[_-]?GRAPH(?:[_./-]|$)/.test(name)) return 660;
    if (/CURRENT_CHECKPOINT/.test(name)) return 640;
    if (/PAUSE[_-]?HANDOFF|SAFE[_-]?PAUSE/.test(name)) return 500;
    if (/MIGRATION[_-]?HANDOFF/.test(name)) return 500;
    if (/HANDOFF/.test(name)) return 500;
    if (TASK_CARD_PATH_RE.test(name)) return 520;
    if (/ACCEPTANCE|QA[_-]?REPORT|FORMAL[_-]?QA|(?:^|[_/-])REVISE(?:[_./-]|$)/.test(name)) return 520;
    if (/REVIEWS?\//.test(name)) return 300;
    if (/STATUS|PROGRESS/.test(name)) return 200;
    return 0;
  };
  const sourceDate = (relativePath) => {
    const match = relativePath.match(/(?:19|20)\d{2}[-_](?:0[1-9]|1[0-2])[-_](?:0[1-9]|[12]\d|3[01])/g);
    return Number((match?.at(-1) || "").replace(/[-_]/g, "")) || 0;
  };
  const changedMtime = new Map();
  const changedFileMtime = (relativePath) => {
    if (!changedSourcePaths.has(relativePath)) return 0;
    if (!changedMtime.has(relativePath)) changedMtime.set(relativePath, fs.statSync(resolveContainedFile(workspace, relativePath)).mtimeMs);
    return changedMtime.get(relativePath);
  };
  const recentFirst = (left, right) => Number(changedSourcePaths.has(right)) - Number(changedSourcePaths.has(left))
      || changedFileMtime(right) - changedFileMtime(left)
      || sourceDate(right) - sourceDate(left)
      || right.localeCompare(left);
  const candidateList = [...candidates].filter((item) => !preferredSet.has(item));
  const ranked = candidateList.sort((left, right) => dynamicPriority(right) - dynamicPriority(left) || recentFirst(left, right));
  const selected = [];
  const selectedSet = new Set();
  const select = (values, limit = values.length) => {
    for (const value of values) {
      if (selectedSet.has(value)) continue;
      selected.push(value);
      selectedSet.add(value);
      if (selected.length >= limit) break;
    }
  };
  select(ranked.filter((item) => dynamicPriority(item) >= 600));
  select(ranked.filter((item) => TASK_CARD_PATH_RE.test(item)).sort(recentFirst), selected.length + 4);
  select(ranked.filter((item) => /ACCEPTANCE|QA[_-]?REPORT|FORMAL[_-]?QA|(?:^|[_/-])REVISE(?:[_./-]|$)/i.test(item)).sort(recentFirst), selected.length + 4);
  select(ranked.filter((item) => /HANDOFF/i.test(item)).sort(recentFirst), selected.length + 2);
  select(ranked);
  return {
    candidates: [...preferred, ...selected],
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
  const workingTree = workingTreeSnapshot(workspace);
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
    workingTreeFingerprint: workingTree.fingerprint,
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
    workingTree,
    generatedKnowledge,
    skipped,
    performance: {
      bounded: true,
      maxFiles: MAX_SCAN_FILES,
      maxDirectories: MAX_SCAN_DIRECTORIES,
      maxWorktreePostimages: MAX_WORKTREE_POSTIMAGES,
      directoriesRead,
      textPostimagesHashed: workingTree.textPostimagesHashed,
      excludedWorktreeBodies: workingTree.excludedBodyCount,
      rawSessionBodyRead: false,
    },
    warnings: [
      "scan_is_not_authority_and_cannot_claim_recovery_readiness",
      ...(generatedKnowledge.length > 0 ? ["generated_codex_knowledge_excluded_from_authority_seed"] : []),
      ...(skipped.length > 0 ? ["oversized_canonical_sources_skipped"] : []),
      ...(workingTree.truncated ? ["working_tree_postimages_truncated"] : []),
      ...(workingTree.excludedBodyCount > 0 ? ["non_text_or_sensitive_worktree_bodies_excluded"] : []),
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
  const files = scan.files.slice(0, 15);
  const selected = [];
  const selectedPaths = new Set();
  const select = (pattern, limit) => {
    let added = 0;
    for (const file of files) {
      if (selectedPaths.has(file.relativePath) || !pattern.test(file.relativePath)) continue;
      selected.push(file);
      selectedPaths.add(file.relativePath);
      added += 1;
      if (added >= limit) break;
    }
  };
  select(/(?:^|\/)PRD(?:[_./-]|$)/i, 1);
  select(/PROGRAM[_-]?GOAL/i, 1);
  select(/TASK[_-]?GRAPH/i, 1);
  select(TASK_CARD_PATH_RE, 1);
  select(/ACCEPTANCE|QA[_-]?REPORT|FORMAL[_-]?QA|(?:^|[_/-])REVISE(?:[_./-]|$)/i, 2);
  select(/HANDOFF/i, 1);
  for (const file of files) {
    if (selectedPaths.has(file.relativePath)) continue;
    selected.push(file);
    selectedPaths.add(file.relativePath);
  }
  return [scanBinding, ...selected.slice(0, 15).map((file) => ({
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

function compactCheckpointSourceRefs(refs = [], preferredRefs = []) {
  const values = [...preferredRefs, ...refs];
  const scanBinding = values.find((ref) => ref?.kind === "workspace_scan_receipt") || null;
  const selected = [];
  const seen = new Set();
  const add = (ref) => {
    if (!ref || typeof ref !== "object") return;
    const key = `${ref.path || ""}:${ref.hash || ""}`;
    if (!ref.path || seen.has(key)) return;
    seen.add(key);
    selected.push(ref);
  };
  add(scanBinding);
  for (const ref of values) {
    if (selected.length >= MAX_CHECKPOINT_SOURCE_REFS) break;
    add(ref);
  }
  return selected;
}

function scopedModuleId(projectId, requestedModuleId) {
  const requested = compactSafeText(requestedModuleId || "project-runtime", 180);
  return `module-${sha256(stableStringify({ projectId, requested })).slice(0, 24)}`;
}

function normalizeContinuitySeed(request, scan, coreProjectId) {
  const input = request.continuity && typeof request.continuity === "object" ? request.continuity : {};
  const projectName = compactSafeText(request.projectName || input.projectName || path.basename(scan.workspace), 160);
  const moduleId = scopedModuleId(coreProjectId, request.moduleId || input.moduleId || "project-runtime");
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

function compactRetrievalContinuity(continuity = {}) {
  return {
    availability: continuity.availability || "not_ready",
    resolutionStatus: continuity.resolutionStatus || "not_ready",
    recoveryReady: continuity.recoveryReady === true,
    coverage: Number(continuity.coverage || 0),
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
    warnings: Array.isArray(continuity.warnings) ? continuity.warnings.slice(0, 24) : [],
  };
}

function assertPacketBytes(packet, maxBytes, label) {
  const bytes = Buffer.byteLength(JSON.stringify(packet), "utf8");
  if (bytes > maxBytes) throw new Error(`${label}_packet_exceeds_${maxBytes}_bytes`);
  return { ...packet, packetBytes: bytes, packetLimitBytes: maxBytes };
}

function verifiedMemoryStateHash(verified = {}) {
  return `memory-state-${sha256(stableStringify({
    memoryCoreProjectId: verified.memoryCoreProjectId || null,
    authorityVerification: verified.authorityVerification || "unavailable",
    authorityCheckpointId: verified.scanBinding?.authorizedCheckpointId || null,
    continuityManifest: verified.continuity?.pagination?.manifestFingerprint || null,
    continuityCoverage: Number(verified.continuity?.coverage || 0),
    continuityUnsatisfied: verified.continuity?.unsatisfiedSlots || [],
    current: verified.current === true,
    recoveryReady: verified.recoveryReady === true,
  })).slice(0, 24)}`;
}

function contextGenerationId(verified = {}) {
  return `context-${sha256(stableStringify({
    projectIdentitySha256: verified.projectIdentity?.projectIdentitySha256 || null,
    head: verified.projectIdentity?.baselineHead || null,
    scanHash: verified.scanBinding?.currentScanSha256 || null,
    verifiedMemoryStateHash: verifiedMemoryStateHash(verified),
  })).slice(0, 24)}`;
}

function takeoverControl(verified, returnedCount) {
  const ready = verified.current === true && verified.recoveryReady === true && Number(returnedCount || 0) > 0;
  const reasonCodes = ready ? [] : [...new Set([
    ...(verified.warnings || []),
    ...(verified.continuity?.missingSlots || []).map((slot) => `continuity_missing:${slot}`),
    ...(verified.continuity?.staleSlots || []).map((slot) => `continuity_stale:${slot}`),
    ...(verified.continuity?.conflictSlots || []).map((slot) => `continuity_conflict:${slot}`),
  ])].slice(0, 16);
  return {
    shouldInject: ready,
    injectionMode: ready ? "replace_long_thread_context" : "blocked_fail_closed",
    maxInjectionsPerTask: 1,
    reasonCodes,
    nextAction: ready
      ? "Start a clean takeover task and inject this context generation once."
      : "Keep the old task frozen and repair or verify app-owned Memory Core before takeover.",
  };
}

function authorizedCheckpointWorkingState(runtime, storeRoot, projectIdentity, optionalSlots) {
  const firstPage = runtime.getProjectContinuity(exactMemoryCoreInput(projectIdentity, {
    readOnly: true,
    optionalSlots,
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
  }));
  const authorizedIds = new Set(firstPage.authorizedCoreIds || []);
  const checkpoint = listProjectCheckpoints(storeRoot, {
    projectId: firstPage.projectId,
    view: "normal",
    limit: 12,
  }).find((record) => authorizedIds.has(record.id));
  if (!checkpoint) return { workingState: {}, checkpointId: null, checkpointPayload: null, authorityReceiptId: null };
  const payload = checkpoint.payload || checkpoint;
  const sourceRefs = Array.isArray(payload.sourceRefs) ? payload.sourceRefs : [];
  const authorityReceipt = listAuthorityReceipts(storeRoot, {
    projectId: firstPage.projectId,
    view: "all",
    limit: 100,
  }).find((record) => record.id === payload.authorityReceiptId);
  const authorityPayload = authorityReceipt?.payload || authorityReceipt || {};
  const record = (value, prefix) => ({
    id: value?.id || `${prefix}-${sha256(value?.title || value).slice(0, 16)}`,
    title: compactText(value?.title || value, 360),
    projectId: firstPage.projectId,
    authorityStatus: "accepted",
    authoritative: true,
    sourceRefs: Array.isArray(value?.sourceRefs) && value.sourceRefs.length > 0 ? value.sourceRefs : sourceRefs,
    updatedAt: value?.updatedAt || value?.observedAt || payload.updatedAt || payload.observedAt,
  });
  return {
    checkpointId: checkpoint.id,
    checkpointPayload: payload,
    authorityReceiptId: payload.authorityReceiptId || null,
    authoritySourceRefs: Array.isArray(authorityPayload.sourceRefs) ? authorityPayload.sourceRefs : [],
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
    const currentScan = scanExactWorkspace(request);
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
      scanBinding: {
        currentScanSha256: currentScan.scanSha256,
        baselineHead: projectIdentity.baselineHead,
        authorizedBindingCount: 0,
        matched: false,
        matchedPath: null,
        authorizedCheckpointId: null,
      },
      warnings: ["app_owned_memory_core_private_state_missing"],
    }, MAX_RESUME_PACKET_BYTES, "resume");
  }
  const optionalSlots = Array.isArray(request.optionalSlots)
    ? request.optionalSlots.filter((slot) => ["open_blockers", "latest_failures"].includes(slot))
    : ["open_blockers", "latest_failures"];
  const authorizedCheckpoint = authorizedCheckpointWorkingState(runtime, storeRoot, projectIdentity, optionalSlots);
  const continuityRaw = runtime.getContinuityStatus(exactMemoryCoreInput(projectIdentity, {
    taskGoal: compactText(request.taskGoal || request.query || "project recovery verification", 500),
    optionalSlots,
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
    workingState: authorizedCheckpoint.workingState,
  }));
  const diagnostics = runtime.getDiagnostics(exactMemoryCoreInput(projectIdentity));
  const continuity = compactContinuity(continuityRaw);
  const authorityReceiptCount = Number(diagnostics.counts?.authorityReceipts || 0);
  const currentScan = scanExactWorkspace(request);
  const projectPage = runtime.getProjectContinuity(exactMemoryCoreInput(projectIdentity, {
    readOnly: true,
    optionalSlots,
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
    workingState: authorizedCheckpoint.workingState,
  }));
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
      currentSourceRefs: coreSourceRefs(currentScan, continuityRaw.projectId || projectIdentity.projectId, null).slice(0, 16),
      authorizedBindingCount: authorizedScanBindings.length,
      matched: baselineAndSourcesCurrent,
      matchedPath: matchingScanBinding?.path || null,
      authorizedCheckpointId: authorizedCheckpoint.checkpointId,
    },
    warnings: [
      ...(recoveryReady ? [] : ["full_app_owned_memory_core_not_recovery_ready"]),
      ...(baselineAndSourcesCurrent ? [] : ["workspace_head_or_canonical_sources_changed_reseed_required"]),
      ...(authorityVerified ? [] : ["helper_only_or_unverified_authority_cannot_claim_current"]),
    ],
  }, MAX_RESUME_PACKET_BYTES, "resume");
}

function seedMemoryCore(request = {}) {
  if (request.execute !== true) throw new Error("seed_execute_true_required");
  const scan = scanExactWorkspace(request);
  if (!request.expectedScanSha256 || request.expectedScanSha256 !== scan.scanSha256) throw new Error("exact_workspace_scan_sha256_mismatch");
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForWrite(storeRoot);
  const coreIdentity = { projectId: scan.projectIdentity.projectId, projectPath: scan.projectIdentity.canonicalRoot };
  const seed = normalizeContinuitySeed(request, scan, coreIdentity.projectId);
  const now = request.now || new Date().toISOString();
  const anchors = [
    { category: "original_goal", title: "Original product goal", statement: seed.originalGoal },
    ...seed.architectureAnchors.map((statement, index) => ({ category: "architecture", title: `Architecture ${index + 1}`, statement })),
    ...seed.standingRules.map((statement, index) => ({ category: "non_negotiable", title: `Standing rule ${index + 1}`, statement })),
    ...seed.acceptanceCriteria.map((statement, index) => ({ category: "acceptance", title: `Acceptance ${index + 1}`, statement })),
    ...seed.safetyRules.map((statement, index) => ({ category: "safety", title: `Safety ${index + 1}`, statement })),
  ].map((anchor) => ({ ...anchor, authorityStatus: "accepted", sourceRefs: seed.refs, updatedAt: now }));
  const seeded = runtime.seedProject(exactMemoryCoreInput(scan.projectIdentity, {
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
  }));
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
  const firstRefMatching = (pattern) => seed.refs.find((ref) => pattern.test(ref.title || ref.path || ""));
  const checkpointRefs = compactCheckpointSourceRefs(seed.refs, [
    ...seed.refs.filter((ref) => /PROGRAM[_-]?GOAL/i.test(ref.title || ref.path || "")).slice(0, 2),
    firstRefMatching(/CURRENT[_-]?CHECKPOINT/i),
    firstRefMatching(TASK_CARD_PATH_RE),
    firstRefMatching(/ACCEPTANCE|QA[_-]?REPORT|FORMAL[_-]?QA/i),
    firstRefMatching(/HANDOFF/i),
  ].filter(Boolean));
  const checkpoint = runtime.formAppOwnedLifecycleEvent("writeback_evidence", exactMemoryCoreInput(scan.projectIdentity, {
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
    blockers: boundedCheckpointItems(seed.openBlockers),
    failures: boundedCheckpointItems(seed.latestFailures),
    nextActions: boundedCheckpointItems(seed.nextActions),
    threads: seed.threadLineage.slice(0, 4).map((threadId) => ({ threadId, title: threadId })),
    artifacts: checkpointRefs.slice(0, MAX_CHECKPOINT_ARTIFACTS).map((ref, index) => ({
      artifactId: `canonical-${index}`,
      title: ref.title,
      path: ref.path,
      hash: ref.hash,
    })),
    sourceRefs: checkpointRefs,
    observedAt: now,
  }), { now });
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

const EVIDENCE_TOKEN_STOP_WORDS = new Set([
  "about", "after", "against", "before", "current", "from", "into", "only", "project", "source", "task", "that", "the", "then", "this", "with",
]);

function evidenceTokens(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])]
    .filter((token) => (token.length >= 3 || /\d/.test(token)) && !EVIDENCE_TOKEN_STOP_WORDS.has(token))
    .slice(0, 24);
}

function bestEvidenceRefsForValue(value, candidateRefs = [], fallbackRefs = []) {
  const title = compactText(value?.title || value?.summary || value, 700);
  const tokens = evidenceTokens(title);
  const candidates = compactVerifiedSourceRefs([...candidateRefs, ...fallbackRefs], 16);
  const ranked = candidates.map((ref, index) => {
    const haystack = `${ref.title || ""} ${ref.path || ""}`.toLowerCase();
    const tokenScoreValue = tokens.reduce((score, token) => score + (haystack.includes(token) ? 5 : 0), 0);
    const semanticBonus = (/(?:k3|deepseek|provider|inference|audit|finding|schema|triage)/i.test(title) && /external[_/-]?audit/i.test(haystack) ? 10 : 0)
      + (/block|fail|error|revise|阻塞|失败/i.test(title) && /block|fail|error|revise|diagnostic/i.test(haystack) ? 2 : 0)
      + (/open|next|continue|run|implement|triage|下一步|继续/i.test(title) && TASK_CARD_PATH_RE.test(haystack) ? 2 : 0);
    const scanPenalty = ref.kind === "workspace_scan_receipt" ? -20 : 0;
    return { ref, score: tokenScoreValue + semanticBonus + scanPenalty, index };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const positive = ranked.filter((item) => item.score > 0).map((item) => item.ref);
  const nonScanFallback = [...candidateRefs, ...fallbackRefs].filter((ref) => ref?.kind !== "workspace_scan_receipt");
  return compactVerifiedSourceRefs(positive.length > 0 ? positive : [...nonScanFallback, ...candidateRefs, ...fallbackRefs], 2);
}

function compactVerifiedRecallItem(raw, options = {}) {
  const title = compactText(raw?.title || raw?.summary || options.title || "", 420);
  const summary = compactText(raw?.summary || raw?.statement || raw?.title || options.summary || "", 700);
  if (!title || !summary || !safeText(title) || !safeText(summary)) return null;
  const sourceRefs = compactVerifiedSourceRefs(options.sourceRefs || raw?.sourceRefs, 1);
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

function verifiedContinuityRecallItems(projectPage, authorizedCheckpoint, currentScanRefs = []) {
  const packet = projectPage.continuityPacket || {};
  const project = packet.project || {};
  const workingState = authorizedCheckpoint.workingState || {};
  const priorityCheckpointRefs = (workingState.canonicalDocs || [])
    .filter((record) => /CURRENT[_-]?CHECKPOINT/i.test(record?.title || ""))
    .flatMap((record) => record?.sourceRefs || []);
  const checkpointRefs = compactVerifiedSourceRefs([
    ...priorityCheckpointRefs,
    ...currentScanRefs,
    ...(authorizedCheckpoint.authoritySourceRefs || []),
    ...Object.values(workingState).flatMap((values) => (Array.isArray(values) ? values : []).flatMap((value) => value?.sourceRefs || [])),
    ...(packet.sourceRefs || []),
  ], 16);
  const refsMatching = (patterns, maxItems = 2) => compactVerifiedSourceRefs([
    ...patterns.flatMap((pattern) => checkpointRefs.filter((ref) => pattern.test(`${ref.title || ""} ${ref.path || ""}`))),
    ...checkpointRefs,
  ], maxItems);
  const projectSummaryRefs = refsMatching([/(?:^|\/)PRD(?:[_./-]|$)/i, /PROGRAM[_-]?GOAL/i]);
  const currentPhaseRefs = refsMatching([/PROGRAM[_-]?GOAL/i, /TASK[_-]?GRAPH/i, /ACCEPTANCE|REVISE|QA[_-]?REPORT|FORMAL[_-]?QA/i]);
  const acceptedProgressRefs = refsMatching([
    /MUTATION[_-]?PHASE.*ACCEPTANCE/i,
    /QUALIFICATION[_-]?CUSTODY[_-]?RUNNER.*ACCEPTANCE/i,
    /ACCEPTANCE|QA[_-]?REPORT|FORMAL[_-]?QA/i,
    /(?:^|[_/-])REVISE(?:[_./-]|$)/i,
    TASK_CARD_PATH_RE,
  ], 12);
  const openWorkRefs = refsMatching([/QUALIFICATION[_-]?CUSTODY[_-]?RUNNER/i, TASK_CARD_PATH_RE, /TASK[_-]?GRAPH/i, /PROGRAM[_-]?GOAL/i], 12);
  const blockerRefs = refsMatching([/(?:^|[_/-])REVISE(?:[_./-]|$)/i, /ACCEPTANCE|QA[_-]?REPORT|FORMAL[_-]?QA/i, /PROGRAM[_-]?GOAL/i], 8);
  const lineageRefs = refsMatching([/HANDOFF/i, /PROGRAM[_-]?GOAL/i], 6);
  const common = {
    projectId: projectPage.projectId,
    authorityReceiptId: authorizedCheckpoint.authorityReceiptId,
    sourceRefs: projectSummaryRefs,
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
  }, { kind: "project_summary", sourceRefs: projectSummaryRefs, whyMatched: ["thread_recovery_project_summary"] });
  add({
    id: `project-phase-${projectPage.projectId}`,
    title: "Current project phase",
    summary: project.phase,
  }, { kind: "current_phase", sourceRefs: currentPhaseRefs, whyMatched: ["thread_recovery_current_phase"] });
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
      const fallbackRefs = kind === "canonical_doc"
        ? checkpointRefs
        : kind === "accepted_progress"
          ? acceptedProgressRefs
          : ["open_task", "next_action"].includes(kind)
            ? openWorkRefs
            : kind === "open_blocker"
              ? blockerRefs
              : kind === "thread_lineage"
                ? lineageRefs
                : checkpointRefs;
      add(value, {
        kind,
        sourceRefs: kind === "canonical_doc"
          ? (value?.sourceRefs || checkpointRefs)
          : bestEvidenceRefsForValue(value, value?.sourceRefs || [], fallbackRefs),
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

function compactSemanticGraphPath(graphPath = {}) {
  const compactNode = (node = {}) => ({
    id: compactText(node.id || "", 180) || null,
    kind: compactText(node.kind || "", 80) || null,
    canonicalName: compactText(node.canonicalName || node.name || "", 260) || null,
  });
  return {
    id: compactText(graphPath.id || "", 180) || null,
    from: compactNode(graphPath.from),
    predicate: compactText(graphPath.predicate || "related_to", 100),
    to: compactNode(graphPath.to),
    whyMatched: Array.isArray(graphPath.whyMatched) ? graphPath.whyMatched.map((value) => compactText(value, 120)).filter(Boolean).slice(0, 8) : [],
    sourceRefs: compactVerifiedSourceRefs(graphPath.sourceRefs || [], 1),
    confidence: Number.isFinite(Number(graphPath.confidence)) ? Number(graphPath.confidence) : null,
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

function retrieveMemoryCore(request = {}, options = {}) {
  const retrievalStartedAt = Date.now();
  const verified = verifyMemoryCore(request);
  const responseOperation = options.operation === "prepare_takeover" ? "prepare_takeover" : "retrieve";
  const generationId = contextGenerationId(verified);
  const memoryStateHash = verifiedMemoryStateHash(verified);
  if (!verified.recoveryReady) {
    const requestedTokenBudget = Math.max(800, Math.min(Number(request.tokenBudget || 3000), 3000));
    const semanticGraph = unreadySemanticGraphSupplement(verified, request);
    const bounded = withStrictRetrievalMetrics({
      ...verified,
      operation: responseOperation,
      contextGenerationId: generationId,
      head: verified.projectIdentity?.baselineHead || null,
      scanHash: verified.scanBinding?.currentScanSha256 || null,
      verifiedMemoryStateHash: memoryStateHash,
      items: [],
      returnedCount: 0,
      ...(responseOperation === "prepare_takeover" ? { takeover: takeoverControl(verified, 0) } : {}),
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
  const projectPage = runtime.getProjectContinuity(exactMemoryCoreInput(verified.projectIdentity, {
    readOnly: true,
    optionalSlots: ["open_blockers", "latest_failures"],
    tokenBudget: 2200,
    maxPacketChars: 16000,
    maxPacketItems: 24,
    workingState: authorizedCheckpoint.workingState,
  }));
  const authorizedIds = new Set(projectPage.authorizedCoreIds || []);
  const query = compactText(request.taskGoal || request.query || "", 600);
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean).slice(0, 12);
  const limit = Math.max(1, Math.min(Number(request.limit || 12), 20));
  const continuityItems = verifiedContinuityRecallItems(projectPage, authorizedCheckpoint, verified.scanBinding?.currentSourceRefs || []);
  const coreItems = runtime.listRecallCandidates(exactMemoryCoreInput(verified.projectIdentity, { queryType: "project_resume" }))
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
  const semanticGraphReserve = Math.max(400, Math.min(600, Math.floor(requestedTokenBudget * 0.18)));
  const itemPacketTokenTarget = Math.max(400, requestedTokenBudget - semanticGraphReserve);
  const packetForItems = (packetItems, graph = null) => ({
    schemaVersion: CLI_SCHEMA,
    operation: responseOperation,
    status: "verified",
    current: true,
    recoveryReady: true,
    memoryMode: "app_owned_memory_core",
    authorityVerification: "app_owned_verified",
    workspace: verified.workspace,
    projectIdentity: verified.projectIdentity,
    memoryCoreProjectId: verified.memoryCoreProjectId,
    contextGenerationId: generationId,
    head: verified.projectIdentity?.baselineHead || null,
    scanHash: verified.scanBinding?.currentScanSha256 || null,
    verifiedMemoryStateHash: memoryStateHash,
    request: { taskGoal: query, queryType: compactText(request.queryType || "project_resume", 80), limit },
    items: packetItems,
    returnedCount: packetItems.length,
    ...(responseOperation === "prepare_takeover" ? { takeover: takeoverControl(verified, packetItems.length) } : {}),
    tokenEstimate: 0,
    sourceRefs: compactVerifiedSourceRefs(packetItems.flatMap((item) => item.sourceRefs || []), 8),
    continuity: compactRetrievalContinuity(verified.continuity),
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
  semanticGraph = { ...semanticGraph, graphPaths: semanticGraph.graphPaths.map(compactSemanticGraphPath) };
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
  while ((bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && semanticGraph.graphPaths.length > 1) {
    semanticGraph.graphPaths = semanticGraph.graphPaths.slice(0, -1);
    refreshGraphReceipt();
    bounded = withStrictRetrievalMetrics(packetForItems(selectedItems, semanticGraph));
  }
  while ((bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && selectedItems.length > 1) {
    selectedItems = selectedItems.slice(0, -1);
    bounded = withStrictRetrievalMetrics(packetForItems(selectedItems, semanticGraph));
  }
  while ((bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && semanticGraph.graphPaths.length > 0) {
    semanticGraph.graphPaths = semanticGraph.graphPaths.slice(0, -1);
    refreshGraphReceipt();
    bounded = withStrictRetrievalMetrics(packetForItems(selectedItems, semanticGraph));
  }
  if (bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) {
    throw new Error("retrieval_packet_cannot_fit_requested_budget");
  }
  return bounded;
}

function prepareTakeover(request = {}) {
  return retrieveMemoryCore({ ...request, queryType: request.queryType || "thread_recovery" }, { operation: "prepare_takeover" });
}

function exactWorkspaceWriteBinding(request = {}, operation) {
  if (request.execute !== true) throw new Error(`${operation}_execute_true_required`);
  const scan = scanExactWorkspace(request);
  if (!request.expectedProjectIdentitySha256 || request.expectedProjectIdentitySha256 !== scan.projectIdentity.projectIdentitySha256) {
    throw new Error("exact_project_identity_sha256_mismatch");
  }
  if (!request.expectedScanSha256 || request.expectedScanSha256 !== scan.scanSha256) {
    throw new Error("exact_workspace_scan_sha256_mismatch");
  }
  const payload = request.evidence && typeof request.evidence === "object"
    ? request.evidence
    : request.event && typeof request.event === "object"
      ? request.event
      : request;
  const requestedRefs = Array.isArray(payload.sourceRefs) ? payload.sourceRefs : [];
  if (requestedRefs.length === 0) throw new Error("source_backed_lifecycle_write_required");
  const canonicalFiles = new Map(scan.sourceRefs.map((ref) => [path.resolve(ref.path), ref]));
  for (const entry of scan.workingTree?.entries || []) {
    if (entry.state !== "text_postimage" || !entry.sha256) continue;
    const absolutePath = resolveContainedFile(scan.workspace, entry.relativePath);
    canonicalFiles.set(absolutePath, {
      kind: "workspace_text_postimage",
      path: absolutePath,
      title: entry.relativePath,
      hash: entry.sha256,
      artifactType: "working_tree_postimage",
      updatedAt: null,
    });
  }
  const sourceRefs = [];
  for (const ref of requestedRefs.slice(0, 16)) {
    const rawPath = compactText(ref?.path || ref?.uri || "", 700);
    const workspaceScanMatch = rawPath.match(TRUSTED_WORKSPACE_SCAN_URI_RE);
    if (workspaceScanMatch) {
      const kind = compactText(ref?.kind || "", 80);
      const hash = compactText(ref?.hash || ref?.sha256 || "", 128).toLowerCase();
      const projectId = compactText(ref?.projectId || "", 180) || scan.projectIdentity.projectId;
      if (kind !== "workspace_scan_receipt"
          || workspaceScanMatch[1] !== scan.scanSha256
          || hash !== scan.scanSha256
          || projectId !== scan.projectIdentity.projectId) {
        throw new Error("lifecycle_workspace_scan_receipt_mismatch");
      }
      sourceRefs.push(coreSourceRefs(scan, scan.projectIdentity.projectId, null)[0]);
      continue;
    }
    const uriLike = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawPath) && !/^[A-Za-z]:[\\/]/.test(rawPath);
    if (!rawPath || uriLike) throw new Error("lifecycle_non_file_source_ref_not_trusted");
    const candidatePath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : resolveContainedFile(scan.workspace, rawPath);
    const canonical = canonicalFiles.get(candidatePath);
    if (!canonical || (ref.hash && ref.hash !== canonical.hash)) throw new Error("lifecycle_source_ref_not_in_current_scan");
    sourceRefs.push(canonical);
  }
  return { scan, payload, sourceRefs };
}

function executeLifecycleWrite(operation, request = {}) {
  const { scan, payload, sourceRefs: matchedScanRefs } = exactWorkspaceWriteBinding(request, operation);
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForWrite(storeRoot);
  const project = { projectId: scan.projectIdentity.projectId, projectPath: scan.projectIdentity.canonicalRoot };
  const now = request.now || new Date().toISOString();
  const decision = compactText(payload.decision || (operation === "writeback_evidence" ? "accept" : "observe"), 40).toLowerCase();
  const moduleId = scopedModuleId(project.projectId, payload.moduleId || "project-runtime");
  const matchedTitles = new Set(matchedScanRefs.map((ref) => ref.title));
  const matchedPostimages = matchedScanRefs
    .filter((ref) => ref.kind === "workspace_text_postimage")
    .map((ref) => ({ ...ref, projectId: project.projectId, moduleId }));
  const sourceRefs = [...coreSourceRefs(scan, project.projectId, moduleId)
    .filter((ref) => ref.kind === "workspace_scan_receipt" || matchedTitles.has(ref.title)), ...matchedPostimages]
    .filter((ref, index, values) => values.findIndex((candidate) => candidate.path === ref.path && candidate.hash === ref.hash) === index);
  const previous = authorizedCheckpointWorkingState(runtime, storeRoot, scan.projectIdentity, optionalContinuitySlots());
  const previousStateRefs = Object.values(previous.workingState)
    .flatMap((values) => (Array.isArray(values) ? values : []))
    .flatMap((item) => item?.sourceRefs || []);
  const checkpointRefs = compactCheckpointSourceRefs(sourceRefs, [...matchedPostimages, ...matchedScanRefs, ...previousStateRefs]);
  const previousTitles = (slot) => (previous.workingState[slot] || []).map((item) => item.title).filter(Boolean);
  const preferredList = (value, fallbackSlot, maxItems = 8, maxChars = 320) => {
    const explicit = compactSafeList(value || [], maxItems, maxChars);
    return explicit.length > 0 ? explicit : previousTitles(fallbackSlot).slice(0, maxItems);
  };
  const requestedEventType = compactText(payload.eventType || payload.type || (operation === "writeback_evidence" ? "accepted" : "checkpoint"), 80);
  const explicitBlockers = compactSafeList(payload.openBlockers || payload.blockers || [], 8, 320);
  const carriedBlockers = explicitBlockers.length > 0 ? explicitBlockers : previousTitles("openBlockers").slice(0, 8);
  const eventType = carriedBlockers.length > 0 && explicitBlockers.length === 0 && ["accepted", "test_pass"].includes(requestedEventType)
    ? "checkpoint"
    : requestedEventType;
  const lifecycleInput = {
    eventType,
    deterministic: true,
    riskLevel: "low",
    projectPath: scan.projectIdentity.canonicalRoot,
    projectId: project.projectId,
    moduleId,
    taskId: compactText(payload.taskId || "", 180) || null,
    title: compactSafeText(payload.title || `${operation} evidence`, 240),
    summary: compactSafeText(payload.summary || payload.result || payload.title || `${operation} evidence`, 800),
    result: compactSafeText(payload.result || payload.summary || payload.title || `${operation} evidence`, 500),
    phase: compactText(payload.phase || "", 80) || null,
    acceptedProgress: [...new Set([
      ...previousTitles("acceptedProgress"),
      ...compactSafeList(payload.acceptedProgress || [], 8, 320),
    ])].slice(0, 12),
    openTasks: preferredList(payload.openTasks, "openTasks"),
    blockers: carriedBlockers,
    failures: compactSafeList(payload.latestFailures || payload.failures || [], 8, 360),
    nextActions: preferredList(payload.nextActions, "nextActions"),
    threads: preferredList(payload.threadLineage || payload.threads, "threadLineage", 8, 180).map((threadId) => ({ threadId, title: threadId })),
    artifacts: checkpointRefs.slice(0, MAX_CHECKPOINT_ARTIFACTS).map((ref, index) => ({
      artifactId: `source-${index}`,
      title: ref.title,
      path: ref.path,
      hash: ref.hash,
    })),
    sourceRefs: checkpointRefs,
    observedAt: now,
  };
  const trusted = operation === "observe_event" || ["accept", "accepted"].includes(decision);
  const result = trusted
    ? runtime.formAppOwnedLifecycleEvent(operation, exactMemoryCoreInput(scan.projectIdentity, lifecycleInput), { now })
    : runtime.formLifecycleEvent(operation, exactMemoryCoreInput(scan.projectIdentity, { ...lifecycleInput, decision }), { now });
  const projectRefresh = trusted && result.accepted === true && lifecycleInput.phase
    ? runtime.seedProject(exactMemoryCoreInput(scan.projectIdentity, {
      projectName: compactSafeText(payload.projectName || path.basename(scan.workspace), 160),
      projectSummary: compactSafeText(payload.projectSummary || lifecycleInput.summary, 500),
      phase: lifecycleInput.phase,
      sourceRefs: checkpointRefs,
      now,
    }))
    : null;
  const lifecycleWrites = [
    ...(Array.isArray(result.writes) ? result.writes : []),
    ...(Array.isArray(projectRefresh?.writes) ? projectRefresh.writes : []),
  ];
  return assertPacketBytes({
    schemaVersion: CLI_SCHEMA,
    operation,
    status: result.status,
    current: false,
    recoveryReady: false,
    memoryMode: "app_owned_memory_core",
    authorityVerification: trusted && result.accepted === true ? "app_owned_verified_write" : "review_required",
    workspace: scan.workspace,
    projectIdentity: scan.projectIdentity,
    memoryCoreProjectId: project.projectId,
    scanSha256: scan.scanSha256,
    accepted: result.accepted === true,
    receiptId: result.receipt?.receiptId || null,
    reasonCodes: Array.isArray(result.reasonCodes) ? result.reasonCodes.slice(0, 24) : [],
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 16) : [],
    writes: lifecycleWrites.slice(0, 32).map((write) => ({
      kind: write.kind,
      action: write.action,
      id: write.id || write.record?.id || null,
      status: write.status || write.record?.status || null,
    })),
    safety: { rawSessionBodyRead: false, generatedKnowledgeAuthority: false, exactScanBound: true, uiRequired: false },
  }, MAX_RESUME_PACKET_BYTES, operation);
}

function executeRefreshBinding(request = {}) {
  const { scan, payload, sourceRefs } = exactWorkspaceWriteBinding(request, "refresh_binding");
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForRead(storeRoot);
  if (!runtime) throw new Error("refresh_binding_app_owned_memory_core_required");
  const previous = authorizedCheckpointWorkingState(runtime, storeRoot, scan.projectIdentity, optionalContinuitySlots());
  const expectedCheckpointId = compactText(request.previousCheckpointId || payload.previousCheckpointId, 220);
  if (!expectedCheckpointId || expectedCheckpointId !== previous.checkpointId) {
    throw new Error("refresh_binding_previous_checkpoint_mismatch");
  }
  const acceptedEvidenceReceipt = compactText(request.acceptedEvidenceReceipt || payload.acceptedEvidenceReceipt, 220);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,219}$/.test(acceptedEvidenceReceipt) || !safeText(acceptedEvidenceReceipt)) {
    throw new Error("refresh_binding_accepted_evidence_receipt_required");
  }
  const acceptedChangedPaths = compactSafeList(request.acceptedChangedPaths || payload.acceptedChangedPaths || [], 24, 500)
    .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""));
  if (acceptedChangedPaths.length === 0) throw new Error("refresh_binding_accepted_changed_paths_required");
  const matchedRelativePaths = new Set(sourceRefs
    .filter((ref) => ref.kind !== "workspace_scan_receipt")
    .map((ref) => path.relative(scan.workspace, ref.path).replace(/\\/g, "/")));
  if (acceptedChangedPaths.some((relativePath) => relativePath.startsWith("../") || path.isAbsolute(relativePath) || !matchedRelativePaths.has(relativePath))) {
    throw new Error("refresh_binding_changed_path_not_source_backed");
  }
  const lane = compactSafeText(request.lane || payload.lane || payload.moduleId, 180);
  if (!lane) throw new Error("refresh_binding_lane_required");
  const evidence = {
    ...payload,
    decision: "accept",
    eventType: payload.eventType || "checkpoint",
    moduleId: payload.moduleId || lane,
    taskId: payload.taskId || `refresh-${sha256(`${acceptedEvidenceReceipt}:${scan.scanSha256}`).slice(0, 20)}`,
    title: payload.title || `${lane} accepted binding refresh`,
    summary: payload.summary || `${lane} accepted evidence refreshed the exact workspace binding.`,
    sourceRefs: payload.sourceRefs,
  };
  const writeResult = executeLifecycleWrite("writeback_evidence", { ...request, evidence });
  if (writeResult.accepted !== true || !writeResult.receiptId) throw new Error("refresh_binding_writeback_not_accepted");
  const verified = verifyMemoryCore({ ...request, workspace: scan.workspace });
  if (verified.current !== true || verified.recoveryReady !== true || verified.scanBinding?.currentScanSha256 !== scan.scanSha256) {
    throw new Error("refresh_binding_post_write_verify_failed");
  }
  if (!verified.scanBinding?.authorizedCheckpointId || verified.scanBinding.authorizedCheckpointId === previous.checkpointId) {
    throw new Error("refresh_binding_checkpoint_not_advanced");
  }
  return assertPacketBytes({
    schemaVersion: CLI_SCHEMA,
    operation: "refresh_binding",
    status: "verified",
    current: true,
    recoveryReady: true,
    memoryMode: "app_owned_memory_core",
    authorityVerification: "app_owned_verified",
    workspace: scan.workspace,
    projectIdentity: scan.projectIdentity,
    memoryCoreProjectId: verified.memoryCoreProjectId,
    scanSha256: scan.scanSha256,
    previousCheckpointId: previous.checkpointId,
    authorizedCheckpointId: verified.scanBinding.authorizedCheckpointId,
    acceptedEvidenceReceipt,
    acceptedChangedPaths,
    lane,
    receiptId: writeResult.receiptId,
    contextGenerationId: contextGenerationId(verified),
    continuity: verified.continuity,
    takeover: {
      shouldInject: true,
      injectionMode: "replace_long_thread_context",
      maxInjectionsPerTask: 1,
    },
    safety: {
      rawSessionBodyRead: false,
      generatedKnowledgeAuthority: false,
      exactScanBound: true,
      unacceptedChangeAutoSeeded: false,
      uiRequired: false,
    },
    warnings: [],
  }, MAX_RESUME_PACKET_BYTES, "refresh_binding");
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
    case "prepare_takeover": return prepareTakeover(request);
    case "verify": return verifyMemoryCore(request);
    case "observe_event": return executeLifecycleWrite("observe_event", request);
    case "writeback_evidence": return executeLifecycleWrite("writeback_evidence", request);
    case "refresh_binding": return executeRefreshBinding(request);
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
  executeLifecycleWrite,
  executeRefreshBinding,
  prepareTakeover,
  retrieveMemoryCore,
  scanExactWorkspace,
  seedMemoryCore,
  verifyMemoryCore,
  writeCompatibilityPackets,
};
