const AGENT_RETRIEVE_DEFAULT_QUERY_TYPE = "task_dispatch";
const AGENT_RETRIEVE_DEFAULT_TOKEN_BUDGET = 1200;
const AGENT_RETRIEVE_MAX_RESULTS = 12;
const AGENT_RETRIEVE_ALLOWED_KINDS = [
  "project_record",
  "project_resume_packet",
  "ceo_flow_record",
  "thread_lineage_index",
  "project_artifact",
  "document",
  "knowledge_item",
  "experience_card",
  "skill_candidate",
  "tool_skill_record",
];
const AGENT_RETRIEVE_CACHE_TTL_MS = 90 * 1000;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactPolicyText(value, maxChars) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function normalizeAgentTokenEstimate(value) {
  const estimate = Math.ceil(Number(value || 0));
  return Number.isFinite(estimate) && estimate > 0 ? estimate : 80;
}

function normalizeAgentRetrieveRequest(options = {}, config = {}) {
  const allowedKinds = new Set(config.allowedKinds || AGENT_RETRIEVE_ALLOWED_KINDS);
  const includeKinds = safeArray(options.includeKinds)
    .filter((kind) => allowedKinds.has(kind))
    .filter((kind, index, array) => array.indexOf(kind) === index);
  const rawProjectPath = options.projectPath ? String(options.projectPath) : "";
  const projectPath = rawProjectPath && typeof config.resolveProjectPath === "function"
    ? config.resolveProjectPath(rawProjectPath)
    : rawProjectPath || null;

  return {
    query: compactPolicyText(options.query, 240),
    queryType: compactPolicyText(options.queryType || AGENT_RETRIEVE_DEFAULT_QUERY_TYPE, 60) || AGENT_RETRIEVE_DEFAULT_QUERY_TYPE,
    projectPath,
    parentCeoThreadId: compactPolicyText(options.parentCeoThreadId || options.ceoThreadId, 140) || null,
    tokenBudget: Math.max(200, Math.min(Number(options.tokenBudget || AGENT_RETRIEVE_DEFAULT_TOKEN_BUDGET), 4000)),
    maxResults: Math.max(1, Math.min(Number(options.maxResults || 8), AGENT_RETRIEVE_MAX_RESULTS)),
    allowedKinds: new Set(includeKinds.length > 0 ? includeKinds : Array.from(allowedKinds)),
  };
}

function buildAgentRetrieveCacheKey(request, counts = {}) {
  return JSON.stringify({
    queryType: request.queryType,
    query: request.query,
    projectPath: request.projectPath,
    parentCeoThreadId: request.parentCeoThreadId,
    tokenBudget: request.tokenBudget,
    maxResults: request.maxResults,
    allowedKinds: Array.from(request.allowedKinds || []).sort(),
    counts,
  });
}

function filterCEOFlowRecords(records, request) {
  return safeArray(records).filter((record) => {
    if (request.projectPath && !safeArray(record.workspacePaths).includes(request.projectPath)) return false;
    if (request.parentCeoThreadId && record.ceoThreadId !== request.parentCeoThreadId) return false;
    return true;
  });
}

function filterProjectRecordsForCEOFlow(records, request) {
  return safeArray(records).filter((record) => {
    if (request.projectPath && record.rootPath !== request.projectPath) return false;
    if (!request.parentCeoThreadId) return true;
    if (record.ownerThreadId === request.parentCeoThreadId) return true;
    const threadIds = [
      ...safeArray(record.ceoThreadIds),
      ...safeArray(record.workerThreadIds),
      ...safeArray(record.reviewerThreadIds),
    ];
    return threadIds.includes(request.parentCeoThreadId);
  });
}

function buildAgentRetrieveReadPlan(request) {
  return {
    projectRecords:
      request.allowedKinds.has("project_record") ||
      request.allowedKinds.has("project_resume_packet") ||
      request.allowedKinds.has("ceo_flow_record") ||
      request.allowedKinds.has("thread_lineage_index")
      ? "metadata_only"
      : "skip",
    documents: request.allowedKinds.has("document") || request.allowedKinds.has("project_artifact") ? "metadata_only" : "skip",
    knowledgeItems: request.allowedKinds.has("knowledge_item") ? "compact_rows" : "skip",
    experienceCards: request.allowedKinds.has("experience_card") ? "compact_rows" : "skip",
    skillCandidates: request.allowedKinds.has("skill_candidate") ? "compact_rows" : "skip",
    toolSkillRecords: request.allowedKinds.has("tool_skill_record") ? "compact_rows" : "skip",
  };
}

