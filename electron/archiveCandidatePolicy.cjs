const DEFAULT_IDLE_DAYS = 30;
const DEFAULT_CEO_THREAD_IDLE_DAYS = 30;
const DEFAULT_CEO_CREATED_THREAD_IDLE_DAYS = 3;
const DEFAULT_UNKNOWN_THREAD_IDLE_DAYS = 3;
const DEFAULT_RECENT_WRITE_MINUTES = 60;
const DEFAULT_LARGE_SESSION_BYTES = 8 * 1024 * 1024;

function compactText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / 86400000);
}

function minutesBetween(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / 60000);
}

function hasVerifiedVault(thread) {
  if (thread?.hasThreadHistoryVault === true || thread?.hasVault === true) return true;
  if (thread?.vault?.verified === true) return true;
  const original = String(thread?.vaultOriginalSha256 || thread?.originalSha256 || "").trim();
  const copied = String(thread?.vaultCopiedSha256 || thread?.copiedSha256 || "").trim();
  return Boolean(original && copied && original === copied);
}

function hasVaultHashMismatch(thread) {
  const original = String(thread?.vaultOriginalSha256 || thread?.originalSha256 || "").trim();
  const copied = String(thread?.vaultCopiedSha256 || thread?.copiedSha256 || "").trim();
  return Boolean(original && copied && original !== copied);
}

function hasMemoryPointer(thread) {
  return (
    thread?.hasMemoryPointer === true ||
    thread?.hasZhixiaHistoryPointer === true ||
    Boolean(compactText(thread?.memoryPointer || thread?.zhixiaHistoryId)) ||
    (Array.isArray(thread?.memoryPointers) && thread.memoryPointers.length > 0)
  );
}

function hasSourceRefs(thread) {
  return safeArray(thread?.sourceRefs).some((ref) =>
    Boolean(compactText(ref?.path) || compactText(ref?.title) || compactText(ref?.sha256)),
  );
}

function hasIncompatibleCompactReceipt(thread) {
  return (
    thread?.threadStoreCompatible === false ||
    thread?.thread_store_compatible === false ||
    thread?.compactCompatible === false ||
    thread?.compactReceipt?.thread_store_compatible === false ||
    thread?.compactReceipt?.threadStoreCompatible === false ||
    thread?.receipt?.thread_store_compatible === false ||
    thread?.receipt?.threadStoreCompatible === false
  );
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values, limit = 8) {
  return Array.from(new Set(safeArray(values).map((value) => compactText(value)).filter(Boolean))).slice(0, limit);
}

function hasVaultEvidence(thread) {
  return Boolean(
    compactText(thread?.vaultManifestPath) ||
      compactText(thread?.vaultSessionPath) ||
      compactText(thread?.vaultSha256) ||
      compactText(thread?.vaultOriginalSha256) ||
      compactText(thread?.vaultCopiedSha256),
  );
}

function hasReceiptEvidence(thread) {
  return Boolean(
    compactText(thread?.compactReceiptPath) &&
      compactText(thread?.compactReceiptSha256),
  );
}

