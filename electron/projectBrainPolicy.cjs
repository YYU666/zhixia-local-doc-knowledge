const crypto = require("node:crypto");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const PROJECT_BRAIN_SCHEMA = "zhixia.project_brain.v1";
const PROJECT_ANCHOR_SCHEMA = "zhixia.project_anchor.v1";
const MODULE_MEMORY_SCHEMA = "zhixia.module_memory.v1";
const PROJECT_CHECKPOINT_SCHEMA = "zhixia.project_checkpoint.v1";
const PROJECT_CONTINUITY_PACKET_SCHEMA = "zhixia.project_continuity_packet.v1";

const PROJECT_ANCHOR_CATEGORIES = Object.freeze([
  "identity",
  "original_goal",
  "architecture",
  "non_negotiable",
  "acceptance",
  "safety",
]);

const PROJECT_CONTINUITY_SLOTS = Object.freeze([
  "project_identity",
  "original_product_goal",
  "architecture_anchors",
  "standing_rules",
  "active_modules",
  "current_phase",
  "accepted_progress",
  "open_tasks",
  "open_blockers",
  "latest_failures",
  "next_actions",
  "thread_lineage",
  "canonical_docs",
  "last_valid_checkpoint",
]);

const SINGLE_VALUE_SLOTS = new Set([
  "project_identity",
  "original_product_goal",
  "current_phase",
  "last_valid_checkpoint",
]);
const AUTHORITATIVE_STATUSES = new Set(["accepted", "curated"]);
const NON_CURRENT_STATUSES = new Set(["candidate", "review", "superseded", "revoked", "expired", "rejected", "historical"]);
const CLOSED_TASK_STATUSES = new Set(["accepted", "completed", "done", "closed", "cancelled", "superseded"]);
const ACTIVE_MODULE_STATUSES = new Set(["active", "current", "ready", "in_progress", "blocked", "waiting_review"]);
const FAILURE_EVENT_RE = /(?:failure|failed|error|regression|bug|crash|blocked|test_failure)/i;
const RAW_SESSION_PATH_RE = /(?:^|[\\/])\.codex[\\/](?:archived_)?sessions[\\/]|(?:^|[\\/])sessions[\\/][^\\/]*(?:session|thread)[^\\/]*\.jsonl$|\.jsonl$/i;
const SECRET_PATH_RE = /(?:^|[\\/])\.env(?:$|[.\\/_-])|(?:^|[\\/])(?:id_rsa|id_ed25519|credentials)(?:$|[.\\/_-])/i;
const SECRET_VALUE_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b|\b(?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|password|passwd|private[_ -]?key)\s*[:=]\s*[^\s,;]{4,}/i;
const BASE64_DATA_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{48,}/i;
const SENSITIVE_KEY_RE = /^(?:api[_-]?key|auth(?:orization)?|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key|cookie)$/i;
const RAW_BODY_KEY_RE = /^(?:rawBody|rawText|sessionBody|threadBody|transcript|messages)$/i;
const GIANT_BODY_CHARS = 16000;
const MAX_SOURCE_REFS = 32;
const MAX_ALIASES = 24;
const MAX_MODULES = 40;
const MAX_ANCHORS = 32;
const MAX_SLOT_ITEMS = 16;
const MAX_CUES = 32;
const DEFAULT_PACKET_TOKEN_BUDGET = 1500;
const MIN_PACKET_TOKEN_BUDGET = 1800;
const DEFAULT_PACKET_ITEM_BUDGET = 48;
const DEFAULT_PACKET_CHAR_BUDGET = 24000;
const HARD_PACKET_TOKEN_CAP = 8000;
const HARD_PACKET_CHAR_CAP = 64000;
const MIN_PROGRESS_TOKEN_BUDGET = 2000;
const MIN_PROGRESS_CHAR_BUDGET = 10000;
const MIN_PARTIAL_ALIAS_LENGTH = 4;
const DEFAULT_RESOLUTION_MIN_SCORE = 70;

function safeArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function clampInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function compactText(value, maxChars = 320) {
  const text = String(value == null ? "" : value)
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function normalizedKey(value) {
  return compactText(value, 500).normalize("NFKC").toLowerCase().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function canonicalPath(value) {
  const input = compactText(value, 600);
  if (!input) return null;
  const slashed = input.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const drive = /^[A-Za-z]:\//.test(slashed) ? slashed.slice(0, 2).toUpperCase() : "";
  const prefix = drive || slashed.startsWith("/") ? "/" : "";
  const rest = drive ? slashed.slice(2) : slashed;
  const parts = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!prefix && !drive) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  return `${drive}${prefix}${joined}` || drive || prefix || null;
}

function isSafeNonFileUri(value) {
  const text = compactText(value, 600);
  const match = text.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/[^\s]+$/);
  return Boolean(match && !["data", "file", "javascript", "vbscript"].includes(match[1].toLowerCase()));
}

