const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const AUTO_INGEST_SCHEMA_VERSION = "zhixia.codex_thread_auto_ingest.v1";
const CODEX_HISTORY_VAULT_SCHEMA_VERSION = "zhixia.codex_thread_vault.v1";
const DEFAULT_RECENT_WRITE_MINUTES = 60;

function safeVaultName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function extractThreadIdFromSessionPath(filePath) {
  const match = String(filePath || "").match(/rollout-[^\\\/]*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : null;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.readableWebStream()) {
      hash.update(Buffer.from(chunk));
    }
  } finally {
    await handle.close().catch(() => null);
  }
  return hash.digest("hex");
}

function safeIsoFromMs(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function minutesBetween(laterMs, earlierMs) {
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) return null;
  return Math.floor((laterMs - earlierMs) / 60000);
}

function boundedPositiveInteger(value, fallback = Infinity) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function attachCollectionStats(files, stats) {
  Object.defineProperty(files, "collectionStats", {
    value: stats,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return files;
}

function buildAutoIngestLayers({ threadId, title, lastWriteTime, vaultManifestPath, vaultSessionPath, sourceSha256 }) {
  const summary = `Codex session ${threadId} was automatically preserved into Zhixia Thread History Vault from read-only session metadata.`;
  return {
    hot: {
      purpose: "continue_same_thread",
      retrieval: "same_thread_resume_pointer",
      summary,
      nextAction: "Resume with this threadId pointer first; read raw history only under explicit recovery.",
      tokenBudgetHint: 600,
    },
    warm: {
      purpose: "thread_history_pointer",
      retrieval: "same_project_or_keyword_match",
      summary: `${summary} Last source write: ${lastWriteTime || "unknown"}. Title: ${title || "unknown"}.`,
      tokenBudgetHint: 1000,
    },
    cold: {
      purpose: "full_raw_history_evidence",
      retrieval: "explicit_request_only",
      vaultManifestPath,
      vaultSessionPath,
      sourceSessionSha256: sourceSha256,
      rawSessionPolicy: "Do not read by default. Auto ingestion only copies and hashes the source session.",
    },
  };
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeAutoIngestIndex(vaultRoot, record) {
  const indexPath = path.join(vaultRoot, "auto-ingest-index.json");
  const existing = await readJsonFile(indexPath, { schemaVersion: AUTO_INGEST_SCHEMA_VERSION, items: [] });
  const byThread = new Map((Array.isArray(existing.items) ? existing.items : []).map((item) => [item.threadId, item]));
  byThread.set(record.threadId, record);
  const items = Array.from(byThread.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const payload = {
    schemaVersion: AUTO_INGEST_SCHEMA_VERSION,
    updatedAt: record.updatedAt,
    policy: {
      preservationOnly: true,
      mutatesCodexSessionFiles: false,
      archivesCodexThreads: false,
      compactsCodexSessions: false,
    },
    items,
  };
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(payload, null, 2), "utf8");
  return indexPath;
}

async function collectCodexSessionFiles(sessionsRoot, options = {}) {
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(options.limit) || 250)));
  const stopAfterLimit = options.stopAfterLimit === true;
  const maxDirectoryReads = boundedPositiveInteger(options.maxDirectoryReads);
  const maxFileStats = boundedPositiveInteger(options.maxFileStats);
  const root = path.resolve(String(sessionsRoot || ""));
  const files = [];
  const collectionStats = {
    directoryReadCount: 0,
    fileStatCount: 0,
    truncated: false,
    stopReason: null,
  };
  if (!(await pathExists(root))) return attachCollectionStats(files, collectionStats);
  const stack = [root];
  while (stack.length > 0) {
    if (collectionStats.directoryReadCount >= maxDirectoryReads) {
      collectionStats.truncated = true;
      collectionStats.stopReason = "max_directory_reads";
      break;
    }
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
      collectionStats.directoryReadCount += 1;
    } catch {
      continue;
    }
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    const sessionFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .sort((a, b) => b.name.localeCompare(a.name));

    for (const entry of sessionFiles) {
      const fullPath = path.join(current, entry.name);
      const threadId = extractThreadIdFromSessionPath(fullPath);
      if (!threadId) continue;
      if (collectionStats.fileStatCount >= maxFileStats) {
        collectionStats.truncated = true;
        collectionStats.stopReason = "max_file_stats";
        break;
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      collectionStats.fileStatCount += 1;
      if (!stat) continue;
      files.push({
        threadId,
        path: fullPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        lastWriteTime: safeIsoFromMs(stat.mtimeMs),
      });
      if (stopAfterLimit && files.length >= limit) {
        collectionStats.truncated = stack.length > 0 || directories.length > 0 || sessionFiles.length > files.length;
        collectionStats.stopReason = "limit";
        break;
      }
    }
    if (collectionStats.stopReason) break;

    for (const entry of directories) {
      stack.push(path.join(current, entry.name));
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return attachCollectionStats(files.slice(0, limit), collectionStats);
}

function unchangedLatestManifest(latest, file) {
  return Boolean(
    latest &&
      latest.sourceSessionPath === file.path &&
      Number(latest.sizeBytes || 0) === Number(file.sizeBytes || 0) &&
      latest.lastWriteTime === file.lastWriteTime &&
      latest.originalSha256 &&
      latest.copiedSha256 &&
      latest.originalSha256 === latest.copiedSha256,
  );
}

async function ingestCodexSessionFile(file, options = {}) {
  const vaultRoot = path.resolve(String(options.vaultRoot || ""));
  if (!vaultRoot) throw new Error("vaultRoot is required for Codex auto ingestion.");
  const nowMs = Date.parse(String(options.now || "")) || Date.now();
  const recentWriteMinutes = Math.max(1, Number(options.recentWriteMinutes || DEFAULT_RECENT_WRITE_MINUTES));
  const threadDir = path.join(vaultRoot, safeVaultName(file.threadId));
  const latestManifestPath = path.join(threadDir, "latest.json");
  const latest = await readJsonFile(latestManifestPath, null);
  const recentMinutes = minutesBetween(nowMs, file.mtimeMs);
  const isActiveLike = recentMinutes !== null && recentMinutes < recentWriteMinutes;
  const preservationState = isActiveLike ? "preserved_not_archive_ready" : "preserved";

  if (unchangedLatestManifest(latest, file)) {
    return {
      action: "already_preserved",
      threadId: file.threadId,
      sourcePath: file.path,
      vaultManifestPath: latestManifestPath,
      vaultSessionPath: latest.vaultSessionPath || latest.layers?.cold?.vaultSessionPath || null,
      vaultSha256: latest.originalSha256,
      preservationState,
      activeLike: isActiveLike,
      memoryPointer: latest.memoryPointer || `codex-history:${file.threadId}`,
    };
  }

  await fs.mkdir(threadDir, { recursive: true });
  const originalSha256 = await hashFile(file.path);
  const version = originalSha256.slice(0, 16);
  const vaultSessionPath = path.join(threadDir, `session-${version}.jsonl`);
  const versionManifestPath = path.join(threadDir, `vault-${version}.json`);
  let copied = false;
  if (!(await pathExists(vaultSessionPath))) {
    await fs.copyFile(file.path, vaultSessionPath);
    copied = true;
  }
  const copiedSha256 = await hashFile(vaultSessionPath);
  if (copiedSha256 !== originalSha256) {
    throw new Error(`Thread History Vault copy hash mismatch for ${file.threadId}.`);
  }

  const memoryPointer = `codex-history:${file.threadId}`;
  const layers = buildAutoIngestLayers({
    threadId: file.threadId,
    title: `Codex session ${file.threadId.slice(0, 8)}`,
    lastWriteTime: file.lastWriteTime,
    vaultManifestPath: versionManifestPath,
    vaultSessionPath,
    sourceSha256: originalSha256,
  });
  const manifest = {
    schemaVersion: CODEX_HISTORY_VAULT_SCHEMA_VERSION,
    ingestSchemaVersion: AUTO_INGEST_SCHEMA_VERSION,
    createdAt: latest?.createdAt || new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    threadId: file.threadId,
    title: latest?.title || `Codex session ${file.threadId.slice(0, 8)}`,
    sourceSessionPath: file.path,
    vaultSessionPath,
    originalSha256,
    copiedSha256,
    sizeBytes: file.sizeBytes,
    lastWriteTime: file.lastWriteTime,
    status: preservationState,
    archiveState: preservationState,
    memoryPointer,
    hasMemoryPointer: true,
    sourceRefs: [
      { kind: "raw_session", path: file.path, sha256: originalSha256, readByDefault: false },
      { kind: "zhixia_summary", path: versionManifestPath, sha256: originalSha256, readByDefault: true },
    ],
    layers,
    policy: {
      completeHistoryStored: true,
      hotWarmDefaultRetrieval: true,
      coldRawDefaultRead: false,
      preservationOnly: true,
      mutatesCodexSessionFiles: false,
      archivesCodexThreads: false,
      compactsCodexSessions: false,
    },
  };
  await fs.writeFile(versionManifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(latestManifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const pointerPath = path.join(threadDir, "memory-pointer.json");
  const pointer = {
    schemaVersion: "zhixia.codex_thread_memory_pointer.v1",
    threadId: file.threadId,
    id: memoryPointer,
    status: preservationState,
    vaultManifestPath: versionManifestPath,
    vaultSessionPath,
    vaultSha256: originalSha256,
    updatedAt: manifest.updatedAt,
    rawSessionPolicy: "explicit_only",
  };
  await fs.writeFile(pointerPath, JSON.stringify(pointer, null, 2), "utf8");
  const indexPath = await writeAutoIngestIndex(vaultRoot, {
    threadId: file.threadId,
    sourcePath: file.path,
    sizeBytes: file.sizeBytes,
    lastWriteTime: file.lastWriteTime,
    vaultManifestPath: versionManifestPath,
    vaultSessionPath,
    vaultSha256: originalSha256,
    memoryPointer,
    status: preservationState,
    updatedAt: manifest.updatedAt,
  });

  return {
    action: copied ? "preserved" : "refreshed",
    threadId: file.threadId,
    sourcePath: file.path,
    vaultManifestPath: versionManifestPath,
    vaultSessionPath,
    vaultSha256: originalSha256,
    pointerPath,
    indexPath,
    preservationState,
    activeLike: isActiveLike,
    memoryPointer,
  };
}

async function autoIngestCodexSessions(options = {}) {
  const sessionsRoot = options.sessionsRoot || (options.codexHome ? path.join(options.codexHome, "sessions") : null);
  const vaultRoot = options.vaultRoot;
  if (!sessionsRoot) throw new Error("sessionsRoot or codexHome is required for Codex auto ingestion.");
  if (!vaultRoot) throw new Error("vaultRoot is required for Codex auto ingestion.");
  const files = await collectCodexSessionFiles(sessionsRoot, options);
  const results = [];
  const errors = [];
  for (const file of files) {
    try {
      results.push(await ingestCodexSessionFile(file, options));
    } catch (error) {
      errors.push({
        threadId: file.threadId,
        sourcePath: file.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const preserved = results.filter((item) => item.action === "preserved" || item.action === "refreshed");
  const alreadyPreserved = results.filter((item) => item.action === "already_preserved");
  const activePreserved = results.filter((item) => item.activeLike);
  return {
    schemaVersion: AUTO_INGEST_SCHEMA_VERSION,
    generatedAt: new Date(Date.parse(String(options.now || "")) || Date.now()).toISOString(),
    mode: "preservation_only_no_archive_compact_move_delete",
    sourceRoot: sessionsRoot,
    vaultRoot,
    scannedCount: files.length,
    collectionStats: files.collectionStats || null,
    preservedCount: preserved.length,
    alreadyPreservedCount: alreadyPreserved.length,
    activePreservedCount: activePreserved.length,
    errorCount: errors.length,
    results,
    errors,
    safety: {
      mutatesCodexSessionFiles: false,
      archivesCodexThreads: false,
      compactsCodexSessions: false,
      deletesCodexSessionFiles: false,
    },
  };
}

module.exports = {
  AUTO_INGEST_SCHEMA_VERSION,
  CODEX_HISTORY_VAULT_SCHEMA_VERSION,
  autoIngestCodexSessions,
  collectCodexSessionFiles,
  extractThreadIdFromSessionPath,
  ingestCodexSessionFile,
};
