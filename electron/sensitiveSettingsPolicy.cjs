const crypto = require("node:crypto");

const SECRET_CIPHERTEXT_PREFIX = "enc:v2:";
const LEGACY_SECRET_CIPHERTEXT_PREFIX = "enc:v1:";
const SECRET_PAYLOAD_MARKER = "zhixia-sensitive-setting";
const SECRET_PAYLOAD_VERSION = 2;
const MAX_SECRET_CHARS = 4000;
const MAX_CIPHERTEXT_BYTES = 16 * 1024;
const MAX_ERROR_MESSAGE_CHARS = 500;

function secretStorageError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function selectedBackend(safeStorageProvider) {
  if (!safeStorageProvider || typeof safeStorageProvider.getSelectedStorageBackend !== "function") return null;
  try {
    return String(safeStorageProvider.getSelectedStorageBackend() || "").trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function secretIntegrity(value) {
  return crypto
    .createHash("sha256")
    .update(`${SECRET_PAYLOAD_MARKER}\0${SECRET_PAYLOAD_VERSION}\0${value}`, "utf8")
    .digest("hex");
}

function buildSecretPayload(value) {
  return JSON.stringify({
    marker: SECRET_PAYLOAD_MARKER,
    version: SECRET_PAYLOAD_VERSION,
    value,
    integrity: secretIntegrity(value),
  });
}

function parseSecretPayload(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw secretStorageError("ERR_SECRET_INTEGRITY", "Stored API key payload failed integrity validation.", error);
  }
  if (
    parsed?.marker !== SECRET_PAYLOAD_MARKER
    || parsed?.version !== SECRET_PAYLOAD_VERSION
    || typeof parsed?.value !== "string"
    || parsed.value.length === 0
    || parsed.value.length > MAX_SECRET_CHARS
    || typeof parsed?.integrity !== "string"
  ) {
    throw secretStorageError("ERR_SECRET_INTEGRITY", "Stored API key payload failed integrity validation.");
  }
  const expected = Buffer.from(secretIntegrity(parsed.value), "hex");
  const actual = /^[a-f0-9]{64}$/i.test(parsed.integrity)
    ? Buffer.from(parsed.integrity, "hex")
    : Buffer.alloc(0);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw secretStorageError("ERR_SECRET_INTEGRITY", "Stored API key payload failed integrity validation.");
  }
  return parsed.value;
}

function sanitizeSensitiveErrorMessage(error, secrets = [], fallback = "AI Provider request failed.") {
  let message = error instanceof Error ? error.message : String(error || "");
  for (const secret of secrets) {
    const value = String(secret || "");
    if (value) message = message.split(value).join("[redacted]");
  }
  message = message
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|gho|github_pat)-?[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (message || fallback).slice(0, MAX_ERROR_MESSAGE_CHARS);
}

function sensitiveSettingAvailability(storedValue, runtimeValue) {
  if (!storedValue) return "empty";
  return runtimeValue ? "available" : "unavailable";
}

