# Headless Memory Runtime Contract

Use `node scripts/memory-runtime-headless.cjs` with one JSON object on stdin or `--request-json '<json>'`. Stdout is exactly one JSON object; process exit is nonzero for rejected or malformed requests.

## Actions

- `retrieve_context`: bounded RuntimeContextPacket plus trigger receipt.
- `retrieve_precedent`: bounded RuntimePrecedentPacket plus trigger receipt.
- `observe_event`: persist a compact project event without Electron UI.
- `writeback_evidence`: persist compact evidence and sourceRefs without Electron UI.
- `continuity`: read bounded Memory Core continuity status.
- `list_trigger_receipts`: list bounded receipts for the exact project identity.
- `report_worker_task_status`: persist a self-reported worker boundary (`queued`, `running`, `waiting`, `completed`, `failed`, or `cancelled`).
- `list_worker_tasks`: list project-scoped worker status; active tasks are returned by default.

Every request includes `workspace`. The runtime derives `ProjectIdentityEnvelope` with `projectId`, `canonicalRepoId`, `canonicalRoot`, `worktreeRoot`, `baselineHead`, and `projectIdentitySha256`. A linked Git worktree inherits canonical project memory; unrelated roots and caller-supplied identity mismatches fail closed.

Accepted writeback requires at least one safe sourceRef. Local source paths must belong to the canonical root or current linked worktree. Raw sessions, credentials, base64/image bodies, giant payloads, unsupported URI schemes, and foreign project IDs/paths are rejected. Writeback uses `memory-runtime/memory-runtime-index.sqlite` headless sidecar tables, preserves sourceRefs, and never writes the sql.js main database.

The headless rows are recallable as advisory hot memory. They are not authority proof. If Memory Core is absent or incompatible, retrieval returns `memoryMode="fallback_stale"`, `current=false`, `recoveryReady=false`, stale project freshness, and inactive authority validity.

This contract performs no archive, compact, delete, move, restore, public export, FlowSkill execution, raw-session read, or UI launch.

Worker status is non-authoritative telemetry. It cannot set accepted evidence, `current`, or `recoveryReady`. Reports are idempotent, progress cannot move backwards, and terminal tasks cannot be silently reopened. Agents should report only start, material progress/waiting, and terminal boundaries; no heartbeat or polling loop is required.

## Cross-Agent MCP

`node scripts/memory-runtime-mcp.cjs` exposes the same lifecycle and worker-status actions as a lazy stdio MCP server for trusted local agents such as MiniMax Code. It is a transport adapter only: all project identity, sourceRef, privacy, freshness, continuity, and authority rules remain owned by the strict-JSON runtime above. The MCP process starts on demand and performs no polling or background scan.
