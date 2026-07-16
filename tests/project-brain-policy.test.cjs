const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

const {
  PROJECT_ANCHOR_CATEGORIES,
  PROJECT_ANCHOR_SCHEMA,
  PROJECT_BRAIN_SCHEMA,
  PROJECT_CHECKPOINT_SCHEMA,
  PROJECT_CONTINUITY_SLOTS,
  MODULE_MEMORY_SCHEMA,
  buildCueSet,
  buildModuleMemory,
  buildProjectAnchor,
  buildProjectBrain,
  buildProjectCheckpoint,
  buildProjectContinuityLedger,
  buildProjectContinuityPacket,
  mergeProjectCheckpoints,
  resolveModuleMemory,
  resolveProjectBrain,
} = require("../electron/projectBrainPolicy.cjs");

const NOW = "2026-07-16T12:00:00.000Z";
const LATER = "2026-07-17T12:00:00.000Z";
const ROOT = "/synthetic/atlas-studio";
const PROJECT_SOURCE = {
  kind: "document",
  path: `${ROOT}/docs/PRODUCT.md`,
  title: "Synthetic product brief",
  hash: "product-hash-v1",
  artifactType: "prd",
};
const ARCH_SOURCE = {
  kind: "document",
  path: `${ROOT}/docs/ARCHITECTURE.md`,
  title: "Synthetic architecture",
  hash: "architecture-hash-v1",
  artifactType: "technical_design",
};
const RECEIPT_SOURCE = { kind: "test_receipt", id: "receipt-v1", hash: "receipt-hash-v1" };

const projectInput = {
  canonicalPath: `${ROOT}/./`,
  aliases: ["Atlas", "Atlas Studio", "Atlas"],
  productSummary: "A scene-first modular game creation studio.",
  projectType: "desktop_creator",
  phase: "continuity-foundation",
  goals: ["Preserve scene-first workflows", "Ship a complete modular editor"],
  authorityStatus: "accepted",
  sourceRefs: [PROJECT_SOURCE],
  updatedAt: "2026-07-15T10:00:00.000Z",
};
const projectBrain = buildProjectBrain(projectInput, { now: NOW });
const PROJECT_ID = projectBrain.projectId;

function acceptedRecord(title, extra = {}, sourceRef = RECEIPT_SOURCE) {
  return {
    projectId: PROJECT_ID,
    title,
    authorityStatus: "accepted",
    sourceRefs: [sourceRef],
    ...extra,
  };
}

function anchor(category, statement, status = "accepted", extra = {}) {
  return buildProjectAnchor({
    projectId: PROJECT_ID,
    category,
    title: `${category} anchor`,
    statement,
    authorityStatus: status,
    sourceRefs: [category === "architecture" ? ARCH_SOURCE : PROJECT_SOURCE],
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...extra,
  }, { projectId: PROJECT_ID, now: NOW });
}

assert.equal(projectBrain.projectId, buildProjectBrain(projectInput, { now: LATER }).projectId, "ProjectBrain projectId should be deterministic");
assert.equal(projectBrain.canonicalPath, ROOT, "ProjectBrain should canonicalize paths without filesystem access");
assert.ok(projectBrain.aliases.includes("Atlas"), "ProjectBrain should retain compact aliases");
assert.equal(projectBrain.authoritative, true, "accepted source-backed ProjectBrain should be authoritative");
assert.deepEqual(PROJECT_ANCHOR_CATEGORIES, ["identity", "original_goal", "architecture", "non_negotiable", "acceptance", "safety"]);

const foreignSourceBrain = buildProjectBrain({
  ...projectInput,
  sourceRefs: [{ kind: "document", path: "/synthetic/beta/docs/PRODUCT.md", title: "Foreign product", hash: "foreign-product" }],
});
assert.equal(foreignSourceBrain.authoritative, false, "ProjectBrain must reject authoritative file refs outside its canonical project path");
assert.equal(foreignSourceBrain.sourceRefs.length, 0, "foreign path title/hash must not survive as substitute authoritative provenance");
const siblingPrefixBrain = buildProjectBrain({
  ...projectInput,
  sourceRefs: [{ kind: "document", path: `${ROOT}-backup/docs/PRODUCT.md`, hash: "sibling-prefix" }],
});
assert.equal(siblingPrefixBrain.authoritative, false, "sibling-prefix paths must not pass project containment");
const traversalBrain = buildProjectBrain({
  ...projectInput,
  sourceRefs: [{ kind: "document", path: "../beta/docs/PRODUCT.md", hash: "relative-traversal" }],
});
assert.equal(traversalBrain.authoritative, false, "relative traversal must not escape the canonical project path");
assert.equal(buildProjectBrain({ ...projectInput, sourceRefs: [{ kind: "directory", path: ROOT, hash: "root-source" }] }).authoritative, true, "canonical project root is a valid authoritative source");
assert.equal(buildProjectBrain({ ...projectInput, sourceRefs: [{ kind: "document", path: `${ROOT}/docs/VALID.md`, hash: "subpath-source" }] }).authoritative, true, "canonical project subpaths are valid authoritative sources");
assert.equal(buildProjectBrain({
  canonicalPath: "C:/projects/Alpha",
  aliases: ["Alpha"],
  authorityStatus: "accepted",
  sourceRefs: [{ kind: "document", path: "D:/projects/Alpha/docs/PRODUCT.md", hash: "cross-drive" }],
}).authoritative, false, "cross-drive file refs must be rejected");

const foreignSourceAnchor = buildProjectAnchor({
  projectId: PROJECT_ID,
  category: "architecture",
  statement: "Foreign architecture must not become current.",
  authorityStatus: "accepted",
  sourceRefs: [{ kind: "document", path: "/synthetic/beta/docs/ARCHITECTURE.md", title: "Beta architecture", hash: "beta-architecture" }],
}, { projectId: PROJECT_ID, projectPath: ROOT, now: NOW });
assert.equal(foreignSourceAnchor.authoritative, false, "Alpha anchor with a Beta file ref cannot be authoritative");
assert.equal(foreignSourceAnchor.sourceRefs.length, 0);
const foreignSourceModule = buildModuleMemory({
  projectId: PROJECT_ID,
  name: "Foreign sourced module",
  currentStatus: "active",
  authorityStatus: "accepted",
  sourceRefs: [{ kind: "document", path: "/synthetic/beta/src/module.cjs", title: "Beta module", hash: "beta-module" }],
}, { projectId: PROJECT_ID, projectPath: ROOT, now: NOW });
assert.equal(foreignSourceModule.authoritative, false, "Alpha module with a Beta file ref cannot be authoritative");
assert.equal(foreignSourceModule.sourceRefs.length, 0);

