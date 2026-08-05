# Release Notes

This public staging copy intentionally contains a short release summary instead of private operational runlogs.

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
