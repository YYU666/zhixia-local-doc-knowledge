const assert = require("node:assert/strict");
const {
  deriveKnowledgeFreshness,
  mergeDuplicateMemoryItems,
} = require("../codex-skills/zhixia-local-docs/scripts/read-project-knowledge.cjs");

const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-07-28T00:00:00.000Z");
const activeEntry = { status: "active", humanConfirmation: false };

const recent = deriveKnowledgeFreshness(activeEntry, { mtimeMs: now - day, mtime: new Date(now - day) }, { latestMtimeMs: now - 2 * day }, now);
assert.equal(recent.freshness, "fresh", "recent packet not older than canonical docs may be fresh");
assert.equal(recent.freshnessBasis, "recent_mtime_not_older_than_canonical_document");
assert.ok(recent.ageMs > 0 && recent.ageDays === 1, "freshness must expose actual age");

const behindCanonical = deriveKnowledgeFreshness(activeEntry, { mtimeMs: now - 3 * day, mtime: new Date(now - 3 * day) }, { latestMtimeMs: now - day }, now);
assert.equal(behindCanonical.freshness, "stale", "generated packet older than canonical docs must be stale");
assert.equal(behindCanonical.freshnessBasis, "packet_mtime_older_than_canonical_document");

const old = deriveKnowledgeFreshness(activeEntry, { mtimeMs: now - 60 * day, mtime: new Date(now - 60 * day) }, { latestMtimeMs: null }, now);
assert.equal(old.freshness, "stale", "old packets must not be fresh based on packet type");

const merged = mergeDuplicateMemoryItems([
  {
    id: "duplicate-id", kind: "knowledge", title: "First", excerpt: "first", sourcePath: "a.md",
    sourceRefs: [{ kind: "doc", path: "a.md", hash: "a" }], freshness: "fresh", score: 10,
    tokenEstimate: 30, whyMatched: ["first_reason"], whyRecalled: ["first_recall"], reason: "first",
  },
  {
    id: "duplicate-id", kind: "decision", title: "Second", excerpt: "second", sourcePath: "b.md",
    sourceRefs: [{ kind: "doc", path: "b.md", hash: "b" }], freshness: "stale", score: 20,
    tokenEstimate: 40, whyMatched: ["second_reason"], whyRecalled: ["second_recall"], reasons: ["second"],
  },
]);
assert.equal(merged.items.length, 1, "duplicate IDs must produce one merged memory item");
assert.equal(merged.items[0].sourceRefs.length, 2, "duplicate merge must retain all distinct source refs");
assert.deepEqual(new Set(merged.items[0].whyMatched), new Set(["first_reason", "second_reason"]));
assert.deepEqual(new Set(merged.items[0].whyRecalled), new Set(["first_recall", "second_recall"]));
assert.deepEqual(new Set(merged.items[0].reasons), new Set(["first", "second"]));
assert.equal(merged.items[0].freshness, "stale", "duplicate merge must keep the conservative freshness");
assert.equal(merged.diagnostics[0].code, "duplicate_memory_item_id_merged", "duplicate merge must emit a provider diagnostic");

console.log("Knowledge freshness and duplicate merge tests passed.");