function normalizeArchiveCandidateEvidence(thread = {}, metadata = {}) {
  const sourceRefs = [...safeArray(thread.sourceRefs), ...safeArray(metadata.sourceRefs)];
  const optimized = thread.optimized || metadata.optimized || {};
  const receipt = thread.compactReceipt || thread.receipt || metadata.compactReceipt || metadata.receipt || {};
  const vault = thread.vault || metadata.vault || {};
  const sourceRefText = sourceRefs.map((ref) => `${ref?.kind || ""} ${ref?.path || ""} ${ref?.sha256 || ""}`).join(" ");
  const memoryPointers = uniqueStrings([
    thread.memoryPointer,
    thread.zhixiaHistoryId,
    optimized.knowledgeItemId,
    ...(safeArray(thread.memoryPointers)),
    ...(safeArray(optimized.memoryPointers)),
    ...(safeArray(optimized.written).filter((item) => /codex-history:|knowledge|memory|hot|warm/i.test(String(item || "")))),
  ]);
  const vaultManifestPath =
    thread.vaultManifestPath ||
    vault.manifestPath ||
    optimized.vaultManifestPath ||
    receipt.vault_manifest_path ||
    receipt.vaultManifestPath ||
    null;
  const vaultSessionPath =
    thread.vaultSessionPath ||
    vault.vaultSessionPath ||
    optimized.vaultSessionPath ||
    receipt.vault_session_path ||
    receipt.vaultSessionPath ||
    null;
  const vaultHash =
    thread.vaultSha256 ||
    vault.originalSha256 ||
    vault.copiedSha256 ||
    optimized.vaultSha256 ||
    receipt.vault_sha256 ||
    receipt.vaultSha256 ||
    null;
  const compactReceiptPath =
    thread.compactReceiptPath ||
    thread.receiptPath ||
    receipt.receiptPath ||
    receipt.path ||
    receipt.outputPath ||
    receipt.compact_receipt_path ||
    null;
  const compactReceiptSha256 =
    thread.compactReceiptSha256 ||
    thread.receiptSha256 ||
    receipt.receiptSha256 ||
    receipt.sha256 ||
    receipt.receipt_sha256 ||
    null;
  const threadStoreCompatible =
    thread.threadStoreCompatible ??
    thread.thread_store_compatible ??
    thread.compactCompatible ??
    receipt.threadStoreCompatible ??
    receipt.thread_store_compatible ??
    null;

  return {
    ...thread,
    sourceRefs,
    vaultManifestPath,
    vaultSessionPath,
    vaultSha256: vaultHash,
    compactReceiptPath,
    compactReceiptSha256,
    threadStoreCompatible,
    vaultOriginalSha256: thread.vaultOriginalSha256 || thread.originalSha256 || vault.originalSha256 || receipt.originalSha256 || vaultHash || null,
    vaultCopiedSha256: thread.vaultCopiedSha256 || thread.copiedSha256 || vault.copiedSha256 || receipt.copiedSha256 || vaultHash || null,
    hasThreadHistoryVault:
      thread.hasThreadHistoryVault === true ||
      thread.hasVault === true ||
      vault.verified === true ||
      Boolean(vaultManifestPath || vaultSessionPath || vaultHash) ||
      /vault|zhixia_summary|codex-history|Thread History Vault/i.test(sourceRefText),
    hasMemoryPointer:
      thread.hasMemoryPointer === true ||
      thread.hasZhixiaHistoryPointer === true ||
      memoryPointers.length > 0 ||
      /codex-history:|ZhixiaHistoryId|Thread History Vault|memory pointer/i.test(
        `${thread.summary || ""} ${thread.whyMatched || ""} ${sourceRefText}`,
      ),
    memoryPointers,
  };
}

function normalizeStatus(status) {
  return String(status || "unknown").trim().toLowerCase();
}

function hasActivePreservationBlocker(thread = {}, status = normalizeStatus(thread?.status), archiveState = normalizeStatus(thread?.archiveState)) {
  return Boolean(
    ["active", "running", "executing", "streaming", "current", "current_thread", "preserved_not_archive_ready"].includes(status) ||
      ["active", "running", "hot", "current", "preserved_not_archive_ready"].includes(archiveState) ||
      thread?.isCurrentThread === true ||
      thread?.currentThread === true ||
      thread?.isCurrentCeoThread === true ||
      thread?.currentCeoThread === true ||
      thread?.hasUnfinishedWork === true ||
      thread?.unfinished === true ||
      thread?.isUnfinished === true ||
      ["waiting_review", "waiting_user", "in_progress"].includes(status)
  );
}

function inferArchiveThreadRole(thread = {}) {
  const rawExplicit = thread.archiveThreadRole || thread.threadRole || thread.ceoThreadRole;
  const explicit = rawExplicit ? normalizeStatus(rawExplicit) : "";
  if (["ceo_thread", "ceo_created_thread"].includes(explicit)) return explicit;

  const text = [
    thread.title,
    thread.summary,
    thread.whyMatched,
    thread.continuationAdvice,
    ...safeArray(thread.tags),
    ...safeArray(thread.sourceRefs).map((ref) => `${ref?.title || ""} ${ref?.path || ""} ${ref?.section || ""} ${ref?.field || ""}`),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /callback|codex_delegation|task id|source_thread_id|implementation lane|review lane|prep lane|audit lane|worker lane|bounded review|completion for|decision:\s*(accept|revise|block)|员工线程|实现线程|审计线程|复核线程|准备线程|回调|工作线程|专家线程/.test(text)
  ) {
    return "ceo_created_thread";
  }

  if (
    /program goal|completion dashboard|next execution wave|harvest|core team|ceo[-_\s]*thread[-_\s]*orchestrator|ceo flow|ceo skill|lane roster|task graph|project lead|orchestrator maintenance|项目总目标|收菜|主线程|维护线程|团队协作.*skill|编排|总控|中枢|起始审计线程/.test(text)
  ) {
    return "ceo_thread";
  }

  return "unknown";
}

