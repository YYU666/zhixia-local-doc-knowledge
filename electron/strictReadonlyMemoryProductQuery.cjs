const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");

const STRICT_READONLY_QUERY_SCHEMA = "zhixia.strict_readonly_memory_query.v1";
const SIDECAR_NAME = "memory-runtime-index.sqlite";

function normalizeFreshness(value) {
  const normalized = compact(value, 40).toLowerCase();
  return ["fresh", "review", "stale"].includes(normalized) ? normalized : "review";
}

function normalizeRequest(request = {}) {
  const rawProjectPath = String(request.projectPath || "").trim();
  const projectPath = rawProjectPath && path.isAbsolute(rawProjectPath) ? path.normalize(rawProjectPath) : null;
  return {
    projectPath,
    query: compact(request.query || request.taskGoal, 1200),
    queryType: compact(request.queryType, 80) || "task_dispatch",
    tokenBudget: Math.max(200, Math.min(Number(request.tokenBudget) || 1200, 4000)),
    maxResults: Math.max(1, Math.min(Number(request.maxResults || request.limit) || 8, 24)),
  };
}

function baseEnvelope(request, availability, reasonCodes, items) {
  const freshness = items.some((item) => item.freshness === "stale")
    ? "stale"
    : items.some((item) => item.freshness === "review") || items.length === 0
      ? "review"
      : "fresh";
  return {
    schemaVersion: STRICT_READONLY_QUERY_SCHEMA,
    provider: "zhixia_local_docs",
    mode: "strict_readonly_existing_sidecar",
    availability,
    reasonCodes,
    readOnly: true,
    queryType: request.queryType,
    query: request.query,
    projectPath: request.projectPath,
    tokenBudget: request.tokenBudget,
    items,
    sourceRefs: items.flatMap((item) => item.sourceRefs).slice(0, 24),
    returnedCount: items.length,
    tokenEstimate: items.reduce((sum, item) => sum + item.tokenEstimate, 0),
    freshness,
    generatedAt: new Date().toISOString(),
    request: { projectPath: request.projectPath, queryType: request.queryType },
    memoryCore: { strictReadOnly: true, writes: 0, current: false, recoveryReady: false },
    warnings: reasonCodes,
  };
}

