const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const helperPath = path.join(root, "codex-skills", "zhixia-local-docs", "scripts", "read-project-knowledge.cjs");

function runHelper(workspace, args) {
  const output = execFileSync(process.execPath, [helperPath, workspace, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(output);
}

function runHelperFailure(workspace, args) {
  assert.throws(
    () => execFileSync(process.execPath, [helperPath, workspace, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: "pipe",
    }),
    /must stay inside the requested workspace/,
  );
}

function writeFixture(workspace) {
  const bundleDir = path.join(workspace, ".codex-knowledge");
  const docsDir = path.join(workspace, "docs");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(
    path.join(docsDir, "REFMUSE_GAME_STUDIO_CEO_RECOVERY_PACKET.md"),
    "# Refmuse Game Studio CEO Recovery\n\n中文恢复摘要：旧 CEO 线程坏掉后，新线程先读这里继续项目。",
    "utf8",
  );
  fs.writeFileSync(
    path.join(docsDir, "REFMUSE_GAME_STUDIO_CEO_TRANSCRIPT_EXTRACT.md"),
    `# Giant Transcript Pointer\n\n${"transcript filler\n".repeat(60000)}DO_NOT_READ_TRANSCRIPT_TAIL`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(docsDir, "PRD.md"),
    "# PRD\n\nRefmuse game studio 是一个 2D 游戏与插件平台项目。",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "retrieval-packet.md"),
    [
      "# Retrieval Packet",
      "",
      "## Alpha Dispatch",
      "",
      "Alpha runtime context should stay compact.",
      "Source pointer: C:/Users/example/.codex/sessions/2026/06/19/raw-session.jsonl",
      `Inline image: data:image/png;base64,${"A".repeat(260)}`,
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "knowledge-items.md"),
    "# Knowledge\n\n## Alpha Contract\n\nAlpha accepted contract rule with source-backed retrieval.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "experience-cards.md"),
    "# Experience\n\n## Alpha Prior Fix\n\nAccepted lesson: keep helper output bounded and metadata-first.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "tool-skill-inventory.md"),
    "# Tools\n\n## Alpha Tool\n\nTool candidate for reading compact project knowledge. Forbidden: install or execute automatically.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "project-artifacts.md"),
    "# Artifacts\n\n## Alpha Test Plan\n\nCurrent test plan source pointer for review.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(bundleDir, "project-knowledge.md"),
    `${"# Giant Compatibility File\n\n".repeat(20)}${"safe filler\n".repeat(30000)}DO_NOT_READ_GIANT_TAIL alpha`,
    "utf8",
  );
}

function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-helper-"));
  const siblingEscape = `${workspace}-escape`;
  try {
    writeFixture(workspace);
    fs.mkdirSync(siblingEscape, { recursive: true });

    const legacy = runHelper(workspace, ["--query", "alpha", "--limit", "3", "--json"]);
    assert.equal(legacy.provider, "zhixia_local_docs", "legacy helper JSON should keep provider");
    assert.equal(legacy.mode, "file_contract", "legacy --query --limit --json should keep file_contract mode");
    assert.ok(Array.isArray(legacy.results), "legacy helper output should preserve results[]");
    assert.ok(legacy.items.length <= 3, "legacy helper should honor limit");
    const legacyText = JSON.stringify(legacy);
    assert.doesNotMatch(legacyText, /\.codex[\\/]sessions/i, "default output must redact raw session paths");
    assert.doesNotMatch(legacyText, /A{120}/, "default output must redact base64-like payloads");
    assert.doesNotMatch(legacyText, /DO_NOT_READ_GIANT_TAIL/, "helper must not read giant Markdown tail content by default");
    assert.ok(legacy.warnings.some((warning) => /exceeded/.test(warning)), "giant bundle files should produce bounded-read warning");

    const context = runHelper(workspace, [
      "--runtime-context",
      "--task-goal",
      "alpha dispatch implementation",
      "--query-type",
      "task_dispatch",
      "--limit",
      "4",
      "--json",
    ]);
    assert.equal(context.schemaVersion, 1, "runtime context should be schema v1");
    assert.equal(context.mode, "runtime_context_packet", "runtime context mode should be explicit");
    assert.equal(context.request.taskGoal, "alpha dispatch implementation");
    assert.ok(context.items.length > 0, "runtime context should return compact items");
    assert.ok(context.items.every((item) => item.rawSessionPolicy === "not_allowed"), "runtime context must forbid raw-session defaults");
    assert.ok(context.sourceRefs.length > 0, "runtime context should preserve sourceRefs");

    const recovery = runHelper(workspace, [
      "--recover-thread",
      "--thread-id",
      "public-thread-id",
      "--thread-title",
      "Refmuse game Studio CEO",
      "--query",
      "alpha refmuse recovery",
      "--limit",
      "5",
      "--json",
    ]);
    assert.equal(recovery.schemaVersion, "zhixia.thread_recovery_packet.v1", "helper should expose ThreadRecoveryPacket schema");
    assert.equal(recovery.mode, "thread_recovery_packet", "helper recovery mode should be explicit");
    assert.equal(recovery.thread.threadId, "public-thread-id", "recovery packet should preserve target threadId");
    assert.equal(recovery.vault.policy, "helper_metadata_only_no_vault_walk", "helper recovery must not walk Thread History Vault");
    assert.equal(recovery.performance.rawSessionBodyRead, false, "helper recovery must not read raw session bodies");
    assert.equal(recovery.performance.startsTimers, false, "helper recovery must not start background timers");
    assert.equal(recovery.safety.archiveCompactDeleteMoveRestore, false, "helper recovery must not archive/compact/delete/move/restore");
    assert.ok(recovery.recommendedReadOrder.some((item) => /REFMUSE_GAME_STUDIO_CEO_RECOVERY_PACKET\.md$/.test(item.path)), "recovery should recommend local recovery docs");
    assert.equal(
      recovery.recommendedReadOrder.some((item) => /REFMUSE_GAME_STUDIO_CEO_TRANSCRIPT_EXTRACT\.md$/.test(item.path)),
      false,
      "giant transcript documents must not be recommended for default reading",
    );
    assert.ok(
      recovery.coldHistorySources.some((item) => /REFMUSE_GAME_STUDIO_CEO_TRANSCRIPT_EXTRACT\.md$/.test(item.path) && item.kind === "large_project_artifact_pointer"),
      "giant transcript documents should remain as cold pointers",
    );
    assert.ok(recovery.warnings.includes("large_recovery_docs_pointer_only"), "giant recovery docs should produce pointer-only warning");
    assert.ok(recovery.context.items.length > 0, "recovery should include compact runtime context items");
    assert.ok(recovery.prompt.includes("不要直接加载原始"), "recovery prompt should warn against loading raw sessions");
    const recoveryText = JSON.stringify(recovery);
    assert.doesNotMatch(recoveryText, /\.codex[\\/]sessions/i, "recovery helper must not leak raw session paths from knowledge excerpts");
    assert.doesNotMatch(recoveryText, /A{120}/, "recovery helper must not leak base64-like payloads");
    assert.doesNotMatch(recoveryText, /DO_NOT_READ_GIANT_TAIL/, "recovery helper must not read giant Markdown tail content");
    assert.doesNotMatch(recoveryText, /DO_NOT_READ_TRANSCRIPT_TAIL/, "recovery helper must not read giant transcript content");

    const precedent = runHelper(workspace, ["--precedent", "alpha", "--limit", "5", "--json"]);
    assert.equal(precedent.mode, "runtime_precedent_packet", "precedent mode should be explicit");
    assert.equal(precedent.precedentPolicy.rawSessionDefaultRead, false, "precedent should declare no raw session default read");
    assert.equal(precedent.precedentPolicy.giantMarkdownDefaultRead, false, "precedent should declare no giant Markdown default read");
    assert.ok(
      precedent.items.every((item) => ["knowledge_item", "experience_card", "project_artifact", "tool_skill_record", "skill_candidate"].includes(item.kind)),
      "precedent should stay within bounded metadata-first kinds",
    );

    const evidencePath = path.join(workspace, "evidence.json");
    const siblingEvidencePath = path.join(siblingEscape, "evidence.json");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        decision: "accept",
        task: { id: "TASK-ALPHA", goal: "Accept helper lifecycle", domain: ["memory-runtime"] },
        evidence: {
          summary: "Helper produced compact lifecycle packets.",
          reusablePattern: ["Use runtime helper modes before dispatch and after acceptance."],
          tests: ["node tests/zhixia-local-docs-helper.test.cjs"],
          sourceRefs: [{ kind: "project_artifact", path: path.join(workspace, "docs", "TEST_PLAN.md"), title: "Test plan" }],
        },
        privacy: { containsRawSession: false, containsSecrets: false, publicCandidateAllowed: false },
      }),
      "utf8",
    );
    fs.writeFileSync(siblingEvidencePath, JSON.stringify({ decision: "accept" }), "utf8");
    const writeback = runHelper(workspace, [
      "--writeback-dry-run",
      "--evidence-json",
      evidencePath,
      "--evidence-out",
      ".codex-knowledge/writeback-preview.json",
      "--json",
    ]);
    assert.equal(writeback.mode, "evidence_writeback_packet_dry_run", "writeback helper should generate dry-run evidence packet");
    assert.equal(writeback.receiptPreview.runsFlowSkill, false, "writeback dry-run must not run FlowSkill");
    assert.equal(writeback.receiptPreview.installsOrExecutes, false, "writeback dry-run must not install or execute");
    assert.equal(writeback.receiptPreview.archiveCompactDeleteMoveRestore, false, "writeback dry-run must not archive/compact/delete/move/restore");
    assert.equal(writeback.writeback.flowSkillCandidate?.visibility, "private", "accepted reusable evidence should preview a private candidate");
    assert.equal(writeback.writeback.flowSkillCandidate?.status, "private_review", "accepted reusable evidence should stay review-only");
    assert.equal(writeback.writeback.flowSkillCandidate?.effects.runsFlowSkill, false, "candidate preview must not run FlowSkill");
    assert.equal(writeback.writeback.flowSkillCandidate?.promotion.captureDryRunOnly, true, "candidate preview must stay dry-run only");
    assert.ok(fs.existsSync(path.join(workspace, ".codex-knowledge", "writeback-preview.json")), "writeback preview may be written inside workspace only");

    const noSourceEvidencePath = path.join(workspace, "evidence-nosource.json");
    fs.writeFileSync(
      noSourceEvidencePath,
      JSON.stringify({
        decision: "accept",
        task: { id: "TASK-NOSOURCE", goal: "No source helper evidence", domain: ["memory-runtime"] },
        evidence: {
          summary: "Accepted reusable evidence without source refs.",
          reusablePattern: ["Do not preview FlowSkill candidate without source refs."],
        },
      }),
      "utf8",
    );
    const noSourceWriteback = runHelper(workspace, ["--writeback-dry-run", "--evidence-json", noSourceEvidencePath, "--json"]);
    assert.equal(noSourceWriteback.writeback.flowSkillCandidate, null, "no-source reusable evidence must not preview FlowSkill candidate");
    assert.ok(noSourceWriteback.warnings.includes("missing_source_refs_candidate_only"), "no-source dry-run should warn candidate-only review");
    assert.equal(noSourceWriteback.receiptPreview.status, "dry_run", "no-source dry-run should remain preview-only, not fail as unsafe");

    runHelperFailure(workspace, ["--writeback-dry-run", "--evidence-json", siblingEvidencePath, "--json"]);
    runHelperFailure(workspace, ["--writeback-dry-run", "--evidence-json", path.join("..", path.basename(siblingEscape), "evidence.json"), "--json"]);
    runHelperFailure(workspace, [
      "--writeback-dry-run",
      "--evidence-json",
      evidencePath,
      "--evidence-out",
      path.join(siblingEscape, "writeback-preview.json"),
      "--json",
    ]);
    runHelperFailure(workspace, [
      "--writeback-dry-run",
      "--evidence-json",
      evidencePath,
      "--evidence-out",
      path.join("..", path.basename(siblingEscape), "writeback-preview.json"),
      "--json",
    ]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(siblingEscape, { recursive: true, force: true });
  }
}

main();
console.log("Zhixia local-docs helper lifecycle tests passed.");
