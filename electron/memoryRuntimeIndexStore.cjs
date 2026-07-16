const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const {
  buildMemoryFactUpsertPlan,
  normalizeMemoryFact,
  queryMemoryFacts,
  scanPersistenceStructure,
} = require("./memoryFactPolicy.cjs");

const MEMORY_RUNTIME_INDEX_SCHEMA = "zhixia.memory_runtime_index.v1";
const MEMORY_CORE_SIDECAR_SCHEMA = "zhixia.memory_core_sidecar.v1";
const MEMORY_RUNTIME_BUSY_TIMEOUT_MS = 100;
const MEMORY_CORE_MAX_PAYLOAD_BYTES = 64 * 1024;
const RAW_SESSION_KIND_RE = /\b(raw[_ -]?session|codex[_ -]?session|session[_ -]?jsonl)\b/i;
const RAW_SESSION_PATH_RE = /(?:^|[\\/])\.codex[\\/](?:archived_)?sessions[\\/]|(?:^|[\\/])sessions[\\/][^\\/]*(?:session|thread)[^\\/]*\.jsonl$/i;
const SECRET_VALUE_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b|\b(?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|password|passwd|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{4,}/i;
const SECRET_PATH_RE = /(?:^|[\\/])\.env(?:$|[.\\/_-])|(?:^|[\\/])(?:id_rsa|id_ed25519|credentials)(?:$|[.\\/_-])/i;
const BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{80,}|\b[A-Za-z0-9+/]{220,}={0,2}\b/;
const FORBIDDEN_PERSISTENCE_KEY_RE = /^(?:raw|rawbody|body|content|contenttext|transcript|session|messages|payload|blob|binary|base64|secret|password|passwd|apikey|authtoken|accesstoken|refreshtoken|privatekey|credential|credentials|cookie)$/i;
const CURRENT_MEMORY_CORE_STATUSES = new Set(["active", "accepted", "curated", "current"]);
const NORMAL_MEMORY_CORE_STATUSES = Object.freeze(["active", "accepted", "curated", "current", "persisted", "ready"]);
const REVIEW_MEMORY_CORE_STATUSES = Object.freeze(["candidate", "review"]);
const HISTORICAL_MEMORY_CORE_STATUSES = Object.freeze(["rejected", "revoked", "expired", "superseded", "historical", "inactive"]);
const MEMORY_CORE_EPOCH = new Date(0).toISOString();

const MEMORY_CORE_RECORD_SPECS = Object.freeze({
  principal: Object.freeze({ table: "memory_principals", idFields: ["principalId", "id"], idField: "principalId", type: "principal", statusField: "status", defaultStatus: "review", currentGate: true, requireScopeForCurrent: true }),
  projectBinding: Object.freeze({ table: "memory_project_bindings", idFields: ["bindingId", "id"], idField: "bindingId", type: "project_binding", statusField: "status", defaultStatus: "inactive", validFromFields: ["validFrom"], validToFields: ["validTo"], currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
  standingRule: Object.freeze({ table: "memory_standing_rules", idFields: ["ruleId", "id"], idField: "ruleId", type: "standing_rule", statusField: "status", defaultStatus: "candidate", validFromFields: ["effectiveFrom", "validFrom"], validToFields: ["effectiveTo", "validTo"], currentGate: true, requireScopeForCurrent: true }),
  authorityReceipt: Object.freeze({ table: "memory_authority_receipts", idFields: ["receiptId", "decisionId", "id"], idField: "receiptId", type: "authority_receipt", statusField: "status", defaultStatus: "persisted", validFromFields: ["validFrom"], validToFields: ["validTo"], immutable: true, fingerprintFields: ["receiptProof", "proof", "fingerprint"], uniqueFingerprint: true }),
  projectBrain: Object.freeze({ table: "memory_project_brains", idFields: ["projectId", "id"], idField: "projectId", type: "project_brain", statusField: "authorityStatus", defaultStatus: "review", currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
  projectAnchor: Object.freeze({ table: "memory_project_anchors", idFields: ["anchorId", "id"], idField: "anchorId", type: "project_anchor", statusField: "authorityStatus", defaultStatus: "review", typeFields: ["category", "anchorType"], currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
  moduleMemory: Object.freeze({ table: "memory_modules", idFields: ["moduleId", "id"], idField: "moduleId", type: "module_memory", statusField: "authorityStatus", defaultStatus: "review", currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
  episode: Object.freeze({ table: "memory_episodes", idFields: ["episodeId", "eventId", "id"], idField: "episodeId", type: "episode", statusField: "status", defaultStatus: "review", typeFields: ["episodeType", "eventType", "type"], currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
  decision: Object.freeze({ table: "memory_decisions", idFields: ["decisionId", "id"], idField: "decisionId", type: "decision", statusField: "status", defaultStatus: "review", typeFields: ["decisionType", "type"], currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
  constraint: Object.freeze({ table: "memory_constraints", idFields: ["constraintId", "id"], idField: "constraintId", type: "constraint", statusField: "status", defaultStatus: "review", typeFields: ["constraintType", "type"], currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
  projectCheckpoint: Object.freeze({ table: "memory_project_checkpoints", idFields: ["checkpointId", "id"], idField: "checkpointId", type: "project_checkpoint", statusField: "authorityStatus", defaultStatus: "review", immutable: true, currentGate: true, requireProjectForCurrent: true, requireScopeForCurrent: true }),
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value, maxChars = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function redactSensitiveText(value, maxChars = 800) {
  return compactText(value, maxChars)
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[private-key-omitted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [secret-omitted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/gi, "[secret-omitted]")
    .replace(/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}/gi, "[secret-omitted]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[secret-omitted]")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]*\.codex[\\/]sessions[\\/][^\s"'<>|]+/gi, "[raw-session-pointer-omitted]");
}

function inspectPersistenceInput(value = {}) {
  let scan;
  try {
    scan = scanPersistenceStructure(value);
  } catch {
    scan = {
      signal: "",
      strongSplitSecret: false,
      giantBody: false,
      structureTruncated: true,
      stats: { scannerFailedClosed: true },
    };
  }
  const text = scan.signal;
  return {
    rawSession: RAW_SESSION_KIND_RE.test(text) || RAW_SESSION_PATH_RE.test(text),
    secret: SECRET_VALUE_RE.test(text) || SECRET_PATH_RE.test(text) || scan.strongSplitSecret,
    base64: BASE64_RE.test(text),
    giantBody: scan.giantBody,
    structureTruncated: scan.structureTruncated,
    scanStats: scan.stats,
  };
}

function canonicalizePersistenceValue(value, depth = 0) {
  if (depth > 12) throw new Error("Memory Core payload exceeds the compact nesting limit.");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item) => canonicalizePersistenceValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizePersistenceValue(value[key], depth + 1)]));
  }
  throw new Error("Memory Core payload must be JSON-compatible compact metadata.");
}

function stablePersistenceStringify(value) {
  return JSON.stringify(canonicalizePersistenceValue(value));
}

function stablePersistenceHash(value) {
  return crypto.createHash("sha256").update(stablePersistenceStringify(value)).digest("hex");
}

function inspectForbiddenPersistenceKeys(value) {
  const seen = new WeakSet();
  const stack = [{ value, depth: 0 }];
  const keys = [];
  let nodesVisited = 0;
  let traversalRejected = false;
  while (stack.length > 0 && !traversalRejected) {
    const current = stack.pop();
    if (!current.value || typeof current.value !== "object" || seen.has(current.value)) continue;
    nodesVisited += 1;
    if (nodesVisited > 1024 || current.depth > 16) {
      traversalRejected = true;
      break;
    }
    seen.add(current.value);
    let ownKeys;
    try {
      ownKeys = Object.keys(current.value);
    } catch {
      traversalRejected = true;
      break;
    }
    if (ownKeys.length > 256) {
      traversalRejected = true;
      break;
    }
    for (const key of ownKeys) {
      const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (FORBIDDEN_PERSISTENCE_KEY_RE.test(normalized)) keys.push(key);
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      } catch {
        traversalRejected = true;
        break;
      }
      if (!descriptor || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        traversalRejected = true;
        break;
      }
      if (descriptor.value && typeof descriptor.value === "object") stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return { keys: keys.slice(0, 20), traversalRejected, nodesVisited };
}

function inspectMemoryCorePayload(value = {}) {
  const inspection = inspectPersistenceInput(value);
  const forbidden = inspectForbiddenPersistenceKeys(value);
  const forbiddenKeys = forbidden.keys;
  let payloadBytes = Infinity;
  try {
    payloadBytes = Buffer.byteLength(stablePersistenceStringify(value), "utf8");
  } catch {
    inspection.structureTruncated = true;
  }
  const reasonCodes = [
    ...(inspection.rawSession ? ["unsafe_raw_session"] : []),
    ...(inspection.secret ? ["unsafe_secret"] : []),
    ...(inspection.base64 ? ["unsafe_base64"] : []),
    ...(inspection.giantBody ? ["unsafe_giant_structure"] : []),
    ...(inspection.structureTruncated || forbidden.traversalRejected ? ["unsafe_truncated_structure"] : []),
    ...(forbiddenKeys.length > 0 ? ["forbidden_payload_field"] : []),
    ...(payloadBytes > MEMORY_CORE_MAX_PAYLOAD_BYTES ? ["payload_too_large"] : []),
  ];
  return {
    safe: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
    forbiddenKeys,
    payloadBytes,
  };
}

function firstCompactValue(input, fields, maxChars = 240) {
  for (const field of safeArray(fields)) {
    const value = compactText(input?.[field], maxChars);
    if (value) return value;
  }
  return null;
}

function isoTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function directSourceRefsPresent(input = {}) {
  return Array.isArray(input.sourceRefs) && input.sourceRefs.some((ref) => {
    if (typeof ref === "string") return compactText(ref, 520).length > 0;
    if (!ref || typeof ref !== "object") return false;
    return [ref.id, ref.path, ref.uri, ref.url, ref.hash].some((value) => compactText(value, 520));
  });
}

function memoryCoreRecordSpec(recordKind) {
  const spec = MEMORY_CORE_RECORD_SPECS[recordKind];
  if (!spec) throw new Error(`Unsupported Memory Core record kind: ${recordKind}`);
  return spec;
}

function normalizeMemoryCoreRecord(recordKind, input = {}, options = {}) {
  const spec = memoryCoreRecordSpec(recordKind);
  const inspection = inspectMemoryCorePayload(input);
  if (!inspection.safe) {
    return { ok: false, reasonCodes: inspection.reasonCodes, forbiddenKeys: inspection.forbiddenKeys, record: null };
  }
  let payload;
  try {
    payload = canonicalizePersistenceValue(input);
  } catch {
    return { ok: false, reasonCodes: ["unsafe_truncated_structure"], forbiddenKeys: inspection.forbiddenKeys, record: null };
  }
  const projectId = compactText(payload.projectId || (recordKind === "projectBrain" ? payload.id : ""), 240) || null;
  const scopeKey = compactText(payload.scopeKey || payload.scope?.key || (projectId ? `project:${projectId}` : ""), 280) || null;
  let status = compactText(payload[spec.statusField] || payload.status || spec.defaultStatus, 40).toLowerCase() || spec.defaultStatus;
  const reviewReasonCodes = [];
  if (spec.currentGate && CURRENT_MEMORY_CORE_STATUSES.has(status)) {
    if ((spec.requireProjectForCurrent || scopeKey?.startsWith("project:")) && !projectId) reviewReasonCodes.push("project_id_required_for_current_record");
    if (spec.requireScopeForCurrent && !scopeKey) reviewReasonCodes.push("scope_key_required_for_current_record");
    if (!directSourceRefsPresent(payload)) reviewReasonCodes.push("direct_source_refs_required_for_current_record");
    if (reviewReasonCodes.length > 0) status = "review";
  }
  const updatedAt = isoTimestamp(payload.updatedAt || payload.observedAt || payload.createdAt || payload.effectiveFrom || payload.validFrom) || MEMORY_CORE_EPOCH;
  const validFrom = isoTimestamp(firstCompactValue(payload, spec.validFromFields || ["validFrom"], 80));
  const validTo = isoTimestamp(firstCompactValue(payload, spec.validToFields || ["validTo"], 80));
  const type = firstCompactValue(payload, spec.typeFields || [], 80) || spec.type;
  const identitySeed = { recordKind, projectId, scopeKey, type, payload };
  const id = firstCompactValue(payload, spec.idFields, 220) || `${spec.type}-${stablePersistenceHash(identitySeed).slice(0, 20)}`;
  payload[spec.idField] = id;
  if (projectId) payload.projectId = projectId;
  payload[spec.statusField] = status;
  payload.updatedAt = updatedAt;
  if (reviewReasonCodes.length > 0) {
    payload.authoritative = false;
    payload.reviewReasonCodes = [...new Set([...safeArray(payload.reviewReasonCodes), ...reviewReasonCodes])].slice(0, 12);
  }
  const payloadJson = stablePersistenceStringify(payload);
  const contentHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
  const fingerprint = firstCompactValue(payload, spec.fingerprintFields || [], 220);
  if (recordKind === "authorityReceipt" && !fingerprint) {
    return { ok: false, reasonCodes: ["authority_receipt_fingerprint_required"], forbiddenKeys: [], record: null };
  }
  return {
    ok: true,
    reasonCodes: reviewReasonCodes,
    record: {
      id,
      projectId,
      scopeKey,
      status,
      type,
      updatedAt,
      validFrom,
      validTo,
      createdAt: isoTimestamp(payload.createdAt) || updatedAt,
      fingerprint: fingerprint || null,
      payloadJson,
      contentHash,
    },
  };
}

function tokenizeIndexText(value) {
  const text = compactText(value, 4000).toLowerCase();
  const tokens = new Set(text.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []);
  for (const block of text.match(/[\u3400-\u9fff]{2,}/g) || []) {
    if (block.length <= 8) tokens.add(block);
    for (let index = 0; index < block.length - 1; index += 1) {
      tokens.add(block.slice(index, index + 2));
    }
  }
  return Array.from(tokens).filter(Boolean).slice(0, 160);
}

function normalizeMemorySearchScope(item = {}, options = {}) {
  const kind = compactText(item.kind || "memory", 80);
  let projectPath = item.projectPath || null;
  let scope = compactText(item.scope || "", 40).toLowerCase() || null;
  let violation = false;
  if (kind !== "memory_fact") return { kind, projectPath, scope: null, violation };
  if (!scope && options.inferMissingScope === true) scope = projectPath ? "project" : "global";
  if (!["project", "global"].includes(scope || "")) violation = true;
  if (scope === "project" && !projectPath) violation = true;
  if (scope === "global" && projectPath) {
    violation = true;
    projectPath = null;
  }
  if (!scope) violation = true;
  return { kind, projectPath, scope, violation };
}

function containsUnsafePayload(item) {
  const inspection = inspectPersistenceInput(item);
  return inspection.rawSession || inspection.secret || inspection.base64 || inspection.giantBody || inspection.structureTruncated;
}

function normalizeSearchItem(item = {}) {
  const id = compactText(item.id, 220);
  if (!id || containsUnsafePayload(item)) return null;
  const scopeInvariant = normalizeMemorySearchScope(item, { inferMissingScope: true });
  const title = compactText(item.title || item.label || id, 240);
  const summary = compactText(item.summary || item.excerpt || item.body || "", 1600);
  const tags = safeArray(item.tags).map((tag) => compactText(tag, 80)).filter(Boolean).slice(0, 24);
  const sourceRefs = safeArray(item.sourceRefs).slice(0, 12).map((ref) => ({
    kind: compactText(ref?.kind, 80) || "source",
    path: ref?.path ? compactText(ref.path, 520) : null,
    title: ref?.title ? compactText(ref.title, 180) : null,
    hash: ref?.hash ? compactText(ref.hash, 160) : null,
    updatedAt: ref?.updatedAt || null,
  }));
  const normalized = {
    id,
    kind: scopeInvariant.kind,
    projectPath: scopeInvariant.projectPath,
    scope: scopeInvariant.scope,
    threadId: item.threadId || item.parentCeoThreadId || null,
    title,
    summary,
    tags,
    sourceRefs,
    status: scopeInvariant.violation ? "review" : compactText(item.status || "ready", 40),
    freshness: scopeInvariant.violation ? "review" : compactText(item.freshness || "unknown", 40),
    requiresHumanConfirmation: scopeInvariant.violation || item.requiresHumanConfirmation === true,
    tokenEstimate: Math.max(16, Math.min(Number(item.tokenEstimate || Math.ceil((title.length + summary.length) / 4)), 8000)),
    existingScore: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
    graphActivation: Number.isFinite(Number(item.activation || item.graphActivation)) ? Number(item.activation || item.graphActivation) : 0,
    updatedAt: item.updatedAt || item.sourceDocumentUpdatedAt || new Date(0).toISOString(),
  };
  return {
    ...normalized,
    searchTerms: tokenizeIndexText([title, summary, tags.join(" "), normalized.scope || "", normalized.projectPath || "", normalized.threadId || ""].join(" ")).join(" "),
    contentHash: stableHash(normalized),
  };
}

function indexPath(storeRoot) {
  return path.join(storeRoot, "memory-runtime-index.sqlite");
}

function closeDatabase(db) {
  if (!db) return;
  try {
    db.close();
  } catch {
    // Closing is best-effort after the primary operation has already completed or failed.
  }
}

function withMemoryRuntimeIndex(storeRoot, operation) {
  const db = openMemoryRuntimeIndex(storeRoot);
  try {
    return operation(db);
  } finally {
    closeDatabase(db);
  }
}

function withImmediateTransaction(db, operation) {
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const result = operation();
    db.exec("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original lock/statement failure.
      }
    }
    throw error;
  }
}

const MEMORY_CORE_COLUMN_DEFINITIONS = Object.freeze({
  id: "TEXT PRIMARY KEY",
  projectId: "TEXT",
  scopeKey: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'review'",
  type: "TEXT NOT NULL DEFAULT 'unknown'",
  updatedAt: `TEXT NOT NULL DEFAULT '${MEMORY_CORE_EPOCH}'`,
  validFrom: "TEXT",
  validTo: "TEXT",
  createdAt: `TEXT NOT NULL DEFAULT '${MEMORY_CORE_EPOCH}'`,
  fingerprint: "TEXT",
  payloadJson: "TEXT NOT NULL DEFAULT '{}'",
  contentHash: "TEXT NOT NULL DEFAULT ''",
});

function incompatibleMemoryCoreSchema(message, cause = null) {
  const error = new Error(`Incompatible Memory Core sidecar schema: ${message}`);
  error.code = "MEMORY_CORE_INCOMPATIBLE_SCHEMA";
  if (cause) error.cause = cause;
  return error;
}

function ensureAuthorityReceiptProofMigration(db, spec) {
  const uniqueIndexName = `uidx_${spec.table}_exact_receipt_proof`;
  const indexes = db.prepare(`PRAGMA index_list(${spec.table})`).all();
  if (indexes.some((index) => index.name === uniqueIndexName && Number(index.unique) === 1)) return;
  withImmediateTransaction(db, () => {
    const rows = db.prepare(`SELECT id, fingerprint, payloadJson FROM ${spec.table} ORDER BY id ASC`).all();
    const proofOwners = new Map();
    const migrations = [];
    for (const row of rows) {
      const payloadJson = typeof row.payloadJson === "string" ? row.payloadJson : "";
      if (!payloadJson || Buffer.byteLength(payloadJson, "utf8") > MEMORY_CORE_MAX_PAYLOAD_BYTES) {
        throw incompatibleMemoryCoreSchema(`${spec.table}.${row.id} has missing or oversized legacy payloadJson.`);
      }
      let payload;
      try {
        payload = JSON.parse(payloadJson);
      } catch (error) {
        throw incompatibleMemoryCoreSchema(`${spec.table}.${row.id} has invalid legacy payloadJson.`, error);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw incompatibleMemoryCoreSchema(`${spec.table}.${row.id} legacy payloadJson must contain a compact receipt object.`);
      }
      const inspection = inspectMemoryCorePayload(payload);
      if (!inspection.safe) {
        throw incompatibleMemoryCoreSchema(`${spec.table}.${row.id} contains unsafe legacy receipt payload metadata: ${inspection.reasonCodes.join(", ")}.`);
      }
      const rawProof = payload.receiptProof ?? payload.proof ?? null;
      if (rawProof !== null && typeof rawProof !== "string") {
        throw incompatibleMemoryCoreSchema(`${spec.table}.${row.id} has a non-text legacy receipt proof.`);
      }
      const exactProof = compactText(rawProof, 220) || null;
      const logicalFingerprint = compactText(payload.decisionFingerprint, 220) || null;
      const storedFingerprint = compactText(row.fingerprint, 220) || null;
      if (exactProof) {
        if (storedFingerprint && storedFingerprint !== exactProof && storedFingerprint !== logicalFingerprint) {
          throw incompatibleMemoryCoreSchema(`${spec.table}.${row.id} has an unrecognized legacy fingerprint that does not match its exact receipt proof.`);
        }
        const ownerId = proofOwners.get(exactProof);
        if (ownerId && ownerId !== row.id) {
          throw incompatibleMemoryCoreSchema(`${spec.table} contains duplicate exact authority receipt proof across IDs ${ownerId} and ${row.id}.`);
        }
        proofOwners.set(exactProof, row.id);
        if (storedFingerprint !== exactProof) migrations.push({ id: row.id, fingerprint: exactProof });
      } else if (storedFingerprint && storedFingerprint === logicalFingerprint) {
        migrations.push({ id: row.id, fingerprint: null });
      } else if (storedFingerprint) {
        throw incompatibleMemoryCoreSchema(`${spec.table}.${row.id} has a legacy fingerprint without a validated receiptProof/proof.`);
      }
    }
    const updateFingerprint = db.prepare(`UPDATE ${spec.table} SET fingerprint = ? WHERE id = ?`);
    for (const migration of migrations) updateFingerprint.run(migration.fingerprint, migration.id);
    db.exec(`CREATE UNIQUE INDEX ${uniqueIndexName} ON ${spec.table}(fingerprint) WHERE fingerprint IS NOT NULL`);
  });
}

function ensureMemoryCoreSidecarSchema(db) {
  for (const spec of Object.values(MEMORY_CORE_RECORD_SPECS)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${spec.table} (
        id ${MEMORY_CORE_COLUMN_DEFINITIONS.id},
        projectId ${MEMORY_CORE_COLUMN_DEFINITIONS.projectId},
        scopeKey ${MEMORY_CORE_COLUMN_DEFINITIONS.scopeKey},
        status ${MEMORY_CORE_COLUMN_DEFINITIONS.status},
        type ${MEMORY_CORE_COLUMN_DEFINITIONS.type},
        updatedAt ${MEMORY_CORE_COLUMN_DEFINITIONS.updatedAt},
        validFrom ${MEMORY_CORE_COLUMN_DEFINITIONS.validFrom},
        validTo ${MEMORY_CORE_COLUMN_DEFINITIONS.validTo},
        createdAt ${MEMORY_CORE_COLUMN_DEFINITIONS.createdAt},
        fingerprint ${MEMORY_CORE_COLUMN_DEFINITIONS.fingerprint},
        payloadJson ${MEMORY_CORE_COLUMN_DEFINITIONS.payloadJson},
        contentHash ${MEMORY_CORE_COLUMN_DEFINITIONS.contentHash}
      )
    `);
    let tableInfo = db.prepare(`PRAGMA table_info(${spec.table})`).all();
    const idColumn = tableInfo.find((column) => column.name === "id");
    const primaryKeyColumns = tableInfo.filter((column) => Number(column.pk) > 0);
    if (!idColumn || Number(idColumn.pk) !== 1 || primaryKeyColumns.length !== 1 || !String(idColumn.type || "").toUpperCase().includes("TEXT")) {
      throw incompatibleMemoryCoreSchema(`${spec.table}.id must be the sole TEXT primary key; destructive rebuild was refused.`);
    }
    const columns = new Set(tableInfo.map((column) => column.name));
    for (const [name, definition] of Object.entries(MEMORY_CORE_COLUMN_DEFINITIONS)) {
      if (name !== "id" && !columns.has(name)) db.exec(`ALTER TABLE ${spec.table} ADD COLUMN ${name} ${definition}`);
    }
    tableInfo = db.prepare(`PRAGMA table_info(${spec.table})`).all();
    const migratedColumns = new Set(tableInfo.map((column) => column.name));
    const missingColumns = Object.keys(MEMORY_CORE_COLUMN_DEFINITIONS).filter((name) => !migratedColumns.has(name));
    if (missingColumns.length > 0) throw incompatibleMemoryCoreSchema(`${spec.table} is missing required columns: ${missingColumns.join(", ")}.`);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${spec.table}_project_status ON ${spec.table}(projectId, status, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_${spec.table}_scope_status ON ${spec.table}(scopeKey, status, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_${spec.table}_type_updated ON ${spec.table}(type, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_${spec.table}_validity ON ${spec.table}(validFrom, validTo);
    `);
    if (spec.immutable) db.exec(`CREATE INDEX IF NOT EXISTS idx_${spec.table}_fingerprint ON ${spec.table}(fingerprint)`);
    if (spec.uniqueFingerprint) ensureAuthorityReceiptProofMigration(db, spec);
  }
}

function openMemoryRuntimeIndex(storeRoot) {
  if (!DatabaseSync) throw new Error("node:sqlite is unavailable; Memory Runtime sidecar requires Node 24+.");
  fs.mkdirSync(storeRoot, { recursive: true });
  let db = null;
  try {
    db = new DatabaseSync(indexPath(storeRoot));
    db.exec(`
    PRAGMA busy_timeout = ${MEMORY_RUNTIME_BUSY_TIMEOUT_MS};
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS memory_search_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      projectPath TEXT,
      scope TEXT,
      threadId TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      tagsJson TEXT NOT NULL,
      sourceRefsJson TEXT NOT NULL,
      status TEXT NOT NULL,
      freshness TEXT NOT NULL,
      requiresHumanConfirmation INTEGER NOT NULL DEFAULT 0,
      tokenEstimate INTEGER NOT NULL,
      existingScore REAL NOT NULL DEFAULT 0,
      graphActivation REAL NOT NULL DEFAULT 0,
      contentHash TEXT NOT NULL,
      updatedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_search_project ON memory_search_items(projectPath);
    CREATE INDEX IF NOT EXISTS idx_memory_search_kind ON memory_search_items(kind);
    CREATE INDEX IF NOT EXISTS idx_memory_search_updated ON memory_search_items(updatedAt);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_search_fts USING fts5(
      id UNINDEXED,
      title,
      summary,
      searchTerms,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS memory_runtime_trigger_receipts (
      id TEXT PRIMARY KEY,
      hook TEXT NOT NULL,
      queryType TEXT,
      projectPath TEXT,
      threadId TEXT,
      returnedCount INTEGER NOT NULL DEFAULT 0,
      tokenEstimate INTEGER NOT NULL DEFAULT 0,
      durationMs INTEGER NOT NULL DEFAULT 0,
      partial INTEGER NOT NULL DEFAULT 0,
      warningsJson TEXT NOT NULL,
      sourceRefsJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trigger_receipts_created ON memory_runtime_trigger_receipts(createdAt);
    CREATE INDEX IF NOT EXISTS idx_trigger_receipts_project ON memory_runtime_trigger_receipts(projectPath);
    CREATE TABLE IF NOT EXISTS memory_facts (
      id TEXT PRIMARY KEY,
      projectPath TEXT,
      scope TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      valueJson TEXT NOT NULL,
      factType TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      validFrom TEXT NOT NULL,
      validTo TEXT,
      observedAt TEXT NOT NULL,
      sourceRefsJson TEXT NOT NULL,
      supersededBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_project ON memory_facts(projectPath);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_key ON memory_facts(scope, projectPath, subject, predicate);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_status ON memory_facts(status);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_validity ON memory_facts(validFrom, validTo);
    `);
    const searchItemColumns = db.prepare("PRAGMA table_info(memory_search_items)").all();
    if (!searchItemColumns.some((column) => column.name === "requiresHumanConfirmation")) {
      db.exec("ALTER TABLE memory_search_items ADD COLUMN requiresHumanConfirmation INTEGER NOT NULL DEFAULT 0");
    }
    if (!searchItemColumns.some((column) => column.name === "scope")) {
      db.exec("ALTER TABLE memory_search_items ADD COLUMN scope TEXT");
    }
    ensureMemoryCoreSidecarSchema(db);
    return db;
  } catch (error) {
    closeDatabase(db);
    throw error;
  }
}

function upsertMemorySearchItems(storeRoot, items = []) {
  const normalized = safeArray(items).map(normalizeSearchItem).filter(Boolean).slice(0, 800);
  if (normalized.length === 0) return { indexed: 0, unchanged: 0, repaired: 0, skipped: safeArray(items).length, path: indexPath(storeRoot) };
  return withMemoryRuntimeIndex(storeRoot, (db) => {
    const selectHash = db.prepare("SELECT contentHash FROM memory_search_items WHERE id = ?");
    const selectFts = db.prepare("SELECT 1 AS present FROM memory_search_fts WHERE id = ? LIMIT 1");
    const upsert = db.prepare(`
    INSERT INTO memory_search_items (
      id, kind, projectPath, scope, threadId, title, summary, tagsJson, sourceRefsJson,
      status, freshness, requiresHumanConfirmation, tokenEstimate, existingScore, graphActivation, contentHash, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind, projectPath=excluded.projectPath, scope=excluded.scope, threadId=excluded.threadId,
      title=excluded.title, summary=excluded.summary, tagsJson=excluded.tagsJson,
      sourceRefsJson=excluded.sourceRefsJson, status=excluded.status, freshness=excluded.freshness,
      requiresHumanConfirmation=excluded.requiresHumanConfirmation,
      tokenEstimate=excluded.tokenEstimate, existingScore=excluded.existingScore,
      graphActivation=excluded.graphActivation, contentHash=excluded.contentHash, updatedAt=excluded.updatedAt
    `);
    const deleteFts = db.prepare("DELETE FROM memory_search_fts WHERE id = ?");
    const insertFts = db.prepare("INSERT INTO memory_search_fts (id, title, summary, searchTerms) VALUES (?, ?, ?, ?)");
    let indexed = 0;
    let unchanged = 0;
    let repaired = 0;
    withImmediateTransaction(db, () => {
      for (const item of normalized) {
        const existing = selectHash.get(item.id);
        if (existing?.contentHash === item.contentHash) {
          if (selectFts.get(item.id)?.present) unchanged += 1;
          else {
            insertFts.run(item.id, item.title, item.summary, item.searchTerms);
            repaired += 1;
          }
          continue;
        }
        upsert.run(
          item.id, item.kind, item.projectPath, item.scope, item.threadId, item.title, item.summary,
          JSON.stringify(item.tags), JSON.stringify(item.sourceRefs), item.status, item.freshness,
          item.requiresHumanConfirmation ? 1 : 0, item.tokenEstimate, item.existingScore, item.graphActivation, item.contentHash, item.updatedAt,
        );
        deleteFts.run(item.id);
        insertFts.run(item.id, item.title, item.summary, item.searchTerms);
        indexed += 1;
      }
    });
    return { indexed, unchanged, repaired, skipped: safeArray(items).length - normalized.length, path: indexPath(storeRoot) };
  });
}

function reconcileMemorySearchItems(storeRoot, items = [], options = {}) {
  const sourceItems = safeArray(items);
  const sync = upsertMemorySearchItems(storeRoot, sourceItems);
  const projectPath = options.projectPath || null;
  if (!projectPath || !fs.existsSync(indexPath(storeRoot))) return { ...sync, removed: 0 };
  const normalized = sourceItems.map(normalizeSearchItem).filter(Boolean);
  const kinds = safeArray(options.kinds).length > 0
    ? safeArray(options.kinds)
    : normalized.map((item) => item.kind);
  const reconciledKinds = [...new Set(kinds)]
    .filter((kind) => kind && kind !== "memory_fact" && kind !== "runtime_event")
    .slice(0, 24);
  if (reconciledKinds.length === 0) return { ...sync, removed: 0 };
  const currentIds = new Set(
    normalized
      .filter((item) => item.projectPath === projectPath && reconciledKinds.includes(item.kind))
      .map((item) => item.id),
  );
  return withMemoryRuntimeIndex(storeRoot, (db) => {
    const params = { projectPath };
    reconciledKinds.forEach((kind, index) => { params[`kind${index}`] = kind; });
    const rows = db.prepare(`
    SELECT id FROM memory_search_items
    WHERE projectPath = :projectPath
      AND kind IN (${reconciledKinds.map((_, index) => `:kind${index}`).join(", ")})
    `).all(params);
    const staleIds = rows.map((row) => row.id).filter((id) => !currentIds.has(id));
    const deleteItem = db.prepare("DELETE FROM memory_search_items WHERE id = ?");
    const deleteFts = db.prepare("DELETE FROM memory_search_fts WHERE id = ?");
    withImmediateTransaction(db, () => {
      for (const id of staleIds) {
        deleteFts.run(id);
        deleteItem.run(id);
      }
    });
    return { ...sync, removed: staleIds.length };
  });
}

function buildFtsMatchQuery(query) {
  return tokenizeIndexText(query)
    .slice(0, 24)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function rowToSearchItem(row) {
  const scopeInvariant = normalizeMemorySearchScope(row, { inferMissingScope: false });
  return {
    id: row.id,
    kind: row.kind,
    projectPath: scopeInvariant.projectPath,
    scope: scopeInvariant.scope,
    threadId: row.threadId || null,
    title: row.title,
    summary: row.summary,
    excerpt: row.summary,
    tags: JSON.parse(row.tagsJson || "[]"),
    sourceRefs: JSON.parse(row.sourceRefsJson || "[]"),
    status: scopeInvariant.violation ? "review" : row.status,
    freshness: scopeInvariant.violation ? "review" : row.freshness,
    requiresHumanConfirmation: scopeInvariant.violation || row.requiresHumanConfirmation === 1,
    tokenEstimate: Number(row.tokenEstimate || 0),
    score: Number(row.existingScore || 0),
    graphActivation: Number(row.graphActivation || 0),
    updatedAt: row.updatedAt || null,
    ftsRank: Number(row.ftsRank || 0),
  };
}

function searchMemoryRuntimeIndex(storeRoot, query, options = {}) {
  const match = buildFtsMatchQuery(query);
  if (!match || !fs.existsSync(indexPath(storeRoot))) return { items: [], queryTerms: [], durationMs: 0, path: indexPath(storeRoot) };
  const startedAt = Date.now();
  return withMemoryRuntimeIndex(storeRoot, (db) => {
    const filters = [];
    const params = { match, limit: Math.max(1, Math.min(Number(options.limit || 80), 200)) };
    if (options.projectPath) {
      filters.push("(i.projectPath = :projectPath OR i.projectPath IS NULL OR i.projectPath = '')");
      filters.push("(i.kind <> 'memory_fact' OR (i.scope = 'project' AND i.projectPath = :projectPath))");
      params.projectPath = options.projectPath;
    } else if (options.scope) {
      filters.push("i.scope = :scope");
      params.scope = options.scope;
    }
    if (safeArray(options.includeKinds).length > 0) {
      const kinds = safeArray(options.includeKinds).slice(0, 24);
      filters.push(`i.kind IN (${kinds.map((_, index) => `:kind${index}`).join(", ")})`);
      kinds.forEach((kind, index) => { params[`kind${index}`] = kind; });
    }
    const rows = db.prepare(`
    SELECT i.*, bm25(memory_search_fts, 0.0, 8.0, 3.0, 1.0) AS ftsRank
    FROM memory_search_fts
    JOIN memory_search_items i ON i.id = memory_search_fts.id
    WHERE memory_search_fts MATCH :match
      ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
    ORDER BY ftsRank ASC, i.updatedAt DESC
    LIMIT :limit
    `).all(params);
    return {
      schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA,
      items: rows.map(rowToSearchItem).filter((item) => !containsUnsafePayload(item)),
      queryTerms: tokenizeIndexText(query).slice(0, 24),
      durationMs: Date.now() - startedAt,
      path: indexPath(storeRoot),
    };
  });
}

function writeMemoryRuntimeTriggerReceipt(storeRoot, entry = {}) {
  const unsafeInput = containsUnsafePayload(entry);
  const createdAt = unsafeInput ? new Date().toISOString() : entry.createdAt || new Date().toISOString();
  const core = {
    hook: unsafeInput ? "unsafe_trigger_receipt" : compactText(entry.hook || "retrieve_context", 80),
    queryType: unsafeInput ? null : compactText(entry.queryType || "", 80) || null,
    projectPath: unsafeInput ? null : entry.projectPath || null,
    threadId: unsafeInput ? null : entry.threadId || null,
    returnedCount: Math.max(0, Number(entry.returnedCount || 0)),
    tokenEstimate: Math.max(0, Number(entry.tokenEstimate || 0)),
    durationMs: Math.max(0, Number(entry.durationMs || 0)),
    partial: entry.partial === true,
    warnings: unsafeInput
      ? ["unsafe_trigger_receipt_input_omitted"]
      : safeArray(entry.warnings).map((item) => redactSensitiveText(item, 180)).filter(Boolean).slice(0, 20),
    sourceRefs: (unsafeInput ? [] : safeArray(entry.sourceRefs))
      .filter((ref) => !containsUnsafePayload({ sourceRefs: [ref] }))
      .slice(0, 12)
      .map((ref) => ({
        kind: compactText(ref?.kind || "source", 80),
        path: ref?.path ? redactSensitiveText(ref.path, 520) : null,
        title: ref?.title ? redactSensitiveText(ref.title, 180) : null,
        hash: ref?.hash ? compactText(ref.hash, 160) : null,
        updatedAt: ref?.updatedAt || null,
      })),
    createdAt,
  };
  const id = unsafeInput ? `trigger-rejected-${stableHash(core).slice(0, 20)}` : compactText(entry.id, 220) || `trigger-${stableHash(core).slice(0, 20)}`;
  withMemoryRuntimeIndex(storeRoot, (db) => {
    db.prepare(`
    INSERT INTO memory_runtime_trigger_receipts (
      id, hook, queryType, projectPath, threadId, returnedCount, tokenEstimate,
      durationMs, partial, warningsJson, sourceRefsJson, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      returnedCount=excluded.returnedCount, tokenEstimate=excluded.tokenEstimate,
      durationMs=excluded.durationMs, partial=excluded.partial,
      warningsJson=excluded.warningsJson, sourceRefsJson=excluded.sourceRefsJson,
      createdAt=excluded.createdAt
    `).run(
      id, core.hook, core.queryType, core.projectPath, core.threadId, core.returnedCount,
      core.tokenEstimate, core.durationMs, core.partial ? 1 : 0, JSON.stringify(core.warnings),
      JSON.stringify(core.sourceRefs), core.createdAt,
    );
  });
  return { schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA, id, ...core, rejected: unsafeInput };
}

function listMemoryRuntimeTriggerReceipts(storeRoot, options = {}) {
  if (!fs.existsSync(indexPath(storeRoot))) return [];
  return withMemoryRuntimeIndex(storeRoot, (db) => {
    const filters = [];
    const params = { limit: Math.max(1, Math.min(Number(options.limit || 80), 300)) };
    if (options.hook) {
      filters.push("hook = :hook");
      params.hook = options.hook;
    }
    if (options.projectPath) {
      filters.push("projectPath = :projectPath");
      params.projectPath = options.projectPath;
    }
    const rows = db.prepare(`
    SELECT * FROM memory_runtime_trigger_receipts
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY createdAt DESC
    LIMIT :limit
    `).all(params);
    return rows.map((row) => ({
      schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA,
      id: row.id,
      hook: row.hook,
      queryType: row.queryType,
      projectPath: row.projectPath,
      threadId: row.threadId,
      returnedCount: Number(row.returnedCount || 0),
      tokenEstimate: Number(row.tokenEstimate || 0),
      durationMs: Number(row.durationMs || 0),
      partial: row.partial === 1,
      warnings: JSON.parse(row.warningsJson || "[]"),
      sourceRefs: JSON.parse(row.sourceRefsJson || "[]"),
      createdAt: row.createdAt,
    }));
  });
}

function rowToMemoryFact(row) {
  return normalizeMemoryFact({
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
  }, { preserveId: true });
}

function listMemoryFacts(storeRoot, options = {}) {
  if (!fs.existsSync(indexPath(storeRoot))) return [];
  return withMemoryRuntimeIndex(storeRoot, (db) => {
    const filters = [];
    const params = { limit: Math.max(1, Math.min(Number(options.limit || 300), 1200)) };
    if (options.projectPath) {
      filters.push("projectPath = :projectPath");
      filters.push("scope = 'project'");
      params.projectPath = options.projectPath;
    } else if (options.scope) {
      filters.push("scope = :scope");
      params.scope = options.scope;
    }
    if (options.subject) {
      filters.push("subject = :subject");
      params.subject = options.subject;
    }
    if (options.predicate) {
      filters.push("predicate = :predicate");
      params.predicate = options.predicate;
    }
    const rows = db.prepare(`
    SELECT * FROM memory_facts
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY updatedAt DESC
    LIMIT :limit
    `).all(params);
    return queryMemoryFacts(rows.map(rowToMemoryFact), options).slice(0, params.limit);
  });
}

function writeMemoryFactRows(db, facts) {
  const statement = db.prepare(`
    INSERT INTO memory_facts (
      id, projectPath, scope, subject, predicate, valueJson, factType, status,
      confidence, validFrom, validTo, observedAt, sourceRefsJson, supersededBy,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      projectPath=excluded.projectPath, scope=excluded.scope, subject=excluded.subject,
      predicate=excluded.predicate, valueJson=excluded.valueJson, factType=excluded.factType,
      status=excluded.status, confidence=excluded.confidence, validFrom=excluded.validFrom,
      validTo=excluded.validTo, observedAt=excluded.observedAt,
      sourceRefsJson=excluded.sourceRefsJson, supersededBy=excluded.supersededBy,
      createdAt=excluded.createdAt, updatedAt=excluded.updatedAt
  `);
  for (const fact of facts) {
    statement.run(
      fact.id, fact.projectPath, fact.scope, fact.subject, fact.predicate,
      JSON.stringify(fact.value), fact.factType, fact.status, fact.confidence,
      fact.validFrom, fact.validTo, fact.observedAt, JSON.stringify(fact.sourceRefs),
      fact.supersededBy, fact.createdAt, fact.updatedAt,
    );
  }
}

function memoryFactToSearchItem(fact) {
  const valueText = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
  return {
    id: fact.id,
    kind: "memory_fact",
    projectPath: fact.projectPath,
    scope: fact.scope,
    title: `${fact.subject} / ${fact.predicate}`,
    summary: compactText(valueText, 1400),
    tags: [fact.factType, fact.status, fact.predicate],
    sourceRefs: fact.sourceRefs,
    status: fact.status,
    freshness: fact.status === "superseded" ? "stale" : fact.status === "review" || fact.status === "candidate" ? "review" : "fresh",
    requiresHumanConfirmation: ["review", "candidate"].includes(fact.status),
    tokenEstimate: Math.max(24, Math.ceil((fact.subject.length + fact.predicate.length + valueText.length) / 4)),
    updatedAt: fact.updatedAt,
  };
}

function upsertMemoryFact(storeRoot, input = {}, options = {}) {
  const incoming = normalizeMemoryFact(input, { now: options.now, preserveId: false });
  const existing = listMemoryFacts(storeRoot, {
    projectPath: incoming.projectPath,
    subject: incoming.subject,
    predicate: incoming.predicate,
    limit: 200,
  });
  const plan = buildMemoryFactUpsertPlan(existing, input, options);
  if (plan.incoming.status === "rejected") {
    return {
      schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA,
      action: "reject",
      fact: plan.incoming,
      updatedFacts: [],
      conflicts: plan.conflicts,
      supersessions: plan.supersessions,
      blockers: plan.evaluation?.blockers || [],
      warnings: plan.evaluation?.warnings || [],
    };
  }
  const writes = [...plan.updates, ...plan.upserts]
    .filter((fact, index, array) => array.findIndex((candidate) => candidate.id === fact.id) === index);
  withMemoryRuntimeIndex(storeRoot, (db) => {
    withImmediateTransaction(db, () => writeMemoryFactRows(db, writes));
  });
  upsertMemorySearchItems(storeRoot, writes.map(memoryFactToSearchItem));
  return {
    schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA,
    action: plan.action,
    fact: plan.incoming,
    updatedFacts: writes,
    conflicts: plan.conflicts,
    supersessions: plan.supersessions,
    blockers: plan.evaluation?.blockers || [],
    warnings: plan.evaluation?.warnings || [],
  };
}

function writeMemoryFactsFromEvidence(storeRoot, packet = {}, receipt = {}) {
  const decision = compactText(packet.decision || receipt.decision, 40).toLowerCase();
  if (containsUnsafePayload({ packet, receipt })) {
    return {
      schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA,
      attempted: 0,
      written: 0,
      rejected: 1,
      review: 0,
      actions: [],
      warnings: ["unsafe_writeback_packet_did_not_create_memory_facts"],
    };
  }
  if (receipt.status === "rejected" || !["accept", "revise", "block", "supersede"].includes(decision)) {
    return {
      schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA,
      attempted: 0,
      written: 0,
      rejected: 0,
      review: 0,
      actions: [],
      warnings: [receipt.status === "rejected" ? "rejected_writeback_did_not_create_memory_facts" : "invalid_decision_did_not_create_memory_facts"],
    };
  }
  const evidence = packet.evidence && typeof packet.evidence === "object" ? packet.evidence : {};
  const task = packet.task && typeof packet.task === "object" ? packet.task : {};
  const sourceRefs = safeArray(evidence.sourceRefs).slice(0, 20);
  const observedAt = receipt.createdAt || new Date().toISOString();
  const projectPath = task.projectPath || packet.projectPath || null;
  const subject = compactText(task.goal || task.id || packet.taskId || "accepted task", 240);
  const candidates = safeArray(evidence.memoryFacts).map((fact) => ({
    ...fact,
    projectPath: fact?.projectPath || projectPath,
    sourceRefs: safeArray(fact?.sourceRefs).length > 0 ? fact.sourceRefs : sourceRefs,
    observedAt: fact?.observedAt || observedAt,
    status: fact?.status || (decision === "accept" ? "accepted" : "candidate"),
  }));
  if (evidence.summary) {
    candidates.push({
      projectPath,
      subject,
      predicate: decision === "accept" ? "accepted_outcome" : "review_outcome",
      value: compactText(evidence.summary, 1000),
      factType: "decision",
      status: decision === "accept" ? "accepted" : "candidate",
      confidence: decision === "accept" ? 0.9 : 0.55,
      observedAt,
      validFrom: observedAt,
      sourceRefs,
    });
  }
  for (const pattern of safeArray(evidence.reusablePattern)) {
    candidates.push({
      projectPath,
      subject,
      predicate: "reusable_pattern",
      value: compactText(pattern, 500),
      factType: "procedure",
      status: decision === "accept" ? "accepted" : "candidate",
      confidence: decision === "accept" ? 0.85 : 0.5,
      observedAt,
      validFrom: observedAt,
      sourceRefs,
    });
  }
  if (["revise", "block"].includes(decision)) {
    for (const pattern of safeArray(evidence.failurePattern)) {
      candidates.push({
        projectPath,
        subject,
        predicate: "failure_pattern",
        value: compactText(pattern, 500),
        factType: "pitfall",
        status: "candidate",
        confidence: 0.65,
        observedAt,
        validFrom: observedAt,
        sourceRefs,
      });
    }
  }
  const results = candidates.slice(0, 30).map((candidate) => upsertMemoryFact(storeRoot, candidate, { now: observedAt }));
  return {
    schemaVersion: MEMORY_RUNTIME_INDEX_SCHEMA,
    attempted: candidates.length,
    written: results.filter((result) => !["reject", "noop"].includes(result.action)).length,
    rejected: results.filter((result) => result.fact.status === "rejected").length,
    review: results.filter((result) => ["review", "candidate"].includes(result.fact.status)).length,
    actions: results.map((result) => ({ id: result.fact.id, action: result.action, status: result.fact.status })),
  };
}

function rowToMemoryCoreRecord(recordKind, row) {
  if (!row) return null;
  const spec = memoryCoreRecordSpec(recordKind);
  const payload = JSON.parse(row.payloadJson || "{}");
  return {
    ...payload,
    schemaVersion: MEMORY_CORE_SIDECAR_SCHEMA,
    recordKind,
    id: row.id,
    [spec.idField]: row.id,
    projectId: row.projectId || null,
    scopeKey: row.scopeKey || null,
    status: row.status,
    type: row.type,
    updatedAt: row.updatedAt,
    validFrom: row.validFrom || null,
    validTo: row.validTo || null,
    createdAt: row.createdAt,
    fingerprint: row.fingerprint || null,
    contentHash: row.contentHash,
    payload,
    persistedOnly: true,
    trustState: "persisted_unverified",
    trusted: false,
    trustedIdentity: false,
    authoritative: false,
  };
}

function memoryCoreWriteResult(recordKind, action, row, extra = {}) {
  return {
    schemaVersion: MEMORY_CORE_SIDECAR_SCHEMA,
    action,
    record: rowToMemoryCoreRecord(recordKind, row),
    ...extra,
  };
}

function writeMemoryCoreRow(db, table, record) {
  db.prepare(`
    INSERT INTO ${table} (
      id, projectId, scopeKey, status, type, updatedAt, validFrom, validTo,
      createdAt, fingerprint, payloadJson, contentHash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      projectId=excluded.projectId, scopeKey=excluded.scopeKey, status=excluded.status,
      type=excluded.type, updatedAt=excluded.updatedAt, validFrom=excluded.validFrom,
      validTo=excluded.validTo, createdAt=excluded.createdAt, fingerprint=excluded.fingerprint,
      payloadJson=excluded.payloadJson, contentHash=excluded.contentHash
  `).run(
    record.id, record.projectId, record.scopeKey, record.status, record.type,
    record.updatedAt, record.validFrom, record.validTo, record.createdAt,
    record.fingerprint, record.payloadJson, record.contentHash,
  );
}

function insertImmutableMemoryCoreRow(db, table, record) {
  db.prepare(`
    INSERT INTO ${table} (
      id, projectId, scopeKey, status, type, updatedAt, validFrom, validTo,
      createdAt, fingerprint, payloadJson, contentHash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.projectId, record.scopeKey, record.status, record.type,
    record.updatedAt, record.validFrom, record.validTo, record.createdAt,
    record.fingerprint, record.payloadJson, record.contentHash,
  );
}

function rejectMemoryCoreWrite(recordKind, normalized) {
  return {
    schemaVersion: MEMORY_CORE_SIDECAR_SCHEMA,
    action: "reject",
    recordKind,
    record: null,
    reasonCodes: normalized.reasonCodes || ["invalid_memory_core_record"],
    forbiddenKeys: normalized.forbiddenKeys || [],
  };
}

function appendMemoryCoreRecord(storeRoot, recordKind, input = {}, options = {}) {
  const spec = memoryCoreRecordSpec(recordKind);
  if (!spec.immutable) throw new Error(`${recordKind} is mutable and must use upsertMemoryCoreRecord.`);
  const normalized = normalizeMemoryCoreRecord(recordKind, input, options);
  if (!normalized.ok) return rejectMemoryCoreWrite(recordKind, normalized);
  return withMemoryRuntimeIndex(storeRoot, (db) => withImmediateTransaction(db, () => {
    const existing = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(normalized.record.id);
    if (existing) {
      if (existing.contentHash === normalized.record.contentHash && (existing.fingerprint || null) === normalized.record.fingerprint) {
        return memoryCoreWriteResult(recordKind, "noop", existing);
      }
      const error = new Error(`Immutable Memory Core collision for ${recordKind}:${normalized.record.id}`);
      error.code = "MEMORY_CORE_IMMUTABLE_COLLISION";
      throw error;
    }
    if (spec.uniqueFingerprint) {
      const replay = db.prepare(`SELECT * FROM ${spec.table} WHERE fingerprint = ? LIMIT 1`).get(normalized.record.fingerprint);
      if (replay) {
        const error = new Error(`Immutable Memory Core receipt replay for ${recordKind}:${normalized.record.id}`);
        error.code = "MEMORY_CORE_REPLAY_COLLISION";
        throw error;
      }
    }
    try {
      insertImmutableMemoryCoreRow(db, spec.table, normalized.record);
    } catch (cause) {
      if (spec.uniqueFingerprint && /unique|constraint/i.test(String(cause?.message || cause))) {
        const error = new Error(`Immutable Memory Core receipt replay for ${recordKind}:${normalized.record.id}`);
        error.code = "MEMORY_CORE_REPLAY_COLLISION";
        error.cause = cause;
        throw error;
      }
      throw cause;
    }
    return memoryCoreWriteResult(recordKind, "insert", normalized.record, { reasonCodes: normalized.reasonCodes });
  }));
}

function upsertMemoryCoreRecord(storeRoot, recordKind, input = {}, options = {}) {
  const spec = memoryCoreRecordSpec(recordKind);
  if (spec.immutable) return appendMemoryCoreRecord(storeRoot, recordKind, input, options);
  const normalized = normalizeMemoryCoreRecord(recordKind, input, options);
  if (!normalized.ok) return rejectMemoryCoreWrite(recordKind, normalized);
  return withMemoryRuntimeIndex(storeRoot, (db) => withImmediateTransaction(db, () => {
    const existing = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(normalized.record.id);
    if (!existing) {
      writeMemoryCoreRow(db, spec.table, normalized.record);
      return memoryCoreWriteResult(recordKind, "insert", normalized.record, { reasonCodes: normalized.reasonCodes });
    }
    const ownershipChanged = existing.projectId !== normalized.record.projectId
      || existing.scopeKey !== normalized.record.scopeKey
      || existing.type !== normalized.record.type;
    if (ownershipChanged) {
      return memoryCoreWriteResult(recordKind, "conflict", existing, {
        reasonCodes: ["immutable_scope_ownership_collision"],
        incomingStatus: "review",
        requestedOwnership: {
          projectId: normalized.record.projectId,
          scopeKey: normalized.record.scopeKey,
          type: normalized.record.type,
        },
      });
    }
    if (existing.contentHash === normalized.record.contentHash) return memoryCoreWriteResult(recordKind, "noop", existing);
    const existingTime = Date.parse(existing.updatedAt || MEMORY_CORE_EPOCH) || 0;
    const incomingTime = Date.parse(normalized.record.updatedAt || MEMORY_CORE_EPOCH) || 0;
    if (incomingTime < existingTime) return memoryCoreWriteResult(recordKind, "stale", existing, { incomingContentHash: normalized.record.contentHash });
    if (incomingTime === existingTime) {
      return memoryCoreWriteResult(recordKind, "conflict", existing, {
        incomingContentHash: normalized.record.contentHash,
        reasonCodes: ["same_updated_at_content_collision"],
      });
    }
    writeMemoryCoreRow(db, spec.table, normalized.record);
    return memoryCoreWriteResult(recordKind, "update", normalized.record, { previousContentHash: existing.contentHash, reasonCodes: normalized.reasonCodes });
  }));
}

function getMemoryCoreRecord(storeRoot, recordKind, id, options = {}) {
  if (!fs.existsSync(indexPath(storeRoot))) return null;
  const spec = memoryCoreRecordSpec(recordKind);
  const recordId = compactText(id, 220);
  if (!recordId) return null;
  return withMemoryRuntimeIndex(storeRoot, (db) => {
    const params = { id: recordId };
    const filters = ["id = :id"];
    if (options.projectId) {
      filters.push("projectId = :projectId");
      params.projectId = compactText(options.projectId, 240);
    }
    const row = db.prepare(`SELECT * FROM ${spec.table} WHERE ${filters.join(" AND ")} LIMIT 1`).get(params);
    return rowToMemoryCoreRecord(recordKind, row);
  });
}

function listMemoryCoreRecords(storeRoot, recordKind, options = {}) {
  if (!fs.existsSync(indexPath(storeRoot))) return [];
  const spec = memoryCoreRecordSpec(recordKind);
  return withMemoryRuntimeIndex(storeRoot, (db) => {
    const filters = [];
    const params = { limit: Math.max(1, Math.min(Number(options.limit || 300), 10_000)) };
    if (options.projectId) {
      filters.push("projectId = :projectId");
      params.projectId = compactText(options.projectId, 240);
    }
    if (options.scopeKey) {
      filters.push("scopeKey = :scopeKey");
      params.scopeKey = compactText(options.scopeKey, 280);
    }
    const explicitStatuses = options.status
      ? [compactText(options.status, 40).toLowerCase()].filter(Boolean)
      : safeArray(options.statuses).map((status) => compactText(status, 40).toLowerCase()).filter(Boolean).slice(0, 20);
    const view = compactText(options.view || "normal", 40).toLowerCase();
    let selectedStatuses = explicitStatuses;
    let applyDefaultValidity = false;
    if (selectedStatuses.length === 0) {
      if (["normal", "current"].includes(view)) {
        selectedStatuses = [...NORMAL_MEMORY_CORE_STATUSES];
        applyDefaultValidity = true;
      } else if (view === "review") selectedStatuses = [...REVIEW_MEMORY_CORE_STATUSES];
      else if (["history", "historical"].includes(view)) selectedStatuses = [...HISTORICAL_MEMORY_CORE_STATUSES];
      else if (!["all", "diagnostic", "diagnostics"].includes(view)) throw new Error(`Unsupported Memory Core list view: ${view}`);
    }
    if (selectedStatuses.length > 0) {
      filters.push(`status IN (${selectedStatuses.map((_, index) => `:status${index}`).join(", ")})`);
      selectedStatuses.forEach((status, index) => { params[`status${index}`] = status; });
    }
    if (options.type) {
      filters.push("type = :type");
      params.type = compactText(options.type, 80);
    }
    if (options.asOf || applyDefaultValidity) {
      const asOf = isoTimestamp(options.asOf) || new Date().toISOString();
      if (asOf) {
        filters.push("(validFrom IS NULL OR validFrom <= :asOf)");
        filters.push("(validTo IS NULL OR validTo > :asOf)");
        params.asOf = asOf;
      }
    }
    const rows = db.prepare(`
      SELECT * FROM ${spec.table}
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY updatedAt DESC, id ASC
      LIMIT :limit
    `).all(params);
    return rows.map((row) => rowToMemoryCoreRecord(recordKind, row));
  });
}

function upsertMemoryPrincipal(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "principal", input, options); }
function getMemoryPrincipal(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "principal", id, options); }
function listMemoryPrincipals(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "principal", options); }
function upsertProjectBinding(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "projectBinding", input, options); }
function getProjectBinding(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "projectBinding", id, options); }
function listProjectBindings(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "projectBinding", options); }
function upsertStandingRule(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "standingRule", input, options); }
function getStandingRule(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "standingRule", id, options); }
function listStandingRules(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "standingRule", options); }
function appendAuthorityReceipt(storeRoot, input, options) { return appendMemoryCoreRecord(storeRoot, "authorityReceipt", input, options); }
function getAuthorityReceipt(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "authorityReceipt", id, options); }
function listAuthorityReceipts(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "authorityReceipt", options); }
function upsertProjectBrain(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "projectBrain", input, options); }
function getProjectBrain(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "projectBrain", id, options); }
function listProjectBrains(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "projectBrain", options); }
function upsertProjectAnchor(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "projectAnchor", input, options); }
function getProjectAnchor(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "projectAnchor", id, options); }
function listProjectAnchors(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "projectAnchor", options); }
function upsertModuleMemory(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "moduleMemory", input, options); }
function getModuleMemory(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "moduleMemory", id, options); }
function listModuleMemories(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "moduleMemory", options); }
function upsertMemoryEpisode(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "episode", input, options); }
function getMemoryEpisode(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "episode", id, options); }
function listMemoryEpisodes(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "episode", options); }
function upsertMemoryEvent(storeRoot, input, options) { return upsertMemoryEpisode(storeRoot, input, options); }
function getMemoryEvent(storeRoot, id, options) { return getMemoryEpisode(storeRoot, id, options); }
function listMemoryEvents(storeRoot, options) { return listMemoryEpisodes(storeRoot, options); }
function upsertMemoryDecision(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "decision", input, options); }
function getMemoryDecision(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "decision", id, options); }
function listMemoryDecisions(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "decision", options); }
function upsertMemoryConstraint(storeRoot, input, options) { return upsertMemoryCoreRecord(storeRoot, "constraint", input, options); }
function getMemoryConstraint(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "constraint", id, options); }
function listMemoryConstraints(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "constraint", options); }
function appendProjectCheckpoint(storeRoot, input, options) { return appendMemoryCoreRecord(storeRoot, "projectCheckpoint", input, options); }
function getProjectCheckpoint(storeRoot, id, options) { return getMemoryCoreRecord(storeRoot, "projectCheckpoint", id, options); }
function listProjectCheckpoints(storeRoot, options) { return listMemoryCoreRecords(storeRoot, "projectCheckpoint", options); }

module.exports = {
  MEMORY_CORE_MAX_PAYLOAD_BYTES,
  MEMORY_CORE_RECORD_SPECS,
  MEMORY_CORE_SIDECAR_SCHEMA,
  MEMORY_RUNTIME_BUSY_TIMEOUT_MS,
  MEMORY_RUNTIME_INDEX_SCHEMA,
  appendAuthorityReceipt,
  appendMemoryAuthorityReceipt: appendAuthorityReceipt,
  appendMemoryCoreRecord,
  appendProjectCheckpoint,
  buildFtsMatchQuery,
  containsUnsafePayload,
  ensureMemoryCoreSidecarSchema,
  getAuthorityReceipt,
  getMemoryConstraint,
  getMemoryCoreRecord,
  getMemoryDecision,
  getMemoryEpisode,
  getMemoryEvent,
  getMemoryPrincipal,
  getModuleMemory,
  getProjectAnchor,
  getProjectBinding,
  getProjectBrain,
  getProjectCheckpoint,
  getStandingRule,
  indexPath,
  inspectMemoryCorePayload,
  listAuthorityReceipts,
  listMemoryConstraints,
  listMemoryCoreRecords,
  listMemoryDecisions,
  listMemoryEpisodes,
  listMemoryEvents,
  listMemoryFacts,
  listMemoryPrincipals,
  listMemoryRuntimeTriggerReceipts,
  listModuleMemories,
  listProjectAnchors,
  listProjectBindings,
  listProjectBrains,
  listProjectCheckpoints,
  listStandingRules,
  memoryFactToSearchItem,
  normalizeMemoryCoreRecord,
  normalizeSearchItem,
  openMemoryRuntimeIndex,
  reconcileMemorySearchItems,
  searchMemoryRuntimeIndex,
  tokenizeIndexText,
  upsertMemoryConstraint,
  upsertMemoryCoreRecord,
  upsertMemoryDecision,
  upsertMemoryEpisode,
  upsertMemoryEvent,
  upsertMemorySearchItems,
  upsertMemoryFact,
  upsertMemoryPrincipal,
  upsertModuleMemory,
  upsertProjectAnchor,
  upsertProjectBinding,
  upsertProjectBrain,
  upsertProjectCheckpoint: appendProjectCheckpoint,
  upsertStandingRule,
  upsertAuthorityReceipt: appendAuthorityReceipt,
  writeAuthorityReceipt: appendAuthorityReceipt,
  writeMemoryFactsFromEvidence,
  writeMemoryRuntimeTriggerReceipt,
};
