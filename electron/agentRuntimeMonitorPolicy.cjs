const DEFAULT_LARGE_SESSION_BYTES = 8 * 1024 * 1024;
const DEFAULT_RECENT_WRITE_MINUTES = 10;
const DEFAULT_HIGH_CPU_PERCENT = 45;
const DEFAULT_HIGH_MEMORY_BYTES = 1024 * 1024 * 1024;

const ALLOWED_PLATFORMS = new Set([
  "codex",
  "claude_code",
  "openclaw",
  "cursor",
  "windsurf",
  "gemini_cli",
  "unknown",
]);

const ALLOWED_STATUSES = new Set([
  "active",
  "idle",
  "running",
  "systemError",
  "notLoaded",
  "unknown",
]);

const ALLOWED_ACTIONS = new Set([
  "wait_and_resample",
  "inspect_process_metadata",
  "inspect_thread_metadata",
  "review_error_state",
  "review_history_metadata",
  "none",
]);

const RUNTIME_PLATFORM_SUPPORT = {
  codex: {
    platform: "codex",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "session_metadata_mvp",
    supportLevel: "session_metadata_mvp",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "Codex process samples do not reliably expose exact thread ownership.",
  },
  claude_code: {
    platform: "claude_code",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "planned_session_adapter",
    supportLevel: "process_only_planned_session_adapter",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "Claude Code session bodies and exact thread mapping are not read in this MVP.",
  },
  openclaw: {
    platform: "openclaw",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "openclaw_session_task_metadata_v1",
    supportLevel: "session_task_metadata_read_only",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "OpenClaw session/task metadata is read on demand; raw session and task bodies remain cold and unread by default.",
  },
  cursor: {
    platform: "cursor",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "planned_session_adapter",
    supportLevel: "process_only_planned_session_adapter",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "Cursor workspace/session internals are not read in this MVP.",
  },
  windsurf: {
    platform: "windsurf",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "planned_session_adapter",
    supportLevel: "process_only_planned_session_adapter",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "Windsurf workspace/session internals are not read in this MVP.",
  },
  gemini_cli: {
    platform: "gemini_cli",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "planned_session_adapter",
    supportLevel: "process_only_planned_session_adapter",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "Gemini CLI session history is not read in this MVP.",
  },
  unknown: {
    platform: "unknown",
    processAdapter: "windows_cim_process_sample",
    sessionAdapter: "none",
    supportLevel: "process_metadata_only",
    rawSessionPolicy: "metadata_only_no_raw_body",
    limitation: "Unknown agent processes are process metadata only.",
  },
};

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function compactText(value, maxChars = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactStringArray(value, limit = 8, maxChars = 240) {
  return safeArray(value).slice(0, limit).map((item) => compactText(item, maxChars)).filter(Boolean);
}

function compactNumberArray(value, limit = 8) {
  return safeArray(value)
    .slice(0, limit)
    .map((item) => Math.floor(clampNumber(item, 0, Number.MAX_SAFE_INTEGER, -1)))
    .filter((item) => item >= 0);
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function minutesBetween(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / 60000);
}

function normalizePlatform(value) {
  const platform = compactText(value || "unknown", 40);
  return ALLOWED_PLATFORMS.has(platform) ? platform : "unknown";
}

function getRuntimePlatformSupport(value) {
  const platform = normalizePlatform(value);
  return { ...RUNTIME_PLATFORM_SUPPORT[platform] };
}

function redactSensitiveRuntimeText(value, maxChars = 1000) {
  const text = compactText(value, maxChars);
  if (!text) return "";
  return text
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|passwd|pwd|access[_-]?token|refresh[_-]?token)\s*[=:]\s*)([^\s;&|]+)/gi, "$1[REDACTED]")
    .replace(/(--(?:api[_-]?key|token|secret|password|access[_-]?token|refresh[_-]?token)(?:=|\s+))([^\s;&|]+)/gi, "$1[REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED]");
}

