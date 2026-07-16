const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const KNOWLEDGE_FILES = [
  { kind: "resume", fileName: "project-resume.md", maxChars: 360, status: "review", freshness: "review", humanConfirmation: true, priority: 26 },
  { kind: "retrieval_packet", fileName: "retrieval-packet.md", maxChars: 360, status: "active", freshness: "fresh", humanConfirmation: false, priority: 28 },
  { kind: "project_index", fileName: "project-index.md", maxChars: 300, status: "active", freshness: "fresh", humanConfirmation: false, priority: 19 },
  { kind: "project", fileName: "project-knowledge.md", maxChars: 260, status: "compatibility", freshness: "fresh", humanConfirmation: false, priority: 8 },
  { kind: "context", fileName: "context.md", maxChars: 280, status: "active", freshness: "fresh", humanConfirmation: false, priority: 16 },
  { kind: "knowledge", fileName: "knowledge-items.md", maxChars: 280, status: "ready", freshness: "fresh", humanConfirmation: false, priority: 22 },
  { kind: "experience", fileName: "experience-cards.md", maxChars: 320, status: "curated", freshness: "fresh", humanConfirmation: false, priority: 24 },
  { kind: "artifacts", fileName: "project-artifacts.md", maxChars: 300, status: "review", freshness: "review", humanConfirmation: true, priority: 20 },
  { kind: "skill_candidates", fileName: "skill-candidates.md", maxChars: 260, status: "draft", freshness: "review", humanConfirmation: true, priority: 12 },
  { kind: "tool_inventory", fileName: "tool-skill-inventory.md", maxChars: 300, status: "candidate", freshness: "review", humanConfirmation: true, priority: 14 },
];

const KIND_ALIASES = {
  resume: "resume",
  project_resume: "resume",
  project_resume_packet: "resume",
  retrieval_packet: "retrieval_packet",
  packet: "retrieval_packet",
  project_index: "project_index",
  index: "project_index",
  project: "project",
  context: "context",
  knowledge: "knowledge",
  experience: "experience",
  artifact: "artifacts",
  artifacts: "artifacts",
  project_artifact: "artifacts",
  project_artifacts: "artifacts",
  skill_candidates: "skill_candidates",
  skill_candidate: "skill_candidates",
  tool_inventory: "tool_inventory",
  tool_skill_inventory: "tool_inventory",
  tool_skill: "tool_inventory",
  tools: "tool_inventory",
  memory_fact: "memory_fact",
  memory_facts: "memory_fact",
  memory_core: "memory_core",
  project_brain: "project_brain",
  project_anchor: "project_anchor",
  module_memory: "module_memory",
  standing_rule: "standing_rule",
  episode: "episode",
  memory_episode: "episode",
  decision: "decision",
  memory_decision: "decision",
  constraint: "constraint",
  memory_constraint: "constraint",
  project_checkpoint: "project_checkpoint",
};

