const crypto = require("node:crypto");
const path = require("node:path");
const { scanPersistenceStructure } = require("./memoryFactPolicy.cjs");

const SEMANTIC_MEMORY_GRAPH_SCHEMA = "zhixia.semantic_memory_graph.v1";
const SEMANTIC_ENTITY_KINDS = new Set([
  "claim", "concept", "decision", "document", "evidence", "item", "project",
  "rule", "source", "task", "tool", "topic",
]);
const SEMANTIC_GRAPH_STATUSES = new Set(["active", "superseded", "disputed", "stale", "review"]);
const SEMANTIC_GRAPH_PROVENANCE = new Set(["explicit", "extracted", "inferred", "human_confirmed"]);
const ACTIVE_EVIDENCE_PREDICATES = new Set(["supports", "contradicts"]);
const REVIEW_QUERY_TYPES = new Set([
  "archive_candidate", "history_audit", "review_gate", "retrieve_precedent", "thread_recovery", "workflow_reuse",
]);
const RAW_SESSION_RE = /\b(raw[_ -]?session|codex[_ -]?session|session[_ -]?jsonl|thread[_ -]?transcript)\b|(?:^|[\\/])\.codex[\\/](?:archived_)?sessions[\\/]|\.jsonl\b/i;
const SECRET_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b|\b(?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|password|passwd|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{4,}/i;
const SECRET_PATH_RE = /(?:^|[\\/])\.env(?:$|[.\\/_-])|(?:^|[\\/])(?:id_rsa|id_ed25519|credentials)(?:$|[.\\/_-])/i;
const BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{48,}|(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{180,}={0,2}(?:$|[^A-Za-z0-9+/])/i;
const MAX_COMPACT_INPUT_BYTES = 64 * 1024;
const MAX_COMPACT_MARKDOWN_CHARS = 12_000;
const MAX_RUNTIME_SEED_ITEMS = 24;
const RUNTIME_SEED_FORBIDDEN_FIELDS = new Set([
  "body", "content", "contenttext", "fulltext", "markdown", "rawbody", "rawsession",
  "sessionbody", "transcript", "log", "logs",
]);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value, maxChars = 320) {
  return String(value == null ? "" : value).replace(/\u0000/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Semantic graph values must be compact JSON data.");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function isoTimestamp(value, fallback = null) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function clampConfidence(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 1)) : fallback;
}

function normalizeProjectPath(value) {
  const input = compactText(value, 520);
  if (!input || RAW_SESSION_RE.test(input) || SECRET_PATH_RE.test(input)) return null;
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function projectIdentityForPath(projectPath) {
  const normalized = normalizeProjectPath(projectPath);
  return normalized ? `project-${stableHash(normalized).slice(0, 24)}` : null;
}

function canonicalSemanticGraphProjectScope(projectPath, envelope = null) {
  const requestedProjectPath = normalizeProjectPath(projectPath);
  const fallback = {
    projectPath: requestedProjectPath,
    projectId: projectIdentityForPath(requestedProjectPath),
    legacyProjectIds: [],
    acceptedProjectPaths: requestedProjectPath ? [requestedProjectPath] : [],
    canonicalized: false,
    envelopeProjectId: null,
    warnings: requestedProjectPath ? ["semantic_graph_project_identity_fallback"] : ["semantic_graph_exact_project_identity_required"],
  };
  if (!requestedProjectPath || !envelope || typeof envelope !== "object") return fallback;
  const canonicalRoot = normalizeProjectPath(envelope.canonicalRoot);
  const worktreeRoot = normalizeProjectPath(envelope.worktreeRoot);
  const envelopeProjectId = compactText(envelope.projectId, 180) || null;
  const canonicalRepoId = compactText(envelope.canonicalRepoId, 180) || null;
  const acceptedProjectPaths = [...new Set([canonicalRoot, worktreeRoot].filter(Boolean))];
  if (!canonicalRoot || !envelopeProjectId || !canonicalRepoId || !acceptedProjectPaths.includes(requestedProjectPath)) {
    return { ...fallback, warnings: ["semantic_graph_project_identity_envelope_mismatch_fallback"] };
  }
  return {
    projectPath: canonicalRoot,
    projectId: envelopeProjectId,
    legacyProjectIds: [projectIdentityForPath(canonicalRoot)].filter((value) => value && value !== envelopeProjectId),
    acceptedProjectPaths,
    canonicalized: requestedProjectPath !== canonicalRoot,
    envelopeProjectId,
    warnings: [],
  };
}

function inspectPlainJsonStructure(root) {
  const seen = new WeakSet();
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current.value || typeof current.value !== "object") continue;
    if (seen.has(current.value) || current.depth > 12 || ++nodes > 1024) return false;
    seen.add(current.value);
    let prototype;
    try {
      prototype = Object.getPrototypeOf(current.value);
    } catch {
      return false;
    }
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
    let keys;
    try {
      keys = Reflect.ownKeys(current.value);
    } catch {
      return false;
    }
    if (keys.length > 256 || keys.some((key) => typeof key !== "string")) return false;
    for (const key of keys) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      } catch {
        return false;
      }
      if (!descriptor || typeof descriptor.get === "function" || typeof descriptor.set === "function") return false;
      if (descriptor.value && typeof descriptor.value === "object") stack.push({ value: descriptor.value, depth: current.depth + 1 });
      else if (!["undefined", "string", "number", "boolean"].includes(typeof descriptor.value) && descriptor.value !== null) return false;
    }
  }
  return true;
}

