const assert = require("node:assert/strict");
const path = require("node:path");

const {
  SEMANTIC_MEMORY_GRAPH_SCHEMA,
  assembleBoundedOneHopPaths,
  buildSemanticGraphSeedFromRuntimeItems,
  canonicalSemanticGraphProjectScope,
  extractExplicitSemanticGraph,
  inspectSemanticGraphInput,
  normalizeProjectPath,
  normalizeSemanticEntity,
  normalizeSemanticRelation,
  projectIdentityForPath,
  rankSemanticEntity,
  semanticGraphFromMemoryFacts,
  stableSemanticEntityId,
  tokenizeSemanticQuery,
} = require("../electron/semanticMemoryGraphPolicy.cjs");

const projectA = path.resolve("C:/synthetic/semantic-project-a");
const projectB = path.resolve("C:/synthetic/semantic-project-b");
const sourceRefs = [{ kind: "canonical_doc", path: "docs/TECHNICAL_DESIGN.md", hash: "design-sha" }];

function entity(input, projectPath = projectA) {
  const result = normalizeSemanticEntity({
    projectPath,
    status: "active",
    sourceRefs,
    provenance: "explicit",
    ...input,
  });
  assert.equal(result.ok, true, JSON.stringify(result.reasonCodes));
  return result.entity;
}

