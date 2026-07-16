# Memory Core Lifecycle Helper Contract

This reference defines the packaged `read-project-knowledge.cjs` lifecycle CLI and JSON contracts. `SKILL.md` contains only routing and safety guidance.

## Shared Rules

- `<workspace-path>` resolves to an exact absolute project path.
- `--project-id <id>` pins the expected project. ProjectBrain canonical path must still equal the requested workspace.
- `--page-size <1-25>` defaults to `10`.
- `--cursor <cursor>` resumes continuity or review pagination. `--mandatory-cursor` remains a continuity-compatible alias.
- `--project-continuity`, `--review-queue`, and `--diagnostics-summary` remain aliases for continuity, review queue, and diagnostics.
- Output is bounded metadata. Raw session bodies, transcript bodies, base64, secrets, receipt proofs, signing keys, and trust contexts are excluded.
- Persisted sidecar lifecycle status does not prove authority. The packaged helper reports `authorityVerification="unavailable"`; safe persisted rows are advisory review material.
- External file sourceRefs are omitted or retain only pathless metadata with `redacted="outside_workspace"`.

## Runtime Context

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --runtime-context --task-goal "<task goal>" --query-type task_dispatch --token-budget 1200 --limit 6 --json
node scripts/read-project-knowledge.cjs <workspace-path> --runtime-context --task-goal "<review goal>" --query-type review_gate --token-budget 900 --limit 4 --json
```

Returns a schema-v1 RuntimeContextPacket-shaped object with `request`, `project`, `items`, `sourceRefs`, `memoryMode`, `memoryLayers`, `recallPlan`, sidecar summaries, `warnings`, `tokenEstimate`, and `generatedAt`.

Safe persisted MemoryFact and Memory Core rows may appear in `items[]`, but they are normalized to review/advisory authority:

```json
{
  "status": "review",
  "freshness": "review",
  "requiresHumanConfirmation": true,
  "authority": {
    "status": "review",
    "persistedStatus": "accepted",
    "authoritative": false,
    "authorityVerification": "unavailable",
    "advisory": true,
    "scope": "exact_project",
    "sourceBacked": true,
    "receiptProofIncluded": false,
    "trustContextIncluded": false
  }
}
```

## Precedent

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --precedent "<task type or risk>" --token-budget 900 --limit 5 --json
```

Returns a RuntimePrecedentPacket-shaped object over bounded helper kinds such as knowledge, experience, project artifacts, tool inventory, skill candidates, MemoryFacts, and Memory Core records. Sidecar records remain advisory and never authorize execution or installation.

## Continuity Status

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --continuity-status --project-id "<project id>" --page-size 10 --json
node scripts/read-project-knowledge.cjs <workspace-path> --continuity-status --project-id "<project id>" --cursor "<nextCursor>" --page-size 10 --json
```

Returns `zhixia.memory_core_continuity_status.v1` and reports these 14 slots:

`project_identity`, `original_product_goal`, `architecture_anchors`, `standing_rules`, `active_modules`, `current_phase`, `accepted_progress`, `open_tasks`, `open_blockers`, `latest_failures`, `next_actions`, `thread_lineage`, `canonical_docs`, `last_valid_checkpoint`.

Exact shape:

```json
{
  "schemaVersion": "zhixia.memory_core_continuity_status.v1",
  "provider": "zhixia_local_docs",
  "mode": "memory_core_continuity_status",
  "generatedAt": "ISO-8601",
  "project": {
    "id": "project-id",
    "path": "absolute-workspace-path",
    "name": "project-name",
    "summary": "compact-summary",
    "phase": "current-phase-or-null",
    "status": "review|unavailable",
    "freshness": "review|stale|unknown",
    "authority": {}
  },
  "mandatorySlots": [
    {
      "slot": "project_identity",
      "required": true,
      "status": "filled|missing|conflict|stale|unknown",
      "itemCount": 0,
      "staleItemCount": 0,
      "reviewCandidateCount": 0,
      "sourceRefCount": 0,
      "authorityExpectation": "verified_app_authority_receipt_with_direct_source_refs_and_exact_project"
    }
  ],
  "counts": {
    "mandatorySlotCount": 14,
    "filled": 0,
    "missing": 14,
    "conflict": 0,
    "stale": 0,
    "review": 0
  },
  "authorityVerification": "unavailable",
  "recoveryReady": false,
  "items": [
    {
      "id": "id",
      "continuitySlot": "slot",
      "type": "type",
      "title": "title",
      "summary": "summary",
      "status": "review",
      "freshness": "review|stale",
      "whyRecalled": [],
      "authority": {},
      "sourceRefs": [],
      "tokenEstimate": 0,
      "advisory": true
    }
  ],
  "sourceRefs": [],
  "pagination": {
    "cursor": null,
    "nextCursor": null,
    "pageSize": 10,
    "pageStart": 0,
    "pageEndExclusive": 0,
    "total": 0,
    "returned": 0,
    "remaining": 0,
    "complete": false,
    "pageComplete": false,
    "requiresContinuation": false,
    "cursorInvalid": false,
    "cursorSequential": true,
    "cursorTamperEvident": true,
    "chainVerified": true,
    "fullManifestProof": "unavailable",
    "manifestFingerprint": null,
    "sourceTruncated": false
  },
  "sidecar": {},
  "safety": {},
  "performance": {},
  "warnings": []
}
```

### Cursor And Readiness Semantics

The cursor is opaque and non-base64. It includes the manifest fingerprint, next offset, and a SHA-256 digest over the accumulated manifest prefix. The next process recomputes that digest before accepting the offset. Offset-only legacy strings, changed offsets, altered digests, and cursors for a changed manifest are invalid.

This chained digest prevents a caller from claiming an end page using only a synthesized offset. It is tamper-evident, not an app authority receipt. The helper is a fresh process on every CLI call and has no constrained app-owned signing verifier or authenticated full-manifest proof. Therefore:

- `pageComplete=true` means the current bounded advisory manifest reached `remaining=0` with a valid chain.
- `complete` remains a compatibility alias for page completion.
- `recoveryReady` remains `false` while `authorityVerification="unavailable"`, even on the final page.
- Advisory rows do not increment mandatory `itemCount` and cannot mark a slot `filled`.

## Review Queue

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --memory-review-queue --project-id "<project id>" --page-size 10 --json
node scripts/read-project-knowledge.cjs <workspace-path> --memory-review-queue --project-id "<project id>" --cursor "<nextCursor>" --json
```

