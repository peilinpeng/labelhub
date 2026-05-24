import type { ID, ISODateTime, JsonPath } from "./global";
import type { TransformSpec } from "./schema";
import type { SubmissionStatus } from "./workflow";

export type ExportFormat = "JSON" | "JSONL" | "CSV" | "EXCEL";

export type ExportJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type ExportAnswerSource = "ORIGINAL_ANSWERS" | "PATCHED_ANSWERS";

export interface ExportMapping {
  schemaVersionId: ID;
  format: ExportFormat;
  answerSource: ExportAnswerSource;
  includeReviewRecords: boolean;
  columns: ExportColumn[];
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
