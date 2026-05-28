import { equal, ok } from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  AIReviewJob,
  AIReviewJobStatus,
  Assignment,
  AssignmentStatus,
  DatasetItem,
  DatasetItemStatus,
  ExportJob,
  ExportJobStatus,
  ExportMapping,
  FileObject,
  FileStatus,
  ID,
  ReviewPolicy,
  Submission,
  SubmissionStatus,
  Task,
  TaskStatus,
} from "@labelhub/contracts";
import {
  acceptAssignment,
  aiReviewOutputCanModifyAnswers,
  archiveTask,
  assertDatasetImportFileReady,
  assertExportDownloadFileReady,
  assertExportMappingAllowed,
  assertSubmissionCanEnterExportPool,
  cancelExportJob,
  claimAssignment,
  claimItem,
  completeItem,
  confirmUpload,
  createExportJob,
  createTask,
  createUploadUrl,
  decideHumanReview,
  failUpload,
  finalReviewPass,
  humanReviewPass,
  humanReviewReject,
  humanReviewReturn,
  markExportSucceeded,
  markUploadStarted,
  publishTask,
  retryAIReviewJob,
  saveDraft,
  startAIReviewJob,
  startExportJob,
  submitAssignment,
} from "../index.ts";

const now = "2026-05-25T00:00:00.000Z";
const singleReview: ReviewPolicy = { type: "SINGLE_REVIEW" };
const doubleReview: ReviewPolicy = { type: "DOUBLE_REVIEW", requireFinalReview: true };

describe("Assignment 状态机", () => {
  test("合法 claim / saveDraft / submit 会返回状态与 auditAction", () => {
    const claimed = claimAssignment(makeAssignment("CLAIMED"));
    equal(claimed.ok, true);
    if (claimed.ok) {
      equal(claimed.nextStatus, "CLAIMED");
      equal(claimed.auditAction, "ASSIGNMENT_CLAIMED");
    }

    const drafted = saveDraft(makeAssignment("CLAIMED"));
    equal(drafted.ok, true);
    if (drafted.ok) {
      equal(drafted.previousStatus, "CLAIMED");
      equal(drafted.nextStatus, "DRAFTING");
      equal(drafted.auditAction, "DRAFT_SAVED");
    }

    const submitted = submitAssignment(makeAssignment("DRAFTING"));
    equal(submitted.ok, true);
    if (submitted.ok) {
      equal(submitted.nextStatus, "SUBMITTED");
      equal(submitted.auditAction, "SUBMISSION_CREATED");
      equal(submitted.sideEffects.some((effect) => effect.type === "CREATE_SUBMISSION"), true);
    }
  });

  test("Assignment 已 submit 后不能再次 submit", () => {
    const result = submitAssignment(makeAssignment("SUBMITTED"));
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "INVALID_STATE_TRANSITION");
    }
  });

  test("每个成功迁移都有 auditAction", () => {
    const results = [
      claimAssignment(makeAssignment("CLAIMED")),
      saveDraft(makeAssignment("CLAIMED")),
      submitAssignment(makeAssignment("DRAFTING")),
      acceptAssignment(makeAssignment("SUBMITTED")),
    ];

    for (const result of results) {
      equal(result.ok, true);
      if (result.ok) {
        ok(result.auditAction.length > 0);
      }
    }
  });
});

