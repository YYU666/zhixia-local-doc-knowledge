---
name: zhixia-local-docs
description: "Use this skill for compact Zhixia project memory, runtime context, precedent, continuity review, or local document generation from `.codex-knowledge` and the optional app-owned sidecar."
---

# Zhixia Local Docs

Use Zhixia as the local source of truth. The app-owned Memory Core is the primary authority; `.codex-knowledge/` is a bounded compatibility and handoff boundary.

## Default Routing

At project bootstrap, takeover, direction correction, long-thread recovery, or before dispatch after a continuity warning, call the verified app-owned route first:

```powershell
'{"operation":"verify","workspace":"<workspace>","taskGoal":"<goal>"}' | node scripts/invoke-app-memory-runtime.cjs
'{"operation":"prepare_takeover","workspace":"<workspace>","taskGoal":"<goal>","queryType":"thread_recovery","limit":12,"tokenBudget":2200,"maxTokenBudget":10000}' | node scripts/invoke-app-memory-runtime.cjs
```

Retrieval budgets are envelopes, not fixed packet sizes. Ordinary context starts near 1200 tokens and takeover near 2200; the Runtime may grow through bounded steps only when the minimum source-backed Hot/Warm/continuity packet does not fit. The hard ceiling is 10000 tokens. Use `strictTokenBudget=true` when a caller needs a fixed cap. Never grow merely to include more history, Cold bodies, raw chat, logs, images/base64, credentials, or unrelated graph paths.

Use the result as replacement context only when `memoryMode=app_owned_memory_core`, `authorityVerification=app_owned_verified`, `current=true`, `recoveryReady=true`, `takeover.shouldInject=true`, and retrieval is non-empty. Also require the versioned `takeover.hostRequirements` contract: create a distinct clean replacement task, replace rather than append context, never fork/copy the old full history, keep the frozen task non-executable and unwoken, and rebind exactly one harvest driver. Inject one `contextGenerationId` at most once per task. Otherwise freeze the old task with explicit stale/partial status.

Zhixia cannot trim or delete context already stored in a Codex task. `prepare_takeover` therefore returns `takeover.schemaVersion=zhixia.takeover_control.v2` and a deterministic `hostRequirements.requirementsSha256`; the Host/orchestrator must enforce those requirements before injection. A compact packet appended to the old task is a protocol violation even when all six memory authority fields are healthy.

For compatibility fallback, read the smallest relevant local packet before broad repository or history scans:

Canonical bundle paths are `.codex-knowledge/project-resume.md`, `.codex-knowledge/retrieval-packet.md`, `.codex-knowledge/project-index.md`, compatibility `.codex-knowledge/project-knowledge.md`, `.codex-knowledge/project-artifacts.md`, `.codex-knowledge/context.md`, `.codex-knowledge/knowledge-items.md`, `.codex-knowledge/experience-cards.md`, `.codex-knowledge/skill-candidates.md`, and `.codex-knowledge/tool-skill-inventory.md`.

1. `thread-recovery-packet.json` for the latest bounded app-generated compatibility view.
2. `project-resume.md` for a heuristic resume packet.
3. `retrieval-packet.md/json` for compact worker or review dispatch.
4. `project-index.md/json` for project structure and source pointers.
5. `project-artifacts.md/json`, `knowledge-items.md/json`, and `experience-cards.md/json` for bounded metadata and summaries.
6. `tool-skill-inventory.md/json` and `skill-candidates.md/json` only as review material.
7. Task-level `context.md` when the user exported a specific source for the current task.

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

When Electron IPC is unavailable, use the strict-JSON headless runtime for real bounded writeback and receipts:

```powershell
'{"action":"retrieve_context","workspace":"<workspace>","taskGoal":"<goal>"}' | node scripts/memory-runtime-headless.cjs
'{"action":"writeback_evidence","workspace":"<workspace>","decision":"accept","title":"<title>","summary":"<compact result>","sourceRefs":[{"kind":"canonical_doc","path":"docs/PRD.md","title":"PRD"}]}' | node scripts/memory-runtime-headless.cjs
```

Supported actions are `retrieve_context`, `retrieve_precedent`, `observe_event`, `writeback_evidence`, `continuity`, `list_trigger_receipts`, `report_worker_task_status`, and `list_worker_tasks`. See [references/headless-runtime-contract.md](references/headless-runtime-contract.md).

The packaged app-owned CLI also exposes exact-scan `observe_event` and `writeback_evidence`. These writes require `execute=true` plus the exact `projectIdentitySha256`, current `scanSha256`, and source refs present in that scan. Do not use lifecycle writes as an implicit reseed or database repair operation.

When the `zhixia-control` Codex Plugin is installed, prefer its app-owned MCP tools for visible local control: `open_app`, `scan_workspace`, `verify_project`, `retrieve_context`, `portfolio_context`, `prepare_takeover`, `stage_accepted_slice`, `reconcile_accepted_slices`, `writeback_evidence`, and `refresh_binding`. `scan_workspace`, `verify_project`, and lifecycle writes open or focus the installed Mac app by default; compact retrieval, portfolio context, takeover, and reconciliation stay headless unless `showApp=true`. Opening the UI never relaxes authority rules. Do not use desktop clicking to impersonate a successful Runtime receipt.

