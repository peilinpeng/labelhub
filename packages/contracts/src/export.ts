import type { LabelerTrustLevel, RiskSignalCode } from "./audit";
import type { ID, ISODateTime, JsonPath } from "./global";
import type { TransformSpec } from "./schema";
import type { SubmissionStatus } from "./workflow";

export type ExportFormat = "JSON" | "JSONL" | "CSV" | "EXCEL";

export type ExportJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type ExportAnswerSource = "ORIGINAL_ANSWERS" | "PATCHED_ANSWERS";

export type ExportMode =
  | "VERSIONED"
  | "UNIFIED"
  | "MIGRATION_RESULT";

export type ExportFieldMapping = {
  fromSchemaVersionId: string;
  toSchemaVersionId: string;
  fromFieldName?: string;
  fromArchivedField?: string;
  toFieldName: string;
  operation:
    | "DIRECT"
    | "RENAME_FIELD"
    | "CAST_VALUE"
    | "MAP_OPTION_VALUE"
    | "ARCHIVE_RESTORE";
};

export type ExportWarning = {
  submissionId: string;
  schemaVersionId: string;
  targetSchemaVersionId: string;
  targetFieldName: string;
  reason:
    | "NO_MAPPING_FOUND"
    | "MIGRATION_NOT_EXECUTED"
    | "ARCHIVED_FIELD_NOT_MAPPED"
    | "MULTIPLE_MIGRATION_RECORDS"
    | "TYPE_INCOMPATIBLE";
  message: string;
};

export type ExportRecordMetadata = {
  exportId: string;
  exportMode: ExportMode;
  targetSchemaVersionId?: string;
  includedSchemaVersionIds: string[];
  migrationId?: string;
  exportedBy: string;
  exportedAt: ISODateTime;
  rowCount: number;
  warningCount?: number;
  checksum?: string;
};

export type DataQualityPassportReviewStatus =
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "UNREVIEWED";

export type DataQualityPassportAnswerHashAlgorithm =
  | "canonical-json-v1+SHA-256";

export interface DataQualityPassportQualityLedgerRef {
  labelingEventId?: string;
  reviewEventId?: string;
  reviewDiffEventId?: string;
  exportEventId?: string;
  aiAssistEventIds?: string[];
  aiReviewEventIds?: string[];
  schemaGovernanceEventIds?: string[];
  totalSchemaGovernanceEventCount?: number;
}

export interface DataQualityPassport {
  submissionId: string;
  schemaVersionId: string;

  finalAnswerHash?: string;
  answerHashAlgorithm?: DataQualityPassportAnswerHashAlgorithm;

  labelerTrustLevel?: LabelerTrustLevel;
  trustLevelSnapshotAt?: string;

  reviewStatus: DataQualityPassportReviewStatus;
  reviewerPatchCount?: number;
  changedFieldNames?: string[];

  aiAssistUsed?: boolean;
  aiAcceptedCount?: number;
  aiDismissedCount?: number;
  aiEditedCount?: number;

  riskCodes?: RiskSignalCode[];
  auditEventCount?: number;

  qualityLedgerRef?: DataQualityPassportQualityLedgerRef;
}

export interface ExportRecord {
  exportId: string;
  submissionId: string;
  schemaVersionId: string;
  recordIndex: number;

  data: Record<string, unknown>;
  metadata?: ExportRecordMetadata;
  passport?: DataQualityPassport;
}

export interface ExportArtifactSummary {
  exportId: string;
  taskId: string;
  format: ExportFormat;
  schemaVersionId?: string;
  recordCount: number;
  warningCount: number;
  passportCount?: number;
  passportBatchHash?: string;
  createdAt: string;
  fileId?: string;
}

export interface ExportMapping {
  schemaVersionId: ID;
  format: ExportFormat;
  answerSource: ExportAnswerSource;
  allowPatchedAnswers?: boolean;
  includeReviewRecords: boolean;
  columns: ExportColumn[];
  exportMode?: ExportMode;
  targetSchemaVersionId?: string;
  includedSchemaVersionIds?: string[];
  migrationId?: string;
  fieldMappings?: ExportFieldMapping[];
  filters?: {
    submissionStatus?: SubmissionStatus[];
    acceptedOnly?: boolean;
  };
}

export interface ExportColumn {
  header: string;
  sourcePath: JsonPath;
  transform?: TransformSpec;
  defaultValue?: unknown;
}

export interface ExportJob {
  id: ID;
  taskId: ID;
  schemaVersionId: ID;
  status: ExportJobStatus;
  mapping: ExportMapping;
  progress: {
    total: number;
    done: number;
  };
  fileId?: ID;
  errorMessage?: string;
  createdBy: ID;
  createdAt: ISODateTime;
  finishedAt?: ISODateTime;
  artifactSummary?: ExportArtifactSummary;
}
