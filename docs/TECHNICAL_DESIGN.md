# 技术设计

## 架构

知匣采用 Electron + React + Vite：

- Electron 主进程负责文件选择、读取、解析、持久化和导出。
- Electron 主进程负责 Agent Runtime Monitor 的本机只读采样，包括进程、会话文件、Guardian 回执和知匣 vault 元数据。
- Preload 通过 `contextBridge` 暴露受控 IPC 接口，渲染进程不能直接访问 Node.js。
- React 渲染进程负责列表、搜索、标签、星标、详情和状态展示。
- 本地数据保存在 Electron `userData` 目录的 `knowledge-store.sqlite`。
- 首次启动会从旧版 `knowledge-store.json` 迁移数据；迁移后继续使用 SQLite 文件。
- 仓库内配套 `codex-skills/zhixia-local-docs` Skill，用于指导 Codex 使用知匣导出的上下文包并产出可被知匣扫描的文档。
- 应用图标来自 `assets/icon.svg`，构建前生成 `assets/icon.png` 和 `assets/icon.ico`，Windows 打包使用 `assets/icon.ico`。

## 数据流

1. 用户点击导入。
2. 主进程弹出文件选择器。
3. 主进程按扩展名解析文本并生成 `KnowledgeDocument`。
4. 同一路径重复导入时更新旧记录，保留标题、标签和星标。
5. 主进程计算文件 SHA-256、大小和修改时间，用于重复检测和变更检测。
6. 渲染进程拿到文档数组，在内存中完成过滤、搜索评分和片段高亮。
7. 标签、标题、星标、删除、重建索引、设置和导出都通过 IPC 写回本地 SQLite。

## SQLite 存储

当前使用 `sql.js`，数据最终落盘为 SQLite 文件。选择它的原因是避免 `better-sqlite3`、`sqlite3` 等原生模块在 Electron 版本和 Windows 打包中的重编译风险。

核心表：

- `documents`：文档元数据、正文、摘要、标签 JSON、文件哈希、重复来源、索引版本。
- `document_versions`：同路径内容变化前的版本快照，为后续差异对比和回滚保留基础数据。
- `knowledge_items`：从已导入文档整理出的分类知识条目。每条只保存 title、summary、短 body、category、tags、sourcePath、sourceHash、provider/model 和状态，用于用户查看与 Codex/AutoFlow 低 token 检索。
- `experience_cards`：AutoFlow completion、BUG_FIX_MEMORY、agent family memory、人工经验和项目文档沉淀的 compact 经验卡片。只保存摘要、短正文、标签、状态、来源路径和 source hash。
- `skill_candidates`：从经验卡片生成的项目级 Skill 草稿候选，保存 trigger patterns、draft markdown、证据 card id 和状态；不自动安装。
- Codex 工具/Skill 资产图谱已有 export + IPC/UI/snapshot confirmation + first-class 工具页 MVP：`electron/toolSkillInventoryPolicy.cjs` 可从 Skill/script/workflow 根目录生成 `ToolSkillRecord` 风格 records 和 `SkillInventory` 快照；项目知识导出会写入 `.codex-knowledge/tool-skill-inventory.md/json`；主进程提供只读 scan/read/confirm IPC，项目总览和工具页可确认当前 live inventory snapshot，并通过 `tool_skill_record_governance` 表保存 per-record confirmed/rejected/deprecated/blocked/clear metadata。
- Agent Runtime Monitor MVP 默认不持久化高频采样。后续如需要趋势图和卡顿事件记录，再增加 `runtime_process_samples`、`runtime_session_snapshots`、`runtime_incidents` 等表。
- 项目记忆回填需要新增或复用项目级索引结构，用于表达 ProjectRecord、CEOFlowRecord、ProjectArtifact、Project Resume Packet、ThreadRecord 和 ThreadArchiveReceipt。MVP 可先用 `knowledge_items` / `experience_cards` / markdown 导出承载，后续再独立建表。
- `settings`：应用设置键值。AI Provider API Key 只保存在本机，返回给前端前由主进程脱敏。

写入策略：

