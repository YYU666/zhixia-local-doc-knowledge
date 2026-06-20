const assert = require("node:assert/strict");
const initSqlJs = require("sql.js");

const {
  documentSelectSql,
  rowToDocument,
} = require("../electron/documentMetadataPolicy.cjs");

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE documents (
      id TEXT,
      title TEXT,
      fileName TEXT,
      filePath TEXT,
      extension TEXT,
      size INTEGER,
      importedAt TEXT,
      updatedAt TEXT,
      fileModifiedAt TEXT,
      contentHash TEXT,
      contentText TEXT,
      summary TEXT,
      tagsJson TEXT,
      favorite INTEGER,
      parseStatus TEXT,
      parseError TEXT,
      duplicateOf TEXT,
      indexVersion INTEGER,
      sourceType TEXT,
      workspacePath TEXT,
      artifactType TEXT
    )
  `);

  const largeBody = "x".repeat(200000);
  db.run(
    `INSERT INTO documents VALUES (
      $id, $title, $fileName, $filePath, $extension, $size, $importedAt, $updatedAt,
      $fileModifiedAt, $contentHash, $contentText, $summary, $tagsJson, $favorite,
      $parseStatus, $parseError, $duplicateOf, $indexVersion, $sourceType, $workspacePath, $artifactType
    )`,
    {
      $id: "doc-large",
      $title: "Large Project PRD",
      $fileName: "PRD.md",
      $filePath: "C:/Users/example/Documents/zhixia/docs/PRD.md",
      $extension: ".md",
      $size: largeBody.length,
      $importedAt: "2026-06-12T20:00:00.000Z",
      $updatedAt: "2026-06-12T20:00:00.000Z",
      $fileModifiedAt: "2026-06-12T20:00:00.000Z",
      $contentHash: "hash-large",
      $contentText: largeBody,
      $summary: "Compact summary only.",
      $tagsJson: JSON.stringify(["prd", "metadata"]),
      $favorite: 1,
      $parseStatus: "ok",
      $parseError: null,
      $duplicateOf: null,
      $indexVersion: 2,
      $sourceType: "codex_output",
      $workspacePath: "C:/Users/example/Documents/zhixia",
      $artifactType: "prd",
    },
  );

  const defaultSql = documentSelectSql();
  assert.match(defaultSql, /'' AS contentText/, "default document list query should be metadata-first");
  assert.match(defaultSql, /LENGTH\(contentText\) AS contentLength/, "metadata query should expose content length without returning contentText");

  const metadataSql = documentSelectSql({ includeContentText: false });
  assert.match(metadataSql, /'' AS contentText/, "metadata query should replace contentText with an empty literal");
  assert.doesNotMatch(metadataSql, /substr\(contentText/, "metadata query should not even request a truncated body");

  const metadataRow = db.exec(metadataSql)[0].values[0];
  const metadataDoc = rowToDocument(metadataRow);
  assert.equal(metadataDoc.id, "doc-large", "metadata query should still return the document row");
  assert.equal(metadataDoc.contentText, "", "metadata-only rows must not carry large document bodies");
  assert.equal(metadataDoc.contentLength, largeBody.length, "metadata-only rows should carry length for stats without body payload");
  assert.deepEqual(metadataDoc.tags, ["prd", "metadata"], "metadata row mapping should preserve tags");

  const previewSql = documentSelectSql({ includeContentText: true, contentTextLimit: 64 });
  assert.match(previewSql, /substr\(contentText, 1, 64\) AS contentText/, "preview query should explicitly cap contentText");
  const previewDoc = rowToDocument(db.exec(previewSql)[0].values[0]);
  assert.equal(previewDoc.contentText.length, 64, "preview query should return only the configured content cap");
  assert.notEqual(previewDoc.contentText.length, largeBody.length, "preview query must not return the full large body");

  db.close();
  console.log("Document metadata policy SQLite behavior tests passed.");
})();
