# CEO Flow + Zhixia Memory Runtime

Zhixia is the official local-first Memory Runtime for CEO Flow. It gives CEO Flow a compact, source-backed way to retrieve project context, find precedent, track short-term working state, and write back accepted evidence without dumping raw sessions or giant Markdown.

## Lifecycle Mapping

| CEO Flow moment | Zhixia hook | Purpose |
| --- | --- | --- |
| Bootstrap / project resume | `retrieve_context(task_goal)` | Load compact project state, documents, memory, sourceRefs, freshness, warnings, and token estimate. |
| Dispatch / task assignment | `retrieve_context(task_goal)` with provider mode | Give worker lanes relevant context without full transcripts. |
| Precedent lookup | `retrieve_precedent(task_type)` | Find similar accepted lessons, reviewable experience cards, project artifacts, tool/skill records, and hot/warm history pointers. |
| Review gate | `retrieve_precedent("review_gate")` | Surface prior blockers, safety rules, and acceptance patterns. |
| Runtime event observation | `observe_event(event)` | Record broken threads, heartbeat fuse events, thread takeover, stale lane references, checkpoints, and user rule updates as short-term hot memory. |
| Harvest / writeback | `writeback_evidence(result)` | Store compact accepted/revised/blocked evidence receipt in app-owned storage. |
| Promotion review | `promote_memory(candidate)` | Queue safe, source-backed memory or FlowSkill-ready candidate metadata for private review. |
| Handoff | `retrieve_context("handoff")` | Build a compact continuation packet for the next CEO Flow turn. |
| Old-thread recovery | `recover_thread(threadId/title/projectPath)` then `retrieve_context("thread_recovery")` | Build a compact ThreadRecoveryPacket from lineage, vault manifests, project docs, and cold-history pointers; raw session bodies remain excluded by default. |

## Provider Modes

- `none`: No Memory Runtime lookup; CEO Flow proceeds from prompt context only.
- `project-memory`: Use Zhixia project records, knowledge items, experience cards, working memory, and sourceRefs.
- `zhixia-local-docs`: Use the packaged Codex helper under `codex-skills/zhixia-local-docs` for compact local files, old-thread recovery packets, and dry-run evidence packets.
- `guardian-history`: Use history/vault/pointer metadata for old-thread recovery; raw session body remains excluded by default.
- `hybrid`: Combine project-memory, helper packets, and safe history metadata under token and sourceRef bounds.

## Hook: observe_event(event)

Use this hook when CEO Flow observes a runtime fact that future threads must not forget but that should not require scanning the whole history library.

Supported event types:

- `broken_thread`: a CEO/project-main/worker thread is unreadable, stream-broken, repeatedly empty, context-exhausted, stuck in reconnect/auto-compact loops, or fails with `max_output_tokens` / incomplete response.
- `heartbeat_fuse`: a heartbeat, monitor, or wakeup loop was paused because it repeatedly targeted a broken or wasteful thread.
- `thread_takeover`: a clean replacement thread was designated for an old or broken thread.
- `stale_lane_reference`: a roster, heartbeat, task card, or recovery packet points to a thread id that cannot be read or no longer resolves.
- `task_checkpoint`, `user_rule_update`, `runtime_diagnosis`: compact operational facts that should appear in the next hot context packet. Model/reasoning drift, such as another lane changing CEO model or reasoning strength, should be recorded as `user_rule_update` and treated as a rule to preserve.

Request shape:

```json
{
  "eventType": "heartbeat_fuse",
  "severity": "warning",
  "projectPath": "C:/Users/example/Documents/2D游戏项目",
  "threadId": "public-thread-id",
  "replacementThreadId": "optional-clean-takeover-thread-id",
  "automationId": "rgs-ceo-harvest-post-43-wave",
  "title": "RGS CEO heartbeat paused",
  "summary": "The heartbeat was waking a broken large CEO thread and should not be retried until a takeover packet is used.",
  "observedSignals": ["last_agent_message=null", "stream_disconnect", "high_token_empty_turn"],
  "decisions": ["Pause the heartbeat target."],
  "openRisks": ["Do not treat the old thread as active owner."],
  "nextAction": "Start from the ThreadRecoveryPacket and retrieve_context(thread_recovery).",
  "sourceRefs": [
    { "kind": "automation_receipt", "path": "app-owned-receipt.json", "title": "Heartbeat fuse receipt" }
  ]
}
```

