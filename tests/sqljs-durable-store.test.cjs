const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const initSqlJs = require("sql.js");

const {
  DATABASE_CLOSED_CODE,
  DEGRADED_READONLY_CODE,
  DURABLE_SAVE_FAILED_CODE,
  createSqlJsDurableStore,
} = require("../electron/sqlJsDurableStore.cjs");

function scalar(database, sql) {
  return database.exec(sql)[0]?.values?.[0]?.[0];
}

function prototypeAliases(value, canonicalName) {
  const canonical = value[canonicalName];
  return Object.keys(value).filter(
    (name) => name !== canonicalName && typeof value[name] === "function" && value[name] === canonical,
  );
}

function statementCallableNames(statement) {
  return Object.keys(statement).filter(
    (name) => name !== "constructor" && typeof statement[name] === "function" && ![statement.free, statement.freemem].includes(statement[name]),
  );
}

async function readRows(Runtime, filePath) {
  const bytes = await fs.readFile(filePath);
  const database = new Runtime.Database(bytes);
  try {
    return database.exec("SELECT value FROM durable_items ORDER BY value")[0]?.values?.map((row) => row[0]) || [];
  } finally {
    database.close();
  }
}

async function legacySave(fsOps, database, filePath) {
  const tempPath = `${filePath}.legacy.tmp`;
  await fsOps.writeFile(tempPath, Buffer.from(database.export()), { mode: 0o600 });
  await fsOps.rename(tempPath, filePath);
}

async function assertOwnerOnlyMode(filePath, message) {
  if (process.platform === "win32") return;
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600, message);
}

function injectedFailure(stageToFail) {
  let failed = false;
  return async (stage) => {
    if (!failed && stage === stageToFail) {
      failed = true;
      const error = new Error(`injected:${stage}`);
      error.code = "EIO";
      throw error;
    }
  };
}

