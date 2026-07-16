# CEO Flow + Zhixia Memory Runtime

Zhixia is the official local-first Memory Runtime for CEO Flow. It gives CEO Flow a compact, source-backed way to retrieve project context, find precedent, track short-term working state, and write back accepted evidence without dumping raw sessions or giant Markdown.

## Integrated Contract Status

截至 2026-07-16，App 端 Memory Core 和 CEO Flow 端触发合同均已交付。职责边界如下：

- Zhixia App 负责 authority verifier、ProjectBrain/14-slot ledger、完整 mandatory pagination、Episode Formation signed receipt、sidecar 持久化和 IPC。
- CEO Flow 负责何时触发 Memory Trigger Gate / Project Continuity Gate、角色所需槽位、事件预算、task-card/result 字段和 accept/revise/block 决策。
- packaged `zhixia-local-docs` helper 是 IPC 不可用时的只读 adapter，不是第二个 authority root。

## Project Continuity Gate

Continuity Gate 是事件触发的生命周期 gate，不是每回合 recall，也不是 heartbeat、timer 或后台扫描。

触发事件：

- bootstrap、CEO takeover、broken-thread takeover 或 recovery；
- 开始新 module、wave 或 writer lane；
- 重大 `accept` 改变原始产品目标、架构锚点、当前阶段、完成/就绪声明、发布方向或其他长期锚点；
- 用户指出方向漂移、遗忘上下文、冲突方向或错误恢复信心。

不触发：

- 普通状态更新、callback polling、等待 worker/reviewer；
- 同一 module/wave 内未改变 authority/coverage 的连续工作；
- 每回合对话、分钟级 heartbeat、启动时巡检或后台 raw-history embedding。

固定 14 槽：

```text
project_identity
original_product_goal
architecture_anchors
standing_rules
active_modules
current_phase
accepted_progress
open_tasks
open_blockers
latest_failures
next_actions
thread_lineage
canonical_docs
last_valid_checkpoint
```

角色覆盖：

- CEO full recovery：全部 14 槽，mandatory manifest 必须完整分页。
- Worker：项目身份/目标/相关架构与规则、当前阶段、选中模块，以及任务相关的 task/blocker/failure/next/checkpoint/canonical docs。
- Reviewer：目标、相关架构、standing rules、accepted progress、当前阶段、canonical docs、checkpoint 和 acceptance-risk precedent。

分页合同：

1. 使用精确 project path/id 调用 `memoryRuntime:getContinuityStatus` 或等价 provider capability。
2. 持续读取 `nextCursor`，直到 `pagination.complete=true` 且 `mandatoryReturned=mandatoryTotal`。
3. 第一页、top-K、slot count 或 embedded recovery preview 不构成 full recovery。
4. cursor 无效、manifest 改变、source truncated、schema/provider failure 或达到 page/token bound 时停止并记录 partial；不得声称 full recovery。
5. `review` / `conflict` / `stale` 槽进入 bounded review queue/canonical-source review，不自动升级 authority。
6. 只有 App verifier 可以返回 `recoveryReady=true`。packaged helper 没有 trust context，固定返回 `authorityVerification=unavailable`、advisory 和 `recoveryReady=false`，即使它已经读取完 bounded manifest。

精确任务卡字段：

```text
Project Continuity requirement:
  triggered: yes | no
  trigger reason:
  role coverage: ceo_project | worker_module | reviewer_acceptance
  required slots:
  project path/id:
  module scope:
  precedent query:
  page size:
  max pages:
  token budget:
  full recovery claim allowed: no unless app result.recoveryReady=true
```

精确结果字段：

```text
Project Continuity result:
  schema/version:
  project path/id:
  role coverage:
  covered/missing/conflict/stale/review slots:
  pages read:
  pagination complete:
  mandatory returned/total:
  bounded stop/failure reason:
  recoveryReady:
  sourceRefs:
  review queue consulted:
  diagnostics consulted:
```

Cold/raw escalation 只能用于：角色必需槽在 compact continuity 和其 canonical source refs 后仍缺失，且调用方声明精确缺失槽、1-3 个 source refs/一个窄范围、300-800 token 预算。conflict/stale/review 本身不授权读取 raw history。

## App IPC Mapping

- `memoryRuntime:retrieveContext` / `retrievePrecedent`
- `memoryRuntime:recoverThread`
- `memoryRuntime:observeEvent`
- `memoryRuntime:writebackEvidence`
- `memoryRuntime:upsertWorkingMemory` / `listWorkingMemory` / `closeWorkingMemory`
- `memoryRuntime:listFacts` / `listTriggerReceipts`
- `memoryRuntime:evaluateBenchmark`
- `memoryRuntime:getCoreDiagnostics`
- `memoryRuntime:listCoreReviewQueue`
- `memoryRuntime:getContinuityStatus` / `getProjectContinuity`
- `memoryRuntime:promoteMemory`

所有读取遵守 metadata-first、bounded、no raw session body、no startup full scan、no Memory Core heartbeat。只读 continuity/diagnostics 在私有状态未初始化时返回 `not_ready`，不得创建 signing key 或 sidecar。

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

CEO Flow 已将 Memory Runtime 定义为 continuity 场景的默认生命周期动作，而不是可选工具。知匣 2026-07-15 起会为 `retrieve_context`、`retrieve_precedent`、`writeback_evidence` 和 `promote_memory` 写入轻量 `MemoryRuntimeTriggerReceipt`，因此可以从 `memoryRuntime:listTriggerReceipts` 核验某个项目是否真实触发、返回了多少记忆、耗时/token 以及是否 partial。

