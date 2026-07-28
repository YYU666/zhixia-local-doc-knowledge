# Native SQLite Shadow Migration Plan

## Goal

Move document metadata and retrieval indexes away from the sql.js whole-database export path without risking the current user database. The existing sql.js database remains authoritative until a later, separately approved cutover.

## Phase 1: reversible shadow slice

1. Run `node scripts/plan-native-document-migration.cjs --source <database.sqlite> --out <migration-root>` without `--execute` to produce a read-only plan.
2. An explicit `--execute` creates a byte-for-byte source snapshot and verifies its SHA-256 before reading it.
3. A separate native SQLite shadow receives document IDs, project/source metadata, hashes, duplicate pointers, timestamps, and content lengths only.
4. `contentText`, image/base64 payloads, raw sessions, and giant bodies are never copied into the shadow.
5. The manifest verifies source hash stability, snapshot equality, row-count equality, shadow hash, and absence of `contentText`.
6. There is no cutover, main database write, WAL mutation, archive action, or deletion. Rollback quarantines or discards only the shadow output.

## Later gates

- Measure installed-app read latency and memory against the shadow.
- Add FTS/vector indexes to separate native sidecars with bounded packet retrieval.
- Dual-read comparison must pass before any authority change.
- Cutover requires a new migration version, explicit backup/restore drill, installed-build validation, and user approval.
