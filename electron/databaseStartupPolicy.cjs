const path = require("node:path");

async function openKnowledgeDatabaseFromFile(options = {}) {
  const {
    Runtime,
    file,
    readFile,
    ensureParentDir,
    backupUnreadableDatabaseFile,
  } = options;

  if (!Runtime || typeof Runtime.Database !== "function") {
    throw new Error("Runtime.Database is required to open the knowledge database");
  }
  if (!file || typeof file !== "string") {
    throw new Error("A database file path is required");
  }
  if (typeof readFile !== "function") {
    throw new Error("readFile is required");
  }
  if (typeof backupUnreadableDatabaseFile !== "function") {
    throw new Error("backupUnreadableDatabaseFile is required");
  }

  if (typeof ensureParentDir === "function") {
    await ensureParentDir(path.dirname(file));
  }

  try {
    const bytes = await readFile(file);
    const db = new Runtime.Database(bytes);
    try {
      db.exec("PRAGMA schema_version");
    } catch (error) {
      if (typeof db.close === "function") db.close();
      const backupPath = await backupUnreadableDatabaseFile(file, error);
      const reason = error?.message || String(error || "unknown database validation error");
      const refusal = new Error(
        `Zhixia refused to replace an unreadable knowledge-store.sqlite with an empty database. ` +
          `A byte-for-byte backup was written to ${backupPath || "unavailable"}. Original error: ${reason}`,
      );
      refusal.zhixiaDatabaseStartupRefusal = true;
      throw refusal;
    }
    return {
      db,
      createdEmpty: false,
      backupPath: null,
    };
  } catch (error) {
    if (error?.zhixiaDatabaseStartupRefusal) throw error;
    if (error?.code === "ENOENT") {
      return {
        db: new Runtime.Database(),
        createdEmpty: true,
        backupPath: null,
      };
    }
    const backupPath = await backupUnreadableDatabaseFile(file, error);
    const reason = error?.message || String(error || "unknown database open error");
    throw new Error(
      `Zhixia refused to replace an unreadable knowledge-store.sqlite with an empty database. ` +
        `A byte-for-byte backup was written to ${backupPath || "unavailable"}. Original error: ${reason}`,
    );
  }
}

module.exports = {
  openKnowledgeDatabaseFromFile,
};
