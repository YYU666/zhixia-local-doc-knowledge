const crypto = require("node:crypto");

const CEO_MEMORY_GUARD_SCHEMA = "zhixia.ceo_memory_runtime_guard.v2";
const CEO_TAKEOVER_BOOTSTRAP_SCHEMA = "zhixia.ceo_takeover_bootstrap_packet.v1";
const CEO_LIFECYCLE_WRITEBACK_SCHEMA = "zhixia.ceo_lifecycle_writeback_packet.v1";

const { evaluateArchivePressure, retrievalBudgetEnvelope } = require("../codex-skills/zhixia-local-docs/scripts/memory-context-policy.cjs");
const MAX_TEXT_CHARS = 900;
const BASE64_RE = /\bdata:[^;,\s]+;base64,[A-Za-z0-9+/=]{80,}|\b[A-Za-z0-9+/]{180,}={0,2}\b/g;
const RAW_SESSION_RE = /(?:^|[\\/])\.codex[\\/]sessions[\\/]|(?:raw|codex|thread)[_ -]?session|session[_ -]?jsonl/i;
const SECRET_RE = /(?:^|[\\/])\.env(?:$|[\\/._-])|\b(api[_ -]?key|auth[_ -]?token|bearer[_ -]?token|credential|credentials|secret|secrets|private[_ -]?key|id_rsa|oauth|cookie|password)\b/i;
const DATA_IMAGE_RE = /\bdata:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{40,}/gi;

