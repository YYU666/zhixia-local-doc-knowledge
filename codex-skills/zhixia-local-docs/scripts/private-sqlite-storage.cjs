const fs = require("node:fs");
const path = require("node:path");

const OWNER_ONLY_DIRECTORY_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;
const WINDOWS_ACL_BOUNDARY = Object.freeze({
  status: "deferred_unverified",
  claim: "no_native_acl_evidence",
  requirement: "owner_only_dacl_for_database_sidecars",
});

function storagePolicyError(code) {
  const error = new Error("Private SQLite storage policy rejected the requested path.");
  error.code = code;
  return error;
}

function derivePrivateSqliteTrustedRoot(storeRootValue, options = {}) {
  const platform = options.platform || process.platform;
  const storeRoot = absolutePath(storeRootValue, "PRIVATE_SQLITE_STORE_ROOT_REQUIRED");
  let storeStat = null;
  try {
    storeStat = fs.lstatSync(storeRoot);
    if (storeStat.isSymbolicLink() || !storeStat.isDirectory()) {
      throw storagePolicyError("PRIVATE_SQLITE_UNSAFE_PATH_TYPE");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const currentUid = platform !== "win32" && typeof process.getuid === "function" ? process.getuid() : null;
  const ownerControlled = (stat) => currentUid === null || (stat.uid === currentUid && (stat.mode & 0o022) === 0);
  const trustedRoot = storeStat && ownerControlled(storeStat) ? storeRoot : path.dirname(storeRoot);
  if (trustedRoot === path.parse(trustedRoot).root) {
    throw storagePolicyError("PRIVATE_SQLITE_TRUSTED_ROOT_TOO_BROAD");
  }
  let trustedStat;
  try {
    trustedStat = fs.lstatSync(trustedRoot);
  } catch {
    throw storagePolicyError("PRIVATE_SQLITE_TRUSTED_ROOT_UNAVAILABLE");
  }
  if (trustedStat.isSymbolicLink() || !trustedStat.isDirectory()) {
    throw storagePolicyError("PRIVATE_SQLITE_UNSAFE_PATH_TYPE");
  }
  if (!ownerControlled(trustedStat)) {
    throw storagePolicyError("PRIVATE_SQLITE_TRUSTED_ROOT_NOT_OWNER_CONTROLLED");
  }
  return trustedRoot;
}

function managedSidecarName(databaseName, candidateName) {
  if (candidateName === databaseName) return true;
  if ([`${databaseName}-wal`, `${databaseName}-shm`, `${databaseName}-journal`].includes(candidateName)) return true;
  const suffix = candidateName.slice(databaseName.length);
  return /^\.(?:tmp|temp|bak|backup)(?:[._-][A-Za-z0-9_-]{1,96})?$/.test(suffix)
    || /^\.[A-Za-z0-9_-]{1,96}\.(?:tmp|temp|bak|backup)$/.test(suffix)
    || /^-(?:tmp|temp|bak|backup)(?:[._-][A-Za-z0-9_-]{1,96})?$/.test(suffix);
}

function absolutePath(value, code) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw storagePolicyError(code);
  return path.resolve(value);
}

function containedRelativePath(trustedRoot, candidate) {
  const relative = path.relative(trustedRoot, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return relative;
  }
  throw storagePolicyError("PRIVATE_SQLITE_PATH_OUTSIDE_TRUSTED_ROOT");
}

function readIdentity(candidate, expectedType = null) {
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw storagePolicyError("PRIVATE_SQLITE_METADATA_UNAVAILABLE");
  }
  if (stat.isSymbolicLink()) throw storagePolicyError("PRIVATE_SQLITE_UNSAFE_PATH_TYPE");
  if (expectedType === "directory" && !stat.isDirectory()) throw storagePolicyError("PRIVATE_SQLITE_UNSAFE_DIRECTORY_TYPE");
  if (expectedType === "file" && !stat.isFile()) throw storagePolicyError("PRIVATE_SQLITE_UNSAFE_FILE_TYPE");
  let canonical;
  try {
    canonical = fs.realpathSync.native(candidate);
  } catch {
    throw storagePolicyError("PRIVATE_SQLITE_METADATA_UNAVAILABLE");
  }
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    canonical,
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
  };
}

