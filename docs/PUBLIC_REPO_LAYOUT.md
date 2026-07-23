# Public Repository Layout

Zhixia should be published as a source-first repository. Binary artifacts can be attached to GitHub Releases later, after signing, CI, and release evidence policies are decided.

## Repeatable Staging

Do not upload the canonical app working directory wholesale. Prepare a reviewed source-only staging copy instead:

```powershell
npm run prepare:public
```

From the canonical app directory, the script continues to write to `C:\Users\example\Documents\Zhixia-Local-Doc-Knowledge\public-staging\zhixia-local-doc-knowledge`. From a public checkout, the copied script writes to the clearly owned nested path `<checkout>\public-staging\zhixia-local-doc-knowledge`. It never selects the source checkout itself as the staging target, and source `.git` metadata remains untouched.

The script verifies that the resolved target stays under its selected `public-staging` root, rejects a target that equals or contains the source checkout, recreates only the owned repository-named staging directory, and copies files from an explicit whitelist. It also writes `PUBLIC_STAGING_MANIFEST.md` inside the staging directory with included top-level paths, excluded private/generated categories, and the legacy docs kept out by default.

During canonical copy, text files are sanitized for private paths, private project/tool codenames, and real-looking Codex thread IDs. The staging-script copy is additionally rewritten into public-bootstrap mode with the canonical-only private codename catalog removed. A public checkout can therefore prepare another clean nested copy without carrying or reconstructing those names. After copy, the staging directory is scanned again; a known high-risk hit blocks publication.

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
docs/EXTERNAL_AUDIT_REQUIREMENTS.md
docs/PRD.md
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
- `docs/RELEASE_COMPLETION_AUDIT.md`
- private optimization monitors, project evaluations, release-transfer evidence, local validation notes, and other non-whitelisted operational runlogs

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

The staging package metadata is also source-only. Public users should expect `dev`, `build`, `test`, and `prepare:public`; installer/package commands are maintainer release gates, not part of the default public source workflow.

## Public Docs Policy

Public docs should explain product behavior, architecture, tests, Memory Runtime contracts, and contribution workflow. They should not preserve operational runlogs that contain private machine paths, real thread identifiers, local install paths, private hashes, or personal release-transfer evidence.

When a private operational note is historically important, publish a sanitized summary instead of the raw note.

Public docs should not link to maintainer-only design files unless those files are included in staging. If the canonical app directory keeps a private design doc for operational context, summarize the stable public behavior in `TECHNICAL_DESIGN.md` or `CEO_FLOW_MEMORY_RUNTIME.md` instead.
