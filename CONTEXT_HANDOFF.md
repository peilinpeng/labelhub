# 迁移上下文 / 交接文档（复制给新会话即可接手）

> 更新：2026-06-07（最终迭代阶段；已落地 O7/O8 + O9 清脏数据 + **Schema Runtime Engine 受控合并 `81ad726`** + **ShowItem 媒体真渲染 P0 修复 `55a1bc0`** + **组件覆盖审计修复 upload 缺口 `f3f3cfa` / 富文本编辑器 `50ba8f0`** + **官方要求对照修复：草稿真实自动保存 `5d20b49` / 我的提交页 `e625d63`**；搭档转纯 UI 分工）。新会话**第一件事**：读本文件 → `CLAUDE.md` → `docs/final-iteration-plan.md`。
> 本文件记录客观事实 + 待办 + 等搭档项。

---

## 0. 我是谁 / 边界
- 角色：**后端负责人 + 最终合并/优化负责人**。
- 主职 `apps/api/`（Python + FastAPI + SQLAlchemy + Celery + MySQL + Redis）。
- 作为合并负责人，**前端（apps/web、packages/*）有问题也可以改**（本轮已改过 schema-designer/schema-renderer/styles/vite.config）。
- 不要改：`packages/contracts/`（除非合并搭档分支时逐项核对）、`labelhub-architecture-contract.md`。
- 纪律：改完后端要重建镜像；提交前用户确认；commit 信息结尾带 `Co-Authored-By: Claude ...`。

## 1. 仓库 / 分支 / 同步
- 路径：`/Users/xiongweiluo/LabelHub_Coding/labelhub`，远程 `git@github.com:peilinpeng/labelhub.git`（默认分支 `main`）。
- 当前分支：`integration/joint-test`，**已与远程同步（HEAD=`e625d63`，含 Schema Runtime Engine 合并 + ShowItem 媒体渲染 + upload 缺口修复 + 富文本编辑器 + 草稿自动保存 + 我的提交页），工作区干净**（仅 `.claude/` 本地 preview 产物未跟踪，不要提交）。
- 已开 PR：`integration/joint-test → dev`（base=dev，惯例 feature→dev→main）。push 后自动更新。本机**无 `gh`**，建 PR 走 GitHub 网页。
- 搭档分支 `feature/schema-governance-upgrade`（Schema Runtime Engine）**已于 `81ad726` 受控合并进主线**（详见 §6）。**分工已变更（2026-06-07）**：搭档此后只做**纯 UI/视觉优化（可能会动一点组件逻辑）**，从最新 `origin/integration/joint-test`（已含引擎）新开 `feature/ui-polish` 分支、早开 draft PR、勤 rebase；合并 + contracts 把关由**本人（合并负责人）**统一处理。她 UI 工作最可能撞的文件：`apps/web/src/features/labeler/AssignmentPage.tsx`、`apps/web/src/styles.css`、`packages/schema-renderer/src/renderers/ContainerRenderer.tsx`（O7）。

## 2. 环境关键坑（必须知道）
1. 后端跑在 Docker 镜像 `/app`，**无 hot-reload**；改后端代码必须 `docker compose build api worker && docker compose up -d api worker`。
2. **但 pytest / seed / 同步脚本走 `/workspace` 挂载**（`docker compose exec -w /workspace/apps/api api ...`），读当前源码，改测试/seed 无需重建；只有要让运行中 uvicorn 生效才重建。
3. 迁移：`docker compose exec -w /workspace/apps/api api alembic upgrade head`（head=`b2c3d4e5f6a7`）。
4. 测试：`pytest -m "not integration"`（**153 passed**）；`pytest -m integration`（真实 MySQL，1 passed）；`bash apps/api/scripts/e2e_test.sh`（**21/21**）。
5. 前端运行模式：web 容器默认 `VITE_ENABLE_MSW=false`（真实后端）；Vite `/api` 代理走 `VITE_PROXY_TARGET=http://api:3000`（容器内 localhost≠api）；宿主端口 **5173**→容器 5180。访问 `http://localhost:5173/`。
6. 三套 seed：`seed.py`(*@labelhub.test/Seed@1234，E2E 用) / `seed_demo.py`(*@labelhub.com/password123) / `seed_competition.py`(举办方真实数据 2 任务)。另有 `clean_demo.py` 清理测试杂项任务。
7. **Schema 形状坑**：契约权威是 canonical `root` 树（`kind`/`children`/`title`），**不是扁平 `nodes`**；后端 validate_schema/assignment_domain 已兼容两者，新建 schema 一律用 canonical（参考 `seed_competition.py` 的 `_schema/_field/_show/_container/_llm`）。
8. hash：`canonical-json-v1 + SHA-256`，后端 `app/utils/hashing.py` 与前端 `packages/schema-core/src/stable-hash.ts` 用同一组 test vectors 验证一致（避开浮点）。
9. DOUBAO key 已在根 `.env`（官方提供模型，接入点 EP 与 key 仅存于本地 `.env`，勿写入仓库）；真实 LLM 链路已验证可跑。

## 3. 本迭代已完成（commit 在 `integration/joint-test`）
- 后端优化计划 Part A–E（早期）+ 另一账号的 worker 修复(celery include + AI 解析鲁棒性)、audit-events 契约对齐、publish 前置校验(P2-E)、数据集导入 UI(P1-A)、富文本说明(P2-A)、clean_demo(P2-D)。
- **本会话**：
  - **对照官方课题 PDF 全量核查 + 缺口修复**（`LabelHub 数据标注平台 · AI全栈课题实现要求.pdf`）：逐条核对 4.1~4.6，确认绝大部分已真实落地（任务管理状态机/奖励/Excel导入、动态搭建全物料+联动+自定义校验+多Tab、AI预审 Function Calling+指数退避重试、审核流转 diff/批量/审计、导出 JSON/JSONL/CSV/EXCEL 真实生成+异步+列映射）。发现并修复 2 个 Labeler 功能完备性缺口：
    - `5d20b49` **草稿真实自动保存**（4.3）：原顶栏徽章是写死 `草稿已自动保存 18:02:31`（固定时间戳假文案），实际仅手动按钮无自动回存。修：答案变更且与上次已保存不同→空闲 1.2s 防抖 `saveDraft`；首次载入只建基线、切题重置基线避免误存；徽章改真实状态（保存中/草稿已自动保存 HH:MM:SS/草稿未保存）。实测编辑后触发 1 次真实 PUT /draft + 真实时间戳。
    - `e625d63` **「我的提交」页**（4.3）：原 `LABELER_SUBMISSIONS` 路由是 PlaceholderPage（"尚未完成"），但后端 `GET /me/submissions` + api `listMyAssignments` 早已就绪。修：新增 `LabelerSubmissionsPage` 按 status 归类统计（已提交·审核中/已通过/打回·待修改/进行中）+ KPI + 筛选 + 列表（状态徽章/任务标题/题目/更新时间/进入工作台，打回引导"查看意见并修改"）。实测真实后端渲染 6 条、标题解析、计数/筛选正确。
    - 结论：**Labeler 全流程已完整闭环**（领取→作答→自动保存→提交→我的提交看状态/打回→修改）。可选加分项仍未做：移动端适配、大表单虚拟化(O5)。
  - **组件覆盖度审计（B）+ 缺口修复**：对照举办方两份「标注要求.md」点名的全部物料组件，逐项核对契约/默认引擎(formily-v2)/legacy/seed 实际使用，**浏览器在真实数据上实测**。结论：标注要求点名组件 seed 已 100% 用到，但默认引擎有 1 真缺口 + 1 降级，均已修复：
    - `f3f3cfa` **upload 字段缺口修复**：默认 formily-v2 的 `getComponentName` 缺 `upload.*` 分支、registry 未注册 FileInput → `upload.image`/`upload.file` 整块不渲染；叠加 qa_quality 的 O11 联动 `setRequired(evidence)`（勾「安全违规」触发）会出现**填不了的必填字段、卡提交**。修：新增 `FormilyFileAdapter`（复用占位 FileInput，与 legacy 一致）+ 注册 `COMPONENT_NAMES.FILE` + `getComponentName`/`buildComponentProps` 加 upload 分支。实测：勾「安全违规」后证据素材上传组件正确出现（fileInputs 0→1）。
    - `50ba8f0` **富文本编辑器（替代 input.richtext 纯文本框降级）**：richtext 此前两个引擎都映射成普通 textarea。新增**零依赖** `RichTextInput`（不引 TipTap/Quill，沿用仓库零依赖+防 XSS+控包体策略）= Markdown 编辑器（工具栏加粗/标题/列表/行内代码/链接 + 文本域 + 实时预览，复用 `MarkdownPreview`；只读态直接渲染 Markdown）。字段值即 Markdown 文本，与展示侧 `show.richtext` 一致，存储/哈希无额外格式负担。`getComponentName: input.richtext → RICHTEXT`；legacy FieldRenderer 拆出走 RichTextInput。实测：联动显示「修订建议」后出现富文本工具栏，点加粗插入 `**xx**`、切预览渲染 `<strong>`。
    - **顺带确认（非缺口）**：① **O11 字段联动在默认引擎用举办方真实数据当场验证通过**（低安全分→显示+必填修订建议；勾安全违规→显示+必填证据素材）——补上了合并回归里「唯一没跑到的实时联动」。② **`HANDOFF.md §7` 第 1 条已过期**：实测默认 formily-v2 **已渲染 LLM_ASSIST**（AI 辅助按钮在），该条已在 HANDOFF 订正。
    - 验证基线更新：schema-renderer **67 测试**（ShowItem 7 + Formily 22 含 upload/richtext 回归 + SchemaRenderer 16 + LLMAssistPreflight 22）；web typecheck+build。
  - `55a1bc0` **ShowItem 媒体真渲染 P0 修复**（真实竞赛数据缺口）：① 默认 `formily-v2` 引擎此前对 SHOW_ITEM 节点 `return null`，而 seed_competition 用 ShowItem 承载 prompt/model_answer/reference/媒体 → 标注员在默认页**看不到要标的内容**；现 `FormilyRuntimeRenderer.renderSchemaNode` 加 SHOW_ITEM 分支（沿用 visibility gate）。② legacy `ShowItemRenderer` 旧实现只看 transform、永远输出纯文本，`show.image`/`show.file`/`show.richtext` 一律当文本不渲染；现按 `node.type` 真渲染 image=`<img>` / file(video)=`<video>`或下载链接 / richtext=Markdown / json=`<pre>`，含 URL 净化防 XSS，空值无 fallback 则整块隐藏。③ 新增 `packages/schema-renderer/src/markdown.tsx`（零依赖轻量 Markdown 子集渲染器，移植自 `apps/web/src/ui/markdown.tsx` 并扩展图片/链接；schema-renderer 不能反向 import apps/web 故独立一份）。④ `seed_competition._show` 加 `visibleWhen` 参数，按 `media_type` 网关 3 个媒体 ShowItem（否则视频题渲染坏图、图片题渲染空视频）；**运行库 `sv_qa_quality_v1` 已手工补丁注入同样的 visibleWhen**（seed 按标题幂等跳过，不会更新现有任务）。⑤ `AssignmentPage` 收掉电商残留「原始商品标题（不可编辑）」面板（写死读 title/body，竞赛数据无此字段 → 只显示空白），改为仅在有通用 title/body 源数据时显示。⑥ styles 加 ShowItem 媒体自适应不溢出。验证：schema-renderer typecheck + **64 测试**（含 7 ShowItem 单测 + formily-v2 渲染 ShowItem 的 P0 集成测试）；web typecheck+build；**真实后端浏览器复验**（默认 formily-v2）：video 题仅 `<video>` 无坏图、image 题仅 `<img>` 无空视频、text 题媒体块按空值隐藏、3 个文本源数据正常渲染。
  - `4bf322d` linkageRules 兼容回归测试（Schema Runtime Engine 对接，后端天然兼容）。
  - `7545548` **P1-B Designer 真实拖拽**（物料拖放 + 节点重排，原生 DnD）。
  - `284c3d3` **P2-C 响应式**（修 Reviewer 详情页 1280×800 三列溢出）。
  - `b45955f` **T1-A hash 前后端一致性 test vectors**（后端 11 + 前端 10）。
  - `053e36e` **T1-C E2E Step 21 导出→数据质量护照**（21/21）。
  - `09a74f6` **T1-D 真实后端全链路 demo runbook**（`docs/LabelHub_Demo_Guide.md`）。
  - `76d8b89` **O4 题目批量编辑**端点（`POST /tasks/{id}/items/batch-update` + 5 测试）。
  - `50192ab` **O1 提交物文档**：README 改写（去过时表述）+ deployment 加云部署 §10 + `submission/README.md` 交付物索引。
  - `285b72b` **O7 `container.tabs` 渲染成真 Tab**（前端 schema-renderer）：`ContainerRenderer` 按 `node.type` 分流，tabs 走标准 ARIA tab pattern（children.title 作 tab 头 + 预判可见性过滤隐藏子节点 + 激活 tab 被联动隐藏时回退首个可见），group/section 保留堆叠并加 `data-container-type`/`data-columns` 钩子；消费 `layout.tabStyle`（LINE/CARD）。配套 `apps/web/styles.css` 加 `[role=tablist]/[role=tab]` 样式（headless，视觉在宿主）。新增 3 单测（16/16）。
  - `21e8e3f` **O8 审核详情附原始 Prompt**（后端）：`AITraceResponse` 新增 `promptTemplate`（当前 ReviewConfig 原文）+ `promptSnapshotMatches`（原文 sha256 是否等于调用时 `promptSnapshotHash`，False=Owner 调用后改过有漂移）；`get_review_detail` 取任务 ReviewConfig 一并返回。满足 §4.4「查看 AI 评语与原始 Prompt」。openapi.json 已重导出（41 路径不变）。新增 3 测试（后端 156 passed）。**注意**：前端契约 `ReviewDetailResponse`（`packages/contracts/src/api.ts`）**没有 `aiTrace` 字段**，reviewer UI 此前连 hash 都没渲染；要 UI 展示需改 contracts（边界禁区）+ 加 UI，故止步后端响应。
  - 更早：seed_competition(举办方数据)、ai-generate 端点、canonical schema 修复、Docker 真实后端联调修复。
- 已确认无 API key 泄漏（.env gitignore，.env.example 占位）。

## 4. 验证基线（全绿）
pytest **156**（+O8 3 测试）/ integration 1 / E2E 21/21 / 前端 hash vectors 10 / schema-renderer **67**（ShowItem 7 + Formily 22 含 ShowItem/upload/richtext 回归 + SchemaRenderer 16 + LLMAssistPreflight 22）/ schema-compiler **31**（合并引入）/ packages 全测试 / web typecheck+build。**合并后需先 `npm install`**（新包 + Formily 依赖）。

## 5. 待办 TODO（我可独立做）
> 详见 `docs/final-iteration-plan.md`，对照官方 PDF 的评估见 `~/.claude/plans/`（或文档内）。

- [x] ~~O7 `container.tabs` 真 Tab~~ —— 已完成 `285b72b`（见 §3）。
- [x] ~~O8 审核详情展示原始 Prompt~~ —— 已完成 `21e8e3f`（后端响应已附 promptTemplate；UI 展示受契约边界所限未做，见 §3 注意）。
- [x] ~~O9 demo 前清理脏数据~~ —— 已执行 `clean_demo.py --apply`，删 6 个「E2E测试任务」，市场剩 3 个演示任务（pref_compare / qa_quality / news_quality）。
- [ ] **O11 联动 demo seed（推荐，demo 含金量高）**：给某 seed schema（建议 `task_demo_qa_quality`）加 `linkageRules`，让字段联动能在真实后端现场 demo（合并回归里唯一没跑到的实时联动；契约形状见 `packages/contracts/src/schema.ts` 的 `FieldLinkageRule/Effect`）。
- [ ] **O10 交付物冻结前 code review**：对累计 diff 跑 `/code-review` 扫正确性/质量。
- [ ] O5 大表单虚拟化性能、O6 移动端 —— 明确可选加分，时间够再说，否则 defer。

## 6. Schema Runtime Engine 合并（✅ 已完成 2026-06-07）
- **O2 高级字段联动（⭐⭐⭐ 核心难点）已并入主线**：受控合并提交 `81ad726`（merge `feature/schema-governance-upgrade` @ `6ce93fe`，她的 10 提交 + merge commit），**零冲突**，已 push。
- **引入能力**：新包 `@labelhub/schema-compiler`（dependency-graph + linkage runtime + headless preflight）+ schema-renderer `FormilyRuntimeRenderer` + 7 个 Formily adapters + `ComponentRegistry` + AI assist preflight UI + contracts 联动类型（`BaseFieldNode.linkageRules?` + `FieldLinkageRule/Effect`，三条规则核对通过：optional 保留 / 未引入 `clearWhenHidden` / `target=FieldNode.name`）。
- **合并后验证（全绿）**：npm install（+19 Formily 依赖）→ packages typecheck/test（schema-compiler 31 / schema-renderer 55）→ web typecheck+build → 后端 pytest **156**。
- **浏览器回归（真实后端 + 真实 LLM，全绿）**：formily-v2/legacy 渲染 + 切换无错；**AI 辅助→真实 DOUBAO 200→headless preflight 正确阻断**（必填字段在 patch 后为空）；O7 tabs 在 legacy 真 ARIA tab 可切换。**唯一没跑到**：实时字段联动 reactions —— 真实 seed schema 无 `linkageRules` 数据（仅 MSW mock 有），逻辑由 31+ 单测覆盖。
- **渲染器入口**：Labeler 页 URL `?renderer=legacy`（经典）/默认 `formily-v2`（智能联动）；`?showRendererToggle=1` 显示开发者切换按钮。
- **待办（demo 含金量高）**：给某个 seed schema（如 `task_demo_qa_quality`）加 `linkageRules`，让字段联动能现场 demo（回归里唯一没跑到的实时联动）。
- **搭档后续**：已转纯 UI（见 §1），基于最新 `origin/integration/joint-test` 起 `feature/ui-polish`。

## 7. 提交物 §八（需用户本人，非代码）
- [ ] 演示视频 5–10min（剧本见 `docs/LabelHub_Demo_Guide.md` 真实后端全链路一节）。
- [ ] 架构图、Demo 截图（放 `submission/`）。
- [ ] AI Coding 过程记录（`submission/ai-coding-log.md`）。
- [ ] 云演示环境地址 + 账号（部署指引见 `docs/deployment.md` §10）。
- 已就绪：源码✅ / README✅ / 部署文档✅ / API 文档(`apps/api/openapi.json` 41 路径 + `/docs`)✅ / `submission/README.md` 索引✅。

## 8. 验证命令速查
```bash
cd /Users/xiongweiluo/LabelHub_Coding/labelhub
docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q   # 153
bash apps/api/scripts/e2e_test.sh                                               # 21/21
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
# 前端真实后端：http://localhost:5173/  →  *@labelhub.com / password123
```

## 9. 关键文件索引
- 规划：`docs/final-iteration-plan.md`、`docs/dataset-test-scenario-plan.md`、`submission/README.md`
- 后端：`apps/api/app/{routers,services,worker,models}/`、`scripts/{seed,seed_demo,seed_competition,clean_demo,e2e_test.sh}`、`tests/`
- 前端渲染：`packages/schema-renderer/src/`（O7 改这里）、Designer：`packages/schema-designer/src/`
- 契约：`packages/contracts/src/schema.ts`（LabelHubSchema 权威形状）、hash：`packages/schema-core/src/stable-hash.ts`
