const assert = require("node:assert/strict");
const path = require("node:path");

const {
  AGENT_RETRIEVE_ALLOWED_KINDS,
  assembleAgentRetrieveContractResult,
  buildAgentRetrieveCacheKey,
  collectAgentRetrieveContractSources,
  buildAgentRetrieveReadPlan,
  filterCEOFlowRecords,
  normalizeAgentTokenEstimate,
  normalizeAgentRetrieveRequest,
  trimAgentResultsToBudget,
} = require("../electron/agentRetrievePolicy.cjs");

assert.equal(normalizeAgentTokenEstimate(24.2), 25, "token estimates should round up");
assert.equal(normalizeAgentTokenEstimate(0), 80, "missing token estimates should fall back to a small safe estimate");
assert.ok(
  AGENT_RETRIEVE_ALLOWED_KINDS.includes("thread_lineage_index"),
  "retrieval allowed kinds should include explicit ThreadLineageIndex metadata",
);
assert.ok(
  AGENT_RETRIEVE_ALLOWED_KINDS.includes("tool_skill_record"),
  "retrieval allowed kinds should include bounded ToolSkillRecord inventory metadata",
);

const rankedItems = [
  { id: "a", tokenEstimate: 90 },
  { id: "b", tokenEstimate: 80 },
  { id: "c", tokenEstimate: 70 },
  { id: "d", tokenEstimate: 40 },
];

assert.deepEqual(
  trimAgentResultsToBudget(rankedItems, 160, 2),
  {
    items: [
      { id: "a", tokenEstimate: 90 },
      { id: "b", tokenEstimate: 80 },
    ],
    tokenEstimate: 170,
  },
  "retrieval trimming should respect maxResults and the 10 percent soft budget",
);

assert.deepEqual(
  trimAgentResultsToBudget(rankedItems, 120, 10),
  {
    items: [
      { id: "a", tokenEstimate: 90 },
      { id: "d", tokenEstimate: 40 },
    ],
    tokenEstimate: 130,
  },
  "retrieval trimming should skip over budget-heavy lower items but keep later fitting items",
);

assert.deepEqual(
  trimAgentResultsToBudget([{ id: "oversized", tokenEstimate: 800 }], 120, 3),
  {
    items: [{ id: "oversized", tokenEstimate: 800 }],
    tokenEstimate: 800,
  },
  "retrieval trimming should return at least the top item even when it exceeds budget",
);

const manyRankedItems = Array.from({ length: 20 }, (_, index) => ({
  id: `item-${index + 1}`,
  tokenEstimate: 40,
}));
assert.equal(
  trimAgentResultsToBudget(manyRankedItems, 4000, 5).items.length,
  5,
  "retrieval trimming should still enforce topK and never return an unbounded candidate set",
);

const workspacePath = path.resolve("C:/Users/example/Documents/demo-project");
const request = normalizeAgentRetrieveRequest(
  {
    query: "  CEO Flow handoff  ",
    queryType: "task_dispatch",
    projectPath: "C:/Users/example/Documents/demo-project",
    parentCeoThreadId: "019e-ceo",
    tokenBudget: 900,
    maxResults: 5,
    includeKinds: ["ceo_flow_record", "project_artifact", "document", "raw_session", "document"],
  },
  { resolveProjectPath: (value) => path.resolve(value) },
);
assert.equal(request.query, "CEO Flow handoff", "retrieval request should compact query text");
assert.equal(request.projectPath, workspacePath, "retrieval request should normalize project paths through the configured resolver");
assert.deepEqual(
  Array.from(request.allowedKinds).sort(),
  ["ceo_flow_record", "document", "project_artifact"],
  "retrieval request should dedupe allowed kinds and reject unsupported raw-session reads",
);

const readPlan = buildAgentRetrieveReadPlan(request);
assert.equal(readPlan.documents, "metadata_only", "document retrieval must use metadata-only reads");
assert.equal(readPlan.projectRecords, "metadata_only", "CEO flow retrieval should first build metadata-only ProjectRecords");
assert.equal(readPlan.knowledgeItems, "skip", "excluded kinds should not be read");

