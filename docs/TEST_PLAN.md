# 测试计划

## Memory Core closure 验收

本节覆盖已实现完整 Memory Core。默认 `npm test` 已包含下列 focused tests；文档 smoke 可单独运行 `node tests/smoke-test.cjs`。

### 自动化矩阵

| 能力 | 主要测试 | 必须证明 |
| --- | --- | --- |
| Authority Core | `tests/memory-authority-policy.test.cjs` | caller 不能伪造 owner/trust；agent 不能自批；scope/project binding 精确；signed receipt 可重启 rehydrate；tamper/replay/revoke/expire/supersede fail closed；unsafe payload 拒绝 |
| ProjectBrain | `tests/project-brain-policy.test.cjs` | 14 槽固定；filled/missing/stale/conflict；500 mandatory anchors 不丢失；cursor 确定且向前推进；全部 mandatory id 跨页无重复无遗漏；低预算降级 pointer-only |
| Compound evaluation | `tests/memory-evaluation-policy.test.cjs` | retrieval、continuity、authority threat matrix、positive control、reuse/accept/revise/failure/correction、token/time saving、stale/maintenance cost 和 bounded net score |
| Sidecar/migration | `tests/memory-core-index-store.test.cjs` | 11 张 Memory Core 表、公共列和索引；legacy schema 非破坏迁移；exact receipt proof unique migration；重复 proof 回滚；FTS 修复；1 万 episode reopen/query |
| Episode Formation | `tests/memory-formation-policy.test.cjs` | event vocabulary、deterministic fingerprint、source/project/module binding、review downgrade、episode relations、checkpoint/continuity patch、secret/base64/giant/truncated fail closed |
| Runtime composition | `tests/memory-core-runtime-lifecycle.test.cjs` | key 持久但不暴露；authority 在 relevance 前；公开 lifecycle 不能 mint accepted；phase-1 preview + phase-2 signed receipt；幂等写入；完整 continuity pagination；重启 receipt/fact rehydrate |
| 显式 backfill | `tests/memory-core-project-backfill.test.cjs` | 构造 runtime/只读 helper 不创建私有状态；只有显式 seed 创建；排除生成包/raw/vault/JSONL/图片/正文；mtime 决定 updatedAt；重复 noop、变化 update；watcher 不 seed |
| Helper | `tests/zhixia-local-docs-helper.test.cjs` | 所有 packaged modes；sidecar schema 兼容；bounded reads；cursor tamper evidence；current record 降级 advisory；`authorityVerification=unavailable`；`recoveryReady=false`；无 raw/secret/base64 泄漏 |
| Lifecycle/IPC | `tests/memory-runtime-lifecycle-e2e.test.cjs`、`tests/electron-ipc-governance-contract.test.cjs`、`tests/electron-governance-e2e.test.cjs` | retrieve/precedent/event/writeback/working memory/facts/receipts/continuity/review/diagnostics IPC 串通；默认无 raw history；trigger receipts 和 formation diagnostics 可见 |
| CEO Flow gate | `tests/ceo-memory-runtime-guard-policy.test.cjs` + CEO Flow `references/memory-runtime.md` | pressure metadata-only；takeover Hot/Warm/Skill + Cold pointer-only；Continuity Gate 仅由 bootstrap/takeover/new module/major accept/drift 等事件触发，不使用 heartbeat |
| UI | `tests/electron-visual-behavior-e2e.test.cjs` + `tests/smoke-test.cjs` | 项目记忆页加载 diagnostics/status/page/review queue；展示 14 槽、覆盖率、恢复状态、可信摘要、待复核和 recall reason；智能优化页展示 trigger/fact/FTS 状态 |

### 重点断言

1. **Authority**
   - JSON clone、caller-supplied resolver 或 fake receipt id 不能恢复 trust。
   - 只有 app-owned composition root 能签名和注册回执。
   - legacy `accepted` 无精确回执时降级 review；不得原地改写 legacy store。

2. **完整 continuity**
   - 完整恢复必须迭代 `nextCursor`，直到 `pagination.complete=true`、`mandatoryReturned=mandatoryTotal`、`unsatisfiedSlots=[]`。
   - 第一页、top-K、槽位计数或 helper `pageComplete` 不能单独证明恢复完成。
   - helper 即使分页完成也必须保持 `recoveryReady=false`。

3. **形成与持久化**
   - phase 1 始终是非提交 preview。
   - 只有 app-owned deterministic low-risk direct-source-backed event 可进入 phase 2 accepted。
   - 相同事件重复形成必须复用 receipt id，持久化动作是 `noop`。

4. **性能边界**
   - diagnostics 必须报告 `startupWholeTableScan=false`、`timers=false`、`watchers=false`、`embeddings=false`、`graphRebuild=false`。
   - 1 万候选 authority filter 的 focused p95 上限为 2500ms；大 continuity focused case 上限为 5000ms；500 mandatory anchor traversal 上限为 8000ms。
   - 上述是当前回归上限，不等于最终 P3 latency 产品目标。

