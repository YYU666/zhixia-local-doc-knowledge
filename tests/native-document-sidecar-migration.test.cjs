const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  buildRollbackReceipt,
  executeNativeDocumentMigration,
  planNativeDocumentMigration,
  sha256File,
} = require("../electron/nativeDocumentSidecarMigration.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-native-shadow-"));
try {
  const source = path.join(root, "sqljs-main.sqlite");
  const out = path.join(root, "migration-output");
  const db = new DatabaseSync(source);
  db.exec(`CREATE TABLE documents (
    id TEXT PRIMARY KEY, projectId TEXT, title TEXT, sourcePath TEXT, sourceType TEXT,
    mimeType TEXT, contentHash TEXT, duplicateOf TEXT, createdAt TEXT, updatedAt TEXT, contentText TEXT
  )`);
  const bodySentinel = `RAW_BODY_MUST_NOT_MIGRATE_${"Z".repeat(4000)}`;
  db.prepare("INSERT INTO documents VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "doc-1", "project-alpha", "Alpha", "docs/alpha.md", "markdown", "text/markdown", "hash-alpha", null,
    "2026-07-01T00:00:00.000Z", "2026-07-28T00:00:00.000Z", bodySentinel,
  );
  db.prepare("INSERT INTO documents VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "doc-2", "project-alpha", "Beta", "docs/beta.md", "markdown", "text/markdown", "hash-beta", "doc-1",
    "2026-07-02T00:00:00.000Z", "2026-07-28T00:00:00.000Z", "small body",
  );
  db.close();
  const sourceHashBefore = sha256File(source);

  const dryRun = planNativeDocumentMigration(source, out);
  assert.equal(dryRun.mode, "dry_run");
  assert.equal(fs.existsSync(dryRun.outputs.migrationDir), false, "dry-run must not create migration files");

  const manifest = executeNativeDocumentMigration(source, out, { execute: true });
  assert.equal(manifest.verification.passed, true);
  assert.equal(manifest.verification.sourceRowCount, 2);
  assert.equal(manifest.verification.shadowRowCount, 2);
  assert.equal(manifest.source.unchanged, true, "source DB must remain byte-for-byte unchanged");
  assert.equal(sha256File(source), sourceHashBefore);
  assert.equal(manifest.snapshot.exactSourceCopy, true, "snapshot hash must equal source hash");
  assert.equal(manifest.shadow.containsContentText, false, "shadow schema must not contain contentText");
  assert.doesNotMatch(fs.readFileSync(manifest.shadow.path).toString("latin1"), /RAW_BODY_MUST_NOT_MIGRATE/, "shadow file must not contain long body sentinel");

  const shadow = new DatabaseSync(manifest.shadow.path, { readOnly: true });
  const row = shadow.prepare("SELECT * FROM document_metadata WHERE sourceDocumentId='doc-1'").get();
  shadow.close();
  assert.equal(row.contentLength, bodySentinel.length, "shadow may retain bounded content length metadata");
  assert.equal(row.sourcePath, "docs/alpha.md");

  const receiptA = buildRollbackReceipt(manifest);
  const receiptB = buildRollbackReceipt(JSON.parse(JSON.stringify(manifest)));
  assert.deepEqual(receiptA, receiptB, "rollback receipt must be deterministic");
  assert.equal(receiptA.sourceMutation, false);
  assert.equal(receiptA.action, "quarantine_shadow_only");
  console.log("Native document sidecar migration tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
