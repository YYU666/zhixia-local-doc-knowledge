const crypto = require("node:crypto");
const { scanPersistenceStructure } = require("./memoryFactPolicy.cjs");

const MEMORY_AUTHORITY_SCHEMA = "zhixia.memory_authority.v1";
const MEMORY_ENVELOPE_SCHEMA = "zhixia.memory_envelope.v1";
const AUTHORITY_DECISION_SCHEMA = "zhixia.authority_decision.v1";
const STANDING_RULE_SCHEMA = "zhixia.standing_rule.v1";

const MEMORY_CAPABILITIES = Object.freeze({
  READ: "memory.read",
  READ_PROJECT: "memory.read_project",
  READ_SHARED: "memory.read_shared",
  READ_RESTRICTED: "memory.read_restricted",
  READ_HISTORY: "memory.read_history",
  READ_COLD_POINTER: "memory.read_cold_pointer",
  READ_COLD_BODY: "memory.read_cold_body",
  SUBMIT_CANDIDATE: "memory.submit_candidate",
  WRITE_WORKING: "memory.write_working",
  REVIEW: "memory.review",
  APPROVE: "memory.approve",
  CURATE: "memory.curate",
  SUPERSEDE: "memory.supersede",
  REVOKE: "memory.revoke",
  EXPIRE: "memory.expire",
  EXPORT_PRIVATE: "memory.export_private",
});

