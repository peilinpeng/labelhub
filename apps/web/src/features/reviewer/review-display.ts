import type { ReviewQueueItem } from "../../api/reviewer";

export interface ReviewerSubmissionDisplay {
  id: string;
  title: string;
  taskTitle: string;
  labeler: string;
  payload: Record<string, unknown>;
  previousPayload: Record<string, unknown>;
  issue: string;
  recommendation: string;
}

const displays: Record<string, ReviewerSubmissionDisplay> = {
  sub_1001: {
    id: "sub_1001",
    title: "户外便携野营折叠桌椅套装 5 件套",
    taskTitle: "商品标题清洗 v3",
    labeler: "李雷",
    payload: {
      cleaned_title: "户外便携野营折叠桌椅套装 5 件套",
      category: "家居用品",
      keywords: ["折叠", "户外"],
    },
    previousPayload: {
      cleaned_title: "户外便携野营折叠桌椅套装",
      category: "家居用品",
      keywords: ["户外"],
    },
    issue: "关键词字段过于稀疏，未覆盖品类核心卖点。建议补充至少 4 个关键词，并将「5 件套」作为独立卖点。",
    recommendation: "建议打回",
  },
  sub_1002: {
    id: "sub_1002",
    title: "新能源车销量创下季度新高",
    taskTitle: "新闻质量标注",
    labeler: "张敏",
    payload: {
      news_title: "新能源车销量创下季度新高",
      news_category: "财经",
      quality_rating: "通过",
      issue_tags: ["来源清楚", "数据充分"],
    },
    previousPayload: {
      news_title: "新能源车销量创下季度新高",
      news_category: "财经",
      issue_tags: ["来源清楚"],
    },
    issue: "标题、正文和类别匹配，事实依据较完整，AI 建议通过。",
    recommendation: "建议通过",
  },
  sub_1003: {
    id: "sub_1003",
    title: "城市公共交通客流恢复至节前水平",
    taskTitle: "新闻质量标注",
    labeler: "王芳",
    payload: {
      news_title: "城市公共交通客流恢复至节前水平",
      news_category: "社会",
      quality_rating: "不可用",
      issue_tags: ["来源缺失", "事实不清"],
    },
    previousPayload: {
      news_title: "城市公共交通客流恢复至节前水平",
      news_category: "社会",
      issue_tags: ["事实不清"],
    },
    issue: "提交已被打回，主要原因是来源信息不足，事实核查说明需要补充。",
    recommendation: "已打回",
  },
  sub_1004: {
    id: "sub_1004",
    title: "科技公司发布新一代边缘计算芯片",
    taskTitle: "新闻质量标注",
    labeler: "李雷",
    payload: {
      news_title: "科技公司发布新一代边缘计算芯片",
      news_category: "科技",
      quality_rating: "需要修改",
      issue_tags: ["标题党", "缺少来源"],
    },
    previousPayload: {
      news_title: "科技公司发布边缘计算芯片",
      news_category: "科技",
      issue_tags: ["缺少来源"],
    },
    issue: "AI 无法确定标题是否夸大，需要人工复核原文依据和类别准确性。",
    recommendation: "转人工复核",
  },
};

export function getReviewerSubmissionDisplay(id: string | undefined): ReviewerSubmissionDisplay | undefined {
  if (!id) return undefined;
  return displays[id];
}

export function getQueueDisplay(item: ReviewQueueItem): ReviewerSubmissionDisplay {
  const known = getReviewerSubmissionDisplay(item.submission.id);
  if (known) return known;

  const title = item.taskTitle || item.itemId || item.submission.id;
  return {
    id: item.submission.id,
    title,
    taskTitle: item.taskTitle,
    labeler: item.submission.labelerId,
    payload: {
      title,
      itemId: item.itemId,
      taskTitle: item.taskTitle,
    },
    previousPayload: {
      title,
      itemId: item.itemId,
    },
    issue: "该提交需要人工确认字段完整性和审核结论。",
    recommendation: "待人工复核",
  };
}

export function listKnownReviewDisplays(): ReviewerSubmissionDisplay[] {
  return Object.values(displays);
}