5. **隐私边界**
   - 默认 packet、receipt、sidecar payload、review queue、helper 输出和 UI 不得出现 raw session body/path、真实 thread id、secret、private key、base64、巨型正文或内部 signing key。
   - Cold/history 只返回 pointer/source refs；读取正文必须是显式窄范围 recovery gate。

### 手动 UI 验收

1. 选择一个尚未 seed 的项目，打开“项目记忆”：显示“未初始化”，只读查询不得创建 Memory Core 私有状态。
2. 通过“扫描 Codex 工作区”显式扫描该项目；重新打开项目后应出现项目身份和 identity anchor，未确认 phase 不应被猜成 active。
3. 打开项目记忆页：确认显示 14 个槽位、覆盖率、恢复状态、待补全/冲突/待复核数量和下一步。
4. 确认“当前可信来源摘要”只显示 accepted/curated 首屏摘要，不显示内部编号和真实本机路径。
5. 确认“待复核内容”最多显示 8 条只读预览，项目页没有直接 approve/reject/merge 按钮。
6. 进入项目记忆页时，“为什么会想起这些内容”只触发一次、最多 4 条、700 tokens；切换普通项目 tab 不应持续轮询。
7. 打开“智能优化”：手动运行一次记忆检索后，应显示最近 trigger receipt、当前/历史 MemoryFact 数量、本次耗时、返回数和 token。
8. 不运行任何操作并观察空闲状态：不得出现 Memory Core heartbeat、后台 embedding、全库扫描或 raw-history 读取。

### 文档与隐私 smoke

- `node tests/smoke-test.cjs`：验证核心文档存在、Memory Runtime/IPC/UI/Skill 合同未回退。
- 对本任务允许修改的文档执行只读隐私扫描：拒绝真实用户路径、真实 thread id、平台私有数据目录细节、secret/private key 和私有 runlog 内容。
- 不通过 `prepare:public` 验证本任务，因为它会写 public staging；本任务只运行其等价的只读内容扫描。

### P3 残余验证

- 在目标 Electron/Node 升级时复测 experimental `node:sqlite` 行为和 WAL/FTS5 兼容性。
- 增加 Windows DPAPI key wrapping 后，补迁移、回滚、旧 ACL key 兼容和不可导出测试。
- helper 若未来取得独立 verifier，必须新增 proof/key isolation threat model；在此之前继续断言 `recoveryReady=false`。
- 建立更大真实项目 continuity corpus，收紧完整分页 latency 目标，同时保留 mandatory 无遗漏证明。

## 自动验证

Source-only public checks:

- `npm run build`：TypeScript 和 Vite 生产构建。
- `npm test`：烟测关键 IPC、SQLite 存储、Codex Skill 文件、文档文件、Electron/Memory Runtime 策略和安全策略。
- `npm audit --omit=dev`：生产依赖漏洞审计。
- `npm run prepare:public`：生成 source-only public staging，并执行内容级隐私扫描。

Maintainer release gates:

- `npm run package:dir`：生成 Windows 可运行目录包。
- `npm run package:portable`：生成 Windows portable 单文件包。
- `npm run package:installer`：生成 Windows NSIS 安装向导。
- `scripts/package-fresh-user-validation.ps1`：生成可复制到 fresh Windows user / second machine 的验证 zip，包含 installer、portable、验证脚本、自校验脚本、说明和 SHA-256 manifest。
- `scripts/verify-fresh-user-bundle.ps1`：在外部验证包运行前校验 `SHA256SUMS.txt`，防止传输损坏或文件替换。
- `scripts/validate-fresh-user-release.ps1`：在 fresh Windows user 或 second machine 上收集最后的 installer/portable/Skill/uninstall JSON 验收证据。相关记录是维护者 release evidence，默认不进入 source-only public staging。

## 当前测试证据边界

`npm test` 目前包含 smoke / source contract 验证、`tests/electron-governance-e2e.test.cjs` 最小 Electron governance e2e 探针，以及 `tests/electron-visual-behavior-e2e.test.cjs` 这个 bounded renderer DOM behavior e2e。两类 Electron 探针都以 probe 模式禁用 GPU、隐藏窗口并隔离 `userData` / `CODEX_HOME`；visual behavior e2e 会通过真实 preload/main IPC seed fixture，reload renderer，再点击真实导航并检查项目卡片/项目详情、Tools 卡片安全边界、Memory/Experience curation UI、retrieval explanation DOM、老线程自动体检入口和 archive candidate / host-bridge queue 边界文案。该 e2e 现在会跑默认桌面窗口和 980px 窄桌面窗口，并对 Projects、Tools、Memory、Smart Optimization、archive candidate 面板做横向溢出检查。它仍不是完整人工视觉验收，也不能证明 Thread History Vault、所有 Agent retrieval 排序、Codex 宿主侧栏归档、clean-machine 安装路径或端到端真实用户工作流已经完成行为级验收。对外宣称时仍应把这些范围标为 MVP heuristic、bounded governance e2e 或 host-bridge boundary。

