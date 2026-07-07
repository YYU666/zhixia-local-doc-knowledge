const assert = require("node:assert/strict");

const {
  buildRuntimeMonitorSnapshotFromInputs,
  detectPlatform,
  extractThreadIdFromSessionPath,
  normalizeGuardianLargestSessionFile,
  normalizeLongThreadItem,
  normalizeProcessRows,
  sampleAgentProcesses,
} = require("../electron/runtimeMonitorAdapter.cjs");

assert.equal(detectPlatform("Codex.exe", ""), "codex", "Codex process names should map to the Codex platform");
assert.equal(detectPlatform("node.exe", "openclaw.mjs --session-id run-1"), "openclaw", "command lines should map OpenClaw");
assert.equal(detectPlatform("claude.exe", ""), "claude_code", "Claude process names should map to Claude Code");
assert.equal(detectPlatform("unknown.exe", ""), "unknown", "unknown processes should stay unknown");

assert.equal(
  extractThreadIdFromSessionPath("C:/Users/example/.codex/sessions/2026/06/12/019e-test.jsonl"),
  "019e-test",
  "session filenames should provide thread ids without reading JSONL bodies",
);

const processes = normalizeProcessRows(
  [
    {
      ProcessId: 10,
      ParentProcessId: 2,
      ProcessName: "Codex.exe",
      ExecutablePath: "C:/Program Files/Codex/Codex.exe",
      CommandLine: "Codex.exe",
      CpuPercent: 64,
      MemoryBytes: 123456,
    },
  ],
  "2026-06-12T18:30:00.000Z",
);
assert.deepEqual(
  processes[0],
  {
    id: "codex:10",
    platform: "codex",
    processId: 10,
    processName: "Codex.exe",
    executablePath: "C:/Program Files/Codex/Codex.exe",
    commandLine: "Codex.exe",
    parentProcessId: 2,
    rawCpuPercent: 64,
    cpuPercent: 64,
    memoryBytes: 123456,
    sampledAt: "2026-06-12T18:30:00.000Z",
  },
  "PowerShell process rows should normalize into runtime process samples",
);

const guardianSession = normalizeGuardianLargestSessionFile({
  path: "C:/Users/example/.codex/sessions/2026/06/12/019e-large.jsonl",
  size_bytes: 12 * 1024 * 1024,
  last_write_time: "2026-06-12T18:29:00.000Z",
});
assert.equal(guardianSession.threadId, "019e-large", "Guardian largest-session metadata should expose thread id from path");
assert.equal(guardianSession.status, "unknown", "Guardian file metadata alone should not invent a runtime status");
assert.ok(
  guardianSession.evidence.includes("guardian_largest_session_metadata"),
  "Guardian session rows should state they are metadata-only evidence",
);

