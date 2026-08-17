const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  APP_ASAR_RELATIVE,
  verifyFullArtifactManifest,
  writeFullArtifactManifest,
} = require("../scripts/full-artifact-evidence.cjs");

const CREATE_ASAR_CHILD = `
const asar = require(process.argv[1]);
const fs = require("node:fs");
asar.createPackage(process.argv[2], process.argv[3]).then(() => {
  process.on("beforeExit", () => {
    asar.getRawHeader(process.argv[3]);
    fs.statSync(process.argv[3]);
  });
}).catch((error) => {
  process.stderr.write(String(error?.stack || error));
  process.exitCode = 1;
});
`;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createAsar(packageRoot, asarPath) {
  fs.mkdirSync(path.dirname(asarPath), { recursive: true });
  childProcess.execFileSync(process.execPath, [
    "-e",
    CREATE_ASAR_CHILD,
    require.resolve("@electron/asar"),
    packageRoot,
    asarPath,
  ], { stdio: "pipe" });
}

function createFixture(root) {
  const appRoot = path.join(root, "release-mac", "mac-arm64", "Zhixia.app");
  const packageRoot = path.join(root, "package-tree");
  writeJson(path.join(root, "package.json"), {
    name: "zhixia-artifact-fixture",
    version: "1.2.3",
    productName: "Zhixia Fixture",
    dependencies: { alpha: "1.0.0" },
  });
  writeJson(path.join(root, "package-lock.json"), {
    name: "zhixia-artifact-fixture",
    version: "1.2.3",
    lockfileVersion: 3,
    packages: {
      "": { name: "zhixia-artifact-fixture", version: "1.2.3", dependencies: { alpha: "1.0.0" } },
      "node_modules/alpha": {
        version: "1.0.0",
        resolved: "https://registry.invalid/alpha-1.0.0.tgz",
        integrity: "sha512-fixture-alpha",
        license: "MIT",
        dependencies: { beta: "1.0.0" },
      },
      "node_modules/beta": {
        version: "1.0.0",
        resolved: "https://registry.invalid/beta-1.0.0.tgz",
        integrity: "sha512-fixture-beta",
        license: "Apache-2.0",
      },
      "node_modules/dev-only": { version: "9.0.0", dev: true, license: "MIT" },
    },
  });
  writeJson(path.join(root, "electron-builder.mac.json"), {
    appId: "invalid.fixture.zhixia",
    productName: "Zhixia Fixture",
    asar: true,
    directories: { output: "release-mac", buildResources: "build-resources" },
    files: ["dist/**/*", "electron/**/*", "package.json"],
    mac: { target: [{ target: "dir", arch: ["arm64"] }], icon: "assets/icon.png", identity: null },
  });
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), "name: fixture\n");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const name of ["full-artifact-evidence.cjs", "packaged-source-manifest.cjs", "verify-packaged-app-source.cjs"]) {
    fs.writeFileSync(path.join(root, "scripts", name), `// ${name}\n`);
  }
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "tests", "full-artifact-evidence.test.cjs"), "// fixture test\n");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "icon.png"), "fixture icon");
  fs.mkdirSync(path.join(root, "build-resources"), { recursive: true });
  fs.writeFileSync(path.join(root, "build-resources", "background.txt"), "fixture resource");
  writeJson(path.join(root, "node_modules", "alpha", "package.json"), { name: "alpha", version: "1.0.0", license: "MIT" });
  writeJson(path.join(root, "node_modules", "beta", "package.json"), { name: "beta", version: "1.0.0", license: "Apache-2.0" });

  writeJson(path.join(packageRoot, "package.json"), { name: "zhixia-artifact-fixture", version: "1.2.3" });
  fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "dist", "index.html"), "fixture renderer");
  createAsar(packageRoot, path.join(appRoot, APP_ASAR_RELATIVE));
  fs.writeFileSync(path.join(appRoot, "Contents", "Info.plist"), "fixture plist");
  fs.mkdirSync(path.join(appRoot, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(appRoot, "Contents", "MacOS", "Zhixia"), "fixture executable");
  return { appRoot, packageRoot };
}

function copyFixture(sourceRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-full-artifact-copy-"));
  fs.cpSync(sourceRoot, root, { recursive: true });
  return root;
}