- 数据库在主进程内存中打开。
- 每次导入、更新、删除或设置变更后导出 SQLite 字节并原子替换数据库文件。
- 适合个人和小团队本地知识库；超大规模数据后续需要切换到原生 SQLite 或分片索引。
- 大库保护：当 `knowledge-store.sqlite` 达到约 512MB，或 sql.js 保存时抛出 `memory access out of bounds`，Codex 老线程入库不再强制写 `knowledge_items` 表，而是写 Thread History Vault 和 `codex-history-vault\knowledge-items\` sidecar 索引；这样 `一键安全减负` 可以继续保存历史和生成归档证据，不会因整库导出失败停在第一条。

## 文件夹导入和索引维护

- `documents:importFolder` 使用系统目录选择器，递归扫描支持扩展名。
- 扫描默认跳过 `node_modules`、`.git`、`dist`、`release`。
- `documents:checkChanges` 比较源文件大小和修改时间，变化文件自动重新解析，缺失文件标记为失败。
- `documents:reindex` 支持单个文档或全部文档重建索引。
- 重复文件按内容 SHA-256 判断，重复记录标记 `duplicateOf`，搜索排序中降权。
- 启动后默认开启后台监听：主进程从当前文档列表派生监听根目录，包含普通导入文档的父目录和 Codex 项目根目录。
- 后台监听使用 `fs.watch`，变更事件经过防抖后调用变更检测；已归档 Codex 项目会重新扫描并刷新项目知识文件。
- 设置项 `autoWatchChanges` 可关闭后台监听；preload 通过 `documents:watchStatus` 和 `documents:watchUpdate` 向前端暴露状态和结果。
- 为避免监听过多目录，监听根目录会去重、压缩父子目录，并限制在 80 个根目录内。
- 大型库下 `listDocuments()` 只返回 `contentText` 的有限预览，避免渲染列表或 watcher 通知一次性把完整正文读入 sql.js wasm 内存。
- `listDocumentMetas()` 通过 `documentMetadataPolicy.cjs` 构造 metadata-only SQL，把 `contentText` 替换为空字面量；对应 sql.js fixture 测试会插入大正文并验证 metadata 查询不会读取或返回正文。
- watcher 派生监听根、检测文件变化、统计项目时使用 `listDocumentMetas()` 元数据查询，不读取 `contentText`。
- watcher 刷新遇到数据库读取或扫描异常时会关闭所有 watcher、持久化 `autoWatchChanges=false`，并通过状态摘要标记 `disabled`，避免启动后反复崩溃。

## Codex 配套

- `codex:exportContext`：用户从详情页把当前文档导出到目标工作区 `.codex-knowledge/context.md`，同时写入 `sources.json` 来源清单。
- `codex:scanWorkspace`：选择一个 Codex 工作区或项目父目录，递归扫描支持格式，自动识别项目根目录，并按路径推断 `sourceType` 和 `artifactType`。
- `knowledge:generate`：把已导入文档整理为 `knowledge_items`。`mode=heuristic` 完全离线；`mode=ai` 仅在用户已配置 API Key 并主动触发时调用 OpenAI 兼容 Chat Completions。
- `knowledge:overview` / `knowledge:items`：向前端提供知识条目总数、分类计数、项目计数和列表。
- `knowledge:testProvider`：用当前 Base URL、模型和 API Key 做一次显式连接测试；不会在后台自动调用。
- `memory:importAutoflow`：只读读取可配置 AutoFlow workflow 路径，默认使用当前用户 `Documents\AutoFlow\workflow` 这一类本机示例路径，也支持通过设置或环境变量改为其他本地路径；它会把 completion ledger、completion 摘要文件、agent family memory cards 和可配置 BUG_FIX_MEMORY.md 压缩为经验卡片。
- 项目文档回填：项目知识导出前会从当前项目的 PRD、技术设计、测试计划、发布记录、报告、README 和 Codex 输出中生成 `project_doc` experience card candidate；默认只生成 compact 摘要、source path/hash 和标签，跳过 raw session 路径和 `.codex-knowledge` 生成物，避免把导出文件再次回填成记忆。
- ProjectArtifact MVP：主进程已有纯策略模块把 document metadata 规范成 `project_artifact` 检索项，标记 `current / needs_review / superseded`、`producedBy`、`producerThreadId` 和 source refs，并导出 `.codex-knowledge/project-artifacts.md/json`；当前仍是 metadata-only 启发式视图，不是独立持久表。
- `memory:overview` / `memory:experienceCards` / `memory:skillCandidates`：向前端提供经验卡片和 Skill 候选计数、列表和草稿查看。
- `tools:scanInventory`：已实现最小只读 IPC，扫描 `$CODEX_HOME/skills`、`$CODEX_HOME/skills`、项目内 `codex-skills/`、workflow scripts 和项目工具目录，生成 ToolSkillRecord candidate；默认不读取凭据、不安装、不执行。
- `tools:inventory`：已实现最小只读 IPC，向前端提供工具/Skill 资产候选列表、用途、触发条件、安装状态、适用项目、风险边界、source refs 和 live snapshot hash。
- `tools:confirmInventory`：已实现 snapshot 级确认，确认绑定当前 live inventory snapshot hash；hash 变化后回到待复核。该确认不把 candidate 提升为 active。
- `tools:updateRecordGovernance`：已实现单条 ToolSkillRecord candidate 治理 metadata 写入，支持 confirmed/rejected/deprecated/blocked/clear；记录同时保存 live snapshot hash 和 record context hash，来源变化后旧决策显示 stale 并要求复核。该 IPC 不安装、不启用、不执行、不提升候选状态。
- `skill:status`：检测内置 Skill 和用户 Codex skills 目录中的安装状态。
- `skill:install`：把随应用打包的 `codex-skills/zhixia-local-docs` 安装或更新到 `$CODEX_HOME/skills/zhixia-local-docs`，未设置 `$CODEX_HOME` 时使用 `$CODEX_HOME/skills`。
- `skill:reveal`：打开用户 Codex skills 目录。
- `runtimeMonitor:getSnapshot`：已实现只读 Codex-focused diagnostics snapshot，返回本机 agent 进程、Codex session/thread 元数据、知匣 vault/receipt/pointer 状态、observed facts、inferred attribution、uncertainty 和只读建议动作；当前不是 kill/cleanup/performance repair 接口。
- `codexGuardian:autoIngestHistory`：启动后和一键安全减负前可运行 preservation-only 自动入库。启动自动入库使用 `startupBounded`，按最近目录优先、限制目录读取和 file stat 数量，并在达到批次上限后提前停止，避免为了启动小批次遍历/排序整棵 `.codex\sessions` 历史树；用户主动的一键安全减负仍可请求更大批次。该流程只扫描本机 `.codex\sessions` 元数据路径、复制 session 到知匣 Thread History Vault、校验 SHA-256、写 `latest.json` / hot-warm-cold manifest / memory pointer / auto-ingest index；不会 compact、archive、move、delete、restore 或修改 Codex session 文件。未变化的 threadId/source path/size/mtime/hash 会返回 already-preserved，最近写入的线程只标记 `preserved_not_archive_ready`，不能进入归档队列。
- Memory Runtime contract IPC 已作为主进程薄层接入：`memoryRuntime:retrieveContext` 把现有 `retrieveAgentContext` 包装为 RuntimeContextPacket，`memoryRuntime:retrievePrecedent` 只从 accepted/reviewable KnowledgeItem、ExperienceCard、ProjectArtifact、ToolSkillRecord、SkillCandidate 和 hot/warm thread-history pointer metadata 中取 bounded precedent；默认不读取 raw session body、巨型 Markdown、截图或 base64。`memoryRuntime:writebackEvidence` 只把 compact evidence JSON 写入应用自有 `memory-runtime\evidence-writeback` inbox 并返回 hash receipt；无 sourceRefs 会降级为 candidate/review，raw-session、secret、archive/compact/delete/move/restore、install/execute/public-export 意图会 fail-closed。accepted 且 source-backed 的 reusablePattern / `writeback.flowSkillCandidate` 现在会生成私有 `memory-runtime\flowskill-candidates` review-only FlowSkill-ready packet，可通过 `memoryRuntime:listFlowSkillCandidates` 只读检查；该队列幂等按 task/input hash 覆盖，不运行 FlowSkill capture/promote/export/install，不公开导出，也不授权安装/执行。`WorkingMemoryRecord` 通过 `upsert/list/close` IPC 保存短期任务状态，`memoryRuntime:promoteMemory` 只排队 Memory/Experience/FlowSkill candidate metadata，不安装、导出或执行 FlowSkill。
- Memory Runtime lifecycle probe：`tests/memory-runtime-lifecycle-e2e.test.cjs` 使用 policy helpers 和临时 app-owned storage 证明上述合同能串成单个本地循环；probe 覆盖 context / precedent / working memory / writeback / private FlowSkill candidate listing / duplicate-safe writeback / no-source candidate downgrade，并断言默认输出不包含 raw_session item、raw session path 或巨型 Markdown 尾部。
- Large-library startup performance：主进程默认 `documents:list` 只返回 metadata 和 `contentLength`，renderer 首屏不再接收所有文档正文；`documents:get` 负责按选中文档读取完整正文。启动 Codex history auto-ingest 改为首屏后延迟执行，使用 daily cadence 和 tiny bounded batch，仍只做 copy/hash/vault preservation。自动来源检测和递归 watcher 经过 performance-safe migration 默认关闭；用户开启 watcher 后，文件事件只围绕变更路径/根做 debounce 后轻量检查，不扫描全部 workspace roots。项目卡片由 `documentsByProject` map 派生，避免项目数乘文档数的重复过滤。
- Project IA classifier：renderer 在已有 metadata/snippet 上对 workspace 分组做 deterministic classification：`project`、`lead`、`non_project`。高置信项目需要核心项目文档、多条 Codex 历史、知识/记忆或多个相关来源；依赖目录、构建产物、备份/vault、生成知识索引、截图/剪贴板/视频链接、单条导入资料和孤立工具记录会被降级。项目页只把 `project` 渲染成顶层卡片，`lead` 进入“待整理线索”折叠区，避免资料噪声污染项目 IA。
- 启动流程会读取 `autoInstallSkill` 设置，默认关闭；只有用户在安装向导中勾选安装 Skill 或在设置页主动开启后，才会自动安装/更新。
- 安装器勾选安装 Skill 时会调用主程序 `--install-skill-and-quit`，由应用自身执行同一套 Skill 安装逻辑，避免 NSIS 直接解析 asar。
- `sourceType`：`imported`、`workspace_file`、`codex_context`、`codex_output`。
- `artifactType`：`prd`、`technical_design`、`test_plan`、`release_notes`、`report`、`readme`、`context`、`markdown`、`document`、`other`。
- Skill 约定：Codex 优先读取 `.codex-knowledge/context.md`，需要来源时读取 `.codex-knowledge/sources.json`，生成文档放在 `docs/` 或 `README.md` 等知匣可扫描位置。
- 项目知识约定：扫描、知识整理或 AutoFlow 导入后自动写入分层 `.codex-knowledge/` bundle：`project-resume.md`、`retrieval-packet.md/json`、`project-index.md/json`、`project-chunks.jsonl`、兼容短索引 `project-knowledge.md`、`project-sources.json`、`project-artifacts.json/md`、`knowledge-items.json/md`、`experience-cards.json/md` 和 `skill-candidates.md`。Codex Skill 优先读取 `project-resume.md` 和 `retrieval-packet.md/json`，再按 query 读取 project index/chunks、ProjectArtifact、任务级 `context.md`、知识条目、经验卡片和 Skill 候选；`project-knowledge.md` 不再承载完整历史或长摘录。
- 工具资产导出约定：项目知识导出会写入 `.codex-knowledge/tool-skill-inventory.json` 和 `tool-skill-inventory.md`，内容只包含 compact 摘要、路径/source hash、用途、风险边界和确认状态，不包含 API key、token、完整环境变量或敏感配置正文。
- 打包配置包含 `codex-skills/**/*`，确保 portable 和目录包都带有配套 Skill。
- Skill 检索脚本：`codex-skills/zhixia-local-docs/scripts/read-project-knowledge.cjs` 可从工作区读取 `.codex-knowledge/`，支持 `--query <text>`、`--limit <n>`、`--json`，默认优先返回 resume、retrieval packet、project index、知识/记忆/工具短项，只输出短摘录，供 Codex 低 token 调用。该 helper 也提供 Codex/CEO Flow lifecycle 模式：`--runtime-context` 生成 RuntimeContextPacket-shaped JSON，`--precedent` 生成 metadata-first precedent packet，`--writeback-dry-run --evidence-json` 生成 EvidenceWritebackPacket-like 预览；输出仍只使用 compact sourceRefs，默认不读取 raw session、巨型 Markdown 尾部、截图/base64 或凭据，也不运行 FlowSkill capture/promote/export/install。

## 知识条目和 AI 整理

- 默认能力是本地启发式整理：按标题、摘要、正文、标题行、项目路径和标签推断 category，并生成 compact summary/body。
- 可选 AI 能力使用 OpenAI 兼容 `/chat/completions`，默认 Base URL 为 `https://api.deepseek.com`，模型可在设置页修改。
- AI prompt 明确要求输出 JSON、限制 summary/body 长度、禁止输出密钥、token、password、session 或聊天全文。
- 如果 AI 调用失败或未配置 API Key，主进程会降级为本地整理并把 `status=fallback`、短错误原因写入条目，用户仍能看到结果。
- `knowledge-items.md/json` 只导出 compact 摘要和来源指针，不把完整文档正文写入 `.codex-knowledge/`。

