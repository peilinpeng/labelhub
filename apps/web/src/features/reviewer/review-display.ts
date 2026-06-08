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

export function getReviewerSubmissionDisplay(id: string | undefined): ReviewerSubmissionDisplay | undefined {
  void id;
  return undefined;
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
  return [];
}
