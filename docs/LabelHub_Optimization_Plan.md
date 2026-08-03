# LabelHub 当前优化计划

> 文档状态：执行中（M1“可信门禁”、M2“可靠运行”已完成）
> 制定日期：2026-07-31
> 评估基线：`integration/joint-test @ d4d45fc5e3a47dd271ea44012024879102d0d41c`
> 当前实施分支：`feature/optimization-iteration`
> 适用范围：前端、共享 Schema 包、后端 API、异步 Worker、CI/CD、Docker 与项目文档
> 计划周期：约 15 个工作日，可按团队人数并行压缩

## 1. 背景与结论

LabelHub 当前已经具备完整的 Owner、Labeler、Reviewer 三角色链路，Schema-driven 动态表单、AI 预审、人工审核、审计与质量导出等核心能力均已落地。现阶段不建议继续扩张大功能，优化重点应从“补功能”转向以下四项：

1. 恢复工程门禁可信度，确保类型错误、测试失败和契约漂移无法进入主线。
2. 修正幂等、上传和运行时配置中的可靠性与安全隐患。
3. 消除任务统计、审计查询等明显的性能瓶颈。
4. 降低超大页面和全局样式带来的维护与回归成本。

本计划遵循“先稳定、再安全、后性能、最后重构”的顺序，避免在缺少可靠自动化保护时直接进行大规模代码拆分。

## 2. 当前实测基线

本次评估以真实代码和本地 Docker 全栈为准，不沿用旧文档中的测试数字。

| 检查项 | 当前结果 | 结论 |
| --- | --- | --- |
| Git 工作区 | clean，本地与远端同步 | 基线稳定 |
| API 常规测试 | 228 passed，1 deselected | 通过 |
| API MySQL 集成测试 | 1 passed，228 deselected | 通过 |
| 共享包测试 | 375 passed | 通过 |
| Web 组件测试（Node 20） | 10 passed | 通过，但有未处理 MSW 请求告警 |
| Web E2E（真实后端） | 4 passed | 当前数据环境下通过 |
| Web 生产构建 | 成功 | 存在 circular chunk 警告 |
| 根目录 TypeScript 检查 | 失败 | `ShowItemRenderer.tsx:60` 数组索引类型错误 |
| Web 覆盖率 | 行覆盖率 14.89% | 关键页面覆盖不足 |
| 本机 Node 25 Web 测试 | 10 failed | Node 版本未锁定导致环境漂移 |

> 上表是优化实施前的实测基线，用于保留问题背景；M1 的最新验收结果见下节。

### 2.1 已确认的主要问题

- 根级 `npm run typecheck` 当前失败，但现有 Web CI 没有检查共享包，因此错误未被门禁拦截。
- E2E CI 注释声称会迁移和播种数据库，实际工作流只启动了 Compose。
- Web 测试覆盖率较低，多个核心业务页面覆盖率为 0%。
- `OwnerSchemaPage.tsx` 约 2970 行，`styles.css` 约 12897 行。
- Owner 任务列表会为每个任务单独请求统计，后端每次统计又执行多条 `COUNT`。
- 审计事件查询会先加载全部记录，再在 Python 内过滤 JSON 字段。
- 幂等记录写入了过期时间，但没有过期判断或实际清理；处理中请求仍可能重复执行业务逻辑。
- 文件上传把整个请求体读入内存，缺少实际大小、类型和内容校验。
- Node、Python 依赖与生产镜像的可复现性不足。
- README、部署文档和旧优化计划包含明显过期信息。

### 2.2 M1 实施结果（2026-07-31）

OPT-01～OPT-04 已完成，最新本地验收结果如下：

| 检查项 | 结果 |
| --- | --- |
| 共享包严格类型检查 | 通过 |
| 共享包测试 | 375 passed |
| Web 类型检查 | 通过 |
| Web 组件测试 | 10 passed，已消除未处理的任务统计 MSW 请求 |
| Web 生产构建 | 通过 |
| API 常规测试 | 228 passed，1 deselected |
| Compose 健康检查 | API、Web、MySQL、Redis 全部 healthy |
| 空数据库迁移 | 7 个 Alembic revision 从零执行成功 |
| 独立 E2E seed | 可重复执行并完成账号、任务、可领取数据、待审核数据自检 |
| 真实后端 E2E | Owner、Labeler、Reviewer 共 4 passed |