describe("Submission 与 Review 状态机", () => {
  test("RETURN 必须带 reason", () => {
    const result = humanReviewReturn(makeSubmission("HUMAN_REVIEWING"));
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "REVIEW_REASON_REQUIRED");
    }
  });

  test("REJECT 必须带 reason", () => {
    const result = humanReviewReject(makeSubmission("HUMAN_REVIEWING"));
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "REVIEW_REASON_REQUIRED");
    }
  });

  test("人工审核不能提交 NEED_HUMAN_REVIEW", () => {
    const result = decideHumanReview({
      submission: makeSubmission("HUMAN_REVIEWING"),
      decision: "NEED_HUMAN_REVIEW",
      reviewPolicy: singleReview,
    });

    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "INVALID_STATE_TRANSITION");
    }
  });

  test("SINGLE_REVIEW pass 直接 ACCEPTED", () => {
    const result = humanReviewPass(makeSubmission("HUMAN_REVIEWING"), singleReview);
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "ACCEPTED");
      equal(result.auditAction, "REVIEW_ACCEPTED");
      equal(result.sideEffects.some((effect) => effect.type === "UPDATE_DATASET_ITEM_STATUS" && effect.status === "COMPLETED"), true);
    }
  });

  test("DOUBLE_REVIEW pass 进入 FINAL_REVIEWING，并返回 FINAL_REVIEW_REQUESTED", () => {
    const result = humanReviewPass(makeSubmission("HUMAN_REVIEWING"), doubleReview);
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "FINAL_REVIEWING");
      equal(result.auditAction, "FINAL_REVIEW_REQUESTED");
    }
  });

  test("finalPass 进入 ACCEPTED，并返回 REVIEW_ACCEPTED", () => {
    const result = finalReviewPass(makeSubmission("FINAL_REVIEWING"));
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "ACCEPTED");
      equal(result.auditAction, "REVIEW_ACCEPTED");
    }
  });

  test("REJECT side effect 使 DatasetItem 回到 AVAILABLE", () => {
    const result = humanReviewReject(makeSubmission("HUMAN_REVIEWING"), "质量不符合要求");
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "REJECTED");
      equal(result.sideEffects.some((effect) => effect.type === "UPDATE_DATASET_ITEM_STATUS" && effect.status === "AVAILABLE"), true);
      equal(result.sideEffects.some((effect) => effect.type === "UPDATE_ASSIGNMENT_STATUS" && effect.status === "CANCELED"), true);
    }
  });

  test("terminal submission 不允许普通迁移", () => {
    const result = humanReviewPass(makeSubmission("ACCEPTED"), singleReview);
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "INVALID_STATE_TRANSITION");
    }
  });
});

describe("AIReviewJob 状态机", () => {
  test("AIReviewJob PENDING 可以 start 为 RUNNING", () => {
    const result = startAIReviewJob(makeAIReviewJob("PENDING", 0, 2));
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "RUNNING");
      equal(result.auditAction, "AI_REVIEW_STARTED");
    }
  });

  test("AI review retry 耗尽后进入人工兜底状态", () => {
    const result = retryAIReviewJob(makeAIReviewJob("FAILED", 2, 2));
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "FAILED_TO_HUMAN_REVIEW");
      equal(result.auditAction, "AI_REVIEW_FAILED_TO_HUMAN");
      equal(result.sideEffects.some((effect) => effect.type === "ROUTE_TO_HUMAN_REVIEW"), true);
    }
  });

  test("AI Review 不能直接 patch answers", () => {
    equal(aiReviewOutputCanModifyAnswers({}), true);
    equal(aiReviewOutputCanModifyAnswers({ answersPatch: { summary: "AI 覆盖" } }), false);
  });
});

