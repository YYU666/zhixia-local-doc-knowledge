# 实际项目评估报告

## 项目结论

知匣 Local Doc Knowledge 已从 MVP 进入可外带测试阶段：可以启动、导入单文件或文件夹、搜索正文、查看片段、维护标签和星标、检测源文件变化、处理重复文件、导出 Codex 上下文包、按项目扫描 Codex 工作区产物、自动生成项目知识库、自动安装配套 Codex Skill，并导出元数据。它不是演示脚本，而是已经打包出的 Electron 桌面应用和 Windows 安装包。

## 完成内容

- PRD、技术设计、测试计划、发布说明和 Ark-Office 评估文档。
- Electron 桌面壳和安全 preload IPC。
- SQLite 本地数据库存储，并兼容迁移旧版 JSON 数据。
- 文档导入、文件夹递归导入、重复文件提示、删除、标题编辑、标签、星标。
- 文件修改检测、缺失文件标记、单文档和全量重建索引。
- 设置页、本地数据库路径展示和索引维护入口。
- Codex 上下文包导出：`.codex-knowledge/context.md` 和 `sources.json`。
- Codex 工作区扫描和“Codex 产物”视图。
- 文档来源类型、产物类型和版本快照表。
- 仓库内配套 Codex Skill：`codex-skills/zhixia-local-docs`。
- 设置页 Skill 安装器，可安装/更新到 `$CODEX_HOME/skills` 或 `$CODEX_HOME/skills`。
- 启动时自动安装或更新配套 Skill。
- 自定义应用图标和 Windows NSIS 安装向导。
- 项目知识库视图：左侧按项目归类，项目内按 README/PRD/技术设计/测试计划等文档类型排序。
- 自动生成 `.codex-knowledge/project-knowledge.md`，让 Codex 和用户都能阅读项目经验沉淀。
- 详情阅读体验修复：长文档可在右侧详情区域滚动阅读。
- 左侧栏可拖拽调宽，项目列表成为唯一项目入口，移除重复“项目知识库”导航。
- 项目知识文件升级为结构化项目记忆，并提供 Skill 检索脚本供 Codex 调取。
- 后台文件监听：自动监听已导入文档目录和 Codex 项目目录，变更后自动更新索引和项目知识文件。
- `.txt/.md/.json/.csv/.html/.docx/.pdf` 文本解析。
- `.xlsx/.xls` 元信息保留和明确失败提示。
- 搜索评分、命中片段、高亮展示，重复和失败文档搜索降权。
- 自动化烟测脚本。
- Windows 目录包和 portable 单文件包。

## 验证结果

- `npm run build` 通过。
- `npm audit --omit=dev` 生产依赖漏洞数为 0。
- `npm test` 通过。
- `npm run package:dir` 通过，生成 `release/win-unpacked/知匣 Local Doc Knowledge.exe`。
- `npm run package:portable` 通过，生成 `release/知匣 Local Doc Knowledge 0.7.0.exe`。
- `npm run package:installer` 通过，生成 `release/知匣 Local Doc Knowledge Setup 0.7.0.exe`。
- `0.7.1` 已补充 NSIS 安装器、卸载器和安装器头部图标配置，避免安装向导仍显示默认 Electron 图标。
- `0.7.1` 已重新通过 `npm test`、`npm run build`、`npm audit --omit=dev`、`npm run package:installer` 和 `npm run package:portable`。
- `0.7.1` 已生成 `release/知匣 Local Doc Knowledge Setup 0.7.1.exe` 和 `release/知匣 Local Doc Knowledge 0.7.1.exe`。
- `0.8.0` 已完成后台监听功能开发，并通过 `npm test`、`npm run build`、`npm audit --omit=dev`、`npm run package:installer` 和 `npm run package:portable`。
- `0.8.0` 已生成 `release/知匣 Local Doc Knowledge Setup 0.8.0.exe` 和 `release/知匣 Local Doc Knowledge 0.8.0.exe`。
- `0.8.1` 已修复 `0.8.0` 主进程启动崩溃和桌面快捷方式默认 Electron 图标问题。
- `0.8.1` 已通过 `npm test`、`npm run build`、`npm audit --omit=dev`、`npm run package:installer` 和 `npm run package:portable`。
- `0.8.1` 已生成 `release/知匣 Local Doc Knowledge Setup 0.8.1.exe` 和 `release/知匣 Local Doc Knowledge 0.8.1.exe`，并从目录包主 exe 提取图标确认不再是 Electron 默认图标。
- `0.8.2` 已新增干净卸载脚本，并通过 `npm test`、`npm run build`、`npm audit --omit=dev`、`npm run package:installer` 和 `npm run package:portable`。
- `0.8.2` 已生成 `release/知匣 Local Doc Knowledge Setup 0.8.2.exe` 和 `release/知匣 Local Doc Knowledge 0.8.2.exe`。
- `0.8.3` 已把 Codex Skill 安装改为用户授权：安装器默认不安装，用户勾选后才调用 `--install-skill-and-quit`；设置页仍可后续一键安装。
- `0.8.3` 已通过 `npm test`、`npm run build`、`npm audit --omit=dev`、`npm run package:installer` 和 `npm run package:portable`。
- `0.8.3` 已生成 `release/知匣 Local Doc Knowledge Setup 0.8.3.exe` 和 `release/知匣 Local Doc Knowledge 0.8.3.exe`。
- 打包后的目录包已启动验证，进程保持运行后手动结束。
- 使用临时 `CODEX_HOME` 启动打包后的目录包，已验证首次启动自动安装 `zhixia-local-docs` Skill 和 `read-project-knowledge.cjs` 检索脚本。
- 已检查 `app.asar` 包含 `assets/icon.ico`、`assets/icon.png`、`assets/icon.svg` 和 `codex-skills/zhixia-local-docs`。

