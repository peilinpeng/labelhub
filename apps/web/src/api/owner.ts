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
import { apiDelete, apiGet, apiGetBlob, apiPatch, apiPost, apiPut } from "./client";

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
    deadlineAt?: string | null;
    tags?: string[];
    instructionRichText?: Task["instructionRichText"];
  }
): Promise<Task> {
  const res = await apiPost<Task | { task: Task; auditLog: unknown }>("/api/v1/tasks", request);
  return isRecord(res) && "task" in res ? (res as { task: Task }).task : res;
}

export async function updateTask(
  taskId: string,
  request: Partial<Pick<Task, "title" | "description" | "instructionRichText" | "tags" | "quota" | "distributionStrategy">> & {
    deadlineAt?: string | null;
  },
): Promise<Task> {
  const res = await apiPatch<Task | { task: Task }>(`/api/v1/tasks/${taskId}`, request);
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

/**
 * 兼容两种版本快照形态：后端实际响应的 `schema`/`publishedAt`，以及 contracts
 * SchemaVersion 的 `snapshot`/`createdAt`。缺少可用 schema 的条目直接丢弃，避免把
 * undefined schema 传给 checkBackwardCompatibility / onCopyToDraft 造成白屏。
 */
function normalizeSchemaVersion(raw: unknown): SchemaVersionHistoryItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const schema = (record.schema ?? record.snapshot) as LabelHubSchema | undefined;
  if (schema === undefined || schema === null) return null;
  const publishedAt = (record.publishedAt ?? record.createdAt ?? "") as string;
  return {
    id: String(record.id ?? ""),
    taskId: String(record.taskId ?? ""),
    schemaId: String(record.schemaId ?? schema.schemaId ?? ""),
    schemaVersionNo: Number(record.schemaVersionNo ?? schema.schemaVersionNo ?? 0),
    contractVersion: String(record.contractVersion ?? schema.contractVersion ?? ""),
    schema,
    publishedAt,
  };
}

export async function listSchemaVersions(taskId: string): Promise<SchemaVersionHistoryItem[]> {
  const res = await apiGet<{ schemaVersions?: unknown[] } | unknown[]>(
    `/api/v1/tasks/${taskId}/schema-versions`,
  );
  const rawList = Array.isArray(res) ? res : res.schemaVersions ?? [];
  return rawList
    .map(normalizeSchemaVersion)
    .filter((item): item is SchemaVersionHistoryItem => item !== null);
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

export async function pauseTask(taskId: string, reason: string): Promise<Task> {
  const res = await apiPost<Task | { task: Task; auditLog: unknown }>(`/api/v1/tasks/${taskId}/pause`, { reason });
  return isRecord(res) && "task" in res ? (res as { task: Task }).task : res;
}

export async function resumeTask(taskId: string): Promise<Task> {
  const res = await apiPost<Task | { task: Task; auditLog: unknown }>(`/api/v1/tasks/${taskId}/resume`, {});
  return isRecord(res) && "task" in res ? (res as { task: Task }).task : res;
}

export async function endTask(taskId: string, reason: string): Promise<Task> {
  const res = await apiPost<Task | { task: Task; auditLog: unknown }>(`/api/v1/tasks/${taskId}/end`, { reason });
  return isRecord(res) && "task" in res ? (res as { task: Task }).task : res;
}

export async function archiveTask(taskId: string, reason: string): Promise<Task> {
  const res = await apiPost<Task | { task: Task; auditLog: unknown }>(`/api/v1/tasks/${taskId}/archive`, { reason });
  return isRecord(res) && "task" in res ? (res as { task: Task }).task : res;
}

export async function deleteDraftTask(taskId: string): Promise<void> {
  await apiDelete(`/api/v1/tasks/${taskId}`);
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

/** 下载已完成导出任务的真实文件（流式 FileResponse），带认证。 */
export async function downloadExportFile(exportId: string): Promise<{ blob: Blob; filename: string | null }> {
  return apiGetBlob(`/api/v1/exports/${exportId}/download/file`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
