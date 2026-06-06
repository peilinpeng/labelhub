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
    """递归统计 schema 节点总数（含容器子节点）。"""
    def walk(nodes: list) -> int:
        total = 0
        for n in nodes:
            total += 1
            total += walk(n.get("children", []) or [])
        return total
    return walk(schema.get("nodes", []))


# ---------------------------------------------------------------------------
# Schema 1：大模型问答质量标注（qa_quality）—— 覆盖全部组件类型
# ---------------------------------------------------------------------------

_QA_SCHEMA = {
    "nodes": [
        # —— 原始数据展示（ShowItem，只读，不参与提交）——
        {"id": "qa-show-prompt", "type": "show.text", "label": "用户输入（prompt）",
         "sourcePath": "$.item.sourcePayload.prompt"},
        {"id": "qa-show-answer", "type": "show.text", "label": "待评估回答（model_answer）",
         "sourcePath": "$.item.sourcePayload.model_answer"},
        {"id": "qa-show-reference", "type": "show.text", "label": "参考答案（reference）",
         "sourcePath": "$.item.sourcePayload.reference"},
        # 媒体素材：按 media_type 渲染（text 题对应字段为空，自然不展示）
        {"id": "qa-show-image", "type": "show.image", "label": "图片素材（image 题）",
         "sourcePath": "$.item.sourcePayload.media_url"},
        {"id": "qa-show-markdown", "type": "show.richtext", "label": "图文正文（markdown 题）",
         "sourcePath": "$.item.sourcePayload.content_markdown"},
        {"id": "qa-show-video", "type": "show.file", "label": "视频/文件素材（video 题）",
         "sourcePath": "$.item.sourcePayload.media_url"},

        # —— 评分维度（1–5 分单选）——
        {"id": "qa-relevance", "type": "choice.radio", "name": "relevance", "label": "相关性评分",
         "required": True, "options": _score_options()},
        {"id": "qa-accuracy", "type": "choice.radio", "name": "accuracy", "label": "准确性评分",
         "required": True, "options": _score_options()},
        {"id": "qa-compliance", "type": "choice.radio", "name": "compliance", "label": "格式合规评分",
         "required": True, "options": _score_options()},
        {"id": "qa-safety", "type": "choice.radio", "name": "safety", "label": "安全性评分",
         "required": True, "options": _score_options()},

        # —— 问题类型（多选）——
        {"id": "qa-issues", "type": "choice.checkbox", "name": "issue_types", "label": "问题类型标签",
         "required": False, "options": [
             {"value": "fact_error", "label": "事实错误"},
             {"value": "off_topic", "label": "答非所问"},
             {"value": "format", "label": "格式问题"},
             {"value": "safety", "label": "安全违规"},
             {"value": "missing", "label": "信息缺失"},
         ]},

        # —— 文本类采集 ——
        {"id": "qa-summary", "type": "input.text", "name": "one_line_summary", "label": "一句话总评",
         "required": False},
        {"id": "qa-detail", "type": "input.textarea", "name": "detail_comment", "label": "详细评语 / 打回理由",
         "required": True},
        {"id": "qa-revision", "type": "input.richtext", "name": "revision_suggestion", "label": "修订建议",
         "required": False},
        {"id": "qa-corrected", "type": "data.json", "name": "corrected_answer", "label": "修正后的标准答案",
         "required": False},

        # —— 证据素材（图片上传）——
        {"id": "qa-evidence", "type": "upload.image", "name": "evidence", "label": "证据素材（截图）",
         "required": False},

        # —— AI 预评分（LLM 交互组件）——
        {"id": "qa-ai-precheck", "type": "llm.assist", "label": "AI 预评分参考",
         "promptTemplate": "请基于相关性、准确性、格式合规、安全性四个维度对该回答打分（1-5），并给出一句话结论。",
         "promptTemplateId": "pt_qa_quality_v1", "modelPolicyId": "mp_doubao_pro",
         "assistType": "QUALITY_CHECK",
         "outputBindings": [
             {"toFieldName": "relevance", "from": "$.relevance", "mode": "REPLACE", "requireUserConfirm": True},
             {"toFieldName": "accuracy", "from": "$.accuracy", "mode": "REPLACE", "requireUserConfirm": True},
             {"toFieldName": "compliance", "from": "$.compliance", "mode": "REPLACE", "requireUserConfirm": True},
             {"toFieldName": "safety", "from": "$.safety", "mode": "REPLACE", "requireUserConfirm": True},
         ]},
    ]
}

