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
  GetExportArtifactRecordsResponse,
  SchemaVersion,
} from "@labelhub/contracts";
import { apiGet, apiPost, apiPut } from "./client";

type PageList<T> = T[] | { items?: T[]; tasks?: T[]; jobs?: T[]; exportJobs?: T[] };

function unwrapList<T>(response: PageList<T>): T[] {
  if (Array.isArray(response)) return response;
  return response.items ?? response.tasks ?? response.jobs ?? response.exportJobs ?? [];
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
  return isRecord(res) && "task" in res ? (res as { task: Task }).task : res;
}

export interface TaskStats {
  taskId: string;
  datasetTotal: number;
  datasetAvailable: number;
  inProgress: number;
  inReview: number;
  accepted: number;
  returned: number;
  rejected: number;
  submittedTotal: number;
  quotaTotal: number | null;
  quotaRemaining: number | null;
  progressPercent: number;
}

export async function fetchTaskStats(taskId: string): Promise<TaskStats> {
  return apiGet<TaskStats>(`/api/v1/tasks/${taskId}/stats`);
}

export async function createTask(
  request: Pick<Task, "title" | "quota" | "distributionStrategy" | "reviewPolicy"> & {
    description?: string;
    tags?: string[];
    instructionRichText?: Task["instructionRichText"];
  }
): Promise<Task> {
  const res = await apiPost<Task | { task: Task; auditLog: unknown }>("/api/v1/tasks", request);
  return isRecord(res) && "task" in res ? (res as { task: Task }).task : res;
}

export async function fetchSchemaDraft(taskId: string): Promise<LabelHubSchema> {
  const res = await apiGet<LabelHubSchema | { schema: LabelHubSchema; schemaDraftRevision?: number }>(
    `/api/v1/tasks/${taskId}/schema/draft`,
  );
  if (isRecord(res) && "schema" in res) {
    const response = res as { schema: LabelHubSchema; schemaDraftRevision?: number };
    return response.schemaDraftRevision === undefined
      ? response.schema
      : { ...response.schema, schemaDraftRevision: response.schemaDraftRevision };
  }
  return res;
}

export async function fetchSchemaVersion(schemaVersionId: string): Promise<SchemaVersion> {
  const res = await apiGet<SchemaVersion | { schemaVersion: SchemaVersion }>(`/api/v1/schema-versions/${schemaVersionId}`);
  return isRecord(res) && "schemaVersion" in res ? (res as { schemaVersion: SchemaVersion }).schemaVersion : res;
}

/**
 * GET /tasks/{taskId}/schema-versions 返回的版本历史项。
 * 字段对齐真实后端 SchemaVersionResponse（schema 为已发布快照，publishedAt 为发布时间），
 * 与 contracts SchemaVersion（snapshot/createdAt）命名不同，这里按后端实际响应建模。
 */
export interface SchemaVersionHistoryItem {
  id: string;
  taskId: string;
  schemaId: string;
  schemaVersionNo: number;
  contractVersion: string;
  schema: LabelHubSchema;
  publishedAt: string;
}

export async function listSchemaVersions(taskId: string): Promise<SchemaVersionHistoryItem[]> {
  const res = await apiGet<{ schemaVersions?: SchemaVersionHistoryItem[] } | SchemaVersionHistoryItem[]>(
    `/api/v1/tasks/${taskId}/schema-versions`,
  );
  if (Array.isArray(res)) return res;
  return res.schemaVersions ?? [];
}

export async function saveSchemaDraft(
  taskId: string,
  request: SaveSchemaDraftRequest
): Promise<SaveSchemaDraftResponse> {
  const response = await apiPut<SaveSchemaDraftResponse>(`/api/v1/tasks/${taskId}/schema/draft`, request);
  return {
    ...response,
    schema: { ...response.schema, schemaDraftRevision: response.schemaDraftRevision },
  };
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

export async function publishSchema(
  taskId: string,
  schemaDraftRevision: number,
): Promise<{ schemaVersion: unknown; auditLog: unknown }> {
  return apiPost<{ schemaVersion: unknown; auditLog: unknown }>(
    `/api/v1/tasks/${taskId}/schema/publish`,
    { schemaDraftRevision },
  );
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

export async function getExportArtifactRecords(exportId: string): Promise<GetExportArtifactRecordsResponse> {
  return apiGet<GetExportArtifactRecordsResponse>(`/api/v1/exports/${exportId}/records`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
