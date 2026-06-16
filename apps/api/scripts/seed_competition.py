"""
LabelHub 比赛真实数据 Seeder（方案 A：docs/dataset-test-scenario-plan.md）。

运行：cd labelhub/apps/api && python scripts/seed_competition.py
（容器内：docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py）

一键导入举办方两套真实标注数据，建两个 PUBLISHED 任务（各配额 50）：
  1. 「大模型问答质量标注」      —— qa_quality 数据集（17 类组件节点）
  2. 「偏好对比标注（RLHF）」    —— preference_compare 数据集（含 container.tabs A/B 并排）

数据来源：优先 apps/api/datasets/<stem>.jsonl|.json，找不到再回退项目根 datasets/。
幂等：按任务标题查找，已存在则跳过（不覆盖、不报错）。

与 seed_demo.py / seed.py 隔离：复用演示账号 *@labelhub.com / password123，
不修改、不依赖这两个脚本；仅新增两个独立任务。
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from datetime import datetime, timezone
from pathlib import Path

from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv()  # 必须在 import app.* 之前

from app.database import SessionLocal
from app.models.user import User
from app.models.task import Task
from app.models.schema import SchemaDraft, SchemaVersion
from app.models.dataset import DatasetItem
from app.models.review import ReviewConfig

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_PASSWORD = "password123"

# 复用演示账号（与 seed_demo 一致，互不覆盖）
_DEMO_USERS = [
    {"id": "usr_demo_owner",    "role": "OWNER",    "email": "owner@labelhub.com",    "display_name": "演示 Owner"},
    {"id": "usr_demo_labeler",  "role": "LABELER",  "email": "labeler@labelhub.com",  "display_name": "演示 Labeler"},
    {"id": "usr_demo_reviewer", "role": "REVIEWER", "email": "reviewer@labelhub.com", "display_name": "演示 Reviewer"},
]


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

def _score_options(maxv: int = 5) -> list[dict]:
    """1~maxv 分单选项（5=最高）。"""
    return [{"value": str(v), "label": f"{v} 分"} for v in range(maxv, 0, -1)]


def _count_nodes(schema: dict) -> int:
    """统计 canonical schema root 树下的节点总数（不含 root 容器本身）。"""
    def walk(nodes: list) -> int:
        total = 0
        for n in nodes:
            total += 1
            total += walk(n.get("children", []) or [])
        return total
    root = schema.get("root") or {}
    return walk(root.get("children", []) or [])


# ---------------------------------------------------------------------------
# canonical 节点构造助手（对齐 packages/contracts/src/schema.ts）
# ---------------------------------------------------------------------------

def _show(node_id: str, type_: str, title: str, source_path: str, transform: dict | None = None,
          visible_when: dict | None = None) -> dict:
    n = {"id": node_id, "kind": "SHOW_ITEM", "type": type_, "title": title, "sourcePath": source_path}
    if transform:
        n["transform"] = transform
    if visible_when:
        n["visibleWhen"] = visible_when
    return n


def _media_type_is(value: str) -> dict:
    """visibleWhen 表达式：仅当题目 media_type == value 时显示该媒体展示项。"""
    return {
        "op": "eq",
        "left": {"kind": "path", "path": "$.item.sourcePayload.media_type"},
        "right": {"kind": "literal", "value": value},
    }


def _field(node_id: str, type_: str, name: str, title: str, *, required: bool = False,
           options: list | None = None, validations: list | None = None, **extra) -> dict:
    n = {"id": node_id, "kind": "FIELD", "type": type_, "name": name, "title": title}
    if required:
        n["required"] = True
    if options is not None:
        n["options"] = options
    if validations:
        n["validations"] = validations
    n.update(extra)
    return n


def _container(node_id: str, type_: str, title: str, children: list, **extra) -> dict:
    n = {"id": node_id, "kind": "CONTAINER", "type": type_, "title": title, "children": children}
    n.update(extra)
    return n


def _llm(node_id: str, title: str, prompt_template: str, prompt_template_id: str,
         model_policy_id: str, output_bindings: list, output_mode: str = "SUGGESTION") -> dict:
    return {
        "id": node_id, "kind": "LLM_ASSIST", "type": "llm.assist", "title": title,
        "trigger": "MANUAL", "promptTemplate": prompt_template, "promptTemplateId": prompt_template_id,
        "modelPolicyId": model_policy_id, "inputBindings": {},
        "outputMode": output_mode, "outputBindings": output_bindings,
    }


def _schema(schema_id: str, name: str, task_id: str, children: list) -> dict:
    """组装 canonical LabelHubSchema（root 为 container.section）。"""
    return {
        "contractVersion": "1.1",
        "schemaId": schema_id,
        "schemaDraftRevision": 1,
        "status": "DRAFT",
        "meta": {
            "name": name, "taskId": task_id, "authorId": "usr_demo_owner",
            "createdAt": "2026-06-07T00:00:00.000Z", "updatedAt": "2026-06-07T00:00:00.000Z",
        },
        "root": {"id": "root", "kind": "CONTAINER", "type": "container.section",
                 "title": name, "children": children},
    }


# ---------------------------------------------------------------------------
# Schema 1：大模型问答质量标注（qa_quality）—— 覆盖全部组件类型
# ---------------------------------------------------------------------------

_QA_SCHEMA = _schema(
    "schema_qa_quality", "大模型问答质量标注", "task_demo_qa_quality",
    children=[
        # —— 原始数据展示（ShowItem，只读，不参与提交）——
        _show("qa-show-prompt", "show.text", "用户输入（prompt）",
              "$.item.sourcePayload.prompt", {"type": "TEXT", "fallback": "（无）"}),
        _show("qa-show-answer", "show.text", "待评估回答（model_answer）",
              "$.item.sourcePayload.model_answer", {"type": "TEXT", "fallback": "（无）"}),
        _show("qa-show-reference", "show.text", "参考答案（reference）",
              "$.item.sourcePayload.reference", {"type": "TEXT", "fallback": "（无）"}),
        # 媒体素材：按 media_type 用 visibleWhen 网关，仅显示该题对应的媒体控件
        # （否则 image/video 共用 media_url，会在视频题上多出一个坏图、图片题上多出放不了的视频）
        _show("qa-show-image", "show.image", "图片素材（image 题）",
              "$.item.sourcePayload.media_url", visible_when=_media_type_is("image")),
        _show("qa-show-markdown", "show.richtext", "图文正文（markdown 题）",
              "$.item.sourcePayload.content_markdown", visible_when=_media_type_is("markdown")),
        _show("qa-show-video", "show.file", "视频/文件素材（video 题）",
              "$.item.sourcePayload.media_url", visible_when=_media_type_is("video")),

        # —— 评分维度（1–5 分单选）——
        _field("qa-relevance", "choice.radio", "relevance", "相关性评分", required=True, options=_score_options()),
        _field("qa-accuracy", "choice.radio", "accuracy", "准确性评分", required=True, options=_score_options()),
        _field("qa-compliance", "choice.radio", "compliance", "格式合规评分", required=True, options=_score_options()),
        # 安全性低分（1~2）→ 联动：显示并要求填写「修订建议」（O11 字段联动 demo）
        _field("qa-safety", "choice.radio", "safety", "安全性评分", required=True, options=_score_options(),
               linkageRules=[{
                   "id": "lr-safety-low-requires-revision",
                   "when": {"op": "in", "left": {"kind": "path", "path": "$.answers.safety"},
                            "right": [{"kind": "literal", "value": "1"}, {"kind": "literal", "value": "2"}]},
                   "effects": [
                       {"action": "setVisible", "target": "revision_suggestion", "value": True},
                       {"action": "setRequired", "target": "revision_suggestion", "value": True},
                   ],
                   "otherwise": [
                       {"action": "setVisible", "target": "revision_suggestion", "value": False},
                       {"action": "setRequired", "target": "revision_suggestion", "value": False},
                       {"action": "clearValue", "target": "revision_suggestion"},
                   ],
               }]),

        # —— 问题类型（多选）——
        # 勾选「安全违规」→ 联动：显示并要求上传「证据素材」（O11 字段联动 demo）
        _field("qa-issues", "choice.checkbox", "issue_types", "问题类型标签", options=[
            {"value": "fact_error", "label": "事实错误"},
            {"value": "off_topic", "label": "答非所问"},
            {"value": "format", "label": "格式问题"},
            {"value": "safety", "label": "安全违规"},
            {"value": "missing", "label": "信息缺失"},
        ], linkageRules=[{
            "id": "lr-safety-issue-requires-evidence",
            "when": {"op": "in", "left": {"kind": "path", "path": "$.answers.issue_types"},
                     "right": [{"kind": "literal", "value": "safety"}]},
            "effects": [
                {"action": "setVisible", "target": "evidence", "value": True},
                {"action": "setRequired", "target": "evidence", "value": True},
            ],
            "otherwise": [
                {"action": "setVisible", "target": "evidence", "value": False},
                {"action": "setRequired", "target": "evidence", "value": False},
                {"action": "clearValue", "target": "evidence"},
            ],
        }]),

        # —— 文本类采集 ——
        _field("qa-summary", "input.text", "one_line_summary", "一句话总评"),
        _field("qa-detail", "input.textarea", "detail_comment", "详细评语 / 打回理由", required=True),
        _field("qa-revision", "input.richtext", "revision_suggestion", "修订建议"),
        _field("qa-corrected", "data.json", "corrected_answer", "修正后的标准答案"),

        # —— 证据素材（图片上传）——
        _field("qa-evidence", "upload.image", "evidence", "证据素材（截图）"),

        # —— AI 预评分（LLM 交互组件）——
        _llm("qa-ai-precheck", "AI 预评分参考",
             "请基于相关性、准确性、格式合规、安全性四个维度对该回答打分（1-5），并给出一句话结论。",
             "pt_qa_quality_v1", "mp_doubao_pro",
             output_bindings=[
                 {"from": "$.relevance", "toFieldName": "relevance", "mode": "REPLACE", "requireUserConfirm": True},
                 {"from": "$.accuracy", "toFieldName": "accuracy", "mode": "REPLACE", "requireUserConfirm": True},
                 {"from": "$.compliance", "toFieldName": "compliance", "mode": "REPLACE", "requireUserConfirm": True},
                 {"from": "$.safety", "toFieldName": "safety", "mode": "REPLACE", "requireUserConfirm": True},
             ]),
    ],
)

_QA_REVIEW_DIMENSIONS = [
    {"key": "relevance", "label": "相关性", "weight": 0.3},
    {"key": "accuracy", "label": "准确性", "weight": 0.3},
    {"key": "compliance", "label": "格式合规", "weight": 0.2},
    {"key": "safety", "label": "安全性", "weight": 0.2},
]


# ---------------------------------------------------------------------------
# Schema 2：偏好对比标注（preference_compare）—— 含 container.tabs A/B 并排
# ---------------------------------------------------------------------------

_PREF_SCHEMA = _schema(
    "schema_pref_compare", "偏好对比标注（RLHF）", "task_demo_pref_compare",
    children=[
        _show("pc-show-prompt", "show.text", "用户输入（prompt）",
              "$.item.sourcePayload.prompt", {"type": "TEXT", "fallback": "（无）"}),
        # container.tabs：A / B 并排展示（匿名标题避免偏向）
        _container("pc-tabs", "container.tabs", "回答对比", layout={"tabStyle": "LINE"}, children=[
            _container("pc-tab-a", "container.section", "模型 A", children=[
                _show("pc-show-a", "show.text", "回答 A（response_a）",
                      "$.item.sourcePayload.response_a", {"type": "TEXT", "fallback": "（无）"}),
            ]),
            _container("pc-tab-b", "container.section", "模型 B", children=[
                _show("pc-show-b", "show.text", "回答 B（response_b）",
                      "$.item.sourcePayload.response_b", {"type": "TEXT", "fallback": "（无）"}),
            ]),
        ]),

        # —— 单选采集 ——
        _field("pc-preferred", "choice.radio", "preferred", "偏好结论", required=True, options=[
            {"value": "A", "label": "A 更优"},
            {"value": "B", "label": "B 更优"},
            {"value": "tie", "label": "平局（tie）"},
        ]),
        _field("pc-margin", "choice.radio", "margin", "优势程度", required=True, options=[
            {"value": "strong", "label": "明显优于"},
            {"value": "slight", "label": "略优于"},
            {"value": "equal", "label": "相当"},
        ]),
        _field("pc-safety", "choice.radio", "safety_flag", "是否安全风险", required=True, options=[
            {"value": "yes", "label": "是"},
            {"value": "no", "label": "否"},
        ]),

        # —— 判断依据维度（多选）——
        _field("pc-dimensions", "choice.checkbox", "judge_dimensions", "判断依据维度", options=[
            {"value": "relevance", "label": "相关性"},
            {"value": "accuracy", "label": "准确性"},
            {"value": "safety", "label": "安全性"},
            {"value": "completeness", "label": "完整性"},
            {"value": "readability", "label": "可读性"},
            {"value": "creativity", "label": "创意性"},
            {"value": "idiomaticity", "label": "地道性"},
        ]),

        # —— 文本类采集 ——
        _field("pc-conclusion", "input.text", "one_line_conclusion", "一句话结论"),
        _field("pc-note", "input.textarea", "annotator_note", "判断理由", required=True,
               validations=[{"type": "minLength", "value": 30, "message": "判断理由至少 30 字"}]),
        _field("pc-rewrite", "input.richtext", "rewrite_suggestion", "改写 / 修订建议"),
        _field("pc-structured", "data.json", "structured_note", "结构化批注"),

        # —— 证据素材（文件上传）——
        _field("pc-evidence", "upload.file", "evidence", "证据素材（附件）"),

        # —— AI 预判（LLM 交互组件）——
        _llm("pc-ai-predict", "AI 预判参考",
             "请比较回答 A 与回答 B，给出偏好结论（A/B/tie）、优势程度与简要理由。",
             "pt_pref_compare_v1", "mp_doubao_pro",
             output_bindings=[
                 {"from": "$.preferred", "toFieldName": "preferred", "mode": "REPLACE", "requireUserConfirm": True},
                 {"from": "$.margin", "toFieldName": "margin", "mode": "REPLACE", "requireUserConfirm": True},
             ]),
    ],
)

_PREF_REVIEW_DIMENSIONS = [
    {"key": "relevance", "label": "相关性", "weight": 0.25},
    {"key": "accuracy", "label": "准确性", "weight": 0.25},
    {"key": "completeness", "label": "完整性", "weight": 0.25},
    {"key": "readability", "label": "可读性", "weight": 0.25},
]

_REVIEW_THRESHOLDS = {"autoPass": 0.85, "autoReturn": 0.5}
_REVIEW_CONCLUSION_MAPPING = {
    "PASS": "AI_PASSED",
    "RETURN": "RETURNED",
    "NEED_HUMAN_REVIEW": "NEEDS_HUMAN_REVIEW",
}


# ---------------------------------------------------------------------------
# AI 预审 Prompt 模板（Jinja，渲染时注入每题真实内容）
# _build_prompt_context 提供 item.sourcePayload / submission.answers / dimensions。
# 关键：dimensionScores 的 key 必须用英文维度 key（前端 DIMENSION_LABELS 按英文 key 取中文名）。
# ---------------------------------------------------------------------------

_QA_REVIEW_PROMPT = """你是「大模型问答质量」预审 AI。请基于下面这条样本的真实内容，独立评估【待评估回答】的质量。

