# Agent Runtime Monitor 设计

## 1. 背景

用户同时使用 Codex、Claude Code、OpenClaw、AutoFlow 等 agent 工具后，系统卡顿不再只来自“线程历史太长”。实际问题可能来自 Electron renderer 高 CPU、错误线程反复刷新、CLI worker 长时间运行、日志膨胀、后台任务无输出、会话文件过大、或者多个 agent 工具同时活跃。

普通任务管理器只能告诉用户哪个进程占 CPU/内存，不能回答：

- 是哪条 Codex 线程拖慢了界面。
- 哪个项目的 agent 正在大量工作。
- 哪个线程历史最大，是否已经被知匣入库和瘦身。
- 哪个错误线程应该关闭或重开。
- 当前应该优化 session、重启 Codex、等待任务完成，还是检查日志。

Agent Runtime Monitor 的目标是把“进程压力、线程历史、运行状态、知匣记忆和可执行建议”合到一个本地面板里。

## 2. 产品定位

Agent Runtime Monitor 是知匣的本地 agent 控制塔，不是通用系统监控工具。

它与 Windows 任务管理器的区别：

- 任务管理器看进程；知匣监控看 agent、项目、线程、会话和历史状态。
- 任务管理器给资源数字；知匣监控给上下文解释和下一步建议。
- 任务管理器不知道 Thread History Vault；知匣知道哪些线程已入库、已瘦身、可召回。
- 任务管理器不能区分 active/systemError/notLoaded；知匣能结合 Codex thread 状态和 session 文件判断风险。

它与知匣知识库的关系：

- 知识库保存文档、经验、线程历史和 hot/warm/cold 记忆。
- 监控台观察本机 agent 运行状态，并把需要长期记住的诊断、修复经验或风险写回知识库候选。
- 监控台不替代知识库，也不默认读取 raw session。它优先使用摘要、指针、回执和元数据。

## 3. 平台适配器架构

采用 adapter 模型，不把产品写死为 Codex 专用。

```text
Agent Runtime Monitor
  ├─ ProcessSampler
  ├─ SessionIndexer
  ├─ AttributionEngine
  ├─ RecommendationEngine
  └─ PlatformAdapters
       ├─ CodexAdapter
       ├─ ClaudeCodeAdapter
       ├─ OpenClawAdapter
       ├─ CursorAdapter
       ├─ WindsurfAdapter
       └─ GenericCliAdapter
```

每个适配器输出统一结构：

- 进程样本：CPU、内存、PID、父进程、命令行、可执行路径。
- 会话/线程样本：threadId/sessionId、标题、项目路径、状态、历史大小、最近写入。
- 平台能力声明：能否做线程级归因、能否读工作目录、能否读任务队列、能否读取日志。
- 风险和建议：高 CPU、systemError、长时间无输出、日志膨胀、历史过大、未入库。

## 4. 能力分级

不同 agent 平台能拿到的信息不同，产品必须分层展示，不能夸大精度。

### Level 1：进程级监控

所有平台都能做。

- 进程名
- PID
- CPU 百分比
- 内存
- 启动时间
- 父子进程关系
- 命令行

适用平台：

- Codex
- Claude Code
- OpenClaw
- Cursor
- Windsurf
- Gemini CLI
- 其他 CLI runner

局限：

- 只能知道哪个程序吃资源，不能自动知道是哪条任务。

### Level 2：工作目录 / 命令级监控

CLI 工具更容易做到。

- 当前 cwd
- 正在执行的命令
- 最近输出时间
- 是否长时间无输出
- 是否有活跃子进程
- 是否可能卡在 install/build/test

适用平台：

- Claude Code
- OpenClaw
- AutoFlow worker
- Gemini CLI
- 普通 shell runner

局限：

- 仍然不一定知道高层业务任务是什么，需要任务队列或日志辅助。

### Level 3：线程 / 会话级监控

Codex 优先支持。