For a cross-project read-only task whose cwd is a neutral artifact/report directory, use `portfolio_context` with an explicit ordered `workspaces` list. It verifies each canonical root independently and retrieves only projects that are current and recovery-ready. A stale project remains an isolated stale envelope and does not block later roots. The result has no combined generation, checkpoint, receipt, or write authority. Never infer roots from raw chat or treat the neutral cwd as a Memory Core project. Keep all lifecycle writes and binding refreshes single-workspace.

For a formally accepted HEAD or postimage change, prefer app-owned `refresh_binding`: pass the previous authorized checkpoint, the new exact scan, a formal acceptance receipt identifier, accepted changed paths, lane, and exact current source refs. It carries forward the prior continuity and returns a fresh one-use generation without a complete reseed. Missing acceptance evidence, checkpoint drift, or an unbacked path must freeze the caller. Ordinary agents may self-run read-only `verify`, `scan`, and `prepare_takeover`; they should escalate only failed refreshes, conflicts, or unaccepted changes instead of relaying every successful packet through another task.

For a continuously changing canonical workspace, call `stage_accepted_slice` with the exact `acceptance-receipt.json` path and its SHA-256. The Runtime verifies the receipt, every bounded candidate postimage, project identity, and a private HMAC before storing a content-addressed non-authoritative entry. A newer accepted Slice supersedes only the paths it contains. Then call `reconcile_accepted_slices`: every current checkpoint delta must match the latest staged path head. Missing evidence, drift, deletion, excluded bodies, or a truncated worktree keeps reconciliation `not_ready`. Even a ready reconciliation grants no checkpoint or write authority; the ordinary app-owned review must still explicitly accept its exact scan and path set before `refresh_binding`.

Trusted local agents may use the lazy stdio MCP adapter described in the same reference. In MiniMax Code, prefer `mcp_zhixia_memory_retrieve_context` / `retrieve_precedent` before project work, report boundary status with `mcp_zhixia_memory_report_worker_task_status`, and use `mcp_zhixia_memory_writeback_evidence` after acceptance. Do not emit heartbeat traffic. MCP output follows the identical project-identity, source-backed writeback, privacy, continuity, and authority boundaries.

OpenClaw legacy memory is a separate cold audit source. It is never searched by ordinary project retrieval:

```powershell
node scripts/read-openclaw-memory-archive.cjs --query "<audit topic>" --limit 6 --token-budget 1200 --json
```

Only a maintainer or explicit migration task runs `--build`; ordinary Codex audit tasks query the existing sanitized SQLite index. Before dispatching an OpenClaw audit task, Codex/CEO Flow may inject bounded `items[].excerpt` plus `providerSafeSourceRefs`. Never inject local backup paths, skipped sensitive bodies, the whole archive, or the index database. OpenClaw does not install this Skill and does not query the vault directly.

Read [references/memory-core-lifecycle.md](references/memory-core-lifecycle.md) for exact CLI flags, JSON schemas, authority semantics, pagination, cursor behavior, diagnostics, pressure, takeover, and writeback contracts.

`--recover-thread` returns a compact ThreadRecoveryPacket-shaped result. Rows with `freshness=review` are non-authoritative until verified by canonical sources or the app-owned authority runtime.

## Authority And Scope

- Verified app-owned `verify/retrieve` is the only packaged Codex route that may claim `current=true` and `recoveryReady=true`. It binds exact project identity, baseline HEAD, canonical source hashes, complete continuity pagination, and a signed authority receipt.
- The packaged helper has no constrained app-owned receipt verifier. Persisted MemoryFact and Memory Core statuses are therefore advisory only: output uses `authorityVerification="unavailable"`, `authoritative=false`, review freshness/status, and human confirmation where applicable.
- Unverified accepted or curated rows cannot fill continuity slots and cannot make `recoveryReady=true`.
- Continuity cursors carry an accumulated manifest-prefix digest. A forged offset-only or altered cursor is invalid.
- Because each CLI call is a fresh process and no app-authenticated full-manifest proof is available, `pagination.pageComplete=true` only means the current advisory manifest page reached its end. It does not imply recovery readiness.
- ProjectBrain resolution canonicalizes real filesystem aliases before comparison, including legacy macOS case spellings and `/var` aliases. A foreign project ID still fails closed.
- File source references must stay inside the requested workspace. External file references may survive only as pathless redacted metadata or be omitted.
- Non-file source URIs may be retained when they pass bounded secret, raw-session, and base64 screening.

## Sidecar Safety

For runtime context and precedent, the helper may perform bounded logical read-only access to the app-owned `memory-runtime/memory-runtime-index.sqlite` sidecar.

- It resolves user data from `ZHIXIA_USER_DATA` first, then the platform app-data location.
- It opens SQLite read-only and enables `query_only`.
- It performs no SQL writes, schema migration, app launch, directory scan, or raw-session read.
- Main database and WAL content remain unchanged; SQLite may update `-shm` coordination metadata while reading a live WAL database.
- Missing SQLite support, schema mismatch, lock failure, or missing Memory Core returns `memoryMode="fallback_stale"`, `current=false`, and `recoveryReady=false`; it never impersonates normal layered memory.
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
- [references/headless-runtime-contract.md](references/headless-runtime-contract.md): strict-JSON lifecycle, project identity, writeback, and receipt contract.
- [references/app-owned-memory-runtime.md](references/app-owned-memory-runtime.md): verified bootstrap/recovery route and compatibility refresh contract.
