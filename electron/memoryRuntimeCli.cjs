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
const {
  assertCompletedRefreshOutcomePublicationSupported,
  buildQueryBasis: buildCompletedRefreshQueryBasis,
  buildRefreshKey: buildCompletedRefreshKey,
  publishCompletedRefreshOutcome,
  queryCompletedRefreshOutcome,
} = require("./completedRefreshOutcomeStore.cjs");
const {
  reconcileAcceptedSlices,
  stageAcceptedSlice,
} = require("./incrementalAcceptanceLedger.cjs");

const CLI_SCHEMA = "zhixia.memory_runtime_cli.v1";
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_SCAN_FILES = 48;
const MAX_SCAN_DIRECTORIES = 48;
const MAX_SCAN_CANDIDATES = 4096;
const MAX_WORKTREE_POSTIMAGES = 128;
const MAX_SCANNED_FILE_BYTES = 1024 * 1024;
const MAX_RESUME_PACKET_BYTES = 16 * 1024;
const MAX_RETRIEVAL_PACKET_BYTES = 48 * 1024;
const MAX_RETRIEVAL_TOKEN_BUDGET = 10_000;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 1_200;
const DEFAULT_TAKEOVER_TOKEN_BUDGET = 2_200;
const ADAPTIVE_TOKEN_BUDGET_STEPS = [1_200, 2_200, 3_000, 5_000, 7_500, 10_000];
const TRUSTED_WORKSPACE_SCAN_URI_RE = /^memory-runtime:\/\/workspace-scan\/([a-f0-9]{64})$/;
const MAX_TEXT_CHARS = 1200;
const MAX_LIST_ITEMS = 24;
const MAX_CHECKPOINT_SOURCE_REFS = 8;
const MAX_CHECKPOINT_ARTIFACTS = 4;
const SCAN_PROFILE_SCHEMA = "zhixia.authorized_scan_profile.v1";
const ACCEPTED_EVIDENCE_RECEIPT_SCHEMA = "zhixia.accepted_evidence_receipt.v1";
const MAX_ACCEPTED_EVIDENCE_RECEIPTS_PER_PROJECT = 256;
const MAX_ACCEPTED_EVIDENCE_RECEIPT_TTL_MS = 60 * 60 * 1000;
const MAX_ACCEPTED_CHANGED_PATHS = 128;
const MAX_LIFECYCLE_SOURCE_REFS = 128;
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

function canonicalRealPath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}
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

function boundedTokenBudget(value, fallback) {
  const parsed = Number(value);
  const selected = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(800, Math.min(Math.floor(selected), MAX_RETRIEVAL_TOKEN_BUDGET));
}

function retrievalBudgetEnvelope(request = {}, operation = "retrieve") {
  const defaultPreferred = operation === "prepare_takeover"
    ? DEFAULT_TAKEOVER_TOKEN_BUDGET
    : DEFAULT_CONTEXT_TOKEN_BUDGET;
  const preferredTokenBudget = boundedTokenBudget(request.tokenBudget, defaultPreferred);
  const strictTokenBudget = request.strictTokenBudget === true;
  const requestedMax = boundedTokenBudget(request.maxTokenBudget, MAX_RETRIEVAL_TOKEN_BUDGET);
  const maxTokenBudget = strictTokenBudget
    ? preferredTokenBudget
    : Math.max(preferredTokenBudget, requestedMax);
  return {
    mode: strictTokenBudget ? "strict" : "adaptive",
    preferredTokenBudget,
    maxTokenBudget,
    hardTokenLimit: MAX_RETRIEVAL_TOKEN_BUDGET,
    strictTokenBudget,
  };
}

function nextAdaptiveTokenBudget(current, maximum) {
  const next = ADAPTIVE_TOKEN_BUDGET_STEPS.find((value) => value > current);
  return Math.min(maximum, next || maximum);
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

function resolveAppOwnedQueryStoreRoot() {
  const account = os.userInfo();
  const home = path.resolve(String(account?.homedir || ""));
  if (!path.isAbsolute(home) || !home || (typeof process.getuid === "function" && account.uid !== process.getuid())) {
    throw new Error("app_owned_query_user_identity_unavailable");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, ["App", "Data"].join(""), "Roaming"), "知匣 Local Doc Knowledge", "memory-runtime");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "知匣 Local Doc Knowledge", "memory-runtime");
  }
  return path.join(home, ".config", "知匣 Local Doc Knowledge", "memory-runtime");
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
  const workspace = canonicalRealPath(path.resolve(request.workspace));
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

function pathIsContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sameCanonicalPath(left, right, platform = process.platform) {
  const normalize = (value) => path.normalize(String(value || ""));
  return platform === "win32"
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : normalize(left) === normalize(right);
}

function inspectContainedScanPath(workspace, relativePath, options = {}) {
  const fsAdapter = options.fsAdapter || fs;
  const reparseDetector = typeof options.reparseDetector === "function" ? options.reparseDetector : () => false;
  const canonicalWorkspace = fsAdapter.realpathSync(path.resolve(workspace));
  const workspaceStats = fsAdapter.lstatSync(canonicalWorkspace);
  const relative = String(relativePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!relative || path.isAbsolute(relative)) throw new Error("workspace_relative_source_path_required");
  const candidate = path.resolve(canonicalWorkspace, relative);
  if (!pathIsContained(canonicalWorkspace, candidate)) throw new Error("cross_project_source_path_rejected");
  const segments = path.relative(canonicalWorkspace, candidate).split(path.sep).filter(Boolean);
  let current = canonicalWorkspace;
  let finalStats = null;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = fsAdapter.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return { path: candidate, canonicalWorkspace, exists: false, stats: null };
      }
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error("workspace_source_symlink_rejected");
    if (reparseDetector(stats, current) === true) throw new Error("workspace_source_reparse_rejected");
    const real = fsAdapter.realpathSync(current);
    if (!pathIsContained(canonicalWorkspace, real)) throw new Error("cross_project_source_realpath_rejected");
    if (!sameCanonicalPath(current, real, options.platform)) throw new Error("workspace_source_reparse_rejected");
    if (stats.dev !== workspaceStats.dev) throw new Error("workspace_source_mount_rejected");
    finalStats = stats;
  }
  return { path: candidate, canonicalWorkspace, exists: true, stats: finalStats };
}

function resolveContainedFile(workspace, relativePath) {
  return inspectContainedScanPath(workspace, relativePath).path;
}

function openContainedScanFile(workspace, relativePath, options = {}) {
  const fsAdapter = options.fsAdapter || fs;
  const inspected = inspectContainedScanPath(workspace, relativePath, options);
  if (!inspected.exists) throw new Error("workspace_required_source_missing");
  if (!inspected.stats?.isFile()) throw new Error("workspace_source_regular_file_required");
  const flags = fsAdapter.constants.O_RDONLY | fsAdapter.constants.O_NOFOLLOW;
  let fd;
  try {
    fd = fsAdapter.openSync(inspected.path, flags);
    const openedStats = fsAdapter.fstatSync(fd);
    if (!openedStats.isFile()
        || openedStats.dev !== inspected.stats.dev
        || openedStats.ino !== inspected.stats.ino) {
      throw new Error("workspace_source_identity_changed");
    }
    const bytes = fsAdapter.readFileSync(fd);
    return { ...inspected, bytes: Buffer.from(bytes), stats: openedStats };
  } catch (error) {
    if (["ELOOP", "EMLINK"].includes(error?.code)) throw new Error("workspace_source_symlink_rejected");
    throw error;
  } finally {
    if (fd !== undefined) fsAdapter.closeSync(fd);
  }
}