function unavailable(request, reason) {
  return {
    ...baseEnvelope(request, "unavailable", [reason], []),
  };
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function compact(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function rowToItem(row) {
  const sourceRefs = safeJsonArray(row.sourceRefsJson).filter((item) => item && typeof item === "object").slice(0, 12);
  const freshness = normalizeFreshness(row.freshness);
  const summary = compact(row.summary, 1200);
  const whyMatched = ["strict_readonly_existing_sidecar", "project_path_exact"];
  return {
    id: compact(row.id, 220),
    kind: compact(row.kind, 80) || "memory_item",
    projectPath: row.projectPath || null,
    title: compact(row.title, 300),
    summary,
    excerpt: summary,
    sourcePath: compact(sourceRefs[0]?.path || row.projectPath || "memory-runtime", 1200),
    tags: safeJsonArray(row.tagsJson).map((item) => compact(item, 80)).filter(Boolean).slice(0, 16),
    sourceRefs,
    status: compact(row.status, 40),
    freshness,
    score: 0,
    requiresHumanConfirmation: Number(row.requiresHumanConfirmation || 0) === 1,
    tokenEstimate: Math.max(0, Math.min(Number(row.tokenEstimate || 0), 8000)),
    updatedAt: row.updatedAt || null,
    whyMatched,
    whyRecalled: whyMatched,
    rawSessionPolicy: "not_allowed",
  };
}

function activeItemToAgentItem(item) {
  const sourceRefs = Array.isArray(item?.sourceRefs) ? item.sourceRefs.filter((ref) => ref && typeof ref === "object").slice(0, 12) : [];
  const summary = compact(item?.summary || item?.excerpt, 1200);
  const whyMatched = Array.isArray(item?.whyMatched) && item.whyMatched.length > 0
    ? item.whyMatched.map((value) => compact(value, 160)).filter(Boolean).slice(0, 8)
    : ["strict_readonly_active_runtime", "project_path_exact"];
  return {
    ...item,
    id: compact(item?.id, 220),
    kind: compact(item?.kind, 80) || "memory_item",
    title: compact(item?.title, 300),
    summary,
    excerpt: summary,
    sourcePath: compact(item?.sourcePath || sourceRefs[0]?.path || item?.projectPath || "memory-runtime", 1200),
    sourceRefs,
    status: compact(item?.status, 40),
    freshness: normalizeFreshness(item?.freshness),
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0,
    requiresHumanConfirmation: item?.requiresHumanConfirmation === true,
    tokenEstimate: Math.max(0, Math.min(Number(item?.tokenEstimate || 0), 8000)),
    whyMatched,
    whyRecalled: Array.isArray(item?.whyRecalled) ? item.whyRecalled.slice(0, 8) : whyMatched,
    rawSessionPolicy: item?.rawSessionPolicy || "not_allowed",
  };
}

function activeEnvelope(request, result) {
  const items = Array.isArray(result?.items) ? result.items.map(activeItemToAgentItem) : [];
  return {
    ...result,
    ...baseEnvelope(request, "available", [], items),
    mode: "strict_readonly_active_runtime",
    sourceRefs: items.flatMap((item) => item.sourceRefs).slice(0, 24),
    memoryCore: { ...(result?.memoryCore || {}), strictReadOnly: true, writes: 0 },
    warnings: [...new Set([...(Array.isArray(result?.warnings) ? result.warnings : []), "strict_readonly_active_runtime_existing_store_only"])],
  };
}

function createStrictReadonlyMemoryProductQuery(options = {}) {
  const userDataPath = path.resolve(String(options.userDataPath || ""));
  const sidecarPath = path.join(userDataPath, "memory-runtime", SIDECAR_NAME);
  const activeReadonlyQuery = typeof options.activeReadonlyQuery === "function" ? options.activeReadonlyQuery : null;

  return async function retrieveStrictReadonlyMemory(request = {}) {
    const normalizedRequest = normalizeRequest(request);
    const { projectPath } = normalizedRequest;
    if (!projectPath) return unavailable(normalizedRequest, "strict_readonly_project_path_required");
    let sidecarStat;
    try {
      sidecarStat = fs.lstatSync(sidecarPath);
    } catch (error) {
      return unavailable(normalizedRequest, error?.code === "ENOENT" ? "strict_readonly_store_missing" : "strict_readonly_store_metadata_unavailable");
    }
    if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink()) return unavailable(normalizedRequest, "strict_readonly_store_file_type_invalid");
    if (["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(`${sidecarPath}${suffix}`))) {
      if (activeReadonlyQuery) {
        try {
          return activeEnvelope(normalizedRequest, await activeReadonlyQuery({ ...request, ...normalizedRequest, readOnly: true }));
        } catch {
          return unavailable(normalizedRequest, "strict_readonly_active_runtime_unavailable");
        }
      }
      return unavailable(normalizedRequest, "strict_readonly_store_not_quiescent");
    }
    let header;
    try {
      const handle = fs.openSync(sidecarPath, "r");
      try {
        header = Buffer.alloc(20);
        if (fs.readSync(handle, header, 0, header.length, 0) !== header.length) return unavailable(normalizedRequest, "strict_readonly_store_header_invalid");
      } finally {
        fs.closeSync(handle);
      }
    } catch {
      return unavailable(normalizedRequest, "strict_readonly_store_header_unavailable");
    }
    if (header.subarray(0, 16).toString("binary") !== "SQLite format 3\u0000") return unavailable(normalizedRequest, "strict_readonly_store_header_invalid");
    let db = null;
    try {
      const sourceBytes = fs.readFileSync(sidecarPath);
      if (["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(`${sidecarPath}${suffix}`))) {
        return unavailable(normalizedRequest, "strict_readonly_store_not_quiescent");
      }
      const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
      db = new SQL.Database(sourceBytes);
      const tableResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_search_items'");
      const table = tableResult[0]?.values?.[0]?.[0] || null;
      if (!table) return unavailable(normalizedRequest, "strict_readonly_schema_unavailable");
      const limit = normalizedRequest.maxResults;
      const statement = db.prepare(`
        SELECT id, kind, projectPath, title, summary, tagsJson, sourceRefsJson, status, freshness,
               requiresHumanConfirmation, tokenEstimate, updatedAt
        FROM memory_search_items
        WHERE projectPath = ?
        ORDER BY updatedAt DESC, id ASC
        LIMIT ?
      `);
      statement.bind([projectPath, limit]);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      statement.free();
      const items = rows.map(rowToItem);
      return {
        ...baseEnvelope(normalizedRequest, "available", [], items),
        memoryCore: { strictReadOnly: true, writes: 0 },
      };
    } catch {
      return unavailable(normalizedRequest, "strict_readonly_store_open_failed");
    } finally {
      try { db?.close(); } catch {}
    }
  };
}

module.exports = { STRICT_READONLY_QUERY_SCHEMA, createStrictReadonlyMemoryProductQuery };