function normalizeStatus(value) {
  const status = compactText(value || "unknown", 40);
  return ALLOWED_STATUSES.has(status) ? status : "unknown";
}

function normalizeRecommendedAction(value) {
  const action = compactText(value || "none", 40);
  return ALLOWED_ACTIONS.has(action) ? action : "none";
}

function normalizeRuntimeProcessSample(sample = {}, options = {}) {
  const sampledAt = toIso(sample.sampledAt || options.sampledAt) || new Date().toISOString();
  const processId = Math.floor(clampNumber(sample.processId || sample.pid, 0, Number.MAX_SAFE_INTEGER, 0));
  const processName = compactText(sample.processName || sample.name || sample.command || "unknown", 120) || "unknown";
  const rawCpuPercent = clampNumber(sample.rawCpuPercent ?? sample.cpuPercent, 0, 10000, 0);
  const platform = normalizePlatform(sample.platform);
  const rawExecutablePath = compactText(sample.executablePath, 500);
  const rawCommandLine = compactText(sample.commandLine, 1000);
  const executablePath = redactSensitiveRuntimeText(rawExecutablePath, 500);
  const commandLine = redactSensitiveRuntimeText(rawCommandLine, 1000);
  const redactedFields = [];
  if (rawExecutablePath && executablePath !== rawExecutablePath) redactedFields.push("executablePath");
  if (rawCommandLine && commandLine !== rawCommandLine) redactedFields.push("commandLine");

  return {
    id: compactText(sample.id, 160) || `${platform}:${processId || processName}`,
    platform,
    platformSupport: getRuntimePlatformSupport(platform),
    processId,
    processName,
    executablePath: executablePath || null,
    commandLine: commandLine || null,
    redactedFields,
    sensitiveFieldPolicy: "compact_and_redact_secret_like_command_line_tokens",
    parentProcessId: sample.parentProcessId == null
      ? null
      : Math.floor(clampNumber(sample.parentProcessId, 0, Number.MAX_SAFE_INTEGER, 0)),
    rawCpuPercent,
    cpuPercent: clampNumber(sample.cpuPercent, 0, 100, 0),
    memoryBytes: Math.floor(clampNumber(sample.memoryBytes, 0, Number.MAX_SAFE_INTEGER, 0)),
    sampledAt,
  };
}

function normalizeRuntimeSession(session = {}, options = {}) {
  const id = compactText(session.id || session.threadId || session.sessionId, 180) || "unknown-session";
  const lastWriteTime = toIso(session.lastWriteTime || session.updatedAt || session.lastActivityAt);
  const vaultManifestPath = compactText(session.vaultManifestPath || session.vault_manifest_path, 500) || null;
  const vaultSessionPath = compactText(session.vaultSessionPath || session.vault_session_path, 500) || null;
  const vaultSha256 = compactText(session.vaultSha256 || session.vault_sha256, 160) || null;
  const compactReceiptPath = compactText(session.compactReceiptPath || session.compact_receipt_path || session.receiptPath, 500) || null;
  const memoryPointers = compactStringArray(session.memoryPointers || session.memory_pointers, 8, 220);
  const observedProcessIds = Array.from(new Set([
    ...compactNumberArray(session.observedProcessIds || session.processIds, 8),
    ...compactNumberArray([session.processId, session.pid], 2),
  ]));
  const platform = normalizePlatform(session.platform);

  return {
    id,
    platform,
    platformSupport: getRuntimePlatformSupport(platform),
    threadId: compactText(session.threadId || session.id, 180) || null,
    title: compactText(session.title, 240) || null,
    projectPath: compactText(session.projectPath || session.cwd || session.workspacePath, 500) || null,
    status: normalizeStatus(session.status),
    sessionPath: compactText(session.sessionPath, 500) || null,
    sessionBytes: Math.floor(clampNumber(session.sessionBytes || session.sizeBytes, 0, Number.MAX_SAFE_INTEGER, 0)),
    lastWriteTime,
    hasZhixiaHistoryPointer: session.hasZhixiaHistoryPointer === true || session.hasMemoryPointer === true || memoryPointers.length > 0,
    hasThreadHistoryVault: session.hasThreadHistoryVault === true || session.hasVault === true || Boolean(vaultManifestPath || vaultSessionPath || vaultSha256),
    hasCompactReceipt: session.hasCompactReceipt === true || session.compactCompatible === true || Boolean(compactReceiptPath),
    vaultManifestPath,
    vaultSessionPath,
    vaultSha256,
    compactReceiptPath,
    memoryPointers,
    observedProcessIds,
    optimizedAt: toIso(session.optimizedAt || session.compactedAt),
    pressureScore: Math.floor(clampNumber(session.pressureScore, 0, 100, 0)),
    attributionConfidence: ["low", "medium", "high"].includes(session.attributionConfidence)
      ? session.attributionConfidence
      : "low",
    recommendedAction: normalizeRecommendedAction(session.recommendedAction),
    evidence: safeArray(session.evidence).slice(0, 10).map((item) => compactText(item, 180)).filter(Boolean),
  };
}

