import type {
  AIReviewJob,
  AIReviewJobSummary,
  AIReviewResultRecord,
  AiAssistType,
  AppendAuditEventRequest,
  AnswerPayload,
  Assignment,
  AssignmentContextResponse,
  AuditEventQuery,
  AuditEventRecord,
  AuditLogSummary,
  BatchReviewResponse,
  ClaimTaskResponse,
  DatasetItem,
  Draft,
  ExportJob,
  ExportMapping,
  FinalReviewResultRecord,
  FileObject,
  GenerateSchemaResponse,
  HumanReviewResultRecord,
  ImportDatasetResponse,
  LabelHubRuntimeContext,
  LabelHubSchema,
  LLMRuntimeResponse,
  PublishedLabelHubSchema,
  ReviewCommand,
  ReviewDecisionResponse,
  ReviewDetailResponse,
  SaveDraftResponse,
  SaveSchemaDraftResponse,
  SchemaValidationResult,
  SchemaVersion,
  ServerComponentRegistryItem,
  Submission,
  SubmitAssignmentResponse,
  Task,
  ValidationResult,
  QueryAuditEventsResponse,
} from "@labelhub/contracts";
import {
  collectSchemaNodes,
  isAnswerFieldNode,
  normalizeAnswers,
  validateRequiredFields,
  validateSchemaInvariants,
} from "@labelhub/contracts";
import { assignmentsMock, draftsMock } from "./data/assignments.mock";
import { componentRegistryMock } from "./data/component-registry.mock";
import { datasetItemsMock } from "./data/dataset-items.mock";
import { exportJobsMock } from "./data/exports.mock";
import { filesMock } from "./data/files.mock";
import { aiReviewJobsMock, reviewResultsMock } from "./data/reviews.mock";
import { newsQualitySchemaDraft, schemaVersionsMock } from "./data/schemas.mock";
import { submissionsMock } from "./data/submissions.mock";
import { tasksMock } from "./data/tasks.mock";
import {
  schemaGovernanceDemoSchemaDrafts,
  schemaGovernanceDemoSchemaVersions,
  schemaGovernanceDemoTasks,
} from "./demo-schema-governance";
import { clone, nextId, now } from "./mock-utils";

interface MockState {
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
  files: FileObject[];
  registry: ServerComponentRegistryItem[];
  auditEvents: AuditEventRecord[];
}

type LLMAssistMockRequest = {
  nodeId?: string;
};

const AI_ASSIST_PROMPT_VERSION_ID = "prompt_labeler_assist_v1";
const AI_ASSIST_MODEL_ID = "mock-llm-v1";

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
  files: clone(filesMock),
  registry: clone(componentRegistryMock),
  auditEvents: createSeedAuditEvents(),
};

export function audit(action: AuditLogSummary["action"]): AuditLogSummary {
  return {
    id: nextId("audit"),
    action,
    createdAt: now(),
  };
}

export function appendAuditEvent(request: AppendAuditEventRequest): AuditEventRecord {
  if (request.idempotencyKey !== undefined) {
    const existing = mockDb.auditEvents.find((event) => event.idempotencyKey === request.idempotencyKey);
    if (existing !== undefined) {
      return clone(existing);
    }
  }

  const record: AuditEventRecord = {
    id: nextId("audit"),
    type: request.type,
    severity: request.severity ?? "INFO",
    source: request.source,
    actor: request.actor,
    target: request.target,
    payload: sanitizeAuditPayload(request.payload),
    createdAt: now(),
  };
  if (request.requestId !== undefined) record.requestId = request.requestId;
  if (request.idempotencyKey !== undefined) record.idempotencyKey = request.idempotencyKey;
  if (request.checksum !== undefined) record.checksum = request.checksum;

  mockDb.auditEvents.push(record);
  return clone(record);
}

export function queryAuditEvents(query: AuditEventQuery = {}): QueryAuditEventsResponse {
  const events = mockDb.auditEvents
    .filter((event) => matchesAuditQuery(event, query))
    .sort(compareAuditEventsDesc)
    .slice(0, query.limit ?? mockDb.auditEvents.length)
    .map((event) => clone(event));

  return { events };
}

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
        outputHash: "sha256:mock-ai-output",
        promptSnapshotHash: "sha256:mock-prompt",
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
        passportBatchHash: "sha256:mock-passport-batch",
        warningCount: 0,
      }),
      createdAt,
    },
  ];
}

