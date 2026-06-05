import type { Actor, ID, ISODateTime, Role } from "./global";

export type AuditAction =
  | "TASK_CREATED"
  | "TASK_PUBLISHED"
  | "TASK_PAUSED"
  | "TASK_RESUMED"
  | "TASK_ENDED"
  | "TASK_ARCHIVED"
  | "SCHEMA_DRAFT_SAVED"
  | "SCHEMA_VERSION_PUBLISHED"
  | "DATASET_IMPORTED"
  | "ASSIGNMENT_CLAIMED"
  | "ASSIGNMENT_EXPIRED"
  | "DRAFT_SAVED"
  | "SUBMISSION_CREATED"
  | "AI_REVIEW_ENQUEUED"
  | "AI_REVIEW_STARTED"
  | "AI_REVIEW_SUCCEEDED"
  | "AI_REVIEW_FAILED"
  | "AI_REVIEW_FAILED_TO_HUMAN"
  | "REVIEW_CLAIMED"
  | "FINAL_REVIEW_REQUESTED"
  | "REVIEW_RETURNED"
  | "REVIEW_ACCEPTED"
  | "REVIEW_REJECTED"
  | "EXPORT_CREATED"
  | "EXPORT_STARTED"
  | "EXPORT_SUCCEEDED"
  | "EXPORT_FAILED"
  | "EXPORT_CANCELED"
  | "FILE_UPLOAD_URL_CREATED"
  | "FILE_UPLOAD_STARTED"
  | "FILE_UPLOAD_FAILED"
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

export type AuditEventType =
  | AuditAction
  | "LABELING_SESSION_SUMMARY"
  | "FORM_ABANDONED"
  | "LABELER_RISK_SIGNAL_GENERATED"
  | "LABELER_TRUST_LEVEL_CHANGED"
  | "LABELER_DISPATCH_SUSPENDED"
  | "REVIEW_STARTED"
  | "REVIEW_DIFF_GENERATED"
  | "REVIEW_PATCH_APPLIED"
  | "REVIEW_DEEP_DIFF_GENERATED"
  | "AI_ASSIST_TRIGGERED"
  | "AI_ASSIST_SHOWN"
  | "AI_ASSIST_ACCEPTED"
  | "AI_ASSIST_DISMISSED"
  | "AI_ASSIST_EDITED"
  | "AI_REVIEW_TRIGGERED"
  | "AI_REVIEW_OUTPUT_GENERATED"
  | "AI_REVIEW_CONFIRMED_BY_REVIEWER"
  | "AI_REVIEW_REJECTED_BY_REVIEWER"
  | "SCHEMA_PUBLISH_REQUESTED"
  | "SCHEMA_COMPATIBILITY_CHECKED"
  | "SCHEMA_PUBLISH_BLOCKED"
  | "SCHEMA_PUBLISH_FAILED"
  | "DEPRECATION_WARNING_GENERATED"
  | "MIGRATION_PLAN_CREATED"
  | "MIGRATION_DRY_RUN_COMPLETED"
  | "MIGRATION_EXECUTED"
  | "SUBMISSION_UPDATED"
  | "REVIEW_SUBMITTED"
  | "AI_REVIEW_GENERATED"
  | "EXPORT_GENERATED"
  | "EXPORT_WARNING_RECORDED"
  | "DATA_QUALITY_PASSPORT_GENERATED";

export type RiskSignalCode =
  | "FAST_SUBMIT"
  | "LOW_ACTIVE_TIME"
  | "HIGH_PASTE_COUNT"
  | "LOW_FIELD_CHANGE_COUNT"
  | "REPEATED_ANSWER_HASH"
  | "HIGH_FOCUS_LOSS_COUNT"
  | "SCRIPT_LIKE_SUBMISSION_PATTERN"
  | "CLIENT_TIME_DRIFT";

export type LabelerTrustLevel =
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "UNDER_REVIEW";

export type ReviewDiffMode =
  | "FRONTEND_SHALLOW"
  | "SERVER_ASYNC_REQUIRED"
  | "SERVER_DEEP";

export type ReviewDecisionForAudit =
  | "APPROVED"
  | "APPROVED_WITH_CHANGES"
  | "REJECTED";

export type AuditSeverity = "INFO" | "WARNING" | "ERROR";

export type AuditSource =
  | "WEB"
  | "API"
  | "WORKER"
  | "AI_AGENT"
  | "SYSTEM";

export type AuditActor = {
  id: ID | string;
  role: Role | string;
  displayName?: string;
};