2026-06-19 safe auto history ingest adds `tests/codex-thread-history-auto-ingest-policy.test.cjs` to default `npm test` for raw session -> vault/hash/pointer, repeated idempotent ingestion, recent-session `preserved_not_archive_ready` evidence, and startup-style early traversal bounding that stops after the limited batch instead of statting the whole historical tree. `tests/archive-candidate-policy.test.cjs` now also covers active/current preserved threads being excluded from archive queue while cold inactive vaulted threads remain eligible.

2026-06-19 Memory Runtime contract adds `tests/memory-runtime-policy.test.cjs` to default `npm test` for RuntimeContextPacket shape, bounded metadata-first precedent retrieval, compact evidence writeback receipts, private FlowSkill-ready candidate queueing/listing, unsafe/no-source downgrade or rejection, WorkingMemoryRecord persistence, and fail-closed promotion candidates that do not install, execute, archive, mutate raw sessions, or public-export FlowSkill material.

2026-06-19 Memory Runtime lifecycle probe adds `tests/memory-runtime-lifecycle-e2e.test.cjs` to default `npm test` as a product-level local contract loop: compact context retrieval, metadata-first precedent retrieval, WorkingMemoryRecord active-to-accepted lifecycle, accepted source-backed evidence writeback, private review-only FlowSkill candidate listing, idempotent repeat writeback, and no-source reusable evidence staying review-only. The probe uses temp app-owned storage and in-memory fixtures only.

2026-06-22 Memory Runtime fast recall adds a pure `MemoryRouterPlan` layer to `tests/memory-runtime-policy.test.cjs` and `tests/memory-runtime-lifecycle-e2e.test.cjs`: task goals are classified into small retrieval profiles, topK/token/time budgets are clamped, hot/warm/cold layers are labeled, cold history stays pointer-only, raw session bodies stay off by default, and returned RuntimeContextPacket data includes `routerPlan`, `hotState`, bounded `memoryGraph`, `performance`, `cacheKey`, and `expiresAt`. The regression explicitly asserts that this router starts no timers, does not scan vaults, runs no AI summaries, uses metadata-first/no-full-text reads, marks time-budget overruns as partial, rejects invalid-only allowedKinds instead of falling back, and leaks no raw/base64/secret/long-log sentinels.

2026-06-25 ThreadRecoveryPacket adds focused policy/smoke coverage for `memoryRuntime:recoverThread`: a broken/archived/slimmed thread can be recovered from threadId/title/projectPath into a compact packet containing lineage, vault manifest pointers, recommended project docs, cold-history sourceRefs and a replacement-thread prompt. Tests assert the packet is pointer-only, has `readByDefault=false` for raw session sources, does not include raw session body text, warns when vault/lineage is missing, and exposes IPC/preload/type contracts. This is an explicit CEO Flow/bootstrap hook, not a background vault scan. The packaged `zhixia-local-docs` helper also supports `--recover-thread` for CEO Flow lanes that cannot call Electron IPC directly; helper recovery is workspace-metadata-only and must not walk Thread History Vault or read raw/vault session bodies. The old-thread UI exposes a selected-thread "生成接续包 / 复制接续包" flow and must state that raw/vault session bodies are not read by default.

2026-06-27 RuntimeEventMemory adds focused policy/lifecycle/smoke coverage for `memoryRuntime:observeEvent`: broken thread, heartbeat fuse, takeover, stale lane, checkpoint and user-rule events must write compact app-owned runtime-event JSON plus WorkingMemoryRecord state, enter `retrieve_context` as hot `runtime_event` items for matching project/thread, and filter raw-session/secret sourceRefs from default context. Tests assert this path is metadata-only, starts no timers, scans no vault, reads no raw session body, and does not authorize archive/compact/delete/move/restore, raw-session mutation, install, execute, or FlowSkill export.

2026-06-27 closed-loop wiring adds smoke coverage that `recover_thread` and `runtimeMonitor:getSnapshot` are real RuntimeEventMemory producers: thread recovery must write a recovery/takeover event and return `runtimeEventWriteback`; runtime monitor snapshots must convert already-computed recommendations into bounded runtime diagnosis events and expose an explicit `observeRuntimeEvents=false` dry-run switch. This is event-triggered only and must not reintroduce background polling or long-thread triage unless the caller explicitly requests long-thread metadata.

2026-07 CEO Memory Runtime Guard adds `tests/ceo-memory-runtime-guard-policy.test.cjs` to default `npm test`: synthetic oversized CEO-thread metadata must produce `freeze_risk_stop_dispatch`, multi-thread visible churn must produce `harvest_only`, small threads must `continue`, lifecycle writeback must redact raw/base64/secret payloads, and takeover bootstrap must keep Hot/Warm/Skill default recall with Cold pointer-only history. The packaged helper test also covers `--thread-pressure` and `--ceo-takeover`.