function matchesAuditQuery(event: AuditEventRecord, query: AuditEventQuery): boolean {
  if (query.taskId !== undefined && event.target.taskId !== query.taskId) return false;
  if (query.entityType !== undefined && event.target.entityType !== query.entityType) return false;
  if (query.entityId !== undefined && event.target.entityId !== query.entityId) return false;
  if (query.schemaVersionId !== undefined && event.target.schemaVersionId !== query.schemaVersionId) return false;
  if (query.assignmentId !== undefined && event.target.assignmentId !== query.assignmentId) return false;
  if (query.submissionId !== undefined && event.target.submissionId !== query.submissionId) return false;
  if (query.reviewId !== undefined && event.target.reviewId !== query.reviewId) return false;
  if (query.exportId !== undefined && event.target.exportId !== query.exportId) return false;
  if (query.migrationPlanId !== undefined && event.target.migrationPlanId !== query.migrationPlanId) return false;
  if (query.actorId !== undefined && event.actor.id !== query.actorId) return false;
  if (query.types !== undefined && !query.types.includes(event.type)) return false;
  if (query.severities !== undefined && !query.severities.includes(event.severity)) return false;
  if (query.source !== undefined && event.source !== query.source) return false;
  if (query.createdFrom !== undefined && event.createdAt < query.createdFrom) return false;
  if (query.createdTo !== undefined && event.createdAt > query.createdTo) return false;
  return true;
}

function compareAuditEventsDesc(left: AuditEventRecord, right: AuditEventRecord): number {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
  return byCreatedAt === 0 ? String(right.id).localeCompare(String(left.id)) : byCreatedAt;
}

function sanitizeAuditPayload(payload: AppendAuditEventRequest["payload"]): AppendAuditEventRequest["payload"] {
  return sanitizeAuditValue(payload) as AppendAuditEventRequest["payload"];
}

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (isSensitiveAuditPayloadKey(key)) {
      continue;
    }
    sanitized[key] = sanitizeAuditValue(childValue);
  }
  return sanitized;
}

function isSensitiveAuditPayloadKey(key: string): boolean {
  return [
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
  ].includes(key);
}

function collectAnswerFieldCount(schema: LabelHubSchema): number {
  return collectSchemaNodes(schema).filter(isAnswerFieldNode).length;
}

function inferAiAssistType(nodeId: string | undefined): AiAssistType {
  const normalized = nodeId?.toLowerCase() ?? "";
  if (normalized.includes("summary")) return "SUMMARY";
  if (normalized.includes("category") || normalized.includes("classification")) return "CLASSIFICATION";
  if (normalized.includes("quality") || normalized.includes("check")) return "QUALITY_CHECK";
  return "REWRITE";
}

function latencyForAiAssistType(assistType: AiAssistType): number {
  if (assistType === "SUMMARY") return 420;
  if (assistType === "CLASSIFICATION") return 650;
  if (assistType === "QUALITY_CHECK") return 800;
  return 650;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function listMarketplaceTasks(): Task[] {
  return mockDb.tasks.filter((task) => task.status === "PUBLISHED");
}

export function getTask(taskId: string): Task | undefined {
  return mockDb.tasks.find((task) => task.id === taskId) ?? createRestoredDraftTask(taskId);
}

export function getSchemaDraft(taskId: string): LabelHubSchema | undefined {
  const draft = mockDb.schemaDrafts.find((item) => item.meta.taskId === taskId);
  if (draft !== undefined) {
    return draft;
  }

  const task = getTask(taskId);
  return task === undefined ? undefined : createSchemaDraftForTask(task);
}

export function createTask(input: Pick<Task, "title" | "description"> & Partial<Task>): Task {
  const task: Task = {
    id: input.id ?? nextId("task"),
    title: input.title,
    description: input.description,
    tags: input.tags ?? [],
    quota: input.quota ?? { total: 100 },
    distributionStrategy: input.distributionStrategy ?? { type: "FIRST_COME_FIRST_SERVED" },
    reviewPolicy: input.reviewPolicy ?? { type: "SINGLE_REVIEW" },
    status: "DRAFT",
    ownerId: input.ownerId ?? "usr_owner",
    createdAt: now(),
    updatedAt: now(),
  };
  if (input.instructionRichText !== undefined) task.instructionRichText = input.instructionRichText;
  if (input.rewardRule !== undefined) task.rewardRule = input.rewardRule;
  if (input.deadlineAt !== undefined) task.deadlineAt = input.deadlineAt;
  if (input.activeSchemaVersionId !== undefined) task.activeSchemaVersionId = input.activeSchemaVersionId;
  mockDb.tasks.push(task);
  createSchemaDraftForTask(task);
  return task;
}

function createRestoredDraftTask(taskId: string): Task | undefined {
  if (!/^task_\d+$/.test(taskId)) {
    return undefined;
  }

  return createTask({
    id: taskId as Task["id"],
    title: "新建任务草稿",
    description: "这是 Mock 环境根据动态路由恢复的任务草稿。",
  });
}

function createSchemaDraftForTask(task: Task): LabelHubSchema {
  const existing = mockDb.schemaDrafts.find((item) => item.meta.taskId === task.id);
  if (existing !== undefined) {
    return existing;
  }

  const source = clone(newsQualitySchemaDraft);
  const createdAt = now();
  const draft: LabelHubSchema = {
    ...source,
    schemaId: createSchemaId(task.id),
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      ...source.meta,
      name: `${task.title}模板`,
      description: task.description,
      taskId: task.id as LabelHubSchema["meta"]["taskId"],
      authorId: task.ownerId,
      createdAt,
      updatedAt: createdAt,
    },
  };
  mockDb.schemaDrafts.push(draft);
  return draft;
}

