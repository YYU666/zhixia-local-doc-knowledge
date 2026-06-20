# CEO Flow + Zhixia Memory Runtime

Zhixia is the official local-first Memory Runtime for CEO Flow. It gives CEO Flow a compact, source-backed way to retrieve project context, find precedent, track short-term working state, and write back accepted evidence without dumping raw sessions or giant Markdown.

## Lifecycle Mapping

| CEO Flow moment | Zhixia hook | Purpose |
| --- | --- | --- |
| Bootstrap / project resume | `retrieve_context(task_goal)` | Load compact project state, documents, memory, sourceRefs, freshness, warnings, and token estimate. |
| Dispatch / task assignment | `retrieve_context(task_goal)` with provider mode | Give worker lanes relevant context without full transcripts. |
| Precedent lookup | `retrieve_precedent(task_type)` | Find similar accepted lessons, reviewable experience cards, project artifacts, tool/skill records, and hot/warm history pointers. |
| Review gate | `retrieve_precedent("review_gate")` | Surface prior blockers, safety rules, and acceptance patterns. |
| Harvest / writeback | `writeback_evidence(result)` | Store compact accepted/revised/blocked evidence receipt in app-owned storage. |
| Promotion review | `promote_memory(candidate)` | Queue safe, source-backed memory or FlowSkill-ready candidate metadata for private review. |
| Handoff | `retrieve_context("handoff")` | Build a compact continuation packet for the next CEO Flow turn. |
| Old-thread recovery | `retrieve_precedent("old_thread_recovery")` | Return metadata pointers and vault/receipt evidence, not raw session bodies by default. |

## Provider Modes

- `none`: No Memory Runtime lookup; CEO Flow proceeds from prompt context only.
- `project-memory`: Use Zhixia project records, knowledge items, experience cards, working memory, and sourceRefs.
- `zhixia-local-docs`: Use the packaged Codex helper under `codex-skills/zhixia-local-docs` for compact local files and dry-run evidence packets.
- `guardian-history`: Use history/vault/pointer metadata for old-thread recovery; raw session body remains excluded by default.
- `hybrid`: Combine project-memory, helper packets, and safe history metadata under token and sourceRef bounds.

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
    "providerMode": "hybrid"
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
  "warnings": [],
  "tokenEstimate": 900,
  "generatedAt": "ISO-8601 timestamp"
}
```

Rules:

- Default output is compact and metadata-first.
- Include sourceRefs whenever possible.
- Include freshness/status/human-confirmation signals when available.
- Do not include raw session JSONL, full chats, giant generated Markdown, screenshots/base64 payloads, credentials, or long logs.

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
