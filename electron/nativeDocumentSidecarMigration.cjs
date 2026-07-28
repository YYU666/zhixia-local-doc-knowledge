const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const MIGRATION_SCHEMA = "zhixia.native_document_sidecar_migration.v1";

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function availableColumn(columns, candidates) {
  return candidates.find((candidate) => columns.has(candidate)) || null;
}

function expressionFor(columns, candidates, alias, fallback = "NULL") {
  const column = availableColumn(columns, candidates);
  return `${column ? quoteIdentifier(column) : fallback} AS ${quoteIdentifier(alias)}`;
}

function planNativeDocumentMigration(sourcePath, outputDir) {
  const source = path.resolve(sourcePath);
  const targetRoot = path.resolve(outputDir);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("source_database_missing");
  if (source === targetRoot || source.startsWith(`${targetRoot}${path.sep}`)) throw new Error("migration_output_must_not_own_source_database");
  const sourceBytes = fs.statSync(source).size;
  const sourceSha256 = sha256File(source);
  const migrationId = `native-shadow-${sourceSha256.slice(0, 20)}`;
  const migrationDir = path.join(targetRoot, migrationId);
  return {
    schemaVersion: MIGRATION_SCHEMA,
    mode: "dry_run",
    migrationId,
    source: { path: source, bytes: sourceBytes, sha256: sourceSha256, authority: "sqljs_main_database" },
    outputs: {
      migrationDir,
      snapshotPath: path.join(migrationDir, "source-snapshot.sqlite"),
      shadowPath: path.join(migrationDir, "native-document-metadata-shadow.sqlite"),
      manifestPath: path.join(migrationDir, "migration-manifest.json"),
    },
    cutover: false,
    sourceMutation: false,
    rollback: "quarantine_or_discard_shadow_only",
  };
}