2026-07 external-audit security hardening adds `tests/security-policy.test.cjs` to default `npm test`: renderer settings patches must be key/type whitelisted; AI Provider URLs must normalize to trusted HTTPS hosts; untrusted HTTP/host values must be rejected before document text or API keys can be sent; renderer-controlled `projectPath` values must stay inside registered workspace paths. Smoke/source checks also guard CSP/header injection, navigation/window/permission denial, explicit Electron sandbox, Guardian destructive confirmation signals, app-owned Guardian default path, public staging privacy scan, and source-only staging behavior.

2026-07 public staging verification requires both app-root and staging-root tests. From the app root, run `node scripts\prepare-public-repo.cjs`; then from `public-staging\zhixia-local-doc-knowledge`, run `npm test`. Staging is intentionally source-only: installer scripts, release artifacts, private runlogs, `.codex-knowledge`, local databases, vaults, backups, evidence, screenshots and user data must be absent. The staging script performs a content-level scan for private Windows user paths, private project/tool codenames and real-looking Codex thread IDs; a hit blocks publication.

2026-07-05 layered recall adds focused coverage in `tests/memory-runtime-policy.test.cjs` and `tests/zhixia-local-docs-helper.test.cjs`: RuntimeContextPacket must declare `memoryMode=layered`, expose Hot/Warm/Skill/Cold `memoryLayers`, return a `recallPlan` whose default read order is Hot -> Warm -> Skill, and keep Cold as sourceRef-only / defaultRead=false. Helper fixtures now include both Example Project accepted product progress and old-thread maintenance records; product/project queries must rank accepted product progress first and must not include cold maintenance history by default.

2026-06-26 Memory Runtime persisted graph revision adds exact-thread recovery guards: `tests/memory-runtime-policy.test.cjs` asserts exact `threadId` activation outranks broad project keyword matches, smoke asserts same-name Codex worktree project aliases, exact `threadId` seed inclusion, and explicit `activate_memory` SQLite persistence. Maintainer-only real-data probes may verify a private project and private old CEO thread id, but public tests and docs must use synthetic IDs, synthetic paths, and synthetic project names while still reporting metadataOnly=true, rawSessionBodyRead=false, and scansVault=false.

2026-06-19 performance hotfix updates default smoke/source gates and `tests/document-metadata-policy.test.cjs` for large-library startup behavior: default document list SQL is metadata-first and exposes `contentLength` without `contentText`; startup Codex history auto-ingest is deferred/daily/tiny-batch; automatic watch/change detection defaults off after the performance-safe migration; project overview derivation must use a `documentsByProject` map instead of per-project full document filtering.

2026-06-19 project detection productization adds smoke/source guards for explicit `project | lead | non_project` classification. Top-level project cards must filter to real projects, noisy/generated/dependency/vault/clipboard/screenshot-like paths must be demoted, low-confidence entries must appear only as “待整理线索”, and project view must not fall back to the first raw workspace after demotion.

2026-06-19 packaged `zhixia-local-docs` lifecycle helper adds `tests/zhixia-local-docs-helper.test.cjs` to default `npm test` for backward-compatible `--query --limit --json`, explicit `--runtime-context`, bounded `--precedent`, `--writeback-dry-run --evidence-json`, sourceRefs, giant Markdown tail bounding, and raw-session/base64 redaction.

Fresh-user / second-machine release signoff is intentionally outside default `npm test` and outside source-only public staging. Use maintainer release scripts after package artifacts are refreshed; do not present them as public source checkout requirements.

## P1 行为测试矩阵

