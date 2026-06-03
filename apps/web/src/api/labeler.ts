import type {
  AssignmentContextResponse,
  ClaimTaskRequest,
  ClaimTaskResponse,
  DatasetItem,
  SaveDraftRequest,
  SaveDraftResponse,
  SubmitAssignmentRequest,
  SubmitAssignmentResponse,
  LLMRuntimeResponse,
  Task,
  Submission,
} from "@labelhub/contracts";
import { apiGet, apiPost, apiPut } from "./client";

type PageList<T> = T[] | { items?: T[]; tasks?: T[]; submissions?: T[] };

function unwrapList<T>(response: PageList<T>): T[] {
  if (Array.isArray(response)) return response;
  return response.items ?? response.tasks ?? response.submissions ?? [];
}

function unwrapProp<T, K extends string>(response: T | Record<K, T>, key: K): T {
  if (response && typeof response === "object" && key in response) {
    return (response as Record<K, T>)[key];
  }
  return response as T;
}

export async function listMarketplaceTasks(): Promise<Task[]> {
  const res = await apiGet<PageList<Task>>("/api/v1/marketplace/tasks");
  return unwrapList(res);
}

export async function claimTask(taskId: string, request: ClaimTaskRequest): Promise<ClaimTaskResponse> {
  return apiPost<ClaimTaskResponse>(`/api/v1/tasks/${taskId}/claim`, request);
}

export async function getAssignmentContext(assignmentId: string): Promise<AssignmentContextResponse> {
  const res = await apiGet<AssignmentContextResponse | { context: AssignmentContextResponse }>(
    `/api/v1/assignments/${assignmentId}`
  );
  return unwrapProp(res, "context");
}

export async function listAssignmentItems(assignmentId: string): Promise<DatasetItem[]> {
  const res = await apiGet<PageList<DatasetItem>>(`/api/v1/assignments/${assignmentId}/items`);
  return unwrapList(res);
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
  const res = await apiGet<PageList<Submission>>("/api/v1/me/submissions");
  return unwrapList(res);
}
