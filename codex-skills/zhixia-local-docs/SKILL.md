---
name: zhixia-local-docs
description: "Use this skill when Codex needs compact Zhixia Local Doc Knowledge project memory, context bundles, or generated documents: reading `.codex-knowledge/project-resume.md`, `.codex-knowledge/retrieval-packet.md`, structured project indexes, and task context while preserving source citations and avoiding giant monolithic Markdown packets."
---

# Zhixia Local Docs

Use Zhixia as the local source of truth. Treat `.codex-knowledge/` as the handoff boundary between the desktop app and Codex.

## Runtime Context Governance

Zhixia is the compact context provider for Codex runtime work. Its job is to keep active Codex threads light by supplying short, source-backed project knowledge, not by copying old chat history into every task.

Default behavior:

- Prefer `project-resume.md`, `retrieval-packet.md/json`, `project-index.md/json`, `project-artifacts.md/json`, `knowledge-items.md/json`, `experience-cards.md/json`, `tool-skill-inventory.md/json`, and task-level `context.md` before broad repo scans, old chat transcripts, raw sessions, screenshots, or logs.
- Return only the smallest relevant excerpts for the current task, with `sourceRefs`, `freshness`, `status`, `whyMatched`, and `tokenEstimate` when available.
- For new worker threads, provide a compact task packet: current goal, relevant excerpts, source paths, constraints, and memory writeback target.
- For review threads, start from the task card, diff, tests, relevant docs, and compact Zhixia excerpts. Do not start from the implementation thread's long conversation history.
- For handoff, write a concise `Handoff` or stable Markdown note that Zhixia can scan later instead of preserving the whole chat as memory.

Do not treat Zhixia as:

- a Windows scheduled maintenance system;
- an automatic Codex log cleaner;
- an owner of raw Codex session files;
- a reason to read or transmit full old conversations by default.

## Workflow

1. Locate the workspace root and check for `.codex-knowledge/project-resume.md`, `.codex-knowledge/retrieval-packet.md`, `.codex-knowledge/project-index.md`, `.codex-knowledge/project-chunks.jsonl`, `.codex-knowledge/project-knowledge.md`, `.codex-knowledge/project-artifacts.md`, `.codex-knowledge/project-sources.json`, `.codex-knowledge/context.md`, `.codex-knowledge/sources.json`, `.codex-knowledge/knowledge-items.md`, `.codex-knowledge/experience-cards.md`, `.codex-knowledge/skill-candidates.md`, and `.codex-knowledge/tool-skill-inventory.md`.
2. Read `project-resume.md` first when resuming a paused project or dispatching a new Codex thread. It is a heuristic Resume Packet and should be checked against sources before treating it as authoritative.
3. Read `retrieval-packet.md` next. It is the default compact packet for CEO Flow / worker dispatch and should stay short.
4. Read `project-index.md/json` when you need the structured project directory, counts, source pointers, and artifact group map.
5. Read `project-knowledge.md` only as a compatibility short index. It must not be treated as a giant full-history source.
6. Read `context.md` when the user exported a specific source document for the current task.
7. Read `project-artifacts.md` when you need the current/needs_review/superseded document map, producer role, thread id hints, and source paths. It is metadata-only review material.
8. Read `knowledge-items.md` for compact document knowledge organized by category. These items are summaries plus source pointers, not full source documents.
9. Read `experience-cards.md` for compact prior fixes, AutoFlow completions, bug-memory lessons, and agent-family memory. These cards are summaries plus source pointers, not full logs.
10. Read `skill-candidates.md` only as draft candidate material. Zhixia never installs generated candidates automatically; user approval is required before any Skill installation.
11. Read `tool-skill-inventory.md` when choosing reusable local Codex Skills, scripts, or workflows. Treat it as read-only candidate material; it never authorizes automatic execution.
12. Read `project-sources.json` or `sources.json` when the user needs provenance, auditability, or source references.
13. Generate documents into stable workspace paths that Zhixia scans:
   - `docs/PRD.md`
   - `docs/TECHNICAL_DESIGN.md`
   - `docs/TEST_PLAN.md`
   - `docs/RELEASE_NOTES.md`
   - `docs/PROJECT_EVALUATION.md`
   - `README.md`
