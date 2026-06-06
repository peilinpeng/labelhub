# 比赛真实数据 → 平台测试/演示方案（调研文档）

> 状态：**调研稿，未实施**。来源数据：举办方「测试数据-待标注数据」(`~/Downloads/datasets/`)。
> 目的：把官方两套真实数据接入 LabelHub，作为端到端演示 + 导入格式测试方案。
> 边界：实施时主要改 `apps/api/scripts/`（seed）与 `apps/api/tests/`，不动 contracts/前端契约。

---

## 1. 数据画像

### 1.1 qa_quality（问答质量标注）— 30 题
- 格式：excel / json / jsonl 三份等价，jsonl 30 行。
- 字段：`id, category, difficulty, lang, media_type, media_url, content_markdown, prompt, model_answer, reference, tags, source, expected_dimensions`
- 分布：
  - `media_type`：text 20 / image 4 / video 3 / markdown 3 → **需要 ShowItem 多种渲染**
  - `category`：知识问答/代码生成/文本摘要/安全合规/多轮对话/数学推理/翻译/创意写作 + 视频/图像/图文 类
  - `difficulty`：简单 8 / 中等 14 / 困难 8
  - `expected_dimensions` 全集：相关性 / 准确性 / 格式合规 / 安全性
- 标注核心对象：`model_answer`；`reference` 辅助判断。

### 1.2 preference_compare（偏好对比 / Pairwise）— 12 题
- 格式：excel / json / jsonl，jsonl 12 行。
- 字段：`id, task_type, lang, prompt, response_a, model_a, response_b, model_b, preferred, margin, dimensions, safety_flag, annotator_note`
- 分布：
  - `preferred`：A 11 / tie 1；`margin`：明显优于 9 / 略优于 2 / 相当 1；`safety_flag`：False 11 / True 1
  - `dimensions` 全集（13）：相关性/准确性/安全性/完整性/可读性/创意性/地道性/简洁性/合规性/可执行性/上下文一致/感染力/贴合度/安全提示
- 标注核心对象：`response_a` vs `response_b`；`model_a/model_b` 建议匿名展示避免偏向。

---

## 2. 字段 → 组件映射（schema 设计）

平台合法 NodeType（来自 `app/services/schema_domain.py`）：
`input.text/textarea/richtext`、`choice.radio/checkbox/select/tags`、`upload.file/image`、
`data.json`、`show.text/richtext/image/file/json`、`llm.assist`、`container.group/tabs/section`。

ShowItem 取值约定：`sourcePath = "$.item.sourcePayload.<字段名>"`（导入时整行 JSON 落为 `source_payload`）。

### 2.1 qa_quality schema（覆盖全组件）
| 采集项 | NodeType | 关键属性 |
|--------|----------|---------|
| 元信息（category/difficulty/lang）| `show.text` ×1~3 | sourcePath `$.item.sourcePayload.category` 等 |
| 用户输入 prompt | `show.text` | sourcePath `...prompt` |
| 待评估回答 model_answer | `show.text` | sourcePath `...model_answer`（标注核心）|
| 参考答案 reference | `show.text` | sourcePath `...reference` |
| 图片素材（image 题）| `show.image` | sourcePath `...media_url` |
| 视频/文件素材（video 题）| `show.file` | sourcePath `...media_url`（无 show.video，用 file 链接）|
| 图文正文（markdown 题）| `show.richtext` | sourcePath `...content_markdown` |
| 相关性评分 | `choice.radio` | options 1–5，required |
| 准确性评分 | `choice.radio` | options 1–5，required |
| 格式合规评分 | `choice.radio` | options 1–5，required |
| 安全性评分 | `choice.radio` | options 1–5，required |
| 问题类型标签 | `choice.checkbox`（或 `choice.tags`）| 事实错误/答非所问/格式问题/安全违规/信息缺失 |
| 一句话总评 | `input.text` | |
| 详细评语/打回理由 | `input.textarea` | |
| 修订建议 | `input.richtext` | |
| 修正后标准答案 | `data.json` | |
| 证据素材 | `upload.image` + `upload.file` | |
| AI 预评分 | `llm.assist` | outputBindings 预填四个评分字段 |

> 媒体题处理建议：可用 `container.tabs`/`container.section` 把「原始素材」与「评分区」分组，
> 顺带覆盖 container 组件；或按 media_type 放不同 ShowItem（运行时按需展示）。

