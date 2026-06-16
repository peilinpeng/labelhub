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
  // 该提交的终态是否由人工（复审/终审）作出；false 表示 AI 自动流转或尚未人工介入。
  humanDecided?: boolean;
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

/**
 * 统计某一队列状态的条数（用于 Reviewer 页面左侧 Tab 数字）。
 * 必须独立于当前选中的 Tab：后端 /review/queue 会按 status 服务端精确过滤，
 * 若复用当前 Tab 的列表客户端聚合，非当前 Tab 的计数会恒为 0（点击后才变正确）。
 * 真实后端返回 { items, total }，直接取 total（不受分页 pageSize 限制）；
 * mock 返回裸数组且忽略 status 参数，回退为按 status 客户端过滤后计数。
 */
export async function fetchReviewQueueCount(status: string): Promise<number> {
  const search = new URLSearchParams();
  search.set("pageSize", "100");
  search.set("status", status);
  const res = await apiGet<unknown>(`/api/v1/review/queue?${search.toString()}`);
  if (res != null && typeof res === "object" && !Array.isArray(res) && typeof (res as { total?: unknown }).total === "number") {
    return (res as { total: number }).total;
  }
  return unwrapList(res as PageList<ReviewQueueItem>).filter((item) => item?.submission?.status === status).length;
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
    // 审核流转策略，决定 AI 决策是否允许自动通过/打回（后端 worker 据此门控）。
    mode?: "AI_THEN_HUMAN" | "AUTO_PASS_RETURN" | "HUMAN_REVIEW_ONLY";
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
