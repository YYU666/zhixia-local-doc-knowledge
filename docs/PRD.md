# 本地文档知识库桌面软件 PRD

## Memory Core 已交付基线（2026-07-16）

本节是当前 Memory Core 的权威产品状态。它描述已经进入应用、packaged helper、CEO Flow 合同和自动化测试的完整能力，不再按 speculative MVP 表述。文档后续仍保留的 `MVP` / `planned` 字样，若涉及 ProjectArtifact 单条治理、旧线程宿主归档桥接或历史兼容流程，不代表 Memory Core 本身尚未交付。

### 产品目标

Memory Core 让知匣从“文档索引和记忆候选集合”升级为本地优先的项目连续性运行时：

- 只把经过身份、scope、生命周期、来源和权威回执校验的内容当作当前真值。
- 用固定的项目连续性账本恢复项目身份、原始目标、架构、规则、进展、任务、阻塞、失败、下一步和线程接续。
- 在 CEO Flow 的关键事件上按需检索和写回，不依赖每回合查询、分钟级 heartbeat 或启动时全库扫描。
- 默认只处理 compact metadata 和 source refs；原始会话、完整聊天、巨型 Markdown、图片/base64、凭据和长日志不进入默认召回。

### 已实现能力

1. **Authority Core 和不透明 provenance 边界**
   - 角色与 capability 覆盖 owner、user、CEO、worker、reviewer、service、guardian 和 FlowSkill。
   - scope 支持 global、project、private、shared、restricted；项目 scope 必须匹配受信 project id/path binding。
   - `accepted` / `curated` 需要直接 source refs 和 app 内 Owner 权威回执；agent 不能自我批准。
   - trust context、受信 principal/envelope/decision/rule 只存在于应用组合根的不透明对象注册表中。调用方 JSON、对象 clone、伪造选项或 helper 输出不能恢复这些 capability。
   - HMAC 签名回执绑定 principal、owner、action、transition、target、scope、project、有效期和事件 nonce；篡改、跨 target/scope/principal replay、撤销、过期和 supersede 均 fail closed。

2. **ProjectBrain 和 14-slot Continuity Ledger**
   - 固定槽位：`project_identity`、`original_product_goal`、`architecture_anchors`、`standing_rules`、`active_modules`、`current_phase`、`accepted_progress`、`open_tasks`、`open_blockers`、`latest_failures`、`next_actions`、`thread_lineage`、`canonical_docs`、`last_valid_checkpoint`。
   - 每个槽位区分 `filled`、`missing`、`stale`、`conflict`，并保留 review-only candidate。
   - 长期锚点、未完成任务和明确 `noDecay` 项不会因 top-K 或时间衰减丢失。
   - mandatory manifest 使用稳定 fingerprint 和 opaque deterministic v2 cursor 完整分页；cursor 绑定精确 manifest、严格 offset 和此前全部 mandatory descriptors 的 chained prefix digest。只有所有 mandatory 页顺序读取完成、无未满足槽位且 app verifier 通过时，才允许 `recoveryReady=true`。

3. **Episode Formation 两阶段形成**
   - 第一阶段生成 deterministic preview、event fingerprint、episode/decision/constraint/checkpoint candidate，不提交 current authority。
   - 第二阶段只对 app-owned、低风险、确定性、同项目/模块 direct-source-backed 事件签发精确回执，再持久化 accepted episode 及其派生记录。
   - 相同事件复用同一 signed receipt 和幂等写入；revise、block、用户纠正、失败、非确定性或来源不足事件保持 review。

4. **Memory Runtime 生命周期与 IPC**
   - 已接入 `retrieve_context`、`retrieve_precedent`、`recover_thread`、`observe_event`、`writeback_evidence`、Working Memory、MemoryFact、promotion review、trigger receipts、评测、continuity、review queue 和 diagnostics。
   - authority filtering 在相关性排序之前执行；FTS5/BM25F 只在已授权候选上做 bounded rerank。
   - accepted 且 source-backed 的 writeback 可形成 typed temporal MemoryFact；同一 subject/predicate 的新事实通过 valid-time 和 `supersededBy` 保留历史。

5. **`node:sqlite` sidecar 和迁移**
   - sidecar 包含检索索引、FTS5、trigger receipts、temporal facts，以及 principal、project binding、standing rule、authority receipt、ProjectBrain、ProjectAnchor、ModuleMemory、Episode、Decision、Constraint、ProjectCheckpoint 表。
   - schema 采用非破坏式建表/加列/建索引；不兼容主键拒绝自动重建。
   - legacy authority receipt migration 在事务内校验 payload 和精确 proof，完成回填后建立唯一索引；重复 proof 或不明 fingerprint 会回滚并报错。

6. **显式扫描的 deterministic ProjectBrain backfill**
   - 只有用户显式执行 Codex 工作区扫描时才 seed Memory Core。
   - seed 仅使用可解析的原始项目文档 metadata、hash、artifact type 和文件时间；排除 `.codex-knowledge`、raw session、vault、JSONL、图片和正文 payload。
   - 未确认项目不会猜测 active phase 或模块；重复扫描不变时为 noop，源文件变化时稳定更新同一 ProjectBrain 和 identity anchor。

7. **packaged helper 模式**
   - 支持 file-contract query、runtime context、precedent、thread recovery、CEO takeover、thread pressure、writeback dry-run、Memory Core continuity、review queue 和 diagnostics。
   - helper 可以只读 sidecar、执行 tamper-evident cursor 分页并返回 compact source-backed metadata。
   - helper 没有应用内部 trust context 和签名 verifier，因此 sidecar 中看似 current 的记录必须标为 `authorityVerification=unavailable` / advisory；即使分页完成也不能声称 `recoveryReady=true`。

8. **CEO Flow event-triggered Continuity Gate**
   - 在 bootstrap/takeover/recovery、新模块或 writer lane、改变长期锚点的重大 accept、用户报告漂移或错误恢复信心时触发。
   - 普通状态更新、callback polling、同一模块内未变化工作和每回合对话不触发。
   - CEO 全恢复需要 14 槽完整分页；worker/reviewer 使用角色相关子集。达到页数/token 上限、cursor 无效、source 截断或 provider 失败时必须保持 partial，不能宣称完整恢复。

### 当前 UI 行为

已实现：

- 项目页“项目记忆”在首次打开项目时并行读取 diagnostics、完整 continuity status、continuity 首屏和最多 8 条 review queue 预览。
- 展示连续性覆盖率、恢复状态、待补全/冲突数、待复核数、最重要下一步和全部 14 个槽位。
- 只展示首屏中 `accepted` / `curated` 的可信来源摘要，不展开内部编号和真实本机路径。
- “为什么会想起这些内容”每次打开项目记忆页只运行一次，最多 4 条、700 tokens。
- “智能优化”页展示 Memory Runtime trigger receipt、当前/历史 MemoryFact 数量、本次耗时/返回数/token 和 FTS5 + BM25F 按需运行状态。

仍保持只读/后续治理：

- 项目记忆页不直接执行 approve/reject/merge；这里只做 continuity、来源摘要和 review preview。现有专门治理入口继续承接人工确认。
- UI 不把 helper advisory continuity 显示成 app-authenticated recovery-ready。

### 已知 P3

- `node:sqlite` 在当前 Node 版本仍标记为 experimental；需要持续跟随 Node/Electron 稳定性。
- Windows 私钥文件目前依赖应用私有目录和文件 ACL/权限模式；尚未升级为 DPAPI 封装。
- packaged helper 无法独立认证完整恢复，必须由 app verifier 才能得到 `recoveryReady=true`。
- 大型 continuity manifest 已有 bounded 分页和 5 秒级测试上限，但产品目标仍是把大项目完整 continuity 延迟稳定到更低目标。

## 1. 产品定位

产品名：知匣 Local Doc Knowledge

知匣是一款运行在 Windows 本地的文档知识库桌面软件，同时配套 Codex Skill 使用。它面向个人和小团队，用于把散落的本地资料、Codex 上下文包和 Codex 生成文档统一导入本机，建立可搜索、可归类、可摘要浏览、可再次供 Codex 使用的离线知识库。

随着用户长期使用 Codex、Claude Code、OpenClaw、AutoFlow 等本地 agent 工具，知匣还需要承担“项目知识编辑部 + 本地 Agent 控制塔”的角色：把文档管理、项目状态、CEO/worker/reviewer 线程产出、知识记忆、线程历史、运行状态、CPU/内存压力和可执行建议放在同一个可解释系统里，让用户知道每个项目是什么、做到哪、为什么停下、下一步怎么续上，以及哪个 agent、哪个项目、哪条线程或会话可能在拖慢系统。

产品形态：

- 开源桌面软件：负责本地导入、解析、索引、搜索、标签、星标、版本记录、上下文包导出和 Codex 产物归档。
- Codex Skill：负责指导 Codex 在用户工作区中读取知匣导出的上下文包、生成文档、维护来源引用，并把生成产物放回知匣可扫描的位置。
- 项目知识编辑部：负责把散落文档、Codex 产物、CEO/worker/reviewer 线程报告整理为项目档案、当前有效文档、过期文档、知识条目、记忆卡、完成度和续接包。
- Agent Runtime Monitor：负责观察本机 agent 进程、线程/会话文件、运行状态、历史体积、日志压力和知匣入库/瘦身状态；它不是通用任务管理器，而是面向 agent 工作流的诊断和治理面板。
- Codex 工具与 Skill 资产台：负责整理用户在 Codex 生态里做过或安装过的工具、Skill、插件、脚本和工作流，说明它们“做什么、何时用、属于哪个项目、是否可安全调用、由谁维护”，让工具资产也进入项目记忆，而不是散落在聊天和目录里。

两者是配套关系：知匣提供本地可信资料和产物管理，Codex Skill 提供可重复的文档生成和归档工作流。

核心原则：

- 本地优先：文档、索引、标签和阅读记录默认只保存在本机。
- 无广告：不内置广告、推荐流、推广弹窗。
- 可解释：搜索结果展示命中文档、片段和基础统计，不伪装成“全知 AI”。
- 可审计：AI 整理只生成 compact 知识条目并保留来源指针，不替用户隐藏来源或复制大文件全文。
- 可发布：交付 Windows 桌面应用和打包产物。
- 可配套：桌面端和 Codex Skill 使用同一套上下文包约定，避免每次项目从零开始。

## 2. 目标用户

1. 个人知识管理用户：需要整理 PDF、Word、Markdown、TXT、表格等资料。
2. 小团队运营/行政/财务：需要快速查找合同、报价、说明书、会议纪要。
3. 开发/产品人员：需要在本地检索需求文档、技术文档和历史资料。
4. Codex 重度用户：需要管理 Codex 生成的 PRD、技术设计、测试计划、报告和发布说明。

## 3. 用户痛点

