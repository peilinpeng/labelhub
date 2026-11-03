import type { ID, ISODateTime } from "./global";
import type { MigrationPlan, MigrationDryRunReport } from "./migration";
import type { AnswerPayload } from "./workflow";

export const TASK_PERMISSIONS = [
  "task.read", "task.manage", "schema.write", "dataset.manage", "export.create", "analytics.read",
  "migration.read", "migration.plan", "migration.approve", "migration.execute", "permissions.manage",
  "review.work", "labeling.work",
] as const;
export type TaskPermission = typeof TASK_PERMISSIONS[number];
export interface TaskPermissionGrant {
  id: ID; taskId: ID; userId: ID; action: TaskPermission; effect: "ALLOW" | "DENY";
  expiresAt?: ISODateTime; revokedAt?: ISODateTime; createdBy: ID; createdAt: ISODateTime;
}
export interface CreateTaskPermissionRequest {
  userId: ID; actions: TaskPermission[]; effect: "ALLOW" | "DENY"; expiresAt?: ISODateTime;
}
export interface EffectiveTaskPermissions { taskId: ID; permissions: TaskPermission[] }
export const MIGRATION_JOB_STATUSES = [
  "DRAFT", "READY", "BLOCKED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "QUEUED", "RUNNING",
  "SUCCEEDED", "PARTIAL", "FAILED", "CANCELED",
] as const;
export type MigrationJobStatus = typeof MIGRATION_JOB_STATUSES[number];
export interface CreateMigrationJobRequest {
  fromSchemaVersionId: ID; toSchemaVersionId: ID; submissionIds: ID[];
  renameMap?: Record<string, string>; defaults?: Record<string, unknown>;
  optionValueMap?: Record<string, Record<string, string>>; archiveRemovedFields?: boolean;
}
export interface MigrationDecisionRequest { checksum: string; reason: string }
export interface MigrationJob {
  id: ID; taskId: ID; status: MigrationJobStatus; createdBy: ID; createdAt: ISODateTime;
  fromSchemaVersionId: ID; toSchemaVersionId: ID; submissionIds: ID[];
  plan?: MigrationPlan; report?: MigrationDryRunReport; checksum?: string;
  approvedBy?: ID; approvedAt?: ISODateTime; decisionReason?: string;
  completedCount: number; conflictCount: number; error?: string; updatedAt: ISODateTime;
}
export interface MigrationRecord {
  id: ID; jobId: ID; submissionId: ID; fromSchemaVersionId: ID; toSchemaVersionId: ID;
  status: "SUCCEEDED" | "CONFLICT"; sourceHash: string; resultHash?: string;
  answers?: AnswerPayload; archivedAnswers?: AnswerPayload; createdAt: ISODateTime;
}
export interface RuntimeTraceEvent {
  sequence: number; timestamp: number;
  kind: "INITIALIZE" | "FIELD_CHANGE" | "RULE_EVALUATED" | "AI_PATCH" | "LOOP_GUARD";
  ruleId?: string; fieldNames: string[]; matched?: boolean; actions: string[];
}
export const MIGRATION_TRANSITIONS: Readonly<Record<MigrationJobStatus, readonly MigrationJobStatus[]>> = {
  DRAFT: ["READY", "BLOCKED", "CANCELED"], READY: ["READY", "BLOCKED", "PENDING_APPROVAL", "CANCELED"],
  BLOCKED: ["READY", "BLOCKED", "CANCELED"], PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELED"],
  APPROVED: ["QUEUED", "CANCELED"], QUEUED: ["RUNNING"], RUNNING: ["SUCCEEDED", "PARTIAL", "FAILED"],
  FAILED: ["QUEUED"], SUCCEEDED: [], PARTIAL: [], REJECTED: [], CANCELED: [],
};
export interface MigrationCandidate {
  id: ID; schemaVersionId: ID; labelerId: ID; status: string; createdAt: ISODateTime;
}