accepted 且 source-backed 的 writeback 还会进入 typed temporal MemoryFact：同一 subject/predicate 的新值不会删除旧值，而是建立 `supersededBy` 和 valid-time 边界。CEO Flow 不需要在任务卡中粘贴这些事实正文；下一次 bootstrap/dispatch 会由 `retrieve_context` 通过 FTS5/BM25F sidecar 和现有 Hot/Warm/Skill/Cold 路由召回。
| CEO pressure guard | `evaluate_ceo_thread_pressure(metadata)` | Stop bloated visible CEO threads from accepting new dispatch when size, image/base64 payloads, long lines, or multi-thread churn predict Codex UI freezes. |
| CEO takeover bootstrap | `build_ceo_takeover_bootstrap(...)` | Generate a one-line replacement-thread startup packet with Hot/Warm/Skill default recall and Cold pointer-only history. |

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
  "projectPath": "C:/Users/example/Documents/example-project",
  "threadId": "public-thread-id",
  "replacementThreadId": "optional-clean-takeover-thread-id",
  "automationId": "example-ceo-harvest-post-43-wave",
  "title": "Example CEO heartbeat paused",
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
  "memoryMode": "layered",
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
    "skill": { "count": 1, "tokenEstimate": 180 },
    "cold": { "count": 0, "tokenEstimate": 0 }
  },
  "recallPlan": {
    "mode": "hot_warm_cold_skill_layered_recall",
    "defaultReadOrder": ["hot", "warm", "skill"],
    "coldLayer": {
      "enabled": false,
      "defaultRead": false,
      "policy": "source_refs_only_until_explicit_recovery_or_evidence_gate"
    }
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
- Runtime context now uses layered recall:
  - Hot: short-term working memory for current goal, active module, latest decisions, blockers, and next action.
  - Warm: long-term project summary memory for PRD, architecture, accepted progress, design origin, module history, and stable source refs.
  - Skill: procedural memory for experience cards, tool records, Skill candidates, and reusable workflows.
  - Cold: raw/vault/thread-history evidence pointers only. Cold bodies are not read by default and require explicit recovery or evidence-gate escalation.
- Product/project queries should prioritize product state and accepted progress. Thread maintenance, archive, Guardian, and old-thread optimization records should not outrank product memory unless the query type is `thread_recovery`, `archive_candidate`, or an explicit maintenance/recovery query.

## Hook: recover_thread(threadId/title/projectPath)

Use this before `retrieve_context` when a CEO Flow thread is broken, archived, slimmed, or replaced and the new thread only knows an old thread id, title, memory pointer, or project path.

Request shape:

```json
{
  "threadId": "public-thread-id",
  "title": "Example Project CEO",
  "projectPath": "C:/Users/example/Documents/example-project",
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

## CEO Pressure Guard And Takeover

Long-running CEO threads can become unusable before project memory is lost: giant visible JSONL files, `data:image`/base64 payloads, long tool-output lines, and many visible worker lanes can freeze Codex even when background work is still running. Zhixia treats this as a Memory Runtime lifecycle problem, not as automatic cleanup.

Pressure evaluation is metadata-only. The caller supplies known metrics such as `sessionBytes`, `lineCount`, `maxLineChars`, `linesOver100k`, `dataImageHits`, `base64Hits`, `toolOutputLikeHits`, `visibleThreadCount`, `activeWorkerCount`, and `longTitleCount`. Zhixia returns one of `continue`, `writeback_required`, `harvest_only`, `takeover_recommended`, or `freeze_risk_stop_dispatch`.

The guard does not start timers, scan the Vault, read raw session bodies, archive, compact, delete, move, restore, or mutate Codex sessions. When it returns `harvest_only` or stronger, CEO Flow should stop dispatching new lanes, harvest current callbacks, write compact evidence, and create a takeover bootstrap packet.

Takeover bootstrap gives the replacement CEO a short prompt:

```text
你是 <project> 的新 CEO 接管线程。请使用知匣 Memory Runtime 恢复当前项目状态：先读 Hot/Warm/Skill 记忆和 canonical docs，Cold/raw 历史只看 sourceRefs，不默认加载旧线程全文、图片/base64 或完整工具日志。
```

The bootstrap packet includes `retrieve_context(project_resume)`, `retrieve_precedent(thread_recovery)`, and `writeback_evidence(handoff)` as recommended hooks. Cold history remains `readByDefault=false`; long-term anchors should come from Warm memory and canonical docs before any raw-history hard gate.
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
  "schemaVersion": 1,
  "task": {
    "id": "task-id",
    "goal": "short goal"
  },
  "decision": "accept",
  "evidence": {
    "summary": "Compact result summary.",
    "reusablePattern": [
      "Pattern worth reviewing later."
    ],
    "sourceRefs": [
      {
        "kind": "document",
        "path": "docs/TECHNICAL_DESIGN.md",
        "title": "Technical Design",
        "hash": "source-hash"
      }
    ]
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
  "status": "queued",
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
  "status": "queued",
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

Promotion/writeback receipt status is limited to `queued | candidate_review | rejected`: source-backed safe input is `queued`, missing-source advisory input is `candidate_review`, and any raw-session, secret, base64, giant-body, public-export, executable, or destructive signal is `rejected`.

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
