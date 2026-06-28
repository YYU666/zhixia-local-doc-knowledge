const { contextBridge, ipcRenderer } = require("electron");

const docKnowledgeApi = {
  listDocuments: (options) => ipcRenderer.invoke("documents:list", options),
  getDocument: (id) => ipcRenderer.invoke("documents:get", id),
  importDocuments: () => ipcRenderer.invoke("documents:import"),
  importFolder: () => ipcRenderer.invoke("documents:importFolder"),
  scanCodexWorkspace: () => ipcRenderer.invoke("codex:scanWorkspace"),
  exportCodexContext: (id) => ipcRenderer.invoke("codex:exportContext", id),
  getCodexGuardianReport: () => ipcRenderer.invoke("codexGuardian:report"),
  cleanCodexHotLogs: () => ipcRenderer.invoke("codexGuardian:cleanLogs"),
  searchCodexHistory: (options) => ipcRenderer.invoke("codexGuardian:searchHistory", options),
  getCodexThreadContext: (options) => ipcRenderer.invoke("codexGuardian:getThreadContext", options),
  getCodexProjectHistory: (options) => ipcRenderer.invoke("codexGuardian:getProjectHistory", options),
  listLongCodexThreads: (options) => ipcRenderer.invoke("codexGuardian:listLongThreads", options),
  optimizeCodexThread: (options) => ipcRenderer.invoke("codexGuardian:optimizeThread", options),
  compactCodexThread: (options) => ipcRenderer.invoke("codexGuardian:compactThread", options),
  autoIngestCodexHistory: (options) => ipcRenderer.invoke("codexGuardian:autoIngestHistory", options),
  generateCodexArchiveQueue: (options) => ipcRenderer.invoke("codexGuardian:generateArchiveQueue", options),
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
  retrieveAgentContext: (options) => ipcRenderer.invoke("agent:retrieveContext", options),
  retrieveMemoryRuntimeContext: (options) => ipcRenderer.invoke("memoryRuntime:retrieveContext", options),
  activateMemoryRuntimeGraph: (options) => ipcRenderer.invoke("memoryRuntime:activateMemory", options),
  retrieveMemoryRuntimePrecedent: (options) => ipcRenderer.invoke("memoryRuntime:retrievePrecedent", options),
  recoverMemoryRuntimeThread: (options) => ipcRenderer.invoke("memoryRuntime:recoverThread", options),
  writebackMemoryRuntimeEvidence: (packet) => ipcRenderer.invoke("memoryRuntime:writebackEvidence", packet),
  observeMemoryRuntimeEvent: (event) => ipcRenderer.invoke("memoryRuntime:observeEvent", event),
  upsertWorkingMemory: (record) => ipcRenderer.invoke("memoryRuntime:upsertWorkingMemory", record),
  listWorkingMemory: (options) => ipcRenderer.invoke("memoryRuntime:listWorkingMemory", options),
  listFlowSkillCandidates: (options) => ipcRenderer.invoke("memoryRuntime:listFlowSkillCandidates", options),
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
