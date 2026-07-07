const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const AUTO_INGEST_SCHEMA_VERSION = "zhixia.codex_thread_auto_ingest.v1";
const CODEX_HISTORY_VAULT_SCHEMA_VERSION = "zhixia.codex_thread_vault.v1";
const DEFAULT_RECENT_WRITE_MINUTES = 60;
const DEFAULT_SESSION_PREFIX_BYTES = 512 * 1024;
const DEFAULT_SESSION_PREFIX_LINES = 240;

function cleanCompactText(value, maxChars = 240) {
  const clean = String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function uniqCompact(items, limit = 16) {
  const seen = new Set();
  const result = [];
  for (const item of items.flat().filter(Boolean).map((value) => cleanCompactText(value, 80))) {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function pathBaseName(value) {
  return String(value || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

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

function collectObjectStrings(value, options = {}) {
  const maxStrings = Math.max(1, Math.min(Number(options.maxStrings || 80), 240));
  const maxDepth = Math.max(1, Math.min(Number(options.maxDepth || 5), 10));
  const strings = [];
  const seen = new Set();
  function visit(next, depth) {
    if (strings.length >= maxStrings || depth > maxDepth || next == null) return;
    if (typeof next === "string") {
      const clean = cleanCompactText(next, 500);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        strings.push(clean);
      }
      return;
    }
    if (typeof next !== "object") return;
    if (Array.isArray(next)) {
      for (const item of next.slice(0, 24)) visit(item, depth + 1);
      return;
    }
    for (const key of Object.keys(next).slice(0, 32)) {
      visit(next[key], depth + 1);
    }
  }
  visit(value, 0);
  return strings;
}

function findDeepStringValue(value, keyPatterns = []) {
  const stack = [{ value, depth: 0 }];
  const patterns = keyPatterns.map((item) => (item instanceof RegExp ? item : new RegExp(`^${String(item)}$`, "i")));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.depth > 6 || current.value == null || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      for (const item of current.value.slice(0, 32)) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    for (const [key, next] of Object.entries(current.value)) {
      if (typeof next === "string" && patterns.some((pattern) => pattern.test(key))) return cleanCompactText(next, 500);
      if (next && typeof next === "object") stack.push({ value: next, depth: current.depth + 1 });
    }
  }
  return "";
}

function collectContentStrings(value) {
  const strings = [];
  const stack = [{ value, key: "", depth: 0 }];
  while (stack.length > 0 && strings.length < 40) {
    const current = stack.pop();
    if (!current || current.depth > 7 || current.value == null) continue;
    if (typeof current.value === "string") {
      if (/^(content|text|input|message|body|value)$/i.test(current.key)) strings.push(cleanCompactText(current.value, 60000));
      continue;
    }
    if (typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      for (const item of current.value.slice(0, 48)) stack.push({ value: item, key: current.key, depth: current.depth + 1 });
      continue;
    }
    for (const [key, next] of Object.entries(current.value).slice(0, 48)) {
      stack.push({ value: next, key, depth: current.depth + 1 });
    }
  }
  return strings.filter(Boolean);
}

function stripInjectedContextFromUserText(value) {
  let text = String(value || "");
  const environmentIndex = text.lastIndexOf("</environment_context>");
  if (environmentIndex >= 0) text = text.slice(environmentIndex + "</environment_context>".length);
  if (/# AGENTS\.md instructions/i.test(text)) {
    const requestIndex = text.search(/(My request for Codex:|我想|帮我|继续|现在|这个|这里|没有搜到|一键|搜索|修复)/);
    if (requestIndex > 0) text = text.slice(requestIndex);
  }
  text = text.replace(/# AGENTS\.md instructions[\s\S]*?<\/INSTRUCTIONS>/i, " ");
  text = text.replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, " ");
  text = text.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ");
  text = text.replace(/\b(response_item|input_text|message|session_meta)\b/gi, " ");
  text = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, " ");
  return cleanCompactText(text, 500);
}

function looksLikeInjectedContextMessage(value) {
  return /# AGENTS\.md instructions|<permissions instructions>|<environment_context>|<app-context>|<skills_instructions>|<plugins_instructions>/i.test(String(value || ""));
}

function extractMessageText(entry) {
  const role = findDeepStringValue(entry, ["role", "authorRole"]);
  const type = findDeepStringValue(entry, ["type", "kind"]);
  const contentStrings = collectContentStrings(entry);
  const strings = (contentStrings.length ? contentStrings : collectObjectStrings(entry, { maxStrings: 24, maxDepth: 5 }))
    .filter((text) => !/^session_meta$|^message$|^user$|^assistant$|^tool$/i.test(text))
    .filter((text) => !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text));
  const text = cleanCompactText(strings.join(" "), 60000);
  return {
    role: role || (/user/i.test(type) ? "user" : ""),
    text: /^user$/i.test(role) || /user/i.test(type) ? stripInjectedContextFromUserText(text) : text,
  };
}

async function readBoundedSessionPrefix(sessionPath, options = {}) {
  const maxBytes = Math.max(4096, Math.min(Number(options.maxPrefixBytes || DEFAULT_SESSION_PREFIX_BYTES), 2 * 1024 * 1024));
  const handle = await fs.open(sessionPath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => null);
  }
}