- threadId
- thread title
- thread status
- session JSONL 路径
- session 大小
- 最近写入时间
- 是否含 `ZhixiaHistoryId`
- 是否有 Thread History Vault
- 是否有 compact receipt
- 是否可被 Codex thread-store 读取

局限：

- Electron renderer 进程不一定带 threadId。CPU 到线程的映射只能通过 active thread、最近写入、窗口状态、systemError、session 活动等证据给出置信度。

### Level 4：语义级监控

依赖知匣知识和 agent 自身日志。

- 当前任务目标
- 是否在重复失败
- 是否等待用户授权
- 是否同一 write-set 多 agent 冲突
- 是否需要写回经验卡
- 是否建议 CEO 接管或暂停某条 lane

适用场景：

- AutoFlow
- CEO Thread Orchestrator
- OpenClaw worker pool
- 后续 Claude Code task ledger

局限：

- 需要平台日志、任务队列、completion ledger 或可读报告。不能凭进程 CPU 推断业务语义。

## 5. CodexAdapter MVP

Codex 是第一阶段重点，因为它已经有：

- `.codex/sessions`
- `.codex/archived_sessions`
- Guardian report / receipts
- Thread History Vault
- `codex-history:<threadId>` knowledge item
- Codex App thread tools

### 采集输入

- Windows 进程：`Codex.exe`、`codex.exe`、`node_repl`。
- Codex sessions：JSONL 文件大小、mtime、threadId、session metadata。
- Codex thread list：title、status、cwd、updatedAt。
- Guardian report：largest session files、logs、process manager stale entries。
- Compact receipts：before/after bytes、compatibility、backup path、hash。
- Zhixia vault：`latest.json`、manifest hash、hot/warm/cold policy。
- Knowledge store：`codex-history:<threadId>` 条目。

### 输出字段

```ts
type CodexThreadRuntimeRow = {
  threadId: string
  title: string
  status: "active" | "idle" | "systemError" | "notLoaded" | "unknown"
  cwd?: string
  sessionPath?: string
  sessionBytes?: number
  lastWriteTime?: string
  hasZhixiaHistoryPointer: boolean
  hasThreadHistoryVault: boolean
  hasCompactReceipt: boolean
  compactCompatible?: boolean
  beforeCompactBytes?: number
  afterCompactBytes?: number
  savedBytes?: number
  pressureScore: number
  suspectedCpuCause: boolean
  attributionConfidence: "low" | "medium" | "high"
  recommendation: string
}
```

### 压力评分

第一版使用可解释规则，不引入黑盒模型。

加分项：

- `status=active`
- `status=systemError`
- session 大于阈值
- 最近 5 分钟写入
- Codex renderer CPU 高
- app-server CPU 高
- 未入库 / 未瘦身
- Guardian logs/trace 过大
- process_manager stale_count 高

降分项：

- `status=notLoaded`
- 最近未写入
- 已有 vault + receipt + pointer
- session 已低于阈值

示例解释：

```text
疑似来源：Example Project 中立发布审计线程
置信度：medium
原因：线程 status=systemError，最近 1 分钟更新；Codex renderer CPU 高；session 正在增长。
建议：先关闭该错误线程，观察 CPU 是否下降；如仍卡，重启 Codex。
```

## 6. UI 设计

### 6.1 总览区

- 当前 Codex CPU / 内存
- 当前 Claude Code CPU / 内存
- 当前 OpenClaw / AutoFlow worker CPU / 内存
- 高 CPU renderer 数量
- systemError 线程数量
- 未优化大线程数量
- 最近 5 分钟写入线程数量

### 6.2 平台 Tab

Tab：

- All agents
- Codex
- Claude Code
- OpenClaw / AutoFlow
- Other CLI

每个平台展示：

- 进程列表
- 会话 / 线程列表
- 项目分组
- 风险提示
- 建议动作

### 6.3 Codex 线程排行

