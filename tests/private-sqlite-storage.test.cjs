const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  WINDOWS_ACL_BOUNDARY,
  copyPrivateSqliteBackup,
  preparePrivateSqliteStorage,
  repairPrivateSqliteFiles,
} = require("../codex-skills/zhixia-local-docs/scripts/private-sqlite-storage.cjs");
const { openMemoryRuntimeIndex, storageTrustedRoot } = require("../electron/memoryRuntimeIndexStore.cjs");

function permissionBits(target) {
  return fs.statSync(target).mode & 0o777;
}

function snapshotTree(root) {
  const result = [];
  function visit(current, relative = "") {
    const stat = fs.lstatSync(current);
    const item = { path: relative || ".", mode: stat.mode & 0o777, type: stat.isDirectory() ? "dir" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "link" : "other" };
    if (stat.isFile()) item.sha256 = crypto.createHash("sha256").update(fs.readFileSync(current)).digest("hex");
    if (stat.isSymbolicLink()) item.target = fs.readlinkSync(current);
    result.push(item);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), relative ? path.join(relative, name) : name);
    }
  }
  visit(root);
  return result;
}

function restoreSwap(linkPath, parkedPath) {
  if (fs.lstatSync(linkPath).isSymbolicLink()) fs.unlinkSync(linkPath);
  fs.renameSync(parkedPath, linkPath);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-private-sqlite-"));
  try {
    if (process.platform === "win32") {
      const databasePath = path.join(root, "windows-boundary", "memory-runtime-index.sqlite");
      const prepared = preparePrivateSqliteStorage(databasePath, { platform: "win32", trustedRoot: root });
      assert.deepEqual(prepared.acl, WINDOWS_ACL_BOUNDARY);
      assert.equal(prepared.acl.status, "deferred_unverified", "Windows must not claim native ACL evidence");
      assert.equal(prepared.directoryMode, null, "Windows must not report POSIX directory-mode enforcement");
      assert.equal(prepared.fileMode, null, "Windows must not report POSIX file-mode enforcement");
      assert.equal(fs.existsSync(databasePath), true, "the guarded Windows storage path must still be prepared");
      assert.deepEqual(
        repairPrivateSqliteFiles(databasePath, { platform: "win32", trustedRoot: root }).acl,
        WINDOWS_ACL_BOUNDARY,
      );
      console.log("Private SQLite Windows ACL boundary tests passed.");
      return;
    }

    const storeRoot = path.join(root, "memory-runtime");
    fs.mkdirSync(storeRoot, { mode: 0o777 });
    fs.chmodSync(storeRoot, 0o777);
    const dbPath = path.join(storeRoot, "memory-runtime-index.sqlite");
    for (const name of [
      "memory-runtime-index.sqlite",
      "memory-runtime-index.sqlite-wal",
      "memory-runtime-index.sqlite-shm",
      "memory-runtime-index.sqlite-journal",
      "memory-runtime-index.sqlite.seed.tmp",
      "memory-runtime-index.sqlite.backup",
    ]) {
      fs.writeFileSync(path.join(storeRoot, name), name === "memory-runtime-index.sqlite" ? "" : "sidecar fixture", { mode: 0o666 });
      fs.chmodSync(path.join(storeRoot, name), 0o666);
    }
    fs.writeFileSync(path.join(storeRoot, "unrelated.txt"), "not managed", { mode: 0o666 });
    fs.chmodSync(path.join(storeRoot, "unrelated.txt"), 0o666);

    preparePrivateSqliteStorage(dbPath, { trustedRoot: root });
    assert.equal(permissionBits(storeRoot), OWNER_ONLY_DIRECTORY_MODE, "pre-existing permissive private directory must be repaired");
    for (const name of fs.readdirSync(storeRoot).filter((entry) => entry !== "unrelated.txt")) {
      assert.equal(permissionBits(path.join(storeRoot, name)), OWNER_ONLY_FILE_MODE, `${name} must be owner-only`);
    }
    assert.equal(permissionBits(path.join(storeRoot, "unrelated.txt")), 0o666, "policy must not chmod unrelated files");

    for (const transient of ["memory-runtime-index.sqlite-wal", "memory-runtime-index.sqlite-shm", "memory-runtime-index.sqlite-journal"]) {
      fs.rmSync(path.join(storeRoot, transient), { force: true });
    }
    const db = openMemoryRuntimeIndex(storeRoot);
    try {
      db.exec("CREATE TABLE IF NOT EXISTS private_mode_probe (id TEXT PRIMARY KEY); INSERT OR REPLACE INTO private_mode_probe VALUES ('ok')");
      repairPrivateSqliteFiles(dbPath, { trustedRoot: root });
      for (const name of fs.readdirSync(storeRoot).filter((entry) => /^memory-runtime-index\.sqlite(?:$|-|\.)/.test(entry))) {
        assert.equal(permissionBits(path.join(storeRoot, name)), OWNER_ONLY_FILE_MODE, `live SQLite family ${name} must be owner-only`);
      }
    } finally {
      db.close();
    }

    const freshDbPath = path.join(root, "fresh", "nested", "memory-runtime-index.sqlite");
    preparePrivateSqliteStorage(freshDbPath, { trustedRoot: root });
    assert.equal(permissionBits(path.join(root, "fresh")), OWNER_ONLY_DIRECTORY_MODE);
    assert.equal(permissionBits(path.dirname(freshDbPath)), OWNER_ONLY_DIRECTORY_MODE);
    assert.equal(permissionBits(freshDbPath), OWNER_ONLY_FILE_MODE);

    const firstUseStore = path.join(root, "first-use-memory-runtime");
    assert.equal(storageTrustedRoot(firstUseStore), root, "first use must use only the existing direct owner-controlled parent");
    const firstUseDb = openMemoryRuntimeIndex(firstUseStore);
    firstUseDb.close();
    assert.equal(storageTrustedRoot(firstUseStore), firstUseStore, "an existing store becomes its own minimal trusted root");

    const permissiveStore = path.join(root, "permissive-memory-runtime");
    fs.mkdirSync(permissiveStore, { mode: 0o777 });
    fs.chmodSync(permissiveStore, 0o777);
    assert.equal(storageTrustedRoot(permissiveStore), root, "a writable store must not authorize itself before guarded repair");
    const permissiveDb = openMemoryRuntimeIndex(permissiveStore);
    permissiveDb.close();
    assert.equal(permissionBits(permissiveStore), OWNER_ONLY_DIRECTORY_MODE, "the safe direct parent must repair a permissive store");
    assert.equal(storageTrustedRoot(permissiveStore), permissiveStore, "the repaired store may then become the minimal trusted root");

    if (process.platform !== "win32" && typeof process.getuid === "function") {
      const systemTemp = fs.existsSync("/private/tmp") ? "/private/tmp" : path.parse(root).root;
      const broadStore = path.join(systemTemp, `zhixia-unowned-authority-${process.pid}`);
      const broadParent = path.dirname(broadStore);
      const broadParentStat = fs.lstatSync(broadParent);
      if (broadParentStat.uid !== process.getuid()) {
        assert.throws(
          () => storageTrustedRoot(broadStore),
          { code: "PRIVATE_SQLITE_TRUSTED_ROOT_NOT_OWNER_CONTROLLED" },
          "first use must not silently grant a system-owned temporary directory storage authority",
        );
        assert.equal(fs.existsSync(broadStore), false, "rejected broad authority must not create the store path");
      }
    }

    const outside = path.join(root, "outside");
    fs.mkdirSync(outside, { mode: 0o755 });
    fs.writeFileSync(path.join(outside, "sentinel.txt"), "CONTENT-SENTINEL-MUST-NOT-LEAK", { mode: 0o644 });
    const outsideBefore = snapshotTree(outside);

    const ancestorLink = path.join(root, "ancestor-link");
    fs.symlinkSync(outside, ancestorLink);
    assert.throws(
      () => preparePrivateSqliteStorage(path.join(ancestorLink, "memory-runtime-index.sqlite"), { trustedRoot: root }),
      (error) => error.code === "PRIVATE_SQLITE_UNSAFE_PATH_TYPE" && !/CONTENT-SENTINEL|outside|memory-runtime-index/.test(error.message),
      "an ancestor symlink must fail before any outside access",
    );

    const nestedRoot = path.join(root, "nested-link-case");
    fs.mkdirSync(nestedRoot, { mode: 0o700 });
    fs.symlinkSync(outside, path.join(nestedRoot, "sidecar"));
    assert.throws(
      () => preparePrivateSqliteStorage(path.join(nestedRoot, "sidecar", "memory-runtime-index.sqlite"), { trustedRoot: root }),
      { code: "PRIVATE_SQLITE_UNSAFE_PATH_TYPE" },
      "a nested symlink must fail closed",
    );

    const raceRoot = path.join(root, "race-store");
    fs.mkdirSync(raceRoot, { mode: 0o700 });
    const parkedRaceRoot = path.join(root, "race-store-parked");
    let swapped = false;
    assert.throws(
      () => preparePrivateSqliteStorage(path.join(raceRoot, "memory-runtime-index.sqlite"), {
        trustedRoot: root,
        onStage({ phase }) {
          if (!swapped && phase === "before_database_create") {
            fs.renameSync(raceRoot, parkedRaceRoot);
            fs.symlinkSync(outside, raceRoot);
            swapped = true;
          }
        },
      }),
      { code: "PRIVATE_SQLITE_PATH_IDENTITY_CHANGED" },
      "an ancestor swap before database open must fail closed",
    );
    assert.deepEqual(snapshotTree(outside), outsideBefore, "database race must not alter outside path set, modes, or bytes");
    restoreSwap(raceRoot, parkedRaceRoot);

    const source = path.join(root, "knowledge-store.sqlite");
    fs.writeFileSync(source, "private database bytes", { mode: 0o666 });
    const backup = path.join(root, "backups", "knowledge-store.sqlite.backup");
    copyPrivateSqliteBackup(source, backup, { trustedRoot: root });
    assert.equal(fs.readFileSync(backup, "utf8"), "private database bytes");
    assert.equal(permissionBits(source), OWNER_ONLY_FILE_MODE, "backup source mode must be repaired");
    assert.equal(permissionBits(path.dirname(backup)), OWNER_ONLY_DIRECTORY_MODE);
    assert.equal(permissionBits(backup), OWNER_ONLY_FILE_MODE);

    const copyRaceDir = path.join(root, "copy-race");
    fs.mkdirSync(copyRaceDir, { mode: 0o700 });
    const parkedCopyRaceDir = path.join(root, "copy-race-parked");
    let copySwapped = false;
    assert.throws(
      () => copyPrivateSqliteBackup(source, path.join(copyRaceDir, "backup.sqlite"), {
        trustedRoot: root,
        onStage({ phase }) {
          if (!copySwapped && phase === "before_backup_copy") {
            fs.renameSync(copyRaceDir, parkedCopyRaceDir);
            fs.symlinkSync(outside, copyRaceDir);
            copySwapped = true;
          }
        },
      }),
      { code: "PRIVATE_SQLITE_PATH_IDENTITY_CHANGED" },
      "a target ancestor swap before copy must fail closed",
    );
    assert.deepEqual(snapshotTree(outside), outsideBefore, "backup race must not alter outside path set, modes, or bytes");
    restoreSwap(copyRaceDir, parkedCopyRaceDir);

    assert.deepEqual(snapshotTree(outside), outsideBefore, "all negative cases must leave outside state byte-for-byte and mode-for-mode unchanged");

    assert.throws(
      () => preparePrivateSqliteStorage(path.join(root, "missing-trusted-root.sqlite")),
      { code: "PRIVATE_SQLITE_TRUSTED_ROOT_REQUIRED" },
      "trustedRoot is a mandatory capability",
    );

    const windowsBoundary = preparePrivateSqliteStorage(path.join(root, "windows-boundary", "memory-runtime-index.sqlite"), { platform: "win32", trustedRoot: root });
    assert.deepEqual(windowsBoundary.acl, WINDOWS_ACL_BOUNDARY);
    assert.equal(windowsBoundary.acl.status, "deferred_unverified", "tests must not claim native Windows ACL evidence");
    assert.equal(windowsBoundary.directoryMode, null);
    assert.equal(windowsBoundary.fileMode, null);

    console.log("Private SQLite guarded storage policy tests passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
