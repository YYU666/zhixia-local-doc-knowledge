const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const OUTCOME_SCHEMA = "zhixia.completed_refresh_outcome.v2";
const CLI_SCHEMA = "zhixia.memory_runtime_cli.v1";
const OUTCOME_ROOT_PARTS = ["completed-refresh-outcomes", "v2"];
const AUTHORITY_PUBLIC_KEY_PARTS = ["private", "memory-core-authority-public-key.der"];
const OUTCOME_FILE = "outcome.json";
const MAX_OUTCOME_BYTES = 32 * 1024;
const MAX_ACCEPTED_CHANGED_PATHS = 128;
const OPENAT_HELPER_PATH = path.join(__dirname, "readonlyOpenatHelper.py");

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeDigestEqual(left, right) {
  return /^[a-f0-9]{64}$/.test(String(left || ""))
    && /^[a-f0-9]{64}$/.test(String(right || ""))
    && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function normalizePaths(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ACCEPTED_CHANGED_PATHS) {
    throw new Error("refresh_outcome_request_invalid");
  }
  const paths = [...new Set(values.map((value) => String(value || "").replace(/\\/g, "/").replace(/^\.\//, "")))].sort();
  if (paths.some((value) => !value || path.isAbsolute(value) || value.startsWith("../") || value.includes("\0"))) {
    throw new Error("refresh_outcome_request_invalid");
  }
  return paths;
}

function acceptedPathDigest(values) {
  return sha256(stable(normalizePaths(values)));
}

function buildQueryBasis(request = {}) {
  const basis = {
    workspace: String(request.workspace || ""),
    expectedProjectIdentitySha256: String(request.expectedProjectIdentitySha256 || ""),
    expectedScanSha256: String(request.expectedScanSha256 || ""),
    previousCheckpointId: String(request.previousCheckpointId || ""),
    acceptedEvidenceReceipt: String(request.acceptedEvidenceReceipt || ""),
    acceptedEvidenceReceiptDigest: String(request.acceptedEvidenceReceiptDigest || ""),
    acceptedPathDigest: acceptedPathDigest(request.acceptedChangedPaths),
    lane: String(request.lane || ""),
  };
  if (!path.isAbsolute(basis.workspace) || path.resolve(basis.workspace) !== basis.workspace
      || !/^[a-f0-9]{64}$/.test(basis.expectedProjectIdentitySha256)
      || !/^[a-f0-9]{64}$/.test(basis.expectedScanSha256)
      || !basis.previousCheckpointId || basis.previousCheckpointId.length > 220
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,219}$/.test(basis.acceptedEvidenceReceipt)) {
    throw new Error("refresh_outcome_request_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(basis.acceptedEvidenceReceiptDigest) || !basis.lane || basis.lane.length > 180) {
    throw new Error("refresh_outcome_request_invalid");
  }
  return basis;
}

function buildRefreshKey(basis) {
  return sha256(stable(basis));
}

function unavailable(request, reason) {
  return {
    schemaVersion: CLI_SCHEMA,
    operation: "query_refresh_outcome",
    status: "unavailable",
    current: false,
    recoveryReady: false,
    refreshKey: String(request?.refreshKey || ""),
    reasonCodes: [reason],
    safety: { writes: 0, scans: 0, sqliteOpens: 0, keyCreates: 0, logs: 0 },
  };
}

function containedRelative(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("refresh_outcome_unsafe_path");
  }
  return relative;
}

function captureDirectoryChain(root, candidate, fsAdapter = fs) {
  const relative = containedRelative(root, candidate);
  const canonicalRoot = fsAdapter.realpathSync(root);
  const paths = [root];
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    paths.push(current);
  }
  return paths.map((directory) => {
    const stats = fsAdapter.lstatSync(directory);
    const real = fsAdapter.realpathSync(directory);
    const expectedReal = path.join(canonicalRoot, path.relative(root, directory));
    if (!stats.isDirectory() || stats.isSymbolicLink() || real !== expectedReal) {
      throw new Error("refresh_outcome_unsafe_path");
    }
    return { path: directory, real, dev: stats.dev, ino: stats.ino };
  });
}

function assertDirectoryChainUnchanged(chain, fsAdapter = fs) {
  for (const expected of chain) {
    const stats = fsAdapter.lstatSync(expected.path);
    const real = fsAdapter.realpathSync(expected.path);
    if (!stats.isDirectory() || stats.isSymbolicLink() || real !== expected.real
        || stats.dev !== expected.dev || stats.ino !== expected.ino) {
      throw new Error("refresh_outcome_unsafe_path");
    }
  }
}

function readDirectoryStable(root, directory, fsAdapter = fs) {
  const chain = captureDirectoryChain(root, directory, fsAdapter);
  const names = fsAdapter.readdirSync(directory);
  assertDirectoryChainUnchanged(chain, fsAdapter);
  return names;
}

function readRegularFileStable(root, filePath, maxBytes = MAX_OUTCOME_BYTES, fsAdapter = fs) {
  const parent = path.dirname(filePath);
  const chain = captureDirectoryChain(root, parent, fsAdapter);
  let fd;
  try {
    const before = fsAdapter.lstatSync(filePath);
    if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > maxBytes) {
      throw new Error("refresh_outcome_unsafe_path");
    }
    fd = fsAdapter.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fsAdapter.fstatSync(fd);
    const after = fsAdapter.lstatSync(filePath);
    assertDirectoryChainUnchanged(chain, fsAdapter);
    if (!opened.isFile() || opened.size <= 0 || opened.size > maxBytes
        || after.isSymbolicLink() || !after.isFile()
        || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.dev !== after.dev || opened.ino !== after.ino) {
      throw new Error("refresh_outcome_unsafe_path");
    }
    const bytes = fsAdapter.readFileSync(fd);
    if (bytes.length !== opened.size) throw new Error("refresh_outcome_unsafe_path");
    return Buffer.from(bytes);
  } finally {
    if (fd !== undefined) fsAdapter.closeSync(fd);
  }
}

function outcomeRoot(storeRoot) {
  return path.join(storeRoot, ...OUTCOME_ROOT_PARTS);
}

function authorityPublicKeyPath(storeRoot) {
  return path.join(storeRoot, ...AUTHORITY_PUBLIC_KEY_PARTS);
}

function runReadonlyOpenat(request, options = {}) {
  if (typeof options.openatRunner === "function") return options.openatRunner(request);
  if (process.platform !== "darwin") throw new Error("refresh_outcome_openat_unavailable");
  let helperSource;
  try {
    helperSource = fs.readFileSync(OPENAT_HELPER_PATH, "utf8");
  } catch {
    throw new Error("refresh_outcome_openat_unavailable");
  }
  let completed;
  try {
    completed = childProcess.spawnSync("/usr/bin/python3", ["-c", helperSource], {
      input: Buffer.from(JSON.stringify(request), "utf8"),
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
  } catch {
    throw new Error("refresh_outcome_openat_unavailable");
  }
  if (completed.error) throw new Error("refresh_outcome_openat_unavailable");
  let result;
  try { result = JSON.parse(completed.stdout); } catch { throw new Error("refresh_outcome_openat_unavailable"); }
  if (result?.status !== "ok") {
    if (result?.error === "readonly_openat_not_found") throw new Error("refresh_outcome_unknown");
    if (result?.error === "readonly_openat_unsafe_path") throw new Error("refresh_outcome_unsafe_path");
    throw new Error("refresh_outcome_openat_unavailable");
  }
  return result;
}

function listDirectoryOpenat(storeRoot, segments, options = {}) {
  const result = runReadonlyOpenat({ operation: "list_directory", root: storeRoot, directorySegments: segments }, options);
  if (result.kind !== "directory" || !Array.isArray(result.names)
      || result.names.length > 64 || result.names.some((name) => typeof name !== "string" || !name || name.includes("/"))) {
    throw new Error("refresh_outcome_schema_invalid");
  }
  return result.names;
}

function readFileOpenat(storeRoot, directorySegments, fileName, maxBytes, options = {}) {
  const result = runReadonlyOpenat({
    operation: "read_file", root: storeRoot, directorySegments, fileName, maxBytes,
  }, options);
  if (result.kind !== "file" || typeof result.bytesBase64 !== "string") throw new Error("refresh_outcome_schema_invalid");
  const bytes = Buffer.from(result.bytesBase64, "base64");
  if (bytes.length < 1 || bytes.length > maxBytes || bytes.toString("base64") !== result.bytesBase64) {
    throw new Error("refresh_outcome_schema_invalid");
  }
  return bytes;
}

function deriveSigningIdentity(authorityKey) {
  if (!Buffer.isBuffer(authorityKey) || authorityKey.length < 32) throw new Error("refresh_outcome_authentication_unavailable");
  const seed = crypto.createHash("sha256").update(authorityKey).digest();
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicDer = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return { privateKey, publicDer, keyId: sha256(publicDer) };
}

function validateOutcome(outcome, basis, refreshKey, publicKeyDer) {
  if (outcome?.schemaVersion !== OUTCOME_SCHEMA || outcome.status !== "completed" || outcome.refreshKey !== refreshKey) {
    throw new Error("refresh_outcome_schema_invalid");
  }
  if (stable(outcome.queryBasis) !== stable(basis)) throw new Error("refresh_outcome_tuple_mismatch");
  const core = {
    schemaVersion: outcome.schemaVersion,
    status: outcome.status,
    refreshKey: outcome.refreshKey,
    queryBasis: outcome.queryBasis,
    result: outcome.result,
  };
  const digest = sha256(stable(core));
  if (!safeDigestEqual(outcome.outcomeDigest, digest)) throw new Error("refresh_outcome_digest_invalid");
  const signature = Buffer.from(String(outcome.authentication?.signature || ""), "base64");
  if (outcome.authentication?.scheme !== "ed25519"
      || !safeDigestEqual(outcome.authentication?.keyId, sha256(publicKeyDer))
      || signature.length !== 64
      || !crypto.verify(null, Buffer.from(stable({ core, outcomeDigest: digest })), {
        key: publicKeyDer, format: "der", type: "spki",
      }, signature)) {
    throw new Error("refresh_outcome_signature_invalid");
  }
  const result = outcome.result || {};
  if (result.operation !== "refresh_binding" || result.status !== "verified"
      || result.memoryMode !== "app_owned_memory_core" || result.authorityVerification !== "app_owned_verified"
      || result.current !== true || result.recoveryReady !== true || result.takeover?.shouldInject !== true
      || result.workspace !== basis.workspace || result.scanSha256 !== basis.expectedScanSha256
      || result.projectIdentity?.projectIdentitySha256 !== basis.expectedProjectIdentitySha256
      || result.previousCheckpointId !== basis.previousCheckpointId
      || result.acceptedEvidenceReceipt !== basis.acceptedEvidenceReceipt
      || result.acceptedEvidenceReceiptDigest !== basis.acceptedEvidenceReceiptDigest
      || acceptedPathDigest(result.acceptedChangedPaths) !== basis.acceptedPathDigest
      || result.acceptedPathDigest !== basis.acceptedPathDigest
      || result.lane !== basis.lane
      || !result.authorizedCheckpointId || result.authorizedCheckpointId === basis.previousCheckpointId
      || !result.receiptId || !result.contextGenerationId) throw new Error("refresh_outcome_tuple_mismatch");
  return result;
}

function queryCompletedRefreshOutcome(request = {}, options = {}) {
  try {
    const storeRoot = path.resolve(options.storeRoot || request.storeRoot || "");
    if (options.rejectStoreRootOverride === true && Object.prototype.hasOwnProperty.call(request, "storeRoot")) {
      return unavailable(request, "refresh_outcome_store_root_override_rejected");
    }
    if (!storeRoot || !fs.existsSync(storeRoot)) return unavailable(request, "refresh_outcome_store_unavailable");
    const basis = buildQueryBasis(request);
    const refreshKey = buildRefreshKey(basis);
    if (request.refreshKey !== refreshKey) return unavailable(request, "refresh_outcome_refresh_key_mismatch");
    const outcomeSegments = [...OUTCOME_ROOT_PARTS, refreshKey.slice(0, 2), refreshKey];
    const names = listDirectoryOpenat(storeRoot, outcomeSegments, options);
    const formal = names.filter((name) => name.endsWith(".json"));
    if (!formal.includes(OUTCOME_FILE)) return unavailable(request, "refresh_outcome_unknown");
    if (formal.length !== 1) return unavailable(request, "refresh_outcome_ambiguous");
    const publicKeyDer = readFileOpenat(storeRoot, [AUTHORITY_PUBLIC_KEY_PARTS[0]], AUTHORITY_PUBLIC_KEY_PARTS[1], 4096, options);
    const outcome = JSON.parse(readFileOpenat(storeRoot, outcomeSegments, OUTCOME_FILE, MAX_OUTCOME_BYTES, options).toString("utf8"));
    const result = validateOutcome(outcome, basis, refreshKey, publicKeyDer);
    return {
      ...result,
      operation: "query_refresh_outcome",
      refreshKey,
      acceptedPathDigest: basis.acceptedPathDigest,
      outcomeDigest: outcome.outcomeDigest,
      outcomeVerification: "app_owned_authenticated",
      safety: { writes: 0, scans: 0, sqliteOpens: 0, keyCreates: 0, logs: 0 },
    };
  } catch (error) {
    const reason = /^refresh_outcome_/.test(String(error?.message || "")) ? error.message : "refresh_outcome_schema_invalid";
    return unavailable(request, reason);
  }
}

function ensurePublishDirectory(storeRoot, refreshKey) {
  const root = path.resolve(storeRoot);
  captureDirectoryChain(root, root);
  let current = root;
  for (const segment of [...OUTCOME_ROOT_PARTS, refreshKey.slice(0, 2), refreshKey]) {
    current = path.join(current, segment);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
    captureDirectoryChain(root, current);
  }
  return current;
}

function publishAuthorityPublicKey(storeRoot, publicDer) {
  const root = path.resolve(storeRoot);
  const privateRoot = path.join(root, AUTHORITY_PUBLIC_KEY_PARTS[0]);
  captureDirectoryChain(root, privateRoot);
  const finalPath = authorityPublicKeyPath(root);
  const temporary = path.join(privateRoot, `.${path.basename(finalPath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  if (fs.existsSync(finalPath)) {
    if (!readRegularFileStable(root, finalPath, 4096).equals(publicDer)) throw new Error("refresh_outcome_public_key_conflict");
    return;
  }
  fs.writeFileSync(temporary, publicDer, { flag: "wx", mode: 0o600 });
  let fd = fs.openSync(temporary, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temporary, finalPath); } catch (error) {
    if (error?.code !== "EEXIST" || !readRegularFileStable(root, finalPath, 4096).equals(publicDer)) throw error;
  } finally {
    fs.unlinkSync(temporary);
  }
  fd = fs.openSync(privateRoot, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function buildOutcome(basis, refreshKey, result, signingIdentity) {
  const core = { schemaVersion: OUTCOME_SCHEMA, status: "completed", refreshKey, queryBasis: basis, result };
  const outcomeDigest = sha256(stable(core));
  return {
    ...core,
    outcomeDigest,
    authentication: {
      scheme: "ed25519",
      keyId: signingIdentity.keyId,
      signature: crypto.sign(null, Buffer.from(stable({ core, outcomeDigest })), signingIdentity.privateKey).toString("base64"),
    },
  };
}

function publishCompletedRefreshOutcome(options = {}) {
  const basis = buildQueryBasis(options.request);
  const refreshKey = buildRefreshKey(basis);
  if (options.request.refreshKey && options.request.refreshKey !== refreshKey) throw new Error("refresh_outcome_refresh_key_mismatch");
  const signingIdentity = deriveSigningIdentity(options.authorityKey);
  const outcome = buildOutcome(basis, refreshKey, options.result, signingIdentity);
  validateOutcome(outcome, basis, refreshKey, signingIdentity.publicDer);
  const bytes = Buffer.from(`${JSON.stringify(outcome)}\n`, "utf8");
  const directory = ensurePublishDirectory(options.storeRoot, refreshKey);
  publishAuthorityPublicKey(options.storeRoot, signingIdentity.publicDer);
  const finalPath = path.join(directory, OUTCOME_FILE);
  const temporary = path.join(directory, `.${OUTCOME_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    try { fs.linkSync(temporary, finalPath); } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readRegularFileStable(path.resolve(options.storeRoot), finalPath);
      if (!existing.equals(bytes)) throw new Error("refresh_outcome_publication_conflict");
    }
    fs.unlinkSync(temporary);
    const dirFd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  const query = queryCompletedRefreshOutcome({ ...options.request, refreshKey }, { storeRoot: options.storeRoot });
  if (query.status !== "verified") throw new Error(`refresh_outcome_publication_verify_failed:${query.reasonCodes?.[0] || query.status}`);
  return { refreshKey, outcomeDigest: outcome.outcomeDigest, finalPath };
}

module.exports = {
  OUTCOME_SCHEMA,
  acceptedPathDigest,
  buildQueryBasis,
  buildRefreshKey,
  publishCompletedRefreshOutcome,
  queryCompletedRefreshOutcome,
};
