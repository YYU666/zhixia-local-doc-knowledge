const assert = require("node:assert/strict");

const {
  evaluateArchiveCandidate,
  inferArchiveThreadRole,
  normalizeArchiveCandidateEvidence,
} = require("../electron/archiveCandidatePolicy.cjs");

const now = "2026-06-12T16:00:00.000Z";
const baseThread = {
  threadId: "thread-1",
  status: "idle",
  projectStatus: "completed",
  archiveState: "warm",
  lastWriteTime: "2026-04-01T08:00:00.000Z",
  usageFrequency: 0,
  sessionBytes: 12 * 1024 * 1024,
  hasThreadHistoryVault: true,
  hasMemoryPointer: true,
  hasResumePacket: true,
  vaultManifestPath: "C:/Zhixia/vault/thread-1/manifest.json",
  vaultSessionPath: "C:/Zhixia/vault/thread-1/session.jsonl",
  compactReceiptPath: "C:/Zhixia/vault/thread-1/compact-receipt.json",
  compactReceiptSha256: "receipt-hash",
  vaultOriginalSha256: "vault-hash",
  vaultCopiedSha256: "vault-hash",
  sourceRefs: [
    { kind: "raw_session", path: "C:/codex/sessions/thread-1.jsonl", sha256: "raw-hash" },
    { kind: "zhixia_summary", path: "C:/Zhixia/vault/thread-1/manifest.json", sha256: "vault-hash" },
  ],
};

const allowed = evaluateArchiveCandidate(baseThread, { now });
assert.equal(allowed.isCandidate, true, "vaulted idle completed threads should become archive candidates");
assert.equal(allowed.archiveState, "candidate", "allowed candidate should expose candidate state");
assert.ok(allowed.reasons.includes("idle_past_threshold"), "candidate output should include idle reason");
assert.ok(allowed.reasons.includes("project_not_hot"), "candidate output should include project status reason");
assert.deepEqual(allowed.blockers, [], "allowed candidate should not include blockers");
assert.equal(allowed.evidence.hasVaultEvidence, true, "candidate evidence should confirm vault evidence");
assert.equal(allowed.evidence.hasReceiptEvidence, true, "candidate evidence should confirm receipt evidence");
assert.equal(allowed.evidence.compactReceiptSha256, "receipt-hash", "candidate evidence should retain receipt hash evidence");

const noVault = evaluateArchiveCandidate(
  {
    ...baseThread,
    hasThreadHistoryVault: false,
    vaultManifestPath: null,
    vaultSessionPath: null,
    vaultOriginalSha256: null,
    vaultCopiedSha256: null,
    vaultSha256: null,
  },
  { now },
);
assert.equal(noVault.isCandidate, false, "threads without a Thread History Vault must not be archive candidates");
assert.ok(noVault.blockers.includes("missing_thread_history_vault"), "missing vault should be a blocker");

const missingReceiptEvidence = evaluateArchiveCandidate(
  {
    ...baseThread,
    compactReceiptPath: null,
    compactReceiptSha256: null,
    vaultOriginalSha256: null,
    vaultCopiedSha256: null,
    vaultSha256: null,
  },
  { now },
);
assert.equal(missingReceiptEvidence.isCandidate, false, "threads without receipt path/hash evidence must not be archive candidates");
assert.ok(
  missingReceiptEvidence.blockers.includes("missing_compact_receipt_evidence"),
  "missing receipt path/hash evidence should be an explicit blocker",
);

const hostArchiveWithoutSlimming = evaluateArchiveCandidate(
  {
    ...baseThread,
    title: "Callback from bounded review lane ZHIXIA-OLD-WORKER",
    compactReceiptPath: null,
    compactReceiptSha256: null,
    lastWriteTime: "2026-06-08T08:00:00.000Z",
  },
  { now, requireCompactReceipt: false },
);
assert.equal(hostArchiveWithoutSlimming.isCandidate, false, "host sidebar archive queue should not allow CEO-created threads without compact receipts");
assert.equal(hostArchiveWithoutSlimming.evidence.archiveThreadRole, "ceo_created_thread", "callback/task-card threads should classify as CEO-created");
assert.equal(hostArchiveWithoutSlimming.evidence.idleDaysThreshold, 3, "CEO-created threads should use the 3-day cooling rule");
assert.ok(hostArchiveWithoutSlimming.reasons.includes("ceo_created_thread_three_day_rule"), "CEO-created archive candidates should expose the 3-day rule reason");
assert.ok(
  hostArchiveWithoutSlimming.blockers.includes("missing_compact_receipt_evidence"),
  "CEO-created archive candidates should require a compact receipt before host sidebar archive",
);