- Thread History Vault：构造临时 session JSONL，验证入库会复制完整 raw session、`originalSha256 === copiedSha256`、写出 manifest / hot-warm-cold pointer；hash 不一致时必须失败且不触碰原 session。
- Compact gate：模拟 Guardian receipt，验证缺少 Vault、`thread_store_compatible !== true`、threadId 不匹配、receipt 缺 hash 或备份路径时，Electron 主进程必须拒绝成功态。
- Agent retrieval：用临时 SQLite/fixtures 验证 `project_record`、`ceo_flow_record`、SQLite-backed `thread_lineage_index`、`tool_skill_record`、`parentCeoThreadId`、topK、token budget、cache hit 和 metadata-only / compact-row reads；不能靠全量 `contentText`、敏感配置正文或 raw session 扫描通过。`thread_lineage_index` 必须声明 no raw session body 和 no archive/compact/restore/delete mutation boundary，并在 persisted lineage rows 改变时刷新 cache key；`tool_skill_record` 必须声明 advisory-only、human confirmation required 和 no install/enable/execute/active-promotion boundary。
- Memory Runtime contract：用 policy fixtures 验证 `retrieve_context` 返回 RuntimeContextPacket-shaped result 和 sourceRefs / freshness / tokenEstimate，`retrieve_precedent` 只读取 metadata-first bounded kinds，`recover_thread` 返回 ThreadRecoveryPacket-shaped result 和 lineage/vault/project-doc/cold-history pointers，`MemoryRouterPlan` 会按 task goal/queryType 选择 hot/warm/skill/cold profile、夹住 topK/token/time budget，并在 packet 中返回 `memoryMode=layered`、`routerPlan`、`hotState`、bounded `memoryGraph`、`activatedMemory`、`memoryLayers`、`recallPlan`、`performance`、`cacheKey`、`expiresAt`；默认读取顺序必须是 Hot/Warm/Skill，Cold 只作为 sourceRefs pointer 且 `defaultRead=false`。该路由层不得启动后台定时器、不得扫描 Vault、不得运行 AI 摘要或全局图谱重建，默认不得读取全文/raw body。持久 `memory_graph_nodes` / `memory_graph_edges` 只能从 compact metadata 派生，`memoryRuntime:activateMemory` 必须按 taskGoal/projectPath/threadId 做 bounded activation、一跳邻居扩散和显式轻量缓存落盘；同名 Codex worktree alias 与精确 `threadId` 必须进入种子池，精确 threadId 召回优先级必须高于泛项目关键词。项目 fixture 必须能激活项目节点、CEO/thread lineage、Thread History Vault pointer 和经验卡，并声明 rawSessionBodyRead=false；维护者真实数据探针可另行证明指定旧 CEO 线程能按 canonical projectPath 召回，但不得把真实 thread id 写入公开测试计划。底层允许 metadata-first bounded row reads，不能用“完全不读数据库 metadata”作为验收口径。invalid-only allowedKinds 必须返回空 allowedKinds/partial/warning，不能回退到默认 broad retrieval；allowed kind 如果携带 raw-session/secret sourceRef，也必须 fail-closed 丢弃。`writeback_evidence` 持久化 compact receipt 并对 accepted source-backed reusablePattern 生成私有 review-only FlowSkill-ready candidate packet / queue item；重复相同 packet 必须 id/hash 稳定且不重复写多条；revise/block 默认只生成 MemoryCard/pitfall candidate；no-source / raw-session / secret / destructive intent 必须降级或拒绝。WorkingMemoryRecord 支持 active/waiting_review/blocked/accepted/superseded，`promote_memory` 对 FlowSkill/public-export/install/execute 路径保持 candidate/review 和 no-op effects。`tests/memory-runtime-lifecycle-e2e.test.cjs` 还会把这些 policy helpers 串成单个本地 lifecycle probe，确保 raw_session fixture、raw-backed allowed kind、巨型 Markdown 尾部、base64、credential/private-key、long-log 和无 sourceRefs reusable evidence 不会突破默认边界。
- CEO Memory Runtime Guard：用纯 policy fixture 验证 oversized CEO thread metadata、multi-thread visible churn、small thread、compact lifecycle writeback 和 one-line takeover bootstrap。验收必须证明该 guard 只消费 caller metadata，不启动 timer、不扫描 Vault、不读取 raw session body、不触发 archive/compact/delete/move/restore；视觉证据只能以本地 path/hash/summary/sourceRef 进入记忆，不能把图片/base64 写入 chat 或 memory payload。
- Codex Skill lifecycle helper：用临时 `.codex-knowledge` fixtures 验证 `read-project-knowledge.cjs` 的 legacy JSON、RuntimeContextPacket、RuntimePrecedentPacket 和 EvidenceWritebackPacket dry-run 输出；默认输出必须保留 sourceRefs、预算元数据和 warnings，同时排除 raw session 路径、base64 payload 和 giant Markdown 尾部。
- Archive Candidate / Queue：用 fixtures 覆盖 `active/running`、最近写入、无 Vault、hash 失败、pinned/keep hot、已有 receipt、项目 paused/completed、CEO 创建线程 3 天冷却、CEO 主线程 30 天保留、归属不明线程先入库后归档；扫描入口必须覆盖 Guardian `largest_session_files` 和 inventory hot sessions，防止小型但过期的 CEO 子线程漏扫。回归测试必须防止主按钮重新退回只扫 20 条、防止归档队列重新退回 50 条截断、防止已入库候选缺少 vault manifest/session/hash 证据而无法排队。大库场景必须允许 old-thread knowledge item 走 Thread History Vault sidecar fallback，避免 512MB+ `sql.js` 整库导出触发 `memory access out of bounds`。归档队列必须要求 vault 等安全证据，并声明真实侧栏归档需要 Codex 宿主桥接；默认不得 delete/restore/raw-session mutation。大线程保留 compact receipt evidence，小型过期 CEO 子线程可在 vault/hash 通过后进队列。
- UI 状态流：`tests/electron-visual-behavior-e2e.test.cjs` 已覆盖简化主导航、项目卡片总览、项目详情里的历史/知识/记忆、Tools 卡片安全边界、Memory/Experience curation、retrieval explanation、老线程自动体检入口和 archive candidate / host-bridge 边界文案的真实 Electron DOM 行为，并在默认桌面与 980px 窄桌面窗口检查主产品页面无横向溢出；source smoke 已覆盖 full backlog/remaining 文案，确保批次被截断时不得显示全量完成。后续仍需补真实一键安全减负成功/失败路径、宿主侧栏归档桥接回执、错误态不得显示“完成”等更完整 UI 行为。
- Large-library performance：默认 `documents:list` 必须 metadata-first，启动不得向 renderer 推送全量 `contentText`；选中文档正文必须通过 `documents:get` 按需读取。启动自动入库必须延迟、每日 cadence、小批次且 preservation-only；自动 watcher 默认关闭，开启后文件事件不得扫描全部 workspace roots。项目总览必须 map-based 派生，避免 projects × documents 级别重算。
- Project detection：项目页只展示高置信项目卡片。分类必须正向依赖 PRD/技术设计/测试计划/README、Codex 项目历史、知识/记忆、多个相关来源等组合证据；单条链接/截图/视频/剪贴板、依赖/构建/备份/vault/生成知识目录、孤立工具或 Skill 记录不得成为普通项目卡片。低置信但可能有关联的资料进入“待整理线索”。
- Security policy：设置更新必须经过键和类型白名单；AI Provider 只允许 trusted HTTPS endpoint；保存的 API Key 不得被转发到未信任 host；项目记忆写入和工具扫描必须限制在 registered workspace；Electron 必须有 CSP、sandbox、导航/开窗/权限拒绝；Guardian 清理、瘦身、compact 和 archive queue 生成必须要求用户确认；默认 Guardian 脚本路径必须位于应用自有 userData 或由显式环境变量覆盖。
- Public staging hygiene：`prepare:public` 必须用白名单生成 staging，排除私有/生成目录，生成 public-safe release notes 和 manifest，改写或拦截私有路径、私有代号和真实形态 thread id。公开 staging 的 `npm test` 必须通过，且公开 README/package 不能宣传不存在的 installer/package 命令为普通用户默认流程。
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
23. 打开设置页，确认“后台自动监听源文件和 Codex 项目变更”默认关闭或迁移为关闭；状态栏应提示需要用户显式开启，避免大库启动时自动扫描。
24. 手动开启后台监听后，修改一个已导入 TXT/MD 文件，等待后台监听提示，确认文档列表和正文自动更新。
25. 在已扫描 Codex 项目中新建或修改 `docs/*.md`，等待后台监听提示，确认项目文档、`retrieval-packet.md`、`project-index.md/json`、`project-chunks.jsonl` 和兼容 `project-knowledge.md` 自动刷新。
26. 关闭后台监听开关，再修改文件，确认不会自动刷新；手动点击“检测变更”仍可更新。
27. 使用包含万级记录或约 200MB SQLite 的知识库启动应用，确认启动、文档列表和 watcher 状态查询不会触发 `sql.js` wasm `memory access out of bounds`；监听失败时会自动关闭 `autoWatchChanges` 而不是反复崩溃。
28. 进入项目详情的“知识”分区，点击“整理”，确认生成知识条目、分类计数和来源路径可见。
29. 在已扫描项目中确认 `.codex-knowledge/knowledge-items.json` 和 `knowledge-items.md` 已生成，内容是 compact 摘要和来源指针。
30. 打开设置页，确认 DeepSeek/OpenAI 兼容 Base URL、模型、API Key 输入框可见；已保存 key 不显示明文。
31. 未配置 API Key 时点击“AI 整理”，确认会本地降级或提示未使用网络，不阻断知识条目生成。
32. 如有测试 API Key，点击“测试连接”和“AI 整理”，确认只在手动点击后联网，项目导出不包含 API Key。
33. 尝试把 AI Provider Base URL 设置为 HTTP 或非 trusted host，确认设置被拒绝或连接测试失败；保存的 API Key 不应被发送到该端点。
34. 尝试对未导入/未扫描的任意目录生成项目知识或扫描工具资产，确认被 registered workspace 白名单拒绝。
35. 点击清理运行日志、瘦身线程、compact 线程或生成归档队列前，确认 UI 有明确用户动作；对应 IPC 必须带确认标记，不能由后台自动触发。
36. 打开设置页，确认“经验卡片”和“Skill 候选”计数可见，AutoFlow workflow 路径和 BUG_FIX_MEMORY.md 路径可配置。
37. 点击“导入 AutoFlow 经验”，确认只读导入完成后经验卡片计数增加，并生成/更新相关项目的 `.codex-knowledge/experience-cards.json`、`experience-cards.md` 和 `skill-candidates.md`。
38. 打开 Skill 候选列表，确认可以查看 draft markdown，且没有自动安装或覆盖任何 Codex Skill。
39. 在已安装 Skill 目录运行 `node scripts/read-project-knowledge.cjs <workspace> --query "经验" --limit 5 --json`，确认返回 retrieval_packet/project_index/context/knowledge/experience/skill 文件中的低 token 结果。
40. 打开主导航“工具”页和项目总览的 Tool/Skill Inventory 区块，确认自动发现结果默认是 candidate，卡片标题使用真实中文/可读工具名，简介展示用途、创建/更新时间、适用项目和来源；风险边界、safe/forbidden commands、source refs 与治理状态在详情中可查看。能刷新/扫描并确认当前 live inventory snapshot；对单条候选执行 confirmed/rejected/deprecated/blocked/clear 后刷新仍保留治理 metadata，来源或 context hash 变化后显示 stale，且没有自动安装、启用、执行或提升候选状态。Agent retrieval 查询 `tool_skill_record` 时只返回 compact advisory metadata，并把 stale per-record governance 显示为 review-needed。
41. 删除一条记录。
42. 导出知识库元数据 JSON。
43. 关闭应用后重新打开，确认记录仍在。
44. 通过 Windows“设置 > 应用”或开始菜单卸载知匣，确认安装目录、桌面快捷方式、开始菜单快捷方式被删除。
45. 卸载后确认知匣拥有的应用私有数据目录和本地缓存目录不再存在，不记录或展示真实用户路径。
46. 卸载后确认 `%CODEX_HOME%\skills\zhixia-local-docs` 不再存在；如设置了 `CODEX_HOME`，确认 `%CODEX_HOME%\skills\zhixia-local-docs` 不再存在。
47. 重新运行安装器，不勾选“安装 zhixia-local-docs Codex Skill”，确认首次启动后不会自动安装 Skill。
48. 再次卸载后重新安装，勾选“安装 zhixia-local-docs Codex Skill”，确认安装完成后 Skill 已写入 `$CODEX_HOME/skills` 或 `$CODEX_HOME/skills`。
49. 未勾选安装 Skill 的场景下，打开设置页点击“安装 Skill”，确认可后续一键安装。

