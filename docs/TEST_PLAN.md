# 测试计划

## 自动验证

- `npm run build`：TypeScript 和 Vite 生产构建。
- `npm test`：烟测关键 IPC、SQLite 存储、Codex Skill 文件、文档文件和 Excel 安全策略。
- `npm audit --omit=dev`：生产依赖漏洞审计。
- `npm run package:dir`：生成 Windows 可运行目录包。
- `npm run package:portable`：生成 Windows portable 单文件包。
- `npm run package:installer`：生成 Windows NSIS 安装向导。
- `scripts/package-fresh-user-validation.ps1`：生成可复制到 fresh Windows user / second machine 的验证 zip，包含 installer、portable、验证脚本、自校验脚本、说明和 SHA-256 manifest。
- `scripts/verify-fresh-user-bundle.ps1`：在外部验证包运行前校验 `SHA256SUMS.txt`，防止传输损坏或文件替换。
- `scripts/validate-fresh-user-release.ps1`：在 fresh Windows user 或 second machine 上收集最后的 installer/portable/Skill/uninstall JSON 验收证据；配套人工记录见 `docs/FRESH_USER_RELEASE_VALIDATION.md`。

## 当前测试证据边界

`npm test` 目前包含 smoke / source contract 验证、`tests/electron-governance-e2e.test.cjs` 最小 Electron governance e2e 探针，以及 `tests/electron-visual-behavior-e2e.test.cjs` 这个 bounded renderer DOM behavior e2e。两类 Electron 探针都以 probe 模式禁用 GPU、隐藏窗口并隔离 `userData` / `CODEX_HOME`；visual behavior e2e 会通过真实 preload/main IPC seed fixture，reload renderer，再点击真实导航并检查项目卡片/项目详情、Tools 卡片安全边界、Memory/Experience curation UI、retrieval explanation DOM、老线程自动体检入口和 archive candidate / host-bridge queue 边界文案。该 e2e 现在会跑默认桌面窗口和 980px 窄桌面窗口，并对 Projects、Tools、Memory、Smart Optimization、archive candidate 面板做横向溢出检查。它仍不是完整人工视觉验收，也不能证明 Thread History Vault、所有 Agent retrieval 排序、Codex 宿主侧栏归档、clean-machine 安装路径或端到端真实用户工作流已经完成行为级验收。对外宣称时仍应把这些范围标为 MVP heuristic、bounded governance e2e 或 host-bridge boundary。

2026-06-19 safe auto history ingest adds `tests/codex-thread-history-auto-ingest-policy.test.cjs` to default `npm test` for raw session -> vault/hash/pointer, repeated idempotent ingestion, recent-session `preserved_not_archive_ready` evidence, and startup-style early traversal bounding that stops after the limited batch instead of statting the whole historical tree. `tests/archive-candidate-policy.test.cjs` now also covers active/current preserved threads being excluded from archive queue while cold inactive vaulted threads remain eligible.

2026-06-19 Memory Runtime contract adds `tests/memory-runtime-policy.test.cjs` to default `npm test` for RuntimeContextPacket shape, bounded metadata-first precedent retrieval, compact evidence writeback receipts, private FlowSkill-ready candidate queueing/listing, unsafe/no-source downgrade or rejection, WorkingMemoryRecord persistence, and fail-closed promotion candidates that do not install, execute, archive, mutate raw sessions, or public-export FlowSkill material.

2026-06-19 Memory Runtime lifecycle probe adds `tests/memory-runtime-lifecycle-e2e.test.cjs` to default `npm test` as a product-level local contract loop: compact context retrieval, metadata-first precedent retrieval, WorkingMemoryRecord active-to-accepted lifecycle, accepted source-backed evidence writeback, private review-only FlowSkill candidate listing, idempotent repeat writeback, and no-source reusable evidence staying review-only. The probe uses temp app-owned storage and in-memory fixtures only.

2026-06-22 Memory Runtime fast recall adds a pure `MemoryRouterPlan` layer to `tests/memory-runtime-policy.test.cjs` and `tests/memory-runtime-lifecycle-e2e.test.cjs`: task goals are classified into small retrieval profiles, topK/token/time budgets are clamped, hot/warm/cold layers are labeled, cold history stays pointer-only, raw session bodies stay off by default, and returned RuntimeContextPacket data includes `routerPlan`, `hotState`, bounded `memoryGraph`, `performance`, `cacheKey`, and `expiresAt`. The regression explicitly asserts that this router starts no timers, does not scan vaults, runs no AI summaries, uses metadata-first/no-full-text reads, marks time-budget overruns as partial, rejects invalid-only allowedKinds instead of falling back, and leaks no raw/base64/secret/long-log sentinels.