14. Include a short `Sources` section when a document relies on Zhixia context or project knowledge.
15. Avoid modifying source documents from the user's knowledge base unless the user explicitly asks.
16. Tell the user to scan the Codex workspace in Zhixia after generating or changing documents so the project knowledge base refreshes.

## Retrieval Helper

For deterministic retrieval, run the bundled helper from this skill directory:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path>
```

It reads the requested workspace's `.codex-knowledge/`, including `project-resume.md`, `retrieval-packet.md`, `project-index.md`, compatibility `project-knowledge.md`, `project-artifacts.md`, `context.md`, `knowledge-items.md`, `experience-cards.md`, `skill-candidates.md`, and `tool-skill-inventory.md`, then prints compact matching excerpts. By default it does not climb into parent directories, because that can accidentally pull unrelated knowledge into a worker packet. Use `--allow-parent-knowledge` only when the parent workspace is intentionally the knowledge root. Use flags to keep token use low:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --query "bug import" --limit 5
node scripts/read-project-knowledge.cjs <workspace-path> --query "current PRD" --include-kinds artifacts --json
node scripts/read-project-knowledge.cjs <workspace-path> --query "skill candidate" --limit 5 --json
node scripts/read-project-knowledge.cjs <workspace-path> --query "handoff blocker" --query-type handoff --token-budget 900 --limit 4 --json
node scripts/read-project-knowledge.cjs <workspace-path> --query "parent memory" --allow-parent-knowledge --json
```

Prefer `--json` for structured low-token calls. The helper now returns a file-based retrieval contract with top-level metadata plus `items[]` fields such as `sourceRefs`, `freshness`, `status`, `tokenEstimate`, `whyMatched`, and `requiresHumanConfirmation`.

## Memory Runtime Lifecycle

Use the helper as the packaged Codex-side Memory Runtime adapter when the Electron IPC is not directly callable from the current lane.

Bootstrap or dispatch context:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --runtime-context --task-goal "<task goal>" --query-type task_dispatch --token-budget 1200 --limit 6 --json
```

Review context:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --runtime-context --task-goal "<review goal>" --query-type review_gate --token-budget 900 --limit 4 --json
```

Precedent retrieval before implementation:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --precedent "<task type or risk>" --token-budget 900 --limit 5 --json
```

Evidence writeback dry-run after accept/revise/block:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --writeback-dry-run --evidence-json .codex-knowledge/evidence-input.json --json
```

