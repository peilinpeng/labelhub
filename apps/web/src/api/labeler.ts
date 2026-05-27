import type {
  AssignmentContextResponse,
  ClaimTaskRequest,
  ClaimTaskResponse,
  SaveDraftRequest,
  SaveDraftResponse,
  SubmitAssignmentRequest,
  SubmitAssignmentResponse,
  LLMRuntimeResponse,
  Task,
  Submission,
} from "@labelhub/contracts";
import { apiGet, apiPost, apiPut } from "./client";

export async function listMarketplaceTasks(): Promise<Task[]> {
  return apiGet<Task[]>("/api/v1/marketplace/tasks");
}

export async function claimTask(taskId: string, request: ClaimTaskRequest): Promise<ClaimTaskResponse> {
  return apiPost<ClaimTaskResponse>(`/api/v1/tasks/${taskId}/claim`, request);
}

export async function getAssignmentContext(taskId: string, itemId: string): Promise<AssignmentContextResponse> {
  return apiGet<AssignmentContextResponse>(`/api/v1/tasks/${taskId}/items/${itemId}/context`);
}

export async function saveDraft(taskId: string, itemId: string, request: SaveDraftRequest): Promise<SaveDraftResponse> {
  return apiPut<SaveDraftResponse>(`/api/v1/tasks/${taskId}/items/${itemId}/draft`, request);
}

export async function submitAssignment(taskId: string, itemId: string, request: SubmitAssignmentRequest): Promise<SubmitAssignmentResponse> {
  return apiPost<SubmitAssignmentResponse>(`/api/v1/tasks/${taskId}/items/${itemId}/submit`, request);
}

export async function callLLMAssist(taskId: string, itemId: string): Promise<LLMRuntimeResponse> {
  return apiPost<LLMRuntimeResponse>(`/api/v1/tasks/${taskId}/items/${itemId}/llm-assist`, {});
}

export async function listMySubmissions(): Promise<Submission[]> {
  return apiGet<Submission[]>("/api/v1/me/submissions");
}