2026-06-25 ThreadRecoveryPacket adds focused policy/smoke coverage for `memoryRuntime:recoverThread`: a broken/archived/slimmed thread can be recovered from threadId/title/projectPath into a compact packet containing lineage, vault manifest pointers, recommended project docs, cold-history sourceRefs and a replacement-thread prompt. Tests assert the packet is pointer-only, has `readByDefault=false` for raw session sources, does not include raw session body text, warns when vault/lineage is missing, and exposes IPC/preload/type contracts. This is an explicit CEO Flow/bootstrap hook, not a background vault scan. The packaged `zhixia-local-docs` helper also supports `--recover-thread` for CEO Flow lanes that cannot call Electron IPC directly; helper recovery is workspace-metadata-only and must not walk Thread History Vault or read raw/vault session bodies. The old-thread UI exposes a selected-thread "生成接续包 / 复制接续包" flow and must state that raw/vault session bodies are not read by default.

2026-06-26 Memory Runtime persisted graph revision adds exact-thread recovery guards: `tests/memory-runtime-policy.test.cjs` asserts exact `threadId` activation outranks broad project keyword matches, smoke asserts same-name Codex worktree project aliases, exact `threadId` seed inclusion, and explicit `activate_memory` SQLite persistence. A local hidden Electron E2E probe must be used for real Refmuse Game Studio data: querying `public-thread-id` with canonical `C:\Users\example\Documents\2D游戏项目` must return the old CEO thread knowledge item, thread lineage index, and thread node while reporting metadataOnly=true, rawSessionBodyRead=false, and scansVault=false.

2026-06-19 performance hotfix updates default smoke/source gates and `tests/document-metadata-policy.test.cjs` for large-library startup behavior: default document list SQL is metadata-first and exposes `contentLength` without `contentText`; startup Codex history auto-ingest is deferred/daily/tiny-batch; automatic watch/change detection defaults off after the performance-safe migration; project overview derivation must use a `documentsByProject` map instead of per-project full document filtering.

2026-06-19 project detection productization adds smoke/source guards for explicit `project | lead | non_project` classification. Top-level project cards must filter to real projects, noisy/generated/dependency/vault/clipboard/screenshot-like paths must be demoted, low-confidence entries must appear only as “待整理线索”, and project view must not fall back to the first raw workspace after demotion.

2026-06-19 packaged `zhixia-local-docs` lifecycle helper adds `tests/zhixia-local-docs-helper.test.cjs` to default `npm test` for backward-compatible `--query --limit --json`, explicit `--runtime-context`, bounded `--precedent`, `--writeback-dry-run --evidence-json`, sourceRefs, giant Markdown tail bounding, and raw-session/base64 redaction.

Fresh-user / second-machine release signoff is intentionally outside default `npm test`. Use `scripts/package-fresh-user-validation.ps1` to create the transfer bundle, then run `docs/FRESH_USER_RELEASE_VALIDATION.md` and `scripts/validate-fresh-user-release.ps1` after package artifacts are refreshed.

## P1 行为测试矩阵

