# Headless Memory Runtime Contract

Use `node scripts/memory-runtime-headless.cjs` with one JSON object on stdin or `--request-json '<json>'`. Stdout is exactly one JSON object; process exit is nonzero for rejected or malformed requests.

## Actions

- `retrieve_context`: bounded RuntimeContextPacket plus trigger receipt.
- `retrieve_precedent`: bounded RuntimePrecedentPacket plus trigger receipt.
- `observe_event`: persist a compact project event without Electron UI.
- `writeback_evidence`: persist compact evidence and sourceRefs without Electron UI.
- `continuity`: read bounded Memory Core continuity status.
- `list_trigger_receipts`: list bounded receipts for the exact project identity.

Every request includes `workspace`. The runtime derives `ProjectIdentityEnvelope` with `projectId`, `canonicalRepoId`, `canonicalRoot`, `worktreeRoot`, `baselineHead`, and `projectIdentitySha256`. A linked Git worktree inherits canonical project memory; unrelated roots and caller-supplied identity mismatches fail closed.

Accepted writeback requires at least one safe sourceRef. Local source paths must belong to the canonical root or current linked worktree. Raw sessions, credentials, base64/image bodies, giant payloads, unsupported URI schemes, and foreign project IDs/paths are rejected. Writeback uses `memory-runtime/memory-runtime-index.sqlite` headless sidecar tables, preserves sourceRefs, and never writes the sql.js main database.

The headless rows are recallable as advisory hot memory. They are not authority proof. If Memory Core is absent or incompatible, retrieval returns `memoryMode="fallback_stale"`, `current=false`, `recoveryReady=false`, stale project freshness, and inactive authority validity.

This contract performs no archive, compact, delete, move, restore, public export, FlowSkill execution, raw-session read, or UI launch.