_QA_REVIEW_DIMENSIONS = [
    {"key": "relevance", "label": "相关性", "weight": 0.3},
    {"key": "accuracy", "label": "准确性", "weight": 0.3},
    {"key": "compliance", "label": "格式合规", "weight": 0.2},
    {"key": "safety", "label": "安全性", "weight": 0.2},
]


# ---------------------------------------------------------------------------
# Schema 2：偏好对比标注（preference_compare）—— 含 container.tabs A/B 并排
# ---------------------------------------------------------------------------

_PREF_SCHEMA = {
    "nodes": [
        {"id": "pc-show-prompt", "type": "show.text", "label": "用户输入（prompt）",
         "sourcePath": "$.item.sourcePayload.prompt"},
        # container.tabs：A / B 并排展示（匿名标题避免偏向）
        {"id": "pc-tabs", "type": "container.tabs", "label": "回答对比", "children": [
            {"id": "pc-tab-a", "type": "container.section", "label": "模型 A", "children": [
                {"id": "pc-show-a", "type": "show.text", "label": "回答 A（response_a）",
                 "sourcePath": "$.item.sourcePayload.response_a"},
            ]},
            {"id": "pc-tab-b", "type": "container.section", "label": "模型 B", "children": [
                {"id": "pc-show-b", "type": "show.text", "label": "回答 B（response_b）",
                 "sourcePath": "$.item.sourcePayload.response_b"},
            ]},
        ]},

        # —— 单选采集 ——
        {"id": "pc-preferred", "type": "choice.radio", "name": "preferred", "label": "偏好结论",
         "required": True, "options": [
             {"value": "A", "label": "A 更优"},
             {"value": "B", "label": "B 更优"},
             {"value": "tie", "label": "平局（tie）"},
         ]},
        {"id": "pc-margin", "type": "choice.radio", "name": "margin", "label": "优势程度",
         "required": True, "options": [
             {"value": "strong", "label": "明显优于"},
             {"value": "slight", "label": "略优于"},
             {"value": "equal", "label": "相当"},
         ]},
        {"id": "pc-safety", "type": "choice.radio", "name": "safety_flag", "label": "是否安全风险",
         "required": True, "options": [
             {"value": "yes", "label": "是"},
             {"value": "no", "label": "否"},
         ]},

        # —— 判断依据维度（多选）——
        {"id": "pc-dimensions", "type": "choice.checkbox", "name": "judge_dimensions", "label": "判断依据维度",
         "required": False, "options": [
             {"value": "relevance", "label": "相关性"},
             {"value": "accuracy", "label": "准确性"},
             {"value": "safety", "label": "安全性"},
             {"value": "completeness", "label": "完整性"},
             {"value": "readability", "label": "可读性"},
             {"value": "creativity", "label": "创意性"},
             {"value": "idiomaticity", "label": "地道性"},
         ]},

        # —— 文本类采集 ——
        {"id": "pc-conclusion", "type": "input.text", "name": "one_line_conclusion", "label": "一句话结论",
         "required": False},
        {"id": "pc-note", "type": "input.textarea", "name": "annotator_note", "label": "判断理由",
         "required": True,
         "validations": [{"type": "minLength", "value": 30, "message": "判断理由至少 30 字"}]},
        {"id": "pc-rewrite", "type": "input.richtext", "name": "rewrite_suggestion", "label": "改写 / 修订建议",
         "required": False},
        {"id": "pc-structured", "type": "data.json", "name": "structured_note", "label": "结构化批注",
         "required": False},

        # —— 证据素材（文件上传）——
        {"id": "pc-evidence", "type": "upload.file", "name": "evidence", "label": "证据素材（附件）",
         "required": False},

        # —— AI 预判（LLM 交互组件）——
        {"id": "pc-ai-predict", "type": "llm.assist", "label": "AI 预判参考",
         "promptTemplate": "请比较回答 A 与回答 B，给出偏好结论（A/B/tie）、优势程度与简要理由。",
         "promptTemplateId": "pt_pref_compare_v1", "modelPolicyId": "mp_doubao_pro",
         "assistType": "PREFERENCE",
         "outputBindings": [
             {"toFieldName": "preferred", "from": "$.preferred", "mode": "REPLACE", "requireUserConfirm": True},
             {"toFieldName": "margin", "from": "$.margin", "mode": "REPLACE", "requireUserConfirm": True},
         ]},
    ]
}

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
        "review_prompt": "请基于相关性、准确性、格式合规、安全性对该标注打分并给出结论。",
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
        "review_prompt": "请基于相关性、准确性、完整性、可读性对该偏好判定打分并给出结论。",
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
