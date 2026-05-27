import type {
  HumanReviewDecision,
  ReviewDecision,
  ReviewPolicy,
  ReviewWorkflowCommand,
  Submission,
  SubmissionStatus,
} from "@labelhub/contracts";

import { auditForReviewCommand } from "./audit-mapping.ts";
import { failTransition, invalidState, reasonRequired } from "./errors.ts";
import { hasReason } from "./transition-guards.ts";
import type { TransitionResult } from "./types.ts";

export function isHumanReviewDecision(decision: ReviewDecision): decision is HumanReviewDecision {
  return decision === "PASS" || decision === "RETURN" || decision === "REJECT";
}

export function decideHumanReview(input: {
  submission: Submission;
  decision: ReviewDecision;
  reviewPolicy: ReviewPolicy;
  reason?: string;
}): TransitionResult<ReviewWorkflowCommand, Submission, SubmissionStatus> {
  if (!isHumanReviewDecision(input.decision)) {
    return failTransition(
      "humanReviewPass",
      input.submission.status,
      "INVALID_STATE_TRANSITION",
      "人工审核不能提交 NEED_HUMAN_REVIEW",
    );
  }

  if (input.decision === "PASS") {
    return humanReviewPass(input.submission, input.reviewPolicy);
  }

  if (input.decision === "RETURN") {
    return humanReviewReturn(input.submission, input.reason);
  }

  return humanReviewReject(input.submission, input.reason);
}

export function claimHumanReview(
  submission: Submission,
): TransitionResult<"claimReview", Submission, SubmissionStatus> {
  const command = "claimReview";
  if (submission.status !== "AI_PASSED" && submission.status !== "NEEDS_HUMAN_REVIEW") {
    return invalidState(command, submission.status, "claimReview 只能从 AI_PASSED 或 NEEDS_HUMAN_REVIEW 进入 HUMAN_REVIEWING");
  }

  return {
    ok: true,
    entity: { ...submission, status: "HUMAN_REVIEWING" },
    command,
    previousStatus: submission.status,
    nextStatus: "HUMAN_REVIEWING",
    auditAction: auditForReviewCommand(command),
    sideEffects: [],
  };
}

export function claimFinalReview(
  submission: Submission,
): TransitionResult<"claimReview", Submission, SubmissionStatus> {
  const command = "claimReview";
  if (submission.status !== "FINAL_REVIEWING") {
    return invalidState(command, submission.status, "终审领取只能处理 FINAL_REVIEWING submission");
  }

  return {
    ok: true,
    entity: submission,
    command,
    previousStatus: submission.status,
    nextStatus: "FINAL_REVIEWING",
    auditAction: auditForReviewCommand(command),
    sideEffects: [],
  };
}

export function humanReviewPass(
  submission: Submission,
  reviewPolicy: ReviewPolicy,
): TransitionResult<"humanReviewPass", Submission, SubmissionStatus> {
  const command = "humanReviewPass";
  if (submission.status !== "HUMAN_REVIEWING") {
    return invalidState(command, submission.status, "humanReviewPass 只能处理 HUMAN_REVIEWING submission");
  }

  if (reviewPolicy.type === "DOUBLE_REVIEW") {
    return {
      ok: true,
      entity: { ...submission, status: "FINAL_REVIEWING" },
      command,
      previousStatus: submission.status,
      nextStatus: "FINAL_REVIEWING",
      auditAction: auditForReviewCommand(command, reviewPolicy),
      sideEffects: [{ type: "CREATE_REVIEW_RESULT", stage: "HUMAN_REVIEW", decision: "PASS" }],
    };
  }

  return {
    ok: true,
    entity: { ...submission, status: "ACCEPTED" },
    command,
    previousStatus: submission.status,
    nextStatus: "ACCEPTED",
    auditAction: auditForReviewCommand(command, reviewPolicy),
    sideEffects: [
      { type: "CREATE_REVIEW_RESULT", stage: "HUMAN_REVIEW", decision: "PASS" },
      { type: "UPDATE_ASSIGNMENT_STATUS", status: "ACCEPTED" },
      { type: "UPDATE_DATASET_ITEM_STATUS", status: "COMPLETED" },
    ],
  };
}

