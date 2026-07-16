import {
  AlertTriangle,
  Archive,
  Bot,
  Brain,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Download,
  FileText,
  FolderOpen,
  Import,
  RefreshCw,
  Search,
  Settings,
  Star,
  Tag,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AgentRuntimeAction,
  AgentRuntimeAttributionInference,
  AgentRuntimeAttributionUncertainty,
  AgentRuntimeConfidence,
  AgentRuntimeMonitorSnapshot,
  AgentRuntimeObservedSessionFacts,
  AgentRuntimeProcessSample,
  AgentRuntimeSession,
  AgentRetrieveFreshness,
  AgentRetrieveItem,
  AgentRetrieveLogEntry,
  AgentRetrieveResult,
  AppSettings,
  CodexGuardianCleanReceipt,
  CodexGuardianCommandResult,
  CodexGuardianCompactReceipt,
  CodexGuardianHistoryEnvelope,
  CodexGuardianHistoryItem,
  CodexGuardianHistorySourceRef,
  CodexGuardianReport,
  CodexThreadArchiveQueue,
  ExperienceCard,
  ExperienceCardCurationDecision,
  ExperienceCardGovernanceOptions,
  ExperienceCardStatus,
  KnowledgeDocument,
  KnowledgeItem,
  KnowledgeOverview,
  MemoryCoreContinuityPage,
  MemoryCoreContinuityStatus,
  MemoryCoreDiagnostics,
  MemoryCoreReviewQueue,
  MemoryOverview,
  MemoryFact,
  MemoryRuntimeTriggerReceipt,
  ParseStatus,
  SkillCandidate,
  SkillCandidateStatus,
  SkillRunReceipt,
  SkillStatus,
  ToolSkillInventoryResult,
  ToolSkillRecord,
  ThreadRecoveryPacket,
  RuntimeContextPacket,
  WatchStatus,
  ZhixiaSkillDefinition,
} from "./vite-env";

type ViewKey = "project" | "vault" | "documents" | "knowledge" | "memory" | "tools" | "agent" | "settings";
type ProjectTabKey = "overview" | "documents" | "knowledge" | "memory" | "handoff";
type DocFilterKey = "project" | "all" | "favorite" | "failed" | "recent" | "codex";
type VaultSectionKey = "inbox" | "notes" | "maps" | "sources" | "docs" | "other";
type Tone = "teal" | "amber" | "red" | "slate";
type ProjectRecordStatus = NonNullable<AppSettings["projectRecordOverrides"]>[string]["status"];
type ProjectRecordCompletion = NonNullable<AppSettings["projectRecordOverrides"]>[string]["completion"];
type ProjectArtifactMapStatus = "missing" | "unconfirmed" | "confirmed" | "re_review_required";
type ToolSkillInventoryMapStatus = "missing" | "unconfirmed" | "confirmed" | "re_review_required";
type ToolSkillGovernanceAction = "confirmed" | "rejected" | "deprecated" | "blocked" | "clear";
type ProjectClassificationKind = "project" | "lead" | "non_project";
type ProjectClassification = {
  kind: ProjectClassificationKind;
  confidence: number;
  label: string;
  reasons: string[];
};
type MemoryWritebackQueueItem = {
  id: string;
  kind: "experience_card" | "skill_candidate";
  title: string;
  summary: string;
  projectPath: string | null;
  sourcePath: string | null;
  sourceType?: ExperienceCard["sourceType"] | "skill_candidate";
  status: string;
  suggestedAction: string;
  risk: string;
  updatedAt: string;
};
type ScanActivity = {
  active: boolean;
  title: string;
  detail: string;
  startedAt: string | null;
  scanned?: number;
  imported?: number;
  projects?: number;
  errors?: number;
};

type ProjectMemoryCoreSnapshot = {
  diagnostics: MemoryCoreDiagnostics | null;
  continuityStatus: MemoryCoreContinuityStatus | null;
  continuityPage: MemoryCoreContinuityPage | null;
  reviewQueue: MemoryCoreReviewQueue | null;
  errors: string[];
};

const projectContinuitySlots = [
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
] as const;

const projectContinuitySlotLabels: Record<(typeof projectContinuitySlots)[number], string> = {
  project_identity: "项目身份",
  original_product_goal: "最初目标",
  architecture_anchors: "架构锚点",
  standing_rules: "长期规则",
  active_modules: "活跃模块",
  current_phase: "当前阶段",
  accepted_progress: "已验收进展",
  open_tasks: "未完成任务",
  open_blockers: "当前阻塞",
  latest_failures: "最近失败",
  next_actions: "下一步",
  thread_lineage: "线程接续",
  canonical_docs: "权威资料",
  last_valid_checkpoint: "最近有效检查点",
};

function projectContinuitySlotLabel(slot: string) {
  return projectContinuitySlotLabels[slot as keyof typeof projectContinuitySlotLabels] || "项目记忆";
}

function projectContinuityStatusLabel(status: string) {
  if (status === "filled") return "已建立";
  if (status === "conflict") return "有冲突";
  if (status === "stale") return "需更新";
  return "待补全";
}

function projectContinuityStatusTone(status: string): Tone {
  if (status === "filled") return "teal";
  if (status === "conflict") return "red";
  if (status === "stale") return "amber";
  return "slate";
}

function memoryCoreReasonLabel(reason: string) {
  const normalized = String(reason || "").toLowerCase();
  if (normalized.includes("exact_project") || normalized.includes("project")) return "与当前项目直接相关";
  if (normalized.includes("title")) return "标题与当前目标相符";
  if (normalized.includes("summary")) return "摘要与当前目标相符";
  if (normalized.includes("source")) return "来自当前项目来源";
  if (normalized.includes("fresh")) return "内容仍然新鲜";
  if (normalized.includes("status")) return "当前状态可供参考";
  if (normalized.includes("layer")) return "位于优先记忆层";
  if (normalized.includes("authority")) return "符合当前项目的来源范围";
  return "与当前项目记忆查询相符";
}

function memoryCoreKindLabel(kind: string | null | undefined) {
  if (kind === "project_brain") return "项目身份";
  if (kind === "project_anchor") return "项目锚点";
  if (kind === "module_memory") return "模块记忆";
  if (kind === "memory_episode") return "项目事件";
  if (kind === "project_checkpoint") return "项目检查点";
  if (kind === "memory_fact") return "长期事实";
  if (kind === "knowledge_item") return "知识条目";
  if (kind === "experience_card") return "经验记忆";
  return "项目来源";
}

type HistoryOptimizeProgress = {
  active: boolean;
  mode: "入库" | "安全减负";
  label: string;
  detail: string;
  current: number;
  total: number;
  indexed: number;
  compacted: number;
  queued: number;
  failed: number;
  remaining?: number;
  backlogTotal?: number;
  unvaulted?: number;
  vaulted?: number;
};

type RuntimeMonitorRefreshReason = "manual" | "visible_auto";

type ScoredDocument = KnowledgeDocument & {
  score: number;
  snippet: string;
};

type VaultDocumentCard = ScoredDocument & {
  vaultPath: string;
  vaultSection: VaultSectionKey;
  displayTitle: string;
  displaySummary: string;
};

const documentFilterLabels: Record<DocFilterKey, string> = {
  project: "当前项目",
  all: "全部历史",
  favorite: "星标",
  failed: "解析失败",
  recent: "最近导入",
  codex: "Codex 产物",
};

const knowledgeCategoryLabels: Record<string, string> = {
  architecture: "架构",
  product: "产品",
  testing: "测试",
  operations: "运维",
  process: "流程",
  data: "数据",
  docs: "文档",
  general: "通用",
};

const sourceTypeLabels: Record<string, string> = {
  imported: "用户导入",
  workspace_file: "工作区文件",
  codex_context: "Codex 上下文",
  codex_output: "Codex 输出",
  personal_knowledge: "个人知识库",
};

const vaultSectionLabels: Record<VaultSectionKey, string> = {
  inbox: "链接收件箱",
  notes: "笔记",
  maps: "图谱",
  sources: "来源证据",
  docs: "设计文档",
  other: "其他",
};

const vaultSections: Array<{ key: VaultSectionKey; label: string; detail: string }> = [
  { key: "inbox", label: "链接收件箱", detail: "转发链接、视频和文章整理" },
  { key: "notes", label: "总结笔记", detail: "可反复查看的摘要和观点" },
  { key: "sources", label: "来源证据", detail: "转写、元数据与原始材料" },
  { key: "docs", label: "完整文案", detail: "原文、脚本和长内容" },
  { key: "other", label: "其他", detail: "未归类文件" },
];

const artifactTypeLabels: Record<string, string> = {
  prd: "PRD",
  technical_design: "技术设计",
  test_plan: "测试计划",
  release_notes: "发布记录",
  report: "报告",
  readme: "README",
  context: "上下文包",
  markdown: "Markdown",
  document: "文档",
  other: "其他",
};

const RUNTIME_MONITOR_REFRESH_COOLDOWN_MS = 10_000;
const RUNTIME_MONITOR_VISIBLE_AUTO_REFRESH_MS = 0;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatGuardianBytes(value: string | number | null | undefined) {
  const bytes = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(bytes) ? formatBytes(bytes) : "未知";
}

function guardianSeverityLabel(report: CodexGuardianReport | null) {
  if (!report) return "未体检";
  if (report.severity === "red") return "压力高";
  if (report.severity === "yellow") return "需关注";
  return "正常";
}

function guardianSeverityTone(report: CodexGuardianReport | null): Tone {
  if (!report) return "slate";
  if (report.severity === "red") return "red";
  if (report.severity === "yellow") return "amber";
  return "teal";
}

function isCodexGuardianCleanReceipt(value: unknown): value is CodexGuardianCleanReceipt {
  return Boolean(value && typeof value === "object" && (value as CodexGuardianCleanReceipt).kind === "clean-logs");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "等待扫描";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function clipText(text: string, max = 140) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean || "暂无摘要。";
  return `${clean.slice(0, max)}...`;
}

function cleanDisplayText(value: string | null | undefined, fallback = "暂无摘要。") {
  const raw = String(value || "");
  const withoutBrokenGlyphs = raw
    .replace(/\uFFFD{1,}/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ");
  const clean = withoutBrokenGlyphs.replace(/\s+/g, " ").trim();
  return clean || fallback;
}

function isLikelyMojibake(value: string | null | undefined) {
  const text = String(value || "");
  if (!text.trim()) return false;
  if (/[\uFFFDÃÂÅåÇçÐðÑñØøÞþÆæŒœƒ‰¤¥¢¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ŴƑƉ]/.test(text)) return true;
  const extended = (text.match(/[\u00C0-\u024F]/g) || []).length;
  const cjk = (text.match(/[\u3400-\u9FFF]/g) || []).length;
  return extended >= 3 && cjk === 0;
}

function historyFallbackTitle(item: CodexGuardianHistoryItem) {
  const size = typeof item.sessionBytes === "number" ? `${formatBytes(item.sessionBytes)} ` : "";
  return `长线程 ${size}· ${item.threadId.slice(0, 8)}`;
}

function historyDisplayTitle(item: CodexGuardianHistoryItem, max = 90) {
  const fallback = historyFallbackTitle(item);
  return clipText(isLikelyMojibake(item.title) ? fallback : cleanDisplayText(item.title, fallback), max);
}

function historyDisplaySummary(item: CodexGuardianHistoryItem, max = 160) {
  const fallback = "该线程摘要疑似编码损坏；仍可通过 threadId、项目路径和来源摘要生成优化记录。";
  return clipText(isLikelyMojibake(item.summary) ? fallback : cleanDisplayText(item.summary, "Guardian 暂无摘要。"), max);
}

function hasBrokenGlyphs(value: string | null | undefined) {
  return /\uFFFD/.test(String(value || "")) || isLikelyMojibake(value);
}

function historySourceRefDisplayText(ref: CodexGuardianHistorySourceRef) {
  const raw = ref.path || "";
  if (!raw) return "无路径";
  if (hasBrokenGlyphs(raw)) return "来源路径含损坏字符，已隐藏；可通过 threadId 和 Guardian inventory 追溯。";
  return cleanDisplayText(raw, "无路径");
}

function historySourceRefPacketLine(ref: CodexGuardianHistorySourceRef) {
  return `${ref.kind}: ${historySourceRefDisplayText(ref)}`;
}

function hasBrokenHistorySourceRefs(item: CodexGuardianHistoryItem) {
  return item.sourceRefs.some((ref) => hasBrokenGlyphs(ref.path));
}

const archiveReasonLabels: Record<string, string> = {
  idle_past_threshold: "长期未写入",
  low_usage_frequency: "低频使用",
  project_not_hot: "项目已暂停/完成",
  large_session: "session 较大",
  not_running: "当前未运行",
  already_warm: "已降温",
  already_cold: "已冷却",
  ceo_main_thread_longer_retention: "CEO 主线程保留更久",
  ceo_created_thread_three_day_rule: "CEO 创建线程 3 天未复用",
  unknown_thread_archive_after_vault: "归属不明，先入库后归档",
};

const archiveBlockerLabels: Record<string, string> = {
  missing_thread_id: "缺少 threadId",
  thread_active_or_running: "线程仍 active/running",
  unfinished_work: "仍有未完成任务",
  pinned_or_keep_hot: "已置顶或保热",
  recently_written: "最近仍在写入",
  missing_thread_history_vault: "缺少 Thread History Vault",
  missing_vault_evidence: "缺少 vault 证据",
  vault_hash_mismatch: "Vault hash 不一致",
  missing_memory_pointer: "缺少 memory pointer",
  missing_memory_pointer_or_source_refs: "缺少 memory pointer 或 source refs",
  missing_compact_receipt_evidence: "缺少 compact receipt path/hash",
  compact_receipt_incompatible: "thread store 与 compact receipt 不兼容",
  missing_project_resume_packet: "缺少 Resume Packet",
  role_cooling_period_not_reached: "未达到该线程类型的冷却时间",
  host_archive_completed: "宿主已归档",
  host_archive_protected: "宿主保护跳过",
  host_thread_not_found: "宿主侧栏未找到",
  host_archive_persist_failed: "宿主归档未持久化",
  host_archive_error: "宿主归档异常",
};

function archiveLabel(value: string, labels: Record<string, string>) {
  return labels[value] || value;
}

function buildOldThreadOptimizationText(item: CodexGuardianHistoryItem) {
  const cleanTitle = isLikelyMojibake(item.title) ? historyFallbackTitle(item) : cleanDisplayText(item.title, "未命名线程");
  const cleanSummary = isLikelyMojibake(item.summary)
    ? "该线程摘要疑似编码损坏；仍可通过 threadId、项目路径和来源摘要生成优化记录。"
    : cleanDisplayText(item.summary, "Guardian 暂无摘要。");
  const cleanWhyMatched = isLikelyMojibake(item.whyMatched) ? "Guardian 历史命中。" : cleanDisplayText(item.whyMatched, "Guardian 历史命中。");
  const defaultRefs = item.sourceRefs.filter((ref) => ref.readByDefault !== false);
  const sourceLines = defaultRefs.length > 0 ? defaultRefs.map(historySourceRefPacketLine).join("\n") : "无默认读取来源。";
  return `Zhixia optimized old-thread record
Purpose: Keep this Codex old thread searchable and reusable through Zhixia without relying on the full raw session.
Important: Zhixia indexing does not modify Codex sessions. In-place slimming is a separate explicit action that backs up and hash-checks the selected session first.

ThreadId: ${item.threadId}
Title: ${cleanTitle}
Freshness: ${item.freshness}
Summary: ${cleanSummary}
Why matched: ${cleanWhyMatched}
Project: ${item.provenance?.projectRoot || "unknown"}
Session size: ${typeof item.sessionBytes === "number" ? formatBytes(item.sessionBytes) : "unknown"}
Source refs:
${sourceLines}
Raw session policy: do not read by default.
Restore dry-run: ${item.restoreCommand}`;
}

function clipDisplayText(value: string | null | undefined, max = 140, fallback = "暂无摘要。") {
  return clipText(cleanDisplayText(value, fallback), max);
}

function queryTokens(query: string) {
  return normalize(query).split(" ").filter(Boolean).slice(0, 5);
}

function makeSnippet(doc: KnowledgeDocument, query: string) {
  const source = doc.contentText || doc.summary || doc.parseError || "";
  const clean = source.replace(/\s+/g, " ").trim();
  if (!clean) return "没有可预览内容。";
  const q = normalize(query);
  if (!q) return clean.slice(0, 220) + (clean.length > 220 ? "..." : "");
  const firstToken = q.split(" ")[0];
  const index = normalize(clean).indexOf(firstToken);
  if (index < 0) return clean.slice(0, 220) + (clean.length > 220 ? "..." : "");
  const start = Math.max(0, index - 70);
  const end = Math.min(clean.length, index + 170);
  return `${start > 0 ? "..." : ""}${clean.slice(start, end)}${end < clean.length ? "..." : ""}`;
}

function renderHighlightedSnippet(snippet: string, query: string) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return snippet;

  const lowerSnippet = snippet.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const token of tokens) {
    let index = lowerSnippet.indexOf(token);
    while (index >= 0) {
      ranges.push([index, index + token.length]);
      index = lowerSnippet.indexOf(token, index + token.length);
    }
  }

  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (!previous || range[0] > previous[1]) {
      merged.push(range);
    } else {
      previous[1] = Math.max(previous[1], range[1]);
    }
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push(snippet.slice(cursor, start));
    parts.push(<mark key={`${start}-${end}`}>{snippet.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < snippet.length) parts.push(snippet.slice(cursor));
  return parts;
}

function scoreDocument(doc: KnowledgeDocument, query: string) {
  const q = normalize(query);
  if (!q) return 0;
  const tokens = queryTokens(query);
  const title = normalize(doc.title);
  const fileName = normalize(doc.fileName);
  const tags = normalize(doc.tags.join(" "));
  const summary = normalize(doc.summary);
  const content = normalize(doc.contentText);
  const haystack = [title, fileName, doc.extension, summary, tags, content, doc.parseError || ""].join(" ");
  let score = 0;
  if (title === q || fileName === q) score += 30;
  if (title.includes(q)) score += 18;
  if (summary.includes(q)) score += 8;
  if (content.includes(q)) score += 5;
  for (const token of tokens) {
    if (title.includes(token)) score += 12;
    if (tags.includes(token)) score += 9;
    if (fileName.includes(token)) score += 7;
    const contentHits = content.split(token).length - 1;
    score += Math.min(contentHits, 8);
    if (haystack.includes(token)) score += 3;
  }
  if (doc.favorite) score += 1;
  if (doc.duplicateOf) score -= 3;
  if (doc.parseStatus === "failed") score -= 4;
  return score;
}

function scoreTextBlock(title: string, body: string, query: string, baseline = 0) {
  const q = normalize(query);
  if (!q) return baseline;
  const tokens = queryTokens(query);
  const normalizedTitle = normalize(title);
  const normalizedBody = normalize(body);
  let score = baseline;
  if (normalizedTitle.includes(q)) score += 18;
  if (normalizedBody.includes(q)) score += 9;
  for (const token of tokens) {
    if (normalizedTitle.includes(token)) score += 10;
    if (normalizedBody.includes(token)) score += 4;
  }
  return score;
}

function statusLabel(status: ParseStatus) {
  if (status === "ok") return "已索引";
  if (status === "partial") return "部分索引";
  return "待处理";
}

function projectName(projectPath: string) {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath;
}

function cleanProjectCardText(value: string | null | undefined) {
  const raw = cleanDisplayText(value, "");
  if (!raw) return "";
  if (/^\s*[\[{]/.test(raw) && /["{[]|:\s*["\d]|,\s*"/.test(raw.slice(0, 260))) return "";
  if (/<codex_delegation|<\/source_thread_id>|<source_thread_id>|CALLBACK|Callback event/i.test(raw)) return "";
  if (/"projectPath"\s*:|C:\\|\\\\|\/site-packages\//i.test(raw) && raw.length > 80) return "";
  if (/<!doctype|<html|<head|<body|<meta\s|<\/?[a-z][\s>]/i.test(raw)) return "";
  if (/"test name"\s*:|"success"\s*:|"error"\s*:|HTTP\s+\d{3}|success['"]?\s*:\s*false/i.test(raw)) return "";
  return raw
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]+/g, " ")
    .replace(/\s[-*]\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStructuredProjectName(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 4000) return "";
  if (!/^\s*[\[{]/.test(raw)) return "";
  try {
    const parsed = JSON.parse(raw);
    const candidate =
      typeof parsed?.projectTitle === "string"
        ? parsed.projectTitle
        : typeof parsed?.projectName === "string"
          ? parsed.projectName
          : typeof parsed?.project === "string"
            ? parsed.project
            : "";
    return cleanProjectCardText(candidate);
  } catch {
    return "";
  }
}

function readableProjectDisplayName(projectPath: string, docs: KnowledgeDocument[]) {
  const pathName = cleanProjectCardText(projectName(projectPath));
  const structuredName = docs
    .map((doc) => extractStructuredProjectName(doc.summary) || extractStructuredProjectName(doc.contentText))
    .find(Boolean);
  const chineseTitle = docs
    .map((doc) => cleanProjectCardText(doc.title || doc.fileName))
    .find((title) => hasCjkText(title) && title.length >= 3 && !/^(项目知识|项目续接摘要|上下文包|README)$/i.test(title));
  const base = chineseTitle || (hasCjkText(pathName) ? pathName : structuredName || pathName || "未命名项目");
  return hasCjkText(base) || /项目$/.test(base) ? base : `${base} 项目`;
}

function polishProjectNameText(value: string, max = 38) {
  const name = value
    .replace(/^codex[-_ ]*/i, "")
    .replace(/\b\d{8,}[-_ ]?\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = name
    .split(/[-_]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(ui|fix|task|thread|dev|main|v\d+|\d+|r\d+)$/i.test(part))
    .slice(0, 4)
    .join(" · ");
  const fallback = compact || name || "未命名项目";
  return clipText(fallback, max);
}

function polishedProjectDisplayName(projectPath: string, docs: KnowledgeDocument[], max = 38) {
  return polishProjectNameText(readableProjectDisplayName(projectPath, docs), max);
}

function firstChineseSentenceFromText(values: Array<string | null | undefined>, minLength = 12) {
  const candidates = values
    .map(cleanProjectCardText)
    .filter((text) => hasCjkText(text));

  for (const text of candidates) {
    const sentences = text
      .split(/[。！？!?；;\n]/)
      .map((item) => cleanProjectCardText(item))
      .filter((item) => hasCjkText(item) && item.length >= minLength && !/确认|待确认|索引|source|metadata/i.test(item));
    if (sentences[0]) return sentences[0];
  }
  return "";
}

function firstChineseProjectSentence(docs: KnowledgeDocument[]) {
  return firstChineseSentenceFromText(docs.flatMap((doc) => [doc.title, doc.summary, doc.contentText]));
}

function isUsefulProjectIntro(value: string | null | undefined) {
  const raw = String(value || "");
  if (/^\s*#{1,6}\s/m.test(raw) || /\n\s*#{1,6}\s/.test(raw)) return false;
  if (/```|^\s*[-*]\s/m.test(raw)) return false;
  if (/重复文件|<codex_delegation|source_thread_id|task_id|\"version\"|C:\\|\\\\/.test(raw)) return false;
  const text = cleanProjectCardText(value);
  if (!text || !hasCjkText(text) || text.length < 10) return false;
  if (/doctype|html|meta|charset|source signature|metadata|fallback preview|local contract/i.test(text)) return false;
  if (/测试失败|HTTP\s+\d{3}|success false|test name|error/i.test(text)) return false;
  if (/^\s*[\[{]/.test(text)) return false;
  return true;
}

function isUsefulProjectCardTitle(value: string | null | undefined) {
  const raw = String(value || "");
  const text = cleanProjectCardText(value);
  if (!text || text.length < 2) return false;
  if (/^(README|workflow|context|project-knowledge|package-release)$/i.test(text)) return false;
  if (/<codex_delegation|source_thread_id|task_id|C:\\|\\\\|^\s*[\[{]/i.test(raw)) return false;
  if (/["{}<>]/.test(text) && text.length > 20) return false;
  return true;
}

function projectKnowledgeSummaryText(items: KnowledgeItem[]) {
  const ranked = [...items].sort((a, b) => {
    const providerScore = (item: KnowledgeItem) => (item.provider && item.provider !== "local" ? 4 : 0) + (item.status === "ready" ? 2 : 0);
    return providerScore(b) - providerScore(a) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  for (const item of ranked) {
    const candidate = [item.summary, item.body, item.title].find(isUsefulProjectIntro);
    if (candidate) return clipText(cleanProjectCardText(candidate), 150);
  }
  return "";
}

function readableDocumentTitle(doc: KnowledgeDocument | null | undefined) {
  if (!doc) return "";
  const title = cleanProjectCardText(doc.title);
  if (title && !/^(project-knowledge|context|README|SKILL|package-release)$/i.test(title)) return title;
  return cleanProjectCardText(fileBaseName(doc.filePath || doc.fileName));
}

function isProjectSummarySource(doc: KnowledgeDocument) {
  const sourcePath = `${doc.filePath || ""} ${doc.fileName || ""}`;
  if (/[\\/]codex-skills[\\/]|[\\/]skills[\\/]|[\\/]scripts[\\/]|[\\/]tools[\\/]/i.test(sourcePath)) return false;
  return true;
}

function projectTopicFromName(name: string) {
  const lower = name.toLowerCase();
  const known: Record<string, string> = {
    boto3: "Python AWS 云服务 SDK",
    botocore: "AWS SDK 底层运行库",
    eval: "模型或功能评测",
    infer: "模型推理",
    backbones: "模型骨干网络",
    triton_trtllm: "Triton / TensorRT-LLM 推理服务",
    gradio: "Gradio 交互界面",
    icons: "图标资源",
  };
  if (known[lower]) return known[lower];
  if (/site-packages|node_modules|vendor|venv|\.venv/i.test(name)) return "依赖库资料";
  if (/api|sdk/i.test(name)) return "接口或 SDK";
  if (/eval|test|bench/i.test(name)) return "评测与测试";
  if (/infer|serve|server|triton|llm|model/i.test(name)) return "模型推理服务";
  if (/ui|web|app|gradio|frontend/i.test(name)) return "界面应用";
  if (/doc|docs|knowledge|memory/i.test(name)) return "文档知识整理";
  return "";
}

function projectCardSummaryText(
  projectPath: string,
  docs: KnowledgeDocument[],
  projectMemory: { experienceCards: number; skillCandidates: number; knowledgeItems: number } | undefined,
  projectKnowledge: KnowledgeItem[] = [],
  generatedSummary?: string | null,
) {
  if (isUsefulProjectIntro(generatedSummary)) return clipText(cleanProjectCardText(generatedSummary), 150);

  const knowledgeSummary = projectKnowledgeSummaryText(projectKnowledge);
  if (knowledgeSummary) return knowledgeSummary;

  const chineseSentence = firstChineseProjectSentence(docs);
  if (chineseSentence) return clipText(chineseSentence, 150);

  const displayName = readableProjectDisplayName(projectPath, docs);
  const topic = projectTopicFromName(projectName(projectPath));
  const primaryDoc =
    docs.find((doc) => isProjectSummarySource(doc) && (doc.artifactType === "prd" || doc.artifactType === "readme" || doc.artifactType === "report")) ||
    docs.find((doc) => isProjectSummarySource(doc) && (doc.artifactType === "release_notes" || doc.artifactType === "technical_design" || doc.artifactType === "test_plan")) ||
    docs.find((doc) => isProjectSummarySource(doc) && doc.artifactType === "context") ||
    docs.find(isProjectSummarySource) ||
    docs[0];
  const primaryTitle = readableDocumentTitle(primaryDoc);
  if (topic) {
    return `${displayName}主要是${topic}相关资料。${primaryTitle ? `当前最有代表性的来源是“${clipText(primaryTitle, 32)}”。` : "知匣会继续从历史里补全项目说明。"}`;
  }
  if (primaryTitle) return `${displayName}围绕“${clipText(primaryTitle, 42)}”整理项目资料，点开后可以查看它的历史、知识和记忆。`;
  return `${displayName}还缺少清晰项目介绍，知匣会继续从聊天历史和项目文档里补全摘要。`;
}

function zhixiaSkillStatusLabel(status: string) {
  if (status === "success") return "已完成";
  if (status === "fallback") return "本地兜底";
  if (status === "failed") return "失败";
  if (status === "blocked") return "已拦截";
  return status || "未知";
}

function zhixiaSkillStatusTone(status: string): Tone {
  if (status === "success") return "teal";
  if (status === "fallback") return "amber";
  if (status === "failed" || status === "blocked") return "red";
  return "slate";
}

function isLikelyDependencyProject(projectPath: string, docs: KnowledgeDocument[]) {
  const path = projectPath.toLowerCase();
  if (/[\\/]site-packages[\\/]|[\\/]node_modules[\\/]|[\\/]\.venv[\\/]|[\\/]venv[\\/]|[\\/]vendor[\\/]|[\\/]dist[\\/]|[\\/]build[\\/]/.test(path)) return true;
  const projectDocs = docs.filter(isProjectSummarySource);
  const hasProjectEvidence = docs.some((doc) => documentLooksLikeProjectEvidence(doc));
  return projectDocs.length === 0 && !hasProjectEvidence && docs.length > 0;
}

const strongProjectArtifacts = new Set(["prd", "technical_design", "test_plan", "readme"]);
const supportingProjectArtifacts = new Set(["release_notes", "report", "context"]);

function pathLooksLikeNonProjectSource(value: string | null | undefined) {
  const text = String(value || "").toLowerCase();
  return (
    /[\\/](node_modules|dist|release|build|out|\.next|coverage|logs?|backups?)[\\/]/.test(text) ||
    /[\\/](codex-history-vault|thread-history-vault|flowskill-candidates)[\\/]/.test(text) ||
    /[\\/]\.codex-knowledge[\\/](tool-skill-inventory|project-chunks|project-index|knowledge-items|experience-cards|sources)\./.test(text) ||
    /(?:screenshot|clipboard|clip[-_ ]?temp|wechat|bilibili|youtube|douyin|xiaohongshu|article|link|bookmark|素材|截图|剪贴板|临时|转载|视频|链接)/i.test(text)
  );
}

function documentLooksLikeProjectEvidence(doc: KnowledgeDocument) {
  if (doc.duplicateOf || doc.parseStatus === "failed") return false;
  if (pathLooksLikeNonProjectSource(`${doc.filePath} ${doc.fileName} ${doc.title}`)) return false;
  if (strongProjectArtifacts.has(doc.artifactType || "")) return true;
  if (supportingProjectArtifacts.has(doc.artifactType || "") && ["workspace_file", "codex_context", "codex_output"].includes(doc.sourceType || "")) return true;
  return ["workspace_file", "codex_context", "codex_output"].includes(doc.sourceType || "") && /项目|PRD|技术设计|测试计划|release|handoff|decision|memory|roadmap/i.test(`${doc.title} ${doc.fileName} ${doc.summary}`);
}

function classifyProjectCandidate(
  project: {
    path: string;
    count: number;
    updatedAt: string;
    codexCount: number;
    activeCount: number;
    reviewCount: number;
    staleCount: number;
  },
  docs: KnowledgeDocument[],
  projectMemory: { experienceCards: number; skillCandidates: number; knowledgeItems: number } | undefined,
  projectKnowledge: KnowledgeItem[] = [],
): ProjectClassification {
  const reasons: string[] = [];
  const projectEvidenceDocs = docs.filter(documentLooksLikeProjectEvidence);
  const strongArtifactCount = docs.filter((doc) => strongProjectArtifacts.has(doc.artifactType || "") && documentLooksLikeProjectEvidence(doc)).length;
  const supportingArtifactCount = docs.filter((doc) => supportingProjectArtifacts.has(doc.artifactType || "") && documentLooksLikeProjectEvidence(doc)).length;
  const memoryCount = (projectMemory?.experienceCards || 0) + (projectMemory?.knowledgeItems || 0);
  let score = 0;
  let negative = 0;

  if (strongArtifactCount > 0) {
    score += strongArtifactCount * 18;
    reasons.push("有项目核心文档");
  }
  if (supportingArtifactCount > 0) {
    score += Math.min(supportingArtifactCount * 8, 24);
    reasons.push("有配套项目资料");
  }
  if (project.codexCount >= 2) {
    score += 14;
    reasons.push("有多条 Codex 项目历史");
  } else if (project.codexCount === 1) {
    score += 6;
  }
  if (projectEvidenceDocs.length >= 3) score += 10;
  if (projectEvidenceDocs.length >= 6) score += 10;
  if (project.activeCount >= 2) score += 6;
  if (memoryCount > 0) {
    score += Math.min(memoryCount * 7, 28);
    reasons.push("已有知识或记忆");
  }
  if (projectKnowledge.length > 0) score += Math.min(projectKnowledge.length * 3, 12);
  if (hasCjkText(readableProjectDisplayName(project.path, docs))) score += 4;

  if (isLikelyDependencyProject(project.path, docs) || pathLooksLikeNonProjectSource(project.path)) {
    negative += 36;
    reasons.push("路径像依赖/生成物/资料目录");
  }
  const noisyDocs = docs.filter((doc) => pathLooksLikeNonProjectSource(`${doc.filePath} ${doc.fileName} ${doc.title}`) || doc.duplicateOf);
  if (noisyDocs.length > 0 && noisyDocs.length >= Math.max(1, docs.length - 1)) negative += 24;
  if (docs.length <= 1 && project.codexCount === 0 && memoryCount === 0 && strongArtifactCount === 0) {
    negative += 28;
    reasons.push("单条资料，缺少项目上下文");
  }
  if (docs.every((doc) => doc.sourceType === "personal_knowledge" || doc.sourceType === "imported") && strongArtifactCount === 0 && project.codexCount === 0) {
    negative += 18;
  }

  const confidence = Math.max(0, score - negative);
  const hasProjectAnchor = strongArtifactCount > 0 || project.codexCount >= 2 || memoryCount > 0;
  const hasDocumentEvidence = projectEvidenceDocs.length >= 2;
  const hasActivityBackedEvidence = projectEvidenceDocs.length >= 1 && project.codexCount >= 2 && memoryCount >= 2;
  if (confidence >= 34 && hasProjectAnchor && (hasDocumentEvidence || hasActivityBackedEvidence)) {
    return { kind: "project", confidence, label: "项目", reasons: reasons.slice(0, 3) };
  }
  if (
    projectKnowledge.some((item) => item.provider === "codex_guardian" && (item.model === "thread_history_vault" || item.tags.includes("codex-history"))) &&
    project.codexCount >= 2 &&
    project.path &&
    !pathLooksLikeNonProjectSource(project.path)
  ) {
    return { kind: "project", confidence: Math.max(confidence, 28), label: "项目", reasons: [...reasons, "有旧线程历史入口"].slice(0, 3) };
  }
  if (confidence >= 18 && projectEvidenceDocs.length > 0) {
    return { kind: "lead", confidence, label: "待整理线索", reasons: reasons.slice(0, 3) };
  }
  return { kind: "non_project", confidence, label: "资料线索", reasons: reasons.slice(0, 3) };
}

function projectActivityScore(project: {
  path: string;
  count: number;
  updatedAt: string;
  codexCount: number;
  activeCount: number;
  reviewCount: number;
  staleCount: number;
}, docs: KnowledgeDocument[], projectMemory: { experienceCards: number; skillCandidates: number; knowledgeItems: number } | undefined) {
  const updatedMs = new Date(project.updatedAt).getTime();
  const ageDays = Number.isFinite(updatedMs) ? Math.max(0, (Date.now() - updatedMs) / 86_400_000) : 365;
  const recency = Math.max(0, 120 - Math.min(120, ageDays * 4));
  const artifactScore = docs.reduce((sum, doc) => {
    if (["prd", "technical_design", "test_plan", "release_notes", "report", "readme", "context"].includes(doc.artifactType || "")) return sum + 10;
    return sum;
  }, 0);
  const knowledgeScore = ((projectMemory?.knowledgeItems || 0) + (projectMemory?.experienceCards || 0)) * 6;
  const codexScore = Math.min(project.codexCount, 12) * 5;
  const activeScore = Math.min(project.activeCount, 18) * 2;
  const dependencyPenalty = isLikelyDependencyProject(project.path, docs) ? 180 : 0;
  return recency + artifactScore + knowledgeScore + codexScore + activeScore - dependencyPenalty;
}

function cleanPersonalVaultText(value: string | null | undefined) {
  const raw = cleanProjectCardText(value);
  return raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b[a-z]:\\[^\s]+/gi, "")
    .replace(/(?:^|\s)[./\\][^\s]+/g, " ")
    .replace(/\b(?:const|let|var|function|import|export|class|return|console\.log)\b[^。！？\n]{0,120}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function personalVaultTitle(doc: KnowledgeDocument) {
  const candidates = [doc.title, doc.summary, doc.contentText]
    .map(cleanPersonalVaultText)
    .filter(Boolean);
  const chinese = candidates.find((item) => hasCjkText(item) && item.length >= 4);
  if (chinese) {
    const line = chinese.split(/[。！？!?；;\n]/).map((item) => item.trim()).find((item) => item.length >= 4) || chinese;
    return clipText(line, 34);
  }
  const base = cleanPersonalVaultText(fileBaseName(doc.filePath || doc.fileName)) || "个人库内容";
  return hasCjkText(base) ? clipText(base, 34) : `个人收藏：${clipText(base, 24)}`;
}

function personalVaultSummary(doc: KnowledgeDocument) {
  const sentence = firstChineseSentenceFromText([doc.summary, doc.contentText, doc.title], 14);
  if (sentence) return clipText(sentence, 120);
  const section = vaultSectionLabels[vaultSectionFromPath(vaultRelativePath(doc))] || "个人库";
  const title = personalVaultTitle(doc).replace(/^个人收藏：/, "");
  return `${section}里的收藏内容，主题是“${clipText(title, 28)}”。打开后可以查看完整文案和整理结果。`;
}

function hasCjkText(value: string | null | undefined) {
  return /[\u3400-\u9FFF]/.test(String(value || ""));
}

function fileBaseName(filePath: string | null | undefined) {
  if (!filePath) return "";
  const leaf = filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
  return leaf.replace(/\.[^.]+$/, "");
}

function projectLabel(projectPath: string | null | undefined) {
  return projectPath ? projectName(projectPath) : "全局知识";
}

function isPersonalKnowledgeDocument(doc: KnowledgeDocument) {
  if (doc.sourceType === "personal_knowledge") return true;
  const paths = [doc.workspacePath, doc.filePath].filter(Boolean).join("\\");
  return /(^|[\\/])个人知识库([\\/]|$)/.test(paths);
}

function vaultRelativePath(doc: KnowledgeDocument) {
  const filePath = doc.filePath || doc.fileName;
  const workspacePath = doc.workspacePath || "";
  if (workspacePath && filePath.toLowerCase().startsWith(workspacePath.toLowerCase())) {
    return filePath.slice(workspacePath.length).replace(/^[\\/]+/, "") || doc.fileName;
  }
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  const rootIndex = parts.lastIndexOf("个人知识库");
  if (rootIndex >= 0 && rootIndex < parts.length - 1) return parts.slice(rootIndex + 1).join("/");
  return doc.fileName || filePath;
}

function vaultSectionFromPath(relativePath: string): VaultSectionKey {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const first = normalizedPath.split("/").filter(Boolean)[0] || "other";
  if (first === "inbox") return "inbox";
  if (first === "notes") return "notes";
  if (first === "maps") return "maps";
  if (first === "sources") return "sources";
  if (first === "docs") return "docs";
  return "other";
}

function displayKnowledgeTitle(item: KnowledgeItem) {
  if (hasCjkText(item.title)) return item.title;
  const category = knowledgeCategoryLabels[item.category] || "知识";
  const source = fileBaseName(item.sourcePath) || item.title || "未命名来源";
  return `${category}：${source}`;
}

function displayMemoryTitle(card: ExperienceCard) {
  if (hasCjkText(card.title)) return card.title;
  const sourceLabel =
    card.sourceType === "project_doc"
      ? "项目记忆"
      : card.sourceType === "bug_memory"
        ? "修复经验"
        : card.sourceType === "agent_family"
          ? "线程经验"
          : "经验记忆";
  const source = fileBaseName(card.sourcePath) || card.title || card.id;
  return `${sourceLabel}：${source}`;
}

function memorySourceTypeLabel(sourceType: ExperienceCard["sourceType"] | "skill_candidate" | string | null | undefined) {
  const labels: Record<string, string> = {
    project_doc: "项目历史记忆",
    bug_memory: "修复经验",
    agent_family: "线程经验",
    autoflow_completion: "任务完成经验",
    manual: "手动记忆",
    skill_candidate: "Skill 草稿",
  };
  return labels[String(sourceType || "")] || "项目记忆";
}

function memoryScopeLabel(scope: ExperienceCard["scope"] | string | null | undefined) {
  const labels: Record<string, string> = {
    user: "个人",
    project: "项目",
    task: "任务",
    autoflow: "AutoFlow",
  };
  return labels[String(scope || "")] || "项目";
}

function memoryStatusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    candidate: "待确认",
    accepted: "已保留",
    curated: "已精选",
    archived: "已归档",
    rejected: "已拒绝",
    stale: "待复核",
    draft: "草稿",
    approved: "已批准",
    installed: "已安装",
  };
  return labels[String(status || "")] || "待确认";
}

function sourceSignatureReviewLabel(state: string | null | undefined) {
  if (state === "current") return "来源已确认";
  if (state === "stale") return "来源已变化，待复核";
  return "等待确认来源";
}

function toolKindLabel(kind: ToolSkillRecord["kind"]) {
  const labels: Record<ToolSkillRecord["kind"], string> = {
    codex_skill: "Codex Skill",
    plugin: "插件",
    mcp_tool: "MCP 工具",
    workflow_script: "工作流脚本",
    cli_tool: "命令行工具",
    project_scaffold: "项目脚手架",
    other: "其他工具",
  };
  return labels[kind] || kind;
}

function displayToolChineseName(record: ToolSkillRecord) {
  if (hasCjkText(record.name)) return clipText(record.name.replace(/^Codex Skill[:：]\s*/i, ""), 34);
  const source = fileBaseName(record.sourcePath || record.installPath) || record.name;
  return clipText(source.replace(/^SKILL$/i, fileBaseName(record.installPath || record.sourcePath) || source), 34);
}

function displayToolSubtitle(record: ToolSkillRecord) {
  return `${toolOriginLabel(record)} · ${toolKindLabel(record.kind)}`;
}

function toolOriginLabel(record: ToolSkillRecord) {
  const discoveredBy = String(record.discoveredBy || "");
  if (discoveredBy.includes("project") || discoveredBy.includes("workflow")) return "自建 / 项目内";
  if (record.kind === "workflow_script" || record.kind === "cli_tool" || record.kind === "project_scaffold") return "自建 / 项目内";
  if (record.installed || discoveredBy.includes("skill_dir")) return "Codex 官方 / 全局";
  return "待归类";
}

function toolPurposeText(record: ToolSkillRecord) {
  const source = record.summary || record.useCases[0] || record.triggerPatterns[0] || "";
  if (!source) return "等待知匣从来源说明里补全用途。";
  const normalized = source
    .replace(/\bUse when\b/gi, "用于")
    .replace(/\bTriggers?:\b/gi, "触发场景：")
    .replace(/\bCodex\b/g, "Codex")
    .replace(/\bworkflow\b/gi, "工作流")
    .replace(/\bplugin\b/gi, "插件")
    .replace(/\bskill\b/gi, "工具");
  return clipText(normalized, 96);
}

function toolUsedProjectText(record: ToolSkillRecord) {
  const projects = record.workspacePaths.map(projectLabel).filter(Boolean);
  return projects.length > 0 ? clipText(projects.join("、"), 42) : "全局可见";
}

function toolCreatedText(record: ToolSkillRecord) {
  const source = record.sourceRefs.find((ref) => ref.updatedAt)?.updatedAt || record.governance?.reviewedAt || null;
  return source ? formatDate(source) : "扫描来源未提供";
}

function toolEvidenceLabel(pathValue: string | null | undefined, kind: string) {
  return pathValue ? `已生成 ${kind}` : "等待生成";
}

function artifactSortValue(type?: string | null) {
  const order = ["context", "readme", "prd", "technical_design", "test_plan", "release_notes", "report", "markdown", "document", "other"];
  const index = order.indexOf(type || "other");
  return index >= 0 ? index : order.length;
}

function documentSortValue(doc: KnowledgeDocument) {
  if (doc.fileName.toLowerCase() === "project-knowledge.md") return -10;
  if (doc.fileName.toLowerCase() === "context.md") return -5;
  return artifactSortValue(doc.artifactType);
}

function isRecentDocument(doc: KnowledgeDocument) {
  return Date.now() - new Date(doc.importedAt).getTime() <= 1000 * 60 * 60 * 24 * 7;
}

function isSourceChanged(doc: KnowledgeDocument) {
  if (!doc.fileModifiedAt) return false;
  return new Date(doc.fileModifiedAt).getTime() > new Date(doc.updatedAt).getTime();
}

function getDocumentLifecycle(doc: KnowledgeDocument) {
  if (doc.parseStatus === "failed") return { label: "stale", tone: "red" as Tone, detail: "解析失败" };
  if (isSourceChanged(doc)) return { label: "review", tone: "amber" as Tone, detail: "源文件已变化" };
  if (doc.duplicateOf) return { label: "review", tone: "amber" as Tone, detail: "重复待确认" };
  if (doc.parseStatus === "partial") return { label: "review", tone: "amber" as Tone, detail: "索引部分完成" };
  return { label: "active", tone: "teal" as Tone, detail: "当前有效" };
}

function getKnowledgeTone(item: KnowledgeItem) {
  if (item.status === "error") return { label: "error", tone: "red" as Tone };
  if (item.status === "fallback") return { label: "review", tone: "amber" as Tone };
  return { label: "active", tone: "teal" as Tone };
}

function getMemoryTone(card: ExperienceCard | SkillCandidate) {
  if ("draftSkillMarkdown" in card) {
    if (card.status === "approved" || card.status === "installed") return { label: memoryStatusLabel(card.status), tone: "teal" as Tone };
    if (card.status === "rejected") return { label: memoryStatusLabel(card.status), tone: "slate" as Tone };
    return { label: "待确认", tone: "amber" as Tone };
  }
  if (card.status === "curated" || card.status === "accepted") return { label: memoryStatusLabel(card.status), tone: "teal" as Tone };
  if (card.status === "rejected") return { label: memoryStatusLabel(card.status), tone: "red" as Tone };
  if (card.status === "stale") return { label: memoryStatusLabel(card.status), tone: "red" as Tone };
  if (card.status === "archived") return { label: memoryStatusLabel(card.status), tone: "slate" as Tone };
  return { label: "待确认", tone: "amber" as Tone };
}

const experienceCurationLabels: Record<ExperienceCardCurationDecision, string> = {
  pending: "待治理",
  keep: "保留",
  merge: "合并",
  reject: "拒绝",
  archive: "归档",
};

const experienceDuplicateLabels: Record<NonNullable<ExperienceCard["duplicateState"]>, string> = {
  unique: "唯一",
  duplicate_candidate: "疑似重复",
  kept: "保留主卡",
  merged: "已合并",
  rejected: "已拒绝",
  archived: "已归档",
};

function toneFromFreshness(freshness: AgentRetrieveFreshness): Tone {
  if (freshness === "stale") return "red";
  if (freshness === "review") return "amber";
  return "teal";
}

function freshnessLabel(freshness: AgentRetrieveFreshness) {
  if (freshness === "stale") return "已过期";
  if (freshness === "review") return "待确认";
  return "可使用";
}

function guardianFreshnessTone(freshness: string): Tone {
  if (freshness === "conflict" || freshness === "stale" || freshness === "unknown") return "red";
  if (freshness === "review") return "amber";
  return "teal";
}

function guardianFreshnessLabel(freshness: string) {
  if (freshness === "current") return "当前可用";
  if (freshness === "review") return "待复核";
  if (freshness === "stale") return "已过期";
  if (freshness === "conflict") return "有冲突";
  return "未知状态";
}

function retrieveKindLabel(kind: string) {
  if (kind === "project_record") return "项目档案";
  if (kind === "project_resume_packet") return "续接包";
  if (kind === "ceo_flow_record") return "CEO Flow";
  if (kind === "thread_lineage_index") return "线程族谱";
  if (kind === "document") return "历史";
  if (kind === "memory_fact") return "长期事实";
  if (kind === "runtime_event") return "运行记忆";
  if (kind === "knowledge_item") return "知识条目";
  if (kind === "experience_card") return "经验卡";
  if (kind === "skill_candidate") return "Skill 候选";
  if (kind === "tool_skill_record") return "工具资产";
  return kind;
}

function retrieveCacheLabel(cache: AgentRetrieveResult["cache"]) {
  if (!cache) return "";
  const ttlSeconds = Math.round(cache.ttlMs / 1000);
  return cache.hit ? `命中缓存 · TTL ${ttlSeconds}s` : `未命中缓存 · TTL ${ttlSeconds}s`;
}

function toneFromRetrieveStatus(status: string): Tone {
  if (status === "error") return "red";
  if (status === "fallback") return "amber";
  return "teal";
}

function retrieveStatusLabel(status: string) {
  if (status === "error") return "检索失败";
  if (status === "fallback") return "降级结果";
  return "检索成功";
}

function runtimeConfidenceLabel(confidence: AgentRuntimeConfidence) {
  if (confidence === "high") return "高置信";
  if (confidence === "medium") return "中置信";
  return "低置信";
}

function runtimeConfidenceTone(confidence: AgentRuntimeConfidence): Tone {
  if (confidence === "high") return "teal";
  if (confidence === "medium") return "amber";
  return "slate";
}

function runtimeActionLabel(action: AgentRuntimeAction) {
  const labels: Record<AgentRuntimeAction, string> = {
    wait_and_resample: "等待后重采样",
    inspect_process_metadata: "检查进程元数据",
    inspect_thread_metadata: "检查线程元数据",
    review_error_state: "复核错误状态",
    review_history_metadata: "复核历史元数据",
    none: "无动作",
  };
  return labels[action] || action;
}

function runtimeActionTone(action: AgentRuntimeAction): Tone {
  if (action === "review_error_state") return "red";
  if (action === "inspect_process_metadata" || action === "inspect_thread_metadata" || action === "review_history_metadata") return "amber";
  if (action === "wait_and_resample") return "teal";
  return "slate";
}

function runtimeStatusTone(status: AgentRuntimeSession["status"]): Tone {
  if (status === "systemError" || status === "notLoaded") return "red";
  if (status === "active" || status === "running") return "amber";
  if (status === "idle") return "teal";
  return "slate";
}

function runtimeSessionStatusLabel(status: AgentRuntimeSession["status"] | string) {
  const labels: Record<string, string> = {
    active: "活跃",
    running: "运行中",
    idle: "空闲",
    stale: "较久未用",
    paused: "已暂停",
    systemError: "异常",
    notLoaded: "未载入",
  };
  return labels[status] || status;
}

function runtimePlatformLabel(platform: string) {
  if (platform === "claude_code") return "Claude Code";
  if (platform === "openclaw") return "OpenClaw";
  if (platform === "gemini_cli") return "Gemini CLI";
  if (platform === "codex") return "Codex";
  if (platform === "cursor") return "Cursor";
  if (platform === "windsurf") return "Windsurf";
  return "Unknown";
}

function formatRuntimeCpu(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function runtimeProcessRankingCpu(process: AgentRuntimeProcessSample) {
  return Number.isFinite(process.rawCpuPercent) ? Number(process.rawCpuPercent) : process.cpuPercent;
}

function runtimeProcessCpuLabel(process: AgentRuntimeProcessSample) {
  const rankedCpu = runtimeProcessRankingCpu(process);
  return rankedCpu > process.cpuPercent ? `${formatRuntimeCpu(rankedCpu)} 采样峰值` : formatRuntimeCpu(process.cpuPercent);
}

function formatRuntimeCooldown(ms: number) {
  return `${Math.max(1, Math.ceil(ms / 1000))} 秒`;
}

function formatRuntimeRecentMinutes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  if (value < 1) return "<1 分钟";
  return `${Math.round(value)} 分钟`;
}

function runtimeInferenceBasisLabel(basis: string) {
  if (basis === "direct_process_reference_plus_runtime_signals") return "直接进程引用 + 运行时信号";
  if (basis === "heuristic_process_pressure_plus_session_metadata") return "进程压力 + session 元数据启发式";
  return "启发式判断";
}

function runtimeUncertaintySummary(uncertainty: AgentRuntimeAttributionUncertainty) {
  const reasons = uncertainty.reasons.length > 0 ? uncertainty.reasons.join("、") : "无额外原因";
  return `只看元数据：${uncertainty.metadataOnly ? "是" : "否"} · 是否有直接进程线索：${uncertainty.directProcessThreadMapping ? "有" : "无"} · ${reasons}`;
}

function historyRestoreStateLabel(state: string | null | undefined) {
  if (state === "vaulted") return "已入库";
  if (state === "compacted") return "已瘦身";
  if (state === "restored") return "已恢复";
  if (state === "blocked") return "暂不可处理";
  if (state === "failed") return "处理失败";
  return "已索引";
}

function historyRecordStatusLabel(status: string | null | undefined) {
  if (status === "optimized") return "已入库";
  if (status === "compacted") return "已瘦身";
  if (status === "stale") return "待复核";
  if (status === "blocked") return "暂不可处理";
  if (status === "error") return "处理失败";
  if (status === "candidate") return "候选";
  return "已索引";
}

function runtimeRecommendationText(recommendation: AgentRuntimeMonitorSnapshot["recommendations"][number]) {
  if (recommendation.scope === "process") {
    return `process pid=${recommendation.processId ?? "unknown"} confidence=${recommendation.attributionConfidence} action=${recommendation.recommendedAction} reason=${recommendation.reason}`;
  }
  return `session thread=${recommendation.threadId || recommendation.sessionId} confidence=${recommendation.attributionConfidence} action=${recommendation.recommendedAction} pressure=${recommendation.pressureScore} uncertainty=${runtimeUncertaintySummary(recommendation.uncertainty)} evidence=${recommendation.evidence.join(",") || "none"}`;
}

function runtimeSessionEvidenceSummary(session: AgentRuntimeSession) {
  const refs = [
    session.vaultManifestPath ? `vault=${clipText(session.vaultManifestPath, 72)}` : "",
    session.vaultSha256 ? `vaultHash=${clipText(session.vaultSha256, 24)}` : "",
    session.compactReceiptPath ? `receipt=${clipText(session.compactReceiptPath, 72)}` : "",
    session.memoryPointers?.length ? `pointer=${clipText(session.memoryPointers.slice(0, 2).join(", "), 88)}` : "",
  ].filter(Boolean);
  return refs.length > 0 ? refs.join(" · ") : "无详细 vault/pointer 路径证据";
}

function buildRuntimeMonitorDiagnosticReport(snapshot: AgentRuntimeMonitorSnapshot) {
  const lines = [
    "Agent Runtime Monitor diagnostic report",
    `sampledAt: ${snapshot.sampledAt}`,
    "policy: read-only, metadata-only, no raw session body, no cleanup/restore/compact/kill action",
    `provenance: processSampler=${snapshot.provenance?.processSampler || "unknown"} guardianReport=${snapshot.provenance?.guardianReport ? "yes" : "no"} longThreadMetadata=${snapshot.provenance?.longThreadMetadata ? "yes" : "no"} rawSessionPolicy=${snapshot.provenance?.rawSessionPolicy || "metadata_only_no_raw_body"} threadAttributionMode=${snapshot.provenance?.threadAttributionMode || "unknown"}`,
    "",
    "Summary",
    `processes=${snapshot.summary.totalProcesses} sessions=${snapshot.summary.totalSessions} totalCpu=${formatRuntimeCpu(snapshot.summary.totalCpuPercent)} totalMemory=${formatBytes(snapshot.summary.totalMemoryBytes)} highCpu=${snapshot.summary.highCpuProcessCount} highMemory=${snapshot.summary.highMemoryProcessCount} systemErrorSessions=${snapshot.summary.systemErrorSessionCount} largeUnoptimizedSessions=${snapshot.summary.largeUnoptimizedSessionCount}`,
    "",
    "Top processes",
    ...snapshot.processes.slice(0, 8).map((process) =>
      `- ${runtimePlatformLabel(process.platform)} pid=${process.processId} name=${process.processName} cpuRank=${formatRuntimeCpu(runtimeProcessRankingCpu(process))} cpuDisplay=${formatRuntimeCpu(process.cpuPercent)} memory=${formatBytes(process.memoryBytes)}`,
    ),
    "",
    "Top sessions",
    ...snapshot.sessions.slice(0, 8).map((session) =>
      `- thread=${session.threadId || session.id} title=${session.title || "untitled"} status=${session.status} bytes=${formatBytes(session.sessionBytes)} lastWrite=${session.lastWriteTime || "unknown"} pressure=${session.pressureScore} confidence=${session.attributionConfidence} action=${session.recommendedAction} observedRecent=${formatRuntimeRecentMinutes(session.observed.recentActivityMinutes)} inference=${runtimeInferenceBasisLabel(session.inferredAttribution.basis)} uncertainty=${runtimeUncertaintySummary(session.uncertainty)} vault=${session.hasThreadHistoryVault ? "yes" : "no"} pointer=${session.hasZhixiaHistoryPointer ? "yes" : "no"} receipt=${session.hasCompactReceipt ? "yes" : "no"} vaultManifest=${session.vaultManifestPath || "none"} vaultHash=${session.vaultSha256 || "none"} compactReceipt=${session.compactReceiptPath || "none"} memoryPointers=${session.memoryPointers?.join(",") || "none"} evidence=${session.evidence.join(",") || "none"}`,
    ),
    "",
    "Observed facts",
    `- topCpuProcess=${snapshot.observedFacts.processes.highestCpuProcess?.processId ?? "none"} topMemoryProcess=${snapshot.observedFacts.processes.highestMemoryProcess?.processId ?? "none"}`,
    ...snapshot.observedFacts.sessions.largestHistorySessions.slice(0, 5).map((session) =>
      `- observed thread=${session.threadId || session.sessionId} historyBytes=${formatBytes(session.historySizeBytes)} recent=${formatRuntimeRecentMinutes(session.recentActivityMinutes)} observedProcessIds=${session.observedProcessIds.join(",") || "none"}`,
    ),
    "",
    "Inferred attribution",
    ...(snapshot.inferredAttribution.length > 0
      ? snapshot.inferredAttribution.map((item) =>
          `- inferred thread=${item.threadId || item.sessionId} confidence=${item.confidence} basis=${runtimeInferenceBasisLabel(item.basis)} suspectedPid=${item.suspectedProcessId ?? "unknown"} uncertainty=${item.uncertainty ? runtimeUncertaintySummary(item.uncertainty) : "none"}`,
        )
      : ["- none"]),
    "",
    "Warnings",
    ...(snapshot.warnings.length > 0 ? snapshot.warnings.map((warning) => `- ${warning}`) : ["- none"]),
    "",
    "Recommendations",
    ...(snapshot.recommendations.length > 0 ? snapshot.recommendations.map((recommendation) => `- ${runtimeRecommendationText(recommendation)}`) : ["- none"]),
    "",
    "Platform support",
    ...(snapshot.summary.platformSupport?.length
      ? snapshot.summary.platformSupport.map((item) => `- ${item.platform}: ${item.supportLevel} (${item.sessionAdapter})`)
      : ["- none"]),
    `redactedProcessMetadata=${snapshot.summary.redactedProcessCount ?? 0}`,
    "",
    "Platform limitations",
    ...(snapshot.provenance?.platformLimitations?.length ? snapshot.provenance.platformLimitations.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Note: Process commandLine and executablePath are intentionally omitted from this copied report.",
  ];
  return lines.join("\n");
}

function estimateTokens(text: string) {
  return Math.max(80, Math.round(text.length / 4));
}

function isProjectResumeDocument(doc: KnowledgeDocument | null | undefined) {
  return Boolean(doc?.fileName.toLowerCase() === "project-resume.md" && doc.filePath.toLowerCase().includes(".codex-knowledge"));
}

function inferProjectCompletionFromDocuments(docs: KnowledgeDocument[]): ProjectRecordCompletion {
  const types = new Set(docs.map((doc) => doc.artifactType).filter(Boolean));
  if (types.has("release_notes")) return "released";
  if (types.has("test_plan")) return "testing";
  if (types.has("technical_design")) return "design";
  if (types.has("prd")) return "prd";
  if (types.has("readme") || types.has("context")) return "idea";
  return "unknown";
}

function completionPercentForProjectStage(stage: ProjectRecordCompletion) {
  const weights: Record<ProjectRecordCompletion, number> = {
    idea: 10,
    prd: 25,
    design: 40,
    implementation: 60,
    testing: 75,
    packaging: 85,
    released: 100,
    maintenance: 90,
    unknown: 0,
  };
  return weights[stage] ?? 0;
}

function projectCompletionLabel(stage: ProjectRecordCompletion | null | undefined) {
  const labels: Record<ProjectRecordCompletion, string> = {
    idea: "想法",
    prd: "需求",
    design: "设计",
    implementation: "开发中",
    testing: "测试中",
    packaging: "打包中",
    released: "已发布",
    maintenance: "维护中",
    unknown: "待整理想法",
  };
  return labels[stage || "unknown"] || "待整理想法";
}

function projectRecordStatusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    active: "进行中",
    waiting_review: "待确认",
    blocked: "有阻塞",
    paused: "已暂停",
    done: "已完成",
    archived: "已归档",
    idea: "想法",
    unknown: "待整理",
  };
  return labels[String(status || "unknown")] || "待整理";
}

function buildProjectRecordSourceSignature(projectPath: string | null, docs: KnowledgeDocument[]) {
  const sourceRefs = docs
    .map((doc) => ({
      path: doc.filePath || null,
      hash: doc.contentHash || null,
      updatedAt: doc.updatedAt || null,
    }))
    .sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")))
    .slice(0, 8);
  const activeCount = docs.filter((doc) => getDocumentLifecycle(doc).label === "active").length;
  const reviewCount = docs.filter((doc) => getDocumentLifecycle(doc).label === "review").length;
  const staleCount = docs.filter((doc) => getDocumentLifecycle(doc).label === "stale").length;
  const codexCount = docs.filter((doc) => ["codex_context", "codex_output"].includes(doc.sourceType || "")).length;
  return JSON.stringify({
    rootPath: projectPath,
    documentCount: docs.length,
    codexCount,
    activeCount,
    reviewCount,
    staleCount,
    sourceRefs,
  });
}

function App() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [experienceCards, setExperienceCards] = useState<ExperienceCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContentLoadingId, setSelectedContentLoadingId] = useState<string | null>(null);
  const [selectedExperienceId, setSelectedExperienceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKey>("project");
  const [projectTab, setProjectTab] = useState<ProjectTabKey>("overview");
  const [docFilter, setDocFilter] = useState<DocFilterKey>("project");
  const [vaultSection, setVaultSection] = useState<VaultSectionKey>("inbox");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("zhixia.sidebarWidth"));
    return Number.isFinite(saved) && saved >= 280 && saved <= 420 ? saved : 306;
  });
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => window.localStorage.getItem("zhixia.inspectorCollapsed") === "true");
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [storePath, setStorePath] = useState("");
  const [settings, setSettings] = useState<AppSettings>({});
  const [skillStatus, setSkillStatus] = useState<SkillStatus | null>(null);
  const [toolSkillInventory, setToolSkillInventory] = useState<ToolSkillInventoryResult | null>(null);
  const [toolSkillInventoryError, setToolSkillInventoryError] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatus | null>(null);
  const [codexGuardianReport, setCodexGuardianReport] = useState<CodexGuardianReport | null>(null);
  const [codexGuardianStatus, setCodexGuardianStatus] =
    useState<CodexGuardianCommandResult<CodexGuardianReport | CodexGuardianCleanReceipt> | null>(null);
  const [codexGuardianBusy, setCodexGuardianBusy] = useState(false);
  const [memoryOverview, setMemoryOverview] = useState<MemoryOverview | null>(null);
  const [skillCandidates, setSkillCandidates] = useState<SkillCandidate[]>([]);
  const [selectedSkillCandidateId, setSelectedSkillCandidateId] = useState<string | null>(null);
  const [knowledgeOverview, setKnowledgeOverview] = useState<KnowledgeOverview | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [zhixiaSkills, setZhixiaSkills] = useState<ZhixiaSkillDefinition[]>([]);
  const [skillRunReceipts, setSkillRunReceipts] = useState<SkillRunReceipt[]>([]);
  const [skillRunnerError, setSkillRunnerError] = useState<string | null>(null);
  const [agentRetrieveResult, setAgentRetrieveResult] = useState<AgentRetrieveResult | null>(null);
  const [agentRetrieveError, setAgentRetrieveError] = useState<string | null>(null);
  const [agentRetrieveMode, setAgentRetrieveMode] = useState<"local_contract" | "fallback_preview">("fallback_preview");
  const [agentRetrieveLogs, setAgentRetrieveLogs] = useState<AgentRetrieveLogEntry[]>([]);
  const [selectedAgentRetrieveLogId, setSelectedAgentRetrieveLogId] = useState<string | null>(null);
  const [agentRetrieveLogError, setAgentRetrieveLogError] = useState<string | null>(null);
  const [memoryRuntimePacket, setMemoryRuntimePacket] = useState<RuntimeContextPacket | null>(null);
  const [memoryRuntimeFacts, setMemoryRuntimeFacts] = useState<MemoryFact[]>([]);
  const [memoryRuntimeTriggerReceipts, setMemoryRuntimeTriggerReceipts] = useState<MemoryRuntimeTriggerReceipt[]>([]);
  const [memoryRuntimeBusy, setMemoryRuntimeBusy] = useState(false);
  const [memoryRuntimeError, setMemoryRuntimeError] = useState<string | null>(null);
  const [projectMemoryCoreByPath, setProjectMemoryCoreByPath] = useState<Record<string, ProjectMemoryCoreSnapshot>>({});
  const [projectMemoryCoreLoadingPaths, setProjectMemoryCoreLoadingPaths] = useState<string[]>([]);
  const [projectMemoryRecallByPath, setProjectMemoryRecallByPath] = useState<Record<string, RuntimeContextPacket>>({});
  const [projectMemoryRecallLoadingPaths, setProjectMemoryRecallLoadingPaths] = useState<string[]>([]);
  const [projectMemoryRecallErrors, setProjectMemoryRecallErrors] = useState<Record<string, true>>({});
  const projectMemoryCoreStartedRef = useRef(new Set<string>());
  const projectMemoryRecallStartedRef = useRef(new Set<string>());
  const [historyQuery, setHistoryQuery] = useState("CEO Flow");
  const [historyEnvelope, setHistoryEnvelope] = useState<CodexGuardianHistoryEnvelope | null>(null);
  const [selectedHistoryThreadId, setSelectedHistoryThreadId] = useState<string | null>(null);
  const [historyContextEnvelope, setHistoryContextEnvelope] = useState<CodexGuardianHistoryEnvelope | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [optimizedHistoryThreadIds, setOptimizedHistoryThreadIds] = useState<string[]>([]);
  const [compactedHistoryReceipts, setCompactedHistoryReceipts] = useState<Record<string, CodexGuardianCompactReceipt>>({});
  const [historyOptimizeSummary, setHistoryOptimizeSummary] = useState<string | null>(null);
  const [historyOptimizeProgress, setHistoryOptimizeProgress] = useState<HistoryOptimizeProgress | null>(null);
  const [historyArchiveQueue, setHistoryArchiveQueue] = useState<CodexThreadArchiveQueue | null>(null);
  const [threadRecoveryPacket, setThreadRecoveryPacket] = useState<ThreadRecoveryPacket | null>(null);
  const [longThreadsLoaded, setLongThreadsLoaded] = useState(false);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<AgentRuntimeMonitorSnapshot | null>(null);
  const [runtimeMonitorBusy, setRuntimeMonitorBusy] = useState(false);
  const [runtimeMonitorError, setRuntimeMonitorError] = useState<string | null>(null);
  const [runtimeMonitorCooldownUntil, setRuntimeMonitorCooldownUntil] = useState(0);
  const [aiKeyDraft, setAiKeyDraft] = useState("");
  const [notice, setNotice] = useState("准备扫描并整理项目。");
  const [busy, setBusy] = useState(false);
  const [scanActivity, setScanActivity] = useState<ScanActivity>({
    active: false,
    title: "等待扫描",
    detail: "点击“扫描并整理项目”后，知匣会按项目整理历史、知识、记忆和工具资产。",
    startedAt: null,
  });
  const [resumeDraft, setResumeDraft] = useState("");
  const runtimeMonitorCooldownRemainingMs = Math.max(0, runtimeMonitorCooldownUntil - Date.now());
  const runtimeMonitorCoolingDown = runtimeMonitorCooldownRemainingMs > 0;

  async function loadMemory() {
    const [overview, candidates, cards] = await Promise.all([
      window.docKnowledge.getMemoryOverview(),
      window.docKnowledge.listSkillCandidates(null),
      window.docKnowledge.listExperienceCards(null),
    ]);
    setMemoryOverview(overview);
    setSkillCandidates(candidates.candidates);
    setExperienceCards(cards.cards);
    setSelectedSkillCandidateId((current) => current || candidates.candidates[0]?.id || null);
    setSelectedExperienceId((current) => current || cards.cards[0]?.id || null);
  }

  async function loadKnowledge(projectPath: string | null = null) {
    const [overview, items] = await Promise.all([
      window.docKnowledge.getKnowledgeOverview(),
      window.docKnowledge.listKnowledgeItems(projectPath, { limit: 240 }),
    ]);
    setKnowledgeOverview(overview);
    setKnowledgeItems(items.items);
    setSelectedKnowledgeId((current) => current || items.items[0]?.id || null);
  }

  async function loadToolSkillInventory(projectPath: string | null = effectiveProjectPath) {
    if (!projectPath || typeof window.docKnowledge.getToolSkillInventory !== "function") {
      setToolSkillInventory(null);
      setToolSkillInventoryError(null);
      return;
    }
    try {
      const result = await window.docKnowledge.getToolSkillInventory(projectPath);
      setToolSkillInventory(result);
      setToolSkillInventoryError(null);
    } catch (error) {
      setToolSkillInventory(null);
      setToolSkillInventoryError(`工具资产目录读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadZhixiaSkills(options: { projectId?: string; limit?: number } = {}) {
    if (typeof window.docKnowledge.listZhixiaSkills !== "function") {
      setZhixiaSkills([]);
      setSkillRunReceipts([]);
      setSkillRunnerError("当前安装版还没有暴露知匣流程模块接口。");
      return;
    }
    try {
      const result = await window.docKnowledge.listZhixiaSkills({ limit: options.limit || 16, projectId: options.projectId });
      setZhixiaSkills(result.skills);
      setSkillRunReceipts(result.receipts);
      setSkillRunnerError(null);
    } catch (error) {
      setZhixiaSkills([]);
      setSkillRunReceipts([]);
      setSkillRunnerError(`知匣流程模块读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function scanToolSkillInventorySnapshot(projectPath: string | null = effectiveProjectPath) {
    if (!projectPath || typeof window.docKnowledge.scanToolSkillInventory !== "function") {
      setToolSkillInventory(null);
      setToolSkillInventoryError("当前项目不可扫描工具资产目录。");
      return;
    }
    setBusy(true);
    setScanActivity({
      active: true,
      title: `正在扫描 ${projectLabel(projectPath)} 的工具资产`,
      detail: "只读检查项目内 Skills、scripts、tools 和 workflow，不安装、不执行。",
      startedAt: new Date().toISOString(),
    });
    try {
      const result = await window.docKnowledge.scanToolSkillInventory(projectPath);
      setToolSkillInventory(result);
      setToolSkillInventoryError(null);
      setScanActivity({
        active: false,
        title: "工具资产扫描完成",
        detail: `${projectLabel(projectPath)}：${result.records.length} 条候选记录，仍需人工确认后才可依赖。`,
        startedAt: null,
        imported: result.records.length,
        projects: 1,
      });
      setNotice(`工具资产目录已刷新：${result.records.length} 条候选记录。`);
    } catch (error) {
      setToolSkillInventory(null);
      setScanActivity({
        active: false,
        title: "工具资产扫描失败",
        detail: error instanceof Error ? error.message : String(error),
        startedAt: null,
        errors: 1,
      });
      setToolSkillInventoryError(`工具资产目录扫描失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadRetrieveLogs(limit = 8) {
    if (typeof window.docKnowledge.listRetrieveLogs !== "function") {
      setAgentRetrieveLogs([]);
      setSelectedAgentRetrieveLogId(null);
      setAgentRetrieveLogError("当前 preload 未暴露检索日志接口，调用日志仅在支持 local contract 的桌面环境可见。");
      return;
    }
    try {
      const result = await window.docKnowledge.listRetrieveLogs({ limit });
      setAgentRetrieveLogs(result.logs);
      setSelectedAgentRetrieveLogId((current) =>
        result.logs.some((item) => item.id === current) ? current : result.logs[0]?.id || null,
      );
      setAgentRetrieveLogError(null);
    } catch (error) {
      setAgentRetrieveLogs([]);
      setSelectedAgentRetrieveLogId(null);
      setAgentRetrieveLogError(`检索日志读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadMemoryRuntimeDiagnostics(projectPath = effectiveProjectPath) {
    if (typeof window.docKnowledge.listMemoryFacts !== "function" || typeof window.docKnowledge.listMemoryRuntimeTriggerReceipts !== "function") {
      setMemoryRuntimeFacts([]);
      setMemoryRuntimeTriggerReceipts([]);
      return;
    }
    const [factsResult, receiptsResult] = await Promise.all([
      window.docKnowledge.listMemoryFacts({ projectPath: projectPath || null, limit: 120 }),
      window.docKnowledge.listMemoryRuntimeTriggerReceipts({ projectPath: projectPath || null, limit: 20 }),
    ]);
    setMemoryRuntimeFacts(factsResult.facts);
    setMemoryRuntimeTriggerReceipts(receiptsResult.receipts);
  }

  async function runMemoryRuntimeProbe() {
    if (typeof window.docKnowledge.retrieveMemoryRuntimeContext !== "function") {
      setMemoryRuntimeError("当前安装版未暴露 Memory Runtime 检索接口。");
      return;
    }
    if (memoryRuntimeBusy) return;
    setMemoryRuntimeBusy(true);
    setMemoryRuntimeError(null);
    try {
      const packet = await window.docKnowledge.retrieveMemoryRuntimeContext({
        taskGoal: query.trim() || `恢复 ${effectiveProjectPath ? projectLabel(effectiveProjectPath) : "当前项目"} 的当前状态、长期设计和下一步`,
        queryType: "project_resume",
        projectPath: effectiveProjectPath,
        tokenBudget: 1200,
        maxResults: 8,
      });
      setMemoryRuntimePacket(packet);
      await Promise.all([loadMemoryRuntimeDiagnostics(effectiveProjectPath), loadRetrieveLogs()]);
    } catch (error) {
      setMemoryRuntimeError(`Memory Runtime 检索失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMemoryRuntimeBusy(false);
    }
  }

  async function refreshRuntimeMonitorSnapshot(reason: RuntimeMonitorRefreshReason = "manual") {
    if (typeof window.docKnowledge.getRuntimeMonitorSnapshot !== "function") {
      setRuntimeMonitorError("当前 preload 未暴露运行监控接口。");
      return;
    }
    if (runtimeMonitorBusy) return;
    const cooldownRemainingMs = runtimeMonitorCooldownUntil - Date.now();
    if (cooldownRemainingMs > 0) {
      if (reason === "manual") {
        setRuntimeMonitorError(`采样刚完成，请等待 ${formatRuntimeCooldown(cooldownRemainingMs)} 后再刷新，避免监控页制造卡顿。`);
      }
      return;
    }
    setRuntimeMonitorBusy(true);
    try {
      const snapshot = await window.docKnowledge.getRuntimeMonitorSnapshot({
        sessionLimit: 12,
        includeLongThreadMetadata: false,
      });
      setRuntimeSnapshot(snapshot);
      setRuntimeMonitorError(null);
    } catch (error) {
      setRuntimeMonitorError(`运行监控采样失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRuntimeMonitorCooldownUntil(Date.now() + RUNTIME_MONITOR_REFRESH_COOLDOWN_MS);
      setRuntimeMonitorBusy(false);
    }
  }

  async function copyRuntimeMonitorDiagnosticReport() {
    if (!runtimeSnapshot) {
      setRuntimeMonitorError("请先刷新一次智能优化监控，再复制报告。");
      return;
    }
    try {
      await navigator.clipboard.writeText(buildRuntimeMonitorDiagnosticReport(runtimeSnapshot));
      setNotice("智能优化监控报告已复制。");
      setRuntimeMonitorError(null);
    } catch (error) {
      setRuntimeMonitorError(`诊断报告复制失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadDocuments() {
    const result = await window.docKnowledge.listDocuments({ includeContentText: false });
    setDocuments(result.documents);
    setStorePath(result.storePath);
    setSettings(result.settings);
    window.docKnowledge.getSkillStatus().then(setSkillStatus).catch(() => setSkillStatus(null));
    window.docKnowledge.getWatchStatus().then(setWatchStatus).catch(() => setWatchStatus(null));
    window.docKnowledge
      .getCodexGuardianReport()
      .then((guardianResult) => {
        if (guardianResult.ok && guardianResult.result) setCodexGuardianReport(guardianResult.result);
        else setCodexGuardianStatus(guardianResult);
      })
      .catch((error) =>
        setCodexGuardianStatus({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          refused: false,
        }),
      );
    loadMemory().catch(() => {
      setMemoryOverview(null);
      setSkillCandidates([]);
      setExperienceCards([]);
    });
    loadKnowledge().catch(() => setKnowledgeOverview(null));
    loadZhixiaSkills().catch(() => {
      setZhixiaSkills([]);
      setSkillRunReceipts([]);
    });
    setSelectedId((current) => current || result.documents[0]?.id || null);
  }

  useEffect(() => {
    loadDocuments().catch((error) => setNotice(String(error)));
    loadRetrieveLogs().catch(() => {
      setAgentRetrieveLogs([]);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const current = documents.find((doc) => doc.id === selectedId);
    if (!current || current.contentText || current.parseStatus === "failed" || current.contentLength === 0) return;
    let cancelled = false;
    setSelectedContentLoadingId(selectedId);
    window.docKnowledge
      .getDocument(selectedId)
      .then((result) => {
        if (cancelled || !result.document) return;
        setDocuments((items) => items.map((doc) => (doc.id === result.document?.id ? { ...doc, ...result.document } : doc)));
      })
      .catch((error) => setNotice(`正文按需加载失败：${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        if (!cancelled) setSelectedContentLoadingId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [documents, selectedId]);

  useEffect(() => {
    return window.docKnowledge.onWatchUpdate((payload) => {
      if (Array.isArray(payload.documents)) setDocuments(payload.documents);
      setSettings(payload.settings);
      setWatchStatus(payload.watchStatus);
      loadMemory().catch(() => {
        setMemoryOverview(null);
        setSkillCandidates([]);
        setExperienceCards([]);
      });
      loadKnowledge().catch(() => setKnowledgeOverview(null));
      if (payload.phase === "ready" || payload.phase === "disabled") return;
      setNotice(payload.message);
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem("zhixia.sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem("zhixia.inspectorCollapsed", String(inspectorCollapsed));
  }, [inspectorCollapsed]);

  useEffect(() => {
    if (runtimeMonitorCooldownUntil <= Date.now()) return;
    const timer = window.setTimeout(() => {
      setRuntimeMonitorCooldownUntil(0);
    }, runtimeMonitorCooldownUntil - Date.now());
    return () => window.clearTimeout(timer);
  }, [runtimeMonitorCooldownUntil]);

  useEffect(() => {
    if (!resizingSidebar) return;
    function onMouseMove(event: MouseEvent) {
      setSidebarWidth(Math.min(420, Math.max(272, event.clientX)));
    }
    function onMouseUp() {
      setResizingSidebar(false);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.classList.add("is-resizing-sidebar");
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("is-resizing-sidebar");
    };
  }, [resizingSidebar]);

  async function refreshDocuments() {
    if (settings.autoDetectChanges) {
      await checkChanges();
      return;
    }
    await loadDocuments();
    setNotice("项目知识视图已刷新。");
  }

  async function importDocuments() {
    setBusy(true);
    setNotice("正在导入并解析历史...");
    try {
      const result = await window.docKnowledge.importDocuments();
      setDocuments(result.documents);
      if (result.imported.length > 0) setSelectedId(result.imported[0].id);
      const failText = result.errors.length ? `，${result.errors.length} 个文件失败` : "";
      setNotice(`导入完成：${result.imported.length} 条历史${failText}。`);
      setView("documents");
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFolder() {
    setBusy(true);
    setNotice("正在递归扫描文件夹...");
    setScanActivity({
      active: true,
      title: "正在扫描文件夹",
      detail: "递归读取支持的历史来源，扫描完成后会自动更新项目列表。",
      startedAt: new Date().toISOString(),
    });
    try {
      const result = await window.docKnowledge.importFolder();
      setDocuments(result.documents);
      if (result.imported.length > 0) setSelectedId(result.imported[0].id);
      const failText = result.errors.length ? `，${result.errors.length} 个文件失败` : "";
      setScanActivity({
        active: false,
        title: "文件夹扫描完成",
        detail: `扫描 ${result.scanned} 个支持文件，导入/更新 ${result.imported.length} 个。`,
        startedAt: null,
        scanned: result.scanned,
        imported: result.imported.length,
        errors: result.errors.length,
      });
      setNotice(`文件夹导入完成：扫描 ${result.scanned} 个支持文件，导入/更新 ${result.imported.length} 个${failText}。`);
      setView("documents");
    } catch (error) {
      setScanActivity({
        active: false,
        title: "文件夹扫描失败",
        detail: error instanceof Error ? error.message : String(error),
        startedAt: null,
        errors: 1,
      });
      setNotice(`文件夹导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkChanges() {
    setBusy(true);
    setNotice("正在检测源文件变更...");
    try {
      const result = await window.docKnowledge.checkChanges();
      setDocuments(result.documents);
      const failText = result.errors.length ? `，${result.errors.length} 个重建失败` : "";
      setNotice(`检测完成：${result.changed} 个文件变化，${result.missing} 个文件缺失，已重建 ${result.reindexed.length} 个${failText}。`);
    } catch (error) {
      setNotice(`检测失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function scanCodexWorkspace() {
    setBusy(true);
    setNotice("正在扫描并整理 Codex 项目...");
    setScanActivity({
      active: true,
      title: "正在扫描并整理项目",
      detail: "识别 Codex 工作区，自动按项目整理历史、知识、记忆、工具资产和 Codex 检索来源。",
      startedAt: new Date().toISOString(),
    });
    try {
      const result = await window.docKnowledge.scanCodexWorkspace();
      setDocuments(result.documents);
      for (const projectPath of result.projects || []) {
        projectMemoryCoreStartedRef.current.delete(projectPath);
        projectMemoryRecallStartedRef.current.delete(projectPath);
      }
      const scannedProjects = new Set(result.projects || []);
      setProjectMemoryCoreByPath((current) => Object.fromEntries(Object.entries(current).filter(([projectPath]) => !scannedProjects.has(projectPath))));
      setProjectMemoryRecallByPath((current) => Object.fromEntries(Object.entries(current).filter(([projectPath]) => !scannedProjects.has(projectPath))));
      setProjectMemoryRecallErrors((current) => Object.fromEntries(Object.entries(current).filter(([projectPath]) => !scannedProjects.has(projectPath))));
      await loadMemory();
      await loadKnowledge();
      if (result.imported.length > 0) setSelectedId(result.imported[0].id);
      const failText = result.errors.length ? `，${result.errors.length} 个失败` : "";
      const projectText = result.projects?.length ? `，识别 ${result.projects.length} 个项目` : "";
      const knowledgeText = result.generatedKnowledge ? `，自动整理 ${result.generatedKnowledge} 条知识` : "";
      const firstProject = result.projects?.[0] || result.imported.find((doc) => doc.workspacePath)?.workspacePath || null;
      let toolRecordCount = result.generatedToolSkillRecords || 0;
      if (firstProject && typeof window.docKnowledge.getToolSkillInventory === "function") {
        try {
          const inventory = await window.docKnowledge.getToolSkillInventory(firstProject);
          setToolSkillInventory(inventory);
          setToolSkillInventoryError(null);
          if (!toolRecordCount) toolRecordCount = inventory.records.length;
        } catch (inventoryError) {
          setToolSkillInventoryError(`工具资产目录读取失败：${inventoryError instanceof Error ? inventoryError.message : String(inventoryError)}`);
        }
      }
      setScanActivity({
        active: false,
        title: "项目整理完成",
        detail: `扫描 ${result.scanned} 个支持文件，识别 ${result.projects?.length || 0} 个项目，归档/更新 ${result.imported.length} 个，为全部项目自动整理 ${result.generatedKnowledge || 0} 条知识和 ${toolRecordCount} 条工具资产候选。`,
        startedAt: null,
        scanned: result.scanned,
        imported: result.imported.length,
        projects: result.projects?.length || 0,
        errors: result.errors.length,
      });
      const toolText = toolRecordCount ? `，整理 ${toolRecordCount} 条工具资产` : "，工具资产待补充";
      setNotice(`项目扫描整理完成：${result.scanned} 个支持文件${projectText}，归档/更新 ${result.imported.length} 个${knowledgeText}${toolText}${failText}。`);
      setActiveProject(firstProject);
      setView("project");
      setProjectTab("overview");
      setDocFilter("project");
    } catch (error) {
      setScanActivity({
        active: false,
        title: "项目扫描失败",
        detail: error instanceof Error ? error.message : String(error),
        startedAt: null,
        errors: 1,
      });
      setNotice(`Codex 工作区扫描失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportCodexContext() {
    const selectedDocument = selected;
    if (!selectedDocument) return;
    setBusy(true);
    setNotice("正在导出 Codex 上下文包...");
    try {
      const result = await window.docKnowledge.exportCodexContext(selectedDocument.id);
      setDocuments(result.documents);
      if (result.exported) {
        setNotice(`已导出 Codex 上下文包：${result.bundlePath}`);
      } else {
        setNotice("已取消导出 Codex 上下文包。");
      }
    } catch (error) {
      setNotice(`导出 Codex 上下文失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function reindexDocumentRecord(selectedDocument: KnowledgeDocument) {
    setBusy(true);
    setNotice(`正在重建索引：${selectedDocument.title}`);
    try {
      const result = await window.docKnowledge.reindexDocument(selectedDocument.id);
      setDocuments(result.documents);
      const failText = result.errors.length ? `，${result.errors.length} 个失败` : "";
      setNotice(`重建完成：${result.reindexed.length} 个文档${failText}。`);
    } catch (error) {
      setNotice(`重建失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function reindexSelected() {
    const selectedDocument = selected;
    if (!selectedDocument) return;
    await reindexDocumentRecord(selectedDocument);
  }

  async function reindexAll() {
    setBusy(true);
    setNotice("正在重建全部索引...");
    try {
      const result = await window.docKnowledge.reindexAll();
      setDocuments(result.documents);
      const failText = result.errors.length ? `，${result.errors.length} 个失败` : "";
      setNotice(`全部重建完成：${result.reindexed.length} 个文档${failText}。`);
    } catch (error) {
      setNotice(`全部重建失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const result = await window.docKnowledge.updateSettings(patch);
    setSettings(result.settings);
    window.docKnowledge.getWatchStatus().then(setWatchStatus).catch(() => setWatchStatus(null));
    setNotice("设置已保存。");
  }

  async function generateKnowledge(mode: "heuristic" | "ai", nextView: ViewKey = "knowledge") {
    setBusy(true);
    setNotice(mode === "ai" ? "正在调用 AI 整理知识条目..." : "正在本地整理知识条目...");
    try {
      const result = await window.docKnowledge.generateKnowledgeItems({ mode, projectPath: activeProject });
      setKnowledgeOverview(result.overview);
      await loadKnowledge();
      const networkText = result.usedNetwork ? "，已使用配置的 AI Provider" : "，使用本地启发式整理";
      const errorText = result.errors.length ? `，${result.errors.length} 个文件降级或失败` : "";
      setNotice(`知识条目整理完成：生成/更新 ${result.generated} 条${networkText}${errorText}。`);
      setView(nextView);
      if (nextView === "project") setProjectTab("knowledge");
    } catch (error) {
      setNotice(`知识整理失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function generateProjectSummaries() {
    const targets = projectCards.slice(0, 8).map((item) => item.project.path);
    if (targets.length === 0) {
      setNotice("还没有可生成摘要的项目，先点击“扫描并整理项目”。");
      return;
    }
    setBusy(true);
    setNotice(`正在用知匣项目摘要流程整理 ${targets.length} 个活跃项目...`);
    let generated = 0;
    let fallback = 0;
    let failed = 0;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const projectPath = targets[index];
        setNotice(`正在生成项目摘要 ${index + 1}/${targets.length}：${projectName(projectPath)}`);
        try {
          const result = await window.docKnowledge.runZhixiaSkill({
            skillId: "project-summary-cn",
            projectPath,
            mode: "ai",
          });
          setSettings(result.settings);
          if (result.receipt.status === "fallback") fallback += 1;
          else generated += 1;
        } catch {
          failed += 1;
        }
      }
      const fallbackText = fallback ? `，${fallback} 个使用本地规则` : "";
      const failedText = failed ? `，${failed} 个失败` : "";
      await loadZhixiaSkills({ limit: 16 });
      setNotice(`项目摘要整理完成：${generated + fallback} 个项目已更新${fallbackText}${failedText}。`);
    } finally {
      setBusy(false);
    }
  }

  async function generateSingleProjectSummary(projectPath: string | null = effectiveProjectPath) {
    if (!projectPath) {
      setNotice("还没有可生成摘要的项目，先点击“扫描并整理项目”。");
      return;
    }
    setBusy(true);
    setNotice(`正在刷新项目摘要：${projectName(projectPath)}`);
    try {
      const result = await window.docKnowledge.runZhixiaSkill({
        skillId: "project-summary-cn",
        projectPath,
        mode: "ai",
      });
      setSettings(result.settings);
      await loadZhixiaSkills({ projectId: projectPath, limit: 8 });
      const modeText = result.usedNetwork ? "已使用 AI Provider" : result.receipt.status === "fallback" ? "使用本地规则兜底" : "使用本地规则";
      setNotice(`项目摘要已更新：${result.output.title || projectName(projectPath)}，${modeText}。`);
    } catch (error) {
      setNotice(`项目摘要生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function testAiProvider() {
    setBusy(true);
    setNotice("正在测试 AI Provider 连接...");
    try {
      const result = await window.docKnowledge.testAiProvider();
      setNotice(result.message);
    } catch (error) {
      setNotice(`AI Provider 测试失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveAiProviderKey() {
    await updateSettings({ aiProviderApiKey: aiKeyDraft });
    setAiKeyDraft("");
    setNotice(aiKeyDraft ? "AI Provider API Key 已保存到本机。" : "AI Provider API Key 已清空。");
  }

  async function confirmProjectResumePacket() {
    if (!effectiveProjectPath || !projectResumeDoc) return;
    const confirmations = {
      ...(settings.projectResumeConfirmations || {}),
      [effectiveProjectPath]: {
        status: "confirmed" as const,
        confirmedAt: new Date().toISOString(),
        documentId: projectResumeDoc.id,
        contentHash: projectResumeDoc.contentHash || null,
        updatedAt: projectResumeDoc.updatedAt || null,
      },
    };
    await updateSettings({ projectResumeConfirmations: confirmations });
    setNotice(`已确认项目续接包：${projectResumeDoc.fileName}`);
  }

  async function confirmProjectArtifactsMap() {
    if (!effectiveProjectPath || (!projectArtifactsMarkdownDoc && !projectArtifactsJsonDoc)) return;
    const confirmations = {
      ...(settings.projectArtifactConfirmations || {}),
      [effectiveProjectPath]: {
        status: "confirmed" as const,
        confirmedAt: new Date().toISOString(),
        markdownDocumentId: projectArtifactsMarkdownDoc?.id || null,
        markdownContentHash: projectArtifactsMarkdownDoc?.contentHash || null,
        markdownUpdatedAt: projectArtifactsMarkdownDoc?.updatedAt || null,
        jsonDocumentId: projectArtifactsJsonDoc?.id || null,
        jsonContentHash: projectArtifactsJsonDoc?.contentHash || null,
        jsonUpdatedAt: projectArtifactsJsonDoc?.updatedAt || null,
      },
    };
    await updateSettings({ projectArtifactConfirmations: confirmations });
    setNotice("已确认当前项目资料目录。");
  }

  async function confirmToolSkillInventorySnapshot() {
    if (!effectiveProjectPath || !toolSkillInventory) return;
    setBusy(true);
    try {
      const result = await window.docKnowledge.confirmToolSkillInventory({
        projectPath: effectiveProjectPath,
        snapshotHash: toolSkillInventory.snapshotHash,
      });
      setToolSkillInventory(result);
      const latest = await window.docKnowledge.listDocuments();
      setSettings(latest.settings);
      setNotice("已确认工具资产目录。");
      setToolSkillInventoryError(null);
    } catch (error) {
      setToolSkillInventoryError(`工具资产目录确认失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateToolSkillRecordGovernance(recordId: string, status: ToolSkillGovernanceAction) {
    if (!effectiveProjectPath || !toolSkillInventory) return;
    setBusy(true);
    try {
      const result = await window.docKnowledge.updateToolSkillRecordGovernance({
        projectPath: effectiveProjectPath,
        recordId,
        status,
        snapshotHash: toolSkillInventory.snapshotHash,
      });
      setToolSkillInventory(result);
      const label =
        status === "clear"
          ? "已清除单条工具治理状态。"
          : `已标记单条工具治理状态：${toolSkillRecordStatusLabel(status)}。`;
      setNotice(label);
      setToolSkillInventoryError(null);
    } catch (error) {
      setToolSkillInventoryError(`Tool/Skill 单条治理失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmProjectRecordSnapshot() {
    if (!effectiveProjectPath) return;
    const completion = inferProjectCompletionFromDocuments(projectDocuments);
    const status: ProjectRecordStatus =
      projectStatus.staleCount > 0 ? "waiting_review" : projectStatus.reviewCount > 0 ? "waiting_review" : "active";
    const nextAction = projectResumeDoc
      ? "优先读取并维护项目续接摘要，再按当前项目任务继续。"
      : "先扫描或整理项目知识，生成项目续接摘要。";
    const blockers = [
      projectStatus.reviewCount > 0 ? `${projectStatus.reviewCount} 项待确认知识或历史` : "",
      projectStatus.staleCount > 0 ? `${projectStatus.staleCount} 项过期来源待复查` : "",
      projectStatus.sourceChangedCount > 0 ? `${projectStatus.sourceChangedCount} 个源文件已变化` : "",
    ].filter(Boolean);
    const overrides = {
      ...(settings.projectRecordOverrides || {}),
      [effectiveProjectPath]: {
        status,
        completion,
        completionPercent: completionPercentForProjectStage(completion),
        lastSummary: `${projectDocuments.length} 条项目历史，${projectStatus.activeCount} 个当前有效，${projectStatus.reviewCount} 个待确认。`,
        nextAction,
        blockers,
        confirmedAt: new Date().toISOString(),
        projectRecordSourceSignature,
      },
    };
    await updateSettings({ projectRecordOverrides: overrides });
    setNotice(`已确认项目档案快照：${projectName(effectiveProjectPath)}`);
  }

  async function saveProjectResumePacket() {
    if (!selected || !isProjectResumeDocument(selected)) return;
    setBusy(true);
    setNotice("正在保存项目续接摘要并重建索引...");
    try {
      const result = await window.docKnowledge.updateDocumentContent(selected.id, resumeDraft);
      setDocuments(result.documents);
      const failText = result.errors.length ? `，${result.errors.length} 个索引错误` : "";
      setNotice(`项目续接摘要已保存并重新入库${failText}。`);
    } catch (error) {
      setNotice(`续接包保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importAutoflowExperience() {
    setBusy(true);
    setNotice("正在只读导入 AutoFlow 经验...");
    try {
      const result = await window.docKnowledge.importAutoflowExperience();
      setMemoryOverview(result.overview);
      await loadMemory();
      await loadKnowledge();
      const projectText = result.projectPaths.length ? `，关联 ${result.projectPaths.length} 个项目` : "";
      const fileText = result.writtenFiles.length ? `，写出 ${result.writtenFiles.length} 个项目知识文件` : "";
      setNotice(`AutoFlow 经验导入完成：${result.imported} 张经验卡片${projectText}${fileText}。`);
      setView("memory");
    } catch (error) {
      setNotice(`AutoFlow 经验导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateExperienceStatus(
    id: string,
    status: ExperienceCardStatus,
    successMessage: string,
    options?: ExperienceCardGovernanceOptions,
  ) {
    setBusy(true);
    try {
      const result = await window.docKnowledge.updateExperienceCardStatus(id, status, options);
      setMemoryOverview(result.overview);
      await loadMemory();
      if (result.card) setSelectedExperienceId(result.card.id);
      setNotice(successMessage);
      setView("memory");
    } catch (error) {
      setNotice(`经验记忆状态更新失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateProjectDocCandidateBatch(
    status: Extract<ExperienceCardStatus, "accepted" | "archived" | "rejected">,
    options?: ExperienceCardGovernanceOptions,
  ) {
    const candidates = filteredExperienceCards.filter(
      (item) => item.status === "candidate" && item.sourceType === "project_doc",
    );
    if (candidates.length === 0) {
      setNotice("当前范围没有待治理的项目历史候选记忆。");
      return;
    }
    setBusy(true);
    try {
      for (const card of candidates) {
        await window.docKnowledge.updateExperienceCardStatus(card.id, status, options);
      }
      await loadMemory();
      const verb = status === "accepted" ? "已保留" : status === "rejected" ? "已拒绝" : "已归档";
      setNotice(`${verb} ${candidates.length} 条项目历史候选记忆。`);
      setView("memory");
    } catch (error) {
      setNotice(`项目历史候选批量治理失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateSkillCandidateStatus(id: string, status: SkillCandidateStatus, successMessage: string) {
    setBusy(true);
    try {
      const result = await window.docKnowledge.updateSkillCandidateStatus(id, status);
      setMemoryOverview(result.overview);
      await loadMemory();
      if (result.candidate) setSelectedSkillCandidateId(result.candidate.id);
      setNotice(successMessage);
      setView("memory");
    } catch (error) {
      setNotice(`Skill 候选状态更新失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function installSkill() {
    setBusy(true);
    setNotice("正在连接 Codex...");
    try {
      const result = await window.docKnowledge.installSkill();
      setSkillStatus(result);
      setNotice(`Codex 已连接：${result.targetPath}`);
    } catch (error) {
      setNotice(`Codex 连接失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function revealSkillsFolder() {
    const result = await window.docKnowledge.revealSkillsFolder();
    setSkillStatus(result);
  }

  async function refreshCodexGuardianReport() {
    setCodexGuardianBusy(true);
    setNotice("正在体检 Codex 热日志...");
    try {
      const result = await window.docKnowledge.getCodexGuardianReport();
      setCodexGuardianStatus(result.ok ? null : result);
      if (result.ok && result.result) {
        setCodexGuardianReport(result.result);
        const runningCount = result.result.codex_running?.length || 0;
        setNotice(`Codex 热日志体检完成：${guardianSeverityLabel(result.result)}，运行中进程 ${runningCount} 个。`);
      } else {
        setNotice(`Codex 热日志体检失败：${result.error || "Guardian 未返回报告"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCodexGuardianStatus({ ok: false, error: message, refused: false });
      setNotice(`Codex 热日志体检失败：${message}`);
    } finally {
      setCodexGuardianBusy(false);
    }
  }

  async function cleanCodexHotLogs() {
    setCodexGuardianBusy(true);
    setNotice("正在请求 Guardian 清理 Codex 热日志...");
    try {
      const result = await window.docKnowledge.cleanCodexHotLogs({ userConfirmed: true });
      setCodexGuardianStatus(result);
      if (result.ok && result.result) {
        const before = Object.values(result.result.before || {}).reduce((sum, item) => sum + Number(item || 0), 0);
        const after = Object.values(result.result.after || {}).reduce((sum, item) => sum + Number(item || 0), 0);
        setNotice(`Codex 热日志清理完成：${formatBytes(before)} -> ${formatBytes(after)}，已生成备份和回执。`);
      } else if (result.refused) {
        setNotice("Guardian 已拒绝清理：请先关闭 Codex、codex 和 node_repl 进程，再从知匣点击清理。");
      } else {
        setNotice(`Codex 热日志清理失败：${result.error || "Guardian 未返回清理回执"}`);
      }
      const report = await window.docKnowledge.getCodexGuardianReport();
      if (report.ok && report.result) setCodexGuardianReport(report.result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCodexGuardianStatus({ ok: false, error: message, refused: false });
      setNotice(`Codex 热日志清理失败：${message}`);
    } finally {
      setCodexGuardianBusy(false);
    }
  }

  function summarizeCodexLogCleanup(receipt: CodexGuardianCleanReceipt | null) {
    if (!receipt) return "运行日志未清理";
    const before = Object.values(receipt.before || {}).reduce((sum, item) => sum + Number(item || 0), 0);
    const after = Object.values(receipt.after || {}).reduce((sum, item) => sum + Number(item || 0), 0);
    return `运行日志 ${formatBytes(before)} -> ${formatBytes(after)}`;
  }

  async function searchOldThreads(nextQuery = historyQuery) {
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryArchiveQueue(null);
    setNotice("正在检索 Codex 老线程摘要...");
    try {
      const result = await window.docKnowledge.searchCodexHistory({
        query: nextQuery,
        limit: 8,
        tokenBudget: 900,
      });
      if (result.ok && result.result) {
        setHistoryEnvelope(result.result);
        setSelectedHistoryThreadId((current) =>
          result.result?.items.some((item) => item.threadId === current)
            ? current
            : result.result?.items[0]?.threadId || null,
        );
        setHistoryContextEnvelope(null);
        setThreadRecoveryPacket(null);
        setNotice(`老线程检索完成：命中 ${result.result.items.length} 条历史摘要。`);
      } else {
        setHistoryError(result.error || "Guardian 未返回历史检索结果。");
        setNotice(`老线程检索失败：${result.error || "Guardian 未返回历史检索结果"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setNotice(`老线程检索失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadLongThreadCandidates() {
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryArchiveQueue(null);
    setNotice("正在自动体检较长的 Codex 老线程...");
    try {
      const result = await window.docKnowledge.listLongCodexThreads({
        limit: 24,
        tokenBudget: 900,
        minBytes: 8 * 1024 * 1024,
        minAgeMinutes: 30,
      });
      setLongThreadsLoaded(true);
      if (result.ok && result.result) {
        setHistoryEnvelope(result.result);
        setSelectedHistoryThreadId(result.result.items[0]?.threadId || null);
        setHistoryContextEnvelope(null);
        setThreadRecoveryPacket(null);
        setNotice(
          result.result.items.length > 0
            ? `长线程体检完成：发现 ${result.result.items.length} 条过长老线程。`
            : "长线程体检完成：暂未发现超过阈值的老线程。",
        );
      } else {
        setHistoryError(result.error || "Guardian 未返回长线程体检结果。");
        setNotice(`长线程体检失败：${result.error || "Guardian 未返回长线程体检结果"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLongThreadsLoaded(true);
      setHistoryError(message);
      setNotice(`长线程体检失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadOldThreadContext(threadId: string | null = selectedHistoryThreadId) {
    if (!threadId) {
      setHistoryError("请先选择一个历史线程。");
      return;
    }
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryOptimizeSummary(null);
    setNotice("正在把老线程写入知匣历史知识库...");
    try {
      const result = await optimizeOneOldThread(threadId, true);
      if (result.ok && result.result) {
        const item = result.result.items[0] || null;
        if (item) {
          await loadRetrieveLogs().catch(() => {});
          setOptimizedHistoryThreadIds((current) => Array.from(new Set([...current, item.threadId])));
          setHistoryOptimizeSummary(`已入库 1 条老线程：${item.threadId}。历史可用 threadId、项目名或关键词检索。`);
      setNotice(result.result.optimized?.message || "老线程已写入知匣知识库，后续可通过知匣搜索和智能优化检索找到。");
        } else {
          setNotice("老线程入库完成，可用于知匣历史检索。");
        }
      } else {
        setHistoryError(result.error || "Guardian 未返回老线程入库结果。");
        setNotice(`老线程入库失败：${result.error || "Guardian 未返回老线程入库结果"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setNotice(`老线程入库失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function optimizeOneOldThread(threadId: string, updateContext = false, options: { metadataOnly?: boolean } = {}) {
    const result = await window.docKnowledge.optimizeCodexThread({
      threadId,
      tokenBudget: 900,
      metadataOnly: options.metadataOnly === true,
      userConfirmed: true,
    });
    if (result.ok && result.result) {
      if (updateContext) setHistoryContextEnvelope(result.result);
      const item = result.result.items[0] || null;
      await loadKnowledge(item?.provenance?.projectRoot || null).catch(() => {});
    }
    return result;
  }

  function applyCompactReceipt(threadId: string, receipt: CodexGuardianCompactReceipt) {
    setCompactedHistoryReceipts((current) => ({ ...current, [threadId]: receipt }));
    setHistoryEnvelope((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.threadId === threadId
                ? {
                    ...item,
                    sessionBytes: receipt.after_bytes,
                    pressureReason: "compacted_session",
                    provenance: {
                      ...item.provenance,
                      lastWriteTime: receipt.created_at,
                    },
                  }
                : item,
            ),
          }
        : current,
    );
  }

  async function generateArchiveQueueForItems(
    items: CodexGuardianHistoryItem[],
    receipts: Record<string, CodexGuardianCompactReceipt>,
    options: { bypassRoleCooling?: boolean } = {},
  ) {
    const result = await window.docKnowledge.generateCodexArchiveQueue({
      items,
      compactReceipts: receipts,
      skipThreadIds: [],
      bypassRoleCooling: options.bypassRoleCooling === true,
      userConfirmed: true,
    });
    if (result.ok && result.result) {
      setHistoryArchiveQueue(result.result);
      return result.result;
    }
    throw new Error(result.error || "归档队列生成失败。");
  }

  async function generateArchiveQueueForVisibleThreads() {
    const items = historyEnvelope?.items || [];
    if (items.length === 0) {
      setHistoryError("当前没有可归档的老线程候选。请先点“一键安全减负”。");
      return;
    }
    setHistoryBusy(true);
    setHistoryError(null);
    try {
      const queue = await generateArchiveQueueForItems(items, compactedHistoryReceipts);
      const message =
        queue.readyCount > 0
          ? `归档队列已生成：${queue.readyCount} 条可交给 Codex 宿主归档，${queue.skippedCount} 条自动跳过。`
          : `归档队列已生成：当前没有满足历史入库和冷却规则的线程，${queue.skippedCount} 条已自动跳过。`;
      setHistoryOptimizeSummary(`${message} 队列文件：${queue.queuePath}`);
      setNotice(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setNotice(`归档队列生成失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function optimizeVisibleOldThreads() {
    const items = historyEnvelope?.items || [];
    if (items.length === 0) {
      setHistoryError("当前没有可优化的老线程。请先点“自动体检”或搜索老线程。");
      return;
    }
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryOptimizeSummary(null);
    const succeeded: string[] = [];
    const failed: string[] = [];
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setNotice(`正在入库老线程 ${index + 1}/${items.length}：${item.threadId}`);
        const result = await optimizeOneOldThread(item.threadId, index === 0);
        if (result.ok && result.result) {
          succeeded.push(item.threadId);
          setOptimizedHistoryThreadIds((current) => Array.from(new Set([...current, item.threadId])));
        } else {
          failed.push(`${item.threadId}: ${result.error || "未知错误"}`);
        }
      }
      await loadRetrieveLogs().catch(() => {});
      const message = `批量入库完成：成功 ${succeeded.length} 条，失败 ${failed.length} 条。已成功的老线程可在知匣知识库 / 智能优化检索中找到。`;
      setHistoryOptimizeSummary(failed.length > 0 ? `${message} 失败：${failed.slice(0, 3).join("；")}` : message);
      setNotice(message);
      if (failed.length > 0) setHistoryError(`部分老线程入库失败：${failed.slice(0, 3).join("；")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setNotice(`批量入库失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function compactSelectedOldThread(threadId: string | null = selectedHistoryThreadId) {
    if (!threadId) {
      setHistoryError("请先选择一个历史线程。");
      return;
    }
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryOptimizeSummary(null);
    setNotice("正在备份并瘦身老线程本体...");
    try {
      const result = await window.docKnowledge.compactCodexThread({ threadId, userConfirmed: true });
      if (result.ok && result.result) {
        const receipt = result.result;
        applyCompactReceipt(threadId, receipt);
        const saved = formatBytes(receipt.bytes_saved);
        setHistoryOptimizeSummary(`本体瘦身完成：${formatBytes(receipt.before_bytes)} -> ${formatBytes(receipt.after_bytes)}，释放 ${saved}。已保留完整备份。`);
        setNotice("老线程本体已瘦身。若该线程窗口仍然卡，请关闭并重新打开这条 Codex 线程，让 Codex 重新读取瘦身后的 session。");
        const context = await window.docKnowledge.getCodexThreadContext({ threadId, tokenBudget: 900 }).catch(() => null);
        if (context?.ok && context.result) setHistoryContextEnvelope(context.result);
      } else {
        setHistoryError(result.error || "Guardian 未返回本体瘦身结果。");
        setNotice(`本体瘦身失败：${result.error || "Guardian 未返回本体瘦身结果"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setNotice(`本体瘦身失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function compactVisibleOldThreads() {
    const items = historyEnvelope?.items || [];
    if (items.length === 0) {
      setHistoryError("当前没有可瘦身的老线程。请先点“自动体检”或搜索老线程。");
      return;
    }
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryOptimizeSummary(null);
    const succeeded: string[] = [];
    const failed: string[] = [];
    let beforeTotal = 0;
    let afterTotal = 0;
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setNotice(`正在瘦身老线程 ${index + 1}/${items.length}：${item.threadId}`);
        const result = await window.docKnowledge.compactCodexThread({ threadId: item.threadId, userConfirmed: true });
        if (result.ok && result.result) {
          const receipt = result.result;
          succeeded.push(item.threadId);
          beforeTotal += receipt.before_bytes;
          afterTotal += receipt.after_bytes;
          applyCompactReceipt(item.threadId, receipt);
        } else {
          failed.push(`${item.threadId}: ${result.error || "未知错误"}`);
        }
      }
      const saved = Math.max(0, beforeTotal - afterTotal);
      const message = `批量本体瘦身完成：成功 ${succeeded.length} 条，失败 ${failed.length} 条，释放 ${formatBytes(saved)}。`;
      setHistoryOptimizeSummary(failed.length > 0 ? `${message} 失败：${failed.slice(0, 3).join("；")}` : message);
      setNotice(`${message} 已打开的旧 Codex 窗口需要重新打开同一线程后才会读取瘦身后的 session。`);
      if (failed.length > 0) setHistoryError(`部分老线程瘦身失败：${failed.slice(0, 3).join("；")}`);
      const selected = selectedHistoryThreadId || succeeded[0] || null;
      if (selected) {
        const context = await window.docKnowledge.getCodexThreadContext({ threadId: selected, tokenBudget: 900 }).catch(() => null);
        if (context?.ok && context.result) setHistoryContextEnvelope(context.result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setNotice(`批量本体瘦身失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function oneClickOptimizeOldThreads() {
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryArchiveQueue(null);
    setHistoryOptimizeSummary(null);
    setHistoryOptimizeProgress({
      active: true,
      mode: "入库",
      label: "正在体检老线程",
      detail: "正在找出体积大、长时间未写入的历史线程。",
      current: 0,
      total: 0,
      indexed: 0,
      compacted: 0,
      queued: 0,
      failed: 0,
    });
    setNotice("正在入库并生成老线程瘦身候选：自动体检...");
    const indexed: string[] = [];
    const failed: string[] = [];
    const optimizedItemsForQueue: Record<string, CodexGuardianHistoryItem> = {};
    try {
      const triage = await window.docKnowledge.listLongCodexThreads({
        limit: 1000,
        tokenBudget: 900,
        minBytes: 8 * 1024 * 1024,
        minAgeMinutes: 30,
      });
      setLongThreadsLoaded(true);
      if (!triage.ok || !triage.result) {
        setHistoryError(triage.error || "Guardian 未返回长线程体检结果。");
        setNotice(`老线程入库与瘦身候选生成失败：${triage.error || "Guardian 未返回长线程体检结果"}`);
        return;
      }

      const items = triage.result.items || [];
      setHistoryEnvelope(triage.result);
      setSelectedHistoryThreadId(items[0]?.threadId || null);
      setHistoryContextEnvelope(null);
      setHistoryOptimizeProgress((current) =>
        current
          ? {
              ...current,
              label: items.length > 0 ? "正在写入历史保险库" : "体检完成",
              detail: items.length > 0 ? `发现 ${items.length} 条候选，开始逐条保存完整历史。` : "暂未发现超过阈值的老线程。",
              total: items.length,
            }
          : current,
      );
      if (items.length === 0) {
        setNotice("老线程体检完成：暂未发现超过阈值的老线程。");
        setHistoryOptimizeSummary("暂未发现超过阈值的老线程。");
        setHistoryOptimizeProgress((current) => (current ? { ...current, active: false, label: "体检完成", detail: "暂未发现超过阈值的老线程。" } : current));
        return;
      }

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setHistoryOptimizeProgress((current) =>
          current
            ? {
                ...current,
                label: `正在入库 ${index + 1}/${items.length}`,
                detail: `保存完整历史并生成检索摘要：${item.threadId}`,
                current: index,
                total: items.length,
                indexed: indexed.length,
                queued: 0,
                failed: failed.length,
              }
            : current,
        );
        setNotice(`老线程候选 ${index + 1}/${items.length}：先写入知匣历史库...`);
        const metadataOnly = /^stale_/.test(String(item.pressureReason || ""));
        const indexResult = await optimizeOneOldThread(item.threadId, index === 0, { metadataOnly });
        if (!indexResult.ok || !indexResult.result) {
          failed.push(`${item.threadId}: 入库失败：${indexResult.error || "未知错误"}`);
          setHistoryOptimizeProgress((current) => (current ? { ...current, failed: failed.length } : current));
          continue;
        }
        indexed.push(item.threadId);
        const optimizedItem = indexResult.result.items[0] || null;
        if (optimizedItem) {
          optimizedItemsForQueue[item.threadId] = {
            ...item,
            ...optimizedItem,
            optimized: indexResult.result.optimized,
            status: item.status || optimizedItem.status,
            archiveThreadRole: item.archiveThreadRole || optimizedItem.archiveThreadRole,
            sessionBytes: item.sessionBytes,
            sessionLastWriteTime: item.sessionLastWriteTime,
            sessionAgeMinutes: item.sessionAgeMinutes,
            pressureReason: item.pressureReason,
          };
        }
        setHistoryOptimizeProgress((current) =>
          current
            ? {
                ...current,
                current: index + 1,
                indexed: indexed.length,
                queued: 0,
                failed: failed.length,
              }
            : current,
        );
        setOptimizedHistoryThreadIds((current) => Array.from(new Set([...current, item.threadId])));
      }

      await loadRetrieveLogs().catch(() => {});
      setHistoryOptimizeProgress((current) =>
        current
          ? {
              ...current,
              label: "正在生成归档队列",
              detail: "知匣正在按 CEO 主线程、CEO 创建线程和未知线程的冷却规则生成归档队列。",
              current: items.length,
              indexed: indexed.length,
              failed: failed.length,
            }
          : current,
      );
      let archiveQueue: CodexThreadArchiveQueue | null = null;
      try {
        const archiveQueueItems = items.map((item) => optimizedItemsForQueue[item.threadId] || item);
        archiveQueue = await generateArchiveQueueForItems(archiveQueueItems, compactedHistoryReceipts);
      } catch (error) {
        failed.push(`归档队列: ${error instanceof Error ? error.message : String(error)}`);
        setHistoryError(`归档队列生成失败：${error instanceof Error ? error.message : String(error)}`);
      }
      const selected = selectedHistoryThreadId || indexed[0] || items[0]?.threadId || null;
      if (selected) {
        const context = await window.docKnowledge.getCodexThreadContext({ threadId: selected, tokenBudget: 900 }).catch(() => null);
        if (context?.ok && context.result) setHistoryContextEnvelope(context.result);
      }
      const candidateCount = Math.max(0, indexed.length);
      const archiveText = archiveQueue
        ? `生成归档队列 ${archiveQueue.readyCount} 条，自动跳过 ${archiveQueue.skippedCount} 条；`
        : "归档队列未生成；";
      const message = `老线程入库与瘦身候选生成完成：发现 ${items.length} 条，入库 ${indexed.length} 条，生成 ${candidateCount} 条瘦身候选；${archiveText}未执行本体瘦身。`;
      setHistoryOptimizeSummary(failed.length > 0 ? `${message} 失败：${failed.slice(0, 3).join("；")}` : message);
      setHistoryOptimizeProgress((current) =>
        current
          ? {
              ...current,
              active: false,
              label: "入库完成",
              detail: message,
              current: items.length,
              indexed: indexed.length,
              queued: archiveQueue?.readyCount || 0,
              failed: failed.length,
            }
          : current,
      );
      setNotice(`${message} 历史会留在知匣里供 CEO Flow 检索；需要进一步减负时再点“一键安全减负”或高级瘦身。`);
      if (failed.length > 0) setHistoryError(`部分老线程入库与瘦身候选生成失败：${failed.slice(0, 3).join("；")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setHistoryOptimizeProgress((current) => (current ? { ...current, active: false, label: "入库失败", detail: message } : current));
      setNotice(`老线程入库与瘦身候选生成失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function oneClickRelieveOldThreadPressure() {
    setHistoryBusy(true);
    setCodexGuardianBusy(true);
    setHistoryError(null);
    setHistoryArchiveQueue(null);
    setHistoryOptimizeSummary(null);
    setHistoryOptimizeProgress({
      active: true,
      mode: "安全减负",
      label: "正在清理运行日志",
      detail: "一键安全减负会先清理 Codex 巨型运行日志；请先关闭 Codex，避免日志库被占用。",
      current: 0,
      total: 0,
      indexed: 0,
      compacted: 0,
      queued: 0,
      failed: 0,
    });
    setNotice("正在安全减负：先清理 Codex 运行日志，再入库、瘦身和生成归档队列。");
    const indexed: string[] = [];
    const compacted: string[] = [];
    const imageProtected: string[] = [];
    const failed: string[] = [];
    const compactReceiptsForQueue: Record<string, CodexGuardianCompactReceipt> = {};
    const optimizedItemsForQueue: Record<string, CodexGuardianHistoryItem> = {};
    let archiveQueueGenerated = false;
    let archiveQueueReadyCount = 0;
    let archiveQueueSkippedCount = 0;
    let archiveQueueSkippedActiveCount = 0;
    let autoPreservedCount = 0;
    let autoAlreadyPreservedCount = 0;
    let autoActivePreservedCount = 0;
    let beforeTotal = 0;
    let afterTotal = 0;
    let logCleanupReceipt: CodexGuardianCleanReceipt | null = null;
    try {
      const logCleanup = await window.docKnowledge.cleanCodexHotLogs({ userConfirmed: true });
      setCodexGuardianStatus(logCleanup);
      if (!logCleanup.ok || !isCodexGuardianCleanReceipt(logCleanup.result)) {
        const message = logCleanup.refused
          ? "一键安全减负需要先清理 Codex 巨型运行日志。请关闭 Codex、codex 和 node_repl 进程后，再打开知匣点击“一键安全减负”。"
          : `一键安全减负前置日志清理失败：${logCleanup.error || "Guardian 未返回清理回执"}`;
        setHistoryError(message);
        setNotice(message);
        setHistoryOptimizeProgress((current) =>
          current
            ? {
                ...current,
                active: false,
                label: logCleanup.refused ? "需要先关闭 Codex" : "日志清理失败",
                detail: message,
                failed: current.failed + 1,
              }
            : current,
        );
        return;
      }
      logCleanupReceipt = logCleanup.result;
      setNotice(`Codex 运行日志清理完成：${summarizeCodexLogCleanup(logCleanupReceipt)}；继续入库和瘦身老线程。`);
      setHistoryOptimizeProgress((current) =>
        current
          ? {
              ...current,
              label: "正在体检老线程",
              detail: `${summarizeCodexLogCleanup(logCleanupReceipt)}，正在找出体积大、长时间未写入、可安全处理的历史线程。`,
            }
          : current,
      );
      setCodexGuardianBusy(false);
      const autoPreserve = await window.docKnowledge.autoIngestCodexHistory({
        limit: 1000,
        recentWriteMinutes: 60,
      }).catch(() => null);
      if (autoPreserve?.ok && autoPreserve.result) {
        autoPreservedCount = autoPreserve.result.preservedCount;
        autoAlreadyPreservedCount = autoPreserve.result.alreadyPreservedCount;
        autoActivePreservedCount = autoPreserve.result.activePreservedCount;
      }
      const triage = await window.docKnowledge.listLongCodexThreads({
        limit: 1000,
        tokenBudget: 900,
        minBytes: 8 * 1024 * 1024,
        minAgeMinutes: 30,
      });
      setLongThreadsLoaded(true);
      if (!triage.ok || !triage.result) {
        setHistoryError(triage.error || "Guardian 未返回长线程体检结果。");
        setNotice(`一键安全减负失败：${triage.error || "Guardian 未返回长线程体检结果"}`);
        return;
      }

      const items = triage.result.items || [];
      const archiveQueueBacklogItems = triage.result.archiveQueueItems || [];
      const backlog = triage.result.backlog || null;
      const backlogTotal = backlog?.totalCandidates ?? items.length;
      const incrementalTotal = backlog?.incrementalCandidateCount ?? items.length;
      const alreadyProcessed = backlog?.alreadyProcessedCount ?? Math.max(0, backlogTotal - incrementalTotal);
      const remainingAfterBatch = backlog?.remainingAfterBatch ?? 0;
      setHistoryEnvelope(triage.result);
      setSelectedHistoryThreadId(items[0]?.threadId || null);
      setHistoryContextEnvelope(null);
      setHistoryOptimizeProgress((current) =>
        current
          ? {
              ...current,
              label: items.length > 0 ? "正在处理增量线程" : "体检完成",
              detail: items.length > 0
                ? remainingAfterBatch > 0
                  ? `全量体检 ${backlogTotal} 条，其中 ${alreadyProcessed} 条已处理跳过；正在处理 ${items.length}/${incrementalTotal} 条增量，仍有 ${remainingAfterBatch} 条待处理。`
                  : `全量体检 ${backlogTotal} 条，其中 ${alreadyProcessed} 条已处理跳过；本次只处理 ${incrementalTotal} 条增量。`
                : `全量体检 ${backlogTotal} 条，其中 ${alreadyProcessed} 条已处理跳过；暂无新的入库/瘦身任务。`,
              total: incrementalTotal,
              backlogTotal,
              remaining: remainingAfterBatch,
              unvaulted: backlog?.unvaultedCount,
              vaulted: backlog?.vaultedCount,
            }
          : current,
      );
      if (items.length === 0) {
        if (archiveQueueBacklogItems.length > 0) {
          const archiveQueue = await generateArchiveQueueForItems(archiveQueueBacklogItems, compactedHistoryReceipts);
          const message = `增量体检完成：${summarizeCodexLogCleanup(logCleanupReceipt)}，自动保留 ${autoPreservedCount} 条，已保留 ${autoAlreadyPreservedCount + alreadyProcessed} 条，活跃跳过归档 ${autoActivePreservedCount + (archiveQueue.skippedActiveCount || 0)} 条，暂无新的入库/瘦身任务；已重新生成待宿主归档队列 ${archiveQueue.readyCount} 条，自动跳过 ${archiveQueue.skippedCount} 条。`;
          setNotice(`${message} 完整历史已保留在知匣；冷线程侧栏归档仍需要 Codex 宿主桥接消费队列。`);
          setHistoryOptimizeSummary(message);
          setHistoryOptimizeProgress((current) =>
            current
              ? {
                  ...current,
                  active: false,
                  label: "体检完成，已刷新归档队列",
                  detail: message,
                  queued: archiveQueue.readyCount,
                  total: incrementalTotal,
                  backlogTotal,
                }
              : current,
          );
          return;
        }
        const message = `增量体检完成：${summarizeCodexLogCleanup(logCleanupReceipt)}，自动保留 ${autoPreservedCount} 条，已保留 ${autoAlreadyPreservedCount + alreadyProcessed} 条，活跃跳过归档 ${autoActivePreservedCount} 条，暂无新的入库/瘦身任务。`;
        setNotice(message);
        setHistoryOptimizeSummary(message);
        setHistoryOptimizeProgress((current) => (current ? { ...current, active: false, label: "体检完成", detail: message, total: incrementalTotal, backlogTotal } : current));
        return;
      }

      const flushArchiveQueue = async (processedCount: number, finalFlush = false) => {
        if (processedCount <= 0 && archiveQueueBacklogItems.length === 0) return;
        const archiveQueueByThreadId = new Map<string, CodexGuardianHistoryItem>();
        for (const item of archiveQueueBacklogItems) archiveQueueByThreadId.set(item.threadId, item);
        for (const item of items.slice(0, processedCount).map((entry) => optimizedItemsForQueue[entry.threadId] || entry)) {
          archiveQueueByThreadId.set(item.threadId, item);
        }
        const archiveQueueItems = Array.from(archiveQueueByThreadId.values());
        const archiveQueue = await generateArchiveQueueForItems(archiveQueueItems, {
          ...compactedHistoryReceipts,
          ...compactReceiptsForQueue,
        });
        archiveQueueGenerated = true;
        archiveQueueReadyCount = archiveQueue.readyCount;
        archiveQueueSkippedCount = archiveQueue.skippedCount;
        archiveQueueSkippedActiveCount = archiveQueue.skippedActiveCount || 0;
        setHistoryOptimizeProgress((current) =>
          current
            ? {
                ...current,
                label: finalFlush ? (remainingAfterBatch > 0 ? "正在生成本批归档队列" : "正在生成归档队列") : `已落队列 ${processedCount}/${items.length}`,
                detail: finalFlush
                  ? remainingAfterBatch > 0
                    ? `知匣正在筛选本批 ${items.length} 条增量；仍有 ${remainingAfterBatch} 条等待后续批次。`
                    : `知匣正在筛选本次全部 ${items.length} 条增量，符合规则的会进入 Codex 宿主归档队列。`
                  : `已把前 ${processedCount} 条的安全证据写入归档队列；剩余线程继续后台处理。`,
                current: Math.min(incrementalTotal, processedCount),
                indexed: indexed.length,
                compacted: compacted.length,
                queued: archiveQueueReadyCount,
                failed: failed.length,
              }
            : current,
        );
      };

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setHistoryOptimizeProgress((current) =>
          current
            ? {
                ...current,
                label: `正在入库 ${index + 1}/${items.length}`,
                detail: `先保存完整历史保险库：${item.threadId}`,
                current: index,
                indexed: indexed.length,
                compacted: compacted.length,
                queued: 0,
                failed: failed.length,
              }
            : current,
        );
        setNotice(`安全减负 ${index + 1}/${items.length}：先写入完整历史保险库...`);
        const metadataOnly = /^stale_/.test(String(item.pressureReason || ""));
        const indexResult = await optimizeOneOldThread(item.threadId, index === 0, { metadataOnly });
        if (!indexResult.ok || !indexResult.result) {
          failed.push(`${item.threadId}: 入库失败：${indexResult.error || "未知错误"}`);
          setHistoryOptimizeProgress((current) => (current ? { ...current, failed: failed.length } : current));
          continue;
        }
        indexed.push(item.threadId);
        const optimizedItem = indexResult.result.items[0] || null;
        if (optimizedItem) {
          optimizedItemsForQueue[item.threadId] = {
            ...item,
            ...optimizedItem,
            optimized: indexResult.result.optimized,
            status: item.status || optimizedItem.status,
            archiveThreadRole: item.archiveThreadRole || optimizedItem.archiveThreadRole,
            sessionBytes: item.sessionBytes,
            sessionLastWriteTime: item.sessionLastWriteTime,
            sessionAgeMinutes: item.sessionAgeMinutes,
            pressureReason: item.pressureReason,
          };
        }
        setOptimizedHistoryThreadIds((current) => Array.from(new Set([...current, item.threadId])));

        const isCeoGovernedThread =
          item.archiveThreadRole === "ceo_thread" ||
          item.archiveThreadRole === "ceo_created_thread" ||
          item.archiveCandidate?.evidence?.archiveThreadRole === "ceo_thread" ||
          item.archiveCandidate?.evidence?.archiveThreadRole === "ceo_created_thread";
        const shouldCompact =
          isCeoGovernedThread ||
          item.pressureReason === "long_thread" ||
          item.pressureReason === "very_long_thread" ||
          (typeof item.sessionBytes === "number" && item.sessionBytes >= 8 * 1024 * 1024);
        if (!shouldCompact) {
          setHistoryOptimizeProgress((current) =>
            current
              ? {
                  ...current,
                  current: index + 1,
                  indexed: indexed.length,
                  compacted: compacted.length,
                  queued: 0,
                  failed: failed.length,
                }
              : current,
          );
          continue;
        }

        setHistoryOptimizeProgress((current) =>
          current
            ? {
                ...current,
                label: `正在瘦身 ${index + 1}/${items.length}`,
                detail: `保险库已完成，正在压缩 session 本体：${item.threadId}`,
                indexed: indexed.length,
                compacted: compacted.length,
                queued: 0,
                failed: failed.length,
              }
            : current,
        );
        setNotice(`安全减负 ${index + 1}/${items.length}：保险库完成，正在瘦身 session 本体...`);
        const compactResult = await window.docKnowledge.compactCodexThread({ threadId: item.threadId, userConfirmed: true });
        if (compactResult.ok && compactResult.result) {
          const receipt = compactResult.result;
          compacted.push(item.threadId);
          compactReceiptsForQueue[item.threadId] = receipt;
          beforeTotal += receipt.before_bytes;
          afterTotal += receipt.after_bytes;
          applyCompactReceipt(item.threadId, receipt);
          setHistoryOptimizeProgress((current) =>
            current
              ? {
                  ...current,
                  current: index + 1,
                  indexed: indexed.length,
                  compacted: compacted.length,
                  queued: 0,
                  failed: failed.length,
                }
              : current,
          );
        } else {
          const compactError = compactResult.error || "未知错误";
          if (/image attachment references|image_url|local image/i.test(compactError)) {
            imageProtected.push(item.threadId);
            setHistoryOptimizeProgress((current) =>
              current
                ? {
                    ...current,
                    current: index + 1,
                    indexed: indexed.length,
                    compacted: compacted.length,
                    queued: 0,
                    failed: failed.length,
                    detail: `检测到图片附件线程，已入库但跳过本体瘦身以保护图片引用：${item.threadId}`,
                  }
                : current,
            );
          } else {
            failed.push(`${item.threadId}: 瘦身失败：${compactError}`);
            setHistoryOptimizeProgress((current) => (current ? { ...current, failed: failed.length } : current));
          }
        }
        if ((index + 1) % 25 === 0) {
          try {
            await flushArchiveQueue(index + 1, false);
          } catch (error) {
            failed.push(`归档队列: ${error instanceof Error ? error.message : String(error)}`);
            setHistoryError(`阶段性归档队列生成失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      await loadRetrieveLogs().catch(() => {});
      setHistoryOptimizeProgress((current) =>
        current
          ? {
              ...current,
              label: remainingAfterBatch > 0 ? "正在生成本批归档队列" : "正在生成归档队列",
              detail:
                remainingAfterBatch > 0
                  ? `知匣正在筛选本批 ${items.length} 条增量；仍有 ${remainingAfterBatch} 条等待后续批次。`
                  : `知匣正在筛选本次全部 ${items.length} 条增量，符合规则的会进入 Codex 宿主归档队列。`,
              current: Math.min(incrementalTotal, items.length),
              indexed: indexed.length,
              compacted: compacted.length,
              failed: failed.length,
            }
          : current,
      );
      try {
        await flushArchiveQueue(items.length, true);
      } catch (error) {
        failed.push(`归档队列: ${error instanceof Error ? error.message : String(error)}`);
        setHistoryError(`归档队列生成失败：${error instanceof Error ? error.message : String(error)}`);
      }
      const selected = selectedHistoryThreadId || compacted[0] || indexed[0] || items[0]?.threadId || null;
      if (selected) {
        const context = await window.docKnowledge.getCodexThreadContext({ threadId: selected, tokenBudget: 900 }).catch(() => null);
        if (context?.ok && context.result) setHistoryContextEnvelope(context.result);
      }
      const saved = Math.max(0, beforeTotal - afterTotal);
      const archiveText = archiveQueueGenerated
        ? `生成归档队列 ${archiveQueueReadyCount} 条，自动跳过 ${archiveQueueSkippedCount} 条；`
        : "归档队列未生成；";
      const completionLabel = remainingAfterBatch > 0 ? "本批增量减负完成，仍有待处理" : "增量安全减负完成";
      const processedText = remainingAfterBatch > 0 ? `本批处理 ${items.length} 条增量` : `本次处理 ${items.length} 条增量`;
      const imageProtectedText = imageProtected.length > 0 ? `图片线程保护跳过瘦身 ${imageProtected.length} 条，` : "";
      const message = `${completionLabel}：${summarizeCodexLogCleanup(logCleanupReceipt)}，自动保留 ${autoPreservedCount} 条，已保留 ${autoAlreadyPreservedCount + alreadyProcessed} 条，活跃跳过归档 ${autoActivePreservedCount + archiveQueueSkippedActiveCount} 条，增量待处理 ${incrementalTotal} 条，${processedText}，入库 ${indexed.length} 条，大线程瘦身 ${compacted.length} 条，${imageProtectedText}${archiveText}剩余 ${remainingAfterBatch} 条；释放 ${formatBytes(saved)}。`;
      setHistoryOptimizeSummary(failed.length > 0 ? `${message} 失败：${failed.slice(0, 3).join("；")}` : message);
      setHistoryOptimizeProgress((current) =>
        current
          ? {
              ...current,
              active: false,
              label: completionLabel,
              detail: message,
              current: Math.min(incrementalTotal, items.length),
              indexed: indexed.length,
              compacted: compacted.length,
              queued: archiveQueueReadyCount,
              failed: failed.length,
              remaining: remainingAfterBatch,
              backlogTotal,
            }
          : current,
      );
      setNotice(`${message} 完整历史已保留在知匣；冷线程侧栏归档仍需要 Codex 宿主桥接消费队列。`);
      if (failed.length > 0) setHistoryError(`部分老线程安全减负失败：${failed.slice(0, 3).join("；")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setHistoryOptimizeProgress((current) => (current ? { ...current, active: false, label: "安全减负失败", detail: message } : current));
      setNotice(`一键安全减负失败：${message}`);
    } finally {
      setHistoryBusy(false);
      setCodexGuardianBusy(false);
    }
  }

  async function copyThreadContinuationPacket(item: CodexGuardianHistoryItem | null, showNotice = true) {
    if (!item) {
      setHistoryError("还没有可复制的老线程优化摘要。");
      return;
    }
    const text = buildOldThreadOptimizationText(item);
    try {
      await navigator.clipboard.writeText(text);
      if (showNotice) setNotice("老线程优化摘要已复制。");
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.setAttribute("readonly", "true");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (copied) {
        if (showNotice) setNotice("老线程优化摘要已复制。");
      } else {
        setHistoryError("老线程优化摘要复制失败，请手动选中下方内容复制。");
      }
    }
  }

  async function generateThreadRecoveryPacket(item: CodexGuardianHistoryItem | null = selectedHistoryItem) {
    if (!item) {
      setHistoryError("请先选择一条历史线程。");
      return;
    }
    setHistoryBusy(true);
    setHistoryError(null);
    setNotice("正在生成旧线程接续包...");
    try {
      const packet = await window.docKnowledge.recoverMemoryRuntimeThread({
        threadId: item.threadId,
        title: historyDisplayTitle(item, 120),
        query: [historyQuery, item.summary, item.provenance?.projectRoot].filter(Boolean).join(" "),
        projectPath: item.provenance?.projectRoot || effectiveProjectPath || null,
        tokenBudget: 1800,
        maxResults: 10,
      });
      setThreadRecoveryPacket(packet);
      setNotice("旧线程接续包已生成；新线程可先读取 prompt 和推荐文档，不会默认读取 raw session。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(`旧线程接续包生成失败：${message}`);
      setNotice(`旧线程接续包生成失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function copyThreadRecoveryPacket(packet: ThreadRecoveryPacket | null = threadRecoveryPacket) {
    if (!packet) {
      setHistoryError("还没有可复制的旧线程接续包。");
      return;
    }
    const text = JSON.stringify(packet, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setNotice("旧线程接续包已复制。");
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.setAttribute("readonly", "true");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (copied) setNotice("旧线程接续包已复制。");
      else setHistoryError("旧线程接续包复制失败，请手动选中下方内容复制。");
    }
  }

  async function loadProjectOldThreads() {
    if (!effectiveProjectPath) {
      setHistoryError("当前没有识别项目路径，无法按项目检索历史线程。");
      return;
    }
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryArchiveQueue(null);
    setNotice("正在按当前项目检索老线程...");
    try {
      const result = await window.docKnowledge.getCodexProjectHistory({
        projectPath: effectiveProjectPath,
        limit: 8,
        tokenBudget: 900,
      });
      if (result.ok && result.result) {
        setHistoryEnvelope(result.result);
        setSelectedHistoryThreadId(result.result.items[0]?.threadId || null);
        setHistoryContextEnvelope(null);
        setNotice(`当前项目历史检索完成：命中 ${result.result.items.length} 条。`);
      } else {
        setHistoryError(result.error || "Guardian 未返回项目历史。");
        setNotice(`项目历史检索失败：${result.error || "Guardian 未返回项目历史"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHistoryError(message);
      setNotice(`项目历史检索失败：${message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function updateDocumentById(documentId: string, patch: Partial<Pick<KnowledgeDocument, "title" | "tags" | "favorite">>) {
    const result = await window.docKnowledge.updateDocument(documentId, patch);
    setDocuments(result.documents);
  }

  async function updateSelected(patch: Partial<Pick<KnowledgeDocument, "title" | "tags" | "favorite">>) {
    const selectedDocument = selected;
    if (!selectedDocument) return;
    await updateDocumentById(selectedDocument.id, patch);
  }

  async function deleteDocumentRecord(selectedDocument: KnowledgeDocument) {
    const result = await window.docKnowledge.deleteDocument(selectedDocument.id);
    setDocuments(result.documents);
    setSelectedId(result.documents[0]?.id || null);
    setNotice(`已删除记录：${selectedDocument.title}`);
  }

  async function deleteSelected() {
    const selectedDocument = selected;
    if (!selectedDocument) return;
    await deleteDocumentRecord(selectedDocument);
  }

  async function exportMetadata() {
    const result = await window.docKnowledge.exportMetadata();
    if (result.exported) setNotice(`已导出：${result.filePath}`);
  }

  function addTag() {
    const selectedDocument = selected;
    if (!selectedDocument) return;
    const next = tagDraft.trim();
    if (!next || selectedDocument.tags.includes(next)) {
      setTagDraft("");
      return;
    }
    updateSelected({ tags: [...selectedDocument.tags, next] });
    setTagDraft("");
  }

  function removeTag(tag: string) {
    const selectedDocument = selected;
    if (!selectedDocument) return;
    updateSelected({ tags: selectedDocument.tags.filter((item) => item !== tag) });
  }

  function openProject(projectPath: string | null) {
    setActiveProject(projectPath);
    setView("project");
    setProjectTab("overview");
    setDocFilter("project");
    setActiveTag(null);
    if (!projectPath) return;
    const firstProjectDocument = documents
      .filter((doc) => doc.workspacePath === projectPath)
      .sort((a, b) => documentSortValue(a) - documentSortValue(b))[0];
    if (firstProjectDocument) setSelectedId(firstProjectDocument.id);
  }

  function handleGlobalSearchSubmit() {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setNotice("输入项目名、线程名或关键词后再搜索。");
      return;
    }
    setView("project");
    setActiveProject(null);
    setProjectTab("overview");
    const resultText = `${projectCards.length} 个项目，${projectLeads.length} 条待整理线索`;
    setNotice(`正在按“${clipText(cleanQuery, 40)}”筛选：命中 ${resultText}。`);
    if (projectCards.length === 1 && projectLeads.length === 0) {
      openProject(projectCards[0].project.path);
    }
  }

  function clearGlobalSearch() {
    setQuery("");
    setNotice("已清空搜索，恢复项目列表。");
  }

  function handleExportMemoryPackage() {
    if (!selected) {
      setNotice("导出记忆包前，请先在“历史”页或项目历史标签里选中一份来源。");
      return;
    }
    exportCodexContext();
  }

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      for (const tag of doc.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [documents]);

  const projects = useMemo(() => {
    const map = new Map<
      string,
      {
        path: string;
        name: string;
        count: number;
        updatedAt: string;
        codexCount: number;
        activeCount: number;
        reviewCount: number;
        staleCount: number;
      }
    >();
    for (const doc of documents) {
      if (!doc.workspacePath) continue;
      const lifecycle = getDocumentLifecycle(doc);
      const current = map.get(doc.workspacePath) || {
        path: doc.workspacePath,
        name: projectName(doc.workspacePath),
        count: 0,
        updatedAt: doc.updatedAt,
        codexCount: 0,
        activeCount: 0,
        reviewCount: 0,
        staleCount: 0,
      };
      current.count += 1;
      if (["codex_context", "codex_output"].includes(doc.sourceType || "")) current.codexCount += 1;
      if (lifecycle.tone === "teal") current.activeCount += 1;
      if (lifecycle.tone === "amber") current.reviewCount += 1;
      if (lifecycle.tone === "red") current.staleCount += 1;
      if (new Date(doc.updatedAt).getTime() > new Date(current.updatedAt).getTime()) current.updatedAt = doc.updatedAt;
      map.set(doc.workspacePath, current);
    }
    for (const item of knowledgeItems) {
      if (!item.projectPath) continue;
      const current = map.get(item.projectPath) || {
        path: item.projectPath,
        name: projectName(item.projectPath),
        count: 0,
        updatedAt: item.updatedAt,
        codexCount: 0,
        activeCount: 0,
        reviewCount: 0,
        staleCount: 0,
      };
      current.count += 1;
      if (item.provider === "codex_guardian" || item.tags.includes("codex-history")) current.codexCount += 2;
      if (item.status === "ready") current.activeCount += 1;
      if (new Date(item.updatedAt).getTime() > new Date(current.updatedAt).getTime()) current.updatedAt = item.updatedAt;
      map.set(item.projectPath, current);
    }
    for (const item of experienceCards) {
      if (!item.projectPath) continue;
      const current = map.get(item.projectPath) || {
        path: item.projectPath,
        name: projectName(item.projectPath),
        count: 0,
        updatedAt: item.updatedAt,
        codexCount: 0,
        activeCount: 0,
        reviewCount: 0,
        staleCount: 0,
      };
      current.count += 1;
      if (item.status === "accepted" || item.status === "curated") current.activeCount += 1;
      if (item.status === "candidate") current.reviewCount += 1;
      if (new Date(item.updatedAt).getTime() > new Date(current.updatedAt).getTime()) current.updatedAt = item.updatedAt;
      map.set(item.projectPath, current);
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [documents, experienceCards, knowledgeItems]);

  const projectMemoryByPath = useMemo(() => {
    const map = new Map<string, { experienceCards: number; skillCandidates: number; knowledgeItems: number }>();
    for (const project of memoryOverview?.projects || []) {
      map.set(project.projectPath, {
        experienceCards: project.experienceCards,
        skillCandidates: project.skillCandidates,
        knowledgeItems: 0,
      });
    }
    for (const project of knowledgeOverview?.projects || []) {
      const current = map.get(project.projectPath) || { experienceCards: 0, skillCandidates: 0, knowledgeItems: 0 };
      current.knowledgeItems = project.knowledgeItems;
      map.set(project.projectPath, current);
    }
    return map;
  }, [knowledgeOverview, memoryOverview]);

  const projectKnowledgeByPath = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>();
    for (const item of knowledgeItems) {
      if (!item.projectPath) continue;
      const list = map.get(item.projectPath) || [];
      list.push(item);
      map.set(item.projectPath, list);
    }
    return map;
  }, [knowledgeItems]);

  const projectExperienceByPath = useMemo(() => {
    const map = new Map<string, ExperienceCard[]>();
    for (const item of experienceCards) {
      if (!item.projectPath) continue;
      const list = map.get(item.projectPath) || [];
      list.push(item);
      map.set(item.projectPath, list);
    }
    return map;
  }, [experienceCards]);

  const documentsByProject = useMemo(() => {
    const map = new Map<string, KnowledgeDocument[]>();
    for (const doc of documents) {
      if (!doc.workspacePath) continue;
      const list = map.get(doc.workspacePath) || [];
      list.push(doc);
      map.set(doc.workspacePath, list);
    }
    return map;
  }, [documents]);

  const projectCards = useMemo(() => {
    const searchText = query.trim();
    return projects
      .map((project) => {
        const projectDocs = documentsByProject.get(project.path) || [];
        const projectMemory = projectMemoryByPath.get(project.path);
        const projectKnowledge = projectKnowledgeByPath.get(project.path) || [];
        const projectExperience = projectExperienceByPath.get(project.path) || [];
        const classification = classifyProjectCandidate(project, projectDocs, projectMemory, projectKnowledge);
        const displayName = readableProjectDisplayName(project.path, projectDocs);
        const summary = projectCardSummaryText(project.path, projectDocs, projectMemory, projectKnowledge);
        const searchScore = searchText
          ? scoreTextBlock(
              displayName,
              [
                project.path,
                project.name,
                summary,
                classification.reasons.join(" "),
                projectDocs.slice(0, 18).map((doc) => `${doc.title} ${doc.summary} ${doc.fileName} ${doc.tags.join(" ")}`).join(" "),
                projectKnowledge.slice(0, 12).map((item) => `${item.title} ${item.summary} ${item.body} ${item.tags.join(" ")}`).join(" "),
                projectExperience.slice(0, 12).map((item) => `${item.title} ${item.summary} ${item.body} ${item.tags.join(" ")}`).join(" "),
              ].join(" "),
              searchText,
              0,
            )
          : 0;
        return {
          project,
          projectDocs,
          projectMemory,
          projectKnowledge,
          classification,
          searchScore,
          activityScore: projectActivityScore(project, projectDocs, projectMemory),
        };
      })
      .filter((item) => item.classification.kind === "project")
      .filter((item) => !searchText || item.searchScore > 0)
      .sort((a, b) => {
        if (searchText && b.searchScore !== a.searchScore) return b.searchScore - a.searchScore;
        return b.activityScore - a.activityScore || new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime();
      });
  }, [documentsByProject, projectExperienceByPath, projectKnowledgeByPath, projectMemoryByPath, projects, query]);

  const projectLeads = useMemo(() => {
    const searchText = query.trim();
    return projects
      .map((project) => {
        const projectDocs = documentsByProject.get(project.path) || [];
        const projectMemory = projectMemoryByPath.get(project.path);
        const projectKnowledge = projectKnowledgeByPath.get(project.path) || [];
        const projectExperience = projectExperienceByPath.get(project.path) || [];
        const classification = classifyProjectCandidate(project, projectDocs, projectMemory, projectKnowledge);
        const searchScore = searchText
          ? scoreTextBlock(
              readableProjectDisplayName(project.path, projectDocs),
              [
                project.path,
                project.name,
                classification.reasons.join(" "),
                projectDocs.slice(0, 12).map((doc) => `${doc.title} ${doc.summary} ${doc.fileName} ${doc.tags.join(" ")}`).join(" "),
                projectKnowledge.slice(0, 8).map((item) => `${item.title} ${item.summary} ${item.body}`).join(" "),
                projectExperience.slice(0, 8).map((item) => `${item.title} ${item.summary} ${item.body}`).join(" "),
              ].join(" "),
              searchText,
              0,
            )
          : 0;
        return { project, projectDocs, projectMemory, projectKnowledge, classification, searchScore };
      })
      .filter((item) => item.classification.kind === "lead")
      .filter((item) => !searchText || item.searchScore > 0)
      .sort((a, b) => {
        if (searchText && b.searchScore !== a.searchScore) return b.searchScore - a.searchScore;
        return b.classification.confidence - a.classification.confidence || new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime();
      })
      .slice(0, 8);
  }, [documentsByProject, projectExperienceByPath, projectKnowledgeByPath, projectMemoryByPath, projects, query]);

  const effectiveProjectPath = activeProject || projectCards[0]?.project.path || null;

  const activeProjectInfo = useMemo(
    () => projects.find((project) => project.path === effectiveProjectPath) || null,
    [effectiveProjectPath, projects],
  );

  useEffect(() => {
    if (view !== "project" || !activeProject || projectMemoryCoreStartedRef.current.has(activeProject)) return;
    const projectPath = activeProject;
    projectMemoryCoreStartedRef.current.add(projectPath);
    setProjectMemoryCoreLoadingPaths((current) => (current.includes(projectPath) ? current : [...current, projectPath]));

    Promise.allSettled([
      window.docKnowledge.getMemoryCoreDiagnostics({ projectPath }),
      window.docKnowledge.getMemoryCoreContinuityStatus({
        projectPath,
        projectName: projectName(projectPath),
        tokenBudget: 1800,
        maxPacketItems: 24,
        maxPacketChars: 10000,
      }),
      window.docKnowledge.getProjectContinuity({
        projectPath,
        projectName: projectName(projectPath),
        taskGoal: "查看当前项目的身份、来源锚点和续接状态",
        tokenBudget: 1800,
        maxPacketItems: 24,
        maxPacketChars: 10000,
      }),
      window.docKnowledge.listMemoryCoreReviewQueue({ projectPath, limit: 8 }),
    ]).then((results) => {
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => String((result as PromiseRejectedResult).reason || "项目记忆读取失败"));
      setProjectMemoryCoreByPath((current) => ({
        ...current,
        [projectPath]: {
          diagnostics: results[0].status === "fulfilled" ? results[0].value : null,
          continuityStatus: results[1].status === "fulfilled" ? results[1].value : null,
          continuityPage: results[2].status === "fulfilled" ? results[2].value : null,
          reviewQueue: results[3].status === "fulfilled" ? results[3].value : null,
          errors,
        },
      }));
    }).finally(() => {
      setProjectMemoryCoreLoadingPaths((current) => current.filter((item) => item !== projectPath));
    });
  }, [activeProject, view]);

  useEffect(() => {
    if (view !== "project" || projectTab !== "memory" || !activeProject || projectMemoryRecallStartedRef.current.has(activeProject)) return;
    const projectPath = activeProject;
    const coreState = projectMemoryCoreByPath[projectPath];
    if (!coreState?.diagnostics?.privateStateReady || !coreState.diagnostics.sidecarReady) return;
    projectMemoryRecallStartedRef.current.add(projectPath);
    setProjectMemoryRecallLoadingPaths((current) => (current.includes(projectPath) ? current : [...current, projectPath]));
    window.docKnowledge.retrieveMemoryRuntimeContext({
      projectPath,
      taskGoal: "说明当前项目记忆为什么会被想起",
      query: "当前目标 项目身份 架构约束 已验收进展 未完成任务 下一步",
      queryType: "project_resume",
      maxResults: 4,
      tokenBudget: 700,
    }).then((packet) => {
      setProjectMemoryRecallByPath((current) => ({ ...current, [projectPath]: packet }));
    }).catch(() => {
      setProjectMemoryRecallErrors((current) => ({ ...current, [projectPath]: true }));
    }).finally(() => {
      setProjectMemoryRecallLoadingPaths((current) => current.filter((item) => item !== projectPath));
    });
  }, [activeProject, projectMemoryCoreByPath, projectTab, view]);

  useEffect(() => {
    loadToolSkillInventory(effectiveProjectPath).catch(() => {
      setToolSkillInventory(null);
      setToolSkillInventoryError("Tool/Skill inventory 读取失败。");
    });
  }, [effectiveProjectPath]);

  const activeProjectMemory = effectiveProjectPath ? projectMemoryByPath.get(effectiveProjectPath) : null;

  const projectDocuments = useMemo(
    () => (effectiveProjectPath ? documentsByProject.get(effectiveProjectPath) || [] : documents),
    [documents, documentsByProject, effectiveProjectPath],
  );

  const personalVaultProject = useMemo(
    () => projects.find((project) => project.name === "个人知识库") || null,
    [projects],
  );

  const personalVaultDocuments = useMemo(
    () => documents.filter(isPersonalKnowledgeDocument),
    [documents],
  );

  const personalVaultPath =
    personalVaultProject?.path || personalVaultDocuments.find((doc) => doc.workspacePath)?.workspacePath || "C:\\Users\\example\\Documents\\个人知识库";

  const vaultCounts = useMemo(() => {
    const counts: Record<VaultSectionKey, number> = {
      inbox: 0,
      notes: 0,
      maps: 0,
      sources: 0,
      docs: 0,
      other: 0,
    };
    for (const doc of personalVaultDocuments) counts[vaultSectionFromPath(vaultRelativePath(doc))] += 1;
    return counts;
  }, [personalVaultDocuments]);

  const vaultDocumentCards = useMemo<VaultDocumentCard[]>(() => {
    return personalVaultDocuments
      .map((doc) => {
        const vaultPath = vaultRelativePath(doc);
        return {
          ...doc,
          vaultPath,
          vaultSection: vaultSectionFromPath(vaultPath),
          displayTitle: personalVaultTitle(doc),
          displaySummary: personalVaultSummary(doc),
          score: scoreDocument(doc, query),
          snippet: makeSnippet(doc, query),
        };
      })
      .filter((doc) => doc.vaultSection === vaultSection)
      .filter((doc) => !activeTag || doc.tags.includes(activeTag))
      .filter((doc) => !query.trim() || doc.score > 0)
      .sort((a, b) => {
        if (query.trim() && b.score !== a.score) return b.score - a.score;
        return new Date(b.updatedAt || b.importedAt).getTime() - new Date(a.updatedAt || a.importedAt).getTime();
      });
  }, [activeTag, personalVaultDocuments, query, vaultSection]);

  const projectRecordSourceSignature = useMemo(
    () => buildProjectRecordSourceSignature(effectiveProjectPath, projectDocuments),
    [effectiveProjectPath, projectDocuments],
  );

  const projectKnowledgeItems = useMemo(
    () => (effectiveProjectPath ? knowledgeItems.filter((item) => item.projectPath === effectiveProjectPath) : knowledgeItems),
    [effectiveProjectPath, knowledgeItems],
  );

  const projectExperienceCards = useMemo(
    () => (effectiveProjectPath ? experienceCards.filter((item) => item.projectPath === effectiveProjectPath) : experienceCards),
    [effectiveProjectPath, experienceCards],
  );

  const projectSkillCandidates = useMemo(
    () => (effectiveProjectPath ? skillCandidates.filter((item) => item.projectPath === effectiveProjectPath) : skillCandidates),
    [effectiveProjectPath, skillCandidates],
  );

  const selectedSkillCandidate = useMemo(
    () =>
      projectSkillCandidates.find((candidate) => candidate.id === selectedSkillCandidateId) ||
      skillCandidates.find((candidate) => candidate.id === selectedSkillCandidateId) ||
      projectSkillCandidates[0] ||
      skillCandidates[0] ||
      null,
    [projectSkillCandidates, selectedSkillCandidateId, skillCandidates],
  );

  const selectedKnowledgeItem = useMemo(
    () =>
      projectKnowledgeItems.find((item) => item.id === selectedKnowledgeId) ||
      knowledgeItems.find((item) => item.id === selectedKnowledgeId) ||
      projectKnowledgeItems[0] ||
      knowledgeItems[0] ||
      null,
    [knowledgeItems, projectKnowledgeItems, selectedKnowledgeId],
  );

  const selectedExperienceCard = useMemo(
    () =>
      projectExperienceCards.find((item) => item.id === selectedExperienceId) ||
      experienceCards.find((item) => item.id === selectedExperienceId) ||
      projectExperienceCards[0] ||
      experienceCards[0] ||
      null,
    [experienceCards, projectExperienceCards, selectedExperienceId],
  );

  const hasSavedAiKey = settings.aiProviderApiKey === "••••••••";

  const documentCards = useMemo<ScoredDocument[]>(() => {
    const scopedDocuments = docFilter === "project" && effectiveProjectPath ? projectDocuments : documents;
    return scopedDocuments
      .filter((doc) => {
        if (docFilter === "favorite" && !doc.favorite) return false;
        if (docFilter === "failed" && doc.parseStatus !== "failed") return false;
        if (docFilter === "recent" && !isRecentDocument(doc)) return false;
        if (docFilter === "codex" && !["workspace_file", "codex_context", "codex_output"].includes(doc.sourceType || "")) {
          return false;
        }
        if (activeTag && !doc.tags.includes(activeTag)) return false;
        return true;
      })
      .map((doc) => ({
        ...doc,
        score: scoreDocument(doc, query),
        snippet: makeSnippet(doc, query),
      }))
      .filter((doc) => !query.trim() || doc.score > 0)
      .sort((a, b) => {
        if (query.trim() && b.score !== a.score) return b.score - a.score;
        if (docFilter === "project") {
          const artifact = documentSortValue(a) - documentSortValue(b);
          if (artifact !== 0) return artifact;
        }
        return new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime();
      });
  }, [activeTag, docFilter, documents, effectiveProjectPath, projectDocuments, query]);

  const projectDocumentCards = useMemo<ScoredDocument[]>(() => {
    return projectDocuments
      .map((doc) => ({
        ...doc,
        score: scoreDocument(doc, query),
        snippet: makeSnippet(doc, query),
      }))
      .filter((doc) => !activeTag || doc.tags.includes(activeTag))
      .filter((doc) => !query.trim() || doc.score > 0)
      .sort((a, b) => {
        if (query.trim() && b.score !== a.score) return b.score - a.score;
        const artifact = documentSortValue(a) - documentSortValue(b);
        if (artifact !== 0) return artifact;
        return new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime();
      });
  }, [activeTag, projectDocuments, query]);

  const selected = useMemo(
    () =>
      documentCards.find((doc) => doc.id === selectedId) ||
      projectDocumentCards.find((doc) => doc.id === selectedId) ||
      documents.find((doc) => doc.id === selectedId) ||
      projectDocumentCards[0] ||
      documentCards[0] ||
      documents[0] ||
      null,
    [documentCards, documents, projectDocumentCards, selectedId],
  );

  const selectedVaultDocument = useMemo(
    () =>
      vaultDocumentCards.find((doc) => doc.id === selectedId) ||
      vaultDocumentCards[0] ||
      personalVaultDocuments.find((doc) => doc.id === selectedId) ||
      personalVaultDocuments[0] ||
      null,
    [personalVaultDocuments, selectedId, vaultDocumentCards],
  );

  useEffect(() => {
    if (isProjectResumeDocument(selected)) {
      setResumeDraft(selected.contentText || "");
    } else {
      setResumeDraft("");
    }
  }, [selected?.id, selected?.contentHash, selected?.updatedAt]);

  const filteredKnowledgeItems = useMemo(() => {
    const source = view === "project" ? projectKnowledgeItems : knowledgeItems;
    return source
      .map((item) => ({
        ...item,
        score: scoreTextBlock(item.title, `${item.summary} ${item.body} ${item.tags.join(" ")}`, query, item.status === "ready" ? 12 : 8),
      }))
      .filter((item) => !query.trim() || item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [knowledgeItems, projectKnowledgeItems, query, view]);

  const filteredExperienceCards = useMemo(() => {
    const source = view === "project" ? projectExperienceCards : experienceCards;
    return source
      .map((item) => ({
        ...item,
        score: scoreTextBlock(item.title, `${item.summary} ${item.body} ${item.tags.join(" ")}`, query, item.status === "curated" ? 14 : 8),
      }))
      .filter((item) => !query.trim() || item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [experienceCards, projectExperienceCards, query, view]);

  const knowledgeProjectGroups = useMemo(() => {
    const map = new Map<string, { projectPath: string | null; projectName: string; items: typeof filteredKnowledgeItems }>();
    for (const item of filteredKnowledgeItems) {
      const key = item.projectPath || "__global__";
      const current = map.get(key) || {
        projectPath: item.projectPath || null,
        projectName: projectLabel(item.projectPath),
        items: [] as typeof filteredKnowledgeItems,
      };
      current.items.push(item);
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.projectPath === effectiveProjectPath) return -1;
      if (b.projectPath === effectiveProjectPath) return 1;
      return a.projectName.localeCompare(b.projectName, "zh-CN");
    });
  }, [effectiveProjectPath, filteredKnowledgeItems]);

  const memoryProjectGroups = useMemo(() => {
    const map = new Map<string, { projectPath: string | null; projectName: string; items: typeof filteredExperienceCards }>();
    for (const item of filteredExperienceCards) {
      const key = item.projectPath || "__global__";
      const current = map.get(key) || {
        projectPath: item.projectPath || null,
        projectName: projectLabel(item.projectPath),
        items: [] as typeof filteredExperienceCards,
      };
      current.items.push(item);
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.projectPath === effectiveProjectPath) return -1;
      if (b.projectPath === effectiveProjectPath) return 1;
      return a.projectName.localeCompare(b.projectName, "zh-CN");
    });
  }, [effectiveProjectPath, filteredExperienceCards]);

  const memoryWritebackQueue = useMemo<MemoryWritebackQueueItem[]>(() => {
    const experienceQueue = experienceCards
      .filter((item) => item.status === "candidate")
      .map((item) => ({
        id: item.id,
        kind: "experience_card" as const,
        title: item.title,
        summary: item.summary || item.body || "待人工确认的经验记忆。",
        projectPath: item.projectPath,
        sourcePath: item.sourcePath,
        sourceType: item.sourceType,
        status: item.status,
        suggestedAction: "确认或精选后，才作为可依赖的项目记忆。",
        risk: "候选记忆尚未确认，当前不应视为 authoritative memory。",
        updatedAt: item.updatedAt,
      }));
    const skillQueue = skillCandidates
      .filter((item) => item.status === "draft")
      .map((item) => ({
        id: item.id,
        kind: "skill_candidate" as const,
        title: item.title,
        summary: item.triggerPatterns.slice(0, 3).join(" · ") || "待人工审核的 Skill 草稿。",
        projectPath: item.projectPath,
        sourcePath: item.evidence?.sourcePaths?.[0] || null,
        sourceType: "skill_candidate" as const,
        status: item.status,
        suggestedAction: "批准后仍只是已批准草稿，不会自动安装。",
        risk: "Skill 候选仍是草稿，触发词和证据需人工确认。",
        updatedAt: item.updatedAt,
      }));
    return [...experienceQueue, ...skillQueue].sort((a, b) => {
      const projectBiasA = a.projectPath && a.projectPath === effectiveProjectPath ? 1 : 0;
      const projectBiasB = b.projectPath && b.projectPath === effectiveProjectPath ? 1 : 0;
      if (projectBiasB !== projectBiasA) return projectBiasB - projectBiasA;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [effectiveProjectPath, experienceCards, skillCandidates]);

  const projectDocCandidateCount = useMemo(
    () => filteredExperienceCards.filter((item) => item.status === "candidate" && item.sourceType === "project_doc").length,
    [filteredExperienceCards],
  );

  const stats = useMemo(() => {
    const failed = documents.filter((doc) => doc.parseStatus === "failed").length;
    const favorites = documents.filter((doc) => doc.favorite).length;
    const duplicates = documents.filter((doc) => doc.duplicateOf).length;
    const codex = documents.filter((doc) =>
      ["workspace_file", "codex_context", "codex_output"].includes(doc.sourceType || ""),
    ).length;
    const indexedChars = documents.reduce((sum, doc) => sum + (doc.contentLength ?? doc.contentText.length), 0);
    return { total: documents.length, failed, favorites, duplicates, codex, indexedChars };
  }, [documents]);

  const projectStatus = useMemo(() => {
    const activeCount = projectDocuments.filter((doc) => getDocumentLifecycle(doc).tone === "teal").length;
    const reviewCount =
      projectDocuments.filter((doc) => getDocumentLifecycle(doc).tone === "amber").length +
      projectKnowledgeItems.filter((item) => item.status !== "ready").length +
      projectSkillCandidates.filter((item) => item.status === "draft").length;
    const staleCount = projectDocuments.filter((doc) => getDocumentLifecycle(doc).tone === "red").length;
    const sourceChangedCount = projectDocuments.filter((doc) => isSourceChanged(doc)).length;
    const duplicateTruthCount = projectDocuments.filter((doc) => Boolean(doc.duplicateOf)).length;
    const aiSummaryCandidateCount =
      projectKnowledgeItems.filter((item) => item.provider !== "human" && item.status !== "ready").length ||
      (projectKnowledgeItems.length === 0 ? Math.min(projectDocuments.length, 3) : 0);
    return {
      activeCount,
      reviewCount,
      staleCount,
      sourceChangedCount,
      duplicateTruthCount,
      aiSummaryCandidateCount,
      lastScannedAt: watchStatus?.lastRunAt || activeProjectInfo?.updatedAt || null,
    };
  }, [activeProjectInfo?.updatedAt, projectDocuments, projectKnowledgeItems, projectSkillCandidates, watchStatus?.lastRunAt]);

  const projectTitle = effectiveProjectPath ? readableProjectDisplayName(effectiveProjectPath, projectDocuments) : "知匣项目知识库";
  const projectMemoryCoreSnapshot = effectiveProjectPath ? projectMemoryCoreByPath[effectiveProjectPath] || null : null;
  const projectMemoryCoreLoading = Boolean(effectiveProjectPath && projectMemoryCoreLoadingPaths.includes(effectiveProjectPath));
  const projectMemoryRecallPacket = effectiveProjectPath ? projectMemoryRecallByPath[effectiveProjectPath] || null : null;
  const projectMemoryRecallLoading = Boolean(effectiveProjectPath && projectMemoryRecallLoadingPaths.includes(effectiveProjectPath));
  const projectMemoryRecallError = Boolean(effectiveProjectPath && projectMemoryRecallErrors[effectiveProjectPath]);
  const projectMemoryCoreInitialized = Boolean(
    projectMemoryCoreSnapshot?.diagnostics?.initialized ??
      (projectMemoryCoreSnapshot?.diagnostics?.privateStateReady && projectMemoryCoreSnapshot?.diagnostics?.sidecarReady) ??
      projectMemoryCoreSnapshot?.continuityPage?.continuityPacket,
  );
  const projectContinuityPacket = projectMemoryCoreSnapshot?.continuityPage?.continuityPacket || null;
  const projectContinuityCoverageRaw =
    projectMemoryCoreSnapshot?.continuityStatus?.coverage ?? projectContinuityPacket?.continuity.coverage ?? 0;
  const projectContinuityCoverage = Math.max(
    0,
    Math.min(100, Math.round(projectContinuityCoverageRaw <= 1 ? projectContinuityCoverageRaw * 100 : projectContinuityCoverageRaw)),
  );
  const projectContinuityMissing =
    projectMemoryCoreSnapshot?.continuityStatus?.missingSlots || projectMemoryCoreSnapshot?.continuityPage?.missing || [];
  const projectContinuityStale =
    projectMemoryCoreSnapshot?.continuityStatus?.staleSlots || projectMemoryCoreSnapshot?.continuityPage?.stale || [];
  const projectContinuityConflict =
    projectMemoryCoreSnapshot?.continuityStatus?.conflictSlots || projectMemoryCoreSnapshot?.continuityPage?.conflict || [];
  const projectMemoryReviewItems = projectMemoryCoreSnapshot?.reviewQueue?.items || [];
  const projectMemoryReviewCount = projectMemoryCoreSnapshot?.reviewQueue?.count ?? projectMemoryCoreSnapshot?.diagnostics?.reviewQueueCount ?? 0;
  const projectMemoryRecoveryLabel = !projectMemoryCoreSnapshot || projectMemoryCoreLoading
    ? "读取中"
    : !projectMemoryCoreInitialized
      ? "未初始化"
      : projectMemoryCoreSnapshot.continuityStatus?.recoveryReady || projectMemoryCoreSnapshot.continuityPage?.recoveryReady
        ? "可恢复"
        : "需要补全";
  const projectMemoryRecoveryTone: Tone = projectMemoryRecoveryLabel === "可恢复"
    ? "teal"
    : projectMemoryRecoveryLabel === "未初始化" || projectMemoryRecoveryLabel === "读取中"
      ? "slate"
      : "amber";
  const projectMemoryNextAction = !projectMemoryCoreSnapshot || projectMemoryCoreLoading
    ? "正在读取项目记忆，请稍候。"
    : !projectMemoryCoreInitialized
      ? "先扫描并整理项目，建立项目身份和来源锚点。"
      : projectContinuityConflict.length > 0
        ? `先核对${projectContinuitySlotLabel(projectContinuityConflict[0])}中的冲突来源。`
        : projectContinuityMissing.length > 0
          ? `先补全${projectContinuitySlotLabel(projectContinuityMissing[0])}。`
          : projectContinuityStale.length > 0
            ? `先更新${projectContinuitySlotLabel(projectContinuityStale[0])}。`
            : projectMemoryReviewCount > 0
              ? "到记忆治理页复核待确认内容。"
              : "当前项目记忆可以直接用于续接。";
  const projectContinuityAnchorItems = useMemo(() => {
    const seen = new Set<string>();
    return projectContinuitySlots.flatMap((slot) => projectContinuityPacket?.continuity.slots[slot]?.items || [])
      .filter((item) => item.authorityStatus === "accepted" || item.authorityStatus === "curated")
      .filter((item) => {
        const key = `${item.title}|${item.summary || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  }, [projectContinuityPacket]);

  const coreDocuments = useMemo(() => {
    const ranked = [...projectDocuments].sort((a, b) => documentSortValue(a) - documentSortValue(b));
    const preferred = ranked.filter((doc) =>
      ["readme", "prd", "technical_design", "test_plan", "release_notes", "report", "context"].includes(doc.artifactType || ""),
    );
    return (preferred.length > 0 ? preferred : ranked).slice(0, 6);
  }, [projectDocuments]);

  const projectResumeDoc = useMemo(
    () => projectDocuments.find((doc) => doc.fileName.toLowerCase() === "project-resume.md") || null,
    [projectDocuments],
  );
  const projectArtifactsMarkdownDoc = useMemo(
    () => projectDocuments.find((doc) => doc.fileName.toLowerCase() === "project-artifacts.md") || null,
    [projectDocuments],
  );
  const projectArtifactsJsonDoc = useMemo(
    () => projectDocuments.find((doc) => doc.fileName.toLowerCase() === "project-artifacts.json") || null,
    [projectDocuments],
  );
  const projectArtifactConfirmation = effectiveProjectPath ? settings.projectArtifactConfirmations?.[effectiveProjectPath] || null : null;
  const projectArtifactsConfirmed = Boolean(
    projectArtifactConfirmation &&
      projectArtifactConfirmation.markdownDocumentId === (projectArtifactsMarkdownDoc?.id || null) &&
      (projectArtifactConfirmation.markdownContentHash || null) === (projectArtifactsMarkdownDoc?.contentHash || null) &&
      (projectArtifactConfirmation.markdownUpdatedAt || null) === (projectArtifactsMarkdownDoc?.updatedAt || null) &&
      projectArtifactConfirmation.jsonDocumentId === (projectArtifactsJsonDoc?.id || null) &&
      (projectArtifactConfirmation.jsonContentHash || null) === (projectArtifactsJsonDoc?.contentHash || null) &&
      (projectArtifactConfirmation.jsonUpdatedAt || null) === (projectArtifactsJsonDoc?.updatedAt || null),
  );
  const projectArtifactsMapStatus: ProjectArtifactMapStatus =
    projectArtifactsMarkdownDoc || projectArtifactsJsonDoc
      ? projectArtifactsConfirmed
        ? "confirmed"
        : projectArtifactConfirmation?.confirmedAt
          ? "re_review_required"
          : "unconfirmed"
      : "missing";

  const projectResumeConfirmation = effectiveProjectPath ? settings.projectResumeConfirmations?.[effectiveProjectPath] || null : null;
  const projectResumeConfirmed = Boolean(
    projectResumeDoc &&
      projectResumeConfirmation &&
      projectResumeConfirmation.documentId === projectResumeDoc.id &&
      (projectResumeConfirmation.contentHash || null) === (projectResumeDoc.contentHash || null) &&
      (projectResumeConfirmation.updatedAt || null) === (projectResumeDoc.updatedAt || null),
  );
  const projectRecordOverride = effectiveProjectPath ? settings.projectRecordOverrides?.[effectiveProjectPath] || null : null;
  const projectRecordReviewState =
    projectRecordOverride?.confirmedAt && projectRecordOverride.projectRecordSourceSignature === projectRecordSourceSignature
      ? "current"
      : projectRecordOverride?.confirmedAt
        ? "stale"
        : "unconfirmed";
  const projectRecordConfirmed = projectRecordReviewState === "current";

  const queueRows = useMemo(
    () => [
      { label: "AI 摘要候选", count: projectStatus.aiSummaryCandidateCount, detail: "待整理知识项" },
      { label: "源文件变化", count: projectStatus.sourceChangedCount, detail: "源文件已变化" },
      { label: "冲突真相", count: projectStatus.duplicateTruthCount, detail: "重复或待确认" },
      { label: "Skill 候选", count: projectSkillCandidates.length, detail: "可人工审阅" },
    ],
    [projectSkillCandidates.length, projectStatus.aiSummaryCandidateCount, projectStatus.duplicateTruthCount, projectStatus.sourceChangedCount],
  );

  const memoryRows = useMemo(() => {
    const decisionCount = projectKnowledgeItems.filter((item) => /(决策|decision)/i.test(`${item.title} ${item.summary} ${item.body}`)).length;
    const handoffCount =
      projectKnowledgeItems.filter((item) => /(交接|handoff)/i.test(`${item.title} ${item.summary} ${item.body}`)).length +
      projectExperienceCards.filter((item) => /(交接|handoff)/i.test(`${item.title} ${item.summary} ${item.body}`)).length;
    const workerCount = projectExperienceCards.filter((item) =>
      ["autoflow_completion", "agent_family"].includes(item.sourceType),
    ).length;
    const bugCount = projectExperienceCards.filter((item) =>
      item.sourceType === "bug_memory" || /(bug|修复|故障)/i.test(`${item.title} ${item.summary} ${item.body}`),
    ).length;
    return [
      { label: "Bug 经验卡", count: bugCount, tone: "teal" as Tone, detail: projectExperienceCards[0]?.title || "等待导入" },
      { label: "决策日志", count: decisionCount, tone: "teal" as Tone, detail: projectKnowledgeItems[0]?.title || "等待整理" },
      { label: "线程交接", count: handoffCount, tone: handoffCount > 0 ? ("teal" as Tone) : ("slate" as Tone), detail: "来自知识与记忆" },
      { label: "Worker 回报", count: workerCount, tone: workerCount > 0 ? ("teal" as Tone) : ("slate" as Tone), detail: "来自 AutoFlow 写回" },
    ];
  }, [projectExperienceCards, projectKnowledgeItems]);

  const nextCodexRows = useMemo(() => {
    const summaryDoc = coreDocuments[0];
    const constraintsItem =
      projectKnowledgeItems.find((item) => item.category === "architecture" || item.category === "process") ||
      coreDocuments.find((doc) => doc.artifactType === "technical_design");
    const decisionItem =
      projectKnowledgeItems.find((item) => /(决策|decision)/i.test(`${item.title} ${item.summary} ${item.body}`)) ||
      projectExperienceCards.find((item) => /(决策|decision)/i.test(`${item.title} ${item.summary} ${item.body}`));
    const experienceItem = projectExperienceCards[0];
    const resumeDoc = projectResumeDoc;
    const sourceIndex = coreDocuments.find((doc) => doc.fileName.toLowerCase() === "project-knowledge.md") || coreDocuments[1] || summaryDoc;
    return [
      { label: "项目续接包", value: resumeDoc?.filePath || "等待 project-resume.md" },
      { label: "Artifact 索引", value: projectArtifactsMarkdownDoc?.filePath || "等待 project-artifacts.md" },
      { label: "工具资产目录", value: toolSkillInventory?.files.markdown.path || "等待 tool-skill-inventory.md" },
      { label: "项目摘要", value: summaryDoc?.title || "等待 README 或项目概览" },
      { label: "关键约束", value: "title" in (constraintsItem || {}) ? constraintsItem?.title || "等待技术设计" : "等待技术设计" },
      { label: "最近决策", value: decisionItem?.title || "暂无已整理决策" },
      { label: "相关经验", value: experienceItem?.title || "暂无经验卡片" },
      { label: "来源索引", value: sourceIndex?.filePath || sourceIndex?.title || "等待项目索引" },
    ];
  }, [coreDocuments, projectArtifactsMarkdownDoc, projectExperienceCards, projectKnowledgeItems, projectResumeDoc, toolSkillInventory]);

  const fallbackRetrievalResult = useMemo<AgentRetrieveResult>(() => {
    const candidates: AgentRetrieveItem[] = [];

    for (const doc of coreDocuments) {
      const lifecycle = getDocumentLifecycle(doc);
      const excerpt = clipText(doc.summary || doc.contentText || doc.filePath, 150);
      candidates.push({
        id: doc.id,
        kind: "document",
        title: doc.title,
        excerpt,
        sourcePath: doc.filePath,
        sourceRefs: [{
          kind: "document",
          path: doc.filePath,
          title: doc.title,
          hash: doc.contentHash || null,
          updatedAt: doc.updatedAt,
        }],
        status: lifecycle.label,
        freshness: lifecycle.tone === "red" ? "stale" : lifecycle.tone === "amber" ? "review" : "fresh",
        score: scoreDocument(doc, query) || Math.max(18 - documentSortValue(doc), 4),
        tokenEstimate: estimateTokens(`${doc.title} ${excerpt}`),
        whyMatched: [`artifact:${doc.artifactType || "other"}`, `source:${doc.sourceType || "imported"}`],
        requiresHumanConfirmation: lifecycle.tone !== "teal",
      });
    }

    for (const item of projectKnowledgeItems.slice(0, 10)) {
      const tone = getKnowledgeTone(item);
      const excerpt = clipText(item.summary || item.body, 150);
      candidates.push({
        id: item.id,
        kind: "knowledge_item",
        title: item.title,
        excerpt,
        sourcePath: item.sourcePath || item.projectPath || "knowledge-item",
        sourceRefs: [{
          kind: "knowledge_item",
          path: item.sourcePath || item.projectPath || null,
          title: item.title,
          hash: item.sourceHash || null,
          updatedAt: item.updatedAt,
        }],
        status: item.status,
        freshness: tone.tone === "red" ? "stale" : tone.tone === "amber" ? "review" : "fresh",
        score: scoreTextBlock(item.title, `${item.summary} ${item.body} ${item.tags.join(" ")}`, query, item.status === "ready" ? 16 : 10),
        tokenEstimate: estimateTokens(`${item.title} ${excerpt}`),
        whyMatched: [`category:${item.category}`, `provider:${item.provider}`],
        requiresHumanConfirmation: tone.tone !== "teal",
      });
    }

    for (const item of projectExperienceCards.slice(0, 8)) {
      const tone = getMemoryTone(item);
      const excerpt = clipText(item.summary || item.body, 150);
      candidates.push({
        id: item.id,
        kind: "experience_card",
        title: item.title,
        excerpt,
        sourcePath: item.sourcePath || item.projectPath || "experience-card",
        sourceRefs: [{
          kind: "experience_card",
          path: item.sourcePath || item.projectPath || null,
          title: item.title,
          hash: item.sourceHash || null,
          updatedAt: item.updatedAt,
        }],
        status: item.status,
        freshness: tone.tone === "red" ? "stale" : tone.tone === "amber" ? "review" : "fresh",
        score: scoreTextBlock(item.title, `${item.summary} ${item.body} ${item.tags.join(" ")}`, query, item.status === "curated" ? 15 : 9),
        tokenEstimate: estimateTokens(`${item.title} ${excerpt}`),
        whyMatched: [`sourceType:${item.sourceType}`, `scope:${item.scope}`],
        requiresHumanConfirmation: tone.tone !== "teal",
      });
    }

    for (const item of projectSkillCandidates.slice(0, 6)) {
      const tone = getMemoryTone(item);
      const excerpt = clipText(item.draftSkillMarkdown || item.title, 150);
      const evidencePath = item.evidence?.sourcePaths?.[0] || item.projectPath || "skill-candidate";
      candidates.push({
        id: item.id,
        kind: "skill_candidate",
        title: item.title,
        excerpt,
        sourcePath: evidencePath,
        sourceRefs: [{
          kind: "skill_candidate",
          path: evidencePath,
          title: item.title,
          hash: null,
          updatedAt: item.updatedAt,
        }],
        status: item.status,
        freshness: tone.tone === "red" ? "stale" : tone.tone === "amber" ? "review" : "fresh",
        score: scoreTextBlock(item.title, `${item.triggerPatterns.join(" ")} ${item.draftSkillMarkdown}`, query, item.status === "approved" ? 14 : 8),
        tokenEstimate: estimateTokens(`${item.title} ${excerpt}`),
        whyMatched: [`triggers:${item.triggerPatterns.slice(0, 2).join("|") || "none"}`],
        requiresHumanConfirmation: tone.tone !== "teal",
      });
    }

    const items = candidates
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.tokenEstimate - b.tokenEstimate))
      .slice(0, 7);

    const freshness =
      items.some((item) => item.freshness === "stale")
        ? "stale"
        : items.some((item) => item.freshness === "review")
          ? "review"
          : "fresh";

    return {
      provider: "zhixia_local_docs",
      mode: "fallback_preview",
      queryType: "task_dispatch",
      query,
      projectPath: effectiveProjectPath,
      tokenBudget: 1200,
      returnedCount: items.length,
      tokenEstimate: items.reduce((sum, item) => sum + item.tokenEstimate, 0),
      freshness,
      generatedAt: new Date().toISOString(),
      items,
    };
  }, [coreDocuments, effectiveProjectPath, projectExperienceCards, projectKnowledgeItems, projectSkillCandidates, query]);

  useEffect(() => {
    let cancelled = false;
    if (view !== "agent") return () => {
      cancelled = true;
    };

    async function loadAgentContext() {
      if (typeof window.docKnowledge.retrieveAgentContext !== "function") {
        if (!cancelled) {
          setAgentRetrieveMode("fallback_preview");
          setAgentRetrieveError("当前 preload 未暴露本地 retrieval contract，已回退为前端预览。");
          setAgentRetrieveResult(null);
        }
        return;
      }

      try {
        const result = await window.docKnowledge.retrieveAgentContext({
          query,
          queryType: "task_dispatch",
          projectPath: effectiveProjectPath,
          tokenBudget: 1200,
          maxResults: 7,
        });
        if (cancelled) return;
        setAgentRetrieveResult(result);
        setAgentRetrieveMode("local_contract");
        setAgentRetrieveError(null);
        loadRetrieveLogs().catch(() => {});
      } catch (error) {
        if (cancelled) return;
        setAgentRetrieveMode("fallback_preview");
        setAgentRetrieveResult(null);
        setAgentRetrieveError(`本地 retrieval contract 调用失败，已回退为前端预览：${error instanceof Error ? error.message : String(error)}`);
        loadRetrieveLogs().catch(() => {});
      }
    }

    const timer = window.setTimeout(() => {
      loadAgentContext();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [documents.length, effectiveProjectPath, experienceCards.length, knowledgeItems.length, query, skillCandidates.length, view]);

  useEffect(() => {
    if (view !== "agent") return;
    loadMemoryRuntimeDiagnostics(effectiveProjectPath).catch((error) => {
      setMemoryRuntimeError(`记忆运行状态读取失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }, [effectiveProjectPath, view]);

  const retrievalResult = agentRetrieveMode === "local_contract" && agentRetrieveResult ? agentRetrieveResult : fallbackRetrievalResult;
  const topRetrievalItems = retrievalResult.items.slice(0, 3);
  const selectedAgentRetrieveLog = useMemo(
    () => agentRetrieveLogs.find((item) => item.id === selectedAgentRetrieveLogId) || agentRetrieveLogs[0] || null,
    [agentRetrieveLogs, selectedAgentRetrieveLogId],
  );

  const selectedHistoryItem = useMemo(
    () => historyEnvelope?.items.find((item) => item.threadId === selectedHistoryThreadId) || historyEnvelope?.items[0] || null,
    [historyEnvelope, selectedHistoryThreadId],
  );

  const selectedHistoryContextItem = useMemo(
    () => historyContextEnvelope?.items[0] || null,
    [historyContextEnvelope],
  );

  const decisionAndHandoffRows = useMemo(() => {
    const fromKnowledge = projectKnowledgeItems
      .filter((item) => /(决策|decision|交接|handoff)/i.test(`${item.title} ${item.summary} ${item.body}`))
      .map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.category === "process" ? "交接" : "决策",
        summary: item.summary || item.body,
        updatedAt: item.updatedAt,
        sourcePath: item.sourcePath || item.projectPath || "knowledge-item",
      }));
    const fromMemory = projectExperienceCards
      .filter((item) => /(决策|decision|交接|handoff|worker)/i.test(`${item.title} ${item.summary} ${item.body}`))
      .map((item) => ({
        id: item.id,
        title: item.title,
        kind: /(交接|handoff|worker)/i.test(`${item.title} ${item.summary}`) ? "交接" : "决策",
        summary: item.summary || item.body,
        updatedAt: item.updatedAt,
        sourcePath: item.sourcePath || item.projectPath || "experience-card",
      }));
    return [...fromKnowledge, ...fromMemory]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 12);
  }, [projectExperienceCards, projectKnowledgeItems]);

  const sourceIntegrityLabel = coreDocuments.length > 0 ? "来源完整" : "来源待补";
  const healthStatusLabel = projectStatus.staleCount > 0 ? "需复查" : projectStatus.reviewCount > 0 ? "待确认" : "健康";
  const projectArtifactsStatusLabel =
    projectArtifactsMapStatus === "confirmed"
      ? "已确认"
      : projectArtifactsMapStatus === "re_review_required"
        ? "待复核"
        : projectArtifactsMapStatus === "unconfirmed"
          ? "待确认"
          : "未生成";
  const projectArtifactsStatusTone: Tone =
    projectArtifactsMapStatus === "confirmed"
      ? "teal"
      : projectArtifactsMapStatus === "missing"
        ? "slate"
        : "amber";
  const projectArtifactsStatusDetailLabel = projectArtifactsMapStatus === "confirmed" ? "已确认" : "待确认";
  const projectArtifactsStatusDetailTone: Tone = projectArtifactsMapStatus === "confirmed" ? "teal" : "amber";
  const projectArtifactsStatusMessage =
    projectArtifactsMapStatus === "confirmed"
      ? `确认时间：${formatDate(projectArtifactConfirmation?.confirmedAt || null)}`
      : projectArtifactsMapStatus === "re_review_required"
        ? `上次确认时间：${formatDate(projectArtifactConfirmation?.confirmedAt || null)}；当前 md/json 已变化，必须重新复核。`
        : "自动生成，等待人工确认当前索引。";
  const projectArtifactsActionLabel = projectArtifactsMapStatus === "re_review_required" ? "重新确认快照" : "确认索引";
  const toolSkillInventoryMapStatus: ToolSkillInventoryMapStatus =
    toolSkillInventory?.confirmationStatus || (effectiveProjectPath ? "missing" : "missing");
  const toolSkillInventoryStatusLabel =
    toolSkillInventoryMapStatus === "confirmed"
      ? "已确认"
      : toolSkillInventoryMapStatus === "re_review_required"
        ? "待复核"
        : toolSkillInventoryMapStatus === "unconfirmed"
          ? "待确认"
          : "未生成";
  const toolSkillInventoryStatusTone: Tone =
    toolSkillInventoryMapStatus === "confirmed"
      ? "teal"
      : toolSkillInventoryMapStatus === "missing"
        ? "slate"
        : "amber";
  const toolSkillInventoryStatusMessage =
    toolSkillInventoryMapStatus === "confirmed"
      ? `确认时间：${formatDate(toolSkillInventory?.confirmation?.confirmedAt || null)}`
      : toolSkillInventoryMapStatus === "re_review_required"
        ? `上次确认时间：${formatDate(toolSkillInventory?.confirmation?.confirmedAt || null)}；当前工具资产指纹已变化，必须重新复核。`
        : toolSkillInventoryError || "自动发现结果默认是候选资产，等待人工确认当前资产目录。";
  const toolSkillInventoryActionLabel = toolSkillInventoryMapStatus === "re_review_required" ? "重新确认快照" : "确认资产快照";
  const toolSkillInventoryRecords = toolSkillInventory?.records || [];
  const toolSkillInventoryPreviewRecords = toolSkillInventoryRecords.slice(0, 5);
  const toolSkillGovernanceCounts = toolSkillInventoryRecords.reduce(
    (counts, record) => {
      const state = record.governance?.reviewState || "unreviewed";
      const status = record.governance?.status || "candidate";
      counts[state] += 1;
      if (status !== "candidate") counts.decided += 1;
      return counts;
    },
    { current: 0, stale: 0, unreviewed: 0, decided: 0 },
  );
  const filteredToolSkillInventoryRecords = useMemo(() => {
    const queryText = query.trim().toLowerCase();
    if (!queryText) return toolSkillInventoryRecords;
    return toolSkillInventoryRecords.filter((record) =>
      [
        record.name,
        record.kind,
        record.status,
        record.summary,
        record.sourcePath || "",
        record.installPath || "",
        record.workspacePaths.join(" "),
        record.useCases.join(" "),
        record.triggerPatterns.join(" "),
        record.riskBoundaries.join(" "),
        record.safeCommands.join(" "),
        record.forbiddenCommands.join(" "),
        record.governance?.status || "",
        record.governance?.reviewState || "",
      ].join(" ").toLowerCase().includes(queryText),
    );
  }, [query, toolSkillInventoryRecords]);
  const toolSkillInventoryGroups = useMemo(() => {
    const groupMap = new Map<
      string,
      {
        key: string;
        title: string;
        description: string;
        tone: Tone;
        records: ToolSkillRecord[];
      }
    >();
    const ensureGroup = (key: string, title: string, description: string, tone: Tone) => {
      const group = groupMap.get(key) || { key, title, description, tone, records: [] as ToolSkillRecord[] };
      groupMap.set(key, group);
      return group;
    };
    for (const record of filteredToolSkillInventoryRecords) {
      const origin = toolOriginLabel(record);
      if (record.kind === "workflow_script" || record.kind === "cli_tool" || record.kind === "project_scaffold") {
        ensureGroup("script", "脚本与自动化工具", "测试、打包、导出、Guardian 或 workflow helper，只记录用途和边界，不自动执行。", "amber").records.push(record);
      } else if (origin.startsWith("自建")) {
        ensureGroup("custom", "自建 / 项目内工具", "用户自己做过、项目内携带的 Skill、插件或项目工具，需要优先整理用途和使用项目。", "teal").records.push(record);
      } else if (origin.startsWith("Codex")) {
        ensureGroup("codex", "Codex 官方 / 全局 Skill", "全局安装或官方/系统侧 Skill，默认少治理，只作为 Codex 可见能力索引。", "slate").records.push(record);
      } else {
        ensureGroup("uncategorized", "待归类工具资产", "知匣能看到来源，但还需要扫描或人工确认它属于哪个项目和用途。", "amber").records.push(record);
      }
    }
    return Array.from(groupMap.values()).sort((a, b) => {
      const order = ["custom", "script", "codex", "uncategorized"];
      return order.indexOf(a.key) - order.indexOf(b.key);
    });
  }, [filteredToolSkillInventoryRecords]);

  function renderTonePill(label: string, tone: Tone) {
    return <span className={`pill tone-${tone}`}>{label}</span>;
  }

  function compactList(values: Array<string | null | undefined>, fallback = "none", limit = 4) {
    const items = values.filter((value): value is string => Boolean(value && value.trim())).slice(0, limit);
    return items.length > 0 ? items.join(" · ") : fallback;
  }

  function toolSkillGovernanceTone(status = "candidate", reviewState = "unreviewed"): Tone {
    if (reviewState === "stale") return "amber";
    if (status === "confirmed") return "teal";
    if (status === "rejected" || status === "blocked") return "red";
    if (status === "deprecated") return "slate";
    return "amber";
  }

  function toolSkillGovernanceLabel(status = "candidate", reviewState = "unreviewed") {
    const statusLabel =
      status === "confirmed"
        ? "已确认"
        : status === "rejected"
          ? "已拒绝"
          : status === "deprecated"
            ? "已弃用"
            : status === "blocked"
              ? "已阻断"
              : "候选";
    const reviewLabel = reviewState === "current" ? "当前" : reviewState === "stale" ? "待复核" : "未复核";
    return `${statusLabel} · ${reviewLabel}`;
  }

  function toolSkillInventoryStateLabel(status: ToolSkillInventoryMapStatus) {
    if (status === "confirmed") return "已确认";
    if (status === "re_review_required") return "待复核";
    if (status === "unconfirmed") return "待确认";
    return "未生成";
  }

  function toolSkillRecordStatusLabel(status = "candidate") {
    if (status === "confirmed") return "已确认";
    if (status === "rejected") return "已拒绝";
    if (status === "deprecated") return "已弃用";
    if (status === "blocked") return "已阻断";
    return "候选";
  }

  function renderToolSkillRecordList(records = filteredToolSkillInventoryRecords) {
    if (!toolSkillInventory) {
      return (
        <div className="empty-state">
          <Wrench size={34} />
          <strong>还没有工具资产目录</strong>
          <span>{toolSkillInventoryError || "选择或扫描一个 Codex 项目后，这里会显示只读候选资产目录。"}</span>
        </div>
      );
    }
    if (records.length === 0) {
      return (
        <div className="empty-state">
          <Search size={34} />
          <strong>没有匹配的候选记录</strong>
          <span>当前筛选没有命中 Skill、工作流脚本或项目工具候选。</span>
        </div>
      );
    }
    return (
      <div className="tool-record-list tool-card-grid">
        {records.map((record) => {
          const governance = record.governance;
          const governanceStatus = governance?.status || "candidate";
          const reviewState = governance?.reviewState || "unreviewed";
          const actions: Array<{ status: ToolSkillGovernanceAction; label: string }> = [
            { status: "confirmed", label: "确认" },
            { status: "rejected", label: "拒绝" },
            { status: "deprecated", label: "弃用" },
            { status: "blocked", label: "阻断" },
            { status: "clear", label: "清除" },
          ];
          return (
            <article key={record.id} className="tool-record-card">
              <div className="tool-record-header">
                <div className="tool-record-title">
                  <span className={toolOriginLabel(record).startsWith("Codex") ? "tool-record-icon official" : "tool-record-icon custom"}>
                    {toolOriginLabel(record).startsWith("Codex") ? <Star size={16} /> : <Wrench size={16} />}
                  </span>
                  <span className="section-kicker">{displayToolSubtitle(record)}</span>
                  <h3>{displayToolChineseName(record)}</h3>
                  <p>{toolPurposeText(record)}</p>
                </div>
                <div className="tool-record-pills">
                  {renderTonePill(toolSkillGovernanceLabel(governanceStatus, reviewState), toolSkillGovernanceTone(governanceStatus, reviewState))}
                  {renderTonePill(toolOriginLabel(record).startsWith("Codex") ? "官方" : "自建", toolOriginLabel(record).startsWith("Codex") ? "slate" : "teal")}
                  {renderTonePill(record.installed ? "已安装" : "候选", record.installed ? "teal" : "slate")}
                </div>
              </div>

              <details className="tool-record-details">
                <summary>查看详情</summary>
                <dl className="tool-record-grid tool-record-detail-grid">
                  <div>
                    <dt>干什么用</dt>
                    <dd>卡片摘要已展示；更多适用场景和触发条件见下方。</dd>
                  </div>
                  <div>
                    <dt>创建 / 更新</dt>
                    <dd>{toolCreatedText(record)}</dd>
                  </div>
                  <div>
                    <dt>使用项目</dt>
                    <dd>{toolUsedProjectText(record)}</dd>
                  </div>
                  <div>
                    <dt>来源分类</dt>
                    <dd>{toolOriginLabel(record)}</dd>
                  </div>
                  <div>
                    <dt>治理状态</dt>
                    <dd>
                      {governance?.reviewedAt
                        ? `${toolSkillGovernanceLabel(governance.status, governance.reviewState)} · ${formatDate(governance.reviewedAt)}`
                        : "候选 · 未复核"}
                    </dd>
                  </div>
                  <div>
                    <dt>适用场景</dt>
                    <dd>{compactList(record.useCases.map((item) => clipText(toolPurposeText({ ...record, summary: item }), 80)), "等待整理用途")}</dd>
                  </div>
                  <div>
                    <dt>何时让 Codex 用</dt>
                    <dd>{compactList(record.triggerPatterns.map((item) => clipText(item.replace(/\bwhen\b/gi, "当"), 80)), "等待整理触发条件")}</dd>
                  </div>
                  <div>
                    <dt>风险边界</dt>
                    <dd>{compactList(record.riskBoundaries.map((item) => clipText(item, 80)), "需要人工复核")}</dd>
                  </div>
                  <div>
                    <dt>允许命令</dt>
                    <dd>{compactList(record.safeCommands, "未声明")}</dd>
                  </div>
                  <div>
                    <dt>禁止命令</dt>
                    <dd>{compactList(record.forbiddenCommands, "默认禁止自动执行")}</dd>
                  </div>
                  <div>
                    <dt>输入 / 输出</dt>
                    <dd>{compactList([...record.inputs, ...record.outputs], "未说明")}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd>{compactList([record.workspacePaths[0], record.sourcePath || record.installPath || "", ...record.sourceRefs.map((ref) => ref.path || ref.title || ref.kind)], "暂无来源", 3)}</dd>
                  </div>
                  <div>
                    <dt>来源指纹</dt>
                    <dd>{governance?.recordContextHash ? clipText(governance.recordContextHash, 28) : "待首次复核"}</dd>
                  </div>
                </dl>
                <div className="tool-governance-actions" aria-label={`ToolSkillRecord governance for ${record.name}`}>
                  {actions.map((action) => (
                    <button
                      key={action.status}
                      className={action.status === "confirmed" ? "primary-button compact-action" : "ghost-button compact-action"}
                      onClick={() => updateToolSkillRecordGovernance(record.id, action.status)}
                      disabled={
                        busy ||
                        !effectiveProjectPath ||
                        !toolSkillInventory ||
                        (action.status === "clear" && governanceStatus === "candidate" && reviewState === "unreviewed") ||
                        (action.status === governanceStatus && reviewState === "current")
                      }
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                {reviewState === "stale" ? (
                  <p className="settings-note">该记录的来源或上下文指纹已变化；旧治理状态会保留为证据，但必须重新复核后才算当前可信。</p>
                ) : null}
              </details>
            </article>
          );
        })}
      </div>
    );
  }

  function renderArchiveCandidatePanel(item: CodexGuardianHistoryItem | null) {
    const candidate = item?.archiveCandidate;
    if (!candidate) return null;
    const memoryPointerSummary = (candidate.evidence.memoryPointers || []).slice(0, 3).join("、") || "缺失";
    const sourceRefSummary = (candidate.evidence.sourceRefs || [])
      .slice(0, 3)
      .map((ref) => clipText(ref.path || ref.section || ref.field || ref.kind || "source", 88))
      .join(" · ") || "缺失";
    const threadStoreCompatibleLabel =
      candidate.evidence.threadStoreCompatible === true
        ? "已兼容（瘦身回执已声明兼容；归档队列会保留这份证据）"
        : candidate.evidence.threadStoreCompatible === false
          ? "不兼容（必须阻断，不可视为安全瘦身或归档）"
          : "未知（证据不足，不能进入归档队列）";
    return (
      <div className="inspector-note" data-e2e="archive-candidate-panel">
        <div className="section-heading-row">
          <strong data-e2e="archive-candidate-state">{candidate.isCandidate ? "可归档候选" : "暂不可归档"}</strong>
          {renderTonePill(candidate.isCandidate ? "候选" : "阻断", candidate.isCandidate ? "amber" : "slate")}
        </div>
        <p>
          这是归档前证据判断；后台体检会遵守冷却规则，用户主动点“一键安全减负”时，已完整入库、已验 hash、非运行中的旧线程会直接进入归档队列交给 Codex 宿主桥接归档。已瘦身的线程会附带瘦身回执。
        </p>
        {candidate.reasons.length > 0 ? (
          <p>候选理由：{candidate.reasons.map((reason) => archiveLabel(reason, archiveReasonLabels)).join("、")}</p>
        ) : null}
        {candidate.blockers.length > 0 ? (
          <p>阻止原因：{candidate.blockers.map((blocker) => archiveLabel(blocker, archiveBlockerLabels)).join("、")}</p>
        ) : null}
        <p>
          历史保险库证据：{candidate.evidence.hasVaultEvidence ? "已检测到" : "缺失"}；清单：
          {candidate.evidence.vaultManifestPath || "暂无清单"}；会话副本：
          {candidate.evidence.vaultSessionPath || "暂无副本"}；保险库校验：
          {candidate.evidence.vaultSha256 || candidate.evidence.vaultOriginalSha256 || candidate.evidence.vaultCopiedSha256 || "暂无校验"}
        </p>
        <p>
          瘦身回执：路径={candidate.evidence.compactReceiptPath || "暂无回执"}；校验=
          {candidate.evidence.compactReceiptSha256 || "暂无校验"}；兼容状态：{threadStoreCompatibleLabel}
        </p>
        <p>
          记忆指针：{candidate.evidence.hasMemoryPointer ? memoryPointerSummary : "缺失"}；来源证据：
          {candidate.evidence.hasSourceRefs ? sourceRefSummary : "缺失"}
        </p>
        <p data-e2e="archive-candidate-policy">
          知匣不会删除、恢复或直接移动 Codex session；侧栏归档只通过归档队列交给 Codex 宿主执行，也不承诺一定修复所有性能问题。
        </p>
      </div>
    );
  }

  async function copyArchiveQueueSummary(queue: CodexThreadArchiveQueue | null) {
    if (!queue) return;
    const lines = [
      `知匣冷线程归档队列：${queue.queueId}`,
      `队列文件：${queue.queuePath}`,
      `可归档：${queue.readyCount}；自动跳过：${queue.skippedCount}`,
      "执行方式：由 Codex 宿主调用 codex_app.set_thread_archived；知匣 App 不删除、不移动、不直接修改侧栏。",
      "",
      ...queue.items.map((item) => `- ${item.threadId} | ${item.title}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice("归档队列清单已复制。");
    } catch {
      setHistoryError("复制归档队列失败，请从队列文件查看。");
    }
  }

  function renderArchiveQueuePanel(queue: CodexThreadArchiveQueue | null) {
    if (!queue) return null;
    return (
      <div className="archive-queue-panel" data-e2e="archive-queue-panel">
        <div className="section-heading-row">
          <strong>冷线程归档队列</strong>
          {renderTonePill(queue.readyCount > 0 ? `${queue.readyCount} 条待宿主归档` : "暂无可归档", queue.readyCount > 0 ? "amber" : "slate")}
        </div>
        <p>
          已保存队列：{queue.queuePath}。知匣已筛选可安全归档的冷线程；CEO 创建线程 3 天未复用、CEO 主线程 30 天、归属不明线程 3 天是默认冷却规则。大线程会保留瘦身回执，小的过期线程只要历史保险库和 hash 通过即可进入队列。真实侧栏归档需要 Codex 宿主桥接执行；这里不会删除历史，也不会移动原始 session。
        </p>
        <div className="history-progress-stats">
          <span>{queue.readyCount} 可归档</span>
          <span>{queue.skippedCount} 自动跳过</span>
          <span>{queue.appCanArchiveCodexSidebar ? "App 可执行" : "需要宿主桥接"}</span>
        </div>
        {queue.items.length > 0 ? (
          <div className="archive-queue-list">
            {queue.items.slice(0, 5).map((item) => (
              <div key={item.threadId} className="history-source-row">
                <strong>{clipText(item.title, 58)}</strong>
                <span>{item.threadId}</span>
              </div>
            ))}
          </div>
        ) : (
          <p>当前没有同时满足“已入库、已瘦身、证据完整、非活跃”的线程；知匣已保留跳过原因。</p>
        )}
        <div className="maintenance-actions">
          <button className="ghost-button" onClick={() => copyArchiveQueueSummary(queue)}>
            <Copy size={15} /> 复制归档队列
          </button>
        </div>
      </div>
    );
  }

  function renderSelectedArchiveQueueState(item: CodexGuardianHistoryItem | null) {
    if (!item || !historyArchiveQueue) return null;
    const ready = historyArchiveQueue.items.find((queueItem) => queueItem.threadId === item.threadId);
    const skipped = historyArchiveQueue.skipped.find((queueItem) => queueItem.threadId === item.threadId);
    if (ready) {
      return (
        <div className="inspector-note success-note" data-e2e="selected-archive-ready">
          这条线程已进入冷线程归档队列：完整历史已入库，冷却规则已满足，等待 Codex 宿主执行侧栏归档。
        </div>
      );
    }
    if (skipped) {
      return (
        <div className="inspector-note" data-e2e="selected-archive-skipped">
          这条线程本轮未归档：{skipped.blockers.map((blocker) => archiveLabel(blocker, archiveBlockerLabels)).join("、") || skipped.reason}
        </div>
      );
    }
    return null;
  }

  function openRetrievedItem(item: AgentRetrieveItem) {
    if (item.kind === "project_record") {
      if (item.sourcePath) setActiveProject(item.sourcePath);
      setView("project");
      setProjectTab("overview");
      return;
    }
    if (item.kind === "ceo_flow_record" || item.kind === "thread_lineage_index") {
      if (item.sourcePath && item.sourcePath !== "ceo-flow") setActiveProject(item.sourcePath);
      setView("project");
      setProjectTab("handoff");
      return;
    }
    if (item.kind === "document") {
      setSelectedId(item.id);
      setView("project");
      setProjectTab("documents");
      return;
    }
    if (item.kind === "knowledge_item") {
      setSelectedKnowledgeId(item.id);
      setView("project");
      setProjectTab("knowledge");
      return;
    }
    if (item.kind === "experience_card") {
      setSelectedExperienceId(item.id);
      setView("project");
      setProjectTab("memory");
      return;
    }
    if (item.kind === "skill_candidate") {
      setSelectedSkillCandidateId(item.id);
      setView("project");
      setProjectTab("memory");
      return;
    }
    if (item.kind === "tool_skill_record") {
      setView("tools");
    }
  }

  function renderAgentLogDetail(log: AgentRetrieveLogEntry | null) {
    if (!log) {
      return (
        <div className="agent-log-empty">
          <Clock3 size={28} />
          <strong>还没有检索日志</strong>
          <span>当智能优化页发起本地检索后，这里会记录原因、来源和人工确认提示。</span>
        </div>
      );
    }

    return (
      <div className="agent-log-detail">
        <div className="detail-header with-icon">
          <Bot size={18} />
          <h3>{log.query.trim() || "未输入 query 的默认检索"}</h3>
        </div>
        <div className="source-row">
          <span>{log.queryType}</span>
          <span>{log.mode === "local_contract" ? "本地 contract" : log.mode}</span>
          {renderTonePill(retrieveStatusLabel(log.status), toneFromRetrieveStatus(log.status))}
          {renderTonePill(freshnessLabel(log.freshness), toneFromFreshness(log.freshness))}
        </div>
        <dl className="detail-list">
          <dt>调用时间</dt>
          <dd>{formatDate(log.timestamp)}</dd>
          <dt>项目</dt>
          <dd>{log.projectPath || "全局范围"}</dd>
          {log.parentCeoThreadId && (
            <>
              <dt>父 CEO Thread</dt>
              <dd>{log.parentCeoThreadId}</dd>
            </>
          )}
          {log.cache && (
            <>
              <dt>缓存</dt>
              <dd>{retrieveCacheLabel(log.cache)}</dd>
            </>
          )}
          <dt>返回结果</dt>
          <dd>{log.returnedCount} 条</dd>
          <dt>Token 估算</dt>
          <dd>{log.tokenEstimate}</dd>
          <dt>耗时</dt>
          <dd>{log.durationMs} ms</dd>
          <dt>需要人工确认</dt>
          <dd>{log.requiresHumanConfirmationCount} 条</dd>
          {log.errorMessage && (
            <>
              <dt>错误信息</dt>
              <dd>{log.errorMessage}</dd>
            </>
          )}
        </dl>

        <section className="agent-log-section">
          <div className="section-heading compact">
            <div>
              <h3>来源</h3>
              <p>展示这次检索实际命中的可验证来源。</p>
            </div>
          </div>
          <div className="agent-log-ref-list">
            {log.sourceRefs.length === 0 && <div className="overview-row empty"><span>这次调用没有返回来源摘要。</span></div>}
            {log.sourceRefs.map((ref, index) => (
              <div key={`${ref.kind}-${ref.path || ref.title || index}`} className="agent-log-ref">
                <strong>{ref.title || ref.path || ref.kind}</strong>
                <span>{retrieveKindLabel(ref.kind)} · {ref.path || "无路径"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="agent-log-section">
          <div className="section-heading compact">
            <div>
              <h3>为什么命中</h3>
              <p>普通用户可以先看这里理解 Codex 为什么会拿这些资料。</p>
            </div>
          </div>
          <div className="agent-log-items">
            {log.topItems.length === 0 && <div className="overview-row empty"><span>这次调用没有返回 Top Items。</span></div>}
            {log.topItems.map((item) => (
              <div key={`${item.kind}-${item.id}`} className="agent-log-item">
                <div className="result-card-head">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.sourcePath}</span>
                  </div>
                  <div className="agent-log-item-pills">
                    {renderTonePill(retrieveKindLabel(item.kind), "slate")}
                    {renderTonePill(item.status, toneFromFreshness(item.freshness))}
                  </div>
                </div>
                <div className="timeline-meta">
                  <span>{item.tokenEstimate} tokens</span>
                  <span>{freshnessLabel(item.freshness)}</span>
                  <span>{retrieveKindLabel(item.kind)}</span>
                </div>
                <div className="timeline-meta wrap">
                  <span>为什么命中: {item.whyMatched.join(" · ") || "baseline ranking"}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderRetrievalInspector() {
    const inspectorStatus = renderTonePill(
      agentRetrieveMode === "local_contract" ? "API" : "fallback",
      agentRetrieveMode === "local_contract" ? "teal" : "amber",
    );

    return (
      <aside className={inspectorCollapsed ? "inspector-panel collapsed" : "inspector-panel"}>
        <div className="inspector-header">
          <div>
            <h3>Codex 可验证检索</h3>
            <p>这是 explainability / retrieval contract 预览，不是联网 AI 问答。</p>
          </div>
          <div className="inspector-header-actions">
            {inspectorStatus}
            <button
              className="ghost-button inspector-toggle-button"
              onClick={() => setInspectorCollapsed((current) => !current)}
              aria-expanded={!inspectorCollapsed}
            >
              {inspectorCollapsed ? "展开检索" : "收起检索"}
            </button>
          </div>
        </div>

        {inspectorCollapsed ? (
          <>
            {agentRetrieveError && <div className="inspector-note">{agentRetrieveError}</div>}
            <div className="inspector-collapsed-summary">
              <span>当前显示 Top 3 检索来源。</span>
              <strong>{retrievalResult.returnedCount} 条</strong>
              <div className="timeline-meta wrap">
                <span>{retrievalResult.mode === "local_contract" ? "local contract" : "fallback preview"}</span>
                <span>{retrievalResult.queryType}</span>
                <span>{retrievalResult.tokenEstimate} tokens</span>
                {retrievalResult.parentCeoThreadId && <span>parent CEO: {retrievalResult.parentCeoThreadId}</span>}
                {retrievalResult.cache && <span>{retrieveCacheLabel(retrievalResult.cache)}</span>}
              </div>
              {renderTonePill(freshnessLabel(retrievalResult.freshness), toneFromFreshness(retrievalResult.freshness))}
            </div>
          </>
        ) : (
          <>
            {agentRetrieveError && <div className="inspector-note">{agentRetrieveError}</div>}

            <div className="inspector-metrics">
              <div className="metric-row">
                <span>Contract</span>
                <strong>{retrievalResult.mode === "local_contract" ? "local contract" : "fallback preview"}</strong>
              </div>
              <div className="metric-row">
                <span>Query type</span>
                <strong>{retrievalResult.queryType}</strong>
              </div>
              <div className="metric-row">
                <span>返回</span>
                <strong>{retrievalResult.returnedCount} 条</strong>
              </div>
              <div className="metric-row">
                <span>Token</span>
                <strong>{retrievalResult.tokenEstimate}</strong>
              </div>
              {retrievalResult.parentCeoThreadId && (
                <div className="metric-row">
                  <span>Parent CEO</span>
                  <strong>{retrievalResult.parentCeoThreadId}</strong>
                </div>
              )}
              {retrievalResult.cache && (
                <div className="metric-row">
                  <span>Cache</span>
                  <strong>{retrieveCacheLabel(retrievalResult.cache)}</strong>
                </div>
              )}
              <div className="metric-row">
                <span>Freshness</span>
                {renderTonePill(freshnessLabel(retrievalResult.freshness), toneFromFreshness(retrievalResult.freshness))}
              </div>
            </div>

            <div className="inspector-results">
              <div className="section-heading compact">
                <div>
                  <h3>检索结果（Top 3）</h3>
                  <p>来自真实本地 contract；显示状态、来源 refs 和 why matched。</p>
                </div>
              </div>

              {topRetrievalItems.map((item) => (
                <button key={`${item.kind}-${item.id}`} className="result-card" onClick={() => openRetrievedItem(item)}>
                  <div className="result-card-head">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.sourcePath}</span>
                    </div>
                    {renderTonePill(item.status, toneFromFreshness(item.freshness))}
                  </div>
                  <p>{item.excerpt}</p>
                  <div className="timeline-meta">
                    <span>{retrieveKindLabel(item.kind)}</span>
                    <span>相关度 {item.score.toFixed(2)}</span>
                    <span>{item.tokenEstimate} tokens</span>
                  </div>
                  <div className="timeline-meta wrap">
                    <span>why: {(item.whyMatched || []).slice(0, 2).join(" · ") || "baseline ranking"}</span>
                  </div>
                  <div className="timeline-meta wrap">
                    <span>refs: {(item.sourceRefs || []).slice(0, 2).map((ref) => ref.path || ref.title || ref.kind).join(" · ") || item.sourcePath}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
    );
  }

  function renderDocumentCollection(items: ScoredDocument[], title: string, description: string) {
    return (
      <div className="split-panel">
        <section className="collection-panel">
          <div className="section-heading">
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <button className="ghost-button" onClick={() => window.docKnowledge.revealStore()}>
              <FolderOpen size={15} /> 数据目录
            </button>
          </div>

          <div className="cards">
            {items.length === 0 && (
              <div className="empty-state">
                <FileText size={34} />
                <strong>还没有匹配文档</strong>
                <span>导入或扫描后，知匣会在这里展示项目来源与可搜索内容。</span>
              </div>
            )}
            {items.map((doc) => {
              const lifecycle = getDocumentLifecycle(doc);
              return (
                <button key={doc.id} className={selected?.id === doc.id ? "doc-card selected" : "doc-card"} onClick={() => setSelectedId(doc.id)}>
                  <div className="doc-card-top">
                    <FileText size={18} />
                    {renderTonePill(lifecycle.label, lifecycle.tone)}
                  </div>
                  <strong>{doc.title}</strong>
                  <p>{renderHighlightedSnippet(doc.snippet, query)}</p>
                  {doc.tags.length > 0 && (
                    <div className="doc-tags">
                      {doc.tags.slice(0, 4).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                      {doc.tags.length > 4 && <span>+{doc.tags.length - 4}</span>}
                    </div>
                  )}
                  <div className="doc-meta">
                    <span>{artifactTypeLabels[doc.artifactType || "other"] || doc.artifactType || "文档"}</span>
                    <span>{sourceTypeLabels[doc.sourceType || "imported"] || doc.sourceType}</span>
                    <span>{formatBytes(doc.size)}</span>
                    <span>{formatDate(doc.importedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="detail-pane">
          {selected ? (
            <>
              <div className="detail-header">
                <input
                  className="title-input"
                  value={selected.title}
                  onChange={(event) => updateSelected({ title: event.target.value })}
                />
                <button
                  className={selected.favorite ? "icon-button starred" : "icon-button"}
                  onClick={() => updateSelected({ favorite: !selected.favorite })}
                  title="星标"
                >
                  <Star size={18} />
                </button>
              </div>

              <div className="detail-meta">
                <span>{selected.fileName}</span>
                <span>{formatBytes(selected.size)}</span>
                <span>{formatDate(selected.importedAt)}</span>
                <span>{statusLabel(selected.parseStatus)}</span>
              </div>
              <div className="source-row">
                <span>{sourceTypeLabels[selected.sourceType || "imported"] || selected.sourceType}</span>
                <span>{artifactTypeLabels[selected.artifactType || "other"] || selected.artifactType}</span>
                {renderTonePill(getDocumentLifecycle(selected).detail, getDocumentLifecycle(selected).tone)}
              </div>
              <div className="detail-path" title={selected.filePath}>{selected.filePath}</div>
              {selected.workspacePath && (
                <div className="detail-path" title={selected.workspacePath}>工作区：{selected.workspacePath}</div>
              )}

              <div className="tag-editor">
                <div className="chip-row">
                  {selected.tags.map((tag) => (
                    <button key={tag} className="chip" onClick={() => removeTag(tag)}>
                      {tag} x
                    </button>
                  ))}
                </div>
                <div className="tag-input-row">
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addTag();
                    }}
                    placeholder="添加标签"
                  />
                  <button onClick={addTag}>添加</button>
                </div>
              </div>

              {selected.parseStatus === "failed" && (
                <div className="warning">
                  <AlertTriangle size={17} />
                  <span>{selected.parseError || "解析失败"}</span>
                </div>
              )}

              {selected.duplicateOf && (
                <div className="warning neutral">
                  <FileText size={17} />
                  <span>{selected.parseError || "该文件内容与已有文档重复。"}</span>
                </div>
              )}

              <section className="preview">
                <h3>摘要</h3>
                <p>{selected.summary || "暂无摘要。"}</p>
                {isProjectResumeDocument(selected) ? (
                  <>
                    <div className="preview-heading-row">
                      <h3>Markdown 改写</h3>
                      <button
                        className="primary-button"
                        onClick={saveProjectResumePacket}
                        disabled={busy || resumeDraft === (selected.contentText || "")}
                      >
                        保存续接包
                      </button>
                    </div>
                    <textarea
                      className="markdown-editor"
                      value={resumeDraft}
                      onChange={(event) => setResumeDraft(event.target.value)}
                      spellCheck={false}
                    />
                    <p className="inline-help">保存后会写回 `project-resume.md` 并重新索引；当前确认状态会按新 hash 重新判断。</p>
                  </>
                ) : (
                  <>
                    <h3>正文预览</h3>
                    <pre>{selectedContentLoadingId === selected.id ? "正在按需加载正文..." : selected.contentText || selected.parseError || "暂无正文。"}</pre>
                  </>
                )}
              </section>

              <div className="danger-row">
                <button className="ghost-button" onClick={handleExportMemoryPackage} disabled={busy}>
                  <Bot size={16} /> 导出记忆包
                </button>
                <button className="ghost-button" onClick={() => reindexDocumentRecord(selectedVaultDocument)} disabled={busy}>
                  <RefreshCw size={16} /> 重建索引
                </button>
                <button className="danger" onClick={deleteSelected}>
                  <Trash2 size={16} /> 删除记录
                </button>
              </div>
            </>
          ) : (
            <div className="empty-detail">
              <FileText size={34} />
              <strong>选择一个文档</strong>
              <span>标题、标签、来源路径和正文预览会显示在这里。</span>
            </div>
          )}
        </aside>
      </div>
    );
  }

  function renderKnowledgeCollection(items: typeof filteredKnowledgeItems, title: string, description: string) {
    const groups = view === "project" ? [] : knowledgeProjectGroups;
    return (
      <div className="split-panel">
        <section className="collection-panel">
          <div className="section-heading">
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <div className="maintenance-actions">
              <button className="primary-button" onClick={() => generateKnowledge("heuristic", view === "project" ? "project" : "knowledge")} disabled={busy || documents.length === 0}>
                <Brain size={17} /> 整理
              </button>
              <button className="ghost-button" onClick={() => generateKnowledge("ai", view === "project" ? "project" : "knowledge")} disabled={busy || documents.length === 0}>
                <Bot size={17} /> AI 整理
              </button>
            </div>
          </div>

          <div className="cards">
            {items.length === 0 && (
              <div className="empty-state">
                <Brain size={34} />
                <strong>还没有知识条目</strong>
                <span>使用“整理”把现有历史归纳成项目知识摘要。</span>
              </div>
            )}
            {(groups.length > 0 ? groups : [{ projectName: projectLabel(effectiveProjectPath), items }]).map((group) => (
              <div key={group.projectName} className="project-group">
                <div className="project-group-heading">
                  <strong>{group.projectName}</strong>
                  <span>{group.items.length} 条知识</span>
                </div>
                {group.items.map((item) => {
                  const tone = getKnowledgeTone(item);
                  return (
                    <button
                      key={item.id}
                      className={selectedKnowledgeItem?.id === item.id ? "knowledge-item active" : "knowledge-item"}
                      onClick={() => setSelectedKnowledgeId(item.id)}
                    >
                      <div className="knowledge-item-top">
                        <span>{knowledgeCategoryLabels[item.category] || item.category}</span>
                        {renderTonePill(tone.label, tone.tone)}
                      </div>
                      <strong>{displayKnowledgeTitle(item)}</strong>
                      <p>{item.summary || item.body || "无摘要"}</p>
                      <div className="doc-tags">
                        <span>{projectLabel(item.projectPath)}</span>
                        {item.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <aside className="detail-pane">
          {selectedKnowledgeItem ? (
            <>
              <div className="detail-header with-icon">
                <Brain size={18} />
                <h3>{displayKnowledgeTitle(selectedKnowledgeItem)}</h3>
              </div>
              <div className="source-row">
                <span>{knowledgeCategoryLabels[selectedKnowledgeItem.category] || selectedKnowledgeItem.category}</span>
                <span>{selectedKnowledgeItem.provider} / {selectedKnowledgeItem.model}</span>
                {renderTonePill(getKnowledgeTone(selectedKnowledgeItem).label, getKnowledgeTone(selectedKnowledgeItem).tone)}
              </div>
              <p className="detail-summary">{selectedKnowledgeItem.summary || "暂无摘要。"}</p>
              <pre className="detail-code">{selectedKnowledgeItem.body || selectedKnowledgeItem.summary}</pre>
              <dl className="detail-list">
                <dt>来源路径</dt>
                <dd>{selectedKnowledgeItem.sourcePath || "暂无来源路径"}</dd>
                <dt>来源 Hash</dt>
                <dd>{selectedKnowledgeItem.sourceHash || "暂无来源校验"}</dd>
                <dt>项目</dt>
                <dd>{selectedKnowledgeItem.projectPath || "未关联项目"}</dd>
                <dt>更新时间</dt>
                <dd>{formatDate(selectedKnowledgeItem.updatedAt)}</dd>
                {selectedKnowledgeItem.errorMessage && (
                  <>
                    <dt>降级原因</dt>
                    <dd>{selectedKnowledgeItem.errorMessage}</dd>
                  </>
                )}
              </dl>
            </>
          ) : (
            <div className="empty-detail">
              <Brain size={34} />
              <strong>选择一个知识条目</strong>
              <span>分类、摘要、来源指针和整理方式会显示在这里。</span>
            </div>
          )}
        </aside>
      </div>
    );
  }

  function renderProjectMemoryCore() {
    const issueGroups = [
      { label: "待补全", slots: projectContinuityMissing, tone: "slate" as Tone },
      { label: "需更新", slots: projectContinuityStale, tone: "amber" as Tone },
      { label: "有冲突", slots: projectContinuityConflict, tone: "red" as Tone },
    ];
    const recallItems = projectMemoryRecallPacket?.items.slice(0, 4) || [];

    return (
      <div className="memory-core-page" data-e2e="project-memory-core">
        <div className="section-heading memory-core-page-heading">
          <div>
            <span className="section-kicker">项目记忆</span>
            <h3>项目身份、来源锚点与续接状态</h3>
            <p>这里汇总项目当前可以依赖的记忆、仍需补全的部分，以及本次为什么会想起相关内容。</p>
          </div>
          {renderTonePill(projectMemoryRecoveryLabel, projectMemoryRecoveryTone)}
        </div>

        {projectMemoryCoreLoading && !projectMemoryCoreSnapshot ? (
          <div className="memory-core-state" role="status">
            <RefreshCw size={20} className="spin" />
            <div>
              <strong>正在读取项目记忆</strong>
              <span>诊断、续接状态、首屏来源和待复核内容正在并行加载。</span>
            </div>
          </div>
        ) : null}

        {projectMemoryCoreSnapshot?.errors.length ? (
          <div className="memory-core-state tone-error" role="alert">
            <AlertTriangle size={20} />
            <div>
              <strong>部分项目记忆暂时无法读取</strong>
              <span>已显示可用内容；其余内容可在重新打开项目后再试。</span>
            </div>
          </div>
        ) : null}

        {projectMemoryCoreSnapshot && !projectMemoryCoreInitialized ? (
          <div className="memory-core-state">
            <Database size={20} />
            <div>
              <strong>项目记忆尚未初始化</strong>
              <span>扫描并整理项目后，知匣会建立项目身份和来源锚点。</span>
            </div>
          </div>
        ) : null}

        <section className="memory-core-section" aria-label="项目记忆概览">
          <div className="memory-core-summary-grid">
            <div>
              <span>连续性覆盖</span>
              <strong>{projectMemoryCoreSnapshot ? `${projectContinuityCoverage}%` : "--"}</strong>
              <div className="memory-core-progress" aria-hidden="true"><span style={{ width: `${projectContinuityCoverage}%` }} /></div>
            </div>
            <div>
              <span>恢复状态</span>
              <strong>{projectMemoryRecoveryLabel}</strong>
            </div>
            <div>
              <span>待补全 / 冲突</span>
              <strong>{projectContinuityMissing.length} / {projectContinuityConflict.length}</strong>
            </div>
            <div>
              <span>待复核</span>
              <strong>{projectMemoryReviewCount}</strong>
            </div>
          </div>
          <div className="memory-core-next-action">
            <Brain size={18} />
            <div>
              <span>最重要的下一步</span>
              <strong>{projectMemoryNextAction}</strong>
            </div>
          </div>
        </section>

        <section className="memory-core-section" aria-label="连续性槽位">
          <div className="memory-core-section-heading">
            <div>
              <h4>连续性概览</h4>
              <p>14 个固定位置帮助新线程恢复项目身份、目标、约束、进度和下一步。</p>
            </div>
            <span>{projectContinuitySlots.length} 项</span>
          </div>
          <div className="memory-core-slot-grid">
            {projectContinuitySlots.map((slot) => {
              const packetSlot = projectContinuityPacket?.continuity.slots[slot];
              const status = packetSlot?.status || (projectContinuityConflict.includes(slot)
                ? "conflict"
                : projectContinuityStale.includes(slot)
                  ? "stale"
                  : projectContinuityMissing.includes(slot)
                    ? "missing"
                    : "filled");
              const firstItem = packetSlot?.items[0];
              return (
                <div key={slot} className={`memory-core-slot status-${status}`}>
                  <div>
                    <strong>{projectContinuitySlotLabel(slot)}</strong>
                    <span>{firstItem?.summary || firstItem?.title || (status === "filled" ? "已建立当前来源" : "等待补充当前来源")}</span>
                  </div>
                  {renderTonePill(projectContinuityStatusLabel(status), projectContinuityStatusTone(status))}
                </div>
              );
            })}
          </div>
          <div className="memory-core-issue-grid">
            {issueGroups.map((group) => (
              <div key={group.label} className="memory-core-issue-group">
                <div className="memory-core-issue-title">
                  <strong>{group.label}</strong>
                  {renderTonePill(String(group.slots.length), group.tone)}
                </div>
                <span>{group.slots.length > 0 ? group.slots.map(projectContinuitySlotLabel).join("、") : "当前没有"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="memory-core-section" aria-label="当前可信来源">
          <div className="memory-core-section-heading">
            <div>
              <h4>当前可信来源摘要</h4>
              <p>只显示首屏续接结果中已经接受或精选的项目锚点，不展开内部编号和文件路径。</p>
            </div>
          </div>
          <div className="memory-core-row-list">
            {projectContinuityAnchorItems.length === 0 ? (
              <div className="memory-core-empty-row">当前还没有可显示的已接受来源摘要。</div>
            ) : projectContinuityAnchorItems.map((item) => (
              <div key={`${item.title}-${item.summary || ""}`} className="memory-core-row">
                <div>
                  <strong>{item.title || "项目来源"}</strong>
                  <span>{item.summary || "当前来源已建立，但首屏只返回了来源指针。"}</span>
                </div>
                <span>{item.authorityStatus === "curated" ? "已精选" : "已接受"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="memory-core-section" aria-label="待复核项目记忆">
          <div className="memory-core-section-heading">
            <div>
              <h4>待复核内容</h4>
              <p>这里是最多 8 条只读预览；确认、拒绝和合并仍在专门的记忆治理页完成。</p>
            </div>
            <span>{projectMemoryReviewCount} 条</span>
          </div>
          <div className="memory-core-row-list">
            {projectMemoryReviewItems.length === 0 ? (
              <div className="memory-core-empty-row">当前没有待复核的项目记忆。</div>
            ) : projectMemoryReviewItems.map((item) => (
              <div key={item.id} className="memory-core-row">
                <div>
                  <strong>{item.title || memoryCoreKindLabel(item.kind)}</strong>
                  <span>{item.summary || "等待人工复核后再作为当前项目依据。"}</span>
                </div>
                <span>{memoryCoreKindLabel(item.kind)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="memory-core-section" aria-label="召回原因">
          <div className="memory-core-section-heading">
            <div>
              <h4>为什么会想起这些内容</h4>
              <p>打开本页时只检索一次，最多返回 4 条，并限制在 700 个令牌以内。</p>
            </div>
          </div>
          {projectMemoryRecallLoading ? (
            <div className="memory-core-state compact" role="status">
              <RefreshCw size={18} className="spin" />
              <span>正在整理本次召回原因。</span>
            </div>
          ) : projectMemoryRecallError ? (
            <div className="memory-core-state compact tone-error" role="alert">
              <AlertTriangle size={18} />
              <span>本次召回原因暂时无法读取。</span>
            </div>
          ) : recallItems.length === 0 ? (
            <div className="memory-core-empty-row">当前没有找到与项目续接直接相关的记忆。</div>
          ) : (
            <div className="memory-core-recall-list">
              {recallItems.map((item) => {
                const reasons = Array.from(new Set([...(item.whyRecalled || []), ...(item.whyMatched || [])].map(memoryCoreReasonLabel))).slice(0, 3);
                const sources = item.sourceRefs.slice(0, 2).map((ref) => ref.title || memoryCoreKindLabel(ref.kind)).filter(Boolean);
                return (
                  <div key={item.id} className="memory-core-recall-row">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.summary}</span>
                    </div>
                    <div className="memory-core-recall-meta">
                      <span>{reasons.join("；") || "与当前项目记忆查询相符"}</span>
                      <span>来源：{sources.join("、") || memoryCoreKindLabel(item.kind)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="memory-core-section" aria-label="已有经验记忆">
          <div className="memory-core-section-heading">
            <div>
              <h4>已有经验记忆</h4>
              <p>保留原有项目经验，供续接时参考；本页只读展示，不在这里做治理操作。</p>
            </div>
            <span>{filteredExperienceCards.length} 条</span>
          </div>
          <div className="memory-core-row-list">
            {filteredExperienceCards.length === 0 ? (
              <div className="memory-core-empty-row">当前项目还没有经验记忆。</div>
            ) : filteredExperienceCards.map((item) => (
              <div key={item.id} className="memory-core-row">
                <div>
                  <strong>{displayMemoryTitle(item)}</strong>
                  <span>{item.summary || item.body}</span>
                </div>
                <span>{memorySourceTypeLabel(item.sourceType)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderMemoryCollection(cards: typeof filteredExperienceCards, title: string, description: string) {
    const groups = view === "project" ? [] : memoryProjectGroups;
    return (
      <div className="split-panel">
        <section className="collection-panel">
          <div className="section-heading">
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <div className="maintenance-actions">
              <button className="primary-button" onClick={importAutoflowExperience} disabled={busy}>
                <Archive size={17} /> 导入经验
              </button>
              <button className="ghost-button" onClick={() => setView("settings")}>
                <Settings size={17} /> 设置路径
              </button>
            </div>
          </div>

          <div className="cards">
            {cards.length === 0 && (
              <div className="empty-state">
                <Archive size={34} />
                <strong>还没有项目记忆</strong>
                <span>可以先导入 AutoFlow 经验，或从项目整理出的知识中补充记忆卡片。</span>
              </div>
            )}
            {(groups.length > 0 ? groups : [{ projectName: projectLabel(effectiveProjectPath), items: cards }]).map((group) => (
              <div key={group.projectName} className="project-group">
                <div className="project-group-heading">
                  <strong>{group.projectName}</strong>
                  <span>{group.items.length} 条记忆</span>
                </div>
                {group.items.map((item) => {
                  const tone = getMemoryTone(item);
                  return (
                    <button
                      key={item.id}
                      className={selectedExperienceCard?.id === item.id ? "knowledge-item active" : "knowledge-item"}
                      onClick={() => setSelectedExperienceId(item.id)}
                    >
                      <div className="knowledge-item-top">
                        <span>{memorySourceTypeLabel(item.sourceType)}</span>
                        {renderTonePill(tone.label, tone.tone)}
                      </div>
                      <strong>{displayMemoryTitle(item)}</strong>
                      <p>{item.summary || item.body}</p>
                      <div className="doc-tags">
                        <span>{projectLabel(item.projectPath)}</span>
                        {item.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <aside className="detail-pane">
          {selectedExperienceCard ? (
            <>
              <div className="detail-header with-icon">
                <Archive size={18} />
                <h3>{displayMemoryTitle(selectedExperienceCard)}</h3>
              </div>
              <div className="source-row">
                <span>{memoryScopeLabel(selectedExperienceCard.scope)}</span>
                <span>{memorySourceTypeLabel(selectedExperienceCard.sourceType)}</span>
                {renderTonePill(getMemoryTone(selectedExperienceCard).label, getMemoryTone(selectedExperienceCard).tone)}
              </div>
              <p className="detail-summary">{selectedExperienceCard.summary || "暂无摘要。"}</p>
              <pre className="detail-code">{selectedExperienceCard.body || selectedExperienceCard.summary}</pre>
              <dl className="detail-list">
                <dt>来源路径</dt>
                <dd>{selectedExperienceCard.sourcePath || "暂无来源路径"}</dd>
                <dt>来源 Hash</dt>
                <dd>{selectedExperienceCard.sourceHash || "暂无来源校验"}</dd>
                <dt>来源签名</dt>
                <dd>{sourceSignatureReviewLabel(selectedExperienceCard.sourceSignatureReviewState)} · {selectedExperienceCard.sourceSignature?.slice(0, 16) || "暂无签名"}</dd>
                <dt>治理决策</dt>
                <dd>{experienceCurationLabels[selectedExperienceCard.curationDecision || "pending"]}</dd>
                <dt>重复治理</dt>
                <dd>
                  {experienceDuplicateLabels[selectedExperienceCard.duplicateState || "unique"]}
                  {selectedExperienceCard.duplicateCount ? ` · ${selectedExperienceCard.duplicateCount} 条相似记忆` : ""}
                </dd>
                <dt>合并目标</dt>
                <dd>{selectedExperienceCard.suggestedMergeTargetId || selectedExperienceCard.duplicateOf || "暂无合并目标"}</dd>
                <dt>来源引用</dt>
                <dd>
                  {(selectedExperienceCard.sourceRefs || [])
                    .slice(0, 3)
                    .map((ref) => ref.path || ref.title || ref.kind)
                    .join(" · ") || "暂无来源引用"}
                </dd>
                <dt>项目</dt>
                <dd>{selectedExperienceCard.projectPath || "未关联项目"}</dd>
                <dt>审阅时间</dt>
                <dd>{formatDate(selectedExperienceCard.reviewedAt)}</dd>
                <dt>更新时间</dt>
                <dd>{formatDate(selectedExperienceCard.updatedAt)}</dd>
              </dl>
              <div className="writeback-actions">
                <button
                  className="primary-button"
                  onClick={() =>
                    updateExperienceStatus(
                      selectedExperienceCard.id,
                      "accepted",
                      `已保留经验记忆：${selectedExperienceCard.title}`,
                      { curationDecision: "keep" },
                    )
                  }
                  disabled={busy}
                >
                  保留
                </button>
                <button
                  className="ghost-button"
                  onClick={() =>
                    updateExperienceStatus(
                      selectedExperienceCard.id,
                      "curated",
                      `已合并经验记忆：${selectedExperienceCard.title}`,
                      { curationDecision: "merge" },
                    )
                  }
                  disabled={busy}
                >
                  合并
                </button>
                <button
                  className="ghost-button"
                  onClick={() =>
                    updateExperienceStatus(
                      selectedExperienceCard.id,
                      "rejected",
                      `已拒绝经验记忆：${selectedExperienceCard.title}`,
                      { curationDecision: "reject" },
                    )
                  }
                  disabled={busy}
                >
                  拒绝
                </button>
                <button
                  className="ghost-button"
                  onClick={() =>
                    updateExperienceStatus(
                      selectedExperienceCard.id,
                      "archived",
                      `已归档经验记忆：${selectedExperienceCard.title}`,
                      { curationDecision: "archive" },
                    )
                  }
                  disabled={busy}
                >
                  归档
                </button>
                <button
                  className="ghost-button"
                  onClick={() =>
                    updateExperienceStatus(
                      selectedExperienceCard.id,
                      "candidate",
                      `已重置经验记忆治理：${selectedExperienceCard.title}`,
                      { curationDecision: "pending" },
                    )
                  }
                  disabled={busy}
                >
                  重审
                </button>
              </div>

              {selectedSkillCandidate && (
                <section className="candidate-preview">
                  <div className="section-heading compact">
                    <div>
                      <h3>Skill 候选</h3>
                      <p>{selectedSkillCandidate.title}</p>
                    </div>
                    {renderTonePill(getMemoryTone(selectedSkillCandidate).label, getMemoryTone(selectedSkillCandidate).tone)}
                  </div>
                  <pre className="detail-code">{selectedSkillCandidate.draftSkillMarkdown}</pre>
                </section>
              )}
            </>
          ) : (
            <div className="empty-detail">
              <Archive size={34} />
              <strong>选择一张经验卡片</strong>
              <span>症状、修复规则、来源路径和 Skill 候选会显示在这里。</span>
            </div>
          )}
        </aside>
      </div>
    );
  }

  function renderMemoryWritebackQueue() {
    return (
      <section className="overview-card">
        <div className="overview-card-header">
          <div>
            <span className="section-kicker">写回队列</span>
            <h3>待确认记忆</h3>
            <p>候选经验记忆与 Skill 草稿会先停在这里，确认后才可被当作更可靠的项目记忆。Skill 候选不会自动安装。</p>
          </div>
        </div>
        {projectDocCandidateCount > 0 ? (
          <div className="writeback-bulk-actions">
            <div>
              <strong>{projectDocCandidateCount} 条项目历史候选</strong>
              <span>只处理当前范围内由 PRD、报告、README 等项目历史回填出的经验卡。</span>
            </div>
            <div className="writeback-actions">
              <button
                className="primary-button"
                onClick={() => updateProjectDocCandidateBatch("accepted", { curationDecision: "keep" })}
                disabled={busy}
              >
                保留当前历史候选
              </button>
              <button
                className="ghost-button"
                onClick={() => updateProjectDocCandidateBatch("rejected", { curationDecision: "reject" })}
                disabled={busy}
              >
                拒绝当前历史候选
              </button>
              <button
                className="ghost-button"
                onClick={() => updateProjectDocCandidateBatch("archived", { curationDecision: "archive" })}
                disabled={busy}
              >
                归档当前历史候选
              </button>
            </div>
          </div>
        ) : null}

        {memoryWritebackQueue.length === 0 ? (
          <div className="agent-log-empty compact">
            <Archive size={24} />
            <strong>当前没有待确认的记忆写回</strong>
            <span>导入的经验卡和 Skill 草稿都已经完成确认、精选、拒绝或归档。</span>
          </div>
        ) : (
          <div className="writeback-queue">
            {memoryWritebackQueue.map((item) => (
              <div key={`${item.kind}-${item.id}`} className="writeback-row">
                <div className="writeback-row-head">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.sourcePath || item.projectPath || "未提供来源路径"}</span>
                  </div>
                  <div className="writeback-pills">
                    {renderTonePill(item.kind === "experience_card" ? "经验候选" : "Skill 草稿", item.kind === "experience_card" ? "amber" : "slate")}
                    {renderTonePill(memoryStatusLabel(item.status), item.kind === "experience_card" ? "amber" : "slate")}
                  </div>
                </div>

                <p>{item.summary}</p>
                <div className="timeline-meta wrap">
                  <span>为什么需要确认：{item.risk}</span>
                </div>
                <div className="timeline-meta wrap">
                  <span>建议动作：{item.suggestedAction}</span>
                  <span>更新时间：{formatDate(item.updatedAt)}</span>
                </div>

                <div className="writeback-actions">
                  <button
                    className="ghost-button"
                    onClick={() => {
                      if (item.kind === "experience_card") {
                        setSelectedExperienceId(item.id);
                      } else {
                        setSelectedSkillCandidateId(item.id);
                      }
                    }}
                  >
                    查看详情
                  </button>

                  {item.kind === "experience_card" ? (
                    <>
                      <button
                        className="primary-button"
                        onClick={() =>
                          updateExperienceStatus(item.id, "accepted", `已保留经验记忆：${item.title}`, {
                            curationDecision: "keep",
                          })
                        }
                        disabled={busy}
                      >
                        确认
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() =>
                          updateExperienceStatus(item.id, "curated", `已合并经验记忆：${item.title}`, {
                            curationDecision: "merge",
                          })
                        }
                        disabled={busy}
                      >
                        精选
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() =>
                          updateExperienceStatus(item.id, "archived", `已归档经验候选：${item.title}`, {
                            curationDecision: "archive",
                          })
                        }
                        disabled={busy}
                      >
                        归档
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() =>
                          updateExperienceStatus(item.id, "rejected", `已拒绝经验候选：${item.title}`, {
                            curationDecision: "reject",
                          })
                        }
                        disabled={busy}
                      >
                        拒绝
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => updateExperienceStatus(item.id, "stale", `已标记过期经验：${item.title}`)}
                        disabled={busy}
                      >
                        过期
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="primary-button"
                        onClick={() => updateSkillCandidateStatus(item.id, "approved", `已批准 Skill 草稿：${item.title}`)}
                        disabled={busy}
                      >
                        批准草稿
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => updateSkillCandidateStatus(item.id, "rejected", `已拒绝 Skill 草稿：${item.title}`)}
                        disabled={busy}
                      >
                        拒绝
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderVaultWorkspace() {
    const activeSection = vaultSections.find((section) => section.key === vaultSection) || vaultSections[0];
    const selectedVaultPath = selectedVaultDocument ? vaultRelativePath(selectedVaultDocument) : "";
    const selectedSectionLabel = selectedVaultDocument ? vaultSectionLabels[vaultSectionFromPath(selectedVaultPath)] : "";

    return (
      <div className="vault-layout">
        <section className="vault-main">
          <div className="project-header vault-header">
            <div>
              <span className="section-kicker">PERSONAL VAULT</span>
              <h2>个人知识库</h2>
              <p>{personalVaultPath}</p>
            </div>
            <div className="maintenance-actions">
              <button
                className="ghost-button"
                onClick={() =>
                  loadDocuments()
                    .then(() => setNotice("个人知识库已刷新。"))
                    .catch((error) => setNotice(`个人知识库刷新失败：${error instanceof Error ? error.message : String(error)}`))
                }
                disabled={busy}
              >
                <RefreshCw size={16} /> 刷新
              </button>
              <button className="ghost-button" onClick={() => window.docKnowledge.revealStore()}>
                <FolderOpen size={16} /> 数据目录
              </button>
            </div>
          </div>

          <div className="vault-stats">
            <div>
              <span>全部文件</span>
              <strong>{personalVaultDocuments.length}</strong>
            </div>
            <div>
              <span>链接收件箱</span>
              <strong>{vaultCounts.inbox}</strong>
            </div>
            <div>
              <span>笔记</span>
              <strong>{vaultCounts.notes}</strong>
            </div>
            <div>
              <span>来源证据</span>
              <strong>{vaultCounts.sources}</strong>
            </div>
          </div>

          <div className="vault-section-tabs" role="tablist" aria-label="个人知识库分区">
            {vaultSections.map((section) => (
              <button
                key={section.key}
                className={vaultSection === section.key ? "vault-section-button active" : "vault-section-button"}
                onClick={() => {
                  setVaultSection(section.key);
                  const firstInSection = personalVaultDocuments
                    .filter((doc) => vaultSectionFromPath(vaultRelativePath(doc)) === section.key)
                    .sort((a, b) => new Date(b.updatedAt || b.importedAt).getTime() - new Date(a.updatedAt || a.importedAt).getTime())[0];
                  if (firstInSection) setSelectedId(firstInSection.id);
                }}
                role="tab"
                aria-selected={vaultSection === section.key}
              >
                <strong>{section.label}</strong>
                <span>{vaultCounts[section.key]} 个 · {section.detail}</span>
              </button>
            ))}
          </div>

          <section className="collection-panel vault-list-panel">
            <div className="section-heading">
              <div>
                <h3>{activeSection.label}</h3>
                <p>{activeSection.detail}</p>
              </div>
              {renderTonePill(`${vaultDocumentCards.length} 个`, vaultDocumentCards.length > 0 ? "teal" : "slate")}
            </div>

            <div className="cards">
              {vaultDocumentCards.length === 0 && (
                <div className="empty-state">
                  <FolderOpen size={34} />
                  <strong>这个分区还没有内容</strong>
                  <span>把链接分析结果或 Markdown 放进个人知识库目录后，刷新索引就会出现在这里。</span>
                </div>
              )}
              {vaultDocumentCards.map((doc) => {
                const lifecycle = getDocumentLifecycle(doc);
                return (
                  <button
                    key={doc.id}
                    className={selectedVaultDocument?.id === doc.id ? "vault-content-card selected" : "vault-content-card"}
                    onClick={() => setSelectedId(doc.id)}
                    title={doc.displayTitle}
                  >
                    <div className="vault-card-top">
                      <span className="section-kicker">{vaultSectionLabels[doc.vaultSection]}</span>
                      {renderTonePill(lifecycle.label, lifecycle.tone)}
                    </div>
                    <strong>{doc.displayTitle}</strong>
                    <p>{query.trim() ? renderHighlightedSnippet(doc.displaySummary, query) : doc.displaySummary}</p>
                    {doc.tags.length > 0 && (
                      <div className="doc-tags">
                        {doc.tags.slice(0, 4).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                        {doc.tags.length > 4 && <span>+{doc.tags.length - 4}</span>}
                      </div>
                    )}
                    <div className="vault-card-meta">
                      <span>{vaultSectionLabels[doc.vaultSection]}</span>
                      <span>{formatDate(doc.updatedAt || doc.importedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="detail-pane vault-detail">
          {selectedVaultDocument ? (
            <>
              <div className="detail-header">
                <input
                  className="title-input"
                  value={selectedVaultDocument.title}
                  onChange={(event) => updateDocumentById(selectedVaultDocument.id, { title: event.target.value })}
                />
                <button
                  className={selectedVaultDocument.favorite ? "icon-button starred" : "icon-button"}
                  onClick={() => updateDocumentById(selectedVaultDocument.id, { favorite: !selectedVaultDocument.favorite })}
                  title="星标"
                >
                  <Star size={18} />
                </button>
              </div>
              <div className="source-row">
                <span>{selectedSectionLabel}</span>
                <span>{statusLabel(selectedVaultDocument.parseStatus)}</span>
                <span>{formatDate(selectedVaultDocument.updatedAt || selectedVaultDocument.importedAt)}</span>
              </div>
              <details className="tool-record-details">
                <summary>来源信息</summary>
                <div className="detail-path" title={selectedVaultDocument.filePath}>{selectedVaultPath}</div>
                <div className="detail-path" title={selectedVaultDocument.filePath}>{selectedVaultDocument.filePath}</div>
              </details>

              <div className="tag-editor">
                <div className="chip-row">
                  {selectedVaultDocument.tags.map((tag) => (
                    <button
                      key={tag}
                      className="chip"
                      onClick={() =>
                        updateDocumentById(selectedVaultDocument.id, {
                          tags: selectedVaultDocument.tags.filter((item) => item !== tag),
                        })
                      }
                    >
                      {tag} x
                    </button>
                  ))}
                </div>
                <div className="tag-input-row">
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        const next = tagDraft.trim();
                        if (next && !selectedVaultDocument.tags.includes(next)) {
                          updateDocumentById(selectedVaultDocument.id, { tags: [...selectedVaultDocument.tags, next] });
                        }
                        setTagDraft("");
                      }
                    }}
                    placeholder="添加标签"
                  />
                  <button
                    onClick={() => {
                      const next = tagDraft.trim();
                      if (next && !selectedVaultDocument.tags.includes(next)) {
                        updateDocumentById(selectedVaultDocument.id, { tags: [...selectedVaultDocument.tags, next] });
                      }
                      setTagDraft("");
                    }}
                  >
                    添加
                  </button>
                </div>
              </div>

              <section className="preview">
                <h3>摘要</h3>
                <p>{selectedVaultDocument.summary || "暂无摘要。"}</p>
                <h3>完整内容</h3>
                <pre>{selectedContentLoadingId === selectedVaultDocument.id ? "正在按需加载正文..." : selectedVaultDocument.contentText || selectedVaultDocument.parseError || "暂无正文。"}</pre>
              </section>

              <div className="danger-row">
                <button className="ghost-button" onClick={reindexSelected} disabled={busy}>
                  <RefreshCw size={16} /> 重建索引
                </button>
                <button className="danger" onClick={() => deleteDocumentRecord(selectedVaultDocument)}>
                  <Trash2 size={16} /> 删除记录
                </button>
              </div>
            </>
          ) : (
            <div className="empty-detail">
              <FolderOpen size={34} />
              <strong>个人库还没有入库内容</strong>
              <span>导入分享链接分析、笔记或主题图谱后，这里会显示完整正文。</span>
            </div>
          )}
        </aside>
      </div>
    );
  }

  function renderProjectWorkspace() {
    return !activeProject ? (
      <section className="collection-shell project-home" data-e2e="project-home">
        <div className="section-heading project-home-heading">
          <div>
            <h2>项目</h2>
            <p>按项目查看历史、知识、记忆和工具。点开一个项目后，再看它做过什么、进度到哪、下次 Codex 应该调取哪些资料。</p>
            {query.trim() ? (
              <p className="search-result-note">
                正在搜索“{clipText(query.trim(), 48)}”：命中 {projectCards.length} 个项目，{projectLeads.length} 条待整理线索。
              </p>
            ) : null}
          </div>
          <div className="maintenance-actions">
            <button className="ghost-button" onClick={generateProjectSummaries} disabled={busy || documents.length === 0}>
              <Bot size={17} /> AI 生成摘要
            </button>
            <button className="primary-button" onClick={scanCodexWorkspace} disabled={busy}>
              <RefreshCw size={17} /> 扫描并整理项目
            </button>
          </div>
        </div>

        <div className="project-card-grid">
          {projectCards.length === 0 ? (
            <div className="empty-state project-home-empty">
              <Database size={34} />
              <strong>{query.trim() ? "没有搜到匹配项目" : "还没有识别项目"}</strong>
              <span>
                {query.trim()
                  ? "可以换一个关键词，或去“智能优化”里搜索老线程；后续会继续把归档历史关联回项目。"
                  : "点击“扫描并整理项目”后，知匣会优先显示真正可继续的项目；零散资料会先放到待整理线索。"}
              </span>
            </div>
          ) : null}
          {projectCards.map(({ project, projectDocs, projectMemory, projectKnowledge }) => {
            const progressStage = inferProjectCompletionFromDocuments(projectDocs);
            const progressPercent = completionPercentForProjectStage(progressStage);
            const healthTone = project.staleCount > 0 ? "red" : project.reviewCount > 0 ? "amber" : "teal";
            const projectRecordOverride = settings.projectRecordOverrides?.[project.path] || null;
            const rawDisplayName = isUsefulProjectCardTitle(projectRecordOverride?.displayName)
              ? projectRecordOverride?.displayName || ""
              : readableProjectDisplayName(project.path, projectDocs);
            const displayName = polishProjectNameText(rawDisplayName);
            const intro = projectCardSummaryText(project.path, projectDocs, projectMemory, projectKnowledge, projectRecordOverride?.lastSummary);
            return (
              <button key={project.path} className="project-card" onClick={() => openProject(project.path)} title={project.path}>
                <div className="project-card-top">
                  <div>
                    <span className="section-kicker">项目</span>
                    <h3>{displayName}</h3>
                  </div>
                  {renderTonePill(projectCompletionLabel(progressStage), healthTone)}
                </div>
                <p>{intro}</p>
                <div className="project-progress-row" aria-label={`项目进度 ${progressPercent}%`}>
                  <div className="project-progress">
                    <span style={{ width: `${progressPercent}%` }} />
                  </div>
                  <span>{progressPercent}%</span>
                </div>
                <div className="project-card-meta">
                  <span>{project.count} 历史</span>
                  <span>{projectMemory?.knowledgeItems || 0} 知识</span>
                  <span>{projectMemory?.experienceCards || 0} 记忆</span>
                </div>
              </button>
            );
          })}
        </div>
        {projectLeads.length > 0 && (
          <details className="secondary-section">
            <summary>待整理线索（{projectLeads.length}）</summary>
            <div className="overview-list">
              {projectLeads.map(({ project, projectDocs, classification }) => (
                <button key={project.path} className="overview-row" onClick={() => openProject(project.path)} title={project.path}>
                  <div>
                    <strong>{polishProjectNameText(readableProjectDisplayName(project.path, projectDocs), 34)}</strong>
                    <span>{classification.reasons[0] || "资料还不够像一个完整项目"}</span>
                  </div>
                  {renderTonePill(classification.label, "amber")}
                </button>
              ))}
            </div>
          </details>
        )}
      </section>
    ) : (
      <div className="project-layout project-layout--solo">
        <section className="project-main">
          <div className="project-header">
            <div>
              <button className="text-link" onClick={() => setActiveProject(null)}>
                ← 返回项目列表
              </button>
              <h2>{projectTitle}</h2>
              <p>{effectiveProjectPath || "尚未识别项目，可先扫描 Codex 工作区。"}</p>
            </div>
            <div className="maintenance-actions">
              <button className="ghost-button" onClick={() => generateSingleProjectSummary(effectiveProjectPath)} disabled={busy || !effectiveProjectPath}>
                <Bot size={17} /> 刷新本项目摘要
              </button>
            </div>
          </div>

          <div className="status-strip">
            <div className="status-strip-item">
              <span>当前有效</span>
              <strong>{projectStatus.activeCount}</strong>
            </div>
            <div className="status-strip-item">
              <span>待确认</span>
              <strong>{projectStatus.reviewCount}</strong>
            </div>
            <div className="status-strip-item">
              <span>过期</span>
              <strong>{projectStatus.staleCount}</strong>
            </div>
            <div className="status-strip-item">
              <span>最近扫描</span>
              <strong>{formatDate(projectStatus.lastScannedAt)}</strong>
            </div>
          </div>

          <div className="tab-row">
            {[
              { key: "overview", label: "总览" },
              { key: "documents", label: "历史" },
              { key: "knowledge", label: "知识条目" },
              { key: "memory", label: "项目记忆" },
              { key: "handoff", label: "决策与交接" },
            ].map((tab) => (
              <button
                key={tab.key}
                className={projectTab === tab.key ? "tab-button active" : "tab-button"}
                onClick={() => setProjectTab(tab.key as ProjectTabKey)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {projectTab === "overview" ? (
            <div className="overview-grid">
              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">0. 项目进度</span>
                    <h3>这个项目现在做到哪了</h3>
                    <p>知匣会按项目来源自动估算进度、状态和下一步；Codex 下次接手时优先读取这份项目档案。</p>
                  </div>
                  {renderTonePill(projectRecordConfirmed ? "已记录" : projectRecordReviewState === "stale" ? "来源有变化" : "自动估算", projectRecordConfirmed ? "teal" : "amber")}
                </div>
                <div className="overview-list">
                  <div className="overview-row static-row">
                    <div>
                      <strong>{projectTitle}</strong>
                      <span>
                        {projectRecordOverride
                          ? `${projectRecordStatusLabel(projectRecordOverride.status)} / ${projectCompletionLabel(projectRecordOverride.completion)} / ${projectRecordOverride.completionPercent}%`
                          : `${healthStatusLabel} / ${projectCompletionLabel(inferProjectCompletionFromDocuments(projectDocuments))} / ${completionPercentForProjectStage(inferProjectCompletionFromDocuments(projectDocuments))}%`}
                      </span>
                      <span>
                        {projectRecordOverride
                          ? projectRecordReviewState === "stale"
                            ? `上次确认：${formatDate(projectRecordOverride.confirmedAt)}；项目来源已变化，需重新确认。`
                            : `确认时间：${formatDate(projectRecordOverride.confirmedAt)}`
                          : "当前是自动估算的项目档案，后续扫描会继续更新。"}
                      </span>
                    </div>
                    <div className="overview-row-end">
                        {renderTonePill(projectRecordConfirmed ? "已记录" : projectRecordReviewState === "stale" ? "要复看" : "自动", projectRecordConfirmed ? "teal" : "amber")}
                    </div>
                  </div>
                </div>
              </section>

              <section className="overview-card memory-core-overview-card" data-e2e="project-memory-core-overview">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">1. 项目记忆核心</span>
                    <h3>项目是否能被完整接续</h3>
                    <p>查看项目身份、来源锚点、连续性覆盖和当前最需要补全的内容。</p>
                  </div>
                  {renderTonePill(projectMemoryRecoveryLabel, projectMemoryRecoveryTone)}
                </div>
                {projectMemoryCoreSnapshot && !projectMemoryCoreInitialized ? (
                  <div className="memory-core-inline-note">
                    <Database size={18} />
                    <span>扫描并整理项目后，知匣会建立项目身份和来源锚点。</span>
                  </div>
                ) : null}
                <div className="memory-core-overview-metrics">
                  <div><span>连续性覆盖</span><strong>{projectMemoryCoreSnapshot ? `${projectContinuityCoverage}%` : "读取中"}</strong></div>
                  <div><span>待补全</span><strong>{projectContinuityMissing.length}</strong></div>
                  <div><span>冲突</span><strong>{projectContinuityConflict.length}</strong></div>
                  <div><span>待复核</span><strong>{projectMemoryReviewCount}</strong></div>
                </div>
                <button className="memory-core-next-link" onClick={() => setProjectTab("memory")}>
                  <div>
                    <span>最重要的下一步</span>
                    <strong>{projectMemoryNextAction}</strong>
                  </div>
                  <ChevronRight size={17} />
                </button>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">2. 续接摘要</span>
                    <h3>新线程接手要看的摘要</h3>
                    <p>给 Codex 恢复上下文用：当前目标、关键决定、风险和下一步会被压成一份可检索摘要。</p>
                  </div>
                  {renderTonePill(projectResumeDoc ? (projectResumeConfirmed ? "已记录" : "自动生成") : "未生成", projectResumeDoc ? (projectResumeConfirmed ? "teal" : "amber") : "slate")}
                </div>
                <div className="overview-list">
                  {projectResumeDoc ? (
                    <div className="overview-row static-row">
                      <div>
                        <strong>{projectResumeDoc.fileName}</strong>
                        <span>{clipText(projectResumeDoc.summary || projectResumeDoc.filePath, 180)}</span>
                        <span>{projectResumeConfirmed ? `记录时间：${formatDate(projectResumeConfirmation?.confirmedAt || null)}` : "自动生成，Codex 可作为续接参考。"}</span>
                      </div>
                      <div className="overview-row-end">
                        {renderTonePill(projectResumeConfirmed ? "已记录" : "可查看", projectResumeConfirmed ? "teal" : "amber")}
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setSelectedId(projectResumeDoc.id);
                            setProjectTab("documents");
                          }}
                        >
                          打开
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="overview-row empty">
                      <span>扫描项目或重新整理后，知匣会生成一份项目续接摘要。</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">3. AI 可用资料</span>
                    <h3>哪些历史和资料可以放心调取</h3>
                    <p>这里记录项目历史、报告、发布记录等来源的状态；AI 检索会优先用当前有效资料，变化过的来源会提示复看。</p>
                  </div>
                  {renderTonePill(projectArtifactsStatusLabel, projectArtifactsStatusTone)}
                </div>
                <div className="overview-list">
                  {projectArtifactsMarkdownDoc || projectArtifactsJsonDoc ? (
                    <>
                      <div className="overview-row static-row">
                        <div>
                          <strong>资料状态</strong>
                          <span>{projectArtifactsStatusMessage}</span>
                          <span>Codex 会把这批项目资料当作可优先检索的来源；来源变化后会提示复看。</span>
                          <span>这只是来源目录和摘要，不替代真实源文件。</span>
                        </div>
                        <div className="overview-row-end">
                          {renderTonePill(projectArtifactsMapStatus === "confirmed" ? "已记录" : "自动索引", projectArtifactsStatusDetailTone)}
                        </div>
                      </div>
                      {projectArtifactsMarkdownDoc ? (
                        <div className="overview-row static-row">
                          <div>
                            <strong>{projectArtifactsMarkdownDoc.fileName}</strong>
                            <span>{clipText(projectArtifactsMarkdownDoc.summary || projectArtifactsMarkdownDoc.filePath, 180)}</span>
                            <span>给人和 Codex 快速查看文档状态、产出角色和来源路径；结论仍需回到真实源文档复核。</span>
                          </div>
                          <div className="overview-row-end">
                            {renderTonePill("来源索引", "amber")}
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setSelectedId(projectArtifactsMarkdownDoc.id);
                                setProjectTab("documents");
                              }}
                            >
                              打开
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {projectArtifactsJsonDoc ? (
                        <div className="overview-row static-row">
                          <div>
                            <strong>{projectArtifactsJsonDoc.fileName}</strong>
                            <span>{clipText(projectArtifactsJsonDoc.summary || projectArtifactsJsonDoc.filePath, 180)}</span>
                            <span>给 agent 检索和后续 UI 治理使用的结构化 artifact contract，不是独立权威数据源。</span>
                          </div>
                          <div className="overview-row-end">
                            {renderTonePill("contract", "teal")}
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setSelectedId(projectArtifactsJsonDoc.id);
                                setProjectTab("documents");
                              }}
                            >
                              打开
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="overview-row empty">
                      <span>扫描项目或重新整理项目知识后生成 `.codex-knowledge/project-artifacts.md/json`。</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">4. 工具与 Skill 资产</span>
                    <h3>工具资产目录</h3>
                    <p>只读候选资产目录，展示 `.codex-knowledge/tool-skill-inventory.md/json` 导出证据；资产目录和单条治理都只写人工复核记录，不会安装、启用、执行或提升候选状态。</p>
                  </div>
                  {renderTonePill(toolSkillInventoryStatusLabel, toolSkillInventoryStatusTone)}
                </div>
                <div className="overview-list">
                  {toolSkillInventory ? (
                    <>
                      <div className="overview-row static-row">
                        <div>
                          <strong>资产目录状态</strong>
                          <span>{toolSkillInventoryStatusMessage}</span>
                          <span>
                            候选 {toolSkillInventory.inventory.candidateCount || 0} · 已治理 {toolSkillGovernanceCounts.decided} · 待复核 {toolSkillGovernanceCounts.stale} · 总记录 {toolSkillInventoryRecords.length}
                          </span>
                          <span>资产指纹：{clipText(toolSkillInventory.snapshotHash, 36)}</span>
                        </div>
                        <div className="overview-row-end">
                          {renderTonePill(toolSkillInventoryMapStatus === "confirmed" ? "已记录" : "自动整理", toolSkillInventoryMapStatus === "confirmed" ? "teal" : "amber")}
                          <button className="ghost-button" onClick={() => loadToolSkillInventory(effectiveProjectPath)} disabled={busy || !effectiveProjectPath}>
                            刷新
                          </button>
                        </div>
                      </div>
                      <div className="overview-row static-row">
                        <div>
                          <strong>导出文件</strong>
                          <span>{toolSkillInventory.files.markdown.exists ? toolSkillInventory.files.markdown.path : "等待 tool-skill-inventory.md"}</span>
                          <span>{toolSkillInventory.files.json.exists ? toolSkillInventory.files.json.path : "等待 tool-skill-inventory.json"}</span>
                          <span>来源变化时会提示复看，但不会自动安装或执行工具。</span>
                        </div>
                        <div className="overview-row-end">
                          {renderTonePill(toolSkillInventory.files.markdown.exists || toolSkillInventory.files.json.exists ? "已有导出证据" : "等待生成", toolSkillInventory.files.markdown.exists || toolSkillInventory.files.json.exists ? "teal" : "amber")}
                        </div>
                      </div>
                      {toolSkillInventoryPreviewRecords.map((record) => (
                        <div key={record.id} className="overview-row static-row">
                          <div>
                            <strong>{record.name}</strong>
                            <span>{clipText(record.summary || record.sourcePath || record.id, 180)}</span>
                            <span>{record.sourcePath || record.installPath || "暂无来源路径"}</span>
                            <span>{record.riskBoundaries.slice(0, 2).join("；")}</span>
                          </div>
                          <div className="overview-row-end">
                            {renderTonePill(toolKindLabel(record.kind), "slate")}
                            {renderTonePill(toolSkillRecordStatusLabel(record.status), record.status === "candidate" ? "amber" : "slate")}
                          </div>
                        </div>
                      ))}
                      {toolSkillInventoryRecords.length === 0 ? (
                        <div className="overview-row empty">
                          <span>当前项目还没有发现 Skill、工作流脚本或项目工具候选。</span>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="overview-row empty">
                      <span>{toolSkillInventoryError || "扫描项目或重新整理项目知识后生成 `.codex-knowledge/tool-skill-inventory.md/json`。"}</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">5. 当前有效历史</span>
                    <h3>按当前项目可直接引用的来源排序</h3>
                  </div>
                </div>
                <div className="overview-list">
                  {coreDocuments.length === 0 && (
                    <div className="overview-row empty">
                      <span>还没有项目历史，先点击右上角“扫描并整理项目”。</span>
                    </div>
                  )}
                  {coreDocuments.map((doc) => {
                    const lifecycle = getDocumentLifecycle(doc);
                    return (
                      <button key={doc.id} className="overview-row" onClick={() => { setSelectedId(doc.id); setProjectTab("documents"); }}>
                        <div>
                          <strong>{doc.fileName}</strong>
                          <span>{artifactTypeLabels[doc.artifactType || "other"] || "文档"}</span>
                        </div>
                        <div className="overview-row-end">
                          {renderTonePill(lifecycle.label, lifecycle.tone)}
                          <ChevronRight size={16} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">6. 待整理队列</span>
                    <h3>用现有数据推断的可审阅事项</h3>
                  </div>
                </div>
                <div className="overview-list">
                  {queueRows.map((item) => (
                    <div key={item.label} className="overview-row static-row">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                      <div className="overview-row-end">
                        {renderTonePill(item.count > 0 ? "review" : "clear", item.count > 0 ? "amber" : "slate")}
                        <span className="count-badge">{item.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">7. 经验与交接</span>
                    <h3>经验、决策、交接和 worker 写回</h3>
                  </div>
                </div>
                <div className="overview-list">
                  {memoryRows.map((item) => (
                    <button key={item.label} className="overview-row" onClick={() => { setProjectTab("memory"); }}>
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                      <div className="overview-row-end">
                        {renderTonePill(item.count > 0 ? (item.label === "Worker 回报" ? "active" : "curated") : "empty", item.count > 0 ? item.tone : "slate")}
                        <span className="count-badge">{item.count}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">8. 下一次 Codex 会使用</span>
                    <h3>面向可验证检索的预览骨架</h3>
                  </div>
                </div>
                <div className="overview-list">
                  {nextCodexRows.map((item) => (
                    <div key={item.label} className="overview-row static-row">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {projectTab === "documents" ? renderDocumentCollection(projectDocumentCards, "项目历史", `${projectDocumentCards.length} 条项目来源仍可直接查看和导出。`) : null}
          {projectTab === "knowledge" ? renderKnowledgeCollection(filteredKnowledgeItems, "项目知识条目", `${filteredKnowledgeItems.length} 条整理结果，保留来源路径和提供者信息。`) : null}
          {projectTab === "memory" ? renderProjectMemoryCore() : null}

          {projectTab === "handoff" ? (
            <section className="collection-shell">
              <div className="section-heading">
                <div>
                  <h3>决策与交接</h3>
                  <p>这里只展示当前项目里最接近决策日志、handoff 和 worker 回报的可追溯条目。</p>
                </div>
              </div>
              <div className="timeline-list">
                {decisionAndHandoffRows.length === 0 && (
                  <div className="empty-state">
                    <Clock3 size={34} />
                    <strong>还没有决策与交接条目</strong>
                    <span>可以先整理知识条目，或导入 AutoFlow 经验后再回到这里查看。</span>
                  </div>
                )}
                {decisionAndHandoffRows.map((item) => (
                  <article key={`${item.kind}-${item.id}`} className="timeline-item">
                    <div className="timeline-head">
                      <strong>{item.title}</strong>
                      {renderTonePill(item.kind, item.kind === "决策" ? "teal" : "amber")}
                    </div>
                    <p>{clipText(item.summary, 220)}</p>
                    <div className="timeline-meta">
                      <span>{item.sourcePath}</span>
                      <span>{formatDate(item.updatedAt)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </section>

      </div>
    );
  }

  function renderDocumentsWorkspace() {
    return (
      <section className="collection-shell">
        <div className="section-heading">
          <div>
            <h2>历史</h2>
            <p>{query.trim() ? `${documentCards.length} 个搜索结果` : `${documentCards.length} 条项目历史，按项目保留来源、摘要和时间线，方便 AI 回看。`}</p>
          </div>
          <div className="maintenance-actions">
            <button className="primary-button" onClick={importDocuments} disabled={busy}>
              <Import size={17} /> 导入历史
            </button>
            <button className="ghost-button" onClick={importFolder} disabled={busy}>
              <FolderOpen size={17} /> 扫描文件夹
            </button>
            <button className="ghost-button" onClick={exportMetadata}>
              <Download size={17} /> 导出元数据
            </button>
          </div>
        </div>

        <div className="filter-row">
          {(Object.keys(documentFilterLabels) as DocFilterKey[]).map((key) => (
            <button key={key} className={docFilter === key ? "filter-chip active" : "filter-chip"} onClick={() => setDocFilter(key)}>
              {documentFilterLabels[key]}
            </button>
          ))}
        </div>

        <div className="tag-list">
          {tags.length === 0 && <span className="muted">暂无标签</span>}
          {tags.slice(0, 10).map(([tag, count]) => (
            <button key={tag} className={activeTag === tag ? "tag active" : "tag"} onClick={() => setActiveTag(activeTag === tag ? null : tag)}>
              {tag}
              <small>{count}</small>
            </button>
          ))}
        </div>

        {renderDocumentCollection(
          documentCards,
          docFilter === "project" ? `${projectTitle} 的项目历史` : "全部历史",
          docFilter === "project" ? "这些历史会作为 AI 检索来源，保留原始路径、摘要和更新时间。" : "保留原始来源、标签、摘要与正文预览。",
        )}
      </section>
    );
  }

  function renderKnowledgeWorkspace() {
    return (
      <section className="collection-shell" data-e2e="knowledge-workspace">
        <div className="section-heading">
          <div>
            <h2>知识</h2>
            <p>{knowledgeOverview?.total ?? 0} 条项目知识，按项目自动整理成 AI 可调取的短摘要，人看时也能快速知道这批资料讲什么。</p>
          </div>
        </div>
        {renderKnowledgeCollection(filteredKnowledgeItems, "按项目分类的知识", "每条知识都有中文标题、来源路径和整理状态；Codex 检索时默认先查当前项目。")}
      </section>
    );
  }

  function renderMemoryWorkspace() {
    return (
      <section className="collection-shell" data-e2e="memory-workspace">
        <div className="section-heading">
          <div>
            <h2>记忆</h2>
            <p>{memoryOverview?.experienceCards ?? 0} 条项目记忆，{memoryOverview?.skillCandidates ?? 0} 个工具草稿；bug 修复经验、工作流经验和项目决定都会按项目复用。</p>
          </div>
        </div>
        {renderMemoryWritebackQueue()}
        {renderMemoryCollection(filteredExperienceCards, "按项目分类的记忆", "这些是给 Codex 下次自动调取的项目经验；普通浏览不需要逐条确认。")}
      </section>
    );
  }

  function renderToolsWorkspace() {
    const hasExportEvidence = Boolean(toolSkillInventory?.files.markdown.exists || toolSkillInventory?.files.json.exists);
    return (
      <section className="collection-shell tools-page" data-e2e="tools-workspace">
        <div className="section-heading">
          <div>
            <h2>工具资产目录</h2>
            <p>
              知匣会把 Codex 官方工具、你自己做的工具、项目脚本、插件和本地自动化按项目整理出来，说明名称、用途、创建时间、用在哪个项目和风险边界。这里只整理，不安装、不启用、不执行。
            </p>
          </div>
          <div className="maintenance-actions">
            <button className="ghost-button" onClick={() => scanToolSkillInventorySnapshot(effectiveProjectPath)} disabled={busy || !effectiveProjectPath}>
              <RefreshCw size={17} /> 刷新/扫描
            </button>
          </div>
        </div>

        <div className="tools-dashboard">
          <section className="overview-card">
            <div className="overview-card-header">
              <div>
                <span className="section-kicker">自动整理</span>
                <h3>工具资产整理状态</h3>
                <p>{toolSkillInventoryStatusMessage}</p>
              </div>
              {renderTonePill(toolSkillInventoryStatusLabel, toolSkillInventoryStatusTone)}
            </div>
            <dl className="tool-summary-grid">
              <div>
                <dt>当前项目</dt>
                <dd>{effectiveProjectPath || "未选择项目"}</dd>
              </div>
              <div>
                <dt>整理批次</dt>
                <dd title={toolSkillInventory?.snapshotHash || ""}>{toolSkillInventory?.snapshotHash ? clipText(toolSkillInventory.snapshotHash, 22) : "未生成"}</dd>
              </div>
              <div>
                <dt>整理状态</dt>
                <dd>{toolSkillInventory?.confirmation?.confirmedAt ? `${toolSkillInventoryStateLabel(toolSkillInventoryMapStatus)} · ${formatDate(toolSkillInventory.confirmation.confirmedAt)}` : toolSkillInventoryStateLabel(toolSkillInventoryMapStatus)}</dd>
              </div>
              <div>
                <dt>资产数量</dt>
                <dd>
                  总数 {toolSkillInventoryRecords.length} · 候选 {toolSkillInventory?.inventory.candidateCount || 0} · 已治理 {toolSkillGovernanceCounts.decided} · 待复核 {toolSkillGovernanceCounts.stale}
                </dd>
              </div>
              <div>
                <dt>记录复核</dt>
                <dd>
                  当前 {toolSkillGovernanceCounts.current} · 未复核 {toolSkillGovernanceCounts.unreviewed} · 待复核 {toolSkillGovernanceCounts.stale}
                </dd>
              </div>
              <div>
                <dt>给人看的目录</dt>
                <dd title={toolSkillInventory?.files.markdown.path || ""}>{toolEvidenceLabel(toolSkillInventory?.files.markdown.exists ? toolSkillInventory.files.markdown.path : "", "Markdown")}</dd>
              </div>
              <div>
                <dt>给 AI 看的目录</dt>
                <dd title={toolSkillInventory?.files.json.path || ""}>{toolEvidenceLabel(toolSkillInventory?.files.json.exists ? toolSkillInventory.files.json.path : "", "JSON")}</dd>
              </div>
            </dl>
          </section>

          <section className="overview-card">
            <div className="overview-card-header">
              <div>
                <span className="section-kicker">安全规则</span>
                <h3>整理规则</h3>
                <p>扫描只读来源说明和路径，跳过敏感配置；知匣会自动把工具整理成候选目录，不会把候选工具变成可自动执行工具。</p>
              </div>
              {renderTonePill("只整理，不执行", "amber")}
            </div>
            <div className="tool-policy-grid">
              {[
                ["只读整理", toolSkillInventory?.policy.readOnlyCandidate],
                ["需要人工确认", toolSkillInventory?.policy.requiresHumanConfirmation],
                ["不自动安装", toolSkillInventory?.policy.doesNotInstall],
                ["不自动执行", toolSkillInventory?.policy.doesNotExecute],
                ["不自动启用候选", toolSkillInventory?.policy.doesNotActivateCandidates],
                ["导出给 Codex 检索", hasExportEvidence],
              ].map(([label, enabled]) => (
                <div key={String(label)} className={enabled ? "tool-policy-item ok" : "tool-policy-item pending"}>
                  <strong>{String(label)}</strong>
                  <span>{enabled ? "已启用" : "待生成"}</span>
                </div>
              ))}
            </div>
            <p className="settings-note">
              Codex 查询工具时只拿用途、来源和风险边界；真正执行仍必须回到明确任务卡或用户授权。
            </p>
          </section>
        </div>

        <section className="overview-card">
          <div className="overview-card-header">
            <div>
              <span className="section-kicker">资产记录</span>
              <h3>按来源整理的工具资产</h3>
              <p>{filteredToolSkillInventoryRecords.length} 条匹配当前搜索；自建工具和项目脚本会优先展示用途、使用项目和风险边界，Codex 官方/全局工具单独分组。</p>
            </div>
            {renderTonePill("不安装 / 不执行", "teal")}
          </div>
          {toolSkillInventoryGroups.length > 0 ? (
            <div className="tool-group-list">
              {toolSkillInventoryGroups.map((group) => (
                <section key={group.key} className="tool-record-group">
                  <div className="project-group-heading">
                    <div>
                      <strong>{group.title}</strong>
                      <span>{group.description}</span>
                    </div>
                    {renderTonePill(`${group.records.length} 条`, group.tone)}
                  </div>
                  {renderToolSkillRecordList(group.records)}
                </section>
              ))}
            </div>
          ) : (
            renderToolSkillRecordList()
          )}
        </section>
      </section>
    );
  }

  function renderThreadRecoveryPacket(packet: ThreadRecoveryPacket | null) {
    if (!packet) return null;
    const packetText = JSON.stringify(packet, null, 2);
    return (
      <div className="history-context-card">
        <div className="agent-log-detail-header">
          <div>
            <span className="section-kicker">旧线程接续包</span>
            <h3>{clipText(packet.thread.title || packet.request.title || "未命名线程", 90)}</h3>
            <p>{packet.thread.threadId || packet.request.threadId || "未提供 threadId"}</p>
          </div>
          {renderTonePill(packet.thread.confidence === "source_backed" ? "有来源" : "待复核", packet.thread.confidence === "source_backed" ? "teal" : "amber")}
        </div>
        <div className="inspector-note success-note">
          这个接续包给新 CEO 线程启动用：先读推荐文档和 compact sourceRefs；raw/vault session 默认不读，也不会触发归档、瘦身或删除。
        </div>
        <dl className="detail-list">
          <dt>推荐文档</dt>
          <dd>{packet.recommendedReadOrder.slice(0, 5).map((item) => item.title || item.path).join("；") || "暂无"}</dd>
          <dt>上下文条目</dt>
          <dd>{packet.context.itemCount} 条 · sourceRefs {packet.sourceRefs.length} 条 · token 估算 {packet.tokenEstimate}</dd>
          <dt>Vault</dt>
          <dd>{packet.vault.hasVault ? "有历史保险库指针" : "暂无匹配 Vault manifest"} · {packet.vault.policy}</dd>
          <dt>安全边界</dt>
          <dd>raw session 默认读取={packet.safety.rawSessionDefaultRead ? "是" : "否"}；归档/瘦身/删除/移动/恢复={packet.safety.archiveCompactDeleteMoveRestore ? "会执行" : "不执行"}</dd>
        </dl>
        <div className="maintenance-actions">
          <button className="primary-button" onClick={() => copyThreadRecoveryPacket(packet)}>
            <Copy size={17} /> 复制接续包
          </button>
        </div>
        <pre className="detail-code">{packetText}</pre>
      </div>
    );
  }

  function renderThreadContinuationPacket(item: CodexGuardianHistoryItem | null) {
    if (!item) {
      return (
        <div className="agent-log-empty compact">
          <Archive size={24} />
          <strong>还没有历史入库记录</strong>
          <span>选择一条历史线程后，先入库为可检索知识；需要降低卡顿时再瘦身本体。</span>
        </div>
      );
    }
    const defaultRefs = item.sourceRefs.filter((ref) => ref.readByDefault !== false);
    const rawRefs = item.sourceRefs.filter((ref) => ref.kind === "raw_session");
    const cleanTitle = isLikelyMojibake(item.title) ? historyFallbackTitle(item) : cleanDisplayText(item.title, "未命名线程");
    const cleanSummary = isLikelyMojibake(item.summary)
      ? "该线程摘要疑似编码损坏；仍可通过 threadId、项目路径和来源摘要生成优化记录。"
      : cleanDisplayText(item.summary, "Guardian 暂无摘要。");
    const cleanWhyMatched = isLikelyMojibake(item.whyMatched) ? "Guardian 历史命中。" : cleanDisplayText(item.whyMatched, "Guardian 历史命中。");
    const packetText = buildOldThreadOptimizationText(item);
    const brokenSource = hasBrokenGlyphs(item.title) || hasBrokenGlyphs(item.summary) || hasBrokenGlyphs(item.whyMatched) || hasBrokenHistorySourceRefs(item);
    const compactReceipt = compactedHistoryReceipts[item.threadId] || null;
    return (
      <div className="history-context-card">
        <div className="agent-log-detail-header">
          <div>
            <span className="section-kicker">历史入库记录</span>
            <h3>{clipText(cleanTitle, 90)}</h3>
            <p>{item.threadId}</p>
          </div>
          {renderTonePill(guardianFreshnessLabel(item.freshness), guardianFreshnessTone(item.freshness))}
        </div>
        <div className="inspector-note success-note">
          老线程已写入知匣历史保险库：完整历史保存在本机，热/温摘要可用 threadId、项目名或关键词在知识 / 智能优化检索里找回。
        </div>
        <div className="inspector-note">
          入库会先保存完整历史副本并验 hash，再生成热/温/冷三层召回入口；“瘦身本体”只压缩 Codex session 里的大型图片、工具输出和隐藏内容。
        </div>
        {item.shouldStartFreshThread ? (
          <div className="inspector-note success-note">
            可选：如果当前 Codex 窗口仍然很卡，可以另开干净线程，并从知匣检索这条优化记录；这不是老线程优化的必要步骤。
          </div>
        ) : null}
        {brokenSource ? <div className="inspector-note">来源摘要或路径包含损坏字符，界面和优化记录已自动隐藏乱码。</div> : null}
        <dl className="detail-list">
          <dt>摘要</dt>
          <dd>{cleanSummary}</dd>
          <dt>为什么匹配</dt>
          <dd>{cleanWhyMatched}</dd>
          <dt>Token 估算</dt>
          <dd>{item.tokenEstimate} tokens</dd>
          {typeof item.sessionBytes === "number" ? (
            <>
              <dt>线程大小</dt>
              <dd>{formatBytes(item.sessionBytes)} · {item.pressureReason === "very_long_thread" ? "大线程，已纳入处理优先级" : "旧线程，按冷却规则处理"}</dd>
            </>
          ) : null}
          <dt>项目路径</dt>
          <dd>{item.provenance?.projectRoot || "未识别"}</dd>
          <dt>接续策略</dt>
          <dd>知匣保存完整历史保险库、threadId、项目路径、热/温摘要和冷层来源索引；旧线程可继续使用，必要时用本体瘦身降低 session 体积。</dd>
        </dl>
        {compactReceipt ? (
          <div className="history-compact-receipt">
            <strong>本体瘦身回执</strong>
            <dl className="detail-list">
              <dt>大小变化</dt>
              <dd>{formatBytes(compactReceipt.before_bytes)} {"->"} {formatBytes(compactReceipt.after_bytes)}，释放 {formatBytes(compactReceipt.bytes_saved)}</dd>
              <dt>备份</dt>
              <dd>{compactReceipt.backup_path}</dd>
              <dt>Hash</dt>
              <dd>备份校验={compactReceipt.backup_sha256 || "暂无"}；瘦身后校验={compactReceipt.after_sha256 || "暂无"}</dd>
            </dl>
          </div>
        ) : null}
        <div className="history-source-list">
          {defaultRefs.map((ref, index) => (
            <div key={`${ref.kind}-${index}`} className="history-source-row">
              <strong>{ref.kind}</strong>
              <span>{historySourceRefDisplayText(ref)}</span>
            </div>
          ))}
          {rawRefs.length > 0 ? (
            <div className="history-source-row muted-row">
              <strong>raw_session</strong>
              <span>默认不读取；只有恢复旧线程且摘要不足时，才按明确范围取证。</span>
            </div>
          ) : null}
        </div>
        <div className="maintenance-actions">
          <button className="ghost-button" onClick={() => generateThreadRecoveryPacket(item)} disabled={historyBusy}>
            <Brain size={17} /> 生成接续包
          </button>
          <button className="primary-button" onClick={() => copyThreadContinuationPacket(item)}>
            <Copy size={17} /> 复制优化摘要
          </button>
        </div>
        <pre className="detail-code">{packetText}</pre>
      </div>
    );
  }

  function renderHistoryOptimizeProgress() {
    if (!historyOptimizeProgress) return null;
    const total = Math.max(0, historyOptimizeProgress.total);
    const current = total > 0 ? Math.min(total, Math.max(0, historyOptimizeProgress.current)) : 0;
    const percent = total > 0 ? Math.round((current / total) * 100) : historyOptimizeProgress.active ? 12 : 100;
    return (
      <div className={historyOptimizeProgress.active ? "history-progress active" : "history-progress"}>
        <div className="history-progress-header">
          <div>
            <strong>{historyOptimizeProgress.label}</strong>
            <span>{historyOptimizeProgress.detail}</span>
          </div>
          <span>{total > 0 ? `${current}/${total}` : historyOptimizeProgress.active ? "准备中" : "完成"}</span>
        </div>
        <div className="history-progress-track" aria-label={`${historyOptimizeProgress.mode}进度`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="history-progress-stats">
          <span>{historyOptimizeProgress.mode}</span>
          {typeof historyOptimizeProgress.backlogTotal === "number" ? <span>全量 {historyOptimizeProgress.backlogTotal} 候选</span> : null}
          {typeof historyOptimizeProgress.unvaulted === "number" ? <span>{historyOptimizeProgress.unvaulted} 未入库</span> : null}
          {typeof historyOptimizeProgress.vaulted === "number" ? <span>{historyOptimizeProgress.vaulted} 已有历史</span> : null}
          <span>{historyOptimizeProgress.indexed} 已入库</span>
          {historyOptimizeProgress.mode === "安全减负" ? <span>{historyOptimizeProgress.compacted} 已瘦身</span> : null}
          {historyOptimizeProgress.queued > 0 ? <span>{historyOptimizeProgress.queued} 已进归档队列</span> : null}
          {typeof historyOptimizeProgress.remaining === "number" ? <span>{historyOptimizeProgress.remaining} 待后续批次</span> : null}
          {historyOptimizeProgress.failed > 0 ? <span>{historyOptimizeProgress.failed} 失败</span> : null}
          {historyOptimizeProgress.active ? <span>进行中</span> : <span>已结束</span>}
        </div>
      </div>
    );
  }

  function renderOldThreadManager() {
    return (
      <section className="overview-card old-thread-manager">
        <div className="overview-card-header">
          <div>
            <span className="section-kicker">释放历史压力</span>
            <h3>旧线程历史整理</h3>
            <p>一次完成运行日志清理、体检、完整历史入库、hash 校验、session 瘦身和归档队列生成；请先关闭 Codex 再点击，避免日志库被占用。</p>
          </div>
          <div className="maintenance-actions">
            <button className="ghost-button" onClick={loadProjectOldThreads} disabled={historyBusy || !effectiveProjectPath}>
              <FolderOpen size={15} /> 当前项目
            </button>
            <button className="primary-button" onClick={oneClickRelieveOldThreadPressure} disabled={historyBusy}>
              <Database size={15} /> 一键安全减负
            </button>
          </div>
        </div>
        <div className="one-click-rules">
          <div>
            <strong>先关 Codex</strong>
            <span>一键安全减负会先清理 Codex 巨型运行日志；如果 Codex、codex 或 node_repl 还在运行，知匣会停止并提醒关闭后重试。</span>
          </div>
          <div>
            <strong>一键优化规则</strong>
            <span>CEO 创建的实现、审计、准备、回调线程 3 天未复用就会入库并进归档队列；CEO 主线程默认保留 30 天。</span>
          </div>
          <div>
            <strong>先保存历史</strong>
            <span>先写入知匣历史库，保存 threadId、项目、中文摘要、来源指针和校验记录。</span>
          </div>
          <div>
            <strong>再瘦身归档</strong>
            <span>大线程会在完整备份通过后压缩 session；小的过期员工线程保存历史后直接进 Codex 宿主归档队列。</span>
          </div>
          <div>
            <strong>Codex 可召回</strong>
          <span>后续 Codex 检索默认先按项目查历史、知识和记忆，再回到冷层来源。</span>
          </div>
        </div>
        <div className="thread-search-row">
          <input
            className="path-input"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") searchOldThreads();
            }}
            placeholder="搜索旧线程：CEO Flow、知匣、UI 修复、bug 关键词..."
          />
          <button className="primary-button" onClick={() => searchOldThreads()} disabled={historyBusy}>
            <Search size={17} /> 搜索老线程
          </button>
        </div>
        {historyError ? <div className="inspector-note">{historyError}</div> : null}
        {renderHistoryOptimizeProgress()}
        {renderArchiveQueuePanel(historyArchiveQueue)}
        {historyOptimizeSummary ? <div className="inspector-note success-note">{historyOptimizeSummary}</div> : null}
        <p className="settings-note">
          “一键安全减负”会自动找出超过 {historyEnvelope?.thresholds?.minMegabytes ?? 8} MB 的大线程，以及超过冷却期的旧线程：CEO 创建线程 {historyEnvelope?.thresholds?.ceoCreatedThreadIdleDays ?? 3} 天未工作、CEO 主线程 {historyEnvelope?.thresholds?.ceoThreadIdleDays ?? 30} 天未工作、无法确定归属 {historyEnvelope?.thresholds?.unknownThreadIdleDays ?? 3} 天未工作。知匣会先保存完整历史并生成可检索摘要；CEO 相关线程和大线程必须先有瘦身回执，才会进入 Codex 宿主归档队列。active/running、未完成历史保险库、瘦身回执缺失或校验失败的线程会跳过；体积减少和侧栏归档通常能降低历史载入压力，但不保证修复所有 CPU 或鼠标卡顿。
        </p>
        <details className="old-thread-advanced-actions">
          <summary>高级操作</summary>
          <div className="maintenance-actions">
            <button className="ghost-button" data-e2e="archive-candidate-scan" onClick={loadLongThreadCandidates} disabled={historyBusy}>
              <RefreshCw size={15} /> 自动体检
            </button>
            <button className="ghost-button" onClick={oneClickOptimizeOldThreads} disabled={historyBusy}>
              <Bot size={15} /> 仅整理入库
            </button>
            <button className="ghost-button" onClick={optimizeVisibleOldThreads} disabled={historyBusy || !historyEnvelope?.items.length}>
              <Bot size={15} /> 全部入库
            </button>
            <button className="ghost-button" onClick={compactVisibleOldThreads} disabled={historyBusy || !historyEnvelope?.items.length}>
              <Database size={15} /> 瘦身全部可见
            </button>
            <button className="ghost-button" onClick={generateArchiveQueueForVisibleThreads} disabled={historyBusy || !historyEnvelope?.items.length}>
              <Archive size={15} /> 生成归档队列
            </button>
          </div>
        </details>
        <div className="old-thread-layout">
          <div className="old-thread-list">
            {!historyEnvelope || historyEnvelope.items.length === 0 ? (
              <div className="agent-log-empty compact">
                <Search size={24} />
                <strong>点“一键安全减负”即可开始</strong>
                <span>知匣会自动体检大线程和超过冷却期的 CEO 子线程，先保存完整历史，再给 CEO 相关线程和大线程生成瘦身回执，最后生成宿主归档队列；不需要再单独点入库或整理。</span>
              </div>
            ) : (
              historyEnvelope.items.map((item) => (
                  <button
                    key={item.threadId}
                    className={selectedHistoryItem?.threadId === item.threadId ? "old-thread-row active" : "old-thread-row"}
                    data-e2e="old-thread-row"
                    onClick={() => {
                      setSelectedHistoryThreadId(item.threadId);
                      setHistoryContextEnvelope(null);
                      setThreadRecoveryPacket(null);
                  }}
                >
                  <div className="agent-log-row-head">
                    <strong>{historyDisplayTitle(item, 72)}</strong>
                    <span className="agent-log-item-pills">
                      {optimizedHistoryThreadIds.includes(item.threadId) ? renderTonePill("已入库", "teal") : null}
                      {compactedHistoryReceipts[item.threadId] ? renderTonePill("已瘦身", "amber") : null}
                      {historyArchiveQueue?.items.some((queueItem) => queueItem.threadId === item.threadId) ? renderTonePill("已进归档队列", "amber") : null}
                      {item.archiveCandidate
                        ? renderTonePill(item.archiveCandidate.isCandidate ? "归档候选" : "暂不可归档", item.archiveCandidate.isCandidate ? "amber" : "slate")
                        : null}
                      {renderTonePill(guardianFreshnessLabel(item.freshness), guardianFreshnessTone(item.freshness))}
                    </span>
                  </div>
                  <p>{historyDisplaySummary(item, 150)}</p>
                  <div className="timeline-meta">
                    <span>{item.threadId}</span>
                    <span>{typeof item.sessionBytes === "number" ? formatBytes(item.sessionBytes) : `${item.tokenEstimate} tokens`}</span>
                    <span>{historyRestoreStateLabel(item.provenance?.restoreState)}</span>
                  </div>
                  {item.shouldStartFreshThread ? (
                    <div className="timeline-meta wrap">
                      <span>可选另开线程；主流程是先纳入知匣历史库</span>
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>
          <div className="old-thread-detail">
            <div className="maintenance-actions">
              {selectedHistoryItem ? renderTonePill(historyRecordStatusLabel(selectedHistoryItem.status), "slate") : null}
            </div>
            {renderArchiveCandidatePanel(selectedHistoryItem)}
            {renderSelectedArchiveQueueState(selectedHistoryItem)}
            <details className="old-thread-advanced-actions">
              <summary>选中线程高级操作</summary>
              <div className="maintenance-actions">
              <button className="primary-button" onClick={() => loadOldThreadContext()} disabled={historyBusy || !selectedHistoryItem}>
                <Bot size={17} /> {selectedHistoryItem && optimizedHistoryThreadIds.includes(selectedHistoryItem.threadId) ? "重新入库选中" : "入库选中老线程"}
              </button>
              <button className="ghost-button" onClick={() => compactSelectedOldThread()} disabled={historyBusy || !selectedHistoryItem}>
                <Database size={17} /> 瘦身本体
              </button>
              <button className="ghost-button" onClick={optimizeVisibleOldThreads} disabled={historyBusy || !historyEnvelope?.items.length}>
                <Bot size={17} /> 全部入库
              </button>
              <button className="ghost-button" onClick={compactVisibleOldThreads} disabled={historyBusy || !historyEnvelope?.items.length}>
                <Database size={17} /> 瘦身全部可见
              </button>
              <button className="ghost-button" onClick={generateArchiveQueueForVisibleThreads} disabled={historyBusy || !historyEnvelope?.items.length}>
                <Archive size={17} /> 生成归档队列
              </button>
              </div>
            </details>
            {renderThreadContinuationPacket(selectedHistoryContextItem || selectedHistoryItem)}
            {renderThreadRecoveryPacket(threadRecoveryPacket)}
          </div>
        </div>
      </section>
    );
  }

  function renderRuntimeProcessRow(process: AgentRuntimeProcessSample) {
    const rankedCpu = runtimeProcessRankingCpu(process);
    return (
      <div key={process.id} className="runtime-monitor-row">
        <div>
          <strong>{runtimePlatformLabel(process.platform)} · {process.processName}</strong>
          <span>PID {process.processId} · {process.commandLine ? clipText(process.commandLine, 92) : "无命令行摘要"}</span>
          <span>
            排行 CPU {formatRuntimeCpu(rankedCpu)}{rankedCpu > process.cpuPercent ? ` · 展示上限 ${formatRuntimeCpu(process.cpuPercent)}` : ""} · 内存{" "}
            {formatBytes(process.memoryBytes)}
          </span>
        </div>
        <div className="runtime-monitor-row-end">
          {renderTonePill(runtimeProcessCpuLabel(process), rankedCpu >= 45 ? "amber" : "slate")}
          <span>{formatBytes(process.memoryBytes)}</span>
        </div>
      </div>
    );
  }

  function renderRuntimeSessionRow(session: AgentRuntimeSession) {
    return (
      <div key={session.id} className="runtime-monitor-row">
        <div>
          <strong>{session.title || session.threadId || session.id}</strong>
          <span>
            {session.threadId || "无 threadId"} · {formatBytes(session.sessionBytes)} · {formatDate(session.lastWriteTime)}
          </span>
          <span>
            历史保险库 {session.hasThreadHistoryVault ? "已入库" : "缺失"} · 记忆指针 {session.hasZhixiaHistoryPointer ? "已写入" : "缺失"} · 瘦身回执{" "}
            {session.hasCompactReceipt ? "已记录" : "未记录"}
          </span>
          <span>
            历史规模 {formatBytes(session.observed.historySizeBytes)} · 最近写入 {formatRuntimeRecentMinutes(session.observed.recentActivityMinutes)} · 关联进程{" "}
            {session.observed.observedProcessIds.join(", ") || "暂无"}
          </span>
          <span>
            疑似归因 {runtimeInferenceBasisLabel(session.inferredAttribution.basis)} · 可能进程 {session.inferredAttribution.suspectedProcessId ?? "未知"} ·{" "}
            {runtimeConfidenceLabel(session.inferredAttribution.confidence)}
          </span>
          <span>不确定性：{runtimeUncertaintySummary(session.uncertainty)}</span>
          <span>{runtimeSessionEvidenceSummary(session)}</span>
        </div>
        <div className="runtime-monitor-row-end">
          {renderTonePill(runtimeSessionStatusLabel(session.status), runtimeStatusTone(session.status))}
          {renderTonePill(`${session.pressureScore}`, session.pressureScore >= 70 ? "red" : session.pressureScore >= 45 ? "amber" : "slate")}
          {renderTonePill(runtimeConfidenceLabel(session.attributionConfidence), runtimeConfidenceTone(session.attributionConfidence))}
          {renderTonePill(runtimeActionLabel(session.recommendedAction), runtimeActionTone(session.recommendedAction))}
        </div>
      </div>
    );
  }

  function renderRuntimeObservedFactRow(session: AgentRuntimeObservedSessionFacts) {
    return (
      <div key={`${session.sessionId}-observed`} className="runtime-monitor-row">
        <div>
          <strong>{session.threadId || session.sessionId}</strong>
          <span>
            历史规模 {formatBytes(session.historySizeBytes)} · 最近写入 {formatRuntimeRecentMinutes(session.recentActivityMinutes)} · 状态 {runtimeSessionStatusLabel(session.status)}
          </span>
          <span>关联进程：{session.observedProcessIds.join(", ") || "无"}</span>
        </div>
        <div className="runtime-monitor-row-end">
          {renderTonePill("观测事实", "teal")}
        </div>
      </div>
    );
  }

  function renderRuntimeInferenceRow(inference: AgentRuntimeAttributionInference) {
    return (
      <div key={`${inference.sessionId}-inference`} className="runtime-monitor-row">
        <div>
          <strong>{inference.threadId || inference.sessionId}</strong>
          <span>
            {runtimeInferenceBasisLabel(inference.basis)} · 可能进程 {inference.suspectedProcessId ?? "未知"} ·{" "}
            {inference.suspectedProcessName || "未知"}
          </span>
          <span>判断限制：{inference.uncertainty ? runtimeUncertaintySummary(inference.uncertainty) : "暂无额外限制"}</span>
        </div>
        <div className="runtime-monitor-row-end">
          {renderTonePill(runtimeConfidenceLabel(inference.confidence), runtimeConfidenceTone(inference.confidence))}
          {renderTonePill("疑似归因", inference.confidence === "high" ? "teal" : inference.confidence === "medium" ? "amber" : "slate")}
        </div>
      </div>
    );
  }

  function renderRuntimeMonitorPanel() {
    const summary = runtimeSnapshot?.summary;
    return (
      <section className="overview-card runtime-monitor-panel">
        <div className="overview-card-header">
          <div>
            <span className="section-kicker">高级诊断采样</span>
            <h3>智能优化：CPU、内存和线程压力</h3>
            <p>为避免知匣自己制造卡顿，监控改为手动采样。只看元数据，不读取原始会话正文，也不做后台清理。</p>
          </div>
          <div className="maintenance-actions">
            <button className="ghost-button" onClick={copyRuntimeMonitorDiagnosticReport} disabled={!runtimeSnapshot || runtimeMonitorBusy}>
              <Copy size={15} /> 复制报告
            </button>
            <button className="ghost-button" onClick={() => refreshRuntimeMonitorSnapshot("manual")} disabled={runtimeMonitorBusy || runtimeMonitorCoolingDown}>
              <RefreshCw size={15} /> {runtimeMonitorBusy ? "采样中" : runtimeMonitorCoolingDown ? "冷却中" : "立即刷新"}
            </button>
          </div>
        </div>

        {runtimeMonitorError ? <div className="inspector-note">{runtimeMonitorError}</div> : null}

        {runtimeSnapshot ? (
          <>
            <div className="control-tower-grid">
              <div>
                <span>最近刷新</span>
                <strong>{formatDate(runtimeSnapshot.sampledAt)}</strong>
                <small>手动采样</small>
              </div>
              <div>
                <span>CPU 使用率</span>
                <strong>{formatRuntimeCpu(summary?.totalCpuPercent ?? 0)}</strong>
                <small>{(summary?.highCpuProcessCount ?? 0) > 0 ? `${summary?.highCpuProcessCount} 个高 CPU 进程` : "暂无高 CPU 告警"}</small>
              </div>
              <div>
                <span>内存占用</span>
                <strong>{formatBytes(summary?.totalMemoryBytes ?? 0)}</strong>
                <small>{runtimeSnapshot.observedFacts.processes.highestMemoryProcess?.processName || "等待采样"}</small>
              </div>
              <div>
                <span>线程压力</span>
                <strong>{summary?.largeUnoptimizedSessionCount ?? 0}</strong>
                <small>大体积且未优化候选</small>
              </div>
            </div>
            <div className="runtime-monitor-summary">
              <div>
                <span>进程</span>
                <strong>{summary?.totalProcesses ?? 0}</strong>
              </div>
              <div>
                <span>CPU 合计</span>
                <strong>{formatRuntimeCpu(summary?.totalCpuPercent ?? 0)}</strong>
              </div>
              <div>
                <span>内存合计</span>
                <strong>{formatBytes(summary?.totalMemoryBytes ?? 0)}</strong>
              </div>
              <div>
                <span>线程</span>
                <strong>{summary?.totalSessions ?? 0}</strong>
              </div>
              <div>
                <span>风险</span>
                <strong>{(summary?.highCpuProcessCount ?? 0) + (summary?.systemErrorSessionCount ?? 0) + (summary?.largeUnoptimizedSessionCount ?? 0)}</strong>
              </div>
            </div>

            <div className="runtime-monitor-columns">
              <div className="runtime-monitor-block">
                <div className="section-heading compact">
                  <h3>正在占资源的进程</h3>
                  {renderTonePill("系统采样", "slate")}
                </div>
                <div className="runtime-monitor-list">
                  {runtimeSnapshot.processes.length > 0 ? (
                    runtimeSnapshot.processes.slice(0, 6).map(renderRuntimeProcessRow)
                  ) : (
                    <div className="agent-log-empty compact">
                      <Bot size={22} />
                      <strong>未采样到 agent 进程</strong>
                      <span>当前没有命中 Codex / Claude Code / OpenClaw / Cursor / Windsurf / Gemini 进程。</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="runtime-monitor-block">
                <div className="section-heading compact">
                  <h3>老线程压力</h3>
                  {renderTonePill("只看元数据", "slate")}
                </div>
                <div className="runtime-monitor-list">
                  {runtimeSnapshot.sessions.length > 0 ? (
                    runtimeSnapshot.sessions.slice(0, 6).map(renderRuntimeSessionRow)
                  ) : (
                    <div className="agent-log-empty compact">
                      <Database size={22} />
                      <strong>暂无线程压力记录</strong>
                      <span>点“一键整理”后会优先展示可优化的老线程。</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="runtime-monitor-columns">
              <div className="runtime-monitor-block">
                <div className="section-heading compact">
                  <h3>采样证据</h3>
                  {renderTonePill("只读", "teal")}
                </div>
                <div className="runtime-monitor-list">
                  <div className="runtime-monitor-row">
                    <div>
                      <strong>最高 CPU / 内存</strong>
                      <span>
                        CPU: {runtimeSnapshot.observedFacts.processes.highestCpuProcess?.processName || "无"} · 内存：{" "}
                        {runtimeSnapshot.observedFacts.processes.highestMemoryProcess?.processName || "无"}
                      </span>
                    </div>
                  </div>
                  {runtimeSnapshot.observedFacts.sessions.largestHistorySessions.length > 0 ? (
                    runtimeSnapshot.observedFacts.sessions.largestHistorySessions.slice(0, 3).map(renderRuntimeObservedFactRow)
                  ) : (
                    <div className="agent-log-empty compact">
                      <Database size={22} />
                      <strong>暂无线程观测记录</strong>
                      <span>当前没有可展示的历史规模或最近写入记录。</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="runtime-monitor-block">
                <div className="section-heading compact">
                  <h3>可能关联的线程</h3>
                  {renderTonePill("启发式判断", "amber")}
                </div>
                <div className="runtime-monitor-list">
                  {runtimeSnapshot.inferredAttribution.length > 0 ? (
                    runtimeSnapshot.inferredAttribution.slice(0, 3).map(renderRuntimeInferenceRow)
                  ) : (
                    <div className="agent-log-empty compact">
                      <AlertTriangle size={22} />
                      <strong>暂无高优先推断项</strong>
                      <span>当前没有达到展示阈值的疑似线程归因。</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {(runtimeSnapshot.warnings.length > 0 || runtimeSnapshot.recommendations.length > 0) ? (
              <div className="runtime-monitor-notes">
                {runtimeSnapshot.warnings.map((warning) => (
                  <div key={warning} className="inspector-note">
                    <AlertTriangle size={15} /> {warning}
                  </div>
                ))}
                {runtimeSnapshot.recommendations.slice(0, 4).map((recommendation, index) => (
                  <div key={`${recommendation.scope}-${index}`} className="inspector-note">
                    {renderTonePill(runtimeActionLabel(recommendation.recommendedAction), runtimeActionTone(recommendation.recommendedAction))}
                    <span>
                      {recommendation.scope === "process"
                        ? recommendation.reason
                        : `线程 ${recommendation.threadId || recommendation.sessionId} 压力 ${recommendation.pressureScore}，证据：${recommendation.evidence.join("、") || "无"}；判断限制：${runtimeUncertaintySummary(recommendation.uncertainty)}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="agent-log-empty compact">
            <Bot size={24} />
            <strong>点击“立即刷新”后进行一次轻量采样</strong>
            <span>不会清理、瘦身、恢复、移动或修改任何 Codex session，也不会自动扫描老线程。</span>
          </div>
        )}

        <p className="settings-note">
          运行监控已关闭自动刷新，只在你手动点击时采样一次，并保留 {formatRuntimeCooldown(RUNTIME_MONITOR_REFRESH_COOLDOWN_MS)} 冷却避免制造卡顿。CPU 到具体线程只能做证据驱动的疑似判断，不能当作确定归因；老线程体检请用“一键安全减负”主动触发。
        </p>
      </section>
    );
  }

  function renderAgentWorkspace() {
    const latestMemoryTrigger = memoryRuntimeTriggerReceipts[0] || null;
    const activeMemoryFactCount = memoryRuntimeFacts.filter((fact) => ["active", "accepted"].includes(fact.status)).length;
    const historicalMemoryFactCount = memoryRuntimeFacts.filter((fact) => fact.status === "superseded").length;
    return (
      <div
        className={inspectorCollapsed ? "project-layout agent-layout project-layout--inspector-collapsed" : "project-layout agent-layout"}
        data-e2e="agent-workspace"
      >
        <section className="project-main">
          <section className="collection-shell">
            <div className="section-heading">
              <div>
                <h2>智能优化</h2>
                <p>这里负责释放老线程历史压力，并让 Codex 按项目自动调取历史、知识和记忆。</p>
              </div>
            </div>

            <div className="overview-grid single-column">
              {renderOldThreadManager()}

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">AI 调取规则</span>
                    <h3>Codex 会按项目优先搜索这些资料</h3>
                  </div>
                </div>
                <div className="overview-list">
                  <div className="overview-row static-row">
                    <div>
                      <strong>当前搜索词</strong>
                      <span>{query.trim() || "未输入查询时，优先返回项目核心来源与最近记忆。"}</span>
                    </div>
                  </div>
                  <div className="overview-row static-row">
                    <div>
                      <strong>检索范围</strong>
                      <span>{effectiveProjectPath ? `${projectLabel(effectiveProjectPath)} · ${effectiveProjectPath}` : "当前未识别项目，将使用全局文档与知识。"}</span>
                    </div>
                  </div>
                  <div className="overview-row static-row">
                    <div>
                      <strong>可调取资料</strong>
                      <span>{coreDocuments.length} 历史 · {projectKnowledgeItems.length} 知识 · {projectExperienceCards.length} 记忆</span>
                    </div>
                  </div>
                  <div className="overview-row static-row">
                    <div>
                      <strong>可信状态</strong>
                      <span>{retrievalResult.freshness === "fresh" ? "当前结果来源较新，Codex 可优先使用。" : "存在待确认或源文件变化，Codex 会提示复核。"}</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="overview-card" data-e2e="memory-runtime-diagnostics">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">记忆运行状态</span>
                    <h3>主动触发、长期事实和召回结果</h3>
                  </div>
                  <button className="ghost-button" onClick={runMemoryRuntimeProbe} disabled={memoryRuntimeBusy}>
                    <Brain size={15} /> {memoryRuntimeBusy ? "检索中" : "运行记忆检索"}
                  </button>
                </div>

                {memoryRuntimeError && <div className="inspector-note">{memoryRuntimeError}</div>}

                <div className="overview-list">
                  <div className="overview-row static-row">
                    <div>
                      <strong>最近触发</strong>
                      <span>
                        {latestMemoryTrigger
                          ? `${latestMemoryTrigger.hook} · ${latestMemoryTrigger.queryType || "未分类"} · ${formatDate(latestMemoryTrigger.createdAt)}`
                          : "尚无触发回执。CEO Flow 调用或手动运行检索后会在这里出现。"}
                      </span>
                    </div>
                    {latestMemoryTrigger && renderTonePill(latestMemoryTrigger.partial ? "部分结果" : "已完成", latestMemoryTrigger.partial ? "amber" : "teal")}
                  </div>
                  <div className="overview-row static-row">
                    <div>
                      <strong>时序事实</strong>
                      <span>{activeMemoryFactCount} 条当前事实 · {historicalMemoryFactCount} 条已替换历史 · 总计 {memoryRuntimeFacts.length} 条</span>
                    </div>
                  </div>
                  <div className="overview-row static-row">
                    <div>
                      <strong>召回引擎</strong>
                      <span>
                        {memoryRuntimePacket?.hybridRetrieval
                          ? `FTS5 + BM25F · ${memoryRuntimePacket.items.length} 条 · ${memoryRuntimePacket.tokenEstimate} tokens`
                          : "本地 FTS5 + BM25F，按需运行；不使用心跳、后台全库扫描或默认 embedding。"}
                      </span>
                    </div>
                  </div>
                  {memoryRuntimePacket?.triggerReceipt && (
                    <div className="overview-row static-row">
                      <div>
                        <strong>本次性能</strong>
                        <span>{memoryRuntimePacket.triggerReceipt.durationMs} ms · {memoryRuntimePacket.triggerReceipt.returnedCount} 条 · {memoryRuntimePacket.triggerReceipt.tokenEstimate} tokens</span>
                      </div>
                    </div>
                  )}
                  {memoryRuntimePacket?.items.slice(0, 3).map((item) => (
                    <div key={`memory-runtime-${item.id}`} className="overview-row static-row">
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.summary || "暂无摘要"}</span>
                      </div>
                      {renderTonePill(retrieveKindLabel(item.kind), item.kind === "memory_fact" ? "teal" : "slate")}
                    </div>
                  ))}
                </div>
              </section>

              <section className="overview-card">
                <div className="overview-card-header">
                  <div>
                    <span className="section-kicker">调用日志</span>
                    <h3>Codex 为什么调取这些资料</h3>
                  </div>
                  <button className="ghost-button" onClick={() => loadRetrieveLogs()} disabled={busy}>
                    <RefreshCw size={15} /> 刷新日志
                  </button>
                </div>

                {agentRetrieveLogError && <div className="inspector-note">{agentRetrieveLogError}</div>}

                <div className="agent-log-layout">
                  <div className="agent-log-list">
                    {agentRetrieveLogs.length === 0 ? (
                      <div className="agent-log-empty compact">
                        <Clock3 size={24} />
                        <strong>暂无调用日志</strong>
                        <span>进入智能优化页并触发一次本地检索后，这里会记录搜索词、来源和人工确认提示。</span>
                      </div>
                    ) : (
                      agentRetrieveLogs.slice(0, 8).map((log) => (
                        <button
                          key={log.id}
                          className={selectedAgentRetrieveLog?.id === log.id ? "agent-log-row active" : "agent-log-row"}
                          onClick={() => setSelectedAgentRetrieveLogId(log.id)}
                        >
                          <div className="agent-log-row-head">
                            <strong>{log.queryType}</strong>
                            {renderTonePill(retrieveStatusLabel(log.status), toneFromRetrieveStatus(log.status))}
                          </div>
                          <p>{log.query.trim() || "默认项目知识检索"}</p>
                          <div className="timeline-meta">
                            <span>{formatDate(log.timestamp)}</span>
                            <span>{log.returnedCount} 条</span>
                            <span>{log.tokenEstimate} tokens</span>
                          </div>
                          <div className="timeline-meta">
                            <span>{freshnessLabel(log.freshness)}</span>
                            <span>{log.sourceRefs.length} 个来源</span>
                            <span>{log.requiresHumanConfirmationCount} 条需确认</span>
                            {log.cache && <span>{retrieveCacheLabel(log.cache)}</span>}
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  {renderAgentLogDetail(selectedAgentRetrieveLog)}
                </div>
              </section>
            </div>
          </section>
        </section>
      </div>
    );
  }

  function renderSettingsWorkspace() {
    return (
      <section className="settings-page">
        <div className="settings-header">
          <div>
            <h2>设置</h2>
            <p>这里只放底层连接和维护。日常使用从“项目”“历史”“工具”“智能优化”完成，不需要先配置一堆开关。</p>
          </div>
          <button className="ghost-button" onClick={() => window.docKnowledge.revealStore()}>
            <FolderOpen size={15} /> 打开数据目录
          </button>
        </div>

        <div className="settings-grid">
          <section className="settings-section">
            <h3>基础存储</h3>
            <dl>
              <dt>知匣数据</dt>
              <dd>{storePath || "等待初始化"}</dd>
              <dt>已整理内容</dt>
              <dd>{stats.indexedChars.toLocaleString("zh-CN")}</dd>
              <dt>说明</dt>
              <dd>所有历史、知识、记忆和工具目录都保存在本机。</dd>
            </dl>
          </section>

          <section className="settings-section">
            <h3>扫描规则</h3>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings.autoDetectChanges)}
                onChange={(event) => updateSettings({ autoDetectChanges: event.target.checked })}
              />
              <span>刷新时检查来源是否变化</span>
            </label>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={settings.autoWatchChanges === true}
                onChange={(event) => updateSettings({ autoWatchChanges: event.target.checked })}
              />
              <span>自动监听项目来源变化（大型库建议手动扫描）</span>
            </label>
            <p className="settings-note">
              支持 TXT、Markdown、CSV、JSON、HTML、DOCX、PDF；表格文件会先保留元信息。
            </p>
            <p className="settings-note">
              当前监听 {watchStatus?.rootCount ?? 0} 个目录；默认采用性能安全的手动扫描，开启后只做变更路径附近的轻量更新。
            </p>
          </section>

          <section className="settings-section">
            <h3>维护入口</h3>
            <div className="maintenance-actions">
              <button className="primary-button" onClick={checkChanges} disabled={busy}>
                <RefreshCw size={17} /> 检查变化
              </button>
              <button className="ghost-button" onClick={reindexAll} disabled={busy || documents.length === 0}>
                <RefreshCw size={17} /> 重新整理全部
              </button>
            </div>
            <p className="settings-note">
              一般不需要手动操作；当项目历史不更新或来源文件移动时再用这里。
            </p>
          </section>

          <section className="settings-section wide codex-guardian-section">
            <div className="section-heading-row">
              <h3>Codex 连接维护</h3>
              {renderTonePill(guardianSeverityLabel(codexGuardianReport), guardianSeverityTone(codexGuardianReport))}
            </div>
            <dl>
              <dt>运行日志</dt>
              <dd>{codexGuardianReport ? formatGuardianBytes(codexGuardianReport.logs?.sqlite_bytes) : "等待体检"}</dd>
              <dt>详细日志</dt>
              <dd>{codexGuardianReport ? formatGuardianBytes(codexGuardianReport.logs?.trace_body_bytes) : "等待体检"}</dd>
              <dt>WAL/SHM</dt>
              <dd>
                {codexGuardianReport
                  ? `${formatGuardianBytes(codexGuardianReport.logs?.wal_bytes)} / ${formatGuardianBytes(codexGuardianReport.logs?.shm_bytes)}`
                  : "等待体检"}
              </dd>
              <dt>Codex 进程</dt>
              <dd>{codexGuardianReport ? `${codexGuardianReport.codex_running?.length || 0} 个相关进程` : "等待体检"}</dd>
              <dt>线程历史</dt>
              <dd>
                {codexGuardianReport
                  ? `${codexGuardianReport.sessions?.file_count ?? 0} 个 sessions，${codexGuardianReport.archived_sessions?.file_count ?? 0} 个 archived_sessions；仅展示，不清理`
                  : "等待体检"}
              </dd>
            </dl>
            <div className="maintenance-actions">
              <button className="primary-button" onClick={refreshCodexGuardianReport} disabled={codexGuardianBusy}>
                <RefreshCw size={17} /> 刷新状态
              </button>
              <button className="ghost-button danger-action" onClick={cleanCodexHotLogs} disabled={codexGuardianBusy}>
                <AlertTriangle size={17} /> 清理运行日志
              </button>
            </div>
            {codexGuardianStatus?.ok && isCodexGuardianCleanReceipt(codexGuardianStatus.result) ? (
              <p className="settings-note">
                最近清理回执：{codexGuardianStatus.result.created_at}，备份目录 {codexGuardianStatus.result.backup_dir}
              </p>
            ) : null}
            {!codexGuardianStatus?.ok && codexGuardianStatus?.error ? (
              <p className={codexGuardianStatus.refused ? "settings-note warning-note" : "settings-note"}>
                {codexGuardianStatus.refused
                  ? "Guardian 已拒绝清理：请先关闭 Codex，再回到知匣手动点击。"
                  : codexGuardianStatus.error}
              </p>
            ) : null}
            <p className="settings-note">
              这个按钮只清理 Codex 运行日志，不会删除、移动或修改线程历史；老线程优化请去“智能优化”。
            </p>
          </section>

          <section className="settings-section wide">
            <h3>AI 整理连接</h3>
            <dl>
              <dt>已整理知识</dt>
              <dd>{knowledgeOverview?.total ?? 0} 条，按项目生成短摘要并保留来源指针。</dd>
              <dt>Provider Base URL</dt>
              <dd>
                <input
                  className="path-input"
                  value={settings.aiProviderBaseUrl || ""}
                  onChange={(event) => updateSettings({ aiProviderBaseUrl: event.target.value })}
                  placeholder="https://api.deepseek.com"
                />
              </dd>
              <dt>模型</dt>
              <dd>
                <input
                  className="path-input"
                  value={settings.aiProviderModel || ""}
                  onChange={(event) => updateSettings({ aiProviderModel: event.target.value })}
                  placeholder="deepseek-v4-flash"
                />
              </dd>
              <dt>API Key</dt>
              <dd>
                <input
                  className="path-input"
                  type="password"
                  value={aiKeyDraft}
                  onChange={(event) => setAiKeyDraft(event.target.value)}
                  placeholder={hasSavedAiKey ? "已保存 API Key（不显示）" : "可选；留空时只使用本地整理"}
                />
              </dd>
            </dl>
            <div className="maintenance-actions">
              <button className="primary-button" onClick={() => generateKnowledge("heuristic")} disabled={busy || documents.length === 0}>
                <Brain size={17} /> 本机整理
              </button>
              <button className="ghost-button" onClick={() => generateKnowledge("ai")} disabled={busy || documents.length === 0}>
                <Bot size={17} /> AI 整理
              </button>
              <button className="ghost-button" onClick={testAiProvider} disabled={busy}>
                <RefreshCw size={17} /> 测试连接
              </button>
              <button className="ghost-button" onClick={saveAiProviderKey} disabled={busy || !aiKeyDraft}>
                保存 Key
              </button>
              <button className="ghost-button" onClick={() => { setAiKeyDraft(""); updateSettings({ aiProviderApiKey: "" }); }} disabled={busy || !hasSavedAiKey}>
                清除 Key
              </button>
            </div>
            <p className="settings-note">
              默认离线可用；只有点击“AI 整理”或“测试连接”才会向配置的 OpenAI 兼容接口发起请求。密钥只保存在本机。
            </p>
          </section>

          <section className="settings-section wide zhixia-skill-section">
            <div className="section-heading-row">
              <h3>知匣流程模块</h3>
              <button className="ghost-button" onClick={() => loadZhixiaSkills({ limit: 16 })} disabled={busy}>
                <RefreshCw size={15} /> 刷新记录
              </button>
            </div>
            <p className="settings-note">
              这里不是给用户手动写脚本的地方。项目摘要、个人库整理、工具说明和安全减负会由产品按钮自动调用对应流程模块，并保留运行回执。
            </p>
            {skillRunnerError && <p className="settings-note warning-note">{skillRunnerError}</p>}
            <div className="zhixia-skill-grid">
              {zhixiaSkills.length === 0 ? (
                <div className="zhixia-skill-card muted-card">
                  <strong>等待内置流程模块</strong>
                  <span>重新打开知匣后会自动同步内置模块。</span>
                </div>
              ) : (
                zhixiaSkills.map((skill) => (
                  <div key={skill.id} className="zhixia-skill-card">
                    <div className="zhixia-skill-card-head">
                      <strong>{skill.displayName || skill.name}</strong>
                      {renderTonePill(skill.enabled ? "已启用" : "停用", skill.enabled ? "teal" : "slate")}
                    </div>
                    <span>{skill.description}</span>
                    <div className="timeline-meta">
                      <span>{skill.name}</span>
                      <span>v{skill.version}</span>
                      <span>{skill.aiProvider === "optional" ? "AI 可选" : skill.aiProvider}</span>
                    </div>
                    <div className="timeline-meta">
                      <span>读：{skill.allowedReadScopes.slice(0, 3).join("、") || "无"}</span>
                      <span>写：{skill.allowedWriteScopes.join("、") || "无"}</span>
                    </div>
                    <span className="settings-note">禁止：{skill.forbiddenActions.slice(0, 4).join("、")}</span>
                  </div>
                ))
              )}
            </div>
            <div className="skill-receipt-list">
              <div className="section-heading-row compact">
                <h3>最近运行回执</h3>
                <span className="settings-note">{skillRunReceipts.length} 条</span>
              </div>
              {skillRunReceipts.length === 0 ? (
                <div className="zhixia-skill-card muted-card">
                  <strong>还没有运行记录</strong>
                  <span>在项目页点击“AI 生成摘要”或进入项目后点击“刷新本项目摘要”。</span>
                </div>
              ) : (
                skillRunReceipts.slice(0, 8).map((receipt) => (
                  <div key={receipt.id} className="skill-receipt-row">
                    <div>
                      <strong>{receipt.skillId}</strong>
                      <span>{receipt.projectId ? projectLabel(receipt.projectId) : "全局流程"}</span>
                      {receipt.errorMessage ? <span className="warning-note">{receipt.errorMessage}</span> : null}
                    </div>
                    <div className="overview-row-end">
                      {renderTonePill(zhixiaSkillStatusLabel(receipt.status), zhixiaSkillStatusTone(receipt.status))}
                      <span>{receipt.provider === "local" ? "本地规则" : "AI Provider"}</span>
                      <span>{formatDate(receipt.createdAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="settings-section wide">
            <h3>记忆导入</h3>
            <dl>
              <dt>项目记忆</dt>
              <dd>{memoryOverview?.experienceCards ?? 0} 条</dd>
              <dt>工具草稿</dt>
              <dd>{memoryOverview?.skillCandidates ?? 0} 个，默认不安装、不启用</dd>
              <dt>工作流记录</dt>
              <dd>
                <input
                  className="path-input"
                  value={settings.autoflowWorkflowPath || ""}
                  onChange={(event) => updateSettings({ autoflowWorkflowPath: event.target.value })}
                />
              </dd>
              <dt>BUG_FIX_MEMORY.md</dt>
              <dd>
                <input
                  className="path-input"
                  value={settings.bugFixMemoryPath || ""}
                  onChange={(event) => updateSettings({ bugFixMemoryPath: event.target.value })}
                />
              </dd>
            </dl>
            <div className="maintenance-actions">
              <button className="primary-button" onClick={importAutoflowExperience} disabled={busy}>
                <Archive size={17} /> 导入工作流经验
              </button>
            </div>
            <p className="settings-note">
              只读取任务完成、线程经验和 bug memory 的摘要，不复制大日志、聊天全文、会话文件或密钥。
            </p>
            <div className="candidate-list">
              {skillCandidates.length === 0 && <span className="muted">暂无 Skill 候选草稿</span>}
              {skillCandidates.slice(0, 8).map((candidate) => (
                <button
                  key={candidate.id}
                  className={selectedSkillCandidate?.id === candidate.id ? "candidate-item active" : "candidate-item"}
                  onClick={() => setSelectedSkillCandidateId(candidate.id)}
                >
                  <strong>{candidate.title}</strong>
              <span>{memoryStatusLabel(candidate.status)} · {(candidate.triggerPatterns || []).slice(0, 3).join(", ") || "暂无触发词"}</span>
                </button>
              ))}
            </div>
            {selectedSkillCandidate && (
              <pre className="skill-draft-preview">{selectedSkillCandidate.draftSkillMarkdown}</pre>
            )}
          </section>

          <section className="settings-section">
            <h3>Codex 连接</h3>
            <dl>
              <dt>连接名称</dt>
              <dd>{skillStatus?.name || "zhixia-local-docs"}</dd>
              <dt>安装状态</dt>
              <dd>
                {skillStatus?.installed
                  ? skillStatus.updateAvailable
                    ? "已连接，有可用更新"
                    : "已连接，Codex 可调用知匣"
                  : "未连接到当前用户 Codex 工具目录"}
              </dd>
              <dt>目标目录</dt>
              <dd>{skillStatus?.targetPath || "等待检测"}</dd>
            </dl>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={settings.autoInstallSkill === true}
                onChange={(event) => updateSettings({ autoInstallSkill: event.target.checked })}
              />
              <span>启动时自动连接或更新 Codex</span>
            </label>
            <div className="maintenance-actions">
              <button
                className="primary-button"
                onClick={installSkill}
                disabled={busy || skillStatus?.sourceExists === false}
              >
                <Bot size={17} /> {skillStatus?.installed ? "更新连接" : "连接 Codex"}
              </button>
              <button className="ghost-button" onClick={revealSkillsFolder} disabled={busy}>
                <FolderOpen size={17} /> Skills 目录
              </button>
            </div>
            <p className="settings-note">
              连接后，Codex 可以按项目调用知匣里的历史、知识和记忆。
            </p>
          </section>
        </div>
      </section>
    );
  }

  return (
    <main className="app-shell" style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Archive size={19} /></div>
          <div>
            <h1>知匣</h1>
            <p>Local Doc Knowledge</p>
          </div>
        </div>

        <nav className="primary-nav" data-e2e="primary-nav">
          {[
            { key: "project", label: "项目", icon: <Database size={17} /> },
            { key: "vault", label: "个人库", icon: <FolderOpen size={17} /> },
            { key: "tools", label: "工具", icon: <Wrench size={17} /> },
            { key: "agent", label: "智能优化", icon: <Bot size={17} /> },
            { key: "settings", label: "设置", icon: <Settings size={17} /> },
          ].map((item) => (
            <button
              key={item.key}
              className={view === item.key ? "nav-button active" : "nav-button"}
              data-e2e-nav={item.key}
              onClick={() => {
                if (item.key === "project") {
                  setActiveProject(null);
                  setProjectTab("overview");
                }
                setView(item.key as ViewKey);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="sidebar-section sidebar-current-project">
          <div className="section-title">
            <span>当前项目</span>
            <button className="mini-action" onClick={scanCodexWorkspace} disabled={busy}>+</button>
          </div>
          <button
            className={activeProjectInfo ? "project-item active" : "project-item"}
            onClick={() => {
              if (effectiveProjectPath) openProject(effectiveProjectPath);
              else setView("project");
            }}
            title={effectiveProjectPath || "未选择项目"}
          >
            <div className="project-item-top">
              <strong>{activeProjectInfo && effectiveProjectPath ? polishedProjectDisplayName(effectiveProjectPath, projectDocuments, 24) : "项目列表"}</strong>
              {renderTonePill(activeProjectInfo ? `${completionPercentForProjectStage(inferProjectCompletionFromDocuments(projectDocuments))}%` : `${projects.length} 个`, activeProjectInfo ? "teal" : "slate")}
            </div>
            <span>{activeProjectInfo ? projectCompletionLabel(inferProjectCompletionFromDocuments(projectDocuments)) : "点项目入口查看全部项目卡片"}</span>
            <span>
              {activeProjectInfo
                ? `${projectDocuments.length} 历史 · ${activeProjectMemory?.knowledgeItems || 0} 知识 · ${activeProjectMemory?.experienceCards || 0} 记忆`
                : "历史、知识、记忆都收进项目详情"}
            </span>
          </button>
        </section>

        <section className="sidebar-section">
          <div className="section-title">
            <span>快速状态</span>
          </div>
          <div className="sidebar-stats">
            <div>
              <strong>{stats.total}</strong>
              <span>历史</span>
            </div>
            <div>
              <strong>{knowledgeOverview?.total ?? 0}</strong>
              <span>知识</span>
            </div>
            <div>
              <strong>{memoryOverview?.experienceCards ?? 0}</strong>
              <span>记忆</span>
            </div>
            <div>
              <strong>{stats.codex}</strong>
              <span>Codex</span>
            </div>
          </div>
        </section>
      </aside>

      <div
        className="sidebar-resizer"
        onMouseDown={() => setResizingSidebar(true)}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整左侧栏宽度"
      />

      <section className="workspace">
        <header className="toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleGlobalSearchSubmit();
              }}
              placeholder="搜索项目、个人库、工具和项目资料"
            />
          </div>
          <div className="toolbar-actions">
            <button className="ghost-button" onClick={handleGlobalSearchSubmit} disabled={!query.trim()}>
              <Search size={17} /> 搜索
            </button>
            {query.trim() ? (
              <button className="ghost-button" onClick={clearGlobalSearch}>
                清空
              </button>
            ) : null}
            <button className="ghost-button" onClick={scanCodexWorkspace} disabled={busy}>
              <RefreshCw size={17} /> 扫描并整理项目
            </button>
            <button className="ghost-button" onClick={() => generateKnowledge("heuristic", "project")} disabled={busy || documents.length === 0}>
              <Brain size={17} /> 整理
            </button>
            <button className="primary-button" onClick={handleExportMemoryPackage} disabled={busy}>
              <Download size={17} /> 导出记忆包
            </button>
          </div>
        </header>

        <section className={scanActivity.active ? "scan-activity active" : "scan-activity"} data-e2e="scan-activity">
          <div>
            <strong>{scanActivity.title}</strong>
            <span>{scanActivity.detail}</span>
          </div>
          <div className="scan-activity-stats">
            {typeof scanActivity.scanned === "number" && <span>{scanActivity.scanned} 扫描</span>}
            {typeof scanActivity.imported === "number" && <span>{scanActivity.imported} 更新</span>}
            {typeof scanActivity.projects === "number" && <span>{scanActivity.projects} 项目</span>}
            {typeof scanActivity.errors === "number" && scanActivity.errors > 0 && <span>{scanActivity.errors} 失败</span>}
            {scanActivity.active && <span>进行中</span>}
          </div>
        </section>

        <section className="workspace-body">
          {view === "project" ? renderProjectWorkspace() : null}
          {view === "vault" ? renderVaultWorkspace() : null}
          {view === "documents" ? renderDocumentsWorkspace() : null}
          {view === "knowledge" ? renderKnowledgeWorkspace() : null}
          {view === "memory" ? renderMemoryWorkspace() : null}
          {view === "tools" ? renderToolsWorkspace() : null}
          {view === "agent" ? renderAgentWorkspace() : null}
          {view === "settings" ? renderSettingsWorkspace() : null}
        </section>

        <footer className="statusbar">
          <span>{notice}</span>
          <span>{healthStatusLabel}</span>
          <span>{sourceIntegrityLabel}</span>
          <span>本地优先</span>
          <span>AI 调用可追踪</span>
          <span>{watchStatus?.enabled ? `监听 ${watchStatus.rootCount} 个目录` : "后台监听关闭"}</span>
        </footer>
      </section>
    </main>
  );
}

export default App;
