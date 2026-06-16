# LabelHub 最终迭代与优化规划（后端 + 合并负责人视角）

> 日期：2026-06-07。作者角色：后端负责人 + 最终合并/优化负责人。
> 输入：搭档 Schema Runtime Engine 交接（分支 `feature/schema-governance-upgrade` @ cf3317a，**未 final**）
> + 三份目标架构文档（Quality Layer / Schema Runtime Engine v2 / Schema Version Management）。
> 原则：**竞赛最终迭代，挑高 ROI + 能强化 demo + 现实可达的；显式工业化未来项一律 defer 到"答辩讲法/未来规划"。**

---

## 0. 现状基线（事实）

- 主线分支 `integration/joint-test`：功能已很完整（前后端全绿；P0 代码侧/P1-A/P1-B/P2-A/P2-C/P2-D/P2-E + worker 真实 AI 链路已验证）。本地领先远程 2 提交（P1-B/P2-C，待 push）。
- 搭档分支 `feature/schema-governance-upgrade`：8 个提交（Formily renderer toggle + `@labelhub/schema-compiler` + linkage runtime + headless preflight + AI assist preflight UI）。**基于较旧基线**，与主线分叉（集成独有 24 / 搭档独有 8）。
- 三份文档：目标态架构。其中：
  - **Quality Layer**：第一阶段（audit events / schema governance）已落地；搭档前端 Phase A–C 已做；后端 Part E（hash/llm 元数据/audit_events/passport）已做。其余（Trust Level、telemetry、Read Model、风控快慢路径、冷热分层）= 显式未来。
  - **Schema Version Management**：Version Freeze 核心已具备（schema_versions 不可变 + submission 绑定 schemaVersionId + 旧版本可渲染，TC-DES-09/10/11 已测）。Breaking Change Detection / Deprecation / 完整 Migration Pipeline = 大部分未实现。
  - **Schema Runtime Engine v2**：搭档主导（前端 Formily/compiler/preflight/trace/dnd）。后端仅需"容纳新字段 + 最终合并 + 提交时权威校验（已有最小版）"。

---

## 1. 合并策略（最重要的决策）

**结论：暂不全量合并搭档分支，等她 final。** 但现在就做"接口面对齐"，让将来合并低摩擦。

- 现在：主线继续推进；后端**预先兼容** `linkageRules`（已天然兼容，补测试锁定）。
- 搭档 final 后：做一次**受控合并**（建议方向 `feature/schema-governance-upgrade` → 先 rebase/merge 主线最新，再进 `integration/joint-test`），重点处理 `packages/contracts` 与 `packages/schema-renderer` 冲突。
- 合并前置检查清单（到时执行）：
  1. `npm install`（新 workspace 包 `@labelhub/schema-compiler`）。
  2. contracts 冲突逐项核对：`BaseFieldNode.linkageRules?` 必须保留为 optional；不得引入 `clearWhenHidden`；`FieldLinkageRule.target` 语义 = FieldNode.name。
  3. 全量 typecheck/test/build（packages + web + api）。
  4. 浏览器回归：legacy/formily-v2 切换、字段联动、AI preflight。

---

## 2. Tier 0 — 立即做（小、稳、解锁后续）

| 项 | 内容 | 归属 | 工作量 |
|----|------|------|--------|
| T0-1 | `git push` 主线（P1-B/P2-C 等 2 提交），PR 同步 | 你 | 5min |
| T0-2 | 后端补 `linkageRules` 兼容回归测试：构造带 `linkageRules` 的 canonical schema → `validate_schema` 仍 valid；带 linkageRules 的 schema 能 publish + 取回不丢字段 | 你 (apps/api/tests) | 0.5h |
| T0-3 | 本地拉取并验证搭档分支可独立跑通（不合并，仅 `git worktree` 验证 typecheck/test/build），给搭档反馈 | 你 | 0.5h |

> T0-2 是搭档交接里唯一对后端的硬性要求的"落地证据"，也防止将来主线改动意外破坏对 linkageRules 的容忍。

---

## 3. Tier 1 — 高 ROI 优化（强化 demo + 答辩，现实可达）

挑选标准：直接对应三份文档的"已可达核心"，且强化"结构可信 → 数据可信"的质量叙事。

### T1-A 前后端 Hash 一致性 test vectors（强烈推荐，纯后端，答辩高频考点）
- 背景：三份文档都强调 `canonical-json-v1 + SHA-256` 前后端一致，且要求 test vectors。后端已有 `app/utils/hashing.py`，前端 `packages/schema-core/src/stable-hash.ts`。
- 做：新增一组共享 test vectors（固定输入 → 固定 canonical string + SHA-256），后端 pytest 与前端 vitest **各跑同一组向量断言一致**。覆盖 key 乱序、嵌套、null/undefined、数组、中文。
- 价值：直接回答答辩"hash 体系如何前后端一致"，是 Quality Layer / Schema Version Mgmt 的工程信任基石。工作量 2–3h。风险低。

