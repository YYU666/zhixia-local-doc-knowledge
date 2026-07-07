const assert = require("node:assert/strict");

const {
  buildProjectArtifacts,
  inferProducedBy,
  normalizeProjectArtifactDocument,
} = require("../electron/projectArtifactPolicy.cjs");

const projectPath = "C:\\Users\\example\\Documents\\zhixia";
const lineageThreadId = ["11111111", "2222", "7333", "8444", "555555555555"].join("-");
const docs = [
  {
    id: "prd-old",
    title: "Zhixia PRD old",
    fileName: "PRD.md",
    filePath: `${projectPath}\\docs\\PRD.md`,
    workspacePath: projectPath,
    artifactType: "prd",
    sourceType: "codex_output",
    parseStatus: "ok",
    summary: "Older PRD should be superseded by the latest PRD.",
    contentHash: "hash-prd-old",
    updatedAt: "2026-06-10T12:00:00.000Z",
    importedAt: "2026-06-10T12:00:00.000Z",
  },
  {
    id: "prd-new",
    title: `CEO Flow PRD ${lineageThreadId}`,
    fileName: "PRD.md",
    filePath: `${projectPath}\\docs\\PRD.md`,
    workspacePath: projectPath,
    artifactType: "prd",
    sourceType: "codex_output",
    parseStatus: "ok",
    summary: "Current PRD produced by the CEO thread.",
    contentHash: "hash-prd-new",
    updatedAt: "2026-06-12T12:00:00.000Z",
    importedAt: "2026-06-12T12:00:00.000Z",
  },
  {
    id: "audit-report",
    title: "Neutral Audit Report",
    fileName: "AUDIT_REPORT.md",
    filePath: `${projectPath}\\docs\\AUDIT_REPORT.md`,
    workspacePath: projectPath,
    artifactType: "report",
    sourceType: "codex_output",
    parseStatus: "ok",
    summary: "Review thread found P1 archive governance gaps.",
    contentHash: "hash-audit",
    updatedAt: "2026-06-12T12:05:00.000Z",
  },
  {
    id: "audit-report-older",
    title: "Earlier Audit Report",
    fileName: "EARLIER_AUDIT_REPORT.md",
    filePath: `${projectPath}\\docs\\EARLIER_AUDIT_REPORT.md`,
    workspacePath: projectPath,
    artifactType: "report",
    sourceType: "codex_output",
    parseStatus: "ok",
    summary: "Earlier review evidence should stay current rather than being superseded by another report.",
    contentHash: "hash-audit-old",
    updatedAt: "2026-06-11T12:05:00.000Z",
  },
  {
    id: "generated-resume",
    title: "Project Resume Packet",
    fileName: "project-resume.md",
    filePath: `${projectPath}\\.codex-knowledge\\project-resume.md`,
    workspacePath: projectPath,
    artifactType: "context",
    sourceType: "codex_context",
    parseStatus: "ok",
    summary: "Generated resume packets stay review material until confirmed.",
    contentHash: "hash-resume",
    updatedAt: "2026-06-12T12:10:00.000Z",
  },
  {
    id: "generated-tool-inventory",
    title: "Tool Skill Inventory",
    fileName: "tool-skill-inventory.md",
    filePath: `${projectPath}\\.codex-knowledge\\tool-skill-inventory.md`,
    workspacePath: projectPath,
    artifactType: "context",
    sourceType: "codex_context",
    parseStatus: "ok",
    summary: "Generated tool inventory stays review material until confirmed.",
    contentHash: "hash-tool-inventory",
    updatedAt: "2026-06-12T12:12:00.000Z",
  },
  {
    id: "changed-test-plan",
    title: "Test Plan",
    fileName: "TEST_PLAN.md",
    filePath: `${projectPath}\\docs\\TEST_PLAN.md`,
    workspacePath: projectPath,
    artifactType: "test_plan",
    sourceType: "workspace_file",
    parseStatus: "ok",
    summary: "Source has changed after indexing.",
    contentHash: "hash-test",
    updatedAt: "2026-06-11T12:00:00.000Z",
    fileModifiedAt: "2026-06-12T12:00:00.000Z",
  },
  {
    id: "raw-session",
    title: "Raw Codex session",
    fileName: "session.jsonl",
    filePath: "C:\\Users\\example\\.codex\\sessions\\2026\\06\\12\\session.jsonl",
    workspacePath: projectPath,
    artifactType: "other",
    sourceType: "workspace_file",
    parseStatus: "ok",
    summary: "Raw sessions are not project artifacts.",
    contentHash: "hash-raw",
    updatedAt: "2026-06-12T12:20:00.000Z",
  },
];

assert.equal(inferProducedBy(docs[1]), "ceo_thread", "CEO language should infer CEO thread producer");
assert.equal(inferProducedBy(docs[2]), "review_thread", "audit/review language should infer review thread producer");

const generatedResume = normalizeProjectArtifactDocument(docs.find((doc) => doc.id === "generated-resume"));
assert.equal(generatedResume.status, "needs_review", "generated .codex-knowledge artifacts should remain review material");
assert.equal(generatedResume.requiresHumanConfirmation, true, "generated packets should require confirmation");
assert.ok(generatedResume.reasons.includes("generatedKnowledge:review"), "generated knowledge reason should be explicit");

const generatedToolInventory = normalizeProjectArtifactDocument(docs.find((doc) => doc.id === "generated-tool-inventory"));
assert.equal(generatedToolInventory.status, "needs_review", "generated tool inventories should remain review material");
assert.equal(generatedToolInventory.requiresHumanConfirmation, true, "generated tool inventories should require confirmation");

assert.equal(
  normalizeProjectArtifactDocument(docs.find((doc) => doc.id === "raw-session")),
  null,
  "raw Codex session JSONL files must not become ProjectArtifact records",
);

const artifacts = buildProjectArtifacts(docs, { projectPath, maxArtifacts: 20 });
assert.equal(artifacts.length, 7, "raw session should be excluded from artifact output");

const latestPrd = artifacts.find((artifact) => artifact.documentId === "prd-new");
const oldPrd = artifacts.find((artifact) => artifact.documentId === "prd-old");
const changedPlan = artifacts.find((artifact) => artifact.documentId === "changed-test-plan");
const olderAudit = artifacts.find((artifact) => artifact.documentId === "audit-report-older");

assert.equal(latestPrd.status, "current", "latest PRD should be current");
assert.equal(latestPrd.freshness, "fresh", "current artifacts should be fresh");
assert.equal(latestPrd.producedBy, "ceo_thread", "ProjectArtifact should preserve producer inference");
assert.equal(latestPrd.producerThreadId, lineageThreadId, "thread ids should be extracted for lineage");
assert.equal(oldPrd.status, "superseded", "older same-type PRDs should be superseded");
assert.equal(oldPrd.freshness, "stale", "superseded artifacts should not be default fresh context");
assert.equal(olderAudit.status, "current", "reports are evidence artifacts and should not be superseded by same-type reports");
assert.equal(changedPlan.status, "needs_review", "source-changed artifacts should require review");
assert.ok(changedPlan.reasons.includes("sourceChanged:review"), "source-changed reason should be explicit");
assert.ok(artifacts.every((artifact) => artifact.kind === "project_artifact"), "artifacts should expose retrieval kind");
assert.ok(artifacts.every((artifact) => Array.isArray(artifact.sourceRefs) && artifact.sourceRefs.length === 1), "source refs should be preserved");

console.log("Project artifact policy behavior tests passed.");
