from app.middleware.error_handler import InvalidStateTransitionException

_ALLOWED: dict[tuple[str, str], str] = {
    ("CLAIMED",   "saveDraft"):          "DRAFTING",
    ("DRAFTING",  "saveDraft"):          "DRAFTING",
    ("RETURNED",  "saveDraft"):          "DRAFTING",
    ("CLAIMED",   "submitAssignment"):   "SUBMITTED",
    ("DRAFTING",  "submitAssignment"):   "SUBMITTED",
    ("RETURNED",  "submitAssignment"):   "SUBMITTED",
    ("CLAIMED",   "expireAssignment"):   "EXPIRED",
    ("DRAFTING",  "expireAssignment"):   "EXPIRED",
    ("SUBMITTED", "aiReviewReturn"):     "RETURNED",
    ("SUBMITTED", "aiReviewAutoAccept"): "ACCEPTED",
    ("SUBMITTED", "humanReviewReturn"):  "RETURNED",
    ("SUBMITTED", "humanReviewPass"):    "ACCEPTED",
    ("SUBMITTED", "humanReviewReject"):  "CANCELED",
    ("SUBMITTED", "finalReviewPass"):    "ACCEPTED",
    ("SUBMITTED", "finalReviewReturn"):  "RETURNED",
    ("SUBMITTED", "finalReviewReject"):  "CANCELED",
}


def apply_transition(current_status: str, command: str) -> str:
    new_status = _ALLOWED.get((current_status, command))
    if new_status is None:
        raise InvalidStateTransitionException(
            f"Assignment 当前状态 {current_status!r} 不支持 {command!r} 命令"
        )
    return new_status


def get_allowed_commands(current_status: str) -> list[str]:
    return [cmd for (st, cmd) in _ALLOWED if st == current_status]