function buildRuntimeProcessFacts(processes = [], options = {}) {
  const highCpuPercent = clampNumber(options.highCpuPercent, 1, 100, DEFAULT_HIGH_CPU_PERCENT);
  const highMemoryBytes = Math.floor(clampNumber(options.highMemoryBytes, 1, Number.MAX_SAFE_INTEGER, DEFAULT_HIGH_MEMORY_BYTES));
  const normalizedProcesses = safeArray(processes).map((sample) => normalizeRuntimeProcessSample(sample, options));
  const totalCpuPercent = Math.round(normalizedProcesses.reduce((sum, process) => sum + process.cpuPercent, 0) * 10) / 10;
  const totalMemoryBytes = normalizedProcesses.reduce((sum, process) => sum + process.memoryBytes, 0);
  const highCpuProcesses = normalizedProcesses.filter((process) => process.cpuPercent >= highCpuPercent);
  const highMemoryProcesses = normalizedProcesses.filter((process) => process.memoryBytes >= highMemoryBytes);
  const byCpu = normalizedProcesses
    .slice()
    .sort((a, b) => b.rawCpuPercent - a.rawCpuPercent || b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes);
  const byMemory = normalizedProcesses.slice().sort((a, b) => b.memoryBytes - a.memoryBytes || b.rawCpuPercent - a.rawCpuPercent);

  return {
    processes: normalizedProcesses,
    totalCpuPercent,
    totalMemoryBytes,
    highestCpuProcess: byCpu[0] || null,
    highestMemoryProcess: byMemory[0] || null,
    rankedByCpu: byCpu,
    rankedByMemory: byMemory,
    highCpuProcesses,
    highMemoryProcesses,
    hasHighCpu: highCpuProcesses.length > 0,
    hasHighMemory: highMemoryProcesses.length > 0,
    highCpuPercent,
    highMemoryBytes,
  };
}

