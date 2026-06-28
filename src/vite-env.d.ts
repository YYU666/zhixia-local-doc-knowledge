/// <reference types="vite/client" />

export type ParseStatus = "ok" | "partial" | "failed";

export type KnowledgeDocument = {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  extension: string;
  size: number;
  importedAt: string;
  updatedAt: string;
  fileModifiedAt?: string | null;
  contentHash?: string | null;
  contentText: string;
  contentLength?: number;
  summary: string;
  tags: string[];
  favorite: boolean;
  parseStatus: ParseStatus;
  parseError?: string | null;
  duplicateOf?: string | null;
  indexVersion?: number;
  sourceType?: "imported" | "workspace_file" | "codex_context" | "codex_output" | "personal_knowledge";
  workspacePath?: string | null;
  artifactType?:
    | "prd"
    | "technical_design"
    | "test_plan"
    | "release_notes"
    | "report"
    | "readme"
    | "context"
    | "markdown"
    | "document"
    | "other"
    | null;
};

export type AppSettings = {
  autoDetectChanges?: boolean;
  autoWatchChanges?: boolean;
  autoInstallSkill?: boolean;
  maxFileSizeMb?: number;
  autoflowWorkflowPath?: string;
  bugFixMemoryPath?: string;
  aiProviderBaseUrl?: string;
  aiProviderModel?: string;
  aiProviderApiKey?: string;
  projectResumeConfirmations?: Record<string, {
    status: "confirmed";
    confirmedAt: string;
    documentId: string;
    contentHash: string | null;
    updatedAt: string | null;
  }>;
  projectArtifactConfirmations?: Record<string, {
    status: "confirmed";
    confirmedAt: string;
    markdownDocumentId: string | null;
    markdownContentHash: string | null;
    markdownUpdatedAt: string | null;
    jsonDocumentId: string | null;
    jsonContentHash: string | null;
    jsonUpdatedAt: string | null;
  }>;
  toolSkillInventoryConfirmations?: Record<string, {
    status: "confirmed";
    confirmedAt: string;
    snapshotHash: string;
    inventoryId: string | null;
    recordCount: number;
    candidateCount: number;
    markdownPath: string;
    markdownHash: string | null;
    jsonPath: string;
    jsonHash: string | null;
  }>;
  projectRecordOverrides?: Record<string, {
    displayName?: string;
    status: "active" | "paused" | "waiting_review" | "waiting_user" | "completed" | "archived" | "unknown";
    completion: "idea" | "prd" | "design" | "implementation" | "testing" | "packaging" | "released" | "maintenance" | "unknown";
    completionPercent: number;
    lastSummary: string;
    nextAction: string;
    blockers: string[];
    confirmedAt?: string;
    generatedAt?: string;
    generatedBySkillId?: string;
    generatedBySkillVersion?: string;
    projectRecordSourceSignature?: string;
  }>;
};

export type WatchStatus = {
  enabled: boolean;
  rootCount: number;
  roots: string[];
  running: boolean;
  lastRunAt: string | null;
  lastSummary: {
    changed: number;
    missing: number;
    reindexed: number;
    imported: number;
    errors: number;
    scanned?: number;
    projects?: number;
    disabled?: boolean;
  } | null;
};

export type WatchUpdate = {
  phase: "ready" | "pending" | "done" | "failed" | "disabled";
  reason: string;
  message: string;
  documents?: KnowledgeDocument[];
  settings: AppSettings;
  watchStatus: WatchStatus;
  changed?: number;
  missing?: number;
  reindexed?: number;
  imported?: number;
  scanned?: number;
  projects?: string[];
  errors?: Array<{ filePath: string; message: string }>;
};

export type SkillStatus = {
  name: string;
  sourcePath: string;
  codexHome: string;
  skillsPath: string;
  targetPath: string;
  sourceExists: boolean;
  installed: boolean;
  sourceVersion: string | null;
  installedVersion: string | null;
  sourceFingerprint: string | null;
  installedFingerprint: string | null;
  updateAvailable: boolean;
};

export type ToolSkillRecordGovernance = {
  status: "candidate" | "confirmed" | "rejected" | "deprecated" | "blocked";
  reviewState: "unreviewed" | "current" | "stale";
  reviewedAt: string | null;
  reviewer: string | null;
  recordIdentity: string;
  recordContextHash: string;
  previousRecordContextHash: string | null;
  snapshotHash: string | null;
  sourcePath: string | null;
  sourceHash: string | null;
};

export type ToolSkillRecord = {
  id: string;
  name: string;
  kind: "codex_skill" | "plugin" | "mcp_tool" | "workflow_script" | "cli_tool" | "project_scaffold" | "other";
  projectIds?: string[];
  workspacePaths: string[];
  installPath?: string | null;
  sourcePath?: string | null;
  summary: string;
  useCases: string[];
  triggerPatterns: string[];
  inputs: string[];
  outputs: string[];
  riskBoundaries: string[];
  safeCommands: string[];
  forbiddenCommands: string[];
  status: "candidate" | "active" | "deprecated" | "blocked" | "unknown";
  installed: boolean;
  maintainer?: string | null;
  lastVerifiedAt?: string | null;
  sourceHash?: string | null;
  sourceRefs: SourceRef[];
  requiresHumanConfirmation: boolean;
  discoveredBy?: string | null;
  sensitiveScanSkipped?: string[];
  governance?: ToolSkillRecordGovernance;
};

export type ToolSkillInventorySnapshot = {
  id: string;
  contractVersion: string;
  scope: "project" | "global" | string;
  workspacePath: string | null;
  projectId: string | null;
  scannedAt: string;
  indexVersion: number;
  sourceRoots: Array<{ kind: string; path: string; exists: boolean }>;
  recordIds: string[];
  candidateCount: number;
  activeCount: number;
  blockedCount: number;
  warnings: string[];
  status: "ready" | "partial" | string;
  sensitiveScanSkipped: string[];
};

export type ToolSkillInventoryResult = {
  projectPath: string;
  snapshotHash: string;
  confirmationStatus: "missing" | "unconfirmed" | "confirmed" | "re_review_required";
  confirmation: NonNullable<AppSettings["toolSkillInventoryConfirmations"]>[string] | null;
  inventory: ToolSkillInventorySnapshot;
  records: ToolSkillRecord[];
  files: {
    markdown: { path: string; exists: boolean; hash: string | null };
    json: { path: string; exists: boolean; hash: string | null };
  };
  policy: {
    readOnlyCandidate: true;
    requiresHumanConfirmation: true;
    doesNotInstall: true;
    doesNotExecute: true;
    doesNotActivateCandidates: true;
  };
};

export type CodexGuardianSeverity = "green" | "yellow" | "red";

export type CodexGuardianProcess = {
  ProcessName?: string;
  Id?: number;
  StartTime?: string;
};

export type CodexGuardianDirectoryStats = {
  path: string;
  exists: boolean;
  file_count: number;
  total_bytes: number;
};

