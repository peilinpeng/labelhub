# 迁移上下文 / 交接文档（复制给新会话即可接手）

> 更新：2026-06-07（最终迭代阶段）。新会话**第一件事**：读本文件 → `CLAUDE.md` → `docs/final-iteration-plan.md`。
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
- 当前分支：`integration/joint-test`，**已与远程同步，工作区干净**（仅 `.claude/` 本地 preview 产物未跟踪，不要提交）。
- 已开 PR：`integration/joint-test → dev`（base=dev，惯例 feature→dev→main）。push 后自动更新。本机**无 `gh`**，建 PR 走 GitHub 网页。
- 搭档分支 `feature/schema-governance-upgrade`（Schema Runtime Engine，**未 final**）：集成独有 33 / 搭档独有 8。

## 2. 环境关键坑（必须知道）
1. 后端跑在 Docker 镜像 `/app`，**无 hot-reload**；改后端代码必须 `docker compose build api worker && docker compose up -d api worker`。
2. **但 pytest / seed / 同步脚本走 `/workspace` 挂载**（`docker compose exec -w /workspace/apps/api api ...`），读当前源码，改测试/seed 无需重建；只有要让运行中 uvicorn 生效才重建。
3. 迁移：`docker compose exec -w /workspace/apps/api api alembic upgrade head`（head=`b2c3d4e5f6a7`）。
4. 测试：`pytest -m "not integration"`（**153 passed**）；`pytest -m integration`（真实 MySQL，1 passed）；`bash apps/api/scripts/e2e_test.sh`（**21/21**）。
5. 前端运行模式：web 容器默认 `VITE_ENABLE_MSW=false`（真实后端）；Vite `/api` 代理走 `VITE_PROXY_TARGET=http://api:3000`（容器内 localhost≠api）；宿主端口 **5173**→容器 5180。访问 `http://localhost:5173/`。
6. 三套 seed：`seed.py`(*@labelhub.test/Seed@1234，E2E 用) / `seed_demo.py`(*@labelhub.com/password123) / `seed_competition.py`(举办方真实数据 2 任务)。另有 `clean_demo.py` 清理测试杂项任务。
7. **Schema 形状坑**：契约权威是 canonical `root` 树（`kind`/`children`/`title`），**不是扁平 `nodes`**；后端 validate_schema/assignment_domain 已兼容两者，新建 schema 一律用 canonical（参考 `seed_competition.py` 的 `_schema/_field/_show/_container/_llm`）。
8. hash：`canonical-json-v1 + SHA-256`，后端 `app/utils/hashing.py` 与前端 `packages/schema-core/src/stable-hash.ts` 用同一组 test vectors 验证一致（避开浮点）。
9. DOUBAO key 已在根 `.env`（用官方提供模型 `ep-20260514105718-jthdm`）；真实 LLM 链路已验证可跑。

## 3. 本迭代已完成（commit 在 `integration/joint-test`）
- 后端优化计划 Part A–E（早期）+ 另一账号的 worker 修复(celery include + AI 解析鲁棒性)、audit-events 契约对齐、publish 前置校验(P2-E)、数据集导入 UI(P1-A)、富文本说明(P2-A)、clean_demo(P2-D)。
- **本会话**：
  - `4bf322d` linkageRules 兼容回归测试（Schema Runtime Engine 对接，后端天然兼容）。
  - `7545548` **P1-B Designer 真实拖拽**（物料拖放 + 节点重排，原生 DnD）。
  - `284c3d3` **P2-C 响应式**（修 Reviewer 详情页 1280×800 三列溢出）。
  - `b45955f` **T1-A hash 前后端一致性 test vectors**（后端 11 + 前端 10）。
  - `053e36e` **T1-C E2E Step 21 导出→数据质量护照**（21/21）。
  - `09a74f6` **T1-D 真实后端全链路 demo runbook**（`docs/LabelHub_Demo_Guide.md`）。
  - `76d8b89` **O4 题目批量编辑**端点（`POST /tasks/{id}/items/batch-update` + 5 测试）。
  - `50192ab` **O1 提交物文档**：README 改写（去过时表述）+ deployment 加云部署 §10 + `submission/README.md` 交付物索引。
  - 更早：seed_competition(举办方数据)、ai-generate 端点、canonical schema 修复、Docker 真实后端联调修复。
- 已确认无 API key 泄漏（.env gitignore，.env.example 占位）。

## 4. 验证基线（全绿）
pytest 153 / integration 1 / E2E 21/21 / 前端 hash vectors 10 / packages 全测试 / web typecheck+build。

## 5. 待办 TODO（我可独立做）
> 详见 `docs/final-iteration-plan.md`，对照官方 PDF 的评估见 `~/.claude/plans/`（或文档内）。

- [ ] **O7（推荐）`container.tabs` 渲染成真 Tab**：`packages/schema-renderer/src/renderers/ContainerRenderer.tsx` 现对 group/section/tabs 一视同仁（仅堆叠），未体现 §4.2 进阶「多 Tab 布局」(⭐⭐⭐)。改为按 `node.type` 分流：tabs 渲染可切换标签页（用 children.title 作 tab 头），group/section 给分组卡片视觉。~1-2h，前端，低冲突。
- [ ] **O8（软性）审核详情展示原始 Prompt**：§4.4 要求"查看 AI 评语与原始 Prompt"；现 aiTrace 只给 promptSnapshotHash(hash)。可在审核详情响应附 `ReviewConfig.prompt_template` 原文（后端小改 review_domain）。非硬伤（prompt 在 Owner AI 配置页可见）。
- [ ] **O9 demo 前清理脏数据**：`docker compose exec -w /workspace/apps/api api python scripts/clean_demo.py`（市场混了 E2E/并发测试任务）。
- [ ] **O10 交付物冻结前 code review**：对累计 diff 跑 `/code-review` 扫正确性/质量。
- [ ] O5 大表单虚拟化性能、O6 移动端 —— 明确可选加分，时间够再说，否则 defer。

## 6. 等搭档（不要自己做，等她交付后合并）
- **O2 高级字段联动（⭐⭐⭐ 核心难点）**：完整 Formily linkage runtime + headless preflight + AI assist preflight 在 `feature/schema-governance-upgrade`（**未 final**，她说做完给完整版）。主线 legacy renderer 只有基础 visibleWhen。
- **合并策略**：等她 final 后受控合并。冲突面已评估**很小**（两分支都改的文件主要是 `apps/web/src/features/labeler/AssignmentPage.tsx`）。合并清单：`npm install`(新包 `@labelhub/schema-compiler`) → contracts 逐项核对(`linkageRules?` optional 保留 / 不引入 `clearWhenHidden` / `target=FieldNode.name`) → 全量 typecheck/test/build → 浏览器回归(legacy/formily-v2 切换、联动、AI preflight)。
- **demo 提示**：高级联动 demo 前建议切 `formily-v2` 渲染器（Labeler 页有 toggle），或等合并后演示，否则 ⭐⭐⭐ 联动展示不充分。

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
