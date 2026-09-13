import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewDecisionRequest } from "@labelhub/contracts";
import {
  batchDecideReview,
  claimReview,
  fetchReviewQueueCount,
  getReviewDetail,
  listReviewQueue,
  type ReviewQueueItem,
} from "../../api/reviewer";
import { getQueueDisplay } from "./review-display";
import {
  isBatchSelectable,
  normalizeDimensionScores,
  reviewQueueStatusFor,
  type DimensionScoreState,
  type QueueFilter,
} from "./reviewerWorkspaceModel";

export function useReviewerWorkspaceController() {
  const [submissions, setSubmissions] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [dimensionScoresBySubmissionId, setDimensionScoresBySubmissionId] = useState<Record<string, DimensionScoreState>>({});
  const requestedDimensionScoreIdsRef = useRef<Set<string>>(new Set());
  // 批量打回统一原因：复用 decision 的 reason / comment 字段，打回必填，不再下发伪造默认文案。
  const [batchReturnReason, setBatchReturnReason] = useState("");
  // Tab 数字：独立于当前选中 Tab 的全量统计。不能从当前 Tab 的 submissions 客户端聚合，
  // 否则非当前 Tab（已通过 / 已打回）会恒为 0，必须点击该 Tab 后才显示真实数字。
  const [counts, setCounts] = useState({ pending: 0, passed: 0, returned: 0, manual: 0, failed: 0 });

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listReviewQueue({ status: reviewQueueStatusFor(filter) });
      // 后端/mock 可能返回缺少嵌套 submission 的脏数据，统一在入口过滤，
      // 保证下游过滤 / 选中 / 渲染读取 item.submission.* 时不会崩溃。
      const safeData = data.filter(
        (item): item is ReviewQueueItem =>
          item != null && item.submission != null && typeof item.submission.id === "string",
      );
      setSubmissions(safeData);
      setSelectedId((current) => current ?? safeData[0]?.submission?.id ?? null);
      setSelectedBatchIds([]);
      setOfflineNotice(null);
    } catch (error) {
      console.warn("审核队列加载失败：", error);
      setSubmissions([]);
      setSelectedId(null);
      setOfflineNotice("审核队列加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadCounts = useCallback(async () => {
    try {
      const [pending, passed, returned] = await Promise.all([
        fetchReviewQueueCount("NEEDS_HUMAN_REVIEW"),
        fetchReviewQueueCount("ACCEPTED"),
        fetchReviewQueueCount("RETURNED"),
      ]);
      // 「转人工」与「待审核」共用 NEEDS_HUMAN_REVIEW 状态（reviewQueueStatusFor 同口径）；
      // 队列中无独立「失败」状态（AI 失败会转人工），保持 0。
      setCounts({ pending, passed, returned, manual: pending, failed: 0 });
    } catch (error) {
      console.warn("审核队列统计加载失败：", error);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // Tab 数字首屏即加载，且不随选中 Tab 变化（与列表请求解耦）。
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const filteredSubmissions = submissions.filter((item) => {
    if (filter === "passed") return item.submission.status === "AI_PASSED" || item.submission.status === "ACCEPTED";
    if (filter === "returned") return item.submission.status === "RETURNED" || item.submission.status === "REJECTED";
    if (filter === "manual") return item.submission.status === "NEEDS_HUMAN_REVIEW" || item.submission.status === "HUMAN_REVIEWING";
    if (filter === "failed") return false;
    return item.submission.status !== "ACCEPTED";
  });

  const selected = submissions.find((item) => item.submission.id === selectedId) ?? filteredSubmissions[0] ?? submissions[0];
  const selectedDisplay = selected ? getQueueDisplay(selected) : null;
  const selectedBatchItems = filteredSubmissions.filter((item) => selectedBatchIds.includes(item.submission.id) && isBatchSelectable(item));
  const selectedDimensionScoreState = selected ? dimensionScoresBySubmissionId[selected.submission.id] : undefined;

  useEffect(() => {
    const submissionId = selected?.submission.id;
    if (!submissionId || requestedDimensionScoreIdsRef.current.has(submissionId)) return;
    requestedDimensionScoreIdsRef.current.add(submissionId);
    setDimensionScoresBySubmissionId((current) => ({
      ...current,
      [submissionId]: { status: "loading", scores: [] },
    }));
    let cancelled = false;
    void (async () => {
      try {
        const detail = await getReviewDetail(submissionId);
        const scores = normalizeDimensionScores(detail.aiResult?.aiResult?.dimensionScores);
        const aiDecision = detail.aiResult?.decision ?? null;
        if (!cancelled) {
          setDimensionScoresBySubmissionId((current) => ({
            ...current,
            [submissionId]: { status: "ready", scores, aiDecision },
          }));
        }
      } catch (error) {
        console.warn("AI 维度评分加载失败：", error);
        if (!cancelled) {
          setDimensionScoresBySubmissionId((current) => ({
            ...current,
            [submissionId]: { status: "error", scores: [] },
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.submission.id]);

  const toggleBatchId = (submissionId: string) => {
    setSelectedBatchIds((current) =>
      current.includes(submissionId) ? current.filter((id) => id !== submissionId) : [...current, submissionId],
    );
  };

  const handleBatchDecision = async (decision: "PASS" | "RETURN") => {
    if (selectedBatchItems.length === 0) return;
    const trimmedReturnReason = batchReturnReason.trim();
    // 提交侧 guard：批量打回必须填写统一打回原因，不仅靠按钮 disabled。
    if (decision === "RETURN" && trimmedReturnReason.length === 0) {
      setBatchMessage("批量打回前请填写统一打回原因。");
      return;
    }
    const totalAttempted = selectedBatchItems.length;
    try {
      setBatching(true);
      setBatchMessage(null);

      // 状态机要求 NEEDS_HUMAN_REVIEW →(claimReview)→ HUMAN_REVIEWING 后才接受
      // PASS / RETURN 决策，否则后端/mock 返回 INVALID_STATE_TRANSITION。
      // 所以批量决策前先认领仍处于 NEEDS_HUMAN_REVIEW 的提交；
      // HUMAN_REVIEWING / FINAL_REVIEWING 已在审核中，无需认领。
      const toClaim = selectedBatchItems.filter(
        (item) => item.submission.status === "NEEDS_HUMAN_REVIEW",
      );
      const claimOutcomes = await Promise.allSettled(
        toClaim.map((item) => claimReview(item.submission.id)),
      );
      // 认领失败的项不参与决策、不伪造成功，单独计入失败统计。
      const claimFailedIds = new Set(
        toClaim.filter((_, idx) => claimOutcomes[idx].status === "rejected").map((item) => item.submission.id),
      );
      const decidable = selectedBatchItems.filter((item) => !claimFailedIds.has(item.submission.id));

      const items: ReviewDecisionRequest[] = decidable.map((item) => {
        const stage: ReviewDecisionRequest["stage"] =
          item.submission.status === "FINAL_REVIEWING" ? "FINAL_REVIEW" : "HUMAN_REVIEW";
        const base = {
          submissionId: item.submission.id as ReviewDecisionRequest["submissionId"],
          stage,
        };
        if (decision === "RETURN") {
          return {
            ...base,
            decision: "RETURN",
            reason: trimmedReturnReason,
            comments: [{ message: trimmedReturnReason }],
          };
        }
        return {
          ...base,
          decision: "PASS",
          comments: [],
        };
      });

      const response = items.length > 0 ? await batchDecideReview({ items }) : { results: [] };
      const successCount = response.results.filter((result) => result.success).length;
      const decisionFailures = response.results.filter((result) => !result.success);

      // 真实回报：成功数 / 尝试数，并把认领失败与决策失败（含真实 error code/message）显式展示，不吞错误。
      const failNotes: string[] = [];
      if (claimFailedIds.size > 0) failNotes.push(`认领失败 ${claimFailedIds.size} 条`);
      if (decisionFailures.length > 0) {
        const firstError = decisionFailures[0].error;
        failNotes.push(
          `决策失败 ${decisionFailures.length} 条（${firstError?.code ?? "UNKNOWN"}：${firstError?.message ?? "未知错误"}）`,
        );
      }
      setBatchMessage(
        `批量${decision === "PASS" ? "通过" : "打回"}：成功 ${successCount} / ${totalAttempted}` +
          (failNotes.length > 0 ? `；${failNotes.join("，")}` : ""),
      );

      // 刷新队列与统计：复用入口同款脏数据过滤，保证 stats / 渲染读取 item.submission.* 不崩。
      const data = await listReviewQueue({ status: reviewQueueStatusFor(filter) });
      const safeData = data.filter(
        (item): item is ReviewQueueItem =>
          item != null && item.submission != null && typeof item.submission.id === "string",
      );
      setSubmissions(safeData);
      setSelectedBatchIds([]);
      // 决策会改变各状态条数，同步刷新 Tab 数字。
      void loadCounts();
      if (decision === "RETURN" && successCount > 0) setBatchReturnReason("");
    } catch (error) {
      setBatchMessage(error instanceof Error ? `批量操作失败：${error.message}` : "批量操作失败。");
    } finally {
      setBatching(false);
    }
  };

  return {
    batchMessage,
    batchReturnReason,
    batching,
    counts,
    filter,
    filteredSubmissions,
    handleBatchDecision,
    loadCounts,
    loadQueue,
    loading,
    offlineNotice,
    selected,
    selectedBatchIds,
    selectedBatchItems,
    selectedDimensionScoreState,
    selectedDisplay,
    selectedId,
    setBatchReturnReason,
    setFilter,
    setSelectedId,
    submissions,
    toggleBatchId,
  };
}