关键落地项：

- 修复 `ShowItemRenderer` 严格数组索引类型错误，没有降低 TypeScript 严格度。
- CI 拆分共享包与 Web 门禁，统一使用 Node 20.20.2、npm 缓存和 `npm ci`。
- 增加 `.nvmrc`、`engines`、`packageManager`，并固定 Node 20 不兼容的 MSW 依赖。
- 共享包测试统一通过 `tsx` 在 Node 20 执行 TypeScript 测试。
- API 与 Web 增加健康检查；E2E 工作流在 PR 中显式迁移、seed、验活、测试和收集失败日志。
- E2E 不再在登录失败时偷偷修复数据库，环境准备与测试断言职责已分离。
- 新增 `apps/api/scripts/seed_e2e.py`，复用确定性演示数据并对关键前置条件做失败即退出的自检。

### 2.3 M2 实施结果（2026-07-31）

OPT-05～OPT-07 已完成，可靠性与安全基线通过以下验收：

| 检查项 | 结果 |
| --- | --- |
| API 常规测试 | 257 passed，2 deselected |
| API MySQL 并发集成测试 | 2 passed，覆盖抢单与相同幂等键并发 |
| Web 类型检查 / 组件测试 | 通过 / 12 passed |
| 共享包类型检查 / 测试 | 通过 / 375 passed |
| Web 正式模式构建 | 通过，构建产物不含演示账号和默认密码 |
| Alembic 空库迁移 | 8 个 revision 从零执行成功 |
| 新迁移往返 | `upgrade → downgrade → upgrade` 通过 |
| Docker Compose | API、Web、Worker、Scheduler、MySQL、Redis 全部 healthy |
| 真实后端 E2E | Owner、Labeler、Reviewer 共 4 passed |

关键落地项：

- 幂等中间件改为主键原子预约；处理中请求返回可重试冲突，相同请求完成后回放响应，相同键不同请求体稳定冲突。
- 4xx 确定性响应进入快照，5xx 与未捕获异常释放预约；过期键可立即复用，Celery Beat 每小时清理历史记录。
- 上传链路改为分块写入临时文件并原子落盘，校验配置上限、声明大小、实际大小、扩展名、MIME、文件签名与 SHA-256。
- 上传记录创建时校验 owner 与业务资源关系；失败会标记原因并清理临时文件，确认时再次核对大小、校验和与实体文件。
- 增加 `APP_ENV` / `DEMO_MODE`、JWT 有效期、可信 Host、登录失败限流与安全响应头配置；生产环境弱密钥、默认数据库密码、Demo 模式或非共享限流会启动失败。
- 登录页演示账号只在显式 Demo 构建显示，所有演示 seed 入口均受 Demo 模式保护。

## 3. 优化目标

### 3.1 工程质量目标

- 根目录、所有共享包和 Web 的类型检查持续通过。
- CI 使用锁文件安装依赖，结果不依赖开发者机器状态。
- 全新环境可以自动完成迁移、播种、启动和 E2E。
- 所有未处理的 MSW 请求都能让测试明确失败。

### 3.2 可靠性与安全目标

- 相同幂等键的并发请求不会重复创建业务资源。
- 过期幂等键可重新使用，历史记录有清理机制。
- 上传大小受配置限制，大文件不会完整驻留 API 内存。
- 生产环境不允许默认密钥、默认密码或公开演示账号入口。

### 3.3 性能目标

- 任务列表当前页的统计信息最多通过一次批量请求获得。
- 任务统计由聚合查询完成，不再为每个状态执行独立计数。
- 审计查询在数据库层完成过滤、排序和分页。
- 热点查询具备与访问模式匹配的复合索引。

### 3.4 可维护性目标

- Web 总体行覆盖率第一阶段提升至至少 35%。
- 发布、自动保存、审核和导出等关键链路覆盖率达到至少 70%。
- `OwnerSchemaPage` 拆分后主页面控制在约 500–800 行。
- 新功能不再继续扩张单一全局样式文件。

## 4. 范围与非目标

### 4.1 本轮范围

- 类型检查与 CI 门禁
- 环境和依赖锁定
- 从零 E2E
- 幂等与文件上传
- 生产环境配置
- 任务统计与审计查询
- 数据库索引
- Web 测试覆盖
- 页面和样式拆分
- Docker 与文档收束

