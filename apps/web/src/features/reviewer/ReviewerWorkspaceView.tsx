import { Link } from "react-router";
import type { AIPrecheckDecision } from "@labelhub/contracts";
import type { ReviewQueueItem } from "../../api/reviewer";
import { Badge, Button, Card, HelpDisclosure, Textarea } from "../../ui/primitives";
import { formatBeijingClock } from "../../utils/formatTime";
import { getQueueDisplay } from "./review-display";
import { isBatchSelectable, type DimensionScoreState, type QueueFilter } from "./reviewerWorkspaceModel";
import type { useReviewerWorkspaceController } from "./useReviewerWorkspaceController";

type ReviewerWorkspaceController = ReturnType<typeof useReviewerWorkspaceController>;

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

// AI 预审代理给出的「原始建议」，与人工最终决策相互独立。
// 之前徽章误把 submission.status（含人工结论）当成「AI 建议」，会出现
// 「四维全通过却显示 AI 建议已打回」的自相矛盾——实为人工打回，AI 其实建议通过。
function aiDecisionLabel(decision: AIPrecheckDecision | null | undefined): string {
  if (decision === "PASS") return "建议通过";
  if (decision === "RETURN") return "建议打回";
  if (decision === "NEED_HUMAN_REVIEW") return "建议转人工";
  return "未产出";
}

function aiDecisionTone(decision: AIPrecheckDecision | null | undefined): "success" | "warning" | "danger" | "default" {
  if (decision === "PASS") return "success";
  if (decision === "RETURN") return "danger";
  if (decision === "NEED_HUMAN_REVIEW") return "warning";
  return "default";
}

// 终态结论徽章。RETURNED/REJECTED/ACCEPTED 既可能由人工作出，也可能由 AI 自动流转
// （AUTO_PASS_RETURN 策略）。据后端 humanDecided 区分归属，避免把 AI 自动决策误标成「人工」：
//   人工已介入 → 「人工 · 已通过/已打回」
//   AI 自动流转 → 「AI 自动 · 已通过/已打回」
// 尚未产生终态（待审/审核中）时返回 null，不展示。
function outcomeBadge(
  status: ReviewQueueItem["submission"]["status"],
  humanDecided: boolean | undefined,
): { actor: string; label: string } | null {
  let label: string | null = null;
  if (status === "ACCEPTED") label = "已通过";
  else if (status === "RETURNED" || status === "REJECTED") label = "已打回";
  if (label === null) return null;
  return { actor: humanDecided ? "人工" : "AI 自动", label };
}

// 侧边栏队列徽章。此前误用 statusLabel(submission.status)：NEEDS_HUMAN_REVIEW/
// HUMAN_REVIEWING 被一律标成「建议打回」，但该状态仅表示「已转人工」，不代表 AI 结论
// （advisory 模式下高分提交也进此状态）——导致整列恒显「建议打回」，与详情页头部自相矛盾。
// 现按详情页头部同款逻辑取真实 aiDecision / flowMode：
//   终态 → 已通过/已打回；HUMAN_REVIEW_ONLY → 中性质检提示；否则展示 AI 原始建议。
function queueBadge(item: ReviewQueueItem): { label: string; tone: "success" | "warning" | "danger" | "default" } {
  const status = item.submission.status;
  if (status === "ACCEPTED") return { label: "已通过", tone: "success" };
  if (status === "RETURNED" || status === "REJECTED") return { label: "已打回", tone: "danger" };
  if (item.flowMode === "HUMAN_REVIEW_ONLY") return { label: "质检提示", tone: "default" };
  const decision = item.aiDecision as AIPrecheckDecision | null;
  return { label: aiDecisionLabel(decision), tone: aiDecisionTone(decision) };
}

function formatTime(value: string): string {
  return formatBeijingClock(value);
}


