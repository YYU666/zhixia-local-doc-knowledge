const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const {
  buildUnavailableMemoryCoreContinuity,
  buildUnavailableMemoryCoreDiagnostics,
  buildUnavailableMemoryCoreReviewQueue,
  createMemoryCoreRuntime,
  deriveProjectIdentity,
  loadExistingSigningKey,
  memoryCorePrivateStateExists,
  normalizeLifecycleInput,
} = require("../electron/memoryCoreRuntime.cjs");
const { PROJECT_CONTINUITY_SLOTS } = require("../electron/projectBrainPolicy.cjs");
const { listMemoryFacts, upsertMemoryFact } = require("../electron/memoryRuntimeIndexStore.cjs");

const NOW = "2026-07-16T06:00:00.000Z";

function sourceRef(projectId, moduleId, name) {
  return {
    kind: "focused_test",
    uri: `memory-runtime://focused-test/${encodeURIComponent(projectId)}/${encodeURIComponent(name)}`,
    hash: `hash-${name}`,
    projectId,
    moduleId,
    updatedAt: NOW,
  };
}

function acceptedWriteback(projectPath, moduleId = "module-memory-core", overrides = {}) {
  const projectId = deriveProjectIdentity({ projectPath }).projectId;
  return {
    decision: "accept",
    deterministic: true,
    riskLevel: "low",
    task: {
      id: `task-${projectId}`,
      goal: "Complete the accepted Memory Core lifecycle integration.",
      projectPath,
      projectId,
      moduleId,
    },
    evidence: {
      summary: "The bounded production lifecycle integration passed focused verification.",
      tests: ["Focused lifecycle verification passed."],
      changedFiles: ["electron/memoryCoreRuntime.cjs"],
      sourceRefs: [sourceRef(projectId, moduleId, "memory-core-runtime")],
    },
    observedAt: NOW,
    ...overrides,
  };
}

function candidate(id, projectPath, overrides = {}) {
  return {
    id,
    kind: "knowledge_item",
    projectPath,
    title: id,
    summary: `${id} compact source-backed memory`,
    status: "accepted",
    freshness: "fresh",
    sourceRefs: [{ kind: "document", path: `${projectPath}/docs/${id}.md`, hash: `hash-${id}` }],
    requiresHumanConfirmation: false,
    ...overrides,
  };
}