function createSchemaId(taskId: string): LabelHubSchema["schemaId"] {
  return `schema_${taskId.replace(/^task_/, "")}` as LabelHubSchema["schemaId"];
}

export function saveSchemaDraft(taskId: string, schema: LabelHubSchema): SaveSchemaDraftResponse {
  const previous = mockDb.schemaDrafts.find((item) => item.meta.taskId === taskId);
  const revision = (previous?.schemaDraftRevision ?? 0) + 1;
  const { schemaVersionId: _schemaVersionId, schemaVersionNo: _schemaVersionNo, ...schemaWithoutVersion } = schema;
  void _schemaVersionId;
  void _schemaVersionNo;
  const nextSchema: LabelHubSchema = {
    ...schemaWithoutVersion,
    status: "DRAFT",
    schemaDraftRevision: revision,
    meta: {
      ...schema.meta,
      taskId: taskId as LabelHubSchema["meta"]["taskId"],
      updatedAt: now(),
    },
  };
  mockDb.schemaDrafts = mockDb.schemaDrafts.filter((item) => item.meta.taskId !== taskId);
  mockDb.schemaDrafts.push(nextSchema);
  return {
    schema: nextSchema,
    schemaDraftRevision: revision,
    validation: validateSchema(nextSchema),
    auditLog: audit("SCHEMA_DRAFT_SAVED"),
  };
}

export function validateSchema(schema: unknown): SchemaValidationResult {
  const violations = validateSchemaInvariants(schema);
  return {
    valid: violations.length === 0,
    errors: violations.map((violation) => {
      const error = {
        path: violation.fieldName ?? violation.nodeId ?? "$",
        code: violation.code,
        message: violation.message,
      };
      return violation.nodeId === undefined ? error : { ...error, nodeId: violation.nodeId };
    }),
    warnings: [],
  };
}

export function generateSchema(taskId: string, taskDescription: string): GenerateSchemaResponse {
  const source = mockDb.schemaDrafts.find((schema) => schema.meta.taskId === taskId) ?? newsQualitySchemaDraft;
  const clonedSource = clone(source);
  const { schemaVersionId: _schemaVersionId, schemaVersionNo: _schemaVersionNo, ...sourceWithoutVersion } = clonedSource;
  void _schemaVersionId;
  void _schemaVersionNo;
  const schemaDraft: LabelHubSchema = {
    ...sourceWithoutVersion,
    status: "DRAFT",
    schemaDraftRevision: (source.schemaDraftRevision ?? 0) + 1,
    meta: {
      ...source.meta,
      description: taskDescription,
      updatedAt: now(),
    },
  };
  const validation = validateSchema(schemaDraft);
  return {
    schemaDraft,
    validation,
    warnings: validation.warnings,
    generatedBy: {
      modelPolicyId: "mock-schema-generator",
      promptSnapshotHash: "mock_prompt_schema_generation",
      llmCallId: nextId("llm"),
    },
  };
}

