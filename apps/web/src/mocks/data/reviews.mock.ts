import type { AIReviewJob, ReviewResult } from "@labelhub/contracts";

const REVIEWER_AI_PROMPT_HASH =
  "34063c27db75c17de7796d499225a537b0dd827fd9e0439fa81d62601f713294";

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
    promptSnapshotHash: REVIEWER_AI_PROMPT_HASH,
    modelSnapshot: {
      provider: "mock",
      model: "mock-reviewer",
      responseFormat: "JSON_SCHEMA",
    },
    createdAt: "2026-05-28T12:21:00.000Z",
    updatedAt: "2026-05-28T12:22:00.000Z",
  },
  {
    id: "job_1002",
    submissionId: "sub_1002",
    attemptNo: 1,
    schemaVersionId: "sv_news_quality_1",
    status: "SUCCEEDED",
    retryCount: 0,
    maxRetries: 3,
    idempotencyKey: "sub_1002:1",
    promptSnapshotHash: REVIEWER_AI_PROMPT_HASH,
    modelSnapshot: {
      provider: "mock",
      model: "mock-reviewer",
      responseFormat: "JSON_SCHEMA",
    },
    createdAt: "2026-05-28T12:27:00.000Z",
    updatedAt: "2026-05-28T12:28:00.000Z",
  },
  {
    id: "job_1003",
    submissionId: "sub_1003",
    attemptNo: 1,
    schemaVersionId: "sv_news_quality_1",
    status: "SUCCEEDED",
    retryCount: 0,
    maxRetries: 3,
    idempotencyKey: "sub_1003:1",
    promptSnapshotHash: REVIEWER_AI_PROMPT_HASH,
    modelSnapshot: {
      provider: "mock",
      model: "mock-reviewer",
      responseFormat: "JSON_SCHEMA",
    },
    createdAt: "2026-05-28T12:31:00.000Z",
    updatedAt: "2026-05-28T12:32:00.000Z",
  },
  {
    id: "job_1004",
    submissionId: "sub_1004",
    attemptNo: 1,
    schemaVersionId: "sv_news_quality_1",
    status: "SUCCEEDED",
    retryCount: 0,
    maxRetries: 3,
    idempotencyKey: "sub_1004:1",
    promptSnapshotHash: REVIEWER_AI_PROMPT_HASH,
    modelSnapshot: {
      provider: "mock",
      model: "mock-reviewer",
      responseFormat: "JSON_SCHEMA",
    },
    createdAt: "2026-05-28T12:35:00.000Z",
    updatedAt: "2026-05-28T12:36:00.000Z",
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
  {
    id: "rev_1002",
    submissionId: "sub_1002",
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
      totalScore: 70,
      dimensionScores: [
        {
          key: "format",
          score: 76,
          reason: "结构完整",
        },
        {
          key: "evidence",
          score: 62,
          reason: "第三方测试证据不足",
        },
      ],
      fieldIssues: [
        {
          fieldName: "factCheckNote",
          severity: "MEDIUM",
          message: "事实核查说明需要补充测试来源",
        },
      ],
      summary: "芯片性能信息来自企业口径，建议人工复核第三方测试证据。",
      confidence: 0.7,
    },
    createdAt: "2026-05-28T12:28:00.000Z",
  },
  {
    id: "rev_1003",
    submissionId: "sub_1003",
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
      totalScore: 61,
      dimensionScores: [
        {
          key: "format",
          score: 70,
          reason: "字段填写完整",
        },
        {
          key: "evidence",
          score: 52,
          reason: "客流与同比数据缺失",
        },
      ],
      fieldIssues: [
        {
          fieldName: "qualityScore",
          severity: "HIGH",
          message: "质量分偏低，建议 Reviewer 修改或退回",
        },
        {
          fieldName: "rewriteSuggestion",
          severity: "MEDIUM",
          message: "建议补充更明确的数据来源要求",
        },
      ],
      summary: "文旅消费报道缺少关键统计来源，适合作为 Reviewer diff 演示样本。",
      confidence: 0.74,
    },
    createdAt: "2026-05-28T12:32:00.000Z",
  },
  {
    id: "rev_1004",
    submissionId: "sub_1004",
    schemaVersionId: "sv_news_quality_1",
    stage: "AI_PRECHECK",
    decision: "PASS",
    actor: {
      id: "usr_system",
      role: "SYSTEM",
      displayName: "AI Review Agent",
    },
    aiResult: {
      decision: "PASS",
      totalScore: 84,
      dimensionScores: [
        {
          key: "format",
          score: 88,
          reason: "结构清晰",
        },
        {
          key: "evidence",
          score: 80,
          reason: "主要风险较低，但仍可补充招生计划来源",
        },
      ],
      fieldIssues: [
        {
          fieldName: "factCheckNote",
          severity: "LOW",
          message: "可补充官方招生计划链接",
        },
      ],
      summary: "高校课程计划信息整体可信，适合作为 AI 反馈显式选择演示样本。",
      confidence: 0.86,
    },
    createdAt: "2026-05-28T12:36:00.000Z",
  },
];
