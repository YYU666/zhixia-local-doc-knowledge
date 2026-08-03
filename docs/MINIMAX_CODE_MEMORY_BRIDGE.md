# MiniMax Code Memory Bridge

MiniMax Code can consume the same project-scoped Zhixia Memory Runtime used by Codex. The bridge is a lazy `stdio` MCP process, not a background daemon.

## Contract

MiniMax registers `zhixia-memory` in `%USERPROFILE%\.minimax\mcp.json` and starts `memory-runtime-mcp.cjs` only when it lists or calls the memory tools. The server exposes:

- `retrieve_context`
- `retrieve_precedent`
- `observe_event`
- `writeback_evidence`
- `continuity`
- `list_trigger_receipts`
- `report_worker_task_status`
- `list_worker_tasks`

Every call requires an explicit workspace. Zhixia derives the stable `ProjectIdentityEnvelope`, keeps worktrees attached to their canonical project, and rejects cross-project source references. Codex and MiniMax therefore share compact project memory without sharing their private chat databases.

MiniMax output remains worker evidence. It cannot directly set `current=true`, `recoveryReady=true`, or accepted authority. Accepted writeback requires safe source references and remains subject to Zhixia review and continuity rules.

## MiniMax Configuration

```json
{
  "mcpServers": {
    "zhixia-memory": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:\\path\\to\\app\\codex-skills\\zhixia-local-docs\\scripts\\memory-runtime-mcp.cjs"
      ],
      "enabled": true,
      "configured": true,
      "timeout": 30000
    }
  }
}
```

MiniMax Code 3.0.57 also discovers the installed Codex `zhixia-local-docs` skill from `%CODEX_HOME%\skills`. A project `AGENTS.md` can require retrieval before work and compact writeback after acceptance; the MCP registration supplies the actual tools.

## Small-Task Envelope

Use MiniMax for bounded chores with an explicit goal, read set, write set, acceptance check, and workspace. Retrieve context before execution. Write back only the compact result and source references after the task passes its check.

Do not pass raw sessions, full chats, giant Markdown, images/base64, credentials, or long logs through this bridge. The bridge performs no archive, compact, delete, move, restore, public export, or background scan.

## Task Visibility

MiniMax reports `running` when a bounded task starts, `waiting` or material progress only when the state meaningfully changes, and one terminal state when it ends. Reports use a stable taskId and are idempotent. There is no periodic heartbeat. Codex can call `list_worker_tasks` on demand to see active MiniMax work for an exact project; terminal records are hidden unless `includeTerminal=true`.

Task status is self-reported telemetry, not acceptance evidence. A completed report never sets Memory Core authority and must still pass CEO/reviewer acceptance before `writeback_evidence` can promote the result.