- 文档散落在多个目录，靠文件名很难找内容。
- 在线知识库有隐私风险，上传合同/财务资料不放心。
- 普通文件搜索不能按标签、摘要、导入时间、内容片段组织。
- 大模型问答很吸引人，但第一步必须先有可靠的本地索引。
- Codex 生成的文档散落在多个工作区，缺少统一归档、版本和二次检索。
- Codex 每次生成文档时缺少稳定上下文包，容易重复解释背景、丢失来源引用。
- Codex/Claude Code 等 agent 卡顿时，普通任务管理器只能看到进程 CPU/内存，用户不知道是哪条线程、哪个项目、哪段历史或哪个错误状态造成压力。
- 旧线程优化后仍可能出现鼠标卡顿、renderer 高 CPU 或 systemError 线程残留，需要一个能把“进程压力 + 线程历史 + 知匣优化证据”合并解释的工具。
- 很多项目停了很久后，用户打开目录只看到一堆文件，不知道当前完成度、最后 CEO 结论、哪个文档有效、下一步该做什么。
- 长期 Codex 使用产生了大量 PRD、报告、修复记录、交接和线程历史，但如果不自动回填成知识/记忆，Agent 检索仍然只能全量翻文档，既慢又容易误召回。
- 用户在 Codex 里会逐渐积累自写工具、Skill、插件、AutoFlow 脚本和项目脚手架，但这些资产的用途、触发条件、维护状态和适用项目常常只存在于聊天记忆里，换线程或换电脑后很难复用。

## 4. MVP 范围

### 4.1 必须实现

- Windows 桌面应用壳。
- 选择本地文件并导入知识库。
- 支持解析 `.txt`、`.md`、`.json`、`.csv`、`.html`。
- 支持 `.docx` 文本解析；`.xlsx/.xls` 在 MVP 中保留文件元信息并标记暂不支持原因。
- 本地索引存储到应用数据目录。
- 全文搜索：按关键词返回文档、片段、标签、匹配分数。
- 文档详情：显示标题、路径、类型、大小、导入时间、摘要、正文预览。
- 标签和星标。
- 删除文档记录。
- 导出知识库元数据 JSON。
- 导出 Codex 上下文包：生成 `context.md` 和 `sources.json`。
- 外部监督工具实测记录：重启、状态读取、续跑尝试、问题和建议。

### 4.2 能力状态分层

为避免把规划当成已经完整落地，后续文档、UI 和验收统一使用以下状态：

- `implemented`：已在代码中可用，并有基础 smoke/build 验证。
- `MVP heuristic`：已有可运行入口，但依赖启发式聚合、运行时内存视图或字符串契约测试，不能作为完整治理能力宣传。
- `planned`：已进入 PRD/技术设计，但尚未完成实现或联调。
- `revise/block`：审计认为不能验收，必须先修风险。

当前审计结论：ProjectRecord / CEOFlowRecord / ThreadLineageIndex-style Agent retrieval 已有 MVP heuristic + policy/test evidence；Project Resume Packet、Archive Candidate evidence governance、Agent Runtime Monitor 和 Codex 工具/Skill 资产图谱已有 MVP / policy-level + export-level 实现，其中老线程治理已补 Thread History Vault 入库、本体瘦身、知匣 compact receipt evidence 和 Codex 侧栏归档队列；但仍必须按“启发式 / 候选 / 只读诊断 / snapshot 级确认 / per-record metadata / export-level 资产图谱 / advisory retrieval / host-bridge archive queue”口径宣传；项目记忆完整持久化回填、权威 ThreadLineageIndex、Codex 宿主侧栏归档桥接仍需宿主执行，更完整 e2e 行为测试矩阵仍是 planned。任何声称“归档/瘦身必然改善卡顿”或“只瘦身 session 但没有 Thread History Vault、memory pointer、hot/warm/cold 证据”的结果都不能验收。

### 4.2.0 已实现和 MVP 能力

- 文件夹批量导入和递归扫描。
- SQLite 本地数据库替代单 JSON 文件，并支持旧 JSON 数据迁移。
- 更细的关键词搜索排序：标题、文件名、标签、摘要、正文命中次数、星标和重复文件降权。
- 文件变更检测：比较大小和修改时间，变化文件可重新索引，缺失源文件会标记失败。
- 重复文件处理：按文件内容 SHA-256 识别重复，保留记录并显示重复来源提示。
- 应用设置页：展示本地数据库路径、索引统计和维护操作。
- 自动化烟测：覆盖关键 IPC、SQLite 存储和 Excel 安全策略。
- Codex 工作区扫描：选择工作区目录，导入 README、docs、`.codex-knowledge` 等位置的文档产物。
- Codex 产物视图：集中查看工作区文档、上下文包和疑似 Codex 生成文档。
- 文档来源类型：区分用户导入资料、工作区文件、Codex 上下文包、Codex 输出文档。
- 同路径内容变更时记录版本快照，为后续差异对比和回滚打基础。
- 仓库内提供 `zhixia-local-docs` Codex Skill，作为开源项目的一部分配套发布。
- Skill 安装器：安装向导提供可选勾选项，设置页也可检测并安装/更新 `zhixia-local-docs` 到 `$CODEX_HOME/skills` 或用户目录 `codex skill directory`。
- 新手安装包：提供 Windows 安装向导、桌面快捷方式、开始菜单快捷方式和自定义应用图标。
- Skill 安装授权：默认不擅自安装 Codex Skill，由用户在安装向导中勾选或在设置页手动点击安装。
- 项目知识库：扫描 Codex 工作区后自动识别项目根目录，按项目归类 README、PRD、技术设计、测试计划、发布说明和报告。
- 项目知识提取：自动生成 `.codex-knowledge/project-resume.md`、`retrieval-packet.md/json`、`project-index.md/json`、`project-chunks.jsonl`、兼容短索引 `project-knowledge.md` 和 `project-sources.json`。默认给 Codex/CEO Flow 调用的是短 packet、结构化索引和 bounded chunks，不再用几万行 Markdown 承载完整历史。
- 阅读体验：选择左侧/中间文档后，右侧立即显示正文，并支持长文档上下滚动阅读。
- 项目交互优化：左侧项目栏默认更宽，可拖拽调宽，项目列表作为唯一项目入口。
- Skill 知识调取：配套 Skill 提供项目知识读取脚本，Codex 可以从当前工作区优先调取 `project-resume.md`、`retrieval-packet.md/json`、`project-index.md/json`、`project-chunks.jsonl` 和任务级 `context.md`；`project-knowledge.md` 仅保留为兼容短入口。
- 后台文件监听：自动监听已导入文档目录和 Codex 项目目录，变更后自动重建索引、重新扫描项目并刷新项目知识文件。
- 知识库分类：把已导入文档整理成 `knowledge_items`，按 architecture/product/testing/operations/process/data/docs/general 分类，用户可在“知识库”页查看。
- AI 自动整理：设置页可配置 DeepSeek/OpenAI 兼容 API；默认离线启发式整理，只有用户点击 AI 整理或连接测试时才联网。
- 项目知识条目导出：项目 `.codex-knowledge/` 增加 `knowledge-items.json` 和 `knowledge-items.md`，供 AutoFlow/Codex 低 token 检索。
- Codex 老线程管理 MVP：普通用户主流程收敛为一个 `一键安全减负` 按钮，自动完成大线程体检、CEO 子线程冷却扫描、Thread History Vault 入库、热/温/冷召回入口、备份验 hash、大线程本体瘦身、线程 store 兼容性回执、知匣 compact receipt evidence，以及冷线程归档队列。扫描不只看体积：CEO 创建/调度的实现、审计、准备、回调等员工线程 3 天未复用可在入库后进队列；CEO 主线程默认保留 30 天；归属不明线程先保存历史，达到 3 天冷却后进队列。当前主按钮会请求最多 1000 条候选并显示全量/已入库/已有历史/剩余数；如果真实积压超过该上限，UI 必须显示“仍有待处理”，不能说全量完成。小型过期员工线程不强制瘦身，只要完整历史保险库和 hash 通过且非 active/running，就可进入 Codex 宿主归档队列。知匣 App 不直接调用 Codex 宿主侧栏归档；队列用于由 CEO/Codex host bridge 执行 `set_thread_archived` 并记录回执。
- 项目档案页 MVP：按项目展示当前状态、完成度、最近进展、下一步、阻塞项、关键 CEO/worker/reviewer 线索、当前有效文档、过期文档和可检索记忆；当前状态主要来自运行时启发式聚合。
- CEO Flow 线程族谱 MVP：把长期 CEO 维护线程、它创建或调度的专家员工线程、任务卡、验收报告、handoff、项目和记忆卡归到同一个 CEO flow 下，支持按 CEO 线程快速定位相关历史；当前尚未持久化为权威 ThreadLineageIndex。
- Agent retrieval contract MVP：主进程会按 bounded、metadata-first 的本地 contract 先查 ProjectRecord、CEOFlowRecord、Project Resume Packet、KnowledgeItem、MemoryCard、ProjectArtifact、ToolSkillRecord advisory metadata 和 hot/warm summary；当前已有 policy-level / fixture-level 行为证据，但不应宣传为所有 scorer path 都完成了完整 IPC/e2e 验收。
- Thread Recovery Packet P1：当旧 CEO/worker 线程坏掉、被归档或被瘦身后，新线程可以通过 `memoryRuntime:recoverThread` 按 threadId、标题、项目路径或 query 生成 compact 恢复包。恢复包整合 ThreadLineageIndex、Thread History Vault manifest、Guardian inventory、项目文档建议和冷历史 sourceRefs；默认不读取 raw session 正文、不扫全 vault、不启动后台任务、不执行 archive/compact/delete/move/restore。
- ProjectArtifact 检索与导出 MVP：把已扫描文档的 metadata 规范为 `project_artifact` 检索项，并导出 `.codex-knowledge/project-artifacts.md/json`，标记当前有效、需要复核、已被更新文档替代、产出角色和 source refs；当前仍是启发式 metadata-only 视图，尚不是独立持久表和完整文档治理 UI。
- ProjectArtifact UI 入口 MVP：项目总览页可看到 `Project Artifacts Map`，并打开 `.codex-knowledge/project-artifacts.md/json` 作为 metadata-only 治理材料；用户可以确认当前 artifact 索引快照，确认记录 md/json 的 id、hash 和更新时间，重新生成或 hash 变化后自然回到 `待确认/待复核`，不沿用旧确认；这个确认只代表“当前 map snapshot 已人工看过”，不代表每条 artifact 都已治理完成，也不替代源文件或独立可信数据库。
- Project Resume Packet MVP：项目扫描/知识导出会写出 `.codex-knowledge/project-resume.md`，Agent retrieval 可优先返回 Resume Packet，项目总览可打开、确认并在受限范围内改写；当前仍是 heuristic resume material，不是权威项目状态数据库。
- 项目记忆回填 candidate MVP：项目知识导出前会从 PRD、技术设计、测试、报告、README、Codex 输出和 AutoFlow/BUG_FIX_MEMORY 来源回填 `project_doc` / experience card candidates；自动结果默认是 candidate/review，不直接冒充 authoritative memory。
- Agent Runtime Monitor MVP：已提供只读 Codex 诊断快照，展示进程 CPU/内存、session 大小、状态、vault/receipt/pointer 证据、observed facts / inferred attribution / uncertainty 和只读建议；它不是性能修复、清理或 kill 工具。
- ProjectArtifact per-artifact override planned：后续再补单条 artifact 的人工覆盖、例外状态和更细治理入口；本阶段只提供整张 map snapshot 的确认/待复核边界，不做大迁移、不建独立持久表。
- Codex 工具与 Skill 资产图谱 MVP：当前已有 `electron/toolSkillInventoryPolicy.cjs` 和 `tests/tool-skill-inventory-policy.test.cjs`，项目知识导出会写出 `.codex-knowledge/tool-skill-inventory.md/json`，项目总览和一等工具页可通过最小 IPC/UI 只读展示候选并确认当前 live inventory snapshot；SQLite-backed 单条候选治理 metadata 已支持 confirm/reject/deprecated/blocked/clear，并用 live snapshot hash 和 record context hash 标记 current/stale；Agent retrieval 已支持 `tool_skill_record` bounded advisory kind，返回用途、来源、治理状态、safe/forbidden labels 和 no-execution policy；自动发现和检索默认 `candidate` / `requiresHumanConfirmation=true`，不会安装、启用、执行工具，也不会读取敏感配置正文或 raw session。
- 历史回填深化 planned：后续继续把现有 documents、Codex 输出、PRD、技术设计、测试报告、BUG_FIX_MEMORY、AutoFlow completion、Thread History Vault 候选升级为更稳定的知识/记忆治理闭环。
- 项目续接包深化 planned：后续把 Project Resume Packet 从当前 heuristic/confirmable export 继续深化为更完整的项目恢复治理面板。
- 老线程归档队列流程 MVP：按线程角色、使用频率、最后写入时间、项目状态、hot/warm/cold 状态和 vault 证据生成队列；CEO 创建线程 3 天、CEO 主线程 30 天、归属不明线程 3 天是默认冷却规则。active/running、最近写入、无 Vault、hash 不一致、pinned/keep hot 或仍有未完成任务的线程会自动跳过；瘦身回执是减负增强证据，不是侧栏归档队列的唯一硬门槛。知匣 App 不删除、不移动、不直接归档 Codex session；Codex 宿主侧栏归档桥接仍需宿主执行。归档不是删除历史，而是让长期不用的线程退出 Codex 热路径，把完整历史留在 Thread History Vault 和知匣线程历史页，必要时按 threadId / projectPath / query 召回。

