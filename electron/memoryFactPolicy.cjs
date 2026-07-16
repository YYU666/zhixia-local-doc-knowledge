const crypto = require("node:crypto");

const MEMORY_FACT_SCHEMA = "zhixia.memory_fact.v1";
const CURRENT_STATUSES = new Set(["active", "accepted"]);
const FACT_STATUSES = new Set(["active", "accepted", "candidate", "review", "superseded", "rejected"]);
const RAW_SESSION_RE = /\b(raw[_ -]?session|session[_ -]?jsonl|codex[_ -]?session|thread[_ -]?transcript)\b|(?:^|[\\/])\.codex[\\/](?:archived_)?sessions[\\/]|\.jsonl\b/i;
const SECRET_RE = /\b(api[_ -]?key|auth[_ -]?token|bearer[_ -]?token|credential|password|secret|private[_ -]?key|oauth[_ -]?token|cookie)\b|(?:^|[\\/])\.env(?:$|[.\\/_-])/i;
const SECRET_VALUE_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b/i;
const BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{48,}|(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{180,}={0,2}(?:$|[^A-Za-z0-9+/])/i;
const DESTRUCTIVE_ACTION_RE = /\b(delete|destroy|drop|truncate|erase|wipe|purge|remove[_ -]?all|reset[_ -]?hard|force[_ -]?push|archive[_ -]?thread|publish|execute|run[_ -]?command)\b|删除|销毁|清空|强制推送|执行命令/i;
const RAW_VALUE_KEYS = /^(?:raw|rawBody|body|content|contentText|transcript|session|messages|payload|blob|binary)$/i;
const GIANT_BODY_CHARS = 16_000;
const PERSISTENCE_SCAN_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 1024,
  maxObjectEntries: 256,
  maxArrayEntries: 256,
  maxSignalChars: 32_000,
  maxScalarFragments: 1024,
  maxScalarFragmentChars: 128,
});
const STRONG_SPLIT_SECRET_RE = /(?:\b(?:ghp|gho)_[A-Za-z0-9_]{12,}|\bgithub_pat_[A-Za-z0-9_]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\bAKIA[0-9A-Z]{16}\b|\bBearer[A-Za-z0-9._~+/=-]{12,})/i;

function safeArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function compactText(value, maxChars = 320) {
  const text = String(value == null ? "" : value)
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function redactText(value, maxChars = 512) {
  return compactText(value, maxChars)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [secret-omitted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, "[secret-omitted]")
    .replace(/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}\b/gi, "[secret-omitted]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[secret-omitted]")
    .replace(/\b(api[_-]?key|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[secret-omitted]")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]{24,}/gi, "[base64-omitted]")
    .replace(/[A-Za-z0-9+/]{180,}={0,2}/g, "[base64-omitted]");
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function maxIso(...values) {
  const valid = values.map(isoOrNull).filter(Boolean).sort();
  return valid.length > 0 ? valid[valid.length - 1] : null;
}

function minIso(...values) {
  const valid = values.map(isoOrNull).filter(Boolean).sort();
  return valid.length > 0 ? valid[0] : null;
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(number, 1));
}

function canonicalize(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactText(value, 512);
  if (depth >= 4) return "[nested-value-omitted]";
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => canonicalize(item, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort().slice(0, 32)) {
      if (RAW_VALUE_KEYS.test(key)) continue;
      result[compactText(key, 80)] = canonicalize(value[key], depth + 1);
    }
    return result;
  }
  return redactText(value, 512);
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeStatus(value, hasSource) {
  const status = compactText(value, 40).toLowerCase();
  if (status === "current") return "active";
  if (FACT_STATUSES.has(status)) return status;
  return hasSource ? "candidate" : "review";
}

function normalizeScopeProjectInvariant(input = {}) {
  const requestedScope = compactText(input.scope || "", 80).toLowerCase();
  const inputProjectPath = compactText(input.projectPath || "", 360) || null;
  let scope = requestedScope || (inputProjectPath ? "project" : "global");
  let projectPath = inputProjectPath;
  let violation = null;
  if (!["project", "global"].includes(scope)) {
    violation = "invalid_scope";
    scope = inputProjectPath ? "project" : "global";
  }
  if (scope === "project" && !projectPath) violation = violation || "project_scope_requires_project_path";
  if (scope === "global" && projectPath) {
    violation = violation || "global_scope_forbids_project_path";
    projectPath = null;
  }
  return { scope, projectPath, violation };
}

function inferFactType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "object";
  return typeof value;
}

function sourceRefSignature(ref) {
  return [ref.kind, ref.id, ref.path, ref.uri, ref.hash, ref.title].map((item) => item || "").join("|");
}

function normalizeSourceRef(ref) {
  const source = typeof ref === "string" ? { path: ref } : ref;
  if (!source || typeof source !== "object") return null;
  const rawPath = compactText(source.path || source.filePath || "", 360);
  const rawUri = compactText(source.uri || source.url || "", 360);
  const path = RAW_SESSION_RE.test(rawPath)
    ? "[raw-session-ref-omitted]"
    : SECRET_RE.test(rawPath)
      ? "[secret-ref-omitted]"
      : rawPath || null;
  const uri = SECRET_RE.test(rawUri) ? "[secret-ref-omitted]" : rawUri || null;
  const normalized = {
    kind: compactText(source.kind || source.sourceType || "source", 60) || "source",
    id: compactText(source.id || source.sourceId || "", 160) || null,
    path,
    uri,
    title: redactText(source.title || "", 180) || null,
    hash: compactText(source.hash || source.sha256 || source.sourceHash || "", 160) || null,
    observedAt: isoOrNull(source.observedAt),
    updatedAt: isoOrNull(source.updatedAt || source.modifiedAt),
    sourceType: compactText(source.sourceType || "", 80) || null,
  };
  if (![normalized.id, normalized.path, normalized.uri, normalized.title, normalized.hash].some(Boolean)) return null;
  return normalized;
}

function normalizeSourceRefs(input) {
  const seen = new Set();
  const result = [];
  for (const ref of safeArray(input)) {
    const normalized = normalizeSourceRef(ref);
    if (!normalized) continue;
    const signature = sourceRefSignature(normalized);
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(normalized);
  }
  return result.sort((a, b) => sourceRefSignature(a).localeCompare(sourceRefSignature(b))).slice(0, 16);
}

function scanPersistenceStructure(input, options = {}) {
  const limits = { ...PERSISTENCE_SCAN_LIMITS, ...options.limits };
  const metadataKeyRe = options.metadataKeyRe instanceof RegExp
    ? options.metadataKeyRe
    : /id|path|uri|url|hash|kind|type|scope|status|domain|tag|action|operation|command|automation|project|thread/i;
  const state = {
    parts: [],
    keyParts: [],
    valueParts: [],
    metadataValueParts: [],
    keyFragments: [],
    valueFragments: [],
    signalChars: 0,
    nodesVisited: 0,
    maxDepthVisited: 0,
    structureTruncated: false,
    giantBody: false,
  };
  const seen = new WeakSet();

  function appendPart(value, destination, fragmentDestination = null) {
    const text = String(value == null ? "" : value);
    if (!text) return;
    const remaining = limits.maxSignalChars - state.signalChars;
    if (remaining <= 0) {
      state.structureTruncated = true;
      return;
    }
    const stored = text.slice(0, remaining);
    state.parts.push(stored);
    destination.push(stored);
    state.signalChars += stored.length;
    if (stored.length < text.length) state.structureTruncated = true;
    if (fragmentDestination && text.length <= limits.maxScalarFragmentChars) {
      if (state.keyFragments.length + state.valueFragments.length < limits.maxScalarFragments) fragmentDestination.push(text);
      else state.structureTruncated = true;
    }
  }

  function visit(value, key = "", depth = 0) {
    if (state.structureTruncated || value == null) return;
    state.nodesVisited += 1;
    state.maxDepthVisited = Math.max(state.maxDepthVisited, depth);
    if (state.nodesVisited > limits.maxNodes || depth > limits.maxDepth) {
      state.structureTruncated = true;
      return;
    }
    if (key) appendPart(key, state.keyParts, state.keyFragments);
    if (["string", "number", "boolean", "bigint"].includes(typeof value)) {
      const text = String(value);
      appendPart(text, state.valueParts, state.valueFragments);
      if (key && metadataKeyRe.test(key)) appendPart(text, state.metadataValueParts);
      if (typeof value === "string" && text.length > GIANT_BODY_CHARS) state.giantBody = true;
      return;
    }
    if (["function", "symbol"].includes(typeof value)) {
      state.structureTruncated = true;
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) {
      state.structureTruncated = true;
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const count = Math.min(value.length, limits.maxArrayEntries);
      for (let index = 0; index < count; index += 1) visit(value[index], key, depth + 1);
      if (value.length > limits.maxArrayEntries) state.structureTruncated = true;
      return;
    }
    let entryCount = 0;
    for (const childKey in value) {
      if (!Object.prototype.hasOwnProperty.call(value, childKey)) continue;
      entryCount += 1;
      if (entryCount > limits.maxObjectEntries) {
        state.structureTruncated = true;
        break;
      }
      let childValue;
      try {
        childValue = value[childKey];
      } catch {
        state.structureTruncated = true;
        break;
      }
      visit(childValue, childKey, depth + 1);
      if (state.structureTruncated) break;
    }
  }

  visit(input);
  let strongSplitSecret = false;
  for (const fragments of [state.keyFragments, state.valueFragments]) {
    for (let index = 0; index < fragments.length && !strongSplitSecret; index += 1) {
      let joined = "";
      for (let width = 0; width < 3 && index + width < fragments.length; width += 1) {
        joined += fragments[index + width].replace(/\s+/g, "");
        if (STRONG_SPLIT_SECRET_RE.test(joined)) {
          strongSplitSecret = true;
          break;
        }
      }
    }
    if (strongSplitSecret) break;
  }
  return {
    signal: state.parts.join(" "),
    keySignal: state.keyParts.join(" "),
    valueSignal: state.valueParts.join(" "),
    metadataValueSignal: state.metadataValueParts.join(" "),
    strongSplitSecret,
    structureTruncated: state.structureTruncated,
    giantBody: state.giantBody,
    stats: {
      nodesVisited: Math.min(state.nodesVisited, limits.maxNodes + 1),
      maxDepthVisited: state.maxDepthVisited,
      signalChars: state.signalChars,
      scalarFragments: state.keyFragments.length + state.valueFragments.length,
      limits,
    },
  };
}

function inspectPersistenceSignals(input = {}) {
  const scan = scanPersistenceStructure(input);
  const signal = scan.signal;
  return {
    signal,
    rawSession: RAW_SESSION_RE.test(signal),
    secret: SECRET_RE.test(signal) || SECRET_VALUE_RE.test(signal) || scan.strongSplitSecret,
    base64: BASE64_RE.test(signal),
    giantBody: scan.giantBody,
    structureTruncated: scan.structureTruncated,
    scanStats: scan.stats,
  };
}

function inspectMemoryFact(input = {}) {
  const persistence = inspectPersistenceSignals(input);
  const scopeInvariant = normalizeScopeProjectInvariant(input);
  const signal = persistence.signal;
  const sourceRefs = normalizeSourceRefs(input.sourceRefs || input.sourceRef);
  const blockers = [];
  const warnings = [];
  const flags = {
    rawSession: persistence.rawSession,
    secret: persistence.secret,
    base64: persistence.base64,
    giantBody: persistence.giantBody,
    structureTruncated: persistence.structureTruncated,
    scopeInvariantViolation: scopeInvariant.violation,
    destructiveAction: DESTRUCTIVE_ACTION_RE.test(signal),
  };
  if (flags.rawSession) blockers.push("raw_session_blocked");
  if (flags.secret) blockers.push("secret_blocked");
  if (flags.base64) blockers.push("base64_blocked");
  if (flags.giantBody) blockers.push("giant_body_blocked");
  if (flags.structureTruncated) blockers.push("structure_truncated_blocked");
  if (flags.scopeInvariantViolation) blockers.push(flags.scopeInvariantViolation);
  if (flags.destructiveAction) blockers.push("destructive_action_requires_review");
  if (sourceRefs.length === 0) blockers.push("missing_source_ref");
  if (input.validFrom && !isoOrNull(input.validFrom)) blockers.push("invalid_valid_from");
  if (input.validTo && !isoOrNull(input.validTo)) blockers.push("invalid_valid_to");
  if (input.observedAt && !isoOrNull(input.observedAt)) blockers.push("invalid_observed_at");
  const validFrom = isoOrNull(input.validFrom);
  const validTo = isoOrNull(input.validTo);
  if (validFrom && validTo && validTo < validFrom) blockers.push("invalid_temporal_interval");
  if (!input.subject) warnings.push("missing_subject");
  if (!input.predicate) warnings.push("missing_predicate");
  return { blockers: [...new Set(blockers)], warnings, flags, sourceRefs, scanStats: persistence.scanStats };
}

function stableMemoryFactId(input = {}) {
  const inspection = inspectMemoryFact(input);
  const scopeInvariant = normalizeScopeProjectInvariant(input);
  const unsafe = inspection.flags.rawSession || inspection.flags.secret || inspection.flags.base64 || inspection.flags.giantBody || inspection.flags.structureTruncated;
  const value = input.value !== undefined ? input.value : input.object;
  const identity = {
    schema: MEMORY_FACT_SCHEMA,
    scope: unsafe ? "rejected" : scopeInvariant.scope,
    projectPath: unsafe ? "" : String(scopeInvariant.projectPath || "").toLowerCase(),
    subject: unsafe ? "unsafe-input" : compactText(input.subject || "unknown", 240).toLowerCase(),
    predicate: unsafe ? "rejected" : compactText(input.predicate || "unknown", 160).toLowerCase(),
    factType: unsafe ? "rejected" : compactText(input.factType || inferFactType(value), 80).toLowerCase(),
    value: unsafe ? "[unsafe-content-omitted]" : canonicalize(value),
  };
  return `memory-fact-${hashValue(stableStringify(identity)).slice(0, 20)}`;
}

function normalizeMemoryFact(input = {}, options = {}) {
  const inspection = inspectMemoryFact(input);
  const scopeInvariant = normalizeScopeProjectInvariant(input);
  const unsafe = inspection.flags.rawSession || inspection.flags.secret || inspection.flags.base64 || inspection.flags.giantBody || inspection.flags.structureTruncated;
  const fallbackNow = isoOrNull(options.now)
    || isoOrNull(input.updatedAt)
    || isoOrNull(input.observedAt)
    || isoOrNull(input.validFrom)
    || isoOrNull(input.createdAt)
    || new Date().toISOString();
  const createdAt = isoOrNull(input.createdAt) || fallbackNow;
  const observedAt = isoOrNull(input.observedAt) || isoOrNull(input.validFrom) || createdAt;
  const validFrom = isoOrNull(input.validFrom) || observedAt;
  let validTo = isoOrNull(input.validTo);
  const rawValue = input.value !== undefined ? input.value : input.object;
  let value = canonicalize(rawValue);
  if (inspection.flags.rawSession) value = "[raw-session-content-omitted]";
  else if (inspection.flags.secret) value = "[secret-content-omitted]";
  else if (inspection.flags.base64) value = "[base64-content-omitted]";
  else if (inspection.flags.giantBody) value = "[giant-body-content-omitted]";
  else if (inspection.flags.structureTruncated) value = "[truncated-structure-content-omitted]";
  const hasSource = inspection.sourceRefs.length > 0;
  let status = normalizeStatus(input.accepted === true ? "accepted" : input.status, hasSource);
  if (unsafe) status = "rejected";
  else if (inspection.flags.destructiveAction || inspection.blockers.includes("invalid_temporal_interval")) status = "review";
  else if (inspection.flags.scopeInvariantViolation) status = "review";
  else if (!hasSource && CURRENT_STATUSES.has(status)) status = "review";
  if (validTo && validTo < validFrom) validTo = validFrom;
  const normalizedForId = {
    ...input,
    value,
    object: value,
    factType: input.factType || inferFactType(rawValue),
  };
  return {
    id: !unsafe && options.preserveId !== false && input.id ? compactText(input.id, 180) : stableMemoryFactId(normalizedForId),
    projectPath: unsafe ? null : scopeInvariant.projectPath,
    scope: unsafe ? "rejected" : scopeInvariant.scope,
    subject: unsafe ? "[unsafe-subject-omitted]" : compactText(input.subject || "unknown", 240) || "unknown",
    predicate: unsafe ? "[unsafe-predicate-omitted]" : compactText(input.predicate || "unknown", 160) || "unknown",
    object: value,
    value,
    factType: unsafe ? "rejected" : compactText(input.factType || inferFactType(rawValue), 80).toLowerCase(),
    status,
    confidence: clampConfidence(input.confidence),
    validFrom,
    validTo,
    observedAt,
    sourceRefs: unsafe ? [] : inspection.sourceRefs,
    supersededBy: unsafe ? null : compactText(input.supersededBy || "", 180) || null,
    createdAt: unsafe ? fallbackNow : createdAt,
    updatedAt: unsafe ? fallbackNow : isoOrNull(input.updatedAt) || maxIso(createdAt, observedAt, fallbackNow),
  };
}

function evaluateMemoryFact(input = {}, options = {}) {
  const inspection = inspectMemoryFact(input);
  const fact = normalizeMemoryFact(input, options);
  return {
    fact,
    status: fact.status,
    eligibleForCurrent: CURRENT_STATUSES.has(fact.status) && fact.sourceRefs.length > 0,
    blockers: inspection.blockers,
    warnings: inspection.warnings,
    flags: inspection.flags,
    scanStats: inspection.scanStats,
  };
}

function sameFactKey(left, right) {
  return left.scope === right.scope
    && (left.projectPath || null) === (right.projectPath || null)
    && left.subject.toLowerCase() === right.subject.toLowerCase()
    && left.predicate.toLowerCase() === right.predicate.toLowerCase();
}

function sameFactValue(left, right) {
  return left.factType === right.factType && stableStringify(left.value) === stableStringify(right.value);
}

function isAcceptedFact(fact) {
  return CURRENT_STATUSES.has(fact.status) && fact.sourceRefs.length > 0;
}

function isOpenCurrentFact(fact) {
  return isAcceptedFact(fact) && !fact.validTo && !fact.supersededBy;
}

function compareFactPriority(left, right) {
  const acceptedDelta = Number(isAcceptedFact(left)) - Number(isAcceptedFact(right));
  if (acceptedDelta) return acceptedDelta;
  const observedDelta = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (observedDelta) return observedDelta;
  const validFromDelta = Date.parse(left.validFrom) - Date.parse(right.validFrom);
  if (validFromDelta) return validFromDelta;
  const confidenceDelta = left.confidence - right.confidence;
  if (confidenceDelta) return confidenceDelta;
  return right.id.localeCompare(left.id);
}

function mergeSourceRefs(...groups) {
  return normalizeSourceRefs(groups.flat());
}

function mergeSameFact(existing, incoming) {
  const winner = compareFactPriority(existing, incoming) >= 0 ? existing : incoming;
  const merged = {
    ...winner,
    id: existing.id,
    sourceRefs: mergeSourceRefs(existing.sourceRefs, incoming.sourceRefs),
    confidence: Math.max(existing.confidence, incoming.confidence),
    observedAt: maxIso(existing.observedAt, incoming.observedAt),
    validFrom: minIso(existing.validFrom, incoming.validFrom),
    createdAt: minIso(existing.createdAt, incoming.createdAt),
    updatedAt: maxIso(existing.updatedAt, incoming.updatedAt),
  };
  if (isAcceptedFact(winner)) {
    merged.status = winner.status;
    merged.validTo = winner.validTo;
    merged.supersededBy = winner.supersededBy;
  }
  return merged;
}

function supersedeFact(loser, winner) {
  const boundary = maxIso(loser.validFrom, winner.validFrom);
  return {
    ...loser,
    status: "superseded",
    validTo: loser.validTo ? minIso(loser.validTo, boundary) : boundary,
    supersededBy: winner.id,
    updatedAt: maxIso(loser.updatedAt, winner.updatedAt),
  };
}

function sortFacts(facts) {
  return [...facts].sort((a, b) => {
    const keyA = [a.scope, a.projectPath || "", a.subject.toLowerCase(), a.predicate.toLowerCase(), a.validFrom, a.id].join("|");
    const keyB = [b.scope, b.projectPath || "", b.subject.toLowerCase(), b.predicate.toLowerCase(), b.validFrom, b.id].join("|");
    return keyA.localeCompare(keyB);
  });
}

function buildMemoryFactUpsertPlan(existingFacts, input, options = {}) {
  const existing = safeArray(existingFacts).map((fact) => normalizeMemoryFact(fact, { ...options, preserveId: true }));
  const evaluation = evaluateMemoryFact(input, { ...options, preserveId: false });
  let incoming = evaluation.fact;
  const scoped = existing.filter((fact) => sameFactKey(fact, incoming));
  const sameValueFacts = scoped.filter((fact) => sameFactValue(fact, incoming));
  const sameValue = sameValueFacts
    .filter((fact) => isOpenCurrentFact(fact) || !isAcceptedFact(incoming))
    .sort((a, b) => compareFactPriority(b, a))[0];

  if (sameValue) {
    const merged = mergeSameFact(sameValue, incoming);
    const facts = sortFacts(existing.map((fact) => fact.id === sameValue.id ? merged : fact));
    return {
      action: stableStringify(merged) === stableStringify(sameValue) ? "noop" : "merge",
      incoming: merged,
      facts,
      upserts: [merged],
      updates: [],
      conflicts: [],
      supersessions: [],
      evaluation,
    };
  }

  if (isAcceptedFact(incoming) && sameValueFacts.some((fact) => !isOpenCurrentFact(fact))) {
    const recurrenceHash = hashValue(stableStringify({
      baseId: incoming.id,
      observedAt: incoming.observedAt,
      validFrom: incoming.validFrom,
      sourceRefs: incoming.sourceRefs.map(sourceRefSignature),
    })).slice(0, 10);
    incoming = { ...incoming, id: `${incoming.id}-${recurrenceHash}` };
  }

  const currentConflicts = scoped.filter((fact) => isAcceptedFact(fact) && !fact.validTo && !sameFactValue(fact, incoming));
  const conflicts = currentConflicts.map((fact) => ({ existingId: fact.id, incomingId: incoming.id }));
  const updates = [];
  const supersessions = [];
  let action = incoming.status === "rejected" ? "reject" : currentConflicts.length > 0 ? "conflict" : "insert";

  if (isAcceptedFact(incoming) && currentConflicts.length > 0) {
    const winner = [incoming, ...currentConflicts].sort((a, b) => compareFactPriority(b, a))[0];
    if (winner.id === incoming.id) {
      action = "supersede_existing";
      for (const conflict of currentConflicts) {
        const updated = supersedeFact(conflict, incoming);
        updates.push(updated);
        supersessions.push({ from: conflict.id, to: incoming.id });
      }
    } else {
      action = "retain_existing";
      incoming = supersedeFact(incoming, winner);
      supersessions.push({ from: incoming.id, to: winner.id });
    }
  }

  const updatedById = new Map(updates.map((fact) => [fact.id, fact]));
  const facts = sortFacts([
    ...existing.map((fact) => updatedById.get(fact.id) || fact),
    incoming,
  ]);
  return {
    action,
    incoming,
    facts,
    upserts: [incoming],
    updates,
    conflicts,
    supersessions,
    evaluation: { ...evaluation, fact: incoming, status: incoming.status, eligibleForCurrent: isAcceptedFact(incoming) },
  };
}

function isCurrentAt(fact, asOf) {
  if (!["active", "accepted", "superseded"].includes(fact.status)) return false;
  if (fact.sourceRefs.length === 0) return false;
  if (fact.validFrom > asOf) return false;
  return !fact.validTo || fact.validTo > asOf;
}

function matchesTemporalRange(fact, from, to) {
  if (from && fact.validTo && fact.validTo <= from) return false;
  if (to && fact.validFrom >= to) return false;
  return true;
}

function queryMemoryFacts(facts, query = {}) {
  const asOf = isoOrNull(query.asOf || query.at || query.now) || new Date().toISOString();
  const from = isoOrNull(query.from || query.validFrom);
  const to = isoOrNull(query.to || query.validTo);
  const view = compactText(query.view || query.status || "", 40).toLowerCase();
  return safeArray(facts)
    .map((fact) => normalizeMemoryFact(fact, { now: asOf, preserveId: true }))
    .filter((fact) => !query.scope || fact.scope === String(query.scope).toLowerCase())
    .filter((fact) => !query.projectPath || fact.scope === "project" && fact.projectPath === query.projectPath)
    .filter((fact) => !query.subject || fact.subject.toLowerCase() === String(query.subject).toLowerCase())
    .filter((fact) => !query.predicate || fact.predicate.toLowerCase() === String(query.predicate).toLowerCase())
    .filter((fact) => !query.factType || fact.factType === String(query.factType).toLowerCase())
    .filter((fact) => matchesTemporalRange(fact, from, to))
    .filter((fact) => {
      if (!view) return true;
      if (view === "current") return isCurrentAt(fact, asOf);
      if (view === "historical") return Boolean(fact.validTo && fact.validTo <= asOf);
      if (["candidate", "review", "superseded", "rejected", "active", "accepted"].includes(view)) return fact.status === view;
      return false;
    })
    .sort((a, b) => {
      const validFromDelta = Date.parse(b.validFrom) - Date.parse(a.validFrom);
      if (validFromDelta) return validFromDelta;
      const observedDelta = Date.parse(b.observedAt) - Date.parse(a.observedAt);
      if (observedDelta) return observedDelta;
      const confidenceDelta = b.confidence - a.confidence;
      if (confidenceDelta) return confidenceDelta;
      return a.id.localeCompare(b.id);
    });
}

module.exports = {
  MEMORY_FACT_SCHEMA,
  buildMemoryFactUpsertPlan,
  buildUpsertPlan: buildMemoryFactUpsertPlan,
  evaluate: evaluateMemoryFact,
  evaluateMemoryFact,
  normalize: normalizeMemoryFact,
  normalizeMemoryFact,
  PERSISTENCE_SCAN_LIMITS,
  query: queryMemoryFacts,
  queryMemoryFacts,
  scanPersistenceStructure,
  stableMemoryFactId,
};
