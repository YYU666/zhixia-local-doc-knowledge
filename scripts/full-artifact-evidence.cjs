const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const MANIFEST_SCHEMA = "zhixia.full_artifact_manifest.v1";
const RECEIPT_SCHEMA = "zhixia.artifact_evidence_receipt.v1";
const DEFAULT_APP_RELATIVE = "release-mac/mac-arm64/知匣.app";
const DEFAULT_MANIFEST_RELATIVE = "release-evidence/zhixia-full-artifact-manifest.json";
const APP_ASAR_RELATIVE = "Contents/Resources/app.asar";
const FIXED_INPUT_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  "package.json",
  "package-lock.json",
  "electron-builder.mac.json",
  "scripts/full-artifact-evidence.cjs",
  "scripts/packaged-source-manifest.cjs",
  "scripts/verify-packaged-app-source.cjs",
  "tests/full-artifact-evidence.test.cjs",
]);
const OPTIONAL_RESOURCE_ROOTS = Object.freeze(["build", "build-resources"]);
const BUILDER_FILE_FIELDS = Object.freeze([
  "buildResources",
  "icon",
  "entitlements",
  "entitlementsInherit",
  "provisioningProfile",
]);
const EVIDENCE_POLICY = Object.freeze({
  schemaVersion: "zhixia.full_artifact_policy.v1",
  sourceInputs: {
    fixedPaths: [...FIXED_INPUT_PATHS],
    optionalResourceRoots: [...OPTIONAL_RESOURCE_ROOTS],
    builderFileFields: [...BUILDER_FILE_FIELDS],
    symlinkPolicy: "forbid",
    specialFilePolicy: "forbid",
  },
  productionDependencies: {
    authority: "package-lock.json root production dependencies and recursively reachable dependencies optionalDependencies and installed peerDependencies where dev is not true",
    missingLicensePolicy: "record_unavailable",
    missingIntegrityPolicy: "record_unavailable",
    localMetadataPolicy: "hash_when_present_without_network",
  },
  appAsar: {
    inclusion: "all_archive_files_and_symlinks",
    unpacked: "record_per_entry_and_verify_against_sibling_app.asar.unpacked",
  },
  bundle: {
    inclusion: "all_regular_files_and_symlinks_recursive",
    symlinkPolicy: "record_link_text_and_require_existing_realpath_containment",
    specialFilePolicy: "forbid",
  },
  receiptTiers: {
    selectedSource: "existing_zhixia.packaged_app_equivalence_receipt.v1_only",
    fullArtifact: "this_manifest_verified",
    signedDistribution: "requires_separate_signature_notarization_and_distribution_receipt",
  },
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

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertInside(root, target, code) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`${code}:${toPosix(relative)}`);
}

function fileEntry(root, relativePath) {
  const normalized = toPosix(relativePath);
  const target = path.join(root, relativePath);
  assertInside(root, target, "artifact_input_path_escape");
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`artifact_input_symlink_forbidden:${normalized}`);
  if (!stat.isFile()) throw new Error(`artifact_input_special_file_forbidden:${normalized}`);
  const bytes = fs.readFileSync(target);
  return { path: normalized, bytes: bytes.length, sha256: sha256Buffer(bytes) };
}

function walkInputRoot(root, relativeRoot) {
  const targetRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(targetRoot)) return [];
  const entries = [];
  const visit = (directory, relative) => {
    const rootStat = fs.lstatSync(directory);
    if (rootStat.isSymbolicLink()) throw new Error(`artifact_input_symlink_forbidden:${toPosix(relative)}`);
    if (!rootStat.isDirectory()) throw new Error(`artifact_input_root_not_directory:${toPosix(relative)}`);
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
      const childRelative = path.join(relative, item.name);
      const child = path.join(directory, item.name);
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error(`artifact_input_symlink_forbidden:${toPosix(childRelative)}`);
      if (stat.isDirectory()) visit(child, childRelative);
      else if (stat.isFile()) entries.push(fileEntry(root, childRelative));
      else throw new Error(`artifact_input_special_file_forbidden:${toPosix(childRelative)}`);
    }
  };
  visit(targetRoot, relativeRoot);
  return entries;
}

function collectBuilderFileReferences(config) {
  const references = [];
  const visit = (value, key = "") => {
    if (BUILDER_FILE_FIELDS.includes(key) && typeof value === "string" && value.trim()) {
      if (/[*?{}[\]]/.test(value)) throw new Error(`artifact_builder_glob_reference_unsupported:${key}`);
      references.push(value);
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
    }
  };
  visit(config);
  return [...new Set(references.map(toPosix))].sort(comparePaths);
}

