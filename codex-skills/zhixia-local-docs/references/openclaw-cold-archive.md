# OpenClaw Cold Archive

Zhixia is the sole memory authority for Codex and OpenClaw. Retired OpenClaw `MEMORY.md` and `memory/**` files remain cold evidence, not active agent memory.

## Roles

- Codex may query the sanitized cold index during an explicit audit, recovery, or provenance check.
- CEO Flow may inject bounded excerpts and `providerSafeSourceRefs` into an OpenClaw typed task.
- OpenClaw never installs the Zhixia Skill, reads the vault, builds the index, writes memory, or promotes archive material.

## Commands

Explicit one-time or maintainer rebuild:

```powershell
node scripts/read-openclaw-memory-archive.cjs --build --json
```

Bounded audit query:

```powershell
node scripts/read-openclaw-memory-archive.cjs --query "<audit topic>" --limit 6 --token-budget 1200 --json
```

Query does not walk the vault or read source files. It opens the app-owned SQLite index read-only with `query_only` and returns `zhixia.openclaw_cold_archive_packet.v1`.

## Packet Boundary

Codex-only fields retain the local diagnostic query and may include the absolute cold backup path for narrow local verification. External execution receives only `providerPacket`, where:

- `query` is separately sanitized and capped at 240 characters;
- compact `items[].title` and `items[].excerpt` are sanitized again at the provider boundary;
- provider source refs use provider-safe `openclaw-vault://...` URIs;
- local drive paths, POSIX home/temp paths, UNC paths, extended Windows paths, and `file://` paths are replaced with `[local-path-omitted]`;
- secret-like values and base64 runs remain redacted.

Do not reconstruct provider input from the diagnostic packet or forward diagnostic `sourceRefs`, raw manifests, SQLite files, skipped sensitive bodies, raw session bodies, or index-build diagnostics to OpenClaw.

## Index Safety

- Maximum 16 archive batches, 500 files, 2 MiB per file, and 32 MiB aggregate reads per explicit build.
- `.jsonl`, session/chat backups, secret/config paths, binary/unsupported files, oversized files, hash mismatches, and path escapes are not indexed.
- Secret-like values and base64 runs are redacted before chunking.
- Query limit is at most 12 and token budget at most 2400.
- Build never modifies source archive files or enables OpenClaw native memory.