function sameIdentity(left, right) {
  return Boolean(left && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.canonical === right.canonical
    && left.type === right.type);
}

function createPathGuard(trustedRootValue, options = {}) {
  const trustedRoot = absolutePath(trustedRootValue, "PRIVATE_SQLITE_TRUSTED_ROOT_REQUIRED");
  const rootIdentity = readIdentity(trustedRoot, "directory");
  if (!rootIdentity) throw storagePolicyError("PRIVATE_SQLITE_TRUSTED_ROOT_UNAVAILABLE");
  const identities = new Map([[trustedRoot, rootIdentity]]);
  const onStage = typeof options.onStage === "function" ? options.onStage : null;

  function assertContained(candidateValue) {
    const candidate = absolutePath(candidateValue, "PRIVATE_SQLITE_ABSOLUTE_PATH_REQUIRED");
    containedRelativePath(trustedRoot, candidate);
    return candidate;
  }

  function expectedCanonical(candidate) {
    const relative = containedRelativePath(trustedRoot, candidate);
    return relative ? path.join(rootIdentity.canonical, relative) : rootIdentity.canonical;
  }

  function remember(candidate, expectedType) {
    const identity = readIdentity(candidate, expectedType);
    if (!identity) return null;
    if (identity.canonical !== expectedCanonical(candidate)) {
      throw storagePolicyError("PRIVATE_SQLITE_REALPATH_CONTAINMENT_FAILED");
    }
    const prior = identities.get(candidate);
    if (prior && !sameIdentity(prior, identity)) throw storagePolicyError("PRIVATE_SQLITE_PATH_IDENTITY_CHANGED");
    identities.set(candidate, identity);
    return identity;
  }

  function validate() {
    for (const [candidate, expected] of identities) {
      let current;
      try {
        current = readIdentity(candidate, expected.type);
      } catch {
        throw storagePolicyError("PRIVATE_SQLITE_PATH_IDENTITY_CHANGED");
      }
      if (!sameIdentity(expected, current)) throw storagePolicyError("PRIVATE_SQLITE_PATH_IDENTITY_CHANGED");
      if (current.canonical !== expectedCanonical(candidate)) {
        throw storagePolicyError("PRIVATE_SQLITE_REALPATH_CONTAINMENT_FAILED");
      }
    }
  }

  function stage(phase, candidate) {
    validate();
    if (onStage) onStage({ phase, path: candidate });
    validate();
  }

  return { trustedRoot, assertContained, remember, validate, stage, identities };
}

function directorySegments(guard, directoryValue) {
  const directory = guard.assertContained(directoryValue);
  const relative = containedRelativePath(guard.trustedRoot, directory);
  if (!relative) return [];
  const parts = relative.split(path.sep).filter(Boolean);
  const result = [];
  let current = guard.trustedRoot;
  for (const part of parts) {
    current = path.join(current, part);
    result.push(current);
  }
  return result;
}

function openFlags(baseFlags) {
  return baseFlags | (fs.constants.O_NOFOLLOW || 0);
}

function repairDirectoryMode(directory, guard, platform) {
  if (platform === "win32" || directory === guard.trustedRoot) return;
  guard.stage("before_directory_mode", directory);
  let handle;
  try {
    handle = fs.openSync(directory, openFlags(fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0)));
    const stat = fs.fstatSync(handle);
    const identity = guard.identities.get(directory);
    if (!identity || String(stat.dev) !== identity.dev || String(stat.ino) !== identity.ino || !stat.isDirectory()) {
      throw storagePolicyError("PRIVATE_SQLITE_PATH_IDENTITY_CHANGED");
    }
    fs.fchmodSync(handle, OWNER_ONLY_DIRECTORY_MODE);
  } catch (error) {
    if (error?.code?.startsWith("PRIVATE_SQLITE_")) throw error;
    throw storagePolicyError("PRIVATE_SQLITE_DIRECTORY_MODE_REPAIR_FAILED");
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  guard.stage("after_directory_mode", directory);
}