### 4.2.1 下一阶段规划：Agent Runtime Monitor 扩展

Agent Runtime Monitor 是知匣的本地 agent 运行监控模块。当前已有 Codex-focused read-only MVP，并已显式标注 Claude Code、OpenClaw/AutoFlow、Cursor/Windsurf/Gemini CLI 等非 Codex 工具为 process-only planned session adapter：只采样进程 metadata、隐藏敏感命令行 token，不读取 session body，也不声称能精确归因到具体线程。

目标不是复制 Windows 任务管理器，而是回答用户真正关心的问题：

- 哪个 agent 工具正在占用 CPU/内存。
- 哪个 Codex 线程或会话历史最大、最近仍在写入、是否已入库/瘦身。
- 哪些线程处于 `active`、`idle`、`systemError`、`notLoaded` 等状态。
- 哪些线程有 `ZhixiaHistoryId`、Thread History Vault、compact receipt，哪些仍只是旧索引。
- 哪个项目的 agent 活动最多，是否存在长时间高 CPU、无输出、错误重试或日志膨胀。
- 当前应该建议用户等待后重采样、检查进程元数据、检查线程元数据、复核错误状态或复核历史元数据。
- 老线程归档是否真的改善左侧线程栏、session 载入和体感卡顿；监控台只能给证据和置信度，不把归档宣传成必然性能修复。

维护者工作目录中保留了更细的 Agent Runtime Monitor 设计稿；公开仓库以本 PRD、`docs/TECHNICAL_DESIGN.md` 和 `docs/CEO_FLOW_MEMORY_RUNTIME.md` 为准，不发布包含本机运行证据的内部设计日志。

### 4.2.2 下一阶段规划：项目记忆和归档治理深化

项目记忆和归档治理是知匣比普通文档管理器更关键的能力。它的目标是把已经扫描进知匣的文档和 Codex 历史变成可阅读、可检索、可续接的项目档案。

核心能力：

- Project Record：为每个项目维护名称、路径、状态、完成度、最后进展、下一步、阻塞项、owner CEO 线程、worker/reviewer 线程和 source refs。
- CEO Flow Record：为长期 CEO 维护线程维护 parent CEO、子线程员工、项目、任务、决策、验收、handoff、memory pointer 和 Vault pointer，作为高优先级检索入口。
- Artifact 分类：把文档分成项目说明、PRD、技术设计、测试计划、发布记录、决策日志、审核报告、交接、Bug/经验、Codex 输出、原始资料、已过期文档。
- Knowledge 回填：从文档和线程摘要中提炼当前架构、产品规则、验收标准、权威文件、模型/工具策略等。
- Memory 回填：从修复记录、CEO acceptance、review report、AutoFlow completion、handoff 中生成经验卡和项目状态卡。
- Project Resume Packet：把当前已实现的 heuristic Resume Packet 深化为更稳定的恢复包，包含当前状态、关键决策、阻塞项、下一步、不要重复的坑和来源。
- Archive Candidate：把当前 read-only candidate/evidence 能力深化为更完整的归档候选治理闭环；CEO Flow 只消费归档状态、receipt 和 memory pointer，不自己做后台归档。

详细规划见 `docs/PROJECT_MEMORY_AND_ARCHIVE_PLAN.md`。

### 4.2.3 下一阶段规划：Codex 工具与 Skill 资产图谱

Codex 工具与 Skill 资产图谱是项目记忆的一部分。它的目标是把用户在 Codex 里逐步积累的工具、Skill、插件、自动化脚本和工作流整理成可读、可检索、可续接的资产目录。

第一阶段不自动安装、不自动执行、不扫描敏感配置，只做只读发现和人工确认候选。当前 MVP 已把候选快照写入 `.codex-knowledge/tool-skill-inventory.md/json`，供 Codex 低 token 检索，并在项目总览和一等工具页提供 read/scan/confirm 入口；snapshot 确认绑定 live inventory snapshot hash，单条候选治理使用 SQLite-backed metadata 标记 confirmed/rejected/deprecated/blocked/clear，且上下文 hash 变化后显示 stale 并要求复核。Agent retrieval 主策略已接入 `tool_skill_record` advisory kind，但仍只返回 compact metadata，不授权安装、启用、执行或 active promotion：

- Codex Skill：读取 `$CODEX_HOME/skills`、`$CODEX_HOME/skills`、项目内 `codex-skills/`，整理 Skill 名称、用途、触发条件、适用项目、安装状态、来源路径和维护状态。
- Codex 工具/脚本：整理用户写过的 workflow scripts、OpenClaw/AutoFlow 辅助脚本、Guardian helper、项目脚手架、打包脚本和测试脚本，说明“解决什么问题、什么时候用、有哪些危险命令边界”。
- Plugin / MCP / Browser 能力：记录已启用插件、MCP 工具或浏览器能力的用途和适用场景，但不保存凭据、不复制 token、不自动调用外部服务。
- 项目关联：把每个工具/Skill 关联到项目、CEO Flow、任务卡、验收报告和 source refs，方便用户问“我之前为这个项目做过哪些工具”。
- 状态治理：每个工具/Skill 至少有 `candidate / active / deprecated / blocked / unknown` 状态，自动发现结果默认 candidate，需要用户确认后才进入 active。

这个能力解决的是“工具资产记忆”，不是普通文档检索。它应该回答：

- 这个 Skill 或工具是干什么的。
- 哪些项目在用它。
- 它什么时候应该被 Codex 调用，什么时候不能调用。
- 它是否已经安装、是否过期、是否需要人工确认。
- 它的输入、输出、危险命令、测试命令和维护者是谁。

### 4.2.4 下一阶段规划：知匣 Skill / 流程模块

知匣 Skill 不是给知匣重复安装一套已有功能，也不是让用户像开发者一样手动调用脚本。它的定位是“产品功能背后的 AI 流程规则”：把项目摘要、个人库整理、工具资产说明、老线程安全减负、数据库体积治理、UI 体检等容易走样的 AI 判断流程固化为可版本化、可审计、可回滚的本地流程模块。

核心边界：

- 固定功能仍由知匣代码实现：按钮、进度条、数据库写入、线程入库、归档队列、文件扫描、导出和 UI 展示不能交给 Skill 随意执行。
- Skill 只定义流程：何时触发、需要读取哪些资料、如何调用 DeepSeek/OpenAI 兼容模型、输出什么 JSON、哪些动作必须禁止、怎样写回回执。
- 普通用户不需要“调用 Skill”：用户点击“AI 生成摘要”“扫描并整理项目”“一键安全减负”等产品按钮时，知匣自动选择对应流程模块。
- 设置页只给高级用户管理：启用/停用流程模块、查看版本、查看最近运行回执、测试 AI Provider、恢复默认流程。
- 默认内置一组官方流程模块：项目中文摘要、个人库链接整理、工具资产中文说明、智能优化候选解释、知识/记忆回填、SQLite 体积诊断。用户后续可以导入自定义流程模块，但默认不允许自定义模块直接删除文件、移动 Codex session、执行 shell、读取凭据或上传原文。
- DeepSeek 是增强整理质量的默认 AI 入口：没有 API Key 时走本地启发式；配置 DeepSeek/OpenAI 兼容接口后，流程模块可以请求 AI 生成中文标题、摘要、分类、风险说明和下一步建议。

第一批建议内置流程模块：

- `project-summary-cn`：为项目卡片生成中文标题、项目介绍、进度摘要和下一步，不显示 JSON、路径、测试日志或内部 enum。
- `personal-library-card-cn`：把用户转发的链接、文章、视频或长文整理成标题、摘要、来源、标签和详情页结构。
- `tool-asset-explainer-cn`：为 Codex Skill、插件、脚本、workflow 生成真实中文名称、用途、适用项目、风险边界和安装状态说明。
- `safe-thread-pressure-relief`：为一键安全减负固定规则：先入库、验 hash、写 memory pointer、再瘦身/生成归档队列；CEO 子线程 3 天、CEO 主线程 30 天、未知线程 3 天；未保存历史不得归档。
- `knowledge-memory-layering`：把历史、知识、记忆分层写入 ProjectRecord、KnowledgeItem、MemoryCard、Resume Packet，而不是堆成一个巨大的 Markdown。
- `sqlite-bloat-diagnostic`：当知匣自身数据库膨胀、内存高、保存慢或退出卡顿时，按备份、贡献字段分析、截断派生正文、VACUUM、验证安装版的流程给出治理建议。

