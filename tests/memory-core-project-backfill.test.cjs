const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createMemoryCoreRuntime,
  memoryCorePrivateStateExists,
} = require("../electron/memoryCoreRuntime.cjs");
const {
  listModuleMemories,
  listProjectAnchors,
  listProjectBrains,
} = require("../electron/memoryRuntimeIndexStore.cjs");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const signature = source.slice(start).match(/^function\s+\w+\s*\([\s\S]*?\)\s*\{/);
  assert.ok(signature, `${functionName} must have an extractable signature`);
  const bodyStart = start + signature[0].lastIndexOf("{");
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${functionName} body was not closed`);
}

const helperSource = extractFunctionSource(mainSource, "buildMemoryCoreProjectSeedInput");
const buildMemoryCoreProjectSeedInput = Function(
  "path",
  "crypto",
  `"use strict"; ${helperSource}; return buildMemoryCoreProjectSeedInput;`,
)(path, crypto);

function sourceDoc(projectPath, index, overrides = {}) {
  return {
    id: `doc-${index}`,
    workspacePath: projectPath,
    filePath: path.join(projectPath, "docs", `source-${String(index).padStart(2, "0")}.md`),
    fileModifiedAt: `2026-07-${String(index + 1).padStart(2, "0")}T03:00:00.000Z`,
    updatedAt: `2026-07-16T12:${String(index).padStart(2, "0")}:00.000Z`,
    contentHash: `hash-${index}`,
    artifactType: index % 2 === 0 ? "readme" : "technical_design",
    sourceType: "codex_output",
    parseStatus: "ok",
    summary: `summary-body-${index}`,
    contentText: `content-body-${index}`,
    body: `body-payload-${index}`,
    ...overrides,
  };
}

function main() {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-core-project-backfill-"));
  try {
    const projectPath = path.join(storeRoot, "Existing Project");
    const payloadSentinel = `data:image/png;base64,${"A".repeat(260)}`;
    const originalDocs = Array.from({ length: 14 }, (_, index) => sourceDoc(projectPath, index));
    const excludedDocs = [
      sourceDoc(projectPath, 20, { filePath: path.join(projectPath, ".codex-knowledge", "generated.md") }),
      sourceDoc(projectPath, 21, { filePath: path.join(projectPath, ".codex", "sessions", "raw.jsonl"), sourceType: "raw_session" }),
      sourceDoc(projectPath, 22, { filePath: path.join(projectPath, "codex-history-vault", "thread.md"), sourceType: "vault" }),
      sourceDoc(projectPath, 23, { filePath: path.join(projectPath, "docs", "failed.md"), parseStatus: "failed" }),
      sourceDoc(projectPath, 24, { filePath: path.join(projectPath, "docs", "image.png"), contentText: payloadSentinel }),
    ];
    originalDocs[0].summary = payloadSentinel;
    originalDocs[0].contentText = `private-contentText-${payloadSentinel}`;
    originalDocs[0].body = "private-body-payload";

    const runtime = createMemoryCoreRuntime({ storeRoot });
    assert.equal(memoryCorePrivateStateExists(storeRoot), false, "runtime construction and helper evaluation must not create private state");
    assert.equal(listProjectBrains(storeRoot).length, 0, "no project brain may exist before explicit seed");

    const seedInput = buildMemoryCoreProjectSeedInput({
      projectPath,
      projectDocs: [...originalDocs, ...excludedDocs],
      layered: { project: "Existing Project" },
      projectRecord: {
        name: "Existing Project",
        aliases: ["Existing Project"],
        governance: { status: "heuristic", reviewState: "current" },
      },
      projectRecordOverride: null,
    });
    assert.ok(seedInput, "original source documents must produce a deterministic seed");
    assert.equal(seedInput.phase, null, "unconfirmed projects must not default to active");
    assert.equal(seedInput.modules.length, 0, "artifact types and directories must not infer modules");
    assert.equal(seedInput.anchors.length, 1, "initial seed must contain one identity anchor");
    assert.equal(seedInput.sourceRefs.length, 12, "metadata source refs must remain bounded");
    assert.equal(seedInput.now, "2026-07-14T03:00:00.000Z", "updatedAt must use the latest original file mtime, not scan time");
    assert.ok(seedInput.sourceRefs.every((ref) => ref.hash && ref.artifactType && ref.updatedAt));
    assert.ok(seedInput.sourceRefs.every((ref) => !/\.codex-knowledge|sessions|vault|\.jsonl|\.png/i.test(ref.path)));
    assert.doesNotMatch(JSON.stringify(seedInput), /private-contentText|private-body-payload|data:image\/png;base64|summary-body-/i);

    const first = runtime.seedProject(seedInput);
    assert.deepEqual(first.writes.map((write) => write.action), ["insert", "insert"]);
    assert.equal(memoryCorePrivateStateExists(storeRoot), true, "explicit seed must initialize private state");
    assert.equal(listProjectBrains(storeRoot).length, 1);
    assert.equal(listProjectAnchors(storeRoot).length, 1);
    assert.equal(listModuleMemories(storeRoot).length, 0);
    const firstBrain = listProjectBrains(storeRoot)[0];
    const firstAnchor = listProjectAnchors(storeRoot)[0];
    const persistedJson = JSON.stringify({ firstBrain, firstAnchor });
    assert.doesNotMatch(persistedJson, /private-contentText|private-body-payload|data:image\/png;base64|summary-body-/i);
    assert.equal(firstBrain.phase, null);
    assert.equal(firstBrain.sourceRefs.length, 12);

    const repeated = runtime.seedProject(buildMemoryCoreProjectSeedInput({
      projectPath,
      projectDocs: [...originalDocs, ...excludedDocs],
      layered: { project: "Existing Project" },
      projectRecord: { name: "Existing Project", aliases: ["Existing Project"], governance: { status: "heuristic", reviewState: "current" } },
    }));
    assert.deepEqual(repeated.writes.map((write) => write.action), ["noop", "noop"], "unchanged repeated seed must be a noop");

    const changedDocs = originalDocs.map((doc, index) => index === 0 ? {
      ...doc,
      contentHash: "hash-0-changed",
      fileModifiedAt: "2026-07-20T03:00:00.000Z",
    } : doc);
    const changedSeed = buildMemoryCoreProjectSeedInput({
      projectPath,
      projectDocs: [...changedDocs, ...excludedDocs],
      layered: { project: "Existing Project" },
      projectRecord: { name: "Existing Project", aliases: ["Existing Project"], governance: { status: "heuristic", reviewState: "current" } },
    });
    assert.equal(changedSeed.anchors[0].anchorId, seedInput.anchors[0].anchorId, "source changes must retain the identity anchor ID");
    const changed = runtime.seedProject(changedSeed);
    assert.deepEqual(changed.writes.map((write) => write.action), ["update", "update"]);
    assert.equal(listProjectBrains(storeRoot)[0].projectId, firstBrain.projectId, "source changes must update the same project brain ID");
    assert.equal(listProjectAnchors(storeRoot)[0].anchorId, firstAnchor.anchorId, "source changes must update the same anchor ID");

    const confirmedSeed = buildMemoryCoreProjectSeedInput({
      projectPath,
      projectDocs: originalDocs,
      layered: { project: "Existing Project" },
      projectRecord: { name: "Existing Project", governance: { status: "confirmed", reviewState: "current" } },
      projectRecordOverride: {
        confirmedAt: "2026-07-16T05:00:00.000Z",
        lastSummary: "Confirmed compact project summary.",
        completion: "testing",
      },
    });
    assert.equal(confirmedSeed.phase, "testing");
    assert.match(confirmedSeed.productSummary, /Confirmed compact project summary/);
    const staleSeed = buildMemoryCoreProjectSeedInput({
      projectPath,
      projectDocs: originalDocs,
      layered: { project: "Existing Project" },
      projectRecord: { name: "Existing Project", governance: { status: "confirmed", reviewState: "stale" } },
      projectRecordOverride: {
        confirmedAt: "2026-07-16T05:00:00.000Z",
        lastSummary: "Stale summary must not seed.",
        completion: "released",
      },
    });
    assert.equal(staleSeed.phase, null);
    assert.doesNotMatch(staleSeed.productSummary, /Stale summary/);

    const writeFunction = extractFunctionSource(mainSource, "writeProjectKnowledgeFiles");
    const watcherFunction = extractFunctionSource(mainSource, "refreshFromFileWatch");
    const scanFunction = extractFunctionSource(mainSource, "scanCodexWorkspacePath");
    assert.match(writeFunction, /seedMemoryCore === true[\s\S]*seedProjectMemoryCoreBackfill/);
    assert.match(watcherFunction, /scanCodexWorkspacePath\(workspacePath\)/);
    assert.doesNotMatch(watcherFunction, /seedMemoryCore:\s*true/);
    assert.doesNotMatch(`${helperSource}\n${scanFunction}`, /setInterval\(|setTimeout\(|openAiCompatibleChatCompletion|https\.|http\.|fetch\(/);

    console.log("Memory Core project backfill test passed.");
  } finally {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
}

main();
