const assert = require("node:assert/strict");

const {
  buildMemoryDuplicateKey,
  buildMemorySourceSignature,
  buildProjectMemoryBackfillCards,
  classifyProjectMemoryType,
  isBackfillableProjectDocument,
} = require("../electron/projectMemoryBackfillPolicy.cjs");

const projectPath = "C:\\Users\\a\\Documents\\zhixia";
const docs = [
  {
    id: "prd-1",
    title: "知匣 PRD",
    fileName: "PRD.md",
    filePath: `${projectPath}\\docs\\PRD.md`,
    workspacePath: projectPath,
    artifactType: "prd",
    sourceType: "codex_output",
    parseStatus: "ok",
    summary: "Decision: revise. Next recommended action: continue project memory backfill.",
    contentText: "Decision: revise. Project Resume Packet and memory cards must require human confirmation.",
    contentHash: "hash-prd",
    updatedAt: "2026-06-12T18:00:00.000Z",
    tags: ["prd"],
  },
  {
    id: "report-1",
    title: "Archive Audit Report",
    fileName: "AUDIT_REPORT.md",
    filePath: `${projectPath}\\docs\\AUDIT_REPORT.md`,
    workspacePath: projectPath,
    artifactType: "report",
    sourceType: "codex_output",
    parseStatus: "ok",
    summary: "Thread History Vault and compact receipt are required before old-thread slimming.",
    contentText: "Thread History Vault, memory pointer and compact receipt evidence are required.",
    contentHash: "hash-report",
    updatedAt: "2026-06-12T18:02:00.000Z",
    tags: ["audit"],
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
    summary: "Generated packet should not create another memory card.",
    contentText: "Generated packet should not create another memory card.",
    contentHash: "hash-generated",
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
    summary: "Generated tool inventory should not create another memory card.",
    contentText: "Generated tool inventory should not create another memory card.",
    contentHash: "hash-generated-tools",
  },
  {
    id: "raw-session",
    title: "Raw session",
    fileName: "session.jsonl",
    filePath: "C:\\Users\\a\\.codex\\sessions\\2026\\06\\12\\session.jsonl",
    workspacePath: projectPath,
    artifactType: "other",
    sourceType: "workspace_file",
    parseStatus: "ok",
    summary: "Raw session must not be backfilled by default.",
    contentText: "{\"type\":\"session_meta\"}\n{\"type\":\"message\"}",
    contentHash: "hash-raw",
  },
];

assert.equal(classifyProjectMemoryType(docs[0]), "decision", "decision language should create decision memory");
assert.equal(classifyProjectMemoryType(docs[1]), "archive_note", "vault/receipt language should create archive note memory");
assert.equal(isBackfillableProjectDocument(docs[0], { projectPath }), true, "PRD should be backfillable");
assert.equal(isBackfillableProjectDocument(docs[2], { projectPath }), false, "generated .codex-knowledge files should not loop into memory");
assert.equal(isBackfillableProjectDocument(docs[3], { projectPath }), false, "generated tool inventories should not loop into memory");
assert.equal(isBackfillableProjectDocument(docs[4], { projectPath }), false, "raw Codex sessions should not be read by the backfill policy");

const cards = buildProjectMemoryBackfillCards(docs, { projectPath, maxCards: 10 });
assert.equal(cards.length, 2, "only source project documents should create memory candidates");
assert.ok(cards.every((card) => card.status === "candidate"), "automatic backfill cards must require later review");
assert.ok(cards.every((card) => card.sourceType === "project_doc"), "backfill cards should be traceable to project documents");
assert.ok(cards.every((card) => card.projectPath === projectPath), "backfill cards should keep project scope");
assert.ok(cards.every((card) => card.kind === "experience_card"), "backfill cards should expose an experience-card retrieval kind");
assert.ok(cards.every((card) => card.contractVersion === "project_doc_backfill_v2"), "backfill cards should expose an explicit contract version");
assert.ok(cards.every((card) => card.freshness === "review"), "automatic backfill cards should stay in review freshness");
assert.ok(cards.every((card) => card.requiresHumanConfirmation === true), "automatic backfill cards must require human confirmation");
assert.ok(cards.every((card) => card.reviewReason === "automatic_project_doc_backfill"), "backfill cards should explain why they remain candidates");
assert.ok(cards.every((card) => card.rawSessionPolicy === "explicit_only"), "backfill cards should keep raw session access explicit-only");
assert.ok(cards.every((card) => Number.isInteger(card.tokenEstimate) && card.tokenEstimate >= 40), "backfill cards should expose a bounded token estimate");
assert.ok(cards.every((card) => card.body.length <= 900), "backfill cards should stay compact");
assert.ok(cards.some((card) => card.tags.includes("decision")), "decision tag should be exposed for retrieval");
assert.ok(cards.some((card) => card.tags.includes("archive_note")), "archive-note tag should be exposed for governance retrieval");
assert.ok(cards.every((card) => Array.isArray(card.sourceRefs) && card.sourceRefs.length === 1), "backfill cards should expose compact source refs");
assert.ok(cards.every((card) => card.sourceRefs[0].kind === "document"), "source refs should stay source-backed");
assert.ok(cards.every((card) => card.sourceRefs[0].path === card.sourcePath), "source ref paths should preserve the source path");
assert.ok(cards.every((card) => card.sourceRefs[0].hash === card.sourceHash), "source ref hashes should preserve the source hash");
assert.ok(cards.every((card) => card.sourceRefs[0].updatedAt === card.sourceDocumentUpdatedAt), "source refs should preserve updatedAt for audit");
assert.ok(cards.every((card) => typeof card.sourceRefs[0].artifactType === "string"), "source refs should preserve artifact type");
assert.ok(cards.every((card) => typeof card.sourceRefs[0].sourceType === "string"), "source refs should preserve source type");
assert.ok(cards.every((card) => /^[a-f0-9]{64}$/.test(card.sourceSignature)), "backfill cards should expose a deterministic source signature");
assert.ok(cards.every((card) => card.duplicateGroupKey.startsWith("same-source:")), "backfill cards should expose deterministic duplicate grouping");