const DEFAULT_QUERY_TYPE = "task_dispatch";
const DEFAULT_LIMIT = 6;
const DEFAULT_TOKEN_BUDGET = 1200;
const DEFAULT_RECOVERY_TOKEN_BUDGET = 1800;
const MAX_LIMIT = 40;
const MIN_TOKEN_BUDGET = 200;
const MAX_TOKEN_BUDGET = 4000;
const MB = 1024 * 1024;
const MAX_KNOWLEDGE_FILE_BYTES = 256 * 1024;
const MAX_RECOVERY_RECOMMENDED_DOC_BYTES = 768 * 1024;
const RUNTIME_ALLOWED_KINDS = [
  "project_record",
  "project_resume_packet",
  "ceo_flow_record",
  "thread_lineage_index",
  "project_artifact",
  "knowledge_item",
  "experience_card",
  "skill_candidate",
  "tool_skill_record",
  "thread_history_hot",
  "thread_history_warm",
  "memory_fact",
  "project_brain",
  "project_anchor",
  "module_memory",
  "standing_rule",
  "memory_episode",
  "memory_decision",
  "memory_constraint",
  "project_checkpoint",
];
const PRECEDENT_KINDS = [
  "memory_fact", "memory_core", "project_brain", "project_anchor", "module_memory", "standing_rule",
  "episode", "decision", "constraint", "project_checkpoint", "knowledge", "experience", "artifacts", "tool_inventory", "skill_candidates",
];
const COLD_QUERY_TYPES = new Set(["thread_recovery", "archive_candidate"]);
const MAINTENANCE_QUERY_RE = /\b(archive|guardian|vault|thread[_ -]?history|thread[_ -]?recovery|runtime[_ -]?diagnosis|log|cpu|memory)\b|归档|减负|瘦身|老线程|线程恢复|历史库|运行日志|卡顿|性能/i;
const MAINTENANCE_ITEM_RE = /\b(guardian inventory|thread history vault|archive queue|archive bridge|read-only scout|neutral reviewer|bounded read-only|old thread|thread slimming|thread recovery|runtime monitor)\b|老线程优化|一键安全减负|归档|瘦身|线程审计|审计线程|维护线程|只读审计|只读.*CEO/i;
const PRODUCT_ITEM_RE = /\b(accepted ui|accepted engine|prd|technical design|program goal|current accepted|project status|module|scene|workbench|runtime adapter|game studio)\b|当前验收|产品|模块|架构|引擎|游戏|设计/i;
const RECOVERY_DOCS = [
  "docs/PROGRAM_GOAL_BRIEF.md",
  "docs/PRD.md",
  "docs/TECHNICAL_DESIGN.md",
  "docs/TEST_PLAN.md",
  "docs/RELEASE_NOTES.md",
  "docs/CEO_FLOW_MEMORY_RUNTIME.md",
  "docs/EXAMPLE_PROJECT_CEO_RECOVERY_PACKET.md",
  "docs/EXAMPLE_PROJECT_CEO_TRANSCRIPT_EXTRACT.md",
  "docs/EXAMPLE_PROJECT_NEW_THREAD_START.md",
  ".codex-knowledge/project-resume.md",
  ".codex-knowledge/retrieval-packet.md",
  ".codex-knowledge/project-index.md",
  ".codex-knowledge/project-artifacts.md",
  ".codex-knowledge/knowledge-items.md",
  ".codex-knowledge/experience-cards.md",
];
const RUNTIME_KIND_BY_HELPER_KIND = {
  resume: "project_resume_packet",
  retrieval_packet: "project_resume_packet",
  project_index: "project_record",
  project: "project_record",
  context: "project_artifact",
  knowledge: "knowledge_item",
  experience: "experience_card",
  artifacts: "project_artifact",
  skill_candidates: "skill_candidate",
  tool_inventory: "tool_skill_record",
  memory_fact: "memory_fact",
};
const WRITEBACK_DECISIONS = ["accept", "revise", "block", "supersede"];
const SECRET_REF_RE = /(?:^|[\\/])\.env(?:$|[\\/._-])|\b(api[_ -]?key|auth[_ -]?token|bearer[_ -]?token|credential|credentials|secret|secrets|private[_ -]?key|id_rsa|oauth|cookie|password)\b/i;
const RAW_SESSION_RE = /(?:^|[\\/])\.codex[\\/]sessions[\\/]|(?:raw|codex|thread)[_ -]?session|session[_ -]?jsonl/i;
const BASE64_RE = /\bdata:[^;,\s]+;base64,[A-Za-z0-9+/=]{80,}|\b[A-Za-z0-9+/]{180,}={0,2}\b/g;
const MEMORY_FACT_DB_NAME = "memory-runtime-index.sqlite";
const MEMORY_FACT_DB_DIR = "memory-runtime";
const MEMORY_FACT_PRODUCT_DIR = "知匣 Local Doc Knowledge";
const MEMORY_FACT_BUSY_TIMEOUT_MS = 100;
const MEMORY_FACT_QUERY_LIMIT = 80;
const MAX_MEMORY_FACT_VALUE_CHARS = 4096;
const MAX_MEMORY_FACT_SOURCE_REFS_CHARS = 8192;
const MAX_MEMORY_FACT_SOURCE_REFS = 16;
const MAX_MEMORY_FACT_SCAN_NODES = 1024;
const MAX_MEMORY_FACT_SCAN_DEPTH = 8;
const MAX_MEMORY_FACT_SCAN_KEYS = 32;
const MAX_MEMORY_FACT_SCAN_ARRAY = 32;
const MAX_MEMORY_FACT_SCAN_STRING_CHARS = 4096;
const MEMORY_FACT_ALLOWED_STATUSES = new Set(["active", "current", "accepted"]);
const MEMORY_FACT_BASE64_RE = /data:[^;,\s]+;base64,[A-Za-z0-9+/=]{48,}|(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{180,}={0,2}(?:$|[^A-Za-z0-9+/])/i;
const MEMORY_FACT_SECRET_VALUE_RE = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,}|\bAKIA[0-9A-Z]{16}\b/i;
const MEMORY_CORE_SIDECAR_SCHEMA = "zhixia.memory_core_sidecar.v1";
const MEMORY_CORE_CONTINUITY_SCHEMA = "zhixia.memory_core_continuity_status.v1";
const MEMORY_CORE_REVIEW_QUEUE_SCHEMA = "zhixia.memory_core_review_queue.v1";
const MEMORY_CORE_DIAGNOSTICS_SCHEMA = "zhixia.memory_core_diagnostics.v1";
const MEMORY_CORE_CURRENT_STATUSES = new Set(["accepted", "curated"]);
const MEMORY_CORE_REVIEW_STATUSES = new Set(["candidate", "review"]);
const MEMORY_CORE_HISTORICAL_STATUSES = new Set(["rejected", "revoked", "expired", "superseded", "historical", "inactive"]);
const MEMORY_CORE_TABLE_SPECS = Object.freeze([
  { table: "memory_project_brains", recordKind: "project_brain", runtimeKind: "project_brain" },
  { table: "memory_project_anchors", recordKind: "project_anchor", runtimeKind: "project_anchor" },
  { table: "memory_modules", recordKind: "module_memory", runtimeKind: "module_memory" },
  { table: "memory_standing_rules", recordKind: "standing_rule", runtimeKind: "standing_rule" },
  { table: "memory_episodes", recordKind: "episode", runtimeKind: "memory_episode" },
  { table: "memory_decisions", recordKind: "decision", runtimeKind: "memory_decision" },
  { table: "memory_constraints", recordKind: "constraint", runtimeKind: "memory_constraint" },
  { table: "memory_project_checkpoints", recordKind: "project_checkpoint", runtimeKind: "project_checkpoint" },
]);
const MEMORY_CORE_REQUIRED_COLUMNS = Object.freeze([
  "id", "projectId", "scopeKey", "status", "type", "updatedAt", "validFrom", "validTo", "createdAt", "payloadJson", "contentHash",
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
const SINGLE_VALUE_CONTINUITY_SLOTS = new Set(["project_identity", "original_product_goal", "current_phase", "last_valid_checkpoint"]);
const ACTIVE_MODULE_STATUSES = new Set(["active", "current", "ready", "in_progress", "blocked", "waiting_review"]);
const CLOSED_TASK_STATUSES = new Set(["accepted", "completed", "done", "closed", "cancelled", "superseded"]);
const MEMORY_CORE_ALLOWED_HELPER_KINDS = Object.freeze(MEMORY_CORE_TABLE_SPECS.map((spec) => spec.recordKind));
const MAX_MEMORY_CORE_PAYLOAD_CHARS = 32 * 1024;
const MAX_MEMORY_CORE_ROWS_PER_TABLE = 120;
const MAX_MEMORY_CORE_DIAGNOSTIC_TABLES = 16;
const DEFAULT_MEMORY_CORE_PAGE_SIZE = 10;
const MAX_MEMORY_CORE_PAGE_SIZE = 25;
const MAX_MEMORY_CORE_CURSOR_OFFSET = 500;
const AUTHORITY_VERIFICATION_UNAVAILABLE = "unavailable";
const MEMORY_CORE_FORBIDDEN_KEY_RE = /^(?:signingKey|receiptSigningKey|receiptProof|proof|trustContext|trustState|raw|rawBody|body|content|contentText|transcript|session|sessions|messages|payload|blob|binary|base64|secret|password|passwd|apiKey|authToken|accessToken|refreshToken|privateKey|credential|credentials|cookie)$/i;
const MEMORY_CORE_FAILURE_RE = /(?:failure|failed|error|regression|bug|crash|blocked|test_failure)/i;

function redactUnsafeText(text) {
  return String(text || "")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]*\.codex[\\/]sessions[\\/][^\s"'<>|]+/gi, "[raw-session-pointer-omitted]")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]*\.env(?:\.[^\s"'<>|]+)?/gi, "[secret-pointer-omitted]")
    .replace(/\b(?:api[_-]?key|auth[_-]?token|bearer[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[secret-omitted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [secret-omitted]")
    .replace(/\bsk-[A-Za-z0-9]{12,}\b/gi, "[secret-omitted]")
    .replace(BASE64_RE, "[base64-payload-omitted]");
}

function cleanText(text) {
  return redactUnsafeText(text).replace(/\s+/g, " ").trim();
}

function compact(text, maxChars) {
  const clean = cleanText(text);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function compactKnowledgeExcerpt(text, maxChars) {
  const cleaned = redactUnsafeText(text)
    .replace(/^\s*重复文件。?\s*/i, "")
    .replace(/^\s*重复文件。?\s*/gim, "")
    .replace(/---\s*source:[\s\S]*/i, "来源详情见 source pointer。")
    .replace(/^\s*-?\s*(Id|Scope|Status|SourcePath|SourceHash|SourceRefs|SourceType|Freshness|RequiresHumanConfirmation|RawSessionPolicy|TokenEstimate|SourceDocumentUpdatedAt|Tags):.*$/gim, "")
    .replace(/^\s*(source|thread_id|source_bucket|source_path|sha256|model|provider):.*$/gim, "")
    .replace(/\s*-?\s*(Id|Scope|Status|SourcePath|SourceHash|SourceRefs|SourceType|Freshness|RequiresHumanConfirmation|RawSessionPolicy|TokenEstimate|SourceDocumentUpdatedAt|Tags):\s*.*?(?=\s+-\s+[A-Za-z]+:|$)/gi, "")
    .replace(/"\s*(source_path|source_bucket|thread_id|sha256)"\s*:\s*"[^"]*"/gi, "\"sourcePointer\":\"retained\"")
    .replace(/\bsource_path:\s*\"[^\"]+\"/gi, "source pointer retained")
    .replace(/\bsource_path:\s*[^\s,}]+/gi, "source pointer retained")
    .replace(/\bimage_url\b[\s\S]{0,240}/gi, "image pointer retained")
    .replace(/\braw[_ -]?session\b[\s\S]{0,180}/gi, "raw session pointer omitted");
  return compact(cleaned || text, maxChars);
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseIncludeKinds(raw) {
  const normalized = String(raw || "")
    .split(",")
    .map((item) => KIND_ALIASES[item.trim().toLowerCase()])
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function parseArgs(argv) {
  const args = {
    workspace: null,
    query: "",
    queryType: DEFAULT_QUERY_TYPE,
    limit: DEFAULT_LIMIT,
    tokenBudget: DEFAULT_TOKEN_BUDGET,
    includeKinds: [],
    allowParentKnowledge: false,
    json: false,
    runtimeContext: false,
    precedent: false,
    recoverThread: false,
    ceoTakeover: false,
    evaluateCeoPressure: false,
    threadId: "",
    threadTitle: "",
    parentCeoThreadId: "",
    currentCeoThreadId: "",
    replacementThreadId: "",
    staleThreadIds: [],
    projectName: "",
    projectSummary: "",
    taskGoal: "",
    sessionBytes: 0,
    lineCount: 0,
    maxLineChars: 0,
    linesOver100k: 0,
    dataImageHits: 0,
    base64Hits: 0,
    imagePathHits: 0,
    toolOutputLikeHits: 0,
    visibleThreadCount: 0,
    activeWorkerCount: 0,
    longTitleCount: 0,
    writebackDryRun: false,
    evidenceJson: "",
    evidenceOut: "",
    decision: "",
    taskId: "",
    summary: "",
    sourceRefs: [],
    memoryMode: "layered",
    allowColdLayer: false,
    continuityStatus: false,
    memoryReviewQueue: false,
    memoryDiagnostics: false,
    projectId: "",
    cursor: "",
    pageSize: DEFAULT_MEMORY_CORE_PAGE_SIZE,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--query") {
      args.query = argv[index + 1] || "";
      index += 1;
    } else if (item === "--task-goal") {
      args.taskGoal = argv[index + 1] || "";
      if (!args.query) args.query = args.taskGoal;
      index += 1;
    } else if (item === "--query-type") {
      args.queryType = cleanText(argv[index + 1] || "") || DEFAULT_QUERY_TYPE;
      index += 1;
    } else if (item === "--limit") {
      args.limit = clampNumber(argv[index + 1], 1, MAX_LIMIT, args.limit);
      index += 1;
    } else if (item === "--token-budget") {
      args.tokenBudget = clampNumber(argv[index + 1], MIN_TOKEN_BUDGET, MAX_TOKEN_BUDGET, args.tokenBudget);
      index += 1;
    } else if (item === "--include-kinds") {
      args.includeKinds = parseIncludeKinds(argv[index + 1] || "");
      index += 1;
    } else if (item === "--allow-parent-knowledge") {
      args.allowParentKnowledge = true;
    } else if (item === "--json") {
      args.json = true;
    } else if (item === "--runtime-context" || item === "--retrieve-context") {
      args.runtimeContext = true;
    } else if (item === "--precedent" || item === "--retrieve-precedent") {
      args.precedent = true;
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        args.query = argv[index + 1];
        index += 1;
      }
    } else if (item === "--recover-thread" || item === "--retrieve-thread") {
      args.recoverThread = true;
      args.queryType = "thread_recovery";
      args.tokenBudget = Math.max(args.tokenBudget, DEFAULT_RECOVERY_TOKEN_BUDGET);
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        args.query = argv[index + 1];
        index += 1;
      }
    } else if (item === "--ceo-takeover" || item === "--takeover-bootstrap") {
      args.ceoTakeover = true;
      args.queryType = "thread_recovery";
      args.tokenBudget = Math.max(args.tokenBudget, DEFAULT_RECOVERY_TOKEN_BUDGET);
    } else if (item === "--evaluate-ceo-pressure" || item === "--thread-pressure") {
      args.evaluateCeoPressure = true;
    } else if (item === "--thread-id") {
      args.threadId = cleanText(argv[index + 1] || "");
      if (!args.query) args.query = args.threadId;
      index += 1;
    } else if (item === "--thread-title" || item === "--title") {
      args.threadTitle = cleanText(argv[index + 1] || "");
      if (!args.query) args.query = args.threadTitle;
      index += 1;
    } else if (item === "--parent-ceo-thread-id") {
      args.parentCeoThreadId = cleanText(argv[index + 1] || "");
      index += 1;
    } else if (item === "--current-ceo-thread-id") {
      args.currentCeoThreadId = cleanText(argv[index + 1] || "");
      index += 1;
    } else if (item === "--replacement-thread-id") {
      args.replacementThreadId = cleanText(argv[index + 1] || "");
      index += 1;
    } else if (item === "--stale-thread-ids") {
      args.staleThreadIds = String(argv[index + 1] || "").split(",").map((value) => cleanText(value)).filter(Boolean).slice(0, 20);
      index += 1;
    } else if (item === "--project-name") {
      args.projectName = compact(argv[index + 1] || "", 160);
      index += 1;
    } else if (item === "--project-summary") {
      args.projectSummary = compact(argv[index + 1] || "", 700);
      index += 1;
    } else if (item === "--session-bytes") {
      args.sessionBytes = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--session-mb") {
      args.sessionBytes = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER / MB, 0) * MB;
      index += 1;
    } else if (item === "--line-count") {
      args.lineCount = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--max-line-chars") {
      args.maxLineChars = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--lines-over-100k") {
      args.linesOver100k = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--data-image-hits") {
      args.dataImageHits = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--base64-hits") {
      args.base64Hits = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--image-path-hits") {
      args.imagePathHits = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--tool-output-like-hits") {
      args.toolOutputLikeHits = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--visible-thread-count") {
      args.visibleThreadCount = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--active-worker-count") {
      args.activeWorkerCount = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--long-title-count") {
      args.longTitleCount = clampNumber(argv[index + 1], 0, Number.MAX_SAFE_INTEGER, 0);
      index += 1;
    } else if (item === "--writeback-dry-run") {
      args.writebackDryRun = true;
    } else if (item === "--evidence-json") {
      args.evidenceJson = argv[index + 1] || "";
      index += 1;
    } else if (item === "--evidence-out") {
      args.evidenceOut = argv[index + 1] || "";
      index += 1;
    } else if (item === "--decision") {
      args.decision = argv[index + 1] || "";
      index += 1;
    } else if (item === "--task-id") {
      args.taskId = argv[index + 1] || "";
      index += 1;
    } else if (item === "--summary") {
      args.summary = argv[index + 1] || "";
      index += 1;
    } else if (item === "--source-ref") {
      args.sourceRefs.push(parseSourceRefArg(argv[index + 1] || ""));
      index += 1;
    } else if (item === "--memory-mode") {
      args.memoryMode = cleanText(argv[index + 1] || "layered") || "layered";
      index += 1;
    } else if (item === "--allow-cold-layer") {
      args.allowColdLayer = true;
    } else if (item === "--continuity-status" || item === "--project-continuity") {
      args.continuityStatus = true;
    } else if (item === "--memory-review-queue" || item === "--review-queue") {
      args.memoryReviewQueue = true;
    } else if (item === "--memory-diagnostics" || item === "--diagnostics-summary") {
      args.memoryDiagnostics = true;
    } else if (item === "--project-id") {
      args.projectId = compact(argv[index + 1] || "", 180);
      index += 1;
    } else if (item === "--cursor" || item === "--mandatory-cursor") {
      args.cursor = compact(argv[index + 1] || "", 260);
      index += 1;
    } else if (item === "--page-size") {
      args.pageSize = clampNumber(argv[index + 1], 1, MAX_MEMORY_CORE_PAGE_SIZE, DEFAULT_MEMORY_CORE_PAGE_SIZE);
      index += 1;
    } else if (!args.workspace) {
      args.workspace = item;
    }
  }
  if (args.queryType === "retrieve_context") args.runtimeContext = true;
  if (args.queryType === "retrieve_precedent") args.precedent = true;
  if (args.queryType === "recover_thread" || args.queryType === "thread_recovery") args.recoverThread = true;
  if (args.precedent && args.includeKinds.length === 0) args.includeKinds = PRECEDENT_KINDS;
  if (args.recoverThread && !args.query) args.query = [args.threadId, args.threadTitle, args.taskGoal].filter(Boolean).join(" ");
  if (args.recoverThread || COLD_QUERY_TYPES.has(args.queryType) || MAINTENANCE_QUERY_RE.test([args.query, args.taskGoal, args.threadTitle].join(" "))) {
    args.allowColdLayer = true;
  }
  return args;
}

function parseSourceRefArg(raw) {
  const [kindAndPath, title = "evidence"] = String(raw || "").split("#");
  const [kind, ...pathParts] = kindAndPath.includes(":") ? kindAndPath.split(":") : ["source", kindAndPath];
  return {
    kind: cleanText(kind || "source") || "source",
    path: pathParts.join(":") || kindAndPath,
    title: cleanText(title || "evidence") || "evidence",
  };
}

function hasKnowledgeFiles(dir) {
  return KNOWLEDGE_FILES.some((entry) => fs.existsSync(path.join(dir, ".codex-knowledge", entry.fileName)));
}

function findWorkspace(startDir, allowParentKnowledge = false) {
  const start = path.resolve(startDir || process.cwd());
  if (!allowParentKnowledge) return start;
  let current = start;
  while (true) {
    if (hasKnowledgeFiles(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function tokenizeQuery(query) {
  return cleanText(query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
}

function estimateTokens(text) {
  return Math.max(24, Math.ceil(cleanText(text).length / 4));
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function readKnowledgeFile(filePath) {
  const stats = fs.statSync(filePath);
  const truncated = stats.size > MAX_KNOWLEDGE_FILE_BYTES;
  const fd = fs.openSync(filePath, "r");
  try {
    const bytesToRead = Math.min(stats.size, MAX_KNOWLEDGE_FILE_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      stats,
      truncated,
      originalBytes: stats.size,
      readBytes: bytesRead,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function splitBlocks(content) {
  const blocks = [];
  const lines = String(content || "").split(/\r?\n/);
  let current = { title: "Overview", lines: [] };
  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (cleanText(current.lines.join("\n"))) blocks.push(current);
      current = { title: heading[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (cleanText(current.lines.join("\n"))) blocks.push(current);
  return blocks;
}

function scoreTokens(tokens, fields) {
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const token of tokens) {
    for (const field of fields) {
      const text = cleanText(field.text).toLowerCase();
      if (!text) continue;
      if (text === token) {
        score += field.exactWeight || field.weight * 2;
      } else if (text.includes(token)) {
        score += field.weight;
      }
    }
  }
  return score;
}

function isMaintenanceQuery(options = {}) {
  return Boolean(options.allowColdLayer || COLD_QUERY_TYPES.has(options.queryType) || MAINTENANCE_QUERY_RE.test([
    options.query,
    options.taskGoal,
    options.threadTitle,
  ].filter(Boolean).join(" ")));
}

function isMaintenanceItem(entry, block, excerpt) {
  return MAINTENANCE_ITEM_RE.test([entry.kind, entry.fileName, block.title, excerpt].filter(Boolean).join(" "));
}

function isProductItem(entry, block, excerpt) {
  return PRODUCT_ITEM_RE.test([entry.kind, entry.fileName, block.title, excerpt].filter(Boolean).join(" "));
}

function queryTypeKindAdjustment(entry, options, block, excerpt) {
  const queryType = options.queryType || DEFAULT_QUERY_TYPE;
  let adjustment = 0;
  const reasons = [];
  if (["project_resume", "task_dispatch"].includes(queryType)) {
    if (entry.kind === "retrieval_packet") {
      adjustment += 18;
      reasons.push("layer:current_project_packet");
    } else if (entry.kind === "resume") {
      adjustment += 12;
      reasons.push("layer:project_resume");
    } else if (entry.kind === "project_index" || entry.kind === "artifacts") {
      adjustment += 8;
      reasons.push("layer:project_map");
    }
  }
  if (["bug_repair", "review_gate", "architecture"].includes(queryType) && entry.kind === "experience") {
    adjustment += 10;
    reasons.push("layer:experience_precedent");
  }
  if (["tool_skill_lookup", "workflow_reuse"].includes(queryType) && ["tool_inventory", "skill_candidates", "experience"].includes(entry.kind)) {
    adjustment += 16;
    reasons.push("layer:procedural_memory");
  }
  const maintenance = isMaintenanceItem(entry, block, excerpt);
  if (maintenance && !isMaintenanceQuery(options)) {
    adjustment -= 45;
    reasons.push("maintenance_memory_demoted_for_product_query");
  }
  if (!maintenance && isProductItem(entry, block, excerpt) && !isMaintenanceQuery(options)) {
    adjustment += 8;
    reasons.push("product_memory_promoted");
  }
  return { adjustment, reasons, maintenance };
}

function memoryLayerForHelperItem(entry, item, options = {}) {
  const maintenance = item.isMaintenance === true || MAINTENANCE_ITEM_RE.test([item.title, item.excerpt].join(" "));
  if (["skill_candidates", "tool_inventory", "experience"].includes(entry.kind || item.kind)) return "skill";
  if (maintenance || ["thread_history_hot", "thread_history_warm"].includes(entry.kind || item.kind)) {
    return isMaintenanceQuery(options) ? "cold" : "warm";
  }
  if (["retrieval_packet", "project_index", "context"].includes(entry.kind || item.kind)) return "hot";
  if ((entry.kind || item.kind) === "resume") return item.freshness === "fresh" ? "hot" : "warm";
  if (item.freshness === "fresh" && ["active", "ready", "curated"].includes(item.status)) return "warm";
  return "warm";
}

function whyMatched(tokens, fields, baselineReasons = []) {
  const reasons = [...baselineReasons];
  const normalizedFields = fields.map((field) => ({
    label: field.label,
    text: cleanText(field.text).toLowerCase(),
  }));
  for (const token of tokens) {
    const matches = normalizedFields.filter((field) => field.text.includes(token)).map((field) => field.label);
    if (matches.length > 0) reasons.push(`token:${token}@${matches.join("+")}`);
  }
  return Array.from(new Set(reasons.filter(Boolean))).slice(0, 8);
}

function buildSourceRef(entry, filePath, block, fileContent, stats) {
  return {
    kind: entry.kind,
    path: filePath,
    title: block.title,
    hash: hashText(`${entry.kind}|${fileContent}|${block.title}`),
    updatedAt: stats?.mtime?.toISOString?.() || null,
  };
}

function collectItems(workspace, options) {
  const bundleDir = path.join(workspace, ".codex-knowledge");
  const tokens = tokenizeQuery(options.query);
  const items = [];
  const files = [];
  const warnings = [];
  const allowedKinds = new Set(options.includeKinds.length > 0 ? options.includeKinds : KNOWLEDGE_FILES.map((entry) => entry.kind));

  for (const entry of KNOWLEDGE_FILES) {
    if (!allowedKinds.has(entry.kind)) continue;
    const filePath = path.join(bundleDir, entry.fileName);
    if (!fs.existsSync(filePath)) continue;
    const { content: fileContent, stats, truncated, originalBytes, readBytes } = readKnowledgeFile(filePath);
    if (truncated) {
      warnings.push(`${entry.fileName} exceeded ${MAX_KNOWLEDGE_FILE_BYTES} bytes; helper read only the first ${readBytes} bytes and omitted the remainder.`);
    }
    files.push({
      kind: entry.kind,
      path: filePath,
      bytes: originalBytes,
      readBytes,
      truncated,
      hash: hashText(fileContent),
      updatedAt: stats.mtime.toISOString(),
      freshness: entry.freshness,
      status: entry.status,
    });

    const blocks = splitBlocks(fileContent);
    for (const block of blocks) {
      const excerpt = compactKnowledgeExcerpt(block.lines.join("\n"), entry.maxChars);
      const textScore = scoreTokens(tokens, [
        { text: block.title, weight: 16, exactWeight: 28 },
        { text: excerpt, weight: 6 },
        { text: entry.kind, weight: 4 },
        { text: entry.fileName, weight: 3 },
      ]);
      const baselineScore = entry.priority + (entry.freshness === "fresh" ? 5 : entry.freshness === "review" ? 1 : -5);
      const layerAdjustment = queryTypeKindAdjustment(entry, options, block, excerpt);
      const score = baselineScore + textScore + layerAdjustment.adjustment;
      if (tokens.length > 0 && textScore === 0) continue;
      const item = {
        id: hashText(`${entry.kind}|${filePath}|${block.title}`).slice(0, 24),
        kind: entry.kind,
        title: block.title,
        excerpt,
        sourcePath: filePath,
        sourceRefs: [buildSourceRef(entry, filePath, block, fileContent, stats)],
        status: entry.status,
        freshness: entry.freshness,
        score,
        tokenEstimate: estimateTokens(`${block.title} ${excerpt}`),
        whyMatched: whyMatched(tokens, [
          { label: "title", text: block.title },
          { label: "excerpt", text: excerpt },
          { label: "kind", text: entry.kind },
          { label: "file", text: entry.fileName },
        ], [
          `source:${entry.kind}`,
          `status:${entry.status}`,
          `freshness:${entry.freshness}`,
          ...layerAdjustment.reasons,
        ]),
        requiresHumanConfirmation: entry.humanConfirmation || entry.freshness !== "fresh",
        isMaintenance: layerAdjustment.maintenance,
      };
      item.memoryLayer = memoryLayerForHelperItem(entry, item, options);
      item.recallDepth = item.memoryLayer === "cold" ? "pointer_only" : item.memoryLayer === "skill" ? "procedural" : "summary";
      if (item.memoryLayer === "cold" && !options.allowColdLayer) continue;
      items.push(item);
    }
  }

  items.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.tokenEstimate - b.tokenEstimate));
  return { items, files, warnings };
}

function resolveZhixiaUserData(env = process.env, platform = process.platform) {
  if (env.ZHIXIA_USER_DATA) return path.resolve(env.ZHIXIA_USER_DATA);
  const home = os.homedir();
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, ["App", "Data"].join(""), "Roaming"), MEMORY_FACT_PRODUCT_DIR);
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", MEMORY_FACT_PRODUCT_DIR);
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), MEMORY_FACT_PRODUCT_DIR);
}

function memoryFactSidecarPath(env = process.env, platform = process.platform) {
  return path.join(resolveZhixiaUserData(env, platform), MEMORY_FACT_DB_DIR, MEMORY_FACT_DB_NAME);
}

function shouldReadMemoryFactSidecar(options = {}) {
  if (!options.runtimeContext && !options.precedent) return false;
  return options.includeKinds.length === 0 || options.includeKinds.includes("memory_fact");
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isUnsafeMemoryFactText(value) {
  const text = String(value == null ? "" : value);
  return RAW_SESSION_RE.test(text)
    || SECRET_REF_RE.test(text)
    || MEMORY_FACT_SECRET_VALUE_RE.test(text)
    || MEMORY_FACT_BASE64_RE.test(text);
}

function inspectBoundedMemoryFactValue(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_MEMORY_FACT_SCAN_NODES || depth > MAX_MEMORY_FACT_SCAN_DEPTH) {
    return { unsafe: true, truncated: true };
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return { unsafe: false, truncated: false };
  }
  if (typeof value === "string") {
    if (value.length > MAX_MEMORY_FACT_SCAN_STRING_CHARS) return { unsafe: true, truncated: true };
    return { unsafe: isUnsafeMemoryFactText(value), truncated: false };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_MEMORY_FACT_SCAN_ARRAY) return { unsafe: true, truncated: true };
    for (const item of value) {
      const inspection = inspectBoundedMemoryFactValue(item, state, depth + 1);
      if (inspection.unsafe || inspection.truncated) return inspection;
    }
    return { unsafe: false, truncated: false };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > MAX_MEMORY_FACT_SCAN_KEYS) return { unsafe: true, truncated: true };
    for (const key of keys) {
      const keyInspection = inspectBoundedMemoryFactValue(key, state, depth + 1);
      if (keyInspection.unsafe || keyInspection.truncated) return keyInspection;
      const valueInspection = inspectBoundedMemoryFactValue(value[key], state, depth + 1);
      if (valueInspection.unsafe || valueInspection.truncated) return valueInspection;
    }
    return { unsafe: false, truncated: false };
  }
  return { unsafe: true, truncated: false };
}

function inspectMemoryFactRow(row, value, sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0 || sourceRefs.length > MAX_MEMORY_FACT_SOURCE_REFS) {
    return { unsafe: true, truncated: sourceRefs?.length > MAX_MEMORY_FACT_SOURCE_REFS };
  }
  return inspectBoundedMemoryFactValue({
    id: row.id,
    projectPath: row.projectPath,
    scope: row.scope,
    status: row.status,
    confidence: row.confidence,
    subject: row.subject,
    predicate: row.predicate,
    factType: row.factType,
    validFrom: row.validFrom,
    validTo: row.validTo,
    observedAt: row.observedAt,
    supersededBy: row.supersededBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    value,
    sourceRefs,
  });
}

function normalizeMemoryFactSourceRefs(parsed, workspace) {
  if (!Array.isArray(parsed) || parsed.length > MAX_MEMORY_FACT_SOURCE_REFS) return [];
  const result = [];
  const seen = new Set();
  for (const ref of parsed) {
    if (!ref || typeof ref !== "object" || isUnsafeMemoryFactText(JSON.stringify(ref))) continue;
    const rawPath = ref.path ? String(ref.path) : "";
    const rawUri = ref.uri ? String(ref.uri) : "";
    const pathIsUri = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath);
    let externalFileRef = false;
    if (rawPath && !pathIsUri) {
      const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(workspace, rawPath);
      externalFileRef = !pathStaysInside(workspace, resolvedPath);
    } else if (rawPath && /^file:\/\//i.test(rawPath)) {
      try {
        externalFileRef = !pathStaysInside(workspace, fileURLToPath(rawPath));
      } catch {
        externalFileRef = true;
      }
    }
    if (rawUri && /^file:\/\//i.test(rawUri)) {
      try {
        externalFileRef = externalFileRef || !pathStaysInside(workspace, fileURLToPath(rawUri));
      } catch {
        externalFileRef = true;
      }
    }
    const normalized = {
      kind: compact(ref.kind || ref.sourceType || "source", 60) || "source",
      id: compact(ref.id || ref.sourceId || "", 160) || null,
      path: externalFileRef ? null : rawPath ? compact(rawPath, 360) : null,
      uri: externalFileRef ? null : rawUri ? compact(rawUri, 360) : null,
      title: ref.title ? compact(ref.title, 180) : null,
      hash: compact(ref.hash || ref.sha256 || ref.sourceHash || "", 160) || null,
      updatedAt: ref.updatedAt || ref.modifiedAt || null,
      redacted: externalFileRef ? "outside_workspace" : null,
    };
    if (![normalized.id, normalized.path, normalized.uri, normalized.title, normalized.hash, normalized.redacted].some(Boolean)) continue;
    const key = [normalized.kind, normalized.id, normalized.path, normalized.uri, normalized.hash, normalized.redacted].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function memoryFactValueText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function memoryFactItemFromRow(row, options) {
  const status = cleanText(row.status).toLowerCase();
  const scope = cleanText(row.scope).toLowerCase();
  if (scope !== "project" || row.projectPath !== options.workspace) return null;
  if (!MEMORY_FACT_ALLOWED_STATUSES.has(status) || row.supersededBy) return null;
  if (String(row.valueJson || "").length > MAX_MEMORY_FACT_VALUE_CHARS) return null;
  if (String(row.sourceRefsJson || "").length > MAX_MEMORY_FACT_SOURCE_REFS_CHARS) return null;
  const value = parseJsonOrNull(row.valueJson);
  if (value === null && String(row.valueJson).trim() !== "null") return null;
  const parsedSourceRefs = parseJsonOrNull(row.sourceRefsJson);
  const inspection = inspectMemoryFactRow(row, value, parsedSourceRefs);
  if (inspection.unsafe || inspection.truncated) return null;
  const valueText = memoryFactValueText(value);
  const sourceRefs = normalizeMemoryFactSourceRefs(parsedSourceRefs, options.workspace);
  if (sourceRefs.length === 0) return null;

  const title = compact(`${row.subject} / ${row.predicate}`, 240);
  const excerpt = compact(valueText, 480);
  const tokens = tokenizeQuery(options.query || options.taskGoal);
  const textScore = scoreTokens(tokens, [
    { text: row.subject, weight: 18, exactWeight: 30 },
    { text: row.predicate, weight: 14, exactWeight: 24 },
    { text: excerpt, weight: 7 },
    { text: row.factType, weight: 4 },
  ]);
  if (tokens.length > 0 && textScore === 0) return null;
  const sourcePath = `memory-runtime://facts/${encodeURIComponent(row.id)}`;
  const item = {
    id: compact(row.id, 180),
    kind: "memory_fact",
    title,
    excerpt,
    sourcePath,
    sourceRefs: [
      { kind: "memory_fact", path: sourcePath, title, updatedAt: row.updatedAt || null },
      ...sourceRefs,
    ].slice(0, 16),
    status: "review",
    freshness: "review",
    score: 34 + Math.round(Number(row.confidence || 0) * 20) + textScore,
    tokenEstimate: Math.max(24, Math.min(280, estimateTokens(`${title} ${excerpt}`))),
    whyMatched: whyMatched(tokens, [
      { label: "subject", text: row.subject },
      { label: "predicate", text: row.predicate },
      { label: "value", text: excerpt },
      { label: "factType", text: row.factType },
    ], ["source:memory_fact_sidecar", `persisted_status:${status}`, "authority:unverified_advisory", "scope:exact_project_path", "layer:warm"]),
    whyRecalled: [],
    authority: {
      status: "review",
      persistedStatus: status,
      authoritative: false,
      authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
      advisory: true,
      scope: "exact_project",
      sourceBacked: true,
      validity: "current",
      persistedTrust: "persisted_unverified",
      receiptProofIncluded: false,
      trustContextIncluded: false,
    },
    continuitySlot: null,
    requiresHumanConfirmation: true,
    isMaintenance: MAINTENANCE_ITEM_RE.test(`${title} ${excerpt}`),
    memoryLayer: "warm",
    recallDepth: "summary",
    rawSessionPolicy: "not_allowed",
    confidence: Math.max(0, Math.min(Number(row.confidence || 0), 1)),
    updatedAt: row.updatedAt || null,
  };
  item.whyRecalled = item.whyMatched;
  if (item.isMaintenance && !isMaintenanceQuery(options)) item.score -= 45;
  return item;
}

function collectMemoryFactItems(workspace, options) {
  if (!shouldReadMemoryFactSidecar(options)) {
    return { requested: false, status: "not_requested", items: [], warnings: [] };
  }
  if (process.env.ZHIXIA_MEMORY_FACT_SQLITE_DISABLED === "1") {
    return {
      requested: true,
      status: "sqlite_unavailable",
      items: [],
      warnings: ["memory_fact_sqlite_unavailable_fallback_to_codex_knowledge"],
    };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    return {
      requested: true,
      status: "sqlite_unavailable",
      items: [],
      warnings: ["memory_fact_sqlite_unavailable_fallback_to_codex_knowledge"],
    };
  }

  const dbPath = memoryFactSidecarPath();
  if (!fs.existsSync(dbPath)) {
    return {
      requested: true,
      status: "missing",
      items: [],
      warnings: ["memory_fact_sidecar_missing_fallback_to_codex_knowledge"],
    };
  }

  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: false });
    db.exec(`PRAGMA busy_timeout = ${MEMORY_FACT_BUSY_TIMEOUT_MS}; PRAGMA query_only = ON;`);
    const queryOnly = db.prepare("PRAGMA query_only").get();
    if (Number(queryOnly?.query_only || 0) !== 1) throw new Error("query_only_not_enabled");
    const now = new Date().toISOString();
    const rowLimit = Math.max(12, Math.min(MEMORY_FACT_QUERY_LIMIT, options.limit * 8));
    const rows = db.prepare(`
      SELECT id, projectPath, scope, subject, predicate, valueJson, factType, status,
        confidence, validFrom, validTo, observedAt, sourceRefsJson, supersededBy,
        createdAt, updatedAt
      FROM memory_facts
      WHERE projectPath = ?
        AND lower(scope) = 'project'
        AND lower(status) IN ('active', 'current', 'accepted')
        AND supersededBy IS NULL
        AND (validFrom IS NULL OR validFrom <= ?)
        AND (validTo IS NULL OR validTo > ?)
        AND sourceRefsJson NOT IN ('', '[]', 'null')
        AND length(valueJson) <= ?
        AND length(sourceRefsJson) <= ?
      ORDER BY confidence DESC, updatedAt DESC, id ASC
      LIMIT ?
    `).all(
      workspace,
      now,
      now,
      MAX_MEMORY_FACT_VALUE_CHARS,
      MAX_MEMORY_FACT_SOURCE_REFS_CHARS,
      rowLimit,
    );
    const items = rows
      .map((row) => memoryFactItemFromRow(row, { ...options, workspace }))
      .filter(Boolean)
      .sort((left, right) => (right.score !== left.score ? right.score - left.score : left.id.localeCompare(right.id)));
    return {
      requested: true,
      status: "available",
      items,
      warnings: ["memory_fact_authority_verification_unavailable_items_are_advisory"],
    };
  } catch (error) {
    const message = String(error?.message || error || "").toLowerCase();
    const schemaUnavailable = /no such table|no such column|database schema/.test(message);
    return {
      requested: true,
      status: schemaUnavailable ? "schema_unavailable" : "unavailable",
      items: [],
      warnings: [schemaUnavailable
        ? "memory_fact_sidecar_schema_unavailable_fallback_to_codex_knowledge"
        : "memory_fact_sidecar_unavailable_fallback_to_codex_knowledge"],
    };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Read failure is already represented by the compact fallback warning.
      }
    }
  }
}

function comparablePath(value) {
  if (!value) return "";
  let resolved;
  try {
    resolved = path.resolve(String(value));
  } catch {
    return "";
  }
  const normalized = resolved.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathStaysInside(root, candidate) {
  const rootPath = comparablePath(root);
  const candidatePath = comparablePath(candidate);
  if (!rootPath || !candidatePath) return false;
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isUnsafeMemoryCoreText(value) {
  const text = String(value == null ? "" : value);
  return RAW_SESSION_RE.test(text)
    || MEMORY_FACT_SECRET_VALUE_RE.test(text)
    || MEMORY_FACT_BASE64_RE.test(text)
    || /(?:^|[\\/])\.env(?:$|[\\/._-])|(?:^|[\\/])(?:id_rsa|id_ed25519|credentials)(?:$|[\\/._-])/i.test(text)
    || /\b(?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|password|passwd|secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{4,}/i.test(text)
    || /\b(?:receiptProof|receiptSigningKey|signingKey|trustContext|trustState)\b/i.test(text);
}

function inspectBoundedMemoryCoreValue(value, state = { nodes: 0 }, depth = 0, keyName = "") {
  state.nodes += 1;
  if (state.nodes > MAX_MEMORY_FACT_SCAN_NODES || depth > MAX_MEMORY_FACT_SCAN_DEPTH) {
    return { safe: false, reason: "bounded_structure_limit" };
  }
  if (keyName && MEMORY_CORE_FORBIDDEN_KEY_RE.test(keyName.replace(/[^a-z0-9]/gi, ""))) {
    return { safe: false, reason: "forbidden_sensitive_field" };
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") return { safe: true };
  if (typeof value === "string") {
    if (value.length > MAX_MEMORY_FACT_SCAN_STRING_CHARS) return { safe: false, reason: "oversized_string" };
    return { safe: !isUnsafeMemoryCoreText(value), reason: isUnsafeMemoryCoreText(value) ? "unsafe_text" : null };
  }
  if (Array.isArray(value)) {
    if (value.length > 48) return { safe: false, reason: "oversized_array" };
    for (const item of value) {
      const result = inspectBoundedMemoryCoreValue(item, state, depth + 1, keyName);
      if (!result.safe) return result;
    }
    return { safe: true };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > 48) return { safe: false, reason: "oversized_object" };
    for (const key of keys) {
      const result = inspectBoundedMemoryCoreValue(value[key], state, depth + 1, key);
      if (!result.safe) return result;
    }
    return { safe: true };
  }
  return { safe: false, reason: "unsupported_value" };
}

function normalizeMemoryCoreSourceRefs(parsed, workspace, projectId, limit = 16) {
  if (!Array.isArray(parsed) || parsed.length > MAX_MEMORY_FACT_SOURCE_REFS) return [];
  const refs = [];
  const seen = new Set();
  for (const ref of parsed) {
    if (!ref || typeof ref !== "object") continue;
    const inspection = inspectBoundedMemoryCoreValue(ref);
    if (!inspection.safe) continue;
    const refProjectId = compact(ref.projectId || "", 180) || null;
    if (refProjectId && refProjectId !== projectId) continue;
    const rawPath = ref.path ? String(ref.path) : "";
    const uri = ref.uri ? compact(ref.uri, 360) : null;
    const isUri = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath);
    if (rawPath && !isUri && !pathStaysInside(workspace, path.isAbsolute(rawPath) ? rawPath : path.resolve(workspace, rawPath))) continue;
    if (rawPath && /^file:\/\//i.test(rawPath)) {
      try {
        if (!pathStaysInside(workspace, fileURLToPath(rawPath))) continue;
      } catch {
        continue;
      }
    }
    if (uri && /^file:\/\//i.test(uri)) {
      try {
        if (!pathStaysInside(workspace, fileURLToPath(uri))) continue;
      } catch {
        continue;
      }
    }
    const normalized = {
      kind: compact(ref.kind || ref.sourceType || "source", 60) || "source",
      id: compact(ref.id || ref.sourceId || "", 160) || null,
      path: rawPath ? compact(rawPath, 360) : null,
      uri,
      title: ref.title ? compact(ref.title, 180) : null,
      hash: compact(ref.hash || ref.sha256 || ref.sourceHash || "", 160) || null,
      projectId: refProjectId,
      moduleId: compact(ref.moduleId || "", 180) || null,
      updatedAt: ref.updatedAt || ref.modifiedAt || null,
    };
    if (isUnsafeMemoryCoreText(JSON.stringify(normalized))) continue;
    if (![normalized.id, normalized.path, normalized.uri, normalized.title, normalized.hash].some(Boolean)) continue;
    const signature = [normalized.kind, normalized.id, normalized.path, normalized.uri, normalized.hash].join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    refs.push(normalized);
    if (refs.length >= limit) break;
  }
  return refs;
}

function memoryCoreSchemaMetadata(db) {
  const allSpecs = [...MEMORY_CORE_TABLE_SPECS, { table: "memory_facts", recordKind: "memory_fact" }];
  const placeholders = allSpecs.map(() => "?").join(", ");
  const presentRows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders}) ORDER BY name`).all(...allSpecs.map((spec) => spec.table));
  const present = new Set(presentRows.map((row) => row.name));
  const compatibleTables = [];
  const incompatibleTables = [];
  const missingTables = [];
  for (const spec of MEMORY_CORE_TABLE_SPECS) {
    if (!present.has(spec.table)) {
      missingTables.push(spec.table);
      continue;
    }
    const columns = new Set(db.prepare(`PRAGMA table_info(${spec.table})`).all().map((column) => column.name));
    const missingColumns = MEMORY_CORE_REQUIRED_COLUMNS.filter((column) => !columns.has(column));
    if (missingColumns.length === 0) compatibleTables.push(spec.table);
    else incompatibleTables.push({ table: spec.table, missingColumns });
  }
  const userVersion = Number(db.prepare("PRAGMA user_version").get()?.user_version || 0);
  const schemaVersion = Number(db.prepare("PRAGMA schema_version").get()?.schema_version || 0);
  const applicationId = Number(db.prepare("PRAGMA application_id").get()?.application_id || 0);
  return {
    logicalSchemaVersion: compatibleTables.length > 0 ? MEMORY_CORE_SIDECAR_SCHEMA : "unknown",
    sqliteUserVersion: userVersion,
    sqliteSchemaVersion: schemaVersion,
    sqliteApplicationId: applicationId,
    compatibleTables,
    incompatibleTables,
    missingTables,
    memoryFactsPresent: present.has("memory_facts"),
  };
}

function memoryCoreSidecarSummary(status, schema = null, extra = {}) {
  return {
    status,
    schemaVersion: schema?.logicalSchemaVersion || "unknown",
    sqliteUserVersion: schema?.sqliteUserVersion ?? null,
    sqliteSchemaVersion: schema?.sqliteSchemaVersion ?? null,
    sqliteApplicationId: schema?.sqliteApplicationId ?? null,
    compatibleTables: schema?.compatibleTables || [],
    incompatibleTables: schema?.incompatibleTables || [],
    missingTables: schema?.missingTables || MEMORY_CORE_TABLE_SPECS.map((spec) => spec.table),
    readOnly: true,
    logicalReadOnly: true,
    queryOnly: true,
    sqlWrites: false,
    schemaMutation: false,
    mainDatabaseOrWalWrites: false,
    sqliteShmCoordinationMayChange: true,
    busyTimeoutMs: MEMORY_FACT_BUSY_TIMEOUT_MS,
    ...extra,
  };
}

function withMemoryCoreSidecar(operation) {
  if (process.env.ZHIXIA_MEMORY_CORE_SQLITE_DISABLED === "1" || process.env.ZHIXIA_MEMORY_FACT_SQLITE_DISABLED === "1") {
    return {
      status: "sqlite_unavailable",
      warnings: ["memory_core_sqlite_unavailable_fallback_to_codex_knowledge"],
      sidecar: memoryCoreSidecarSummary("sqlite_unavailable"),
    };
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    return {
      status: "sqlite_unavailable",
      warnings: ["memory_core_sqlite_unavailable_fallback_to_codex_knowledge"],
      sidecar: memoryCoreSidecarSummary("sqlite_unavailable"),
    };
  }
  const dbPath = memoryFactSidecarPath();
  if (!fs.existsSync(dbPath)) {
    return {
      status: "missing",
      warnings: ["memory_core_sidecar_missing_fallback_to_codex_knowledge"],
      sidecar: memoryCoreSidecarSummary("missing"),
    };
  }
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, enableForeignKeyConstraints: false });
    db.exec(`PRAGMA busy_timeout = ${MEMORY_FACT_BUSY_TIMEOUT_MS}; PRAGMA query_only = ON;`);
    const queryOnly = db.prepare("PRAGMA query_only").get();
    if (Number(queryOnly?.query_only || 0) !== 1) throw new Error("query_only_not_enabled");
    const schema = memoryCoreSchemaMetadata(db);
    if (!schema.compatibleTables.includes("memory_project_brains")) {
      return {
        status: "schema_unavailable",
        warnings: ["memory_core_sidecar_schema_unavailable_fallback_to_codex_knowledge"],
        sidecar: memoryCoreSidecarSummary("schema_unavailable", schema),
      };
    }
    const result = operation(db, schema) || {};
    return {
      status: result.status || "available",
      warnings: result.warnings || [],
      ...result,
      sidecar: memoryCoreSidecarSummary(result.status || "available", schema, result.sidecar || {}),
    };
  } catch (error) {
    const message = String(error?.message || error || "").toLowerCase();
    const schemaUnavailable = /no such table|no such column|database schema|malformed/.test(message);
    return {
      status: schemaUnavailable ? "schema_unavailable" : "unavailable",
      warnings: [schemaUnavailable
        ? "memory_core_sidecar_schema_unavailable_fallback_to_codex_knowledge"
        : "memory_core_sidecar_unavailable_fallback_to_codex_knowledge"],
      sidecar: memoryCoreSidecarSummary(schemaUnavailable ? "schema_unavailable" : "unavailable"),
    };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // The compact fallback result already represents the read failure.
      }
    }
  }
}

function parseMemoryCoreRow(row, spec, context = {}) {
  if (!row || String(row.payloadJson || "").length > MAX_MEMORY_CORE_PAYLOAD_CHARS) return null;
  const payload = parseJsonOrNull(row.payloadJson);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const inspection = inspectBoundedMemoryCoreValue(payload);
  if (!inspection.safe) return null;
  const projectId = compact(row.projectId || payload.projectId || "", 180) || null;
  const expectedProjectId = context.projectId || projectId;
  if (!projectId || expectedProjectId && projectId !== expectedProjectId) return null;
  const scopeKey = compact(row.scopeKey || payload.scopeKey || payload.scope?.key || "", 280);
  const projectScopePrefix = `project:${projectId}`;
  const scopeExact = scopeKey === projectScopePrefix || scopeKey.startsWith(`${projectScopePrefix}:`) || scopeKey.startsWith(`${projectScopePrefix}/`);
  if (!scopeExact) return null;
  const persistedStatus = cleanText(row.status || payload.authorityStatus || payload.status).toLowerCase();
  const now = context.now || new Date().toISOString();
  const validFrom = row.validFrom || payload.validFrom || payload.effectiveFrom || null;
  const validTo = row.validTo || payload.validTo || payload.effectiveTo || null;
  const validityCurrent = (!validFrom || validFrom <= now) && (!validTo || validTo > now);
  const sourceRefs = normalizeMemoryCoreSourceRefs(payload.sourceRefs || payload.sourceRef || [], context.workspace, projectId);
  const advisory = MEMORY_CORE_CURRENT_STATUSES.has(persistedStatus) && validityCurrent && sourceRefs.length > 0;
  const authoritative = false;
  const status = advisory ? "review" : persistedStatus;
  const freshnessValue = cleanText(payload.freshness || "").toLowerCase();
  const freshness = !validityCurrent || freshnessValue === "stale" ? "stale" : freshnessValue === "review" ? "review" : "fresh";
  return {
    id: compact(row.id, 180),
    table: spec.table,
    recordKind: spec.recordKind,
    runtimeKind: spec.runtimeKind,
    projectId,
    scopeKey,
    status,
    persistedStatus,
    authoritative,
    advisory,
    authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
    validityCurrent,
    freshness,
    sourceRefs,
    updatedAt: row.updatedAt || payload.updatedAt || null,
    createdAt: row.createdAt || payload.createdAt || null,
    payload,
  };
}

function memoryCoreProjectFromDatabase(db, schema, workspace, requestedProjectId = "", allowReview = false) {
  if (!schema.compatibleTables.includes("memory_project_brains")) return { status: "schema_unavailable", project: null, warnings: [] };
  const statuses = allowReview ? ["accepted", "curated", "candidate", "review"] : ["accepted", "curated"];
  const params = Object.fromEntries(statuses.map((status, index) => [`status${index}`, status]));
  const filters = [`lower(status) IN (${statuses.map((_, index) => `:status${index}`).join(", ")})`];
  if (requestedProjectId) {
    filters.push("projectId = :projectId");
    params.projectId = requestedProjectId;
  }
  params.limit = 80;
  const spec = MEMORY_CORE_TABLE_SPECS[0];
  const rows = db.prepare(`
    SELECT id, projectId, scopeKey, status, updatedAt, validFrom, validTo, createdAt, payloadJson, contentHash
    FROM memory_project_brains
    WHERE ${filters.join(" AND ")}
    ORDER BY updatedAt DESC, id ASC
    LIMIT :limit
  `).all(params);
  const workspacePath = comparablePath(workspace);
  const matches = rows.map((row) => parseMemoryCoreRow(row, spec, { workspace, projectId: row.projectId }))
    .filter(Boolean)
    .filter((record) => comparablePath(record.payload.canonicalPath || record.payload.projectPath || record.payload.rootPath || "") === workspacePath)
    .filter((record) => allowReview || record.authoritative)
    .sort((left, right) => Number(right.authoritative) - Number(left.authoritative)
      || (Date.parse(right.updatedAt || "") || 0) - (Date.parse(left.updatedAt || "") || 0));
  if (matches.length === 0) {
    return {
      status: requestedProjectId ? "project_scope_mismatch" : "project_unresolved",
      project: null,
      warnings: [requestedProjectId ? "memory_core_project_id_did_not_match_workspace" : "memory_core_project_unresolved_fallback_to_codex_knowledge"],
    };
  }
  const distinctIds = [...new Set(matches.map((record) => record.projectId))];
  if (distinctIds.length !== 1) {
    return { status: "project_conflict", project: null, warnings: ["memory_core_project_resolution_conflict"] };
  }
  const record = matches[0];
  return {
    status: "resolved",
    warnings: [],
    project: {
      id: record.projectId,
      path: workspace,
      name: compact(record.payload.aliases?.[0] || record.payload.name || path.basename(workspace), 160),
      summary: compact(record.payload.productSummary || record.payload.summary || "", 360),
      phase: compact(record.payload.phase || record.payload.currentPhase || "", 120) || null,
      status: record.status,
      freshness: record.freshness,
      authority: memoryCoreAuthoritySummary(record),
      sourceRefs: record.sourceRefs,
      record,
    },
  };
}

function selectMemoryCoreRows(db, spec, projectId, statuses, limit = MAX_MEMORY_CORE_ROWS_PER_TABLE) {
  const normalizedStatuses = [...statuses].slice(0, 12);
  const params = { projectId, limit: Math.max(1, Math.min(Number(limit || 1), MAX_MEMORY_CORE_ROWS_PER_TABLE)) };
  normalizedStatuses.forEach((status, index) => { params[`status${index}`] = status; });
  return db.prepare(`
    SELECT id, projectId, scopeKey, status, type, updatedAt, validFrom, validTo, createdAt, payloadJson, contentHash
    FROM ${spec.table}
    WHERE projectId = :projectId
      AND lower(status) IN (${normalizedStatuses.map((_, index) => `:status${index}`).join(", ")})
    ORDER BY updatedAt DESC, id ASC
    LIMIT :limit
  `).all(params);
}

function memoryCoreAuthoritySummary(record) {
  return {
    status: record.status,
    persistedStatus: record.persistedStatus || record.status,
    authoritative: record.authoritative === true,
    authorityVerification: record.authorityVerification || AUTHORITY_VERIFICATION_UNAVAILABLE,
    advisory: record.advisory === true,
    scope: "exact_project",
    sourceBacked: record.sourceRefs.length > 0,
    validity: record.validityCurrent ? "current" : "inactive",
    persistedTrust: "persisted_unverified",
    receiptProofIncluded: false,
    trustContextIncluded: false,
  };
}

function firstCoreText(values, maxChars = 420) {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const text = compact(value, maxChars);
      if (text) return text;
    }
  }
  return "";
}

function continuitySlotForMemoryCoreRecord(record) {
  const payload = record.payload;
  const explicit = cleanText(payload.continuitySlot || payload.slot).toLowerCase().replace(/ /g, "_");
  if (PROJECT_CONTINUITY_SLOTS.includes(explicit)) return explicit;
  if (record.recordKind === "project_brain") return "project_identity";
  if (record.recordKind === "project_anchor") {
    return {
      identity: "project_identity",
      original_goal: "original_product_goal",
      architecture: "architecture_anchors",
      non_negotiable: "standing_rules",
      acceptance: "standing_rules",
      safety: "standing_rules",
    }[cleanText(payload.category || payload.anchorType).toLowerCase()] || null;
  }
  if (record.recordKind === "module_memory") return "active_modules";
  if (record.recordKind === "standing_rule" || record.recordKind === "constraint") return "standing_rules";
  if (record.recordKind === "project_checkpoint") return "last_valid_checkpoint";
  if (record.recordKind === "episode" && MEMORY_CORE_FAILURE_RE.test(`${payload.eventType || ""} ${payload.type || ""} ${payload.title || ""}`)) return "latest_failures";
  if (record.recordKind === "episode") return "accepted_progress";
  if (record.recordKind === "decision") return "accepted_progress";
  return null;
}

function memoryCoreTitleAndSummary(record) {
  const payload = record.payload;
  const title = firstCoreText([
    payload.title,
    payload.name,
    payload.statement,
    payload.aliases?.[0],
    payload.subject,
    payload.eventType,
    record.id,
  ], 220);
  let summary = firstCoreText([
    payload.productSummary,
    payload.summary,
    payload.statement,
    payload.purpose,
    payload.outcome,
    payload.rationale,
    payload.why,
    payload.phase,
    payload.currentStatus,
    title,
  ], 480);
  if (record.recordKind === "module_memory" && payload.name) {
    summary = compact(`${payload.name}: ${payload.purpose || payload.currentStatus || summary}`, 480);
  }
  return { title: title || record.id, summary: summary || title || record.id };
}

function memoryCoreItemFromRecord(record, options) {
  if (!record.advisory) return null;
  const { title, summary } = memoryCoreTitleAndSummary(record);
  const tokens = tokenizeQuery(options.query || options.taskGoal);
  const continuitySlot = continuitySlotForMemoryCoreRecord(record);
  const textScore = scoreTokens(tokens, [
    { text: title, weight: 18, exactWeight: 30 },
    { text: summary, weight: 8 },
    { text: record.recordKind, weight: 5 },
    { text: continuitySlot || "", weight: 6 },
  ]);
  if (tokens.length > 0 && textScore === 0) return null;
  const sourcePath = `memory-runtime://core/${record.recordKind}/${encodeURIComponent(record.id)}`;
  const isMaintenance = MAINTENANCE_ITEM_RE.test(`${title} ${summary}`);
  let score = 34 + (record.persistedStatus === "curated" ? 10 : 6) + textScore;
  if (isMaintenance && !isMaintenanceQuery(options)) score -= 45;
  const whyRecalled = whyMatched(tokens, [
    { label: "title", text: title },
    { label: "summary", text: summary },
    { label: "kind", text: record.recordKind },
    { label: "continuity", text: continuitySlot || "" },
  ], [
    "source:memory_core_sidecar",
    `record_kind:${record.recordKind}`,
    `persisted_status:${record.persistedStatus}`,
    "scope:exact_project_id",
    "authority:unverified_advisory",
    continuitySlot ? `continuity:${continuitySlot}` : "",
  ]);
  return {
    id: record.id,
    kind: record.recordKind,
    runtimeKind: record.runtimeKind,
    title,
    excerpt: summary,
    sourcePath,
    sourceRefs: [
      { kind: record.recordKind, path: sourcePath, title, updatedAt: record.updatedAt },
      ...record.sourceRefs,
    ].slice(0, 16),
    status: record.status,
    freshness: record.freshness,
    score,
    tokenEstimate: Math.max(24, Math.min(300, estimateTokens(`${title} ${summary}`))),
    whyMatched: whyRecalled,
    whyRecalled,
    authority: memoryCoreAuthoritySummary(record),
    continuitySlot,
    requiresHumanConfirmation: true,
    isMaintenance,
    memoryLayer: ["project_brain", "project_anchor", "module_memory", "project_checkpoint"].includes(record.recordKind) ? "hot" : "warm",
    recallDepth: "summary",
    rawSessionPolicy: "not_allowed",
    updatedAt: record.updatedAt,
  };
}

function shouldReadMemoryCoreSidecar(options = {}) {
  if (!options.runtimeContext && !options.precedent && !options.recoverThread && !options.ceoTakeover) return false;
  if (options.includeKinds.length === 0) return true;
  return options.includeKinds.includes("memory_core") || MEMORY_CORE_ALLOWED_HELPER_KINDS.some((kind) => options.includeKinds.includes(kind));
}

function collectMemoryCoreItems(workspace, options) {
  if (!shouldReadMemoryCoreSidecar(options)) return { requested: false, status: "not_requested", items: [], warnings: [], sidecar: null };
  const result = withMemoryCoreSidecar((db, schema) => {
    const resolution = memoryCoreProjectFromDatabase(db, schema, workspace, options.projectId, true);
    if (!resolution.project) {
      return { status: resolution.status, items: [], warnings: resolution.warnings, sidecar: { exactProjectPath: workspace, projectId: null } };
    }
    const rowLimit = Math.max(12, Math.min(MAX_MEMORY_CORE_ROWS_PER_TABLE, options.limit * 6));
    const items = [];
    let rowsRead = 0;
    for (const spec of MEMORY_CORE_TABLE_SPECS) {
      if (!schema.compatibleTables.includes(spec.table)) continue;
      if (options.includeKinds.length > 0 && !options.includeKinds.includes("memory_core") && !options.includeKinds.includes(spec.recordKind)) continue;
      const rows = selectMemoryCoreRows(db, spec, resolution.project.id, MEMORY_CORE_CURRENT_STATUSES, rowLimit);
      rowsRead += rows.length;
      for (const row of rows) {
        const record = parseMemoryCoreRow(row, spec, { workspace, projectId: resolution.project.id });
        const item = record ? memoryCoreItemFromRecord(record, options) : null;
        if (item) items.push(item);
      }
    }
    items.sort((left, right) => right.score - left.score || left.tokenEstimate - right.tokenEstimate || left.id.localeCompare(right.id));
    return {
      status: "available",
      items,
      warnings: ["memory_core_authority_verification_unavailable_items_are_advisory"],
      project: resolution.project,
      sidecar: {
        exactProjectPath: workspace,
        projectId: resolution.project.id,
        rowsRead,
        returnedCount: items.length,
      },
    };
  });
  return { requested: true, items: [], warnings: [], ...result, items: result.items || [] };
}

function memoryCoreChildAuthority(child, parentRecord, workspace) {
  if (!child || typeof child !== "object") return null;
  const inspection = inspectBoundedMemoryCoreValue(child);
  if (!inspection.safe) return null;
  const projectId = compact(child.projectId || "", 180);
  const persistedStatus = cleanText(child.authorityStatus || child.memoryStatus || child.lifecycleStatus || "").toLowerCase();
  const sourceRefs = normalizeMemoryCoreSourceRefs(child.sourceRefs || [], workspace, parentRecord.projectId);
  if (projectId !== parentRecord.projectId || !MEMORY_CORE_CURRENT_STATUSES.has(persistedStatus) || sourceRefs.length === 0) return null;
  return {
    status: "review",
    persistedStatus,
    sourceRefs,
    authoritative: false,
    authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
  };
}

function continuityCandidate(slot, record, value, type, options = {}) {
  if (!PROJECT_CONTINUITY_SLOTS.includes(slot)) return null;
  const summary = firstCoreText([value?.summary, value?.statement, value?.title, value?.name, value], 420);
  if (!summary) return null;
  const childAuthority = value && typeof value === "object" ? memoryCoreChildAuthority(value, record, options.workspace) : null;
  const childMode = options.requireChildAuthority === true;
  const authoritative = childMode ? childAuthority?.authoritative === true : record.authoritative;
  const sourceRefs = childMode ? childAuthority?.sourceRefs || [] : record.sourceRefs;
  const status = childMode ? childAuthority?.status || cleanText(value?.authorityStatus || "review").toLowerCase() : record.status;
  return {
    id: compact(value?.id || value?.taskId || value?.blockerId || value?.actionId || value?.failureId || value?.checkpointId || record.id, 180),
    slot,
    type,
    title: firstCoreText([value?.title, value?.name, summary], 180),
    summary,
    status,
    freshness: record.freshness,
    authoritative,
    conflict: value?.conflict === true || record.payload.conflict === true,
    sourceRefs,
    updatedAt: value?.updatedAt || value?.observedAt || record.updatedAt,
    authority: {
      ...memoryCoreAuthoritySummary(record),
      status,
      persistedStatus: childMode ? childAuthority?.persistedStatus || status : record.persistedStatus,
      authoritative,
      authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
      advisory: true,
      sourceBacked: sourceRefs.length > 0,
    },
  };
}

function addContinuityCandidate(target, candidate, reviewTarget) {
  if (!candidate) return;
  if (candidate.authoritative && candidate.freshness !== "stale") target[candidate.slot].push(candidate);
  else reviewTarget[candidate.slot].push(candidate);
}

function memoryCoreContinuityCandidates(records, workspace) {
  const current = Object.fromEntries(PROJECT_CONTINUITY_SLOTS.map((slot) => [slot, []]));
  const review = Object.fromEntries(PROJECT_CONTINUITY_SLOTS.map((slot) => [slot, []]));
  const add = (slot, record, value, type, options = {}) => addContinuityCandidate(current, continuityCandidate(slot, record, value, type, { workspace, ...options }), review);
  for (const record of records) {
    const payload = record.payload;
    if (record.recordKind === "project_brain") {
      add("project_identity", record, payload.aliases?.[0] || payload.name || record.projectId, "project_brain");
      if (payload.phase || payload.currentPhase) add("current_phase", record, payload.phase || payload.currentPhase, "phase");
    }
    if (record.recordKind === "project_anchor") {
      const slot = continuitySlotForMemoryCoreRecord(record);
      if (slot) add(slot, record, payload.statement || payload.summary || payload.title, "project_anchor");
    }
    if (record.recordKind === "module_memory") {
      const moduleStatus = cleanText(payload.currentStatus || payload.status).toLowerCase();
      if (ACTIVE_MODULE_STATUSES.has(moduleStatus)) add("active_modules", record, `${payload.name || record.id}: ${payload.purpose || moduleStatus}`, "module_memory");
      for (const task of safeArray(payload.tasks || payload.openTasks)) {
        const taskStatus = cleanText(task?.status || "open").toLowerCase();
        if (!CLOSED_TASK_STATUSES.has(taskStatus)) add("open_tasks", record, task, "task", { requireChildAuthority: true });
      }
      for (const blocker of safeArray(payload.blockers || payload.openBlockers)) add("open_blockers", record, blocker, "blocker", { requireChildAuthority: true });
    }
    if (record.recordKind === "standing_rule") add("standing_rules", record, payload.statement || payload.summary || payload.title, "standing_rule");
    if (record.recordKind === "constraint" && /standing_rule|non_negotiable|safety|acceptance/i.test(payload.constraintType || payload.type || "")) {
      add("standing_rules", record, payload.statement || payload.summary || payload.title, "constraint");
    }
    if (record.recordKind === "episode") {
      const explicitSlot = continuitySlotForMemoryCoreRecord(record);
      if (explicitSlot) add(explicitSlot, record, payload.summary || payload.outcome || payload.title, "episode");
      for (const failure of safeArray(payload.failures || payload.latestFailures)) add("latest_failures", record, failure, "failure", { requireChildAuthority: true });
    }
    if (record.recordKind === "decision" && PROJECT_CONTINUITY_SLOTS.includes(cleanText(payload.continuitySlot || payload.slot).toLowerCase())) {
      add(cleanText(payload.continuitySlot || payload.slot).toLowerCase(), record, payload.statement || payload.summary || payload.title, "decision");
    }
    if (record.recordKind === "project_checkpoint") {
      add("last_valid_checkpoint", record, payload.checkpointId || record.id, "project_checkpoint");
      if (payload.originalGoal || payload.originalProductGoal) add("original_product_goal", record, payload.originalGoal || payload.originalProductGoal, "checkpoint_original_goal");
      for (const architecture of safeArray(payload.architectureAnchors || payload.architecturePrinciples)) add("architecture_anchors", record, architecture, "checkpoint_architecture");
      for (const progress of safeArray(payload.acceptedProgress || payload.progress)) add("accepted_progress", record, progress, "progress", { requireChildAuthority: true });
      for (const task of safeArray(payload.openTasks || payload.taskStates)) {
        const taskStatus = cleanText(task?.status || "open").toLowerCase();
        if (!CLOSED_TASK_STATUSES.has(taskStatus)) add("open_tasks", record, task, "task", { requireChildAuthority: true });
      }
      for (const blocker of safeArray(payload.blockers || payload.openBlockers)) add("open_blockers", record, blocker, "blocker", { requireChildAuthority: true });
      for (const action of safeArray(payload.nextActions || payload.nextAction)) add("next_actions", record, action, "action", { requireChildAuthority: true });
      for (const threadId of safeArray(payload.threadLineage || payload.threadIds)) add("thread_lineage", record, threadId, "thread");
      const checkpointRefs = normalizeMemoryCoreSourceRefs(payload.canonicalDocRefs || payload.canonicalDocs || [], workspace, record.projectId);
      for (const ref of checkpointRefs) add("canonical_docs", record, ref.title || ref.path || ref.uri, "document");
    }
    for (const ref of record.sourceRefs) {
      if (/prd|technical|architecture|design|readme|canonical/i.test(`${ref.kind || ""} ${ref.title || ""} ${ref.path || ""}`)) {
        add("canonical_docs", record, ref.title || ref.path || ref.uri, "document");
      }
    }
  }
  for (const slot of PROJECT_CONTINUITY_SLOTS) {
    const dedupe = (items) => {
      const seen = new Set();
      return items.sort((left, right) => (Date.parse(right.updatedAt || "") || 0) - (Date.parse(left.updatedAt || "") || 0) || left.id.localeCompare(right.id))
        .filter((item) => {
          const key = `${item.id}|${cleanText(item.summary).toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    };
    current[slot] = dedupe(current[slot]);
    review[slot] = dedupe(review[slot]);
  }
  return { current, review };
}

function loadProjectMemoryCoreRecords(db, schema, project, workspace) {
  const records = [];
  const tableStats = [];
  let sourceTruncated = false;
  for (const spec of MEMORY_CORE_TABLE_SPECS) {
    if (!schema.compatibleTables.includes(spec.table)) continue;
    const countRow = db.prepare(`SELECT COUNT(*) AS count FROM ${spec.table} WHERE projectId = ? AND lower(status) IN ('accepted', 'curated', 'candidate', 'review')`).get(project.id);
    const rawCount = Number(countRow?.count || 0);
    const rows = selectMemoryCoreRows(db, spec, project.id, new Set(["accepted", "curated", "candidate", "review"]), MAX_MEMORY_CORE_ROWS_PER_TABLE);
    if (rawCount > rows.length) sourceTruncated = true;
    let acceptedRows = 0;
    for (const row of rows) {
      const record = parseMemoryCoreRow(row, spec, { workspace, projectId: project.id });
      if (!record) continue;
      records.push(record);
      acceptedRows += 1;
    }
    tableStats.push({ table: spec.table, rawCount, acceptedRows, truncated: rawCount > rows.length });
  }
  return { records, tableStats, sourceTruncated };
}

function manifestCursorItemKey(item) {
  return [
    item.recordKind || item.slot || item.continuitySlot || item.kind || "item",
    item.id || "",
    item.updatedAt || "",
    cleanText(item.summary || item.title || "").toLowerCase(),
  ].join("|");
}

function manifestCursorDigest(prefix, items, offset) {
  const prefixManifest = items.slice(0, offset).map(manifestCursorItemKey).join("\n");
  return hashText(`${prefix}|${offset}|${prefixManifest}`).slice(0, 32);
}

function createManifestCursor(prefix, items, offset) {
  return `${prefix}${offset}-${manifestCursorDigest(prefix, items, offset)}`;
}

function parseManifestCursor(rawCursor, prefix, items) {
  if (!rawCursor) return { offset: 0, invalid: false, chainVerified: true };
  const cursor = String(rawCursor);
  if (!cursor.startsWith(prefix)) return { offset: 0, invalid: true, chainVerified: false };
  const match = cursor.slice(prefix.length).match(/^(\d+)-([a-f0-9]{32})$/);
  if (!match) return { offset: 0, invalid: true, chainVerified: false };
  const offset = Number(match[1]);
  if (!Number.isInteger(offset) || offset < 0 || offset > items.length || offset > MAX_MEMORY_CORE_CURSOR_OFFSET) {
    return { offset: 0, invalid: true, chainVerified: false };
  }
  const chainVerified = crypto.timingSafeEqual(
    Buffer.from(match[2], "hex"),
    Buffer.from(manifestCursorDigest(prefix, items, offset), "hex"),
  );
  return { offset: chainVerified ? offset : 0, invalid: !chainVerified, chainVerified };
}

function continuityStatusFromDatabase(db, schema, workspace, args) {
  const startedAt = Date.now();
  const resolution = memoryCoreProjectFromDatabase(db, schema, workspace, args.projectId, true);
  if (!resolution.project) return { status: resolution.status, warnings: resolution.warnings, packet: null, sidecar: { exactProjectPath: workspace } };
  const loaded = loadProjectMemoryCoreRecords(db, schema, resolution.project, workspace);
  const candidates = memoryCoreContinuityCandidates(loaded.records, workspace);
  const mandatorySlots = [];
  const descriptors = [];
  let reviewCount = 0;
  for (const slot of PROJECT_CONTINUITY_SLOTS) {
    const currentItems = candidates.current[slot].filter((item) => !item.stale);
    const staleItems = candidates.current[slot].filter((item) => item.stale || item.freshness === "stale");
    const reviewItems = candidates.review[slot];
    const distinct = new Set(currentItems.map((item) => cleanText(item.summary).toLowerCase()));
    const conflict = currentItems.some((item) => item.conflict) || SINGLE_VALUE_CONTINUITY_SLOTS.has(slot) && distinct.size > 1;
    const status = conflict ? "conflict" : currentItems.length > 0 ? "filled" : staleItems.length > 0 ? "stale" : "missing";
    reviewCount += reviewItems.length;
    mandatorySlots.push({
      slot,
      required: true,
      status,
      itemCount: currentItems.length,
      staleItemCount: staleItems.length,
      reviewCandidateCount: reviewItems.length,
      sourceRefCount: currentItems.reduce((sum, item) => sum + item.sourceRefs.length, 0),
      authorityExpectation: "verified_app_authority_receipt_with_direct_source_refs_and_exact_project",
    });
    for (const item of currentItems) descriptors.push({ ...item, mandatory: true });
    for (const item of reviewItems) descriptors.push({ ...item, mandatory: false, advisory: true });
  }
  descriptors.sort((left, right) => PROJECT_CONTINUITY_SLOTS.indexOf(left.slot) - PROJECT_CONTINUITY_SLOTS.indexOf(right.slot)
    || left.id.localeCompare(right.id)
    || cleanText(left.summary).localeCompare(cleanText(right.summary)));
  const manifestFingerprint = hashText(descriptors.map((item) => `${item.slot}|${item.id}|${cleanText(item.summary).toLowerCase()}`).join("\n")).slice(0, 24);
  const cursorPrefix = `continuity-${manifestFingerprint}-`;
  const cursor = parseManifestCursor(args.cursor, cursorPrefix, descriptors);
  const pageSize = clampNumber(args.pageSize, 1, MAX_MEMORY_CORE_PAGE_SIZE, DEFAULT_MEMORY_CORE_PAGE_SIZE);
  const pageItems = descriptors.slice(cursor.offset, cursor.offset + pageSize).map((item) => ({
    id: item.id,
    continuitySlot: item.slot,
    type: item.type,
    title: item.title,
    summary: item.summary,
    status: item.status,
    freshness: item.freshness,
    whyRecalled: [
      item.mandatory ? "mandatory_continuity_item" : "advisory_continuity_candidate",
      `continuity:${item.slot}`,
      "scope:exact_project_id",
      item.authoritative ? "authority:verified" : "authority:unverified_advisory",
    ],
    authority: item.authority,
    sourceRefs: item.sourceRefs.slice(0, 4),
    tokenEstimate: Math.max(20, Math.min(240, estimateTokens(`${item.title} ${item.summary}`))),
    advisory: item.advisory === true,
  }));
  const pageEnd = cursor.offset + pageItems.length;
  const remaining = Math.max(0, descriptors.length - pageEnd);
  const pageComplete = remaining === 0 && !cursor.invalid && !loaded.sourceTruncated;
  const counts = {
    mandatorySlotCount: mandatorySlots.length,
    filled: mandatorySlots.filter((slot) => slot.status === "filled").length,
    missing: mandatorySlots.filter((slot) => slot.status === "missing").length,
    conflict: mandatorySlots.filter((slot) => slot.status === "conflict").length,
    stale: mandatorySlots.filter((slot) => slot.status === "stale").length,
    review: reviewCount,
  };
  const recoveryReady = false;
  const packet = {
    schemaVersion: MEMORY_CORE_CONTINUITY_SCHEMA,
    provider: "zhixia_local_docs",
    mode: "memory_core_continuity_status",
    generatedAt: new Date().toISOString(),
    project: {
      id: resolution.project.id,
      path: workspace,
      name: resolution.project.name,
      summary: resolution.project.summary,
      phase: resolution.project.phase,
      status: resolution.project.status,
      freshness: resolution.project.freshness,
      authority: resolution.project.authority,
    },
    mandatorySlots,
    counts,
    authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
    recoveryReady,
    items: pageItems,
    sourceRefs: collectPacketSourceRefs(pageItems),
    pagination: {
      cursor: args.cursor || null,
      nextCursor: remaining > 0 ? createManifestCursor(cursorPrefix, descriptors, pageEnd) : null,
      pageSize,
      pageStart: cursor.offset,
      pageEndExclusive: pageEnd,
      total: descriptors.length,
      returned: pageItems.length,
      remaining,
      complete: pageComplete,
      pageComplete,
      requiresContinuation: remaining > 0,
      cursorInvalid: cursor.invalid,
      cursorSequential: true,
      cursorTamperEvident: true,
      chainVerified: cursor.chainVerified,
      fullManifestProof: AUTHORITY_VERIFICATION_UNAVAILABLE,
      manifestFingerprint,
      sourceTruncated: loaded.sourceTruncated,
    },
    safety: {
      compactMetadataOnly: true,
      rawSessionBodyRead: false,
      receiptProofIncluded: false,
      trustContextIncluded: false,
      schemaMutation: false,
      mainDatabaseOrWalWrites: false,
    },
    performance: {
      durationMs: Date.now() - startedAt,
      bounded: true,
      fullScans: false,
      maxRowsPerTable: MAX_MEMORY_CORE_ROWS_PER_TABLE,
      tableStats: loaded.tableStats,
    },
    warnings: [
      ...(cursor.invalid ? ["memory_core_continuity_cursor_invalid"] : []),
      "memory_core_authority_verification_unavailable_recovery_not_ready",
      ...(pageComplete ? ["mandatory_page_complete_but_full_manifest_not_authenticated"] : []),
      ...(loaded.sourceTruncated ? ["memory_core_continuity_source_truncated_recovery_not_ready"] : []),
      ...(remaining > 0 ? ["mandatory_continuity_pagination_incomplete"] : []),
    ],
  };
  return { status: "available", warnings: packet.warnings, packet, sidecar: { exactProjectPath: workspace, projectId: resolution.project.id } };
}

function fallbackMemoryCorePacket(schemaVersion, mode, workspace, result) {
  return {
    schemaVersion,
    provider: "zhixia_local_docs",
    mode,
    generatedAt: new Date().toISOString(),
    project: { id: null, path: workspace, name: path.basename(workspace), status: "unavailable", freshness: "unknown", authority: null },
    sidecar: result.sidecar,
    warnings: result.warnings || [],
    safety: {
      compactMetadataOnly: true,
      rawSessionBodyRead: false,
      receiptProofIncluded: false,
      trustContextIncluded: false,
      schemaMutation: false,
      mainDatabaseOrWalWrites: false,
    },
  };
}

function buildMemoryCoreContinuityStatus(workspace, args) {
  const result = withMemoryCoreSidecar((db, schema) => continuityStatusFromDatabase(db, schema, workspace, args));
  if (!result.packet) {
    return {
      ...fallbackMemoryCorePacket(MEMORY_CORE_CONTINUITY_SCHEMA, "memory_core_continuity_status", workspace, result),
      mandatorySlots: PROJECT_CONTINUITY_SLOTS.map((slot) => ({ slot, required: true, status: "unknown", itemCount: 0, staleItemCount: 0, reviewCandidateCount: 0, sourceRefCount: 0 })),
      counts: { mandatorySlotCount: PROJECT_CONTINUITY_SLOTS.length, filled: 0, missing: 0, conflict: 0, stale: 0, review: 0 },
      authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
      recoveryReady: false,
      items: [],
      sourceRefs: [],
      pagination: { cursor: args.cursor || null, nextCursor: null, pageSize: args.pageSize, pageStart: 0, pageEndExclusive: 0, total: 0, returned: 0, remaining: 0, complete: false, pageComplete: false, requiresContinuation: false, cursorInvalid: false, cursorSequential: true, cursorTamperEvident: true, chainVerified: false, fullManifestProof: AUTHORITY_VERIFICATION_UNAVAILABLE, manifestFingerprint: null, sourceTruncated: false },
      performance: { durationMs: 0, bounded: true, fullScans: false, maxRowsPerTable: MAX_MEMORY_CORE_ROWS_PER_TABLE, tableStats: [] },
    };
  }
  return { ...result.packet, sidecar: result.sidecar, warnings: [...new Set([...(result.packet.warnings || []), ...(result.warnings || [])])] };
}

function reviewQueueItem(record) {
  const { title, summary } = memoryCoreTitleAndSummary(record);
  return {
    id: record.id,
    recordKind: record.recordKind,
    title,
    summary,
    status: record.status,
    freshness: record.freshness,
    continuitySlot: continuitySlotForMemoryCoreRecord(record),
    whyQueued: ["lifecycle_requires_review", `status:${record.status}`, `persisted_status:${record.persistedStatus}`, "authority_verification:unavailable", "scope:exact_project_id"],
    reviewReasonCodes: [...new Set([
      ...safeArray(record.payload.reviewReasonCodes || record.payload.reasonCodes).map((reason) => compact(reason, 100)).filter(Boolean),
      ...(record.advisory ? ["authority_verification_unavailable"] : []),
    ])].slice(0, 12),
    authority: memoryCoreAuthoritySummary(record),
    sourceRefs: record.sourceRefs.slice(0, 6),
    tokenEstimate: Math.max(20, Math.min(260, estimateTokens(`${title} ${summary}`))),
    updatedAt: record.updatedAt,
  };
}

function buildMemoryCoreReviewQueue(workspace, args) {
  const startedAt = Date.now();
  const result = withMemoryCoreSidecar((db, schema) => {
    const resolution = memoryCoreProjectFromDatabase(db, schema, workspace, args.projectId, true);
    if (!resolution.project) return { status: resolution.status, warnings: resolution.warnings, packet: null, sidecar: { exactProjectPath: workspace } };
    const items = [];
    const tableCounts = [];
    let sourceTruncated = false;
    for (const spec of MEMORY_CORE_TABLE_SPECS) {
      if (!schema.compatibleTables.includes(spec.table)) continue;
      const reviewableStatuses = new Set([...MEMORY_CORE_REVIEW_STATUSES, ...MEMORY_CORE_CURRENT_STATUSES]);
      const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${spec.table} WHERE projectId = ? AND lower(status) IN ('accepted', 'curated', 'candidate', 'review')`).get(resolution.project.id)?.count || 0);
      const rows = selectMemoryCoreRows(db, spec, resolution.project.id, reviewableStatuses, MAX_MEMORY_CORE_ROWS_PER_TABLE);
      if (count > rows.length) sourceTruncated = true;
      let eligible = 0;
      for (const row of rows) {
        const record = parseMemoryCoreRow(row, spec, { workspace, projectId: resolution.project.id });
        if (!record || !MEMORY_CORE_REVIEW_STATUSES.has(record.status)) continue;
        items.push(reviewQueueItem(record));
        eligible += 1;
      }
      tableCounts.push({ table: spec.table, count, eligible, truncated: count > rows.length });
    }
    items.sort((left, right) => (Date.parse(right.updatedAt || "") || 0) - (Date.parse(left.updatedAt || "") || 0) || left.id.localeCompare(right.id));
    const fingerprint = hashText(`${resolution.project.id}|${items.map((item) => `${item.recordKind}:${item.id}:${item.updatedAt || ""}`).join("|")}`).slice(0, 24);
    const prefix = `review-${fingerprint}-`;
    const cursor = parseManifestCursor(args.cursor, prefix, items);
    const pageSize = clampNumber(args.pageSize, 1, MAX_MEMORY_CORE_PAGE_SIZE, DEFAULT_MEMORY_CORE_PAGE_SIZE);
    const pageItems = items.slice(cursor.offset, cursor.offset + pageSize);
    const pageEnd = cursor.offset + pageItems.length;
    const remaining = Math.max(0, items.length - pageEnd);
    const packet = {
      schemaVersion: MEMORY_CORE_REVIEW_QUEUE_SCHEMA,
      provider: "zhixia_local_docs",
      mode: "memory_core_review_queue",
      generatedAt: new Date().toISOString(),
      project: { id: resolution.project.id, path: workspace, name: resolution.project.name, status: resolution.project.status, freshness: resolution.project.freshness, authority: resolution.project.authority },
      items: pageItems,
      sourceRefs: collectPacketSourceRefs(pageItems),
      counts: { totalEligible: items.length, returned: pageItems.length, tableCounts },
      pagination: {
        cursor: args.cursor || null,
        nextCursor: remaining > 0 ? createManifestCursor(prefix, items, pageEnd) : null,
        pageSize,
        pageStart: cursor.offset,
        pageEndExclusive: pageEnd,
        total: items.length,
        returned: pageItems.length,
        remaining,
        complete: remaining === 0 && !cursor.invalid && !sourceTruncated,
        pageComplete: remaining === 0 && !cursor.invalid && !sourceTruncated,
        cursorInvalid: cursor.invalid,
        cursorSequential: true,
        cursorTamperEvident: true,
        chainVerified: cursor.chainVerified,
        manifestFingerprint: fingerprint,
        sourceTruncated,
      },
      safety: { compactMetadataOnly: true, rawSessionBodyRead: false, receiptProofIncluded: false, trustContextIncluded: false, schemaMutation: false, mainDatabaseOrWalWrites: false },
      performance: { durationMs: Date.now() - startedAt, bounded: true, fullScans: false, maxRowsPerTable: MAX_MEMORY_CORE_ROWS_PER_TABLE },
      warnings: [
        ...(cursor.invalid ? ["memory_core_review_cursor_invalid"] : []),
        ...(sourceTruncated ? ["memory_core_review_queue_source_truncated"] : []),
      ],
    };
    return { status: "available", warnings: packet.warnings, packet, sidecar: { exactProjectPath: workspace, projectId: resolution.project.id } };
  });
  if (!result.packet) {
    return {
      ...fallbackMemoryCorePacket(MEMORY_CORE_REVIEW_QUEUE_SCHEMA, "memory_core_review_queue", workspace, result),
      items: [],
      sourceRefs: [],
      counts: { totalEligible: 0, returned: 0, tableCounts: [] },
      pagination: { cursor: args.cursor || null, nextCursor: null, pageSize: args.pageSize, pageStart: 0, pageEndExclusive: 0, total: 0, returned: 0, remaining: 0, complete: false, pageComplete: false, cursorInvalid: false, cursorSequential: true, cursorTamperEvident: true, chainVerified: false, manifestFingerprint: null, sourceTruncated: false },
      performance: { durationMs: Date.now() - startedAt, bounded: true, fullScans: false, maxRowsPerTable: MAX_MEMORY_CORE_ROWS_PER_TABLE },
    };
  }
  return { ...result.packet, sidecar: result.sidecar, warnings: [...new Set([...(result.packet.warnings || []), ...(result.warnings || [])])] };
}

