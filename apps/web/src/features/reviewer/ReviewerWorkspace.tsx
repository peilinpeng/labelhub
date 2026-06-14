import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Role } from "../../app/routes";
import { batchDecideReview, claimReview, getReviewDetail, listReviewQueue, type ReviewQueueItem } from "../../api/reviewer";
import type { ReviewDecisionRequest } from "@labelhub/contracts";
import { Badge, Button, Card, Textarea } from "../../ui/primitives";
import { formatBeijingClock } from "../../utils/formatTime";
import { getQueueDisplay } from "./review-display";

interface ReviewerWorkspaceProps {
  role: Role;
}

type QueueFilter = "pending" | "passed" | "returned" | "manual" | "failed";

type DimensionScore = {
  key: string;
  score: number | null;
  reason?: string;
};

type DimensionScoreState =
  | { status: "loading"; scores: DimensionScore[] }
  | { status: "ready"; scores: DimensionScore[] }
  | { status: "error"; scores: DimensionScore[] };

function statusLabel(status: ReviewQueueItem["submission"]["status"]): string {
  if (status === "AI_PASSED") return "建议通过";
  if (status === "NEEDS_HUMAN_REVIEW" || status === "HUMAN_REVIEWING") return "建议打回";
  if (status === "RETURNED" || status === "REJECTED") return "已打回";
  if (status === "ACCEPTED") return "已通过";
  return "待处理";
}

function statusTone(status: ReviewQueueItem["submission"]["status"]): "success" | "warning" | "danger" | "default" {
  if (status === "AI_PASSED" || status === "ACCEPTED") return "success";
  if (status === "NEEDS_HUMAN_REVIEW" || status === "HUMAN_REVIEWING") return "warning";
  if (status === "RETURNED" || status === "REJECTED") return "danger";
  return "default";
}

function formatTime(value: string): string {
  return formatBeijingClock(value);
}

function reviewQueueStatusFor(filter: QueueFilter): string | undefined {
  if (filter === "pending" || filter === "manual") return "NEEDS_HUMAN_REVIEW";
  if (filter === "passed") return "ACCEPTED";
  if (filter === "returned") return "RETURNED";
  return undefined;
}