export type CodexGuardianReport = {
  generated_at: string;
  severity: CodexGuardianSeverity;
  codex_running: CodexGuardianProcess[];
  logs: {
    sqlite_path: string;
    sqlite_bytes: number;
    wal_bytes: number;
    shm_bytes: number;
    rows: string | number | null;
    rows_error: string | null;
    trace_body_bytes: string | number | null;
    trace_body_error: string | null;
    top_targets?: string | null;
    top_targets_error?: string | null;
  };
  sessions: CodexGuardianDirectoryStats;
  archived_sessions: CodexGuardianDirectoryStats;
  largest_session_files?: Array<{ path: string; size_bytes: number; last_write_time: string }>;
  month_coverage?: string[];
  process_manager?: {
    path: string;
    exists: boolean;
    entry_count: number;
    stale_count: number;
    error?: string | null;
  };
};

export type CodexGuardianCleanReceipt = {
  kind: "clean-logs";
  created_at: string;
  backup_dir: string;
  before: Record<string, number>;
  after: Record<string, number>;
};

export type CodexGuardianCompactReceipt = {
  kind: "compact-session";
  created_at: string;
  thread_id: string;
  source_path: string;
  backup_dir: string;
  backup_path: string;
  before_bytes: number;
  after_bytes: number;
  bytes_saved: number;
  before_sha256: string | null;
  backup_sha256: string | null;
  temp_sha256: string | null;
  after_sha256: string | null;
  line_count: number;
  changed_lines: number;
  parse_errors: number;
  restore_hint: string;
  protected_skip?: boolean;
  protected_skip_reason?: string;
  receipt_path?: string;
  receipt_sha256?: string;
  evidence_schema?: string;
  vault_manifest_path?: string;
  vault_session_path?: string;
  vault_sha256?: string;
};

export type CodexGuardianHistorySourceRef = {
  kind: "guardian_inventory" | "zhixia_summary" | "raw_session" | string;
  path: string | null;
  sha256?: string | null;
  field?: string;
  section?: string;
  readByDefault?: boolean;
};

export type CodexGuardianHistoryItem = {
  threadId: string;
  title: string;
  summary: string;
  status: string;
  freshness: "current" | "review" | "stale" | "unknown" | "conflict" | string;
  whyMatched: string;
  tokenEstimate: number;
  requiresHumanConfirmation: boolean;
  restoreCommand: string;
  sourceRefs: CodexGuardianHistorySourceRef[];
  sessionBytes?: number;
  sessionLastWriteTime?: string;
  sessionAgeMinutes?: number | null;
  hasZhixiaThreadHistoryVault?: boolean;
  hasThreadHistoryVault?: boolean;
  hasMemoryPointer?: boolean;
  hasZhixiaHistoryPointer?: boolean;
  zhixiaHistoryId?: string;
  vaultManifestPath?: string | null;
  vaultSessionPath?: string | null;
  vaultSha256?: string | null;
  vaultOriginalSha256?: string | null;
  vaultCopiedSha256?: string | null;
  vaultLatestPath?: string | null;
  vaultSourceLastWriteTime?: string | null;
  sourceChangedSinceVault?: boolean;
  hasCompactReceipt?: boolean;
  compactReceiptPath?: string | null;
  compactReceiptSha256?: string | null;
  compactReceiptCreatedAt?: string | null;
  incrementalAction?: "needs_vault" | "source_changed_since_vault" | "needs_compact_receipt" | "already_processed" | string;
  needsBodySlimming?: boolean;
  archiveThreadRole?: "ceo_thread" | "ceo_created_thread" | "unknown" | string;
  optimized?: {
    knowledgeItemId?: string;
    projectPath?: string | null;
    sourcePath?: string | null;
    vaultManifestPath?: string;
    vaultSessionPath?: string;
    vaultSha256?: string;
    memoryPointers?: string[];
    written?: string[];
  };
  pressureReason?: "long_thread" | "very_long_thread" | string;
  archiveCandidate?: {
    threadId: string | null;
    isCandidate: boolean;
    archiveState: "candidate" | "blocked" | string;
    reasons: string[];
    blockers: string[];
    evidence: {
      status: string;
      projectStatus: string;
      archiveState: string;
      lastWriteTime: string | null;
      idleDays?: number | null;
      idleDaysThreshold?: number;
      archiveThreadRole?: "ceo_thread" | "ceo_created_thread" | "unknown" | string;
      requireCompactReceipt?: boolean;
      sessionBytes: number;
      usageFrequency: number;
      hasVault: boolean;
      hasVaultEvidence?: boolean;
      hasMemoryPointer: boolean;
      hasSourceRefs?: boolean;
      hasReceiptEvidence?: boolean;
      vaultManifestPath?: string | null;
      vaultSessionPath?: string | null;
      vaultSha256?: string | null;
      vaultOriginalSha256?: string | null;
      vaultCopiedSha256?: string | null;
      compactReceiptPath?: string | null;
      compactReceiptSha256?: string | null;
      threadStoreCompatible?: boolean | null;
      memoryPointers?: string[];
      sourceRefs?: CodexGuardianHistorySourceRef[];
    };
  };
  shouldStartFreshThread?: boolean;
  continuationAdvice?: string;
  provenance?: {
    sourceBucket?: string;
    restoreState?: string;
    lastWriteTime?: string;
    projectRoot?: string;
  };
};

export type CodexGuardianHistoryEnvelope = {
  schemaVersion: "guardian.agent.v1" | string;
  command: string;
  generatedAt: string;
  query: string;
  mode: "read_only" | string;
  items: CodexGuardianHistoryItem[];
  archiveQueueItems?: CodexGuardianHistoryItem[];
  warnings: string[];
  provenance: {
    guardianInventoryPath: string;
    guardianRestoreIndexPath: string;
    zhixiaIndexPath: string;
    sourceGeneratedAt?: string | null;
    inventoryGeneratedAt?: string | null;
    selectedLargeCount?: number;
    selectedStaleRoleCount?: number;
  };
  thresholds?: {
    minBytes: number;
    minMegabytes: number;
    minAgeMinutes?: number;
    limit: number;
    ceoCreatedThreadIdleDays?: number;
    ceoThreadIdleDays?: number;
    unknownThreadIdleDays?: number;
  };
  backlog?: {
    totalCandidates: number;
    incrementalCandidateCount?: number;
    alreadyProcessedCount?: number;
    selectedBatchCount: number;
    remainingAfterBatch: number;
    unvaultedCount: number;
    vaultedCount: number;
    sourceChangedCount?: number;
    missingCompactReceiptCount?: number;
    staleRoleCount: number;
    largeCount: number;
  };
  optimized?: {
    knowledgeItemId: string;
    projectPath: string | null;
    sourcePath: string | null;
    vaultManifestPath?: string;
    vaultSessionPath?: string;
    vaultSha256?: string;
    historyLayers?: {
      hot?: Record<string, unknown>;
      warm?: Record<string, unknown>;
      cold?: Record<string, unknown>;
      coolingPolicy?: Record<string, unknown>;
    };
    written: string[];
    message: string;
  };
};

export type CodexThreadArchiveQueueItem = {
  threadId: string;
  title: string;
  summary: string;
  action: "archive_codex_sidebar_thread";
  status: "ready_for_host_archive";
  generatedAt: string;
  sessionBytes: number;
  sessionLastWriteTime: string | null;
  hostBridge: {
    requiredTool: "codex_app.set_thread_archived";
    archived: true;
    availableInsideZhixiaApp: false;
    reason: string;
  };
  safety: {
    deletesSession: false;
    mutatesRawSession: false;
    requiresVerifiedVault: true;
    requiresCompactReceipt: boolean;
    restorePointerPolicy: string;
  };
  evidence: NonNullable<CodexGuardianHistoryItem["archiveCandidate"]>["evidence"];
  archiveCandidate: NonNullable<CodexGuardianHistoryItem["archiveCandidate"]>;
};

