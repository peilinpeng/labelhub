# HANDOFF.md — 轮班交接状态（动态表单架构）

> 本文件是两个 AI 工具（Claude Code / Codex）轮班时的**唯一实时状态来源**。
> 接手第一件事：读本文件 + `SCHEMA_ARCH_AGENT.md`，再读真实代码核对。
> 交班最后一件事：更新本文件。
> **本文件记录客观事实，不写「应该差不多了」这类模糊结论。**
>
> **关于 commit 的说明（给接手的 AI）：** 「不要 commit / push」的纪律针对的是**任务代码改动**。
> 项目维护者本人可能会为「交接文档 / 任务文件」（本文件、SCHEMA_ARCH_AGENT.md、AGENTS.md、tasks/*.md）做基础设施 commit，这是正常的，不违反纪律。
> 你（AI）在执行任务时，除非当前任务明确要求，否则仍然不要 commit 任何东西。

---

## 0. 统一编号对照表

| 统一编号 | 内容 | 状态 |
|---|---|---|
| Phase A | Prompt Feedback Loop（metadata、renderer callback、Labeler 事件、AI_ASSIST_EDITED、Reviewer AI feedback） | ✅ 已完成 |
| A-tail | mock prompt registry / 真实 SHA-256 `promptSnapshotHash` / `outputHash` | ✅ 已完成（commit 73ec0bc） |
| Phase B1 | Reviewer corrected answers + shallow patches（不写 audit） | ✅ 已完成（commit 31e4bac） |
| Phase B2 | `REVIEW_DIFF_GENERATED` audit | ✅ 已完成（commit 436886f） |
| Phase C | Export / Data Quality Passport contracts 与 mock | ✅ 已完成（contracts 6993e3b / web fcbccb4） |
| Phase D | Read Model / Snapshot / risk fast path | ⬜ 暂缓（竞赛阶段不做） |
| FE-1 | 安装 Formily + ComponentRegistry + FormilyRuntimeRenderer shell | ✅ 已完成（commit 00491e4） |
| FE-2 | 7 个 input adapter + feature flag 接入 SchemaRenderer | ✅ 已完成（commit ee1206b） |
| FE-2b | AssignmentPage 引擎切换 debug 开关 | ✅ 已完成（commit 9378e29） |
| FE-3 | Formily answers 双向同步策略（debounce + flush on submit）+ 新增测试 | ⬜ 暂缓（demo 阶段不做） |
| FE-4 | 新建 schema-compiler 包 + DependencyGraphVisitor | ✅ 已完成（commit 6827673） |
| FE-5 | FormilyReactionVisitor + linkage runtime + 测试 | ✅ 已完成（commit 0bd1ea8） |
| FE-7 | runSchemaPreflight headless 预检引擎 | ✅ 已完成（commit f089697） |
| FE-8 | AI Assist preflight UI（SAFE/WARNING/BLOCKED 三态）| ✅ 已完成（commit cf3317a） |
| FE-6 | 循环依赖 DFS 检测 | ⬜ 暂缓 |
| FE-9 | Runtime Trace Event + Trace Panel 骨架 | ⬜ 不做（见第 3 节） |
| FE-10 | Dependency Graph 可视化 + Field Inspector | ⬜ 不做 |
| FE-11 | dnd-kit Designer | ⬜ 不做（见第 3 节） |
| FE-12~14 | Designer Linkage Builder / Publish preflight / Virtual List | ⬜ 不做 |

---

## 1. 当前 Git 基线（每次开班核对，每次收班更新）

```txt
分支：    integration/joint-test（主线；feature/schema-governance-upgrade 已于 81ad726 受控合并进主线）
commit：  55a1bc0   fix(renderer): ShowItem 按类型真渲染媒体 + formily-v2 渲染 ShowItem（P0 真实数据缺口）
工作区：  clean（仅 .claude/ 本地 preview 产物未跟踪，不提交）
更新时间：2026-06-07（Claude Code：ShowItem 媒体渲染 P0 修复，已 push）
更新者：  Claude Code

三条主线均已完成并 push：
  - Schema Governance：cf3317a 及之前各 commit
  - Quality Layer：Phase A / A-tail / B1 / B2 / C 全部 push
  - Schema Runtime Engine：FE-1~FE-5 / FE-7 / FE-8 全部 push
```

---

## 2. 当前任务

**当前阶段：最终交付收束（文档、demo 路线固化、QA 记录）**

已完成的主线：

- Schema Governance：Breaking Change 检测 + Audit Timeline + Deprecation + Migration Required
- Quality Layer：Labeler 遥测 + AI Assist 审计 + Reviewer diff + Export Passport
- Schema Runtime Engine：Formily 联动运行时 + headless preflight + AI Assist 预检 UI

**当前不建议继续开发的大功能（见第 3 节）**

---

## 3. 不建议继续开发的功能（最终状态声明）

```txt
不建议继续做：dnd-kit Schema Designer（FE-11~13）
  原因：竞赛阶段时间不足，demo 故事线不依赖 Designer 可交互

不建议继续做：WebWorker / compile cache（FE-14 / 决策 5）
  原因：竞赛规模 schema 无需 Worker 隔离

不建议继续做：Runtime Trace Panel（FE-9 / FE-10）
  原因：demo 无此路线，实现成本高

不建议继续做：大范围 UI 重构
  原因：当前重点是 demo 稳定、QA 记录、答辩材料

不建议继续做：FE-3 answers debounce
  原因：demo 使用 legacy renderer，formily-v2 路径不在主 demo 路线

当前优先级：
  1. 手动 QA（见 docs/QA_TEST_RECORD.md）
  2. 补全截图（放入 docs/qa-assets/）
  3. 答辩讲解材料整理
```

---

## 4. 已完成主线详细记录

### A. Schema Governance

| 功能点 | 说明 | 状态 |
|---|---|---|
| Owner Publish Preview | 发布前兼容性检查 + 预览 diff | ✅ |
| compatibility check | Breaking Change / Deprecation / Migration Required 三类检测 | ✅ |
| deprecation rules | `FIELD_DEPRECATED` warning + 勾选确认才发布 | ✅ |
| migration required | `FIELD_TYPE_CAST_REQUIRED` 提示，不阻断发布 | ✅ |
| publish blocked | Breaking Change（`FIELD_REMOVED`）阻断发布按钮 | ✅ |
| audit timeline | publish_blocked / compatibility_checked / schema_version_published | ✅ |
| demo data | task_demo_schema_breaking_change / safe_publish / deprecation / migration_required | ✅ |

### B. Quality Layer

| 功能点 | 说明 | 状态 |
|---|---|---|
| Labeler telemetry | LABELING_SESSION_STARTED / AI_ASSIST_TRIGGERED 等事件 | ✅ |
| AI Assist audit | AI_ASSIST_SHOWN / ACCEPTED / DISMISSED / EDITED + promptSnapshotHash / outputHash | ✅ |
| Reviewer audit | REVIEW_SUBMITTED 含 patchCount | ✅ |
| Reviewer diff | computeReviewPatches + REVIEW_DIFF_GENERATED audit | ✅ |
| Reviewer AI feedback | AI_REVIEW_FEEDBACK 审计（reviewer AI 辅助打分） | ✅ |
| Export audit summary | DATA_QUALITY_PASSPORT_GENERATED + passportBatchHash（真实 SHA-256） | ✅ |
| Data Quality Passport | contracts `DataQualityPassport` + OwnerExportPage 展示摘要 | ✅ |

### C. Schema Runtime Engine / Formily

| 任务 | 功能点 | 关键文件 |
|---|---|---|
| FE-1 | Formily shell + ComponentRegistry | packages/schema-renderer/src/ComponentRegistry.ts, FormilyRuntimeRenderer.tsx |
| FE-2 | 7 adapter + feature flag（默认 legacy） | packages/schema-renderer/src/adapters/ |
| FE-2b | AssignmentPage renderer engine 切换开关 | apps/web/src/features/labeler/AssignmentPage.tsx |
| FE-4 | schema-compiler 包 + DependencyGraphVisitor | packages/schema-compiler/src/dependency-graph.ts |
| FE-5 | FormilyReactionVisitor + linkage runtime + 测试 | packages/schema-compiler/src/formily-reaction-visitor.ts |
| FE-7 | runSchemaPreflight（headless，纯函数，无 DOM） | packages/schema-compiler/src/preflight.ts |
| FE-8 | LLMAssistRenderer SAFE/WARNING/BLOCKED 三态 preflight UI | packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx |

---

## 5. 最终启动命令

```bash
# 切换到正确分支
git checkout feature/schema-governance-upgrade
git pull

# 安装依赖
npm install

# 启动 dev（必须带 MSW 环境变量）
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

访问：`http://localhost:5180`

---

## 6. 最终验证命令

```bash
cd packages/contracts && npm run typecheck && npm run test
cd packages/schema-core && npm run typecheck && npm run test
cd packages/schema-compiler && npm run typecheck && npm run test
cd packages/schema-renderer && npm run typecheck && npm run test
cd apps/web && npm run typecheck && npm run build
```

预期：全部通过，无 typecheck 错误，无 build 错误。

---

## 7. 已知边界与注意事项

```txt
1. formily-v2 当前不渲染 LLM_ASSIST 节点
   - FormilyRuntimeRenderer 对非 FIELD / CONTAINER 节点返回 null
   - AI Assist preflight（FE-8）只在 legacy renderer 下 demo
   - demo 时保持 engine 默认值（legacy），无需切换

2. Reviewer submission 重复提交可能返回 409
   - 这是状态机保护行为，不是 bug
   - 提示：刷新页面或使用不同的 sub_xxx

3. Demo 必须启用 MSW
   - 普通 npm run dev 不带 MSW，/api 请求会 404
   - 必须：VITE_ENABLE_MSW=true npm run dev

4. 截图和 QA 记录
   - 所有截图放 docs/qa-assets/
   - 命名规范见 docs/QA_TEST_RECORD.md

5. mock-db.ts 中残留 sha256:mock-* 占位符（6 处）
   - 仅在静态种子审计记录中，非 live 路径，不阻断 demo

6. Vitest <4.1.0 CVE（GHSA-5xrq-8626-4rwp）
   - 非阻断性，由维护者决定升级时机
```

---

## 8. 状态看板（最终快照）

**已完成（已 push）：**
- Schema Governance 全线 ✅
- Quality Layer 全线 ✅
- FE-1 / FE-2 / FE-2b / FE-4 / FE-5 / FE-7 / FE-8 ✅

**暂缓（竞赛不做）：**
- Phase D（Read Model / Snapshot）
- FE-3（answers debounce）
- FE-6（循环依赖 DFS）
- FE-9~14（Trace Panel / Designer / Virtual List）

**当前工作区：**
- clean（无未提交改动）
- 文档更新：HANDOFF.md / docs/LabelHub_Final_Demo_Guide.md / docs/QA_TEST_RECORD.md / docs/qa-assets/.gitkeep

---

## 9. 上一班工作日志（收班时追加，最新在上）

```txt
### 2026-06-07 | Claude Code（ShowItem 媒体渲染 P0 修复，已 push 55a1bc0）
- 背景：核对 ShowItem 对 image/video/markdown 渲染时挖出真实竞赛数据 P0 缺口——
  默认 formily-v2 引擎对 SHOW_ITEM return null（标注员看不到 prompt/答案/媒体），
  legacy ShowItemRenderer 又只输出纯文本（媒体不渲染），且页面源数据面板是电商 demo 残留。
- 改动文件：
  - packages/schema-renderer/src/FormilyRuntimeRenderer.tsx（默认引擎渲染 SHOW_ITEM）
  - packages/schema-renderer/src/renderers/ShowItemRenderer.tsx（按 node.type 真渲染 + URL 净化）
  - packages/schema-renderer/src/markdown.tsx（新，零依赖轻量 Markdown，移植自 apps/web 扩展图片/链接）
  - apps/web/src/features/labeler/AssignmentPage.tsx（删电商残留「原始商品标题」面板）
  - apps/web/src/styles.css（媒体不溢出）
  - apps/api/scripts/seed_competition.py（_show 加 visibleWhen 按 media_type 网关）
  - 测试：ShowItemRenderer.test.tsx（新，7）+ FormilyRuntimeRenderer.test.tsx（+formily-v2 P0 集成测试）
- 运行库补丁：sv_qa_quality_v1 的 schema_json 已手工注入 3 个 visibleWhen（seed 幂等不更新现有任务，故现库需直接打补丁）。
- 是否触碰边界：未改 packages/contracts/、未改架构契约；动了 apps/web 渲染层（合并负责人职责内）。
- 验证：schema-renderer typecheck + 64 测试 ✅；web typecheck+build ✅；真实后端浏览器复验 video/image/markdown 三类渲染正确、visibleWhen 网关生效 ✅。
- commit：55a1bc0（已 push，integration/joint-test 与远程同步）。

### 2026-06-07 | Claude Code（文档收束）
- 任务：最终交付收束——更新 HANDOFF.md + 新增 Final Demo Guide + QA_TEST_RECORD + qa-assets 目录
- 改动文件：
  - HANDOFF.md（更新为最终状态）
  - docs/LabelHub_Final_Demo_Guide.md（新增）
  - docs/QA_TEST_RECORD.md（新增）
  - docs/qa-assets/.gitkeep（新增）
- 是否触碰边界：否（仅文档，未改 apps / packages 任何源码）
- 验证：git diff --check ✅；git status 确认仅文档变更
- commit：待维护者确认后 commit
- 遗留问题：
  - 手动浏览器 QA 尚未完成（需维护者填写 docs/QA_TEST_RECORD.md）
  - 截图尚未放入 docs/qa-assets/

### 2026-06-07 | 维护者（push FE-8）
- 任务：push FE-8 AI Assist preflight UI（含 UI polish）
- commit：cf3317a feat(schema-renderer): add AI assist preflight UI
- 工作区：clean

### 2026-06-06 | Claude Code（FE-8 UI Polish）
- 任务：优化 FE-8 preflight UI 文案（SAFE/WARNING/BLOCKED 三态）
- 核心改动：
  - PreflightStatusBlock 新增 patchFieldNames prop，三态均显示"将更新字段：xxx"
  - SAFE → "✅ 预检通过" + "本次建议不会新增必填缺失、非法字段或隐藏清空风险。"
  - WARNING → "⚠️ 预检发现影响" + "本次建议可以应用，但会影响部分字段。"
  - BLOCKED → "⛔ 预检阻断" + "本次建议会新增无法满足的表单规则，因此不能直接应用。"
- 新增 3 个测试，总计 41/41 通过
- 验证：typecheck ✅ test ✅ build ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-8 实现）
- 任务：LLMAssistRenderer 接入 preflight（SAFE/WARNING/BLOCKED）
- 关键约束：
  - BLOCKED 时"确认应用建议"按钮 disabled（物理拦截，ACCEPTED audit 无法触发）
  - 不展示完整 answers / patch 值 / prompt
  - 不写入新 audit 事件（复用已有 SHOWN/ACCEPTED/DISMISSED/EDITED）
- 新增：convertSuggestedPatchToPreflightPatch（export，供测试直验）
- 测试：LLMAssistPreflight.test.tsx 21 个测试，全部通过
- 验证：typecheck ✅ test(41) ✅ build ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-7 Headless Preflight Engine）
- 任务：runSchemaPreflight 纯函数 headless 预检引擎
- 文件：packages/schema-compiler/src/preflight.ts（新增）
- 测试：packages/schema-compiler/src/__tests__/preflight.test.ts（17 个，node:test 而非 vitest）
- 总测试：31/31 通过
- 验证：typecheck ✅ test ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-5 + FE-4）
- FE-5：FormilyReactionVisitor + linkage runtime + FormilyRuntimeRenderer.test.tsx（7 个测试）
- 修复 vitest.config.ts 缺 @labelhub/schema-compiler alias
- 验证：typecheck ✅ test(41) ✅ build ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-2b Phase 1b 插入）
- 任务：AssignmentPage 加引擎切换 debug 开关
- 改动文件：apps/web/src/features/labeler/AssignmentPage.tsx
- 验证：typecheck ✅；git diff --check ✅

### 2026-06-06 | Claude Code（FE-2 Phase 1b）
- 任务：7 个 input adapter + feature flag 接入 SchemaRenderer
- 验证：schema-renderer typecheck ✅；test ✅(13/13)；apps/web typecheck ✅

### 2026-06-06 | Claude Code（FE-1 Phase 1a）
- 任务：安装 Formily + ComponentRegistry + FormilyRuntimeRenderer shell
- 验证：schema-renderer typecheck ✅；test ✅(13/13)；apps/web typecheck ✅
```

---

## 10. 开班检查清单（接手时逐项确认）

- [ ] 已完整读 `SCHEMA_ARCH_AGENT.md`
- [ ] 已完整读本文件（含第 0 节编号表、第 2 节当前任务）
- [ ] 已跑 `git status` / `git rev-parse HEAD`，与第 1 节基线一致
- [ ] 工作区 clean（或已理解 dirty 原因）
- [ ] 已读当前任务涉及的真实代码文件
- [ ] 已确认本轮范围，不超出第 2 节「明确不做」

---

## 11. 收班检查清单（交班前逐项确认）

- [ ] 工作区可编译，typecheck 通过（或已明确标注「未完成，卡在 X」）
- [ ] 已更新第 1 节 Git 基线（commit / 工作区状态 / 时间 / 更新者）
- [ ] 已更新第 8 节状态看板
- [ ] 已在第 9 节追加本班工作日志
- [ ] 未把跑不起来的半成品静默交接
