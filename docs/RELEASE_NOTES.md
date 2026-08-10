# Release Notes

This public staging copy intentionally contains a short release summary instead of private operational runlogs.

## 0.9.8 - Deterministic Accepted-Range Binding

- Exact scans now include bounded text sources changed between the previous authorized HEAD and the current HEAD, covering the common product-commit then acceptance-commit workflow without project-specific paths.
- Successful seed and refresh operations persist an owner-only bounded scan profile so later verify and takeover calls reproduce the authorized scan without carrying path lists in long Codex tasks.
- Binding refresh now requires the caller's scan and its accepted-path target to resolve to one SHA; it never silently authorizes a different scan.
- Source-backed refresh accepts the full documented 24-path bound, and the Codex control scan response no longer duplicates a roughly 45-KiB manifest into both MCP content channels.

## 0.9.7 - Accepted Source Scan Coverage

- Exact scans now prioritize bounded text sources changed by the current Git HEAD, so a clean accepted commit remains source-backed even when canonical documentation fills the 48-file budget.
- Codex control tools now expose bounded `relativePaths` pinning across scan, verify, retrieval, takeover, writeback, and binding refresh operations.
- `refresh_binding` automatically pins its accepted changed paths into the exact scan while preserving the existing identity, receipt, checkpoint projection, and fail-closed gates.

## 0.9.6 - Bounded Checkpoint Projection

- High-cardinality checkpoints now bound accepted progress, tasks, blockers, and next actions before persistence while retaining one independent source-backed evidence pointer per current child.
- Explicit newly accepted progress takes precedence over carried checkpoint progress, preventing a valid refresh result from being truncated by older state.
- Optional checkpoint fields are normalized before strict persistence inspection; the existing 1,024-node, 32,000-signal-character, 64-KiB, secret, raw-session, and base64 safety limits remain unchanged.

## 0.9.5 - Refresh Checkpoint Diagnostics

- Refresh failures now retain bounded checkpoint write action/status/reason codes and stop before post-write verification when the checkpoint itself was not inserted or idempotently reused.
- Diagnostic output remains code-only and does not expose private Memory Core bodies, source text, credentials, or raw sessions.

## 0.9.4 - Exact Scan Refresh Binding

- Refresh checkpoints now retain the current exact workspace-scan receipt before bounded accepted-path evidence and discard stale carried scan receipts.
- A regression covers more accepted changed paths than the checkpoint source-ref limit, preventing a valid refresh from advancing authority while still bound to an older scan.
- Project identity, exact source hashes, owner-scoped Memory Core authority, and fail-closed writeback gates remain unchanged.

## 0.9.3 - Codex Control Plugin

- Added an app-owned MCP control surface for Codex to open or focus the installed Mac app, exact-scan a workspace, verify authority, retrieve bounded context, and prepare clean takeover packets.
- Source-backed evidence writeback and binding refresh remain behind `execute=true`, exact project identity, exact current scan, formal acceptance receipts, and existing Runtime fail-closed validation.
- Read-only control never reads raw sessions, credentials, images/base64, SQLite bodies, or complete logs; visible control operations can open the app while compact retrieval remains headless by default.

## 0.9.2 - Exact Scan Receipt Protocol Fix

- Lifecycle writes now recognize the exact app-owned `memory-runtime://workspace-scan/<SHA-256>` receipt instead of resolving it as a local file path.
- The receipt is accepted only when its kind, URI SHA, hash, current scan, and project identity all match; arbitrary URI schemes and other internal routes remain fail-closed.
- Refresh-binding regression coverage verifies that the receipt survives checkpoint and authority-receipt persistence and restores `current=true` / `recoveryReady=true`.

## 0.9.1 - Verified Long-Thread Recovery

