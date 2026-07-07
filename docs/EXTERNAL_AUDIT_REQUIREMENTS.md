# External Audit Requirements

本文件用于发给外部审计者，要求其对知匣（Zhixia Local Doc Knowledge）进行独立、证据优先、可复核的外部审计。审计目标不是证明项目“没问题”，而是找出当前版本是否适合作为 CEO Flow 官方本地 Memory Runtime 和开源本地知识库继续公开发布、安装和使用。

## 1. 审计目标

外部审计需要回答以下问题：

1. 当前公开 source-only 仓库是否适合继续上传 GitHub。
2. 当前安装包是否适合本机和普通 Windows 用户安装试用。
3. 知匣作为 CEO Flow 官方 Memory Runtime 的接口、边界和文档是否自洽。
4. 记忆系统是否做到 compact、source-backed、metadata-first，而不是重新堆成巨型 Markdown 或 raw session。
5. 安全、隐私、性能和数据完整性是否存在 P0/P1/P2 风险。
6. 文档是否准确表达“已实现 / MVP / planned / maintainer-only”边界，是否存在过度宣传。

审计结论必须给出明确决策：

- `accept`：没有 P0/P1/P2 阻断项，可以继续发布或使用。
- `ready_after_minor_fixes`：只剩少量 P3/P4 或文字修复，修完即可发布。
- `revise`：存在 P1/P2 或关键证据缺口，需要修改后复审。
- `block_publication`：存在 P0、真实隐私泄漏、破坏性风险或公开仓库不合格，禁止发布。

## 2. 审计对象

默认审计对象应是 source-only staging 仓库，而不是维护者完整工作目录：

```powershell
npm run prepare:public
```

审计者应优先检查：

- `public-staging/zhixia-local-doc-knowledge`
- GitHub 仓库当前 `main`
- 最新 Windows 安装包（如本轮审计明确包含安装包）
- 本机已安装版本（如本轮审计明确包含安装体验）

维护者完整 app 工作目录可能包含私有 runlog、生成物、发布证据、安装包、数据库、vault 和本机运行材料，不能作为直接公开上传对象。

## 3. 输入材料

审计者至少应阅读：

