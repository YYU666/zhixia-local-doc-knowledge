---
name: zhixia-local-docs
description: "Use this skill for compact Zhixia project memory, runtime context, precedent, continuity review, or local document generation from `.codex-knowledge` and the optional app-owned sidecar."
---

# Zhixia Local Docs

Use Zhixia as the local source of truth. Treat `.codex-knowledge/` as the handoff boundary between the desktop app and Codex.

## Default Routing

Read the smallest relevant local packet before broad repository or history scans:

Canonical bundle paths are `.codex-knowledge/project-resume.md`, `.codex-knowledge/retrieval-packet.md`, `.codex-knowledge/project-index.md`, compatibility `.codex-knowledge/project-knowledge.md`, `.codex-knowledge/project-artifacts.md`, `.codex-knowledge/context.md`, `.codex-knowledge/knowledge-items.md`, `.codex-knowledge/experience-cards.md`, `.codex-knowledge/skill-candidates.md`, and `.codex-knowledge/tool-skill-inventory.md`.

1. `project-resume.md` for a heuristic resume packet.
2. `retrieval-packet.md/json` for compact worker or review dispatch.
3. `project-index.md/json` for project structure and source pointers.
4. `project-artifacts.md/json`, `knowledge-items.md/json`, and `experience-cards.md/json` for bounded metadata and summaries.
5. `tool-skill-inventory.md/json` and `skill-candidates.md/json` only as review material.
6. Task-level `context.md` when the user exported a specific source for the current task.

Do not load old chats, raw sessions, screenshots, base64, credentials, logs, or giant Markdown by default. Use source references to inspect a narrow canonical source only when compact context is insufficient.

## Retrieval Helper

Run the bundled helper from this skill directory:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --query "bug import" --limit 5 --json
```

Parent-directory knowledge is opt-in with `--allow-parent-knowledge`. Legacy `--query`, `--limit`, `--include-kinds`, and `--json` calls remain the compatibility contract; new integrations should prefer `items[]` while tolerating `results[]`.

Common lifecycle routes:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --runtime-context --task-goal "<goal>" --json
node scripts/read-project-knowledge.cjs <workspace-path> --precedent "<risk or task type>" --json
node scripts/read-project-knowledge.cjs <workspace-path> --continuity-status --project-id "<project id>" --json
node scripts/read-project-knowledge.cjs <workspace-path> --memory-review-queue --project-id "<project id>" --json
node scripts/read-project-knowledge.cjs <workspace-path> --memory-diagnostics --project-id "<project id>" --json
node scripts/read-project-knowledge.cjs <workspace-path> --recover-thread --thread-id "<thread id>" --json
node scripts/read-project-knowledge.cjs <workspace-path> --writeback-dry-run --evidence-json .codex-knowledge/evidence-input.json --json
```

OpenClaw legacy memory is a separate cold audit source. It is never searched by ordinary project retrieval:

```powershell
node scripts/read-openclaw-memory-archive.cjs --query "<audit topic>" --limit 6 --token-budget 1200 --json
```

Only a maintainer or explicit migration task runs `--build`; ordinary Codex audit tasks query the existing sanitized SQLite index. Before dispatching an OpenClaw audit task, Codex/CEO Flow may inject bounded `items[].excerpt` plus `providerSafeSourceRefs`. Never inject local backup paths, skipped sensitive bodies, the whole archive, or the index database. OpenClaw does not install this Skill and does not query the vault directly.

Read [references/memory-core-lifecycle.md](references/memory-core-lifecycle.md) for exact CLI flags, JSON schemas, authority semantics, pagination, cursor behavior, diagnostics, pressure, takeover, and writeback contracts.

`--recover-thread` returns a compact ThreadRecoveryPacket-shaped result. Rows with `freshness=review` are non-authoritative until verified by canonical sources or the app-owned authority runtime.

## Authority And Scope