const snapshot = buildRuntimeMonitorSnapshotFromInputs(
  {
    sampledAt: "2026-06-12T18:30:00.000Z",
    processes,
    guardianReport: {
      largest_session_files: [
        {
          path: "C:/Users/example/.codex/sessions/2026/06/12/019e-large.jsonl",
          size_bytes: 12 * 1024 * 1024,
          last_write_time: "2026-06-12T18:29:00.000Z",
        },
      ],
    },
    longThreadsEnvelope: {
      items: [
        {
          threadId: "019e-large",
          title: "Large vaulted thread",
          status: "idle",
          sessionBytes: 12 * 1024 * 1024,
          sessionLastWriteTime: "2026-06-12T18:29:00.000Z",
          archiveCandidate: {
            evidence: {
              hasVault: true,
              hasMemoryPointer: true,
              sessionBytes: 12 * 1024 * 1024,
              vaultManifestPath: "C:/Zhixia/vault/019e-large/manifest.json",
              vaultSha256: "vault-hash-ok",
              memoryPointers: ["ZhixiaHistoryId: codex-history:019e-large"],
            },
          },
          compactReceipt: {
            receiptPath: "C:/Zhixia/vault/019e-large/compact-receipt.json",
          },
        },
      ],
    },
  },
  { highCpuPercent: 40 },
);
assert.equal(snapshot.provenance.rawSessionPolicy, "metadata_only_no_raw_body", "snapshot must declare the raw-session body is not read");
assert.equal(snapshot.provenance.threadAttributionMode, "observed_process_samples_plus_metadata_inference", "snapshot should declare heuristic attribution mode");
assert.equal(snapshot.provenance.nonCodexSessionAdapterPolicy, "process_only_planned_session_adapter", "non-Codex adapters should stay process-only until fixture-backed session adapters exist");
assert.equal(snapshot.provenance.sensitiveFieldPolicy.commandLine, "compact_and_redact_secret_like_tokens", "adapter provenance should expose command-line redaction policy");
assert.ok(
  snapshot.provenance.supportedPlatforms.some((item) => item.platform === "cursor" && item.supportLevel === "process_only_planned_session_adapter"),
  "adapter provenance should list planned non-Codex platform support",
);
assert.ok(
  snapshot.provenance.platformLimitations[0].includes("do not guarantee exact thread ownership"),
  "snapshot should carry platform limitations for thread attribution",
);
assert.equal(snapshot.summary.totalProcesses, 1, "snapshot should include process samples");
assert.equal(snapshot.summary.totalSessions, 1, "Guardian and long-thread rows should merge by thread id");
assert.equal(snapshot.sessions[0].threadId, "019e-large", "merged session should retain the thread id");
assert.equal(snapshot.sessions[0].hasThreadHistoryVault, true, "long-thread metadata should add vault evidence");
assert.equal(snapshot.sessions[0].hasZhixiaHistoryPointer, true, "long-thread metadata should add memory pointer evidence");
assert.equal(snapshot.sessions[0].hasCompactReceipt, true, "long-thread metadata should add compact receipt evidence");
assert.equal(snapshot.sessions[0].vaultManifestPath, "C:/Zhixia/vault/019e-large/manifest.json", "vault manifest path should survive metadata normalization");
assert.equal(snapshot.sessions[0].vaultSha256, "vault-hash-ok", "vault hash should survive metadata normalization");
assert.equal(snapshot.sessions[0].compactReceiptPath, "C:/Zhixia/vault/019e-large/compact-receipt.json", "compact receipt path should survive metadata normalization");
assert.deepEqual(snapshot.sessions[0].memoryPointers, ["ZhixiaHistoryId: codex-history:019e-large"], "memory pointers should survive metadata normalization");
assert.equal(snapshot.sessions[0].observed.historySizeBytes, 12 * 1024 * 1024, "session observed facts should expose history size");
assert.equal(snapshot.sessions[0].uncertainty.metadataOnly, true, "session uncertainty should state metadata-only attribution");
assert.equal(snapshot.summary.topHistorySizeSession.threadId, "019e-large", "summary should expose the largest history session");

const normalizedLongThread = normalizeLongThreadItem({
  threadId: "019e-optimized",
  optimized: {
    vaultManifestPath: "C:/Zhixia/vault/019e-optimized/manifest.json",
    vaultSessionPath: "C:/Zhixia/vault/019e-optimized/session.jsonl",
    vaultSha256: "optimized-hash",
    memoryPointers: ["hot:019e-optimized"],
  },
});
assert.equal(normalizedLongThread.hasThreadHistoryVault, true, "optimized vault fields should count as vault evidence");
assert.equal(normalizedLongThread.hasZhixiaHistoryPointer, true, "optimized memory pointers should count as pointer evidence");
assert.equal(normalizedLongThread.vaultSessionPath, "C:/Zhixia/vault/019e-optimized/session.jsonl", "optimized vault session path should be retained");

(async () => {
  const processFailure = await sampleAgentProcesses({
    sampledAt: "2026-06-12T18:30:00.000Z",
    executor: (_file, _args, _options, callback) => callback(new Error("mock failure"), ""),
  });
  assert.deepEqual(processFailure.processes, [], "process sampler failures should return an empty safe process list");
  assert.ok(processFailure.warnings[0].startsWith("process_sample_failed:"), "process sampler failures should be warnings, not thrown errors");

  const processSuccess = await sampleAgentProcesses({
    sampledAt: "2026-06-12T18:30:00.000Z",
    executor: (_file, _args, _options, callback) => callback(null, JSON.stringify({ ProcessId: 12, ProcessName: "Codex.exe", CpuPercent: 12, MemoryBytes: 2048 })),
  });
  assert.equal(processSuccess.processes.length, 1, "process sampler should parse single-object PowerShell JSON");
  assert.equal(processSuccess.processes[0].platform, "codex", "process sampler should normalize parsed process rows");

  console.log("Runtime monitor adapter behavior tests passed.");
})();
