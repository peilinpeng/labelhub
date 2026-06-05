"""单元测试：4 个状态机的 apply_transition（TC-QA-02，纯函数，无 DB）。"""
import pytest

from app.middleware.error_handler import InvalidStateTransitionException
from app.state_machines import task_sm, submission_sm, assignment_sm, export_sm


# ---------------------------------------------------------------------------
# Task 状态机
# ---------------------------------------------------------------------------
class TestTaskStateMachine:
    @pytest.mark.parametrize("current,command,expected", [
        ("DRAFT", "publishTask", "PUBLISHED"),
        ("PUBLISHED", "pauseTask", "PAUSED"),
        ("PAUSED", "resumeTask", "PUBLISHED"),
        ("PUBLISHED", "endTask", "ENDED"),
        ("PAUSED", "endTask", "ENDED"),
        ("ENDED", "archiveTask", "ARCHIVED"),
    ])
    def test_valid_transitions(self, current, command, expected):
        assert task_sm.apply_transition(current, command) == expected

    @pytest.mark.parametrize("current,command", [
        ("DRAFT", "pauseTask"),          # 草稿不能暂停
        ("PUBLISHED", "resumeTask"),     # 已发布不能恢复
        ("DRAFT", "archiveTask"),        # 不能从草稿直接归档
        ("ARCHIVED", "publishTask"),     # 终态不可迁移
        ("ENDED", "resumeTask"),
    ])
    def test_invalid_transitions_raise(self, current, command):
        with pytest.raises(InvalidStateTransitionException):
            task_sm.apply_transition(current, command)

    def test_allowed_commands(self):
        assert set(task_sm.get_allowed_commands("PUBLISHED")) == {"pauseTask", "endTask"}
        assert task_sm.get_allowed_commands("ARCHIVED") == []


# ---------------------------------------------------------------------------
# Submission 状态机
# ---------------------------------------------------------------------------
class TestSubmissionStateMachine:
    @pytest.mark.parametrize("current,command,expected", [
        ("SUBMITTED", "enqueueAIReview", "AI_REVIEWING"),
        ("AI_REVIEWING", "aiReviewPass", "AI_PASSED"),
        ("AI_REVIEWING", "aiReviewReturn", "RETURNED"),
        ("AI_REVIEWING", "aiReviewNeedHuman", "NEEDS_HUMAN_REVIEW"),
        ("AI_REVIEWING", "aiReviewFailedToHuman", "NEEDS_HUMAN_REVIEW"),
        ("AI_PASSED", "claimReview", "HUMAN_REVIEWING"),
        ("NEEDS_HUMAN_REVIEW", "claimReview", "HUMAN_REVIEWING"),
        ("HUMAN_REVIEWING", "humanReviewPassSingle", "ACCEPTED"),
        ("HUMAN_REVIEWING", "humanReviewPassDouble", "FINAL_REVIEWING"),
        ("HUMAN_REVIEWING", "humanReviewReturn", "RETURNED"),
        ("HUMAN_REVIEWING", "humanReviewReject", "REJECTED"),
        ("FINAL_REVIEWING", "finalReviewPass", "ACCEPTED"),
        ("FINAL_REVIEWING", "finalReviewReturn", "RETURNED"),
        ("FINAL_REVIEWING", "finalReviewReject", "REJECTED"),
    ])
    def test_valid_transitions(self, current, command, expected):
        assert submission_sm.apply_transition(current, command) == expected

    @pytest.mark.parametrize("current,command", [
        ("SUBMITTED", "claimReview"),        # 未经 AI 预审不能直接领取
        ("ACCEPTED", "claimReview"),         # 终态
        ("REJECTED", "humanReviewPassSingle"),
        ("AI_PASSED", "aiReviewPass"),       # 重复命令
    ])
    def test_invalid_transitions_raise(self, current, command):
        with pytest.raises(InvalidStateTransitionException):
            submission_sm.apply_transition(current, command)


# ---------------------------------------------------------------------------
# Assignment 状态机
# ---------------------------------------------------------------------------
class TestAssignmentStateMachine:
    @pytest.mark.parametrize("current,command,expected", [
        ("CLAIMED", "saveDraft", "DRAFTING"),
        ("DRAFTING", "submitAssignment", "SUBMITTED"),
        ("RETURNED", "submitAssignment", "SUBMITTED"),
        ("SUBMITTED", "humanReviewPass", "ACCEPTED"),
        ("SUBMITTED", "aiReviewReturn", "RETURNED"),
        ("CLAIMED", "expireAssignment", "EXPIRED"),
    ])
    def test_valid_transitions(self, current, command, expected):
        assert assignment_sm.apply_transition(current, command) == expected

    @pytest.mark.parametrize("current,command", [
        ("ACCEPTED", "saveDraft"),
        ("EXPIRED", "submitAssignment"),
        ("CLAIMED", "humanReviewPass"),
    ])
    def test_invalid_transitions_raise(self, current, command):
        with pytest.raises(InvalidStateTransitionException):
            assignment_sm.apply_transition(current, command)


# ---------------------------------------------------------------------------
# Export 状态机
# ---------------------------------------------------------------------------
class TestExportStateMachine:
    @pytest.mark.parametrize("current,command,expected", [
        ("PENDING", "startExportJob", "RUNNING"),
        ("RUNNING", "markExportSucceeded", "SUCCEEDED"),
        ("PENDING", "markExportFailed", "FAILED"),
        ("RUNNING", "markExportFailed", "FAILED"),
        ("PENDING", "cancelExportJob", "CANCELED"),
        ("RUNNING", "cancelExportJob", "CANCELED"),
    ])
    def test_valid_transitions(self, current, command, expected):
        assert export_sm.apply_transition(current, command) == expected

    @pytest.mark.parametrize("current,command", [
        ("SUCCEEDED", "startExportJob"),
        ("PENDING", "markExportSucceeded"),   # 必须先 RUNNING
        ("CANCELED", "startExportJob"),
    ])
    def test_invalid_transitions_raise(self, current, command):
        with pytest.raises(InvalidStateTransitionException):
            export_sm.apply_transition(current, command)
