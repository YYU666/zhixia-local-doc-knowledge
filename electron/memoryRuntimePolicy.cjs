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
const WORKING_MEMORY_STATUSES = ["active", "waiting_review", "blocked", "accepted", "superseded"];
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

function compactText(value, maxChars = 600) {
  const text = redactCompactText(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeIdPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 120) || "unknown";
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
  const allowedKinds = normalizeAllowedKinds(options);
  const rawItems = safeArray(retrieveResult.items);
  const items = rawItems.map(normalizeRuntimeItem).filter(Boolean);
  const tokenEstimate = Math.min(
    Math.max(0, Number(retrieveResult.tokenEstimate || 0)) || items.reduce((sum, item) => sum + item.tokenEstimate, 0),
    Math.max(200, Number(options.tokenBudget || retrieveResult.tokenBudget || 1200)),
  );
  return {
    schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
    request: {
      taskGoal: compactText(options.taskGoal || options.query || retrieveResult.query || "", 260),
      queryType: compactText(options.queryType || retrieveResult.queryType || "task_dispatch", 80),
      projectPath: options.projectPath || retrieveResult.projectPath || null,
      threadId: options.threadId || null,
      parentCeoThreadId: options.parentCeoThreadId || retrieveResult.parentCeoThreadId || null,
      tokenBudget: Math.max(200, Math.min(Number(options.tokenBudget || retrieveResult.tokenBudget || 1200), 4000)),
      allowedKinds,
    },
    project: projectFromRuntimeItems(items, options),
    items,
    sourceRefs: collectPacketSourceRefs(items),
    warnings: [
      "metadata_first_no_raw_session_body",
      "no_archive_compact_delete_move_restore",
      ...safeArray(retrieveResult.warnings).map((warning) => compactText(warning, 200)).filter(Boolean),
    ],
    tokenEstimate,
    generatedAt: retrieveResult.generatedAt || new Date().toISOString(),
  };
}

function buildRuntimePrecedentRequest(options = {}) {
  return {
    query: compactText(options.taskType || options.task_type || options.query || "", 240),
    queryType: "retrieve_precedent",
    projectPath: options.projectPath || null,
    parentCeoThreadId: options.parentCeoThreadId || null,
    tokenBudget: Math.max(200, Math.min(Number(options.tokenBudget || 1200), 4000)),
    maxResults: Math.max(1, Math.min(Number(options.maxResults || 8), 12)),
    includeKinds: normalizeAllowedKinds(options, DEFAULT_PRECEDENT_ALLOWED_KINDS),
  };
}

function buildRuntimePrecedentPacket(retrieveResult = {}, options = {}) {
  const contextPacket = buildRuntimeContextPacket(retrieveResult, {
    ...options,
    taskGoal: options.taskType || options.task_type || options.query,
    queryType: "retrieve_precedent",
    allowedKinds: normalizeAllowedKinds(options, DEFAULT_PRECEDENT_ALLOWED_KINDS),
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
    },
  };
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
  buildRuntimeContextPacket,
  buildRuntimePrecedentPacket,
  buildRuntimePrecedentRequest,
  buildFlowSkillReadyCandidate,
  evaluatePromotionCandidate,
  evaluateWritebackEvidence,
  listFlowSkillCandidateRecords,
  listWorkingMemoryRecords,
  normalizeRuntimeItem,
  promoteMemoryCandidate,
  upsertWorkingMemoryRecord,
  writeEvidenceWriteback,
};
