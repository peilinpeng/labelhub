import type { ExportMapping, FileObject, FileRef, Submission } from "@labelhub/contracts";

import type { FileOwnershipContext } from "./types.ts";

export function hasReason(reason: string | undefined): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

export function canEnterDefaultExportPool(submission: Pick<Submission, "status">): boolean {
  return submission.status === "ACCEPTED";
}

export function isExportMappingAllowed(mapping: ExportMapping): boolean {
  return mapping.answerSource !== "PATCHED_ANSWERS" || mapping.allowPatchedAnswers === true;
}

export function isFileReadyForDatasetImport(file: Pick<FileObject, "status" | "purpose">): boolean {
  return file.status === "READY" && file.purpose === "DATASET_IMPORT";
}

export function isFileReadyForExportDownload(file: Pick<FileObject, "status" | "purpose">): boolean {
  return file.status === "READY" && file.purpose === "EXPORT_RESULT";
}

export function canUseUploadFileRef(
  fileRef: FileRef,
  file: Pick<FileObject, "id" | "ownerId" | "ownerType" | "status">,
  context: FileOwnershipContext,
): boolean {
  if (fileRef.fileId !== file.id || file.status !== "READY") {
    return false;
  }

  if (file.ownerType === "USER") {
    return file.ownerId === context.currentUserId;
  }

  if (file.ownerType === "ASSIGNMENT") {
    return context.currentAssignmentId !== undefined && file.ownerId === context.currentAssignmentId;
  }

  return false;
}