const recentWorker = evaluateArchiveCandidate(
  {
    ...baseThread,
    title: "Task ID: ZHIXIA-RECENT-WORKER implementation lane",
    compactReceiptPath: null,
    compactReceiptSha256: null,
    lastWriteTime: "2026-06-10T08:00:00.000Z",
  },
  { now, requireCompactReceipt: false },
);
assert.equal(recentWorker.isCandidate, false, "CEO-created threads under 3 days old should not enter the archive queue");
assert.ok(recentWorker.blockers.includes("role_cooling_period_not_reached"), "under-cooled worker threads should expose the cooling blocker");

const userInitiatedRecentWorker = evaluateArchiveCandidate(
  {
    ...baseThread,
    title: "Task ID: ZHIXIA-RECENT-WORKER implementation lane",
    lastWriteTime: "2026-06-10T08:00:00.000Z",
  },
  { now, bypassRoleCooling: true },
);
assert.equal(userInitiatedRecentWorker.isCandidate, true, "user-triggered safe pressure relief should not be blocked only by role cooling");
assert.ok(
  userInitiatedRecentWorker.reasons.includes("user_initiated_pressure_relief"),
  "user-triggered pressure relief should be visible in candidate reasons",
);

const ceoMainThread = evaluateArchiveCandidate(
  {
    ...baseThread,
    title: "Zhixia CEO Program Goal harvest dashboard",
    compactReceiptPath: null,
    compactReceiptSha256: null,
    lastWriteTime: "2026-06-01T08:00:00.000Z",
  },
  { now, requireCompactReceipt: false },
);
assert.equal(ceoMainThread.isCandidate, false, "CEO main threads should be retained longer than ordinary worker threads");
assert.equal(ceoMainThread.evidence.archiveThreadRole, "ceo_thread", "Program Goal/harvest threads should classify as CEO main threads");
assert.equal(ceoMainThread.evidence.idleDaysThreshold, 30, "CEO main threads should use the longer 30-day cooling rule");

const unknownOldThread = evaluateArchiveCandidate(
  {
    ...baseThread,
    title: "Old unclassified product discussion",
    summary: "Loose notes and historical discussion without clear ownership markers.",
    compactReceiptPath: null,
    compactReceiptSha256: null,
    lastWriteTime: "2026-06-08T08:00:00.000Z",
  },
  { now, requireCompactReceipt: false },
);
assert.equal(unknownOldThread.isCandidate, true, "unknown old threads should enter the queue after vaulting and cooling");
assert.equal(unknownOldThread.evidence.archiveThreadRole, "unknown", "unclassified threads should stay explicitly unknown");
assert.equal(unknownOldThread.evidence.idleDaysThreshold, 3, "unknown threads should use the 3-day archive-after-vault rule");

assert.equal(inferArchiveThreadRole({ summary: "Callback event: completion. Task ID: TEST-1 review lane" }), "ceo_created_thread");
assert.equal(inferArchiveThreadRole({ title: "CEO Flow Program Goal Completion Dashboard harvest" }), "ceo_thread");
assert.equal(
  inferArchiveThreadRole({
    archiveThreadRole: "unknown",
    title: "我最近新做了一个团队协作的skill(ceo-thread-orchestrator)，我想让你审计一下这个skill",
  }),
  "ceo_thread",
  "Chinese CEO Thread Orchestrator root/audit titles should override stale unknown labels and classify as CEO main threads",
);
assert.equal(
  inferArchiveThreadRole({ summary: "<codex_delegation><source_thread_id>019e-ceo</source_thread_id><input>Task ID: TEST implementation</input>" }),
  "ceo_created_thread",
  "delegated task cards with source_thread_id should classify as CEO-created threads",
);
assert.equal(inferArchiveThreadRole({ title: "random notes" }), "unknown");

const missingReceiptHashWithVaultHash = evaluateArchiveCandidate(
  {
    ...baseThread,
    compactReceiptPath: "C:/Zhixia/vault/thread-1/compact-receipt.json",
    compactReceiptSha256: null,
    vaultOriginalSha256: "vault-hash",
    vaultCopiedSha256: "vault-hash",
    vaultSha256: "vault-hash",
  },
  { now },
);
assert.equal(
  missingReceiptHashWithVaultHash.isCandidate,
  false,
  "receipt path plus vault hash must still be blocked when the receipt file hash is missing",
);
assert.ok(
  missingReceiptHashWithVaultHash.blockers.includes("missing_compact_receipt_evidence"),
  "vault hashes must not substitute for missing compact receipt hash evidence",
);