const forgedBrain = buildProjectBrain({
  schemaVersion: PROJECT_BRAIN_SCHEMA,
  projectId: PROJECT_ID,
  aliases: ["Forged Atlas"],
  authorityStatus: "curated",
  sourceRefs: [PROJECT_SOURCE],
  productSummary: "Bearer abcdefghijklmnopqrstuvwxyz",
});
const forgedAnchor = buildProjectAnchor({
  schemaVersion: PROJECT_ANCHOR_SCHEMA,
  projectId: PROJECT_ID,
  category: "original_goal",
  statement: `data:text/plain;base64,${"QUJDREVGR0hJ".repeat(30)}`,
  authorityStatus: "curated",
  sourceRefs: [PROJECT_SOURCE],
}, { projectId: PROJECT_ID });
const forgedModule = buildModuleMemory({
  schemaVersion: MODULE_MEMORY_SCHEMA,
  projectId: PROJECT_ID,
  name: "Forged module",
  authorityStatus: "accepted",
  sourceRefs: [ARCH_SOURCE],
  sourcePath: "/synthetic/.codex/sessions/thread.jsonl",
}, { projectId: PROJECT_ID });
const forgedCheckpoint = buildProjectCheckpoint({
  schemaVersion: PROJECT_CHECKPOINT_SCHEMA,
  projectId: PROJECT_ID,
  authorityStatus: "accepted",
  sourceRefs: [RECEIPT_SOURCE],
  transcript: "raw body",
}, { projectId: PROJECT_ID });
assert.equal(forgedBrain.authorityStatus, "rejected", "matching schemaVersion must not bypass ProjectBrain safety validation");
assert.equal(forgedAnchor, null, "matching schemaVersion must not bypass anchor base64 validation");
assert.equal(forgedModule, null, "matching schemaVersion must not bypass module raw-session validation");
assert.equal(forgedCheckpoint.authorityStatus, "rejected", "matching schemaVersion must not bypass checkpoint raw-body validation");

const aliasResolution = resolveProjectBrain([
  projectBrain,
  buildProjectBrain({ canonicalPath: "/synthetic/other-studio", aliases: ["Other Studio"], authorityStatus: "accepted", sourceRefs: [{ path: "/synthetic/other-studio/README.md" }] }),
], { project: "Atlas" });
assert.equal(aliasResolution.status, "resolved");
assert.equal(aliasResolution.match.projectId, PROJECT_ID, "exact alias should resolve project identity");
assert.equal(resolveProjectBrain([projectBrain], { projectPath: `${ROOT}/src/editor` }).match.projectId, PROJECT_ID, "child path should resolve its project");
assert.equal(resolveProjectBrain([projectBrain], { projectPath: "/synthetic" }).match, null, "parent path must not one-way match a deeper project path");

const duplicateProjectResolution = resolveProjectBrain([
  projectBrain,
  buildProjectBrain({ projectId: "project-atlas-duplicate", canonicalPath: "/synthetic/atlas-copy", aliases: ["Atlas"], authorityStatus: "accepted", sourceRefs: [{ path: "/synthetic/atlas-copy/README.md" }] }),
], { project: "Atlas" });
assert.equal(duplicateProjectResolution.status, "ambiguous", "duplicate top project alias ties should be explicit");
assert.equal(duplicateProjectResolution.match, null, "ambiguous project resolution must not select a winner");

const anchors = [
  anchor("identity", "Atlas is a modular scene-first game studio."),
  anchor("original_goal", "Enable creators to assemble complete games through reusable modules."),
  anchor("architecture", "Scene state is the primary persistence boundary."),
  anchor("non_negotiable", "Do not collapse the product into a demo-only MVP."),
  anchor("acceptance", "Scene save, reload, and export regression tests must pass."),
  anchor("safety", "Cold history remains pointer-only and destructive host actions require separate approval."),
];
assert.ok(anchors.every((item) => item.mandatory && item.decayPolicy === "none_until_explicit_supersession"), "accepted anchors must not decay");

const sceneModule = buildModuleMemory({
  projectId: PROJECT_ID,
  name: "Scene Editor",
  aliases: ["scene authoring", "scene workspace"],
  purpose: "Edit scene entities and coordinate persistence boundaries.",
  dependencies: ["scene-persistence"],
  currentStatus: "active",
  authorityStatus: "accepted",
  designAnchorIds: [anchors[2].anchorId],
  tasks: [
    acceptedRecord("Finish scene hierarchy undo support", { id: "task-scene-undo", status: "open" }, ARCH_SOURCE),
    acceptedRecord("Legacy toolbar cleanup", { id: "task-toolbar", status: "completed" }, ARCH_SOURCE),
  ],
  blockers: [acceptedRecord("Undo stack schema needs review", { status: "open" }, ARCH_SOURCE)],
  risks: [acceptedRecord("Scene graph regressions", { status: "open" }, ARCH_SOURCE)],
  fileHints: ["src/scene/editor.ts", "scene-editor.ts"],
  ownerThreadHints: ["synthetic-thread-scene"],
  sourceRefs: [ARCH_SOURCE],
}, { projectId: PROJECT_ID });
const persistenceModule = buildModuleMemory({
  projectId: PROJECT_ID,
  name: "Scene Persistence",
  aliases: ["scene save", "project format"],
  purpose: "Serialize, validate, and reload scene state.",
  currentStatus: "active",
  authorityStatus: "accepted",
  tasks: [acceptedRecord("Close SCENE_SAVE_CONFLICT regression", { id: "task-save-conflict", status: "in_progress" }, ARCH_SOURCE)],
  fileHints: ["src/persistence/scene-store.cjs", "scene-store.cjs"],
  errorCues: ["SCENE_SAVE_CONFLICT", "SceneStoreError"],
  sourceRefs: [ARCH_SOURCE],
}, { projectId: PROJECT_ID });
const exportModule = buildModuleMemory({
  projectId: PROJECT_ID,
  name: "Export Pipeline",
  aliases: ["build export"],
  purpose: "Package playable builds from accepted scene state.",
  currentStatus: "ready",
  authorityStatus: "accepted",
  fileHints: ["src/export/exporter.ts"],
  sourceRefs: [ARCH_SOURCE],
}, { projectId: PROJECT_ID });
const modules = [sceneModule, persistenceModule, exportModule];
assert.equal(sceneModule.tasks.length, 2, "ModuleMemory should retain task history");