function executeNativeDocumentMigration(sourcePath, outputDir, options = {}) {
  if (options.execute !== true) return planNativeDocumentMigration(sourcePath, outputDir);
  const plan = planNativeDocumentMigration(sourcePath, outputDir);
  if (fs.existsSync(plan.outputs.migrationDir)) throw new Error("migration_output_already_exists");
  fs.mkdirSync(plan.outputs.migrationDir, { recursive: true });
  fs.copyFileSync(plan.source.path, plan.outputs.snapshotPath, fs.constants.COPYFILE_EXCL);
  const snapshotSha256 = sha256File(plan.outputs.snapshotPath);
  if (snapshotSha256 !== plan.source.sha256) throw new Error("source_snapshot_hash_mismatch");

  const sourceDb = new DatabaseSync(plan.outputs.snapshotPath, { readOnly: true, enableForeignKeyConstraints: false });
  const shadowDb = new DatabaseSync(plan.outputs.shadowPath);
  let sourceCount = 0;
  try {
    sourceDb.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
    const table = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get();
    if (!table) throw new Error("documents_table_missing");
    const columns = new Set(sourceDb.prepare("PRAGMA table_info(documents)").all().map((row) => row.name));
    sourceCount = Number(sourceDb.prepare("SELECT COUNT(*) AS count FROM documents").get()?.count || 0);
    const selectSql = `SELECT
      ${expressionFor(columns, ["id"], "sourceDocumentId", "rowid")},
      ${expressionFor(columns, ["projectId", "project_id"], "projectId")},
      ${expressionFor(columns, ["title", "name", "fileName"], "title", "''")},
      ${expressionFor(columns, ["sourcePath", "path", "filePath"], "sourcePath")},
      ${expressionFor(columns, ["sourceType", "type"], "sourceType")},
      ${expressionFor(columns, ["mimeType", "mime"], "mimeType")},
      ${expressionFor(columns, ["contentHash", "hash", "sha256"], "contentHash")},
      ${expressionFor(columns, ["duplicateOf", "duplicate_of"], "duplicateOf")},
      ${expressionFor(columns, ["createdAt", "created_at"], "createdAt")},
      ${expressionFor(columns, ["updatedAt", "updated_at", "modifiedAt"], "updatedAt")},
      ${columns.has("contentText") ? "length(contentText)" : "0"} AS contentLength
      FROM documents ORDER BY sourceDocumentId`;
    shadowDb.exec(`
      PRAGMA journal_mode = DELETE;
      CREATE TABLE document_metadata (
        sourceDocumentId TEXT PRIMARY KEY, projectId TEXT, title TEXT NOT NULL,
        sourcePath TEXT, sourceType TEXT, mimeType TEXT, contentHash TEXT,
        duplicateOf TEXT, createdAt TEXT, updatedAt TEXT, contentLength INTEGER NOT NULL
      );
      CREATE INDEX idx_document_metadata_project ON document_metadata(projectId);
      CREATE INDEX idx_document_metadata_source_path ON document_metadata(sourcePath);
      CREATE TABLE migration_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const insert = shadowDb.prepare(`INSERT INTO document_metadata(
      sourceDocumentId, projectId, title, sourcePath, sourceType, mimeType, contentHash, duplicateOf, createdAt, updatedAt, contentLength
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    shadowDb.exec("BEGIN IMMEDIATE");
    try {
      for (const row of sourceDb.prepare(selectSql).iterate()) {
        insert.run(String(row.sourceDocumentId), row.projectId, String(row.title || ""), row.sourcePath, row.sourceType, row.mimeType, row.contentHash, row.duplicateOf, row.createdAt, row.updatedAt, Number(row.contentLength || 0));
      }
      const metadata = shadowDb.prepare("INSERT INTO migration_metadata(key, value) VALUES(?, ?)");
      metadata.run("schemaVersion", MIGRATION_SCHEMA);
      metadata.run("migrationId", plan.migrationId);
      metadata.run("sourceSha256", plan.source.sha256);
      metadata.run("snapshotSha256", snapshotSha256);
      metadata.run("cutover", "false");
      shadowDb.exec("COMMIT");
    } catch (error) {
      shadowDb.exec("ROLLBACK");
      throw error;
    }
  } finally {
    sourceDb.close();
    shadowDb.close();
  }

  const sourceAfterSha256 = sha256File(plan.source.path);
  const shadowVerify = new DatabaseSync(plan.outputs.shadowPath, { readOnly: true });
  const shadowCount = Number(shadowVerify.prepare("SELECT COUNT(*) AS count FROM document_metadata").get()?.count || 0);
  const shadowColumns = shadowVerify.prepare("PRAGMA table_info(document_metadata)").all().map((row) => row.name);
  shadowVerify.close();
  const manifest = {
    ...plan,
    mode: "executed_shadow_only",
    source: { ...plan.source, sha256After: sourceAfterSha256, unchanged: sourceAfterSha256 === plan.source.sha256 },
    snapshot: { path: plan.outputs.snapshotPath, sha256: snapshotSha256, exactSourceCopy: snapshotSha256 === plan.source.sha256 },
    shadow: { path: plan.outputs.shadowPath, sha256: sha256File(plan.outputs.shadowPath), rowCount: shadowCount, columns: shadowColumns, containsContentText: shadowColumns.includes("contentText") },
    verification: { sourceRowCount: sourceCount, shadowRowCount: shadowCount, rowCountsMatch: sourceCount === shadowCount, passed: sourceAfterSha256 === plan.source.sha256 && snapshotSha256 === plan.source.sha256 && sourceCount === shadowCount && !shadowColumns.includes("contentText") },
    generatedAt: new Date().toISOString(),
  };
  if (!manifest.verification.passed) throw new Error("native_shadow_verification_failed");
  fs.writeFileSync(plan.outputs.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return manifest;
}

function buildRollbackReceipt(manifest) {
  const receiptCore = {
    schemaVersion: MIGRATION_SCHEMA,
    migrationId: manifest.migrationId,
    sourcePath: manifest.source.path,
    sourceSha256: manifest.source.sha256,
    shadowPath: manifest.shadow?.path || manifest.outputs.shadowPath,
    action: "quarantine_shadow_only",
    sourceMutation: false,
    cutover: false,
  };
  return { ...receiptCore, receiptSha256: crypto.createHash("sha256").update(JSON.stringify(receiptCore)).digest("hex") };
}

module.exports = {
  MIGRATION_SCHEMA,
  buildRollbackReceipt,
  executeNativeDocumentMigration,
  planNativeDocumentMigration,
  sha256File,
};
