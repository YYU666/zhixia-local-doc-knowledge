const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT_IDENTITY_SCHEMA = "zhixia.project_identity_envelope.v1";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function realPath(value) {
  const resolved = path.resolve(value || process.cwd());
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function identityPath(value) {
  const normalized = realPath(value).replace(/\\/g, "/").replace(/\/$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function runGit(workspace, args) {
  try {
    return execFileSync("git", ["-C", workspace, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

function canonicalWorktreeRoot(workspace, fallbackRoot) {
  const worktrees = runGit(workspace, ["worktree", "list", "--porcelain"]);
  const first = worktrees.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  return first ? realPath(first.slice("worktree ".length)) : fallbackRoot;
}

function deriveProjectIdentityEnvelope(workspace, options = {}) {
  const requestedRoot = realPath(workspace);
  const gitRootRaw = runGit(requestedRoot, ["rev-parse", "--show-toplevel"]);
  const worktreeRoot = gitRootRaw ? realPath(gitRootRaw) : requestedRoot;
  const gitCommonDirRaw = runGit(worktreeRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const canonicalRoot = gitRootRaw ? canonicalWorktreeRoot(worktreeRoot, worktreeRoot) : requestedRoot;
  const baselineHead = runGit(worktreeRoot, ["rev-parse", "HEAD"]) || null;
  const remote = runGit(worktreeRoot, ["config", "--get", "remote.origin.url"]);
  const repositorySeed = remote
    ? `remote:${remote.trim().replace(/\\/g, "/").toLowerCase()}`
    : `local:${identityPath(gitCommonDirRaw || canonicalRoot)}`;
  const canonicalRepoId = `repo-${sha256(repositorySeed).slice(0, 24)}`;
  const projectId = `project-${sha256(canonicalRepoId).slice(0, 24)}`;
  const core = {
    schemaVersion: PROJECT_IDENTITY_SCHEMA,
    projectId,
    canonicalRepoId,
    canonicalRoot,
    worktreeRoot,
    baselineHead,
  };
  const projectIdentitySha256 = sha256(JSON.stringify({
    schemaVersion: core.schemaVersion,
    projectId: core.projectId,
    canonicalRepoId: core.canonicalRepoId,
  }));
  const envelope = { ...core, projectIdentitySha256 };
  if (options.expected) assertProjectIdentityMatches(envelope, options.expected);
  return envelope;
}

function assertProjectIdentityMatches(actual, expected = {}) {
  const comparisons = ["projectId", "canonicalRepoId", "projectIdentitySha256"];
  for (const key of comparisons) {
    if (expected[key] && expected[key] !== actual[key]) {
      throw new Error(`Project identity mismatch for ${key}.`);
    }
  }
  if (expected.canonicalRoot && identityPath(expected.canonicalRoot) !== identityPath(actual.canonicalRoot)) {
    throw new Error("Project identity mismatch for canonicalRoot.");
  }
  return actual;
}

function pathBelongsToProject(candidate, envelope) {
  if (!candidate || !envelope) return false;
  const text = String(candidate);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return /^(?:memory-runtime|git):\/\//i.test(text);
  const target = identityPath(text);
  return [envelope.canonicalRoot, envelope.worktreeRoot].some((root) => {
    const normalizedRoot = identityPath(root);
    return target === normalizedRoot || target.startsWith(`${normalizedRoot}/`);
  });
}

module.exports = {
  PROJECT_IDENTITY_SCHEMA,
  assertProjectIdentityMatches,
  deriveProjectIdentityEnvelope,
  pathBelongsToProject,
};
