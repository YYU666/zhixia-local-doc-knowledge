const assert = require("node:assert/strict");

const {
  attachVaultEvidenceToCompactReceipt,
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