## AutoFlow 经验导入和 Skill 候选

- AutoFlow 导入是只读入口，不修改 workflow、OpenClaw、Claude Code 或 Codex 本体。
- 默认读取 `state/completion_ledger.json`、`output/completions/*.completion.json`、`output/completions/*.completion.md`、`state/agent_families/memory_cards.json` 和可配置 BUG_FIX_MEMORY.md。
- 导入过程按 source path 和 source hash 去重/更新，只保留 compact summary/body、tags、status、projectPath 和 provenance。
- 不导入 `runs/`、session、stdout/stderr、完整聊天记录、API key、token 或大型原始日志；文本进入数据库前会做基础敏感字段脱敏。
- 项目级 Skill candidate 只作为 `draft` 存储和导出，设置页可查看 markdown 草稿；安装仍只能通过现有用户授权的 `skill:install` 流程。

## Codex 工具与 Skill 资产图谱

工具与 Skill 资产图谱当前是 export + IPC/UI/snapshot confirmation + first-class 工具页 + per-record governance metadata MVP，不是完整记忆整理闭环。它和 `skill_candidates` 的区别是：

- `skill_candidates` 是从经验卡片生成的新 Skill 草稿。
- `ToolSkillRecord` 是用户已经拥有或做过的工具资产索引，包括已安装 Skill、项目内 Skill、插件/MCP 工具、workflow scripts、CLI helper、项目脚手架和测试/打包工具。

