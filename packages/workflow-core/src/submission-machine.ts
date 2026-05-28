import type { Submission, SubmissionStatus } from "@labelhub/contracts";

import { auditForSubmissionCommand } from "./audit-mapping.ts";
import { invalidState, reasonRequired } from "./errors.ts";
import { hasReason } from "./transition-guards.ts";
import type { TransitionResult } from "./types.ts";

export function createFromAssignmentSubmit(
  submission: Submission,
): TransitionResult<"submitAssignment", Submission, SubmissionStatus> {
  const command = "submitAssignment";
  if (submission.status !== "SUBMITTED") {
    return invalidState(command, submission.status, "submission 创建后必须处于 SUBMITTED");
  }

  return {
    ok: true,
    entity: submission,
    command,
    previousStatus: "NONE",
    nextStatus: "SUBMITTED",
    auditAction: "SUBMISSION_CREATED",
    sideEffects: [],
  };
}

export function enqueueAIReview(
  submission: Submission,
): TransitionResult<"enqueueAIReview", Submission, SubmissionStatus> {
  const command = "enqueueAIReview";
  if (submission.status !== "SUBMITTED") {
    return invalidState(command, submission.status, "enqueueAIReview 只能从 SUBMITTED 进入 AI_REVIEWING");
  }

  return {
    ok: true,
    entity: { ...submission, status: "AI_REVIEWING" },
    command,
    previousStatus: submission.status,
    nextStatus: "AI_REVIEWING",
    auditAction: auditForSubmissionCommand(command),
    sideEffects: [{ type: "CREATE_AI_REVIEW_JOB", jobStatus: "PENDING" }],
  };
}

export function aiReviewPass(
  submission: Submission,
): TransitionResult<"aiReviewPass", Submission, SubmissionStatus> {
  const command = "aiReviewPass";
  if (submission.status !== "AI_REVIEWING") {
    return invalidState(command, submission.status, "aiReviewPass 只能从 AI_REVIEWING 进入 AI_PASSED");
  }

  return {
    ok: true,
    entity: { ...submission, status: "AI_PASSED" },
    command,
    previousStatus: submission.status,
    nextStatus: "AI_PASSED",
    auditAction: auditForSubmissionCommand(command),
    sideEffects: [],
  };
}

export function aiReviewReturn(
  submission: Submission,
  reason?: string,
): TransitionResult<"aiReviewReturn", Submission, SubmissionStatus> {
  const command = "aiReviewReturn";
  if (submission.status !== "AI_REVIEWING") {
    return invalidState(command, submission.status, "aiReviewReturn 只能从 AI_REVIEWING 进入 RETURNED");
  }

  if (!hasReason(reason)) {
    return reasonRequired(command, submission.status);
  }

  return {
    ok: true,
    entity: { ...submission, status: "RETURNED" },
    command,
    previousStatus: submission.status,
    nextStatus: "RETURNED",
    auditAction: "REVIEW_RETURNED",
    sideEffects: [
      { type: "UPDATE_ASSIGNMENT_STATUS", status: "RETURNED" },
      { type: "UPDATE_DATASET_ITEM_STATUS", status: "LOCKED" },
    ],
  };
}

export function aiReviewNeedHuman(
  submission: Submission,
): TransitionResult<"aiReviewNeedHuman", Submission, SubmissionStatus> {
  const command = "aiReviewNeedHuman";
  if (submission.status !== "AI_REVIEWING") {
    return invalidState(command, submission.status, "aiReviewNeedHuman 只能从 AI_REVIEWING 进入 NEEDS_HUMAN_REVIEW");
  }

  return {
    ok: true,
    entity: { ...submission, status: "NEEDS_HUMAN_REVIEW" },
    command,
    previousStatus: submission.status,
    nextStatus: "NEEDS_HUMAN_REVIEW",
    auditAction: auditForSubmissionCommand(command),
    sideEffects: [],
  };
}

export function aiReviewFailedToHuman(
  submission: Submission,
): TransitionResult<"aiReviewFailedToHuman", Submission, SubmissionStatus> {
  const command = "aiReviewFailedToHuman";
  if (submission.status !== "AI_REVIEWING") {
    return invalidState(command, submission.status, "aiReviewFailedToHuman 只能从 AI_REVIEWING 进入 NEEDS_HUMAN_REVIEW");
  }

  return {
    ok: true,
    entity: { ...submission, status: "NEEDS_HUMAN_REVIEW" },
    command,
    previousStatus: submission.status,
    nextStatus: "NEEDS_HUMAN_REVIEW",
    auditAction: auditForSubmissionCommand(command),
    sideEffects: [],
  };
}
