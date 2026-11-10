# AI 固定工作流质量改进

本文件说明第一轮实现与运行方式。当前交付基线和验收状态见 [PROJECT_STATUS](PROJECT_STATUS.md)。

## 范围

辅助 AI 生成候选，用户确认后才能采纳；预审核查标注是否符合材料和规范，不能静默修改提交。
本轮不引入自主规划、检索 Agent、OCR 或多 Agent。媒体未解析不能视为已理解。

- 服务端强制携带源材料、任务富文本规范、当前答案和绑定 Schema。已有 inputBindings 使用共享 JsonPath 解析。
  找不到的绑定显式标记；缺少绑定的源材料拒绝调用，尚未填写的答案允许保持缺失。
- 辅助模型必须返回完整 `{ "output": ... }`，支持单个命名函数调用或完整 JSON 正文；不修补截断 JSON。
  outputBindings 决定写入目标，未知目标、隐藏/禁用目标、非法选项/类型、必填联动或字段规则失败都拒绝。
  REPLACE 和同类型文本/数组 APPEND 生成最终候选，文件引用禁止由模型创建。
- outputSchema 支持显式 type、properties、required、additionalProperties（布尔）、items、enum、minimum、maximum、
  minLength、maxLength、minItems、maxItems、title、description。未知关键字失败关闭，嵌套上限 20。
  包含尚未被 headless 预检完整处理的动态选项、只读等联动时拒绝返回可采纳候选，不静默绕过。
- AI 辅助返回后，若用户已修改目标字段、切换题目或 Schema 版本，旧候选不能采纳，需要重新生成。
- 预审维度必须与配置完全匹配，数值必须有限且不能用字符串/布尔替代。
  每维按 scoreRange 归一化，再乘权重复算百分制总分；权重和必须为 1。
  模型总分相差超过 0.5 分、严重字段问题、明确请求人工、分数与结论冲突均转人工。
  自动通过与自动退回都要求合法且足够的置信度；缺失值不视为可信。
- 新任务保存完整配置与输入快照，重试使用固定模型、规范、材料、阈值和策略。
  配置禁用是即时停止开关。日志只记录摘要、计数和固定错误原因，不记录答案或模型原文。
  输入上限 256 KiB，输出上限 256 KiB，共享内核超时 10 秒，单次模型调用超时 30 秒。

## 部署与旧数据

先执行 `npm run build:migration-engine`，同时生成迁移内核与 AI 内核；Docker 构建自动执行。
部署前通过 Alembic 升级到 `a7b8c9d0e1f2`，新增可空 `ai_review_jobs.workflow_snapshot_json`。
已有任务和历史审核记录保持原样，旧待处理任务无快照时转人工，不猜测其历史配置。

旧 ReviewConfig 若缺少 scoreRange/description/有效权重，需要 Owner 根据实际规范更新并保存；
新种子已提供完整维度。系统消息和强制结构化输入纠正旧模板的审核目标，但不静默改用户保存的模板。
种子脚本不是既有任务配置升级工具，不应为更新提示词而清空业务数据。

默认仍由人工审核；本轮没有批量打开自动通过/退回，也没有修改生产数据。
回退时停止 worker、处理在途任务、保留新增可空列和历史快照；不得恢复旧的错误自动路由。
快照属于业务敏感数据，遵循现有任务权限与保留策略，不能复制到普通审计日志或公开评测仓库。

## 评测基线

`apps/api/evals/annotation-quality-v1.jsonl` 是 24 条可重复的合成探索样本：
16 条问答（好/差回答 × 正确/错误标注）、4 条偏好比较、4 条材料缺失/冲突/未解析媒体。
按原始题目组切分 development 与 holdout，避免同题的不同标注跨集合。
标签由明确的材料关系构造，尚未由独立人工裁定，不能代表真实任务分布。

冻结的种子提示词来自提交 `bcf5117e6d045c7de4dc2f1bcd3461e1be9f42d6`。
它只代表竞赛种子模板，不代表所有旧任务；Owner 旧默认模板的目标已较正确。
辅助字段目标保存在 expectedAssist，当前实时评测入口重点量化预审；辅助以真实 HTTP 边界和共享内核回归验证。
后续必须补齐人工裁定的真实样本和辅助建议采用/修改量评测，才能声称质量提升。

从仓库根目录运行（Python 3.11，安装 requirements-dev.txt）：

```bash
python apps/api/scripts/evaluate_ai_quality.py --output /tmp/ai-manifest.json
python apps/api/scripts/evaluate_ai_quality.py --live --variant baseline --env-file .env --output /tmp/ai-baseline.json
python apps/api/scripts/evaluate_ai_quality.py --live --variant current --env-file .env --output /tmp/ai-current.json
python apps/api/scripts/evaluate_ai_quality.py --replay /tmp/ai-current.json --output /tmp/ai-replay.json
```

不指定 --live 不调用模型；--limit 限制样本数，--trials 1..5 控制重复试验。
真实调用只用指定模型环境变量，不连接业务数据库。输出文件包含合成样本的模型结果，勿将真实业务结果提交 Git。
网关故障单列为 transportFailures，从质量指标分母排除；无有效输出时指标为 null，不记作正确或错误。
modelDecisionAgreement 比较模型原始判断；decisionAgreement 对 current 计算服务端路由结果，baseline 保留原始模板结论。
两项须分开阅读，不能把路由改进全部归因于提示词。还报告误放、误退、自动通过污染、转人工率、Token 和延迟。
Wilson 区间仅描述当前试验；重复试验不独立，小合成集不能证明生产误判率上限。