只读发现来源：

- `$CODEX_HOME/skills` 和当前用户 `$CODEX_HOME/skills` 下的 `SKILL.md`。
- 项目内 `codex-skills/`、`codex skill directory/` 或约定工具目录。
- AutoFlow/OpenClaw workflow scripts、Guardian helper、项目 `scripts/`、打包/测试脚本。
- README、PRD、技术设计、测试计划和经验卡中提到的工具名、触发场景和限制。

输出字段：

- 名称、类型、安装路径或来源路径。
- summary / useCases / triggerPatterns。
- inputs / outputs / safeCommands / forbiddenCommands。
- 适用项目、workspace path、维护者、状态、最后验证时间。
- sourceRefs、sourceHash、requiresHumanConfirmation。

安全原则：

- 自动发现结果默认 `candidate`，不能自动标记 active。
- 知匣不能因为发现某个工具就自动安装、更新、执行或授权。
- 不读取 `.env`、token、cookie、私钥、完整 shell history 或 raw session 正文。
- 对命令类工具只记录高层用途和风险边界，真正执行必须走用户或 CEO task card 的显式授权。

## 项目识别和知识提取

- 项目根目录识别标记：`.codex-knowledge`、`package.json`、`pyproject.toml`、`Cargo.toml`、`.git`、`README.md`、`docs`。
- 扫描会跳过 `node_modules`、`.git`、`dist`、`release`、`.next`、`out`、`build`。
- 文件按最近的项目根目录归类，避免扫描父目录时把多个项目混在一起。
- 项目知识 bundle 按分层组织：`retrieval-packet` 是默认短上下文，`project-index` 是结构化目录，`project-chunks.jsonl` 是机器检索短块，`project-knowledge.md` 只是兼容短索引。
- 分层 bundle 禁止把完整 raw session、截图/base64、大 JSON、日志或每篇文档长摘录复制进默认上下文。来源以 path/hash/documentId 指针保留。
- 前端从文档的 `workspacePath` 派生项目列表，不额外维护项目表，避免项目名和路径状态不同步。