const CEO_LIFECYCLE_STAGES = [
  "bootstrap",
  "dispatch",
  "worker_callback",
  "review",
  "harvest",
  "decision",
  "handoff",
  "thread_pressure",
];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function redactCompactText(value, maxChars = MAX_TEXT_CHARS) {
  const text = String(value || "")
    .replace(DATA_IMAGE_RE, "[image-payload-omitted]")
    .replace(BASE64_RE, "[base64-payload-omitted]")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]*\.codex[\\/]sessions[\\/][^\s"'<>|]+/gi, "[raw-session-pointer-omitted]")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>|]*\.env(?:\.[^\s"'<>|]+)?/gi, "[secret-pointer-omitted]")
    .replace(/\b(?:api[_-]?key|auth[_-]?token|bearer[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[secret-omitted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [secret-omitted]")
    .replace(/\bsk-[A-Za-z0-9]{12,}\b/gi, "[secret-omitted]")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeIdPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 120) || "unknown";
}

function normalizeStage(value) {
  return CEO_LIFECYCLE_STAGES.includes(value) ? value : "handoff";
}

function normalizeDecision(value) {
  return ["accept", "revise", "block", "supersede"].includes(value) ? value : "revise";
}

function normalizeSourceRefs(refs, limit = 16) {
  const result = [];
  const omitted = { rawSession: 0, secrets: 0 };
  const seen = new Set();
  for (const ref of safeArray(refs)) {
    if (!ref || typeof ref !== "object") continue;
    const signal = [ref.kind, ref.sourceType, ref.path, ref.title].filter(Boolean).join(" ");
    if (RAW_SESSION_RE.test(signal)) {
      omitted.rawSession += 1;
      continue;
    }
    if (SECRET_RE.test(signal)) {
      omitted.secrets += 1;
      continue;
    }
    const normalized = {
      kind: redactCompactText(ref.kind || ref.sourceType || "source", 80) || "source",
      path: ref.path ? redactCompactText(ref.path, 320) : null,
      title: ref.title ? redactCompactText(ref.title, 180) : null,
      hash: ref.hash || ref.sha256 || ref.sourceHash || null,
      updatedAt: ref.updatedAt || ref.modifiedAt || null,
      readByDefault: ref.readByDefault === false ? false : undefined,
    };
    const key = `${normalized.kind}|${normalized.path || ""}|${normalized.hash || ""}|${normalized.title || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return { refs: result, omitted };
}

function evaluateCeoThreadPressure(input = {}) {
  return evaluateArchivePressure(input);
}

function buildCeoLifecycleWritebackPacket(input = {}) {
  const stage = normalizeStage(input.stage);
  const decision = normalizeDecision(input.decision);
  const sourceRefResult = normalizeSourceRefs(input.sourceRefs || input.evidence?.sourceRefs, 20);
  const pressure = input.threadPressure && typeof input.threadPressure === "object"
    ? evaluateCeoThreadPressure(input.threadPressure)
    : input.pressure && typeof input.pressure === "object"
    ? evaluateCeoThreadPressure(input.pressure.metrics || {})
    : null;
  const warnings = [
    ...(sourceRefResult.omitted.rawSession > 0 ? ["raw_session_source_refs_omitted"] : []),
    ...(sourceRefResult.omitted.secrets > 0 ? ["secret_source_refs_omitted"] : []),
    ...(pressure?.warnings || []),
  ];
  const taskId = redactCompactText(input.taskId || input.task?.id || `ceo-${stage}-${safeIdPart(input.threadId || input.parentCeoThreadId || "thread")}`, 140);
  const projectPath = input.projectPath || input.task?.projectPath || null;
  const threadId = input.threadId || input.task?.threadId || null;
  const parentCeoThreadId = input.parentCeoThreadId || input.task?.parentCeoThreadId || threadId || null;
  const summary = redactCompactText(input.summary || input.evidence?.summary || input.goal || input.task?.goal || "", 1000);
  const packet = {
    schemaVersion: CEO_LIFECYCLE_WRITEBACK_SCHEMA,
    mode: "ceo_lifecycle_writeback_packet",
    generatedAt: new Date().toISOString(),
    stage,
    evidenceWritebackPacket: {
      schemaVersion: 1,
      decision,
      task: {
        id: taskId,
        goal: redactCompactText(input.goal || input.task?.goal || summary, 500),
        domain: safeArray(input.domain || input.task?.domain).map((item) => redactCompactText(item, 80)).filter(Boolean).slice(0, 12),
        projectPath,
        threadId,
        parentCeoThreadId,
      },
      evidence: {
        summary,
        changedFiles: safeArray(input.changedFiles || input.evidence?.changedFiles).map((item) => redactCompactText(item, 260)).filter(Boolean).slice(0, 40),
        artifacts: safeArray(input.artifacts || input.evidence?.artifacts).map((item) => redactCompactText(item, 260)).filter(Boolean).slice(0, 40),
        tests: safeArray(input.tests || input.evidence?.tests).map((item) => redactCompactText(item, 220)).filter(Boolean).slice(0, 40),
        accepted: safeArray(input.accepted || input.evidence?.accepted).map((item) => redactCompactText(item, 260)).filter(Boolean).slice(0, 30),
        pending: safeArray(input.pending || input.evidence?.pending).map((item) => redactCompactText(item, 260)).filter(Boolean).slice(0, 30),
        stale: safeArray(input.stale || input.evidence?.stale).map((item) => redactCompactText(item, 260)).filter(Boolean).slice(0, 30),
        conflicts: safeArray(input.conflicts || input.evidence?.conflicts).map((item) => redactCompactText(item, 260)).filter(Boolean).slice(0, 20),
        residualRisk: redactCompactText(input.residualRisk || input.evidence?.residualRisk || "", 700),
        sourceRefs: sourceRefResult.refs,
      },
      writeback: {
        knowledgeCandidates: [],
        experienceCandidates: stage === "thread_pressure" || decision !== "accept"
          ? [{ status: "candidate", summary: summary || "CEO lifecycle pressure or revise/block evidence." }]
          : [],
        lineageUpdates: threadId ? [{ status: "candidate", threadId, parentCeoThreadId, stage }] : [],
        projectUpdates: projectPath ? [{ status: "candidate", projectPath, stage, summary }] : [],
      },
      privacy: {
        containsRawSession: false,
        containsSecrets: false,
        publicCandidateAllowed: false,
      },
    },
    workingMemoryRecord: {
      schemaVersion: 1,
      taskId,
      projectPath,
      threadId,
      parentCeoThreadId,
      status: decision === "accept" ? "accepted" : decision === "block" ? "blocked" : "active",
      currentGoal: redactCompactText(input.goal || input.task?.goal || summary, 600),
      currentEvidence: sourceRefResult.refs,
      decisions: safeArray(input.decisions || input.accepted).map((item) => redactCompactText(item, 240)).filter(Boolean).slice(0, 30),
      openRisks: safeArray(input.openRisks || input.pending || input.conflicts).map((item) => redactCompactText(item, 240)).filter(Boolean).slice(0, 30),
      nextAction: redactCompactText(input.nextAction || "", 360),
      updatedAt: new Date().toISOString(),
    },
    runtimeEvent: {
      eventType: stage === "thread_pressure" ? "runtime_diagnosis" : stage === "handoff" ? "thread_takeover" : "task_checkpoint",
      severity: pressure?.pressureLevel === "critical" ? "critical" : pressure?.pressureLevel === "high" ? "warning" : "info",
      projectPath,
      threadId,
      parentCeoThreadId,
      title: redactCompactText(input.title || `CEO lifecycle ${stage}`, 180),
      summary,
      observedSignals: pressure ? pressure.warnings : [],
      decisions: safeArray(input.decisions || input.accepted).map((item) => redactCompactText(item, 240)).filter(Boolean).slice(0, 20),
      openRisks: safeArray(input.openRisks || input.pending || input.conflicts).map((item) => redactCompactText(item, 240)).filter(Boolean).slice(0, 20),
      nextAction: redactCompactText(input.nextAction || "", 360),
      sourceRefs: sourceRefResult.refs,
    },
    pressure,
    warnings,
    hash: hashJson({ stage, decision, taskId, projectPath, threadId, summary, refs: sourceRefResult.refs }),
    safety: {
      metadataOnly: true,
      rawSessionBodyRead: false,
      storesRawSessionRefs: false,
      startsTimers: false,
      scansVault: false,
      archiveCompactDeleteMoveRestore: false,
      mutatesRawSession: false,
    },
  };
  return packet;
}

function buildCeoTakeoverBootstrapPacket(input = {}) {
  const pressure = evaluateCeoThreadPressure(input.threadPressure || input.pressure?.metrics || input);
  const budgetEnvelope = retrievalBudgetEnvelope(input, "prepare_takeover");
  const sourceRefResult = normalizeSourceRefs(input.sourceRefs || input.projectSourceRefs, 20);
  const coldPointers = safeArray(input.coldHistorySources || input.staleThreadIds || input.badThreadIds).map((item) => {
    if (typeof item === "string") {
      return {
        kind: "thread_history_pointer",
        threadId: redactCompactText(item, 120),
        title: null,
        path: null,
        readByDefault: false,
      };
    }
    return {
      kind: redactCompactText(item.kind || "thread_history_pointer", 80),
      threadId: item.threadId ? redactCompactText(item.threadId, 120) : null,
      title: item.title ? redactCompactText(item.title, 180) : null,
      path: item.path ? redactCompactText(item.path, 320) : null,
      hash: item.hash || item.sha256 || null,
      readByDefault: false,
    };
  }).slice(0, 20);
  const projectName = redactCompactText(input.projectName || input.title || "当前项目", 160);
  const taskGoal = redactCompactText(input.taskGoal || input.goal || `恢复 ${projectName} 当前项目状态`, 360);
  return {
    schemaVersion: CEO_TAKEOVER_BOOTSTRAP_SCHEMA,
    mode: "ceo_takeover_bootstrap_packet",
    generatedAt: new Date().toISOString(),
    project: {
      name: projectName,
      path: input.projectPath || null,
      summary: redactCompactText(input.projectSummary || input.summary || "", 700),
    },
    threads: {
      currentCeoThreadId: input.currentCeoThreadId || input.threadId || null,
      replacementThreadId: input.replacementThreadId || input.takeoverThreadId || null,
      staleThreadIds: safeArray(input.staleThreadIds || input.badThreadIds).map((item) => redactCompactText(typeof item === "string" ? item : item.threadId, 120)).filter(Boolean).slice(0, 20),
    },
    request: {
      taskGoal,
      tokenBudget: budgetEnvelope.preferredTokenBudget,
      budgetEnvelope,
      queryType: "thread_recovery",
    },
    authoritative: false,
    replacementContextAllowed: false,
    preferredOperation: "prepare_takeover",
    threadPressure: pressure,
    recallPlan: {
      defaultReadOrder: ["hot", "warm", "canonical_docs", "skill", "source_refs", "cold_pointers_only"],
      hot: "current goal, working memory, recent accepted decisions, blockers, next action",
      warm: "long-term project anchors, PRD/product direction, architecture constraints, accepted module progress",
      skill: "procedural lessons and reusable workflow candidates; advisory only",
      cold: "Thread History Vault/raw session/archive pointers only; readByDefault=false unless an explicit recovery hard gate is satisfied",
      coldLayer: { defaultRead: false, requiresExplicitGate: true },
    },
    recommendedHooks: [{
      hook: "prepare_takeover",
      queryType: "thread_recovery",
      tokenBudget: budgetEnvelope.preferredTokenBudget,
      reason: "use one verified app-owned envelope; this legacy plan is not replacement context",
    }],
    sourceRefs: sourceRefResult.refs,
    coldHistorySources: coldPointers,
    oneLinePrompt: `你是 ${projectName} 的新 CEO 接管线程。请使用知匣 Memory Runtime 恢复当前项目状态：先读 Hot/Warm/Skill 记忆和 canonical docs，Cold/raw 历史只看 sourceRefs，不默认加载旧线程全文、图片/base64 或完整工具日志。`,
    warnings: [
      ...(sourceRefResult.omitted.rawSession > 0 ? ["raw_session_source_refs_omitted_from_default_bootstrap"] : []),
      ...(sourceRefResult.omitted.secrets > 0 ? ["secret_source_refs_omitted_from_default_bootstrap"] : []),
      ...(pressure.warnings || []),
    ],
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

function prepareCeoTakeover(options = {}, { executeRuntime, storeRoot }) {
  const workspace = options.projectPath || options.workspace;
  if (!workspace) throw new Error("takeover_canonical_workspace_required");
  return executeRuntime({
    operation: "prepare_takeover",
    workspace,
    storeRoot,
    taskGoal: options.taskGoal || options.goal || options.query || options.projectName || options.title || "CEO takeover",
    queryType: "thread_recovery",
    tokenBudget: options.tokenBudget,
    maxTokenBudget: options.maxTokenBudget,
    strictTokenBudget: options.strictTokenBudget,
    limit: options.maxResults || options.limit,
    readOnly: true,
  });
}

module.exports = {
  CEO_LIFECYCLE_STAGES,
  CEO_LIFECYCLE_WRITEBACK_SCHEMA,
  CEO_MEMORY_GUARD_SCHEMA,
  CEO_TAKEOVER_BOOTSTRAP_SCHEMA,
  buildCeoLifecycleWritebackPacket,
  buildCeoTakeoverBootstrapPacket,
  evaluateCeoThreadPressure,
  prepareCeoTakeover,
};