for (const status of ["active", "running"]) {
  const active = evaluateArchiveCandidate({ ...baseThread, status }, { now });
  assert.equal(active.isCandidate, false, `${status} threads must not be archive candidates`);
  assert.ok(active.blockers.includes("thread_active_or_running"), `${status} should be blocked as active/running`);
}

const activePreserved = evaluateArchiveCandidate(
  { ...baseThread, status: "preserved_not_archive_ready", archiveState: "preserved_not_archive_ready" },
  { now },
);
assert.equal(activePreserved.isCandidate, false, "active/recent preserved threads must not enter the archive queue");
assert.ok(activePreserved.blockers.includes("thread_active_or_running"), "preserved_not_archive_ready should be an active-skip blocker");

const currentCeo = evaluateArchiveCandidate(
  { ...baseThread, isCurrentCeoThread: true, title: "Current CEO main thread" },
  { now },
);
assert.equal(currentCeo.isCandidate, false, "current CEO main threads must be preserved but excluded from archive queue");
assert.ok(currentCeo.blockers.includes("thread_active_or_running"), "current CEO main should fail closed as active/current");

const coldInactiveWithVault = evaluateArchiveCandidate(
  { ...baseThread, status: "idle", archiveState: "cold", lastWriteTime: "2026-04-01T08:00:00.000Z" },
  { now },
);
assert.equal(coldInactiveWithVault.isCandidate, true, "cold inactive threads with vault evidence should remain archive eligible");

const recent = evaluateArchiveCandidate(
  { ...baseThread, lastWriteTime: "2026-06-12T15:30:00.000Z" },
  { now, recentWriteMinutes: 60 },
);
assert.equal(recent.isCandidate, false, "recently written threads must not be archive candidates");
assert.ok(recent.blockers.includes("recently_written"), "recent writes should be explicit blockers");

for (const hotFlag of [{ pinned: true }, { keepHot: true }, { archiveState: "hot" }]) {
  const hot = evaluateArchiveCandidate({ ...baseThread, ...hotFlag }, { now });
  assert.equal(hot.isCandidate, false, "pinned/keep-hot threads must not be archive candidates");
  assert.ok(hot.blockers.includes("pinned_or_keep_hot"), "pinned/keep-hot should be explicit blockers");
}

const hashMismatch = evaluateArchiveCandidate(
  {
    ...baseThread,
    hasThreadHistoryVault: false,
    vaultOriginalSha256: "aaa",
    vaultCopiedSha256: "bbb",
  },
  { now },
);
assert.equal(hashMismatch.isCandidate, false, "vault hash mismatch must block archive candidacy");
assert.ok(hashMismatch.blockers.includes("vault_hash_mismatch"), "hash mismatch should be explicit");

const unfinished = evaluateArchiveCandidate(
  { ...baseThread, unfinishedTaskCount: 1 },
  { now },
);
assert.equal(unfinished.isCandidate, false, "threads with unfinished work must not be archive candidates");
assert.ok(unfinished.blockers.includes("unfinished_work"), "unfinished work should be explicit");

const optimizedEvidence = normalizeArchiveCandidateEvidence({
  ...baseThread,
  hasThreadHistoryVault: false,
  hasMemoryPointer: false,
  memoryPointers: [],
  vaultManifestPath: null,
  vaultSessionPath: null,
  compactReceiptPath: null,
  compactReceiptSha256: null,
  vaultOriginalSha256: null,
  vaultCopiedSha256: null,
  vaultSha256: null,
  sourceRefs: [{ kind: "raw_session", path: "C:/codex/session.jsonl", sha256: "raw" }],
}, {
  optimized: {
    knowledgeItemId: "codex-history:thread-1",
    vaultManifestPath: "C:/Zhixia/vault/thread-1/vault.json",
    vaultSessionPath: "C:/Zhixia/vault/thread-1/session.jsonl",
    vaultSha256: "hash-ok",
    written: ["knowledge:codex-history:thread-1"],
  },
  compactReceipt: {
    receiptPath: "C:/Zhixia/vault/thread-1/compact-receipt.json",
    receiptSha256: "optimized-receipt-hash",
    originalSha256: "hash-ok",
    copiedSha256: "hash-ok",
  },
});
assert.equal(optimizedEvidence.hasThreadHistoryVault, true, "optimized Guardian metadata should count as vault evidence");
assert.equal(optimizedEvidence.hasMemoryPointer, true, "optimized Guardian metadata should count as memory pointer evidence");
assert.equal(optimizedEvidence.vaultOriginalSha256, "hash-ok", "single Guardian vault hash should be carried as original evidence");
assert.equal(optimizedEvidence.vaultCopiedSha256, "hash-ok", "single Guardian vault hash should be carried as copied evidence");
assert.equal(optimizedEvidence.compactReceiptPath.endsWith("compact-receipt.json"), true, "optimized Guardian metadata should retain receipt path evidence");
assert.equal(optimizedEvidence.compactReceiptSha256, "optimized-receipt-hash", "optimized Guardian metadata should retain receipt hash evidence");
assert.equal(
  evaluateArchiveCandidate(optimizedEvidence, { now }).isCandidate,
  true,
  "normalized optimized metadata should allow archive candidacy when other blockers are absent",
);