function inspectSemanticGraphInput(input) {
  const plainJsonStructure = inspectPlainJsonStructure(input);
  let scan;
  let payloadBytes = Infinity;
  try {
    if (!plainJsonStructure) throw new Error("unsafe_object_structure");
    scan = scanPersistenceStructure(input);
    payloadBytes = Buffer.byteLength(stableStringify(input), "utf8");
  } catch {
    scan = { signal: "", strongSplitSecret: false, giantBody: false, structureTruncated: true, stats: {} };
  }
  const signal = scan.signal || "";
  const reasonCodes = [
    ...(RAW_SESSION_RE.test(signal) ? ["unsafe_raw_session"] : []),
    ...(SECRET_RE.test(signal) || SECRET_PATH_RE.test(signal) || scan.strongSplitSecret ? ["unsafe_secret"] : []),
    ...(BASE64_RE.test(signal) ? ["unsafe_base64"] : []),
    ...(scan.giantBody ? ["unsafe_giant_body"] : []),
    ...(!plainJsonStructure || scan.structureTruncated ? ["unsafe_object_structure"] : []),
    ...(payloadBytes > MAX_COMPACT_INPUT_BYTES ? ["unsafe_oversized_input"] : []),
  ];
  return { safe: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)], payloadBytes, scanStats: scan.stats || {} };
}

function sourcePathIsContained(sourcePath, projectPath) {
  const value = compactText(sourcePath, 520);
  if (!value) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return !/^(?:file|data):/i.test(value);
  if (RAW_SESSION_RE.test(value) || SECRET_PATH_RE.test(value) || BASE64_RE.test(value)) return false;
  const root = normalizeProjectPath(projectPath);
  if (!root) return false;
  const resolved = normalizeProjectPath(path.isAbsolute(value) ? value : path.resolve(root, value));
  return Boolean(resolved && (resolved === root || resolved.startsWith(`${root}${path.sep}`)));
}

function normalizeSourceRefs(input, options = {}) {
  const projectPath = normalizeProjectPath(options.projectPath);
  const refs = [];
  const seen = new Set();
  for (const raw of safeArray(input).slice(0, 20)) {
    const ref = typeof raw === "string" ? { path: raw } : raw;
    if (!ref || typeof ref !== "object") continue;
    const inspection = inspectSemanticGraphInput(ref);
    if (!inspection.safe) continue;
    const sourcePath = compactText(ref.path || ref.filePath, 520) || null;
    const uri = compactText(ref.uri || ref.url, 520) || null;
    if (sourcePath && !sourcePathIsContained(sourcePath, projectPath)) continue;
    if (uri && (/^(?:file|data):/i.test(uri) || RAW_SESSION_RE.test(uri) || SECRET_RE.test(uri) || BASE64_RE.test(uri))) continue;
    const normalized = {
      kind: compactText(ref.kind || ref.sourceType || "source", 80) || "source",
      id: compactText(ref.id || ref.sourceId, 180) || null,
      path: sourcePath,
      uri,
      title: compactText(ref.title, 180) || null,
      hash: compactText(ref.hash || ref.sha256 || ref.sourceHash, 160) || null,
      updatedAt: isoTimestamp(ref.updatedAt || ref.modifiedAt),
    };
    if (![normalized.id, normalized.path, normalized.uri, normalized.hash].some(Boolean)) continue;
    const signature = stableStringify(normalized);
    if (seen.has(signature)) continue;
    seen.add(signature);
    refs.push(normalized);
    if (refs.length >= 12) break;
  }
  return refs;
}

function normalizeAliases(input, canonicalName) {
  const canonical = canonicalName.toLocaleLowerCase();
  return [...new Set(safeArray(input)
    .map((alias) => compactText(alias, 180))
    .filter((alias) => alias && alias.toLocaleLowerCase() !== canonical))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 24);
}

function normalizeEntityKind(value) {
  const kind = compactText(value, 40).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return SEMANTIC_ENTITY_KINDS.has(kind) ? kind : null;
}

function normalizePredicate(value) {
  const predicate = compactText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return /^[a-z][a-z0-9_]{0,63}$/.test(predicate) ? predicate : null;
}

function stableSemanticEntityId(input = {}) {
  const scope = input.scope === "global" ? "global" : "project";
  const projectPath = scope === "project" ? normalizeProjectPath(input.projectPath) : null;
  const projectId = scope === "project" ? compactText(input.projectId, 180) || projectIdentityForPath(projectPath) : null;
  const kind = normalizeEntityKind(input.kind);
  const canonicalName = compactText(input.canonicalName || input.name || input.title, 240).toLocaleLowerCase();
  if (!kind || !canonicalName || (scope === "project" && (!projectPath || !projectId))) return null;
  return `sem-entity-${stableHash({ scope, projectPath, projectId, kind, canonicalName }).slice(0, 28)}`;
}

function stableSemanticRelationId(input = {}) {
  const scope = input.scope === "global" ? "global" : "project";
  const projectPath = scope === "project" ? normalizeProjectPath(input.projectPath) : null;
  const projectId = scope === "project" ? compactText(input.projectId, 180) || projectIdentityForPath(projectPath) : null;
  const predicate = normalizePredicate(input.predicate);
  const fromEntityId = compactText(input.fromEntityId || input.fromId, 220);
  const toEntityId = compactText(input.toEntityId || input.toId, 220);
  const factId = compactText(input.factId, 220) || null;
  if (!predicate || !fromEntityId || !toEntityId || (scope === "project" && (!projectPath || !projectId))) return null;
  return `sem-relation-${stableHash({ scope, projectPath, projectId, fromEntityId, toEntityId, predicate, factId }).slice(0, 28)}`;
}

