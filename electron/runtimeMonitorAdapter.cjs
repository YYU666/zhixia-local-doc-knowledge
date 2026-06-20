const { execFile } = require("node:child_process");
const path = require("node:path");
const { buildRuntimeMonitorSnapshot, getRuntimePlatformSupport } = require("./agentRuntimeMonitorPolicy.cjs");

const DEFAULT_PROCESS_SAMPLE_TIMEOUT_MS = 2500;
const DEFAULT_PROCESS_SAMPLE_MAX_BUFFER = 512 * 1024;
const AGENT_PROCESS_PATTERN = "(codex|claude|openclaw|cursor|windsurf|gemini|node)";

function compactText(value, maxChars = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstCompactText(...values) {
  for (const value of values) {
    const text = compactText(value, 500);
    if (text) return text;
  }
  return null;
}

function compactStringArray(value, limit = 8) {
  return safeArray(value).slice(0, limit).map((item) => compactText(item, 220)).filter(Boolean);
}

function detectPlatform(processName = "", commandLine = "") {
  const text = `${processName} ${commandLine}`.toLowerCase();
  if (text.includes("codex")) return "codex";
  if (text.includes("claude")) return "claude_code";
  if (text.includes("openclaw")) return "openclaw";
  if (text.includes("cursor")) return "cursor";
  if (text.includes("windsurf")) return "windsurf";
  if (text.includes("gemini")) return "gemini_cli";
  return "unknown";
}

function parseJsonArray(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeProcessRows(rows, sampledAt) {
  return safeArray(rows).map((row) => {
    const processName = compactText(row.ProcessName || row.Name || row.processName || "unknown", 160);
    const commandLine = compactText(row.CommandLine || row.commandLine || "", 1000);
    return {
      id: `${detectPlatform(processName, commandLine)}:${row.ProcessId || row.Id || row.processId || processName}`,
      platform: detectPlatform(processName, commandLine),
      processId: Number(row.ProcessId || row.Id || row.processId || 0),
      processName,
      executablePath: compactText(row.ExecutablePath || row.executablePath || "", 500) || null,
      commandLine: commandLine || null,
      parentProcessId: row.ParentProcessId == null ? null : Number(row.ParentProcessId),
      rawCpuPercent: Number(row.RawCpuPercent || row.rawCpuPercent || row.CpuPercent || row.cpuPercent || 0),
      cpuPercent: Number(row.CpuPercent || row.cpuPercent || 0),
      memoryBytes: Number(row.MemoryBytes || row.WorkingSetSize || row.memoryBytes || 0),
      sampledAt,
    };
  });
}

function processSampleScript() {
  return `
$ErrorActionPreference = 'Stop'
$processRows = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match '${AGENT_PROCESS_PATTERN}' -or $_.CommandLine -match '${AGENT_PROCESS_PATTERN}' } |
  Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, WorkingSetSize
$perfByPid = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object {
  if ($_.IDProcess -ne $null) { $perfByPid[[int]$_.IDProcess] = [double]$_.PercentProcessorTime }
}
$processRows | ForEach-Object {
  $pidValue = [int]$_.ProcessId
  [pscustomobject]@{
    ProcessId = $pidValue
    ParentProcessId = $_.ParentProcessId
    ProcessName = $_.Name
    ExecutablePath = $_.ExecutablePath
    CommandLine = $_.CommandLine
    CpuPercent = $(if ($perfByPid.ContainsKey($pidValue)) { $perfByPid[$pidValue] } else { 0 })
    MemoryBytes = $_.WorkingSetSize
  }
} | ConvertTo-Json -Depth 4
`;
}

function sampleAgentProcesses(options = {}) {
  const sampledAt = options.sampledAt || new Date().toISOString();
  const executor = options.executor || execFile;
  const powershell = options.powershellPath || "powershell.exe";

  return new Promise((resolve) => {
    executor(
      powershell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", processSampleScript()],
      {
        timeout: Number(options.timeoutMs || DEFAULT_PROCESS_SAMPLE_TIMEOUT_MS),
        windowsHide: true,
        maxBuffer: Number(options.maxBuffer || DEFAULT_PROCESS_SAMPLE_MAX_BUFFER),
      },
      (error, stdout) => {
        if (error) {
          resolve({
            processes: [],
            warnings: [`process_sample_failed:${compactText(error.message, 180)}`],
            sampledAt,
          });
          return;
        }
        try {
          resolve({
            processes: normalizeProcessRows(parseJsonArray(stdout), sampledAt),
            warnings: [],
            sampledAt,
          });
        } catch (parseError) {
          resolve({
            processes: [],
            warnings: [`process_sample_parse_failed:${compactText(parseError.message, 180)}`],
            sampledAt,
          });
        }
      },
    );
  });
}

function extractThreadIdFromSessionPath(sessionPath) {
  const fileName = path.basename(String(sessionPath || ""));
  const withoutExtension = fileName.replace(/\.jsonl$/i, "");
  return compactText(withoutExtension, 180) || null;
}

function normalizeGuardianLargestSessionFile(file = {}) {
  return {
    id: extractThreadIdFromSessionPath(file.path) || compactText(file.path, 180) || "unknown-session",
    platform: "codex",
    threadId: extractThreadIdFromSessionPath(file.path),
    title: extractThreadIdFromSessionPath(file.path),
    status: "unknown",
    sessionPath: compactText(file.path, 500) || null,
    sessionBytes: Number(file.size_bytes || file.sessionBytes || 0),
    lastWriteTime: file.last_write_time || file.lastWriteTime || null,
    hasZhixiaHistoryPointer: false,
    hasThreadHistoryVault: false,
    hasCompactReceipt: false,
    evidence: ["guardian_largest_session_metadata"],
  };
}

function normalizeLongThreadItem(item = {}) {
  const archiveEvidence = item.archiveCandidate?.evidence || {};
  const optimized = item.optimized || {};
  const vault = item.vault || optimized.vault || {};
  const receipt = item.compactReceipt || item.receipt || {};
  const sessionPath = safeArray(item.sourceRefs).find((ref) => ref?.kind === "raw_session")?.path || null;
  const memoryPointers = Array.from(new Set([
    ...compactStringArray(archiveEvidence.memoryPointers),
    ...compactStringArray(optimized.memoryPointers),
    ...compactStringArray(item.memoryPointers),
  ]));
  const vaultManifestPath = firstCompactText(
    archiveEvidence.vaultManifestPath,
    optimized.vaultManifestPath,
    item.vaultManifestPath,
    vault.manifestPath,
    vault.vaultManifestPath,
    receipt.vaultManifestPath,
    receipt.vault_manifest_path,
  );
  const vaultSessionPath = firstCompactText(
    archiveEvidence.vaultSessionPath,
    optimized.vaultSessionPath,
    item.vaultSessionPath,
    vault.vaultSessionPath,
    receipt.vaultSessionPath,
    receipt.vault_session_path,
  );
  const vaultSha256 = firstCompactText(
    archiveEvidence.vaultSha256,
    optimized.vaultSha256,
    item.vaultSha256,
    vault.vaultSha256,
    vault.originalSha256,
    receipt.vaultSha256,
    receipt.vault_sha256,
  );
  const compactReceiptPath = firstCompactText(item.compactReceiptPath, receipt.receiptPath, receipt.path, receipt.outputPath);
  const hasVault = archiveEvidence.hasVault === true || item.hasThreadHistoryVault === true || Boolean(vaultManifestPath || vaultSessionPath || vaultSha256);
  const hasMemoryPointer = archiveEvidence.hasMemoryPointer === true || item.hasZhixiaHistoryPointer === true || memoryPointers.length > 0;
  const hasCompactReceipt = item.hasCompactReceipt === true || Boolean(item.compactReceipt || item.receipt || compactReceiptPath);
  const evidence = ["guardian_compact_context_metadata"];
  if (vaultManifestPath) evidence.push("vault_manifest_path");
  if (vaultSessionPath) evidence.push("vault_session_path");
  if (vaultSha256) evidence.push("vault_sha256");
  if (memoryPointers.length > 0) evidence.push("memory_pointer_metadata");
  if (hasCompactReceipt) evidence.push("compact_receipt_metadata");
  return {
    id: item.threadId || extractThreadIdFromSessionPath(sessionPath) || item.id,
    platform: "codex",
    threadId: item.threadId || item.id || null,
    title: item.title || item.threadId || item.id || null,
    projectPath: item.projectPath || null,
    status: item.status || "unknown",
    sessionPath,
    sessionBytes: Number(item.sessionBytes || archiveEvidence.sessionBytes || 0),
    lastWriteTime: item.sessionLastWriteTime || archiveEvidence.lastWriteTime || null,
    hasZhixiaHistoryPointer: hasMemoryPointer,
    hasThreadHistoryVault: hasVault,
    hasCompactReceipt,
    vaultManifestPath,
    vaultSessionPath,
    vaultSha256,
    compactReceiptPath,
    memoryPointers,
    evidence,
  };
}

function mergeSessionsByThreadId(...sessionGroups) {
  const map = new Map();
  for (const session of sessionGroups.flatMap((group) => safeArray(group))) {
    const key = session.threadId || session.id || session.sessionPath;
    if (!key) continue;
    const existing = map.get(key) || {};
    map.set(key, {
      ...existing,
      ...session,
      evidence: Array.from(new Set([...safeArray(existing.evidence), ...safeArray(session.evidence)])),
      hasZhixiaHistoryPointer: existing.hasZhixiaHistoryPointer === true || session.hasZhixiaHistoryPointer === true,
      hasThreadHistoryVault: existing.hasThreadHistoryVault === true || session.hasThreadHistoryVault === true,
      hasCompactReceipt: existing.hasCompactReceipt === true || session.hasCompactReceipt === true,
      vaultManifestPath: session.vaultManifestPath || existing.vaultManifestPath || null,
      vaultSessionPath: session.vaultSessionPath || existing.vaultSessionPath || null,
      vaultSha256: session.vaultSha256 || existing.vaultSha256 || null,
      compactReceiptPath: session.compactReceiptPath || existing.compactReceiptPath || null,
      memoryPointers: Array.from(new Set([...safeArray(existing.memoryPointers), ...safeArray(session.memoryPointers)])).slice(0, 8),
    });
  }
  return Array.from(map.values());
}

function buildRuntimeMonitorSnapshotFromInputs(input = {}, options = {}) {
  const sampledAt = input.sampledAt || options.sampledAt || new Date().toISOString();
  const guardianSessions = safeArray(input.guardianReport?.largest_session_files)
    .slice(0, Number(options.sessionLimit || 20))
    .map(normalizeGuardianLargestSessionFile);
  const longThreadSessions = safeArray(input.longThreadsEnvelope?.items)
    .slice(0, Number(options.sessionLimit || 20))
    .map(normalizeLongThreadItem);
  const sessions = mergeSessionsByThreadId(input.sessions, guardianSessions, longThreadSessions);
  const snapshot = buildRuntimeMonitorSnapshot(
    {
      sampledAt,
      processes: input.processes,
      sessions,
    },
    options,
  );
  return {
    ...snapshot,
    warnings: Array.from(new Set([...safeArray(snapshot.warnings), ...safeArray(input.warnings)])),
    provenance: {
      processSampler: input.processSampler || "windows_cim",
      guardianReport: Boolean(input.guardianReport),
      longThreadMetadata: Boolean(input.longThreadsEnvelope),
      rawSessionPolicy: "metadata_only_no_raw_body",
      threadAttributionMode: "observed_process_samples_plus_metadata_inference",
      platformSupport: snapshot.summary.platformSupport,
      nonCodexSessionAdapterPolicy: "process_only_planned_session_adapter",
      supportedPlatforms: ["codex", "claude_code", "openclaw", "cursor", "windsurf", "gemini_cli", "unknown"].map(getRuntimePlatformSupport),
      sensitiveFieldPolicy: snapshot.sensitiveFieldPolicy,
      platformLimitations: [
        "process samples do not guarantee exact thread ownership across platforms",
        "session bodies are not read; attribution relies on metadata, recent writes, and vault/receipt evidence",
        "non-Codex adapters are process-only until a future fixture-backed session adapter is accepted",
      ],
    },
  };
}

async function collectRuntimeMonitorSnapshot(options = {}) {
  const sampledAt = new Date().toISOString();
  const processResult = await sampleAgentProcesses({ ...options, sampledAt });
  let guardianResult = null;
  let longThreadsResult = null;
  const warnings = [...processResult.warnings];

  if (typeof options.guardianReportProvider === "function") {
    try {
      guardianResult = await options.guardianReportProvider();
      if (!guardianResult?.ok) warnings.push(`guardian_report_unavailable:${compactText(guardianResult?.error || "unknown", 180)}`);
    } catch (error) {
      warnings.push(`guardian_report_failed:${compactText(error.message || error, 180)}`);
    }
  }

  if (typeof options.longThreadsProvider === "function") {
    try {
      longThreadsResult = await options.longThreadsProvider();
      if (!longThreadsResult?.ok) warnings.push(`long_thread_metadata_unavailable:${compactText(longThreadsResult?.error || "unknown", 180)}`);
    } catch (error) {
      warnings.push(`long_thread_metadata_failed:${compactText(error.message || error, 180)}`);
    }
  }

  return buildRuntimeMonitorSnapshotFromInputs(
    {
      sampledAt,
      processes: processResult.processes,
      guardianReport: guardianResult?.result || null,
      longThreadsEnvelope: longThreadsResult?.result || null,
      warnings,
    },
    options,
  );
}

module.exports = {
  buildRuntimeMonitorSnapshotFromInputs,
  collectRuntimeMonitorSnapshot,
  detectPlatform,
  extractThreadIdFromSessionPath,
  normalizeGuardianLargestSessionFile,
  normalizeLongThreadItem,
  normalizeProcessRows,
  sampleAgentProcesses,
};