function assertFailureAfterMutation(baselineRoot, mutate, pattern, message) {
  const root = copyFixture(baselineRoot);
  try {
    const appRoot = path.join(root, "release-mac", "mac-arm64", "Zhixia.app");
    const manifestPath = path.join(root, "release-evidence", "manifest.json");
    mutate({ root, appRoot, manifestPath });
    assert.throws(() => verifyFullArtifactManifest({ sourceRoot: root, appRoot, manifestPath }), pattern, message);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-full-artifact-"));
  try {
    const { appRoot } = createFixture(root);
    const manifestPath = path.join(root, "release-evidence", "manifest.json");
    const generated = writeFullArtifactManifest({ sourceRoot: root, appRoot, manifestPath });
    assert.equal(generated.manifest.receiptTier, "full-artifact");
    assert.equal(generated.manifest.productionSbom.componentCount, 2, "dev-only packages must not enter the production closure");
    assert.deepEqual(generated.manifest.productionSbom.components.map((item) => item.name), ["alpha", "beta"]);
    assert.equal(generated.manifest.receiptTiers.signedDistribution.eligible, false);
    const receipt = verifyFullArtifactManifest({ sourceRoot: root, appRoot, manifestPath });
    assert.equal(receipt.verified, true);
    assert.equal(receipt.receiptTier, "full-artifact");
    assert.equal(receipt.signedDistributionEligible, false);

    assert.throws(
      () => verifyFullArtifactManifest({ sourceRoot: root, appRoot, manifestPath, requireTier: "signed-distribution" }),
      /signed_distribution_evidence_missing/,
      "an unsigned local artifact must never satisfy the signed-distribution tier",
    );

    assertFailureAfterMutation(root, ({ appRoot: target }) => {
      fs.writeFileSync(path.join(target, "Contents", "unexpected-resource.dat"), "extra");
    }, /artifact_bundle_file_set_mismatch/, "an unmanifested generated bundle extra must fail closed");

    assertFailureAfterMutation(root, ({ appRoot: target }) => {
      fs.unlinkSync(path.join(target, "Contents", "Info.plist"));
    }, /artifact_bundle_file_set_mismatch/, "a missing generated bundle resource must fail closed");

    assertFailureAfterMutation(root, ({ appRoot: target }) => {
      fs.writeFileSync(path.join(target, "Contents", "Info.plist"), "mutated plist");
    }, /artifact_bundle_entry_mismatch:Contents\/Info\.plist/, "a generated resource hash mismatch must fail closed");

    assertFailureAfterMutation(root, ({ root: target }) => {
      fs.appendFileSync(path.join(target, "package-lock.json"), " \n");
    }, /artifact_source_entry_mismatch:package-lock\.json/, "package-lock bytes must bind the candidate");

    assertFailureAfterMutation(root, ({ root: target }) => {
      fs.appendFileSync(path.join(target, "scripts", "full-artifact-evidence.cjs"), "// drift\n");
    }, /artifact_source_entry_mismatch:scripts\/full-artifact-evidence\.cjs/, "the verifier implementation postimage must bind the receipt");

    assertFailureAfterMutation(root, ({ root: target }) => {
      fs.writeFileSync(path.join(target, "build-resources", "new-resource.txt"), "new");
    }, /artifact_source_file_set_mismatch/, "an unmanifested eligible build resource must fail closed");

    assertFailureAfterMutation(root, ({ appRoot: target }) => {
      const asarPath = path.join(target, APP_ASAR_RELATIVE);
      const replacement = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-asar-mutated-"));
      try {
        writeJson(path.join(replacement, "package.json"), { name: "zhixia-artifact-fixture", version: "1.2.3" });
        fs.mkdirSync(path.join(replacement, "dist"), { recursive: true });
        fs.writeFileSync(path.join(replacement, "dist", "index.html"), "fixture renderer");
        fs.writeFileSync(path.join(replacement, "dist", "unexpected.js"), "extra archive entry");
        createAsar(replacement, asarPath);
      } finally {
        fs.rmSync(replacement, { recursive: true, force: true });
      }
    }, /artifact_asar_file_set_mismatch/, "an app.asar extra must fail closed at the complete archive file set");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("Full artifact evidence tests passed.");
})();
