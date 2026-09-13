import type {
  AIReviewJob,
  AIReviewResultRecord,
  AiAssistActionRecord,
  AppendAuditEventRequest,
  Assignment,
  AuditEventRecord,
  DatasetItem,
  Draft,
  ExportArtifactSummary,
  ExportJob,
  ExportRecord,
  FileObject,
  FinalReviewResultRecord,
  HumanReviewResultRecord,
  LabelHubSchema,
  SchemaVersion,
  ServerComponentRegistryItem,
  Submission,
  Task,
} from "@labelhub/contracts";
import { collectSchemaNodes, isAnswerFieldNode } from "@labelhub/contracts";
import { assignmentsMock, draftsMock } from "../data/assignments.mock";
import { componentRegistryMock } from "../data/component-registry.mock";
import { datasetItemsMock } from "../data/dataset-items.mock";
import { exportJobsMock } from "../data/exports.mock";
import { filesMock } from "../data/files.mock";
import { aiReviewJobsMock, reviewResultsMock } from "../data/reviews.mock";
import { newsQualitySchemaDraft, schemaVersionsMock } from "../data/schemas.mock";
import { submissionsMock } from "../data/submissions.mock";
import { tasksMock } from "../data/tasks.mock";
import {
  schemaGovernanceDemoSchemaDrafts,
  schemaGovernanceDemoSchemaVersions,
  schemaGovernanceDemoTasks,
} from "../demo-schema-governance";
import { clone, nextId, now } from "../mock-utils";

export interface MockState {
  tasks: Task[];
  schemaDrafts: LabelHubSchema[];
  schemaVersions: SchemaVersion[];
  datasetItems: DatasetItem[];
  assignments: Assignment[];
  drafts: Draft[];
  submissions: Submission[];
  aiReviewJobs: AIReviewJob[];
  reviewResults: Array<AIReviewResultRecord | HumanReviewResultRecord | FinalReviewResultRecord>;
  exportJobs: ExportJob[];
  exportArtifacts: MockExportArtifact[];
  files: FileObject[];
  registry: ServerComponentRegistryItem[];
  auditEvents: AuditEventRecord[];
  aiAssistActions: AiAssistActionRecord[];
}

export interface MockExportArtifact {
  summary: ExportArtifactSummary;
  records: ExportRecord[];
}

export type LLMAssistMockRequest = {
  nodeId?: string;
};

export const mockDb: MockState = {
  tasks: [...clone(tasksMock), ...clone(schemaGovernanceDemoTasks)],
  schemaDrafts: [clone(newsQualitySchemaDraft), ...clone(schemaGovernanceDemoSchemaDrafts)],
  schemaVersions: [...clone(schemaVersionsMock), ...clone(schemaGovernanceDemoSchemaVersions)],
  datasetItems: clone(datasetItemsMock),
  assignments: clone(assignmentsMock),
  drafts: clone(draftsMock),
  submissions: clone(submissionsMock),
  aiReviewJobs: clone(aiReviewJobsMock),
  reviewResults: clone(reviewResultsMock) as Array<AIReviewResultRecord | HumanReviewResultRecord | FinalReviewResultRecord>,
  exportJobs: clone(exportJobsMock),
  exportArtifacts: [],
  files: clone(filesMock),
  registry: clone(componentRegistryMock),
  auditEvents: createSeedAuditEvents(),
  aiAssistActions: [],
};