function extractSearchTermsFromPrefix(prefixText, metadata = {}) {
  const terms = [];
  const projectName = pathBaseName(metadata.projectPath);
  if (projectName) terms.push(projectName);
  if (metadata.cwd && metadata.cwd !== metadata.projectPath) terms.push(pathBaseName(metadata.cwd), metadata.cwd);
  const regexes = [
    /\bCEO\s+Flow\b/gi,
    /\b[A-Z][A-Za-z0-9_-]{2,24}\s+(?:Studio|Project|Engine|Platform|Flow|Runtime)\b/g,
    /[\u4e00-\u9fffA-Za-z0-9_-]{2,24}项目/g,
    /[\u4e00-\u9fffA-Za-z0-9_-]{2,24}记忆/g,
    /[\u4e00-\u9fffA-Za-z0-9_-]{2,24}线程/g,
  ];
  for (const regex of regexes) {
    for (const match of prefixText.matchAll(regex)) terms.push(match[0]);
  }
  return uniqCompact(terms, 18);
}

function inferTitleFromSessionMetadata(threadId, metadata) {
  const terms = metadata.searchTerms || [];
  const namedProject = terms.find((term) => /\b(?:Studio|Project|Engine|Platform|Flow|Runtime)\b/i.test(term));
  const projectName = pathBaseName(metadata.projectPath || metadata.cwd);
  if (namedProject && projectName) return `${namedProject} / ${projectName}`;
  if (namedProject) return namedProject;
  if (projectName && metadata.firstUserMessage) return `${projectName}：${cleanCompactText(metadata.firstUserMessage, 48)}`;
  if (metadata.firstUserMessage) return cleanCompactText(metadata.firstUserMessage, 72);
  return `Codex session ${String(threadId || "").slice(0, 8)}`;
}

function buildAutoIngestSummary(threadId, metadata = {}) {
  const title = metadata.inferredTitle || `Codex session ${String(threadId || "").slice(0, 8)}`;
  const projectName = pathBaseName(metadata.projectPath || metadata.cwd);
  const goal = metadata.firstUserMessage ? cleanCompactText(metadata.firstUserMessage, 140) : "";
  const terms = uniqCompact(metadata.searchTerms || [], 10).join("、");
  return [
    `知匣已保存旧 Codex 线程 ${threadId} 的完整历史到 Thread History Vault。`,
    `标题线索：${title}。`,
    projectName ? `项目线索：${projectName}。` : "",
    goal ? `用户目标：${goal}。` : "",
    terms ? `可搜索关键词：${terms}。` : "",
    "默认只读取热/温层摘要；完整 raw session 仅在明确恢复时读取。",
  ].filter(Boolean).join(" ");
}