Response behavior:

- Writes a compact app-owned `runtime-events` record.
- Upserts a `WorkingMemoryRecord`; `broken_thread`, `heartbeat_fuse`, and `stale_lane_reference` default to `blocked`.
- Adds hot `runtime_event` items to the next `retrieve_context` packet for matching project/thread.
- Omits raw-session and secret sourceRefs from runtime-event storage and default context; only an unsafe ref count and warning are kept.
- Does not start timers, scan Vault, read raw session bodies, mutate sessions, archive, compact, delete, move, restore, install, execute, or export FlowSkill material.

Closed-loop producers:

- `recover_thread(...)` automatically writes a recovery/takeover runtime event after generating a ThreadRecoveryPacket, unless `observeRuntimeEvent=false`.
- `runtimeMonitor:getSnapshot` automatically writes bounded runtime diagnosis events from its already-computed recommendations, unless `observeRuntimeEvents=false`.
- The next `retrieve_context(...)` call includes those events as hot memory for matching project/thread.

## Hook: retrieve_context(task_goal)

Request shape:

```json
{
  "task_goal": "prepare implementation lane for project detection polish",
  "projectPath": "optional workspace root",
  "providerMode": "hybrid",
  "limit": 12,
  "tokenBudget": 4000
}
```

Response shape:

```json
{
  "schemaVersion": "zhixia.runtime_context.v1",
  "request": {
    "taskGoal": "prepare implementation lane for project detection polish",
    "providerMode": "hybrid",
    "queryType": "task_dispatch",
    "tokenBudget": 1200
  },
  "routerPlan": {
    "strategy": "hot_warm_cold_metadata_first",
    "taskType": "task_dispatch",
    "retrieval": {
      "includeKinds": ["project_record", "project_artifact", "knowledge_item", "experience_card"],
      "maxResults": 8
    },
    "backgroundPolicy": {
      "startsTimers": false,
      "scansFullDatabase": false,
      "scansVault": false,
      "runsAiSummary": false,
      "rebuildsGraph": false
    }
  },
  "project": {
    "path": "workspace root or null",
    "name": "project display name",
    "status": "active",
    "freshness": "fresh"
  },
  "items": [
    {
      "kind": "project_record",
      "title": "Project resume",
      "summary": "Compact source-backed summary.",
      "freshness": "fresh",
      "status": "accepted"
    }
  ],
  "sourceRefs": [
    {
      "kind": "document",
      "path": "relative-or-local-source-path",
      "title": "TECHNICAL_DESIGN.md",
      "hash": "sha256-or-source-hash"
    }
  ],
  "hotState": {
    "activeItemIds": ["project-record"],
    "nextAction": "Compact next step.",
    "sourceRefs": []
  },
  "memoryLayers": {
    "hot": { "count": 1, "tokenEstimate": 120 },
    "warm": { "count": 2, "tokenEstimate": 520 },
    "cold": { "count": 0, "tokenEstimate": 0 }
  },
  "memoryGraph": {
    "mode": "bounded_association_graph",
    "nodes": [],
    "edges": []
  },
  "performance": {
    "metadataFirst": true,
    "noRawSessionBody": true,
    "noFullTextRead": true,
    "noVaultScan": true,
    "noBackgroundTimer": true,
    "boundedByRouterPlan": true
  },
  "warnings": [],
  "tokenEstimate": 900,
  "generatedAt": "ISO-8601 timestamp"
}
```

Rules:

- Default output is compact and metadata-first.

## Hook: recover_thread(threadId/title/projectPath)

