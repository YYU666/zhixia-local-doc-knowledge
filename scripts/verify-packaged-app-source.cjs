const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const {
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA,
  PACKAGED_SOURCE_ROOTS,
  PACKAGED_SOURCE_POLICY,
  comparePaths,
  enumeratePackagedSourceFiles,
  readGitPostimage,
  sha256Buffer,
  sourcePolicySha256,
} = require("./packaged-source-manifest.cjs");

function normalizeArchivePath(value) {
  return String(value || "").replace(/^[/\\]+/, "").split(path.sep).join("/");
}

function selectedArchiveFiles(asarPath) {
  const selected = asar.listPackage(asarPath)
    .map(normalizeArchivePath)
    .filter((entry) => entry && PACKAGED_SOURCE_ROOTS.some((root) => entry === root || entry.startsWith(`${root}/`)))
    .sort(comparePaths);
  const files = [];
  for (const entry of selected) {
    const archiveStat = asar.statFile(asarPath, entry, false);
    if (Object.hasOwn(archiveStat, "link")) throw new Error(`packaged_source_archive_symlink_forbidden:${entry}`);
    if (Object.hasOwn(archiveStat, "files")) continue;
    if (archiveStat.size == null) throw new Error(`packaged_source_archive_special_file_forbidden:${entry}`);
    if (!PACKAGED_SOURCE_POLICY.excludedPaths.includes(entry)) files.push(entry);
  }
  return files;
}

function sameStringArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateManifestInclusionPolicy(manifest) {
  if (!sameStringArray(manifest.packagedSourceRoots, PACKAGED_SOURCE_ROOTS)) {
    throw new Error("packaged_source_manifest_roots_invalid");
  }
  if (JSON.stringify(manifest.inclusionPolicy) !== JSON.stringify(PACKAGED_SOURCE_POLICY)) {
    throw new Error("packaged_source_manifest_inclusion_policy_invalid");
  }
  if (manifest.inclusionPolicySha256 !== sourcePolicySha256()) {
    throw new Error("packaged_source_manifest_inclusion_policy_sha_mismatch");
  }
}

function validateManifestEntries(manifest) {
  const paths = [];
  const seen = new Set();
  for (const entry of manifest.entries) {
    const entryPath = String(entry?.path || "");
    const normalized = normalizeArchivePath(entryPath);
    const eligible = PACKAGED_SOURCE_ROOTS.some((root) => normalized.startsWith(`${root}/`));
    if (!entryPath || entryPath !== normalized || !eligible || PACKAGED_SOURCE_POLICY.excludedPaths.includes(normalized)) {
      throw new Error(`packaged_source_manifest_entry_path_invalid:${entryPath}`);
    }
    if (seen.has(entryPath)) throw new Error(`packaged_source_manifest_entry_duplicate:${entryPath}`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) {
      throw new Error(`packaged_source_manifest_entry_metadata_invalid:${entryPath}`);
    }
    seen.add(entryPath);
    paths.push(entryPath);
  }
  return paths.sort(comparePaths);
}

function readManifestFromAsar(asarPath) {
  const manifestStat = asar.statFile(asarPath, MANIFEST_RELATIVE_PATH, false);
  if (Object.hasOwn(manifestStat, "link")) throw new Error("packaged_source_manifest_archive_symlink_forbidden");
  if (manifestStat.size == null) throw new Error("packaged_source_manifest_archive_not_file");
  const bytes = asar.extractFile(asarPath, MANIFEST_RELATIVE_PATH);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) throw new Error("packaged_source_manifest_schema_invalid");
  if (!Array.isArray(manifest.entries) || manifest.entryCount !== manifest.entries.length) {
    throw new Error("packaged_source_manifest_entries_invalid");
  }
  validateManifestInclusionPolicy(manifest);
  validateManifestEntries(manifest);
  return { bytes, manifest };
}

function verifyPackagedAppSource(options = {}) {
  const asarPath = path.resolve(String(options.asarPath || ""));
  const sourceRoot = options.sourceRoot ? path.resolve(options.sourceRoot) : null;
  if (!fs.existsSync(asarPath)) throw new Error(`packaged_app_asar_missing:${asarPath}`);
  const { bytes: manifestBytes, manifest } = readManifestFromAsar(asarPath);
  let currentSourcePostimage = null;
  if (sourceRoot) {
    currentSourcePostimage = readGitPostimage(sourceRoot);
    if (JSON.stringify(currentSourcePostimage) !== JSON.stringify(manifest.sourcePostimage)) {
      throw new Error("packaged_source_git_postimage_mismatch");
    }
  }
  const expectedPaths = validateManifestEntries(manifest);
  let sourcePaths = null;
  if (sourceRoot) {
    sourcePaths = enumeratePackagedSourceFiles(sourceRoot);
    if (!sameStringArray(sourcePaths, expectedPaths)) {
      throw new Error("packaged_source_manifest_source_file_set_mismatch");
    }
  }
  const archivedPaths = selectedArchiveFiles(asarPath);
  if (!sameStringArray(expectedPaths, archivedPaths)) {
    throw new Error("packaged_source_manifest_archive_file_set_mismatch");
  }
  for (const entry of manifest.entries) {
    const archived = asar.extractFile(asarPath, entry.path);
    if (archived.length !== entry.bytes || sha256Buffer(archived) !== entry.sha256) {
      throw new Error(`packaged_source_archive_hash_mismatch:${entry.path}`);
    }
    if (sourceRoot) {
      const sourcePath = path.join(sourceRoot, entry.path);
      if (!fs.existsSync(sourcePath)) throw new Error(`packaged_source_local_file_missing:${entry.path}`);
      const source = fs.readFileSync(sourcePath);
      if (source.length !== entry.bytes || sha256Buffer(source) !== entry.sha256) {
        throw new Error(`packaged_source_local_hash_mismatch:${entry.path}`);
      }
    }
  }
  const packagedPackage = JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"));
  if (sourceRoot) {
    const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
    for (const key of ["name", "version", "main", "productName"]) {
      if (packagedPackage[key] !== sourcePackage[key]) throw new Error(`packaged_package_identity_mismatch:${key}`);
    }
  }
  return {
    schemaVersion: "zhixia.packaged_app_equivalence_receipt.v1",
    verified: true,
    appAsarSha256: sha256Buffer(fs.readFileSync(asarPath)),
    manifestSha256: sha256Buffer(manifestBytes),
    sourcePostimage: manifest.sourcePostimage,
    gitPostimageRecomputed: Boolean(currentSourcePostimage),
    sourceFileSetEnumerated: Boolean(sourcePaths),
    inclusionPolicySha256: manifest.inclusionPolicySha256,
    entryCount: manifest.entryCount,
    packageIdentity: Object.fromEntries(["name", "version", "main", "productName"].map((key) => [key, packagedPackage[key]])),
  };
}

function main() {
  const asarPath = process.argv[2];
  if (!asarPath) throw new Error("usage: node scripts/verify-packaged-app-source.cjs <app.asar> [source-root]");
  process.stdout.write(`${JSON.stringify(verifyPackagedAppSource({
    asarPath,
    sourceRoot: process.argv[3] || path.join(__dirname, ".."),
  }))}\n`);
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
  readManifestFromAsar,
  selectedArchiveFiles,
  validateManifestEntries,
  validateManifestInclusionPolicy,
  verifyPackagedAppSource,
};