const cueSet = buildCueSet({
  taskGoal: "Switch to scene saving and fix SCENE_SAVE_CONFLICT in src/persistence/scene-store.cjs",
  project: "Atlas",
  moduleHints: ["scene save"],
  taskType: "bug_repair",
  threadHints: ["synthetic-thread-persistence"],
});
const moduleResolution = resolveModuleMemory(modules, cueSet, { projectId: PROJECT_ID });
assert.equal(moduleResolution.status, "resolved");
assert.equal(moduleResolution.match.moduleId, persistenceModule.moduleId, "file/error/module cues should resolve the correct module");
assert.ok(moduleResolution.reasons.some((reason) => reason.startsWith("file:")));
assert.ok(moduleResolution.reasons.some((reason) => reason.startsWith("error:")));

const foreignModule = buildModuleMemory({
  projectId: "project-foreign",
  name: "Scene Persistence",
  aliases: ["scene save"],
  currentStatus: "active",
  authorityStatus: "accepted",
  sourceRefs: [{ path: "/synthetic/foreign/ARCHITECTURE.md" }],
}, { projectId: "project-foreign" });
const crossProjectResolution = resolveModuleMemory([persistenceModule, foreignModule], { module: "scene save" });
assert.equal(crossProjectResolution.status, "project_required", "cross-project module sets require explicit projectId");
assert.equal(crossProjectResolution.match, null);

const duplicateModule = buildModuleMemory({
  projectId: PROJECT_ID,
  moduleId: "module-scene-persistence-copy",
  name: "Persistence Copy",
  aliases: ["scene save"],
  currentStatus: "active",
  authorityStatus: "accepted",
  sourceRefs: [ARCH_SOURCE],
}, { projectId: PROJECT_ID });
const ambiguousModule = resolveModuleMemory([persistenceModule, duplicateModule], { module: "scene save" }, { projectId: PROJECT_ID });
assert.equal(ambiguousModule.status, "ambiguous", "duplicate module alias ties should not silently select by ID");
assert.equal(ambiguousModule.match, null);

const unscopedModule = buildModuleMemory({
  name: "Unscoped Scene Save",
  aliases: ["unscoped save"],
  currentStatus: "active",
  authorityStatus: "accepted",
  sourceRefs: [ARCH_SOURCE],
});
assert.equal(unscopedModule.authoritative, false, "module without projectId can never be authoritative current memory");
assert.equal(resolveModuleMemory([unscopedModule], { module: "unscoped save" }).status, "not_found", "unscoped module must not resolve as current");
assert.equal(resolveModuleMemory([persistenceModule, unscopedModule], { module: "scene save" }).status, "project_required", "scoped plus unscoped candidate sets require explicit project");
assert.equal(resolveModuleMemory([persistenceModule, unscopedModule], { module: "scene save" }, { projectId: PROJECT_ID }).match.moduleId, persistenceModule.moduleId, "explicit project should ignore unscoped modules");
assert.equal(resolveModuleMemory([persistenceModule], { module: "sce" }, { projectId: PROJECT_ID }).status, "not_found", "partial aliases shorter than the minimum must not activate");
assert.equal(resolveModuleMemory([persistenceModule], { module: "scene sav" }, { projectId: PROJECT_ID }).status, "not_found", "partial aliases below the normal score threshold must not activate");
assert.equal(resolveModuleMemory([persistenceModule], { module: "scene sav" }, { projectId: PROJECT_ID, minScore: 50 }).status, "resolved", "explicit lower threshold may enable a sufficiently long partial alias");
const reviewModule = buildModuleMemory({
  projectId: PROJECT_ID,
  name: "Review Module",
  aliases: ["review only module"],
  currentStatus: "active",
  authorityStatus: "review",
  sourceRefs: [ARCH_SOURCE],
}, { projectId: PROJECT_ID });
assert.equal(resolveModuleMemory([reviewModule], { module: "review only module" }, { projectId: PROJECT_ID }).status, "not_found", "normal resolver should accept authoritative current records only");
assert.equal(resolveModuleMemory([reviewModule], { module: "review only module" }, { projectId: PROJECT_ID, reviewMode: true }).status, "resolved", "review records require explicit review mode");

