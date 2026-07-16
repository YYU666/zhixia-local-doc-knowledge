const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const isPublicSourceStaging = fs.existsSync(path.join(root, "PUBLIC_STAGING_MANIFEST.md"));
function readTextIfExists(...parts) {
  const filePath = path.join(root, ...parts);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const main = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
const agentRetrievePolicy = fs.readFileSync(path.join(root, "electron", "agentRetrievePolicy.cjs"), "utf8");
const memoryRuntimePolicy = fs.readFileSync(path.join(root, "electron", "memoryRuntimePolicy.cjs"), "utf8");
const memoryCoreRuntime = fs.readFileSync(path.join(root, "electron", "memoryCoreRuntime.cjs"), "utf8");
const codexAutoIngestPolicy = fs.readFileSync(path.join(root, "electron", "codexThreadHistoryAutoIngestPolicy.cjs"), "utf8");
const documentMetadataPolicy = fs.readFileSync(path.join(root, "electron", "documentMetadataPolicy.cjs"), "utf8");
const databaseStartupPolicy = fs.readFileSync(path.join(root, "electron", "databaseStartupPolicy.cjs"), "utf8");
const projectMemoryBackfillPolicy = fs.readFileSync(path.join(root, "electron", "projectMemoryBackfillPolicy.cjs"), "utf8");
const projectArtifactPolicy = fs.readFileSync(path.join(root, "electron", "projectArtifactPolicy.cjs"), "utf8");
const agentRuntimeMonitorPolicy = fs.readFileSync(path.join(root, "electron", "agentRuntimeMonitorPolicy.cjs"), "utf8");
const runtimeMonitorAdapter = fs.readFileSync(path.join(root, "electron", "runtimeMonitorAdapter.cjs"), "utf8");
const ceoMemoryRuntimeGuardPolicy = fs.readFileSync(path.join(root, "electron", "ceoMemoryRuntimeGuardPolicy.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
const viteEnv = fs.readFileSync(path.join(root, "src", "vite-env.d.ts"), "utf8");
const appTsx = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
const securityDoc = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
const contributingDoc = fs.readFileSync(path.join(root, "CONTRIBUTING.md"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const prd = fs.readFileSync(path.join(root, "docs", "PRD.md"), "utf8");
const technicalDesign = fs.readFileSync(path.join(root, "docs", "TECHNICAL_DESIGN.md"), "utf8");
const testPlan = fs.readFileSync(path.join(root, "docs", "TEST_PLAN.md"), "utf8");
const ceoFlowMemoryRuntimeDoc = fs.readFileSync(path.join(root, "docs", "CEO_FLOW_MEMORY_RUNTIME.md"), "utf8");
const publicationChecklist = fs.readFileSync(path.join(root, "docs", "PUBLICATION_CHECKLIST.md"), "utf8");
const publicRepoLayout = fs.readFileSync(path.join(root, "docs", "PUBLIC_REPO_LAYOUT.md"), "utf8");
const codexOptimizationMonitor = readTextIfExists("docs", "CODEX_OPTIMIZATION_MONITOR.md");
const freshUserValidationDoc = readTextIfExists("docs", "FRESH_USER_RELEASE_VALIDATION.md");
const freshUserValidationScript = readTextIfExists("scripts", "validate-fresh-user-release.ps1");
const preparePublicRepoScript = fs.readFileSync(path.join(root, "scripts", "prepare-public-repo.cjs"), "utf8");
const applyWindowsIconScript = readTextIfExists("scripts", "apply-windows-icon.cjs");
const packageFreshUserValidationScript = readTextIfExists("scripts", "package-fresh-user-validation.ps1");
const verifyFreshUserBundleScript = readTextIfExists("scripts", "verify-fresh-user-bundle.ps1");
const verifyFreshUserEvidenceScript = readTextIfExists("scripts", "verify-fresh-user-evidence.ps1");
const acceptFreshUserReturnEvidenceScript = readTextIfExists("scripts", "accept-fresh-user-return-evidence.ps1");
const acceptFreshUserReturnEvidenceBatch = readTextIfExists("scripts", "accept-fresh-user-return-evidence.bat");
const acceptFreshUserReturnHereScript = readTextIfExists("scripts", "accept-fresh-user-return-here.ps1");
const acceptFreshUserReturnHereBatch = readTextIfExists("scripts", "ACCEPT_RETURN_HERE.bat");
const installerIncludePath = path.join(root, "build", "installer.nsh");
const installerInclude = fs.existsSync(installerIncludePath) ? fs.readFileSync(installerIncludePath, "utf8") : "";
const guardianScriptPath = process.env.ZHIXIA_CODEX_GUARDIAN_SCRIPT || "";
const guardianScript = fs.existsSync(guardianScriptPath) ? fs.readFileSync(guardianScriptPath, "utf8") : "";

assert.match(main, /const MAX_DOCUMENT_VERSIONS_PER_DOCUMENT = 3/, "Document version history must stay capped to prevent repeated scan bloat");
assert.match(main, /const MAX_DOCUMENT_CONTENT_TEXT_CHARS = 60000/, "Document content stored in SQLite must stay compact enough for sql.js export/save");
assert.match(main, /CONTENT_STORE_COMPACTION_VERSION/, "Legacy oversized document content must have a versioned compaction migration");
assert.match(main, /backupDatabaseBeforeCompaction/, "Legacy content compaction must create a database backup before mutating stored document text");
assert.match(main, /async function backupUnreadableDatabaseFile/, "Unreadable existing SQLite databases must be backed up before startup fails");
assert.match(main, /openKnowledgeDatabaseFromFile[\s\S]*readFile: fs\.readFile[\s\S]*backupUnreadableDatabaseFile/, "ensureDatabase must route database startup through the testable unreadable-DB safety policy");
assert.match(databaseStartupPolicy, /db\.exec\("PRAGMA schema_version"\)/, "Database startup policy must validate existing SQLite bytes before migration can mutate the store");
assert.match(databaseStartupPolicy, /backupUnreadableDatabaseFile[\s\S]*refused to replace an unreadable knowledge-store\.sqlite/, "Database startup policy must back up unreadable existing databases and fail hard");
assert.match(databaseStartupPolicy, /error\?\.code === "ENOENT"[\s\S]*new Runtime\.Database\(\)/, "Database startup policy must only create an empty DB for first-start ENOENT");
assert.match(pkg.scripts.test, /database-startup-policy\.test\.cjs/, "Default npm test must include unreadable/corrupt database startup behavior coverage");
assert.match(main, /duplicateOf IS NOT NULL[\s\S]*contentText = ''/, "Duplicate document rows must not keep redundant full contentText payloads");
assert.match(main, /substr\(contentText, 1, \$limit\)/, "Oversized legacy document contentText must be trimmed to the current compact limit");
assert.match(main, /GENERATED_CONTEXT_VERSION_RE[\s\S]*\.codex-knowledge[\s\S]*codex-history-vault/, "Generated Zhixia context and thread-vault files must be excluded from version snapshots");
assert.match(main, /function shouldSkipDocumentVersion\(doc\)[\s\S]*GENERATED_CONTEXT_VERSION_RE\.test\(filePath\)[\s\S]*doc\.sourceType === "codex_context"[\s\S]*isGeneratedKnowledgeArtifact\(filePath\)/, "Generated context artifacts must not be stored in document_versions");
assert.match(main, /DELETE FROM document_versions[\s\S]*ORDER BY versionNo DESC[\s\S]*LIMIT \$limit[\s\S]*MAX_DOCUMENT_VERSIONS_PER_DOCUMENT/, "recordDocumentVersion must trim old document_versions after inserting a snapshot");
assert.match(main, /function hasSkippedScanSegment\(filePath\)[\s\S]*split\(\//, "Workspace scanning must skip noisy directories by any path segment, not only the current folder name");
assert.match(main, /SKIPPED_SCAN_DIRS[\s\S]*"site-packages"[\s\S]*"checkpoint"[\s\S]*"\.codex-knowledge"/, "Dependency, checkpoint, cache, and generated context directories must be excluded from scans");
assert.match(main, /scanDirectory[\s\S]*hasSkippedScanSegment\(fullPath\)/, "Recursive file scan must apply full-path skipped-segment filtering");
assert.match(main, /discoverProjectRoots[\s\S]*hasSkippedScanSegment\(nextPath\)/, "Project discovery must not promote dependency/cache/generated folders into projects");

function buildProjectArtifactsSnapshotStateEvaluator(source) {
  const stateMatch = source.match(
    /const projectArtifactsConfirmed = Boolean\(\r?\n([\s\S]*?)\r?\n\s*\);\r?\n\s*const projectArtifactsMapStatus: ProjectArtifactMapStatus =\r?\n([\s\S]*?)\r?\n\r?\n\s*const projectResumeConfirmation/,
  );
  assert.ok(stateMatch, "App.tsx must keep an extractable ProjectArtifact snapshot state block");
  const [, confirmedExpression, rawStatusExpression] = stateMatch;
  const statusExpression = rawStatusExpression.replace(/;\s*$/, "");
  return new Function(
    "input",
    `"use strict";
const {
  projectArtifactConfirmation,
  projectArtifactsMarkdownDoc,
  projectArtifactsJsonDoc,
} = input;
const projectArtifactsConfirmed = Boolean(
${confirmedExpression}
);
const projectArtifactsMapStatus =
${statusExpression}
;
return { projectArtifactsConfirmed, projectArtifactsMapStatus };`,
  );
}

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${functionName} must have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  throw new Error(`${functionName} body was not closed`);
}

function buildProjectRecordRetrieveEvaluator(source) {
  const fnSource = extractFunctionSource(source, "makeAgentRetrieveProjectRecord");
  return new Function(
    "record",
    `"use strict";
const AGENT_RETRIEVE_ITEM_EXCERPT_CHARS = 360;
function tokenizeAgentQuery(value) {
  return String(value || "").toLowerCase().split(/[^a-z0-9\\u4e00-\\u9fff]+/).filter(Boolean);
}
function compactText(value, maxLength) {
  const text = String(value || "").replace(/\\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}
function scoreTokens() {
  return 0;
}
function estimateAgentTokens(value) {
  return Math.max(32, Math.ceil(String(value || "").length / 4));
}
function whyMatchedForText(_tokens, _fields, reasons) {
  return reasons.filter(Boolean);
}
${fnSource}
return makeAgentRetrieveProjectRecord(record, { query: "zhixia", projectPath: record.rootPath });`,
  );
}

const evaluateProjectArtifactsSnapshotState = buildProjectArtifactsSnapshotStateEvaluator(appTsx);

function buildToolSkillInventoryConfirmationStatusEvaluator(source) {
  const match = source.match(
    /(function toolSkillInventoryConfirmationStatus\(result, confirmation\) \{[\s\S]*?\n\})\r?\n\r?\nasync function getToolSkillInventoryForProject/,
  );
  assert.ok(match, "main.cjs must keep an extractable Tool/Skill inventory confirmation status function");
  const [, functionSource] = match;
  return new Function(
    "input",
    `"use strict";
${functionSource}
return toolSkillInventoryConfirmationStatus(input.result, input.confirmation);`,
  );
}

const evaluateToolSkillInventoryConfirmationStatus = buildToolSkillInventoryConfirmationStatusEvaluator(main);

function buildToolSkillInventoryHashEvaluator(source) {
  const match = source.match(
    /(function resolveToolSkillInventorySnapshotHash\(snapshot\) \{[\s\S]*?\n\})\r?\n\r?\nfunction toolSkillInventoryConfirmationStatus/,
  );
  assert.ok(match, "main.cjs must keep an extractable Tool/Skill inventory snapshot hash resolver");
  const [, functionSource] = match;
  return new Function(
    "input",
    `"use strict";
function buildStableToolSkillInventoryHash(snapshot) {
  return "live:" + snapshot.inventory.id + ":" + snapshot.records.map((record) => record.id).join(",");
}
function hashText() {
  throw new Error("exported file hashes must not drive Tool/Skill inventory confirmation state");
}
${functionSource}
return resolveToolSkillInventorySnapshotHash(input.snapshot, input.files);`,
  );
}

const evaluateToolSkillInventorySnapshotHash = buildToolSkillInventoryHashEvaluator(main);

function buildExperienceCardRetrieveMetaEvaluator(source) {
  const match = source.match(
    /((?:function normalizeExperienceCardRetrieveMeta\(value = \{\}\) \{[\s\S]*?\n\}))\r?\n\r?\nfunction rowToExperienceCard/,
  );
  assert.ok(match, "main.cjs must keep an extractable normalizeExperienceCardRetrieveMeta seam");
  const [, functionSource] = match;
  return new Function(
    "input",
    `"use strict";
${functionSource}
return normalizeExperienceCardRetrieveMeta(input);`,
  );
}

const evaluateExperienceCardRetrieveMeta = buildExperienceCardRetrieveMetaEvaluator(main);

const confirmedArtifactSnapshot = {
  projectArtifactConfirmation: {
    confirmedAt: "2026-06-13T10:00:00.000Z",
    markdownDocumentId: "artifacts-md-1",
    markdownContentHash: "hash-md-1",
    markdownUpdatedAt: "2026-06-13T09:58:00.000Z",
    jsonDocumentId: "artifacts-json-1",
    jsonContentHash: "hash-json-1",
    jsonUpdatedAt: "2026-06-13T09:59:00.000Z",
  },
  projectArtifactsMarkdownDoc: {
    id: "artifacts-md-1",
    contentHash: "hash-md-1",
    updatedAt: "2026-06-13T09:58:00.000Z",
  },
  projectArtifactsJsonDoc: {
    id: "artifacts-json-1",
    contentHash: "hash-json-1",
    updatedAt: "2026-06-13T09:59:00.000Z",
  },
};

assert.deepEqual(
  evaluateProjectArtifactsSnapshotState(confirmedArtifactSnapshot),
  {
    projectArtifactsConfirmed: true,
    projectArtifactsMapStatus: "confirmed",
  },
  "ProjectArtifact snapshot state should stay confirmed only while md/json metadata still matches the confirmed snapshot",
);

assert.deepEqual(
  evaluateProjectArtifactsSnapshotState({
    ...confirmedArtifactSnapshot,
    projectArtifactsMarkdownDoc: {
      ...confirmedArtifactSnapshot.projectArtifactsMarkdownDoc,
      id: "artifacts-md-2",
    },
  }),
  {
    projectArtifactsConfirmed: false,
    projectArtifactsMapStatus: "re_review_required",
  },
  "ProjectArtifact snapshot state should fall back to re_review_required when the markdown document id drifts",
);

assert.deepEqual(
  evaluateProjectArtifactsSnapshotState({
    ...confirmedArtifactSnapshot,
    projectArtifactsJsonDoc: {
      ...confirmedArtifactSnapshot.projectArtifactsJsonDoc,
      contentHash: "hash-json-2",
    },
  }),
  {
    projectArtifactsConfirmed: false,
    projectArtifactsMapStatus: "re_review_required",
  },
  "ProjectArtifact snapshot state should fall back to re_review_required when the json content hash drifts",
);

assert.deepEqual(
  evaluateProjectArtifactsSnapshotState({
    ...confirmedArtifactSnapshot,
    projectArtifactsMarkdownDoc: {
      ...confirmedArtifactSnapshot.projectArtifactsMarkdownDoc,
      updatedAt: "2026-06-13T10:05:00.000Z",
    },
  }),
  {
    projectArtifactsConfirmed: false,
    projectArtifactsMapStatus: "re_review_required",
  },
  "ProjectArtifact snapshot state should fall back to re_review_required when the markdown updatedAt drifts",
);

const toolInventoryResult = {
  snapshotHash: "inventory-hash-1",
  records: [{ id: "tool-1" }],
  files: {
    markdown: { exists: true },
    json: { exists: true },
  },
};

assert.equal(
  evaluateToolSkillInventorySnapshotHash({
    snapshot: { inventory: { id: "inventory-live" }, records: [{ id: "tool-live-1" }] },
    files: {
      markdown: { exists: true, hash: "stale-export-md" },
      json: { exists: true, hash: "stale-export-json" },
    },
  }),
  "live:inventory-live:tool-live-1",
  "Tool/Skill inventory confirmation hash must be derived from the displayed live snapshot, not stale exported md/json files",
);

assert.equal(
  evaluateToolSkillInventoryConfirmationStatus({
    result: { ...toolInventoryResult, records: [], files: { markdown: { exists: false }, json: { exists: false } } },
    confirmation: null,
  }),
  "missing",
  "Tool/Skill inventory state should be missing when no records or exported md/json files exist",
);

assert.equal(
  evaluateToolSkillInventoryConfirmationStatus({ result: toolInventoryResult, confirmation: null }),
  "unconfirmed",
  "Tool/Skill inventory state should require confirmation for a new snapshot",
);

assert.equal(
  evaluateToolSkillInventoryConfirmationStatus({
    result: toolInventoryResult,
    confirmation: { status: "confirmed", confirmedAt: "2026-06-13T10:00:00.000Z", snapshotHash: "inventory-hash-1" },
  }),
  "confirmed",
  "Tool/Skill inventory state should stay confirmed only while the snapshot hash matches",
);

assert.equal(
  evaluateToolSkillInventoryConfirmationStatus({
    result: toolInventoryResult,
    confirmation: { status: "confirmed", confirmedAt: "2026-06-13T10:00:00.000Z", snapshotHash: "inventory-hash-0" },
  }),
  "re_review_required",
  "Tool/Skill inventory state should require re-review when the snapshot hash changes",
);

const normalizedExperienceMeta = evaluateExperienceCardRetrieveMeta({
  contractVersion: "project_doc_backfill_v2",
  freshness: "review",
  requiresHumanConfirmation: true,
  reviewReason: "automatic_project_doc_backfill",
  rawSessionPolicy: "explicit_only",
  tokenEstimate: 91,
  sourceDocumentId: "prd-1",
  sourceDocumentUpdatedAt: "2026-06-12T18:00:00.000Z",
  memoryType: "decision",
  sourceSignature: "sig-current",
  confirmedSourceSignature: "sig-current",
  sourceSignatureReviewState: "current",
  curationDecision: "keep",
  duplicateGroupKey: "same-source:zhixia:project_doc:decision:hash-prd",
  duplicateState: "kept",
  duplicateOf: "experience-old",
  duplicateCount: 2,
  duplicateIds: ["experience-old", "experience-older"],
  suggestedMergeTargetId: "experience-old",
  reviewedAt: "2026-06-12T19:00:00.000Z",
  sourceRefs: [
    {
      kind: "document",
      path: "C:\\Users\\example\\Documents\\zhixia\\docs\\PRD.md",
      title: "知匣 PRD",
      hash: "hash-prd",
      updatedAt: "2026-06-12T18:00:00.000Z",
      artifactType: "prd",
      sourceType: "codex_output",
    },
  ],
});
assert.equal(normalizedExperienceMeta.contractVersion, "project_doc_backfill_v2", "experience-card retrieve meta should preserve contract version");
assert.equal(normalizedExperienceMeta.freshness, "review", "experience-card retrieve meta should preserve review freshness");
assert.equal(normalizedExperienceMeta.requiresHumanConfirmation, true, "experience-card retrieve meta should preserve human confirmation requirement");
assert.equal(normalizedExperienceMeta.rawSessionPolicy, "explicit_only", "experience-card retrieve meta should preserve raw session policy");
assert.equal(normalizedExperienceMeta.tokenEstimate, 91, "experience-card retrieve meta should preserve token estimate");
assert.equal(normalizedExperienceMeta.sourceDocumentId, "prd-1", "experience-card retrieve meta should preserve source document id");
assert.equal(normalizedExperienceMeta.sourceDocumentUpdatedAt, "2026-06-12T18:00:00.000Z", "experience-card retrieve meta should preserve source document updatedAt");
assert.equal(normalizedExperienceMeta.sourceSignatureReviewState, "current", "experience-card retrieve meta should preserve source-signature review state");
assert.equal(normalizedExperienceMeta.curationDecision, "keep", "experience-card retrieve meta should preserve curation decisions");
assert.equal(normalizedExperienceMeta.duplicateState, "kept", "experience-card retrieve meta should preserve duplicate governance state");
assert.equal(normalizedExperienceMeta.duplicateCount, 2, "experience-card retrieve meta should preserve duplicate counts");
assert.equal(normalizedExperienceMeta.suggestedMergeTargetId, "experience-old", "experience-card retrieve meta should preserve suggested merge target");
assert.equal(normalizedExperienceMeta.reviewedAt, "2026-06-12T19:00:00.000Z", "experience-card retrieve meta should preserve reviewedAt");
assert.equal(normalizedExperienceMeta.sourceRefs[0].path, "C:\\Users\\example\\Documents\\zhixia\\docs\\PRD.md", "experience-card retrieve meta should preserve exact sourceRef paths");
assert.equal(normalizedExperienceMeta.sourceRefs[0].artifactType, "prd", "experience-card retrieve meta should preserve sourceRef artifactType");
assert.equal(normalizedExperienceMeta.sourceRefs[0].sourceType, "codex_output", "experience-card retrieve meta should preserve sourceRef sourceType");

assert.ok(pkg.dependencies["sql.js"], "SQLite storage must use sql.js");
assert.ok(!pkg.dependencies.xlsx, "Do not add the high-risk xlsx parser without a security review");
assert.ok(!pkg.dependencies.exceljs, "Do not add exceljs without a security review");
assert.notEqual(pkg.author, "office_test", "package metadata should not keep a personal placeholder author");

assert.match(main, /knowledge-store\.sqlite/, "main process should persist to SQLite");
assert.match(main, /dbSaveQueue = Promise\.resolve\(\)/, "database saves must be serialized to avoid temp-file rename races");
assert.match(main, /crypto\.randomUUID\(\)\}\.tmp/, "database saves must use unique temp files instead of one shared sqlite.tmp path");
assert.match(main, /documents:importFolder/, "folder import IPC must be registered");
assert.match(main, /scanDirectory/, "recursive folder scanning must exist");
assert.match(main, /documents:checkChanges/, "file change detection IPC must be registered");
assert.match(main, /autoWatchChanges/, "background file watcher setting must exist");
assert.match(main, /fsNative\.watch/, "background file watcher must use fs.watch");
assert.match(main, /documents:watchUpdate/, "renderer must receive background watcher updates");
assert.match(main, /function scheduleWatchRefresh\(reason\)[\s\S]*try \{[\s\S]*settings = getSettings\(\)[\s\S]*disableFileWatchAfterFailure\(error\)/, "watch refresh must not let settings/database read failures crash the main process");
assert.match(main, /fsNative\.watch[\s\S]*\(eventType, fileName\) => \{[\s\S]*try \{[\s\S]*scheduleWatchRefresh/, "file watcher callback must guard refresh scheduling errors");
assert.match(main, /documents:watchStatus/, "background watcher status IPC must be registered");
assert.match(main, /DOCUMENT_LIST_CONTENT_CHARS/, "document list queries must cap contentText for large libraries");
assert.match(main, /documentMetadataPolicy\.cjs/, "document metadata SQL policy should live outside main for behavior tests");
assert.match(documentMetadataPolicy, /'' AS contentText/, "metadata policy must support contentText-free document reads");
assert.match(documentMetadataPolicy, /substr\(contentText, 1, \$\{contentLimit\}\) AS contentText/, "document preview policy must keep an explicit contentText cap");
assert.match(main, /listDocumentMetas/, "watcher and change detection must use metadata-only document reads");
assert.match(main, /disableFileWatchAfterFailure/, "watcher must disable itself after database read failures");
assert.match(main, /codex:scanWorkspace/, "Codex workspace scan IPC must be registered");
assert.match(main, /codex:exportContext/, "Codex context export IPC must be registered");
assert.match(main, /codexGuardian:report/, "Codex Guardian report IPC must be registered");
assert.match(main, /codexGuardian:cleanLogs/, "Codex Guardian clean logs IPC must be registered");
assert.match(main, /codexGuardian:searchHistory/, "Codex Guardian history search IPC must be registered");
assert.match(main, /codexGuardian:getThreadContext/, "Codex Guardian thread context IPC must be registered");
assert.match(main, /codexGuardian:getProjectHistory/, "Codex Guardian project history IPC must be registered");
assert.match(main, /codexGuardian:listLongThreads/, "Codex Guardian long-thread triage IPC must be registered");
assert.match(main, /codexGuardian:optimizeThread/, "Codex Guardian old-thread optimization IPC must be registered");
assert.match(main, /codexGuardian:autoIngestHistory/, "Codex Guardian automatic history ingestion IPC must be registered");
assert.match(main, /STARTUP_AUTO_INGEST_DELAY_MS/, "App startup auto-ingest must be deferred after first paint");
assert.match(main, /STARTUP_AUTO_INGEST_INTERVAL_MS/, "App startup auto-ingest must be daily cadence gated");
assert.match(main, /STARTUP_AUTO_INGEST_OPTIONS = \{ limit: 12, startupBounded: true, maxDirectoryReads: 12, maxFileStats: 20 \}/, "App startup auto-ingest must use a tiny bounded preservation-only batch");
assert.match(main, /STARTUP_VAULT_SEARCH_INDEX_OPTIONS = \{ limit: 120, maxPrefixBytes: 512 \* 1024, maxPrefixLines: 600, forceMetadataRefresh: true, extractorVersion: 2 \}/, "Startup vault search indexing must backfill bounded manifest metadata independently from raw auto-ingest");
assert.match(main, /runStartupVaultSearchIndexIfDue[\s\S]*backfillThreadHistoryVaultSearchIndex/, "Startup vault search indexing must run as an independent due task");
assert.match(pkg.scripts.test, /codex-thread-history-auto-ingest-policy\.test\.cjs/, "default npm test must include focused Codex history auto-ingest behavior coverage");
assert.match(main, /buildGuardianHistoryKnowledgeItem/, "Old-thread optimization must build Zhixia knowledge entries");
assert.match(main, /buildAutoIngestVaultKnowledgeItem/, "Auto-ingested Thread History Vault manifests must become searchable knowledge entries");
assert.match(main, /indexThreadHistoryVaultManifests/, "Auto-ingested Thread History Vault manifests must be indexed after preservation");
assert.match(main, /backfillVaultIndexLimit/, "Auto-ingest must backfill existing vault manifests into search in bounded batches");
assert.match(codexAutoIngestPolicy, /inferCodexSessionMetadata/, "Auto-ingest must infer searchable metadata from bounded session prefixes");
assert.match(codexAutoIngestPolicy, /DEFAULT_SESSION_PREFIX_BYTES/, "Auto-ingest metadata inference must keep an explicit bounded read limit");
assert.match(main, /writeGuardianHistoryKnowledgeSidecar/, "Old-thread optimization must support sidecar knowledge writes for oversized SQLite stores");
assert.match(main, /shouldBypassSqliteHistoryWrite/, "Old-thread optimization must avoid sql.js full export when the SQLite store is too large");
assert.match(main, /sqljs_memory_error_fallback/, "Old-thread optimization must fall back when sql.js hits a memory error");
assert.match(main, /read_only_indexed/, "Old-thread optimization must be read-only against Codex sessions");
assert.match(main, /LONG_CODEX_THREAD_BYTES/, "Long-thread triage must have an explicit threshold");
assert.match(main, /Refusing\\s\+\(clean-logs\|prune-process-manager\)/, "Guardian refusal messages must be surfaced");
assert.match(main, /CREATE TABLE IF NOT EXISTS experience_cards/, "experience cards table must exist");
assert.match(main, /CREATE TABLE IF NOT EXISTS skill_candidates/, "skill candidates table must exist");
assert.match(main, /CREATE TABLE IF NOT EXISTS knowledge_items/, "knowledge item table must exist");
assert.match(main, /memory:updateExperienceCardStatus/, "experience card status update IPC must be registered");
assert.match(main, /rejected[\s\S]*stale/, "experience card governance must support rejected and stale states");
assert.match(main, /archived", "rejected", "stale/, "experience card retrieval freshness must treat archived/rejected/stale as stale");
assert.match(main, /function buildExperienceCardSourceSignature/, "experience cards must compute source signatures for stale-review governance");
assert.match(main, /function buildExperienceCardDuplicateKey/, "experience cards must compute duplicate grouping keys");
assert.match(main, /function sameExperienceSourceIdentity/, "experience cards must compare stable source identity separately from source content hash");
assert.match(main, /sourceDocumentId[\s\S]*sourcePath[\s\S]*sameExperienceSourceIdentity/, "ExperienceCard source identity must support source-document and source-path matching");
assert.match(main, /sourceSiblings[\s\S]*status\s*=\s*\$status[\s\S]*\$status:\s*"stale"/, "changed project-doc source backfill must stale prior confirmed sibling cards");
assert.match(main, /sourceSignatureReviewState[\s\S]*stale[\s\S]*return "review"/, "stale experience-card source signatures must be review-gated in retrieval");
assert.match(main, /duplicateState[\s\S]*duplicate_candidate[\s\S]*return "review"/, "duplicate candidates must be review-gated in retrieval");
assert.match(main, /curation:[^`]*\$\{card\.curationDecision\}/, "experience-card retrieval should expose curation provenance");
assert.match(main, /duplicate:[^`]*\$\{card\.duplicateState\}/, "experience-card retrieval should expose duplicate provenance");
assert.match(main, /memory:updateSkillCandidateStatus/, "skill candidate status update IPC must be registered");
assert.match(main, /memory:importAutoflow/, "AutoFlow experience import IPC must be registered");
assert.match(main, /knowledge:generate/, "knowledge item generation IPC must be registered");
assert.match(main, /knowledge:items/, "knowledge item list IPC must be registered");
assert.match(main, /knowledge:testProvider/, "AI provider test IPC must be registered");
assert.match(main, /agent:retrieveContext/, "agent retrieval IPC must be registered");
assert.match(main, /agent:listRetrieveLogs/, "agent retrieval log IPC must be registered");
assert.match(main, /retrieveAgentContext/, "main process should include local retrieval helper");
assert.match(main, /listAgentRetrieveLogs/, "main process should include retrieval log helper");
assert.match(main, /memoryRuntime:retrieveContext/, "main process must expose Memory Runtime retrieve_context IPC");
assert.match(main, /memoryRuntime:retrievePrecedent/, "main process must expose Memory Runtime retrieve_precedent IPC");
assert.match(main, /memoryRuntime:writebackEvidence/, "main process must expose Memory Runtime writeback_evidence IPC");
assert.match(main, /memoryRuntime:observeEvent/, "main process must expose event-triggered runtime memory IPC");
assert.match(main, /memoryRuntime:upsertWorkingMemory/, "main process must expose WorkingMemoryRecord upsert IPC");
assert.match(main, /memoryRuntime:listFlowSkillCandidates/, "main process must expose read-only FlowSkill candidate list IPC");
assert.match(main, /memoryRuntime:promoteMemory/, "main process must expose fail-closed promote_memory IPC");
assert.match(main, /memoryRuntime:listFacts/, "main process must expose temporal MemoryFact listing IPC");
assert.match(main, /memoryRuntime:listTriggerReceipts/, "main process must expose lifecycle trigger receipts");
assert.match(main, /memoryRuntime:evaluateBenchmark/, "main process must expose memory quality evaluation IPC");
assert.match(main, /memoryRuntime:getCoreDiagnostics/, "main process must expose read-only Memory Core diagnostics IPC");
assert.match(main, /memoryRuntime:listCoreReviewQueue/, "main process must expose read-only Memory Core review queue IPC");
assert.match(main, /memoryRuntime:getContinuityStatus/, "main process must expose read-only ProjectBrain continuity status IPC");
assert.doesNotMatch(main, /memoryRuntime:listCoreReviewItems|listMemoryCoreReviewItems|\.listReviewItems\(/, "duplicate Memory Core review-items API must stay removed");
assert.match(main, /memoryRuntime:getProjectContinuity/, "main process must expose paged ProjectBrain continuity IPC");
assert.match(main, /createMemoryCoreRuntime/, "main process must compose Memory Core into the existing runtime lifecycle");
assert.match(main, /function getExistingMemoryCoreRuntime[\s\S]*memoryCorePrivateStateExists[\s\S]*loadExistingSigningKey/, "read-only Memory Core APIs must use existing private state without creating a key");
assert.match(main, /getMemoryCoreDiagnostics[\s\S]*getExistingMemoryCoreRuntime[\s\S]*buildUnavailableMemoryCoreDiagnostics/, "diagnostics must fail closed without initializing private state");
assert.match(main, /filterAuthorizedCandidates[\s\S]*retrieveHybridMemory/, "authority filtering must execute before hybrid relevance ranking");
assert.match(main, /origin === APP_OWNED_MEMORY_CORE_ORIGIN[\s\S]*formAppOwnedLifecycleEvent\("writeback_evidence"[\s\S]*formLifecycleEvent\("writeback_evidence"/, "evidence writeback must separate app-owned and untrusted formation paths");
assert.match(main, /origin === APP_OWNED_MEMORY_CORE_ORIGIN[\s\S]*formAppOwnedLifecycleEvent\("observe_event"[\s\S]*formLifecycleEvent\("observe_event"/, "runtime events must separate app-owned and untrusted formation paths");
assert.match(main, /origin === APP_OWNED_MEMORY_CORE_ORIGIN[\s\S]*formAppOwnedLifecycleEvent\("close_working_memory"[\s\S]*formLifecycleEvent\("close_working_memory"/, "working-memory close must separate app-owned and renderer review-only paths");
assert.ok((main.match(/getProjectContinuity\(\{[\s\S]{0,500}?readOnly:\s*true/g) || []).length >= 4, "renderer-facing continuity reads must remain logically read-only");
assert.match(main, /getProjectContinuity[\s\S]*continuityPacket[\s\S]*recoveryReady[\s\S]*nextCursor/, "recovery and takeover must use paged ContinuityPacket readiness rather than topK");
assert.match(main, /loadOrCreateSigningKey[\s\S]*authoritySigningKey[\s\S]*createMemoryCoreRuntime/, "main must supply the app-owned stable authority signing key to Memory Core");
assert.match(main, /recoverMemoryRuntimeThread[\s\S]*getProjectContinuity[\s\S]*recoveryReady[\s\S]*nextCursor/, "thread recovery readiness must come from paged ProjectBrain continuity status");
assert.match(memoryCoreRuntime, /PRIVATE_STATE_DIR[\s\S]*SIGNING_KEY_FILE[\s\S]*loadOrCreateSigningKey/, "Memory Core must persist its authority signing key in app-owned private state");
assert.match(memoryCoreRuntime, /authorityFilterOrder:\s*"before_relevance_ranking"/, "Memory Core diagnostics must record authority-before-ranking order");
assert.match(memoryCoreRuntime, /buildMemoryFormationPlan[\s\S]*createFormationReceipt[\s\S]*memory_formation/, "Memory Core formation must preview then bind an exact signed memory_formation receipt");
assert.match(memoryCoreRuntime, /MAX_CONTINUITY_PAGES[\s\S]*mandatoryReturned[\s\S]*mandatoryTotal/, "Memory Core continuity must use bounded complete mandatory pagination");
assert.doesNotMatch(memoryCoreRuntime, /setInterval\(|setTimeout\(|rawSessionBodyRead:\s*true|db\.export\(/, "Memory Core runtime must not poll, read raw bodies, or export whole databases");
assert.match(main, /retrieveHybridMemory/, "Memory Runtime must use deterministic hybrid retrieval");
assert.match(main, /writeMemoryFactsFromEvidence/, "accepted evidence writeback must feed temporal MemoryFact storage");
assert.match(main, /writeMemoryRuntimeTriggerReceipt/, "Memory Runtime lifecycle hooks must leave trigger receipts");
assert.match(main, /sidecarIndexWholeDatabaseExport:\s*false/, "sidecar memory index must not use whole-database export");
assert.match(memoryRuntimePolicy, /buildRuntimeContextPacket/, "Memory Runtime policy must build RuntimeContextPacket-shaped results");
assert.match(memoryRuntimePolicy, /buildMemoryRouterPlan/, "Memory Runtime policy must expose a low-overhead MemoryRouter plan");
assert.match(memoryRuntimePolicy, /hot_warm_cold_metadata_first/, "MemoryRouter must use hot/warm/cold metadata-first strategy");
assert.match(memoryRuntimePolicy, /startsTimers:\s*false[\s\S]*scansFullDatabase:\s*false[\s\S]*scansVault:\s*false/, "MemoryRouter must not start timers or scan full database/vault");
assert.match(main, /CREATE TABLE IF NOT EXISTS memory_graph_nodes/, "Memory Runtime must persist lightweight memory graph nodes");
assert.match(main, /CREATE TABLE IF NOT EXISTS memory_graph_edges/, "Memory Runtime must persist lightweight memory graph edges");
assert.match(main, /memoryRuntime:activateMemory/, "main process must expose explicit activate_memory IPC");
assert.match(main, /projectAliasLike[\s\S]*projectPath LIKE \$projectLike/, "Memory graph activation must include same-name Codex worktree project aliases");
assert.match(main, /listKnowledgeItemsForMemoryGraph\(projectPath,[\s\S]*threadId/, "Memory graph activation must force-seed exact threadId history entries");
assert.match(main, /function activateMemoryRuntimeGraph[\s\S]*syncMemoryGraphFromSources\(\{[\s\S]*threadId:\s*options\.threadId/, "activate_memory must pass exact threadId into source sync for cold graph seeding");
assert.match(main, /memoryRuntime:activateMemory[\s\S]*activateMemoryRuntimeGraph[\s\S]*await saveDatabase\(\)/, "explicit memory graph activation must persist its lightweight cache");
assert.match(preload, /activateMemoryRuntimeGraph/, "preload must expose explicit activate_memory IPC");
assert.match(memoryRuntimePolicy, /buildActivatedMemoryGraph/, "Memory Runtime policy must build activated memory graphs");
assert.match(memoryRuntimePolicy, /persisted_activation_graph/, "Memory graph must expose persisted activation graph mode");
assert.match(main, /activateMemoryRuntimeGraph[\s\S]*memoryGraphRawSessionBodyRead:\s*false[\s\S]*memoryGraphVaultScan:\s*false/, "retrieve_context must merge activated graph without raw/vault reads");
assert.match(memoryRuntimePolicy, /buildRuntimePrecedentRequest[\s\S]*DEFAULT_PRECEDENT_ALLOWED_KINDS/, "Memory Runtime precedent retrieval must use bounded allowed kinds");
assert.match(memoryRuntimePolicy, /metadata_first_no_raw_session_body/, "Memory Runtime context must declare metadata-first no raw-session policy");
assert.match(memoryRuntimePolicy, /buildHotStateCacheSeed/, "Memory Runtime should seed compact hot state without reading raw history");
assert.match(memoryRuntimePolicy, /buildMemoryGraph/, "Memory Runtime should build a bounded association graph from compact refs");
assert.match(memoryRuntimePolicy, /RUNTIME_EVENT_TYPES[\s\S]*broken_thread[\s\S]*heartbeat_fuse[\s\S]*thread_takeover[\s\S]*stale_lane_reference/, "Memory Runtime must support broken-thread and heartbeat runtime event types");
assert.match(memoryRuntimePolicy, /normalizeRuntimeEventMemory[\s\S]*metadataOnly:\s*true[\s\S]*archiveCompactDeleteMoveRestore:\s*false/, "runtime event memory writes must stay metadata-only and non-mutating");
assert.match(memoryRuntimePolicy, /runtimeEventToWorkingMemoryRecord/, "runtime events must feed short-term WorkingMemoryRecord state");
assert.match(memoryRuntimePolicy, /filterDefaultSafeSourceRefs/, "runtime event default context must filter unsafe source refs");
assert.match(memoryRuntimePolicy, /buildFlowSkillReadyCandidate/, "Memory Runtime policy must build private FlowSkill-ready candidate packets");
assert.match(memoryRuntimePolicy, /runtimeSubdir\(storeRoot,\s*"flowskill-candidates"\)/, "FlowSkill candidates must be stored in app-owned Memory Runtime storage");
assert.match(memoryRuntimePolicy, /writeEvidenceWriteback[\s\S]*archiveCompactDeleteMoveRestore:\s*false/, "Memory Runtime writeback receipts must preserve no archive/compact/delete boundary");
assert.match(memoryRuntimePolicy, /runsFlowSkill:\s*false[\s\S]*installsOrExecutes:\s*false[\s\S]*exportsPublicly:\s*false/, "FlowSkill candidate records must not run, install, execute, or export");
assert.match(memoryRuntimePolicy, /evaluatePromotionCandidate[\s\S]*installsOrExecutes:\s*false/, "Memory Runtime promotion must not install or execute candidates");
assert.match(memoryRuntimePolicy, /publicExportAutomatic:\s*false/, "Memory Runtime writeback must never auto-public-export FlowSkill material");
assert.match(ceoMemoryRuntimeGuardPolicy, /function evaluateCeoThreadPressure/, "CEO Memory Runtime guard must expose a pure thread pressure evaluator");
assert.match(ceoMemoryRuntimeGuardPolicy, /freeze_risk_stop_dispatch/, "CEO thread pressure guard must be able to stop dispatch on freeze risk");
assert.match(ceoMemoryRuntimeGuardPolicy, /function buildCeoTakeoverBootstrapPacket/, "CEO Memory Runtime guard must build one-line takeover bootstrap packets");
assert.match(ceoMemoryRuntimeGuardPolicy, /function buildCeoLifecycleWritebackPacket/, "CEO Memory Runtime guard must build compact lifecycle writeback packets");
assert.match(ceoMemoryRuntimeGuardPolicy, /startsTimers:\s*false[\s\S]*scansVault:\s*false[\s\S]*rawSessionBodyRead:\s*false/, "CEO Memory Runtime guard must not add timers, vault scans, or raw-session reads");
assert.match(main, /memoryRuntime:evaluateCeoThreadPressure/, "main process must expose CEO thread pressure evaluation IPC");
assert.match(main, /memoryRuntime:buildCeoTakeoverBootstrap/, "main process must expose CEO takeover bootstrap IPC");
assert.match(main, /function buildCeoTakeoverBootstrap[\s\S]*allowedKinds:\s*\["runtime_event",\s*"project_record",\s*"project_resume_packet",\s*"ceo_flow_record",\s*"project_artifact",\s*"knowledge_item",\s*"experience_card"\]/, "CEO takeover bootstrap retrieval must avoid thread_lineage_index refresh side effects");
assert.match(preload, /evaluateCeoThreadPressure/, "preload must expose CEO thread pressure evaluation");
assert.match(viteEnv, /export type CeoTakeoverBootstrapPacket/, "renderer types must include CEO takeover bootstrap packets");
assert.match(pkg.scripts.test, /ceo-memory-runtime-guard-policy\.test\.cjs/, "default npm test must include CEO Memory Runtime guard coverage");
assert.match(pkg.scripts.test, /memory-runtime-policy\.test\.cjs/, "default npm test must include Memory Runtime contract policy tests");
assert.match(pkg.scripts.test, /memory-runtime-lifecycle-e2e\.test\.cjs/, "default npm test must include integrated Memory Runtime lifecycle e2e probe");
assert.match(agentRetrievePolicy, /"project_record"[\s\S]*"project_resume_packet"[\s\S]*"ceo_flow_record"[\s\S]*"thread_lineage_index"[\s\S]*"project_artifact"/, "agent retrieval policy must include ProjectRecord, Resume Packet, CEOFlowRecord, ThreadLineageIndex and ProjectArtifact kinds");
assert.match(agentRetrievePolicy, /"tool_skill_record"/, "agent retrieval policy must include ToolSkillRecord as a distinct retrieval kind");
assert.match(agentRetrievePolicy, /toolSkillRecords:\s*request\.allowedKinds\.has\("tool_skill_record"\)\s*\?\s*"compact_rows"/, "ToolSkillRecord retrieval must use compact metadata rows");
assert.match(agentRetrievePolicy, /tool_skill_records[\s\S]*compact_rows_metadata_only/, "ToolSkillRecord retrieval trace must declare compact metadata-only source collection");
assert.match(agentRetrievePolicy, /makeToolSkillRecord/, "retrieval assembly must support first-class ToolSkillRecord item builders");
assert.match(main, /buildProjectResumePacket/, "agent retrieval must build Project Resume Packet items from ProjectRecord");
assert.match(main, /buildProjectArtifacts/, "agent retrieval must build ProjectArtifact items from document metadata");
assert.match(main, /listToolSkillRecordsForRetrieval/, "agent retrieval must collect live ToolSkillRecord inventory records");
assert.match(main, /buildToolSkillInventoryCacheState/, "ToolSkillRecord retrieval cache key must include live inventory/governance state");
assert.match(main, /makeAgentRetrieveToolSkillRecord/, "main process must build ToolSkillRecord retrieval items");
assert.match(main, /kind:\s*"tool_skill_record"/, "ToolSkillRecord retrieval items must use the explicit tool_skill_record kind");
assert.match(main, /requiresHumanConfirmation:\s*true[\s\S]*rawSessionPolicy:\s*"metadata_only_no_sensitive_or_raw_session_body"/, "ToolSkillRecord retrieval must remain human-confirmation gated and metadata-only");
assert.match(main, /policy:no-install-enable-execute-or-active-promotion/, "ToolSkillRecord retrieval must state no install/enable/execute/active-promotion policy");
assert.match(main, /status\s*=\s*reviewState === "stale" \? "review_needed"/, "stale ToolSkillRecord governance must surface as review-needed");
assert.match(main, /documents:updateContent/, "main process must expose safe document content update IPC");
assert.match(main, /assertEditableDocumentContentTarget/, "content updates must be scoped to explicitly editable generated artifacts");
assert.match(main, /project-resume\.md[\s\S]*\.codex-knowledge/, "Project Resume Packet content edits must be limited to .codex-knowledge/project-resume.md");
assert.match(main, /projectRecordOverrides/, "ProjectRecord generation must consume persisted user confirmations");
assert.match(main, /applyProjectRecordOverride/, "ProjectRecord generation must overlay human-confirmed project state");
assert.match(main, /buildProjectRecordSourceSignature/, "ProjectRecord confirmation must be bound to a source signature");
assert.match(main, /human_confirmation_stale/, "ProjectRecord stale confirmations must not be applied as current overrides");
assert.match(main, /function buildProjectRecordSourceSignature[\s\S]*\.sort\([\s\S]*\)[\s\S]*\.slice\(0, 8\)/, "main ProjectRecord source signature must sort refs before slicing");
assert.match(appTsx, /function buildProjectRecordSourceSignature[\s\S]*\.sort\([\s\S]*\)[\s\S]*\.slice\(0, 8\)/, "renderer ProjectRecord source signature must sort refs before slicing");
const retrieveProjectRecord = buildProjectRecordRetrieveEvaluator(main);
const staleProjectRecordItem = retrieveProjectRecord({
  id: "project:stale",
  name: "Zhixia",
  rootPath: "C:\\Users\\example\\Documents\\Zhixia-Local-Doc-Knowledge\\app",
  lastSummary: "Generated status is active, but the human confirmation signature is stale.",
  nextAction: "Re-review ProjectRecord sources.",
  status: "active",
  completion: "testing",
  completionPercent: 75,
  aliases: ["Zhixia"],
  sourceRefs: [{ kind: "document", path: "docs/PRD.md" }],
  governance: { status: "confirmed", reviewState: "stale" },
  humanConfirmedAt: null,
  lastActivityAt: "2026-06-13T10:00:00.000Z",
});
assert.equal(staleProjectRecordItem.freshness, "review", "stale ProjectRecord confirmations must remain review-gated in Agent retrieval");
assert.equal(staleProjectRecordItem.requiresHumanConfirmation, true, "stale ProjectRecord confirmations must require human confirmation in Agent retrieval");
assert.ok(
  staleProjectRecordItem.whyMatched.includes("governance:confirmed/stale"),
  "ProjectRecord retrieval should expose stale governance provenance",
);
const currentProjectRecordItem = retrieveProjectRecord({
  id: "project:current",
  name: "Zhixia",
  rootPath: "C:\\Users\\example\\Documents\\Zhixia-Local-Doc-Knowledge\\app",
  lastSummary: "Human-confirmed current ProjectRecord.",
  nextAction: "Continue execution.",
  status: "active",
  completion: "testing",
  completionPercent: 75,
  aliases: ["Zhixia"],
  sourceRefs: [{ kind: "document", path: "docs/PRD.md" }],
  governance: { status: "confirmed", reviewState: "current" },
  humanConfirmedAt: "2026-06-13T10:00:00.000Z",
  lastActivityAt: "2026-06-13T10:00:00.000Z",
});
assert.equal(currentProjectRecordItem.freshness, "fresh", "current human-confirmed ProjectRecord should stay fresh in Agent retrieval");
assert.equal(currentProjectRecordItem.requiresHumanConfirmation, false, "current human-confirmed ProjectRecord should not require confirmation");
assert.match(main, /parentCeoThreadId/, "agent retrieval must accept parentCeoThreadId for CEO lineage lookups");
assert.match(agentRetrievePolicy, /AGENT_RETRIEVE_CACHE_TTL_MS/, "agent retrieval must cache structured lookup results with an explicit TTL");
assert.match(main, /buildProjectRecords[\s\S]*listDocumentMetas\(\)/, "ProjectRecord generation must use metadata-only document reads");
assert.match(projectArtifactPolicy, /looksLikeRawSessionPath/, "ProjectArtifact policy must exclude raw Codex session files");
assert.match(projectArtifactPolicy, /generatedKnowledge:review/, "ProjectArtifact policy must keep generated .codex-knowledge files in review");
assert.match(projectArtifactPolicy, /newerSameType:superseded/, "ProjectArtifact policy must mark older same-type documents as superseded");
assert.match(projectArtifactPolicy, /producedBy/, "ProjectArtifact policy must infer producer ownership for document governance");
assert.match(main, /buildCEOFlowRecords/, "agent retrieval must build CEOFlowRecord / ThreadLineageIndex-style records before searching raw history");
assert.match(main, /buildThreadLineageIndexRecord/, "agent retrieval must build explicit ThreadLineageIndex metadata records");
assert.match(main, /buildAutoIngestVaultLineageRecord/, "auto-ingested vault manifests must create ThreadLineageIndex records");
assert.match(main, /sourceRefsJson NOT LIKE '%thread_history_vault%'/, "ThreadLineageIndex refresh must preserve vault-derived lineage records");
assert.match(main, /CREATE TABLE IF NOT EXISTS thread_lineage_index/, "main process must persist ThreadLineageIndex metadata rows");
assert.match(main, /relationshipsJson TEXT NOT NULL DEFAULT '\{}'/, "ThreadLineageIndex table must persist relationship metadata as compact JSON");
assert.match(main, /governanceJson TEXT NOT NULL DEFAULT '\{}'/, "ThreadLineageIndex table must persist governance metadata as compact JSON");
assert.match(main, /function upsertThreadLineageIndexRecord/, "main process must upsert persisted ThreadLineageIndex rows");
assert.match(main, /function listThreadLineageIndexRecords/, "main process must read persisted ThreadLineageIndex rows for retrieval");
assert.match(main, /threadLineageIndex: request\.allowedKinds\.has\("thread_lineage_index"\)/, "agent retrieval cache key must include persisted ThreadLineageIndex state");
assert.match(main, /makeAgentRetrieveThreadLineageIndex/, "agent retrieval must expose ThreadLineageIndex metadata items");
assert.match(main, /metadata_only_no_raw_body/, "ThreadLineageIndex retrieval must declare metadata-only raw-session policy");
assert.match(main, /read_only_no_archive_compact_restore_delete/, "ThreadLineageIndex retrieval must forbid archive/compact/restore/delete mutation");
assert.match(agentRetrievePolicy, /collectAgentRetrieveContractSources/, "agent retrieval policy should expose a pure retrieval-contract source collector");
assert.match(agentRetrievePolicy, /assembleAgentRetrieveContractResult/, "agent retrieval policy should expose a pure retrieval assembly helper after source collection");
assert.match(agentRetrievePolicy, /filterProjectRecordsForCEOFlow/, "agent retrieval policy should prefilter ProjectRecords before CEO lineage expansion");
assert.match(agentRetrievePolicy, /threadLineageIndexRecords/, "agent retrieval policy should support persisted ThreadLineageIndex source rows");
assert.match(agentRetrievePolicy, /persisted_metadata_only/, "agent retrieval policy trace should label persisted ThreadLineageIndex reads as metadata-only");
assert.match(main, /const contractSources = collectAgentRetrieveContractSources\(request/, "main process should build retrieval contract sources through the shared helper");
assert.match(main, /const trimmed = assembleAgentRetrieveContractResult\(request, contractSources/, "main process should assemble and trim retrieval payloads through the shared pure helper");
assert.match(agentRetrievePolicy, /request\.allowedKinds\.has\("document"\) \|\| request\.allowedKinds\.has\("project_artifact"\) \? "metadata_only" : "skip"/, "document and ProjectArtifact retrieval must require metadata-only reads");
assert.match(agentRuntimeMonitorPolicy, /normalizeRuntimeProcessSample/, "Agent Runtime Monitor policy must normalize process samples");
assert.match(agentRuntimeMonitorPolicy, /normalizeRuntimeSession/, "Agent Runtime Monitor policy must normalize session metadata");
assert.match(agentRuntimeMonitorPolicy, /buildRuntimeMonitorSnapshot/, "Agent Runtime Monitor policy must expose a pure snapshot builder");
assert.match(agentRuntimeMonitorPolicy, /attributionConfidence/, "Agent Runtime Monitor must expose attribution confidence instead of overclaiming thread CPU attribution");
assert.match(agentRuntimeMonitorPolicy, /recommendedAction/, "Agent Runtime Monitor must expose conservative recommended actions");
assert.match(agentRuntimeMonitorPolicy, /process_only_planned_session_adapter/, "Agent Runtime Monitor must label non-Codex adapters as process-only planned session adapters");
assert.match(agentRuntimeMonitorPolicy, /redactSensitiveRuntimeText/, "Agent Runtime Monitor must redact secret-like command-line metadata");
assert.doesNotMatch(agentRuntimeMonitorPolicy, /compact-session|clean-logs|prune-process-manager|restore/i, "Agent Runtime Monitor policy must not run Guardian/session maintenance commands");
assert.match(runtimeMonitorAdapter, /sampleAgentProcesses/, "Runtime monitor adapter must expose a read-only process sampler");
assert.match(runtimeMonitorAdapter, /buildRuntimeMonitorSnapshotFromInputs/, "Runtime monitor adapter must build snapshots from injected process/session metadata");
assert.match(runtimeMonitorAdapter, /metadata_only_no_raw_body/, "Runtime monitor adapter must declare metadata-only raw session policy");
assert.match(runtimeMonitorAdapter, /nonCodexSessionAdapterPolicy/, "Runtime monitor adapter provenance must expose non-Codex adapter limits");
assert.match(runtimeMonitorAdapter, /vaultManifestPath[\s\S]*vaultSessionPath[\s\S]*vaultSha256/, "Runtime monitor adapter must preserve Thread History Vault evidence");
assert.match(runtimeMonitorAdapter, /memoryPointers/, "Runtime monitor adapter must preserve Zhixia memory pointer evidence");
assert.match(runtimeMonitorAdapter, /compactReceiptPath/, "Runtime monitor adapter must preserve compact receipt evidence");
assert.doesNotMatch(runtimeMonitorAdapter, /compact-session|clean-logs|prune-process-manager|restore/i, "Runtime monitor adapter must not run Guardian/session maintenance commands");
assert.match(main, /listDocumentMetas,/, "main process should inject metadata-only document reads into the retrieval contract helper");
assert.match(main, /durationMs/, "retrieval logs should include duration");
assert.match(main, /sourceRefs/, "agent retrieval payload should include source refs");
assert.match(main, /topItems/, "retrieval logs should include top item summaries");
assert.match(main, /requiresHumanConfirmation/, "agent retrieval payload should include confirmation flags");
assert.match(main, /requiresHumanConfirmationCount/, "retrieval logs should include confirmation counts");
assert.match(main, /aiProviderApiKey/, "AI provider key setting must exist");
assert.match(main, /sanitizedSettings/, "AI provider key must be sanitized before renderer responses");
assert.match(main, /completion_ledger\.json/, "AutoFlow import must read the completion ledger");
assert.match(main, /memory_cards\.json/, "AutoFlow import must read agent family memory cards");
assert.doesNotMatch(main, /C:\\Users\\example\\Documents\\Playground\\ExampleStudio\\workflow/, "main process should not hardcode a personal workflow path");
assert.doesNotMatch(main, /C:\\Users\\example\\Documents\\ceshi\\docs\\BUG_FIX_MEMORY\.md/, "main process should not hardcode a personal BUG_FIX_MEMORY path");
assert.match(main, /buildProjectMemoryBackfillCards/, "Project export must backfill compact project document memory candidates");
assert.match(projectMemoryBackfillPolicy, /sourceType:\s*"project_doc"/, "Project memory backfill must mark project documents as the source");
assert.match(projectMemoryBackfillPolicy, /status:\s*"candidate"/, "Project memory backfill must keep automatic cards as candidates");
assert.match(projectMemoryBackfillPolicy, /looksLikeRawSessionPath/, "Project memory backfill must explicitly skip raw session paths");
assert.match(projectMemoryBackfillPolicy, /looksLikeGeneratedKnowledgeFile/, "Project memory backfill must avoid looping generated .codex-knowledge files");
assert.match(main, /retrievalMetaJson TEXT NOT NULL DEFAULT '\{\}'/, "experience cards table must persist retrieval metadata in a dedicated JSON column");
assert.match(main, /ensureColumn\("experience_cards", "retrievalMetaJson"/, "schema migration must backfill the experience-card retrieval metadata column");
assert.match(main, /normalizeExperienceCardRetrieveMeta/, "main process must normalize persisted experience-card retrieval metadata through a pure seam");
assert.match(main, /JSON\.stringify\(retrievalMeta\)/, "experience-card upsert must persist normalized retrieval metadata");
assert.match(main, /sourceRefs: Array\.isArray\(card\.sourceRefs\) \? card\.sourceRefs : \[\]/, "experience-card export must preserve persisted source refs");
assert.match(main, /rawSessionPolicy: card\.rawSessionPolicy \|\| null/, "experience-card export or retrieval must preserve raw session policy");
assert.match(main, /sourceDocumentUpdatedAt: card\.sourceDocumentUpdatedAt \|\| null/, "experience-card export or retrieval must preserve source document updatedAt");
assert.match(main, /const sourceRefs = Array\.isArray\(card\.sourceRefs\) && card\.sourceRefs\.length > 0/, "experience-card retrieval must prefer persisted source refs over generic reconstruction");
assert.match(main, /project-resume\.md/, "Project export must write project resume markdown");
assert.match(main, /experience-cards\.md/, "Project export must write experience cards markdown");
assert.match(main, /project-artifacts\.md/, "Project export must write project artifacts markdown");
assert.match(main, /project-artifacts\.json/, "Project export must write project artifacts json");
assert.match(main, /skill-candidates\.md/, "Project export must write skill candidates markdown");
assert.match(main, /tool-skill-inventory\.md/, "Project export must write tool skill inventory markdown");
assert.match(main, /tool-skill-inventory\.json/, "Project export must write tool skill inventory json");
assert.match(main, /knowledge-items\.md/, "Project export must write knowledge items markdown");
assert.match(main, /knowledge-items\.json/, "Project export must write knowledge items json");
assert.match(main, /discoverProjectRoots/, "Codex workspace scan must discover project roots");
assert.match(main, /project-knowledge\.md/, "Scan should generate project-level knowledge files");
assert.match(main, /retrieval-packet\.md/, "Scan should generate compact retrieval packets");
assert.match(main, /project-index\.json/, "Scan should generate structured project indexes");
assert.match(main, /project-chunks\.jsonl/, "Scan should generate bounded retrieval chunks");
assert.match(main, /MAX_PROJECT_KNOWLEDGE_MARKDOWN_CHARS/, "Project knowledge compatibility markdown must have a hard size cap");
assert.match(main, /return capGeneratedMarkdown\(lines\.join\("\\n"\), "project-knowledge\.md"\);[\s\S]*lines\.push\("", "## 结构化知识提取"/, "project-knowledge.md must return before legacy long document excerpt generation");
assert.match(main, /raw sessions stay in Thread History Vault and are never default retrieval material/, "Layered memory policy must keep raw history out of default retrieval");
assert.match(main, /MAX_DOCUMENT_CONTENT_TEXT_CHARS = 60000/, "Imported document text must be capped below giant-context sizes");
assert.match(main, /function stripHeavyInlinePayloads/, "Image/base64 payload stripping must happen before text enters the knowledge store");
assert.match(main, /data:image\\\/\[a-z0-9\.\+-\]\+;base64/, "Inline image data URLs must be stripped from stored text");
assert.match(main, /large base64-like payload stripped/, "Long base64-like payloads must be replaced with pointers/placeholders");
assert.match(main, /function compactRetrievalPacketText/, "Layered retrieval packets must run noisy historical summaries through a compact cleaner");
assert.match(main, /replace\(\s*\/\^\\s\*重复文件/, "Retrieval packet cleaner must remove duplicate-file prefixes before packets reach Codex");
assert.match(main, /source pointer retained/, "Retrieval packet cleaner must replace raw source paths with source pointers");
assert.match(main, /summary: compactRetrievalPacketText\(doc\.summary \|\| doc\.contentText \|\| doc\.parseError/, "Project index document summaries must use the same compact cleaner as retrieval packets");
assert.match(main, /normalized\.includes\(`\$\{path\.sep\}\.codex-knowledge\$\{path\.sep\}`\)/, "Generated .codex-knowledge files must be excluded from normal project document exports");
assert.ok(main.includes('Codex History${path.sep}_indexes'), "Generated Guardian index JSON must be excluded from normal project document exports");
assert.match(main, /baseName === "retrieval-packet\.md" \|\| baseName === "retrieval-packet\.json"/, "Layered retrieval packets must not be re-imported as source documents");
assert.match(main, /baseName === "project-index\.md" \|\| baseName === "project-index\.json"/, "Layered project indexes must not be re-imported as source documents");
assert.match(main, /!\s*isGeneratedKnowledgeArtifact\(doc\.filePath\)/, "Project export must filter generated memory artifacts before ranking documents");
assert.match(main, /MAX_VAULT_SESSION_COPIES_PER_THREAD = 2/, "Thread History Vault must not retain unlimited full session copies per thread");
assert.match(main, /function pruneSupersededVaultSessionCopies/, "Thread History Vault must prune superseded full session copies after preserving latest history");
assert.match(main, /pruneSupersededVaultSessionCopies\(threadDir, vaultSessionPath\)/, "Vault ingestion must apply per-thread retention after writing latest manifest");
assert.match(main, /read-project-knowledge\.cjs/, "Skill fingerprint must include the retrieval helper");
assert.match(main, /skill:install/, "Codex skill install IPC must be registered");
assert.match(main, /CODEX_HOME/, "Skill installer must honor CODEX_HOME");
assert.match(main, /autoInstallBundledSkillIfEnabled/, "Skill should auto-install on app startup");
assert.match(main, /setSettingIfMissing\("autoInstallSkill", false\)/, "Skill auto-install must be opt-in by default");
assert.match(main, /--install-skill-and-quit/, "Packaged installer must be able to install Skill by explicit user choice");
assert.match(main, /assets", "icon\.ico"/, "BrowserWindow must use the custom app icon");
assert.match(main, /app\.setName\("知匣 Local Doc Knowledge"\)/, "Main process must set the packaged app name instead of leaving Electron defaults");
assert.match(main, /setAppUserModelId\("local\.doc\.knowledge"\)/, "Windows app identity must use the Zhixia app id");
assert.match(main, /XLSX\/XLS 解析将在后续安全方案中接入/, "Excel safety policy message must remain explicit");
assert.match(preload, /memory:experienceCards/, "preload must expose experience card IPC");
assert.match(preload, /memory:skillCandidates/, "preload must expose skill candidate IPC");
assert.match(preload, /updateExperienceCardStatus/, "preload must expose experience status updates");
assert.match(preload, /updateSkillCandidateStatus/, "preload must expose skill candidate status updates");
assert.match(preload, /memory:importAutoflow/, "preload must expose AutoFlow import IPC");
assert.match(preload, /knowledge:generate/, "preload must expose knowledge generation IPC");
assert.match(preload, /knowledge:items/, "preload must expose knowledge list IPC");
assert.match(preload, /knowledge:testProvider/, "preload must expose AI provider test IPC");
assert.match(preload, /retrieveAgentContext/, "preload must expose agent retrieval IPC");
assert.match(preload, /retrieveMemoryRuntimeContext/, "preload must expose Memory Runtime retrieve_context IPC");
assert.match(preload, /retrieveMemoryRuntimePrecedent/, "preload must expose Memory Runtime retrieve_precedent IPC");
assert.match(preload, /recoverMemoryRuntimeThread/, "preload must expose Memory Runtime thread recovery packet IPC");
assert.match(preload, /writebackMemoryRuntimeEvidence/, "preload must expose Memory Runtime writeback_evidence IPC");
assert.match(preload, /observeMemoryRuntimeEvent/, "preload must expose event-triggered runtime memory IPC");
assert.match(viteEnv, /RuntimeEventMemoryInput/, "renderer types must define runtime event memory input");
assert.match(viteEnv, /RuntimeEventMemoryReceipt/, "renderer types must define runtime event memory receipt");
assert.match(viteEnv, /observeMemoryRuntimeEvent/, "renderer types must expose event-triggered runtime memory API");
assert.match(preload, /upsertWorkingMemory/, "preload must expose WorkingMemoryRecord IPC");
assert.match(preload, /listFlowSkillCandidates/, "preload must expose read-only FlowSkill candidate list IPC");
assert.match(preload, /promoteMemory/, "preload must expose promote_memory IPC");
assert.match(preload, /listMemoryFacts/, "preload must expose MemoryFact listing");
assert.match(preload, /listMemoryRuntimeTriggerReceipts/, "preload must expose trigger receipt listing");
assert.match(preload, /evaluateMemoryRuntimeBenchmark/, "preload must expose memory evaluation");
assert.match(preload, /getMemoryCoreDiagnostics/, "preload must expose read-only Memory Core diagnostics");
assert.match(preload, /listMemoryCoreReviewQueue/, "preload must expose read-only Memory Core review queue");
assert.match(preload, /getMemoryCoreContinuityStatus/, "preload must expose read-only ProjectBrain continuity status");
assert.doesNotMatch(preload, /listMemoryCoreReviewItems|memoryRuntime:listCoreReviewItems/, "preload must expose only the canonical Memory Core review queue API");
assert.doesNotMatch(viteEnv, /listMemoryCoreReviewItems/, "renderer types must expose only the canonical Memory Core review queue API");
assert.match(preload, /getProjectContinuity/, "preload must expose paged ProjectBrain continuity without trust capabilities");
assert.doesNotMatch(preload, /trustContext|authoritySigningKey|hydrateAuthorityReceipt|registerAuthorityPrincipal|registerAuthorityReceipt/, "preload must not expose Memory Core trust or hydration capabilities");
assert.match(viteEnv, /MemoryCoreDiagnostics[\s\S]*MemoryCoreReviewQueue[\s\S]*MemoryCoreContinuityStatus/, "renderer types must expose read-only Memory Core diagnostics contracts");
assert.match(appTsx, /Promise\.allSettled\(\[[\s\S]*getMemoryCoreDiagnostics[\s\S]*getMemoryCoreContinuityStatus[\s\S]*getProjectContinuity[\s\S]*listMemoryCoreReviewQueue/, "Project detail must load the four Memory Core reads in parallel");
assert.match(appTsx, /listMemoryCoreReviewQueue\(\{ projectPath, limit: 8 \}\)/, "Project Memory Core review preview must stay bounded to eight items");
assert.match(appTsx, /retrieveMemoryRuntimeContext\(\{[\s\S]*maxResults: 4,[\s\S]*tokenBudget: 700,/, "Project memory recall must stay bounded to four results and 700 tokens");
assert.match(appTsx, /diagnostics\?\.privateStateReady[\s\S]*diagnostics\.sidecarReady[\s\S]*retrieveMemoryRuntimeContext/, "Project memory recall must wait for existing initialized private state");
assert.match(appTsx, /projectTab !== "memory"/, "Project memory recall must only run when the project memory tab opens");
assert.match(appTsx, /扫描并整理项目后，知匣会建立项目身份和来源锚点。/, "Project memory must explain the not-initialized state without auto-creating it");
assert.match(appTsx, /\{ key: "memory", label: "项目记忆" \}/, "Project detail must label the memory tab as 项目记忆");
assert.match(appTsx, /data-e2e="project-memory-core"/, "Project memory view must expose a stable visual test hook");
const projectMemoryCoreEffect = appTsx.slice(
  appTsx.indexOf("Promise.allSettled(["),
  appTsx.indexOf("}, [activeProject, view]);", appTsx.indexOf("Promise.allSettled([")),
);
assert.doesNotMatch(projectMemoryCoreEffect, /setTimeout|setInterval|requestIdleCallback|heartbeat|poll/i, "Project Memory Core detail load must remain event-triggered with no timers or polling");
assert.match(pkg.scripts.test, /memory-core-runtime-lifecycle\.test\.cjs/, "default npm test must include the focused Memory Core lifecycle test");
assert.match(pkg.scripts.test, /memory-core-project-backfill\.test\.cjs/, "default npm test must include the focused Memory Core project backfill test");
assert.match(main, /function writeProjectKnowledgeFiles\(projectPaths, options = \{\}\)[\s\S]*seedProjectMemoryCoreBackfill/, "explicit project knowledge generation must compose the Memory Core project seed");
assert.match(main, /scanCodexWorkspacePath\(workspacePath, \{ seedMemoryCore: true \}\)/, "explicit Codex workspace scan must opt into Memory Core project seeding");
assert.match(main, /function refreshFromFileWatch[\s\S]*scanCodexWorkspacePath\(workspacePath\)[\s\S]*function startFileWatchers/, "file watcher refresh must retain the non-seeding scan default");
assert.match(
  preload,
  /retrieveAgentContext:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\("agent:retrieveContext",\s*options\)/,
  "preload must pass retrieval options through so parentCeoThreadId and includeKinds reach main",
);
assert.match(preload, /listRetrieveLogs/, "preload must expose retrieval log IPC");
assert.match(main, /buildThreadRecoveryPacket/, "main process must import the ThreadRecoveryPacket builder");
assert.match(main, /function recoverMemoryRuntimeThread/, "main process must build ThreadRecoveryPacket from lineage/vault pointers");
assert.match(main, /memoryRuntime:recoverThread/, "main process must expose thread recovery packet IPC");
assert.match(main, /recoverMemoryRuntimeThread[\s\S]*observeMemoryRuntimeEvent\(\{[\s\S]*thread_takeover[\s\S]*runtimeEventWriteback/, "thread recovery must write a short-term runtime event receipt");
assert.match(main, /readThreadVaultManifestByThreadId/, "thread recovery must read targeted vault manifests by threadId");
assert.match(main, /findGuardianThreadRecoveryRecords/, "thread recovery must use Guardian inventory metadata pointers");
assert.match(main, /findSessionPointersByThreadId/, "thread recovery must expose raw sessions only as bounded pointers");
assert.match(memoryRuntimePolicy, /rawSessionBodyRead:\s*false/, "thread recovery packet must not read raw session bodies by default");
assert.match(appTsx, /recoverMemoryRuntimeThread/, "UI must expose a callable old-thread recovery packet flow");
assert.match(appTsx, /生成接续包/, "old-thread UI must let users generate a thread recovery packet");
assert.match(appTsx, /复制接续包/, "old-thread UI must let users copy the thread recovery packet");
assert.match(appTsx, /raw\/vault session 默认不读/, "old-thread recovery UI must state the no raw/vault session default-read boundary");
assert.match(preload, /getCodexGuardianReport/, "preload must expose Codex Guardian report");
assert.match(preload, /cleanCodexHotLogs/, "preload must expose Codex hot-log cleanup");
assert.match(preload, /searchCodexHistory/, "preload must expose old-thread search");
assert.match(preload, /getCodexThreadContext/, "preload must expose thread context packets");
assert.match(preload, /getCodexProjectHistory/, "preload must expose project history search");
assert.match(preload, /listLongCodexThreads/, "preload must expose automatic long-thread triage");
assert.match(main, /readGuardianInventory/, "old-thread triage must read Guardian inventory instead of only largest session files");
assert.match(main, /stale_ceo_created_thread/, "old-thread triage must include stale CEO-created worker/review/audit threads");
assert.match(main, /metadata_only_stale_role_scan/, "stale CEO-created scans should use inventory metadata instead of slow per-thread context commands");
assert.match(main, /STALE_CEO_CREATED_THREAD_DAYS\s*=\s*3/, "CEO-created threads must use the 3-day stale-thread rule");
assert.match(preload, /optimizeCodexThread/, "preload must expose old-thread optimization");
assert.match(preload, /updateDocumentContent/, "preload must expose safe document content edits");
assert.match(preload, /getRuntimeMonitorSnapshot/, "preload must expose runtime monitor snapshots");
assert.match(viteEnv, /export type ExperienceCard/, "renderer types must include ExperienceCard");
assert.match(viteEnv, /sourceRefs\?: SourceRef\[\]/, "ExperienceCard type must expose persisted source refs");
assert.match(viteEnv, /rawSessionPolicy\?: string \| null/, "ExperienceCard type must expose raw session policy");
assert.match(viteEnv, /sourceDocumentId\?: string \| null/, "ExperienceCard type must expose source document id");
assert.match(viteEnv, /sourceDocumentUpdatedAt\?: string \| null/, "ExperienceCard type must expose source document updatedAt");
assert.match(viteEnv, /sourceSignatureReviewState\?: "unreviewed" \| "current" \| "stale"/, "ExperienceCard type must expose source-signature review state");
assert.match(viteEnv, /curationDecision\?: ExperienceCardCurationDecision/, "ExperienceCard type must expose curation decision");
assert.match(viteEnv, /duplicateGroupKey\?: string \| null/, "ExperienceCard type must expose duplicate group key");
assert.match(viteEnv, /suggestedMergeTargetId\?: string \| null/, "ExperienceCard type must expose suggested merge target");
assert.match(viteEnv, /export type ExperienceCardStatus/, "renderer types must include ExperienceCardStatus");
assert.match(viteEnv, /export type ExperienceCardGovernanceOptions/, "renderer types must include experience-card governance update options");
assert.match(viteEnv, /export type SkillCandidate/, "renderer types must include SkillCandidate");
assert.match(viteEnv, /export type SkillCandidateStatus/, "renderer types must include SkillCandidateStatus");
assert.match(viteEnv, /export type KnowledgeItem/, "renderer types must include KnowledgeItem");
assert.match(viteEnv, /export type AgentRetrieveKind\s*=[^;]*"project_record"[^;]*"project_resume_packet"[^;]*"ceo_flow_record"[^;]*"thread_lineage_index"[^;]*"project_artifact"/s, "renderer retrieval kinds must type ProjectRecord, Resume Packet, CEOFlowRecord, ThreadLineageIndex and ProjectArtifact");
assert.match(viteEnv, /export type AgentRetrieveOptions/, "renderer types must include AgentRetrieveOptions");
assert.match(viteEnv, /parentCeoThreadId\?: string \| null/, "renderer retrieval options must type parentCeoThreadId for CEO lineage lookups");
assert.match(viteEnv, /export type AgentRetrieveResult/, "renderer types must include AgentRetrieveResult");
assert.match(viteEnv, /export type AgentRetrieveLogEntry/, "renderer types must include AgentRetrieveLogEntry");
assert.match(viteEnv, /export type SourceRef/, "renderer types must include SourceRef");
assert.match(viteEnv, /artifactType\?: string \| null/, "SourceRef type must expose optional artifactType");
assert.match(viteEnv, /sourceType\?: string \| null/, "SourceRef type must expose optional sourceType");
assert.match(viteEnv, /export type CodexGuardianReport/, "renderer types must include Codex Guardian report");
assert.match(viteEnv, /export type CodexGuardianCleanReceipt/, "renderer types must include Guardian clean receipt");
assert.match(viteEnv, /export type CodexGuardianHistoryEnvelope/, "renderer types must include Guardian history envelope");
assert.match(viteEnv, /export type CodexGuardianHistoryItem/, "renderer types must include Guardian history items");
assert.match(viteEnv, /retrieveAgentContext:/, "renderer API must type agent retrieval");
assert.match(viteEnv, /RuntimeContextPacket/, "renderer API must type RuntimeContextPacket");
assert.match(viteEnv, /export type ThreadRecoveryPacket/, "renderer types must include ThreadRecoveryPacket");
assert.match(viteEnv, /recoverMemoryRuntimeThread:/, "renderer API must type recoverMemoryRuntimeThread");
assert.match(viteEnv, /rawSessionDefaultRead:\s*false/, "ThreadRecoveryPacket type must preserve no raw-session default read");
assert.match(viteEnv, /EvidenceWritebackPacket/, "renderer API must type EvidenceWritebackPacket");
assert.match(viteEnv, /FlowSkillCandidateRecord/, "renderer API must type FlowSkillCandidateRecord");
assert.match(viteEnv, /WorkingMemoryRecord/, "renderer API must type WorkingMemoryRecord");
assert.match(viteEnv, /MemoryFact/, "renderer API must type temporal MemoryFact");
assert.match(viteEnv, /MemoryRuntimeTriggerReceipt/, "renderer API must type Memory Runtime trigger receipts");
assert.match(appTsx, /data-e2e="memory-runtime-diagnostics"/, "Smart optimization UI must expose Memory Runtime diagnostics");
assert.match(appTsx, /运行记忆检索/, "Smart optimization UI must provide an explicit Memory Runtime trigger");
assert.match(appTsx, /view !== "agent"/, "hidden views must not continuously run retrieval work");
assert.match(viteEnv, /listFlowSkillCandidates:/, "renderer API must type FlowSkill candidate list");
assert.match(viteEnv, /promoteMemory:/, "renderer API must type promote_memory");
assert.match(viteEnv, /listRetrieveLogs:/, "renderer API must type retrieval logs");
assert.match(viteEnv, /getCodexGuardianReport:/, "renderer API must type Guardian report");
assert.match(viteEnv, /cleanCodexHotLogs:/, "renderer API must type hot-log cleanup");
assert.match(viteEnv, /searchCodexHistory:/, "renderer API must type old-thread search");
assert.match(viteEnv, /getCodexThreadContext:/, "renderer API must type thread context packet");
assert.match(viteEnv, /listLongCodexThreads:/, "renderer API must type automatic long-thread triage");
assert.match(viteEnv, /optimizeCodexThread:/, "renderer API must type old-thread optimization");
assert.match(viteEnv, /updateDocumentContent:/, "renderer API must type safe document content edits");
assert.match(viteEnv, /export type AgentRuntimeMonitorSnapshot/, "renderer types must include Agent Runtime Monitor snapshots");
assert.match(viteEnv, /AgentRuntimePlatformSupport/, "renderer types must expose Runtime Monitor platform support status");
assert.match(viteEnv, /vaultManifestPath\?: string \| null/, "renderer runtime session types must expose vault manifest evidence");
assert.match(viteEnv, /memoryPointers\?: string\[\]/, "renderer runtime session types must expose memory pointer evidence");
assert.match(viteEnv, /compactReceiptPath\?: string \| null/, "renderer runtime session types must expose compact receipt evidence");
assert.match(viteEnv, /RuntimeEventWritebackSummary/, "renderer types must expose runtime event writeback receipts");
assert.match(viteEnv, /observeRuntimeEvents\?: boolean/, "runtime monitor options must allow disabling event writeback for dry-run tests");
assert.match(viteEnv, /getRuntimeMonitorSnapshot:/, "renderer API must type runtime monitor snapshots");
assert.match(viteEnv, /updateExperienceCardStatus:/, "renderer API must type experience status updates");
assert.match(viteEnv, /options\?: ExperienceCardGovernanceOptions/, "renderer API must type optional experience governance options");
assert.match(viteEnv, /updateSkillCandidateStatus:/, "renderer API must type skill candidate status updates");
assert.match(viteEnv, /importAutoflowExperience/, "renderer API must type AutoFlow import");
assert.match(appTsx, /写回队列|待确认记忆/, "Memory UI must expose a writeback queue");
assert.match(appTsx, /data-e2e="scan-activity"/, "Project scanning must expose a visible scan activity panel");
assert.match(appTsx, /正在扫描并整理项目/, "Project scan should show an explicit in-progress message");
assert.match(appTsx, /自动整理 \${result\.generatedKnowledge \|\| 0} 条知识和 \${toolRecordCount} 条工具资产候选/, "Project scan completion should report auto-generated knowledge and tool counts");
assert.match(appTsx, /按项目分类的知识/, "Knowledge UI must organize generated knowledge by project");
assert.match(appTsx, /按项目分类的记忆/, "Memory UI must organize memories by project");
assert.match(appTsx, /displayKnowledgeTitle/, "Knowledge UI must derive readable display titles instead of raw source-only labels");
assert.match(appTsx, /displayMemoryTitle/, "Memory UI must derive readable display titles instead of raw source-only labels");
assert.match(appTsx, /projectLabel\(effectiveProjectPath\)/, "Agent retrieval scope should expose the current project label");
assert.match(main, /generateKnowledgeItems\(\{ mode: "heuristic", projectPath, seedMemoryCore: false \}\)/, "Project scan must automatically generate project-scoped heuristic knowledge items without duplicating its explicit seed");
assert.match(main, /buildReadableKnowledgeTitle/, "Heuristic knowledge generation must create readable display titles");
assert.match(main, /site-packages/, "Project scan must skip Python dependency directories");
assert.match(main, /hasSkippedScanSegment\(fullPath\)/, "Project scan skip checks must be case-insensitive and segment-based");
assert.match(viteEnv, /generatedKnowledge\?: number/, "Renderer scan contract must expose generated knowledge counts");
assert.match(styles, /scan-activity/, "Styles must include a stable scan activity panel");
assert.match(styles, /project-group-heading/, "Styles must support project-grouped knowledge and memory sections");
assert.match(appTsx, /updateProjectDocCandidateBatch/, "Memory UI must expose scoped batch governance for project history candidates");
assert.match(appTsx, /sourceType === "project_doc"/, "Batch memory governance must only target project_doc candidates");
assert.match(appTsx, /保留当前历史候选/, "Memory UI must offer batch keep for current project history candidates");
assert.match(appTsx, /拒绝当前历史候选/, "Memory UI must offer batch reject for current project history candidates");
assert.match(appTsx, /归档当前历史候选/, "Memory UI must offer batch archive for current project history candidates");
assert.match(appTsx, /来源签名/, "Memory detail UI must expose source-signature review state");
assert.match(appTsx, /重复治理/, "Memory detail UI must expose duplicate governance");
assert.match(appTsx, /合并目标/, "Memory detail UI must expose suggested merge target");
assert.match(styles, /writeback-bulk-actions/, "Memory batch governance controls must have stable responsive styling");
assert.match(appTsx, /确认/, "Memory UI should allow confirming experience cards");
assert.match(appTsx, /精选/, "Memory UI should allow curating experience cards");
assert.match(appTsx, /归档/, "Memory UI should allow archiving experience cards");
assert.match(appTsx, /批准草稿/, "Memory UI should allow approving skill drafts");
assert.match(appTsx, /拒绝/, "Memory UI should allow rejecting skill drafts");
assert.match(appTsx, /收起检索|展开检索/, "Retrieval inspector should allow collapsing for narrow desktop widths");
assert.match(appTsx, /retrieveAgentContext\(\{[\s\S]*queryType:\s*"task_dispatch"[\s\S]*projectPath:/, "App must call the main retrieval contract with project-scoped task dispatch options");
assert.match(appTsx, /setAgentRetrieveMode\("local_contract"\)/, "App must prefer the local retrieval contract when preload exposes it");
assert.match(appTsx, /新线程接手要看的摘要/, "Project overview must expose the project resume packet in product language");
assert.match(appTsx, /AI 可用资料/, "Project overview must expose the ProjectArtifact governance map in product language");
assert.match(appTsx, /哪些历史和资料可以放心调取/, "Project overview must explain generated project artifact files as AI-usable sources");
assert.match(appTsx, /这只是来源目录和摘要，不替代真实源文件/, "ProjectArtifact overview must stay explicit that it is metadata-only");
assert.match(appTsx, /待复核/, "ProjectArtifact overview must distinguish rebuild-required re-review from first-time confirmation");
assert.match(appTsx, /confirmProjectArtifactsMap/, "Project overview must persist ProjectArtifact map confirmation snapshots");
assert.match(appTsx, /Codex 会把这批项目资料当作可优先检索的来源/, "ProjectArtifact overview should explain automatic AI-usable sources without forcing a confirm-index action");
assert.match(viteEnv, /projectArtifactConfirmations\?:/, "Renderer settings must type ProjectArtifact map confirmations");
assert.match(main, /tools:scanInventory/, "main process must expose Tool/Skill inventory scan IPC");
assert.match(main, /tools:inventory/, "main process must expose Tool/Skill inventory read IPC");
assert.match(main, /tools:confirmInventory/, "main process must expose Tool/Skill inventory confirmation IPC");
assert.match(main, /CREATE TABLE IF NOT EXISTS tool_skill_record_governance/, "main process must persist per-record Tool/Skill governance in SQLite");
assert.match(main, /tools:updateRecordGovernance/, "main process must expose per-record Tool/Skill governance IPC");
assert.match(main, /Tool\/Skill inventory snapshot hash changed before per-record governance update/, "per-record Tool/Skill governance must be bound to the current live snapshot hash");
assert.match(main, /recordContextHash/, "per-record Tool/Skill governance must store record context hashes");
assert.match(main, /reviewState[\s\S]*stale/, "per-record Tool/Skill governance must expose stale decisions when record context changes");
assert.match(main, /toolSkillInventoryConfirmations/, "main process must persist Tool/Skill inventory confirmations in settings");
assert.match(main, /snapshotHash[\s\S]*Tool\/Skill inventory snapshot hash changed before confirmation/, "Tool/Skill confirmation must be bound to the current snapshot hash");
assert.match(main, /doesNotInstall:\s*true[\s\S]*doesNotExecute:\s*true[\s\S]*doesNotActivateCandidates:\s*true/, "Tool/Skill inventory IPC must expose read-only candidate governance flags");
assert.match(preload, /scanToolSkillInventory/, "preload must expose Tool/Skill inventory scan");
assert.match(preload, /getToolSkillInventory/, "preload must expose Tool/Skill inventory read");
assert.match(preload, /confirmToolSkillInventory/, "preload must expose Tool/Skill inventory confirmation");
assert.match(preload, /updateToolSkillRecordGovernance/, "preload must expose per-record Tool/Skill governance updates");
assert.match(viteEnv, /toolSkillInventoryConfirmations\?:/, "renderer settings must type Tool/Skill inventory confirmations");
assert.match(viteEnv, /export type ToolSkillRecordGovernance/, "renderer must type per-record Tool/Skill governance metadata");
assert.match(viteEnv, /updateToolSkillRecordGovernance:/, "renderer API must type per-record Tool/Skill governance updates");
assert.match(viteEnv, /export type ToolSkillInventoryResult/, "renderer must type Tool/Skill inventory results");
assert.match(appTsx, /工具资产目录/, "Project overview must expose the tool asset catalog card");
assert.match(appTsx, /key:\s*"tools",\s*label:\s*"工具"/, "Main nav must expose a first-class Tools page");
assert.match(appTsx, /function renderToolsWorkspace/, "Renderer must implement the first-class Tool/Skill page");
assert.match(appTsx, /工具资产目录/, "Tools page must expose a Chinese tool asset catalog");
assert.match(appTsx, /displayToolChineseName/, "Tools page must use readable actual tool names");
assert.match(appTsx, /干什么用/, "Tools page must explain what each tool does");
assert.match(appTsx, /创建 \/ 更新/, "Tools page must show created or updated time");
assert.match(appTsx, /使用项目/, "Tools page must show where a tool has been used");
assert.match(appTsx, /自建 \/ 项目内工具/, "Tools page must group custom or project-local tools");
assert.match(appTsx, /Codex 官方 \/ 全局/, "Tools page must group official/global Codex assets separately");
assert.match(appTsx, /scanToolSkillInventorySnapshot/, "Tools page must support refresh/scan through existing IPC");
assert.match(main, /discoverSkillCollectionRoots/, "Tool inventory must discover plugin and imported skill collection roots");
assert.match(main, /vendor_imports/, "Tool inventory must scan imported skill roots such as curated screenshot tools");
assert.match(main, /plugins", "cache"/, "Tool inventory must scan installed plugin cache skill roots");
assert.match(main, /generatedToolSkillRecords/, "Codex workspace scan must report all-project Tool/Skill record counts");
assert.match(viteEnv, /generatedToolSkillRecords\?: number/, "renderer scan result type must expose all-project Tool/Skill counts");
assert.match(appTsx, /按来源整理的工具资产/, "Tools page must list candidate records by source group");
assert.match(appTsx, /治理状态/, "Tools page must show per-record Tool/Skill governance metadata");
assert.match(appTsx, /updateToolSkillRecordGovernance/, "Tools page must let users update per-record governance metadata");
assert.match(appTsx, /confirmed\/rejected\/deprecated\/blocked|confirmed.*rejected.*deprecated.*blocked/s, "Tools page must expose confirm/reject/deprecated/blocked governance states");
assert.match(appTsx, /风险边界/, "Tools page must show record risk boundaries");
assert.match(appTsx, /允许命令/, "Tools page must show record safe commands");
assert.match(appTsx, /禁止命令/, "Tools page must show record forbidden commands");
assert.match(appTsx, /<dt>来源<\/dt>/, "Tools page must show record source refs");
assert.match(appTsx, /这里只整理，不安装、不启用、不执行/, "Tools page must not imply per-record active promotion");
assert.match(appTsx, /只整理，不执行/, "Tools page must frame governance as metadata-only product organization");
assert.match(appTsx, /不安装 \/ 不执行/, "Tools page must keep install/enable/execute/promotion boundaries explicit");
assert.match(styles, /tools-dashboard/, "Styles must support the Tool/Skill page dashboard");
assert.match(styles, /tool-record-card/, "Styles must support Tool/Skill candidate record cards");
assert.match(styles, /tool-record-icon/, "Styles must support official/custom tool icons");
assert.match(styles, /tool-governance-actions/, "Styles must support per-record Tool/Skill governance actions");
assert.match(appTsx, /给人看的目录[\s\S]*给 AI 看的目录/, "Tool/Skill UI must display human and AI inventory outputs");
assert.match(appTsx, /confirmToolSkillInventorySnapshot/, "Project overview must persist Tool/Skill inventory snapshot confirmations");
assert.doesNotMatch(appTsx, />\s*确认资产快照\s*</, "Tool/Skill UI should not put confirm-snapshot as a default visible action");
assert.match(appTsx, /不会安装、启用、执行或提升候选状态/, "Tool/Skill UI must keep read-only candidate boundaries explicit");
assert.match(prd, /待确认\/待复核/, "PRD must document that ProjectArtifact snapshot confirmations naturally return to pending review when hashes change");
assert.match(prd, /不代表每条 artifact 都已治理完成/, "PRD must keep snapshot confirmation scoped below per-artifact governance");
assert.match(prd, /per-artifact override planned/, "PRD must keep per-artifact overrides in the planned bucket");
assert.match(prd, /未来规划：项目记忆回填和续接流程（planned，不是当前 MVP）/, "PRD must label the project memory continuation flow as planned future governance");
assert.match(prd, /老线程归档队列流程（MVP，宿主桥接执行）/, "PRD must document the implemented archive queue and host-bridge execution boundary");
assert.match(prd, /Agent Runtime Monitor 和 Codex 工具\/Skill 资产图谱已有 MVP \/ policy-level \+ export-level 实现/, "PRD must distinguish implemented read-only/candidate/tool-inventory MVPs from future work");
assert.match(prd, /项目总览和一等工具页可通过最小 IPC\/UI 只读展示候选并确认当前 live inventory snapshot/, "PRD must mark the minimal Tool/Skill inventory IPC/UI/snapshot confirmation loop as implemented MVP");
assert.match(prd, /项目总览和一等工具页/, "PRD must mark the first-class Tool/Skill page as implemented MVP");
assert.match(prd, /SQLite-backed 单条候选治理 metadata/, "PRD must mark per-record Tool/Skill governance metadata as implemented");
assert.match(prd, /Agent retrieval 已支持 `tool_skill_record` bounded advisory kind/, "PRD must mark bounded ToolSkillRecord retrieval as implemented");
assert.match(prd, /Codex 宿主侧栏归档桥接仍需宿主执行/, "PRD must keep the Zhixia-app vs Codex-host archive boundary explicit");
assert.match(technicalDesign, /first-class 工具页 MVP/, "Technical design must mark the first-class Tool/Skill page as implemented MVP");
assert.match(technicalDesign, /tool_skill_record_governance/, "Technical design must document the per-record Tool/Skill governance table");
assert.match(technicalDesign, /`tool_skill_record`[\s\S]*compact advisory items/, "Technical design must document bounded ToolSkillRecord retrieval integration");
assert.match(testPlan, /打开主导航“工具”页/, "Test plan must include manual validation for the first-class Tool/Skill page");
assert.match(testPlan, /单条候选执行 confirmed\/rejected\/deprecated\/blocked\/clear/, "Test plan must cover per-record Tool/Skill governance metadata");
assert.match(testPlan, /查询 `tool_skill_record` 时只返回 compact advisory metadata/, "Test plan must cover bounded ToolSkillRecord retrieval behavior");
assert.match(technicalDesign, /runtimeMonitor:getSnapshot`：已实现只读 Codex-focused diagnostics snapshot/, "Technical design should describe runtime monitor as an implemented read-only snapshot");
assert.equal(pkg.license, "MIT", "package metadata must declare the public source license");
assert.match(license, /MIT License[\s\S]*Zhixia Contributors/, "Repository must include an MIT license for public source release");
assert.match(readme, /CEO Flow 的官方本地优先 Memory Runtime/, "README must position Zhixia as CEO Flow's official local Memory Runtime");
assert.match(readme, /retrieve_context[\s\S]*retrieve_precedent[\s\S]*writeback_evidence[\s\S]*promote_memory/, "README must name the public Memory Runtime hooks");
assert.match(readme, /source-only[\s\S]*\.codex-knowledge\/[\s\S]*release\//, "README must explain source-only public repo boundaries");
assert.match(securityDoc, /Raw session bodies[\s\S]*FlowSkill candidates[\s\S]*Archive, compact, restore, delete, move/, "SECURITY.md must document local-first Memory Runtime safety boundaries");
assert.match(contributingDoc, /Privacy Guardrails[\s\S]*\.codex-knowledge\/[\s\S]*Raw Codex session JSONL/, "CONTRIBUTING.md must forbid committing private/generated memory artifacts");
assert.match(ceoFlowMemoryRuntimeDoc, /retrieve_context\(task_goal\)[\s\S]*retrieve_precedent\(task_type\)[\s\S]*writeback_evidence\(result\)[\s\S]*promote_memory\(candidate\)/, "CEO Flow integration doc must define the Memory Runtime lifecycle hooks");
assert.match(ceoFlowMemoryRuntimeDoc, /observe_event\(event\)[\s\S]*broken_thread[\s\S]*heartbeat_fuse[\s\S]*thread_takeover/, "CEO Flow integration doc must define event-triggered short-term memory hooks");
assert.match(ceoFlowMemoryRuntimeDoc, /none[\s\S]*project-memory[\s\S]*zhixia-local-docs[\s\S]*guardian-history[\s\S]*hybrid/, "CEO Flow integration doc must define provider modes");
assert.match(ceoFlowMemoryRuntimeDoc, /No raw sessions by default[\s\S]*No giant Markdown by default[\s\S]*Promotion is fail-closed/, "CEO Flow integration doc must keep hard safety boundaries explicit");
assert.match(publicationChecklist, /Must Not Publish[\s\S]*\.codex-knowledge\/[\s\S]*Real Codex session JSONL[\s\S]*Release installers/, "Publication checklist must list private/generated artifacts to exclude");
assert.match(publicRepoLayout, /Include[\s\S]*electron\/[\s\S]*src\/[\s\S]*tests\/[\s\S]*Exclude[\s\S]*vaults\/[\s\S]*evidence\//, "Public repo layout must explain source include/exclude paths");
assert.match(pkg.scripts["prepare:public"], /node scripts\/prepare-public-repo\.cjs/, "package scripts must expose a safe public staging command");
assert.match(pkg.scripts.test, /prepare-public-repo-policy\.test\.cjs/, "Default npm test must include public staging sanitizer behavior tests");
assert.match(preparePublicRepoScript, /assertOwnedStagingTarget[\s\S]*path\.relative\(resolvedRoot,\s*resolvedTarget\)[\s\S]*zhixia-local-doc-knowledge/, "Public staging script must verify it only recreates its owned staging directory");
assert.match(preparePublicRepoScript, /const rootFiles = new Set[\s\S]*LICENSE[\s\S]*README\.md[\s\S]*package-lock\.json/, "Public staging script must copy root files from an explicit whitelist");
assert.match(preparePublicRepoScript, /const publicDocs = new Set[\s\S]*CEO_FLOW_MEMORY_RUNTIME\.md[\s\S]*PUBLIC_REPO_LAYOUT\.md[\s\S]*TEST_PLAN\.md/, "Public staging script must whitelist public docs");
assert.match(preparePublicRepoScript, /blockedNames[\s\S]*\.codex-knowledge[\s\S]*node_modules[\s\S]*release[\s\S]*vaults[\s\S]*private-evidence/, "Public staging script must block private/generated directories");
assert.doesNotMatch(preparePublicRepoScript, /const publicDirs = new Set\(\[[\s\S]*"build"/, "Public staging should not copy installer build helpers by default");
assert.doesNotMatch(preparePublicRepoScript, /const publicScripts = new Set\(\[[\s\S]*apply-windows-icon\.cjs/, "Public staging should not copy packaging icon helper by default");
assert.match(preparePublicRepoScript, /writePublicReleaseNotes[\s\S]*public-safe generated replacement/, "Public staging script must replace private release notes with public-safe notes");
assert.match(preparePublicRepoScript, /function privatePublicationTermPatterns[\s\S]*\\b[\s\S]*sanitizePublicCodeText[\s\S]*replacePrivateTerms: false[\s\S]*module\.exports/, "Public staging sanitizer must use bounded private-term patterns and export code/doc sanitizers for behavior tests");
assert.match(preparePublicRepoScript, /preserveStagingGitMetadata[\s\S]*restoreStagingGitMetadata/, "Public staging refresh must preserve the staging Git repository metadata");
assert.match(preparePublicRepoScript, /entry\.name === "\.git"[\s\S]*continue/, "Public staging manifest must not enumerate Git internals");
assert.match(preparePublicRepoScript, /Memory Core 0\.9\.0 adds an app-owned Authority Core/, "Public release notes must describe the current Memory Core release");
assert.match(preparePublicRepoScript, /node:sqlite sidecar stores compact Memory Core governance records/, "Public release notes must describe the current incremental Memory Core sidecar");
assert.match(preparePublicRepoScript, /PUBLIC_STAGING_MANIFEST\.md/, "Public staging script must write a staging manifest");
assert.match(preparePublicRepoScript, /Excluded Legacy Docs[\s\S]*zhixia-complete-product-goal\.md[\s\S]*RELEASE_COMPLETION_AUDIT\.md[\s\S]*private optimization monitors[\s\S]*private project evaluations/, "Public staging script must exclude private legacy doc categories without publishing private codenames");
assert.match(publicRepoLayout, /npm run prepare:public[\s\S]*PUBLIC_STAGING_MANIFEST\.md[\s\S]*zhixia-complete-product-goal\.md[\s\S]*RELEASE_COMPLETION_AUDIT\.md[\s\S]*private optimization monitors[\s\S]*project evaluations/, "Public repo layout must document staging and private legacy doc exclusions without private codenames");
assert.doesNotMatch(publicationChecklist, new RegExp("App" + "Data"), "Publication checklist should avoid platform-specific private path strings in public staging docs");
assert.match(publicationChecklist, /Required Staging Step[\s\S]*npm run prepare:public[\s\S]*zhixia-complete-product-goal\.md[\s\S]*RELEASE_COMPLETION_AUDIT\.md[\s\S]*private optimization monitors[\s\S]*project evaluations/, "Publication checklist must require staging and exclude private legacy doc categories");
assert.match(gitignore, /\.codex-knowledge\/[\s\S]*\*\*\/\.codex-knowledge\//, ".gitignore must protect generated .codex-knowledge memory artifacts");
assert.match(gitignore, /\*\.sqlite[\s\S]*\*\.sqlite3[\s\S]*userData\//, ".gitignore must protect local database and app data files");
assert.match(gitignore, /vaults\/[\s\S]*backups\/[\s\S]*private-evidence\//, ".gitignore must protect vault, backup, and private evidence artifacts");
assert.match(gitignore, /release\/[\s\S]*\*\.blockmap[\s\S]*\*\.exe/, ".gitignore must protect release installers and package metadata");
assert.doesNotMatch(readme, /C:\\Users\\example\\Documents\\Playground\\ExampleStudio\\workflow/, "README should not expose a personal workflow path");
if (!isPublicSourceStaging) {
  assert.match(codexOptimizationMonitor, /待确认 \/ 待复核 \/ 已确认/, "Optimization monitor must track the snapshot governance states explicitly");
}
assert.match(appTsx, /这个项目现在做到哪了/, "Project overview must expose the ProjectRecord confirmation card in product language");
assert.match(appTsx, /function projectCompletionLabel/, "Project progress UI must map internal completion enums to Chinese labels");
assert.match(appTsx, /想法[\s\S]*需求[\s\S]*设计[\s\S]*开发中[\s\S]*测试中[\s\S]*打包中[\s\S]*已发布[\s\S]*维护中/, "Project completion labels must be user-facing Chinese stages");
assert.match(appTsx, /projectRecordStatusLabel\(projectRecordOverride\.status\)[\s\S]*projectCompletionLabel\(projectRecordOverride\.completion\)/, "Project overview must not print raw ProjectRecord status/completion enums");
assert.match(appTsx, /project-card[\s\S]*projectCompletionLabel\(progressStage\)/, "Project card grid must show Chinese progress stage labels");
assert.match(appTsx, /function readableProjectDisplayName/, "Project cards must derive a readable project name instead of only showing raw folder names");
assert.match(appTsx, /function projectCardSummaryText/, "Project cards must derive a Chinese summary instead of raw JSON or Markdown excerpts");
assert.match(appTsx, /project-card[\s\S]*isUsefulProjectCardTitle\(projectRecordOverride\?\.displayName\)[\s\S]*readableProjectDisplayName\(project\.path,\s*projectDocs\)[\s\S]*projectCardSummaryText\(project\.path,\s*projectDocs,\s*projectMemory,\s*projectKnowledge,\s*projectRecordOverride\?\.lastSummary\)/, "Project card grid must use readable names and SkillRunner/AI/knowledge-backed summaries");
assert.match(appTsx, /projectKnowledgeSummaryText/, "Project cards must prefer existing AI or knowledge-item summaries before raw document snippets");
assert.match(appTsx, /AI 生成摘要/, "Project home must expose an AI summary action for project cards");
assert.match(main, /CREATE TABLE IF NOT EXISTS zhixia_skills/, "main process must persist Zhixia Skill definitions");
assert.match(main, /CREATE TABLE IF NOT EXISTS skill_run_receipts/, "main process must persist Zhixia Skill run receipts");
assert.match(main, /project-summary-cn/, "main process must ship the project-summary-cn built-in Zhixia workflow module");
assert.match(main, /version:\s*"0\.2\.0"/, "project-summary-cn must be upgraded after content-summary quality fixes");
assert.match(main, /summary 必须是内容总结，不是摘录原文/, "project-summary-cn prompt must require content summaries instead of raw excerpts");
assert.match(main, /cleanProjectSummaryCandidate/, "project summary workflow must sanitize raw JSON/Markdown/path/task noise");
assert.match(main, /projectSummaryDocumentScore/, "project summary workflow must rank useful PRD/readme/report sources before noisy recent files");
assert.match(main, /<codex_delegation/, "project summary workflow must explicitly reject delegated-thread XML noise");
assert.match(main, /runProjectSummarySkill/, "main process must implement a runnable project-summary workflow module");
assert.match(main, /zhixiaSkills:run/, "main process must expose Zhixia Skill runner IPC");
assert.match(main, /settings\.projectRecordOverrides/, "project summary workflow must write readable summaries into ProjectRecord overrides");
assert.match(preload, /runZhixiaSkill/, "preload must expose the Zhixia Skill runner");
assert.match(viteEnv, /export type ZhixiaSkillDefinition/, "renderer types must include Zhixia Skill definitions");
assert.match(viteEnv, /export type SkillRunReceipt/, "renderer types must include SkillRunReceipt evidence");
assert.match(viteEnv, /runZhixiaSkill:/, "renderer API must type the Zhixia Skill runner");
assert.match(appTsx, /function generateProjectSummaries/, "Project home AI summary action must call the Zhixia SkillRunner");
assert.match(appTsx, /skillId:\s*"project-summary-cn"/, "Project summary action must invoke the project-summary-cn workflow module");
assert.match(appTsx, /function generateSingleProjectSummary/, "Project detail must support refreshing a single project summary through SkillRunner");
assert.match(appTsx, /刷新本项目摘要/, "Project detail must expose a single-project summary refresh action");
assert.match(appTsx, /function loadZhixiaSkills/, "Renderer must load Zhixia Skill definitions and receipts");
assert.match(appTsx, /知匣流程模块/, "Settings must expose a visible Zhixia workflow module panel");
assert.match(appTsx, /最近运行回执/, "Settings must expose recent SkillRunReceipt evidence");
assert.match(appTsx, /zhixiaSkillStatusLabel/, "Renderer must map SkillRunReceipt statuses to Chinese labels");
assert.match(appTsx, /isUsefulProjectCardTitle/, "Project cards must reject noisy generated titles");
assert.match(appTsx, /<codex_delegation\|source_thread_id\|task_id\|C:\\\\/, "Project cards must reject delegated-thread/path noise from stale generated titles");
assert.match(appTsx, /重复文件\|<codex_delegation\|source_thread_id\|task_id\|\\"version\\"\|C:\\\\/, "Project cards must reject stale raw summaries written before the content-summary fix");
assert.match(appTsx, /projectRecordOverride\?\.displayName/, "Project cards must use SkillRunner-generated Chinese display names when available");
assert.match(appTsx, /projectRecordOverride\?\.lastSummary/, "Project cards must use SkillRunner-generated summaries when available");
assert.match(styles, /zhixia-skill-grid/, "Styles must support the Zhixia workflow module card grid");
assert.match(styles, /skill-receipt-row/, "Styles must support SkillRunReceipt rows");
assert.match(appTsx, /"projectPath"[\s\S]*return ""/, "Project card summary cleaner must suppress raw projectPath JSON snippets");
assert.match(appTsx, /<!doctype\|<html\|<head\|<body\|<meta/, "Project card summary cleaner must suppress raw HTML snippets");
assert.match(appTsx, /"test name"[\s\S]*success[\s\S]*HTTP\\s\+\\d\{3\}/, "Project card summary cleaner must suppress raw test-result JSON snippets");
assert.match(appTsx, /function projectActivityScore/, "Project cards must sort by product activity instead of raw scan order");
assert.match(appTsx, /isLikelyDependencyProject[\s\S]*dependencyPenalty/, "Project activity sort must demote dependency folders and non-project scan noise");
assert.match(appTsx, /projectCards[\s\S]*activityScore[\s\S]*sort/, "Project home must render activity-sorted project cards");
assert.match(appTsx, /documentsByProject[\s\S]*new Map<string, KnowledgeDocument\[\]>/, "Project cards must derive from a documentsByProject map instead of project-by-project full document filters");
assert.doesNotMatch(appTsx, /const projectCards[\s\S]{0,600}documents\.filter\(\(doc\) => doc\.workspacePath === project\.path\)/, "Project cards must not filter all documents once per project");
assert.match(appTsx, /type ProjectClassificationKind = "project" \| "lead" \| "non_project"/, "Project detection must classify project candidates explicitly");
assert.match(appTsx, /function pathLooksLikeNonProjectSource[\s\S]*node_modules[\s\S]*codex-history-vault[\s\S]*clipboard[\s\S]*截图/, "Project detection must demote dependency, vault, clipboard, screenshot, and generated-source paths");
assert.match(appTsx, /function classifyProjectCandidate[\s\S]*strongProjectArtifacts[\s\S]*supportingProjectArtifacts[\s\S]*单条资料，缺少项目上下文/, "Project detection must score positive project evidence and negative one-off material");
assert.match(appTsx, /projectCards[\s\S]*classification\.kind === "project"/, "Top-level project cards must include only real project classifications");
assert.match(appTsx, /projectLeads[\s\S]*classification\.kind === "lead"[\s\S]*待整理线索/, "Low-confidence project-like items must move to a secondary lead bucket");
assert.doesNotMatch(appTsx, /activeProject \|\| projectCards\[0\]\?\.project\.path \|\| projects\[0\]\?\.path/, "Project view must not fall back to the first raw workspace after demotion");
assert.match(appTsx, /function personalVaultTitle/, "Personal vault cards must derive readable titles");
assert.match(appTsx, /function personalVaultSummary/, "Personal vault cards must derive readable summaries");
assert.match(appTsx, /className=\{selectedVaultDocument\?\.id === doc\.id \? "vault-content-card selected" : "vault-content-card"\}/, "Personal vault must use content cards instead of raw document/path cards");
assert.doesNotMatch(appTsx, /<span className="vault-path">\{doc\.vaultPath\}<\/span>/, "Personal vault cards must not expose raw paths on card faces");
assert.doesNotMatch(appTsx, /projectRecordOverride\.status\} \/ \$\{projectRecordOverride\.completion/, "Project overview must not concatenate raw status/completion enums");
assert.doesNotMatch(appTsx, /\$\{progressStage\} · \$\{healthLabel\}/, "Project sidebar must not render raw progressStage enums like prd/testing/unknown");
assert.match(appTsx, /confirmProjectRecordSnapshot/, "Project overview must persist ProjectRecord confirmation snapshots");
assert.match(appTsx, /项目来源已变化，需重新确认/, "ProjectRecord UI must show stale source confirmations in Chinese product language");
assert.doesNotMatch(appTsx, /source signature 已变化/, "Visible ProjectRecord UI should not expose source-signature engineering wording");
assert.doesNotMatch(appTsx, />\s*确认项目进度\s*</, "ProjectRecord UI should not ask normal users to confirm project progress from the default overview");
assert.match(appTsx, /项目续接摘要/, "Project overview must open generated project-resume content");
assert.match(appTsx, /confirmProjectResumePacket/, "Project overview must persist resume packet confirmation");
assert.match(appTsx, /saveProjectResumePacket/, "Project document detail must save edited Project Resume Packet markdown");
assert.match(appTsx, /Markdown 改写/, "Project Resume Packet detail must expose a markdown rewrite editor");
assert.match(styles, /markdown-editor/, "Project Resume Packet editor must have stable textarea styling");
assert.match(viteEnv, /projectResumeConfirmations\?:/, "Renderer settings must type resume packet confirmations");
assert.match(viteEnv, /projectRecordOverrides\?:/, "Renderer settings must type ProjectRecord confirmation overrides");
assert.match(viteEnv, /projectRecordSourceSignature\?:/, "Renderer settings must type ProjectRecord source signatures");
assert.match(viteEnv, /ExperienceCardStatus = "candidate" \| "accepted" \| "curated" \| "archived" \| "rejected" \| "stale"/, "Renderer must type rejected and stale experience-card governance states");
assert.match(appTsx, /updateExperienceStatus\(item\.id, "rejected"/, "Memory UI must expose rejected experience-card governance");
assert.match(appTsx, /updateExperienceStatus\(item\.id, "stale"/, "Memory UI must expose stale experience-card governance");
assert.match(appTsx, /project-layout--solo/, "Project workspace must not render the retrieval inspector over project content");
assert.match(appTsx, /Codex 连接维护/, "Settings UI must expose Codex health");
assert.match(appTsx, /清理运行日志/, "Settings UI must expose manual Codex log cleanup");
assert.match(appTsx, /不会删除、移动或修改线程历史/, "Cleanup UI must state session history is not cleaned");
assert.match(appTsx, /释放历史压力/, "Smart Optimization UI must expose old-thread management");
assert.match(appTsx, /自动体检/, "Agent UI must expose automatic long-thread triage");
const oneClickOptimizeOldThreadsSource = extractFunctionSource(appTsx, "oneClickOptimizeOldThreads");
const oneClickRelieveOldThreadPressureSource = extractFunctionSource(appTsx, "oneClickRelieveOldThreadPressure");
assert.match(appTsx, /<h3>旧线程历史整理<\/h3>/, "Smart Optimization UI must title the old-thread area without repeating the primary action label");
assert.equal((appTsx.match(/>\s*一键安全减负\s*</g) || []).length, 1, "Smart Optimization should expose only one visible one-click safe relief button");
assert.match(appTsx, /历史入库记录/, "Selected old-thread detail should describe persisted history rather than repeat the pressure-relief action");
assert.match(appTsx, /不需要再单独点入库或整理/, "Smart Optimization empty state must not ask normal users to run separate indexing actions");
assert.match(appTsx, /先关 Codex/, "Safe pressure relief UI must tell users to close Codex before one-click cleanup");
assert.match(appTsx, /一键安全减负会先清理 Codex 巨型运行日志/, "Safe pressure relief UI must include Codex hot-log cleanup in the primary flow");
assert.match(appTsx, /一键优化规则/, "Agent UI must explain one-click optimization rules");
assert.match(appTsx, /oneClickOptimizeOldThreads/, "Agent UI must wire one-click optimization flow");
assert.match(appTsx, /oneClickRelieveOldThreadPressure/, "Agent UI must wire one-click safe pressure relief flow");
assert.match(appTsx, /HistoryOptimizeProgress/, "Old-thread actions must expose progress state");
assert.match(appTsx, /function renderHistoryOptimizeProgress/, "Old-thread actions must render a visible progress indicator");
assert.match(styles, /history-progress-track/, "Old-thread progress indicator must have stable progress bar styles");
assert.match(appTsx, /CEO 创建线程 3 天[\s\S]*CEO 主线程 30 天[\s\S]*归属不明线程 3 天/, "Old-thread primary flow must explain the 3/30/3 cooling rules");
assert.match(appTsx, /CEO 创建的实现、审计、准备、回调线程 3 天未复用/, "Old-thread primary flow must explain CEO-created thread 3-day archive rule");
assert.match(appTsx, /超过冷却期的 CEO 子线程/, "Old-thread primary flow must scan stale CEO-created threads, not only large sessions");
assert.match(appTsx, /active\/running、未完成历史保险库、瘦身回执缺失或校验失败的线程会跳过/, "Old-thread primary flow must keep active and missing-evidence safety blockers visible");
assert.doesNotMatch(appTsx, /点一次[\s\S]{0,220}再备份并瘦身 session 本体/, "Old-thread primary copy must not imply one-click compacts session bodies");
assert.match(appTsx, /先保存完整历史[\s\S]*CEO 相关线程和大线程必须先有瘦身回执/, "Agent UI must explain safe relief preserves history before CEO/large threads can enter archive queue");
assert.match(appTsx, /老线程入库与瘦身候选生成完成/, "Agent UI must report old-thread vault indexing and slimming-candidate results");
assert.match(oneClickOptimizeOldThreadsSource, /generateArchiveQueueForItems/, "Advanced indexing-only old-thread flow must still generate a cold-thread archive queue after vaulting");
assert.doesNotMatch(oneClickOptimizeOldThreadsSource, /compactCodexThread/, "Primary one-click old-thread action must not compact sessions without a second explicit action");
assert.match(oneClickRelieveOldThreadPressureSource, /cleanCodexHotLogs[\s\S]*autoIngestCodexHistory/, "Safe pressure relief must clean Codex hot logs before preserving and slimming thread history");
assert.match(oneClickRelieveOldThreadPressureSource, /logCleanup\.refused[\s\S]*请关闭 Codex/, "Safe pressure relief must stop and tell users to close Codex when hot-log cleanup is refused");
assert.match(oneClickRelieveOldThreadPressureSource, /summarizeCodexLogCleanup/, "Safe pressure relief must report Codex hot-log cleanup in its completion summary");
assert.match(oneClickRelieveOldThreadPressureSource, /optimizeOneOldThread[\s\S]*compactCodexThread/, "Safe pressure relief must vault/index a thread before compacting it");
assert.match(oneClickRelieveOldThreadPressureSource, /limit:\s*1000/, "Safe pressure relief must request a full backlog scan instead of only the first 20 threads");
assert.match(main, /incrementalReliefAction/, "Long-thread triage must classify incremental work instead of reprocessing every vaulted thread");
assert.match(main, /alreadyProcessedCount/, "Long-thread triage must report already-processed threads separately from incremental work");
assert.match(main, /archiveQueueItems:\s*archiveQueueCandidates/, "Long-thread triage must return already-processed archive candidates for host queue refresh");
assert.match(appTsx, /archiveQueueBacklogItems/, "Safe pressure relief must refresh host archive queues for already-processed candidates");
assert.match(oneClickRelieveOldThreadPressureSource, /暂无新的入库\/瘦身任务；已重新生成待宿主归档队列/, "Safe pressure relief must not stop before queueing already-processed archive candidates");
assert.match(main, /skippedActiveCount/, "Archive queue generation must report active/current/recent skipped threads separately");
assert.match(appTsx, /autoIngestCodexHistory/, "Safe pressure relief must first ensure missing preservation evidence");
assert.match(appTsx, /自动保留[\s\S]*已保留[\s\S]*活跃跳过归档/, "Safe pressure relief UI must separate preserved, already-preserved, and skipped-active counts");
assert.match(appTsx, /已处理跳过/, "Safe pressure relief UI must tell users already-processed threads are skipped");
assert.match(oneClickRelieveOldThreadPressureSource, /incrementalCandidateCount/, "Safe pressure relief must use incremental candidate counts from the triage backlog");
assert.match(oneClickRelieveOldThreadPressureSource, /全量体检[\s\S]*剩余/, "Safe pressure relief must report full backlog and remaining work, not only batch completion");
assert.match(oneClickRelieveOldThreadPressureSource, /本批增量减负完成，仍有待处理/, "Safe pressure relief must not call a clipped batch fully complete");
assert.match(oneClickRelieveOldThreadPressureSource, /flushArchiveQueue[\s\S]*\(index \+ 1\) % 25 === 0/, "Safe pressure relief must periodically write archive queues during long full-backlog runs");
assert.match(oneClickRelieveOldThreadPressureSource, /isCeoGovernedThread[\s\S]*shouldCompact[\s\S]*long_thread[\s\S]*8 \* 1024 \* 1024/, "Safe pressure relief should compact CEO-governed threads and large pressure threads before queueing them");
assert.match(oneClickRelieveOldThreadPressureSource, /metadataOnly[\s\S]*stale_/, "Safe pressure relief should index stale CEO-created threads through the metadata-first path");
assert.match(oneClickRelieveOldThreadPressureSource, /optimized:\s*indexResult\.result\.optimized/, "Safe pressure relief must carry Thread History Vault evidence into archive queue candidates");
assert.doesNotMatch(oneClickRelieveOldThreadPressureSource, /bypassRoleCooling:\s*true/, "Safe pressure relief must respect role cooling rules instead of bypassing 3/30/3 thresholds");
assert.match(oneClickRelieveOldThreadPressureSource, /完整历史已保留在知匣/, "Safe pressure relief must report preserved history after compaction");
assert.match(oneClickRelieveOldThreadPressureSource, /generateArchiveQueueForItems/, "Safe pressure relief must generate a cold-thread archive queue after vaulting and slimming");
assert.match(appTsx, /冷线程归档队列/, "Smart Optimization UI must surface the generated cold-thread archive queue");
assert.match(appTsx, /需要宿主桥接/, "Archive queue UI must explain that Codex host bridge is needed for sidebar archiving");
assert.match(appTsx, /不保证修复所有 CPU 或鼠标卡顿/, "Old-thread UI must not imply slimming necessarily fixes CPU or mouse stutter");
assert.match(appTsx, /全部入库/, "Agent UI must support batch indexing for visible old threads");
assert.match(appTsx, /瘦身本体/, "Agent UI must expose explicit in-place old-thread slimming");
assert.match(appTsx, /瘦身全部可见/, "Agent UI must support batch in-place slimming for visible long threads");
assert.match(viteEnv, /compactCodexThread:/, "renderer API must type in-place old-thread slimming");
assert.match(main, /codexGuardian:compactThread/, "main process must expose in-place old-thread slimming IPC");
assert.match(main, /compact-session/, "main process must call Guardian compact-session");
assert.match(main, /validateCompactSessionReceipt/, "main process must validate compact-session receipts before reporting success");
assert.match(main, /writeZhixiaCompactReceiptEvidence/, "Main process must write Zhixia-owned compact receipt evidence after successful slimming");
assert.match(main, /isImageProtectedCompactError[\s\S]*buildImageProtectedCompactReceipt/, "Image-bearing old threads must receive protected skip receipt evidence instead of failing forever");
assert.match(main, /generateCodexArchiveQueue/, "Main process must generate a host-bridge archive queue");
assert.match(main, /readCodexArchiveBridgeState/, "Archive queue generation must read host bridge receipts before retrying ready items");
assert.match(main, /host_thread_not_found/, "Archive queue generation must cool host not-found thread ids instead of retrying them forever");
assert.match(main, /host_archive_persist_failed/, "Archive queue generation must preserve host archive persistence failures as diagnostic skipped state");
assert.match(appTsx, /host_thread_not_found:\s*"宿主侧栏未找到"/, "Archive queue UI must translate host not-found bridge receipts");
assert.match(viteEnv, /hostArchiveState\?:/, "Renderer types must expose host archive bridge skipped state");
assert.match(main, /Math\.min\(1000,\s*Math\.floor\(limit\)\)/, "Guardian command options must not clamp long-thread scans to 20");
assert.match(main, /safeArray\(options\.items\)\.slice\(0,\s*1000\)/, "Archive queue generation must not clip full backlog queueing to 50 items");
assert.match(main, /readZhixiaThreadHistoryVaultEvidence/, "Long-thread scans must attach existing Thread History Vault evidence for already-vaulted candidates");
assert.match(main, /vaultManifestPath:\s*file\.vaultManifestPath/, "Archive queue candidates must receive vault manifest evidence from existing vault records");
assert.match(main, /codexGuardian:generateArchiveQueue/, "Main process must expose archive queue generation IPC");
assert.match(preload, /generateCodexArchiveQueue/, "Preload must expose archive queue generation to the renderer");
assert.match(viteEnv, /CodexThreadArchiveQueue/, "Renderer types must expose Codex thread archive queue results");
assert.match(main, /runtimeMonitor:getSnapshot/, "main process must expose a read-only runtime monitor snapshot IPC");
assert.match(main, /collectRuntimeMonitorSnapshot/, "main process must collect runtime monitor snapshots through the adapter");
assert.match(main, /function persistRuntimeMonitorEvents/, "runtime monitor snapshots must persist observed runtime events for Memory Runtime recall");
assert.match(main, /getRuntimeMonitorSnapshot[\s\S]*persistRuntimeMonitorEvents\(snapshot,\s*options\)/, "runtime monitor snapshot must close the loop into RuntimeEventMemory");
assert.match(main, /observeRuntimeEvents === false[\s\S]*runtime_event_writeback_disabled_by_request/, "runtime monitor event writeback must be explicitly disableable for tests or dry runs");
assert.doesNotMatch(appTsx, /renderAgentWorkspace[\s\S]*renderRuntimeMonitorPanel\(/, "Smart Optimization default UI must not render the runtime monitor panel");
assert.doesNotMatch(appTsx, /实时压力监控/, "Smart Optimization visible copy should not expose realtime pressure monitoring as a default feature");
assert.match(appTsx, /getRuntimeMonitorSnapshot\(\{[\s\S]*sessionLimit:\s*12[\s\S]*includeLongThreadMetadata:\s*false/, "Agent runtime monitor UI must request a lightweight manual snapshot without long-thread triage");
assert.match(appTsx, /只看元数据，不读取原始会话正文/, "Agent runtime monitor UI must state it does not read raw session bodies");
assert.doesNotMatch(appTsx, /document\.visibilityState === "visible"[\s\S]*document\.hasFocus\(\)/, "Runtime monitor must not auto-refresh while the page is merely visible");
assert.match(appTsx, /CPU 到具体线程只能做证据驱动的疑似判断/, "Agent runtime monitor UI must avoid overclaiming thread CPU attribution");
assert.doesNotMatch(appTsx, /observedFacts \/ inferredAttribution \/ uncertainty/, "Runtime monitor visible copy should not lead with internal evidence field names");
assert.doesNotMatch(appTsx, /全部文档/, "Visible IA should call the document list History, not all documents");
assert.doesNotMatch(appTsx, /metadata review/, "Visible ProjectArtifact UI should not expose metadata-review engineering wording");
assert.doesNotMatch(appTsx, /windows_cim/, "Runtime monitor visible UI should not expose sampler implementation names");
assert.doesNotMatch(appTsx, /compact knowledge items/, "Knowledge empty states should use Chinese product wording");
assert.match(appTsx, /checked=\{settings\.autoInstallSkill === true\}/, "Settings must show Codex auto-connect as opt-in only when explicitly enabled");
assert.match(appTsx, /RUNTIME_MONITOR_REFRESH_COOLDOWN_MS\s*=\s*10_000/, "Agent runtime monitor manual refresh must have an explicit cooldown");
assert.match(appTsx, /runtimeMonitorCoolingDown/, "Agent runtime monitor UI must expose refresh cooldown state");
assert.match(appTsx, /window\.setTimeout\(\(\)\s*=>\s*\{[\s\S]*setRuntimeMonitorCooldownUntil\(0\)/, "Runtime monitor cooldown must clear with a one-shot timer");
assert.doesNotMatch(appTsx, /window\.setInterval\(tick,\s*RUNTIME_MONITOR_VISIBLE_AUTO_REFRESH_MS\)/, "Runtime monitor must not create a periodic auto-refresh interval");
assert.match(main, /includeLongThreadMetadata[\s\S]*longThreadsProvider:\s*includeLongThreadMetadata/, "Runtime monitor main process must skip long-thread triage unless explicitly requested");
assert.match(appTsx, /buildRuntimeMonitorDiagnosticReport/, "Agent runtime monitor UI must build a copyable diagnostic report");
assert.match(appTsx, /Platform support/, "Runtime diagnostic report must expose platform support levels");
assert.match(appTsx, /runtimeSessionEvidenceSummary/, "Agent runtime monitor UI must summarize vault and pointer evidence");
assert.match(appTsx, /vaultManifest=\$\{session\.vaultManifestPath \|\| "none"\}/, "Runtime diagnostic reports must include vault manifest evidence");
assert.match(appTsx, /memoryPointers=\$\{session\.memoryPointers\?\.join/, "Runtime diagnostic reports must include memory pointer evidence");
assert.match(appTsx, /navigator\.clipboard\.writeText\(buildRuntimeMonitorDiagnosticReport\(runtimeSnapshot\)\)/, "Agent runtime monitor report must be copied through the clipboard");
assert.match(appTsx, /commandLine and executablePath are intentionally omitted/, "Runtime diagnostic reports must omit commandLine and executablePath");
assert.match(appTsx, /no raw session body, no cleanup\/restore\/compact\/kill action/, "Runtime diagnostic report must state its read-only policy");
assert.match(viteEnv, /type AgentRuntimeAction =[\s\S]*wait_and_resample[\s\S]*inspect_process_metadata[\s\S]*inspect_thread_metadata[\s\S]*review_error_state[\s\S]*review_history_metadata[\s\S]*none/, "Renderer runtime action contract must stay on the accepted read-only diagnosis set");
assert.doesNotMatch(viteEnv, /type AgentRuntimeAction =[\s\S]*close_error_thread|type AgentRuntimeAction =[\s\S]*reopen_app|type AgentRuntimeAction =[\s\S]*optimize_thread|type AgentRuntimeAction =[\s\S]*inspect_logs/, "Renderer runtime action contract must not regress to legacy mutation-suggesting actions");
assert.match(viteEnv, /observedFacts:/, "Renderer runtime snapshot types must expose observedFacts");
assert.match(viteEnv, /inferredAttribution:/, "Renderer runtime snapshot and session types must expose inferredAttribution");
assert.match(viteEnv, /uncertainty:/, "Renderer runtime snapshot and session types must expose uncertainty");
assert.match(appTsx, /采样证据/, "Runtime monitor UI must render a readable observed-facts section");
assert.match(appTsx, /Inferred attribution/, "Runtime monitor report must render an inferred attribution section");
assert.match(appTsx, /判断限制：/, "Runtime monitor UI must render uncertainty text in Chinese product wording");
assert.match(appTsx, /智能优化：CPU、内存和线程压力/, "Runtime monitor UI must lead with CPU, memory, and thread pressure");
assert.match(appTsx, /运行监控已关闭自动刷新/, "Runtime monitor UI must explain auto refresh is disabled to avoid adding pressure");
assert.match(appTsx, /threadAttributionMode=/, "Runtime diagnostic report must preserve the attribution-mode seam");
assert.match(appTsx, /只看元数据：.*是否有直接进程线索：/, "Runtime diagnostic report must surface uncertainty details instead of pretending exact ownership");
assert.match(appTsx, /等待后重采样|检查进程元数据|检查线程元数据|复核错误状态|复核历史元数据/, "Runtime monitor UI must surface the accepted read-only diagnosis wording");
assert.doesNotMatch(appTsx, /关闭异常线程|重启应用|入库\/瘦身候选|检查日志/, "Runtime monitor UI must not regress to legacy action labels");
assert.match(appTsx, /正在占资源的进程/, "Runtime monitor UI copy must pin CPU visible ranking wording");
assert.match(appTsx, /runtimeProcessRankingCpu\(process\)/, "Runtime monitor UI must keep a dedicated raw CPU ranking helper for visible ordering");
assert.match(appTsx, /不能当作确定归因/, "Runtime monitor UI must keep the explicit non-authoritative ownership warning");
assert.match(styles, /runtime-monitor-panel/, "Styles must support the Agent runtime monitor panel");
assert.match(styles, /runtime-monitor-columns[\s\S]*grid-template-columns:\s*repeat\(2/, "Runtime monitor layout should use stable desktop columns");
assert.match(styles, /runtime-monitor-row[\s\S]*min-width:\s*0/, "Runtime monitor rows must prevent text overlap");
if (guardianScript) {
  assert.match(guardianScript, /Get-Utf8NoBomEncoding/, "Guardian must define an explicit UTF-8 no-BOM encoding helper");
  assert.match(guardianScript, /Test-SessionStoreCompatibility/, "Guardian must validate compacted sessions against Codex thread-store requirements");
  assert.match(guardianScript, /starts_with_session_metadata/, "Guardian compatibility receipts must prove the first event is session metadata");
  assert.match(guardianScript, /metadata_thread_id_matches/, "Guardian compatibility receipts must prove session metadata matches the selected threadId");
  assert.match(guardianScript, /\$reader\.Dispose\(\)/, "Guardian compatibility checks must explicitly release the first-line reader");
  assert.doesNotMatch(
    guardianScript,
    /ReadLines\(\$Path,/,
    "Guardian compatibility checks must not keep lazy ReadLines handles open before replacing session files",
  );
  assert.match(
    guardianScript,
    /\[System\.IO\.File\]::WriteAllLines\(\$tempPath,\s*\$newLines,\s*\$utf8NoBom\)/,
    "Guardian compact-session must write JSONL without a UTF-8 BOM",
  );
  assert.match(guardianScript, /Read-SharedAllLines/, "Guardian compact-session dry-runs must read session files with shared read access");
  assert.match(guardianScript, /Write-TextFileWithRetry/, "Guardian JSON writes must use retrying temp-file writes");
  assert.match(guardianScript, /Try-WriteJsonFile -Path \$HealthPath/, "Guardian health report writes must not fail the whole report when health-latest.json is locked");
  assert.doesNotMatch(guardianScript, /WriteAllText\(\$HealthPath/, "Guardian report must not write health-latest.json with direct WriteAllText");
  assert.match(guardianScript, /hits = \$hits\.ToArray\(\)/, "Guardian image-reference scan must return generic List contents without PowerShell dynamic enumerable rebinding");
  assert.doesNotMatch(guardianScript, /hits = @\(\$hits\)/, "Guardian image-reference scan must not wrap generic Lists with @(), which can throw ArgumentException on compact-session");
  assert.match(guardianScript, /Test-SessionHasImageReferences/, "Guardian compact-session must detect image attachment references before rewriting sessions");
  assert.match(guardianScript, /refusing compact-session to avoid corrupting image_url\/local image payloads/, "Guardian compact-session must refuse image-bearing threads instead of truncating image URLs");
  assert.match(guardianScript, /Test-ExclusiveWritable/, "Guardian compact-session must check exclusive write access before replacing session files");
  assert.match(guardianScript, /close the corresponding Codex thread\/window/, "Locked session compaction must give a short actionable close-thread message");
  assert.match(
    guardianScript,
    /Compacted temp session is not thread-store compatible; original session left untouched/,
    "Guardian must validate the compacted temp file before replacing the original session",
  );
  assert.match(guardianScript, /New-ZhixiaThreadHistoryPointerLine/, "Guardian compact-session must add a Zhixia history pointer to slimmed sessions");
  assert.match(guardianScript, /ZhixiaHistoryId: codex-history:\$ThreadIdValue/, "Slimmed sessions must retain a threadId-based Zhixia history pointer");
  assert.match(guardianScript, /Do not read cold\/raw session history by default/, "Slimmed session pointer must keep the raw-history gate visible");
  assert.match(
    guardianScript,
    /Copy-Item -LiteralPath \$backupPath -Destination \$item\.source_path -Force/,
    "Guardian must restore the backup if post-write compatibility validation fails",
  );
  assert.match(guardianScript, /thread_store_compatible = \[bool\]\$afterValidation\.compatible/, "Guardian receipts must expose thread-store compatibility");
  assert.doesNotMatch(
    guardianScript,
    /\[System\.IO\.File\]::WriteAllLines\(\$tempPath,\s*\$newLines,\s*\[System\.Text\.Encoding\]::UTF8\)/,
    "Guardian compact-session must not use BOM-emitting UTF8 singleton for session JSONL",
  );
}
assert.match(appTsx, /optimizedHistoryThreadIds/, "Agent UI must mark optimized old threads");
assert.match(appTsx, /批量入库完成/, "Agent UI must report batch old-thread indexing results");
assert.match(appTsx, /Raw session policy: do not read by default/, "Continuation packets must not read raw sessions by default");
assert.match(appTsx, /cleanDisplayText/, "History UI must sanitize broken glyphs from summaries");
assert.match(appTsx, /isLikelyMojibake/, "History UI must detect mojibake titles and summaries");
assert.match(appTsx, /historySourceRefDisplayText/, "History UI must sanitize Guardian source ref paths");
assert.match(appTsx, /来源路径含损坏字符，已隐藏/, "History UI must hide mojibake source paths");
assert.match(appTsx, /buildOldThreadOptimizationText/, "Old-thread optimization summaries must be built from sanitized display fields");
assert.match(appTsx, /navigator\.clipboard\.writeText/, "Old-thread optimization summaries should be copyable");
assert.match(appTsx, /知匣保存完整历史保险库、threadId、项目路径、热\/温摘要和冷层来源索引/, "Optimization UI must explain Zhixia history vault indexing");
assert.equal((appTsx.match(/renderRetrievalInspector\(\)/g) || []).length, 1, "Retrieval inspector must not be rendered as a blocking Agent panel");
assert.match(styles, /project-layout--inspector-collapsed/, "Styles must support a collapsed retrieval inspector column");
assert.match(main, /CODEX_HISTORY_VAULT_SCHEMA_VERSION/, "Main process must define a Codex Thread History Vault schema");
assert.match(main, /codexHistoryVaultRoot/, "Main process must store full old-thread history in a Zhixia vault");
assert.match(main, /writeCodexThreadHistoryVault/, "Old-thread optimization must write a full history vault before slimming");
assert.match(main, /resolveGuardianRawSessionRef/, "Old-thread vault ingestion must resolve moved raw sessions by threadId");
assert.match(main, /archived_sessions/, "Old-thread vault ingestion must search archived_sessions after host sidebar archive moves sessions");
assert.match(main, /readGuardianRestoreIndex/, "Old-thread vault ingestion must use Guardian restore-index as a fallback source map");
assert.match(main, /sourceSessionRelocatedFrom/, "Thread History Vault manifests must record when a raw session source was relocated before ingestion");
assert.match(main, /originalSha256/, "Thread History Vault must record the original session SHA-256");
assert.match(main, /validateVaultCopyHashes/, "Thread History Vault must validate copy hash evidence before accepting ingestion");
assert.match(main, /repairVersion[\s\S]*session-\$\{repairVersion\}\.jsonl/, "Thread History Vault should create a non-destructive repair copy when an existing vault copy hash mismatches");
assert.match(main, /ensureCodexThreadHistoryVault/, "In-place slimming must ensure the full history vault exists first");
assert.match(main, /Thread History Vault ingestion failed before slimming; original session left untouched/, "Slimming must refuse to touch the source session if vault ingestion fails");
assert.match(main, /evaluateArchiveCandidate/, "Long-thread triage must attach read-only archive candidate governance");
assert.match(main, /normalizeArchiveCandidateEvidence/, "Long-thread triage must normalize Guardian vault and pointer metadata before archive candidate evaluation");
assert.match(viteEnv, /archiveCandidate\?:/, "Renderer types must expose archive candidate governance evidence");
assert.match(viteEnv, /\|\s*"tool_skill_record"/, "Renderer AgentRetrieveKind must include tool_skill_record");
assert.match(appTsx, /tool_skill_record"\) return "工具资产"/, "Renderer retrieval labels must include ToolSkillRecord items");
assert.match(appTsx, /item\.kind === "tool_skill_record"[\s\S]*setView\("tools"\)/, "Renderer retrieval item clicks should route ToolSkillRecord results to the Tools page");
assert.match(viteEnv, /memoryPointers\?: string\[\]/, "Renderer archive evidence must expose memory pointers");
assert.match(viteEnv, /compactReceiptPath\?: string \| null/, "Renderer archive evidence must expose compact receipt path");
assert.match(viteEnv, /compactReceiptSha256\?: string \| null/, "Renderer archive evidence must expose compact receipt hash");
assert.match(viteEnv, /threadStoreCompatible\?: boolean \| null/, "Renderer archive evidence must expose thread-store compatibility");
assert.match(viteEnv, /sourceRefs\?: CodexGuardianHistorySourceRef\[\]/, "Renderer archive evidence must expose source refs");
assert.match(fs.readFileSync(path.join(root, "electron", "archiveCandidatePolicy.cjs"), "utf8"), /compact_receipt_incompatible/, "Archive candidate policy must block explicit incompatible compact receipts");
assert.match(appTsx, /暂不可归档/, "Old-thread UI must show archive candidate blockers without running archive actions");
assert.match(appTsx, /归档前证据判断/, "Old-thread UI must frame archive evidence as pre-archive evidence");
assert.match(appTsx, /用户主动点“一键安全减负”时，已完整入库、已验 hash、非运行中的旧线程会直接进入归档队列/, "Old-thread UI must explain explicit safe pressure relief can queue archived threads after evidence without extra user steps");
assert.match(appTsx, /知匣不会删除、恢复或直接移动 Codex session/, "Old-thread UI must keep destructive session boundaries explicit");
assert.match(appTsx, /兼容状态：/, "Old-thread UI must surface thread-store compatibility evidence");
assert.match(appTsx, /瘦身回执：路径=/, "Old-thread UI must surface compact receipt path evidence");
assert.match(appTsx, /compactReceiptSha256/, "Old-thread UI must surface compact receipt hash evidence");
assert.match(appTsx, /记忆指针：/, "Old-thread UI must show read-only archive pointer evidence");
assert.match(appTsx, /来源证据：/, "Old-thread UI must show source refs as archive evidence");
assert.match(main, /hot.*warm.*cold/s, "Old-thread history must expose hot/warm/cold retrieval layers");
assert.match(main, /compactGuardianErrorMessage/, "Main process must shorten noisy Guardian stderr before showing it in the UI");
assert.match(main, /large JSON payload in the error stream/, "Guardian JSON parse failures must not dump full inventory JSON into the UI");
assert.match(viteEnv, /vaultManifestPath/, "Renderer types must expose vault manifest evidence");
assert.match(styles, /project-layout--solo/, "Styles must support a one-column project workspace");
assert.match(styles, /@media \(max-width: 1320px\)/, "Styles must stack the main layouts at narrower desktop widths");
assert.match(styles, /writeback-queue[\s\S]*overflow:\s*auto/, "Writeback queue should keep internal scrolling");
assert.match(styles, /codex-guardian-section/, "Styles must support the Codex Guardian settings panel");
assert.match(styles, /old-thread-layout/, "Styles must support old-thread manager layout");
assert.match(styles, /old-thread-list[\s\S]*overflow:\s*visible/, "Old-thread cards must not clip into a hidden scroll well");
assert.doesNotMatch(styles, /old-thread-list[\s\S]{0,180}max-height:\s*min\(42vh,\s*420px\)/, "Old-thread list must not use the short-window max-height that overlaps the detail card");
assert.match(styles, /agent-layout/, "Agent layout must prevent inspector overlap");

for (const docPath of [
  "docs/PRD.md",
  "docs/TECHNICAL_DESIGN.md",
  "docs/TEST_PLAN.md",
  "docs/RELEASE_NOTES.md",
  ...(isPublicSourceStaging ? [] : ["docs/PROJECT_EVALUATION.md"]),
]) {
  assert.ok(fs.existsSync(path.join(root, docPath)), `${docPath} must exist`);
}

const skillPath = path.join(root, "codex-skills", "zhixia-local-docs");
const skill = fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8");
const openaiYaml = fs.readFileSync(path.join(skillPath, "agents", "openai.yaml"), "utf8");
const helperPath = path.join(skillPath, "scripts", "read-project-knowledge.cjs");
const helper = fs.readFileSync(helperPath, "utf8");
assert.match(skill, /name: zhixia-local-docs/, "Zhixia Codex skill must declare its name");
assert.match(skill, /(?:\.codex-knowledge\/)?project-resume\.md/, "Skill must prioritize project resume packets");
assert.match(skill, /(?:\.codex-knowledge\/)?retrieval-packet\.md/, "Skill must prioritize compact retrieval packets");
assert.match(skill, /(?:\.codex-knowledge\/)?project-index\.md/, "Skill must explain structured project indexes");
assert.match(skill, /references\/memory-core-lifecycle\.md/, "Skill must document the Memory Core lifecycle contract");
assert.match(skill, /(?:\.codex-knowledge\/)?project-artifacts\.md/, "Skill must explain project artifacts");
assert.match(skill, /(?:\.codex-knowledge\/)?context\.md/, "Skill must explain the context bundle handoff");
assert.match(skill, /(?:\.codex-knowledge\/)?knowledge-items\.md/, "Skill must explain knowledge items");
assert.match(skill, /(?:\.codex-knowledge\/)?experience-cards\.md/, "Skill must explain experience cards");
assert.match(skill, /(?:\.codex-knowledge\/)?skill-candidates\.md/, "Skill must explain skill candidates");
assert.match(skill, /(?:\.codex-knowledge\/)?tool-skill-inventory\.md/, "Skill must explain tool skill inventory");
assert.match(skill, /read-project-knowledge\.cjs/, "Skill must document the retrieval helper");
assert.match(helper, /--query/, "retrieval helper must support --query");
assert.match(helper, /--query-type/, "retrieval helper must support --query-type");
assert.match(helper, /--runtime-context/, "retrieval helper must support explicit runtime context packets");
assert.match(helper, /--precedent/, "retrieval helper must support precedent retrieval packets");
assert.match(helper, /--recover-thread/, "retrieval helper must support explicit old-thread recovery packets");
assert.match(helper, /buildThreadRecoveryPacket/, "retrieval helper must build ThreadRecoveryPacket-shaped output");
assert.match(helper, /--ceo-takeover[\s\S]*ceo_takeover_bootstrap_packet/, "Zhixia helper must expose CEO takeover bootstrap mode");
assert.match(helper, /--thread-pressure[\s\S]*freeze_risk_stop_dispatch/, "Zhixia helper must expose metadata-only CEO pressure evaluation");
assert.match(helper, /--writeback-dry-run/, "retrieval helper must generate dry-run evidence writeback packets");
assert.match(helper, /--evidence-json/, "retrieval helper must accept compact evidence JSON input");
assert.match(helper, /--limit/, "retrieval helper must support --limit");
assert.match(helper, /--token-budget/, "retrieval helper must support --token-budget");
assert.match(helper, /--json/, "retrieval helper must support --json");
assert.match(helper, /MAX_KNOWLEDGE_FILE_BYTES/, "retrieval helper must bound reads of giant bundle files");
assert.match(helper, /BASE64_RE/, "retrieval helper must redact base64-like payloads");
assert.match(helper, /project-resume\.md/, "retrieval helper must read project resume packets");
assert.match(helper, /project-artifacts\.md/, "retrieval helper must read project artifacts");
assert.match(helper, /knowledge-items\.md/, "retrieval helper must read knowledge items");
assert.match(helper, /experience-cards\.md/, "retrieval helper must read experience cards");
assert.match(helper, /skill-candidates\.md/, "retrieval helper must read skill candidates");
assert.match(helper, /tool-skill-inventory\.md/, "retrieval helper must read tool skill inventory");
assert.match(helper, /function compactKnowledgeExcerpt/, "retrieval helper must sanitize generated Markdown excerpts before returning them to Codex");
assert.match(helper, /RequiresHumanConfirmation\|RawSessionPolicy\|TokenEstimate/, "retrieval helper must strip technical governance rows from excerpts");
assert.match(helper, /tool_inventory/, "retrieval helper must expose tool inventory kind");
assert.match(helper, /sourceRefs/, "retrieval helper must emit source refs");
assert.match(helper, /freshness/, "retrieval helper must emit freshness");
assert.match(helper, /whyMatched/, "retrieval helper must emit whyMatched");
assert.match(helper, /requiresHumanConfirmation/, "retrieval helper must emit confirmation flags");
assert.match(helper, /buildRuntimeContextPacket/, "retrieval helper must build RuntimeContextPacket-shaped output");
assert.match(helper, /buildRuntimePrecedentPacket/, "retrieval helper must build RuntimePrecedentPacket-shaped output");
assert.match(helper, /buildEvidenceWritebackPacket/, "retrieval helper must build EvidenceWritebackPacket dry-run output");
assert.match(skill, /--recover-thread[\s\S]*ThreadRecoveryPacket-shaped/, "Skill docs must document old-thread recovery helper mode");
assert.match(pkg.scripts.test, /zhixia-local-docs-helper\.test\.cjs/, "default npm test must include Zhixia local-docs helper lifecycle coverage");
assert.match(skill, /freshness=review/, "Skill docs must explain non-authoritative review freshness");
assert.match(skill, /skill-candidates\.md.*review-only|review-only draft material/s, "Skill docs must treat skill candidates as review material");
assert.match(skill, /tool-skill-inventory\.md.*read-only candidate|read-only candidate material/s, "Skill docs must treat tool inventory as read-only candidate material");
assert.match(openaiYaml, /Use \$zhixia-local-docs/, "Skill UI metadata must include a default prompt");
assert.ok(
  fs.existsSync(helperPath),
  "Skill retrieval helper script must exist",
);
if (isPublicSourceStaging) {
  assert.ok(!pkg.build, "Source-only staging should not advertise binary packaging configuration");
  assert.ok(!pkg.scripts["apply:win-icon"], "Source-only staging should not advertise packaging icon helper scripts");
  assert.ok(!pkg.scripts["package:dir"], "Source-only staging should not advertise binary packaging scripts");
  assert.ok(!pkg.scripts["package:portable"], "Source-only staging should not advertise portable packaging scripts");
  assert.ok(!pkg.scripts["package:installer"], "Source-only staging should not advertise installer packaging scripts");
  assert.ok(!fs.existsSync(path.join(root, "scripts", "apply-windows-icon.cjs")), "Source-only staging should not include the packaging icon helper");
  assert.ok(!fs.existsSync(installerIncludePath), "Source-only staging should not include the installer include file");
} else {
  assert.ok(
    pkg.build.files.includes("codex-skills/**/*"),
    "Packaged app must include bundled Codex skills",
  );
  assert.ok(pkg.build.files.includes("assets/**/*"), "Packaged app must include icon assets");
  assert.equal(pkg.build.win.icon, "assets/icon.ico", "Windows package must use the custom icon");
  assert.ok(pkg.build.win.target.includes("nsis"), "Windows installer target must be enabled");
  assert.ok(pkg.scripts["apply:win-icon"], "Packaging must manually apply the executable icon");
  assert.match(applyWindowsIconScript, /FileDescription[\s\S]*ProductName[\s\S]*OriginalFilename/, "Packaging helper must replace Electron exe metadata with Zhixia metadata");
  assert.match(applyWindowsIconScript, /--set-file-version[\s\S]*--set-product-version/, "Packaging helper must stamp executable version metadata");
  assert.match(pkg.scripts["package:dir"], /apply:win-icon/, "Directory package must apply the executable icon");
  assert.match(pkg.scripts["package:installer"], /--prepackaged release\/win-unpacked/, "Installer must use the icon-fixed prepackaged app");
  assert.equal(pkg.build.nsis.installerIcon, "assets/icon.ico", "NSIS installer must use the custom icon");
  assert.equal(pkg.build.nsis.uninstallerIcon, "assets/icon.ico", "NSIS uninstaller must use the custom icon");
  assert.equal(pkg.build.nsis.installerHeaderIcon, "assets/icon.ico", "NSIS header must use the custom icon");
  assert.equal(pkg.build.nsis.include, "build/installer.nsh", "NSIS installer must include clean uninstall script");
  assert.match(installerInclude, /customUnInstall/, "Clean uninstall must hook the uninstaller");
  assert.match(installerInclude, /\/KEEP_APP_DATA/, "Clean uninstall must preserve data during upgrade installs");
  assert.match(installerInclude, /zhixia-local-docs/, "Clean uninstall must remove bundled Codex skill only");
  assert.match(installerInclude, /APPDATA\\知匣 Local Doc Knowledge/, "Clean uninstall must remove Zhixia app data");
  assert.match(installerInclude, /customPageAfterChangeDir/, "Installer must show a user choice page for Skill installation");
  assert.match(installerInclude, /BST_UNCHECKED/, "Skill installer checkbox must default to unchecked");
  assert.match(installerInclude, /--install-skill-and-quit/, "Installer must call the explicit Skill installer command only when selected");
}
if (isPublicSourceStaging) {
  assert.equal(freshUserValidationDoc, "", "Source-only staging should not include fresh-user release validation docs");
  assert.equal(freshUserValidationScript, "", "Source-only staging should not include fresh-user release validation scripts");
  assert.equal(packageFreshUserValidationScript, "", "Source-only staging should not include fresh-user package scripts");
  assert.equal(verifyFreshUserBundleScript, "", "Source-only staging should not include fresh-user bundle verifiers");
  assert.equal(verifyFreshUserEvidenceScript, "", "Source-only staging should not include fresh-user evidence verifiers");
  assert.equal(acceptFreshUserReturnEvidenceScript, "", "Source-only staging should not include private return-evidence acceptors");
  assert.equal(acceptFreshUserReturnEvidenceBatch, "", "Source-only staging should not include private return-evidence batch acceptors");
  assert.equal(acceptFreshUserReturnHereScript, "", "Source-only staging should not include private return-evidence auto-discovery");
  assert.equal(acceptFreshUserReturnHereBatch, "", "Source-only staging should not include private return-evidence auto-discovery batch files");
} else {
assert.match(freshUserValidationScript, /default-install-does-not-install-skill/, "Fresh-user validation script must verify the default installer does not install the Skill");
assert.match(freshUserValidationScript, /explicit-skill-installed/, "Fresh-user validation script must verify explicit Skill installation");
assert.match(freshUserValidationScript, /portable-launch-stays-running/, "Fresh-user validation script must launch-check the portable artifact");
assert.doesNotMatch(freshUserValidationScript, /\.ArgumentList\.Add/, "Fresh-user validation script must stay compatible with Windows PowerShell 5.1");
assert.match(freshUserValidationScript, /script-error/, "Fresh-user validation script must record unexpected failures as failed evidence");
assert.match(packageFreshUserValidationScript, /SHA256SUMS\.txt/, "Fresh-user validation bundle script must write a SHA-256 manifest");
assert.match(packageFreshUserValidationScript, /\.zip\.sha256/, "Fresh-user validation bundle script must write an outer zip SHA-256 sidecar");
assert.match(packageFreshUserValidationScript, /Get-Sha256Hex -Path \$zipPath/, "Fresh-user validation bundle script must hash the transfer zip itself");
assert.match(packageFreshUserValidationScript, /System\.Security\.Cryptography\.SHA256/, "Fresh-user validation bundle script must include a .NET SHA-256 fallback");
assert.match(packageFreshUserValidationScript, /VERIFY_FRESH_USER_ZIP\.ps1/, "Fresh-user validation bundle script must write a one-command zip verifier");
assert.match(packageFreshUserValidationScript, /VERIFY_TRANSFER_FOLDER\.ps1/, "Fresh-user validation bundle script must write a transfer-folder verifier");
assert.match(packageFreshUserValidationScript, /VERIFY_TRANSFER_ARCHIVE\.ps1/, "Fresh-user validation bundle script must write a transfer-archive verifier");
assert.match(packageFreshUserValidationScript, /START_TRANSFER_ARCHIVE\.ps1/, "Fresh-user validation bundle script must write a transfer-archive starter");
assert.match(packageFreshUserValidationScript, /START_TRANSFER_ARCHIVE\.bat/, "Fresh-user validation bundle script must write a transfer-archive batch starter");
assert.match(packageFreshUserValidationScript, /TRANSFER_SHA256SUMS\.txt/, "Fresh-user validation bundle script must write a transfer-folder manifest");
assert.match(packageFreshUserValidationScript, /START_FRESH_USER_VALIDATION\.ps1/, "Fresh-user validation bundle script must write a one-command validation starter");
assert.match(packageFreshUserValidationScript, /START_HERE\.bat/, "Fresh-user validation bundle script must write a Windows batch starter");
assert.match(packageFreshUserValidationScript, /FINISH_HERE\.bat/, "Fresh-user validation bundle script must write a Windows batch finalizer");
assert.match(packageFreshUserValidationScript, /FRESH_USER_VALIDATION_HANDOFF\.md/, "Fresh-user validation bundle script must write a release-side handoff note");
assert.match(packageFreshUserValidationScript, /Fresh-User Validation Handoff/, "Fresh-user handoff note must have a clear title");
assert.match(packageFreshUserValidationScript, /SkipRunValidation/, "Fresh-user starter must support a verification-only dry run path");
assert.match(packageFreshUserValidationScript, /Continuing after Set-ExecutionPolicy warning/, "Fresh-user validation scripts must not fail only because Set-ExecutionPolicy cannot load");
assert.match(packageFreshUserValidationScript, /Extract path already exists/, "Fresh-user starter must not overwrite an existing extracted evidence folder");
assert.match(packageFreshUserValidationScript, /RUN_VALIDATION\.ps1/, "Fresh-user starter must launch the extracted validation runner");
assert.match(packageFreshUserValidationScript, /%~dp0\$starterName/, "Fresh-user batch starter must call the PowerShell starter beside itself");
assert.match(packageFreshUserValidationScript, /%\*/, "Fresh-user batch starter must forward command-line arguments");
assert.match(packageFreshUserValidationScript, /%~dp0FINALIZE_EVIDENCE\.ps1/, "Fresh-user batch finalizer must call FINALIZE_EVIDENCE beside itself");
assert.match(packageFreshUserValidationScript, /Zhixia fresh-user return evidence is ready/, "Fresh-user batch finalizer must report successful return evidence creation");
assert.match(packageFreshUserValidationScript, /accept-fresh-user-return-evidence\.ps1 -ReturnZip/, "Fresh-user handoff note must show CEO-side return zip acceptance");
assert.match(packageFreshUserValidationScript, /accept-fresh-user-return-evidence\.ps1 -EvidenceRoot/, "Fresh-user handoff note must show CEO-side evidence folder acceptance");
assert.match(packageFreshUserValidationScript, /fresh-user-transfer/, "Fresh-user validation bundle script must create a direct-transfer folder");
assert.match(packageFreshUserValidationScript, /transferArchivePath/, "Fresh-user validation bundle script must create a single-file transfer archive");
assert.match(packageFreshUserValidationScript, /transferArchiveHashPath/, "Fresh-user validation bundle script must write a transfer archive SHA-256 sidecar");
assert.match(packageFreshUserValidationScript, /transferArchiveVerifierPath/, "Fresh-user validation bundle script must report the transfer archive verifier");
assert.match(packageFreshUserValidationScript, /transferArchiveStarterPath/, "Fresh-user validation bundle script must report the transfer archive starter");
assert.match(packageFreshUserValidationScript, /transferArchiveBatchStarterPath/, "Fresh-user validation bundle script must report the transfer archive batch starter");
assert.match(packageFreshUserValidationScript, /transferKitPath/, "Fresh-user validation bundle script must create a transfer kit archive");
assert.match(packageFreshUserValidationScript, /transferKitHashPath/, "Fresh-user validation bundle script must write a transfer kit SHA-256 sidecar");
assert.match(packageFreshUserValidationScript, /Copy-RequiredFile -Source \$zipPath/, "Fresh-user transfer folder must include the validation zip");
assert.match(packageFreshUserValidationScript, /Copy-RequiredFile -Source \$zipHashPath/, "Fresh-user transfer folder must include the validation zip hash sidecar");
assert.match(packageFreshUserValidationScript, /Copy-RequiredFile -Source \$zipVerifierPath/, "Fresh-user transfer folder must include the one-command verifier");
assert.match(packageFreshUserValidationScript, /Copy-RequiredFile -Source \$starterPath/, "Fresh-user transfer folder must include the one-command starter");
assert.match(packageFreshUserValidationScript, /Copy-RequiredFile -Source \$batchStarterPath/, "Fresh-user transfer folder must include the batch starter");
assert.match(packageFreshUserValidationScript, /Copy-RequiredFile -Source \$handoffPath/, "Fresh-user transfer folder must include the handoff note");
assert.match(packageFreshUserValidationScript, /Validation zip SHA-256 verified/, "Fresh-user zip verifier must report successful transfer hash verification");
assert.match(packageFreshUserValidationScript, /Validation zip SHA-256 mismatch/, "Fresh-user zip verifier must fail on transfer hash mismatch");
assert.match(packageFreshUserValidationScript, /Transfer folder SHA-256 manifest verified/, "Fresh-user transfer verifier must report successful folder verification");
assert.match(packageFreshUserValidationScript, /Transfer hash mismatch/, "Fresh-user transfer verifier must fail on transfer file hash mismatch");
assert.match(packageFreshUserValidationScript, /Compress-Archive -Path \$transferDir -DestinationPath \$transferArchivePath/, "Fresh-user transfer archive must zip the complete transfer folder");
assert.match(packageFreshUserValidationScript, /Transfer archive SHA-256 verified/, "Fresh-user transfer archive verifier must report successful verification");
assert.match(packageFreshUserValidationScript, /Transfer archive SHA-256 mismatch/, "Fresh-user transfer archive verifier must fail on hash mismatch");
assert.match(packageFreshUserValidationScript, /Extracted transfer folder/, "Fresh-user transfer archive starter must report extraction");
assert.match(packageFreshUserValidationScript, /Skipped validation run/, "Fresh-user transfer archive starter must support a verification-only dry run path");
assert.match(packageFreshUserValidationScript, /transferArchiveSha256/, "Fresh-user package result must report the transfer archive hash sidecar");
assert.match(packageFreshUserValidationScript, /transferArchiveVerifier/, "Fresh-user package result must report the transfer archive verifier");
assert.match(packageFreshUserValidationScript, /transferArchiveStarter/, "Fresh-user package result must report the transfer archive starter");
assert.match(packageFreshUserValidationScript, /transferArchiveBatchStarter/, "Fresh-user package result must report the transfer archive batch starter");
assert.match(packageFreshUserValidationScript, /transferKitSha256/, "Fresh-user package result must report the transfer kit hash sidecar");
assert.match(packageFreshUserValidationScript, /Compress-Archive -Path \$transferKitItems -DestinationPath \$transferKitPath/, "Fresh-user package script must zip the complete transfer kit");
assert.match(packageFreshUserValidationScript, /Easiest handoff for a fresh Windows user or second machine:/, "Fresh-user handoff should present the transfer kit as the easiest path");
assert.doesNotMatch(packageFreshUserValidationScript, /Alternatively, copy \$\(Split-Path -Leaf \$transferKitPath\)/, "Fresh-user handoff must not demote the transfer kit to an alternate path");
assert.doesNotMatch(packageFreshUserValidationScript, /`\$transferArchive(Name|VerifierName|BatchStarterName)/, "Fresh-user handoff must not escape transfer archive variables");
assert.match(packageFreshUserValidationScript, /RUN_VALIDATION\.ps1/, "Fresh-user validation bundle script must include a simple runner");
assert.match(packageFreshUserValidationScript, /FINALIZE_EVIDENCE\.ps1/, "Fresh-user validation bundle script must include a final evidence verifier wrapper");
assert.match(packageFreshUserValidationScript, /FINISH_HERE\.bat or \.\\FINALIZE_EVIDENCE\.ps1/, "Fresh-user validation README must mention the batch finalizer");
assert.match(packageFreshUserValidationScript, /-RequireManualNotes/, "Fresh-user final evidence wrapper must enforce manual notes");
assert.match(packageFreshUserValidationScript, /Final evidence verification failed/, "Fresh-user final evidence wrapper must report failed final evidence");
assert.match(packageFreshUserValidationScript, /exit \$verificationExitCode/, "Fresh-user final evidence wrapper must propagate verifier exit codes");
assert.match(packageFreshUserValidationScript, /return-evidence\.zip/, "Fresh-user final evidence wrapper must package accepted evidence for return");
assert.match(packageFreshUserValidationScript, /Return evidence SHA-256/, "Fresh-user final evidence wrapper must hash the return evidence zip");
assert.match(packageFreshUserValidationScript, /No evidence folder found\. Run RUN_VALIDATION\.ps1 first\./, "Fresh-user final evidence wrapper must guide testers to run validation first");
assert.match(packageFreshUserValidationScript, /Compress-Archive/, "Fresh-user validation bundle script must create a transfer zip");
assert.match(packageFreshUserValidationScript, /Compress-Archive -Path/, "Fresh-user validation bundle script must expand bundle contents when zipping");
assert.match(packageFreshUserValidationScript, /verify-fresh-user-bundle\.ps1/, "Fresh-user validation bundle must include a self-verifier");
assert.match(packageFreshUserValidationScript, /\$BundleRoot = \$PSScriptRoot/, "Fresh-user validation runner must resolve paths from its own extracted bundle root");
assert.match(packageFreshUserValidationScript, /verify-fresh-user-bundle\.ps1"\) -BundleRoot \$BundleRoot/, "Fresh-user validation runner must verify the bundle before running installer checks");
assert.match(packageFreshUserValidationScript, /verify-fresh-user-evidence\.ps1/, "Fresh-user validation bundle must include a returned-evidence verifier");
assert.match(packageFreshUserValidationScript, /verify-fresh-user-evidence\.ps1"\) -EvidenceRoot \$EvidenceRoot/, "Fresh-user validation runner must verify generated evidence after installer checks");
assert.match(packageFreshUserValidationScript, /MANUAL_NOTES_TEMPLATE\.txt/, "Fresh-user validation bundle must include a manual notes template");
assert.match(packageFreshUserValidationScript, /Destination \(Join-Path \$EvidenceRoot "manual-notes\.txt"\)/, "Fresh-user validation runner must copy the manual notes template into the evidence folder");
assert.match(packageFreshUserValidationScript, /Fresh user or second machine:/, "Fresh-user manual template must ask testers to declare the fresh-user or second-machine environment");
assert.match(packageFreshUserValidationScript, /-ReleaseDir \(Join-Path \$BundleRoot "release"\)/, "Fresh-user validation runner must pass the extracted release directory explicitly");
assert.match(packageFreshUserValidationScript, /evidence\\run-/, "Fresh-user validation runner must write evidence beside the extracted bundle");
assert.match(packageFreshUserValidationScript, /-WorkRoot \$EvidenceRoot/, "Fresh-user validation runner must pass a stable evidence work root");
assert.match(verifyFreshUserBundleScript, /Get-FileHash/, "Fresh-user bundle verifier must hash files");
assert.match(verifyFreshUserBundleScript, /System\.Security\.Cryptography\.SHA256/, "Fresh-user bundle verifier must include a .NET SHA-256 fallback");
assert.match(verifyFreshUserBundleScript, /SHA256SUMS\.txt/, "Fresh-user bundle verifier must read the SHA-256 manifest");
assert.match(verifyFreshUserEvidenceScript, /fresh-user-validation-result\.json/, "Fresh-user evidence verifier must read the automated result JSON");
assert.match(verifyFreshUserEvidenceScript, /fresh-user-evidence-verification\.json/, "Fresh-user evidence verifier must write a verification result JSON");
assert.match(verifyFreshUserEvidenceScript, /fresh-user-evidence-summary\.md/, "Fresh-user evidence verifier must write a markdown summary for Program Goal evidence");
assert.match(verifyFreshUserEvidenceScript, /Decision: \$decision/, "Fresh-user evidence summary must include an accept/revise decision");
assert.match(verifyFreshUserEvidenceScript, /Get-ManualField/, "Fresh-user evidence summary must extract manual note fields");
assert.match(verifyFreshUserEvidenceScript, /Manual machine \/ user/, "Fresh-user evidence summary must include manual machine/user");
assert.match(verifyFreshUserEvidenceScript, /Fresh user or second machine \|/, "Fresh-user evidence summary must include the fresh-user declaration");
assert.match(verifyFreshUserEvidenceScript, /SmartScreen \/ code-signing prompt/, "Fresh-user evidence summary must include SmartScreen/code-signing notes");
assert.match(verifyFreshUserEvidenceScript, /Manual result/, "Fresh-user evidence summary must include the manual result");
assert.match(verifyFreshUserEvidenceScript, /RequireManualNotes/, "Fresh-user evidence verifier must support a manual-notes acceptance gate");
assert.match(verifyFreshUserEvidenceScript, /manual-fresh-environment-declared/, "Fresh-user evidence verifier must require fresh-user or second-machine declaration");
assert.match(verifyFreshUserEvidenceScript, /silent-default-installer-exit-zero/, "Fresh-user evidence verifier must check default installer evidence");
assert.match(verifyFreshUserEvidenceScript, /default-install-does-not-install-skill/, "Fresh-user evidence verifier must check default Skill absence evidence");
assert.match(verifyFreshUserEvidenceScript, /explicit-skill-installed/, "Fresh-user evidence verifier must check explicit Skill install evidence");
assert.match(verifyFreshUserEvidenceScript, /portable-launch-stays-running/, "Fresh-user evidence verifier must check portable launch evidence");
assert.match(verifyFreshUserEvidenceScript, /isolated-skill-cleaned/, "Fresh-user evidence verifier must check cleanup evidence");
assert.match(acceptFreshUserReturnEvidenceScript, /Return evidence SHA-256 mismatch/, "Fresh-user return acceptor must verify the returned zip hash");
assert.match(acceptFreshUserReturnEvidenceScript, /System\.Security\.Cryptography\.SHA256/, "Fresh-user return acceptor must include a .NET SHA-256 fallback");
assert.match(acceptFreshUserReturnEvidenceScript, /Provide exactly one of -ReturnZip or -EvidenceRoot/, "Fresh-user return acceptor must accept either a return zip or evidence root");
assert.match(acceptFreshUserReturnEvidenceScript, /No fresh-user-validation-result\.json found in evidence root/, "Fresh-user return acceptor must validate direct evidence roots");
assert.match(acceptFreshUserReturnEvidenceScript, /fresh-user-validation-result\.json/, "Fresh-user return acceptor must locate returned validation result JSON");
assert.match(acceptFreshUserReturnEvidenceScript, /verify-fresh-user-evidence\.ps1/, "Fresh-user return acceptor must rerun the evidence verifier");
assert.match(acceptFreshUserReturnEvidenceScript, /RequireManualNotes/, "Fresh-user return acceptor must enforce manual notes");
assert.match(acceptFreshUserReturnEvidenceScript, /summary does not say Decision: accept/, "Fresh-user return acceptor must require an accept summary");
assert.match(acceptFreshUserReturnEvidenceScript, /fresh-user-return-acceptance\.json/, "Fresh-user return acceptor must write an acceptance record");
assert.match(acceptFreshUserReturnEvidenceScript, /fresh-user-program-goal-evidence\.md/, "Fresh-user return acceptor must write a Program Goal evidence snippet");
assert.match(acceptFreshUserReturnEvidenceScript, /Fresh-User Return Evidence Acceptance/, "Fresh-user return acceptor must title the Program Goal evidence snippet");
assert.match(acceptFreshUserReturnEvidenceBatch, /Usage:/, "Fresh-user return evidence batch acceptor must show usage when no target is provided");
assert.match(acceptFreshUserReturnEvidenceBatch, /-EvidenceRoot "%TARGET%"/, "Fresh-user return evidence batch acceptor must route evidence folders");
assert.match(acceptFreshUserReturnEvidenceBatch, /-ReturnZip "%TARGET%"/, "Fresh-user return evidence batch acceptor must route returned zip files");
assert.match(acceptFreshUserReturnEvidenceBatch, /Target must be a returned evidence \.zip file or an evidence\\run-\* folder/, "Fresh-user return evidence batch acceptor must reject unsupported targets clearly");
assert.match(acceptFreshUserReturnHereScript, /\*-return-evidence\.zip/, "Fresh-user return auto-discovery must find returned evidence zip files");
assert.match(acceptFreshUserReturnHereScript, /Multiple return evidence zip files found/, "Fresh-user return auto-discovery must reject ambiguous return zips");
assert.match(acceptFreshUserReturnHereScript, /Multiple evidence run folders found/, "Fresh-user return auto-discovery must reject ambiguous evidence folders");
assert.match(acceptFreshUserReturnHereScript, /No returned fresh-user evidence found/, "Fresh-user return auto-discovery must explain missing returned evidence");
assert.match(acceptFreshUserReturnHereScript, /accept-fresh-user-return-evidence\.ps1/, "Fresh-user return auto-discovery must delegate to the evidence acceptor");
assert.match(acceptFreshUserReturnHereScript, /-ReturnZip/, "Fresh-user return auto-discovery must route discovered return zips");
assert.match(acceptFreshUserReturnHereScript, /-EvidenceRoot/, "Fresh-user return auto-discovery must route discovered evidence run folders");
assert.match(acceptFreshUserReturnHereBatch, /accept-fresh-user-return-here\.ps1/, "Fresh-user return auto-discovery batch must call the PowerShell wrapper");
assert.match(acceptFreshUserReturnHereBatch, /%CD%/, "Fresh-user return auto-discovery batch must default to the current folder");
assert.match(acceptFreshUserReturnHereBatch, /-SearchRoot "%SEARCH_ROOT%"/, "Fresh-user return auto-discovery batch must forward the optional search root");
assert.match(freshUserValidationDoc, /Public-release validation is accepted only when/, "Fresh-user validation doc must define the final public-release gate");
assert.match(freshUserValidationDoc, /fresh-user-evidence-verification\.json/, "Fresh-user validation doc must require the returned-evidence verifier output");
assert.match(freshUserValidationDoc, /fresh-user-evidence-summary\.md/, "Fresh-user validation doc must require the markdown evidence summary");
assert.match(freshUserValidationDoc, /zip\.sha256/, "Fresh-user validation doc must mention the outer zip SHA-256 sidecar");
assert.match(freshUserValidationDoc, /VERIFY_FRESH_USER_ZIP\.ps1/, "Fresh-user validation doc must mention the one-command zip verifier");
assert.match(freshUserValidationDoc, /FINALIZE_EVIDENCE\.ps1/, "Fresh-user validation doc must mention the final evidence wrapper");
assert.match(freshUserValidationDoc, /return-evidence\.zip/, "Fresh-user validation doc must mention the final return evidence zip");
assert.match(freshUserValidationDoc, /accept-fresh-user-return-evidence\.ps1/, "Fresh-user validation doc must mention the CEO-side return evidence acceptor");
assert.match(freshUserValidationDoc, /ACCEPT_RETURN_HERE\.bat/, "Fresh-user validation doc must mention the auto-discovery return evidence acceptor");
assert.match(freshUserValidationDoc, /-EvidenceRoot/, "Fresh-user validation doc must mention direct evidence-folder acceptance");
assert.match(freshUserValidationDoc, /Validation zip SHA-256 mismatch/, "Fresh-user validation doc must show how to fail on zip hash mismatch");
assert.match(freshUserValidationDoc, /manual-notes\.txt/, "Fresh-user validation doc must tell testers to fill the generated manual notes file");
assert.match(freshUserValidationDoc, /Fresh user or second machine:/, "Fresh-user validation doc must require a fresh-user or second-machine declaration");
}
assert.ok(fs.existsSync(path.join(root, "assets", "icon.ico")), "Windows icon must exist");
assert.ok(fs.existsSync(path.join(root, "assets", "icon.png")), "Preview icon PNG must exist");

const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-knowledge-"));
try {
  const bundleDir = path.join(tempWorkspace, ".codex-knowledge");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, "project-resume.md"), "# Project Resume Packet\n\nProject: alpha\n\nNext recommended action: resume alpha implementation", "utf8");
  fs.writeFileSync(path.join(bundleDir, "retrieval-packet.md"), "# Zhixia Retrieval Packet\n\n## Alpha Runtime\n\nalpha compact default packet", "utf8");
  fs.writeFileSync(path.join(bundleDir, "project-index.md"), "# Zhixia Project Index\n\n## Alpha Index\n\nalpha structured source map", "utf8");
  fs.writeFileSync(path.join(bundleDir, "project-knowledge.md"), "# Project\n\nalpha compatibility note", "utf8");
  fs.writeFileSync(path.join(bundleDir, "project-artifacts.md"), "# Artifacts\n\n## [prd] Alpha PRD\n\n- Status: current\n- ProducedBy: ceo_thread\n- SourcePath: docs/PRD.md\n\nalpha current PRD artifact", "utf8");
  fs.writeFileSync(path.join(bundleDir, "context.md"), "# Context\n\nbeta task context", "utf8");
  fs.writeFileSync(path.join(bundleDir, "knowledge-items.md"), "# Knowledge\n\n## Architecture\n\nalpha compact knowledge", "utf8");
  fs.writeFileSync(path.join(bundleDir, "experience-cards.md"), "# Experience\n\n## Fix\n\nalpha import lesson", "utf8");
  fs.writeFileSync(path.join(bundleDir, "skill-candidates.md"), "# Skills\n\n## Candidate\n\nalpha draft skill", "utf8");
  fs.writeFileSync(path.join(bundleDir, "tool-skill-inventory.md"), "# Codex Tool and Skill Inventory\n\n## Alpha Tool\n\nalpha reusable workflow candidate\n\nRequiresHumanConfirmation: true", "utf8");
  const output = execFileSync(process.execPath, [helperPath, tempWorkspace, "--query", "alpha", "--query-type", "review", "--token-budget", "900", "--include-kinds", "resume,retrieval_packet,project_index,artifacts,knowledge,experience,skill_candidates,tool_inventory", "--limit", "8", "--json"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.provider, "zhixia_local_docs", "retrieval helper should report provider");
  assert.equal(parsed.mode, "file_contract", "retrieval helper should report file-contract mode");
  assert.equal(parsed.workspace, tempWorkspace, "retrieval helper should resolve the temp workspace");
  assert.equal(parsed.queryType, "review", "retrieval helper should keep queryType");
  assert.equal(parsed.tokenBudget, 900, "retrieval helper should keep token budget");
  assert.ok(Array.isArray(parsed.files) && parsed.files.length >= 3, "retrieval helper should report source files");
  assert.ok(Array.isArray(parsed.items), "retrieval helper should return items[]");
  assert.ok(parsed.results.length <= 8, "retrieval helper must respect --limit");
  assert.ok(parsed.items.length >= 1, "retrieval helper should return at least one item");
  assert.ok(parsed.items.every((item) => Array.isArray(item.sourceRefs) && item.sourceRefs.length >= 1), "items should include source refs");
  assert.ok(parsed.items.every((item) => typeof item.freshness === "string"), "items should include freshness");
  assert.ok(parsed.items.every((item) => Array.isArray(item.whyMatched)), "items should include whyMatched");
  assert.ok(parsed.items.every((item) => typeof item.requiresHumanConfirmation === "boolean"), "items should include confirmation flags");
  assert.ok(parsed.items.every((item) => !/RequiresHumanConfirmation|RawSessionPolicy|TokenEstimate/.test(item.excerpt)), "retrieval helper excerpts should not expose technical governance rows");
  assert.ok(Array.isArray(parsed.results), "compatibility results[] should still exist");
  assert.ok(parsed.results.some((item) => item.kind === "resume"), "compatibility results should include resume matches");
  assert.ok(parsed.results.some((item) => item.kind === "retrieval_packet"), "compatibility results should include retrieval packet matches");
  assert.ok(parsed.results.some((item) => item.kind === "project_index"), "compatibility results should include project index matches");
  assert.ok(parsed.results.some((item) => item.kind === "artifacts"), "compatibility results should include artifact matches");
  assert.ok(parsed.results.some((item) => item.kind === "knowledge"), "compatibility results should include knowledge matches");
  assert.ok(parsed.results.some((item) => item.kind === "experience"), "compatibility results should include experience matches");
  assert.ok(parsed.results.some((item) => item.kind === "tool_inventory"), "compatibility results should include tool inventory matches");
  assert.ok(parsed.items.some((item) => item.kind === "resume" && item.requiresHumanConfirmation === true), "resume packets should require source confirmation");
  assert.ok(parsed.items.some((item) => item.kind === "artifacts" && item.freshness === "review"), "project artifacts should remain metadata review material");
  assert.ok(parsed.items.some((item) => item.kind === "skill_candidates" && item.freshness === "review"), "skill candidates should be review material");
  assert.ok(parsed.items.some((item) => item.kind === "tool_inventory" && item.requiresHumanConfirmation === true), "tool inventory should remain confirmation-gated candidate material");
} finally {
  fs.rmSync(tempWorkspace, { recursive: true, force: true });
}

console.log("Smoke tests passed.");