const prdCard = cards.find((card) => card.sourceDocumentId === "prd-1");
assert.ok(prdCard, "PRD should create a candidate card");
assert.equal(prdCard.sourcePath, `${projectPath}\\docs\\PRD.md`, "PRD card should preserve sourcePath");
assert.equal(prdCard.sourceHash, "hash-prd", "PRD card should preserve sourceHash");
assert.equal(prdCard.sourceRefs[0].title, "知匣 PRD", "source refs should preserve title");
assert.equal(
  prdCard.sourceSignature,
  buildMemorySourceSignature({
    projectPath,
    sourceType: "project_doc",
    sourcePath: prdCard.sourcePath,
    sourceHash: prdCard.sourceHash,
    sourceDocumentId: prdCard.sourceDocumentId,
    sourceDocumentUpdatedAt: prdCard.sourceDocumentUpdatedAt,
    sourceRefs: prdCard.sourceRefs,
  }),
  "PRD card source signature should be recomputable from source refs",
);
assert.equal(
  prdCard.duplicateGroupKey,
  buildMemoryDuplicateKey({
    projectPath,
    sourceType: "project_doc",
    sourcePath: prdCard.sourcePath,
    sourceDocumentId: prdCard.sourceDocumentId,
    memoryType: prdCard.memoryType,
    title: docs[0].title,
    summary: prdCard.summary,
    body: prdCard.body,
  }),
  "PRD card duplicate key should be recomputable from source metadata",
);

const changedPrdDocs = docs.map((doc) =>
  doc.id === "prd-1"
    ? {
      ...doc,
      summary: "Decision: accept. Source changed after human confirmation.",
      contentText: "Decision: accept. The same PRD changed after a prior confirmation.",
      contentHash: "hash-prd-v2",
      updatedAt: "2026-06-13T09:30:00.000Z",
    }
    : doc,
);
const changedCards = buildProjectMemoryBackfillCards(changedPrdDocs, { projectPath, maxCards: 10 });
const changedPrdCard = changedCards.find((card) => card.sourceDocumentId === "prd-1");
assert.ok(changedPrdCard, "changed PRD should still create a candidate card");
assert.equal(changedPrdCard.id, prdCard.id, "source document changes should reuse the same backfill card id for re-review");
assert.equal(changedPrdCard.duplicateGroupKey, prdCard.duplicateGroupKey, "source document changes should stay in the same duplicate group");
assert.notEqual(changedPrdCard.sourceSignature, prdCard.sourceSignature, "source document changes should update the source signature");
assert.notEqual(changedPrdCard.sourceHash, prdCard.sourceHash, "test fixture must prove the source hash changed");

const reportCard = cards.find((card) => card.sourceDocumentId === "report-1");
assert.ok(reportCard, "report should create a candidate card");
assert.equal(reportCard.memoryType, "archive_note", "report card should keep the classified memory type");

const repeatCards = buildProjectMemoryBackfillCards(docs, { projectPath, maxCards: 10 });
assert.deepEqual(
  repeatCards.map((card) => card.id),
  cards.map((card) => card.id),
  "backfill card ids should be deterministic for idempotent upsert",
);

const boundedCards = buildProjectMemoryBackfillCards(docs, { projectPath, maxCards: 1 });
assert.equal(boundedCards.length, 1, "maxCards should bound the number of generated candidate cards");
assert.equal(boundedCards[0].sourceDocumentId, "prd-1", "maxCards should keep deterministic ordering from input documents");

console.log("Project memory backfill policy behavior tests passed.");
