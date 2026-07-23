const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ARCHIVE_SCHEMA_VERSION,
  PACKET_SCHEMA_VERSION,
  buildOpenClawMemoryArchiveIndex,
  estimateSerializedTokens,
  needsLikeFallback,
  normalizeRelativePath,
  queryOpenClawMemoryArchive,
} = require("../electron/openClawMemoryArchiveIndex.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixia-openclaw-archive-index-"));
const vaultRoot = path.join(root, "openclaw-memory-vault");
const batchRoot = path.join(vaultRoot, "20260720-test");
const indexPath = path.join(vaultRoot, "audit.sqlite");

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function addEntry(entries, instance, relativePath, content) {
  const backupPath = path.join(batchRoot, instance, relativePath);
  const buffer = Buffer.from(content, "utf8");
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, buffer);
  entries.push({
    instance,
    relativePath,
    sourcePath: path.join(root, instance, relativePath),
    backupPath,
    bytes: buffer.length,
    mtimeUtc: "2026-07-20T00:00:00.000Z",
    sourceSha256: hash(buffer),
    backupSha256: hash(buffer),
    verified: true,
  });
}

try {
  const entries = [];
  addEntry(
    entries,
    "openclaw",
    path.join("workspace", "memory", "project-notes.md"),
    `# Orchid Harbor\nThe Orchid Harbor audit decided that Zhixia is the canonical memory authority.\napi_key=super-secret-value\n${"A".repeat(220)}`,
  );
  addEntry(
    entries,
    "openclaw",
    path.join("workspace", "memory", "feishu-config.json"),
    '{"token":"must-not-index"}',
  );
  addEntry(
    entries,
    "openclaw",
    path.join("workspace", "memory", "sessions", "old-session.jsonl"),
    '{"message":"raw session body must stay cold"}',
  );
  addEntry(
    entries,
    "openclaw",
    path.join("memory", "main.sqlite.migrated"),
    "not really sqlite in this fixture",
  );
  addEntry(
    entries,
    "openclaw",
    path.join("workspace", "memory", "ordinary-notes.md"),
    '# Ordinary note\nCredentials must be redacted: {"password":"plain-password", "token":"plain-token"}.',
  );
  addEntry(
    entries,
    "openclaw",
    path.join("workspace", "memory", "provider-safety.md"),
    String.raw`# Provider boundary C:\Users\ArchiveOwner\private.md
Provider boundary paths: \\archive-server\private-share\notes.md \\?\C:\Users\ArchiveOwner\extended.md \\?\UNC\archive-server\private-share\extended.md file:///C:/Users/ArchiveOwner/file-uri.md file:///home/archive-owner/file-uri.md /home/archive-owner/local.md /tmp/archive-query.txt.
password=provider-fixture-secret
${"B".repeat(190)}`,
  );

  const outsideRoot = path.join(root, "outside-vault");
  const outsideWorkspace = path.join(outsideRoot, "workspace");
  const linkedWorkspace = path.join(batchRoot, "openclaw", "linked-workspace");
  fs.mkdirSync(outsideWorkspace, { recursive: true });
  fs.mkdirSync(path.dirname(linkedWorkspace), { recursive: true });
  fs.symlinkSync(outsideWorkspace, linkedWorkspace, "junction");
  const linkedContent = Buffer.from("outside junction sentinel must never be indexed", "utf8");
  const linkedBackupPath = path.join(linkedWorkspace, "escaped.md");
  fs.writeFileSync(path.join(outsideWorkspace, "escaped.md"), linkedContent);
  entries.push({
    instance: "openclaw",
    relativePath: path.join("linked-workspace", "escaped.md"),
    sourcePath: path.join(root, "openclaw", "linked-workspace", "escaped.md"),
    backupPath: linkedBackupPath,
    bytes: linkedContent.length,
    mtimeUtc: "2026-07-20T00:00:00.000Z",
    sourceSha256: hash(linkedContent),
    backupSha256: hash(linkedContent),
    verified: true,
  });

  const manifest = {
    schemaVersion: "zhixia.openclaw_memory_vault.v1",
    vaultPath: batchRoot,
    fileCount: entries.length,
    allVerified: true,
    entries,
  };
  fs.mkdirSync(batchRoot, { recursive: true });
  fs.writeFileSync(path.join(batchRoot, "MANIFEST.json"), JSON.stringify(manifest));

  const built = buildOpenClawMemoryArchiveIndex({ vaultRoot, indexPath });
  assert.equal(built.schemaVersion, ARCHIVE_SCHEMA_VERSION);
  assert.equal(built.sourceCount, 6);
  assert.equal(built.indexedSourceCount, 3);
  assert.equal(built.skippedSourceCount, 3);
  assert.ok(built.warnings.includes("backup_symlink_or_junction_skipped"));
  assert.ok(built.chunkCount >= 1);
  assert.equal(built.safety.rawSessionsIndexed, false);
  assert.equal(built.safety.secretPathsIndexed, false);

  const startedAt = Date.now();
  const packet = queryOpenClawMemoryArchive({
    vaultRoot,
    indexPath,
    query: "Orchid Harbor canonical memory",
    limit: 4,
    tokenBudget: 800,
  });
  assert.equal(packet.schemaVersion, PACKET_SCHEMA_VERSION);
  assert.equal(packet.memoryAuthority, "zhixia");
  assert.equal(packet.memoryLayer, "cold");
  assert.equal(packet.readByDefault, false);
  assert.equal(packet.explicitAuditGate, true);
  assert.ok(packet.items.length >= 1);
  assert.match(packet.items[0].excerpt, /Orchid Harbor/i);
  assert.doesNotMatch(JSON.stringify(packet), /super-secret-value/);
  assert.doesNotMatch(JSON.stringify(packet), /plain-password|plain-token/);
  assert.doesNotMatch(JSON.stringify(packet), /outside junction sentinel/);
  assert.doesNotMatch(JSON.stringify(packet), new RegExp("A{180}"));
  assert.equal(packet.effects.openClawMemoryEnabled, false);
  assert.equal(packet.effects.rawSessionRead, false);
  assert.ok(packet.providerSafeSourceRefs.every((sourceRef) => sourceRef.startsWith("openclaw-vault://")));
  assert.ok(packet.sourceRefs.some((sourceRef) => path.isAbsolute(sourceRef)));
  assert.equal(packet.providerPacket.memoryAuthority, "zhixia");
  assert.ok(packet.providerPacket.sourceRefs.every((sourceRef) => sourceRef.startsWith("openclaw-vault://")));
  assert.doesNotMatch(JSON.stringify(packet.providerPacket), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.ok(packet.providerPacket.tokenEstimate <= 800);
  const providerPacketContent = { ...packet.providerPacket };
  delete providerPacketContent.tokenEstimate;
  assert.equal(packet.providerPacket.tokenEstimate, estimateSerializedTokens(providerPacketContent));
  assert.equal(packet.tokenEstimate, packet.providerPacket.tokenEstimate);
  assert.ok(Date.now() - startedAt < 1000, "cold archive query should stay bounded");

  const skippedPacket = queryOpenClawMemoryArchive({
    vaultRoot,
    indexPath,
    query: "feishu-config",
    limit: 2,
    tokenBudget: 400,
  });
  assert.equal(skippedPacket.items[0].indexed, false);
  assert.equal(skippedPacket.items[0].skipReason, "secret_or_config_path");
  assert.doesNotMatch(JSON.stringify(skippedPacket), /must-not-index/);

  const ordinaryPacket = queryOpenClawMemoryArchive({
    vaultRoot,
    indexPath,
    query: "Ordinary note Credentials redacted",
    limit: 2,
    tokenBudget: 600,
  });
  assert.ok(ordinaryPacket.items.length >= 1);
  assert.doesNotMatch(JSON.stringify(ordinaryPacket), /plain-password|plain-token/);
  assert.match(JSON.stringify(ordinaryPacket), /secret-omitted/);

  const injectedQuery = String.raw`Provider boundary C:\Users\QueryOwner\audit.md \\query-server\share\audit.md \\?\C:\Users\QueryOwner\extended.md \\?\UNC\query-server\share\extended.md file:///tmp/query-audit.md /home/query-owner/audit.md token=query-secret ${"C".repeat(190)}`;
  const providerSafetyPacket = queryOpenClawMemoryArchive({
    vaultRoot,
    indexPath,
    query: injectedQuery,
    limit: 2,
    tokenBudget: 600,
  });
  assert.match(providerSafetyPacket.query, /C:\\Users\\QueryOwner\\audit\.md/);
  assert.match(providerSafetyPacket.query, /\\\\query-server\\share\\audit\.md/);
  assert.match(providerSafetyPacket.query, /file:\/\/\/tmp\/query-audit\.md/);
  assert.ok(providerSafetyPacket.items.some((item) => /archive-server/.test(item.excerpt)));
  assert.ok(providerSafetyPacket.providerPacket.query.length <= 240);
  assert.match(providerSafetyPacket.providerPacket.query, /\[local-path-omitted\]/);

  const providerFields = [
    providerSafetyPacket.providerPacket.query,
    ...providerSafetyPacket.providerPacket.items.flatMap((item) => [item.title, item.excerpt, ...item.sourceRefs]),
    ...providerSafetyPacket.providerPacket.sourceRefs,
  ];
  for (const value of providerFields) {
    assert.doesNotMatch(value, /\b[A-Za-z]:[\\/]/, `drive path leaked through provider field: ${value}`);
    assert.doesNotMatch(value, /\\\\(?:[?.]\\|[^\\/\s]+[\\/])/, `UNC or extended path leaked through provider field: ${value}`);
    assert.doesNotMatch(value, /file:\/\//i, `file URI leaked through provider field: ${value}`);
    assert.doesNotMatch(value, /(?:^|[\s([{=,:;])(?:~\/|\/(?:Users|home|root|tmp)(?:\/|$)|\/(?:var|private)\/tmp(?:\/|$))/i, `POSIX local path leaked through provider field: ${value}`);
    assert.doesNotMatch(value, /query-secret|provider-fixture-secret|B{180}|C{180}|raw session body must stay cold/i);
  }
  assert.ok(providerSafetyPacket.providerPacket.sourceRefs.every((sourceRef) => sourceRef.startsWith("openclaw-vault://")));
  assert.ok(providerSafetyPacket.providerPacket.tokenEstimate <= 600);

  assert.equal(needsLikeFallback([{ id: "a" }, { id: "b" }], 2), false);
  assert.equal(needsLikeFallback([{ id: "a" }, { id: "a" }], 2), true);

  assert.equal(normalizeRelativePath("workspace/memory/file.md"), path.join("workspace", "memory", "file.md"));
  assert.equal(normalizeRelativePath("workspace/memory/../../openclaw.json"), null);
  assert.equal(normalizeRelativePath("../outside.md"), null);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("OpenClaw cold archive index tests passed.");
