import type { AppendAuditEventRequest, AuditEventQuery, AuditEventRecord, AuditLog, AuditLogSummary } from "./audit";
import type { ApiError } from "./errors";
import type { ExportArtifactSummary, ExportJob, ExportMapping, ExportRecord } from "./export";
import type { FileObject } from "./file";
import type { ID, ISODateTime, JsonPath } from "./global";
import type {
  AIReviewJobStatus,
  AIReviewResultRecord,
  FinalReviewResultRecord,
  HumanReviewResultRecord,
  ReviewCommand,
  ReviewResult,
} from "./review";
import type {
  LabelHubSchema,
  NodeType,
  PublishedLabelHubSchema,
  SchemaValidationError,
  SchemaValidationResult,
  SchemaVersion,
  ValidationResult,
} from "./schema";
import type {
  AnswerPayload,
  Assignment,
  DatasetItem,
  Draft,
  Submission,
  SubmissionStatus,
  Task,
} from "./workflow";

export interface PublishTaskRequest {
  schemaVersionId: ID;
  reviewConfigId?: ID;
  reviewDisabledExplicitly?: boolean;
}

export interface PublishTaskResponse {
  task: Task;
  schemaVersion: SchemaVersion;
  auditLog: AuditLogSummary;
}

export interface GenerateSchemaRequest {
  taskDescription: string;
  sampleItems?: Array<Record<string, unknown>>;
  preferredNodeTypes?: NodeType[];
}

export interface GenerateSchemaResponse {
  schemaDraft: LabelHubSchema;
  validation: SchemaValidationResult;
  warnings: SchemaValidationError[];
  generatedBy: {
    modelPolicyId: string;
    promptSnapshotHash: string;
    llmCallId: ID;
  };
}

export interface SaveSchemaDraftRequest {
  schema: LabelHubSchema;
  baseSchemaDraftRevision?: number;
}

export interface SaveSchemaDraftResponse {
  schema: LabelHubSchema;
  schemaDraftRevision: number;
  validation: SchemaValidationResult;
  auditLog: AuditLogSummary;
}

export interface ImportDatasetRequest {
  fileId: ID;
  format: "JSON" | "JSONL" | "EXCEL";
  externalKeyPath?: JsonPath;
}

export interface ImportDatasetResponse {
  taskId: ID;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  previewItems: DatasetItem[];
  errors?: Array<{ row?: number; message: string }>;
  auditLog: AuditLogSummary;
}

export interface ClaimTaskRequest {
  preferredItemId?: ID;
}

export interface ClaimTaskResponse {
  context: AssignmentContextResponse;
  auditLog: AuditLogSummary;
}

export interface AssignmentContextResponse {
  assignment: Assignment;
  task: Task;
  item: DatasetItem;
  schemaVersionId: ID;
  schema: PublishedLabelHubSchema;
  draft?: Draft;
  lastReturnReason?: ReviewResult;
}

export interface SaveDraftRequest {
  answers: AnswerPayload;
  clientRevision: number;
}

export interface SaveDraftResponse {
  draft: Draft;
  assignment: Assignment;
  validation: ValidationResult;
  auditLog: AuditLogSummary;
}

export interface SubmitAssignmentRequest {
  answers: AnswerPayload;
  clientRevision?: number;
}

export interface SubmitAssignmentResponse {
  submission: Submission;
  assignment: Assignment;
  validation: ValidationResult;
  nextStatus: SubmissionStatus;
  aiJob?: AIReviewJobSummary;
  auditLog: AuditLogSummary;
}

export interface EnqueueAIReviewRequest {
  submissionId: ID;
}

export interface EnqueueAIReviewResponse {
  submission: Submission;
  aiJob: AIReviewJobSummary;
  auditLog: AuditLogSummary;
}

export interface AIReviewJobSummary {
  id: ID;
  submissionId: ID;
  attemptNo: number;
  schemaVersionId: ID;
  status: AIReviewJobStatus;
  retryCount: number;
  maxRetries: number;
}

export interface ReviewDetailResponse {
  submission: Submission;
  task: Task;
  item: DatasetItem;
  schemaVersionId: ID;
  schema: PublishedLabelHubSchema;
  aiResult?: AIReviewResultRecord;
  history: ReviewResult[];
  auditLogs: AuditLog[];
}

export type ReviewDecisionRequest = ReviewCommand;

export interface ReviewDecisionResponse {
  submission: Submission;
  reviewResult: HumanReviewResultRecord | FinalReviewResultRecord;
  auditLog: AuditLogSummary;
}

export interface BatchReviewRequest {
  items: ReviewCommand[];
}

export interface BatchReviewResponse {
  results: Array<{
    submissionId: ID;
    success: boolean;
    submission?: Submission;
    reviewResult?: HumanReviewResultRecord | FinalReviewResultRecord;
    error?: ApiError;
  }>;
}

export interface CreateExportJobRequest {
  mapping: ExportMapping;
}

export interface CreateExportJobResponse {
  exportJob: ExportJob;
  auditLog: AuditLogSummary;
}

export interface GetExportJobResponse {
  exportJob: ExportJob;
}

export interface DownloadExportResponse {
  exportJob: ExportJob;
  file: FileObject;
  downloadUrl: string;
  expiresAt: ISODateTime;
}

export interface GetExportArtifactRecordsRequest {
  exportId: string;
}

export interface GetExportArtifactRecordsResponse {
  exportId: string;
  records: ExportRecord[];
  artifactSummary?: ExportArtifactSummary;
}

export type AppendAuditEventResponse = {
  event: AuditEventRecord;
};

export type QueryAuditEventsRequest = AuditEventQuery;

export type QueryAuditEventsResponse = {
  events: AuditEventRecord[];
  nextCursor?: string;
};

export type { AppendAuditEventRequest };

export type {
  ConfirmUploadRequest,
  ConfirmUploadResponse,
  CreateUploadUrlRequest,
  CreateUploadUrlResponse,
} from "./file";

export type {
  PublishSchemaVersionRequest,
  PublishSchemaVersionResponse,
} from "./schema";
