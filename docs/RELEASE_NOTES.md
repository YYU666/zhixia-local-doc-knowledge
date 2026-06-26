# Release Notes

This public staging copy intentionally contains a short release summary instead of private operational runlogs.

## 0.8.3

- One-click safe relief now starts with Codex hot-log cleanup before thread preservation, slimming, and archive-queue generation. If Codex, codex, or node_repl is still running, Zhixia stops the flow and asks the user to close Codex first, so the large Codex runtime log database is not silently left behind.
- Memory Runtime now includes an explicit memory graph and activation loop for CEO Flow usage: compact project/history/experience metadata can be activated by task goal, project path, and thread id without reading raw session bodies by default.
- Thread recovery support provides compact recovery packets for damaged, archived, or slimmed Codex threads, including source-backed pointers and a restart prompt instead of giant transcript dumps.
- Project IA classification is conservative: only high-confidence project candidates become project cards; low-confidence material moves to pending leads.
- Memory Runtime contract support covers compact context retrieval, precedent retrieval, evidence writeback, working memory, and private review candidates.
- Codex / CEO Flow integration remains local-first, metadata-first, and fail-closed for raw sessions, secrets, destructive actions, public export, install, and execute.
- Startup and large-library behavior were tuned for metadata-first document lists, deferred bounded history preservation, and manual-safe scan defaults.

Private install evidence, transfer-kit logs, local paths, thread IDs, and packaging rehearsals are excluded from this public staging directory.