const checkpointRecord = (title, extra = {}) => acceptedRecord(title, extra, RECEIPT_SOURCE);
const checkpointInput = {
  projectId: PROJECT_ID,
  phase: "continuity-foundation",
  moduleIds: modules.map((module) => module.moduleId),
  acceptedProgress: [checkpointRecord("ProjectBrain contracts drafted")],
  taskStates: [checkpointRecord("Finish continuity packet integration", { id: "checkpoint-task-1", status: "open" })],
  blockers: [checkpointRecord("No production adapter yet", { status: "open" })],
  nextActions: [checkpointRecord("Run neutral policy review", { status: "open" })],
  threadLineage: ["synthetic-thread-ceo", "synthetic-thread-project-brain"],
  originalGoal: "Enable creators to assemble complete games through reusable modules.",
  architectureAnchors: ["Scene state is the primary persistence boundary."],
  authorityStatus: "accepted",
  sourceRefs: [RECEIPT_SOURCE],
};
const checkpointAtNow = buildProjectCheckpoint(checkpointInput, { projectId: PROJECT_ID, now: NOW });
const checkpointAtLater = buildProjectCheckpoint(checkpointInput, { projectId: PROJECT_ID, now: LATER });
assert.equal(checkpointAtNow.checkpointId, checkpointAtLater.checkpointId, "processing time must not change checkpoint identity when event identity is omitted");
const reorderedCheckpoint = buildProjectCheckpoint({
  ...checkpointInput,
  moduleIds: [...checkpointInput.moduleIds].reverse(),
  acceptedProgress: [...checkpointInput.acceptedProgress].reverse(),
  taskStates: [...checkpointInput.taskStates].reverse(),
  blockers: [...checkpointInput.blockers].reverse(),
  nextActions: [...checkpointInput.nextActions].reverse(),
  threadLineage: [...checkpointInput.threadLineage].reverse(),
  architectureAnchors: [...checkpointInput.architectureAnchors].reverse(),
}, { projectId: PROJECT_ID, now: LATER });
assert.equal(checkpointAtNow.checkpointId, reorderedCheckpoint.checkpointId, "checkpoint ID should be independent of canonical collection input order");
const multiCollectionCheckpointInput = {
  ...checkpointInput,
  acceptedProgress: [
    checkpointRecord("Progress A", { id: "progress-a" }),
    checkpointRecord("Progress B", { id: "progress-b" }),
  ],
  taskStates: [
    checkpointRecord("Task A", { id: "task-a", status: "open" }),
    checkpointRecord("Task B", { id: "task-b", status: "open" }),
  ],
  blockers: [
    checkpointRecord("Blocker A", { id: "blocker-a", status: "open" }),
    checkpointRecord("Blocker B", { id: "blocker-b", status: "open" }),
  ],
  nextActions: [
    checkpointRecord("Action A", { id: "action-a", status: "open" }),
    checkpointRecord("Action B", { id: "action-b", status: "open" }),
  ],
};
const multiCollectionCheckpoint = buildProjectCheckpoint(multiCollectionCheckpointInput, { projectId: PROJECT_ID, now: NOW });
const reversedMultiCollectionCheckpoint = buildProjectCheckpoint({
  ...multiCollectionCheckpointInput,
  acceptedProgress: [...multiCollectionCheckpointInput.acceptedProgress].reverse(),
  taskStates: [...multiCollectionCheckpointInput.taskStates].reverse(),
  blockers: [...multiCollectionCheckpointInput.blockers].reverse(),
  nextActions: [...multiCollectionCheckpointInput.nextActions].reverse(),
}, { projectId: PROJECT_ID, now: LATER });
assert.equal(multiCollectionCheckpoint.checkpointId, reversedMultiCollectionCheckpoint.checkpointId, "all checkpoint record collections should be sorted and deduped before identity hashing");

const checkpointMerge = mergeProjectCheckpoints(checkpointAtNow, {
  ...checkpointInput,
  checkpointId: checkpointAtNow.checkpointId,
  taskStates: [checkpointRecord("Finish continuity packet integration", {
    id: "checkpoint-task-1",
    status: "closed",
    observedAt: LATER,
  })],
  sourceRefs: [RECEIPT_SOURCE, { kind: "test_receipt", id: "receipt-v2", hash: "receipt-hash-v2" }],
  observedAt: LATER,
}, { projectId: PROJECT_ID, now: LATER });
assert.equal(checkpointMerge.checkpoint.checkpointId, checkpointAtNow.checkpointId, "same checkpoint identity should remain stable during evidence merge");
assert.equal(checkpointMerge.checkpoint.sourceRefs.length, 2, "checkpoint merge should merge direct source refs");
assert.equal(checkpointMerge.checkpoint.openTasks.some((task) => task.id === "checkpoint-task-1"), false, "newer closed task state must remove the old open task");

const unscopedCheckpointMerge = mergeProjectCheckpoints(checkpointAtNow, {
  authorityStatus: "accepted",
  sourceRefs: [RECEIPT_SOURCE],
  taskStates: [checkpointRecord("Unscoped mutation", { id: "unscoped-task", status: "open" })],
}, { projectId: PROJECT_ID, now: LATER });
assert.equal(unscopedCheckpointMerge.action, "reject_scope", "unscoped checkpoint cannot mutate authoritative state");
assert.equal(unscopedCheckpointMerge.mutated, false);
assert.equal(unscopedCheckpointMerge.checkpoint.projectId, PROJECT_ID);
assert.equal(unscopedCheckpointMerge.incoming.authoritative, false);

const mismatchedCheckpointMerge = mergeProjectCheckpoints(checkpointAtNow, {
  ...checkpointInput,
  projectId: "project-foreign",
}, { projectId: PROJECT_ID, now: LATER });
assert.equal(mismatchedCheckpointMerge.action, "reject_scope", "foreign checkpoint cannot mutate authoritative state");
assert.equal(mismatchedCheckpointMerge.mutated, false);

const updateBase = buildProjectCheckpoint({
  ...checkpointInput,
  acceptedProgress: [checkpointRecord("Old progress", { id: "progress-stable", observedAt: NOW })],
  blockers: [checkpointRecord("Old blocker", { id: "blocker-stable", observedAt: NOW, status: "open" })],
  nextActions: [checkpointRecord("Old action", { id: "action-stable", observedAt: NOW, status: "open" })],
}, { projectId: PROJECT_ID, now: NOW });
const updateMerge = mergeProjectCheckpoints(updateBase, {
  ...checkpointInput,
  acceptedProgress: [checkpointRecord("New progress", { id: "progress-stable", observedAt: LATER })],
  blockers: [checkpointRecord("New blocker", { id: "blocker-stable", observedAt: LATER, status: "open" })],
  nextActions: [checkpointRecord("New action", { id: "action-stable", observedAt: LATER, status: "open" })],
  observedAt: LATER,
}, { projectId: PROJECT_ID, now: LATER });
assert.equal(updateMerge.checkpoint.acceptedProgress.find((item) => item.id === "progress-stable").title, "New progress", "progress merge should keep newest stable ID record");
assert.equal(updateMerge.checkpoint.blockers.find((item) => item.id === "blocker-stable").title, "New blocker", "blocker merge should keep newest stable ID record");
assert.equal(updateMerge.checkpoint.nextActions.find((item) => item.id === "action-stable").title, "New action", "next-action merge should keep newest stable ID record");

