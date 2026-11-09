"""补齐三份历史演示审核配置的百分制范围；默认仅预览，不运行 seed。"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.ai_quality import validate_config

# 依据：seed_demo 的审核规范，以及竞赛旧 Prompt 的“每维 0-100”。
# 这是预审维度范围，不是问答标注表单的 1-5 分。
EXPECTED_KEYS = {
    "task_demo_news_quality": {"relevance", "accuracy", "compliance"},
    "task_demo_pref_compare": {"relevance", "accuracy", "completeness", "readability"},
    "task_demo_qa_quality": {"relevance", "accuracy", "compliance", "safety"},
}


def repaired_dimensions(task_id, dimensions, thresholds):
    if task_id not in EXPECTED_KEYS or not isinstance(dimensions, list):
        raise ValueError("不是允许修复的演示任务")
    if any(not isinstance(d, dict) for d in dimensions) or {d.get("key") for d in dimensions} != EXPECTED_KEYS[task_id]:
        raise ValueError("演示维度已变化，请人工核对规范")
    result = deepcopy(dimensions)
    for dimension in result:
        if dimension.get("scoreRange") is None:
            dimension["scoreRange"] = [0, 100]
    # 已有范围不覆盖；其他配置非法时整批停止，不猜测或修复权重。
    validate_config(result, thresholds)
    return result


def repair(db, apply=False):
    from app.models.review import ReviewConfig
    from app.utils.hashing import hash_canonical_json
    rows = db.query(ReviewConfig).filter(ReviewConfig.task_id.in_(EXPECTED_KEYS)).order_by(ReviewConfig.task_id).with_for_update().all()
    if {row.task_id for row in rows} != set(EXPECTED_KEYS):
        raise ValueError("三份演示配置不完整，拒绝部分修复")
    plans = [(row, repaired_dimensions(row.task_id, row.dimensions_json, row.thresholds_json)) for row in rows]
    report = []
    for row, dimensions in plans:
        changed = dimensions != row.dimensions_json
        report.append({"taskId": row.task_id, "changed": changed,
                       "beforeHash": hash_canonical_json(row.dimensions_json), "afterHash": hash_canonical_json(dimensions),
                       "addedRanges": [{"key": d["key"], "scoreRange": d["scoreRange"]} for old, d in zip(row.dimensions_json, dimensions) if old != d]})
        if apply and changed:
            row.dimensions_json = dimensions
    if apply:
        db.commit()
    else:
        db.rollback()
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="在同一事务中补齐缺失范围；请先完成备份与预览")
    args = parser.parse_args()
    from app.database import SessionLocal
    with SessionLocal() as session:
        print(json.dumps({"applied": args.apply, "changes": repair(session, args.apply)}, ensure_ascii=False, indent=2))