### 4.2.5 低开销记忆运行时和快速召回（P1 implemented）

本节解决的问题是：Codex 明明已经有历史、知识、记忆和 Skill 资产，为什么执行任务时仍然像“没记住”，或者需要用户反复提醒。知匣不应继续扩大单个 Markdown 或让 Codex 全量搜索历史，而应提供一个轻量 `MemoryRouter`，把任务目标转换成小而准的记忆包。

当前已完成 P1+：主进程 `retrieve_context` 会生成只读 `MemoryRouterPlan`，按任务目标选择小 profile、限制 topK/token/time budget，并返回 `routerPlan`、`hotState`、hot/warm/skill/cold layer、`recallPlan`、performance boundary、cacheKey 和 expiresAt。`RuntimeContextPacket` 采用 layered recall：Hot 是当前目标/决策/下一步的短期工作记忆，Warm 是 PRD/架构/验收进度/模块演化的长期摘要记忆，Skill 是经验卡/工具/Skill 候选/可复用流程的程序性记忆，Cold 是 Thread History Vault、raw session、大文档和归档历史的 sourceRef 指针；普通任务默认只读 hot/warm/skill，cold 只在 `thread_recovery`、`archive_candidate` 或显式恢复/证据门禁下给指针，不读正文。`MemoryGraph` 已从一次性 packet-local 图升级为轻量持久图谱：主进程维护 `memory_graph_nodes` / `memory_graph_edges`，从 `knowledge_items`、`experience_cards`、`thread_lineage_index` 等 compact metadata 增量派生节点和边；`memoryRuntime:activateMemory` 和 `retrieve_context` 会按任务目标、项目路径、threadId 进行 bounded activation 和邻居扩散。新增 `observe_event` / `memoryRuntime:observeEvent` 事件触发短期记忆：坏线程、心跳熔断、线程接管、旧 lane 引用失效、任务 checkpoint 和用户规则变化会写入 app-owned runtime event + WorkingMemoryRecord，并在下一次匹配项目/线程的 `retrieve_context` 中作为 hot memory 返回。闭环生产者已经接入：`recover_thread` 生成 ThreadRecoveryPacket 后会自动写恢复/接管事件，`runtimeMonitor:getSnapshot` 会把已有 recommendations 写成 bounded 运行诊断事件；两者都可用显式 false 参数关闭写回用于 dry-run。它仍不做启动全图重建、Vault walk、AI 摘要、全文/raw body 读取；底层允许 metadata-first bounded row reads。

参考设计：

- Memory Networks：把可读写的长期记忆作为推理组件之外的结构，说明“模型 + 外部记忆”比把全部信息塞进模型参数更适合可更新知识库。
- Neural Turing Machines：把神经网络连接到外部 memory，通过注意力读写，启发知匣把“推理”和“存储/索引”分离。
- RAG：把参数记忆和非参数外部索引结合，强调来源、更新和可追溯性；知匣应默认作为 Codex 的非参数项目记忆。
- MemGPT：把 LLM 记忆做成类似操作系统的虚拟内存，热/温/冷分层调页；这直接对应知匣的 hot/warm/cold history、Project Resume Packet 和 Vault。
- Generative Agents：用 observation、reflection、planning 生成可检索经验，而不是只保存流水账；知匣应把接受的任务结果写成决策、坑点、下一步和经验卡。
- GraphRAG / HippoRAG：用图谱关系和节点扩散处理跨文档、跨项目、多跳问题；知匣可维护轻量 `MemoryGraph`，但必须增量更新，不能启动时重建全图。

产品目标：

- Codex / CEO Flow 在开始任务前，能自动获得一个 800-1500 token 的 `RuntimeContextPacket`，包含项目是什么、当前状态、相关历史、可用工具、风险和 sourceRefs。
- 用户不需要理解“知识库、记忆库、历史、Skill、vault”的内部差异；打开项目时看到中文项目摘要，Codex 调用时收到 compact memory packet。
- 记忆召回必须比全量搜索快：先查热索引和关系表，再查温层摘要，最后才进入冷层 Vault；默认不读 raw session、全文、截图/base64 或大日志。
- 记忆写回必须可审计：每个自动生成的项目状态、经验、工具说明或 FlowSkill 候选都要保留 sourceRefs、hash、freshness、confidence 和写回回执。

核心组件：

- `MemoryRouter`：根据 `task_goal`、项目路径、threadId、任务类型和当前页面，选择 retrieval plan。它不做全文扫描，只读取轻量索引、缓存和小片段。
- `MemoryGraph`：维护 Project、Document、Artifact、Thread、Decision、MemoryCard、KnowledgeItem、ToolSkillRecord、SkillCandidate 之间的边。图谱用于快速定位相关记忆，不作为默认 UI 大图谱展示。
- `HotStateCache`：保存最近打开项目、当前 CEO Flow、活跃线程、最近任务、最后决策和下一步，启动时只加载这部分。
- `RuntimeEventMemory`：把坏线程、心跳熔断、接管恢复、旧线程引用失效等运行事实写成短期热记忆；默认只保存标题、摘要、决策、风险、下一步和安全 sourceRefs，不保存 raw session 正文或凭据。
- `WarmSummaryIndex`：保存项目摘要、文档摘要、经验卡、工具说明、artifact metadata、hot/warm thread summary，用于普通任务检索。
- `ColdVaultPointer`：只保存 Thread History Vault、原始文件和大文档的 pointer、hash、receipt；冷层 raw body 只有在恢复/审计且 compact 摘要不足时才按范围读取。
- `MemoryWritebackQueue`：任务完成后把接受/修订/阻塞证据写成候选，不在 UI 主线程里同步总结，不自动把低置信历史升级为 active memory。

性能原则：

- 启动只加载项目卡片、HotStateCache、索引 metadata 和最近 activity，不扫描全盘、不读取文档全文、不运行 AI 摘要、不重建图谱。
- 文件变化只写入 dirty queue；增量 worker 在空闲、手动触发或每日一次窗口里小批量处理。
- DeepSeek/OpenAI 兼容模型只在用户触发或后台队列允许时运行；默认并发 1，失败降级本地启发式，不能阻塞 UI。
- 图谱更新采用 upsert 和 hash 去重：同一 sourceHash / sourceRef 不重复写入，不为重复扫描生成重复历史。
- 检索必须有 `topK`、`tokenBudget`、`timeBudgetMs` 和 `maxSourceReads`。P1 先记录实际检索耗时，超过预算时返回已有 packet，并带 `partial=true` / `memory_router_time_budget_exceeded_partial` warning，而不是把超预算结果伪装为完整命中；后续异步检索 worker 再实现真正中途取消。
- Runtime Monitor、老线程体检、Vault 扫描和 AI 总结都不能作为默认常驻后台任务；需要显式入口、冷却时间或每日低频检查。

阶段划分：

- P1（已实现）：实现 `MemoryRouter` 合同和只读 plan：输入 task_goal，输出 retrieval plan、source kind、预算、warnings；先复用现有 Agent retrieval。
- P2（部分实现）：RuntimeContextPacket 内已生成 `hotState` seed；后续再做持久化 `HotStateCache` 和 `WarmSummaryIndex`，让项目页和 Codex Skill 都从同一份 compact packet 取数。
- P3（第一版已实现）：RuntimeContextPacket 内已合并 persisted activation `MemoryGraph` 和 packet-local sourceRef 小图；已落地最小关系表和增量 upsert，只记录节点/边/权重/sourceRefs，不生成大型图谱 UI。后续再补 UI 解释、手动重建入口和更细的边权治理。
- P4：实现 `MemoryWritebackQueue` 和验收后的经验晋升策略；accepted evidence 才能进入 active，其他保持 candidate/review。
- P5：增加性能验收：冷启动、项目切换、记忆检索、AI 摘要、每日增量处理都必须有时间和 CPU/内存预算。

### 4.2.6 下一阶段：项目原生关联记忆系统

当前 Memory Runtime 已完成分层召回、FTS5/BM25F、时序 MemoryFact、事件热记忆、线程恢复和轻量关系图底座，但仍不能把“存在于知匣中的文本和 metadata”自动转化为完整项目认知。下一阶段不再以增加摘要或扩大 Markdown 为目标，而是建立 ProjectBrain、ModuleMemory、EpisodeMemory、ProjectAnchor 和 ProjectContinuityLedger：用项目身份、模块、文件、错误、任务类型、线程族谱和历史决策共同形成 CueSet，再通过 exact/FTS、可选 semantic recall 和 bounded graph activation 补齐项目连续性槽位。

新 CEO 线程的验收标准从“返回若干相似历史”升级为“项目身份、原始目标、架构锚点、活跃模块、当前阶段、已接受进度、未完成任务、阻塞和下一步等 mandatory slots 达到覆盖门槛”。Cold/raw 历史仍只提供 pointer，只有 compact 层无法补齐关键槽位时才进入显式恢复门禁。

综合产品分层、身份/权限、standing rule、审批撤销、真值生命周期、服务化和完整升级顺序见 `docs/MEMORY_CORE_INTEGRATED_UPGRADE_STRATEGY.md`。ProjectBrain、写入/巩固、线索触发、旧线程恢复、可选本地语义层和关联召回细节见 `docs/PROJECT_NATIVE_ASSOCIATIVE_MEMORY_PLAN.md`。

### 4.3 暂不实现

- 真正联网 AI 问答。当前 AI 能力只做用户显式触发的文档整理摘要。
- 多端同步。
- 账号系统。
- OCR 图片识别。
- 企业权限系统。
- 自动判断所有 Codex 产物的真实作者；第一阶段只按工作区路径和文件模式分类。
- 自动覆盖 Codex 工作区文件；第一阶段只扫描、索引和导出上下文包。

## 5. 核心流程

1. 用户打开知匣。
2. 点击“导入文档”。
3. 选择一个或多个本地文件。
4. 应用读取内容，抽取标题、摘要、正文文本。
5. 应用把记录写入本地知识库。
6. 用户在搜索框输入关键词。
7. 应用返回命中文档和片段。
8. 用户打开详情，添加标签或星标。

## 5.1 Codex 配套流程

