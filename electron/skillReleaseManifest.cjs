const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SKILL_NAME = "zhixia-local-docs";
const MANIFEST_FILE_NAME = "release-manifest.json";
const MANIFEST_SCHEMA = "zhixia.skill_release_manifest.v1";
const RECEIPT_SCHEMA = "zhixia.skill_release_parity_receipt.v1";
const INCLUSION_POLICY = Object.freeze({
  schemaVersion: "zhixia.skill_release_inclusion_policy.v1",
  inclusion: "all_regular_files_recursive",
  excludedPaths: [MANIFEST_FILE_NAME],
  requiredPaths: ["SKILL.md", "agents/openai.yaml"],
  symlinkPolicy: "forbid",
  specialFilePolicy: "forbid",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function assertDirectDirectory(root, label) {
  const resolved = path.resolve(String(root || ""));
  if (!root || !fs.existsSync(resolved)) throw new Error(`skill_release_${label}_missing:${resolved}`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error(`skill_release_${label}_symlink_forbidden:${resolved}`);
  if (!stat.isDirectory()) throw new Error(`skill_release_${label}_not_directory:${resolved}`);
  return fs.realpathSync.native(resolved);
}

function enumerateSkillFiles(root) {
  const resolvedRoot = assertDirectDirectory(root, "root");
  const files = [];

  function walk(current, relativeDirectory) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const relative = toPosix(path.join(relativeDirectory, entry.name));
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`skill_release_symlink_forbidden:${relative}`);
      if (stat.isDirectory()) walk(absolute, relative);
      else if (!stat.isFile()) throw new Error(`skill_release_special_file_forbidden:${relative}`);
      else if (!INCLUSION_POLICY.excludedPaths.includes(relative)) files.push(relative);
    }
  }

  walk(resolvedRoot, "");
  return files.sort(compareText);
}

