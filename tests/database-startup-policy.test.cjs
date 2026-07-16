const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const initSqlJs = require("sql.js");

const { openKnowledgeDatabaseFromFile } = require("../electron/databaseStartupPolicy.cjs");

(async () => {
  const Runtime = await initSqlJs();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixia-db-startup-"));

  try {
    const missingDbPath = path.join(root, "missing", "knowledge-store.sqlite");
    let backupCalledForMissing = false;
    const missingResult = await openKnowledgeDatabaseFromFile({
      Runtime,
      file: missingDbPath,
      readFile: fs.readFile,
      ensureParentDir: (dir) => fs.mkdir(dir, { recursive: true }),
      backupUnreadableDatabaseFile: async () => {
        backupCalledForMissing = true;
        throw new Error("backup must not run for first-start ENOENT");
      },
    });
    assert.equal(missingResult.createdEmpty, true, "missing database should create a new empty sql.js database");
    assert.equal(backupCalledForMissing, false, "missing database must not be treated as unreadable/corrupt");
    missingResult.db.close();

    const corruptDbPath = path.join(root, "corrupt", "knowledge-store.sqlite");
    await fs.mkdir(path.dirname(corruptDbPath), { recursive: true });
    const corruptBytes = Buffer.from("not-a-sqlite-database-but-existing-user-data", "utf8");
    await fs.writeFile(corruptDbPath, corruptBytes);
    const backupPath = path.join(root, "backups", "knowledge-store-unreadable-test.sqlite");

    await assert.rejects(
      () => openKnowledgeDatabaseFromFile({
        Runtime,
        file: corruptDbPath,
        readFile: fs.readFile,
        ensureParentDir: (dir) => fs.mkdir(dir, { recursive: true }),
        backupUnreadableDatabaseFile: async (source) => {
          await fs.mkdir(path.dirname(backupPath), { recursive: true });
          await fs.copyFile(source, backupPath);
          return backupPath;
        },
      }),
      /refused to replace an unreadable knowledge-store\.sqlite with an empty database/i,
      "existing corrupt database should fail hard instead of being replaced by an empty database",
    );

    assert.deepEqual(await fs.readFile(corruptDbPath), corruptBytes, "corrupt original database bytes must remain untouched");
    assert.deepEqual(await fs.readFile(backupPath), corruptBytes, "backup must preserve the original corrupt database bytes");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log("Database startup policy behavior tests passed.");
})();
