const crypto = require("node:crypto");
const { types: utilTypes } = require("node:util");

const {
  PROJECT_CONTINUITY_SLOTS,
  buildProjectCheckpoint,
} = require("./projectBrainPolicy.cjs");

const MEMORY_FORMATION_SCHEMA = "zhixia.memory_formation_plan.v1";
const MEMORY_FORMATION_EVENT_SCHEMA = "zhixia.memory_formation_event.v1";
const EPISODE_MEMORY_SCHEMA = "zhixia.episode_memory.v1";
const DECISION_CANDIDATE_SCHEMA = "zhixia.decision_candidate.v1";
const CONSTRAINT_CANDIDATE_SCHEMA = "zhixia.constraint_candidate.v1";
const CONTINUITY_PATCH_SCHEMA = "zhixia.project_continuity_patch_candidate.v1";
const RELATION_CANDIDATE_SCHEMA = "zhixia.memory_relation_candidate.v1";

const SUPPORTED_EVENT_TYPES = Object.freeze([
  "accepted",
  "revise",
  "block",
  "checkpoint",
  "user_rule",
  "user_correction",
  "test_failure",
  "test_pass",
  "build",
  "install",
  "release",
  "thread_recovery",
  "handoff",
]);

const EVENT_TYPE_ALIASES = Object.freeze({
  accept: "accepted",
  accepted: "accepted",
  approve: "accepted",
  approved: "accepted",
  revise: "revise",
  revised: "revise",
  revision: "revise",
  block: "block",
  blocked: "block",
  checkpoint: "checkpoint",
  task_checkpoint: "checkpoint",
  execution_checkpoint: "checkpoint",
  user_rule: "user_rule",
  user_rule_update: "user_rule",
  standing_rule: "user_rule",
  standing_rule_update: "user_rule",
  user_correction: "user_correction",
  correction: "user_correction",
  direction_correction: "user_correction",
  test_failure: "test_failure",
  test_failed: "test_failure",
  tests_failed: "test_failure",
  test_fail: "test_failure",
  test_pass: "test_pass",
  test_passed: "test_pass",
  tests_passed: "test_pass",
  build: "build",
  build_result: "build",
  install: "install",
  installation: "install",
  release: "release",
  released: "release",
  thread_recovery: "thread_recovery",
  recovery: "thread_recovery",
  takeover: "thread_recovery",
  handoff: "handoff",
  thread_handoff: "handoff",
});

