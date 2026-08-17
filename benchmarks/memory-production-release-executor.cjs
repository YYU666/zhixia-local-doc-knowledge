const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXECUTOR_SCHEMA = "zhixia.memory_real_executor.v2";
const FIXTURE_ROOT = "/synthetic/zhixia-release-benchmark";

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createExecutor({ adapters, corpus, root }) {
  if (!corpus || !Array.isArray(corpus.documents) || corpus.documents.length < 100) {
    throw new Error("memory_real_executor_document_corpus_required");
  }
  const candidates = corpus.documents.map((document) => {
    const sourcePath = path.resolve(root, String(document.sourcePath || ""));
    const relative = path.relative(root, sourcePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("memory_real_executor_source_path_invalid");
    }
    return Object.freeze({
      id: document.id,
      kind: "memory_fact",
      projectPath: document.projectPath,
      title: document.title,
      summary: document.summary,
      tags: document.tags,
      status: document.status,
      freshness: document.freshness,
      moduleName: document.moduleName,
      sourceRefs: [{ kind: "document", path: relative.replace(/\\/g, "/"), hash: sha256File(sourcePath) }],
    });
  });

  return {
    async executeCase(benchmarkCase) {
      const retrieval = adapters.retrieval(candidates, benchmarkCase.query, {
        projectPath: benchmarkCase.project,
        strictProject: true,
        includeGlobal: false,
        topK: 1,
        tokenBudget: 900,
        now: "2026-08-13T00:00:00.000Z",
      });
      const selected = retrieval.items[0];
      const sourceRefs = selected?.sourceRefs || [];
      const moduleName = selected?.moduleName || "unknown-module";
      const projectBrain = adapters.project({
        canonicalPath: `${FIXTURE_ROOT}/${benchmarkCase.project}`,
        aliases: [benchmarkCase.project],
        productSummary: "Curated local production-path benchmark.",
        phase: "release_evaluation",
        goals: ["Exercise current production memory adapters against a frozen document corpus."],
        authorityStatus: "accepted",
        sourceRefs,
      });
      const anchors = [
        { projectId: projectBrain.projectId, category: "original_goal", title: "Goal", statement: "Exercise production retrieval.", authorityStatus: "accepted", sourceRefs },
        { projectId: projectBrain.projectId, category: "architecture", title: "Architecture", statement: "Use bounded local adapters.", authorityStatus: "accepted", sourceRefs },
        { projectId: projectBrain.projectId, category: "non_negotiable", title: "Rule", statement: "Never read user data.", authorityStatus: "accepted", sourceRefs },
      ];
      const modules = [{
        projectId: projectBrain.projectId,
        name: moduleName,
        currentStatus: "active",
        authorityStatus: "accepted",
        sourceRefs,
        tasks: [{ title: "Run local benchmark", status: "open", authorityStatus: "accepted", sourceRefs }],
      }];
      const continuity = adapters.continuity(projectBrain, anchors, modules, {
        acceptedProgress: [{ projectId: projectBrain.projectId, title: "Production adapters invoked", authorityStatus: "accepted", sourceRefs }],
        openTasks: [{ projectId: projectBrain.projectId, title: "Finish benchmark", authorityStatus: "accepted", sourceRefs }],
        nextActions: [{ projectId: projectBrain.projectId, title: "Inspect receipt", authorityStatus: "accepted", sourceRefs }],
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
      return { productionOutputs: { retrieval, project: projectBrain, continuity, context, takeover } };
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