1. 用户在知匣中导入本地资料。
2. 用户绑定或选择一个 Codex 工作区。
3. 用户从搜索结果或文档详情导出 Codex 上下文包。
4. 知匣在目标工作区生成 `.codex-knowledge/context.md` 和 `.codex-knowledge/sources.json`。
5. 用户在 Codex 中使用 `zhixia-local-docs` Skill。
6. Codex 读取上下文包，生成 PRD、技术设计、测试计划、报告或发布说明。
7. 用户回到知匣扫描 Codex 工作区。
8. 知匣把 Codex 生成文档归档、索引、标注来源类型，并在变更时记录版本。
9. 用户在设置页安装或更新 `zhixia-local-docs` Skill，让 Codex 直接使用同一套上下文包约定。

## 5.2 知识条目整理流程

1. 用户导入或扫描本地文档。
2. 用户打开“知识库”页或设置页，点击“本地整理”。
3. 知匣在本机把文档压缩为分类知识条目，保留来源路径和 source hash。
4. 如用户配置了 DeepSeek/OpenAI 兼容 API Key，可点击“测试连接”和“AI 整理”。
5. AI 整理失败时自动降级为本地整理，并记录短错误原因。
6. 项目关联文档会导出 `.codex-knowledge/knowledge-items.md/json`，Codex Skill 可按 query 读取。

## 5.3 Codex 老线程优化流程

1. 用户在知匣打开 Agent / 老线程管理。
2. 知匣通过 Guardian 只读体检 Codex sessions，列出超过阈值且近期未写入的老线程。
3. 用户点击“入库并生成瘦身建议”。
4. 知匣先读取线程 compact context，并把完整 raw session 复制到 Thread History Vault。
5. 知匣校验 `originalSha256 === copiedSha256`，写入 hot/warm/cold 层和 `codex-history:<threadId>` 知识条目。
6. Vault 成功后，Guardian 执行 `compact-session`，生成备份、临时文件、替换后校验和 receipt。
7. 瘦身后的 session 保留 `ZhixiaHistoryId: codex-history:<threadId>` 指针。
8. 同一老线程后续继续任务时，CEO Flow / Skill 优先按 threadId、parent CEO thread、项目路径和关键词检索知匣热/温层；冷层 raw session 只在明确请求且摘要不足时读取。

## 5.4 Agent Runtime Monitor 流程

1. 用户打开“智能优化”页。
2. 知匣采样本机 agent 进程：Codex、Claude Code、OpenClaw/AutoFlow 等。
3. Codex 适配器读取 Codex 线程列表、session 文件元数据、Guardian report、compact receipts 和 Thread History Vault 状态。
4. 监控页展示进程级 CPU/内存、线程/会话级历史体积、最近写入、状态和优化证据。
5. 知匣根据可用证据给出“疑似压力来源”和置信度，而不是伪装成百分百进程到线程映射。
6. 用户可以复制诊断报告，或按只读建议等待后重采样、检查进程/线程元数据、复核错误状态与历史证据、查看历史 vault。

## 5.5 未来规划：项目记忆回填和续接流程（planned，不是当前 MVP）

以下流程描述的是后续治理目标，用于说明 planned/future flow；除前文已单独标为 MVP 的入口外，不应解读为当前版本已经完整实现。

1. 用户扫描 Codex 工作区或打开已有项目。
2. 知匣从 documents 表中聚合项目文档、Codex 输出、`.codex-knowledge`、报告、交接、测试、发布记录。
3. 知匣识别或生成 Project Record：项目名、路径、状态、完成度、最近活动、owner CEO 线程、worker/reviewer 线程、阻塞项和下一步。
4. 在 planned artifact governance 闭环中，知匣会把文档整理成 Artifact 分类候选：当前有效、需要确认、已过期；更细的归档/例外治理仍属后续阶段，不是当前 ProjectArtifact UI MVP 的既有能力。
5. 知匣从高价值文档和线程 hot/warm 层生成 KnowledgeItem 和 MemoryCard candidate。
6. 知匣为每个重点项目生成 Project Resume Packet。
7. 用户可以确认、归档、拒绝、合并或改写自动生成的知识/记忆。
8. Codex / CEO Flow 续接项目时优先读取 Resume Packet、curated memory、ready knowledge，再按 query 读取原文片段。

## 5.6 老线程归档队列流程（MVP，宿主桥接执行）

以下流程描述当前 MVP 和边界：知匣能自动生成冷线程归档队列和证据文件，但打包后的 Electron App 不能直接调用 Codex 宿主侧栏归档工具。真实侧栏归档由 CEO/Codex host bridge 读取队列后执行。

1. 知匣/Guardian 定期或由用户手动触发归档候选检查。
2. 系统统计线程角色、最后写入时间、使用频率、项目状态、session 大小、Thread History Vault、compact receipt、hot/warm/cold 状态。
3. active/running、最近写入、无 vault、hash 校验失败、仍有未完成任务的线程不能归档。
4. 符合条件的线程进入冷线程归档队列：后台/普通体检使用 CEO 创建线程 3 天、CEO 主线程 30 天、无法确定归属 3 天的保守冷却规则；`一键安全减负` 会把大线程和过冷却期的 CEO 子线程合并处理。大线程完成历史保险库、hash 校验、瘦身回执且非运行中后进队列；小型过期 CEO 子线程完成历史保险库和 hash 校验且非运行中后即可进队列。已经入库的线程也要把 vault manifest/session/hash 证据带入归档候选，避免“有历史但排不了队”。
5. 知匣生成归档队列 receipt、memory pointer 和恢复提示；不删除、不恢复、不直接移动 session。
6. Codex 宿主桥接可按队列调用 `set_thread_archived`，让长期不用的线程退出侧栏热路径；完整历史仍在知匣线程历史页和 Thread History Vault 中可搜索、可审计、可恢复。
7. CEO Flow 可以查询 archive status / memory pointer；常驻扫描、删除 session、恢复 raw session 仍不属于默认自动行为。

## 5.7 知匣 Skill / 流程模块调用流程（planned）

本流程描述下一阶段目标，用于把“知匣的 AI 怎么调用这些流程”做成真实产品过程。它不是让用户打开一个复杂的 Skill 控制台，而是把 Skill 绑定到现有产品动作上。

### 5.7.1 用户视角

1. 用户在设置页配置 DeepSeek/OpenAI 兼容 API Key；不配置也可以使用本地启发式。
2. 用户打开项目页、个人库、工具页或智能优化页。
3. 用户点击一个普通产品动作，例如“AI 生成摘要”“扫描并整理项目”“整理工具资产”“一键安全减负”。
4. 知匣根据页面和动作自动选择内置流程模块，不要求用户知道 Skill 名称。
5. 页面显示清晰进度：正在读取来源、正在整理、正在写回、已完成/失败原因。
6. 完成后用户看到的是结果卡片和回执：项目摘要、个人库卡片、工具说明、减负入库/归档证据，而不是原始 prompt 或技术日志。
7. 如果 AI 失败，知匣降级到本地整理，并在回执里标明“AI 未使用/AI 失败，已用本地规则生成”。

### 5.7.2 系统视角

1. 每个流程模块有 `skill.json` 或 `SKILL.md`，声明名称、版本、触发场景、允许读取的数据、允许写入的表、AI provider 需求、输出 schema 和禁止动作。
2. 用户触发产品动作后，`SkillRunner` 根据 action id 选择流程模块，例如 `project.summary.generate` 绑定 `project-summary-cn`。
3. `SkillRunner` 先收集 bounded context：项目记录、当前有效文档摘要、知识条目、记忆卡、工具资产记录、线程 vault pointer；默认不读取 raw session 和大文件全文。
4. 如果流程模块需要 AI，`SkillRunner` 调用已配置的 DeepSeek/OpenAI 兼容接口，并要求返回 compact JSON；不得把 API Key、凭据、raw session 或无关全库内容发给模型。
5. `SkillRunner` 校验输出 schema、长度、中文可读性和来源引用；不合格则回退到本地模板或标记失败。
6. 通过校验后，知匣只写允许的目标：ProjectRecord 摘要、KnowledgeItem、MemoryCard、ToolSkillRecord 说明、PersonalLibraryCard、SkillRunReceipt 等。
7. 每次运行写入回执：输入来源 hash、模型、版本、耗时、写入条数、失败原因、是否降级、可撤销提示。

### 5.7.3 安全和权限

- 流程模块默认不能执行 shell、不能安装软件、不能移动/删除用户文件、不能移动/删除 Codex session、不能读取凭据文件、不能上传原文全文。
- 老线程减负类模块可以生成候选和回执，但真正的本体瘦身、宿主侧栏归档仍必须走知匣/Guardian 已有安全门和 Codex host bridge。
- 自定义流程模块导入后默认是 disabled，需要用户在设置页启用；启用前展示它能读什么、能写什么、是否联网。
- 所有 AI 写回都必须保留 sourceRefs、hash 或 receipt，方便用户和 Codex 以后追溯。
- 流程模块升级后，旧回执保留原版本号；新版本不能无声改写旧结论。

## 5.8 Memory Runtime 快速召回流程（P1 implemented）

本流程是 Codex / CEO Flow 使用知匣记忆的目标过程。它不是用户手动“打开知识库再复制内容”，而是任务开始时由 Codex Skill、CEO Flow 或知匣 IPC 调用 `retrieve_context(task_goal)` / `retrieve_precedent(task_type)`。

### 5.8.1 Codex 开始任务时

1. Codex / CEO Flow 产生 task goal，例如“继续修知匣 UI 项目卡片摘要”。
2. `MemoryRouter` 先判断项目：优先使用当前 workspace、显式 projectPath、thread memory pointer、最近 HotStateCache。
3. `MemoryRouter` 判断任务类型：UI、bug 修复、发布、老线程恢复、工具/Skill、文档、架构、性能诊断等。
4. 系统生成 retrieval plan：要查哪些 compact kinds、topK、tokenBudget、timeBudgetMs、是否允许查 warm/cold 层。
5. P1 阶段从本次 compact retrieval items 生成 `hotState` seed：项目名称、当前状态、下一步和 sourceRefs；后续再落持久化 HotStateCache。
6. P1 阶段复用现有 metadata-first retrieval 读取 Project Resume Packet、KnowledgeItem、MemoryCard、ProjectArtifact、ToolSkillRecord、hot/warm thread summary；后续再落持久化 WarmSummaryIndex。
7. 如命中老线程或归档历史，只返回 Vault pointer、摘要、receipt 和 sourceRefs；默认不读 raw session。
8. 如果任务是旧线程恢复，系统可合成 `ThreadRecoveryPacket`：包含 threadId/title/projectPath、lineage、vault manifest、recommendedReadOrder、coldHistorySources、sourceRefs、恢复 prompt 和安全边界。它是新 CEO 线程的启动包，不是 raw session 全文。
9. 系统合成 `RuntimeContextPacket`，最多 800-1500 token，复杂恢复不超过 3000 token，交给 Codex。
10. 如果 packet 置信度不足，返回 warning，例如 `partial_context`、`stale_project_summary`、`source_conflict`、`no_thread_history_vault_manifest_matched`，让 Codex 在任务卡里显式说明。