function collectAgentRetrieveContractSources(request, deps = {}) {
  const readPlan = buildAgentRetrieveReadPlan(request);
  const trace = [];
  const result = {
    readPlan,
    trace,
    projectRecords: [],
    ceoFlowSeedRecords: [],
    ceoFlowRecords: [],
    threadLineageIndexRecords: [],
    documents: [],
    projectArtifacts: [],
    knowledgeItems: [],
    experienceCards: [],
    skillCandidates: [],
    toolSkillRecords: [],
  };

  if (readPlan.projectRecords === "metadata_only") {
    trace.push({ step: "project_records", mode: "metadata_only" });
    result.projectRecords = safeArray(typeof deps.buildProjectRecords === "function" ? deps.buildProjectRecords() : []);
  }

  if (request.allowedKinds.has("ceo_flow_record") || request.allowedKinds.has("thread_lineage_index")) {
    result.ceoFlowSeedRecords = filterProjectRecordsForCEOFlow(result.projectRecords, request);
    trace.push({
      step: "ceo_flow_seed_records",
      mode: "lineage_prefilter",
      count: result.ceoFlowSeedRecords.length,
      parentCeoThreadId: request.parentCeoThreadId || null,
      projectPath: request.projectPath || null,
    });
    const ceoFlowRecords = safeArray(
      typeof deps.buildCEOFlowRecords === "function" ? deps.buildCEOFlowRecords(result.ceoFlowSeedRecords) : [],
    );
    result.ceoFlowRecords = filterCEOFlowRecords(ceoFlowRecords, request);
    trace.push({
      step: "ceo_flow_records",
      mode: "filtered_lineage",
      count: result.ceoFlowRecords.length,
    });
    if (request.allowedKinds.has("thread_lineage_index")) {
      const persistedLineage = typeof deps.listThreadLineageIndexRecords === "function"
        ? safeArray(deps.listThreadLineageIndexRecords({
          projectPath: request.projectPath,
          parentCeoThreadId: request.parentCeoThreadId,
          limit: 120,
        }))
        : [];
      result.threadLineageIndexRecords = persistedLineage.length > 0 ? persistedLineage : result.ceoFlowRecords;
      trace.push({
        step: "thread_lineage_index_records",
        mode: persistedLineage.length > 0 ? "persisted_metadata_only" : "runtime_metadata_fallback",
        count: result.threadLineageIndexRecords.length,
      });
    }
  }

  const shouldReadDocumentMetas =
    readPlan.documents === "metadata_only" &&
    (request.allowedKinds.has("document") || request.allowedKinds.has("project_artifact"));
  const documentMetas = shouldReadDocumentMetas && typeof deps.listDocumentMetas === "function"
    ? safeArray(deps.listDocumentMetas())
    : [];
  if (shouldReadDocumentMetas) {
    trace.push({ step: "documents", mode: "metadata_only", count: documentMetas.length });
  }
  if (request.allowedKinds.has("document")) {
    result.documents = documentMetas;
  }
  if (request.allowedKinds.has("project_artifact")) {
    result.projectArtifacts = safeArray(
      typeof deps.buildProjectArtifacts === "function"
        ? deps.buildProjectArtifacts(documentMetas, { projectPath: request.projectPath, maxArtifacts: 120 })
        : [],
    );
  }
  if (request.allowedKinds.has("knowledge_item")) {
    result.knowledgeItems = safeArray(
      typeof deps.listKnowledgeItems === "function" ? deps.listKnowledgeItems(request.projectPath, { limit: 180 }) : [],
    );
  }
  if (request.allowedKinds.has("experience_card")) {
    result.experienceCards = safeArray(
      typeof deps.listExperienceCards === "function"
        ? deps.listExperienceCards(request.projectPath, { includeGlobal: Boolean(request.projectPath), limit: 140 })
        : [],
    );
  }
  if (request.allowedKinds.has("skill_candidate")) {
    result.skillCandidates = safeArray(
      typeof deps.listSkillCandidates === "function"
        ? request.projectPath
          ? deps.listSkillCandidates(request.projectPath, { limit: 80 })
          : deps.listSkillCandidates(null, { limit: 80 })
        : [],
    );
  }
  if (request.allowedKinds.has("tool_skill_record")) {
    result.toolSkillRecords = safeArray(
      typeof deps.listToolSkillRecords === "function" && request.projectPath
        ? deps.listToolSkillRecords(request.projectPath, { limit: 80 })
        : [],
    );
    trace.push({
      step: "tool_skill_records",
      mode: "compact_rows_metadata_only",
      count: result.toolSkillRecords.length,
      projectPath: request.projectPath || null,
    });
  }

  return result;
}

function sortAndStripAgentRetrieveItems(items) {
  return safeArray(items)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b._sortUpdatedAt || 0).getTime() - new Date(a._sortUpdatedAt || 0).getTime();
    })
    .map(({ _sortUpdatedAt, ...item }) => item);
}

function queryTypeAllowsColdLayer(queryType) {
  return [
    "thread_recovery",
    "archive_candidate",
    "runtime_diagnosis",
    "old_thread_continuity",
    "history_audit",
  ].includes(String(queryType || "").trim());
}

function filterColdLayerForQueryType(items, request) {
  if (queryTypeAllowsColdLayer(request.queryType)) return safeArray(items);
  return safeArray(items).filter((item) => item.memoryLayer !== "cold");
}