function normalizeSemanticEntity(input = {}, options = {}) {
  const inspection = inspectSemanticGraphInput(input);
  if (!inspection.safe) return { ok: false, reasonCodes: inspection.reasonCodes, entity: null };
  const scope = compactText(input.scope || (input.projectPath || options.projectPath ? "project" : "global"), 20).toLowerCase();
  if (!["project", "global"].includes(scope)) return { ok: false, reasonCodes: ["invalid_scope"], entity: null };
  const projectPath = scope === "project" ? normalizeProjectPath(input.projectPath || options.projectPath) : null;
  const projectId = scope === "project"
    ? compactText(input.projectId || options.projectId, 180) || projectIdentityForPath(projectPath)
    : null;
  if (scope === "project" && (!projectPath || !projectId)) return { ok: false, reasonCodes: ["exact_project_identity_required"], entity: null };
  if (scope === "global" && (input.projectPath || input.projectId)) return { ok: false, reasonCodes: ["global_scope_forbids_project_identity"], entity: null };
  const kind = normalizeEntityKind(input.kind);
  if (!kind) return { ok: false, reasonCodes: ["invalid_entity_kind"], entity: null };
  const canonicalName = compactText(input.canonicalName || input.name || input.title, 240);
  if (!canonicalName) return { ok: false, reasonCodes: ["canonical_name_required"], entity: null };
  const provenance = compactText(input.provenance || options.provenance || "explicit", 40).toLowerCase();
  if (!SEMANTIC_GRAPH_PROVENANCE.has(provenance)) return { ok: false, reasonCodes: ["invalid_provenance"], entity: null };
  let status = compactText(input.status || "review", 40).toLowerCase();
  if (!SEMANTIC_GRAPH_STATUSES.has(status)) return { ok: false, reasonCodes: ["invalid_status"], entity: null };
  const sourceRefs = normalizeSourceRefs(input.sourceRefs, { projectPath });
  const warnings = [];
  if (scope === "global" && status !== "review") {
    status = "review";
    warnings.push("global_entity_forced_review");
  }
  if ((provenance === "inferred" || kind === "claim") && status === "active") {
    status = "review";
    warnings.push(provenance === "inferred" ? "inferred_entity_forced_review" : "claim_entity_forced_review");
  }
  if (status === "active" && sourceRefs.length === 0) {
    status = "review";
    warnings.push("active_entity_without_source_refs_forced_review");
  }
  const aliases = normalizeAliases(input.aliases, canonicalName);
  const now = isoTimestamp(input.updatedAt || input.createdAt || options.now, new Date(0).toISOString());
  const createdAt = isoTimestamp(input.createdAt, now);
  const deterministicId = stableSemanticEntityId({ scope, projectPath, projectId, kind, canonicalName });
  const requestedId = compactText(input.id, 220) || null;
  if (requestedId && requestedId !== deterministicId) return { ok: false, reasonCodes: ["non_deterministic_entity_id_refused"], entity: null };
  const core = {
    id: deterministicId,
    scope,
    projectPath,
    projectId,
    kind,
    canonicalName,
    aliases,
    status,
    sourceRefs,
    provenance,
    confidence: clampConfidence(input.confidence, provenance === "human_confirmed" ? 1 : 0.8),
    createdAt,
    updatedAt: now,
  };
  return { ok: true, reasonCodes: warnings, entity: { ...core, contentHash: stableHash(core) } };
}

function normalizeSemanticRelation(input = {}, options = {}) {
  const inspection = inspectSemanticGraphInput(input);
  if (!inspection.safe) return { ok: false, reasonCodes: inspection.reasonCodes, relation: null };
  const scope = compactText(input.scope || (input.projectPath || options.projectPath ? "project" : "global"), 20).toLowerCase();
  if (!["project", "global"].includes(scope)) return { ok: false, reasonCodes: ["invalid_scope"], relation: null };
  const projectPath = scope === "project" ? normalizeProjectPath(input.projectPath || options.projectPath) : null;
  const projectId = scope === "project"
    ? compactText(input.projectId || options.projectId, 180) || projectIdentityForPath(projectPath)
    : null;
  if (scope === "project" && (!projectPath || !projectId)) return { ok: false, reasonCodes: ["exact_project_identity_required"], relation: null };
  if (scope === "global" && (input.projectPath || input.projectId)) return { ok: false, reasonCodes: ["global_scope_forbids_project_identity"], relation: null };
  const fromEntityId = compactText(input.fromEntityId || input.fromId, 220);
  const toEntityId = compactText(input.toEntityId || input.toId, 220);
  const predicate = normalizePredicate(input.predicate);
  if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) return { ok: false, reasonCodes: ["distinct_relation_endpoints_required"], relation: null };
  if (!predicate) return { ok: false, reasonCodes: ["invalid_predicate"], relation: null };
  const provenance = compactText(input.provenance || options.provenance || "explicit", 40).toLowerCase();
  if (!SEMANTIC_GRAPH_PROVENANCE.has(provenance)) return { ok: false, reasonCodes: ["invalid_provenance"], relation: null };
  let status = compactText(input.status || "review", 40).toLowerCase();
  if (!SEMANTIC_GRAPH_STATUSES.has(status)) return { ok: false, reasonCodes: ["invalid_status"], relation: null };
  const sourceRefs = normalizeSourceRefs(input.sourceRefs, { projectPath });
  const factId = compactText(input.factId, 220) || null;
  const warnings = [];
  if (scope === "global" && status !== "review") {
    status = "review";
    warnings.push("global_relation_forced_review");
  }
  if (provenance === "inferred" && status === "active") {
    status = "review";
    warnings.push("inferred_relation_forced_review");
  }
  if (status === "active" && sourceRefs.length === 0) {
    status = "review";
    warnings.push("active_relation_without_source_refs_forced_review");
  }
  if (status === "active" && ACTIVE_EVIDENCE_PREDICATES.has(predicate) && options.acceptedSourceBackedEvidence !== true) {
    status = "review";
    warnings.push(`${predicate}_without_accepted_evidence_forced_review`);
  }
  const now = isoTimestamp(input.updatedAt || input.createdAt || options.now, new Date(0).toISOString());
  const createdAt = isoTimestamp(input.createdAt, now);
  const validFrom = isoTimestamp(input.validFrom, createdAt);
  const validTo = isoTimestamp(input.validTo);
  const deterministicId = stableSemanticRelationId({ scope, projectPath, projectId, fromEntityId, toEntityId, predicate, factId });
  const requestedId = compactText(input.id, 220) || null;
  if (requestedId && requestedId !== deterministicId) return { ok: false, reasonCodes: ["non_deterministic_relation_id_refused"], relation: null };
  const core = {
    id: deterministicId,
    scope,
    projectPath,
    projectId,
    fromEntityId,
    toEntityId,
    predicate,
    sourceRefs,
    provenance,
    confidence: clampConfidence(input.confidence, provenance === "human_confirmed" ? 1 : 0.8),
    status,
    validFrom,
    validTo,
    factId,
    createdAt,
    updatedAt: now,
  };
  return { ok: true, reasonCodes: warnings, relation: { ...core, contentHash: stableHash(core) } };
}

