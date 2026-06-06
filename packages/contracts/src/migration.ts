import type { AnswerPayload } from "./workflow";
import type { CanonicalSerializationVersion } from "./checksum";

export type ManualMappingSlotKind =
  | "FIELD_RENAME"
  | "OPTION_VALUE_MAP"
  | "CUSTOM_TRANSFORM";

export type ManualMappingSlot = {
  slotId: string;
  kind: ManualMappingSlotKind;
  fromFieldName?: string;
  candidateFieldNames?: string[];
  fromValue?: string;
  candidateValues?: string[];
  reason: string;
  required: true;
  resolved: boolean;
};

export type MigrationSubmissionInput = {
  submissionId: string;
  schemaVersionId: string;
  answers: AnswerPayload;
  version?: number;
  updatedAt?: string;
  submittedAt?: string;
};

export type MigrationSkippedSubmission = {
  submissionId: string;
  reason: "CONFLICT" | "VALIDATION_FAILED" | "OUT_OF_SCOPE" | "BLOCKED";
  expectedVersion?: number;
  actualVersion?: number;
  expectedUpdatedAt?: string;
  actualUpdatedAt?: string;
  message: string;
};

export type MigrationOperation =
  | { op: "KEEP_FIELD"; fieldName: string }
  | { op: "RENAME_FIELD"; from: string; to: string }
  | { op: "CAST_VALUE"; fieldName: string; fromType: string; toType: string }
  | { op: "ARCHIVE_FIELD"; fieldName: string }
  | { op: "ADD_DEFAULT"; fieldName: string; defaultValue: unknown }
  | { op: "MAP_OPTION_VALUE"; fieldName: string; fromValue: string; toValue: string }
  | {
      op: "REQUIRE_MANUAL_MAPPING";
      fromFieldName: string;
      candidateFieldNames: string[];
      reason: string;
    }
  | {
      op: "CUSTOM_TRANSFORM";
      transformFnId: string;
      fieldNames: string[];
      reason: string;
    };

export type MigrationPlan = {
  migrationPlanId?: string;
  fromSchemaVersionId?: string;
  toSchemaVersionId?: string;
  operations: MigrationOperation[];
  manualMappingSlots: ManualMappingSlot[];
  executable: boolean;
  blockingIssues: string[];
  warnings: string[];
  checksumInput: unknown;
  canonicalSerializationVersion?: CanonicalSerializationVersion;
  cutoffSubmittedAt?: string;
  includedSubmissionIds?: string[];
};

export type MigrationDryRunReport = {
  totalSubmissions: number;
  affectedSubmissions: number;
  executable: boolean;
  operationStats: Array<{
    op: string;
    count: number;
    fieldName?: string;
  }>;
  archivedFieldStats: Array<{
    fieldName: string;
    count: number;
  }>;
  validationErrors: Array<{
    submissionId: string;
    fieldName?: string;
    message: string;
  }>;
  sampleBeforeAfter: Array<{
    submissionId: string;
    before: AnswerPayload;
    after: AnswerPayload;
    archivedAnswers?: AnswerPayload;
  }>;
  skippedSubmissions: MigrationSkippedSubmission[];
  blockingIssues: string[];
  samplingPolicy: {
    sampleLimit: number;
    strategy: "PRIORITIZED_DETERMINISTIC";
    priorityOrder: string[];
  };
};

export type MigrationExecutionResult = {
  migratedSubmissions: Array<{
    submissionId: string;
    fromSchemaVersionId?: string;
    toSchemaVersionId?: string;
    answers: AnswerPayload;
    archivedAnswers?: AnswerPayload;
    expectedVersion?: number;
    expectedUpdatedAt?: string;
  }>;
  skippedSubmissions: MigrationSkippedSubmission[];
  conflictCount: number;
  recordDraft: {
    operationCount: number;
    migratedCount: number;
    skippedCount: number;
    conflictCount: number;
    generatedAt: string;
    checksumInput: unknown;
    canonicalSerializationVersion?: CanonicalSerializationVersion;
  };
};
