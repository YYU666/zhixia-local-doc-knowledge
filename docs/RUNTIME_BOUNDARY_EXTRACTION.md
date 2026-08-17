# Runtime Boundary Extraction Plan

## Decision

P3-ZHIXIA-013 uses a bounded strangler pattern. The first production integration is now live: Electron registers `createIpcFacade` through `runtimeBoundaryIntegration.cjs`; preload keeps its public methods but routes Guardian, authority lifecycle, and strict read-only retrieval through facade channels; the ordinary authority UI uses the shared renderer reducer; and the Skill candidate status mutation family uses `persistenceTransactionPort`. This does not claim that the remaining Electron main process and renderer are fully decomposed.

## Responsibility Map

| Boundary | Standalone contract | Current integration hook |
|---|---|---|
| Platform Guardian | `platformGuardianPort.cjs` reports capability and permits only named read/mutation operations. Unsupported platforms never reach an executor. | Integrated: main injects existing Guardian operations; preload routes all public Guardian methods through one facade route. |
| Authority lifecycle | `authorityLifecyclePort.cjs` separates read-only review from explicit accept-refresh-reverify and requires all five readiness checks, receipt, and checkpoint. | Integrated: the existing app-owned adapter is injected once; legacy authority IPC registration is removed. |
| Persistence transaction | `persistenceTransactionPort.cjs` permits one active mutation and requires durable commit or snapshot restore followed by degraded read-only. | Partially integrated: `memory:updateSkillCandidateStatus` is the first migrated mutation family. Remaining mutate-plus-save families are future bounded migrations. |
| Strict read-only memory query | `strictReadonlyMemoryQueryPort.cjs` compares injected before/after write-state snapshots and rejects hidden graph, receipt, log, or database changes. | Integrated for renderer `readOnly:true` retrieval through the facade; non-read-only retrieval retains its existing API path. |
| IPC facade | `ipcFacade.cjs` contains a small explicit channel allowlist and delegates only to ports. | Integrated through `runtimeBoundaryIntegration.cjs`; ten legacy Guardian/authority registrations were removed. |
| Renderer workflow | `src/authorityRendererWorkflow.mjs` owns visible verify -> review -> accept -> refresh -> reverify state. It cannot grant authority. | Integrated in ordinary project authority UI; buttons, busy state, failure and ready labels derive from reducer state. |

All modules under `electron/runtimeBoundaries/` except the measurement module are dependency-injected and do not import Electron, filesystem, child-process, SQL, or renderer code. They are safe to test without opening the app or user data.

## Complexity Budget

New boundary modules have a hard per-file target of at most 240 lines, 18 functions, 55 lexical branches, and 5 `require` calls. `scripts/check-runtime-boundaries.cjs` enforces this target.

Legacy files are explicitly classified as debt rather than silently grandfathered as acceptable architecture. The 2026-08-13 ratchet ceilings are:

| File | Ratchet |
|---|---|
| `electron/main.cjs` | <= 11,800 lines, 440 functions, 60 direct IPC handlers, 25 `saveDatabase` calls |
| `electron/preload.cjs` | <= 120 lines, 4 functions, 90 IPC invokes |
| `src/App.tsx` | <= 8,700 lines, 240 functions, 180 Guardian mentions, 80 authority mentions |

The counts are deterministic lexical metrics, not AST cyclomatic complexity. They are useful as a no-growth ratchet and extraction progress signal. Ratchets may move downward after an accepted extraction; they must not be raised merely to pass CI.

Current measured coupling is reported by the check command. During this bounded lane, the concurrently active `electron/main.cjs` moved from 11,710 to 11,767 lines without edits from this lane, so its narrow ceiling was recaptured at 11,800 rather than overwriting parallel work. At this postimage it still has more than 400 functions, about 70 IPC handlers, and more than 20 persistence calls; `src/App.tsx` remains roughly 8.6k lines with more than 200 functions. Both are `legacy_over_target_within_ratchet`, not target-compliant modules.

## Safe Integration Order

1. Continue wrapping durable mutations one operation family at a time; retain fault injection at write, rename, fsync, rollback, and overlapping-save boundaries.
2. Move remaining query implementations out of main while preserving the strict before/after write-state guard.
3. Move the static preload Guardian capability value to a startup-cached facade result without changing synchronous renderer compatibility.
4. Migrate additional bounded IPC domains only after preload/type/UI and Electron E2E parity.
5. Lower legacy ratchets after each accepted migration.

This local architecture contract does not close platform, signing, notarization, network, installed-app, or final root-audit evidence.
