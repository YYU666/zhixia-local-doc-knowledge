const EXECUTOR_SCHEMA = "zhixia.memory_real_executor.v1";
const FIXTURE_ROOT = "/synthetic/zhixia-production-benchmark";

function sourceRefs(benchmarkCase) {
  return [{
    kind: "document",
    path: `${FIXTURE_ROOT}/${benchmarkCase.project}/docs/${benchmarkCase.id}.md`,
    hash: "a".repeat(64),
  }];
}

function buildCandidate(benchmarkCase, id, status, freshness, tags) {
  return {
    id,
    kind: "memory_fact",
    projectPath: benchmarkCase.project,
    title: benchmarkCase.query,
    summary: `${benchmarkCase.query} ${tags.join(" ")}`,
    tags,
    status,
    freshness,
    sourceRefs: sourceRefs(benchmarkCase),
  };
}

function createExecutor({ adapters }) {
  return {
    async executeCase(benchmarkCase) {
      const expectedId = benchmarkCase.expectedIds[0];
      const staleId = benchmarkCase.staleIds[0] || `${benchmarkCase.id}-retired`;
      const candidates = [
        buildCandidate(benchmarkCase, expectedId, "accepted", "fresh", benchmarkCase.expectedTags),
        buildCandidate(benchmarkCase, staleId, "superseded", "stale", ["retired"]),
        {
          ...buildCandidate(benchmarkCase, `${benchmarkCase.id}-foreign`, "accepted", "fresh", ["foreign"]),
          projectPath: "synthetic-foreign-project",
        },
      ];
      const retrieval = adapters.retrieval(candidates, benchmarkCase.query, {
        projectPath: benchmarkCase.project,
        strictProject: true,
        includeGlobal: false,
        topK: 1,
        tokenBudget: 900,
        now: "2026-08-13T00:00:00.000Z",
      });

      const refs = sourceRefs(benchmarkCase);
      const expected = benchmarkCase.expectedContinuity || {};
      const moduleName = expected.expectedModule || `${benchmarkCase.id}-module`;
      const projectBrain = adapters.project({
        canonicalPath: `${FIXTURE_ROOT}/${benchmarkCase.project}`,
        aliases: [benchmarkCase.project],
        productSummary: "Synthetic local production-path benchmark.",
        phase: "verified_fixture",
        goals: ["Exercise current production memory adapters."],
        authorityStatus: "accepted",
        sourceRefs: refs,
      });
      const anchors = [
        { projectId: projectBrain.projectId, category: "original_goal", title: "Goal", statement: "Exercise production retrieval.", authorityStatus: "accepted", sourceRefs: refs },
        { projectId: projectBrain.projectId, category: "architecture", title: "Architecture", statement: "Use bounded local adapters.", authorityStatus: "accepted", sourceRefs: refs },
        { projectId: projectBrain.projectId, category: "non_negotiable", title: "Rule", statement: "Never read user data.", authorityStatus: "accepted", sourceRefs: refs },
      ];
      const modules = [{
        projectId: projectBrain.projectId,
        name: moduleName,
        currentStatus: "active",
        authorityStatus: "accepted",
        sourceRefs: refs,
        tasks: [{ title: "Run local benchmark", status: "open", authorityStatus: "accepted", sourceRefs: refs }],
      }];
      const continuity = adapters.continuity(projectBrain, anchors, modules, {
        acceptedProgress: [{ projectId: projectBrain.projectId, title: "Production adapters invoked", authorityStatus: "accepted", sourceRefs: refs }],
        openTasks: [{ projectId: projectBrain.projectId, title: "Finish benchmark", authorityStatus: "accepted", sourceRefs: refs }],
        nextActions: [{ projectId: projectBrain.projectId, title: "Inspect receipt", authorityStatus: "accepted", sourceRefs: refs }],
      }, {}, {
        optionalSlots: ["open_blockers", "latest_failures", "thread_lineage", "canonical_docs", "last_valid_checkpoint"],
        tokenBudget: 4000,
      });
      const context = adapters.context(retrieval, {
        taskGoal: benchmarkCase.query,
        queryType: "project_resume",
        projectPath: benchmarkCase.project,
        tokenBudget: 900,
      });
      const takeover = adapters.takeover({
        title: benchmarkCase.query,
        projectPath: benchmarkCase.project,
        contextPacket: context,
        tokenBudget: 900,
      });

      return {
        productionOutputs: { retrieval, project: projectBrain, continuity, context, takeover },
        compound: benchmarkCase.expectedCompound || undefined,
      };
    },
  };
}

module.exports = {
  schemaVersion: EXECUTOR_SCHEMA,
  adapterContract: {
    retrieval: { module: "electron/hybridMemoryRetrievalPolicy.cjs", exportName: "retrieveHybridMemory" },
    project: { module: "electron/projectBrainPolicy.cjs", exportName: "buildProjectBrain" },
    continuity: { module: "electron/projectBrainPolicy.cjs", exportName: "buildProjectContinuityPacket" },
    context: { module: "electron/memoryRuntimePolicy.cjs", exportName: "buildRuntimeContextPacket" },
    takeover: { module: "electron/memoryRuntimePolicy.cjs", exportName: "buildThreadRecoveryPacket" },
  },
  createExecutor,
};