const receiptEvidence = normalizeArchiveCandidateEvidence({
  ...baseThread,
  hasThreadHistoryVault: false,
  hasMemoryPointer: false,
  memoryPointers: [],
  vaultManifestPath: null,
  vaultSessionPath: null,
  compactReceiptPath: null,
  compactReceiptSha256: null,
  vaultOriginalSha256: null,
  vaultCopiedSha256: null,
  vaultSha256: null,
  summary: "ZhixiaHistoryId: codex-history:thread-1",
}, {
  receipt: {
    vault_manifest_path: "C:/Zhixia/vault/thread-1/vault.json",
    vault_session_path: "C:/Zhixia/vault/thread-1/session.jsonl",
    vault_sha256: "receipt-hash",
  },
});
assert.equal(receiptEvidence.hasThreadHistoryVault, true, "compact receipt vault fields should count as vault evidence");
assert.equal(receiptEvidence.hasMemoryPointer, true, "ZhixiaHistoryId should count as a memory pointer");
assert.equal(receiptEvidence.compactReceiptPath, null, "receipt evidence without a receipt path should stay incomplete");

const guardianEnvelopeEvidence = normalizeArchiveCandidateEvidence(
  {
    threadId: "019e-realistic",
    title: "CEO maintenance old thread",
    status: "idle",
    projectStatus: "paused",
    archiveState: "warm",
    lastWriteTime: "2026-04-02T08:00:00.000Z",
    sessionBytes: 18 * 1024 * 1024,
    usageFrequency: 1,
    hasResumePacket: true,
    sourceRefs: [
      {
        kind: "raw_session",
        path: "C:/Users/example/.codex/sessions/2026/04/02/019e-realistic.jsonl",
        sha256: "raw-hash",
      },
      {
        kind: "zhixia_summary",
        path: "C:/Users/example/local app data/Roaming/Zhixia/codexHistoryVault/019e-realistic/manifest.json",
        sha256: "vault-hash",
      },
    ],
  },
  {
    optimized: {
      knowledgeItemId: "codex-history:019e-realistic",
      vaultManifestPath: "C:/Users/example/local app data/Roaming/Zhixia/codexHistoryVault/019e-realistic/manifest.json",
      vaultSessionPath: "C:/Users/example/local app data/Roaming/Zhixia/codexHistoryVault/019e-realistic/session.jsonl",
      vaultSha256: "vault-hash",
      memoryPointers: ["hot:019e-realistic", "warm:project:zhixia"],
      written: ["knowledge:codex-history:019e-realistic"],
    },
    compactReceipt: {
      receiptPath: "C:/Users/example/local app data/Roaming/Zhixia/codexHistoryVault/019e-realistic/compact-receipt.json",
      receiptSha256: "receipt-realistic-hash",
      thread_store_compatible: true,
      vault_manifest_path: "C:/Users/example/local app data/Roaming/Zhixia/codexHistoryVault/019e-realistic/manifest.json",
      originalSha256: "vault-hash",
      copiedSha256: "vault-hash",
    },
  },
);
assert.equal(guardianEnvelopeEvidence.hasThreadHistoryVault, true, "realistic Guardian envelope should normalize vault evidence");
assert.equal(guardianEnvelopeEvidence.hasMemoryPointer, true, "realistic Guardian envelope should normalize memory pointers");
assert.equal(guardianEnvelopeEvidence.compactReceiptPath.endsWith("compact-receipt.json"), true, "compact receipt path should be retained for UI/audit evidence");
assert.equal(guardianEnvelopeEvidence.compactReceiptSha256, "receipt-realistic-hash", "receipt hash should be retained for audit evidence");
assert.equal(guardianEnvelopeEvidence.threadStoreCompatible, true, "thread-store compatibility evidence should be retained");
const guardianEnvelopeResult = evaluateArchiveCandidate(guardianEnvelopeEvidence, { now });
assert.equal(guardianEnvelopeResult.isCandidate, true, "realistic vaulted idle Guardian envelope should become an archive candidate");
assert.equal(
  guardianEnvelopeResult.evidence.compactReceiptPath.endsWith("compact-receipt.json"),
  true,
  "candidate evidence should expose compact receipt path without running compact-session",
);
assert.equal(guardianEnvelopeResult.evidence.threadStoreCompatible, true, "candidate evidence should expose compatible receipt status");
assert.equal(
  guardianEnvelopeResult.evidence.sourceRefs.length >= 2,
  true,
  "candidate evidence should preserve source refs for CEO review",
);
assert.equal(
  guardianEnvelopeResult.evidence.compactReceiptSha256,
  "receipt-realistic-hash",
  "candidate evidence should preserve receipt hash evidence",
);

