const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MEMORY_RUNTIME_SCHEMA_VERSION = 1;
const MEMORY_RUNTIME_STORAGE_SCHEMA = "zhixia.memory_runtime_store.v1";
const DEFAULT_RUNTIME_ALLOWED_KINDS = [
  "project_record",
  "project_resume_packet",
  "ceo_flow_record",
  "thread_lineage_index",
  "runtime_event",
  "project_artifact",
  "knowledge_item",
  "experience_card",
  "skill_candidate",
  "tool_skill_record",
];
const DEFAULT_PRECEDENT_ALLOWED_KINDS = [
  "knowledge_item",
  "experience_card",
  "project_artifact",
  "tool_skill_record",
  "skill_candidate",
  "thread_lineage_index",
];
const MEMORY_ROUTER_TASK_TYPES = [
  "project_resume",
  "task_dispatch",
  "review_gate",
  "bug_repair",
  "architecture",
  "release",
  "thread_recovery",
  "archive_candidate",
  "runtime_diagnosis",
  "tool_skill_lookup",
  "workflow_reuse",
  "handoff",
  "memory_writeback",
  "retrieve_precedent",
];
const MEMORY_ROUTER_KIND_PROFILES = {
  project_resume: ["runtime_event", "project_record", "project_resume_packet", "ceo_flow_record", "thread_lineage_index", "project_artifact", "knowledge_item", "experience_card"],
  task_dispatch: ["runtime_event", "project_record", "project_resume_packet", "ceo_flow_record", "project_artifact", "knowledge_item", "experience_card", "tool_skill_record", "skill_candidate"],
  review_gate: ["project_record", "project_resume_packet", "ceo_flow_record", "project_artifact", "knowledge_item", "experience_card", "tool_skill_record"],
  bug_repair: ["experience_card", "knowledge_item", "project_artifact", "tool_skill_record", "project_record"],
  architecture: ["project_record", "project_resume_packet", "project_artifact", "knowledge_item", "experience_card", "tool_skill_record"],
  release: ["project_record", "project_resume_packet", "project_artifact", "experience_card", "tool_skill_record", "knowledge_item"],
  thread_recovery: ["runtime_event", "thread_lineage_index", "ceo_flow_record", "project_record", "project_resume_packet", "experience_card", "knowledge_item", "project_artifact"],
  archive_candidate: ["thread_lineage_index", "ceo_flow_record", "experience_card", "knowledge_item", "project_artifact", "project_record"],
  runtime_diagnosis: ["runtime_event", "experience_card", "tool_skill_record", "project_artifact", "knowledge_item", "project_record"],
  tool_skill_lookup: ["tool_skill_record", "skill_candidate", "experience_card", "knowledge_item", "project_artifact"],
  workflow_reuse: ["experience_card", "skill_candidate", "tool_skill_record", "knowledge_item", "project_artifact"],
  handoff: ["runtime_event", "project_record", "project_resume_packet", "ceo_flow_record", "thread_lineage_index", "experience_card", "knowledge_item"],
  memory_writeback: ["runtime_event", "project_record", "experience_card", "knowledge_item", "project_artifact", "thread_lineage_index"],
  retrieve_precedent: DEFAULT_PRECEDENT_ALLOWED_KINDS,
};
const MEMORY_ROUTER_DEFAULT_TTL_MS = 90 * 1000;
const MEMORY_ROUTER_DEFAULT_TIME_BUDGET_MS = 250;
const COLD_MEMORY_QUERY_TYPES = new Set(["thread_recovery", "archive_candidate"]);
const MAINTENANCE_MEMORY_RE = /\b(guardian inventory|thread history vault|archive queue|archive bridge|old thread|thread slimming|thread recovery|runtime monitor|bounded read-only|neutral reviewer)\b|老线程优化|一键安全减负|归档|瘦身|线程审计|审计线程|维护线程|只读审计|只读.*CEO/i;
const THREAD_RECOVERY_PACKET_SCHEMA = "zhixia.thread_recovery_packet.v1";
const RUNTIME_EVENT_SCHEMA = "zhixia.runtime_event_memory.v1";
const MAX_RECOVERY_RECOMMENDED_DOC_BYTES = 768 * 1024;
const WORKING_MEMORY_STATUSES = ["active", "waiting_review", "blocked", "accepted", "superseded"];
const RUNTIME_EVENT_TYPES = [
  "broken_thread",
  "heartbeat_fuse",
  "thread_takeover",
  "stale_lane_reference",
  "task_checkpoint",
  "user_rule_update",
  "runtime_diagnosis",
];
const RUNTIME_EVENT_SEVERITIES = ["info", "warning", "error", "critical"];
const WRITEBACK_DECISIONS = ["accept", "revise", "block", "supersede"];
const SAFE_MEMORY_TARGETS = ["knowledge_item", "experience_card", "memory_card", "project_update", "lineage_update", "flowskill_candidate"];
const DANGEROUS_ACTION_RE = /\b(archive|compact|delete|move|restore|install|enable|execute|publish|export_public|host_archive|set_thread_archived)\b/i;
const RAW_SESSION_KIND_RE = /\b(raw[_ -]?session|codex[_ -]?session|thread[_ -]?session|session[_ -]?jsonl)\b/i;
const RAW_SESSION_PATH_RE = /(?:^|[\\/])\.codex[\\/]sessions[\\/]|(?:^|[\\/])sessions[\\/][^\\/]*(?:session|thread)[^\\/]*\.jsonl$/i;
const SECRET_REF_RE = /(?:^|[\\/])\.env(?:$|[\\/._-])|\b(api[_ -]?key|auth[_ -]?token|bearer[_ -]?token|credential|credentials|secret|secrets|private[_ -]?key|id_rsa|oauth|cookie|password)\b/i;
const BASE64_RE = /\bdata:[^;,\s]+;base64,[A-Za-z0-9+/=]{80,}|\b[A-Za-z0-9+/]{180,}={0,2}\b/g;

