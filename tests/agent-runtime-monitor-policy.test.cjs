const assert = require("node:assert/strict");

const {
  buildRuntimeMonitorSnapshot,
  enrichRuntimeSession,
  getRuntimePlatformSupport,
  normalizeRuntimeProcessSample,
  normalizeRuntimeSession,
  redactSensitiveRuntimeText,
  recommendRuntimeAction,
  scoreRuntimeSessionPressure,
} = require("../electron/agentRuntimeMonitorPolicy.cjs");

const sampledAt = "2026-06-12T18:20:00.000Z";
const largeSessionBytes = 8 * 1024 * 1024;

const processSample = normalizeRuntimeProcessSample({
  platform: "codex",
  processId: 1234,
  processName: "Codex.exe",
  cpuPercent: 230,
  memoryBytes: "not-a-number",
  sampledAt,
});
assert.equal(processSample.cpuPercent, 100, "process CPU should be clamped to a safe percentage");
assert.equal(processSample.rawCpuPercent, 230, "raw CPU should be preserved for ranking evidence");
assert.equal(processSample.memoryBytes, 0, "invalid memory samples should fall back to zero");
assert.equal(processSample.platform, "codex", "known platforms should be preserved");
assert.equal(processSample.platformSupport.supportLevel, "session_metadata_mvp", "Codex support should be explicit as session metadata MVP");
assert.equal(processSample.sensitiveFieldPolicy, "compact_and_redact_secret_like_command_line_tokens", "process samples should declare sensitive field handling");

const redactedCommand = redactSensitiveRuntimeText("node cli.js --api-key sk-123456789012345 token=secret-value Bearer abcdefghijklmnop");
assert.equal(
  redactedCommand,
  "node cli.js --api-key [REDACTED] token=[REDACTED] Bearer [REDACTED]",
  "runtime monitor command lines should redact common secret-like tokens",
);
assert.equal(
  redactSensitiveRuntimeText(`node worker.js ${["sk", "proj", "abc_1234567890", "SECRET"].join("-")}`),
  "node worker.js [REDACTED]",
  "runtime monitor command lines should redact standalone modern sk-proj style tokens",
);
const redactedProcess = normalizeRuntimeProcessSample({
  platform: "claude_code",
  processId: 2345,
  processName: "claude.exe",
  commandLine: "claude --api-key sk-123456789012345 --project C:/work",
  sampledAt,
});
assert.equal(redactedProcess.commandLine, "claude --api-key [REDACTED] --project C:/work", "secret-like CLI aExampleProject should be redacted");
assert.deepEqual(redactedProcess.redactedFields, ["commandLine"], "redacted process samples should report redacted fields");
assert.equal(redactedProcess.platformSupport.supportLevel, "process_only_planned_session_adapter", "non-Codex platforms should remain process-only planned session adapters");
assert.deepEqual(
  getRuntimePlatformSupport("gemini_cli"),
  {
    platform: "gemini_cli",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "planned_session_adapter",
    supportLevel: "process_only_planned_session_adapter",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "Gemini CLI session history is not read in this MVP.",
  },
  "platform support should make non-Codex limitations explicit",
);

const session = normalizeRuntimeSession({
  id: "thread-a",
  platform: "codex",
  status: "unknown-new-status",
  sessionBytes: -1,
  lastWriteTime: "bad-date",
  vaultManifestPath: "C:/Zhixia/vault/thread-a/manifest.json",
  compactReceiptPath: "C:/Zhixia/vault/thread-a/receipt.json",
  memoryPointers: ["ZhixiaHistoryId: codex-history:thread-a"],
});
assert.equal(session.status, "unknown", "unsupported runtime statuses should be normalized");
assert.equal(session.platformSupport.supportLevel, "session_metadata_mvp", "Codex sessions should keep session metadata MVP support");
assert.equal(session.sessionBytes, 0, "negative session bytes should be clamped to zero");
assert.equal(session.lastWriteTime, null, "invalid timestamps should become null");
assert.equal(session.hasThreadHistoryVault, true, "vault path evidence should normalize to hasThreadHistoryVault");
assert.equal(session.hasCompactReceipt, true, "receipt path evidence should normalize to hasCompactReceipt");
assert.equal(session.hasZhixiaHistoryPointer, true, "memory pointer evidence should normalize to hasZhixiaHistoryPointer");
assert.equal(session.vaultManifestPath, "C:/Zhixia/vault/thread-a/manifest.json", "vault manifest evidence should be retained");
assert.deepEqual(session.memoryPointers, ["ZhixiaHistoryId: codex-history:thread-a"], "memory pointer evidence should be retained");

const unknownSession = normalizeRuntimeSession({ id: "unknown-agent", platform: "mystery_cli" });
assert.equal(unknownSession.platform, "unknown", "unsupported runtime platforms should normalize to unknown");
assert.equal(unknownSession.platformSupport.supportLevel, "process_metadata_only", "unknown sessions should stay metadata-only");

