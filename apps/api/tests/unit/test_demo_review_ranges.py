from copy import deepcopy
import pytest
from scripts.repair_demo_review_ranges import EXPECTED_KEYS, repaired_dimensions


@pytest.mark.parametrize("task_id", EXPECTED_KEYS)
def test_only_missing_ranges_are_added_and_repair_is_idempotent(task_id):
    keys = sorted(EXPECTED_KEYS[task_id])
    dimensions = [{"key": k, "label": k, "weight": 1 / len(keys)} for k in keys]
    original = deepcopy(dimensions)
    result = repaired_dimensions(task_id, dimensions, {"autoPass": .85, "autoReturn": .5})
    assert result == [{**d, "scoreRange": [0, 100]} for d in original]
    assert dimensions == original
    assert repaired_dimensions(task_id, result, {"autoPass": .85, "autoReturn": .5}) == result
    result[0]["scoreRange"] = [1, 5]
    assert repaired_dimensions(task_id, result, {"autoPass": .85, "autoReturn": .5})[0]["scoreRange"] == [1, 5]


def test_changed_dimensions_and_invalid_config_are_rejected():
    with pytest.raises(ValueError):
        repaired_dimensions("task_demo_news_quality", [{"key": "custom"}], {})
    dimensions = [{"key": k, "weight": 1} for k in EXPECTED_KEYS["task_demo_news_quality"]]
    with pytest.raises(ValueError):
        repaired_dimensions("task_demo_news_quality", dimensions, {"autoPass": .85, "autoReturn": .5})
