const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildRuntimeContextPacket,
  buildRuntimeItemsFromVolatileMemory,
  buildRuntimePrecedentPacket,
  buildRuntimePrecedentRequest,
  listFlowSkillCandidateRecords,
  listRuntimeEventRecords,
  listWorkingMemoryRecords,
  upsertWorkingMemoryRecord,
  writeRuntimeEventMemory,
  writeEvidenceWriteback,
} = require("../electron/memoryRuntimePolicy.cjs");

const FORBIDDEN_EFFECTS = [
  "runsFlowSkill",
  "installsOrExecutes",
  "exportsPublicly",
  "archiveCompactDeleteMoveRestore",
  "mutatesRawSession",
];

const SENTINELS = {
  base64Payload: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0123456789".repeat(5),
  secretToken: "ZHIXIA_SECRET_TOKEN_SHOULD_NOT_LEAK",
  privateKey: "ZHIXIA_PRIVATE_KEY_SHOULD_NOT_LEAK",
  longLog: "ZHIXIA_LONG_LOG_SENTINEL_SHOULD_NOT_LEAK",
  rawSessionBody: "ZHIXIA_RAW_SESSION_BODY_SHOULD_NOT_LEAK",
};

function assertNoUnsafePayload(packet, giantTail) {
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /"kind":"raw_session"/, "default lifecycle packets must not include raw_session items");
  assert.doesNotMatch(serialized, /\.codex[\\/]sessions/i, "default lifecycle packets must not include raw session paths");
  assert.equal(serialized.includes(giantTail), false, "default lifecycle packets must not leak giant Markdown tails");
  assert.equal(serialized.includes(SENTINELS.base64Payload), false, "default lifecycle packets must not leak base64-like payloads");
  assert.equal(serialized.includes(SENTINELS.secretToken), false, "default lifecycle packets must not leak credential/token sentinel values");
  assert.equal(serialized.includes(SENTINELS.privateKey), false, "default lifecycle packets must not leak private-key sentinel values");
  assert.equal(serialized.includes(SENTINELS.longLog), false, "default lifecycle packets must not leak long-log sentinel tails");
  assert.equal(serialized.includes(SENTINELS.rawSessionBody), false, "default lifecycle packets must not leak raw-session body sentinels");
}

function assertNoForbiddenCandidateEffects(candidate) {
  for (const key of FORBIDDEN_EFFECTS) {
    assert.equal(candidate.effects?.[key], false, `FlowSkill candidate effect ${key} must remain false`);
  }
  assert.equal(candidate.promotion?.captureDryRunOnly, true, "FlowSkill candidate must stay dry-run/review only");
  assert.equal(candidate.promotion?.publicExportAutomatic, false, "FlowSkill candidate must not public-export automatically");
  assert.equal(candidate.promotion?.installExecuteAutomatic, false, "FlowSkill candidate must not install or execute automatically");
}