## UI 交互

- 主导航采用简化产品入口：`项目 / 个人库 / 工具 / 智能优化 / 设置`。
- 项目页默认是项目卡片总览，卡片显示中文阶段、进度、总体介绍和历史/知识/记忆数量；点击卡片进入项目详情。
- 项目详情承载历史、知识、记忆、决策与交接，不再把 `历史 / 知识 / 记忆` 做成独立主导航。未知阶段显示为待整理想法，不直出 `prd/testing/unknown` 等内部枚举。
- 左侧栏只保留当前项目摘要、扫描入口和全局状态，避免和项目卡片列表形成两套项目入口。
- 个人库围绕用户转发链接和整理内容展示卡片，详情展示完整文案、总结和来源；图谱不作为默认可见能力。
- `工具` 是一等页，使用真实工具名做卡片标题，区分官方/全局与自建/项目内工具，并展示中文用途、使用项目、来源和安全边界；风险和治理细节默认折叠。
- 左侧栏默认 330px，可拖拽调整到 280-520px，宽度保存在 `localStorage`。
- 项目视图中 `project-knowledge.md` 和任务级 `context.md` 排在其他项目文档前面。
- 设置页只保留底层存储、后台监听、维护、AI Provider 和 Codex 连接；日常扫描、知识整理、工具治理和老线程优化应放在对应主页面。
- 智能优化页提供 Codex-focused MVP：普通用户主流程是一个 `一键安全减负` 按钮，自动合并大线程扫描和 Guardian inventory 中超过冷却期的 CEO 子线程扫描，保存完整历史、生成检索摘要、验 hash、瘦身大线程并生成宿主归档队列。当前主流程请求最多 1000 条候选，返回 full backlog / selected / remaining / unvaulted / vaulted 计数；若 remaining 大于 0，UI 必须按未完成批次展示。小型过期 CEO 子线程不强制瘦身，完成 vault/hash 后即可写入 Codex 宿主归档队列。实时 CPU/内存压力监控不再作为默认可见面板；相关采样接口保留为高级诊断/测试证据，不能成为默认自动刷新负担。

