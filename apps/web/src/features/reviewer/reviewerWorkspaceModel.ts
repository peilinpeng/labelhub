import type { AIPrecheckDecision } from "@labelhub/contracts";
import type { ReviewQueueItem } from "../../api/reviewer";

export type QueueFilter = "pending" | "passed" | "returned" | "manual" | "failed";

export type DimensionScore = {
  key: string;
  score: number | null;
  reason?: string;
};

export type DimensionScoreState =
  | { status: "loading"; scores: DimensionScore[]; aiDecision?: null }
  | { status: "ready"; scores: DimensionScore[]; aiDecision: AIPrecheckDecision | null }
  | { status: "error"; scores: DimensionScore[]; aiDecision?: null };

export function reviewQueueStatusFor(filter: QueueFilter): string | undefined {
  if (filter === "pending" || filter === "manual") return "NEEDS_HUMAN_REVIEW";
  if (filter === "passed") return "ACCEPTED";
  if (filter === "returned") return "RETURNED";
  return undefined;
}

export function isBatchSelectable(item: ReviewQueueItem): boolean {
  return (
    item.submission.status === "NEEDS_HUMAN_REVIEW" ||
    item.submission.status === "HUMAN_REVIEWING" ||
    item.submission.status === "FINAL_REVIEWING"
  );
}

export function normalizeDimensionScores(value: unknown): DimensionScore[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item == null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" && record.key.trim() ? record.key : "unknown";
    const score = typeof record.score === "number" && Number.isFinite(record.score) ? record.score : null;
    const reason = typeof record.reason === "string" ? record.reason : undefined;
    return [{ key, score, reason }];
  });
}