### 4.2 本轮不做

- 大规模视觉改版
- dnd-kit Designer 重写
- Runtime Trace Panel
- WebWorker 编译体系
- 完整历史答案迁移平台
- 与当前质量目标无关的新业务功能

## 5. 总体路线图

| 阶段 | 建议周期 | 工作包 | 主要交付物 |
| --- | ---: | --- | --- |
| 阶段 1：工程门禁 | 2–3 天 | OPT-01～OPT-04 | 全绿 CI、固定环境、从零 E2E |
| 阶段 2：可靠性与安全 | 3–4 天 | OPT-05～OPT-07 | 幂等修复、流式上传、生产配置 |
| 阶段 3：性能优化 | 3–4 天 | OPT-08～OPT-10 | 批量统计、审计分页、数据库索引 |
| 阶段 4：测试与重构 | 4–5 天 | OPT-11～OPT-13 | 覆盖率提升、页面拆分、样式治理 |
| 阶段 5：交付收束 | 1–2 天 | OPT-14～OPT-16 | 生产镜像、依赖治理、最新文档 |

## 6. 详细工作包

### OPT-01 修复当前类型检查

**优先级：P0**
**状态：已完成（2026-07-31）**

工作内容：

- 修复 `packages/schema-renderer/src/renderers/ShowItemRenderer.tsx:60` 的数组索引类型错误。
- 运行所有共享包与 Web 类型检查。
- 核查共享包严格 `tsconfig` 与 Web `tsconfig` 之间的检查差异。

验收标准：

```bash
npm run typecheck
npm --prefix apps/web run typecheck
```

两个命令均通过，且不通过降低 TypeScript 严格度规避问题。

### OPT-02 重构 CI 门禁

**优先级：P0**
**状态：已完成（2026-07-31）**

工作内容：

- 根目录执行共享包 `typecheck` 与测试。
- Web 单独执行类型检查、组件测试和生产构建。
- 所有依赖安装命令从 `npm install` 改为 `npm ci`。
- 为 npm 依赖启用可复现缓存。
- 任一步失败都必须阻止合并。

验收标准：

- 在共享包中制造类型错误，CI 必须失败。
- 在 Web 中制造测试失败，CI 必须失败。
- CI 不读取开发者机器或历史容器中的依赖。

### OPT-03 固定开发与测试环境

**优先级：P0**
**状态：已完成（2026-07-31）**

工作内容：

- 增加 `.nvmrc` 或 `.node-version`。
- 在 `package.json` 中声明 `engines.node`。
- CI、Docker 和本地文档统一使用 Node 20。
- 评估将 `apps/web` 纳入根 workspace。
- 尽量统一根目录与 Web 的锁文件和安装流程。

验收标准：

- Node 版本不匹配时有明确提示。
- Node 20 下本地与 CI 测试结果一致。
- 不再出现 Node 25 下 `localStorage` 初始化错误被误判为业务回归。

### OPT-04 建立从零可复现的 E2E

**优先级：P0**
**状态：已完成（2026-07-31）**

工作内容：

- Compose 启动后自动执行 Alembic 迁移。
- 使用独立、可重复执行的 E2E seed。
- 为 API 和 Web 增加健康检查。
- E2E 加入 `pull_request` 触发。
- 失败时自动上传 Playwright 报告与容器日志。
- 明确测试数据清理策略，避免 E2E 相互污染。

验收标准：

- 在空数据库和空 Docker volume 上执行成功。
- E2E 不依赖本地历史数据。
- Owner、Labeler、Reviewer 当前 4 条真实后端 E2E 全部通过。

### OPT-05 修正幂等中间件

**优先级：P1**
**状态：已完成（2026-07-31）**

工作内容：

- 读取记录时判断 `expires_at`。
- 增加过期记录清理任务及必要索引。
- 同一幂等键处于处理中时，不再继续执行第二次业务逻辑。
- 使用原子插入、唯一键冲突处理或数据库锁保证并发安全。
- 明确 4xx 响应是否进入幂等快照，并统一代码与注释。
- 增加并发、重复请求、不同请求体和过期场景测试。

验收标准：

- 多个并发相同请求只创建一个业务资源。
- 相同键、不同请求体稳定返回 `409 IDEMPOTENCY_CONFLICT`。
- 过期键可重新使用。
- 幂等表不会无限增长。

