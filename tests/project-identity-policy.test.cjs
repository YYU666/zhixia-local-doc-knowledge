const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const {
  assertProjectIdentityMatches,
  deriveProjectIdentityEnvelope,
  pathBelongsToProject,
} = require("../codex-skills/zhixia-local-docs/scripts/project-identity.cjs");

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
}

function realPath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-project-identity-"));
try {
  const canonical = path.join(root, "canonical");
  const worktree = path.join(root, "worktree");
  const foreign = path.join(root, "foreign");
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(foreign, { recursive: true });
  git(canonical, ["init"]);
  git(canonical, ["config", "user.email", "zhixia@example.invalid"]);
  git(canonical, ["config", "user.name", "Zhixia Test"]);
  fs.writeFileSync(path.join(canonical, "README.md"), "identity fixture\n", "utf8");
  git(canonical, ["add", "README.md"]);
  git(canonical, ["commit", "-m", "fixture"]);
  git(canonical, ["worktree", "add", "-b", "fixture-worktree", worktree]);

  const canonicalIdentity = deriveProjectIdentityEnvelope(canonical);
  const worktreeIdentity = deriveProjectIdentityEnvelope(worktree);
  const foreignIdentity = deriveProjectIdentityEnvelope(foreign);
  assert.equal(worktreeIdentity.projectId, canonicalIdentity.projectId, "linked worktrees must inherit canonical projectId");
  assert.equal(worktreeIdentity.canonicalRepoId, canonicalIdentity.canonicalRepoId, "linked worktrees must inherit canonical repository identity");
  assert.equal(worktreeIdentity.projectIdentitySha256, canonicalIdentity.projectIdentitySha256, "identity SHA must stay stable across linked worktrees");
  assert.equal(realPath(worktreeIdentity.canonicalRoot), realPath(canonical), "linked worktree envelope must point at the main canonical root");
  assert.equal(realPath(worktreeIdentity.worktreeRoot), realPath(worktree), "worktreeRoot must preserve the active run workspace");
  assert.equal(worktreeIdentity.baselineHead, canonicalIdentity.baselineHead, "new linked worktree should capture its baseline HEAD");
  fs.writeFileSync(path.join(canonical, "identity-change.txt"), "new commit\n", "utf8");
  git(canonical, ["add", "identity-change.txt"]);
  git(canonical, ["commit", "-m", "identity remains stable"]);
  const afterCommitIdentity = deriveProjectIdentityEnvelope(canonical);
  assert.equal(afterCommitIdentity.projectIdentitySha256, canonicalIdentity.projectIdentitySha256, "identity SHA must not change when baseline HEAD advances");
  assert.doesNotThrow(() => assertProjectIdentityMatches(afterCommitIdentity, canonicalIdentity), "stable identity validation must survive normal commits");
  assert.doesNotThrow(() => assertProjectIdentityMatches(worktreeIdentity, canonicalIdentity), "stable identity validation must accept linked worktrees");
  assert.notEqual(foreignIdentity.projectId, canonicalIdentity.projectId, "unrelated folders must not share project identity");
  assert.equal(pathBelongsToProject(path.join(worktree, "src", "file.ts"), worktreeIdentity), true);
  assert.equal(pathBelongsToProject(path.join(foreign, "secret.txt"), worktreeIdentity), false, "foreign paths must fail the project boundary");
  assert.equal(pathBelongsToProject("memory-runtime://writeback/test", worktreeIdentity), true);
  assert.throws(
    () => assertProjectIdentityMatches(worktreeIdentity, { projectId: foreignIdentity.projectId }),
    /Project identity mismatch/,
    "caller-supplied foreign project identity must fail closed",
  );
  fs.mkdirSync(path.join(canonical, ".codex-knowledge"), { recursive: true });
  fs.writeFileSync(path.join(canonical, ".codex-knowledge", "retrieval-packet.md"), "# Canonical inherited memory\nWorktree recall sentinel.\n", "utf8");
  const helper = path.resolve(__dirname, "..", "codex-skills", "zhixia-local-docs", "scripts", "read-project-knowledge.cjs");
  const helperRun = spawnSync(process.execPath, [helper, worktree, "--runtime-context", "--task-goal", "Worktree recall sentinel", "--json"], {
    cwd: worktree,
    env: { ...process.env, ZHIXIA_MEMORY_CORE_SQLITE_DISABLED: "1", ZHIXIA_MEMORY_FACT_SQLITE_DISABLED: "1" },
    encoding: "utf8",
  });
  assert.equal(helperRun.status, 0, helperRun.stderr);
  const packet = JSON.parse(helperRun.stdout);
  assert.equal(realPath(packet.request.projectPath), realPath(worktree), "request path must remain the active worktree");
  assert.equal(realPath(packet.projectIdentity.canonicalRoot), realPath(canonical), "packet must expose canonical memory ownership");
  assert.ok(packet.items.some((item) => /Canonical inherited memory/.test(item.title)), "worktree must inherit canonical project memory");
  assert.doesNotMatch(JSON.stringify(packet), new RegExp(foreign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "foreign project paths must not leak into worktree packets");
  console.log("Project identity policy tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
