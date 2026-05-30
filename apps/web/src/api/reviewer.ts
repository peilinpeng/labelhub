import type {
  ReviewDetailResponse,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  BatchReviewRequest,
  BatchReviewResponse,
  Submission,
} from "@labelhub/contracts";
import { apiGet, apiPost } from "./client";

/**
 * GET /review/queue 返回的单条队列项。
 * contracts 包尚未定义此类型，故在此本地声明。
 * 对应后端 ReviewQueueItem schema：
 *   { submission: SubmissionSummary, taskId, taskTitle, itemId, aiDecision }
 */
export interface ReviewQueueItem {
  submission: {
    id: string;
    assignmentId: string;
    taskId: string;
    itemId: string;
    labelerId: string;
    schemaVersionId: string;
    attemptNo: number;
    status: Submission["status"];
    createdAt: string;
    updatedAt: string;
  };
  taskId: string;
  taskTitle: string;
  itemId: string;
  aiDecision: string | null;
}

export async function listReviewQueue(): Promise<ReviewQueueItem[]> {
  const res = await apiGet<{ items: ReviewQueueItem[]; total: number; page: number; pageSize: number }>(
    "/api/v1/review/queue"
  );
  return res.items;
}

export async function getReviewDetail(submissionId: string): Promise<ReviewDetailResponse> {
  return apiGet<ReviewDetailResponse>(`/api/v1/review/submissions/${submissionId}`);
}

export async function claimReview(submissionId: string): Promise<Submission> {
  return apiPost<Submission>(`/api/v1/review/submissions/${submissionId}/claim`, {});
}

export async function decideReview(submissionId: string, request: ReviewDecisionRequest): Promise<ReviewDecisionResponse> {
  return apiPost<ReviewDecisionResponse>(`/api/v1/review/submissions/${submissionId}/decision`, request);
}

export async function batchDecideReview(request: BatchReviewRequest): Promise<BatchReviewResponse> {
  return apiPost<BatchReviewResponse>("/api/v1/review/batch-decision", request);
}