const nullCompatibilityCandidate = evaluateArchiveCandidate(
  normalizeArchiveCandidateEvidence(
    {
      ...baseThread,
      threadStoreCompatible: null,
      thread_store_compatible: null,
      compactCompatible: null,
    },
    {
      compactReceipt: {
        receiptPath: "C:/Zhixia/vault/thread-1/compact-receipt.json",
        receiptSha256: "receipt-hash",
        originalSha256: "vault-hash",
        copiedSha256: "vault-hash",
      },
    },
  ),
  { now },
);
assert.equal(
  nullCompatibilityCandidate.isCandidate,
  true,
  "threadStoreCompatible=null may still classify a thread as a read-only archive candidate when other evidence is present",
);
assert.equal(
  nullCompatibilityCandidate.evidence.threadStoreCompatible,
  null,
  "threadStoreCompatible=null must remain evidence-only metadata rather than archive-ready approval",
);

const incompatibleReceipt = evaluateArchiveCandidate(
  normalizeArchiveCandidateEvidence(baseThread, {
    receipt: {
      vault_manifest_path: "C:/Zhixia/vault/thread-1/vault.json",
      vault_sha256: "hash-ok",
      thread_store_compatible: false,
      receiptPath: "C:/Zhixia/vault/thread-1/bad-receipt.json",
      receiptSha256: "bad-receipt-hash",
    },
  }),
  { now },
);
assert.equal(incompatibleReceipt.isCandidate, false, "explicitly incompatible compact receipts must block archive candidacy");
assert.ok(incompatibleReceipt.blockers.includes("compact_receipt_incompatible"), "incompatible receipt should be an explicit blocker");

const normalizedMismatch = normalizeArchiveCandidateEvidence({
  ...baseThread,
  hasThreadHistoryVault: false,
  vaultManifestPath: null,
  vaultSessionPath: null,
  compactReceiptPath: "C:/Zhixia/vault/thread-1/compact-receipt.json",
  compactReceiptSha256: "receipt-hash",
  vaultOriginalSha256: null,
  vaultCopiedSha256: null,
  vaultSha256: null,
  vault: { originalSha256: "original", copiedSha256: "copy" },
});
const mismatchResult = evaluateArchiveCandidate(normalizedMismatch, { now });
assert.equal(mismatchResult.isCandidate, false, "normalized vault hash mismatch must still block archive candidacy");
assert.ok(mismatchResult.blockers.includes("vault_hash_mismatch"), "normalized mismatch should expose hash blocker");

const sourceRefFallback = evaluateArchiveCandidate(
  normalizeArchiveCandidateEvidence(
    {
      ...baseThread,
      hasMemoryPointer: false,
      memoryPointers: [],
      memoryPointer: null,
      zhixiaHistoryId: null,
      sourceRefs: [{ kind: "zhixia_summary", path: "C:/Zhixia/vault/thread-1/manifest.json", sha256: "vault-hash" }],
    },
    {
      compactReceipt: {
        receiptPath: "C:/Zhixia/vault/thread-1/compact-receipt.json",
        receiptSha256: "receipt-hash",
        originalSha256: "vault-hash",
        copiedSha256: "vault-hash",
      },
    },
  ),
  { now },
);
assert.equal(sourceRefFallback.isCandidate, true, "source refs should count as fallback history evidence when memory pointers are absent");
assert.equal(sourceRefFallback.evidence.hasSourceRefs, true, "candidate evidence should expose source ref fallback");
assert.equal(sourceRefFallback.evidence.hasMemoryPointer, false, "fallback case should still report missing memory pointer factually");

console.log("Archive candidate policy behavior tests passed.");