function main() {
  const cleanRoot = path.join(os.tmpdir(), `zhixia-memory-core-clean-${process.pid}-${Date.now()}`);
  assert.equal(fs.existsSync(cleanRoot), false);
  assert.equal(loadExistingSigningKey(cleanRoot), null);
  assert.equal(memoryCorePrivateStateExists(cleanRoot), false);
  assert.equal(buildUnavailableMemoryCoreDiagnostics({ projectPath: "C:/projects/clean" }).availability, "not_ready");
  assert.equal(buildUnavailableMemoryCoreReviewQueue({ projectPath: "C:/projects/clean" }).count, 0);
  assert.equal(buildUnavailableMemoryCoreContinuity({ projectPath: "C:/projects/clean" }).recoveryReady, false);
  assert.equal(fs.existsSync(cleanRoot), false, "read-only unavailable checks must not create private state");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-memory-core-runtime-"));
  try {
    const alphaPath = "C:/projects/alpha";
    const betaPath = "C:/projects/beta";
    const alphaId = deriveProjectIdentity({ projectPath: alphaPath }).projectId;
    const betaId = deriveProjectIdentity({ projectPath: betaPath }).projectId;
    const compactSourceEvent = normalizeLifecycleInput("writeback_evidence", {
      projectPath: alphaPath,
      projectId: alphaId,
      sourceRefs: [
        { kind: "directory", path: alphaPath, hash: "alpha-root", projectId: alphaId },
        { kind: "document", path: `${alphaPath}/docs/VALID.md`, hash: "alpha-subpath", projectId: alphaId },
        { kind: "document", path: `${alphaPath}-backup/docs/INVALID.md`, hash: "alpha-sibling", projectId: alphaId },
        { kind: "document", path: `${alphaPath}/../beta/docs/INVALID.md`, hash: "alpha-traversal", projectId: alphaId },
        { kind: "document", path: "D:/projects/alpha/docs/INVALID.md", hash: "alpha-cross-drive", projectId: alphaId },
        { kind: "runtime_receipt", uri: "memory-runtime://working-memory/task-alpha", hash: "runtime-uri", projectId: alphaId },
        { kind: "document", path: `${alphaPath}/docs/FOREIGN-ID.md`, hash: "foreign-id", projectId: betaId },
      ],
    }, { now: NOW });
    assert.equal(compactSourceEvent.sourceRefs.length, 3, "runtime source compaction must keep only root/subpath and safe non-file URI refs");
    assert.ok(compactSourceEvent.sourceRefs.some((ref) => ref.path === "memory-runtime://working-memory/task-alpha"), "safe memory-runtime URI must remain valid provenance");
    assert.ok(compactSourceEvent.sourceRefs.every((ref) => ref.projectId === alphaId), "foreign supplied projectId must be rejected rather than overwritten");
    const runtime = createMemoryCoreRuntime({ storeRoot: root, now: NOW });
    const keyPath = path.join(root, "private", "memory-core-authority.key");
    assert.equal(fs.existsSync(keyPath), false, "runtime construction must remain lazy and side-effect free");
    runtime.ensureAuthorityScope({ projectPath: alphaPath, now: NOW });
    const firstKey = fs.readFileSync(keyPath);
    const reloaded = createMemoryCoreRuntime({ storeRoot: root, now: NOW });
    assert.deepEqual(fs.readFileSync(keyPath), firstKey, "the app-owned signing key must persist across runtime composition instances");

    let rankerCalled = false;
    const ranked = runtime.rankAuthorizedCandidates([
      candidate("alpha-authoritative", alphaPath),
      candidate("beta-high-score", betaPath, { score: 999 }),
      candidate("alpha-review", alphaPath, { status: "review", freshness: "review", requiresHumanConfirmation: true }),
    ], "architecture", (authorized) => {
      rankerCalled = true;
      assert.deepEqual(authorized.map((item) => item.id), ["alpha-authoritative"], "authority filtering must run before the relevance ranker");
      return authorized;
    }, { projectPath: alphaPath, queryType: "project_resume" });
    assert.equal(rankerCalled, true);
    assert.equal(ranked.diagnostics.authorityFilterOrder, "before_relevance_ranking");
    assert.ok(ranked.ranked[0].whyRecalled.includes("authority_allowed_before_relevance_ranking"));

    const compact = runtime.decorateRetrievalPacket({
      tokenEstimate: 50,
      items: [{
        ...candidate("compact-item", alphaPath),
        body: "raw giant body must not cross the packet boundary",
        image: `data:image/png;base64,${"A".repeat(500)}`,
        whyMatched: ["source-backed"],
      }],
      sourceRefs: [],
      warnings: [],
    }, ranked.diagnostics);
    const compactJson = JSON.stringify(compact);
    assert.equal(compactJson.includes("raw giant body"), false);
    assert.equal(compactJson.includes("data:image/png;base64"), false);
    assert.deepEqual(compact.items[0].whyRecalled, ["source-backed"]);

    const incompleteContinuity = runtime.getProjectContinuity({ projectPath: alphaPath, tokenBudget: 1800, maxPacketItems: 8, now: NOW });
    assert.equal(incompleteContinuity.recoveryReady, false);
    assert.ok(incompleteContinuity.missing.length > 0);
    assert.equal(incompleteContinuity.principal.role, "service", "normal callers must resolve to a fixed non-owner principal");

    const acceptedInput = acceptedWriteback(alphaPath);
    const rendererFormation = runtime.formLifecycleEvent("writeback_evidence", acceptedInput, { now: NOW });
    assert.equal(rendererFormation.status, "review", "public lifecycle input must never mint accepted authority");
    assert.equal(rendererFormation.receipt, null);
    assert.ok(rendererFormation.reasonCodes.includes("untrusted_lifecycle_provenance_review_required"));
    const firstFormation = runtime.formAppOwnedLifecycleEvent("writeback_evidence", acceptedInput, { now: NOW });
    const secondFormation = runtime.formAppOwnedLifecycleEvent("writeback_evidence", acceptedInput, { now: NOW });
    assert.equal(firstFormation.status, "accepted", JSON.stringify(firstFormation));
    assert.equal(firstFormation.accepted, true);
    assert.equal(firstFormation.preview.status, "review", "phase one must be a non-committing preview");
    assert.equal(firstFormation.receipt.action, "memory_formation");
    assert.equal(firstFormation.receipt.receiptId, secondFormation.receipt.receiptId, "identical events must reuse the exact signed receipt");
    assert.equal(secondFormation.receipt.persistedAction, "noop", "formation receipt persistence must be idempotent");
    assert.equal(secondFormation.writes.some((write) => write.kind === "episode" && write.action === "noop"), true);
    assert.equal(firstFormation.noHostEffects, true);

    const unsafeToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
    const unsafeFormation = runtime.formLifecycleEvent("writeback_evidence", {
      ...acceptedInput,
      value: { [unsafeToken]: "safe sibling summary" },
    }, { now: NOW });
    assert.equal(unsafeFormation.status, "rejected");
    assert.equal(unsafeFormation.writes.length, 0);
    assert.equal(JSON.stringify(unsafeFormation).includes(unsafeToken), false);

    const reviewCases = [
      acceptedWriteback(alphaPath, "module-review", { decision: "revise" }),
      acceptedWriteback(alphaPath, "module-review", { decision: "block" }),
      acceptedWriteback(alphaPath, "module-review", { heuristic: true }),
      acceptedWriteback(alphaPath, "module-review", { securitySensitive: true }),
      acceptedWriteback(alphaPath, "module-review", { archiveCompactRestore: true, category: "archive compact restore" }),
    ];
    for (const reviewInput of reviewCases) {
      const result = runtime.formLifecycleEvent("writeback_evidence", reviewInput, { now: NOW });
      assert.equal(result.status, "review", `${reviewInput.decision || reviewInput.category || "review signal"} must remain review-only`);
      assert.equal(result.accepted, false);
      assert.equal(result.receipt, null);
    }
    assert.ok(runtime.listReviewQueue({ projectPath: alphaPath, limit: 100 }).count >= reviewCases.length);

    const closureInput = {
      taskId: "working-alpha",
      projectPath: alphaPath,
      moduleId: "module-memory-core",
      status: "accepted",
      currentGoal: "Close the bounded implementation task after verification.",
      currentEvidence: [sourceRef(deriveProjectIdentity({ projectPath: alphaPath }).projectId, "module-memory-core", "working-memory")],
      nextAction: "Return the verified receipt to the caller.",
      updatedAt: NOW,
    };
    const closed = runtime.formLifecycleEvent("close_working_memory", closureInput, { now: NOW });
    assert.equal(closed.status, "review", "IPC-equivalent WorkingMemory closure must remain review-only");
    const syntheticTrustedClose = runtime.formAppOwnedLifecycleEvent("close_working_memory", closureInput, { now: NOW });
    assert.equal(syntheticTrustedClose.status, "review", "synthetic WorkingMemory pointers cannot auto-accept without verified receipt binding");
    const receiptBoundClose = runtime.formAppOwnedLifecycleEvent("close_working_memory", {
      ...closureInput,
      acceptedReceiptId: firstFormation.receipt.receiptId,
    }, { now: NOW });
    assert.equal(receiptBoundClose.status, "accepted", "trusted closure may accept only when bound to a verified persisted app-owned receipt");

    const anchors = [
      { category: "identity", statement: "Alpha" },
      { category: "original_goal", statement: "Complete the full product, not an MVP." },
      { category: "architecture", statement: "Use one composed Memory Runtime lifecycle." },
      { category: "non_negotiable", statement: "Never expose signing keys through IPC." },
      { category: "acceptance", statement: "Focused and default verification must pass." },
      { category: "safety", statement: "Raw sessions remain pointer-only and unread." },
      ...Array.from({ length: 96 }, (_, index) => ({
        anchorId: `mandatory-alpha-${index}`,
        category: "non_negotiable",
        statement: `Mandatory deterministic continuity rule ${index}.`,
        sourceRefs: [sourceRef(alphaId, "module-memory-core", `anchor-${index}`)],
      })),
    ].map((anchor, index) => ({
      authorityStatus: "accepted",
      sourceRefs: anchor.sourceRefs || [sourceRef(alphaId, "module-memory-core", `base-anchor-${index}`)],
      updatedAt: NOW,
      ...anchor,
    }));
    runtime.seedProject({
      projectPath: alphaPath,
      projectName: "Alpha",
      projectSummary: "Synthetic project for complete continuity pagination.",
      sourceRefs: [sourceRef(alphaId, "module-memory-core", "project")],
      anchors,
      modules: [{
        moduleId: "module-memory-core",
        name: "Memory Core",
        purpose: "Compose authority, continuity, evaluation, index, and formation.",
        currentStatus: "active",
        authorityStatus: "accepted",
        sourceRefs: [sourceRef(alphaId, "module-memory-core", "module")],
        updatedAt: NOW,
      }],
      now: NOW,
    });
    upsertMemoryFact(root, {
      projectPath: alphaPath,
      scope: "project",
      subject: "legacy",
      predicate: "unverified_current",
      value: "Legacy accepted data without a registered Owner approval receipt.",
      factType: "decision",
      status: "accepted",
      confidence: 1,
      observedAt: NOW,
      sourceRefs: [sourceRef(alphaId, "module-memory-core", "legacy-fact")],
    }, { now: NOW });
    const formedFactWrite = upsertMemoryFact(root, {
      projectPath: alphaPath,
      scope: "project",
      subject: "formed",
      predicate: "verified_current",
      value: "A low-risk fact formed by the app-owned lifecycle.",
      factType: "decision",
      status: "accepted",
      confidence: 1,
      observedAt: NOW,
      sourceRefs: [sourceRef(alphaId, "module-memory-core", "formed-fact")],
    }, { now: NOW });
    const formedFactAuthority = runtime.authorizeFormedMemoryFacts([{
      id: formedFactWrite.fact.id,
      action: formedFactWrite.action,
      status: formedFactWrite.fact.status,
    }], firstFormation, { projectPath: alphaPath, moduleId: "module-memory-core", now: NOW });
    assert.equal(formedFactAuthority.authorized, 1, JSON.stringify({
      formedFactAuthority,
      formedFactWrite,
      currentFacts: listMemoryFacts(root, { projectPath: alphaPath, limit: 20 }),
    }));
    const duplicateFactAuthority = runtime.authorizeFormedMemoryFacts([{
      id: formedFactWrite.fact.id,
      action: "noop",
      status: formedFactWrite.fact.status,
    }], firstFormation, { projectPath: alphaPath, moduleId: "module-memory-core", now: NOW });
    assert.equal(duplicateFactAuthority.links[0].receiptAction, "noop", "formed fact receipts must persist idempotently");
    assert.equal(duplicateFactAuthority.links[0].linkAction, "noop", "formed fact authority links must persist idempotently");
    const forgedFactAuthority = runtime.authorizeFormedMemoryFacts([{
      id: formedFactWrite.fact.id,
      action: "insert",
      status: "accepted",
    }], {
      ...firstFormation,
      receipt: { ...firstFormation.receipt, receiptId: "fabricated-formation-receipt" },
    }, { projectPath: alphaPath, moduleId: "module-memory-core", now: NOW });
    assert.equal(forgedFactAuthority.authorized, 0, "plain caller-shaped formation data must not mint fact authority");
    const restartedPage = reloaded.getProjectContinuity({ projectPath: alphaPath, moduleId: "module-memory-core", now: NOW });
    assert.ok(reloaded.getDiagnostics({ projectPath: alphaPath }).receiptCacheSize >= 1, "persisted formation receipt must rehydrate in a new runtime composition");
    assert.equal(restartedPage.authority.authorizedCurrentFacts, 1);
    assert.equal(restartedPage.authority.downgradedLegacyFacts, 1, "legacy accepted facts without exact receipts must downgrade");
    assert.ok(restartedPage.authorizedFactIds.includes(formedFactWrite.fact.id), "exact persisted fact receipt must rehydrate after restart");
    const invalidCursorRuntimePage = runtime.getProjectContinuity({ projectPath: alphaPath, cursor: 999999, now: NOW });
    assert.equal(invalidCursorRuntimePage.continuityPacket.mandatoryManifest.cursorInvalid, true, "runtime page API must surface invalid cursors");
    assert.equal(invalidCursorRuntimePage.mandatoryComplete, false);
    assert.equal(invalidCursorRuntimePage.recoveryReady, false);
    const continuityStart = performance.now();
    const continuity = runtime.getContinuityStatus({
      projectPath: alphaPath,
      tokenBudget: 2200,
      maxPacketItems: 8,
      now: NOW,
      workingState: {
        acceptedProgress: [{ id: "progress-alpha", projectId: alphaId, title: "Runtime integration accepted", authorityStatus: "accepted", sourceRefs: [sourceRef(alphaId, "module-memory-core", "progress")] }],
        openTasks: [{ id: "task-alpha", projectId: alphaId, title: "Run final verification", status: "open", authorityStatus: "accepted", sourceRefs: [sourceRef(alphaId, "module-memory-core", "task")] }],
        nextActions: [{ id: "action-alpha", projectId: alphaId, title: "Report final evidence", status: "open", authorityStatus: "accepted", sourceRefs: [sourceRef(alphaId, "module-memory-core", "action")] }],
        threadLineage: [{ id: "thread-alpha", projectId: alphaId, title: "CEO to Memory Core worker", authorityStatus: "accepted", sourceRefs: [sourceRef(alphaId, "module-memory-core", "thread")] }],
        canonicalDocs: [{ id: "doc-alpha", projectId: alphaId, title: "Memory Core design", authorityStatus: "accepted", sourceRefs: [sourceRef(alphaId, "module-memory-core", "canonical-doc")] }],
      },
    });
    const continuityMs = performance.now() - continuityStart;
    assert.equal(continuity.pagination.complete, true, "continuity status must finish mandatory pagination rather than trust topK");
    assert.ok(continuity.pagination.pagesRead > 1, "the fixture must exercise multi-page mandatory continuity");
    assert.equal(continuity.pagination.mandatoryReturned, continuity.pagination.mandatoryTotal);
    assert.equal(continuity.recoveryReady, true, `mandatory continuity remains unsatisfied: ${continuity.unsatisfiedSlots.join(",")}`);
    assert.ok(continuityMs < 5000, `bounded continuity pagination should remain local and fast, observed ${continuityMs.toFixed(1)}ms`);

    const repeatedCursorRuntime = createMemoryCoreRuntime({ storeRoot: root, now: NOW });
    repeatedCursorRuntime.getProjectContinuity = ({ cursor: requestedCursor }) => {
      const pageStart = requestedCursor ? 1 : 0;
      return {
        availability: "ready",
        projectId: alphaId,
        projectPath: alphaPath,
        recoveryReady: false,
        missing: [],
        stale: [],
        conflict: [],
        unsatisfied: [],
        warnings: [],
        mandatoryComplete: false,
        nextCursor: "mc2.repeated-cursor",
        continuityPacket: {
          mandatoryReturned: 1,
          mandatoryTotal: 2,
          manifestFingerprint: "repeated-manifest",
          sourceRefs: [],
          mandatoryManifest: {
            cursorInvalid: false,
            pageStart,
            pageEndExclusive: pageStart + 1,
          },
          continuity: {
            requiredSlots: PROJECT_CONTINUITY_SLOTS,
            filledSlots: PROJECT_CONTINUITY_SLOTS,
            missingSlots: [],
            staleSlots: [],
            conflictSlots: [],
            unsatisfiedSlots: [],
            coverage: 1,
          },
        },
      };
    };
    const repeatedCursorStatus = repeatedCursorRuntime.getContinuityStatus({ projectPath: alphaPath });
    assert.equal(repeatedCursorStatus.pagination.cursorInvalid, true, "runtime traversal must reject a repeated/non-advancing cursor");
    assert.equal(repeatedCursorStatus.pagination.complete, false);
    assert.equal(repeatedCursorStatus.recoveryReady, false);

    runtime.seedProject({
      projectPath: betaPath,
      projectName: "Beta",
      projectSummary: "Separate project for isolation verification.",
      now: NOW,
    });
    runtime.formAppOwnedLifecycleEvent("writeback_evidence", acceptedWriteback(betaPath, "module-beta"), { now: NOW });
    const alphaRecall = runtime.listRecallCandidates({ projectPath: alphaPath, queryType: "project_resume" });
    assert.ok(alphaRecall.length > 0);
    assert.ok(alphaRecall.every((item) => item.projectId === alphaId), "Memory Core sidecar recall must remain project-isolated");

    const malicious = runtime.getProjectContinuity({
      projectPath: alphaPath,
      principalRole: "owner",
      actor: { role: "owner", capabilities: ["memory.approve", "memory.revoke"] },
      now: NOW,
    });
    assert.equal(malicious.principal.role, "service");
    assert.equal(Object.hasOwn(malicious, "trustContext"), false);

    const authorityCandidates = Array.from({ length: 10_000 }, (_, index) => candidate(`benchmark-${index}`, alphaPath));
    const authorityTimings = [];
    for (let run = 0; run < 5; run += 1) {
      const startedAt = performance.now();
      assert.equal(runtime.filterAuthorizedCandidates(authorityCandidates, { projectPath: alphaPath, queryType: "task_dispatch", maxCandidates: 10_000 }).items.length, 10_000);
      authorityTimings.push(performance.now() - startedAt);
    }
    authorityTimings.sort((left, right) => left - right);
    const authorityP95Ms = authorityTimings[authorityTimings.length - 1];
    assert.ok(authorityP95Ms < 2500, `10k authority filtering should remain bounded; observed ${authorityP95Ms.toFixed(1)}ms`);

    const diagnostics = reloaded.getDiagnostics({ projectPath: alphaPath });
    const diagnosticsJson = JSON.stringify(diagnostics);
    assert.equal(diagnostics.safety.signingKeyExposed, false);
    assert.equal(diagnostics.safety.trustContextExposed, false);
    assert.equal(diagnostics.startupWholeTableScan, false);
    assert.equal(diagnostics.timers, false);
    assert.equal(diagnosticsJson.includes(firstKey.toString("hex")), false, "diagnostics must never expose the signing key");
    assert.equal(diagnosticsJson.includes("authority-context-"), false, "diagnostics must never expose trust context identity");

    console.log(`Memory Core runtime lifecycle test passed. continuityPages=${continuity.pagination.pagesRead} continuityMs=${continuityMs.toFixed(1)} authorityFilter10kP95Ms=${authorityP95Ms.toFixed(1)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