export function publishSchema(taskId: string): SchemaVersion | undefined {
  const draft = mockDb.schemaDrafts.find((schema) => schema.meta.taskId === taskId);
  if (draft === undefined) return undefined;
  const versionNo = mockDb.schemaVersions.filter((item) => item.taskId === taskId).length + 1;
  const schemaVersionId = nextId("sv");
  const snapshot: PublishedLabelHubSchema = {
    ...clone(draft),
    schemaVersionId,
    schemaVersionNo: versionNo,
    status: "PUBLISHED",
    meta: {
      ...draft.meta,
      publishedAt: now(),
      updatedAt: now(),
    },
  };
  const schemaVersion: SchemaVersion = {
    id: schemaVersionId,
    schemaId: draft.schemaId,
    taskId: taskId as SchemaVersion["taskId"],
    schemaVersionNo: versionNo,
    contractVersion: "1.1",
    snapshot,
    createdAt: now(),
  };
  mockDb.schemaVersions.push(schemaVersion);
  return schemaVersion;
}

export function publishTask(taskId: string, schemaVersionId: string): Task | undefined {
  const task = getTask(taskId);
  const schemaVersion = mockDb.schemaVersions.find((item) => item.id === schemaVersionId && item.taskId === taskId);
  if (task === undefined || schemaVersion === undefined || task.status !== "DRAFT") return undefined;
  task.status = "PUBLISHED";
  task.activeSchemaVersionId = schemaVersion.id;
  task.updatedAt = now();
  return task;
}

export function importDataset(taskId: string, fileId: string): ImportDatasetResponse | undefined {
  const file = mockDb.files.find((item) => item.id === fileId);
  if (file === undefined || file.status !== "READY" || file.purpose !== "DATASET_IMPORT") return undefined;
  const item: DatasetItem = {
    id: nextId("item"),
    taskId: taskId as DatasetItem["taskId"],
    externalKey: `mock-import-${Date.now()}`,
    sourcePayload: {
      title: "导入的模拟新闻标题",
      body: "这是一条通过 mock dataset import 创建的新闻正文。",
      source: "Mock Import",
    },
    status: "AVAILABLE",
    createdAt: now(),
    updatedAt: now(),
  };
  mockDb.datasetItems.push(item);
  return {
    taskId: taskId as ImportDatasetResponse["taskId"],
    importedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    previewItems: [item],
    auditLog: audit("DATASET_IMPORTED"),
  };
}

export function claimTask(taskId: string): ClaimTaskResponse | undefined {
  const task = getTask(taskId);
  if (task === undefined || task.status !== "PUBLISHED" || task.activeSchemaVersionId === undefined) return undefined;
  const existingAssignment = mockDb.assignments.find(
    (candidate) =>
      candidate.taskId === taskId &&
      candidate.labelerId === "usr_labeler" &&
      ["CLAIMED", "DRAFTING", "RETURNED"].includes(candidate.status),
  );
  if (existingAssignment !== undefined) {
    return {
      context: buildAssignmentContext(existingAssignment),
      auditLog: audit("ASSIGNMENT_CLAIMED"),
    };
  }
  const item = mockDb.datasetItems.find((candidate) => candidate.taskId === taskId && candidate.status === "AVAILABLE");
  const schemaVersion = mockDb.schemaVersions.find((candidate) => candidate.id === task.activeSchemaVersionId);
  if (item === undefined || schemaVersion === undefined) return undefined;
  const assignment: Assignment = {
    id: nextId("asn"),
    taskId: task.id,
    itemId: item.id,
    labelerId: "usr_labeler",
    schemaVersionId: schemaVersion.id,
    status: "CLAIMED",
    lockedUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: now(),
    updatedAt: now(),
  };
  item.status = "LOCKED";
  item.currentAssignmentId = assignment.id;
  item.updatedAt = now();
  mockDb.assignments.push(assignment);
  return {
    context: buildAssignmentContext(assignment),
    auditLog: audit("ASSIGNMENT_CLAIMED"),
  };
}

export function getAssignmentContext(assignmentId: string): AssignmentContextResponse | undefined {
  const assignment = mockDb.assignments.find((item) => item.id === assignmentId);
  return assignment === undefined ? undefined : buildAssignmentContext(assignment);
}

