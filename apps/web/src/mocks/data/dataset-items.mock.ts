import type { DatasetItem } from "@labelhub/contracts";

export const datasetItemsMock: DatasetItem[] = [
  {
    id: "item_news_1",
    taskId: "task_news_quality",
    externalKey: "news-1",
    sourcePayload: {
      title: "新能源车销量创下季度新高",
      body: "某行业报告显示，新能源车销量在本季度继续增长，但原文未提供完整统计口径。",
      source: "行业简报",
    },
    status: "LOCKED",
    currentAssignmentId: "asn_1001",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
  {
    id: "item_news_2",
    taskId: "task_news_quality",
    externalKey: "news-2",
    sourcePayload: {
      title: "科技公司发布新一代芯片",
      body: "发布会介绍了芯片性能提升，但缺少第三方测试数据。",
      source: "企业新闻稿",
    },
    status: "LOCKED",
    currentAssignmentId: "asn_1002",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
  {
    id: "item_news_3",
    taskId: "task_news_quality",
    externalKey: "news-3",
    sourcePayload: {
      title: "地方文旅活动带动周末消费",
      body: "报道提到活动吸引大量游客，但缺少客流统计和同比数据。",
      source: "地方媒体",
    },
    status: "LOCKED",
    currentAssignmentId: "asn_1003",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
  {
    id: "item_news_4",
    taskId: "task_news_quality",
    externalKey: "news-4",
    sourcePayload: {
      title: "高校发布人工智能课程计划",
      body: "学校介绍将新增多个 AI 方向课程，但未说明师资和招生规模。",
      source: "教育资讯",
    },
    status: "LOCKED",
    currentAssignmentId: "asn_1004",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
  {
    id: "item_news_5",
    taskId: "task_news_quality",
    externalKey: "news-5",
    sourcePayload: {
      title: "城市公共交通客流恢复增长",
      body: "交通部门称工作日客流恢复明显，但报道未提供完整时间区间。",
      source: "城市日报",
    },
    status: "AVAILABLE",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
];