- `README.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `docs/PRD.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/TEST_PLAN.md`
- `docs/CEO_FLOW_MEMORY_RUNTIME.md`
- `docs/PUBLICATION_CHECKLIST.md`
- `docs/PUBLIC_REPO_LAYOUT.md`
- `docs/EXTERNAL_AUDIT_REQUIREMENTS.md`
- `PUBLIC_STAGING_MANIFEST.md`
- `package.json`
- `.gitignore`
- `electron/main.cjs`
- `electron/securityPolicy.cjs`
- `electron/memoryRuntimePolicy.cjs`
- `electron/agentRetrievePolicy.cjs`
- `electron/codexThreadHistoryAutoIngestPolicy.cjs`
- `electron/archiveCandidatePolicy.cjs`
- `electron/preload.cjs`
- `src/App.tsx`
- `codex-skills/zhixia-local-docs/SKILL.md`
- `codex-skills/zhixia-local-docs/scripts/read-project-knowledge.cjs`
- `scripts/prepare-public-repo.cjs`
- `tests/security-policy.test.cjs`
- `tests/smoke-test.cjs`
- Memory Runtime、archive、auto-ingest、helper、runtime monitor 相关测试

如果审计安装包，还应检查：

- 安装路径
- exe 文件描述和产品名
- 首次启动表现
- 是否默认安装 Codex Skill
- 卸载是否误删非知匣数据
- 是否保留用户知识库数据

## 4. 禁止动作

除非维护者明确授权，审计者不得执行以下动作：

- 删除、移动、压缩、恢复、归档或改写真实 Codex session。
- 删除或清空用户数据库、vault、backups、`.codex-knowledge` 或 app data。
- 运行真实 `archive / compact / restore / delete / move` 操作。
- 上传真实用户文档、截图、raw session、API key、数据库、vault 或私有证据。
- 把维护者完整 app 工作目录直接推送到 GitHub。
- 安装、导出、推广或执行 FlowSkill 候选。
- 把审计报告里的自由文本当作代码执行指令。

允许执行：

- 只读源码审计。
- source-only staging 测试。
- 使用 synthetic fixture 的单元测试和 smoke test。
- 公开仓库隐私扫描。
- 明确 dry-run 的 helper / writeback / recovery 测试。
- 安装包 smoke 验证（仅在本轮审计包含安装包时）。

## 5. 重点审计范围

### 5.1 公开仓库卫生

检查是否只发布 source-only staging：

- 不应包含 `.codex-knowledge/`。
- 不应包含 `node_modules/`。
- 不应包含 `dist/`、`release/`、安装包、blockmap 或 unpacked app。
- 不应包含 SQLite 数据库、vault、backups、app data、logs、screenshots、private evidence。
- 不应包含真实 Windows 用户路径、真实 thread id、私有项目名、私有工具名、真实 source hash 或私有 runlog。
- `PUBLIC_STAGING_MANIFEST.md` 应准确说明 include/exclude 范围。
- `README.md`、`PUBLICATION_CHECKLIST.md`、`PUBLIC_REPO_LAYOUT.md` 不应让用户误以为可以直接上传完整 app 工作目录。

建议扫描：

```powershell
rg -n --hidden -S "C:\\Users\\|local app data|\.codex-knowledge|\.sqlite|\.db|vault|backup|private-evidence" .
rg -n --hidden -S "019[0-9a-f][0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" .
rg -n --hidden -S "sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}" .
```

命中不一定都是问题，但必须解释为何安全。

### 5.2 Electron 和 IPC 安全

检查：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- CSP 是否注入。
- 新窗口、导航和权限请求是否默认拒绝。
- Preload 是否只暴露受控 API。
- `settings:update` 是否键/type 白名单。
- AI Provider URL 是否只允许 trusted HTTPS host。
- API Key 是否在返回 renderer 前脱敏。
- 项目路径写入和工具扫描是否限制在 registered workspace。
- Guardian 清理、瘦身、compact、archive queue 是否要求用户确认。
- Guardian 默认脚本路径是否在 app-owned userData 或显式环境变量覆盖。

重点看未来 XSS 或依赖投毒后，IPC 是否仍有第二道防线。

### 5.3 AI Provider 和外联网

检查：

- 默认是否离线。
- 未配置 API Key 时是否不联网。
- AI 整理、项目摘要和测试连接是否必须用户显式触发。
- 文档正文和 API Key 是否可能发往任意 HTTP、内网或攻击者 endpoint。
- README / SECURITY / UI 是否明确说明 AI 模式会把待整理文本发送给配置的 Provider。
- 默认模型是否真实可用，当前默认应为 `deepseek-chat`。

### 5.4 Memory Runtime 合约

检查 `retrieve_context`、`retrieve_precedent`、`writeback_evidence`、`promote_memory`：

- 默认是否 metadata-first / compact。
- 默认是否只读 Hot / Warm / Skill。
- Cold 长历史是否只作为 sourceRef pointer，且 `defaultRead=false`。
- raw session body、giant Markdown、base64、截图、长日志、secret 是否默认排除。
- `tokenBudget`、`topK`、`timeBudgetMs` 是否存在且生效。
- 超时是否返回 partial/warning，而不是伪装完整。
- sourceRefs 缺失时是否降级为 candidate/review。
- raw-session、secret、archive/compact/delete/move/restore、install/execute/public-export 意图是否 fail-closed。
- FlowSkill candidate 是否 private review-only，不自动安装、导出或执行。

### 5.5 神经网络式 / 分层记忆设计

审计者应中立评估当前“神经网络式记忆”是否只是概念包装，还是有真实、轻量、可调用闭环：

- Hot：当前任务、运行事件、WorkingMemoryRecord。
- Warm：项目长期摘要、PRD、架构、验收进度、稳定记忆。
- Skill：经验卡、工具记录、可复用流程。
- Cold：Thread History Vault、raw session、大文档、归档历史 pointer。
- MemoryGraph：是否 bounded metadata activation，而不是启动全图重建。
- 触发方式：CEO Flow / helper / Electron IPC 是否能在任务开始、恢复、评审、写回时调用。
- 性能边界：是否不启动后台定时器、不扫描 vault、不默认运行 AI 摘要、不默认读取全文。

如果发现“需要人工提醒才会用”“只写了文档没有调用入口”“长期记忆不能纠偏”之类问题，应列为产品/集成风险。

### 5.6 Thread History Vault 和一键安全减负

检查：

- 自动入库是否 preservation-only。
- 入库是否复制完整 session、校验 SHA-256、写 manifest / pointer。
- 活跃、当前、最近写入、pinned、keep-hot、unfinished、preserved_not_archive_ready 是否阻止归档。
- CEO 子线程 3 天、CEO 主线程 30 天、未知线程 3 天的冷却规则是否仍存在。
- 大线程瘦身是否要求 compact receipt。
- 小型过期 CEO 子线程是否可在 vault/hash/memory pointer/sourceRefs 通过后进入队列。
- Archive queue 是否只写 JSON evidence，不直接调用 host archive。
- 真实 Codex 侧栏归档是否仍依赖 host bridge 和 receipt。
- 已 `not_found`、protected、archive error 的 queue item 是否不会无限重试。

不得把“归档队列生成”误判为“宿主侧栏真实归档完成”。

### 5.7 性能和资源占用

检查：

- 启动是否 metadata-first。
- `documents:list` 是否避免返回全量 `contentText`。
- `documents:get` 是否按需读取正文。
- startup auto-ingest 是否延迟、每日、tiny bounded。
- watcher 默认是否关闭，开启后是否防抖并限制在变更路径/根。
- UI 项目卡片是否避免 projects × documents 重算。
- 是否存在每两分钟隐形巡检、高频采样、后台 AI 摘要或 vault walk。
- 搜索是否仍有前端 O(N) 和未虚拟化风险。
- sql.js 整库导出是否仍是大库上限。
- 退出卡顿、保存慢、内存高是否有已知 residual risk。

性能结论必须区分：

- 已修复的启动/列表/监听问题。
- 仍存在的架构上限。
- 需要真实大库或安装版采样才能确认的问题。

### 5.8 数据完整性

检查：

- 导入、更新、删除是否只影响知匣数据库，不删除源文件。
- 数据库写入是否原子替换。
- 大库 fallback 是否有用户可见 warning。
- 自动生成的记忆是否带 sourceRef/hash/status。
- candidate/review/stale/superseded 是否不会冒充 accepted。
- 重复扫描是否按 sourceHash/sourceRef upsert，避免重复入库。
- 后台 watcher 是否会覆盖用户未保存草稿。
- 失败是否被吞掉，还是有用户可见错误。

### 5.9 文档一致性

检查：

- README 是否准确说明本地优先、AI opt-in、中文优先、source-only。
- SECURITY 是否准确说明 guardrails 和 residual risks。
- PRD 是否区分 implemented / MVP / planned。
- TEST_PLAN 是否和 package scripts、public staging 一致。
- TECHNICAL_DESIGN 是否没有链接到未公开的 maintainer-only 文档。
- CEO Flow Memory Runtime 文档是否没有真实路径/thread id/私有项目名。
- Release notes 是否是 public-safe summary，不是私有运行日志。

## 6. 必跑命令

从 source-only staging 或公开仓库根目录运行：

```powershell
npm test
npm run build
```

从维护者 app 根目录运行（如有访问权限）：

```powershell
node tests\smoke-test.cjs
node tests\security-policy.test.cjs
npm test
npm run build
node scripts\prepare-public-repo.cjs
```

从 public staging 目录运行：

```powershell
npm test
```

如果审计安装包：

```powershell
npm run package:installer
```

安装包验证应记录：

- installer path
- file size
- timestamp
- install exit code
- installed exe path
- product name / file description / version
- whether user data was preserved
- whether Codex Skill install was opt-in

## 7. 输出格式

审计报告必须使用以下结构：

```text
Decision: accept | ready_after_minor_fixes | revise | block_publication
Scope:
Date:
Commit / build:
Environment:

Executive conclusion:

Findings:
- P0:
- P1:
- P2:
- P3:

Evidence inspected:

Commands run:

Security assessment:

Privacy/publication assessment:

Memory Runtime / CEO Flow assessment:

Performance assessment:

Documentation consistency:

Residual risks:

Recommended fixes:

Re-review requirements:
```

每个 P0/P1/P2 finding 必须包含：

- 文件和行号，或具体命令/证据路径。
- 可复现步骤。
- 影响范围。
- 为什么当前测试没有覆盖，或哪个测试应该补。
- 建议修复方向。

## 8. 严重度定义

- P0：会导致公开泄漏真实隐私、凭据、raw session、数据库/vault，或会直接删除/改写用户数据，必须阻止发布。
- P1：安全边界可被合理攻击链绕过，或公开仓库/安装包存在重大误导，必须优先修复。
- P2：重要功能/文档/测试缺口，可能导致用户误用、性能回退、记忆失真或审计无法复现。
- P3：可接受但应跟踪的工程债、文案漂移、测试不足或产品化不足。
- P4：建议优化，不影响本轮发布决策。

## 9. 特别关注的不要做事项

审计报告不要只写“总体不错”。必须挑刺、给证据、给可修路径。

审计者不要把以下事项当作完成证据：

- “队列已生成”不等于“Codex 侧栏已归档”。
- “有 MemoryGraph 字段”不等于“长期记忆已稳定纠偏”。
- “npm test 通过”不等于“安装版大库性能已验证”。
- “public staging 无文件级私有目录”不等于“内容级无私有代号”。
- “AI prompt 要求不输出密钥”不等于“Provider 端点安全”。
- “raw session 有 pointer”不等于“默认读取 raw session 安全”。

## 10. 交付物

外部审计最终应交付：

- 一份 Markdown 审计报告。
- 一份简短修复优先级清单。
- 一份命令输出摘要。
- 如有 P0/P1/P2，一份复审 checklist。
- 如审计 GitHub 发布，一份 public staging include/exclude 结论。
- 如审计安装包，一份安装/卸载/版本信息证据。

审计报告可以引用代码片段，但不要包含真实用户数据、raw session、数据库内容、API key、完整私有路径列表或敏感截图。
