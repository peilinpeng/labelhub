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
} from "@labelhub/contracts";
import { apiGet, apiPost, apiPut } from "./client";

export async function fetchServerRegistry(): Promise<ServerComponentRegistryItem[]> {
  return apiGet<ServerComponentRegistryItem[]>("/api/v1/schema/component-registry");
}

export async function fetchTask(taskId: string): Promise<Task> {
  return apiGet<Task>(`/api/v1/tasks/${taskId}`);
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
  return apiGet<Task[]>("/api/v1/tasks");
}