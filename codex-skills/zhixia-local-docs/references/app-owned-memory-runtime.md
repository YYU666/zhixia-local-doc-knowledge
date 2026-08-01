# App-Owned Memory Runtime

Use this route for project bootstrap, takeover, direction correction, long-thread recovery, and pre-dispatch continuity checks.

## Read Contract

Send strict JSON to `scripts/invoke-app-memory-runtime.cjs`:

```json
{"operation":"verify","workspace":"<exact workspace>","taskGoal":"<goal>"}
```

```json
{"operation":"retrieve","workspace":"<exact workspace>","taskGoal":"<goal>","queryType":"thread_recovery","limit":12,"tokenBudget":3000}
```

Only treat the result as current authority when all of these fields are true:

- `memoryMode="app_owned_memory_core"`
- `authorityVerification="app_owned_verified"`
- `current=true`
- `recoveryReady=true`
- `returnedCount>0` for retrieval

`fallback_stale`, helper-only output, a missing CLI, an incomplete continuity manifest, a changed HEAD, or changed canonical source hashes cannot authorize recovery.

## Compatibility Refresh

`write_compatibility` is an explicit maintenance operation. Run `verify` first, then pass its exact `projectIdentity.projectIdentitySha256` and `scanBinding.currentScanSha256` with `execute=true`.

The operation backs up existing generated packets under app-owned storage, then writes bounded `.codex-knowledge/project-resume.md`, `retrieval-packet.md`, and `thread-recovery-packet.json`. These files remain compatibility views, not authority.

## Safety

- Exact workspace identity and canonical scan hashes are mandatory for writes.
- Generated `.codex-knowledge` files never seed authority.
- Default retrieval does not read raw sessions, cold-history bodies, images, base64, credentials, or long logs.
- The route starts no Electron UI and performs no archive, compact, delete, move, restore, FlowSkill install, or model call.
- When the app-owned route is unavailable, use the file helper only as advisory `fallback_stale`; do not claim current state or recovery readiness.
