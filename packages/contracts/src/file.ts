import type { AuditAction } from "./audit";
import type { ID, ISODateTime } from "./global";

export interface FileRef {
  fileId: ID;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export type FileStatus = "PENDING" | "UPLOADING" | "READY" | "FAILED" | "DELETED";

export type FileWorkflowCommand =
  | "createUploadUrl"
  | "markUploadStarted"
  | "confirmUpload";

export type FileUploadLifecycleRule =
  | {
      command: "createUploadUrl";
      fromStatus?: never;
      toStatus: "PENDING";
      auditAction: Extract<AuditAction, "FILE_UPLOAD_URL_CREATED">;
    }
  | {
      command: "markUploadStarted";
      fromStatus: "PENDING";
      toStatus: "UPLOADING";
      auditAction: Extract<AuditAction, "FILE_UPLOAD_STARTED">;
    }
  | {
      command: "confirmUpload";
      fromStatus: "PENDING" | "UPLOADING";
      toStatus: "READY";
      auditAction: Extract<AuditAction, "FILE_CONFIRMED">;
    };

export interface FileObject {
  id: ID;
  ownerId: ID;
  ownerType: "USER" | "ASSIGNMENT" | "EXPORT_JOB";
  purpose: "DATASET_IMPORT" | "ANSWER_ATTACHMENT" | "EXPORT_RESULT";
  mimeType: string;
  size: number;
  storageKey: string;
  status: FileStatus;
  createdAt: ISODateTime;
  confirmedAt?: ISODateTime;
}

export interface CreateUploadUrlRequest {
  fileName: string;
  mimeType: string;
  size: number;
  purpose: "DATASET_IMPORT" | "ANSWER_ATTACHMENT" | "EXPORT_RESULT";
  ownerType: "USER" | "ASSIGNMENT" | "EXPORT_JOB";
  ownerId: ID;
}

export interface CreateUploadUrlResponse {
  file: FileObject;
  uploadUrl: string;
  headers?: Record<string, string>;
  expiresAt: ISODateTime;
}

export interface ConfirmUploadRequest {
  storageKey?: string;
  checksum?: string;
}

export interface ConfirmUploadResponse {
  file: FileObject;
}