const CHECKPOINT_EVENT_TYPES = new Set([
  "accepted",
  "revise",
  "block",
  "checkpoint",
  "test_failure",
  "test_pass",
  "build",
  "install",
  "release",
  "thread_recovery",
  "handoff",
]);
const RAW_SESSION_RE = /\b(raw[_ -]?session|session[_ -]?body|thread[_ -]?body|thread[_ -]?transcript|session[_ -]?jsonl)\b|(?:^|[\\/])\.codex[\\/](?:archived_)?sessions[\\/]|\.jsonl\b/i;
const SECRET_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b|(?:^|[\\/])\.env(?:$|[.\\/_-])|\b(?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|password|passwd|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{4,}/i;
const SPLIT_SECRET_RE = /(?:authorization:)?bearer[A-Za-z0-9._~+/=-]{12,}|sk-[A-Za-z0-9_-]{12,}|(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|AKIA[0-9A-Z]{16}|(?:api_?key|auth_?token|access_?token|password|passwd|secret|private_?key)[:=][^,;]{4,}/i;
const CRYPTOGRAPHIC_METADATA_KEY_RE = /^(?:authorityReceiptId|receiptId|receiptProof|proof|decisionFingerprint|targetFingerprint|fingerprint|signature|hash|sha256|nonce|eventNonce|idempotencyKey)$/i;
const SPLIT_SECRET_CONTENT_KEY_RE = /(?:summary|message|note|text|value|result|why|description|detail|excerpt|command|authorization|credential|config|environment|source|path|title|content)/i;
const BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{64,}|(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{220,}={0,2}(?:$|[^A-Za-z0-9+/])/i;
const DESTRUCTIVE_HOST_ACTION_RE = /\b(archive|compact|delete|destroy|drop|move|restore|install|enable|execute|run[_ -]?command|publish|set[_ -]?thread[_ -]?archived)\b|\u5f52\u6863|\u538b\u7f29|\u5220\u9664|\u79fb\u52a8|\u6062\u590d|\u5b89\u88c5|\u542f\u7528|\u6267\u884c|\u53d1\u5e03/i;
const REVIEW_SIGNAL_RE = /\b(heuristic|cross[_ -]?project|user[_ -]?preference|preference|security|archive|compact|restore)\b|\u542f\u53d1\u5f0f|\u8de8\u9879\u76ee|\u7528\u6237\u504f\u597d|\u5b89\u5168|\u5f52\u6863|\u538b\u7f29|\u6062\u590d/i;
const RAW_BODY_KEY_RE = /^(?:rawBody|rawText|sessionBody|threadBody|transcript|messages|chatMessages)$/i;
const COLD_POINTER_KINDS = new Set(["cold_pointer", "cold_evidence_pointer", "vault_pointer", "history_pointer"]);
const EPOCH = "1970-01-01T00:00:00.000Z";
const MAX_SOURCE_REFS = 24;
const MAX_TEXT_ITEMS = 16;
const MAX_TYPED_CANDIDATES = 12;
const MAX_RELATIONS = 24;
const MAX_ARTIFACT_REFS = 16;
const MAX_THREAD_REFS = 12;
const MAX_CANDIDATE_SOURCE_REFS = 8;
const MAX_RELATION_SOURCE_REFS = 4;
const FORMATION_SCAN_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 4096,
  maxObjectEntries: 256,
  maxArrayEntries: 256,
  maxSignalChars: 262144,
  maxScalarFragments: 8192,
  maxScalarFragmentChars: 128,
});
const ACTION_SCOPE_KEY_RE = /intent|request|action|effect|command|operation|tool.?call|execute|execution/i;
const GENERIC_CHAT_RE = /^(?:hi|hello|hey|thanks|thank you|ok|okay|got it|你好|您好|嗨|谢谢|好的|收到|明白了)[.!！。?？\s]*$/i;
const AUTHORITY_ACTION = "memory_formation";

function safeArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function boundedFlatten(value, limit = 512, maxDepth = FORMATION_SCAN_LIMITS.maxDepth) {
  const result = [];
  const stack = [{ value, depth: 0 }];
  while (stack.length > 0 && result.length < limit) {
    const current = stack.pop();
    if (Array.isArray(current.value)) {
      if (current.depth >= maxDepth) continue;
      const count = Math.min(current.value.length, limit);
      for (let index = count - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    result.push(current.value);
  }
  return result;
}

function compactText(value, maxChars = 360) {
  const text = String(value == null ? "" : value)
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function normalizedKey(value) {
  return compactText(value, 500).normalize("NFKC").toLowerCase().replace(/[\s-]+/g, "_");
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

function clampInteger(value, fallback = 0, min = 0, max = 1000000) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function canonicalize(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return compactText(value, 800);
  if (depth >= 5) return "[nested-value-omitted]";
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => canonicalize(item, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort().slice(0, 64)) {
      result[compactText(key, 80)] = canonicalize(value[key], depth + 1);
    }
    return result;
  }
  return null;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function deterministicId(prefix, value, chars = 20) {
  return `${prefix}-${hashValue(stableStringify(value)).slice(0, chars)}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function uniqueStrings(values, limit = MAX_TEXT_ITEMS, maxChars = 260) {
  const byKey = new Map();
  for (const value of boundedFlatten(safeArray(values))) {
    if (value == null) continue;
    let text = "";
    if (typeof value === "object") {
      text = compactText(value.statement || value.summary || value.title || value.value || value.code || value.id, maxChars);
    } else {
      text = compactText(value, maxChars);
    }
    const key = normalizedKey(text);
    if (key && !byKey.has(key)) byKey.set(key, text);
  }
  return Array.from(byKey.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, limit)
    .map(([, text]) => text);
}

function splitSecretDetected(fragments) {
  const compactFragments = fragments.map((fragment) => String(fragment).replace(/\s+/g, "")).filter(Boolean);
  for (let index = 0; index < compactFragments.length; index += 1) {
    let joined = "";
    for (let width = 0; width < 8 && index + width < compactFragments.length; width += 1) {
      joined += compactFragments[index + width];
      if (SECRET_RE.test(joined) || SPLIT_SECRET_RE.test(joined)) return true;
    }
  }
  const allFragments = compactFragments.join("");
  return SECRET_RE.test(allFragments) || SPLIT_SECRET_RE.test(allFragments);
}

function preflightMemoryFormationInput(input = {}) {
  const flags = {
    rawSession: false,
    secret: false,
    base64: false,
    giantBody: false,
    structureTruncated: false,
    destructiveHostIntent: false,
    accessor: false,
    proxy: false,
    cycle: false,
    descriptorError: false,
    unsupportedValue: false,
  };
  const fragments = [];
  const secretScanFragments = [];
  const base64ScanFragments = [];
  const splitSecretGroups = new Map();
  const actionFragments = [];
  let signalChars = 0;
  let nodesVisited = 0;
  let maxDepthVisited = 0;
  const active = new WeakSet();
  const holder = { value: null };
  let splitGroupSequence = 0;
  const stack = [{ kind: "enter", value: input, depth: 0, parent: holder, key: "value", actionScoped: false, cryptographicMetadata: false, splitGroup: null }];

  function appendFragment(value, actionScoped = false, scalar = true, cryptographicMetadata = false, splitGroup = null) {
    const text = String(value == null ? "" : value);
    if (!text) return;
    if (text.length > FORMATION_SCAN_LIMITS.maxScalarFragmentChars) {
      fragments.push(text.slice(0, FORMATION_SCAN_LIMITS.maxScalarFragmentChars));
    } else {
      fragments.push(text);
    }
    if (scalar && !cryptographicMetadata) {
      secretScanFragments.push(text);
      base64ScanFragments.push(text);
      if (splitGroup && typeof value === "string") {
        const group = splitSecretGroups.get(splitGroup) || [];
        group.push(text);
        splitSecretGroups.set(splitGroup, group);
      }
    }
    if (actionScoped) actionFragments.push(text.slice(0, FORMATION_SCAN_LIMITS.maxScalarFragmentChars));
    signalChars += text.length;
    if (signalChars > FORMATION_SCAN_LIMITS.maxSignalChars || fragments.length > FORMATION_SCAN_LIMITS.maxScalarFragments) {
      flags.structureTruncated = true;
    }
    if (typeof value === "string" && value.length > 12000) flags.giantBody = true;
  }

  function assign(parent, key, value) {
    if (Array.isArray(parent) && /^\d+$/.test(String(key))) parent[Number(key)] = value;
    else parent[key] = value;
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.kind === "exit") {
      active.delete(current.value);
      continue;
    }
    const value = current.value;
    nodesVisited += 1;
    maxDepthVisited = Math.max(maxDepthVisited, current.depth);
    if (nodesVisited > FORMATION_SCAN_LIMITS.maxNodes || current.depth > FORMATION_SCAN_LIMITS.maxDepth) {
      flags.structureTruncated = true;
      continue;
    }
    if (value == null || ["string", "number", "boolean", "bigint", "undefined"].includes(typeof value)) {
      const stored = typeof value === "bigint" ? String(value) : value;
      assign(current.parent, current.key, stored);
      appendFragment(stored, current.actionScoped, true, current.cryptographicMetadata, current.splitGroup);
      continue;
    }
    if (["function", "symbol"].includes(typeof value)) {
      flags.unsupportedValue = true;
      continue;
    }
    if (utilTypes.isProxy(value)) {
      flags.proxy = true;
      continue;
    }
    if (active.has(value)) {
      flags.cycle = true;
      continue;
    }
    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      flags.descriptorError = true;
      continue;
    }
    const clone = Array.isArray(value) ? [] : Object.create(null);
    assign(current.parent, current.key, clone);
    active.add(value);
    stack.push({ kind: "exit", value });
    const keys = Reflect.ownKeys(descriptors).filter((key) => !(Array.isArray(value) && key === "length"));
    if (keys.some((key) => typeof key === "symbol")) flags.unsupportedValue = true;
    const stringKeys = keys.filter((key) => typeof key === "string").sort();
    const maxEntries = Array.isArray(value) ? FORMATION_SCAN_LIMITS.maxArrayEntries : FORMATION_SCAN_LIMITS.maxObjectEntries;
    if ((Array.isArray(value) && value.length > maxEntries) || stringKeys.length > maxEntries) flags.structureTruncated = true;
    const selectedKeys = stringKeys.slice(0, maxEntries);
    for (let index = selectedKeys.length - 1; index >= 0; index -= 1) {
      const key = selectedKeys[index];
      const descriptor = descriptors[key];
      appendFragment(key, false, false);
      if (!descriptor || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        flags.accessor = true;
        continue;
      }
      const child = descriptor.value;
      if (RAW_BODY_KEY_RE.test(key) && child != null && child !== "") flags.rawSession = true;
      const actionScoped = current.actionScoped || ACTION_SCOPE_KEY_RE.test(key);
      const cryptographicMetadata = current.cryptographicMetadata || CRYPTOGRAPHIC_METADATA_KEY_RE.test(key);
      const startsSplitGroup = !cryptographicMetadata && (Array.isArray(child) || SPLIT_SECRET_CONTENT_KEY_RE.test(key));
      const splitGroup = current.splitGroup || (startsSplitGroup ? `split-group-${++splitGroupSequence}` : null);
      stack.push({ kind: "enter", value: child, depth: current.depth + 1, parent: clone, key, actionScoped, cryptographicMetadata, splitGroup });
    }
  }

  const signal = fragments.join(" ");
  const secretSignal = secretScanFragments.join(" ");
  const base64Signal = base64ScanFragments.join(" ");
  flags.rawSession = flags.rawSession || RAW_SESSION_RE.test(signal);
  flags.secret = SECRET_RE.test(secretSignal) || Array.from(splitSecretGroups.values()).some(splitSecretDetected);
  flags.base64 = BASE64_RE.test(base64Signal);
  flags.destructiveHostIntent = DESTRUCTIVE_HOST_ACTION_RE.test(actionFragments.join(" "));
  const safe = !Object.values(flags).some(Boolean);
  const inspection = {
    safe,
    flags,
    reasonCodes: [
      ...(flags.rawSession ? ["unsafe_raw_session_or_body"] : []),
      ...(flags.secret ? ["unsafe_secret"] : []),
      ...(flags.base64 ? ["unsafe_base64"] : []),
      ...(flags.giantBody ? ["unsafe_giant_body"] : []),
      ...(flags.structureTruncated ? ["unsafe_structure_truncated"] : []),
      ...(flags.destructiveHostIntent ? ["destructive_host_intent_forbidden"] : []),
      ...(flags.accessor ? ["unsafe_accessor_input"] : []),
      ...(flags.proxy ? ["unsafe_proxy_input"] : []),
      ...(flags.cycle ? ["unsafe_cycle_input"] : []),
      ...(flags.descriptorError ? ["unsafe_descriptor_error"] : []),
      ...(flags.unsupportedValue ? ["unsafe_unsupported_value"] : []),
    ],
    scanStats: {
      nodesVisited: Math.min(nodesVisited, FORMATION_SCAN_LIMITS.maxNodes + 1),
      maxDepthVisited,
      signalChars: Math.min(signalChars, FORMATION_SCAN_LIMITS.maxSignalChars + 1),
      scalarFragments: Math.min(fragments.length, FORMATION_SCAN_LIMITS.maxScalarFragments + 1),
      limits: FORMATION_SCAN_LIMITS,
    },
  };
  return { inspection, snapshot: holder.value || Object.create(null) };
}

function inspectMemoryFormationInput(input = {}) {
  const { inspection } = preflightMemoryFormationInput(input);
  const flags = {
    ...inspection.flags,
  };
  return {
    safe: inspection.safe,
    flags,
    reasonCodes: inspection.reasonCodes,
    scanStats: inspection.scanStats,
  };
}

function normalizeEventType(value) {
  const key = normalizedKey(value);
  return EVENT_TYPE_ALIASES[key] || null;
}

function sourceRefSignature(ref) {
  return [ref.kind, ref.id, ref.path, ref.uri, ref.hash, ref.title, ref.projectId, ref.moduleId]
    .map((value) => value || "")
    .join("|");
}

function normalizeSourceRef(input) {
  const source = typeof input === "string" ? { path: input } : input;
  if (!source || typeof source !== "object") return null;
  const kind = normalizedKey(source.kind || source.sourceType || "source") || "source";
  const coldPointer = COLD_POINTER_KINDS.has(kind);
  const rawPath = compactText(source.path || source.filePath, 500).replace(/\\/g, "/") || null;
  const rawUri = compactText(source.uri || source.url, 500) || null;
  const rawTitle = compactText(source.title, 180) || null;
  const signal = `${rawPath || ""} ${rawUri || ""} ${rawTitle || ""}`;
  if (RAW_SESSION_RE.test(signal) || SECRET_RE.test(signal) || BASE64_RE.test(signal)) return null;
  const ref = {
    kind,
    id: compactText(source.id || source.sourceId || source.pointerId, 180) || null,
    path: coldPointer ? null : rawPath,
    uri: coldPointer ? null : rawUri,
    title: rawTitle,
    hash: compactText(source.hash || source.sha256 || source.sourceHash, 180) || null,
    artifactType: compactText(source.artifactType || source.type, 80) || null,
    projectId: compactText(source.projectId, 180) || null,
    moduleId: compactText(source.moduleId, 180) || null,
    updatedAt: isoOrNull(source.updatedAt || source.modifiedAt),
    coldEvidencePointer: coldPointer,
    readBody: false,
  };
  if (coldPointer && !ref.id && !ref.hash && !ref.title) return null;
  if (!coldPointer && ![ref.id, ref.path, ref.uri, ref.hash, ref.title].some(Boolean)) return null;
  return ref;
}

function normalizeSourceRefs(input, limit = MAX_SOURCE_REFS) {
  const bySignature = new Map();
  let omittedUnsafeCount = 0;
  for (const value of boundedFlatten(safeArray(input))) {
    const normalized = normalizeSourceRef(value);
    if (!normalized) {
      if (value != null) omittedUnsafeCount += 1;
      continue;
    }
    const signature = sourceRefSignature(normalized);
    if (!bySignature.has(signature)) bySignature.set(signature, normalized);
  }
  const refs = Array.from(bySignature.values())
    .sort((left, right) => sourceRefSignature(left).localeCompare(sourceRefSignature(right)))
    .slice(0, limit);
  return { refs, omittedUnsafeCount };
}

function normalizeArtifactRef(input) {
  const source = typeof input === "string" ? { path: input } : input;
  if (!source || typeof source !== "object") return null;
  const ref = normalizeSourceRef({ ...source, kind: source.kind || "artifact" });
  if (!ref || ref.coldEvidencePointer) return null;
  return {
    artifactId: compactText(source.artifactId || source.id, 180) || deterministicId("artifact", ref, 16),
    artifactType: compactText(source.artifactType || source.type || ref.artifactType || "artifact", 80),
    title: compactText(source.title, 180) || null,
    path: ref.path,
    hash: ref.hash,
    projectId: compactText(source.projectId, 180) || null,
    moduleId: compactText(source.moduleId, 180) || null,
    sourceRef: ref,
  };
}

function normalizeArtifactRefs(input) {
  const byId = new Map();
  let omittedUnsafeCount = 0;
  for (const value of boundedFlatten(safeArray(input))) {
    const artifact = normalizeArtifactRef(value);
    if (!artifact) {
      if (value != null) omittedUnsafeCount += 1;
      continue;
    }
    if (!byId.has(artifact.artifactId)) byId.set(artifact.artifactId, artifact);
  }
  return {
    artifacts: Array.from(byId.values()).sort((left, right) => left.artifactId.localeCompare(right.artifactId)).slice(0, MAX_ARTIFACT_REFS),
    omittedUnsafeCount,
  };
}

function normalizeThreadRef(input) {
  const source = typeof input === "string" ? { threadId: input } : input;
  if (!source || typeof source !== "object") return null;
  const threadId = compactText(source.threadId || source.id, 180);
  if (!threadId) return null;
  return {
    threadId,
    title: compactText(source.title || source.threadTitle, 180) || null,
    role: compactText(source.role || source.threadRole, 60).toLowerCase() || null,
    status: compactText(source.status || source.state, 60).toLowerCase() || null,
  };
}

function normalizeThreadRefs(input) {
  const byId = new Map();
  for (const value of boundedFlatten(safeArray(input))) {
    const thread = normalizeThreadRef(value);
    if (thread && !byId.has(thread.threadId)) byId.set(thread.threadId, thread);
  }
  return Array.from(byId.values()).sort((left, right) => left.threadId.localeCompare(right.threadId)).slice(0, MAX_THREAD_REFS);
}

function normalizeFailures(input) {
  const failures = [];
  const seen = new Set();
  for (const value of boundedFlatten(safeArray(input))) {
    const source = typeof value === "string" ? { summary: value } : value;
    if (!source || typeof source !== "object") continue;
    const code = compactText(source.code || source.errorCode, 100) || null;
    const summary = compactText(source.summary || source.message || source.title || source.error, 360);
    if (!summary && !code) continue;
    const normalized = {
      failureId: compactText(source.failureId || source.id, 180) || deterministicId("failure", { code, summary }, 16),
      code,
      summary,
      status: compactText(source.status || source.state || "open", 60).toLowerCase(),
      fixedByEpisodeId: compactText(source.fixedByEpisodeId || source.fixEpisodeId, 180) || null,
    };
    if (!seen.has(normalized.failureId)) {
      seen.add(normalized.failureId);
      failures.push(normalized);
    }
  }
  return failures.sort((left, right) => left.failureId.localeCompare(right.failureId)).slice(0, MAX_TEXT_ITEMS);
}

function normalizeBlockers(input) {
  const blockers = [];
  const seen = new Set();
  for (const value of boundedFlatten(safeArray(input))) {
    const source = typeof value === "string" ? { summary: value } : value;
    if (!source || typeof source !== "object") continue;
    const summary = compactText(source.summary || source.message || source.title || source.value || source.blocker, 360);
    if (!summary) continue;
    const status = compactText(source.status || source.state || "open", 60).toLowerCase();
    const blockerId = compactText(source.blockerId || source.id, 180) || deterministicId("blocker", { summary, status }, 16);
    if (seen.has(blockerId)) continue;
    seen.add(blockerId);
    blockers.push({ blockerId, summary, status });
  }
  return blockers.sort((left, right) => left.blockerId.localeCompare(right.blockerId)).slice(0, MAX_TEXT_ITEMS);
}

function statusIsResolved(status) {
  return /^(?:resolved|fixed|closed|done|cleared|superseded|passed|complete|completed)$/i.test(compactText(status, 60));
}

function assessSemanticConsistency({ eventType, title, summary, outcome, status, result, decisions, blockerRecords, failures }) {
  const semanticItems = uniqueStrings([
    title,
    summary,
    outcome,
    status,
    result,
    decisions,
    blockerRecords.map((blocker) => [blocker.summary, blocker.status]),
    failures.map((failure) => [failure.summary, failure.status]),
  ], 64, 240);
  const signal = compactText(semanticItems.join(" "), 6000).normalize("NFKC").toLowerCase();
  const negativeSignal = /\bblocked\b|cannot[_ -]?proceed|can(?:not|'t)\s+proceed|\bfailed\b|\bfailure\b|\berror\b|\brejected\b|\brevise(?:d|ion)?\b/.test(signal);
  const openBlockerCount = blockerRecords.filter((blocker) => !statusIsResolved(blocker.status)).length;
  const openFailureCount = failures.filter((failure) => !statusIsResolved(failure.status)).length;
  const acceptedLike = eventType === "accepted";
  const successfulFix = eventType === "test_pass";
  const conflictCodes = [
    ...(acceptedLike && negativeSignal ? ["negative_semantic_signal"] : []),
    ...((acceptedLike || successfulFix) && openBlockerCount > 0 ? ["open_blocker_present"] : []),
    ...((acceptedLike || successfulFix) && openFailureCount > 0 ? ["open_failure_present"] : []),
  ];
  return {
    signal,
    negativeSignal,
    openBlockerCount,
    openFailureCount,
    conflictCodes,
    consistent: conflictCodes.length === 0,
  };
}

function normalizeAuthorityOutcomeDescriptor(input = {}) {
  const wrapper = input.authorityOutcome
    || input.verifiedAuthorityOutcome
    || input.authorityReceiptDescriptor
    || input.authority
    || {};
  const receipt = wrapper.receipt || wrapper.authorityReceipt || wrapper.decision || wrapper;
  return {
    receiptId: compactText(receipt.receiptId || receipt.decisionId || wrapper.verificationId, 180) || null,
    receiptProof: compactText(receipt.receiptProof || receipt.proof || wrapper.receiptProof || wrapper.proof, 240) || null,
    projectId: compactText(receipt.projectId || wrapper.projectId, 180) || null,
    moduleId: compactText(receipt.moduleId || wrapper.moduleId, 180) || null,
    action: normalizedKey(receipt.action || wrapper.action) || null,
    transition: normalizedKey(receipt.transition || wrapper.transition) || null,
    ruleId: compactText(receipt.ruleId || wrapper.ruleId || wrapper.existingRuleId, 180) || null,
  };
}

function optionDataValue(options, key) {
  if (!options || typeof options !== "object" || utilTypes.isProxy(options)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function reviewSignals(input) {
  const explicitSignal = [
    input.category,
    input.domain,
    input.intent,
    input.actionType,
    input.riskType,
    input.scope,
    ...safeArray(input.tags),
  ].map((value) => compactText(value, 120)).join(" ");
  return {
    heuristic: input.heuristic === true || input.reviewSignals?.heuristic === true || REVIEW_SIGNAL_RE.test(explicitSignal) && /heuristic|\u542f\u53d1\u5f0f/i.test(explicitSignal),
    crossProject: input.crossProject === true || input.reviewSignals?.crossProject === true || /cross[_ -]?project|\u8de8\u9879\u76ee/i.test(explicitSignal),
    userPreference: input.userPreference === true || input.reviewSignals?.userPreference === true || /user[_ -]?preference|preference|\u7528\u6237\u504f\u597d/i.test(explicitSignal),
    security: input.securitySensitive === true || input.reviewSignals?.security === true || /security|\u5b89\u5168/i.test(explicitSignal),
    archiveCompactRestore: input.archiveCompactRestore === true || input.reviewSignals?.archiveCompactRestore === true || /archive|compact|restore|\u5f52\u6863|\u538b\u7f29|\u6062\u590d/i.test(explicitSignal),
  };
}

function expectedAuthorityTransition(eventType, confirmsExistingStandingRule, existingRuleId) {
  if (confirmsExistingStandingRule) return `confirm_existing_rule:${normalizedKey(existingRuleId || "missing")}`;
  return `form:${normalizedKey(eventType || "unknown")}`;
}

function authorityTargetPayload(event) {
  return {
    explicitEventId: event.explicitEventId,
    eventType: event.eventType,
    projectId: event.projectId,
    moduleId: event.moduleId,
    moduleIds: event.moduleIds,
    title: event.title,
    summary: event.summary,
    outcome: event.outcome,
    before: event.before,
    after: event.after,
    result: event.result,
    why: event.why,
    failures: event.failures,
    nextActions: event.nextActions,
    acceptedProgress: event.acceptedProgress,
    openTasks: event.openTasks,
    blockers: event.blockers,
    blockerRecords: event.blockerRecords,
    decisions: event.decisions,
    constraints: event.constraints,
    corrections: event.corrections,
    entities: event.entities,
    cues: event.cues,
    phase: event.phase,
    artifacts: event.artifacts,
    threads: event.threads,
    sourceRefs: event.sourceRefs.map(sourceRefSignature),
    links: event.links,
    metrics: event.metrics,
    confirmsExistingStandingRule: event.confirmsExistingStandingRule,
    existingRuleId: event.existingRuleId,
    reviewSignals: event.reviewSignals,
    semanticConsistent: event.semanticConsistent,
    semanticSignal: event.semanticSignal,
    semanticConflictCodes: event.semanticConflictCodes,
    openBlockerCount: event.openBlockerCount,
    openFailureCount: event.openFailureCount,
    materialEvidencePresent: event.materialEvidencePresent,
    artifactScopeExact: event.artifactScopeExact,
    observedAt: event.explicitEventId ? event.observedAt : null,
  };
}

function verifyAuthorityClaim(claim, event, options) {
  const targetFingerprint = deterministicId("authority-target", authorityTargetPayload(event), 32);
  const expectedAction = AUTHORITY_ACTION;
  const expectedTransition = expectedAuthorityTransition(event.eventType, event.confirmsExistingStandingRule, event.existingRuleId);
  const request = deepFreeze({
    receiptId: claim.receiptId,
    receiptProof: claim.receiptProof,
    targetFingerprint,
    action: expectedAction,
    transition: expectedTransition,
    projectId: event.projectId,
    moduleId: event.moduleId,
    eventType: event.eventType,
    ruleId: event.confirmsExistingStandingRule ? event.existingRuleId : null,
  });
  const verifier = optionDataValue(options, "authorityVerifier");
  const reasons = [];
  if (typeof verifier !== "function") reasons.push("trusted_authority_verifier_required");
  if (!claim.receiptId) reasons.push("authority_receipt_id_required");
  if (!claim.receiptProof) reasons.push("authority_receipt_proof_required");
  if (claim.projectId !== event.projectId || claim.moduleId !== event.moduleId) reasons.push("authority_claim_scope_mismatch");
  if (claim.action !== expectedAction) reasons.push("authority_claim_action_mismatch");
  if (claim.transition !== expectedTransition) reasons.push("authority_claim_transition_mismatch");
  if (event.confirmsExistingStandingRule && claim.ruleId !== event.existingRuleId) reasons.push("standing_rule_receipt_binding_required");

  let result = null;
  if (typeof verifier === "function" && claim.receiptId && claim.receiptProof) {
    try {
      const candidate = verifier(request);
      if (candidate && typeof candidate.then === "function") reasons.push("synchronous_authority_verifier_required");
      else {
        const verifierPreflight = preflightMemoryFormationInput(candidate || {});
        if (!verifierPreflight.inspection.safe) reasons.push("unsafe_authority_verifier_result");
        else result = verifierPreflight.snapshot;
      }
    } catch {
      reasons.push("authority_verifier_error");
    }
  }

  const decision = normalizedKey(result?.decision || result?.outcome || result?.status) || "review";
  const riskLevel = normalizedKey(result?.riskLevel || result?.risk) || "unknown";
  const deterministic = result?.deterministic === true;
  const active = result?.active === true && result?.revoked !== true && result?.expired !== true;
  const claimExact = Boolean(claim.receiptId && claim.receiptProof)
    && claim.projectId === event.projectId
    && claim.moduleId === event.moduleId
    && claim.action === expectedAction
    && claim.transition === expectedTransition
    && (!event.confirmsExistingStandingRule || claim.ruleId === event.existingRuleId);
  const exact = claimExact && Boolean(result)
    && compactText(result.receiptId, 180) === claim.receiptId
    && compactText(result.receiptProof, 240) === claim.receiptProof
    && compactText(result.targetFingerprint || result.eventFingerprint, 180) === targetFingerprint
    && normalizedKey(result.action) === expectedAction
    && normalizedKey(result.transition) === expectedTransition
    && compactText(result.projectId, 180) === event.projectId
    && compactText(result.moduleId, 180) === event.moduleId
    && (!event.confirmsExistingStandingRule || compactText(result.ruleId, 180) === event.existingRuleId);
  if (result && !exact) reasons.push("authority_verifier_binding_mismatch");
  if (result && result.verified !== true) reasons.push("authority_verifier_unverified");
  if (result && !active) reasons.push("authority_receipt_inactive");
  if (result && result.allowed !== true) reasons.push("authority_outcome_not_allowed");
  if (result && decision !== "accepted") reasons.push("authority_decision_not_accepted");
  const verified = exact && result?.verified === true && active;
  const allowed = verified && result?.allowed === true && decision === "accepted";
  return {
    verified,
    allowed,
    active,
    decision,
    receiptId: claim.receiptId,
    receiptProof: claim.receiptProof,
    receiptProofHash: claim.receiptProof ? hashValue(claim.receiptProof) : null,
    decisionFingerprint: compactText(result?.decisionFingerprint, 180) || null,
    targetFingerprint,
    action: expectedAction,
    transition: expectedTransition,
    projectId: verified ? compactText(result.projectId, 180) : null,
    moduleId: verified ? compactText(result.moduleId, 180) : null,
    ruleId: event.confirmsExistingStandingRule ? event.existingRuleId : null,
    riskLevel,
    deterministic,
    verifierPresent: typeof verifier === "function",
    reasonCodes: Array.from(new Set(reasons)).sort(),
  };
}

function materialEvidencePresent(event) {
  const genericSummary = GENERIC_CHAT_RE.test(compactText(event.summary, 120));
  const hasTaskEvidence = event.openTasks.length > 0 || event.nextActions.length > 0 || event.acceptedProgress.length > 0 || event.blockers.length > 0;
  const hasDecisionEvidence = event.decisions.length > 0 || event.constraints.length > 0 || event.corrections.length > 0;
  const hasArtifactEvidence = event.artifacts.length > 0;
  const hasFailureEvidence = event.failures.length > 0 || event.links.failureEpisodeIds.length > 0 || event.links.fixEpisodeIds.length > 0;
  const hasStateEvidence = event.before.length > 0 || event.after.length > 0;
  const hasResultEvidence = event.result.length > 0;
  if (genericSummary && !hasTaskEvidence && !hasDecisionEvidence && !hasArtifactEvidence && !hasFailureEvidence && !hasStateEvidence) return false;
  if (event.eventType === "user_correction") return event.corrections.length > 0;
  if (event.eventType === "user_rule") return event.constraints.length > 0 || event.corrections.length > 0;
  if (event.eventType === "test_failure") return event.failures.length > 0 || event.blockers.length > 0;
  if (event.eventType === "test_pass") return hasResultEvidence && (hasFailureEvidence || hasArtifactEvidence || hasStateEvidence);
  if (["build", "install", "release"].includes(event.eventType)) return hasResultEvidence || hasArtifactEvidence;
  if (["handoff", "thread_recovery"].includes(event.eventType)) return event.threads.length > 0 && (hasTaskEvidence || hasArtifactEvidence);
  if (["revise", "block"].includes(event.eventType)) return hasTaskEvidence || hasDecisionEvidence || hasFailureEvidence;
  if (event.eventType === "checkpoint") return hasTaskEvidence || hasArtifactEvidence || hasStateEvidence || hasResultEvidence;
  return hasTaskEvidence || hasDecisionEvidence || hasArtifactEvidence || hasFailureEvidence || hasStateEvidence;
}

function normalizeMemoryFormationEvent(input = {}, options = {}) {
  const preflight = preflightMemoryFormationInput(input);
  const inspection = preflight.inspection;
  const source = preflight.snapshot && typeof preflight.snapshot === "object" ? preflight.snapshot : Object.create(null);
  const eventType = normalizeEventType(source.eventType || source.type);
  const projectId = compactText(source.projectId, 180) || null;
  const moduleId = compactText(source.moduleId, 180) || null;
  const expectedProjectId = compactText(optionDataValue(options, "projectId") || optionDataValue(options, "expectedProjectId"), 180) || null;
  const expectedModuleId = compactText(optionDataValue(options, "moduleId") || optionDataValue(options, "expectedModuleId"), 180) || null;
  const authorityClaim = normalizeAuthorityOutcomeDescriptor(source);
  const sourceResult = normalizeSourceRefs(source.sourceRefs || source.sourceRef);
  const sourceRefs = sourceResult.refs;
  const directSourceRefs = sourceRefs.filter((ref) => !ref.coldEvidencePointer);
  const sourceProjectScoped = directSourceRefs.length > 0 && directSourceRefs.every((ref) => ref.projectId === projectId);
  const sourceModuleScoped = directSourceRefs.length > 0 && directSourceRefs.every((ref) => ref.moduleId === moduleId);
  const artifactResult = normalizeArtifactRefs([source.artifactRefs, source.artifacts]);
  const foreignArtifacts = artifactResult.artifacts.filter((artifact) => (artifact.projectId && artifact.projectId !== projectId) || (artifact.moduleId && artifact.moduleId !== moduleId));
  const unscopedArtifacts = artifactResult.artifacts.filter((artifact) => !artifact.projectId || !artifact.moduleId);
  const artifacts = artifactResult.artifacts.filter((artifact) => artifact.projectId === projectId && artifact.moduleId === moduleId);
  const threads = normalizeThreadRefs([source.threadRefs, source.threads, source.threadIds, source.threadId]);
  const moduleIds = uniqueStrings([moduleId, source.moduleIds], 16, 180);
  const failures = normalizeFailures([source.failures, source.failure]);
  const blockerRecords = normalizeBlockers(source.blockers);
  const decisions = uniqueStrings([source.decisions, source.decision], MAX_TYPED_CANDIDATES, 500);
  const constraints = uniqueStrings([source.constraints, source.constraint, source.rules, source.rule], MAX_TYPED_CANDIDATES, 500);
  const corrections = uniqueStrings([source.correction, source.corrections], MAX_TYPED_CANDIDATES, 500);
  const confirmsExistingStandingRule = source.confirmsExistingStandingRule === true || source.standingRuleRepeat === true;
  const existingRuleId = compactText(source.existingRuleId || source.ruleId, 180) || null;
  const title = compactText(source.title || `${eventType || "unknown"} event`, 180);
  const summary = compactText(source.summary || source.outcome || source.result, 600);
  const outcome = compactText(source.outcome || source.status || eventType, 120).toLowerCase();
  const result = uniqueStrings(source.result, MAX_TEXT_ITEMS, 500);
  const blockers = uniqueStrings(blockerRecords.map((blocker) => blocker.summary), MAX_TEXT_ITEMS, 360);
  const semanticAssessment = assessSemanticConsistency({
    eventType,
    title,
    summary,
    outcome,
    status: compactText(source.status, 120).toLowerCase(),
    result,
    decisions,
    blockerRecords,
    failures,
  });
  const semanticConsistent = semanticAssessment.consistent;
  const observedAt = isoOrNull(source.observedAt || source.occurredAt || source.createdAt) || EPOCH;
  const reviewSignalValues = reviewSignals(source);
  const baseEvent = {
    schemaVersion: MEMORY_FORMATION_EVENT_SCHEMA,
    explicitEventId: compactText(source.explicitEventId || source.eventId || source.id || source.sourceEventId, 180) || null,
    eventType,
    projectId,
    moduleId,
    moduleIds,
    title,
    summary,
    outcome,
    before: uniqueStrings(source.before, MAX_TEXT_ITEMS, 360),
    after: uniqueStrings(source.after, MAX_TEXT_ITEMS, 360),
    result,
    why: uniqueStrings([source.why, source.reason, source.reasons], MAX_TEXT_ITEMS, 500),
    failures,
    nextActions: uniqueStrings([source.nextActions, source.nextAction], MAX_TEXT_ITEMS, 360),
    acceptedProgress: uniqueStrings(source.acceptedProgress, MAX_TEXT_ITEMS, 360),
    openTasks: uniqueStrings([source.openTasks, source.tasks], MAX_TEXT_ITEMS, 360),
    blockers,
    blockerRecords,
    decisions,
    constraints,
    corrections,
    entities: uniqueStrings(source.entities, MAX_TEXT_ITEMS, 160),
    cues: uniqueStrings([source.cues, source.errorCodes, failures.map((failure) => failure.code)], MAX_TEXT_ITEMS, 160),
    phase: compactText(source.phase || source.currentPhase, 120) || null,
    artifacts,
    threads,
    sourceRefs,
    coldEvidencePointers: sourceRefs.filter((ref) => ref.coldEvidencePointer),
    links: {
      beforeEpisodeIds: uniqueStrings([source.beforeEpisodeIds, source.links?.beforeEpisodeIds], MAX_RELATIONS, 180),
      afterEpisodeIds: uniqueStrings([source.afterEpisodeIds, source.links?.afterEpisodeIds], MAX_RELATIONS, 180),
      failureEpisodeIds: uniqueStrings([source.failureEpisodeIds, source.fixesEpisodeIds, source.fixes, source.links?.failureEpisodeIds], MAX_RELATIONS, 180),
      fixEpisodeIds: uniqueStrings([source.fixEpisodeIds, source.fixedByEpisodeIds, source.fixedBy, source.links?.fixEpisodeIds], MAX_RELATIONS, 180),
      causedByEpisodeIds: uniqueStrings([source.causedByEpisodeIds, source.links?.causedByEpisodeIds], MAX_RELATIONS, 180),
      relatedEpisodeIds: uniqueStrings([source.relatedEpisodeIds, source.links?.relatedEpisodeIds], MAX_RELATIONS, 180),
    },
    metrics: {
      reuseCount: clampInteger(source.reuseCount ?? source.metrics?.reuseCount),
      reuseScore: clampNumber(source.reuseScore ?? source.metrics?.reuseScore, 0, 0, 1),
      compoundCount: clampInteger(source.compoundCount ?? source.metrics?.compoundCount),
      compoundScore: clampNumber(source.compoundScore ?? source.metrics?.compoundScore, 0, 0, 1),
      recurrenceCount: clampInteger(source.recurrenceCount ?? source.metrics?.recurrenceCount),
    },
    confirmsExistingStandingRule,
    existingRuleId,
    reviewSignals: reviewSignalValues,
    semanticConsistent,
    semanticSignal: semanticAssessment.signal,
    semanticConflictCodes: semanticAssessment.conflictCodes,
    openBlockerCount: semanticAssessment.openBlockerCount,
    openFailureCount: semanticAssessment.openFailureCount,
    materialEvidencePresent: false,
    artifactScopeExact: foreignArtifacts.length === 0 && unscopedArtifacts.length === 0 && artifactResult.omittedUnsafeCount === 0,
    observedAt,
  };
  baseEvent.materialEvidencePresent = materialEvidencePresent(baseEvent);
  const authority = inspection.safe ? verifyAuthorityClaim(authorityClaim, baseEvent, options) : verifyAuthorityClaim(authorityClaim, baseEvent, {});
  const reasons = [...inspection.reasonCodes];
  if (!eventType) reasons.push("explicit_supported_event_type_required");
  if (!projectId) reasons.push("explicit_project_id_required");
  if (!moduleId) reasons.push("explicit_module_id_required");
  if (expectedProjectId && projectId && projectId !== expectedProjectId) reasons.push("foreign_project_scope");
  if (expectedModuleId && moduleId && moduleId !== expectedModuleId) reasons.push("foreign_module_scope");
  if (sourceRefs.some((ref) => ref.projectId && ref.projectId !== projectId)) reasons.push("foreign_source_project_scope");
  if (sourceRefs.some((ref) => ref.moduleId && ref.moduleId !== moduleId)) reasons.push("foreign_source_module_scope");
  if (sourceRefs.length > 0 && !sourceProjectScoped) reasons.push("source_project_id_required");
  if (sourceRefs.length > 0 && !sourceModuleScoped) reasons.push("source_module_id_required");
  if (foreignArtifacts.length > 0) reasons.push("foreign_artifact_scope");
  if (unscopedArtifacts.length > 0) reasons.push("artifact_project_module_scope_required");
  if (!baseEvent.materialEvidencePresent) reasons.push("material_event_evidence_required");
  if (directSourceRefs.length === 0) reasons.push("material_source_required");
  if (!semanticConsistent) reasons.push("accepted_event_semantic_conflict");
  if (confirmsExistingStandingRule && !existingRuleId) reasons.push("existing_rule_id_required");
  if (sourceResult.omittedUnsafeCount > 0) reasons.push("unsafe_source_ref_rejected");
  if (artifactResult.omittedUnsafeCount > 0) reasons.push("unsafe_artifact_ref_rejected");
  reasons.push(...authority.reasonCodes);

  const hardRejectReasons = reasons.filter((reason) =>
    reason.startsWith("unsafe_")
    || reason === "destructive_host_intent_forbidden"
    || reason === "explicit_supported_event_type_required"
    || reason === "explicit_project_id_required"
    || reason === "explicit_module_id_required"
    || reason === "foreign_project_scope"
    || reason === "foreign_module_scope"
    || reason === "foreign_source_project_scope"
    || reason === "foreign_source_module_scope"
    || reason === "foreign_artifact_scope"
    || reason === "material_event_evidence_required"
  );
  const normalized = {
    ...baseEvent,
    authority,
    authorityScopeExact: authority.verified && authority.projectId === projectId && authority.moduleId === moduleId,
    sourceScopeExact: sourceProjectScoped && sourceModuleScoped,
    riskLevel: authority.riskLevel,
    deterministic: authority.deterministic,
    standingRuleRepeat: confirmsExistingStandingRule && Boolean(existingRuleId) && authority.ruleId === existingRuleId && authority.transition === expectedAuthorityTransition(eventType, true, existingRuleId),
    safe: hardRejectReasons.length === 0,
    reasonCodes: Array.from(new Set(reasons)).sort(),
  };
  return deepFreeze(normalized);
}

function eventFingerprintPayload(event) {
  return {
    ...authorityTargetPayload(event),
    authorityVerified: event.authority.verified,
    authorityAllowed: event.authority.allowed,
    authorityActive: event.authority.active,
    authorityDecision: event.authority.decision,
    authorityReceiptId: event.authority.receiptId,
    authorityReceiptProof: event.authority.receiptProof,
    authorityReceiptProofHash: event.authority.receiptProofHash,
    authorityDecisionFingerprint: event.authority.decisionFingerprint,
    authorityTargetFingerprint: event.authority.targetFingerprint,
    authorityAction: event.authority.action,
    authorityTransition: event.authority.transition,
    authorityRiskLevel: event.authority.riskLevel,
    authorityDeterministic: event.authority.deterministic,
    authorityReasonCodes: event.authority.reasonCodes,
    authorityScopeExact: event.authorityScopeExact,
    sourceScopeExact: event.sourceScopeExact,
  };
}

function stableEventFingerprint(input, options = {}) {
  const event = normalizeMemoryFormationEvent(input, options);
  return fingerprintNormalizedEvent(event);
}

function fingerprintNormalizedEvent(event) {
  return deterministicId("event-fingerprint", eventFingerprintPayload(event), 32);
}

function formationDisposition(event) {
  if (!event.safe) return { status: "rejected", reasonCodes: event.reasonCodes };
  const sourceBacked = event.sourceRefs.length > 0;
  const reviewOnlySignal = Object.values(event.reviewSignals).some(Boolean);
  const accepted = sourceBacked
    && event.authority.verified
    && event.authority.allowed
    && Boolean(event.authority.receiptId)
    && event.authorityScopeExact
    && event.sourceScopeExact
    && event.artifactScopeExact
    && event.riskLevel === "low"
    && event.deterministic
    && event.semanticConsistent
    && event.materialEvidencePresent
    && (!event.confirmsExistingStandingRule || event.standingRuleRepeat)
    && !reviewOnlySignal;
  const reasonCodes = [];
  if (!sourceBacked) reasonCodes.push("missing_source_refs_candidate_only");
  if (!event.authority.verified) reasonCodes.push("verified_authority_outcome_required");
  if (!event.authority.allowed) reasonCodes.push("authority_outcome_not_accepted");
  if (!event.authority.receiptId) reasonCodes.push("authority_receipt_id_required");
  if (!event.authorityScopeExact) reasonCodes.push("explicit_authority_project_module_scope_required");
  if (sourceBacked && !event.sourceScopeExact) reasonCodes.push("explicit_source_project_module_scope_required");
  if (!event.artifactScopeExact) reasonCodes.push("explicit_artifact_project_module_scope_required");
  if (event.riskLevel !== "low") reasonCodes.push("low_risk_outcome_required");
  if (!event.deterministic) reasonCodes.push("deterministic_outcome_required");
  if (!event.semanticConsistent) reasonCodes.push("accepted_event_semantic_conflict");
  if (!event.materialEvidencePresent) reasonCodes.push("material_event_evidence_required");
  if (event.confirmsExistingStandingRule && !event.standingRuleRepeat) reasonCodes.push("standing_rule_receipt_binding_required");
  for (const [key, active] of Object.entries(event.reviewSignals)) if (active) reasonCodes.push(`${key}_requires_review`);
  return {
    status: accepted ? "accepted" : "review",
    reasonCodes: Array.from(new Set(reasonCodes)).sort(),
  };
}

function episodeImportance(eventType) {
  if (["block", "test_failure", "thread_recovery", "release"].includes(eventType)) return 0.9;
  if (["accepted", "checkpoint", "handoff", "user_correction", "user_rule"].includes(eventType)) return 0.8;
  return 0.7;
}

function buildEpisodeMemory(event, disposition, fingerprint) {
  const episodeId = deterministicId("episode", { fingerprint }, 20);
  return {
    schemaVersion: EPISODE_MEMORY_SCHEMA,
    episodeId,
    eventFingerprint: fingerprint,
    projectId: event.projectId,
    moduleId: event.moduleId,
    moduleIds: event.moduleIds,
    eventType: event.eventType,
    title: event.title,
    summary: event.summary,
    outcome: event.outcome,
    before: event.before,
    after: event.after,
    result: event.result,
    why: event.why,
    failures: event.failures,
    nextActions: event.nextActions,
    entities: event.entities,
    cues: event.cues,
    threadIds: event.threads.map((thread) => thread.threadId),
    threadRefs: event.threads,
    artifactRefs: event.artifacts,
    sourceRefs: event.sourceRefs,
    coldEvidencePointers: event.coldEvidencePointers,
    decisionIds: [],
    constraintIds: [],
    relationIds: [],
    importance: episodeImportance(event.eventType),
    status: disposition.status,
    authorityReceiptId: event.authority.receiptId,
    sourceBacked: event.sourceRefs.length > 0,
    deterministic: event.deterministic,
    riskLevel: event.riskLevel,
    reviewRequired: disposition.status !== "accepted",
    reviewReasonCodes: disposition.reasonCodes,
    observedAt: event.observedAt,
    metrics: event.metrics,
    safety: {
      compactMetadataOnly: true,
      rawSessionBodyRead: false,
      coldEvidencePointerOnly: true,
      hostEffectsAllowed: false,
    },
  };
}

function typedCandidateStatus(disposition) {
  return {
    status: "candidate",
    recommendedStatus: disposition.status,
    requiresReview: disposition.status !== "accepted",
  };
}

function buildDecisionCandidates(event, episode, disposition) {
  return event.decisions.slice(0, MAX_TYPED_CANDIDATES).map((statement) => {
    const decisionId = deterministicId("decision", {
      projectId: event.projectId,
      moduleId: event.moduleId,
      episodeId: episode.episodeId,
      statement: normalizedKey(statement),
    }, 20);
    return {
      schemaVersion: DECISION_CANDIDATE_SCHEMA,
      decisionId,
      projectId: event.projectId,
      moduleId: event.moduleId,
      episodeId: episode.episodeId,
      statement,
      rationale: event.why,
      outcome: event.outcome,
      sourceRefs: event.sourceRefs.slice(0, MAX_CANDIDATE_SOURCE_REFS),
      authorityReceiptId: event.authority.receiptId,
      observedAt: event.observedAt,
      ...typedCandidateStatus(disposition),
    };
  }).sort((left, right) => left.decisionId.localeCompare(right.decisionId));
}

function buildConstraintCandidates(event, episode, disposition) {
  const entries = [
    ...event.constraints.map((statement) => ({ statement, constraintType: event.eventType === "user_rule" ? "standing_rule" : "constraint" })),
    ...event.corrections.map((statement) => ({ statement, constraintType: "user_correction" })),
  ];
  const byKey = new Map();
  for (const entry of entries) {
    const key = `${entry.constraintType}|${normalizedKey(entry.statement)}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return Array.from(byKey.values()).slice(0, MAX_TYPED_CANDIDATES).map((entry) => {
    const constraintId = deterministicId("constraint", {
      projectId: event.projectId,
      moduleId: event.moduleId,
      episodeId: episode.episodeId,
      constraintType: entry.constraintType,
      statement: normalizedKey(entry.statement),
    }, 20);
    return {
      schemaVersion: CONSTRAINT_CANDIDATE_SCHEMA,
      constraintId,
      projectId: event.projectId,
      moduleId: event.moduleId,
      episodeId: episode.episodeId,
      constraintType: entry.constraintType,
      statement: entry.statement,
      why: event.why,
      sourceRefs: event.sourceRefs.slice(0, MAX_CANDIDATE_SOURCE_REFS),
      authorityReceiptId: event.authority.receiptId,
      ownerApprovalRequired: ["standing_rule", "user_correction"].includes(entry.constraintType),
      observedAt: event.observedAt,
      ...typedCandidateStatus(disposition),
    };
  }).sort((left, right) => left.constraintId.localeCompare(right.constraintId));
}

function relationCandidate(type, fromEpisodeId, toEpisodeId, event) {
  const relationId = deterministicId("relation", { type, fromEpisodeId, toEpisodeId, projectId: event.projectId }, 20);
  return {
    schemaVersion: RELATION_CANDIDATE_SCHEMA,
    relationId,
    relationType: type,
    projectId: event.projectId,
    moduleId: event.moduleId,
    fromEpisodeId,
    toEpisodeId,
    sourceRefs: event.sourceRefs.slice(0, MAX_RELATION_SOURCE_REFS),
    status: "candidate",
  };
}

function buildRelationCandidates(event, episode) {
  const relations = [];
  for (const id of event.links.beforeEpisodeIds) relations.push(relationCandidate("before", id, episode.episodeId, event));
  for (const id of event.links.afterEpisodeIds) relations.push(relationCandidate("before", episode.episodeId, id, event));
  for (const id of event.links.failureEpisodeIds) relations.push(relationCandidate("fixed_by", id, episode.episodeId, event));
  for (const id of event.links.fixEpisodeIds) relations.push(relationCandidate("fixed_by", episode.episodeId, id, event));
  for (const id of event.links.causedByEpisodeIds) relations.push(relationCandidate("caused_by", episode.episodeId, id, event));
  for (const id of event.links.relatedEpisodeIds) relations.push(relationCandidate("related_to", episode.episodeId, id, event));
  const byId = new Map(relations.map((relation) => [relation.relationId, relation]));
  return Array.from(byId.values()).sort((left, right) => left.relationId.localeCompare(right.relationId)).slice(0, MAX_RELATIONS);
}

function childRecord(title, event, disposition, idPrefix) {
  return {
    id: deterministicId(idPrefix, { projectId: event.projectId, moduleId: event.moduleId, title: normalizedKey(title) }, 16),
    title,
    projectId: event.projectId,
    moduleId: event.moduleId,
    authorityStatus: disposition.status,
    status: "open",
    sourceRefs: event.sourceRefs.slice(0, MAX_CANDIDATE_SOURCE_REFS),
    observedAt: event.observedAt,
  };
}

function buildCheckpointCandidate(event, episode, disposition) {
  if (!CHECKPOINT_EVENT_TYPES.has(event.eventType)) return null;
  const progressValues = uniqueStrings([
    event.acceptedProgress,
    disposition.status === "accepted" && ["accepted", "test_pass", "build", "install", "release"].includes(event.eventType)
      ? [event.result, event.after, event.summary]
      : [],
  ], MAX_TEXT_ITEMS, 360);
  const blockerValues = uniqueStrings([
    event.blockers,
    ["block", "test_failure"].includes(event.eventType) ? event.failures.map((failure) => failure.summary || failure.code) : [],
  ], MAX_TEXT_ITEMS, 360);
  const checkpoint = buildProjectCheckpoint({
    eventId: episode.episodeId,
    projectId: event.projectId,
    phase: event.phase,
    moduleIds: event.moduleIds,
    acceptedProgress: progressValues.map((title) => childRecord(title, event, disposition, "progress")),
    taskStates: event.openTasks.map((title) => childRecord(title, event, disposition, "task")),
    blockers: blockerValues.map((title) => childRecord(title, event, disposition, "blocker")),
    nextActions: event.nextActions.map((title) => childRecord(title, event, disposition, "action")),
    threadLineage: event.threads.map((thread) => thread.threadId),
    canonicalDocRefs: event.artifacts.map((artifact) => artifact.sourceRef),
    authorityStatus: disposition.status,
    sourceRefs: event.sourceRefs.slice(0, MAX_CANDIDATE_SOURCE_REFS),
    observedAt: event.observedAt,
  }, { projectId: event.projectId, now: event.observedAt });
  return {
    ...checkpoint,
    candidateStatus: "candidate",
    recommendedStatus: disposition.status,
    episodeId: episode.episodeId,
  };
}

function continuityItem(slot, summary, type, event, disposition, episode, extra = {}) {
  const value = compactText(summary, 420);
  if (!value) return null;
  return {
    itemId: deterministicId("continuity-item", {
      slot,
      projectId: event.projectId,
      moduleId: event.moduleId,
      episodeId: episode.episodeId,
      value: normalizedKey(value),
    }, 18),
    slot,
    type,
    summary: value,
    projectId: event.projectId,
    moduleId: event.moduleId,
    episodeId: episode.episodeId,
    authorityStatus: disposition.status,
    sourceRefs: event.sourceRefs.slice(0, MAX_RELATION_SOURCE_REFS),
    observedAt: event.observedAt,
    ...extra,
  };
}

function buildContinuityPatchCandidate(event, episode, disposition, checkpointCandidate, constraintCandidates) {
  const slotItems = new Map();
  const add = (slot, values, type, extra = {}) => {
    if (!PROJECT_CONTINUITY_SLOTS.includes(slot)) return;
    const current = slotItems.get(slot) || [];
    for (const value of uniqueStrings(values, MAX_TEXT_ITEMS, 420)) {
      const item = continuityItem(slot, value, type, event, disposition, episode, extra);
      if (item) current.push(item);
    }
    slotItems.set(slot, current);
  };

  add("active_modules", event.moduleIds, "module");
  if (event.phase) add("current_phase", event.phase, "phase");
  if (disposition.status === "accepted" && ["accepted", "checkpoint", "test_pass", "build", "install", "release"].includes(event.eventType)) {
    add("accepted_progress", [event.acceptedProgress, event.result, event.after, event.summary], "episode_progress");
  }
  add("open_tasks", event.openTasks, "task", { noDecay: true });
  add("open_blockers", [event.blockers, ["block", "test_failure"].includes(event.eventType) ? event.failures.map((failure) => failure.summary || failure.code) : []], "blocker");
  if (["revise", "block", "test_failure"].includes(event.eventType) || event.failures.length > 0) {
    add("latest_failures", [event.failures.map((failure) => failure.summary || failure.code), event.eventType === "revise" ? event.summary : []], "episode_failure");
  }
  add("next_actions", event.nextActions, "action", { noDecay: true });
  add("thread_lineage", event.threads.map((thread) => thread.threadId), "thread");
  add("canonical_docs", event.artifacts.map((artifact) => artifact.title || artifact.path || artifact.artifactId), "artifact");
  if (["user_rule", "user_correction"].includes(event.eventType)) {
    add("standing_rules", constraintCandidates.map((constraint) => constraint.statement), "constraint_candidate", { requiresOwnerApproval: true });
  }
  if (checkpointCandidate && disposition.status === "accepted") {
    add("last_valid_checkpoint", checkpointCandidate.checkpointId, "checkpoint");
  }

  const touchedSlots = PROJECT_CONTINUITY_SLOTS.filter((slot) => (slotItems.get(slot) || []).length > 0);
  const slots = {};
  const slotUpdates = [];
  for (const slot of touchedSlots) {
    const byId = new Map((slotItems.get(slot) || []).map((item) => [item.itemId, item]));
    const items = Array.from(byId.values()).sort((left, right) => left.itemId.localeCompare(right.itemId)).slice(0, MAX_TEXT_ITEMS);
    slots[slot] = { operation: "upsert_candidate", items };
    slotUpdates.push({ slot, operation: "upsert_candidate", items });
  }
  return {
    schemaVersion: CONTINUITY_PATCH_SCHEMA,
    patchId: deterministicId("continuity-patch", { episodeId: episode.episodeId, touchedSlots }, 20),
    projectId: event.projectId,
    moduleId: event.moduleId,
    episodeId: episode.episodeId,
    status: "candidate",
    recommendedStatus: disposition.status,
    exactSlotContract: PROJECT_CONTINUITY_SLOTS,
    touchedSlots,
    slots,
    slotUpdates,
    sourceRefs: event.sourceRefs.slice(0, 12),
    authorityReceiptId: event.authority.receiptId,
    effects: {
      appliesPatch: false,
      mutatesProjectBrain: false,
      writesStore: false,
    },
  };
}

function rejectedPlan(event) {
  const fingerprint = fingerprintNormalizedEvent(event);
  return deepFreeze({
    schemaVersion: MEMORY_FORMATION_SCHEMA,
    planId: deterministicId("formation-plan", { fingerprint, status: "rejected" }, 20),
    eventFingerprint: fingerprint,
    idempotencyKey: `memory-formation:${fingerprint}`,
    status: "rejected",
    accepted: false,
    event,
    episode: null,
    episodeMemory: null,
    decisionCandidates: [],
    constraintCandidates: [],
    relationCandidates: [],
    checkpointCandidate: null,
    continuityPatchCandidate: null,
    upserts: [],
    reasonCodes: event.reasonCodes,
    warnings: [],
    effects: noHostEffects(),
  });
}

function noHostEffects() {
  return {
    readsFiles: false,
    scansFiles: false,
    usesModel: false,
    startsTimer: false,
    writesStore: false,
    mutatesMemory: false,
    mutatesProjectBrain: false,
    executesHostAction: false,
    archiveCompactDeleteMoveRestore: false,
    installsOrExecutes: false,
    publishesOrReleases: false,
    readsRawSessionBody: false,
  };
}

function buildMemoryFormationPlan(input = {}, options = {}) {
  const event = normalizeMemoryFormationEvent(input, options);
  if (!event.safe) return rejectedPlan(event);
  const fingerprint = fingerprintNormalizedEvent(event);
  const disposition = formationDisposition(event);
  const episode = buildEpisodeMemory(event, disposition, fingerprint);
  const decisionCandidates = buildDecisionCandidates(event, episode, disposition);
  const constraintCandidates = buildConstraintCandidates(event, episode, disposition);
  const relationCandidates = buildRelationCandidates(event, episode);
  const checkpointCandidate = buildCheckpointCandidate(event, episode, disposition);
  const continuityPatchCandidate = buildContinuityPatchCandidate(
    event,
    episode,
    disposition,
    checkpointCandidate,
    constraintCandidates,
  );
  const linkedEpisode = {
    ...episode,
    decisionIds: decisionCandidates.map((candidate) => candidate.decisionId),
    constraintIds: constraintCandidates.map((candidate) => candidate.constraintId),
    relationIds: relationCandidates.map((candidate) => candidate.relationId),
  };
  const upserts = [
    { kind: "episode", id: linkedEpisode.episodeId, idempotencyKey: `episode:${linkedEpisode.episodeId}`, recordFingerprint: hashValue(stableStringify(linkedEpisode)) },
    ...decisionCandidates.map((record) => ({ kind: "decision_candidate", id: record.decisionId, idempotencyKey: `decision:${record.decisionId}`, recordFingerprint: hashValue(stableStringify(record)) })),
    ...constraintCandidates.map((record) => ({ kind: "constraint_candidate", id: record.constraintId, idempotencyKey: `constraint:${record.constraintId}`, recordFingerprint: hashValue(stableStringify(record)) })),
    ...relationCandidates.map((record) => ({ kind: "relation_candidate", id: record.relationId, idempotencyKey: `relation:${record.relationId}`, recordFingerprint: hashValue(stableStringify(record)) })),
    ...(checkpointCandidate ? [{ kind: "checkpoint_candidate", id: checkpointCandidate.checkpointId, idempotencyKey: `checkpoint:${checkpointCandidate.checkpointId}`, recordFingerprint: hashValue(stableStringify(checkpointCandidate)) }] : []),
    { kind: "continuity_patch_candidate", id: continuityPatchCandidate.patchId, idempotencyKey: `continuity:${continuityPatchCandidate.patchId}`, recordFingerprint: hashValue(stableStringify(continuityPatchCandidate)) },
  ].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  const warnings = [
    ...(event.sourceRefs.length === 0 ? ["missing_source_refs_candidate_only"] : []),
    ...(event.coldEvidencePointers.length > 0 ? ["cold_evidence_pointer_only"] : []),
  ];
  return deepFreeze({
    schemaVersion: MEMORY_FORMATION_SCHEMA,
    planId: deterministicId("formation-plan", { fingerprint, status: disposition.status }, 20),
    eventFingerprint: fingerprint,
    idempotencyKey: `memory-formation:${fingerprint}`,
    status: disposition.status,
    accepted: disposition.status === "accepted",
    event,
    episode: linkedEpisode,
    episodeMemory: linkedEpisode,
    decisionCandidates,
    constraintCandidates,
    relationCandidates,
    checkpointCandidate,
    continuityPatchCandidate,
    upserts,
    reasonCodes: disposition.reasonCodes,
    warnings,
    metrics: event.metrics,
    bounds: {
      maxSourceRefs: MAX_SOURCE_REFS,
      maxTextItems: MAX_TEXT_ITEMS,
      maxTypedCandidates: MAX_TYPED_CANDIDATES,
      maxRelations: MAX_RELATIONS,
      maxCandidateSourceRefs: MAX_CANDIDATE_SOURCE_REFS,
      maxRelationSourceRefs: MAX_RELATION_SOURCE_REFS,
    },
    effects: noHostEffects(),
  });
}

const buildFormationPlan = buildMemoryFormationPlan;
const formMemoryEvent = buildMemoryFormationPlan;
const formEvent = buildMemoryFormationPlan;
const normalizeFormationEvent = normalizeMemoryFormationEvent;

module.exports = {
  CONSTRAINT_CANDIDATE_SCHEMA,
  CONTINUITY_PATCH_SCHEMA,
  DECISION_CANDIDATE_SCHEMA,
  EPISODE_MEMORY_SCHEMA,
  EVENT_TYPE_ALIASES,
  MEMORY_FORMATION_EVENT_SCHEMA,
  MEMORY_FORMATION_SCHEMA,
  RELATION_CANDIDATE_SCHEMA,
  SUPPORTED_EVENT_TYPES,
  buildContinuityPatchCandidate,
  buildFormationPlan,
  buildMemoryFormationPlan,
  formEvent,
  formMemoryEvent,
  inspectMemoryFormationInput,
  normalizeAuthorityOutcomeDescriptor,
  normalizeFormationEvent,
  normalizeMemoryFormationEvent,
  normalizeSourceRefs,
  stableEventFingerprint,
};
