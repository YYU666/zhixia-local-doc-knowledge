const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  autoIngestCodexSessions,
  collectCodexSessionFiles,
  extractThreadIdFromSessionPath,
  inferCodexSessionMetadata,
} = require("../electron/codexThreadHistoryAutoIngestPolicy.cjs");

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixia-auto-ingest-"));
  try {
    const threadId = ["019ed340", "b742", "7733", "9b1e", "b8af8429fd4d"].join("-");
    const sessionsRoot = path.join(root, ".codex", "sessions", "2026", "06", "17");
    const vaultRoot = path.join(root, "codex-history-vault");
    await fs.mkdir(sessionsRoot, { recursive: true });
    const sessionPath = path.join(sessionsRoot, `rollout-2026-06-17T09-44-54-${threadId}.jsonl`);
    await fs.writeFile(sessionPath, [
      JSON.stringify({
        type: "session_meta",
        thread_id: threadId,
        cwd: path.join(root, ".codex", "worktrees", "de33", "2D游戏项目"),
        forked_from_id: "public-thread-id",
      }),
      JSON.stringify({
        type: "message",
        role: "user",
        content: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\n这些是启动规则，不应该出现在项目摘要里。\n</INSTRUCTIONS>\n<environment_context>workspace</environment_context>\n我想做一个2D游戏，但是我不会那些2D游戏的引擎。",
      }),
      JSON.stringify({ type: "message", role: "assistant", content: "Refmuse Game Studio（RGS）可以作为项目代号。" }),
    ].join("\n"), "utf8");
    const oldTime = new Date("2026-06-10T08:00:00.000Z");
    await fs.utimes(sessionPath, oldTime, oldTime);

    assert.equal(extractThreadIdFromSessionPath(sessionPath), threadId, "thread id should be parsed from Codex rollout session paths");
    const inferred = await inferCodexSessionMetadata(sessionPath, { threadId, maxPrefixBytes: 64 * 1024, maxPrefixLines: 20 });
    assert.match(inferred.projectPath, /2D游戏项目/, "bounded prefix metadata should keep the project path clue");
    assert.match(inferred.inferredTitle, /Refmuse Game Studio|2D游戏项目/, "bounded prefix metadata should infer a useful title");
    assert.ok(inferred.searchTerms.includes("Refmuse Game Studio"), "bounded prefix metadata should extract product aliases");
    assert.ok(inferred.searchTerms.includes("RGS"), "bounded prefix metadata should extract short aliases");
    assert.match(inferred.firstUserMessage, /2D游戏/, "bounded prefix metadata should extract the first user goal");
    assert.doesNotMatch(inferred.firstUserMessage, /AGENTS|INSTRUCTIONS|environment_context/, "bounded prefix metadata should strip injected startup context");

    const first = await autoIngestCodexSessions({
      sessionsRoot: path.join(root, ".codex", "sessions"),
      vaultRoot,
      now: "2026-06-19T08:00:00.000Z",
      recentWriteMinutes: 60,
      limit: 50,
    });
    assert.equal(first.scannedCount, 1, "raw session exists but no vault should be scanned");
    assert.equal(first.preservedCount, 1, "auto ingestion should create preservation evidence");
    assert.equal(first.alreadyPreservedCount, 0, "first pass should not report already preserved");
    assert.equal(first.activePreservedCount, 0, "old fixture should not be active-like");
    assert.equal(first.safety.mutatesCodexSessionFiles, false, "auto ingestion must not mutate Codex session files");
    const result = first.results[0];
    assert.equal(result.threadId, threadId);
    assert.equal(result.memoryPointer, `codex-history:${threadId}`, "auto ingestion should create a memory pointer");
    const manifest = JSON.parse(await fs.readFile(result.vaultManifestPath, "utf8"));
    assert.equal(manifest.originalSha256, manifest.copiedSha256, "vault copy should be SHA-256 verified");
    assert.equal(manifest.layers.hot.retrieval, "same_thread_resume_pointer", "manifest should include hot summary evidence");
    assert.equal(manifest.layers.warm.retrieval, "same_project_or_keyword_match", "manifest should include warm summary evidence");
    assert.match(manifest.title, /Refmuse Game Studio|2D游戏项目/, "manifest title should be inferred from bounded prefix clues");
    assert.match(manifest.projectPath, /2D游戏项目/, "manifest projectPath should be inferred without reading the full session");
    assert.match(manifest.layers.warm.summary, /Refmuse Game Studio|RGS|2D游戏项目/, "warm layer should be keyword searchable");
    assert.doesNotMatch(manifest.summary, /AGENTS|INSTRUCTIONS|environment_context/, "manifest summary should not expose injected startup context as the user goal");
    assert.ok(manifest.searchTerms.includes("Refmuse Game Studio"), "manifest should retain searchable aliases");
    assert.equal(manifest.policy.mutatesCodexSessionFiles, false, "manifest policy should preserve source-session boundary");

    const second = await autoIngestCodexSessions({
      sessionsRoot: path.join(root, ".codex", "sessions"),
      vaultRoot,
      now: "2026-06-19T08:05:00.000Z",
      recentWriteMinutes: 60,
      limit: 50,
    });
    assert.equal(second.preservedCount, 0, "unchanged repeated ingestion should not duplicate vault records");
    assert.equal(second.alreadyPreservedCount, 1, "unchanged repeated ingestion should report already preserved");
    const threadDir = path.dirname(result.vaultManifestPath);
    const vaultSessions = (await fs.readdir(threadDir)).filter((name) => /^session-.+\.jsonl$/.test(name));
    assert.equal(vaultSessions.length, 1, "unchanged session should have one vault copy");

    const activeThreadId = ["019ec034", "b42a", "7fc3", "8963", "67d17a9b84ab"].join("-");
    const activeSessionPath = path.join(sessionsRoot, `rollout-2026-06-19T07-55-00-${activeThreadId}.jsonl`);
    await fs.writeFile(activeSessionPath, JSON.stringify({ type: "message", content: "active" }), "utf8");
    const activeTime = new Date("2026-06-19T07:55:00.000Z");
    await fs.utimes(activeSessionPath, activeTime, activeTime);
    const active = await autoIngestCodexSessions({
      sessionsRoot: path.join(root, ".codex", "sessions"),
      vaultRoot,
      now: "2026-06-19T08:00:00.000Z",
      recentWriteMinutes: 60,
      limit: 50,
    });
    const activeResult = active.results.find((item) => item.threadId === activeThreadId);
    assert.equal(activeResult.preservationState, "preserved_not_archive_ready", "recent sessions should be preserved but not archive-ready");
    assert.equal(active.activePreservedCount >= 1, true, "active-like preserved count should be reported separately");

    const crowdedRoot = path.join(root, "crowded", "sessions", "2026", "06", "19");
    await fs.mkdir(crowdedRoot, { recursive: true });
    for (let index = 0; index < 20; index += 1) {
      const crowdedThreadId = ["019ec034", "b42a", "7fc3", "8963", String(index).padStart(12, "0")].join("-");
      await fs.writeFile(
        path.join(crowdedRoot, `rollout-2026-06-19T08-${String(index).padStart(2, "0")}-00-${crowdedThreadId}.jsonl`),
        JSON.stringify({ type: "message", index }),
        "utf8",
      );
    }
    const bounded = await collectCodexSessionFiles(path.join(root, "crowded", "sessions"), {
      limit: 3,
      stopAfterLimit: true,
      maxFileStats: 3,
      maxDirectoryReads: 10,
    });
    assert.equal(bounded.length, 3, "startup-style collection should return only the limited batch");
    assert.equal(bounded.collectionStats.fileStatCount, 3, "startup-style collection must not stat every historical session before slicing");
    assert.equal(bounded.collectionStats.truncated, true, "startup-style collection should report that traversal was intentionally bounded");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("Codex thread-history auto-ingest policy tests passed.");
});
