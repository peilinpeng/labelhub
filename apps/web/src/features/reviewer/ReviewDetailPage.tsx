import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { queryAuditEvents } from "../../api/audit";
import { claimReview, decideReview, getReviewDetail } from "../../api/reviewer";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Textarea } from "../../ui/primitives";
import type { AuditEventRecord, ReviewDecisionRequest, ReviewDetailResponse, ReviewPatch } from "@labelhub/contracts";
import { getReviewerSubmissionDisplay, listKnownReviewDisplays } from "./review-display";
import { computeReviewPatches } from "./reviewer-diff";
import {
  appendAiReviewFeedbackAuditSafely,
  appendReviewDiffGeneratedAuditSafely,
  appendReviewStartedAuditSafely,
  appendReviewSubmittedAuditSafely,
  type AiReviewFeedback,
} from "./reviewer-audit-events";

interface ReviewDetailPageProps {
  role: Role;
}

type ReviewDecision = "PASS" | "RETURN";
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

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.join("，");
  if (value === undefined || value === null || value === "") return "未填写";
  return String(value);
}

export default function ReviewDetailPage({ role }: ReviewDetailPageProps) {
  void role;
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(submissionId ? [submissionId] : []);
  const [aiReviewFeedback, setAiReviewFeedback] = useState<AiReviewFeedback>("NOT_USED");
  const [correctedAnswersText, setCorrectedAnswersText] = useState("");
  const [correctedAnswersParseError, setCorrectedAnswersParseError] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditEventsError, setAuditEventsError] = useState<string | null>(null);
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
  }, [submissionId]);

  useEffect(() => {
    setAiReviewFeedback("NOT_USED");
  }, [submissionId]);

  useEffect(() => {
    if (!detail || startedAuditSubmissionIdsRef.current.has(detail.submission.id)) {
      return;
    }
    startedAuditSubmissionIdsRef.current.add(detail.submission.id);
    appendReviewStartedAuditSafely(detail);
  }, [detail]);

  useEffect(() => {
    if (detail) {
      setCorrectedAnswersText(JSON.stringify(detail.submission.answers ?? {}, null, 2));
      setCorrectedAnswersParseError(null);
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
  }, [submissionId]);

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
  const previewPatches = useMemo<ReviewPatch[]>(() => {
    try {
      const parsed = JSON.parse(correctedAnswersText) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
      return computeReviewPatches(answers, parsed as Record<string, unknown>);
    } catch {
      return [];
    }
  }, [answers, correctedAnswersText]);

  const handleDecision = async (decision: ReviewDecision) => {
    if (!submissionId || !detail) return;

    // 解析修正答案并计算 patches
    let patches: ReturnType<typeof computeReviewPatches> = [];
    let parsedCorrectedAnswers: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(correctedAnswersText);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setCorrectedAnswersParseError("修正答案必须是 JSON 对象，无法提交。");
        return;
      }
      parsedCorrectedAnswers = parsed as Record<string, unknown>;
      patches = computeReviewPatches(answers, parsedCorrectedAnswers);
      setCorrectedAnswersParseError(null);
    } catch {
      setCorrectedAnswersParseError("修正答案 JSON 格式不正确，无法提交。");
      return;
    }

    try {
      setDeciding(true);
      const requestPatches = patches.length > 0 ? patches : undefined;
      const request: ReviewDecisionRequest =
        decision === "PASS"
          ? {
              submissionId: submissionId as ReviewDecisionRequest["submissionId"],
              stage: "HUMAN_REVIEW",
              decision,
              comments: comments ? [{ message: comments }] : undefined,
              patches: requestPatches,
            }
          : {
              submissionId: submissionId as ReviewDecisionRequest["submissionId"],
              stage: "HUMAN_REVIEW",
              decision,
              reason: comments || "需要标注员重新修改后提交。",
              comments: comments ? [{ message: comments }] : undefined,
              patches: requestPatches,
            };
      await claimReview(submissionId).catch(() => undefined);
      const response = await decideReview(submissionId, request);
      setDecisionMessage(decision === "PASS" ? "审核通过，结果已进入可导出数据。" : "已打回，等待标注员修改后重新提交。");
      const reviewDurationMs = Math.max(0, Date.now() - reviewOpenedAtMsRef.current);
      appendReviewSubmittedAuditSafely({
        detail,
        decision,
        response,
        reviewDurationMs,
        commentLength: comments.length,
        patchCount: patches.length,
      });
      if (patches.length > 0) {
        appendReviewDiffGeneratedAuditSafely({
          detail,
          decision,
          response,
          patches,
          reviewDurationMs,
          correctedAnswers: parsedCorrectedAnswers,
        });
      }
      if (aiResult) {
        appendAiReviewFeedbackAuditSafely({
          detail,
          response,
          feedback: aiReviewFeedback,
          aiConfidence: aiResult.confidence,
          aiDimensionCount: aiResult.dimensionScores.length,
        });
      }
      window.setTimeout(() => navigate(RoutePath.REVIEWER_QUEUE), 650);
    } catch (error) {
      console.warn("提交审核决策失败：", error);
      setDecisionMessage("审核提交失败，请稍后重试。");
    } finally {
      setDeciding(false);
    }
  };

  const requestDecision = (decision: ReviewDecision) => {
    const suppressKey = decision === "PASS" ? CONFIRM_KEYS.approve : CONFIRM_KEYS.return;
    if (shouldSuppressConfirm(suppressKey)) {
      void handleDecision(decision);
      return;
    }
    setPendingDecision(decision);
  };

  const decisionConfirmCopy =
    pendingDecision === "PASS"
      ? {
          title: "确认审核通过？",
          description: "通过后该提交将进入可导出数据。",
          confirmText: "通过",
          suppressLabel: "本次会话不再提醒审核通过确认",
          tone: "primary" as const,
          suppressKey: CONFIRM_KEYS.approve,
        }
      : {
          title: "确认打回提交？",
          description: "打回后标注员需要重新修改并提交。",
          confirmText: "打回",
          suppressLabel: "本次会话不再提醒打回确认",
          tone: "danger" as const,
          suppressKey: CONFIRM_KEYS.return,
        };

  if (loading) {
    return <Card className="state-panel">加载人工审核详情中...</Card>;
  }

  if (!detail) {
    return <Card className="state-panel danger-text">审核详情不存在</Card>;
  }

  const display = getReviewerSubmissionDisplay(detail.submission.id) ?? {
    id: detail.submission.id,
    title: valueText(answers.cleaned_title ?? answers.news_title ?? sourcePayload.title ?? detail.item.id),
    taskTitle: detail.task.title,
    labeler: detail.submission.labelerId,
    payload: answers,
    previousPayload: sourcePayload,
    issue: aiResult?.summary ?? "该提交需要人工确认字段完整性和审核结论。",
    recommendation: "待人工复核",
  };
  const queueItems = listKnownReviewDisplays();
  const reviewStage = detail.submission.status === "FINAL_REVIEWING" ? "FINAL_REVIEW" : "HUMAN_REVIEW";
  const reviewStageLabel = reviewStage === "FINAL_REVIEW" ? "终审视图" : "复审视图";
  const reviewPolicyLabel = detail.task.reviewPolicy.type === "DOUBLE_REVIEW" ? "双轮审核" : "单轮审核";

  return (
    <div className="review-human-page">
      <Card className="review-human-list">
        <div className="review-human-tabs">
          <button className="review-human-tab review-human-tab--active" type="button">当前详情</button>
        </div>
        <div className="review-human-batch">
          <label>
            <input
              type="checkbox"
              checked={selectedIds.length > 0}
              onChange={(event) => setSelectedIds(event.target.checked ? [detail.submission.id] : [])}
            />
            已选 {selectedIds.length} 条
          </label>
          <button type="button" disabled title="批量操作请在审核队列页选择已领取项后执行">批量通过</button>
          <button type="button" disabled title="批量操作请在审核队列页选择已领取项后执行">批量打回</button>
        </div>
        <div className="review-human-queue">
          {queueItems.map((item) => (
            <Link
              className={item.id === detail.submission.id ? "review-human-queue-item review-human-queue-item--active" : "review-human-queue-item"}
              key={item.id}
              to={`/reviewer/items/${item.id}`}
            >
              <span>
                <input checked={item.id === detail.submission.id} readOnly type="checkbox" />
                {item.id}
              </span>
              <strong>{item.title}</strong>
              <small>
                <Badge tone="warning">{item.recommendation}</Badge>
              </small>
            </Link>
          ))}
          {queueItems.length === 0 ? <div className="empty-state">暂无真实队列摘要</div> : null}
        </div>
      </Card>

      <main className="review-human-main">
        <Card className="review-human-title-card">
          <section className="review-human-heading">
            <div>
              <h1>{detail.submission.id} · {display.title}</h1>
              <p>题目 {detail.item.id} · {display.taskTitle} · 模板 r{detail.schema.schemaVersionNo ?? "-"} · {reviewPolicyLabel}</p>
            </div>
            <Badge tone={reviewStage === "FINAL_REVIEW" ? "primary" : "warning"}>第 {detail.submission.attemptNo} 轮 · {reviewStageLabel}</Badge>
          </section>
          <div className="review-human-stage-strip">
            <span>AI 预审</span>
            <strong>{reviewStageLabel}</strong>
            <span>第 1 / 2 轮 diff</span>
            <span>AI 评语</span>
            <span>完整审计时间线</span>
          </div>
        </Card>

        <div className="review-human-compare">
          <Card className="review-human-compare-card">
            <h3>原始数据</h3>
            <dl>
              <dt>cleaned_title</dt>
              <dd>{valueText(display.previousPayload.cleaned_title ?? display.previousPayload.news_title ?? sourcePayload.title ?? display.title)}</dd>
              <dt>category</dt>
              <dd>{valueText(display.previousPayload.category ?? display.previousPayload.news_category ?? sourcePayload.category)}</dd>
              <dt>keywords</dt>
              <dd>{valueText(display.previousPayload.keywords ?? display.previousPayload.issue_tags ?? sourcePayload.keywords)}</dd>
            </dl>
          </Card>
          <Card className="review-human-compare-card">
            <h3>本轮提交</h3>
            <dl>
              <dt>cleaned_title</dt>
              <dd>{valueText(display.payload.cleaned_title ?? display.payload.news_title ?? answers.cleaned_title ?? answers.rewriteSuggestion ?? display.title)}</dd>
              <dt>category</dt>
              <dd><mark>{valueText(display.payload.category ?? display.payload.news_category ?? answers.category)}</mark></dd>
              <dt>keywords</dt>
              <dd><mark>{valueText(display.payload.keywords ?? display.payload.issue_tags ?? answers.keywords)}</mark></dd>
            </dl>
          </Card>
        </div>

        <Card className="review-human-ai">
          <div className="review-human-ai__head">
            <h3>AI 评语与预审结果</h3>
            <Badge tone="primary">{aiTrace?.modelPolicyId ?? "AI Agent"}</Badge>
          </div>
          {dimensionScores.length > 0 ? (
            <div className="review-human-ai__scores">
              {dimensionScores.map((score) => (
                <span key={score.key}>{score.key} <strong>{score.score}</strong></span>
              ))}
            </div>
          ) : <div className="empty-state">暂无真实 AI 维度评分</div>}
          <p>{aiResult?.summary ?? display.issue}</p>
          <div className="review-human-ai-trace">
            <span>Prompt 快照：{aiTrace?.promptSnapshotHash ?? "暂无"}</span>
            <span>调用状态：{aiTrace?.status ?? "暂无"}</span>
            <span>Token：{aiTrace?.totalTokens ?? "-"}</span>
            <span>耗时：{aiTrace?.latencyMs !== undefined && aiTrace?.latencyMs !== null ? `${aiTrace.latencyMs}ms` : "-"}</span>
          </div>
          {aiTrace?.promptTemplate ? (
            <details className="review-human-prompt">
              <summary>查看 Prompt 模板</summary>
              <pre>{aiTrace.promptTemplate}</pre>
            </details>
          ) : null}
          {aiResult ? (
            <fieldset className="review-human-ai-feedback">
              <legend>AI 预审是否对本次审核有帮助？</legend>
              <label>
                <input
                  checked={aiReviewFeedback === "HELPFUL"}
                  name={`ai-review-feedback-${detail.submission.id}`}
                  onChange={() => setAiReviewFeedback("HELPFUL")}
                  type="radio"
                  value="HELPFUL"
                />
                有帮助
              </label>
              <label>
                <input
                  checked={aiReviewFeedback === "NOT_HELPFUL"}
                  name={`ai-review-feedback-${detail.submission.id}`}
                  onChange={() => setAiReviewFeedback("NOT_HELPFUL")}
                  type="radio"
                  value="NOT_HELPFUL"
                />
                没帮助
              </label>
              <label>
                <input
                  checked={aiReviewFeedback === "NOT_USED"}
                  name={`ai-review-feedback-${detail.submission.id}`}
                  onChange={() => setAiReviewFeedback("NOT_USED")}
                  type="radio"
                  value="NOT_USED"
                />
                未参考
              </label>
            </fieldset>
          ) : null}
        </Card>

        <Card className="review-human-corrected-answers">
          <h3>审核修正答案</h3>
          <p className="review-human-corrected-answers__desc">
            审核员可以在这里修改标注答案；系统会在提交审核时生成字段级修订记录。
          </p>
          <label className="review-human-corrected-answers__label">
            <span>修正后的答案（JSON 格式）</span>
            <Textarea
              className="review-human-corrected-answers__textarea"
              rows={8}
              value={correctedAnswersText}
              onChange={(event) => {
                const text = event.target.value;
                setCorrectedAnswersText(text);
                try {
                  const parsed: unknown = JSON.parse(text);
                  setCorrectedAnswersParseError(
                    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
                      ? "必须是 JSON 对象"
                      : null,
                  );
                } catch {
                  setCorrectedAnswersParseError("JSON 格式不正确");
                }
              }}
            />
          </label>
          {correctedAnswersParseError !== null && (
            <p className="danger-text review-human-corrected-answers__error">{correctedAnswersParseError}</p>
          )}
          <div className="review-human-diff-preview">
            <strong>本轮 diff 预览（{previewPatches.length}）</strong>
            {previewPatches.length > 0 ? (
              <ul>
                {previewPatches.map((patch) => (
                  <li key={patch.fieldName}>
                    <span>{patch.fieldName}</span>
                    <em>{valueText(patch.previousValue)} → {valueText(patch.nextValue)}</em>
                  </li>
                ))}
              </ul>
            ) : <p>当前未产生字段修订。</p>}
          </div>
        </Card>

        <Card className="review-human-decision-card">
          <label className="review-human-opinion">
            <span>审核意见（打回时必填）</span>
            <Textarea value={comments} onChange={(event) => setComments(event.target.value)} />
          </label>

          {decisionMessage ? <Badge tone="success">{decisionMessage}</Badge> : null}

          <div className="review-human-tags">
            {["关键词缺失", "类目错误", "标题超长", "格式不规范"].map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setComments((current) => current.includes(tag) ? current : `${current}${current ? "；" : ""}${tag}`)}
              >
                {tag}
              </button>
            ))}
          </div>

          <div className="review-human-decisions">
            <Button tone="danger" onClick={() => requestDecision("RETURN")} disabled={deciding}>
              打回修改
              <span>返回标注员 · 第 3 轮</span>
            </Button>
            <Button disabled={deciding} onClick={() => requestDecision("PASS")}>
              保存修订并通过
              <span>生成 diff 后入库</span>
            </Button>
            <Button tone="success" onClick={() => requestDecision("PASS")} disabled={deciding}>
              通过入库
              <span>进入可导出数据</span>
            </Button>
          </div>
        </Card>
      </main>

      <aside className="review-human-aside">
        <Card className="review-human-metrics">
          <div><span>审核统计</span><strong>-</strong></div>
          <p className="page-subtitle">暂无真实个人审核统计接口数据</p>
        </Card>

        <Card className="review-human-timeline">
          <h3>审计时间线（{detail.submission.id}）</h3>
          <div className="review-human-history">
            {detail.history.map((record, index) => (
              <div key={record.id}>
                <strong>第 {index + 1} 轮 · {record.stage}</strong>
                <span>{record.decision} · {new Date(record.createdAt).toLocaleString("zh-CN")}</span>
              </div>
            ))}
            {detail.auditLogs.map((log) => (
              <div key={log.id}>
                <strong>{log.action}</strong>
                <span>{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
              </div>
            ))}
            {auditEvents.map((event) => (
              <div key={event.id}>
                <strong>{event.type}</strong>
                <span>{new Date(event.createdAt).toLocaleString("zh-CN")} · {event.actor.role}</span>
              </div>
            ))}
          </div>
          {auditEventsError ? <p className="danger-text">{auditEventsError}</p> : null}
          {detail.history.length === 0 && detail.auditLogs.length === 0 && auditEvents.length === 0 && !auditEventsError ? (
            <div className="empty-state">暂无真实审计时间线数据</div>
          ) : null}
        </Card>

        <Link className="lh-button" to={RoutePath.REVIEWER_QUEUE}>返回 AI 预审队列</Link>
      </aside>

      <ConfirmDialog
        open={pendingDecision !== null}
        title={decisionConfirmCopy.title}
        description={decisionConfirmCopy.description}
        confirmText={decisionConfirmCopy.confirmText}
        cancelText="取消"
        tone={decisionConfirmCopy.tone}
        suppressLabel={decisionConfirmCopy.suppressLabel}
        onCancel={() => setPendingDecision(null)}
        onConfirm={(suppress) => {
          const decision = pendingDecision;
          if (!decision) return;
          if (suppress) suppressConfirmForSession(decisionConfirmCopy.suppressKey);
          setPendingDecision(null);
          void handleDecision(decision);
        }}
      />
    </div>
  );
}