【用户问题】
{{ item.sourcePayload.prompt }}

【待评估回答（model_answer）】
{{ item.sourcePayload.model_answer }}

【参考答案（reference）】
{{ item.sourcePayload.reference | default('（无）') }}

请对【待评估回答】逐维度打分（每维 0-100 的整数），维度如下：
{% for d in dimensions %}- {{ d.key }}：{{ d.label }}
{% endfor %}
要求：
1. dimensionScores 中每项的 key 必须用上面的英文维度 key（如 relevance / accuracy），不要用中文。
2. score 必须依据本回答的具体内容给出，不同样本应有不同分数；reason 用一句中文引用本回答的具体情况。
3. totalScore 取各维度的加权/平均（0-100）。
4. decision：质量明显合格→PASS；存在明显问题应退回→RETURN；把握不足→NEED_HUMAN_REVIEW。
5. summary 一句中文，需引用本回答的具体内容；confidence 为你的把握（0-1）。
请通过 submit_ai_review_result 函数提交结构化结果。"""

_PREF_REVIEW_PROMPT = """你是「偏好对比（RLHF）」预审 AI。请基于下面这条样本的真实内容，比较回答 A 与回答 B。

【用户问题】
{{ item.sourcePayload.prompt }}

【回答 A（response_a）】
{{ item.sourcePayload.response_a }}

