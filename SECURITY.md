# Security Policy

Zhixia is local-first software that may index private documents, project memory, Codex context packets, and local evidence receipts. Please treat all user data and generated memory artifacts as sensitive by default.

## Supported Versions

This repository is preparing for its first public source release. Until a stable release policy is published, security fixes target the current `main` branch and the latest tagged release, if one exists.

## Reporting a Vulnerability

If the public repository enables private security advisories, use that channel first. If not, contact the maintainers through the private reporting address configured by the repository owner. Do not include real user documents, raw Codex sessions, credentials, API keys, database files, vault contents, or screenshots containing private data in a public issue.

For a useful private report, include:

- A short impact summary.
- A minimal reproduction using synthetic data.
- Affected version or commit.
- Whether the issue can expose raw sessions, secrets, local databases, app-owned vaults, or generated memory artifacts.

## Local-First Safety Notes

- Zhixia must not upload user documents by default.
- Retrieval should stay metadata-first and compact by default.
- Raw session bodies, giant Markdown, screenshots/base64 payloads, long logs, credentials, tokens, and private keys must not appear in default Memory Runtime outputs.
- Evidence writeback should store compact app-owned JSON receipts, not mutate raw Codex sessions.
- FlowSkill candidates are private review metadata unless a later explicit user action exports or installs them.
- Archive, compact, restore, delete, move, install, execute, or public-export actions must be explicit and fail closed.

## Public Repository Hygiene

Before publishing or accepting contributions, verify that `.gitignore` excludes local databases, `.codex-knowledge/`, vaults, backups, app data, logs, screenshots, package outputs, and private evidence. See [docs/PUBLICATION_CHECKLIST.md](docs/PUBLICATION_CHECKLIST.md).