function scoreRuntimeSessionPressure(session = {}, context = {}) {
  const normalized = normalizeRuntimeSession(session, context);
  const now = toDate(context.now || context.sampledAt) || new Date();
  const lastWrite = toDate(normalized.lastWriteTime);
  const recentWriteMinutes = clampNumber(context.recentWriteMinutes, 1, 240, DEFAULT_RECENT_WRITE_MINUTES);
  const largeSessionBytes = Math.floor(clampNumber(context.largeSessionBytes, 1, Number.MAX_SAFE_INTEGER, DEFAULT_LARGE_SESSION_BYTES));
  const hasHighCpu = context.hasHighCpu === true || context.processFacts?.hasHighCpu === true;
  const hasCompleteOptimizationEvidence =
    normalized.hasThreadHistoryVault &&
    normalized.hasCompactReceipt &&
    normalized.hasZhixiaHistoryPointer;
  const isRecentWrite = Boolean(lastWrite && minutesBetween(now, lastWrite) <= recentWriteMinutes);
  const evidence = [];
  let score = 0;

  if (["active", "running"].includes(normalized.status)) {
    score += 24;
    evidence.push(`status=${normalized.status}`);
  }
  if (normalized.status === "systemError") {
    score += 34;
    evidence.push("status=systemError");
  }
  if (normalized.status === "notLoaded") {
    score += 18;
    evidence.push("status=notLoaded");
  }
  if (normalized.sessionBytes >= largeSessionBytes) {
    score += Math.min(28, 12 + Math.floor(normalized.sessionBytes / largeSessionBytes) * 4);
    evidence.push("large_session");
  }
  if (isRecentWrite) {
    score += 18;
    evidence.push("recent_write");
  }
  if (hasHighCpu) {
    score += 14;
    evidence.push("agent_process_high_cpu");
  }
  if (normalized.sessionBytes >= largeSessionBytes && !normalized.hasThreadHistoryVault) {
    score += 12;
    evidence.push("missing_thread_history_vault");
  }
  if (normalized.sessionBytes >= largeSessionBytes && !normalized.hasZhixiaHistoryPointer) {
    score += 8;
    evidence.push("missing_zhixia_history_pointer");
  }
  if (hasCompleteOptimizationEvidence) {
    score -= 24;
    evidence.push("vault_receipt_pointer_present");
  }
  if (normalized.status === "idle" && !isRecentWrite) {
    score -= 10;
    evidence.push("idle_not_recent");
  }

  return {
    pressureScore: Math.max(0, Math.min(100, Math.round(score))),
    evidence,
    isRecentWrite,
    recentActivityMinutes: lastWrite ? Math.max(0, minutesBetween(now, lastWrite)) : null,
    hasCompleteOptimizationEvidence,
  };
}

function hasDirectRuntimeProcessAttribution(session = {}, context = {}) {
  const observedProcessIds = safeArray(session.observedProcessIds);
  if (!observedProcessIds.length) return false;
  const processes = safeArray(context.processFacts?.processes);
  return observedProcessIds.some((processId) => processes.some((process) => process.processId === processId));
}

function inferRuntimeAttributionConfidence(session = {}, context = {}) {
  const normalized = normalizeRuntimeSession(session, context);
  const pressure = scoreRuntimeSessionPressure(normalized, context);
  const hasHighCpu = context.hasHighCpu === true || context.processFacts?.hasHighCpu === true;
  const hasDirectAttribution = hasDirectRuntimeProcessAttribution(normalized, context);

  if (hasDirectAttribution && hasHighCpu && ["active", "running"].includes(normalized.status) && pressure.isRecentWrite) return "high";
  if (hasHighCpu && ["active", "running"].includes(normalized.status) && pressure.isRecentWrite) return "medium";
  if (hasHighCpu && normalized.status === "systemError" && pressure.isRecentWrite) return "medium";
  if (hasHighCpu && pressure.pressureScore >= 70) return "low";
  return "low";
}

function recommendRuntimeAction(session = {}, context = {}) {
  const normalized = normalizeRuntimeSession(session, context);
  const pressure = scoreRuntimeSessionPressure(normalized, context);
  const hasHighCpu = context.hasHighCpu === true || context.processFacts?.hasHighCpu === true;

  if (["active", "running"].includes(normalized.status) && pressure.isRecentWrite) return "wait_and_resample";
  if (normalized.status === "systemError" && pressure.pressureScore >= 55) return "review_error_state";
  if (normalized.status === "notLoaded" && pressure.pressureScore >= 65) return "inspect_thread_metadata";
  if (
    normalized.sessionBytes >= (context.largeSessionBytes || DEFAULT_LARGE_SESSION_BYTES) &&
    !pressure.hasCompleteOptimizationEvidence &&
    !["active", "running"].includes(normalized.status)
  ) {
    return "review_history_metadata";
  }
  if (hasHighCpu && pressure.pressureScore < 45) return "inspect_process_metadata";
  return "none";
}