默认列：

- 风险
- 线程标题
- 状态
- 项目路径
- session 大小
- 最近写入
- 入库状态
- 瘦身状态
- 疑似 CPU 归因
- 建议

筛选：

- 只看 active
- 只看 systemError
- 只看超过 5MB / 8MB / 20MB
- 只看未入库
- 只看未瘦身
- 只看最近 10 分钟写入

### 6.4 线程详情

详情包含：

- session metadata
- first line threadId 校验
- BOM / thread-store 兼容状态
- latest compact receipt
- vault manifest
- hot/warm/cold policy
- 最近写入曲线
- 可复制诊断报告

### 6.5 操作区

第一版操作保持保守：

- 复制诊断报告
- 刷新采样
- 打开 vault manifest 所在目录
- 跳转知匣知识条目
- 建议关闭线程 / 重启 Codex
- 跳转老线程管理执行显式优化

默认不提供：

- 直接 kill 进程
- 自动删除日志
- 自动 compact session
- 自动 restore

## 7. Claude Code / OpenClaw 扩展思路

### Claude Code

可采集：

- `claude` / `Claude` 进程
- 命令行和 cwd
- 当前 shell 子进程
- 项目目录
- 最近输出时间
- 日志目录（后续确认）

第一版只能做到 Level 1-2。是否能做到任务级，要看 Claude Code 是否有稳定本地 session/log 格式。

### OpenClaw / AutoFlow

可采集：

- OpenClaw worker 进程
- AutoFlow `state/` 下任务队列、leases、completion ledger、worker heartbeat
- `output/completions` 报告
- running/review_pending/writeback_pending 状态

OpenClaw/AutoFlow 比 Codex 更容易做到语义级监控，因为 workflow 自己有状态机和任务队列。

可显示：

- 哪个 worker 正在跑
- 哪个任务 stuck
- 哪个 lease 过期
- 哪个任务高 CPU 但无报告
- 哪个任务无 CPU 但状态仍 running

## 8. 数据存储策略

MVP 可以不持久化所有采样，只保留内存中的最近窗口。

推荐：

- 最近 5 分钟高频采样：内存。
- 最近 1 小时低频聚合：可选写入 SQLite。
- 卡顿事件和用户复制的诊断报告：可选写入 experience card candidate。
- 不保存完整命令输出、raw session、API key、token。

后续表：

```sql
runtime_process_samples
runtime_session_snapshots
runtime_incidents
runtime_recommendation_events
```

但第一版可以先不建表，用 IPC 实时查询和前端状态展示。

## 9. 安全边界

- 监控默认只读。
- 不自动 kill 进程。
- 不自动删除日志。
- 不自动 compact session。
- 不读取 cold/raw session。
- 不上传采样数据。
- 不展示 API key、token、password。
- 命令行展示需要脱敏。
- 自动建议必须说明证据和置信度。

## 10. MVP 范围

第一阶段只做 Codex：

- Codex 进程 CPU/内存采样。
- Codex renderer/main/app-server 分类。
- session 文件排行。
- thread list + session metadata 对齐。
- Thread History Vault / pointer / compact receipt 状态。
- systemError / active / idle / notLoaded 列表。
- 疑似压力来源和置信度。
- 复制诊断报告。

不做：

- 自动结束进程。
- 自动清日志。
- 自动恢复 session。
- 强行把 renderer CPU 映射成 100% 确定线程。
- 多平台深度适配。

## 11. v0.9 范围

- Claude Code Level 1-2 适配器。
- OpenClaw/AutoFlow 状态适配器。
- 采样曲线。
- 卡顿事件记录。
- 诊断报告入库为 experience card candidate。
- 中型线程优化建议：5-8MB 未入库线程。
- 线程打开前后 CPU 差异检测。

## 12. v1.0 范围

