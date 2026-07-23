const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const preservationScript = fs.readFileSync(
  path.join(root, "scripts", "preserve-openclaw-memory.ps1"),
  "utf8",
);
const removalScript = fs.readFileSync(
  path.join(root, "scripts", "remove-verified-openclaw-memory.ps1"),
  "utf8",
);
const clearIndexScript = fs.readFileSync(
  path.join(root, "scripts", "clear-openclaw-memory-index.py"),
  "utf8",
);
const auditScript = fs.readFileSync(
  path.join(root, "scripts", "audit-openclaw-memory-index.py"),
  "utf8",
);
const integrationDoc = fs.readFileSync(
  path.join(root, "docs", "OPENCLAW_MEMORY_CONTEXT_INTEGRATION.md"),
  "utf8",
);

assert.match(preservationScript, /zhixia\.openclaw_memory_vault\.v1/);
assert.match(preservationScript, /sourceSha256/);
assert.match(preservationScript, /backupSha256/);
assert.match(preservationScript, /Assert-NoReparsePathComponents/);
assert.match(preservationScript, /DryRun/);
assert.match(preservationScript, /sourceFilesRemoved = \$false/);
assert.match(removalScript, /zhixia\.openclaw_memory_vault\.v1/);
assert.match(removalScript, /sourceHash/);
assert.match(removalScript, /backupHash/);
assert.match(removalScript, /Pre-removal hash verification failed/);
assert.match(removalScript, /Test-AllowedMemoryRelativePath/);
assert.match(removalScript, /Manifest source does not match its instance-relative memory path/);
assert.match(removalScript, /Manifest backup does not match the app-owned vault path/);
assert.match(removalScript, /AllowedVaultRoot/);
assert.match(removalScript, /ValidateOnly/);
assert.match(removalScript, /rawSessionsTouched = \$false/);
assert.match(removalScript, /taskLedgerTouched = \$false/);
assert.match(removalScript, /agentDatabaseDeleted = \$false/);

