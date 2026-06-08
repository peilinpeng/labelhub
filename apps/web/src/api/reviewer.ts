import type {
  ReviewDetailResponse,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  BatchReviewRequest,
  BatchReviewResponse,
  Submission,
} from "@labelhub/contracts";
import { apiGet, apiPost, apiPut } from "./client";

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
  return isRecord(res) && "detail" in res ? (res as { detail: ReviewDetailResponse }).detail : res;
}

export async function claimReview(submissionId: string): Promise<Submission> {
  const res = await apiPost<Submission | { submission: Submission }>(`/api/v1/review/submissions/${submissionId}/claim`, {});
  return isRecord(res) && "submission" in res ? (res as { submission: Submission }).submission : res;
}

export async function decideReview(submissionId: string, request: ReviewDecisionRequest): Promise<ReviewDecisionResponse> {
  return apiPost<ReviewDecisionResponse>(`/api/v1/review/submissions/${submissionId}/decision`, request);
}

export async function batchDecideReview(request: BatchReviewRequest): Promise<BatchReviewResponse> {
  return apiPost<BatchReviewResponse>("/api/v1/review/batch-decision", request);
}

export interface ReviewConfigPayload {
  enabled: boolean;
  modelPolicyId: string;
  promptTemplate: string;
  dimensions: Array<{
    key: string;
    label: string;
    description: string;
    weight: number;
    scoreRange: [number, number];
  }>;
  thresholds: {
    passScore: number;
    returnScore: number;
  };
  conclusionMapping: {
    passWhen: string;
    returnWhen: string;
    humanReviewOtherwise: boolean;
  };
  maxRetries: number;
}

export interface ReviewConfigRecord extends ReviewConfigPayload {
  id: string;
  taskId: string;
  createdAt?: string;
  updatedAt?: string;
}

type ReviewConfigEnvelope = { reviewConfig: ReviewConfigRecord };

export async function getReviewConfig(taskId: string): Promise<ReviewConfigRecord> {
  const res = await apiGet<ReviewConfigEnvelope>(`/api/v1/tasks/${taskId}/review-config`);
  return res.reviewConfig;
}

export async function createReviewConfig(taskId: string, payload: ReviewConfigPayload): Promise<ReviewConfigRecord> {
  const res = await apiPost<ReviewConfigEnvelope>(`/api/v1/tasks/${taskId}/review-config`, payload);
  return res.reviewConfig;
}

export async function updateReviewConfig(taskId: string, payload: Partial<ReviewConfigPayload>): Promise<ReviewConfigRecord> {
  const res = await apiPut<ReviewConfigEnvelope>(`/api/v1/tasks/${taskId}/review-config`, payload);
  return res.reviewConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
