# Zhixia Codex Skill Release Lifecycle

## Scope

`codex-skills/zhixia-local-docs/release-manifest.json` is the single deterministic release-generation source for the repository Skill tree. It includes the byte length and SHA-256 of every regular file below the Skill root except the manifest itself, and requires `SKILL.md` plus `agents/openai.yaml`. Entries are path-sorted; timestamps, absolute paths, Git state, and host identity are excluded. Symlinks and special files fail closed.

The manifest travels inside the bundled Skill tree and any installed copy. A tree is current only when its manifest is canonical, its independently enumerated file set has no extra or missing paths, every file matches its declared byte length and SHA-256, and the manifest bytes exactly match the repository authority manifest.

## Commands

Generate the repository manifest after an accepted Skill source change:

```bash
node scripts/skill-release-manifest.cjs generate \
  --repo codex-skills/zhixia-local-docs
```

Run a read-only repository check:

```bash
node scripts/verify-skill-release.cjs \
  --repo codex-skills/zhixia-local-docs
```

Compare explicitly supplied repository, bundled, and installed directories:

```bash
node scripts/verify-skill-release.cjs \
  --repo /absolute/source/codex-skills/zhixia-local-docs \
  --bundled /absolute/bundled/codex-skills/zhixia-local-docs \
  --installed /absolute/CODEX_HOME/skills/zhixia-local-docs \
  --rollback /absolute/owner-approved-backup/zhixia-local-docs
```

Omitted roots are `not_checked`; the verifier never discovers an installed or backup path from environment variables. Explicit roots are canonicalized (including macOS `/var` to `/private/var`), while symlinks or special files inside a Skill tree fail closed. A supplied missing, extra, drifted, or non-canonical tree returns a non-zero exit. The JSON receipt contains a non-executable upgrade and rollback procedure. The verifier performs no copy, rename, installation, backup, deletion, or memory operation.

## Upgrade And Rollback Boundary

An upgrade is eligible only after repository and bundled trees match the same generation. The later installer integration must copy to a sibling temporary directory, verify it, preserve an existing target with a non-overwriting generation-addressed backup, atomically publish the verified temporary tree, and reverify the installed tree. Rollback likewise requires an explicitly supplied, internally valid release tree and must preserve the displaced current tree.

The pure verifier lives at `electron/skillReleaseManifest.cjs`, so it is included by the existing `electron/**/*` package rule. The existing `getSkillStatus` integration still needs a small follow-up: import this module, replace the four-file fingerprint with its full-tree read-only receipt, and expose `releaseGeneration`, `entryCount`, and per-tree parity. That hook is intentionally not made here because `electron/main.cjs`, preload, renderer types, and UI are active in other remediation lanes.

This proof covers the Skill payload only. It does not prove Electron application source equivalence, dependencies, native modules, signing, notarization, or public release readiness.
