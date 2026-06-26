const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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
};

const DEFAULT_QUERY_TYPE = "task_dispatch";
const DEFAULT_LIMIT = 6;
const DEFAULT_TOKEN_BUDGET = 1200;
const DEFAULT_RECOVERY_TOKEN_BUDGET = 1800;
const MAX_LIMIT = 40;
const MIN_TOKEN_BUDGET = 200;
const MAX_TOKEN_BUDGET = 4000;
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
];
const PRECEDENT_KINDS = ["knowledge", "experience", "artifacts", "tool_inventory", "skill_candidates"];
const RECOVERY_DOCS = [
  "docs/PROGRAM_GOAL_BRIEF.md",
  "docs/PRD.md",
  "docs/TECHNICAL_DESIGN.md",
  "docs/TEST_PLAN.md",
  "docs/RELEASE_NOTES.md",
  "docs/CEO_FLOW_MEMORY_RUNTIME.md",
  "docs/REFMUSE_GAME_STUDIO_CEO_RECOVERY_PACKET.md",
  "docs/REFMUSE_GAME_STUDIO_CEO_TRANSCRIPT_EXTRACT.md",
  "docs/REFMUSE_GAME_STUDIO_NEW_THREAD_START.md",
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
};
const WRITEBACK_DECISIONS = ["accept", "revise", "block", "supersede"];
const SECRET_REF_RE = /(?:^|[\\/])\.env(?:$|[\\/._-])|\b(api[_ -]?key|auth[_ -]?token|bearer[_ -]?token|credential|credentials|secret|secrets|private[_ -]?key|id_rsa|oauth|cookie|password)\b/i;
const RAW_SESSION_RE = /(?:^|[\\/])\.codex[\\/]sessions[\\/]|(?:raw|codex|thread)[_ -]?session|session[_ -]?jsonl/i;
const BASE64_RE = /\bdata:[^;,\s]+;base64,[A-Za-z0-9+/=]{80,}|\b[A-Za-z0-9+/]{180,}={0,2}\b/g;

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
    threadId: "",
    threadTitle: "",
    parentCeoThreadId: "",
    taskGoal: "",
    writebackDryRun: false,
    evidenceJson: "",
    evidenceOut: "",
    decision: "",
    taskId: "",
    summary: "",
    sourceRefs: [],
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
    } else if (!args.workspace) {
      args.workspace = item;
    }
  }
  if (args.queryType === "retrieve_context") args.runtimeContext = true;
  if (args.queryType === "retrieve_precedent") args.precedent = true;
  if (args.queryType === "recover_thread" || args.queryType === "thread_recovery") args.recoverThread = true;
  if (args.precedent && args.includeKinds.length === 0) args.includeKinds = PRECEDENT_KINDS;
  if (args.recoverThread && !args.query) args.query = [args.threadId, args.threadTitle, args.taskGoal].filter(Boolean).join(" ");
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
      const score = baselineScore + textScore;
      if (tokens.length > 0 && textScore === 0) continue;
      items.push({
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
        ]),
        requiresHumanConfirmation: entry.humanConfirmation || entry.freshness !== "fresh",
      });
    }
  }

  items.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.tokenEstimate - b.tokenEstimate));
  return { items, files, warnings };
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
  const { items, files, warnings: collectionWarnings } = collectItems(workspace, options);
  const trimmed = trimItemsToBudget(items, options.limit, options.tokenBudget);
  const warnings = [...collectionWarnings];
  if (files.length === 0 && !options.allowParentKnowledge) {
    warnings.push("No .codex-knowledge files were found in the requested workspace. Parent directory knowledge was not used; pass --allow-parent-knowledge to opt into legacy upward search.");
  }
  return {
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
}

function normalizeRuntimeStatus(status) {
  if (["active", "curated", "ready", "candidate", "review", "stale", "superseded", "blocked"].includes(status)) return status;
  if (status === "draft" || status === "compatibility") return "candidate";
  return "review";
}

function runtimeItemFromHelperItem(item) {
  return {
    id: item.id,
    kind: RUNTIME_KIND_BY_HELPER_KIND[item.kind] || "knowledge_item",
    title: item.title,
    summary: item.excerpt,
    status: normalizeRuntimeStatus(item.status),
    freshness: item.freshness || "unknown",
    whyMatched: item.whyMatched || [],
    sourceRefs: item.sourceRefs || [],
    tokenEstimate: item.tokenEstimate || estimateTokens(`${item.title} ${item.excerpt}`),
    requiresHumanConfirmation: item.requiresHumanConfirmation === true || item.freshness !== "fresh",
    rawSessionPolicy: "not_allowed",
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
    warnings: [
      "metadata_first_no_raw_session_body",
      "no_giant_markdown_or_base64_default_output",
      "no_archive_compact_delete_move_restore",
      ...retrieval.warnings,
    ],
    tokenEstimate: retrieval.tokenEstimate,
    generatedAt: retrieval.generatedAt,
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
      ...retrieval.warnings,
    ],
    tokenEstimate: estimateTokens(`${title} ${context.items.map((item) => item.summary).join(" ")}`),
  };
  packet.prompt = buildThreadRecoveryPrompt(packet);
  return packet;
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