(async () => {
  const Runtime = await initSqlJs();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixia-durable-store-"));

  try {
    const rawDatabasePrototype = Runtime.Database.prototype;
    const prototypeProbeDatabase = new Runtime.Database();
    const prototypeProbeStatement = prototypeProbeDatabase.prepare("SELECT 1");
    const rawStatementPrototype = Object.getPrototypeOf(prototypeProbeStatement);
    prototypeProbeStatement.free();
    prototypeProbeDatabase.close();

    const mainSource = await fs.readFile(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
    assert.match(mainSource, /createSqlJsDurableStore\(\{[\s\S]*?filePath: file,[\s\S]*?getDatabase: \(\) => db/);
    assert.match(mainSource, /async function saveDatabase\(\) \{[\s\S]*?return dbDurableStore\.persist\(\);[\s\S]*?\}/);
    assert.doesNotMatch(mainSource, /async function writeDatabaseFile|dbSaveQueue/, "no legacy sql.js disk-save bypass may remain");

    // Old-red: a failed naive save leaves the sql.js mutation live, so a later save persists it.
    const legacyPath = path.join(root, "legacy.sqlite");
    const legacy = new Runtime.Database();
    legacy.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    await legacySave(fs, legacy, legacyPath);
    legacy.run("INSERT INTO durable_items VALUES ('failed-mutation')");
    await assert.rejects(
      () => legacySave({ ...fs, rename: async () => { throw new Error("injected:rename"); } }, legacy, legacyPath),
      /injected:rename/,
    );
    await legacySave(fs, legacy, legacyPath);
    assert.deepEqual(await readRows(Runtime, legacyPath), ["failed-mutation"], "legacy save leaks a failed mutation into a later save");
    legacy.close();

    const failureStages = [
      "target_stat",
      "temp_open",
      "temp_write",
      "temp_chmod",
      "file_fsync",
      "rename",
      "parent_dir_open",
      "parent_dir_fsync",
    ];

    for (const stage of failureStages) {
      const caseRoot = path.join(root, stage);
      const filePath = path.join(caseRoot, "knowledge-store.sqlite");
      await fs.mkdir(caseRoot, { recursive: true, mode: 0o700 });
      let database = new Runtime.Database();
      database.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
      database.run("INSERT INTO durable_items VALUES ('baseline')");
      await legacySave(fs, database, filePath);

      const store = createSqlJsDurableStore({
        Runtime,
        filePath,
        getDatabase: () => database,
        setDatabase: (next) => { database = next; },
        beforeStage: injectedFailure(stage),
        idFactory: () => `${stage}-candidate`,
      });

      database.run("INSERT INTO durable_items VALUES ('failed-mutation')");
      await assert.rejects(
        () => store.persist(),
        (error) => error.code === DURABLE_SAVE_FAILED_CODE && error.degradedReadonly === true,
        `${stage} must fail closed and degrade the store`,
      );
      assert.equal(store.getStatus().degradedReadonly, true);
      assert.equal(scalar(database, "SELECT COUNT(*) FROM durable_items"), 1, `${stage} must restore the in-memory snapshot`);
      assert.deepEqual(await readRows(Runtime, filePath), ["baseline"], `${stage} must preserve the durable pre-mutation state`);
      await assertOwnerOnlyMode(filePath, `${stage} rollback must preserve owner-only mode`);
      assert.deepEqual(
        (await fs.readdir(caseRoot)).filter((name) => name.endsWith(".tmp")),
        [],
        `${stage} must not leave temporary database files`,
      );

      assert.throws(
        () => database.run("INSERT INTO durable_items VALUES ('later-mutation')"),
        (error) => error.code === DEGRADED_READONLY_CODE,
        `${stage} degraded mode must reject later writes before touching memory`,
      );
      assert.throws(
        () => database.exec("INSERT INTO durable_items VALUES ('exec-bypass')"),
        /readonly/i,
        `${stage} SQLite query_only must reject exec mutation bypasses`,
      );
      assert.throws(
        () => database.prepare("INSERT INTO durable_items VALUES ('prepared-bypass')"),
        (error) => error.code === DEGRADED_READONLY_CODE,
        `${stage} degraded state must reject new prepared-statement capabilities`,
      );
      await assert.rejects(
        () => store.persist(),
        (error) => error.code === DEGRADED_READONLY_CODE,
        `${stage} degraded mode must reject later saves`,
      );
      assert.deepEqual(await readRows(Runtime, filePath), ["baseline"], `${stage} later saves must not leak the failed mutation`);
      database.close();
    }

    const successRoot = path.join(root, "success");
    const successPath = path.join(successRoot, "knowledge-store.sqlite");
    await fs.mkdir(successRoot, { recursive: true, mode: 0o700 });
    let successDb = new Runtime.Database();
    successDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    const successStore = createSqlJsDurableStore({
      Runtime,
      filePath: successPath,
      getDatabase: () => successDb,
      setDatabase: (next) => { successDb = next; },
      idFactory: () => "success-candidate",
    });
    successDb.run("INSERT INTO durable_items VALUES ('committed')");
    const receipt = await successStore.persist();
    assert.equal(receipt.durable, true);
    await assertOwnerOnlyMode(successPath, "database replacement must be owner-only");
    assert.deepEqual(await readRows(Runtime, successPath), ["committed"]);
    successDb.close();

    const overlapRoot = path.join(root, "overlapping-exec");
    const overlapPath = path.join(overlapRoot, "knowledge-store.sqlite");
    await fs.mkdir(overlapRoot, { recursive: true, mode: 0o700 });
    let overlapDb = new Runtime.Database();
    overlapDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    overlapDb.run("INSERT INTO durable_items VALUES ('baseline')");
    await legacySave(fs, overlapDb, overlapPath);
    const preparedBeforeStoreOverlap = overlapDb.prepare("INSERT INTO durable_items VALUES ('pre-store-smuggle')");
    let releaseSave;
    const savePaused = new Promise((resolve) => { releaseSave = resolve; });
    let enteredSave;
    const saveEntered = new Promise((resolve) => { enteredSave = resolve; });
    const overlapStore = createSqlJsDurableStore({
      Runtime,
      filePath: overlapPath,
      getDatabase: () => overlapDb,
      setDatabase: (next) => { overlapDb = next; },
      beforeStage: async (stage) => {
        if (stage === "temp_write") {
          enteredSave();
          await savePaused;
        }
      },
    });
    const databaseAliases = Object.fromEntries(
      ["each", "prepare", "iterateStatements", "export"].map((method) => [method, prototypeAliases(overlapDb, method)]),
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(databaseAliases).map(([method, aliases]) => [method, aliases.length > 0])),
      { each: true, prepare: true, iterateStatements: true, export: true },
      "the locked sql.js runtime must exercise its minified public Database aliases",
    );
    assert.throws(
      () => preparedBeforeStoreOverlap.step(),
      /statement closed/i,
      "the initial durable snapshot must invalidate statements acquired before store ownership begins",
    );
    overlapDb.run("INSERT INTO durable_items VALUES ('candidate')");
    const chainedDatabaseFacades = [
      overlapDb.run("SELECT 1"),
      overlapDb.create_function("zhixia_chain_probe", (value) => value),
      overlapDb.create_aggregate("zhixia_chain_aggregate_probe", {
        init: () => 0,
        step: (state) => state + 1,
        finalize: (state) => state,
      }),
      overlapDb.updateHook(() => {}),
    ];
    for (const chainedFacade of chainedDatabaseFacades) {
      assert.equal(chainedFacade, overlapDb, "chainable Database methods must return the managed facade");
      assert.equal(Object.getPrototypeOf(chainedFacade), null, "chainable Database methods must not expose the raw sql.js Database");
    }
    const heldYieldIterator = overlapDb.iterateStatements("INSERT INTO durable_items VALUES ('yielded-smuggle')");
    const iteratorAliases = prototypeAliases(heldYieldIterator, "getRemainingSQL");
    assert.ok(iteratorAliases.length > 0, "the locked sql.js iterator must expose its getRemainingSQL alias");
    assert.equal(typeof heldYieldIterator.getRemainingSQL, "function", "managed iterator must preserve getRemainingSQL");
    for (const alias of iteratorAliases) assert.equal(typeof heldYieldIterator[alias], "function", `managed iterator must preserve ${alias}`);
    const heldYieldStatement = heldYieldIterator.next().value;
    const heldStatementOperations = statementCallableNames(heldYieldStatement).map((method) => [
      `held statement ${method}`,
      () => heldYieldStatement[method](),
    ]);
    const rawStatementPrototypeOperations = Object.getOwnPropertyNames(rawStatementPrototype)
      .filter((method) => method !== "constructor" && typeof rawStatementPrototype[method] === "function"
        && ![rawStatementPrototype.free, rawStatementPrototype.freemem].includes(rawStatementPrototype[method]))
      .map((method) => [`raw Statement.prototype.${method}.call`, () => rawStatementPrototype[method].call(heldYieldStatement)]);
    const heldAcquisitionIterator = overlapDb.iterateStatements("INSERT INTO durable_items VALUES ('acquisition-smuggle')");
    const heldAliasIterator = overlapDb[databaseAliases.iterateStatements[0]]("INSERT INTO durable_items VALUES ('alias-held-smuggle')");
    const overlappingSave = overlapStore.persist();
    await saveEntered;
    assert.throws(
      () => overlapDb.close(),
      (error) => error.code === "ERR_ZHIXIA_DATABASE_SAVE_IN_PROGRESS",
      "the current managed Database cannot close during durable persistence",
    );
    assert.throws(
      () => overlapDb.exec("INSERT INTO durable_items VALUES ('must-not-smuggle')"),
      (error) => error.code === "ERR_ZHIXIA_DATABASE_SAVE_IN_PROGRESS",
      "exec mutation must not overlap a durable save and leak into a later save",
    );
    assert.throws(
      () => overlapDb.iterateStatements("INSERT INTO durable_items VALUES ('iterator-smuggle')"),
      (error) => error.code === "ERR_ZHIXIA_DATABASE_SAVE_IN_PROGRESS",
      "statement iterators must not be created during a durable save",
    );
    for (const [label, operation] of [
      ["database prepare", () => overlapDb.prepare("INSERT INTO durable_items VALUES ('prepare-smuggle')")],
      ["held iterator acquisition", () => heldAcquisitionIterator.next()],
      ["held iterator remaining SQL", () => heldYieldIterator.getRemainingSQL()],
      ["held iterator remaining SQL alias", () => heldYieldIterator[iteratorAliases[0]]()],
      ["held yielded statement step", () => heldYieldStatement.step()],
      ["held yielded statement run", () => heldYieldStatement.run()],
      ["database each", () => overlapDb.each("INSERT INTO durable_items VALUES ('each-smuggle')", () => {})],
      ["database export", () => overlapDb.export()],
      ["alias prepare", () => overlapDb[databaseAliases.prepare[0]]("INSERT INTO durable_items VALUES ('alias-prepare-smuggle')")],
      ["alias iterator acquisition", () => heldAliasIterator.next()],
      ["alias iterator creation", () => overlapDb[databaseAliases.iterateStatements[0]]("INSERT INTO durable_items VALUES ('alias-iterator-smuggle')")],
      ["alias each", () => overlapDb[databaseAliases.each[0]]("INSERT INTO durable_items VALUES ('alias-each-smuggle')", () => {})],
      ["alias export", () => overlapDb[databaseAliases.export[0]]()],
      ...heldStatementOperations,
      ...chainedDatabaseFacades.map((chainedFacade, index) => [
        `chained database facade ${index}`,
        () => chainedFacade.run(`INSERT INTO durable_items VALUES ('chained-${index}')`),
      ]),
    ]) {
      assert.throws(
        operation,
        (error) => error.code === "ERR_ZHIXIA_DATABASE_SAVE_IN_PROGRESS",
        `${label} must be fenced while durable persistence is in progress`,
      );
    }
    for (const [label, operation] of rawStatementPrototypeOperations) {
      assert.throws(operation, undefined, `${label} must not accept the managed facade`);
    }
    for (const method of ["run", "exec", "each", "prepare", "iterateStatements", "export", "getRowsModified", "create_function", "create_aggregate", "updateHook"]) {
      assert.throws(
        () => {
          const result = rawDatabasePrototype[method].call(overlapDb, "INSERT INTO durable_items VALUES ('raw-prototype-smuggle')");
          if (method === "iterateStatements") result.next();
        },
        undefined,
        `raw Database.prototype.${method}.call must not accept the managed facade`,
      );
    }
    releaseSave();
    await overlappingSave;
    await overlapStore.persist();
    assert.deepEqual(await readRows(Runtime, overlapPath), ["baseline", "candidate"]);
    heldYieldStatement.free();
    overlapDb.close();
    assert.equal(overlapStore.getStatus().state, "closed");
    await assert.rejects(() => overlapStore.persist(), (error) => error.code === DATABASE_CLOSED_CODE);

    const iteratorFenceRoot = path.join(root, "held-statement-iterator");
    const iteratorFencePath = path.join(iteratorFenceRoot, "knowledge-store.sqlite");
    await fs.mkdir(iteratorFenceRoot, { recursive: true, mode: 0o700 });
    let iteratorFenceDb = new Runtime.Database();
    iteratorFenceDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    iteratorFenceDb.run("INSERT INTO durable_items VALUES ('baseline')");
    await legacySave(fs, iteratorFenceDb, iteratorFencePath);
    const iteratorFenceStore = createSqlJsDurableStore({
      Runtime,
      filePath: iteratorFencePath,
      getDatabase: () => iteratorFenceDb,
      setDatabase: (next) => { iteratorFenceDb = next; },
      beforeStage: injectedFailure("rename"),
    });
    const heldIterator = iteratorFenceDb.iterateStatements("INSERT INTO durable_items VALUES ('iterator-stale')");
    const heldStatementIterator = iteratorFenceDb.iterateStatements("INSERT INTO durable_items VALUES ('statement-stale')");
    const heldIteratorStatement = heldStatementIterator.next().value;
    const staleStatementOperations = statementCallableNames(heldIteratorStatement).map((method) => [
      `stale statement ${method}`,
      () => heldIteratorStatement[method](),
    ]);
    const heldIteratorDatabase = iteratorFenceDb;
    const staleDatabaseAliases = Object.fromEntries(
      ["each", "prepare", "iterateStatements", "export"].map((method) => [method, prototypeAliases(iteratorFenceDb, method)[0]]),
    );
    const heldAliasStaleIterator = iteratorFenceDb[staleDatabaseAliases.iterateStatements]("SELECT 1");
    iteratorFenceDb.run("INSERT INTO durable_items VALUES ('failed-mutation')");
    await assert.rejects(() => iteratorFenceStore.persist(), (error) => error.code === DURABLE_SAVE_FAILED_CODE);
    assert.throws(
      () => heldIterator.next(),
      (error) => error.code === DEGRADED_READONLY_CODE && error.staleGeneration === true,
      "iterators held across recovery must be fenced by generation authority",
    );
    for (const [label, operation] of [
      ["stale iterator statement step", () => heldIteratorStatement.step()],
      ["stale database export", () => heldIteratorDatabase.export()],
      ["stale database each", () => heldIteratorDatabase.each("SELECT 1", () => {})],
      ["stale alias prepare", () => heldIteratorDatabase[staleDatabaseAliases.prepare]("SELECT 1")],
      ["stale alias iterator", () => heldAliasStaleIterator.next()],
      ["stale alias each", () => heldIteratorDatabase[staleDatabaseAliases.each]("SELECT 1", () => {})],
      ["stale alias export", () => heldIteratorDatabase[staleDatabaseAliases.export]()],
      ...staleStatementOperations,
    ]) {
      assert.throws(
        operation,
        (error) => error.code === DEGRADED_READONLY_CODE && error.staleGeneration === true,
        `${label} must be fenced after recovery advances the database generation`,
      );
    }
    assert.deepEqual(await readRows(Runtime, iteratorFencePath), ["baseline"]);
    iteratorFenceDb.close();

    const exportRoot = path.join(root, "export-failure");
    const exportPath = path.join(exportRoot, "knowledge-store.sqlite");
    await fs.mkdir(exportRoot, { recursive: true, mode: 0o700 });
    let exportDb = new Runtime.Database();
    exportDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    exportDb.run("INSERT INTO durable_items VALUES ('baseline')");
    await legacySave(fs, exportDb, exportPath);
    const exportStore = createSqlJsDurableStore({
      Runtime,
      filePath: exportPath,
      getDatabase: () => exportDb,
      setDatabase: (next) => { exportDb = next; },
    });
    exportDb.run("INSERT INTO durable_items VALUES ('failed-export')");
    exportDb.export = () => { throw new Error("injected:export"); };
    await assert.rejects(
      () => exportStore.persist(),
      (error) => error.code === DURABLE_SAVE_FAILED_CODE && error.degradedReadonly === true,
      "db.export failure must restore the previous snapshot and degrade read-only",
    );
    assert.deepEqual(await readRows(Runtime, exportPath), ["baseline"]);
    assert.equal(scalar(exportDb, "SELECT COUNT(*) FROM durable_items"), 1);
    assert.throws(() => exportDb.run("INSERT INTO durable_items VALUES ('later')"), (error) => error.code === DEGRADED_READONLY_CODE);
    exportDb.close();

    const firstSaveRoot = path.join(root, "first-save-dir-fsync-failure");
    const firstSavePath = path.join(firstSaveRoot, "knowledge-store.sqlite");
    await fs.mkdir(firstSaveRoot, { recursive: true, mode: 0o700 });
    let firstSaveDb = new Runtime.Database();
    firstSaveDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    const firstSaveStore = createSqlJsDurableStore({
      Runtime,
      filePath: firstSavePath,
      getDatabase: () => firstSaveDb,
      setDatabase: (next) => { firstSaveDb = next; },
      beforeStage: injectedFailure("parent_dir_fsync"),
      idFactory: () => "first-save-candidate",
    });
    firstSaveDb.run("INSERT INTO durable_items VALUES ('failed-first-save')");
    await assert.rejects(
      () => firstSaveStore.persist(),
      (error) => error.code === DURABLE_SAVE_FAILED_CODE && error.degradedReadonly === true,
      "first save directory fsync failure must fail closed",
    );
    await assert.rejects(() => fs.stat(firstSavePath), (error) => error.code === "ENOENT", "failed first save must remove the uncommitted target");
    assert.equal(scalar(firstSaveDb, "SELECT COUNT(*) FROM durable_items"), 0, "failed first save must restore the initial empty snapshot");
    firstSaveDb.close();

    const ambiguousRoot = path.join(root, "rename-after-replace");
    const ambiguousPath = path.join(ambiguousRoot, "knowledge-store.sqlite");
    await fs.mkdir(ambiguousRoot, { recursive: true, mode: 0o700 });
    let ambiguousDb = new Runtime.Database();
    ambiguousDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    ambiguousDb.run("INSERT INTO durable_items VALUES ('baseline')");
    await legacySave(fs, ambiguousDb, ambiguousPath);
    let ambiguousRenameThrows = true;
    const ambiguousFs = {
      ...fs,
      rename: async (source, target) => {
        await fs.rename(source, target);
        if (ambiguousRenameThrows) {
          ambiguousRenameThrows = false;
          const error = new Error("injected:rename-after-replace");
          error.code = "EIO";
          throw error;
        }
      },
    };
    const ambiguousStore = createSqlJsDurableStore({
      Runtime,
      filePath: ambiguousPath,
      getDatabase: () => ambiguousDb,
      setDatabase: (next) => { ambiguousDb = next; },
      fsOps: ambiguousFs,
      idFactory: () => "ambiguous-candidate",
    });
    ambiguousDb.run("INSERT INTO durable_items VALUES ('candidate')");
    const ambiguousReceipt = await ambiguousStore.persist();
    assert.equal(ambiguousReceipt.durable, true, "post-replace rename wrapper failure must be disambiguated as a durable candidate");
    assert.equal(ambiguousReceipt.renameOutcome, "candidate_confirmed_after_ambiguous_error");
    assert.deepEqual(await readRows(Runtime, ambiguousPath), ["baseline", "candidate"]);
    ambiguousDb.run("INSERT INTO durable_items VALUES ('later-save')");
    await ambiguousStore.persist();
    assert.deepEqual(await readRows(Runtime, ambiguousPath), ["baseline", "candidate", "later-save"], "later save must start from the confirmed candidate");
    const ambiguousRestart = new Runtime.Database(await fs.readFile(ambiguousPath));
    assert.equal(scalar(ambiguousRestart, "SELECT COUNT(*) FROM durable_items"), 3, "restart must read the exact confirmed candidate lineage");
    ambiguousRestart.close();
    ambiguousDb.close();

    const rollbackRoot = path.join(root, "rename-after-replace-confirm-failure");
    const rollbackPath = path.join(rollbackRoot, "knowledge-store.sqlite");
    await fs.mkdir(rollbackRoot, { recursive: true, mode: 0o700 });
    let rollbackDb = new Runtime.Database();
    rollbackDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    rollbackDb.run("INSERT INTO durable_items VALUES ('baseline')");
    await legacySave(fs, rollbackDb, rollbackPath);
    let rollbackRenameThrows = true;
    const rollbackFs = {
      ...fs,
      rename: async (source, target) => {
        await fs.rename(source, target);
        if (rollbackRenameThrows) {
          rollbackRenameThrows = false;
          const error = new Error("injected:rename-after-replace");
          error.code = "EIO";
          throw error;
        }
      },
    };
    const rollbackStore = createSqlJsDurableStore({
      Runtime,
      filePath: rollbackPath,
      getDatabase: () => rollbackDb,
      setDatabase: (next) => { rollbackDb = next; },
      fsOps: rollbackFs,
      beforeStage: injectedFailure("confirm_parent_dir_fsync"),
      idFactory: () => "rollback-candidate",
    });
    rollbackDb.run("INSERT INTO durable_items VALUES ('must-not-smuggle')");
    await assert.rejects(
      () => rollbackStore.persist(),
      (error) => error.code === DURABLE_SAVE_FAILED_CODE
        && error.degradedReadonly === true
        && error.diskRollbackVerified === true
        && error.diskRollbackFailed === false,
      "failed ambiguous-candidate confirmation must restore and verify the old snapshot",
    );
    assert.deepEqual(await readRows(Runtime, rollbackPath), ["baseline"], "rollback must not leave new candidate bytes behind");
    await assert.rejects(() => rollbackStore.persist(), (error) => error.code === DEGRADED_READONLY_CODE);
    assert.deepEqual(await readRows(Runtime, rollbackPath), ["baseline"], "later save cannot smuggle a failed mutation");
    const rollbackRestart = new Runtime.Database(await fs.readFile(rollbackPath));
    assert.deepEqual(rollbackRestart.exec("SELECT value FROM durable_items")[0].values, [["baseline"]]);
    rollbackRestart.close();
    rollbackDb.close();

    const fenceRoot = path.join(root, "constructor-recovery-failure");
    const fencePath = path.join(fenceRoot, "knowledge-store.sqlite");
    await fs.mkdir(fenceRoot, { recursive: true, mode: 0o700 });
    let fenceDb = new Runtime.Database();
    fenceDb.run("CREATE TABLE durable_items (value TEXT PRIMARY KEY)");
    fenceDb.run("INSERT INTO durable_items VALUES ('baseline')");
    await legacySave(fs, fenceDb, fencePath);
    const preparedBeforeStore = fenceDb.prepare("INSERT INTO durable_items VALUES ('prepared-before-store')");
    const databaseBeforeStore = fenceDb;
    let recoveryConstructorCalls = 0;
    const failingRecoveryRuntime = {
      Database: function Database(bytes) {
        recoveryConstructorCalls += 1;
        if (recoveryConstructorCalls > 1) throw new Error("injected:recovery-constructor");
        return new Runtime.Database(bytes);
      },
    };
    const fenceStore = createSqlJsDurableStore({
      Runtime: failingRecoveryRuntime,
      filePath: fencePath,
      getDatabase: () => fenceDb,
      setDatabase: (next) => { fenceDb = next; },
      beforeStage: injectedFailure("rename"),
      idFactory: () => "fence-candidate",
    });
    const heldDatabase = fenceDb;
    assert.notEqual(heldDatabase, databaseBeforeStore, "store ownership must replace the raw sql.js Database capability");
    assert.equal(Object.getPrototypeOf(heldDatabase), null, "the managed Database facade must not expose the raw sql.js prototype");
    assert.equal(Object.hasOwn(heldDatabase, "__zhixiaDurableRawRun"), false, "raw SQL execution capability must stay private to the store");
    assert.throws(() => databaseBeforeStore.exec("SELECT 1"), /database closed|out of memory/i);
    const heldPreparedRun = heldDatabase.prepare("INSERT INTO durable_items VALUES ('held-prepared-run')");
    const heldPreparedStep = heldDatabase.prepare("INSERT INTO durable_items VALUES ('held-prepared-step')");
    heldDatabase.run("INSERT INTO durable_items VALUES ('failed-mutation')");
    await assert.rejects(
      () => fenceStore.persist(),
      (error) => error.code === DURABLE_SAVE_FAILED_CODE
        && error.degradedReadonly === true
        && error.diskRollbackFailed === false
        && error.memoryRecoveryFailed === true
        && /recovery-constructor/.test(String(error.memoryRecoveryError?.message || "")),
      "constructor recovery failure must still fence every held database capability",
    );
    for (const [label, mutate] of [
      ["held run", () => heldDatabase.run("INSERT INTO durable_items VALUES ('held-run')")],
      ["held exec", () => heldDatabase.exec("INSERT INTO durable_items VALUES ('held-exec')")],
      ["held prepare", () => heldDatabase.prepare("INSERT INTO durable_items VALUES ('held-prepare')")],
      ["held prepared run", () => heldPreparedRun.run()],
      ["held prepared step", () => heldPreparedStep.step()],
      ["prepared before store", () => preparedBeforeStore.step()],
    ]) {
      assert.throws(
        mutate,
        (error) => error.code === DEGRADED_READONLY_CODE || /readonly|statement closed/i.test(String(error?.message || error)),
        `${label} must be fenced by shared degraded authority`,
      );
    }
    preparedBeforeStore.free();
    heldPreparedRun.free();
    heldPreparedStep.free();
    assert.deepEqual(await readRows(Runtime, fencePath), ["baseline"], "constructor recovery failure must not alter the durable snapshot");
    const fenceRestart = new Runtime.Database(await fs.readFile(fencePath));
    assert.deepEqual(fenceRestart.exec("SELECT value FROM durable_items")[0].values, [["baseline"]]);
    fenceRestart.close();
    heldDatabase.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log("sql.js durable store failure matrix passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