- 多 agent 项目级控制塔。
- agent health score。
- 长时间 stuck 检测。
- worker / thread lane 映射。
- CEO Flow 任务图联动。
- 可配置平台适配器。
- 导出匿名诊断包（用户显式触发）。

## 13. 验收标准

MVP 验收：

- 能列出 Codex 相关进程并区分 main / renderer / gpu / app-server。
- 能采样 CPU/内存，并在 3-5 秒内刷新。
- 能列出最大 session 文件并解析 threadId。
- 能显示 thread title/status/cwd。
- 能显示是否有 Zhixia pointer、vault、compact receipt。
- 能识别 systemError 线程。
- 能给出至少 5 类建议：等待、关闭错误线程、重启 Codex、优化线程、检查日志。
- 诊断报告能复制，且不包含 API key/token。

质量门槛：

- 不因为监控页面打开而显著增加 Codex 或知匣 CPU。
- 默认不读取完整 session 正文。
- 大于 100MB session 也只读 metadata / first line / pointer 检测。
- Electron 安装版 `app.asar` 必须包含新监控 IPC 和 UI token。

## 14. 风险

- Electron renderer 无法可靠映射 threadId：必须用置信度表达。
- 采样过频会反过来造成性能压力：需要防抖和上限。
- 读取命令行可能包含敏感信息：必须脱敏。
- 多平台适配容易范围膨胀：先 Codex，后 Claude Code/OpenClaw。
- 用户可能误以为建议是系统确定结论：UI 必须显示证据链。
- 过度自动化会伤 session：第一版保持只读。

## 15. 推荐实现顺序

当前实现状态：

- 已实现：纯策略层 `electron/agentRuntimeMonitorPolicy.cjs`，覆盖进程样本归一化、session 元数据归一化、压力评分、CPU 归因置信度、保守建议和 snapshot 排行。
- 已实现：只读适配器 `electron/runtimeMonitorAdapter.cjs`，通过 Windows CIM 采样 agent 进程，并从 Guardian report / long-thread compact metadata 合并 session 大小、最近写入、vault/pointer 证据；明确 `rawSessionPolicy=metadata_only_no_raw_body`。
- 已实现：主进程 IPC `runtimeMonitor:getSnapshot`，preload 和 renderer 类型已暴露 `getRuntimeMonitorSnapshot()`。
- 已实现：Agent 页最小监控视图，手动刷新 snapshot，展示进程排行、session 压力排行、metadata-only provenance、warnings/recommendations，并明确“不自动轮询”和“CPU 到具体线程只是疑似归因”。
- 已实现：复制诊断报告，报告包含 summary、top processes、top sessions、warnings、recommendations 和 read-only policy；为降低泄露风险，复制内容刻意省略 process commandLine / executablePath。
- 已实现：前端采样节流，手动刷新有 10 秒冷却，只用一次性 `setTimeout` 清理冷却状态，不使用 `setInterval` 轮询。
- 已实现：runtime session metadata 透传更完整的 Thread History Vault / compact receipt / memory pointer 证据，包括 vault manifest/session/hash、compact receipt path 和 memory pointers；UI 与复制报告会显示精简证据摘要。
- 已验证：`tests/agent-runtime-monitor-policy.test.cjs` 覆盖高 CPU 但无线程证据、大旧线程未入库、活跃写入、systemError、已入库/receipt/pointer 降压等行为；`tests/runtime-monitor-adapter.test.cjs` 覆盖进程行归一化、Guardian metadata-only session 合并和采样失败降级。
- 未实现：真实安装版长期抽样和 Claude Code 深度适配。OpenClaw 已完成 bounded session/task metadata 适配，但 raw body、自动清理和后台轮询仍明确不实现。
- 安全边界：当前策略层和适配器不运行 `compact-session`、`clean-logs`、`restore` 或进程 kill，只输出事实、证据、置信度和建议动作。

1. 做真实安装版只读抽样和 app.asar token 检查。
2. 再考虑 Claude Code/OpenClaw 适配器。
