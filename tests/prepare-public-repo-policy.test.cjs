const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const {
  assertOwnedStagingTarget,
  calculatePublicStagingPaths,
  privatePublicationTerms,
  privatePublicationTermPatterns,
  sanitizePublicCodeText,
  sanitizePublicDocText,
  sanitizePublicStagingScript,
} = require("../scripts/prepare-public-repo.cjs");

const privateTermPatterns = privatePublicationTermPatterns();
const privateTermsRe = privateTermPatterns.length > 0
  ? new RegExp(privateTermPatterns.join("|"), "i")
  : null;
const matchesPrivateTerm = (value) => privateTermsRe?.test(value) ?? false;

assert.equal(matchesPrivateTerm("yargs"), false, "private term scan must not match the npm package name yargs");
assert.equal(matchesPrivateTerm("args"), false, "private term scan must not match generic args identifiers");
assert.equal(matchesPrivateTerm("parseArgs"), false, "private term scan must not match camelCase parseArgs identifiers");
assert.equal(matchesPrivateTerm("wakeup"), false, "private term scan must not match generic wakeup identifiers");

const codeText = [
  'const yargs = require("yargs");',
  "function parseArgs(argv) { return yargs(argv); }",
  "const wakeupPattern = /wake|wakeup/;",
  "module.exports = { parseArgs, wakeupPattern };",
].join("\n");
const sanitizedCode = sanitizePublicCodeText(codeText);
assert.equal(sanitizedCode.includes("yargs"), true, "code sanitization must preserve yargs");
assert.equal(sanitizedCode.includes("parseArgs"), true, "code sanitization must preserve parseArgs");
assert.equal(sanitizedCode.includes("wakeupPattern"), true, "code sanitization must preserve wakeup identifiers");
assert.equal(sanitizedCode.includes("Example Project"), false, "code sanitization must not inject public placeholders into generic identifiers");

const lockText = JSON.stringify({
  packages: {
    "node_modules/yargs": {
      resolved: "https://registry.npmjs.org/yargs/-/yargs-17.7.2.tgz",
    },
    "node_modules/process-nextick-args": {
      resolved: "https://registry.npmjs.org/process-nextick-args/-/process-nextick-args-2.0.1.tgz",
    },
  },
});
const sanitizedLock = sanitizePublicCodeText(lockText);
const compactPlaceholder = ["Example", "Project"].join("");
assert.equal(sanitizedLock.includes("node_modules/yargs"), true, "lockfile sanitization must preserve yargs package paths");
assert.equal(sanitizedLock.includes("process-nextick-args"), true, "lockfile sanitization must preserve process-nextick-args package paths");
assert.equal(sanitizedLock.includes(`ya${compactPlaceholder}`), false, "lockfile sanitization must not corrupt yargs package names");
assert.equal(sanitizedLock.includes(`a${compactPlaceholder}`), false, "lockfile sanitization must not corrupt args package names");
assert.equal(sanitizedLock.includes("Example Project"), false, "lockfile sanitization must not inject public placeholders");

const privateTerms = privatePublicationTerms();
if (privateTerms.length > 0) {
  const [privateProjectName, privateAcronym] = [privateTerms[2], privateTerms[3]];
  const docText = `${privateAcronym} and ${privateProjectName} notes should not remain in public docs.`;
  const sanitizedDoc = sanitizePublicDocText(docText);
  assert.equal(sanitizedDoc.includes(privateAcronym), false, "doc sanitization should remove standalone private acronyms");
  assert.equal(sanitizedDoc.includes(privateProjectName), false, "doc sanitization should remove private project names");
  assert.equal(sanitizedDoc.includes("Example Project"), true, "doc sanitization should replace private terms with public examples");
} else {
  assert.deepEqual(privatePublicationTermPatterns(), [], "public policy tests must accept an intentionally empty private catalog");
}

const canonicalSourceRoot = path.resolve("C:\\Users\\example\\Documents\\Zhixia-Local-Doc-Knowledge\\app");
const canonicalPaths = calculatePublicStagingPaths(canonicalSourceRoot, false);
assert.equal(
  canonicalPaths.stagingDir,
  path.resolve(canonicalSourceRoot, "..", "public-staging", "zhixia-local-doc-knowledge"),
  "canonical app staging path must remain the repository sibling public-staging directory",
);