function enumerateSourceInputs(sourceRoot) {
  const root = path.resolve(sourceRoot);
  for (const relativePath of FIXED_INPUT_PATHS) {
    if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`artifact_input_missing:${relativePath}`);
  }
  const builderConfig = JSON.parse(fs.readFileSync(path.join(root, "electron-builder.mac.json"), "utf8"));
  const explicitReferences = collectBuilderFileReferences(builderConfig);
  const paths = new Set(FIXED_INPUT_PATHS);
  for (const resourceRoot of OPTIONAL_RESOURCE_ROOTS) {
    for (const entry of walkInputRoot(root, resourceRoot)) paths.add(entry.path);
  }
  for (const relativePath of explicitReferences) {
    const target = path.join(root, relativePath);
    assertInside(root, target, "artifact_builder_reference_escape");
    if (!fs.existsSync(target)) throw new Error(`artifact_builder_reference_missing:${relativePath}`);
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      for (const entry of walkInputRoot(root, relativePath)) paths.add(entry.path);
    } else {
      paths.add(fileEntry(root, relativePath).path);
    }
  }
  return {
    explicitBuilderReferences: explicitReferences,
    entries: [...paths].sort(comparePaths).map((relativePath) => fileEntry(root, relativePath)),
  };
}

function packageNameFromLockPath(lockPath, lockEntry) {
  if (typeof lockEntry.name === "string" && lockEntry.name) return lockEntry.name;
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return lockPath.slice(index + marker.length);
}

function parentLockPackage(lockPath) {
  const marker = "/node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return index < 0 ? "" : lockPath.slice(0, index);
}