### OPT-06 加固文件上传

**优先级：P1**
**状态：已完成（2026-07-31）**

工作内容：

- 将整包 `request.body()` 改为分块或流式写入。
- 增加可配置的最大文件大小。
- 校验声明大小与实际大小。
- 建立 MIME 类型和扩展名白名单。
- 在创建上传记录时校验 owner 与业务资源关系。
- 上传失败时清理临时文件和孤立记录。
- 为对象存储、内容扫描和校验和验证预留接口。

验收标准：

- 超限文件无法进入 `READY`。
- 非法类型和不匹配大小被明确拒绝。
- 上传失败不留下不可追踪的半成品。
- API 内存占用不随上传文件大小线性增长。

### OPT-07 加强生产环境安全配置

**优先级：P1**
**状态：已完成（2026-07-31）**

工作内容：

- 增加 `APP_ENV` 或等价的环境标识。
- 生产环境缺少强 JWT 密钥或使用默认数据库密码时拒绝启动。
- 演示账号入口只在明确的 Demo 模式显示。
- 增加登录限流、安全响应头与可信 Host 配置。
- 将 JWT 有效期改为配置项。
- 评估 HttpOnly Cookie、刷新 Token 与撤销机制。

验收标准：

- 生产配置不完整时服务快速失败。
- 正式环境不展示演示账号密码。
- 登录接口具备基本暴力破解保护。
- 安全配置具有自动化测试。

### OPT-08 消除任务列表 N+1 请求

**优先级：P1**

工作内容：

- 任务列表直接携带统计摘要，或增加批量统计接口。
- 使用条件聚合一次计算任务状态计数。
- 前端一次获得当前页所有任务的统计数据。
- 保留独立任务统计接口供详情页使用。

验收标准：

- 展示 20 个任务时，统计相关 HTTP 请求不超过 1 次。
- 后端不再为每个状态执行一条独立 `COUNT`。
- 优化前后列表数据和进度计算结果一致。

完成记录（2026-07-31）：

- `GET /tasks?includeStats=true` 在任务分页响应中返回 `statsByTaskId`，Owner
  工作台不再逐任务请求 `/tasks/{taskId}/stats`。
- 数据集、领取、提交三张事实表各执行一次 `GROUP BY task_id + CASE WHEN`
  条件聚合，20 个任务的统计 SQL 次数固定为 3。
- 独立统计接口保留，并复用同一批量聚合实现；集成测试同时校验统计值和 SQL
  形态，Web 组件测试校验列表请求为 1、单任务统计请求为 0。

### OPT-09 优化审计查询

**优先级：P1**

工作内容：

- 将目标对象过滤下推到数据库。
- 选择“提取为普通列”或“MySQL JSON 查询”方案。
- 在数据库层完成过滤、排序、计数和分页。
- 设置明确的最大 page size。
- 对大数据量执行查询计划和内存占用测试。

验收标准：

- 查询少量结果时不加载整张审计事件表。
- `total`、排序和分页结果准确。
- 热点查询命中预期索引。

完成记录（2026-07-31）：

- 将审计目标与 actor 常用键物化为普通可空列；原始 JSON 仍是不可变权威快照，
  新写入自动同步，迁移负责历史数据回填。
- `type/types`、severity、source、全部 target ID、actor 和时间范围均在数据库
  过滤；数据库完成 `COUNT`、`(created_at, id)` 稳定倒序和游标分页。
- page size 上限固定为 200。查询只取 `limit + 1` 行，响应提供准确 `total` 与
  `nextCursor`；组合过滤、同页无重复、非法游标和超限均有自动化测试。

### OPT-10 补充数据库索引

**优先级：P1**

优先评估：

- `assignments(labeler_id, created_at)`
- `assignments(task_id, labeler_id, status)`
- `submissions(status, created_at)`
- `submissions(task_id, status)`
- `submissions(assignment_id)`
- 审计事件过滤字段与 `created_at`

实施要求：

- 加索引前使用真实查询执行 `EXPLAIN`。
- 使用 Alembic 生成明确、可回滚的迁移。
- 验证索引对写入成本和磁盘空间的影响。

验收标准：

- 热点查询不再出现不必要的全表扫描。
- Alembic 升级与回滚均通过。
- 写入性能没有不可接受的退化。