export type AuditTargetEntityType =
  | "TASK"
  | "SCHEMA"
  | "SCHEMA_VERSION"
  | "MIGRATION"
  | "ITEM"
  | "ASSIGNMENT"
  | "SUBMISSION"
  | "REVIEW"
  | "AI_REVIEW_JOB"
  | "EXPORT"
  | "FILE";

export type AuditTarget = {
  entityType: AuditTargetEntityType;
  entityId: ID | string;
  taskId?: ID | string;
  schemaId?: ID | string;
  schemaVersionId?: ID | string;
  assignmentId?: ID | string;
  submissionId?: ID | string;
  reviewId?: ID | string;
  exportId?: ID | string;
  migrationPlanId?: ID | string;
};

export type SchemaDraftSavedAuditPayload = {
  schemaDraftRevision?: number;
  fieldCount?: number;
  validationErrorCount?: number;
  validationWarningCount?: number;
};

export type SchemaPublishRequestedAuditPayload = {
  schemaDraftRevision?: number;
  isFirstPublish: boolean;
  requiresApproval: boolean;
  requiresMigration: boolean;
  confirmedByActor?: boolean;
};

export type SchemaCompatibilityCheckedAuditPayload = {
  compatible: boolean;
  publishAllowed: boolean;
  requiresApproval: boolean;
  requiresMigration: boolean;
  changeCodes: string[];
  blockingCount: number;
  warningCount: number;
  reportChecksum?: string;
};

export type SchemaPublishBlockedAuditPayload = {
  blockingChangeCodes: string[];
  deprecationErrorCodes?: string[];
  schemaValidationErrorCount?: number;
};

export type SchemaPublishFailedAuditPayload = {
  reasonCode?: string;
  message: string;
  stage?: "SAVE_DRAFT" | "PUBLISH_SCHEMA" | "PUBLISH_TASK" | "UNKNOWN";
};

export type SchemaPublishedAuditPayload = {
  schemaVersionId: ID | string;
  schemaVersionNo?: number;
  snapshotHash?: string;
};

export type DeprecationWarningGeneratedAuditPayload = {
  warningCodes: string[];
  fieldNames?: string[];
  warningCount: number;
};

export type MigrationPlanCreatedAuditPayload = {
  fromSchemaVersionId?: ID | string;
  toSchemaVersionId?: ID | string;
  operationCount: number;
  manualMappingSlotCount: number;
  executable: boolean;
  blockingCount: number;
  planChecksum?: string;
};

export type MigrationDryRunCompletedAuditPayload = {
  totalSubmissions: number;
  affectedSubmissions: number;
  validationErrorCount: number;
  skippedCount: number;
  sampleCount: number;
  reportChecksum?: string;
};

export type MigrationExecutedAuditPayload = {
  operationCount: number;
  migratedCount: number;
  skippedCount: number;
  conflictCount: number;
  executionChecksum?: string;
};

export type SubmissionAuditPayload = {
  schemaVersionId?: ID | string;
  answerHash?: string;
  changedFieldNames?: string[];
  validationErrorCount?: number;
  attemptNo?: number;
};

export interface LabelingSessionSummaryAuditPayload {
  taskId: string;
  assignmentId: string;
  labelerId: string;
  schemaVersionId?: string;

  clientStartedAt?: string;
  clientSubmittedAt?: string;
  serverAssignedAt?: string;
  serverReceivedAt?: string;

  totalWallTimeMs: number;
  activeTimeMs: number;
  idleTimeMs: number;

  blurCount: number;
  focusLossCount: number;
  pasteCount: number;

  changedFieldCount: number;
  fieldEditCount: number;
  textareaPasteFieldNames?: string[];

  riskSignals: RiskSignalCode[];

  answerHash?: string;
}

export interface FormAbandonedAuditPayload {
  taskId: string;
  assignmentId: string;
  labelerId: string;
  schemaVersionId?: string;

  totalWallTimeMs?: number;
  activeTimeMs?: number;
  idleTimeMs?: number;

  changedFieldCount?: number;
  riskSignals?: RiskSignalCode[];

  reason?: "PAGE_HIDDEN" | "UNLOAD" | "NAVIGATION" | "UNKNOWN";
}

export interface LabelerRiskSignalGeneratedAuditPayload {
  taskId: string;
  assignmentId?: string;
  labelerId: string;
  schemaVersionId?: string;

  riskSignals: RiskSignalCode[];
  clientRiskSignals?: RiskSignalCode[];
  serverRiskSignals?: RiskSignalCode[];

  activeTimeMs?: number;
  totalWallTimeMs?: number;
  serverElapsedMs?: number;
}

