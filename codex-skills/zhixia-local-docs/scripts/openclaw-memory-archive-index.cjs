const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ARCHIVE_SCHEMA_VERSION = "zhixia.openclaw_memory_archive_index.v1";
const PACKET_SCHEMA_VERSION = "zhixia.openclaw_cold_archive_packet.v1";
const MANIFEST_SCHEMA_VERSION = "zhixia.openclaw_memory_vault.v1";
const DEFAULT_INDEX_NAME = "openclaw-memory-audit-index.sqlite";
const MAX_BATCHES = 16;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_READ_BYTES = 32 * 1024 * 1024;
const MAX_CHUNKS_PER_SOURCE = 256;
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 160;
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
const DEFAULT_TOKEN_BUDGET = 1200;
const MAX_TOKEN_BUDGET = 2400;
const MAX_PROVIDER_QUERY_CHARS = 240;
const SAFE_TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".flag"]);
const RAW_ARCHIVE_PATH_RE = /(?:^|[\\/])sessions?(?:[\\/]|$)|\.jsonl$|(?:chat|session)[_-]?(?:backup|full|dump)/i;
const SECRET_PATH_RE = /(?:^|[\\/])(?:\.env|id_rsa|credentials?)(?:$|[.\\/_-])|(?:token|secret|password|cookie|oauth|feishu-config|bot-config)/i;
const SECRET_VALUE_RE = /-----BEGIN[\s\S]{0,240}?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b/gi;
const SECRET_ASSIGNMENT_RE = /\b(api[_ -]?key|auth[_ -]?token|access[_ -]?token|refresh[_ -]?token|token|password|passwd|secret|cookie)\s*[:=]\s*[^\s,;"']+/gi;
const JSON_SECRET_RE = /(["']?)(api[_ -]?key|auth[_ -]?token|access[_ -]?token|refresh[_ -]?token|token|password|passwd|secret|cookie)\1\s*:\s*(["'])[^"'\r\n]{1,512}\3/gi;
const BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{64,}|\b[A-Za-z0-9+/]{180,}={0,2}\b/g;
const FILE_URI_RE = /\bfile:\/\/[^\s"'<>|]+/gi;
const EXTENDED_WINDOWS_PATH_RE = /\\\\[?.]\\(?:UNC\\)?[^\s"'<>|]+/gi;
const UNC_PATH_RE = /\\\\[^\\/\s"'<>|]+[\\/][^\s"'<>|]+/g;
const WINDOWS_DRIVE_PATH_RE = /\b[A-Za-z]:[\\/][^\s"'<>|]+/g;
const POSIX_LOCAL_PATH_RE = /(^|[\s([{=,:;])(?:~\/|\/(?:Users|home|root|tmp)(?:\/|$)|\/(?:var|private)\/tmp(?:\/|$))[^\s"'<>|]*/gim;

function cleanText(value) {
  return String(value || "")
    .replace(SECRET_VALUE_RE, "[secret-omitted]")
    .replace(JSON_SECRET_RE, '"$2":"[secret-omitted]"')
    .replace(SECRET_ASSIGNMENT_RE, "$1=[secret-omitted]")
    .replace(BASE64_RE, "[base64-omitted]")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function compactText(value, maxChars) {
  const cleaned = cleanText(value).replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function estimateSerializedTokens(value) {
  const serialized = JSON.stringify(value);
  let tokenUnits = 0;
  for (const character of serialized) tokenUnits += character.codePointAt(0) <= 0x7f ? 1 : 4;
  return Math.max(1, Math.ceil(tokenUnits / 4));
}

function providerSafeText(value, maxChars) {
  return compactText(value, maxChars)
    .replace(FILE_URI_RE, "[local-path-omitted]")
    .replace(EXTENDED_WINDOWS_PATH_RE, "[local-path-omitted]")
    .replace(UNC_PATH_RE, "[local-path-omitted]")
    .replace(WINDOWS_DRIVE_PATH_RE, "[local-path-omitted]")
    .replace(POSIX_LOCAL_PATH_RE, (_match, prefix) => `${prefix}[local-path-omitted]`)
    .trim();
}

function providerSafeSourceRef(value, sourceId) {
  const sourceRef = compactText(value, 480);
  const sanitized = providerSafeText(sourceRef, 480);
  return sanitized === sourceRef
    ? sanitized
    : `openclaw-vault://source/${sourceId}`;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const bytes = fs.readFileSync(filePath);
  hash.update(bytes);
  return hash.digest("hex");
}

function resolveDefaultVaultRoot(env = process.env, platform = process.platform) {
  if (env.ZHIXIA_OPENCLAW_MEMORY_VAULT) return path.resolve(env.ZHIXIA_OPENCLAW_MEMORY_VAULT);
  const productDir = "\u77e5\u5323 Local Doc Knowledge";
  if (platform === "win32" && env.APPDATA) return path.join(env.APPDATA, productDir, "openclaw-memory-vault");
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", productDir, "openclaw-memory-vault");
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), productDir, "openclaw-memory-vault");
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  return process.platform === "win32"
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

function pathHasSymbolicLink(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isContained(resolvedRoot, resolvedCandidate)) return true;
  if (fs.existsSync(resolvedRoot) && fs.lstatSync(resolvedRoot).isSymbolicLink()) return true;
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function isRealPathContained(root, candidate) {
  const realRoot = fs.realpathSync.native(root);
  const realCandidate = fs.realpathSync.native(candidate);
  return isContained(realRoot, realCandidate);
}

function normalizeRelativePath(value) {
  const normalized = String(value || "").replace(/[\\/]+/g, path.sep);
  if (!normalized || path.isAbsolute(normalized)) return null;
  const segments = normalized.split(path.sep).filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join(path.sep);
}

function splitChunks(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS_PER_SOURCE) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf("。", end), text.lastIndexOf(". ", end));
      if (boundary > start + 480) end = boundary + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function deriveTitle(relativePath, text) {
  const heading = String(text || "").match(/^\s*#{1,3}\s+(.+)$/m);
  return compactText(heading?.[1] || path.basename(relativePath, path.extname(relativePath)), 160);
}

function openIndex(indexPath, readOnly = false) {
  return new DatabaseSync(indexPath, readOnly ? { readOnly: true } : {});
}

function initializeIndex(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS archive_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS archive_sources (
      id TEXT PRIMARY KEY,
      batchId TEXT NOT NULL,
      instance TEXT NOT NULL,
      relativePath TEXT NOT NULL,
      backupPath TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      mtimeUtc TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      indexed INTEGER NOT NULL,
      skipReason TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS archive_chunks_fts USING fts5(
      text,
      sourceId UNINDEXED,
      relativePath UNINDEXED,
      title UNINDEXED,
      tokenize = 'unicode61'
    );
  `);
}

function listManifestPaths(vaultRoot) {
  if (!fs.existsSync(vaultRoot)) return [];
  return fs.readdirSync(vaultRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(vaultRoot, entry.name, "MANIFEST.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, MAX_BATCHES);
}

function buildOpenClawMemoryArchiveIndex(options = {}) {
  const vaultRoot = path.resolve(options.vaultRoot || resolveDefaultVaultRoot());
  const indexPath = path.resolve(options.indexPath || path.join(vaultRoot, DEFAULT_INDEX_NAME));
  if (!isContained(vaultRoot, indexPath)) throw new Error("OpenClaw archive index must stay inside the Zhixia vault root.");
  fs.mkdirSync(vaultRoot, { recursive: true });
  if (pathHasSymbolicLink(vaultRoot, vaultRoot) || pathHasSymbolicLink(vaultRoot, path.dirname(indexPath))) {
    throw new Error("OpenClaw archive index path must not traverse a symbolic link or junction.");
  }
  if (fs.existsSync(indexPath) && (fs.lstatSync(indexPath).isSymbolicLink() || !isRealPathContained(vaultRoot, indexPath))) {
    throw new Error("OpenClaw archive index must resolve inside the real Zhixia vault root.");
  }

  const manifests = listManifestPaths(vaultRoot);
  const sources = [];
  const warnings = [];
  let totalReadBytes = 0;

  for (const manifestPath of manifests) {
    if (sources.length >= MAX_FILES) break;
    const manifestStat = fs.statSync(manifestPath);
    if (pathHasSymbolicLink(vaultRoot, manifestPath) || !isRealPathContained(vaultRoot, manifestPath)) {
      warnings.push("manifest_symlink_or_junction_skipped");
      continue;
    }
    if (manifestStat.size > MAX_MANIFEST_BYTES) {
      warnings.push("manifest_too_large_skipped");
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.allVerified !== true) {
      warnings.push("manifest_unverified_skipped");
      continue;
    }
    const manifestVault = path.resolve(String(manifest.vaultPath || ""));
    if (!isContained(vaultRoot, manifestVault) || pathHasSymbolicLink(vaultRoot, manifestVault) || !isRealPathContained(vaultRoot, manifestVault)) {
      warnings.push("manifest_vault_escape_skipped");
      continue;
    }
    const batchId = path.basename(manifestVault);

    for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
      if (sources.length >= MAX_FILES) break;
      const instance = String(entry.instance || "");
      const relativePath = normalizeRelativePath(entry.relativePath);
      if (!relativePath || !["openclaw", "openclaw-ceoflow"].includes(instance)) {
        warnings.push("invalid_manifest_entry_skipped");
        continue;
      }
      const backupPath = path.resolve(String(entry.backupPath || ""));
      const expectedBackup = path.resolve(manifestVault, instance, relativePath);
      if (!samePath(backupPath, expectedBackup) || !isContained(manifestVault, backupPath)) {
        warnings.push("backup_path_mismatch_skipped");
        continue;
      }
      if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile()) {
        warnings.push("backup_missing_skipped");
        continue;
      }
      if (pathHasSymbolicLink(manifestVault, backupPath) || fs.lstatSync(backupPath).isSymbolicLink() || !isRealPathContained(manifestVault, backupPath)) {
        warnings.push("backup_symlink_or_junction_skipped");
        continue;
      }

      const stat = fs.statSync(backupPath);
      const sourceId = crypto.createHash("sha256").update(`${batchId}\n${instance}\n${relativePath}`).digest("hex");
      let indexed = 0;
      let skipReason = null;
      let text = "";
      const extension = path.extname(relativePath).toLowerCase();
      if (!SAFE_TEXT_EXTENSIONS.has(extension)) skipReason = "unsupported_or_binary";
      else if (RAW_ARCHIVE_PATH_RE.test(relativePath)) skipReason = "raw_session_or_chat_backup";
      else if (SECRET_PATH_RE.test(relativePath)) skipReason = "secret_or_config_path";
      else if (stat.size > MAX_FILE_BYTES) skipReason = "file_too_large";
      else if (totalReadBytes + stat.size > MAX_TOTAL_READ_BYTES) skipReason = "aggregate_read_budget_exhausted";
      else if (sha256File(backupPath) !== String(entry.backupSha256 || "").toLowerCase()) skipReason = "hash_mismatch";
      else {
        text = cleanText(fs.readFileSync(backupPath, "utf8"));
        totalReadBytes += stat.size;
        indexed = text ? 1 : 0;
        if (!text) skipReason = "empty_after_sanitization";
      }

      const title = deriveTitle(relativePath, text);
      const summary = indexed
        ? compactText(text.split(/\n+/).find((line) => line.trim()) || title, 280)
        : `冷档案指针；正文未索引：${skipReason}`;
      sources.push({
        id: sourceId,
        batchId,
        instance,
        relativePath: relativePath.replace(/\\/g, "/"),
        backupPath,
        sha256: String(entry.backupSha256 || "").toLowerCase(),
        bytes: stat.size,
        mtimeUtc: String(entry.mtimeUtc || ""),
        title,
        summary,
        indexed,
        skipReason,
        chunks: indexed ? splitChunks(text) : [],
      });
    }
  }

  const db = openIndex(indexPath);
  try {
    initializeIndex(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM archive_chunks_fts; DELETE FROM archive_sources; DELETE FROM archive_meta;");
      const insertSource = db.prepare(`
        INSERT INTO archive_sources
        (id, batchId, instance, relativePath, backupPath, sha256, bytes, mtimeUtc, title, summary, indexed, skipReason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertChunk = db.prepare(`
        INSERT INTO archive_chunks_fts (text, sourceId, relativePath, title)
        VALUES (?, ?, ?, ?)
      `);
      let chunkCount = 0;
      for (const source of sources) {
        insertSource.run(
          source.id, source.batchId, source.instance, source.relativePath, source.backupPath,
          source.sha256, source.bytes, source.mtimeUtc, source.title, source.summary,
          source.indexed, source.skipReason,
        );
        for (const chunk of source.chunks) {
          insertChunk.run(chunk, source.id, source.relativePath, source.title);
          chunkCount += 1;
        }
      }
      const setMeta = db.prepare("INSERT INTO archive_meta(key, value) VALUES (?, ?)");
      const generatedAt = new Date().toISOString();
      setMeta.run("schemaVersion", ARCHIVE_SCHEMA_VERSION);
      setMeta.run("generatedAt", generatedAt);
      setMeta.run("vaultRoot", vaultRoot);
      setMeta.run("sourceCount", String(sources.length));
      setMeta.run("chunkCount", String(chunkCount));
      db.exec("COMMIT");
      db.exec("INSERT INTO archive_chunks_fts(archive_chunks_fts) VALUES('optimize')");
      return {
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        indexPath,
        generatedAt,
        manifestCount: manifests.length,
        sourceCount: sources.length,
        indexedSourceCount: sources.filter((source) => source.indexed).length,
        skippedSourceCount: sources.filter((source) => !source.indexed).length,
        chunkCount,
        totalReadBytes,
        warnings: [...new Set(warnings)],
        safety: {
          rawSessionsIndexed: false,
          secretPathsIndexed: false,
          sourceFilesModified: false,
          openClawMemoryEnabled: false,
        },
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

function queryTokens(query) {
  return [...new Set((cleanText(query).match(/[\p{L}\p{N}_-]+/gu) || []).map((token) => token.slice(0, 80)))]
    .filter(Boolean)
    .slice(0, 12);
}

function needsLikeFallback(rows, limit) {
  return new Set(rows.map((row) => row.id)).size < limit;
}

function queryOpenClawMemoryArchive(options = {}) {
  const query = compactText(options.query, 500);
  if (!query) throw new Error("OpenClaw archive query is required.");
  const vaultRoot = path.resolve(options.vaultRoot || resolveDefaultVaultRoot());
  const indexPath = path.resolve(options.indexPath || path.join(vaultRoot, DEFAULT_INDEX_NAME));
  if (!isContained(vaultRoot, indexPath) || !fs.existsSync(indexPath)) {
    throw new Error("OpenClaw archive index is unavailable; run the explicit build command first.");
  }
  if (pathHasSymbolicLink(vaultRoot, indexPath) || fs.lstatSync(indexPath).isSymbolicLink() || !isRealPathContained(vaultRoot, indexPath)) {
    throw new Error("OpenClaw archive index must resolve inside the real Zhixia vault root without links.");
  }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(options.limit || DEFAULT_LIMIT)));
  const tokenBudget = Math.max(200, Math.min(MAX_TOKEN_BUDGET, Number(options.tokenBudget || DEFAULT_TOKEN_BUDGET)));
  const charBudget = tokenBudget * 4;
  const tokens = queryTokens(query);
  const rows = [];
  const seen = new Set();
  const db = openIndex(indexPath, true);
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100;");
    if (tokens.length) {
      const matchQuery = tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
      try {
        const ftsRows = db.prepare(`
          SELECT s.*, f.text AS excerpt, bm25(archive_chunks_fts) AS score
          FROM archive_chunks_fts f
          JOIN archive_sources s ON s.id = f.sourceId
          WHERE archive_chunks_fts MATCH ?
          ORDER BY score ASC
          LIMIT ?
        `).all(matchQuery, limit * 4);
        rows.push(...ftsRows);
      } catch {
        // LIKE fallback below covers tokenization differences without exposing bodies.
      }
    }

    if (needsLikeFallback(rows, limit)) {
      const likeTokens = tokens.length ? tokens : [query];
      const likeClauses = likeTokens.map(() => "(f.text LIKE ? OR s.relativePath LIKE ? OR s.title LIKE ?)").join(" OR ");
      const likeParams = likeTokens.flatMap((token) => [`%${token}%`, `%${token}%`, `%${token}%`]);
      const fallbackRows = db.prepare(`
        SELECT s.*, f.text AS excerpt, 1000.0 AS score
        FROM archive_sources s
        LEFT JOIN archive_chunks_fts f ON f.sourceId = s.id
        WHERE ${likeClauses}
        LIMIT ?
      `).all(...likeParams, limit * 6);
      rows.push(...fallbackRows);
    }

    const items = [];
    let usedChars = 0;
    for (const row of rows) {
      if (items.length >= limit || seen.has(row.id)) continue;
      const excerpt = compactText(row.excerpt || row.summary, Math.min(720, charBudget - usedChars));
      if (!excerpt || usedChars + excerpt.length > charBudget) continue;
      seen.add(row.id);
      usedChars += excerpt.length;
      const archiveSourceRef = `openclaw-vault://${row.batchId}/${row.instance}/${row.relativePath}`;
      items.push({
        id: row.id,
        title: row.title,
        summary: row.summary,
        excerpt,
        memoryLayer: "cold",
        recallDepth: "bounded_sanitized_excerpt",
        instance: row.instance,
        relativePath: row.relativePath,
        bytes: Number(row.bytes || 0),
        sha256: row.sha256,
        sourceRefs: [
          archiveSourceRef,
          row.backupPath,
        ],
        providerSafeSourceRefs: [
          providerSafeSourceRef(archiveSourceRef, row.id),
        ],
        indexed: Boolean(row.indexed),
        skipReason: row.skipReason || null,
      });
    }

    const providerItems = [];
    for (const item of items) {
      const providerItem = {
        title: providerSafeText(item.title, 160),
        excerpt: providerSafeText(item.excerpt, 520),
        memoryLayer: "cold",
        sourceRefs: item.providerSafeSourceRefs,
      };
      const candidate = [...providerItems, providerItem];
      if (JSON.stringify(candidate).length > Math.max(400, charBudget - 600)) break;
      providerItems.push(providerItem);
    }
    if (!providerItems.length && items.length) {
      providerItems.push({
        title: providerSafeText(items[0].title, 100),
        excerpt: providerSafeText(items[0].excerpt, Math.max(120, charBudget - 900)),
        memoryLayer: "cold",
        sourceRefs: items[0].providerSafeSourceRefs,
      });
    }
    const providerQuery = providerSafeText(query, MAX_PROVIDER_QUERY_CHARS);
    const assembleProviderPacket = () => ({
      schemaVersion: "ceoflow.zhixia_memory_injection.v1",
      query: providerQuery,
      queryType: "openclaw_audit",
      memoryAuthority: "zhixia",
      items: providerItems,
      sourceRefs: [...new Set(providerItems.flatMap((item) => item.sourceRefs))],
      effects: {
        openClawMemoryEnabled: false,
        rawSessionRead: false,
      },
    });
    let providerPacket = assembleProviderPacket();
    while (providerItems.length > 1 && estimateSerializedTokens(providerPacket) > tokenBudget) {
      providerItems.pop();
      providerPacket = assembleProviderPacket();
    }
    while (providerItems.length === 1 && estimateSerializedTokens(providerPacket) > tokenBudget && providerItems[0].excerpt.length > 80) {
      providerItems[0].excerpt = compactText(providerItems[0].excerpt, Math.max(80, providerItems[0].excerpt.length - 80));
      providerPacket = assembleProviderPacket();
    }
    providerPacket.tokenEstimate = estimateSerializedTokens(providerPacket);

    const metaRows = db.prepare("SELECT key, value FROM archive_meta").all();
    const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]));
    return {
      schemaVersion: PACKET_SCHEMA_VERSION,
      query,
      queryType: "openclaw_audit",
      memoryAuthority: "zhixia",
      memoryLayer: "cold",
      readByDefault: false,
      explicitAuditGate: true,
      indexGeneratedAt: meta.generatedAt || null,
      items,
      sourceRefs: [...new Set(items.flatMap((item) => item.sourceRefs))],
      providerSafeSourceRefs: [...new Set(items.flatMap((item) => item.providerSafeSourceRefs))],
      providerPacket,
      tokenEstimate: providerPacket.tokenEstimate,
      fullDiagnosticTokenEstimate: Math.ceil((JSON.stringify(items).length || 0) / 4),
      warnings: items.length ? [] : ["no_matching_sanitized_archive_memory"],
      effects: {
        openClawMemoryEnabled: false,
        rawSessionRead: false,
        sourceFilesModified: false,
        archiveDeleted: false,
      },
    };
  } finally {
    db.close();
  }
}

module.exports = {
  ARCHIVE_SCHEMA_VERSION,
  PACKET_SCHEMA_VERSION,
  buildOpenClawMemoryArchiveIndex,
  cleanText,
  estimateSerializedTokens,
  isContained,
  needsLikeFallback,
  pathHasSymbolicLink,
  normalizeRelativePath,
  queryOpenClawMemoryArchive,
  resolveDefaultVaultRoot,
};