function buildObservedRuntimeSessionFacts(session = {}, pressure = {}) {
  return {
    threadId: session.threadId,
    sessionId: session.id,
    platform: session.platform,
    status: session.status,
    historySizeBytes: session.sessionBytes,
    lastWriteTime: session.lastWriteTime,
    recentActivityMinutes: pressure.recentActivityMinutes,
    hasThreadHistoryVault: session.hasThreadHistoryVault,
    hasCompactReceipt: session.hasCompactReceipt,
    hasZhixiaHistoryPointer: session.hasZhixiaHistoryPointer,
    vaultManifestPath: session.vaultManifestPath,
    vaultSessionPath: session.vaultSessionPath,
    vaultSha256: session.vaultSha256,
    compactReceiptPath: session.compactReceiptPath,
    memoryPointers: session.memoryPointers.slice(0, 8),
    observedProcessIds: session.observedProcessIds.slice(0, 8),
    evidence: session.evidence.slice(0, 10),
  };
}

function buildRuntimeUncertainty(session = {}, context = {}, pressure = {}, confidence = "low") {
  const limitations = [];
  const reasons = [];
  const directProcessThreadMapping = hasDirectRuntimeProcessAttribution(session, context);

  if (!directProcessThreadMapping) {
    reasons.push("process_to_thread_mapping_is_inferred_from_metadata");
  }
  if (!(context.hasHighCpu === true || context.processFacts?.hasHighCpu === true)) {
    reasons.push("no_high_cpu_process_sample_was_observed");
  }
  if (!pressure.isRecentWrite) {
    reasons.push("session_has_no_recent_write_signal");
  }
  if (session.platform === "codex") {
    limitations.push("codex_process_samples_do_not_reliably_expose_thread_ids");
  } else if (session.platformSupport?.supportLevel === "process_only_planned_session_adapter") {
    limitations.push(`${session.platform}_session_adapter_is_planned_process_only`);
  } else {
    limitations.push(`platform_${session.platform}_thread_mapping_is_metadata_only`);
  }
  if (session.observedProcessIds.length === 0) {
    limitations.push("session_metadata_contains_no_direct_process_reference");
  }

  return {
    metadataOnly: true,
    directProcessThreadMapping,
    confidence,
    reasons,
    limitations,
  };
}

function buildRuntimeAttributionInference(session = {}, context = {}, pressure = {}, confidence = "low") {
  const highestCpuProcess = context.processFacts?.highestCpuProcess || null;
  const strongestObservedProcessId = session.observedProcessIds[0] || null;
  const linkedProcess = strongestObservedProcessId
    ? safeArray(context.processFacts?.processes).find((process) => process.processId === strongestObservedProcessId) || null
    : highestCpuProcess;

  return {
    threadId: session.threadId,
    sessionId: session.id,
    confidence,
    basis: hasDirectRuntimeProcessAttribution(session, context)
      ? "direct_process_reference_plus_runtime_signals"
      : "heuristic_process_pressure_plus_session_metadata",
    suspectedProcessId: linkedProcess?.processId || null,
    suspectedProcessName: linkedProcess?.processName || null,
    reasons: pressure.evidence.slice(0, 8),
  };
}

function summarizeProcessCandidate(process = null) {
  if (!process) return null;
  return {
    processId: process.processId,
    processName: process.processName,
    platform: process.platform,
    supportLevel: process.platformSupport?.supportLevel || getRuntimePlatformSupport(process.platform).supportLevel,
    cpuPercent: process.cpuPercent,
    rawCpuPercent: process.rawCpuPercent,
    memoryBytes: process.memoryBytes,
    sampledAt: process.sampledAt,
  };
}

