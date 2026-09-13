import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { RoutePath } from "../../app/routes";
import { queryAuditEvents } from "../../api/audit";
import { claimReview, decideReview, getReviewDetail, listReviewQueue } from "../../api/reviewer";
import { CONFIRM_KEYS, shouldSuppressConfirm } from "../../ui/confirm";
import type { AuditEventRecord, ReviewDecisionRequest, ReviewDetailResponse, ReviewPatch } from "@labelhub/contracts";
import { getQueueDisplay, type ReviewerSubmissionDisplay } from "./review-display";
import { computeReviewPatches } from "./reviewer-diff";
import {
  appendReviewDiffGeneratedAuditSafely,
  appendReviewStartedAuditSafely,
  appendReviewSubmittedAuditSafely,
} from "./reviewer-audit-events";

type ReviewDecision = "PASS" | "RETURN";
// 审核动作模式：动态表单思路，不同动作触发不同 UI 与校验。
// PASS = 直接通过（无需意见/修订）；RETURN = 打回（意见必填）；REVISE = 修订提交（至少一条字段 patch，最终以 PASS 决策携带 patches 入库）。
export type ReviewActionMode = "PASS" | "RETURN" | "REVISE";
type ReviewDetailWithTrace = ReviewDetailResponse & {
  aiTrace?: {
    modelPolicyId?: string;
    promptSnapshotHash?: string;
    promptTemplate?: string | null;
    promptSnapshotMatches?: boolean | null;
    status?: string;
    totalTokens?: number | null;
    latencyMs?: number | null;
  } | null;
};