export interface LabelerTrustLevelChangedAuditPayload {
  labelerId: string;
  previousLevel: LabelerTrustLevel;
  newLevel: LabelerTrustLevel;
  reason: string;
  triggerEventIds?: string[];
}

export type ReviewSubmittedAuditPayload = {
  decision: string;
  stage?: string;
  reasonCode?: string;
  patchedFieldNames?: string[];
  patchCount?: number;
};

export interface ReviewDiffGeneratedAuditPayload {
  taskId: string;
  submissionId: string;
  reviewId: string;
  reviewerId: string;
  labelerId?: string;
  schemaVersionId?: string;

  decision: ReviewDecisionForAudit;
  patchedFieldNames: string[];
  patchCount: number;
  majorPatchCount?: number;
  minorPatchCount?: number;
  reasonCode?: string;

  beforeAnswerHash?: string;
  afterAnswerHash?: string;
  diffSummaryHash?: string;

  reviewDurationMs?: number;
  diffMode?: ReviewDiffMode;
}

export interface AiAssistOutcomeAuditPayload {
  taskId: string;
  assignmentId?: string;
  submissionId?: string;
  schemaVersionId?: string;

  nodeId: string;
  fieldName?: string;

  promptVersionId?: string;
  modelId?: string;
  assistType:
    | "SUMMARY"
    | "REWRITE"
    | "CLASSIFICATION"
    | "QUALITY_CHECK";

  triggeredCount?: number;
  acceptedCount?: number;
  dismissedCount?: number;
  editedCount?: number;

  averageLatencyMs?: number;
  outputHash?: string;
  promptSnapshotHash?: string;
}

export type AiReviewGeneratedAuditPayload = {
  aiReviewJobId?: ID | string;
  decision?: string;
  score?: number;
  confidence?: number;
  issueCount?: number;
  outputHash?: string;
  promptSnapshotHash?: string;
};

export type ExportGeneratedAuditPayload = {
  exportId?: ID | string;
  format?: string;
  rowCount?: number;
  warningCount?: number;
  mappingChecksum?: string;
};

export interface DataQualityPassportGeneratedAuditPayload {
  exportId: string;
  passportCount: number;
  passportBatchHash: string;
  warningCount?: number;
}

export type GenericAuditEventPayload = {
  summary?: string;
  detailRef?: ID | string;
  counters?: Record<string, number>;
  codes?: string[];
};

export type AuditEventPayload =
  | SchemaDraftSavedAuditPayload
  | SchemaPublishRequestedAuditPayload
  | SchemaCompatibilityCheckedAuditPayload
  | SchemaPublishBlockedAuditPayload
  | SchemaPublishFailedAuditPayload
  | SchemaPublishedAuditPayload
  | DeprecationWarningGeneratedAuditPayload
  | MigrationPlanCreatedAuditPayload
  | MigrationDryRunCompletedAuditPayload
  | MigrationExecutedAuditPayload
  | SubmissionAuditPayload
  | LabelingSessionSummaryAuditPayload
  | FormAbandonedAuditPayload
  | LabelerRiskSignalGeneratedAuditPayload
  | LabelerTrustLevelChangedAuditPayload
  | ReviewSubmittedAuditPayload
  | ReviewDiffGeneratedAuditPayload
  | AiAssistOutcomeAuditPayload
  | AiReviewGeneratedAuditPayload
  | ExportGeneratedAuditPayload
  | DataQualityPassportGeneratedAuditPayload
  | GenericAuditEventPayload;

export type AuditEventRecord = {
  id: ID | string;
  type: AuditEventType;
  severity: AuditSeverity;
  source: AuditSource;
  actor: AuditActor;
  target: AuditTarget;
  payload: AuditEventPayload;
  requestId?: string;
  idempotencyKey?: string;
  checksum?: string;
  createdAt: ISODateTime | string;
};

export type AuditEventQuery = {
  taskId?: ID | string;
  entityType?: AuditTargetEntityType;
  entityId?: ID | string;
  schemaVersionId?: ID | string;
  assignmentId?: ID | string;
  submissionId?: ID | string;
  reviewId?: ID | string;
  exportId?: ID | string;
  migrationPlanId?: ID | string;
  actorId?: ID | string;
  types?: AuditEventType[];
  severities?: AuditSeverity[];
  source?: AuditSource;
  createdFrom?: ISODateTime | string;
  createdTo?: ISODateTime | string;
  limit?: number;
};

export type AppendAuditEventRequest = {
  type: AuditEventType;
  severity?: AuditSeverity;
  source: AuditSource;
  actor: AuditActor;
  target: AuditTarget;
  payload: AuditEventPayload;
  requestId?: string;
  idempotencyKey?: string;
  checksum?: string;
};