export function listAssignmentDatasetItems(assignmentId: string): DatasetItem[] {
  const assignment = mockDb.assignments.find((item) => item.id === assignmentId);
  if (assignment === undefined) return [];
  return mockDb.datasetItems.filter((item) => item.taskId === assignment.taskId);
}

export function saveDraft(assignmentId: string, answers: AnswerPayload, clientRevision: number): SaveDraftResponse | undefined {
  const assignment = mockDb.assignments.find((item) => item.id === assignmentId);
  if (assignment === undefined || !["CLAIMED", "DRAFTING", "RETURNED"].includes(assignment.status)) return undefined;
  assignment.status = "DRAFTING";
  assignment.updatedAt = now();
  const existing = mockDb.drafts.find((draft) => draft.assignmentId === assignmentId);
  const draft: Draft = {
    assignmentId: assignment.id,
    schemaVersionId: assignment.schemaVersionId,
    answers,
    clientRevision,
    serverRevision: (existing?.serverRevision ?? 0) + 1,
    savedAt: now(),
  };
  mockDb.drafts = mockDb.drafts.filter((item) => item.assignmentId !== assignmentId);
  mockDb.drafts.push(draft);
  return {
    draft,
    assignment,
    validation: validateAnswers(assignment, answers),
    auditLog: audit("DRAFT_SAVED"),
  };
}

export function submitAssignment(assignmentId: string, answers: AnswerPayload): SubmitAssignmentResponse | undefined {
  const assignment = mockDb.assignments.find((item) => item.id === assignmentId);
  if (assignment === undefined || !["CLAIMED", "DRAFTING", "RETURNED"].includes(assignment.status)) return undefined;
  const validation = validateAnswers(assignment, answers);
  if (!validation.valid) {
    return {
      submission: emptyRejectedSubmission(assignment, answers, validation),
      assignment,
      validation,
      nextStatus: "SUBMITTED",
      auditLog: audit("SUBMISSION_CREATED"),
    };
  }
  const attemptNo = mockDb.submissions.filter((submission) => submission.assignmentId === assignmentId).length + 1;
  const submission: Submission = {
    id: nextId("sub"),
    assignmentId: assignment.id,
    taskId: assignment.taskId,
    itemId: assignment.itemId,
    labelerId: assignment.labelerId,
    schemaVersionId: assignment.schemaVersionId,
    attemptNo,
    answers,
    status: "SUBMITTED",
    validationSnapshot: validation,
    createdAt: now(),
    updatedAt: now(),
  };
  const aiJob: AIReviewJob = createAIReviewJob(submission);
  assignment.status = "SUBMITTED";
  assignment.latestSubmissionId = submission.id;
  assignment.updatedAt = now();
  mockDb.submissions.push(submission);
  mockDb.aiReviewJobs.push(aiJob);
  simulateAIReview(submission.id, aiJob.id);
  return {
    submission,
    assignment,
    validation,
    nextStatus: submission.status,
    aiJob: toAIReviewJobSummary(aiJob),
    auditLog: audit("SUBMISSION_CREATED"),
  };
}

export function callLLMAssist(request: LLMAssistMockRequest = {}): LLMRuntimeResponse {
  const assistType = inferAiAssistType(request.nodeId);
  return {
    output: {
      summary: "建议检查新闻来源是否充分，并补充事实依据。",
    },
    suggestedPatch: {
      rewriteSuggestion: "建议补充统计口径、来源链接和第三方证据。",
    },
    callId: nextId("llm"),
    promptVersionId: AI_ASSIST_PROMPT_VERSION_ID,
    modelId: AI_ASSIST_MODEL_ID,
    assistType,
    latencyMs: latencyForAiAssistType(assistType),
  };
}

export function listMySubmissions(): Submission[] {
  return mockDb.submissions.filter((submission) => submission.labelerId === "usr_labeler");
}

export function listReviewQueue(): Submission[] {
  return mockDb.submissions.filter((submission) => ["AI_PASSED", "NEEDS_HUMAN_REVIEW", "HUMAN_REVIEWING", "FINAL_REVIEWING"].includes(submission.status));
}

