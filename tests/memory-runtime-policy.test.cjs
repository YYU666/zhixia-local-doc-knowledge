const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildRuntimeContextPacket,
  buildRuntimePrecedentPacket,
  buildRuntimePrecedentRequest,
  evaluatePromotionCandidate,
  evaluateWritebackEvidence,
  listFlowSkillCandidateRecords,
  listWorkingMemoryRecords,
  promoteMemoryCandidate,
  upsertWorkingMemoryRecord,
  writeEvidenceWriteback,
} = require("../electron/memoryRuntimePolicy.cjs");

async function main() {
  const retrieveResult = {
    queryType: "task_dispatch",
    query: "implement memory runtime",
    projectPath: "C:/Users/example/Documents/Zhixia-Local-Doc-Knowledge/app",
    parentCeoThreadId: "019e-ceo",
    tokenBudget: 900,
    tokenEstimate: 220,
    generatedAt: "2026-06-19T08:00:00.000Z",
    items: [
      {
        id: "project-record:zhixia",
        kind: "project_record",
        title: "Zhixia Memory Runtime",
        excerpt: "Project state and next action.",
        status: "ready",
        freshness: "fresh",
        whyMatched: ["projectPath:exact"],
        sourceRefs: [{ kind: "project_artifact", path: "docs/TECHNICAL_DESIGN.md", title: "Technical Design" }],
        tokenEstimate: 90,
      },
      {
        id: "raw:bad",
        kind: "raw_session",
        title: "Raw session must not surface",
        excerpt: "raw body",
        sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/raw.jsonl" }],
      },
    ],
  };

  const packet = buildRuntimeContextPacket(retrieveResult, {
    taskGoal: "Implement app-side Memory Runtime contract",
    queryType: "task_dispatch",
    tokenBudget: 900,
    allowedKinds: ["project_record", "knowledge_item", "raw_session"],
  });
  assert.equal(packet.schemaVersion, 1, "RuntimeContextPacket schema should be v1");
  assert.equal(packet.request.taskGoal, "Implement app-side Memory Runtime contract");
  assert.deepEqual(packet.request.allowedKinds, ["project_record", "knowledge_item"], "runtime context must reject raw-session allowed kinds");
  assert.equal(packet.items.length, 1, "runtime context must not surface raw session items");
  assert.equal(packet.items[0].rawSessionPolicy, "not_allowed", "runtime items should default to no raw-session reads");
  assert.equal(packet.sourceRefs.length, 1, "runtime context should collect compact source refs");
  assert.ok(packet.warnings.includes("metadata_first_no_raw_session_body"), "runtime context should declare metadata-first boundary");

  const precedentRequest = buildRuntimePrecedentRequest({
    taskType: "bug repair",
    includeKinds: ["experience_card", "raw_session", "tool_skill_record"],
    tokenBudget: 800,
  });
  assert.equal(precedentRequest.queryType, "retrieve_precedent");
  assert.deepEqual(precedentRequest.includeKinds, ["experience_card", "tool_skill_record"], "precedent retrieval should reject raw-session reads by default");

  const precedent = buildRuntimePrecedentPacket(
    {
      ...retrieveResult,
      queryType: "retrieve_precedent",
      items: [
        {
          id: "experience:accepted-fix",
          kind: "experience_card",
          title: "Accepted fix lesson",
          excerpt: "Use metadata-first retrieval.",
          status: "accepted",
          freshness: "fresh",
          whyMatched: ["accepted evidence"],
          sourceRefs: [{ kind: "experience_card", path: "memory/card.json" }],
          tokenEstimate: 70,
        },
      ],
    },
    { taskType: "bug repair", allowedKinds: precedentRequest.includeKinds },
  );
  assert.equal(precedent.precedentPolicy.rawSessionDefaultRead, false, "precedent packet must declare no raw-session default read");
  assert.equal(precedent.precedentPolicy.giantMarkdownDefaultRead, false, "precedent packet must declare no giant Markdown default read");

  const safeWriteback = {
    decision: "accept",
    task: { id: "TASK-1", goal: "Add contract loop", domain: ["memory-runtime"] },
    evidence: {
      summary: "Implemented compact contract loop.",
      reusablePattern: ["Use pure policy module plus IPC wrapper."],
      sourceRefs: [{ kind: "project_artifact", path: "electron/memoryRuntimePolicy.cjs", title: "policy" }],
    },
    privacy: { containsRawSession: false, containsSecrets: false, publicCandidateAllowed: false },
  };
  const safeEvaluation = evaluateWritebackEvidence(safeWriteback);
  assert.equal(safeEvaluation.status, "queued", "source-backed safe accepted evidence should be queued");
  assert.equal(safeEvaluation.candidates[0].kind, "flowskill_candidate", "accepted reusable evidence should queue FlowSkill candidate metadata only");
  assert.equal(safeEvaluation.candidates[0].status, "private_review", "FlowSkill candidate should stay private review by default");
  assert.equal(safeEvaluation.candidates[0].requiresHumanConfirmation, true, "FlowSkill candidate must require confirmation");
  assert.equal(safeEvaluation.candidates[0].readyPacket.effects.runsFlowSkill, false, "FlowSkill-ready packet must not run FlowSkill");
  assert.equal(safeEvaluation.candidates[0].readyPacket.visibility, "private", "FlowSkill-ready packet must be private");

  const noSourceEvaluation = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-2", goal: "No source" },
    evidence: {
      summary: "Claim without source refs.",
      reusablePattern: ["This reusable pattern is not source-backed."],
    },
    privacy: { containsRawSession: false, containsSecrets: false },
  });
  assert.equal(noSourceEvaluation.status, "candidate_review", "writeback without source refs should downgrade to candidate review");
  assert.equal(noSourceEvaluation.candidates.some((candidate) => candidate.kind === "flowskill_candidate"), false, "no-source reusable evidence must not create FlowSkill-ready candidates");

  const unsafeEvaluation = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-3", goal: "Unsafe" },
    evidence: {
      summary: "Contains raw session body.",
      sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/raw.jsonl" }],
    },
    action: "install skill and archive thread",
    privacy: { containsRawSession: true, containsSecrets: false },
  });
  assert.equal(unsafeEvaluation.status, "rejected", "unsafe writeback should be rejected");
  assert.ok(unsafeEvaluation.safetyBlockers.includes("contains_raw_session"), "raw-session evidence should be a blocker");
  assert.ok(unsafeEvaluation.safetyBlockers.includes("destructive_or_executable_intent"), "install/archive intent should be a blocker");

  const rawSourceRefWithoutPrivacy = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-4", goal: "Raw ref without privacy flags" },
    evidence: {
      summary: "Compact claim with source ref only.",
      sourceRefs: [{ kind: "project_artifact", path: "C:/Users/example/.codex/sessions/2026/06/19/thread-session.jsonl", title: "session JSONL" }],
    },
    privacy: { containsRawSession: false, containsSecrets: false },
  });
  assert.equal(rawSourceRefWithoutPrivacy.status, "rejected", "raw-session sourceRefs should fail closed even when privacy flags are false");
  assert.ok(rawSourceRefWithoutPrivacy.safetyBlockers.includes("contains_raw_session"), "raw-session sourceRef should infer contains_raw_session");

  const secretSourceRefWithoutPrivacy = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-5", goal: "Secret ref without privacy flags" },
    evidence: {
      summary: "Compact claim with secret source ref.",
      sourceRefs: [{ kind: "project_artifact", path: "C:/repo/.env.local", title: "API key settings" }],
    },
  });
  assert.equal(secretSourceRefWithoutPrivacy.status, "rejected", "secret-like sourceRefs should fail closed even when privacy flags are omitted");
  assert.ok(secretSourceRefWithoutPrivacy.safetyBlockers.includes("contains_secrets"), "secret sourceRef should infer contains_secrets");

  const harmlessSessionProse = evaluateWritebackEvidence({
    decision: "accept",
    task: { id: "TASK-6", goal: "Harmless prose" },
    evidence: {
      summary: "The release notes mention session history and archive policy as prose.",
      reusablePattern: ["Keep safety checks scoped to source refs and action fields."],
      sourceRefs: [{ kind: "project_artifact", path: "docs/RELEASE_NOTES.md", title: "Release notes" }],
    },
  });
  assert.equal(harmlessSessionProse.status, "queued", "harmless prose mentioning session/archive should not trip raw/destructive blockers");

  const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zhixia-memory-runtime-"));
  try {
    const receipt = await writeEvidenceWriteback(storeRoot, safeWriteback);
    assert.equal(receipt.status, "queued", "writeback should persist queued receipt");
    assert.equal(receipt.candidateCount, 1, "writeback receipt should count candidate metadata");
    assert.equal(receipt.flowSkillCandidateCount, 1, "writeback receipt should count FlowSkill-ready candidates");
    const repeatedReceipt = await writeEvidenceWriteback(storeRoot, safeWriteback);
    assert.equal(repeatedReceipt.id, receipt.id, "repeated same writeback should be idempotent by receipt id");
    assert.equal(repeatedReceipt.hash, receipt.hash, "repeated same writeback should keep stable input hash");
    const written = JSON.parse(await fs.readFile(receipt.storagePath, "utf8"));
    assert.equal(written.policy.installsOrExecutesSkills, false, "writeback storage must preserve no skill execution boundary");
    assert.equal(written.policy.archiveCompactDeleteMoveRestore, false, "writeback storage must preserve no archive/compact boundary");
    const flowSkillCandidates = await listFlowSkillCandidateRecords(storeRoot, { limit: 20 });
    assert.equal(flowSkillCandidates.length, 1, "repeated same writeback should not duplicate FlowSkill candidate records");
    const flowSkillCandidate = flowSkillCandidates[0];
    assert.equal(flowSkillCandidate.kind, "flowskill_candidate", "FlowSkill candidate record should declare kind");
    assert.equal(flowSkillCandidate.status, "private_review", "FlowSkill candidate record must remain private review");
    assert.equal(flowSkillCandidate.promotion.requiresUserConfirmation, true, "FlowSkill candidate record must require confirmation");
    assert.equal(flowSkillCandidate.effects.installsOrExecutes, false, "FlowSkill candidate record must not install or execute");
    assert.equal(flowSkillCandidate.effects.exportsPublicly, false, "FlowSkill candidate record must not export publicly");
    assert.equal(flowSkillCandidate.effects.archiveCompactDeleteMoveRestore, false, "FlowSkill candidate record must not archive/compact/delete/move/restore");
    assert.equal(flowSkillCandidate.effects.mutatesRawSession, false, "FlowSkill candidate record must not mutate raw sessions");
    assert.ok(flowSkillCandidate.hash, "FlowSkill candidate record should have stable hash");
    assert.ok(flowSkillCandidate.tokenEstimate > 0, "FlowSkill candidate record should include token estimate");
    assert.deepEqual(flowSkillCandidate.evidence.reusablePattern, ["Use pure policy module plus IPC wrapper."], "FlowSkill candidate should preserve compact reusable pattern");

    const noSourceReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "accept",
      task: { id: "TASK-NOSOURCE", goal: "No-source reusable evidence", domain: ["memory-runtime"] },
      evidence: {
        summary: "Reusable but not source-backed.",
        reusablePattern: ["Do not create FlowSkill-ready candidate without source refs."],
      },
    });
    assert.equal(noSourceReceipt.status, "candidate_review", "no-source reusable writeback should remain candidate review");
    assert.ok(noSourceReceipt.warnings.includes("missing_source_refs_candidate_only"), "no-source reusable writeback should keep missing source warning");
    assert.equal(noSourceReceipt.flowSkillCandidateCount, 0, "no-source reusable writeback must not create FlowSkill-ready records");
    assert.equal((await listFlowSkillCandidateRecords(storeRoot, { limit: 20 })).length, 1, "no-source reusable writeback should not add FlowSkill-ready records");

    const reviseReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "revise",
      task: { id: "TASK-REVISE", goal: "Revise path", domain: ["memory-runtime"] },
      evidence: {
        summary: "Needs correction.",
        reusablePattern: ["Do not turn revise into FlowSkill."],
        failurePattern: ["Review found missing guardrail."],
        sourceRefs: [{ kind: "project_artifact", path: "tests/review.md", title: "review" }],
      },
    });
    assert.equal(reviseReceipt.flowSkillCandidateCount, 0, "revise writeback must not create FlowSkill-ready candidates by default");
    assert.equal((await listFlowSkillCandidateRecords(storeRoot, { limit: 20 })).length, 1, "revise writeback should not add FlowSkill-ready records");

    const unsafeReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "accept",
      task: { id: "TASK-RAW", goal: "Unsafe raw candidate", domain: ["memory-runtime"] },
      evidence: {
        summary: "Unsafe raw source.",
        reusablePattern: ["Never capture raw session into FlowSkill."],
        sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/2026/06/19/thread.jsonl" }],
      },
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(unsafeReceipt.status, "rejected", "raw-session writeback should reject before FlowSkill candidate creation");
    assert.equal(unsafeReceipt.flowSkillCandidateCount, 0, "raw-session writeback must not create FlowSkill candidate records");

    const destructiveReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "accept",
      task: { id: "TASK-DESTRUCTIVE", goal: "Unsafe destructive request", domain: ["memory-runtime"] },
      evidence: {
        summary: "Unsafe requested effect.",
        reusablePattern: ["Never execute or archive from candidate bridge."],
        sourceRefs: [{ kind: "project_artifact", path: "docs/TECHNICAL_DESIGN.md" }],
      },
      requestedEffect: "install skill then archive thread",
    });
    assert.equal(destructiveReceipt.status, "rejected", "destructive/public execution intent should reject before FlowSkill candidate creation");
    assert.equal(destructiveReceipt.flowSkillCandidateCount, 0, "destructive writeback must not create FlowSkill candidate records");

    const working = await upsertWorkingMemoryRecord(storeRoot, {
      taskId: "TASK-1",
      status: "active",
      currentGoal: "Wire runtime IPC",
      currentEvidence: [{ kind: "project_artifact", path: "electron/main.cjs" }],
      decisions: ["Use JSON app-owned inbox."],
      openRisks: ["UI remains minimal."],
      nextAction: "Run tests.",
    });
    assert.equal(working.status, "active", "working memory upsert should persist active status");
    const listed = await listWorkingMemoryRecords(storeRoot, { status: "active" });
    assert.equal(listed.length, 1, "working memory list should filter by active status");
    const closed = await upsertWorkingMemoryRecord(storeRoot, { ...working, status: "accepted" });
    assert.equal(closed.status, "accepted", "working memory can be closed to accepted");

    const safePromotion = await promoteMemoryCandidate(storeRoot, {
      target: "experience_card",
      title: "Source-backed local lesson",
      summary: "Useful private memory candidate.",
      sourceRefs: [{ kind: "experience_card", path: "memory/card.json" }],
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(safePromotion.status, "queued_candidate", "safe source-backed promotion should queue candidate metadata");
    assert.equal(safePromotion.effects.installsOrExecutes, false, "promotion must not install or execute");

    const unsafePromotion = evaluatePromotionCandidate({
      target: "flowskill_candidate",
      title: "Public export request",
      sourceRefs: [{ kind: "experience_card", path: "memory/card.json" }],
      action: "execute and publish",
      privacy: { publicExportRequested: true, containsRawSession: true },
    });
    assert.equal(unsafePromotion.status, "review", "unsafe promotion should stay in review");
    assert.ok(unsafePromotion.blockers.includes("contains_raw_session"), "promotion should block raw-session candidates");
    assert.ok(unsafePromotion.blockers.includes("public_export_requires_confirmation"), "promotion should block public export automation");
    assert.equal(unsafePromotion.effects.exportsPublicly, false, "promotion must never export publicly in this slice");

    const rawPromotionWithoutPrivacy = evaluatePromotionCandidate({
      target: "experience_card",
      title: "Raw session backed candidate",
      sourceRefs: [{ kind: "raw_session", path: "C:/Users/example/.codex/sessions/2026/06/19/thread.jsonl" }],
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(rawPromotionWithoutPrivacy.status, "review", "raw-session promotion should stay review even when privacy flags are false");
    assert.ok(rawPromotionWithoutPrivacy.blockers.includes("contains_raw_session"), "promotion should infer raw-session blocker from sourceRefs");

    const secretPromotionWithoutPrivacy = evaluatePromotionCandidate({
      target: "memory_card",
      title: "Credential backed candidate",
      sourceRefs: [{ kind: "project_artifact", path: "C:/repo/credentials.json", title: "credential fixture" }],
      requestedEffect: "promote token evidence",
    });
    assert.equal(secretPromotionWithoutPrivacy.status, "review", "secret promotion should stay review even when privacy flags are omitted");
    assert.ok(secretPromotionWithoutPrivacy.blockers.includes("contains_secrets"), "promotion should infer secret blocker from refs or action fields");
  } finally {
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("Memory Runtime policy tests passed.");
});
