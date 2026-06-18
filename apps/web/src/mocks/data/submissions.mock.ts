import type { Submission } from "@labelhub/contracts";

export const submissionsMock: Submission[] = [
  {
    id: "sub_1001",
    assignmentId: "asn_1001",
    taskId: "task_news_quality",
    itemId: "item_news_1",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    attemptNo: 1,
    answers: {
      newsCategory: "technology",
      qualityScore: "2",
      issueTags: ["missing_source", "unclear_fact"],
      factCheckNote: "原文没有提供完整统计口径，需要补充来源。",
      rewriteSuggestion: "建议补充报告名称、统计周期和第三方验证来源。",
    },
    status: "NEEDS_HUMAN_REVIEW",
    validationSnapshot: {
      valid: true,
      errors: [],
      warnings: [],
    },
    createdAt: "2026-05-28T12:20:00.000Z",
    updatedAt: "2026-05-28T12:22:00.000Z",
  },
];