describe("ExportJob 状态机", () => {
  test("ACCEPTED submission 可以进入 export pool", () => {
    equal(assertSubmissionCanEnterExportPool(makeSubmission("ACCEPTED")), true);
  });

  test("RETURNED / REJECTED submission 不能进入 export pool", () => {
    equal(assertSubmissionCanEnterExportPool(makeSubmission("RETURNED")), false);
    equal(assertSubmissionCanEnterExportPool(makeSubmission("REJECTED")), false);
  });

  test("PATCHED_ANSWERS 未 allowPatchedAnswers 时被拒绝", () => {
    const job = makeExportJob("PENDING", {
      ...baseExportMapping(),
      answerSource: "PATCHED_ANSWERS",
    });

    const result = createExportJob(job);
    equal(assertExportMappingAllowed(job.mapping), false);
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "EXPORT_MAPPING_INVALID");
    }
  });

  test("ExportJob PENDING -> RUNNING -> SUCCEEDED", () => {
    const started = startExportJob(makeExportJob("PENDING"));
    equal(started.ok, true);
    if (started.ok) {
      equal(started.nextStatus, "RUNNING");
      equal(started.auditAction, "EXPORT_STARTED");

      const succeeded = markExportSucceeded(started.entity, "file_export_result");
      equal(succeeded.ok, true);
      if (succeeded.ok) {
        equal(succeeded.nextStatus, "SUCCEEDED");
        equal(succeeded.auditAction, "EXPORT_SUCCEEDED");
      }
    }
  });

  test("ExportJob CANCELED 后不能 RUNNING", () => {
    const canceled = cancelExportJob(makeExportJob("PENDING"));
    equal(canceled.ok, true);
    if (canceled.ok) {
      const result = startExportJob(canceled.entity);
      equal(result.ok, false);
      if (!result.ok) {
        equal(result.errorCode, "INVALID_STATE_TRANSITION");
      }
    }
  });
});

describe("DatasetItem 与 File 状态机", () => {
  test("DatasetItem COMPLETED 后不能再次 claim", () => {
    const result = claimItem(makeDatasetItem("COMPLETED"));
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "INVALID_STATE_TRANSITION");
    }
  });

  test("DatasetItem LOCKED 可以 complete", () => {
    const result = completeItem(makeDatasetItem("LOCKED"));
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "COMPLETED");
      equal(result.auditAction, "REVIEW_ACCEPTED");
    }
  });

  test("File createUploadUrl -> PENDING", () => {
    const result = createUploadUrl(makeFile("PENDING", "DATASET_IMPORT"));
    equal(result.ok, true);
    if (result.ok) {
      equal(result.previousStatus, "NONE");
      equal(result.nextStatus, "PENDING");
      equal(result.auditAction, "FILE_UPLOAD_URL_CREATED");
    }
  });

  test("File markUploadStarted -> UPLOADING", () => {
    const result = markUploadStarted(makeFile("PENDING", "ANSWER_ATTACHMENT"));
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "UPLOADING");
      equal(result.auditAction, "FILE_UPLOAD_STARTED");
    }
  });

  test("File confirmUpload -> READY", () => {
    const result = confirmUpload(makeFile("UPLOADING", "ANSWER_ATTACHMENT"), now);
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "READY");
      equal(result.auditAction, "FILE_CONFIRMED");
      equal(result.entity.confirmedAt, now);
    }
  });

  test("File failUpload -> FAILED", () => {
    const result = failUpload(makeFile("UPLOADING", "ANSWER_ATTACHMENT"));
    equal(result.ok, true);
    if (result.ok) {
      equal(result.nextStatus, "FAILED");
      equal(result.auditAction, "FILE_UPLOAD_FAILED");
    }
  });

  test("File 未 READY 不能 dataset import", () => {
    const result = assertDatasetImportFileReady(makeFile("PENDING", "DATASET_IMPORT"));
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "FILE_NOT_READY");
    }
  });

  test("Export download 必须使用 READY + EXPORT_RESULT 文件", () => {
    const failed = assertExportDownloadFileReady(makeFile("READY", "DATASET_IMPORT"));
    equal(failed.ok, false);
    if (!failed.ok) {
      equal(failed.errorCode, "FILE_NOT_READY");
    }

    const passed = assertExportDownloadFileReady(makeFile("READY", "EXPORT_RESULT"));
    equal(passed.ok, true);
  });
});