export function ReviewerWorkspaceView({ controller }: { controller: ReviewerWorkspaceController }) {
  const {
    batchMessage, batchReturnReason, batching, counts, filter, filteredSubmissions,
    handleBatchDecision, loadCounts, loadQueue, loading, offlineNotice, selected,
    selectedBatchIds, selectedBatchItems, selectedDimensionScoreState, selectedDisplay,
    setBatchReturnReason, setFilter, setSelectedId, submissions, toggleBatchId,
  } = controller;
  if (loading) {
    return <Card className="state-panel">加载 AI 预审队列中...</Card>;
  }

  return (
    <div className="review-ai-page">
      <section className="review-ai-header">
        <div>
          <h1>AI 自动预审队列</h1>
          <p>处理 AI 预审结果与人工决策。</p>
        </div>
        <div className="review-ai-header__meta">
          <Badge tone="success">服务在线</Badge>
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
        </div>
        {counts.pending + counts.passed + counts.returned === 0 ? (
          <div className="empty-state">
            暂无审核记录。完成审核后，这里会显示你的审核反馈与退回记录。
          </div>
        ) : (
          <div className="reviewer-overview__grid">
            <div className="reviewer-overview__item reviewer-overview__item--warning">
              <span>待我处理</span>
              <strong>{counts.pending}</strong>
            </div>
            <div className="reviewer-overview__item reviewer-overview__item--success">
              <span>当前队列已通过</span>
              <strong>{counts.passed}</strong>
            </div>
            <div className="reviewer-overview__item reviewer-overview__item--danger">
              <span>当前队列已退回</span>
              <strong>{counts.returned}</strong>
            </div>
            <div className="reviewer-overview__item">
              <span>AI 预审辅助</span>
              <em>详情可查看评分与建议</em>
            </div>
          </div>
        )}
      </section>

      <div className="review-ai-layout">
        <Card className="review-ai-queue">
          <div className="review-ai-queue__toolbar">
            <span>预审结果异步更新</span>
            <Button
              type="button"
              tone="default"
              disabled={loading}
              onClick={() => {
                void loadQueue();
                void loadCounts();
              }}
            >
              刷新队列
            </Button>
          </div>
          <div className="review-ai-tabs" role="tablist" aria-label="AI 预审状态">
            {[
              ["pending", "待审核", counts.pending],
              ["passed", "已通过", counts.passed],
              ["returned", "已打回", counts.returned],
              ["manual", "转人工", counts.manual],
              ["failed", "失败", counts.failed],
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
                      {(() => {
                        const badge = queueBadge(item);
                        return <Badge tone={badge.tone}>{badge.label}</Badge>;
                      })()}
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
              <div className="review-ai-detail__badges">
                {selected.flowMode === "HUMAN_REVIEW_ONLY" ? (
                  // 仅质检提示模式：AI 不给通过/打回结论，只展示「AI 质检提示」中性标签，
                  // 通过/打回完全交由审核员决定。维度评分与问题提示仍在下方面板展示。
                  <Badge tone="default">AI 质检提示 · 由审核员决策</Badge>
                ) : selectedDimensionScoreState?.status === "ready" ? (
                  <Badge tone={aiDecisionTone(selectedDimensionScoreState.aiDecision)}>
                    AI 建议：{aiDecisionLabel(selectedDimensionScoreState.aiDecision)}
                  </Badge>
                ) : (
                  <Badge tone="default">AI 建议：加载中…</Badge>
                )}
                {(() => {
                  const outcome = outcomeBadge(selected.submission.status, selected.humanDecided);
                  return outcome ? (
                    <Badge tone={statusTone(selected.submission.status)}>
                      {outcome.actor}：{outcome.label}
                    </Badge>
                  ) : null;
                })()}
              </div>
            </section>

            <HelpDisclosure summary={`查看${selected.submission.status === "FINAL_REVIEWING" ? "终审" : "复审"}流程`}>
              AI 评分仅供参考；人工决策会写入审计记录。
            </HelpDisclosure>

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
              {(() => {
                // 已终态（已通过/已打回）的提交：动作栏展示审核结论与归属，而非「待人工复核 + 进入人工审核」。
                // 此前无论状态恒显待审核提示与再审按钮，导致刚打回的提交主面板仍像待办、结论只在右上角小徽章里——
                // 用户会误以为「已打回没有生效/没显示」。终态下只保留只读的「查看审核详情」入口。
                const outcome = outcomeBadge(selected.submission.status, selected.humanDecided);
                if (outcome) {
                  return (
                    <>
                      <div className="review-ai-actionbar__status">
                        <strong>{outcome.actor} · {outcome.label}</strong>
                        <span>
                          {selected.submission.status === "ACCEPTED"
                            ? "该提交已完成审核并通过。"
                            : "该提交已被打回，标注员可据反馈修改后重新提交。"}
                        </span>
                      </div>
                      <Link
                        className="lh-button review-ai-actionbar__btn"
                        to={`/reviewer/items/${selected.submission.id}`}
                      >
                        查看审核详情
                      </Link>
                    </>
                  );
                }
                return (
                  <>
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
                  </>
                );
              })()}
            </Card>

          </main>
        ) : (
          <Card className="state-panel">暂无预审提交。</Card>
        )}
      </div>
    </div>
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

function normalizeScorePercent(rawScore: number | null): number {
  if (rawScore == null) return 0;
  const normalizedScore = rawScore <= 1 ? rawScore * 100 : rawScore;
  return Math.max(0, Math.min(100, normalizedScore));
}

const DIMENSION_LABELS: Record<string, string> = {
  // ReviewConfig.dimensions_json 实际下发的 key（见 seed_demo / seed_competition）：
  // relevance / accuracy / compliance / safety —— 缺失这些映射会导致维度全部显示「未命名维度」。
  relevance: "内容相关性",
  accuracy: "内容准确性",
  compliance: "格式合规性",
  safety: "安全性",
  completeness: "完整性",
  readability: "可读性",
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
