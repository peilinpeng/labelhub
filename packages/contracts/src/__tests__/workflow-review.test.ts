import { describe, test } from "node:test";
import { equal } from "node:assert/strict";
import type { AIReviewResultRecord, AuditAction, LLMCallLog, Submission } from "../index";
import {
  aiReviewHasPatches,
  canEnterExportPool,
  isSchemaGenerationLLMCall,
  reviewPassAuditActionForPolicy,
  reviewRejectDatasetItemStatus,
  retryExhaustedTargetStatus,
  transitionSubmissionStatus,
  transitionTaskStatus,
  validateAIReviewResultShape,
  validateReviewCommand,
} from "../utils/contract-guards";

describe("工作流状态迁移", () => {
  test("非法 task transition 返回 INVALID_STATE_TRANSITION", () => {
    const result = transitionTaskStatus("DRAFT", "pauseTask");

    equal(result.ok, false);
    if (!result.ok) {
      equal(result.code, "INVALID_STATE_TRANSITION");
    }
  });

  test("非法 submission transition 返回 INVALID_STATE_TRANSITION", () => {
    const result = transitionSubmissionStatus("ACCEPTED", "enqueueAIReview");

    equal(result.ok, false);
    if (!result.ok) {
      equal(result.code, "INVALID_STATE_TRANSITION");
    }
  });

  test("RETURN 决策必须带 reason", () => {
    const command = {
      submissionId: "sub_1",
      stage: "HUMAN_REVIEW",
      decision: "RETURN",
    };

    equal(validateReviewCommand(command).includes("REVIEW_REASON_REQUIRED"), true);
  });

  test("REJECT 决策必须带 reason", () => {
    const command = {
      submissionId: "sub_1",
      stage: "HUMAN_REVIEW",
      decision: "REJECT",
    };

    equal(validateReviewCommand(command).includes("REVIEW_REASON_REQUIRED"), true);
  });

  test("人工审核不能提交 NEED_HUMAN_REVIEW", () => {
    const command = {
      submissionId: "sub_1",
      stage: "HUMAN_REVIEW",
      decision: "NEED_HUMAN_REVIEW",
    };

    equal(validateReviewCommand(command).includes("INVALID_STATE_TRANSITION"), true);
  });

  test("AI 重试耗尽后进入 NEEDS_HUMAN_REVIEW", () => {
    equal(retryExhaustedTargetStatus(3, 3), "NEEDS_HUMAN_REVIEW");
  });

  test("ACCEPTED submission 可以进入 export pool", () => {
    equal(canEnterExportPool({ status: "ACCEPTED" }), true);
    equal(canEnterExportPool({ status: "RETURNED" }), false);
  });

  test("新增 workflow AuditAction 可以被类型引用", () => {
    const actions: AuditAction[] = [
      "FINAL_REVIEW_REQUESTED",
      "FILE_UPLOAD_URL_CREATED",
      "FILE_UPLOAD_STARTED",
    ];

    equal(actions.includes("FINAL_REVIEW_REQUESTED"), true);
  });

  test("HUMAN_REVIEW PASS 进入终审不使用 REVIEW_ACCEPTED", () => {
    const action = reviewPassAuditActionForPolicy({ type: "DOUBLE_REVIEW", requireFinalReview: true });

    equal(action, "FINAL_REVIEW_REQUESTED");
    equal(action === "REVIEW_ACCEPTED", false);
  });

  test("REJECT 后 DatasetItem 回到 AVAILABLE", () => {
    equal(reviewRejectDatasetItemStatus(), "AVAILABLE");
  });
});

describe("AI 审核", () => {
  test("AIReviewResult 必须包含 decision、totalScore、dimensionScores、fieldIssues、summary、confidence", () => {
    equal(
      validateAIReviewResultShape({
        decision: "PASS",
        totalScore: 90,
        dimensionScores: [],
        fieldIssues: [],
        summary: "通过",
        confidence: 0.9,
      }),
      true,
    );
  });

  test("AI Review 不得 patch answers", () => {
    const record: AIReviewResultRecord = {
      id: "rev_ai_1",
      submissionId: "sub_1",
      schemaVersionId: "sv_1",
      stage: "AI_PRECHECK",
      decision: "PASS",
      actor: {
        id: "usr_system",
        role: "SYSTEM",
        displayName: "AI Review Agent",
      },
      aiResult: {
        decision: "PASS",
        totalScore: 90,
        dimensionScores: [],
        fieldIssues: [],
        summary: "通过",
        confidence: 0.9,
      },
      createdAt: "2026-05-24T00:00:00.000Z",
    };

    equal(aiReviewHasPatches(record), false);
  });

  test("SCHEMA_GENERATION 必须写入 LLMCallLog purpose", () => {
    const log: LLMCallLog = {
      id: "llm_schema_1",
      purpose: "SCHEMA_GENERATION",
      actorId: "usr_owner",
      modelPolicyId: "schema-generator",
      promptSnapshotHash: "hash_prompt",
      inputHash: "hash_input",
      outputHash: "hash_output",
      status: "SUCCEEDED",
      createdAt: "2026-05-24T00:00:00.000Z",
      finishedAt: "2026-05-24T00:00:01.000Z",
    };

    equal(isSchemaGenerationLLMCall(log), true);
  });
});

export function acceptedSubmission(): Pick<Submission, "status"> {
  return { status: "ACCEPTED" };
}