Use this before `retrieve_context` when a CEO Flow thread is broken, archived, slimmed, or replaced and the new thread only knows an old thread id, title, memory pointer, or project path.

Request shape:

```json
{
  "threadId": "public-thread-id",
  "title": "Refmuse game Studio CEO",
  "projectPath": "C:/Users/example/Documents/2D游戏项目",
  "tokenBudget": 1600
}
```

Response shape:

```json
{
  "schemaVersion": "zhixia.thread_recovery_packet.v1",
  "thread": {
    "threadId": "old-thread-id",
    "title": "old thread title",
    "projectPath": "workspace root",
    "confidence": "source_backed"
  },
  "lineage": [],
  "vault": {
    "hasVault": true,
    "policy": "pointer_only_no_default_raw_body_read",
    "manifests": []
  },
  "recommendedReadOrder": [],
  "coldHistorySources": [],
  "prompt": "compact starter prompt for the replacement CEO thread",
  "safety": {
    "mutatesRawSession": false,
    "archiveCompactDeleteMoveRestore": false,
    "rawSessionDefaultRead": false
  },
  "warnings": []
}
```

CEO Flow bootstrap rule:

1. If the user provides an old thread id/title or says a previous CEO thread broke, call `recover_thread`.
2. Give the replacement thread the returned `prompt`, `recommendedReadOrder`, and compact `sourceRefs`.
3. Then call `retrieve_context` with `queryType="thread_recovery"` for current hot/warm project context.
4. Only read `coldHistorySources` raw/vault session paths after an explicit narrow recovery request. They are pointers, not default context.
5. Write a `WorkingMemoryRecord` for the replacement thread so future recovery does not depend on manual `.codex` searching.

Codex helper fallback when Electron IPC is unavailable:

```powershell
node codex-skills/zhixia-local-docs/scripts/read-project-knowledge.cjs <workspace-path> --recover-thread --thread-id "<old thread id>" --thread-title "<old thread title>" --query "<project or task keywords>" --json
```

The helper fallback is workspace-metadata-only. It can recommend project docs and compact `.codex-knowledge` sourceRefs, but it does not walk Thread History Vault and does not read raw/vault session bodies.
- `routerPlan` is advisory for CEO Flow dispatch. It explains the chosen task profile, retrieval budget, hot/warm/cold policy, and performance boundaries.
- `hotState` is the short-lived project/task continuity seed; `memoryGraph` is a bounded association graph derived only from returned compact items and sourceRefs.
- Include sourceRefs whenever possible.
- Include freshness/status/human-confirmation signals when available.
- Do not include raw session JSONL, full chats, giant generated Markdown, screenshots/base64 payloads, credentials, or long logs.
- Do not treat `memoryGraph` as permission to scan the whole library or rebuild an always-on graph. It is packet-local and disposable.
- `performance.noFullTextRead` means the default packet avoids document/raw bodies. It does not mean the provider never reads metadata rows; metadata-first bounded row reads are allowed under the router plan.

## Hook: retrieve_precedent(task_type)

Request shape:

```json
{
  "task_type": "review_gate",
  "projectPath": "optional workspace root",
  "limit": 8,
  "tokenBudget": 2500
}
```

Response shape:

```json
{
  "schemaVersion": "zhixia.runtime_precedent.v1",
  "request": {
    "taskType": "review_gate"
  },
  "items": [
    {
      "kind": "experience_card",
      "title": "Prior acceptance lesson",
      "summary": "What mattered last time.",
      "status": "accepted",
      "sourceRefs": []
    }
  ],
  "sourceRefs": [],
  "warnings": [],
  "tokenEstimate": 700,
  "generatedAt": "ISO-8601 timestamp"
}
```

Allowed precedent sources by default:

- Accepted/reviewable `KnowledgeItem`.
- `ExperienceCard`.
- `ProjectArtifact`.
- `ToolSkillRecord`.
- `SkillCandidate` metadata.
- Hot/warm thread-history pointers and vault receipts.