- Thread History Vault：构造临时 session JSONL，验证入库会复制完整 raw session、`originalSha256 === copiedSha256`、写出 manifest / hot-warm-cold pointer；hash 不一致时必须失败且不触碰原 session。
- Compact gate：模拟 Guardian receipt，验证缺少 Vault、`thread_store_compatible !== true`、threadId 不匹配、receipt 缺 hash 或备份路径时，Electron 主进程必须拒绝成功态。
- Agent retrieval：用临时 SQLite/fixtures 验证 `project_record`、`ceo_flow_record`、SQLite-backed `thread_lineage_index`、`tool_skill_record`、`parentCeoThreadId`、topK、token budget、cache hit 和 metadata-only / compact-row reads；不能靠全量 `contentText`、敏感配置正文或 raw session 扫描通过。`thread_lineage_index` 必须声明 no raw session body 和 no archive/compact/restore/delete mutation boundary，并在 persisted lineage rows 改变时刷新 cache key；`tool_skill_record` 必须声明 advisory-only、human confirmation required 和 no install/enable/execute/active-promotion boundary。
- Memory Runtime contract：用 policy fixtures 验证 `retrieve_context` 返回 RuntimeContextPacket-shaped result 和 sourceRefs / freshness / tokenEstimate，`retrieve_precedent` 只读取 metadata-first bounded kinds，`recover_thread` 返回 ThreadRecoveryPacket-shaped result 和 lineage/vault/project-doc/cold-history pointers，`MemoryRouterPlan` 会按 task goal/queryType 选择 hot/warm/cold profile、夹住 topK/token/time budget，并在 packet 中返回 `routerPlan`、`hotState`、bounded `memoryGraph`、`activatedMemory`、`memoryLayers`、`performance`、`cacheKey`、`expiresAt`；该路由层不得启动后台定时器、不得扫描 Vault、不得运行 AI 摘要或全局图谱重建，默认不得读取全文/raw body。持久 `memory_graph_nodes` / `memory_graph_edges` 只能从 compact metadata 派生，`memoryRuntime:activateMemory` 必须按 taskGoal/projectPath/threadId 做 bounded activation、一跳邻居扩散和显式轻量缓存落盘；同名 Codex worktree alias 与精确 `threadId` 必须进入种子池，精确 threadId 召回优先级必须高于泛项目关键词。Refmuse Game Studio fixture 必须能激活项目节点、CEO/thread lineage、Thread History Vault pointer 和经验卡，并声明 rawSessionBodyRead=false；真实数据探针还必须证明 `public-thread-id` 可按 canonical projectPath 召回。底层允许 metadata-first bounded row reads，不能用“完全不读数据库 metadata”作为验收口径。invalid-only allowedKinds 必须返回空 allowedKinds/partial/warning，不能回退到默认 broad retrieval；allowed kind 如果携带 raw-session/secret sourceRef，也必须 fail-closed 丢弃。`writeback_evidence` 持久化 compact receipt 并对 accepted source-backed reusablePattern 生成私有 review-only FlowSkill-ready candidate packet / queue item；重复相同 packet 必须 id/hash 稳定且不重复写多条；revise/block 默认只生成 MemoryCard/pitfall candidate；no-source / raw-session / secret / destructive intent 必须降级或拒绝。WorkingMemoryRecord 支持 active/waiting_review/blocked/accepted/superseded，`promote_memory` 对 FlowSkill/public-export/install/execute 路径保持 candidate/review 和 no-op effects。`tests/memory-runtime-lifecycle-e2e.test.cjs` 还会把这些 policy helpers 串成单个本地 lifecycle probe，确保 raw_session fixture、raw-backed allowed kind、巨型 Markdown 尾部、base64、credential/private-key、long-log 和无 sourceRefs reusable evidence 不会突破默认边界。
- Codex Skill lifecycle helper：用临时 `.codex-knowledge` fixtures 验证 `read-project-knowledge.cjs` 的 legacy JSON、RuntimeContextPacket、RuntimePrecedentPacket 和 EvidenceWritebackPacket dry-run 输出；默认输出必须保留 sourceRefs、预算元数据和 warnings，同时排除 raw session 路径、base64 payload 和 giant Markdown 尾部。
- Archive Candidate / Queue：用 fixtures 覆盖 `active/running`、最近写入、无 Vault、hash 失败、pinned/keep hot、已有 receipt、项目 paused/completed、CEO 创建线程 3 天冷却、CEO 主线程 30 天保留、归属不明线程先入库后归档；扫描入口必须覆盖 Guardian `largest_session_files` 和 inventory hot sessions，防止小型但过期的 CEO 子线程漏扫。回归测试必须防止主按钮重新退回只扫 20 条、防止归档队列重新退回 50 条截断、防止已入库候选缺少 vault manifest/session/hash 证据而无法排队。大库场景必须允许 old-thread knowledge item 走 Thread History Vault sidecar fallback，避免 512MB+ `sql.js` 整库导出触发 `memory access out of bounds`。归档队列必须要求 vault 等安全证据，并声明真实侧栏归档需要 Codex 宿主桥接；默认不得 delete/restore/raw-session mutation。大线程保留 compact receipt evidence，小型过期 CEO 子线程可在 vault/hash 通过后进队列。
- UI 状态流：`tests/electron-visual-behavior-e2e.test.cjs` 已覆盖简化主导航、项目卡片总览、项目详情里的历史/知识/记忆、Tools 卡片安全边界、Memory/Experience curation、retrieval explanation、老线程自动体检入口和 archive candidate / host-bridge 边界文案的真实 Electron DOM 行为，并在默认桌面与 980px 窄桌面窗口检查主产品页面无横向溢出；source smoke 已覆盖 full backlog/remaining 文案，确保批次被截断时不得显示全量完成。后续仍需补真实一键安全减负成功/失败路径、宿主侧栏归档桥接回执、错误态不得显示“完成”等更完整 UI 行为。
- Large-library performance：默认 `documents:list` 必须 metadata-first，启动不得向 renderer 推送全量 `contentText`；选中文档正文必须通过 `documents:get` 按需读取。启动自动入库必须延迟、每日 cadence、小批次且 preservation-only；自动 watcher 默认关闭，开启后文件事件不得扫描全部 workspace roots。项目总览必须 map-based 派生，避免 projects × documents 级别重算。
- Project detection：项目页只展示高置信项目卡片。分类必须正向依赖 PRD/技术设计/测试计划/README、Codex 项目历史、知识/记忆、多个相关来源等组合证据；单条链接/截图/视频/剪贴板、依赖/构建/备份/vault/生成知识目录、孤立工具或 Skill 记录不得成为普通项目卡片。低置信但可能有关联的资料进入“待整理线索”。
- Project / CEO Flow 记录：用固定文档、经验卡和 handoff fixtures 验证 ProjectRecord / CEOFlowRecord 是启发式运行时视图，并正确暴露 source refs、freshness 和 planned/governance 缺口提示。
- Codex 工具与 Skill 资产图谱：`tests/tool-skill-inventory-policy.test.cjs` 用临时 `skills/`、`codex-skills/`、workflow script 和项目 `scripts/` fixtures 验证 ToolSkillRecord candidate 只读生成；`tests/agent-retrieve-policy.test.cjs` 验证 `tool_skill_record` 作为 compact metadata retrieval kind；`tests/smoke-test.cjs` 验证项目导出会写 `tool-skill-inventory.md/json`、`read-project-knowledge.cjs` 可按 `tool_inventory` 检索、主进程/预加载/类型/UI 提供 scan/read/confirm loop、一等工具页、per-record governance metadata 和 Agent retrieval support，且确认绑定 live inventory snapshot hash；不得读取 `.env`、token、完整 shell history 或 raw session，也不得自动安装/执行。