function resolveLockDependency(packages, fromPath, dependencyName) {
  let cursor = fromPath;
  while (true) {
    const candidate = cursor ? `${cursor}/node_modules/${dependencyName}` : `node_modules/${dependencyName}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!cursor) return null;
    cursor = parentLockPackage(cursor);
  }
}

function localPackageMetadata(sourceRoot, lockPath) {
  const packageJsonPath = path.join(sourceRoot, lockPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) return { available: false, packageJsonSha256: null, license: null };
  const stat = fs.lstatSync(packageJsonPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`artifact_dependency_metadata_invalid:${lockPath}`);
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const license = typeof parsed.license === "string" ? parsed.license : null;
  return { available: true, packageJsonSha256: sha256File(packageJsonPath), license };
}

function collectLocalNativeModules(sourceRoot, lockPath) {
  const packageRoot = path.join(sourceRoot, lockPath);
  if (!fs.existsSync(packageRoot)) return [];
  const entries = [];
  const visit = (directory, relative) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
      if (item.name === "node_modules") continue;
      const child = path.join(directory, item.name);
      const childRelative = path.join(relative, item.name);
      const stat = fs.lstatSync(child);
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(child, childRelative);
      else if (stat.isFile() && item.name.endsWith(".node")) {
        const bytes = fs.readFileSync(child);
        entries.push({ path: toPosix(path.join(lockPath, childRelative)), bytes: bytes.length, sha256: sha256Buffer(bytes) });
      }
    }
  };
  visit(packageRoot, "");
  return entries;
}

function buildProductionSbom(sourceRoot) {
  const lockBytes = fs.readFileSync(path.join(sourceRoot, "package-lock.json"));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") {
    throw new Error("artifact_package_lock_v3_required");
  }
  const included = new Set();
  const pending = Object.keys(lock.packages[""]?.dependencies || {})
    .sort(comparePaths)
    .map((dependencyName) => resolveLockDependency(lock.packages, "", dependencyName));
  while (pending.length > 0) {
    const lockPath = pending.shift();
    if (!lockPath || included.has(lockPath)) continue;
    const entry = lock.packages[lockPath];
    if (!entry || entry.dev === true) throw new Error(`artifact_production_dependency_missing:${lockPath}`);
    included.add(lockPath);
    const dependencyNames = [...new Set([
      ...Object.keys(entry.dependencies || {}),
      ...Object.keys(entry.optionalDependencies || {}),
      ...Object.keys(entry.peerDependencies || {}),
    ])].sort(comparePaths);
    for (const dependencyName of dependencyNames) {
      const dependencyPath = resolveLockDependency(lock.packages, lockPath, dependencyName);
      if (dependencyPath && lock.packages[dependencyPath]?.dev !== true && !included.has(dependencyPath)) pending.push(dependencyPath);
    }
  }
  const includedPaths = [...included].sort(comparePaths);
  const components = includedPaths.map((lockPath) => {
    const entry = lock.packages[lockPath];
    const name = packageNameFromLockPath(lockPath, entry);
    const local = localPackageMetadata(sourceRoot, lockPath);
    const dependencyNames = [...new Set([
      ...Object.keys(entry.dependencies || {}),
      ...Object.keys(entry.optionalDependencies || {}),
      ...Object.keys(entry.peerDependencies || {}),
    ])].sort(comparePaths);
    const dependencyPaths = dependencyNames
      .map((dependencyName) => resolveLockDependency(lock.packages, lockPath, dependencyName))
      .filter((dependencyPath) => dependencyPath && included.has(dependencyPath))
      .sort(comparePaths);
    return {
      bomRef: `npm:${lockPath}`,
      lockPath,
      name,
      version: entry.version || null,
      license: entry.license || local.license || null,
      licenseEvidence: entry.license ? "package_lock" : local.license ? "local_package_json" : "unavailable",
      integrity: entry.integrity || null,
      integrityEvidence: entry.integrity ? "package_lock" : "unavailable",
      resolved: entry.resolved || null,
      optional: entry.optional === true,
      localMetadata: local,
      nativeModules: collectLocalNativeModules(sourceRoot, lockPath),
      dependencyRefs: dependencyPaths.map((dependencyPath) => `npm:${dependencyPath}`),
    };
  });
  return {
    schemaVersion: "zhixia.production_dependency_sbom.v1",
    lockfileVersion: lock.lockfileVersion,
    packageLockSha256: sha256Buffer(lockBytes),
    rootDependencies: Object.keys(lock.packages[""]?.dependencies || {}).sort(comparePaths),
    componentCount: components.length,
    components,
  };
}

function normalizeArchivePath(value) {
  return String(value || "").replace(/^[/\\]+/, "").split(path.sep).join("/");
}

function inventoryAsar(asarPath) {
  const entries = [];
  for (const archivePath of asar.listPackage(asarPath).map(normalizeArchivePath).filter(Boolean).sort(comparePaths)) {
    const stat = asar.statFile(asarPath, archivePath, false);
    if (Object.hasOwn(stat, "files")) continue;
    if (Object.hasOwn(stat, "link")) {
      const rawTarget = String(stat.link || "").replaceAll("\\", "/");
      const target = normalizeArchivePath(rawTarget);
      const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(archivePath), target));
      if (!target || rawTarget.startsWith("/") || resolvedTarget === ".." || resolvedTarget.startsWith("../")) {
        throw new Error(`artifact_asar_symlink_escape:${archivePath}`);
      }
      entries.push({ path: archivePath, type: "symlink", target, targetSha256: sha256Buffer(Buffer.from(target, "utf8")) });
      continue;
    }
    if (stat.size == null) throw new Error(`artifact_asar_special_file_forbidden:${archivePath}`);
    const bytes = asar.extractFile(asarPath, archivePath);
    entries.push({ path: archivePath, type: "file", bytes: bytes.length, sha256: sha256Buffer(bytes), unpacked: stat.unpacked === true });
  }
  return {
    bytes: fs.statSync(asarPath).size,
    sha256: sha256File(asarPath),
    entryCount: entries.length,
    unpackedEntryCount: entries.filter((entry) => entry.unpacked === true).length,
    entries,
  };
}

function inventoryBundle(appRoot) {
  const resolvedRoot = path.resolve(appRoot);
  const entries = [];
  const visit = (directory, relative) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
      const child = path.join(directory, item.name);
      const childRelative = path.join(relative, item.name);
      const normalized = toPosix(childRelative);
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(child);
        let resolvedTarget;
        try {
          resolvedTarget = fs.realpathSync(child);
        } catch {
          throw new Error(`artifact_bundle_symlink_broken:${normalized}`);
        }
        assertInside(resolvedRoot, resolvedTarget, "artifact_bundle_symlink_escape");
        entries.push({ path: normalized, type: "symlink", target, targetSha256: sha256Buffer(Buffer.from(target, "utf8")) });
      } else if (stat.isDirectory()) visit(child, childRelative);
      else if (stat.isFile()) {
        const bytes = fs.readFileSync(child);
        entries.push({ path: normalized, type: "file", bytes: bytes.length, sha256: sha256Buffer(bytes) });
      } else throw new Error(`artifact_bundle_special_file_forbidden:${normalized}`);
    }
  };
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("artifact_app_root_invalid");
  visit(resolvedRoot, "");
  return { entryCount: entries.length, entries };
}

function readToolchain(sourceRoot) {
  const readVersion = (relativePath) => {
    const packagePath = path.join(sourceRoot, relativePath, "package.json");
    return fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, "utf8")).version || null : null;
  };
  let npmVersion = null;
  try {
    npmVersion = childProcess.execFileSync("npm", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    throw new Error("artifact_npm_toolchain_unavailable");
  }
  return {
    node: process.version,
    npm: npmVersion,
    platform: process.platform,
    arch: process.arch,
    electron: readVersion("node_modules/electron"),
    electronBuilder: readVersion("node_modules/electron-builder"),
    asar: readVersion("node_modules/@electron/asar"),
  };
}

function selectedSourceEvidence(asarPath) {
  const manifestPath = "dist/zhixia-source-postimage-manifest.json";
  try {
    const bytes = asar.extractFile(asarPath, manifestPath);
    const parsed = JSON.parse(bytes.toString("utf8"));
    return {
      present: parsed.schemaVersion === "zhixia.packaged_source_postimage.v1",
      schemaVersion: parsed.schemaVersion || null,
      manifestPath,
      manifestSha256: sha256Buffer(bytes),
      entryCount: Number.isSafeInteger(parsed.entryCount) ? parsed.entryCount : null,
    };
  } catch {
    return { present: false, schemaVersion: null, manifestPath, manifestSha256: null, entryCount: null };
  }
}

function buildFullArtifactManifest(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, ".."));
  const appRoot = path.resolve(options.appRoot || path.join(sourceRoot, DEFAULT_APP_RELATIVE));
  assertInside(sourceRoot, path.join(sourceRoot, "package.json"), "artifact_source_root_invalid");
  const asarPath = path.join(appRoot, APP_ASAR_RELATIVE);
  if (!fs.existsSync(asarPath)) throw new Error(`artifact_app_asar_missing:${APP_ASAR_RELATIVE}`);
  const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const builderConfig = JSON.parse(fs.readFileSync(path.join(sourceRoot, "electron-builder.mac.json"), "utf8"));
  const policySha256 = sha256Buffer(Buffer.from(JSON.stringify(EVIDENCE_POLICY), "utf8"));
  const appAsar = inventoryAsar(asarPath);
  const bundle = inventoryBundle(appRoot);
  const sourceInputs = enumerateSourceInputs(sourceRoot);
  const sourceInputByPath = Object.fromEntries(sourceInputs.entries.map((entry) => [entry.path, entry]));
  return {
    schemaVersion: MANIFEST_SCHEMA,
    receiptTier: "full-artifact",
    claim: "unsigned_local_artifact_candidate",
    policy: EVIDENCE_POLICY,
    policySha256,
    receiptTiers: {
      selectedSource: (() => {
        const evidence = selectedSourceEvidence(asarPath);
        return {
          eligible: evidence.present,
          independentlyVerified: false,
          verifier: "scripts/verify-packaged-app-source.cjs",
          evidence,
        };
      })(),
      fullArtifact: { eligible: true },
      signedDistribution: {
        eligible: false,
        reason: "signature_notarization_and_distribution_evidence_absent",
      },
    },
    candidate: {
      name: packageJson.name,
      version: packageJson.version,
      productName: packageJson.productName,
      appId: builderConfig.appId,
      target: builderConfig.mac?.target || null,
      identity: builderConfig.mac?.identity ?? null,
    },
    toolchain: readToolchain(sourceRoot),
    sourceInputs,
    reproducibilityGatePlan: {
      executionState: "not_recorded_by_artifact_manifest",
      commands: [
        "npm ci",
        "npm test",
        "npm run test:artifact-evidence",
        "npm run test:electron-security",
        "npm run test:electron-release",
        "npm run build",
        "npm run dist:mac",
        "npm run verify:release-candidate",
      ],
      boundImplementations: Object.fromEntries([
        ".github/workflows/ci.yml",
        "package-lock.json",
        "scripts/full-artifact-evidence.cjs",
        "scripts/packaged-source-manifest.cjs",
        "scripts/verify-packaged-app-source.cjs",
        "tests/full-artifact-evidence.test.cjs",
      ].map((relativePath) => [relativePath, sourceInputByPath[relativePath]?.sha256 || null])),
      note: "Command and test implementation binding is not evidence that a gate ran; execution receipts must be attached by the release authority.",
    },
    productionSbom: buildProductionSbom(sourceRoot),
    artifact: {
      appRootName: path.basename(appRoot),
      appAsarRelativePath: APP_ASAR_RELATIVE,
      appAsar,
      bundle,
      asarUnpacked: appAsar.entries.filter((entry) => entry.type === "file" && entry.unpacked === true),
      nativeModules: {
        appAsar: appAsar.entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".node")),
        appBundle: bundle.entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".node")),
      },
    },
    boundaries: {
      networkUsed: false,
      signingPerformed: false,
      notarizationPerformed: false,
      installedAppEvidence: false,
      reproducibleBytesClaimed: false,
      note: "This binds one local candidate and its inputs; it does not prove bit-for-bit reproducibility across hosts.",
    },
  };
}

function compareEntrySets(label, expectedEntries, actualEntries) {
  const expectedPaths = expectedEntries.map((entry) => `${entry.type || "file"}:${entry.path}`);
  const actualPaths = actualEntries.map((entry) => `${entry.type || "file"}:${entry.path}`);
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) throw new Error(`${label}_file_set_mismatch`);
  for (let index = 0; index < expectedEntries.length; index += 1) {
    if (JSON.stringify(expectedEntries[index]) !== JSON.stringify(actualEntries[index])) {
      throw new Error(`${label}_entry_mismatch:${actualEntries[index]?.path || expectedEntries[index]?.path || index}`);
    }
  }
}

function verifyFullArtifactManifest(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, ".."));
  const appRoot = path.resolve(options.appRoot || path.join(sourceRoot, DEFAULT_APP_RELATIVE));
  const manifestPath = path.resolve(options.manifestPath || path.join(sourceRoot, DEFAULT_MANIFEST_RELATIVE));
  if (!fs.existsSync(manifestPath)) throw new Error(`artifact_manifest_missing:${manifestPath}`);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== MANIFEST_SCHEMA || manifest.receiptTier !== "full-artifact") {
    throw new Error("artifact_manifest_schema_invalid");
  }
  if (manifest.policySha256 !== sha256Buffer(Buffer.from(JSON.stringify(EVIDENCE_POLICY), "utf8")) || JSON.stringify(manifest.policy) !== JSON.stringify(EVIDENCE_POLICY)) {
    throw new Error("artifact_manifest_policy_mismatch");
  }
  const requiredTier = options.requireTier || "full-artifact";
  if (requiredTier === "selected-source") throw new Error("selected_source_requires_existing_verifier");
  if (requiredTier === "signed-distribution") throw new Error("signed_distribution_evidence_missing");
  if (requiredTier !== "full-artifact") throw new Error(`artifact_receipt_tier_invalid:${requiredTier}`);
  const actual = buildFullArtifactManifest({ sourceRoot, appRoot });
  compareEntrySets("artifact_source", manifest.sourceInputs?.entries || [], actual.sourceInputs.entries);
  if (JSON.stringify(manifest.sourceInputs?.explicitBuilderReferences) !== JSON.stringify(actual.sourceInputs.explicitBuilderReferences)) {
    throw new Error("artifact_builder_references_mismatch");
  }
  if (JSON.stringify(manifest.toolchain) !== JSON.stringify(actual.toolchain)) throw new Error("artifact_toolchain_mismatch");
  if (JSON.stringify(manifest.productionSbom) !== JSON.stringify(actual.productionSbom)) throw new Error("artifact_production_sbom_mismatch");
  if (JSON.stringify(manifest.reproducibilityGatePlan) !== JSON.stringify(actual.reproducibilityGatePlan)) {
    throw new Error("artifact_reproducibility_gate_plan_mismatch");
  }
  compareEntrySets("artifact_asar", manifest.artifact?.appAsar?.entries || [], actual.artifact.appAsar.entries);
  if (manifest.artifact?.appAsar?.sha256 !== actual.artifact.appAsar.sha256 || manifest.artifact?.appAsar?.bytes !== actual.artifact.appAsar.bytes) {
    throw new Error("artifact_asar_archive_hash_mismatch");
  }
  if (manifest.artifact?.appAsar?.entryCount !== actual.artifact.appAsar.entryCount || manifest.artifact?.appAsar?.unpackedEntryCount !== actual.artifact.appAsar.unpackedEntryCount) {
    throw new Error("artifact_asar_counts_mismatch");
  }
  compareEntrySets("artifact_bundle", manifest.artifact?.bundle?.entries || [], actual.artifact.bundle.entries);
  if (manifest.artifact?.bundle?.entryCount !== actual.artifact.bundle.entryCount) throw new Error("artifact_bundle_count_mismatch");
  if (manifest.artifact?.appRootName !== actual.artifact.appRootName || manifest.artifact?.appAsarRelativePath !== actual.artifact.appAsarRelativePath) {
    throw new Error("artifact_layout_mismatch");
  }
  if (JSON.stringify(manifest.artifact?.asarUnpacked) !== JSON.stringify(actual.artifact.asarUnpacked)) {
    throw new Error("artifact_asar_unpacked_mismatch");
  }
  if (JSON.stringify(manifest.artifact?.nativeModules) !== JSON.stringify(actual.artifact.nativeModules)) {
    throw new Error("artifact_native_modules_mismatch");
  }
  const scalarSections = ["receiptTiers", "candidate", "boundaries"];
  for (const section of scalarSections) {
    if (JSON.stringify(manifest[section]) !== JSON.stringify(actual[section])) throw new Error(`artifact_${section}_mismatch`);
  }
  return {
    schemaVersion: RECEIPT_SCHEMA,
    verified: true,
    receiptTier: "full-artifact",
    manifestSha256: sha256Buffer(manifestBytes),
    appAsarSha256: actual.artifact.appAsar.sha256,
    bundleEntryCount: actual.artifact.bundle.entryCount,
    asarEntryCount: actual.artifact.appAsar.entryCount,
    productionComponentCount: actual.productionSbom.componentCount,
    selectedSourceEvidencePresent: actual.receiptTiers.selectedSource.evidence.present,
    signedDistributionEligible: false,
  };
}

function writeFullArtifactManifest(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, ".."));
  const appRoot = path.resolve(options.appRoot || path.join(sourceRoot, DEFAULT_APP_RELATIVE));
  const manifestPath = path.resolve(options.manifestPath || path.join(sourceRoot, DEFAULT_MANIFEST_RELATIVE));
  assertInside(sourceRoot, manifestPath, "artifact_manifest_output_escape");
  const relativeToApp = path.relative(appRoot, manifestPath);
  if (relativeToApp === "" || (!relativeToApp.startsWith("..") && !path.isAbsolute(relativeToApp))) {
    throw new Error("artifact_manifest_must_be_external_to_app_bundle");
  }
  const manifest = buildFullArtifactManifest({ sourceRoot, appRoot });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, stableJson(manifest), { encoding: "utf8", mode: 0o600 });
  return { manifest, manifestPath, manifestSha256: sha256File(manifestPath) };
}

function parseArgs(argv) {
  const options = { command: argv[0] || "" };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--source") options.sourceRoot = argv[++index];
    else if (value === "--app") options.appRoot = argv[++index];
    else if (value === "--manifest" || value === "--out") options.manifestPath = argv[++index];
    else if (value === "--require-tier") options.requireTier = argv[++index];
    else throw new Error(`artifact_argument_unknown:${value}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "generate") {
    const result = writeFullArtifactManifest(options);
    process.stdout.write(`${JSON.stringify({ schemaVersion: result.manifest.schemaVersion, receiptTier: result.manifest.receiptTier, manifestPath: result.manifestPath, manifestSha256: result.manifestSha256 })}\n`);
    return;
  }
  if (options.command === "verify") {
    process.stdout.write(`${JSON.stringify(verifyFullArtifactManifest(options))}\n`);
    return;
  }
  throw new Error("usage: node scripts/full-artifact-evidence.cjs <generate|verify> [--source root] [--app app] [--manifest file] [--require-tier full-artifact|signed-distribution]");
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
  APP_ASAR_RELATIVE,
  DEFAULT_APP_RELATIVE,
  DEFAULT_MANIFEST_RELATIVE,
  EVIDENCE_POLICY,
  MANIFEST_SCHEMA,
  RECEIPT_SCHEMA,
  buildFullArtifactManifest,
  buildProductionSbom,
  enumerateSourceInputs,
  inventoryAsar,
  inventoryBundle,
  verifyFullArtifactManifest,
  writeFullArtifactManifest,
};
