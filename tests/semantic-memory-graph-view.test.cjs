const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "electron", "main.cjs");
const preloadPath = path.join(root, "electron", "preload.cjs");
const appPath = path.join(root, "src", "App.tsx");
const mainSource = fs.readFileSync(mainPath, "utf8");
const preloadSource = fs.readFileSync(preloadPath, "utf8");
const appSource = fs.readFileSync(appPath, "utf8");

const {
  listSemanticMemoryEntities,
  listSemanticMemoryRelations,
  upsertSemanticGraphRecords,
} = require("../electron/memoryRuntimeIndexStore.cjs");
const {
  canonicalSemanticGraphProjectScope,
  projectIdentityForPath,
  stableSemanticEntityId,
} = require("../electron/semanticMemoryGraphPolicy.cjs");
const {
  deriveProjectIdentityEnvelope,
} = require("../codex-skills/zhixia-local-docs/scripts/project-identity.cjs");

function graphScope(projectPath) {
  const envelope = deriveProjectIdentityEnvelope(projectPath);
  return canonicalSemanticGraphProjectScope(projectPath, envelope);
}

function sourceRef(projectName, index) {
  return {
    kind: "canonical_doc",
    path: `docs/${projectName}-${index}.md`,
    hash: `${projectName}-hash-${index}`,
  };
}

function seedProject(storeRoot, projectPath, projectName, nodeCount, relationCount, options = {}) {
  const scope = graphScope(projectPath);
  const storageProjectId = options.projectId || scope.projectId;
  const entities = Array.from({ length: nodeCount }, (_, index) => ({
    projectPath: scope.projectPath,
    projectId: storageProjectId,
    kind: "concept",
    canonicalName: `${projectName} node ${index}`,
    aliases: [`${projectName}-alias-${index}`],
    status: "active",
    sourceRefs: Array.from({ length: 5 }, (_, refIndex) => sourceRef(projectName, (index * 10) + refIndex)),
    provenance: "explicit",
    confidence: 0.9,
    createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 7, 2, 0, 0, index)).toISOString(),
  }));
  const entityIds = entities.map((entity) => stableSemanticEntityId(entity));
  const relations = Array.from({ length: relationCount }, (_, index) => ({
    projectPath: scope.projectPath,
    projectId: storageProjectId,
    fromEntityId: entityIds[0],
    toEntityId: entityIds[1 + (index % Math.max(1, Math.min(48, nodeCount - 1)))],
    predicate: `related_to_${index}`,
    status: "active",
    sourceRefs: Array.from({ length: 5 }, (_, refIndex) => sourceRef(projectName, (index * 10) + refIndex)),
    provenance: "explicit",
    confidence: 0.85,
    createdAt: new Date(Date.UTC(2026, 7, 1, 1, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 7, 2, 1, 0, index)).toISOString(),
  }));
  const result = upsertSemanticGraphRecords(storeRoot, {
    projectPath: scope.projectPath,
    projectId: scope.projectId,
    entities,
    relations,
  }, {
    projectPath: scope.projectPath,
    projectId: storageProjectId,
  });
  assert.equal(result.rejected, 0, JSON.stringify(result.warnings));
  return { scope, storageProjectId, entityIds };
}

function loadMainHandlers(userDataPath) {
  const handlers = new Map();
  const appReady = new Promise(() => {});
  const electronMock = {
    app: {
      commandLine: { appendSwitch() {} },
      disableHardwareAcceleration() {},
      exit() {},
      getAppPath: () => root,
      getPath: (name) => name === "userData" ? userDataPath : userDataPath,
      on() {},
      quit() {},
      setAppUserModelId() {},
      setName() {},
      whenReady: () => appReady,
    },
    BrowserWindow: class BrowserWindow {
      static getAllWindows() { return []; }
    },
    dialog: {},
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
    },
    safeStorage: {},
    shell: {},
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(mainPath)];
    require(mainPath);
  } finally {
    Module._load = originalLoad;
  }
  return handlers;
}