function buildMemoryCoreDiagnostics(workspace, args) {
  const startedAt = Date.now();
  if (!args.projectId) {
    const fallback = {
      status: "project_id_required",
      warnings: ["memory_core_project_id_required_for_diagnostics"],
      sidecar: memoryCoreSidecarSummary("not_opened"),
    };
    return {
      ...fallbackMemoryCorePacket(MEMORY_CORE_DIAGNOSTICS_SCHEMA, "memory_core_diagnostics", workspace, fallback),
      schema: { logicalSchemaVersion: "unknown", sqliteUserVersion: null, sqliteSchemaVersion: null, sqliteApplicationId: null, compatibleTables: [], incompatibleTables: [], missingTables: [] },
      lifecycleTotals: { current: 0, review: 0, historical: 0, other: 0 },
      tables: [],
      performance: { durationMs: Date.now() - startedAt, bounded: true, fullScans: false, projectScopedIndexedAggregatesOnly: true, tableLimit: MAX_MEMORY_CORE_DIAGNOSTIC_TABLES },
    };
  }
  const result = withMemoryCoreSidecar((db, schema) => {
    const resolution = memoryCoreProjectFromDatabase(db, schema, workspace, args.projectId, true);
    if (!resolution.project) return { status: resolution.status, warnings: resolution.warnings, packet: null, sidecar: { exactProjectPath: workspace } };
    const tables = [];
    const lifecycleTotals = { current: 0, review: 0, historical: 0, other: 0 };
    for (const spec of MEMORY_CORE_TABLE_SPECS.slice(0, MAX_MEMORY_CORE_DIAGNOSTIC_TABLES)) {
      if (!schema.compatibleTables.includes(spec.table)) continue;
      const groups = db.prepare(`SELECT lower(status) AS status, COUNT(*) AS count, MAX(updatedAt) AS latestUpdatedAt FROM ${spec.table} WHERE projectId = ? GROUP BY lower(status) LIMIT 16`).all(resolution.project.id);
      const statusCounts = {};
      let latestUpdatedAt = null;
      for (const group of groups) {
        const status = cleanText(group.status || "unknown").toLowerCase() || "unknown";
        const count = Number(group.count || 0);
        statusCounts[status] = count;
        if (!latestUpdatedAt || group.latestUpdatedAt > latestUpdatedAt) latestUpdatedAt = group.latestUpdatedAt;
        if (MEMORY_CORE_CURRENT_STATUSES.has(status)) lifecycleTotals.current += count;
        else if (MEMORY_CORE_REVIEW_STATUSES.has(status)) lifecycleTotals.review += count;
        else if (MEMORY_CORE_HISTORICAL_STATUSES.has(status)) lifecycleTotals.historical += count;
        else lifecycleTotals.other += count;
      }
      tables.push({ table: spec.table, recordKind: spec.recordKind, statusCounts, latestUpdatedAt });
    }
    const packet = {
      schemaVersion: MEMORY_CORE_DIAGNOSTICS_SCHEMA,
      provider: "zhixia_local_docs",
      mode: "memory_core_diagnostics",
      generatedAt: new Date().toISOString(),
      project: { id: resolution.project.id, path: workspace, name: resolution.project.name, status: resolution.project.status, freshness: resolution.project.freshness, authority: resolution.project.authority },
      schema: {
        logicalSchemaVersion: schema.logicalSchemaVersion,
        sqliteUserVersion: schema.sqliteUserVersion,
        sqliteSchemaVersion: schema.sqliteSchemaVersion,
        sqliteApplicationId: schema.sqliteApplicationId,
        compatibleTables: schema.compatibleTables,
        incompatibleTables: schema.incompatibleTables,
        missingTables: schema.missingTables,
      },
      lifecycleTotals,
      tables,
      safety: { compactMetadataOnly: true, payloadBodiesReturned: false, rawSessionBodyRead: false, receiptProofIncluded: false, trustContextIncluded: false, schemaMutation: false, mainDatabaseOrWalWrites: false },
      performance: { durationMs: Date.now() - startedAt, bounded: true, fullScans: false, projectScopedIndexedAggregatesOnly: true, tableLimit: MAX_MEMORY_CORE_DIAGNOSTIC_TABLES },
      warnings: [],
    };
    return { status: "available", warnings: [], packet, sidecar: { exactProjectPath: workspace, projectId: resolution.project.id } };
  });
  if (!result.packet) {
    return {
      ...fallbackMemoryCorePacket(MEMORY_CORE_DIAGNOSTICS_SCHEMA, "memory_core_diagnostics", workspace, result),
      schema: { logicalSchemaVersion: result.sidecar?.schemaVersion || "unknown", sqliteUserVersion: result.sidecar?.sqliteUserVersion ?? null, sqliteSchemaVersion: result.sidecar?.sqliteSchemaVersion ?? null, sqliteApplicationId: result.sidecar?.sqliteApplicationId ?? null, compatibleTables: result.sidecar?.compatibleTables || [], incompatibleTables: result.sidecar?.incompatibleTables || [], missingTables: result.sidecar?.missingTables || [] },
      lifecycleTotals: { current: 0, review: 0, historical: 0, other: 0 },
      tables: [],
      performance: { durationMs: Date.now() - startedAt, bounded: true, fullScans: false, projectScopedIndexedAggregatesOnly: true, tableLimit: MAX_MEMORY_CORE_DIAGNOSTIC_TABLES },
    };
  }
  return { ...result.packet, sidecar: result.sidecar, warnings: [...new Set([...(result.packet.warnings || []), ...(result.warnings || [])])] };
}