export function getReviewDetail(submissionId: string): ReviewDetailResponse | undefined {
  const submission = mockDb.submissions.find((item) => item.id === submissionId);
  if (submission === undefined) return undefined;
  const task = getTask(submission.taskId);
  const item = mockDb.datasetItems.find((candidate) => candidate.id === submission.itemId);
  const schemaVersion = mockDb.schemaVersions.find((candidate) => candidate.id === submission.schemaVersionId);
  if (task === undefined || item === undefined || schemaVersion === undefined) return undefined;
  const history = mockDb.reviewResults.filter((result) => result.submissionId === submissionId);
  const aiResult = history.find((result): result is AIReviewResultRecord => result.stage === "AI_PRECHECK");
  const detail: ReviewDetailResponse = {
    submission,
    task,
    item,
    schemaVersionId: schemaVersion.id,
    schema: schemaVersion.snapshot,
    history,
    auditLogs: [],
  };
  if (aiResult !== undefined) detail.aiResult = aiResult;
  return detail;
}

export function claimReview(submissionId: string): Submission | undefined {
  const submission = mockDb.submissions.find((item) => item.id === submissionId);
  if (submission === undefined || !["AI_PASSED", "NEEDS_HUMAN_REVIEW"].includes(submission.status)) return undefined;
  submission.status = "HUMAN_REVIEWING";
  submission.updatedAt = now();
  return submission;
}

export function decideReview(command: ReviewCommand): ReviewDecisionResponse | undefined {
  const submission = mockDb.submissions.find((item) => item.id === command.submissionId);
  if (submission === undefined || !["HUMAN_REVIEWING", "FINAL_REVIEWING"].includes(submission.status)) return undefined;
  if (command.decision === "RETURN" && command.reason === undefined) return undefined;
  const task = getTask(submission.taskId);
  const assignment = mockDb.assignments.find((item) => item.id === submission.assignmentId);
  const item = mockDb.datasetItems.find((candidate) => candidate.id === submission.itemId);
  if (task === undefined || assignment === undefined || item === undefined) return undefined;

  if (command.decision === "PASS") {
    if (task.reviewPolicy.type === "DOUBLE_REVIEW" && command.stage === "HUMAN_REVIEW") {
      submission.status = "FINAL_REVIEWING";
    } else {
      submission.status = "ACCEPTED";
      assignment.status = "ACCEPTED";
      item.status = "COMPLETED";
    }
  }
  if (command.decision === "RETURN") {
    submission.status = "RETURNED";
    assignment.status = "RETURNED";
  }
  if (command.decision === "REJECT") {
    submission.status = "REJECTED";
    assignment.status = "CANCELED";
    item.status = "DISABLED";
  }

  submission.updatedAt = now();
  assignment.updatedAt = now();
  item.updatedAt = now();

  const baseReviewResult = {
    id: nextId("rev"),
    submissionId: submission.id,
    schemaVersionId: submission.schemaVersionId,
    decision: command.decision,
    actor: {
      id: "usr_reviewer" as const,
      role: "REVIEWER" as const,
      displayName: "审核员",
    },
    createdAt: now(),
  };
  const reviewResult: HumanReviewResultRecord | FinalReviewResultRecord =
    command.stage === "FINAL_REVIEW"
      ? { ...baseReviewResult, stage: "FINAL_REVIEW" }
      : { ...baseReviewResult, stage: "HUMAN_REVIEW" };
  if (command.comments !== undefined) reviewResult.comments = command.comments;
  if (command.patches !== undefined) reviewResult.patches = command.patches;
  mockDb.reviewResults.push(reviewResult);
  return {
    submission,
    reviewResult,
    auditLog: audit(command.decision === "PASS" ? "REVIEW_ACCEPTED" : command.decision === "RETURN" ? "REVIEW_RETURNED" : "REVIEW_REJECTED"),
  };
}

export function batchDecideReview(commands: ReviewCommand[]): BatchReviewResponse {
  return {
    results: commands.map((command) => {
      const result = decideReview(command);
      return result === undefined
        ? {
            submissionId: command.submissionId,
            success: false,
            error: {
              code: "INVALID_STATE_TRANSITION",
              message: "审核状态不允许当前操作",
              traceId: `trace_${Date.now()}`,
            },
          }
        : {
            submissionId: command.submissionId,
            success: true,
            submission: result.submission,
            reviewResult: result.reviewResult,
          };
    }),
  };
}

