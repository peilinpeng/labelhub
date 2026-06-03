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

type PageList<T> = T[] | { items?: T[]; submissions?: T[] };

function unwrapList<T>(response: PageList<T>): T[] {
  if (Array.isArray(response)) return response;
  return response.items ?? response.submissions ?? [];
}

function unwrapProp<T, K extends string>(response: T | Record<K, T>, key: K): T {
  if (response && typeof response === "object" && key in response) {
    return (response as Record<K, T>)[key];
  }
  return response as T;
}

export async function listReviewQueue(params: { page?: number; pageSize?: number; status?: string } = {}): Promise<ReviewQueueItem[]> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.status) search.set("status", params.status);
  const query = search.toString();
  const res = await apiGet<PageList<ReviewQueueItem>>(`/api/v1/review/queue${query ? `?${query}` : ""}`);
  return unwrapList(res);
}

export async function getReviewDetail(submissionId: string): Promise<ReviewDetailResponse> {
  const res = await apiGet<ReviewDetailResponse | { detail: ReviewDetailResponse }>(
    `/api/v1/review/submissions/${submissionId}`
  );
  return unwrapProp(res, "detail");
}

export async function claimReview(submissionId: string): Promise<Submission> {
  const res = await apiPost<Submission | { submission: Submission }>(`/api/v1/review/submissions/${submissionId}/claim`, {});
  return unwrapProp(res, "submission");
}

export async function decideReview(submissionId: string, request: ReviewDecisionRequest): Promise<ReviewDecisionResponse> {
  return apiPost<ReviewDecisionResponse>(`/api/v1/review/submissions/${submissionId}/decision`, request);
}

export async function batchDecideReview(request: BatchReviewRequest): Promise<BatchReviewResponse> {
  return apiPost<BatchReviewResponse>("/api/v1/review/batch-decision", request);
}