const ineligibleChildMerge = mergeProjectCheckpoints(updateBase, {
  ...checkpointInput,
  taskStates: [{
    id: "checkpoint-task-1",
    title: "Unscoped close attempt",
    status: "closed",
    authorityStatus: "accepted",
    sourceRefs: [RECEIPT_SOURCE],
    observedAt: LATER,
  }],
  acceptedProgress: [{
    id: "progress-stable",
    projectId: "project-foreign",
    title: "Foreign progress replacement",
    authorityStatus: "accepted",
    sourceRefs: [RECEIPT_SOURCE],
    observedAt: LATER,
  }],
  blockers: [{
    id: "blocker-stable",
    projectId: PROJECT_ID,
    title: "Review blocker replacement",
    status: "closed",
    authorityStatus: "review",
    sourceRefs: [RECEIPT_SOURCE],
    observedAt: LATER,
  }],
  nextActions: [{
    id: "action-stable",
    projectId: PROJECT_ID,
    title: "No-source action replacement",
    status: "closed",
    authorityStatus: "accepted",
    observedAt: LATER,
  }],
  authorityStatus: "accepted",
  sourceRefs: [RECEIPT_SOURCE],
  observedAt: LATER,
}, { projectId: PROJECT_ID, now: LATER });
assert.ok(ineligibleChildMerge.checkpoint.openTasks.some((task) => task.id === "checkpoint-task-1"), "unscoped child cannot close an authoritative current task");
assert.equal(ineligibleChildMerge.checkpoint.acceptedProgress.find((item) => item.id === "progress-stable").title, "Old progress", "foreign child cannot replace authoritative progress");
assert.equal(ineligibleChildMerge.checkpoint.blockers.find((item) => item.id === "blocker-stable").title, "Old blocker", "review child cannot replace authoritative blocker");
assert.equal(ineligibleChildMerge.checkpoint.nextActions.find((item) => item.id === "action-stable").title, "Old action", "child without direct source refs cannot replace authoritative action");
assert.ok(ineligibleChildMerge.checkpoint.reviewChildUpdates.length >= 4, "ineligible child updates should remain review material");

const workingState = {
  projectId: PROJECT_ID,
  acceptedProgress: [acceptedRecord("Scene editor shell accepted")],
  openTasks: [acceptedRecord("Verify module switch continuity", { id: "working-task-1", status: "open" })],
  openBlockers: [acceptedRecord("Persistence regression remains open", { status: "open" })],
  nextActions: [acceptedRecord("Repair and retest scene save", { status: "open" })],
  threadLineage: [acceptedRecord("synthetic-thread-ceo -> synthetic-thread-project-brain")],
  canonicalDocs: [acceptedRecord("Synthetic product brief", {}, PROJECT_SOURCE), acceptedRecord("Synthetic architecture", {}, ARCH_SOURCE)],
  checkpoint: checkpointAtNow,
};
const metadata = {
  projectId: PROJECT_ID,
  episodes: [acceptedRecord("SCENE_SAVE_CONFLICT reproduced", { id: "episode-scene-save", eventType: "test_failure" })],
};

const ledger = buildProjectContinuityLedger(projectBrain, anchors, modules, workingState, metadata, { now: NOW, checkpoint: checkpointAtNow });
assert.deepEqual(ledger.fixedSlots, PROJECT_CONTINUITY_SLOTS);
assert.equal(ledger.slots.original_product_goal.status, "filled");
assert.equal(ledger.slots.architecture_anchors.status, "filled");
assert.equal(ledger.slots.open_tasks.status, "filled");
assert.ok(ledger.slots.open_tasks.items.some((item) => item.summary.includes("hierarchy undo")), "unfinished commitments must not decay");
assert.equal(ledger.slots.latest_failures.status, "filled");
assert.equal(ledger.slots.last_valid_checkpoint.status, "filled");

const foreignAnchor = {
  projectId: "project-foreign",
  category: "original_goal",
  statement: "Foreign goal",
  authorityStatus: "accepted",
  sourceRefs: [{ path: "/synthetic/foreign/PRODUCT.md" }],
};
const unscopedArchitecture = {
  category: "architecture",
  statement: "Unscoped architecture",
  authorityStatus: "curated",
  sourceRefs: [ARCH_SOURCE],
};
const genericProtectedFacts = {
  facts: [
    acceptedRecord("Generic inferred goal", { continuitySlot: "original_product_goal" }),
    acceptedRecord("Generic inferred architecture", { continuitySlot: "architecture_anchors" }),
  ],
  episodes: [{ ...acceptedRecord("Foreign failure", { eventType: "failure" }), projectId: "project-foreign" }],
};
const foreignCheckpoint = buildProjectCheckpoint({
  projectId: "project-foreign",
  originalGoal: "Foreign checkpoint goal",
  architectureAnchors: ["Foreign checkpoint architecture"],
  authorityStatus: "accepted",
  sourceRefs: [{ path: "/synthetic/foreign/checkpoint.json" }],
}, { projectId: "project-foreign", now: NOW });
const missingLedger = buildProjectContinuityLedger(
  projectBrain,
  [anchor("identity", "Atlas identity remains known."), foreignAnchor, unscopedArchitecture],
  [foreignModule],
  {
    openTasks: [
      { ...acceptedRecord("Foreign working task"), projectId: "project-foreign" },
      { title: "Unscoped working task", authorityStatus: "accepted", sourceRefs: [RECEIPT_SOURCE] },
    ],
  },
  genericProtectedFacts,
  { now: NOW, checkpoint: foreignCheckpoint },
);
assert.equal(missingLedger.slots.original_product_goal.status, "missing", "foreign/generic goal input must not fill protected slot");
assert.equal(missingLedger.slots.architecture_anchors.status, "missing", "unscoped/generic architecture must not fill protected slot");
assert.ok(missingLedger.missingSlots.includes("original_product_goal"));
assert.ok(missingLedger.missingSlots.includes("architecture_anchors"));
assert.ok(missingLedger.slots.original_product_goal.reviewItems.length >= 1, "foreign anchor should remain review-only");
assert.equal(missingLedger.slots.open_tasks.status, "missing", "foreign and unscoped working records cannot inherit project authority");
assert.equal(missingLedger.slots.active_modules.status, "missing", "foreign module cannot fill active modules");
assert.equal(missingLedger.slots.latest_failures.status, "missing", "foreign metadata episode cannot fill latest failures");
assert.equal(missingLedger.slots.last_valid_checkpoint.status, "missing", "foreign checkpoint cannot fill checkpoint slot");