### 5.8.2 Codex 执行中

1. Codex 不持续轮询知匣；只有任务阶段变化、需要查 precedent、review gate 或恢复历史时才再次调用。
2. 对同一 task goal，`MemoryRouter` 使用短期缓存；source hash 未变化时不重复检索和 AI 摘要。
3. 如果用户手动打开项目详情，UI 也读取同一份 project packet，避免 UI 和 Codex 看到两套状态。
4. 执行中产生的临时状态进入 WorkingMemoryRecord，不直接成为长期 MemoryCard。

### 5.8.3 任务结束后

1. CEO Flow 或 Codex 把结果整理成 `EvidenceWritebackPacket`：decision、summary、changed files、tests、sourceRefs、risks。
2. `writeback_evidence` 写入 app-owned inbox，并生成 receipt。
3. 只有 accepted、source-backed、低风险证据可以进入 active/curated 候选；history-derived、heuristic、用户偏好、工具/Skill、跨项目规则保持 candidate/review。
4. 后台增量 worker 在空闲时把 accepted evidence 更新到 ProjectRecord、KnowledgeItem、MemoryCard、ToolSkillRecord 或 FlowSkill candidate。
5. 写回完成后更新 HotStateCache 和 WarmSummaryIndex，但不重建全部索引。

### 5.8.4 性能验收流程

1. 冷启动：只读取 metadata 和 HotStateCache；不得触发全量扫描、AI 摘要、Vault walk 或图谱重建。
2. 项目切换：只加载目标项目卡片、Resume Packet、最近 20 条关系和必要计数；详情内容按需加载。
3. 记忆检索：默认 timeBudgetMs 不超过 800ms；超时返回 partial packet，不阻塞 UI。
4. 增量整理：dirty queue 每批最多处理固定数量，处理后写 checkpoint；应用关闭时不等待长队列跑完。
5. 每日巡检：默认每日一次、小批量、可见状态；不能每两分钟静默跑高成本任务。

## 6. 信息架构

- 顶部工具栏：导入、导出、刷新、搜索。
- 主导航：项目、个人库、工具、智能优化、设置。
- 项目页：默认展示项目卡片，而不是再重复左侧“我的项目”列表。卡片显示项目名称、中文进度、总体介绍和历史/知识/记忆数量；点击卡片进入项目详情。
- 项目详情：把历史、知识、记忆、决策与交接放到同一个项目面板里。历史对用户是“这个项目做过什么”，对 Codex 是可检索来源；知识是 AI 可调取摘要；记忆是 Bug 修复、工作流经验、项目状态卡、决策卡、交接卡、发布卡、用户偏好和模型/工具策略。
- 左侧栏：只保留当前项目摘要、扫描入口和全局状态，不再作为第二套项目列表。
- 个人库：围绕用户转发链接和整理内容建库。默认以内容卡片展示标题、摘要、来源链接、整理时间和分类，详情页展示完整文案、总结和引用来源；图谱仅作为后续可选能力，不作为默认信息架构。
- 工具页：以真实工具名作为卡片标题，区分 Codex 官方/全局、自建/项目内、脚本自动化和待归类工具；卡片只展示中文用途、创建/更新时间、使用项目和来源。风险边界、允许/禁止命令和治理状态折叠到详情里。自动发现结果默认只整理，不安装、不启用、不执行。
- 智能优化页：负责释放老线程历史压力，普通用户只需要一个主按钮 `一键安全减负`。知匣会先把老线程写入历史保险库，再按规则瘦身大线程、把过期 CEO 子线程写入宿主归档队列；高级单条处理仅保留给排错。实时 CPU/内存压力监控不再作为默认 UI 展示，避免监控本身造成卡顿或让页面变成工程控制台。
- 设置页：只保留底层存储、扫描监听、维护、AI Provider 和 Codex 连接。日常扫描、工具整理和智能优化不要求用户先配置复杂开关。
- 底部状态：本地存储路径、文档数量、索引状态。

## 7. 数据模型

```ts
type KnowledgeDocument = {
  id: string
  title: string
  fileName: string
  filePath: string
  extension: string
  size: number
  importedAt: string
  updatedAt: string
  contentText: string
  summary: string
  tags: string[]
  favorite: boolean
  parseStatus: "ok" | "partial" | "failed"
  parseError?: string
  fileModifiedAt?: string
  contentHash?: string
  duplicateOf?: string
  indexVersion?: number
  sourceType?: "imported" | "workspace_file" | "codex_context" | "codex_output"
  workspacePath?: string
  artifactType?: "prd" | "technical_design" | "test_plan" | "release_notes" | "report" | "readme" | "context" | "markdown" | "document" | "other"
}
```

```ts
type DocumentVersion = {
  id: string
  documentId: string
  versionNo: number
  filePath: string
  contentHash: string
  title: string
  summary: string
  contentText: string
  createdAt: string
  changeSummary?: string
  createdBy: "user" | "codex" | "import"
}
```

```ts
type KnowledgeItem = {
  id: string
  projectPath?: string
  documentId?: string
  sourcePath?: string
  title: string
  summary: string
  body: string
  category: "architecture" | "product" | "testing" | "operations" | "process" | "data" | "docs" | "general"
  tags: string[]
  sourceHash?: string
  provider: "local" | string
  model: string
  status: "ready" | "fallback" | "error"
  errorMessage?: string
  createdAt: string
  updatedAt: string
}
```

```ts
type ProjectRecord = {
  id: string
  name: string
  rootPath: string
  aliases: string[]
  status: "active" | "paused" | "waiting_review" | "waiting_user" | "completed" | "archived" | "unknown"
  completion: "idea" | "prd" | "design" | "implementation" | "testing" | "packaging" | "released" | "maintenance" | "unknown"
  completionPercent?: number
  ownerThreadId?: string
  ceoThreadIds: string[]
  workerThreadIds: string[]
  reviewerThreadIds: string[]
  lastActivityAt?: string
  lastSummary: string
  nextAction: string
  blockers: string[]
  freshness: "fresh" | "review" | "stale" | "unknown"
  sourceRefs: SourceRef[]
}
```

```ts
type CEOFlowRecord = {
  id: string
  ceoThreadId: string
  title: string
  scope: "project" | "program" | "maintenance" | "global" | "unknown"
  projectIds: string[]
  workspacePaths: string[]
  childThreadIds: string[]
  hotThreadIds: string[]
  workerThreadIds: string[]
  reviewerThreadIds: string[]
  memoryThreadIds: string[]
  latestDecisionIds: string[]
  latestAcceptanceIds: string[]
  handoffIds: string[]
  resumePacketIds: string[]
  vaultPointers: string[]
  lastActivityAt?: string
  lastSummary: string
  nextAction: string
  archiveState: "hot" | "warm" | "cold" | "archived" | "candidate" | "blocked"
  sourceRefs: SourceRef[]
}
```

```ts
type MemoryCard = {
  id: string
  projectId?: string
  threadId?: string
  sourceType: "bug_fix" | "decision" | "handoff" | "workflow" | "release" | "project_status" | "user_preference" | "model_policy" | "archive_note" | string
  title: string
  summary: string
  body: string
  tags: string[]
  status: "candidate" | "active" | "curated" | "archived" | "rejected"
  confidence: "low" | "medium" | "high"
  freshness: "fresh" | "review" | "stale" | "unknown"
  appliesTo: string[]
  doNotApplyTo: string[]
  sourceRefs: SourceRef[]
  createdAt: string
  updatedAt: string
}
```

```ts
type ToolSkillRecord = {
  id: string
  name: string
  kind: "codex_skill" | "plugin" | "mcp_tool" | "workflow_script" | "cli_tool" | "project_scaffold" | "other"
  projectId?: string
  workspacePaths: string[]
  installPath?: string
  sourcePath?: string
  summary: string
  useCases: string[]
  triggerPatterns: string[]
  inputs: string[]
  outputs: string[]
  riskBoundaries: string[]
  safeCommands: string[]
  forbiddenCommands: string[]
  status: "candidate" | "active" | "deprecated" | "blocked" | "unknown"
  installed: boolean
  maintainer?: string
  lastVerifiedAt?: string
  sourceRefs: SourceRef[]
}
```

```ts
type ZhixiaSkillDefinition = {
  id: string
  name: string
  displayName: string
  version: string
  description: string
  builtIn: boolean
  enabled: boolean
  triggerActions: Array<
    | "project.summary.generate"
    | "project.scan.organize"
    | "personal.library.organize"
    | "tool.assets.explain"
    | "smart.optimize.relieve"
    | "knowledge.memory.layer"
    | "storage.sqlite.diagnose"
  >
  aiProvider: "none" | "optional" | "required"
  allowedReadScopes: Array<"project_record" | "document_summary" | "knowledge_item" | "memory_card" | "tool_skill_record" | "thread_vault_manifest" | "personal_library_item">
  allowedWriteScopes: Array<"project_record" | "knowledge_item" | "memory_card" | "tool_skill_record" | "personal_library_card" | "skill_run_receipt">
  forbiddenActions: Array<"shell_execute" | "install_software" | "delete_file" | "move_codex_session" | "read_credentials" | "upload_raw_session" | "upload_full_document">
  outputSchema: string
  sourcePath?: string
  createdAt: string
  updatedAt: string
}
```

```ts
type SkillRunReceipt = {
  id: string
  skillId: string
  skillVersion: string
  triggerAction: string
  projectId?: string
  status: "success" | "fallback" | "failed" | "blocked"
  provider: "local" | "deepseek" | "openai_compatible" | string
  model?: string
  inputSourceRefs: SourceRef[]
  inputHash: string
  outputHash?: string
  writtenRecords: Array<{ table: string; id: string; action: "created" | "updated" | "skipped" }>
  blockedReason?: string
  errorMessage?: string
  durationMs: number
  createdAt: string
}
```

```ts
type MemoryRuntimeRequest = {
  id: string
  hook: "retrieve_context" | "retrieve_precedent" | "writeback_evidence" | "promote_memory"
  taskGoal: string
  taskType?: "ui" | "bug_repair" | "architecture" | "release" | "thread_recovery" | "tool_skill_lookup" | "document" | "performance" | "unknown"
  projectId?: string
  projectPath?: string
  threadId?: string
  parentCeoThreadId?: string
  providerMode: "none" | "project-memory" | "zhixia-local-docs" | "guardian-history" | "hybrid"
  tokenBudget: number
  timeBudgetMs: number
  topK: number
  allowColdLayer: boolean
  allowRawSession: boolean
  createdAt: string
}
```

