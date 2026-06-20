const THREAD_STORE_COMPATIBILITY_ERROR =
  "Guardian compact-session did not prove Codex thread-store compatibility; refusing to mark old-thread slimming as successful.";
const VAULT_COPY_HASH_MISMATCH_ERROR =
  "Thread history vault copy hash mismatch; refusing to mark old-thread history as ingested.";

function validateCompactSessionReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") {
    return {
      ok: false,
      error: "Guardian compact-session returned no receipt; refusing to mark old-thread slimming as successful.",
    };
  }

  if (receipt.thread_store_compatible !== true) {
    return {
      ok: false,
      error: THREAD_STORE_COMPATIBILITY_ERROR,
    };
  }

  return { ok: true };
}

function attachVaultEvidenceToCompactReceipt(receipt, vault) {
  if (!receipt || !vault) return receipt;
  return {
    ...receipt,
    vault_manifest_path: vault.manifestPath,
    vault_session_path: vault.vaultSessionPath,
    vault_sha256: vault.originalSha256,
  };
}

function validateVaultCopyHashes(originalSha256, copiedSha256) {
  const original = String(originalSha256 || "").trim();
  const copied = String(copiedSha256 || "").trim();
  if (!original || !copied) {
    return {
      ok: false,
      error: "Thread history vault hash evidence is incomplete; refusing to mark old-thread history as ingested.",
    };
  }

  if (copied !== original) {
    return {
      ok: false,
      error: VAULT_COPY_HASH_MISMATCH_ERROR,
    };
  }

  return { ok: true };
}

module.exports = {
  THREAD_STORE_COMPATIBILITY_ERROR,
  VAULT_COPY_HASH_MISMATCH_ERROR,
  attachVaultEvidenceToCompactReceipt,
  validateCompactSessionReceipt,
  validateVaultCopyHashes,
};
