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

## 0.8.3

- Added safe-relief history preservation, compact thread recovery packets, conservative project classification, and metadata-first large-library startup behavior.
- Added the initial Memory Runtime lifecycle for compact context retrieval, precedent retrieval, evidence writeback, working memory, and private review candidates.

Private install evidence, transfer-kit logs, local paths, thread IDs, databases, vaults, and packaging rehearsals are excluded from this public staging directory.