### T1-B Breaking Change Detection 发布闭环（对应 Quality Layer demo 场景一）
- 现状：schema-core 侧 `checkBackwardCompatibility` 属规划；后端 publish 已有前置校验（dataset+reviewConfig，P2-E）。
- 做（最小可 demo 版）：后端发布时若检测到**删除已发布字段 / 改 field type**等破坏性变更，写一条 `SCHEMA_PUBLISH_BLOCKED` audit event 并 422 阻断；Owner Timeline 展示。
  - 注意：契约权威的完整 `CompatibilityReport` 在 schema-core（前端），后端做"最小破坏性判定 + 审计 + 阻断"即可，不重复造 schema-core 的全量 diff。
- 价值：把"不是禁止改，而是让改动透明可控"讲成完整链路。工作量 3–5h。风险中。
- 取舍：若时间紧，可只做**前端** `checkBackwardCompatibility` + PublishPreviewDialog（搭档分支可能已部分覆盖），后端仅记审计。**与搭档确认避免重复。**

### T1-C Data Quality Passport 导出闭环打磨（对应 demo 场景五，后端已 80%）
- 现状：后端 Part E 已有 passport / export_records / `DATA_QUALITY_PASSPORT_GENERATED`。
- 做：核对导出产物真的带 passport 摘要（trust/risk/AI 参与/reviewer 修改占比），并能在 Owner 导出页展示；补一条 e2e 断言。
- 价值："导出的不是裸数据，而是带质量证据链的数据"——demo 收尾最有冲击力。工作量 2–3h。风险低。

### T1-D 真实 AI 链路 demo 脚本固化（已验证可跑，固化为可复现脚本）
- 现状：llm.assist + AI 预审真实链路已验证（token/状态正确）。
- 做：写一个一键 demo 脚本/清单（seed_competition → 登录 → 领取 → AI 辅助 → 提交 → AI 预审 → 复审 → 导出带 passport），配合 `docs/LabelHub_Demo_Guide.md`。
- 价值：答辩演示不翻车。工作量 1–2h。

---

## 4. Tier 2 — 显式 Defer（写进"未来工业化规划"，答辩讲思路不实现）

这些在文档里均标注未来/未实现，竞赛性价比低、风险高，**不实现**，但要能讲清取舍：
- Quality Layer：Labeler telemetry（session timer/sendBeacon/IndexedDB）、Trust Level 计算、Risk Fast Path（Redis）、Read Model/Snapshot、Hot/Warm/Cold 生命周期、`CLIENT_TIME_DRIFT`。
- Schema Version Mgmt：完整 Migration Pipeline（Plan/DryRun/Approval/Execute + 乐观锁 + archivedAnswers + CUSTOM_TRANSFORM allowlist）、Unified Export 全量 mapping 查找。
- Schema Runtime Engine：Runtime Trace Mode 全套、dnd Designer 高级（跨容器/键盘拖拽/虚拟列表）、Formily Parity Sandbox。

> 答辩话术：底层 Ledger/契约已为这些预留扩展位（domain 可推导、SchemaVersion 可扩展、hash 体系统一、preflight 已有最小闭环），属于"架构已就位、工业化按需推进"。

---

## 5. Tier 3 — 提交物（P3，非代码，收尾必做）

- [ ] 演示视频 5–10min（建任务→搭模板(拖拽)→发布→作答→AI 辅助→提交→AI 预审→复审→导出带 passport）。
- [ ] AI Coding 过程记录（prompt 日志 / 关键决策 / 截图）——本项目多轮 AI 协作本身就是素材。
- [ ] 云部署说明（`docs/deployment.md` 已有本地版，补一段任意云平台）。
- [ ] README 链接 `apps/api/openapi.json`（Postman/Apifox 导入说明）。

---

## 6. 建议执行顺序

1. **T0**（push + linkageRules 测试 + 验证搭档分支）——半天内。
2. **T1-A（hash vectors）+ T1-C（passport 导出）+ T1-D（demo 脚本）**——纯后端/低风险，先拿下。
3. **T1-B（breaking change 闭环）**——先与搭档确认前端是否已覆盖，避免重复；后端只补审计+阻断。
4. 搭档 final 后做**受控合并**（第 1 节清单）。
5. **T3 提交物**收尾。

## 7. 与搭档的协作确认点（避免重复/冲突）
1. Breaking Change / PublishPreviewDialog 前端是否已做？后端只补审计阻断够不够？
2. 她的分支何时 final？合并基线以哪边为准（建议她 rebase 到主线最新）。
3. contracts 的 `linkageRules` / 不引入 `clearWhenHidden` / `target=FieldNode.name` 三条对齐，合并时逐项核对。
4. dnd Designer：我已做基础拖拽（P1-B）；她的 Runtime Engine 文档也含 Designer——确认是否冲突/谁为准。
