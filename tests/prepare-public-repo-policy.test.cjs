const assert = require("node:assert/strict");

const {
  privatePublicationTermPatterns,
  sanitizePublicCodeText,
  sanitizePublicDocText,
} = require("../scripts/prepare-public-repo.cjs");

const privateTermsRe = new RegExp(privatePublicationTermPatterns().join("|"), "i");

assert.equal(privateTermsRe.test("yargs"), false, "private term scan must not match the npm package name yargs");
assert.equal(privateTermsRe.test("args"), false, "private term scan must not match generic args identifiers");
assert.equal(privateTermsRe.test("parseArgs"), false, "private term scan must not match camelCase parseArgs identifiers");
assert.equal(privateTermsRe.test("wakeup"), false, "private term scan must not match generic wakeup identifiers");

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

const privateAcronym = ["R", "GS"].join("");
const privateProjectName = ["Ref", "muse"].join("");
const docText = `${privateAcronym} and ${privateProjectName} Game Studio notes should not remain in public docs.`;
const sanitizedDoc = sanitizePublicDocText(docText);
assert.equal(sanitizedDoc.includes(privateAcronym), false, "doc sanitization should remove standalone private acronyms");
assert.equal(sanitizedDoc.includes(privateProjectName), false, "doc sanitization should remove private project names");
assert.equal(sanitizedDoc.includes("Example Project"), true, "doc sanitization should replace private terms with public examples");

console.log("prepare-public-repo policy tests passed");