const staleConflictLedger = buildProjectContinuityLedger(
  projectBrain,
  [
    ...anchors,
    anchor("original_goal", "A conflicting accepted original goal."),
  ],
  modules,
  workingState,
  {
    latestFailures: [acceptedRecord("Old failure", { freshness: "stale" })],
  },
  { now: NOW, optionalSlots: ["latest_failures"] },
);
assert.ok(staleConflictLedger.conflictSlots.includes("original_product_goal"), "conflicts should be reported separately");
assert.ok(!staleConflictLedger.missingSlots.includes("original_product_goal"), "conflict must not be mislabeled as missing");
assert.ok(staleConflictLedger.staleSlots.includes("latest_failures"), "stale slots should be reported separately");
assert.ok(!staleConflictLedger.missingSlots.includes("latest_failures"), "stale slot must not be mislabeled as missing");

const conflictPacket = buildProjectContinuityPacket(
  projectBrain,
  [...anchors, anchor("original_goal", "A conflicting accepted original goal.")],
  modules,
  workingState,
  metadata,
  { now: NOW, checkpoint: checkpointAtNow, tokenBudget: 4000 },
);
assert.ok(conflictPacket.continuity.conflictSlots.includes("original_product_goal"));
assert.ok(!conflictPacket.continuity.missingSlots.includes("original_product_goal"));

const packetOptions = { now: NOW, checkpoint: checkpointAtNow, tokenBudget: 4000, maxItemsPerSlot: 4 };
const packet = buildProjectContinuityPacket(projectBrain, anchors, modules, workingState, metadata, packetOptions);
assert.deepEqual(packet, buildProjectContinuityPacket(projectBrain, anchors, modules, workingState, metadata, packetOptions), "packet should be deterministic");
assert.ok(packet.tokenEstimate <= packet.budget.effective, "generous budget must cover the complete final packet envelope");
assert.equal(packet.budget.requested, 4000);
assert.equal(packet.budget.effective, 4000);
assert.equal(packet.budget.overflow, false);
assert.deepEqual(packet.continuity.missingSlots, ledger.missingSlots, "packet missing array must remain separate");
assert.deepEqual(packet.continuity.staleSlots, ledger.staleSlots, "packet stale array must remain separate");
assert.deepEqual(packet.continuity.conflictSlots, ledger.conflictSlots, "packet conflict array must remain separate");
assert.equal(packet.retention.longTermMandatoryRetained, true);
assert.equal(packet.mandatoryManifest.fingerprint, packet.manifestFingerprint);
assert.equal(packet.mandatoryManifest.complete, !packet.requiresContinuation);
assert.ok(packet.retention.pageItemCount <= packet.budget.maxPacketItems);
assert.ok(packet.characterEstimate <= packet.budget.maxPacketChars);

const tinyPacket = buildProjectContinuityPacket(projectBrain, anchors, modules, workingState, metadata, {
  ...packetOptions,
  tokenBudget: 1,
});
assert.equal(tinyPacket.budget.requested, 1, "budget metadata should preserve the caller request");
assert.ok(tinyPacket.budget.effective >= 1800, "effective budget should enforce the bounded page structural minimum");
assert.equal(tinyPacket.budget.overflow, true, "tiny requested budget should truthfully report policy adjustment");
assert.equal(tinyPacket.budget.partial, true);
assert.ok(tinyPacket.tokenEstimate <= tinyPacket.budget.effective, "even adjusted tiny requests must return a bounded page");
assert.ok(tinyPacket.characterEstimate <= tinyPacket.budget.maxPacketChars);

const manyAnchors = Array.from({ length: 500 }, (_, index) => anchor("non_negotiable", `Mandatory rule ${String(index + 1).padStart(3, "0")}.`, "accepted", {
  anchorId: `anchor-many-${index + 1}`,
  sourceRefs: [{ kind: "document", path: `${ROOT}/docs/rules-${index + 1}.md`, hash: `rule-${index + 1}` }],
}));
const hugeLedger = buildProjectContinuityLedger(projectBrain, [...anchors, ...manyAnchors], modules, workingState, metadata, { now: NOW, checkpoint: checkpointAtNow });
assert.equal(hugeLedger.slots.standing_rules.items.filter((item) => item.id.startsWith("anchor-many-")).length, 500, "long-term ledger must retain all 500 mandatory anchors");
const pageStart = performance.now();
let cursor = null;
let pageCount = 0;
let manifestFingerprint = null;
let mandatoryTotal = null;
let maxPageTokens = 0;
let maxPageChars = 0;
let maxPageItems = 0;
const returnedMandatoryIds = new Set();
do {
  const page = buildProjectContinuityPacket(projectBrain, [...anchors, ...manyAnchors], modules, workingState, metadata, {
    now: NOW,
    checkpoint: checkpointAtNow,
    tokenBudget: 4000,
    maxPacketItems: 32,
    maxPacketChars: 18000,
    mandatoryCursor: cursor,
  });
  pageCount += 1;
  maxPageTokens = Math.max(maxPageTokens, page.tokenEstimate);
  maxPageChars = Math.max(maxPageChars, page.characterEstimate);
  maxPageItems = Math.max(maxPageItems, page.retention.pageItemCount);
  assert.ok(page.tokenEstimate <= page.budget.effective, "every mandatory page must fit the effective token budget");
  assert.ok(page.characterEstimate <= page.budget.maxPacketChars, "every mandatory page must fit the character budget");
  assert.equal(page.characterEstimate, JSON.stringify(page).length, "character estimate should cover the complete final packet envelope");
  assert.ok(page.retention.pageItemCount <= page.budget.maxPacketItems, "every mandatory page must fit the item budget");
  assert.equal(page.mandatoryReturned, page.mandatoryManifest.mandatoryReturned);
  manifestFingerprint ||= page.manifestFingerprint;
  mandatoryTotal ??= page.mandatoryTotal;
  assert.equal(page.manifestFingerprint, manifestFingerprint, "manifest fingerprint must remain stable across pages");
  assert.equal(page.mandatoryTotal, mandatoryTotal, "mandatory total must remain stable across pages");
  if (pageCount === 1) {
    assert.deepEqual(page, buildProjectContinuityPacket(projectBrain, [...anchors, ...manyAnchors], modules, workingState, metadata, {
      now: NOW,
      checkpoint: checkpointAtNow,
      tokenBudget: 4000,
      maxPacketItems: 32,
      maxPacketChars: 18000,
      mandatoryCursor: null,
    }), "first mandatory page should be deterministic");
  }
  const pageMandatoryIds = Object.values(page.continuity.slots)
    .flatMap((slot) => slot.items)
    .filter((item) => item.mandatory || item.noDecay)
    .map((item) => item.id);
  const pageMandatoryItems = Object.values(page.continuity.slots)
    .flatMap((slot) => slot.items)
    .filter((item) => item.mandatory || item.noDecay);
  assert.ok(pageMandatoryItems.every((item) => item.sourceRefCount > 0 && item.sourcePointers.length > 0), "mandatory page items must carry source-backed pointers");
  assert.equal(pageMandatoryIds.length, page.mandatoryReturned, "mandatoryReturned should match source-backed page items");
  for (const id of pageMandatoryIds) {
    assert.equal(returnedMandatoryIds.has(id), false, `mandatory ID ${id} must not repeat across pages`);
    returnedMandatoryIds.add(id);
  }
  cursor = page.nextCursor;
  if (cursor) {
    assert.equal(page.requiresContinuation, true);
    assert.equal(page.mandatoryManifest.complete, false);
    assert.equal(page.retention.allMandatoryNoDecayComplete, false);
  }
  else {
    assert.equal(page.requiresContinuation, false);
    assert.equal(page.mandatoryRemaining, 0);
    assert.equal(page.mandatoryManifest.complete, true);
  }
  assert.ok(pageCount < 200, "mandatory continuation must make bounded forward progress");
} while (cursor);
const pageDurationMs = performance.now() - pageStart;
assert.ok(pageCount > 1, "500 mandatory anchors must require multiple bounded pages");
assert.equal(returnedMandatoryIds.size, mandatoryTotal, "all mandatory IDs must be covered without loss across continuation pages");
assert.equal(Array.from(returnedMandatoryIds).filter((id) => id.startsWith("anchor-many-")).length, 500, "all 500 synthetic anchors must be returned exactly once across pages");
assert.ok(pageDurationMs < 8000, `500-anchor pagination should remain bounded; observed ${pageDurationMs.toFixed(1)}ms`);

