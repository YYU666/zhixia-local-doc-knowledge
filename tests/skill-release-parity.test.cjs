const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  MANIFEST_FILE_NAME,
  inspectSkillReleaseParity,
  verifySkillReleaseParity,
  writeSkillReleaseManifest,
} = require("../electron/skillReleaseManifest.cjs");

const verifierCli = path.resolve(__dirname, "..", "scripts", "verify-skill-release.cjs");

function makeSkill(parent, name = "skill") {
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, "agents"), { recursive: true });
  fs.mkdirSync(path.join(root, "references"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: zhixia-local-docs\n---\n");
  fs.writeFileSync(path.join(root, "agents", "openai.yaml"), "name: Zhixia\n");
  fs.writeFileSync(path.join(root, "references", "context-bundle.md"), "context\n");
  fs.writeFileSync(path.join(root, "scripts", "read-project-knowledge.cjs"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "references", "complete-tree-sentinel.md"), "included\n");
  writeSkillReleaseManifest(root);
  return root;
}

function copySkill(source, parent, name) {
  const target = path.join(parent, name);
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function legacyFourFileFingerprint(root) {
  const hash = crypto.createHash("sha256");
  for (const relative of [
    "SKILL.md",
    "agents/openai.yaml",
    "references/context-bundle.md",
    "scripts/read-project-knowledge.cjs",
  ]) {
    hash.update(relative);
    hash.update(fs.existsSync(path.join(root, relative)) ? fs.readFileSync(path.join(root, relative)) : Buffer.alloc(0));
  }
  return hash.digest("hex");
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-skill-release-"));
try {
  const repo = makeSkill(fixture, "repo");
  const bundled = copySkill(repo, fixture, "bundled");
  const installed = copySkill(repo, fixture, "installed");
  const rollback = makeSkill(fixture, "rollback");
  fs.writeFileSync(path.join(rollback, "references", "complete-tree-sentinel.md"), "older release\n");
  writeSkillReleaseManifest(rollback);

  const initial = verifySkillReleaseParity({ repoPath: repo, bundledPath: bundled, installedPath: installed, rollbackPath: rollback });
  assert.equal(initial.verified, true);
  assert.equal(initial.trees.repo.entryCount, 5);
  assert.equal(initial.upgradePlan.state, "current");
  assert.equal(initial.rollbackPlan.state, "candidate_verified");
  assert.notEqual(initial.rollbackPlan.releaseGeneration, initial.releaseGeneration);
  const cliCurrent = childProcess.spawnSync(process.execPath, [
    verifierCli,
    "--repo", repo,
    "--bundled", bundled,
    "--installed", installed,
  ], { encoding: "utf8" });
  assert.equal(cliCurrent.status, 0, cliCurrent.stderr);
  assert.equal(JSON.parse(cliCurrent.stdout).verified, true);

  const repoManifestBefore = fs.readFileSync(path.join(repo, MANIFEST_FILE_NAME));
  const installedManifestBefore = fs.readFileSync(path.join(installed, MANIFEST_FILE_NAME));
  inspectSkillReleaseParity({ repoPath: repo, bundledPath: bundled, installedPath: installed, rollbackPath: rollback });
  assert.deepEqual(fs.readFileSync(path.join(repo, MANIFEST_FILE_NAME)), repoManifestBefore, "inspection must not write repo state");
  assert.deepEqual(fs.readFileSync(path.join(installed, MANIFEST_FILE_NAME)), installedManifestBefore, "inspection must not write installed state");

  const legacyBefore = legacyFourFileFingerprint(installed);
  fs.writeFileSync(path.join(installed, "references", "complete-tree-sentinel.md"), "drift invisible to old fingerprint\n");
  assert.equal(legacyFourFileFingerprint(installed), legacyBefore, "old four-file fingerprint must reproduce the audit gap");
  let result = inspectSkillReleaseParity({ repoPath: repo, bundledPath: bundled, installedPath: installed });
  assert.equal(result.verified, false);
  assert.equal(result.trees.installed.state, "drifted");
  assert.match(result.trees.installed.error, /skill_release_file_drift/);
  assert.equal(result.upgradePlan.state, "upgrade_required");
  const cliDrifted = childProcess.spawnSync(process.execPath, [
    verifierCli,
    "--repo", repo,
    "--bundled", bundled,
    "--installed", installed,
  ], { encoding: "utf8" });
  assert.equal(cliDrifted.status, 1, "CLI must return non-zero when an explicitly supplied tree drifts");
  assert.equal(JSON.parse(cliDrifted.stdout).verified, false);
  assert.throws(
    () => verifySkillReleaseParity({ repoPath: repo, bundledPath: bundled, installedPath: installed }),
    /skill_release_parity_failed/,
  );

  fs.rmSync(installed, { recursive: true, force: true });
  fs.cpSync(repo, installed, { recursive: true });
  fs.writeFileSync(path.join(installed, "extra.txt"), "extra\n");
  result = inspectSkillReleaseParity({ repoPath: repo, installedPath: installed });
  assert.equal(result.verified, false);
  assert.match(result.trees.installed.error, /skill_release_file_set_mismatch/);

  fs.rmSync(installed, { recursive: true, force: true });
  fs.cpSync(repo, installed, { recursive: true });
  fs.unlinkSync(path.join(installed, "agents", "openai.yaml"));
  result = inspectSkillReleaseParity({ repoPath: repo, installedPath: installed });
  assert.equal(result.verified, false);
  assert.match(result.trees.installed.error, /skill_release_file_set_mismatch/);

  fs.rmSync(installed, { recursive: true, force: true });
  fs.cpSync(repo, installed, { recursive: true });
  const installedManifestPath = path.join(installed, MANIFEST_FILE_NAME);
  const tamperedManifest = JSON.parse(fs.readFileSync(installedManifestPath, "utf8"));
  tamperedManifest.releaseGeneration = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(installedManifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`);
  result = inspectSkillReleaseParity({ repoPath: repo, installedPath: installed });
  assert.equal(result.verified, false);
  assert.match(result.trees.installed.error, /not_canonical_or_generation_invalid/);

  fs.rmSync(installed, { recursive: true, force: true });
  fs.cpSync(repo, installed, { recursive: true });
  fs.unlinkSync(path.join(installed, "references", "complete-tree-sentinel.md"));
  fs.symlinkSync(path.join(repo, "references", "complete-tree-sentinel.md"), path.join(installed, "references", "complete-tree-sentinel.md"));
  result = inspectSkillReleaseParity({ repoPath: repo, installedPath: installed });
  assert.equal(result.verified, false);
  assert.match(result.trees.installed.error, /skill_release_symlink_forbidden/);

  const repoOnly = verifySkillReleaseParity({ repoPath: repo });
  assert.equal(repoOnly.verified, true);
  assert.equal(repoOnly.trees.bundled.state, "not_checked");
  assert.equal(repoOnly.trees.installed.state, "not_checked");
  assert.equal(repoOnly.upgradePlan.state, "not_assessed");

  const generatedOnce = fs.readFileSync(path.join(repo, MANIFEST_FILE_NAME));
  const first = writeSkillReleaseManifest(repo);
  const generatedTwice = fs.readFileSync(path.join(repo, MANIFEST_FILE_NAME));
  const second = writeSkillReleaseManifest(repo);
  assert.deepEqual(generatedTwice, generatedOnce, "generation must not contain timestamps or host paths");
  assert.equal(first.manifest.releaseGeneration, second.manifest.releaseGeneration);
  assert.deepEqual(fs.readFileSync(path.join(repo, MANIFEST_FILE_NAME)), generatedTwice);

  console.log("Skill release parity tests passed.");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
