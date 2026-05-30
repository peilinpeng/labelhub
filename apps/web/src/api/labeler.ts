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
  const res = await apiGet<{ items: Task[]; total: number; page: number; pageSize: number }>(
    "/api/v1/marketplace/tasks"
  );
  return res.items;
}

export async function claimTask(taskId: string, request: ClaimTaskRequest): Promise<ClaimTaskResponse> {
  return apiPost<ClaimTaskResponse>(`/api/v1/tasks/${taskId}/claim`, request);
}

export async function getAssignmentContext(assignmentId: string): Promise<AssignmentContextResponse> {
  return apiGet<AssignmentContextResponse>(`/api/v1/assignments/${assignmentId}`);
}

export async function saveDraft(assignmentId: string, request: SaveDraftRequest): Promise<SaveDraftResponse> {
  return apiPut<SaveDraftResponse>(`/api/v1/assignments/${assignmentId}/draft`, request);
}

export async function submitAssignment(assignmentId: string, request: SubmitAssignmentRequest): Promise<SubmitAssignmentResponse> {
  return apiPost<SubmitAssignmentResponse>(`/api/v1/assignments/${assignmentId}/submit`, request);
}

export async function callLLMAssist(
  assignmentId: string,
  request: { nodeId: string; answers: Record<string, unknown> }
): Promise<LLMRuntimeResponse> {
  return apiPost<LLMRuntimeResponse>(`/api/v1/assignments/${assignmentId}/llm-assist`, request);
}

export async function listMySubmissions(): Promise<Submission[]> {
  return apiGet<Submission[]>("/api/v1/me/submissions");
}
