const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_SCHEMA = "zhixia.packaged_source_postimage.v1";
const MANIFEST_RELATIVE_PATH = "dist/zhixia-source-postimage-manifest.json";
const PACKAGED_SOURCE_ROOTS = Object.freeze([
  "assets",
  "codex-skills/zhixia-local-docs",
  "dist",
  "electron",
]);
const PACKAGED_SOURCE_POLICY = Object.freeze({
  schemaVersion: "zhixia.packaged_source_inclusion_policy.v1",
  roots: [...PACKAGED_SOURCE_ROOTS],
  inclusion: "all_regular_files_recursive",
  excludedPaths: [MANIFEST_RELATIVE_PATH],
  symlinkPolicy: "forbid",
  specialFilePolicy: "forbid",
});

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function listFiles(root, relativeRoot) {
  const files = [];
  const start = path.join(root, relativeRoot);
  if (!fs.existsSync(start)) throw new Error(`packaged_source_root_missing:${relativeRoot}`);
  const rootStat = fs.lstatSync(start);
  if (rootStat.isSymbolicLink()) throw new Error(`packaged_source_symlink_forbidden:${relativeRoot}`);
  if (!rootStat.isDirectory()) throw new Error(`packaged_source_root_not_directory:${relativeRoot}`);
  function walk(current, relative) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
      const entryRelative = path.join(relative, entry.name);
      const fullPath = path.join(current, entry.name);
      const entryPath = toPosix(entryRelative);
      const entryStat = fs.lstatSync(fullPath);
      if (entryStat.isSymbolicLink()) throw new Error(`packaged_source_symlink_forbidden:${entryPath}`);
      if (entryStat.isDirectory()) walk(fullPath, entryRelative);
      else if (!entryStat.isFile()) throw new Error(`packaged_source_special_file_forbidden:${entryPath}`);
      else if (!PACKAGED_SOURCE_POLICY.excludedPaths.includes(entryPath)) files.push(entryRelative);
    }
  }
  walk(start, relativeRoot);
  return files;
}

function enumeratePackagedSourceFiles(root) {
  const resolvedRoot = path.resolve(root);
  return PACKAGED_SOURCE_ROOTS.flatMap((sourceRoot) => listFiles(resolvedRoot, sourceRoot))
    .map(toPosix)
    .sort(comparePaths);
}

function sourcePolicySha256() {
  return sha256Buffer(Buffer.from(JSON.stringify(PACKAGED_SOURCE_POLICY), "utf8"));
}

function readGitPostimage(root) {
  const exec = (args) => childProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const status = childProcess.execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  );
  const changedPaths = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, ""))
    .sort();
  return {
    head: exec(["rev-parse", "HEAD"]),
    branch: exec(["branch", "--show-current"]),
    statusPathCount: changedPaths.length,
    statusSha256: sha256Buffer(Buffer.from(status, "utf8")),
    changedPaths,
  };
}

function buildSourceManifest(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const files = enumeratePackagedSourceFiles(resolvedRoot);
  const entries = files.map((relativePath) => {
    const bytes = fs.readFileSync(path.join(resolvedRoot, relativePath));
    return {
      path: toPosix(relativePath),
      bytes: bytes.length,
      sha256: sha256Buffer(bytes),
    };
  });
  return {
    schemaVersion: MANIFEST_SCHEMA,
    generatedAt: options.generatedAt || new Date().toISOString(),
    sourcePostimage: options.sourcePostimage || readGitPostimage(resolvedRoot),
    packagedSourceRoots: [...PACKAGED_SOURCE_ROOTS],
    inclusionPolicy: PACKAGED_SOURCE_POLICY,
    inclusionPolicySha256: sourcePolicySha256(),
    entryCount: entries.length,
    entries,
  };
}

function writeSourceManifest(root, options = {}) {
  const manifest = buildSourceManifest(root, options);
  const target = path.join(path.resolve(root), MANIFEST_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, target, sha256: sha256Buffer(fs.readFileSync(target)) };
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const result = writeSourceManifest(root);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: result.manifest.schemaVersion,
    manifestPath: path.relative(root, result.target),
    manifestSha256: result.sha256,
    entryCount: result.manifest.entryCount,
    sourcePostimage: result.manifest.sourcePostimage,
  })}\n`);
}

if (require.main === module) main();

module.exports = {
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA,
  PACKAGED_SOURCE_ROOTS,
  PACKAGED_SOURCE_POLICY,
  buildSourceManifest,
  comparePaths,
  enumeratePackagedSourceFiles,
  readGitPostimage,
  sha256Buffer,
  sourcePolicySha256,
  writeSourceManifest,
};
