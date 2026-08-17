const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");

const OWNER_ONLY_FILE_MODE = 0o600;
const DEGRADED_READONLY_CODE = "ERR_ZHIXIA_DATABASE_DEGRADED_READONLY";
const DURABLE_SAVE_FAILED_CODE = "ERR_ZHIXIA_DATABASE_DURABLE_SAVE_FAILED";
const DATABASE_CLOSED_CODE = "ERR_ZHIXIA_DATABASE_CLOSED";

function durableStoreError(code, message, cause = null, details = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function bytesSha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function detachedDatabaseBytes(bytes) {
  return Uint8Array.from(bytes);
}

function callableAliasNames(value, canonicalNames) {
  const functions = new Set(
    canonicalNames.map((name) => value[name]).filter((method) => typeof method === "function"),
  );
  const names = new Set();
  let prototype = Object.getPrototypeOf(value);
  while (prototype && prototype !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (name !== "constructor" && functions.has(descriptor?.value)) names.add(name);
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return [...names];
}

function callablePrototypeNames(value) {
  const names = new Set();
  let prototype = Object.getPrototypeOf(value);
  while (prototype && prototype !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (name !== "constructor" && typeof descriptor?.value === "function") names.add(name);
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return [...names];
}

async function closeQuietly(handle) {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // The original durability failure remains authoritative.
  }
}

async function unlinkQuietly(fsOps, filePath) {
  try {
    await fsOps.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function fileExists(fsOps, filePath) {
  try {
    await fsOps.stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readTargetState(fsOps, filePath, candidateHash, previousHash, targetExisted) {
  try {
    const bytes = Buffer.from(await fsOps.readFile(filePath));
    const hash = bytesSha256(bytes);
    if (hash === candidateHash) return { state: "candidate", hash, bytes: bytes.length };
    if (previousHash && hash === previousHash) return { state: "previous", hash, bytes: bytes.length };
    return { state: "unknown", hash, bytes: bytes.length };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: targetExisted ? "missing" : "previous_absent", hash: null, bytes: 0 };
    throw error;
  }
}

function createSqlJsDurableStore(options = {}) {
  const {
    Runtime,
    filePath,
    getDatabase,
    setDatabase,
    fsOps = fs,
    ownerOnlyMode = OWNER_ONLY_FILE_MODE,
    beforeStage = async () => {},
    idFactory = () => `${process.pid}.${Date.now()}.${crypto.randomUUID()}`,
  } = options;

  if (!Runtime || typeof Runtime.Database !== "function") throw new Error("Runtime.Database is required");
  if (!filePath || typeof filePath !== "string") throw new Error("filePath is required");
  if (typeof getDatabase !== "function" || typeof setDatabase !== "function") {
    throw new Error("getDatabase and setDatabase are required");
  }

  const initialDatabase = getDatabase();
  let durableSnapshot = Buffer.from(initialDatabase.export());
  let durableSnapshotHash = bytesSha256(durableSnapshot);
  let state = "writable";
  let failure = null;
  let activeSave = null;
  const authority = { generation: 1 };
  const rawRunByDatabase = new WeakMap();
  const rawDatabaseByFacade = new WeakMap();
  const statementFacadeByRaw = new WeakMap();

  function readonlyError() {
    return durableStoreError(
      DEGRADED_READONLY_CODE,
      "Zhixia knowledge database is degraded readonly after a durability failure; restart after checking local storage.",
      failure,
      { degradedReadonly: true },
    );
  }

  function assertWritable() {
    if (state === "closed") {
      throw durableStoreError(
        DATABASE_CLOSED_CODE,
        "Zhixia refused an operation after the managed sql.js database was closed.",
        null,
        { closed: true },
      );
    }
    if (state === "degraded_readonly") throw readonlyError();
    if (state === "persisting") {
      throw durableStoreError(
        "ERR_ZHIXIA_DATABASE_SAVE_IN_PROGRESS",
        "Zhixia refused an overlapping sql.js mutation while a durable save is in progress.",
      );
    }
  }

  function generationError() {
    return durableStoreError(
      DEGRADED_READONLY_CODE,
      "Zhixia fenced a stale sql.js database capability in readonly mode after durability recovery.",
      failure,
      { degradedReadonly: true, staleGeneration: true },
    );
  }

  function assertGeneration(generation) {
    if (generation !== authority.generation) throw generationError();
  }

  function managedFacade(privateFields, generation) {
    const facade = Object.create(null);
    for (const field of privateFields) {
      Object.defineProperty(facade, field, {
        configurable: false,
        enumerable: false,
        get() {
          assertGeneration(generation);
          assertWritable();
          throw durableStoreError(
            "ERR_ZHIXIA_DATABASE_CAPABILITY_PRIVATE",
            "Zhixia refused access to a private sql.js capability field.",
          );
        },
      });
    }
    return facade;
  }

  function guardStatement(statement, generation) {
    if (!statement) return statement;
    const existing = statementFacadeByRaw.get(statement);
    if (existing) return existing;
    const cleanupFunctions = new Set(
      [statement.free, statement.freemem].filter((method) => typeof method === "function"),
    );
    const facade = managedFacade(["Qa", "db", "Oa", "mb"], generation);
    const wrappers = new Map();
    for (const method of callablePrototypeNames(statement)) {
      const originalFunction = statement[method];
      let wrapper = wrappers.get(originalFunction);
      if (!wrapper) {
        const original = originalFunction.bind(statement);
        wrapper = cleanupFunctions.has(originalFunction)
          ? (...args) => original(...args)
          : (...args) => {
            assertGeneration(generation);
            assertWritable();
            const result = original(...args);
            return result === statement ? facade : result;
          };
        wrappers.set(originalFunction, wrapper);
      }
      Object.defineProperty(facade, method, { value: wrapper, enumerable: true });
    }
    statementFacadeByRaw.set(statement, facade);
    return facade;
  }

  function guardDatabase(database, generation = authority.generation) {
    if (!database) return database;
    const runFunction = database.run;
    const execFunction = database.exec;
    const prepareFunction = database.prepare;
    const iterateStatementsFunction = database.iterateStatements;
    const rawRun = runFunction.bind(database);
    const guardedMethods = callableAliasNames(
      database,
      ["run", "exec", "each", "prepare", "iterateStatements", "export", "getRowsModified", "create_function", "create_aggregate", "updateHook"],
    );
    const facade = managedFacade(["filename", "db", "gb", "Sa"], generation);
    const wrappers = new Map();
    for (const method of guardedMethods) {
      const originalFunction = database[method];
      let wrapper = wrappers.get(originalFunction);
      if (!wrapper) {
        const original = originalFunction.bind(database);
        if (originalFunction === execFunction) {
          wrapper = (...args) => {
            assertGeneration(generation);
            if (state === "persisting") assertWritable();
            return original(...args);
          };
        } else if (originalFunction === prepareFunction) {
          wrapper = (...args) => {
            assertGeneration(generation);
            assertWritable();
            return guardStatement(original(...args), generation);
          };
        } else if (originalFunction === iterateStatementsFunction) {
          wrapper = (...args) => {
            assertGeneration(generation);
            assertWritable();
            const iterator = original(...args);
            const iteratorFacade = Object.create(null);
            const iteratorWrappers = new Map();
            for (const iteratorMethod of callablePrototypeNames(iterator)) {
              const iteratorFunction = iterator[iteratorMethod];
              let iteratorWrapper = iteratorWrappers.get(iteratorFunction);
              if (!iteratorWrapper) {
                const invoke = iteratorFunction.bind(iterator);
                iteratorWrapper = (...iteratorArgs) => {
                  assertGeneration(generation);
                  assertWritable();
                  const result = invoke(...iteratorArgs);
                  if (iteratorFunction === iterator.next) {
                    return result?.done === true ? result : { ...result, value: guardStatement(result.value, generation) };
                  }
                  return result === iterator ? iteratorFacade : result;
                };
                iteratorWrappers.set(iteratorFunction, iteratorWrapper);
              }
              Object.defineProperty(iteratorFacade, iteratorMethod, {
                value: iteratorWrapper,
                enumerable: true,
              });
            }
            Object.defineProperty(iteratorFacade, Symbol.iterator, {
              value() { return this; },
            });
            return Object.freeze(iteratorFacade);
          };
        } else {
          wrapper = (...args) => {
            assertGeneration(generation);
            assertWritable();
            const result = original(...args);
            return result === database ? facade : result;
          };
        }
        wrappers.set(originalFunction, wrapper);
      }
      Object.defineProperty(facade, method, { value: wrapper, enumerable: true, writable: true, configurable: true });
    }
    const close = database.close.bind(database);
    Object.defineProperty(facade, "close", {
      value: (...args) => {
        if (generation !== authority.generation || state === "degraded_readonly") return close(...args);
        assertWritable();
        state = "closed";
        return close(...args);
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    rawRunByDatabase.set(facade, rawRun);
    rawDatabaseByFacade.set(facade, database);
    return facade;
  }

  function installGuard(rawDatabase = getDatabase(), generation = authority.generation) {
    const facade = guardDatabase(rawDatabase, generation);
    setDatabase(facade);
    return facade;
  }

  async function syncParentDirectory(stagePrefix = "") {
    let directory = null;
    try {
      await beforeStage(`${stagePrefix}parent_dir_open`);
      directory = await fsOps.open(path.dirname(filePath), "r");
      await beforeStage(`${stagePrefix}parent_dir_fsync`);
      await directory.sync();
    } finally {
      await closeQuietly(directory);
    }
  }

  async function writeOwnerOnlyReplacement(bytes, target, stagePrefix = "") {
    const tempPath = `${target}.${idFactory()}.tmp`;
    let temp = null;
    try {
      await beforeStage(`${stagePrefix}temp_open`);
      temp = await fsOps.open(tempPath, "wx", ownerOnlyMode);
      await beforeStage(`${stagePrefix}temp_write`);
      await temp.writeFile(bytes);
      await beforeStage(`${stagePrefix}temp_chmod`);
      await temp.chmod(ownerOnlyMode);
      await beforeStage(`${stagePrefix}file_fsync`);
      await temp.sync();
      await closeQuietly(temp);
      temp = null;
      await beforeStage(`${stagePrefix}rename`);
      await fsOps.rename(tempPath, target);
      return { tempPath, renamed: true };
    } catch (error) {
      await closeQuietly(temp);
      try {
        await unlinkQuietly(fsOps, tempPath);
      } catch {
        // Cleanup failure is reported through the durable save failure.
      }
      throw Object.assign(error, { zhixiaTempPath: tempPath });
    }
  }

  async function restorePreviousFile(targetExisted) {
    if (!targetExisted) {
      try {
        await beforeStage("rollback_unlink");
        await unlinkQuietly(fsOps, filePath);
      } catch (error) {
        const stateAfterUnlinkError = await readTargetState(fsOps, filePath, "", durableSnapshotHash, false);
        if (stateAfterUnlinkError.state !== "previous_absent") throw error;
      }
      await syncParentDirectory("rollback_");
      const verified = await readTargetState(fsOps, filePath, "", durableSnapshotHash, false);
      if (verified.state !== "previous_absent") throw durableStoreError(
        "ERR_ZHIXIA_DATABASE_ROLLBACK_VERIFY_FAILED",
        "Zhixia could not verify removal of the failed first-save candidate.",
        null,
        { targetState: verified.state, targetHash: verified.hash },
      );
      return { verified: true, state: verified.state };
    }
    try {
      await writeOwnerOnlyReplacement(durableSnapshot, filePath, "rollback_");
    } catch (error) {
      const stateAfterRenameError = await readTargetState(fsOps, filePath, "", durableSnapshotHash, true);
      if (stateAfterRenameError.state !== "previous") throw error;
    }
    await syncParentDirectory("rollback_");
    const verified = await readTargetState(fsOps, filePath, "", durableSnapshotHash, true);
    if (verified.state !== "previous") throw durableStoreError(
      "ERR_ZHIXIA_DATABASE_ROLLBACK_VERIFY_FAILED",
      "Zhixia could not verify the restored durable sql.js snapshot.",
      null,
      { targetState: verified.state, targetHash: verified.hash, expectedHash: durableSnapshotHash },
    );
    return { verified: true, state: verified.state };
  }

  function restoreMemorySnapshot() {
    const previous = getDatabase();
    authority.generation += 1;
    const restoredGeneration = authority.generation;
    const rawRun = previous ? rawRunByDatabase.get(previous) : null;
    const previousRaw = previous ? rawDatabaseByFacade.get(previous) : null;
    if (typeof rawRun === "function") {
      try {
        rawRun("PRAGMA query_only = ON");
      } catch (error) {
        if (typeof previousRaw?.close === "function") previousRaw.close();
        throw error;
      }
    } else if (typeof previousRaw?.close === "function") {
      previousRaw.close();
    }
    const restored = new Runtime.Database(detachedDatabaseBytes(durableSnapshot));
    restored.run("PRAGMA query_only = ON");
    installGuard(restored, restoredGeneration);
    if (previousRaw && previousRaw !== restored && typeof previousRaw.close === "function") previousRaw.close();
  }

  function enterDegradedReadonly(error, diskRollbackError = null, details = {}) {
    state = "degraded_readonly";
    let memoryRecoveryError = null;
    try {
      restoreMemorySnapshot();
    } catch (caught) {
      memoryRecoveryError = caught;
    }
    failure = error;
    return durableStoreError(
      DURABLE_SAVE_FAILED_CODE,
      `Zhixia durable sql.js save failed and the database is now read-only: ${error?.message || error}`,
      error,
      {
        degradedReadonly: true,
        diskRollbackFailed: Boolean(diskRollbackError),
        diskRollbackVerified: details.diskRollbackVerified === true,
        targetState: details.targetState || null,
        rollbackError: diskRollbackError,
        memoryRecoveryFailed: Boolean(memoryRecoveryError),
        memoryRecoveryError,
      },
    );
  }

  async function persistCandidate(candidate) {
    let targetExisted = false;
    let targetChecked = false;
    let renamed = false;
    const candidateHash = bytesSha256(candidate);
    let targetState = null;
    try {
      await beforeStage("target_stat");
      targetExisted = await fileExists(fsOps, filePath);
      targetChecked = true;
      let replacement;
      try {
        replacement = await writeOwnerOnlyReplacement(candidate, filePath);
        renamed = replacement.renamed;
      } catch (error) {
        targetState = await readTargetState(fsOps, filePath, candidateHash, durableSnapshotHash, targetExisted);
        if (targetState.state !== "candidate") throw Object.assign(error, { zhixiaTargetState: targetState });
        await syncParentDirectory("confirm_");
        durableSnapshot = Buffer.from(candidate);
        durableSnapshotHash = candidateHash;
        state = "writable";
        return {
          durable: true,
          bytes: candidate.length,
          ownerOnlyMode,
          sha256: candidateHash,
          renameOutcome: "candidate_confirmed_after_ambiguous_error",
        };
      }
      await syncParentDirectory();
      durableSnapshot = Buffer.from(candidate);
      durableSnapshotHash = candidateHash;
      state = "writable";
      return {
        durable: true,
        bytes: candidate.length,
        ownerOnlyMode,
        sha256: candidateHash,
        renameOutcome: "rename_confirmed",
      };
    } catch (error) {
      let rollbackError = null;
      let diskRollbackVerified = false;
      if (!targetState) {
        try {
          targetState = await readTargetState(fsOps, filePath, candidateHash, durableSnapshotHash, targetExisted);
        } catch (caught) {
          rollbackError = caught;
        }
      }
      const replacementMayBeVisible = targetChecked && (renamed || ["candidate", "unknown", "missing"].includes(targetState?.state));
      if (replacementMayBeVisible && !rollbackError) {
        try {
          const rollback = await restorePreviousFile(targetExisted);
          diskRollbackVerified = rollback.verified === true;
        } catch (caught) {
          rollbackError = caught;
        }
      } else if (targetState?.state === "previous" || targetState?.state === "previous_absent") {
        diskRollbackVerified = true;
      }
      throw enterDegradedReadonly(error, rollbackError, { diskRollbackVerified, targetState: targetState?.state || null });
    }
  }

  function persist() {
    if (state === "degraded_readonly") return Promise.reject(readonlyError());
    if (state === "closed") {
      try {
        assertWritable();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    if (activeSave) return activeSave;

    let candidate;
    try {
      candidate = Buffer.from(getDatabase().export());
    } catch (error) {
      return Promise.reject(enterDegradedReadonly(error));
    }
    state = "persisting";
    activeSave = persistCandidate(candidate).finally(() => {
      activeSave = null;
    });
    return activeSave;
  }

  const managedDatabase = new Runtime.Database(detachedDatabaseBytes(durableSnapshot));
  initialDatabase.close();
  installGuard(managedDatabase);

  return Object.freeze({
    persist,
    assertWritable,
    getStatus: () => ({
      state,
      degradedReadonly: state === "degraded_readonly",
      failureCode: failure?.code || null,
      failureMessage: failure ? String(failure.message || failure) : null,
    }),
  });
}

module.exports = {
  DATABASE_CLOSED_CODE,
  DEGRADED_READONLY_CODE,
  DURABLE_SAVE_FAILED_CODE,
  OWNER_ONLY_FILE_MODE,
  createSqlJsDurableStore,
};
