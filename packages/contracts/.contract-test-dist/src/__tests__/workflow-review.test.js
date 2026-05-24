"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acceptedSubmission = acceptedSubmission;
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const contract_guards_1 = require("../utils/contract-guards");
(0, node_test_1.describe)("工作流状态迁移", () => {
    (0, node_test_1.test)("非法 task transition 返回 INVALID_STATE_TRANSITION", () => {
        const result = (0, contract_guards_1.transitionTaskStatus)("DRAFT", "pauseTask");
        (0, strict_1.equal)(result.ok, false);
        if (!result.ok) {
            (0, strict_1.equal)(result.code, "INVALID_STATE_TRANSITION");
        }
    });
    (0, node_test_1.test)("非法 submission transition 返回 INVALID_STATE_TRANSITION", () => {
        const result = (0, contract_guards_1.transitionSubmissionStatus)("ACCEPTED", "enqueueAIReview");
        (0, strict_1.equal)(result.ok, false);
        if (!result.ok) {
            (0, strict_1.equal)(result.code, "INVALID_STATE_TRANSITION");
        }
    });
    (0, node_test_1.test)("RETURN 决策必须带 reason", () => {
        const command = {
            submissionId: "sub_1",
            stage: "HUMAN_REVIEW",
            decision: "RETURN",
        };
        (0, strict_1.equal)((0, contract_guards_1.validateReviewCommand)(command).includes("REVIEW_REASON_REQUIRED"), true);
    });
    (0, node_test_1.test)("人工审核不能提交 NEED_HUMAN_REVIEW", () => {
        const command = {
            submissionId: "sub_1",
            stage: "HUMAN_REVIEW",
            decision: "NEED_HUMAN_REVIEW",
        };
        (0, strict_1.equal)((0, contract_guards_1.validateReviewCommand)(command).includes("INVALID_STATE_TRANSITION"), true);
    });
    (0, node_test_1.test)("AI 重试耗尽后进入 NEEDS_HUMAN_REVIEW", () => {
        (0, strict_1.equal)((0, contract_guards_1.retryExhaustedTargetStatus)(3, 3), "NEEDS_HUMAN_REVIEW");
    });
    (0, node_test_1.test)("ACCEPTED submission 可以进入 export pool", () => {
        (0, strict_1.equal)((0, contract_guards_1.canEnterExportPool)({ status: "ACCEPTED" }), true);
        (0, strict_1.equal)((0, contract_guards_1.canEnterExportPool)({ status: "RETURNED" }), false);
    });
});
(0, node_test_1.describe)("AI 审核", () => {
    (0, node_test_1.test)("AIReviewResult 必须包含 decision、totalScore、dimensionScores、fieldIssues、summary、confidence", () => {
        (0, strict_1.equal)((0, contract_guards_1.validateAIReviewResultShape)({
            decision: "PASS",
            totalScore: 90,
            dimensionScores: [],
            fieldIssues: [],
            summary: "通过",
            confidence: 0.9,
        }), true);
    });
    (0, node_test_1.test)("AI Review 不得 patch answers", () => {
        const record = {
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
        (0, strict_1.equal)((0, contract_guards_1.aiReviewHasPatches)(record), false);
    });
    (0, node_test_1.test)("SCHEMA_GENERATION 必须写入 LLMCallLog purpose", () => {
        const log = {
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
        (0, strict_1.equal)((0, contract_guards_1.isSchemaGenerationLLMCall)(log), true);
    });
});
function acceptedSubmission() {
    return { status: "ACCEPTED" };
}
