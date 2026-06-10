from app.middleware.error_handler import InvalidStateTransitionException

_ALLOWED: dict[tuple[str, str], str] = {
    ("PENDING", "startExportJob"): "RUNNING",
    ("RUNNING", "markExportSucceeded"): "SUCCEEDED",
    ("PENDING", "markExportFailed"): "FAILED",
    ("RUNNING", "markExportFailed"): "FAILED",
    ("PENDING", "cancelExportJob"): "CANCELED",
    ("RUNNING", "cancelExportJob"): "CANCELED",
}


def apply_transition(current_status: str, command: str) -> str:
    new_status = _ALLOWED.get((current_status, command))
    if new_status is None:
        raise InvalidStateTransitionException(
            f"ExportJob 当前状态 {current_status!r} 不支持 {command!r} 命令"
        )
    return new_status


def get_allowed_commands(current_status: str) -> list[str]:
    return [cmd for (st, cmd) in _ALLOWED if st == current_status]
