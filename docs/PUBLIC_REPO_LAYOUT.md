# Public Repository Layout

Zhixia should be published as a source-first repository. Binary artifacts can be attached to GitHub Releases later, after signing, CI, and release evidence policies are decided.

## Repeatable Staging

Do not upload the canonical app working directory wholesale. Prepare a reviewed source-only staging copy instead:

```powershell
npm run prepare:public
```

The script writes only to `public-staging/zhixia-local-doc-knowledge`, verifies that the resolved target stays under `public-staging`, recreates only that owned staging directory, and copies files from an explicit whitelist. It also writes `PUBLIC_STAGING_MANIFEST.md` inside the staging directory with included top-level paths, excluded private/generated categories, and the legacy docs kept out by default.

## Include

```text
README.md
LICENSE
SECURITY.md
CONTRIBUTING.md
package.json
package-lock.json
index.html
vite.config.ts
tsconfig*.json
assets/
codex-skills/zhixia-local-docs/
docs/CEO_FLOW_MEMORY_RUNTIME.md
docs/PUBLICATION_CHECKLIST.md
docs/PUBLIC_REPO_LAYOUT.md
docs/TECHNICAL_DESIGN.md
docs/TEST_PLAN.md
docs/RELEASE_NOTES.md (public-safe staging replacement)
electron/
samples/
scripts/prepare-public-repo.cjs
src/
tests/
```

Maintainers may include additional public-safe docs after reviewing them for private paths, real thread IDs, user-specific evidence, and release-transfer logs.

The following legacy/private operational docs are excluded from staging by default and should not be uploaded unless replaced with sanitized public summaries:

- `docs/zhixia-complete-product-goal.md`
- `docs/ARK_OFFICE_RUNLOG.md`
- `docs/RELEASE_COMPLETION_AUDIT.md`
- Other non-whitelisted operational runlogs, release-transfer evidence, and local validation notes

## Exclude

```text
.codex-knowledge/
node_modules/
dist/
release/
*.db
*.sqlite
*.sqlite3
*.log
logs/
userData/
vault/
vaults/
backups/
evidence/
private-evidence/
screenshots/
tmp/
temp/
coverage/
```

Also exclude raw Codex sessions, installed global skills, FlowSkill private stores, generated package outputs, blockmaps, unpacked apps, and app-owned runtime databases.

The source-only staging copy intentionally excludes installer helper scripts and installer include files. They can be restored later in a separate binary-release workflow after signing, installer, and public distribution policies are reviewed.

## Public Docs Policy

Public docs should explain product behavior, architecture, tests, Memory Runtime contracts, and contribution workflow. They should not preserve operational runlogs that contain private machine paths, real thread identifiers, local install paths, private hashes, or personal release-transfer evidence.

When a private operational note is historically important, publish a sanitized summary instead of the raw note.