Default precedent retrieval must not read raw session bodies or giant Markdown.

## Hook: writeback_evidence(result)

Request shape:

```json
{
  "schemaVersion": "zhixia.evidence_writeback.v1",
  "task": {
    "id": "task-id",
    "goal": "short goal"
  },
  "decision": "accepted",
  "summary": "Compact result summary.",
  "sourceRefs": [
    {
      "kind": "document",
      "path": "docs/TECHNICAL_DESIGN.md",
      "title": "Technical Design",
      "hash": "source-hash"
    }
  ],
  "writeback": {
    "reusablePattern": "Pattern worth reviewing later.",
    "flowSkillCandidate": true
  },
  "privacy": {
    "containsRawSession": false,
    "containsSecrets": false,
    "publicExportRequested": false
  }
}
```

Receipt shape:

```json
{
  "id": "stable receipt id",
  "hash": "stable input hash",
  "createdAt": "ISO-8601 timestamp",
  "status": "accepted",
  "flowSkillCandidateCount": 1,
  "warnings": []
}
```

Rules:

- No sourceRefs means advisory/candidate-only; it must not create FlowSkill-ready output.
- Raw session or secret evidence is rejected or blocked even if caller-supplied privacy flags are false or omitted.
- Writeback stores compact JSON in app-owned storage only.
- Writeback must not mutate raw Codex sessions, delete/move/archive/compact/restore user data, install skills, execute scripts, or public-export anything.

## Hook: promote_memory(candidate)

Request shape:

```json
{
  "kind": "experience",
  "task": {
    "id": "task-id",
    "goal": "short goal"
  },
  "candidate": {
    "title": "Reusable review checklist",
    "summary": "Compact candidate summary.",
    "reusablePattern": "When this pattern applies..."
  },
  "sourceRefs": [
    {
      "kind": "document",
      "path": "docs/TEST_PLAN.md",
      "title": "Test Plan"
    }
  ],
  "requestedEffect": "private_review"
}
```

Response shape:

```json
{
  "status": "candidate_review",
  "blockers": [],
  "candidate": {
    "schemaVersion": "zhixia.flowskill_candidate.v1",
    "status": "private_review",
    "sourceRefs": [],
    "promotion": {
      "publicExport": false,
      "install": false,
      "execute": false
    }
  }
}
```

Fail-closed blockers:

- `raw_session` source refs or session JSONL paths.
- `.env`, credential, token, API key, secret, private-key-like source refs or action fields.
- Public export, install, execute, archive, compact, delete, move, restore, or destructive requested effects.
- Missing sourceRefs for FlowSkill-ready output.

## Working Memory

Working memory is short-term task state, not permanent knowledge. It can be upserted, listed, and closed with states such as:

- `active`
- `waiting_review`
- `blocked`
- `accepted`
- `superseded`

Working memory helps CEO Flow resume a task without promoting every temporary note into long-term memory.

## CEO Flow + Zhixia Quick Start

1. Install and run Zhixia locally.
2. Import or scan a project folder.
3. Confirm that the project page shows real project cards, not noisy generated artifacts.
4. In CEO Flow, set Memory Runtime provider mode to `project-memory`, `zhixia-local-docs`, or `hybrid`.
5. At bootstrap, call `retrieve_context(task_goal)`.
6. Before dispatch or review, call `retrieve_precedent(task_type)`.
7. After an accepted review, call `writeback_evidence(result)` with sourceRefs.
8. Review private candidates in Zhixia before exporting or installing anything elsewhere.

## Hard Safety Boundaries

- No raw sessions by default.
- No giant Markdown by default.
- No screenshots/base64/credentials/long logs in default packets.
- Evidence writeback is compact and app-owned.
- Promotion is fail-closed and review-first.
- FlowSkill capture/export/install/execute is not automatic.
- Archive/compact/restore/delete/move actions are explicit, destructive, and outside default Memory Runtime retrieval.
