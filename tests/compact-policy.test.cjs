const assert = require("node:assert/strict");

const {
  attachVaultEvidenceToCompactReceipt,
  buildImageProtectedCompactReceipt,
  isImageProtectedCompactError,
  validateCompactSessionReceipt,
  validateVaultCopyHashes,
} = require("../electron/codexGuardianPolicy.cjs");

assert.deepEqual(
  validateCompactSessionReceipt(null),
  {
    ok: false,
    error: "Guardian compact-session returned no receipt; refusing to mark old-thread slimming as successful.",
  },
  "compact-session must fail closed when Guardian returns no receipt",
);

assert.deepEqual(
  validateCompactSessionReceipt({ thread_store_compatible: false }),
  {
    ok: false,
    error: "Guardian compact-session did not prove Codex thread-store compatibility; refusing to mark old-thread slimming as successful.",
  },
  "compact-session must fail closed without thread-store compatibility proof",
);

assert.deepEqual(
  validateCompactSessionReceipt({ thread_store_compatible: true }),
  { ok: true },
  "compact-session may continue only with explicit thread-store compatibility proof",
);

const receipt = attachVaultEvidenceToCompactReceipt(
  { thread_store_compatible: true, before_bytes: 100, after_bytes: 40 },
  {
    manifestPath: "C:\\vault\\latest.json",
    vaultSessionPath: "C:\\vault\\session.jsonl",
    originalSha256: "abc123",
  },
);

assert.equal(receipt.vault_manifest_path, "C:\\vault\\latest.json", "successful compact receipts must include vault manifest evidence");
assert.equal(receipt.vault_session_path, "C:\\vault\\session.jsonl", "successful compact receipts must include vault session evidence");
assert.equal(receipt.vault_sha256, "abc123", "successful compact receipts must include vault hash evidence");

assert.equal(
  isImageProtectedCompactError("Session contains image attachment references; refusing compact-session to avoid corrupting image_url/local image payloads."),
  true,
  "image-bearing compact refusals should be recognized as protected-skip candidates",
);

const protectedReceipt = buildImageProtectedCompactReceipt({
  threadId: "thread-with-image",
  sourcePath: "C:\\codex\\sessions\\thread-with-image.jsonl",
  vault: {
    manifestPath: "C:\\vault\\latest.json",
    vaultSessionPath: "C:\\vault\\session.jsonl",
    sourceSessionPath: "C:\\codex\\sessions\\thread-with-image.jsonl",
    originalSha256: "image-hash",
    copiedSha256: "image-hash",
    sizeBytes: 2048,
  },
  error: "image_url detected",
});
assert.equal(protectedReceipt.protected_skip, true, "image-protected receipts must mark that no body slimming occurred");
assert.equal(protectedReceipt.thread_store_compatible, true, "image-protected receipts may act as archive evidence because the session is left untouched");
assert.equal(protectedReceipt.before_bytes, protectedReceipt.after_bytes, "image-protected receipts must not claim space savings");
assert.equal(protectedReceipt.bytes_saved, 0, "image-protected receipts must report zero bytes saved");
assert.deepEqual(validateCompactSessionReceipt(protectedReceipt), { ok: true }, "image-protected receipts should pass compact receipt validation");

assert.deepEqual(
  validateVaultCopyHashes("abc123", "abc123"),
  { ok: true },
  "Thread History Vault copy may be accepted only when copied hash equals original hash",
);

assert.deepEqual(
  validateVaultCopyHashes("abc123", "def456"),
  {
    ok: false,
    error: "Thread history vault copy hash mismatch; refusing to mark old-thread history as ingested.",
  },
  "Thread History Vault copy must fail closed on hash mismatch",
);

assert.deepEqual(
  validateVaultCopyHashes("abc123", ""),
  {
    ok: false,
    error: "Thread history vault hash evidence is incomplete; refusing to mark old-thread history as ingested.",
  },
  "Thread History Vault copy must fail closed when copied hash evidence is missing",
);

console.log("Compact policy behavior tests passed.");