function trimItemsToBudget(items, limit, tokenBudget) {
  const chosen = [];
  let total = 0;
  const softBudget = Math.max(140, Math.round(tokenBudget * 1.1));
  for (const item of items) {
    if (chosen.length >= limit) break;
    if (chosen.length > 0 && total + item.tokenEstimate > softBudget) continue;
    chosen.push(item);
    total += item.tokenEstimate;
  }
  if (chosen.length === 0 && items[0]) {
    chosen.push(items[0]);
    total = items[0].tokenEstimate;
  }
  return { items: chosen, tokenEstimate: total };
}

function overallFreshness(items) {
  if (items.some((item) => item.freshness === "stale")) return "stale";
  if (items.some((item) => item.freshness === "review")) return "review";
  return "fresh";
}

function compatibilityResults(items) {
  return items.map((item) => ({
    kind: item.kind,
    path: item.sourcePath,
    title: item.title,
    excerpt: item.excerpt,
    score: item.score,
    freshness: item.freshness,
    status: item.status,
  }));
}

function collectResults(workspace, options) {
  const { items: fileItems, files, warnings: collectionWarnings } = collectItems(workspace, options);
  const sidecar = collectMemoryFactItems(workspace, options);
  const memoryCore = collectMemoryCoreItems(workspace, options);
  const items = [...fileItems, ...sidecar.items, ...memoryCore.items]
    .sort((left, right) => (right.score !== left.score ? right.score - left.score : left.tokenEstimate - right.tokenEstimate));
  const trimmed = trimItemsToBudget(items, options.limit, options.tokenBudget);
  const warnings = [...collectionWarnings, ...sidecar.warnings, ...memoryCore.warnings];
  if (files.length === 0 && !options.allowParentKnowledge) {
    warnings.push("No .codex-knowledge files were found in the requested workspace. Parent directory knowledge was not used; pass --allow-parent-knowledge to opt into legacy upward search.");
  }
  const payload = {
    provider: "zhixia_local_docs",
    mode: "file_contract",
    workspace,
    parentKnowledgeAllowed: options.allowParentKnowledge,
    queryType: options.queryType,
    query: options.query,
    tokenBudget: options.tokenBudget,
    returnedCount: trimmed.items.length,
    tokenEstimate: trimmed.tokenEstimate,
    freshness: overallFreshness(trimmed.items),
    generatedAt: new Date().toISOString(),
    warnings,
    files,
    items: trimmed.items,
    results: compatibilityResults(trimmed.items),
  };
  if (sidecar.requested) {
    payload.memoryFactSidecar = {
      status: sidecar.status,
      authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
      persistedRowsAreAdvisory: true,
      readOnly: true,
      logicalReadOnly: true,
      sqlWrites: false,
      schemaMutation: false,
      mainDatabaseOrWalWrites: false,
      sqliteShmCoordinationMayChange: true,
      busyTimeoutMs: MEMORY_FACT_BUSY_TIMEOUT_MS,
      exactProjectPath: workspace,
      returnedCount: trimmed.items.filter((item) => item.kind === "memory_fact").length,
    };
  }
  if (memoryCore.requested !== false) {
    payload.memoryCoreSidecar = {
      ...memoryCore.sidecar,
      authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
      persistedRowsAreAdvisory: true,
      returnedCount: trimmed.items.filter((item) => MEMORY_CORE_ALLOWED_HELPER_KINDS.includes(item.kind)).length,
    };
  }
  return payload;
}