- The packaged helper has no constrained app-owned receipt verifier. Persisted MemoryFact and Memory Core statuses are therefore advisory only: output uses `authorityVerification="unavailable"`, `authoritative=false`, review freshness/status, and human confirmation where applicable.
- Unverified accepted or curated rows cannot fill continuity slots and cannot make `recoveryReady=true`.
- Continuity cursors carry an accumulated manifest-prefix digest. A forged offset-only or altered cursor is invalid.
- Because each CLI call is a fresh process and no app-authenticated full-manifest proof is available, `pagination.pageComplete=true` only means the current advisory manifest page reached its end. It does not imply recovery readiness.
- ProjectBrain resolution requires the persisted canonical project path to match the requested workspace exactly. A foreign project ID fails closed.
- File source references must stay inside the requested workspace. External file references may survive only as pathless redacted metadata or be omitted.
- Non-file source URIs may be retained when they pass bounded secret, raw-session, and base64 screening.

## Sidecar Safety

For runtime context and precedent, the helper may perform bounded logical read-only access to the app-owned `memory-runtime/memory-runtime-index.sqlite` sidecar.

- It resolves user data from `ZHIXIA_USER_DATA` first, then the platform app-data location.
- It opens SQLite read-only and enables `query_only`.
- It performs no SQL writes, schema migration, app launch, directory scan, or raw-session read.
- Main database and WAL content remain unchanged; SQLite may update `-shm` coordination metadata while reading a live WAL database.
- Missing SQLite support, schema mismatch, lock failure, or missing sidecar returns compact warnings and falls back to `.codex-knowledge` where the mode permits.
- Authority summaries never expose signing keys, trust contexts, receipt proofs, or raw receipts.

## Layered Recall

- `hot`: current goal, active module, recent decisions, blockers, and next action.
- `warm`: project summaries, product direction, architecture, accepted-progress candidates, and module history.
- `skill`: experience cards, tool records, Skill candidates, and reusable workflows.
- `cold`: raw, Vault, archive, and old-thread evidence pointers only. Cold bodies are not read by default.

OpenClaw cold archive recall requires the explicit `openclaw_audit` gate. It returns sanitized excerpts from a prebuilt index; raw session/chat backups and secret/config paths remain pointer-only.

Use `--query-type review_gate`, `handoff`, `thread_recovery`, or other explicit lifecycle query types when the task requires them. Ordinary product queries should not let archive or maintenance records outrank current project state.

## No-Go Rules

- Helper output is not permission to archive, compact, delete, move, restore, install, execute, publish, create threads, or mutate FlowSkill.
- Sidecar schema detection is not permission to migrate or repair the database.
- `skill-candidates.md` is review-only draft material; FlowSkill writeback previews remain candidates until a later user-approved task.
- `tool-skill-inventory.md` is read-only candidate material and does not authorize install, update, or execution.
- Do not modify source documents from the user's knowledge base unless explicitly requested.
- Evidence output paths must stay inside the requested workspace.
- Do not enable OpenClaw native memory or install this Skill into OpenClaw. CEO Flow owns retrieval and injects only the bounded provider-safe packet.

## Generated Documents

Write generated project documents to stable paths Zhixia scans, such as:

- `docs/PRD.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/TEST_PLAN.md`
- `docs/RELEASE_NOTES.md`
- `docs/PROJECT_EVALUATION.md`
- `README.md`

Include a short `Sources` section when using Zhixia context. Tell the user to rescan the workspace in Zhixia after changing generated documents.

## Guardian Evidence

Treat Codex History Guardian as a historical evidence provider, not the owner of project memory. Use it for old-thread discovery, paused task lookup, restore-index evidence, health summaries, context pressure, and restore dry-runs. Prefer Zhixia compact current-project context first.

Do not run Guardian cleanup or session-body optimization automatically. Explicit old-thread slimming must preserve a byte-for-byte backup, verify SHA-256, replace only after verification, and return a restore receipt.

## References

- [references/memory-core-lifecycle.md](references/memory-core-lifecycle.md): exact helper lifecycle contracts and JSON shapes.
- [references/context-bundle.md](references/context-bundle.md): context bundle fields and citation format.
- [references/openclaw-cold-archive.md](references/openclaw-cold-archive.md): Codex audit retrieval and OpenClaw packet-injection boundary.
