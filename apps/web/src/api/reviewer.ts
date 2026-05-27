import type {
  ReviewDetailResponse,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  BatchReviewRequest,
  BatchReviewResponse,
  Submission,
} from "@labelhub/contracts";
import { apiGet, apiPost } from "./client";

export async function listReviewQueue(): Promise<Submission[]> {
  return apiGet<Submission[]>("/api/v1/review/queue");
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