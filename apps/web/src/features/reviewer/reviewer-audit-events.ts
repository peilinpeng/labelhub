import type {
  AuditActor,
  AuditTarget,
  ReviewDecisionForAudit,
  ReviewDecisionResponse,
  ReviewDetailResponse,
} from "@labelhub/contracts";
import { appendAuditEvent } from "../../api/audit";

type ReviewerDecision = "PASS" | "RETURN";

const DEMO_REVIEWER_ID = "usr_reviewer_demo";

export function appendReviewStartedAuditSafely(detail: ReviewDetailResponse): void {
  const reviewerId = DEMO_REVIEWER_ID;
  const submissionId = detail.submission.id;
  const payload = {
    summary: "审核详情已打开",
    detailRef: submissionId,
    codes: ["DETAIL_OPENED"],
    taskId: detail.task.id,
    submissionId,
    reviewerId,
    labelerId: detail.submission.labelerId,
    schemaVersionId: detail.schemaVersionId,
    stage: "DETAIL_OPENED",
  };

  void appendAuditEvent({
    type: "REVIEW_STARTED",
    severity: "INFO",
    source: "WEB",
    actor: createReviewerActor(reviewerId),
    target: createSubmissionTarget(detail),
    payload,
    idempotencyKey: `REVIEW:${submissionId}:REVIEW_STARTED:${reviewerId}`,
  }).catch((error) => {
    console.warn("写入审核开始审计事件失败：", error);
  });
}

export function appendReviewSubmittedAuditSafely(input: {
  detail: ReviewDetailResponse;
  decision: ReviewerDecision;
  response: ReviewDecisionResponse;
  reviewDurationMs: number;
  commentLength: number;
}): void {
  const reviewerId = DEMO_REVIEWER_ID;
  const reviewId = input.response.reviewResult.id;
  const submittedDecision = mapReviewDecisionForAudit(input.decision);
  const reasonCode = input.decision === "PASS" ? "APPROVED" : "RETURNED_TO_LABELER";
  const payload = {
    summary: "审核决策已提交",
    detailRef: reviewId,
    codes: [reasonCode],
    counters: {
      patchCount: 0,
      commentLength: input.commentLength,
      reviewDurationMs: input.reviewDurationMs,
    },
    taskId: input.detail.task.id,
    submissionId: input.detail.submission.id,
    reviewId,
    reviewerId,
    labelerId: input.detail.submission.labelerId,
    schemaVersionId: input.detail.schemaVersionId,
    decision: submittedDecision,
    stage: "SUBMITTED",
    reasonCode,
    patchCount: 0,
    reviewDurationMs: input.reviewDurationMs,
    commentLength: input.commentLength,
  };

  void appendAuditEvent({
    type: "REVIEW_SUBMITTED",
    severity: "INFO",
    source: "WEB",
    actor: createReviewerActor(reviewerId),
    target: createReviewTarget(input.detail, reviewId),
    payload,
    idempotencyKey: `REVIEW:${input.detail.submission.id}:REVIEW_SUBMITTED:${input.decision}:${reviewId}`,
  }).catch((error) => {
    console.warn("写入审核提交审计事件失败：", error);
  });
}

function mapReviewDecisionForAudit(decision: ReviewerDecision): ReviewDecisionForAudit {
  return decision === "PASS" ? "APPROVED" : "REJECTED";
}

function createReviewerActor(reviewerId: string): AuditActor {
  return {
    id: reviewerId,
    role: "REVIEWER",
    displayName: "审核员 Demo",
  };
}

function createSubmissionTarget(detail: ReviewDetailResponse): AuditTarget {
  return {
    entityType: "SUBMISSION",
    entityId: detail.submission.id,
    taskId: detail.task.id,
    assignmentId: detail.submission.assignmentId,
    submissionId: detail.submission.id,
    schemaVersionId: detail.schemaVersionId,
  };
}

function createReviewTarget(detail: ReviewDetailResponse, reviewId: string): AuditTarget {
  return {
    entityType: "REVIEW",
    entityId: reviewId,
    taskId: detail.task.id,
    assignmentId: detail.submission.assignmentId,
    submissionId: detail.submission.id,
    reviewId,
    schemaVersionId: detail.schemaVersionId,
  };
}
