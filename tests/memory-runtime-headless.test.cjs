const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const cli = path.join(appRoot, "codex-skills", "zhixia-local-docs", "scripts", "memory-runtime-headless.cjs");

function run(request, env, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli], {
    cwd: request.workspace,
    env: { ...process.env, ...env },
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, `unexpected CLI status: ${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  return output;
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-headless-"));
  const workspace = path.join(root, "project");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(path.join(workspace, ".codex-knowledge"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "PRD.md"), "# Alpha PRD\nCanonical acceptance source.\n", "utf8");
  fs.writeFileSync(path.join(workspace, ".codex-knowledge", "retrieval-packet.md"), "# Alpha runtime\nCurrent bounded context.\n", "utf8");
  const env = { ZHIXIA_USER_DATA: userData };

  try {
    const initial = run({ action: "retrieve_context", workspace, taskGoal: "Alpha runtime" }, env);
    assert.equal(initial.memoryMode, "fallback_stale", "missing Memory Core must remain fallback_stale");
    assert.equal(initial.triggerReceipt.action, "retrieve_context");

    const writeback = run({
      action: "writeback_evidence",
      workspace,
      decision: "accept",
      title: "Alpha acceptance decision",
      summary: "The bounded headless lifecycle is accepted for project use.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(writeback.status, "completed");
    assert.equal(writeback.sourceRefs.length, 1, "writeback must retain sourceRefs");
    assert.equal(writeback.storage.uiRequired, false, "writeback must not require Electron UI");
    assert.equal(writeback.storage.mainDatabaseWrite, false, "writeback must not touch the sql.js main DB");

    const repeated = run({
      action: "writeback_evidence",
      workspace,
      decision: "accept",
      title: "Alpha acceptance decision",
      summary: "The bounded headless lifecycle is accepted for project use.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(repeated.id, writeback.id, "identical writeback should be idempotent");

    const recalled = run({ action: "retrieve_precedent", workspace, taskType: "bounded headless lifecycle", limit: 12 }, env);
    assert.ok(recalled.items.some((item) => item.id === writeback.id), "headless writeback must be recallable without UI");
    assert.ok(recalled.items.find((item) => item.id === writeback.id).sourceRefs.some((ref) => /PRD\.md$/.test(ref.path || "")), "recalled evidence must retain its source ref");

    const event = run({
      action: "observe_event",
      workspace,
      eventType: "checkpoint",
      title: "Alpha checkpoint",
      observation: "Headless observation persisted with bounded project evidence.",
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env);
    assert.equal(event.action, "observe_event");

    const receipts = run({ action: "list_trigger_receipts", workspace, limit: 20 }, env);
    assert.ok(receipts.receipts.some((receipt) => receipt.action === "writeback_evidence"), "receipt lookup must include writeback");
    assert.ok(receipts.receipts.some((receipt) => receipt.action === "retrieve_context"), "receipt lookup must include retrieval");

    const noSource = run({
      action: "writeback_evidence", workspace, decision: "accept", title: "No source", summary: "Must fail closed.", sourceRefs: [],
    }, env, 1);
    assert.equal(noSource.error, "accepted_writeback_requires_source_refs");

    const foreign = path.join(root, "foreign", "evidence.md");
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, "foreign", "utf8");
    const crossProject = run({
      action: "writeback_evidence", workspace, decision: "accept", title: "Foreign", summary: "Must fail closed.",
      sourceRefs: [{ kind: "file", path: foreign, title: "foreign" }],
    }, env, 1);
    assert.equal(crossProject.error, "cross_project_source_ref_rejected");

    const unsafe = run({
      action: "observe_event", workspace, title: "Unsafe", observation: `data:image/png;base64,${"A".repeat(300)}`,
      sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
    }, env, 1);
    assert.equal(unsafe.error, "unsafe_or_empty_compact_payload_rejected");

    for (const credentialSentinel of [
      "sk-abcdefghijklmnop1234",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      "AKIA1234567890ABCDEF",
    ]) {
      const secret = run({
        action: "writeback_evidence", workspace, decision: "accept", title: "Secret rejection",
        summary: `Credential ${credentialSentinel} must never persist.`,
        sourceRefs: [{ kind: "canonical_doc", path: "docs/PRD.md", title: "Alpha PRD" }],
      }, env, 1);
      assert.equal(secret.error, "unsafe_or_empty_compact_payload_rejected", `credential signature ${credentialSentinel.slice(0, 4)} must fail closed`);
    }

    const outputText = JSON.stringify({ initial, writeback, recalled, event, receipts });
    assert.doesNotMatch(outputText, /data:image|\.codex[\\/]sessions|A{120}/, "headless packets must not leak raw/base64 bodies");
    console.log("Memory Runtime headless strict-JSON tests passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
