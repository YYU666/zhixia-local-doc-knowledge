# Contributing

Thank you for helping make Zhixia a dependable local Memory Runtime for CEO Flow.

## Development Setup

```powershell
npm install
npm run dev
```

Useful checks:

```powershell
node tests\smoke-test.cjs
npm test
npm run build
```

Do not run packaging, installers, or dependency installs as part of a normal documentation or policy change unless the task explicitly requires it.

## Privacy Guardrails

Contributions must not include:

- Real user documents, databases, app data, backups, vaults, logs, screenshots, or private evidence.
- `.codex-knowledge/` generated memory bundles from a real workspace.
- Raw Codex session JSONL, full chat transcripts, giant Markdown dumps, screenshots/base64 payloads, long logs, credentials, tokens, or private keys.
- Generated release artifacts, installers, blockmaps, or unpacked packaged apps.
- FlowSkill exports or installed skill copies unless the task explicitly concerns public sample docs and uses synthetic data.

Use synthetic fixtures under `tests/` when a behavior needs coverage.

## Memory Runtime Contract Rules

When changing retrieval, writeback, promotion, or helper behavior:

- Default retrieval must be compact and metadata-first.
- `retrieve_context` and `retrieve_precedent` responses need sourceRefs and bounded token estimates where practical.
- `writeback_evidence` must validate safety flags and normalized sourceRefs/content signals.
- `promote_memory` must fail closed for raw sessions, secrets, destructive actions, public export, install, or execute requests.
- No change should mutate raw Codex sessions, archive/compact/delete/move/restore user data, or install/export/execute FlowSkill output without explicit future user approval.

## Documentation

Public docs should avoid machine-specific paths, real thread IDs, private runlogs, hashes tied to private user data, and release-transfer evidence. If internal notes are useful for maintainers, keep them out of the public docs set described in [docs/PUBLIC_REPO_LAYOUT.md](docs/PUBLIC_REPO_LAYOUT.md).

## Pull Request Checklist

- Explain the product behavior changed.
- Add or update focused tests for policy changes.
- Run `node tests\smoke-test.cjs`.
- Run `npm test` for behavior changes.
- Run `npm run build` for TypeScript, renderer, Electron, preload, or package metadata changes.
- Confirm no generated/private files are staged.