export type CodexThreadArchiveQueueSkipped = {
  threadId: string | null;
  title: string;
  blockers: string[];
  reasons?: string[];
  reason: string;
  archiveCandidate?: CodexGuardianHistoryItem["archiveCandidate"];
  hostArchiveState?: {
    status: "host_archive_completed" | "host_archive_protected" | "host_thread_not_found" | "host_archive_persist_failed" | "host_archive_error" | string;
    reason: string;
    receiptPath?: string;
    seenAt?: string;
  };
};

export type CodexThreadArchiveQueue = {
  schemaVersion: "zhixia.codex_sidebar_archive_queue.v1" | string;
  queueId: string;
  queuePath: string;
  generatedAt: string;
  mode: "host_bridge_required" | string;
  executionState: "pending_host_archive_bridge" | "no_ready_threads" | string;
  appCanArchiveCodexSidebar: false;
  readyCount: number;
  skippedCount: number;
  queuedForArchiveCount?: number;
  skippedActiveCount?: number;
  preservedCount?: number;
  alreadyPreservedCount?: number;
  totalCount: number;
  hostBridge: {
    requiredTool: "codex_app.set_thread_archived";
    callbackPolicy: string;
  };
  items: CodexThreadArchiveQueueItem[];
  skipped: CodexThreadArchiveQueueSkipped[];
};

export type CodexThreadHistoryAutoIngestResult = {
  schemaVersion: "zhixia.codex_thread_auto_ingest.v1" | string;
  generatedAt: string;
  command?: "auto-ingest-codex-history" | string;
  mode: "preservation_only_no_archive_compact_move_delete" | string;
  sourceRoot: string;
  vaultRoot: string;
  scannedCount: number;
  preservedCount: number;
  alreadyPreservedCount: number;
  activePreservedCount: number;
  errorCount: number;
  message?: string;
  results: Array<{
    action: "preserved" | "refreshed" | "already_preserved" | string;
    threadId: string;
    sourcePath: string;
    vaultManifestPath: string;
    vaultSessionPath: string | null;
    vaultSha256: string | null;
    preservationState: "preserved" | "preserved_not_archive_ready" | string;
    activeLike: boolean;
    memoryPointer: string;
  }>;
  errors: Array<{ threadId: string; sourcePath: string; error: string }>;
  safety: {
    mutatesCodexSessionFiles: false;
    archivesCodexThreads: false;
    compactsCodexSessions: false;
    deletesCodexSessionFiles: false;
  };
};

export type CodexGuardianHistoryQuery = {
  query?: string;
  threadId?: string;
  projectPath?: string;
  limit?: number;
  tokenBudget?: number;
  metadataOnly?: boolean;
};

export type CodexGuardianCommandResult<T> = {
  ok: boolean;
  result?: T | null;
  error?: string;
  refused?: boolean;
  scriptPath?: string;
  stderr?: string;
};

export type ExperienceCard = {
  id: string;
  projectPath: string | null;
  scope: "user" | "project" | "task" | "autoflow";
  sourceType: "autoflow_completion" | "bug_memory" | "agent_family" | "manual" | "project_doc";
  title: string;
  summary: string;
  body: string;
  tags: string[];
  sourcePath: string | null;
  sourceHash: string | null;
  contractVersion?: string | null;
  freshness?: AgentRetrieveFreshness | null;
  requiresHumanConfirmation?: boolean;
  reviewReason?: string | null;
  rawSessionPolicy?: string | null;
  sourceRefs?: SourceRef[];
  tokenEstimate?: number;
  sourceDocumentId?: string | null;
  sourceDocumentUpdatedAt?: string | null;
  memoryType?: string | null;
  sourceSignature?: string | null;
  confirmedSourceSignature?: string | null;
  sourceSignatureReviewState?: "unreviewed" | "current" | "stale";
  curationDecision?: ExperienceCardCurationDecision;
  duplicateGroupKey?: string | null;
  duplicateState?: "unique" | "duplicate_candidate" | "kept" | "merged" | "rejected" | "archived";
  duplicateOf?: string | null;
  duplicateCount?: number;
  duplicateIds?: string[];
  suggestedMergeTargetId?: string | null;
  reviewedAt?: string | null;
  status: "candidate" | "accepted" | "curated" | "archived" | "rejected" | "stale";
  createdAt: string;
  updatedAt: string;
};

export type ExperienceCardStatus = "candidate" | "accepted" | "curated" | "archived" | "rejected" | "stale";
export type ExperienceCardCurationDecision = "pending" | "keep" | "merge" | "reject" | "archive";
export type ExperienceCardGovernanceOptions = {
  curationDecision?: ExperienceCardCurationDecision;
};

export type SkillCandidate = {
  id: string;
  projectPath: string | null;
  scope: "user" | "project" | "task";
  title: string;
  triggerPatterns: string[];
  draftSkillMarkdown: string;
  evidence: {
    cardIds?: string[];
    sourcePaths?: string[];
    generatedBy?: string;
  };
  status: "draft" | "approved" | "installed" | "rejected";
  createdAt: string;
  updatedAt: string;
};

export type SkillCandidateStatus = "draft" | "approved" | "installed" | "rejected";

