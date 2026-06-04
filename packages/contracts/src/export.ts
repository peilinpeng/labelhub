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
}