function tokenizeSemanticQuery(value) {
  const text = compactText(value, 1200).toLocaleLowerCase();
  const tokens = new Set(text.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []);
  for (const block of text.match(/[\u3400-\u9fff]{2,}/g) || []) {
    if (block.length <= 8) tokens.add(block);
    for (let index = 0; index < block.length - 1; index += 1) tokens.add(block.slice(index, index + 2));
  }
  return [...tokens].filter(Boolean).slice(0, 16);
}

function rankSemanticEntity(entity, queryTerms = []) {
  const canonical = entity.canonicalName.toLocaleLowerCase();
  const aliases = safeArray(entity.aliases).map((value) => value.toLocaleLowerCase());
  const matched = [];
  let score = 0;
  for (const term of safeArray(queryTerms)) {
    if (canonical === term) {
      score += 8;
      matched.push(`canonical:${term}`);
    } else if (canonical.includes(term) || term.includes(canonical)) {
      score += 4;
      matched.push(`canonical:${term}`);
    }
    if (aliases.some((alias) => alias === term)) {
      score += 6;
      matched.push(`alias:${term}`);
    } else if (aliases.some((alias) => alias.includes(term) || term.includes(alias))) {
      score += 3;
      matched.push(`alias:${term}`);
    }
  }
  if (entity.kind === "project") score += 0.5;
  if (entity.status === "active") score += 1;
  return { score, whyMatched: [...new Set(matched)].slice(0, 6) };
}

function mergeSourceRefs(...groups) {
  const refs = [];
  const seen = new Set();
  for (const ref of groups.flatMap((group) => safeArray(group))) {
    const signature = stableStringify(ref);
    if (seen.has(signature)) continue;
    seen.add(signature);
    refs.push(ref);
    if (refs.length >= 8) break;
  }
  return refs;
}

function compactEntity(entity) {
  return {
    id: entity.id,
    kind: entity.kind,
    canonicalName: entity.canonicalName,
    status: entity.status,
  };
}

function assembleBoundedOneHopPaths(input = {}, options = {}) {
  const startedAt = Date.now();
  const maxPaths = Math.max(1, Math.min(Number(options.maxPaths || 12), 12));
  const tokenBudget = Math.max(120, Math.min(Number(options.tokenBudget || 1200), 1200));
  const matchedEntities = safeArray(input.matchedEntities).slice(0, Math.max(1, Math.min(Number(options.maxCandidates || 96), 96)));
  const relations = safeArray(input.relations).slice(0, 192);
  const entityMap = input.entityMap instanceof Map ? input.entityMap : new Map(safeArray(input.entities).map((entity) => [entity.id, entity]));
  const seedScores = new Map(matchedEntities.map((entry) => [entry.entity.id, entry]));
  const candidates = [];
  for (const relation of relations) {
    const from = entityMap.get(relation.fromEntityId);
    const to = entityMap.get(relation.toEntityId);
    if (!from || !to) continue;
    const fromSeed = seedScores.get(from.id);
    const toSeed = seedScores.get(to.id);
    if (!fromSeed && !toSeed) continue;
    const seed = fromSeed?.score >= (toSeed?.score || 0) ? fromSeed : toSeed;
    const statusWeight = relation.status === "active" ? 4 : relation.status === "review" ? 0 : -2;
    const provenanceWeight = relation.provenance === "human_confirmed" ? 2 : relation.provenance === "inferred" ? -2 : 1;
    const score = Number(seed?.score || 0) + statusWeight + provenanceWeight + relation.confidence;
    candidates.push({
      id: relation.id,
      from: compactEntity(from),
      predicate: relation.predicate,
      to: compactEntity(to),
      whyMatched: [...new Set([...(seed?.whyMatched || []), `one_hop:${seed?.entity?.canonicalName || "entity"}`])].slice(0, 6),
      sourceRefs: mergeSourceRefs(relation.sourceRefs, from.sourceRefs, to.sourceRefs),
      status: relation.status,
      provenance: relation.provenance,
      confidence: relation.confidence,
      validFrom: relation.validFrom,
      validTo: relation.validTo,
      factId: relation.factId,
      score,
    });
  }
  candidates.sort((left, right) => right.score - left.score || right.confidence - left.confidence || left.id.localeCompare(right.id));
  const graphPaths = [];
  let tokenEstimate = 0;
  for (const candidate of candidates) {
    const compact = { ...candidate };
    delete compact.score;
    const pathTokens = Math.max(24, Math.ceil(JSON.stringify(compact).length / 4));
    if (graphPaths.length > 0 && tokenEstimate + pathTokens > tokenBudget) break;
    graphPaths.push(compact);
    tokenEstimate += pathTokens;
    if (graphPaths.length >= maxPaths) break;
  }
  return {
    schemaVersion: SEMANTIC_MEMORY_GRAPH_SCHEMA,
    graphPaths,
    hitCount: graphPaths.length,
    tokenEstimate: Math.min(tokenEstimate, tokenBudget),
    partial: candidates.length > graphPaths.length,
    performance: {
      oneHop: true,
      maxPaths,
      maxCandidates: Math.max(1, Math.min(Number(options.maxCandidates || 96), 96)),
      tokenBudget,
      candidatePathCount: candidates.length,
      assemblyDurationMs: Date.now() - startedAt,
      rawSessionBodyRead: false,
      fullTextBodyRead: false,
      vaultScan: false,
      backgroundTimer: false,
      backgroundRebuild: false,
    },
  };
}

function factTypeToEntityKind(factType, fallback = "concept") {
  const normalized = compactText(factType, 40).toLowerCase();
  if (["claim", "decision", "evidence", "project", "rule", "task", "tool", "topic"].includes(normalized)) return normalized;
  return fallback;
}