## Agent Runtime Monitor

Agent Runtime Monitor 已实现 Codex-focused read-only MVP，并采用平台适配器模型，避免把监控能力写死为 Codex 专用。

适配器分层：

- `CodexAdapter`：读取 Codex 进程、`.codex/sessions`、thread list、Guardian report、compact receipts 和 Thread History Vault。
- `ClaudeCodeAdapter`：当前显式标为 `process_only_planned_session_adapter`；只采样进程 metadata 和红action后的命令行，后续 fixture-backed session adapter 验收前不读取日志/session body。
- `OpenClawAdapter`：当前显式标为 `process_only_planned_session_adapter`；后续才读取 AutoFlow/OpenClaw state、leases、worker heartbeat、completion ledger 和报告。
- `GenericCliAdapter`：对 Cursor、Windsurf、Gemini CLI 和未知 CLI agent 只做进程级采样、平台支持状态标注和命令行脱敏。

采样原则：

- 高频 CPU/内存采样只保存在内存，避免监控本身造成 SQLite 写放大。
- session 检测默认只读 metadata、首行、文件大小、mtime 和轻量 pointer，不读取完整 JSONL。
- Runtime Monitor 会压缩并红action process commandLine / executablePath 中常见的 `api_key`、`token`、`secret`、`password`、Bearer 和 `sk-*` 片段；UI/报告只能消费红action后的 metadata。
- 对 Electron renderer CPU 的 threadId 归因必须给出置信度。Codex 进程命令行通常不含 threadId，因此只能结合 active thread、最近写入、systemError、session 增长和 UI 状态推断。
- 所有建议动作默认只读。结束进程、清理日志、恢复 session、compact-session 等动作必须走显式用户授权和既有安全合同。

详细产品和验收设计见 `docs/AGENT_RUNTIME_MONITOR_DESIGN.md`。

## 项目记忆回填与归档治理

项目记忆回填是把现有 documents 转化为可续接项目记忆的过程。它和普通全文索引不同：全文索引用于搜索文件，回填用于生成项目状态、完成度、下一步、知识条目、经验卡和线程归档状态。

输入来源：

- `documents` 中的 PRD、技术设计、测试计划、发布记录、报告、handoff、README 和 Codex output。
- `.codex-knowledge/project-knowledge.md`、`knowledge-items.md`、`experience-cards.md`。
- BUG_FIX_MEMORY、AutoFlow completion ledger、agent family memory。
- Codex Skill、插件、workflow scripts、项目工具和脚手架的只读资产候选。
- Thread History Vault hot/warm layer、compact receipts 和 Guardian thread context。

输出：

- ProjectRecord：项目状态、完成度、最后进展、下一步、阻塞项、关联 CEO/worker/reviewer 线程。
- CEOFlowRecord / ThreadLineageIndex：长期 CEO 维护线程、子线程员工、项目、任务、决策、验收、handoff、memory pointer 和 vault pointer 的关系索引。
- ProjectArtifact：当前有效文档、过期文档、需要确认文档。
- KnowledgeItem：项目架构、产品规则、接口约定、验收标准、权威文件。
- MemoryCard：Bug 修复、决策、交接、发布、用户偏好、模型/工具策略。
- ToolSkillRecord：Codex Skill、插件、workflow scripts、CLI 工具和项目脚手架的用途、触发条件和风险边界。
- Project Resume Packet：用于用户和 Codex 快速续接停滞项目。
- Archive Candidate / ThreadArchiveReceipt：用于老线程降温和归档治理。

实现原则：

