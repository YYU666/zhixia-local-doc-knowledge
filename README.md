# 知匣 / Zhixia Local Doc Knowledge

知匣是 CEO Flow 的官方本地优先 Memory Runtime，也可以独立作为 Windows 桌面端的本地文档、知识和项目记忆管理器使用。

它的目标不是把聊天记录或 Markdown 堆得更大，而是把项目资料、历史经验、工具线索和可复用模式整理成 compact、可引用、可审计的本地记忆包，让 Codex / CEO Flow 在派工、评审、复盘和续接项目时能用更少 token 找到正确上下文。

## 它是什么

- 本地优先的 Electron + React + SQLite 桌面应用。
- CEO Flow 的官方 Memory Runtime：提供 `retrieve_context`、`retrieve_precedent`、`writeback_evidence`、`promote_memory` 等合约能力。
- 项目知识库：按真实项目组织文档、历史、知识条目、经验卡片、工具/Skill 线索。
- 可独立使用的本地文档知识库：支持导入、搜索、标签、摘要、项目页、个人库和手动扫描。
- 面向 Codex 的 compact retrieval layer：默认返回 metadata、summary、sourceRefs、freshness/status 和 token estimate，而不是完整聊天或巨型 Markdown。
- 当前是中文优先的本地桌面工具；英文文档主要服务开源协作和 CEO Flow contract 说明，尚未提供完整 i18n。

## 它不是什么

- 不是云同步服务，默认不上传用户文档。
- 不是自动清理或删除用户数据的工具。
- 不是 Codex session 的 archive/compact/delete/move/restore 执行器；任何破坏性操作都必须由用户或宿主环境显式确认。
- 不是自动安装、导出或执行 FlowSkill 的工具；Skill/FlowSkill 相关输出默认是私有候选和 review metadata。
- 不是把所有扫描到的文件夹都叫“项目”的索引器；低置信资料会进入“待整理线索”或个人库，而不是污染项目卡片。

## CEO Flow 集成

CEO Flow 可以把知匣当作本地 Memory Runtime：

1. 启动或续接项目时调用 `retrieve_context(task_goal)`，拿到当前项目的 compact context。
2. 派工前调用 `retrieve_precedent(task_type)`，查找相似任务、已接受经验和工具线索。
3. 评审结束后调用 `writeback_evidence(result)`，把接受/修订/阻塞证据写入 app-owned inbox。
4. 发现安全、可复用的模式时调用 `promote_memory(candidate)`，排队私有候选，等待人工 review。

详细合约、provider modes、请求/响应示例和安全边界见 [docs/CEO_FLOW_MEMORY_RUNTIME.md](docs/CEO_FLOW_MEMORY_RUNTIME.md)。

## 核心能力

- 文档导入和本地搜索：支持常见文本、Markdown、PDF、Word、CSV 等本地资料。
- 项目识别：用 PRD、技术设计、测试计划、README、Codex 历史、知识/记忆等组合证据识别真实项目。
- 个人库与待整理线索：单条链接、截图、剪贴板、视频、构建产物、备份、日志、依赖目录和生成知识文件不会作为普通项目卡片展示。
- Memory Runtime：返回 compact context packet、precedent packet、evidence receipt、working memory 和私有候选。
- Codex Skill helper：仓库内提供 `codex-skills/zhixia-local-docs`，便于 Codex 读取项目知识包或生成 evidence dry-run。
- 只读运行诊断：可展示本地进程和历史压力线索，但不 kill、不清理、不擅自修改 Codex 会话。
- FlowSkill candidate bridge：接受且 source-backed 的 reusable pattern 可以生成私有 review 候选；不会自动安装、公开导出或执行。

## 本地优先隐私模型