## 手工验收

1. 启动应用。
2. 点击“导入”，选择 `samples` 目录中的示例文件。
3. 点击“文件夹”，选择 `samples` 目录，确认递归扫描和批量导入可用。
4. 搜索 `合同`、`meeting`、`预算`、`API`。
5. 给一个文档添加标签并星标。
6. 切换“星标”和标签筛选。
7. 复制一个示例文件后再次导入，确认重复提示出现。
8. 修改一个已导入 TXT/MD 文件，点击“检测”，确认自动重建索引。
9. 删除或移动一个源文件，点击“检测”，确认缺失文件被标记为解析失败。
10. 在详情中点击“重建索引”，确认单文档重建可用。
11. 打开“设置”，确认数据库路径、索引统计和维护操作可见。
12. 在未勾选安装器 Skill 选项时启动应用，确认不会自动安装 Skill；再到设置页点击“安装 Skill”或“更新 Skill”复验。
13. 在详情页点击“导出给 Codex”，选择一个测试工作区，确认生成 `.codex-knowledge/context.md` 和 `sources.json`。
14. 点击“扫描并整理项目”，选择一个包含多个项目的父目录，确认“项目”页出现多个项目卡片。
15. 确认主导航为“项目 / 个人库 / 工具 / 智能优化 / 设置”，项目卡片页是唯一项目列表入口，左侧只显示当前项目摘要和扫描状态。
16. 拖动左侧栏右边缘，确认宽度可调整且刷新后保留。
17. 点击项目卡片进入详情，确认项目详情内能切换历史、知识、记忆、决策与交接，且 `project-resume.md`、`retrieval-packet.md` 或上下文总结排在项目资料前面。
18. 点击 README/PRD，确认右侧立即显示正文且长文档可以上下滚动。
19. 确认每个项目目录下生成 `.codex-knowledge/project-resume.md`、`retrieval-packet.md/json`、`project-index.md/json`、`project-chunks.jsonl`、兼容短索引 `project-knowledge.md` 和 `project-sources.json`，且 `project-knowledge.md` 不再是几万行巨型 Markdown。
20. 在已安装 Skill 目录运行 `node scripts/read-project-knowledge.cjs <workspace>`，确认优先返回 resume / retrieval packet / project index 的短结果，并且 excerpt 不直接暴露 `SourcePath`、`SourceHash`、`RawSessionPolicy`、`TokenEstimate` 等工程治理行。
21. 重新扫描已生成 `.codex-knowledge` 的项目，确认 `retrieval-packet.*`、`project-index.*`、`project-chunks.jsonl`、`knowledge-items.*`、`experience-cards.*`、Thread History Vault 文件和 Guardian `_indexes` 不会被当作普通项目文档再次写入索引正文。
22. 修改工作区中的 `docs/PRD.md` 后重新扫描，确认同路径更新可用。
23. 打开设置页，确认“后台自动监听源文件和 Codex 项目变更”默认开启，状态栏显示监听目录数量。
24. 修改一个已导入 TXT/MD 文件，等待后台监听提示，确认文档列表和正文自动更新。
25. 在已扫描 Codex 项目中新建或修改 `docs/*.md`，等待后台监听提示，确认项目文档、`retrieval-packet.md`、`project-index.md/json`、`project-chunks.jsonl` 和兼容 `project-knowledge.md` 自动刷新。
26. 关闭后台监听开关，再修改文件，确认不会自动刷新；手动点击“检测变更”仍可更新。
27. 使用包含万级记录或约 200MB SQLite 的知识库启动应用，确认启动和后台 watcher 状态查询不会触发 `sql.js` wasm `memory access out of bounds`；监听失败时会自动关闭 `autoWatchChanges` 而不是反复崩溃。
28. 进入项目详情的“知识”分区，点击“整理”，确认生成知识条目、分类计数和来源路径可见。
29. 在已扫描项目中确认 `.codex-knowledge/knowledge-items.json` 和 `knowledge-items.md` 已生成，内容是 compact 摘要和来源指针。
30. 打开设置页，确认 DeepSeek/OpenAI 兼容 Base URL、模型、API Key 输入框可见；已保存 key 不显示明文。
31. 未配置 API Key 时点击“AI 整理”，确认会本地降级或提示未使用网络，不阻断知识条目生成。
32. 如有测试 API Key，点击“测试连接”和“AI 整理”，确认只在手动点击后联网，项目导出不包含 API Key。
33. 打开设置页，确认“经验卡片”和“Skill 候选”计数可见，AutoFlow workflow 路径和 BUG_FIX_MEMORY.md 路径可配置。
34. 点击“导入 AutoFlow 经验”，确认只读导入完成后经验卡片计数增加，并生成/更新相关项目的 `.codex-knowledge/experience-cards.json`、`experience-cards.md` 和 `skill-candidates.md`。
35. 打开 Skill 候选列表，确认可以查看 draft markdown，且没有自动安装或覆盖任何 Codex Skill。
36. 在已安装 Skill 目录运行 `node scripts/read-project-knowledge.cjs <workspace> --query "经验" --limit 5 --json`，确认返回 retrieval_packet/project_index/context/knowledge/experience/skill 文件中的低 token 结果。
37. 打开主导航“工具”页和项目总览的 Tool/Skill Inventory 区块，确认自动发现结果默认是 candidate，卡片标题使用真实中文/可读工具名，简介展示用途、创建/更新时间、适用项目和来源；风险边界、safe/forbidden commands、source refs 与治理状态在详情中可查看。能刷新/扫描并确认当前 live inventory snapshot；对单条候选执行 confirmed/rejected/deprecated/blocked/clear 后刷新仍保留治理 metadata，来源或 context hash 变化后显示 stale，且没有自动安装、启用、执行或提升候选状态。Agent retrieval 查询 `tool_skill_record` 时只返回 compact advisory metadata，并把 stale per-record governance 显示为 review-needed。
38. 删除一条记录。
39. 导出知识库元数据 JSON。
40. 关闭应用后重新打开，确认记录仍在。
41. 通过 Windows“设置 > 应用”或开始菜单卸载知匣，确认安装目录、桌面快捷方式、开始菜单快捷方式被删除。
42. 卸载后确认 `%APPDATA%\知匣 Local Doc Knowledge`、`%APPDATA%\local-doc-knowledge`、`%LOCALAPPDATA%\知匣 Local Doc Knowledge`、`%LOCALAPPDATA%\local-doc-knowledge` 不再存在。
43. 卸载后确认 `%CODEX_HOME%\skills\zhixia-local-docs` 不再存在；如设置了 `CODEX_HOME`，确认 `%CODEX_HOME%\skills\zhixia-local-docs` 不再存在。
44. 重新运行安装器，不勾选“安装 zhixia-local-docs Codex Skill”，确认首次启动后不会自动安装 Skill。
45. 再次卸载后重新安装，勾选“安装 zhixia-local-docs Codex Skill”，确认安装完成后 Skill 已写入 `$CODEX_HOME/skills` 或 `$CODEX_HOME/skills`。
46. 未勾选安装 Skill 的场景下，打开设置页点击“安装 Skill”，确认可后续一键安装。

