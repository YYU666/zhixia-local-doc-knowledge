const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createStrictReadonlyMemoryProductQuery } = require("../electron/strictReadonlyMemoryProductQuery.cjs");
const { createStrictReadonlyMemoryQueryPort } = require("../electron/runtimeBoundaries/strictReadonlyMemoryQueryPort.cjs");

function snapshotTree(root) {
  const entries = {};
  if (!fs.existsSync(root)) return entries;
  function walk(current, relative) {
    const stat = fs.lstatSync(current);
    const key = relative || ".";
    entries[key] = {
      type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other",
      mode: stat.mode & 0o777,
      size: stat.size,
      sha256: stat.isFile() ? crypto.createHash("sha256").update(fs.readFileSync(current)).digest("hex") : null,
    };
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name), relative ? `${relative}/${name}` : name);
    }
  }
  walk(root, "");
  return entries;
}

async function invokeWithGuard(userData, projectPath) {
  const queryAdapter = createStrictReadonlyMemoryProductQuery({ userDataPath: userData });
  const port = createStrictReadonlyMemoryQueryPort({
    captureWriteState: () => snapshotTree(userData),
    query: queryAdapter,
  });
  return port.query({ projectPath, readOnly: true, maxResults: 8 });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-strict-readonly-product-"));
  try {
    const projectPath = path.join(root, "project");
    fs.mkdirSync(projectPath);

    const freshUserData = path.join(root, "fresh-user-data");
    const freshBefore = snapshotTree(freshUserData);
    const missingProject = await createStrictReadonlyMemoryProductQuery({ userDataPath: freshUserData })({ projectPath: null, readOnly: true });
    assert.deepEqual(snapshotTree(freshUserData), freshBefore, "missing project identity must fail before any first-use storage initialization");
    assert.equal(missingProject.availability, "unavailable");
    assert.deepEqual(missingProject.reasonCodes, ["strict_readonly_project_path_required"]);
    assert.equal(missingProject.projectPath, null, "strict read-only must not infer a project from process.cwd()");
    const fresh = await invokeWithGuard(freshUserData, projectPath);
    const freshAfter = snapshotTree(freshUserData);
    assert.equal(fresh.availability, "unavailable");
    assert.deepEqual(fresh.reasonCodes, ["strict_readonly_store_missing"]);
    assert.equal(fresh.readOnly, true);
    assert.equal(fresh.writes, 0);
    assert.deepEqual(freshAfter, freshBefore, "first-use strict read-only must not create userData, database, sidecar, key, graph, receipt, log, or cache paths");

    const existingUserData = path.join(root, "existing-user-data");
    const storeRoot = path.join(existingUserData, "memory-runtime");
    fs.mkdirSync(storeRoot, { recursive: true, mode: 0o777 });
    fs.chmodSync(existingUserData, 0o755);
    fs.chmodSync(storeRoot, 0o777);
    const sidecarPath = path.join(storeRoot, "memory-runtime-index.sqlite");
    const writer = new DatabaseSync(sidecarPath);
    writer.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE memory_search_items (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, projectPath TEXT, title TEXT NOT NULL, summary TEXT NOT NULL,
        tagsJson TEXT NOT NULL, sourceRefsJson TEXT NOT NULL, status TEXT NOT NULL, freshness TEXT NOT NULL,
        requiresHumanConfirmation INTEGER NOT NULL DEFAULT 0, tokenEstimate INTEGER NOT NULL, updatedAt TEXT
      );
    `);
    writer.prepare(`INSERT INTO memory_search_items(
      id, kind, projectPath, title, summary, tagsJson, sourceRefsJson, status, freshness,
      requiresHumanConfirmation, tokenEstimate, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "item-1", "project_artifact", projectPath, "Accepted project state", "Compact source-backed state.",
      "[]", JSON.stringify([{ path: "docs/accepted.md", hash: "a".repeat(64) }]), "accepted", "fresh", 0, 24,
      "2026-08-13T00:00:00.000Z",
    );
    fs.writeFileSync(path.join(existingUserData, "unrelated-owner-file.txt"), "must remain unchanged\n", { mode: 0o644 });
    for (const name of fs.readdirSync(storeRoot)) fs.chmodSync(path.join(storeRoot, name), 0o666);

    const activeWalBefore = snapshotTree(existingUserData);
    const activeWal = await invokeWithGuard(existingUserData, projectPath);
    const activeWalAfter = snapshotTree(existingUserData);
    assert.equal(activeWal.availability, "unavailable");
    assert.deepEqual(activeWal.reasonCodes, ["strict_readonly_store_not_quiescent"]);
    assert.deepEqual(activeWalAfter, activeWalBefore, "active WAL store must fail before SQLite open and preserve the complete storage tree");

    let activeRuntimeCalls = 0;
    const activeRuntimeAdapter = createStrictReadonlyMemoryProductQuery({
      userDataPath: existingUserData,
      activeReadonlyQuery: async (request) => {
        activeRuntimeCalls += 1;
        assert.equal(request.readOnly, true);
        assert.equal(request.projectPath, projectPath);
        return {
          items: [{
            id: "active-item",
            kind: "project_artifact",
            title: "Active runtime state",
            summary: "Read through the initialized Runtime without replaying initialization.",
            projectPath,
            sourceRefs: [{ path: "docs/active.md", hash: "b".repeat(64) }],
            status: "accepted",
            freshness: "fresh",
            tokenEstimate: 20,
          }],
          memoryCore: { triggerReceiptCounts: { retrieveContext: 0, semanticGraphRecall: 0 } },
          warnings: [],
        };
      },
    });
    const activeRuntimePort = createStrictReadonlyMemoryQueryPort({
      captureWriteState: () => snapshotTree(existingUserData),
      query: activeRuntimeAdapter,
    });
    const activeRuntime = await activeRuntimePort.query({ projectPath, readOnly: true, maxResults: 8 });
    assert.equal(activeRuntimeCalls, 1);
    assert.equal(activeRuntime.mode, "strict_readonly_active_runtime");
    assert.equal(activeRuntime.items[0].excerpt, "Read through the initialized Runtime without replaying initialization.");
    assert.equal(activeRuntime.items[0].sourcePath, "docs/active.md");
    assert.equal(activeRuntime.writes, 0);
    assert.deepEqual(snapshotTree(existingUserData), activeWalBefore, "active Runtime read path must preserve the complete storage tree");
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writer.close();

    fs.chmodSync(sidecarPath, 0o666);
    const existingBefore = snapshotTree(existingUserData);
    const existing = await invokeWithGuard(existingUserData, projectPath);
    const existingAfter = snapshotTree(existingUserData);
    assert.equal(existing.availability, "available");
    assert.equal(existing.returnedCount, 1);
    assert.equal(existing.items[0].id, "item-1");
    assert.equal(existing.mode, "strict_readonly_existing_sidecar");
    assert.equal(existing.provider, "zhixia_local_docs");
    assert.equal(existing.items[0].excerpt, "Compact source-backed state.");
    assert.equal(existing.items[0].sourcePath, "docs/accepted.md");
    assert.deepEqual(existing.items[0].whyMatched, ["strict_readonly_existing_sidecar", "project_path_exact"]);
    assert.equal(existing.readOnly, true);
    assert.equal(existing.writes, 0);
    assert.deepEqual(existingAfter, existingBefore, "quiescent existing-store strict read-only must preserve complete path set, bytes, sizes, file types, and modes");
    assert.equal(fs.existsSync(path.join(storeRoot, "private", "authority-receipt.key")), false, "strict read-only must not create a signing key");

    console.log("Strict read-only product query isolation tests passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
