const path = require("node:path");

const MAX_SOURCE_REFS = 6;
const MAX_ARTIFACT_POINTERS = 4;
const MAX_RECENT_DECISIONS = 3;
const MAX_THREAD_POINTERS = 4;
const MAX_SUMMARY_CHARS = 280;
const MAX_MARKDOWN_LINE_CHARS = 220;

function compactLine(value, fallback = "") {
  return String(value || fallback || "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value, maxChars = MAX_MARKDOWN_LINE_CHARS, fallback = "") {
  const text = compactLine(value, fallback);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function listOrNone(values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  return items.length > 0 ? items.join(", ") : "none";
}

function looksLikeRawSessionPath(filePath) {
  const normalized = String(filePath || "").toLowerCase().replace(/[\\/]+/g, "/");
  return normalized.includes("/.codex/sessions/") || normalized.includes("/.codex/archived_sessions/") || normalized.endsWith(".jsonl");
}

function normalizePathValue(value) {
  const text = compactLine(value);
  return text || null;
}

function formatPathForMarkdown(value) {
  return compactText(value, 240);
}

function isRawSessionRef(ref) {
  return compactLine(ref?.kind).toLowerCase() === "raw_session" || looksLikeRawSessionPath(ref?.path);
}

function packetAuthorityLabel(record = {}) {
  return record.humanConfirmedAt ? "confirmed" : compactLine(record.packetAuthority || "heuristic");
}

function normalizeSourceRefs(record = {}) {
  return safeArray(record.sourceRefs)
    .filter((ref) => ref && !isRawSessionRef(ref))
    .slice(0, MAX_SOURCE_REFS)
    .map((ref) => {
      const normalized = {
        kind: compactLine(ref.kind, "source"),
        title: compactText(ref.title || path.basename(String(ref.path || "")) || "untitled", 160),
        path: normalizePathValue(ref.path),
      };
      if (compactLine(ref.hash)) normalized.hash = compactLine(ref.hash);
      if (compactLine(ref.updatedAt)) normalized.updatedAt = compactLine(ref.updatedAt);
      if (compactLine(ref.status)) normalized.status = compactLine(ref.status);
      if (compactLine(ref.artifactType)) normalized.artifactType = compactLine(ref.artifactType);
      if (ref.readByDefault === false) normalized.readByDefault = false;
      return normalized;
    });
}

function normalizeRecentDecisions(record = {}) {
  const explicit = safeArray(record.recentDecisions)
    .map((item) => {
      if (typeof item === "string") {
        return {
          text: compactText(item, 180),
          status: "heuristic",
        };
      }
      const text = compactText(item?.summary || item?.decision || item?.title || item?.text, 180);
      if (!text) return null;
      return {
        text,
        status: compactLine(item.status || item.freshness || item.implementationStatus || "heuristic"),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_RECENT_DECISIONS);

  if (explicit.length > 0) return explicit;
  return [{
    text: compactText(record.lastSummary, 180, "No recent decisions captured yet."),
    status: record.humanConfirmedAt ? "confirmed" : "heuristic",
  }];
}

function normalizeArtifactPointers(record = {}, sourceRefs = []) {
  const explicit = safeArray(record.artifactPointers || record.projectArtifacts)
    .map((item) => {
      const itemPath = normalizePathValue(item?.path);
      if (!itemPath || looksLikeRawSessionPath(itemPath)) return null;
      return {
        title: compactText(item.title || path.basename(itemPath) || "Untitled artifact", 160),
        path: itemPath,
        artifactType: compactLine(item.artifactType || item.kind || "artifact"),
        status: compactLine(item.status || item.freshness || item.implementationStatus || "review"),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_ARTIFACT_POINTERS);

  if (explicit.length > 0) return explicit;
  return sourceRefs.slice(0, MAX_ARTIFACT_POINTERS).map((ref) => ({
    title: compactText(ref.title || path.basename(ref.path || "") || "Untitled artifact", 160),
    path: ref.path,
    artifactType: compactLine(ref.artifactType || ref.kind || "source_pointer"),
    status: compactLine(ref.status || "review"),
  }));
}

function normalizeThreadPointers(record = {}) {
  return {
    ceo: compactLine(record.ownerThreadId, "unknown"),
    workers: safeArray(record.workerThreadIds).filter(Boolean).slice(0, MAX_THREAD_POINTERS),
    reviewers: safeArray(record.reviewerThreadIds).filter(Boolean).slice(0, MAX_THREAD_POINTERS),
  };
}

function buildRetrievalOrder() {
  return [
    {
      step: "resume_packet_metadata",
      label: "Resume packet metadata",
      policy: "default",
      detail: "Project identity, hot/current goal, recent decisions.",
    },
    {
      step: "artifact_pointers",
      label: "Artifact pointers",
      policy: "default",
      detail: "Open canonical docs by metadata pointer before broad scans.",
    },
    {
      step: "ceo_flow_and_thread_lineage",
      label: "CEO flow / thread lineage",
      policy: "ids_only",
      detail: "Use CEO, worker, and reviewer thread ids as routing pointers.",
    },
    {
      step: "knowledge_and_memory",
      label: "Knowledge / memory cards",
      policy: "compact_only",
      detail: "Prefer compact knowledge and memory before full source content.",
    },
    {
      step: "raw_session_and_cold_history",
      label: "Raw session / cold history",
      policy: "explicit_only",
      detail: "Only for explicit recovery or audit; do not read by default.",
    },
  ];
}

function buildCurrentGoal(record = {}) {
  const text = compactText(
    record.currentGoal || record.hotGoal || record.nextAction,
    180,
    "Confirm current project status and next action.",
  );
  return {
    text,
    status: compactLine(record.currentGoalStatus || record.nextActionStatus || (record.humanConfirmedAt ? "current" : "heuristic")),
  };
}

function buildProjectResumePacket(record = {}) {
  const project = compactLine(record.name, "Unknown project");
  const status = compactLine(record.status, "unknown");
  const completion = compactLine(record.completion, "unknown");
  const lastActivity = compactLine(record.lastActivityAt, "unknown");
  const authority = packetAuthorityLabel(record);
  const projectIdentity = {
    project,
    rootPath: compactLine(record.rootPath, "unknown"),
    status,
    completion,
    completionPercent: typeof record.completionPercent === "number" ? record.completionPercent : null,
    lastActivityAt: lastActivity,
  };
  const threadPointers = normalizeThreadPointers(record);
  const currentGoal = buildCurrentGoal(record);
  const recentDecisions = normalizeRecentDecisions(record);
  const sourceRefs = normalizeSourceRefs(record);
  const artifactPointers = normalizeArtifactPointers(record, sourceRefs);
  const retrievalOrder = buildRetrievalOrder();
  const blockers = Array.isArray(record.blockers) && record.blockers.length > 0 ? record.blockers : ["none recorded"];
  const lastSummary = compactText(record.lastSummary, 180, "No summary yet.");
  const nextAction = compactText(record.nextAction, 180, "Confirm current project status and next action.");
  const lines = [
    "# Project Resume Packet",
    "",
    `Packet authority: ${authority} metadata-only review material.`,
    "Raw session policy: Do not read raw Codex sessions by default. Use only for explicit recovery or audit.",
    `Project: ${projectIdentity.project}`,
    `Project root: ${projectIdentity.rootPath}`,
    `Status: ${projectIdentity.status} [${record.humanConfirmedAt ? "confirmed" : "heuristic"}]`,
    `Completion: ${projectIdentity.completion}${projectIdentity.completionPercent !== null ? ` (${projectIdentity.completionPercent}%)` : ""} [${authority}]`,
    `Last activity: ${projectIdentity.lastActivityAt}`,
    `Last known CEO thread: ${threadPointers.ceo}`,
    `Key worker threads: ${listOrNone(threadPointers.workers)}`,
    `Key reviewer threads: ${listOrNone(threadPointers.reviewers)}`,
    `Hot/current goal: ${currentGoal.text} [${currentGoal.status}]`,
    "Recent decisions:",
    ...recentDecisions.map((item) => `- ${item.text} [${item.status}]`),
    "Artifact pointers:",
    ...(artifactPointers.length > 0
      ? artifactPointers.map((item) => `- ${item.title} [${item.artifactType}; ${item.status}]${item.path ? ` (${formatPathForMarkdown(item.path)})` : ""}`)
      : ["- none [planned]"]),
    "Retrieval order:",
    ...retrievalOrder.map((item, index) => `${index + 1}. ${item.label} [${item.policy}] - ${item.detail}`),
    `Current source of truth: ${formatPathForMarkdown(artifactPointers[0]?.path || sourceRefs[0]?.path || projectIdentity.rootPath || "unknown")}`,
    `Important decisions summary: ${lastSummary}`,
    `Open blockers: ${blockers.map((item) => compactLine(item)).join("; ")}`,
    `Next recommended action: ${nextAction}`,
    "Do not repeat: Treat planned or heuristic fields as non-authoritative until the user or canonical docs confirm them.",
    `Useful memory cards: ${listOrNone(record.memoryCardIds)}`,
    "Source refs:",
    ...sourceRefs.map((ref) => `- ${ref.kind || "source"}: ${ref.title || ref.path || "untitled"}${ref.path ? ` (${formatPathForMarkdown(ref.path)})` : ""}`),
  ];
  const summary = compactText(
    `${status} / ${completion}. Goal: ${currentGoal.text} Decisions: ${recentDecisions[0]?.text || lastSummary} Next: ${nextAction}`,
    MAX_SUMMARY_CHARS,
  );

  return {
    id: `${record.id || record.rootPath || project}:resume`,
    kind: "project_resume_packet",
    contractVersion: "resume_packet_v2",
    project,
    projectIdentity,
    status,
    completion,
    packetAuthority: authority,
    currentGoal,
    recentDecisions,
    artifactPointers,
    retrievalOrder,
    rawSessionPolicy: "explicit_only",
    freshness: status === "paused" || status === "waiting_review" ? "review" : "fresh",
    requiresHumanConfirmation: status !== "active" && status !== "completed",
    summary,
    markdown: lines.join("\n"),
    sourceRefs,
  };
}

module.exports = {
  buildProjectResumePacket,
};
