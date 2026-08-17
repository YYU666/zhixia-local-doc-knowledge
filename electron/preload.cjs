const { contextBridge, ipcRenderer } = require("electron");

const platformCapabilities = Object.freeze({
  guardian: Object.freeze({
    supported: process.platform === "win32",
    adapter: process.platform === "win32" ? "windows_powershell" : "unavailable",
    reason: process.platform === "win32" ? null : "旧线程整理目前仅支持 Windows PowerShell；此设备不会执行扫描、入库、瘦身或归档操作。",
  }),
});

const invokeGuardian = (operation, options) => ipcRenderer
  .invoke("runtimeBoundary:guardianInvoke", { operation, options })
  .then((response) => response.result);

const docKnowledgeApi = {
  platformCapabilities,
  getPlatformGuardianCapability: () => ipcRenderer.invoke("runtimeBoundary:guardianCapability"),
  listDocuments: (options) => ipcRenderer.invoke("documents:list", options),
  getDocument: (id) => ipcRenderer.invoke("documents:get", id),
  importDocuments: () => ipcRenderer.invoke("documents:import"),
  importFolder: () => ipcRenderer.invoke("documents:importFolder"),
  scanCodexWorkspace: () => ipcRenderer.invoke("codex:scanWorkspace"),
  exportCodexContext: (id) => ipcRenderer.invoke("codex:exportContext", id),
  getCodexGuardianReport: () => invokeGuardian("report"),
  cleanCodexHotLogs: (options) => invokeGuardian("clean_logs", options),
  searchCodexHistory: (options) => invokeGuardian("search_history", options),
  getCodexThreadContext: (options) => invokeGuardian("get_thread_context", options),
  getCodexProjectHistory: (options) => invokeGuardian("get_project_history", options),
  listLongCodexThreads: (options) => invokeGuardian("list_long_threads", options),
  optimizeCodexThread: (options) => invokeGuardian("optimize_thread", options),
  compactCodexThread: (options) => invokeGuardian("compact_thread", options),
  autoIngestCodexHistory: (options) => invokeGuardian("auto_ingest_history", options),
  generateCodexArchiveQueue: (options) => invokeGuardian("generate_archive_queue", options),
  getRuntimeMonitorSnapshot: (options) => ipcRenderer.invoke("runtimeMonitor:getSnapshot", options),
  scanToolSkillInventory: (projectPath) => ipcRenderer.invoke("tools:scanInventory", projectPath),
  getToolSkillInventory: (projectPath) => ipcRenderer.invoke("tools:inventory", projectPath),
  confirmToolSkillInventory: (options) => ipcRenderer.invoke("tools:confirmInventory", options),
  updateToolSkillRecordGovernance: (options) => ipcRenderer.invoke("tools:updateRecordGovernance", options),
  reindexDocument: (id) => ipcRenderer.invoke("documents:reindex", id),
  reindexAll: () => ipcRenderer.invoke("documents:reindex", null),
  checkChanges: () => ipcRenderer.invoke("documents:checkChanges"),
  getWatchStatus: () => ipcRenderer.invoke("documents:watchStatus"),
  onWatchUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("documents:watchUpdate", listener);
    return () => ipcRenderer.removeListener("documents:watchUpdate", listener);
  },
  updateDocument: (id, patch) => ipcRenderer.invoke("documents:update", id, patch),
  updateDocumentContent: (id, contentText) => ipcRenderer.invoke("documents:updateContent", id, contentText),
  deleteDocument: (id) => ipcRenderer.invoke("documents:delete", id),
  exportMetadata: () => ipcRenderer.invoke("documents:export"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  getMemoryOverview: () => ipcRenderer.invoke("memory:overview"),
  listExperienceCards: (projectPath) => ipcRenderer.invoke("memory:experienceCards", projectPath),
  listSkillCandidates: (projectPath) => ipcRenderer.invoke("memory:skillCandidates", projectPath),
  updateExperienceCardStatus: (id, status, options) => ipcRenderer.invoke("memory:updateExperienceCardStatus", id, status, options),
  updateSkillCandidateStatus: (id, status) => ipcRenderer.invoke("memory:updateSkillCandidateStatus", id, status),
  retrieveAgentContext: (options) => options?.readOnly === true
    ? ipcRenderer.invoke("runtimeBoundary:strictReadonlyMemoryQuery", options)
    : ipcRenderer.invoke("agent:retrieveContext", options),
  retrieveMemoryRuntimeContext: (options) => options?.readOnly === true
    ? ipcRenderer.invoke("runtimeBoundary:strictReadonlyMemoryQuery", options)
    : ipcRenderer.invoke("memoryRuntime:retrieveContext", options),
  reviewMemoryRuntimeAuthority: (options) => options?.execute === true
    ? ipcRenderer.invoke("runtimeBoundary:authorityAcceptRefreshReverify", options)
    : ipcRenderer.invoke("runtimeBoundary:authorityReview", options),
  acceptMemoryRuntimeAuthority: (options) => ipcRenderer.invoke("runtimeBoundary:authorityAcceptRefreshReverify", options),
  activateMemoryRuntimeGraph: (options) => ipcRenderer.invoke("memoryRuntime:activateMemory", options),
  retrieveMemoryRuntimePrecedent: (options) => ipcRenderer.invoke("memoryRuntime:retrievePrecedent", options),
  recoverMemoryRuntimeThread: (options) => ipcRenderer.invoke("memoryRuntime:recoverThread", options),
  evaluateCeoThreadPressure: (options) => ipcRenderer.invoke("memoryRuntime:evaluateCeoThreadPressure", options),
  buildCeoTakeoverBootstrap: (options) => ipcRenderer.invoke("memoryRuntime:buildCeoTakeoverBootstrap", options),
  buildCeoLifecycleWriteback: (options) => ipcRenderer.invoke("memoryRuntime:buildCeoLifecycleWriteback", options),
  writebackMemoryRuntimeEvidence: (packet) => ipcRenderer.invoke("memoryRuntime:writebackEvidence", packet),
  observeMemoryRuntimeEvent: (event) => ipcRenderer.invoke("memoryRuntime:observeEvent", event),
  upsertWorkingMemory: (record) => ipcRenderer.invoke("memoryRuntime:upsertWorkingMemory", record),
  listWorkingMemory: (options) => ipcRenderer.invoke("memoryRuntime:listWorkingMemory", options),
  listFlowSkillCandidates: (options) => ipcRenderer.invoke("memoryRuntime:listFlowSkillCandidates", options),
  listMemoryFacts: (options) => ipcRenderer.invoke("memoryRuntime:listFacts", options),
  listMemoryRuntimeTriggerReceipts: (options) => ipcRenderer.invoke("memoryRuntime:listTriggerReceipts", options),
  getSemanticMemoryGraphView: (options) => ipcRenderer.invoke("memoryRuntime:getSemanticGraphView", options),
  evaluateMemoryRuntimeBenchmark: (options) => ipcRenderer.invoke("memoryRuntime:evaluateBenchmark", options),
  getMemoryCoreDiagnostics: (options) => ipcRenderer.invoke("memoryRuntime:getCoreDiagnostics", options),
  listMemoryCoreReviewQueue: (options) => ipcRenderer.invoke("memoryRuntime:listCoreReviewQueue", options),
  getMemoryCoreContinuityStatus: (options) => ipcRenderer.invoke("memoryRuntime:getContinuityStatus", options),
  getProjectContinuity: (options) => ipcRenderer.invoke("memoryRuntime:getProjectContinuity", options),
  loadProjectReleaseEvidence: (options) => ipcRenderer.invoke("runtimeBoundary:releaseEvidence", options),
  closeWorkingMemory: (options) => ipcRenderer.invoke("memoryRuntime:closeWorkingMemory", options),
  promoteMemory: (candidate) => ipcRenderer.invoke("memoryRuntime:promoteMemory", candidate),
  listRetrieveLogs: (options) => ipcRenderer.invoke("agent:listRetrieveLogs", options),
  importAutoflowExperience: () => ipcRenderer.invoke("memory:importAutoflow"),
  getKnowledgeOverview: () => ipcRenderer.invoke("knowledge:overview"),
  listKnowledgeItems: (projectPath, options) => ipcRenderer.invoke("knowledge:items", projectPath, options),
  generateKnowledgeItems: (options) => ipcRenderer.invoke("knowledge:generate", options),
  testAiProvider: () => ipcRenderer.invoke("knowledge:testProvider"),
  listZhixiaSkills: (options) => ipcRenderer.invoke("zhixiaSkills:list", options),
  runZhixiaSkill: (options) => ipcRenderer.invoke("zhixiaSkills:run", options),
  getSkillStatus: () => ipcRenderer.invoke("skill:status"),
  installSkill: () => ipcRenderer.invoke("skill:install"),
  revealSkillsFolder: () => ipcRenderer.invoke("skill:reveal"),
  revealStore: () => ipcRenderer.invoke("store:reveal"),
};

if (process.env.ZHIXIA_E2E_PROBE === "1") {
  docKnowledgeApi.e2eProbe = (options) => ipcRenderer.invoke("app:e2eProbe", options);
}

contextBridge.exposeInMainWorld("docKnowledge", docKnowledgeApi);