function hashCanonicalTextBytes(bytes) {
  const canonicalText = Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
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

function collectHeadSourcePaths(workspace) {
  let output;
  try {
    output = execFileSync("git", ["ls-files", "--cached", "-z", "--"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const paths = new Set();
  for (const item of output.split("\0")) {
    const normalized = item.replace(/\\/g, "/").trim();
    if (!normalized || path.isAbsolute(normalized)) continue;
    const segments = normalized.toLowerCase().split("/");
    if (segments.some((segment) => SKIP_DIRECTORY_NAMES.has(segment))) continue;
    if (SENSITIVE_WORKTREE_PATH_RE.test(normalized)) continue;
    if (!WORKTREE_TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase())) continue;
    const inspected = inspectContainedScanPath(workspace, normalized);
    if (!inspected.exists) continue;
    if (!inspected.stats.isFile() || inspected.stats.size > MAX_SCANNED_FILE_BYTES) continue;
    paths.add(normalized);
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function eligibleTrackedSourcePath(workspace, value) {
  const normalized = String(value || "").replace(/\\\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalized || path.isAbsolute(normalized) || normalized.startsWith("docs/") || ROOT_SOURCE_FILES.includes(normalized)) return null;
  const segments = normalized.toLowerCase().split("/");
  if (segments.some((segment) => SKIP_DIRECTORY_NAMES.has(segment))) return null;
  if (SENSITIVE_WORKTREE_PATH_RE.test(normalized)) return null;
  if (!WORKTREE_TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return null;
  const inspected = inspectContainedScanPath(workspace, normalized);
  if (!inspected.exists) return null;
  if (!inspected.stats.isFile() || inspected.stats.size > MAX_SCANNED_FILE_BYTES) return null;
  return normalized;
}

function collectRangeSourcePaths(workspace, fromHead, toHead) {
  if (!/^[a-f0-9]{40,64}$/.test(String(fromHead || ""))
      || !/^[a-f0-9]{40,64}$/.test(String(toHead || ""))
      || fromHead === toHead) return [];
  let output;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", fromHead, toHead], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    output = execFileSync("git", ["diff", "--name-only", "-z", `${fromHead}..${toHead}`, "--"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  return [...new Set(output.split("\0")
    .map((item) => eligibleTrackedSourcePath(workspace, item))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function collectRangeDeltaForReconciliation(workspace, fromHead, toHead) {
  if (!/^[a-f0-9]{40,64}$/.test(String(fromHead || ""))
      || !/^[a-f0-9]{40,64}$/.test(String(toHead || ""))
      || fromHead === toHead) return { paths: [], excludedCount: 0 };
  let output;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", fromHead, toHead], {
      cwd: workspace, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"],
    });
    output = execFileSync("git", ["diff", "--name-only", "-z", `${fromHead}..${toHead}`, "--"], {
      cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return { paths: [], excludedCount: 0 };
  }
  const paths = [];
  let excludedCount = 0;
  for (const item of output.split("\0")) {
    const normalized = item.replace(/\\/g, "/").trim();
    if (!normalized) continue;
    const segments = normalized.toLowerCase().split("/");
    if (path.isAbsolute(normalized) || segments.some((segment) => SKIP_DIRECTORY_NAMES.has(segment))
        || SENSITIVE_WORKTREE_PATH_RE.test(normalized)
        || !WORKTREE_TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
      excludedCount += 1;
      continue;
    }
    paths.push(normalized);
  }
  return { paths: [...new Set(paths)].sort((left, right) => left.localeCompare(right)), excludedCount };
}

function authorizedScanProfilePath(storeRoot, projectId, scanSha256) {
  if (!/^project-[a-f0-9]{24}$/.test(String(projectId || "")) || !/^[a-f0-9]{64}$/.test(String(scanSha256 || ""))) {
    throw new Error("authorized_scan_profile_identity_invalid");
  }
  return path.join(storeRoot, "scan-profiles", projectId, `${scanSha256}.json`);
}

function readAuthorizedScanProfile(storeRoot, projectId, scanSha256) {
  try {
    const profilePath = authorizedScanProfilePath(storeRoot, projectId, scanSha256);
    if (!fs.existsSync(profilePath)) return null;
    const stats = fs.lstatSync(profilePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REQUEST_BYTES) return null;
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    if (profile?.schemaVersion !== SCAN_PROFILE_SCHEMA
        || profile.projectId !== projectId
        || profile.scanSha256 !== scanSha256
        || !/^[a-f0-9]{40,64}$/.test(String(profile.baselineHead || ""))
        || !Array.isArray(profile.files)
        || profile.files.length === 0
        || profile.files.length > MAX_SCAN_FILES) return null;
    const files = profile.files.map((file) => ({
      relativePath: String(file?.relativePath || "").replace(/\\\\/g, "/").replace(/^\.\//, ""),
      sha256: String(file?.sha256 || "").toLowerCase(),
    }));
    if (files.some((file) => !file.relativePath || path.isAbsolute(file.relativePath)
        || file.relativePath.startsWith("../") || !/^[a-f0-9]{64}$/.test(file.sha256))) return null;
    return { baselineHead: profile.baselineHead, relativePaths: files.map((file) => file.relativePath) };
  } catch {
    return null;
  }
}

function persistAuthorizedScanProfile(storeRoot, scan) {
  const profilePath = authorizedScanProfilePath(storeRoot, scan.projectIdentity.projectId, scan.scanSha256);
  const profile = {
    schemaVersion: SCAN_PROFILE_SCHEMA,
    projectId: scan.projectIdentity.projectId,
    projectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
    baselineHead: scan.projectIdentity.baselineHead,
    scanSha256: scan.scanSha256,
    files: scan.files
      .map((file) => ({ relativePath: file.relativePath, sha256: file.sha256 }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
  const serialized = `${JSON.stringify(profile)}\n`;
  fs.mkdirSync(path.dirname(profilePath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(profilePath)) {
    if (fs.readFileSync(profilePath, "utf8") !== serialized) throw new Error("authorized_scan_profile_conflict");
    return { action: "noop", path: profilePath };
  }
  const temporaryPath = `${profilePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, profilePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return { action: "insert", path: profilePath };
}

function acceptedEvidenceReceiptStorePath(storeRoot, projectId) {
  if (!/^project-[a-f0-9]{24}$/.test(String(projectId || ""))) throw new Error("accepted_evidence_receipt_project_invalid");
  return path.join(storeRoot, "accepted-evidence-receipts", `${projectId}.json`);
}

function acceptedEvidencePathDigest(paths) {
  return sha256(stableStringify([...new Set(paths)].sort((left, right) => left.localeCompare(right))));
}

function validateAcceptedChangedPaths(scan, values) {
  const paths = compactSafeList(values || [], MAX_ACCEPTED_CHANGED_PATHS, 500)
    .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""));
  if (paths.length === 0) throw new Error("refresh_binding_accepted_changed_paths_required");
  const sourcePaths = new Set([
    ...scan.files.map((file) => file.relativePath),
    ...(scan.workingTree?.entries || [])
      .filter((entry) => entry.state === "text_postimage" && entry.sha256)
      .map((entry) => entry.relativePath),
  ]);
  for (const relativePath of paths) {
    if (relativePath.startsWith("../") || path.isAbsolute(relativePath) || !sourcePaths.has(relativePath)) {
      throw new Error("refresh_binding_changed_path_not_source_backed");
    }
    inspectContainedScanPath(scan.workspace, relativePath);
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function acceptedEvidenceReceiptProof(signingKey, binding) {
  return crypto.createHmac("sha256", signingKey).update(stableStringify(binding)).digest("hex");
}

function readAcceptedEvidenceReceiptStore(storeRoot, projectId) {
  const storePath = acceptedEvidenceReceiptStorePath(storeRoot, projectId);
  if (!fs.existsSync(storePath)) return { storePath, data: { schemaVersion: ACCEPTED_EVIDENCE_RECEIPT_SCHEMA, projectId, receipts: [] } };
  const stats = fs.lstatSync(storePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REQUEST_BYTES * 4) {
    throw new Error("accepted_evidence_receipt_store_invalid");
  }
  const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
  if (data?.schemaVersion !== ACCEPTED_EVIDENCE_RECEIPT_SCHEMA || data.projectId !== projectId || !Array.isArray(data.receipts)
      || data.receipts.length > MAX_ACCEPTED_EVIDENCE_RECEIPTS_PER_PROJECT) {
    throw new Error("accepted_evidence_receipt_store_invalid");
  }
  return { storePath, data };
}

function writeAcceptedEvidenceReceiptStoreUnlocked(storePath, data, options = {}) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dirStats = fs.lstatSync(dir);
  if (!dirStats.isDirectory() || dirStats.isSymbolicLink()) throw new Error("accepted_evidence_receipt_store_invalid");
  const temporaryPath = `${storePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    const serialized = `${JSON.stringify(data)}\n`;
    fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const temporaryFd = fs.openSync(temporaryPath, (options.platform || process.platform) === "win32" ? "r+" : "r");
    try { fs.fsyncSync(temporaryFd); } finally { fs.closeSync(temporaryFd); }
    fs.renameSync(temporaryPath, storePath);
    let directorySync;
    if ((options.platform || process.platform) === "win32") {
      directorySync = { status: "deferred_unverified", reason: "windows_directory_fsync_unavailable" };
    } else {
      const dirFd = fs.openSync(dir, "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      directorySync = { status: "verified", reason: null };
    }
    return { fileSync: "verified", directorySync };
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function mutateAcceptedEvidenceReceiptStore(storeRoot, projectId, mutate, options = {}) {
  const storePath = acceptedEvidenceReceiptStorePath(storeRoot, projectId);
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const lockPath = `${storePath}.lock`;
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, "wx", 0o600);
    const { data } = readAcceptedEvidenceReceiptStore(storeRoot, projectId);
    const result = mutate(data);
    const persistence = writeAcceptedEvidenceReceiptStoreUnlocked(storePath, data, options);
    return { value: result, persistence };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("accepted_evidence_receipt_store_busy");
    throw error;
  } finally {
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    }
  }
}

function acceptedEvidenceBinding(scan, previousCheckpointId, acceptedChangedPaths, lane, decision, issuer, issuedAt, expiresAt, nonce) {
  return {
    schemaVersion: ACCEPTED_EVIDENCE_RECEIPT_SCHEMA,
    workspace: scan.workspace,
    projectId: scan.projectIdentity.projectId,
    projectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
    previousCheckpointId,
    targetScanSha256: scan.scanSha256,
    acceptedPathDigest: acceptedEvidencePathDigest(acceptedChangedPaths),
    lane,
    decision,
    issuer,
    issuedAt,
    expiresAt,
    nonce,
  };
}

function trustedAuthorityNowMs(options = {}) {
  const value = typeof options.clock === "function" ? options.clock() : Date.now();
  if (!Number.isFinite(value)) throw new Error("accepted_evidence_receipt_time_invalid");
  return Math.floor(value);
}

function issueAcceptedEvidenceReceiptFromApp(request = {}, options = {}) {
  if (request.execute !== true) throw new Error("issue_accepted_evidence_receipt_execute_true_required");
  const initialPaths = compactSafeList(request.acceptedChangedPaths || [], MAX_ACCEPTED_CHANGED_PATHS, 500);
  const scan = scanExactWorkspace({
    ...request,
    relativePaths: [...new Set([...(Array.isArray(request.relativePaths) ? request.relativePaths : []), ...initialPaths])].slice(0, MAX_SCAN_FILES),
  });
  if (request.expectedProjectIdentitySha256 !== scan.projectIdentity.projectIdentitySha256) throw new Error("exact_project_identity_sha256_mismatch");
  if (request.expectedScanSha256 !== scan.scanSha256) throw new Error("exact_workspace_scan_sha256_mismatch");
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForRead(storeRoot);
  if (!runtime) throw new Error("accepted_evidence_receipt_app_owned_memory_core_required");
  const previous = authorizedCheckpointWorkingState(runtime, storeRoot, scan.projectIdentity, optionalContinuitySlots());
  const previousCheckpointId = compactText(request.previousCheckpointId, 220);
  if (!previousCheckpointId || previousCheckpointId !== previous.checkpointId) throw new Error("refresh_binding_previous_checkpoint_mismatch");
  const acceptedChangedPaths = validateAcceptedChangedPaths(scan, initialPaths);
  const lane = compactSafeText(request.lane, 180);
  const decision = compactText(request.decision, 32);
  const issuer = "zhixia.app.memory-runtime";
  if (decision !== "accept") throw new Error("accepted_evidence_receipt_accept_decision_required");
  const issuedMs = trustedAuthorityNowMs(options);
  const expiresMs = issuedMs + MAX_ACCEPTED_EVIDENCE_RECEIPT_TTL_MS;
  const issuedAt = new Date(issuedMs).toISOString();
  const expiresAt = new Date(expiresMs).toISOString();
  const signingKey = loadOrCreateSigningKey(storeRoot);
  const binding = acceptedEvidenceBinding(
    scan, previousCheckpointId, acceptedChangedPaths, lane, decision, issuer, issuedAt, expiresAt, crypto.randomBytes(24).toString("hex"),
  );
  const proof = acceptedEvidenceReceiptProof(signingKey, binding);
  const receiptId = `accepted-evidence-${sha256(`${proof}:${binding.nonce}`).slice(0, 32)}`;
  const mutation = mutateAcceptedEvidenceReceiptStore(storeRoot, scan.projectIdentity.projectId, (data) => {
    if (data.receipts.some((receipt) => receipt.receiptId === receiptId)) throw new Error("accepted_evidence_receipt_conflict");
    const active = data.receipts.filter((receipt) => receipt.status === "issued" && Date.parse(receipt.binding?.expiresAt || "") > issuedMs);
    if (active.length >= MAX_ACCEPTED_EVIDENCE_RECEIPTS_PER_PROJECT) throw new Error("accepted_evidence_receipt_store_capacity_reached");
    const historical = data.receipts.filter((receipt) => !active.includes(receipt)).slice(-Math.max(0, MAX_ACCEPTED_EVIDENCE_RECEIPTS_PER_PROJECT - active.length - 1));
    data.receipts = [...historical, ...active, { receiptId, binding, proof, status: "issued", consumedAt: null, consumedBy: null }];
  }, options);
  return assertPacketBytes({
    schemaVersion: CLI_SCHEMA,
    operation: "issue_accepted_evidence_receipt",
    status: "issued",
    workspace: scan.workspace,
    projectIdentity: scan.projectIdentity,
    receiptId,
    receiptDigest: sha256(stableStringify({ binding, proof })),
    targetScanSha256: scan.scanSha256,
    previousCheckpointId,
    acceptedPathDigest: binding.acceptedPathDigest,
    lane,
    decision,
    issuer,
    issuedAt,
    expiresAt,
    oneTimeUse: true,
    persistence: mutation.persistence,
    safety: { proofExposed: false, nonceExposed: false, signingKeyExposed: false, rawSessionBodyRead: false },
  }, MAX_RESUME_PACKET_BYTES, "accepted_evidence_receipt");
}

function validateAcceptedEvidenceReceipt(receipt, signingKey, scan, previousCheckpointId, acceptedChangedPaths, lane, nowMs) {
  const receiptId = String(receipt?.receiptId || "");
  if (!receipt) throw new Error("accepted_evidence_receipt_not_found");
  if (receipt.status === "consumed") throw new Error("accepted_evidence_receipt_already_consumed");
  if (receipt.status !== "issued") throw new Error("accepted_evidence_receipt_status_invalid");
  const binding = receipt.binding || {};
  const expectedProof = acceptedEvidenceReceiptProof(signingKey, binding);
  const actualProof = String(receipt.proof || "");
  if (!/^[a-f0-9]{64}$/.test(actualProof) || !crypto.timingSafeEqual(Buffer.from(actualProof), Buffer.from(expectedProof))) {
    throw new Error("accepted_evidence_receipt_proof_invalid");
  }
  if (receiptId !== `accepted-evidence-${sha256(`${actualProof}:${binding.nonce}`).slice(0, 32)}`) {
    throw new Error("accepted_evidence_receipt_id_invalid");
  }
  if (Date.parse(binding.issuedAt || "") > nowMs || Date.parse(binding.expiresAt || "") <= nowMs) {
    throw new Error("accepted_evidence_receipt_expired");
  }
  const expected = acceptedEvidenceBinding(
    scan, previousCheckpointId, acceptedChangedPaths, lane, "accept", binding.issuer, binding.issuedAt, binding.expiresAt, binding.nonce,
  );
  if (stableStringify(binding) !== stableStringify(expected)) throw new Error("accepted_evidence_receipt_binding_mismatch");
  return {
    receiptId,
    receiptDigest: sha256(stableStringify({ binding, proof: actualProof })),
    issuer: binding.issuer,
    issuedAt: binding.issuedAt,
    expiresAt: binding.expiresAt,
  };
}

function consumeAcceptedEvidenceReceipt(storeRoot, scan, request, previousCheckpointId, acceptedChangedPaths, lane, options = {}) {
  const receiptId = compactText(request.acceptedEvidenceReceipt || request.evidence?.acceptedEvidenceReceipt, 220);
  if (!/^accepted-evidence-[a-f0-9]{32}$/.test(receiptId)) throw new Error("refresh_binding_accepted_evidence_receipt_invalid");
  const signingKey = loadExistingSigningKey(storeRoot);
  if (!signingKey) throw new Error("accepted_evidence_receipt_authority_unavailable");
  const nowMs = trustedAuthorityNowMs(options);
  const mutation = mutateAcceptedEvidenceReceiptStore(storeRoot, scan.projectIdentity.projectId, (data) => {
    const receipt = data.receipts.find((candidate) => candidate.receiptId === receiptId);
    const validated = validateAcceptedEvidenceReceipt(
      receipt, signingKey, scan, previousCheckpointId, acceptedChangedPaths, lane, nowMs,
    );
    receipt.status = "consumed";
    receipt.consumedAt = new Date(nowMs).toISOString();
    receipt.consumedBy = sha256(stableStringify({ projectId: scan.projectIdentity.projectId, scanSha256: scan.scanSha256, previousCheckpointId, lane }));
    return validated;
  }, options);
  return { ...mutation.value, persistence: mutation.persistence };
}

function inspectAcceptedEvidenceReceipt(storeRoot, scan, request, previousCheckpointId, acceptedChangedPaths, lane, options = {}) {
  const receiptId = compactText(request.acceptedEvidenceReceipt || request.evidence?.acceptedEvidenceReceipt, 220);
  if (!/^accepted-evidence-[a-f0-9]{32}$/.test(receiptId)) throw new Error("refresh_binding_accepted_evidence_receipt_invalid");
  const signingKey = loadExistingSigningKey(storeRoot);
  if (!signingKey) throw new Error("accepted_evidence_receipt_authority_unavailable");
  const nowMs = trustedAuthorityNowMs(options);
  const { data } = readAcceptedEvidenceReceiptStore(storeRoot, scan.projectIdentity.projectId);
  const receipt = data.receipts.find((candidate) => candidate.receiptId === receiptId);
  return validateAcceptedEvidenceReceipt(
    receipt, signingKey, scan, previousCheckpointId, acceptedChangedPaths, lane, nowMs,
  );
}

function consumeAcceptedEvidenceReceiptForTest(request = {}, options = {}) {
  if (options.testOnly !== true) throw new Error("accepted_evidence_receipt_test_only_required");
  const acceptedPaths = compactSafeList(request.acceptedChangedPaths || [], MAX_ACCEPTED_CHANGED_PATHS, 500);
  const scan = options.scanEnvelope;
  if (!scan?.workspace || !scan?.projectIdentity?.projectId || !scan?.scanSha256) {
    throw new Error("accepted_evidence_receipt_test_scan_required");
  }
  const storeRoot = resolveStoreRoot(request);
  const acceptedChangedPaths = validateAcceptedChangedPaths(scan, acceptedPaths);
  const previousCheckpointId = compactText(request.previousCheckpointId, 220);
  const lane = compactSafeText(request.lane, 180);
  return consumeAcceptedEvidenceReceipt(
    storeRoot, scan, request, previousCheckpointId, acceptedChangedPaths, lane, options,
  );
}

function authorizedScanProfile(request, projectIdentity) {
  try {
    const storeRoot = resolveStoreRoot(request);
    const runtime = runtimeForRead(storeRoot);
    if (!runtime) return { baselineHead: null, relativePaths: [] };
    const checkpoint = authorizedCheckpointWorkingState(runtime, storeRoot, projectIdentity, []);
    const refs = checkpoint.authoritySourceRefs || [];
    const scanBinding = refs.find((ref) => ref?.kind === "workspace_scan_receipt") || null;
    const baselineHead = String(scanBinding?.title || "").match(/\bat ([a-f0-9]{40,64})$/i)?.[1]?.toLowerCase() || null;
    const persisted = scanBinding?.hash
      ? readAuthorizedScanProfile(storeRoot, projectIdentity.projectId, String(scanBinding.hash).toLowerCase())
      : null;
    if (persisted) return persisted;
    const relativePaths = refs
      .filter((ref) => ref?.kind === "canonical_project_file" && typeof ref.title === "string")
      .map((ref) => String(ref.title).replace(/\\\\/g, "/").replace(/^\.\//, ""))
      .filter((value) => value && !path.isAbsolute(value) && !value.startsWith("../"));
    return { baselineHead, relativePaths: [...new Set(relativePaths)] };
  } catch {
    return { baselineHead: null, relativePaths: [] };
  }
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
    const inspected = inspectContainedScanPath(workspace, normalized);
    if (!inspected.exists) {
      entries.push({ relativePath: normalized, state: "deleted", sizeBytes: 0, sha256: null });
      continue;
    }
    const stats = inspected.stats;
    if (!stats.isFile() || stats.size > MAX_SCANNED_FILE_BYTES) {
      entries.push({ relativePath: normalized, state: "body_excluded", sizeBytes: stats.size, sha256: null });
      excludedBodyCount += 1;
      continue;
    }
    const opened = openContainedScanFile(workspace, normalized);
    entries.push({ relativePath: normalized, state: "text_postimage", sizeBytes: opened.stats.size, sha256: sha256(opened.bytes) });
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
  const automaticCandidates = [];
  for (const value of Array.isArray(request.automaticRelativePaths) ? request.automaticRelativePaths.slice(0, MAX_SCAN_FILES) : []) {
    const normalized = String(value || "").replace(/\\\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith(".codex-knowledge/") || path.isAbsolute(normalized)) continue;
    candidates.add(normalized);
    automaticCandidates.push(normalized);
  }
  const authorizedProfileCandidates = [];
  for (const value of Array.isArray(request.authorizedProfilePaths) ? request.authorizedProfilePaths.slice(0, MAX_SCAN_FILES) : []) {
    const normalized = String(value || "").replace(/\\\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith(".codex-knowledge/") || path.isAbsolute(normalized)) continue;
    candidates.add(normalized);
    authorizedProfileCandidates.push(normalized);
  }
  const headSourcePaths = collectHeadSourcePaths(workspace);
  for (const relativePath of headSourcePaths) candidates.add(relativePath);
  const docsInspection = inspectContainedScanPath(workspace, "docs");
  if (docsInspection.exists && !docsInspection.stats.isDirectory()) throw new Error("workspace_docs_directory_required");
  const directoriesRead = 0;
  const preferred = [...new Set([
    ...PRIORITY_SOURCE_FILES,
    ...ROOT_SOURCE_FILES,
    ...requestedCandidates,
    ...automaticCandidates,
    ...authorizedProfileCandidates,
  ])];
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
    if (!changedMtime.has(relativePath)) {
      const inspected = inspectContainedScanPath(workspace, relativePath);
      changedMtime.set(relativePath, inspected.exists ? inspected.stats.mtimeMs : 0);
    }
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
  const authorizedProfile = authorizedScanProfile(request, projectIdentity);
  const rangeSourcePaths = collectRangeSourcePaths(workspace, authorizedProfile.baselineHead, projectIdentity.baselineHead);
  const profileCurrent = authorizedProfile.baselineHead === projectIdentity.baselineHead;
  const scanRequest = {
    ...request,
    automaticRelativePaths: rangeSourcePaths,
    authorizedProfilePaths: profileCurrent ? authorizedProfile.relativePaths : [],
  };
  const { candidates, directoriesRead } = collectDocCandidates(workspace, scanRequest);
  const workingTree = workingTreeSnapshot(workspace);
  const files = [];
  const skipped = [];
  for (const relativePath of candidates) {
    const explicitlyRequired = Array.isArray(request.relativePaths)
      && request.relativePaths.some((value) => String(value || "").replace(/\\/g, "/").replace(/^\.\//, "") === relativePath);
    const inspected = inspectContainedScanPath(workspace, relativePath);
    if (!inspected.exists) {
      if (explicitlyRequired) throw new Error("workspace_required_source_missing");
      continue;
    }
    const filePath = inspected.path;
    const stats = inspected.stats;
    if (!stats.isFile()) continue;
    if (stats.size > MAX_SCANNED_FILE_BYTES) {
      skipped.push({ relativePath, reason: "canonical_source_too_large", sizeBytes: stats.size });
      continue;
    }
    const opened = openContainedScanFile(workspace, relativePath);
    files.push({
      kind: "canonical_project_file",
      relativePath,
      path: filePath,
      title: relativePath,
      artifactType: sourceArtifactType(relativePath),
      sizeBytes: opened.stats.size,
      updatedAt: opened.stats.mtime.toISOString(),
      sha256: hashCanonicalTextBytes(opened.bytes),
    });
    if (files.length >= MAX_SCAN_FILES) break;
  }
  const generatedKnowledge = [];
  for (const fileName of GENERATED_KNOWLEDGE_FILES) {
    const filePath = path.join(workspace, ".codex-knowledge", fileName);
    if (!fs.existsSync(filePath)) continue;
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) continue;
    generatedKnowledge.push({ fileName, sizeBytes: stats.size, updatedAt: stats.mtime.toISOString(), authorityEligible: false });
  }
  const scanCore = {
    projectIdentitySha256: projectIdentity.projectIdentitySha256,
    canonicalRoot: projectIdentity.canonicalRoot,
    baselineHead: projectIdentity.baselineHead,
    files: files
      .map(({ relativePath, sha256: fileSha256 }) => ({ relativePath, sha256: fileSha256 }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
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
      authorizedProfilePathCount: profileCurrent ? authorizedProfile.relativePaths.length : 0,
      acceptedRangePathCount: rangeSourcePaths.length,
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
  return [scanBinding, ...scan.files.slice(0, MAX_SCAN_FILES).map((file) => ({
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
  const scanBinding = refs.find((ref) => ref?.kind === "workspace_scan_receipt")
    || values.find((ref) => ref?.kind === "workspace_scan_receipt")
    || null;
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
    if (ref?.kind === "workspace_scan_receipt" && scanBinding
        && (ref.path !== scanBinding.path || ref.hash !== scanBinding.hash)) continue;
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
  const refs = coreSourceRefs(scan, coreProjectId, moduleId).slice(0, 16);
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

function takeoverHostRequirements() {
  const requirements = {
    schemaVersion: "zhixia.takeover_host_requirements.v1",
    packetRole: "clean_task_recovery_context",
    requiresCleanReplacementTask: true,
    requiresDistinctTaskFromSource: true,
    contextDisposition: "replace_not_append",
    fullHistoryForkAllowed: false,
    oldTaskExecutionAfterFreezeAllowed: false,
    oldTaskWakeupsAfterFreezeAllowed: false,
    threadRecoveryPacketRequired: true,
    harvestDriverPolicy: "unbind_old_then_bind_one_replacement",
    callbackRelayPolicy: "compact_decision_hash_diff_refs_only",
    existingTaskHistoryTrimmableByMemoryRuntime: false,
  };
  return {
    ...requirements,
    requirementsSha256: sha256(stableStringify(requirements)),
  };
}

function verifyTakeoverHostRequirements(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expected = takeoverHostRequirements();
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (stableStringify(keys) !== stableStringify(expectedKeys)) return false;
  if (value.requirementsSha256 !== expected.requirementsSha256) return false;
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "requirementsSha256"));
  if (sha256(stableStringify(unsigned)) !== value.requirementsSha256) return false;
  return stableStringify(value) === stableStringify(expected);
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
    schemaVersion: "zhixia.takeover_control.v2",
    shouldInject: ready,
    injectionMode: ready ? "replace_long_thread_context" : "blocked_fail_closed",
    maxInjectionsPerTask: 1,
    hostRequirements: takeoverHostRequirements(),
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
  const result = {
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
  };
  result.contextGenerationId = contextGenerationId(result);
  return assertPacketBytes(result, MAX_RESUME_PACKET_BYTES, "resume");
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
  const scanProfile = checkpoint.accepted === true ? persistAuthorizedScanProfile(storeRoot, scan) : null;
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
    scanProfile: scanProfile ? { action: scanProfile.action, persisted: true } : { action: "skip", persisted: false },
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

function readOnlySemanticGraphSupplement(verified, request = {}) {
  const projectPath = verified?.projectIdentity?.canonicalRoot || verified?.workspace || null;
  return {
    ...semanticGraphFallback(projectPath, "semantic_graph_skipped_strict_read_only"),
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
      warnings: ["semantic_graph_seed_skipped_strict_read_only"],
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
      strictReadOnly: true,
    },
    triggerReceipt: {
      hook: "semantic_graph_recall",
      queryType: compactText(request.queryType || "project_resume", 80),
      projectPath,
      returnedCount: 0,
      tokenEstimate: 0,
      partial: true,
      warnings: ["semantic_graph_receipt_skipped_strict_read_only"],
      sourceRefs: [],
      persisted: false,
    },
  };
}

function retrieveMemoryCore(request = {}, options = {}) {
  const retrievalStartedAt = Date.now();
  const strictReadOnly = request.readOnly === true;
  const verified = verifyMemoryCore(request);
  const responseOperation = options.operation === "prepare_takeover" ? "prepare_takeover" : "retrieve";
  const budgetEnvelope = retrievalBudgetEnvelope(request, responseOperation);
  const generationId = contextGenerationId(verified);
  const memoryStateHash = verifiedMemoryStateHash(verified);
  if (!verified.recoveryReady) {
    let requestedTokenBudget = budgetEnvelope.preferredTokenBudget;
    const attemptedTokenBudgets = [requestedTokenBudget];
    const semanticGraph = unreadySemanticGraphSupplement(verified, request);
    const unreadyPacket = () => withStrictRetrievalMetrics({
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
        budgetEnvelope: { ...budgetEnvelope, effectiveTokenBudget: requestedTokenBudget, attemptedTokenBudgets: [...attemptedTokenBudgets] },
        maxPacketBytes: MAX_RETRIEVAL_PACKET_BYTES,
        semanticGraphAdditionalWorkspaceScans: 0,
        semanticGraphSeedWritten: 0,
        durationMs: Date.now() - retrievalStartedAt,
      },
      warnings: [
        ...new Set([
          ...(verified.warnings || []),
          ...(attemptedTokenBudgets.length > 1 ? ["retrieval_token_budget_adapted"] : []),
        ]),
      ],
    });
    let bounded = unreadyPacket();
    while (!budgetEnvelope.strictTokenBudget
      && (bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES || bounded.tokenEstimate > requestedTokenBudget)
      && requestedTokenBudget < budgetEnvelope.maxTokenBudget) {
      requestedTokenBudget = nextAdaptiveTokenBudget(requestedTokenBudget, budgetEnvelope.maxTokenBudget);
      attemptedTokenBudgets.push(requestedTokenBudget);
      bounded = unreadyPacket();
    }
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
  let requestedTokenBudget = budgetEnvelope.preferredTokenBudget;
  let semanticGraphReserve = Math.max(400, Math.min(600, Math.floor(requestedTokenBudget * 0.18)));
  let itemPacketTokenTarget = Math.max(400, requestedTokenBudget - semanticGraphReserve);
  const attemptedTokenBudgets = [requestedTokenBudget];
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
      sidecarLifecycleWrites: strictReadOnly ? false : null,
    },
    performance: {
      bounded: true,
      requestedTokenBudget,
      budgetEnvelope: {
        ...budgetEnvelope,
        effectiveTokenBudget: requestedTokenBudget,
        attemptedTokenBudgets: [...attemptedTokenBudgets],
      },
      maxPacketBytes: MAX_RETRIEVAL_PACKET_BYTES,
      semanticGraphReserve,
      semanticGraphSeedCandidateLimit: 24,
      semanticGraphAdditionalWorkspaceScans: 0,
      semanticGraphRawBodyReads: 0,
      semanticGraphFullTextBodyReads: 0,
      semanticGraphBackgroundRebuild: false,
      strictReadOnly,
      durationMs: Date.now() - retrievalStartedAt,
    },
    warnings: [
      ...(graph?.partial === true ? ["semantic_graph_recall_partial"] : []),
      ...(attemptedTokenBudgets.length > 1 ? ["retrieval_token_budget_adapted"] : []),
    ],
  });
  const requiredAnchorCount = responseOperation === "prepare_takeover" ? Math.min(5, rankedItems.length) : Math.min(3, rankedItems.length);
  if (!budgetEnvelope.strictTokenBudget && requiredAnchorCount > 0) {
    let requiredAnchorPacket = withStrictRetrievalMetrics(packetForItems(rankedItems.slice(0, requiredAnchorCount)));
    while ((requiredAnchorPacket.tokenEstimate > itemPacketTokenTarget || requiredAnchorPacket.packetBytes > MAX_RETRIEVAL_PACKET_BYTES)
      && requestedTokenBudget < budgetEnvelope.maxTokenBudget) {
      requestedTokenBudget = nextAdaptiveTokenBudget(requestedTokenBudget, budgetEnvelope.maxTokenBudget);
      attemptedTokenBudgets.push(requestedTokenBudget);
      semanticGraphReserve = Math.max(400, Math.min(600, Math.floor(requestedTokenBudget * 0.18)));
      itemPacketTokenTarget = Math.max(400, requestedTokenBudget - semanticGraphReserve);
      requiredAnchorPacket = withStrictRetrievalMetrics(packetForItems(rankedItems.slice(0, requiredAnchorCount)));
    }
  }
  let selectedItems = rankedItems;
  let itemOnlyPacket = withStrictRetrievalMetrics(packetForItems(selectedItems));
  while ((itemOnlyPacket.tokenEstimate > itemPacketTokenTarget || itemOnlyPacket.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && selectedItems.length > 1) {
    selectedItems = selectedItems.slice(0, -1);
    itemOnlyPacket = withStrictRetrievalMetrics(packetForItems(selectedItems));
  }
  const graphPathBudget = Math.max(120, Math.min(600, semanticGraphReserve - 320));
  let semanticGraph = strictReadOnly
    ? readOnlySemanticGraphSupplement(verified, request)
    : retrieveVerifiedSemanticGraph(storeRoot, selectedItems, request, verified, graphPathBudget);
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
    if (strictReadOnly) {
      semanticGraph.triggerReceipt = {
        ...semanticGraph.triggerReceipt,
        returnedCount: semanticGraph.hitCount,
        tokenEstimate: semanticGraph.tokenEstimate,
        durationMs: semanticGraph.performance?.totalDurationMs || 0,
        persisted: false,
      };
    } else try {
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
  const minimumFinalItemCount = budgetEnvelope.strictTokenBudget ? 1 : requiredAnchorCount;
  while ((bounded.tokenEstimate > requestedTokenBudget || bounded.packetBytes > MAX_RETRIEVAL_PACKET_BYTES) && selectedItems.length > minimumFinalItemCount) {
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
  for (const ref of requestedRefs.slice(0, MAX_LIFECYCLE_SOURCE_REFS)) {
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
  const completeScanRefs = coreSourceRefs(scan, project.projectId, moduleId);
  const scanBindingRef = completeScanRefs.find((ref) => ref.kind === "workspace_scan_receipt");
  const matchedCanonicalRefs = completeScanRefs.filter((ref) => ref.kind !== "workspace_scan_receipt" && matchedTitles.has(ref.title));
  const sourceRefs = [scanBindingRef, ...matchedCanonicalRefs, ...matchedPostimages]
    .filter(Boolean)
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
  const explicitAcceptedProgress = compactSafeList(payload.acceptedProgress || [], 8, 320);
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
      ...explicitAcceptedProgress,
      ...previousTitles("acceptedProgress"),
    ])].slice(0, 8),
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
      reasonCodes: Array.isArray(write.reasonCodes) ? write.reasonCodes.slice(0, 8) : [],
    })),
    safety: { rawSessionBodyRead: false, generatedKnowledgeAuthority: false, exactScanBound: true, uiRequired: false },
  }, MAX_RESUME_PACKET_BYTES, operation);
}

function executeRefreshBinding(request = {}, options = {}) {
  const preliminaryPayload = request.evidence && typeof request.evidence === "object" ? request.evidence : request;
  const requestedAcceptedChangedPaths = compactSafeList(
    request.acceptedChangedPaths || preliminaryPayload.acceptedChangedPaths || [], MAX_ACCEPTED_CHANGED_PATHS, 500,
  )
    .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""));
  const previewScan = scanExactWorkspace(request);
  const previewPaths = new Set(previewScan.files.map((file) => file.relativePath));
  const scanRequest = {
    ...request,
    relativePaths: [...new Set([
      ...(Array.isArray(request.relativePaths) ? request.relativePaths : []),
      ...requestedAcceptedChangedPaths.filter((relativePath) => !previewPaths.has(relativePath)),
    ])].slice(0, MAX_SCAN_FILES),
  };
  const targetScan = scanExactWorkspace(scanRequest);
  if (request.expectedScanSha256 === previewScan.scanSha256 && targetScan.scanSha256 !== previewScan.scanSha256) {
    throw new Error(`refresh_binding_target_scan_required:${targetScan.scanSha256}`);
  }
  const { scan, payload, sourceRefs } = exactWorkspaceWriteBinding(scanRequest, "refresh_binding");
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForRead(storeRoot);
  if (!runtime) throw new Error("refresh_binding_app_owned_memory_core_required");
  const previous = authorizedCheckpointWorkingState(runtime, storeRoot, scan.projectIdentity, optionalContinuitySlots());
  const expectedCheckpointId = compactText(request.previousCheckpointId || payload.previousCheckpointId, 220);
  if (!expectedCheckpointId || expectedCheckpointId !== previous.checkpointId) {
    throw new Error("refresh_binding_previous_checkpoint_mismatch");
  }
  const acceptedChangedPaths = validateAcceptedChangedPaths(scan, requestedAcceptedChangedPaths);
  const matchedRelativePaths = new Set(sourceRefs
    .filter((ref) => ref.kind !== "workspace_scan_receipt")
    .map((ref) => path.relative(scan.workspace, ref.path).replace(/\\/g, "/")));
  if (acceptedChangedPaths.some((relativePath) => relativePath.startsWith("../") || path.isAbsolute(relativePath) || !matchedRelativePaths.has(relativePath))) {
    throw new Error("refresh_binding_changed_path_not_source_backed");
  }
  const lane = compactSafeText(request.lane || payload.lane || payload.moduleId, 180);
  if (!lane) throw new Error("refresh_binding_lane_required");
  inspectAcceptedEvidenceReceipt(
    storeRoot, scan, request, expectedCheckpointId, acceptedChangedPaths, lane, options,
  );
  assertCompletedRefreshOutcomePublicationSupported(options);
  const acceptedEvidence = consumeAcceptedEvidenceReceipt(
    storeRoot, scan, request, expectedCheckpointId, acceptedChangedPaths, lane, options,
  );
  const acceptedEvidenceReceipt = acceptedEvidence.receiptId;
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
  const writeResult = executeLifecycleWrite("writeback_evidence", { ...scanRequest, evidence });
  if (writeResult.accepted !== true || !writeResult.receiptId) {
    const reasonCode = writeResult.reasonCodes?.[0] || "unknown";
    throw new Error(`refresh_binding_writeback_not_accepted:${reasonCode}`);
  }
  const checkpointWrite = writeResult.writes.find((write) => write.kind === "projectCheckpoint") || null;
  if (!checkpointWrite || !["insert", "noop"].includes(checkpointWrite.action)) {
    const reasonCode = checkpointWrite?.reasonCodes?.[0] || checkpointWrite?.action || "missing";
    throw new Error(`refresh_binding_checkpoint_write_not_accepted:${reasonCode}`);
  }
  const scanProfile = persistAuthorizedScanProfile(storeRoot, scan);
  const verified = verifyMemoryCore({ ...scanRequest, workspace: scan.workspace });
  if (verified.current !== true || verified.recoveryReady !== true || verified.scanBinding?.currentScanSha256 !== scan.scanSha256) {
    throw new Error("refresh_binding_post_write_verify_failed");
  }
  if (!verified.scanBinding?.authorizedCheckpointId || verified.scanBinding.authorizedCheckpointId === previous.checkpointId) {
    throw new Error("refresh_binding_checkpoint_not_advanced");
  }
  const response = assertPacketBytes({
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
    acceptedEvidenceReceiptDigest: acceptedEvidence.receiptDigest,
    acceptedEvidenceIssuer: acceptedEvidence.issuer,
    acceptedEvidenceIssuedAt: acceptedEvidence.issuedAt,
    acceptedEvidenceExpiresAt: acceptedEvidence.expiresAt,
    acceptedChangedPaths,
    acceptedPathDigest: buildCompletedRefreshQueryBasis({
      workspace: scan.workspace,
      expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
      expectedScanSha256: scan.scanSha256,
      previousCheckpointId: previous.checkpointId,
      acceptedEvidenceReceipt,
      acceptedEvidenceReceiptDigest: acceptedEvidence.receiptDigest,
      acceptedChangedPaths,
      lane,
    }).acceptedPathDigest,
    lane,
    receiptId: writeResult.receiptId,
    scanProfile: { action: scanProfile.action, persisted: true },
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
  const outcomeRequest = {
    workspace: scan.workspace,
    storeRoot,
    expectedProjectIdentitySha256: scan.projectIdentity.projectIdentitySha256,
    expectedScanSha256: scan.scanSha256,
    previousCheckpointId: previous.checkpointId,
    acceptedEvidenceReceipt,
    acceptedEvidenceReceiptDigest: acceptedEvidence.receiptDigest,
    acceptedChangedPaths,
    lane,
  };
  outcomeRequest.refreshKey = buildCompletedRefreshKey(buildCompletedRefreshQueryBasis(outcomeRequest));
  const publication = publishCompletedRefreshOutcome({
    storeRoot,
    request: outcomeRequest,
    result: response,
    authorityKey: loadExistingSigningKey(storeRoot),
  });
  return assertPacketBytes({
    ...response,
    refreshKey: publication.refreshKey,
    outcomeDigest: publication.outcomeDigest,
    outcomeVerification: "app_owned_authenticated",
  }, MAX_RESUME_PACKET_BYTES, "refresh_binding");
}

function executeStageAcceptedSlice(request = {}, options = {}) {
  const { workspace, projectIdentity } = resolveWorkspace(request);
  const storeRoot = resolveStoreRoot(request);
  if (!runtimeForRead(storeRoot)) throw new Error("incremental_acceptance_app_owned_memory_core_required");
  const signingKey = loadExistingSigningKey(storeRoot);
  if (!signingKey) throw new Error("incremental_acceptance_authority_unavailable");
  return assertPacketBytes(stageAcceptedSlice({ ...request, workspace }, {
    storeRoot,
    projectIdentity,
    signingKey,
    clock: options.clock,
  }), MAX_RETRIEVAL_PACKET_BYTES, "incremental_acceptance_stage_receipt");
}

function executeReconcileAcceptedSlices(request = {}) {
  const { workspace, projectIdentity } = resolveWorkspace(request);
  const storeRoot = resolveStoreRoot(request);
  const runtime = runtimeForRead(storeRoot);
  const signingKey = loadExistingSigningKey(storeRoot);
  if (!runtime || !signingKey) throw new Error("incremental_acceptance_app_owned_memory_core_required");
  const profile = authorizedScanProfile(request, projectIdentity);
  const rangePaths = collectRangeSourcePaths(workspace, profile.baselineHead, projectIdentity.baselineHead);
  const rangeDelta = collectRangeDeltaForReconciliation(workspace, profile.baselineHead, projectIdentity.baselineHead);
  const stagedScan = scanExactWorkspace(request);
  const requiredChangedPaths = [...new Set([
    ...rangeDelta.paths,
    ...(stagedScan.workingTree?.entries || []).map((entry) => entry.relativePath),
  ])].sort((left, right) => left.localeCompare(right));
  const postimageByPath = new Map();
  for (const entry of stagedScan.workingTree?.entries || []) {
    if (entry.state === "text_postimage" && /^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) {
      postimageByPath.set(entry.relativePath, { relativePath: entry.relativePath, sha256: entry.sha256 });
    }
  }
  for (const relativePath of rangePaths) {
    if (postimageByPath.has(relativePath)) continue;
    const inspected = inspectContainedScanPath(workspace, relativePath);
    if (!inspected.exists || !inspected.stats?.isFile()) continue;
    const opened = openContainedScanFile(workspace, relativePath);
    postimageByPath.set(relativePath, { relativePath, sha256: sha256(opened.bytes) });
  }
  const checkpoint = authorizedCheckpointWorkingState(runtime, storeRoot, projectIdentity, optionalContinuitySlots());
  return assertPacketBytes(reconcileAcceptedSlices({ ...request, workspace }, {
    storeRoot,
    projectIdentity,
    signingKey,
    scan: stagedScan,
    previousCheckpointId: checkpoint.checkpointId,
    requiredChangedPaths,
    currentPostimages: [...postimageByPath.values()],
    unverifiableDeltaCount: rangeDelta.excludedCount,
  }), MAX_RETRIEVAL_PACKET_BYTES, "incremental_acceptance_reconciliation");
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
  const resolved = canonicalRealPath(knowledgeRoot);
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

function execute(request = {}, options = {}) {
  switch (request.operation || request.action) {
    case "scan": return scanExactWorkspace(request);
    case "seed": return seedMemoryCore(request);
    case "retrieve": return retrieveMemoryCore(request);
    case "prepare_takeover": return prepareTakeover(request);
    case "verify": return verifyMemoryCore(request);
    case "observe_event": return executeLifecycleWrite("observe_event", request);
    case "writeback_evidence": return executeLifecycleWrite("writeback_evidence", request);
    case "refresh_binding": return executeRefreshBinding(request);
    case "stage_accepted_slice": return executeStageAcceptedSlice(request, options);
    case "reconcile_accepted_slices": return executeReconcileAcceptedSlices(request);
    case "query_refresh_outcome": return queryCompletedRefreshOutcome(request, {
      storeRoot: options.appOwnedQueryStoreRoot || resolveAppOwnedQueryStoreRoot(),
      rejectStoreRootOverride: true,
    });
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
  executeReconcileAcceptedSlices,
  executeStageAcceptedSlice,
  queryCompletedRefreshOutcome,
  consumeAcceptedEvidenceReceiptForTest,
  issueAcceptedEvidenceReceiptFromApp,
  resolveAppOwnedQueryStoreRoot,
  prepareTakeover,
  takeoverHostRequirements,
  verifyTakeoverHostRequirements,
  inspectContainedScanPath,
  retrieveMemoryCore,
  scanExactWorkspace,
  seedMemoryCore,
  verifyMemoryCore,
  writeCompatibilityPackets,
};
