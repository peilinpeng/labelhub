import type {
  GenerateSchemaRequest,
  GenerateSchemaResponse,
  SaveSchemaDraftRequest,
  SaveSchemaDraftResponse,
  SchemaValidationResult,
  LabelHubSchema,
  ServerComponentRegistryItem,
  Task,
  PublishTaskRequest,
  PublishTaskResponse,
  CreateExportJobRequest,
  CreateExportJobResponse,
  ExportJob,
} from "@labelhub/contracts";
import { apiGet, apiPost, apiPut } from "./client";

type PageList<T> = T[] | { items?: T[]; tasks?: T[]; jobs?: T[]; exportJobs?: T[] };

function unwrapList<T>(response: PageList<T>): T[] {
  if (Array.isArray(response)) return response;
  return response.items ?? response.tasks ?? response.jobs ?? response.exportJobs ?? [];
}

function unwrapProp<T, K extends string>(response: T | Record<K, T>, key: K): T {
  if (response && typeof response === "object" && key in response) {
    return (response as Record<K, T>)[key];
  }
  return response as T;
}

export async function fetchServerRegistry(): Promise<ServerComponentRegistryItem[]> {
  const res = await apiGet<PageList<ServerComponentRegistryItem> & { components?: ServerComponentRegistryItem[] }>(
    "/api/v1/schema/component-registry"
  );
  if (!Array.isArray(res) && res.components) return res.components;
  return unwrapList(res);
}

export async function fetchTask(taskId: string): Promise<Task> {
  const res = await apiGet<Task | { task: Task }>(`/api/v1/tasks/${taskId}`);
  return unwrapProp(res, "task");
}

export async function createTask(
  request: Pick<Task, "title" | "quota" | "distributionStrategy" | "reviewPolicy"> & {
    description?: string;
    tags?: string[];
  }
): Promise<Task> {
  const res = await apiPost<{ task: Task; auditLog: unknown }>("/api/v1/tasks", request);
  return res.task;
}

export async function fetchSchemaDraft(taskId: string): Promise<LabelHubSchema> {
  const res = await apiGet<LabelHubSchema | { schema: LabelHubSchema }>(`/api/v1/tasks/${taskId}/schema/draft`);
  return unwrapProp(res, "schema");
}

export async function saveSchemaDraft(
  taskId: string,
  request: SaveSchemaDraftRequest
): Promise<SaveSchemaDraftResponse> {
  return apiPut<SaveSchemaDraftResponse>(`/api/v1/tasks/${taskId}/schema/draft`, request);
}

export async function validateSchema(schema: LabelHubSchema): Promise<SchemaValidationResult> {
  return apiPost<SchemaValidationResult>("/api/v1/schema/validate", schema);
}

export async function generateSchema(
  taskId: string,
  request: GenerateSchemaRequest
): Promise<GenerateSchemaResponse> {
  return apiPost<GenerateSchemaResponse>(`/api/v1/tasks/${taskId}/schema/ai-generate`, request);
}

export async function publishSchema(taskId: string): Promise<{ schemaVersion: unknown; auditLog: unknown }> {
  return apiPost<{ schemaVersion: unknown; auditLog: unknown }>(`/api/v1/tasks/${taskId}/schema/publish`, {});
}

export async function publishTask(taskId: string, request: PublishTaskRequest): Promise<PublishTaskResponse> {
  return apiPost<PublishTaskResponse>(`/api/v1/tasks/${taskId}/publish`, request);
}

export async function listTasks(): Promise<Task[]> {
  const res = await apiGet<PageList<Task>>("/api/v1/tasks");
  return unwrapList(res);
}

export async function createExportJob(
  taskId: string,
  request: CreateExportJobRequest
): Promise<CreateExportJobResponse> {
  return apiPost<CreateExportJobResponse>(`/api/v1/tasks/${taskId}/exports`, request);
}

export async function listExportJobs(taskId: string): Promise<ExportJob[]> {
  const res = await apiGet<PageList<ExportJob>>(`/api/v1/tasks/${taskId}/exports`);
  return unwrapList(res);
}