const artifactOnlyRequest = normalizeAgentRetrieveRequest({ includeKinds: ["project_artifact"] });
assert.equal(
  buildAgentRetrieveReadPlan(artifactOnlyRequest).documents,
  "metadata_only",
  "ProjectArtifact retrieval must also use document metadata-only reads",
);

const lineageOnlyRequest = normalizeAgentRetrieveRequest(
  {
    query: "lineage worker handoff",
    projectPath: "C:/Users/example/Documents/demo-project",
    parentCeoThreadId: "019e-ceo",
    includeKinds: ["thread_lineage_index", "raw_session"],
  },
  { resolveProjectPath: (value) => path.resolve(value) },
);
assert.deepEqual(
  Array.from(lineageOnlyRequest.allowedKinds),
  ["thread_lineage_index"],
  "ThreadLineageIndex retrieval should reject unsupported raw-session reads",
);
assert.equal(
  buildAgentRetrieveReadPlan(lineageOnlyRequest).projectRecords,
  "metadata_only",
  "ThreadLineageIndex retrieval must derive from metadata-only ProjectRecord/CEOFlow sources",
);

const toolSkillRecordRequest = normalizeAgentRetrieveRequest(
  {
    query: "workflow script safety",
    projectPath: workspacePath,
    includeKinds: ["tool_skill_record", "raw_session"],
    tokenBudget: 300,
    maxResults: 3,
  },
  { resolveProjectPath: (value) => path.resolve(value) },
);
assert.deepEqual(
  Array.from(toolSkillRecordRequest.allowedKinds),
  ["tool_skill_record"],
  "ToolSkillRecord retrieval should reject unsupported raw-session expansion",
);
assert.deepEqual(
  buildAgentRetrieveReadPlan(toolSkillRecordRequest),
  {
    projectRecords: "skip",
    documents: "skip",
    knowledgeItems: "skip",
    experienceCards: "skip",
    skillCandidates: "skip",
    toolSkillRecords: "compact_rows",
  },
  "ToolSkillRecord retrieval should use compact metadata rows without document or raw-session reads",
);

const toolSkillRecordSources = collectAgentRetrieveContractSources(toolSkillRecordRequest, {
  listToolSkillRecords: (projectPathValue, options) => {
    assert.equal(projectPathValue, workspacePath, "ToolSkillRecord source collection should stay project scoped");
    assert.equal(options.limit, 80, "ToolSkillRecord source collection should stay bounded");
    return [
      {
        id: "tool-1",
        name: "review-build.cjs",
        kind: "workflow_script",
        sourcePath: path.join(workspacePath, "scripts", "review-build.cjs"),
        summary: "Review build output without running deployment.",
        triggerPatterns: ["review build"],
        riskBoundaries: ["Manual review required before use."],
        safeCommands: ["node --check"],
        forbiddenCommands: ["automatic_execution", "credential_access"],
        installed: false,
        requiresHumanConfirmation: true,
        governance: {
          status: "confirmed",
          reviewState: "stale",
          recordContextHash: "record-context-v1",
        },
      },
    ];
  },
});
assert.deepEqual(
  toolSkillRecordSources.trace.map((entry) => `${entry.step}:${entry.mode}`),
  ["tool_skill_records:compact_rows_metadata_only"],
  "ToolSkillRecord retrieval should leave an explicit compact metadata trace",
);
assert.equal(toolSkillRecordSources.toolSkillRecords.length, 1, "ToolSkillRecord retrieval should return bounded record sources");