## 验收标准

- 应用可以正常打开。
- 文本类文件能导入并搜索到正文。
- 搜索片段能高亮关键词。
- 标签、星标、删除和导出功能可用。
- `.xlsx/.xls` 被明确标记为暂不支持，而不是静默失败。
- 数据库文件为 `knowledge-store.sqlite`，旧 JSON 数据能被迁移。
- 文件夹递归导入、重复检测、变更检测和重建索引可用。
- 后台监听可自动发现已导入文档和 Codex 项目文档变更，并能关闭；大型库下 watcher 不会读取全部正文导致 sql.js 内存崩溃。
- 后台监听默认不自动开启；用户显式开启后才开始 watcher，且 watcher 事件必须防抖并限制在变更路径/根，不得启动即扫描所有 workspace。
- Codex 上下文包导出和工作区扫描可用。
- Codex 工作区扫描能按项目归类，不再只显示散装文档。
- 项目分层知识 bundle 自动生成，Codex Skill 优先读取 `project-resume.md` 和 `retrieval-packet.md/json`，再读取结构化索引和短 chunks；`project-knowledge.md` 仅作为兼容短索引。
- 知识页可生成并展示项目知识摘要，分类、摘要、来源路径、source hash、provider/model 和状态可见。
- 可选 AI Provider 配置不会明文回显 API Key；未配置或调用失败时能降级为本地整理。
- AI Provider Base URL 必须是 trusted HTTPS endpoint，默认模型为 `deepseek-chat`；HTTP、任意内网或未信任 host 不得接收文档正文或真实 API Key。
- 项目目录可生成 `.codex-knowledge/knowledge-items.json` 和 `knowledge-items.md`，且不包含大文件全文或密钥。
- AutoFlow completion、BUG_FIX_MEMORY 和 agent family memory 可被只读导入为 compact 经验卡片，不复制完整日志、聊天记录、会话文件或密钥。
- 项目目录可生成 `.codex-knowledge/experience-cards.json`、`experience-cards.md` 和 `skill-candidates.md`。
- Skill 候选只生成草稿，默认不自动安装、不自动启用。
- Skill 检索脚本可读取 retrieval packet、project index、兼容项目知识文件、任务上下文、知识条目、经验卡片和 Skill 候选，并支持 `--query`、`--limit`、`--json`。
- Codex 工具与 Skill 资产图谱 MVP 必须只读生成 ToolSkillRecord candidate，写出 `.codex-knowledge/tool-skill-inventory.md/json`，通过 IPC/UI 和一等工具页展示用途、触发条件、安装状态、适用项目、风险边界、safe/forbidden commands 和 source refs，支持 live inventory snapshot 级确认，支持 SQLite-backed 单条治理 metadata，并通过 `tool_skill_record` Agent retrieval 返回 compact advisory metadata；自动发现和检索不得安装、启用、执行工具，也不得保存凭据、读取敏感配置正文或 raw session。
- 公开发布必须使用 `npm run prepare:public` 的 source-only staging；staging 的 `npm test` 必须通过，隐私扫描必须无命中，且不能包含本地数据库、vault、备份、release/dist、私有 runlog、真实 thread id、私有路径或私有项目代号。
- Memory Runtime contract MVP 必须通过 preload/IPC 暴露 retrieve_context、retrieve_precedent、writeback_evidence、WorkingMemoryRecord、只读 FlowSkill candidate list 和 promote_memory；默认 compact/metadata-first，不读取 raw session 或巨型 Markdown，不自动归档/瘦身/删除/移动/恢复，不自动安装、执行或公开导出 FlowSkill。
- Memory Intelligence 默认测试必须覆盖：BM25F 中文/英文召回、project/thread scope、status/freshness/recency/graph 信号、raw-session/secret/base64/giant-body fail-closed、topK/token budget 和确定性排序。
- MemoryFact 测试必须覆盖：source-backed current、无来源降级、raw/secret rejection、同值幂等、不同值冲突、validFrom/validTo、supersededBy、current/historical 查询和旧事实不丢失。
- MemoryFact 还必须覆盖 A -> B -> A recurrence：返回旧值时创建新 occurrence，不能重新打开第一条 A、不能让 A/B 同时 current，也不能抹掉第一段 validTo。
- `memory-runtime-index.sqlite` 必须使用独立 `node:sqlite` FTS5/WAL 增量写入；测试必须证明不调用 sql.js whole-database export、重复内容不重复索引、raw/base64 不入索引、trigger receipt 可读取。
- sidecar 锁测试必须持有独立 SQLite 写锁，证明 upsert 和 trigger receipt 在 100ms busy timeout 下于 250ms 检索预算附近快速失败、失败路径释放句柄、释放锁后可继续写入，并可删除 temp dir。
- 对抗测试必须逐项覆盖 id/projectPath/scope/status/tags/sourceRef kind/id/path/hash、task.domain、evidence.memoryFacts、runtime-event automationId、promotion actions 和 trigger receipt query/hash/ref/warnings；任一 raw-session、GitHub/AWS/API/Bearer/PEM secret、base64 或 giant body 不得保留原值，也不得让安全 sibling summary 生成 accepted fact。
- authority 回归必须证明普通项目检索排除 global draft、项目 candidate/review、`freshness=review` 和 `ready + requiresHumanConfirmation`，并证明显式 review mode 可读取项目 review candidate。
- `tests/memory-runtime-hybrid-lifecycle.test.cjs` 必须用完全合成的游戏工作室场景串起架构锚点、UI 假死教训、部署约束、用户规则、事实替换和 trigger receipt，并输出 Recall@K、Precision@K、MRR、nDCG、stale-hit、P95 latency/token。
- `tests/electron-governance-e2e.test.cjs` 必须在隔离 userData 的真实 Electron 主进程中执行 accepted writeback -> MemoryFact -> retrieve_context -> trigger receipt，并证明 hybrid strategy 生效、sidecar wholeDatabaseExport=false。
- Memory Runtime 新增 `listFacts`、`listTriggerReceipts`、`evaluateBenchmark` preload/IPC/type；这些接口只读或纯评测，不得启动 timer、读取 raw session、执行 archive/compact/delete/move/restore 或安装/执行 FlowSkill。
- `evaluateBenchmark` 只有在调用方提供已经真实执行的 query results 时才可标记 `caller_executed_results`；空 cases 必须失败，预填答案的 synthetic fixture 只能验证指标计算，不能作为产品召回证明。
- `zhixia-local-docs` helper 必须能在 Codex/CEO Flow lane 中通过 `--runtime-context`、`--precedent` 和 `--writeback-dry-run` 输出 compact lifecycle JSON，保持 legacy `--query --limit --json` 兼容，并且不得读取 raw session、巨型 Markdown 尾部、base64 payload、凭据或自动运行 FlowSkill/归档/瘦身/安装/执行。
- `codex-skills/zhixia-local-docs/SKILL.md` 和 `agents/openai.yaml` 存在且通过烟测。
- 设置页 Skill 安装器可用，且打包产物包含 `codex-skills`。
- 安装器提供 Skill 安装授权选项，默认不安装；用户勾选后才安装。
- Windows 安装器可启动安装向导，并带自定义图标、桌面快捷方式和开始菜单快捷方式。
- 应用窗口、主 exe、桌面快捷方式、安装器、卸载器和安装器头部不再使用 Electron 默认图标。
- 如果覆盖安装后桌面仍显示旧图标，删除旧快捷方式或卸载旧版后重装，并重新检查 `0.8.1` 快捷方式。
- 卸载安装版时能干净删除知匣本地数据和自动安装的知匣 Skill；升级安装时不会误删数据。
