import type {
  AIReviewResultRecord,
  AiAssistActionRecord,
  AiAssistActionRequest,
  AiAssistActionResponse,
  AiAssistPatchOperation,
  AiAssistSuggestion,
  AiAssistSuggestionStatus,
  AppendAuditEventRequest,
  AuditEventRecord,
  BatchReviewResponse,
  FinalReviewResultRecord,
  HumanReviewResultRecord,
  ReviewCommand,
  ReviewDecisionResponse,
  ReviewDetailResponse,
  Submission,
} from "@labelhub/contracts";
import { nextId, now } from "../mock-utils";
import { appendAuditEvent, audit } from "./audit";
import { mockDb } from "./state";
import { getTask } from "./task-schema";

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

// ---------------------------------------------------------------------------
// AI Assist 一键采纳闭环（mock，镜像后端 ai_assist_domain）
// 建议由 AI 预审 fieldIssues 派生（确定性 id aas_{submissionId}_{idx}），
// 动作持久化到 mockDb.aiAssistActions，并写富审计事件，供 Quality Center 读取。
// ---------------------------------------------------------------------------

const FROZEN_SUBMISSION_STATUSES = new Set(["ACCEPTED", "REJECTED"]);

const AI_ASSIST_MAIN_EVENT_TYPE = {
  accept: "AI_ASSIST_ACCEPTED",
  edit_accept: "AI_ASSIST_EDITED",
  dismiss: "AI_ASSIST_DISMISSED",
} as const;

const AI_ASSIST_SUCCESS_STATUS = {
  accept: "ACCEPTED",
  edit_accept: "EDIT_ACCEPTED",
  dismiss: "DISMISSED",
} as const;

function reviewerActor(): AuditEventRecord["actor"] {
  return { id: "usr_reviewer", role: "REVIEWER", displayName: "审核员" };
}

function latestAiAssistAction(suggestionId: string): AiAssistActionRecord | undefined {
  return mockDb.aiAssistActions
    .filter((action) => action.suggestionId === suggestionId)
    .slice()
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .at(0);
}

export function deriveAiAssistSuggestions(submissionId: string): AiAssistSuggestion[] {
  const submission = mockDb.submissions.find((item) => item.id === submissionId);
  if (submission === undefined) return [];
  const aiResult = mockDb.reviewResults
    .filter((result): result is AIReviewResultRecord => result.submissionId === submissionId && result.stage === "AI_PRECHECK")
    .at(-1);
  if (aiResult === undefined) return [];

  const fieldIssues = aiResult.aiResult.fieldIssues ?? [];
  const answers = submission.answers ?? {};
  return fieldIssues.map((issue, index) => {
    const suggestionId = `aas_${submissionId}_${index}`;
    const fieldName = issue.fieldName;
    const suggestionText = issue.suggestion;
    const summary =
      suggestionText !== undefined && suggestionText.length > 0
        ? `${issue.message}（建议：${suggestionText}）`
        : issue.message;

    const structuredPatch: AiAssistPatchOperation[] =
      fieldName !== undefined && fieldName.length > 0 && suggestionText !== undefined && suggestionText.length > 0
        ? [{ fieldName, previousValue: answers[fieldName], nextValue: suggestionText }]
        : [];

    const latest = latestAiAssistAction(suggestionId);
    const status: AiAssistSuggestionStatus = latest?.resultingStatus ?? "PENDING";

    const suggestion: AiAssistSuggestion = {
      id: suggestionId,
      submissionId,
      taskId: submission.taskId,
      itemId: submission.itemId,
      schemaVersionId: submission.schemaVersionId,
      severity: issue.severity,
      summary,
      structuredPatch,
      status,
      confidence: aiResult.aiResult.confidence,
      createdAt: aiResult.createdAt,
    };
    if (fieldName !== undefined) suggestion.fieldName = fieldName;
    if (latest !== undefined) suggestion.resolvedAt = latest.createdAt;
    return suggestion;
  });
}

