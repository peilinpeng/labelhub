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

确定性测试覆盖分数量纲、缺失置信度、未知字段、非法输出、截断、来源绑定、Schema 校验、
固定快照重试、旧任务转人工、真实数据库状态流转和过期候选保护。远端全栈验收覆盖部署迁移与浏览器主链路。
真实模型评测失败必须记录具体 HTTP 状态，不能用 mock 结果替代。

下一轮才考虑证据位置契约、人工校准评测和有限纠错；Agent 化继续暂缓。