- 默认不全量读取 raw session。
- 自动生成内容默认 `candidate` / `review`，避免污染权威记忆。
- 自动发现的工具/Skill 默认 `candidate`，用户确认后才可进入 active；知匣不自动安装或执行候选工具。
- 每条结果必须保留 sourceRef。
- ProjectArtifact 当前作为 `project_artifact` retrieval kind 从 document metadata 生成：PRD、技术设计、测试计划、发布说明、README、context 这类单例规范文档按同项目同类型最新标为 `current`，旧版本标为 `superseded`；报告和审计等证据文档不因同类型较新报告自动失效；生成的 `.codex-knowledge` 文件、解析异常、源文件变更和无法分类文档标为 `needs_review`。
- 归档候选只读生成；真正归档、瘦身、恢复必须显式用户触发。
- CEO Flow 只消费归档状态和 memory pointer，不运行后台归档器。
- 归档不删除完整历史。完整 raw history 必须先进入 Thread History Vault 或等价 source-backed archive；Codex 热路径只保留 compact pointer / receipt / hot summary，必要时再由知匣按 threadId、projectPath 或 query 召回。
- Archive Candidate 会归一化 Guardian optimized envelope、compact receipt、vault manifest/source refs 和 memory pointer 证据；如果 compact receipt 明确 `thread_store_compatible=false`，候选必须 fail-closed 为 `compact_receipt_incompatible`。
- 性能收益按证据表达。归档可能降低线程列表、session store 和长历史载入压力，但 Electron renderer CPU、鼠标卡顿和系统负载不能只按线程大小归因，Agent Runtime Monitor 必须显示事实、推断和置信度。

详细规划见 `docs/PROJECT_MEMORY_AND_ARCHIVE_PLAN.md`。

## Agent 检索扩容策略

归档和历史回填会扩大可搜索内容，因此 Agent 检索不能沿用普通 UI 搜索的全列表内存评分。

MVP 规则：

- 检索入口必须带 `queryType`，尽量带 `projectId`、`threadId`、`parentCeoThreadId` 或 `workspacePath`。
- 主进程先查结构化小索引：ProjectRecord、CEOFlowRecord、Project Resume Packet、KnowledgeItem、MemoryCard、ToolSkillRecord、ThreadRecord、ArchiveReceipt。
- 如果 query 命中长期 CEO 维护线程、专家员工线程、task id、handoff id 或验收报告，优先走 CEOFlowRecord / ThreadLineageIndex，再读取它指向的局部产物。
- 当前实现已把 `thread_lineage_index` 和 `tool_skill_record` 作为显式 Agent retrieval kind 接入：`thread_lineage_index` 由 ProjectRecord / CEOFlowRecord / KnowledgeItem / ExperienceCard metadata 派生，输出 relationship counts、sourceRefs、archive candidate blockers/evidence，并声明 `metadata_only_no_raw_body` 与 `read_only_no_archive_compact_restore_delete`；`tool_skill_record` 从当前 live Tool/Skill inventory 与 per-record governance 生成 compact advisory items，输出 status、reviewState、recordContextHash/sourceHash presence、sourceRefs、safe/forbidden command labels，并声明 human confirmation required、metadata-only 和 no install/enable/execute/active-promotion。
- 归档队列边界：`codexGuardian:generateArchiveQueue` 只写本机 JSON 队列和证据，不删除、不恢复、不直接移动 Codex session；队列项要求 Thread History Vault、非活跃/非最近写入等 fail-closed 条件。默认冷却期：CEO 创建线程 3 天，CEO 主线程 30 天，归属不明线程 3 天。`一键安全减负` 会先运行 automatic preservation pass 补齐缺失历史保险库证据，再只把 cold/idle eligible 线程送入归档队列；UI 分开展示自动保留、已保留、活跃跳过归档和归档队列数量。扫描结果会把已有 Thread History Vault 的 manifest/session/hash 证据透传给 queue evaluator，避免已入库候选被误判缺证据；大线程要求 compact receipt 作为瘦身证据，小型过期 CEO 子线程只要求 vault/hash/memory pointer/source refs。真实 Codex 侧栏归档由宿主桥接执行，不在 Electron App 内越权调用。
- 每一层返回固定 topK，并计算 `tokenEstimate`。达到预算后停止向下层扩展。
- `candidate/review/stale/superseded` 默认降权；`active/curated/ready/current` 默认升权。
- 工具/Skill 查询只返回用途和边界，不能把候选工具转化为自动执行计划；如果需要执行，必须由用户或 CEO task card 明确授权。
- cold/raw session 不进入默认查询计划，只能由 `thread_recovery`、restore dry-run、审计或显式用户请求触发。
- 相同 `queryType + projectId + threadId + parentCeoThreadId + queryHash + indexVersion` 的结果可以短期缓存。
- UI 搜索和 Agent 检索分离：UI 可以分页展示更多结果，Agent 只拿可解释的 compact context。

扩容方向：

