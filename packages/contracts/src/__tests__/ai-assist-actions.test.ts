import { describe, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import type {
  AiAssistActionRecord,
  AiAssistActionRequest,
  AiAssistActionResponse,
  AiAssistActionType,
  AiAssistPatchAuditPayload,
  AiAssistStructuredPatch,
  AiAssistSuggestion,
  AiAssistSuggestionStatus,
  AuditEventRecord,
  ListAiAssistSuggestionsResponse,
} from "../index";

const reviewerActor = {
  id: "usr_reviewer",
  role: "REVIEWER",
  displayName: "审核员",
};

describe("AI Assist 动作契约", () => {
  test("三种动作类型可被引用", () => {
    const actions: AiAssistActionType[] = ["accept", "edit_accept", "dismiss"];
    deepEqual(actions, ["accept", "edit_accept", "dismiss"]);
  });

  test("可构造带结构化补丁的待处理建议", () => {
    const patch: AiAssistStructuredPatch = [
      { fieldName: "qualityScore", previousValue: "3", nextValue: "1" },
      { fieldName: "factCheckNote", nextValue: "已补充来源链接与统计口径。" },
    ];
    const suggestion: AiAssistSuggestion = {
      id: "aas_1",
      submissionId: "sub_news_1",
      taskId: "task_news_quality",
      itemId: "item_news_1",
      schemaVersionId: "sv_news_quality_1",
      nodeId: "ai_quality_check",
      fieldName: "qualityScore",
      assistType: "QUALITY_CHECK",
      severity: "HIGH",
      confidence: 0.82,
      summary: "建议下调质量评分并补充事实核查说明。",
      structuredPatch: patch,
      status: "PENDING",
      createdAt: "2026-06-09T00:00:00.000Z",
    };

    equal(suggestion.status, "PENDING");
    equal(suggestion.structuredPatch?.length, 2);
    equal(suggestion.structuredPatch?.[0]?.fieldName, "qualityScore");
  });

  test("空结构化补丁的建议仍可被采纳（最低闭环）", () => {
    const suggestion: AiAssistSuggestion = {
      id: "aas_empty",
      submissionId: "sub_news_2",
      severity: "LOW",
      summary: "建议进一步核对来源依据。",
      structuredPatch: [],
      status: "PENDING",
      createdAt: "2026-06-09T00:00:00.000Z",
    };
    ok(Array.isArray(suggestion.structuredPatch));
    equal(suggestion.structuredPatch?.length, 0);
  });

  test("accept 请求体 editedPatch 缺省，dismiss 同理", () => {
    const accept: AiAssistActionRequest = { action: "accept" };
    const dismiss: AiAssistActionRequest = { action: "dismiss", comment: "与人工判断不符" };
    equal(accept.action, "accept");
    equal(accept.editedPatch, undefined);
    equal(dismiss.action, "dismiss");
    equal(dismiss.comment, "与人工判断不符");
  });

  test("edit_accept 请求体携带编辑后补丁", () => {
    const req: AiAssistActionRequest = {
      action: "edit_accept",
      editedPatch: [{ fieldName: "qualityScore", nextValue: "2" }],
      comment: "下调一档即可",
    };
    equal(req.action, "edit_accept");
    equal(req.editedPatch?.[0]?.nextValue, "2");
  });

  test("accept 成功的动作记录与响应", () => {
    const action: AiAssistActionRecord = {
      id: "aaa_1",
      suggestionId: "aas_1",
      submissionId: "sub_news_1",
      action: "accept",
      resultingStatus: "ACCEPTED",
      appliedPatchFieldNames: ["factCheckNote", "qualityScore"],
      patchApplied: true,
      actor: reviewerActor,
      createdAt: "2026-06-09T00:01:00.000Z",
    };
    const suggestion: AiAssistSuggestion = {
      id: "aas_1",
      submissionId: "sub_news_1",
      severity: "HIGH",
      summary: "建议下调质量评分。",
      status: "ACCEPTED",
      createdAt: "2026-06-09T00:00:00.000Z",
      resolvedAt: "2026-06-09T00:01:00.000Z",
    };
    const response: AiAssistActionResponse = {
      suggestion,
      action,
      auditEventType: "AI_ASSIST_ACCEPTED",
    };
    equal(response.action.patchApplied, true);
    equal(response.suggestion.status, "ACCEPTED");
    equal(response.auditEventType, "AI_ASSIST_ACCEPTED");
  });

  test("补丁应用失败进入 APPLY_FAILED，不静默", () => {
    const status: AiAssistSuggestionStatus = "APPLY_FAILED";
    const action: AiAssistActionRecord = {
      id: "aaa_2",
      suggestionId: "aas_3",
      submissionId: "sub_news_3",
      action: "accept",
      resultingStatus: status,
      patchApplied: false,
      patchFailureReason: "目标字段在当前模板版本不存在，无法应用。",
      actor: reviewerActor,
      createdAt: "2026-06-09T00:02:00.000Z",
    };
    equal(action.resultingStatus, "APPLY_FAILED");
    equal(action.patchApplied, false);
    ok(action.patchFailureReason && action.patchFailureReason.length > 0);
  });

  test("AI_ASSIST_PATCH_APPLIED / FAILED 审计事件可构造", () => {
    const appliedPayload: AiAssistPatchAuditPayload = {
      suggestionId: "aas_1",
      submissionId: "sub_news_1",
      action: "accept",
      patchApplied: true,
      appliedPatchFieldNames: ["qualityScore"],
      summary: "AI 修订已应用",
    };
    const appliedEvent: AuditEventRecord = {
      id: "audit_patch_applied_1",
      type: "AI_ASSIST_PATCH_APPLIED",
      severity: "INFO",
      source: "API",
      actor: reviewerActor,
      target: { entityType: "SUBMISSION", entityId: "sub_news_1", submissionId: "sub_news_1" },
      payload: appliedPayload,
      createdAt: "2026-06-09T00:01:00.000Z",
    };
    equal(appliedEvent.type, "AI_ASSIST_PATCH_APPLIED");

    const failedPayload: AiAssistPatchAuditPayload = {
      suggestionId: "aas_3",
      submissionId: "sub_news_3",
      action: "accept",
      patchApplied: false,
      patchFailureReason: "字段缺失",
      summary: "AI 修订应用失败",
    };
    const failedEvent: AuditEventRecord = {
      id: "audit_patch_failed_1",
      type: "AI_ASSIST_PATCH_FAILED",
      severity: "WARNING",
      source: "API",
      actor: reviewerActor,
      target: { entityType: "SUBMISSION", entityId: "sub_news_3", submissionId: "sub_news_3" },
      payload: failedPayload,
      createdAt: "2026-06-09T00:02:00.000Z",
    };
    equal(failedEvent.type, "AI_ASSIST_PATCH_FAILED");
    equal(failedEvent.severity, "WARNING");
  });

  test("建议列表响应", () => {
    const response: ListAiAssistSuggestionsResponse = {
      suggestions: [
        {
          id: "aas_1",
          submissionId: "sub_news_1",
          severity: "MEDIUM",
          summary: "建议补充关键词。",
          status: "PENDING",
          createdAt: "2026-06-09T00:00:00.000Z",
        },
      ],
    };
    equal(response.suggestions.length, 1);
    equal(response.suggestions[0]?.status, "PENDING");
  });
});
