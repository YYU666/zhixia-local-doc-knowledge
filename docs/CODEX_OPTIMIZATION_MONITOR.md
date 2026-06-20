# Codex 优化监控清单

本文档供 Ark-Office 作为外部监督工具读取。它不描述知匣运行依赖，而是用于持续监控 Codex 是否按建议继续完善知匣。

## 监控原则

- Ark-Office 只负责观察、提醒、记录和生成下一轮任务，不进入知匣主程序。
- Codex 每轮修改后必须说明改了什么、验证了什么、还剩什么风险。
- 知匣仍保持本地优先、离线可用；没有 Ark-Office 时功能不受影响。

## 当前必须监控

| 编号 | 事项 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| M-001 | 安装器图标 | 安装器、卸载器、安装器头部、主 exe 和桌面快捷方式不再显示 Electron 默认图标，另一台 Windows 机器人工确认 | `0.8.1` 已修复，待外部机器复验 |
| M-002 | 新手安装包 | `Setup 0.7.1.exe` 可完成安装，桌面和开始菜单快捷方式可用 | 待外部机器复验 |
| M-003 | Skill 自动安装 | 首次启动后 `zhixia-local-docs` 自动安装到 Codex skills 目录，脚本 `read-project-knowledge.cjs` 可运行 | 待外部机器复验 |
| M-004 | 项目知识生成 | 扫描 Codex 父目录后按项目生成 `.codex-knowledge/project-knowledge.md` 和 `project-sources.json` | 已实现，需继续抽样验证 |
| M-005 | 文档阅读交互 | 点击项目内 README/PRD 后右侧显示正文，长文档可上下滚动 | 已实现，需继续抽样验证 |
| M-006 | Ark-Office 监控 | Bridge backend 健康、Wake feature 启用；如 Wake 续跑失败，必须记录失败原因 | 已记录，续跑未证明 |
| M-007 | 干净卸载 | 卸载后清理知匣 local app data、本地缓存和 `zhixia-local-docs` Skill，不影响其他 Codex 配置 | `0.8.2` 已实现，待外部机器复验 |
| M-008 | Skill 安装授权 | 安装器默认不安装 Skill，用户勾选后才安装；设置页保留后续安装按钮 | `0.8.3` 已实现，待外部机器复验 |
| M-009 | AutoFlow 经验导入 | completion、BUG_FIX_MEMORY、agent family memory 只读导入为 compact experience cards，不复制大日志/聊天/密钥 | `0.8.3+` MVP 已实现，需真实 workflow 抽样验证 |
| M-010 | Skill 候选闭环 | 项目导出 `skill-candidates.md`，设置页可查看 draft，默认不安装、不启用 | `0.8.3+` MVP 已实现，需人工审查候选质量 |
| M-011 | 知识库分类和 AI 整理 | `knowledge_items` 可本地生成并在 UI 查看；可选 AI Provider 只在用户触发时调用，API Key 脱敏且不导出 | `0.8.3+` MVP 已实现，需真实文档和测试 Key 抽样验证 |
| M-012 | 大库后台监听稳定性 | 万级文档和约 200MB SQLite 下启动、watcher pending/done/status 不再触发 `sql.js` wasm 内存越界；失败时自动关闭 watcher | `0.8.3+` 已修复 watcher 全量正文读取，需安装版回归 |
| M-013 | Agent Runtime Monitor | 知匣能只读展示 Codex 进程 CPU/内存、线程 session 大小、状态、最近写入、vault/receipt/pointer 状态，并用置信度说明疑似压力来源 | 已补只读策略 + 适配器 + IPC + 前端最小视图 + 复制诊断报告 + 采样节流 + vault/receipt/pointer 证据透传：`electron/agentRuntimeMonitorPolicy.cjs` 覆盖压力评分/置信度/建议并保留 vault manifest/session/hash、compact receipt path、memory pointers；`electron/runtimeMonitorAdapter.cjs` 通过 Windows CIM 采样 agent 进程并合并 Guardian metadata-only session/long-thread 证据；主进程暴露 `runtimeMonitor:getSnapshot`，preload/types 已接入；Agent 页可手动刷新并显示进程排行、session 压力、warnings/recommendations 和 vault/pointer 摘要，复制报告会省略 commandLine/executablePath 并标明 read-only metadata-only 策略；前端不自动轮询，手动刷新有 10 秒冷却；真实安装版抽样和多平台深度适配仍待实现 |
| M-014 | 项目记忆回填 | 从已扫描 documents、Codex outputs、BUG_FIX_MEMORY、AutoFlow completions、Thread History Vault 生成 ProjectRecord、KnowledgeItem、MemoryCard candidate 和 Project Resume Packet | ProjectRecord 运行时启发式聚合已接入 Agent retrieval；已补 `projectRecordOverrides` 人工确认覆盖层，项目总览可确认当前状态/完成度/下一步并让检索优先使用确认值；已补项目文档到 `project_doc` experience card candidate 的回填策略，项目知识导出前会从 PRD/技术设计/测试/报告/README/Codex 输出生成 compact 候选，并显式跳过 raw session 和 `.codex-knowledge` 生成物；已补 `project_artifact` metadata-only 检索和 `.codex-knowledge/project-artifacts.md/json` 导出 MVP，能标记 current / needs_review / superseded、产出角色和 source refs；项目总览现已把 Project Artifacts Map 明确标为 metadata/index governance，并区分 `待确认 / 待复核 / 已确认` snapshot 状态，hash 或 rebuild 变化不会沿用旧确认；per-artifact override、独立持久表和完整治理 UI 仍是 planned |
| M-015 | CEO Flow 线程族谱索引 | 长期 CEO 维护线程能生成 CEOFlowRecord / ThreadLineageIndex，关联项目、专家员工线程、任务卡、验收、handoff、memory pointer 和 vault pointer；Agent 命中 CEO 线程时必须先查族谱索引和 metadata-only 文档索引，不全量搜索巨大 CEO 历史；`npm test` smoke 需覆盖 `project_record`、`ceo_flow_record`、`parentCeoThreadId`、`AGENT_RETRIEVE_CACHE_TTL_MS`、`listDocumentMetas` 或等价 metadata-only 证据 | 已补 `filterCEOFlowRecords` 行为测试，覆盖 `parentCeoThreadId` 先过滤后展开；仍需真实 CEO 线程样本联调 |
| M-016 | Compact receipt 行为闸门 | 主进程必须在本体瘦身成功态前验证 Guardian receipt 明确 `thread_store_compatible=true`，并把 Vault manifest/session/hash 证据写回成功 receipt；缺 receipt 或兼容性证据时 fail closed | 已补 `electron/codexGuardianPolicy.cjs` 和 `tests/compact-policy.test.cjs`，`npm test` 覆盖最小行为；仍需 Electron IPC fixture 和真实 Guardian dry-run 抽样 |
| M-017 | Thread History Vault hash gate | 老线程入库必须验证 Vault copy hash 与 original raw session hash 完全一致；缺 hash 或 hash 不一致时 fail closed，不能生成“已入库/可瘦身”成功态 | 已补 `validateVaultCopyHashes` 行为测试并接入 `npm test`；仍需临时文件级 Vault 写入 fixture 和真实 Guardian sourceRef 抽样 |
| M-018 | Agent retrieval budget gate | Agent 检索必须按排序后的候选执行 topK 和 token budget 裁剪，允许 10% soft budget，预算过小时至少返回第一条高相关结果，但不能无界返回候选集 | 已补 `electron/agentRetrievePolicy.cjs` 和 `tests/agent-retrieve-policy.test.cjs`，`npm test` 覆盖 topK、soft budget、跳过超预算候选和至少返回一条；已补 policy fixture 覆盖 `parentCeoThreadId`、cache key 随 SQLite metadata count/mtime 变化、document metadata-only read plan 和拒绝 unsupported raw-session kind；已补 `electron/documentMetadataPolicy.cjs` 与 `tests/document-metadata-policy.test.cjs`，用真实 sql.js 临时库验证 metadata 查询把 `contentText` 替换为空字面量、preview 查询只返回 capped body；仍需 Electron IPC fixture |
| M-019 | Archive Candidate 行为闸门 | 归档候选必须是只读判断：active/running、最近写入、无 Thread History Vault、hash 不一致、pinned/keep hot、未完成任务或缺 memory pointer 时必须 block；候选结果必须带 reasons/blockers，不能 move/delete/compact | 已补 `electron/archiveCandidatePolicy.cjs` 和 `tests/archive-candidate-policy.test.cjs`，`npm test` 覆盖最小行为；已接入 `normalizeArchiveCandidateEvidence`，把 Guardian optimized envelope、compact receipt、vault manifest/source refs 和 memory pointer 统一为只读候选证据，UI 可显示 vault/pointer evidence；已补 realistic Guardian envelope fixture，保留 compact receipt path / thread-store compatible 证据，并在 receipt 明确 `thread_store_compatible=false` 时 block 为 `compact_receipt_incompatible`；仍需真实 Guardian 样本抽样和 archive receipt 生成流程 |
| M-020 | Project Resume Packet MVP | Agent 检索应先返回可续接的一页项目恢复包，包含项目状态、完成度、最后进展、CEO/worker/reviewer 线索、阻塞项、下一步和 source refs；自动生成结果必须标注 heuristic/review，不冒充用户确认的权威状态 | 已补 `electron/projectResumePolicy.cjs`、`tests/project-resume-policy.test.cjs`，接入 `project_resume_packet` retrieval kind，在项目扫描/知识导出时写出 `.codex-knowledge/project-resume.md`，项目总览可打开并按文件 hash/更新时间保存确认状态；已补只允许改写 `.codex-knowledge/project-resume.md` 的 Markdown 编辑入口，保存后写回文件并重建索引；仍需更细的 ProjectRecord 持久化 |