export function useReviewDetailController() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<ReviewActionMode | null>(null);
  // 当前审核动作模式，默认「通过」：选中模式驱动下方模块与校验。
  const [actionMode, setActionMode] = useState<ReviewActionMode>("PASS");
  // 字段级修订：维护一个修订后的答案对象（按字段编辑），提交时与原答案做 shallow diff 生成 patches。
  const [correctedAnswers, setCorrectedAnswers] = useState<Record<string, unknown>>({});
  // 审计时间线右侧抽屉，默认收起以最大化主内容区。
  const [timelineOpen, setTimelineOpen] = useState(false);
  // 左侧审核队列：从真实审核队列接口拉取，供详情页内快速切换提交。
  const [queue, setQueue] = useState<ReviewerSubmissionDisplay[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditEventsError, setAuditEventsError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const startedAuditSubmissionIdsRef = useRef<Set<string>>(new Set());
  const reviewOpenedAtMsRef = useRef(Date.now());

  useEffect(() => {
    reviewOpenedAtMsRef.current = Date.now();
    void (async () => {
      try {
        setLoading(true);
        if (submissionId) {
          const data = await getReviewDetail(submissionId);
          setDetail(data);
        }
      } catch (error) {
        console.warn("审核详情加载失败：", error);
        setDetail(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await listReviewQueue({ pageSize: 100 });
        if (!cancelled) {
          setQueue(
            items
              .filter((item) => item != null && item.submission != null && typeof item.submission.id === "string")
              .map(getQueueDisplay),
          );
        }
      } catch (error) {
        console.warn("审核队列加载失败：", error);
        if (!cancelled) setQueue([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  useEffect(() => {
    if (!detail || startedAuditSubmissionIdsRef.current.has(detail.submission.id)) {
      return;
    }
    startedAuditSubmissionIdsRef.current.add(detail.submission.id);
    appendReviewStartedAuditSafely(detail);
  }, [detail]);

  useEffect(() => {
    if (detail) {
      // 深拷贝当前提交答案作为修订初值，避免直接改动原对象。
      const source = detail.submission.answers ?? {};
      setCorrectedAnswers(JSON.parse(JSON.stringify(source)) as Record<string, unknown>);
    }
  }, [detail]);

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await queryAuditEvents({ submissionId, limit: 30 });
        if (!cancelled) {
          setAuditEvents(response.events);
          setAuditEventsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setAuditEvents([]);
          setAuditEventsError(error instanceof Error ? error.message : "审计事件加载失败。");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submissionId, refreshTick]);

  const aiResult = detail?.aiResult?.aiResult;
  const aiTrace = (detail as ReviewDetailWithTrace | null)?.aiTrace;
  const answers = (detail?.submission.answers ?? {}) as Record<string, unknown>;
  const sourcePayload = (detail?.item.sourcePayload ?? {}) as Record<string, unknown>;
  const dimensionScores = useMemo(
    () =>
      aiResult?.dimensionScores?.length
        ? aiResult.dimensionScores
        : [],
    [aiResult],
  );
  const previewPatches = useMemo<ReviewPatch[]>(
    () => computeReviewPatches(answers, correctedAnswers),
    [answers, correctedAnswers],
  );

  const handleSubmit = async (mode: ReviewActionMode) => {
    if (!submissionId || !detail) return;

    const trimmedComment = comments.trim();
    // 字段级修订直接对比原答案与修订对象生成 patches（无需解析 JSON 文本）。
    const patches = computeReviewPatches(answers, correctedAnswers);

    // 提交侧 guard（不仅靠按钮 disabled）：打回必须有审核意见；修订提交必须有字段级 patch。
    if (mode === "RETURN" && trimmedComment.length === 0) {
      setDecisionMessage("打回前请填写审核意见，便于标注员修正。");
      return;
    }
    if (mode === "REVISE" && patches.length === 0) {
      setDecisionMessage("修订提交前请至少修改一个字段。");
      return;
    }

    const apiDecision: ReviewDecision = mode === "RETURN" ? "RETURN" : "PASS";
    // 仅「修订提交」携带字段级 patch；纯通过 / 打回不夹带修订。
    const requestPatches = mode === "REVISE" && patches.length > 0 ? patches : undefined;
    const sentPatchCount = requestPatches?.length ?? 0;

    try {
      setDeciding(true);
      const request: ReviewDecisionRequest =
        apiDecision === "PASS"
          ? {
              submissionId: submissionId as ReviewDecisionRequest["submissionId"],
              stage: "HUMAN_REVIEW",
              decision: "PASS",
              comments: trimmedComment ? [{ message: trimmedComment }] : undefined,
              patches: requestPatches,
            }
          : {
              submissionId: submissionId as ReviewDecisionRequest["submissionId"],
              stage: "HUMAN_REVIEW",
              decision: "RETURN",
              // 真实审核意见，不再用伪造默认值兜底（此前空意见会被默认文案绕过必填校验）。
              reason: trimmedComment,
              comments: [{ message: trimmedComment }],
            };
      await claimReview(submissionId).catch(() => undefined);
      const response = await decideReview(submissionId, request);
      setDecisionMessage(
        mode === "RETURN"
          ? "已打回，等待标注员修改后重新提交。"
          : mode === "REVISE"
            ? "已保存字段修订并通过，结果进入可导出数据。"
            : "审核通过，结果已进入可导出数据。",
      );
      const reviewDurationMs = Math.max(0, Date.now() - reviewOpenedAtMsRef.current);
      appendReviewSubmittedAuditSafely({
        detail,
        decision: apiDecision,
        response,
        reviewDurationMs,
        commentLength: trimmedComment.length,
        patchCount: sentPatchCount,
      });
      if (requestPatches && requestPatches.length > 0) {
        appendReviewDiffGeneratedAuditSafely({
          detail,
          decision: apiDecision,
          response,
          patches: requestPatches,
          reviewDurationMs,
          correctedAnswers,
        });
      }
      window.setTimeout(() => navigate(RoutePath.REVIEWER_QUEUE), 650);
    } catch (error) {
      console.warn("提交审核决策失败：", error);
      setDecisionMessage(error instanceof Error ? `审核提交失败：${error.message}` : "审核提交失败，请稍后重试。");
    } finally {
      setDeciding(false);
    }
  };

  const requestSubmit = (mode: ReviewActionMode) => {
    // 确认前再次本地校验，避免确认弹窗后才发现不合法。
    if (mode === "RETURN" && comments.trim().length === 0) {
      setDecisionMessage("打回前请填写审核意见，便于标注员修正。");
      return;
    }
    if (mode === "REVISE" && previewPatches.length === 0) {
      setDecisionMessage("修订提交前请至少修改一个字段。");
      return;
    }
    const suppressKey = mode === "RETURN" ? CONFIRM_KEYS.return : CONFIRM_KEYS.approve;
    if (shouldSuppressConfirm(suppressKey)) {
      void handleSubmit(mode);
      return;
    }
    setPendingMode(mode);
  };

  const decisionConfirmCopy =
    pendingMode === "RETURN"
      ? {
          title: "确认打回提交？",
          description: "打回后标注员需要重新修改并提交。",
          confirmText: "打回",
          suppressLabel: "本次会话不再提醒打回确认",
          tone: "danger" as const,
          suppressKey: CONFIRM_KEYS.return,
        }
      : pendingMode === "REVISE"
        ? {
            title: "确认保存修订并通过？",
            description: "将记录字段级修订，并把该提交标记为通过、进入可导出数据。",
            confirmText: "保存并通过",
            suppressLabel: "本次会话不再提醒通过确认",
            tone: "primary" as const,
            suppressKey: CONFIRM_KEYS.approve,
          }
        : {
            title: "确认审核通过？",
            description: "通过后该提交将进入可导出数据。",
            confirmText: "通过",
            suppressLabel: "本次会话不再提醒审核通过确认",
            tone: "primary" as const,
            suppressKey: CONFIRM_KEYS.approve,
          };

  return {
    actionMode,
    aiResult,
    aiTrace,
    answers,
    auditEvents,
    auditEventsError,
    comments,
    correctedAnswers,
    deciding,
    decisionConfirmCopy,
    decisionMessage,
    detail,
    dimensionScores,
    handleSubmit,
    loading,
    pendingMode,
    previewPatches,
    queue,
    requestSubmit,
    setActionMode,
    setComments,
    setCorrectedAnswers,
    setPendingMode,
    setRefreshTick,
    setTimelineOpen,
    sourcePayload,
    timelineOpen,
  };
}