function summarizeSessionCandidate(session = null) {
  if (!session) return null;
  return {
    threadId: session.threadId,
    sessionId: session.id,
    title: session.title,
    platform: session.platform,
    supportLevel: session.platformSupport?.supportLevel || getRuntimePlatformSupport(session.platform).supportLevel,
    status: session.status,
    historySizeBytes: session.sessionBytes,
    lastWriteTime: session.lastWriteTime,
    recentActivityMinutes: session.observed?.recentActivityMinutes ?? null,
    attributionConfidence: session.attributionConfidence,
  };
}

function sortSessionsByRecentActivity(sessions = []) {
  return sessions.slice().sort((a, b) => {
    const left = toDate(a.lastWriteTime);
    const right = toDate(b.lastWriteTime);
    return (right?.getTime() || 0) - (left?.getTime() || 0);
  });
}

function enrichRuntimeSession(session = {}, context = {}) {
  const normalized = normalizeRuntimeSession(session, context);
  const pressure = scoreRuntimeSessionPressure(normalized, context);
  const attributionConfidence = inferRuntimeAttributionConfidence(normalized, context);
  const recommendedAction = recommendRuntimeAction(normalized, context);
  const observed = buildObservedRuntimeSessionFacts(normalized, pressure);
  const inferredAttribution = buildRuntimeAttributionInference(normalized, context, pressure, attributionConfidence);
  const uncertainty = buildRuntimeUncertainty(normalized, context, pressure, attributionConfidence);

  return {
    ...normalized,
    historySizeBytes: normalized.sessionBytes,
    pressureScore: pressure.pressureScore,
    attributionConfidence,
    recommendedAction,
    observed,
    inferredAttribution,
    uncertainty,
    evidence: Array.from(new Set([...normalized.evidence, ...pressure.evidence])),
  };
}

