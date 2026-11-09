# LabelHub 项目状态

> 受 Git 管理的交付快照，代码与 GitHub Actions 是最终事实来源。更新时间：2026-11-10（Europe/Berlin）。

## 初始化保护与 Windows 日常运维（2026-11-10，已合并）

[PR #170](https://github.com/peilinpeng/labelhub/pull/170) 已合并，当前仓库代码基线为
`fd47aa989b3eb7151a9d0c3aa368a951b4d1e131`；合并树与已验证的 PR 最终提交
`75866086b6b36cf1e904862455f7b463125f9eef` 完全一致。新增保护与运维脚本，产品业务基线仍为 PR #167。
完整 diff 已完成 AI 自查，确认无密钥、本地产物或无关修改；不称为独立人工 review。

- 六个初始化/清理入口默认拒绝任何已有数据，校验先于账号更新、删除和 seed 内迁移。
  重复播种必须显式使用 disposable 模式，且测试库标记只能在空库阶段创建，绑定 MySQL UUID/库名。
  MySQL 命名锁阻止初始化并发；生产模式限制保留。业务 API、状态机、共享契约与产品迁移均未改变。
  `_labelhub_disposable_seed` 仅存在于明确登记的可丢弃测试库，不向保留业务库添加表。
- 新增 `scripts/windows-ops.ps1` / `npm run ops --`：登记、状态、启动、停止、本机备份和回读验证。
  登记固定 Docker 引擎、容器 ID/镜像/挂载/网络，核实实际 MySQL/Redis；发现其他共享数据写入者拒绝启动/备份。
  日常命令不使用旧 `.cache/activate.ps1`，不运行 Compose up/down，不重建或删除容器/卷。
  本机配置 `.local/operations.json` 同时排除出 Git 和 Docker 构建；Windows 无需额外激活 Node 或 Compose 配置。
- `D:\LabelHub-backups\daily-ops-20261110` 完成本机私有备份：SQL、12 份挂载归档及恢复元数据，
  最终版本另备份至 `D:\LabelHub-backups\daily-ops-final-20261110`；两次均有 16 个文件完整 SHA-256 回读通过。Windows ACL 仅当前用户与 SYSTEM；没有敏感数据进入 Git。
  SQL 在独立 MySQL 恢复后 23 张表、101 行逐行一致；12 份归档共 1,467 个文件的内容、大小、属主及权限一致。
  文件卷演练首次因 API 自动创建目录触发空目录断言，改用独立空目录后通过，未覆盖现有文件。
- 克隆业务库上六个入口分别以 initialize/disposable 模式实测拒绝，12 次均未改变任何行。
  本机业务库只执行两次只读保护探测，也均拒绝；已有表、101 行、历史导出与容器/卷身份保持不变。
  全新 MySQL 测试库验证登记、迁移、重复播种和默认拒绝；真实后端 CI 增加同样的六入口拒绝回归。
- 原业务环境完整 stop/start 及备份停止/恢复均已实测；只启用登记的新应用与原基础设施，保留的旧应用继续停止。
  旧镜像不会自动包含新 seed 保护，禁止在其内部执行旧 seed/clean；本轮未替换业务应用镜像或部署生产；本轮隔离验收与恢复项目均已停止并保留。

验收：共享包 392 项、API 376 项、真实 MySQL 并发 2 项、Web 68 项、维护工具 34 项，
真实后端 Playwright 11 项及审核后额外导出 1 项全部通过；类型检查、coverage、生产构建、
npm/Python 依赖审计、监控抓取/告警/Grafana、重复 seed 与数据不变检查通过。
Web coverage statements 66.83%、branches 55.17%、functions 67.53%、lines 70.15%。

备份为本机同盘副本，不提供物理介质损坏保障；SQL 不含 MySQL 系统账号和 binlog/PITR。
`verify-backup` 只验证字节，恢复演练另有上述记录；失败目录保留，容量不足仍阻断启动，不绕过保护。
PR 最终提交的四套适用工作流全部通过；合并后主线五套工作流也全部通过：
[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/42723362236)、
[API 与审计](https://github.com/peilinpeng/labelhub/actions/runs/42723362184)、
[Windows/Ubuntu 维护工具](https://github.com/peilinpeng/labelhub/actions/runs/42723362245)、
[真实后端 E2E/监控](https://github.com/peilinpeng/labelhub/actions/runs/42723362227)、
[Mock Pages](https://github.com/peilinpeng/labelhub/actions/runs/42723362288)。
合并后再次核对本机服务身份与就绪状态；两份历史导出的字节、映射、护照和权限仍正确。
异盘备份、真实模型评测和 Agent 化继续暂缓，未部署真实生产后端。操作说明见 [部署与日常运维](deployment.md)。

## 两份历史导出记录恢复（2026-11-09，已完成）

Windows 升级时发现的两份孤立导出文件现已恢复下载。逻辑备份本身没有 `export_jobs` 行，
但保留了创建/开始/成功审计和文件；原 MySQL 的已关闭 `binlog.000002` 保留完整行镜像。
先复制日志并核对 SHA-256，再离线提取删除前的两条 `SUCCEEDED` 任务和一条导出明细，
与此前成功写入的行镜像、审计、原文件内容及质量护照摘要交叉核对一致，未猜测字段或重新生成导出。

- 一份历史 JSONL 原本为 0 条数据、1 字节换行；另一份为 1 条数据、527 字节。均按原样恢复关联。
- 当前数据库另做 SQL/完整行快照备份，在独立 MySQL 和文件卷先演练恢复、重复执行及冲突拒绝。
  正式恢复短暂停止应用写入，仅在单事务中 `INSERT` 两条 `export_jobs` 和一条 `export_records`；
  未执行覆盖、删除或整库日志回放。原 98 行全部不变，恢复后共 101 行，重复执行新增 0 行。
- 关联答卷内容与 Schema 一致；当前审核状态及部分时间戳与历史时点不同，全部保持现状。
  恢复的是历史导出及其原始护照，不将当前待审答卷改为通过，不重写既有审计。
- API 和 Owner 导出中心均确认两条已完成记录可见、两份文件可下载；下载字节与原备份 SHA-256 一致。
  导出映射、明细、护照摘要一致；匿名访问返回 401，Labeler 返回 403；浏览器无写请求和脚本错误。
- 原容器、数据卷及文件均保留；正式应用恢复健康，隔离恢复项目已停止。
  私有证据、恢复前备份、原日志副本、脚本、校验清单位于 `D:\LabelHub-backups\export-recovery-20261109`，不进 Git。

本轮未修改产品代码、契约或数据库结构，代码基线仍为下述 PR #167；仅更新交付状态文档。
AI 自查已核对恢复前后完整行差异及两份文档 diff。异盘备份、真实模型评测和 Agent 化继续暂缓，未部署生产后端。

## Windows 保留数据升级与八项依赖整合（2026-11-09，已合并）

[PR #167](https://github.com/peilinpeng/labelhub/pull/167) 已合并，该轮代码基线为
`17b4cd49ffa53e4de685218a620dafad6170e704`；合并树与完整验收的最终提交
`ab0824c3bcdba47adc7ebb7b3658c495e9deb1ce` 一致。后续纯文档提交不改变代码基线。
依赖 PR #154–161 的原始提交均已纳入，GitHub 八项均为 `MERGED`。
#158 的失败来自 Web Vitest 仍为 5.0.5、其他消费者与 coverage 已为 5.1.0；现统一为 5.1.0，
保留工具链一致性检查，重新生成两棵 npm 锁文件与两份 Python 哈希锁。
同步升级 FastAPI 0.162.0、uvicorn 0.54.0、pydantic-settings 2.16.2、python-multipart 0.0.33、
pytest 9.2.0、Vite 8.3.6、esbuild 0.28.2 和 workspace Node types 26.6.6。

Windows 本次实际执行记录：

- 操作前备份至 `D:\LabelHub-backups\windows-upgrade-20261109`，目录仅当前用户与 SYSTEM 可访问。
  包含 SQL、完整行快照、应用文件、Redis/监控归档、原容器/卷元数据及配置；敏感内容不进 Git。
  SHA-256 清单逐文件校验。SQL 在独立 MySQL 卷真实导入，23 张表、98 行逐行一致；
  五份归档共 1,460 个文件恢复后内容、大小、属主与权限核对通过。
- 原库迁移 `f6a7b8c9d0e1` → `a7b8c9d0e1f2`。Windows 仅有一份新闻演示审核配置，
  显式选择 `--task-id task_demo_news_quality`，预览后只补三个 `[0,100]` 范围，再次执行无改动。
  新增选择参数保留默认三任务完整性校验、允许列表、事务和幂等，不补种缺失演示任务。
  除迁移版本、三个范围及配置修改时间，所有原有行完全一致，两个原文件内容一致。
- 原 9 个容器、6 个数据卷全部保留。原 4 个应用容器停止，原基础服务继续使用；
  新应用项目 `labelhub-windows-upgrade-20261109` 显式复用原网络和文件卷。
  API/worker/scheduler 使用同一 API 镜像，镜像标签 `windows-upgrade-20261109`；应用均健康。
  Web 为 `http://127.0.0.1:15173`，API 为 `http://127.0.0.1:13000`。
  当时的管理入口为忽略文件 `.cache/live-activate.ps1`，现已由上述固定容器 ID 的运维入口替代；旧 `.cache/activate.ps1` 指向保留的旧项目，
  不得用其 `up` 重建旧应用。原基础服务仅 `start`，不得同时启动旧新 worker。
- 3 个原用户、3 个任务、12 条数据、原提交及 AI 预审记录均可读回，旧维度名称正常回退。
  两份旧导出文件在升级备份时就缺少对应导出任务记录，当时 API 下载不可用；文件及元数据完整保留。
  此既有问题现已按上述历史行镜像恢复记录解决，不伪造关联、不删除原数据。

本地完整验收通过：共享包 392 项、API 362 项、真实 MySQL 并发 2 项、Web 68 项、
11 项真实后端 Playwright 与审核后额外导出 1 项；全部类型检查、coverage、生产构建、
23 项维护工具测试、43 份文档检查、npm/Python 依赖审计和完整 diff 检查通过。
Web 覆盖率 statements 66.83%、branches 55.17%、functions 67.53%、lines 70.15%。
监控抓取/告警/Grafana、非 root、数据库内网端口、重复 seed 及容量保护均通过。
隔离测试曾因受控模型继承不适用的健康检查导致启动未完成，修正测试服务检查并迁移/seed 后重跑通过；
产品检查、重试策略和错误检测未放宽。

受控 HTTP 模型与真实 Celery/浏览器验证了结构化材料和答案输入、确认前不自动写入、
非法输出拒绝、过期候选阻断、采纳后保存并刷新读回、异步预审和固定维度名称，
以及只读审核、人工通过/退回、历史与原答案保留，无页面脚本错误。
真实 worker 的自动路由模式下，正常高分通过，非法、低置信度和矛盾结果转人工。
这只证明工程链路，不声称真实模型质量；测试、恢复项目已停止，未删除原容器或卷。

完整 diff 由 AI 自查，确认无密钥、本地产物或无关修改；不称为独立人工 review。
PR 与分支推送的四套工作流全部通过。合并后主线五套工作流全部通过：
[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/42711440651)、
[API 与审计](https://github.com/peilinpeng/labelhub/actions/runs/42711440628)、
[Windows/Ubuntu 文档与维护工具](https://github.com/peilinpeng/labelhub/actions/runs/42711440705)、
[真实后端 E2E/监控](https://github.com/peilinpeng/labelhub/actions/runs/42711440998)、
[Mock Pages](https://github.com/peilinpeng/labelhub/actions/runs/42711440657)。
本次未部署真实生产后端。备份仍在同一物理盘，不能替代异盘灾备；异盘备份、真实模型评测和 Agent 化继续暂缓。


## 演示评分范围与自定义维度名称（2026-11-09，已合并）

[PR #164](https://github.com/peilinpeng/labelhub/pull/164) 已于 2026-11-09 合并，修复审核队列、详情中的自定义维度名称显示。
该轮代码基线：`a1013528fa135f482173e5d24b49599c84963559`；当前仓库基线见上述 PR #170。
合并提交与已验证 PR 最终提交 `5c4cc6bf44d6f6e818f127a61c7d1b802523870b` 的文件树完全一致。
新增可选 `reviewDimensions` 名称元数据，优先取本次预审快照，旧记录回退到当前配置；
缺少名称时显示历史标准名称或原始 key。已同步共享契约、API、Web 与 OpenAPI，无数据库结构变更。

上轮 macOS 本机三个演示任务（新闻质量、偏好对比、问答质量）仅补齐缺失的 `scoreRange: [0,100]`。
依据为现有种子规范及竞赛原 Prompt 的每维百分制；标注表单的 1–5 分保持原样。
权重、阈值、Prompt、历史审核结果和工作流快照未改写；其余 22 张表和 44 个原有文件内容一致。
定向维护脚本默认预览、整批校验、事务提交且可重复执行；禁止通过重新 seed 更新既有数据。

本地验证通过：共享包 392 项、API 361 项、Web 68 项，类型检查、coverage、生产构建、
42 份文档检查和依赖审计。隔离真实后端浏览器验收确认队列/详情正确显示“标注正确性”，
辅助建议、异步预审、人工通过链路正常，无页面脚本错误；模型由受控 HTTP 响应替代。
macOS 本地运行环境已在该轮更新至该次实现，备份保留，临时验收资源已清理。
完整 diff 由 AI 自查，已核对契约兼容、快照名称、权限、事务及数据保留，不称为独立人工 review。

合并后的主线五套工作流全部首次通过：[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/42635818313)、
[API 与依赖审计](https://github.com/peilinpeng/labelhub/actions/runs/42635817899)、
[Windows / Ubuntu 文档及维护工具](https://github.com/peilinpeng/labelhub/actions/runs/42635817601)、
[真实后端 E2E / 监控](https://github.com/peilinpeng/labelhub/actions/runs/42635817240)、
[Mock Pages](https://github.com/peilinpeng/labelhub/actions/runs/42635817316)。
远端全栈通过迁移、MySQL 并发、浏览器流程、审核后导出、监控与重复 seed 检查；未部署真实生产后端。

macOS 容量门槛曾阻断启动，回收可再生成的 Docker 构建缓存后完成上述操作；未删除原数据卷或备份。
按用户最新决定，Mac 不再新增构建，后续本地运行、迁移和验收操作留到 Windows；本次合并仅进行 Git、文档检查和远端 CI 核验。
Windows 接续统一按 [保留数据升级清单](WINDOWS_UPGRADE_CHECKLIST.md) 执行，覆盖主线拉取、备份验证、迁移、定向修复和隔离完整流程验收。
该轮清单仅为待执行指引；Windows 现已按上述 PR #167 记录执行。后续仍先备份目标本地数据库，再按 [AI 工作流说明](AI_WORKFLOW_QUALITY.md) 预览、执行定向修复；
macOS 数据库修改不会通过 Git 自动同步到 Windows。真实模型评测和 Agent 化继续暂缓。

## AI 固定工作流第一轮（2026-11-08，已合并）

[PR #162](https://github.com/peilinpeng/labelhub/pull/162) 已于 2026-11-08 合并。
该轮代码基线：`62f096f370c3509eaa44cee45d158d1251e096f3`；当前仓库代码基线见上述 PR #170。
合并提交与已验证 PR 最终提交 `d3b8f579484b3af2138db18db5b3be4cad59d3ea` 的文件树完全一致。

本轮实施结构化输入、严格服务端输出校验、
预审目标纠正、百分制复算与安全路由、固定配置快照及过期候选保护。
新增 24 条合成评测样本与冻结基线模板；继续使用固定 workflow，Agent 化暂缓。
实现边界、数据库迁移及评测运行方式见 [AI 固定工作流质量改进](AI_WORKFLOW_QUALITY.md)。

本地门禁通过：共享包 391 项、API 354 项、Web 64 项，
全量类型检查、Web coverage/生产构建、42 份文档检查及 diff 检查；根/Web npm 与 Python 锁文件审计无已知漏洞。
PR 四套工作流通过，隔离全栈已验证新增迁移 `a7b8c9d0e1f2`、2 项 MySQL 并发、11 项 Playwright、
额外导出 1 项，以及监控、非 root/内网端口和重复 seed。
完整 diff 由 AI 自查，已补充快照、量纲、输出类型、联动和过期候选回归；不称为独立人工 review。

合并后的主线五套工作流全部首次通过：[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/42515479228)、
[API 与依赖审计](https://github.com/peilinpeng/labelhub/actions/runs/42515479290)、
[文档及维护工具](https://github.com/peilinpeng/labelhub/actions/runs/42515479327)、
[真实后端 E2E / 监控](https://github.com/peilinpeng/labelhub/actions/runs/42515479308)、
[Mock Pages](https://github.com/peilinpeng/labelhub/actions/runs/42515479238)。
主线全栈再次通过新增迁移、2 项 MySQL 并发、11 项浏览器场景及额外导出 1 项；监控与重复 seed 验收通过。
未部署真实生产后端；线上 Pages 仍是 Mock 演示。

真实模型冒烟调用返回 HTTP 429（RateLimitError），未获得有效模型输出，
因此本轮不能给出真实模型准确率或质量提升结论。合成样本不冒充人工裁定的生产样本。
按用户确认，真实模型评测待限流解除后补充，不阻塞本轮合并；Agent 化继续暂缓。

## 当前开发与合并方式

按维护者确认，项目进入单人全栈开发阶段。同一开发者负责各层实现与验收，
取消强制他人 review 和分角色负责人审阅；保留任务分支、PR、完整 diff 自查和适用 CI。
用户已授权合并时，自查与检查通过即可推进，无需再等待另一位维护者批准。
规范见 [贡献指南](../CONTRIBUTING.md)、[工程规则](../AGENTS.md) 和 [AI 编码规则](../AI_CODING_RULES.md)。
产品内的审核、迁移审批、权限和审计机制不变；[PR #151](https://github.com/peilinpeng/labelhub/pull/151) 仅调整开发规范与状态文档。

## 角色冒烟退出错误修复（2026-11-08）

[PR #152](https://github.com/peilinpeng/labelhub/pull/152) 已于本地时间 2026-11-08 合并。
该轮代码基线：`ccad71f70f3781628619dc03e2a7f9f965d22a44`；当前仓库代码基线见上述 PR #170。

- 根因：Reviewer 标题出现时评分和统计请求仍可能在运行；旧实现卸载时未取消请求，
  评分 catch 在检查取消标记前输出日志，可能在 MSW / Vitest 退出时触发异步网络与控制台错误。
- 修复：GET 客户端与 Reviewer 读取 API 透传可选 AbortSignal；effect 清理取消队列、统计和评分请求，
  已取消结果不写状态或错误日志。取消中的评分缓存标记会释放，切回该提交可以重新加载。
  冒烟测试等待真实评分展示；真实接口错误继续保留诊断。共享契约、后端和数据库未改动。
- 新增 4 项可控延迟回归，覆盖初始卸载、队列显示后的延迟请求卸载、StrictMode 切换/重选和真实 503。
  同一回归在旧实现上 3 failed / 1 passed，在修复后 4 passed；不是通过固定等待、测试重试或屏蔽错误实现。
- 本地门禁全部通过：共享包 typecheck/test（380 项）、Web typecheck/test:coverage（64 项）、生产构建、
  41 份文档检查与 `git diff --check`。完整 Web coverage 首次加额外 5 次连续运行全部通过。
  覆盖率 statements 66.74%、branches 55.02%、functions 67.53%、lines 70.14%，四项门槛仍为 50%。
- PR 的分支推送和 PR 工作流均首次通过：[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/42424811561)、
  [真实后端 E2E](https://github.com/peilinpeng/labelhub/actions/runs/42424811560)，包含 MySQL 并发、监控、
  非 root / 内网端口、额外导出与重复 seed。完成 AI 完整 diff 自查，无密钥或本地产物；按单人规则合并。

合并提交与已验证 PR 文件树一致，主线工作流全部首次通过：
[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/42425065395)、
[真实后端 E2E / 监控](https://github.com/peilinpeng/labelhub/actions/runs/42425065368)、
[自动 Mock Pages](https://github.com/peilinpeng/labelhub/actions/runs/42425065387)。
主线 E2E 包含 11 项场景与额外导出 1 项。异盘备份继续暂缓，未部署真实生产后端。

## Windows 工程适配交付（2026-11-07）

[PR #149](https://github.com/peilinpeng/labelhub/pull/149) 已合并，工程交付基线为
`b9868806bca6133cf8c7f536e371d67ab9911683`。产品业务与共享契约仍沿用下述 PR #145 基线。
推荐 Windows PowerShell + Docker Desktop WSL2 Linux 引擎；工具链、安装与验收说明见
[Windows 本地开发](WINDOWS_DEVELOPMENT.md)。

- `xiongweiluo` 于 2026-11-07 22:34:36 UTC 对最终提交 `7b1e689` 提交真实 `APPROVED` review，
  合并前无未解决审阅讨论；四套 PR 工作流、七个检查全部通过。
- 完成跨平台构建与 Python 入口、Windows 中文诊断编码、维护 CI 的 Windows / Ubuntu 双平台覆盖。
  容量保护继续执行启动前 10 GiB、运行中 3 GiB 阈值，并检查明确指定的 Docker VHDX 宿主分区。
- Windows 完整本地验收包含共享包 380 项、Web 60 项、API 293 项（2 项集成测试单独执行）、
  MySQL 并发 2 项、真实后端 E2E 11 项及额外导出 1 项、监控、重复 seed、非 root 与内网端口检查。
  根/Web 生产依赖及 Python 哈希锁审计通过；41 份文档、23 项维护工具测试通过。
- 本机只验证合成恢复包的准备、完整读取校验及临时卷恢复比较，没有旧数据或真实异盘恢复证明。
  C / D 盘位于同一物理 NVMe；Windows 异盘 `copy` 仍明确拒绝不受支持的物理介质核验。
  **用户已明确暂缓异盘备份，不作为本次合并前置条件，也不标记为已完成。**

合并提交与已批准 PR 最终提交的文件树一致。本地主线复验通过共享包 typecheck/test、
Web typecheck/test:coverage/build:production、check:docs、test:ops 和 `git diff --check`；
Web 覆盖率为 statements 66.47%、branches 54.82%、functions 67.40%、lines 69.97%，均高于 50% 门槛。
合并后主线工作流通过：[维护工具（Windows / Ubuntu）](https://github.com/peilinpeng/labelhub/actions/runs/42421433996)、
[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/42421433934)、
[API 与依赖审计](https://github.com/peilinpeng/labelhub/actions/runs/42421434026)、
[真实后端与监控](https://github.com/peilinpeng/labelhub/actions/runs/42421433955)、
[Mock Pages](https://github.com/peilinpeng/labelhub/actions/runs/42421433933)。
共享包/Web 第一次运行的 60 项 Web 断言全部通过，但 `role-smoke.test.tsx` 退出时出现
`EnvironmentTeardownError`（待处理的控制台 RPC，伴随异步请求 `ECONNREFUSED`），导致任务失败；
当时未改代码、未跳过检查，仅重跑失败任务一次后通过；该退出时序问题现已由上述 PR #152 修复并补充回归。
未部署真实生产后端；仓库已有的 Mock Pages 工作流由合并自动触发。

## 文档维护（2026-11-05）

[PR #150](https://github.com/peilinpeng/labelhub/pull/150) 将仓库首页 README 改为英文，
并在 `AGENTS.md`、`CONTRIBUTING.md`、`AI_CODING_RULES.md` 中统一后续提交语言：
所有新提交的标题与正文使用英文，包括 merge / squash；既有提交不重写、不强制推送。
应用界面、其他文档及产品代码基线保持不变，仍为下述 PR #145 基线。
本次文档检查通过；此前本分支共享包 380 项测试、Web 60 项测试、类型检查、覆盖率检查及生产构建均通过。

## PR #145 历史交付

[PR #145](https://github.com/peilinpeng/labelhub/pull/145) 完成剩余治理、运行诊断与监控任务，
并整合依赖 PR #137–142，已于 2026-11-03 合并。
PR #145 历史产品基线：`a793e5c5d7171db4073be8f8e6bab71d675e9570`；当前仓库代码基线见上述 PR #170。
合并前全部 CI、合并后主线四套工作流与线上浏览器验收均已通过。

## 已实现能力

- Owner、Labeler、Reviewer 的任务创建、数据导入、模板配置、领取标注、AI 辅助、人工审核与导出闭环。
- Schema 不可变版本、兼容性检查、破坏性发布阻断、Deprecation、质量证据、Export Passport 与审计。
- 历史答卷迁移：固定输入与摘要、持久化预演、独立审批、后台执行、冲突检测、失败重试和不可变产物。
  原始答卷、审核结果和既有导出不被覆盖。
- 任务动作权限：允许 / 拒绝、有效期、撤销、审计；每次请求重新验证用户状态和权限，幂等回放也不绕过鉴权。
- 运行诊断：实际 Formily 事件追踪、字段依赖图、Worker 编译和有界缓存；追踪不保存答案，关闭即清空。
- 仓库内监控：就绪探针、受保护指标、低基数日志、Prometheus / Alertmanager / Grafana overlay 和自动验收。

详细说明：[治理与权限](GOVERNANCE.md)、[监控部署](OBSERVABILITY.md)、[交付记录](GOVERNANCE_DELIVERY.md)。

## PR #145 与此前维护的验证快照

| 范围 | 结果与来源 |
| --- | --- |
| API | 本地 293 passed、2 deselected，包含审批、篡改、撤权、冲突、重试与 UTC 时间回归 |
| 共享包 | 380 passed；全量 typecheck/test |
| Web | 60 passed；typecheck、coverage、生产与 Demo 构建通过 |
| Web 覆盖率 | 本次本地复验 statements 66.56%、branches 54.92%、functions 67.40%、lines 70.03%；四项门槛 50% |
| 依赖审计 | 根/Web npm 与 Python 哈希锁无已知漏洞 |
| 浏览器 | 本地子路径部署，治理桌面/390px 窄屏、Worker、实际运行追踪、深链接刷新通过；Demo 新建/预演/提交审批通过 |
| 远端集成 | [主线隔离全栈验收](https://github.com/peilinpeng/labelhub/actions/runs/41550975096)：11 项 E2E + 额外导出 1 项、MySQL 并发 2 项、监控、非 root 与内网服务约束、非空导出及迁移产物存在时重复 seed 均通过 |
| Docker 本地复验 | 2026-11-03 修复存储 I/O 与失效构建缓存后，从空构建缓存构建 API/Web；隔离栈 11 项 E2E + 额外导出 1 项、MySQL 并发 2 项、监控、非 root、内网端口及重复 seed 均通过 |
| 运维收尾 | 40 份文档一致性检查、14 项维护工具测试、本机七卷恢复比较通过；异盘目标尚待指定 |
| Pages 线上验收 | 三角色登录与深链接刷新、治理桌面/390px 窄屏、Worker、实际运行追踪通过；控制台与页面无异常 |

以下为此前 macOS 主机的恢复记录，不代表当前 Windows 电脑存在这些旧数据或已完成旧数据备份。
该主机 Docker 存储故障已完成恢复与本地完整验收：停机备份虚拟磁盘，重启恢复存储读取，
清除失效的未使用构建缓存，并回收已释放磁盘空间。原有 12 个容器和 7 个卷保留；
7 份卷备份均实际恢复到临时卷并逐文件对比通过，数据库逻辑备份已保存。
本地验收临时容器、卷及网络已清理，原有容器配置、挂载与运行/停止状态核对一致。
恢复方法、证据边界与容量检查见 [本机 Docker 恢复记录](LOCAL_DOCKER_RECOVERY.md)。

## 依赖与历史维护

- 本批整合 React Router 8.5.1、Vitest / coverage 5.0.5、OpenAI SDK 3.41.0、Alembic 1.20.1、
  SQLAlchemy 2.1.6、PyMySQL 1.2.3；新增两棵 npm 锁文件的工具链一致性检查。
- PR #136 已完成此前三批升级、Vitest / MSW 适配、Node 26.13.0 / npm 11.20.0 统一和安全修复。
- PR #143 已修复 MSW 3 的 Pages 子路径刷新。此前被替代的 15 个依赖 PR 已关闭。
- #137–142 已在 #145 合并后全部关闭；关闭时保留来源分支。

## 当前待办

初始化防误操作与 Windows 固定容器运维入口已随 PR #170 完成，日常启停/本机备份使用新入口。
下一步建议将已有的受控模型本地链路验收固化到 CI，再安排一轮实际业务任务试用与问题收敛；
这两项尚未实施，不把受控模型测试视为真实模型质量评测。

Windows 保留数据升级、#158 修复和八项依赖整合已完成，证据见上述 PR #167。
两份历史导出文件已从保留日志恢复原任务/明细并通过下载验证，原内容和恢复前备份保留。
本次 Windows 同盘备份已完成实际恢复演练，异盘复制仍按用户要求暂缓。

核心功能、依赖整合、Docker 恢复与仓库内监控已交付。2026-11-03 的维护收尾统一全仓文档定位，
新增容量保护入口、文档 CI 与异盘备份工具；此类运维脚本不改变产品业务基线。

角色冒烟测试退出错误已完成修复、回归与验收，详见上述 PR #152 记录；相关错误检测保持启用。

AI 第一轮工程实现已随 PR #162 交付。真实模型评测待服务商限流解除后补做旧/新基线对比，
再补充人工裁定的真实样本与辅助建议采用/修改量评测；当前不声称质量收益已获实证。
Agent 化继续暂缓，不作为本轮剩余交付。

异盘备份按用户要求暂缓。此前 macOS 主机的数据恢复包与包含停机磁盘副本的完整包均已准备，完成全文件 SHA-256；
七个卷归档已通过新工具在临时卷恢复比较。尚无用户指定的独立目标，
未完成异盘复制或从异盘恢复演练，不能标记为备份收尾完成。容量低于门槛时会阻断新构建；
持续空间余量需结合宿主内存交换与存储使用情况维护。具体操作见 [本地存储维护](LOCAL_STORAGE_MAINTENANCE.md)。

PR #145 历史主线证据：[API 与审计](https://github.com/peilinpeng/labelhub/actions/runs/41550975141)、
[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/41550975072)、
[真实后端/监控](https://github.com/peilinpeng/labelhub/actions/runs/41550975096)、
[Pages 部署](https://github.com/peilinpeng/labelhub/actions/runs/41550975261)。
[线上演示](https://peilinpeng.github.io/labelhub/) 仍采用 Mock，不代表真实生产后端上线。

## 明确边界

- GitHub Pages 是 Mock 演示。持久化迁移、权限和 worker 需要部署真实后端。
- 迁移只能选同一任务的两个已发布版本，单批 1–500 条、输入不超过 8 MiB；原有破坏性发布门禁继续生效。
  未注册自定义校验会阻断迁移。源答卷变化生成冲突记录，不能直接覆盖。
- 新权限是任务级动作授权，仍受现有角色入口限制；不包含组织目录、SSO 或任意角色模拟。ADMIN 使用受控 API。
- 按用户确认，本轮完成并验证仓库内监控部署，不接入未知生产服务器或外部告警渠道。
- 更深入质量分析、AI 审计摘要属于未来可选扩展，不属于本轮承诺的剩余交付清单。

## 版本语义

Git tag / commit 标识产品快照；私有 npm workspace 的 `0.1.0` 与 OpenAPI 的 `1.0.0`
分别属于包元数据和 API 服务版本，无需与产品交付 commit 相同。
