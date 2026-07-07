# Publication Checklist

Use this checklist before publishing Zhixia to a public GitHub repository.

## Required Public Files

- `README.md`
- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `.gitignore`
- `package.json` with `license`
- `docs/CEO_FLOW_MEMORY_RUNTIME.md`
- `docs/PUBLIC_REPO_LAYOUT.md`
- `docs/PUBLICATION_CHECKLIST.md`
- Public-safe design, test, and release notes selected by maintainers

## Required Staging Step

Do not upload the canonical app working directory directly. First create a curated source-only staging directory:

```powershell
npm run prepare:public
```

Review `public-staging/zhixia-local-doc-knowledge/PUBLIC_STAGING_MANIFEST.md` before creating a GitHub repository or uploading files. The staging script is whitelist-based and should be the source of truth for which app-root files are copied.

The staging script also sanitizes text content and fails the run when the staging copy contains high-risk private residue such as real Windows user paths, private project/tool codenames, or real-looking Codex thread IDs.

## Must Not Publish

- `.codex-knowledge/`
- Local SQLite databases or exported stores
- User app data
- Backups
- Vaults
- Private evidence receipts
- Real Codex session JSONL or full chat transcripts
- Long logs
- Screenshots containing private data
- `.env` files or credentials
- Release installers, portable binaries, blockmaps, unpacked packaged apps
- Node dependency folders or cache folders
- Installed global skill copies

## Docs Curation

Before GitHub upload, scan docs for:

- Machine-specific absolute paths.
- Real thread IDs or private run identifiers.
- Platform local application data paths or local install paths.
- Vault/session/archive evidence tied to a real user.
- Release-transfer evidence and private QA runlogs.
- Source hashes that identify private documents.
- Private project or tool codenames.
- Escaped Windows paths such as `C:\\Users\\...` in source string literals.

If a doc is useful but private, keep it out of the public docs set or replace it with a public-safe summary. Do not delete maintainer-only history unless the repository owner explicitly asks for cleanup; exclude it from publication instead.

The default staging workflow excludes private legacy docs, including:

- `docs/zhixia-complete-product-goal.md`
- `docs/RELEASE_COMPLETION_AUDIT.md`
- private optimization monitors, project evaluations, release-transfer notes, and local validation logs not explicitly whitelisted by `scripts/prepare-public-repo.cjs`

Add any future operational runlog to the private/excluded set unless it has been sanitized.

## Security Hardening Review

Verify before publication:

- `settings:update` uses the settings whitelist and type normalization policy.
- AI Provider Base URL rejects plaintext HTTP and untrusted hosts before document text or real API keys can be sent.
- Project memory writes and tool inventory scans require registered workspace paths.
- Electron has explicit sandbox, CSP, denied window opens, guarded navigation, and denied permission requests.
- Guardian clean/optimize/compact/archive-queue IPCs require a user confirmation flag.
- Guardian default script path is app-owned user data or an explicit developer environment override, not a maintainer private directory.

## Memory Runtime Safety Review

Verify that public docs state:

- Retrieval is metadata-first and compact by default.
- Raw session bodies are not read by default.
- Giant Markdown, screenshots/base64, long logs, and secrets are excluded from default packets.
- Evidence writeback stores compact app-owned JSON.
- Missing sourceRefs means advisory/candidate-only.
- Promotion fails closed for raw sessions, secrets, public export, install, execute, archive, compact, delete, move, and restore.
- FlowSkill output is private review metadata until a later explicit user action.

## Verification

Run:

```powershell
node tests\smoke-test.cjs
node tests\security-policy.test.cjs
npm test
npm run build
node scripts\prepare-public-repo.cjs
```

Then run the public staging test from the staging directory:

```powershell
cd ..\public-staging\zhixia-local-doc-knowledge
npm test
```

Optional dependency visibility:

```powershell
npm ls --depth=0
```

Do not run packaging or installers as part of publication hygiene unless the release task explicitly asks for binary artifacts.

## Neutral Re-Audit Scope

Ask a reviewer to inspect:

- `.gitignore` coverage.
- `scripts/prepare-public-repo.cjs` whitelist and path containment checks.
- `public-staging/zhixia-local-doc-knowledge/PUBLIC_STAGING_MANIFEST.md`.
- Public README and CEO Flow contract docs.
- Package license and metadata.
- Private path/thread-id leakage in included docs.
- Whether generated memory/runtime artifacts are excluded.
- Whether tests still pass from a clean source checkout.