const toolSkillRecordResult = assembleAgentRetrieveContractResult(toolSkillRecordRequest, toolSkillRecordSources, {
  makeToolSkillRecord: (record) => ({
    id: `tool-skill-record:${record.id}`,
    kind: "tool_skill_record",
    title: `ToolSkillRecord: ${record.name}`,
    excerpt: "review_needed; advisory only; no install, enable, execute, or active promotion",
    sourcePath: record.sourcePath,
    sourceRefs: [{ kind: "tool_skill_record", path: record.sourcePath, title: record.name }],
    status: record.governance.reviewState === "stale" ? "review_needed" : record.governance.status,
    freshness: "review",
    score: 90,
    tokenEstimate: 72,
    whyMatched: [
      `governance:${record.governance.status}/${record.governance.reviewState}`,
      "policy:advisory-human-confirmation-required",
      "policy:no-install-enable-execute-or-active-promotion",
      "policy:metadata-only-no-sensitive-or-raw-session-body",
    ],
    requiresHumanConfirmation: true,
    rawSessionPolicy: "metadata_only_no_sensitive_or_raw_session_body",
  }),
  overallFreshness: () => "review",
});
assert.equal(toolSkillRecordResult.items[0].kind, "tool_skill_record", "ToolSkillRecord retrieval should assemble first-class retrieval items");
assert.equal(toolSkillRecordResult.items[0].status, "review_needed", "stale ToolSkillRecord governance should surface as review-needed");
assert.equal(toolSkillRecordResult.items[0].requiresHumanConfirmation, true, "ToolSkillRecord retrieval should stay human-confirmation gated");
assert.equal(
  toolSkillRecordResult.items[0].rawSessionPolicy,
  "metadata_only_no_sensitive_or_raw_session_body",
  "ToolSkillRecord retrieval should declare metadata-only and no raw-session body policy",
);
assert.ok(
  toolSkillRecordResult.items[0].whyMatched.includes("policy:no-install-enable-execute-or-active-promotion"),
  "ToolSkillRecord retrieval must preserve no-execution/no-promotion safety policy",
);

const ceoRecords = [
  { id: "a", ceoThreadId: "019e-ceo", workspacePaths: [workspacePath] },
  { id: "b", ceoThreadId: "019e-other", workspacePaths: [workspacePath] },
  { id: "c", ceoThreadId: "019e-ceo", workspacePaths: [path.resolve("C:/Users/example/Documents/other-project")] },
];
assert.deepEqual(
  filterCEOFlowRecords(ceoRecords, request).map((record) => record.id),
  ["a"],
  "CEO flow records should filter by parentCeoThreadId before expanding lineage results",
);

const contractProjectRecords = [
  {
    id: "project-alpha",
    rootPath: workspacePath,
    ownerThreadId: "019e-ceo",
    ceoThreadIds: ["019e-ceo"],
    workerThreadIds: ["019e-worker"],
    reviewerThreadIds: [],
  },
  {
    id: "project-beta",
    rootPath: path.resolve("C:/Users/example/Documents/other-project"),
    ownerThreadId: "019e-other",
    ceoThreadIds: ["019e-other"],
    workerThreadIds: ["019e-other-worker"],
    reviewerThreadIds: [],
  },
  {
    id: "project-gamma",
    rootPath: path.resolve("C:/Users/example/Documents/third-project"),
    ownerThreadId: "019e-third",
    ceoThreadIds: ["019e-third"],
    workerThreadIds: ["019e-third-worker"],
    reviewerThreadIds: [],
  },
];
const contractDocs = [
  { id: "doc-1", filePath: path.join(workspacePath, "docs", "PRD.md") },
  { id: "doc-2", filePath: path.join(workspacePath, "docs", "TECHNICAL_DESIGN.md") },
];
const callCounts = {
  buildProjectRecords: 0,
  buildCEOFlowRecords: 0,
  listDocumentMetas: 0,
  buildProjectArtifacts: 0,
};
let ceoFlowSeedRecordIds = [];
const contractRequest = normalizeAgentRetrieveRequest(
  {
    query: "CEO handoff 019e-ceo",
    queryType: "task_dispatch",
    projectPath: workspacePath,
    parentCeoThreadId: "019e-ceo",
    includeKinds: ["project_record", "ceo_flow_record", "project_artifact", "document", "raw_session"],
  },
  { resolveProjectPath: (value) => path.resolve(value) },
);
const contractSources = collectAgentRetrieveContractSources(contractRequest, {
  buildProjectRecords: () => {
    callCounts.buildProjectRecords += 1;
    return contractProjectRecords;
  },
  buildCEOFlowRecords: (records) => {
    callCounts.buildCEOFlowRecords += 1;
    ceoFlowSeedRecordIds = records.map((record) => record.id);
    return records.map((record) => ({
      id: `flow-${record.id}`,
      ceoThreadId: record.ownerThreadId,
      workspacePaths: [record.rootPath],
    }));
  },
  listDocumentMetas: () => {
    callCounts.listDocumentMetas += 1;
    return contractDocs;
  },
  buildProjectArtifacts: (docs, options) => {
    callCounts.buildProjectArtifacts += 1;
    assert.equal(docs, contractDocs, "ProjectArtifact contract should reuse the same metadata-only document list");
    assert.equal(options.projectPath, workspacePath, "ProjectArtifact contract should preserve the scoped projectPath");
    return docs.map((doc) => ({ id: `artifact-${doc.id}`, sourcePath: doc.filePath }));
  },
});

