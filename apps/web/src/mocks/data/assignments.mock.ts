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
    latestSubmissionId: "sub_1001",
    createdAt: "2026-05-28T12:00:00.000Z",
    updatedAt: "2026-05-28T12:00:00.000Z",
  },
  {
    id: "asn_1002",
    taskId: "task_news_quality",
    itemId: "item_news_2",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    status: "SUBMITTED",
    latestSubmissionId: "sub_1002",
    createdAt: "2026-05-28T12:05:00.000Z",
    updatedAt: "2026-05-28T12:28:00.000Z",
  },
  {
    id: "asn_1003",
    taskId: "task_news_quality",
    itemId: "item_news_3",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    status: "SUBMITTED",
    latestSubmissionId: "sub_1003",
    createdAt: "2026-05-28T12:10:00.000Z",
    updatedAt: "2026-05-28T12:32:00.000Z",
  },
  {
    id: "asn_1004",
    taskId: "task_news_quality",
    itemId: "item_news_4",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    status: "SUBMITTED",
    latestSubmissionId: "sub_1004",
    createdAt: "2026-05-28T12:15:00.000Z",
    updatedAt: "2026-05-28T12:36:00.000Z",
  },
];

export const draftsMock: Draft[] = [];