function main() {
  assert.equal(SEMANTIC_MEMORY_GRAPH_SCHEMA, "zhixia.semantic_memory_graph.v1");
  assert.match(projectIdentityForPath(projectA), /^project-/);

  const stableA = stableSemanticEntityId({ projectPath: projectA, kind: "concept", canonicalName: "Knowledge Graph" });
  const stableARepeat = stableSemanticEntityId({ projectPath: projectA, kind: "concept", canonicalName: "knowledge graph" });
  const stableB = stableSemanticEntityId({ projectPath: projectB, kind: "concept", canonicalName: "Knowledge Graph" });
  assert.equal(stableA, stableARepeat, "entity IDs must be deterministic within an exact project identity");
  assert.notEqual(stableA, stableB, "same aliases and names in different projects must not share identity");

  const aliasA = entity({ kind: "concept", canonicalName: "Semantic Graph", aliases: ["Knowledge Graph", "KG"] }, projectA);
  const aliasB = entity({ kind: "concept", canonicalName: "Foreign Semantic Graph", aliases: ["Knowledge Graph", "KG"] }, projectB);
  assert.notEqual(aliasA.id, aliasB.id);
  assert.ok(rankSemanticEntity(aliasA, tokenizeSemanticQuery("knowledge graph recall")).score > 0);

  const claimGraph = semanticGraphFromMemoryFacts([{
    id: "fact-graphify-token-claim",
    projectPath: projectA,
    scope: "project",
    subject: "70x token saving",
    predicate: "derived_from",
    value: "Graphify Douyin video 7668959622917580901",
    factType: "claim",
    status: "review",
    confidence: 0.55,
    validFrom: "2026-08-01T00:00:00.000Z",
    observedAt: "2026-08-01T00:00:00.000Z",
    sourceRefs: [{ kind: "social_video", uri: "https://www.douyin.com/video/7668959622917580901", hash: "video-analysis-sha" }],
  }], { projectPath: projectA });
  assert.equal(claimGraph.entities.every((item) => item.kind === "claim" && item.status === "review"), true);
  assert.equal(claimGraph.relations.length, 1);
  assert.equal(claimGraph.relations[0].predicate, "derived_from");
  assert.equal(claimGraph.relations[0].status, "review", "a source-attributed promotional number must remain a review claim");
  assert.equal(claimGraph.relations[0].factId, "fact-graphify-token-claim", "relations must reuse the typed fact ledger identity");

  const from = entity({ kind: "evidence", canonicalName: "Unaccepted benchmark" });
  const to = entity({ kind: "decision", canonicalName: "Adopt Graphify" });
  for (const predicate of ["supports", "contradicts"]) {
    const result = normalizeSemanticRelation({
      projectPath: projectA,
      fromEntityId: from.id,
      toEntityId: to.id,
      predicate,
      status: "active",
      sourceRefs,
      provenance: "extracted",
    });
    assert.equal(result.ok, true);
    assert.equal(result.relation.status, "review", `${predicate} must not become active without accepted source-backed evidence`);
  }
  const inferred = normalizeSemanticRelation({
    projectPath: projectA,
    fromEntityId: from.id,
    toEntityId: to.id,
    predicate: "related_to",
    status: "active",
    sourceRefs,
    provenance: "inferred",
  }, { acceptedSourceBackedEvidence: true });
  assert.equal(inferred.relation.status, "review", "inferred relations are always review-only");

  const explicit = extractExplicitSemanticGraph({
    projectPath: projectA,
    projectName: "Zhixia",
    acceptedSourceBacked: true,
    sourceRefs,
    documents: [{
      title: "Semantic graph design",
      path: "docs/TECHNICAL_DESIGN.md",
      tags: ["memory", "knowledge-graph"],
      frontmatter: { applies_to: ["task-time recall"], item: "P0 graph provider", source: "Graphify analysis" },
      wikilinks: ["CEO Flow"],
      markdownLinks: [{ title: "Graphify source", uri: "https://example.invalid/graphify" }],
      compactMarkdown: "See [[Evidence Graph]] and [bounded source](https://example.invalid/source).",
    }],
  });
  assert.equal(explicit.rejected, false);
  assert.ok(explicit.entities.some((item) => item.kind === "project"));
  assert.ok(explicit.relations.some((item) => item.predicate === "belongs_to"));
  assert.ok(explicit.relations.some((item) => item.predicate === "about"));
  assert.ok(explicit.relations.some((item) => item.predicate === "mentions"));
  assert.ok(explicit.relations.some((item) => item.predicate === "applies_to"));
  assert.ok(explicit.relations.some((item) => item.predicate === "derived_from"));
  assert.deepEqual(explicit.performance, { llmCalls: 0, rawBodyReads: 0, documentScans: 0, boundedInputOnly: true });

  const unsafeFixtures = [
    { sourceRefs: [{ kind: "raw_session", path: "C:/Users/demo/.codex/sessions/thread.jsonl" }] },
    { sourceRefs: [{ kind: "document", path: "docs/key.md" }], note: "api_key=super-secret-value" },
    { sourceRefs: [{ kind: "document", path: "docs/image.md" }], image: `data:image/png;base64,${"A".repeat(240)}` },
    { body: `giant markdown ${"log line ".repeat(2200)}` },
  ];
  for (const fixture of unsafeFixtures) assert.equal(inspectSemanticGraphInput(fixture).safe, false);
  const accessorFixture = {};
  Object.defineProperty(accessorFixture, "canonicalName", { enumerable: true, get() { return "must not execute"; } });
  assert.equal(inspectSemanticGraphInput(accessorFixture).safe, false, "accessor-bearing objects must fail closed");
  const rawBodyExtraction = extractExplicitSemanticGraph({
    projectPath: projectA,
    documents: [{ title: "unsafe", body: "raw body must not be read", sourceRefs }],
  });
  assert.equal(rawBodyExtraction.entities.length, 0);
  assert.ok(rawBodyExtraction.warnings.includes("raw_document_body_refused"));
  const escaped = normalizeSemanticEntity({
    projectPath: projectA,
    kind: "document",
    canonicalName: "escaped",
    status: "active",
    sourceRefs: [{ kind: "document", path: "../foreign/private.md" }],
    provenance: "explicit",
  });
  assert.equal(escaped.ok, true);
  assert.equal(escaped.entity.status, "review");
  assert.equal(escaped.entity.sourceRefs.length, 0, "path escapes must not survive normalization");

  const runtimeSeed = buildSemanticGraphSeedFromRuntimeItems([
    {
      id: "accepted-project-artifact",
      kind: "project_artifact",
      projectPath: projectA,
      title: "Current semantic memory design",
      summary: "Bounded graph recall is part of task-time retrieval.",
      tags: ["memory", "semantic-graph"],
      status: "active",
      freshness: "fresh",
      sourceRefs,
    },
    {
      id: "accepted-memory-core-item",
      kind: "accepted_progress",
      projectId: "memory-core-project-a",
      title: "Verified semantic graph checkpoint",
      summary: "The app-owned sidecar is the canonical graph store.",
      status: "accepted",
      authorityStatus: "accepted",
      authoritative: true,
      sourceRefs,
    },
    { projectPath: projectA, title: "Review candidate", summary: "must not persist", status: "review", sourceRefs },
    { projectPath: projectA, title: "Global candidate", summary: "must not persist", scope: "global", status: "active", sourceRefs },
    { projectPath: projectB, title: "Foreign candidate", summary: "must not persist", status: "active", sourceRefs },
    { projectPath: projectA, title: "Body candidate", summary: "must not persist", body: "small full body", status: "active", sourceRefs },
    { projectPath: projectA, title: "Secret candidate", summary: "api_key=super-secret-value", status: "active", sourceRefs },
    { projectPath: projectA, title: "Base64 candidate", summary: `data:image/png;base64,${"A".repeat(240)}`, status: "active", sourceRefs },
    { projectPath: projectA, title: "Raw session candidate", summary: "must not persist", status: "active", sourceRefs: [{ kind: "raw_session", path: "C:/Users/demo/.codex/sessions/thread.jsonl" }] },
  ], { projectPath: projectA, authorityProjectId: "memory-core-project-a", projectName: "Semantic Project A" });
  assert.equal(runtimeSeed.seed.attempted, true);
  assert.equal(runtimeSeed.seed.candidatesConsidered, 9);
  assert.equal(runtimeSeed.seed.eligibleCandidates, 2);
  assert.equal(runtimeSeed.seed.rejectedCandidates, 7);
  assert.equal(runtimeSeed.entities.length, 3, "one exact project entity and two accepted packet items should be prepared");
  assert.equal(runtimeSeed.relations.length, 2);
  assert.equal(runtimeSeed.entities.every((item) => item.status === "active" && item.sourceRefs.length > 0), true);
  assert.equal(runtimeSeed.relations.every((item) => item.status === "active" && item.predicate === "belongs_to"), true);
  assert.equal(runtimeSeed.seed.workspaceScans, 0);
  assert.equal(runtimeSeed.seed.documentEnumerations, 0);
  assert.equal(runtimeSeed.seed.rawBodyReads, 0);
  assert.equal(runtimeSeed.seed.fullTextBodyReads, 0);
  assert.doesNotMatch(JSON.stringify(runtimeSeed), /small full body|super-secret-value|data:image|\.codex[\\/]sessions/i);

  const linkedProjectA = path.resolve("C:/synthetic/semantic-project-a-linked");
  const canonicalScope = canonicalSemanticGraphProjectScope(linkedProjectA, {
    projectId: "shared-envelope-project-a",
    canonicalRepoId: "shared-envelope-repo-a",
    canonicalRoot: projectA,
    worktreeRoot: linkedProjectA,
  });
  assert.equal(canonicalScope.projectPath, normalizeProjectPath(projectA));
  assert.equal(canonicalScope.canonicalized, true);
  assert.ok(canonicalScope.acceptedProjectPaths.includes(normalizeProjectPath(linkedProjectA)));
  const foreignScope = canonicalSemanticGraphProjectScope(projectB, {
    projectId: "shared-envelope-project-a",
    canonicalRepoId: "shared-envelope-repo-a",
    canonicalRoot: projectA,
    worktreeRoot: linkedProjectA,
  });
  assert.equal(foreignScope.projectPath, normalizeProjectPath(projectB), "a foreign path must not inherit another envelope's canonical graph scope");
  assert.ok(foreignScope.warnings.includes("semantic_graph_project_identity_envelope_mismatch_fallback"));

  const sourceAliasSeed = buildSemanticGraphSeedFromRuntimeItems([{
    id: "linked-source-alias",
    kind: "project_artifact",
    projectPath: linkedProjectA,
    title: "Current engine architecture",
    summary: "Accepted current direction",
    status: "active",
    sourceRefs: [{
      kind: "canonical_doc",
      path: path.join(linkedProjectA, "docs", "EXAMPLE_PROJECT_CURRENT_CHECKPOINT.md"),
      updatedAt: "2026-08-01T01:00:00.000Z",
    }],
  }], {
    projectPath: canonicalScope.projectPath,
    acceptedProjectPaths: canonicalScope.acceptedProjectPaths,
    projectName: "Semantic Project A",
  });
  const sourceAliasEntity = sourceAliasSeed.entities.find((item) => item.kind === "document");
  assert.ok(sourceAliasEntity.aliases.some((alias) => alias.toLowerCase() === "example_project_current_checkpoint.md"));
  assert.ok(sourceAliasEntity.aliases.some((alias) => alias.toLowerCase() === "example_project_current_checkpoint"));
  assert.equal(sourceAliasEntity.sourceRefs[0].path.toLowerCase(), "docs/example_project_current_checkpoint.md", "linked source refs must become stable project-relative metadata");
  assert.equal(sourceAliasSeed.entities.find((item) => item.kind === "project").createdAt, "1970-01-01T00:00:00.000Z", "runtime project creation time must not depend on the retrieved subset");

  const project = entity({ kind: "project", canonicalName: "Zhixia Memory Runtime" });
  const relations = Array.from({ length: 30 }, (_, index) => {
    const target = entity({ kind: "concept", canonicalName: `Graph concept ${index}` });
    return {
      target,
      relation: normalizeSemanticRelation({
        projectPath: projectA,
        fromEntityId: project.id,
        toEntityId: target.id,
        predicate: "related_to",
        status: "active",
        sourceRefs,
        provenance: "explicit",
      }, { acceptedSourceBackedEvidence: true }).relation,
    };
  });
  const entityMap = new Map([[project.id, project], ...relations.map((item) => [item.target.id, item.target])]);
  const assembled = assembleBoundedOneHopPaths({
    matchedEntities: [{ entity: project, score: 10, whyMatched: ["canonical:zhixia"] }],
    relations: relations.map((item) => item.relation),
    entityMap,
  }, { maxPaths: 12, tokenBudget: 1200, maxCandidates: 96 });
  assert.ok(assembled.graphPaths.length <= 12);
  assert.ok(assembled.tokenEstimate <= 1200);
  assert.equal(assembled.performance.oneHop, true);
  assert.equal(assembled.performance.backgroundRebuild, false);

  console.log("Semantic memory graph policy tests passed.");
}

main();