export function humanReviewReturn(
  submission: Submission,
  reason?: string,
): TransitionResult<"humanReviewReturn", Submission, SubmissionStatus> {
  const command = "humanReviewReturn";
  if (submission.status !== "HUMAN_REVIEWING") {
    return invalidState(command, submission.status, "humanReviewReturn 只能处理 HUMAN_REVIEWING submission");
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
    auditAction: auditForReviewCommand(command),
    sideEffects: [
      { type: "CREATE_REVIEW_RESULT", stage: "HUMAN_REVIEW", decision: "RETURN" },
      { type: "UPDATE_ASSIGNMENT_STATUS", status: "RETURNED" },
      { type: "UPDATE_DATASET_ITEM_STATUS", status: "LOCKED" },
    ],
  };
}

export function humanReviewReject(
  submission: Submission,
  reason?: string,
): TransitionResult<"humanReviewReject", Submission, SubmissionStatus> {
  const command = "humanReviewReject";
  if (submission.status !== "HUMAN_REVIEWING") {
    return invalidState(command, submission.status, "humanReviewReject 只能处理 HUMAN_REVIEWING submission");
  }

  if (!hasReason(reason)) {
    return reasonRequired(command, submission.status);
  }

  return {
    ok: true,
    entity: { ...submission, status: "REJECTED" },
    command,
    previousStatus: submission.status,
    nextStatus: "REJECTED",
    auditAction: auditForReviewCommand(command),
    sideEffects: [
      { type: "CREATE_REVIEW_RESULT", stage: "HUMAN_REVIEW", decision: "REJECT" },
      { type: "UPDATE_ASSIGNMENT_STATUS", status: "CANCELED" },
      { type: "UPDATE_DATASET_ITEM_STATUS", status: "AVAILABLE" },
    ],
  };
}

export function finalReviewPass(
  submission: Submission,
): TransitionResult<"finalReviewPass", Submission, SubmissionStatus> {
  const command = "finalReviewPass";
  if (submission.status !== "FINAL_REVIEWING") {
    return invalidState(command, submission.status, "finalReviewPass 只能处理 FINAL_REVIEWING submission");
  }

  return {
    ok: true,
    entity: { ...submission, status: "ACCEPTED" },
    command,
    previousStatus: submission.status,
    nextStatus: "ACCEPTED",
    auditAction: auditForReviewCommand(command),
    sideEffects: [
      { type: "CREATE_REVIEW_RESULT", stage: "FINAL_REVIEW", decision: "PASS" },
      { type: "UPDATE_ASSIGNMENT_STATUS", status: "ACCEPTED" },
      { type: "UPDATE_DATASET_ITEM_STATUS", status: "COMPLETED" },
    ],
  };
}

export function finalReviewReturn(
  submission: Submission,
  reason?: string,
): TransitionResult<"finalReviewReturn", Submission, SubmissionStatus> {
  const command = "finalReviewReturn";
  if (submission.status !== "FINAL_REVIEWING") {
    return invalidState(command, submission.status, "finalReviewReturn 只能处理 FINAL_REVIEWING submission");
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
    auditAction: auditForReviewCommand(command),
    sideEffects: [
      { type: "CREATE_REVIEW_RESULT", stage: "FINAL_REVIEW", decision: "RETURN" },
      { type: "UPDATE_ASSIGNMENT_STATUS", status: "RETURNED" },
      { type: "UPDATE_DATASET_ITEM_STATUS", status: "LOCKED" },
    ],
  };
}

export function finalReviewReject(
  submission: Submission,
  reason?: string,
): TransitionResult<"finalReviewReject", Submission, SubmissionStatus> {
  const command = "finalReviewReject";
  if (submission.status !== "FINAL_REVIEWING") {
    return invalidState(command, submission.status, "finalReviewReject 只能处理 FINAL_REVIEWING submission");
  }

  if (!hasReason(reason)) {
    return reasonRequired(command, submission.status);
  }

  return {
    ok: true,
    entity: { ...submission, status: "REJECTED" },
    command,
    previousStatus: submission.status,
    nextStatus: "REJECTED",
    auditAction: auditForReviewCommand(command),
    sideEffects: [
      { type: "CREATE_REVIEW_RESULT", stage: "FINAL_REVIEW", decision: "REJECT" },
      { type: "UPDATE_ASSIGNMENT_STATUS", status: "CANCELED" },
      { type: "UPDATE_DATASET_ITEM_STATUS", status: "AVAILABLE" },
    ],
  };
}