assert.equal(callCounts.buildProjectRecords, 1, "retrieval contract should build project metadata once");
assert.equal(callCounts.buildCEOFlowRecords, 1, "retrieval contract should expand CEO lineage once");
assert.equal(callCounts.listDocumentMetas, 1, "retrieval contract should read document metadata once even when document and artifact kinds are both requested");
assert.equal(callCounts.buildProjectArtifacts, 1, "retrieval contract should build ProjectArtifacts from the shared metadata-only document list");
assert.deepEqual(
  ceoFlowSeedRecordIds,
  ["project-alpha"],
  "retrieval contract should prefilter ProjectRecords by parentCeoThreadId and projectPath before CEO lineage expansion",
);
assert.deepEqual(
  contractSources.ceoFlowRecords.map((record) => record.id),
  ["flow-project-alpha"],
  "retrieval contract should not return unrelated CEO flow records after scoped lineage expansion",
);
assert.deepEqual(
  contractSources.documents,
  contractDocs,
  "retrieval contract should expose only metadata-only document rows for document reads",
);
assert.deepEqual(
  contractSources.projectArtifacts.map((artifact) => artifact.id),
  ["artifact-doc-1", "artifact-doc-2"],
  "retrieval contract should derive ProjectArtifacts from the bounded metadata-only document set",
);
assert.deepEqual(
  contractSources.trace.map((entry) => `${entry.step}:${entry.mode}`),
  [
    "project_records:metadata_only",
    "ceo_flow_seed_records:lineage_prefilter",
    "ceo_flow_records:filtered_lineage",
    "documents:metadata_only",
  ],
  "retrieval contract should prefer ProjectRecord and CEO lineage metadata before document-level reads",
);

const assembledRequest = {
  ...contractRequest,
  tokenBudget: 160,
  maxResults: 2,
};
const assembledResult = assembleAgentRetrieveContractResult(assembledRequest, contractSources, {
  makeProjectRecord: (record, activeRequest) => ({
    id: `project-record:${record.id}`,
    kind: "project_record",
    title: `ProjectRecord: ${record.id}`,
    sourcePath: record.rootPath,
    sourceRefs: [{ kind: "document", path: record.rootPath }],
    status: "active",
    freshness: "fresh",
    score: record.ownerThreadId === activeRequest.parentCeoThreadId ? 112 : 24,
    tokenEstimate: 78,
    whyMatched: [record.ownerThreadId === activeRequest.parentCeoThreadId ? "projectPath:exact" : "broader-project"],
    requiresHumanConfirmation: false,
    _sortUpdatedAt: "2026-06-13T10:00:00.000Z",
  }),
  makeCEOFlowRecord: (record, activeRequest) => ({
    id: `ceo-flow:${record.id}`,
    kind: "ceo_flow_record",
    title: `CEO Flow: ${record.id}`,
    sourcePath: record.workspacePaths[0] || "ceo-flow",
    sourceRefs: [{ kind: "ceo_flow_record", path: record.workspacePaths[0] || null }],
    status: "hot",
    freshness: "fresh",
    score: record.ceoThreadId === activeRequest.parentCeoThreadId ? 128 : 18,
    tokenEstimate: 82,
    whyMatched: [record.ceoThreadId === activeRequest.parentCeoThreadId ? "ceoThreadId:exact" : "broad-lineage"],
    requiresHumanConfirmation: false,
    _sortUpdatedAt: "2026-06-13T10:01:00.000Z",
  }),
  makeProjectArtifact: (artifact) => ({
    id: `artifact:${artifact.id}`,
    kind: "project_artifact",
    title: `Artifact: ${artifact.id}`,
    sourcePath: artifact.sourcePath,
    sourceRefs: [{ kind: "document", path: artifact.sourcePath }],
    status: "current",
    freshness: "review",
    score: 46,
    tokenEstimate: 64,
    whyMatched: ["metadata_only"],
    requiresHumanConfirmation: true,
    _sortUpdatedAt: "2026-06-13T09:59:00.000Z",
  }),
  makeDocument: (doc) => ({
    id: `document:${doc.id}`,
    kind: "document",
    title: `Document: ${doc.id}`,
    sourcePath: doc.filePath,
    sourceRefs: [{ kind: "document", path: doc.filePath }],
    status: "indexed",
    freshness: "review",
    score: 22,
    tokenEstimate: 40,
    whyMatched: ["metadata_only"],
    requiresHumanConfirmation: true,
    _sortUpdatedAt: "2026-06-13T09:58:00.000Z",
  }),
  overallFreshness: (items) => (items.every((item) => item.freshness === "fresh") ? "fresh" : "review"),
});