function redactCompactText(value) {
  return String(value || "")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]*\.codex[\\/]sessions[\\/][^\s"'<>|]+/gi, "[raw-session-pointer-omitted]")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]*\.env(?:\.[^\s"'<>|]+)?/gi, "[secret-pointer-omitted]")
    .replace(/\b(?:api[_-]?key|auth[_-]?token|bearer[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[secret-omitted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [secret-omitted]")
    .replace(/\bsk-[A-Za-z0-9]{12,}\b/gi, "[secret-omitted]")
    .replace(BASE64_RE, "[base64-payload-omitted]");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function compactText(value, maxChars = 600) {
  const text = redactCompactText(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function addMillisecondsToIso(value, milliseconds) {
  const parsed = Date.parse(value);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + milliseconds).toISOString();
}

function safeIdPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function normalizeFreshness(value) {
  return ["fresh", "review", "stale", "unknown", "conflict"].includes(value) ? value : "unknown";
}

function normalizeRuntimeStatus(value) {
  return ["active", "curated", "ready", "candidate", "review", "stale", "superseded", "blocked"].includes(value)
    ? value
    : "review";
}

function normalizeSourceRef(ref = {}) {
  if (!ref || typeof ref !== "object") return null;
  const pathValue = ref.path ? String(ref.path) : null;
  const kind = compactText(ref.kind || ref.sourceType || "source", 80) || "source";
  return {
    kind,
    path: pathValue,
    title: ref.title ? compactText(ref.title, 180) : null,
    hash: ref.hash || ref.sha256 || ref.sourceHash || null,
    updatedAt: ref.updatedAt || ref.modifiedAt || null,
    artifactType: ref.artifactType || null,
    sourceType: ref.sourceType || null,
    readByDefault: ref.readByDefault === false ? false : undefined,
  };
}

function normalizeSourceRefs(refs, limit = 12) {
  const result = [];
  const seen = new Set();
  for (const ref of safeArray(refs)) {
    const normalized = normalizeSourceRef(ref);
    if (!normalized) continue;
    const key = `${normalized.kind}|${normalized.path || ""}|${normalized.hash || ""}|${normalized.title || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function inferMemoryTaskType(options = {}) {
  const explicitQueryType = compactText(options.queryType || "", 80);
  if (MEMORY_ROUTER_TASK_TYPES.includes(explicitQueryType)) return explicitQueryType;
  const explicitTaskType = compactText(options.taskType || options.task_type || "", 80);
  if (MEMORY_ROUTER_TASK_TYPES.includes(explicitTaskType)) return explicitTaskType;
  const text = compactText([
    options.taskGoal,
    options.task_goal,
    options.query,
    options.taskType,
    options.task_type,
    options.queryType,
  ].filter(Boolean).join(" "), 800).toLowerCase();
  if (options.threadId || /thread_recovery|old[-_ ]?thread|recover|restore|slimmed|归档|瘦身|老线程|恢复|回忆/.test(text)) return "thread_recovery";
  if (/archive_candidate|archive|cooling|减负|入库|归档规则/.test(text)) return "archive_candidate";
  if (/review|audit|qa|验收|审计|复查/.test(text)) return "review_gate";
  if (/bug|fix|regression|crash|卡顿|cpu|memory|内存|性能|退出/.test(text)) return /cpu|memory|内存|性能|卡顿|退出/.test(text) ? "runtime_diagnosis" : "bug_repair";
  if (/release|package|installer|github|publish|开源|打包|安装/.test(text)) return "release";
  if (/skill|tool|mcp|插件|工具|技能/.test(text)) return "tool_skill_lookup";
  if (/architecture|design|prd|ui|ux|架构|设计|界面/.test(text)) return "architecture";
  if (/handoff|callback|交接|回调/.test(text)) return "handoff";
  if (/writeback|memory|knowledge|记忆|知识/.test(text)) return "memory_writeback";
  return "task_dispatch";
}

function runtimeKindsFromProfile(profileKinds, options = {}) {
  const requestedSource = safeArray(options.allowedKinds).length > 0 ? options.allowedKinds : options.includeKinds;
  const hasExplicitRequest = safeArray(requestedSource).length > 0;
  const requested = safeArray(requestedSource)
    .filter((kind) => DEFAULT_RUNTIME_ALLOWED_KINDS.includes(kind))
    .filter((kind, index, array) => array.indexOf(kind) === index);
  const profile = safeArray(profileKinds).filter((kind) => DEFAULT_RUNTIME_ALLOWED_KINDS.includes(kind));
  const base = profile.length > 0 ? profile : DEFAULT_RUNTIME_ALLOWED_KINDS;
  const limited = hasExplicitRequest
    ? base.filter((kind) => requested.includes(kind))
    : base;
  return limited.filter((kind, index, array) => array.indexOf(kind) === index);
}

function buildMemoryRouterPlan(options = {}) {
  const taskType = inferMemoryTaskType(options);
  const queryType = taskType === "retrieve_precedent" ? "retrieve_precedent" : taskType;
  const topKDefault = ["project_resume", "thread_recovery"].includes(taskType) ? 10 : 8;
  const topK = clampNumber(options.topK || options.maxResults, topKDefault, 1, 12);
  const tokenBudget = clampNumber(options.tokenBudget, taskType === "project_resume" ? 1500 : 1200, 400, 3000);
  const timeBudgetMs = clampNumber(options.timeBudgetMs, MEMORY_ROUTER_DEFAULT_TIME_BUDGET_MS, 50, 1200);
  const allowColdLayer = options.allowColdLayer === true || COLD_MEMORY_QUERY_TYPES.has(taskType);
  const hardRawGate = options.rawSessionHardGate === true && options.explicitRawSessionRequest === true && options.sourceRange;
  const rawSessionDefaultRead = false;
  const profileKinds = MEMORY_ROUTER_KIND_PROFILES[taskType] || MEMORY_ROUTER_KIND_PROFILES.task_dispatch;
  const runtimeAllowedKinds = runtimeKindsFromProfile(profileKinds, options);
  const requestedKinds = safeArray(options.allowedKinds).length > 0 ? options.allowedKinds : options.includeKinds;
  const hasExplicitKindRequest = safeArray(requestedKinds).length > 0;
  const routerWarnings = [];
  if (hasExplicitKindRequest && runtimeAllowedKinds.length === 0) routerWarnings.push("no_allowed_runtime_kinds_after_filter");
  return {
    schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
    taskType,
    queryType,
    providerMode: compactText(options.providerMode || options.provider || "hybrid", 80),
    strategy: "hot_warm_cold_metadata_first",
    memoryMode: "layered",
    retrieval: {
      query: compactText(options.taskGoal || options.task_goal || options.query || options.taskType || options.task_type || "", 260),
      includeKinds: runtimeAllowedKinds,
      maxResults: topK,
      cacheTtlMs: MEMORY_ROUTER_DEFAULT_TTL_MS,
    },
    budgets: {
      tokenBudget,
      topK,
      timeBudgetMs,
      packetTokenTarget: Math.min(tokenBudget, taskType === "project_resume" ? 1500 : 1200),
    },
    layers: {
      hot: {
        enabled: true,
        purpose: "short_term_working_memory_current_goal_decisions_next_action",
        maxItems: Math.min(topK, 4),
      },
      warm: {
        enabled: true,
        purpose: "long_term_project_summaries_prd_architecture_decisions_progress",
        maxItems: Math.min(topK, 8),
      },
      skill: {
        enabled: true,
        purpose: "procedural_memory_experience_cards_tools_and_skill_candidates",
        maxItems: Math.min(topK, 4),
      },
      cold: {
        enabled: allowColdLayer,
        purpose: "raw_or_vault_history_pointers_only_for_deeper_recall",
        maxItems: allowColdLayer ? Math.min(topK, 4) : 0,
        rawSessionDefaultRead,
      },
    },
    rawSessionGate: {
      defaultRead: false,
      allowed: Boolean(hardRawGate),
      reason: hardRawGate
        ? "explicit_user_recovery_gate_present_pointer_only_until_separately_read"
        : "raw_session_body_requires_explicit_recovery_gate",
    },
    warnings: routerWarnings,
    backgroundPolicy: {
      startsTimers: false,
      scansFullDatabase: false,
      scansVault: false,
      runsAiSummary: false,
      rebuildsGraph: false,
    },
  };
}

function memoryLayerForRuntimeItem(item = {}, routerPlan = {}) {
  if (item.kind === "runtime_event") return "hot";
  if (["project_record", "project_resume_packet", "ceo_flow_record"].includes(item.kind)) return "hot";
  if (["tool_skill_record", "skill_candidate", "experience_card"].includes(item.kind)) return "skill";
  if (item.kind === "thread_lineage_index") return routerPlan.layers?.cold?.enabled ? "cold" : "warm";
  const text = [item.title, item.summary].filter(Boolean).join(" ");
  if (MAINTENANCE_MEMORY_RE.test(text)) return COLD_MEMORY_QUERY_TYPES.has(routerPlan.queryType) ? "cold" : "warm";
  if (item.freshness === "fresh" && ["active", "ready", "curated"].includes(item.status)) return "hot";
  return "warm";
}

function normalizeFlowSkillReusablePatterns(compact = {}) {
  return [
    ...safeArray(compact.evidence?.reusablePattern),
    ...safeArray(compact.writeback?.flowSkillCandidate?.reusablePattern),
    ...safeArray(compact.writeback?.flowSkillCandidate?.reusable_pattern),
    ...safeArray(compact.writeback?.flowSkillCandidate?.patterns),
  ].map((item) => compactText(item, 360)).filter(Boolean).slice(0, 12);
}

function normalizeFlowSkillDoNotApply(compact = {}) {
  return [
    ...safeArray(compact.writeback?.flowSkillCandidate?.doNotApplyTo),
    ...safeArray(compact.writeback?.flowSkillCandidate?.do_not_apply_to),
  ].map((item) => compactText(item, 220)).filter(Boolean).slice(0, 12);
}

function estimateTokensFromText(...parts) {
  const length = parts.map((part) => String(part || "")).join(" ").length;
  return Math.max(40, Math.ceil(length / 4));
}

function runtimeKindFromAgentKind(kind) {
  if (kind === "document") return "project_artifact";
  return DEFAULT_RUNTIME_ALLOWED_KINDS.includes(kind) ? kind : null;
}

function normalizeRuntimeItem(item = {}) {
  const kind = runtimeKindFromAgentKind(item.kind);
  if (!kind) return null;
  const sourceRefs = normalizeSourceRefs(item.sourceRefs, 8);
  if (sourceRefsContainRawSession(sourceRefs) || sourceRefsContainSecrets(sourceRefs)) return null;
  const summary = compactText(item.summary || item.excerpt || item.body || "", 520);
  const title = compactText(item.title || item.id || kind, 180);
  return {
    id: compactText(item.id || `${kind}:${title}`, 220),
    kind,
    title,
    summary,
    status: normalizeRuntimeStatus(item.status),
    freshness: normalizeFreshness(item.freshness),
    whyMatched: safeArray(item.whyMatched).map((value) => compactText(value, 160)).filter(Boolean).slice(0, 6),
    sourceRefs,
    tokenEstimate: Math.max(40, Math.ceil(Number(item.tokenEstimate || estimateTokensFromText(title, summary)))),
    requiresHumanConfirmation: item.requiresHumanConfirmation === true || ["candidate", "review", "stale", "blocked"].includes(item.status),
    rawSessionPolicy: item.rawSessionPolicy && /explicit/i.test(String(item.rawSessionPolicy)) ? "explicit_only" : "not_allowed",
  };
}

function normalizeRuntimeItemForRouter(item = {}, routerPlan = {}) {
  const normalized = normalizeRuntimeItem(item);
  if (!normalized) return null;
  const layer = memoryLayerForRuntimeItem(normalized, routerPlan);
  if (layer === "cold" && routerPlan.layers?.cold?.enabled !== true) return null;
  return {
    ...normalized,
    memoryLayer: layer,
  };
}

function collectPacketSourceRefs(items, extraRefs = []) {
  return normalizeSourceRefs([...safeArray(extraRefs), ...safeArray(items).flatMap((item) => safeArray(item.sourceRefs))], 20);
}

function projectFromRuntimeItems(items, options = {}) {
  const projectItem = safeArray(items).find((item) => item.kind === "project_record" || item.kind === "project_resume_packet");
  if (!projectItem && !options.projectPath) return null;
  return {
    id: projectItem?.id || null,
    name: projectItem?.title || (options.projectPath ? path.basename(String(options.projectPath)) : "unknown"),
    path: options.projectPath || projectItem?.sourceRefs?.find((ref) => ref.path)?.path || null,
    status: projectItem?.status || "review",
    completion: null,
    summary: projectItem?.summary || "",
    nextAction: safeArray(projectItem?.whyMatched)[0] || "",
    blockers: [],
    freshness: projectItem?.freshness || "unknown",
  };
}

function normalizeAllowedKinds(options = {}, fallback = DEFAULT_RUNTIME_ALLOWED_KINDS) {
  const source = safeArray(options.allowedKinds).length > 0 ? options.allowedKinds : options.includeKinds;
  const kinds = safeArray(source).filter((kind) => fallback.includes(kind));
  return (kinds.length > 0 ? kinds : fallback).filter((kind, index, array) => array.indexOf(kind) === index);
}

function buildRuntimeContextPacket(retrieveResult = {}, options = {}) {
  const routerPlan = options.routerPlan && typeof options.routerPlan === "object"
    ? options.routerPlan
    : buildMemoryRouterPlan(options);
  const routerPlanHasKinds = Array.isArray(routerPlan.retrieval?.includeKinds);
  const allowedKinds = routerPlanHasKinds
    ? safeArray(routerPlan.retrieval?.includeKinds)
      .filter((kind) => DEFAULT_RUNTIME_ALLOWED_KINDS.includes(kind))
      .filter((kind, index, array) => array.indexOf(kind) === index)
    : runtimeKindsFromProfile(DEFAULT_RUNTIME_ALLOWED_KINDS, options);
  const rawItems = safeArray(retrieveResult.items);
  const items = rawItems
    .map((item) => normalizeRuntimeItemForRouter(item, routerPlan))
    .filter((item) => item && allowedKinds.includes(item.kind))
    .slice(0, routerPlan.budgets?.topK || 8);
  const tokenEstimate = Math.min(
    Math.max(0, Number(retrieveResult.tokenEstimate || 0)) || items.reduce((sum, item) => sum + item.tokenEstimate, 0),
    Math.max(200, Number(routerPlan.budgets?.tokenBudget || options.tokenBudget || retrieveResult.tokenBudget || 1200)),
  );
  const generatedAt = retrieveResult.generatedAt || new Date().toISOString();
  const expiresAt = addMillisecondsToIso(generatedAt, routerPlan.retrieval?.cacheTtlMs || MEMORY_ROUTER_DEFAULT_TTL_MS);
  const retrievalDurationMs = Math.max(0, Number(retrieveResult.durationMs || options.retrievalDurationMs || 0));
  const timeBudgetMs = routerPlan.budgets?.timeBudgetMs || MEMORY_ROUTER_DEFAULT_TIME_BUDGET_MS;
  const timeBudgetExceeded = retrievalDurationMs > timeBudgetMs;
  const routerWarnings = safeArray(routerPlan.warnings).map((warning) => compactText(warning, 200)).filter(Boolean);
  return {
    schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
    memoryMode: "layered",
    request: {
      taskGoal: compactText(options.taskGoal || options.query || retrieveResult.query || "", 260),
      queryType: compactText(routerPlan.queryType || options.queryType || retrieveResult.queryType || "task_dispatch", 80),
      projectPath: options.projectPath || retrieveResult.projectPath || null,
      threadId: options.threadId || null,
      parentCeoThreadId: options.parentCeoThreadId || retrieveResult.parentCeoThreadId || null,
      tokenBudget: Math.max(200, Math.min(Number(routerPlan.budgets?.tokenBudget || options.tokenBudget || retrieveResult.tokenBudget || 1200), 4000)),
      allowedKinds,
    },
    project: projectFromRuntimeItems(items, options),
    items,
    sourceRefs: collectPacketSourceRefs(items),
    hotState: buildHotStateCacheSeed(items, options),
    memoryGraph: buildMemoryGraph(items),
    memoryLayers: summarizeMemoryLayers(items),
    recallPlan: buildLayeredRecallPlan(routerPlan, items),
    routerPlan,
    performance: {
      metadataFirst: true,
      noRawSessionBody: true,
      noFullTextRead: true,
      noVaultScan: true,
      noBackgroundTimer: true,
      boundedByRouterPlan: true,
      metadataRowReadsMayUseIndexes: true,
      cacheTtlMs: routerPlan.retrieval?.cacheTtlMs || MEMORY_ROUTER_DEFAULT_TTL_MS,
      timeBudgetMs,
      retrievalDurationMs,
      timeBudgetExceeded,
    },
    partial: items.length < rawItems.length || timeBudgetExceeded || allowedKinds.length === 0,
    expiresAt,
    cacheKey: hashJson({
      taskGoal: options.taskGoal || options.query || retrieveResult.query || "",
      queryType: routerPlan.queryType,
      projectPath: options.projectPath || retrieveResult.projectPath || null,
      threadId: options.threadId || null,
      parentCeoThreadId: options.parentCeoThreadId || retrieveResult.parentCeoThreadId || null,
      allowedKinds,
      topK: routerPlan.budgets?.topK,
      tokenBudget: routerPlan.budgets?.tokenBudget,
    }).slice(0, 24),
    warnings: [
      "metadata_first_no_raw_session_body",
      "no_archive_compact_delete_move_restore",
      "memory_router_no_background_scan",
      "layered_memory_hot_warm_skill_default_cold_pointer_only",
      ...routerWarnings,
      ...(timeBudgetExceeded ? ["memory_router_time_budget_exceeded_partial"] : []),
      ...safeArray(retrieveResult.warnings).map((warning) => compactText(warning, 200)).filter(Boolean),
    ],
    tokenEstimate,
    generatedAt,
  };
}

function summarizeMemoryLayers(items = []) {
  const summary = {
    hot: { count: 0, tokenEstimate: 0, role: "short_term_working_memory" },
    warm: { count: 0, tokenEstimate: 0, role: "long_term_project_summary_memory" },
    cold: { count: 0, tokenEstimate: 0, role: "raw_or_vault_history_pointer_memory" },
    skill: { count: 0, tokenEstimate: 0, role: "procedural_experience_and_skill_memory" },
  };
  for (const item of safeArray(items)) {
    const layer = summary[item.memoryLayer] ? item.memoryLayer : "warm";
    summary[layer].count += 1;
    summary[layer].tokenEstimate += Number(item.tokenEstimate || 0);
  }
  return summary;
}

function buildLayeredRecallPlan(routerPlan = {}, items = []) {
  const layerSummary = summarizeMemoryLayers(items);
  const coldEnabled = routerPlan.layers?.cold?.enabled === true;
  return {
    mode: "hot_warm_cold_skill_layered_recall",
    defaultReadOrder: ["hot", "warm", "skill"],
    coldLayer: {
      enabled: coldEnabled,
      defaultRead: false,
      policy: "source_refs_only_until_explicit_recovery_or_evidence_gate",
      reason: coldEnabled
        ? "query_type_allows_cold_pointer_recall"
        : "ordinary_tasks_use_hot_warm_skill_before_cold_history",
    },
    escalation: [
      "hot: recover current goal, active module, latest decisions, blockers, and next action.",
      "warm: recall PRD, architecture, accepted progress, design origin, and long-term project summaries.",
      "skill: recall reusable procedures, prior fixes, tools, and skill candidates.",
      "cold: use sourceRefs only; read raw/vault history narrowly only after explicit recovery/evidence gate.",
    ],
    layerCounts: {
      hot: layerSummary.hot.count,
      warm: layerSummary.warm.count,
      skill: layerSummary.skill.count,
      cold: layerSummary.cold.count,
    },
  };
}

function buildHotStateCacheSeed(items = [], options = {}) {
  const hotItems = safeArray(items).filter((item) => item.memoryLayer === "hot");
  const project = projectFromRuntimeItems(hotItems.length > 0 ? hotItems : items, options);
  return {
    schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
    project,
    activeItemIds: hotItems.map((item) => item.id).slice(0, 6),
    nextAction: project?.nextAction || hotItems.find((item) => item.whyMatched.length > 0)?.whyMatched?.[0] || "",
    sourceRefs: collectPacketSourceRefs(hotItems, []).slice(0, 8),
    expiresAt: new Date(Date.now() + MEMORY_ROUTER_DEFAULT_TTL_MS).toISOString(),
  };
}

function buildMemoryGraph(items = []) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  function addNode(node) {
    if (!node.id || seen.has(node.id) || nodes.length >= 24) return;
    seen.add(node.id);
    nodes.push(node);
  }
  for (const item of safeArray(items).slice(0, 12)) {
    const itemNodeId = `item:${safeIdPart(item.id)}`;
    addNode({ id: itemNodeId, kind: item.kind, label: item.title, memoryLayer: item.memoryLayer, tokenEstimate: item.tokenEstimate });
    for (const ref of safeArray(item.sourceRefs).slice(0, 3)) {
      const refNodeId = `source:${safeIdPart(ref.hash || ref.path || ref.title || ref.kind)}`;
      addNode({ id: refNodeId, kind: ref.kind || "source", label: ref.title || ref.path || ref.kind || "source", memoryLayer: item.memoryLayer });
      if (edges.length < 32) {
        edges.push({ from: itemNodeId, to: refNodeId, kind: "source_ref", weight: 1 });
      }
    }
  }
  return {
    schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
    mode: "bounded_association_graph",
    nodes,
    edges,
  };
}

function tokenizeMemoryGraphQuery(value) {
  const text = compactText(value || "", 1000).toLowerCase();
  const ascii = text.match(/[a-z0-9][a-z0-9._-]{1,}/g) || [];
  const cjk = text.match(/[\u4e00-\u9fff]{2,12}/g) || [];
  return [...ascii, ...cjk]
    .map((token) => compactText(token, 40))
    .filter(Boolean)
    .filter((token, index, array) => array.indexOf(token) === index)
    .slice(0, 20);
}

function normalizeMemoryGraphSeedNode(row = {}) {
  const id = compactText(row.id || row.nodeId || `${row.kind || "memory"}:${row.sourceId || row.title || "unknown"}`, 220);
  const kind = compactText(row.kind || row.nodeKind || "memory", 80);
  const title = compactText(row.title || row.label || id, 180);
  const summary = compactText(row.summary || row.excerpt || row.body || "", 520);
  const tags = safeArray(row.tags || row.tagList).map((tag) => compactText(tag, 80)).filter(Boolean).slice(0, 16);
  const sourceRefs = normalizeSourceRefs(row.sourceRefs, 8);
  return {
    id,
    kind,
    label: title,
    title,
    summary,
    projectPath: row.projectPath || null,
    threadId: row.threadId || row.ceoThreadId || null,
    sourceId: row.sourceId || row.id || null,
    sourceTable: row.sourceTable || row.sourceKind || null,
    memoryLayer: compactText(row.memoryLayer || "warm", 40),
    freshness: normalizeFreshness(row.freshness),
    status: normalizeRuntimeStatus(row.status),
    tags,
    sourceRefs,
    updatedAt: row.updatedAt || row.lastActivityAt || null,
    tokenEstimate: Math.max(24, Math.ceil(Number(row.tokenEstimate || estimateTokensFromText(title, summary, tags.join(" "))))),
  };
}

function normalizeMemoryGraphSeedEdge(row = {}) {
  const from = compactText(row.from || row.fromId || row.sourceNodeId || "", 220);
  const to = compactText(row.to || row.toId || row.targetNodeId || "", 220);
  if (!from || !to || from === to) return null;
  return {
    from,
    to,
    kind: compactText(row.kind || row.edgeKind || "related", 80),
    weight: Math.max(0.05, Math.min(Number(row.weight || 1), 10)),
    reason: compactText(row.reason || "", 180),
  };
}

function scoreMemoryGraphNode(node, tokens, options = {}) {
  const text = [node.title, node.summary, node.projectPath, node.threadId, safeArray(node.tags).join(" ")].join(" ").toLowerCase();
  let score = 0;
  const why = [];
  for (const token of tokens) {
    if (!token) continue;
    if (String(node.title || "").toLowerCase().includes(token)) {
      score += 16;
      why.push(`title:${token}`);
    }
    if (String(node.projectPath || "").toLowerCase().includes(token)) {
      score += 12;
      why.push(`project:${token}`);
    }
    if (String(node.threadId || "").toLowerCase().includes(token)) {
      score += 14;
      why.push(`thread:${token}`);
    }
    if (safeArray(node.tags).join(" ").toLowerCase().includes(token)) {
      score += 8;
      why.push(`tag:${token}`);
    }
    if (text.includes(token)) score += 5;
  }
  if (options.projectPath && node.projectPath === options.projectPath) {
    score += 18;
    why.push("projectPath:exact");
  }
  if (options.threadId && node.threadId === options.threadId) {
    score += 240;
    why.push("threadId:exact");
  }
  if (node.kind === "thread_lineage_index") score += 6;
  if (node.kind === "experience_card") score += 4;
  if (node.freshness === "fresh") score += 4;
  if (node.status === "ready" || node.status === "accepted" || node.status === "curated") score += 3;
  const updatedMs = Date.parse(String(node.updatedAt || ""));
  if (Number.isFinite(updatedMs)) {
    const ageDays = Math.max(0, (Date.now() - updatedMs) / 86_400_000);
    score += Math.max(0, 8 - Math.min(8, ageDays / 4));
  }
  return { score, why: why.slice(0, 8) };
}

function buildActivatedMemoryGraph(seed = {}, options = {}) {
  const taskGoal = options.taskGoal || options.query || "";
  const tokens = tokenizeMemoryGraphQuery([taskGoal, options.projectPath || "", options.threadId || ""].filter(Boolean).join(" "));
  const maxNodes = Math.max(4, Math.min(Number(options.maxNodes || options.limit || 32), 80));
  const rawNodes = safeArray(seed.nodes).map(normalizeMemoryGraphSeedNode).filter((node) => node.id);
  const nodeById = new Map(rawNodes.map((node) => [node.id, node]));
  const rawEdges = safeArray(seed.edges).map(normalizeMemoryGraphSeedEdge).filter(Boolean);
  const edgeByNode = new Map();
  for (const edge of rawEdges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    if (!edgeByNode.has(edge.from)) edgeByNode.set(edge.from, []);
    if (!edgeByNode.has(edge.to)) edgeByNode.set(edge.to, []);
    edgeByNode.get(edge.from).push({ ...edge, neighbor: edge.to });
    edgeByNode.get(edge.to).push({ ...edge, neighbor: edge.from });
  }
  const scored = rawNodes
    .map((node) => {
      const direct = scoreMemoryGraphNode(node, tokens, options);
      return { ...node, activation: direct.score, whyActivated: direct.why };
    })
    .filter((node) => node.activation > 0)
    .sort((a, b) => b.activation - a.activation || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  const activatedIds = new Set(scored.slice(0, Math.max(1, Math.ceil(maxNodes / 2))).map((node) => node.id));
  for (const node of scored.slice(0, Math.max(1, Math.ceil(maxNodes / 3)))) {
    for (const edge of safeArray(edgeByNode.get(node.id)).sort((a, b) => b.weight - a.weight).slice(0, 4)) {
      if (activatedIds.size >= maxNodes) break;
      activatedIds.add(edge.neighbor);
    }
  }
  const nodes = Array.from(activatedIds)
    .map((id) => {
      const base = nodeById.get(id);
      const scoredNode = scored.find((node) => node.id === id);
      if (scoredNode) return scoredNode;
      return { ...base, activation: Math.max(1, Math.min(8, safeArray(edgeByNode.get(id)).reduce((sum, edge) => sum + edge.weight, 0))), whyActivated: ["neighbor:activated"] };
    })
    .filter(Boolean)
    .sort((a, b) => b.activation - a.activation)
    .slice(0, maxNodes);
  const activeIdSet = new Set(nodes.map((node) => node.id));
  const edges = rawEdges
    .filter((edge) => activeIdSet.has(edge.from) && activeIdSet.has(edge.to))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, Math.max(8, maxNodes * 2));
  return {
    schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
    mode: "persisted_activation_graph",
    taskGoal: compactText(taskGoal, 260),
    tokens,
    activatedNodeIds: nodes.map((node) => node.id),
    nodes,
    edges,
    performance: {
      metadataOnly: true,
      rawSessionBodyRead: false,
      scansVault: false,
      boundedSeedNodes: rawNodes.length,
      boundedSeedEdges: rawEdges.length,
      maxNodes,
    },
    warnings: rawNodes.length === 0 ? ["memory_graph_seed_empty"] : [],
  };
}

function mergeMemoryGraphs(packetGraph, activatedGraph) {
  if (!activatedGraph || safeArray(activatedGraph.nodes).length === 0) return packetGraph;
  if (!packetGraph || !Array.isArray(packetGraph.nodes)) return activatedGraph;
  return {
    ...activatedGraph,
    packetLocalGraph: packetGraph,
    nodes: [...safeArray(activatedGraph.nodes), ...safeArray(packetGraph.nodes)]
      .filter((node, index, array) => array.findIndex((candidate) => candidate.id === node.id) === index)
      .slice(0, 80),
    edges: [...safeArray(activatedGraph.edges), ...safeArray(packetGraph.edges)]
      .filter((edge, index, array) => array.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.kind === edge.kind) === index)
      .slice(0, 160),
  };
}

function buildRuntimePrecedentRequest(options = {}) {
  const routerPlan = buildMemoryRouterPlan({
    ...options,
    queryType: "retrieve_precedent",
    taskGoal: options.taskType || options.task_type || options.query,
    allowedKinds: options.allowedKinds || options.includeKinds || DEFAULT_PRECEDENT_ALLOWED_KINDS,
  });
  return {
    query: compactText(options.taskType || options.task_type || options.query || "", 240),
    queryType: "retrieve_precedent",
    projectPath: options.projectPath || null,
    parentCeoThreadId: options.parentCeoThreadId || null,
    tokenBudget: routerPlan.budgets.tokenBudget,
    maxResults: routerPlan.budgets.topK,
    includeKinds: routerPlan.retrieval.includeKinds.filter((kind) => DEFAULT_PRECEDENT_ALLOWED_KINDS.includes(kind)),
    routerPlan,
  };
}

function buildRuntimePrecedentPacket(retrieveResult = {}, options = {}) {
  const explicitPrecedentKinds = Array.isArray(options.routerPlan?.retrieval?.includeKinds)
    ? safeArray(options.routerPlan.retrieval.includeKinds).filter((kind) => DEFAULT_PRECEDENT_ALLOWED_KINDS.includes(kind))
    : normalizeAllowedKinds(options, DEFAULT_PRECEDENT_ALLOWED_KINDS);
  const contextPacket = buildRuntimeContextPacket(retrieveResult, {
    ...options,
    taskGoal: options.taskType || options.task_type || options.query,
    queryType: "retrieve_precedent",
    allowedKinds: explicitPrecedentKinds,
  });
  return {
    ...contextPacket,
    request: {
      ...contextPacket.request,
      taskType: compactText(options.taskType || options.task_type || options.query || retrieveResult.query || "", 240),
    },
    precedentPolicy: {
      metadataFirst: true,
      rawSessionDefaultRead: false,
      giantMarkdownDefaultRead: false,
      allowedKinds: contextPacket.request.allowedKinds,
      memoryRouter: contextPacket.routerPlan?.strategy || "hot_warm_cold_metadata_first",
    },
  };
}

function normalizeRecoveryPointer(pointer = {}) {
  if (!pointer || typeof pointer !== "object") return null;
  const kind = compactText(pointer.kind || pointer.sourceType || "source", 80);
  const pointerPath = pointer.path ? String(pointer.path) : null;
  return {
    kind,
    path: pointerPath,
    title: pointer.title ? compactText(pointer.title, 180) : null,
    threadId: pointer.threadId ? compactText(pointer.threadId, 120) : null,
    sha256: pointer.sha256 || pointer.hash || null,
    sizeBytes: Number.isFinite(Number(pointer.sizeBytes || pointer.size_bytes)) ? Number(pointer.sizeBytes || pointer.size_bytes) : null,
    updatedAt: pointer.updatedAt || pointer.lastWriteTime || pointer.last_write_time || null,
    readByDefault: false,
    rawSessionPolicy: RAW_SESSION_KIND_RE.test(kind) || RAW_SESSION_PATH_RE.test(String(pointerPath || ""))
      ? "explicit_user_recovery_only_no_default_body_read"
      : "metadata_pointer_only",
  };
}

function normalizeRecoveryPointers(pointers, limit = 16) {
  const result = [];
  const seen = new Set();
  for (const pointer of safeArray(pointers)) {
    const normalized = normalizeRecoveryPointer(pointer);
    if (!normalized) continue;
    const key = `${normalized.kind}|${normalized.path || ""}|${normalized.threadId || ""}|${normalized.sha256 || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeRecoveryLineageRecord(record = {}) {
  if (!record || typeof record !== "object") return null;
  return {
    id: compactText(record.id || record.ceoThreadId || "thread-lineage", 160),
    kind: "thread_lineage_index",
    ceoThreadId: compactText(record.ceoThreadId || "", 120),
    title: compactText(record.title || "ThreadLineageIndex", 180),
    scope: compactText(record.scope || "project", 80),
    projectIds: safeArray(record.projectIds).map((item) => compactText(item, 120)).filter(Boolean).slice(0, 12),
    workspacePaths: safeArray(record.workspacePaths).map((item) => compactText(item, 260)).filter(Boolean).slice(0, 12),
    relationships: {
      childThreadIds: safeArray(record.relationships?.childThreadIds || record.childThreadIds).map((item) => compactText(item, 120)).filter(Boolean).slice(0, 30),
      workerThreadIds: safeArray(record.relationships?.workerThreadIds || record.workerThreadIds).map((item) => compactText(item, 120)).filter(Boolean).slice(0, 30),
      reviewerThreadIds: safeArray(record.relationships?.reviewerThreadIds || record.reviewerThreadIds).map((item) => compactText(item, 120)).filter(Boolean).slice(0, 30),
      memoryThreadIds: safeArray(record.relationships?.memoryThreadIds || record.memoryThreadIds).map((item) => compactText(item, 120)).filter(Boolean).slice(0, 20),
      handoffIds: safeArray(record.relationships?.handoffIds || record.handoffIds).map((item) => compactText(item, 140)).filter(Boolean).slice(0, 20),
      vaultPointers: safeArray(record.relationships?.vaultPointers || record.vaultPointers).map((item) => compactText(item, 180)).filter(Boolean).slice(0, 20),
    },
    relationshipCounts: record.relationshipCounts || {},
    governance: {
      status: compactText(record.governance?.status || "metadata_only", 120),
      rawSessionPolicy: "metadata_only_no_raw_body",
      mutationPolicy: "read_only_no_archive_compact_restore_delete",
    },
    archiveState: compactText(record.archiveState || "unknown", 80),
    lastActivityAt: record.lastActivityAt || null,
    lastSummary: compactText(record.lastSummary || record.summary || "", 520),
    nextAction: compactText(record.nextAction || "", 360),
    sourceRefs: normalizeSourceRefs(record.sourceRefs, 8),
  };
}

function buildThreadRecoveryPrompt(packet) {
  const docs = safeArray(packet.recommendedReadOrder).map((item) => item.path).filter(Boolean).slice(0, 8);
  return [
    "你接替一个旧 Codex/CEO 线程继续工作。先读取这个 ThreadRecoveryPacket，不要直接加载原始 400MB session。",
    packet.thread.threadId ? `目标 threadId: ${packet.thread.threadId}` : "",
    packet.thread.title ? `线程标题/查询: ${packet.thread.title}` : "",
    packet.thread.projectPath ? `项目路径: ${packet.thread.projectPath}` : "",
    docs.length ? `优先读取项目文档: ${docs.join(" ; ")}` : "",
    "raw session / vault session 只作为 cold evidence，默认不读正文；需要时按 sourceRefs 小范围回查。",
    "接手后先检查当前文件状态和测试状态，再更新 WorkingMemory。",
  ].filter(Boolean).join("\n");
}

function buildThreadRecoveryPacket(input = {}) {
  const threadId = compactText(input.threadId || input.thread?.threadId || "", 120);
  const title = compactText(input.title || input.threadTitle || input.query || input.thread?.title || "", 180);
  const projectPath = input.projectPath || input.thread?.projectPath || null;
  const generatedAt = input.generatedAt || new Date().toISOString();
  const lineage = safeArray(input.lineageRecords)
    .map(normalizeRecoveryLineageRecord)
    .filter(Boolean)
    .slice(0, 12);
  const vaultManifests = safeArray(input.vaultManifests).map((manifest) => ({
    threadId: compactText(manifest.threadId || threadId, 120),
    title: compactText(manifest.title || title, 180),
    projectPath: manifest.projectPath || null,
    vaultManifestPath: manifest.vaultManifestPath || manifest.path || null,
    vaultSessionPath: manifest.vaultSessionPath || null,
    memoryPointer: manifest.memoryPointer || (manifest.threadId || threadId ? `codex-history:${manifest.threadId || threadId}` : null),
    originalSha256: manifest.originalSha256 || manifest.vaultOriginalSha256 || null,
    copiedSha256: manifest.copiedSha256 || manifest.vaultCopiedSha256 || null,
    sizeBytes: Number.isFinite(Number(manifest.sizeBytes || manifest.size_bytes)) ? Number(manifest.sizeBytes || manifest.size_bytes) : null,
    createdAt: manifest.createdAt || null,
    updatedAt: manifest.updatedAt || manifest.lastWriteTime || null,
    completeHistoryStored: manifest.completeHistoryStored !== false,
    rawSessionPolicy: "vault_pointer_only_no_default_body_read",
  })).slice(0, 12);
  const contextItems = safeArray(input.contextPacket?.items || input.contextItems).slice(0, 12);
  const projectDocPointers = normalizeRecoveryPointers(safeArray(input.projectDocs).map((doc) => ({
    kind: "project_artifact",
    path: doc.path || doc.filePath,
    title: doc.title || doc.name,
    updatedAt: doc.updatedAt || doc.lastWriteTime,
    sizeBytes: doc.sizeBytes,
  })), 16);
  const projectDocs = projectDocPointers.filter((doc) => !doc.sizeBytes || doc.sizeBytes <= MAX_RECOVERY_RECOMMENDED_DOC_BYTES);
  const largeProjectDocs = projectDocPointers.filter((doc) => doc.sizeBytes && doc.sizeBytes > MAX_RECOVERY_RECOMMENDED_DOC_BYTES);
  const coldHistorySources = normalizeRecoveryPointers([
    ...largeProjectDocs.map((doc) => ({
      ...doc,
      kind: "large_project_artifact_pointer",
      title: doc.title ? `${doc.title}（大文件，默认不读）` : "大文件，默认不读",
    })),
    ...safeArray(input.coldHistorySources),
    ...vaultManifests.flatMap((manifest) => [
      { kind: "thread_history_vault_manifest", path: manifest.vaultManifestPath, title: manifest.title, threadId: manifest.threadId, sha256: manifest.originalSha256, updatedAt: manifest.updatedAt },
      { kind: "thread_history_vault_session", path: manifest.vaultSessionPath, title: manifest.title, threadId: manifest.threadId, sha256: manifest.copiedSha256, updatedAt: manifest.updatedAt },
    ]),
  ], 20);
  const sourceRefs = normalizeRecoveryPointers([
    ...projectDocs,
    ...coldHistorySources,
    ...lineage.flatMap((record) => record.sourceRefs || []),
  ], 24);
  const warnings = [
    "metadata_first_recovery_packet",
    "raw_session_body_not_read_by_default",
    "no_archive_compact_delete_move_restore",
    ...(vaultManifests.length === 0 ? ["no_thread_history_vault_manifest_matched"] : []),
    ...(lineage.length === 0 ? ["no_thread_lineage_record_matched"] : []),
    ...(largeProjectDocs.length > 0 ? ["large_recovery_docs_pointer_only"] : []),
    ...safeArray(input.warnings).map((warning) => compactText(warning, 200)).filter(Boolean),
  ].filter((warning, index, array) => array.indexOf(warning) === index);
  const packet = {
    schemaVersion: THREAD_RECOVERY_PACKET_SCHEMA,
    generatedAt,
    request: {
      threadId: threadId || null,
      title: title || null,
      query: compactText(input.query || title || threadId || "", 240),
      projectPath,
      tokenBudget: clampNumber(input.tokenBudget, 1200, 400, 3000),
    },
    thread: {
      threadId: threadId || vaultManifests[0]?.threadId || lineage[0]?.ceoThreadId || null,
      title: title || vaultManifests[0]?.title || lineage[0]?.title || "",
      projectPath: projectPath || vaultManifests[0]?.projectPath || lineage[0]?.workspacePaths?.[0] || null,
      confidence: vaultManifests.length > 0 || lineage.length > 0 ? "source_backed" : "needs_review",
    },
    lineage,
    vault: {
      hasVault: vaultManifests.length > 0,
      manifests: vaultManifests,
      policy: "pointer_only_no_default_raw_body_read",
    },
    context: {
      packetId: input.contextPacket?.cacheKey || null,
      itemCount: contextItems.length,
      items: contextItems.map((item) => ({
        id: compactText(item.id || "", 180),
        kind: compactText(item.kind || "", 80),
        title: compactText(item.title || "", 180),
        summary: compactText(item.summary || item.excerpt || "", 520),
        freshness: normalizeFreshness(item.freshness),
        memoryLayer: item.memoryLayer || null,
        whyMatched: safeArray(item.whyMatched).map((value) => compactText(value, 160)).filter(Boolean).slice(0, 6),
        sourceRefs: normalizeSourceRefs(item.sourceRefs, 4),
      })),
    },
    recommendedReadOrder: projectDocs,
    coldHistorySources,
    sourceRefs,
    nextActions: [
      "先读取 recommendedReadOrder 中的项目文档。",
      "再用 retrieve_context(task_goal, thread_recovery) 获取当前热/温上下文。",
      "只有当 compact 恢复包不足时，才按 coldHistorySources 小范围读取 raw/vault session。",
      "接手线程启动后写入 WorkingMemoryRecord，结束时 writeback_evidence。",
    ],
    prompt: "",
    performance: {
      metadataFirst: true,
      rawSessionBodyRead: false,
      scansFullDatabase: false,
      startsTimers: false,
      boundedSourcePointers: true,
    },
    safety: {
      mutatesRawSession: false,
      archiveCompactDeleteMoveRestore: false,
      installsOrExecutes: false,
      rawSessionDefaultRead: false,
    },
    warnings,
    tokenEstimate: estimateTokensFromText(title, projectPath, JSON.stringify(lineage), JSON.stringify(projectDocs), JSON.stringify(vaultManifests)),
  };
  packet.prompt = buildThreadRecoveryPrompt(packet);
  return packet;
}

function actionSignalParts(value) {
  const raw = value && typeof value === "object" ? value : {};
  return [
    raw.action,
    raw.operation,
    raw.requestedAction,
    raw.requestedEffect,
    raw.requestedEffects,
    raw.targetAction,
    raw.command,
    raw.commandName,
    raw.toolCall,
    raw.effect,
    raw.effects,
    raw.writeback?.action,
    raw.writeback?.operation,
    raw.writeback?.requestedAction,
    raw.writeback?.requestedEffect,
    raw.writeback?.requestedEffects,
    raw.writeback?.effect,
    raw.writeback?.effects,
    raw.promotion?.action,
    raw.promotion?.operation,
    raw.promotion?.requestedAction,
    raw.promotion?.requestedEffect,
    raw.promotion?.requestedEffects,
    ...safeArray(raw.actions),
    ...safeArray(raw.operations),
    ...safeArray(raw.commands),
    ...safeArray(raw.forbiddenActions),
  ].filter(Boolean);
}

function containsDangerousIntent(value) {
  const actionText = actionSignalParts(value).map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" ");
  return DANGEROUS_ACTION_RE.test(actionText);
}

function sourceRefSignalText(ref = {}) {
  return [
    ref.kind,
    ref.path,
    ref.title,
    ref.artifactType,
    ref.sourceType,
  ].filter(Boolean).join(" ");
}

function sourceRefsContainRawSession(refs = []) {
  return safeArray(refs).some((ref) => {
    const text = sourceRefSignalText(ref);
    return RAW_SESSION_KIND_RE.test(text) || RAW_SESSION_PATH_RE.test(String(ref.path || ""));
  });
}

function sourceRefsContainSecrets(refs = []) {
  return safeArray(refs).some((ref) => SECRET_REF_RE.test(sourceRefSignalText(ref)));
}

function actionFieldsContainRawSession(value) {
  const actionText = actionSignalParts(value).map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" ");
  return RAW_SESSION_KIND_RE.test(actionText) || RAW_SESSION_PATH_RE.test(actionText);
}

function actionFieldsContainSecrets(value) {
  const actionText = actionSignalParts(value).map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" ");
  return SECRET_REF_RE.test(actionText);
}

function inferContainsRawSession(value, sourceRefs = []) {
  return sourceRefsContainRawSession(sourceRefs) || actionFieldsContainRawSession(value);
}

function inferContainsSecrets(value, sourceRefs = []) {
  return sourceRefsContainSecrets(sourceRefs) || actionFieldsContainSecrets(value);
}

function compactEvidencePacket(packet = {}) {
  const evidence = packet.evidence && typeof packet.evidence === "object" ? packet.evidence : {};
  const sourceRefs = normalizeSourceRefs(evidence.sourceRefs, 20);
  const inferredContainsRawSession = inferContainsRawSession(packet, sourceRefs);
  const inferredContainsSecrets = inferContainsSecrets(packet, sourceRefs);
  return {
    schemaVersion: 1,
    decision: WRITEBACK_DECISIONS.includes(packet.decision) ? packet.decision : "block",
    task: {
      id: compactText(packet.task?.id || packet.taskId || "unknown-task", 140),
      goal: compactText(packet.task?.goal || packet.goal || "", 360),
      domain: safeArray(packet.task?.domain || packet.domain).map((item) => compactText(item, 80)).filter(Boolean).slice(0, 12),
      projectPath: packet.task?.projectPath || packet.projectPath || null,
      threadId: packet.task?.threadId || packet.threadId || null,
      parentCeoThreadId: packet.task?.parentCeoThreadId || packet.parentCeoThreadId || null,
    },
    evidence: {
      summary: compactText(evidence.summary || packet.summary || "", 1000),
      changedFiles: safeArray(evidence.changedFiles).map((item) => compactText(item, 260)).filter(Boolean).slice(0, 40),
      artifacts: safeArray(evidence.artifacts).map((item) => compactText(item, 260)).filter(Boolean).slice(0, 40),
      tests: safeArray(evidence.tests).map((item) => compactText(item, 220)).filter(Boolean).slice(0, 40),
      reusablePattern: safeArray(evidence.reusablePattern).map((item) => compactText(item, 360)).filter(Boolean).slice(0, 12),
      failurePattern: safeArray(evidence.failurePattern).map((item) => compactText(item, 360)).filter(Boolean).slice(0, 12),
      residualRisk: compactText(evidence.residualRisk || "", 700),
      sourceRefs,
    },
    writeback: packet.writeback && typeof packet.writeback === "object" ? packet.writeback : {},
    privacy: {
      containsRawSession: packet.privacy?.containsRawSession === true || inferredContainsRawSession,
      containsSecrets: packet.privacy?.containsSecrets === true || inferredContainsSecrets,
      publicCandidateAllowed: packet.privacy?.publicCandidateAllowed === true,
    },
  };
}

function evaluateWritebackEvidence(packet = {}) {
  const compact = compactEvidencePacket(packet);
  const safetyBlockers = [];
  const warnings = [];
  const reusablePattern = normalizeFlowSkillReusablePatterns(compact);
  if (!WRITEBACK_DECISIONS.includes(packet.decision)) safetyBlockers.push("invalid_decision");
  if (compact.privacy.containsRawSession) safetyBlockers.push("contains_raw_session");
  if (compact.privacy.containsSecrets) safetyBlockers.push("contains_secrets");
  if (containsDangerousIntent(packet)) safetyBlockers.push("destructive_or_executable_intent");
  if (compact.privacy.publicCandidateAllowed) warnings.push("public_export_requires_explicit_user_review");
  if (compact.evidence.sourceRefs.length === 0) warnings.push("missing_source_refs_candidate_only");
  const status = safetyBlockers.length > 0
    ? "rejected"
    : warnings.length > 0
      ? "candidate_review"
      : "queued";
  const candidates = [];
  if (status !== "rejected") {
    if (compact.decision === "accept" && reusablePattern.length > 0 && compact.evidence.sourceRefs.length > 0 && !compact.privacy.containsRawSession && !compact.privacy.containsSecrets) {
      candidates.push({
        kind: "flowskill_candidate",
        status: "private_review",
        requiresHumanConfirmation: true,
        publicExportAllowed: false,
        readyPacket: buildFlowSkillReadyCandidate(compact, { status: "private_review" }),
        reason: "accepted_reusable_pattern_private_candidate_only",
      });
    }
    if (["revise", "block"].includes(compact.decision) && compact.evidence.failurePattern.length > 0) {
      candidates.push({
        kind: "experience_card",
        status: "candidate",
        requiresHumanConfirmation: true,
        reason: "revise_or_block_failure_pattern",
      });
    }
  }
  return {
    ok: true,
    status,
    compact,
    safetyBlockers,
    warnings,
    candidates,
  };
}

function buildFlowSkillReadyCandidate(compact = {}, options = {}) {
  const sourceRefs = normalizeSourceRefs(compact.evidence?.sourceRefs, 20);
  const reusablePattern = normalizeFlowSkillReusablePatterns(compact);
  const candidateCore = {
    schemaVersion: 1,
    kind: "flowskill_candidate",
    visibility: "private",
    status: options.status || "private_review",
    task: {
      id: compact.task?.id || "unknown-task",
      goal: compactText(compact.task?.goal || "", 360),
      domain: safeArray(compact.task?.domain).map((item) => compactText(item, 80)).filter(Boolean).slice(0, 12),
      projectPath: compact.task?.projectPath || null,
      threadId: compact.task?.threadId || null,
      parentCeoThreadId: compact.task?.parentCeoThreadId || null,
    },
    evidence: {
      summary: compactText(compact.evidence?.summary || "", 900),
      reusablePattern,
      doNotApplyTo: normalizeFlowSkillDoNotApply(compact),
      tests: safeArray(compact.evidence?.tests).map((item) => compactText(item, 220)).filter(Boolean).slice(0, 30),
      artifacts: safeArray(compact.evidence?.artifacts).map((item) => compactText(item, 260)).filter(Boolean).slice(0, 30),
      changedFiles: safeArray(compact.evidence?.changedFiles).map((item) => compactText(item, 260)).filter(Boolean).slice(0, 30),
      residualRisk: compactText(compact.evidence?.residualRisk || "", 700),
      sourceRefs,
    },
    sourceRefs,
    privacy: {
      containsRawSession: compact.privacy?.containsRawSession === true,
      containsSecrets: compact.privacy?.containsSecrets === true,
      publicCandidateAllowed: false,
      redactionRequired: compact.privacy?.containsRawSession === true || compact.privacy?.containsSecrets === true,
    },
    promotion: {
      suggestedTarget: "flowskill_candidate",
      requiresUserConfirmation: true,
      reason: "accepted_reusable_pattern_private_candidate_only",
      captureDryRunOnly: true,
      publicExportAutomatic: false,
      installExecuteAutomatic: false,
    },
    effects: {
      runsFlowSkill: false,
      installsOrExecutes: false,
      exportsPublicly: false,
      archiveCompactDeleteMoveRestore: false,
      mutatesRawSession: false,
    },
  };
  const hash = hashJson(candidateCore);
  return {
    ...candidateCore,
    id: `flowskill-${safeIdPart(candidateCore.task.id)}-${hash.slice(0, 16)}`,
    hash,
    tokenEstimate: estimateTokensFromText(
      candidateCore.task.goal,
      candidateCore.evidence.summary,
      candidateCore.evidence.reusablePattern.join(" "),
      candidateCore.evidence.residualRisk,
    ),
    generatedAt: options.generatedAt || null,
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function runtimeSubdir(storeRoot, name) {
  return path.join(storeRoot, name);
}

function normalizeRuntimeEventType(value) {
  return RUNTIME_EVENT_TYPES.includes(value) ? value : "runtime_diagnosis";
}

function inferRuntimeEventType(event = {}) {
  const explicit = normalizeRuntimeEventType(event.eventType || event.type || event.kind);
  if (explicit !== "runtime_diagnosis") return explicit;
  const signalText = compactText([
    event.title,
    event.name,
    event.summary,
    event.message,
    event.error,
    event.reason,
    ...safeArray(event.observedSignals || event.signals),
  ].filter(Boolean).join(" "), 1600).toLowerCase();
  if (/(stream disconnected before completion|incomplete response returned|max_output_tokens|reconnect(?:ing)?\s+\d+\/\d+|自动压缩上下文|重新连接)/i.test(signalText)) {
    return "broken_thread";
  }
  if (/(heartbeat|心跳|ExampleProject|ExampleProjectup).*(fuse|pause|loop|熔断|暂停|空转)/i.test(signalText)) {
    return "heartbeat_fuse";
  }
  if (/(model|模型|reasoning|推理强度|降模型|改模型|5\.3|gpt-5\.3)/i.test(signalText)) {
    return "user_rule_update";
  }
  return explicit;
}

function normalizeRuntimeEventSeverity(value) {
  return RUNTIME_EVENT_SEVERITIES.includes(value) ? value : "warning";
}

function defaultWorkingMemoryStatusForRuntimeEvent(eventType) {
  if (["broken_thread", "heartbeat_fuse", "stale_lane_reference"].includes(eventType)) return "blocked";
  if (eventType === "thread_takeover") return "active";
  return "active";
}

function filterDefaultSafeSourceRefs(sourceRefs = []) {
  return safeArray(sourceRefs).filter((ref) => !sourceRefsContainRawSession([ref]) && !sourceRefsContainSecrets([ref]));
}

function runtimeEventTaskId(event) {
  const stableKey = [
    event.eventType,
    event.projectPath || "",
    event.threadId || "",
    event.automationId || "",
    event.replacementThreadId || "",
  ].filter(Boolean).join(":");
  return compactText(event.taskId || `runtime-event:${stableKey || hashJson(event).slice(0, 16)}`, 160);
}

function normalizeRuntimeEventMemory(event = {}) {
  const now = new Date().toISOString();
  const eventType = inferRuntimeEventType(event);
  const inputSourceRefs = normalizeSourceRefs(event.sourceRefs || event.evidence?.sourceRefs, 20);
  const defaultSourceRefs = filterDefaultSafeSourceRefs(inputSourceRefs).slice(0, 12);
  const unsafeSourceRefCount = Math.max(
    0,
    inputSourceRefs.length - defaultSourceRefs.length,
    clampNumber(event.unsafeSourceRefCount, 0, 0, 1000),
  );
  const warnings = [
    ...(unsafeSourceRefCount > 0 ? ["unsafe_source_refs_pointer_omitted_from_runtime_event_storage"] : []),
    ...safeArray(event.warnings).map((warning) => compactText(warning, 180)).filter(Boolean),
  ].filter((warning, index, array) => array.indexOf(warning) === index);
  const normalized = {
    schemaVersion: RUNTIME_EVENT_SCHEMA,
    eventType,
    severity: normalizeRuntimeEventSeverity(event.severity),
    projectPath: event.projectPath || event.project?.path || null,
    threadId: event.threadId || event.thread?.id || null,
    parentCeoThreadId: event.parentCeoThreadId || event.ceoThreadId || null,
    replacementThreadId: event.replacementThreadId || event.takeoverThreadId || null,
    automationId: event.automationId || event.heartbeatId || null,
    taskId: compactText(event.taskId || "", 160),
    title: compactText(event.title || event.name || eventType, 180),
    summary: compactText(event.summary || event.message || "", 900),
    observedSignals: safeArray(event.observedSignals || event.signals).map((item) => compactText(item, 220)).filter(Boolean).slice(0, 24),
    decisions: safeArray(event.decisions).map((item) => compactText(item, 220)).filter(Boolean).slice(0, 24),
    openRisks: safeArray(event.openRisks || event.risks).map((item) => compactText(item, 220)).filter(Boolean).slice(0, 24),
    nextAction: compactText(event.nextAction || "", 360),
    sourceRefs: defaultSourceRefs,
    defaultSourceRefs,
    unsafeSourceRefCount,
    status: WORKING_MEMORY_STATUSES.includes(event.status) ? event.status : defaultWorkingMemoryStatusForRuntimeEvent(eventType),
    ttlDays: clampNumber(event.ttlDays, ["broken_thread", "heartbeat_fuse", "thread_takeover"].includes(eventType) ? 14 : 7, 1, 90),
    warnings,
    createdAt: event.createdAt || now,
    updatedAt: event.updatedAt || now,
  };
  const idHash = hashJson({
    eventType: normalized.eventType,
    projectPath: normalized.projectPath,
    threadId: normalized.threadId,
    automationId: normalized.automationId,
    replacementThreadId: normalized.replacementThreadId,
    title: normalized.title,
  }).slice(0, 16);
  return {
    ...normalized,
    id: compactText(event.id || `runtime-event-${safeIdPart(normalized.eventType)}-${idHash}`, 180),
    taskId: runtimeEventTaskId({ ...normalized, taskId: normalized.taskId }),
    expiresAt: addMillisecondsToIso(normalized.updatedAt, normalized.ttlDays * 86_400_000),
    safety: {
      metadataOnly: true,
      rawSessionBodyRead: false,
      scansVault: false,
      startsTimers: false,
      archiveCompactDeleteMoveRestore: false,
      mutatesRawSession: false,
      installsOrExecutes: false,
    },
  };
}

function runtimeEventToWorkingMemoryRecord(event = {}) {
  return {
    taskId: event.taskId,
    projectPath: event.projectPath,
    threadId: event.replacementThreadId || event.threadId || null,
    parentCeoThreadId: event.parentCeoThreadId || null,
    status: event.status,
    currentGoal: event.summary || event.title,
    currentEvidence: [
      ...safeArray(event.defaultSourceRefs),
      { kind: "runtime_event", path: `memory-runtime://runtime-events/${event.id}`, title: event.title, updatedAt: event.updatedAt },
    ],
    decisions: event.decisions,
    openRisks: event.openRisks,
    nextAction: event.nextAction,
    updatedAt: event.updatedAt,
  };
}

function runtimeEventToRuntimeItem(event = {}) {
  const title = compactText(event.title || event.eventType || event.id, 180);
  const summaryParts = [
    event.summary,
    event.threadId ? `thread=${event.threadId}` : "",
    event.automationId ? `automation=${event.automationId}` : "",
    event.replacementThreadId ? `replacement=${event.replacementThreadId}` : "",
    event.nextAction ? `next=${event.nextAction}` : "",
  ].filter(Boolean);
  return {
    id: event.id,
    kind: "runtime_event",
    title,
    summary: compactText(summaryParts.join(" | "), 700),
    status: event.status === "blocked" ? "blocked" : "ready",
    freshness: "fresh",
    whyMatched: [
      `event:${event.eventType}`,
      event.severity ? `severity:${event.severity}` : "",
      ...safeArray(event.observedSignals).slice(0, 3),
    ].filter(Boolean),
    sourceRefs: [
      ...safeArray(event.defaultSourceRefs),
      { kind: "runtime_event", path: `memory-runtime://runtime-events/${event.id}`, title, updatedAt: event.updatedAt },
    ],
    tokenEstimate: estimateTokensFromText(title, event.summary, event.nextAction, safeArray(event.observedSignals).join(" ")),
  };
}

function workingMemoryToRuntimeItem(record = {}) {
  return {
    id: `working-memory:${safeIdPart(record.taskId)}`,
    kind: "runtime_event",
    title: compactText(`工作记忆：${record.taskId || "task"}`, 180),
    summary: compactText([record.currentGoal, record.nextAction].filter(Boolean).join(" | "), 700),
    status: record.status === "blocked" ? "blocked" : "ready",
    freshness: "fresh",
    whyMatched: [
      `workingMemory:${record.status || "active"}`,
      record.threadId ? `thread:${record.threadId}` : "",
      record.parentCeoThreadId ? `ceo:${record.parentCeoThreadId}` : "",
    ].filter(Boolean),
    sourceRefs: normalizeSourceRefs(record.currentEvidence, 8),
    tokenEstimate: estimateTokensFromText(record.currentGoal, record.nextAction, safeArray(record.decisions).join(" ")),
  };
}

async function writeRuntimeEventMemory(storeRoot, event = {}) {
  const normalized = normalizeRuntimeEventMemory(event);
  const eventPath = path.join(runtimeSubdir(storeRoot, "runtime-events"), `${safeIdPart(normalized.id)}.json`);
  await writeJson(eventPath, normalized);
  const workingMemory = await upsertWorkingMemoryRecord(storeRoot, runtimeEventToWorkingMemoryRecord(normalized));
  return {
    schemaVersion: MEMORY_RUNTIME_STORAGE_SCHEMA,
    id: normalized.id,
    status: "recorded",
    eventType: normalized.eventType,
    severity: normalized.severity,
    taskId: normalized.taskId,
    projectPath: normalized.projectPath,
    threadId: normalized.threadId,
    automationId: normalized.automationId,
    replacementThreadId: normalized.replacementThreadId,
    warnings: normalized.warnings,
    storagePath: eventPath,
    workingMemory,
    safety: normalized.safety,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

async function listRuntimeEventRecords(storeRoot, options = {}) {
  const root = runtimeSubdir(storeRoot, "runtime-events");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = await readJson(path.join(root, entry.name), null);
    if (!record) continue;
    if (options.eventType && record.eventType !== options.eventType) continue;
    if (options.status && record.status !== options.status) continue;
    if (options.projectPath && record.projectPath !== options.projectPath) continue;
    if (options.threadId && record.threadId !== options.threadId && record.replacementThreadId !== options.threadId && record.parentCeoThreadId !== options.threadId) continue;
    records.push({
      ...record,
      storagePath: path.join(root, entry.name),
    });
  }
  records.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return records.slice(0, Math.max(1, Math.min(Number(options.limit || 80), 200)));
}

function buildRuntimeItemsFromVolatileMemory({ events = [], workingMemory = [] } = {}) {
  return [
    ...safeArray(events).map(runtimeEventToRuntimeItem),
    ...safeArray(workingMemory).map(workingMemoryToRuntimeItem),
  ].filter(Boolean);
}

async function writeEvidenceWriteback(storeRoot, packet = {}) {
  const evaluated = evaluateWritebackEvidence(packet);
  const createdAt = new Date().toISOString();
  const evidenceHash = hashJson(evaluated.compact);
  const id = `writeback-${evidenceHash.slice(0, 16)}`;
  const flowSkillCandidates = evaluated.candidates
    .filter((candidate) => candidate.kind === "flowskill_candidate" && candidate.readyPacket)
    .map((candidate) => ({
      ...candidate.readyPacket,
      generatedAt: createdAt,
      sourceReceiptId: id,
    }));
  const receipt = {
    schemaVersion: MEMORY_RUNTIME_STORAGE_SCHEMA,
    id,
    hash: evidenceHash,
    createdAt,
    status: evaluated.status,
    decision: evaluated.compact.decision,
    taskId: evaluated.compact.task.id,
    safetyBlockers: evaluated.safetyBlockers,
    warnings: evaluated.warnings,
    candidateCount: evaluated.candidates.length,
    flowSkillCandidateCount: flowSkillCandidates.length,
    storagePath: path.join(runtimeSubdir(storeRoot, "evidence-writeback"), `${safeIdPart(id)}.json`),
  };
  const payload = {
    receipt,
    packet: evaluated.compact,
    candidates: evaluated.candidates,
    policy: {
      mutatesRawSession: false,
      archiveCompactDeleteMoveRestore: false,
      installsOrExecutesSkills: false,
      publicExportAutomatic: false,
    },
  };
  await writeJson(receipt.storagePath, payload);
  if (evaluated.candidates.length > 0) {
    await writeJson(path.join(runtimeSubdir(storeRoot, "candidate-queue"), `${safeIdPart(id)}.json`), {
      schemaVersion: MEMORY_RUNTIME_STORAGE_SCHEMA,
      sourceReceiptId: id,
      createdAt,
      candidates: evaluated.candidates,
    });
  }
  for (const candidate of flowSkillCandidates) {
    await writeJson(path.join(runtimeSubdir(storeRoot, "flowskill-candidates"), `${safeIdPart(candidate.id)}.json`), candidate);
  }
  return receipt;
}

async function listFlowSkillCandidateRecords(storeRoot, options = {}) {
  const root = runtimeSubdir(storeRoot, "flowskill-candidates");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = await readJson(path.join(root, entry.name), null);
    if (!record) continue;
    if (options.status && record.status !== options.status) continue;
    if (options.projectPath && record.task?.projectPath !== options.projectPath) continue;
    records.push({
      ...record,
      storagePath: path.join(root, entry.name),
    });
  }
  records.sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
  return records.slice(0, Math.max(1, Math.min(Number(options.limit || 80), 200)));
}

function normalizeWorkingMemoryRecord(record = {}) {
  const now = new Date().toISOString();
  const taskId = compactText(record.taskId || record.task?.id || "", 140);
  if (!taskId) throw new Error("WorkingMemoryRecord requires taskId.");
  const status = WORKING_MEMORY_STATUSES.includes(record.status) ? record.status : "active";
  return {
    schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
    taskId,
    projectPath: record.projectPath || null,
    threadId: record.threadId || null,
    parentCeoThreadId: record.parentCeoThreadId || null,
    status,
    currentGoal: compactText(record.currentGoal || record.goal || "", 600),
    currentEvidence: normalizeSourceRefs(record.currentEvidence || record.sourceRefs, 12),
    decisions: safeArray(record.decisions).map((item) => compactText(item, 240)).filter(Boolean).slice(0, 30),
    openRisks: safeArray(record.openRisks).map((item) => compactText(item, 240)).filter(Boolean).slice(0, 30),
    nextAction: compactText(record.nextAction || "", 360),
    updatedAt: record.updatedAt || now,
  };
}

async function upsertWorkingMemoryRecord(storeRoot, record = {}) {
  const normalized = normalizeWorkingMemoryRecord(record);
  const filePath = path.join(runtimeSubdir(storeRoot, "working-memory"), `${safeIdPart(normalized.taskId)}.json`);
  await writeJson(filePath, normalized);
  return { ...normalized, storagePath: filePath };
}

async function listWorkingMemoryRecords(storeRoot, options = {}) {
  const root = runtimeSubdir(storeRoot, "working-memory");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = await readJson(path.join(root, entry.name), null);
    if (!record) continue;
    if (options.status && record.status !== options.status) continue;
    if (options.projectPath && record.projectPath !== options.projectPath) continue;
    records.push(record);
  }
  records.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return records.slice(0, Math.max(1, Math.min(Number(options.limit || 80), 200)));
}

function evaluatePromotionCandidate(candidate = {}) {
  const privacy = candidate.privacy && typeof candidate.privacy === "object" ? candidate.privacy : {};
  const requestedTarget = compactText(candidate.target || candidate.kind || "experience_card", 80);
  const target = SAFE_MEMORY_TARGETS.includes(requestedTarget) ? requestedTarget : "experience_card";
  const sourceRefs = normalizeSourceRefs(candidate.sourceRefs || candidate.evidence?.sourceRefs, 12);
  const containsRawSession = privacy.containsRawSession === true || candidate.containsRawSession === true || inferContainsRawSession(candidate, sourceRefs);
  const containsSecrets = privacy.containsSecrets === true || candidate.containsSecrets === true || inferContainsSecrets(candidate, sourceRefs);
  const blockers = [];
  const warnings = [];
  if (containsRawSession) blockers.push("contains_raw_session");
  if (containsSecrets) blockers.push("contains_secrets");
  if (privacy.publicExportRequested === true || candidate.publicExportRequested === true) blockers.push("public_export_requires_confirmation");
  if (containsDangerousIntent(candidate)) blockers.push("install_execute_archive_or_destructive_intent");
  if (sourceRefs.length === 0) warnings.push("missing_source_refs_candidate_only");
  const status = blockers.length > 0 ? "review" : warnings.length > 0 ? "candidate_review" : "queued_candidate";
  return {
    schemaVersion: MEMORY_RUNTIME_STORAGE_SCHEMA,
    id: candidate.id || `promotion-${hashJson(candidate).slice(0, 16)}`,
    target,
    title: compactText(candidate.title || candidate.name || target, 180),
    summary: compactText(candidate.summary || candidate.body || "", 800),
    status,
    sourceRefs,
    blockers,
    warnings,
    requiresHumanConfirmation: true,
    effects: {
      installsOrExecutes: false,
      exportsPublicly: false,
      archiveCompactDeleteMoveRestore: false,
      mutatesRawSession: false,
    },
  };
}

async function promoteMemoryCandidate(storeRoot, candidate = {}) {
  const evaluated = evaluatePromotionCandidate(candidate);
  const createdAt = new Date().toISOString();
  const payload = { ...evaluated, createdAt, updatedAt: createdAt };
  const filePath = path.join(runtimeSubdir(storeRoot, "promotion-candidates"), `${safeIdPart(payload.id)}.json`);
  await writeJson(filePath, payload);
  return { ...payload, storagePath: filePath };
}

module.exports = {
  DEFAULT_PRECEDENT_ALLOWED_KINDS,
  DEFAULT_RUNTIME_ALLOWED_KINDS,
  MEMORY_RUNTIME_SCHEMA_VERSION,
  buildHotStateCacheSeed,
  buildMemoryGraph,
  buildMemoryRouterPlan,
  buildRuntimeContextPacket,
  buildRuntimePrecedentPacket,
  buildRuntimePrecedentRequest,
  buildThreadRecoveryPacket,
  buildFlowSkillReadyCandidate,
  buildActivatedMemoryGraph,
  buildRuntimeItemsFromVolatileMemory,
  evaluatePromotionCandidate,
  evaluateWritebackEvidence,
  listFlowSkillCandidateRecords,
  listRuntimeEventRecords,
  listWorkingMemoryRecords,
  mergeMemoryGraphs,
  normalizeRuntimeEventMemory,
  normalizeRuntimeItem,
  promoteMemoryCandidate,
  upsertWorkingMemoryRecord,
  writeRuntimeEventMemory,
  writeEvidenceWriteback,
};