function semanticGraphFromMemoryFacts(facts = [], options = {}) {
  const entities = [];
  const relations = [];
  const warnings = [];
  const projectPath = normalizeProjectPath(options.projectPath || safeArray(facts)[0]?.projectPath);
  const projectId = compactText(options.projectId, 180) || projectIdentityForPath(projectPath);
  for (const fact of safeArray(facts).slice(0, 48)) {
    const inspection = inspectSemanticGraphInput(fact);
    if (!inspection.safe || fact.scope === "global" || normalizeProjectPath(fact.projectPath || projectPath) !== projectPath) {
      warnings.push(...inspection.reasonCodes, fact.scope === "global" ? "global_fact_graphification_skipped" : "", normalizeProjectPath(fact.projectPath || projectPath) !== projectPath ? "cross_project_fact_graphification_skipped" : "");
      continue;
    }
    const value = typeof fact.value === "string" || typeof fact.value === "number" || typeof fact.value === "boolean"
      ? compactText(fact.value, 500)
      : "";
    if (!value) {
      warnings.push("non_scalar_fact_value_graphification_skipped");
      continue;
    }
    const factStatus = ["active", "accepted"].includes(fact.status) ? "active" : fact.status === "superseded" ? "superseded" : "review";
    const sourceRefs = safeArray(fact.sourceRefs);
    const subjectKind = factTypeToEntityKind(fact.factType);
    const targetKind = fact.factType === "claim" ? "claim" : "concept";
    const provenance = fact.provenance === "inferred" ? "inferred" : ["active", "accepted"].includes(fact.status) ? "human_confirmed" : "extracted";
    const subjectResult = normalizeSemanticEntity({
      projectPath, projectId, kind: subjectKind, canonicalName: fact.subject, aliases: fact.aliases,
      status: factStatus, sourceRefs, provenance, confidence: fact.confidence,
      createdAt: fact.createdAt || fact.observedAt, updatedAt: fact.updatedAt || fact.observedAt,
    }, options);
    const targetResult = normalizeSemanticEntity({
      projectPath, projectId, kind: targetKind, canonicalName: value,
      status: fact.factType === "claim" ? "review" : factStatus, sourceRefs, provenance, confidence: fact.confidence,
      createdAt: fact.createdAt || fact.observedAt, updatedAt: fact.updatedAt || fact.observedAt,
    }, options);
    if (!subjectResult.ok || !targetResult.ok) {
      warnings.push(...subjectResult.reasonCodes, ...targetResult.reasonCodes);
      continue;
    }
    entities.push(subjectResult.entity, targetResult.entity);
    const relationResult = normalizeSemanticRelation({
      projectPath, projectId, fromEntityId: subjectResult.entity.id, toEntityId: targetResult.entity.id,
      predicate: fact.predicate, status: fact.factType === "claim" ? "review" : factStatus,
      sourceRefs, provenance, confidence: fact.confidence, factId: fact.id,
      validFrom: fact.validFrom || fact.observedAt, validTo: fact.validTo,
      createdAt: fact.createdAt || fact.observedAt, updatedAt: fact.updatedAt || fact.observedAt,
    }, { ...options, acceptedSourceBackedEvidence: ["active", "accepted"].includes(fact.status) && sourceRefs.length > 0 });
    if (relationResult.ok) relations.push(relationResult.relation);
    else warnings.push(...relationResult.reasonCodes);
  }
  return {
    schemaVersion: SEMANTIC_MEMORY_GRAPH_SCHEMA,
    entities: [...new Map(entities.map((entity) => [entity.id, entity])).values()],
    relations: [...new Map(relations.map((relation) => [relation.id, relation])).values()],
    warnings: [...new Set(warnings.filter(Boolean))].slice(0, 20),
  };
}

function runtimeSeedEntityKind(value) {
  const kind = compactText(value, 80).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (kind.includes("decision")) return "decision";
  if (kind.includes("document") || kind.includes("artifact") || kind.includes("canonical_doc")) return "document";
  if (kind.includes("evidence")) return "evidence";
  if (kind.includes("rule")) return "rule";
  if (kind.includes("task") || kind.includes("action") || kind.includes("blocker")) return "task";
  if (kind.includes("tool") || kind.includes("skill")) return "tool";
  if (kind.includes("topic") || kind.includes("tag")) return "topic";
  if (kind.includes("concept") || kind.includes("architecture")) return "concept";
  return "item";
}

function rebaseRuntimeSeedSourceRefs(sourceRefs, candidateProjectPath, acceptedProjectPaths) {
  const roots = [...new Set(safeArray(acceptedProjectPaths).map(normalizeProjectPath).filter(Boolean))];
  const preferredRoot = normalizeProjectPath(candidateProjectPath);
  return safeArray(sourceRefs).slice(0, 20).map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const sourcePath = compactText(raw.path || raw.filePath, 520);
    if (!sourcePath || !path.isAbsolute(sourcePath) || /^[a-z][a-z0-9+.-]*:\/\//i.test(sourcePath)) return raw;
    const normalizedSource = normalizeProjectPath(sourcePath);
    const containingRoot = [preferredRoot, ...roots].find((root) => root && normalizedSource
      && (normalizedSource === root || normalizedSource.startsWith(`${root}${path.sep}`)));
    if (!containingRoot) return raw;
    const relativePath = path.relative(containingRoot, normalizedSource).replace(/\\/g, "/");
    if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) return raw;
    return { ...raw, path: relativePath };
  });
}