export function createExport(taskId: string, mapping: ExportMapping): ExportJob {
  const exportJob: ExportJob = {
    id: nextId("job"),
    taskId: taskId as ExportJob["taskId"],
    schemaVersionId: mapping.schemaVersionId,
    status: "PENDING",
    mapping,
    progress: {
      total: mockDb.submissions.filter((submission) => submission.taskId === taskId && submission.status === "ACCEPTED").length,
      done: 0,
    },
    createdBy: "usr_owner",
    createdAt: now(),
  };
  mockDb.exportJobs.push(exportJob);
  globalThis.setTimeout(() => {
    exportJob.status = "RUNNING";
    exportJob.progress.done = Math.floor(exportJob.progress.total / 2);
  }, 300);
  globalThis.setTimeout(() => {
    const file: FileObject = {
      id: nextId("file"),
      ownerId: exportJob.id,
      ownerType: "EXPORT_JOB",
      purpose: "EXPORT_RESULT",
      mimeType: "application/jsonl",
      size: 1024,
      storageKey: `${exportJob.id}/result.jsonl`,
      status: "READY",
      createdAt: now(),
      confirmedAt: now(),
    };
    mockDb.files.push(file);
    exportJob.status = "SUCCEEDED";
    exportJob.progress.done = exportJob.progress.total;
    exportJob.fileId = file.id;
    exportJob.finishedAt = now();
  }, 900);
  return exportJob;
}

export function createUploadFile(input: Pick<FileObject, "mimeType" | "size" | "purpose" | "ownerType" | "ownerId">): FileObject {
  const file: FileObject = {
    id: nextId("file"),
    ownerId: input.ownerId,
    ownerType: input.ownerType,
    purpose: input.purpose,
    mimeType: input.mimeType,
    size: input.size,
    storageKey: `${input.ownerId}/${Date.now()}`,
    status: "UPLOADING",
    createdAt: now(),
  };
  mockDb.files.push(file);
  return file;
}

export function confirmFile(fileId: string): FileObject | undefined {
  const file = mockDb.files.find((item) => item.id === fileId);
  if (file === undefined) return undefined;
  file.status = "READY";
  file.confirmedAt = now();
  return file;
}

function buildAssignmentContext(assignment: Assignment): AssignmentContextResponse {
  const task = required(mockDb.tasks.find((item) => item.id === assignment.taskId));
  const item = required(mockDb.datasetItems.find((candidate) => candidate.id === assignment.itemId));
  const schemaVersion = required(mockDb.schemaVersions.find((candidate) => candidate.id === assignment.schemaVersionId));
  const context: AssignmentContextResponse = {
    assignment,
    task,
    item,
    schemaVersionId: schemaVersion.id,
    schema: schemaVersion.snapshot,
  };
  const draft = mockDb.drafts.find((candidate) => candidate.assignmentId === assignment.id);
  const lastReturnReason = mockDb.reviewResults.filter((result) => result.submissionId === assignment.latestSubmissionId).at(-1);
  if (draft !== undefined) context.draft = draft;
  if (lastReturnReason !== undefined) context.lastReturnReason = lastReturnReason;
  return context;
}

function validateAnswers(assignment: Assignment, answers: AnswerPayload): ValidationResult {
  const schemaVersion = mockDb.schemaVersions.find((item) => item.id === assignment.schemaVersionId);
  const item = mockDb.datasetItems.find((candidate) => candidate.id === assignment.itemId);
  const task = mockDb.tasks.find((candidate) => candidate.id === assignment.taskId);
  if (schemaVersion === undefined || item === undefined || task === undefined) {
    return { valid: false, errors: [], warnings: [] };
  }
  const context: LabelHubRuntimeContext = {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      activeSchemaVersionId: schemaVersion.id,
    },
    schema: {
      schemaId: schemaVersion.schemaId,
      schemaVersionId: schemaVersion.id,
      schemaVersionNo: schemaVersion.schemaVersionNo,
      contractVersion: "1.1",
    },
    item: {
      id: item.id,
      sourcePayload: item.sourcePayload,
    },
    answers,
    system: {
      actor: {
        id: assignment.labelerId,
        role: "LABELER",
        displayName: "标注员",
      },
      role: "LABELER",
      now: now(),
    },
  };
  if (item.externalKey !== undefined) {
    context.item.externalKey = item.externalKey;
  }
  const normalized = normalizeAnswers(schemaVersion.snapshot, answers, context);
  const requiredErrors = validateRequiredFields(schemaVersion.snapshot, normalized.answers, context);
  return {
    valid: normalized.errors.length === 0 && requiredErrors.length === 0,
    errors: [...normalized.errors, ...requiredErrors],
    warnings: [],
  };
}