## 下一阶段建议由 Codex 执行

| 编号 | 建议 | Codex 应交付 | 验证方式 |
| --- | --- | --- | --- |
| N-001 | 后台文件监听 | 监控已导入路径和 Codex 工作区变更，自动提示或自动重新索引 | 已实现，待外部机器和大目录复验 |
| N-002 | 项目配置页 | 允许用户合并/拆分项目、指定项目根目录、排除目录 | 多项目父目录和 monorepo 手工测试 |
| N-003 | 版本 diff/回滚 | UI 展示历史版本、差异和恢复入口 | 修改同一路径文档后验证版本列表 |
| N-004 | 项目知识质量评分 | 标记缺 README、缺测试说明、知识文件过期、来源过少等问题 | 构造不同质量项目并检查评分 |
| N-005 | 更强本地索引 | 引入更稳定的本地全文索引或 FTS 表，提升排序和大库性能 | 大量文档搜索压测 |
| N-006 | Codex 查询入口 | 提供给 Codex 查询知匣知识的本地接口或脚本，不只读项目文件 | `read-project-knowledge.cjs --query/--limit/--json` 已覆盖项目文件、知识条目、经验卡片和 Skill 候选；后续可做更强本地接口 |
| N-007 | 自动化 UI 测试 | 使用 Playwright 或等价方案覆盖主要界面流程 | CI/本地命令可重复运行 |
| N-008 | 经验卡片治理 | 支持 accepted/curated/archived 的人工筛选、批量归档和质量评分 | 构造不同来源卡片并验证导出只保留 compact 高价值内容 |
| N-009 | 多平台 agent 监控适配器 | 在 Codex MVP 稳定后扩展 Claude Code、OpenClaw/AutoFlow 和 Generic CLI 适配器 | 先证明 Level 1/2 进程和 cwd/命令级监控，再做任务语义级监控 |
| N-010 | 老线程归档候选 | 知匣/Guardian 生成 hot/warm/cold/archive candidate，不自动 move/delete；CEO Flow 只消费 receipt/pointer 和验收状态 | 用长期不用线程样本验证：无 Vault 不可归档，active/running 不可归档，归档结果可检索 |

## 每轮 Codex 完成后的检查

- 是否更新 README、PRD、技术设计、测试计划、发布说明和项目评估。
- 是否运行 `npm test`。
- 是否运行 `npm run build`。
- 是否运行 `npm audit --omit=dev`。
- 如果涉及安装包、Skill 或 Electron 主进程，是否重新运行 `npm run package:installer`。
- 如果涉及 watcher、SQLite 查询或大库性能，是否用真实大库或等价压力数据确认不会全量拉取 `contentText`。
- 是否记录新风险、已知限制和下一步建议。
- 如果涉及 AutoFlow 经验导入，是否确认未修改 `C:\Users\example\Documents\AutoFlow`、未复制完整日志/聊天/会话文件、未自动安装 Skill。
- 如果涉及 AI 整理，是否确认默认离线、联网必须用户触发、API Key 不明文回显、不写入 `.codex-knowledge/` 或经验卡片。