function ensureGuardedDirectories(directory, guard, platform) {
  for (const segment of directorySegments(guard, directory)) {
    let identity = guard.remember(segment, "directory");
    if (!identity) {
      guard.stage("before_mkdir", segment);
      try {
        fs.mkdirSync(segment, { mode: OWNER_ONLY_DIRECTORY_MODE });
      } catch (error) {
        if (error?.code !== "EEXIST") throw storagePolicyError("PRIVATE_SQLITE_DIRECTORY_CREATE_FAILED");
      }
      identity = guard.remember(segment, "directory");
      if (!identity) throw storagePolicyError("PRIVATE_SQLITE_DIRECTORY_CREATE_FAILED");
      guard.stage("after_mkdir", segment);
    }
    repairDirectoryMode(segment, guard, platform);
  }
  guard.validate();
}

function openGuardedRegularFile(filePath, guard, flags, mode, phase) {
  const candidate = guard.assertContained(filePath);
  guard.stage(`before_${phase}`, candidate);
  let handle;
  try {
    handle = fs.openSync(candidate, openFlags(flags), mode);
    const descriptorStat = fs.fstatSync(handle);
    if (!descriptorStat.isFile()) throw storagePolicyError("PRIVATE_SQLITE_UNSAFE_FILE_TYPE");
    const identity = guard.remember(candidate, "file");
    if (!identity || String(descriptorStat.dev) !== identity.dev || String(descriptorStat.ino) !== identity.ino) {
      throw storagePolicyError("PRIVATE_SQLITE_PATH_IDENTITY_CHANGED");
    }
    guard.stage(`after_${phase}`, candidate);
    return { handle, identity };
  } catch (error) {
    if (handle !== undefined) fs.closeSync(handle);
    if (error?.code?.startsWith("PRIVATE_SQLITE_")) throw error;
    if (error?.code === "ELOOP") throw storagePolicyError("PRIVATE_SQLITE_UNSAFE_FILE_TYPE");
    throw storagePolicyError("PRIVATE_SQLITE_FILE_OPEN_FAILED");
  }
}

function repairRegularFileMode(filePath, guard, platform) {
  const identity = guard.remember(filePath, "file");
  if (!identity) return false;
  if (platform === "win32") return true;
  const opened = openGuardedRegularFile(filePath, guard, fs.constants.O_RDONLY, OWNER_ONLY_FILE_MODE, "file_mode_open");
  try {
    fs.fchmodSync(opened.handle, OWNER_ONLY_FILE_MODE);
  } catch {
    throw storagePolicyError("PRIVATE_SQLITE_FILE_MODE_REPAIR_FAILED");
  } finally {
    fs.closeSync(opened.handle);
  }
  guard.stage("after_file_mode", filePath);
  return true;
}

function requireTrustedRoot(options) {
  if (!options || typeof options.trustedRoot !== "string") {
    throw storagePolicyError("PRIVATE_SQLITE_TRUSTED_ROOT_REQUIRED");
  }
  return options.trustedRoot;
}

function repairPrivateSqliteFiles(databasePath, options = {}) {
  const platform = options.platform || process.platform;
  const guard = createPathGuard(requireTrustedRoot(options), options);
  const candidateDatabase = guard.assertContained(databasePath);
  const directory = path.dirname(candidateDatabase);
  const databaseName = path.basename(candidateDatabase);
  ensureGuardedDirectories(directory, guard, platform);
  guard.stage("before_readdir", directory);
  let entries;
  try {
    entries = fs.readdirSync(directory);
  } catch {
    throw storagePolicyError("PRIVATE_SQLITE_DIRECTORY_UNAVAILABLE");
  }
  let repaired = 0;
  for (const entry of entries) {
    if (!managedSidecarName(databaseName, entry)) continue;
    const candidate = path.join(directory, entry);
    if (repairRegularFileMode(candidate, guard, platform)) repaired += 1;
  }
  guard.validate();
  return { repaired, acl: platform === "win32" ? WINDOWS_ACL_BOUNDARY : null };
}

