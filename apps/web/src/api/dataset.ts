import type { DatasetItem } from "@labelhub/contracts";
import { apiGet, apiPost, apiPatch, apiUploadBinary } from "./client";

export type DatasetFormat = "JSON" | "JSONL" | "EXCEL";

export interface ImportDatasetResult {
  taskId: string;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  previewItems: DatasetItem[];
  errors?: { row?: number; message: string }[];
}

export interface ListItemsResult {
  items: DatasetItem[];
  total: number;
  page: number;
  pageSize: number;
}

function currentActorId(): string {
  try {
    const raw = localStorage.getItem("labelhub_actor");
    if (raw) return (JSON.parse(raw) as { id?: string }).id ?? "";
  } catch {
    /* ignore */
  }
  return "";
}

/** 依扩展名推断导入格式 */
export function inferFormat(fileName: string): DatasetFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jsonl")) return "JSONL";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "EXCEL";
  return "JSON";
}

/**
 * 完整数据集导入流程（对接已就绪后端）：
 * 1) POST /files/upload-url 申请上传  2) 上传二进制  3) /confirm 置 READY
 * 4) POST /tasks/{id}/dataset/import 解析入库
 */
export async function importDataset(
  taskId: string,
  file: File,
  format: DatasetFormat,
  externalKeyPath?: string,
): Promise<ImportDatasetResult> {
  const contentType = file.type || "application/octet-stream";
  const created = await apiPost<{ file: { id: string }; uploadUrl: string }>(
    "/api/v1/files/upload-url",
    {
      fileName: file.name,
      mimeType: contentType,
      size: file.size,
      purpose: "DATASET_IMPORT",
      ownerType: "USER",
      ownerId: currentActorId(),
    },
  );
  const fileId = created.file.id;
  // 走相对路径经 Vite 代理上传，避免后端返回的绝对 uploadUrl 在容器/宿主间不一致
  await apiUploadBinary(`/api/v1/files/${fileId}/upload`, file, contentType);
  await apiPost(`/api/v1/files/${fileId}/confirm`, {});

  const body: Record<string, unknown> = { fileId, format };
  if (externalKeyPath) body.externalKeyPath = externalKeyPath;
  return apiPost<ImportDatasetResult>(`/api/v1/tasks/${taskId}/dataset/import`, body);
}

export async function listItems(taskId: string, page = 1, pageSize = 50): Promise<ListItemsResult> {
  return apiGet<ListItemsResult>(`/api/v1/tasks/${taskId}/items?page=${page}&pageSize=${pageSize}`);
}

export async function updateItem(
  itemId: string,
  patch: { sourcePayload?: Record<string, unknown>; status?: "AVAILABLE" | "DISABLED" },
): Promise<DatasetItem> {
  return apiPatch<DatasetItem>(`/api/v1/items/${itemId}`, patch);
}
