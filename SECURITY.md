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

## Current Application Guardrails

- Renderer settings updates are key/type whitelisted in the main process. Unknown setting keys must be rejected rather than merged into persisted settings.
- AI Provider endpoints must be trusted HTTPS URLs. The default provider is `https://api.deepseek.com` with model `deepseek-chat`; AI features are opt-in and may send selected document text to the configured provider only after a user action.
- Project-memory writes and tool inventory scans must stay inside registered workspaces derived from imported or scanned project paths.
- Electron windows use context isolation, no Node integration, explicit sandboxing, CSP response headers, denied window opens, guarded navigation, and denied permission requests.
- Guardian actions that can clean logs, optimize/compact threads, or generate archive queues require an explicit user-confirmation signal. They must not run as hidden background maintenance.
- The default Guardian script path is app-owned user data (`userData/tools/codex-history-guardian.ps1`). Development overrides require `ZHIXIA_CODEX_GUARDIAN_SCRIPT`.

## Known Residual Risks

- API keys are still stored locally in the app database rather than an OS keychain. They are masked before returning to the renderer, but local disk compromise remains in scope.
- The app is still built around sql.js, which exports the full database on write; very large local stores can still hit performance and memory ceilings.
- `electron/main.cjs` and `src/App.tsx` remain large files. Security-critical checks now have a policy module, but further module splitting is needed to reduce regression risk.
- The product is Chinese-first and local-first. It should not be marketed as a complete international SaaS-style knowledge platform, cloud sync product, or unlimited memory graph.

## Public Repository Hygiene

Before publishing or accepting contributions, verify that `.gitignore` excludes local databases, `.codex-knowledge/`, vaults, backups, app data, logs, screenshots, package outputs, and private evidence. See [docs/PUBLICATION_CHECKLIST.md](docs/PUBLICATION_CHECKLIST.md).

Publish only the source-only staging directory created by `npm run prepare:public`. The canonical maintainer app directory may contain private docs, local release evidence, generated memory artifacts, and installer outputs by design.