function preparePrivateSqliteStorage(databasePath, options = {}) {
  const platform = options.platform || process.platform;
  const trustedRoot = requireTrustedRoot(options);
  const guard = createPathGuard(trustedRoot, options);
  const candidateDatabase = guard.assertContained(databasePath);
  ensureGuardedDirectories(path.dirname(candidateDatabase), guard, platform);
  repairPrivateSqliteFiles(candidateDatabase, { ...options, trustedRoot, platform });

  let identity = guard.remember(candidateDatabase, "file");
  if (!identity) {
    let opened;
    try {
      opened = openGuardedRegularFile(
        candidateDatabase,
        guard,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        OWNER_ONLY_FILE_MODE,
        "database_create",
      );
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    } finally {
      if (opened?.handle !== undefined) fs.closeSync(opened.handle);
    }
    identity = guard.remember(candidateDatabase, "file");
    if (!identity) throw storagePolicyError("PRIVATE_SQLITE_FILE_CREATE_FAILED");
  }
  repairRegularFileMode(candidateDatabase, guard, platform);
  guard.validate();
  return {
    platform,
    directoryMode: platform === "win32" ? null : OWNER_ONLY_DIRECTORY_MODE,
    fileMode: platform === "win32" ? null : OWNER_ONLY_FILE_MODE,
    acl: platform === "win32" ? WINDOWS_ACL_BOUNDARY : null,
  };
}

function copyPrivateSqliteBackup(sourcePath, targetPath, options = {}) {
  const platform = options.platform || process.platform;
  const guard = createPathGuard(requireTrustedRoot(options), options);
  const source = guard.assertContained(sourcePath);
  const target = guard.assertContained(targetPath);
  if (source === target) throw storagePolicyError("PRIVATE_SQLITE_BACKUP_TARGET_INVALID");
  ensureGuardedDirectories(path.dirname(source), guard, platform);
  ensureGuardedDirectories(path.dirname(target), guard, platform);
  if (guard.remember(target, null)) throw storagePolicyError("PRIVATE_SQLITE_BACKUP_TARGET_EXISTS");

  const sourceOpened = openGuardedRegularFile(source, guard, fs.constants.O_RDONLY, OWNER_ONLY_FILE_MODE, "backup_source_open");
  let targetOpened;
  let completed = false;
  try {
    if (platform !== "win32") fs.fchmodSync(sourceOpened.handle, OWNER_ONLY_FILE_MODE);
    guard.stage("after_backup_source_mode", source);
    targetOpened = openGuardedRegularFile(
      target,
      guard,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      OWNER_ONLY_FILE_MODE,
      "backup_target_open",
    );
    guard.stage("before_backup_copy", target);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const bytesRead = fs.readSync(sourceOpened.handle, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(targetOpened.handle, buffer, written, bytesRead - written, position + written);
      }
      position += bytesRead;
    }
    if (platform !== "win32") fs.fchmodSync(targetOpened.handle, OWNER_ONLY_FILE_MODE);
    fs.fsyncSync(targetOpened.handle);
    guard.stage("after_backup_copy", target);
    const sourceNow = guard.remember(source, "file");
    if (!sameIdentity(sourceOpened.identity, sourceNow)) throw storagePolicyError("PRIVATE_SQLITE_PATH_IDENTITY_CHANGED");
    completed = true;
    return target;
  } catch (error) {
    if (error?.code?.startsWith("PRIVATE_SQLITE_")) throw error;
    throw storagePolicyError("PRIVATE_SQLITE_BACKUP_COPY_FAILED");
  } finally {
    fs.closeSync(sourceOpened.handle);
    if (targetOpened?.handle !== undefined) fs.closeSync(targetOpened.handle);
    if (!completed && targetOpened?.identity) {
      try {
        guard.validate();
        const current = guard.remember(target, "file");
        if (sameIdentity(current, targetOpened.identity)) fs.unlinkSync(target);
      } catch {
        // A changed ancestor is not followed during cleanup.
      }
    }
  }
}

module.exports = {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  WINDOWS_ACL_BOUNDARY,
  copyPrivateSqliteBackup,
  derivePrivateSqliteTrustedRoot,
  managedSidecarName,
  preparePrivateSqliteStorage,
  repairPrivateSqliteFiles,
};