完成记录（2026-07-31）：

- 新增任务列表、领取列表、任务领取互斥、审核队列、任务提交聚合、数据领取与
  审计时间线所需复合索引；`submissions(assignment_id)` 由现有
  `(assignment_id, attempt_no)` 唯一索引左前缀覆盖，未重复创建。
- MySQL 8 `EXPLAIN` 对照已完成：用 `IGNORE INDEX` 模拟加索引前时 assignment
  与 audit task 查询均为 `ALL + Using filesort`；启用索引后分别变为
  `ix_assignments_labeler_created`、`ix_audit_events_task_created` 的 `ref +
  Backward index scan`。submission 状态队列也命中预期复合索引。
- Alembic `d4e5f6a7b8c9 ↔ e5f6a7b8c9d0` 在真实 MySQL 上完成降级、再升级；
  回滚会先恢复 MySQL 外键隐式索引，避免复合索引被外键占用导致回滚失败。
- 10,000 行 audit 形态批量写入基准：无二级索引约 22.9 ms，5 个审计索引约
  97.8 ms（约 4.27 倍索引维护成本、绝对吞吐仍约 10 万行/秒）。结合该表低频
  追加写、读多写少的用途可接受；同时主动删除被复合索引覆盖的冗余 FK 索引。

### OPT-11 提升 Web 测试覆盖率

**优先级：P1**

第一阶段目标：

- 总体行覆盖率从 14.89% 提升至至少 35%。
- 核心业务模块达到至少 70%。
- 不追求一次性覆盖纯展示型代码。

优先测试顺序：

1. Schema 草稿保存、发布与失败恢复。
2. Labeler 草稿自动保存、提交和状态只读保护。
3. AI 建议 `SAFE/WARNING/BLOCKED`。
4. Reviewer `PASS/RETURN/REVISE`。
5. 数据导入、批量编辑和导出下载。
6. 登录失效、API 异常和重试恢复。

同时处理：

- 补齐 `/tasks/:id/stats` 的 MSW handler。
- 确保未处理请求真正导致测试失败，而不是只输出告警。
- 增加覆盖率阈值，并按阶段逐步提高。

完成记录（2026-08-02）：

- Web 覆盖率已由基线 21.43% 提升到 53.30% 行 / 语句、63.55% 分支、
  53.11% 函数，并在 Vitest 中设置 35% 行 / 语句、50% 分支、35% 函数的
  强制阈值。
- 新增 Schema 草稿保存、冲突恢复、发布确认、Labeler 自动保存与只读保护、
  Reviewer `PASS/RETURN/REVISE`、数据导入 / 批量编辑 / 导出下载、401 与 500
  恢复等关键链路测试；Web 共 8 个测试文件、41 个用例通过。
- Schema Renderer 既有 `SAFE/WARNING/BLOCKED` 测试随共享包全量套件复验通过；
  MSW 保持未处理请求直接失败，并补齐任务题目、题目更新、文件上传和导出下载
  handler。

### OPT-12 拆分 Owner Schema 页面

**优先级：P2，在 OPT-01～OPT-04 完成后执行**

建议结构：

```text
OwnerSchemaPage
├── useSchemaDraft
├── useSchemaPublishing
├── useSchemaGeneration
├── SchemaPresetPanel
├── SchemaDataFieldPanel
├── ConditionRuleEditor
├── ValidationRuleEditor
├── PublishReadinessPanel
└── schema-normalization.ts
```

拆分原则：

- 纯函数进入独立模块并补单元测试。
- 请求、异步状态和副作用进入 Hook。
- 页面组件只负责编排。
- 不修改 Schema contracts 和发布语义。
- 每个小步骤都保持类型检查和 E2E 通过。

验收标准：

- 主页面控制在约 500–800 行。
- 复杂纯函数覆盖率达到至少 80%。
- 拆分前后关键页面截图和 E2E 行为一致。

完成记录（2026-08-02）：

- `OwnerSchemaPage.tsx` 从 2,970 行缩减到 345 行，页面仅保留路由参数、页面级
  编排和各面板组合。
- 异步请求、状态与副作用迁入 `useSchemaDraft.ts`，展示面板迁入
  `OwnerSchemaPanels.tsx`，Schema 标准化、规则转换和预览模型迁入
  `schema-normalization.ts`；未修改 contracts 与发布语义。