const ALL_CAPABILITIES = Object.freeze(Object.values(MEMORY_CAPABILITIES));
const MEMORY_STATUSES = Object.freeze([
  "candidate",
  "review",
  "accepted",
  "curated",
  "superseded",
  "revoked",
  "expired",
  "rejected",
  "historical",
]);
const CURRENT_RECALL_STATUSES = new Set(["accepted", "curated"]);
const REVIEW_RECALL_STATUSES = new Set(["candidate", "review", "rejected"]);
const HISTORICAL_RECALL_STATUSES = new Set(["superseded", "revoked", "expired", "historical"]);
const HOST_ACTION_RE = /\b(archive|compact|delete|destroy|drop|move|restore|install|enable|execute|run[_ -]?command|publish|export[_ -]?public|set[_ -]?thread[_ -]?archived)\b|归档|压缩|删除|移动|恢复|安装|启用|执行|发布/i;
const RAW_SESSION_RE = /\b(raw[_ -]?session|codex[_ -]?session|session[_ -]?jsonl|thread[_ -]?transcript)\b|(?:^|[\\/])\.codex[\\/](?:archived_)?sessions[\\/]|\.jsonl\b/i;
const SECRET_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b|(?:^|[\\/])\.env(?:$|[.\\/_-])|\b(?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|password|passwd|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{4,}/i;
const BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{80,}|(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{220,}={0,2}(?:$|[^A-Za-z0-9+/])/i;
const TRUST_CONTEXT_STATE = new WeakMap();
const TRUSTED_PRINCIPALS = new WeakMap();
const TRUSTED_DECISIONS = new WeakMap();
const TRUSTED_ENVELOPES = new WeakMap();
const TRUSTED_STANDING_RULES = new WeakMap();

const ROLE_CAPABILITIES = Object.freeze({
  owner: ALL_CAPABILITIES,
  user: [
    MEMORY_CAPABILITIES.READ,
    MEMORY_CAPABILITIES.READ_PROJECT,
    MEMORY_CAPABILITIES.READ_SHARED,
    MEMORY_CAPABILITIES.READ_HISTORY,
    MEMORY_CAPABILITIES.SUBMIT_CANDIDATE,
    MEMORY_CAPABILITIES.WRITE_WORKING,
    MEMORY_CAPABILITIES.REVIEW,
    MEMORY_CAPABILITIES.EXPORT_PRIVATE,
  ],
  untrusted: [MEMORY_CAPABILITIES.SUBMIT_CANDIDATE],
  ceo: [
    MEMORY_CAPABILITIES.READ,
    MEMORY_CAPABILITIES.READ_PROJECT,
    MEMORY_CAPABILITIES.READ_COLD_POINTER,
    MEMORY_CAPABILITIES.SUBMIT_CANDIDATE,
    MEMORY_CAPABILITIES.WRITE_WORKING,
    MEMORY_CAPABILITIES.REVIEW,
  ],
  worker: [
    MEMORY_CAPABILITIES.READ_PROJECT,
    MEMORY_CAPABILITIES.SUBMIT_CANDIDATE,
    MEMORY_CAPABILITIES.WRITE_WORKING,
  ],
  reviewer: [
    MEMORY_CAPABILITIES.READ_PROJECT,
    MEMORY_CAPABILITIES.READ_HISTORY,
    MEMORY_CAPABILITIES.SUBMIT_CANDIDATE,
    MEMORY_CAPABILITIES.REVIEW,
  ],
  service: [
    MEMORY_CAPABILITIES.READ_PROJECT,
    MEMORY_CAPABILITIES.SUBMIT_CANDIDATE,
    MEMORY_CAPABILITIES.WRITE_WORKING,
  ],
  guardian: [
    MEMORY_CAPABILITIES.READ_COLD_POINTER,
    MEMORY_CAPABILITIES.SUBMIT_CANDIDATE,
  ],
  flowskill: [
    MEMORY_CAPABILITIES.READ,
    MEMORY_CAPABILITIES.READ_PROJECT,
  ],
});

const ACTION_CAPABILITY = Object.freeze({
  read: MEMORY_CAPABILITIES.READ,
  read_project: MEMORY_CAPABILITIES.READ_PROJECT,
  read_shared: MEMORY_CAPABILITIES.READ_SHARED,
  read_restricted: MEMORY_CAPABILITIES.READ_RESTRICTED,
  read_history: MEMORY_CAPABILITIES.READ_HISTORY,
  read_cold_pointer: MEMORY_CAPABILITIES.READ_COLD_POINTER,
  read_cold_body: MEMORY_CAPABILITIES.READ_COLD_BODY,
  submit_candidate: MEMORY_CAPABILITIES.SUBMIT_CANDIDATE,
  write_working: MEMORY_CAPABILITIES.WRITE_WORKING,
  review: MEMORY_CAPABILITIES.REVIEW,
  approve: MEMORY_CAPABILITIES.APPROVE,
  approve_rule: MEMORY_CAPABILITIES.APPROVE,
  curate: MEMORY_CAPABILITIES.CURATE,
  supersede: MEMORY_CAPABILITIES.SUPERSEDE,
  revoke: MEMORY_CAPABILITIES.REVOKE,
  revoke_rule: MEMORY_CAPABILITIES.REVOKE,
  expire: MEMORY_CAPABILITIES.EXPIRE,
  historical: MEMORY_CAPABILITIES.READ_HISTORY,
  export_private: MEMORY_CAPABILITIES.EXPORT_PRIVATE,
});

const LIFECYCLE_TRANSITIONS = Object.freeze({
  candidate: Object.freeze(["review", "rejected"]),
  review: Object.freeze(["accepted", "rejected"]),
  accepted: Object.freeze(["curated", "superseded", "revoked", "expired"]),
  curated: Object.freeze(["superseded", "revoked", "expired"]),
  superseded: Object.freeze(["historical"]),
  revoked: Object.freeze(["historical"]),
  expired: Object.freeze(["historical"]),
  rejected: Object.freeze([]),
  historical: Object.freeze([]),
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value, maxChars = 320) {
  const text = String(value == null ? "" : value).replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(number, max)) : fallback;
}

function normalizeEventSequence(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function stableObject(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return compactText(value, 800);
  if (depth >= 4) return "[nested-value-omitted]";
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => stableObject(item, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort().slice(0, 48)) result[compactText(key, 80)] = stableObject(value[key], depth + 1);
    return result;
  }
  return compactText(value, 120);
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function deterministicId(prefix, value) {
  return `${prefix}-${hashValue(stableStringify(value)).slice(0, 20)}`;
}

function uniqueCompact(values, limit = 32, maxChars = 160) {
  const result = [];
  const seen = new Set();
  for (const value of safeArray(values)) {
    const item = compactText(value, maxChars);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function trustContextFrom(value) {
  if (value && TRUST_CONTEXT_STATE.has(value)) return value;
  if (value?.trustContext && TRUST_CONTEXT_STATE.has(value.trustContext)) return value.trustContext;
  return null;
}

function trustState(value) {
  const context = trustContextFrom(value);
  return context ? TRUST_CONTEXT_STATE.get(context) : null;
}

function markTrustedPrincipal(principal, context) {
  const trustedContext = trustContextFrom(context);
  if (trustedContext) TRUSTED_PRINCIPALS.set(principal, trustedContext);
  return principal;
}

function markTrustedDecision(decision, context) {
  const trustedContext = trustContextFrom(context);
  if (trustedContext) {
    TRUSTED_DECISIONS.set(decision, trustedContext);
    if (decision.allowed && decision.receiptId) trustState(trustedContext).authorityReceipts.set(decision.receiptId, decision);
  }
  return decision;
}

function markTrustedEnvelope(envelope, context) {
  const trustedContext = trustContextFrom(context);
  if (trustedContext) TRUSTED_ENVELOPES.set(envelope, trustedContext);
  return envelope;
}

function markTrustedStandingRule(rule, context) {
  const trustedContext = trustContextFrom(context);
  if (trustedContext) TRUSTED_STANDING_RULES.set(rule, trustedContext);
  return rule;
}

function isTrustedObject(registry, value, context) {
  const trustedContext = trustContextFrom(context);
  return Boolean(value && trustedContext && registry.get(value) === trustedContext);
}

function createMemoryAuthorityTrustContext(input = {}) {
  const providedKey = Buffer.isBuffer(input.receiptSigningKey)
    ? input.receiptSigningKey
    : typeof input.receiptSigningKey === "string" ? Buffer.from(input.receiptSigningKey, "utf8") : null;
  const signingKey = providedKey && providedKey.length >= 32
    ? crypto.createHash("sha256").update(providedKey).digest()
    : crypto.randomBytes(32);
  const context = deepFreeze({
    schemaVersion: MEMORY_AUTHORITY_SCHEMA,
    contextId: `authority-context-${crypto.randomUUID()}`,
    label: compactText(input.label || "memory-authority-composition-root", 120),
  });
  TRUST_CONTEXT_STATE.set(context, {
    signingKey,
    principals: new Map(),
    projectBindingsById: new Map(),
    projectBindingsByPath: new Map(),
    authorityReceipts: new Map(),
  });
  return context;
}

function inspectAuthorityInput(value = {}) {
  const scan = scanPersistenceStructure(value);
  const actionScan = scanPersistenceStructure(value, { metadataKeyRe: /action|operation|command|effect|tool/i });
  const signal = scan.signal;
  const flags = {
    rawSession: RAW_SESSION_RE.test(signal),
    secret: SECRET_RE.test(signal) || scan.strongSplitSecret,
    base64: BASE64_RE.test(signal),
    giantBody: scan.giantBody,
    structureTruncated: scan.structureTruncated,
    destructiveHostAction: HOST_ACTION_RE.test(actionScan.metadataValueSignal),
  };
  return {
    flags,
    unsafe: Object.values(flags).some(Boolean),
    reasonCodes: [
      ...(flags.rawSession ? ["unsafe_raw_session"] : []),
      ...(flags.secret ? ["unsafe_secret"] : []),
      ...(flags.base64 ? ["unsafe_base64"] : []),
      ...(flags.giantBody ? ["unsafe_giant_body"] : []),
      ...(flags.structureTruncated ? ["unsafe_structure_truncated"] : []),
      ...(flags.destructiveHostAction ? ["destructive_host_action_forbidden"] : []),
    ],
    scanStats: scan.stats,
  };
}

function normalizeCapabilities(requested, role) {
  const allowed = new Set(ROLE_CAPABILITIES[role] || []);
  const requestedValues = uniqueCompact(requested, 64, 80);
  const source = requestedValues.length > 0 ? requestedValues : [...allowed];
  const capabilities = source.filter((capability) => allowed.has(capability)).sort();
  const deniedCapabilities = requestedValues.filter((capability) => !allowed.has(capability)).sort();
  return { capabilities, deniedCapabilities };
}

function normalizePrincipalRecord(input = {}, options = {}, trustedContext = null) {
  const inspection = inspectAuthorityInput(input);
  const trustedIdentity = !inspection.unsafe && Boolean(trustContextFrom(trustedContext));
  const principalType = ["user", "agent", "service", "project"].includes(input.principalType)
    ? input.principalType
    : options.principalType || (input.agentFamily || input.role && input.role !== "owner" ? "agent" : "user");
  const requestedRole = compactText(options.role || input.role || (principalType === "user" ? "user" : principalType === "agent" ? "worker" : "service"), 40).toLowerCase();
  const normalizedRole = trustedIdentity
    ? ROLE_CAPABILITIES[requestedRole] ? requestedRole : principalType === "user" ? "user" : "service"
    : "untrusted";
  const ids = {
    principalType,
    role: normalizedRole,
    ownerId: compactText(input.ownerId || options.ownerId || "", 180) || null,
    agentFamily: compactText(input.agentFamily || "", 80).toLowerCase() || null,
    externalId: compactText(input.externalId || input.userId || input.agentId || "", 180) || null,
    displayName: compactText(input.displayName || input.name || "", 160) || null,
  };
  const principalId = inspection.unsafe
    ? deterministicId("principal-rejected", { principalType, role: normalizedRole })
    : compactText(input.principalId || "", 180) || deterministicId("principal", ids);
  const ownerId = normalizedRole === "owner" ? principalId : ids.ownerId;
  const capabilityResult = inspection.unsafe ? { capabilities: [], deniedCapabilities: uniqueCompact(input.capabilities, 64, 80) } : normalizeCapabilities(input.capabilities, normalizedRole);
  const principal = deepFreeze({
    schemaVersion: MEMORY_AUTHORITY_SCHEMA,
    principalId,
    principalType,
    role: normalizedRole,
    requestedRole,
    ownerId,
    displayName: inspection.unsafe ? "[unsafe-principal-omitted]" : ids.displayName,
    agentFamily: inspection.unsafe ? null : ids.agentFamily,
    projectIds: inspection.unsafe ? [] : uniqueCompact(input.projectIds || input.projects, 32, 240),
    projectPaths: inspection.unsafe ? [] : uniqueCompact(input.projectPaths, 32, 360),
    moduleIds: inspection.unsafe ? [] : uniqueCompact(input.moduleIds, 48, 160),
    sharedGroupIds: inspection.unsafe ? [] : uniqueCompact(input.sharedGroupIds, 32, 160),
    restrictedPolicyIds: inspection.unsafe ? [] : uniqueCompact(input.restrictedPolicyIds, 32, 160),
    capabilities: capabilityResult.capabilities,
    deniedCapabilities: capabilityResult.deniedCapabilities,
    standingRuleIds: inspection.unsafe ? [] : uniqueCompact(input.standingRuleIds, 64, 180),
    status: inspection.unsafe ? "rejected" : input.revokedAt ? "revoked" : "active",
    trustedIdentity,
    identityProvenance: trustedIdentity ? {
      contextId: trustContextFrom(trustedContext).contextId,
      verifiedAt: isoOrNull(options.verifiedAt || options.now) || new Date(0).toISOString(),
    } : null,
    createdAt: isoOrNull(input.createdAt) || isoOrNull(options.now) || new Date(0).toISOString(),
    revokedAt: inspection.unsafe ? null : isoOrNull(input.revokedAt),
    safetyReasonCodes: inspection.reasonCodes,
  });
  return markTrustedPrincipal(principal, trustedIdentity ? trustedContext : null);
}

function normalizePrincipal(input = {}, options = {}) {
  if (isTrustedObject(TRUSTED_PRINCIPALS, input, options)) return input;
  return normalizePrincipalRecord(input, options, null);
}

function normalizeOwner(input = {}, options = {}) {
  return normalizePrincipal({ ...input, principalType: "user", role: "owner" }, { ...options, principalType: "user", role: "owner" });
}

function normalizeAgentIdentity(input = {}, options = {}) {
  const principal = normalizePrincipal({ ...input, principalType: "agent" }, { ...options, principalType: "agent" });
  const identity = deepFreeze({
    ...principal,
    agentId: principal.principalId,
    identityType: "agent",
    taskIds: principal.status === "rejected" ? [] : uniqueCompact(input.taskIds, 48, 180),
    reviewerForTaskIds: principal.status === "rejected" ? [] : uniqueCompact(input.reviewerForTaskIds, 48, 180),
  });
  return identity;
}

function registerAuthorityPrincipal(context, input = {}, options = {}) {
  const trustedContext = trustContextFrom(context);
  if (!trustedContext) return normalizePrincipal(input, options);
  const principal = normalizePrincipalRecord(input, options, trustedContext);
  if (principal.status !== "active") return principal;
  let registered = principal;
  if (principal.principalType === "agent") {
    registered = deepFreeze({
      ...principal,
      agentId: principal.principalId,
      identityType: "agent",
      taskIds: uniqueCompact(input.taskIds, 48, 180),
      reviewerForTaskIds: uniqueCompact(input.reviewerForTaskIds, 48, 180),
    });
    markTrustedPrincipal(registered, trustedContext);
  }
  trustState(trustedContext).principals.set(registered.principalId, registered);
  return registered;
}

function resolveAuthorityPrincipal(context, principalId) {
  const state = trustState(context);
  const id = compactText(typeof principalId === "object" ? principalId?.principalId : principalId, 180);
  return state && id ? state.principals.get(id) || null : null;
}

function normalizePath(value) {
  return compactText(value, 360).replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
}

function projectBindingMatches(projectId, projectPath, context = {}) {
  const state = trustState(context);
  if (!state) return false;
  const normalizedPath = normalizePath(projectPath || "");
  const binding = state.projectBindingsById.get(projectId);
  if (!binding || binding.projectPath !== normalizedPath) return false;
  const asOf = isoOrNull(context.asOf || context.now) || new Date().toISOString();
  return binding.status === "active" && binding.validFrom <= asOf && (!binding.validTo || binding.validTo > asOf);
}

function registerProjectBinding(context, input = {}, options = {}) {
  const trustedContext = trustContextFrom(context);
  const inspection = inspectAuthorityInput(input);
  const projectId = inspection.unsafe ? null : compactText(input.projectId || input.id || "", 240) || null;
  const projectPath = inspection.unsafe ? null : normalizePath(input.projectPath || input.path || "") || null;
  const reasonCodes = [...inspection.reasonCodes];
  if (!trustedContext) reasonCodes.push("trusted_context_required");
  if (!projectId || !projectPath) reasonCodes.push("project_binding_requires_id_and_path");
  const validFrom = isoOrNull(input.validFrom || options.now) || new Date(0).toISOString();
  const validTo = isoOrNull(input.validTo);
  if (validTo && validTo <= validFrom) reasonCodes.push("invalid_project_binding_interval");
  const status = input.revokedAt || input.supersededBy ? "inactive" : "active";
  const binding = deepFreeze({
    ok: reasonCodes.length === 0,
    bindingId: deterministicId("project-binding", { projectId, projectPath, validFrom }),
    projectId,
    projectPath,
    validFrom,
    validTo,
    status,
    revokedAt: isoOrNull(input.revokedAt),
    supersededBy: compactText(input.supersededBy || "", 180) || null,
    reasonCodes: uniqueCompact(reasonCodes, 16, 100),
  });
  if (binding.ok) {
    const state = trustState(trustedContext);
    state.projectBindingsById.set(projectId, binding);
    state.projectBindingsByPath.set(projectPath, binding);
  }
  return binding;
}

function resolveProjectBinding(context, input = {}, options = {}) {
  const state = trustState(context);
  if (!state) return null;
  const projectId = compactText(input.projectId || input.id || "", 240) || null;
  const projectPath = normalizePath(input.projectPath || input.path || "") || null;
  const byId = projectId ? state.projectBindingsById.get(projectId) : null;
  const byPath = projectPath ? state.projectBindingsByPath.get(projectPath) : null;
  const binding = byId || byPath || null;
  if (!binding || byId && byPath && byId !== byPath) return null;
  if (projectId && binding.projectId !== projectId) return null;
  if (projectPath && binding.projectPath !== projectPath) return null;
  const asOf = isoOrNull(options.asOf || options.now) || new Date().toISOString();
  if (binding.status !== "active" || binding.validFrom > asOf || binding.validTo && binding.validTo <= asOf) return null;
  return binding;
}

function parseMemoryScope(input, context = {}) {
  const source = typeof input === "string" ? { scope: input } : input && typeof input === "object" ? input : {};
  const raw = compactText(source.scope || source.key || source.type || context.scope || "", 360);
  let type = compactText(source.type || "", 40).toLowerCase();
  let scopeId = compactText(source.scopeId || source.id || "", 240) || null;
  if (raw) {
    const separator = raw.indexOf(":");
    type = (separator >= 0 ? raw.slice(0, separator) : raw).toLowerCase();
    if (!scopeId && separator >= 0) scopeId = compactText(raw.slice(separator + 1), 240) || null;
  }
  if (!type) type = source.projectId || source.projectPath || context.projectId || context.projectPath ? "project" : "private";
  const projectId = compactText(source.projectId || context.projectId || (type === "project" ? scopeId : ""), 240) || null;
  const projectPath = normalizePath(source.projectPath || context.projectPath || "") || null;
  const principalId = compactText(source.principalId || context.principalId || (type === "private" ? scopeId : ""), 180) || null;
  const groupId = compactText(source.groupId || context.groupId || (type === "shared" ? scopeId : ""), 180) || null;
  const policyId = compactText(source.policyId || context.policyId || (type === "restricted" ? scopeId : ""), 180) || null;
  const reasonCodes = [];
  if (!["private", "project", "shared", "global", "restricted"].includes(type)) reasonCodes.push("invalid_scope_type");
  if (type === "private" && !principalId) reasonCodes.push("private_scope_requires_principal");
  if (type === "project" && !projectId && !projectPath) reasonCodes.push("project_scope_requires_identity");
  if (type === "project" && projectId && projectPath && !trustState(context)) reasonCodes.push("project_identity_binding_required");
  if (type === "project" && projectId && projectPath && trustState(context) && !projectBindingMatches(projectId, projectPath, context)) reasonCodes.push("project_identity_binding_mismatch");
  if (type === "shared" && !groupId) reasonCodes.push("shared_scope_requires_group");
  if (type === "restricted" && !policyId) reasonCodes.push("restricted_scope_requires_policy");
  if (type === "global" && (projectId || projectPath || source.projectId || source.projectPath)) reasonCodes.push("global_scope_forbids_project_identity");
  const normalizedType = reasonCodes.includes("invalid_scope_type") ? "restricted" : type;
  const key = normalizedType === "global"
    ? "global"
    : `${normalizedType}:${normalizedType === "private" ? principalId || "invalid" : normalizedType === "project" ? projectId || projectPath || "invalid" : normalizedType === "shared" ? groupId || "invalid" : policyId || "invalid"}`;
  return deepFreeze({
    ok: reasonCodes.length === 0,
    type: normalizedType,
    key,
    scopeId: normalizedType === "global" ? null : scopeId,
    principalId: normalizedType === "private" ? principalId : null,
    projectId: normalizedType === "project" ? projectId : null,
    projectPath: normalizedType === "project" ? projectPath : null,
    groupId: normalizedType === "shared" ? groupId : null,
    policyId: normalizedType === "restricted" ? policyId : null,
    reasonCodes,
  });
}

function validateMemoryScope(input, context = {}) {
  return parseMemoryScope(input, context);
}

function normalizeSourceRefs(refs, unsafe = false) {
  if (unsafe) return [];
  const result = [];
  const seen = new Set();
  for (const raw of safeArray(refs)) {
    const inspection = inspectAuthorityInput(raw);
    if (inspection.unsafe || !raw || typeof raw !== "object") continue;
    const ref = {
      kind: compactText(raw.kind || raw.sourceType || "source", 80) || "source",
      id: compactText(raw.id || raw.sourceId || "", 180) || null,
      path: compactText(raw.path || raw.uri || "", 420) || null,
      title: compactText(raw.title || "", 180) || null,
      hash: compactText(raw.hash || raw.sha256 || "", 160) || null,
      updatedAt: isoOrNull(raw.updatedAt || raw.modifiedAt),
    };
    if (![ref.id, ref.path, ref.title, ref.hash].some(Boolean)) continue;
    const signature = stableStringify(ref);
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(ref);
    if (result.length >= 16) break;
  }
  return result;
}

function normalizeTrail(items, unsafe = false) {
  if (unsafe) return [];
  return safeArray(items).slice(0, 32).map((item) => ({
    receiptId: compactText(item?.receiptId || item?.decisionId || item?.id || "", 180) || null,
    principalId: compactText(item?.principalId || item?.approvedBy || item?.revokedBy || "", 180) || null,
    action: compactText(item?.action || "", 60).toLowerCase() || null,
    reason: compactText(item?.reason || "", 260) || null,
    createdAt: isoOrNull(item?.createdAt || item?.at),
  }));
}

function principalOwns(principal, ownerId) {
  return principal?.role === "owner" && principal?.principalType === "user" && principal?.principalId && principal.principalId === ownerId;
}

function principalHasCapability(principal, capability) {
  return safeArray(principal?.capabilities).includes(capability);
}

function projectMatches(principal, scope, context = {}) {
  const projectIds = new Set(safeArray(principal?.projectIds).filter(Boolean));
  const projectPaths = new Set(safeArray(principal?.projectPaths).map(normalizePath).filter(Boolean));
  const idMatches = !scope.projectId || projectIds.has(scope.projectId);
  const pathMatches = !scope.projectPath || projectPaths.has(scope.projectPath);
  return idMatches && pathMatches && Boolean(scope.projectId || scope.projectPath);
}

function authorityDecisionFingerprint(core) {
  return deterministicId("authority-fingerprint", {
    allowed: core.allowed,
    principalId: core.principalId,
    ownerId: core.ownerId,
    action: core.action,
    transition: core.transition,
    targetId: core.targetId,
    scopeKey: core.scopeKey,
    projectId: core.projectId,
    projectPath: core.projectPath,
    requiredCapability: core.requiredCapability,
    reasonCodes: core.reasonCodes,
    validFrom: core.validFrom,
    validTo: core.validTo,
    revokedAt: core.revokedAt,
    supersededBy: core.supersededBy,
  });
}

function authorityDecisionId(core, decisionFingerprint) {
  return deterministicId("authority-decision", {
    decisionFingerprint,
    createdAt: core.createdAt,
    eventSequence: core.eventSequence,
    eventNonce: core.eventNonce,
  });
}

function authorityReceiptProof(context, receipt) {
  const state = trustState(context);
  if (!state) return null;
  return crypto.createHmac("sha256", state.signingKey).update(stableStringify({
    receiptId: receipt.receiptId,
    decisionFingerprint: receipt.decisionFingerprint,
    principalId: receipt.principalId,
    ownerId: receipt.ownerId,
    action: receipt.action,
    transition: receipt.transition,
    targetId: receipt.targetId,
    scopeKey: receipt.scopeKey,
    projectId: receipt.projectId,
    projectPath: receipt.projectPath,
    createdAt: receipt.createdAt,
    validFrom: receipt.validFrom,
    validTo: receipt.validTo,
    revokedAt: receipt.revokedAt,
    supersededBy: receipt.supersededBy,
    eventSequence: receipt.eventSequence,
    eventNonce: receipt.eventNonce,
  })).digest("hex");
}

function buildAuthorityDecision(input = {}, options = {}) {
  const inspection = inspectAuthorityInput(input);
  const allowed = inspection.unsafe ? false : input.allowed === true;
  const reasonCodes = uniqueCompact([...(inspection.reasonCodes || []), ...safeArray(input.reasonCodes)], 24, 100).sort();
  const createdAt = isoOrNull(input.createdAt || input.now) || new Date(0).toISOString();
  const core = {
    schemaVersion: AUTHORITY_DECISION_SCHEMA,
    allowed,
    principalId: inspection.unsafe ? null : compactText(input.principalId || input.principal?.principalId || "", 180) || null,
    ownerId: inspection.unsafe ? null : compactText(input.ownerId || "", 180) || null,
    action: inspection.unsafe ? "rejected" : compactText(input.action || "unknown", 80).toLowerCase(),
    transition: inspection.unsafe ? null : compactText(input.transition || "", 100).toLowerCase() || null,
    targetId: inspection.unsafe ? null : compactText(input.targetId || input.memoryId || input.ruleId || "", 180) || null,
    scopeKey: inspection.unsafe ? null : compactText(input.scopeKey || input.scope?.key || "", 280) || null,
    projectId: inspection.unsafe ? null : compactText(input.projectId || input.scope?.projectId || "", 240) || null,
    projectPath: inspection.unsafe ? null : normalizePath(input.projectPath || input.scope?.projectPath || "") || null,
    requiredCapability: inspection.unsafe ? null : compactText(input.requiredCapability || "", 100) || null,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : [allowed ? "authorized" : "denied"],
    createdAt,
    validFrom: isoOrNull(input.validFrom) || createdAt,
    validTo: isoOrNull(input.validTo),
    revokedAt: isoOrNull(input.revokedAt),
    supersededBy: inspection.unsafe ? null : compactText(input.supersededBy || "", 180) || null,
    eventSequence: normalizeEventSequence(input.eventSequence),
    eventNonce: inspection.unsafe ? null : compactText(input.eventNonce || input.nonce || crypto.randomUUID(), 120),
    effects: {
      mutatesMemory: false,
      archiveCompactDeleteMoveRestore: false,
      installsOrExecutes: false,
      publicExport: false,
      readsRawSessionBody: false,
    },
  };
  const decisionFingerprint = authorityDecisionFingerprint(core);
  const decisionId = authorityDecisionId(core, decisionFingerprint);
  const unsigned = { ...core, decisionId, receiptId: decisionId, decisionFingerprint };
  const receiptProof = authorityReceiptProof(options, unsigned);
  return deepFreeze({ ...unsigned, receiptProof });
}

function hydrateAuthorityReceipt(context, input = {}, options = {}) {
  const trustedContext = trustContextFrom(context);
  const inspection = inspectAuthorityInput(input);
  const reasonCodes = [...inspection.reasonCodes];
  if (!trustedContext) reasonCodes.push("trusted_context_required");
  const core = {
    allowed: input.allowed === true,
    principalId: compactText(input.principalId || "", 180) || null,
    ownerId: compactText(input.ownerId || "", 180) || null,
    action: compactText(input.action || "", 80).toLowerCase() || null,
    transition: compactText(input.transition || "", 100).toLowerCase() || null,
    targetId: compactText(input.targetId || "", 180) || null,
    scopeKey: compactText(input.scopeKey || "", 280) || null,
    projectId: compactText(input.projectId || "", 240) || null,
    projectPath: normalizePath(input.projectPath || "") || null,
    requiredCapability: compactText(input.requiredCapability || "", 100) || null,
    reasonCodes: uniqueCompact(input.reasonCodes, 24, 100).sort(),
    createdAt: isoOrNull(input.createdAt),
    validFrom: isoOrNull(input.validFrom || input.createdAt),
    validTo: isoOrNull(input.validTo),
    revokedAt: isoOrNull(input.revokedAt),
    supersededBy: compactText(input.supersededBy || "", 180) || null,
    eventSequence: normalizeEventSequence(input.eventSequence),
    eventNonce: compactText(input.eventNonce || "", 120) || null,
  };
  const receiptId = compactText(input.receiptId || input.decisionId || "", 180) || null;
  const decisionFingerprint = compactText(input.decisionFingerprint || "", 180) || null;
  const receiptProof = compactText(input.receiptProof || "", 180) || null;
  if (!core.allowed) reasonCodes.push("receipt_must_be_allowed");
  if (!core.principalId || !core.ownerId || !core.action || !core.targetId || !core.scopeKey || !core.createdAt || !core.eventNonce) reasonCodes.push("incomplete_authority_receipt");
  const expectedFingerprint = authorityDecisionFingerprint(core);
  if (decisionFingerprint !== expectedFingerprint) reasonCodes.push("authority_receipt_fingerprint_mismatch");
  if (receiptId !== authorityDecisionId(core, expectedFingerprint)) reasonCodes.push("authority_receipt_id_mismatch");
  const expectedProof = trustedContext ? authorityReceiptProof(trustedContext, { ...core, receiptId, decisionFingerprint }) : null;
  if (!receiptProof || !expectedProof || receiptProof !== expectedProof) reasonCodes.push("authority_receipt_proof_mismatch");
  const state = trustedContext ? trustState(trustedContext) : null;
  const principal = state?.principals.get(core.principalId) || null;
  if (!principal || principal.status !== "active") reasonCodes.push("authority_receipt_principal_unresolved");
  if (principal && (!principalOwns(principal, core.ownerId) || !isTrustedObject(TRUSTED_PRINCIPALS, principal, trustedContext))) reasonCodes.push("authority_receipt_owner_mismatch");
  if (core.projectId && core.projectPath && !projectBindingMatches(core.projectId, core.projectPath, { trustContext: trustedContext, now: options.now || core.createdAt })) reasonCodes.push("authority_receipt_project_binding_mismatch");
  const asOf = isoOrNull(options.asOf || options.now) || new Date().toISOString();
  if (core.validFrom && core.validFrom > asOf || core.validTo && core.validTo <= asOf) reasonCodes.push("authority_receipt_not_effective");
  if (core.revokedAt || core.supersededBy) reasonCodes.push("authority_receipt_inactive");
  if (reasonCodes.length > 0) return deepFreeze({ ok: false, receipt: null, reasonCodes: uniqueCompact(reasonCodes, 24, 100) });
  const receipt = deepFreeze({
    schemaVersion: AUTHORITY_DECISION_SCHEMA,
    ...core,
    decisionId: receiptId,
    receiptId,
    decisionFingerprint,
    receiptProof,
    effects: {
      mutatesMemory: false,
      archiveCompactDeleteMoveRestore: false,
      installsOrExecutes: false,
      publicExport: false,
      readsRawSessionBody: false,
    },
  });
  markTrustedDecision(receipt, trustedContext);
  return deepFreeze({ ok: true, receipt, reasonCodes: [] });
}

function registerAuthorityReceipt(context, input = {}, options = {}) {
  return hydrateAuthorityReceipt(context, input, options);
}

function verifyRegisteredAuthorityReceipt(options, request = {}) {
  const state = trustState(options);
  const receiptId = compactText(request.receiptId || "", 180);
  const receipt = state && receiptId ? state.authorityReceipts.get(receiptId) : null;
  if (!receipt || !isTrustedObject(TRUSTED_DECISIONS, receipt, options)) return false;
  const asOf = isoOrNull(request.asOf || options.asOf || options.now) || new Date().toISOString();
  if (!receipt.allowed || receipt.revokedAt || receipt.supersededBy) return false;
  if (receipt.validFrom && receipt.validFrom > asOf || receipt.validTo && receipt.validTo <= asOf) return false;
  if (receipt.principalId !== request.principalId || receipt.ownerId !== request.ownerId) return false;
  if (!safeArray(request.actions).includes(receipt.action)) return false;
  if (request.transition && receipt.transition !== request.transition) return false;
  if (receipt.targetId !== request.targetId || receipt.scopeKey !== request.scopeKey) return false;
  if (request.projectId && receipt.projectId !== request.projectId) return false;
  if (request.projectPath && receipt.projectPath !== normalizePath(request.projectPath)) return false;
  if (receipt.projectId && receipt.projectPath && !projectBindingMatches(receipt.projectId, receipt.projectPath, options)) return false;
  return true;
}

function hasTrustedApprovalEvidence(items, ownerId, requiredActions, options = {}, target = {}) {
  return safeArray(items).some((item) => verifyRegisteredAuthorityReceipt(options, {
    receiptId: item?.receiptId || item?.decisionId || item?.receipt?.receiptId,
    principalId: item?.principalId || item?.approvedBy || item?.receipt?.principalId,
    ownerId,
    actions: requiredActions,
    transition: target.transition || null,
    targetId: target.targetId,
    scopeKey: target.scopeKey,
    projectId: target.projectId || null,
    projectPath: target.projectPath || null,
    asOf: target.asOf,
  }));
}

function normalizeAction(action) {
  const value = compactText(action, 100).toLowerCase().replace(/[. -]+/g, "_");
  const aliases = {
    memory_read: "read",
    memory_read_project: "read_project",
    memory_submit_candidate: "submit_candidate",
    memory_write_working: "write_working",
    memory_review: "review",
    memory_approve: "approve",
    memory_curate: "curate",
    memory_supersede: "supersede",
    memory_revoke: "revoke",
  };
  return aliases[value] || value;
}

function resolvePrincipal(principalInput, context = {}) {
  if (isTrustedObject(TRUSTED_PRINCIPALS, principalInput, context)) return principalInput;
  return normalizePrincipal(principalInput || {}, context);
}

function scopeForTarget(target = {}, context = {}) {
  if (isTrustedObject(TRUSTED_ENVELOPES, target, context) || isTrustedObject(TRUSTED_STANDING_RULES, target, context)) return target.scope;
  return parseMemoryScope(target.scope || target, {
    ...context,
    projectId: target.projectId || context.projectId,
    projectPath: target.projectPath || context.projectPath,
    principalId: target.principalId || context.principalId,
  });
}

function authorizeMemoryAction(principalInput, actionInput, target = {}, context = {}) {
  const principal = resolvePrincipal(principalInput, context);
  const action = normalizeAction(actionInput);
  const targetInspection = inspectAuthorityInput({ action, target, context });
  const scope = scopeForTarget(target, context);
  const reasonCodes = [];
  let requiredCapability = ACTION_CAPABILITY[action] || null;
  if (HOST_ACTION_RE.test(actionInput)) reasonCodes.push("host_action_not_a_memory_capability");
  if (targetInspection.unsafe) reasonCodes.push(...targetInspection.reasonCodes);
  if (principal.status !== "active") reasonCodes.push("principal_not_active");
  if (!scope.ok) reasonCodes.push(...scope.reasonCodes);
  const capabilityManagementActions = ["expand_capability", "self_elevate", "grant_capability", "manage_capability", "set_capability", "assign_capability", "assign_role"];
  if (capabilityManagementActions.includes(action)) reasonCodes.push("capability_escalation_forbidden");
  if (["approve", "approve_rule", "curate", "supersede", "revoke", "revoke_rule", "expire", "historical", ...capabilityManagementActions].includes(action) && !isTrustedObject(TRUSTED_PRINCIPALS, principal, context)) {
    reasonCodes.push("trusted_identity_required");
  }
  if (!requiredCapability && reasonCodes.length === 0) reasonCodes.push("unknown_memory_action");
  if (action === "read") {
    if (scope.type === "project") requiredCapability = principalHasCapability(principal, MEMORY_CAPABILITIES.READ_PROJECT) ? MEMORY_CAPABILITIES.READ_PROJECT : MEMORY_CAPABILITIES.READ;
    if (scope.type === "shared") requiredCapability = MEMORY_CAPABILITIES.READ_SHARED;
    if (scope.type === "restricted") requiredCapability = MEMORY_CAPABILITIES.READ_RESTRICTED;
  }
  if (requiredCapability && !principalHasCapability(principal, requiredCapability)) reasonCodes.push(action === "read" ? "missing_scope_read_capability" : "missing_capability");
  if (scope.type === "private" && scope.principalId !== principal.principalId && !principalOwns(principal, target.ownerId || context.ownerId)) reasonCodes.push("private_scope_isolation");
  if (scope.type === "project" && !projectMatches(principal, scope, context) && !principalOwns(principal, target.ownerId || context.ownerId)) reasonCodes.push("project_scope_isolation");
  if (scope.type === "shared" && !safeArray(principal.sharedGroupIds).includes(scope.groupId) && !principalOwns(principal, target.ownerId || context.ownerId)) reasonCodes.push("shared_scope_isolation");
  if (scope.type === "restricted" && !safeArray(principal.restrictedPolicyIds).includes(scope.policyId) && !principalOwns(principal, target.ownerId || context.ownerId)) reasonCodes.push("restricted_scope_isolation");

  if (["approve", "approve_rule"].includes(action) && principal.principalType === "agent") reasonCodes.push("agent_self_approval_forbidden");
  if (action === "revoke_rule") {
    if (!principalOwns(principal, target.ownerId)) reasonCodes.push("owner_rule_revoke_forbidden");
  }
  if (["approve", "curate", "revoke", "supersede"].includes(action) && principal.principalType === "agent" && target.principalId === principal.principalId) {
    reasonCodes.push("agent_cannot_elevate_own_memory");
  }

  const allowed = reasonCodes.length === 0;
  const decision = buildAuthorityDecision({
    allowed,
    principalId: principal.principalId,
    ownerId: target.ownerId || context.ownerId || (principal.role === "owner" ? principal.principalId : principal.ownerId),
    action,
    targetId: target.memoryId || target.ruleId || target.id || null,
    scopeKey: scope.key,
    projectId: scope.projectId,
    projectPath: scope.projectPath,
    requiredCapability,
    reasonCodes,
    now: context.now,
    eventSequence: context.eventSequence,
    eventNonce: context.eventNonce,
  }, context);
  return markTrustedDecision(decision, allowed && isTrustedObject(TRUSTED_PRINCIPALS, principal, context) ? context : null);
}

function normalizeStandingRule(input = {}, options = {}) {
  if (isTrustedObject(TRUSTED_STANDING_RULES, input, options)) return input;
  const inspection = inspectAuthorityInput(input);
  const now = isoOrNull(options.now) || isoOrNull(input.updatedAt) || isoOrNull(input.createdAt) || new Date(0).toISOString();
  const scope = parseMemoryScope(input.scope || (input.projectId || input.projectPath ? "project" : `private:${input.ownerId || options.ownerId || "invalid"}`), {
    ...options,
    projectId: input.projectId,
    projectPath: input.projectPath,
    principalId: input.ownerId || options.ownerId,
  });
  const ownerId = inspection.unsafe ? null : compactText(input.ownerId || options.ownerId || "", 180) || null;
  const statement = inspection.unsafe ? "[unsafe-standing-rule-omitted]" : compactText(input.statement || input.rule || "", 800);
  let status = ["candidate", "review", "accepted", "revoked", "expired"].includes(input.status) ? input.status : "candidate";
  const sourceRefs = normalizeSourceRefs(input.sourceRefs, inspection.unsafe);
  const reasonCodes = [...inspection.reasonCodes, ...scope.reasonCodes];
  const appliesTo = uniqueCompact(input.appliesTo || ["all"], 24, 180);
  const effectiveFrom = isoOrNull(input.effectiveFrom) || now;
  const ruleId = inspection.unsafe ? deterministicId("standing-rule-rejected", { ownerId, scope: scope.key }) : compactText(input.ruleId || "", 180) || deterministicId("standing-rule", {
    ownerId,
    scope: scope.key,
    statement,
    appliesTo,
    effectiveFrom,
  });
  if (!ownerId) reasonCodes.push("standing_rule_requires_owner");
  if (!statement) reasonCodes.push("standing_rule_requires_statement");
  if (["accepted"].includes(status) && sourceRefs.length === 0) reasonCodes.push("accepted_rule_requires_source");
  const trustedApproval = hasTrustedApprovalEvidence(input.approvalTrail || input.approval, ownerId, ["approve_rule"], options, {
    transition: "candidate->accepted",
    targetId: ruleId,
    scopeKey: scope.key,
    projectId: scope.projectId,
    projectPath: scope.projectPath,
    asOf: now,
  });
  if (status === "accepted" && !trustedApproval) reasonCodes.push("standing_rule_requires_trusted_owner_approval");
  if (inspection.unsafe) status = "rejected";
  else if (reasonCodes.length > 0 && status === "accepted") status = "review";
  const core = {
    schemaVersion: STANDING_RULE_SCHEMA,
    ownerId,
    projectId: scope.projectId,
    scope,
    statement,
    appliesTo,
    priority: Math.round(clampNumber(input.priority, 50, 0, 100)),
    status,
    effectiveFrom,
    effectiveTo: isoOrNull(input.effectiveTo),
    sourceRefs,
    approvalTrail: normalizeTrail(input.approvalTrail || input.approval, inspection.unsafe),
    revocationTrail: normalizeTrail(input.revocationTrail || input.revocation, inspection.unsafe),
    createdAt: isoOrNull(input.createdAt) || now,
    updatedAt: now,
    reasonCodes: uniqueCompact(reasonCodes, 24, 100),
  };
  const rule = deepFreeze({ ...core, ruleId });
  return markTrustedStandingRule(rule, trustedApproval && status === "accepted" ? options : null);
}

function standingRuleApplies(ruleInput, target = {}, options = {}) {
  const rule = isTrustedObject(TRUSTED_STANDING_RULES, ruleInput, options) ? ruleInput : normalizeStandingRule(ruleInput, options);
  const asOf = isoOrNull(options.asOf || options.now) || new Date().toISOString();
  if (rule.status !== "accepted") return false;
  if (rule.effectiveFrom > asOf || rule.effectiveTo && rule.effectiveTo <= asOf) return false;
  if (rule.scope.type === "project") {
    if (rule.scope.projectId && target.projectId !== rule.scope.projectId) return false;
    if (rule.scope.projectPath && normalizePath(target.projectPath || "") !== rule.scope.projectPath) return false;
  }
  const applies = new Set(rule.appliesTo);
  if (applies.has("all")) return true;
  return [target.memoryType, target.moduleId, target.agentId, target.taskId].filter(Boolean).some((value) => applies.has(value));
}

function planStandingRuleChange(existingInput, request = {}, principalInput, context = {}) {
  const principal = resolvePrincipal(principalInput, context);
  const action = normalizeAction(request.action || (existingInput ? "review" : "submit_candidate"));
  const existing = existingInput ? normalizeStandingRule(existingInput, { ...context, now: context.now }) : null;
  const candidate = normalizeStandingRule(request.rule || existingInput || {}, { ...context, ownerId: existing?.ownerId || principal.ownerId || principal.principalId, now: context.now });
  const target = existing || candidate;
  const authAction = action === "submit" || action === "submit_candidate" ? "submit_candidate" : action === "approve" ? "approve_rule" : action === "revoke" ? "revoke_rule" : action;
  const decision = authorizeMemoryAction(principal, authAction, target, context);
  const reasonCodes = [...decision.reasonCodes];
  if (action === "approve" && !principalOwns(principal, target.ownerId)) reasonCodes.push("owner_approval_required");
  if (action === "revoke" && !principalOwns(principal, target.ownerId)) reasonCodes.push("owner_rule_revoke_forbidden");
  if (["expand_capability", "self_elevate", "grant_capability"].includes(action)) reasonCodes.push("capability_escalation_forbidden");
  const allowed = decision.allowed && reasonCodes.length === decision.reasonCodes.length;
  if (!allowed) return deepFreeze({ allowed: false, action, rule: existing || candidate, decision: buildAuthorityDecision({
    allowed: false,
    principalId: principal.principalId,
    action,
    targetId: target.ruleId,
    scopeKey: target.scope.key,
    reasonCodes,
    now: context.now,
  }) });

  const at = isoOrNull(context.now) || new Date(0).toISOString();
  let next;
  let authorityReceipt = null;
  if (["submit", "submit_candidate"].includes(action)) {
    next = { ...candidate, status: "candidate", updatedAt: at };
  } else if (action === "approve") {
    const receipt = markTrustedDecision(buildAuthorityDecision({ allowed: true, principalId: principal.principalId, ownerId: target.ownerId, action: "approve_rule", transition: "candidate->accepted", targetId: target.ruleId, scopeKey: target.scope.key, projectId: target.scope.projectId, projectPath: target.scope.projectPath, reasonCodes: ["owner_rule_approved"], now: at }, context), isTrustedObject(TRUSTED_PRINCIPALS, principal, context) ? context : null);
    authorityReceipt = receipt;
    next = { ...target, status: "accepted", approvalTrail: [...target.approvalTrail, { receiptId: receipt.decisionId, principalId: principal.principalId, action: "approve", reason: compactText(request.reason || "owner approval", 260), createdAt: at }], updatedAt: at };
  } else if (action === "revoke") {
    const receipt = markTrustedDecision(buildAuthorityDecision({ allowed: true, principalId: principal.principalId, ownerId: target.ownerId, action: "revoke_rule", transition: "accepted->revoked", targetId: target.ruleId, scopeKey: target.scope.key, projectId: target.scope.projectId, projectPath: target.scope.projectPath, reasonCodes: ["owner_rule_revoked"], now: at }, context), isTrustedObject(TRUSTED_PRINCIPALS, principal, context) ? context : null);
    authorityReceipt = receipt;
    next = { ...target, status: "revoked", effectiveTo: at, revocationTrail: [...target.revocationTrail, { receiptId: receipt.decisionId, principalId: principal.principalId, action: "revoke", reason: compactText(request.reason || "owner revocation", 260), createdAt: at }], updatedAt: at };
  } else {
    return deepFreeze({ allowed: false, action, rule: target, decision: buildAuthorityDecision({ allowed: false, principalId: principal.principalId, action, targetId: target.ruleId, scopeKey: target.scope.key, reasonCodes: ["unsupported_standing_rule_transition"], now: at }) });
  }
  const nextRule = markTrustedStandingRule(deepFreeze(next), isTrustedObject(TRUSTED_PRINCIPALS, principal, context) ? context : null);
  const planDecision = markTrustedDecision(buildAuthorityDecision({ allowed: true, principalId: principal.principalId, ownerId: target.ownerId, action, targetId: target.ruleId, scopeKey: target.scope.key, projectId: target.scope.projectId, projectPath: target.scope.projectPath, reasonCodes: ["standing_rule_change_planned"], now: at }, context), isTrustedObject(TRUSTED_PRINCIPALS, principal, context) ? context : null);
  return deepFreeze({ allowed: true, action, rule: nextRule, decision: planDecision, authorityReceipt });
}

function compactEnvelopePayload(input, unsafe) {
  if (unsafe) return { title: "[unsafe-memory-omitted]", summary: "", value: null };
  const source = input.payload && typeof input.payload === "object" ? input.payload : input;
  return {
    title: compactText(source.title || input.title || "", 180) || null,
    summary: compactText(source.summary || input.summary || "", 800) || null,
    value: source.value !== undefined ? stableObject(source.value) : input.value !== undefined ? stableObject(input.value) : null,
  };
}

function normalizeMemoryEnvelope(input = {}, options = {}) {
  if (isTrustedObject(TRUSTED_ENVELOPES, input, options)) return input;
  const inspection = inspectAuthorityInput(input);
  const now = isoOrNull(options.now) || isoOrNull(input.updatedAt) || isoOrNull(input.observedAt) || isoOrNull(input.createdAt) || new Date(0).toISOString();
  const principal = options.principal ? resolvePrincipal(options.principal, { ...options, now }) : null;
  const scope = parseMemoryScope(input.scope || (input.projectId || input.projectPath ? "project" : `private:${input.principalId || principal?.principalId || "invalid"}`), {
    ...options,
    projectId: input.projectId,
    projectPath: input.projectPath,
    principalId: input.principalId || principal?.principalId,
  });
  const sourceRefs = normalizeSourceRefs(input.sourceRefs, inspection.unsafe);
  const payload = compactEnvelopePayload(input, inspection.unsafe);
  const ownerId = inspection.unsafe ? null : compactText(input.ownerId || principal?.ownerId || (principal?.role === "owner" ? principal.principalId : ""), 180) || null;
  const principalId = inspection.unsafe ? null : compactText(input.principalId || principal?.principalId || "", 180) || null;
  const memoryType = inspection.unsafe ? "rejected" : compactText(input.memoryType || input.kind || "memory", 80).toLowerCase();
  const validFrom = isoOrNull(input.validFrom) || isoOrNull(input.observedAt) || now;
  const validTo = isoOrNull(input.validTo);
  const observedAt = isoOrNull(input.observedAt) || validFrom;
  const memoryId = inspection.unsafe ? deterministicId("memory-rejected", { memoryType, scope: scope.key }) : compactText(input.memoryId || input.id || "", 180) || deterministicId("memory", {
    memoryType,
    ownerId,
    principalId,
    scope: scope.key,
    payload,
    observedAt,
  });
  let status = MEMORY_STATUSES.includes(input.status) ? input.status : "candidate";
  const reasonCodes = [...inspection.reasonCodes, ...scope.reasonCodes];
  if (["accepted", "curated"].includes(status) && sourceRefs.length === 0) reasonCodes.push("authoritative_memory_requires_source");
  const trustedApproval = hasTrustedApprovalEvidence(
    input.approvalTrail,
    ownerId,
    status === "curated" ? ["curate"] : ["approve"],
    options,
    {
      transition: status === "curated" ? "accepted->curated" : "review->accepted",
      targetId: memoryId,
      scopeKey: scope.key,
      projectId: scope.projectId,
      projectPath: scope.projectPath,
      asOf: now,
    },
  );
  if (["accepted", "curated"].includes(status) && !trustedApproval) reasonCodes.push("authoritative_memory_requires_trusted_owner_approval");
  if (principal?.principalType === "agent" && ["accepted", "curated"].includes(status)) reasonCodes.push("agent_authority_request_downgraded");
  if (inspection.unsafe) status = "rejected";
  else if (reasonCodes.length > 0 && ["accepted", "curated"].includes(status)) status = "review";
  if (validTo && validTo < validFrom) {
    reasonCodes.push("invalid_temporal_interval");
    if (["accepted", "curated"].includes(status)) status = "review";
  }
  const core = {
    schemaVersion: MEMORY_ENVELOPE_SCHEMA,
    memoryType,
    principalId,
    ownerId,
    projectId: scope.projectId,
    projectPath: scope.projectPath,
    moduleIds: inspection.unsafe ? [] : uniqueCompact(input.moduleIds, 48, 160),
    scope,
    status,
    authorityLevel: status === "curated" ? "owner_curated" : status === "accepted" ? "accepted" : status === "review" ? "reviewed" : "candidate",
    confidence: clampNumber(input.confidence, 0.5, 0, 1),
    validFrom,
    validTo: validTo && validTo >= validFrom ? validTo : null,
    observedAt,
    sourceRefs,
    approvalTrail: normalizeTrail(input.approvalTrail, inspection.unsafe),
    revocationTrail: normalizeTrail(input.revocationTrail, inspection.unsafe),
    supersededBy: inspection.unsafe ? null : compactText(input.supersededBy || "", 180) || null,
    revokedBy: inspection.unsafe ? null : compactText(input.revokedBy || "", 180) || null,
    payload,
    reasonCodes: uniqueCompact(reasonCodes, 24, 100),
    createdAt: isoOrNull(input.createdAt) || now,
    updatedAt: now,
  };
  const envelope = deepFreeze({ ...core, memoryId });
  return markTrustedEnvelope(envelope, trustedApproval && ["accepted", "curated"].includes(status) ? options : null);
}

function buildMemorySubmissionPlan(principalInput, input = {}, context = {}) {
  const principal = resolvePrincipal(principalInput, context);
  const requestedStatus = MEMORY_STATUSES.includes(input.status) ? input.status : "candidate";
  const decision = authorizeMemoryAction(principal, "submit_candidate", input, context);
  const escalation = principal.principalType === "agent" && !["candidate", "review"].includes(requestedStatus);
  if (!decision.allowed || escalation) {
    return deepFreeze({
      allowed: false,
      envelope: null,
      decision: buildAuthorityDecision({
        allowed: false,
        principalId: principal.principalId,
        action: "submit_candidate",
        scopeKey: scopeForTarget(input, context).key,
        reasonCodes: [...decision.reasonCodes, ...(escalation ? ["agent_authority_escalation_forbidden"] : [])],
        now: context.now,
      }),
    });
  }
  const normalizedEnvelope = normalizeMemoryEnvelope({ ...input, status: requestedStatus === "review" ? "review" : "candidate", principalId: principal.principalId, ownerId: input.ownerId || principal.ownerId }, { ...context, principal, now: context.now });
  const trustedPrincipalContext = isTrustedObject(TRUSTED_PRINCIPALS, principal, context) ? context : null;
  const envelope = markTrustedEnvelope(normalizedEnvelope, normalizedEnvelope.status !== "rejected" ? trustedPrincipalContext : null);
  const submissionDecision = markTrustedDecision(buildAuthorityDecision({ allowed: envelope.status !== "rejected", principalId: principal.principalId, ownerId: envelope.ownerId, action: "submit_candidate", targetId: envelope.memoryId, scopeKey: envelope.scope.key, projectId: envelope.scope.projectId, projectPath: envelope.scope.projectPath, reasonCodes: envelope.status === "rejected" ? envelope.reasonCodes : ["candidate_submission_authorized"], now: context.now, eventSequence: context.eventSequence, eventNonce: context.eventNonce }, context), envelope.status !== "rejected" ? trustedPrincipalContext : null);
  return deepFreeze({ allowed: envelope.status !== "rejected", envelope, decision: submissionDecision });
}

function lifecycleActionForStatus(status) {
  return {
    review: "review",
    accepted: "approve",
    curated: "curate",
    superseded: "supersede",
    revoked: "revoke",
    expired: "expire",
    rejected: "review",
    historical: "historical",
  }[status] || "unknown";
}

function planMemoryLifecycleTransition(envelopeInput, toStatus, principalInput, context = {}) {
  const principal = resolvePrincipal(principalInput, context);
  const envelope = isTrustedObject(TRUSTED_ENVELOPES, envelopeInput, context) ? envelopeInput : normalizeMemoryEnvelope(envelopeInput, { ...context, now: context.now });
  const targetStatus = compactText(toStatus, 40).toLowerCase();
  const action = lifecycleActionForStatus(targetStatus);
  const reasonCodes = [];
  if (!MEMORY_STATUSES.includes(targetStatus)) reasonCodes.push("invalid_target_status");
  if (!safeArray(LIFECYCLE_TRANSITIONS[envelope.status]).includes(targetStatus)) reasonCodes.push("invalid_lifecycle_transition");
  if (targetStatus === "superseded" && !context.replacementMemoryId) reasonCodes.push("supersession_requires_replacement");
  if (targetStatus === "historical" && principal.role !== "owner") reasonCodes.push("owner_history_transition_required");
  const auth = authorizeMemoryAction(principal, action, envelope, context);
  reasonCodes.push(...auth.reasonCodes.filter((reason) => reason !== "authorized"));
  if (reasonCodes.length > 0 || !auth.allowed) {
    return deepFreeze({
      allowed: false,
      fromStatus: envelope.status,
      toStatus: targetStatus,
      action,
      envelopeBefore: envelope,
      envelopeAfter: null,
      decision: buildAuthorityDecision({ allowed: false, principalId: principal.principalId, action, targetId: envelope.memoryId, scopeKey: envelope.scope.key, reasonCodes, now: context.now }),
    });
  }
  const at = isoOrNull(context.now) || new Date(0).toISOString();
  const transition = `${envelope.status}->${targetStatus}`;
  const trustedPrincipalContext = isTrustedObject(TRUSTED_PRINCIPALS, principal, context) ? context : null;
  const decision = markTrustedDecision(buildAuthorityDecision({ allowed: true, principalId: principal.principalId, ownerId: envelope.ownerId, action, transition, targetId: envelope.memoryId, scopeKey: envelope.scope.key, projectId: envelope.scope.projectId, projectPath: envelope.scope.projectPath, reasonCodes: ["lifecycle_transition_authorized"], now: at, eventSequence: context.eventSequence, eventNonce: context.eventNonce }, context), trustedPrincipalContext);
  const trailEntry = { receiptId: decision.decisionId, principalId: principal.principalId, action, reason: compactText(context.reason || "", 260) || null, createdAt: at };
  const next = {
    ...envelope,
    status: targetStatus,
    authorityLevel: targetStatus === "curated" ? "owner_curated" : targetStatus === "accepted" ? "accepted" : envelope.authorityLevel,
    updatedAt: at,
    approvalTrail: ["accepted", "curated"].includes(targetStatus) ? [...envelope.approvalTrail, trailEntry] : envelope.approvalTrail,
    revocationTrail: targetStatus === "revoked" ? [...envelope.revocationTrail, trailEntry] : envelope.revocationTrail,
    revokedBy: targetStatus === "revoked" ? principal.principalId : envelope.revokedBy,
    supersededBy: targetStatus === "superseded" ? compactText(context.replacementMemoryId, 180) : envelope.supersededBy,
    validTo: ["superseded", "revoked", "expired"].includes(targetStatus) ? at : envelope.validTo,
  };
  const nextEnvelope = markTrustedEnvelope(deepFreeze(next), trustedPrincipalContext);
  return deepFreeze({ allowed: true, fromStatus: envelope.status, toStatus: targetStatus, action, envelopeBefore: envelope, envelopeAfter: nextEnvelope, decision });
}

function isExpiredAt(envelope, asOf) {
  return envelope.status === "expired" || Boolean(envelope.validTo && envelope.validTo <= asOf && ["accepted", "curated"].includes(envelope.status));
}

function normalizeLegacyMemoryRecord(record = {}, options = {}) {
  const originalStatus = compactText(record.status || record.freshness || "candidate", 40).toLowerCase();
  const mappedStatus = ["accepted", "active", "current", "curated"].includes(originalStatus)
    ? originalStatus === "curated" ? "curated" : "accepted"
    : MEMORY_STATUSES.includes(originalStatus) ? originalStatus : "candidate";
  const legacyScope = record.scope && typeof record.scope === "object" && record.scope.type
    ? {
        type: record.scope.type,
        projectId: record.projectId || record.scope.projectId || null,
        projectPath: record.projectPath || record.scope.projectPath || null,
        principalId: record.scope.principalId || null,
        groupId: record.scope.groupId || null,
        policyId: record.scope.policyId || null,
      }
    : record.scope || (record.projectId || record.projectPath ? "project" : `private:${record.principalId || options.principalId || "invalid"}`);
  const envelope = normalizeMemoryEnvelope({
    memoryId: record.memoryId || record.id,
    memoryType: record.memoryType || record.factType || record.kind || "legacy_memory",
    principalId: record.principalId || record.createdBy || null,
    ownerId: record.ownerId || options.ownerId || null,
    scope: legacyScope,
    projectId: record.projectId || null,
    projectPath: record.projectPath || null,
    moduleIds: record.moduleIds,
    status: mappedStatus,
    confidence: record.confidence,
    title: record.title || [record.subject, record.predicate].filter(Boolean).join(" / "),
    summary: record.summary || null,
    value: record.value !== undefined ? record.value : record.object,
    validFrom: record.validFrom,
    validTo: record.validTo,
    observedAt: record.observedAt || record.updatedAt,
    sourceRefs: record.sourceRefs,
    approvalTrail: record.approvalTrail || record.authorityTrail,
    supersededBy: record.supersededBy,
    revokedBy: record.revokedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }, options);
  const authorityDowngraded = ["accepted", "active", "current", "curated"].includes(originalStatus) && !["accepted", "curated"].includes(envelope.status);
  const normalized = deepFreeze({
    ...envelope,
    reasonCodes: uniqueCompact([...envelope.reasonCodes, ...(authorityDowngraded ? ["legacy_authority_downgraded"] : [])], 24, 100),
    compatibility: {
      source: "legacy_memory_record",
      originalStatus,
      authorityDowngraded,
      storeMutated: false,
    },
  });
  return markTrustedEnvelope(normalized, isTrustedObject(TRUSTED_ENVELOPES, envelope, options) ? options : null);
}

function queryAuthorizedMemory(envelopes, principalInput, query = {}) {
  const principal = resolvePrincipal(principalInput, query);
  const asOf = isoOrNull(query.asOf || query.now) || new Date().toISOString();
  const view = compactText(query.view || "normal", 40).toLowerCase();
  const requestedProjectId = compactText(query.projectId || "", 240) || null;
  const requestedProjectPath = normalizePath(query.projectPath || "") || null;
  const items = [];
  const decisions = [];
  for (const raw of safeArray(envelopes)) {
    const envelope = isTrustedObject(TRUSTED_ENVELOPES, raw, query) ? raw : normalizeMemoryEnvelope(raw, { ...query, now: asOf });
    let statusAllowed = false;
    if (view === "normal") statusAllowed = CURRENT_RECALL_STATUSES.has(envelope.status) && !isExpiredAt(envelope, asOf);
    else if (view === "review") statusAllowed = REVIEW_RECALL_STATUSES.has(envelope.status) && principalHasCapability(principal, MEMORY_CAPABILITIES.REVIEW);
    else if (view === "historical") statusAllowed = HISTORICAL_RECALL_STATUSES.has(envelope.status) && principalHasCapability(principal, MEMORY_CAPABILITIES.READ_HISTORY);
    else if (view === "all") statusAllowed = principal.role === "owner";
    if (!statusAllowed) continue;
    if (requestedProjectId || requestedProjectPath) {
      if (envelope.scope.type !== "project") continue;
      if (requestedProjectId && envelope.scope.projectId !== requestedProjectId) continue;
      if (requestedProjectPath && envelope.scope.projectPath !== requestedProjectPath) continue;
    }
    const decision = authorizeMemoryAction(principal, view === "historical" ? "read_history" : "read", envelope, { ...query, now: asOf });
    decisions.push(decision);
    if (!decision.allowed) continue;
    if (envelope.scope.type === "restricted" && view === "normal") continue;
    items.push(envelope);
  }
  items.sort((left, right) => {
    const authority = { curated: 2, accepted: 1 };
    const authorityDelta = (authority[right.status] || 0) - (authority[left.status] || 0);
    if (authorityDelta) return authorityDelta;
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta) return confidenceDelta;
    const updatedDelta = String(right.updatedAt).localeCompare(String(left.updatedAt));
    return updatedDelta || left.memoryId.localeCompare(right.memoryId);
  });
  const receipt = buildAuthorityDecision({
    allowed: true,
    principalId: principal.principalId,
    action: `query_${view}`,
    scopeKey: requestedProjectId ? `project:${requestedProjectId}` : requestedProjectPath ? `project:${requestedProjectPath}` : null,
    reasonCodes: [`authority_query_${view}`, `returned_${items.length}`],
    now: asOf,
  });
  return deepFreeze({ items, decisions, excludedCount: safeArray(envelopes).length - items.length, receipt });
}

module.exports = {
  ACTION_CAPABILITY,
  ALL_CAPABILITIES,
  AUTHORITY_DECISION_SCHEMA,
  CURRENT_RECALL_STATUSES,
  HISTORICAL_RECALL_STATUSES,
  LIFECYCLE_TRANSITIONS,
  MEMORY_AUTHORITY_SCHEMA,
  MEMORY_CAPABILITIES,
  MEMORY_ENVELOPE_SCHEMA,
  MEMORY_STATUSES,
  REVIEW_RECALL_STATUSES,
  ROLE_CAPABILITIES,
  STANDING_RULE_SCHEMA,
  authorizeMemoryAction,
  buildAuthorityDecision,
  buildMemorySubmissionPlan,
  createMemoryAuthorityTrustContext,
  hydrateAuthorityReceipt,
  normalizeAgentIdentity,
  normalizeMemoryEnvelope,
  normalizeLegacyMemoryRecord,
  normalizeOwner,
  normalizePrincipal,
  normalizeStandingRule,
  parseMemoryScope,
  planMemoryLifecycleTransition,
  planStandingRuleChange,
  queryAuthorizedMemory,
  registerAuthorityPrincipal,
  registerAuthorityReceipt,
  registerProjectBinding,
  resolveAuthorityPrincipal,
  resolveProjectBinding,
  standingRuleApplies,
  validateMemoryScope,
};