function idleDaysThresholdForRole(role, options = {}) {
  if (role === "ceo_thread") return Math.max(1, Number(options.ceoThreadIdleDays || DEFAULT_CEO_THREAD_IDLE_DAYS));
  if (role === "ceo_created_thread") return Math.max(1, Number(options.ceoCreatedThreadIdleDays || DEFAULT_CEO_CREATED_THREAD_IDLE_DAYS));
  return Math.max(1, Number(options.unknownThreadIdleDays || DEFAULT_UNKNOWN_THREAD_IDLE_DAYS));
}

function evaluateArchiveCandidate(thread, options = {}) {
  const now = toDate(options.now) || new Date();
  const archiveThreadRole = inferArchiveThreadRole(thread);
  const idleDaysThreshold = Number.isFinite(Number(options.idleDaysThreshold))
    ? Math.max(1, Number(options.idleDaysThreshold))
    : idleDaysThresholdForRole(archiveThreadRole, options);
  const recentWriteMinutes = Math.max(1, Number(options.recentWriteMinutes || DEFAULT_RECENT_WRITE_MINUTES));
  const largeSessionBytes = Math.max(1, Number(options.largeSessionBytes || DEFAULT_LARGE_SESSION_BYTES));
  const requireCompactReceipt = options.requireCompactReceipt !== false;
  const requireCeoCompactReceipt = options.requireCeoCompactReceipt !== false;
  const roleRequiresCompactReceipt =
    requireCompactReceipt ||
    (requireCeoCompactReceipt && ["ceo_thread", "ceo_created_thread"].includes(archiveThreadRole));
  const bypassRoleCooling = options.bypassRoleCooling === true;
  const status = normalizeStatus(thread?.status);
  const projectStatus = normalizeStatus(thread?.projectStatus);
  const archiveState = normalizeStatus(thread?.archiveState);
  const lastWrite = toDate(thread?.lastWriteTime || thread?.lastWriteAt || thread?.updatedAt || thread?.lastActivityAt);
  const idleDays = lastWrite ? daysBetween(now, lastWrite) : null;
  const sessionBytes = Math.max(0, Number(thread?.sessionBytes || thread?.sizeBytes || 0));
  const usageFrequency = Math.max(0, Number(thread?.usageFrequency || 0));
  const blockers = [];
  const reasons = [];

  if (!String(thread?.threadId || thread?.id || "").trim()) blockers.push("missing_thread_id");
  if (hasActivePreservationBlocker(thread, status, archiveState)) blockers.push("thread_active_or_running");
  if (
    thread?.hasOpenToolCalls === true ||
    Number(thread?.unfinishedTaskCount || 0) > 0 ||
    thread?.hasUnfinishedWork === true ||
    thread?.unfinished === true ||
    thread?.isUnfinished === true ||
    ["waiting_review", "waiting_user", "in_progress"].includes(status)
  ) blockers.push("unfinished_work");
  if (thread?.pinned === true || thread?.keepHot === true || archiveState === "hot") blockers.push("pinned_or_keep_hot");
  if (lastWrite && minutesBetween(now, lastWrite) < recentWriteMinutes) blockers.push("recently_written");
  if (!hasVerifiedVault(thread)) blockers.push("missing_thread_history_vault");
  if (!hasVaultEvidence(thread)) blockers.push("missing_vault_evidence");
  if (hasVaultHashMismatch(thread)) blockers.push("vault_hash_mismatch");
  if (!hasMemoryPointer(thread) && !hasSourceRefs(thread)) {
    blockers.push("missing_memory_pointer");
    blockers.push("missing_memory_pointer_or_source_refs");
  }
  if (roleRequiresCompactReceipt && !hasReceiptEvidence(thread)) blockers.push("missing_compact_receipt_evidence");
  if (hasIncompatibleCompactReceipt(thread)) blockers.push("compact_receipt_incompatible");
  if (thread?.hasResumePacket === false) blockers.push("missing_project_resume_packet");
  if (!bypassRoleCooling && idleDays !== null && idleDays < idleDaysThreshold) blockers.push("role_cooling_period_not_reached");

  if (lastWrite && idleDays >= idleDaysThreshold) reasons.push("idle_past_threshold");
  if (bypassRoleCooling) reasons.push("user_initiated_pressure_relief");
  if (archiveThreadRole === "ceo_thread") reasons.push("ceo_main_thread_longer_retention");
  if (archiveThreadRole === "ceo_created_thread") reasons.push("ceo_created_thread_three_day_rule");
  if (archiveThreadRole === "unknown") reasons.push("unknown_thread_archive_after_vault");
  if (usageFrequency <= 1) reasons.push("low_usage_frequency");
  if (["completed", "paused", "archived", "stale"].includes(projectStatus)) reasons.push("project_not_hot");
  if (sessionBytes >= largeSessionBytes) reasons.push("large_session");
  if (["idle", "notloaded", "systemerror", "unknown"].includes(status)) reasons.push("not_running");
  if (archiveState === "warm" || archiveState === "cold") reasons.push(`already_${archiveState}`);

  const isCandidate = blockers.length === 0 && reasons.length > 0;
  return {
    threadId: String(thread?.threadId || thread?.id || "").trim() || null,
    isCandidate,
    archiveState: isCandidate ? "candidate" : "blocked",
    reasons,
    blockers,
    evidence: {
      status,
      projectStatus,
      archiveState,
      lastWriteTime: lastWrite ? lastWrite.toISOString() : null,
      idleDays,
      idleDaysThreshold,
      archiveThreadRole,
      requireCompactReceipt: roleRequiresCompactReceipt,
      requireCeoCompactReceipt,
      bypassRoleCooling,
      sessionBytes,
      usageFrequency,
      hasVault: hasVerifiedVault(thread),
      hasVaultEvidence: hasVaultEvidence(thread),
      hasMemoryPointer: hasMemoryPointer(thread),
      hasSourceRefs: hasSourceRefs(thread),
      hasReceiptEvidence: hasReceiptEvidence(thread),
      vaultManifestPath: thread?.vaultManifestPath || thread?.vault?.manifestPath || null,
      vaultSessionPath: thread?.vaultSessionPath || thread?.vault?.vaultSessionPath || null,
      vaultSha256: thread?.vaultSha256 || thread?.vault?.originalSha256 || thread?.receipt?.vault_sha256 || thread?.receipt?.vaultSha256 || null,
      vaultOriginalSha256: thread?.vaultOriginalSha256 || thread?.originalSha256 || thread?.vault?.originalSha256 || thread?.receipt?.originalSha256 || null,
      vaultCopiedSha256: thread?.vaultCopiedSha256 || thread?.copiedSha256 || thread?.vault?.copiedSha256 || thread?.receipt?.copiedSha256 || null,
      compactReceiptPath: thread?.compactReceiptPath || thread?.compactReceipt?.receiptPath || thread?.receipt?.receiptPath || null,
      compactReceiptSha256: thread?.compactReceiptSha256 || thread?.compactReceipt?.receiptSha256 || thread?.compactReceipt?.sha256 || thread?.receipt?.receiptSha256 || thread?.receipt?.sha256 || null,
      threadStoreCompatible: thread?.threadStoreCompatible ?? thread?.thread_store_compatible ?? thread?.compactCompatible ?? thread?.compactReceipt?.thread_store_compatible ?? thread?.receipt?.thread_store_compatible ?? null,
      memoryPointers: uniqueStrings(thread?.memoryPointers),
      sourceRefs: safeArray(thread?.sourceRefs).slice(0, 8),
    },
  };
}

module.exports = {
  DEFAULT_IDLE_DAYS,
  DEFAULT_CEO_THREAD_IDLE_DAYS,
  DEFAULT_CEO_CREATED_THREAD_IDLE_DAYS,
  DEFAULT_UNKNOWN_THREAD_IDLE_DAYS,
  DEFAULT_LARGE_SESSION_BYTES,
  DEFAULT_RECENT_WRITE_MINUTES,
  evaluateArchiveCandidate,
  inferArchiveThreadRole,
  hasActivePreservationBlocker,
  normalizeArchiveCandidateEvidence,
};