function assertMetadataOnly(packet) {
  const forbiddenKeys = new Set(["body", "content", "contentText", "rawSession", "sessionBody", "vaultBody", "base64"]);
  const stack = [packet];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden graph-view key: ${key}`);
      if (nested && typeof nested === "object") stack.push(nested);
    }
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-semantic-graph-view-"));
  try {
    const userDataPath = path.join(tempRoot, "user-data");
    const storeRoot = path.join(userDataPath, "memory-runtime");
    const projectA = path.join(tempRoot, "project-a");
    const projectB = path.join(tempRoot, "project-b");
    const legacyProject = path.join(tempRoot, "legacy-project");
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    fs.mkdirSync(path.join(projectA, "docs"), { recursive: true });
    fs.mkdirSync(path.join(projectB, "docs"), { recursive: true });
    fs.mkdirSync(path.join(legacyProject, "docs"), { recursive: true });

    const seededA = seedProject(storeRoot, projectA, "alpha", 96, 220);
    const seededB = seedProject(storeRoot, projectB, "foreign-sentinel", 8, 12);
    const legacyScope = graphScope(legacyProject);
    const seededLegacy = seedProject(storeRoot, legacyProject, "legacy", 4, 3, {
      projectId: projectIdentityForPath(legacyScope.projectPath),
    });
    const handlers = loadMainHandlers(userDataPath);
    const handler = handlers.get("memoryRuntime:getSemanticGraphView");
    assert.equal(typeof handler, "function", "semantic graph view IPC handler must be registered");

    const overview = await handler(null, {
      projectPath: projectA,
      projectId: seededB.scope.projectId,
      maxNodes: 9999,
      maxEdges: 9999,
    });
    assert.equal(overview.schemaVersion, 1);
    assert.equal(overview.mode, "overview");
    assert.equal(overview.taskGoal, "");
    assert.equal(overview.nodes.length, 72, "node output must enforce the 72-node maximum");
    assert.ok(overview.edges.length <= 180, "edge output must enforce the 180-edge maximum");
    assert.equal(overview.diagnostics.nodeLimit, 72);
    assert.equal(overview.diagnostics.edgeLimit, 180);
    assert.equal(overview.diagnostics.readOnly, true);
    assert.equal(overview.performance.readOnly, true);
    assert.equal(overview.performance.metadataOnly, true);
    assert.equal(overview.performance.queryDurationMs, overview.performance.durationMs);
    assert.equal(overview.performance.writes, 0);
    assert.equal(overview.performance.migrations, 0);
    assert.equal(overview.projectIdentity.graphProjectId, seededA.scope.projectId, "caller-supplied project IDs must not override the derived envelope");
    const overviewJson = JSON.stringify(overview);
    assert.equal(overviewJson.includes("foreign-sentinel"), false, "foreign project labels must not cross the exact project boundary");
    assert.equal(overviewJson.includes(projectB), false, "foreign canonical paths must not cross the exact project boundary");
    assert.equal(seededB.entityIds.some((entityId) => overviewJson.includes(entityId)), false, "foreign entity IDs must not cross the exact project boundary");
    assert.ok(overview.nodes.every((node) => "provenance" in node && "confidence" in node && Array.isArray(node.aliases)));
    assert.ok(overview.nodes.every((node) => node.sourceRefs.length <= 3));
    assertMetadataOnly(overview);

    const neighborhood = await handler(null, {
      projectPath: projectA,
      centerNodeId: seededA.entityIds[0],
      taskGoal: "Inspect the selected semantic entity",
      maxNodes: 9999,
      maxEdges: 9999,
    });
    assert.equal(neighborhood.mode, "one_hop");
    assert.equal(neighborhood.taskGoal, "Inspect the selected semantic entity");
    assert.equal(neighborhood.neighborhood.mode, "one_hop");
    assert.equal(neighborhood.neighborhood.centerNodeId, seededA.entityIds[0]);
    assert.equal(neighborhood.neighborhood.selectedNodeId, seededA.entityIds[0]);
    assert.ok(neighborhood.nodes.length <= 72);
    assert.equal(neighborhood.edges.length, 180, "one-hop output must enforce the edge cap after finding the selected node");
    assert.ok(neighborhood.edges.every((edge) => edge.from === seededA.entityIds[0] || edge.to === seededA.entityIds[0]), "selected-node mode must return only incident edges");
    assert.ok(neighborhood.edges.every((edge) => neighborhood.nodes.some((node) => node.id === edge.from) && neighborhood.nodes.some((node) => node.id === edge.to)), "all returned edges must have returned endpoints");
    assert.ok(neighborhood.edges.every((edge) => edge.kind === edge.label && typeof edge.weight === "number" && "provenance" in edge && "confidence" in edge && "validFrom" in edge && "validTo" in edge && "factId" in edge));
    assert.ok(neighborhood.edges.every((edge) => edge.sourceRefs.length <= 3));
    assertMetadataOnly(neighborhood);

    const legacyOverview = await handler(null, { projectPath: legacyProject });
    assert.equal(legacyOverview.nodes.length, 4, "same-project legacy path-hash rows must remain readable during the identity transition");
    assert.equal(legacyOverview.projectIdentity.graphProjectId, seededLegacy.scope.projectId, "the public graph identity must remain the envelope ID");
    assert.equal(legacyOverview.projectIdentity.storageProjectId, seededLegacy.storageProjectId, "diagnostics must expose the legacy storage identity in use");
    assert.ok(legacyOverview.warnings.includes("semantic_graph_view_legacy_project_id_read_only"));

    const beforeCounts = {
      entities: listSemanticMemoryEntities(storeRoot, { ...seededA.scope, limit: 500 }).length,
      relations: listSemanticMemoryRelations(storeRoot, { ...seededA.scope, limit: 600 }).length,
    };
    await handler(null, { projectPath: projectA });
    const afterCounts = {
      entities: listSemanticMemoryEntities(storeRoot, { ...seededA.scope, limit: 500 }).length,
      relations: listSemanticMemoryRelations(storeRoot, { ...seededA.scope, limit: 600 }).length,
    };
    assert.deepEqual(afterCounts, beforeCounts, "graph view reads must not seed or mutate semantic sidecar rows");

    const helperSource = mainSource.match(/function getSemanticMemoryGraphView[\s\S]*?\r?\n}\r?\n\r?\nfunction getMemoryCoreDiagnostics/)?.[0] || "";
    const handlerSource = mainSource.match(/ipcMain\.handle\("memoryRuntime:getSemanticGraphView"[^\n]+/)?.[0] || "";
    assert.match(helperSource, /listSemanticMemoryEntities\(memoryRuntimeRoot\(\)/);
    assert.match(helperSource, /listSemanticMemoryRelations\(memoryRuntimeRoot\(\)/);
    assert.doesNotMatch(`${helperSource}\n${handlerSource}`, /\b(?:ensureDatabase|saveDatabase|upsertSemanticGraphRecords|retrieveSemanticGraphPaths|writeMemoryRuntimeTriggerReceipt)\s*\(|db\.export\s*\(|set(?:Interval|Timeout)\s*\(/, "read-only IPC route must not enter legacy saves, graph writes, migrations, receipts, or timers");
    assert.doesNotMatch(`${helperSource}\n${handlerSource}`, /memory_graph_nodes|knowledge-store\.sqlite/, "graph view must not use the legacy sql.js graph path");

    const appGraphLoader = appSource.match(/async function loadProjectMemoryGraph[\s\S]*?\r?\n  async function runMemoryRuntimeProbe/)?.[0] || "";
    assert.match(appGraphLoader, /getSemanticMemoryGraphView\(/, "graph tab must call the native read-only graph IPC");
    assert.doesNotMatch(appGraphLoader, /retrieveMemoryRuntimeContext|activateMemoryRuntimeGraph/, "opening or refreshing the graph tab must not prewarm legacy sql.js retrieval");

    assert.match(preloadSource, /getSemanticMemoryGraphView:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\("memoryRuntime:getSemanticGraphView",\s*options\)/);
    console.log("Semantic memory graph view tests passed.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