const highCpuNoSessionMatch = buildRuntimeMonitorSnapshot({
  sampledAt,
  processes: [
    { platform: "codex", processId: 1, processName: "Codex.exe", cpuPercent: 68, memoryBytes: 900000000 },
  ],
  sessions: [
    {
      id: "idle-small",
      platform: "codex",
      status: "idle",
      sessionBytes: 512 * 1024,
      lastWriteTime: "2026-06-10T18:20:00.000Z",
    },
  ],
});
assert.ok(
  highCpuNoSessionMatch.warnings.includes("high_cpu_without_matching_active_session"),
  "high process CPU without an active/recent session should be reported as low-confidence process-level evidence",
);
assert.deepEqual(
  highCpuNoSessionMatch.recommendations[0],
  {
    scope: "process",
    attributionConfidence: "low",
    recommendedAction: "inspect_process_metadata",
    reason: "High agent process CPU was observed, but no active or recently written session metadata was provided.",
    processId: 1,
  },
  "process-only diagnosis should avoid pretending a specific thread is proven",
);

const hugeStaleUnvaulted = enrichRuntimeSession(
  {
    id: "thread-huge",
    platform: "codex",
    status: "idle",
    sessionBytes: 22 * 1024 * 1024,
    lastWriteTime: "2026-05-01T10:00:00.000Z",
    hasThreadHistoryVault: false,
    hasZhixiaHistoryPointer: false,
    hasCompactReceipt: false,
  },
  { sampledAt, largeSessionBytes },
);
assert.equal(
  hugeStaleUnvaulted.recommendedAction,
  "review_history_metadata",
  "huge stale sessions without vault/pointer evidence should only recommend metadata review, not side effects",
);
assert.ok(
  hugeStaleUnvaulted.evidence.includes("missing_thread_history_vault"),
  "huge stale session evidence should name missing Thread History Vault",
);
assert.notEqual(
  hugeStaleUnvaulted.recommendedAction,
  "review_error_state",
  "stale large sessions should not be treated as error threads by default",
);

const activeRecent = enrichRuntimeSession(
  {
    id: "thread-active",
    platform: "codex",
    status: "active",
    sessionBytes: 9 * 1024 * 1024,
    lastWriteTime: "2026-06-12T18:18:00.000Z",
  },
  { sampledAt, hasHighCpu: true, largeSessionBytes },
);
assert.equal(activeRecent.recommendedAction, "wait_and_resample", "active recent sessions should recommend re-sampling before any intervention");
assert.equal(activeRecent.attributionConfidence, "medium", "without a direct process reference, active recent writes stay heuristic");
assert.equal(activeRecent.observed.historySizeBytes, 9 * 1024 * 1024, "observed facts should expose history size bytes");
assert.equal(activeRecent.inferredAttribution.basis, "heuristic_process_pressure_plus_session_metadata", "heuristic attribution should be explicit");
assert.equal(activeRecent.uncertainty.directProcessThreadMapping, false, "heuristic attribution should state that direct mapping is unavailable");
assert.ok(
  activeRecent.uncertainty.limitations.includes("codex_process_samples_do_not_reliably_expose_thread_ids"),
  "Codex-specific thread attribution limits should be explicit",
);

const directlyAttributed = enrichRuntimeSession(
  {
    id: "thread-direct",
    threadId: "thread-direct",
    platform: "codex",
    status: "running",
    sessionBytes: 5 * 1024 * 1024,
    lastWriteTime: "2026-06-12T18:19:30.000Z",
    observedProcessIds: [2],
  },
  {
    sampledAt,
    largeSessionBytes,
    processFacts: {
      hasHighCpu: true,
      processes: [
        { processId: 2, processName: "Codex Worker", platform: "codex", cpuPercent: 88, rawCpuPercent: 88, memoryBytes: 2048, sampledAt },
      ],
      highestCpuProcess: { processId: 2, processName: "Codex Worker", platform: "codex", cpuPercent: 88, rawCpuPercent: 88, memoryBytes: 2048, sampledAt },
    },
    hasHighCpu: true,
  },
);
assert.equal(directlyAttributed.attributionConfidence, "high", "direct process references may raise attribution confidence");
assert.equal(directlyAttributed.uncertainty.directProcessThreadMapping, true, "direct process references should be surfaced");
assert.equal(directlyAttributed.inferredAttribution.suspectedProcessId, 2, "direct attribution should retain the linked process");

const systemError = enrichRuntimeSession(
  {
    id: "thread-error",
    platform: "codex",
    status: "systemError",
    sessionBytes: 18 * 1024 * 1024,
    lastWriteTime: "2026-06-12T18:19:00.000Z",
  },
  { sampledAt, hasHighCpu: true, largeSessionBytes },
);
assert.equal(systemError.recommendedAction, "review_error_state", "systemError high-pressure sessions should only recommend reviewing the error state");
assert.equal(systemError.attributionConfidence, "medium", "systemError attribution should remain medium, not certain");
assert.ok(systemError.evidence.includes("status=systemError"), "systemError evidence should be explicit");