function createSeedAuditEvents(): AuditEventRecord[] {
  const createdAt = now();
  return [
    {
      id: nextId("audit"),
      type: "SCHEMA_DRAFT_SAVED",
      severity: "INFO",
      source: "SYSTEM",
      actor: {
        id: "usr_owner",
        role: "OWNER",
        displayName: "Owner",
      },
      target: {
        entityType: "SCHEMA",
        entityId: newsQualitySchemaDraft.schemaId,
        taskId: newsQualitySchemaDraft.meta.taskId,
        schemaId: newsQualitySchemaDraft.schemaId,
      },
      payload: {
        schemaDraftRevision: newsQualitySchemaDraft.schemaDraftRevision,
        fieldCount: collectAnswerFieldCount(newsQualitySchemaDraft),
        validationErrorCount: 0,
        validationWarningCount: 0,
      },
      createdAt,
    },
    {
      id: nextId("audit"),
      type: "EXPORT_GENERATED",
      severity: "INFO",
      source: "SYSTEM",
      actor: {
        id: "usr_owner",
        role: "OWNER",
        displayName: "Owner",
      },
      target: {
        entityType: "EXPORT",
        entityId: "job_seed_export",
        taskId: "task_news_quality",
        exportId: "job_seed_export",
        schemaVersionId: "sv_news_quality_1",
      },
      payload: {
        exportId: "job_seed_export",
        format: "JSONL",
        rowCount: 128,
        warningCount: 0,
        mappingChecksum: "sha256:mock-export-mapping",
      },
      checksum: "sha256:mock-export-event",
      createdAt,
    },
    {
      id: nextId("audit"),
      type: "LABELING_SESSION_SUMMARY",
      severity: "INFO",
      source: "WEB",
      actor: {
        id: "usr_labeler",
        role: "LABELER",
        displayName: "标注员",
      },
      target: {
        entityType: "ASSIGNMENT",
        entityId: "asn_seed_quality",
        taskId: "task_news_quality",
        assignmentId: "asn_seed_quality",
        schemaVersionId: "sv_news_quality_1",
      },
      payload: sanitizeAuditPayload({
        taskId: "task_news_quality",
        assignmentId: "asn_seed_quality",
        labelerId: "usr_labeler",
        schemaVersionId: "sv_news_quality_1",
        totalWallTimeMs: 245000,
        activeTimeMs: 182000,
        idleTimeMs: 63000,
        blurCount: 1,
        focusLossCount: 1,
        pasteCount: 0,
        changedFieldCount: 4,
        fieldEditCount: 7,
        riskSignals: [],
        answerHash: "sha256:mock-answer-summary",
      }),
      createdAt,
    },
    {
      id: nextId("audit"),
      type: "REVIEW_DIFF_GENERATED",
      severity: "INFO",
      source: "WEB",
      actor: {
        id: "usr_reviewer",
        role: "REVIEWER",
        displayName: "审核员",
      },
      target: {
        entityType: "REVIEW",
        entityId: "rev_seed_quality",
        taskId: "task_news_quality",
        submissionId: "sub_seed_quality",
        reviewId: "rev_seed_quality",
        schemaVersionId: "sv_news_quality_1",
      },
      payload: sanitizeAuditPayload({
        taskId: "task_news_quality",
        submissionId: "sub_seed_quality",
        reviewId: "rev_seed_quality",
        reviewerId: "usr_reviewer",
        labelerId: "usr_labeler",
        schemaVersionId: "sv_news_quality_1",
        decision: "APPROVED_WITH_CHANGES",
        patchedFieldNames: ["summary", "qualityRating"],
        patchCount: 2,
        beforeAnswerHash: "sha256:mock-before-answer",
        afterAnswerHash: "sha256:mock-after-answer",
        diffSummaryHash: "sha256:mock-diff-summary",
        diffMode: "FRONTEND_SHALLOW",
      }),
      createdAt,
    },
    {
      id: nextId("audit"),
      type: "AI_ASSIST_ACCEPTED",
      severity: "INFO",
      source: "WEB",
      actor: {
        id: "usr_labeler",
        role: "LABELER",
        displayName: "标注员",
      },
      target: {
        entityType: "ASSIGNMENT",
        entityId: "asn_seed_quality",
        taskId: "task_news_quality",
        assignmentId: "asn_seed_quality",
        schemaVersionId: "sv_news_quality_1",
      },
      payload: sanitizeAuditPayload({
        taskId: "task_news_quality",
        assignmentId: "asn_seed_quality",
        schemaVersionId: "sv_news_quality_1",
        nodeId: "ai_rewrite_suggestion",
        fieldName: "rewriteSuggestion",
        promptVersionId: "prompt_quality_assist_v1",
        modelId: "mock-ai-assist",
        assistType: "REWRITE",
        triggeredCount: 1,
        acceptedCount: 1,
        dismissedCount: 0,
        editedCount: 1,
        averageLatencyMs: 920,
      }),
      createdAt,
    },
    {
      id: nextId("audit"),
      type: "DATA_QUALITY_PASSPORT_GENERATED",
      severity: "INFO",
      source: "WORKER",
      actor: {
        id: "usr_system",
        role: "SYSTEM",
        displayName: "Export Worker",
      },
      target: {
        entityType: "EXPORT",
        entityId: "job_seed_export",
        taskId: "task_news_quality",
        exportId: "job_seed_export",
        schemaVersionId: "sv_news_quality_1",
      },
      payload: sanitizeAuditPayload({
        exportId: "job_seed_export",
        passportCount: 128,
        passportBatchHash: "aca626a201b9d65560ef78fd91933451f1edaf1ff0ec05c7b9010ab7de44701d",
        warningCount: 0,
      }),
      createdAt,
    },
  ];
}

function collectAnswerFieldCount(schema: LabelHubSchema): number {
  return collectSchemaNodes(schema).filter(isAnswerFieldNode).length;
}

function sanitizeAuditPayload(payload: AppendAuditEventRequest["payload"]): AppendAuditEventRequest["payload"] {
  return sanitizeAuditValue(payload) as AppendAuditEventRequest["payload"];
}

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (typeof value !== "object" || value === null) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if ([
      "answers",
      "beforeAnswers",
      "afterAnswers",
      "fullAnswers",
      "sourcePayload",
      "rawOutput",
      "rawLlmOutput",
      "rawPrompt",
      "rawResponse",
      "fullOutput",
      "prompt",
      "renderedPrompt",
      "exportContent",
      "fileContent",
    ].includes(key)) continue;
    sanitized[key] = sanitizeAuditValue(childValue);
  }
  return sanitized;
}
