const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const {
  authorizeMemoryAction,
  buildAuthorityDecision,
  createMemoryAuthorityTrustContext,
  hydrateAuthorityReceipt,
  normalizeLegacyMemoryRecord,
  normalizeStandingRule,
  queryAuthorizedMemory,
  registerAuthorityReceipt,
  registerAuthorityPrincipal,
  registerProjectBinding,
} = require("./memoryAuthorityPolicy.cjs");
const {
  PROJECT_CONTINUITY_SLOTS,
  buildCueSet,
  buildModuleMemory,
  buildProjectAnchor,
  buildProjectBrain,
  buildProjectContinuityPacket,
  resolveProjectBrain,
  resolveModuleMemory,
} = require("./projectBrainPolicy.cjs");
const { buildMemoryFormationPlan } = require("./memoryFormationPolicy.cjs");
const {
  appendAuthorityReceipt,
  appendProjectCheckpoint,
  getAuthorityReceipt,
  getMemoryDecision,
  getProjectBrain,
  indexPath,
  inspectMemoryCorePayload,
  MEMORY_CORE_RECORD_SPECS,
  listAuthorityReceipts,
  listMemoryConstraints,
  listMemoryDecisions,
  listMemoryEpisodes,
  listMemoryFacts,
  listModuleMemories,
  listProjectAnchors,
  listProjectBrains,
  listProjectCheckpoints,
  listStandingRules,
  upsertMemoryPrincipal,
  upsertModuleMemory,
  upsertProjectAnchor,
  upsertProjectBinding,
  upsertMemoryConstraint,
  upsertMemoryDecision,
  upsertMemoryEpisode,
  upsertProjectBrain,
} = require("./memoryRuntimeIndexStore.cjs");

const MEMORY_CORE_RUNTIME_SCHEMA = "zhixia.memory_core_runtime.v1";
const PRIVATE_STATE_DIR = "private";
const SIGNING_KEY_FILE = "memory-core-authority.key";
const MAX_PACKET_ITEMS = 48;
const MAX_SOURCE_REFS = 24;
const MAX_REVIEW_ITEMS = 200;
const MAX_CONTINUITY_PAGES = 128;
const MAX_CONTINUITY_MANDATORY_ITEMS = 4096;
const CURRENT_STATUSES = new Set(["active", "accepted", "curated", "current", "ready", "confirmed", "completed", "in_progress", "hot"]);
const REVIEW_STATUSES = new Set(["candidate", "review", "waiting_review", "blocked"]);
const REVIEW_QUERY_TYPES = new Set(["retrieve_precedent", "review_gate", "thread_recovery", "history_audit", "archive_candidate", "workflow_reuse"]);
const REVIEW_EVENT_TYPES = new Set(["revise", "block", "user_rule", "user_correction", "test_failure", "install", "release"]);
const AUTO_ACCEPT_EVENT_TYPES = new Set(["accepted", "test_pass", "build", "checkpoint", "thread_recovery", "handoff"]);
const LEGACY_FACT_AUTHORITY_LINK_TYPE = "legacy_fact_authority_link";
const FORBIDDEN_KEYS = /^(?:raw|rawbody|body|content|contenttext|transcript|session|messages|payload|blob|binary|base64|secret|password|passwd|apikey|authtoken|accesstoken|refreshtoken|privatekey|credential|credentials|cookie)$/i;
const BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{80,}|\b[A-Za-z0-9+/]{220,}={0,2}\b/;
const SECRET_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b/i;
const RAW_SESSION_RE = /(?:^|[\\/])\.codex[\\/](?:archived_)?sessions[\\/]|\braw[_ -]?session\b|session[_ -]?jsonl/i;
const APP_OWNED_PROVENANCE_CAPABILITY = Symbol("memory-core-app-owned-provenance");
const NORMAL_CORE_STATUSES = new Set(["active", "accepted", "curated", "current", "persisted", "ready"]);
const REVIEW_CORE_STATUSES = new Set(["candidate", "review"]);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value, maxChars = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function legacyFactAuthorityLinkId(factId) {
  return `legacy-fact-authority-${stableHash([LEGACY_FACT_AUTHORITY_LINK_TYPE, factId]).slice(0, 24)}`;
}

function normalizePath(value) {
  return compactText(value, 520).replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
}

function isSafeNonFileUri(value) {
  const text = compactText(value, 600);
  const match = text.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/[^\s]+$/);
  return Boolean(match && !["data", "file", "javascript", "vbscript"].includes(match[1].toLowerCase()));
}

function containedSourcePath(value, projectPath) {
  const rawValue = compactText(value, 600);
  if (!rawValue) return null;
  if (isSafeNonFileUri(rawValue)) return rawValue;
  let fileValue = rawValue;
  if (/^file:/i.test(fileValue)) {
    try {
      fileValue = fileURLToPath(fileValue);
    } catch {
      return null;
    }
  }
  const root = normalizePath(projectPath);
  if (!root) return compactText(fileValue, 520) || null;
  const rootIsWindows = /^[a-z]:\//.test(root);
  const candidateLooksWindows = /^[A-Za-z]:[\\/]/.test(fileValue);
  const candidateLooksPosix = fileValue.startsWith("/");
  if (rootIsWindows && candidateLooksPosix) return null;
  if (!rootIsWindows && candidateLooksWindows) return null;
  const pathApi = rootIsWindows ? path.win32 : path.posix;
  const rootNative = rootIsWindows ? root.replace(/\//g, "\\") : root;
  const inputNative = rootIsWindows ? fileValue.replace(/\//g, "\\") : fileValue.replace(/\\/g, "/");
  const candidateNative = pathApi.isAbsolute(inputNative) ? pathApi.normalize(inputNative) : pathApi.resolve(rootNative, inputNative);
  const relative = pathApi.relative(rootNative, candidateNative);
  if (relative !== "" && (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative))) return null;
  return candidateNative.replace(/\\/g, "/");
}

function uniqueStrings(values, limit = 24, maxChars = 180) {
  const result = [];
  const seen = new Set();
  for (const value of safeArray(values).flat(Infinity)) {
    const text = compactText(value, maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function sourceRefSignature(ref) {
  return stableStringify([ref.kind, ref.id, ref.path, ref.title, ref.hash, ref.artifactType, ref.updatedAt, ref.projectId, ref.moduleId]);
}

function compactSourceRefs(refs, scope = {}, limit = MAX_SOURCE_REFS) {
  const result = [];
  const seen = new Set();
  for (const raw of safeArray(refs).flat(Infinity)) {
    if (!raw || typeof raw !== "object") continue;
    const signal = stableStringify(raw);
    if (BASE64_RE.test(signal) || SECRET_RE.test(signal) || RAW_SESSION_RE.test(signal)) continue;
    const scopeProjectId = compactText(scope.projectId || "", 180) || null;
    const suppliedProjectId = compactText(raw.projectId || "", 180) || null;
    if (scopeProjectId && suppliedProjectId && suppliedProjectId !== scopeProjectId) continue;
    const rawPath = compactText(raw.path || raw.filePath || "", 520);
    const rawUri = compactText(raw.uri || raw.url || "", 520);
    let sourcePath = null;
    if (rawPath) {
      sourcePath = containedSourcePath(rawPath, scope.projectPath);
      if (!sourcePath) continue;
    }
    if (rawUri) {
      const uriPath = containedSourcePath(rawUri, scope.projectPath);
      if (!uriPath) continue;
      sourcePath ||= uriPath;
    }
    const ref = {
      kind: compactText(raw.kind || raw.sourceType || "source", 80) || "source",
      id: compactText(raw.id || raw.sourceId || "", 180) || null,
      path: sourcePath,
      title: compactText(raw.title || "", 180) || null,
      hash: compactText(raw.hash || raw.sha256 || "", 160) || null,
      artifactType: compactText(raw.artifactType || "", 80) || null,
      updatedAt: raw.updatedAt || raw.modifiedAt || null,
      projectId: suppliedProjectId || scopeProjectId,
      moduleId: compactText(scope.moduleId || raw.moduleId || "", 180) || null,
    };
    if (![ref.id, ref.path, ref.title, ref.hash].some(Boolean)) continue;
    const signature = sourceRefSignature(ref);
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(ref);
    if (result.length >= limit) break;
  }
  return result;
}

function sanitizeCompactValue(value, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > 1200 || depth > 12) return "[bounded-structure-omitted]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (BASE64_RE.test(value)) return "[encoded-payload-omitted]";
    if (SECRET_RE.test(value)) return "[sensitive-value-omitted]";
    if (RAW_SESSION_RE.test(value)) return "[raw-session-pointer-omitted]";
    return compactText(value, 2400);
  }
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitizeCompactValue(item, depth + 1, state));
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort().slice(0, 100)) {
      if (FORBIDDEN_KEYS.test(key.replace(/[^a-z0-9]/gi, ""))) continue;
      output[key] = sanitizeCompactValue(value[key], depth + 1, state);
    }
    return output;
  }
  return null;
}

function compactRecallItem(item = {}) {
  const sourceRefs = compactSourceRefs(item.sourceRefs, {
    projectId: item.projectId || null,
    projectPath: item.projectPath || item.rootPath || item.workspacePath || null,
    moduleId: item.moduleId || null,
  }, 12);
  const whyRecalled = uniqueStrings([
    item.whyRecalled,
    item.whyMatched,
    item.reasonCodes,
    item.memoryCoreKind ? `memory_core:${item.memoryCoreKind}` : null,
  ], 12, 140);
  const sanitized = sanitizeCompactValue(item);
  return {
    ...sanitized,
    id: compactText(item.id || item.memoryId || item.episodeId || item.decisionId || item.constraintId || "", 220),
    kind: compactText(item.kind || "memory", 80),
    title: compactText(item.title || item.label || item.name || item.id || "Memory", 240),
    summary: compactText(item.summary || item.statement || item.productSummary || item.purpose || "", 1600),
    sourceRefs,
    whyMatched: uniqueStrings(item.whyMatched || whyRecalled, 12, 140),
    whyRecalled,
    tokenEstimate: Math.max(16, Math.min(Number(item.tokenEstimate || 0) || Math.ceil(JSON.stringify(sanitized).length / 4), 4000)),
    requiresHumanConfirmation: item.requiresHumanConfirmation === true,
    rawSessionPolicy: "not_allowed",
  };
}

function privateStatePath(storeRoot) {
  return path.join(storeRoot, PRIVATE_STATE_DIR);
}

function signingKeyPath(storeRoot) {
  return path.join(privateStatePath(storeRoot), SIGNING_KEY_FILE);
}

