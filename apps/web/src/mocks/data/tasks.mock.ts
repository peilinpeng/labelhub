import type { Task } from "@labelhub/contracts";

export const tasksMock: Task[] = [
  {
    id: "task_news_quality",
    title: "新闻质量标注",
    description: "对新闻标题和正文进行质量、类别和事实性标注。",
    instructionRichText: {
      type: "doc",
      content: [],
    },
    tags: ["新闻", "质量评估", "文本标注"],
    rewardRule: {
      unit: "PER_ACCEPTED_ITEM",
      amount: 1,
      currency: "CNY",
    },
    quota: {
      total: 100,
      perLabeler: 20,
    },
    deadlineAt: "2026-06-30T23:59:59.000Z",
    distributionStrategy: {
      type: "FIRST_COME_FIRST_SERVED",
    },
    reviewPolicy: {
      type: "SINGLE_REVIEW",
    },
    status: "PUBLISHED",
    activeSchemaVersionId: "sv_news_quality_1",
    ownerId: "usr_owner",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
  {
    id: "task_product_title",
    title: "商品标题清洗 v3",
    description: "清洗电商商品标题，抽取主类目和卖点关键词。",
    tags: ["电商", "文本清洗", "中文"],
    rewardRule: {
      unit: "PER_ACCEPTED_ITEM",
      amount: 0.3,
      currency: "CNY",
    },
    quota: {
      total: 5000,
      perLabeler: 60,
    },
    deadlineAt: "2026-06-01T23:59:59.000Z",
    distributionStrategy: {
      type: "FIRST_COME_FIRST_SERVED",
    },
    reviewPolicy: {
      type: "SINGLE_REVIEW",
    },
    status: "DRAFT",
    ownerId: "usr_owner",
    createdAt: "2026-05-26T09:00:00.000Z",
    updatedAt: "2026-05-26T09:00:00.000Z",
  },
];