- 默认数据保存在用户本机应用数据目录和项目工作区内。
- 默认不上传用户文档。可选 AI 整理只在用户配置 API Key 并主动点击测试连接、AI 整理或项目摘要生成时调用可信 HTTPS Provider；此时会把待整理文本发送给该 Provider。
- 默认 retrieval 是 metadata-first：不读取 raw session body，不返回巨大 Markdown，不携带截图/base64/长日志/密钥。
- Evidence writeback 保存 compact JSON receipt；没有 sourceRefs 的证据只能作为 advisory/candidate。
- Raw session、secret、credential、token、private key、public export、install、execute、archive、compact、delete、move、restore 等信号会 fail closed，进入 review/blocked。
- `.codex-knowledge/`、vault、backups、SQLite 数据库、日志、导出包和本地 evidence 默认不应该提交到公开仓库。

## 快速开始

需要 Node.js 和 npm。首次克隆后安装依赖：

```powershell
npm install
```

开发运行：

```powershell
npm run dev
```

测试：

```powershell
npm test
```

构建 renderer 和主进程类型检查：

```powershell
npm run build
```

公开 source-only 仓库默认不包含 Windows 安装器脚本或打包命令；二进制发布流程应在签名、安装器和分发策略完成后单独维护。公开 staging 的默认 `npm test` 运行源码级政策、契约和 helper 测试；依赖 `sql.js` 的数据库测试和 Electron 安装版 E2E 属于完整开发环境 / 维护者 release gate。


在 source-only public staging 里，package metadata 会被收窄到开发、构建、测试和 `prepare:public`。安装包、签名、portable、fresh-user 验收属于维护者 release gate，不是普通公开源码使用者的默认流程。

## 公开仓库范围

推荐 GitHub 仓库采用 source-only 布局：

- 包含：`electron/`、`src/`、`tests/`、`docs/` 中的公开文档、`codex-skills/zhixia-local-docs/`、`assets/`、`scripts/`、配置文件。
- 排除：`.codex-knowledge/`、`release/`、`dist/`、`node_modules/`、用户数据库、vault、backups、logs、screenshots、私有 evidence、真实运行记录、安装包。

发布前请按 [docs/PUBLICATION_CHECKLIST.md](docs/PUBLICATION_CHECKLIST.md) 复核。推荐布局见 [docs/PUBLIC_REPO_LAYOUT.md](docs/PUBLIC_REPO_LAYOUT.md)。

## 文档

- [CEO Flow Memory Runtime](docs/CEO_FLOW_MEMORY_RUNTIME.md)
- [External Audit Requirements](docs/EXTERNAL_AUDIT_REQUIREMENTS.md)
- [Technical Design](docs/TECHNICAL_DESIGN.md)
- [Test Plan](docs/TEST_PLAN.md)
- [Release Notes](docs/RELEASE_NOTES.md)
- [Publication Checklist](docs/PUBLICATION_CHECKLIST.md)
- [Public Repo Layout](docs/PUBLIC_REPO_LAYOUT.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

部分历史设计、运行验证和产品化记录仍保留在 `docs/` 中，可能包含仅适合维护者内部复核的路径、运行证据或历史决策。真正公开发布前，应按 publication checklist 选择公开文档集，不要直接上传整个工作目录的私有生成物。

## 当前成熟度

知匣已包含可执行的 Memory Runtime policy、IPC、helper tests、Electron e2e 和 smoke guards，但仍处于快速产品化阶段：

- Memory Runtime 和项目识别策略是 conservative heuristic + tests，不是云端权威知识图谱。
- 图谱/“神经网络式记忆”是 bounded metadata activation：默认快速读取 Hot/Warm/Skill，Cold 长历史只作为恢复/审计等显式场景的 source pointer，不会后台全量读 raw history。
- FlowSkill 输出仍是私有 candidate/review，不是自动推广系统。
- Archive/compact/restore/delete 等破坏性动作不属于默认 Memory Runtime 行为。
- `sql.js` 仍适合个人/小团队本地库；超大库和长期高频写入需要未来迁移到更强的存储/索引架构。
- `electron/main.cjs` 和 `src/App.tsx` 仍需继续拆分，前端列表虚拟化、搜索防抖、CI/lint/formatter 和更多真实行为测试仍是后续工程债。
- 公开发布前必须运行 source-only staging 和隐私扫描，重点检查私有路径、真实 thread IDs、生成知识包、release artifacts 和本地数据库是否被排除。

## License

MIT. See [LICENSE](LICENSE).
