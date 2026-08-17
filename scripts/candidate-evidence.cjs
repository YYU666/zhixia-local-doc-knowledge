const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_SCHEMA = "zhixia.content_addressed_candidate.v1";
const RECEIPT_SCHEMA = "zhixia.content_addressed_candidate_receipt.v1";
const DEFAULT_OUTPUT_ROOT = "release-evidence/candidates";
const TEST_ROOTS = Object.freeze(["tests"]);
const BENCHMARK_ROOTS = Object.freeze(["benchmarks"]);
const TEST_CONTROL_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  "package.json",
  "package-lock.json",
]);
const BENCHMARK_CONTROL_PATHS = Object.freeze([
  "scripts/enforce-memory-benchmark-gate.cjs",
  "scripts/run-memory-release-benchmark.cjs",
]);
const ARTIFACT_CONTROL_PATHS = Object.freeze([
  "electron-builder.mac.json",
  "scripts/candidate-evidence.cjs",
  "scripts/full-artifact-evidence.cjs",
  "scripts/packaged-source-manifest.cjs",
  "scripts/verify-packaged-app-source.cjs",
  "tests/candidate-evidence.test.cjs",
  "tests/full-artifact-evidence.test.cjs",
]);
const ARTIFACT_OUTPUT_PATHS = Object.freeze([
  "dist/zhixia-source-postimage-manifest.json",
  "release-evidence/zhixia-full-artifact-manifest.json",
]);
const POLICY = Object.freeze({
  schemaVersion: "zhixia.content_addressed_candidate_policy.v1",
  gitIdentity: "current_head_branch_and_exact_porcelain_v1_z_sha256",
  dirtyPostimage: "all_porcelain_paths_with_status_and_current_regular_file_or_symlink_bytes; deleted_paths_are_explicit_missing_entries",
  cleanSourceIdentity: "current_head_committed_tree",
  ignoredFiles: "excluded_unless_explicitly_listed_in_an_evidence_manifest",
  candidateAddress: "sha256_of_canonical_payload_without_candidate_id",
  output: "ignored_external_receipt_directory_with_atomic_no_clobber_publish",
  executionClaims: "commands_and_implementation_manifests_only; no_pass_inferred",
  releaseBoundary: "local_dirty_candidate_only; commit_tag_signing_notarization_and_public_release_require_separate_authority",
});

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function gitBuffer(root, args) {
  return childProcess.execFileSync("git", args, { cwd: root, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
}

function gitText(root, args) {
  return gitBuffer(root, args).toString("utf8").trim();
}

function assertRelativePath(relativePath, code = "candidate_path_invalid") {
  const normalized = toPosix(relativePath);
  if (!normalized || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${code}:${normalized}`);
  }
  return normalized;
}

function assertInside(root, target, code) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return;
  throw new Error(`${code}:${toPosix(relative)}`);
}

function splitNul(buffer) {
  const records = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    records.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) throw new Error("candidate_git_porcelain_not_nul_terminated");
  return records;
}

function decodePath(bytes) {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) throw new Error("candidate_git_path_not_utf8");
  return assertRelativePath(decoded, "candidate_git_path_invalid");
}

function parsePorcelainV1Z(buffer) {
  const records = splitNul(buffer);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== 0x20) throw new Error("candidate_git_porcelain_record_invalid");
    const status = record.subarray(0, 2).toString("ascii");
    const currentPath = decodePath(record.subarray(3));
    const entry = { status, path: currentPath, originalPath: null };
    if (status.includes("R") || status.includes("C")) {
      index += 1;
      if (index >= records.length) throw new Error("candidate_git_porcelain_rename_source_missing");
      entry.originalPath = decodePath(records[index]);
    }
    entries.push(entry);
  }
  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

function postimageEntry(root, relativePath) {
  const normalized = assertRelativePath(relativePath);
  const target = path.join(root, normalized);
  assertInside(root, target, "candidate_postimage_escape");
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return { path: normalized, kind: "missing", bytes: null, sha256: null, linkTarget: null };
    throw error;
  }
  if (stat.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(target);
    const bytes = Buffer.from(linkTarget, "utf8");
    return { path: normalized, kind: "symlink", bytes: bytes.length, sha256: sha256Buffer(bytes), linkTarget };
  }
  if (!stat.isFile()) throw new Error(`candidate_postimage_special_file_forbidden:${normalized}`);
  const bytes = fs.readFileSync(target);
  return { path: normalized, kind: "file", bytes: bytes.length, sha256: sha256Buffer(bytes), linkTarget: null };
}

function readDirtyPostimage(root) {
  const porcelain = gitBuffer(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const parsed = parsePorcelainV1Z(porcelain);
  const seen = new Set();
  const entries = parsed.map((item) => {
    if (seen.has(item.path)) throw new Error(`candidate_dirty_path_duplicate:${item.path}`);
    seen.add(item.path);
    return { status: item.status, originalPath: item.originalPath, ...postimageEntry(root, item.path) };
  });
  return {
    format: "git_status_porcelain_v1_z",
    porcelainBytes: porcelain.length,
    porcelainSha256: sha256Buffer(porcelain),
    pathCount: entries.length,
    entries,
  };
}

function enumerateTree(root, relativeRoot) {
  const normalizedRoot = assertRelativePath(relativeRoot);
  const start = path.join(root, normalizedRoot);
  if (!fs.existsSync(start)) return [];
  const entries = [];
  const visit = (directory, relative) => {
    const rootStat = fs.lstatSync(directory);
    if (rootStat.isSymbolicLink()) {
      entries.push(postimageEntry(root, relative));
      return;
    }
    if (!rootStat.isDirectory()) throw new Error(`candidate_manifest_root_not_directory:${toPosix(relative)}`);
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
      const childRelative = path.join(relative, item.name);
      const child = path.join(directory, item.name);
      const stat = fs.lstatSync(child);
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(child, childRelative);
      else entries.push(postimageEntry(root, childRelative));
    }
  };
  visit(start, normalizedRoot);
  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

function explicitPathEntries(root, relativePaths) {
  return [...relativePaths].sort(comparePaths).map((relativePath) => postimageEntry(root, relativePath));
}

function uniqueEntries(entries) {
  const byPath = new Map();
  for (const entry of entries) byPath.set(entry.path, entry);
  return [...byPath.values()].sort((left, right) => comparePaths(left.path, right.path));
}

function readPackage(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function readToolchain(root) {
  const version = (relativePath) => {
    const packagePath = path.join(root, relativePath, "package.json");
    return fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, "utf8")).version || null : null;
  };
  return {
    node: process.version,
    npm: childProcess.execFileSync(npmExecutable(), ["--version"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    platform: process.platform,
    arch: process.arch,
    electron: version("node_modules/electron"),
    electronBuilder: version("node_modules/electron-builder"),
    asar: version("node_modules/@electron/asar"),
  };
}

function commandManifest(root) {
  const scripts = readPackage(root).scripts || {};
  const names = [
    "test",
    "test:artifact-evidence",
    "test:candidate-evidence",
    "test:electron-security",
    "test:electron-release",
    "memory:gate",
    "build",
    "dist:mac",
    "verify:app-source",
    "release:artifact-manifest",
    "verify:artifact",
    "verify:release-candidate",
  ];
  const payload = {
    executionState: "not_recorded",
    installCommand: "npm ci",
    scripts: Object.fromEntries(names.map((name) => [name, scripts[name] || null])),
    note: "Binding a command does not prove it ran or passed; separate execution receipts are required.",
  };
  return { ...payload, manifestSha256: sha256Buffer(canonicalBytes(payload)) };
}

function addressedEvidenceManifest(policy, entries) {
  const payload = { policy, entryCount: entries.length, entries };
  return { ...payload, manifestSha256: sha256Buffer(canonicalBytes(payload)) };
}

function buildEvidenceManifests(root) {
  return {
    tests: addressedEvidenceManifest(
      "all_regular_files_and_symlinks_under_tests_plus_ci_package_and_lock",
      uniqueEntries([
        ...TEST_ROOTS.flatMap((relativeRoot) => enumerateTree(root, relativeRoot)),
        ...explicitPathEntries(root, TEST_CONTROL_PATHS),
      ]),
    ),
    benchmarks: addressedEvidenceManifest(
      "all_regular_files_and_symlinks_under_benchmarks_plus_runner_and_gate",
      uniqueEntries([
        ...BENCHMARK_ROOTS.flatMap((relativeRoot) => enumerateTree(root, relativeRoot)),
        ...explicitPathEntries(root, BENCHMARK_CONTROL_PATHS),
      ]),
    ),
    artifacts: addressedEvidenceManifest(
      "artifact_evidence_implementations_and_explicit_local_output_manifests",
      uniqueEntries([
        ...explicitPathEntries(root, ARTIFACT_CONTROL_PATHS),
        ...explicitPathEntries(root, ARTIFACT_OUTPUT_PATHS),
      ]),
    ),
  };
}

function buildCandidatePayload(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const packageLock = postimageEntry(root, "package-lock.json");
  if (packageLock.kind !== "file") throw new Error("candidate_package_lock_missing");
  return {
    schemaVersion: MANIFEST_SCHEMA,
    policy: POLICY,
    policySha256: sha256Buffer(canonicalBytes(POLICY)),
    sourceIdentity: {
      branch: gitText(root, ["branch", "--show-current"]),
      head: gitText(root, ["rev-parse", "HEAD"]),
      headTree: gitText(root, ["rev-parse", "HEAD^{tree}"]),
    },
    dirtyPostimage: readDirtyPostimage(root),
    packageLock,
    toolchain: readToolchain(root),
    commandManifest: commandManifest(root),
    evidenceManifests: buildEvidenceManifests(root),
    authorityBoundary: {
      candidateKind: "local_dirty_postimage",
      commitCreated: false,
      tagCreated: false,
      signingPerformed: false,
      notarizationPerformed: false,
      publicReleaseEligible: false,
      residual: "Commit, tag, signing, notarization, upload, installation, and public release require separate explicit authority and evidence.",
    },
  };
}

function candidateId(payload) {
  return sha256Buffer(canonicalBytes(payload));
}

function buildCandidateManifest(options = {}) {
  const payload = buildCandidatePayload(options);
  return { schemaVersion: MANIFEST_SCHEMA, candidateId: candidateId(payload), payload };
}

function resolveManifestPath(root, candidate, outputRoot = DEFAULT_OUTPUT_ROOT) {
  const resolvedOutputRoot = path.resolve(root, outputRoot);
  assertInside(root, resolvedOutputRoot, "candidate_output_escape");
  return path.join(resolvedOutputRoot, `candidate-${candidate.candidateId}.json`);
}

function writeCandidateManifest(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const manifest = buildCandidateManifest({ root });
  const manifestPath = options.manifestPath
    ? path.resolve(options.manifestPath)
    : resolveManifestPath(root, manifest, options.outputRoot);
  assertInside(root, manifestPath, "candidate_output_escape");
  const bytes = Buffer.from(prettyJson(manifest), "utf8");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(manifestPath)) {
    if (!fs.readFileSync(manifestPath).equals(bytes)) throw new Error("candidate_manifest_content_address_collision");
  } else {
    const temporary = `${manifestPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    try {
      fs.linkSync(temporary, manifestPath);
    } catch (error) {
      if (error?.code !== "EEXIST" || !fs.readFileSync(manifestPath).equals(bytes)) throw error;
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return { manifest, manifestPath, manifestSha256: sha256Buffer(bytes) };
}

function verifyCandidateManifest(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const manifestPath = path.resolve(String(options.manifestPath || ""));
  if (!manifestPath || !fs.existsSync(manifestPath)) throw new Error("candidate_manifest_missing");
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.schemaVersion !== MANIFEST_SCHEMA || manifest.payload?.schemaVersion !== MANIFEST_SCHEMA) throw new Error("candidate_manifest_schema_invalid");
  const storedId = candidateId(manifest.payload);
  if (manifest.candidateId !== storedId) throw new Error("candidate_manifest_content_address_mismatch");
  const actual = buildCandidateManifest({ root });
  if (actual.candidateId !== manifest.candidateId || !canonicalBytes(actual.payload).equals(canonicalBytes(manifest.payload))) {
    throw new Error("candidate_current_postimage_mismatch");
  }
  return {
    schemaVersion: RECEIPT_SCHEMA,
    verified: true,
    candidateId: manifest.candidateId,
    manifestSha256: sha256Buffer(bytes),
    head: manifest.payload.sourceIdentity.head,
    porcelainSha256: manifest.payload.dirtyPostimage.porcelainSha256,
    dirtyPathCount: manifest.payload.dirtyPostimage.pathCount,
    publicReleaseEligible: false,
  };
}

function parseArgs(argv) {
  const options = { command: argv[0] || "" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--manifest" || arg === "--out") options.manifestPath = argv[++index];
    else if (arg === "--output-root") options.outputRoot = argv[++index];
    else throw new Error(`candidate_argument_unknown:${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "generate") {
    const result = writeCandidateManifest(options);
    process.stdout.write(`${JSON.stringify({ schemaVersion: result.manifest.schemaVersion, candidateId: result.manifest.candidateId, manifestPath: result.manifestPath, manifestSha256: result.manifestSha256 })}\n`);
    return;
  }
  if (options.command === "verify") {
    if (!options.manifestPath) throw new Error("candidate_verify_manifest_required");
    process.stdout.write(`${JSON.stringify(verifyCandidateManifest(options))}\n`);
    return;
  }
  throw new Error("usage: node scripts/candidate-evidence.cjs <generate|verify> [--root path] [--manifest path] [--output-root path]");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MANIFEST_SCHEMA,
  POLICY,
  RECEIPT_SCHEMA,
  buildCandidateManifest,
  buildCandidatePayload,
  candidateId,
  npmExecutable,
  parsePorcelainV1Z,
  readDirtyPostimage,
  verifyCandidateManifest,
  writeCandidateManifest,
};
