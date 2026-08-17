const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildCandidateManifest,
  npmExecutable,
  verifyCandidateManifest,
  writeCandidateManifest,
} = require("../scripts/candidate-evidence.cjs");

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function json(root, relativePath, value) {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, args) {
  return childProcess.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-candidate-evidence-"));
  json(root, "package.json", {
    name: "candidate-fixture",
    version: "1.0.0",
    scripts: {
      test: "node tests/candidate-evidence.test.cjs",
      "test:candidate-evidence": "node tests/candidate-evidence.test.cjs",
      "test:artifact-evidence": "node tests/full-artifact-evidence.test.cjs",
      "memory:gate": "node scripts/run-memory-release-benchmark.cjs",
      build: "echo build",
    },
  });
  json(root, "package-lock.json", { name: "candidate-fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "candidate-fixture", version: "1.0.0" } } });
  write(root, ".gitignore", "node_modules/\nrelease-evidence/\ndist/\n");
  write(root, ".github/workflows/ci.yml", "name: fixture\n");
  write(root, "electron-builder.mac.json", "{}\n");
  for (const relativePath of [
    "scripts/candidate-evidence.cjs",
    "scripts/full-artifact-evidence.cjs",
    "scripts/packaged-source-manifest.cjs",
    "scripts/verify-packaged-app-source.cjs",
    "scripts/enforce-memory-benchmark-gate.cjs",
    "scripts/run-memory-release-benchmark.cjs",
    "tests/candidate-evidence.test.cjs",
    "tests/full-artifact-evidence.test.cjs",
    "benchmarks/corpus.json",
  ]) write(root, relativePath, `${relativePath}\n`);
  git(root, ["init", "-b", "fixture"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}

function assertPostimageMismatch(root, manifestPath, mutate, message) {
  mutate();
  assert.throws(
    () => verifyCandidateManifest({ root, manifestPath }),
    /candidate_current_postimage_mismatch/,
    message,
  );
}

assert.equal(npmExecutable("win32"), "npm.cmd");
assert.equal(npmExecutable("darwin"), "npm");

(() => {
  const root = fixture();
  try {
    write(root, "tracked.txt", "base\n");
    git(root, ["add", "tracked.txt"]);
    git(root, ["commit", "-m", "tracked baseline"]);
    write(root, "tracked.txt", "dirty postimage\n");
    write(root, "untracked.txt", "untracked postimage\n");
    fs.unlinkSync(path.join(root, "electron-builder.mac.json"));
    let symlinkCreated = false;
    try {
      fs.symlinkSync("tracked.txt", path.join(root, "dirty-link"));
      symlinkCreated = true;
    } catch (error) {
      if (process.platform !== "win32" || !["EACCES", "EPERM"].includes(error?.code)) throw error;
    }

    const built = buildCandidateManifest({ root });
    assert.match(built.candidateId, /^[a-f0-9]{64}$/);
    assert.equal(built.payload.authorityBoundary.publicReleaseEligible, false);
    assert.equal(built.payload.authorityBoundary.commitCreated, false);
    assert.equal(built.payload.commandManifest.executionState, "not_recorded");
    assert.match(built.payload.commandManifest.manifestSha256, /^[a-f0-9]{64}$/);
    for (const manifest of Object.values(built.payload.evidenceManifests)) {
      assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
      assert.equal(manifest.entryCount, manifest.entries.length);
    }
    const dirtyByPath = Object.fromEntries(built.payload.dirtyPostimage.entries.map((entry) => [entry.path, entry]));
    assert.equal(dirtyByPath["tracked.txt"].kind, "file");
    assert.equal(dirtyByPath["untracked.txt"].kind, "file");
    assert.equal(dirtyByPath["electron-builder.mac.json"].kind, "missing");
    if (symlinkCreated) assert.equal(dirtyByPath["dirty-link"].kind, "symlink");

    const { manifestPath } = writeCandidateManifest({ root });
    const receipt = verifyCandidateManifest({ root, manifestPath });
    assert.equal(receipt.verified, true);
    assert.equal(receipt.candidateId, built.candidateId);
    assert.equal(receipt.publicReleaseEligible, false);
    assert.equal(writeCandidateManifest({ root }).manifestPath, manifestPath, "same postimage must idempotently reuse its content address");

    const trackedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-candidate-mutation-"));
    fs.cpSync(root, trackedRoot, { recursive: true, verbatimSymlinks: true });
    const copiedManifest = path.join(trackedRoot, path.relative(root, manifestPath));
    assertPostimageMismatch(trackedRoot, copiedManifest, () => {
      write(trackedRoot, "tracked.txt", "drifted bytes\n");
    }, "changing any tracked dirty postimage bytes must invalidate the candidate");
    fs.rmSync(trackedRoot, { recursive: true, force: true });

    const untrackedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-candidate-mutation-"));
    fs.cpSync(root, untrackedRoot, { recursive: true, verbatimSymlinks: true });
    assertPostimageMismatch(untrackedRoot, path.join(untrackedRoot, path.relative(root, manifestPath)), () => {
      write(untrackedRoot, "untracked.txt", "drifted untracked bytes\n");
    }, "changing any untracked postimage bytes must invalidate the candidate");
    fs.rmSync(untrackedRoot, { recursive: true, force: true });

    const statusRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-candidate-mutation-"));
    fs.cpSync(root, statusRoot, { recursive: true, verbatimSymlinks: true });
    assertPostimageMismatch(statusRoot, path.join(statusRoot, path.relative(root, manifestPath)), () => {
      git(statusRoot, ["add", "tracked.txt"]);
    }, "changing porcelain status with identical worktree bytes must invalidate the candidate");
    fs.rmSync(statusRoot, { recursive: true, force: true });

    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-candidate-mutation-"));
    fs.cpSync(root, evidenceRoot, { recursive: true, verbatimSymlinks: true });
    assertPostimageMismatch(evidenceRoot, path.join(evidenceRoot, path.relative(root, manifestPath)), () => {
      write(evidenceRoot, "tests/new-test.cjs", "new test\n");
    }, "test-manifest extras must invalidate the candidate");
    fs.rmSync(evidenceRoot, { recursive: true, force: true });

    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    tampered.payload.authorityBoundary.publicReleaseEligible = true;
    const tamperedPath = path.join(root, "release-evidence", "tampered.json");
    json(root, path.relative(root, tamperedPath), tampered);
    assert.throws(
      () => verifyCandidateManifest({ root, manifestPath: tamperedPath }),
      /candidate_manifest_content_address_mismatch/,
      "a stored claim cannot be changed without invalidating the content address",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("Candidate evidence tests passed.");
})();