- Memory Core 0.9.1 adds an app-owned strict-JSON recovery CLI with exact project identity, baseline HEAD, canonical source hashes, signed receipts, and non-empty continuity-first retrieval.
- ThreadRecoveryPacket output is bounded to 3000 estimated tokens and deliberately combines Hot current state with original-goal and architecture anchors; raw sessions and generated giant packets remain outside authority.
- Explicit compatibility refresh backs up former generated packets before replacing them with bounded Markdown views and a strict JSON handoff. Changed HEAD/source hashes and singleton goal conflicts fail closed.
- ProjectBrain provides a fixed 14-slot continuity ledger for project identity, original goals, architecture, standing rules, modules, progress, tasks, blockers, failures, next actions, thread lineage, canonical documents, and checkpoints.
- Mandatory continuity uses bounded multi-page manifests and opaque chained cursors. Invalid, cross-manifest, non-progressing, or truncated traversal remains partial and cannot claim recovery readiness.
- The new node:sqlite sidecar stores compact Memory Core governance records, FTS5 indexes, temporal facts, trigger receipts, and non-destructive migrations without whole-database export.
- CEO Flow integration now uses event-triggered Continuity Gates, bounded context/precedent retrieval, runtime event observation, source-backed evidence writeback, and trigger-receipt verification. It does not add heartbeat or every-turn recall.
- Explicit project scans can deterministically initialize or update ProjectBrain. Read-only startup, project viewing, and file watchers do not create private Memory Core state.
- The project detail UI includes a read-only Project Memory view for continuity coverage, all 14 slots, missing/conflict/review status, trusted summaries, and bounded recall reasons.
- Performance and privacy boundaries remain local-first and metadata-first: no default raw session bodies, giant Markdown, image/base64 payloads, credentials, background embedding, startup full scan, or Memory Core polling loop.

## Post-0.9.1 - OpenClaw Memory Bridge

- Added bounded OpenClaw session/runtime monitoring without a heartbeat polling loop.
- Added an explicit sanitized cold-memory archive index for Codex audit and recovery queries.
- CEO Flow can inject provider-safe Zhixia memory packets into OpenClaw while Zhixia remains the only memory authority.
- OpenClaw native durable memory stays disabled; raw sessions, local backup paths, credentials, and base64 payloads are not exposed to the provider packet.
- Added verified migration, audit, junction/path confinement, JSON-secret redaction, token-budget, and regression coverage.

## Post-0.9.1 - Security And CI Hardening

- AI Provider API keys are encrypted with Electron safeStorage before SQLite persistence, with legacy plaintext migration and fail-closed unavailable/tampered handling.
- Added unit and isolated Electron E2E coverage proving ciphertext-at-rest, main-process round-trip, and renderer masking.
- AI Provider response streams are capped at 1 MiB and settle on aborted, error, incomplete close, timeout, or request failure so partial remote responses cannot leave the UI permanently busy.
- Added a curated Windows GitHub Actions workflow for lockfile install, tests, build, production high-severity audit, and full-tree critical audit.
- Updated electron-builder to 26.15.3; documented remaining development-only transitive advisories that have no compatible upstream fix and are not shipped as runtime dependencies.

## Post-0.9.1 - Automatic Semantic Memory Graph

- Added native SQLite semantic entities and relations as a bounded structural recall layer over authoritative project memory.
- Task-time retrieval automatically seeds the graph from at most 24 compact authoritative items and performs bounded one-hop recall without a background timer or full-library scan.
- Graph recall is isolated by exact project and worktree identity, and the final packet remains within the shared token budget and 32 KiB response ceiling.
- Semantic graph matches remain advisory: they cannot set current or recovery-ready authority and cannot bypass continuity, freshness, or source-backed evidence gates.
- Raw sessions, vault bodies, giant Markdown, images, and base64 payloads remain outside graph indexing and recall.

## Post-0.9.1 - Project Memory Graph UI

- Added an on-demand Cytoscape.js project graph with search, entity-kind filters, fit/reset controls, list mode, selected-node highlighting, and compact source evidence details.
- The graph is code-split and mounted only after the user opens the project Memory Graph tab. Layout is non-animated, bounded to a local subgraph, and destroyed when the view unmounts.
- Opening or refreshing the graph reads only the native Memory Runtime sidecar. It does not prewarm legacy sql.js retrieval, export the main database, start a timer, or scan raw history.
- ProjectIdentityEnvelope.projectId is the primary graph scope. Existing path-hash rows are available only through an exact-canonical-path read-only compatibility lookup with diagnostics.
- Added three-viewport Electron visual checks for a nonblank graph canvas and horizontal-overflow protection, plus native IPC isolation and bounded-output tests.

## 0.8.3

- Added safe-relief history preservation, compact thread recovery packets, conservative project classification, and metadata-first large-library startup behavior.
- Added the initial Memory Runtime lifecycle for compact context retrieval, precedent retrieval, evidence writeback, working memory, and private review candidates.

Private install evidence, transfer-kit logs, local paths, thread IDs, databases, vaults, and packaging rehearsals are excluded from this public staging directory.
