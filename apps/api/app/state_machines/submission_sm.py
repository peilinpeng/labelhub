from app.middleware.error_handler import InvalidStateTransitionException

_ALLOWED: dict[tuple[str, str], str] = {
    ("SUBMITTED",          "enqueueAIReview"):       "AI_REVIEWING",
    ("AI_REVIEWING",       "aiReviewPass"):           "AI_PASSED",
    # AUTO_PASS_RETURN 策略下高分直接自动通过到终态，无需人工确认（见 ai_review_worker）。
    ("AI_REVIEWING",       "aiReviewAutoAccept"):     "ACCEPTED",
    ("AI_REVIEWING",       "aiReviewReturn"):         "RETURNED",
    ("AI_REVIEWING",       "aiReviewNeedHuman"):      "NEEDS_HUMAN_REVIEW",
    ("AI_REVIEWING",       "aiReviewFailedToHuman"):  "NEEDS_HUMAN_REVIEW",
    ("AI_PASSED",          "claimReview"):            "HUMAN_REVIEWING",
    ("NEEDS_HUMAN_REVIEW", "claimReview"):            "HUMAN_REVIEWING",
    ("HUMAN_REVIEWING",    "humanReviewPassSingle"):  "ACCEPTED",
    ("HUMAN_REVIEWING",    "humanReviewPassDouble"):  "FINAL_REVIEWING",
    ("HUMAN_REVIEWING",    "humanReviewReturn"):      "RETURNED",
    ("HUMAN_REVIEWING",    "humanReviewReject"):      "REJECTED",
    ("FINAL_REVIEWING",    "finalReviewPass"):        "ACCEPTED",
    ("FINAL_REVIEWING",    "finalReviewReturn"):      "RETURNED",
    ("FINAL_REVIEWING",    "finalReviewReject"):      "REJECTED",
}


def apply_transition(current_status: str, command: str) -> str:
    new_status = _ALLOWED.get((current_status, command))
    if new_status is None:
        raise InvalidStateTransitionException(
            f"Submission 当前状态 {current_status!r} 不支持 {command!r} 命令"
        )
    return new_status


def get_allowed_commands(current_status: str) -> list[str]:
    return [cmd for (st, cmd) in _ALLOWED if st == current_status]