【回答 B（response_b）】
{{ item.sourcePayload.response_b }}

请对「本次偏好判定所依据的质量」逐维度打分（每维 0-100 的整数），维度如下：
{% for d in dimensions %}- {{ d.key }}：{{ d.label }}
{% endfor %}
要求：
1. dimensionScores 中每项的 key 必须用上面的英文维度 key（如 relevance / completeness），不要用中文。
2. score 必须依据 A/B 的具体内容给出，不同样本应有不同分数；reason 用一句中文引用具体差异。
3. summary 用一句中文给出更优的一方（A 更优 / B 更优 / 平局）及理由，需引用具体内容。
4. decision：判定清晰可信→PASS；需要人工复核→NEED_HUMAN_REVIEW；样本质量过差→RETURN。
5. totalScore 0-100；confidence 0-1。
请通过 submit_ai_review_result 函数提交结构化结果。"""


# ---------------------------------------------------------------------------
# 任务定义（固定 ID，便于排查；幂等以标题判断）
# ---------------------------------------------------------------------------

_TASKS = [
    {
        "stem": "qa_quality",
        "title": "大模型问答质量标注",
        "description": "对大模型回答按相关性/准确性/格式合规/安全性进行评分与判定（举办方真实数据）。",
        "tags": ["competition", "qa_quality"],
        "ids": {"task": "task_demo_qa_quality", "draft": "sd_qa_quality",
                "sv": "sv_qa_quality_v1", "rc": "rc_qa_quality"},
        "schema": _QA_SCHEMA,
        "dimensions": _QA_REVIEW_DIMENSIONS,
        "review_prompt": _QA_REVIEW_PROMPT,
        "item_prefix": "item_qa",
    },
    {
        "stem": "preference_compare",
        "title": "偏好对比标注（RLHF）",
        "description": "对同一 prompt 下两个模型回答做偏好判定，用于奖励模型 / 偏好对齐（举办方真实数据）。",
        "tags": ["competition", "preference_compare"],
        "ids": {"task": "task_demo_pref_compare", "draft": "sd_pref_compare",
                "sv": "sv_pref_compare_v1", "rc": "rc_pref_compare"},
        "schema": _PREF_SCHEMA,
        "dimensions": _PREF_REVIEW_DIMENSIONS,
        "review_prompt": _PREF_REVIEW_PROMPT,
        "item_prefix": "item_pc",
    },
]


# ---------------------------------------------------------------------------
# 数据加载：优先 apps/api/datasets/，回退项目根 datasets/
# ---------------------------------------------------------------------------

def _load_dataset(stem: str) -> list[dict]:
    candidates_dirs = [
        Path(__file__).resolve().parents[1] / "datasets",   # apps/api/datasets/
        Path(__file__).resolve().parents[3] / "datasets",   # 项目根 datasets/
    ]
    for d in candidates_dirs:
        for suffix in (".jsonl", ".json"):
            f = d / f"{stem}{suffix}"
            if f.is_file():
                text = f.read_text(encoding="utf-8")
                if suffix == ".jsonl":
                    rows = [json.loads(l) for l in text.splitlines() if l.strip()]
                else:
                    rows = json.loads(text)
                    rows = rows if isinstance(rows, list) else [rows]
                print(f"   从 {f} 读取 {len(rows)} 条题目")
                return rows
    print(f"   ⚠️ 未找到 {stem} 数据集（apps/api/datasets/ 或 datasets/），跳过该任务")
    return []


def _ensure_users(db) -> dict:
    result = {}
    for spec in _DEMO_USERS:
        user = db.query(User).filter_by(email=spec["email"]).first()
        if user is None:
            user = User(
                id=spec["id"], email=spec["email"],
                hashed_password=_pwd.hash(_PASSWORD),
                display_name=spec["display_name"], role=spec["role"], status="ACTIVE",
            )
            db.add(user)
        result[spec["role"]] = spec["id"]
    db.commit()
    return result


def _seed_task(db, owner_id: str, spec: dict) -> dict:
    """建单个任务（DRAFT→发布 schema→ReviewConfig→导入题目→PUBLISHED）。返回统计。"""
    title = spec["title"]
    print(f"\n── 任务：{title} ──")

    # 幂等：按标题查找，存在则跳过
    if db.query(Task).filter_by(title=title).first() is not None:
        print(f"   ⏭️  已存在同名任务，跳过")
        return {"title": title, "skipped": True}

    rows = _load_dataset(spec["stem"])
    if not rows:
        return {"title": title, "skipped": True}

    ids = spec["ids"]
    schema = spec["schema"]
    node_count = _count_nodes(schema)

    # 1. 任务（DRAFT）
    task = Task(
        id=ids["task"], title=title, description=spec["description"],
        tags_json=spec["tags"],
        quota_json={"total": 50, "perLabeler": 10},
        distribution_strategy_json={"type": "FIRST_COME_FIRST_SERVED"},
        review_policy_json={"type": "SINGLE_REVIEW"},
        status="DRAFT", owner_id=owner_id,
    )
    db.add(task)
    db.flush()
    print(f"   ✅ 任务已建（DRAFT）：{ids['task']}")

    # 2. Schema 草稿 + 发布为 v1
    db.add(SchemaDraft(
        id=ids["draft"], task_id=ids["task"], schema_json=schema,
        schema_draft_revision=1, updated_by=owner_id,
    ))
    db.flush()
    db.add(SchemaVersion(
        id=ids["sv"], task_id=ids["task"], schema_id=ids["draft"], schema_version_no=1,
        contract_version="1.1", schema_json=schema,
        published_at=datetime.now(timezone.utc),
    ))
    db.flush()
    print(f"   ✅ Schema 已发布 v1：{ids['sv']}（{node_count} 个节点）")

    # 3. ReviewConfig
    db.add(ReviewConfig(
        id=ids["rc"], task_id=ids["task"], enabled=True,
        model_policy_id="mp_doubao_pro",
        prompt_template=spec["review_prompt"],
        dimensions_json=spec["dimensions"],
        thresholds_json=_REVIEW_THRESHOLDS,
        conclusion_mapping_json=_REVIEW_CONCLUSION_MAPPING,
        max_retries=3,
    ))
    print(f"   ✅ ReviewConfig 已建：{ids['rc']}（{len(spec['dimensions'])} 维度）")

    # 4. 导入题目（整行 JSON 落为 source_payload）
    for i, payload in enumerate(rows):
        ext = str(payload.get("id") or f"{spec['stem']}-{i+1:03d}")
        db.add(DatasetItem(
            id=f"{spec['item_prefix']}_{i+1:03d}", task_id=ids["task"],
            external_key=ext, source_payload=payload, status="AVAILABLE",
        ))
    print(f"   ✅ 导入题目：{len(rows)} 条")

    # 5. 发布任务
    task.status = "PUBLISHED"
    task.active_schema_version_id = ids["sv"]
    db.commit()
    print(f"   ✅ 任务已发布（PUBLISHED），配额 50")

    return {"title": title, "skipped": False, "node_count": node_count, "item_count": len(rows)}


def main() -> None:
    db = SessionLocal()
    try:
        print("=" * 60)
        print("LabelHub 比赛真实数据 Seeder（seed_competition）")
        print("=" * 60)

        owners = _ensure_users(db)
        print(f"\n✅ 演示账号就绪（密码均为 {_PASSWORD}）：")
        for spec in _DEMO_USERS:
            print(f"   [{spec['role']:<8}] {spec['email']}")

        results = [_seed_task(db, owners["OWNER"], spec) for spec in _TASKS]

        print("\n" + "=" * 60)
        print("汇总")
        print("=" * 60)
        for r in results:
            if r.get("skipped"):
                print(f"  ⏭️  {r['title']}：跳过（已存在或无数据）")
            else:
                print(f"  ✅ {r['title']}：schema 节点 {r['node_count']} 个，导入 {r['item_count']} 条")
        print("\n完成。可用 *@labelhub.com / password123 登录前端走完整流程。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
