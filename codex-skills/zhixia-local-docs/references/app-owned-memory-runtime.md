# App-Owned Memory Runtime

Use this route for project bootstrap, takeover, direction correction, long-thread recovery, and pre-dispatch continuity checks.

## Read Contract

Send strict JSON to `scripts/invoke-app-memory-runtime.cjs`:

```json
{"operation":"verify","workspace":"<exact workspace>","taskGoal":"<goal>"}
```

```json
{"operation":"prepare_takeover","workspace":"<exact workspace>","taskGoal":"<goal>","queryType":"thread_recovery","limit":12,"tokenBudget":3000}
```

Only treat the result as current authority when all of these fields are true:

- `memoryMode="app_owned_memory_core"`
- `authorityVerification="app_owned_verified"`
- `current=true`
- `recoveryReady=true`
- `returnedCount>0` for retrieval
- `takeover.shouldInject=true`

`prepare_takeover` is capped at 3000 estimated tokens and returns one deterministic `contextGenerationId`. A CEO task may inject that generation once; it must not append the same packet on later wakeups. A changed HEAD, canonical scan, authority checkpoint, or continuity manifest produces a different generation.

`fallback_stale`, helper-only output, a missing CLI, an incomplete continuity manifest, a changed HEAD, or changed canonical source hashes cannot authorize recovery.

## Compatibility Refresh

`write_compatibility` is an explicit maintenance operation. Run `verify` first, then pass its exact `projectIdentity.projectIdentitySha256` and `scanBinding.currentScanSha256` with `execute=true`.

The operation backs up existing generated packets under app-owned storage, then writes bounded `.codex-knowledge/project-resume.md`, `retrieval-packet.md`, and `thread-recovery-packet.json`. These files remain compatibility views, not authority.

## Exact-Scan Lifecycle Write

`observe_event` and `writeback_evidence` require `execute=true`, the current `projectIdentity.projectIdentitySha256`, `scanBinding.currentScanSha256`, and at least one source ref from the exact scan. Accepted writes carry the scan binding forward and preserve untouched working-state slots from the last authorized checkpoint.

## Accepted Binding Refresh

After a formally accepted file change invalidates the former scan, use `refresh_binding` instead of resubmitting the complete continuity seed:

```json
{
  "operation": "refresh_binding",
  "workspace": "<exact workspace>",
  "execute": true,
  "expectedProjectIdentitySha256": "<verify project identity>",
  "expectedScanSha256": "<new exact scan>",
  "previousCheckpointId": "<last authorized checkpoint>",
  "acceptedEvidenceReceipt": "<formal QA receipt>",
  "acceptedChangedPaths": ["docs/current-task.md"],
  "lane": "<module or lane>",
  "evidence": {
    "decision": "accept",
    "phase": "<accepted phase>",
    "summary": "<bounded accepted result>",
    "sourceRefs": [
      {
        "kind": "workspace_scan_receipt",
        "path": "memory-runtime://workspace-scan/<new exact scan>",
        "hash": "<new exact scan>",
        "projectId": "<exact project id>"
      },
      { "path": "docs/current-task.md", "hash": "<exact SHA-256>" }
    ]
  }
}
```

The operation checks the previous checkpoint, formal receipt identifier, accepted paths, exact source hashes, and new scan before carrying forward continuity. It returns a new one-use `contextGenerationId`. Missing acceptance, a stale checkpoint, or an unbacked path fails closed. `seed` remains for bootstrap and explicit repair, not ordinary accepted-state advancement.

The lifecycle write gate recognizes `memory-runtime://workspace-scan/<64 lowercase hex SHA-256>` only when `kind`, URI SHA, `hash`, current exact scan, and project identity all match. It preserves that app-owned receipt as internal provenance. Other URI schemes, other `memory-runtime://` routes, malformed hashes, foreign projects, and stale scans are rejected rather than resolved as local file paths.

## Safety

- Exact workspace identity and canonical scan hashes are mandatory for writes.
- Unaccepted dirty changes cannot call `refresh_binding` or become authority automatically.
- Generated `.codex-knowledge` files never seed authority.
- Default retrieval does not read raw sessions, cold-history bodies, images, base64, credentials, or long logs.
- The route starts no Electron UI and performs no archive, compact, delete, move, restore, FlowSkill install, or model call.
- When the app-owned route is unavailable, use the file helper only as advisory `fallback_stale`; do not claim current state or recovery readiness.