const optimized = enrichRuntimeSession(
  {
    id: "thread-optimized",
    platform: "codex",
    status: "idle",
    sessionBytes: 20 * 1024 * 1024,
    lastWriteTime: "2026-05-01T10:00:00.000Z",
    hasThreadHistoryVault: true,
    hasZhixiaHistoryPointer: true,
    hasCompactReceipt: true,
  },
  { sampledAt, largeSessionBytes },
);
const unoptimizedScore = scoreRuntimeSessionPressure(hugeStaleUnvaulted, { sampledAt, largeSessionBytes }).pressureScore;
assert.ok(
  optimized.pressureScore < unoptimizedScore,
  "vault + receipt + pointer evidence should lower stale-session pressure",
);
assert.equal(
  recommendRuntimeAction(optimized, { sampledAt, largeSessionBytes }),
  "none",
  "optimized stale sessions should not keep recommending history review",
);

const rankedSnapshot = buildRuntimeMonitorSnapshot({
  sampledAt,
  processes: [
    { platform: "codex", processId: 2, processName: "Codex Helper", cpuPercent: 50, rawCpuPercent: 50, memoryBytes: 1000 },
    { platform: "codex", processId: 3, processName: "Codex Main", cpuPercent: 10, rawCpuPercent: 10, memoryBytes: 9999999 },
  ],
  sessions: [hugeStaleUnvaulted, systemError, activeRecent],
});
assert.equal(rankedSnapshot.summary.totalSessions, 3, "snapshot should report session counts");
assert.equal(rankedSnapshot.summary.highCpuProcessCount, 1, "snapshot should report high CPU processes");
assert.equal(rankedSnapshot.summary.systemErrorSessionCount, 1, "snapshot should count systemError sessions");
assert.equal(rankedSnapshot.sessions[0].id, "thread-error", "snapshot should rank highest pressure sessions first");
assert.ok(
  rankedSnapshot.recommendations.some((item) => item.recommendedAction === "review_error_state"),
  "snapshot recommendations should include read-only session-level actions",
);
assert.equal(rankedSnapshot.summary.topCpuProcess.processId, 2, "summary should expose the highest CPU process");
assert.ok(
  rankedSnapshot.summary.platformSupport.some((item) => item.platform === "codex" && item.supportLevel === "session_metadata_mvp"),
  "summary should expose platform support levels for observed platforms",
);
assert.equal(rankedSnapshot.summary.redactedProcessCount, 0, "summary should count redacted process metadata");
assert.equal(rankedSnapshot.sensitiveFieldPolicy.rawSessionBody, "metadata_only_no_raw_body", "snapshot should carry sensitive/raw session policy");
assert.equal(rankedSnapshot.summary.topMemoryProcess.processId, 3, "summary should expose the highest memory process");
assert.equal(rankedSnapshot.summary.topHistorySizeSession.threadId, "thread-huge", "summary should expose the largest history session");
assert.equal(rankedSnapshot.summary.mostRecentSession.threadId, "thread-error", "summary should expose the most recently active session");
assert.equal(rankedSnapshot.observedFacts.sessions.largestHistorySessions[0].threadId, "thread-huge", "observed facts should rank largest history sessions");
assert.equal(rankedSnapshot.observedFacts.processes.topMemoryProcesses[0].processId, 3, "observed facts should rank memory-heavy processes");
assert.ok(
  rankedSnapshot.inferredAttribution.every((item) => item.uncertainty && item.uncertainty.metadataOnly === true),
  "snapshot inferred attribution should carry explicit uncertainty metadata",
);

const rawCpuRankedSnapshot = buildRuntimeMonitorSnapshot({
  sampledAt,
  processes: [
    { platform: "codex", processId: 41, processName: "High Raw CPU", cpuPercent: 240, memoryBytes: 1024 },
    { platform: "codex", processId: 42, processName: "Lower Raw More Memory", cpuPercent: 130, memoryBytes: 1024 * 1024 * 512 },
  ],
  sessions: [],
});
assert.equal(rawCpuRankedSnapshot.processes[0].processId, 41, "visible process ordering should follow raw CPU ranking when multi-core samples exceed 100%");
assert.equal(rawCpuRankedSnapshot.processes[1].processId, 42, "lower raw CPU samples should remain below higher raw CPU samples even if clamped CPU matches");
assert.equal(rawCpuRankedSnapshot.summary.topCpuProcess.processId, 41, "summary and visible process list should agree on highest raw CPU process");

const redactionSnapshot = buildRuntimeMonitorSnapshot({
  sampledAt,
  processes: [
    { platform: "claude_code", processId: 51, processName: "claude.exe", commandLine: "claude --token super-secret-token", cpuPercent: 1 },
  ],
  sessions: [],
});
assert.equal(redactionSnapshot.processes[0].commandLine, "claude --token [REDACTED]", "snapshot process metadata should expose redacted command lines");
assert.equal(redactionSnapshot.summary.redactedProcessCount, 1, "snapshot should count redacted process samples");
assert.equal(redactionSnapshot.summary.platformSupport[0].supportLevel, "process_only_planned_session_adapter", "non-Codex support should be explicit in summary");

console.log("Agent runtime monitor policy behavior tests passed.");