assert.equal(assembledResult.freshness, "fresh", "higher-level retrieval assembly should preserve overall freshness for bounded high-priority metadata results");
assert.equal(assembledResult.items.length, 2, "higher-level retrieval assembly should remain bounded by topK/token budget");
assert.deepEqual(
  assembledResult.items.map((item) => item.kind),
  ["ceo_flow_record", "project_record"],
  "higher-level retrieval assembly should rank CEO lineage and project metadata records ahead of lower-priority artifact/document results",
);
assert.deepEqual(
  assembledResult.items.map((item) => item.id),
  ["ceo-flow:flow-project-alpha", "project-record:project-alpha"],
  "higher-level retrieval assembly should return the matched CEO flow and project record payload before broader metadata rows",
);
assert.equal(assembledResult.tokenEstimate, 160, "higher-level retrieval assembly should trim to a bounded token estimate using the ranked metadata results");
assert.ok(
  assembledResult.items.every((item) => item.kind !== "raw_session"),
  "higher-level retrieval assembly should never surface raw-session results through the supported contract helper",
);

const lineageResult = assembleAgentRetrieveContractResult(lineageOnlyRequest, contractSources, {
  makeThreadLineageIndex: (record, activeRequest) => ({
    id: `lineage:${record.id}`,
    kind: "thread_lineage_index",
    title: `ThreadLineageIndex: ${record.id}`,
    sourcePath: record.workspacePaths[0] || "thread-lineage-index",
    sourceRefs: [{ kind: "thread_lineage_index", path: record.workspacePaths[0] || null }],
    status: "blocked",
    freshness: "review",
    score: record.ceoThreadId === activeRequest.parentCeoThreadId ? 130 : 20,
    tokenEstimate: 72,
    whyMatched: [
      record.ceoThreadId === activeRequest.parentCeoThreadId ? "parentCeoThreadId:exact" : "threadLineageIndex:first-layer",
      "policy:metadata-only-no-raw-session",
      "policy:no-archive-compact-restore-delete",
    ],
    requiresHumanConfirmation: true,
    rawSessionPolicy: "metadata_only_no_raw_body",
    _sortUpdatedAt: "2026-06-13T10:02:00.000Z",
  }),
  overallFreshness: () => "review",
});
assert.deepEqual(
  lineageResult.items.map((item) => item.kind),
  ["thread_lineage_index"],
  "ThreadLineageIndex retrieval should return explicit lineage metadata items",
);
assert.equal(lineageResult.items[0].rawSessionPolicy, "metadata_only_no_raw_body", "ThreadLineageIndex retrieval must declare no raw session body reads");
assert.ok(
  lineageResult.items[0].whyMatched.includes("policy:no-archive-compact-restore-delete"),
  "ThreadLineageIndex retrieval must preserve archive/compact/restore/delete mutation boundary",
);

