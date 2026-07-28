const assert = require("node:assert/strict");

const {
  SECRET_CIPHERTEXT_PREFIX,
  LEGACY_SECRET_CIPHERTEXT_PREFIX,
  createSensitiveSettingsProtector,
  isProtectedSensitiveSetting,
  sanitizeSensitiveErrorMessage,
  sensitiveSettingAvailability,
} = require("../electron/sensitiveSettingsPolicy.cjs");

function fakeSafeStorage(options = {}) {
  const key = options.key || 0x5a;
  return {
    isEncryptionAvailable: () => options.available !== false,
    getSelectedStorageBackend: () => options.backend || "dpapi",
    encryptString(value) {
      if (options.encryptError) throw options.encryptError;
      return Buffer.from(value, "utf8").map((byte) => byte ^ key);
    },
    decryptString(value) {
      if (options.decryptError) throw options.decryptError;
      return Buffer.from(value).map((byte) => byte ^ key).toString("utf8");
    },
  };
}

const fakeProvider = fakeSafeStorage();
const protector = createSensitiveSettingsProtector({ safeStorageProvider: fakeProvider });
assert.equal(protector.status, "encrypted");
const ciphertext = protector.protect("synthetic-provider-key");
assert.equal(ciphertext.startsWith(SECRET_CIPHERTEXT_PREFIX), true);
assert.equal(ciphertext.includes("synthetic-provider-key"), false);
assert.equal(isProtectedSensitiveSetting(ciphertext), true);
assert.equal(protector.unprotect(ciphertext), "synthetic-provider-key");
assert.equal(protector.protect(ciphertext), ciphertext, "already encrypted values must not be encrypted twice");
assert.equal(protector.protect(""), "", "clearing a key must not require encryption");

const legacyCiphertext = `${LEGACY_SECRET_CIPHERTEXT_PREFIX}${fakeProvider.encryptString("legacy-encrypted-key").toString("base64")}`;
const migratedCiphertext = protector.migrate(legacyCiphertext);
assert.equal(migratedCiphertext.startsWith(SECRET_CIPHERTEXT_PREFIX), true, "v1 ciphertext must migrate to the integrity-protected v2 envelope");
assert.equal(protector.unprotect(migratedCiphertext), "legacy-encrypted-key", "migrated v1 ciphertext must preserve the key");

const encodedCiphertext = ciphertext.slice(SECRET_CIPHERTEXT_PREFIX.length);
const encryptedPayload = Buffer.from(encodedCiphertext, "base64");
const decryptedPayload = fakeProvider.decryptString(encryptedPayload);
const secretOffset = Buffer.from(decryptedPayload, "utf8").indexOf(Buffer.from("synthetic-provider-key", "utf8"));
assert.notEqual(secretOffset, -1, "test fixture must locate the encrypted payload value");
encryptedPayload[secretOffset] ^= 1;
const tamperedCiphertext = `${SECRET_CIPHERTEXT_PREFIX}${encryptedPayload.toString("base64")}`;
assert.throws(
  () => protector.unprotect(tamperedCiphertext),
  (error) => error.code === "ERR_SECRET_INTEGRITY",
  "a bit flip that still decrypts to valid JSON must fail the policy-level integrity check",
);

assert.throws(
  () => protector.unprotect("legacy-plaintext-key"),
  (error) => error.code === "ERR_SECRET_LEGACY_PLAINTEXT",
  "legacy plaintext must not be silently accepted by the runtime read path",
);

const reflectedKey = "provider-reflected-key-value";
const redactedProviderError = sanitizeSensitiveErrorMessage(
  new Error(`proxy rejected Authorization: Bearer ${reflectedKey}; api_key=${reflectedKey}`),
  [reflectedKey],
);
assert.equal(redactedProviderError.includes(reflectedKey), false, "provider errors must redact the exact active key");
assert.match(redactedProviderError, /\[redacted\]/i, "provider error redaction should leave a safe diagnostic marker");
assert.equal(sensitiveSettingAvailability("", ""), "empty", "an empty persisted setting must render as empty");
assert.equal(sensitiveSettingAvailability(ciphertext, "synthetic-provider-key"), "available", "a decryptable persisted key must render as available");
assert.equal(sensitiveSettingAvailability("legacy-plaintext-key", ""), "unavailable", "a disabled legacy value must remain visible as present but unavailable so it can be cleared");
assert.equal(sensitiveSettingAvailability(tamperedCiphertext, ""), "unavailable", "tampered ciphertext must remain clearable without exposing it");
assert.throws(
  () => protector.unprotect(`${SECRET_CIPHERTEXT_PREFIX}%%%`),
  (error) => error.code === "ERR_SECRET_CIPHERTEXT_INVALID",
  "malformed ciphertext must fail closed",
);
assert.throws(
  () => createSensitiveSettingsProtector({ safeStorageProvider: fakeSafeStorage({ decryptError: new Error("tampered") }) }).unprotect(ciphertext),
  (error) => error.code === "ERR_SECRET_DECRYPT" && !error.message.includes("synthetic-provider-key"),
  "decryption failures must be redacted",
);
const providerError = new Error("provider error contains synthetic-provider-key");
providerError.code = "ERR_PROVIDER_NATIVE";
assert.throws(
  () => createSensitiveSettingsProtector({ safeStorageProvider: fakeSafeStorage({ encryptError: providerError }) }).protect("synthetic-provider-key"),
  (error) => error.code === "ERR_SECRET_ENCRYPT" && !error.message.includes("synthetic-provider-key"),
  "provider-native error codes must not bypass redacted policy errors",
);

for (const unavailable of [
  fakeSafeStorage({ available: false }),
  fakeSafeStorage({ backend: "basic_text" }),
  null,
]) {
  const unavailableProtector = createSensitiveSettingsProtector({ safeStorageProvider: unavailable });
  assert.equal(unavailableProtector.status, "unavailable");
  assert.equal(unavailableProtector.protect(""), "", "key clearing must remain available");
  assert.throws(
    () => unavailableProtector.protect("synthetic-provider-key"),
    (error) => error.code === "ERR_SECRET_STORAGE_UNAVAILABLE",
    "new plaintext persistence must fail closed without OS-backed encryption",
  );
}

console.log("sensitive settings policy tests passed");