function normalizeRuntimeStatus(status) {
  if (status === "accepted" || status === "current") return "active";
  if (["active", "curated", "ready", "candidate", "review", "stale", "superseded", "blocked"].includes(status)) return status;
  if (status === "draft" || status === "compatibility") return "candidate";
  return "review";
}

function runtimeItemFromHelperItem(item) {
  return {
    id: item.id,
    kind: item.runtimeKind || RUNTIME_KIND_BY_HELPER_KIND[item.kind] || "knowledge_item",
    title: item.title,
    summary: item.excerpt,
    status: normalizeRuntimeStatus(item.status),
    freshness: item.freshness || "unknown",
    whyMatched: item.whyMatched || [],
    whyRecalled: item.whyRecalled || item.whyMatched || [],
    authority: item.authority || {
      status: normalizeRuntimeStatus(item.status),
      authoritative: false,
      authorityVerification: AUTHORITY_VERIFICATION_UNAVAILABLE,
      advisory: true,
      scope: "workspace_file_contract",
      sourceBacked: Array.isArray(item.sourceRefs) && item.sourceRefs.length > 0,
      validity: item.freshness === "stale" ? "inactive" : "current",
      persistedTrust: "source_metadata_only",
      receiptProofIncluded: false,
      trustContextIncluded: false,
    },
    continuitySlot: item.continuitySlot || null,
    sourceRefs: item.sourceRefs || [],
    tokenEstimate: item.tokenEstimate || estimateTokens(`${item.title} ${item.excerpt}`),
    requiresHumanConfirmation: item.requiresHumanConfirmation === true || item.freshness !== "fresh",
    rawSessionPolicy: "not_allowed",
    memoryLayer: item.memoryLayer || "warm",
    recallDepth: item.recallDepth || "summary",
  };
}

