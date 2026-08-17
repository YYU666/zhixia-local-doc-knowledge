const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");

const { MANIFEST_RELATIVE_PATH, writeSourceManifest } = require("../scripts/packaged-source-manifest.cjs");
const { verifyPackagedAppSource } = require("../scripts/verify-packaged-app-source.cjs");

const COMPLETE_ARCHIVE_CHILD = `
const asar = require(process.argv[1]);
const fs = require("node:fs");
const sourceRoot = process.argv[2];
const archivePath = process.argv[3];
const manifestPath = process.argv[4];
let packagePromiseResolved = false;
let completionChecked = false;
process.on("beforeExit", () => {
  if (!packagePromiseResolved || completionChecked) return;
  const archiveStat = fs.statSync(archivePath);
  asar.getRawHeader(archivePath);
  const manifest = JSON.parse(asar.extractFile(archivePath, manifestPath).toString("utf8"));
  if (!archiveStat.isFile() || manifest.entryCount !== manifest.entries.length) {
    throw new Error("test_asar_completion_validation_failed");
  }
  completionChecked = true;
  process.stdout.write(JSON.stringify({ bytes: archiveStat.size, entryCount: manifest.entryCount }));
});
asar.createPackage(sourceRoot, archivePath).then(() => {
  packagePromiseResolved = true;
}).catch((error) => {
  process.stderr.write(String(error?.stack || error));
  process.exitCode = 1;
});
`;

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertArchiveImmediatelyReadable(archivePath, expected) {
  const before = { bytes: fs.statSync(archivePath).size, sha256: sha256File(archivePath) };
  asar.getRawHeader(archivePath);
  const manifest = JSON.parse(asar.extractFile(archivePath, MANIFEST_RELATIVE_PATH).toString("utf8"));
  const after = { bytes: fs.statSync(archivePath).size, sha256: sha256File(archivePath) };
  assert.deepEqual(after, before, "archive bytes must be stable at the immediate parent-process read boundary");
  assert.equal(before.bytes, expected.bytes);
  assert.equal(manifest.entryCount, expected.entryCount);
}

function copyPackageTree(sourceRoot, targetRoot) {
  for (const relative of ["assets", "codex-skills", "dist", "electron"]) {
    fs.cpSync(path.join(sourceRoot, relative), path.join(targetRoot, relative), { recursive: true });
  }
  fs.copyFileSync(path.join(sourceRoot, "package.json"), path.join(targetRoot, "package.json"));
}

