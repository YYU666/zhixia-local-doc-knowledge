const crypto = require("node:crypto");
const path = require("node:path");

const DEFAULT_MAX_BACKFILL_CARDS = 30;
const BACKFILL_BODY_CHARS = 900;
const BACKFILL_SUMMARY_CHARS = 280;
const BACKFILL_TITLE_CHARS = 160;
const GENERATED_KNOWLEDGE_FILES = new Set([
  "project-knowledge.md",
  "project-resume.md",
  "knowledge-items.md",
  "knowledge-items.json",
  "experience-cards.md",
  "experience-cards.json",
  "project-artifacts.md",
  "project-artifacts.json",
  "skill-candidates.md",
  "tool-skill-inventory.md",
  "tool-skill-inventory.json",
]);

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactText(value, maxChars) {
  const text = cleanText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function estimateTokenCount(value) {
  const text = cleanText(value);
  return Math.max(40, Math.ceil(text.length / 4));
}

function stableBackfillId(doc, memoryType) {
  return `experience-${hashText(["project_doc_backfill", doc.id || doc.filePath, doc.workspacePath || doc.projectPath, doc.filePath, memoryType].filter(Boolean).join("|")).slice(0, 16)}`;
}

function buildMemorySourceSignature(input = {}) {
  const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs : [];
  const payload = {
    projectPath: input.projectPath || null,
    sourceType: input.sourceType || null,
    sourcePath: input.sourcePath || null,
    sourceHash: input.sourceHash || null,
    sourceDocumentId: input.sourceDocumentId || null,
    sourceDocumentUpdatedAt: input.sourceDocumentUpdatedAt || null,
    sourceRefs: sourceRefs
      .map((ref) => ({
        kind: ref.kind || "document",
        path: ref.path || null,
        hash: ref.hash || null,
        updatedAt: ref.updatedAt || null,
        artifactType: ref.artifactType || null,
        sourceType: ref.sourceType || null,
      }))
      .sort((a, b) => `${a.kind}:${a.path}:${a.hash}`.localeCompare(`${b.kind}:${b.path}:${b.hash}`)),
  };
  return hashText(JSON.stringify(payload));
}

function buildMemoryDuplicateKey(input = {}) {
  const memoryType = input.memoryType || "memory";
  if (input.sourceDocumentId || input.sourcePath) {
    return `same-source:${input.projectPath || "global"}:${input.sourceType || "unknown"}:${memoryType}:${input.sourceDocumentId || input.sourcePath}`;
  }
  return `same-memory:${hashText([
    input.projectPath || "global",
    input.sourceType || "unknown",
    memoryType,
    compactText(input.title || "", 80).toLowerCase(),
    compactText(input.summary || input.body || "", 160).toLowerCase(),
  ].join("|")).slice(0, 24)}`;
}

function uniqCompact(items, limit = 12) {
  const seen = new Set();
  const result = [];
  for (const item of items.flat().filter(Boolean).map((value) => compactText(value, 80))) {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function looksLikeGeneratedKnowledgeFile(filePath) {
  return GENERATED_KNOWLEDGE_FILES.has(path.basename(filePath || "").toLowerCase());
}

function looksLikeRawSessionPath(filePath) {
  const normalized = String(filePath || "").toLowerCase().replace(/[\\/]+/g, "/");
  return normalized.includes("/.codex/sessions/") || normalized.includes("/.codex/archived_sessions/") || normalized.endsWith(".jsonl");
}

function classifyProjectMemoryType(doc) {
  const text = `${doc.title || ""}\n${doc.fileName || ""}\n${doc.summary || ""}\n${doc.contentText || ""}`.toLowerCase();
  if (/thread history vault|compact receipt|zhixiahistoryid|archive candidate|归档|瘦身|保险库/.test(text)) return "archive_note";
  if (/bug|fix|root cause|regression|修复|根因|回归|踩坑/.test(text)) return "bug_fix";
  if (/decision|decided|accept|revise|block|验收|决策|结论/.test(text)) return "decision";
  if (/handoff|resume packet|交接|续接|下一步/.test(text)) return "handoff";
  if (/release|changelog|installer|package|发布|打包|安装器/.test(text)) return "release";
  if (/test|smoke|build|qa|测试|验证|审核/.test(text)) return "workflow";
  return "project_status";
}

function buildProjectMemorySourceRefs(doc) {
  return [{
    kind: "document",
    title: compactText(doc.title || doc.fileName || "Project document", BACKFILL_TITLE_CHARS),
    path: doc.filePath || null,
    hash: doc.contentHash || null,
    updatedAt: doc.updatedAt || null,
    artifactType: doc.artifactType || "other",
    sourceType: doc.sourceType || "workspace_file",
  }];
}

function isBackfillableProjectDocument(doc, options = {}) {
  if (!doc || !doc.projectPath && !doc.workspacePath) return false;
  if (options.projectPath && doc.workspacePath !== options.projectPath && doc.projectPath !== options.projectPath) return false;
  if (doc.parseStatus === "failed") return false;
  if (looksLikeRawSessionPath(doc.filePath)) return false;
  if (looksLikeGeneratedKnowledgeFile(doc.filePath)) return false;

  const artifactType = doc.artifactType || "other";
  if (["prd", "technical_design", "test_plan", "release_notes", "report", "readme"].includes(artifactType)) return true;
  if (doc.sourceType === "codex_output" && ["markdown", "document", "other"].includes(artifactType)) return true;
  return false;
}

function buildProjectMemoryBackfillCard(doc) {
  const projectPath = doc.workspacePath || doc.projectPath || null;
  const memoryType = classifyProjectMemoryType(doc);
  const bodySource = doc.summary || doc.contentText || doc.title || "";
  const body = compactText(bodySource, BACKFILL_BODY_CHARS);
  const summary = compactText(doc.summary || body || doc.title || "", BACKFILL_SUMMARY_CHARS);
  const sourceRefs = buildProjectMemorySourceRefs(doc);
  const sourceDocumentId = doc.id || null;
  const sourceDocumentUpdatedAt = doc.updatedAt || null;
  const sourceHash = doc.contentHash || hashText(bodySource);
  const tags = uniqCompact([
    "project_memory_backfill",
    memoryType,
    doc.artifactType || "document",
    doc.sourceType || "workspace_file",
    ...(Array.isArray(doc.tags) ? doc.tags : []),
  ], 12);

  return {
    id: stableBackfillId(doc, memoryType),
    kind: "experience_card",
    contractVersion: "project_doc_backfill_v2",
    projectPath,
    scope: "project",
    sourceType: "project_doc",
    title: compactText(`${doc.title || doc.fileName || "Project document"} memory`, BACKFILL_TITLE_CHARS),
    summary,
    body,
    tags,
    sourcePath: doc.filePath || null,
    sourceHash,
    status: "candidate",
    freshness: "review",
    requiresHumanConfirmation: true,
    reviewReason: "automatic_project_doc_backfill",
    rawSessionPolicy: "explicit_only",
    sourceRefs,
    tokenEstimate: estimateTokenCount([summary, body].filter(Boolean).join("\n")),
    sourceDocumentId,
    sourceDocumentUpdatedAt,
    memoryType,
    sourceSignature: buildMemorySourceSignature({
      projectPath,
      sourceType: "project_doc",
      sourcePath: doc.filePath || null,
      sourceHash,
      sourceDocumentId,
      sourceDocumentUpdatedAt,
      sourceRefs,
    }),
    duplicateGroupKey: buildMemoryDuplicateKey({
      projectPath,
      sourceType: "project_doc",
      sourcePath: doc.filePath || null,
      sourceDocumentId,
      memoryType,
      title: doc.title || doc.fileName,
      summary,
      body,
    }),
  };
}

function buildProjectMemoryBackfillCards(docs, options = {}) {
  const maxCards = Math.max(1, Math.min(Number(options.maxCards || DEFAULT_MAX_BACKFILL_CARDS), 80));
  const cards = [];
  const seen = new Set();
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!isBackfillableProjectDocument(doc, options)) continue;
    const card = buildProjectMemoryBackfillCard(doc);
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
    if (cards.length >= maxCards) break;
  }
  return cards;
}

module.exports = {
  DEFAULT_MAX_BACKFILL_CARDS,
  buildMemoryDuplicateKey,
  buildMemorySourceSignature,
  buildProjectMemoryBackfillCard,
  buildProjectMemoryBackfillCards,
  classifyProjectMemoryType,
  isBackfillableProjectDocument,
};