function containedProjectFilePath(value, projectPath) {
  const rawValue = compactText(value, 600);
  if (!rawValue) return null;
  let fileValue = rawValue;
  if (/^file:/i.test(fileValue)) {
    try {
      fileValue = fileURLToPath(fileValue);
    } catch {
      return null;
    }
  }
  const root = canonicalPath(projectPath);
  if (!root) return canonicalPath(fileValue);
  const rootIsWindows = /^[A-Za-z]:\//.test(root);
  const candidateLooksWindows = /^[A-Za-z]:[\\/]/.test(fileValue);
  const candidateLooksPosix = fileValue.startsWith("/");
  if (rootIsWindows && candidateLooksPosix) return null;
  if (!rootIsWindows && candidateLooksWindows) return null;
  const pathApi = rootIsWindows ? path.win32 : path.posix;
  const rootNative = rootIsWindows ? root.replace(/\//g, "\\") : root;
  const inputNative = rootIsWindows ? fileValue.replace(/\//g, "\\") : fileValue.replace(/\\/g, "/");
  const candidateNative = pathApi.isAbsolute(inputNative) ? pathApi.normalize(inputNative) : pathApi.resolve(rootNative, inputNative);
  const relative = pathApi.relative(rootNative, candidateNative);
  if (relative === "") return canonicalPath(candidateNative);
  if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) return null;
  return canonicalPath(candidateNative);
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function slug(value, fallback = "item") {
  const result = normalizedKey(value)
    .replace(/[^a-z0-9\p{Script=Han}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return result || fallback;
}

function canonicalize(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return compactText(value, 600);
  if (depth >= 5) return "[nested-omitted]";
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => canonicalize(entry, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort().slice(0, 64)) {
      if (/^(?:body|content|payload|embedding|vector)$/i.test(key)) continue;
      result[key] = canonicalize(value[key], depth + 1);
    }
    return result;
  }
  return null;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function uniqueStrings(values, limit = 20) {
  const seen = new Set();
  const result = [];
  for (const value of safeArray(values).flat(Infinity)) {
    if (value == null || typeof value === "object") continue;
    const text = compactText(value, 240);
    const key = normalizedKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result.sort((left, right) => normalizedKey(left).localeCompare(normalizedKey(right))).slice(0, limit);
}

function containsBase64Payload(value) {
  const text = String(value || "");
  if (BASE64_DATA_RE.test(text)) return true;
  const runs = text.match(/[A-Za-z0-9+/]{180,}={0,2}/g) || [];
  return runs.some((run) => new Set(run.replace(/=+$/, "")).size >= 6);
}

function inspectCompactSafety(input) {
  const state = {
    rawSession: false,
    secret: false,
    base64: false,
    giantContent: false,
    truncatedStructure: false,
    signalChars: 0,
    nodes: 0,
  };
  const seen = new WeakSet();

  function visit(value, key = "", depth = 0) {
    if (value == null || state.truncatedStructure) return;
    state.nodes += 1;
    if (state.nodes > 1000 || depth > 7) {
      state.truncatedStructure = true;
      return;
    }
    if (typeof value === "string") {
      state.signalChars += value.length;
      if (value.length > GIANT_BODY_CHARS || state.signalChars > 64000) state.giantContent = true;
      if (RAW_BODY_KEY_RE.test(key) && value.trim()) state.rawSession = true;
      if (/path|file|source|uri/i.test(key) && RAW_SESSION_PATH_RE.test(value)) state.rawSession = true;
      if (/path|file|source|uri/i.test(key) && SECRET_PATH_RE.test(value)) state.secret = true;
      if (SENSITIVE_KEY_RE.test(key) && value.trim().length >= 4) state.secret = true;
      if (SECRET_VALUE_RE.test(value)) state.secret = true;
      if (containsBase64Payload(value)) state.base64 = true;
      return;
    }
    if (["number", "boolean", "bigint"].includes(typeof value)) return;
    if (typeof value !== "object" || seen.has(value)) {
      if (typeof value === "object") state.truncatedStructure = true;
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const count = Math.min(value.length, 200);
      for (let index = 0; index < count; index += 1) visit(value[index], key, depth + 1);
      if (value.length > count) state.truncatedStructure = true;
      seen.delete(value);
      return;
    }
    const keys = Object.keys(value);
    for (const childKey of keys.slice(0, 200)) visit(value[childKey], childKey, depth + 1);
    if (keys.length > 200) state.truncatedStructure = true;
    seen.delete(value);
  }

  visit(input);
  if (input?.containsRawSession === true || input?.privacy?.containsRawSession === true || normalizedKey(input?.kind) === "raw_session") {
    state.rawSession = true;
  }
  if (input?.containsSecrets === true || input?.privacy?.containsSecrets === true) state.secret = true;
  return {
    safe: !state.rawSession && !state.secret && !state.base64 && !state.giantContent && !state.truncatedStructure,
    flags: state,
  };
}

function sourceRefSignature(ref) {
  return [ref.kind, ref.id, ref.path, ref.uri, ref.hash, ref.title].map((value) => value || "").join("|");
}

function normalizeSourceRef(ref, options = {}) {
  const source = typeof ref === "string" ? { path: ref } : ref;
  if (!source || typeof source !== "object") return null;
  const rawPath = compactText(source.path || source.filePath, 500);
  const rawUri = compactText(source.uri || source.url, 500);
  const rawTitle = compactText(source.title, 180);
  const combined = `${rawPath} ${rawUri} ${rawTitle}`;
  if (RAW_SESSION_PATH_RE.test(combined) || SECRET_PATH_RE.test(combined) || SECRET_VALUE_RE.test(combined) || containsBase64Payload(combined)) {
    return null;
  }
  let normalizedPath = null;
  let normalizedUri = null;
  if (rawPath) {
    if (isSafeNonFileUri(rawPath)) normalizedUri = rawPath;
    else normalizedPath = containedProjectFilePath(rawPath, options.projectPath);
    if (!normalizedPath && !normalizedUri) return null;
  }
  if (rawUri) {
    if (isSafeNonFileUri(rawUri)) normalizedUri = rawUri;
    else if (/^file:/i.test(rawUri)) normalizedPath = containedProjectFilePath(rawUri, options.projectPath);
    else return null;
    if (!normalizedPath && !normalizedUri) return null;
  }
  const normalized = {
    kind: compactText(source.kind || source.sourceType || "source", 60) || "source",
    id: compactText(source.id || source.sourceId, 160) || null,
    path: normalizedPath,
    uri: normalizedUri,
    title: rawTitle || null,
    hash: compactText(source.hash || source.sha256 || source.sourceHash, 160) || null,
    artifactType: compactText(source.artifactType, 80) || null,
    updatedAt: isoOrNull(source.updatedAt || source.modifiedAt),
  };
  if (![normalized.id, normalized.path, normalized.uri, normalized.title, normalized.hash].some(Boolean)) return null;
  return normalized;
}

function normalizeSourceRefs(input, limit = MAX_SOURCE_REFS, options = {}) {
  const seen = new Set();
  const refs = [];
  for (const ref of safeArray(input).flat(Infinity)) {
    const normalized = normalizeSourceRef(ref, options);
    if (!normalized) continue;
    const signature = sourceRefSignature(normalized);
    if (seen.has(signature)) continue;
    seen.add(signature);
    refs.push(normalized);
  }
  return refs.sort((left, right) => sourceRefSignature(left).localeCompare(sourceRefSignature(right))).slice(0, limit);
}

function lifecycleStatus(record, fallback = "review") {
  if (!record || typeof record !== "object") return fallback;
  const explicit = normalizedKey(record.authorityStatus || record.memoryStatus || record.lifecycleStatus);
  if (explicit) return explicit;
  const status = normalizedKey(record.status);
  if (AUTHORITATIVE_STATUSES.has(status) || NON_CURRENT_STATUSES.has(status)) return status;
  return fallback;
}

function authorityState(record, expectedProjectId = null, expectedProjectPath = null) {
  const sourceRefs = normalizeSourceRefs(record?.sourceRefs || record?.sourceRef, MAX_SOURCE_REFS, { projectPath: expectedProjectPath });
  const status = lifecycleStatus(record, "review");
  const projectId = compactText(record?.projectId, 180) || null;
  const scopeState = expectedProjectId
    ? projectId === expectedProjectId ? "exact" : projectId ? "foreign" : "unscoped"
    : projectId ? "scoped" : "unscoped";
  return {
    authorityStatus: status,
    sourceRefs,
    projectId,
    scopeState,
    authoritative: AUTHORITATIVE_STATUSES.has(status)
      && sourceRefs.length > 0
      && Boolean(projectId)
      && (!expectedProjectId || scopeState === "exact"),
  };
}

function normalizeProjectBrain(input = {}, options = {}) {
  const safety = inspectCompactSafety(input);
  const normalizedPath = canonicalPath(input.canonicalPath || input.projectPath || input.rootPath || input.workspacePath);
  const baseAliases = [
    input.name,
    input.title,
    input.productName,
    ...safeArray(input.aliases),
    normalizedPath ? path.posix.basename(normalizedPath) : null,
  ];
  const aliases = uniqueStrings(baseAliases, MAX_ALIASES);
  const identitySeed = [normalizedPath && normalizedPath.toLowerCase(), ...aliases.map(normalizedKey)].filter(Boolean).join("|") || "unknown-project";
  const projectId = compactText(input.projectId || input.id, 180)
    || `project-${slug(aliases[0] || path.posix.basename(normalizedPath || "project"), "project")}-${stableHash(identitySeed).slice(0, 12)}`;
  const authority = authorityState({ ...input, projectId }, null, normalizedPath);
  const phase = compactText(input.phase || input.currentPhase, 120) || null;
  const goals = uniqueStrings([input.goals, input.primaryGoals, input.productGoals], 20);
  const rawModuleIds = safeArray(input.moduleIds).concat(safeArray(input.modules).map((module) => {
    if (typeof module === "string") return module;
    return module?.moduleId || module?.id || module?.name;
  }));
  const moduleIds = uniqueStrings(rawModuleIds, Math.max(MAX_MODULES, rawModuleIds.length));
  const rawAnchorIds = safeArray(input.anchorIds).concat(safeArray(input.anchors).map((anchor) => {
    if (typeof anchor === "string") return anchor;
    return anchor?.anchorId || anchor?.id;
  }));
  const anchorIds = uniqueStrings(rawAnchorIds, Math.max(MAX_ANCHORS, rawAnchorIds.length));
  const checkpointId = compactText(input.checkpointId || input.currentCheckpointId || input.checkpoint?.checkpointId || input.checkpoint?.id, 180) || null;
  const updatedAt = isoOrNull(input.updatedAt || input.observedAt || options.now);

  return {
    schemaVersion: PROJECT_BRAIN_SCHEMA,
    projectId,
    canonicalPath: safety.safe ? normalizedPath : null,
    aliases: safety.safe ? aliases : [],
    productSummary: safety.safe ? compactText(input.productSummary || input.summary || input.description, 700) : "[unsafe-project-input-omitted]",
    projectType: safety.safe ? compactText(input.projectType || input.type, 100) || null : null,
    phase: safety.safe ? phase : null,
    goals: safety.safe ? goals : [],
    moduleIds: safety.safe ? moduleIds : [],
    anchorIds: safety.safe ? anchorIds : [],
    checkpointId: safety.safe ? checkpointId : null,
    authorityStatus: safety.safe ? authority.authorityStatus : "rejected",
    authoritative: safety.safe && authority.authoritative,
    sourceRefs: safety.safe ? authority.sourceRefs : [],
    updatedAt,
    safety: {
      compactMetadataOnly: true,
      rawThreadBodies: false,
      unsafeInputRejected: !safety.safe,
    },
  };
}

function normalizeProjectAnchor(input = {}, options = {}) {
  const safety = inspectCompactSafety(input);
  if (!safety.safe) return null;
  const categoryInput = normalizedKey(input.category || input.anchorType || input.type).replace(/ /g, "_");
  const category = PROJECT_ANCHOR_CATEGORIES.includes(categoryInput) ? categoryInput : null;
  if (!category) return null;
  const projectId = compactText(input.projectId, 180) || null;
  const statement = compactText(input.statement || input.summary || input.value || input.description, 700);
  if (!statement) return null;
  const authority = authorityState({ ...input, projectId }, options.projectId || null, options.projectPath || null);
  const sourceRefs = authority.sourceRefs;
  const status = authority.authorityStatus;
  const authoritative = authority.authoritative;
  const idSeed = stableStringify({ projectId, category, statement: normalizedKey(statement), sourceRefs: sourceRefs.map(sourceRefSignature) });
  return {
    schemaVersion: PROJECT_ANCHOR_SCHEMA,
    anchorId: compactText(input.anchorId || input.id, 180) || `anchor-${category}-${stableHash(idSeed).slice(0, 14)}`,
    projectId,
    category,
    title: compactText(input.title || `${category} anchor`, 180),
    statement,
    status,
    authorityStatus: status,
    authoritative,
    scopeState: authority.scopeState,
    mandatory: authoritative,
    decayPolicy: authoritative ? "none_until_explicit_supersession" : "not_authoritative",
    supersededBy: compactText(input.supersededBy, 180) || null,
    freshness: compactText(input.freshness, 40) || "unknown",
    conflict: input.conflict === true,
    sourceRefs,
    createdAt: isoOrNull(input.createdAt || input.observedAt || options.now),
    updatedAt: isoOrNull(input.updatedAt || input.observedAt || options.now),
  };
}

function normalizeCommitment(input, context = {}) {
  const record = typeof input === "string" ? { title: input } : input;
  if (!record || typeof record !== "object" || !inspectCompactSafety(record).safe) return null;
  const title = compactText(record.title || record.task || record.summary || record.name, 220);
  if (!title) return null;
  const authority = authorityState(record, context.projectId || null, context.projectPath || null);
  const operationalStatus = normalizedKey(record.currentStatus || record.taskStatus || record.state || record.status);
  const status = AUTHORITATIVE_STATUSES.has(operationalStatus) || NON_CURRENT_STATUSES.has(operationalStatus)
    ? normalizedKey(record.state || record.taskStatus || "open") || "open"
    : operationalStatus || "open";
  const idSeed = [record.projectId, context.moduleId, title].map(normalizedKey).join("|");
  return {
    id: compactText(record.taskId || record.id, 180) || `task-${stableHash(idSeed).slice(0, 14)}`,
    title,
    summary: compactText(record.summary || record.description, 360),
    status,
    authorityStatus: authority.authorityStatus,
    authoritative: authority.authoritative,
    projectId: authority.projectId,
    scopeState: authority.scopeState,
    sourceRefs: authority.sourceRefs,
    observedAt: isoOrNull(record.observedAt || record.updatedAt),
    updatedAt: isoOrNull(record.updatedAt || record.observedAt || context.updatedAt),
  };
}

function normalizeCompactRecord(input, context = {}, type = "item") {
  const record = typeof input === "string" ? { title: input } : input;
  if (!record || typeof record !== "object" || !inspectCompactSafety(record).safe) return null;
  const title = compactText(record.title || record.summary || record.name || record.value, 220);
  if (!title) return null;
  const authority = authorityState(record, context.projectId || null, context.projectPath || null);
  return {
    id: compactText(record.id || record[`${type}Id`], 180) || `${type}-${stableHash([context.projectId, context.moduleId, title].join("|")).slice(0, 14)}`,
    title,
    summary: compactText(record.summary || record.description, 360),
    status: normalizedKey(record.state || record.currentStatus || record.status) || "open",
    authorityStatus: authority.authorityStatus,
    authoritative: authority.authoritative,
    projectId: authority.projectId,
    scopeState: authority.scopeState,
    sourceRefs: authority.sourceRefs,
    updatedAt: isoOrNull(record.updatedAt || record.observedAt || context.updatedAt),
  };
}

function normalizeModuleMemory(input = {}, options = {}) {
  const safety = inspectCompactSafety(input);
  if (!safety.safe) return null;
  const projectId = compactText(input.projectId, 180) || null;
  const name = compactText(input.name || input.title || input.moduleName, 180);
  if (!name) return null;
  const aliases = uniqueStrings([name, input.aliases], MAX_ALIASES);
  const fileHints = uniqueStrings([
    input.fileHints,
    input.paths,
    input.filePaths,
    input.filePatterns,
    input.files,
    safeArray(input.artifacts).map((artifact) => artifact?.path || artifact?.filePath || artifact?.title),
  ], 30);
  const errorCues = uniqueStrings([input.errorCues, input.errors, input.errorCodes], 20);
  const authority = authorityState({ ...input, projectId }, options.projectId || null, options.projectPath || null);
  const statusInput = normalizedKey(input.currentStatus || input.moduleStatus || input.state || input.status);
  const currentStatus = AUTHORITATIVE_STATUSES.has(statusInput) || NON_CURRENT_STATUSES.has(statusInput)
    ? normalizedKey(input.currentStatus || input.moduleStatus || input.state) || "unknown"
    : statusInput || "unknown";
  const moduleSeed = [projectId, name, ...aliases, ...fileHints].map(normalizedKey).join("|");
  const moduleId = compactText(input.moduleId || input.id, 180) || `module-${slug(name, "module")}-${stableHash(moduleSeed).slice(0, 12)}`;
  const context = {
    projectId,
    projectPath: options.projectPath || null,
    moduleId,
    authorityStatus: authority.authorityStatus,
    updatedAt: input.updatedAt || options.now,
  };
  const tasks = safeArray(input.tasks || input.activeTasks).map((item) => normalizeCommitment(item, context)).filter(Boolean);
  const blockers = safeArray(input.blockers || input.openBlockers).map((item) => normalizeCompactRecord(item, context, "blocker")).filter(Boolean);
  const risks = safeArray(input.risks || input.openRisks).map((item) => normalizeCompactRecord(item, context, "risk")).filter(Boolean);

  return {
    schemaVersion: MODULE_MEMORY_SCHEMA,
    moduleId,
    projectId,
    name,
    aliases,
    purpose: compactText(input.purpose || input.summary || input.description, 600),
    dependencies: uniqueStrings([input.dependencies, input.dependencyIds], 30),
    currentStatus,
    authorityStatus: authority.authorityStatus,
    authoritative: authority.authoritative,
    scopeState: authority.scopeState,
    designAnchorIds: uniqueStrings([input.designAnchorIds, input.designAnchors], Math.max(24, safeArray(input.designAnchorIds).length + safeArray(input.designAnchors).length)),
    tasks,
    blockers,
    risks,
    episodeIds: uniqueStrings([input.episodeIds, input.recentEpisodeIds, safeArray(input.episodes).map((item) => item?.episodeId || item?.id || item)], 30),
    decisionIds: uniqueStrings([input.decisionIds, safeArray(input.decisions).map((item) => item?.decisionId || item?.id || item)], 30),
    artifactRefs: normalizeSourceRefs([input.artifactRefs, input.artifacts], 20),
    ownerThreadHints: uniqueStrings([input.ownerThreadHints, input.ownerThreadIds, input.threadIds], 16),
    fileHints,
    errorCues,
    sourceRefs: authority.sourceRefs,
    updatedAt: isoOrNull(input.updatedAt || input.observedAt || options.now),
  };
}

function checkpointCore(input = {}, options = {}) {
  const projectId = compactText(input.projectId || input.projectBrain?.projectId, 180) || null;
  const authority = authorityState({ ...input, projectId }, options.projectId || null, options.projectPath || null);
  const sourceRefs = authority.sourceRefs;
  const status = authority.authorityStatus;
  const authoritative = authority.authoritative;
  const moduleIds = uniqueStrings([input.moduleIds, input.activeModuleIds, safeArray(input.modules).map((module) => module?.moduleId || module?.id || module)], 30);
  const context = { projectId, projectPath: options.projectPath || null, updatedAt: input.updatedAt || input.observedAt || options.now };
  const canonicalRecords = (records) => {
    const byId = new Map();
    for (const record of records.filter(Boolean)) {
      const key = record.id || stableHash(stableStringify(record));
      const current = byId.get(key);
      if (!current) {
        byId.set(key, record);
        continue;
      }
      const currentTime = Date.parse(current.observedAt || current.updatedAt || "") || 0;
      const recordTime = Date.parse(record.observedAt || record.updatedAt || "") || 0;
      if (recordTime !== currentTime) byId.set(key, recordTime > currentTime ? record : current);
      else byId.set(key, stableStringify(record).localeCompare(stableStringify(current)) >= 0 ? record : current);
    }
    return Array.from(byId.values()).sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")) || stableStringify(left).localeCompare(stableStringify(right)));
  };
  const taskStates = canonicalRecords(safeArray(input.taskStates || input.tasks || input.openTasks).map((item) => normalizeCommitment(item, context)));
  const blockers = canonicalRecords(safeArray(input.openBlockers || input.blockers).map((item) => normalizeCompactRecord(item, context, "blocker")));
  const nextActions = canonicalRecords(safeArray(input.nextActions || input.nextAction).map((item) => normalizeCompactRecord(item, context, "action")));
  const acceptedProgress = canonicalRecords(safeArray(input.acceptedProgress).map((item) => normalizeCompactRecord(item, context, "progress")));
  const childIsCurrent = (record) => record.authoritative
    && record.projectId === projectId
    && AUTHORITATIVE_STATUSES.has(record.authorityStatus)
    && normalizeSourceRefs(record.sourceRefs).length > 0;
  const currentTasks = authoritative ? taskStates.filter(childIsCurrent) : taskStates;
  const currentBlockers = authoritative ? blockers.filter(childIsCurrent) : blockers;
  const currentActions = authoritative ? nextActions.filter(childIsCurrent) : nextActions;
  const currentProgress = authoritative ? acceptedProgress.filter(childIsCurrent) : acceptedProgress;
  const priorReviewChildUpdates = safeArray(input.reviewChildUpdates)
    .filter((entry) => entry && typeof entry === "object" && inspectCompactSafety(entry).safe)
    .map((entry) => ({ kind: compactText(entry.kind || "child", 40), record: entry.record }));
  const reviewChildUpdates = authoritative ? [
    ...priorReviewChildUpdates,
    ...taskStates.filter((record) => !childIsCurrent(record)).map((record) => ({ kind: "task", record })),
    ...blockers.filter((record) => !childIsCurrent(record)).map((record) => ({ kind: "blocker", record })),
    ...nextActions.filter((record) => !childIsCurrent(record)).map((record) => ({ kind: "action", record })),
    ...acceptedProgress.filter((record) => !childIsCurrent(record)).map((record) => ({ kind: "progress", record })),
  ] : priorReviewChildUpdates;
  return {
    schemaVersion: PROJECT_CHECKPOINT_SCHEMA,
    projectId,
    phase: compactText(input.phase || input.currentPhase, 120) || null,
    moduleIds,
    acceptedProgress: currentProgress,
    taskStates: currentTasks,
    openTasks: currentTasks.filter((item) => !CLOSED_TASK_STATUSES.has(item.status)),
    blockers: currentBlockers,
    nextActions: currentActions,
    reviewChildUpdates,
    threadLineage: uniqueStrings([input.threadLineage, input.threadIds, input.ownerThreadHints], 20),
    canonicalDocRefs: normalizeSourceRefs(input.canonicalDocs || input.canonicalDocRefs, 16),
    authorityStatus: status,
    authoritative,
    scopeState: authority.scopeState,
    sourceRefs,
    originalGoal: compactText(input.originalGoal || input.originalProductGoal, 700) || null,
    architectureAnchors: uniqueStrings([input.architectureAnchors, input.architecturePrinciples], 100),
    observedAt: isoOrNull(input.observedAt || input.createdAt || options.now),
    updatedAt: isoOrNull(input.updatedAt || input.observedAt || options.now),
  };
}

function buildProjectCheckpoint(input = {}, options = {}) {
  const safety = inspectCompactSafety(input);
  if (!safety.safe) {
    return {
      schemaVersion: PROJECT_CHECKPOINT_SCHEMA,
      checkpointId: `checkpoint-rejected-${stableHash(JSON.stringify(safety.flags)).slice(0, 12)}`,
      projectId: compactText(input.projectId || options.projectId, 180) || null,
      authorityStatus: "rejected",
      authoritative: false,
      sourceRefs: [],
      openTasks: [],
      blockers: [],
      nextActions: [],
      safety: { compactMetadataOnly: true, rawThreadBodies: false, unsafeInputRejected: true },
    };
  }
  const core = checkpointCore(input, options);
  const eventIdentity = compactText(input.eventId || input.checkpointEventId || input.sourceEventId || input.taskId, 180) || null;
  const explicitObservedAt = isoOrNull(input.observedAt || input.createdAt);
  const identityRecord = (record) => {
    if (!record || typeof record !== "object") return record;
    const { updatedAt, observedAt, sourceRefs, ...stable } = record;
    return { ...stable, sourceRefs: normalizeSourceRefs(sourceRefs).map(sourceRefSignature) };
  };
  const identity = stableStringify({
    projectId: core.projectId,
    eventIdentity,
    observedAt: eventIdentity ? explicitObservedAt : null,
    phase: core.phase,
    moduleIds: core.moduleIds,
    originalGoal: core.originalGoal,
    architectureAnchors: core.architectureAnchors,
    acceptedProgress: core.acceptedProgress.map(identityRecord),
    taskStates: core.taskStates.map(identityRecord),
    blockers: core.blockers.map(identityRecord),
    nextActions: core.nextActions.map(identityRecord),
    threadLineage: core.threadLineage,
    sourceRefs: core.sourceRefs.map(sourceRefSignature),
  });
  return {
    ...core,
    checkpointId: compactText(input.checkpointId || input.id, 180) || `checkpoint-${slug(core.projectId || "project", "project")}-${stableHash(identity).slice(0, 16)}`,
    safety: { compactMetadataOnly: true, rawThreadBodies: false, unsafeInputRejected: false },
  };
}

function mergeRecordUpdates(left, right, options = {}) {
  const byId = new Map();
  const reviewRecords = [];
  const eligible = (record) => !options.protectAuthoritativeState || Boolean(
    record?.authoritative
    && record.projectId === options.projectId
    && AUTHORITATIVE_STATUSES.has(record.authorityStatus)
    && normalizeSourceRefs(record.sourceRefs).length > 0
  );
  for (const record of safeArray(left)) {
    if (!record) continue;
    if (!eligible(record)) {
      reviewRecords.push(record);
      continue;
    }
    const key = record.id || stableHash(stableStringify(record));
    byId.set(key, record);
  }
  for (const record of safeArray(right)) {
    if (!record) continue;
    if (!eligible(record)) {
      reviewRecords.push(record);
      continue;
    }
    const key = record.id || stableHash(stableStringify(record));
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, record);
      continue;
    }
    const existingTime = Date.parse(existing.observedAt || existing.updatedAt || "") || 0;
    const incomingTime = Date.parse(record.observedAt || record.updatedAt || "") || 0;
    byId.set(key, incomingTime >= existingTime ? record : existing);
  }
  return {
    records: Array.from(byId.values()).sort((leftRecord, rightRecord) => String(leftRecord.id || "").localeCompare(String(rightRecord.id || ""))),
    reviewRecords,
  };
}

function checkpointComparable(checkpoint) {
  const { updatedAt, safety, ...rest } = checkpoint;
  return stableStringify(rest);
}

function mergeProjectCheckpoints(existingInput, incomingInput, options = {}) {
  const existing = buildProjectCheckpoint(existingInput, options);
  const incoming = buildProjectCheckpoint(incomingInput, options);
  if (!existing.projectId || !incoming.projectId || existing.projectId !== incoming.projectId) {
    return {
      action: "reject_scope",
      status: "review",
      mutated: false,
      blockers: [!existing.projectId || !incoming.projectId ? "checkpoint_project_id_required" : "checkpoint_project_id_mismatch"],
      checkpoint: existing,
      incoming: { ...incoming, authoritative: false, authorityStatus: "review" },
    };
  }
  if (existing.authoritative && !incoming.authoritative) {
    return {
      action: "reject_authority",
      status: "review",
      mutated: false,
      blockers: ["non_authoritative_checkpoint_cannot_mutate_authoritative_checkpoint"],
      checkpoint: existing,
      incoming,
    };
  }
  const existingTime = Date.parse(existing.updatedAt || existing.observedAt || "") || 0;
  const incomingTime = Date.parse(incoming.updatedAt || incoming.observedAt || "") || 0;
  const winner = incomingTime >= existingTime ? incoming : existing;
  const mergeOptions = { projectId: existing.projectId, protectAuthoritativeState: existing.authoritative };
  const taskMerge = mergeRecordUpdates(existing.taskStates || existing.openTasks, incoming.taskStates || incoming.openTasks, mergeOptions);
  const progressMerge = mergeRecordUpdates(existing.acceptedProgress, incoming.acceptedProgress, mergeOptions);
  const blockerMerge = mergeRecordUpdates(existing.blockers, incoming.blockers, mergeOptions);
  const actionMerge = mergeRecordUpdates(existing.nextActions, incoming.nextActions, mergeOptions);
  const taskStates = taskMerge.records;
  const merged = {
    ...winner,
    checkpointId: existing.checkpointId === incoming.checkpointId ? existing.checkpointId : winner.checkpointId,
    moduleIds: uniqueStrings([existing.moduleIds, incoming.moduleIds], 30),
    acceptedProgress: progressMerge.records,
    taskStates,
    openTasks: taskStates.filter((item) => !CLOSED_TASK_STATUSES.has(item.status)),
    blockers: blockerMerge.records,
    nextActions: actionMerge.records,
    reviewChildUpdates: [
      ...safeArray(existing.reviewChildUpdates),
      ...safeArray(incoming.reviewChildUpdates),
      ...taskMerge.reviewRecords.map((record) => ({ kind: "task", record })),
      ...progressMerge.reviewRecords.map((record) => ({ kind: "progress", record })),
      ...blockerMerge.reviewRecords.map((record) => ({ kind: "blocker", record })),
      ...actionMerge.reviewRecords.map((record) => ({ kind: "action", record })),
    ],
    threadLineage: uniqueStrings([existing.threadLineage, incoming.threadLineage], 20),
    canonicalDocRefs: normalizeSourceRefs([existing.canonicalDocRefs, incoming.canonicalDocRefs], 16),
    sourceRefs: normalizeSourceRefs([existing.sourceRefs, incoming.sourceRefs], MAX_SOURCE_REFS),
    authoritative: existing.authoritative || incoming.authoritative,
    authorityStatus: existing.authorityStatus === "curated" || incoming.authorityStatus === "curated"
      ? "curated"
      : existing.authoritative || incoming.authoritative ? "accepted" : "review",
    updatedAt: [existing.updatedAt, incoming.updatedAt].filter(Boolean).sort().at(-1) || null,
    observedAt: [existing.observedAt, incoming.observedAt].filter(Boolean).sort().at(-1) || null,
  };
  const unchanged = checkpointComparable(existing) === checkpointComparable(merged);
  return {
    action: unchanged ? "noop" : existing.checkpointId === incoming.checkpointId ? "merge" : "advance",
    checkpoint: merged,
  };
}

function slotItem(record, value, type, context = {}) {
  if (!record || !inspectCompactSafety(record).safe) return null;
  const authority = authorityState(record, context.projectId || null, context.projectPath || null);
  const summary = compactText(value ?? record.statement ?? record.summary ?? record.title ?? record.value, 420);
  if (!summary) return null;
  const updatedAt = isoOrNull(record.updatedAt || record.observedAt || context.updatedAt);
  const expiresAt = isoOrNull(record.expiresAt || record.validTo);
  const referenceTime = isoOrNull(context.now);
  const noDecay = record.decayPolicy === "none_until_explicit_supersession" || record.noDecay === true;
  const stale = authority.authoritative && !noDecay && (
    normalizedKey(record.freshness) === "stale"
    || Boolean(expiresAt && referenceTime && expiresAt <= referenceTime)
  );
  return {
    id: compactText(record.anchorId || record.moduleId || record.checkpointId || record.id, 180)
      || `${type}-${stableHash([context.slot, summary].join("|")).slice(0, 14)}`,
    type,
    title: compactText(record.title || record.name || summary, 180),
    summary,
    authorityStatus: authority.authorityStatus,
    authoritative: authority.authoritative,
    projectId: authority.projectId,
    scopeState: authority.scopeState,
    freshness: compactText(record.freshness, 40) || "unknown",
    stale,
    conflict: record.conflict === true,
    mandatory: record.mandatory === true,
    noDecay,
    sourceRefs: authority.sourceRefs,
    updatedAt,
  };
}

function collectNamedRecords(container, keys) {
  if (!container || typeof container !== "object") return [];
  return keys.flatMap((key) => safeArray(container[key]));
}

function addSlotCandidate(slotCandidates, slot, record, value, type, context) {
  const item = slotItem(record, value, type, { ...context, slot });
  if (item) slotCandidates[slot].push(item);
}

function compactRecordValue(record) {
  if (record == null) return "";
  if (typeof record !== "object") return compactText(record, 420);
  return compactText(record.statement || record.summary || record.title || record.value || record.object || record.name, 420);
}

function sortSlotItems(items) {
  const authorityRank = { curated: 3, accepted: 2, review: 1, candidate: 0 };
  return [...items].sort((left, right) => {
    const authorityDelta = (authorityRank[right.authorityStatus] || -1) - (authorityRank[left.authorityStatus] || -1);
    if (authorityDelta) return authorityDelta;
    if (Number(right.mandatory) !== Number(left.mandatory)) return Number(right.mandatory) - Number(left.mandatory);
    const dateDelta = (Date.parse(right.updatedAt || "") || 0) - (Date.parse(left.updatedAt || "") || 0);
    if (dateDelta) return dateDelta;
    return left.id.localeCompare(right.id);
  });
}

function dedupeSlotItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of sortSlotItems(items)) {
    const key = `${item.id}|${normalizedKey(item.summary)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function countUnsafeRecords(values) {
  let count = 0;
  const seen = new WeakSet();
  function visit(value, key = "value") {
    if (value == null) return;
    if (typeof value === "string") {
      if (!inspectCompactSafety({ [key]: value }).safe) count += 1;
      return;
    }
    if (["number", "boolean", "bigint"].includes(typeof value) || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    const directScalars = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childValue == null || ["string", "number", "boolean", "bigint"].includes(typeof childValue)) directScalars[childKey] = childValue;
    }
    const recordLike = ["id", "title", "name", "anchorId", "moduleId", "checkpointId", "taskId", "category", "statement", "eventType", "canonicalPath", "productSummary"]
      .some((recordKey) => Object.prototype.hasOwnProperty.call(value, recordKey));
    if (recordLike) {
      if (Object.keys(directScalars).length > 0 && !inspectCompactSafety(directScalars).safe) count += 1;
    } else {
      for (const [childKey, childValue] of Object.entries(directScalars)) {
        if (typeof childValue === "string" && !inspectCompactSafety({ [childKey]: childValue }).safe) count += 1;
      }
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childValue && typeof childValue === "object") visit(childValue, childKey);
    }
  }
  visit(values);
  return count;
}

function buildProjectContinuityLedger(projectBrainInput, anchorInputs = [], moduleInputs = [], workingState = {}, factsEpisodesMetadata = {}, options = {}) {
  const projectBrain = normalizeProjectBrain(projectBrainInput, options);
  const projectId = projectBrain.projectId;
  const projectPath = projectBrain.canonicalPath;
  const anchors = safeArray(anchorInputs)
    .map((anchor) => normalizeProjectAnchor(anchor, { projectId, projectPath, now: options.now }))
    .filter(Boolean);
  const modules = safeArray(moduleInputs)
    .map((module) => normalizeModuleMemory(module, { projectId, projectPath, now: options.now }))
    .filter(Boolean);
  const checkpointInput = options.checkpoint || workingState?.checkpoint || projectBrainInput?.checkpoint || null;
  const checkpoint = checkpointInput ? buildProjectCheckpoint(checkpointInput, { projectId, projectPath, now: options.now }) : null;
  const slotCandidates = Object.fromEntries(PROJECT_CONTINUITY_SLOTS.map((slot) => [slot, []]));
  const projectContext = { projectId, projectPath, now: options.now, updatedAt: projectBrain.updatedAt };

  addSlotCandidate(slotCandidates, "project_identity", projectBrain, projectBrain.aliases[0] || projectBrain.projectId, "project_brain", projectContext);
  for (const anchor of anchors) {
    if (anchor.category === "identity") addSlotCandidate(slotCandidates, "project_identity", anchor, anchor.statement, "anchor", projectContext);
    if (anchor.category === "original_goal") addSlotCandidate(slotCandidates, "original_product_goal", anchor, anchor.statement, "anchor", projectContext);
    if (anchor.category === "architecture") addSlotCandidate(slotCandidates, "architecture_anchors", anchor, anchor.statement, "anchor", projectContext);
    if (["non_negotiable", "acceptance", "safety"].includes(anchor.category)) {
      addSlotCandidate(slotCandidates, "standing_rules", anchor, anchor.statement, "anchor", projectContext);
    }
  }

  for (const module of modules) {
    if (ACTIVE_MODULE_STATUSES.has(module.currentStatus)) {
      addSlotCandidate(slotCandidates, "active_modules", module, `${module.name}: ${module.purpose || module.currentStatus}`, "module", projectContext);
    }
    for (const task of module.tasks.filter((item) => !CLOSED_TASK_STATUSES.has(item.status))) {
      addSlotCandidate(slotCandidates, "open_tasks", { ...task, mandatory: task.authoritative, noDecay: task.authoritative }, task.title, "task", projectContext);
    }
    for (const blocker of module.blockers) addSlotCandidate(slotCandidates, "open_blockers", blocker, blocker.title, "blocker", projectContext);
  }

  if (projectBrain.phase) addSlotCandidate(slotCandidates, "current_phase", projectBrain, projectBrain.phase, "phase", projectContext);
  const namedMappings = [
    ["accepted_progress", ["acceptedProgress", "progress"], "progress"],
    ["open_tasks", ["openTasks", "tasks"], "task"],
    ["open_blockers", ["openBlockers", "blockers"], "blocker"],
    ["latest_failures", ["latestFailures", "failures"], "failure"],
    ["next_actions", ["nextActions", "nextAction"], "action"],
    ["thread_lineage", ["threadLineage", "threadHints", "threadIds"], "thread"],
    ["canonical_docs", ["canonicalDocs", "canonicalDocRefs"], "document"],
  ];
  const addNamedContainer = (container) => {
    for (const [slot, keys, type] of namedMappings) {
      for (const recordInput of collectNamedRecords(container, keys)) {
        const recordBase = typeof recordInput === "string" ? { title: recordInput } : recordInput;
        const record = ["open_tasks", "next_actions"].includes(slot)
          ? { ...recordBase, mandatory: true, noDecay: true }
          : recordBase;
        addSlotCandidate(slotCandidates, slot, record, compactRecordValue(record), type, projectContext);
      }
    }
  };
  addNamedContainer(workingState);
  addNamedContainer(factsEpisodesMetadata);

  for (const record of [...safeArray(factsEpisodesMetadata.facts), ...safeArray(factsEpisodesMetadata.episodes)]) {
    if (!record || typeof record !== "object") continue;
    const explicitSlot = normalizedKey(record.continuitySlot || record.slot).replace(/ /g, "_");
    if (PROJECT_CONTINUITY_SLOTS.includes(explicitSlot) && !["original_product_goal", "architecture_anchors"].includes(explicitSlot)) {
      addSlotCandidate(slotCandidates, explicitSlot, record, compactRecordValue(record), compactText(record.kind || record.type || "memory", 60), projectContext);
    }
    if (FAILURE_EVENT_RE.test(compactText(record.eventType || record.type, 80))) {
      addSlotCandidate(slotCandidates, "latest_failures", record, compactRecordValue(record), "episode", projectContext);
    }
  }

  const canonicalOwners = [projectBrain, ...anchors].filter((record) => record.authoritative && record.projectId === projectId);
  const canonicalRefs = normalizeSourceRefs(canonicalOwners.flatMap((record) => record.sourceRefs), 100, { projectPath })
    .filter((ref) => /prd|technical|architecture|design|readme|canonical/i.test(`${ref.kind} ${ref.artifactType} ${ref.title} ${ref.path}`));
  for (const ref of canonicalRefs) {
    const record = {
      id: sourceRefSignature(ref),
      projectId,
      title: ref.title || ref.path,
      authorityStatus: "accepted",
      sourceRefs: [ref],
    };
    addSlotCandidate(slotCandidates, "canonical_docs", record, ref.title || ref.path, "document", projectContext);
  }
  if (checkpoint) {
    addSlotCandidate(slotCandidates, "last_valid_checkpoint", checkpoint, checkpoint.checkpointId, "checkpoint", projectContext);
    if (checkpoint.originalGoal) {
      addSlotCandidate(slotCandidates, "original_product_goal", checkpoint, checkpoint.originalGoal, "checkpoint_original_goal", projectContext);
    }
    for (const architecture of checkpoint.architectureAnchors || []) {
      addSlotCandidate(slotCandidates, "architecture_anchors", checkpoint, architecture, "checkpoint_architecture", projectContext);
    }
  }

  const requiredSlots = PROJECT_CONTINUITY_SLOTS.filter((slot) => !safeArray(options.optionalSlots).includes(slot));
  const slots = {};
  for (const slot of PROJECT_CONTINUITY_SLOTS) {
    const allItems = dedupeSlotItems(slotCandidates[slot]);
    const current = allItems.filter((item) => item.authoritative && !item.stale);
    const staleItems = allItems.filter((item) => item.authoritative && item.stale);
    const reviewItems = allItems.filter((item) => !item.authoritative);
    const distinctValues = new Set(current.map((item) => normalizedKey(item.summary)));
    const conflict = current.some((item) => item.conflict) || SINGLE_VALUE_SLOTS.has(slot) && distinctValues.size > 1;
    const status = conflict ? "conflict" : current.length > 0 ? "filled" : staleItems.length > 0 ? "stale" : "missing";
    slots[slot] = {
      slot,
      required: requiredSlots.includes(slot),
      status,
      items: current,
      staleItems,
      reviewItems,
      authorityExpectation: "accepted_or_curated_with_direct_source_refs_and_exact_project",
    };
  }

  const filledSlots = PROJECT_CONTINUITY_SLOTS.filter((slot) => slots[slot].status === "filled");
  const missingSlots = PROJECT_CONTINUITY_SLOTS.filter((slot) => slots[slot].status === "missing");
  const staleSlots = PROJECT_CONTINUITY_SLOTS.filter((slot) => slots[slot].status === "stale");
  const conflictSlots = PROJECT_CONTINUITY_SLOTS.filter((slot) => slots[slot].status === "conflict");
  const satisfiedRequired = requiredSlots.filter((slot) => slots[slot].status === "filled").length;
  const sourceRefs = normalizeSourceRefs(PROJECT_CONTINUITY_SLOTS.flatMap((slot) => slots[slot].items.flatMap((item) => item.sourceRefs)), MAX_SOURCE_REFS);
  const metadataNamedRecords = namedMappings.flatMap(([, keys]) => collectNamedRecords(factsEpisodesMetadata, keys));
  const workingWithoutCheckpoint = workingState && typeof workingState === "object"
    ? Object.fromEntries(Object.entries(workingState).filter(([key]) => key !== "checkpoint"))
    : workingState;
  const unsafeCounts = {
    projectBrain: countUnsafeRecords(projectBrainInput),
    anchors: countUnsafeRecords(anchorInputs),
    modules: countUnsafeRecords(moduleInputs),
    workingState: countUnsafeRecords(workingWithoutCheckpoint),
    checkpoint: countUnsafeRecords(checkpointInput),
    metadataNamed: countUnsafeRecords(metadataNamedRecords),
    facts: countUnsafeRecords(factsEpisodesMetadata.facts),
    episodes: countUnsafeRecords(factsEpisodesMetadata.episodes),
  };
  unsafeCounts.total = Object.values(unsafeCounts).reduce((sum, count) => sum + count, 0);
  return {
    projectId,
    fixedSlots: PROJECT_CONTINUITY_SLOTS,
    requiredSlots,
    slots,
    filledSlots,
    missingSlots,
    staleSlots,
    conflictSlots,
    unsatisfiedSlots: requiredSlots.filter((slot) => slots[slot].status !== "filled"),
    coverage: requiredSlots.length === 0 ? 1 : Math.round((satisfiedRequired / requiredSlots.length) * 10000) / 10000,
    sourceRefs,
    unsafeCounts,
    authorityPolicy: {
      acceptedStatuses: Array.from(AUTHORITATIVE_STATUSES),
      sourceRefsRequired: true,
      exactProjectRequired: true,
      policyApprovesMemory: false,
    },
  };
}

function cueValues(input, keys) {
  return keys.flatMap((key) => safeArray(input?.[key])).flatMap((value) => {
    if (value == null) return [];
    if (typeof value === "object") return [value.name, value.id, value.path, value.code].filter(Boolean);
    return [value];
  });
}

function buildCueSet(input = {}, options = {}) {
  const payload = typeof input === "string" ? { taskGoal: input } : input || {};
  const maxCues = clampInteger(options.maxCues || payload.maxCues, MAX_CUES, 1, 64);
  const cues = [];
  const omittedUnsafe = [];
  function add(type, value, weight) {
    const text = compactText(value, 260);
    if (!text) return;
    const safety = inspectCompactSafety({ value: text });
    if (!safety.safe) {
      omittedUnsafe.push(type);
      return;
    }
    cues.push({ type, value: text, normalized: normalizedKey(text), weight });
  }

  for (const value of cueValues(payload, ["project", "projectId", "projectPath", "projectHints", "projectAliases"])) add("project", value, 1);
  for (const value of cueValues(payload, ["module", "moduleId", "moduleHints", "moduleAliases"])) add("module", value, 0.95);
  for (const value of cueValues(payload, ["file", "filePath", "fileHints", "paths"])) add("file", value, 0.95);
  for (const value of cueValues(payload, ["error", "errorCode", "errors", "testFailure"])) add("error", value, 0.9);
  for (const value of cueValues(payload, ["taskType", "task_type", "intent"])) add("task_type", value, 0.8);
  for (const value of cueValues(payload, ["thread", "threadId", "threadHints", "parentCeoThreadId"])) add("thread", value, 0.7);
  const taskGoal = compactText(payload.taskGoal || payload.query || payload.goal, 500);
  if (taskGoal) {
    add("task_goal", taskGoal, 0.85);
    for (const match of taskGoal.matchAll(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]+|[A-Za-z0-9_.-]+\.(?:cjs|mjs|js|ts|tsx|jsx|json|md|cpp|h|hpp|cs|py)/g)) add("file", match[0], 0.95);
    for (const match of taskGoal.matchAll(/\b(?:[A-Z][A-Z0-9_]{2,}|[A-Za-z]+Error|E[A-Z0-9_]{3,}|\d{3,5})\b/g)) add("error", match[0], 0.9);
  }

  const seen = new Set();
  const bounded = cues
    .sort((left, right) => right.weight - left.weight || left.type.localeCompare(right.type) || left.normalized.localeCompare(right.normalized))
    .filter((cue) => {
      const key = `${cue.type}:${cue.normalized}`;
      if (!cue.normalized || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxCues);
  return {
    cues: bounded,
    byType: Object.fromEntries(["project", "module", "file", "error", "task_type", "thread", "task_goal"].map((type) => [type, bounded.filter((cue) => cue.type === type).map((cue) => cue.value)])),
    fingerprint: stableHash(bounded.map((cue) => `${cue.type}:${cue.normalized}`).join("|")).slice(0, 24),
    bounded: true,
    maxCues,
    omittedUnsafeCueCount: omittedUnsafe.length,
  };
}

function hintsFromInput(input) {
  if (typeof input === "string") return [{ type: "hint", value: input, normalized: normalizedKey(input) }];
  if (Array.isArray(input)) return input.flatMap(hintsFromInput);
  if (!input || typeof input !== "object") return [];
  if (Array.isArray(input.cues)) return input.cues.map((cue) => ({ type: cue.type || "hint", value: cue.value, normalized: normalizedKey(cue.normalized || cue.value) }));
  return buildCueSet(input).cues;
}

function resolveProjectBrain(projectInputs, hints, options = {}) {
  const reviewMode = options.reviewMode === true || options.mode === "review";
  const minScore = clampInteger(options.minScore, DEFAULT_RESOLUTION_MIN_SCORE, 1, 1000);
  const candidates = safeArray(projectInputs).slice(0, clampInteger(options.maxCandidates, 100, 1, 500))
    .map((project) => normalizeProjectBrain(project, options))
    .filter((project) => project.authorityStatus !== "rejected")
    .filter((project) => reviewMode || project.authoritative);
  const hintValues = hintsFromInput(hints);
  const matches = candidates.map((project) => {
    let score = 0;
    const reasons = [];
    const aliases = project.aliases.map(normalizedKey);
    const projectPath = normalizedKey(project.canonicalPath);
    for (const hint of hintValues) {
      const value = hint.normalized;
      if (!value) continue;
      const pathLike = value.includes("/") || /^[a-z]:/.test(value);
      if (value === normalizedKey(project.projectId)) {
        score += 140;
        reasons.push("project_id:exact");
      }
      if (projectPath && value === projectPath) {
        score += 130;
        reasons.push("canonical_path:exact");
      } else if (projectPath && value.startsWith(`${projectPath}/`)) {
        score += 80;
        reasons.push("canonical_path:child");
      }
      if (!pathLike && aliases.includes(value)) {
        score += 110;
        reasons.push("alias:exact");
      } else if (!pathLike && value.length >= MIN_PARTIAL_ALIAS_LENGTH && aliases.some((alias) => alias.length >= MIN_PARTIAL_ALIAS_LENGTH && (value.includes(alias) || alias.includes(value)))) {
        score += 45;
        reasons.push("alias:partial");
      }
    }
    return { project, score, reasons: uniqueStrings(reasons, 12) };
  }).filter((match) => match.score >= minScore)
    .sort((left, right) => right.score - left.score || left.project.projectId.localeCompare(right.project.projectId));
  const topScore = matches[0]?.score || 0;
  const topMatches = matches.filter((match) => match.score === topScore);
  const ambiguous = topMatches.length > 1;
  return {
    status: ambiguous ? "ambiguous" : matches.length > 0 ? "resolved" : "not_found",
    ambiguous,
    match: ambiguous ? null : matches[0]?.project || null,
    score: topScore,
    reasons: ambiguous ? ["resolution:ambiguous_top_score"] : matches[0]?.reasons || [],
    ambiguousProjectIds: ambiguous ? topMatches.map((match) => match.project.projectId).sort() : [],
    matches: matches.slice(0, clampInteger(options.topK, 5, 1, 20)),
    boundedCandidates: candidates.length,
  };
}

function resolveModuleMemory(moduleInputs, hints, options = {}) {
  const projectId = options.projectId || null;
  const reviewMode = options.reviewMode === true || options.mode === "review";
  const minScore = clampInteger(options.minScore, DEFAULT_RESOLUTION_MIN_SCORE, 1, 1000);
  const candidates = safeArray(moduleInputs).slice(0, clampInteger(options.maxCandidates, 160, 1, 800))
    .map((module) => normalizeModuleMemory(module, { now: options.now }))
    .filter(Boolean);
  const candidateProjectIds = uniqueStrings(candidates.map((module) => module.projectId).filter(Boolean), 800);
  const hasUnscoped = candidates.some((module) => !module.projectId);
  if (!projectId && (candidateProjectIds.length > 1 || hasUnscoped && candidateProjectIds.length > 0)) {
    return {
      status: "project_required",
      ambiguous: true,
      match: null,
      score: 0,
      reasons: ["project_id:required_for_cross_project_module_resolution"],
      matches: [],
      candidateProjectIds,
      boundedCandidates: candidates.length,
    };
  }
  const scopedCandidates = candidates
    .filter((module) => projectId ? module.projectId === projectId : Boolean(module.projectId))
    .filter((module) => reviewMode || module.authoritative && ACTIVE_MODULE_STATUSES.has(module.currentStatus));
  const hintValues = hintsFromInput(hints);
  const matches = scopedCandidates.map((module) => {
    let score = 0;
    const reasons = [];
    const aliases = module.aliases.map(normalizedKey);
    const files = module.fileHints.map(normalizedKey);
    const errors = module.errorCues.map(normalizedKey);
    for (const hint of hintValues) {
      const value = hint.normalized;
      if (!value) continue;
      const fileLike = hint.type === "file" || value.includes("/") || /^[a-z]:/.test(value);
      if (value === normalizedKey(module.moduleId)) {
        score += 140;
        reasons.push("module_id:exact");
      }
      if (!fileLike && aliases.includes(value)) {
        score += 120;
        reasons.push("module_alias:exact");
      } else if (!fileLike && value.length >= MIN_PARTIAL_ALIAS_LENGTH && aliases.some((alias) => alias.length >= MIN_PARTIAL_ALIAS_LENGTH && (value.includes(alias) || alias.includes(value)))) {
        score += 55;
        reasons.push("module_alias:partial");
      }
      if (files.some((file) => value === file || value.endsWith(`/${file}`) || file.includes("/") && value.startsWith(`${file}/`))) {
        score += 135;
        reasons.push("file:exact");
      }
      if (errors.includes(value)) {
        score += 130;
        reasons.push("error:exact");
      } else if (value.length >= MIN_PARTIAL_ALIAS_LENGTH && errors.some((error) => error.length >= MIN_PARTIAL_ALIAS_LENGTH && (value.includes(error) || error.includes(value)))) {
        score += 75;
        reasons.push("error:partial");
      }
    }
    return { module, score, reasons: uniqueStrings(reasons, 12) };
  }).filter((match) => match.score >= minScore)
    .sort((left, right) => right.score - left.score || left.module.moduleId.localeCompare(right.module.moduleId));
  const topScore = matches[0]?.score || 0;
  const topMatches = matches.filter((match) => match.score === topScore);
  const ambiguous = topMatches.length > 1;
  return {
    status: ambiguous ? "ambiguous" : matches.length > 0 ? "resolved" : "not_found",
    ambiguous,
    match: ambiguous ? null : matches[0]?.module || null,
    score: topScore,
    reasons: ambiguous ? ["resolution:ambiguous_top_score"] : matches[0]?.reasons || [],
    ambiguousModuleIds: ambiguous ? topMatches.map((match) => match.module.moduleId).sort() : [],
    matches: matches.slice(0, clampInteger(options.topK, 5, 1, 20)),
    boundedCandidates: scopedCandidates.length,
  };
}

function recommendedReadOrder(ledger) {
  const order = [
    "project_identity",
    "original_product_goal",
    "architecture_anchors",
    "standing_rules",
    "current_phase",
    "active_modules",
    "accepted_progress",
    "open_tasks",
    "open_blockers",
    "latest_failures",
    "next_actions",
    "thread_lineage",
    "canonical_docs",
    "last_valid_checkpoint",
  ];
  if (ledger.unsatisfiedSlots.includes("original_product_goal") || ledger.unsatisfiedSlots.includes("architecture_anchors")) {
    return ["canonical_docs", ...order.filter((slot) => slot !== "canonical_docs")];
  }
  return order;
}

function packetItem(item, pointerOnly = false) {
  const sourcePointers = normalizeSourceRefs(item.sourceRefs, pointerOnly ? 1 : 2).map((ref) => ({
    kind: ref.kind,
    id: ref.id,
    path: ref.path ? compactText(ref.path, 180) : null,
    hash: ref.hash,
  }));
  return {
    id: item.id,
    type: item.type,
    title: compactText(item.title, pointerOnly ? 80 : 140),
    summary: pointerOnly ? undefined : compactText(item.summary, 260),
    authorityStatus: item.authorityStatus,
    mandatory: item.mandatory || undefined,
    noDecay: item.noDecay || undefined,
    sourceRefCount: normalizeSourceRefs(item.sourceRefs, 8).length,
    sourcePointers,
    pointerOnly: pointerOnly || undefined,
  };
}

function estimateTokens(value) {
  const text = JSON.stringify(value);
  const chineseChars = (text.match(/\p{Script=Han}/gu) || []).length;
  return Math.max(20, Math.ceil(chineseChars / 1.7 + (text.length - chineseChars) / 4));
}

function buildProjectContinuityPacket(projectBrainInput, anchorInputs = [], moduleInputs = [], workingState = {}, factsEpisodesMetadata = {}, options = {}) {
  const projectBrain = normalizeProjectBrain(projectBrainInput, options);
  const ledger = buildProjectContinuityLedger(projectBrainInput, anchorInputs, moduleInputs, workingState, factsEpisodesMetadata, options);
  const maxItemsPerSlot = clampInteger(options.maxItemsPerSlot, 8, 1, MAX_SLOT_ITEMS);
  const requestedPacketItems = Number.isFinite(Number(options.maxPacketItems)) ? Math.max(1, Math.floor(Number(options.maxPacketItems))) : DEFAULT_PACKET_ITEM_BUDGET;
  const effectivePacketItems = clampInteger(requestedPacketItems, DEFAULT_PACKET_ITEM_BUDGET, 1, 100);
  const requestedPacketChars = Number.isFinite(Number(options.maxPacketChars)) ? Math.max(1, Math.floor(Number(options.maxPacketChars))) : DEFAULT_PACKET_CHAR_BUDGET;
  let effectivePacketChars = clampInteger(requestedPacketChars, DEFAULT_PACKET_CHAR_BUDGET, 8000, HARD_PACKET_CHAR_CAP);
  const requestedTokenBudget = Number.isFinite(Number(options.tokenBudget))
    ? Math.max(1, Math.floor(Number(options.tokenBudget)))
    : DEFAULT_PACKET_TOKEN_BUDGET;
  let effectiveTokenBudget = clampInteger(requestedTokenBudget, DEFAULT_PACKET_TOKEN_BUDGET, MIN_PACKET_TOKEN_BUDGET, HARD_PACKET_TOKEN_CAP);
  let fixedEnvelopeMinimumTokens = 0;
  let fixedEnvelopeMinimumChars = 0;
  let progressMinimumTokens = 0;
  let progressMinimumChars = 0;
  let progressRequiredTokens = 0;
  let progressRequiredChars = 0;
  let adjustedMinimum = requestedTokenBudget !== effectiveTokenBudget
    || requestedPacketChars !== effectivePacketChars
    || requestedPacketItems !== effectivePacketItems;
  const slotOrder = recommendedReadOrder(ledger);
  const prioritySlots = new Set([
    "project_identity",
    "original_product_goal",
    "architecture_anchors",
    "standing_rules",
    "accepted_progress",
    "open_tasks",
    "open_blockers",
    "latest_failures",
    "next_actions",
  ]);
  const descriptors = [];
  for (const slot of slotOrder) {
    const sourceItems = ledger.slots[slot].status === "stale" ? ledger.slots[slot].staleItems : ledger.slots[slot].items;
    const retainedItems = sourceItems.filter((item) => item.mandatory || item.noDecay);
    const boundedItems = sourceItems.filter((item) => !item.mandatory && !item.noDecay).slice(0, maxItemsPerSlot);
    const packetCandidates = dedupeSlotItems([...retainedItems, ...boundedItems]);
    for (const [index, item] of packetCandidates.entries()) {
      descriptors.push({
        slot,
        item,
        retained: item.mandatory || item.noDecay ? 1 : 0,
        seed: index === 0 ? 1 : 0,
        priority: prioritySlots.has(slot) ? 1 : 0,
      });
    }
  }

  function descriptorKey(descriptor) {
    return stableStringify({
      slot: descriptor.slot,
      id: descriptor.item.id,
      summary: normalizedKey(descriptor.item.summary),
      authorityStatus: descriptor.item.authorityStatus,
      mandatory: descriptor.item.mandatory === true,
      noDecay: descriptor.item.noDecay === true,
      sourceRefs: normalizeSourceRefs(descriptor.item.sourceRefs).map(sourceRefSignature),
    });
  }

  const mandatoryDescriptors = descriptors
    .filter((descriptor) => descriptor.retained)
    .sort((left, right) => slotOrder.indexOf(left.slot) - slotOrder.indexOf(right.slot)
      || left.item.id.localeCompare(right.item.id)
      || normalizedKey(left.item.summary).localeCompare(normalizedKey(right.item.summary)));
  const mandatoryManifestFingerprint = stableHash(mandatoryDescriptors.map(descriptorKey).join("\n")).slice(0, 24);
  const mandatoryDescriptorKeys = mandatoryDescriptors.map(descriptorKey);
  const prefixDigests = [stableHash(`mc2|${mandatoryManifestFingerprint}|${mandatoryDescriptors.length}`).slice(0, 32)];
  for (const descriptor of mandatoryDescriptorKeys) {
    prefixDigests.push(stableHash(`${prefixDigests.at(-1)}\n${descriptor}`).slice(0, 32));
  }
  function mandatoryCursorAt(offset) {
    if (!Number.isInteger(offset) || offset <= 0 || offset >= mandatoryDescriptors.length) return null;
    const payload = stableStringify({ v: 2, m: mandatoryManifestFingerprint, o: offset, p: prefixDigests[offset] });
    return `mc2.${Buffer.from(payload, "utf8").toString("base64url")}`;
  }
  let mandatoryOffset = 0;
  let cursorInvalid = false;
  if (options.mandatoryCursor != null && options.mandatoryCursor !== "") {
    const cursor = typeof options.mandatoryCursor === "string" ? options.mandatoryCursor : "";
    try {
      if (!/^mc2\.[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("invalid_cursor_format");
      const payload = JSON.parse(Buffer.from(cursor.slice(4), "base64url").toString("utf8"));
      const offset = payload?.o;
      if (payload?.v !== 2 || payload?.m !== mandatoryManifestFingerprint) throw new Error("invalid_cursor_manifest");
      if (!Number.isInteger(offset) || offset <= 0 || offset >= mandatoryDescriptors.length) throw new Error("invalid_cursor_offset");
      if (payload?.p !== prefixDigests[offset] || cursor !== mandatoryCursorAt(offset)) throw new Error("invalid_cursor_prefix");
      mandatoryOffset = offset;
    } catch {
      cursorInvalid = true;
    }
  }
  const nonMandatoryDescriptors = descriptors
    .filter((descriptor) => !descriptor.retained)
    .sort((left, right) => right.priority - left.priority
      || slotOrder.indexOf(left.slot) - slotOrder.indexOf(right.slot)
      || left.item.id.localeCompare(right.item.id));

  function assemblePacket(selectedDescriptors, pageState) {
    const selected = Object.fromEntries(PROJECT_CONTINUITY_SLOTS.map((slot) => [slot, []]));
    const selectedSourceRecords = [];
    for (const descriptor of selectedDescriptors) {
      selected[descriptor.slot].push(packetItem(descriptor.item, descriptor.pointerOnly === true));
      selectedSourceRecords.push(...(descriptor.pointerOnly === true
        ? safeArray(descriptor.item.sourceRefs).slice(0, 1)
        : safeArray(descriptor.item.sourceRefs)));
    }
    for (const slot of PROJECT_CONTINUITY_SLOTS) {
      selected[slot].sort((left, right) => left.id.localeCompare(right.id));
    }
    const slots = {};
    for (const slot of PROJECT_CONTINUITY_SLOTS) {
      const ledgerSlot = ledger.slots[slot];
      const availableItems = ledgerSlot.status === "stale" ? ledgerSlot.staleItems : ledgerSlot.items;
      slots[slot] = {
        status: ledgerSlot.status,
        required: ledgerSlot.required,
        itemCount: ledgerSlot.items.length,
        reviewCandidateCount: ledgerSlot.reviewItems.length,
        staleItemCount: ledgerSlot.staleItems.length,
        items: selected[slot],
        omittedForPage: Math.max(0, availableItems.length - selected[slot].length),
      };
    }
    const sourceRefs = normalizeSourceRefs(selectedSourceRecords, Math.max(MAX_SOURCE_REFS, selectedSourceRecords.length));
    const packet = {
      schemaVersion: PROJECT_CONTINUITY_PACKET_SCHEMA,
      project: {
        projectId: projectBrain.projectId,
        canonicalPath: projectBrain.canonicalPath,
        aliases: projectBrain.aliases.slice(0, 12),
        productSummary: compactText(projectBrain.productSummary, 360),
        phase: projectBrain.phase,
        authorityStatus: projectBrain.authorityStatus,
      },
      continuity: {
        coverage: ledger.coverage,
        filledSlots: ledger.filledSlots,
        missingSlots: ledger.missingSlots,
        staleSlots: ledger.staleSlots,
        conflictSlots: ledger.conflictSlots,
        unsatisfiedSlots: ledger.unsatisfiedSlots,
        slots,
      },
      recommendedReadOrder: slotOrder,
      sourceRefs,
      mandatoryTotal: mandatoryDescriptors.length,
      mandatoryReturned: pageState.mandatoryReturned || 0,
      mandatoryRemaining: pageState.mandatoryRemaining ?? mandatoryDescriptors.length,
      mandatoryCursor: mandatoryCursorAt(mandatoryOffset),
      nextCursor: pageState.nextCursor || null,
      manifestFingerprint: mandatoryManifestFingerprint,
      requiresContinuation: pageState.requiresContinuation === true,
      tokenBudget: effectiveTokenBudget,
      tokenEstimate: 0,
      characterEstimate: 0,
      budget: {
        requested: requestedTokenBudget,
        effective: effectiveTokenBudget,
        requestedOverflow: requestedTokenBudget < progressRequiredTokens || requestedPacketChars < progressRequiredChars || requestedPacketItems < 1,
        adjustedMinimum,
        overflow: pageState.blockedByBudget === true || requestedTokenBudget < effectiveTokenBudget || requestedPacketChars < effectivePacketChars,
        partial: pageState.requiresContinuation === true || pageState.optionalTruncated > 0 || pageState.blockedByBudget === true,
        optionalTruncated: pageState.optionalTruncated || 0,
        requestedPacketItems,
        effectivePacketItems,
        requestedPacketChars,
        effectivePacketChars,
        maxPacketItems: effectivePacketItems,
        maxPacketChars: effectivePacketChars,
        fixedEnvelopeMinimumTokens,
        fixedEnvelopeMinimumChars,
        progressMinimumTokens,
        progressMinimumChars,
        progressRequiredTokens,
        progressRequiredChars,
        hardTokenCap: HARD_PACKET_TOKEN_CAP,
        hardCharCap: HARD_PACKET_CHAR_CAP,
        slotLimitOverflow: PROJECT_CONTINUITY_SLOTS.filter((slot) => selected[slot].length > maxItemsPerSlot),
        invariants: ["bounded_packet_page", "mandatory_manifest_continuation"],
      },
      retention: {
        longTermMandatoryRetained: true,
        allMandatoryNoDecayComplete: pageState.requiresContinuation !== true && !cursorInvalid,
        pageItemCount: selectedDescriptors.length,
      },
      mandatoryManifest: {
        fingerprint: mandatoryManifestFingerprint,
        mandatoryTotal: mandatoryDescriptors.length,
        mandatoryReturned: pageState.mandatoryReturned || 0,
        mandatoryRemaining: pageState.mandatoryRemaining ?? mandatoryDescriptors.length,
        mandatoryCursor: mandatoryCursorAt(mandatoryOffset),
        nextCursor: pageState.nextCursor || null,
        requiresContinuation: pageState.requiresContinuation === true,
        complete: pageState.requiresContinuation !== true && !cursorInvalid,
        cursorInvalid,
        pageStart: mandatoryOffset,
        pageEndExclusive: mandatoryOffset + (pageState.mandatoryReturned || 0),
      },
      safety: {
        compactMetadataOnly: true,
        rawThreadBodiesIncluded: false,
        coldHistoryPolicy: "pointer_only_explicit",
        invokesModels: false,
        scansFiles: false,
        startsTimers: false,
        policyApprovesMemory: false,
        unsafeCounts: ledger.unsafeCounts,
        omittedUnsafeRecords: ledger.unsafeCounts.total,
        budgetOverflow: pageState.blockedByBudget === true,
      },
      performance: {
        descriptorCount: descriptors.length,
        mandatoryManifestCount: mandatoryDescriptors.length,
        boundedPage: true,
      },
    };
    packet.packetId = `continuity-${slug(projectBrain.projectId, "project")}-${"x".repeat(16)}`;
    for (let index = 0; index < 6; index += 1) {
      const previousTokens = packet.tokenEstimate;
      const previousChars = packet.characterEstimate;
      packet.characterEstimate = JSON.stringify(packet).length;
      packet.tokenEstimate = estimateTokens(packet);
      packet.packetId = `continuity-${slug(projectBrain.projectId, "project")}-${stableHash(stableStringify(packet)).slice(0, 16)}`;
      if (packet.tokenEstimate === previousTokens && packet.characterEstimate === previousChars) break;
    }
    return packet;
  }

  function fitsPacket(packet) {
    return packet.tokenEstimate <= effectiveTokenBudget
      && packet.characterEstimate <= effectivePacketChars
      && packet.retention.pageItemCount <= effectivePacketItems;
  }

  if (cursorInvalid) {
    return assemblePacket([], {
      mandatoryReturned: 0,
      mandatoryRemaining: mandatoryDescriptors.length,
      nextCursor: null,
      requiresContinuation: false,
      optionalTruncated: nonMandatoryDescriptors.length,
      blockedByBudget: false,
    });
  }

  const firstMandatoryDescriptor = mandatoryDescriptors[mandatoryOffset] || null;
  for (let sizingPass = 0; sizingPass < 4; sizingPass += 1) {
    const fixedPacket = assemblePacket([], {
      mandatoryReturned: 0,
      mandatoryRemaining: mandatoryDescriptors.length - mandatoryOffset,
      nextCursor: mandatoryCursorAt(mandatoryOffset),
      requiresContinuation: mandatoryDescriptors.length > mandatoryOffset,
      optionalTruncated: nonMandatoryDescriptors.length,
    });
    fixedEnvelopeMinimumTokens = fixedPacket.tokenEstimate;
    fixedEnvelopeMinimumChars = fixedPacket.characterEstimate;
    const progressPacket = firstMandatoryDescriptor
      ? assemblePacket([{ ...firstMandatoryDescriptor, pointerOnly: true }], {
        mandatoryReturned: 1,
        mandatoryRemaining: Math.max(0, mandatoryDescriptors.length - mandatoryOffset - 1),
        nextCursor: mandatoryCursorAt(mandatoryOffset + 1),
        requiresContinuation: mandatoryDescriptors.length - mandatoryOffset - 1 > 0,
        optionalTruncated: nonMandatoryDescriptors.length,
      })
      : fixedPacket;
    progressMinimumTokens = progressPacket.tokenEstimate;
    progressMinimumChars = progressPacket.characterEstimate;
    progressRequiredTokens = firstMandatoryDescriptor ? Math.max(progressMinimumTokens, MIN_PROGRESS_TOKEN_BUDGET) : progressMinimumTokens;
    progressRequiredChars = firstMandatoryDescriptor ? Math.max(progressMinimumChars, MIN_PROGRESS_CHAR_BUDGET) : progressMinimumChars;
    const nextTokenBudget = Math.min(HARD_PACKET_TOKEN_CAP, Math.max(effectiveTokenBudget, progressRequiredTokens));
    const nextCharBudget = Math.min(HARD_PACKET_CHAR_CAP, Math.max(effectivePacketChars, progressRequiredChars));
    adjustedMinimum = adjustedMinimum || nextTokenBudget !== effectiveTokenBudget || nextCharBudget !== effectivePacketChars;
    if (nextTokenBudget === effectiveTokenBudget && nextCharBudget === effectivePacketChars) break;
    effectiveTokenBudget = nextTokenBudget;
    effectivePacketChars = nextCharBudget;
  }

  let selectedDescriptors = [];
  let mandatoryReturned = 0;
  let blockedByBudget = false;
  const remainingMandatory = mandatoryDescriptors.slice(mandatoryOffset);
  for (const descriptor of remainingMandatory) {
    if (selectedDescriptors.length >= effectivePacketItems) break;
    const trialReturned = mandatoryReturned + 1;
    const trialRemaining = mandatoryDescriptors.length - mandatoryOffset - trialReturned;
    const trial = assemblePacket([...selectedDescriptors, descriptor], {
      mandatoryReturned: trialReturned,
      mandatoryRemaining: trialRemaining,
      nextCursor: mandatoryCursorAt(mandatoryOffset + trialReturned),
      requiresContinuation: trialRemaining > 0,
      optionalTruncated: nonMandatoryDescriptors.length,
    });
    if (!fitsPacket(trial)) {
      const pointerTrial = assemblePacket([...selectedDescriptors, { ...descriptor, pointerOnly: true }], {
        mandatoryReturned: trialReturned,
        mandatoryRemaining: trialRemaining,
        nextCursor: mandatoryCursorAt(mandatoryOffset + trialReturned),
        requiresContinuation: trialRemaining > 0,
        optionalTruncated: nonMandatoryDescriptors.length,
      });
      if (fitsPacket(pointerTrial)) {
        selectedDescriptors.push({ ...descriptor, pointerOnly: true });
        mandatoryReturned = trialReturned;
        continue;
      }
      if (mandatoryReturned === 0) blockedByBudget = true;
      break;
    }
    selectedDescriptors.push(descriptor);
    mandatoryReturned = trialReturned;
  }

  const selectedKeys = new Set(selectedDescriptors.map(descriptorKey));
  const representedSlots = new Set(selectedDescriptors.map((descriptor) => descriptor.slot));
  const floorDescriptors = [];
  for (const slot of slotOrder) {
    if (representedSlots.has(slot)) continue;
    const floor = nonMandatoryDescriptors.find((descriptor) => descriptor.slot === slot);
    if (floor && !selectedKeys.has(descriptorKey(floor))) floorDescriptors.push(floor);
  }
  const optionalDescriptors = [
    ...floorDescriptors,
    ...nonMandatoryDescriptors.filter((descriptor) => !floorDescriptors.some((floor) => descriptorKey(floor) === descriptorKey(descriptor))),
  ];
  let optionalTruncated = 0;
  for (const descriptor of optionalDescriptors) {
    if (selectedDescriptors.length >= effectivePacketItems) {
      optionalTruncated += 1;
      continue;
    }
    const trialRemaining = mandatoryDescriptors.length - mandatoryOffset - mandatoryReturned;
    const trial = assemblePacket([...selectedDescriptors, descriptor], {
      mandatoryReturned,
      mandatoryRemaining: trialRemaining,
      nextCursor: mandatoryCursorAt(mandatoryOffset + mandatoryReturned),
      requiresContinuation: trialRemaining > 0,
      optionalTruncated,
      blockedByBudget,
    });
    if (fitsPacket(trial)) {
      selectedDescriptors.push(descriptor);
      selectedKeys.add(descriptorKey(descriptor));
    } else {
      optionalTruncated += 1;
    }
  }

  const mandatoryRemaining = mandatoryDescriptors.length - mandatoryOffset - mandatoryReturned;
  const nextCursor = mandatoryCursorAt(mandatoryOffset + mandatoryReturned);
  let finalPacket = assemblePacket(selectedDescriptors, {
    mandatoryReturned,
    mandatoryRemaining,
    nextCursor,
    requiresContinuation: mandatoryRemaining > 0,
    optionalTruncated,
    blockedByBudget,
  });
  while (!fitsPacket(finalPacket) && selectedDescriptors.some((descriptor) => !descriptor.retained)) {
    const optionalIndex = selectedDescriptors.findLastIndex((descriptor) => !descriptor.retained);
    selectedDescriptors.splice(optionalIndex, 1);
    optionalTruncated += 1;
    finalPacket = assemblePacket(selectedDescriptors, {
      mandatoryReturned,
      mandatoryRemaining,
      nextCursor,
      requiresContinuation: mandatoryRemaining > 0,
      optionalTruncated,
      blockedByBudget,
    });
  }
  return finalPacket;
}

const buildProjectBrain = normalizeProjectBrain;
const buildProjectAnchor = normalizeProjectAnchor;
const buildModuleMemory = normalizeModuleMemory;
const resolveProject = resolveProjectBrain;
const resolveModule = resolveModuleMemory;

module.exports = {
  AUTHORITATIVE_STATUSES,
  PROJECT_ANCHOR_CATEGORIES,
  PROJECT_ANCHOR_SCHEMA,
  PROJECT_BRAIN_SCHEMA,
  PROJECT_CHECKPOINT_SCHEMA,
  PROJECT_CONTINUITY_PACKET_SCHEMA,
  PROJECT_CONTINUITY_SLOTS,
  MODULE_MEMORY_SCHEMA,
  buildCueSet,
  buildModuleMemory,
  buildProjectAnchor,
  buildProjectBrain,
  buildProjectCheckpoint,
  buildProjectContinuityLedger,
  buildProjectContinuityPacket,
  inspectCompactSafety,
  mergeProjectCheckpoints,
  normalizeModuleMemory,
  normalizeProjectAnchor,
  normalizeProjectBrain,
  resolveModule,
  resolveModuleMemory,
  resolveProject,
  resolveProjectBrain,
};