function buildAgentRetrieveCandidatePool(request, contractSources = {}, deps = {}) {
  const allItems = [];
  const pushBuiltItems = (records, buildItem, options = {}) => {
    if (typeof buildItem !== "function") return;
    for (const record of safeArray(records)) {
      if (options.projectScoped && request.projectPath && record.rootPath !== request.projectPath) continue;
      allItems.push(buildItem(record, request));
    }
  };

  if (request.allowedKinds.has("project_record")) {
    pushBuiltItems(contractSources.projectRecords, deps.makeProjectRecord, { projectScoped: true });
  }
  if (request.allowedKinds.has("project_resume_packet")) {
    pushBuiltItems(contractSources.projectRecords, deps.makeProjectResumePacket, { projectScoped: true });
  }
  if (request.allowedKinds.has("ceo_flow_record")) {
    pushBuiltItems(contractSources.ceoFlowRecords, deps.makeCEOFlowRecord);
  }
  if (request.allowedKinds.has("thread_lineage_index")) {
    const lineageRecords = safeArray(contractSources.threadLineageIndexRecords).length > 0
      ? contractSources.threadLineageIndexRecords
      : contractSources.ceoFlowRecords;
    pushBuiltItems(lineageRecords, deps.makeThreadLineageIndex);
  }
  if (request.allowedKinds.has("project_artifact")) {
    for (const artifact of safeArray(contractSources.projectArtifacts)) {
      if (typeof deps.makeProjectArtifact !== "function") break;
      allItems.push(deps.makeProjectArtifact(artifact, request));
    }
  }
  if (request.allowedKinds.has("document")) {
    for (const doc of safeArray(contractSources.documents)) {
      if (typeof deps.makeDocument !== "function") break;
      allItems.push(deps.makeDocument(doc, request));
    }
  }
  if (request.allowedKinds.has("knowledge_item")) {
    for (const item of safeArray(contractSources.knowledgeItems)) {
      if (typeof deps.makeKnowledgeItem !== "function") break;
      allItems.push(deps.makeKnowledgeItem(item, request));
    }
  }
  if (request.allowedKinds.has("experience_card")) {
    for (const card of safeArray(contractSources.experienceCards)) {
      if (typeof deps.makeExperienceCard !== "function") break;
      allItems.push(deps.makeExperienceCard(card, request));
    }
  }
  if (request.allowedKinds.has("skill_candidate")) {
    for (const candidate of safeArray(contractSources.skillCandidates)) {
      if (typeof deps.makeSkillCandidate !== "function") break;
      allItems.push(deps.makeSkillCandidate(candidate, request));
    }
  }
  if (request.allowedKinds.has("tool_skill_record")) {
    for (const record of safeArray(contractSources.toolSkillRecords)) {
      if (typeof deps.makeToolSkillRecord !== "function") break;
      allItems.push(deps.makeToolSkillRecord(record, request));
    }
  }

  return filterColdLayerForQueryType(sortAndStripAgentRetrieveItems(allItems), request);
}

function assembleAgentRetrieveContractResult(request, contractSources = {}, deps = {}) {
  const sortedItems = buildAgentRetrieveCandidatePool(request, contractSources, deps);
  const trimmed = trimAgentResultsToBudget(sortedItems, request.tokenBudget, request.maxResults);
  return {
    items: trimmed.items,
    tokenEstimate: trimmed.tokenEstimate,
    freshness: typeof deps.overallFreshness === "function" ? deps.overallFreshness(trimmed.items) : "fresh",
  };
}

function trimAgentResultsToBudget(items, tokenBudget, maxResults) {
  const sourceItems = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.floor(Number(maxResults) || 1));
  const budget = Math.max(120, Math.floor(Number(tokenBudget) || 120));
  const softBudget = Math.max(120, Math.round(budget * 1.1));
  const chosen = [];
  let total = 0;

  for (const item of sourceItems) {
    if (chosen.length >= limit) break;
    const tokenEstimate = normalizeAgentTokenEstimate(item?.tokenEstimate);
    if (chosen.length > 0 && total + tokenEstimate > softBudget) continue;
    chosen.push({ ...item, tokenEstimate });
    total += tokenEstimate;
  }

  if (chosen.length === 0 && sourceItems[0]) {
    const tokenEstimate = normalizeAgentTokenEstimate(sourceItems[0].tokenEstimate);
    chosen.push({ ...sourceItems[0], tokenEstimate });
    total = tokenEstimate;
  }

  return { items: chosen, tokenEstimate: total };
}

module.exports = {
  AGENT_RETRIEVE_ALLOWED_KINDS,
  AGENT_RETRIEVE_CACHE_TTL_MS,
  AGENT_RETRIEVE_DEFAULT_QUERY_TYPE,
  AGENT_RETRIEVE_DEFAULT_TOKEN_BUDGET,
  AGENT_RETRIEVE_MAX_RESULTS,
  assembleAgentRetrieveContractResult,
  buildAgentRetrieveCandidatePool,
  buildAgentRetrieveCacheKey,
  collectAgentRetrieveContractSources,
  buildAgentRetrieveReadPlan,
  filterColdLayerForQueryType,
  filterProjectRecordsForCEOFlow,
  filterCEOFlowRecords,
  normalizeAgentTokenEstimate,
  queryTypeAllowsColdLayer,
  normalizeAgentRetrieveRequest,
  trimAgentResultsToBudget,
};
