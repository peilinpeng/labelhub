import type { FileObject, FileStatus, ISODateTime } from "@labelhub/contracts";

import { auditForFileCommand } from "./audit-mapping.ts";
import { failTransition, invalidState } from "./errors.ts";
import {
  canUseUploadFileRef,
  isFileReadyForDatasetImport,
  isFileReadyForExportDownload,
} from "./transition-guards.ts";
import type { FileOwnershipContext, TransitionResult } from "./types.ts";

export function createUploadUrl(file: FileObject): TransitionResult<"createUploadUrl", FileObject, FileStatus> {
  const command = "createUploadUrl";
  if (file.status !== "PENDING") {
    return invalidState(command, file.status, "createUploadUrl 创建后 FileStatus 必须为 PENDING");
  }

  return {
    ok: true,
    entity: file,
    command,
    previousStatus: "NONE",
    nextStatus: "PENDING",
    auditAction: auditForFileCommand(command),
    sideEffects: [],
  };
}

export function markUploadStarted(
  file: FileObject,
): TransitionResult<"markUploadStarted", FileObject, FileStatus> {
  const command = "markUploadStarted";
  if (file.status !== "PENDING") {
    return invalidState(command, file.status, "markUploadStarted 只能从 PENDING 进入 UPLOADING");
  }

  return {
    ok: true,
    entity: { ...file, status: "UPLOADING" },
    command,
    previousStatus: file.status,
    nextStatus: "UPLOADING",
    auditAction: auditForFileCommand(command),
    sideEffects: [],
  };
}

export function confirmUpload(
  file: FileObject,
  confirmedAt?: ISODateTime,
): TransitionResult<"confirmUpload", FileObject, FileStatus> {
  const command = "confirmUpload";
  if (file.status !== "PENDING" && file.status !== "UPLOADING") {
    return invalidState(command, file.status, "confirmUpload 只能从 PENDING 或 UPLOADING 进入 READY");
  }

  const entity: FileObject =
    confirmedAt === undefined ? { ...file, status: "READY" } : { ...file, status: "READY", confirmedAt };

  return {
    ok: true,
    entity,
    command,
    previousStatus: file.status,
    nextStatus: "READY",
    auditAction: auditForFileCommand(command),
    sideEffects: [{ type: "BIND_FILE", ownerId: file.ownerId, ownerType: file.ownerType, purpose: file.purpose }],
  };
}

export function failUpload(file: FileObject): TransitionResult<"failUpload", FileObject, FileStatus> {
  const command = "failUpload";
  if (file.status !== "PENDING" && file.status !== "UPLOADING") {
    return invalidState(command, file.status, "failUpload 只能从 PENDING 或 UPLOADING 进入 FAILED");
  }

  return {
    ok: true,
    entity: { ...file, status: "FAILED" },
    command,
    previousStatus: file.status,
    nextStatus: "FAILED",
    auditAction: auditForFileCommand(command),
    sideEffects: [],
  };
}

export function assertDatasetImportFileReady(file: FileObject): TransitionResult<"confirmUpload", FileObject, FileStatus> {
  if (!isFileReadyForDatasetImport(file)) {
    return failTransition("confirmUpload", file.status, "FILE_NOT_READY", "Dataset import 必须使用 READY + DATASET_IMPORT 文件");
  }

  return {
    ok: true,
    entity: file,
    command: "confirmUpload",
    previousStatus: file.status,
    nextStatus: file.status,
    auditAction: "FILE_CONFIRMED",
    sideEffects: [],
  };
}

export function assertExportDownloadFileReady(file: FileObject): TransitionResult<"confirmUpload", FileObject, FileStatus> {
  if (!isFileReadyForExportDownload(file)) {
    return failTransition("confirmUpload", file.status, "FILE_NOT_READY", "Export download 必须使用 READY + EXPORT_RESULT 文件");
  }

  return {
    ok: true,
    entity: file,
    command: "confirmUpload",
    previousStatus: file.status,
    nextStatus: file.status,
    auditAction: "FILE_CONFIRMED",
    sideEffects: [],
  };
}

export function assertUploadFileRefAllowed(
  fileRef: Parameters<typeof canUseUploadFileRef>[0],
  file: Parameters<typeof canUseUploadFileRef>[1],
  context: FileOwnershipContext,
): boolean {
  return canUseUploadFileRef(fileRef, file, context);
}