export type ZhixiaSkillDefinition = {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  builtIn: boolean;
  enabled: boolean;
  triggerActions: string[];
  aiProvider: "none" | "optional" | "required" | string;
  allowedReadScopes: string[];
  allowedWriteScopes: string[];
  forbiddenActions: string[];
  outputSchema: string;
  sourcePath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillRunReceipt = {
  id: string;
  skillId: string;
  skillVersion: string;
  triggerAction: string;
  projectId?: string | null;
  status: "success" | "fallback" | "failed" | "blocked" | string;
  provider: string;
  model?: string | null;
  inputSourceRefs: SourceRef[];
  inputHash: string;
  outputHash?: string | null;
  writtenRecords: Array<{ table: string; id: string; action: "created" | "updated" | "skipped" | string }>;
  blockedReason?: string | null;
  errorMessage?: string | null;
  durationMs: number;
  createdAt: string;
};

export type ZhixiaSkillRunResult = {
  ok: true;
  skill: ZhixiaSkillDefinition;
  receipt: SkillRunReceipt;
  output: {
    title?: string;
    summary?: string;
    nextAction?: string;
    blockers?: string[];
    status?: string;
    completion?: string;
  };
  usedNetwork: boolean;
  settings: AppSettings;
};

export type MemoryOverview = {
  experienceCards: number;
  skillCandidates: number;
  projects: Array<{
    projectPath: string;
    projectName: string;
    experienceCards: number;
    skillCandidates: number;
  }>;
};

export type AutoflowImportResult = {
  imported: number;
  sources: Array<{ sourceType: string; sourcePath: string; imported: number }>;
  projectPaths: string[];
  writtenFiles: string[];
  skillCandidateIds: string[];
  overview: MemoryOverview;
};

export type KnowledgeCategory =
  | "architecture"
  | "product"
  | "testing"
  | "operations"
  | "process"
  | "data"
  | "docs"
  | "general";

export type KnowledgeItem = {
  id: string;
  projectPath: string | null;
  documentId: string | null;
  sourcePath: string | null;
  title: string;
  summary: string;
  body: string;
  category: KnowledgeCategory;
  tags: string[];
  sourceHash: string | null;
  provider: string;
  model: string;
  status: "ready" | "fallback" | "error";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeOverview = {
  total: number;
  categories: Array<{ category: KnowledgeCategory; label: string; count: number }>;
  projects: Array<{ projectPath: string; projectName: string; knowledgeItems: number }>;
};

export type KnowledgeGenerateResult = {
  generated: number;
  mode: "heuristic" | "ai";
  usedNetwork: boolean;
  items: KnowledgeItem[];
  errors: Array<{ filePath: string; message: string }>;
  overview: KnowledgeOverview;
};

export type AiProviderTestResult = {
  ok: boolean;
  message: string;
};

export type AgentRetrieveKind =
  | "project_record"
  | "project_resume_packet"
  | "ceo_flow_record"
  | "thread_lineage_index"
  | "project_artifact"
  | "document"
  | "knowledge_item"
  | "experience_card"
  | "skill_candidate"
  | "tool_skill_record";

export type AgentRetrieveFreshness = "fresh" | "review" | "stale";

export type AgentRetrieveCacheInfo = {
  hit: boolean;
  ttlMs: number;
};

export type SourceRef = {
  kind: AgentRetrieveKind | "document" | string;
  path: string | null;
  title: string | null;
  hash: string | null;
  updatedAt: string | null;
  artifactType?: string | null;
  sourceType?: string | null;
};

export type MemoryRouterTaskType =
  | "project_resume"
  | "task_dispatch"
  | "review_gate"
  | "bug_repair"
  | "architecture"
  | "release"
  | "thread_recovery"
  | "archive_candidate"
  | "runtime_diagnosis"
  | "tool_skill_lookup"
  | "workflow_reuse"
  | "handoff"
  | "memory_writeback"
  | "retrieve_precedent";

export type MemoryLayerName = "hot" | "warm" | "cold";

export type MemoryRouterPlan = {
  schemaVersion: 1;
  taskType: MemoryRouterTaskType | string;
  queryType: string;
  providerMode: string;
  strategy: "hot_warm_cold_metadata_first" | string;
  retrieval: {
    query: string;
    includeKinds: string[];
    maxResults: number;
    cacheTtlMs: number;
  };
  budgets: {
    tokenBudget: number;
    topK: number;
    timeBudgetMs: number;
    packetTokenTarget: number;
  };
  layers: Record<MemoryLayerName, {
    enabled: boolean;
    purpose: string;
    maxItems: number;
    rawSessionDefaultRead?: false;
  }>;
  rawSessionGate: {
    defaultRead: false;
    allowed: boolean;
    reason: string;
  };
  backgroundPolicy: {
    startsTimers: false;
    scansFullDatabase: false;
    scansVault: false;
    runsAiSummary: false;
    rebuildsGraph: false;
  };
};

export type HotStateCacheSeed = {
  schemaVersion: 1;
  project: RuntimeContextPacket["project"];
  activeItemIds: string[];
  nextAction: string;
  sourceRefs: SourceRef[];
  expiresAt: string;
};

export type MemoryGraphNode = {
  id: string;
  kind: string;
  label: string;
  title?: string;
  summary?: string;
  projectPath?: string | null;
  threadId?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  freshness?: string;
  status?: string;
  tags?: string[];
  sourceRefs?: SourceRef[];
  activation?: number;
  whyActivated?: string[];
  memoryLayer?: MemoryLayerName | string;
  tokenEstimate?: number;
};

export type MemoryGraphEdge = {
  from: string;
  to: string;
  kind: string;
  weight: number;
};

export type MemoryGraph = {
  schemaVersion: 1;
  mode: "bounded_association_graph" | "persisted_activation_graph" | string;
  taskGoal?: string;
  tokens?: string[];
  activatedNodeIds?: string[];
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  packetLocalGraph?: MemoryGraph;
  performance?: {
    metadataOnly?: boolean;
    rawSessionBodyRead?: false;
    scansVault?: false;
    boundedSeedNodes?: number;
    boundedSeedEdges?: number;
    maxNodes?: number;
  };
  warnings?: string[];
};

export type AgentRetrieveItem = {
  id: string;
  kind: AgentRetrieveKind;
  title: string;
  excerpt: string;
  sourcePath: string;
  sourceRefs: SourceRef[];
  status: string;
  freshness: AgentRetrieveFreshness;
  score: number;
  tokenEstimate: number;
  whyMatched: string[];
  requiresHumanConfirmation: boolean;
  rawSessionPolicy?: string | null;
  sourceDocumentUpdatedAt?: string | null;
};

export type AgentRetrieveOptions = {
  query?: string;
  queryType?: string;
  projectPath?: string | null;
  parentCeoThreadId?: string | null;
  ceoThreadId?: string | null;
  tokenBudget?: number;
  maxResults?: number;
  includeKinds?: AgentRetrieveKind[];
};

export type AgentRetrieveResult = {
  provider: string;
  mode: string;
  queryType: string;
  query: string;
  projectPath: string | null;
  parentCeoThreadId?: string | null;
  tokenBudget: number;
  returnedCount: number;
  tokenEstimate: number;
  freshness: AgentRetrieveFreshness;
  generatedAt: string;
  cache?: AgentRetrieveCacheInfo;
  items: AgentRetrieveItem[];
};

export type RuntimeMemoryItem = {
  id: string;
  kind: Exclude<AgentRetrieveKind, "document">;
  title: string;
  summary: string;
  status: "active" | "curated" | "ready" | "candidate" | "review" | "stale" | "superseded" | "blocked" | string;
  freshness: "fresh" | "review" | "stale" | "unknown" | "conflict" | string;
  whyMatched: string[];
  sourceRefs: SourceRef[];
  tokenEstimate: number;
  requiresHumanConfirmation: boolean;
  rawSessionPolicy: "not_allowed" | "explicit_only";
  memoryLayer?: MemoryLayerName | string;
};

export type RuntimeContextPacket = {
  schemaVersion: 1;
  request: {
    taskGoal: string;
    queryType: string;
    projectPath?: string | null;
    threadId?: string | null;
    parentCeoThreadId?: string | null;
    tokenBudget: number;
    allowedKinds: string[];
    taskType?: string;
  };
  project?: {
    id?: string | null;
    name: string;
    path?: string | null;
    status?: string;
    completion?: string | null;
    summary?: string;
    nextAction?: string;
    blockers?: string[];
    freshness: "fresh" | "review" | "stale" | "unknown" | "conflict" | string;
  } | null;
  items: RuntimeMemoryItem[];
  sourceRefs: SourceRef[];
  hotState?: HotStateCacheSeed;
  memoryGraph?: MemoryGraph;
  activatedMemory?: {
    nodeCount: number;
    edgeCount: number;
    topNodes: Array<{
      id: string;
      kind: string;
      title: string;
      activation: number;
      whyActivated: string[];
    }>;
    sync?: {
      nodes: number;
      edges: number;
      projectCount: number;
      projectPath?: string | null;
      limit: number;
    } | null;
  };
  memoryLayers?: Record<MemoryLayerName, { count: number; tokenEstimate: number }>;
  routerPlan?: MemoryRouterPlan;
  performance?: {
    metadataFirst: true;
    noRawSessionBody: true;
    noFullTextRead: true;
    noVaultScan: true;
    noBackgroundTimer: true;
    boundedByRouterPlan?: true;
    metadataRowReadsMayUseIndexes?: true;
    cacheTtlMs: number;
    timeBudgetMs: number;
    retrievalDurationMs?: number;
    timeBudgetExceeded?: boolean;
    memoryGraphMetadataOnly?: true;
    memoryGraphRawSessionBodyRead?: false;
    memoryGraphVaultScan?: false;
    memoryGraphSeedNodes?: number;
    memoryGraphSeedEdges?: number;
  };
  partial?: boolean;
  expiresAt?: string;
  cacheKey?: string;
  warnings: string[];
  tokenEstimate: number;
  generatedAt: string;
  precedentPolicy?: {
    metadataFirst: boolean;
    rawSessionDefaultRead: false;
    giantMarkdownDefaultRead: false;
    allowedKinds: string[];
  };
};

export type EvidenceWritebackPacket = {
  schemaVersion?: 1;
  decision: "accept" | "revise" | "block" | "supersede";
  task: {
    id: string;
    goal: string;
    domain?: string[];
    projectPath?: string | null;
    threadId?: string | null;
    parentCeoThreadId?: string | null;
  };
  evidence: {
    summary: string;
    changedFiles?: string[];
    artifacts?: string[];
    tests?: string[];
    reusablePattern?: string[];
    failurePattern?: string[];
    residualRisk?: string;
    sourceRefs?: SourceRef[];
  };
  writeback?: Record<string, unknown>;
  privacy?: {
    containsRawSession?: boolean;
    containsSecrets?: boolean;
    publicCandidateAllowed?: boolean;
  };
};

export type EvidenceWritebackReceipt = {
  schemaVersion: "zhixia.memory_runtime_store.v1" | string;
  id: string;
  hash: string;
  createdAt: string;
  status: "queued" | "candidate_review" | "rejected" | string;
  decision: string;
  taskId: string;
  safetyBlockers: string[];
  warnings: string[];
  candidateCount: number;
  flowSkillCandidateCount?: number;
  storagePath: string;
};

export type FlowSkillCandidateRecord = {
  schemaVersion: 1;
  kind: "flowskill_candidate";
  id: string;
  hash: string;
  visibility: "private";
  status: "private_review" | "blocked" | "review" | string;
  task: {
    id: string;
    goal: string;
    domain: string[];
    projectPath?: string | null;
    threadId?: string | null;
    parentCeoThreadId?: string | null;
  };
  evidence: {
    summary: string;
    reusablePattern: string[];
    doNotApplyTo: string[];
    tests: string[];
    artifacts: string[];
    changedFiles: string[];
    residualRisk: string;
    sourceRefs: SourceRef[];
  };
  sourceRefs: SourceRef[];
  privacy: {
    containsRawSession: boolean;
    containsSecrets: boolean;
    publicCandidateAllowed: false;
    redactionRequired: boolean;
  };
  promotion: {
    suggestedTarget: "flowskill_candidate";
    requiresUserConfirmation: true;
    reason: string;
    captureDryRunOnly: true;
    publicExportAutomatic: false;
    installExecuteAutomatic: false;
  };
  effects: {
    runsFlowSkill: false;
    installsOrExecutes: false;
    exportsPublicly: false;
    archiveCompactDeleteMoveRestore: false;
    mutatesRawSession: false;
  };
  tokenEstimate: number;
  generatedAt: string | null;
  sourceReceiptId?: string;
  storagePath?: string;
};

export type WorkingMemoryRecord = {
  schemaVersion: 1;
  taskId: string;
  projectPath?: string | null;
  threadId?: string | null;
  parentCeoThreadId?: string | null;
  status: "active" | "waiting_review" | "blocked" | "accepted" | "superseded";
  currentGoal: string;
  currentEvidence: SourceRef[];
  decisions: string[];
  openRisks: string[];
  nextAction: string;
  updatedAt: string;
  storagePath?: string;
};

export type RuntimeEventMemoryType =
  | "broken_thread"
  | "heartbeat_fuse"
  | "thread_takeover"
  | "stale_lane_reference"
  | "task_checkpoint"
  | "user_rule_update"
  | "runtime_diagnosis";

export type RuntimeEventMemoryInput = {
  id?: string;
  eventType?: RuntimeEventMemoryType | string;
  type?: RuntimeEventMemoryType | string;
  severity?: "info" | "warning" | "error" | "critical" | string;
  projectPath?: string | null;
  threadId?: string | null;
  parentCeoThreadId?: string | null;
  replacementThreadId?: string | null;
  automationId?: string | null;
  heartbeatId?: string | null;
  taskId?: string;
  title?: string;
  summary?: string;
  message?: string;
  observedSignals?: string[];
  decisions?: string[];
  openRisks?: string[];
  nextAction?: string;
  sourceRefs?: SourceRef[];
  status?: WorkingMemoryRecord["status"];
  ttlDays?: number;
};

export type RuntimeEventMemoryReceipt = {
  schemaVersion: "zhixia.memory_runtime_store.v1" | string;
  id: string;
  status: "recorded" | string;
  eventType: RuntimeEventMemoryType | string;
  severity: string;
  taskId: string;
  projectPath?: string | null;
  threadId?: string | null;
  automationId?: string | null;
  replacementThreadId?: string | null;
  warnings: string[];
  storagePath: string;
  workingMemory: WorkingMemoryRecord;
  safety: {
    metadataOnly: true;
    rawSessionBodyRead: false;
    scansVault: false;
    startsTimers: false;
    archiveCompactDeleteMoveRestore: false;
    mutatesRawSession: false;
    installsOrExecutes: false;
  };
  createdAt: string;
  updatedAt: string;
};

export type RuntimeEventWritebackSummary = {
  enabled: boolean;
  attempted?: number;
  recorded: number;
  skipped?: number;
  receipts: Array<{
    id: string;
    eventType: RuntimeEventMemoryType | string;
    severity: string;
    taskId: string;
    projectPath?: string | null;
    threadId?: string | null;
    status: string;
    warnings: string[];
    safety: RuntimeEventMemoryReceipt["safety"];
  }>;
  warnings: string[];
};

export type ThreadRecoveryPacket = {
  schemaVersion: "zhixia.thread_recovery_packet.v1";
  generatedAt: string;
  request: {
    threadId?: string | null;
    title?: string | null;
    query: string;
    projectPath?: string | null;
    tokenBudget: number;
  };
  thread: {
    threadId?: string | null;
    title: string;
    projectPath?: string | null;
    confidence: "source_backed" | "needs_review" | string;
  };
  lineage: Array<{
    id: string;
    kind: "thread_lineage_index";
    ceoThreadId: string;
    title: string;
    workspacePaths: string[];
    relationships: Record<string, string[]>;
    governance: {
      rawSessionPolicy: "metadata_only_no_raw_body" | string;
      mutationPolicy: "read_only_no_archive_compact_restore_delete" | string;
      status: string;
    };
    sourceRefs: SourceRef[];
  }>;
  vault: {
    hasVault: boolean;
    manifests: Array<{
      threadId: string;
      title: string;
      projectPath?: string | null;
      vaultManifestPath?: string | null;
      vaultSessionPath?: string | null;
      memoryPointer?: string | null;
      originalSha256?: string | null;
      copiedSha256?: string | null;
      completeHistoryStored: boolean;
      rawSessionPolicy: "vault_pointer_only_no_default_body_read" | string;
    }>;
    policy: "pointer_only_no_default_raw_body_read" | string;
  };
  context: {
    packetId?: string | null;
    itemCount: number;
    items: Array<{
      id: string;
      kind: AgentRetrieveKind | string;
      title: string;
      summary: string;
      freshness: string;
      memoryLayer?: string | null;
      whyMatched: string[];
      sourceRefs: SourceRef[];
    }>;
  };
  recommendedReadOrder: SourceRef[];
  coldHistorySources: Array<SourceRef & {
    threadId?: string | null;
    sizeBytes?: number | null;
    readByDefault: false;
    rawSessionPolicy: string;
  }>;
  sourceRefs: SourceRef[];
  nextActions: string[];
  prompt: string;
  performance: {
    metadataFirst: true;
    rawSessionBodyRead: false;
    scansFullDatabase: false;
    startsTimers: false;
    boundedSourcePointers: true;
  };
  safety: {
    mutatesRawSession: false;
    archiveCompactDeleteMoveRestore: false;
    installsOrExecutes: false;
    rawSessionDefaultRead: false;
  };
  warnings: string[];
  runtimeEventWriteback?: RuntimeEventWritebackSummary;
  tokenEstimate: number;
};

export type MemoryPromotionCandidate = {
  id?: string;
  target?: "knowledge_item" | "experience_card" | "memory_card" | "project_update" | "lineage_update" | "flowskill_candidate" | string;
  kind?: string;
  title?: string;
  summary?: string;
  sourceRefs?: SourceRef[];
  evidence?: { sourceRefs?: SourceRef[] };
  privacy?: {
    containsRawSession?: boolean;
    containsSecrets?: boolean;
    publicExportRequested?: boolean;
  };
  publicExportRequested?: boolean;
  containsRawSession?: boolean;
  containsSecrets?: boolean;
};

export type MemoryPromotionResult = {
  schemaVersion: "zhixia.memory_runtime_store.v1" | string;
  id: string;
  target: string;
  title: string;
  summary: string;
  status: "queued_candidate" | "candidate_review" | "review" | string;
  sourceRefs: SourceRef[];
  blockers: string[];
  warnings: string[];
  requiresHumanConfirmation: true;
  effects: {
    installsOrExecutes: false;
    exportsPublicly: false;
    archiveCompactDeleteMoveRestore: false;
    mutatesRawSession: false;
  };
  createdAt: string;
  updatedAt: string;
  storagePath: string;
};

export type AgentRetrieveLogStatus = "success" | "error" | "fallback";

export type AgentRetrieveLogItemSummary = {
  id: string;
  title: string;
  kind: AgentRetrieveKind;
  freshness: AgentRetrieveFreshness;
  status: string;
  whyMatched: string[];
  tokenEstimate: number;
  sourcePath: string;
};

export type AgentRetrieveLogEntry = {
  id: string;
  timestamp: string;
  provider: string;
  mode: string;
  queryType: string;
  query: string;
  projectPath: string | null;
  parentCeoThreadId?: string | null;
  tokenBudget: number;
  returnedCount: number;
  tokenEstimate: number;
  freshness: AgentRetrieveFreshness;
  status: AgentRetrieveLogStatus;
  durationMs: number;
  cache?: AgentRetrieveCacheInfo;
  requiresHumanConfirmationCount: number;
  sourceRefs: SourceRef[];
  topItems: AgentRetrieveLogItemSummary[];
  errorMessage?: string | null;
};

export type AgentRuntimePlatform =
  | "codex"
  | "claude_code"
  | "openclaw"
  | "cursor"
  | "windsurf"
  | "gemini_cli"
  | "unknown";

export type AgentRuntimeStatus = "active" | "idle" | "running" | "systemError" | "notLoaded" | "unknown";

export type AgentRuntimeAction =
  | "wait_and_resample"
  | "inspect_process_metadata"
  | "inspect_thread_metadata"
  | "review_error_state"
  | "review_history_metadata"
  | "none";

export type AgentRuntimeConfidence = "low" | "medium" | "high";

export type AgentRuntimePlatformSupport = {
  platform: AgentRuntimePlatform;
  processAdapter: string;
  sessionAdapter: string;
  supportLevel: "session_metadata_mvp" | "process_only_planned_session_adapter" | "process_metadata_only" | string;
  rawSessionPolicy: "metadata_only_no_raw_body" | string;
  limitation: string;
};

export type AgentRuntimeProcessSample = {
  id: string;
  platform: AgentRuntimePlatform;
  platformSupport?: AgentRuntimePlatformSupport;
  processId: number;
  processName: string;
  executablePath?: string | null;
  commandLine?: string | null;
  redactedFields?: string[];
  sensitiveFieldPolicy?: string;
  parentProcessId?: number | null;
  rawCpuPercent?: number;
  cpuPercent: number;
  memoryBytes: number;
  sampledAt: string;
};

export type AgentRuntimeObservedSessionFacts = {
  threadId?: string | null;
  sessionId: string;
  platform: AgentRuntimePlatform;
  status: AgentRuntimeStatus;
  historySizeBytes: number;
  lastWriteTime?: string | null;
  recentActivityMinutes: number | null;
  hasThreadHistoryVault: boolean;
  hasCompactReceipt: boolean;
  hasZhixiaHistoryPointer: boolean;
  vaultManifestPath?: string | null;
  vaultSessionPath?: string | null;
  vaultSha256?: string | null;
  compactReceiptPath?: string | null;
  memoryPointers: string[];
  observedProcessIds: number[];
  evidence: string[];
};

export type AgentRuntimeAttributionUncertainty = {
  metadataOnly: boolean;
  directProcessThreadMapping: boolean;
  confidence: AgentRuntimeConfidence;
  reasons: string[];
  limitations: string[];
};

export type AgentRuntimeAttributionInference = {
  threadId?: string | null;
  sessionId: string;
  confidence: AgentRuntimeConfidence;
  basis: string;
  suspectedProcessId: number | null;
  suspectedProcessName: string | null;
  reasons: string[];
  uncertainty?: AgentRuntimeAttributionUncertainty;
};

export type AgentRuntimeSession = {
  id: string;
  platform: AgentRuntimePlatform;
  platformSupport?: AgentRuntimePlatformSupport;
  threadId?: string | null;
  title?: string | null;
  projectPath?: string | null;
  status: AgentRuntimeStatus;
  sessionPath?: string | null;
  sessionBytes: number;
  lastWriteTime?: string | null;
  hasZhixiaHistoryPointer: boolean;
  hasThreadHistoryVault: boolean;
  hasCompactReceipt: boolean;
  vaultManifestPath?: string | null;
  vaultSessionPath?: string | null;
  vaultSha256?: string | null;
  compactReceiptPath?: string | null;
  memoryPointers?: string[];
  observedProcessIds?: number[];
  optimizedAt?: string | null;
  historySizeBytes?: number;
  pressureScore: number;
  attributionConfidence: AgentRuntimeConfidence;
  recommendedAction: AgentRuntimeAction;
  observed: AgentRuntimeObservedSessionFacts;
  inferredAttribution: AgentRuntimeAttributionInference;
  uncertainty: AgentRuntimeAttributionUncertainty;
  evidence: string[];
};

export type AgentRuntimeProcessCandidate = {
  processId: number;
  processName: string;
  platform: AgentRuntimePlatform;
  supportLevel?: string;
  cpuPercent: number;
  rawCpuPercent?: number;
  memoryBytes: number;
  sampledAt: string;
};

export type AgentRuntimeSessionCandidate = {
  threadId?: string | null;
  sessionId: string;
  title?: string | null;
  platform: AgentRuntimePlatform;
  supportLevel?: string;
  status: AgentRuntimeStatus;
  historySizeBytes: number;
  lastWriteTime?: string | null;
  recentActivityMinutes: number | null;
  attributionConfidence: AgentRuntimeConfidence;
};

export type AgentRuntimeRecommendation =
  | {
      scope: "process";
      attributionConfidence: AgentRuntimeConfidence;
      recommendedAction: AgentRuntimeAction;
      reason: string;
      processId: number | null;
    }
  | {
      scope: "session";
      threadId?: string | null;
      sessionId: string;
      attributionConfidence: AgentRuntimeConfidence;
      recommendedAction: AgentRuntimeAction;
      pressureScore: number;
      uncertainty: AgentRuntimeAttributionUncertainty;
      evidence: string[];
    };

export type AgentRuntimeMonitorSnapshot = {
  sampledAt: string;
  processes: AgentRuntimeProcessSample[];
  sessions: AgentRuntimeSession[];
  summary: {
    totalProcesses: number;
    totalSessions: number;
    totalCpuPercent: number;
    totalMemoryBytes: number;
    highCpuProcessCount: number;
    highMemoryProcessCount: number;
    systemErrorSessionCount: number;
    largeUnoptimizedSessionCount: number;
    topCpuProcess: AgentRuntimeProcessCandidate | null;
    topMemoryProcess: AgentRuntimeProcessCandidate | null;
    topHistorySizeSession: AgentRuntimeSessionCandidate | null;
    mostRecentSession: AgentRuntimeSessionCandidate | null;
    topCandidates: {
      cpuProcesses: AgentRuntimeProcessCandidate[];
      memoryProcesses: AgentRuntimeProcessCandidate[];
      historySizeSessions: AgentRuntimeSessionCandidate[];
      recentSessions: AgentRuntimeSessionCandidate[];
    };
    platformSupport?: AgentRuntimePlatformSupport[];
    redactedProcessCount?: number;
  };
  observedFacts: {
    processes: {
      highestCpuProcess: AgentRuntimeProcessCandidate | null;
      highestMemoryProcess: AgentRuntimeProcessCandidate | null;
      topCpuProcesses: AgentRuntimeProcessCandidate[];
      topMemoryProcesses: AgentRuntimeProcessCandidate[];
    };
    sessions: {
      largestHistorySessions: AgentRuntimeObservedSessionFacts[];
      mostRecentSessions: AgentRuntimeObservedSessionFacts[];
    };
  };
  inferredAttribution: AgentRuntimeAttributionInference[];
  warnings: string[];
  recommendations: AgentRuntimeRecommendation[];
  runtimeEventWriteback?: RuntimeEventWritebackSummary;
  sensitiveFieldPolicy?: {
    commandLine: string;
    executablePath: string;
    rawSessionBody: "metadata_only_no_raw_body" | string;
  };
  provenance?: {
    processSampler: string;
    guardianReport: boolean;
    longThreadMetadata: boolean;
    threadAttributionMode?: string;
    platformSupport?: AgentRuntimePlatformSupport[];
    nonCodexSessionAdapterPolicy?: string;
    supportedPlatforms?: AgentRuntimePlatformSupport[];
    sensitiveFieldPolicy?: AgentRuntimeMonitorSnapshot["sensitiveFieldPolicy"];
    platformLimitations?: string[];
    rawSessionPolicy: "metadata_only_no_raw_body" | string;
  };
};

export type AgentRuntimeMonitorOptions = {
  sessionLimit?: number;
  longThreadLimit?: number;
  includeLongThreadMetadata?: boolean;
  minBytes?: number;
  highCpuPercent?: number;
  highMemoryBytes?: number;
  observeRuntimeEvents?: boolean;
  runtimeEventLimit?: number;
};

declare global {
  interface Window {
    docKnowledge: {
      listDocuments: (options?: { includeContentText?: boolean; contentTextLimit?: number }) => Promise<{
        documents: KnowledgeDocument[];
        storePath: string;
        settings: AppSettings;
      }>;
      importDocuments: () => Promise<{
        imported: KnowledgeDocument[];
        documents: KnowledgeDocument[];
        errors: Array<{ filePath: string; message: string }>;
      }>;
      importFolder: () => Promise<{
        imported: KnowledgeDocument[];
        documents: KnowledgeDocument[];
        errors: Array<{ filePath: string; message: string }>;
        scanned: number;
      }>;
      scanCodexWorkspace: () => Promise<{
        imported: KnowledgeDocument[];
        documents: KnowledgeDocument[];
        errors: Array<{ filePath: string; message: string }>;
        scanned: number;
        workspacePath: string | null;
        projects?: string[];
        knowledgeFiles?: string[];
        generatedKnowledge?: number;
        knowledgeErrors?: Array<{ filePath: string; message: string }>;
        generatedToolSkillRecords?: number;
      }>;
      getCodexGuardianReport: () => Promise<CodexGuardianCommandResult<CodexGuardianReport>>;
      cleanCodexHotLogs: () => Promise<CodexGuardianCommandResult<CodexGuardianCleanReceipt>>;
      searchCodexHistory: (
        options?: CodexGuardianHistoryQuery,
      ) => Promise<CodexGuardianCommandResult<CodexGuardianHistoryEnvelope>>;
      getCodexThreadContext: (
        options?: CodexGuardianHistoryQuery,
      ) => Promise<CodexGuardianCommandResult<CodexGuardianHistoryEnvelope>>;
      getCodexProjectHistory: (
        options?: CodexGuardianHistoryQuery,
      ) => Promise<CodexGuardianCommandResult<CodexGuardianHistoryEnvelope>>;
      listLongCodexThreads: (
        options?: CodexGuardianHistoryQuery & { minBytes?: number; minAgeMinutes?: number },
      ) => Promise<CodexGuardianCommandResult<CodexGuardianHistoryEnvelope>>;
      optimizeCodexThread: (
        options?: CodexGuardianHistoryQuery,
      ) => Promise<CodexGuardianCommandResult<CodexGuardianHistoryEnvelope>>;
      compactCodexThread: (
        options?: CodexGuardianHistoryQuery & { dryRun?: boolean },
      ) => Promise<CodexGuardianCommandResult<CodexGuardianCompactReceipt>>;
      autoIngestCodexHistory: (
        options?: { limit?: number; recentWriteMinutes?: number },
      ) => Promise<CodexGuardianCommandResult<CodexThreadHistoryAutoIngestResult>>;
      generateCodexArchiveQueue: (options?: {
        items?: CodexGuardianHistoryItem[];
        compactReceipts?: Record<string, CodexGuardianCompactReceipt>;
        skipThreadIds?: string[];
        requireCompactReceipt?: boolean;
        bypassRoleCooling?: boolean;
        ceoThreadIdleDays?: number;
        ceoCreatedThreadIdleDays?: number;
        unknownThreadIdleDays?: number;
      }) => Promise<CodexGuardianCommandResult<CodexThreadArchiveQueue>>;
      scanToolSkillInventory: (projectPath: string) => Promise<ToolSkillInventoryResult>;
      getToolSkillInventory: (projectPath: string) => Promise<ToolSkillInventoryResult>;
      confirmToolSkillInventory: (options: {
        projectPath: string;
        snapshotHash: string;
      }) => Promise<ToolSkillInventoryResult>;
      updateToolSkillRecordGovernance: (options: {
        projectPath: string;
        recordId: string;
        status: "confirmed" | "rejected" | "deprecated" | "blocked" | "clear";
        snapshotHash: string;
      }) => Promise<ToolSkillInventoryResult>;
      exportCodexContext: (id: string) => Promise<{
        exported: boolean;
        bundlePath?: string;
        contextPath?: string;
        sourcesPath?: string;
        documents: KnowledgeDocument[];
        errors?: Array<{ filePath: string; message: string }>;
      }>;
      getDocument: (id: string) => Promise<{ document: KnowledgeDocument | null }>;
      reindexDocument: (id: string) => Promise<{
        reindexed: KnowledgeDocument[];
        documents: KnowledgeDocument[];
        errors: Array<{ filePath: string; message: string }>;
      }>;
      reindexAll: () => Promise<{
        reindexed: KnowledgeDocument[];
        documents: KnowledgeDocument[];
        errors: Array<{ filePath: string; message: string }>;
      }>;
      getWatchStatus: () => Promise<WatchStatus>;
      onWatchUpdate: (callback: (payload: WatchUpdate) => void) => () => void;
      checkChanges: () => Promise<{
        changed: number;
        missing: number;
        reindexed: KnowledgeDocument[];
        documents: KnowledgeDocument[];
        errors: Array<{ filePath: string; message: string }>;
      }>;
      updateDocument: (
        id: string,
        patch: Partial<Pick<KnowledgeDocument, "title" | "tags" | "favorite">>,
      ) => Promise<{ documents: KnowledgeDocument[] }>;
      updateDocumentContent: (
        id: string,
        contentText: string,
      ) => Promise<{
        reindexed: KnowledgeDocument[];
        documents: KnowledgeDocument[];
        errors: Array<{ filePath: string; message: string }>;
      }>;
      deleteDocument: (id: string) => Promise<{ documents: KnowledgeDocument[] }>;
      exportMetadata: () => Promise<{ exported: boolean; filePath?: string }>;
      updateSettings: (patch: Partial<AppSettings>) => Promise<{ settings: AppSettings }>;
      getMemoryOverview: () => Promise<MemoryOverview>;
      listExperienceCards: (projectPath?: string | null) => Promise<{ cards: ExperienceCard[] }>;
      listSkillCandidates: (projectPath?: string | null) => Promise<{ candidates: SkillCandidate[] }>;
      updateExperienceCardStatus: (
        id: string,
        status: ExperienceCardStatus,
        options?: ExperienceCardGovernanceOptions,
      ) => Promise<{ ok: true; card: ExperienceCard | null; overview: MemoryOverview }>;
      updateSkillCandidateStatus: (
        id: string,
        status: SkillCandidateStatus,
      ) => Promise<{ ok: true; candidate: SkillCandidate | null; overview: MemoryOverview }>;
      retrieveAgentContext: (options?: AgentRetrieveOptions) => Promise<AgentRetrieveResult>;
      retrieveMemoryRuntimeContext: (options?: AgentRetrieveOptions & { taskGoal?: string; threadId?: string | null; allowedKinds?: AgentRetrieveKind[] }) => Promise<RuntimeContextPacket>;
      activateMemoryRuntimeGraph: (options?: AgentRetrieveOptions & { taskGoal?: string; threadId?: string | null; maxNodes?: number; seedLimit?: number }) => Promise<MemoryGraph & { sync?: { nodes: number; edges: number; projectCount: number; projectPath?: string | null; limit: number } }>;
      retrieveMemoryRuntimePrecedent: (options?: { taskType?: string; task_type?: string; query?: string; projectPath?: string | null; parentCeoThreadId?: string | null; tokenBudget?: number; maxResults?: number; allowedKinds?: AgentRetrieveKind[] }) => Promise<RuntimeContextPacket>;
      recoverMemoryRuntimeThread: (options?: { threadId?: string | null; ceoThreadId?: string | null; title?: string; threadTitle?: string; query?: string; taskGoal?: string; projectPath?: string | null; tokenBudget?: number; maxResults?: number; replacementThreadId?: string | null; takeoverThreadId?: string | null; observeRuntimeEvent?: boolean }) => Promise<ThreadRecoveryPacket>;
      writebackMemoryRuntimeEvidence: (packet: EvidenceWritebackPacket) => Promise<EvidenceWritebackReceipt>;
      observeMemoryRuntimeEvent: (event: RuntimeEventMemoryInput) => Promise<RuntimeEventMemoryReceipt>;
      upsertWorkingMemory: (record: Partial<WorkingMemoryRecord> & { taskId: string }) => Promise<WorkingMemoryRecord>;
      listWorkingMemory: (options?: { status?: WorkingMemoryRecord["status"]; projectPath?: string | null; limit?: number }) => Promise<{ records: WorkingMemoryRecord[] }>;
      listFlowSkillCandidates: (options?: { status?: FlowSkillCandidateRecord["status"]; projectPath?: string | null; limit?: number }) => Promise<{ candidates: FlowSkillCandidateRecord[] }>;
      closeWorkingMemory: (options: { taskId: string; status?: WorkingMemoryRecord["status"]; nextAction?: string }) => Promise<WorkingMemoryRecord>;
      promoteMemory: (candidate: MemoryPromotionCandidate) => Promise<MemoryPromotionResult>;
      listRetrieveLogs: (options?: { limit?: number }) => Promise<{ logs: AgentRetrieveLogEntry[] }>;
      getRuntimeMonitorSnapshot: (options?: AgentRuntimeMonitorOptions) => Promise<AgentRuntimeMonitorSnapshot>;
      importAutoflowExperience: () => Promise<AutoflowImportResult>;
      getKnowledgeOverview: () => Promise<KnowledgeOverview>;
      listKnowledgeItems: (
        projectPath?: string | null,
        options?: { limit?: number },
      ) => Promise<{ items: KnowledgeItem[] }>;
      generateKnowledgeItems: (options?: {
        mode?: "heuristic" | "ai";
        projectPath?: string | null;
      }) => Promise<KnowledgeGenerateResult>;
      testAiProvider: () => Promise<AiProviderTestResult>;
      listZhixiaSkills: (options?: {
        skillId?: string;
        projectId?: string;
        limit?: number;
      }) => Promise<{ skills: ZhixiaSkillDefinition[]; receipts: SkillRunReceipt[] }>;
      runZhixiaSkill: (options?: {
        skillId?: string;
        name?: string;
        projectPath?: string | null;
        mode?: "heuristic" | "ai";
      }) => Promise<ZhixiaSkillRunResult>;
      getSkillStatus: () => Promise<SkillStatus>;
      installSkill: () => Promise<SkillStatus>;
      revealSkillsFolder: () => Promise<SkillStatus>;
      revealStore: () => Promise<{ storePath: string }>;
    };
  }
}