function createSensitiveSettingsProtector({ safeStorageProvider = null } = {}) {
  let encryptionAvailable = false;
  try {
    encryptionAvailable = Boolean(
      safeStorageProvider
      && typeof safeStorageProvider.isEncryptionAvailable === "function"
      && safeStorageProvider.isEncryptionAvailable(),
    );
  } catch {
    encryptionAvailable = false;
  }

  const backend = selectedBackend(safeStorageProvider);
  if (backend === "basic_text") encryptionAvailable = false;

  function requireEncryption(operation) {
    if (
      !encryptionAvailable
      || typeof safeStorageProvider?.encryptString !== "function"
      || typeof safeStorageProvider?.decryptString !== "function"
    ) {
      throw secretStorageError(
        "ERR_SECRET_STORAGE_UNAVAILABLE",
        `OS-backed secret storage is unavailable; refusing to ${operation} an API key.`,
      );
    }
  }

  function protect(value) {
    const plaintext = String(value || "");
    if (!plaintext) return "";
    if (plaintext.length > MAX_SECRET_CHARS) {
      throw secretStorageError("ERR_SECRET_TOO_LARGE", "API key exceeds the supported length.");
    }
    if (plaintext.startsWith(SECRET_CIPHERTEXT_PREFIX)) {
      unprotect(plaintext);
      return plaintext;
    }
    if (plaintext.startsWith("enc:")) {
      throw secretStorageError("ERR_SECRET_CIPHERTEXT_INVALID", "Stored API key ciphertext version is unsupported.");
    }
    requireEncryption("persist");
    try {
      const encrypted = safeStorageProvider.encryptString(buildSecretPayload(plaintext));
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > MAX_CIPHERTEXT_BYTES) {
        throw secretStorageError("ERR_SECRET_ENCRYPT", "OS-backed secret storage returned invalid ciphertext.");
      }
      return `${SECRET_CIPHERTEXT_PREFIX}${encrypted.toString("base64")}`;
    } catch (error) {
      throw secretStorageError("ERR_SECRET_ENCRYPT", "API key encryption failed.", error);
    }
  }

  function unprotect(value) {
    const ciphertext = String(value || "");
    if (!ciphertext) return "";
    if (!ciphertext.startsWith(SECRET_CIPHERTEXT_PREFIX)) {
      throw secretStorageError(
        "ERR_SECRET_LEGACY_PLAINTEXT",
        "Legacy plaintext API key must be migrated before use.",
      );
    }
    requireEncryption("decrypt");
    const encoded = ciphertext.slice(SECRET_CIPHERTEXT_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw secretStorageError("ERR_SECRET_CIPHERTEXT_INVALID", "Stored API key ciphertext is invalid.");
    }
    const encrypted = Buffer.from(encoded, "base64");
    if (
      encrypted.length === 0
      || encrypted.length > MAX_CIPHERTEXT_BYTES
      || encrypted.toString("base64") !== encoded
    ) {
      throw secretStorageError("ERR_SECRET_CIPHERTEXT_INVALID", "Stored API key ciphertext is invalid.");
    }
    try {
      return parseSecretPayload(safeStorageProvider.decryptString(encrypted));
    } catch (error) {
      if (error?.code === "ERR_SECRET_INTEGRITY") throw error;
      throw secretStorageError("ERR_SECRET_DECRYPT", "Stored API key could not be decrypted.", error);
    }
  }

  function migrate(value) {
    const stored = String(value || "");
    if (!stored) return "";
    if (stored.startsWith(SECRET_CIPHERTEXT_PREFIX)) {
      unprotect(stored);
      return stored;
    }
    if (!stored.startsWith(LEGACY_SECRET_CIPHERTEXT_PREFIX)) return protect(stored);
    requireEncryption("migrate");
    const encoded = stored.slice(LEGACY_SECRET_CIPHERTEXT_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw secretStorageError("ERR_SECRET_CIPHERTEXT_INVALID", "Legacy API key ciphertext is invalid.");
    }
    const encrypted = Buffer.from(encoded, "base64");
    if (
      encrypted.length === 0
      || encrypted.length > MAX_CIPHERTEXT_BYTES
      || encrypted.toString("base64") !== encoded
    ) {
      throw secretStorageError("ERR_SECRET_CIPHERTEXT_INVALID", "Legacy API key ciphertext is invalid.");
    }
    try {
      const plaintext = safeStorageProvider.decryptString(encrypted);
      if (typeof plaintext !== "string" || plaintext.length === 0 || plaintext.length > MAX_SECRET_CHARS) {
        throw secretStorageError("ERR_SECRET_DECRYPT", "Legacy API key ciphertext could not be decrypted.");
      }
      return protect(plaintext);
    } catch (error) {
      throw secretStorageError("ERR_SECRET_DECRYPT", "Legacy API key ciphertext could not be decrypted.", error);
    }
  }

  return Object.freeze({
    backend,
    status: encryptionAvailable ? "encrypted" : "unavailable",
    protect,
    unprotect,
    migrate,
  });
}

function isProtectedSensitiveSetting(value) {
  return typeof value === "string" && value.startsWith(SECRET_CIPHERTEXT_PREFIX);
}

module.exports = {
  SECRET_CIPHERTEXT_PREFIX,
  LEGACY_SECRET_CIPHERTEXT_PREFIX,
  createSensitiveSettingsProtector,
  isProtectedSensitiveSetting,
  sanitizeSensitiveErrorMessage,
  sensitiveSettingAvailability,
};