const lowBudgetPage = buildProjectContinuityPacket(projectBrain, [...anchors, ...manyAnchors], modules, workingState, metadata, {
  now: NOW,
  checkpoint: checkpointAtNow,
  tokenBudget: 1800,
  maxPacketChars: 8000,
  maxPacketItems: 8,
});
assert.equal(lowBudgetPage.budget.requested, 1800);
assert.equal(lowBudgetPage.budget.requestedPacketChars, 8000);
assert.equal(lowBudgetPage.budget.adjustedMinimum, true, "policy should raise effective minima when the requested envelope cannot make progress");
assert.equal(lowBudgetPage.budget.requestedOverflow, true);
assert.ok(lowBudgetPage.tokenEstimate <= lowBudgetPage.budget.effective);
assert.ok(lowBudgetPage.characterEstimate <= lowBudgetPage.budget.effectivePacketChars);
assert.ok(lowBudgetPage.retention.pageItemCount <= lowBudgetPage.budget.effectivePacketItems);
assert.ok(lowBudgetPage.mandatoryReturned >= 1, "low-budget page must still return at least one mandatory pointer");
assert.ok(lowBudgetPage.nextCursor && lowBudgetPage.nextCursor !== lowBudgetPage.mandatoryCursor, "low-budget page must advance its cursor");
assert.match(lowBudgetPage.nextCursor, /^mc2\.[A-Za-z0-9_-]+$/, "mandatory cursor must use the opaque v2 envelope");

function invalidCursorPage(mandatoryCursor, extraAnchors = []) {
  return buildProjectContinuityPacket(projectBrain, [...anchors, ...manyAnchors, ...extraAnchors], modules, workingState, metadata, {
    now: NOW,
    checkpoint: checkpointAtNow,
    tokenBudget: 1800,
    maxPacketChars: 8000,
    maxPacketItems: 8,
    mandatoryCursor,
  });
}

const numericCursorPage = invalidCursorPage(999999);
assert.equal(numericCursorPage.mandatoryManifest.cursorInvalid, true, "numeric cursors must be rejected");
assert.equal(numericCursorPage.mandatoryManifest.complete, false);
assert.equal(numericCursorPage.nextCursor, null);
const legacyCursorPage = invalidCursorPage(`mandatory-${lowBudgetPage.manifestFingerprint}-${lowBudgetPage.mandatoryManifest.pageEndExclusive}`);
assert.equal(legacyCursorPage.mandatoryManifest.cursorInvalid, true, "legacy fingerprint:offset cursors must be rejected");
assert.equal(legacyCursorPage.mandatoryManifest.complete, false);
const firstCursorPayload = JSON.parse(Buffer.from(lowBudgetPage.nextCursor.slice(4), "base64url").toString("utf8"));
const forgedEndCursor = `mc2.${Buffer.from(JSON.stringify({
  m: firstCursorPayload.m,
  o: lowBudgetPage.mandatoryTotal,
  p: firstCursorPayload.p,
  v: 2,
}), "utf8").toString("base64url")}`;
const forgedEndPage = invalidCursorPage(forgedEndCursor);
assert.equal(forgedEndPage.mandatoryManifest.cursorInvalid, true, "an end offset cannot reuse the first page prefix digest");
assert.equal(forgedEndPage.mandatoryManifest.complete, false);
assert.equal(forgedEndPage.mandatoryReturned, 0);
const changedManifestPage = invalidCursorPage(lowBudgetPage.nextCursor, [anchor("non_negotiable", "Manifest changed after cursor issuance.", "accepted", {
  anchorId: "anchor-manifest-change",
  sourceRefs: [{ kind: "document", path: `${ROOT}/docs/manifest-change.md`, hash: "manifest-change" }],
})]);
assert.equal(changedManifestPage.mandatoryManifest.cursorInvalid, true, "cursor must bind the exact mandatory manifest");
assert.equal(changedManifestPage.mandatoryManifest.complete, false);