- 复杂标准化模块行覆盖率 89.14%、函数覆盖率 96.55%；Owner Schema 页面及
  面板覆盖保存、409 恢复、字段添加、AI 草稿选择应用和发布确认等关键行为。

### OPT-13 样式治理

**优先级：P2**

工作内容：

- 将全局 CSS 按 Owner、Labeler、Reviewer、Schema Runtime 和公共 UI 拆分。
- 建立颜色、间距、字号、圆角、阴影等 Design Token。
- 清理重复媒体查询和重复选择器。
- 新组件优先使用功能域样式或局部作用域。
- 对关键页面执行桌面与移动端视觉回归。

验收标准：

- 页面视觉无明显回归。
- 关键移动端页面没有横向溢出。
- 新功能不再向单一全局 CSS 文件持续追加大量规则。

完成记录（2026-08-02）：

- 原 12,897 行 `styles.css` 已改为 18 行只读入口，并按 Token、公共 UI、Owner、
  Labeler、Reviewer、Schema Runtime 和响应式规则拆分为 13 个功能域样式文件；
  原有级联顺序保持不变。
- 补充间距与字号 Token；自动分析确认不存在可安全直接删除的完全重复规则，保留
  承担级联覆盖职责的同名选择器。
- 新增桌面 Owner Schema 与移动端 Labeler、Reviewer、Owner Schema 响应式 E2E；
  2 个场景通过，关键页面均无横向溢出并生成截图附件。

### OPT-14 优化生产镜像

**优先级：P2**

工作内容：

- Web 使用多阶段构建并输出静态资源。
- 生产容器启动时不再执行 `npm install`。
- API 和 Worker 使用非 root 用户。
- 精简 Python 构建依赖与镜像层。
- API 和 Worker 复用同一确定版本镜像。
- MySQL、Redis 默认不映射公网端口。
- 增加容器健康检查和优雅退出。

验收标准：

- 生产环境不运行 Vite 开发服务器。
- 镜像可以基于锁文件重复构建。
- 镜像体积相较当前版本有明显下降。
- 容器健康状态能反映真实服务状态。

完成记录（2026-08-02）：

- Web 改为 Node 多阶段构建 + unprivileged Nginx 静态运行层；生产镜像不包含 Vite
  dev server、源码或 node_modules，启动阶段不再安装依赖。
- API 使用 `python:3.11-slim` 多阶段镜像和纯 wheel 安装，API / Worker / Scheduler
  复用同一版本镜像并以 UID 10001 运行；Compose 去除整仓源码挂载。
- MySQL / Redis 默认只在 Compose 内网开放；新增显式开发端口 override、只读文件
  系统、capability 收缩、SIGTERM 宽限期，以及覆盖 API / MySQL / Redis 的健康探针。
- `.dockerignore` 排除依赖、测试产物、文档和本地数据，Web 运行层从完整 Node
  开发环境收敛为静态 Nginx 产物。Docker Desktop 实测 Web 镜像从 194 MB 降至
  77.2 MB（约 60%），API 镜像从 645 MB 降至 502 MB（约 22%）。
- 在全新 Compose project 与空数据卷中实测迁移、确定性 seed、API / Worker /
  Scheduler / Web 健康检查全部通过；API 与 Worker 均以 UID 10001 运行。

### OPT-15 依赖与配置治理

**优先级：P2**

工作内容：

- Python 依赖使用锁文件或完整版本约束。
- 在 CI 中加入依赖漏洞扫描。
- 清理未被前端实际读取的 `VITE_API_BASE_URL`。
- 删除过时的 Compose seed 占位逻辑。
- 建立统一环境变量清单，标明是否必填、默认值和敏感等级。

验收标准：

- 相同 commit 的依赖安装结果一致。
- 配置项不存在“已声明但不生效”的情况。
- 高危依赖问题能够在 CI 中被发现。

完成记录（2026-08-02）：

- 新增生产 / 测试两套带 SHA-256 的 Python 完整锁文件，并在全新 Python 3.11
  虚拟环境用 `--require-hashes` 安装成功；API 常规测试 264 passed、2 deselected，
  真实 MySQL 并发集成测试另行 2 passed。
- 漏洞扫描推动 `python-jose` 迁移到 PyJWT，并升级 `python-dotenv`、
  `python-multipart`；`pip-audit` 最终无已知漏洞，npm 生产依赖无高危漏洞。