function collectPacketSourceRefs(items) {
  const seen = new Set();
  const refs = [];
  for (const item of items) {
    for (const ref of item.sourceRefs || []) {
      const key = `${ref.kind}|${ref.path}|${ref.hash || ""}|${ref.title || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
      if (refs.length >= 20) return refs;
    }
  }
  return refs;
}

function buildRuntimeContextPacket(retrieval, options) {
  const items = (retrieval.items || []).map(runtimeItemFromHelperItem).filter((item) => RUNTIME_ALLOWED_KINDS.includes(item.kind));
  const memoryLayers = summarizeMemoryLayers(items);
  return {
    schemaVersion: 1,
    provider: retrieval.provider,
    mode: "runtime_context_packet",
    request: {
      taskGoal: compact(options.taskGoal || options.query || retrieval.query || "", 260),
      queryType: options.queryType || DEFAULT_QUERY_TYPE,
      projectPath: retrieval.workspace,
      tokenBudget: retrieval.tokenBudget,
      allowedKinds: Array.from(new Set(items.map((item) => item.kind))),
    },
    project: {
      name: path.basename(retrieval.workspace),
      path: retrieval.workspace,
      freshness: retrieval.freshness || "unknown",
      status: items.some((item) => item.status === "active") ? "active" : "review",
      summary: items[0]?.summary || "",
      nextAction: "",
      blockers: [],
    },
    items,
    sourceRefs: collectPacketSourceRefs(items),
    memoryMode: "layered",
    memoryLayers,
    recallPlan: buildRecallPlan(options, memoryLayers),
    memoryFactSidecar: retrieval.memoryFactSidecar || null,
    memoryCoreSidecar: retrieval.memoryCoreSidecar || null,
    warnings: [
      "metadata_first_no_raw_session_body",
      "no_giant_markdown_or_base64_default_output",
      "no_archive_compact_delete_move_restore",
      "layered_memory_hot_warm_default_cold_pointer_only",
      ...retrieval.warnings,
    ],
    tokenEstimate: retrieval.tokenEstimate,
    generatedAt: retrieval.generatedAt,
  };
}

function summarizeMemoryLayers(items) {
  const summary = {
    hot: { count: 0, tokenEstimate: 0, role: "短期工作记忆：当前目标、最近决策、正在进行的模块。" },
    warm: { count: 0, tokenEstimate: 0, role: "项目长期摘要：PRD、架构、验收记录、模块演化和重要设计来源。" },
    cold: { count: 0, tokenEstimate: 0, role: "长历史证据指针：旧线程、Vault、归档历史，默认只给 sourceRefs 不读正文。" },
    skill: { count: 0, tokenEstimate: 0, role: "程序性记忆：经验卡、工具、Skill 候选和可复用流程。" },
  };
  for (const item of items || []) {
    const layer = summary[item.memoryLayer] ? item.memoryLayer : "warm";
    summary[layer].count += 1;
    summary[layer].tokenEstimate += Number(item.tokenEstimate || 0);
  }
  return summary;
}

function buildRecallPlan(options, memoryLayers) {
  const coldEnabled = Boolean(options.allowColdLayer || options.recoverThread || COLD_QUERY_TYPES.has(options.queryType));
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
      "先用 hot 工作记忆恢复当前目标和下一步。",
      "再用 warm 项目长期摘要补齐最初设计、模块状态和验收结论。",
      "需要做法或避免重复错误时读取 skill/procedural 记忆。",
      "只有摘要不足、线程恢复或证据冲突时，才按 sourceRefs 小范围读取 cold 长历史。",
    ],
    layerCounts: {
      hot: memoryLayers.hot.count,
      warm: memoryLayers.warm.count,
      skill: memoryLayers.skill.count,
      cold: memoryLayers.cold.count,
    },
  };
}

function buildRuntimePrecedentPacket(retrieval, options) {
  const packet = buildRuntimeContextPacket(retrieval, {
    ...options,
    taskGoal: options.taskGoal || options.query,
    queryType: "retrieve_precedent",
  });
  return {
    ...packet,
    mode: "runtime_precedent_packet",
    request: {
      ...packet.request,
      taskType: compact(options.taskGoal || options.query || retrieval.query || "", 240),
    },
    precedentPolicy: {
      metadataFirst: true,
      rawSessionDefaultRead: false,
      giantMarkdownDefaultRead: false,
      allowedHelperKinds: PRECEDENT_KINDS,
    },
  };
}

function normalizeRecoveryPointer(pointer = {}) {
  const pointerPath = pointer.path ? String(pointer.path) : null;
  return {
    kind: compact(pointer.kind || "source", 80),
    path: pointerPath,
    title: pointer.title ? compact(pointer.title, 180) : null,
    threadId: pointer.threadId ? compact(pointer.threadId, 120) : null,
    hash: pointer.hash || pointer.sha256 || null,
    sizeBytes: Number.isFinite(Number(pointer.sizeBytes)) ? Number(pointer.sizeBytes) : null,
    updatedAt: pointer.updatedAt || null,
    readByDefault: false,
    rawSessionPolicy: RAW_SESSION_RE.test([pointer.kind, pointerPath, pointer.title].filter(Boolean).join(" "))
      ? "explicit_user_recovery_only_no_default_body_read"
      : "metadata_pointer_only",
  };
}

function collectRecoveryProjectDocs(workspace) {
  const docs = [];
  for (const rel of RECOVERY_DOCS) {
    const filePath = path.join(workspace, rel);
    if (!fs.existsSync(filePath)) continue;
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) continue;
    docs.push(normalizeRecoveryPointer({
      kind: "project_artifact",
      path: filePath,
      title: rel,
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString(),
    }));
    if (docs.length >= 12) break;
  }
  return docs;
}

function buildThreadRecoveryPrompt(packet) {
  const docs = (packet.recommendedReadOrder || []).map((item) => item.path).filter(Boolean).slice(0, 8);
  return [
    "你接替一个旧 Codex/CEO 线程继续工作。先读取这个 ThreadRecoveryPacket，不要直接加载原始 session。",
    packet.thread.threadId ? `目标 threadId: ${packet.thread.threadId}` : "",
    packet.thread.title ? `线程标题/查询: ${packet.thread.title}` : "",
    packet.thread.projectPath ? `项目路径: ${packet.thread.projectPath}` : "",
    docs.length ? `优先读取项目文档: ${docs.join(" ; ")}` : "",
    "raw session / vault session 只作为 cold evidence，默认不读正文；需要时按 sourceRefs 小范围回查。",
    "接手后先检查当前文件状态和测试状态，再更新 WorkingMemory。",
  ].filter(Boolean).join("\n");
}

function buildThreadRecoveryPacket(retrieval, options) {
  const context = buildRuntimeContextPacket(retrieval, {
    ...options,
    queryType: "thread_recovery",
    taskGoal: options.taskGoal || options.query || options.threadTitle || options.threadId,
  });
  const title = compact(options.threadTitle || options.query || context.project.summary || "", 180);
  const projectDocPointers = collectRecoveryProjectDocs(retrieval.workspace);
  const projectDocs = projectDocPointers.filter((doc) => !doc.sizeBytes || doc.sizeBytes <= MAX_RECOVERY_RECOMMENDED_DOC_BYTES);
  const largeProjectDocs = projectDocPointers.filter((doc) => doc.sizeBytes && doc.sizeBytes > MAX_RECOVERY_RECOMMENDED_DOC_BYTES);
  const projectBrainContinuity = buildMemoryCoreContinuityStatus(retrieval.workspace, options);
  const sourceRefs = [
    ...projectDocs,
    ...largeProjectDocs.map((doc) => ({
      ...doc,
      kind: "large_project_artifact_pointer",
      title: doc.title ? `${doc.title}（大文件，默认不读）` : "大文件，默认不读",
    })),
    ...collectPacketSourceRefs(context.items).map((ref) => normalizeRecoveryPointer({
      kind: ref.kind || "zhixia_knowledge_file",
      path: ref.path,
      title: ref.title,
      hash: ref.hash,
      updatedAt: ref.updatedAt,
    })),
  ].filter(Boolean).slice(0, 24);
  const packet = {
    schemaVersion: "zhixia.thread_recovery_packet.v1",
    provider: retrieval.provider,
    mode: "thread_recovery_packet",
    generatedAt: retrieval.generatedAt,
    request: {
      threadId: options.threadId || null,
      title: title || null,
      query: compact(options.query || title || options.threadId || "", 240),
      projectPath: retrieval.workspace,
      tokenBudget: Math.min(MAX_TOKEN_BUDGET, Math.max(MIN_TOKEN_BUDGET, options.tokenBudget || DEFAULT_RECOVERY_TOKEN_BUDGET)),
    },
    thread: {
      threadId: options.threadId || null,
      title: title || "",
      projectPath: retrieval.workspace,
      parentCeoThreadId: options.parentCeoThreadId || null,
      confidence: context.items.length > 0 || projectDocs.length > 0 ? "source_backed" : "needs_review",
    },
    lineage: [],
    vault: {
      hasVault: false,
      manifests: [],
      policy: "helper_metadata_only_no_vault_walk",
    },
    context: {
      packetId: context.cacheKey || null,
      itemCount: context.items.length,
      items: context.items.slice(0, 10),
    },
    projectBrainContinuity,
    recommendedReadOrder: projectDocs,
    coldHistorySources: largeProjectDocs.map((doc) => ({
      ...doc,
      kind: "large_project_artifact_pointer",
      title: doc.title ? `${doc.title}（大文件，默认不读）` : "大文件，默认不读",
    })),
    sourceRefs,
    nextActions: [
      "先读取 recommendedReadOrder 中的项目文档。",
      "再用 retrieve_context(task_goal, thread_recovery) 获取当前热/温上下文。",
      "只有 compact 恢复包不足时，才按 coldHistorySources/sourceRefs 小范围读取 raw/vault session。",
      "接手线程启动后写入 WorkingMemoryRecord，结束时 writeback_evidence。",
    ],
    prompt: "",
    performance: {
      metadataFirst: true,
      rawSessionBodyRead: false,
      scansFullDatabase: false,
      startsTimers: false,
      boundedSourcePointers: true,
      helperReadsOnlyWorkspaceKnowledge: true,
    },
    safety: {
      mutatesRawSession: false,
      archiveCompactDeleteMoveRestore: false,
      installsOrExecutes: false,
      rawSessionDefaultRead: false,
    },
    warnings: [
      "metadata_first_recovery_packet",
      "raw_session_body_not_read_by_default",
      "helper_does_not_walk_thread_history_vault",
      "no_archive_compact_delete_move_restore",
      ...(largeProjectDocs.length > 0 ? ["large_recovery_docs_pointer_only"] : []),
      ...(context.items.length === 0 ? ["no_runtime_context_items_matched"] : []),
      ...(!projectBrainContinuity.recoveryReady ? ["project_brain_continuity_not_recovery_ready"] : []),
      ...retrieval.warnings,
    ],
    tokenEstimate: estimateTokens(`${title} ${context.items.map((item) => item.summary).join(" ")} ${projectBrainContinuity.items.map((item) => `${item.continuitySlot} ${item.summary}`).join(" ")}`),
  };
  packet.prompt = buildThreadRecoveryPrompt(packet);
  return packet;
}

function pressureMetric(options, name) {
  return Math.max(0, Number(options[name] || 0) || 0);
}

function evaluateCeoThreadPressure(options = {}) {
  const metrics = {
    sessionBytes: pressureMetric(options, "sessionBytes"),
    lineCount: pressureMetric(options, "lineCount"),
    maxLineChars: pressureMetric(options, "maxLineChars"),
    linesOver100k: pressureMetric(options, "linesOver100k"),
    dataImageHits: pressureMetric(options, "dataImageHits"),
    base64Hits: pressureMetric(options, "base64Hits"),
    imagePathHits: pressureMetric(options, "imagePathHits"),
    toolOutputLikeHits: pressureMetric(options, "toolOutputLikeHits"),
    visibleThreadCount: pressureMetric(options, "visibleThreadCount"),
    activeWorkerCount: pressureMetric(options, "activeWorkerCount"),
    longTitleCount: pressureMetric(options, "longTitleCount"),
  };
  const gates = {
    writebackRequired: false,
    stopNewDispatch: false,
    harvestOnly: false,
    takeoverRecommended: false,
    freezeRisk: false,
  };
  const warnings = [];
  if (metrics.sessionBytes >= 50 * MB || metrics.maxLineChars >= 100000 || metrics.linesOver100k > 0) {
    gates.writebackRequired = true;
    warnings.push("thread_pressure_writeback_required");
  }
  if (metrics.sessionBytes >= 100 * MB || metrics.linesOver100k >= 25 || metrics.toolOutputLikeHits >= 5000) {
    gates.harvestOnly = true;
    warnings.push("thread_pressure_harvest_only");
  }
  if (metrics.sessionBytes >= 150 * MB || metrics.linesOver100k >= 80 || metrics.dataImageHits >= 200 || metrics.base64Hits >= 1000) {
    gates.takeoverRecommended = true;
    warnings.push("thread_pressure_takeover_recommended");
  }
  if (metrics.sessionBytes >= 200 * MB || metrics.linesOver100k >= 150 || metrics.dataImageHits >= 1000 || metrics.base64Hits >= 2000) {
    gates.freezeRisk = true;
    gates.stopNewDispatch = true;
    warnings.push("thread_pressure_freeze_risk_stop_dispatch");
  }
  if (metrics.activeWorkerCount >= 4 || metrics.visibleThreadCount >= 8 || metrics.longTitleCount >= 8) {
    gates.writebackRequired = true;
    gates.harvestOnly = true;
    warnings.push("multi_thread_visible_pressure_harvest_only");
  }
  const pressureLevel = gates.freezeRisk
    ? "critical"
    : gates.takeoverRecommended
    ? "high"
    : gates.harvestOnly
    ? "warning"
    : gates.writebackRequired
    ? "watch"
    : "ok";
  const action = gates.freezeRisk
    ? "freeze_risk_stop_dispatch"
    : gates.takeoverRecommended
    ? "takeover_recommended"
    : gates.harvestOnly
    ? "harvest_only"
    : gates.writebackRequired
    ? "writeback_required"
    : "continue";
  return {
    schemaVersion: "zhixia.ceo_memory_runtime_guard.v1",
    generatedAt: new Date().toISOString(),
    threadId: options.threadId || options.currentCeoThreadId || null,
    projectPath: options.workspace || options.projectPath || null,
    pressureLevel,
    action,
    sessionMb: Number((metrics.sessionBytes / MB).toFixed(2)),
    metrics,
    gates,
    recommendations: [
      gates.writebackRequired ? "write_compact_ceo_memory_before_more_work" : "",
      gates.harvestOnly ? "harvest_existing_workers_do_not_dispatch_new_lanes" : "",
      gates.takeoverRecommended ? "build_takeover_bootstrap_packet_for_clean_ceo_thread" : "",
      gates.freezeRisk ? "stop_using_visible_bloated_thread_for_new_work" : "",
      metrics.dataImageHits || metrics.base64Hits ? "keep_visual_evidence_as_local_paths_hashes_summaries_not_chat_payloads" : "",
    ].filter(Boolean),
    warnings,
    performance: {
      purePolicy: true,
      startsTimers: false,
      scansVault: false,
      readsRawSessionBody: false,
      mutatesCodexSessions: false,
      archiveCompactDeleteMoveRestore: false,
    },
  };
}

function buildCeoTakeoverBootstrapPacket(retrieval, options) {
  const context = buildRuntimeContextPacket(retrieval, {
    ...options,
    queryType: "project_resume",
    taskGoal: options.taskGoal || options.query || options.projectName || options.threadTitle || options.threadId,
  });
  const recovery = buildThreadRecoveryPacket(retrieval, {
    ...options,
    threadId: options.threadId || options.currentCeoThreadId,
    threadTitle: options.threadTitle || options.projectName,
    query: options.query || options.taskGoal || options.projectName,
  });
  const pressure = evaluateCeoThreadPressure({
    ...options,
    workspace: retrieval.workspace,
    threadId: options.currentCeoThreadId || options.threadId,
  });
  const projectName = compact(options.projectName || context.project.name || options.threadTitle || "当前项目", 160);
  return {
    schemaVersion: "zhixia.ceo_takeover_bootstrap_packet.v1",
    mode: "ceo_takeover_bootstrap_packet",
    generatedAt: new Date().toISOString(),
    project: {
      name: projectName,
      path: retrieval.workspace,
      summary: compact(options.projectSummary || context.project.summary || "", 700),
    },
    threads: {
      currentCeoThreadId: options.currentCeoThreadId || options.threadId || null,
      replacementThreadId: options.replacementThreadId || null,
      staleThreadIds: options.staleThreadIds,
    },
    request: {
      taskGoal: compact(options.taskGoal || options.query || `恢复 ${projectName} 当前项目状态`, 360),
      tokenBudget: options.tokenBudget,
      queryType: "thread_recovery",
    },
    threadPressure: pressure,
    runtimeContext: context,
    recoveryPacket: {
      schemaVersion: recovery.schemaVersion,
      mode: recovery.mode,
      thread: recovery.thread,
      recommendedReadOrder: recovery.recommendedReadOrder,
      coldHistorySources: recovery.coldHistorySources,
      warnings: recovery.warnings,
      prompt: recovery.prompt,
    },
    recallPlan: {
      defaultReadOrder: ["hot", "warm", "canonical_docs", "skill", "source_refs", "cold_pointers_only"],
      hot: "current goal, working memory, recent accepted decisions, blockers, next action",
      warm: "long-term project anchors, PRD/product direction, architecture constraints, accepted module progress",
      skill: "procedural lessons and reusable workflow candidates; advisory only",
      cold: "Thread History Vault/raw session/archive pointers only; readByDefault=false unless an explicit recovery hard gate is satisfied",
      coldLayer: { defaultRead: false, requiresExplicitGate: true },
    },
    recommendedHooks: [
      { hook: "retrieve_context", queryType: "project_resume", tokenBudget: 1800, reason: "recover hot/warm project state before old-thread history" },
      { hook: "retrieve_precedent", queryType: "thread_recovery", tokenBudget: 1000, reason: "find broken-thread and bloat lessons" },
      { hook: "writeback_evidence", queryType: "handoff", tokenBudget: 800, reason: "write compact decisions after each accepted slice" },
    ],
    sourceRefs: context.sourceRefs,
    coldHistorySources: recovery.coldHistorySources,
    oneLinePrompt: `你是 ${projectName} 的新 CEO 接管线程。请使用知匣 Memory Runtime 恢复当前项目状态：先读 Hot/Warm/Skill 记忆和 canonical docs，Cold/raw 历史只看 sourceRefs，不默认加载旧线程全文、图片/base64 或完整工具日志。`,
    warnings: [...pressure.warnings, ...context.warnings, ...recovery.warnings],
    safety: {
      metadataOnly: true,
      rawSessionBodyRead: false,
      coldHistoryDefaultRead: false,
      startsTimers: false,
      scansVault: false,
      archiveCompactDeleteMoveRestore: false,
      mutatesRawSession: false,
    },
  };
}

function readEvidenceJson(rawValue, workspace) {
  if (!rawValue) return {};
  const trimmed = String(rawValue).trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const evidencePath = resolveWorkspaceContainedPath(workspace, trimmed, "--evidence-json");
  return JSON.parse(fs.readFileSync(evidencePath, "utf8"));
}

function resolveWorkspaceContainedPath(workspace, candidatePath, optionName) {
  const workspaceRoot = path.resolve(workspace);
  const resolved = path.resolve(workspaceRoot, String(candidatePath || ""));
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${optionName} must stay inside the requested workspace.`);
  }
  const realWorkspaceRoot = fs.realpathSync.native ? fs.realpathSync.native(workspaceRoot) : fs.realpathSync(workspaceRoot);
  let existingAncestor = resolved;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const realExistingAncestor = fs.realpathSync.native ? fs.realpathSync.native(existingAncestor) : fs.realpathSync(existingAncestor);
  const realRelative = path.relative(realWorkspaceRoot, realExistingAncestor);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`${optionName} must stay inside the requested workspace.`);
  }
  return resolved;
}