async function inferCodexSessionMetadata(sessionPath, options = {}) {
  const prefixText = await readBoundedSessionPrefix(sessionPath, options).catch(() => "");
  const maxLines = Math.max(1, Math.min(Number(options.maxPrefixLines || DEFAULT_SESSION_PREFIX_LINES), 1000));
  const lines = prefixText.split(/\r?\n/).filter(Boolean).slice(0, maxLines);
  const metadata = {
    source: "bounded_session_prefix",
    prefixBytesRead: Buffer.byteLength(prefixText, "utf8"),
    prefixLineCount: lines.length,
    cwd: "",
    projectPath: "",
    forkedFromId: "",
    firstUserMessage: "",
    searchTerms: [],
  };
  const userMessages = [];
  for (const line of lines) {
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!metadata.cwd) metadata.cwd = findDeepStringValue(entry, ["cwd", "workdir", "workspacePath", "workspaceRoot"]);
    if (!metadata.projectPath) metadata.projectPath = findDeepStringValue(entry, ["projectPath", "projectRoot", "workspaceRoot"]);
    if (!metadata.forkedFromId) metadata.forkedFromId = findDeepStringValue(entry, [/forked.*from/i, "forked_from_id", "parentThreadId", "sourceThreadId"]);
    const message = extractMessageText(entry);
    if (/^user$/i.test(message.role) && message.text) userMessages.push(message.text);
  }
  if (!metadata.projectPath && metadata.cwd) metadata.projectPath = metadata.cwd;
  metadata.firstUserMessage = userMessages.find((message) => message && !looksLikeInjectedContextMessage(message)) || userMessages.find(Boolean) || "";
  metadata.searchTerms = extractSearchTermsFromPrefix(prefixText, metadata);
  metadata.inferredTitle = inferTitleFromSessionMetadata(options.threadId, metadata);
  metadata.summary = buildAutoIngestSummary(options.threadId, metadata);
  return metadata;
}

function manifestNeedsMetadataRefresh(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  const title = String(manifest.title || "");
  const firstUserMessage = String(manifest.inferredMetadata?.firstUserMessage || "");
  return (
    !manifest.inferredMetadata ||
    !manifest.projectPath ||
    !Array.isArray(manifest.searchTerms) ||
    manifest.searchTerms.length === 0 ||
    /^Codex session [0-9a-f]{8}$/i.test(title) ||
    /\bresponse_item\b|\binput_text\b|# AGENTS\.md instructions/i.test(title) ||
    /# AGENTS\.md instructions|<INSTRUCTIONS>|<environment_context>/i.test(firstUserMessage)
  );
}

function applySessionMetadataToManifest(manifest, metadata = {}) {
  const threadId = manifest.threadId;
  const title = metadata.inferredTitle || manifest.title || `Codex session ${String(threadId || "").slice(0, 8)}`;
  const projectPath = metadata.projectPath || manifest.projectPath || null;
  const searchTerms = uniqCompact([...(manifest.searchTerms || []), ...(metadata.searchTerms || []), title, projectPath], 24);
  const summary = metadata.summary || buildAutoIngestSummary(threadId, { ...metadata, inferredTitle: title, projectPath, searchTerms });
  const layers = buildAutoIngestLayers({
    threadId,
    title,
    projectPath,
    lastWriteTime: manifest.lastWriteTime,
    vaultManifestPath: manifest.vaultManifestPath || manifest.layers?.cold?.vaultManifestPath,
    vaultSessionPath: manifest.vaultSessionPath || manifest.layers?.cold?.vaultSessionPath,
    sourceSha256: manifest.originalSha256 || manifest.copiedSha256,
    metadata: {
      ...metadata,
      inferredTitle: title,
      projectPath,
      searchTerms,
      summary,
    },
  });
  return {
    ...manifest,
    title,
    projectPath,
    searchTerms,
    summary,
    inferredMetadata: {
      source: metadata.source || "bounded_session_prefix",
      prefixBytesRead: metadata.prefixBytesRead || null,
      prefixLineCount: metadata.prefixLineCount || null,
      cwd: metadata.cwd || "",
      projectPath,
      forkedFromId: metadata.forkedFromId || "",
      firstUserMessage: metadata.firstUserMessage || "",
      searchTerms,
    },
    layers,
  };
}

