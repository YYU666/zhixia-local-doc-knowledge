# App-Owned Memory Runtime

Use this route for project bootstrap, takeover, direction correction, long-thread recovery, and pre-dispatch continuity checks.

## Read Contract

Send strict JSON to `scripts/invoke-app-memory-runtime.cjs`:

```json
{"operation":"verify","workspace":"<exact workspace>","taskGoal":"<goal>"}
```

```json
{"operation":"prepare_takeover","workspace":"<exact workspace>","taskGoal":"<goal>","queryType":"thread_recovery","limit":12,"tokenBudget":2200,"maxTokenBudget":10000}
```

Only treat the result as current authority when all of these fields are true:

- `memoryMode="app_owned_memory_core"`
- `authorityVerification="app_owned_verified"`
- `current=true`
- `recoveryReady=true`
- `returnedCount>0` for retrieval
- `takeover.shouldInject=true`

`prepare_takeover` uses an adaptive budget envelope: 2200 estimated tokens is the preferred start and 10000 is the hard ceiling. It grows only when the minimum source-backed recovery anchors do not fit, and reports the attempted/effective budgets. `strictTokenBudget=true` keeps the preferred budget fixed. The call returns one deterministic `contextGenerationId`; a CEO task may inject that generation once and must not append the same packet on later wakeups. A changed HEAD, canonical scan, authority checkpoint, or continuity manifest produces a different generation.

The response also carries `takeover.schemaVersion=zhixia.takeover_control.v2` and a deterministic `takeover.hostRequirements` envelope. Consumers must verify its digest and enforce all of these Host-side requirements before injection: use a distinct clean replacement task, replace context instead of appending, do not fork/copy full old history, keep the frozen task permanently non-executable and free of automatic wakeups, build a compact ThreadRecoveryPacket, and unbind the old harvest driver before binding one replacement driver. Callback relay is limited to compact decisions, hashes, diffs, and evidence refs. Zhixia explicitly reports `existingTaskHistoryTrimmableByMemoryRuntime=false`; it supplies recovery context but cannot remove Codex task history.

`fallback_stale`, helper-only output, a missing CLI, an incomplete continuity manifest, a changed HEAD, or changed canonical source hashes cannot authorize recovery.

## Cross-Project Read-Only Bootstrap

The `zhixia-control` MCP adapter exposes `portfolio_context` for a task that intentionally spans multiple projects while writing reports to a neutral artifact directory.

```json
{
  "workspaces": ["<canonical root A>", "<canonical root B>"],
  "taskGoal": "<cross-project read-only goal>",
  "perProjectTokenBudget": 3000,
  "maxTotalTokenBudget": 6000
}
```

- `workspaces` is explicit, ordered, unique, and bounded to 2-6 roots. The adapter never derives roots from raw chat, the current cwd, or an artifact directory.
- Each root runs an independent `verify`. Retrieval runs only when that root is app-owned verified, current, recovery-ready, and scan-matched.
- Every project envelope retains its own identity, scan binding, generation, items, and source refs. Source refs are filtered to the envelope project.
- A stale/error project returns no items or generation and does not block later roots.
- Per-project retrieval is strict-budget and the combined output has a bounded total budget and packet size. Portfolio retrieval uses strict Runtime read-only mode: it does not seed the semantic graph or persist trigger receipts.
- The portfolio result is read-only and deliberately has no combined context generation, checkpoint, receipt, takeover, or write authority.
- `writeback_evidence`, `refresh_binding`, seed, and every other lifecycle write remain exact single-workspace operations.

## Compatibility Refresh

`write_compatibility` is an explicit maintenance operation. Run `verify` first, then pass its exact `projectIdentity.projectIdentitySha256` and `scanBinding.currentScanSha256` with `execute=true`.

The operation backs up existing generated packets under app-owned storage, then writes bounded `.codex-knowledge/project-resume.md`, `retrieval-packet.md`, and `thread-recovery-packet.json`. These files remain compatibility views, not authority.

## Exact-Scan Lifecycle Write

`observe_event` and `writeback_evidence` require `execute=true`, the current `projectIdentity.projectIdentitySha256`, `scanBinding.currentScanSha256`, and at least one source ref from the exact scan. Accepted writes carry the scan binding forward and preserve untouched working-state slots from the last authorized checkpoint.

## Accepted Binding Refresh

### Incremental accepted-Slice ledger

A long-running canonical workspace does not need to remain stable while independent frozen candidates are reviewed. `stage_accepted_slice` accepts an explicit `acceptance-receipt.json`, its exact SHA-256, the canonical workspace, and the current project-identity SHA. It reads only the bounded receipt and its declared candidate postimages, rejects symlink/escape, secret/raw-session/base64 payloads and digest mismatch, and publishes one immutable HMAC-authenticated ledger entry under app-owned storage. The entry is deliberately `staged_non_authoritative`: it cannot change a checkpoint, scan binding, `current`, `recoveryReady`, or write authority.

Each path has one latest accepted head. A later Slice supersedes only overlapping paths and retains the prior entry ID as lineage. Repeating the same receipt is idempotent. `reconcile_accepted_slices` is read-only and compares every source delta since the authorized checkpoint with those latest heads. Any uncovered path, changed postimage, deletion, excluded body, truncated worktree, invalid ledger proof, or missing delta returns `not_ready`. A ready response is content-addressed and HMAC authenticated, but it is only input to ordinary app-owned authority review. It never issues an accepted-evidence receipt or executes `refresh_binding` itself.

The accepted path and lifecycle source-ref bounds are 128, matching the bounded worktree postimage envelope. This removes the former 24-path bottleneck without making scans, packets, or writes unbounded.

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

### Refresh outcome reconciliation

`refresh_binding` durably publishes an immutable, app-authenticated completed-outcome receipt before returning success. A caller that persisted `started` but lost the response may issue exactly one `query_refresh_outcome` request. The query repeats the canonical workspace, project identity SHA, target scan SHA, previous checkpoint, app-owned accepted-evidence receipt ID and digest, accepted changed paths, lane, and returned `refreshKey`.

The query is existing-only and zero-write: it does not exact-scan, open SQLite, create or repair directories, create or read a private signing key, write graph/log/receipt state, or replay refresh. The CLI rejects a request-level `storeRoot` and ignores `HOME` plus the general Runtime store-root environment override for this operation; only the fixed app-owned user-data root derived from the current OS account record and uid is authoritative. On macOS, directory and file reads use an fd-relative `openat` helper with `O_NOFOLLOW` for every component; if that adapter is unavailable, the operation returns typed `unavailable` rather than falling back to pathname reads. It verifies the Ed25519 public key anchored in the existing app-owned private authority domain, complete tuple, outcome digest, checkpoint, generation, lifecycle receipt, and six authority fields. The outcome directory never supplies its own trust anchor. Unknown, mismatched, ambiguous, unsafe, or tampered outcomes return typed `unavailable`; callers must not poll or replay `refresh_binding`.

## Safety

- Exact workspace identity and canonical scan hashes are mandatory for writes.
- Unaccepted dirty changes cannot call `refresh_binding` or become authority automatically.
- Generated `.codex-knowledge` files never seed authority.
- Default retrieval does not read raw sessions, cold-history bodies, images, base64, credentials, or long logs.
- The route starts no Electron UI and performs no archive, compact, delete, move, restore, FlowSkill install, or model call.
- When the app-owned route is unavailable, use the file helper only as advisory `fallback_stale`; do not claim current state or recovery readiness.
