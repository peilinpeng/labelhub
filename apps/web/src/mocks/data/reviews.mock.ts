import type { AIReviewJob, ReviewResult } from "@labelhub/contracts";

export const aiReviewJobsMock: AIReviewJob[] = [
  {
    id: "job_1001",
    submissionId: "sub_1001",
    attemptNo: 1,
    schemaVersionId: "sv_news_quality_1",
    status: "SUCCEEDED",
    retryCount: 0,
    maxRetries: 3,
    idempotencyKey: "sub_1001:1",
    promptSnapshotHash: "mock_prompt_ai_review",
    modelSnapshot: {
      provider: "mock",
      model: "mock-reviewer",
      responseFormat: "JSON_SCHEMA",
    },
    createdAt: "2026-05-28T12:21:00.000Z",
    updatedAt: "2026-05-28T12:22:00.000Z",
  },
];

export const reviewResultsMock: ReviewResult[] = [
  {
    id: "rev_1001",
    submissionId: "sub_1001",
    schemaVersionId: "sv_news_quality_1",
    stage: "AI_PRECHECK",
    decision: "NEED_HUMAN_REVIEW",
    actor: {
      id: "usr_system",
      role: "SYSTEM",
      displayName: "AI Review Agent",
    },
    aiResult: {
      decision: "NEED_HUMAN_REVIEW",
      totalScore: 65,
      dimensionScores: [
        {
          key: "format",
          score: 72,
          reason: "格式基本完整",
        },
        {
          key: "evidence",
          score: 58,
          reason: "来源证据不足",
        },
      ],
      fieldIssues: [
        {
          fieldName: "qualityScore",
          severity: "MEDIUM",
          message: "低分样本建议人工复核",
        },
      ],
      summary: "新闻内容缺少完整统计口径和来源证据，建议人工复核。",
      confidence: 0.72,
    },
    createdAt: "2026-05-28T12:22:00.000Z",
  },
];