export function applyAiAssistAction(
  submissionId: string,
  suggestionId: string,
  request: AiAssistActionRequest,
): AiAssistActionResponse | undefined | { error: "SUGGESTION_NOT_FOUND" } {
  const submission = mockDb.submissions.find((item) => item.id === submissionId);
  if (submission === undefined) return undefined;

  const suggestions = deriveAiAssistSuggestions(submissionId);
  const suggestion = suggestions.find((candidate) => candidate.id === suggestionId);
  if (suggestion === undefined) return { error: "SUGGESTION_NOT_FOUND" };

  const action = request.action;
  const actor = reviewerActor();
  const target: AppendAuditEventRequest["target"] = {
    entityType: "SUBMISSION",
    entityId: submission.id,
    taskId: submission.taskId,
    submissionId: submission.id,
    schemaVersionId: submission.schemaVersionId,
  };

  // 1) 确定补丁
  let ops: AiAssistPatchOperation[] = [];
  if (action === "accept") ops = suggestion.structuredPatch ?? [];
  else if (action === "edit_accept") ops = request.editedPatch ?? [];

  // 2) 尝试应用补丁
  let patchApplied: boolean | undefined;
  let appliedFieldNames: string[] | undefined;
  let patchFailureReason: string | undefined;
  let resultingStatus: AiAssistSuggestionStatus = AI_ASSIST_SUCCESS_STATUS[action];

  if ((action === "accept" || action === "edit_accept") && ops.length > 0) {
    if (FROZEN_SUBMISSION_STATUSES.has(submission.status)) {
      patchApplied = false;
      patchFailureReason = "提交已进入终态，答案已冻结，无法应用 AI 修订。";
      resultingStatus = "APPLY_FAILED";
    } else {
      const nextAnswers: Record<string, unknown> = { ...submission.answers };
      const applied: string[] = [];
      for (const op of ops) {
        if (op.nextValue === undefined) delete nextAnswers[op.fieldName];
        else nextAnswers[op.fieldName] = op.nextValue;
        applied.push(op.fieldName);
      }
      submission.answers = nextAnswers;
      submission.updatedAt = now();
      appliedFieldNames = [...new Set(applied)].sort();
      patchApplied = true;
    }
  }

  // 3) 保存动作记录
  const createdAt = now();
  const record: AiAssistActionRecord = {
    id: nextId("audit").replace("audit", "aaa"),
    suggestionId,
    submissionId,
    action,
    resultingStatus,
    actor,
    createdAt,
  };
  if (appliedFieldNames !== undefined) record.appliedPatchFieldNames = appliedFieldNames;
  if (patchApplied !== undefined) record.patchApplied = patchApplied;
  if (patchFailureReason !== undefined) record.patchFailureReason = patchFailureReason;
  if (request.comment !== undefined && request.comment.length > 0) record.comment = request.comment;
  mockDb.aiAssistActions.push(record);

  // 4) 主审计事件
  const mainEventType = AI_ASSIST_MAIN_EVENT_TYPE[action];
  appendAuditEvent({
    type: mainEventType,
    severity: "INFO",
    source: "API",
    actor,
    target,
    payload: {
      suggestionId,
      submissionId,
      action,
      summary: suggestion.summary,
    },
    idempotencyKey: `AI_ASSIST_ACTION:${record.id}:MAIN`,
  });

  // 5) 补丁结果审计事件（不静默）
  if (patchApplied === true) {
    appendAuditEvent({
      type: "AI_ASSIST_PATCH_APPLIED",
      severity: "INFO",
      source: "API",
      actor,
      target,
      payload: {
        suggestionId,
        submissionId,
        action,
        patchApplied: true,
        appliedPatchFieldNames: appliedFieldNames ?? [],
        summary: "AI 修订已应用",
      },
      idempotencyKey: `AI_ASSIST_ACTION:${record.id}:PATCH`,
    });
  } else if (patchApplied === false) {
    appendAuditEvent({
      type: "AI_ASSIST_PATCH_FAILED",
      severity: "WARNING",
      source: "API",
      actor,
      target,
      payload: {
        suggestionId,
        submissionId,
        action,
        patchApplied: false,
        patchFailureReason,
        summary: "AI 修订应用失败",
      },
      idempotencyKey: `AI_ASSIST_ACTION:${record.id}:PATCH`,
    });
  }

  const updatedSuggestion: AiAssistSuggestion = {
    ...suggestion,
    status: resultingStatus,
    resolvedAt: createdAt,
  };

  return {
    suggestion: updatedSuggestion,
    action: record,
    auditEventType: mainEventType,
  };
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
  if (submission === undefined || !isReviewDecisionAllowed(submission.status, command.stage)) return undefined;
  // 与后端对齐：RETURN / REJECT 必须有非空 reason（含批量决策路径，不经 http handler 校验）。
  // 取代此前仅判 undefined 的弱校验，空串 / 纯空白也视为缺失。
  if ((command.decision === "RETURN" || command.decision === "REJECT") && (command.reason ?? "").trim() === "") return undefined;
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
    item.status = "AVAILABLE";
    delete item.currentAssignmentId;
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
  const auditAction =
    command.decision === "PASS"
      ? task.reviewPolicy.type === "DOUBLE_REVIEW" && command.stage === "HUMAN_REVIEW"
        ? "FINAL_REVIEW_REQUESTED"
        : "REVIEW_ACCEPTED"
      : command.decision === "RETURN"
        ? "REVIEW_RETURNED"
        : "REVIEW_REJECTED";
  return {
    submission,
    reviewResult,
    auditLog: audit(auditAction),
  };
}

function isReviewDecisionAllowed(status: Submission["status"], stage: ReviewCommand["stage"]): boolean {
  if (stage === "FINAL_REVIEW") return status === "FINAL_REVIEWING";
  return ["AI_PASSED", "NEEDS_HUMAN_REVIEW", "HUMAN_REVIEWING"].includes(status);
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