function buildEntries(root) {
  const resolvedRoot = path.resolve(root);
  return enumerateSkillFiles(resolvedRoot).map((relativePath) => {
    const bytes = fs.readFileSync(path.join(resolvedRoot, relativePath));
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function releaseBasis(entries) {
  return {
    schemaVersion: MANIFEST_SCHEMA,
    skillName: SKILL_NAME,
    inclusionPolicy: INCLUSION_POLICY,
    entryCount: entries.length,
    entries,
  };
}

function buildManifestFromEntries(entries) {
  const entryPaths = new Set(entries.map((entry) => entry.path));
  for (const requiredPath of INCLUSION_POLICY.requiredPaths) {
    if (!entryPaths.has(requiredPath)) throw new Error(`skill_release_required_file_missing:${requiredPath}`);
  }
  const basis = releaseBasis(entries);
  const payloadSha256 = sha256(Buffer.from(JSON.stringify(basis), "utf8"));
  return {
    ...basis,
    payloadSha256,
    releaseGeneration: `sha256:${payloadSha256}`,
  };
}

function buildSkillReleaseManifest(root) {
  return buildManifestFromEntries(buildEntries(root));
}

function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function writeSkillReleaseManifest(root) {
  const resolvedRoot = assertDirectDirectory(root, "root");
  const manifest = buildSkillReleaseManifest(resolvedRoot);
  const target = path.join(resolvedRoot, MANIFEST_FILE_NAME);
  const bytes = Buffer.from(serializeManifest(manifest), "utf8");
  fs.writeFileSync(target, bytes);
  return { target, manifest, manifestSha256: sha256(bytes) };
}

function validateDeclaredEntry(entry, index, seen) {
  const entryPath = String(entry?.path || "");
  if (
    !entryPath
    || entryPath !== toPosix(entryPath)
    || path.posix.isAbsolute(entryPath)
    || entryPath.split("/").includes("..")
    || entryPath.split("/").includes(".")
    || INCLUSION_POLICY.excludedPaths.includes(entryPath)
  ) {
    throw new Error(`skill_release_manifest_entry_path_invalid:${index}:${entryPath}`);
  }
  if (seen.has(entryPath)) throw new Error(`skill_release_manifest_entry_duplicate:${entryPath}`);
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) {
    throw new Error(`skill_release_manifest_entry_metadata_invalid:${entryPath}`);
  }
  seen.add(entryPath);
  return { path: entryPath, bytes: entry.bytes, sha256: entry.sha256 };
}

function readAndValidateOwnManifest(root) {
  const resolvedRoot = assertDirectDirectory(root, "root");
  const manifestPath = path.join(resolvedRoot, MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) throw new Error(`skill_release_manifest_missing:${manifestPath}`);
  const manifestStat = fs.lstatSync(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error(`skill_release_manifest_not_regular_file:${manifestPath}`);
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error(`skill_release_manifest_json_invalid:${manifestPath}`);
  }
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA || manifest.skillName !== SKILL_NAME) {
    throw new Error("skill_release_manifest_identity_invalid");
  }
  if (JSON.stringify(manifest.inclusionPolicy) !== JSON.stringify(INCLUSION_POLICY)) {
    throw new Error("skill_release_manifest_inclusion_policy_invalid");
  }
  if (!Array.isArray(manifest.entries) || manifest.entryCount !== manifest.entries.length) {
    throw new Error("skill_release_manifest_entries_invalid");
  }
  const seen = new Set();
  const entries = manifest.entries.map((entry, index) => validateDeclaredEntry(entry, index, seen));
  const sorted = [...entries].sort((left, right) => compareText(left.path, right.path));
  if (JSON.stringify(entries) !== JSON.stringify(sorted)) throw new Error("skill_release_manifest_entries_unsorted");
  const rebuilt = buildManifestFromEntries(entries);
  if (serializeManifest(rebuilt) !== manifestBytes.toString("utf8")) {
    throw new Error("skill_release_manifest_not_canonical_or_generation_invalid");
  }
  return { manifest: rebuilt, manifestBytes, manifestPath, manifestSha256: sha256(manifestBytes) };
}

function verifyTreeAgainstManifest(root, authority) {
  const resolvedRoot = assertDirectDirectory(root, "tree");
  const own = readAndValidateOwnManifest(resolvedRoot);
  if (!authority.manifestBytes.equals(own.manifestBytes)) {
    throw new Error(`skill_release_manifest_drift:${resolvedRoot}`);
  }
  const actualEntries = buildEntries(resolvedRoot);
  const expectedEntries = authority.manifest.entries;
  const actualPaths = actualEntries.map((entry) => entry.path);
  const expectedPaths = expectedEntries.map((entry) => entry.path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(`skill_release_file_set_mismatch:${resolvedRoot}`);
  }
  for (let index = 0; index < expectedEntries.length; index += 1) {
    const expected = expectedEntries[index];
    const actual = actualEntries[index];
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`skill_release_file_drift:${resolvedRoot}:${expected.path}`);
    }
  }
  return {
    supplied: true,
    verified: true,
    root: resolvedRoot,
    releaseGeneration: authority.manifest.releaseGeneration,
    manifestSha256: authority.manifestSha256,
    entryCount: expectedEntries.length,
  };
}

function uncheckedTree() {
  return { supplied: false, verified: null, root: null, state: "not_checked" };
}

function inspectCurrentTree(root, authority) {
  if (!root) return uncheckedTree();
  try {
    return { ...verifyTreeAgainstManifest(root, authority), state: "current" };
  } catch (error) {
    return {
      supplied: true,
      verified: false,
      root: path.resolve(String(root)),
      state: fs.existsSync(path.resolve(String(root))) ? "drifted" : "missing",
      error: String(error?.message || error),
    };
  }
}

function inspectRollbackTree(root) {
  if (!root) return uncheckedTree();
  const resolvedRoot = path.resolve(String(root));
  try {
    const authority = readAndValidateOwnManifest(resolvedRoot);
    const tree = verifyTreeAgainstManifest(resolvedRoot, authority);
    return { ...tree, state: "valid_candidate" };
  } catch (error) {
    return {
      supplied: true,
      verified: false,
      root: resolvedRoot,
      state: fs.existsSync(resolvedRoot) ? "invalid_candidate" : "missing",
      error: String(error?.message || error),
    };
  }
}