## 风险和不足

- 没有签名证书，离正式发布还差代码签名和发布渠道。
- Excel 二进制解析暂不支持，原因是优先规避依赖漏洞和解析风险。
- 搜索没有语义理解，只是本地关键词评分。
- 当前 SQLite 由 `sql.js` 驱动，避免原生依赖打包风险，但超大库写入有整库导出成本。
- 后台监听已接入，但仍需要在真实 Windows 目录、Codex 项目和外部机器上人工复验。
- Codex 产物分类依赖路径和文件名启发式判断，不能证明真实作者。
- 版本快照已入库，但 UI 暂未提供版本列表、diff 和回滚。
- Skill 安装器只负责内置 Skill，第三方 Skill 管理仍不在当前范围；安装器默认不安装 Skill，需用户授权。
- 安装器图标和安装流程仍需在另一台真实机器上人工验收，尤其注意 Windows 资源管理器图标缓存。
- 干净卸载逻辑已编译进安装器，但仍需在另一台真实机器上人工验证残留目录和 Skill 是否清理干净。
- 项目识别依赖目录标记和文件名启发式判断，复杂 monorepo 后续需要项目配置页。
- 尚未做自动化 UI 测试，导入弹窗流程仍需要人工验收。

## Ark-Office 作用评估

Ark-Office 在本项目中的实际作用偏诊断，不是主要生产力来源。

它成功完成了后台健康检查、Wake 状态读取和历史失败定位；但旧 Wake 记录和死亡 shell 绑定没有自动清理，`wake bind-current` 又因为当前前台窗口不是 PowerShell/CMD 而失败，所以没有形成一次可靠的自动续跑闭环。

实际权重判断：

- 状态诊断价值：高。
- 对代码开发和打包的直接帮助：低。
- 对长任务自动续跑的当前可用性：低到中，取决于能否稳定绑定当前 Codex 会话。

全局开启 Ark-Office 后，它不应成为知匣依赖，也不应放进知匣主程序。更合适的角色是外部监督工具：持续监控 Codex 是否按建议继续推进知匣开发，并把执行结果、失败原因和下一步任务记录下来。

- 监控 Codex 是否按优化清单继续实现功能，而不是只停留在建议。
- 监控每轮开发后是否运行 `npm test`、`npm run build`、`npm audit --omit=dev` 和安装包构建。
- 监控安装包、Skill 自动安装、项目知识生成、图标显示和跨机器测试是否被人工验收。
- 监控失败项是否转化为下一轮 Codex 可执行任务。
- 把 Codex 执行结果沉淀回知匣项目文档，形成可追踪的项目经验。
- 本轮已确认 Bridge backend 健康、Wake feature 启用、无审批和无运行任务；但 `wake start` 因缺少可用 sovereign target 失败，显式指定当前线程后又因当前线路不允许 exec-resume ordinary route 失败。因此 Ark-Office 当前只能作为状态监控记录，尚不能证明自动续跑成功。

## 建议

- Ark-Office 应优先解决“真实续跑确认”而不是只增加状态展示。
- 新项目应自动隔离旧 Wake 记录和旧 terminal binding。
- 对 Codex desktop 场景提供专门绑定路径，不要要求用户手动切到 PowerShell 窗口。
- 知匣下一阶段应优先做后台文件监听、项目配置页、知识文件版本 diff/回滚、项目知识质量评分、更强的本地索引、Codex 查询入口和自动化 UI 测试；Ark-Office 用来监督 Codex 对这些建议的持续执行和验证。