describe("Task 状态机", () => {
  test("publishTask 无 schemaVersionId 时失败", () => {
    const result = publishTask({ task: makeTask("DRAFT", undefined) });
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.errorCode, "VALIDATION_FAILED");
    }
  });

  test("Task DRAFT 可以 publish，ENDED 可以 archive", () => {
    const created = createTask(makeTask("DRAFT", undefined));
    equal(created.ok, true);

    const published = publishTask({
      task: makeTask("DRAFT", undefined),
      schemaVersionId: "sv_news_quality_1",
      schemaVersionBelongsToTask: true,
      datasetImported: true,
      reviewReady: true,
    });
    equal(published.ok, true);
    if (published.ok) {
      equal(published.nextStatus, "PUBLISHED");
      equal(published.auditAction, "TASK_PUBLISHED");
    }

    const archived = archiveTask(makeTask("ENDED", "sv_news_quality_1"));
    equal(archived.ok, true);
    if (archived.ok) {
      equal(archived.nextStatus, "ARCHIVED");
      equal(archived.auditAction, "TASK_ARCHIVED");
    }
  });
});

function makeTask(status: TaskStatus, activeSchemaVersionId: ID | undefined): Task {
  const base: Omit<Task, "activeSchemaVersionId"> = {
    id: "task_news_quality",
    title: "新闻质量标注",
    description: "标注新闻质量",
    tags: ["news"],
    quota: { total: 100 },
    distributionStrategy: { type: "FIRST_COME_FIRST_SERVED" },
    reviewPolicy: singleReview,
    status,
    ownerId: "usr_owner",
    createdAt: now,
    updatedAt: now,
  };

  return activeSchemaVersionId === undefined ? base : { ...base, activeSchemaVersionId };
}

function makeDatasetItem(status: DatasetItemStatus): DatasetItem {
  return {
    id: "item_news_1",
    taskId: "task_news_quality",
    sourcePayload: { title: "新闻标题" },
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function makeAssignment(status: AssignmentStatus): Assignment {
  return {
    id: "asn_news_1",
    taskId: "task_news_quality",
    itemId: "item_news_1",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function makeSubmission(status: SubmissionStatus): Submission {
  return {
    id: "sub_news_1",
    assignmentId: "asn_news_1",
    taskId: "task_news_quality",
    itemId: "item_news_1",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    attemptNo: 1,
    answers: { quality: "good" },
    status,
    validationSnapshot: { valid: true, errors: [] },
    createdAt: now,
    updatedAt: now,
  };
}

function makeAIReviewJob(status: AIReviewJobStatus, retryCount: number, maxRetries: number): AIReviewJob {
  return {
    id: "job_ai_review_1",
    submissionId: "sub_news_1",
    attemptNo: 1,
    schemaVersionId: "sv_news_quality_1",
    status,
    retryCount,
    maxRetries,
    idempotencyKey: "idem-ai-review-1",
    promptSnapshotHash: "prompt_hash",
    modelSnapshot: {
      provider: "demo",
      model: "demo-model",
      responseFormat: "JSON_SCHEMA",
    },
    createdAt: now,
    updatedAt: now,
  };
}

function baseExportMapping(): ExportMapping {
  return {
    schemaVersionId: "sv_news_quality_1",
    format: "JSON",
    answerSource: "ORIGINAL_ANSWERS",
    includeReviewRecords: false,
    columns: [{ header: "quality", sourcePath: "$.answers.quality" }],
    filters: { acceptedOnly: true },
  };
}

function makeExportJob(status: ExportJobStatus, mapping: ExportMapping = baseExportMapping()): ExportJob {
  return {
    id: "job_export_1",
    taskId: "task_news_quality",
    schemaVersionId: "sv_news_quality_1",
    status,
    mapping,
    progress: { total: 1, done: 0 },
    createdBy: "usr_owner",
    createdAt: now,
  };
}

function makeFile(status: FileStatus, purpose: FileObject["purpose"]): FileObject {
  return {
    id: "file_demo_1",
    ownerId: "usr_owner",
    ownerType: "USER",
    purpose,
    mimeType: "text/plain",
    size: 128,
    storageKey: "local/file_demo_1",
    status,
    createdAt: now,
  };
}