const clearTableBlock = clearIndexScript.match(/CLEAR_TABLES = \(([^)]*)\)/s);
assert.ok(clearTableBlock, "memory index clear table allowlist must exist");
const clearTableNames = [...clearTableBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(clearTableNames, [
  "memory_index_chunks_fts",
  "memory_index_chunks",
  "memory_index_sources",
  "memory_index_meta",
  "memory_embedding_cache",
]);
assert.match(clearIndexScript, /BEGIN IMMEDIATE/);
assert.match(clearIndexScript, /VALUES\('rebuild'\)/);
assert.match(clearIndexScript, /PRAGMA quick_check/);
assert.match(clearIndexScript, /nonMemoryTablesTargeted/);
assert.match(clearIndexScript, /--validate-only/);
assert.match(clearIndexScript, /--execute/);
assert.match(clearIndexScript, /assert_no_reparse_components/);
assert.match(auditScript, /mode=ro/);

if (process.platform === "win32") {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-openclaw-memory-policy-"));
  try {
    const defaultRoot = path.join(tempRoot, ".openclaw");
    const isolatedRoot = path.join(tempRoot, ".openclaw-ceoflow");
    const vaultRoot = path.join(tempRoot, "vault");
    const batchRoot = path.join(vaultRoot, "batch");
    fs.mkdirSync(defaultRoot, { recursive: true });
    fs.mkdirSync(isolatedRoot, { recursive: true });

    const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const runPreservation = (targetBatch, dryRun = false) => {
      const command = [
        `& ${quote(path.join(root, "scripts", "preserve-openclaw-memory.ps1"))}`,
        `-AllowedStateRoots @(${quote(defaultRoot)},${quote(isolatedRoot)})`,
        `-AllowedVaultRoot ${quote(vaultRoot)}`,
        `-VaultBatchPath ${quote(targetBatch)}`,
        dryRun ? "-DryRun" : "",
      ].filter(Boolean).join(" ");
      return spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    };
    const runValidation = (manifestPath) => {
      const command = [
        `& ${quote(path.join(root, "scripts", "remove-verified-openclaw-memory.ps1"))}`,
        `-ManifestPath ${quote(manifestPath)}`,
        `-AllowedStateRoots @(${quote(defaultRoot)},${quote(isolatedRoot)})`,
        `-AllowedVaultRoot ${quote(vaultRoot)}`,
        "-ValidateOnly",
      ].join(" ");
      return spawnSync("pwsh.exe", ["-NoProfile", "-Command", command], {
        encoding: "utf8",
      });
    };

    const validContent = Buffer.from("verified memory", "utf8");
    const validRelative = path.join("workspace", "MEMORY.md");
    const validSource = path.join(defaultRoot, validRelative);
    fs.mkdirSync(path.dirname(validSource), { recursive: true });
    fs.writeFileSync(validSource, validContent);
    const dryRunResult = runPreservation(batchRoot, true);
    assert.equal(dryRunResult.status, 0, dryRunResult.stderr || dryRunResult.stdout);
    assert.match(dryRunResult.stdout, /"writesPerformed": false/);
    assert.equal(fs.existsSync(batchRoot), false, "preservation dry-run must not create the vault batch");
    assert.equal(fs.existsSync(validSource), true);

    const preserveResult = runPreservation(batchRoot, false);
    assert.equal(preserveResult.status, 0, preserveResult.stderr || preserveResult.stdout);
    const validManifestPath = path.join(batchRoot, "MANIFEST.json");
    const validManifest = JSON.parse(fs.readFileSync(validManifestPath, "utf8"));
    const validBackup = validManifest.entries[0].backupPath;
    assert.equal(validManifest.allVerified, true);
    assert.equal(validManifest.entries[0].sourceSha256, sha256(validContent));
    assert.equal(fs.existsSync(validBackup), true);
    assert.equal(fs.existsSync(validSource), true, "preservation must not remove the source");
    const validResult = runValidation(validManifestPath);
    assert.equal(validResult.status, 0, validResult.stderr || validResult.stdout);
    assert.match(validResult.stdout, /"wouldDelete": false/);
    assert.equal(fs.existsSync(validSource), true);

    const forbiddenContent = Buffer.from("do not delete config", "utf8");
    const forbiddenRelative = "openclaw.json";
    const forbiddenSource = path.join(defaultRoot, forbiddenRelative);
    const forbiddenBatch = path.join(vaultRoot, "forbidden-batch");
    const forbiddenBackup = path.join(forbiddenBatch, "openclaw", forbiddenRelative);
    fs.mkdirSync(path.dirname(forbiddenBackup), { recursive: true });
    fs.writeFileSync(forbiddenSource, forbiddenContent);
    fs.writeFileSync(forbiddenBackup, forbiddenContent);
    const forbiddenManifest = {
      schemaVersion: "zhixia.openclaw_memory_vault.v1",
      vaultPath: forbiddenBatch,
      allVerified: true,
      entries: [{
        instance: "openclaw",
        relativePath: forbiddenRelative,
        sourcePath: forbiddenSource,
        backupPath: forbiddenBackup,
        bytes: forbiddenContent.length,
        sourceSha256: sha256(forbiddenContent),
        backupSha256: sha256(forbiddenContent),
      }],
    };
    const forbiddenManifestPath = path.join(forbiddenBatch, "MANIFEST.json");
    fs.writeFileSync(forbiddenManifestPath, JSON.stringify(forbiddenManifest));
    const forbiddenResult = runValidation(forbiddenManifestPath);
    assert.notEqual(forbiddenResult.status, 0);
    assert.match(forbiddenResult.stderr, /not an allowed OpenClaw memory file/);
    assert.equal(fs.existsSync(forbiddenSource), true);

    const traversalManifest = {
      ...forbiddenManifest,
      entries: [{
        ...forbiddenManifest.entries[0],
        relativePath: "workspace\\memory\\..\\..\\openclaw.json",
      }],
    };
    const traversalBatch = path.join(vaultRoot, "traversal-batch");
    fs.mkdirSync(traversalBatch, { recursive: true });
    traversalManifest.vaultPath = traversalBatch;
    const traversalManifestPath = path.join(traversalBatch, "MANIFEST.json");
    fs.writeFileSync(traversalManifestPath, JSON.stringify(traversalManifest));
    const traversalResult = runValidation(traversalManifestPath);
    assert.notEqual(traversalResult.status, 0);
    assert.match(traversalResult.stderr, /not an allowed OpenClaw memory file/);

    const leadingTraversalManifest = {
      ...forbiddenManifest,
      entries: [{
        ...forbiddenManifest.entries[0],
        relativePath: "..\\workspace\\memory\\x.md",
      }],
    };
    const leadingTraversalBatch = path.join(vaultRoot, "leading-traversal-batch");
    fs.mkdirSync(leadingTraversalBatch, { recursive: true });
    leadingTraversalManifest.vaultPath = leadingTraversalBatch;
    const leadingTraversalPath = path.join(leadingTraversalBatch, "MANIFEST.json");
    fs.writeFileSync(leadingTraversalPath, JSON.stringify(leadingTraversalManifest));
    const leadingTraversalResult = runValidation(leadingTraversalPath);
    assert.notEqual(leadingTraversalResult.status, 0);
    assert.match(leadingTraversalResult.stderr, /not an allowed OpenClaw memory file/);

    const backupEscapeBatch = path.join(vaultRoot, "backup-escape-batch");
    fs.mkdirSync(backupEscapeBatch, { recursive: true });
    const backupEscapeManifest = {
      ...validManifest,
      vaultPath: backupEscapeBatch,
      entries: [{
        ...validManifest.entries[0],
        backupPath: forbiddenBackup,
      }],
    };
    const backupEscapePath = path.join(backupEscapeBatch, "MANIFEST.json");
    fs.writeFileSync(backupEscapePath, JSON.stringify(backupEscapeManifest));
    const backupEscapeResult = runValidation(backupEscapePath);
    assert.notEqual(backupEscapeResult.status, 0);
    assert.match(backupEscapeResult.stderr, /backup does not match the app-owned vault path/);

    const samePathBatch = path.join(vaultRoot, "same-path-batch");
    fs.mkdirSync(samePathBatch, { recursive: true });
    const samePathManifest = {
      ...validManifest,
      vaultPath: samePathBatch,
      entries: [{
        ...validManifest.entries[0],
        backupPath: validSource,
      }],
    };
    const samePathManifestPath = path.join(samePathBatch, "MANIFEST.json");
    fs.writeFileSync(samePathManifestPath, JSON.stringify(samePathManifest));
    const samePathResult = runValidation(samePathManifestPath);
    assert.notEqual(samePathResult.status, 0);
    assert.equal(fs.existsSync(validSource), true);

    const outsideMemory = path.join(tempRoot, "outside-memory");
    const linkedMemory = path.join(defaultRoot, "workspace", "memory", "linked");
    fs.mkdirSync(outsideMemory, { recursive: true });
    fs.mkdirSync(path.dirname(linkedMemory), { recursive: true });
    fs.writeFileSync(path.join(outsideMemory, "escape.md"), "junction sentinel");
    fs.symlinkSync(outsideMemory, linkedMemory, "junction");
    const linkedResult = runPreservation(path.join(vaultRoot, "linked-batch"), true);
    assert.notEqual(linkedResult.status, 0);
    assert.match(linkedResult.stderr, /Reparse points are not allowed|Reparse-point path components are not allowed/);
    fs.rmSync(linkedMemory, { recursive: true, force: true });

    const databasePath = path.join(defaultRoot, "agents", "main", "agent", "openclaw-agent.sqlite");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE memory_index_chunks(id INTEGER); INSERT INTO memory_index_chunks VALUES(1);");
    database.close();
    const clearScript = path.join(root, "scripts", "clear-openclaw-memory-index.py");
    const validateClear = spawnSync("python", [clearScript, "--validate-only", defaultRoot], { encoding: "utf8" });
    assert.equal(validateClear.status, 0, validateClear.stderr || validateClear.stdout);
    assert.match(validateClear.stdout, /"writesPerformed": false/);
    const beforeClear = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(beforeClear.prepare("SELECT COUNT(*) AS count FROM memory_index_chunks").get().count, 1);
    beforeClear.close();
    const executeClear = spawnSync("python", [clearScript, "--execute", defaultRoot], { encoding: "utf8" });
    assert.equal(executeClear.status, 0, executeClear.stderr || executeClear.stdout);
    const afterClear = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(afterClear.prepare("SELECT COUNT(*) AS count FROM memory_index_chunks").get().count, 0);
    afterClear.close();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

for (const requiredText of [
  "Zhixia = the only canonical project-memory runtime",
  "OpenClaw native durable memory = disabled",
  "session-memory hook and compaction memory flush: disabled",
  "native `memory-core` plugin: not allowed",
]) {
  assert.ok(integrationDoc.includes(requiredText), `missing OpenClaw memory boundary: ${requiredText}`);
}

console.log("OpenClaw memory authority policy tests passed.");