let persistedLineageArgs = null;
const persistedLineageSources = collectAgentRetrieveContractSources(lineageOnlyRequest, {
  buildProjectRecords: () => contractProjectRecords,
  buildCEOFlowRecords: (records) => records.map((record) => ({
    id: `flow-${record.id}`,
    ceoThreadId: record.ownerThreadId,
    workspacePaths: [record.rootPath],
  })),
  listThreadLineageIndexRecords: (options) => {
    persistedLineageArgs = options;
    return [{
      id: "thread-lineage:persisted-alpha",
      kind: "thread_lineage_index",
      ceoThreadId: "019e-ceo",
      title: "ThreadLineageIndex: persisted alpha",
      workspacePaths: [workspacePath],
      sourceRefs: [{ kind: "thread_lineage_index", path: workspacePath }],
      relationshipCounts: { workers: 2, reviewers: 1, handoffs: 1 },
      governance: {
        rawSessionPolicy: "metadata_only_no_raw_body",
        mutationPolicy: "read_only_no_archive_compact_restore_delete",
      },
      persisted: true,
      updatedAt: "2026-06-13T10:03:00.000Z",
    }];
  },
});
assert.deepEqual(
  persistedLineageArgs,
  { projectPath: workspacePath, parentCeoThreadId: "019e-ceo", limit: 120 },
  "ThreadLineageIndex retrieval should request persisted lineage rows with scoped project/CEO metadata",
);
assert.deepEqual(
  persistedLineageSources.threadLineageIndexRecords.map((record) => record.id),
  ["thread-lineage:persisted-alpha"],
  "ThreadLineageIndex retrieval should prefer persisted metadata rows when available",
);
assert.ok(
  persistedLineageSources.trace.some((entry) => entry.step === "thread_lineage_index_records" && entry.mode === "persisted_metadata_only"),
  "ThreadLineageIndex retrieval trace should identify persisted metadata-only lineage",
);
const persistedLineageResult = assembleAgentRetrieveContractResult(lineageOnlyRequest, persistedLineageSources, {
  makeThreadLineageIndex: (record) => ({
    id: record.id,
    kind: "thread_lineage_index",
    title: record.title,
    sourcePath: record.workspacePaths[0],
    sourceRefs: record.sourceRefs,
    status: "candidate",
    freshness: "review",
    score: 130,
    tokenEstimate: 70,
    whyMatched: [
      record.persisted ? "persistence:sqlite-thread-lineage-index" : "persistence:runtime-metadata-fallback",
      "policy:metadata-only-no-raw-session",
      "policy:no-archive-compact-restore-delete",
    ],
    requiresHumanConfirmation: true,
    rawSessionPolicy: record.governance.rawSessionPolicy,
    _sortUpdatedAt: record.updatedAt,
  }),
  overallFreshness: () => "review",
});
assert.equal(persistedLineageResult.items[0].rawSessionPolicy, "metadata_only_no_raw_body", "persisted ThreadLineageIndex rows must preserve metadata-only raw-session policy");
assert.ok(
  persistedLineageResult.items[0].whyMatched.includes("persistence:sqlite-thread-lineage-index"),
  "persisted ThreadLineageIndex rows should surface SQLite provenance",
);

const countsV1 = {
  documents: [2, "2026-06-12T18:00:00.000Z"],
  knowledge: [1, "2026-06-12T18:00:00.000Z"],
  experience: [0, ""],
  skills: [0, ""],
  threadLineageIndex: [1, "2026-06-13T10:03:00.000Z"],
};
const countsV2 = { ...countsV1, documents: [3, "2026-06-12T18:01:00.000Z"] };
const countsV3 = { ...countsV1, threadLineageIndex: [2, "2026-06-13T10:04:00.000Z"] };
const keyA = buildAgentRetrieveCacheKey(request, countsV1);
const keyB = buildAgentRetrieveCacheKey(request, countsV1);
const keyC = buildAgentRetrieveCacheKey({ ...request, parentCeoThreadId: "019e-other" }, countsV1);
const keyD = buildAgentRetrieveCacheKey(request, countsV2);
const keyE = buildAgentRetrieveCacheKey(request, countsV3);
assert.equal(keyA, keyB, "cache key should be stable for the same request and SQLite metadata counts");
assert.notEqual(keyA, keyC, "cache key should vary by parentCeoThreadId");
assert.notEqual(keyA, keyD, "cache key should vary when SQLite metadata counts change");
assert.notEqual(keyA, keyE, "cache key should vary when persisted ThreadLineageIndex rows change");

console.log("Agent retrieval policy behavior tests passed.");