function loadOrCreateSigningKey(storeRoot) {
  const dir = privateStatePath(storeRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyFile = signingKeyPath(storeRoot);
  try {
    const existing = fs.readFileSync(keyFile);
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const key = crypto.randomBytes(48);
  try {
    fs.writeFileSync(keyFile, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = fs.readFileSync(keyFile);
    if (existing.length < 32) throw new Error("Memory Core authority signing key is invalid.");
    return existing;
  }
}

function loadExistingSigningKey(storeRoot) {
  try {
    const existing = fs.readFileSync(signingKeyPath(storeRoot));
    return existing.length >= 32 ? existing : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function memoryCorePrivateStateExists(storeRoot) {
  return fs.existsSync(signingKeyPath(storeRoot)) && fs.existsSync(indexPath(storeRoot));
}

function buildUnavailableMemoryCoreDiagnostics(options = {}) {
  const project = deriveProjectIdentity(options);
  return {
    schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
    projectId: project.projectId,
    projectPath: project.projectPath,
    privateStateReady: false,
    sidecarReady: false,
    availability: "not_ready",
    reasonCodes: ["memory_core_private_state_not_initialized"],
    counts: {},
    reviewQueueCount: 0,
    initialized: false,
    lazyInitialization: true,
    authorityFilterOrder: "before_relevance_ranking",
    safety: {
      signingKeyExposed: false,
      trustContextExposed: false,
      rawSessionBodyRead: false,
      storesBase64: false,
      startupFullScan: false,
      startsTimers: false,
      backgroundGraphRebuild: false,
    },
  };
}

function buildUnavailableMemoryCoreReviewQueue(options = {}) {
  const project = deriveProjectIdentity(options);
  return {
    schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
    projectId: project.projectId,
    projectPath: project.projectPath,
    items: [],
    count: 0,
    readOnly: true,
    availability: "not_ready",
    reasonCodes: ["memory_core_private_state_not_initialized"],
  };
}

function buildUnavailableMemoryCoreContinuity(options = {}) {
  const project = deriveProjectIdentity(options);
  return {
    schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
    projectId: project.projectId,
    projectPath: project.projectPath,
    recoveryReady: false,
    resolutionStatus: "not_ready",
    mandatorySlots: [...PROJECT_CONTINUITY_SLOTS],
    filledSlots: [],
    missingSlots: [...PROJECT_CONTINUITY_SLOTS],
    staleSlots: [],
    conflictSlots: [],
    unsatisfiedSlots: [...PROJECT_CONTINUITY_SLOTS],
    coverage: 0,
    pagination: { complete: false, pagesRead: 0, mandatoryTotal: 0, mandatoryReturned: 0, manifestFingerprint: null, capped: false },
    sourceRefs: [],
    warnings: ["memory_core_private_state_not_initialized"],
    performance: { startupFullScan: false, startsTimers: false, rawSessionBodyRead: false, boundedPagination: true },
  };
}

function buildUnavailableProjectContinuity(options = {}) {
  const status = buildUnavailableMemoryCoreContinuity(options);
  return {
    schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
    projectId: status.projectId,
    projectPath: status.projectPath,
    principal: null,
    authority: null,
    continuityPacket: null,
    recoveryReady: false,
    missing: [...PROJECT_CONTINUITY_SLOTS],
    stale: [],
    conflict: [],
    unsatisfied: [...PROJECT_CONTINUITY_SLOTS],
    nextCursor: null,
    mandatoryComplete: false,
    authorizedFactIds: [],
    authorizedCoreIds: [],
    warnings: status.warnings,
  };
}

function compactUnavailable(project, reasonCodes, extra = {}) {
  return {
    schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
    projectId: project?.projectId || null,
    projectPath: project?.projectPath || null,
    availability: "not_ready",
    resolutionStatus: "not_ready",
    reasonCodes: uniqueStrings(reasonCodes, 16, 120),
    warnings: uniqueStrings(reasonCodes, 16, 120),
    ...extra,
  };
}

function withExistingReadOnlyIndex(storeRoot, operation) {
  const filePath = indexPath(storeRoot);
  if (!fs.existsSync(filePath)) return { ready: false, reasonCodes: ["memory_core_index_missing"] };
  if (!DatabaseSync) return { ready: false, reasonCodes: ["memory_core_read_only_sqlite_unavailable"] };
  let db = null;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 100");
    return { ready: true, value: operation(db) };
  } catch (error) {
    return {
      ready: false,
      reasonCodes: [error?.code === "SQLITE_CANTOPEN" ? "memory_core_index_unavailable" : "memory_core_schema_not_ready"],
    };
  } finally {
    try {
      db?.close();
    } catch {
      // Read-only diagnostics must not fail because connection cleanup failed.
    }
  }
}

function existingTableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
}

function readOnlyCoreRecord(recordKind, row) {
  const payload = JSON.parse(row.payloadJson || "{}");
  return {
    recordKind,
    id: row.id,
    projectId: row.projectId || null,
    scopeKey: row.scopeKey || null,
    status: row.status,
    type: row.type,
    updatedAt: row.updatedAt,
    validFrom: row.validFrom || null,
    validTo: row.validTo || null,
    createdAt: row.createdAt,
    fingerprint: row.fingerprint || null,
    payload,
  };
}

function readOnlyListCoreRecords(db, tables, recordKind, options = {}) {
  const spec = MEMORY_CORE_RECORD_SPECS[recordKind];
  if (!spec || !tables.has(spec.table)) throw new Error(`Missing Memory Core table: ${recordKind}`);
  const filters = [];
  const params = { limit: Math.max(1, Math.min(Number(options.limit || 300), 10_000)) };
  if (options.projectId) {
    filters.push("projectId = :projectId");
    params.projectId = compactText(options.projectId, 240);
  }
  if (safeArray(options.statuses).length > 0) {
    const statuses = safeArray(options.statuses).map((status) => compactText(status, 40).toLowerCase()).filter(Boolean).slice(0, 20);
    filters.push(`status IN (${statuses.map((_, index) => `:status${index}`).join(", ")})`);
    statuses.forEach((status, index) => { params[`status${index}`] = status; });
  }
  return db.prepare(`
    SELECT * FROM ${spec.table}
    ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY updatedAt DESC, id ASC
    LIMIT :limit
  `).all(params).map((row) => readOnlyCoreRecord(recordKind, row));
}

function readOnlyMemoryFacts(db, tables, options = {}) {
  if (!tables.has("memory_facts")) throw new Error("Missing Memory Core table: memory_facts");
  const originalProjectPath = compactText(options.projectPath || "", 520);
  const projectPath = normalizePath(originalProjectPath);
  const rows = db.prepare(`
    SELECT * FROM memory_facts
    WHERE (projectPath = :originalProjectPath OR projectPath = :projectPath) AND scope = 'project'
    ORDER BY updatedAt DESC, id ASC
    LIMIT :limit
  `).all({ originalProjectPath, projectPath, limit: Math.max(1, Math.min(Number(options.limit || 600), 10_000)) });
  return rows.map((row) => ({
    id: row.id,
    projectPath: row.projectPath || null,
    scope: row.scope,
    subject: row.subject,
    predicate: row.predicate,
    value: JSON.parse(row.valueJson || "null"),
    factType: row.factType,
    status: row.status,
    confidence: Number(row.confidence || 0),
    validFrom: row.validFrom,
    validTo: row.validTo || null,
    observedAt: row.observedAt,
    sourceRefs: JSON.parse(row.sourceRefsJson || "[]"),
    supersededBy: row.supersededBy || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function deriveProjectIdentity(input = {}) {
  const projectPath = normalizePath(input.projectPath || input.canonicalPath || input.project?.path || "") || null;
  const requestedProjectId = compactText(input.projectId || input.project?.id || "", 180) || null;
  const derivedProjectId = projectPath ? `project-${stableHash(projectPath).slice(0, 20)}` : null;
  const projectId = derivedProjectId || requestedProjectId;
  return {
    projectId,
    projectPath,
    requestedProjectId,
    identityMismatch: Boolean(projectPath && requestedProjectId && requestedProjectId !== derivedProjectId),
  };
}

function deriveModuleId(input = {}, fallback = "memory-runtime") {
  return compactText(input.moduleId || input.module?.id || input.task?.moduleId || "", 180)
    || `module-${stableHash([fallback, input.taskId || input.task?.id || "default"]).slice(0, 20)}`;
}

function mapLifecycleEventType(hook, input = {}) {
  const explicit = compactText(input.eventType || input.type || input.kind || "", 80).toLowerCase();
  const aliases = {
    accept: "accepted",
    accepted: "accepted",
    revise: "revise",
    revised: "revise",
    block: "block",
    blocked: "block",
    checkpoint: "checkpoint",
    task_checkpoint: "checkpoint",
    user_rule_update: "user_rule",
    user_rule: "user_rule",
    user_correction: "user_correction",
    test_failure: "test_failure",
    test_pass: "test_pass",
    build: "build",
    install: "install",
    release: "release",
    thread_takeover: "thread_recovery",
    stale_lane_reference: "handoff",
    broken_thread: "handoff",
    heartbeat_fuse: "handoff",
    thread_recovery: "thread_recovery",
    handoff: "handoff",
  };
  if (aliases[explicit]) return aliases[explicit];
  if (hook === "close_working_memory") {
    const status = compactText(input.status || "accepted", 40).toLowerCase();
    return status === "blocked" ? "block" : status === "waiting_review" ? "revise" : "accepted";
  }
  if (hook === "writeback_evidence") {
    const decision = compactText(input.decision || "", 40).toLowerCase();
    return decision === "block" ? "block" : decision === "revise" ? "revise" : "accepted";
  }
  return "checkpoint";
}

function lifecycleSourceRefs(hook, input, scope) {
  const refs = compactSourceRefs([
    input.sourceRefs,
    input.currentEvidence,
    input.evidence?.sourceRefs,
  ], scope, 16);
  if (refs.length > 0) return refs;
  if (hook === "close_working_memory" && input.taskId) {
    return compactSourceRefs([{
      kind: "working_memory_record",
      path: `memory-runtime://working-memory/${encodeURIComponent(input.taskId)}`,
      title: compactText(input.currentGoal || input.taskId, 180),
      updatedAt: input.updatedAt || null,
    }], scope, 4);
  }
  return [];
}

function normalizeLifecycleInput(hook, input = {}, options = {}) {
  const project = deriveProjectIdentity({
    projectId: input.projectId || input.task?.projectId || options.projectId,
    projectPath: input.projectPath || input.task?.projectPath || options.projectPath,
  });
  const moduleId = deriveModuleId({ ...input, moduleId: input.moduleId || input.task?.moduleId || options.moduleId }, hook);
  const eventType = mapLifecycleEventType(hook, input);
  const sourceRefs = lifecycleSourceRefs(hook, input, { ...project, moduleId });
  const privacy = input.privacy && typeof input.privacy === "object" ? input.privacy : {};
  const reviewSignals = {
    heuristic: input.heuristic === true || input.reviewSignals?.heuristic === true,
    crossProject: input.crossProject === true || input.reviewSignals?.crossProject === true,
    userPreference: input.userPreference === true || input.reviewSignals?.userPreference === true || eventType === "user_rule" || eventType === "user_correction",
    security: input.securitySensitive === true || input.reviewSignals?.security === true || privacy.containsSecrets === true,
    archiveCompactRestore: input.archiveCompactRestore === true || input.reviewSignals?.archiveCompactRestore === true || /archive|compact|restore/i.test(compactText(input.category || input.domain || "", 100)),
  };
  const deterministic = hook === "close_working_memory"
    ? true
    : input.deterministic === true || input.evidence?.deterministic === true;
  const riskLevel = compactText(input.riskLevel || input.evidence?.riskLevel || (Object.values(reviewSignals).some(Boolean) ? "review" : "low"), 40).toLowerCase();
  const title = compactText(
    input.title || input.name || input.task?.goal || input.currentGoal || `${hook} ${eventType}`,
    180,
  );
  const summary = compactText(
    input.summary || input.message || input.evidence?.summary || input.currentGoal || input.result || input.nextAction || title,
    600,
  );
  const result = uniqueStrings([
    input.result,
    input.evidence?.tests,
    input.evidence?.artifacts,
    input.evidence?.changedFiles,
    hook === "close_working_memory" ? `Working memory closed as ${input.status || "accepted"}.` : null,
  ], 24, 500);
  const sourceEventId = compactText(input.eventId || input.id || input.task?.id || input.taskId || "", 180);
  return {
    eventId: sourceEventId ? `lifecycle-event-${stableHash([hook, sourceEventId, project.projectId, moduleId]).slice(0, 24)}` : null,
    eventType,
    projectId: project.projectId,
    projectPath: project.projectPath,
    moduleId,
    title,
    summary,
    outcome: compactText(input.outcome || input.status || input.decision || eventType, 120).toLowerCase(),
    result,
    why: compactText(input.why || input.evidence?.residualRisk || "Lifecycle event was evaluated by the app-owned Memory Core runtime.", 600),
    nextAction: compactText(input.nextAction || safeArray(input.nextActions)[0] || input.task?.nextAction || "", 360),
    acceptedProgress: uniqueStrings([input.acceptedProgress, eventType === "accepted" ? summary : null], 24, 500),
    openTasks: uniqueStrings([input.openTasks, input.nextAction, eventType === "revise" ? summary : null], 24, 500),
    blockers: uniqueStrings([input.blockers, input.openRisks, eventType === "block" ? summary : null], 24, 360),
    decisions: uniqueStrings([input.decisions, input.evidence?.reusablePattern], 16, 500),
    constraints: uniqueStrings([input.constraints, input.rules], 16, 500),
    corrections: uniqueStrings(input.corrections, 16, 500),
    failures: safeArray(input.failures).slice(0, 16),
    artifacts: safeArray(input.artifacts || input.evidence?.artifactRefs).slice(0, 16).map((artifact, index) => ({
      ...(artifact && typeof artifact === "object" ? artifact : { path: artifact }),
      id: compactText(artifact?.id || artifact?.artifactId || `artifact-${index + 1}`, 180),
      projectId: project.projectId,
      moduleId,
    })),
    threadRefs: safeArray(input.threadRefs || input.threads).slice(0, 16),
    threads: uniqueStrings([input.threadId, input.parentCeoThreadId, input.replacementThreadId, safeArray(input.threadRefs || input.threads).map((thread) => thread?.threadId || thread?.id || thread)], 12, 180),
    sourceRefs,
    riskLevel,
    deterministic,
    observedAt: input.observedAt || input.updatedAt || input.createdAt || options.now || new Date().toISOString(),
    reviewSignals,
    heuristic: reviewSignals.heuristic,
    crossProject: reviewSignals.crossProject,
    userPreference: reviewSignals.userPreference,
    securitySensitive: reviewSignals.security,
    archiveCompactRestore: reviewSignals.archiveCompactRestore,
    privacy,
  };
}

function memoryCoreRecordToRecallItem(record) {
  const mapping = {
    projectBrain: "project_record",
    projectAnchor: "knowledge_item",
    moduleMemory: "project_record",
    episode: "experience_card",
    decision: "knowledge_item",
    constraint: "knowledge_item",
    projectCheckpoint: "project_resume_packet",
  };
  return compactRecallItem({
    ...record.payload,
    id: record.id,
    kind: mapping[record.recordKind] || "knowledge_item",
    memoryCoreKind: record.recordKind,
    projectId: record.projectId,
    title: record.payload?.title || record.payload?.name || record.payload?.statement || record.payload?.productSummary || record.id,
    summary: record.payload?.summary || record.payload?.statement || record.payload?.purpose || record.payload?.productSummary || record.payload?.outcome || "",
    status: record.status,
    freshness: REVIEW_STATUSES.has(record.status) ? "review" : "fresh",
    requiresHumanConfirmation: REVIEW_STATUSES.has(record.status),
    sourceRefs: record.payload?.sourceRefs || [],
    whyRecalled: ["authority_filtered_before_relevance_ranking", `memory_core:${record.recordKind}`],
  });
}

class MemoryCoreRuntime {
  constructor(options = {}) {
    if (!options.storeRoot) throw new Error("Memory Core runtime requires storeRoot.");
    this.storeRoot = path.resolve(options.storeRoot);
    this.now = options.now || null;
    this.signingKey = Buffer.isBuffer(options.authoritySigningKey)
      ? Buffer.from(options.authoritySigningKey)
      : options.authoritySigningKey
        ? Buffer.from(String(options.authoritySigningKey), "utf8")
        : null;
    if (this.signingKey && this.signingKey.length < 32) throw new Error("Memory Core authority signing key must contain at least 32 bytes.");
    this.trustContext = null;
    this.loadedProjects = new Map();
    this.receiptCache = new Map();
    this.metrics = {
      projectInitializations: 0,
      receiptHydrations: 0,
      receiptHydrationFailures: 0,
      continuityPages: 0,
      formationPlans: 0,
      startupWholeTableScans: 0,
      timersStarted: 0,
    };
  }

  ensureTrustContext(options = {}) {
    if (this.trustContext) return this.trustContext;
    if (!this.signingKey) {
      this.signingKey = options.allowCreate === false
        ? loadExistingSigningKey(this.storeRoot)
        : loadOrCreateSigningKey(this.storeRoot);
    }
    if (!this.signingKey) return null;
    if (this.signingKey.length < 32) throw new Error("Memory Core authority signing key must contain at least 32 bytes.");
    this.trustContext = createMemoryAuthorityTrustContext({
      label: "zhixia-memory-core-runtime",
      receiptSigningKey: this.signingKey,
    });
    return this.trustContext;
  }

  ensureAuthorityScope(input = {}, scopeOptions = {}) {
    const project = deriveProjectIdentity(input);
    if (project.identityMismatch) throw new Error("Memory Core caller projectId does not match the canonical project path.");
    const now = input.now || this.now || new Date().toISOString();
    if (!project.projectId || !project.projectPath) return { ...project, owner: null, worker: null, reviewer: null, binding: null, now };
    const trustContext = this.ensureTrustContext({ allowCreate: scopeOptions.allowCreateKey !== false });
    if (!trustContext) return { ...project, owner: null, worker: null, reviewer: null, service: null, binding: null, now, unavailableReason: "authority_signing_key_missing" };
    const binding = registerProjectBinding(trustContext, {
      projectId: project.projectId,
      projectPath: project.projectPath,
      validFrom: "1970-01-01T00:00:00.000Z",
    }, { now });
    const owner = registerAuthorityPrincipal(trustContext, {
      principalType: "user",
      userId: `memory-core-owner-${project.projectId}`,
      role: "owner",
      projectIds: [project.projectId],
      projectPaths: [project.projectPath],
      createdAt: "1970-01-01T00:00:00.000Z",
    }, { now });
    const worker = registerAuthorityPrincipal(trustContext, {
      principalType: "agent",
      agentFamily: "zhixia",
      externalId: `memory-core-reader-${project.projectId}`,
      role: "worker",
      ownerId: owner.principalId,
      projectIds: [project.projectId],
      projectPaths: [project.projectPath],
      createdAt: "1970-01-01T00:00:00.000Z",
    }, { now });
    const reviewer = registerAuthorityPrincipal(trustContext, {
      principalType: "agent",
      agentFamily: "zhixia",
      externalId: `memory-core-reviewer-${project.projectId}`,
      role: "reviewer",
      ownerId: owner.principalId,
      projectIds: [project.projectId],
      projectPaths: [project.projectPath],
      createdAt: "1970-01-01T00:00:00.000Z",
    }, { now });
    const ceo = registerAuthorityPrincipal(trustContext, {
      principalType: "agent",
      agentFamily: "codex",
      externalId: `memory-core-ceo-${project.projectId}`,
      role: "ceo",
      ownerId: owner.principalId,
      projectIds: [project.projectId],
      projectPaths: [project.projectPath],
      createdAt: "1970-01-01T00:00:00.000Z",
    }, { now });
    const service = registerAuthorityPrincipal(trustContext, {
      principalType: "service",
      externalId: `memory-core-service-${project.projectId}`,
      role: "service",
      ownerId: owner.principalId,
      projectIds: [project.projectId],
      projectPaths: [project.projectPath],
      createdAt: "1970-01-01T00:00:00.000Z",
    }, { now });
    const identityRef = [{
      kind: "memory_core_private_identity",
      path: `memory-runtime://private/identities/${project.projectId}`,
      hash: stableHash([project.projectId, project.projectPath, "local-identities"]),
      projectId: project.projectId,
    }];
    if (scopeOptions.persist !== false) {
      for (const principal of [owner, ceo, worker, reviewer, service]) {
        upsertMemoryPrincipal(this.storeRoot, {
          principalId: principal.principalId,
          principalType: principal.principalType,
          role: principal.role,
          ownerId: principal.ownerId,
          projectIds: principal.projectIds,
          projectPaths: principal.projectPaths,
          capabilities: principal.capabilities,
          status: principal.status,
          scopeKey: `private:${principal.principalId}`,
          sourceRefs: identityRef,
          createdAt: principal.createdAt,
          updatedAt: "1970-01-01T00:00:00.000Z",
        });
      }
      upsertProjectBinding(this.storeRoot, {
        ...binding,
        scopeKey: `project:${project.projectId}`,
        sourceRefs: [{
          kind: "project_binding",
          path: project.projectPath,
          hash: stableHash([project.projectId, project.projectPath]),
          projectId: project.projectId,
        }],
        updatedAt: "1970-01-01T00:00:00.000Z",
      });
    }
    const scope = { ...project, owner, ceo, worker, reviewer, service, binding, now };
    if (scopeOptions.persist !== false) {
      if (!this.loadedProjects.has(project.projectId)) this.metrics.projectInitializations += 1;
      this.loadedProjects.set(project.projectId, scope);
    }
    return scope;
  }

  listRecallCandidates(options = {}) {
    const project = deriveProjectIdentity(options);
    const reviewMode = options.reviewMode === true || REVIEW_QUERY_TYPES.has(compactText(options.queryType || "", 80));
    const view = reviewMode ? "review" : "normal";
    const listOptions = { projectId: project.projectId || undefined, view, limit: 300 };
    const records = [
      ...listProjectBrains(this.storeRoot, listOptions),
      ...listProjectAnchors(this.storeRoot, listOptions),
      ...listModuleMemories(this.storeRoot, listOptions),
      ...listMemoryEpisodes(this.storeRoot, listOptions),
      ...listMemoryDecisions(this.storeRoot, listOptions),
      ...listMemoryConstraints(this.storeRoot, listOptions),
      ...listProjectCheckpoints(this.storeRoot, listOptions),
    ];
    return records.slice(0, 800).map(memoryCoreRecordToRecallItem);
  }

  filterAuthorizedCandidates(items = [], options = {}) {
    const scope = this.ensureAuthorityScope(options);
    const queryType = compactText(options.queryType || "task_dispatch", 80);
    const reviewMode = options.reviewMode === true || REVIEW_QUERY_TYPES.has(queryType);
    const principal = reviewMode ? scope.reviewer : scope.worker;
    const authorizedFactIds = new Set(safeArray(options.authorizedFactIds || options.memoryCore?.authorizedFactIds));
    const authorizedCoreIds = new Set(safeArray(options.authorizedCoreIds || options.memoryCore?.authorizedCoreIds));
    const included = [];
    const excludedReasonCounts = {};
    const scopeDecision = scope.projectPath && principal ? authorizeMemoryAction(principal, reviewMode ? "review" : "read", {
      id: `authority-scope-${scope.projectId}`,
      ownerId: scope.owner.principalId,
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      scope: `project:${scope.projectId}`,
      sourceRefs: [{ kind: "project_binding", path: scope.projectPath, hash: stableHash([scope.projectId, scope.projectPath]) }],
    }, {
      trustContext: this.trustContext,
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      ownerId: scope.owner.principalId,
      now: scope.now,
    }) : null;
    for (const raw of safeArray(items).slice(0, Math.max(1200, Math.min(Number(options.maxCandidates || 10_000), 10_000)))) {
      const item = compactRecallItem(raw);
      const itemProjectPath = normalizePath(raw.projectPath || raw.rootPath || raw.workspacePath || "") || null;
      const itemProjectId = compactText(raw.projectId || "", 180) || (itemProjectPath ? deriveProjectIdentity({ projectPath: itemProjectPath }).projectId : null);
      const status = compactText(raw.status || "", 40).toLowerCase();
      const freshness = compactText(raw.freshness || "unknown", 40).toLowerCase();
      const explicitReviewMaterial = reviewMode
        && (REVIEW_STATUSES.has(status) || freshness === "review" || raw.requiresHumanConfirmation === true);
      const reasons = [];
      if (scope.projectPath && itemProjectPath && itemProjectPath !== scope.projectPath) reasons.push("cross_project_candidate");
      if (scope.projectId && itemProjectId && itemProjectId !== scope.projectId) reasons.push("cross_project_candidate");
      if (scope.projectPath && !itemProjectPath && !itemProjectId) reasons.push("project_scope_required");
      if (scope.projectPath && raw.kind === "memory_fact" && raw.scope !== "project") reasons.push("project_scope_required");
      if (raw.kind === "memory_fact" && !authorizedFactIds.has(item.id) && !explicitReviewMaterial) reasons.push("legacy_fact_authority_unverified");
      if (raw.memoryCoreKind && authorizedCoreIds.size > 0 && !authorizedCoreIds.has(item.id)) reasons.push("memory_core_receipt_unverified");
      if (reviewMode) {
        if (!CURRENT_STATUSES.has(status) && !REVIEW_STATUSES.has(status)) reasons.push("unsupported_review_status");
      } else {
        if (!CURRENT_STATUSES.has(status)) reasons.push("non_current_status");
        if (freshness !== "fresh") reasons.push("non_fresh_candidate");
        if (raw.requiresHumanConfirmation === true) reasons.push("human_confirmation_required");
      }
      if (item.sourceRefs.length === 0) reasons.push("direct_source_required");
      if (scope.projectPath && (!scope.binding?.ok || !principal)) reasons.push("authority_scope_unresolved");
      if (reasons.length === 0 && scope.projectPath && !scopeDecision?.allowed) reasons.push(...safeArray(scopeDecision?.reasonCodes));
      if (reasons.length > 0) {
        for (const reason of new Set(reasons)) excludedReasonCounts[reason] = (excludedReasonCounts[reason] || 0) + 1;
        continue;
      }
      included.push({
        ...item,
        whyRecalled: uniqueStrings([...item.whyRecalled, "authority_allowed_before_relevance_ranking"], 12, 140),
      });
    }
    return {
      items: included,
      diagnostics: {
        schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
        authorityFilterOrder: "before_relevance_ranking",
        candidatesReceived: safeArray(items).length,
        candidatesAuthorized: included.length,
        candidatesExcluded: Math.max(0, safeArray(items).length - included.length),
        excludedReasonCounts,
        projectId: scope.projectId,
        projectPath: scope.projectPath,
        reviewMode,
      },
    };
  }

  rankAuthorizedCandidates(items, query, ranker, options = {}) {
    const filtered = this.filterAuthorizedCandidates(items, options);
    const ranked = typeof ranker === "function" ? ranker(filtered.items, query, options) : filtered.items;
    return { ...filtered, ranked };
  }

  filterAuthorityCandidates(items = [], memoryCore = {}, options = {}) {
    return this.filterAuthorizedCandidates(items, {
      ...options,
      projectId: memoryCore.projectId || options.projectId,
      projectPath: memoryCore.projectPath || options.projectPath,
      authorizedFactIds: memoryCore.authorizedFactIds || options.authorizedFactIds,
      authorizedCoreIds: memoryCore.authorizedCoreIds || options.authorizedCoreIds,
      maxCandidates: options.maxCandidates || 10_000,
    }).items;
  }

  decorateRetrievalPacket(packet = {}, memoryCore = null) {
    const items = safeArray(packet.items).slice(0, MAX_PACKET_ITEMS).map(compactRecallItem);
    const sourceRefs = compactSourceRefs([
      packet.sourceRefs,
      items.flatMap((item) => item.sourceRefs),
    ], {}, MAX_SOURCE_REFS);
    return {
      ...sanitizeCompactValue(packet),
      items,
      sourceRefs,
      tokenEstimate: Math.max(0, Number(packet.tokenEstimate || items.reduce((sum, item) => sum + Number(item.tokenEstimate || 0), 0))),
      memoryCore: memoryCore ? sanitizeCompactValue(memoryCore) : packet.memoryCore || undefined,
    };
  }

  createFormationReceipt(preview, event, scope) {
    const targetFingerprint = preview.event?.authority?.targetFingerprint;
    const transition = preview.event?.authority?.transition || `form:${event.eventType}`;
    if (!targetFingerprint) return null;
    const receipt = buildAuthorityDecision({
      allowed: true,
      principalId: scope.owner.principalId,
      ownerId: scope.owner.principalId,
      action: "memory_formation",
      transition,
      targetId: targetFingerprint,
      scopeKey: `project:${scope.projectId}`,
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      reasonCodes: ["app_owned_exact_memory_formation_receipt"],
      now: event.observedAt,
      eventNonce: targetFingerprint,
      eventSequence: 0,
    }, { trustContext: this.trustContext });
    const registration = registerAuthorityReceipt(this.trustContext, receipt, { now: event.observedAt });
    if (!registration.ok) return null;
    this.receiptCache.set(receipt.receiptId, { receipt: registration.receipt, moduleId: event.moduleId });
    return { receipt: registration.receipt, persisted: null };
  }

  formationVerifier(receipt, event) {
    return (request) => {
      if (!receipt || request.receiptId !== receipt.receiptId || request.receiptProof !== receipt.receiptProof) return null;
      const hydrated = hydrateAuthorityReceipt(this.trustContext, receipt, { now: event.observedAt });
      const exact = hydrated.ok
        && receipt.action === request.action
        && receipt.transition === request.transition
        && receipt.targetId === request.targetFingerprint
        && receipt.projectId === request.projectId;
      if (!exact) return null;
      return {
        ...request,
        receiptId: receipt.receiptId,
        receiptProof: receipt.receiptProof,
        decisionFingerprint: receipt.decisionFingerprint,
        verified: true,
        active: true,
        allowed: true,
        decision: "accepted",
        riskLevel: event.riskLevel,
        deterministic: event.deterministic,
        projectId: event.projectId,
        moduleId: event.moduleId,
      };
    };
  }

  persistFormationPlan(plan, receiptResult = null) {
    const writes = [];
    if (!plan.episode) return writes;
    const scopeKey = `project:${plan.episode.projectId}`;
    if (receiptResult?.receipt && plan.accepted) {
      const persisted = appendAuthorityReceipt(this.storeRoot, {
        ...receiptResult.receipt,
        status: "accepted",
        targetFingerprint: receiptResult.receipt.targetId,
        moduleId: plan.event.moduleId,
        riskLevel: plan.event.riskLevel,
        deterministic: plan.event.deterministic,
        sourceRefs: plan.event.sourceRefs,
      });
      receiptResult.persisted = persisted;
      writes.push({ kind: "authorityReceipt", ...persisted });
    }
    writes.push({ kind: "episode", ...upsertMemoryEpisode(this.storeRoot, { ...plan.episode, scopeKey, status: plan.status }) });
    for (const decision of safeArray(plan.decisionCandidates)) {
      writes.push({ kind: "decision", ...upsertMemoryDecision(this.storeRoot, {
        ...decision,
        scopeKey,
        status: plan.accepted ? "accepted" : "review",
        authorityStatus: plan.accepted ? "accepted" : "review",
      }) });
    }
    for (const constraint of safeArray(plan.constraintCandidates)) {
      const acceptedConstraint = plan.accepted && constraint.ownerApprovalRequired !== true;
      writes.push({ kind: "constraint", ...upsertMemoryConstraint(this.storeRoot, {
        ...constraint,
        scopeKey,
        status: acceptedConstraint ? "accepted" : "review",
        authorityStatus: acceptedConstraint ? "accepted" : "review",
      }) });
    }
    if (plan.checkpointCandidate) {
      const checkpointStatus = plan.accepted ? "accepted" : "review";
      const compactItems = (items) => safeArray(items).slice(0, 32).map((item) => ({
        id: item.id,
        title: compactText(item.title || item.summary, 360),
        status: compactText(item.status || "open", 40).toLowerCase(),
        authorityStatus: checkpointStatus,
        authoritative: plan.accepted,
        projectId: plan.episode.projectId,
        sourceRefs: safeArray(item.sourceRefs).slice(0, 2),
        observedAt: item.observedAt || plan.event.observedAt,
        updatedAt: item.updatedAt || plan.event.observedAt,
      }));
      const checkpoint = plan.checkpointCandidate;
      writes.push({ kind: "projectCheckpoint", ...appendProjectCheckpoint(this.storeRoot, {
        checkpointId: checkpoint.checkpointId,
        projectId: plan.episode.projectId,
        phase: checkpoint.phase,
        moduleIds: safeArray(checkpoint.moduleIds).slice(0, 32),
        acceptedProgress: compactItems(checkpoint.acceptedProgress),
        taskStates: compactItems(checkpoint.taskStates),
        blockers: compactItems(checkpoint.blockers),
        nextActions: compactItems(checkpoint.nextActions),
        threadLineage: safeArray(checkpoint.threadLineage).slice(0, 32),
        canonicalDocRefs: safeArray(checkpoint.canonicalDocRefs).slice(0, 16),
        originalGoal: checkpoint.originalGoal,
        architectureAnchors: safeArray(checkpoint.architectureAnchors).slice(0, 16),
        authorityReceiptId: plan.event.authority.receiptId,
        authorityStatus: checkpointStatus,
        authoritative: plan.accepted,
        sourceRefs: safeArray(checkpoint.sourceRefs).slice(0, 8),
        observedAt: checkpoint.observedAt,
        updatedAt: checkpoint.updatedAt,
        scopeKey,
      }) });
    }
    return writes.map((write) => ({
      kind: write.kind,
      action: write.action,
      id: write.record?.id || null,
      status: write.record?.status || null,
      reasonCodes: safeArray(write.reasonCodes),
    }));
  }

  verifyCloseWorkingMemoryReceipt(input, event, scope) {
    if (event.eventType !== "accepted") return { verified: false, reasonCodes: ["close_working_memory_not_accepted"] };
    const receiptId = compactText(
      input.acceptedReceiptId
        || input.authorityReceiptId
        || input.evidenceReceiptId
        || input.evidence?.authorityReceiptId
        || safeArray(input.currentEvidence).find((ref) => ref?.authorityReceiptId || ref?.receiptId)?.authorityReceiptId
        || safeArray(input.currentEvidence).find((ref) => ref?.authorityReceiptId || ref?.receiptId)?.receiptId,
      180,
    );
    if (!receiptId) return { verified: false, reasonCodes: ["close_working_memory_verified_receipt_required"] };
    const entry = this.hydrateReceiptById(receiptId, scope, event.observedAt);
    const receipt = entry?.receipt || null;
    const verified = Boolean(
      receipt
      && receipt.action === "memory_formation"
      && receipt.projectId === event.projectId
      && (!entry.moduleId || entry.moduleId === event.moduleId),
    );
    return verified
      ? { verified: true, receiptId, reasonCodes: ["close_working_memory_verified_app_receipt"] }
      : { verified: false, receiptId, reasonCodes: ["close_working_memory_receipt_binding_invalid"] };
  }

  formAppOwnedLifecycleEvent(hook, input = {}, options = {}) {
    return this.formLifecycleEvent(hook, input, {
      ...options,
      [APP_OWNED_PROVENANCE_CAPABILITY]: APP_OWNED_PROVENANCE_CAPABILITY,
    });
  }

  formLifecycleEvent(hook, input = {}, options = {}) {
    const appOwnedProvenance = options[APP_OWNED_PROVENANCE_CAPABILITY] === APP_OWNED_PROVENANCE_CAPABILITY;
    const rawInspection = inspectMemoryCorePayload(input);
    if (!rawInspection.safe) {
      return {
        schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
        hook,
        status: "rejected",
        accepted: false,
        reviewRequired: true,
        reasonCodes: rawInspection.reasonCodes,
        warnings: [],
        receipt: null,
        writes: [],
        performance: { startsTimers: false, scansFiles: false, rawSessionBodyRead: false, backgroundGraphRebuild: false },
      };
    }
    const event = normalizeLifecycleInput(hook, input, options);
    if (!event.projectId || !event.projectPath) {
      return {
        schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
        hook,
        status: "rejected",
        accepted: false,
        reviewRequired: true,
        reasonCodes: ["project_identity_required"],
        writes: [],
        performance: { startsTimers: false, scansFiles: false, rawSessionBodyRead: false },
      };
    }
    const scope = appOwnedProvenance
      ? this.ensureAuthorityScope({ ...event, now: event.observedAt })
      : { ...deriveProjectIdentity(event), now: event.observedAt };
    const preview = buildMemoryFormationPlan({ ...event, authorityOutcome: null }, {
      projectId: event.projectId,
      moduleId: event.moduleId,
    });
    if (preview.status === "rejected") {
      return {
        schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
        hook,
        status: "rejected",
        accepted: false,
        reviewRequired: true,
        planId: preview.planId,
        eventFingerprint: preview.eventFingerprint,
        reasonCodes: preview.reasonCodes,
        warnings: preview.warnings,
        writes: [],
        preview: { status: preview.status, reasonCodes: preview.reasonCodes },
        performance: { startsTimers: false, scansFiles: false, rawSessionBodyRead: false },
      };
    }
    const closeReceiptBinding = hook === "close_working_memory"
      ? (appOwnedProvenance ? this.verifyCloseWorkingMemoryReceipt(input, event, scope) : { verified: false, reasonCodes: ["close_working_memory_untrusted_provenance"] })
      : { verified: true, reasonCodes: [] };
    const lowRiskAutoAccept = appOwnedProvenance
      && event.deterministic === true
      && event.riskLevel === "low"
      && AUTO_ACCEPT_EVENT_TYPES.has(event.eventType)
      && event.sourceRefs.length > 0
      && event.sourceRefs.every((ref) => ref.projectId === event.projectId && ref.moduleId === event.moduleId && (ref.path || ref.hash))
      && preview.event?.materialEvidencePresent === true
      && preview.event?.semanticConsistent !== false
      && !REVIEW_EVENT_TYPES.has(event.eventType)
      && !Object.values(event.reviewSignals).some(Boolean)
      && closeReceiptBinding.verified === true;
    const receiptResult = lowRiskAutoAccept ? this.createFormationReceipt(preview, event, scope) : null;
    const authorityOutcome = receiptResult ? {
      receiptId: receiptResult.receipt.receiptId,
      receiptProof: receiptResult.receipt.receiptProof,
      projectId: event.projectId,
      moduleId: event.moduleId,
      action: "memory_formation",
      transition: preview.event.authority.transition,
    } : null;
    const finalPlan = buildMemoryFormationPlan({ ...event, authorityOutcome }, {
      projectId: event.projectId,
      moduleId: event.moduleId,
      authorityVerifier: this.formationVerifier(receiptResult?.receipt || null, event),
    });
    const accepted = finalPlan.status === "accepted" && lowRiskAutoAccept;
    const effectivePlan = accepted ? finalPlan : {
      ...finalPlan,
      status: finalPlan.status === "rejected" ? "rejected" : "review",
      accepted: false,
      episode: finalPlan.episode ? {
        ...finalPlan.episode,
        status: finalPlan.status === "rejected" ? "rejected" : "review",
        reviewRequired: true,
        reviewReasonCodes: uniqueStrings([
          finalPlan.reasonCodes,
          lowRiskAutoAccept ? null : "runtime_auto_accept_gate_not_satisfied",
          appOwnedProvenance ? null : "untrusted_lifecycle_provenance_review_required",
          closeReceiptBinding.reasonCodes,
        ], 24, 120),
      } : null,
    };
    const writes = effectivePlan.status === "rejected" ? [] : this.persistFormationPlan(effectivePlan, accepted ? receiptResult : null);
    this.metrics.formationPlans += 1;
    return {
      schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
      hook,
      status: effectivePlan.status,
      accepted,
      reviewRequired: !accepted,
      planId: finalPlan.planId,
      eventFingerprint: finalPlan.eventFingerprint,
      idempotencyKey: finalPlan.idempotencyKey,
      reasonCodes: uniqueStrings([
        finalPlan.reasonCodes,
        lowRiskAutoAccept ? "app_owned_deterministic_low_risk_auto_accept" : "runtime_auto_accept_gate_not_satisfied",
        appOwnedProvenance ? "app_owned_internal_provenance" : "untrusted_lifecycle_provenance_review_required",
        closeReceiptBinding.reasonCodes,
      ], 24, 120),
      warnings: finalPlan.warnings,
      receipt: accepted && receiptResult ? {
        receiptId: receiptResult.receipt.receiptId,
        receiptProof: receiptResult.receipt.receiptProof,
        decisionFingerprint: receiptResult.receipt.decisionFingerprint,
        action: receiptResult.receipt.action,
        transition: receiptResult.receipt.transition,
        persistedAction: receiptResult.persisted?.action || null,
      } : null,
      provenance: {
        origin: appOwnedProvenance ? "app_owned_internal" : "untrusted_caller",
        autoAcceptEligible: appOwnedProvenance,
        closeReceiptBinding: hook === "close_working_memory" ? (closeReceiptBinding.verified ? "verified" : "unverified") : "not_applicable",
      },
      preview: {
        status: preview.status,
        planId: preview.planId,
        targetFingerprint: preview.event?.authority?.targetFingerprint || null,
      },
      writes,
      plan: effectivePlan,
      noHostEffects: Object.values(effectivePlan.effects || {}).every((value) => value === false),
      continuityPatch: finalPlan.continuityPatchCandidate ? {
        patchId: finalPlan.continuityPatchCandidate.patchId,
        touchedSlots: finalPlan.continuityPatchCandidate.touchedSlots,
      } : null,
      performance: {
        startsTimers: false,
        scansFiles: false,
        rawSessionBodyRead: false,
        backgroundGraphRebuild: false,
        boundedWrites: true,
      },
    };
  }

  formEvent(input = {}, options = {}) {
    return this.formLifecycleEvent("observe_event", input, options);
  }

  formEvidenceWriteback(packet = {}, legacyReceipt = null) {
    return this.formLifecycleEvent("writeback_evidence", {
      ...packet,
      observedAt: packet.observedAt || legacyReceipt?.createdAt || new Date().toISOString(),
    });
  }

  authorizeFormedMemoryFacts(factActions = [], formationResult = {}, options = {}) {
    const skipped = (reasonCodes) => ({
      schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
      authorized: 0,
      links: [],
      reasonCodes: uniqueStrings(reasonCodes, 12, 120),
    });
    if (formationResult?.accepted !== true || formationResult?.status !== "accepted" || !formationResult?.receipt?.receiptId) {
      return skipped(["accepted_formation_required"]);
    }
    const scope = this.ensureAuthorityScope({
      ...options,
      projectId: options.projectId || formationResult.plan?.episode?.projectId || formationResult.plan?.event?.projectId,
      projectPath: options.projectPath || formationResult.plan?.event?.projectPath,
      now: options.now || formationResult.plan?.event?.observedAt,
    });
    if (!scope.projectId || !scope.projectPath || !scope.owner) return skipped(["project_authority_scope_required"]);
    const observedAt = formationResult.plan?.event?.observedAt || options.now || scope.now;
    const formationReceiptEntry = this.hydrateReceiptById(formationResult.receipt.receiptId, scope, observedAt);
    const formationReceipt = formationReceiptEntry?.receipt;
    const formationReceiptExact = formationReceipt
      && formationReceipt.receiptProof === formationResult.receipt.receiptProof
      && formationReceipt.action === "memory_formation"
      && formationReceipt.transition === formationResult.receipt.transition
      && formationReceipt.targetId === formationResult.preview?.targetFingerprint
      && formationReceipt.projectId === scope.projectId
      && formationReceipt.projectPath === scope.projectPath;
    if (!formationReceiptExact) return skipped(["trusted_exact_formation_receipt_required"]);
    const sourceRefs = compactSourceRefs(formationResult.plan?.event?.sourceRefs, {
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      moduleId: formationResult.plan?.event?.moduleId,
    }, 12);
    if (sourceRefs.length === 0) return skipped(["direct_source_required"]);
    const requestedIds = uniqueStrings(safeArray(factActions)
      .filter((action) => ["accepted", "active", "current"].includes(compactText(action?.status, 40).toLowerCase()))
      .map((action) => action?.id), 30, 180);
    if (requestedIds.length === 0) return skipped(["accepted_memory_fact_required"]);
    const factsById = new Map(listMemoryFacts(this.storeRoot, { limit: 1200 })
      .filter((fact) => normalizePath(fact.projectPath) === scope.projectPath)
      .map((fact) => [fact.id, fact]));
    const links = [];
    for (const factId of requestedIds) {
      const fact = factsById.get(factId);
      if (!fact || fact.scope !== "project" || normalizePath(fact.projectPath) !== scope.projectPath || !["accepted", "active", "current"].includes(fact.status)) continue;
      const eventNonce = stableHash([
        "formed-memory-fact-approval",
        formationResult.eventFingerprint,
        formationReceipt.receiptId,
        factId,
      ]);
      const receipt = buildAuthorityDecision({
        allowed: true,
        principalId: scope.owner.principalId,
        ownerId: scope.owner.principalId,
        action: "approve",
        transition: "review->accepted",
        targetId: factId,
        scopeKey: `project:${scope.projectId}`,
        projectId: scope.projectId,
        projectPath: scope.projectPath,
        reasonCodes: ["app_owned_low_risk_formed_fact_approved"],
        now: observedAt,
        eventNonce,
        eventSequence: 0,
      }, { trustContext: this.trustContext });
      const registration = registerAuthorityReceipt(this.trustContext, receipt, { now: observedAt });
      if (!registration.ok) continue;
      const persistedReceipt = appendAuthorityReceipt(this.storeRoot, {
        ...registration.receipt,
        status: "accepted",
        targetFingerprint: factId,
        moduleId: formationResult.plan?.event?.moduleId || null,
        sourceRefs,
      });
      if (!["insert", "noop"].includes(persistedReceipt.action)) continue;
      this.receiptCache.set(receipt.receiptId, {
        receipt: registration.receipt,
        moduleId: compactText(formationResult.plan?.event?.moduleId, 180) || null,
      });
      const decisionId = legacyFactAuthorityLinkId(factId);
      const persistedLink = upsertMemoryDecision(this.storeRoot, {
        decisionId,
        decisionType: LEGACY_FACT_AUTHORITY_LINK_TYPE,
        projectId: scope.projectId,
        scopeKey: `project:${scope.projectId}`,
        status: "accepted",
        authorityStatus: "accepted",
        authoritative: true,
        factId,
        authorityReceiptId: receipt.receiptId,
        ownerId: scope.owner.principalId,
        sourceRefs,
        createdAt: observedAt,
        updatedAt: observedAt,
      });
      if (!["insert", "update", "noop"].includes(persistedLink.action)) continue;
      links.push({
        factId,
        decisionId,
        receiptId: receipt.receiptId,
        receiptAction: persistedReceipt.action,
        linkAction: persistedLink.action,
      });
    }
    return {
      schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
      authorized: links.length,
      links,
      reasonCodes: links.length > 0 ? ["formed_memory_facts_receipt_linked"] : ["no_matching_accepted_memory_facts"],
    };
  }

  ensureProjectBrain(input = {}) {
    const project = deriveProjectIdentity(input);
    if (!project.projectId || !project.projectPath) return null;
    this.ensureAuthorityScope(input);
    const existing = getProjectBrain(this.storeRoot, project.projectId, { projectId: project.projectId });
    if (existing) return existing;
    const brain = buildProjectBrain({
      projectId: project.projectId,
      canonicalPath: project.projectPath,
      aliases: uniqueStrings([input.projectName, path.basename(project.projectPath)], 8, 120),
      productSummary: compactText(input.projectSummary || input.taskGoal || `Project at ${project.projectPath}`, 360),
      phase: compactText(input.phase || "active", 80),
      authorityStatus: "accepted",
      sourceRefs: [{
        kind: "project_binding",
        path: project.projectPath,
        title: compactText(input.projectName || path.basename(project.projectPath), 180),
        hash: stableHash([project.projectId, project.projectPath]),
      }],
      updatedAt: input.now || this.now || new Date().toISOString(),
    });
    upsertProjectBrain(this.storeRoot, { ...brain, scopeKey: `project:${project.projectId}` });
    return brain;
  }

  seedProject(input = {}) {
    const project = deriveProjectIdentity(input);
    if (!project.projectId || !project.projectPath) throw new Error("Memory Core projectPath is required for seed.");
    const now = input.now || this.now || new Date().toISOString();
    const brain = buildProjectBrain({
      projectId: project.projectId,
      canonicalPath: project.projectPath,
      aliases: uniqueStrings([input.projectName, input.name, path.basename(project.projectPath)], 8, 120),
      productSummary: compactText(input.projectSummary || input.productSummary || `Project at ${project.projectPath}`, 360),
      phase: compactText(input.phase, 80) || null,
      authorityStatus: "accepted",
      sourceRefs: compactSourceRefs(input.sourceRefs, project, 16).length > 0
        ? compactSourceRefs(input.sourceRefs, project, 16)
        : [{ kind: "project_binding", path: project.projectPath, hash: stableHash([project.projectId, project.projectPath]), projectId: project.projectId }],
      updatedAt: now,
    }, { now });
    const writes = [{ kind: "projectBrain", ...upsertProjectBrain(this.storeRoot, { ...brain, scopeKey: `project:${project.projectId}` }) }];
    this.ensureAuthorityScope({ ...input, ...project, now });
    for (const anchorInput of safeArray(input.anchors)) {
      const anchor = buildProjectAnchor({ ...anchorInput, projectId: project.projectId }, { projectId: project.projectId, projectPath: project.projectPath, now });
      writes.push({ kind: "projectAnchor", ...upsertProjectAnchor(this.storeRoot, { ...anchor, scopeKey: `project:${project.projectId}` }) });
    }
    for (const moduleInput of safeArray(input.modules)) {
      const module = buildModuleMemory({ ...moduleInput, projectId: project.projectId }, { projectId: project.projectId, projectPath: project.projectPath, now });
      writes.push({ kind: "moduleMemory", ...upsertModuleMemory(this.storeRoot, { ...module, scopeKey: `project:${project.projectId}` }) });
    }
    return { ...project, projectBrain: brain, writes: writes.map((write) => ({ kind: write.kind, action: write.action, id: write.record?.id || null, reasonCodes: safeArray(write.reasonCodes) })) };
  }

  hydrateReceiptById(receiptId, scope, now) {
    const id = compactText(receiptId, 180);
    if (!id) return null;
    if (this.receiptCache.has(id)) return this.receiptCache.get(id);
    const row = getAuthorityReceipt(this.storeRoot, id, { projectId: scope.projectId });
    if (!row) return null;
    const persisted = row.payload || row;
    const result = hydrateAuthorityReceipt(this.trustContext, persisted, { now });
    if (!result.ok) {
      this.metrics.receiptHydrationFailures += 1;
      return null;
    }
    const entry = { receipt: result.receipt, moduleId: compactText(persisted.moduleId, 180) || null };
    this.receiptCache.set(id, entry);
    this.metrics.receiptHydrations += 1;
    return entry;
  }

  hydrateReferencedReceipts(records, scope, now) {
    const ids = new Set();
    for (const record of safeArray(records)) {
      if (record?.authorityReceiptId) ids.add(record.authorityReceiptId);
      for (const trail of [...safeArray(record?.approvalTrail), ...safeArray(record?.authorityTrail)]) {
        if (trail?.receiptId || trail?.decisionId) ids.add(trail.receiptId || trail.decisionId);
      }
    }
    for (const id of Array.from(ids).slice(0, 160)) this.hydrateReceiptById(id, scope, now);
    return ids.size;
  }

  legacyFactWithAuthorityTrail(fact, scope, now, persistedLink = null) {
    const linkRow = persistedLink || getMemoryDecision(this.storeRoot, legacyFactAuthorityLinkId(fact?.id), { projectId: scope.projectId });
    const link = linkRow?.payload || linkRow;
    if (!link
      || link.decisionType !== LEGACY_FACT_AUTHORITY_LINK_TYPE
      || link.factId !== fact?.id
      || link.projectId !== scope.projectId
      || link.scopeKey !== `project:${scope.projectId}`
      || link.status !== "accepted"
      || !link.authorityReceiptId) return fact;
    const receiptEntry = this.hydrateReceiptById(link.authorityReceiptId, scope, now);
    const receipt = receiptEntry?.receipt;
    const exact = receipt
      && receipt.action === "approve"
      && receipt.transition === "review->accepted"
      && receipt.targetId === fact.id
      && receipt.scopeKey === `project:${scope.projectId}`
      && receipt.projectId === scope.projectId
      && receipt.projectPath === scope.projectPath
      && receipt.principalId === scope.owner.principalId
      && receipt.ownerId === scope.owner.principalId;
    if (!exact) return fact;
    return {
      ...fact,
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      scope: {
        type: "project",
        projectId: scope.projectId,
        projectPath: scope.projectPath,
      },
      ownerId: receipt.ownerId,
      approvalTrail: [{
        receiptId: receipt.receiptId,
        principalId: receipt.principalId,
        action: "approve",
        reason: "App-owned low-risk formation approval.",
        createdAt: receipt.createdAt,
      }],
    };
  }

  loadReadOnlyProjectState(scope, options = {}) {
    return withExistingReadOnlyIndex(this.storeRoot, (db) => {
      const tables = existingTableNames(db);
      const limit = Math.max(50, Math.min(Number(options.recordLimit || 1000), 2000));
      const normal = [...NORMAL_CORE_STATUSES];
      return {
        brainRow: readOnlyListCoreRecords(db, tables, "projectBrain", { projectId: scope.projectId, statuses: normal, limit: 1 })[0] || null,
        anchorRows: readOnlyListCoreRecords(db, tables, "projectAnchor", { projectId: scope.projectId, statuses: normal, limit }),
        moduleRows: readOnlyListCoreRecords(db, tables, "moduleMemory", { projectId: scope.projectId, statuses: normal, limit }),
        episodeRows: readOnlyListCoreRecords(db, tables, "episode", { projectId: scope.projectId, statuses: normal, limit }),
        decisionRows: readOnlyListCoreRecords(db, tables, "decision", { projectId: scope.projectId, statuses: normal, limit }),
        constraintRows: readOnlyListCoreRecords(db, tables, "constraint", { projectId: scope.projectId, statuses: normal, limit }),
        checkpointRows: readOnlyListCoreRecords(db, tables, "projectCheckpoint", { projectId: scope.projectId, statuses: normal, limit: 12 }),
        ruleRows: readOnlyListCoreRecords(db, tables, "standingRule", { projectId: scope.projectId, limit: 160 }),
        receiptRows: readOnlyListCoreRecords(db, tables, "authorityReceipt", { projectId: scope.projectId, limit: 320 }),
        facts: readOnlyMemoryFacts(db, tables, { projectPath: options.projectPath || scope.projectPath, limit: Math.max(100, Math.min(Number(options.factLimit || 600), 10_000)) }),
      };
    });
  }

  getProjectContinuity(options = {}) {
    const readOnly = options.readOnly === true;
    const project = deriveProjectIdentity(options);
    const scope = this.ensureAuthorityScope(options, { persist: !readOnly, allowCreateKey: !readOnly });
    if (!scope.projectId || !scope.projectPath) throw new Error("Memory Core projectPath is required.");
    const now = options.now || this.now || new Date().toISOString();
    if (scope.unavailableReason) {
      return compactUnavailable(project, [scope.unavailableReason], {
        principal: null,
        recoveryReady: false,
        continuityPacket: null,
        missing: PROJECT_CONTINUITY_SLOTS,
        stale: [],
        conflict: [],
        unsatisfied: PROJECT_CONTINUITY_SLOTS,
        nextCursor: null,
        mandatoryComplete: false,
        authorizedFactIds: [],
        authorizedCoreIds: [],
      });
    }
    if (!readOnly) this.ensureProjectBrain({ ...options, ...scope, now });
    const readState = readOnly ? this.loadReadOnlyProjectState(scope, options) : null;
    if (readOnly && !readState?.ready) {
      return compactUnavailable(project, readState?.reasonCodes || ["memory_core_state_not_ready"], {
        principal: { principalId: scope.service.principalId, role: "service", principalType: scope.service.principalType, owner: false },
        recoveryReady: false,
        continuityPacket: null,
        missing: PROJECT_CONTINUITY_SLOTS,
        stale: [],
        conflict: [],
        unsatisfied: PROJECT_CONTINUITY_SLOTS,
        nextCursor: null,
        mandatoryComplete: false,
        authorizedFactIds: [],
        authorizedCoreIds: [],
      });
    }
    const state = readState?.value || null;
    const brainRow = readOnly ? state.brainRow : getProjectBrain(this.storeRoot, scope.projectId, { projectId: scope.projectId });
    const projectBrain = brainRow ? buildProjectBrain(brainRow.payload || brainRow, { now }) : null;
    const limit = Math.max(50, Math.min(Number(options.recordLimit || 1000), 2000));
    const anchorRows = readOnly ? state.anchorRows : listProjectAnchors(this.storeRoot, { projectId: scope.projectId, view: "normal", limit });
    const moduleRows = readOnly ? state.moduleRows : listModuleMemories(this.storeRoot, { projectId: scope.projectId, view: "normal", limit });
    const episodeRows = readOnly ? state.episodeRows : listMemoryEpisodes(this.storeRoot, { projectId: scope.projectId, view: "normal", limit });
    const decisionRows = readOnly ? state.decisionRows : listMemoryDecisions(this.storeRoot, { projectId: scope.projectId, view: "normal", limit });
    const constraintRows = readOnly ? state.constraintRows : listMemoryConstraints(this.storeRoot, { projectId: scope.projectId, view: "normal", limit });
    const checkpointRows = readOnly ? state.checkpointRows : listProjectCheckpoints(this.storeRoot, { projectId: scope.projectId, view: "normal", limit: 12 });
    const ruleRows = readOnly ? state.ruleRows : listStandingRules(this.storeRoot, { projectId: scope.projectId, view: "all", limit: 160 });
    const facts = readOnly ? state.facts : listMemoryFacts(this.storeRoot, { projectPath: options.projectPath || scope.projectPath, limit: Math.max(100, Math.min(Number(options.factLimit || 600), 10_000)) });
    const payloads = (rows) => rows.map((row) => row.payload || row);
    const episodes = payloads(episodeRows);
    const isLegacyFactAuthorityLink = (row) => (row.payload || row).decisionType === LEGACY_FACT_AUTHORITY_LINK_TYPE;
    const legacyFactAuthorityLinks = new Map(decisionRows
      .filter((row) => isLegacyFactAuthorityLink(row))
      .map((row) => {
        const link = row.payload || row;
        return [link.factId, link];
      }));
    const visibleDecisionRows = decisionRows.filter((row) => !isLegacyFactAuthorityLink(row));
    const decisions = payloads(visibleDecisionRows);
    const constraints = payloads(constraintRows);
    const checkpoints = payloads(checkpointRows);
    const rulesRaw = payloads(ruleRows);
    if (readOnly) {
      for (const row of state.receiptRows) {
        const persisted = row.payload || row;
        const result = hydrateAuthorityReceipt(this.trustContext, persisted, { now });
        if (result.ok) this.receiptCache.set(result.receipt.receiptId, { receipt: result.receipt, moduleId: compactText(persisted.moduleId, 180) || null });
      }
    } else {
    this.hydrateReferencedReceipts([...episodes, ...decisions, ...constraints, ...checkpoints, ...rulesRaw, ...facts], scope, now);
    }
    const receiptBacked = (record) => Boolean(record.authorityReceiptId && this.receiptCache.has(record.authorityReceiptId));
    const authorizedEpisodeRows = episodeRows.filter((row) => receiptBacked(row.payload || row));
    const authorizedDecisionRows = visibleDecisionRows.filter((row) => receiptBacked(row.payload || row));
    const authorizedConstraintRows = constraintRows.filter((row) => receiptBacked(row.payload || row));
    const authorizedCheckpointRows = checkpointRows.filter((row) => receiptBacked(row.payload || row));
    const rules = rulesRaw.map((rule) => normalizeStandingRule(rule, { trustContext: this.trustContext, now })).filter((rule) => rule.status === "accepted");
    const anchors = [
      ...payloads(anchorRows),
      ...rules.map((rule) => ({
        anchorId: rule.ruleId,
        projectId: scope.projectId,
        category: "non_negotiable",
        statement: rule.statement,
        authorityStatus: "accepted",
        sourceRefs: rule.sourceRefs,
        updatedAt: rule.updatedAt,
      })),
    ];
    const modules = payloads(moduleRows);
    const legacyEnvelopes = facts.map((fact) => normalizeLegacyMemoryRecord(
      this.legacyFactWithAuthorityTrail(fact, scope, now, legacyFactAuthorityLinks.get(fact.id)),
      { trustContext: this.trustContext, now },
    ));
    const authorizedLegacy = queryAuthorizedMemory(legacyEnvelopes, scope.service, {
      trustContext: this.trustContext,
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      view: options.reviewMode === true ? "review" : "normal",
      asOf: now,
    });
    if (!projectBrain?.authoritative) {
      return {
        schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
        projectId: scope.projectId,
        projectPath: scope.projectPath,
        principal: { principalId: scope.service.principalId, role: "service", principalType: scope.service.principalType, owner: false },
        authority: {
          mode: options.reviewMode ? "review" : "normal",
          standingRuleCount: 0,
          authorizedCurrentFacts: authorizedLegacy.items.length,
          downgradedLegacyFacts: legacyEnvelopes.filter((fact) => fact.compatibility?.authorityDowngraded).length,
          rejectedLegacyFacts: legacyEnvelopes.filter((fact) => fact.status === "rejected").length,
        },
        recoveryReady: false,
        continuityPacket: null,
        missing: PROJECT_CONTINUITY_SLOTS,
        stale: [],
        conflict: [],
        unsatisfied: PROJECT_CONTINUITY_SLOTS,
        nextCursor: null,
        mandatoryComplete: false,
        warnings: ["project_brain_not_authoritative"],
        authorizedFactIds: authorizedLegacy.items.map((item) => item.memoryId),
        authorizedCoreIds: [],
      };
    }
    const optionalSlots = safeArray(options.optionalSlots).length > 0 ? options.optionalSlots : ["open_blockers", "latest_failures"];
    const workingRecords = safeArray(options.workingMemory).filter((record) => !record.projectPath || normalizePath(record.projectPath) === scope.projectPath);
    const derivedWorkingState = {
      openTasks: workingRecords.filter((record) => ["active", "waiting_review", "blocked"].includes(record.status)).map((record) => ({
        id: record.taskId,
        projectId: scope.projectId,
        title: record.currentGoal || record.taskId,
        status: record.status === "blocked" ? "blocked" : "open",
        authorityStatus: record.status === "blocked" ? "review" : "accepted",
        sourceRefs: compactSourceRefs(record.currentEvidence, { projectId: scope.projectId, projectPath: scope.projectPath, moduleId: deriveModuleId(record, "working-memory") }, 8),
      })),
      blockers: workingRecords.filter((record) => record.status === "blocked").flatMap((record) => safeArray(record.openRisks).map((summary) => ({
        projectId: scope.projectId,
        title: summary,
        status: "open",
        authorityStatus: "review",
        sourceRefs: compactSourceRefs(record.currentEvidence, { projectId: scope.projectId, projectPath: scope.projectPath, moduleId: deriveModuleId(record, "working-memory") }, 8),
      }))),
      nextActions: workingRecords.map((record) => record.nextAction).filter(Boolean),
    };
    const workingState = options.workingState && typeof options.workingState === "object" ? options.workingState : derivedWorkingState;
    const packet = buildProjectContinuityPacket(projectBrain, anchors, modules, workingState, {
      facts: authorizedLegacy.items,
      episodes: authorizedEpisodeRows.map((row) => row.payload || row),
      decisions: authorizedDecisionRows.map((row) => row.payload || row),
      constraints: authorizedConstraintRows.map((row) => row.payload || row),
    }, {
      now,
      checkpoint: authorizedCheckpointRows[0]?.payload || authorizedCheckpointRows[0] || null,
      optionalSlots,
      tokenBudget: Math.max(1800, Math.min(Number(options.tokenBudget || 2200), 6000)),
      maxPacketItems: Math.max(1, Math.min(Number(options.maxPacketItems || 32), 64)),
      maxPacketChars: Math.max(8000, Math.min(Number(options.maxPacketChars || 18000), 24000)),
      maxItemsPerSlot: Math.max(1, Math.min(Number(options.maxItemsPerSlot || 8), 32)),
      mandatoryCursor: options.cursor ?? options.mandatoryCursor ?? null,
    });
    const requiredUnsatisfied = packet.continuity.unsatisfiedSlots.filter((slot) => !optionalSlots.includes(slot));
    const recoveryReady = requiredUnsatisfied.length === 0
      && packet.continuity.staleSlots.length === 0
      && packet.continuity.conflictSlots.length === 0
      && packet.requiresContinuation !== true
      && packet.mandatoryRemaining === 0
      && packet.mandatoryManifest.cursorInvalid !== true;
    const cueSet = buildCueSet({
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      moduleId: options.moduleId,
      filePath: options.filePath,
      errorCode: options.errorCode,
      taskGoal: options.taskGoal || options.query,
      threadId: options.threadId,
    });
    const moduleResolution = resolveModuleMemory(modules, cueSet, { projectId: scope.projectId, reviewMode: options.reviewMode === true });
    this.metrics.continuityPages += 1;
    return {
      schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      principal: { principalId: scope.service.principalId, role: "service", principalType: scope.service.principalType, owner: false },
      authority: {
        mode: options.reviewMode ? "review" : "normal",
        standingRuleCount: rules.length,
        authorizedCurrentFacts: authorizedLegacy.items.length,
        downgradedLegacyFacts: legacyEnvelopes.filter((fact) => fact.compatibility?.authorityDowngraded).length,
        rejectedLegacyFacts: legacyEnvelopes.filter((fact) => fact.status === "rejected").length,
      },
      cueSet,
      moduleResolution,
      continuityPacket: packet,
      recoveryReady,
      missing: packet.continuity.missingSlots,
      stale: packet.continuity.staleSlots,
      conflict: packet.continuity.conflictSlots,
      unsatisfied: requiredUnsatisfied,
      nextCursor: packet.nextCursor,
      mandatoryComplete: packet.mandatoryManifest.complete,
      authorizedFactIds: authorizedLegacy.items.map((item) => item.memoryId),
      authorizedCoreIds: [
        brainRow.id,
        ...anchorRows.map((row) => row.id),
        ...moduleRows.map((row) => row.id),
        ...authorizedEpisodeRows.map((row) => row.id),
        ...authorizedDecisionRows.map((row) => row.id),
        ...authorizedConstraintRows.map((row) => row.id),
        ...authorizedCheckpointRows.map((row) => row.id),
      ].filter(Boolean),
      warnings: [
        ...(recoveryReady ? [] : ["continuity_not_recovery_ready"]),
        ...(packet.requiresContinuation ? ["mandatory_continuity_pagination_required"] : []),
        ...(packet.mandatoryManifest.cursorInvalid ? ["mandatory_continuity_cursor_invalid"] : []),
      ],
    };
  }

  getContinuityStatus(options = {}) {
    let cursor = options.cursor || null;
    let pagesRead = 0;
    let mandatoryReturned = 0;
    let mandatoryTotal = 0;
    let lastPage = null;
    let cursorInvalid = false;
    let expectedOffset = 0;
    let expectedManifest = null;
    const seenCursors = new Set();
    const sourceRefs = [];
    do {
      const requestedCursor = cursor;
      if (requestedCursor && seenCursors.has(requestedCursor)) {
        cursorInvalid = true;
        cursor = null;
        break;
      }
      if (requestedCursor) seenCursors.add(requestedCursor);
      lastPage = this.getProjectContinuity({ ...options, readOnly: true, cursor: requestedCursor });
      if (lastPage.availability === "not_ready") break;
      pagesRead += 1;
      const manifest = lastPage.continuityPacket?.mandatoryManifest;
      const pageReturned = Number(lastPage.continuityPacket?.mandatoryReturned || 0);
      const pageTotal = Number(lastPage.continuityPacket?.mandatoryTotal || 0);
      const pageStart = Number(manifest?.pageStart);
      const pageEndExclusive = Number(manifest?.pageEndExclusive);
      const pageManifest = lastPage.continuityPacket?.manifestFingerprint || null;
      const invalidProgress = manifest?.cursorInvalid === true
        || !Number.isInteger(pageStart)
        || !Number.isInteger(pageEndExclusive)
        || pageStart !== expectedOffset
        || pageEndExclusive !== pageStart + pageReturned
        || pageEndExclusive > pageTotal
        || (expectedManifest && pageManifest !== expectedManifest);
      if (invalidProgress) {
        cursorInvalid = true;
        cursor = null;
        break;
      }
      expectedManifest ||= pageManifest;
      expectedOffset = pageEndExclusive;
      mandatoryReturned += pageReturned;
      mandatoryTotal = pageTotal;
      sourceRefs.push(...safeArray(lastPage.continuityPacket?.sourceRefs));
      const nextCursor = lastPage.nextCursor;
      if (nextCursor && (nextCursor === requestedCursor || seenCursors.has(nextCursor) || pageReturned <= 0)) {
        cursorInvalid = true;
        cursor = null;
        break;
      }
      cursor = nextCursor;
    } while (cursor && pagesRead < MAX_CONTINUITY_PAGES && mandatoryReturned < MAX_CONTINUITY_MANDATORY_ITEMS);
    const complete = !cursor && !cursorInvalid && lastPage?.mandatoryComplete === true;
    const unsatisfiedSlots = uniqueStrings(lastPage?.unsatisfied, PROJECT_CONTINUITY_SLOTS.length, 80);
    return {
      schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
      projectId: lastPage?.projectId || null,
      projectPath: lastPage?.projectPath || null,
      recoveryReady: complete && lastPage?.recoveryReady === true && unsatisfiedSlots.length === 0,
      availability: lastPage?.availability || "ready",
      reasonCodes: safeArray(lastPage?.reasonCodes),
      resolutionStatus: lastPage?.availability === "not_ready" ? "not_ready" : lastPage?.continuityPacket ? "resolved" : "not_found",
      mandatorySlots: lastPage?.continuityPacket?.continuity?.requiredSlots || PROJECT_CONTINUITY_SLOTS,
      filledSlots: safeArray(lastPage?.continuityPacket?.continuity?.filledSlots),
      missingSlots: safeArray(lastPage?.missing),
      staleSlots: safeArray(lastPage?.stale),
      conflictSlots: safeArray(lastPage?.conflict),
      unsatisfiedSlots,
      coverage: Number(lastPage?.continuityPacket?.continuity?.coverage || 0),
      pagination: {
        complete,
        pagesRead,
        mandatoryTotal,
        mandatoryReturned,
        manifestFingerprint: lastPage?.continuityPacket?.manifestFingerprint || null,
        capped: !complete,
        nextCursor: cursor || null,
        cursorInvalid,
      },
      sourceRefs: compactSourceRefs(sourceRefs, { projectId: lastPage?.projectId, projectPath: lastPage?.projectPath }, MAX_SOURCE_REFS),
      warnings: [
        ...safeArray(lastPage?.warnings),
        ...(!complete ? ["continuity_pagination_bounded_before_completion"] : []),
        ...(cursorInvalid ? ["mandatory_continuity_cursor_invalid"] : []),
        ...(unsatisfiedSlots.length > 0 ? ["mandatory_continuity_slots_unsatisfied"] : []),
      ],
      performance: {
        startupFullScan: false,
        startsTimers: false,
        rawSessionBodyRead: false,
        boundedPagination: true,
      },
    };
  }

  listReviewQueue(options = {}) {
    const project = deriveProjectIdentity(options);
    const limit = Math.max(1, Math.min(Number(options.limit || 80), MAX_REVIEW_ITEMS));
    const readResult = withExistingReadOnlyIndex(this.storeRoot, (db) => {
      const tables = existingTableNames(db);
      return ["episode", "decision", "constraint", "projectCheckpoint", "projectBrain", "projectAnchor", "moduleMemory"]
        .flatMap((kind) => readOnlyListCoreRecords(db, tables, kind, { projectId: project.projectId || undefined, statuses: [...REVIEW_CORE_STATUSES], limit }))
        .map(memoryCoreRecordToRecallItem)
        .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")) || left.id.localeCompare(right.id))
        .slice(0, limit);
    });
    const items = readResult.ready ? readResult.value : [];
    return {
      schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
      projectId: project.projectId,
      projectPath: project.projectPath,
      availability: readResult.ready ? "ready" : "not_ready",
      reasonCodes: readResult.ready ? [] : readResult.reasonCodes,
      items,
      count: items.length,
      readOnly: true,
    };
  }

  decorateRetrievalResult(packet = {}, memoryCore = null) {
    const decorated = this.decorateRetrievalPacket(packet, memoryCore);
    if (!memoryCore) return decorated;
    return {
      ...decorated,
      items: safeArray(decorated.items).map((item) => ({
        ...item,
        identity: memoryCore.principal || null,
        authority: {
          projectId: memoryCore.projectId,
          scopeKey: memoryCore.projectId ? `project:${memoryCore.projectId}` : null,
          mode: memoryCore.authority?.mode || "normal",
          authoritative: true,
        },
        continuity: memoryCore.continuityPacket ? {
          manifestFingerprint: memoryCore.continuityPacket.manifestFingerprint,
          mandatoryComplete: memoryCore.mandatoryComplete,
          nextCursor: memoryCore.nextCursor,
        } : null,
        why: uniqueStrings([item.whyMatched, item.whyRecalled], 12, 140),
      })),
    };
  }

  getDiagnostics(options = {}) {
    const project = deriveProjectIdentity(options);
    const countKinds = { projectBrains: "projectBrain", projectAnchors: "projectAnchor", modules: "moduleMemory", episodes: "episode", decisions: "decision", constraints: "constraint", checkpoints: "projectCheckpoint", authorityReceipts: "authorityReceipt" };
    const readResult = withExistingReadOnlyIndex(this.storeRoot, (db) => {
      const tables = existingTableNames(db);
      const counts = {};
      for (const [label, kind] of Object.entries(countKinds)) {
        counts[label] = project.projectId
          ? readOnlyListCoreRecords(db, tables, kind, { projectId: project.projectId, limit: 2000 }).length
          : 0;
      }
      const reviewQueueCount = project.projectId
        ? ["episode", "decision", "constraint", "projectCheckpoint", "projectBrain", "projectAnchor", "moduleMemory"]
          .reduce((sum, kind) => sum + readOnlyListCoreRecords(db, tables, kind, { projectId: project.projectId, statuses: [...REVIEW_CORE_STATUSES], limit: MAX_REVIEW_ITEMS }).length, 0)
        : 0;
      return { counts, reviewQueueCount };
    });
    const ready = readResult.ready;
    return {
      schemaVersion: MEMORY_CORE_RUNTIME_SCHEMA,
      projectId: project.projectId,
      projectPath: project.projectPath,
      privateStateReady: fs.existsSync(signingKeyPath(this.storeRoot)),
      sidecarReady: fs.existsSync(indexPath(this.storeRoot)),
      availability: ready ? "ready" : "not_ready",
      reasonCodes: ready ? [] : readResult.reasonCodes,
      counts: ready ? readResult.value.counts : {},
      reviewQueueCount: ready ? readResult.value.reviewQueueCount : 0,
      initialized: ready,
      lazyInitialization: true,
      startupWholeTableScan: false,
      timers: false,
      watchers: false,
      embeddings: false,
      graphRebuild: false,
      loadedProjectCount: this.loadedProjects.size,
      receiptCacheSize: this.receiptCache.size,
      metrics: { ...this.metrics },
      authorityFilterOrder: "before_relevance_ranking",
      safety: {
        signingKeyExposed: false,
        trustContextExposed: false,
        rawSessionBodyRead: false,
        storesBase64: false,
        startupFullScan: false,
        startsTimers: false,
        backgroundGraphRebuild: false,
      },
    };
  }
}

function createMemoryCoreRuntime(options = {}) {
  return new MemoryCoreRuntime(options);
}

module.exports = {
  MEMORY_CORE_RUNTIME_SCHEMA,
  MemoryCoreRuntime,
  compactRecallItem,
  buildUnavailableMemoryCoreContinuity,
  buildUnavailableMemoryCoreDiagnostics,
  buildUnavailableMemoryCoreReviewQueue,
  buildUnavailableProjectContinuity,
  createMemoryCoreRuntime,
  deriveProjectIdentity,
  loadExistingSigningKey,
  loadOrCreateSigningKey,
  memoryCorePrivateStateExists,
  normalizeLifecycleInput,
};
