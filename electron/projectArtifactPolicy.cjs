const crypto = require("node:crypto");
const path = require("node:path");

const CURRENT_ARTIFACT_TYPES = new Set([
  "readme",
  "prd",
  "technical_design",
  "test_plan",
  "release_notes",
  "report",
  "context",
  "markdown",
  "document",
]);

const SINGLETON_ARTIFACT_TYPES = new Set([
  "readme",
  "prd",
  "technical_design",
  "test_plan",
  "release_notes",
  "context",
]);

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

function cleanArtifactText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactArtifactText(value, maxChars) {
  const text = cleanArtifactText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function hashArtifactText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableArtifactId(doc) {
  return `project-artifact-${hashArtifactText([
    "project_artifact",
    doc.id,
    doc.workspacePath || doc.projectPath,
    doc.filePath,
    doc.contentHash || doc.updatedAt,
  ].filter(Boolean).join("|")).slice(0, 16)}`;
}

function stableProjectId(projectPath) {
  return `project:${hashArtifactText(projectPath).slice(0, 16)}`;
}

function isSourceChanged(fileModifiedAt, updatedAt) {
  if (!fileModifiedAt || !updatedAt) return false;
  const modifiedTime = new Date(fileModifiedAt).getTime();
  const updatedTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(modifiedTime) || !Number.isFinite(updatedTime)) return false;
  return modifiedTime > updatedTime;
}

function looksLikeRawSessionPath(filePath) {
  const normalized = String(filePath || "").toLowerCase().replace(/[\\/]+/g, "/");
  return normalized.includes("/.codex/sessions/") || normalized.includes("/.codex/archived_sessions/") || normalized.endsWith(".jsonl");
}

function looksLikeGeneratedKnowledgeFile(filePath) {
  return GENERATED_KNOWLEDGE_FILES.has(path.basename(filePath || "").toLowerCase());
}

function extractProducerThreadId(doc) {
  const text = `${doc.title || ""} ${doc.fileName || ""} ${doc.summary || ""} ${doc.filePath || ""}`;
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0].toLowerCase() : null;
}

function inferProducedBy(doc) {
  const text = `${doc.title || ""} ${doc.fileName || ""} ${doc.summary || ""} ${doc.filePath || ""}`.toLowerCase();
  if (/review|qa|audit|审核|审计|验收/.test(text)) return "review_thread";
  if (/\bceo\b|orchestrator|维护线程|task card|acceptance|决策/.test(text)) return "ceo_thread";
  if (/worker|implementation|implement|修复|实现|专家|员工/.test(text)) return "worker_thread";
  if (["codex_context", "codex_output"].includes(doc.sourceType || "")) return "codex";
  if (doc.sourceType === "imported") return "user";
  return "import";
}

function inferBaseArtifactStatus(doc) {
  if (doc.parseStatus === "failed" || doc.parseStatus === "partial") return "needs_review";
  if (doc.duplicateOf || isSourceChanged(doc.fileModifiedAt, doc.updatedAt)) return "needs_review";
  if ((doc.artifactType || "other") === "other") return "needs_review";
  if (looksLikeGeneratedKnowledgeFile(doc.filePath)) return "needs_review";
  if (!CURRENT_ARTIFACT_TYPES.has(doc.artifactType || "other")) return "needs_review";
  return "current";
}

function inferArtifactFreshness(status) {
  if (status === "current") return "fresh";
  if (status === "archived" || status === "superseded") return "stale";
  return "review";
}

function normalizeProjectArtifactDocument(doc, options = {}) {
  if (!doc) return null;
  const projectPath = doc.workspacePath || doc.projectPath || null;
  if (!projectPath) return null;
  if (options.projectPath && projectPath !== options.projectPath) return null;
  if (!doc.filePath || looksLikeRawSessionPath(doc.filePath)) return null;

  const status = inferBaseArtifactStatus(doc);
  const title = compactArtifactText(doc.title || doc.fileName || path.basename(doc.filePath), 160) || "Project artifact";
  const summary = compactArtifactText(doc.summary || doc.title || doc.filePath, 320);
  const updatedAt = doc.updatedAt || doc.fileModifiedAt || doc.importedAt || "";
  const artifactType = doc.artifactType || "other";

  return {
    id: stableArtifactId(doc),
    kind: "project_artifact",
    projectId: stableProjectId(projectPath),
    documentId: doc.id || null,
    projectPath,
    path: doc.filePath,
    artifactType,
    title,
    status,
    producedBy: inferProducedBy(doc),
    producerThreadId: extractProducerThreadId(doc),
    version: doc.indexVersion ? String(doc.indexVersion) : null,
    createdAt: doc.importedAt || updatedAt,
    updatedAt,
    summary,
    sourceRefs: [
      {
        kind: "project_artifact",
        path: doc.filePath,
        title,
        hash: doc.contentHash || null,
        updatedAt,
      },
    ],
    freshness: inferArtifactFreshness(status),
    requiresHumanConfirmation: status !== "current",
    reasons: [
      `artifactType:${artifactType}`,
      `sourceType:${doc.sourceType || "unknown"}`,
      `parseStatus:${doc.parseStatus || "unknown"}`,
      looksLikeGeneratedKnowledgeFile(doc.filePath) ? "generatedKnowledge:review" : "",
      doc.duplicateOf ? "duplicate:review" : "",
      isSourceChanged(doc.fileModifiedAt, doc.updatedAt) ? "sourceChanged:review" : "",
    ].filter(Boolean),
  };
}

function artifactSortTime(artifact) {
  const time = new Date(artifact.updatedAt || artifact.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildProjectArtifacts(docs, options = {}) {
  const maxArtifacts = Math.max(1, Math.min(Number(options.maxArtifacts || 80), 300));
  const artifacts = [];
  const seen = new Set();

  for (const doc of Array.isArray(docs) ? docs : []) {
    const artifact = normalizeProjectArtifactDocument(doc, options);
    if (!artifact || seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    artifacts.push(artifact);
  }

  const currentByType = new Map();
  for (const artifact of artifacts) {
    if (artifact.status !== "current") continue;
    if (!SINGLETON_ARTIFACT_TYPES.has(artifact.artifactType)) continue;
    const key = `${artifact.projectPath}|${artifact.artifactType}`;
    const previous = currentByType.get(key);
    if (!previous || artifactSortTime(artifact) > artifactSortTime(previous)) {
      currentByType.set(key, artifact);
    }
  }

  const normalized = artifacts.map((artifact) => {
    if (artifact.status !== "current") return artifact;
    const latest = currentByType.get(`${artifact.projectPath}|${artifact.artifactType}`);
    if (!latest || latest.id === artifact.id) return artifact;
    return {
      ...artifact,
      status: "superseded",
      freshness: "stale",
      requiresHumanConfirmation: true,
      reasons: [...artifact.reasons, "newerSameType:superseded"],
    };
  });

  return normalized
    .sort((a, b) => {
      if (a.projectPath !== b.projectPath) return a.projectPath.localeCompare(b.projectPath);
      if (a.artifactType !== b.artifactType) return a.artifactType.localeCompare(b.artifactType);
      return artifactSortTime(b) - artifactSortTime(a);
    })
    .slice(0, maxArtifacts);
}

module.exports = {
  buildProjectArtifacts,
  inferProducedBy,
  normalizeProjectArtifactDocument,
};