const publicCheckoutRoot = path.resolve("C:\\work\\zhixia-local-doc-knowledge");
const publicCheckoutPaths = calculatePublicStagingPaths(publicCheckoutRoot, true);
assert.equal(
  publicCheckoutPaths.stagingDir,
  path.join(publicCheckoutRoot, "public-staging", "zhixia-local-doc-knowledge"),
  "public checkout staging path must be nested below the source checkout",
);
assert.notEqual(publicCheckoutPaths.stagingDir, publicCheckoutRoot, "public staging target must never equal its source checkout");
assert.throws(
  () => assertOwnedStagingTarget(publicCheckoutRoot, publicCheckoutRoot, publicCheckoutRoot),
  /outside public-staging root|delete or overwrite the source checkout/,
  "containment policy must reject the source checkout as a staging target",
);

const canonicalScriptPath = path.join(__dirname, "..", "scripts", "prepare-public-repo.cjs");
const canonicalScript = fs.readFileSync(canonicalScriptPath, "utf8");
const publicScript = sanitizePublicStagingScript(canonicalScript);
for (const privateTerm of privateTerms) {
  assert.equal(
    publicScript.toLowerCase().includes(privateTerm.toLowerCase()),
    false,
    "public staging script must not expose a private publication term",
  );
}
assert.match(publicScript, /const publicCheckoutBootstrap = true;/, "public staging script must select public-checkout mode");

const publicModule = { exports: {} };
vm.runInNewContext(publicScript, {
  __dirname: path.join(publicCheckoutRoot, "scripts"),
  console,
  module: publicModule,
  exports: publicModule.exports,
  process,
  require,
}, { filename: "public-prepare-public-repo.cjs" });
assert.deepEqual(
  Array.from(publicModule.exports.privatePublicationTerms()),
  [],
  "public staging script must not reconstruct the canonical private publication catalog",
);
assert.deepEqual(
  Array.from(publicModule.exports.privatePublicationTermPatterns()),
  [],
  "public staging script must not reconstruct private publication patterns",
);
assert.equal(
  publicModule.exports.calculatePublicStagingPaths(publicCheckoutRoot).stagingDir,
  publicCheckoutPaths.stagingDir,
  "sanitized script must default to the nested public-checkout staging path",
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-public-repo-policy-"));
try {
  const fixtureCheckout = path.join(fixtureRoot, "public-checkout");
  const fixtureScripts = path.join(fixtureCheckout, "scripts");
  const fixtureGit = path.join(fixtureCheckout, ".git");
  fs.mkdirSync(fixtureScripts, { recursive: true });
  fs.mkdirSync(fixtureGit, { recursive: true });
  fs.writeFileSync(path.join(fixtureGit, "HEAD"), "ref: refs/heads/test\n", "utf8");
  fs.writeFileSync(path.join(fixtureCheckout, "README.md"), "# Public checkout fixture\n", "utf8");
  fs.writeFileSync(path.join(fixtureCheckout, "package.json"), JSON.stringify({
    name: "public-checkout-fixture",
    scripts: {
      dev: "fixture-dev",
      "dev:renderer": "fixture-renderer",
      "dev:electron": "fixture-electron",
      build: "fixture-build",
      test: "node tests/prepare-public-repo-policy.test.cjs",
      "prepare:public": "node scripts/prepare-public-repo.cjs",
    },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(fixtureScripts, "prepare-public-repo.cjs"), publicScript, "utf8");

  childProcess.execFileSync(process.execPath, [path.join(fixtureScripts, "prepare-public-repo.cjs")], {
    cwd: fixtureCheckout,
    encoding: "utf8",
    stdio: "pipe",
  });

  const nestedOutput = path.join(fixtureCheckout, "public-staging", "zhixia-local-doc-knowledge");
  assert.equal(fs.readFileSync(path.join(fixtureGit, "HEAD"), "utf8"), "ref: refs/heads/test\n", "public bootstrap must preserve source .git metadata");
  assert.equal(fs.existsSync(path.join(nestedOutput, "package.json")), true, "public bootstrap must create its nested owned output");
  assert.equal(fs.existsSync(path.join(nestedOutput, "scripts", "prepare-public-repo.cjs")), true, "nested output must remain self-bootstrap capable");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("prepare-public-repo policy tests passed");