function normalizeEvidenceSourceRefs(evidence, args) {
  const refs = [
    ...safeArray(evidence.evidence?.sourceRefs),
    ...safeArray(evidence.sourceRefs),
    ...safeArray(args.sourceRefs),
  ].filter(Boolean).map((ref) => ({
    kind: cleanText(ref.kind || ref.sourceType || "source") || "source",
    path: ref.path ? String(ref.path) : null,
    title: ref.title ? compact(ref.title, 180) : null,
    hash: ref.hash || ref.sha256 || ref.sourceHash || null,
  })).filter((ref) => ref.path || ref.title);
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.kind}|${ref.path || ""}|${ref.hash || ""}|${ref.title || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function hasUnsafeRef(refs, re) {
  return refs.some((ref) => re.test([ref.kind, ref.path, ref.title].filter(Boolean).join(" ")));
}

function normalizeWritebackReusablePatterns(evidence) {
  return [
    ...safeArray(evidence.evidence?.reusablePattern),
    ...safeArray(evidence.evidence?.reusable_pattern),
    ...safeArray(evidence.reusablePattern),
    ...safeArray(evidence.writeback?.flowSkillCandidate?.reusablePattern),
    ...safeArray(evidence.writeback?.flowSkillCandidate?.reusable_pattern),
  ].map((item) => compact(item, 360)).filter(Boolean).slice(0, 12);
}

function buildFlowSkillCandidatePreview(packet, sourceRefs) {
  const candidateCore = {
    schemaVersion: 1,
    kind: "flowskill_candidate",
    visibility: "private",
    status: "private_review",
    task: packet.task,
    evidence: {
      summary: packet.evidence.summary,
      reusablePattern: packet.evidence.reusablePattern,
      doNotApplyTo: [],
      tests: packet.evidence.tests,
      artifacts: packet.evidence.artifacts,
      changedFiles: packet.evidence.changedFiles,
      residualRisk: packet.evidence.residualRisk,
      sourceRefs,
    },
    sourceRefs,
    privacy: {
      containsRawSession: packet.privacy.containsRawSession,
      containsSecrets: packet.privacy.containsSecrets,
      publicCandidateAllowed: false,
      redactionRequired: packet.privacy.containsRawSession || packet.privacy.containsSecrets,
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
  const hash = hashText(JSON.stringify(candidateCore));
  return {
    ...candidateCore,
    id: `flowskill-${candidateCore.task.id.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 80)}-${hash.slice(0, 16)}`,
    hash,
    tokenEstimate: estimateTokens(`${candidateCore.task.goal} ${candidateCore.evidence.summary} ${candidateCore.evidence.reusablePattern.join(" ")}`),
    generatedAt: packet.generatedAt,
  };
}

function buildEvidenceWritebackPacket(workspace, args) {
  const evidence = readEvidenceJson(args.evidenceJson, workspace);
  const decision = WRITEBACK_DECISIONS.includes(args.decision || evidence.decision) ? (args.decision || evidence.decision) : "block";
  const sourceRefs = normalizeEvidenceSourceRefs(evidence, args);
  const containsRawSession = evidence.privacy?.containsRawSession === true || evidence.privacy?.contains_raw_session === true || hasUnsafeRef(sourceRefs, RAW_SESSION_RE);
  const containsSecrets = evidence.privacy?.containsSecrets === true || evidence.privacy?.contains_credentials === true || evidence.privacy?.containsSecrets === true || hasUnsafeRef(sourceRefs, SECRET_REF_RE);
  const reusablePattern = normalizeWritebackReusablePatterns(evidence);
  const failurePattern = safeArray(evidence.evidence?.failurePattern || evidence.evidence?.failure_pattern || evidence.failurePattern).map((item) => compact(item, 360)).filter(Boolean).slice(0, 12);
  const packet = {
    schemaVersion: 1,
    mode: "evidence_writeback_packet_dry_run",
    decision,
    task: {
      id: compact(args.taskId || evidence.task?.id || evidence.taskId || "unknown-task", 140),
      goal: compact(args.taskGoal || evidence.task?.goal || evidence.goal || args.query || "", 360),
      domain: safeArray(evidence.task?.domain || evidence.domain).map((item) => compact(item, 80)).filter(Boolean).slice(0, 12),
      projectPath: evidence.task?.projectPath || evidence.projectPath || workspace,
      threadId: evidence.task?.threadId || evidence.threadId || null,
      parentCeoThreadId: evidence.task?.parentCeoThreadId || evidence.parentCeoThreadId || null,
    },
    evidence: {
      summary: compact(args.summary || evidence.evidence?.summary || evidence.summary || "", 1000),
      changedFiles: safeArray(evidence.evidence?.changedFiles || evidence.changedFiles).map((item) => compact(item, 260)).filter(Boolean).slice(0, 40),
      artifacts: safeArray(evidence.evidence?.artifacts || evidence.artifacts).map((item) => compact(item, 260)).filter(Boolean).slice(0, 40),
      tests: safeArray(evidence.evidence?.tests || evidence.tests).map((item) => compact(item, 220)).filter(Boolean).slice(0, 40),
      reusablePattern,
      failurePattern,
      residualRisk: compact(evidence.evidence?.residualRisk || evidence.residualRisk || "", 700),
      sourceRefs,
    },
    writeback: {
      knowledgeCandidates: [],
      experienceCandidates: decision === "revise" || decision === "block" ? failurePattern.map((summary) => ({ status: "candidate", summary })) : [],
      lineageUpdates: [],
      projectUpdates: [],
      flowSkillCandidate: null,
    },
    privacy: {
      containsRawSession,
      containsSecrets,
      publicCandidateAllowed: evidence.privacy?.publicCandidateAllowed === true,
    },
    receiptPreview: {
      status: containsRawSession || containsSecrets ? "review_blocked" : "dry_run",
      hash: hashText(JSON.stringify({ decision, sourceRefs, reusablePattern, failurePattern })),
      writesAppDatabase: false,
      runsFlowSkill: false,
      installsOrExecutes: false,
      archiveCompactDeleteMoveRestore: false,
      mutatesRawSession: false,
    },
    warnings: [
      "dry_run_only_no_app_db_write",
      "no_flowskill_capture_promote_export_install",
      "no_raw_session_mutation",
      ...(sourceRefs.length === 0 ? ["missing_source_refs_candidate_only"] : []),
      ...(containsRawSession ? ["contains_raw_session_review_required"] : []),
      ...(containsSecrets ? ["contains_secrets_review_required"] : []),
    ],
    generatedAt: new Date().toISOString(),
  };
  packet.writeback.flowSkillCandidate = decision === "accept" && reusablePattern.length > 0 && sourceRefs.length > 0 && !containsRawSession && !containsSecrets
    ? buildFlowSkillCandidatePreview(packet, sourceRefs)
    : null;
  return packet;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function writeEvidenceOut(workspace, outPath, packet) {
  if (!outPath) return null;
  const resolved = resolveWorkspaceContainedPath(workspace, outPath, "--evidence-out");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  return resolved;
}

function printText(payload) {
  if (payload.files.length === 0) {
    console.error(`No Zhixia knowledge files found under ${payload.workspace}`);
    process.exit(1);
  }
  console.log("# Zhixia Retrieval Contract");
  console.log("");
  console.log(`Workspace: ${payload.workspace}`);
  console.log(`Mode: ${payload.mode}`);
  console.log(`Query Type: ${payload.queryType}`);
  if (payload.query) console.log(`Query: ${payload.query}`);
  console.log(`Token Budget: ${payload.tokenBudget}`);
  console.log(`Returned: ${payload.returnedCount}`);
  console.log(`Freshness: ${payload.freshness}`);
  console.log(`Files: ${payload.files.map((file) => `${file.kind}:${path.basename(file.path)}`).join(", ")}`);
  console.log("");
  for (const item of payload.items) {
    console.log(`## ${item.kind}: ${item.title}`);
    console.log(`Source: ${item.sourcePath}`);
    console.log(`Freshness: ${item.freshness} | Status: ${item.status} | Score: ${item.score.toFixed(2)} | Tokens: ${item.tokenEstimate}`);
    console.log(`Why: ${(item.whyMatched || []).slice(0, 3).join(" · ") || "baseline ranking"}`);
    if (item.requiresHumanConfirmation) console.log("Review: requires human confirmation");
    console.log("");
    console.log(item.excerpt || "No matching excerpt.");
    console.log("");
  }
}

function main() {
  const args = parseArgs(process.argv);
  const workspace = findWorkspace(args.workspace, args.allowParentKnowledge);
  if (args.continuityStatus || args.memoryReviewQueue || args.memoryDiagnostics) {
    const packet = args.continuityStatus
      ? buildMemoryCoreContinuityStatus(workspace, args)
      : args.memoryReviewQueue
        ? buildMemoryCoreReviewQueue(workspace, args)
        : buildMemoryCoreDiagnostics(workspace, args);
    if (args.json) {
      console.log(JSON.stringify(packet, null, 2));
    } else {
      console.log(`# ${packet.mode}`);
      console.log("");
      console.log(`Project: ${packet.project?.id || packet.project?.path || workspace}`);
      console.log(`Status: ${packet.sidecar?.status || "unknown"}`);
      if (Object.prototype.hasOwnProperty.call(packet, "recoveryReady")) console.log(`Recovery Ready: ${packet.recoveryReady}`);
      if (packet.items) console.log(`Returned: ${packet.items.length}`);
    }
    return;
  }
  if (args.evaluateCeoPressure) {
    const packet = evaluateCeoThreadPressure({ ...args, workspace });
    if (args.json) {
      console.log(JSON.stringify(packet, null, 2));
    } else {
      console.log("# Zhixia CEO Thread Pressure");
      console.log("");
      console.log(`Action: ${packet.action}`);
      console.log(`Pressure: ${packet.pressureLevel}`);
      console.log(`Session MB: ${packet.sessionMb}`);
    }
    return;
  }
  if (args.writebackDryRun) {
    const packet = buildEvidenceWritebackPacket(workspace, args);
    const outputPath = writeEvidenceOut(workspace, args.evidenceOut, packet);
    const payload = outputPath ? { ...packet, outputPath } : packet;
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log("# Zhixia Evidence Writeback Dry Run");
      console.log("");
      console.log(`Decision: ${payload.decision}`);
      console.log(`Status: ${payload.receiptPreview.status}`);
      console.log(`SourceRefs: ${payload.evidence.sourceRefs.length}`);
      if (outputPath) console.log(`Output: ${outputPath}`);
    }
    return;
  }
  const payload = collectResults(workspace, args);
  const lifecyclePayload = args.precedent
    ? buildRuntimePrecedentPacket(payload, args)
    : args.ceoTakeover
      ? buildCeoTakeoverBootstrapPacket(payload, args)
    : args.recoverThread
      ? buildThreadRecoveryPacket(payload, args)
      : args.runtimeContext
      ? buildRuntimeContextPacket(payload, args)
      : payload;
  if (args.json) {
    console.log(JSON.stringify(lifecyclePayload, null, 2));
  } else {
    printText(payload);
  }
}

main();