export default function ReviewerWorkspace({ role }: ReviewerWorkspaceProps) {
  void role;
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

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listReviewQueue({ status: reviewQueueStatusFor(filter) });
        // 后端/mock 可能返回缺少嵌套 submission 的脏数据，统一在入口过滤，
        // 保证下游 stats / 过滤 / 选中 / 渲染读取 item.submission.* 时不会崩溃。
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
    })();
  }, [filter]);

  const stats = useMemo(() => {
    const pending = submissions.filter((item) => item.submission.status === "NEEDS_HUMAN_REVIEW").length;
    const passed = submissions.filter((item) => item.submission.status === "AI_PASSED" || item.submission.status === "ACCEPTED").length;
    const returned = submissions.filter((item) => item.submission.status === "RETURNED" || item.submission.status === "REJECTED").length;
    return { pending, passed, returned, manual: pending, failed: 0 };
  }, [submissions]);

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
        if (!cancelled) {
          setDimensionScoresBySubmissionId((current) => ({
            ...current,
            [submissionId]: { status: "ready", scores },
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
      if (decision === "RETURN" && successCount > 0) setBatchReturnReason("");
    } catch (error) {
      setBatchMessage(error instanceof Error ? `批量操作失败：${error.message}` : "批量操作失败。");
    } finally {
      setBatching(false);
    }
  };

  if (loading) {
    return <Card className="state-panel">加载 AI 预审队列中...</Card>;
  }

  return (
    <div className="review-ai-page">
      <section className="review-ai-header">
        <div>
          <h1>AI 自动预审队列</h1>
          <p>这里展示任务负责人配置后的 AI 预审结果。审核员负责人工审核验收：复审 / 终审、查看第 1 / 2 轮差异、参考 AI 评语、批量处理和审计追踪。</p>
        </div>
        <div className="review-ai-header__meta">
          <Badge tone="success">服务在线</Badge>
          <span>预审规则由任务负责人维护</span>
          <span>当前角色：审核员，只提交人工决策</span>
        </div>
      </section>

      {offlineNotice ? (
        <div className="offline-banner">
          <strong>接口异常</strong>
          <span>未加载任何占位队列。{offlineNotice}</span>
        </div>
      ) : null}

      <section className="reviewer-overview" aria-label="我的审核概览">
        <div className="reviewer-overview__head">
          <h2>我的审核概览</h2>
          <span>仅展示与你审核任务相关的真实队列数据</span>
        </div>
        {stats.pending + stats.passed + stats.returned === 0 ? (
          <div className="empty-state">
            暂无审核记录。完成审核后，这里会显示你的审核反馈与退回记录。
          </div>
        ) : (
          <div className="reviewer-overview__grid">
            <div className="reviewer-overview__item reviewer-overview__item--warning">
              <span>待我处理</span>
              <strong>{stats.pending}</strong>
            </div>
            <div className="reviewer-overview__item reviewer-overview__item--success">
              <span>当前队列已通过</span>
              <strong>{stats.passed}</strong>
            </div>
            <div className="reviewer-overview__item reviewer-overview__item--danger">
              <span>当前队列已退回</span>
              <strong>{stats.returned}</strong>
            </div>
            <div className="reviewer-overview__item">
              <span>AI 预审辅助</span>
              <em>进入审核详情可查看 AI 评语与维度评分，作为人工决策参考。</em>
            </div>
          </div>
        )}
      </section>

      <div className="review-ai-layout">
        <Card className="review-ai-queue">
          <div className="review-ai-tabs" role="tablist" aria-label="AI 预审状态">
            {[
              ["pending", "待审核", stats.pending],
              ["passed", "已通过", stats.passed],
              ["returned", "已打回", stats.returned],
              ["manual", "转人工", stats.manual],
              ["failed", "失败", stats.failed],
            ].map(([key, label, count]) => (
              <button
                className={filter === key ? "review-ai-tab review-ai-tab--active" : "review-ai-tab"}
                key={key}
                type="button"
                onClick={() => setFilter(key as QueueFilter)}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>

          <div className="review-ai-batchbar">
            <span>已选 {selectedBatchItems.length} 条可批量审核</span>
            <Button
              type="button"
              tone="success"
              disabled={batching || selectedBatchItems.length === 0}
              onClick={() => void handleBatchDecision("PASS")}
            >
              批量通过
            </Button>
            <Button
              type="button"
              tone="danger"
              disabled={batching || selectedBatchItems.length === 0 || batchReturnReason.trim().length === 0}
              onClick={() => void handleBatchDecision("RETURN")}
            >
              批量打回
            </Button>
          </div>
          {selectedBatchItems.length > 0 ? (
            <label className="review-ai-batchbar__reason">
              <span>统一打回原因（批量打回必填）</span>
              <Textarea
                value={batchReturnReason}
                placeholder="请说明打回原因，将应用到所选全部提交，便于标注员修正"
                onChange={(event) => setBatchReturnReason(event.target.value)}
              />
            </label>
          ) : null}
          {batchMessage ? <p className="review-ai-batchbar__message">{batchMessage}</p> : null}

          <div className="review-ai-list">
            {filteredSubmissions.map((item) => {
              const isActive = item.submission.id === selected?.submission.id;
              const display = getQueueDisplay(item);
              const selectable = isBatchSelectable(item);
              const isChecked = selectedBatchIds.includes(item.submission.id);
              const rowClass = [
                "review-ai-row",
                isActive ? "review-ai-row--active" : "",
                isChecked ? "review-ai-row--checked" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div className={rowClass} key={item.submission.id}>
                  <label
                    className="review-ai-row__check"
                    title={selectable ? "选择以加入批量审核" : "该状态不可批量审核"}
                  >
                    <input
                      checked={isChecked}
                      disabled={!selectable}
                      type="checkbox"
                      onChange={() => toggleBatchId(item.submission.id)}
                    />
                  </label>
                  <button
                    className={isActive ? "review-ai-item review-ai-item--active" : "review-ai-item"}
                    type="button"
                    onClick={() => setSelectedId(item.submission.id)}
                  >
                    <strong className="review-ai-item__title">{display.title}</strong>
                    <span className="review-ai-item__meta">
                      第 {item.submission.attemptNo} 轮 · {formatTime(item.submission.createdAt)}
                    </span>
                    <span className="review-ai-item__sub">标注员 {item.submission.labelerId}</span>
                    <span className="review-ai-item__badges">
                      <Badge tone={statusTone(item.submission.status)}>{statusLabel(item.submission.status)}</Badge>
                      {item.submission.status === "FINAL_REVIEWING" ? <Badge tone="primary">终审</Badge> : <Badge tone="default">复审</Badge>}
                    </span>
                  </button>
                </div>
              );
            })}
            {filteredSubmissions.length === 0 ? (
              <div className="empty-state">{offlineNotice ? "审核队列加载失败，请稍后重试。" : "暂无待审核任务"}</div>
            ) : null}
          </div>
        </Card>

        {selected ? (
          <main className="review-ai-detail">
            <section className="review-ai-detail__heading">
              <div>
                <h2>{formatSubmissionTitle(selectedDisplay?.title, selected.submission.id, selectedIndex(submissions, selected.submission.id))}提交复核</h2>
                <p>
                  提交号：{shortSubmissionId(selected.submission.id)} · 第 {selected.submission.attemptNo} 轮 · 提交于{" "}
                  {formatTime(selected.submission.createdAt)} · 标注员{" "}
                  {selectedDisplay?.labeler ?? selected.submission.labelerId}
                </p>
              </div>
              <Badge tone={statusTone(selected.submission.status)}>AI 建议：{statusLabel(selected.submission.status)}</Badge>
            </section>

            <div className="review-flow-strip">
              <span>AI 预审结果</span>
              <strong>{selected.submission.status === "FINAL_REVIEWING" ? "终审视图" : "复审视图"}</strong>
              <span>第 {selected.submission.attemptNo} 轮 diff</span>
              <span>人工决策写入审计</span>
            </div>

            <div className="review-ai-insight-grid">
              <Card className="review-ai-block">
                <div className="review-ai-block__head">
                  <h3>提交内容</h3>
                  <span>字段视图</span>
                </div>
                {Object.keys(selectedDisplay?.payload ?? {}).length > 0 ? (
                  <dl className="review-field-list">
                    {Object.entries(selectedDisplay?.payload ?? {}).map(([key, value]) => (
                      <div className="review-field" key={key}>
                        <dt>{fieldLabel(key)}</dt>
                        <dd>{formatFieldValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <div className="review-ai-empty">
                    <strong>暂无提交字段</strong>
                    <span>本条提交未携带可展示的字段内容。</span>
                  </div>
                )}
              </Card>

              <Card className="review-ai-block">
                <div className="review-ai-block__head">
                  <h3>AI 预审代理</h3>
                  <span>维度评分</span>
                </div>
                <DimensionScoresPreview state={selectedDimensionScoreState} />
              </Card>
            </div>

            <Card className="review-ai-actionbar">
              <div className="review-ai-actionbar__status">
                <strong>{selectedDisplay?.recommendation ?? statusLabel(selected.submission.status)}</strong>
                <span>{humanizeAiReason(selectedDisplay?.issue ?? "该提交需要人工确认字段完整性和审核结论。")}</span>
              </div>
              <Link
                className="lh-button lh-button--primary review-ai-actionbar__btn"
                to={`/reviewer/items/${selected.submission.id}`}
              >
                进入人工审核
              </Link>
            </Card>

          </main>
        ) : (
          <Card className="state-panel">暂无预审提交。</Card>
        )}
      </div>
    </div>
  );
}

// 队列里处于「待人工处理」阶段的提交才允许批量勾选：
// 待人工审核 / 人工审核中 / 终审中。已终态（ACCEPTED / RETURNED / REJECTED）
// 与仅 AI 通过（AI_PASSED）的项不参与批量人工决策，保持不可选。
function isBatchSelectable(item: ReviewQueueItem): boolean {
  return (
    item.submission.status === "NEEDS_HUMAN_REVIEW" ||
    item.submission.status === "HUMAN_REVIEWING" ||
    item.submission.status === "FINAL_REVIEWING"
  );
}

// 提交字段的人话标签：把技术 key 映射成审核员可读的中文，未知 key 原样保留。
const FIELD_LABELS: Record<string, string> = {
  submission_material: "补充审核材料",
  answer: "标注答案",
  title: "标题",
  content: "内容",
  category: "分类",
  evidence: "证据说明",
  comment: "备注",
  itemId: "数据编号",
  taskTitle: "所属任务",
  labeler: "标注员",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function formatFieldValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function DimensionScoresPreview({ state }: { state: DimensionScoreState | undefined }) {
  if (state?.status === "loading" || state === undefined) {
    return (
      <div className="review-ai-empty">
        <strong>正在加载 AI 评分...</strong>
        <span>维度评分会随当前选中的提交自动刷新。</span>
      </div>
    );
  }

  if (state.scores.length === 0) {
    return (
      <div className="review-ai-empty">
        <strong>本条提交暂未返回维度评分</strong>
        <span>当前提交暂无 AI 维度评分，可进入人工审核查看 AI 结论与字段级建议。</span>
      </div>
    );
  }

  return (
    <div className="review-ai-score-list" aria-label="AI 维度评分">
      <strong style={{ display: "block", marginBottom: 10 }}>已读取 {state.scores.length} 项 AI 维度评分</strong>
      {state.scores.map((score) => {
        const percent = normalizeScorePercent(score.score);
        const label = dimensionLabel(score.key);
        return (
          <div className="review-ai-score-row" key={score.key} style={{ gridTemplateColumns: "minmax(128px, 1fr) minmax(0, 2fr) 96px" }}>
            <span style={{ overflowWrap: "anywhere", wordBreak: "break-word" }} title={score.key}>{label}</span>
            <div>
              <div className="review-ai-score-track" aria-hidden="true">
                <span
                  className={percent >= 80 ? "review-ai-score-fill review-ai-score-fill--success" : "review-ai-score-fill"}
                  style={{ width: `${percent}%` }}
                />
              </div>
              {score.reason ? (
                <small style={{ display: "block", marginTop: 4, color: "#64748b", fontWeight: 700, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                  {humanizeAiReason(score.reason, score.key)}
                </small>
              ) : null}
            </div>
            <strong>{Math.round(percent)} 分 · {scoreVerdict(percent)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function normalizeDimensionScores(value: unknown): DimensionScore[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item == null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" && record.key.trim() ? record.key : "unknown";
    const rawScore = typeof record.score === "number" && Number.isFinite(record.score) ? record.score : null;
    const reason = typeof record.reason === "string" ? record.reason : undefined;
    return [{ key, score: rawScore, reason }];
  });
}

function normalizeScorePercent(rawScore: number | null): number {
  if (rawScore == null) return 0;
  const normalizedScore = rawScore <= 1 ? rawScore * 100 : rawScore;
  return Math.max(0, Math.min(100, normalizedScore));
}

const DIMENSION_LABELS: Record<string, string> = {
  content_accuracy: "内容准确性",
  format_compliance: "格式合规性",
  factuality: "事实准确性",
  category: "分类一致性",
  evidence: "证据充分性",
  format: "格式规范性",
};

function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? "未命名维度";
}

function scoreVerdict(percent: number): string {
  if (percent >= 80) return "通过";
  if (percent >= 60) return "需复核";
  return "不通过";
}

function humanizeAiReason(text?: string, dimensionKey?: string): string {
  if (!text) return "";
  let output = text
    .replace(/缺少具体的题目内容、标注答案和对应schema的详细信息，无法进行自动维度评分。/g, "提交内容较少，AI 无法判断答案是否符合题目要求，建议人工复核。")
    .replace(/目标标注schema/g, "目标标注规则")
    .replace(/标注schema/g, "标注规则")
    .replace(/schema/g, "表单规则")
    .replace(/自动维度评分/g, "自动评分")
    .replace(/自动预审打分/g, "自动评分");
  if (dimensionKey === "content_accuracy" && /缺少具体的题目内容|题目要求/.test(output)) {
    output = "提交内容较少，AI 无法判断答案是否准确，建议人工复核。";
  }
  return output;
}

function shortSubmissionId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}...${id.slice(-4)}` : id;
}

function selectedIndex(items: ReviewQueueItem[], submissionId: string): number {
  const index = items.findIndex((item) => item.submission.id === submissionId);
  return index >= 0 ? index + 1 : 1;
}

function formatSubmissionTitle(title: string | undefined, submissionId: string, index: number): string {
  if (!title || title === submissionId || /^sub_[a-z0-9]+$/i.test(title) || /^item_[a-z0-9]+$/i.test(title) || /^\d+$/.test(title)) {
    return `第 ${index} 条提交`;
  }
  return title;
}
