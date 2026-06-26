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

function isImageProtectedCompactError(error) {
  return /image attachment references|image_url|local image|local_images|input_image/i.test(String(error || ""));
}

function buildImageProtectedCompactReceipt({ threadId, sourcePath, vault, error }) {
  const sizeBytes = Math.max(0, Number(vault?.sizeBytes || 0));
  return {
    kind: "compact-session",
    created_at: new Date().toISOString(),
    thread_id: threadId,
    source_path: sourcePath || vault?.sourceSessionPath || vault?.vaultSessionPath || "",
    backup_dir: "",
    backup_path: "",
    before_bytes: sizeBytes,
    after_bytes: sizeBytes,
    bytes_saved: 0,
    before_sha256: vault?.originalSha256 || null,
    backup_sha256: vault?.copiedSha256 || vault?.originalSha256 || null,
    temp_sha256: vault?.originalSha256 || null,
    after_sha256: vault?.originalSha256 || null,
    line_count: 0,
    changed_lines: 0,
    parse_errors: 0,
    thread_store_compatible: true,
    protected_skip: true,
    protected_skip_reason: "image_attachment_references",
    guardian_error: String(error || ""),
    restore_hint: "完整历史已保存在 Thread History Vault；该线程含图片引用，知匣未改写原始 session。",
  };
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
  buildImageProtectedCompactReceipt,
  isImageProtectedCompactError,
  validateCompactSessionReceipt,
  validateVaultCopyHashes,
};