function buildRuntimeMonitorSnapshot(input = {}, options = {}) {
  const sampledAt = toIso(input.sampledAt || options.sampledAt) || new Date().toISOString();
  const processFacts = buildRuntimeProcessFacts(input.processes, { ...options, sampledAt });
  const sessionContext = {
    ...options,
    sampledAt,
    now: input.now || options.now || sampledAt,
    processFacts,
    hasHighCpu: processFacts.hasHighCpu,
  };
  const sessions = safeArray(input.sessions)
    .map((session) => enrichRuntimeSession(session, sessionContext))
    .sort((a, b) => b.pressureScore - a.pressureScore || b.sessionBytes - a.sessionBytes);
  const sessionsByHistorySize = sessions.slice().sort((a, b) => b.sessionBytes - a.sessionBytes || b.pressureScore - a.pressureScore);
  const sessionsByRecentActivity = sortSessionsByRecentActivity(sessions);
  const activeOrRecentSessions = sessions.filter((session) => ["active", "running"].includes(session.status) || session.evidence.includes("recent_write"));
  const warnings = [];
  const recommendations = [];
  const observedPlatforms = Array.from(new Set([
    ...processFacts.processes.map((process) => process.platform),
    ...sessions.map((session) => session.platform),
  ])).sort();
  const platformSupport = observedPlatforms.map((platform) => getRuntimePlatformSupport(platform));
  const redactedProcessCount = processFacts.processes.filter((process) => process.redactedFields.length > 0).length;

  if (processFacts.hasHighCpu && activeOrRecentSessions.length === 0) {
    warnings.push("high_cpu_without_matching_active_session");
    recommendations.push({
      scope: "process",
      attributionConfidence: "low",
      recommendedAction: "inspect_process_metadata",
      reason: "High agent process CPU was observed, but no active or recently written session metadata was provided.",
      processId: processFacts.highestCpuProcess?.processId || null,
    });
  }

  for (const session of sessions.slice(0, 5)) {
    if (session.recommendedAction !== "none") {
      recommendations.push({
        scope: "session",
        threadId: session.threadId,
        sessionId: session.id,
        attributionConfidence: session.attributionConfidence,
        recommendedAction: session.recommendedAction,
        pressureScore: session.pressureScore,
        uncertainty: session.uncertainty,
        evidence: session.evidence.slice(0, 6),
      });
    }
  }

  return {
    sampledAt,
    processes: processFacts.rankedByCpu.slice(),
    sessions,
    summary: {
      totalProcesses: processFacts.processes.length,
      totalSessions: sessions.length,
      totalCpuPercent: processFacts.totalCpuPercent,
      totalMemoryBytes: processFacts.totalMemoryBytes,
      highCpuProcessCount: processFacts.highCpuProcesses.length,
      highMemoryProcessCount: processFacts.highMemoryProcesses.length,
      systemErrorSessionCount: sessions.filter((session) => session.status === "systemError").length,
      largeUnoptimizedSessionCount: sessions.filter((session) => (
        session.sessionBytes >= (options.largeSessionBytes || DEFAULT_LARGE_SESSION_BYTES) &&
        !(session.hasThreadHistoryVault && session.hasCompactReceipt && session.hasZhixiaHistoryPointer)
      )).length,
      topCpuProcess: summarizeProcessCandidate(processFacts.highestCpuProcess),
      topMemoryProcess: summarizeProcessCandidate(processFacts.highestMemoryProcess),
      topHistorySizeSession: summarizeSessionCandidate(sessionsByHistorySize[0] || null),
      mostRecentSession: summarizeSessionCandidate(sessionsByRecentActivity[0] || null),
      topCandidates: {
        cpuProcesses: processFacts.rankedByCpu.slice(0, 3).map(summarizeProcessCandidate),
        memoryProcesses: processFacts.rankedByMemory.slice(0, 3).map(summarizeProcessCandidate),
        historySizeSessions: sessionsByHistorySize.slice(0, 3).map(summarizeSessionCandidate),
        recentSessions: sessionsByRecentActivity.slice(0, 3).map(summarizeSessionCandidate),
      },
      platformSupport,
      redactedProcessCount,
    },
    observedFacts: {
      processes: {
        highestCpuProcess: summarizeProcessCandidate(processFacts.highestCpuProcess),
        highestMemoryProcess: summarizeProcessCandidate(processFacts.highestMemoryProcess),
        topCpuProcesses: processFacts.rankedByCpu.slice(0, 5).map(summarizeProcessCandidate),
        topMemoryProcesses: processFacts.rankedByMemory.slice(0, 5).map(summarizeProcessCandidate),
      },
      sessions: {
        largestHistorySessions: sessionsByHistorySize.slice(0, 5).map((session) => session.observed),
        mostRecentSessions: sessionsByRecentActivity.slice(0, 5).map((session) => session.observed),
      },
    },
    inferredAttribution: sessions
      .filter((session) => session.inferredAttribution.confidence !== "low" || session.pressureScore >= 55)
      .slice(0, 5)
      .map((session) => ({
        ...session.inferredAttribution,
        uncertainty: session.uncertainty,
      })),
    warnings,
    recommendations,
    sensitiveFieldPolicy: {
      commandLine: "compact_and_redact_secret_like_tokens",
      executablePath: "compact_and_redact_secret_like_tokens",
      rawSessionBody: "metadata_only_no_raw_body",
    },
  };
}

module.exports = {
  DEFAULT_HIGH_CPU_PERCENT,
  DEFAULT_HIGH_MEMORY_BYTES,
  DEFAULT_LARGE_SESSION_BYTES,
  DEFAULT_RECENT_WRITE_MINUTES,
  buildRuntimeMonitorSnapshot,
  buildRuntimeProcessFacts,
  enrichRuntimeSession,
  getRuntimePlatformSupport,
  inferRuntimeAttributionConfidence,
  normalizeRuntimeProcessSample,
  normalizeRuntimeSession,
  redactSensitiveRuntimeText,
  recommendRuntimeAction,
  scoreRuntimeSessionPressure,
};