function runtimeSeedSourceAliases(sourceRefs) {
  const aliases = [];
  for (const ref of safeArray(sourceRefs).slice(0, 12)) {
    const title = compactText(ref?.title, 180);
    if (title) aliases.push(title);
    for (const locator of [ref?.path, ref?.uri]) {
      const compactLocator = compactText(locator, 520);
      if (!compactLocator) continue;
      const withoutQuery = compactLocator.split(/[?#]/, 1)[0].replace(/\\/g, "/");
      const basename = compactText(withoutQuery.split("/").filter(Boolean).at(-1), 180);
      if (!basename) continue;
      aliases.push(basename);
      const stem = compactText(basename.replace(/\.[^.]+$/, ""), 180);
      if (stem && stem !== basename) aliases.push(stem);
    }
  }
  return aliases;
}

function buildSemanticGraphSeedFromRuntimeItems(items = [], options = {}) {
  const projectPath = normalizeProjectPath(options.projectPath);
  const projectId = compactText(options.projectId, 180) || projectIdentityForPath(projectPath);
  const authorityProjectId = compactText(options.authorityProjectId, 180) || null;
  const acceptedProjectPaths = [...new Set([
    projectPath,
    ...safeArray(options.acceptedProjectPaths).map(normalizeProjectPath),
  ].filter(Boolean))];
  const candidates = safeArray(items).slice(0, MAX_RUNTIME_SEED_ITEMS);
  const entities = [];
  const relations = [];
  const eligible = [];
  const reasonCounts = {};
  const reject = (reason) => { reasonCounts[reason] = (reasonCounts[reason] || 0) + 1; };
  const safety = {
    boundedInputOnly: true,
    candidateLimit: MAX_RUNTIME_SEED_ITEMS,
    workspaceScans: 0,
    documentEnumerations: 0,
    rawBodyReads: 0,
    fullTextBodyReads: 0,
    vaultScans: 0,
    generatedKnowledgeReads: 0,
    backgroundTimer: false,
    backgroundRebuild: false,
  };
  if (!projectPath || !projectId) {
    return {
      schemaVersion: SEMANTIC_MEMORY_GRAPH_SCHEMA,
      projectPath,
      projectId,
      entities,
      relations,
      warnings: ["exact_project_identity_required"],
      seed: { attempted: true, candidatesConsidered: candidates.length, eligibleCandidates: 0, rejectedCandidates: candidates.length, recordsPrepared: 0, reasonCounts: { exact_project_identity_required: candidates.length }, ...safety },
    };
  }
  for (const candidate of candidates) {
    const inspection = inspectSemanticGraphInput(candidate);
    if (!inspection.safe) {
      reject(inspection.reasonCodes[0] || "unsafe_runtime_seed_item");
      continue;
    }
    const ownKeys = Object.keys(candidate || {}).map((key) => key.toLowerCase());
    if (ownKeys.some((key) => RUNTIME_SEED_FORBIDDEN_FIELDS.has(key))) {
      reject("runtime_seed_body_field_refused");
      continue;
    }
    const statusSignals = [candidate.status, candidate.authorityStatus, candidate.acceptanceStatus, candidate.freshness]
      .map((value) => compactText(value, 40).toLowerCase())
      .filter(Boolean);
    const candidateScope = compactText(candidate.scope, 20).toLowerCase();
    if (candidateScope === "global" || statusSignals.some((value) => ["candidate", "review", "stale", "superseded", "disputed", "rejected", "blocked", "draft", "conflict"].includes(value))) {
      reject(candidateScope === "global" ? "global_runtime_seed_refused" : "non_current_runtime_seed_refused");
      continue;
    }
    const acceptedCurrent = statusSignals.some((value) => ["active", "accepted", "current"].includes(value))
      || candidate.accepted === true || candidate.current === true;
    if (!acceptedCurrent || candidate.requiresHumanConfirmation === true || candidate.authoritative === false) {
      reject("accepted_current_authority_required");
      continue;
    }
    const candidatePath = normalizeProjectPath(candidate.projectPath);
    const candidateProjectId = compactText(candidate.projectId, 180) || null;
    const pathMatches = Boolean(candidatePath && acceptedProjectPaths.includes(candidatePath));
    const idMatches = Boolean(authorityProjectId && candidateProjectId && candidateProjectId === authorityProjectId);
    if ((candidatePath && !pathMatches) || (authorityProjectId && candidateProjectId && !idMatches) || (!pathMatches && !idMatches)) {
      reject("cross_project_runtime_seed_refused");
      continue;
    }
    const rebasedSourceRefs = rebaseRuntimeSeedSourceRefs(candidate.sourceRefs, candidatePath, acceptedProjectPaths);
    const sourceRefs = normalizeSourceRefs(rebasedSourceRefs, { projectPath });
    if (sourceRefs.length === 0) {
      reject("source_backing_required");
      continue;
    }
    const canonicalName = compactText(candidate.title || candidate.name, 240);
    if (!canonicalName) {
      reject("runtime_seed_title_required");
      continue;
    }
    const tags = [...safeArray(candidate.tags), ...safeArray(candidate.frontmatter?.tags)]
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map((value) => compactText(value, 120))
      .filter(Boolean)
      .slice(0, 12);
    const aliases = [compactText(candidate.summary, 180), ...tags, ...runtimeSeedSourceAliases(sourceRefs)].filter(Boolean);
    const timestamp = isoTimestamp(candidate.updatedAt || candidate.createdAt || sourceRefs[0]?.updatedAt, new Date(0).toISOString());
    const entityResult = normalizeSemanticEntity({
      projectPath,
      projectId,
      kind: runtimeSeedEntityKind(candidate.kind),
      canonicalName,
      aliases,
      status: "active",
      sourceRefs,
      provenance: "explicit",
      confidence: 0.9,
      createdAt: candidate.createdAt || timestamp,
      updatedAt: timestamp,
    }, options);
    if (!entityResult.ok) {
      reject(entityResult.reasonCodes[0] || "runtime_seed_entity_rejected");
      continue;
    }
    eligible.push({ candidate, entity: entityResult.entity, sourceRefs, timestamp });
  }
  if (eligible.length > 0) {
    const projectSourceRefs = normalizeSourceRefs(eligible.flatMap((entry) => entry.sourceRefs), { projectPath });
    const projectTimestamp = eligible.map((entry) => entry.timestamp).sort().at(-1) || new Date(0).toISOString();
    const projectResult = normalizeSemanticEntity({
      projectPath,
      projectId,
      kind: "project",
      canonicalName: compactText(options.projectName, 240) || path.basename(projectPath),
      status: "active",
      sourceRefs: projectSourceRefs,
      provenance: "explicit",
      confidence: 0.9,
      createdAt: new Date(0).toISOString(),
      updatedAt: projectTimestamp,
    }, options);
    if (projectResult.ok) {
      entities.push(projectResult.entity);
      for (const entry of eligible) {
        entities.push(entry.entity);
        const relationResult = normalizeSemanticRelation({
          projectPath,
          projectId,
          fromEntityId: entry.entity.id,
          toEntityId: projectResult.entity.id,
          predicate: "belongs_to",
          status: "active",
          sourceRefs: entry.sourceRefs,
          provenance: "explicit",
          confidence: 0.9,
          createdAt: entry.timestamp,
          updatedAt: entry.timestamp,
        }, options);
        if (relationResult.ok) relations.push(relationResult.relation);
        else reject(relationResult.reasonCodes[0] || "runtime_seed_relation_rejected");
      }
    } else {
      reject(projectResult.reasonCodes[0] || "runtime_seed_project_entity_rejected");
    }
  }
  const rejectedCandidates = candidates.length - eligible.length;
  return {
    schemaVersion: SEMANTIC_MEMORY_GRAPH_SCHEMA,
    projectPath,
    projectId,
    entities: [...new Map(entities.map((entity) => [entity.id, entity])).values()],
    relations: [...new Map(relations.map((relation) => [relation.id, relation])).values()],
    warnings: Object.keys(reasonCounts).slice(0, 20),
    seed: {
      attempted: true,
      candidatesConsidered: candidates.length,
      eligibleCandidates: eligible.length,
      rejectedCandidates,
      recordsPrepared: entities.length + relations.length,
      reasonCounts,
      ...safety,
    },
  };
}

function linkValuesFromDocument(document) {
  const wikilinks = safeArray(document.wikilinks).map((value) => typeof value === "string" ? value : value?.title || value?.target);
  const markdownLinks = safeArray(document.markdownLinks).map((value) => typeof value === "string" ? { title: value } : value);
  const compactMarkdown = typeof document.compactMarkdown === "string" && document.compactMarkdown.length <= MAX_COMPACT_MARKDOWN_CHARS
    ? document.compactMarkdown
    : "";
  for (const match of compactMarkdown.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)) wikilinks.push(match[1]);
  for (const match of compactMarkdown.matchAll(/\[([^\]]{1,180})\]\(([^)\s]{1,520})\)/g)) markdownLinks.push({ title: match[1], uri: match[2] });
  return { wikilinks: wikilinks.map((value) => compactText(value, 180)).filter(Boolean).slice(0, 24), markdownLinks: markdownLinks.slice(0, 24) };
}