```ts
type RuntimeContextPacket = {
  id: string
  requestId: string
  projectId?: string
  projectName?: string
  summary: string
  currentState: string
  nextAction: string
  constraints: string[]
  risks: string[]
  items: Array<{
    kind: "project_record" | "resume_packet" | "knowledge_item" | "memory_card" | "project_artifact" | "tool_skill_record" | "thread_summary" | "vault_pointer" | "working_memory"
    id: string
    title: string
    summary: string
    freshness: "fresh" | "review" | "stale" | "unknown" | "conflict"
    status: "active" | "candidate" | "review" | "accepted" | "blocked" | "unknown"
    whyMatched: string[]
    sourceRefs: SourceRef[]
    tokenEstimate: number
  }>
  warnings: string[]
  partial: boolean
  tokenEstimate: number
  generatedAt: string
  expiresAt?: string
}
```

```ts
type MemoryGraphNode = {
  id: string
  kind: "project" | "document" | "artifact" | "thread" | "decision" | "memory_card" | "knowledge_item" | "tool_skill" | "skill_candidate" | "vault_pointer"
  title: string
  summary: string
  projectId?: string
  sourceRefs: SourceRef[]
  contentHash?: string
  freshness: "fresh" | "review" | "stale" | "unknown" | "conflict"
  updatedAt: string
}

type MemoryGraphEdge = {
  id: string
  fromNodeId: string
  toNodeId: string
  relation: "belongs_to" | "produced_by" | "supersedes" | "mentions" | "fixes" | "depends_on" | "uses_tool" | "same_thread" | "same_ceo_flow" | "source_of"
  weight: number
  sourceRefs: SourceRef[]
  updatedAt: string
}
```

```ts
type MemoryIndexJob = {
  id: string
  kind: "document_changed" | "project_scan" | "thread_vaulted" | "evidence_writeback" | "tool_inventory_changed" | "daily_maintenance"
  status: "queued" | "running" | "done" | "failed" | "skipped"
  priority: "low" | "normal" | "high"
  projectId?: string
  sourceRef?: SourceRef
  sourceHash?: string
  attempts: number
  lastError?: string
  createdAt: string
  updatedAt: string
}
```

```ts
type ThreadArchiveReceipt = {
  threadId: string
  projectId?: string
  archiveStateBefore: "hot" | "warm" | "cold" | "archived" | "candidate" | "blocked"
  archiveStateAfter: "hot" | "warm" | "cold" | "archived" | "candidate" | "blocked"
  vaultManifestPath: string
  originalSha256: string
  copiedSha256: string
  memoryPointers: string[]
  resumePacketId?: string
  archivedAt: string
  reversible: boolean
  restoreHint: string
}
```

```ts
type AgentRuntimePlatform = "codex" | "claude_code" | "openclaw" | "cursor" | "windsurf" | "gemini_cli" | "unknown"

type AgentRuntimeProcessSample = {
  id: string
  platform: AgentRuntimePlatform
  processId: number
  processName: string
  executablePath?: string
  commandLine?: string
  parentProcessId?: number
  rawCpuPercent?: number
  cpuPercent: number
  memoryBytes: number
  sampledAt: string
}

type AgentRuntimeObservedSessionFacts = {
  threadId?: string
  sessionId: string
  platform: AgentRuntimePlatform
  status: "active" | "idle" | "running" | "systemError" | "notLoaded" | "unknown"
  historySizeBytes: number
  lastWriteTime?: string
  recentActivityMinutes: number | null
  hasThreadHistoryVault: boolean
  hasCompactReceipt: boolean
  hasZhixiaHistoryPointer: boolean
  memoryPointers: string[]
  observedProcessIds: number[]
  evidence: string[]
}

type AgentRuntimeAttributionUncertainty = {
  metadataOnly: boolean
  directProcessThreadMapping: boolean
  confidence: "low" | "medium" | "high"
  reasons: string[]
  limitations: string[]
}

type AgentRuntimeAttributionInference = {
  threadId?: string
  sessionId: string
  confidence: "low" | "medium" | "high"
  basis: "direct_process_reference_plus_runtime_signals" | "heuristic_process_pressure_plus_session_metadata" | string
  suspectedProcessId: number | null
  suspectedProcessName: string | null
  reasons: string[]
  uncertainty?: AgentRuntimeAttributionUncertainty
}

type AgentRuntimeSession = {
  id: string
  platform: AgentRuntimePlatform
  threadId?: string
  title?: string
  projectPath?: string
  status?: "active" | "idle" | "running" | "systemError" | "notLoaded" | "unknown"
  sessionPath?: string
  sessionBytes?: number
  lastWriteTime?: string
  hasZhixiaHistoryPointer?: boolean
  hasThreadHistoryVault?: boolean
  hasCompactReceipt?: boolean
  optimizedAt?: string
  pressureScore: number
  attributionConfidence: "low" | "medium" | "high"
  recommendedAction?: "wait_and_resample" | "inspect_process_metadata" | "inspect_thread_metadata" | "review_error_state" | "review_history_metadata" | "none"
  observed: AgentRuntimeObservedSessionFacts
  inferredAttribution: AgentRuntimeAttributionInference
  uncertainty: AgentRuntimeAttributionUncertainty
}
```

## 8. 成功指标

本节同时记录当前 0.8.3 release/MVP 可验收项和 100% 产品目标项；凡涉及完整 ThreadLineageIndex、完整老线程归档召回、完整 Agent retrieval 策略或完整项目记忆治理的条目，当前仍按 target/planned 或 MVP heuristic 处理，不能作为已完整实现宣称。

- 可以在 Windows 上启动桌面应用。
- 能导入至少 5 种常见文本类文档。
- 搜索能返回命中文档和高亮片段。
- 关闭再打开后数据仍存在。
- 构建命令通过。
- 形成外部监督工具实测评估报告。
- 能把知识库文档导出为 Codex 上下文包。
- 能扫描 Codex 工作区并归档生成文档。
- 能自动按项目归类 Codex 产物，生成项目知识库文件。
- 项目知识文件能提取为 Codex 可调取的结构化项目记忆。
- Codex Skill 能指导 Codex 使用 `.codex-knowledge` 上下文并输出可被知匣再次扫描的文档。
- 安装向导能让用户选择是否安装配套 Codex Skill。
- 设置页能把配套 Codex Skill 安装到当前用户 Codex skills 目录。
- 新机器上可通过一个安装包完成应用安装，并在用户授权后完成 Skill 安装。
- 知识页能显示知识条目分类和来源，用户可以手动生成本地整理结果。
- 可选 AI Provider 配置不会泄漏 API Key，AI 整理失败时仍能本地降级。
- 知匣 Skill / 流程模块能绑定到产品动作：项目摘要、个人库整理、工具说明、智能优化、知识/记忆分层和 SQLite 体积诊断；普通用户不需要手动选择 Skill。
- 流程模块运行必须产出 SkillRunReceipt，记录版本、输入来源、模型、本地/AI/fallback 状态、写入记录和失败原因。
- Codex Skill 能通过 `read-project-knowledge.cjs --query --limit --json` 读取知识条目、经验卡片和 Skill 候选。
- 工具与 Skill 资产图谱能列出用户本机/项目里的 Codex Skill、插件、workflow script 和项目工具候选，至少展示用途、触发条件、安装状态、适用项目、风险边界和来源；自动发现结果不能直接安装或执行。
- MVP：Codex 老线程优化后，能证明完整历史已进入 Thread History Vault，并能按 threadId / projectPath / query 在知匣中找回热/温摘要；若执行过瘦身，session 仍可被 Codex thread-store 读取且知匣会写 compact receipt evidence；符合角色冷却规则的冷线程会进入宿主桥接归档队列。
- 智能优化页默认不展示实时 CPU/内存压力面板；主体验收聚焦 `一键安全减负` 是否能显示全量候选、入库/瘦身/归档队列进度、剩余数量和失败原因。只读 runtime 诊断能力保留为内部/高级证据，不作为默认页面卖点。
- MVP heuristic / in review：每个重点项目能生成 Project Record 和 Project Resume Packet，用户停用很久后能通过知匣快速知道项目状态、完成度、最后进展、阻塞项和下一步；当前已加入 source-signature-bound ProjectRecord confirmation 与 stale review gate，但完整持久化治理和 e2e 验收仍未完成。
- MVP heuristic / planned split：每个长期 CEO 维护线程能生成 CEO Flow Record，用户可以从 CEO 线程看到它关联的项目、专家员工线程、任务、验收、handoff 和可召回历史；当前已把 `thread_lineage_index` 作为 metadata-only retrieval kind 接入，用于展示关系计数、sourceRefs 和 archive candidate blockers/evidence，但权威持久 ThreadLineageIndex 与 UI/e2e 验收仍 planned。
- 现有 Codex 输出和项目文档能被回填为 KnowledgeItem 和 MemoryCard candidate；知识/记忆数量不应长期为 0。
- MVP / planned split：Agent 检索默认不全量读取 documents，而是优先读取 Project Resume Packet、curated memory、ready knowledge、当前有效 artifact、ToolSkillRecord advisory metadata 和 thread hot/warm layer；当前已有 metadata-first bounded retrieval，完整权威 ThreadLineageIndex / archive UI/e2e 仍 planned。
- Target/planned：Agent 检索在命中 CEO 线程、员工线程或 task/handoff id 时，优先走 CEO Flow Record / ThreadLineageIndex，再局部读取相关产物和热/温摘要。
- Agent 检索必须有范围过滤、topK、token budget、缓存和冷层 hard gate；归档后的完整历史可搜索，但不能默认全库扫 Vault 或 raw session。
- Target/planned：Memory Runtime 快速召回能在默认预算内返回 RuntimeContextPacket；普通任务默认 800-1500 token，复杂项目恢复不超过 3000 token，所有返回必须带 sourceRefs 或 advisory warning。
- Target/planned：MemoryRouter 冷启动不触发全量扫描、Vault walk、AI 摘要或图谱重建；项目切换和检索必须使用 metadata-first / cache-first 路径。
- Target/planned：MemoryGraph 只做增量节点/边更新和关系检索，不作为默认 UI 大图谱渲染；图谱重建只能手动或维护窗口触发。
- Target/planned：后台 dirty queue 必须有批量上限、checkpoint、每日低频维护和可见状态；不能每几分钟静默高成本扫描。
- 老线程归档候选必须有 Thread History Vault 或等价 source-backed archive、memory pointer 和 receipt；只减少可见线程数量但无法召回历史的归档结果不能验收。

## 9. 技术方案