- CI 新增 Python 与 npm 漏洞门禁，Dependabot 覆盖 npm、pip、Docker 和 Actions。
- Docker / 本地真实链路统一使用同源 `/api`，不再声明无效 API 域名；
  `VITE_API_BASE_URL` 只保留给 GitHub Pages 子路径 Mock 构建添加路径前缀。移除
  Compose 的开发安装 / 占位结构，并建立 `docs/environment-variables.md` 权威清单。

### OPT-16 更新项目文档

**优先级：P2**

重点修正：

- 当前真实测试数量。
- 当前 E2E 数量与覆盖范围。
- 真实后端已经完成，不再保留占位后端描述。
- Docker、本地开发与 Mock 模式的端口。
- MSW 与真实后端各自的适用场景。
- 从零启动、迁移、seed、停止和清理步骤。
- 新旧优化计划的状态与历史定位。

验收标准：

- 新成员只使用 README 和运行手册即可从零启动项目。
- 文档中的所有命令均在干净环境实测。
- README、部署文档、CI 与 Docker 配置相互一致。

完成记录（2026-08-02）：

- README、API README、交付运行手册和部署文档已统一到静态 Web / 真实 API 当前
  架构，修正 API 264、共享包 375、Web 41、Playwright 6 个场景的测试基线。
- 明确 Mock 只用于隔离前端开发，真实后端已完成；统一记录 Docker 5173 / 3000、
  Vite Mock 5180 和内网 MySQL / Redis 端口。
- 从零构建、迁移、确定性 seed、测试、停止、数据清理、生产部署和故障排查均形成
  可执行命令；历史答辩与旧优化文档已在索引中标注为历史快照。
- 6 个 Playwright 场景已在 Nginx 静态 Web、真实 API 与空 MySQL 数据卷组成的生产
  拓扑中全部通过，不依赖 MSW。

## 7. 依赖关系与并行方式

```text
OPT-01 类型修复
  └── OPT-02 CI 门禁
        ├── OPT-03 环境锁定
        └── OPT-04 从零 E2E
              ├── OPT-05 幂等修复
              ├── OPT-06 上传加固
              ├── OPT-08 批量统计
              ├── OPT-09 审计查询
              └── OPT-11 测试覆盖
                    ├── OPT-12 页面拆分
                    └── OPT-13 样式治理

OPT-07、OPT-10、OPT-14、OPT-15 可在阶段 2～4 与上述任务并行。
OPT-16 在所有代码优化完成后统一收束。
```

建议团队分工：

| 角色 | 主要负责 |
| --- | --- |
| 前端 / Schema | OPT-01、OPT-03、OPT-11～OPT-13 |
| 后端 | OPT-05～OPT-10、OPT-15 的 Python 部分 |
| DevOps / 合并负责人 | OPT-02、OPT-04、OPT-14～OPT-16 |
| 产品 / QA | 关键流程验收、视觉回归、文档可执行性验证 |

## 8. 里程碑

### M1：可信门禁

完成条件：

- OPT-01～OPT-04 全部完成。
- 全新环境 E2E 通过。
- 类型错误和共享包测试失败可以被 CI 拦截。

### M2：可靠运行

完成条件：

- OPT-05～OPT-07 完成。
- 幂等并发、上传限制和生产配置测试通过。
- 不存在默认生产密钥或公开演示密码。

### M3：可扩展性能

完成条件：

- OPT-08～OPT-10 完成。
- 任务列表没有 N+1 统计请求。
- 审计查询由数据库过滤分页。
- 热点查询索引经过 `EXPLAIN` 验证。

### M4：可维护交付

完成条件：

- OPT-11～OPT-16 完成。
- 关键模块测试覆盖达到目标。
- 超大页面和样式完成第一阶段拆分。
- 生产镜像与文档完成收束。

## 9. 统一验收门禁

每次准备合并时至少执行：

```bash
# 共享包
npm ci
npm run typecheck
npm test

# Web
npm --prefix apps/web ci
npm --prefix apps/web run typecheck
npm --prefix apps/web run test:run
npm --prefix apps/web run build

# Docker 全栈
docker compose up -d --build --wait
docker compose --profile tools run --rm seed
npm --prefix apps/web run e2e

# API（Python 3.11 虚拟环境）
cd apps/api
python3.11 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
.venv/bin/python -m pytest -m "not integration" -q
cd ../..

# 提交质量
git diff --check
```

