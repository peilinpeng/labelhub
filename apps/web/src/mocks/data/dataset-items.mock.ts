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
    status: "AVAILABLE",
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
    status: "AVAILABLE",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
];