async function main() {
  const giantTail = "GIANT_MARKDOWN_TAIL_SHOULD_NOT_LEAK_IN_RUNTIME_PACKET";
  const giantMarkdown = `${"Very large generated Markdown body. ".repeat(300)}${giantTail}`;
  const unsafeCompactFixtureText = [
    `api_key=${SENTINELS.secretToken}`,
    `data:text/plain;base64,${SENTINELS.base64Payload}`,
    `${"runtime log line ".repeat(220)}${SENTINELS.longLog} -----BEGIN PRIVATE KEY----- ${SENTINELS.privateKey}`,
  ].join(" ");
  const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zhixia-memory-runtime-lifecycle-"));

  try {
    const retrieveResult = {
      queryType: "task_dispatch",
      query: "Memory Runtime lifecycle probe",
      projectPath: storeRoot,
      parentCeoThreadId: "11111111-2222-7333-8444-555555555555",
      tokenBudget: 900,
      generatedAt: "2026-06-19T10:00:00.000Z",
      warnings: ["fixture_metadata_only"],
      items: [
        {
          id: "project:zhixia-runtime",
          kind: "project_record",
          title: "Zhixia Memory Runtime",
          summary: "Local-first project memory runtime with bounded contract hooks.",
          status: "ready",
          freshness: "fresh",
          whyMatched: ["projectPath:fixture"],
          sourceRefs: [{ kind: "project_artifact", path: "docs/TECHNICAL_DESIGN.md", title: "Technical Design" }],
          tokenEstimate: 110,
        },
        {
          id: "knowledge:contract",
          kind: "knowledge_item",
          title: "Contract boundary",
          body: `${unsafeCompactFixtureText} ${giantMarkdown}`,
          status: "curated",
          freshness: "fresh",
          whyMatched: ["taskGoal:memory-runtime"],
          sourceRefs: [
            {
              kind: "knowledge_item",
              path: ".codex-knowledge/knowledge-items.json",
              title: "Knowledge metadata fixture",
              hash: "knowledge-hash",
            },
          ],
          tokenEstimate: 2000,
        },
        {
          id: "raw-session-fixture",
          kind: "raw_session",
          title: "Raw Codex session fixture",
          body: `This raw session body must never be read by default. ${SENTINELS.rawSessionBody}`,
          sourceRefs: [{ kind: "raw_session", path: "fixtures/.codex/sessions/2026/06/19/thread.jsonl" }],
          tokenEstimate: 5000,
        },
        {
          id: "knowledge:raw-backed-allowed-kind",
          kind: "knowledge_item",
          title: "Raw-backed allowed kind fixture",
          body: `Allowed kind carrying raw session source must still be rejected. ${SENTINELS.rawSessionBody}`,
          sourceRefs: [{ kind: "raw_session", path: "fixtures/.codex/sessions/raw-backed-knowledge.jsonl" }],
          tokenEstimate: 100,
        },
      ],
    };

    const contextPacket = buildRuntimeContextPacket(retrieveResult, {
      taskGoal: "Prove the integrated Memory Runtime loop",
      queryType: "task_dispatch",
      tokenBudget: 900,
      allowedKinds: ["project_record", "knowledge_item", "raw_session"],
    });

    assert.equal(contextPacket.schemaVersion, 1, "context packet should use schema v1");
    assert.equal(contextPacket.request.queryType, "task_dispatch", "context packet should preserve queryType");
    assert.equal(contextPacket.items.length, 2, "context packet should include only safe runtime items");
    assert.equal(contextPacket.items.some((item) => item.kind === "raw_session"), false, "context packet must exclude raw session items");
    assert.equal(contextPacket.items.every((item) => item.rawSessionPolicy === "not_allowed"), true, "context items must forbid raw-session reads by default");
    assert.equal(contextPacket.routerPlan.strategy, "hot_warm_cold_metadata_first", "context packet should include MemoryRouter plan");
    assert.equal(contextPacket.routerPlan.backgroundPolicy.startsTimers, false, "MemoryRouter must not start timers during lifecycle retrieval");
    assert.equal(contextPacket.performance.noFullTextRead, true, "MemoryRouter packet should declare no full text read");
    assert.equal(contextPacket.performance.boundedByRouterPlan, true, "MemoryRouter packet should declare router-bounded retrieval");
    assert.equal(contextPacket.performance.noVaultScan, true, "MemoryRouter packet should declare no vault scan");
    assert.ok(contextPacket.hotState?.activeItemIds?.length >= 1, "context packet should seed compact hot state");
    assert.ok(contextPacket.memoryGraph?.nodes?.length >= 1, "context packet should include bounded memory graph nodes");
    assert.ok(contextPacket.memoryGraph?.edges?.length >= 1, "context packet should include bounded memory graph edges");
    assert.ok(contextPacket.sourceRefs.length >= 2, "context packet should preserve compact source refs");
    assert.ok(contextPacket.items.every((item) => ["fresh", "unknown", "review"].includes(item.freshness)), "context packet should carry freshness signals");
    assert.ok(contextPacket.tokenEstimate <= contextPacket.request.tokenBudget, "context token estimate should stay within budget");
    assert.ok(contextPacket.warnings.includes("metadata_first_no_raw_session_body"), "context packet should declare metadata-first raw-session boundary");
    assertNoUnsafePayload(contextPacket, giantTail);

    const precedentRequest = buildRuntimePrecedentRequest({
      taskType: "memory runtime lifecycle",
      includeKinds: ["experience_card", "tool_skill_record", "skill_candidate", "raw_session"],
      tokenBudget: 800,
      maxResults: 4,
    });
    assert.equal(precedentRequest.queryType, "retrieve_precedent", "precedent request should use retrieve_precedent");
    assert.equal(precedentRequest.includeKinds.includes("raw_session"), false, "precedent request must reject raw sessions by default");
    assert.equal(precedentRequest.routerPlan.backgroundPolicy.scansFullDatabase, false, "precedent router must not scan full database");

    const precedentPacket = buildRuntimePrecedentPacket(
      {
        ...retrieveResult,
        queryType: "retrieve_precedent",
        tokenBudget: 800,
        items: [
          {
            id: "experience:accepted-source-backed-pattern",
            kind: "experience_card",
            title: "Accepted source-backed reusable evidence",
            excerpt: "Source-backed accepted evidence can queue a private review-only FlowSkill candidate.",
            status: "curated",
            freshness: "fresh",
            whyMatched: ["accepted reusable pattern"],
            sourceRefs: [{ kind: "experience_card", path: ".codex-knowledge/experience-cards.json", hash: "experience-hash" }],
            tokenEstimate: 95,
          },
          {
            id: "tool:helper",
            kind: "tool_skill_record",
            title: "zhixia-local-docs helper lifecycle mode",
            summary: `Helper exposes compact runtime context and dry-run evidence packet preview. ${unsafeCompactFixtureText}`,
            status: "review",
            freshness: "review",
            whyMatched: ["tool inventory"],
            sourceRefs: [
              {
                kind: "tool_skill_record",
                path: ".codex-knowledge/tool-skill-inventory.json",
                title: "Tool metadata fixture",
                hash: "tool-hash",
              },
            ],
            tokenEstimate: 85,
          },
          {
            id: "raw-precedent",
            kind: "raw_session",
            title: "Raw precedent fixture",
            body: `${SENTINELS.rawSessionBody} ${giantMarkdown}`,
            sourceRefs: [{ kind: "raw_session", path: "fixtures/.codex/sessions/raw-precedent.jsonl" }],
          },
        ],
      },
      {
        taskType: "memory runtime lifecycle",
        allowedKinds: precedentRequest.includeKinds,
        tokenBudget: 800,
      },
    );

    assert.equal(precedentPacket.request.queryType, "retrieve_precedent", "precedent packet should preserve retrieve_precedent type");
    assert.equal(precedentPacket.items.length, 2, "precedent packet should stay bounded to metadata-first safe items");
    assert.equal(precedentPacket.precedentPolicy.metadataFirst, true, "precedent packet should declare metadata-first policy");
    assert.equal(precedentPacket.precedentPolicy.rawSessionDefaultRead, false, "precedent packet must not read raw sessions by default");
    assert.equal(precedentPacket.precedentPolicy.giantMarkdownDefaultRead, false, "precedent packet must not read giant Markdown by default");
    assert.equal(precedentPacket.precedentPolicy.memoryRouter, "hot_warm_cold_metadata_first", "precedent packet should advertise MemoryRouter strategy");
    assert.equal(precedentPacket.routerPlan.backgroundPolicy.scansVault, false, "precedent MemoryRouter must not scan vaults");
    assertNoUnsafePayload(precedentPacket, giantTail);

    const activeWorkingMemory = await upsertWorkingMemoryRecord(storeRoot, {
      taskId: "ZHIXIA-LIFECYCLE-PROBE",
      projectPath: storeRoot,
      status: "active",
      currentGoal: "Exercise retrieve, precedent, working memory, writeback, and private candidate listing.",
      currentEvidence: [{ kind: "project_artifact", path: "tests/memory-runtime-lifecycle-e2e.test.cjs" }],
      decisions: ["Use policy helpers and temp app-owned storage only."],
      openRisks: ["No Electron IPC process is launched by this pure policy probe."],
      nextAction: "Write accepted evidence and inspect candidate queue.",
    });
    assert.equal(activeWorkingMemory.status, "active", "working memory should start active");
    assert.equal((await listWorkingMemoryRecords(storeRoot, { status: "active" })).length, 1, "active working memory should be listable");

    const acceptedWorkingMemory = await upsertWorkingMemoryRecord(storeRoot, {
      ...activeWorkingMemory,
      status: "accepted",
      nextAction: "Lifecycle probe accepted.",
    });
    assert.equal(acceptedWorkingMemory.status, "accepted", "working memory should close to accepted");
    assert.equal((await listWorkingMemoryRecords(storeRoot, { status: "active" })).length, 0, "accepted working memory should leave active list");
    assert.equal((await listWorkingMemoryRecords(storeRoot, { status: "accepted" })).length, 1, "accepted working memory should be listable");

    const brokenThreadEventReceipt = await writeRuntimeEventMemory(storeRoot, {
      eventType: "heartbeat_fuse",
      severity: "error",
      projectPath: storeRoot,
      threadId: "11111111-2222-7333-8444-555555555555",
      automationId: "example-ceo-harvest-post-43-wave",
      title: "Example Project CEO heartbeat 熔断",
      summary: "旧 CEO 线程连续空转，心跳已暂停，后续应使用 takeover 线程和恢复包。",
      observedSignals: ["systemError", "last_agent_message=null", "stream disconnected before completion"],
      decisions: ["暂停旧 heartbeat。", "不 fork 旧超大 CEO 线程。"],
      openRisks: ["最后一轮 inProgress 可能仍需等待 Codex 结束。"],
      nextAction: "retrieve_context(thread_recovery) 应返回该短期运行记忆。",
      sourceRefs: [
        { kind: "automation", path: ".codex/automations/example-ceo-harvest-post-43-wave/automation.toml" },
        { kind: "raw_session", path: "fixtures/.codex/sessions/example-ceo.jsonl" },
      ],
    });
    assert.equal(brokenThreadEventReceipt.status, "recorded", "runtime event should be recorded in lifecycle probe");
    assert.equal(brokenThreadEventReceipt.workingMemory.status, "blocked", "heartbeat fuse should create blocked short-term memory");
    const storedRuntimeEvent = JSON.parse(await fs.readFile(brokenThreadEventReceipt.storagePath, "utf8"));
    assert.equal(JSON.stringify(storedRuntimeEvent).includes(".codex/sessions"), false, "stored runtime event must not retain raw session paths");
    assert.equal(JSON.stringify(storedRuntimeEvent).includes("raw_session"), false, "stored runtime event must not retain raw session sourceRef kind");
    assert.equal(storedRuntimeEvent.unsafeSourceRefCount, 1, "stored runtime event should keep unsafe ref count only");
    const runtimeEventItems = buildRuntimeItemsFromVolatileMemory({
      events: await listRuntimeEventRecords(storeRoot, { threadId: "11111111-2222-7333-8444-555555555555" }),
      workingMemory: await listWorkingMemoryRecords(storeRoot, { status: "blocked" }),
    });
    const recoveryContextWithEvent = buildRuntimeContextPacket({
      queryType: "thread_recovery",
      query: "recover Example Project CEO takeover",
      projectPath: storeRoot,
      items: runtimeEventItems,
    }, {
      taskGoal: "recover Example Project CEO takeover",
      queryType: "thread_recovery",
      threadId: "11111111-2222-7333-8444-555555555555",
      projectPath: storeRoot,
      allowedKinds: ["runtime_event"],
      tokenBudget: 900,
    });
    assert.equal(recoveryContextWithEvent.items.some((item) => item.kind === "runtime_event"), true, "recovery context should surface runtime event hot memory");
    assert.equal(recoveryContextWithEvent.memoryLayers.hot.count >= 1, true, "runtime event should be hot memory in lifecycle probe");
    assertNoUnsafePayload(recoveryContextWithEvent, giantTail);

    const safeAcceptedWriteback = {
      decision: "accept",
      task: {
        id: "ZHIXIA-LIFECYCLE-PROBE",
        goal: "Prove Memory Runtime lifecycle probe",
        domain: ["memory-runtime", "flowskill-candidate-bridge"],
        projectPath: storeRoot,
        parentCeoThreadId: "11111111-2222-7333-8444-555555555555",
      },
      evidence: {
        summary: [
          "Integrated probe retrieved compact context and precedent, closed working memory, and queued private source-backed FlowSkill candidate metadata.",
          `api_key=${SENTINELS.secretToken}`,
          `data:text/plain;base64,${SENTINELS.base64Payload}`,
          `${"writeback log line ".repeat(120)}${SENTINELS.longLog}`,
          SENTINELS.rawSessionBody,
        ].join(" "),
        reusablePattern: [
          "Use pure Memory Runtime policy helpers with temp app-owned storage to verify the contract loop end to end.",
          "Never preserve credential material in compact candidate outputs.",
        ],
        tests: ["node tests/memory-runtime-lifecycle-e2e.test.cjs"],
        changedFiles: ["tests/memory-runtime-lifecycle-e2e.test.cjs"],
        sourceRefs: [
          {
            kind: "project_artifact",
            path: "tests/memory-runtime-lifecycle-e2e.test.cjs",
            title: "Lifecycle probe source",
            hash: "probe-test-hash",
          },
          { kind: "experience_card", path: ".codex-knowledge/experience-cards.json", title: "Experience card", hash: "experience-hash" },
        ],
      },
      privacy: { containsRawSession: false, containsSecrets: false, publicCandidateAllowed: false },
    };

    const receipt = await writeEvidenceWriteback(storeRoot, safeAcceptedWriteback);
    assert.equal(receipt.status, "queued", "source-backed accepted writeback should be queued");
    assert.equal(receipt.flowSkillCandidateCount, 1, "source-backed accepted reusable evidence should create one FlowSkill-ready private candidate");
    assert.ok(receipt.hash, "writeback receipt should include stable hash");
    assertNoUnsafePayload(receipt, giantTail);
    const writtenWriteback = JSON.parse(await fs.readFile(receipt.storagePath, "utf8"));
    assertNoUnsafePayload(writtenWriteback, giantTail);

    const repeatedReceipt = await writeEvidenceWriteback(storeRoot, safeAcceptedWriteback);
    assert.equal(repeatedReceipt.id, receipt.id, "repeated writeback should be idempotent by receipt id");
    assert.equal(repeatedReceipt.hash, receipt.hash, "repeated writeback should be idempotent by hash");
    assert.equal(repeatedReceipt.flowSkillCandidateCount, 1, "repeated writeback should report the same candidate count");
    assertNoUnsafePayload(repeatedReceipt, giantTail);

    const candidates = await listFlowSkillCandidateRecords(storeRoot, { limit: 10 });
    assert.equal(candidates.length, 1, "candidate listing should remain duplicate-safe after repeated writeback");
    const [candidate] = candidates;
    assert.equal(candidate.kind, "flowskill_candidate", "listed record should be a FlowSkill candidate");
    assert.equal(candidate.status, "private_review", "FlowSkill candidate should stay private_review");
    assert.equal(candidate.visibility, "private", "FlowSkill candidate should remain private");
    assert.ok(candidate.sourceRefs.length > 0, "FlowSkill candidate must be source-backed");
    assert.ok(candidate.evidence?.sourceRefs?.length > 0, "FlowSkill candidate evidence must retain source refs");
    assert.ok(candidate.hash, "FlowSkill candidate should include stable hash");
    assert.ok(candidate.tokenEstimate > 0 && candidate.tokenEstimate < 800, "FlowSkill candidate should stay compact");
    assertNoForbiddenCandidateEffects(candidate);
    assertNoUnsafePayload(candidate, giantTail);

    const noSourceReceipt = await writeEvidenceWriteback(storeRoot, {
      decision: "accept",
      task: { id: "ZHIXIA-LIFECYCLE-NOSOURCE", goal: "No-source reusable evidence", projectPath: storeRoot },
      evidence: {
        summary: "Accepted reusable claim without source refs.",
        reusablePattern: ["This should remain memory review only, not FlowSkill-ready."],
      },
      privacy: { containsRawSession: false, containsSecrets: false },
    });
    assert.equal(noSourceReceipt.status, "candidate_review", "no-source accepted reusable evidence should remain review-only");
    assert.equal(noSourceReceipt.flowSkillCandidateCount, 0, "no-source accepted reusable evidence must not create FlowSkill-ready candidates");
    assert.ok(noSourceReceipt.warnings.includes("missing_source_refs_candidate_only"), "no-source receipt should keep source-backed warning");
    assert.equal((await listFlowSkillCandidateRecords(storeRoot, { limit: 10 })).length, 1, "no-source writeback should not add FlowSkill-ready records");
  } finally {
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("Memory Runtime lifecycle e2e probe passed.");
});