## 受控模型真实链路 CI

[Controlled AI workflow](../.github/workflows/controlled-ai.yml) 在 API、Web、共享包、相关脚本与
Compose 配置变更时执行，也可手动触发。它验证工程链路，不评估真实模型质量，不需要供应商密钥。
原有真实后端 E2E/监控工作流继续独立运行，没有以受控测试替换部署、权限或迁移门禁。

先安装仓库锁定的 Node/npm、Python 3.11+ 和两套 npm 依赖，再安装 Chromium。
Docker Compose 需要支持 `!reset`（本机验收版本为 5.1.3）。从仓库根运行：

```bash
npm --prefix apps/web exec -- playwright install --with-deps chromium
npm --prefix apps/web run typecheck:e2e:ai
npm run e2e:ai
```

Windows 继续要求 `LABELHUB_DOCKER_DISK_PATH` 指向实际 Docker Desktop VHDX；可用
`LABELHUB_PYTHON` 指定已有 Python 解释器。容量预检与运行中保护不变，不自动清理空间。
运行器忽略旧 Compose 项目变量和 `.env`，显式覆盖数据库、模型、JWT 等测试配置；
每次生成新项目名、私有运行目录、随机环回端口及独立数据库/文件卷，不支持接管现有环境。

只有 Web 测试入口连接宿主网络。API、worker、MySQL、Redis、受控模型留在内部网络且不发布端口；
模型控制由测试专用 Nginx 路径转发，控制接口需要本次随机凭据。初始化前及浏览器启动前均核实
容器完整 ID、项目标签、卷归属、网络成员、内部网络、模型配置与 Web 端口；缺少隔离凭证则拒绝运行。
不得绕过运行器直接把 `e2e:ai:browser` 指向业务后端。

八个 Playwright 场景使用合成材料，通过真实 API 建任务、上传/确认文件、发布 Schema 与审核配置：

- 辅助请求携带材料、答案和版本；候选在确认前不改变草稿。
- 编辑后的旧候选不可采纳；非法模型输出返回失败，草稿保持原值；合法候选采纳后保存并刷新读回。
- 真实 Celery worker 发起预审，测试屏障确认请求已发出后再修改配置，验证本次维度名称仍来自固定快照。
- Reviewer 只读展示、人工通过/退回都需要确认；原答案、AI 结果与审核历史保留，审计不包含完整答案。
- 自动路由分别覆盖正常通过、正常退回、非法输出、低置信度与分数/结论矛盾；后三者必须转人工。
- 关闭 AI 预审时直接进入人工队列；退回修改重提后可审核通过，原答案与历史保留，全程零模型调用。

模型请求只保留在受控服务的有界内存中，控制日志不输出正文；报告仅含合成测试结果和失败截图，
关闭网络 trace，不上传运行目录、容器环境或认证请求。测试不共享前次任务，不使用固定睡眠推测快照时机。
正常、失败和可处理的中断均只停止本次隔离容器，保留新建卷和 `.cache/controlled-ai/` 证据，
不删除或重建任何已有业务资源。Docker 不可访问或进程被强制终止时须自行核实本次项目状态。

## 验收与后续

审核队列和详情使用 `reviewDimensions` 显示任务自定义名称。新记录读取本次预审快照，
旧无快照记录回退到当前 ReviewConfig；缺少元数据时使用历史标准名称或原始 key，不合并成“未命名维度”。

三个历史演示任务缺少评分范围时，可在备份后执行定向维护脚本：

```bash
docker compose exec -T api python scripts/repair_demo_review_ranges.py
docker compose exec -T api python scripts/repair_demo_review_ranges.py --apply
```

默认只预览。脚本按既有种子规范和竞赛旧 Prompt 为缺失范围补 `[0,100]`，保留已有范围、名称、
权重、阈值及 Prompt；不运行 seed，不重写历史结果或快照。维度集合变化、配置缺失或权重/阈值非法时
整批拒绝。重复执行无修改；问答表单的 1–5 分与预审的 0–100 分分别保留。
已核实仅存在部分演示任务的环境，可显式使用 `--task-id` 选择允许列表中的已有任务（可重复指定）；
默认三任务完整性检查保留，所选配置缺失或非法时仍拒绝整批写入，不自动跳过、不创建任务。

确定性测试覆盖分数量纲、缺失置信度、未知字段、非法输出、截断、来源绑定、Schema 校验、
固定快照重试、旧任务转人工、真实数据库状态流转和过期候选保护。远端全栈验收覆盖部署迁移与浏览器主链路。
真实模型评测失败必须记录具体 HTTP 状态，不能用 mock 结果替代。

新闻场景的真实材料与空白人工判定已准备，见[新闻质量试用](NEWS_QUALITY_PILOT.md)。
人工金标准和人工耗时须由用户补齐，不能用自动化走查替代；真实模型评测与 Agent 化继续暂缓。
