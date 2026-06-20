const assert = require("node:assert/strict");

const { buildProjectResumePacket } = require("../electron/projectResumePolicy.cjs");

const longPathSegment = "nested-folder-name-".repeat(13);
const longSourcePath = `C:\\Users\\a\\Documents\\zhixia\\${longPathSegment}\\source-material\\docs\\PRD.md`;
const longArtifactPath = `C:\\Users\\a\\Documents\\zhixia\\${longPathSegment}\\artifacts\\project\\TECHNICAL_DESIGN.md`;

const packet = buildProjectResumePacket({
  id: "project-zhixia",
  name: "知匣",
  rootPath: "C:\\Users\\a\\Documents\\zhixia",
  status: "paused",
  completion: "implementation",
  completionPercent: 60,
  ownerThreadId: "public-thread-id",
  workerThreadIds: ["worker-1"],
  reviewerThreadIds: ["reviewer-1"],
  lastActivityAt: "2026-06-12T16:00:00.000Z",
  lastSummary: "已完成归档候选只读闸门。",
  nextAction: "接入 Project Resume Packet retrieval。",
  currentGoal: "让知匣先返回低 token 的项目恢复上下文。",
  currentGoalStatus: "planned",
  recentDecisions: [
    { title: "归档候选先走只读闸门", status: "implemented" },
    { title: "Thread lineage 先走 metadata-only", status: "heuristic" },
  ],
  artifactPointers: [
    {
      title: "PRD",
      path: "docs/PRD.md",
      artifactType: "prd",
      status: "current",
    },
    {
      title: "Technical Design",
      path: "docs/TECHNICAL_DESIGN.md",
      artifactType: "technical_design",
      status: "current",
    },
  ],
  blockers: ["Archive receipt 尚未实现"],
  sourceRefs: [
    {
      kind: "document",
      title: "PRD",
      path: "docs/PRD.md",
    },
  ],
});