## 验收标准

- 应用可以正常打开。
- 文本类文件能导入并搜索到正文。
- 搜索片段能高亮关键词。
- 标签、星标、删除和导出功能可用。
- `.xlsx/.xls` 被明确标记为暂不支持，而不是静默失败。
- 数据库文件为 `knowledge-store.sqlite`，旧 JSON 数据能被迁移。
- 文件夹递归导入、重复检测、变更检测和重建索引可用。
- 后台监听可自动发现已导入文档和 Codex 项目文档变更，并能关闭；大型库下 watcher 不会读取全部正文导致 sql.js 内存崩溃。
- Codex 上下文包导出和工作区扫描可用。
- Codex 工作区扫描能按项目归类，不再只显示散装文档。
- 项目分层知识 bundle 自动生成，Codex Skill 优先读取 `project-resume.md` 和 `retrieval-packet.md/json`，再读取结构化索引和短 chunks；`project-knowledge.md` 仅作为兼容短索引。
- 知识页可生成并展示项目知识摘要，分类、摘要、来源路径、source hash、provider/model 和状态可见。
- 可选 AI Provider 配置不会明文回显 API Key；未配置或调用失败时能降级为本地整理。
- 项目目录可生成 `.codex-knowledge/knowledge-items.json` 和 `knowledge-items.md`，且不包含大文件全文或密钥。
- AutoFlow completion、BUG_FIX_MEMORY 和 agent family memory 可被只读导入为 compact 经验卡片，不复制完整日志、聊天记录、会话文件或密钥。
- 项目目录可生成 `.codex-knowledge/experience-cards.json`、`experience-cards.md` 和 `skill-candidates.md`。
- Skill 候选只生成草稿，默认不自动安装、不自动启用。
- Skill 检索脚本可读取 retrieval packet、project index、兼容项目知识文件、任务上下文、知识条目、经验卡片和 Skill 候选，并支持 `--query`、`--limit`、`--json`。
- Codex 工具与 Skill 资产图谱 MVP 必须只读生成 ToolSkillRecord candidate，写出 `.codex-knowledge/tool-skill-inventory.md/json`，通过 IPC/UI 和一等工具页展示用途、触发条件、安装状态、适用项目、风险边界、safe/forbidden commands 和 source refs，支持 live inventory snapshot 级确认，支持 SQLite-backed 单条治理 metadata，并通过 `tool_skill_record` Agent retrieval 返回 compact advisory metadata；自动发现和检索不得安装、启用、执行工具，也不得保存凭据、读取敏感配置正文或 raw session。
- Memory Runtime contract MVP 必须通过 preload/IPC 暴露 retrieve_context、retrieve_precedent、writeback_evidence、WorkingMemoryRecord、只读 FlowSkill candidate list 和 promote_memory；默认 compact/metadata-first，不读取 raw session 或巨型 Markdown，不自动归档/瘦身/删除/移动/恢复，不自动安装、执行或公开导出 FlowSkill。
- `zhixia-local-docs` helper 必须能在 Codex/CEO Flow lane 中通过 `--runtime-context`、`--precedent` 和 `--writeback-dry-run` 输出 compact lifecycle JSON，保持 legacy `--query --limit --json` 兼容，并且不得读取 raw session、巨型 Markdown 尾部、base64 payload、凭据或自动运行 FlowSkill/归档/瘦身/安装/执行。
- `codex-skills/zhixia-local-docs/SKILL.md` 和 `agents/openai.yaml` 存在且通过烟测。
- 设置页 Skill 安装器可用，且打包产物包含 `codex-skills`。
- 安装器提供 Skill 安装授权选项，默认不安装；用户勾选后才安装。
- Windows 安装器可启动安装向导，并带自定义图标、桌面快捷方式和开始菜单快捷方式。
- 应用窗口、主 exe、桌面快捷方式、安装器、卸载器和安装器头部不再使用 Electron 默认图标。
- 如果覆盖安装后桌面仍显示旧图标，删除旧快捷方式或卸载旧版后重装，并重新检查 `0.8.1` 快捷方式。
- 卸载安装版时能干净删除知匣本地数据和自动安装的知匣 Skill；升级安装时不会误删数据。
