import type { Actor, ID, ISODateTime } from "./global";

export type AuditAction =
  | "TASK_CREATED"
  | "TASK_PUBLISHED"
  | "TASK_PAUSED"
  | "TASK_RESUMED"
  | "TASK_ENDED"
  | "SCHEMA_DRAFT_SAVED"
  | "SCHEMA_VERSION_PUBLISHED"
  | "DATASET_IMPORTED"
  | "ASSIGNMENT_CLAIMED"
  | "ASSIGNMENT_EXPIRED"
  | "DRAFT_SAVED"
  | "SUBMISSION_CREATED"
  | "AI_REVIEW_ENQUEUED"
  | "AI_REVIEW_SUCCEEDED"
  | "AI_REVIEW_FAILED"
  | "AI_REVIEW_FAILED_TO_HUMAN"
  | "REVIEW_CLAIMED"
  | "REVIEW_RETURNED"
  | "REVIEW_ACCEPTED"
  | "REVIEW_REJECTED"
  | "EXPORT_CREATED"
  | "EXPORT_STARTED"
  | "EXPORT_SUCCEEDED"
  | "EXPORT_FAILED"
  | "EXPORT_CANCELED"
  | "FILE_UPLOADED"
  | "FILE_CONFIRMED";

export interface AuditLog {
  id: ID;
  entityType:
    | "TASK"
    | "SCHEMA"
    | "ITEM"
    | "ASSIGNMENT"
    | "SUBMISSION"
    | "REVIEW"
    | "AI_REVIEW_JOB"
    | "EXPORT"
    | "FILE";
  entityId: ID;
  action: AuditAction;
  actor: Actor;
  before?: unknown;
  after?: unknown;
  reason?: string;
  requestId?: string;
  createdAt: ISODateTime;
}

export interface AuditLogSummary {
  id: ID;
  action: AuditAction;
  createdAt: ISODateTime;
}
