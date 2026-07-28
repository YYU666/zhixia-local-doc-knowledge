# Release Notes

This public staging copy intentionally contains a short release summary instead of private operational runlogs.

## 0.9.0 - Memory Core

- Memory Core 0.9.0 adds an app-owned Authority Core with scoped capabilities, signed receipts, lifecycle transitions, restart rehydration, and fail-closed tamper/replay/revoke/expiry handling.
- ProjectBrain provides a fixed 14-slot continuity ledger for project identity, original goals, architecture, standing rules, modules, progress, tasks, blockers, failures, next actions, thread lineage, canonical documents, and checkpoints.
- Mandatory continuity uses bounded multi-page manifests and opaque chained cursors. Invalid, cross-manifest, non-progressing, or truncated traversal remains partial and cannot claim recovery readiness.
- The new node:sqlite sidecar stores compact Memory Core governance records, FTS5 indexes, temporal facts, trigger receipts, and non-destructive migrations without whole-database export.
- CEO Flow integration now uses event-triggered Continuity Gates, bounded context/precedent retrieval, runtime event observation, source-backed evidence writeback, and trigger-receipt verification. It does not add heartbeat or every-turn recall.
- Explicit project scans can deterministically initialize or update ProjectBrain. Read-only startup, project viewing, and file watchers do not create private Memory Core state.
- The project detail UI includes a read-only Project Memory view for continuity coverage, all 14 slots, missing/conflict/review status, trusted summaries, and bounded recall reasons.
- Performance and privacy boundaries remain local-first and metadata-first: no default raw session bodies, giant Markdown, image/base64 payloads, credentials, background embedding, startup full scan, or Memory Core polling loop.

## Post-0.9.0 - OpenClaw Memory Bridge

- Added bounded OpenClaw session/runtime monitoring without a heartbeat polling loop.
- Added an explicit sanitized cold-memory archive index for Codex audit and recovery queries.
- CEO Flow can inject provider-safe Zhixia memory packets into OpenClaw while Zhixia remains the only memory authority.
- OpenClaw native durable memory stays disabled; raw sessions, local backup paths, credentials, and base64 payloads are not exposed to the provider packet.
- Added verified migration, audit, junction/path confinement, JSON-secret redaction, token-budget, and regression coverage.

## Post-0.9.0 - Security And CI Hardening

- AI Provider API keys are encrypted with Electron safeStorage before SQLite persistence, with legacy plaintext migration and fail-closed unavailable/tampered handling.
- Added unit and isolated Electron E2E coverage proving ciphertext-at-rest, main-process round-trip, and renderer masking.
- AI Provider response streams are capped at 1 MiB and settle on aborted, error, incomplete close, timeout, or request failure so partial remote responses cannot leave the UI permanently busy.
- Added a curated Windows GitHub Actions workflow for lockfile install, tests, build, production high-severity audit, and full-tree critical audit.
- Updated electron-builder to 26.15.3; documented remaining development-only transitive advisories that have no compatible upstream fix and are not shipped as runtime dependencies.

## 0.8.3

- Added safe-relief history preservation, compact thread recovery packets, conservative project classification, and metadata-first large-library startup behavior.
- Added the initial Memory Runtime lifecycle for compact context retrieval, precedent retrieval, evidence writeback, working memory, and private review candidates.

Private install evidence, transfer-kit logs, local paths, thread IDs, databases, vaults, and packaging rehearsals are excluded from this public staging directory.
