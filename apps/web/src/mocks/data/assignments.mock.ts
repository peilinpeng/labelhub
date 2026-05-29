import type { Assignment, Draft } from "@labelhub/contracts";

export const assignmentsMock: Assignment[] = [
  {
    id: "asn_1001",
    taskId: "task_news_quality",
    itemId: "item_news_1",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    status: "CLAIMED",
    lockedUntil: "2026-05-28T12:30:00.000Z",
    createdAt: "2026-05-28T12:00:00.000Z",
    updatedAt: "2026-05-28T12:00:00.000Z",
  },
];

export const draftsMock: Draft[] = [];