- Electron：桌面应用壳和本地文件访问。
- React + Vite：前端界面。
- SQLite 文件数据库：使用 `sql.js`，避免 Electron 原生 SQLite 模块重编译风险。
- 前端内存搜索评分：覆盖标题、文件名、标签、摘要、正文命中次数和重复文件降权。
- 分层检索：Agent 查询先命中 ProjectRecord、CEOFlowRecord、Resume Packet、MemoryCard、KnowledgeItem 和 hot/warm summary；cold/raw history 只在恢复、审计或用户明确要求时按范围读取。
- Memory Runtime 快速召回：主进程维护 `MemoryRouter`、`HotStateCache`、`WarmSummaryIndex`、`MemoryGraph` 和 `MemoryWritebackQueue`。默认检索只读 metadata、摘要、关系边和 sourceRefs，按 token/time/topK 预算返回 RuntimeContextPacket；不在启动、项目切换或普通查询时读取全文、raw session、base64、截图或长日志。
- 后台文件监听：主进程使用 Node `fs.watch` 监听已导入目录和 Codex 项目根目录，防抖后触发重建索引和项目知识刷新。
- 知识条目整理：主进程维护 `knowledge_items` 表；本地模式用启发式摘要，AI 模式调用 OpenAI 兼容 Chat Completions，并限制输出为 compact JSON。
- 知匣 Skill Runner：维护内置流程模块和可选自定义模块，按产品 action 自动选择流程，收集 bounded context，调用本地规则或 DeepSeek/OpenAI 兼容接口，校验 compact JSON 输出并写入 SkillRunReceipt。它不执行 shell、不安装软件、不移动/删除 Codex session，不绕过智能优化和 Guardian 的安全门。
- Codex 上下文包：Markdown + JSON manifest，保存在目标工作区 `.codex-knowledge/`。
- Codex Skill：仓库内维护 `codex-skills/zhixia-local-docs/SKILL.md`，与桌面端上下文包格式保持一致。
- Agent Runtime Monitor：主进程通过平台适配器采样进程、线程/会话文件、日志和知匣优化状态；前端只显示聚合结果、observedFacts / inferredAttribution / uncertainty 和只读诊断建议，不直接扫描全盘。
- 项目记忆回填：主进程从 documents、`.codex-knowledge`、Codex output、BUG_FIX_MEMORY、AutoFlow completion、Thread History Vault 热/温层提取 ProjectRecord、KnowledgeItem、MemoryCard 和 Project Resume Packet。自动结果默认进入 candidate/review 状态，避免污染权威记忆。
- 工具与 Skill 资产图谱：当前已有 export + IPC/UI/snapshot confirmation + first-class 工具页 + Agent retrieval MVP，可只读发现 `$CODEX_HOME/skills`、`$CODEX_HOME/skills`、项目内 `codex-skills/`、`scripts/`、`tools/` 和 workflow 目录下的 Skill/脚本候选，把它们整理为 ToolSkillRecord candidate / SkillInventory 快照并写入 `.codex-knowledge/tool-skill-inventory.md/json`，并在项目总览和工具页确认当前 live inventory snapshot。单条候选治理已用 SQLite-backed metadata 支持 confirmed/rejected/deprecated/blocked/clear；`tool_skill_record` retrieval 只返回 compact advisory metadata；不保存凭据、不自动安装、不自动运行，只作为项目记忆和 Codex 调用建议；完整插件/MCP 配置后续再做。
- 老线程归档治理：知匣/Guardian 负责 archive candidate、vault 校验、memory pointer、receipt 和 restore dry-run；CEO Flow 只消费归档状态和验收证据，不常驻扫描或移动/删除 session。
- Mammoth：`.docx` 文本解析。
- PDFParse：`.pdf` 文本解析。
- Excel 二进制解析：MVP 暂不接入。已排除存在审计风险的 `xlsx`/`exceljs` 方案，后续再选择更安全的解析器或转换管线。

## 9.1 Agent Runtime Monitor 技术原则

- 平台适配器：Codex、Claude Code、OpenClaw 等平台各自实现采样逻辑，统一输出 `AgentRuntimeProcessSample` 和 `AgentRuntimeSession`。
- 分层能力：Level 1 进程级监控所有平台可用；Level 2 工作目录/命令级监控优先支持 CLI 工具；Level 3 线程/会话级监控优先支持 Codex；Level 4 语义级监控依赖知匣知识、日志和任务队列。
- 归因保守：Electron renderer CPU 不保证能精确映射到某条线程，UI 必须展示“疑似来源”和置信度。
- 默认只读：监控页默认不结束进程、不删除日志、不修改 session；优化或清理动作必须走已有显式用户授权流程。
- 本地优先：采样结果默认只存在本机，可复制诊断报告，不自动上传。

## 9.2 项目记忆和归档治理技术原则

- 项目优先：所有文档、知识、记忆、线程历史都应尽量归属到 ProjectRecord，而不是只作为散落文件存在。
- 人看和 agent 检索分层：人类 UI 展示项目档案、文档分类、时间线和完成度；agent 默认读取 Resume Packet、KnowledgeItem、MemoryCard 和 hot/warm thread summary。
- 自动回填先候选：从历史文档和线程提取的知识/记忆默认进入 `candidate` 或 `review`，用户确认后才成为 `active/curated`。
- 工具资产先候选：自动发现的 Skill、插件、脚本和 workflow 只能进入 `candidate`，必须经用户确认后才可标记 active；知匣不得因为发现某个工具就自动安装、更新或执行。
- 来源可追溯：每条知识、记忆、项目状态和归档结论必须有 sourceRef、threadId、path、hash 或 receipt。
- 归档不等于删除：归档只改变热/温/冷和 UI 可见性，必须保留可召回历史和恢复提示。
- 归档主体在知匣/Guardian：CEO Flow 可以请求候选、查看 receipt、消费 memory pointer，但不能常驻扫描、移动、删除或自动归档 session。
- 冷层不默认读：cold/raw history 只在明确恢复、审计或摘要不足时按范围读取。

## 9.3 Memory Runtime 性能原则

- 懒加载：启动只读取数据库 schema/version、项目卡片摘要、HotStateCache 和必要统计，不读取 documents.contentText、不加载全部 `.codex-knowledge`、不 walk Thread History Vault。
- 增量优先：所有扫描、摘要、图谱边更新、Skill/Tool inventory 更新都必须以 sourceHash / updatedAt / checkpoint 判断是否需要处理。
- UI 主线程禁止重活：AI 摘要、PDF/Word 解析、Vault manifest 扫描、图谱更新和大批量 SQLite 写入必须在主进程队列或 worker 中运行，并可取消或跳过。
- 有预算的查询：`retrieve_context` / `retrieve_precedent` 默认设置 `timeBudgetMs`、`topK`、`tokenBudget`、`maxSourceReads`；超时返回 partial packet 和 warning，不继续阻塞。
- 有冷却的后台任务：每日维护、旧线程候选扫描、工具资产扫描、AI 整理必须有 visible status、lastRunAt、nextRunAt 和 manual pause；不得静默两分钟一次高频巡检。
- 有界 AI 调用：DeepSeek/OpenAI 兼容调用默认并发 1、批量上限小、只发送摘要和 sourceRefs，不发送全文、raw session、凭据、截图/base64 或长日志。
- 去重和压缩：MemoryGraphNode、MemoryCard、KnowledgeItem、ThreadArchiveReceipt 和 FlowSkill candidate 必须基于 sourceHash/sourceRef upsert，重复扫描不能重复入库。
- 性能验收：后续每次实现 Memory Runtime 能力，都必须提供冷启动、项目切换、普通检索、老线程恢复检索和后台增量处理的耗时/CPU/内存证据；没有性能证据不得标为 implemented。

## 9.4 Memory Intelligence 闭环（2026-07-15 已实现）

CEO Flow 的主动触发规则已经在其 `memory-runtime.md` 中定义：Memory Runtime 是项目继续、恢复和接管时的默认生命周期动作；bootstrap、dispatch、review、harvest、handoff 和 thread recovery 必须执行对应 hook。本轮不重复扩写 CEO Flow 规则，知匣负责把调用后的执行闭环补完整：

- `retrieve_context` / `retrieve_precedent` 使用 deterministic hybrid retrieval：中文短语/双字片段、英文 token、BM25F 字段权重、project/thread exact scope、status/freshness/recency、现有 score 和 graph activation 共同排序。
- 新增独立 `node:sqlite` FTS5 sidecar `memory-runtime-index.sqlite`。它使用 WAL 增量 upsert compact metadata，不调用 `sql.js db.export()`，不把向量、raw session、base64、巨型日志或文档全文放进主库。
- 新增 typed temporal `MemoryFact`：`subject / predicate / value / factType / validFrom / validTo / observedAt / sourceRefs / supersededBy`。同值事实幂等合并，不同值按来源、时间和置信度生成确定性 supersession，旧事实继续保留为 historical。
- accepted 且 source-backed 的 `writeback_evidence` 会自动形成 accepted outcome、显式 `memoryFacts` 和 reusable procedure facts；revise/block 只形成 candidate/review pitfall，不冒充当前事实。
- `user_rule_update` runtime event 会形成 source-backed 长期用户规则事实；普通 checkpoint 仍只保留在 Hot WorkingMemory，避免把临时状态污染长期记忆。
- 四个生命周期 hook 会写 `MemoryRuntimeTriggerReceipt`，记录 hook、queryType、项目/线程、返回数、token、耗时、partial、warning 和 sourceRefs，解决“记忆存在但不知道 CEO 是否调用”的可观测性缺口。
- 新增本地评测策略，报告 Recall@K、Precision@K、MRR、nDCG、missing-anchor、stale-hit、平均/P95 latency 和 token；默认测试包含完全合成的游戏工作室风格闭环 fixture。

性能边界固定为：无 heartbeat、无后台全库扫描、无默认模型调用、无整库 export。可选本地 embedding 只有在独立 benchmark 证明召回收益且 installed-build CPU/内存通过后才能启用；长期架构锚点不得因自动衰减消失。

## 10. 外部监督和 CI 验证口径

本项目中单独观察：

- 重启后服务能否恢复。
- `ai-console --compact` 能否提供有效状态。
- 旧绑定是否会污染新项目。
- wake/continue 是否能真正续跑，而不是只创建记录。
- 对长任务开发是否有实际帮助。

外部监督工具、CI 或维护者自动化的定位不是知匣依赖，也不是知匣主程序的一部分，而是发布和回归验证辅助：持续监控 Codex 是否按本项目的优化建议推进、验证和记录结果。建议使用方式：

- 外部监督工具读取本项目的公开优化清单，检查 Codex 是否已经完成对应代码、文档、测试和打包。
- 外部监督工具或 CI 监控 `npm test`、`npm run build`、`npm audit --omit=dev`、`npm run prepare:public` 和公开 staging `npm test` 的结果。
- 外部监督工具跟踪 Codex 对后台文件监听、项目配置页、版本 diff/回滚、项目知识质量评分、本地索引增强、Codex 查询入口、自动化 UI 测试和公开发布卫生等建议的推进状态。
- 外部监督工具把未完成、失败或需要人工验收的事项整理成下一轮 Codex 任务，而不是直接进入知匣运行链路。
- 知匣保持本地优先、离线可用；没有外部监督工具时仍能完整导入、阅读、搜索和导出 Codex 上下文。