Old-thread recovery packet for a broken, archived, or slimmed CEO/worker thread:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --recover-thread --thread-id "<thread id>" --thread-title "<thread title>" --query "<project or task keywords>" --json
```

The lifecycle JSON modes are compact and source-backed:

- `--runtime-context` returns a layered RuntimeContextPacket-shaped object with `request`, `project`, `items`, `sourceRefs`, `memoryMode`, `memoryLayers`, `recallPlan`, `warnings`, `tokenEstimate`, and `generatedAt`.
- `--precedent` returns a RuntimePrecedentPacket-shaped object over bounded metadata kinds: knowledge, experience, project artifacts, tool inventory, and skill candidates.
- `--writeback-dry-run` returns an EvidenceWritebackPacket-like preview only. It may write a preview file with `--evidence-out <workspace-relative-path>`, but the output must stay inside the requested workspace.
- `--recover-thread` returns a ThreadRecoveryPacket-shaped object for CEO Flow bootstrap. The helper version is workspace-metadata-only: it recommends project docs and compact `.codex-knowledge` sourceRefs, but does not walk Thread History Vault or read raw/vault session bodies.

Layered recall contract:

- `hot` is short-term working memory: current goal, active module, latest decisions, blockers, and next action.
- `warm` is long-term project summary memory: PRD, architecture, accepted progress, design origin, module history, and source-backed project summaries.
- `skill` is procedural memory: experience cards, tool records, Skill candidates, and reusable workflows.
- `cold` is raw/vault/thread-history evidence pointers only. Cold bodies are not read by default; use `--recover-thread`, `--query-type thread_recovery`, `--query-type archive_candidate`, or an explicit recovery query before escalating to cold sourceRefs.
- For ordinary product/project queries, the helper promotes product state and accepted progress and demotes thread maintenance / archive / Guardian optimization records so they do not outrank the project itself.

Lifecycle no-go rules:

- Do not read raw session JSONL, full chat transcripts, screenshots/base64, credentials, or giant Markdown by default.
- Do not use helper output as permission to archive, compact, delete, move, restore, install, execute, publish, create threads, or mutate FlowSkill.
- FlowSkill material from writeback dry-run is candidate metadata only. Capture/promote/export/install require a later explicit user-approved task.
- Keep existing `--query`, `--limit`, and `--json` calls for compatibility when a full RuntimeContextPacket is not needed.

Guidance for agents:

- Default `queryType` is `task_dispatch`; set `--query-type` for review, handoff, or memory writeback flows.
- Default `tokenBudget` is about `1200`; lower it when you only need the top 2-4 local matches.
- Parent-directory knowledge is opt-in. If the current workspace lacks `.codex-knowledge/`, JSON output should return zero items plus a warning instead of using unrelated parent memory.
- Treat `freshness=review` or `freshness=stale` as non-authoritative until a human or canonical source confirms it.
- Treat `project-artifacts.md` as metadata-only review material; use its source paths to inspect canonical documents when needed.
- Treat `skill-candidates.md` results as review-only draft material. Skill candidates are never auto-installed and always require user approval.
- Treat `tool-skill-inventory.md` results as read-only candidate material. Tool/Skill records do not authorize automatic install, update, or execution.
- Use `results[]` only for backward compatibility. New integrations should read `items[]`.

Default text output is intentionally short and includes `Source`, `Freshness`, and `Why` lines for provenance. Increase `--limit` only when the task needs broader local memory.

## Codex History Guardian Evidence

When Codex History Guardian is available, treat it as a history evidence provider, not as the canonical owner of project memory.

Use Guardian outputs for:

- old Codex thread discovery;
- paused task lookup;
- restore-index evidence;
- health summaries;
- context pressure signals that tell CEO Flow to write a handoff or start a cleaner thread;
- restore dry-run references;
- source-backed provenance for historical claims.

Do not use Guardian as a background cleaner or scheduled maintenance owner from this skill. Commands such as `clean-logs` and `prune-process-manager` are explicit maintenance operations, not runtime context retrieval. They must not run while Codex is open and must not touch `sessions` or `archived_sessions`.

The only allowed session-body optimization is explicit user-triggered old-thread slimming: `compact-session` / Zhixia "瘦身本体" for one selected ThreadId. It must create a byte-for-byte backup, verify backup SHA-256 against the original, write a compacted temp file, replace the original only after verification, and return a receipt with before/backup/after hashes, byte counts, backup path, and restore hint.

Do not use Guardian outputs to automatically promote durable memory. Memory writeback belongs to Zhixia, canonical project docs, or the active CEO memory provider. History-derived lessons should be queued as candidates first and should include source references, freshness, confidence, and whether human confirmation is required.

When combining Zhixia and Guardian:

- Prefer Zhixia compact project context for current work.
- Use Guardian only for old sessions, paused tasks, historical evidence, health/context pressure, or restore dry-runs.
- When Guardian health is `yellow` or `red`, treat it as a signal to reduce context: write a compact handoff, stop copying long chats into workers, and prefer a cleaner thread with a short memory packet. Do not automatically clean logs.
- Do not read raw session snippets unless the user explicitly asks to recover old thread context, compact summaries are insufficient, and the CEO states a narrow token budget, source range, and provenance requirement.
- Treat Guardian freshness labels as evidence strength: `current` means under 7 days with consistent source refs, `review` means 7-30 days or summary-only, `stale` means over 30 days or predates important changes, `unknown` means missing timestamp/hash/provenance, and `conflict` means indexes, summaries, file metadata, canonical sources, or worker evidence disagree.

## Output Rules

- Keep generated documents local-first and self-contained.
- Preserve exact file paths from `sources.json` when citing provenance.
- Prefer Markdown for Codex-generated documents unless the user asks for DOCX, PPTX, or XLSX.
- Do not parse `.xlsx/.xls` directly. If spreadsheet content is needed, ask for CSV or another safe export.
- Do not delete workspace files or overwrite unrelated documents.
- Do not install generated Skill candidates automatically. Treat `skill-candidates.md` as review material until the user explicitly approves installation.

## Context Bundle

The current bundle and project-knowledge format is documented in `references/context-bundle.md`. Read it when you need exact field names or citation format.
