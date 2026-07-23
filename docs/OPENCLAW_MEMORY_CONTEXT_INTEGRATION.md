# OpenClaw Memory And Context Integration

Status: R0 local auxiliary path verified; R1 code-writing path remains gated by prepared-worktree and tool-policy acceptance.

## Ownership

```text
Codex CEO Flow = control, assurance, acceptance, memory-writeback and publish owner
OpenClaw = bounded external execution provider
Zhixia = the only canonical project-memory runtime
OpenClaw native durable memory = disabled
OpenClaw session = disposable task-local execution state
```

OpenClaw must not receive raw CEO chat, complete project history, full ProjectBrain, giant Markdown, screenshots/base64, secrets, or unrelated project memory. It must not change CEO model/reasoning, accept its own work, promote memory, publish, merge, release, or contact users.

## Lifecycle

1. CEO Flow resolves exact project identity and calls Zhixia `retrieve_context(queryType=task_dispatch)` with an 800-1500 token budget.
2. CEO Flow creates `ceoflow.external_execution_task.v1` with compact Hot/Warm excerpts, sourceRefs, task hash, write-set, model route, timeout, and forbidden effects.
3. OpenClaw uses a fresh session for that task id. The session may hold disposable execution state, but it cannot create `MEMORY.md`, memory chunks, promotions, or a durable project-memory index.
4. OpenClaw returns `ceoflow.external_execution_receipt.v1`. Raw provider JSON stays cold at a local path.
5. Codex validates task hash, provider/session identity, write-set, tests, artifacts, usage, and forbidden effects, then decides `accept | revise | block | supersede`.
6. Only Codex-accepted, source-backed compact evidence is sent to Zhixia `writeback_evidence`. OpenClaw never writes canonical memory directly.
7. A replacement OpenClaw session receives a new compact packet. It does not reload or copy the old transcript.

## Local Isolation

The verified Windows deployment uses:

- state root: `~/.openclaw-ceoflow`;
- model: local Ollama `qwen2.5vl:7b` for R0 text work;
- transport: OpenClaw embedded `--local`, no Gateway daemon;
- concurrency: 1 main task and 1 subagent maximum;
- tools: `minimal`, elevated disabled, exec denied;
- native memory search: disabled; no FTS/vector project-memory index;
- session-memory hook and compaction memory flush: disabled;
- native `memory-core` plugin: not allowed;
- skills: empty allowlist;
- heartbeat/hooks/channels: disabled;
- runtime: a dedicated verified Node 24.15.0 launcher profile.

This isolation prevents the worker from loading the existing personal OpenClaw state, personal channels, old sessions, plugins, or provider credentials. The CEO Flow bridge checks the three memory switches, plugin allowlist, exact native-memory file locations, and bounded agent memory-index row counts before every isolated local run. It fails closed if an OpenClaw upgrade or configuration drift re-enables or recreates native memory.

## Zhixia Adapter

`electron/openClawSessionAdapter.cjs` provides on-demand, read-only metadata:

- reads bounded `agents/<id>/sessions/sessions.json` files;
- reads fixed task-ledger columns from `state/openclaw.sqlite` in `readOnly + query_only` mode;
- never reads JSONL session bodies, task prompts, error bodies, images, base64, credentials, or memory chunks;
- rejects session paths outside the agent session directory;
- caps state roots, agents, index bytes, tasks, sessions, and file stats;
- performs no recursive walk, watcher, timer, heartbeat, embedding, migration, archive, compact, delete, move, or restore.

The adapter feeds Agent Runtime Monitor only when a snapshot is requested. It does not run at startup or in the background.

## Performance Budgets

- task context: normally 800-1500 tokens, hard task envelope cap 20,000;
- one OpenClaw session per task id;
- metadata indexes: at most 2 MiB each;
- task database: at most 64 MiB for direct metadata read;
- default session result count: 40;
- default file-stat budget: 48;
- no vector index until benchmarked recall gain justifies CPU, memory, and storage cost;
- no polling; use synchronous completion or durable task receipts.

## Recovery

OpenClaw session loss is not project-memory loss. Recovery order is: typed task and receipt, Zhixia Hot/Warm packet, canonical sourceRefs, accepted evidence, then cold history only if a named fact remains missing. Raw OpenClaw transcripts remain cold evidence and are never injected wholesale. OpenClaw must never recover by rebuilding a native memory index from old sessions.

## Acceptance State

Accepted now:

- isolated local OpenClaw state and model route;
- bounded R0 typed task/receipt path;
- compact Zhixia memory packet transfer;
- native OpenClaw durable memory disabled and bridge-enforced;
- read-only OpenClaw session/task metadata adapter;
- task hash, no-deliver, no-publish, no-write and raw-payload boundaries.

Still gated:

- R1 code editing requires a prepared worktree under an approved workspace, a task-specific coding tool profile, exact write-set enforcement, focused tests, and neutral Codex review;
- remote/provider models require valid credentials, measured cost/privacy, and a separate successful receipt;
- unattended background execution remains disabled.

## Legacy Memory Retirement

The Windows migration utilities follow a preservation-first contract. Close Codex and OpenClaw before running the mutation stages.

1. run `preserve-openclaw-memory.ps1 -DryRun` with explicit state roots, vault root, and a new batch path;
2. run the same preservation command without `-DryRun` to copy only `MEMORY.md` and allowlisted `memory/**` files, verify per-file SHA-256, and create `zhixia.openclaw_memory_vault.v1` `MANIFEST.json`;
3. run `remove-verified-openclaw-memory.ps1 -ValidateOnly` against that manifest, then explicitly run it without `-ValidateOnly` only after verification;
4. run `clear-openclaw-memory-index.py --validate-only <state roots>`, then explicitly use `--execute` to clear only `memory_index_*` and `memory_embedding_cache` tables.

The utilities reject symlinks, Windows junctions, reparse-point path components, path escapes, raw agent sessions, task ledgers, credentials, and whole-database deletion. A retained vault is recovery evidence, not an active recall source.

## Codex And OpenClaw Recall Bridge

Codex can query retired OpenClaw memory through the installed `zhixia-local-docs` Skill using the explicit cold-audit helper. The helper reads a prebuilt sanitized SQLite index, not the 15 MiB vault tree, so ordinary recall has no background scan or embedding cost.

For an OpenClaw audit task, CEO Flow performs retrieval first and injects only bounded excerpts plus `openclaw-vault://...` provider-safe references. Local backup paths stay Codex-only. OpenClaw does not install the Zhixia Skill, query the vault, rebuild the index, or write memory; its native memory switches remain disabled.

Current Windows evidence: 165 cold sources produced 135 indexed sources, 30 pointer-only sources, and 386 sanitized chunks after reading 569,618 safe text bytes. The SQLite index is about 1.9 MiB. Ten installed-Skill queries, including Node startup, averaged 88.9 ms with a 186.2 ms observed P95/max. There is no timer, watcher, heartbeat, embedding process, or ordinary-task lookup.

Ollama/OpenClaw model runtime cost is separate from Zhixia retrieval cost. Loading the local 7B model can temporarily consume about 1 GiB of working memory in addition to GPU VRAM, so the model service should remain on-demand rather than being treated as a memory daemon.
