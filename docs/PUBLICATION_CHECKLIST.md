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
- `docs/EXTERNAL_AUDIT_REQUIREMENTS.md`
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

Path expectations depend on the source checkout:

- Canonical app: `C:\Users\example\Documents\Zhixia-Local-Doc-Knowledge\public-staging\zhixia-local-doc-knowledge`
- Public checkout: `<checkout>\public-staging\zhixia-local-doc-knowledge`

The public-checkout output must remain nested below the checkout, must not equal the checkout, and must not modify or relocate the checkout's `.git`. The copied staging script must be in public-bootstrap mode and must not contain or reconstruct the canonical-only private codename catalog.

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
- AI Provider API keys use Electron `safeStorage` plus an integrity-checked `enc:v2` payload before SQLite persistence; legacy plaintext/`enc:v1` migration, present-but-unavailable clearing, Provider-error redaction, unavailable-backend refusal, and ciphertext tamper failure are covered. Public Windows CI must also run `npm run test:electron-security` against an isolated temporary SQLite profile.
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
node tests\sensitive-settings-policy.test.cjs
npm test
npm run build
node scripts\prepare-public-repo.cjs
```

The source-only staging repository must contain `.github/workflows/ci.yml`. The workflow runs `npm ci`, the default test suite, the production build, a high-severity production-dependency audit, and a critical-severity full dependency audit on Windows for pushes to `main` and pull requests. Development-only packaging advisories must remain documented until a compatible upstream fix exists; do not hide them with a breaking forced downgrade or unverified transitive override.

Then run the public staging test from the staging directory:

```powershell
cd ..\public-staging\zhixia-local-doc-knowledge
npm test
```

To verify public self-bootstrap, run `npm run prepare:public` from that public staging checkout and inspect its nested `public-staging\zhixia-local-doc-knowledge` output. Confirm the source checkout and its `.git` are unchanged.

Optional dependency visibility:

```powershell
npm ls --depth=0
```

Do not run packaging or installers as part of publication hygiene unless the release task explicitly asks for binary artifacts.

## macOS Local Validation Boundary

The checked-in `electron-builder.mac.json` builds only an Apple Silicon (`arm64`) `dir` target with `identity: null`. This is an unsigned local validation bundle, not a public macOS release. It provides no Developer ID signature, notarization, stapled ticket, installer, update channel, or distribution assurance.

For a local packaging audit, run `npm run dist:mac`, then verify the generated or installed `app.asar` against the embedded source postimage manifest:

```bash
npm run verify:app-source -- "release-mac/mac-arm64/知匣.app/Contents/Resources/app.asar"
```

The source-equivalence proof uses one explicit inclusion policy: recursively include every regular file under `electron/`, `dist/`, `assets/`, and `codex-skills/zhixia-local-docs/`; reject symlinks and special files; exclude only the self-referential `dist/zhixia-source-postimage-manifest.json`. Verification independently enumerates the eligible source set, manifest entries, and matching `app.asar` paths, then checks every eligible file's byte length and SHA-256. Git ignore and tracked/untracked status do not remove an eligible file from this policy.

This per-file source-equivalence proof deliberately does not cover the packaged dependency tree under `node_modules/`, Electron framework/runtime binaries, native dependency rebuild outputs, package metadata beyond the checked identity fields, or other electron-builder-generated bundle resources. Those inputs require separate lockfile/SBOM, dependency audit, reproducible-build, and platform-runtime evidence before public release.

A public macOS release remains blocked until a separately reviewed signing, notarization, installer/update, and clean-source release workflow is implemented. Do not describe an `arm64` `dir` bundle with `identity: null` as signed, notarized, or publicly releasable.

### Full local artifact evidence

The selected-source receipt above remains a deliberately narrow proof. It does not become a complete package proof merely because the same `app.asar` passes it. For an already-built local candidate, create and immediately re-verify the separate full-artifact evidence:

```bash
npm run verify:release-candidate
```

This command performs three distinct steps: the historical selected-source verification, deterministic generation of `release-evidence/zhixia-full-artifact-manifest.json`, and independent full-artifact verification. It does not package, install, access the network, sign, or notarize. Run it only after the candidate app already exists. The evidence file is deliberately outside the `.app` so the manifest never hashes itself.

The full-artifact tier independently binds:

- the complete `app.asar` archive file set, per-file bytes, symlinks, unpacked flags, and archive SHA-256;
- every regular file and contained symlink in the generated `.app`, including Electron runtime/framework resources, `app.asar.unpacked`, native modules, generated plist/icon/locales, and helper applications;
- `package.json`, `package-lock.json`, the Electron Builder config, declared icon/entitlement/provisioning/build-resource inputs, and any local `build/` or `build-resources/` tree;
- the lockfile-derived production dependency closure with package version, license and integrity when locally available, locally installed package metadata hashes, and discovered `.node` binaries;
- Node/npm/Electron/Electron Builder/ASAR versions and the candidate target/config identity.
- the reviewed CI workflow, artifact verifier/generator and fault-test postimages, plus the ordered release gate plan. The plan deliberately says `executionState=not_recorded_by_artifact_manifest`; its presence is not a fabricated test PASS. Actual command receipts remain release-authority evidence.

The verifier fails closed on source-input, SBOM, complete archive, unpacked, or complete bundle extras, missing paths, metadata changes, and byte-hash mismatches. Missing lockfile license or integrity is recorded as `unavailable`; it is never synthesized. No registry lookup is made. The production dependency SBOM does not claim that registry contents were freshly audited, that optional packages absent for another platform were exercised, or that transitive license obligations were legally approved.

There are three non-interchangeable receipt tiers:

1. `selected-source`: the existing per-file source verifier only. The full-artifact manifest records whether its embedded input exists but cannot mark it independently verified.
2. `full-artifact`: one unsigned local candidate plus its locally available input, dependency, native-module, unpacked, generated-resource, runtime, and toolchain evidence.
3. `signed-distribution`: a separately authorized Developer ID, notarization, stapling, installer/update, and distribution receipt. The local verifier always rejects a request for this tier when that evidence is absent.

The manifest binds one candidate; it does not claim bit-for-bit reproducibility across machines. The current `arm64` `dir` target with `identity: null` remains unsigned, ad hoc/local-only, not notarized, not installed evidence, and not a public release. CI runs the hermetic fault tests for this layer, while a release owner must run the candidate command against the exact packaged postimage. Signing, notarization, network audit, installation, and public release remain outside this local evidence task.

### Dirty candidate identity without committing

When the release card forbids a commit, bind the exact local postimage before handing it to QA:

```bash
npm run release:candidate-manifest
node scripts/candidate-evidence.cjs verify --manifest release-evidence/candidates/candidate-<candidateId>.json
```

The generated filename is the SHA-256 content address of its canonical payload. The payload binds current branch, HEAD and HEAD tree; exact NUL-delimited `git status --porcelain=v1 -z` SHA-256; every dirty path, two-column status, rename/copy origin, and current regular-file or symlink bytes; explicit missing entries for deleted paths; package-lock bytes; local toolchain; complete test and benchmark source manifests; artifact evidence implementations and locally present artifact manifests; and the exact package commands. Ignored files are excluded unless named as explicit evidence outputs. The receipt is written under ignored `release-evidence/candidates/`, so writing it does not mutate the candidate it describes.

Verification independently rebuilds the payload. Any HEAD, porcelain, dirty path, status, file bytes, symlink target, lockfile, toolchain, command, test, benchmark, artifact implementation, or explicit artifact-manifest drift fails closed. A command entry always has `executionState=not_recorded`; it is not evidence that a test, benchmark, build, or artifact gate ran.

This is a `local_dirty_postimage` candidate receipt only. It deliberately records `commitCreated=false`, `tagCreated=false`, `signingPerformed=false`, `notarizationPerformed=false`, and `publicReleaseEligible=false`. Creating a commit or tag, signing/notarizing, installing, uploading, or calling the candidate a public release requires separate explicit authority and new evidence.

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
