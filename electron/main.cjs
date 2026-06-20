const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");
const fsNative = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const initSqlJs = require("sql.js");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const {
  THREAD_STORE_COMPATIBILITY_ERROR,
  attachVaultEvidenceToCompactReceipt,
  validateCompactSessionReceipt,
  validateVaultCopyHashes,
} = require("./codexGuardianPolicy.cjs");
const {
  autoIngestCodexSessions,
} = require("./codexThreadHistoryAutoIngestPolicy.cjs");
const {
  buildRuntimeContextPacket,
  buildRuntimePrecedentPacket,
  buildRuntimePrecedentRequest,
  listFlowSkillCandidateRecords,
  listWorkingMemoryRecords,
  promoteMemoryCandidate,
  upsertWorkingMemoryRecord,
  writeEvidenceWriteback,
} = require("./memoryRuntimePolicy.cjs");
const {
  documentSelectSql,
  rowToDocument,
} = require("./documentMetadataPolicy.cjs");
const {
  AGENT_RETRIEVE_ALLOWED_KINDS,
  AGENT_RETRIEVE_CACHE_TTL_MS,
  AGENT_RETRIEVE_DEFAULT_QUERY_TYPE,
  AGENT_RETRIEVE_DEFAULT_TOKEN_BUDGET,
  AGENT_RETRIEVE_MAX_RESULTS,
  assembleAgentRetrieveContractResult,
  buildAgentRetrieveCacheKey: buildAgentRetrievePolicyCacheKey,
  collectAgentRetrieveContractSources,
  filterCEOFlowRecords,
  normalizeAgentRetrieveRequest: normalizeAgentRetrievePolicyRequest,
  trimAgentResultsToBudget,
} = require("./agentRetrievePolicy.cjs");
const { evaluateArchiveCandidate, inferArchiveThreadRole, normalizeArchiveCandidateEvidence } = require("./archiveCandidatePolicy.cjs");
const { buildProjectResumePacket } = require("./projectResumePolicy.cjs");
const { buildProjectMemoryBackfillCards } = require("./projectMemoryBackfillPolicy.cjs");
const { buildProjectArtifacts } = require("./projectArtifactPolicy.cjs");
const { collectRuntimeMonitorSnapshot } = require("./runtimeMonitorAdapter.cjs");
const {
  buildToolSkillInventory,
  buildToolSkillInventoryJson,
  buildToolSkillInventoryMarkdown,
} = require("./toolSkillInventoryPolicy.cjs");

const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".docx",
  ".pdf",
  ".xlsx",
  ".xls",
];

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm"];
const INDEX_VERSION = 2;
const ZHIXIA_SKILL_NAME = "zhixia-local-docs";
const SKIPPED_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "release",
  "releases",
  ".next",
  "out",
  "build",
  "coverage",
  "cache",
  "caches",
  ".venv",
  "venv",
  "env",
  ".env",
  ".conda",
  "conda",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".cache",
  "site-packages",
  "checkpoint",
  "checkpoints",
  "training_runs",
  ".codex-knowledge",
]);
const GENERATED_CONTEXT_VERSION_RE = /[\\\/]\.codex-knowledge[\\\/]|[\\\/]codex-history-vault[\\\/]/i;
const MAX_DOCUMENT_VERSIONS_PER_DOCUMENT = 3;
const DEFAULT_AUTOFLOW_ROOT = process.env.ZHIXIA_DEFAULT_AUTOFLOW_ROOT || path.join(os.homedir(), "Documents", "AutoFlow");
const DEFAULT_AUTOFLOW_WORKFLOW_PATH =
  process.env.ZHIXIA_DEFAULT_AUTOFLOW_WORKFLOW_PATH || path.join(DEFAULT_AUTOFLOW_ROOT, "workflow");
const DEFAULT_BUG_FIX_MEMORY_PATH =
  process.env.ZHIXIA_DEFAULT_BUG_FIX_MEMORY_PATH || path.join(os.homedir(), "Documents", "BUG_FIX_MEMORY.md");
const DEFAULT_CODEX_GUARDIAN_SCRIPT_PATH = path.join(
  os.homedir(),
  "Documents",
  "codexfix",
  "tools",
  "codex-history-guardian.ps1",
);
const DEFAULT_AI_PROVIDER_BASE_URL = "https://api.deepseek.com";
const DEFAULT_AI_PROVIDER_MODEL = "deepseek-v4-flash";
const ZHIXIA_SKILL_PROJECT_SUMMARY_ID = "project-summary-cn";
const KNOWLEDGE_BODY_CHARS = 720;
const KNOWLEDGE_PROMPT_CHARS = 6000;
const ZHIXIA_SKILL_PROMPT_CHARS = 8000;
const DOCUMENT_LIST_CONTENT_CHARS = 12000;
const DOCUMENT_LIST_DEFAULT_INCLUDE_CONTENT_TEXT = false;
const STARTUP_AUTO_INGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_AUTO_INGEST_DELAY_MS = 20000;
const STARTUP_AUTO_INGEST_OPTIONS = { limit: 12, startupBounded: true, maxDirectoryReads: 12, maxFileStats: 20 };
const PERFORMANCE_SAFE_SETTINGS_VERSION = 1;
const MAX_KNOWLEDGE_ITEMS_PER_RUN = 120;
const MAX_KNOWLEDGE_ITEMS_PER_PROJECT_EXPORT = 80;
const MAX_KNOWLEDGE_ITEMS_FOR_RETRIEVAL = 60;
const MAX_PROJECT_INDEX_DOCUMENTS = 160;
const MAX_PROJECT_RETRIEVAL_DOCUMENTS = 36;
const MAX_PROJECT_CHUNKS = 260;
const MAX_PROJECT_CHUNK_CHARS = 520;
const MAX_PROJECT_KNOWLEDGE_MARKDOWN_CHARS = 80000;
const MAX_DOCUMENT_CONTENT_TEXT_CHARS = 60000;
const CONTENT_STORE_COMPACTION_VERSION = 3;
const MAX_VAULT_SESSION_COPIES_PER_THREAD = 2;
const MAX_AUTOFLOW_COMPLETION_FILES = 60;
const MAX_AUTOFLOW_LEDGER_CARDS = 80;
const MAX_AGENT_FAMILY_CARDS = 80;
const MAX_BUG_MEMORY_CARDS = 80;
const COMPACT_SUMMARY_CHARS = 280;
const COMPACT_BODY_CHARS = 900;
const LONG_CODEX_THREAD_BYTES = 8 * 1024 * 1024;
const SQLITE_HISTORY_WRITE_SAFE_BYTES = 512 * 1024 * 1024;
const STALE_CEO_CREATED_THREAD_DAYS = 3;
const STALE_CEO_MAIN_THREAD_DAYS = 30;
const STALE_UNKNOWN_THREAD_DAYS = 3;
const MASKED_SETTING_VALUE = "••••••••";
const CODEX_HISTORY_VAULT_SCHEMA_VERSION = "zhixia.codex_thread_vault.v1";
const E2E_PROBE_ENABLED = process.env.ZHIXIA_E2E_PROBE === "1";

if (E2E_PROBE_ENABLED) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("ozone-platform", "headless");
}

let mainWindow = null;
let SQL = null;
let db = null;
let dbReady = null;
let dbSaveQueue = Promise.resolve();
let fileWatchers = new Map();
let fileWatchDebounceTimer = null;
let fileWatchRunning = false;
let fileWatchLastRun = null;
let fileWatchLastSummary = null;
let fileWatchPendingReasons = [];
let startupAutoIngestTimer = null;

function dbPath() {
  return path.join(app.getPath("userData"), "knowledge-store.sqlite");
}

function legacyStorePath() {
  return path.join(app.getPath("userData"), "knowledge-store.json");
}

function bundledSkillPath() {
  return path.join(app.getAppPath(), "codex-skills", ZHIXIA_SKILL_NAME);
}

function codexHomePath() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function codexSkillsPath() {
  return path.join(codexHomePath(), "skills");
}

function installedSkillPath() {
  return path.join(codexSkillsPath(), ZHIXIA_SKILL_NAME);
}

function codexGuardianScriptPath() {
  return process.env.ZHIXIA_CODEX_GUARDIAN_SCRIPT || DEFAULT_CODEX_GUARDIAN_SCRIPT_PATH;
}

function codexHistoryVaultRoot() {
  return path.join(app.getPath("userData"), "codex-history-vault");
}

function memoryRuntimeRoot() {
  return path.join(app.getPath("userData"), "memory-runtime");
}

function performanceStatePath() {
  return path.join(app.getPath("userData"), "performance-state.json");
}

function parseGuardianJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Guardian did not return valid JSON.");
  }
}

function normalizeGuardianError(error) {
  const stdout = String(error?.stdout || "").trim();
  const stderr = String(error?.stderr || "").trim();
  const message = compactGuardianErrorMessage(stderr || stdout || error?.message || "Guardian command failed.");
  return {
    message,
    refused: /Refusing\s+(clean-logs|prune-process-manager)|Codex-related processes are running/i.test(message),
  };
}

function compactGuardianErrorMessage(message) {
  const text = cleanGuardianHistoryText(String(message || ""), "Guardian command failed.");
  if (text.length <= 900) return text;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\+|^\s*at\s+|^\s*\+ CategoryInfo|^\s*\+ FullyQualifiedErrorId/i.test(line));
  const primary =
    lines.find((line) => /ConvertFrom-Json|IOException|Access.*denied|cannot access|not found|refusing|failed|error/i.test(line)) ||
    lines[0] ||
    text.slice(0, 260);
  const jsonHint = text.includes('"generated_at"') || text.includes('"items"') ? " Guardian returned a large JSON payload in the error stream; details were shortened." : "";
  return compactText(`${primary}${jsonHint}`, 900);
}

function guardianOptionArgs(options = {}) {
  const args = [];
  if (typeof options.query === "string" && options.query.trim()) {
    args.push("-Query", options.query.trim().slice(0, 500));
  }
  if (typeof options.threadId === "string" && options.threadId.trim()) {
    args.push("-ThreadId", options.threadId.trim().slice(0, 120));
  }
  if (typeof options.projectPath === "string" && options.projectPath.trim()) {
    args.push("-ProjectPath", options.projectPath.trim().slice(0, 600));
  }
  const limit = Number(options.limit);
  if (Number.isFinite(limit)) {
    args.push("-Limit", String(Math.max(1, Math.min(1000, Math.floor(limit)))));
  }
  const tokenBudget = Number(options.tokenBudget);
  if (Number.isFinite(tokenBudget)) {
    args.push("-TokenBudget", String(Math.max(200, Math.min(4000, Math.floor(tokenBudget)))));
  }
  if (options.dryRun === true) {
    args.push("-DryRun");
  }
  return args;
}

function runCodexGuardian(command, options = {}) {
  const scriptPath = codexGuardianScriptPath();
  if (!fsNative.existsSync(scriptPath)) {
    return Promise.resolve({
      ok: false,
      error: `Codex History Guardian script not found: ${scriptPath}`,
      refused: false,
      scriptPath,
    });
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    command,
    "-Json",
    "-CodexHome",
    codexHomePath(),
    ...guardianOptionArgs(options),
  ];

  return new Promise((resolve) => {
    execFile("powershell.exe", args, { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const normalized = normalizeGuardianError({ ...error, stdout, stderr });
        resolve({
          ok: false,
          error: normalized.message,
          refused: normalized.refused,
          scriptPath,
          stderr: String(stderr || "").trim(),
        });
        return;
      }
      try {
        resolve({
          ok: true,
          result: parseGuardianJsonOutput(stdout),
          scriptPath,
          stderr: String(stderr || "").trim(),
        });
      } catch (parseError) {
        resolve({
          ok: false,
          error: parseError instanceof Error ? parseError.message : String(parseError),
          refused: false,
          scriptPath,
          stderr: String(stderr || "").trim(),
        });
      }
    });
  });
}

function extractThreadIdFromSessionPath(filePath) {
  const match = String(filePath || "").match(/rollout-[^\\\/]*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : null;
}

function hasLikelyMojibakeText(value) {
  const text = String(value || "");
  if (!text.trim()) return false;
  if (/[\uFFFDÃÂÅåÇçÐðÑñØøÞþÆæŒœƒ‰¤¥¢¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ŴƑƉ]/.test(text)) return true;
  const extended = (text.match(/[\u00C0-\u024F]/g) || []).length;
  const cjk = (text.match(/[\u3400-\u9FFF]/g) || []).length;
  return extended >= 3 && cjk === 0;
}

function cleanGuardianHistoryText(value, fallback = "未知") {
  const raw = String(value || "");
  if (hasLikelyMojibakeText(raw)) return fallback;
  const clean = raw
    .replace(/\uFFFD{1,}/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback;
}

function formatGuardianSessionBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function safeGuardianSourceRefText(ref) {
  const raw = ref?.path || "";
  if (!raw) return "无路径";
  if (hasLikelyMojibakeText(raw)) return "来源路径含损坏字符，已隐藏；可通过 threadId 和 Guardian inventory 追溯。";
  return cleanGuardianHistoryText(raw, "无路径");
}

function guardianHistoryKnowledgeId(threadId) {
  return `codex-history:${String(threadId || "unknown").trim()}`;
}

function findGuardianRawSessionRef(item) {
  return (Array.isArray(item?.sourceRefs) ? item.sourceRefs : []).find((ref) => ref?.kind === "raw_session" && ref?.path) || null;
}

async function readGuardianRestoreIndex() {
  const restoreIndexPath = path.join(codexHomePath(), "guardian", "restore-index.json");
  try {
    const raw = await fs.readFile(restoreIndexPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      restoreIndexPath,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return {
      restoreIndexPath,
      entries: [],
    };
  }
}

async function findSessionFileByThreadId(threadId, preferredFileName = null) {
  const roots = [
    path.join(codexHomePath(), "archived_sessions"),
    path.join(codexHomePath(), "sessions"),
  ];
  const normalizedPreferred = preferredFileName ? String(preferredFileName).toLowerCase() : null;
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const lowerName = entry.name.toLowerCase();
        if ((normalizedPreferred && lowerName === normalizedPreferred) || lowerName.includes(String(threadId).toLowerCase())) {
          return fullPath;
        }
      }
    }
  }
  return null;
}

async function resolveGuardianRawSessionRef(item) {
  const threadId = String(item?.threadId || "").trim();
  const rawRef = findGuardianRawSessionRef(item);
  if (rawRef?.path && (await pathExists(rawRef.path))) return rawRef;
  const preferredFileName = rawRef?.path ? path.basename(rawRef.path) : null;

  const candidatePaths = [];
  if (rawRef?.path) {
    candidatePaths.push(rawRef.path);
    candidatePaths.push(path.join(codexHomePath(), "archived_sessions", path.basename(rawRef.path)));
  }

  if (threadId) {
    const inventory = await readGuardianInventory();
    const inventoryItem = inventory.items.find((candidate) => String(candidate.thread_id || "").trim() === threadId);
    if (inventoryItem?.source_path) {
      candidatePaths.push(inventoryItem.source_path);
      candidatePaths.push(path.join(codexHomePath(), "archived_sessions", path.basename(inventoryItem.source_path)));
    }
    const restoreIndex = await readGuardianRestoreIndex();
    const restoreEntry = restoreIndex.entries.find((candidate) => String(candidate.thread_id || "").trim() === threadId);
    if (restoreEntry) {
      for (const candidatePath of [restoreEntry.source_path, restoreEntry.default_restore_path]) {
        if (candidatePath) {
          candidatePaths.push(candidatePath);
          candidatePaths.push(path.join(codexHomePath(), "archived_sessions", path.basename(candidatePath)));
        }
      }
    }
  }

  for (const candidatePath of Array.from(new Set(candidatePaths.filter(Boolean)))) {
    if (await pathExists(candidatePath)) {
      return {
        ...(rawRef || { kind: "raw_session", readByDefault: false }),
        path: candidatePath,
        relocatedFrom: rawRef?.path && rawRef.path !== candidatePath ? rawRef.path : null,
      };
    }
  }

  if (threadId) {
    const discoveredPath = await findSessionFileByThreadId(threadId, preferredFileName);
    if (discoveredPath) {
      return {
        ...(rawRef || { kind: "raw_session", readByDefault: false }),
        path: discoveredPath,
        relocatedFrom: rawRef?.path && rawRef.path !== discoveredPath ? rawRef.path : null,
      };
    }
  }

  return rawRef;
}

function safeVaultName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function buildThreadHistoryLayers(item, vault = null) {
  const summary = cleanGuardianHistoryText(item.summary, "该老线程摘要疑似编码损坏；知匣已保留 threadId、项目路径和来源索引。");
  const whyMatched = cleanGuardianHistoryText(item.whyMatched, "Guardian 历史命中。");
  return {
    hot: {
      purpose: "continue_same_thread",
      retrieval: "default_for_same_thread_resume",
      summary,
      nextAction: item.continuationAdvice || "继续任务前先读取本 threadId 的知匣热层摘要。",
      tokenBudgetHint: 900,
    },
    warm: {
      purpose: "project_memory_and_decisions",
      retrieval: "same_project_or_keyword_match",
      summary: [summary, whyMatched].filter(Boolean).join("\n\n"),
      tokenBudgetHint: 1600,
    },
    cold: {
      purpose: "full_raw_history_evidence",
      retrieval: "explicit_request_only",
      vaultManifestPath: vault?.manifestPath || null,
      vaultSessionPath: vault?.vaultSessionPath || null,
      sourceSessionSha256: vault?.originalSha256 || findGuardianRawSessionRef(item)?.sha256 || null,
      rawSessionPolicy: "Do not read by default. Use only when hot/warm summaries are insufficient and the user asks for a narrow recovery range.",
    },
    coolingPolicy: {
      currentDays: 7,
      reviewDays: 30,
      staleAfterDays: 30,
      defaultBehavior: "热层用于近期同线程接续；温层用于同项目/关键词召回；冷层只作取证和恢复。",
    },
  };
}

async function pruneSupersededVaultSessionCopies(threadDir, keepSessionPath) {
  const resolvedDir = path.resolve(threadDir);
  const vaultRoot = path.resolve(codexHistoryVaultRoot());
  if (!resolvedDir.toLowerCase().startsWith(vaultRoot.toLowerCase())) return { pruned: 0, kept: 0 };
  const entries = await fs.readdir(threadDir, { withFileTypes: true }).catch(() => []);
  const sessionFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^session-.+\.jsonl$/i.test(entry.name)) continue;
    const fullPath = path.join(threadDir, entry.name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) continue;
    sessionFiles.push({ fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  const keepResolved = path.resolve(keepSessionPath || "").toLowerCase();
  const ordered = sessionFiles.sort((a, b) => {
    if (path.resolve(a.fullPath).toLowerCase() === keepResolved) return -1;
    if (path.resolve(b.fullPath).toLowerCase() === keepResolved) return 1;
    return b.mtimeMs - a.mtimeMs;
  });
  const keep = new Set(ordered.slice(0, MAX_VAULT_SESSION_COPIES_PER_THREAD).map((item) => path.resolve(item.fullPath).toLowerCase()));
  let pruned = 0;
  for (const item of ordered) {
    const resolved = path.resolve(item.fullPath);
    if (keep.has(resolved.toLowerCase())) continue;
    if (!resolved.toLowerCase().startsWith(resolvedDir.toLowerCase())) continue;
    await fs.unlink(resolved).catch(() => null);
    const version = path.basename(resolved).replace(/^session-/, "").replace(/\.jsonl$/i, "");
    const manifestPath = path.join(threadDir, `vault-${version}.json`);
    if (path.resolve(manifestPath).toLowerCase().startsWith(resolvedDir.toLowerCase())) {
      await fs.unlink(manifestPath).catch(() => null);
    }
    pruned += 1;
  }
  return { pruned, kept: keep.size };
}

async function writeCodexThreadHistoryVault(item) {
  const threadId = String(item?.threadId || "").trim();
  if (!threadId) throw new Error("ThreadId is required for Codex thread history vault.");
  const rawRef = await resolveGuardianRawSessionRef(item);
  if (!rawRef?.path) throw new Error("Guardian did not provide a raw_session source path for vault ingestion.");
  if (!(await pathExists(rawRef.path))) throw new Error(`Raw session source is missing: ${rawRef.path}`);

  const originalSha256 = await hashFileIfExists(rawRef.path);
  if (!originalSha256) throw new Error(`Could not hash raw session source: ${rawRef.path}`);
  const stat = await fs.stat(rawRef.path);
  const threadDir = path.join(codexHistoryVaultRoot(), safeVaultName(threadId));
  await fs.mkdir(threadDir, { recursive: true });
  const version = originalSha256.slice(0, 16);
  let vaultSessionPath = path.join(threadDir, `session-${version}.jsonl`);
  let manifestPath = path.join(threadDir, `vault-${version}.json`);
  const latestManifestPath = path.join(threadDir, "latest.json");

  let copiedSha256 = null;
  if (!(await pathExists(vaultSessionPath))) {
    await fs.copyFile(rawRef.path, vaultSessionPath);
    copiedSha256 = await hashFileIfExists(vaultSessionPath);
  } else {
    copiedSha256 = await hashFileIfExists(vaultSessionPath);
    const existingCopy = validateVaultCopyHashes(originalSha256, copiedSha256);
    if (!existingCopy.ok) {
      const repairVersion = `${version}-repair-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
      vaultSessionPath = path.join(threadDir, `session-${repairVersion}.jsonl`);
      manifestPath = path.join(threadDir, `vault-${repairVersion}.json`);
      await fs.copyFile(rawRef.path, vaultSessionPath);
      copiedSha256 = await hashFileIfExists(vaultSessionPath);
    }
  }
  const vaultCopy = validateVaultCopyHashes(originalSha256, copiedSha256);
  if (!vaultCopy.ok) {
    throw new Error(vaultCopy.error);
  }

  const layers = buildThreadHistoryLayers(item, { manifestPath, vaultSessionPath, originalSha256 });
  const manifest = {
    schemaVersion: CODEX_HISTORY_VAULT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    threadId,
    title: cleanGuardianHistoryText(item.title, `Codex 老线程 ${threadId.slice(0, 8)}`),
    projectPath: item.provenance?.projectRoot || null,
    sourceSessionPath: rawRef.path,
    sourceSessionRelocatedFrom: rawRef.relocatedFrom || null,
    vaultSessionPath,
    originalSha256,
    copiedSha256,
    sizeBytes: stat.size,
    lastWriteTime: item.provenance?.lastWriteTime || item.sessionLastWriteTime || null,
    freshness: item.freshness || "unknown",
    status: item.status || "indexed",
    sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
    layers,
    policy: {
      completeHistoryStored: true,
      hotWarmDefaultRetrieval: true,
      coldRawDefaultRead: false,
      compactSessionAllowedOnlyAfterVault: true,
    },
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(latestManifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const vaultRetention = await pruneSupersededVaultSessionCopies(threadDir, vaultSessionPath);
  return {
    threadId,
    manifestPath,
    latestManifestPath,
    vaultSessionPath,
    originalSha256,
    copiedSha256,
    sizeBytes: stat.size,
    layers,
    vaultRetention,
  };
}

function buildGuardianHistoryKnowledgeItem(item, vault = null) {
  const title = cleanGuardianHistoryText(item.title, `Codex 老线程 ${String(item.threadId || "").slice(0, 8)}`);
  const summary = cleanGuardianHistoryText(item.summary, "该老线程摘要疑似编码损坏；知匣已保留 threadId、项目路径和来源索引。");
  const whyMatched = cleanGuardianHistoryText(item.whyMatched, "Guardian 历史命中。");
  const sourceRefs = Array.isArray(item.sourceRefs) ? item.sourceRefs : [];
  const defaultSource = vault?.manifestPath || sourceRefs.find((ref) => ref?.readByDefault !== false && ref?.path)?.path || sourceRefs.find((ref) => ref?.path)?.path || null;
  const sourceLines = sourceRefs.length
    ? sourceRefs.map((ref) => `- ${ref.kind || "source"}: ${safeGuardianSourceRefText(ref)}`)
    : ["- 无默认来源。"];
  const projectPath = item.provenance?.projectRoot || null;
  const layers = buildThreadHistoryLayers(item, vault);
  const body = [
    "Codex 老线程优化记录。该条目是 Thread History Vault 的热/温召回入口，不是完整 raw session 本体。",
    "",
    `ThreadId: ${item.threadId}`,
    `Status: ${item.status || "indexed"}`,
    `Freshness: ${item.freshness || "unknown"}`,
    `TokenEstimate: ${item.tokenEstimate || 0}`,
    `SessionSize: ${typeof item.sessionBytes === "number" ? formatGuardianSessionBytes(item.sessionBytes) : "unknown"}`,
    `ProjectPath: ${projectPath || "unknown"}`,
    `VaultManifest: ${vault?.manifestPath || "not_ingested"}`,
    `VaultSessionSha256: ${vault?.originalSha256 || "unknown"}`,
    "",
    "Hot layer / continue same thread:",
    layers.hot.summary,
    "",
    "Warm layer / project memory:",
    whyMatched,
    "",
    "Cold layer / raw evidence:",
    layers.cold.rawSessionPolicy,
    "",
    "Summary:",
    summary,
    "",
    "Why matched:",
    whyMatched,
    "",
    "Source refs:",
    ...sourceLines,
    "",
    "Policy:",
    "- 知匣先保存完整历史保险库，再生成热/温/冷三层召回入口。",
    "- 老线程继续任务时优先读取同 threadId 热层；热层不足再读温层。",
    "- 默认入库不会删除、移动或修改 Codex sessions / archived_sessions。",
    "- 只有完整历史保险库写入并验 hash 后，才允许用户显式触发本体瘦身。",
    "- raw_session 默认不读取；只有用户明确要求恢复旧线程且摘要不足时才按范围取证。",
  ].join("\n");
  return {
    id: guardianHistoryKnowledgeId(item.threadId),
    projectPath,
    documentId: null,
    sourcePath: defaultSource,
    title: `老线程优化：${title}`,
    summary,
    body,
    category: "process",
    tags: ["codex-history", "old-thread", "guardian", "optimized"],
    sourceHash: vault?.originalSha256 || item.threadId || null,
    provider: "codex_guardian",
    model: "thread_history_vault",
    status: "ready",
    errorMessage: null,
  };
}

function normalizeGuardianHistorySidecarItem(item, reason = "sqlite_large_store_bypass") {
  const now = new Date().toISOString();
  return {
    id: item.id,
    projectPath: item.projectPath || null,
    documentId: item.documentId || null,
    sourcePath: item.sourcePath || null,
    title: compactText(item.title || "老线程历史", 160),
    summary: compactText(item.summary || item.body || "", COMPACT_SUMMARY_CHARS),
    body: compactText(item.body || item.summary || "", KNOWLEDGE_BODY_CHARS),
    category: normalizeStatus(item.category, ["architecture", "product", "testing", "operations", "process", "data", "docs", "general"], "process"),
    tags: uniqCompact(item.tags || [], 12),
    sourceHash: item.sourceHash || null,
    provider: item.provider || "codex_guardian",
    model: item.model || "thread_history_vault",
    status: item.status || "ready",
    errorMessage: item.errorMessage || null,
    createdAt: item.createdAt || now,
    updatedAt: now,
    storageMode: "thread_history_vault_sidecar",
    sqliteBypassReason: reason,
  };
}

function buildGuardianHistorySidecarMarkdown(projectPath, items) {
  const lines = [
    "# Zhixia Codex Thread History Items",
    "",
    "Project: " + (projectPath ? projectNameFromPath(projectPath) : "all"),
    "ProjectPath: " + (projectPath || "all"),
    "GeneratedAt: " + new Date().toISOString(),
    "ItemCount: " + items.length,
    "",
    "These entries are written outside the main SQLite store when the local knowledge database is too large for safe sql.js export.",
    "Full raw sessions stay in Thread History Vault and are not read by default.",
    "",
  ];
  for (const item of items.slice(0, MAX_KNOWLEDGE_ITEMS_PER_PROJECT_EXPORT)) {
    lines.push("## " + item.title);
    lines.push("");
    lines.push("- Id: " + item.id);
    lines.push("- ThreadId: " + String(item.id || "").replace(/^codex-history:/, ""));
    lines.push("- ProjectPath: " + (item.projectPath || "unknown"));
    lines.push("- SourcePath: " + (item.sourcePath || "unknown"));
    lines.push("- SourceHash: " + (item.sourceHash || "unknown"));
    lines.push("- Tags: " + ((item.tags || []).join(", ") || "none"));
    lines.push("");
    lines.push(item.summary || "无摘要。");
    lines.push("");
  }
  return lines.join("\n");
}

async function readJsonFileOrDefault(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeGuardianHistoryKnowledgeSidecar(item, options = {}) {
  const reason = options.reason || "sqlite_large_store_bypass";
  const sidecarItem = normalizeGuardianHistorySidecarItem(item, reason);
  const root = path.join(codexHistoryVaultRoot(), "knowledge-items");
  await fs.mkdir(root, { recursive: true });
  const itemPath = path.join(root, `${safeVaultName(sidecarItem.id)}.json`);
  await fs.writeFile(itemPath, JSON.stringify(sidecarItem, null, 2), "utf8");

  const indexPath = path.join(root, "codex-history-index.json");
  const indexMarkdownPath = path.join(root, "codex-history-index.md");
  const existingIndex = await readJsonFileOrDefault(indexPath, { schemaVersion: "zhixia.codex_history_sidecar_index.v1", items: [] });
  const byId = new Map(safeArray(existingIndex.items).map((entry) => [entry.id, entry]));
  byId.set(sidecarItem.id, sidecarItem);
  const items = Array.from(byId.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const payload = {
    schemaVersion: "zhixia.codex_history_sidecar_index.v1",
    generatedAt: new Date().toISOString(),
    reason,
    sqlitePath: dbPath(),
    sqliteBytes: await databaseFileSizeBytes(),
    items,
  };
  await fs.writeFile(indexPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(indexMarkdownPath, buildGuardianHistorySidecarMarkdown(null, items), "utf8");

  const written = [itemPath, indexPath, indexMarkdownPath];
  if (sidecarItem.projectPath && (await pathExists(sidecarItem.projectPath))) {
    const bundleDir = path.join(sidecarItem.projectPath, ".codex-knowledge");
    await fs.mkdir(bundleDir, { recursive: true });
    const projectJsonPath = path.join(bundleDir, "codex-history-items.json");
    const projectMarkdownPath = path.join(bundleDir, "codex-history-items.md");
    const existingProject = await readJsonFileOrDefault(projectJsonPath, {
      schemaVersion: "zhixia.codex_history_sidecar_project.v1",
      items: [],
    });
    const projectById = new Map(safeArray(existingProject.items).map((entry) => [entry.id, entry]));
    projectById.set(sidecarItem.id, sidecarItem);
    const projectItems = Array.from(projectById.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    await fs.writeFile(
      projectJsonPath,
      JSON.stringify({
        schemaVersion: "zhixia.codex_history_sidecar_project.v1",
        project: projectNameFromPath(sidecarItem.projectPath),
        projectPath: sidecarItem.projectPath,
        generatedAt: new Date().toISOString(),
        reason,
        items: projectItems,
      }, null, 2),
      "utf8",
    );
    await fs.writeFile(projectMarkdownPath, buildGuardianHistorySidecarMarkdown(sidecarItem.projectPath, projectItems), "utf8");
    written.push(projectJsonPath, projectMarkdownPath);
  }

  return {
    item: sidecarItem,
    written,
    indexPath,
    itemPath,
    reason,
  };
}

async function optimizeCodexThread(options = {}) {
  const threadId = String(options.threadId || "").trim();
  if (!threadId) {
    return {
      ok: false,
      error: "ThreadId is required for old-thread optimization.",
      refused: false,
      scriptPath: codexGuardianScriptPath(),
    };
  }
  let contextResult = null;
  let item = null;
  if (options.metadataOnly === true) {
    const inventory = await readGuardianInventory();
    const inventoryItem = inventory.items.find((candidate) => String(candidate.thread_id || "").trim() === threadId);
    if (inventoryItem) {
      item = buildReportOnlyLongThreadItem(inventoryItemToThreadFile(inventoryItem, { nowMs: Date.now() }), {
        tokenBudget: options.tokenBudget,
      });
      contextResult = {
        ok: true,
        result: {
          schemaVersion: "guardian.agent.v1",
          command: "get-thread-context",
          generatedAt: new Date().toISOString(),
          query: `threadId:${threadId}`,
          mode: "metadata_only_inventory_fallback",
          items: [item],
          warnings: inventory.warning ? [inventory.warning] : [],
        },
        scriptPath: codexGuardianScriptPath(),
        stderr: "",
      };
    }
  }
  if (!contextResult) {
    contextResult = await runCodexGuardian("get-thread-context", options);
    if (!contextResult.ok || !contextResult.result?.items?.[0]) return contextResult;
    item = contextResult.result.items[0];
  }
  const vault = await writeCodexThreadHistoryVault(item);
  const knowledgeItemDraft = buildGuardianHistoryKnowledgeItem(item, vault);
  let knowledgeItem = null;
  let written = [];
  let storageMode = "sqlite";
  let storageWarning = null;

  if (await shouldBypassSqliteHistoryWrite()) {
    const sidecar = await writeGuardianHistoryKnowledgeSidecar(knowledgeItemDraft, { reason: "sqlite_store_too_large_for_safe_export" });
    knowledgeItem = sidecar.item;
    written = sidecar.written;
    storageMode = "thread_history_vault_sidecar";
    storageWarning = `SQLite knowledge store is ${(await databaseFileSizeBytes())} bytes; old-thread knowledge item was written to Thread History Vault sidecar to avoid sql.js memory export failure.`;
  } else {
    try {
      await ensureDatabase();
      knowledgeItem = upsertKnowledgeItem(knowledgeItemDraft);
      await saveDatabase();
      if (knowledgeItem.projectPath && (await pathExists(knowledgeItem.projectPath))) {
        written = await writeProjectMemoryFiles([knowledgeItem.projectPath]);
      }
    } catch (error) {
      if (!isSqlJsMemoryError(error)) throw error;
      const sidecar = await writeGuardianHistoryKnowledgeSidecar(knowledgeItemDraft, { reason: "sqljs_memory_error_fallback" });
      knowledgeItem = sidecar.item;
      written = sidecar.written;
      storageMode = "thread_history_vault_sidecar";
      storageWarning = `SQLite save failed with ${error instanceof Error ? error.message : String(error)}; old-thread knowledge item was written to Thread History Vault sidecar.`;
    }
  }
  return {
    ok: true,
    result: {
      ...contextResult.result,
      command: "optimize-thread",
      mode: "read_only_indexed",
      warnings: [...safeArray(contextResult.result.warnings), ...(storageWarning ? [storageWarning] : [])],
      optimized: {
        knowledgeItemId: knowledgeItem.id,
        projectPath: knowledgeItem.projectPath,
        sourcePath: knowledgeItem.sourcePath,
        storageMode,
        sqliteBypassed: storageMode !== "sqlite",
        storageWarning,
        vaultManifestPath: vault.manifestPath,
        vaultSessionPath: vault.vaultSessionPath,
        vaultSha256: vault.originalSha256,
        historyLayers: vault.layers,
        written,
        message: "老线程完整历史已写入知匣保险库，并生成热/温/冷召回入口；原始 Codex sessions 未被修改。",
      },
    },
    scriptPath: contextResult.scriptPath,
    stderr: contextResult.stderr,
  };
}

async function ensureCodexThreadHistoryVault(options = {}) {
  const threadId = String(options.threadId || "").trim();
  if (!threadId) throw new Error("ThreadId is required for Codex thread history vault.");
  const contextResult = await runCodexGuardian("get-thread-context", { ...options, threadId });
  if (!contextResult.ok || !contextResult.result?.items?.[0]) {
    throw new Error(contextResult.error || "Guardian did not return thread context for vault ingestion.");
  }
  return writeCodexThreadHistoryVault(contextResult.result.items[0]);
}

async function writeZhixiaCompactReceiptEvidence(threadId, receipt) {
  if (!receipt || typeof receipt !== "object") return receipt;
  const threadDir = path.join(codexHistoryVaultRoot(), safeVaultName(threadId));
  await fs.mkdir(threadDir, { recursive: true });
  const createdAt = String(receipt.created_at || new Date().toISOString()).replace(/[:.]/g, "-");
  const receiptPath = path.join(threadDir, `compact-receipt-${createdAt}.json`);
  const payload = {
    ...receipt,
    receipt_path: receipt.receipt_path || receipt.receiptPath || receiptPath,
    evidence_created_by: "zhixia-main",
    evidence_schema: "zhixia.compact_receipt_evidence.v1",
  };
  await fs.writeFile(receiptPath, JSON.stringify(payload, null, 2), "utf8");
  const receiptSha256 = await hashFileIfExists(receiptPath);
  return {
    ...receipt,
    receipt_path: receiptPath,
    receipt_sha256: receiptSha256,
    evidence_schema: payload.evidence_schema,
  };
}

async function compactCodexThread(options = {}) {
  const threadId = String(options.threadId || "").trim();
  if (!threadId) {
    return {
      ok: false,
      error: "ThreadId is required for in-place old-thread slimming.",
      refused: false,
      scriptPath: codexGuardianScriptPath(),
    };
  }
  let vault = null;
  if (options.dryRun !== true) {
    try {
      vault = await ensureCodexThreadHistoryVault({ ...options, threadId });
    } catch (error) {
      return {
        ok: false,
        error: `Thread History Vault ingestion failed before slimming; original session left untouched: ${error instanceof Error ? error.message : String(error)}`,
        refused: false,
        scriptPath: codexGuardianScriptPath(),
      };
    }
  }
  const result = await runCodexGuardian("compact-session", { ...options, threadId });
  if (!result.ok || options.dryRun === true) return result;
  const compatibility = validateCompactSessionReceipt(result.result);
  if (!compatibility.ok) {
    return {
      ok: false,
      error: compatibility.error || THREAD_STORE_COMPATIBILITY_ERROR,
      refused: false,
      scriptPath: result.scriptPath,
      stderr: result.stderr,
      result: result.result || null,
    };
  }
  if (result.result && vault) {
    result.result = attachVaultEvidenceToCompactReceipt(result.result, vault);
  }
  if (result.result) {
    result.result = await writeZhixiaCompactReceiptEvidence(threadId, result.result);
  }
  return result;
}

async function autoIngestCodexThreadHistory(options = {}) {
  const startupBounded = options.startupBounded === true;
  const result = await autoIngestCodexSessions({
    ...options,
    sessionsRoot: options.sessionsRoot || path.join(codexHomePath(), "sessions"),
    vaultRoot: options.vaultRoot || codexHistoryVaultRoot(),
    limit: Math.max(1, Math.min(1000, Math.floor(Number(options.limit) || 100))),
    recentWriteMinutes: Math.max(1, Math.floor(Number(options.recentWriteMinutes) || 60)),
    stopAfterLimit: options.stopAfterLimit === true || startupBounded,
    maxDirectoryReads: startupBounded ? Math.max(1, Math.floor(Number(options.maxDirectoryReads) || 80)) : options.maxDirectoryReads,
    maxFileStats: startupBounded ? Math.max(1, Math.floor(Number(options.maxFileStats) || Math.max(1, Number(options.limit) || 100))) : options.maxFileStats,
  });
  return {
    ok: true,
    result: {
      ...result,
      command: "auto-ingest-codex-history",
      message: `自动历史入库完成：新增/刷新 ${result.preservedCount} 条，已存在 ${result.alreadyPreservedCount} 条，活跃保留但不归档 ${result.activePreservedCount} 条。`,
    },
  };
}

async function readGuardianInventory(reportResult = null) {
  const inventoryPath =
    reportResult?.result?.provenance?.guardianInventoryPath ||
    path.join(codexHomePath(), "guardian", "inventory.json");
  try {
    const raw = await fs.readFile(inventoryPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      inventoryPath,
      generatedAt: parsed.generated_at || null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch (error) {
    return {
      inventoryPath,
      generatedAt: null,
      items: [],
      warning: `Could not read Guardian inventory for stale CEO thread scan: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function guardianInventoryArchiveRole(item = {}) {
  return inferArchiveThreadRole({
    title: item.title_guess || item.thread_id,
    summary: item.user_goal_guess || "",
    status: item.status_guess || "",
    tags: item.labels || [],
    sourceRefs: [
      { kind: item.source_bucket || "guardian_inventory", path: item.source_path || "", title: item.file_name || "" },
    ],
  });
}

function guardianInventoryIdleDays(item = {}, nowMs = Date.now()) {
  const lastWriteMs = Date.parse(String(item.last_write_time || ""));
  if (!Number.isFinite(lastWriteMs)) return null;
  return Math.max(0, Math.floor((nowMs - lastWriteMs) / 86400000));
}

function shouldIncludeGuardianInventoryArchiveCandidate(item = {}, options = {}) {
  if (item.source_bucket !== "hot_sessions") return false;
  const threadId = String(item.thread_id || "").trim();
  if (!threadId) return false;
  const status = String(item.status_guess || "paused").trim().toLowerCase();
  if (["active", "running", "executing", "streaming"].includes(status)) return false;
  const lastWriteMs = Date.parse(String(item.last_write_time || ""));
  const nowMs = Number(options.nowMs || Date.now());
  const ageMinutes = Number.isFinite(lastWriteMs) ? Math.max(0, Math.floor((nowMs - lastWriteMs) / 60000)) : null;
  const recentWriteMinutes = Math.max(1, Number(options.recentWriteMinutes || 60));
  if (ageMinutes !== null && ageMinutes < recentWriteMinutes) return false;

  const role = guardianInventoryArchiveRole(item);
  const idleDays = guardianInventoryIdleDays(item, nowMs);
  if (idleDays === null) return false;
  if (role === "ceo_thread") return idleDays >= Math.max(1, Number(options.ceoThreadIdleDays || STALE_CEO_MAIN_THREAD_DAYS));
  if (role === "ceo_created_thread") return idleDays >= Math.max(1, Number(options.ceoCreatedThreadIdleDays || STALE_CEO_CREATED_THREAD_DAYS));
  return idleDays >= Math.max(1, Number(options.unknownThreadIdleDays || STALE_UNKNOWN_THREAD_DAYS));
}

function inventoryItemToThreadFile(item = {}, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const role = guardianInventoryArchiveRole(item);
  const ageMinutes = (() => {
    const lastWriteMs = Date.parse(String(item.last_write_time || ""));
    return Number.isFinite(lastWriteMs) ? Math.max(0, Math.floor((nowMs - lastWriteMs) / 60000)) : null;
  })();
  return {
    path: item.source_path || "",
    threadId: String(item.thread_id || "").trim(),
    size_bytes: Number(item.size_bytes || 0),
    last_write_time: item.last_write_time || null,
    title_guess: item.title_guess || "",
    user_goal_guess: item.user_goal_guess || "",
    status_guess: item.status_guess || "paused",
    project_root: item.project_root || null,
    source_bucket: item.source_bucket || "guardian_inventory",
    labels: Array.isArray(item.labels) ? item.labels : [],
    ageMinutes,
    archiveThreadRole: role,
    pressureReason:
      role === "ceo_created_thread"
        ? "stale_ceo_created_thread"
        : role === "ceo_thread"
          ? "stale_ceo_main_thread"
          : "stale_unknown_thread",
  };
}

function mergeThreadScanFiles(files = [], limit = 40) {
  const byThread = new Map();
  for (const file of files) {
    const threadId = String(file?.threadId || "").trim();
    if (!threadId) continue;
    const existing = byThread.get(threadId);
    if (!existing) {
      byThread.set(threadId, file);
      continue;
    }
    const existingSize = Number(existing.size_bytes || 0);
    const nextSize = Number(file.size_bytes || 0);
    const existingIsRole = /^stale_/.test(String(existing.pressureReason || ""));
    const nextIsRole = /^stale_/.test(String(file.pressureReason || ""));
    byThread.set(threadId, {
      ...existing,
      ...file,
      size_bytes: Math.max(existingSize, nextSize),
      pressureReason: existingIsRole ? existing.pressureReason : nextIsRole ? file.pressureReason : existing.pressureReason || file.pressureReason,
      archiveThreadRole: existing.archiveThreadRole || file.archiveThreadRole,
    });
  }

  const roleRank = (file) => {
    if (file.archiveThreadRole === "ceo_created_thread") return 0;
    if (file.archiveThreadRole === "unknown") return 1;
    if (file.archiveThreadRole === "ceo_thread") return 2;
    return 3;
  };

  return Array.from(byThread.values())
    .sort((a, b) => {
      const roleDelta = roleRank(a) - roleRank(b);
      if (roleDelta !== 0) return roleDelta;
      const ageDelta = Number(b.ageMinutes ?? -1) - Number(a.ageMinutes ?? -1);
      if (ageDelta !== 0) return ageDelta;
      return Number(b.size_bytes || 0) - Number(a.size_bytes || 0);
    })
    .slice(0, limit);
}

async function readZhixiaThreadHistoryVaultEvidence(threadId) {
  if (!threadId) return { hasZhixiaThreadHistoryVault: false };
  const threadDir = path.join(codexHistoryVaultRoot(), safeVaultName(threadId));
  const latestPath = path.join(threadDir, "latest.json");
  try {
    const raw = await fs.readFile(latestPath, "utf8");
    const parsed = JSON.parse(raw);
    const compactReceipt = await readLatestZhixiaCompactReceiptEvidence(threadDir);
    return {
      hasZhixiaThreadHistoryVault: true,
      hasThreadHistoryVault: true,
      hasMemoryPointer: true,
      hasZhixiaHistoryPointer: true,
      zhixiaHistoryId: guardianHistoryKnowledgeId(threadId),
      vaultManifestPath: parsed.layers?.cold?.vaultManifestPath || parsed.vaultManifestPath || latestPath,
      vaultSessionPath: parsed.layers?.cold?.vaultSessionPath || parsed.vaultSessionPath || null,
      vaultSha256: parsed.layers?.cold?.sourceSessionSha256 || parsed.originalSha256 || parsed.copiedSha256 || null,
      vaultOriginalSha256: parsed.originalSha256 || parsed.layers?.cold?.sourceSessionSha256 || null,
      vaultCopiedSha256: parsed.copiedSha256 || parsed.layers?.cold?.sourceSessionSha256 || null,
      vaultLatestPath: latestPath,
      vaultSourceLastWriteTime: parsed.lastWriteTime || null,
      vaultCreatedAt: parsed.createdAt || null,
      hasCompactReceipt: compactReceipt.hasCompactReceipt,
      compactReceiptPath: compactReceipt.compactReceiptPath,
      compactReceiptSha256: compactReceipt.compactReceiptSha256,
      compactReceiptCreatedAt: compactReceipt.compactReceiptCreatedAt,
    };
  } catch {
    return { hasZhixiaThreadHistoryVault: false };
  }
}

async function readLatestZhixiaCompactReceiptEvidence(threadDir) {
  try {
    const entries = await fs.readdir(threadDir, { withFileTypes: true });
    const receipts = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^compact-receipt-.*\.json$/i.test(entry.name)) continue;
      const fullPath = path.join(threadDir, entry.name);
      const stat = await fs.stat(fullPath);
      receipts.push({ fullPath, mtimeMs: stat.mtimeMs });
    }
    receipts.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = receipts[0];
    if (!latest) return { hasCompactReceipt: false, compactReceiptPath: null, compactReceiptSha256: null, compactReceiptCreatedAt: null };
    let parsed = {};
    try {
      parsed = JSON.parse(await fs.readFile(latest.fullPath, "utf8"));
    } catch {
      parsed = {};
    }
    return {
      hasCompactReceipt: true,
      compactReceiptPath: latest.fullPath,
      compactReceiptSha256: parsed.receipt_sha256 || parsed.receiptSha256 || parsed.sha256 || (await hashFileIfExists(latest.fullPath)),
      compactReceiptCreatedAt: parsed.created_at || parsed.createdAt || new Date(latest.mtimeMs).toISOString(),
    };
  } catch {
    return { hasCompactReceipt: false, compactReceiptPath: null, compactReceiptSha256: null, compactReceiptCreatedAt: null };
  }
}

function dateMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function fileChangedSinceVault(file = {}) {
  const sourceMs = dateMs(file.last_write_time);
  const vaultMs = dateMs(file.vaultSourceLastWriteTime);
  if (sourceMs === null || vaultMs === null) return false;
  return sourceMs > vaultMs + 60_000;
}

function threadNeedsBodySlimming(file = {}) {
  const role = file.archiveThreadRole;
  return (
    role === "ceo_thread" ||
    role === "ceo_created_thread" ||
    file.pressureReason === "long_thread" ||
    file.pressureReason === "very_long_thread" ||
    Number(file.size_bytes || 0) >= LONG_CODEX_THREAD_BYTES
  );
}

function incrementalReliefAction(file = {}) {
  if (file.hasZhixiaThreadHistoryVault !== true) return "needs_vault";
  if (file.sourceChangedSinceVault === true) return "source_changed_since_vault";
  if (threadNeedsBodySlimming(file) && file.hasCompactReceipt !== true) return "needs_compact_receipt";
  return "already_processed";
}

async function attachVaultStatusToScanFiles(files = []) {
  const result = [];
  for (const file of files) {
    const threadId = String(file?.threadId || "").trim();
    const vaultEvidence = await readZhixiaThreadHistoryVaultEvidence(threadId);
    const enriched = {
      ...file,
      ...vaultEvidence,
    };
    enriched.sourceChangedSinceVault = fileChangedSinceVault(enriched);
    enriched.needsBodySlimming = threadNeedsBodySlimming(enriched);
    enriched.incrementalAction = incrementalReliefAction(enriched);
    result.push(enriched);
  }
  return result;
}

async function listLongCodexThreads(options = {}) {
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(options.limit) || 12)));
  const minBytes = Math.max(1024 * 1024, Math.floor(Number(options.minBytes) || LONG_CODEX_THREAD_BYTES));
  const minAgeMinutes = Math.max(0, Math.min(7 * 24 * 60, Math.floor(Number(options.minAgeMinutes) || 30)));
  const tokenBudget = Math.max(200, Math.min(4000, Math.floor(Number(options.tokenBudget) || 900)));
  const reportResult = await runCodexGuardian("report");
  if (!reportResult.ok || !reportResult.result) return reportResult;

  const largest = Array.isArray(reportResult.result.largest_session_files) ? reportResult.result.largest_session_files : [];
  const now = Date.now();
  const largeFiles = largest
    .map((file) => {
      const lastWriteMs = Date.parse(String(file.last_write_time || ""));
      const ageMinutes = Number.isFinite(lastWriteMs) ? Math.max(0, Math.floor((now - lastWriteMs) / 60000)) : null;
      return {
        ...file,
        threadId: extractThreadIdFromSessionPath(file.path),
        size_bytes: Number(file.size_bytes || 0),
        ageMinutes,
        pressureReason: Number(file.size_bytes || 0) >= 50 * 1024 * 1024 ? "very_long_thread" : "long_thread",
      };
    })
    .filter((file) => file.threadId && file.size_bytes >= minBytes && (file.ageMinutes === null || file.ageMinutes >= minAgeMinutes));

  const inventory = await readGuardianInventory(reportResult);
  const staleRoleFiles = inventory.items
    .filter((item) =>
      shouldIncludeGuardianInventoryArchiveCandidate(item, {
        nowMs: now,
        recentWriteMinutes: Math.max(60, minAgeMinutes),
        ceoThreadIdleDays: options.ceoThreadIdleDays,
        ceoCreatedThreadIdleDays: options.ceoCreatedThreadIdleDays,
        unknownThreadIdleDays: options.unknownThreadIdleDays,
      }),
    )
    .map((item) => inventoryItemToThreadFile(item, { nowMs: now }));

  const allCandidates = await attachVaultStatusToScanFiles(mergeThreadScanFiles([...largeFiles, ...staleRoleFiles], 100000));
  const unvaultedCandidates = allCandidates.filter((file) => file.hasZhixiaThreadHistoryVault !== true);
  const vaultedCandidates = allCandidates.filter((file) => file.hasZhixiaThreadHistoryVault === true);
  const sourceChangedCandidates = allCandidates.filter((file) => file.sourceChangedSinceVault === true);
  const missingCompactReceiptCandidates = allCandidates.filter((file) => file.incrementalAction === "needs_compact_receipt");
  const incrementalCandidates = allCandidates.filter((file) => file.incrementalAction !== "already_processed");
  const alreadyProcessedCandidates = allCandidates.filter((file) => file.incrementalAction === "already_processed");
  const selected = incrementalCandidates.slice(0, limit);

  const items = [];
  const warnings = [];
  if (inventory.warning) warnings.push(inventory.warning);
  for (const file of selected) {
    const isStaleRoleThread = /^stale_/.test(String(file.pressureReason || ""));
    const context = isStaleRoleThread
      ? { ok: false, result: null, error: "metadata_only_stale_role_scan" }
      : await runCodexGuardian("get-thread-context", { threadId: file.threadId, tokenBudget });
    let item = context.result?.items?.[0] || null;
    if (!context.ok || !item) {
      if (!isStaleRoleThread) {
        warnings.push(`Could not load compact context for ${file.threadId}: ${context.error || "missing item"}; using report metadata fallback.`);
      }
      item = buildReportOnlyLongThreadItem(file, { tokenBudget });
    }
    const archiveCandidateEvidence = normalizeArchiveCandidateEvidence({
      ...item,
      threadId: file.threadId,
      archiveThreadRole: file.archiveThreadRole || item.archiveThreadRole,
      status: file.status_guess || item.status,
      projectStatus: item.provenance?.restoreState,
      archiveState: item.status,
      lastWriteTime: file.last_write_time,
      sessionBytes: file.size_bytes,
    });
    const archiveCandidate = evaluateArchiveCandidate(archiveCandidateEvidence);
    items.push({
      ...item,
      sessionBytes: file.size_bytes,
      sessionLastWriteTime: file.last_write_time,
      sessionAgeMinutes: file.ageMinutes,
      hasZhixiaThreadHistoryVault: file.hasZhixiaThreadHistoryVault === true,
      hasThreadHistoryVault: file.hasThreadHistoryVault === true,
      hasMemoryPointer: file.hasMemoryPointer === true,
      hasZhixiaHistoryPointer: file.hasZhixiaHistoryPointer === true,
      zhixiaHistoryId: file.zhixiaHistoryId || guardianHistoryKnowledgeId(file.threadId),
      vaultManifestPath: file.vaultManifestPath || null,
      vaultSessionPath: file.vaultSessionPath || null,
      vaultSha256: file.vaultSha256 || null,
      vaultOriginalSha256: file.vaultOriginalSha256 || null,
      vaultCopiedSha256: file.vaultCopiedSha256 || null,
      vaultSourceLastWriteTime: file.vaultSourceLastWriteTime || null,
      sourceChangedSinceVault: file.sourceChangedSinceVault === true,
      hasCompactReceipt: file.hasCompactReceipt === true,
      compactReceiptPath: file.compactReceiptPath || null,
      compactReceiptSha256: file.compactReceiptSha256 || null,
      compactReceiptCreatedAt: file.compactReceiptCreatedAt || null,
      incrementalAction: file.incrementalAction || "needs_vault",
      needsBodySlimming: file.needsBodySlimming === true,
      archiveCandidate,
      archiveThreadRole: file.archiveThreadRole || archiveCandidate.evidence.archiveThreadRole,
      pressureReason: file.pressureReason || (file.size_bytes >= 50 * 1024 * 1024 ? "very_long_thread" : "long_thread"),
      shouldStartFreshThread: false,
      continuationAdvice: "Optimize this old thread into Zhixia's searchable history index. Starting a fresh thread is optional, not the primary flow.",
    });
    for (const warning of context.result?.warnings || []) warnings.push(warning);
  }

  return {
    ok: true,
    result: {
      schemaVersion: "guardian.agent.v1",
      command: "list-long-threads",
      generatedAt: new Date().toISOString(),
      query: `session_bytes>=${minBytes} OR stale_role_threads`,
      mode: "read_only",
      items,
      warnings,
      thresholds: {
        minBytes,
        minMegabytes: Math.round(minBytes / 1024 / 1024),
        minAgeMinutes,
        limit,
        ceoCreatedThreadIdleDays: Math.max(1, Number(options.ceoCreatedThreadIdleDays || STALE_CEO_CREATED_THREAD_DAYS)),
        ceoThreadIdleDays: Math.max(1, Number(options.ceoThreadIdleDays || STALE_CEO_MAIN_THREAD_DAYS)),
        unknownThreadIdleDays: Math.max(1, Number(options.unknownThreadIdleDays || STALE_UNKNOWN_THREAD_DAYS)),
      },
      backlog: {
        totalCandidates: allCandidates.length,
        incrementalCandidateCount: incrementalCandidates.length,
        alreadyProcessedCount: alreadyProcessedCandidates.length,
        selectedBatchCount: selected.length,
        remainingAfterBatch: Math.max(0, incrementalCandidates.length - selected.length),
        unvaultedCount: unvaultedCandidates.length,
        vaultedCount: vaultedCandidates.length,
        sourceChangedCount: sourceChangedCandidates.length,
        missingCompactReceiptCount: missingCompactReceiptCandidates.length,
        staleRoleCount: staleRoleFiles.length,
        largeCount: largeFiles.length,
      },
      provenance: {
        guardianInventoryPath: inventory.inventoryPath,
        guardianRestoreIndexPath: path.join(codexHomePath(), "guardian", "restore-index.json"),
        zhixiaIndexPath: "",
        sourceGeneratedAt: reportResult.result.generated_at || null,
        inventoryGeneratedAt: inventory.generatedAt,
        selectedLargeCount: largeFiles.length,
        selectedStaleRoleCount: staleRoleFiles.length,
      },
    },
    scriptPath: reportResult.scriptPath,
    stderr: reportResult.stderr,
  };
}

function codexArchiveQueueRoot() {
  return path.join(codexHistoryVaultRoot(), "archive-queues");
}

function compactReceiptEvidence(receipt = {}) {
  if (!receipt || typeof receipt !== "object") return {};
  return {
    receiptPath: receipt.receiptPath || receipt.receipt_path || receipt.path || receipt.outputPath || null,
    receiptSha256: receipt.receiptSha256 || receipt.receipt_sha256 || receipt.sha256 || null,
    threadStoreCompatible: receipt.threadStoreCompatible ?? receipt.thread_store_compatible ?? null,
    vaultManifestPath: receipt.vaultManifestPath || receipt.vault_manifest_path || null,
    vaultSessionPath: receipt.vaultSessionPath || receipt.vault_session_path || null,
    vaultSha256: receipt.vaultSha256 || receipt.vault_sha256 || null,
  };
}

function buildArchiveQueueCandidate(item = {}, metadata = {}) {
  const receipt = metadata.compactReceipt || item.compactReceipt || item.receipt || null;
  const receiptEvidence = compactReceiptEvidence(receipt);
  const existingEvidence = item.archiveCandidate?.evidence || {};
  const normalized = normalizeArchiveCandidateEvidence({
    ...item,
    threadId: item.threadId,
    status: item.status || existingEvidence.status || "idle",
    projectStatus: item.projectStatus || item.provenance?.restoreState || existingEvidence.projectStatus || "paused",
    archiveState: item.archiveState || existingEvidence.archiveState || item.status || "warm",
    lastWriteTime: item.sessionLastWriteTime || item.provenance?.lastWriteTime || existingEvidence.lastWriteTime || null,
    sessionBytes: item.sessionBytes || existingEvidence.sessionBytes || 0,
    hasThreadHistoryVault: item.hasThreadHistoryVault ?? existingEvidence.hasVault ?? existingEvidence.hasVaultEvidence,
    hasMemoryPointer: item.hasMemoryPointer ?? existingEvidence.hasMemoryPointer,
    hasZhixiaHistoryPointer: item.hasZhixiaHistoryPointer ?? existingEvidence.hasMemoryPointer,
    memoryPointers: safeArray(existingEvidence.memoryPointers),
    sourceRefs: safeArray(item.sourceRefs).length > 0 ? item.sourceRefs : safeArray(existingEvidence.sourceRefs),
    compactReceipt: receipt,
    compactReceiptPath: receiptEvidence.receiptPath || existingEvidence.compactReceiptPath || null,
    compactReceiptSha256: receiptEvidence.receiptSha256 || existingEvidence.compactReceiptSha256 || null,
    threadStoreCompatible: receiptEvidence.threadStoreCompatible ?? existingEvidence.threadStoreCompatible ?? null,
    vaultManifestPath: receiptEvidence.vaultManifestPath || existingEvidence.vaultManifestPath || null,
    vaultSessionPath: receiptEvidence.vaultSessionPath || existingEvidence.vaultSessionPath || null,
    vaultSha256: receiptEvidence.vaultSha256 || existingEvidence.vaultSha256 || null,
  });
  return evaluateArchiveCandidate(normalized, {
    requireCompactReceipt: metadata.requireCompactReceipt !== false,
    bypassRoleCooling: metadata.bypassRoleCooling === true,
    ceoThreadIdleDays: metadata.ceoThreadIdleDays,
    ceoCreatedThreadIdleDays: metadata.ceoCreatedThreadIdleDays,
    unknownThreadIdleDays: metadata.unknownThreadIdleDays,
  });
}

async function generateCodexArchiveQueue(options = {}) {
  const rawItems = safeArray(options.items).slice(0, 1000);
  const compactReceipts = options.compactReceipts && typeof options.compactReceipts === "object" ? options.compactReceipts : {};
  const skipThreadIds = new Set(safeArray(options.skipThreadIds).map((id) => String(id || "").trim()).filter(Boolean));
  const generatedAt = new Date().toISOString();
  const queueId = `codex-archive-queue-${generatedAt.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const ready = [];
  const skipped = [];
  let skippedActiveCount = 0;

  for (const item of rawItems) {
    const threadId = String(item?.threadId || "").trim();
    if (!threadId) {
      skipped.push({
        threadId: null,
        title: compactText(item?.title || "缺少 threadId 的线程", 120),
        blockers: ["missing_thread_id"],
        reason: "缺少 threadId，无法交给 Codex 宿主归档。",
      });
      continue;
    }
    if (skipThreadIds.has(threadId)) {
      skipped.push({
        threadId,
        title: compactText(item.title || threadId, 120),
        blockers: ["explicit_skip_thread_id"],
        reason: "该线程在当前执行中被显式保护，不进入归档队列。",
      });
      continue;
    }

    const candidate = buildArchiveQueueCandidate(item, {
      compactReceipt: compactReceipts[threadId],
      requireCompactReceipt: options.requireCompactReceipt === true,
      bypassRoleCooling: options.bypassRoleCooling === true,
      ceoThreadIdleDays: options.ceoThreadIdleDays,
      ceoCreatedThreadIdleDays: options.ceoCreatedThreadIdleDays,
      unknownThreadIdleDays: options.unknownThreadIdleDays,
    });
    if (!candidate.isCandidate) {
      if (
        candidate.blockers.includes("thread_active_or_running") ||
        candidate.blockers.includes("recently_written") ||
        candidate.blockers.includes("pinned_or_keep_hot") ||
        candidate.blockers.includes("unfinished_work")
      ) {
        skippedActiveCount += 1;
      }
      skipped.push({
        threadId,
        title: compactText(item.title || threadId, 120),
        blockers: candidate.blockers,
        reasons: candidate.reasons,
        reason: candidate.blockers.length > 0 ? candidate.blockers.join(", ") : "证据不足，暂不归档。",
        archiveCandidate: candidate,
      });
      continue;
    }

    ready.push({
      threadId,
      title: compactText(item.title || `Codex 老线程 ${threadId.slice(0, 8)}`, 140),
      summary: compactText(item.summary || "", 360),
      action: "archive_codex_sidebar_thread",
      status: "ready_for_host_archive",
      generatedAt,
      sessionBytes: item.sessionBytes || candidate.evidence.sessionBytes || 0,
      sessionLastWriteTime: item.sessionLastWriteTime || candidate.evidence.lastWriteTime || null,
      hostBridge: {
        requiredTool: "codex_app.set_thread_archived",
        archived: true,
        availableInsideZhixiaApp: false,
        reason: "Codex 侧栏归档是桌面宿主能力，打包后的知匣 App 只能生成安全队列与回执。",
      },
      safety: {
        deletesSession: false,
        mutatesRawSession: false,
        requiresVerifiedVault: true,
        requiresCompactReceipt: options.requireCompactReceipt === true,
        restorePointerPolicy: "Thread History Vault before sidebar archive; compact receipt is kept when slimming has already run",
      },
      evidence: candidate.evidence,
      archiveCandidate: candidate,
    });
  }

  const queue = {
    schemaVersion: "zhixia.codex_sidebar_archive_queue.v1",
    queueId,
    generatedAt,
    mode: "host_bridge_required",
    executionState: ready.length > 0 ? "pending_host_archive_bridge" : "no_ready_threads",
    appCanArchiveCodexSidebar: false,
    readyCount: ready.length,
    skippedCount: skipped.length,
    queuedForArchiveCount: ready.length,
    skippedActiveCount,
    preservedCount: rawItems.filter((item) => item?.hasThreadHistoryVault === true || item?.hasZhixiaThreadHistoryVault === true).length,
    alreadyPreservedCount: rawItems.filter((item) => item?.incrementalAction === "already_processed").length,
    totalCount: rawItems.length,
    hostBridge: {
      requiredTool: "codex_app.set_thread_archived",
      callbackPolicy: "CEO/Codex host reads this queue and archives ready threadIds; Zhixia records the queue but does not delete or move sessions.",
    },
    items: ready,
    skipped,
  };

  const queueRoot = codexArchiveQueueRoot();
  await fs.mkdir(queueRoot, { recursive: true });
  const queuePath = path.join(queueRoot, `${safeVaultName(queueId)}.json`);
  const payload = { ...queue, queuePath };
  await fs.writeFile(queuePath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function buildReportOnlyLongThreadItem(file, options = {}) {
  const threadId = file.threadId || extractThreadIdFromSessionPath(file.path) || path.basename(String(file.path || ""), ".jsonl");
  const tokenBudget = Math.max(200, Math.min(4000, Math.floor(Number(options.tokenBudget) || 900)));
  const title = cleanGuardianHistoryText(file.title_guess, "") || `Codex 老线程 ${String(threadId).slice(0, 8)}`;
  const goal = cleanGuardianHistoryText(file.user_goal_guess, "");
  const role = file.archiveThreadRole || guardianInventoryArchiveRole({
    thread_id: threadId,
    title_guess: file.title_guess,
    user_goal_guess: file.user_goal_guess,
    source_bucket: file.source_bucket,
    source_path: file.path,
    labels: file.labels,
  });
  const summary = [
    file.pressureReason === "stale_ceo_created_thread"
      ? "Guardian inventory found a CEO-created worker/review/audit thread past the 3-day cooling rule."
      : file.pressureReason === "stale_unknown_thread"
        ? "Guardian inventory found an old unclassified Codex thread past the 3-day archive-after-vault rule."
        : `Guardian report found a long Codex session file (${formatBytesForReport(Number(file.size_bytes || 0))}).`,
    goal ? `Goal: ${goal}` : "Compact inventory context is not available yet, so Zhixia is showing a metadata-only archive governance fallback.",
    "Raw session content is not read by default.",
  ].join(" ");
  const clippedSummary = summary.slice(0, Math.max(240, tokenBudget * 3));
  return {
    threadId,
    title,
    summary: clippedSummary,
    archiveThreadRole: role,
    status: file.status_guess || "indexed",
    freshness: "review",
    whyMatched: "Matched Guardian report long-session metadata; compact context fallback.",
    tokenEstimate: Math.ceil(clippedSummary.length / 4),
    requiresHumanConfirmation: true,
    restoreCommand: `guardian restore -ThreadId "${threadId}" -DryRun -Json`,
    sourceRefs: [
      {
        kind: "guardian_report",
        path: path.join(codexHomePath(), "guardian", "health-latest.json"),
        field: `largest_session_files[thread_id=${threadId}]`,
      },
      {
        kind: "raw_session",
        path: file.path,
        sha256: file.sha256 || undefined,
        readByDefault: false,
      },
    ],
    provenance: {
      sourceBucket: file.source_bucket || "report_metadata",
      restoreState: file.restore_state || "present",
      lastWriteTime: file.last_write_time || null,
      projectRoot: file.project_root || "unknown",
      metadataOnlyFallback: true,
    },
  };
}

function formatBytesForReport(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

async function getRuntimeMonitorSnapshot(options = {}) {
  const sessionLimit = Math.max(1, Math.min(20, Math.floor(Number(options.sessionLimit) || 12)));
  const includeLongThreadMetadata = options.includeLongThreadMetadata === true;
  const longThreadLimit = Math.max(1, Math.min(8, Math.floor(Number(options.longThreadLimit) || 6)));
  const minBytes = Math.max(1024 * 1024, Math.floor(Number(options.minBytes) || LONG_CODEX_THREAD_BYTES));
  return collectRuntimeMonitorSnapshot({
    ...options,
    sessionLimit,
    guardianReportProvider: () => runCodexGuardian("report"),
    longThreadsProvider: includeLongThreadMetadata
      ? () => listLongCodexThreads({
          limit: longThreadLimit,
          minBytes,
          minAgeMinutes: 0,
          tokenBudget: 700,
        })
      : null,
  });
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath).toLowerCase();
  const child = path.resolve(childPath).toLowerCase();
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function supportedExtension(filePath) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function isLikelyProjectDir(entryNames) {
  const names = new Set(entryNames.map((name) => name.toLowerCase()));
  return (
    names.has(".codex-knowledge") ||
    names.has("package.json") ||
    names.has("pyproject.toml") ||
    names.has("cargo.toml") ||
    names.has(".git") ||
    names.has("readme.md") ||
    names.has("docs")
  );
}

async function ensureSqlRuntime() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
  return SQL;
}

async function ensureDatabase() {
  if (dbReady) return dbReady;
  dbReady = (async () => {
    const Runtime = await ensureSqlRuntime();
    const file = dbPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      const bytes = await fs.readFile(file);
      db = new Runtime.Database(bytes);
    } catch {
      db = new Runtime.Database();
    }
    migrateSchema();
    await migrateLegacyJson();
    await compactLegacyDocumentContentStore();
    await saveDatabase();
    return db;
  })();
  return dbReady;
}

function migrateSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL UNIQUE,
      extension TEXT NOT NULL,
      size INTEGER NOT NULL,
      importedAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      fileModifiedAt TEXT,
      contentHash TEXT,
      contentText TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      tagsJson TEXT NOT NULL DEFAULT '[]',
      favorite INTEGER NOT NULL DEFAULT 0,
      parseStatus TEXT NOT NULL,
      parseError TEXT,
      duplicateOf TEXT,
      indexVersion INTEGER NOT NULL DEFAULT ${INDEX_VERSION},
      sourceType TEXT NOT NULL DEFAULT 'imported',
      workspacePath TEXT,
      artifactType TEXT
    );
  `);
  ensureColumn("documents", "sourceType", "TEXT NOT NULL DEFAULT 'imported'");
  ensureColumn("documents", "workspacePath", "TEXT");
  ensureColumn("documents", "artifactType", "TEXT");
  db.run("CREATE INDEX IF NOT EXISTS idx_documents_filepath ON documents(filePath);");
  db.run("CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(contentHash);");
  db.run("CREATE INDEX IF NOT EXISTS idx_documents_imported ON documents(importedAt);");
  db.run("CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(sourceType);");
  db.run(`
    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      documentId TEXT NOT NULL,
      versionNo INTEGER NOT NULL,
      filePath TEXT NOT NULL,
      contentHash TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      contentText TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      changeSummary TEXT,
      createdBy TEXT NOT NULL
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(documentId, versionNo);");
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS experience_cards (
      id TEXT PRIMARY KEY,
      projectPath TEXT,
      scope TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      tagsJson TEXT NOT NULL DEFAULT '[]',
      sourcePath TEXT,
      sourceHash TEXT,
      retrievalMetaJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'candidate',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  ensureColumn("experience_cards", "retrievalMetaJson", "TEXT NOT NULL DEFAULT '{}'");
  db.run("CREATE INDEX IF NOT EXISTS idx_experience_project ON experience_cards(projectPath);");
  db.run("CREATE INDEX IF NOT EXISTS idx_experience_source ON experience_cards(sourceType, sourceHash);");
  db.run("CREATE INDEX IF NOT EXISTS idx_experience_status ON experience_cards(status);");
  db.run(`
    CREATE TABLE IF NOT EXISTS skill_candidates (
      id TEXT PRIMARY KEY,
      projectPath TEXT,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      triggerPatternsJson TEXT NOT NULL DEFAULT '[]',
      draftSkillMarkdown TEXT NOT NULL DEFAULT '',
      evidenceJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_skill_candidates_project ON skill_candidates(projectPath);");
  db.run("CREATE INDEX IF NOT EXISTS idx_skill_candidates_status ON skill_candidates(status);");
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_skill_record_governance (
      projectPath TEXT NOT NULL,
      recordId TEXT NOT NULL,
      recordIdentity TEXT NOT NULL,
      recordContextHash TEXT NOT NULL,
      status TEXT NOT NULL,
      reviewedAt TEXT NOT NULL,
      reviewer TEXT NOT NULL DEFAULT 'human',
      snapshotHash TEXT,
      sourcePath TEXT,
      sourceHash TEXT,
      kind TEXT,
      name TEXT,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY(projectPath, recordId)
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_skill_governance_project ON tool_skill_record_governance(projectPath);");
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_skill_governance_status ON tool_skill_record_governance(status);");
  db.run(`
    CREATE TABLE IF NOT EXISTS thread_lineage_index (
      id TEXT PRIMARY KEY,
      ceoThreadId TEXT NOT NULL,
      title TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'project',
      projectIdsJson TEXT NOT NULL DEFAULT '[]',
      workspacePathsJson TEXT NOT NULL DEFAULT '[]',
      relationshipsJson TEXT NOT NULL DEFAULT '{}',
      relationshipCountsJson TEXT NOT NULL DEFAULT '{}',
      governanceJson TEXT NOT NULL DEFAULT '{}',
      archiveState TEXT NOT NULL DEFAULT 'warm',
      lastActivityAt TEXT,
      lastSummary TEXT NOT NULL DEFAULT '',
      nextAction TEXT NOT NULL DEFAULT '',
      sourceRefsJson TEXT NOT NULL DEFAULT '[]',
      sourceSignature TEXT NOT NULL,
      indexedAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_thread_lineage_ceo ON thread_lineage_index(ceoThreadId);");
  db.run("CREATE INDEX IF NOT EXISTS idx_thread_lineage_updated ON thread_lineage_index(updatedAt);");
  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      projectPath TEXT,
      documentId TEXT,
      sourcePath TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      tagsJson TEXT NOT NULL DEFAULT '[]',
      sourceHash TEXT,
      provider TEXT NOT NULL DEFAULT 'local',
      model TEXT NOT NULL DEFAULT 'heuristic',
      status TEXT NOT NULL DEFAULT 'ready',
      errorMessage TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_items(projectPath);");
  db.run("CREATE INDEX IF NOT EXISTS idx_knowledge_document ON knowledge_items(documentId);");
  db.run("CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_items(category);");
  db.run("CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_items(status);");
  db.run(`
    CREATE TABLE IF NOT EXISTS zhixia_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      displayName TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      builtIn INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      triggerActionsJson TEXT NOT NULL DEFAULT '[]',
      aiProvider TEXT NOT NULL DEFAULT 'optional',
      allowedReadScopesJson TEXT NOT NULL DEFAULT '[]',
      allowedWriteScopesJson TEXT NOT NULL DEFAULT '[]',
      forbiddenActionsJson TEXT NOT NULL DEFAULT '[]',
      outputSchema TEXT NOT NULL DEFAULT '',
      sourcePath TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_zhixia_skills_enabled ON zhixia_skills(enabled);");
  db.run(`
    CREATE TABLE IF NOT EXISTS skill_run_receipts (
      id TEXT PRIMARY KEY,
      skillId TEXT NOT NULL,
      skillVersion TEXT NOT NULL,
      triggerAction TEXT NOT NULL,
      projectId TEXT,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      inputSourceRefsJson TEXT NOT NULL DEFAULT '[]',
      inputHash TEXT NOT NULL,
      outputHash TEXT,
      writtenRecordsJson TEXT NOT NULL DEFAULT '[]',
      blockedReason TEXT,
      errorMessage TEXT,
      durationMs INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_skill_run_receipts_skill ON skill_run_receipts(skillId, createdAt);");
  db.run("CREATE INDEX IF NOT EXISTS idx_skill_run_receipts_project ON skill_run_receipts(projectId, createdAt);");
  syncBuiltinZhixiaSkills();
  setSettingIfMissing("autoDetectChanges", false);
  setSettingIfMissing("autoWatchChanges", false);
  setSettingIfMissing("maxFileSizeMb", 50);
  setSettingIfMissing("autoInstallSkill", false);
  setSettingIfMissing("autoflowWorkflowPath", DEFAULT_AUTOFLOW_WORKFLOW_PATH);
  setSettingIfMissing("bugFixMemoryPath", DEFAULT_BUG_FIX_MEMORY_PATH);
  setSettingIfMissing("aiProviderBaseUrl", DEFAULT_AI_PROVIDER_BASE_URL);
  setSettingIfMissing("aiProviderModel", DEFAULT_AI_PROVIDER_MODEL);
  setSettingIfMissing("aiProviderApiKey", "");
  migratePerformanceSafeDefaults();
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.exec(`PRAGMA table_info(${tableName})`);
  const exists = columns[0]?.values?.some((row) => row[1] === columnName);
  if (!exists) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function setSettingIfMissing(key, value) {
  const exists = db.exec("SELECT value FROM settings WHERE key = $key", { $key: key });
  if (exists.length === 0 || exists[0].values.length === 0) {
    db.run("INSERT INTO settings (key, value) VALUES ($key, $value)", {
      $key: key,
      $value: JSON.stringify(value),
    });
  }
}

function migratePerformanceSafeDefaults() {
  const settings = getSettings();
  if (Number(settings.performanceSafeSettingsVersion || 0) >= PERFORMANCE_SAFE_SETTINGS_VERSION) return;
  updateSettings({
    autoDetectChanges: false,
    autoWatchChanges: false,
    performanceSafeSettingsVersion: PERFORMANCE_SAFE_SETTINGS_VERSION,
    performanceSafeSettingsAppliedAt: new Date().toISOString(),
  });
}

function builtinZhixiaSkillDefinitions() {
  return [
    {
      id: ZHIXIA_SKILL_PROJECT_SUMMARY_ID,
      name: "project-summary-cn",
      displayName: "项目中文摘要",
      version: "0.2.0",
      description: "为项目卡片生成中文内容总结：说明这是什么项目、解决什么问题、有哪些关键资料，不显示 JSON、代码路径或原始任务片段。",
      builtIn: true,
      enabled: true,
      triggerActions: ["project.summary.generate"],
      aiProvider: "optional",
      allowedReadScopes: ["project_record", "document_summary", "knowledge_item", "memory_card", "tool_skill_record"],
      allowedWriteScopes: ["project_record", "skill_run_receipt"],
      forbiddenActions: [
        "shell_execute",
        "install_software",
        "delete_file",
        "move_codex_session",
        "read_credentials",
        "upload_raw_session",
        "upload_full_document",
      ],
      outputSchema:
        '{"title":"中文项目名","summary":"80-160字中文项目介绍","nextAction":"一句下一步","blockers":["可选阻塞"],"status":"active|paused|waiting_review|waiting_user|completed|archived|unknown","completion":"idea|prd|design|implementation|testing|packaging|released|maintenance|unknown"}',
      sourcePath: null,
    },
  ];
}

function syncBuiltinZhixiaSkills() {
  const now = new Date().toISOString();
  for (const skill of builtinZhixiaSkillDefinitions()) {
    db.run(
      `INSERT INTO zhixia_skills (
        id, name, displayName, version, description, builtIn, enabled,
        triggerActionsJson, aiProvider, allowedReadScopesJson, allowedWriteScopesJson,
        forbiddenActionsJson, outputSchema, sourcePath, createdAt, updatedAt
      ) VALUES (
        $id, $name, $displayName, $version, $description, $builtIn, $enabled,
        $triggerActionsJson, $aiProvider, $allowedReadScopesJson, $allowedWriteScopesJson,
        $forbiddenActionsJson, $outputSchema, $sourcePath, $createdAt, $updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = $name,
        displayName = $displayName,
        version = $version,
        description = $description,
        builtIn = $builtIn,
        triggerActionsJson = $triggerActionsJson,
        aiProvider = $aiProvider,
        allowedReadScopesJson = $allowedReadScopesJson,
        allowedWriteScopesJson = $allowedWriteScopesJson,
        forbiddenActionsJson = $forbiddenActionsJson,
        outputSchema = $outputSchema,
        sourcePath = $sourcePath,
        updatedAt = $updatedAt`,
      {
        $id: skill.id,
        $name: skill.name,
        $displayName: skill.displayName,
        $version: skill.version,
        $description: skill.description,
        $builtIn: skill.builtIn ? 1 : 0,
        $enabled: skill.enabled ? 1 : 0,
        $triggerActionsJson: JSON.stringify(skill.triggerActions || []),
        $aiProvider: skill.aiProvider || "optional",
        $allowedReadScopesJson: JSON.stringify(skill.allowedReadScopes || []),
        $allowedWriteScopesJson: JSON.stringify(skill.allowedWriteScopes || []),
        $forbiddenActionsJson: JSON.stringify(skill.forbiddenActions || []),
        $outputSchema: skill.outputSchema || "",
        $sourcePath: skill.sourcePath || null,
        $createdAt: now,
        $updatedAt: now,
      },
    );
  }
}

function rowToZhixiaSkill(row) {
  return {
    id: row[0],
    name: row[1],
    displayName: row[2],
    version: row[3],
    description: row[4],
    builtIn: Boolean(row[5]),
    enabled: Boolean(row[6]),
    triggerActions: safeJsonParseValue(row[7], []),
    aiProvider: row[8] || "optional",
    allowedReadScopes: safeJsonParseValue(row[9], []),
    allowedWriteScopes: safeJsonParseValue(row[10], []),
    forbiddenActions: safeJsonParseValue(row[11], []),
    outputSchema: row[12] || "",
    sourcePath: row[13] || null,
    createdAt: row[14],
    updatedAt: row[15],
  };
}

function listZhixiaSkills() {
  syncBuiltinZhixiaSkills();
  const rows = db.exec(
    "SELECT id, name, displayName, version, description, builtIn, enabled, triggerActionsJson, aiProvider, allowedReadScopesJson, allowedWriteScopesJson, forbiddenActionsJson, outputSchema, sourcePath, createdAt, updatedAt FROM zhixia_skills ORDER BY builtIn DESC, displayName ASC",
  );
  return (rows[0]?.values || []).map(rowToZhixiaSkill);
}

function getZhixiaSkillDefinition(skillId) {
  return listZhixiaSkills().find((skill) => skill.id === skillId || skill.name === skillId) || null;
}

function rowToSkillRunReceipt(row) {
  return {
    id: row[0],
    skillId: row[1],
    skillVersion: row[2],
    triggerAction: row[3],
    projectId: row[4] || null,
    status: row[5],
    provider: row[6],
    model: row[7] || null,
    inputSourceRefs: safeJsonParseValue(row[8], []),
    inputHash: row[9],
    outputHash: row[10] || null,
    writtenRecords: safeJsonParseValue(row[11], []),
    blockedReason: row[12] || null,
    errorMessage: row[13] || null,
    durationMs: Number(row[14] || 0),
    createdAt: row[15],
  };
}

function listSkillRunReceipts(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 30), 200));
  const params = { $limit: limit };
  const clauses = [];
  if (options.skillId) {
    clauses.push("skillId = $skillId");
    params.$skillId = String(options.skillId);
  }
  if (options.projectId) {
    clauses.push("projectId = $projectId");
    params.$projectId = String(options.projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.exec(
    `SELECT id, skillId, skillVersion, triggerAction, projectId, status, provider, model, inputSourceRefsJson, inputHash, outputHash, writtenRecordsJson, blockedReason, errorMessage, durationMs, createdAt
     FROM skill_run_receipts ${where} ORDER BY createdAt DESC LIMIT $limit`,
    params,
  );
  return (rows[0]?.values || []).map(rowToSkillRunReceipt);
}

function insertSkillRunReceipt(receipt) {
  db.run(
    `INSERT INTO skill_run_receipts (
      id, skillId, skillVersion, triggerAction, projectId, status, provider, model,
      inputSourceRefsJson, inputHash, outputHash, writtenRecordsJson, blockedReason, errorMessage, durationMs, createdAt
    ) VALUES (
      $id, $skillId, $skillVersion, $triggerAction, $projectId, $status, $provider, $model,
      $inputSourceRefsJson, $inputHash, $outputHash, $writtenRecordsJson, $blockedReason, $errorMessage, $durationMs, $createdAt
    )`,
    {
      $id: receipt.id,
      $skillId: receipt.skillId,
      $skillVersion: receipt.skillVersion,
      $triggerAction: receipt.triggerAction,
      $projectId: receipt.projectId || null,
      $status: receipt.status,
      $provider: receipt.provider,
      $model: receipt.model || null,
      $inputSourceRefsJson: JSON.stringify(receipt.inputSourceRefs || []),
      $inputHash: receipt.inputHash || "",
      $outputHash: receipt.outputHash || null,
      $writtenRecordsJson: JSON.stringify(receipt.writtenRecords || []),
      $blockedReason: receipt.blockedReason || null,
      $errorMessage: receipt.errorMessage || null,
      $durationMs: Math.max(0, Math.round(Number(receipt.durationMs || 0))),
      $createdAt: receipt.createdAt,
    },
  );
  return receipt;
}

function getSettingValue(key, fallback = null) {
  const result = db.exec("SELECT value FROM settings WHERE key = $key", { $key: key });
  const raw = result[0]?.values?.[0]?.[0];
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function backupDatabaseBeforeCompaction() {
  const source = dbPath();
  if (!(await pathExists(source))) return null;
  const backupDir = path.join(app.getPath("userData"), "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const target = path.join(backupDir, `knowledge-store-before-content-compact-${stamp}.sqlite`);
  await fs.copyFile(source, target);
  return target;
}

async function compactLegacyDocumentContentStore() {
  const completedVersion = Number(getSettingValue("contentStoreCompactionVersion", 0));
  if (completedVersion >= CONTENT_STORE_COMPACTION_VERSION) return;

  const duplicateRows = db.exec("SELECT COUNT(*) FROM documents WHERE duplicateOf IS NOT NULL AND LENGTH(contentText) > 0");
  const oversizedRows = db.exec("SELECT COUNT(*) FROM documents WHERE LENGTH(contentText) > $limit", {
    $limit: MAX_DOCUMENT_CONTENT_TEXT_CHARS,
  });
  const versionOversizedRows = db.exec("SELECT COUNT(*) FROM document_versions WHERE LENGTH(contentText) > $limit", {
    $limit: MAX_DOCUMENT_CONTENT_TEXT_CHARS,
  });
  const duplicateCount = Number(duplicateRows[0]?.values?.[0]?.[0] || 0);
  const oversizedCount = Number(oversizedRows[0]?.values?.[0]?.[0] || 0);
  const versionOversizedCount = Number(versionOversizedRows[0]?.values?.[0]?.[0] || 0);

  if (duplicateCount || oversizedCount || versionOversizedCount) {
    const backupPath = await backupDatabaseBeforeCompaction();
    console.log(
      `Compacting legacy Zhixia document content store: duplicates=${duplicateCount}, oversized=${oversizedCount}, versionOversized=${versionOversizedCount}, backup=${backupPath || "none"}`,
    );
    db.run("UPDATE documents SET contentText = '' WHERE duplicateOf IS NOT NULL AND LENGTH(contentText) > 0");
    db.run("UPDATE documents SET contentText = substr(contentText, 1, $limit) WHERE LENGTH(contentText) > $limit", {
      $limit: MAX_DOCUMENT_CONTENT_TEXT_CHARS,
    });
    db.run("UPDATE document_versions SET contentText = substr(contentText, 1, $limit) WHERE LENGTH(contentText) > $limit", {
      $limit: MAX_DOCUMENT_CONTENT_TEXT_CHARS,
    });
    db.run("VACUUM");
  } else if (completedVersion < CONTENT_STORE_COMPACTION_VERSION) {
    console.log("Vacuuming compacted Zhixia document content store to release free SQLite pages.");
    db.run("VACUUM");
  }

  db.run(
    `INSERT INTO settings (key, value) VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = $value`,
    {
      $key: "contentStoreCompactionVersion",
      $value: JSON.stringify(CONTENT_STORE_COMPACTION_VERSION),
    },
  );
}

async function migrateLegacyJson() {
  const existing = db.exec("SELECT COUNT(*) AS count FROM documents");
  const count = existing[0]?.values?.[0]?.[0] || 0;
  if (count > 0) return;

  try {
    const raw = await fs.readFile(legacyStorePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.documents)) return;
    for (const legacy of parsed.documents) {
      upsertDocument({
        id: legacy.id || crypto.randomUUID(),
        title: legacy.title || legacy.fileName || "未命名文档",
        fileName: legacy.fileName || path.basename(legacy.filePath || ""),
        filePath: legacy.filePath || "",
        extension: legacy.extension || path.extname(legacy.filePath || "").toLowerCase(),
        size: Number(legacy.size || 0),
        importedAt: legacy.importedAt || new Date().toISOString(),
        updatedAt: legacy.updatedAt || new Date().toISOString(),
        fileModifiedAt: legacy.fileModifiedAt || null,
        contentHash: legacy.contentHash || null,
        contentText: legacy.contentText || "",
        summary: legacy.summary || "",
        tags: Array.isArray(legacy.tags) ? legacy.tags : [],
        favorite: Boolean(legacy.favorite),
        parseStatus: legacy.parseStatus || "failed",
        parseError: legacy.parseError || null,
        duplicateOf: legacy.duplicateOf || null,
        indexVersion: legacy.indexVersion || 1,
        sourceType: legacy.sourceType || "imported",
        workspacePath: legacy.workspacePath || null,
        artifactType: legacy.artifactType || null,
      });
    }
  } catch {
    // No legacy JSON store exists.
  }
}

async function writeDatabaseFile() {
  const bytes = db.export();
  const targetPath = dbPath();
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, Buffer.from(bytes));
  await fs.rename(tempPath, targetPath);
}

async function databaseFileSizeBytes() {
  try {
    const stat = await fs.stat(dbPath());
    return stat.size;
  } catch {
    return 0;
  }
}

function isSqlJsMemoryError(error) {
  return /memory access out of bounds|out of memory|Array buffer allocation failed|Cannot enlarge memory/i.test(
    String(error?.message || error || ""),
  );
}

async function shouldBypassSqliteHistoryWrite() {
  return (await databaseFileSizeBytes()) >= SQLITE_HISTORY_WRITE_SAFE_BYTES;
}

async function saveDatabase() {
  const runSave = () => writeDatabaseFile();
  dbSaveQueue = dbSaveQueue.then(runSave, runSave);
  return dbSaveQueue;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function readSkillVersion(skillDir) {
  try {
    const stat = await fs.stat(path.join(skillDir, "SKILL.md"));
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

async function hashFileIfExists(filePath) {
  try {
    const data = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return "";
  }
}

async function readSkillFingerprint(skillDir) {
  const files = [
    "SKILL.md",
    path.join("agents", "openai.yaml"),
    path.join("references", "context-bundle.md"),
    path.join("scripts", "read-project-knowledge.cjs"),
  ];
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(await hashFileIfExists(path.join(skillDir, file)));
  }
  return hash.digest("hex");
}

async function getSkillStatus() {
  const sourcePath = bundledSkillPath();
  const targetPath = installedSkillPath();
  const sourceExists = await pathExists(path.join(sourcePath, "SKILL.md"));
  const installed = await pathExists(path.join(targetPath, "SKILL.md"));
  const sourceFingerprint = sourceExists ? await readSkillFingerprint(sourcePath) : null;
  const installedFingerprint = installed ? await readSkillFingerprint(targetPath) : null;
  return {
    name: ZHIXIA_SKILL_NAME,
    sourcePath,
    codexHome: codexHomePath(),
    skillsPath: codexSkillsPath(),
    targetPath,
    sourceExists,
    installed,
    sourceVersion: await readSkillVersion(sourcePath),
    installedVersion: installed ? await readSkillVersion(targetPath) : null,
    sourceFingerprint,
    installedFingerprint,
    updateAvailable: Boolean(sourceExists && (!installed || sourceFingerprint !== installedFingerprint)),
  };
}

async function installBundledSkill() {
  const sourcePath = bundledSkillPath();
  const skillsPath = codexSkillsPath();
  const targetPath = installedSkillPath();
  const tempPath = path.join(skillsPath, `${ZHIXIA_SKILL_NAME}.tmp-${Date.now()}`);

  if (!(await pathExists(path.join(sourcePath, "SKILL.md")))) {
    throw new Error(`未找到内置 Skill：${sourcePath}`);
  }
  if (!isPathInside(skillsPath, targetPath) || !isPathInside(skillsPath, tempPath)) {
    throw new Error("Skill 安装路径校验失败。");
  }

  await fs.mkdir(skillsPath, { recursive: true });
  await fs.rm(tempPath, { recursive: true, force: true });
  await copyDirectory(sourcePath, tempPath);
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.rename(tempPath, targetPath);
  return getSkillStatus();
}

async function autoInstallBundledSkillIfEnabled() {
  const settings = getSettings();
  if (settings.autoInstallSkill === false) return;
  const status = await getSkillStatus();
  if (status.updateAvailable) {
    await installBundledSkill();
  }
}

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeSummary(text, fallback) {
  const clean = cleanText(text);
  if (!clean) return fallback || "未提取到可搜索正文。";
  return clean.slice(0, 260) + (clean.length > 260 ? "..." : "");
}

function textLimit(text) {
  const clean = cleanText(stripHeavyInlinePayloads(text));
  return clean.length > MAX_DOCUMENT_CONTENT_TEXT_CHARS ? clean.slice(0, MAX_DOCUMENT_CONTENT_TEXT_CHARS) : clean;
}

function stripHeavyInlinePayloads(text) {
  return String(text || "")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]{256,}/gi, "[image payload stripped: OCR/summary/source pointer only]")
    .replace(/("(?:image_url|image|screenshot|attachment)"\s*:\s*")data:[^"]{256,}(")/gi, "$1[image payload stripped]$2")
    .replace(/\b[A-Za-z0-9+/]{4096,}={0,2}\b/g, "[large base64-like payload stripped]");
}

async function parseTextFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return textLimit(raw);
}

async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return textLimit(result.value || "");
}

async function parsePdf(filePath) {
  const data = await fs.readFile(filePath);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return textLimit(result.text || "");
  } finally {
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
  }
}

async function parseFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.includes(extension)) {
    return { status: "ok", text: await parseTextFile(filePath) };
  }
  if (extension === ".docx") {
    return { status: "ok", text: await parseDocx(filePath) };
  }
  if (extension === ".pdf") {
    return { status: "ok", text: await parsePdf(filePath) };
  }
  if ([".xlsx", ".xls"].includes(extension)) {
    return {
      status: "failed",
      text: "",
      error: "当前未启用 Excel 二进制解析器；CSV 已支持。为避免已知漏洞，XLSX/XLS 解析将在后续安全方案中接入。",
    };
  }
  return { status: "failed", text: "", error: `不支持的文件类型：${extension || "unknown"}` };
}

function safeParseArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function listDocuments(options = {}) {
  const includeContentText = options.includeContentText === true || DOCUMENT_LIST_DEFAULT_INCLUDE_CONTENT_TEXT;
  const contentTextLimit = Math.max(0, Math.min(Number(options.contentTextLimit || DOCUMENT_LIST_CONTENT_CHARS), DOCUMENT_LIST_CONTENT_CHARS));
  const result = db.exec(documentSelectSql({
    ...options,
    includeContentText,
    contentTextLimit,
  }));
  if (result.length === 0) return [];
  return result[0].values.map(rowToDocument);
}

function listDocumentMetas() {
  return listDocuments({ includeContentText: false });
}

function getDocumentById(id) {
  const result = db.exec(
    `SELECT id, title, fileName, filePath, extension, size, importedAt, updatedAt,
      fileModifiedAt, contentHash, contentText, summary, tagsJson, favorite,
      parseStatus, parseError, duplicateOf, indexVersion, sourceType, workspacePath, artifactType,
      LENGTH(contentText) AS contentLength
    FROM documents WHERE id = $id`,
    { $id: id },
  );
  return result[0]?.values?.[0] ? rowToDocument(result[0].values[0]) : null;
}

function getDocumentByPath(filePath) {
  const result = db.exec(
    `SELECT id, title, fileName, filePath, extension, size, importedAt, updatedAt,
      fileModifiedAt, contentHash, contentText, summary, tagsJson, favorite,
      parseStatus, parseError, duplicateOf, indexVersion, sourceType, workspacePath, artifactType,
      LENGTH(contentText) AS contentLength
    FROM documents WHERE filePath = $filePath`,
    { $filePath: filePath },
  );
  return result[0]?.values?.[0] ? rowToDocument(result[0].values[0]) : null;
}

function findDuplicate(contentHash, filePath) {
  if (!contentHash) return null;
  const result = db.exec(
    `SELECT id, filePath FROM documents
     WHERE contentHash = $contentHash AND filePath <> $filePath
     ORDER BY importedAt ASC LIMIT 1`,
    { $contentHash: contentHash, $filePath: filePath },
  );
  const row = result[0]?.values?.[0];
  return row ? { id: row[0], filePath: row[1] } : null;
}

function upsertDocument(doc) {
  db.run(
    `INSERT INTO documents (
      id, title, fileName, filePath, extension, size, importedAt, updatedAt,
      fileModifiedAt, contentHash, contentText, summary, tagsJson, favorite,
      parseStatus, parseError, duplicateOf, indexVersion, sourceType, workspacePath, artifactType
    ) VALUES (
      $id, $title, $fileName, $filePath, $extension, $size, $importedAt, $updatedAt,
      $fileModifiedAt, $contentHash, $contentText, $summary, $tagsJson, $favorite,
      $parseStatus, $parseError, $duplicateOf, $indexVersion, $sourceType, $workspacePath, $artifactType
    )
    ON CONFLICT(filePath) DO UPDATE SET
      title = $title,
      fileName = $fileName,
      extension = $extension,
      size = $size,
      updatedAt = $updatedAt,
      fileModifiedAt = $fileModifiedAt,
      contentHash = $contentHash,
      contentText = $contentText,
      summary = $summary,
      parseStatus = $parseStatus,
      parseError = $parseError,
      duplicateOf = $duplicateOf,
      indexVersion = $indexVersion,
      sourceType = $sourceType,
      workspacePath = $workspacePath,
      artifactType = $artifactType`,
    {
      $id: doc.id,
      $title: doc.title,
      $fileName: doc.fileName,
      $filePath: doc.filePath,
      $extension: doc.extension,
      $size: doc.size,
      $importedAt: doc.importedAt,
      $updatedAt: doc.updatedAt,
      $fileModifiedAt: doc.fileModifiedAt,
      $contentHash: doc.contentHash,
      $contentText: doc.contentText,
      $summary: doc.summary,
      $tagsJson: JSON.stringify(doc.tags || []),
      $favorite: doc.favorite ? 1 : 0,
      $parseStatus: doc.parseStatus,
      $parseError: doc.parseError,
      $duplicateOf: doc.duplicateOf,
      $indexVersion: doc.indexVersion || INDEX_VERSION,
      $sourceType: doc.sourceType || "imported",
      $workspacePath: doc.workspacePath || null,
      $artifactType: doc.artifactType || null,
    },
  );
}

function recordDocumentVersion(doc, changeSummary, createdBy = "import") {
  if (!doc?.id || !doc.contentHash) return;
  if (shouldSkipDocumentVersion(doc)) return;
  const existing = db.exec("SELECT MAX(versionNo) FROM document_versions WHERE documentId = $documentId", {
    $documentId: doc.id,
  });
  const maxVersion = existing[0]?.values?.[0]?.[0] || 0;
  db.run(
    `INSERT INTO document_versions (
      id, documentId, versionNo, filePath, contentHash, title, summary,
      contentText, createdAt, changeSummary, createdBy
    ) VALUES (
      $id, $documentId, $versionNo, $filePath, $contentHash, $title, $summary,
      $contentText, $createdAt, $changeSummary, $createdBy
    )`,
    {
      $id: crypto.randomUUID(),
      $documentId: doc.id,
      $versionNo: maxVersion + 1,
      $filePath: doc.filePath,
      $contentHash: doc.contentHash,
      $title: doc.title,
      $summary: doc.summary || "",
      $contentText: doc.contentText || "",
      $createdAt: new Date().toISOString(),
      $changeSummary: changeSummary || "导入前版本快照",
      $createdBy: createdBy || "import",
    },
  );
  db.run(
    `DELETE FROM document_versions
     WHERE documentId = $documentId
       AND id NOT IN (
         SELECT id FROM document_versions
         WHERE documentId = $documentId
         ORDER BY versionNo DESC
         LIMIT $limit
       )`,
    {
      $documentId: doc.id,
      $limit: MAX_DOCUMENT_VERSIONS_PER_DOCUMENT,
    },
  );
}

function inferArtifactType(filePath) {
  const lower = path.basename(filePath).toLowerCase();
  const full = filePath.toLowerCase();
  if (full.includes(`${path.sep}.codex-knowledge${path.sep}`)) return "context";
  if (lower === "readme.md") return "readme";
  if (lower.includes("prd") || lower.includes("需求")) return "prd";
  if (lower.includes("technical") || lower.includes("design") || lower.includes("architecture") || lower.includes("技术")) {
    return "technical_design";
  }
  if (lower.includes("test") || lower.includes("测试")) return "test_plan";
  if (lower.includes("release") || lower.includes("changelog") || lower.includes("发布")) return "release_notes";
  if (lower.includes("report") || lower.includes("evaluation") || lower.includes("评估") || lower.includes("报告")) return "report";
  if ([".md", ".markdown"].includes(path.extname(filePath).toLowerCase())) return "markdown";
  if ([".docx", ".pdf"].includes(path.extname(filePath).toLowerCase())) return "document";
  return "other";
}

function inferSourceType(filePath, workspacePath) {
  const full = filePath.toLowerCase();
  if (full.includes(`${path.sep}.codex-knowledge${path.sep}`)) return "codex_context";
  if (!workspacePath) return "imported";
  const relative = path.relative(workspacePath, filePath).toLowerCase();
  if (relative === "readme.md" || relative.startsWith(`docs${path.sep}`) || relative.startsWith(`doc${path.sep}`)) {
    return "codex_output";
  }
  return "workspace_file";
}

function hasSkippedScanSegment(filePath) {
  return String(filePath || "")
    .split(/[\\/]+/)
    .some((part) => SKIPPED_SCAN_DIRS.has(part.toLowerCase()));
}

function shouldSkipDocumentVersion(doc) {
  const filePath = String(doc?.filePath || "");
  if (!filePath) return true;
  if (GENERATED_CONTEXT_VERSION_RE.test(filePath)) return true;
  if (doc.sourceType === "codex_context") return true;
  if (isGeneratedKnowledgeArtifact(filePath)) return true;
  return false;
}

async function importOne(filePath, options = {}) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new Error("不是可导入文件");
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(extension)) throw new Error(`不支持的文件类型：${extension || "unknown"}`);

  const fileName = path.basename(filePath);
  const existing = getDocumentByPath(filePath);
  const fileBuffer = await fs.readFile(filePath);
  const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  if (existing?.contentHash && existing.contentHash !== contentHash) {
    recordDocumentVersion(existing, "同路径文件内容变化，保存旧版本快照", existing.sourceType === "codex_output" ? "codex" : "import");
  }
  const parsed = await parseFile(filePath);
  const now = new Date().toISOString();
  const duplicate = findDuplicate(contentHash, filePath);
  let parseStatus = parsed.status === "ok" && parsed.text ? "ok" : parsed.status;
  let parseError = parsed.error || null;
  let summary = makeSummary(parsed.text, parsed.error);

  if (duplicate) {
    parseStatus = parseStatus === "failed" ? "failed" : "partial";
    parseError = parseError || `与已导入文件重复：${duplicate.filePath}`;
    summary = `重复文件。${summary}`;
  }

  return {
    id: existing?.id || crypto.randomUUID(),
    title: existing?.title || fileName.replace(/\.[^.]+$/, "") || fileName,
    fileName,
    filePath,
    extension,
    size: stats.size,
    importedAt: existing?.importedAt || now,
    updatedAt: now,
    fileModifiedAt: stats.mtime.toISOString(),
    contentHash,
    contentText: parsed.text || "",
    summary,
    tags: existing?.tags || [],
    favorite: existing?.favorite || false,
    parseStatus,
    parseError,
    duplicateOf: duplicate?.id || null,
    indexVersion: INDEX_VERSION,
    sourceType: options.sourceType || existing?.sourceType || "imported",
    workspacePath: options.workspacePath || existing?.workspacePath || null,
    artifactType: options.artifactType || existing?.artifactType || inferArtifactType(filePath),
  };
}

async function importPaths(filePaths, options = {}) {
  await ensureDatabase();
  const imported = [];
  const errors = [];
  for (const filePath of filePaths) {
    try {
      const perFileOptions =
        typeof options.mapFile === "function" ? { ...options, ...options.mapFile(filePath) } : options;
      const doc = await importOne(filePath, perFileOptions);
      upsertDocument(doc);
      imported.push(doc);
    } catch (error) {
      errors.push({ filePath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  await saveDatabase();
  return { imported, documents: listDocuments(), errors };
}

async function scanDirectory(rootPath) {
  const found = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (hasSkippedScanSegment(fullPath)) continue;
        await walk(fullPath);
      } else if (entry.isFile() && supportedExtension(fullPath)) {
        found.push(fullPath);
      }
    }
  }
  await walk(rootPath);
  return found;
}

async function discoverProjectRoots(rootPath) {
  const roots = new Set();
  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    if (isLikelyProjectDir(entries.map((entry) => entry.name))) {
      roots.add(current);
    }
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (!entry.isDirectory() || hasSkippedScanSegment(nextPath)) continue;
      await walk(nextPath);
    }
  }
  await walk(rootPath);
  if (roots.size === 0) roots.add(rootPath);
  return Array.from(roots).sort((a, b) => b.length - a.length);
}

function nearestProjectRoot(filePath, projectRoots, fallbackRoot) {
  const resolved = path.resolve(filePath).toLowerCase();
  for (const projectRoot of projectRoots) {
    const root = path.resolve(projectRoot).toLowerCase();
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) return projectRoot;
  }
  return fallbackRoot;
}

function projectNameFromPath(projectPath) {
  return path.basename(projectPath) || projectPath;
}

function groupByArtifactType(docs) {
  const groups = new Map();
  for (const doc of docs) {
    const key = doc.artifactType || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  return groups;
}

function artifactTypeTitle(type) {
  const labels = {
    prd: "PRD",
    technical_design: "技术设计",
    test_plan: "测试计划",
    release_notes: "发布说明",
    report: "报告",
    readme: "README",
    context: "上下文包",
    markdown: "Markdown 文档",
    document: "文档",
    other: "其他",
  };
  return labels[type] || type;
}

function compactLine(line) {
  return cleanText(line).replace(/^[-*#>\s]+/, "").trim();
}

function extractHeadings(text, limit = 12) {
  return String(text || "")
    .split("\n")
    .map((line) => line.match(/^#{1,4}\s+(.+)/)?.[1])
    .filter(Boolean)
    .map(compactLine)
    .filter(Boolean)
    .slice(0, limit);
}

function extractBullets(text, keywords = [], limit = 12) {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
    .map(compactLine)
    .filter((line) => {
      if (normalizedKeywords.length === 0) return true;
      const lower = line.toLowerCase();
      return normalizedKeywords.some((keyword) => lower.includes(keyword));
    })
    .filter(Boolean)
    .slice(0, limit);
}

function extractSentences(text, keywords = [], limit = 8) {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  return cleanText(text)
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map(compactLine)
    .filter((line) => line.length >= 12)
    .filter((line) => {
      if (normalizedKeywords.length === 0) return true;
      const lower = line.toLowerCase();
      return normalizedKeywords.some((keyword) => lower.includes(keyword));
    })
    .slice(0, limit);
}

function collectKnowledgeItems(docs, artifactTypes, keywords, limit = 12) {
  const items = [];
  for (const doc of docs.filter((item) => artifactTypes.includes(item.artifactType || "other"))) {
    const bullets = extractBullets(doc.contentText, keywords, 6);
    const sentences = extractSentences(doc.contentText, keywords, 4);
    const headings = extractHeadings(doc.contentText, 6);
    for (const item of [...bullets, ...sentences, ...headings]) {
      if (!items.some((existing) => existing.text === item)) {
        items.push({ text: item, title: doc.title, filePath: doc.filePath });
      }
      if (items.length >= limit) return items;
    }
  }
  return items;
}

function appendKnowledgeItems(lines, title, items) {
  lines.push(`### ${title}`, "");
  if (items.length === 0) {
    lines.push("- 暂未从现有文档中提取到明确条目。", "");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item.text}`);
    lines.push(`  Source: ${item.title} | ${item.filePath}`);
  }
  lines.push("");
}

function heuristicCategoryForDocument(doc) {
  const text = [doc.title, doc.summary, doc.contentText].join("\n").toLowerCase();
  if (/(architecture|design|技术|架构|electron|react|database|sqlite|schema|api)/.test(text)) return "architecture";
  if (/(prd|product|需求|roadmap|scope|用户|feature|story)/.test(text)) return "product";
  if (/(test|qa|测试|验收|验证|smoke|build)/.test(text)) return "testing";
  if (/(deploy|release|ops|运维|监控|告警|安装|打包)/.test(text)) return "operations";
  if (/(process|workflow|步骤|流程|review|handoff)/.test(text)) return "process";
  if (/(data|json|table|schema|csv|导出|索引)/.test(text)) return "data";
  if (/(readme|doc|markdown|文档|说明)/.test(text)) return "docs";
  return "general";
}

function extractKnowledgeTags(doc, category) {
  return uniqCompact([
    category,
    doc.extension?.replace(/^./, ""),
    doc.artifactType,
    doc.sourceType,
    ...(doc.tags || []),
    ...extractHeadings(doc.contentText || "", 4),
  ], 8);
}

function hasCjkText(value) {
  return /[\u3400-\u9FFF]/.test(String(value || ""));
}

function fileBaseName(filePath) {
  const leaf = path.basename(String(filePath || ""));
  return leaf ? leaf.replace(/\.[^.]+$/, "") : "";
}

function buildReadableKnowledgeTitle(doc, category) {
  if (hasCjkText(doc.title)) return compactText(doc.title, 160);
  const label = categoryLabel(category) || "知识";
  const source = fileBaseName(doc.filePath) || doc.title || "未命名来源";
  return compactText(`${label}：${source}`, 160);
}

function buildHeuristicKnowledgeItem(doc) {
  const category = heuristicCategoryForDocument(doc);
  const headings = extractHeadings(doc.contentText || "", 5);
  const bullets = extractBullets(doc.contentText || "", [], 4);
  const sentences = extractSentences(doc.contentText || doc.summary || "", [], 3);
  const lines = [...bullets, ...sentences, ...headings].filter(Boolean);
  const body = lines.slice(0, 5).join("\n") || compactText(doc.summary || doc.contentText || doc.parseError || "", KNOWLEDGE_BODY_CHARS);
  return {
    id: stableId("knowledge", [doc.id, doc.contentHash || doc.updatedAt || doc.filePath]),
    projectPath: doc.workspacePath || null,
    documentId: doc.id,
    sourcePath: doc.filePath,
    title: buildReadableKnowledgeTitle(doc, category),
    summary: compactText(doc.summary || lines[0] || doc.parseError || doc.title, COMPACT_SUMMARY_CHARS),
    body,
    category,
    tags: extractKnowledgeTags(doc, category),
    sourceHash: doc.contentHash || null,
    provider: "local",
    model: "heuristic-v1",
    status: "fallback",
    errorMessage: null,
  };
}

function isGeneratedKnowledgeArtifact(filePath) {
  const normalized = path.normalize(filePath || "");
  if (normalized.includes(`${path.sep}.codex-knowledge${path.sep}`)) return true;
  if (normalized.includes(`${path.sep}codex-history-vault${path.sep}`)) return true;
  if (normalized.includes(`${path.sep}Zhixia${path.sep}Codex History${path.sep}_indexes${path.sep}`)) return true;
  const baseName = path.basename(filePath || "").toLowerCase();
  if (baseName === "project-knowledge.md") return true;
  if (baseName === "project-resume.md") return true;
  if (baseName === "retrieval-packet.md" || baseName === "retrieval-packet.json") return true;
  if (baseName === "project-index.md" || baseName === "project-index.json") return true;
  if (baseName === "project-chunks.jsonl") return true;
  if (baseName === "project-sources.json" || baseName === "sources.json") return true;
  if (baseName === "experience-cards.md") return true;
  if (baseName === "project-artifacts.md" || baseName === "project-artifacts.json") return true;
  if (baseName === "skill-candidates.md") return true;
  if (baseName === "tool-skill-inventory.md" || baseName === "tool-skill-inventory.json") return true;
  if (baseName === "knowledge-items.md" || baseName === "knowledge-items.json") return true;
  if (baseName === "codex-history-items.md" || baseName === "codex-history-items.json") return true;
  return false;
}

function buildAiKnowledgePrompt(doc) {
  const compactSource = compactText(doc.contentText || doc.summary || doc.parseError || "", KNOWLEDGE_PROMPT_CHARS);
  return [
    "请把下面的本地文档整理成低 token 可检索的 compact knowledge item。",
    "要求：",
    "1. 只输出 JSON 对象，不要额外解释。",
    "2. category 只能是 architecture/product/testing/operations/process/data/docs/general 之一。",
    "3. summary <= 220 字；body <= 600 字，禁止复制整篇文档。",
    "4. tags 最多 8 个短标签。",
    "5. 不要输出任何密钥、token、密码、session、聊天全文。",
    "6. 如正文主要是日志/聊天/噪音，只提炼核心结论。",
    "返回格式：{title,summary,body,category,tags}",
    "",
    "DocumentTitle: " + doc.title,
    "FilePath: " + doc.filePath,
    "Extension: " + doc.extension,
    "ExistingSummary: " + compactText(doc.summary || "", 240),
    "Content:",
    compactSource,
  ].join("\n");
}

function parseAiKnowledgeResponse(raw, doc, provider, model) {
  const parsed = safeJsonParseValue(raw, null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 返回不是有效 JSON");
  }
  const parsedTags = Array.isArray(parsed.tags) ? parsed.tags : extractKnowledgeTags(doc, heuristicCategoryForDocument(doc));
  return {
    id: stableId("knowledge", [doc.id, doc.contentHash || doc.updatedAt || doc.filePath]),
    projectPath: doc.workspacePath || null,
    documentId: doc.id,
    sourcePath: doc.filePath,
    title: compactText(parsed.title || doc.title, 160),
    summary: compactText(parsed.summary || doc.summary || doc.title, COMPACT_SUMMARY_CHARS),
    body: compactText(parsed.body || parsed.summary || doc.summary || "", KNOWLEDGE_BODY_CHARS),
    category: parsed.category || heuristicCategoryForDocument(doc),
    tags: uniqCompact(parsedTags, 8),
    sourceHash: doc.contentHash || null,
    provider,
    model,
    status: "ready",
    errorMessage: null,
  };
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_AI_PROVIDER_BASE_URL;
}

function openAiCompatibleChatCompletion(args) {
  const baseUrl = args.baseUrl;
  const apiKey = args.apiKey;
  const model = args.model;
  const messages = args.messages;
  return new Promise((resolve, reject) => {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const endpoint = new URL(
      normalizedBaseUrl.endsWith("/chat/completions")
        ? normalizedBaseUrl
        : `${normalizedBaseUrl}/chat/completions`,
    );
    const payload = JSON.stringify({
      model: model || DEFAULT_AI_PROVIDER_MODEL,
      response_format: { type: "json_object" },
      messages,
      max_tokens: 900,
      temperature: 0.2,
    });
    const transport = endpoint.protocol === "http:" ? http : https;
    const request = transport.request(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          authorization: "Bearer " + apiKey,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const parsed = safeJsonParseValue(raw, null);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const message = parsed?.error?.message || parsed?.message || ("HTTP " + response.statusCode);
            reject(new Error(message));
            return;
          }
          const content = parsed?.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error("AI 响应缺少 content"));
            return;
          }
          resolve(content);
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(20000, () => request.destroy(new Error("AI 请求超时")));
    request.write(payload);
    request.end();
  });
}

async function summarizeDocumentToKnowledgeItem(doc, providerSettings, mode) {
  const heuristic = buildHeuristicKnowledgeItem(doc);
  const apiKey = String(providerSettings.aiProviderApiKey || "").trim();
  const baseUrl = normalizeBaseUrl(providerSettings.aiProviderBaseUrl || DEFAULT_AI_PROVIDER_BASE_URL);
  const model = providerSettings.aiProviderModel || DEFAULT_AI_PROVIDER_MODEL;
  if (mode !== "ai" || !apiKey) {
    return heuristic;
  }
  try {
    const content = await openAiCompatibleChatCompletion({
      baseUrl,
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content:
            "你是本地知识库整理器。输出 compact JSON，总结文档，不要复制全文，不要输出密钥、token、password、session、chat transcript。",
        },
        {
          role: "user",
          content: buildAiKnowledgePrompt(doc),
        },
      ],
    });
    return parseAiKnowledgeResponse(content, doc, baseUrl, model);
  } catch (error) {
    return {
      ...heuristic,
      provider: baseUrl,
      model,
      status: "fallback",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function generateKnowledgeItems(options = {}) {
  await ensureDatabase();
  const mode = options.mode === "ai" ? "ai" : "heuristic";
  const projectPath = options.projectPath || null;
  let docs = listDocuments().filter((doc) => doc.parseStatus !== "failed" && (doc.contentText || doc.summary));
  if (projectPath) {
    docs = docs.filter((doc) => doc.workspacePath === projectPath);
  }
  docs = docs
    .filter((doc) => !isGeneratedKnowledgeArtifact(doc.filePath))
    .slice(0, MAX_KNOWLEDGE_ITEMS_PER_RUN);
  deleteKnowledgeItemsForScope(projectPath, projectPath ? [] : docs.map((doc) => doc.id));
  const settings = getSettings();
  const items = [];
  const errors = [];
  for (const doc of docs) {
    try {
      const item = await summarizeDocumentToKnowledgeItem(doc, settings, mode);
      items.push(upsertKnowledgeItem(item));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ filePath: doc.filePath, message });
      items.push(
        upsertKnowledgeItem({
          ...buildHeuristicKnowledgeItem(doc),
          status: "error",
          errorMessage: message,
        }),
      );
    }
  }
  if (projectPath) {
    await writeProjectKnowledgeFiles([projectPath]);
  } else {
    const touchedProjects = Array.from(new Set(items.map((item) => item.projectPath).filter(Boolean)));
    if (touchedProjects.length > 0) await writeProjectKnowledgeFiles(touchedProjects);
  }
  await saveDatabase();
  return {
    generated: items.length,
    mode,
    usedNetwork: mode === "ai" && Boolean(String(settings.aiProviderApiKey || "").trim()),
    items,
    errors,
    overview: getKnowledgeOverview(),
  };
}

async function testAiProviderConnection() {
  await ensureDatabase();
  const settings = getSettings();
  const apiKey = String(settings.aiProviderApiKey || "").trim();
  if (!apiKey) {
    return { ok: false, message: "未配置 API Key，当前仅可使用本地启发式整理。" };
  }
  const baseUrl = normalizeBaseUrl(settings.aiProviderBaseUrl || DEFAULT_AI_PROVIDER_BASE_URL);
  const model = settings.aiProviderModel || DEFAULT_AI_PROVIDER_MODEL;
  try {
    await openAiCompatibleChatCompletion({
      baseUrl,
      apiKey,
      model,
      messages: [
        { role: "system", content: "Return compact JSON only." },
        { role: "user", content: 'Return {"ok":true,"provider":"test"}.' },
      ],
    });
    return { ok: true, message: "连接成功：" + baseUrl + " / " + model };
  } catch (error) {
    return { ok: false, message: "连接失败：" + (error instanceof Error ? error.message : String(error)) };
  }
}

function isValidProjectStatus(value) {
  return ["active", "paused", "waiting_review", "waiting_user", "completed", "archived", "unknown"].includes(value);
}

function isValidProjectCompletion(value) {
  return ["idea", "prd", "design", "implementation", "testing", "packaging", "released", "maintenance", "unknown"].includes(value);
}

function cleanProjectSummaryCandidate(value, maxChars = 520) {
  let text = cleanText(sanitizeText(value || ""));
  if (!text) return "";
  if (/^\s*[\[{]/.test(text) && /["{[]|:\s*["\d]|,\s*"/.test(text.slice(0, 300))) return "";
  if (/<codex_delegation|<\/source_thread_id>|<source_thread_id>|CALLBACK|Callback event/i.test(text)) return "";
  if (/<!doctype|<html|<head|<body|<meta\s|<\/?[a-z][\s>]/i.test(text)) return "";
  if (/"test name"\s*:|"success"\s*:|"error"\s*:|HTTP\s+\d{3}|success['"]?\s*:\s*false/i.test(text)) return "";
  if (/C:\\|\\\\|\/node_modules\/|\/site-packages\/|\/\.venv\//i.test(text) && text.length > 120) return "";
  text = text
    .replace(/^重复文件。?\s*/i, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[`*_>#]+/g, " ")
    .replace(/\s[-*]\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (/^\s*[\[{]/.test(text)) return "";
  return compactText(text, maxChars);
}

function hasChineseText(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ""));
}

function isUsefulProjectSummaryCandidate(value) {
  const text = cleanProjectSummaryCandidate(value, 260);
  if (!text || text.length < 12) return false;
  if (/^(README|Documents|workflow|context|project-knowledge|package-release)$/i.test(text)) return false;
  if (/确认|待确认|source signature|metadata|fallback preview|local contract|artifact contract/i.test(text)) return false;
  if (/^\s*(版本|日期|状态|路径|workspace|task_id|source|provider)[:：]/i.test(text)) return false;
  return hasChineseText(text);
}

function projectSummaryDocumentScore(doc) {
  let score = 0;
  const filePath = String(doc.filePath || "");
  const lower = filePath.toLowerCase();
  const title = `${doc.title || ""} ${doc.fileName || ""}`;
  const typeScore = {
    prd: 90,
    readme: 82,
    technical_design: 76,
    report: 68,
    release_notes: 56,
    markdown: 45,
    document: 35,
    context: 12,
    other: 8,
  };
  score += typeScore[doc.artifactType || "other"] || 0;
  if (hasChineseText(title)) score += 16;
  if (hasChineseText(doc.summary) || hasChineseText(doc.contentText)) score += 12;
  if (doc.sourceType === "codex_context") score -= 18;
  if (doc.duplicateOf) score -= 20;
  if (/[\\/]__|\.json$|\.csv$|tmp_|trace|log|receipt|inventory|baseline|state[\\/]|workspace_baselines/i.test(lower)) score -= 36;
  if (isGeneratedKnowledgeArtifact(filePath)) score -= 80;
  return score;
}

function extractProjectSummarySentences(values, maxSentences = 2) {
  const result = [];
  for (const value of values) {
    const text = cleanProjectSummaryCandidate(value, 900);
    if (!hasChineseText(text)) continue;
    const sentences = text
      .split(/[。！？!?；;\n]/)
      .map((item) => cleanProjectSummaryCandidate(item, 220))
      .filter((item) => item.length >= 14 && isUsefulProjectSummaryCandidate(item));
    for (const sentence of sentences) {
      if (!result.some((item) => item.includes(sentence) || sentence.includes(item))) result.push(sentence);
      if (result.length >= maxSentences) return result;
    }
  }
  return result;
}

function readableProjectSummaryTitle(projectRecord, docs, knowledge) {
  const candidates = [
    ...knowledge.map((item) => item.title),
    ...docs.map((doc) => doc.title),
    ...docs.map((doc) => path.basename(doc.filePath || doc.fileName || "", path.extname(doc.filePath || doc.fileName || ""))),
    projectRecord.name,
  ]
    .map((item) => cleanProjectSummaryCandidate(item, 60))
    .filter(Boolean)
    .filter((item) => !/^(README|Documents|workflow|context|project-knowledge|package-release)$/i.test(item))
    .filter((item) => !/<|>|codex_delegation|source_thread_id|C:\\|\\\\/.test(item));
  const chinese = candidates.find((item) => hasChineseText(item) && item.length >= 3);
  return compactText(chinese || candidates[0] || projectRecord.name || "未命名项目", 42);
}

function buildProjectSummarySkillContext(projectPath) {
  const projectRecord = buildProjectRecords().find((record) => record.rootPath === projectPath);
  if (!projectRecord) {
    throw new Error("未找到项目记录，先扫描并整理项目。");
  }
  const docs = listDocuments()
    .filter((doc) => doc.workspacePath === projectPath && doc.parseStatus !== "failed" && !isGeneratedKnowledgeArtifact(doc.filePath))
    .sort((a, b) => projectSummaryDocumentScore(b) - projectSummaryDocumentScore(a) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 14);
  const knowledge = listKnowledgeItems(projectPath, { limit: 16 });
  const memory = listExperienceCards(projectPath, { includeGlobal: false, limit: 12 });
  const sourceRefs = [
    ...safeArray(projectRecord.sourceRefs),
    ...docs.slice(0, 8).map((doc) =>
      buildSourceRef({
        kind: "document",
        path: doc.filePath,
        title: doc.title,
        hash: doc.contentHash,
        updatedAt: doc.updatedAt,
      }),
    ),
    ...knowledge.slice(0, 8).map((item) =>
      buildSourceRef({
        kind: "knowledge_item",
        path: item.sourcePath,
        title: item.title,
        hash: item.sourceHash,
        updatedAt: item.updatedAt,
      }),
    ),
    ...memory.slice(0, 8).map((card) =>
      buildSourceRef({
        kind: "experience_card",
        path: card.sourcePath,
        title: card.title,
        hash: card.sourceHash,
        updatedAt: card.updatedAt,
      }),
    ),
  ].slice(0, 24);
  const inputHash = hashText(
    JSON.stringify({
      projectPath,
      projectRecordSourceSignature: projectRecord.governance?.projectRecordSourceSignature || buildProjectRecordSourceSignature(projectRecord),
      docs: docs.map((doc) => [doc.id, doc.contentHash, doc.updatedAt]),
      knowledge: knowledge.map((item) => [item.id, item.sourceHash, item.updatedAt]),
      memory: memory.map((card) => [card.id, card.sourceHash, card.updatedAt]),
    }),
  );
  return { projectRecord, docs, knowledge, memory, sourceRefs, inputHash };
}

function buildLocalProjectSummaryOutput(context) {
  const { projectRecord, docs, knowledge, memory } = context;
  const titleSource = readableProjectSummaryTitle(projectRecord, docs, knowledge);
  const summarySentences = extractProjectSummarySentences(
    [
      ...knowledge.flatMap((item) => [item.summary, item.body, item.title]),
      ...memory.flatMap((card) => [card.summary, card.body, card.title]),
      ...docs.flatMap((doc) => [doc.summary, doc.contentText, doc.title]),
      projectRecord.lastSummary,
    ],
    2,
  );
  const sourceLabels = docs
    .slice(0, 3)
    .map((doc) => doc.artifactType || path.basename(doc.filePath || doc.fileName || "资料"))
    .filter(Boolean);
  const fallbackTopic = sourceLabels.length ? `主要资料包括${sourceLabels.join("、")}。` : "当前资料还缺少清晰说明。";
  const summary = compactText(
    summarySentences.length
      ? `${titleSource}：${summarySentences.join("。")}。`
      : `${titleSource} 是知匣识别出的项目或内容集合，已整理 ${projectRecord.documentCount || docs.length} 条历史资料、${knowledge.length} 条知识和 ${memory.length} 条记忆。${fallbackTopic}`,
    180,
  );
  return {
    title: titleSource,
    summary,
    nextAction: compactText(projectRecord.nextAction || "打开项目详情，查看历史、知识和记忆后继续推进。", 160),
    blockers: safeArray(projectRecord.blockers).slice(0, 6),
    status: projectRecord.status || "active",
    completion: projectRecord.completion || "unknown",
    sourceHint: sourceLabels.join("、"),
  };
}

function buildProjectSummarySkillPrompt(context) {
  const { projectRecord, docs, knowledge, memory } = context;
  const lines = [
    "请为知匣项目卡片生成中文摘要。只输出 JSON 对象，不要额外解释。",
    "目标：让普通用户一眼知道这是什么项目、目前大概做到哪、下一步该看什么。",
    "要求：",
    "1. title 是中文项目名或更好懂的中文标题，<= 28 字；不要用 README、Documents、workflow、文件名、路径或标签当标题。",
    "2. summary 必须是内容总结，不是摘录原文。用 80-160 字说明：这是什么项目/内容库、主要解决什么问题、里面有哪些关键资料。",
    "3. 禁止输出 JSON、Markdown 标题、HTML、测试日志、路径、<codex_delegation>、source_thread_id、内部 enum 或原始任务片段。",
    "4. nextAction 是一句用户可理解的下一步。",
    "5. blockers 最多 4 条，没有就 []。",
    "6. status 只能是 active/paused/waiting_review/waiting_user/completed/archived/unknown。",
    "7. completion 只能是 idea/prd/design/implementation/testing/packaging/released/maintenance/unknown。",
    "8. 不要输出密钥、token、凭据、raw session 或全文聊天。",
    "返回格式：{title,summary,nextAction,blockers,status,completion}",
    "",
    `ProjectPath: ${projectRecord.rootPath}`,
    `CurrentName: ${projectRecord.name}`,
    `CurrentStatus: ${projectRecord.status}`,
    `CurrentCompletion: ${projectRecord.completion}`,
    `CurrentSummary: ${cleanProjectSummaryCandidate(projectRecord.lastSummary, 300)}`,
    "",
    "Documents:",
    ...docs.slice(0, 10).map((doc, index) =>
      [
        `#${index + 1} ${compactText(doc.title || doc.fileName, 120)}`,
        `type=${doc.artifactType || "unknown"} source=${doc.sourceType || "unknown"}`,
        `summary=${cleanProjectSummaryCandidate(doc.summary || doc.contentText || doc.parseError || "", 360)}`,
      ].join("\n"),
    ),
    "",
    "Knowledge:",
    ...knowledge.slice(0, 10).map((item, index) => `#${index + 1} ${cleanProjectSummaryCandidate(item.title, 100)}：${cleanProjectSummaryCandidate(item.summary || item.body, 300)}`),
    "",
    "Memory:",
    ...memory.slice(0, 8).map((card, index) => `#${index + 1} ${cleanProjectSummaryCandidate(card.title, 100)}：${cleanProjectSummaryCandidate(card.summary || card.body, 260)}`),
  ];
  return compactMarkdown(lines.join("\n"), ZHIXIA_SKILL_PROMPT_CHARS);
}

function parseProjectSummarySkillOutput(raw, context, provider, model) {
  const local = buildLocalProjectSummaryOutput(context);
  const parsed = safeJsonParseValue(raw, null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 返回不是有效项目摘要 JSON");
  }
  const status = isValidProjectStatus(parsed.status) ? parsed.status : local.status;
  const completion = isValidProjectCompletion(parsed.completion) ? parsed.completion : local.completion;
  const blockers = Array.isArray(parsed.blockers) ? parsed.blockers : local.blockers;
  const parsedTitle = cleanProjectSummaryCandidate(parsed.title, 42);
  const parsedSummary = cleanProjectSummaryCandidate(parsed.summary, 180);
  const parsedNextAction = cleanProjectSummaryCandidate(parsed.nextAction, 160);
  return {
    title: parsedTitle && !/^(README|Documents|workflow)$/i.test(parsedTitle) ? parsedTitle : local.title,
    summary: isUsefulProjectSummaryCandidate(parsedSummary) ? parsedSummary : local.summary,
    nextAction: parsedNextAction || local.nextAction,
    blockers: uniqCompact(blockers, 6),
    status,
    completion,
    provider,
    model,
  };
}

async function runProjectSummarySkill(options = {}) {
  const startedAt = Date.now();
  const projectPath = String(options.projectPath || "").trim();
  if (!projectPath) throw new Error("缺少 projectPath。");
  const skill = getZhixiaSkillDefinition(ZHIXIA_SKILL_PROJECT_SUMMARY_ID);
  if (!skill || !skill.enabled) throw new Error("项目中文摘要流程模块未启用。");
  const context = buildProjectSummarySkillContext(projectPath);
  const settings = getSettings();
  const apiKey = String(settings.aiProviderApiKey || "").trim();
  const baseUrl = normalizeBaseUrl(settings.aiProviderBaseUrl || DEFAULT_AI_PROVIDER_BASE_URL);
  const model = settings.aiProviderModel || DEFAULT_AI_PROVIDER_MODEL;
  const localOutput = buildLocalProjectSummaryOutput(context);
  let output = localOutput;
  let status = "success";
  let provider = "local";
  let usedNetwork = false;
  let errorMessage = null;
  if (options.mode === "ai" && apiKey) {
    try {
      const content = await openAiCompatibleChatCompletion({
        baseUrl,
        apiKey,
        model,
        messages: [
          {
            role: "system",
            content:
              "你是知匣本地知识库的项目摘要流程模块。只输出 compact JSON，中文、可读、保守，不要泄露密钥或复制全文。",
          },
          {
            role: "user",
            content: buildProjectSummarySkillPrompt(context),
          },
        ],
      });
      output = parseProjectSummarySkillOutput(content, context, baseUrl, model);
      provider = baseUrl;
      usedNetwork = true;
    } catch (error) {
      status = "fallback";
      provider = baseUrl;
      errorMessage = error instanceof Error ? error.message : String(error);
      output = { ...localOutput, provider: "local", model: "heuristic" };
    }
  } else if (options.mode === "ai" && !apiKey) {
    status = "fallback";
    errorMessage = "未配置 AI Provider API Key，已使用本地项目摘要流程。";
  }
  const projectRecordSourceSignature =
    context.projectRecord.governance?.projectRecordSourceSignature || buildProjectRecordSourceSignature(context.projectRecord);
  const completion = isValidProjectCompletion(output.completion) ? output.completion : context.projectRecord.completion || "unknown";
  const nextOverrides = {
    ...(settings.projectRecordOverrides || {}),
    [projectPath]: {
      ...(settings.projectRecordOverrides || {})[projectPath],
      displayName: output.title,
      status: isValidProjectStatus(output.status) ? output.status : context.projectRecord.status || "active",
      completion,
      completionPercent: completionPercentForStage(completion),
      lastSummary: output.summary,
      nextAction: output.nextAction,
      blockers: safeArray(output.blockers),
      generatedBySkillId: skill.id,
      generatedBySkillVersion: skill.version,
      generatedAt: new Date().toISOString(),
      projectRecordSourceSignature,
    },
  };
  updateSettings({ projectRecordOverrides: nextOverrides });
  const writtenRecords = [{ table: "settings.projectRecordOverrides", id: projectPath, action: "updated" }];
  const receipt = insertSkillRunReceipt({
    id: stableId("skill-run", [skill.id, projectPath, context.inputHash, Date.now().toString()]),
    skillId: skill.id,
    skillVersion: skill.version,
    triggerAction: "project.summary.generate",
    projectId: projectPath,
    status,
    provider,
    model: usedNetwork ? model : "heuristic",
    inputSourceRefs: context.sourceRefs,
    inputHash: context.inputHash,
    outputHash: hashText(JSON.stringify(output)),
    writtenRecords,
    errorMessage,
    durationMs: Date.now() - startedAt,
    createdAt: new Date().toISOString(),
  });
  await saveDatabase();
  return {
    ok: true,
    skill,
    receipt,
    output,
    usedNetwork,
    settings: sanitizedSettings(getSettings()),
  };
}

async function runZhixiaSkill(options = {}) {
  await ensureDatabase();
  const skillId = String(options.skillId || options.name || ZHIXIA_SKILL_PROJECT_SUMMARY_ID);
  if (skillId === ZHIXIA_SKILL_PROJECT_SUMMARY_ID || skillId === "project-summary-cn") {
    return runProjectSummarySkill(options);
  }
  throw new Error(`暂不支持运行该知匣流程模块：${skillId}`);
}

function exportableKnowledgeItem(item) {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    body: compactText(item.body, KNOWLEDGE_BODY_CHARS),
    category: item.category,
    tags: item.tags || [],
    sourcePath: item.sourcePath,
    sourceHash: item.sourceHash,
    provider: item.provider,
    model: item.model,
    status: item.status,
    updatedAt: item.updatedAt,
  };
}

function buildKnowledgeItemsMarkdown(projectPath, items) {
  const lines = [
    "# Zhixia Knowledge Items",
    "",
    "Project: " + projectNameFromPath(projectPath),
    "ProjectPath: " + projectPath,
    "GeneratedAt: " + new Date().toISOString(),
    "KnowledgeItemCount: " + items.length,
    "",
    "These are compact knowledge entries for low-token retrieval. They keep summaries, categories, tags and source pointers only.",
    "",
  ];
  for (const item of items.slice(0, MAX_KNOWLEDGE_ITEMS_PER_PROJECT_EXPORT)) {
    lines.push("## [" + categoryLabel(item.category) + "] " + item.title);
    lines.push("");
    lines.push("- Id: " + item.id);
    lines.push("- Category: " + item.category);
    lines.push("- Status: " + item.status);
    lines.push("- Provider: " + item.provider + " / " + item.model);
    lines.push("- Tags: " + ((item.tags || []).join(", ") || "none"));
    lines.push("- SourcePath: " + (item.sourcePath || "unknown"));
    lines.push("- SourceHash: " + (item.sourceHash || "unknown"));
    lines.push("");
    lines.push(item.summary || "No summary.");
    if (item.body && item.body !== item.summary) {
      lines.push("");
      lines.push(compactText(item.body, KNOWLEDGE_BODY_CHARS));
    }
    lines.push("");
  }
  return lines.join("\n");
}

function exportableProjectArtifact(artifact) {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    documentId: artifact.documentId,
    projectPath: artifact.projectPath,
    path: artifact.path,
    artifactType: artifact.artifactType,
    title: artifact.title,
    status: artifact.status,
    producedBy: artifact.producedBy,
    producerThreadId: artifact.producerThreadId,
    version: artifact.version,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    summary: compactText(artifact.summary, 360),
    freshness: artifact.freshness,
    requiresHumanConfirmation: artifact.requiresHumanConfirmation,
    reasons: artifact.reasons || [],
    sourceRefs: artifact.sourceRefs || [],
  };
}

function buildProjectArtifactsMarkdown(projectPath, artifacts) {
  const lines = [
    "# Zhixia Project Artifacts",
    "",
    `Project: ${projectNameFromPath(projectPath)}`,
    `ProjectPath: ${projectPath}`,
    `GeneratedAt: ${new Date().toISOString()}`,
    `ArtifactCount: ${artifacts.length}`,
    "",
    "These are metadata-only ProjectArtifact records for document governance and low-token retrieval. They do not replace source documents.",
    "Status notes: current means the latest known singleton document or evidence artifact; needs_review requires human/source confirmation; superseded means an older singleton document was replaced by a newer same-type artifact.",
    "",
  ];
  for (const artifact of artifacts.slice(0, 80)) {
    lines.push(`## [${artifact.artifactType}] ${artifact.title}`);
    lines.push("");
    lines.push(`- Id: ${artifact.id}`);
    lines.push(`- DocumentId: ${artifact.documentId || "unknown"}`);
    lines.push(`- Status: ${artifact.status}`);
    lines.push(`- Freshness: ${artifact.freshness}`);
    lines.push(`- ProducedBy: ${artifact.producedBy || "unknown"}`);
    lines.push(`- ProducerThreadId: ${artifact.producerThreadId || "unknown"}`);
    lines.push(`- SourcePath: ${artifact.path || "unknown"}`);
    lines.push(`- UpdatedAt: ${artifact.updatedAt || "unknown"}`);
    lines.push(`- RequiresHumanConfirmation: ${artifact.requiresHumanConfirmation ? "true" : "false"}`);
    lines.push(`- Reasons: ${(artifact.reasons || []).join(", ") || "none"}`);
    lines.push("");
    lines.push(artifact.summary || "No summary.");
    lines.push("");
  }
  return lines.join("\n");
}

function projectDocsForExport(projectPath, docs) {
  return docs
    .filter((doc) => doc.workspacePath === projectPath && !isGeneratedKnowledgeArtifact(doc.filePath))
    .sort((a, b) => {
      const order = ["readme", "prd", "technical_design", "test_plan", "release_notes", "report", "markdown", "document", "context", "other"];
      return order.indexOf(a.artifactType || "other") - order.indexOf(b.artifactType || "other") || a.title.localeCompare(b.title);
    });
}

function documentPointerForLayer(doc) {
  return {
    documentId: doc.id,
    title: compactText(doc.title || path.basename(doc.filePath || ""), 140),
    filePath: doc.filePath,
    sourceType: doc.sourceType || "workspace_file",
    artifactType: doc.artifactType || "other",
    contentHash: doc.contentHash || null,
    updatedAt: doc.updatedAt || null,
    summary: compactRetrievalPacketText(doc.summary || doc.contentText || doc.parseError || "", 260),
    contentLength: String(doc.contentText || "").length,
  };
}

function compactRetrievalPacketText(text, maxChars = 220) {
  const cleaned = String(text || "")
    .replace(/^\s*重复文件。?\s*/i, "")
    .replace(/^\s*重复文件。?\s*/gim, "")
    .replace(/重复文件。?\s*---\s*source:[\s\S]*/i, "来源重复，已保留 source pointer。")
    .replace(/---\s*source:[\s\S]*/i, "来源详情见 source pointer。")
    .replace(/^\s*(source|thread_id|source_bucket|source_path|sha256|model|provider):.*$/gim, "")
    .replace(/^\s*-?\s*(Id|Scope|Status|SourcePath|SourceHash|SourceRefs|SourceType|Freshness|RequiresHumanConfirmation|RawSessionPolicy|TokenEstimate|SourceDocumentUpdatedAt|Tags):.*$/gim, "")
    .replace(/\s*-?\s*(Id|Scope|Status|SourcePath|SourceHash|SourceRefs|SourceType|Freshness|RequiresHumanConfirmation|RawSessionPolicy|TokenEstimate|SourceDocumentUpdatedAt|Tags):\s*.*?(?=\s+-\s+[A-Za-z]+:|$)/gi, "")
    .replace(/"\s*(source_path|source_bucket|thread_id|sha256)"\s*:\s*"[^"]*"/gi, "\"sourcePointer\":\"retained\"")
    .replace(/\bsource_path:\s*\"[^\"]+\"/gi, "source pointer retained")
    .replace(/\bsource_path:\s*[^\s,}]+/gi, "source pointer retained")
    .replace(/\bimage_url\b[\s\S]{0,240}/gi, "image pointer retained")
    .replace(/\s{2,}/g, " ")
    .trim();
  return compactText(cleaned || text, maxChars);
}

function buildProjectLayeredKnowledge(projectPath, docs) {
  const projectDocs = projectDocsForExport(projectPath, docs);
  const projectName = projectNameFromPath(projectPath);
  const groups = groupByArtifactType(projectDocs);
  const knowledgeItems = listKnowledgeItems(projectPath, { limit: MAX_KNOWLEDGE_ITEMS_PER_PROJECT_EXPORT }).map(exportableKnowledgeItem);
  const memoryCards = listExperienceCards(projectPath, { includeGlobal: false, limit: 32 }).map(exportableExperienceCard);
  const artifacts = buildProjectArtifacts(docs, { projectPath, maxArtifacts: 80 }).map(exportableProjectArtifact);
  const generatedAt = new Date().toISOString();
  const documents = projectDocs.slice(0, MAX_PROJECT_INDEX_DOCUMENTS).map(documentPointerForLayer);
  const chunks = [];

  const pushChunk = (kind, title, text, source) => {
    const body = compactRetrievalPacketText(text, MAX_PROJECT_CHUNK_CHARS);
    if (!body) return;
    chunks.push({
      id: stableId("project-chunk", [projectPath, kind, title, source?.documentId || source?.id || source?.sourcePath || chunks.length]),
      projectPath,
      kind,
      title: compactText(title, 140),
      text: body,
      source,
      tokenEstimate: Math.max(20, Math.ceil(body.length / 4)),
    });
  };

  for (const doc of projectDocs.slice(0, MAX_PROJECT_RETRIEVAL_DOCUMENTS)) {
    pushChunk(
      `document:${doc.artifactType || "other"}`,
      doc.title || path.basename(doc.filePath || ""),
      doc.summary || extractHeadings(doc.contentText || "", 4).join("; ") || doc.contentText || doc.parseError || "",
      {
        documentId: doc.id,
        filePath: doc.filePath,
        contentHash: doc.contentHash || null,
        artifactType: doc.artifactType || "other",
        updatedAt: doc.updatedAt || null,
      },
    );
  }
  for (const item of knowledgeItems.slice(0, 48)) {
    pushChunk("knowledge", item.title, item.summary || item.body, {
      id: item.id,
      sourcePath: item.sourcePath,
      sourceHash: item.sourceHash || null,
      status: item.status,
    });
  }
  for (const card of memoryCards.slice(0, 36)) {
    pushChunk("memory", card.title, card.summary || card.body, {
      id: card.id,
      sourcePath: card.sourcePath,
      status: card.status,
    });
  }

  const retrievalItems = [
    ...knowledgeItems.slice(0, 18).map((item) => ({
      kind: "knowledge",
      title: item.title,
      summary: compactRetrievalPacketText(item.summary || item.body, 220),
      sourcePath: item.sourcePath || null,
      sourceHash: item.sourceHash || null,
      status: item.status,
    })),
    ...memoryCards.slice(0, 18).map((card) => ({
      kind: "memory",
      title: card.title,
      summary: compactRetrievalPacketText(card.summary || card.body, 220),
      sourcePath: card.sourcePath || null,
      sourceHash: card.sourceHash || null,
      status: card.status,
    })),
    ...artifacts.slice(0, 18).map((artifact) => ({
      kind: "artifact",
      title: artifact.title,
      summary: compactRetrievalPacketText(artifact.summary, 220),
      sourcePath: artifact.path || null,
      sourceHash: artifact.sourceRefs?.[0]?.hash || null,
      status: artifact.status,
    })),
  ];

  return {
    schemaVersion: "zhixia.layered_project_memory.v1",
    generatedAt,
    project: projectName,
    projectPath,
    counts: {
      documents: projectDocs.length,
      exportedDocuments: documents.length,
      knowledgeItems: knowledgeItems.length,
      memoryCards: memoryCards.length,
      artifacts: artifacts.length,
      chunks: Math.min(chunks.length, MAX_PROJECT_CHUNKS),
    },
    artifactGroups: Object.fromEntries(Array.from(groups.entries()).map(([type, items]) => [type, items.length])),
    retrievalPolicy: {
      defaultOrder: ["project-resume.md", "retrieval-packet.md", "project-index.md", "knowledge-items.md", "experience-cards.md", "project-artifacts.md"],
      rawHistoryPolicy: "raw sessions stay in Thread History Vault and are never default retrieval material",
      imagePolicy: "image/base64 bodies are not default project memory; keep OCR/summary/source pointer only",
      giantMarkdownPolicy: `project-knowledge.md is a compatibility summary capped near ${MAX_PROJECT_KNOWLEDGE_MARKDOWN_CHARS} chars`,
    },
    documents,
    retrievalItems,
    chunks: chunks.slice(0, MAX_PROJECT_CHUNKS),
  };
}

function buildProjectIndexMarkdown(layered) {
  const lines = [
    "# Zhixia Project Index",
    "",
    `Project: ${layered.project}`,
    `ProjectPath: ${layered.projectPath}`,
    `GeneratedAt: ${layered.generatedAt}`,
    `DocumentCount: ${layered.counts.documents}`,
    `KnowledgeItemCount: ${layered.counts.knowledgeItems}`,
    `MemoryCardCount: ${layered.counts.memoryCards}`,
    `ChunkCount: ${layered.counts.chunks}`,
    "",
    "## 分层说明",
    "",
    "- 本文件是项目目录索引，只放元数据、短摘要和来源指针。",
    "- Codex 默认应先读 `retrieval-packet.md/json`，再按需读 `project-index.json` 或 `project-chunks.jsonl`。",
    "- 原始线程历史保留在 Thread History Vault，不进入默认上下文。",
    "- 图片和截图默认只进入 OCR/摘要/来源指针，不把 base64 或大图正文塞进项目记忆。",
    "",
    "## 文档类型",
    "",
  ];
  for (const [type, count] of Object.entries(layered.artifactGroups)) {
    lines.push(`- ${artifactTypeTitle(type)}: ${count}`);
  }
  lines.push("", "## 代表文档", "");
  for (const doc of layered.documents.slice(0, 80)) {
    lines.push(`- ${artifactTypeTitle(doc.artifactType)} | ${doc.title}`);
    lines.push(`  Source: ${doc.filePath}`);
    if (doc.summary) lines.push(`  Summary: ${doc.summary}`);
  }
  return lines.join("\n");
}

function buildRetrievalPacketMarkdown(layered) {
  const lines = [
    "# Zhixia Retrieval Packet",
    "",
    `Project: ${layered.project}`,
    `ProjectPath: ${layered.projectPath}`,
    `GeneratedAt: ${layered.generatedAt}`,
    "",
    "## Codex 默认调取规则",
    "",
    "- 这是给 Codex/CEO Flow 默认读取的短包，不是完整历史。",
    "- 需要续接项目时先读 `project-resume.md`，再读本文件。",
    "- 需要来源、分片或更大范围检索时，再读 `project-index.json` / `project-chunks.jsonl`。",
    "- 不要默认读取 raw session、截图正文、巨型日志或完整旧对话。",
    "",
    "## 当前可用资料",
    "",
    `- 文档：${layered.counts.documents}`,
    `- 知识：${layered.counts.knowledgeItems}`,
    `- 记忆：${layered.counts.memoryCards}`,
    `- 产物索引：${layered.counts.artifacts}`,
    "",
    "## Top Items",
    "",
  ];
  for (const item of layered.retrievalItems.slice(0, 40)) {
    lines.push(`### [${item.kind}] ${compactText(item.title, 120)}`);
    lines.push("");
    lines.push(`- Status: ${item.status || "unknown"}`);
    lines.push(`- SourcePath: ${item.sourcePath || "unknown"}`);
    if (item.sourceHash) lines.push(`- SourceHash: ${item.sourceHash}`);
    lines.push("");
    lines.push(item.summary || "No summary.");
    lines.push("");
  }
  return lines.join("\n");
}

function buildProjectChunksJsonl(layered) {
  return layered.chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + (layered.chunks.length ? "\n" : "");
}

function capGeneratedMarkdown(markdown, label = "generated markdown") {
  if (markdown.length <= MAX_PROJECT_KNOWLEDGE_MARKDOWN_CHARS) return markdown;
  return `${markdown.slice(0, MAX_PROJECT_KNOWLEDGE_MARKDOWN_CHARS).trim()}\n\n## Truncated\n\n${label} was capped to keep Codex retrieval compact. Use project-index.json and project-chunks.jsonl for structured lookup.\n`;
}

function buildProjectKnowledge(projectPath, docs) {
  const projectDocs = docs
    .filter((doc) => doc.workspacePath === projectPath && !doc.filePath.endsWith(`${path.sep}project-knowledge.md`))
    .sort((a, b) => {
      const order = ["readme", "prd", "technical_design", "test_plan", "release_notes", "report", "markdown", "document", "context", "other"];
      return order.indexOf(a.artifactType || "other") - order.indexOf(b.artifactType || "other") || a.title.localeCompare(b.title);
    });
  const groups = groupByArtifactType(projectDocs);
  const lines = [
    "# 知匣项目知识库",
    "",
    `Project: ${projectNameFromPath(projectPath)}`,
    `ProjectPath: ${projectPath}`,
    `GeneratedAt: ${new Date().toISOString()}`,
    `DocumentCount: ${projectDocs.length}`,
    "",
    "## Codex 调取规则",
    "",
    "- 本文件是知匣从项目文档中自动提取的项目级知识库，Codex 处理该项目时应优先读取。",
    "- 如需快速续接停滞项目，先读取同目录 `project-resume.md`；它是启发式 Resume Packet，需结合来源复核。",
    "- 如需判断当前有效文档、需要复核文档和已替代文档，读取同目录 `project-artifacts.md`；它是 metadata-only 索引，不替代源文档。",
    "- 如需低 token 读取整理后的知识条目，读取同目录 `knowledge-items.md` 或通过 `read-project-knowledge.cjs --query <text>` 检索。",
    "- 如需了解项目可复用的 Codex Skill、脚本和 workflow，读取同目录 `tool-skill-inventory.md/json`；它是只读 candidate 资产目录，不代表可自动执行。",
    "- 如需引用来源，读取同目录 `project-sources.json`，并保留原始 `FilePath`。",
    "- 生成或修改 README、PRD、技术设计、测试计划、发布说明后，应让用户回到知匣重新扫描项目。",
    "",
    "## 项目地图",
    "",
  ];

  for (const [type, items] of groups) {
    lines.push(`- ${artifactTypeTitle(type)}: ${items.length}`);
  }

  lines.push("", "## 分层文件", "");
  lines.push("- `retrieval-packet.md/json`: 默认给 Codex/CEO Flow 的短上下文包。");
  lines.push("- `project-index.md/json`: 项目文档、知识、记忆、产物的结构化目录。");
  lines.push("- `project-chunks.jsonl`: 低 token 检索短块，一行一个 chunk。");
  lines.push("- `project-sources.json`: 完整来源清单。");
  lines.push("");
  lines.push("## 使用建议", "");
  lines.push("- Codex 处理该项目时，优先读取 `project-resume.md` 和 `retrieval-packet.md`。");
  lines.push("- 本文件只保留兼容入口；完整目录在 `project-index.md/json`，检索短块在 `project-chunks.jsonl`。");
  lines.push("- 原始线程历史、图片和大日志不进入默认上下文；需要时通过来源指针和 Thread History Vault 恢复。");
  return capGeneratedMarkdown(lines.join("\n"), "project-knowledge.md");

  lines.push("", "## 结构化知识提取", "");
  appendKnowledgeItems(
    lines,
    "项目目标和范围",
    collectKnowledgeItems(projectDocs, ["readme", "prd", "markdown"], ["目标", "范围", "定位", "feature", "scope", "goal", "需求"], 12),
  );
  appendKnowledgeItems(
    lines,
    "架构和实现约束",
    collectKnowledgeItems(projectDocs, ["technical_design", "readme", "markdown"], ["架构", "技术", "实现", "依赖", "限制", "database", "api", "electron", "react"], 12),
  );
  appendKnowledgeItems(
    lines,
    "测试和验收",
    collectKnowledgeItems(projectDocs, ["test_plan", "release_notes", "report"], ["测试", "验收", "验证", "build", "audit", "package", "manual"], 12),
  );
  appendKnowledgeItems(
    lines,
    "发布和已知限制",
    collectKnowledgeItems(projectDocs, ["release_notes", "report", "prd"], ["限制", "风险", "已知", "release", "version", "打包", "安装"], 12),
  );
  appendKnowledgeItems(
    lines,
    "可复用经验",
    collectKnowledgeItems(projectDocs, ["report", "markdown", "context"], ["经验", "建议", "注意", "decision", "lesson", "fix", "原因"], 12),
  );

  const projectKnowledgeItems = listKnowledgeItems(projectPath, { limit: 16 });
  lines.push("### AI/本地整理知识条目", "");
  if (projectKnowledgeItems.length === 0) {
    lines.push("- 暂无整理后的知识条目。", "");
  } else {
    for (const item of projectKnowledgeItems) {
      lines.push(`- [${categoryLabel(item.category)}] ${item.title}: ${compactText(item.summary, 180)}`);
      lines.push(`  Source: ${item.sourcePath || "unknown"} | ${item.sourceHash || "no-hash"}`);
    }
    lines.push("");
  }

  lines.push("## Canonical Documents", "");
  for (const doc of projectDocs.slice(0, 30)) {
    lines.push(`- ${artifactTypeTitle(doc.artifactType || "other")} | ${doc.title} | ${doc.filePath}`);
  }

  lines.push("", "## 文档索引和摘录", "");
  for (const doc of projectDocs) {
    lines.push(`### ${doc.title}`);
    lines.push("");
    lines.push(`- DocumentId: ${doc.id}`);
    lines.push(`- ArtifactType: ${doc.artifactType || "other"}`);
    lines.push(`- SourceType: ${doc.sourceType || "workspace_file"}`);
    lines.push(`- FilePath: ${doc.filePath}`);
    lines.push(`- UpdatedAt: ${doc.updatedAt}`);
    lines.push(`- Tags: ${(doc.tags || []).join(", ") || "none"}`);
    lines.push("");
    lines.push(doc.summary || "暂无摘要。");
    const excerpt = (doc.contentText || "").slice(0, 1200).trim();
    if (excerpt) {
      lines.push("");
      lines.push("```text");
      lines.push(excerpt);
      lines.push("```");
    }
    lines.push("");
  }

  lines.push("## 使用建议", "");
  lines.push("- Codex 处理该项目时，优先读取 `project-resume.md` 和 `retrieval-packet.md`。");
  lines.push("- 本文件只保留兼容入口；完整目录在 `project-index.md/json`，检索短块在 `project-chunks.jsonl`。");
  lines.push("- 原始线程历史、图片和大日志不进入默认上下文；需要时通过来源指针和 Thread History Vault 恢复。");
  return capGeneratedMarkdown(lines.join("\n"), "project-knowledge.md");
}

function uniqueExistingDirectories(paths) {
  const seen = new Set();
  const result = [];
  for (const item of paths.filter(Boolean)) {
    const normalized = path.resolve(item);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function discoverSkillCollectionRoots(basePath, options = {}) {
  const maxDepth = Math.max(1, Math.min(8, Math.floor(Number(options.maxDepth) || 6)));
  const maxRoots = Math.max(1, Math.min(60, Math.floor(Number(options.maxRoots) || 24)));
  const roots = [];
  const seen = new Set();

  const visit = (currentPath, depth) => {
    if (!currentPath || roots.length >= maxRoots || depth > maxDepth) return;
    let entries = [];
    try {
      entries = fsNative.readdirSync(currentPath, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    const hasSkillChildren = entries.some((entry) => {
      if (!entry.isDirectory()) return false;
      return fsNative.existsSync(path.join(currentPath, entry.name, "SKILL.md"));
    });
    if (hasSkillChildren) {
      const resolved = path.resolve(currentPath);
      const key = resolved.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        roots.push(resolved);
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const lowerName = entry.name.toLowerCase();
      if (SKIPPED_SCAN_DIRS.has(lowerName) || lowerName.includes("backup")) continue;
      visit(path.join(currentPath, entry.name), depth + 1);
      if (roots.length >= maxRoots) return;
    }
  };

  visit(basePath, 0);
  return roots;
}

function buildProjectToolSkillInventorySnapshot(projectPath) {
  const projectId = stableId("project", [projectPath]);
  const codexHome = codexHomePath();
  const codexSkillRoots = uniqueExistingDirectories([
    codexSkillsPath(),
    path.join(codexHome, "skills"),
    ...discoverSkillCollectionRoots(path.join(codexHome, "plugins", "cache")),
    ...discoverSkillCollectionRoots(path.join(codexHome, "vendor_imports", "skills")),
    ...discoverSkillCollectionRoots(path.join(codexHome, ".tmp", "plugins", "plugins"), { maxDepth: 4, maxRoots: 12 }),
  ]);
  const projectSkillRoots = uniqueExistingDirectories([
    path.join(projectPath, "codex-skills"),
  ]);
  const scriptRoots = uniqueExistingDirectories([
    path.join(projectPath, "scripts"),
    path.join(projectPath, "tools"),
    path.join(codexHome, "scripts"),
    path.join(codexHome, "tools"),
    path.join(codexHome, "bin"),
  ]);
  const workflowRoots = uniqueExistingDirectories([
    path.join(projectPath, "workflow"),
    path.join(projectPath, "workflows"),
  ]);
  return buildToolSkillInventory({
    workspacePath: projectPath,
    projectId,
    codexSkillRoots,
    projectSkillRoots,
    scriptRoots,
    workflowRoots,
  });
}

function buildStableToolSkillInventoryHash(snapshot) {
  const inventory = snapshot.inventory || {};
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const stablePayload = {
    contractVersion: inventory.contractVersion || "unknown",
    scope: inventory.scope || "project",
    workspacePath: inventory.workspacePath || null,
    projectId: inventory.projectId || null,
    sourceRoots: safeArray(inventory.sourceRoots)
      .map((root) => ({
        kind: root.kind || "unknown",
        path: root.path || null,
        exists: root.exists === true,
      }))
      .sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)),
    records: records
      .map((record) => ({
        id: record.id,
        name: record.name,
        kind: record.kind,
        sourcePath: record.sourcePath || null,
        installPath: record.installPath || null,
        sourceHash: record.sourceHash || null,
        status: record.status,
        installed: record.installed === true,
        requiresHumanConfirmation: record.requiresHumanConfirmation === true,
        discoveredBy: record.discoveredBy || null,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
  return hashText(JSON.stringify(stablePayload));
}

async function buildToolSkillInventoryFileState(projectPath) {
  const bundleDir = path.join(projectPath, ".codex-knowledge");
  const markdownPath = path.join(bundleDir, "tool-skill-inventory.md");
  const jsonPath = path.join(bundleDir, "tool-skill-inventory.json");
  const [markdownHash, jsonHash] = await Promise.all([
    hashFileIfExists(markdownPath),
    hashFileIfExists(jsonPath),
  ]);
  return {
    markdown: {
      path: markdownPath,
      exists: Boolean(markdownHash),
      hash: markdownHash || null,
    },
    json: {
      path: jsonPath,
      exists: Boolean(jsonHash),
      hash: jsonHash || null,
    },
  };
}

function resolveToolSkillInventorySnapshotHash(snapshot) {
  return buildStableToolSkillInventoryHash(snapshot);
}

function buildToolSkillRecordIdentity(projectPath, record) {
  return stableId("tool-skill-record", [
    projectPath,
    record.id,
    record.kind,
    record.sourcePath || "",
    record.installPath || "",
  ]);
}

function buildToolSkillRecordContextHash(projectPath, record) {
  return hashText(JSON.stringify({
    projectPath,
    id: record.id,
    kind: record.kind,
    name: record.name,
    sourcePath: record.sourcePath || null,
    installPath: record.installPath || null,
    sourceHash: record.sourceHash || null,
    requiresHumanConfirmation: record.requiresHumanConfirmation === true,
    safeCommands: safeArray(record.safeCommands).slice().sort(),
    forbiddenCommands: safeArray(record.forbiddenCommands).slice().sort(),
  }));
}

const TOOL_SKILL_GOVERNANCE_STATUSES = new Set(["confirmed", "rejected", "deprecated", "blocked"]);

function normalizeToolSkillGovernanceStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "clear") return "clear";
  if (TOOL_SKILL_GOVERNANCE_STATUSES.has(normalized)) return normalized;
  return "";
}

function listToolSkillRecordGovernance(projectPath) {
  const rows = db.exec(
    `SELECT projectPath, recordId, recordIdentity, recordContextHash, status, reviewedAt, reviewer,
            snapshotHash, sourcePath, sourceHash, kind, name, updatedAt
       FROM tool_skill_record_governance
      WHERE projectPath = $projectPath`,
    { $projectPath: projectPath },
  );
  const byRecordId = new Map();
  for (const row of rows[0]?.values || []) {
    byRecordId.set(row[1], {
      projectPath: row[0],
      recordId: row[1],
      recordIdentity: row[2],
      recordContextHash: row[3],
      status: row[4],
      reviewedAt: row[5],
      reviewer: row[6],
      snapshotHash: row[7],
      sourcePath: row[8],
      sourceHash: row[9],
      kind: row[10],
      name: row[11],
      updatedAt: row[12],
    });
  }
  return byRecordId;
}

function attachToolSkillRecordGovernance(projectPath, records) {
  const governanceByRecordId = listToolSkillRecordGovernance(projectPath);
  return records.map((record) => {
    const row = governanceByRecordId.get(record.id) || null;
    const recordIdentity = buildToolSkillRecordIdentity(projectPath, record);
    const recordContextHash = buildToolSkillRecordContextHash(projectPath, record);
    const reviewState = !row ? "unreviewed" : row.recordContextHash === recordContextHash ? "current" : "stale";
    return {
      ...record,
      governance: {
        status: row?.status || "candidate",
        reviewState,
        reviewedAt: row?.reviewedAt || null,
        reviewer: row?.reviewer || null,
        recordIdentity,
        recordContextHash,
        previousRecordContextHash: row?.recordContextHash || null,
        snapshotHash: row?.snapshotHash || null,
        sourcePath: row?.sourcePath || null,
        sourceHash: row?.sourceHash || null,
      },
    };
  });
}

function toolSkillInventoryConfirmationStatus(result, confirmation) {
  const hasInventory = result.records.length > 0 || result.files.markdown.exists || result.files.json.exists;
  if (!hasInventory) return "missing";
  if (confirmation?.status === "confirmed" && confirmation.snapshotHash === result.snapshotHash) {
    return "confirmed";
  }
  return confirmation?.confirmedAt ? "re_review_required" : "unconfirmed";
}

async function getToolSkillInventoryForProject(projectPathInput) {
  await ensureDatabase();
  const projectPath = path.resolve(String(projectPathInput || "").trim());
  if (!projectPathInput || !(await pathExists(projectPath))) {
    throw new Error("A valid projectPath is required for Tool/Skill inventory scan.");
  }
  const snapshot = buildProjectToolSkillInventorySnapshot(projectPath);
  const files = await buildToolSkillInventoryFileState(projectPath);
  const json = buildToolSkillInventoryJson(snapshot);
  const snapshotHash = resolveToolSkillInventorySnapshotHash(snapshot);
  const confirmation = getSettings().toolSkillInventoryConfirmations?.[projectPath] || null;
  const records = attachToolSkillRecordGovernance(projectPath, json.records);
  const result = {
    projectPath,
    snapshotHash,
    confirmationStatus: "unconfirmed",
    confirmation: confirmation || null,
    inventory: json.inventory,
    records,
    files,
    policy: {
      readOnlyCandidate: true,
      requiresHumanConfirmation: true,
      doesNotInstall: true,
      doesNotExecute: true,
      doesNotActivateCandidates: true,
    },
  };
  result.confirmationStatus = toolSkillInventoryConfirmationStatus(result, confirmation);
  return result;
}

async function confirmToolSkillInventorySnapshot(options = {}) {
  const result = await getToolSkillInventoryForProject(options.projectPath);
  const requestedHash = String(options.snapshotHash || "").trim();
  if (requestedHash && requestedHash !== result.snapshotHash) {
    throw new Error("Tool/Skill inventory snapshot hash changed before confirmation; refresh and review again.");
  }
  const settings = getSettings();
  const confirmations = {
    ...(settings.toolSkillInventoryConfirmations || {}),
    [result.projectPath]: {
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      snapshotHash: result.snapshotHash,
      inventoryId: result.inventory.id || null,
      recordCount: result.records.length,
      candidateCount: Number(result.inventory.candidateCount || 0),
      markdownPath: result.files.markdown.path,
      markdownHash: result.files.markdown.hash,
      jsonPath: result.files.json.path,
      jsonHash: result.files.json.hash,
    },
  };
  updateSettings({ toolSkillInventoryConfirmations: confirmations });
  await saveDatabase();
  return getToolSkillInventoryForProject(result.projectPath);
}

async function updateToolSkillRecordGovernance(options = {}) {
  const result = await getToolSkillInventoryForProject(options.projectPath);
  const requestedHash = String(options.snapshotHash || "").trim();
  if (requestedHash && requestedHash !== result.snapshotHash) {
    throw new Error("Tool/Skill inventory snapshot hash changed before per-record governance update; refresh and review again.");
  }
  const recordId = String(options.recordId || "").trim();
  const status = normalizeToolSkillGovernanceStatus(options.status);
  if (!recordId || !status) {
    throw new Error("A valid Tool/Skill recordId and governance status are required.");
  }
  const record = result.records.find((item) => item.id === recordId);
  if (!record) {
    throw new Error("Tool/Skill record is no longer present in the live inventory; refresh and review again.");
  }
  if (status === "clear") {
    db.run(
      "DELETE FROM tool_skill_record_governance WHERE projectPath = $projectPath AND recordId = $recordId",
      { $projectPath: result.projectPath, $recordId: recordId },
    );
    await saveDatabase();
    return getToolSkillInventoryForProject(result.projectPath);
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO tool_skill_record_governance
      (projectPath, recordId, recordIdentity, recordContextHash, status, reviewedAt, reviewer,
       snapshotHash, sourcePath, sourceHash, kind, name, updatedAt)
     VALUES
      ($projectPath, $recordId, $recordIdentity, $recordContextHash, $status, $reviewedAt, 'human',
       $snapshotHash, $sourcePath, $sourceHash, $kind, $name, $updatedAt)
     ON CONFLICT(projectPath, recordId) DO UPDATE SET
      recordIdentity = $recordIdentity,
      recordContextHash = $recordContextHash,
      status = $status,
      reviewedAt = $reviewedAt,
      reviewer = 'human',
      snapshotHash = $snapshotHash,
      sourcePath = $sourcePath,
      sourceHash = $sourceHash,
      kind = $kind,
      name = $name,
      updatedAt = $updatedAt`,
    {
      $projectPath: result.projectPath,
      $recordId: record.id,
      $recordIdentity: buildToolSkillRecordIdentity(result.projectPath, record),
      $recordContextHash: buildToolSkillRecordContextHash(result.projectPath, record),
      $status: status,
      $reviewedAt: now,
      $snapshotHash: result.snapshotHash,
      $sourcePath: record.sourcePath || record.installPath || null,
      $sourceHash: record.sourceHash || null,
      $kind: record.kind || null,
      $name: record.name || null,
      $updatedAt: now,
    },
  );
  await saveDatabase();
  return getToolSkillInventoryForProject(result.projectPath);
}

function listToolSkillRecordsForRetrieval(projectPathInput, options = {}) {
  const projectPath = path.resolve(String(projectPathInput || "").trim());
  if (!projectPathInput || !fsNative.existsSync(projectPath)) return [];
  const snapshot = buildProjectToolSkillInventorySnapshot(projectPath);
  const json = buildToolSkillInventoryJson(snapshot);
  const snapshotHash = resolveToolSkillInventorySnapshotHash(snapshot);
  const records = attachToolSkillRecordGovernance(projectPath, json.records);
  const limit = Math.max(1, Math.min(Number(options.limit || 80), 120));
  return records.slice(0, limit).map((record) => ({
    ...record,
    projectPath,
    snapshotHash,
    inventoryStatus: json.inventory.status || "ready",
    inventoryCandidateCount: Number(json.inventory.candidateCount || 0),
    inventoryRecordCount: records.length,
  }));
}

function buildToolSkillInventoryCacheState(projectPathInput) {
  const projectPath = path.resolve(String(projectPathInput || "").trim());
  if (!projectPathInput || !fsNative.existsSync(projectPath)) return [0, "", ""];
  const snapshot = buildProjectToolSkillInventorySnapshot(projectPath);
  const snapshotHash = resolveToolSkillInventorySnapshotHash(snapshot);
  const governanceState =
    db.exec("SELECT COUNT(*), MAX(updatedAt) FROM tool_skill_record_governance WHERE projectPath = $projectPath", {
      $projectPath: projectPath,
    })[0]?.values?.[0] || [0, ""];
  return [snapshot.records.length, snapshotHash, governanceState[0] || 0, governanceState[1] || ""];
}

function exportableExperienceCard(card) {
  return {
    id: card.id,
    scope: card.scope,
    sourceType: card.sourceType,
    title: card.title,
    summary: card.summary,
    body: compactText(card.body, 520),
    tags: card.tags || [],
    sourcePath: card.sourcePath,
    sourceHash: card.sourceHash,
    contractVersion: card.contractVersion || null,
    freshness: card.freshness || null,
    requiresHumanConfirmation: card.requiresHumanConfirmation === true,
    reviewReason: card.reviewReason || null,
    rawSessionPolicy: card.rawSessionPolicy || null,
    sourceRefs: Array.isArray(card.sourceRefs) ? card.sourceRefs : [],
    tokenEstimate: Number(card.tokenEstimate || 0),
    sourceDocumentUpdatedAt: card.sourceDocumentUpdatedAt || null,
    status: card.status,
    updatedAt: card.updatedAt,
  };
}

function buildExperienceCardsMarkdown(projectPath, cards) {
  const lines = [
    "# Zhixia Experience Cards",
    "",
    `Project: ${projectNameFromPath(projectPath)}`,
    `ProjectPath: ${projectPath}`,
    `GeneratedAt: ${new Date().toISOString()}`,
    `CardCount: ${cards.length}`,
    "",
    "These cards are compact local memory for Codex. Read summaries and source pointers; do not assume full source files were embedded.",
    "",
  ];
  for (const card of cards.slice(0, 40)) {
    lines.push(`## ${card.title}`);
    lines.push("");
    lines.push(`- Id: ${card.id}`);
    lines.push(`- Scope: ${card.scope}`);
    lines.push(`- SourceType: ${card.sourceType}`);
    lines.push(`- Status: ${card.status}`);
    if (card.freshness) lines.push(`- Freshness: ${card.freshness}`);
    lines.push(`- RequiresHumanConfirmation: ${card.requiresHumanConfirmation ? "true" : "false"}`);
    if (card.rawSessionPolicy) lines.push(`- RawSessionPolicy: ${card.rawSessionPolicy}`);
    if (card.tokenEstimate) lines.push(`- TokenEstimate: ${card.tokenEstimate}`);
    if (card.sourceDocumentUpdatedAt) lines.push(`- SourceDocumentUpdatedAt: ${card.sourceDocumentUpdatedAt}`);
    lines.push(`- Tags: ${(card.tags || []).join(", ") || "none"}`);
    lines.push(`- SourcePath: ${card.sourcePath || "unknown"}`);
    lines.push(`- SourceHash: ${card.sourceHash || "unknown"}`);
    if (Array.isArray(card.sourceRefs) && card.sourceRefs.length > 0) {
      lines.push(`- SourceRefs: ${card.sourceRefs.map((ref) => ref.path || ref.title || ref.kind || "source").join(" | ")}`);
    }
    lines.push("");
    lines.push(card.summary || "No summary.");
    if (card.body && card.body !== card.summary) {
      lines.push("");
      lines.push(compactText(card.body, 520));
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildSkillCandidatesMarkdown(projectPath, candidates) {
  const lines = [
    "# Zhixia Skill Candidates",
    "",
    `Project: ${projectNameFromPath(projectPath)}`,
    `ProjectPath: ${projectPath}`,
    `GeneratedAt: ${new Date().toISOString()}`,
    `CandidateCount: ${candidates.length}`,
    "",
    "These are draft candidates only. Zhixia never installs or enables them automatically.",
    "",
  ];
  for (const candidate of candidates.slice(0, 20)) {
    lines.push(`## ${candidate.title}`);
    lines.push("");
    lines.push(`- Id: ${candidate.id}`);
    lines.push(`- Scope: ${candidate.scope}`);
    lines.push(`- Status: ${candidate.status}`);
    lines.push(`- Triggers: ${(candidate.triggerPatterns || []).join(", ") || "none"}`);
    lines.push(`- EvidenceCards: ${(candidate.evidence?.cardIds || []).slice(0, 12).join(", ") || "none"}`);
    lines.push("");
    lines.push("```markdown");
    lines.push(compactMarkdown(candidate.draftSkillMarkdown, 1600));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

function slugify(value) {
  return String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
}

function buildDraftSkillMarkdown(projectPath, cards) {
  const projectName = projectNameFromPath(projectPath);
  const tags = uniqCompact(cards.flatMap((card) => card.tags || []), 8);
  const topCards = cards.slice(0, 8);
  return [
    "---",
    `name: zhixia-${slugify(projectName)}-memory-candidate`,
    `description: Draft project skill candidate generated by Zhixia from compact experience cards for ${projectName}. Install only after human review.`,
    "---",
    "",
    `# ${projectName} Memory Candidate`,
    "",
    "Use only after the user approves and installs this candidate. Until then, treat this file as a draft.",
    "",
    "## Triggers",
    "",
    ...tags.map((tag) => `- ${tag}`),
    "",
    "## Retrieved Experience",
    "",
    ...topCards.flatMap((card) => [
      `### ${card.title}`,
      "",
      `- SourceType: ${card.sourceType}`,
      `- SourcePath: ${card.sourcePath || "unknown"}`,
      `- SourceHash: ${card.sourceHash || "unknown"}`,
      "",
      card.summary || "No summary.",
      "",
    ]),
    "## Safety",
    "",
    "- This candidate is not installed automatically.",
    "- Prefer source pointers over copying full logs or private transcripts.",
  ].join("\n");
}

function syncSkillCandidatesForProjects(projectPaths) {
  const synced = [];
  for (const projectPath of projectPaths.filter(Boolean)) {
    const cards = listExperienceCards(projectPath, { includeGlobal: false, limit: 30 }).filter(
      (card) => card.status !== "archived",
    );
    if (cards.length === 0) continue;
    const projectName = projectNameFromPath(projectPath);
    const tags = uniqCompact(cards.flatMap((card) => card.tags || []), 8);
    const id = stableId("skill-candidate", ["project", projectPath]);
    const triggerPatterns = uniqCompact([projectName, ...tags.map((tag) => `${projectName} ${tag}`)], 12);
    const candidate = {
      id,
      projectPath,
      scope: "project",
      title: `${projectName} project memory skill`,
      triggerPatterns,
      draftSkillMarkdown: buildDraftSkillMarkdown(projectPath, cards),
      evidence: {
        cardIds: cards.map((card) => card.id).slice(0, 20),
        sourcePaths: uniqCompact(cards.map((card) => card.sourcePath).filter(Boolean), 20),
        generatedBy: "zhixia-local-doc-knowledge",
      },
      status: "draft",
    };
    upsertSkillCandidate(candidate);
    synced.push(candidate.id);
  }
  return synced;
}

async function writeProjectMemoryFiles(projectPaths) {
  const written = [];
  const allDocs = listDocuments();
  for (const projectPath of projectPaths.filter(Boolean)) {
    if (!(await pathExists(projectPath))) continue;
    const bundleDir = path.join(projectPath, ".codex-knowledge");
    await fs.mkdir(bundleDir, { recursive: true });

    for (const card of buildProjectMemoryBackfillCards(allDocs, { projectPath, maxCards: 30 })) {
      upsertExperienceCard(card);
    }

    const projectCards = listExperienceCards(projectPath, { includeGlobal: false, limit: 45 });
    const globalCards = listExperienceCards(null, { limit: 15 }).filter((card) => !card.projectPath);
    const cards = [...projectCards, ...globalCards].map(exportableExperienceCard);
    const candidates = listSkillCandidates(projectPath, { limit: 30 });
    const knowledgeItems = listKnowledgeItems(projectPath, { limit: MAX_KNOWLEDGE_ITEMS_PER_PROJECT_EXPORT }).map(exportableKnowledgeItem);
    const projectArtifacts = buildProjectArtifacts(allDocs, { projectPath, maxArtifacts: 120 }).map(exportableProjectArtifact);
    const experienceJsonPath = path.join(bundleDir, "experience-cards.json");
    const experienceMarkdownPath = path.join(bundleDir, "experience-cards.md");
    const knowledgeJsonPath = path.join(bundleDir, "knowledge-items.json");
    const knowledgeMarkdownPath = path.join(bundleDir, "knowledge-items.md");
    const artifactsJsonPath = path.join(bundleDir, "project-artifacts.json");
    const artifactsMarkdownPath = path.join(bundleDir, "project-artifacts.md");
    const skillCandidatesPath = path.join(bundleDir, "skill-candidates.md");
    const toolSkillInventoryJsonPath = path.join(bundleDir, "tool-skill-inventory.json");
    const toolSkillInventoryMarkdownPath = path.join(bundleDir, "tool-skill-inventory.md");
    const toolSkillInventorySnapshot = buildProjectToolSkillInventorySnapshot(projectPath);

    await fs.writeFile(
      experienceJsonPath,
      JSON.stringify(
        {
          project: projectNameFromPath(projectPath),
          projectPath,
          generatedAt: new Date().toISOString(),
          cards,
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(experienceMarkdownPath, buildExperienceCardsMarkdown(projectPath, cards), "utf8");
    await fs.writeFile(
      knowledgeJsonPath,
      JSON.stringify(
        {
          project: projectNameFromPath(projectPath),
          projectPath,
          generatedAt: new Date().toISOString(),
          items: knowledgeItems,
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(knowledgeMarkdownPath, buildKnowledgeItemsMarkdown(projectPath, knowledgeItems), "utf8");
    await fs.writeFile(
      artifactsJsonPath,
      JSON.stringify(
        {
          project: projectNameFromPath(projectPath),
          projectPath,
          generatedAt: new Date().toISOString(),
          artifacts: projectArtifacts,
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(artifactsMarkdownPath, buildProjectArtifactsMarkdown(projectPath, projectArtifacts), "utf8");
    await fs.writeFile(skillCandidatesPath, buildSkillCandidatesMarkdown(projectPath, candidates), "utf8");
    await fs.writeFile(
      toolSkillInventoryJsonPath,
      JSON.stringify(buildToolSkillInventoryJson(toolSkillInventorySnapshot), null, 2),
      "utf8",
    );
    await fs.writeFile(
      toolSkillInventoryMarkdownPath,
      buildToolSkillInventoryMarkdown(toolSkillInventorySnapshot),
      "utf8",
    );
    written.push(
      experienceJsonPath,
      experienceMarkdownPath,
      knowledgeJsonPath,
      knowledgeMarkdownPath,
      artifactsJsonPath,
      artifactsMarkdownPath,
      skillCandidatesPath,
      toolSkillInventoryJsonPath,
      toolSkillInventoryMarkdownPath,
    );
  }
  return written;
}

async function writeProjectKnowledgeFiles(projectPaths) {
  const written = [];
  const allDocs = listDocuments();
  syncSkillCandidatesForProjects(projectPaths);
  for (const projectPath of projectPaths) {
    const projectDocs = allDocs.filter((doc) => doc.workspacePath === projectPath);
    if (projectDocs.length === 0) continue;
    const bundleDir = path.join(projectPath, ".codex-knowledge");
    await fs.mkdir(bundleDir, { recursive: true });
    const knowledgePath = path.join(bundleDir, "project-knowledge.md");
    const resumePath = path.join(bundleDir, "project-resume.md");
    const sourcesPath = path.join(bundleDir, "project-sources.json");
    const retrievalPacketMarkdownPath = path.join(bundleDir, "retrieval-packet.md");
    const retrievalPacketJsonPath = path.join(bundleDir, "retrieval-packet.json");
    const projectIndexMarkdownPath = path.join(bundleDir, "project-index.md");
    const projectIndexJsonPath = path.join(bundleDir, "project-index.json");
    const projectChunksJsonlPath = path.join(bundleDir, "project-chunks.jsonl");
    const layered = buildProjectLayeredKnowledge(projectPath, allDocs);
    const projectRecord = buildProjectRecords().find((record) => record.rootPath === projectPath);
    await fs.writeFile(knowledgePath, buildProjectKnowledge(projectPath, allDocs), "utf8");
    await fs.writeFile(retrievalPacketMarkdownPath, buildRetrievalPacketMarkdown(layered), "utf8");
    await fs.writeFile(
      retrievalPacketJsonPath,
      JSON.stringify(
        {
          schemaVersion: layered.schemaVersion,
          generatedAt: layered.generatedAt,
          project: layered.project,
          projectPath: layered.projectPath,
          counts: layered.counts,
          retrievalPolicy: layered.retrievalPolicy,
          items: layered.retrievalItems,
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(projectIndexMarkdownPath, buildProjectIndexMarkdown(layered), "utf8");
    await fs.writeFile(
      projectIndexJsonPath,
      JSON.stringify(
        {
          schemaVersion: layered.schemaVersion,
          generatedAt: layered.generatedAt,
          project: layered.project,
          projectPath: layered.projectPath,
          counts: layered.counts,
          artifactGroups: layered.artifactGroups,
          retrievalPolicy: layered.retrievalPolicy,
          documents: layered.documents,
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(projectChunksJsonlPath, buildProjectChunksJsonl(layered), "utf8");
    if (projectRecord) {
      await fs.writeFile(resumePath, buildProjectResumePacket(projectRecord).markdown, "utf8");
    }
    await fs.writeFile(
      sourcesPath,
      JSON.stringify(
        {
          project: projectNameFromPath(projectPath),
          projectPath,
          generatedAt: new Date().toISOString(),
          sources: projectDocs.map((doc) => ({
            documentId: doc.id,
            title: doc.title,
            filePath: doc.filePath,
            sourceType: doc.sourceType,
            artifactType: doc.artifactType,
            contentHash: doc.contentHash,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    written.push(knowledgePath, retrievalPacketMarkdownPath);
    if (projectRecord) written.push(resumePath);
  }
  written.push(...(await writeProjectMemoryFiles(projectPaths)));
  return written;
}

async function scanCodexWorkspacePath(workspacePath) {
  const files = await scanDirectory(workspacePath);
  const projectRoots = await discoverProjectRoots(workspacePath);
  const imported = await importPaths(files, {
    workspacePath,
    mapFile: (filePath) => ({
      sourceType: inferSourceType(filePath, nearestProjectRoot(filePath, projectRoots, workspacePath)),
      workspacePath: nearestProjectRoot(filePath, projectRoots, workspacePath),
      artifactType: inferArtifactType(filePath),
    }),
  });
  const touchedProjects = Array.from(new Set(imported.imported.map((doc) => doc.workspacePath).filter(Boolean)));
  const knowledgeFiles = await writeProjectKnowledgeFiles(touchedProjects);
  const knowledgeImport =
    knowledgeFiles.length > 0
      ? await importPaths(knowledgeFiles, {
          mapFile: (filePath) => {
            const projectPath = nearestProjectRoot(filePath, touchedProjects, workspacePath);
            return {
              sourceType: "codex_context",
              workspacePath: projectPath,
              artifactType: "context",
            };
          },
        })
      : { imported: [], documents: imported.documents, errors: [] };
  const knowledgeGeneration = { generated: 0, errors: [] };
  for (const projectPath of touchedProjects) {
    const result = await generateKnowledgeItems({ mode: "heuristic", projectPath });
    knowledgeGeneration.generated += result.generated;
    knowledgeGeneration.errors.push(...result.errors);
  }
  const generatedToolSkillRecords = touchedProjects.reduce((total, projectPath) => {
    try {
      return total + buildToolSkillInventoryJson(buildProjectToolSkillInventorySnapshot(projectPath)).records.length;
    } catch {
      return total;
    }
  }, 0);

  return {
    imported: [...imported.imported, ...knowledgeImport.imported],
    documents: knowledgeImport.documents,
    errors: [...imported.errors, ...knowledgeImport.errors],
    scanned: files.length,
    workspacePath,
    projects: touchedProjects,
    knowledgeFiles,
    generatedKnowledge: knowledgeGeneration.generated,
    knowledgeErrors: knowledgeGeneration.errors,
    generatedToolSkillRecords,
  };
}

async function readTextIfExists(filePath) {
  if (!(await pathExists(filePath))) return null;
  return fs.readFile(filePath, "utf8");
}

async function readJsonIfExists(filePath) {
  const raw = await readTextIfExists(filePath);
  if (!raw) return null;
  return JSON.parse(raw);
}

async function recentFiles(dirPath, predicate, limit) {
  if (!(await pathExists(dirPath))) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !predicate(entry.name)) continue;
    const filePath = path.join(dirPath, entry.name);
    const stat = await fs.stat(filePath);
    files.push({ filePath, mtime: stat.mtime.getTime() });
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((item) => item.filePath);
}

function completionStatusToCardStatus(status, reviewDecision) {
  if (["done", "synced", "approved"].includes(status) || ["approved", "synced"].includes(reviewDecision)) return "accepted";
  return "candidate";
}

function cardFromCompletionPayload(payload, sourcePath, sourceHash) {
  const completionId = payload.completion_id || payload.completionId || payload.id || "";
  const runId = payload.run_id || payload.runId || "";
  const reviewDecision = payload.review?.decision || payload.final_review_status || "";
  const finalStatus = payload.final_task_status || payload.final_run_status || payload.status || "";
  const title = payload.title || payload.task?.title || runId || path.basename(sourcePath);
  const summary = payload.summary || payload.review?.decision_summary || payload.review?.summary || finalStatus || title;
  const requiredChanges = safeArray(payload.review?.required_changes).slice(0, 5);
  const residualRisks = safeArray(payload.review?.residual_risks).slice(0, 5);
  const tests = payload.tests || {};
  const body = [
    `FinalStatus: ${finalStatus || "unknown"}`,
    `Review: ${reviewDecision || "unknown"}`,
    tests.command ? `Tests: ${tests.command} [${tests.status || tests.exit_code || "recorded"}]` : "",
    payload.bug_memory?.note ? `BugMemory: ${payload.bug_memory.note}` : "",
    requiredChanges.length ? `RequiredChanges: ${requiredChanges.join(" | ")}` : "",
    residualRisks.length ? `ResidualRisks: ${residualRisks.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: stableId("experience", ["autoflow_completion", completionId || runId || sourcePath]),
    projectPath: payload.workspace || payload.task?.workspace || null,
    scope: "autoflow",
    sourceType: "autoflow_completion",
    title,
    summary,
    body,
    tags: uniqCompact(["autoflow", "completion", finalStatus, reviewDecision, tests.status], 10),
    sourcePath,
    sourceHash,
    status: completionStatusToCardStatus(finalStatus, reviewDecision),
    createdAt: payload.completed_at || payload.completedAt || payload.created_at || null,
  };
}

function cardFromLedgerEntry(entry, ledgerPath) {
  return cardFromCompletionPayload(
    entry,
    entry.json_path || entry.markdown_path || ledgerPath,
    hashText(JSON.stringify(entry)),
  );
}

function cardFromCompletionMarkdown(markdown, sourcePath) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] || path.basename(sourcePath);
  const summary =
    markdown.match(/##\s+Summary\s+([\s\S]*?)(?:\n##\s+|$)/i)?.[1] ||
    markdown.match(/##\s+Final Status\s+([\s\S]*?)(?:\n##\s+|$)/i)?.[1] ||
    markdown.slice(0, 800);
  return {
    id: stableId("experience", ["autoflow_completion_md", sourcePath]),
    projectPath: null,
    scope: "autoflow",
    sourceType: "autoflow_completion",
    title,
    summary,
    body: summary,
    tags: ["autoflow", "completion", "markdown"],
    sourcePath,
    sourceHash: hashText(markdown),
    status: "candidate",
  };
}

function cardFromAgentFamilyMemory(memoryCard, memoryPath) {
  const sourcePath = safeArray(memoryCard.provenance?.source_paths)[0] || memoryPath;
  const status = normalizeStatus(memoryCard.status || memoryCard.curator_status, ["candidate", "accepted", "curated", "archived"], "candidate");
  const mappedStatus = ["active", "curated"].includes(memoryCard.status) ? "curated" : status;
  return {
    id: stableId("experience", ["agent_family", memoryCard.card_id || memoryCard.title || sourcePath]),
    projectPath: null,
    scope: "autoflow",
    sourceType: "agent_family",
    title: memoryCard.title || memoryCard.summary || "Agent family memory",
    summary: memoryCard.summary || memoryCard.title || "",
    body: memoryCard.body || memoryCard.summary || "",
    tags: uniqCompact(["agent_family", memoryCard.family_id, memoryCard.card_kind, memoryCard.scope, memoryCard.status, memoryCard.capability_tags || []], 14),
    sourcePath,
    sourceHash: hashText(JSON.stringify(memoryCard)),
    status: mappedStatus,
    createdAt: memoryCard.created_at || memoryCard.updated_at || null,
  };
}

function extractBugMemorySections(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^####\s+`?([A-Z]+-\d+)`?\s*(.*)$/);
    if (match) {
      if (current) sections.push(current);
      current = { id: match[1], title: `${match[1]} ${compactText(match[2], 120)}`.trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections.slice(-MAX_BUG_MEMORY_CARDS);
}

function cardsFromBugMemory(markdown, sourcePath) {
  return extractBugMemorySections(markdown).map((section) => {
    const body = section.lines.join("\n");
    const summary =
      body.match(/- 经验：\s*([\s\S]*?)(?:\n- |\n####|$)/)?.[1] ||
      body.match(/- 修复：\s*([\s\S]*?)(?:\n- |\n####|$)/)?.[1] ||
      body.match(/- 根因：\s*([\s\S]*?)(?:\n- |\n####|$)/)?.[1] ||
      body.slice(0, 600);
    return {
      id: stableId("experience", ["bug_memory", sourcePath, section.id]),
      projectPath: null,
      scope: "user",
      sourceType: "bug_memory",
      title: section.title,
      summary,
      body,
      tags: uniqCompact(["bug_memory", section.id.split("-")[0], section.id], 8),
      sourcePath: `${sourcePath}#${section.id}`,
      sourceHash: hashText(body),
      status: "curated",
    };
  });
}

function shouldExportImportedProject(projectPath, workflowPath) {
  if (!projectPath) return false;
  const protectedRoots = [workflowPath, DEFAULT_AUTOFLOW_ROOT].filter(Boolean);
  return !protectedRoots.some((root) => isPathInside(root, projectPath));
}

async function importAutoflowExperience() {
  await ensureDatabase();
  const settings = getSettings();
  const workflowPath = settings.autoflowWorkflowPath || DEFAULT_AUTOFLOW_WORKFLOW_PATH;
  const bugMemoryPath = settings.bugFixMemoryPath || DEFAULT_BUG_FIX_MEMORY_PATH;
  const cards = [];
  const sources = [];

  const ledgerPath = path.join(workflowPath, "state", "completion_ledger.json");
  const ledger = await readJsonIfExists(ledgerPath).catch(() => null);
  if (ledger?.completions && Array.isArray(ledger.completions)) {
    const entries = ledger.completions.slice(-MAX_AUTOFLOW_LEDGER_CARDS);
    for (const entry of entries) cards.push(cardFromLedgerEntry(entry, ledgerPath));
    sources.push({ sourceType: "completion_ledger", sourcePath: ledgerPath, imported: entries.length });
  }

  const completionsDir = path.join(workflowPath, "output", "completions");
  const jsonFiles = await recentFiles(completionsDir, (name) => name.endsWith(".completion.json"), MAX_AUTOFLOW_COMPLETION_FILES).catch(() => []);
  for (const filePath of jsonFiles) {
    const raw = await readTextIfExists(filePath).catch(() => null);
    if (!raw) continue;
    const payload = safeJsonParseValue(raw, null);
    if (payload) cards.push(cardFromCompletionPayload(payload, filePath, hashText(raw)));
  }
  sources.push({ sourceType: "completion_json", sourcePath: completionsDir, imported: jsonFiles.length });

  const markdownFiles = await recentFiles(completionsDir, (name) => name.endsWith(".completion.md"), 20).catch(() => []);
  for (const filePath of markdownFiles) {
    const raw = await readTextIfExists(filePath).catch(() => null);
    if (raw) cards.push(cardFromCompletionMarkdown(raw, filePath));
  }
  sources.push({ sourceType: "completion_markdown", sourcePath: completionsDir, imported: markdownFiles.length });

  const familyMemoryPath = path.join(workflowPath, "state", "agent_families", "memory_cards.json");
  const familyMemory = await readJsonIfExists(familyMemoryPath).catch(() => null);
  if (Array.isArray(familyMemory?.cards)) {
    const memoryCards = familyMemory.cards.slice(-MAX_AGENT_FAMILY_CARDS);
    for (const card of memoryCards) cards.push(cardFromAgentFamilyMemory(card, familyMemoryPath));
    sources.push({ sourceType: "agent_family", sourcePath: familyMemoryPath, imported: memoryCards.length });
  }

  const bugMemory = await readTextIfExists(bugMemoryPath).catch(() => null);
  if (bugMemory) {
    const bugCards = cardsFromBugMemory(bugMemory, bugMemoryPath);
    cards.push(...bugCards);
    sources.push({ sourceType: "bug_memory", sourcePath: bugMemoryPath, imported: bugCards.length });
  }

  const unique = new Map();
  for (const card of cards) unique.set(card.id, card);
  const upserted = [];
  for (const card of unique.values()) {
    upserted.push(upsertExperienceCard(card));
  }

  const projectPaths = Array.from(new Set(upserted.map((card) => card.projectPath).filter(Boolean)));
  const exportProjects = projectPaths.filter((projectPath) => shouldExportImportedProject(projectPath, workflowPath));
  const skillCandidateIds = syncSkillCandidatesForProjects(exportProjects);
  const writtenFiles = await writeProjectMemoryFiles(exportProjects);
  await saveDatabase();

  return {
    imported: upserted.length,
    sources,
    projectPaths,
    writtenFiles,
    skillCandidateIds,
    overview: getMemoryOverview(),
  };
}

function buildCodexContext(doc) {
  const body = (doc.contentText || doc.summary || doc.parseError || "").slice(0, 16000);
  return [
    "# 知匣 Codex Context",
    "",
    `GeneratedAt: ${new Date().toISOString()}`,
    "",
    "## Source",
    "",
    `- DocumentId: ${doc.id}`,
    `- Title: ${doc.title}`,
    `- FilePath: ${doc.filePath}`,
    `- SourceType: ${doc.sourceType || "imported"}`,
    `- ArtifactType: ${doc.artifactType || "other"}`,
    `- Tags: ${(doc.tags || []).join(", ") || "none"}`,
    `- UpdatedAt: ${doc.updatedAt}`,
    "",
    "## Summary",
    "",
    doc.summary || "No summary.",
    "",
    "## Content",
    "",
    body || "No extracted content.",
    "",
  ].join("\n");
}

async function exportCodexContext(documentId) {
  await ensureDatabase();
  const doc = getDocumentById(documentId);
  if (!doc) throw new Error("未找到要导出的文档");

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Codex 工作区",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { exported: false, documents: listDocuments() };
  }

  const workspacePath = result.filePaths[0];
  const bundleDir = path.join(workspacePath, ".codex-knowledge");
  await fs.mkdir(bundleDir, { recursive: true });

  const contextPath = path.join(bundleDir, "context.md");
  const sourcesPath = path.join(bundleDir, "sources.json");
  const exportedAt = new Date().toISOString();
  const sourceManifest = {
    bundleId: `ctx-${exportedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    exportedAt,
    workspacePath,
    sources: [
      {
        documentId: doc.id,
        title: doc.title,
        filePath: doc.filePath,
        tags: doc.tags || [],
        sourceType: doc.sourceType || "imported",
        artifactType: doc.artifactType || "other",
        contentHash: doc.contentHash || null,
      },
    ],
  };

  await fs.writeFile(contextPath, buildCodexContext(doc), "utf8");
  await fs.writeFile(sourcesPath, JSON.stringify(sourceManifest, null, 2), "utf8");

  const imported = await importPaths([contextPath], {
    workspacePath,
    sourceType: "codex_context",
    artifactType: "context",
  });
  await startFileWatchers({ silent: true });
  return {
    exported: true,
    bundlePath: bundleDir,
    contextPath,
    sourcesPath,
    documents: imported.documents,
    errors: imported.errors,
  };
}

async function reindexDocuments(targetId = null) {
  await ensureDatabase();
  const targets = targetId ? [getDocumentById(targetId)].filter(Boolean) : listDocuments();
  const reindexed = [];
  const errors = [];
  for (const doc of targets) {
    try {
      const next = await importOne(doc.filePath);
      upsertDocument(next);
      reindexed.push(next);
    } catch (error) {
      errors.push({ filePath: doc.filePath, message: error instanceof Error ? error.message : String(error) });
      db.run(
        "UPDATE documents SET parseStatus = 'failed', parseError = $parseError, updatedAt = $updatedAt WHERE id = $id",
        {
          $id: doc.id,
          $parseError: error instanceof Error ? error.message : String(error),
          $updatedAt: new Date().toISOString(),
        },
      );
    }
  }
  await saveDatabase();
  await startFileWatchers({ silent: true });
  return { reindexed, documents: listDocuments(), errors };
}

function assertEditableDocumentContentTarget(doc) {
  if (!doc) throw new Error("文档不存在。");
  const fileName = path.basename(doc.filePath || "").toLowerCase();
  const parentName = path.basename(path.dirname(doc.filePath || "")).toLowerCase();
  if (fileName !== "project-resume.md" || parentName !== ".codex-knowledge") {
    throw new Error("当前只允许改写 .codex-knowledge/project-resume.md。");
  }
}

async function updateDocumentContent(id, contentText) {
  await ensureDatabase();
  const doc = getDocumentById(id);
  assertEditableDocumentContentTarget(doc);
  if (typeof contentText !== "string") throw new Error("正文内容必须是字符串。");
  if (contentText.length > 120000) throw new Error("Project Resume Packet 过长，请保持为一页可续接摘要。");

  await fs.writeFile(doc.filePath, contentText, "utf8");
  return reindexDocuments(id);
}

async function checkFileChanges(options = {}) {
  await ensureDatabase();
  const scopedRoots = Array.isArray(options.rootPaths) ? options.rootPaths.filter(Boolean) : [];
  const changedPath = options.changedPath ? path.normalize(String(options.changedPath)) : null;
  const docs = listDocumentMetas().filter((doc) => {
    if (changedPath) {
      const docPath = path.normalize(doc.filePath || "");
      return docPath === changedPath || isPathInside(changedPath, docPath);
    }
    if (scopedRoots.length > 0) {
      const docPath = path.normalize(doc.filePath || "");
      return scopedRoots.some((root) => docPath === path.normalize(root) || isPathInside(path.normalize(root), docPath));
    }
    return true;
  });
  const changed = [];
  const missing = [];
  for (const doc of docs) {
    try {
      const stats = await fs.stat(doc.filePath);
      const mtime = stats.mtime.toISOString();
      if (stats.size !== doc.size || mtime !== doc.fileModifiedAt) changed.push(doc);
    } catch {
      missing.push(doc);
    }
  }

  if (missing.length > 0) {
    const now = new Date().toISOString();
    for (const doc of missing) {
      db.run(
        "UPDATE documents SET parseStatus = 'failed', parseError = $parseError, updatedAt = $updatedAt WHERE id = $id",
        { $id: doc.id, $parseError: "源文件不存在或当前不可访问。", $updatedAt: now },
      );
    }
  }

  const reindexResult = changed.length > 0 ? await reindexDocumentsBatch(changed) : { reindexed: [], errors: [] };
  await saveDatabase();
  if (options.refreshWatchers !== false) {
    await startFileWatchers({ silent: true });
  }
  return {
    changed: changed.length,
    missing: missing.length,
    reindexed: reindexResult.reindexed,
    documents: listDocuments(),
    errors: reindexResult.errors,
  };
}

async function reindexDocumentsBatch(docs) {
  const reindexed = [];
  const errors = [];
  for (const doc of docs) {
    try {
      const next = await importOne(doc.filePath);
      upsertDocument(next);
      reindexed.push(next);
    } catch (error) {
      errors.push({ filePath: doc.filePath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reindexed, errors };
}

function getSettings() {
  const rows = db.exec("SELECT key, value FROM settings ORDER BY key");
  const settings = {};
  for (const row of rows[0]?.values || []) {
    try {
      settings[row[0]] = JSON.parse(row[1]);
    } catch {
      settings[row[0]] = row[1];
    }
  }
  return settings;
}

function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (isSensitiveSettingKey(key) && value === MASKED_SETTING_VALUE) {
      continue;
    }
    db.run(
      `INSERT INTO settings (key, value) VALUES ($key, $value)
       ON CONFLICT(key) DO UPDATE SET value = $value`,
      { $key: key, $value: JSON.stringify(value) },
    );
  }
}

async function readPerformanceState() {
  try {
    return JSON.parse(await fs.readFile(performanceStatePath(), "utf8"));
  } catch {
    return {};
  }
}

async function writePerformanceState(patch) {
  const current = await readPerformanceState();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await fs.writeFile(performanceStatePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

async function shouldRunStartupAutoIngest() {
  const state = await readPerformanceState();
  const lastRunAt = state.startupAutoIngest?.lastRunAt ? Date.parse(state.startupAutoIngest.lastRunAt) : 0;
  return !Number.isFinite(lastRunAt) || Date.now() - lastRunAt >= STARTUP_AUTO_INGEST_INTERVAL_MS;
}

function scheduleStartupAutoIngest() {
  if (startupAutoIngestTimer) clearTimeout(startupAutoIngestTimer);
  startupAutoIngestTimer = setTimeout(() => {
    startupAutoIngestTimer = null;
    runDeferredStartupAutoIngest().catch((error) => {
      console.warn("Deferred Codex thread history auto-ingest failed:", error);
    });
  }, STARTUP_AUTO_INGEST_DELAY_MS);
}

async function runDeferredStartupAutoIngest() {
  if (!(await shouldRunStartupAutoIngest())) {
    await writePerformanceState({
      startupAutoIngest: {
        ...(await readPerformanceState()).startupAutoIngest,
        skippedAt: new Date().toISOString(),
        skippedReason: "daily_cadence",
        options: STARTUP_AUTO_INGEST_OPTIONS,
      },
    });
    return { skipped: true, reason: "daily_cadence" };
  }
  await writePerformanceState({
    startupAutoIngest: {
      startedAt: new Date().toISOString(),
      status: "running",
      options: STARTUP_AUTO_INGEST_OPTIONS,
    },
  });
  try {
    const result = await autoIngestCodexThreadHistory(STARTUP_AUTO_INGEST_OPTIONS);
    await writePerformanceState({
      startupAutoIngest: {
        lastRunAt: new Date().toISOString(),
        status: "ok",
        options: STARTUP_AUTO_INGEST_OPTIONS,
        summary: {
          preserved: result?.preserved || 0,
          alreadyPreserved: result?.alreadyPreserved || 0,
          skippedActive: result?.skippedActive || 0,
          errors: Array.isArray(result?.errors) ? result.errors.length : 0,
        },
      },
    });
    return result;
  } catch (error) {
    await writePerformanceState({
      startupAutoIngest: {
        lastRunAt: new Date().toISOString(),
        status: "failed",
        options: STARTUP_AUTO_INGEST_OPTIONS,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function shortHash(text) {
  return hashText(text).slice(0, 16);
}

function stableId(prefix, parts) {
  return `${prefix}-${shortHash(parts.filter(Boolean).join("|"))}`;
}

function compactText(text, maxChars = COMPACT_BODY_CHARS) {
  const compact = cleanText(sanitizeText(text));
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function compactMarkdown(text, maxChars = COMPACT_BODY_CHARS) {
  const compact = sanitizeText(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function sanitizeText(text) {
  return String(text || "")
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/gi, "sk-[redacted]");
}

function safeJsonParseValue(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqCompact(items, limit = 12) {
  const seen = new Set();
  const result = [];
  for (const item of items.flat().filter(Boolean).map((value) => compactText(value, 80))) {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeStatus(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeExperienceCardRetrieveMeta(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const compact = (input, maxChars = 240) => {
    const text = String(input || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
  };
  const normalizeEnum = (input, allowed, fallback) => (allowed.includes(input) ? input : fallback);
  const sourceRefs = Array.isArray(raw.sourceRefs)
    ? raw.sourceRefs
      .filter(Boolean)
      .slice(0, 6)
      .map((ref) => ({
        kind: compact(ref.kind, 80) || "document",
        path: ref.path ? String(ref.path).trim() : null,
        title: compact(ref.title, 160),
        hash: compact(ref.hash, 160),
        updatedAt: compact(ref.updatedAt, 60),
        artifactType: compact(ref.artifactType, 80),
        sourceType: compact(ref.sourceType, 80),
      }))
    : [];
  const tokenEstimate = Math.max(0, Math.ceil(Number(raw.tokenEstimate || 0))) || 0;
  return {
    contractVersion: compact(raw.contractVersion, 80),
    freshness: normalizeEnum(raw.freshness, ["fresh", "review", "stale", "unknown", "conflict"], "unknown"),
    requiresHumanConfirmation: raw.requiresHumanConfirmation === true,
    reviewReason: compact(raw.reviewReason, 160),
    rawSessionPolicy: compact(raw.rawSessionPolicy, 240),
    sourceRefs,
    tokenEstimate,
    sourceDocumentId: compact(raw.sourceDocumentId, 120),
    sourceDocumentUpdatedAt: compact(raw.sourceDocumentUpdatedAt, 60),
    memoryType: compact(raw.memoryType, 80),
    sourceSignature: compact(raw.sourceSignature, 160),
    confirmedSourceSignature: compact(raw.confirmedSourceSignature, 160),
    sourceSignatureReviewState: normalizeEnum(raw.sourceSignatureReviewState, ["unreviewed", "current", "stale"], "unreviewed"),
    curationDecision: normalizeEnum(raw.curationDecision, ["pending", "keep", "merge", "reject", "archive"], "pending"),
    duplicateGroupKey: compact(raw.duplicateGroupKey, 180),
    duplicateState: normalizeEnum(raw.duplicateState, ["unique", "duplicate_candidate", "kept", "merged", "rejected", "archived"], "unique"),
    duplicateOf: compact(raw.duplicateOf, 140),
    duplicateCount: Math.max(0, Math.floor(Number(raw.duplicateCount || 0))) || 0,
    duplicateIds: Array.isArray(raw.duplicateIds) ? raw.duplicateIds.map((item) => compact(item, 140)).filter(Boolean).slice(0, 12) : [],
    suggestedMergeTargetId: compact(raw.suggestedMergeTargetId, 140),
    reviewedAt: compact(raw.reviewedAt, 60),
  };
}

function buildExperienceCardSourceSignature(card = {}) {
  const sourceRefs = Array.isArray(card.sourceRefs) ? card.sourceRefs : [];
  return hashText(JSON.stringify({
    projectPath: card.projectPath || null,
    sourceType: card.sourceType || null,
    sourcePath: card.sourcePath || null,
    sourceHash: card.sourceHash || null,
    sourceDocumentId: card.sourceDocumentId || null,
    sourceDocumentUpdatedAt: card.sourceDocumentUpdatedAt || null,
    sourceRefs: sourceRefs
      .map((ref) => ({
        kind: ref.kind || "document",
        path: ref.path || null,
        hash: ref.hash || null,
        updatedAt: ref.updatedAt || null,
        artifactType: ref.artifactType || null,
        sourceType: ref.sourceType || null,
      }))
      .sort((a, b) => `${a.kind}:${a.path}:${a.hash}`.localeCompare(`${b.kind}:${b.path}:${b.hash}`)),
  }));
}

function buildExperienceCardDuplicateKey(card = {}) {
  const memoryType = card.memoryType || "memory";
  if (card.sourceDocumentId || card.sourcePath) {
    return `same-source:${card.projectPath || "global"}:${card.sourceType || "unknown"}:${memoryType}:${card.sourceDocumentId || card.sourcePath}`;
  }
  return `same-memory:${shortHash([
    card.projectPath || "global",
    card.sourceType || "unknown",
    memoryType,
    compactText(card.title || "", 80).toLowerCase(),
    compactText(card.summary || card.body || "", 160).toLowerCase(),
  ].join("|"))}`;
}

function sameExperienceSourceIdentity(a = {}, b = {}) {
  if (!a || !b) return false;
  if (a.sourceType !== b.sourceType) return false;
  if ((a.projectPath || null) !== (b.projectPath || null)) return false;
  if ((a.memoryType || "memory") !== (b.memoryType || "memory")) return false;
  if (a.sourceDocumentId && b.sourceDocumentId) return a.sourceDocumentId === b.sourceDocumentId;
  return Boolean(a.sourcePath && b.sourcePath && a.sourcePath === b.sourcePath);
}

function experienceCardReviewState(card = {}) {
  if (!card.confirmedSourceSignature) return "unreviewed";
  return card.confirmedSourceSignature === card.sourceSignature ? "current" : "stale";
}

function decisionForExperienceStatus(status) {
  if (status === "accepted") return "keep";
  if (status === "curated") return "merge";
  if (status === "rejected") return "reject";
  if (status === "archived") return "archive";
  return "pending";
}

function statusForExperienceDecision(decision) {
  if (decision === "keep") return "accepted";
  if (decision === "merge") return "curated";
  if (decision === "reject") return "rejected";
  if (decision === "archive") return "archived";
  return "candidate";
}

function duplicateStateForExperience(card = {}, group = []) {
  if (card.curationDecision === "reject" || card.status === "rejected") return "rejected";
  if (card.curationDecision === "archive" || card.status === "archived") return "archived";
  if (card.curationDecision === "merge") return "merged";
  if (card.curationDecision === "keep") return "kept";
  return group.length > 1 ? "duplicate_candidate" : "unique";
}

function enrichExperienceCardGovernance(card = {}, group = []) {
  const sourceSignature = card.sourceSignature || buildExperienceCardSourceSignature(card);
  const duplicateGroupKey = card.duplicateGroupKey || buildExperienceCardDuplicateKey(card);
  const duplicateIds = group
    .filter((item) => item && item.id && item.id !== card.id)
    .map((item) => item.id)
    .slice(0, 12);
  const suggestedMergeTarget = group.find((item) => item && item.id !== card.id && ["accepted", "curated"].includes(item.status)) ||
    group.find((item) => item && item.id !== card.id);
  const enriched = {
    ...card,
    sourceSignature,
    duplicateGroupKey,
  };
  return {
    ...enriched,
    sourceSignatureReviewState: experienceCardReviewState(enriched),
    duplicateState: duplicateStateForExperience(enriched, group),
    duplicateCount: Math.max(0, group.length - 1),
    duplicateIds,
    suggestedMergeTargetId: suggestedMergeTarget?.id || null,
  };
}

function rowToExperienceCard(row) {
  const meta = normalizeExperienceCardRetrieveMeta(safeJsonParseValue(row[10], {}));
  const card = {
    id: row[0],
    projectPath: row[1] || null,
    scope: row[2],
    sourceType: row[3],
    title: row[4],
    summary: row[5] || "",
    body: row[6] || "",
    tags: safeParseArray(row[7]),
    sourcePath: row[8] || null,
    sourceHash: row[9] || null,
    ...meta,
    status: row[11],
    createdAt: row[12],
    updatedAt: row[13],
  };
  return enrichExperienceCardGovernance(card);
}

function isSensitiveSettingKey(key) {
  return key === "aiProviderApiKey";
}

function sanitizedSettings(settings = {}) {
  const next = { ...settings };
  if (Object.prototype.hasOwnProperty.call(next, "aiProviderApiKey")) {
    next.aiProviderApiKey = next.aiProviderApiKey ? MASKED_SETTING_VALUE : "";
  }
  return next;
}

function categoryLabel(category) {
  const labels = {
    architecture: "架构",
    product: "产品",
    testing: "测试",
    operations: "运维",
    process: "流程",
    data: "数据",
    docs: "文档",
    general: "通用",
  };
  return labels[category] || category || "通用";
}

function rowToKnowledgeItem(row) {
  return {
    id: row[0],
    projectPath: row[1] || null,
    documentId: row[2] || null,
    sourcePath: row[3] || null,
    title: row[4],
    summary: row[5] || "",
    body: row[6] || "",
    category: row[7] || "general",
    tags: safeParseArray(row[8]),
    sourceHash: row[9] || null,
    provider: row[10] || "local",
    model: row[11] || "heuristic",
    status: row[12] || "ready",
    errorMessage: row[13] || null,
    createdAt: row[14],
    updatedAt: row[15],
  };
}

function listKnowledgeItems(projectPath = null, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 240), 600));
  const params = {};
  let where = "";
  if (projectPath) {
    params.$projectPath = projectPath;
    where = "WHERE projectPath = $projectPath";
  }
  const query = [
    "SELECT id, projectPath, documentId, sourcePath, title, summary, body, category, tagsJson, sourceHash, provider, model, status, errorMessage, createdAt, updatedAt",
    "FROM knowledge_items",
    where,
    "ORDER BY updatedAt DESC",
    "LIMIT " + limit,
  ].filter(Boolean).join(" ");
  const result = db.exec(query, params);
  return (result[0]?.values || []).map(rowToKnowledgeItem);
}

function getKnowledgeOverview() {
  const total = db.exec("SELECT COUNT(*) FROM knowledge_items")[0]?.values?.[0]?.[0] || 0;
  const categories = [];
  const categoryRows = db.exec(
    "SELECT category, COUNT(*) FROM knowledge_items GROUP BY category ORDER BY COUNT(*) DESC, category ASC",
  );
  for (const row of categoryRows[0]?.values || []) {
    categories.push({ category: row[0] || "general", label: categoryLabel(row[0]), count: row[1] || 0 });
  }
  const projects = new Map();
  const projectRows = db.exec(
    "SELECT projectPath, COUNT(*) FROM knowledge_items WHERE projectPath IS NOT NULL AND projectPath != '' GROUP BY projectPath",
  );
  for (const row of projectRows[0]?.values || []) {
    projects.set(row[0], {
      projectPath: row[0],
      projectName: projectNameFromPath(row[0]),
      knowledgeItems: row[1] || 0,
    });
  }
  return {
    total,
    categories,
    projects: Array.from(projects.values()).sort((a, b) => a.projectName.localeCompare(b.projectName)),
  };
}

function getKnowledgeItemById(id) {
  const result = db.exec(
    "SELECT id, projectPath, documentId, sourcePath, title, summary, body, category, tagsJson, sourceHash, provider, model, status, errorMessage, createdAt, updatedAt FROM knowledge_items WHERE id = $id",
    { $id: id },
  );
  const row = result[0]?.values?.[0];
  return row ? rowToKnowledgeItem(row) : null;
}

function upsertKnowledgeItem(item) {
  const now = new Date().toISOString();
  const existing = getKnowledgeItemById(item.id);
  const next = {
    ...item,
    projectPath: item.projectPath || null,
    documentId: item.documentId || null,
    sourcePath: item.sourcePath || null,
    category: normalizeStatus(item.category, ["architecture", "product", "testing", "operations", "process", "data", "docs", "general"], "general"),
    provider: compactText(item.provider || "local", 40),
    model: compactText(item.model || "heuristic", 80),
    status: normalizeStatus(item.status, ["ready", "fallback", "error"], "ready"),
    tags: uniqCompact(item.tags || [], 12),
    createdAt: existing?.createdAt || item.createdAt || now,
    updatedAt: now,
  };
  db.run(
    "INSERT INTO knowledge_items (id, projectPath, documentId, sourcePath, title, summary, body, category, tagsJson, sourceHash, provider, model, status, errorMessage, createdAt, updatedAt) VALUES ($id, $projectPath, $documentId, $sourcePath, $title, $summary, $body, $category, $tagsJson, $sourceHash, $provider, $model, $status, $errorMessage, $createdAt, $updatedAt) ON CONFLICT(id) DO UPDATE SET projectPath = $projectPath, documentId = $documentId, sourcePath = $sourcePath, title = $title, summary = $summary, body = $body, category = $category, tagsJson = $tagsJson, sourceHash = $sourceHash, provider = $provider, model = $model, status = $status, errorMessage = $errorMessage, updatedAt = $updatedAt",
    {
      $id: next.id,
      $projectPath: next.projectPath,
      $documentId: next.documentId,
      $sourcePath: next.sourcePath,
      $title: compactText(next.title || "Untitled knowledge", 160),
      $summary: compactText(next.summary || next.body || "", COMPACT_SUMMARY_CHARS),
      $body: compactText(next.body || next.summary || "", KNOWLEDGE_BODY_CHARS),
      $category: next.category,
      $tagsJson: JSON.stringify(next.tags),
      $sourceHash: next.sourceHash || null,
      $provider: next.provider,
      $model: next.model,
      $status: next.status,
      $errorMessage: next.errorMessage ? compactText(next.errorMessage, 240) : null,
      $createdAt: next.createdAt,
      $updatedAt: next.updatedAt,
    },
  );
  return next;
}

function deleteKnowledgeItemsForScope(projectPath = null, documentIds = []) {
  if (projectPath) {
    db.run("DELETE FROM knowledge_items WHERE projectPath = $projectPath", { $projectPath: projectPath });
    return;
  }
  const ids = Array.from(new Set(documentIds.filter(Boolean)));
  if (ids.length > 0) {
    const placeholders = ids.map((_, index) => "$id" + index);
    const params = Object.fromEntries(ids.map((id, index) => ["$id" + index, id]));
    db.run("DELETE FROM knowledge_items WHERE documentId IN (" + placeholders.join(", ") + ")", params);
  }
}

function rowToSkillCandidate(row) {
  return {
    id: row[0],
    projectPath: row[1] || null,
    scope: row[2],
    title: row[3],
    triggerPatterns: safeParseArray(row[4]),
    draftSkillMarkdown: row[5] || "",
    evidence: safeJsonParseValue(row[6], {}),
    status: row[7],
    createdAt: row[8],
    updatedAt: row[9],
  };
}

function getExperienceCardById(id) {
  const result = db.exec(
    `SELECT id, projectPath, scope, sourceType, title, summary, body, tagsJson, sourcePath, sourceHash, retrievalMetaJson, status, createdAt, updatedAt
     FROM experience_cards WHERE id = $id`,
    { $id: id },
  );
  const row = result[0]?.values?.[0];
  return row ? rowToExperienceCard(row) : null;
}

function upsertExperienceCard(card) {
  const now = new Date().toISOString();
  const existing = getExperienceCardById(card.id);
  const preservedStatuses = new Set(["accepted", "curated", "archived", "rejected", "stale"]);
  const sourceSignature = card.sourceSignature || buildExperienceCardSourceSignature(card);
  const duplicateGroupKey = card.duplicateGroupKey || buildExperienceCardDuplicateKey(card);
  const next = {
    ...card,
    projectPath: card.projectPath || null,
    scope: normalizeStatus(card.scope, ["user", "project", "task", "autoflow"], "autoflow"),
    sourceType: normalizeStatus(
      card.sourceType,
      ["autoflow_completion", "bug_memory", "agent_family", "manual", "project_doc"],
      "manual",
    ),
    status:
      existing && preservedStatuses.has(existing.status)
        ? existing.status
        : normalizeStatus(card.status, ["candidate", "accepted", "curated", "archived", "rejected", "stale"], "candidate"),
    tags: uniqCompact(card.tags || [], 16),
    sourceSignature,
    duplicateGroupKey,
    createdAt: existing?.createdAt || card.createdAt || now,
    updatedAt: now,
  };
  if (!existing && next.sourceType === "project_doc") {
    const sourceSiblings = listExperienceCards(next.projectPath, { includeGlobal: false, limit: 500 })
      .filter((item) => item.id !== next.id && ["accepted", "curated"].includes(item.status) && sameExperienceSourceIdentity(item, next));
    for (const sibling of sourceSiblings) {
      const staleMeta = normalizeExperienceCardRetrieveMeta({
        ...sibling,
        sourceHash: next.sourceHash || sibling.sourceHash,
        sourceRefs: Array.isArray(next.sourceRefs) && next.sourceRefs.length ? next.sourceRefs : sibling.sourceRefs,
        sourceSignature,
        sourceDocumentUpdatedAt: next.sourceDocumentUpdatedAt || sibling.sourceDocumentUpdatedAt,
        sourceSignatureReviewState: "stale",
        duplicateGroupKey,
        duplicateState: "duplicate_candidate",
      });
      db.run("UPDATE experience_cards SET status = $status, retrievalMetaJson = $retrievalMetaJson, updatedAt = $updatedAt WHERE id = $id", {
        $id: sibling.id,
        $status: "stale",
        $retrievalMetaJson: JSON.stringify(staleMeta),
        $updatedAt: now,
      });
    }
  }
  const retrievalMeta = normalizeExperienceCardRetrieveMeta(enrichExperienceCardGovernance({
    ...(existing || {}),
    ...(card || {}),
    status: next.status,
    sourceSignature,
    duplicateGroupKey,
  }));
  db.run(
    `INSERT INTO experience_cards (
      id, projectPath, scope, sourceType, title, summary, body, tagsJson, sourcePath, sourceHash, retrievalMetaJson, status, createdAt, updatedAt
    ) VALUES (
      $id, $projectPath, $scope, $sourceType, $title, $summary, $body, $tagsJson, $sourcePath, $sourceHash, $retrievalMetaJson, $status, $createdAt, $updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      projectPath = $projectPath,
      scope = $scope,
      sourceType = $sourceType,
      title = $title,
      summary = $summary,
      body = $body,
      tagsJson = $tagsJson,
      sourcePath = $sourcePath,
      sourceHash = $sourceHash,
      retrievalMetaJson = $retrievalMetaJson,
      status = $status,
      updatedAt = $updatedAt`,
    {
      $id: next.id,
      $projectPath: next.projectPath,
      $scope: next.scope,
      $sourceType: next.sourceType,
      $title: compactText(next.title || "Untitled experience", 160),
      $summary: compactText(next.summary || next.body || "", COMPACT_SUMMARY_CHARS),
      $body: compactText(next.body || next.summary || "", COMPACT_BODY_CHARS),
      $tagsJson: JSON.stringify(next.tags),
      $sourcePath: next.sourcePath || null,
      $sourceHash: next.sourceHash || null,
      $retrievalMetaJson: JSON.stringify(retrievalMeta),
      $status: next.status,
      $createdAt: next.createdAt,
      $updatedAt: next.updatedAt,
    },
  );
  return next;
}

function listExperienceCards(projectPath = null, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 120), 500));
  const includeGlobal = options.includeGlobal !== false;
  const params = {};
  let where = "";
  if (projectPath) {
    params.$projectPath = projectPath;
    where = includeGlobal
      ? "WHERE projectPath = $projectPath OR projectPath IS NULL OR projectPath = ''"
      : "WHERE projectPath = $projectPath";
  }
  const result = db.exec(
    `SELECT id, projectPath, scope, sourceType, title, summary, body, tagsJson, sourcePath, sourceHash, retrievalMetaJson, status, createdAt, updatedAt
     FROM experience_cards
     ${where}
     ORDER BY updatedAt DESC
     LIMIT ${limit}`,
    params,
  );
  const cards = (result[0]?.values || []).map(rowToExperienceCard);
  const groups = new Map();
  for (const card of cards) {
    const key = card.duplicateGroupKey || buildExperienceCardDuplicateKey(card);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  return cards.map((card) => enrichExperienceCardGovernance(card, groups.get(card.duplicateGroupKey) || [card]));
}

function updateExperienceCardStatus(id, status, options = {}) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) throw new Error("缺少 experience card id");
  const nextStatus = normalizeStatus(status, ["candidate", "accepted", "curated", "archived", "rejected", "stale"], "");
  if (!nextStatus) throw new Error("不支持的 experience card 状态");
  const existing = getExperienceCardById(normalizedId);
  if (!existing) throw new Error("未找到要更新的 experience card");
  const requestedDecision = options && typeof options === "object" ? options.curationDecision : null;
  const curationDecision = normalizeStatus(
    requestedDecision || decisionForExperienceStatus(nextStatus),
    ["pending", "keep", "merge", "reject", "archive"],
    decisionForExperienceStatus(nextStatus),
  );
  const sourceSignature = existing.sourceSignature || buildExperienceCardSourceSignature(existing);
  const duplicateGroupKey = existing.duplicateGroupKey || buildExperienceCardDuplicateKey(existing);
  const confirmedSourceSignature = nextStatus === "candidate" || nextStatus === "stale" ? null : sourceSignature;
  const duplicateGroup = listExperienceCards(existing.projectPath || null, { includeGlobal: true, limit: 500 })
    .filter((card) => (card.duplicateGroupKey || buildExperienceCardDuplicateKey(card)) === duplicateGroupKey);
  const governedCard = enrichExperienceCardGovernance({
    ...existing,
    status: nextStatus,
    sourceSignature,
    confirmedSourceSignature,
    sourceSignatureReviewState: confirmedSourceSignature ? "current" : "unreviewed",
    curationDecision,
    duplicateGroupKey,
    reviewedAt: nextStatus === "candidate" || nextStatus === "stale" ? null : new Date().toISOString(),
  }, duplicateGroup);
  const retrievalMeta = normalizeExperienceCardRetrieveMeta(governedCard);
  const updatedAt = new Date().toISOString();
  db.run("UPDATE experience_cards SET status = $status, retrievalMetaJson = $retrievalMetaJson, updatedAt = $updatedAt WHERE id = $id", {
    $id: normalizedId,
    $status: nextStatus,
    $retrievalMetaJson: JSON.stringify(retrievalMeta),
    $updatedAt: updatedAt,
  });
  return listExperienceCards(existing.projectPath || null, { includeGlobal: true, limit: 500 })
    .find((card) => card.id === normalizedId) || getExperienceCardById(normalizedId);
}

function getSkillCandidateById(id) {
  const result = db.exec(
    `SELECT id, projectPath, scope, title, triggerPatternsJson, draftSkillMarkdown, evidenceJson, status, createdAt, updatedAt
     FROM skill_candidates WHERE id = $id`,
    { $id: id },
  );
  const row = result[0]?.values?.[0];
  return row ? rowToSkillCandidate(row) : null;
}

function upsertSkillCandidate(candidate) {
  const now = new Date().toISOString();
  const existing = getSkillCandidateById(candidate.id);
  const preservedStatuses = new Set(["approved", "installed", "rejected"]);
  const nextStatus =
    existing && preservedStatuses.has(existing.status)
      ? existing.status
      : normalizeStatus(candidate.status, ["draft", "approved", "installed", "rejected"], "draft");
  db.run(
    `INSERT INTO skill_candidates (
      id, projectPath, scope, title, triggerPatternsJson, draftSkillMarkdown, evidenceJson, status, createdAt, updatedAt
    ) VALUES (
      $id, $projectPath, $scope, $title, $triggerPatternsJson, $draftSkillMarkdown, $evidenceJson, $status, $createdAt, $updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      projectPath = $projectPath,
      scope = $scope,
      title = $title,
      triggerPatternsJson = $triggerPatternsJson,
      draftSkillMarkdown = $draftSkillMarkdown,
      evidenceJson = $evidenceJson,
      status = $status,
      updatedAt = $updatedAt`,
    {
      $id: candidate.id,
      $projectPath: candidate.projectPath || null,
      $scope: normalizeStatus(candidate.scope, ["user", "project", "task"], "project"),
      $title: compactText(candidate.title || "Untitled skill candidate", 160),
      $triggerPatternsJson: JSON.stringify(uniqCompact(candidate.triggerPatterns || [], 20)),
      $draftSkillMarkdown: compactMarkdown(candidate.draftSkillMarkdown || "", 6000),
      $evidenceJson: JSON.stringify(candidate.evidence || {}),
      $status: nextStatus,
      $createdAt: existing?.createdAt || candidate.createdAt || now,
      $updatedAt: now,
    },
  );
}

function listSkillCandidates(projectPath = null, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 80), 300));
  const params = {};
  let where = "";
  if (projectPath) {
    params.$projectPath = projectPath;
    where = "WHERE projectPath = $projectPath";
  }
  const result = db.exec(
    `SELECT id, projectPath, scope, title, triggerPatternsJson, draftSkillMarkdown, evidenceJson, status, createdAt, updatedAt
     FROM skill_candidates
     ${where}
     ORDER BY updatedAt DESC
     LIMIT ${limit}`,
    params,
  );
  return (result[0]?.values || []).map(rowToSkillCandidate);
}

function updateSkillCandidateStatus(id, status) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) throw new Error("缺少 skill candidate id");
  const nextStatus = normalizeStatus(status, ["draft", "approved", "installed", "rejected"], "");
  if (!nextStatus) throw new Error("不支持的 skill candidate 状态");
  const existing = getSkillCandidateById(normalizedId);
  if (!existing) throw new Error("未找到要更新的 skill candidate");
  const updatedAt = new Date().toISOString();
  db.run("UPDATE skill_candidates SET status = $status, updatedAt = $updatedAt WHERE id = $id", {
    $id: normalizedId,
    $status: nextStatus,
    $updatedAt: updatedAt,
  });
  return getSkillCandidateById(normalizedId);
}

function getMemoryOverview() {
  const cardCount = db.exec("SELECT COUNT(*) FROM experience_cards")[0]?.values?.[0]?.[0] || 0;
  const candidateCount = db.exec("SELECT COUNT(*) FROM skill_candidates")[0]?.values?.[0]?.[0] || 0;
  const projects = new Map();
  for (const doc of listDocumentMetas()) {
    if (!doc.workspacePath) continue;
    if (!projects.has(doc.workspacePath)) {
      projects.set(doc.workspacePath, { projectPath: doc.workspacePath, projectName: projectNameFromPath(doc.workspacePath), experienceCards: 0, skillCandidates: 0 });
    }
  }
  const cardGroups = db.exec(
    "SELECT projectPath, COUNT(*) FROM experience_cards WHERE projectPath IS NOT NULL AND projectPath != '' GROUP BY projectPath",
  );
  for (const row of cardGroups[0]?.values || []) {
    const projectPath = row[0];
    const current =
      projects.get(projectPath) ||
      { projectPath, projectName: projectNameFromPath(projectPath), experienceCards: 0, skillCandidates: 0 };
    current.experienceCards = row[1] || 0;
    projects.set(projectPath, current);
  }
  const candidateGroups = db.exec(
    "SELECT projectPath, COUNT(*) FROM skill_candidates WHERE projectPath IS NOT NULL AND projectPath != '' GROUP BY projectPath",
  );
  for (const row of candidateGroups[0]?.values || []) {
    const projectPath = row[0];
    const current =
      projects.get(projectPath) ||
      { projectPath, projectName: projectNameFromPath(projectPath), experienceCards: 0, skillCandidates: 0 };
    current.skillCandidates = row[1] || 0;
    projects.set(projectPath, current);
  }
  return {
    experienceCards: cardCount,
    skillCandidates: candidateCount,
    projects: Array.from(projects.values()).sort((a, b) => a.projectName.localeCompare(b.projectName)),
  };
}

const AGENT_RETRIEVE_ITEM_EXCERPT_CHARS = 220;
const AGENT_RETRIEVE_LOG_LIMIT = 50;
let agentRetrieveLogs = [];
const agentRetrieveCache = new Map();

function tokenizeAgentQuery(query) {
  return cleanText(String(query || ""))
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function estimateAgentTokens(text) {
  const compact = cleanText(String(text || ""));
  return Math.max(24, Math.ceil(compact.length / 4));
}

function normalizeAgentRetrieveRequest(options = {}) {
  return normalizeAgentRetrievePolicyRequest(options, {
    allowedKinds: AGENT_RETRIEVE_ALLOWED_KINDS,
    resolveProjectPath: (projectPath) => path.resolve(projectPath),
  });
}

function artifactPriorityScore(type) {
  const weights = {
    readme: 18,
    prd: 17,
    technical_design: 16,
    test_plan: 15,
    release_notes: 13,
    report: 12,
    context: 12,
    markdown: 7,
    document: 7,
    other: 4,
  };
  return weights[type] || 4;
}

function scoreStatusPriority(status) {
  const normalized = String(status || "").toLowerCase();
  if (["active", "current", "ready", "accepted", "curated", "approved", "installed", "ok"].includes(normalized)) return 18;
  if (["fallback", "partial", "candidate", "draft"].includes(normalized)) return 9;
  if (["needs_review", "review"].includes(normalized)) return 6;
  if (["error", "failed", "archived", "rejected", "superseded"].includes(normalized)) return 2;
  return 6;
}

function isSourceChanged(fileModifiedAt, updatedAt) {
  if (!fileModifiedAt || !updatedAt) return false;
  const modifiedTime = new Date(fileModifiedAt).getTime();
  const updatedTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(modifiedTime) || !Number.isFinite(updatedTime)) return false;
  return modifiedTime > updatedTime;
}

function inferDocumentRetrieveFreshness(doc) {
  if (doc.parseStatus === "failed") return "stale";
  if (doc.duplicateOf || doc.parseStatus === "partial" || isSourceChanged(doc.fileModifiedAt, doc.updatedAt)) return "review";
  return "fresh";
}

function inferKnowledgeRetrieveFreshness(item) {
  if (item.status === "error") return "stale";
  if (item.status === "fallback") return "review";
  return "fresh";
}

function inferExperienceRetrieveFreshness(card) {
  if (card?.sourceSignatureReviewState === "stale") return "review";
  if (["duplicate_candidate", "merged"].includes(card?.duplicateState)) return "review";
  if (["reject", "archive"].includes(card?.curationDecision)) return "stale";
  if (["fresh", "review", "stale", "unknown", "conflict"].includes(card?.freshness)) {
    return card.freshness;
  }
  if (["archived", "rejected", "stale"].includes(card.status)) return "stale";
  if (card.status === "candidate") return "review";
  return "fresh";
}

function inferSkillRetrieveFreshness(candidate) {
  if (candidate.status === "rejected") return "stale";
  if (candidate.status === "draft") return "review";
  return "fresh";
}

function overallFreshness(items) {
  if (items.some((item) => item.freshness === "stale")) return "stale";
  if (items.some((item) => item.freshness === "review")) return "review";
  return "fresh";
}

function whyMatchedForText(tokens, fields, baselineReasons = []) {
  const reasons = [...baselineReasons];
  const loweredFields = fields.map(({ label, text }) => ({
    label,
    text: cleanText(String(text || "")).toLowerCase(),
  }));
  for (const token of tokens) {
    if (loweredFields.some((field) => field.text.includes(token))) {
      const labels = loweredFields.filter((field) => field.text.includes(token)).map((field) => field.label);
      reasons.push(`token:${token}@${labels.join("+")}`);
    }
  }
  return uniqCompact(reasons, 8);
}

function buildSourceRef({ kind, path: refPath, title, hash, updatedAt }) {
  return {
    kind,
    path: refPath || null,
    title: compactText(title || "", 120) || null,
    hash: hash || null,
    updatedAt: updatedAt || null,
  };
}

function stableShortId(prefix, value) {
  return `${prefix}:${crypto.createHash("sha256").update(String(value || prefix)).digest("hex").slice(0, 16)}`;
}

function inferProjectCompletion(artifactTypes) {
  const types = new Set(safeArray(artifactTypes).filter(Boolean));
  if (types.has("release_notes")) return "released";
  if (types.has("test_plan")) return "testing";
  if (types.has("technical_design")) return "design";
  if (types.has("prd")) return "prd";
  if (types.has("readme") || types.has("context")) return "idea";
  return "unknown";
}

function completionPercentForStage(stage) {
  const weights = {
    idea: 10,
    prd: 25,
    design: 40,
    implementation: 60,
    testing: 75,
    packaging: 85,
    released: 100,
    maintenance: 90,
    unknown: 0,
  };
  return weights[stage] ?? 0;
}

function inferProjectRecordStatus(record) {
  if (record.staleCount > 0) return "waiting_review";
  if (record.lastActivityAt) {
    const ageMs = Date.now() - new Date(record.lastActivityAt).getTime();
    if (Number.isFinite(ageMs) && ageMs > 1000 * 60 * 60 * 24 * 45) return "paused";
  }
  if (record.completion === "released") return "completed";
  return "active";
}

function applyProjectRecordOverride(record, override) {
  const projectRecordSourceSignature = buildProjectRecordSourceSignature(record);
  if (!override || typeof override !== "object") {
    return {
      ...record,
      governance: {
        status: "heuristic",
        reviewState: "unconfirmed",
        projectRecordSourceSignature,
        previousProjectRecordSourceSignature: null,
        confirmedAt: null,
      },
    };
  }
  const next = { ...record };
  const previousSignature = typeof override.projectRecordSourceSignature === "string" ? override.projectRecordSourceSignature : null;
  const reviewState = previousSignature && previousSignature !== projectRecordSourceSignature ? "stale" : "current";
  next.governance = {
    status: override.confirmedAt ? "confirmed" : "heuristic",
    reviewState,
    projectRecordSourceSignature,
    previousProjectRecordSourceSignature: previousSignature,
    confirmedAt: typeof override.confirmedAt === "string" ? override.confirmedAt : null,
  };
  if (reviewState === "stale") {
    next.recordSource = "human_confirmation_stale";
    return next;
  }
  if (typeof override.status === "string") next.status = override.status;
  if (typeof override.completion === "string") next.completion = override.completion;
  if (Number.isFinite(Number(override.completionPercent))) {
    next.completionPercent = Math.max(0, Math.min(100, Number(override.completionPercent)));
  }
  if (typeof override.lastSummary === "string" && override.lastSummary.trim()) {
    next.lastSummary = compactText(override.lastSummary, 260);
  }
  if (typeof override.nextAction === "string" && override.nextAction.trim()) {
    next.nextAction = compactText(override.nextAction, 240);
  }
  if (Array.isArray(override.blockers)) {
    next.blockers = uniqCompact(override.blockers.map((item) => compactText(item, 120)), 12);
  }
  if (typeof override.confirmedAt === "string") {
    next.humanConfirmedAt = override.confirmedAt;
  }
  next.recordSource = "human_confirmed";
  return next;
}

function buildProjectRecordSourceSignature(record = {}) {
  const refs = safeArray(record.sourceRefs)
    .map((ref) => ({
      path: ref.path || null,
      hash: ref.hash || null,
      updatedAt: ref.updatedAt || null,
    }))
    .sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")))
    .slice(0, 8);
  return JSON.stringify({
    rootPath: record.rootPath || null,
    documentCount: Number(record.documentCount || 0),
    codexCount: Number(record.codexCount || 0),
    activeCount: Number(record.activeCount || 0),
    reviewCount: Number(record.reviewCount || 0),
    staleCount: Number(record.staleCount || 0),
    sourceRefs: refs,
  });
}

function extractThreadIdsFromText(text) {
  const ids = new Set();
  const source = String(text || "");
  for (const match of source.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
    ids.add(match[0].toLowerCase());
  }
  return Array.from(ids).slice(0, 24);
}

function textLooksLikeCeoFlow(text) {
  return /\bCEO\b|CEO Flow|Thread Orchestrator|维护线程|orchestrator|task card|acceptance|验收|handoff|worker|reviewer|专家|员工/i.test(
    String(text || ""),
  );
}

function classifyCeoFlowRole(text) {
  const value = String(text || "");
  if (/review|QA|审核|验收/i.test(value)) return "reviewer";
  if (/memory|knowledge|记忆|知识/i.test(value)) return "memory";
  if (/research|docs|调研|文档/i.test(value)) return "research";
  if (/worker|implementation|实现|修复|专家|员工/i.test(value)) return "worker";
  if (/\bCEO\b|orchestrator|维护线程/i.test(value)) return "ceo";
  return "unknown";
}

function buildProjectRecords() {
  const map = new Map();
  const projectRecordOverrides = getSettings().projectRecordOverrides || {};
  for (const doc of listDocumentMetas()) {
    if (!doc.workspacePath) continue;
    const current = map.get(doc.workspacePath) || {
      id: stableShortId("project", doc.workspacePath),
      kind: "project_record",
      name: projectNameFromPath(doc.workspacePath),
      rootPath: doc.workspacePath,
      aliases: [projectNameFromPath(doc.workspacePath)],
      status: "unknown",
      completion: "unknown",
      completionPercent: 0,
      ownerThreadId: null,
      ceoThreadIds: [],
      workerThreadIds: [],
      reviewerThreadIds: [],
      lastActivityAt: doc.updatedAt,
      lastSummary: "",
      nextAction: "打开项目档案，确认当前有效文档、待确认记忆和下一步。",
      blockers: [],
      documentCount: 0,
      codexCount: 0,
      activeCount: 0,
      reviewCount: 0,
      staleCount: 0,
      artifactTypes: new Set(),
      sourceRefs: [],
    };
    current.documentCount += 1;
    if (doc.artifactType) current.artifactTypes.add(doc.artifactType);
    if (["codex_context", "codex_output"].includes(doc.sourceType || "")) current.codexCount += 1;
    const freshness = inferDocumentRetrieveFreshness(doc);
    if (freshness === "fresh") current.activeCount += 1;
    if (freshness === "review") current.reviewCount += 1;
    if (freshness === "stale") current.staleCount += 1;
    if (new Date(doc.updatedAt).getTime() > new Date(current.lastActivityAt || 0).getTime()) {
      current.lastActivityAt = doc.updatedAt;
      current.lastSummary = compactText(doc.summary || doc.title || doc.fileName, 220);
    }
    const text = `${doc.title} ${doc.fileName} ${doc.summary} ${doc.filePath}`;
    const ids = extractThreadIdsFromText(text);
    if (textLooksLikeCeoFlow(text) && ids.length > 0) {
      current.ceoThreadIds.push(ids[0]);
      current.ownerThreadId ||= ids[0];
    }
    current.sourceRefs.push(
      buildSourceRef({
        kind: "document",
        path: doc.filePath,
        title: doc.title,
        hash: doc.contentHash,
        updatedAt: doc.updatedAt,
      }),
    );
    map.set(doc.workspacePath, current);
  }
  for (const item of listKnowledgeItems(null, { limit: 600 })) {
    if (!item.projectPath || !map.has(item.projectPath)) continue;
    const current = map.get(item.projectPath);
    const text = `${item.title} ${item.summary} ${item.body} ${item.tags.join(" ")} ${item.sourcePath || ""}`;
    const ids = extractThreadIdsFromText(text);
    if (textLooksLikeCeoFlow(text) && ids.length > 0) {
      current.ceoThreadIds.push(ids[0]);
      current.ownerThreadId ||= ids[0];
    }
  }
  for (const card of listExperienceCards(null, { includeGlobal: false, limit: 500 })) {
    if (!card.projectPath || !map.has(card.projectPath)) continue;
    const current = map.get(card.projectPath);
    const text = `${card.title} ${card.summary} ${card.body} ${card.tags.join(" ")} ${card.sourcePath || ""}`;
    const ids = extractThreadIdsFromText(text);
    const role = classifyCeoFlowRole(text);
    if (role === "reviewer") current.reviewerThreadIds.push(...ids);
    if (role === "worker") current.workerThreadIds.push(...ids);
    if (role === "ceo" && ids.length > 0) {
      current.ceoThreadIds.push(ids[0]);
      current.ownerThreadId ||= ids[0];
    }
  }
  return Array.from(map.values()).map((record) => {
    const completion = inferProjectCompletion(Array.from(record.artifactTypes));
    const normalized = {
      ...record,
      completion,
      completionPercent: completionPercentForStage(completion),
      ceoThreadIds: uniqCompact(record.ceoThreadIds, 20),
      workerThreadIds: uniqCompact(record.workerThreadIds, 30),
      reviewerThreadIds: uniqCompact(record.reviewerThreadIds, 30),
      sourceRefs: record.sourceRefs.slice(0, 8),
    };
    normalized.status = inferProjectRecordStatus(normalized);
    normalized.lastSummary ||= `${normalized.documentCount} 个文档，${normalized.codexCount} 个 Codex 产物。`;
    delete normalized.artifactTypes;
    return applyProjectRecordOverride(normalized, projectRecordOverrides[normalized.rootPath]);
  });
}

function buildCEOFlowRecords(projectRecords = buildProjectRecords()) {
  const records = new Map();
  const sources = [
    ...listKnowledgeItems(null, { limit: 600 }).map((item) => ({ kind: "knowledge_item", item })),
    ...listExperienceCards(null, { includeGlobal: true, limit: 500 }).map((item) => ({ kind: "experience_card", item })),
  ];
  for (const project of projectRecords) {
    if (project.ceoThreadIds.length > 0 || /CEO|orchestrator|维护/i.test(project.lastSummary)) {
      const ceoThreadId = project.ceoThreadIds[0] || `project-${project.id}`;
      records.set(ceoThreadId, {
        id: stableShortId("ceo-flow", `${ceoThreadId}:${project.rootPath}`),
        kind: "ceo_flow_record",
        ceoThreadId,
        title: project.ceoThreadIds[0] ? `CEO Flow: ${project.name}` : `项目 CEO Flow 候选: ${project.name}`,
        scope: "project",
        projectIds: [project.id],
        workspacePaths: [project.rootPath],
        childThreadIds: [],
        hotThreadIds: project.ceoThreadIds.slice(0, 6),
        workerThreadIds: project.workerThreadIds,
        reviewerThreadIds: project.reviewerThreadIds,
        memoryThreadIds: [],
        latestDecisionIds: [],
        latestAcceptanceIds: [],
        handoffIds: [],
        resumePacketIds: [],
        vaultPointers: [],
        lastActivityAt: project.lastActivityAt,
        lastSummary: project.lastSummary,
        nextAction: project.nextAction,
        archiveState: project.status === "paused" ? "warm" : "hot",
        sourceRefs: project.sourceRefs.slice(0, 6),
      });
    }
  }
  for (const source of sources) {
    const item = source.item;
    const text = `${item.title} ${item.summary || ""} ${item.body || ""} ${safeArray(item.tags).join(" ")} ${item.sourcePath || ""}`;
    if (!textLooksLikeCeoFlow(text)) continue;
    const ids = extractThreadIdsFromText(text);
    const project = projectRecords.find((record) => record.rootPath && item.projectPath === record.rootPath) || null;
    const ceoThreadId = ids[0] || project?.ceoThreadIds?.[0] || stableShortId("ceo-candidate", `${item.projectPath || "global"}:${item.title}`);
    const current = records.get(ceoThreadId) || {
      id: stableShortId("ceo-flow", `${ceoThreadId}:${item.projectPath || "global"}`),
      kind: "ceo_flow_record",
      ceoThreadId,
      title: `CEO Flow: ${compactText(item.title, 80)}`,
      scope: item.projectPath ? "project" : "global",
      projectIds: project ? [project.id] : [],
      workspacePaths: item.projectPath ? [item.projectPath] : [],
      childThreadIds: [],
      hotThreadIds: [],
      workerThreadIds: [],
      reviewerThreadIds: [],
      memoryThreadIds: [],
      latestDecisionIds: [],
      latestAcceptanceIds: [],
      handoffIds: [],
      resumePacketIds: [],
      vaultPointers: [],
      lastActivityAt: item.updatedAt,
      lastSummary: compactText(item.summary || item.body || item.title, 220),
      nextAction: "按 CEO flow 族谱读取相关任务、验收、handoff 和热/温摘要。",
      archiveState: "warm",
      sourceRefs: [],
    };
    const role = classifyCeoFlowRole(text);
    const childIds = ids.slice(1);
    if (role === "worker") current.workerThreadIds.push(...childIds, ...ids);
    if (role === "reviewer") current.reviewerThreadIds.push(...childIds, ...ids);
    if (role === "memory") current.memoryThreadIds.push(...childIds, ...ids);
    current.childThreadIds.push(...childIds);
    if (/decision|决策/i.test(text)) current.latestDecisionIds.push(item.id);
    if (/accept|验收|review/i.test(text)) current.latestAcceptanceIds.push(item.id);
    if (/handoff|交接/i.test(text)) current.handoffIds.push(item.id);
    if (/codex-history:|Thread History Vault|vault/i.test(text)) current.vaultPointers.push(item.id);
    if (item.updatedAt && new Date(item.updatedAt).getTime() > new Date(current.lastActivityAt || 0).getTime()) {
      current.lastActivityAt = item.updatedAt;
      current.lastSummary = compactText(item.summary || item.body || item.title, 220);
    }
    current.sourceRefs.push(
      buildSourceRef({
        kind: source.kind,
        path: item.sourcePath || item.projectPath,
        title: item.title,
        hash: item.sourceHash || null,
        updatedAt: item.updatedAt,
      }),
    );
    records.set(ceoThreadId, current);
  }
  return Array.from(records.values()).map((record) => ({
    ...record,
    projectIds: uniqCompact(record.projectIds, 20),
    workspacePaths: uniqCompact(record.workspacePaths, 20),
    childThreadIds: uniqCompact(record.childThreadIds, 40),
    hotThreadIds: uniqCompact(record.hotThreadIds, 20),
    workerThreadIds: uniqCompact(record.workerThreadIds, 40),
    reviewerThreadIds: uniqCompact(record.reviewerThreadIds, 40),
    memoryThreadIds: uniqCompact(record.memoryThreadIds, 30),
    latestDecisionIds: uniqCompact(record.latestDecisionIds, 20),
    latestAcceptanceIds: uniqCompact(record.latestAcceptanceIds, 20),
    handoffIds: uniqCompact(record.handoffIds, 20),
    resumePacketIds: uniqCompact(record.resumePacketIds, 20),
    vaultPointers: uniqCompact(record.vaultPointers, 20),
    sourceRefs: record.sourceRefs.slice(0, 8),
  }));
}

function scoreTokens(tokens, fields) {
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const token of tokens) {
    for (const field of fields) {
      const value = cleanText(String(field.text || "")).toLowerCase();
      if (!value) continue;
      if (value === token) {
        score += field.exactWeight || field.weight * 2;
      } else if (value.includes(token)) {
        score += field.weight;
      }
    }
  }
  return score;
}

function makeAgentRetrieveProjectRecord(record, options) {
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && record.rootPath === options.projectPath;
  const governanceReviewState = record.governance?.reviewState || null;
  const governanceStatus = record.governance?.status || null;
  const confirmationIsStale = governanceReviewState === "stale";
  const body = [
    record.name,
    record.rootPath,
    record.lastSummary,
    record.nextAction,
    record.status,
    record.completion,
    record.aliases.join(" "),
  ].join(" ");
  const freshness = confirmationIsStale
    ? "review"
    : record.humanConfirmedAt
      ? "fresh"
      : record.status === "waiting_review"
        ? "review"
        : record.status === "paused"
          ? "review"
          : "fresh";
  return {
    id: record.id,
    kind: "project_record",
    title: `ProjectRecord: ${record.name}`,
    excerpt: compactText(
      `${record.status} / ${record.completion} / ${record.completionPercent}%. ${record.lastSummary} 下一步：${record.nextAction}`,
      AGENT_RETRIEVE_ITEM_EXCERPT_CHARS,
    ),
    sourcePath: record.rootPath,
    sourceRefs: record.sourceRefs.slice(0, 6),
    status: record.status,
    freshness,
    score:
      scoreTokens(tokens, [
        { text: record.name, weight: 18, exactWeight: 32 },
        { text: record.rootPath, weight: 10 },
        { text: body, weight: 7 },
      ]) +
      (projectMatch ? 35 : 0) +
      26,
    tokenEstimate: estimateAgentTokens(`${record.name} ${record.lastSummary} ${record.nextAction}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "project", text: record.name },
      { label: "path", text: record.rootPath },
      { label: "summary", text: record.lastSummary },
    ], [
      projectMatch ? "projectPath:exact" : "projectRecord:first-layer",
      `status:${record.status}`,
      `completion:${record.completion}`,
      ...(governanceReviewState ? [`governance:${governanceStatus || "heuristic"}/${governanceReviewState}`] : []),
    ]),
    requiresHumanConfirmation: confirmationIsStale || (!record.humanConfirmedAt && freshness !== "fresh"),
    _sortUpdatedAt: record.lastActivityAt,
  };
}

function makeAgentRetrieveProjectResumePacket(record, options) {
  const packet = buildProjectResumePacket(record);
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && record.rootPath === options.projectPath;
  return {
    id: packet.id,
    kind: "project_resume_packet",
    title: `Resume Packet: ${packet.project}`,
    excerpt: compactText(packet.summary, AGENT_RETRIEVE_ITEM_EXCERPT_CHARS),
    sourcePath: record.rootPath,
    sourceRefs: packet.sourceRefs,
    status: packet.status,
    freshness: packet.freshness,
    score:
      scoreTokens(tokens, [
        { text: packet.project, weight: 18, exactWeight: 32 },
        { text: record.rootPath, weight: 10 },
        { text: packet.markdown, weight: 8 },
      ]) +
      (projectMatch ? 38 : 0) +
      30,
    tokenEstimate: estimateAgentTokens(packet.markdown),
    whyMatched: whyMatchedForText(tokens, [
      { label: "project", text: packet.project },
      { label: "resume", text: packet.markdown },
      { label: "path", text: record.rootPath },
    ], [
      projectMatch ? "projectPath:exact" : "resumePacket:first-layer",
      `status:${packet.status}`,
      `completion:${packet.completion}`,
      "heuristic:requires-canonical-review",
    ].filter(Boolean)),
    requiresHumanConfirmation: packet.requiresHumanConfirmation,
    _sortUpdatedAt: record.lastActivityAt,
  };
}

function makeAgentRetrieveCEOFlowRecord(record, options) {
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && record.workspacePaths.includes(options.projectPath);
  const ceoMatch = options.parentCeoThreadId && record.ceoThreadId === options.parentCeoThreadId;
  const relationshipText = [
    record.title,
    record.ceoThreadId,
    record.workspacePaths.join(" "),
    record.childThreadIds.join(" "),
    record.workerThreadIds.join(" "),
    record.reviewerThreadIds.join(" "),
    record.memoryThreadIds.join(" "),
    record.latestDecisionIds.join(" "),
    record.latestAcceptanceIds.join(" "),
    record.handoffIds.join(" "),
    record.vaultPointers.join(" "),
    record.lastSummary,
  ].join(" ");
  const freshness = record.archiveState === "hot" ? "fresh" : record.archiveState === "warm" ? "review" : "stale";
  return {
    id: record.id,
    kind: "ceo_flow_record",
    title: record.title,
    excerpt: compactText(
      `${record.scope} / ${record.archiveState}. 子线程 ${record.childThreadIds.length}，worker ${record.workerThreadIds.length}，reviewer ${record.reviewerThreadIds.length}，handoff ${record.handoffIds.length}。${record.lastSummary}`,
      AGENT_RETRIEVE_ITEM_EXCERPT_CHARS,
    ),
    sourcePath: record.workspacePaths[0] || record.sourceRefs[0]?.path || "ceo-flow",
    sourceRefs: record.sourceRefs.slice(0, 6),
    status: record.archiveState,
    freshness,
    score:
      scoreTokens(tokens, [
        { text: record.title, weight: 20, exactWeight: 36 },
        { text: record.ceoThreadId, weight: 18, exactWeight: 34 },
        { text: relationshipText, weight: 8 },
      ]) +
      (projectMatch ? 28 : 0) +
      (ceoMatch ? 45 : 0) +
      24,
    tokenEstimate: estimateAgentTokens(`${record.title} ${record.lastSummary} ${record.nextAction}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "ceo", text: record.title },
      { label: "ceoThreadId", text: record.ceoThreadId },
      { label: "lineage", text: relationshipText },
    ], [
      ceoMatch ? "parentCeoThreadId:exact" : "ceoFlow:first-layer",
      projectMatch ? "projectPath:exact" : "",
      `archiveState:${record.archiveState}`,
    ].filter(Boolean)),
    requiresHumanConfirmation: freshness !== "fresh",
    _sortUpdatedAt: record.lastActivityAt,
  };
}

function buildThreadLineageIndexRecord(record) {
  const relationshipCounts = {
    childThreads: safeArray(record.childThreadIds).length,
    hotThreads: safeArray(record.hotThreadIds).length,
    workers: safeArray(record.workerThreadIds).length,
    reviewers: safeArray(record.reviewerThreadIds).length,
    memoryThreads: safeArray(record.memoryThreadIds).length,
    decisions: safeArray(record.latestDecisionIds).length,
    acceptances: safeArray(record.latestAcceptanceIds).length,
    handoffs: safeArray(record.handoffIds).length,
    vaultPointers: safeArray(record.vaultPointers).length,
  };
  const sourceRefs = safeArray(record.sourceRefs).slice(0, 8);
  const memoryPointers = uniqCompact([
    ...safeArray(record.latestDecisionIds),
    ...safeArray(record.latestAcceptanceIds),
    ...safeArray(record.handoffIds),
    ...safeArray(record.resumePacketIds),
    ...safeArray(record.vaultPointers),
  ], 24);
  const archiveEvidence = normalizeArchiveCandidateEvidence({
    threadId: record.ceoThreadId,
    title: record.title,
    status: record.archiveState === "hot" ? "active" : "idle",
    archiveState: record.archiveState,
    lastActivityAt: record.lastActivityAt,
    projectStatus: record.archiveState === "hot" ? "active" : "paused",
    hasThreadHistoryVault: safeArray(record.vaultPointers).length > 0,
    hasMemoryPointer: memoryPointers.length > 0,
    memoryPointers,
    sourceRefs,
  });
  const archiveCandidate = evaluateArchiveCandidate(archiveEvidence);
  return {
    id: stableShortId("thread-lineage", `${record.ceoThreadId}:${safeArray(record.workspacePaths).join("|") || record.id}`),
    kind: "thread_lineage_index",
    ceoThreadId: record.ceoThreadId,
    title: `ThreadLineageIndex: ${record.title}`,
    scope: record.scope,
    projectIds: safeArray(record.projectIds),
    workspacePaths: safeArray(record.workspacePaths),
    relationships: {
      childThreadIds: safeArray(record.childThreadIds),
      hotThreadIds: safeArray(record.hotThreadIds),
      workerThreadIds: safeArray(record.workerThreadIds),
      reviewerThreadIds: safeArray(record.reviewerThreadIds),
      memoryThreadIds: safeArray(record.memoryThreadIds),
      latestDecisionIds: safeArray(record.latestDecisionIds),
      latestAcceptanceIds: safeArray(record.latestAcceptanceIds),
      handoffIds: safeArray(record.handoffIds),
      resumePacketIds: safeArray(record.resumePacketIds),
      vaultPointers: safeArray(record.vaultPointers),
    },
    relationshipCounts,
    governance: {
      status: "metadata_only_heuristic",
      sourceBacked: sourceRefs.length > 0,
      rawSessionPolicy: "metadata_only_no_raw_body",
      mutationPolicy: "read_only_no_archive_compact_restore_delete",
      archiveCandidate,
    },
    archiveState: record.archiveState,
    lastActivityAt: record.lastActivityAt,
    lastSummary: record.lastSummary,
    nextAction: record.nextAction,
    sourceRefs,
  };
}

function normalizeThreadLineageIndexRecord(record) {
  if (record?.kind === "thread_lineage_index" && record.relationshipCounts && record.governance) return record;
  return buildThreadLineageIndexRecord(record);
}

function threadLineageSourceSignature(index) {
  return hashText(JSON.stringify({
    ceoThreadId: index.ceoThreadId,
    projectIds: safeArray(index.projectIds).sort(),
    workspacePaths: safeArray(index.workspacePaths).sort(),
    relationships: index.relationships || {},
    relationshipCounts: index.relationshipCounts || {},
    archiveState: index.archiveState || "",
    lastActivityAt: index.lastActivityAt || "",
    sourceRefs: safeArray(index.sourceRefs)
      .map((ref) => ({
        kind: ref.kind || "",
        path: ref.path || "",
        title: ref.title || "",
        hash: ref.hash || "",
        updatedAt: ref.updatedAt || "",
      }))
      .sort((a, b) => `${a.kind}:${a.path}:${a.hash}`.localeCompare(`${b.kind}:${b.path}:${b.hash}`)),
  }));
}

function upsertThreadLineageIndexRecord(record) {
  const index = normalizeThreadLineageIndexRecord(record);
  const now = new Date().toISOString();
  const sourceSignature = threadLineageSourceSignature(index);
  const existing = db.exec("SELECT indexedAt FROM thread_lineage_index WHERE id = $id", { $id: index.id });
  const indexedAt = existing[0]?.values?.[0]?.[0] || now;
  db.run(
    `INSERT INTO thread_lineage_index (
      id, ceoThreadId, title, scope, projectIdsJson, workspacePathsJson, relationshipsJson,
      relationshipCountsJson, governanceJson, archiveState, lastActivityAt, lastSummary,
      nextAction, sourceRefsJson, sourceSignature, indexedAt, updatedAt
    ) VALUES (
      $id, $ceoThreadId, $title, $scope, $projectIdsJson, $workspacePathsJson, $relationshipsJson,
      $relationshipCountsJson, $governanceJson, $archiveState, $lastActivityAt, $lastSummary,
      $nextAction, $sourceRefsJson, $sourceSignature, $indexedAt, $updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      ceoThreadId = $ceoThreadId,
      title = $title,
      scope = $scope,
      projectIdsJson = $projectIdsJson,
      workspacePathsJson = $workspacePathsJson,
      relationshipsJson = $relationshipsJson,
      relationshipCountsJson = $relationshipCountsJson,
      governanceJson = $governanceJson,
      archiveState = $archiveState,
      lastActivityAt = $lastActivityAt,
      lastSummary = $lastSummary,
      nextAction = $nextAction,
      sourceRefsJson = $sourceRefsJson,
      sourceSignature = $sourceSignature,
      updatedAt = $updatedAt`,
    {
      $id: index.id,
      $ceoThreadId: index.ceoThreadId,
      $title: index.title,
      $scope: index.scope || "project",
      $projectIdsJson: JSON.stringify(safeArray(index.projectIds)),
      $workspacePathsJson: JSON.stringify(safeArray(index.workspacePaths)),
      $relationshipsJson: JSON.stringify(index.relationships || {}),
      $relationshipCountsJson: JSON.stringify(index.relationshipCounts || {}),
      $governanceJson: JSON.stringify(index.governance || {}),
      $archiveState: index.archiveState || "warm",
      $lastActivityAt: index.lastActivityAt || null,
      $lastSummary: index.lastSummary || "",
      $nextAction: index.nextAction || "",
      $sourceRefsJson: JSON.stringify(safeArray(index.sourceRefs)),
      $sourceSignature: sourceSignature,
      $indexedAt: indexedAt,
      $updatedAt: now,
    },
  );
  return { ...index, sourceSignature, indexedAt, updatedAt: now };
}

function rowToThreadLineageIndexRecord(row) {
  return {
    id: row[0],
    kind: "thread_lineage_index",
    ceoThreadId: row[1],
    title: row[2],
    scope: row[3],
    projectIds: safeJsonParseValue(row[4], []),
    workspacePaths: safeJsonParseValue(row[5], []),
    relationships: safeJsonParseValue(row[6], {}),
    relationshipCounts: safeJsonParseValue(row[7], {}),
    governance: safeJsonParseValue(row[8], {}),
    archiveState: row[9],
    lastActivityAt: row[10],
    lastSummary: row[11],
    nextAction: row[12],
    sourceRefs: safeJsonParseValue(row[13], []),
    sourceSignature: row[14],
    indexedAt: row[15],
    updatedAt: row[16],
    persisted: true,
  };
}

function listThreadLineageIndexRecords(options = {}) {
  const params = {};
  const filters = [];
  if (options.parentCeoThreadId) {
    params.$parentCeoThreadId = options.parentCeoThreadId;
    filters.push("ceoThreadId = $parentCeoThreadId");
  }
  const limit = Math.max(1, Math.min(Number(options.limit || 120), 300));
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = db.exec(
    `SELECT id, ceoThreadId, title, scope, projectIdsJson, workspacePathsJson, relationshipsJson,
            relationshipCountsJson, governanceJson, archiveState, lastActivityAt, lastSummary,
            nextAction, sourceRefsJson, sourceSignature, indexedAt, updatedAt
     FROM thread_lineage_index
     ${where}
     ORDER BY updatedAt DESC
     LIMIT ${limit}`,
    params,
  );
  return (result[0]?.values || [])
    .map(rowToThreadLineageIndexRecord)
    .filter((record) => !options.projectPath || safeArray(record.workspacePaths).includes(options.projectPath));
}

function refreshThreadLineageIndex(projectRecords = buildProjectRecords()) {
  const ceoFlowRecords = buildCEOFlowRecords(projectRecords);
  const activeIds = new Set();
  const upserted = [];
  for (const record of ceoFlowRecords) {
    const next = upsertThreadLineageIndexRecord(buildThreadLineageIndexRecord(record));
    activeIds.add(next.id);
    upserted.push(next);
  }
  if (activeIds.size > 0) {
    const placeholders = Array.from(activeIds).map((_, index) => `$id${index}`);
    const params = {};
    Array.from(activeIds).forEach((id, index) => {
      params[`$id${index}`] = id;
    });
    db.run(`DELETE FROM thread_lineage_index WHERE id NOT IN (${placeholders.join(", ")})`, params);
  }
  return upserted;
}

function buildThreadLineageIndexCacheState() {
  return db.exec("SELECT COUNT(*), MAX(updatedAt) FROM thread_lineage_index")[0]?.values?.[0] || [0, ""];
}

function makeAgentRetrieveThreadLineageIndex(record, options) {
  const index = normalizeThreadLineageIndexRecord(record);
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && index.workspacePaths.includes(options.projectPath);
  const ceoMatch = options.parentCeoThreadId && index.ceoThreadId === options.parentCeoThreadId;
  const relationshipText = [
    index.title,
    index.ceoThreadId,
    index.workspacePaths.join(" "),
    index.relationships.childThreadIds.join(" "),
    index.relationships.workerThreadIds.join(" "),
    index.relationships.reviewerThreadIds.join(" "),
    index.relationships.latestDecisionIds.join(" "),
    index.relationships.latestAcceptanceIds.join(" "),
    index.relationships.handoffIds.join(" "),
    index.relationships.vaultPointers.join(" "),
    index.lastSummary,
  ].join(" ");
  const archiveCandidate = index.governance.archiveCandidate;
  const freshness = archiveCandidate.isCandidate ? "review" : index.archiveState === "cold" || index.archiveState === "archived" ? "stale" : "review";
  return {
    id: index.id,
    kind: "thread_lineage_index",
    title: index.title,
    excerpt: compactText(
      `${index.governance.status}; ${index.governance.rawSessionPolicy}; ${index.governance.mutationPolicy}. child=${index.relationshipCounts.childThreads}, worker=${index.relationshipCounts.workers}, reviewer=${index.relationshipCounts.reviewers}, handoff=${index.relationshipCounts.handoffs}, archive=${archiveCandidate.archiveState} blockers=${archiveCandidate.blockers.join(",") || "none"}. ${index.lastSummary}`,
      AGENT_RETRIEVE_ITEM_EXCERPT_CHARS,
    ),
    sourcePath: index.workspacePaths[0] || index.sourceRefs[0]?.path || "thread-lineage-index",
    sourceRefs: index.sourceRefs.slice(0, 6),
    status: archiveCandidate.archiveState,
    freshness,
    score:
      scoreTokens(tokens, [
        { text: index.title, weight: 20, exactWeight: 36 },
        { text: index.ceoThreadId, weight: 18, exactWeight: 34 },
        { text: relationshipText, weight: 9 },
      ]) +
      (projectMatch ? 32 : 0) +
      (ceoMatch ? 52 : 0) +
      28,
    tokenEstimate: estimateAgentTokens(`${index.title} ${index.lastSummary} ${index.nextAction}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "lineage", text: index.title },
      { label: "ceoThreadId", text: index.ceoThreadId },
      { label: "relationships", text: relationshipText },
    ], [
      ceoMatch ? "parentCeoThreadId:exact" : "threadLineageIndex:first-layer",
      projectMatch ? "projectPath:exact" : "",
      `archiveCandidate:${archiveCandidate.archiveState}`,
      index.persisted ? "persistence:sqlite-thread-lineage-index" : "persistence:runtime-metadata-fallback",
      "policy:metadata-only-no-raw-session",
      "policy:no-archive-compact-restore-delete",
    ].filter(Boolean)),
    requiresHumanConfirmation: true,
    rawSessionPolicy: index.governance.rawSessionPolicy,
    _sortUpdatedAt: index.lastActivityAt,
  };
}

function makeAgentRetrieveProjectArtifact(artifact, options) {
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && artifact.projectPath === options.projectPath;
  const relationshipText = [
    artifact.title,
    artifact.path,
    artifact.artifactType,
    artifact.producedBy,
    artifact.producerThreadId,
    artifact.summary,
  ].join(" ");
  return {
    id: artifact.id,
    kind: "project_artifact",
    title: `ProjectArtifact: ${artifact.title}`,
    excerpt: compactText(
      `${artifact.status} / ${artifact.artifactType} / producedBy:${artifact.producedBy}. ${artifact.summary}`,
      AGENT_RETRIEVE_ITEM_EXCERPT_CHARS,
    ),
    sourcePath: artifact.path,
    sourceRefs: artifact.sourceRefs.slice(0, 6),
    status: artifact.status,
    freshness: artifact.freshness,
    score:
      scoreTokens(tokens, [
        { text: artifact.title, weight: 17, exactWeight: 30 },
        { text: artifact.path, weight: 8 },
        { text: artifact.summary, weight: 7 },
        { text: relationshipText, weight: 6 },
      ]) +
      artifactPriorityScore(artifact.artifactType) +
      scoreStatusPriority(artifact.status) +
      (projectMatch ? 24 : 0) +
      (artifact.status === "current" ? 12 : artifact.status === "superseded" ? -14 : -4),
    tokenEstimate: estimateAgentTokens(`${artifact.title} ${artifact.summary} ${artifact.reasons.join(" ")}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "title", text: artifact.title },
      { label: "path", text: artifact.path },
      { label: "summary", text: artifact.summary },
      { label: "producer", text: `${artifact.producedBy} ${artifact.producerThreadId || ""}` },
    ], [
      projectMatch ? "projectPath:exact" : "projectArtifact:metadata-only",
      `artifact:${artifact.artifactType}`,
      `status:${artifact.status}`,
      `producedBy:${artifact.producedBy}`,
      ...safeArray(artifact.reasons).slice(0, 4),
    ].filter(Boolean)),
    requiresHumanConfirmation: artifact.requiresHumanConfirmation,
    _sortUpdatedAt: artifact.updatedAt,
  };
}

function makeAgentRetrieveDocument(doc, options) {
  const excerpt = compactText(doc.summary || doc.contentText || doc.parseError || doc.filePath || "", AGENT_RETRIEVE_ITEM_EXCERPT_CHARS);
  const freshness = inferDocumentRetrieveFreshness(doc);
  const status = freshness === "fresh" ? "active" : doc.parseStatus === "failed" ? "failed" : "review";
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && doc.workspacePath === options.projectPath;
  const score =
    scoreTokens(tokens, [
      { text: doc.title, weight: 16, exactWeight: 28 },
      { text: doc.fileName, weight: 12, exactWeight: 20 },
      { text: doc.summary, weight: 8 },
      { text: doc.contentText, weight: 5 },
      { text: doc.tags.join(" "), weight: 9 },
      { text: doc.filePath, weight: 6 },
    ]) +
    artifactPriorityScore(doc.artifactType || "other") +
    scoreStatusPriority(status) +
    (projectMatch ? 20 : 0) +
    (["codex_context", "codex_output"].includes(doc.sourceType || "") ? 4 : 0) -
    (freshness === "stale" ? 18 : freshness === "review" ? 8 : 0);
  return {
    id: doc.id,
    kind: "document",
    title: doc.title,
    excerpt,
    sourcePath: doc.filePath,
    sourceRefs: [
      buildSourceRef({
        kind: "document",
        path: doc.filePath,
        title: doc.title,
        hash: doc.contentHash,
        updatedAt: doc.updatedAt,
      }),
    ],
    status,
    freshness,
    score,
    tokenEstimate: estimateAgentTokens(`${doc.title} ${excerpt}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "title", text: doc.title },
      { label: "summary", text: doc.summary },
      { label: "content", text: doc.contentText },
      { label: "tags", text: doc.tags.join(" ") },
      { label: "path", text: doc.filePath },
    ], [
      projectMatch ? "projectPath:exact" : "",
      `artifact:${doc.artifactType || "other"}`,
      `freshness:${freshness}`,
    ].filter(Boolean)),
    requiresHumanConfirmation: freshness !== "fresh",
    _sortUpdatedAt: doc.updatedAt,
  };
}

function makeAgentRetrieveKnowledgeItem(item, options) {
  const excerpt = compactText(item.summary || item.body || item.title, AGENT_RETRIEVE_ITEM_EXCERPT_CHARS);
  const freshness = inferKnowledgeRetrieveFreshness(item);
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && item.projectPath === options.projectPath;
  return {
    id: item.id,
    kind: "knowledge_item",
    title: item.title,
    excerpt,
    sourcePath: item.sourcePath || item.projectPath || "knowledge-item",
    sourceRefs: [
      buildSourceRef({
        kind: "knowledge_item",
        path: item.sourcePath || item.projectPath,
        title: item.title,
        hash: item.sourceHash,
        updatedAt: item.updatedAt,
      }),
    ],
    status: item.status,
    freshness,
    score:
      scoreTokens(tokens, [
        { text: item.title, weight: 16, exactWeight: 28 },
        { text: item.summary, weight: 8 },
        { text: item.body, weight: 6 },
        { text: item.tags.join(" "), weight: 10 },
        { text: item.sourcePath, weight: 4 },
      ]) +
      scoreStatusPriority(item.status) +
      (projectMatch ? 20 : 0) +
      (item.category === "architecture" || item.category === "process" ? 8 : 4) -
      (freshness === "stale" ? 16 : freshness === "review" ? 7 : 0),
    tokenEstimate: estimateAgentTokens(`${item.title} ${excerpt}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "title", text: item.title },
      { label: "summary", text: item.summary },
      { label: "body", text: item.body },
      { label: "tags", text: item.tags.join(" ") },
      { label: "source", text: item.sourcePath },
    ], [
      projectMatch ? "projectPath:exact" : "",
      `category:${item.category}`,
      `freshness:${freshness}`,
    ].filter(Boolean)),
    requiresHumanConfirmation: freshness !== "fresh",
    _sortUpdatedAt: item.updatedAt,
  };
}

function makeAgentRetrieveExperienceCard(card, options) {
  const excerpt = compactText(card.summary || card.body || card.title, AGENT_RETRIEVE_ITEM_EXCERPT_CHARS);
  const freshness = inferExperienceRetrieveFreshness(card);
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && card.projectPath === options.projectPath;
  const sourceRefs = Array.isArray(card.sourceRefs) && card.sourceRefs.length > 0
    ? card.sourceRefs
    : [
      buildSourceRef({
        kind: "experience_card",
        path: card.sourcePath || card.projectPath,
        title: card.title,
        hash: card.sourceHash,
        updatedAt: card.updatedAt,
      }),
    ];
  return {
    id: card.id,
    kind: "experience_card",
    title: card.title,
    excerpt,
    sourcePath: card.sourcePath || card.projectPath || "experience-card",
    sourceRefs,
    status: card.status,
    freshness,
    score:
      scoreTokens(tokens, [
        { text: card.title, weight: 16, exactWeight: 28 },
        { text: card.summary, weight: 8 },
        { text: card.body, weight: 7 },
        { text: card.tags.join(" "), weight: 10 },
        { text: card.sourcePath, weight: 4 },
      ]) +
      scoreStatusPriority(card.status) +
      (projectMatch ? 20 : 0) +
      (card.sourceType === "bug_memory" ? 9 : 5) -
      (freshness === "stale" ? 16 : freshness === "review" ? 6 : 0),
    tokenEstimate: Number(card.tokenEstimate || 0) || estimateAgentTokens(`${card.title} ${excerpt}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "title", text: card.title },
      { label: "summary", text: card.summary },
      { label: "body", text: card.body },
      { label: "tags", text: card.tags.join(" ") },
      { label: "source", text: card.sourcePath },
    ], [
      projectMatch ? "projectPath:exact" : "",
      `sourceType:${card.sourceType}`,
      `freshness:${freshness}`,
      card.curationDecision ? `curation:${card.curationDecision}` : "",
      card.sourceSignatureReviewState ? `sourceSignature:${card.sourceSignatureReviewState}` : "",
      card.duplicateState ? `duplicate:${card.duplicateState}` : "",
    ].filter(Boolean)),
    requiresHumanConfirmation: card.requiresHumanConfirmation === true || freshness !== "fresh",
    rawSessionPolicy: card.rawSessionPolicy || null,
    sourceDocumentUpdatedAt: card.sourceDocumentUpdatedAt || null,
    sourceSignatureReviewState: card.sourceSignatureReviewState || null,
    curationDecision: card.curationDecision || null,
    duplicateGroupKey: card.duplicateGroupKey || null,
    duplicateState: card.duplicateState || null,
    duplicateCount: card.duplicateCount || 0,
    suggestedMergeTargetId: card.suggestedMergeTargetId || null,
    _sortUpdatedAt: card.updatedAt,
  };
}

function makeAgentRetrieveSkillCandidate(candidate, options) {
  const evidencePaths = safeArray(candidate.evidence?.sourcePaths).filter(Boolean);
  const excerpt = compactText(candidate.draftSkillMarkdown || candidate.title, AGENT_RETRIEVE_ITEM_EXCERPT_CHARS);
  const freshness = inferSkillRetrieveFreshness(candidate);
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && candidate.projectPath === options.projectPath;
  return {
    id: candidate.id,
    kind: "skill_candidate",
    title: candidate.title,
    excerpt,
    sourcePath: evidencePaths[0] || candidate.projectPath || "skill-candidate",
    sourceRefs: [
      buildSourceRef({
        kind: "skill_candidate",
        path: evidencePaths[0] || candidate.projectPath,
        title: candidate.title,
        updatedAt: candidate.updatedAt,
      }),
      ...evidencePaths.slice(1, 3).map((sourcePath) =>
        buildSourceRef({
          kind: "document",
          path: sourcePath,
          title: candidate.title,
          updatedAt: candidate.updatedAt,
        })),
    ].filter((ref) => ref.path || ref.title),
    status: candidate.status,
    freshness,
    score:
      scoreTokens(tokens, [
        { text: candidate.title, weight: 15, exactWeight: 26 },
        { text: candidate.triggerPatterns.join(" "), weight: 12 },
        { text: candidate.draftSkillMarkdown, weight: 5 },
        { text: evidencePaths.join(" "), weight: 4 },
      ]) +
      scoreStatusPriority(candidate.status) +
      (projectMatch ? 18 : 0) -
      (freshness === "stale" ? 14 : freshness === "review" ? 8 : 0),
    tokenEstimate: estimateAgentTokens(`${candidate.title} ${excerpt}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "title", text: candidate.title },
      { label: "triggers", text: candidate.triggerPatterns.join(" ") },
      { label: "draft", text: candidate.draftSkillMarkdown },
      { label: "evidence", text: evidencePaths.join(" ") },
    ], [
      projectMatch ? "projectPath:exact" : "",
      `status:${candidate.status}`,
      `freshness:${freshness}`,
    ].filter(Boolean)),
    requiresHumanConfirmation: freshness !== "fresh",
    _sortUpdatedAt: candidate.updatedAt,
  };
}

function makeAgentRetrieveToolSkillRecord(record, options) {
  const governance = record.governance || {};
  const governanceStatus = governance.status || "candidate";
  const reviewState = governance.reviewState || "unreviewed";
  const tokens = tokenizeAgentQuery(options.query);
  const projectMatch = options.projectPath && safeArray(record.workspacePaths).includes(options.projectPath);
  const sourceRefs = [
    ...safeArray(record.sourceRefs).slice(0, 4).map((ref) =>
      buildSourceRef({
        kind: "tool_skill_record",
        path: ref.path || record.sourcePath || record.installPath,
        title: ref.title || record.name,
        hash: ref.hash || record.sourceHash,
        updatedAt: ref.updatedAt,
      })),
    buildSourceRef({
      kind: "tool_skill_record",
      path: record.sourcePath || record.installPath || record.projectPath,
      title: record.name,
      hash: record.sourceHash || null,
      updatedAt: governance.reviewedAt || null,
    }),
  ].filter((ref, index, refs) => {
    if (!ref.path && !ref.title) return false;
    return refs.findIndex((item) => item.kind === ref.kind && item.path === ref.path && item.title === ref.title) === index;
  }).slice(0, 6);
  const safeCommandLabels = safeArray(record.safeCommands).slice(0, 4);
  const forbiddenCommandLabels = safeArray(record.forbiddenCommands).slice(0, 6);
  const policyText = "advisory only; no install, enable, execute, active promotion, credential read, or raw-session body read";
  const relationshipText = [
    record.name,
    record.kind,
    record.summary,
    safeArray(record.useCases).join(" "),
    safeArray(record.triggerPatterns).join(" "),
    safeArray(record.riskBoundaries).join(" "),
    safeCommandLabels.join(" "),
    forbiddenCommandLabels.join(" "),
    record.sourcePath,
    governanceStatus,
    reviewState,
  ].join(" ");
  const status = reviewState === "stale" ? "review_needed" : governanceStatus;
  return {
    id: `tool-skill-record:${record.id}`,
    kind: "tool_skill_record",
    title: `ToolSkillRecord: ${record.name}`,
    excerpt: compactText(
      `${status} / ${record.kind} / installed:${record.installed ? "true" : "false"} / reviewState:${reviewState}. ${record.summary} Safe labels: ${safeCommandLabels.join(", ") || "none"}. Forbidden labels: ${forbiddenCommandLabels.join(", ") || "none"}. Policy: ${policyText}.`,
      AGENT_RETRIEVE_ITEM_EXCERPT_CHARS,
    ),
    sourcePath: record.sourcePath || record.installPath || record.projectPath || "tool-skill-record",
    sourceRefs,
    status,
    freshness: "review",
    score:
      scoreTokens(tokens, [
        { text: record.name, weight: 17, exactWeight: 30 },
        { text: record.kind, weight: 10 },
        { text: relationshipText, weight: 7 },
        { text: record.sourcePath, weight: 5 },
      ]) +
      (projectMatch ? 22 : 0) +
      (governanceStatus === "confirmed" && reviewState === "current" ? 10 : 0) -
      (governanceStatus === "rejected" || governanceStatus === "blocked" ? 20 : 0) -
      (reviewState === "stale" ? 12 : 0) +
      12,
    tokenEstimate: estimateAgentTokens(`${record.name} ${record.summary} ${relationshipText}`),
    whyMatched: whyMatchedForText(tokens, [
      { label: "name", text: record.name },
      { label: "summary", text: record.summary },
      { label: "triggers", text: safeArray(record.triggerPatterns).join(" ") },
      { label: "risk", text: safeArray(record.riskBoundaries).join(" ") },
      { label: "source", text: record.sourcePath },
    ], [
      projectMatch ? "projectPath:exact" : "toolSkillRecord:project-scoped",
      `governance:${governanceStatus}/${reviewState}`,
      `snapshotHash:${String(record.snapshotHash || "").slice(0, 16) || "missing"}`,
      governance.recordContextHash ? "recordContextHash:present" : "recordContextHash:missing",
      record.sourceHash ? "sourceHash:present" : "sourceHash:missing",
      "policy:advisory-human-confirmation-required",
      "policy:no-install-enable-execute-or-active-promotion",
      "policy:metadata-only-no-sensitive-or-raw-session-body",
    ].filter(Boolean)),
    requiresHumanConfirmation: true,
    rawSessionPolicy: "metadata_only_no_sensitive_or_raw_session_body",
    _sortUpdatedAt: governance.reviewedAt || record.lastVerifiedAt || null,
  };
}

function buildAgentRetrieveCacheKey(request) {
  const counts = {
    documents: db.exec("SELECT COUNT(*), MAX(updatedAt) FROM documents")[0]?.values?.[0] || [0, ""],
    knowledge: db.exec("SELECT COUNT(*), MAX(updatedAt) FROM knowledge_items")[0]?.values?.[0] || [0, ""],
    experience: db.exec("SELECT COUNT(*), MAX(updatedAt) FROM experience_cards")[0]?.values?.[0] || [0, ""],
    skills: db.exec("SELECT COUNT(*), MAX(updatedAt) FROM skill_candidates")[0]?.values?.[0] || [0, ""],
    toolSkillRecords: request.allowedKinds.has("tool_skill_record")
      ? buildToolSkillInventoryCacheState(request.projectPath)
      : [0, "", ""],
    threadLineageIndex: request.allowedKinds.has("thread_lineage_index")
      ? buildThreadLineageIndexCacheState()
      : [0, ""],
  };
  return buildAgentRetrievePolicyCacheKey(request, counts);
}

function cloneAgentRetrieveResult(result) {
  return JSON.parse(JSON.stringify(result));
}

function retrieveAgentContext(options = {}) {
  const request = normalizeAgentRetrieveRequest(options);
  if (request.allowedKinds.has("thread_lineage_index")) {
    refreshThreadLineageIndex();
  }
  const cacheKey = buildAgentRetrieveCacheKey(request);
  const cached = agentRetrieveCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt <= AGENT_RETRIEVE_CACHE_TTL_MS) {
    return {
      ...cloneAgentRetrieveResult(cached.result),
      cache: {
        hit: true,
        ttlMs: AGENT_RETRIEVE_CACHE_TTL_MS,
      },
    };
  }
  const contractSources = collectAgentRetrieveContractSources(request, {
    buildProjectRecords,
    buildCEOFlowRecords,
    listThreadLineageIndexRecords,
    listDocumentMetas,
    buildProjectArtifacts,
    listKnowledgeItems,
    listExperienceCards,
    listSkillCandidates,
    listToolSkillRecords: listToolSkillRecordsForRetrieval,
  });
  const trimmed = assembleAgentRetrieveContractResult(request, contractSources, {
    makeProjectRecord: makeAgentRetrieveProjectRecord,
    makeProjectResumePacket: makeAgentRetrieveProjectResumePacket,
    makeCEOFlowRecord: makeAgentRetrieveCEOFlowRecord,
    makeThreadLineageIndex: makeAgentRetrieveThreadLineageIndex,
    makeProjectArtifact: (artifact, currentRequest) =>
      makeAgentRetrieveProjectArtifact(artifact, { query: currentRequest.query, projectPath: currentRequest.projectPath }),
    makeDocument: (doc, currentRequest) =>
      makeAgentRetrieveDocument(doc, { query: currentRequest.query, projectPath: currentRequest.projectPath }),
    makeKnowledgeItem: (item, currentRequest) =>
      makeAgentRetrieveKnowledgeItem(item, { query: currentRequest.query, projectPath: currentRequest.projectPath }),
    makeExperienceCard: (card, currentRequest) =>
      makeAgentRetrieveExperienceCard(card, { query: currentRequest.query, projectPath: currentRequest.projectPath }),
    makeSkillCandidate: (candidate, currentRequest) =>
      makeAgentRetrieveSkillCandidate(candidate, { query: currentRequest.query, projectPath: currentRequest.projectPath }),
    makeToolSkillRecord: (record, currentRequest) =>
      makeAgentRetrieveToolSkillRecord(record, { query: currentRequest.query, projectPath: currentRequest.projectPath }),
    overallFreshness,
  });
  const result = {
    provider: "zhixia_local_docs",
    mode: "local_contract",
    queryType: request.queryType,
    query: request.query,
    projectPath: request.projectPath,
    parentCeoThreadId: request.parentCeoThreadId,
    tokenBudget: request.tokenBudget,
    returnedCount: trimmed.items.length,
    tokenEstimate: trimmed.tokenEstimate,
    freshness: overallFreshness(trimmed.items),
    generatedAt: new Date().toISOString(),
    items: trimmed.items,
  };
  agentRetrieveCache.set(cacheKey, { createdAt: Date.now(), result: cloneAgentRetrieveResult(result) });
  return result;
}

function retrieveMemoryRuntimeContext(options = {}) {
  const taskGoal = options.taskGoal || options.task_goal || options.query || "";
  const retrieval = retrieveAgentContext({
    ...options,
    query: taskGoal,
    queryType: options.queryType || "task_dispatch",
    includeKinds: options.allowedKinds || options.includeKinds,
  });
  return buildRuntimeContextPacket(retrieval, {
    ...options,
    taskGoal,
    allowedKinds: options.allowedKinds || options.includeKinds,
  });
}

function retrieveMemoryRuntimePrecedent(options = {}) {
  const retrievalRequest = buildRuntimePrecedentRequest(options);
  const retrieval = retrieveAgentContext(retrievalRequest);
  return buildRuntimePrecedentPacket(retrieval, {
    ...options,
    allowedKinds: retrievalRequest.includeKinds,
  });
}

async function writebackMemoryRuntimeEvidence(packet = {}) {
  return writeEvidenceWriteback(memoryRuntimeRoot(), packet);
}

async function upsertMemoryRuntimeWorkingMemory(record = {}) {
  return upsertWorkingMemoryRecord(memoryRuntimeRoot(), record);
}

async function listMemoryRuntimeWorkingMemory(options = {}) {
  return { records: await listWorkingMemoryRecords(memoryRuntimeRoot(), options) };
}

async function listMemoryRuntimeFlowSkillCandidates(options = {}) {
  return { candidates: await listFlowSkillCandidateRecords(memoryRuntimeRoot(), options) };
}

async function closeMemoryRuntimeWorkingMemory(options = {}) {
  const taskId = String(options.taskId || "").trim();
  if (!taskId) throw new Error("Working memory close requires taskId.");
  const records = await listWorkingMemoryRecords(memoryRuntimeRoot(), { limit: 500 });
  const existing = records.find((record) => record.taskId === taskId);
  if (!existing) throw new Error("Working memory record not found.");
  return upsertWorkingMemoryRecord(memoryRuntimeRoot(), {
    ...existing,
    status: options.status || "accepted",
    nextAction: options.nextAction || existing.nextAction,
  });
}

async function promoteMemoryRuntimeCandidate(candidate = {}) {
  return promoteMemoryCandidate(memoryRuntimeRoot(), candidate);
}

function sanitizeAgentRetrieveErrorMessage(error) {
  return compactText(cleanText(error instanceof Error ? error.message : String(error || "Unknown retrieval error")), 220) || "Unknown retrieval error";
}

function buildAgentRetrieveLogSourceRefs(items) {
  const refs = [];
  const seen = new Set();
  for (const item of items) {
    for (const ref of safeArray(item.sourceRefs)) {
      const key = `${ref.kind}|${ref.path || ""}|${ref.title || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(buildSourceRef(ref));
      if (refs.length >= 12) return refs;
    }
  }
  return refs;
}

function buildAgentRetrieveTopItems(items) {
  return items.slice(0, 5).map((item) => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    freshness: item.freshness,
    status: item.status,
    whyMatched: uniqCompact(item.whyMatched || [], 4),
    tokenEstimate: item.tokenEstimate,
    sourcePath: item.sourcePath,
  }));
}

function appendAgentRetrieveLog(entry) {
  agentRetrieveLogs = [entry, ...agentRetrieveLogs].slice(0, AGENT_RETRIEVE_LOG_LIMIT);
}

function buildAgentRetrieveLogEntry(result, options = {}) {
  return {
    id: crypto.randomUUID(),
    timestamp: result.generatedAt || new Date().toISOString(),
    provider: result.provider || "zhixia_local_docs",
    mode: result.mode || "local_contract",
    queryType: result.queryType || AGENT_RETRIEVE_DEFAULT_QUERY_TYPE,
    query: result.query || "",
    projectPath: result.projectPath || null,
    tokenBudget: result.tokenBudget || AGENT_RETRIEVE_DEFAULT_TOKEN_BUDGET,
    returnedCount: result.returnedCount || 0,
    tokenEstimate: result.tokenEstimate || 0,
    freshness: result.freshness || "fresh",
    status: options.status || "success",
    durationMs: Math.max(0, Math.round(Number(options.durationMs || 0))),
    requiresHumanConfirmationCount: safeArray(result.items).filter((item) => item.requiresHumanConfirmation).length,
    sourceRefs: buildAgentRetrieveLogSourceRefs(result.items || []),
    topItems: buildAgentRetrieveTopItems(result.items || []),
    errorMessage: options.errorMessage || null,
  };
}

function buildAgentRetrieveErrorLogEntry(options = {}) {
  const request = normalizeAgentRetrieveRequest(options.request || {});
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    provider: "zhixia_local_docs",
    mode: "local_contract",
    queryType: request.queryType,
    query: request.query,
    projectPath: request.projectPath,
    tokenBudget: request.tokenBudget,
    returnedCount: 0,
    tokenEstimate: 0,
    freshness: "stale",
    status: options.status || "error",
    durationMs: Math.max(0, Math.round(Number(options.durationMs || 0))),
    requiresHumanConfirmationCount: 0,
    sourceRefs: [],
    topItems: [],
    errorMessage: sanitizeAgentRetrieveErrorMessage(options.errorMessage),
  };
}

function listAgentRetrieveLogs(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 10), AGENT_RETRIEVE_LOG_LIMIT));
  return agentRetrieveLogs.slice(0, limit);
}

function closeFileWatchers() {
  for (const watcher of fileWatchers.values()) {
    try {
      watcher.close();
    } catch {
      // Watchers may already be closed by the OS.
    }
  }
  fileWatchers.clear();
  if (fileWatchDebounceTimer) {
    clearTimeout(fileWatchDebounceTimer);
    fileWatchDebounceTimer = null;
  }
}

function compactWatchRoots(roots) {
  const resolved = Array.from(new Set(roots.filter(Boolean).map((item) => path.resolve(item)))).sort(
    (a, b) => a.length - b.length,
  );
  const compacted = [];
  for (const root of resolved) {
    if (!compacted.some((parent) => isPathInside(parent, root))) {
      compacted.push(root);
    }
  }
  return compacted.slice(0, 80);
}

function watchRootsFromDocuments(docs) {
  const roots = [];
  for (const doc of docs) {
    if (doc.workspacePath) {
      roots.push(doc.workspacePath);
    } else if (doc.filePath) {
      roots.push(path.dirname(doc.filePath));
    }
  }
  return compactWatchRoots(roots);
}

function fileWatchStatus() {
  return {
    enabled: Boolean(getSettings().autoWatchChanges),
    rootCount: fileWatchers.size,
    roots: Array.from(fileWatchers.keys()),
    running: fileWatchRunning,
    lastRunAt: fileWatchLastRun,
    lastSummary: fileWatchLastSummary,
  };
}

function emitWatchUpdate(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("documents:watchUpdate", {
    ...payload,
    settings: sanitizedSettings(getSettings()),
    watchStatus: fileWatchStatus(),
  });
}

async function disableFileWatchAfterFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("Disabling file watcher after database read failure:", message);
  closeFileWatchers();
  fileWatchLastSummary = {
    changed: 0,
    missing: 0,
    reindexed: 0,
    imported: 0,
    errors: 1,
    disabled: true,
  };
  try {
    updateSettings({ autoWatchChanges: false });
    await saveDatabase();
  } catch (saveError) {
    console.warn("Failed to persist file watcher disable flag:", saveError);
  }
}

function changedPathFromWatchReason(reason) {
  const text = String(reason || "");
  const marker = text.indexOf(":");
  if (marker < 0) return null;
  const candidate = text.slice(marker + 1);
  return path.isAbsolute(candidate) ? candidate : null;
}

function watchRootForChangedPath(changedPath) {
  if (!changedPath) return null;
  const normalized = path.normalize(changedPath);
  return Array.from(fileWatchers.keys())
    .filter((root) => normalized === path.normalize(root) || isPathInside(path.normalize(root), normalized))
    .sort((a, b) => b.length - a.length)[0] || null;
}

function scheduleWatchRefresh(reason) {
  let settings = {};
  try {
    settings = getSettings();
  } catch (error) {
    disableFileWatchAfterFailure(error).catch((disableError) => {
      console.warn("Failed to disable file watcher after settings read failure:", disableError);
    });
    emitWatchUpdate({
      phase: "failed",
      reason,
      message: `后台监听已自动关闭：设置读取失败，避免主进程崩溃。${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  if (!settings.autoWatchChanges) return;
  if (fileWatchDebounceTimer) clearTimeout(fileWatchDebounceTimer);
  fileWatchPendingReasons.push(reason);
  fileWatchPendingReasons = fileWatchPendingReasons.slice(-20);
  emitWatchUpdate({
    phase: "pending",
    reason,
    message: "后台监听到文件变化，准备更新索引。",
  });
  fileWatchDebounceTimer = setTimeout(() => {
    const reasons = fileWatchPendingReasons;
    fileWatchPendingReasons = [];
    refreshFromFileWatch(reasons).catch((error) => {
      fileWatchLastSummary = {
        changed: 0,
        missing: 0,
        reindexed: 0,
        imported: 0,
        errors: 1,
      };
      emitWatchUpdate({
        phase: "failed",
        reason,
        message: `后台监听更新失败：${error instanceof Error ? error.message : String(error)}`,
      });
    });
  }, 1200);
}

async function refreshFromFileWatch(reason) {
  if (fileWatchRunning) {
    scheduleWatchRefresh(reason);
    return;
  }
  fileWatchRunning = true;
  try {
    await ensureDatabase();
    const reasons = Array.isArray(reason) ? reason : [reason];
    const changedPaths = reasons.map(changedPathFromWatchReason).filter(Boolean);
    const scopedRoots = Array.from(new Set(changedPaths.map(watchRootForChangedPath).filter(Boolean)));
    const changedPath = changedPaths[0] || null;
    const changeResult = await checkFileChanges({ refreshWatchers: false, rootPaths: scopedRoots, changedPath });
    let imported = [];
    let errors = [...changeResult.errors];
    let scanned = 0;
    const projectSet = new Set();
    const workspaceRoots = Array.from(
      new Set(
        listDocumentMetas()
          .filter((doc) => {
            if (scopedRoots.length === 0 && !changedPath) return false;
            const docPath = path.normalize(doc.filePath || "");
            return (changedPath && docPath === path.normalize(changedPath)) || scopedRoots.some((root) => isPathInside(path.normalize(root), docPath));
          })
          .map((doc) => doc.workspacePath)
          .filter(Boolean),
      ),
    ).slice(0, 2);
    for (const workspacePath of workspaceRoots) {
      try {
        const result = await scanCodexWorkspacePath(workspacePath);
        imported = [...imported, ...result.imported];
        errors = [...errors, ...result.errors];
        scanned += result.scanned;
        for (const project of result.projects || []) projectSet.add(project);
      } catch (error) {
        errors.push({ filePath: workspacePath, message: error instanceof Error ? error.message : String(error) });
      }
    }
    await startFileWatchers({ silent: true });
    fileWatchLastRun = new Date().toISOString();
    fileWatchLastSummary = {
      changed: changeResult.changed,
      missing: changeResult.missing,
      reindexed: changeResult.reindexed.length,
      imported: imported.length,
      errors: errors.length,
      scanned,
      projects: projectSet.size,
    };
    emitWatchUpdate({
      phase: "done",
      reason: reasons.join(", "),
      documents: listDocuments(),
      changed: changeResult.changed,
      missing: changeResult.missing,
      reindexed: changeResult.reindexed.length,
      imported: imported.length,
      errors,
      scanned,
      projects: Array.from(projectSet),
      message: `后台轻量更新完成：${changeResult.changed} 个变化，${changeResult.missing} 个缺失，${imported.length} 个 Codex 文档更新。`,
    });
  } catch (error) {
    await disableFileWatchAfterFailure(error);
    emitWatchUpdate({
      phase: "failed",
      reason,
      message: `后台监听已自动关闭：${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    fileWatchRunning = false;
  }
}

async function startFileWatchers(options = {}) {
  await ensureDatabase();
  closeFileWatchers();
  const settings = getSettings();
  if (settings.autoWatchChanges === false) {
    if (!options.silent) {
      emitWatchUpdate({
        phase: "disabled",
        reason: "settings",
        message: "后台监听已关闭。",
      });
    }
    return fileWatchStatus();
  }

  const roots = watchRootsFromDocuments(listDocumentMetas());
  for (const root of roots) {
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) continue;
      const watcher = fsNative.watch(
        root,
        { recursive: process.platform === "win32" || process.platform === "darwin" },
        (eventType, fileName) => {
          try {
            const name = String(fileName || "");
            if (name.includes(`${path.sep}node_modules${path.sep}`) || name.includes(`${path.sep}.git${path.sep}`)) return;
            scheduleWatchRefresh(`${eventType}:${path.join(root, name)}`);
          } catch (error) {
            disableFileWatchAfterFailure(error).catch((disableError) => {
              console.warn("Failed to disable file watcher after callback failure:", disableError);
            });
          }
        },
      );
      watcher.on("error", () => {
        fileWatchers.delete(root);
      });
      fileWatchers.set(root, watcher);
    } catch {
      // Ignore directories that disappeared between indexing and watcher startup.
    }
  }

  if (!options.silent) {
    emitWatchUpdate({
      phase: "ready",
      reason: "startup",
      message: `后台监听已启动：${fileWatchers.size} 个目录。`,
    });
  }
  return fileWatchStatus();
}

async function runE2EGovernanceProbe(options = {}) {
  if (!E2E_PROBE_ENABLED) {
    throw new Error("E2E probe is disabled.");
  }
  const projectPath = path.resolve(String(options.projectPath || "").trim());
  if (!projectPath || !(await pathExists(projectPath))) {
    throw new Error("A valid projectPath is required for the E2E governance probe.");
  }
  await ensureDatabase();
  updateSettings({ autoWatchChanges: false, autoInstallSkill: false });
  await saveDatabase();

  const candidateDocs = [
    path.join(projectPath, "docs", "CEO_FLOW_HANDOFF.md"),
    path.join(projectPath, "docs", "RELEASE_NOTES.md"),
    path.join(projectPath, "codex-skills", "e2e-review-skill", "SKILL.md"),
  ];
  const existingDocs = [];
  for (const filePath of candidateDocs) {
    if (await pathExists(filePath)) existingDocs.push(filePath);
  }
  const importResult = await importPaths(existingDocs, {
    workspacePath: projectPath,
    sourceType: "codex_output",
    artifactType: "report",
  });
  const memoryFiles = await writeProjectMemoryFiles([projectPath]);
  refreshThreadLineageIndex();

  const inventory = await getToolSkillInventoryForProject(projectPath);
  if (!inventory.records.length) {
    throw new Error("E2E fixture did not produce Tool/Skill inventory records.");
  }
  let staleSnapshotRejected = false;
  try {
    await confirmToolSkillInventorySnapshot({ projectPath, snapshotHash: "stale-e2e-hash" });
  } catch {
    staleSnapshotRejected = true;
  }
  const confirmedInventory = await confirmToolSkillInventorySnapshot({
    projectPath,
    snapshotHash: inventory.snapshotHash,
  });
  const record = confirmedInventory.records[0];
  let staleRecordUpdateRejected = false;
  try {
    await updateToolSkillRecordGovernance({
      projectPath,
      snapshotHash: "stale-e2e-hash",
      recordId: record.id,
      status: "confirmed",
    });
  } catch {
    staleRecordUpdateRejected = true;
  }
  const governedInventory = await updateToolSkillRecordGovernance({
    projectPath,
    snapshotHash: confirmedInventory.snapshotHash,
    recordId: record.id,
    status: "confirmed",
  });
  const governedRecord = governedInventory.records.find((item) => item.id === record.id);
  const clearedInventory = await updateToolSkillRecordGovernance({
    projectPath,
    snapshotHash: governedInventory.snapshotHash,
    recordId: record.id,
    status: "clear",
  });
  const clearedRecord = clearedInventory.records.find((item) => item.id === record.id);

  const retrieved = retrieveAgentContext({
    query: "CEO Flow worker reviewer handoff ThreadLineage archive",
    queryType: "task_dispatch",
    projectPath,
    parentCeoThreadId: "public-thread-id",
    includeKinds: ["thread_lineage_index", "raw_session"],
    tokenBudget: 1200,
    maxResults: 5,
  });
  const lineageItems = safeArray(retrieved.items).filter((item) => item.kind === "thread_lineage_index");
  const retrievalLogs = listAgentRetrieveLogs({ limit: 2 });

  return {
    ok: true,
    storePath: dbPath(),
    projectPath,
    importedCount: importResult.imported.length,
    memoryCardCount: listExperienceCards(projectPath, { includeGlobal: false, limit: 80 }).length,
    memoryFiles,
    inventory: {
      snapshotHash: inventory.snapshotHash,
      recordCount: inventory.records.length,
      confirmationStatus: confirmedInventory.confirmationStatus,
      policy: confirmedInventory.policy,
    },
    staleSnapshotRejected,
    staleRecordUpdateRejected,
    governedRecord: {
      status: governedRecord?.governance?.status || null,
      reviewState: governedRecord?.governance?.reviewState || null,
      recordContextHashPresent: Boolean(governedRecord?.governance?.recordContextHash),
    },
    clearedRecord: {
      status: clearedRecord?.governance?.status || null,
      reviewState: clearedRecord?.governance?.reviewState || null,
    },
    retrieval: {
      returnedCount: retrieved.returnedCount,
      logCount: retrievalLogs.length,
      lineageCount: lineageItems.length,
      persistedLineageCount: listThreadLineageIndexRecords({ projectPath, limit: 20 }).length,
      lineagePolicies: lineageItems.map((item) => ({
        rawSessionPolicy: item.rawSessionPolicy,
        requiresHumanConfirmation: item.requiresHumanConfirmation,
        whyMatched: safeArray(item.whyMatched),
      })),
    },
  };
}

function createWindow() {
  const e2eViewportWidth = Number(process.env.ZHIXIA_E2E_VIEWPORT_WIDTH);
  const e2eViewportHeight = Number(process.env.ZHIXIA_E2E_VIEWPORT_HEIGHT);
  mainWindow = new BrowserWindow({
    width: E2E_PROBE_ENABLED && Number.isFinite(e2eViewportWidth) ? Math.max(980, Math.floor(e2eViewportWidth)) : 1320,
    height: E2E_PROBE_ENABLED && Number.isFinite(e2eViewportHeight) ? Math.max(640, Math.floor(e2eViewportHeight)) : 860,
    show: !E2E_PROBE_ENABLED,
    minWidth: 980,
    minHeight: 640,
    title: "知匣 Local Doc Knowledge",
    icon: path.join(app.getAppPath(), "assets", "icon.ico"),
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    mainWindow.loadURL(devServer);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  if (E2E_PROBE_ENABLED && process.env.ZHIXIA_E2E_RENDERER_SCRIPT) {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow.webContents
        .executeJavaScript(process.env.ZHIXIA_E2E_RENDERER_SCRIPT, true)
        .then((result) => {
          if (result && result.__zhixiaE2EReload === true) return;
          console.log(`ZHIXIA_E2E_RESULT ${JSON.stringify(result)}`);
          app.exit(0);
        })
        .catch((error) => {
          console.error("ZHIXIA_E2E_ERROR", error instanceof Error ? error.stack : String(error));
          app.exit(1);
        });
    });
  }
}

app.whenReady().then(async () => {
  if (process.argv.includes("--install-skill-and-quit")) {
    try {
      await installBundledSkill();
      await ensureDatabase();
      updateSettings({ autoInstallSkill: true });
      await saveDatabase();
      app.exit(0);
    } catch (error) {
      console.error("Codex Skill command-line install failed:", error);
      app.exit(1);
    }
    return;
  }

  await ensureDatabase();
  autoInstallBundledSkillIfEnabled().catch((error) => {
    console.warn("Codex Skill auto-install failed:", error);
  });
  createWindow();
  scheduleStartupAutoIngest();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeFileWatchers();
});

ipcMain.handle("documents:list", async (_event, options = {}) => {
  await ensureDatabase();
  return { documents: listDocuments(options), storePath: dbPath(), settings: sanitizedSettings(getSettings()) };
});

ipcMain.handle("documents:get", async (_event, id) => {
  await ensureDatabase();
  return { document: getDocumentById(id) };
});

ipcMain.handle("documents:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入本地文档",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documents", extensions: SUPPORTED_EXTENSIONS.map((item) => item.replace(".", "")) },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    await ensureDatabase();
    return { imported: [], documents: listDocuments(), errors: [] };
  }

  const imported = await importPaths(result.filePaths);
  await startFileWatchers({ silent: true });
  return imported;
});

ipcMain.handle("documents:importFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "递归导入文件夹",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    await ensureDatabase();
    return { imported: [], documents: listDocuments(), errors: [], scanned: 0 };
  }

  const files = await scanDirectory(result.filePaths[0]);
  const imported = await importPaths(files);
  await startFileWatchers({ silent: true });
  return { ...imported, scanned: files.length };
});

ipcMain.handle("codex:scanWorkspace", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "扫描 Codex 工作区",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    await ensureDatabase();
    return { imported: [], documents: listDocuments(), errors: [], scanned: 0, workspacePath: null };
  }

  const workspacePath = result.filePaths[0];
  const scanResult = await scanCodexWorkspacePath(workspacePath);
  await startFileWatchers({ silent: true });
  return scanResult;
});

ipcMain.handle("codex:exportContext", async (_event, documentId) => exportCodexContext(documentId));

ipcMain.handle("codexGuardian:report", async () => runCodexGuardian("report"));

ipcMain.handle("codexGuardian:cleanLogs", async () => runCodexGuardian("clean-logs"));

ipcMain.handle("codexGuardian:searchHistory", async (_event, options = {}) => runCodexGuardian("search-history", options));

ipcMain.handle("codexGuardian:getThreadContext", async (_event, options = {}) => runCodexGuardian("get-thread-context", options));

ipcMain.handle("codexGuardian:getProjectHistory", async (_event, options = {}) => runCodexGuardian("get-project-history", options));

ipcMain.handle("codexGuardian:listLongThreads", async (_event, options = {}) => listLongCodexThreads(options));

ipcMain.handle("codexGuardian:optimizeThread", async (_event, options = {}) => optimizeCodexThread(options));

ipcMain.handle("codexGuardian:compactThread", async (_event, options = {}) => compactCodexThread(options));

ipcMain.handle("codexGuardian:autoIngestHistory", async (_event, options = {}) => autoIngestCodexThreadHistory(options));

ipcMain.handle("codexGuardian:generateArchiveQueue", async (_event, options = {}) => {
  const queue = await generateCodexArchiveQueue(options);
  return { ok: true, result: queue };
});

ipcMain.handle("runtimeMonitor:getSnapshot", async (_event, options = {}) => getRuntimeMonitorSnapshot(options));

ipcMain.handle("tools:scanInventory", async (_event, projectPath) => getToolSkillInventoryForProject(projectPath));

ipcMain.handle("tools:inventory", async (_event, projectPath) => getToolSkillInventoryForProject(projectPath));

ipcMain.handle("tools:confirmInventory", async (_event, options = {}) => confirmToolSkillInventorySnapshot(options));

ipcMain.handle("tools:updateRecordGovernance", async (_event, options = {}) => updateToolSkillRecordGovernance(options));

ipcMain.handle("documents:reindex", async (_event, id = null) => reindexDocuments(id));

ipcMain.handle("documents:checkChanges", async () => checkFileChanges());

ipcMain.handle("documents:update", async (_event, id, patch) => {
  await ensureDatabase();
  const allowed = {};
  if (typeof patch.title === "string") allowed.title = patch.title;
  if (Array.isArray(patch.tags)) allowed.tagsJson = JSON.stringify(patch.tags);
  if (typeof patch.favorite === "boolean") allowed.favorite = patch.favorite ? 1 : 0;

  const assignments = Object.keys(allowed).map((key) => `${key} = $${key}`);
  if (assignments.length > 0) {
    assignments.push("updatedAt = $updatedAt");
    db.run(`UPDATE documents SET ${assignments.join(", ")} WHERE id = $id`, {
      $id: id,
      $updatedAt: new Date().toISOString(),
      $title: allowed.title,
      $tagsJson: allowed.tagsJson,
      $favorite: allowed.favorite,
    });
    await saveDatabase();
    await startFileWatchers({ silent: true });
  }
  return { documents: listDocuments() };
});

ipcMain.handle("documents:updateContent", async (_event, id, contentText) => updateDocumentContent(id, contentText));

ipcMain.handle("documents:delete", async (_event, id) => {
  await ensureDatabase();
  db.run("DELETE FROM documents WHERE id = $id", { $id: id });
  db.run("UPDATE documents SET duplicateOf = NULL WHERE duplicateOf = $id", { $id: id });
  await saveDatabase();
  await startFileWatchers({ silent: true });
  return { documents: listDocuments() };
});

ipcMain.handle("documents:export", async () => {
  await ensureDatabase();
  const docs = listDocuments();
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出知识库元数据",
    defaultPath: `local-doc-knowledge-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { exported: false };
  const exportable = {
    exportedAt: new Date().toISOString(),
    documentCount: docs.length,
    databasePath: dbPath(),
    documents: docs.map(({ contentText, contentLength, ...meta }) => ({
      ...meta,
      contentLength: contentLength ?? contentText.length,
    })),
  };
  await fs.writeFile(result.filePath, JSON.stringify(exportable, null, 2), "utf8");
  return { exported: true, filePath: result.filePath };
});

ipcMain.handle("settings:update", async (_event, patch) => {
  await ensureDatabase();
  updateSettings(patch);
  await saveDatabase();
  if (Object.prototype.hasOwnProperty.call(patch || {}, "autoWatchChanges")) {
    await startFileWatchers();
  }
  return { settings: sanitizedSettings(getSettings()) };
});

ipcMain.handle("documents:watchStatus", async () => {
  await ensureDatabase();
  return fileWatchStatus();
});

ipcMain.handle("memory:overview", async () => {
  await ensureDatabase();
  return getMemoryOverview();
});

ipcMain.handle("memory:experienceCards", async (_event, projectPath = null) => {
  await ensureDatabase();
  return { cards: listExperienceCards(projectPath, { includeGlobal: Boolean(projectPath), limit: 160 }) };
});

ipcMain.handle("memory:skillCandidates", async (_event, projectPath = null) => {
  await ensureDatabase();
  return { candidates: listSkillCandidates(projectPath, { limit: 120 }) };
});

ipcMain.handle("memory:updateExperienceCardStatus", async (_event, id, status, options = {}) => {
  await ensureDatabase();
  const card = updateExperienceCardStatus(id, status, options);
  await saveDatabase();
  return { ok: true, card, overview: getMemoryOverview() };
});

ipcMain.handle("memory:updateSkillCandidateStatus", async (_event, id, status) => {
  await ensureDatabase();
  const candidate = updateSkillCandidateStatus(id, status);
  await saveDatabase();
  return { ok: true, candidate, overview: getMemoryOverview() };
});

ipcMain.handle("agent:retrieveContext", async (_event, options = {}) => {
  await ensureDatabase();
  const startedAt = Date.now();
  try {
    const result = retrieveAgentContext(options);
    appendAgentRetrieveLog(
      buildAgentRetrieveLogEntry(result, {
        status: "success",
        durationMs: Date.now() - startedAt,
      }),
    );
    return result;
  } catch (error) {
    appendAgentRetrieveLog(
      buildAgentRetrieveErrorLogEntry({
        request: options,
        status: "error",
        durationMs: Date.now() - startedAt,
        errorMessage: error,
      }),
    );
    throw error;
  }
});

ipcMain.handle("memoryRuntime:retrieveContext", async (_event, options = {}) => {
  await ensureDatabase();
  return retrieveMemoryRuntimeContext(options);
});

ipcMain.handle("memoryRuntime:retrievePrecedent", async (_event, options = {}) => {
  await ensureDatabase();
  return retrieveMemoryRuntimePrecedent(options);
});

ipcMain.handle("memoryRuntime:writebackEvidence", async (_event, packet = {}) => writebackMemoryRuntimeEvidence(packet));

ipcMain.handle("memoryRuntime:upsertWorkingMemory", async (_event, record = {}) => upsertMemoryRuntimeWorkingMemory(record));

ipcMain.handle("memoryRuntime:listWorkingMemory", async (_event, options = {}) => listMemoryRuntimeWorkingMemory(options));

ipcMain.handle("memoryRuntime:listFlowSkillCandidates", async (_event, options = {}) => listMemoryRuntimeFlowSkillCandidates(options));

ipcMain.handle("memoryRuntime:closeWorkingMemory", async (_event, options = {}) => closeMemoryRuntimeWorkingMemory(options));

ipcMain.handle("memoryRuntime:promoteMemory", async (_event, candidate = {}) => promoteMemoryRuntimeCandidate(candidate));

ipcMain.handle("agent:listRetrieveLogs", async (_event, options = {}) => {
  await ensureDatabase();
  return { logs: listAgentRetrieveLogs(options) };
});

ipcMain.handle("memory:importAutoflow", async () => importAutoflowExperience());

ipcMain.handle("knowledge:overview", async () => {
  await ensureDatabase();
  return getKnowledgeOverview();
});

ipcMain.handle("knowledge:items", async (_event, projectPath = null, options = {}) => {
  await ensureDatabase();
  return { items: listKnowledgeItems(projectPath, options) };
});

ipcMain.handle("knowledge:generate", async (_event, options = {}) => generateKnowledgeItems(options));

ipcMain.handle("knowledge:testProvider", async () => testAiProviderConnection());

ipcMain.handle("zhixiaSkills:list", async (_event, options = {}) => {
  await ensureDatabase();
  return {
    skills: listZhixiaSkills(),
    receipts: listSkillRunReceipts(options),
  };
});

ipcMain.handle("zhixiaSkills:run", async (_event, options = {}) => runZhixiaSkill(options));

ipcMain.handle("skill:status", async () => getSkillStatus());

ipcMain.handle("skill:install", async () => installBundledSkill());

ipcMain.handle("skill:reveal", async () => {
  const status = await getSkillStatus();
  await fs.mkdir(status.skillsPath, { recursive: true });
  shell.openPath(status.skillsPath);
  return status;
});

ipcMain.handle("store:reveal", async () => {
  await ensureDatabase();
  shell.showItemInFolder(dbPath());
  return { storePath: dbPath() };
});

if (E2E_PROBE_ENABLED) {
  ipcMain.handle("app:e2eProbe", async (_event, options = {}) => runE2EGovernanceProbe(options));
}