function createUpgradePlan(repo, bundled, installed) {
  if (!bundled.supplied || !installed.supplied) {
    return {
      state: "not_assessed",
      required: null,
      executable: false,
      reason: "Explicit bundled and installed roots are required for an upgrade decision.",
    };
  }
  if (!repo.verified || !bundled.verified) {
    return { state: "blocked", required: null, executable: false, reason: "Repo and bundled trees must match first." };
  }
  if (installed.verified) {
    return { state: "current", required: false, executable: false, reason: "Installed tree matches the release generation." };
  }
  return {
    state: "upgrade_required",
    required: true,
    executable: false,
    source: bundled.root,
    target: installed.root,
    releaseGeneration: repo.releaseGeneration,
    orderedProcedure: [
      "Re-run read-only repo/bundled parity immediately before mutation.",
      "Copy bundled tree to a sibling temporary directory without following symlinks.",
      "Verify the temporary tree against this exact release generation.",
      "Rename any existing installed tree to a generation-addressed backup without overwrite.",
      "Atomically rename the verified temporary tree into the installed path.",
      "Re-run full repo/bundled/installed parity and retain the backup until acceptance.",
    ],
  };
}

function createRollbackPlan(rollback) {
  if (!rollback.supplied) {
    return {
      state: "not_assessed",
      executable: false,
      reason: "An explicit rollback candidate root is required; discovery is intentionally disabled.",
    };
  }
  if (!rollback.verified) {
    return { state: "blocked", executable: false, reason: "Rollback candidate is not internally release-manifest verified." };
  }
  return {
    state: "candidate_verified",
    executable: false,
    source: rollback.root,
    releaseGeneration: rollback.releaseGeneration,
    orderedProcedure: [
      "Verify the current installed tree and preserve it as a non-overwriting generation-addressed backup.",
      "Copy the explicit rollback candidate to a sibling temporary directory without following symlinks.",
      "Verify the temporary tree against the rollback candidate manifest.",
      "Atomically exchange or rename the verified candidate into place.",
      "Verify installed bytes against the rollback generation before deleting no backups.",
    ],
  };
}

function inspectSkillReleaseParity(options = {}) {
  if (!options.repoPath) throw new Error("skill_release_repo_path_required");
  const repoAuthority = readAndValidateOwnManifest(options.repoPath);
  const repo = verifyTreeAgainstManifest(options.repoPath, repoAuthority);
  const bundled = inspectCurrentTree(options.bundledPath, repoAuthority);
  const installed = inspectCurrentTree(options.installedPath, repoAuthority);
  const rollback = inspectRollbackTree(options.rollbackPath);
  const checkedCurrentTrees = [bundled, installed].filter((tree) => tree.supplied);
  const verified = repo.verified && checkedCurrentTrees.every((tree) => tree.verified);
  return {
    schemaVersion: RECEIPT_SCHEMA,
    readOnly: true,
    verified,
    releaseGeneration: repo.releaseGeneration,
    payloadSha256: repoAuthority.manifest.payloadSha256,
    entryCount: repo.entryCount,
    trees: { repo, bundled, installed, rollback },
    upgradePlan: createUpgradePlan(repo, bundled, installed),
    rollbackPlan: createRollbackPlan(rollback),
  };
}

function verifySkillReleaseParity(options = {}) {
  const receipt = inspectSkillReleaseParity(options);
  if (!receipt.verified) {
    const failures = [receipt.trees.bundled, receipt.trees.installed]
      .filter((tree) => tree.supplied && !tree.verified)
      .map((tree) => tree.error);
    throw new Error(`skill_release_parity_failed:${failures.join("|")}`);
  }
  return receipt;
}

module.exports = {
  INCLUSION_POLICY,
  MANIFEST_FILE_NAME,
  MANIFEST_SCHEMA,
  RECEIPT_SCHEMA,
  SKILL_NAME,
  buildSkillReleaseManifest,
  enumerateSkillFiles,
  inspectSkillReleaseParity,
  readAndValidateOwnManifest,
  serializeManifest,
  sha256,
  verifySkillReleaseParity,
  verifyTreeAgainstManifest,
  writeSkillReleaseManifest,
};