Returns `zhixia.memory_core_review_queue.v1`. It includes persisted `candidate`/`review` rows plus safe `accepted`/`curated` rows downgraded to review because authority verification is unavailable.

```json
{
  "schemaVersion": "zhixia.memory_core_review_queue.v1",
  "provider": "zhixia_local_docs",
  "mode": "memory_core_review_queue",
  "generatedAt": "ISO-8601",
  "project": {},
  "items": [
    {
      "id": "id",
      "recordKind": "decision",
      "title": "title",
      "summary": "summary",
      "status": "candidate|review",
      "freshness": "fresh|review|stale",
      "continuitySlot": null,
      "whyQueued": [],
      "reviewReasonCodes": ["authority_verification_unavailable"],
      "authority": {},
      "sourceRefs": [],
      "tokenEstimate": 0,
      "updatedAt": "ISO-8601"
    }
  ],
  "sourceRefs": [],
  "counts": { "totalEligible": 0, "returned": 0, "tableCounts": [] },
  "pagination": {
    "cursor": null,
    "nextCursor": null,
    "pageSize": 10,
    "pageStart": 0,
    "pageEndExclusive": 0,
    "total": 0,
    "returned": 0,
    "remaining": 0,
    "complete": false,
    "pageComplete": false,
    "cursorInvalid": false,
    "cursorSequential": true,
    "cursorTamperEvident": true,
    "chainVerified": true,
    "manifestFingerprint": null,
    "sourceTruncated": false
  },
  "sidecar": {},
  "safety": {},
  "performance": {},
  "warnings": []
}
```

## Diagnostics

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --memory-diagnostics --project-id "<project id>" --json
```

Diagnostics requires `--project-id`; without it the helper does not open the sidecar. It returns indexed project-scoped aggregates and schema metadata only.

```json
{
  "schemaVersion": "zhixia.memory_core_diagnostics.v1",
  "provider": "zhixia_local_docs",
  "mode": "memory_core_diagnostics",
  "generatedAt": "ISO-8601",
  "project": {},
  "schema": {
    "logicalSchemaVersion": "zhixia.memory_core_sidecar.v1|unknown",
    "sqliteUserVersion": 0,
    "sqliteSchemaVersion": 0,
    "sqliteApplicationId": 0,
    "compatibleTables": [],
    "incompatibleTables": [],
    "missingTables": []
  },
  "lifecycleTotals": { "current": 0, "review": 0, "historical": 0, "other": 0 },
  "tables": [
    {
      "table": "memory_project_brains",
      "recordKind": "project_brain",
      "statusCounts": {},
      "latestUpdatedAt": "ISO-8601|null"
    }
  ],
  "sidecar": {},
  "safety": { "payloadBodiesReturned": false },
  "performance": { "bounded": true, "fullScans": false, "projectScopedIndexedAggregatesOnly": true },
  "warnings": []
}
```

## Recovery, Pressure, And Takeover

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --recover-thread --thread-id "<thread id>" --thread-title "<title>" --query "<keywords>" --json
node scripts/read-project-knowledge.cjs <workspace-path> --thread-pressure --thread-id "<thread id>" --session-mb 120 --lines-over-100k 30 --data-image-hits 0 --base64-hits 0 --visible-thread-count 4 --active-worker-count 2 --json
node scripts/read-project-knowledge.cjs <workspace-path> --ceo-takeover --project-name "<project>" --thread-id "<old id>" --current-ceo-thread-id "<old id>" --query "<keywords>" --json
```

- Recovery returns a workspace-metadata-only ThreadRecoveryPacket-shaped object and never walks raw or Vault session bodies.
- Pressure evaluates caller-supplied metrics only. It may recommend writeback, harvest, takeover, or a dispatch freeze; it does not inspect sessions or mutate Codex state.
- Takeover returns Hot/Warm/Skill defaults, Cold pointer-only history, sourceRefs, and a one-line startup prompt.

## Writeback Dry Run

```powershell
node scripts/read-project-knowledge.cjs <workspace-path> --writeback-dry-run --evidence-json .codex-knowledge/evidence-input.json --json
```

This returns an EvidenceWritebackPacket-like preview. `--evidence-out <workspace-relative-path>` may write only inside the requested workspace. It does not persist Memory Core rows, mutate FlowSkill, install a Skill, or authorize later actions.