assert.equal(packet.kind, "project_resume_packet", "resume packet should expose a retrieval kind");
assert.equal(packet.contractVersion, "resume_packet_v2", "resume packet should expose an explicit contract version");
assert.equal(packet.freshness, "review", "paused projects should require review freshness");
assert.equal(packet.requiresHumanConfirmation, true, "heuristic paused project packets should require confirmation");
assert.equal(packet.packetAuthority, "heuristic", "default packets should stay heuristic until confirmed");
assert.equal(packet.projectIdentity.rootPath, "C:\\Users\\a\\Documents\\zhixia", "packet should expose project identity metadata");
assert.equal(packet.currentGoal.text, "让知匣先返回低 token 的项目恢复上下文。", "packet should expose the hot/current goal");
assert.equal(packet.currentGoal.status, "planned", "planned goals must stay labeled as planned");
assert.deepEqual(
  packet.recentDecisions.map((item) => item.status),
  ["implemented", "heuristic"],
  "decision labels should preserve implemented vs heuristic states",
);
assert.deepEqual(
  packet.artifactPointers.map((item) => item.path),
  ["docs/PRD.md", "docs/TECHNICAL_DESIGN.md"],
  "packet should expose artifact pointers instead of raw content",
);
assert.deepEqual(
  packet.retrievalOrder.map((item) => item.step),
  [
    "resume_packet_metadata",
    "artifact_pointers",
    "ceo_flow_and_thread_lineage",
    "knowledge_and_memory",
    "raw_session_and_cold_history",
  ],
  "packet should expose an explicit retrieval order",
);
assert.equal(packet.rawSessionPolicy, "explicit_only", "raw session access must stay explicit-only");
assert.match(packet.markdown, /# Project Resume Packet/, "packet should render the expected Markdown title");
assert.match(packet.markdown, /Packet authority: heuristic metadata-only review material\./, "packet should keep heuristic authority visible");
assert.match(packet.markdown, /Raw session policy: Do not read raw Codex sessions by default\./, "packet should make the raw-session gate explicit");
assert.match(packet.markdown, /Project: 知匣/, "packet should include project name");
assert.match(packet.markdown, /Project root: C:\\Users\\a\\Documents\\zhixia/, "packet should include project root");
assert.match(packet.markdown, /Status: paused/, "packet should include status");
assert.match(packet.markdown, /Completion: implementation \(60%\) \[heuristic\]/, "packet should include completion percent with an explicit label");
assert.match(packet.markdown, /Last known CEO thread: public-thread-id/, "packet should include CEO thread");
assert.match(packet.markdown, /Hot\/current goal: 让知匣先返回低 token 的项目恢复上下文。 \[planned\]/, "packet should keep planned goals visibly planned");
assert.match(packet.markdown, /Recent decisions:/, "packet should include recent decisions");
assert.match(packet.markdown, /归档候选先走只读闸门 \[implemented\]/, "packet should label implemented decisions");
assert.match(packet.markdown, /Thread lineage 先走 metadata-only \[heuristic\]/, "packet should label heuristic decisions");
assert.match(packet.markdown, /Artifact pointers:/, "packet should include artifact pointers");
assert.match(packet.markdown, /PRD \[prd; current\] \(docs\/PRD.md\)/, "packet should render artifact pointers");
assert.match(packet.markdown, /Retrieval order:/, "packet should render retrieval order");
assert.match(packet.markdown, /5\. Raw session \/ cold history \[explicit_only\]/, "packet should keep raw sessions behind an explicit-only gate");
assert.match(packet.markdown, /Next recommended action: 接入 Project Resume Packet retrieval。/, "packet should include next action");
assert.match(packet.markdown, /Do not repeat: Treat planned or heuristic fields as non-authoritative/, "packet should keep the heuristic warning");
assert.deepEqual(packet.sourceRefs, [{ kind: "document", title: "PRD", path: "docs/PRD.md" }], "packet should preserve source refs");

const activePacket = buildProjectResumePacket({ name: "Active", status: "active", completion: "testing" });
assert.equal(activePacket.freshness, "fresh", "active project packets should be fresh");
assert.equal(activePacket.requiresHumanConfirmation, false, "active status should not force confirmation by itself");
assert.match(activePacket.markdown, /Packet authority: heuristic metadata-only review material\./, "active packets should still stay metadata-only unless confirmed");

const rawSessionRef = {
  kind: "raw_session",
  path: "C:\\Users\\a\\.codex\\sessions\\thread-123.jsonl",
  get title() {
    throw new Error("raw session title should not be read by default");
  },
};
const safePacket = buildProjectResumePacket({
  name: "Safe project",
  status: "paused",
  completion: "design",
  sourceRefs: [
    rawSessionRef,
    { kind: "document", title: "Design", path: "docs/TECHNICAL_DESIGN.md" },
  ],
});
assert.deepEqual(
  safePacket.sourceRefs,
  [{ kind: "document", title: "Design", path: "docs/TECHNICAL_DESIGN.md" }],
  "raw session refs should be excluded from default resume packets",
);
assert.deepEqual(
  safePacket.artifactPointers.map((item) => item.path),
  ["docs/TECHNICAL_DESIGN.md"],
  "artifact pointers should stay metadata-only and exclude raw session paths",
);
assert.doesNotMatch(safePacket.markdown, /\.codex\\sessions\\thread-123\.jsonl/, "resume packet markdown should not expose raw session paths by default");

const longPathPacket = buildProjectResumePacket({
  name: "Long path project",
  status: "paused",
  completion: "implementation",
  sourceRefs: [
    { kind: "document", title: "Very long source", path: longSourcePath },
  ],
  artifactPointers: [
    { title: "Very long artifact", path: longArtifactPath, artifactType: "technical_design", status: "current" },
  ],
});
assert.equal(
  longPathPacket.sourceRefs[0].path,
  longSourcePath,
  "sourceRefs.path should preserve the exact pointer value even when it exceeds 240 characters",
);
assert.equal(
  longPathPacket.artifactPointers[0].path,
  longArtifactPath,
  "artifactPointers.path should preserve the exact pointer value even when it exceeds 240 characters",
);
assert.ok(longSourcePath.length > 240, "test fixture should exceed the markdown compaction threshold for source refs");
assert.ok(longArtifactPath.length > 240, "test fixture should exceed the markdown compaction threshold for artifact pointers");
assert.doesNotMatch(
  longPathPacket.markdown,
  new RegExp(longSourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  "markdown may compact long source ref paths instead of rendering the exact full pointer text",
);
assert.doesNotMatch(
  longPathPacket.markdown,
  new RegExp(longArtifactPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  "markdown may compact long artifact pointer paths instead of rendering the exact full pointer text",
);

console.log("Project resume policy behavior tests passed.");