## 10. 风险与控制措施

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| 类型/CI 调整暴露更多历史问题 | 阶段 1 时间增加 | 先修门禁再开发，问题按包拆分处理 |
| 幂等修复改变部分错误响应行为 | 前端重试逻辑受影响 | 先补契约测试，再调整实现 |
| 数据库索引或查询改造影响生产数据 | 查询或写入退化 | 使用 Alembic、`EXPLAIN` 和可回滚迁移 |
| 页面拆分引发 UI 回归 | 演示流程受影响 | 每次只拆一层，保留 E2E 与截图对比 |
| Demo 与 Production 配置拆分影响演示 | 演示账号不可用 | 明确 `APP_ENV=demo`，不删除演示能力 |
| 覆盖率目标一次设得过高 | 阻塞日常提交 | 从 35% 起步，按阶段提高 |

## 11. 完成定义

单个工作包只有同时满足以下条件才算完成：

- 代码实现和必要迁移完成。
- 新增或更新自动化测试。
- 类型检查、相关测试和构建通过。
- 无敏感信息进入日志、审计和版本库。
- 文档和环境变量说明同步更新。
- `git diff --check` 通过。
- 对用户可见行为有明确验收记录。
- 不通过降低类型严格度、关闭测试或保留静默 fallback 来规避问题。

## 12. 进度跟踪表

| ID | 工作包 | 优先级 | 状态 | 负责人 | 预计工作量 | 依赖 |
| --- | --- | --- | --- | --- | ---: | --- |
| OPT-01 | 修复当前类型检查 | P0 | 已完成 | 前端 / Schema | 0.5 天 | 无 |
| OPT-02 | 重构 CI 门禁 | P0 | 已完成 | DevOps / 合并负责人 | 1 天 | OPT-01 |
| OPT-03 | 固定开发与测试环境 | P0 | 已完成 | 前端 / DevOps | 0.5 天 | OPT-02 |
| OPT-04 | 从零可复现 E2E | P0 | 已完成 | QA / DevOps | 1 天 | OPT-02 |
| OPT-05 | 修正幂等中间件 | P1 | 已完成 | 后端 | 1.5 天 | OPT-04 |
| OPT-06 | 加固文件上传 | P1 | 已完成 | 后端 | 1.5 天 | OPT-04 |
| OPT-07 | 生产环境安全配置 | P1 | 已完成 | 后端 / DevOps | 1 天 | OPT-03 |
| OPT-08 | 消除任务统计 N+1 | P1 | 已完成 | 前后端 | 1 天 | OPT-04 |
| OPT-09 | 优化审计查询 | P1 | 已完成 | 后端 | 1 天 | OPT-04 |
| OPT-10 | 补充数据库索引 | P1 | 已完成 | 后端 | 1 天 | OPT-08、OPT-09 |
| OPT-11 | 提升 Web 测试覆盖率 | P1 | 已完成 | 前端 / QA | 2 天 | OPT-04 |
| OPT-12 | 拆分 Owner Schema 页面 | P2 | 已完成 | 前端 / Schema | 2 天 | OPT-11 |
| OPT-13 | 样式治理 | P2 | 已完成 | 前端 | 1.5 天 | OPT-11 |
| OPT-14 | 优化生产镜像 | P2 | 已完成 | DevOps | 1 天 | OPT-03 |
| OPT-15 | 依赖与配置治理 | P2 | 已完成 | 前后端 / DevOps | 1 天 | OPT-03 |
| OPT-16 | 更新项目文档 | P2 | 已完成 | 合并负责人 | 1 天 | 其余任务 |

## 13. 推荐启动顺序

第一批以下四项已完成：

1. OPT-01 修复类型检查。
2. OPT-02 补齐共享包 CI 门禁。
3. OPT-03 固定 Node 与依赖安装方式。
4. OPT-04 建立空数据库可重复 E2E。

OPT-01～OPT-16 已全部完成，M1～M4 均已达成，干净环境镜像构建、迁移、seed、
健康检查和 6 个真实后端 Playwright 场景也已验证通过。下一步提交并推送本批改动，
随后创建 PR 做最终合并验收。