### 2.2 preference_compare schema（覆盖全组件）
| 采集项 | NodeType | 关键属性 |
|--------|----------|---------|
| prompt | `show.text` | sourcePath `...prompt` |
| 回答 A / 回答 B | `show.text` ×2（建议 `container.tabs`/`section` 并排）| sourcePath `...response_a` / `...response_b`，匿名标题「模型A/模型B」|
| 偏好结论 preferred | `choice.radio` | A 更优 / B 更优 / 平局(tie)，required |
| 优势程度 margin | `choice.radio` | 明显优于 / 略优于 / 相当 |
| 安全风险 safety_flag | `choice.radio` | 是 / 否 |
| 判断依据维度 dimensions | `choice.checkbox`/`choice.tags` | 相关性/准确性/安全性/完整性/可读性/创意性/地道性… |
| 一句话结论 | `input.text` | |
| 判断理由 annotator_note | `input.textarea` | **required** |
| 改写/修订建议 | `input.richtext` | |
| 结构化批注 | `data.json` | |
| 证据素材 | `upload.image` + `upload.file` | |
| AI 预判 | `llm.assist` | outputBindings 预填 preferred/margin |

---

## 3. 接入方式（两个可选实施项）

### 方案 A — 真实演示种子（推荐，改 seed）
现状落差：`apps/api/scripts/seed_demo.py` 只建**一个**写死的「新闻质量」任务（`_DEMO_SCHEMA`），
`_load_items()` 只取 `datasets/` 下第一个 `*.json*`、最多 10 条。无法承载两套不同 schema 的任务。

建议实施（保持 seed_demo 幂等风格：固定 ID + 先 wipe 再 insert）：
1. 把两套数据复制进仓库：`apps/api/datasets/qa_quality.jsonl`、`apps/api/datasets/preference_compare.jsonl`
   （或 repo 根 `datasets/`，seed_demo 已有两处候选路径）。
2. 新增 `seed_competition.py`（**独立脚本，不动现有 seed_demo.py / seed.py**），建**两个任务**：
   - `task_demo_qa_quality` + 2.1 schema + ReviewConfig(维度=相关性/准确性/格式合规/安全性) + 导入 qa_quality 全部 30 题
   - `task_demo_pref_compare` + 2.2 schema + ReviewConfig(维度=相关性/准确性/完整性/可读性) + 导入 preference_compare 全部 12 题
   - 题目 `source_payload` 直接落整行 JSON；ShowItem 的 sourcePath 引用其字段。
3. 复用 seed_demo 的装配范式（Task DRAFT → SchemaDraft → SchemaVersion → ReviewConfig → DatasetItem → PUBLISHED）。
4. 演示账号沿用 `*@labelhub.com / password123`。

验证：`docker compose exec ... python scripts/seed_competition.py` → 前端真实后端模式登录，
两个任务出现在市场，逐角色走 标注→AI预审→复审→导出。

### 方案 B — 导入格式回归测试（改 tests）
目标：证明平台能吃举办方的真实 json/jsonl/excel 三格式（对应 TC-TASK-03）。
- 待确认（实施前需调研）：后端 `POST /tasks/{id}/dataset/import` 的入参是 fileId（走 upload→confirm→import），
  **Excel(xlsx) 解析是否在后端实现**（`app/services/dataset_domain.py` / `file_domain.py`）——决定 B 的可行性与范围。
- 形态：把三份样例文件作为测试 fixture，喂给导入链路，断言解析出的题数与字段（30 / 12）正确。

---

## 4. 价值与覆盖
- 用官方真实数据演示，比 mock 更有说服力；两套 schema 合起来**覆盖课题要求的全部物料组件**，
  正好佐证「模板搭建器」能力（TC-DES-01~08）。
- 媒体题（image/video/markdown）可演示 ShowItem 多形态渲染（TC-DES-05/07）。
- llm.assist 预评分演示 AI 辅助与可追溯（TC-ANS-05 / TC-AI-07）。

## 5. 开放问题（实施前定）
1. 是否替换现有「新闻质量」演示任务，还是三任务并存？（建议并存，新增独立脚本）
2. 数据放 `apps/api/datasets/` 还是 repo 根 `datasets/`？（建议 `apps/api/datasets/`，随后端镜像走）
3. 方案 B 是否需要？取决于 Excel 后端解析现状（需先查 dataset_domain/file_domain）。
4. 媒体题的 video 用 show.file 链接是否可接受（无原生 show.video 组件）。
