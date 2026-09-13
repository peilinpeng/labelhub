import type {
  AIReviewJob,
  AIReviewJobSummary,
  AIReviewResultRecord,
  AiAssistType,
  AnswerPayload,
  Assignment,
  AssignmentContextResponse,
  ClaimTaskResponse,
  DatasetItem,
  Draft,
  ImportDatasetResponse,
  LabelHubRuntimeContext,
  LLMRuntimeResponse,
  SaveDraftResponse,
  Submission,
  SubmitAssignmentResponse,
  ValidationResult,
} from "@labelhub/contracts";
import { normalizeAnswers, validateRequiredFields } from "@labelhub/contracts";
import { getMockPromptSnapshot, hashPromptSnapshot } from "../ai-prompt-registry";
import { hashCanonicalJson } from "../hash-utils";
import { nextId, now } from "../mock-utils";
import { audit } from "./audit";
import { mockDb, type LLMAssistMockRequest } from "./state";
import { getTask } from "./task-schema";

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
  const item = mockDb.datasetItems.find((candidate) => candidate.id === assignment.itemId);
  return item === undefined ? [] : [item];
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

export async function callLLMAssist(request: LLMAssistMockRequest = {}): Promise<LLMRuntimeResponse> {
  const assistType = inferAiAssistType(request.nodeId);
  const promptSnapshot = getMockPromptSnapshot(assistType);
  const output = {
    summary: "建议检查新闻来源是否充分，并补充事实依据。",
  };
  // 同时建议低质量评分（"1"），触发 R-low-quality-requires-note 联动：
  // mock 响应同步给出事实核查说明，走现有 preflight 校验通过完整 patch。
  const suggestedPatch = {
    rewriteSuggestion: "建议补充统计口径、来源链接和第三方证据。",
    qualityScore: "1",
    factCheckNote: "AI 判断该样本来源不足，需补充统计口径、来源链接和第三方佐证后再通过审核。",
  };
  const callId = nextId("llm");
  const [promptSnapshotHash, outputHash] = await Promise.all([
    hashPromptSnapshot(promptSnapshot),
    hashCanonicalJson({
      kind: "LLM_ASSIST_OUTPUT",
      canonicalSerializationVersion: "canonical-json-v1",
      callId,
      output,
      suggestedPatch,
    }),
  ]);
  const response: LLMRuntimeResponse = {
    output,
    suggestedPatch,
    callId,
    promptVersionId: promptSnapshot.promptVersionId,
    modelId: promptSnapshot.modelId,
    assistType: promptSnapshot.assistType,
    latencyMs: latencyForAiAssistType(assistType),
  };
  if (promptSnapshotHash !== undefined) response.promptSnapshotHash = promptSnapshotHash;
  if (outputHash !== undefined) response.outputHash = outputHash;
  return response;
}

export function listMySubmissions(): Submission[] {
  return mockDb.submissions.filter((submission) => submission.labelerId === "usr_labeler");
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