function emptyRejectedSubmission(assignment: Assignment, answers: AnswerPayload, validation: ValidationResult): Submission {
  return {
    id: nextId("sub"),
    assignmentId: assignment.id,
    taskId: assignment.taskId,
    itemId: assignment.itemId,
    labelerId: assignment.labelerId,
    schemaVersionId: assignment.schemaVersionId,
    attemptNo: 0,
    answers,
    status: "SUBMITTED",
    validationSnapshot: validation,
    createdAt: now(),
    updatedAt: now(),
  };
}

function createAIReviewJob(submission: Submission): AIReviewJob {
  return {
    id: nextId("job"),
    submissionId: submission.id,
    attemptNo: submission.attemptNo,
    schemaVersionId: submission.schemaVersionId,
    status: "PENDING",
    retryCount: 0,
    maxRetries: 3,
    idempotencyKey: `${submission.id}:${submission.attemptNo}`,
    promptSnapshotHash: "mock_prompt_ai_review",
    modelSnapshot: {
      provider: "mock",
      model: "mock-reviewer",
      responseFormat: "JSON_SCHEMA",
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function simulateAIReview(submissionId: string, jobId: string): void {
  globalThis.setTimeout(() => {
    const submission = mockDb.submissions.find((item) => item.id === submissionId);
    const job = mockDb.aiReviewJobs.find((item) => item.id === jobId);
    if (submission === undefined || job === undefined) return;
    submission.status = "AI_REVIEWING";
    submission.updatedAt = now();
    job.status = "RUNNING";
    job.updatedAt = now();
  }, 300);
  globalThis.setTimeout(() => {
    const submission = mockDb.submissions.find((item) => item.id === submissionId);
    const job = mockDb.aiReviewJobs.find((item) => item.id === jobId);
    if (submission === undefined || job === undefined) return;
    const score = submission.answers.qualityScore;
    const needHuman = score === "1" || score === "2";
    submission.status = needHuman ? "NEEDS_HUMAN_REVIEW" : "AI_PASSED";
    submission.updatedAt = now();
    job.status = "SUCCEEDED";
    job.updatedAt = now();
    const aiResult: AIReviewResultRecord = {
      id: nextId("rev"),
      submissionId: submission.id,
      schemaVersionId: submission.schemaVersionId,
      stage: "AI_PRECHECK",
      decision: needHuman ? "NEED_HUMAN_REVIEW" : "PASS",
      actor: {
        id: "usr_system",
        role: "SYSTEM",
        displayName: "AI Review Agent",
      },
      aiResult: {
        decision: needHuman ? "NEED_HUMAN_REVIEW" : "PASS",
        totalScore: needHuman ? 65 : 92,
        dimensionScores: [
          {
            key: "format",
            score: needHuman ? 65 : 95,
            reason: needHuman ? "需要人工复核低分样本" : "格式满足要求",
          },
        ],
        fieldIssues: needHuman
          ? [
              {
                fieldName: "qualityScore",
                severity: "MEDIUM",
                message: "低分样本建议人工复核",
              },
            ]
          : [],
        summary: needHuman ? "建议人工复核" : "AI 预审通过",
        confidence: needHuman ? 0.72 : 0.93,
      },
      createdAt: now(),
    };
    mockDb.reviewResults.push(aiResult);
  }, 900);
}

function toAIReviewJobSummary(job: AIReviewJob): AIReviewJobSummary {
  return {
    id: job.id,
    submissionId: job.submissionId,
    attemptNo: job.attemptNo,
    schemaVersionId: job.schemaVersionId,
    status: job.status,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("mock 数据状态不完整");
  }
  return value;
}

export function schemaHasUnknownNodeType(schema: unknown): boolean {
  return validateSchemaInvariants(schema).some((item) => item.code === "UNKNOWN_NODE_TYPE");
}

export function schemaHasDuplicateFieldName(schema: unknown): boolean {
  return validateSchemaInvariants(schema).some((item) => item.code === "FIELD_NAME_DUPLICATED");
}

export function getFieldNames(schema: LabelHubSchema): string[] {
  return collectSchemaNodes(schema)
    .filter(isAnswerFieldNode)
    .map((node) => node.name);
}