function extractExplicitSemanticGraph(input = {}, options = {}) {
  const inspection = inspectSemanticGraphInput(input);
  if (!inspection.safe) return { schemaVersion: SEMANTIC_MEMORY_GRAPH_SCHEMA, entities: [], relations: [], rejected: true, warnings: inspection.reasonCodes };
  const projectPath = normalizeProjectPath(input.projectPath || options.projectPath);
  const projectId = compactText(input.projectId || options.projectId, 180) || projectIdentityForPath(projectPath);
  if (!projectPath || !projectId) return { schemaVersion: SEMANTIC_MEMORY_GRAPH_SCHEMA, entities: [], relations: [], rejected: true, warnings: ["exact_project_identity_required"] };
  const entities = [];
  const relations = [];
  const warnings = [];
  const defaultSourceRefs = safeArray(input.sourceRefs);
  const active = input.acceptedSourceBacked === true && defaultSourceRefs.length > 0;
  const projectResult = input.projectName ? normalizeSemanticEntity({
    projectPath, projectId, kind: "project", canonicalName: input.projectName, aliases: input.projectAliases,
    status: active ? "active" : "review", sourceRefs: defaultSourceRefs, provenance: active ? "human_confirmed" : "explicit",
    createdAt: input.createdAt, updatedAt: input.updatedAt,
  }, options) : null;
  if (projectResult?.ok) entities.push(projectResult.entity);
  for (const document of safeArray(input.documents).slice(0, 24)) {
    if (!document || typeof document !== "object" || document.body || document.content || document.contentText || document.transcript) {
      warnings.push("raw_document_body_refused");
      continue;
    }
    if (typeof document.compactMarkdown === "string" && document.compactMarkdown.length > MAX_COMPACT_MARKDOWN_CHARS) {
      warnings.push("oversized_compact_markdown_refused");
      continue;
    }
    const documentRefs = safeArray(document.sourceRefs).length > 0
      ? document.sourceRefs
      : document.path ? [{ kind: "document", path: document.path, title: document.title || document.name, hash: document.hash }] : defaultSourceRefs;
    const documentActive = (document.acceptedSourceBacked === true || input.acceptedSourceBacked === true) && documentRefs.length > 0;
    const documentResult = normalizeSemanticEntity({
      projectPath, projectId, kind: "document", canonicalName: document.title || document.name || document.path,
      aliases: document.aliases, status: documentActive ? "active" : "review", sourceRefs: documentRefs,
      provenance: documentActive ? "human_confirmed" : "extracted", createdAt: document.createdAt, updatedAt: document.updatedAt,
    }, options);
    if (!documentResult.ok) {
      warnings.push(...documentResult.reasonCodes);
      continue;
    }
    entities.push(documentResult.entity);
    if (projectResult?.ok) {
      const belongs = normalizeSemanticRelation({
        projectPath, projectId, fromEntityId: documentResult.entity.id, toEntityId: projectResult.entity.id,
        predicate: "belongs_to", status: documentActive && projectResult.entity.status === "active" ? "active" : "review",
        sourceRefs: documentRefs, provenance: "explicit", createdAt: document.createdAt, updatedAt: document.updatedAt,
      }, options);
      if (belongs.ok) relations.push(belongs.relation);
    }
    const tags = [...safeArray(document.tags), ...safeArray(document.frontmatter?.tags)].map((value) => compactText(value, 120)).filter(Boolean).slice(0, 24);
    const links = linkValuesFromDocument(document);
    for (const target of [...tags, ...links.wikilinks]) {
      const targetResult = normalizeSemanticEntity({
        projectPath, projectId, kind: tags.includes(target) ? "topic" : "concept", canonicalName: target,
        status: documentActive ? "active" : "review", sourceRefs: documentRefs, provenance: "extracted",
        createdAt: document.createdAt, updatedAt: document.updatedAt,
      }, options);
      if (!targetResult.ok) continue;
      entities.push(targetResult.entity);
      const relationResult = normalizeSemanticRelation({
        projectPath, projectId, fromEntityId: documentResult.entity.id, toEntityId: targetResult.entity.id,
        predicate: tags.includes(target) ? "about" : "mentions", status: documentActive ? "active" : "review",
        sourceRefs: documentRefs, provenance: "extracted", createdAt: document.createdAt, updatedAt: document.updatedAt,
      }, options);
      if (relationResult.ok) relations.push(relationResult.relation);
    }
    const frontmatterPredicates = {
      about: "about",
      applies_to: "applies_to",
      belongs_to: "belongs_to",
      contradicts: "contradicts",
      derived_from: "derived_from",
      implemented_by: "implemented_by",
      item: "mentions",
      project: "belongs_to",
      related_to: "related_to",
      source: "derived_from",
      supersedes: "supersedes",
      supports: "supports",
    };
    for (const [rawField, predicate] of Object.entries(frontmatterPredicates)) {
      const field = rawField.replace(/_/g, "-");
      const rawValue = document.frontmatter?.[rawField] ?? document.frontmatter?.[field];
      const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
        .map((value) => typeof value === "string" || typeof value === "number" ? compactText(value, 220) : "")
        .filter(Boolean)
        .slice(0, 12);
      for (const value of values) {
        const kind = rawField === "project" ? "project" : rawField === "item" ? "item" : rawField === "source" ? "source" : "concept";
        const targetResult = normalizeSemanticEntity({
          projectPath, projectId, kind, canonicalName: value,
          status: documentActive ? "active" : "review", sourceRefs: documentRefs, provenance: "extracted",
          createdAt: document.createdAt, updatedAt: document.updatedAt,
        }, options);
        if (!targetResult.ok) continue;
        entities.push(targetResult.entity);
        const relationResult = normalizeSemanticRelation({
          projectPath, projectId, fromEntityId: documentResult.entity.id, toEntityId: targetResult.entity.id,
          predicate, status: documentActive ? "active" : "review", sourceRefs: documentRefs,
          provenance: "extracted", createdAt: document.createdAt, updatedAt: document.updatedAt,
        }, options);
        if (relationResult.ok) relations.push(relationResult.relation);
      }
    }
    for (const link of links.markdownLinks) {
      const linkTitle = compactText(link?.title || link?.label || link?.uri || link?.url, 180);
      const linkRef = { kind: "linked_source", uri: link?.uri || link?.url || null, path: link?.path || null, title: linkTitle };
      const linkRefs = normalizeSourceRefs([linkRef, ...documentRefs], { projectPath });
      const targetResult = normalizeSemanticEntity({
        projectPath, projectId, kind: "source", canonicalName: linkTitle,
        status: documentActive ? "active" : "review", sourceRefs: linkRefs, provenance: "explicit",
        createdAt: document.createdAt, updatedAt: document.updatedAt,
      }, options);
      if (!targetResult.ok) continue;
      entities.push(targetResult.entity);
      const relationResult = normalizeSemanticRelation({
        projectPath, projectId, fromEntityId: documentResult.entity.id, toEntityId: targetResult.entity.id,
        predicate: "derived_from", status: documentActive ? "active" : "review", sourceRefs: linkRefs,
        provenance: "explicit", createdAt: document.createdAt, updatedAt: document.updatedAt,
      }, options);
      if (relationResult.ok) relations.push(relationResult.relation);
    }
  }
  const factGraph = semanticGraphFromMemoryFacts(input.memoryFacts, { ...options, projectPath, projectId });
  entities.push(...factGraph.entities);
  relations.push(...factGraph.relations);
  return {
    schemaVersion: SEMANTIC_MEMORY_GRAPH_SCHEMA,
    entities: [...new Map(entities.map((entity) => [entity.id, entity])).values()],
    relations: [...new Map(relations.map((relation) => [relation.id, relation])).values()],
    rejected: false,
    warnings: [...new Set(warnings)].slice(0, 20),
    performance: { llmCalls: 0, rawBodyReads: 0, documentScans: 0, boundedInputOnly: true },
  };
}

function semanticGraphReviewMode(options = {}) {
  return options.reviewMode === true || REVIEW_QUERY_TYPES.has(compactText(options.queryType, 80));
}

module.exports = {
  ACTIVE_EVIDENCE_PREDICATES,
  MAX_COMPACT_INPUT_BYTES,
  MAX_COMPACT_MARKDOWN_CHARS,
  SEMANTIC_ENTITY_KINDS,
  SEMANTIC_GRAPH_PROVENANCE,
  SEMANTIC_GRAPH_STATUSES,
  SEMANTIC_MEMORY_GRAPH_SCHEMA,
  assembleBoundedOneHopPaths,
  buildSemanticGraphSeedFromRuntimeItems,
  canonicalSemanticGraphProjectScope,
  extractExplicitSemanticGraph,
  inspectSemanticGraphInput,
  normalizePredicate,
  normalizeProjectPath,
  normalizeSemanticEntity,
  normalizeSemanticRelation,
  normalizeSourceRefs,
  projectIdentityForPath,
  rankSemanticEntity,
  semanticGraphFromMemoryFacts,
  semanticGraphReviewMode,
  stableSemanticEntityId,
  stableSemanticRelationId,
  tokenizeSemanticQuery,
};