const repeatedCursorOptions = {
  now: NOW,
  checkpoint: checkpointAtNow,
  tokenBudget: 1800,
  maxPacketChars: 8000,
  maxPacketItems: 8,
  mandatoryCursor: lowBudgetPage.nextCursor,
};
const repeatedCursorPage = buildProjectContinuityPacket(projectBrain, [...anchors, ...manyAnchors], modules, workingState, metadata, repeatedCursorOptions);
const repeatedCursorPageAgain = buildProjectContinuityPacket(projectBrain, [...anchors, ...manyAnchors], modules, workingState, metadata, repeatedCursorOptions);
assert.deepEqual(repeatedCursorPage, repeatedCursorPageAgain, "repeat cursor call should be deterministic");
assert.ok(repeatedCursorPage.mandatoryReturned >= 1, "repeat cursor call must keep making hard progress");
assert.ok(repeatedCursorPage.nextCursor === null || repeatedCursorPage.nextCursor !== repeatedCursorPage.mandatoryCursor, "repeat cursor call must advance or terminate");

const bulkyAnchor = anchor("non_negotiable", "A mandatory record with many source pointers must remain pageable.", "accepted", {
  anchorId: "anchor-bulky-pointer",
  sourceRefs: Array.from({ length: 32 }, (_, index) => ({
    kind: "document",
    path: `${ROOT}/docs/very-long-source-directory-${String(index).padStart(2, "0")}/${"segment-".repeat(12)}rule.md`,
    hash: `bulky-${index}`,
  })),
});
const bulkyPointerPage = buildProjectContinuityPacket(projectBrain, [bulkyAnchor], [], {}, {}, {
  now: NOW,
  tokenBudget: 1800,
  maxPacketChars: 8000,
  maxPacketItems: 4,
});
const bulkyMandatoryItems = Object.values(bulkyPointerPage.continuity.slots).flatMap((slot) => slot.items).filter((item) => item.mandatory);
assert.equal(bulkyPointerPage.mandatoryReturned, 1);
assert.equal(bulkyMandatoryItems[0].pointerOnly, true, "single oversized mandatory record should degrade to a compact pointer-only descriptor");
assert.ok(bulkyPointerPage.tokenEstimate <= bulkyPointerPage.budget.effective);
assert.ok(bulkyPointerPage.characterEstimate <= bulkyPointerPage.budget.effectivePacketChars);

const unsafeLeafPacket = buildProjectContinuityPacket(projectBrain, anchors, modules, {
  note: "Bearer primitive-secret-1234567890",
  misc: ["Bearer array-secret-1234567890"],
  nested: {
    id: "nested-secret-record",
    projectId: PROJECT_ID,
    title: "Nested unsafe record",
    summary: "api_key=nested-secret-value-12345",
  },
}, {}, { now: NOW, tokenBudget: 4000 });
assert.equal(unsafeLeafPacket.safety.unsafeCounts.workingState, 3, "primitive and nested unsafe leaves should each be counted exactly once without container double-counting");
assert.ok(!JSON.stringify(unsafeLeafPacket).includes("primitive-secret-1234567890"));
assert.ok(!JSON.stringify(unsafeLeafPacket).includes("nested-secret-value-12345"));

const unsafeWorking = {
  latestFailures: [acceptedRecord("safe failure"), { ...acceptedRecord("raw failure"), sourcePath: "/synthetic/.codex/sessions/thread.jsonl" }],
  transcript: "raw working body",
};
const unsafeCheckpointInput = {
  projectId: PROJECT_ID,
  authorityStatus: "accepted",
  sourceRefs: [RECEIPT_SOURCE],
  transcript: "raw checkpoint body",
};
const unsafeMetadata = {
  latestFailures: [{ ...acceptedRecord("named base64"), summary: `data:text/plain;base64,${"QUJDREVGR0hJ".repeat(30)}` }],
  facts: [{ ...acceptedRecord("giant fact"), content: "x".repeat(17000) }],
  episodes: [acceptedRecord("Safe compact episode", { eventType: "failure" }), { ...acceptedRecord("secret episode"), summary: "Bearer abcdefghijklmnopqrstuvwxyz" }],
};
const unsafePacket = buildProjectContinuityPacket(
  { ...projectInput, productSummary: "Bearer abcdefghijklmnopqrstuvwxyz" },
  [...anchors, { schemaVersion: PROJECT_ANCHOR_SCHEMA, ...foreignAnchor, statement: `data:text/plain;base64,${"QUJDREVGR0hJ".repeat(30)}` }],
  [...modules, { schemaVersion: MODULE_MEMORY_SCHEMA, projectId: PROJECT_ID, name: "raw", sourcePath: "/synthetic/.codex/sessions/thread.jsonl" }],
  unsafeWorking,
  unsafeMetadata,
  { now: NOW, checkpoint: unsafeCheckpointInput, tokenBudget: 4000 },
);
const unsafeJson = JSON.stringify(unsafePacket);
assert.ok(!unsafeJson.includes(".codex/sessions"));
assert.ok(!unsafeJson.includes("data:text/plain;base64"));
assert.ok(!unsafeJson.includes("x".repeat(1000)));
assert.ok(!unsafeJson.includes("Bearer abcdefghijklmnopqrstuvwxyz"));
assert.ok(unsafePacket.safety.unsafeCounts.projectBrain >= 1);
assert.ok(unsafePacket.safety.unsafeCounts.anchors >= 1);
assert.ok(unsafePacket.safety.unsafeCounts.modules >= 1);
assert.ok(unsafePacket.safety.unsafeCounts.workingState >= 1);
assert.ok(unsafePacket.safety.unsafeCounts.checkpoint >= 1);
assert.ok(unsafePacket.safety.unsafeCounts.metadataNamed >= 1);
assert.ok(unsafePacket.safety.unsafeCounts.facts >= 1);
assert.ok(unsafePacket.safety.unsafeCounts.episodes >= 1);

console.log(`ProjectBrain policy behavior tests passed. mandatoryPages=${pageCount} maxTokens=${maxPageTokens} maxChars=${maxPageChars} maxItems=${maxPageItems} traversalMs=${pageDurationMs.toFixed(1)}`);