async function createArchiveFrom(sourceRoot, archivePath, mutate = () => {}) {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-package-tree-"));
  try {
    copyPackageTree(sourceRoot, packageRoot);
    mutate(packageRoot);
    const output = childProcess.execFileSync(process.execPath, [
      "-e",
      COMPLETE_ARCHIVE_CHILD,
      require.resolve("@electron/asar"),
      packageRoot,
      archivePath,
      MANIFEST_RELATIVE_PATH,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assertArchiveImmediatelyReadable(archivePath, JSON.parse(output));
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-packaged-source-"));
  try {
    for (const dir of ["assets", "codex-skills/zhixia-local-docs", "dist", "electron"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(root, "assets", "icon.txt"), "asset\n");
    fs.writeFileSync(path.join(root, "codex-skills", "zhixia-local-docs", "SKILL.md"), "skill\n");
    fs.mkdirSync(path.join(root, "codex-skills", "zhixia-local-docs", "agents"));
    fs.writeFileSync(path.join(root, "codex-skills", "zhixia-local-docs", "agents", "openai.yaml"), "agent: test\n");
    fs.writeFileSync(path.join(root, "dist", "index.html"), "renderer\n");
    fs.writeFileSync(path.join(root, "electron", "main.cjs"), "runtime\n");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "local-doc-knowledge",
      version: "0.0.0-test",
      main: "electron/main.cjs",
      productName: "Zhixia Test",
    }));
    fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n*.asar\n");
    const git = (args) => childProcess.execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git(["init", "-b", "test"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    git(["config", "user.name", "Fixture"]);
    git(["add", "."]);
    git(["commit", "-m", "fixture"]);
    const { manifest } = writeSourceManifest(root, { generatedAt: "2026-08-13T00:00:00.000Z" });
    const archive = path.join(root, "app.asar");
    await createArchiveFrom(root, archive);
    const receipt = verifyPackagedAppSource({ asarPath: archive, sourceRoot: root });
    assert.equal(receipt.verified, true);
    assert.equal(receipt.entryCount, 5);
    assert.deepEqual(receipt.sourcePostimage, manifest.sourcePostimage);
    assert.equal(receipt.gitPostimageRecomputed, true);
    assert.equal(receipt.sourceFileSetEnumerated, true);

    const ignoredSentinel = path.join(root, "dist", "audit-unmanifested-sentinel.txt");
    fs.writeFileSync(ignoredSentinel, "ignored eligible sentinel\n");
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: archive, sourceRoot: root }),
      /packaged_source_manifest_source_file_set_mismatch/,
      "an eligible Git-ignored source file absent from manifest and asar must fail",
    );
    fs.unlinkSync(ignoredSentinel);

    const sourceMissing = path.join(root, "dist", "index.html");
    const sourceMissingBytes = fs.readFileSync(sourceMissing);
    fs.unlinkSync(sourceMissing);
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: archive, sourceRoot: root }),
      /packaged_source_manifest_source_file_set_mismatch/,
      "an eligible manifest entry missing from the source root must fail",
    );
    fs.writeFileSync(sourceMissing, sourceMissingBytes);

    const manifestMissingArchive = path.join(root, "manifest-missing.asar");
    await createArchiveFrom(root, manifestMissingArchive, (packageRoot) => {
      const manifestPath = path.join(packageRoot, "dist", "zhixia-source-postimage-manifest.json");
      const packagedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      packagedManifest.entries = packagedManifest.entries.filter((entry) => entry.path !== "electron/main.cjs");
      packagedManifest.entryCount = packagedManifest.entries.length;
      fs.writeFileSync(manifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`);
    });
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: manifestMissingArchive, sourceRoot: root }),
      /packaged_source_manifest_source_file_set_mismatch/,
      "a source-eligible file omitted from manifest must fail",
    );

    const manifestExtraArchive = path.join(root, "manifest-extra.asar");
    await createArchiveFrom(root, manifestExtraArchive, (packageRoot) => {
      const manifestPath = path.join(packageRoot, "dist", "zhixia-source-postimage-manifest.json");
      const packagedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      packagedManifest.entries.push({ path: "electron/ghost.cjs", bytes: 0, sha256: "0".repeat(64) });
      packagedManifest.entryCount = packagedManifest.entries.length;
      fs.writeFileSync(manifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`);
    });
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: manifestExtraArchive, sourceRoot: root }),
      /packaged_source_manifest_source_file_set_mismatch/,
      "a manifest entry absent from the authoritative source set must fail",
    );

    const archiveMissing = path.join(root, "archive-missing.asar");
    await createArchiveFrom(root, archiveMissing, (packageRoot) => {
      fs.unlinkSync(path.join(packageRoot, "assets", "icon.txt"));
    });
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: archiveMissing, sourceRoot: root }),
      /packaged_source_manifest_archive_file_set_mismatch/,
      "an eligible manifest/source file absent from asar must fail",
    );

    const archiveExtra = path.join(root, "archive-extra.asar");
    await createArchiveFrom(root, archiveExtra, (packageRoot) => {
      fs.writeFileSync(path.join(packageRoot, "electron", "archive-extra.cjs"), "extra\n");
    });
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: archiveExtra, sourceRoot: root }),
      /packaged_source_manifest_archive_file_set_mismatch/,
      "an eligible asar file absent from manifest/source must fail",
    );

    const archiveSymlink = path.join(root, "archive-symlink.asar");
    await createArchiveFrom(root, archiveSymlink, (packageRoot) => {
      const runtimePath = path.join(packageRoot, "electron", "main.cjs");
      fs.unlinkSync(runtimePath);
      fs.symlinkSync("../assets/icon.txt", runtimePath);
    });
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: archiveSymlink, sourceRoot: root }),
      /packaged_source_archive_symlink_forbidden:electron\/main\.cjs/,
      "an eligible asar symlink must fail even when it resolves to manifest-listed bytes",
    );

    fs.writeFileSync(path.join(root, "electron", "main.cjs"), "mutated runtime\n");
    assert.throws(
      () => verifyPackagedAppSource({ asarPath: archive, sourceRoot: root }),
      /packaged_source_git_postimage_mismatch/,
      "Git postimage drift after packaging must fail equivalence verification before file comparison",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("Packaged source manifest tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
