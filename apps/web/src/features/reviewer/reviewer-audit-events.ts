import type {
  AuditActor,
  AuditTarget,
  ReviewDecisionForAudit,
  ReviewDecisionResponse,
  ReviewDetailResponse,
  ReviewDiffGeneratedAuditPayload,
  ReviewPatch,
} from "@labelhub/contracts";
import { appendAuditEvent } from "../../api/audit";
import { hashCanonicalJson } from "../../mocks/hash-utils";

type ReviewerDecision = "PASS" | "RETURN";
export type AiReviewFeedback = "HELPFUL" | "NOT_HELPFUL" | "NOT_USED";

function currentReviewerId(): string {
  try {
    const value = localStorage.getItem("labelhub_actor");
    const actor = value ? JSON.parse(value) as { id?: string } : null;
    return actor?.id ?? "reviewer";
  } catch {
    return "reviewer";
  }
}

export function appendReviewStartedAuditSafely(detail: ReviewDetailResponse): void {
  const reviewerId = currentReviewerId();
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
  patchCount?: number;
}): void {
  const reviewerId = currentReviewerId();
  const reviewId = input.response.reviewResult.id;
  const submittedDecision = mapReviewDecisionForAudit(input.decision);
  const reasonCode = input.decision === "PASS" ? "APPROVED" : "RETURNED_TO_LABELER";
  const patchCount = input.patchCount ?? 0;
  const payload = {
    summary: "审核决策已提交",
    detailRef: reviewId,
    codes: [reasonCode],
    counters: {
      patchCount,
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
    patchCount,
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

export function appendAiReviewFeedbackAuditSafely(input: {
  detail: ReviewDetailResponse;
  response: ReviewDecisionResponse;
  feedback: AiReviewFeedback;
  aiConfidence?: number;
  aiDimensionCount: number;
}): void {
  if (input.feedback === "NOT_USED") {
    return;
  }

  const reviewerId = currentReviewerId();
  const reviewId = input.response.reviewResult.id;
  const submissionId = input.detail.submission.id;
  const payload = {
    summary: input.feedback === "HELPFUL" ? "审核员确认 AI 预审有帮助" : "审核员反馈 AI 预审没有帮助",
    detailRef: reviewId,
    codes: [input.feedback],
    counters: {
      aiDimensionCount: input.aiDimensionCount,
    },
    taskId: input.detail.task.id,
    submissionId,
    reviewId,
    reviewerId,
    labelerId: input.detail.submission.labelerId,
    schemaVersionId: input.detail.schemaVersionId,
    feedback: input.feedback,
    stage: "REVIEW_SUBMITTED",
    aiDimensionCount: input.aiDimensionCount,
    ...(input.aiConfidence !== undefined ? { aiConfidence: input.aiConfidence } : {}),
  };

  void appendAuditEvent({
    type: input.feedback === "HELPFUL" ? "AI_REVIEW_CONFIRMED_BY_REVIEWER" : "AI_REVIEW_REJECTED_BY_REVIEWER",
    severity: "INFO",
    source: "WEB",
    actor: createReviewerActor(reviewerId),
    target: createReviewTarget(input.detail, reviewId),
    payload,
    idempotencyKey: `AI_REVIEW:${submissionId}:${reviewId}:${input.feedback}`,
  }).catch((error) => {
    console.warn("写入 AI 预审反馈审计事件失败：", error);
  });
}

export function appendReviewDiffGeneratedAuditSafely(input: {
  detail: ReviewDetailResponse;
  decision: ReviewerDecision;
  response: ReviewDecisionResponse;
  patches: ReviewPatch[];
  reviewDurationMs: number;
  correctedAnswers: Record<string, unknown>;
}): void {
  void (async () => {
    const reviewerId = currentReviewerId();
    const reviewId = input.response.reviewResult.id;
    const submissionId = input.detail.submission.id;
    const patchedFieldNames = input.patches.map((p) => p.fieldName);
    const patchCount = input.patches.length;

    const [beforeAnswerHash, afterAnswerHash, diffSummaryHash] = await Promise.all([
      hashCanonicalJson(input.detail.submission.answers),
      hashCanonicalJson(input.correctedAnswers),
      hashCanonicalJson({ patchedFieldNames, patchCount }),
    ]);

    const payload: ReviewDiffGeneratedAuditPayload = {
      taskId: input.detail.task.id,
      submissionId,
      reviewId,
      reviewerId,
      labelerId: input.detail.submission.labelerId,
      schemaVersionId: input.detail.schemaVersionId,
      decision: mapDecisionForDiffAudit(input.decision),
      patchedFieldNames,
      patchCount,
      diffMode: "FRONTEND_SHALLOW",
      reviewDurationMs: input.reviewDurationMs,
    };
    if (beforeAnswerHash !== undefined) payload.beforeAnswerHash = beforeAnswerHash;
    if (afterAnswerHash !== undefined) payload.afterAnswerHash = afterAnswerHash;
    if (diffSummaryHash !== undefined) payload.diffSummaryHash = diffSummaryHash;

    await appendAuditEvent({
      type: "REVIEW_DIFF_GENERATED",
      severity: "INFO",
      source: "WEB",
      actor: createReviewerActor(reviewerId),
      target: createReviewTarget(input.detail, reviewId),
      payload,
      idempotencyKey: `REVIEW:${submissionId}:REVIEW_DIFF_GENERATED:${reviewId}`,
    });
  })().catch((error) => {
    console.warn("写入 REVIEW_DIFF_GENERATED 审计事件失败：", error);
  });
}

function mapReviewDecisionForAudit(decision: ReviewerDecision): ReviewDecisionForAudit {
  return decision === "PASS" ? "APPROVED" : "REJECTED";
}

function mapDecisionForDiffAudit(decision: ReviewerDecision): ReviewDecisionForAudit {
  return decision === "PASS" ? "APPROVED_WITH_CHANGES" : "REJECTED";
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