- 中期使用 SQLite FTS5 或等价全文索引替代前端内存搜索。
- 大 Vault 使用分片 manifest、按线程/项目/日期范围读取，避免打开完整 raw history。
- 长耗时深搜进入独立 worker 或后台任务，先返回可用结果，再补充深层候选。
- 后续可增加本地 embedding 或 hybrid search，但必须保留 sourceRef、状态过滤和 token budget。

## Windows 安装包和图标

- `npm run package:installer` 生成 NSIS 安装向导。
- 安装器采用 per-user 安装，允许用户选择安装目录。
- 安装器创建桌面快捷方式和开始菜单快捷方式。
- NSIS 显式使用 `assets/icon.ico` 作为安装器、卸载器和安装头部图标，避免只配置应用图标时安装向导仍显示默认 Electron 图标。
- 当前机器无法解压 `winCodeSign` 包中的 macOS 符号链接，因此不能直接让 electron-builder 执行 exe 资源编辑。
- 打包流程采用两段式：先用 `signAndEditExecutable=false` 生成目录包，再通过 `scripts/apply-windows-icon.cjs` 调用缓存中的 `rcedit-x64.exe` 写入主 exe 图标，最后用 `--prepackaged release/win-unpacked` 生成安装器和 portable。
- `build/installer.nsh` 接入 `customUnInstall`，正常卸载时删除知匣 local app data、本地缓存和自动安装的 `zhixia-local-docs` Skill。
- `build/installer.nsh` 还接入安装向导自定义页，默认不勾选 Skill 安装；用户勾选后安装阶段调用 `--install-skill-and-quit`。
- 升级安装时 electron-builder 会给旧卸载器传 `/KEEP_APP_DATA`，自定义卸载脚本检测到该参数后保留用户知识库数据。
- 当前未做代码签名，分发到新机器时需要接受 Windows 安全提示。

## 支持格式

- 直接文本：`.txt`、`.md`、`.markdown`、`.csv`、`.json`、`.html`、`.htm`
- Word：`.docx`，使用 Mammoth 提取纯文本。
- PDF：`.pdf`，使用 PDFParse 提取文本。
- Excel：`.xlsx/.xls` 当前只保留元信息并标记失败原因；不接入已知审计风险较高的解析库。

## 当前限制

- 搜索索引仍是前端内存评分，不适合十万级文档。
- `sql.js` 避免了原生依赖风险，但大库写入会有整库导出成本。
- 没有 OCR、语义向量检索和问答。
- AI 整理只是可选摘要器，不是联网问答；用户必须显式配置和触发。
- 后台监听已接入，但网络盘、同步盘、极大目录和系统 watcher 丢事件场景仍需要手动检测兜底。
- 万级文档库已避免 watcher 全量正文读取，但前端搜索仍基于列表预览文本，后续需要更强本地索引或按需正文加载。
- Agent Runtime Monitor 已实现 Codex-focused read-only MVP，但尚未完成多平台适配、长期趋势持久化或完整 IPC/e2e 验收。即使实现 MVP，也不能保证把 Electron renderer CPU 100% 精确归因到某条线程。
- 项目记忆回填和归档治理已有 candidate/policy-level MVP：当前数据库已支持 project_doc / experience card candidates、Project Resume Packet、ProjectArtifact、Archive Candidate read-only evidence 和 bounded Agent retrieval；最新治理切片加入 source-signature-bound ProjectRecord confirmation、stale override gating、ExperienceCard rejected/stale states 和 retrieval freshness review gate。完整持久化治理、批量人工确认、ThreadLineageIndex 权威关系图、richer MemoryCard curation 和 e2e 覆盖仍未完成。
- Codex 工具与 Skill 资产图谱已完成 export + IPC/UI/snapshot confirmation + first-class 工具页 + SQLite-backed per-record governance metadata + Agent retrieval integration MVP：当前可生成只读 ToolSkillRecord candidate / SkillInventory 快照，随项目知识写入 `.codex-knowledge/tool-skill-inventory.md/json`，可被 `read-project-knowledge.cjs` 作为 `tool_inventory` kind 检索，并可在项目总览和工具页确认当前 live inventory snapshot，也可对单条候选标记 confirmed/rejected/deprecated/blocked/clear；`tool_skill_record` retrieval 只返回 compact advisory metadata，stale governance 显示为 review-needed，不授权执行。
- 自动判断项目完成度和下一步存在误判风险，必须提供人工确认、改写、归档和拒绝入口。
- 尚未代码签名；安装器和应用图标已接入，但仍需要在真实外部机器上验收 Windows 图标缓存表现。
