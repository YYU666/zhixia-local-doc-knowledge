# Zhixia Context Bundle

Zhixia exports Codex context into the target workspace:

```text
.codex-knowledge/
  project-resume.md
  retrieval-packet.md
  retrieval-packet.json
  project-index.md
  project-index.json
  project-chunks.jsonl
  project-knowledge.md
  project-artifacts.md
  project-artifacts.json
  project-sources.json
  context.md
  sources.json
  knowledge-items.md
  knowledge-items.json
  experience-cards.md
  experience-cards.json
  skill-candidates.md
```

## `project-resume.md`

Heuristic Project Resume Packet for restarting paused or long-running projects. Treat it as review material until canonical sources or the user confirm the status.

## `project-knowledge.md`

Compatibility project knowledge index extracted automatically after Zhixia scans a Codex workspace. It must stay short and should not contain full document excerpts or raw history.

Read `project-resume.md` and `retrieval-packet.md` first for project continuity. Use `project-knowledge.md` only as a legacy human-readable entry point. The file includes:

- Codex retrieval rules
- project map
- pointers to the layered files
- short knowledge item summaries
- representative source pointers

## `retrieval-packet.md` / `retrieval-packet.json`

Default compact packet for Codex and CEO Flow. It contains only bounded summaries, counts, source pointers, and the top knowledge/memory/artifact items needed for task dispatch or project resumption.

This is the preferred runtime entry point after `project-resume.md`.

## `project-index.md` / `project-index.json`

Structured project directory. It contains document metadata, source paths, content hashes, short summaries, artifact groups, and counts. It is for navigation and source selection, not for full-text history.

## `project-chunks.jsonl`

Machine-readable retrieval chunks. Each line is one bounded chunk with kind, title, text, source pointer, and token estimate. Chunks are intentionally short so agents can rank and retrieve without reading a giant Markdown file.

## `project-sources.json`

Machine-readable provenance manifest for the project knowledge file. Use it when citing project-level sources.

## `project-artifacts.md` / `project-artifacts.json`

Metadata-only ProjectArtifact map for document governance and agent retrieval. It lists source document paths, artifact type, status (`current`, `needs_review`, or `superseded`), producer role, optional producer thread id, freshness, and source refs.

Use it to find the current PRD, technical design, test plan, release notes, README/context, and evidence documents before opening source files. It does not replace source documents.

## `context.md`

Human-readable Markdown for Codex. It contains:

- generation time
- source document id
- title
- original file path
- source type
- artifact type
- tags
- summary
- extracted content excerpt

Read this file when the user exported a specific document or topic for the current task.

## `sources.json`

Machine-readable provenance manifest:

```json
{
  "bundleId": "ctx-20260526093000",
  "exportedAt": "2026-05-26T09:30:00.000Z",
  "workspacePath": "C:\\Users\\example\\Documents\\project",
  "sources": [
    {
      "documentId": "doc-id",
      "title": "Source title",
      "filePath": "C:\\source\\file.md",
      "tags": ["tag"],
      "sourceType": "imported",
      "artifactType": "markdown",
      "contentHash": "sha256"
    }
  ]
}
```

Use `sources[].filePath`, `sources[].title`, and `sources[].documentId` for provenance sections. Do not claim that Codex read any source not present in the bundle unless the user provided it separately.

## Retrieval helper

The skill includes `scripts/read-project-knowledge.cjs`. From the installed skill folder, run:

```powershell
node scripts/read-project-knowledge.cjs <workspace-path>
```

It prints compact matches from resume, retrieval packet, project index, compatibility project knowledge, project artifacts, task context, knowledge items, experience cards, and skill candidates.

By default the helper reads only the requested workspace's `.codex-knowledge/`. It does not search parent directories, because parent knowledge can be unrelated to the current worker task. Use `--allow-parent-knowledge` only when the parent directory is intentionally the knowledge root.