async function refreshCodexThreadVaultManifestMetadata(manifestPath, options = {}) {
  const manifest = await readJsonFile(manifestPath, null);
  if (!manifest || typeof manifest !== "object") return null;
  const sessionPath = manifest.vaultSessionPath || manifest.layers?.cold?.vaultSessionPath || manifest.sourceSessionPath;
  if (!sessionPath || !(await pathExists(sessionPath))) return manifest;
  const metadata = await inferCodexSessionMetadata(sessionPath, {
    ...options,
    threadId: manifest.threadId,
  });
  const refreshed = applySessionMetadataToManifest(manifest, metadata);
  if (options.write !== false) {
    await fs.writeFile(manifestPath, JSON.stringify(refreshed, null, 2), "utf8");
    const latestPath = path.join(path.dirname(manifestPath), "latest.json");
    if (path.resolve(latestPath) !== path.resolve(manifestPath) && (await pathExists(latestPath))) {
      const latest = await readJsonFile(latestPath, null);
      if (latest?.threadId === refreshed.threadId) {
        await fs.writeFile(latestPath, JSON.stringify({ ...latest, ...refreshed }, null, 2), "utf8");
      }
    }
  }
  return refreshed;
}

function buildAutoIngestLayers({ threadId, title, projectPath, lastWriteTime, vaultManifestPath, vaultSessionPath, sourceSha256, metadata = {} }) {
  const summary = metadata.summary || buildAutoIngestSummary(threadId, { ...metadata, inferredTitle: title, projectPath });
  const searchTerms = uniqCompact(metadata.searchTerms || [], 12).join("、") || "none";
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
      summary: `${summary} Last source write: ${lastWriteTime || "unknown"}. Title: ${title || "unknown"}. ProjectPath: ${projectPath || "unknown"}. SearchTerms: ${searchTerms}.`,
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
    let refreshedLatest = latest;
    if (manifestNeedsMetadataRefresh(latest)) {
      refreshedLatest = await refreshCodexThreadVaultManifestMetadata(latestManifestPath, {
        ...options,
        threadId: file.threadId,
      }).catch(() => latest);
    }
    return {
      action: "already_preserved",
      threadId: file.threadId,
      sourcePath: file.path,
      vaultManifestPath: latestManifestPath,
      vaultSessionPath: refreshedLatest.vaultSessionPath || refreshedLatest.layers?.cold?.vaultSessionPath || null,
      vaultSha256: refreshedLatest.originalSha256,
      preservationState,
      activeLike: isActiveLike,
      memoryPointer: refreshedLatest.memoryPointer || `codex-history:${file.threadId}`,
      metadataRefreshed: refreshedLatest !== latest,
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
  const inferredMetadata = await inferCodexSessionMetadata(file.path, {
    ...options,
    threadId: file.threadId,
  }).catch(() => ({
    source: "bounded_session_prefix_failed",
    searchTerms: [],
    inferredTitle: `Codex session ${file.threadId.slice(0, 8)}`,
  }));
  const layers = buildAutoIngestLayers({
    threadId: file.threadId,
    title: inferredMetadata.inferredTitle || `Codex session ${file.threadId.slice(0, 8)}`,
    projectPath: inferredMetadata.projectPath || null,
    lastWriteTime: file.lastWriteTime,
    vaultManifestPath: versionManifestPath,
    vaultSessionPath,
    sourceSha256: originalSha256,
    metadata: inferredMetadata,
  });
  const manifest = {
    schemaVersion: CODEX_HISTORY_VAULT_SCHEMA_VERSION,
    ingestSchemaVersion: AUTO_INGEST_SCHEMA_VERSION,
    createdAt: latest?.createdAt || new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    threadId: file.threadId,
    title: inferredMetadata.inferredTitle || latest?.title || `Codex session ${file.threadId.slice(0, 8)}`,
    summary: inferredMetadata.summary || "",
    projectPath: inferredMetadata.projectPath || null,
    searchTerms: inferredMetadata.searchTerms || [],
    inferredMetadata,
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
  inferCodexSessionMetadata,
  ingestCodexSessionFile,
  manifestNeedsMetadataRefresh,
  refreshCodexThreadVaultManifestMetadata,
};
