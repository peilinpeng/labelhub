import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { claimReview, decideReview, getReviewDetail } from "../../api/reviewer";
import { getReviewDetail as getMockReviewDetail } from "../../mocks/mock-db";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Textarea } from "../../ui/primitives";
import { applyDemoSubmissionState, DEMO_SUBMISSION_ID, reviewDemoSubmission } from "../../mocks/demo-workflow-store";
import type { ID, ReviewDecisionRequest, ReviewDetailResponse } from "@labelhub/contracts";
import { getReviewerSubmissionDisplay, listKnownReviewDisplays } from "./review-display";
import { computeReviewPatches } from "./reviewer-diff";
import {
  appendAiReviewFeedbackAuditSafely,
  appendReviewStartedAuditSafely,
  appendReviewSubmittedAuditSafely,
  type AiReviewFeedback,
} from "./reviewer-audit-events";

interface ReviewDetailPageProps {
  role: Role;
}

type ReviewDecision = "PASS" | "RETURN";

function getFallbackDetail(submissionId?: string): ReviewDetailResponse | undefined {
  const detail = getMockReviewDetail(submissionId ?? DEMO_SUBMISSION_ID) ?? getMockReviewDetail(DEMO_SUBMISSION_ID);
  if (!detail || !submissionId || detail.submission.id === submissionId) return detail;
  return {
    ...detail,
    submission: {
      ...detail.submission,
      id: submissionId as ID,
    },
  };
}

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
  const [comments, setComments] = useState("本轮修改已覆盖第 1 轮打回意见，关键词丰富度与类目准确性均达标。同意 AI 预审结论。");
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([submissionId ?? DEMO_SUBMISSION_ID]);
  const [aiReviewFeedback, setAiReviewFeedback] = useState<AiReviewFeedback>("NOT_USED");
  const [correctedAnswersText, setCorrectedAnswersText] = useState("");
  const [correctedAnswersParseError, setCorrectedAnswersParseError] = useState<string | null>(null);
  const startedAuditSubmissionIdsRef = useRef<Set<string>>(new Set());
  const reviewOpenedAtMsRef = useRef(Date.now());

  useEffect(() => {
    reviewOpenedAtMsRef.current = Date.now();
    void (async () => {
      try {
        setLoading(true);
        if (submissionId) {
          const data = await getReviewDetail(submissionId);
          setDetail({ ...data, submission: applyDemoSubmissionState(data.submission) });
        }
      } catch (error) {
        console.warn("Review detail API unavailable, using local detail.", error);
        const fallback = getFallbackDetail(submissionId);
        if (fallback) {
          setDetail({ ...fallback, submission: applyDemoSubmissionState(fallback.submission) });
        }
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

  const aiResult = detail?.aiResult?.aiResult;
  const answers = (detail?.submission.answers ?? {}) as Record<string, unknown>;
  const sourcePayload = (detail?.item.sourcePayload ?? {}) as Record<string, unknown>;
  const dimensionScores = useMemo(
    () =>
      aiResult?.dimensionScores?.length
        ? aiResult.dimensionScores
        : [
            { key: "综合", score: 86, reason: "整体可通过" },
            { key: "相关性", score: 92, reason: "与原始数据一致" },
            { key: "准确性", score: 84, reason: "字段含义明确" },
            { key: "格式合规", score: 88, reason: "满足提交规范" },
            { key: "安全", score: 99, reason: "无敏感风险" },
          ],
    [aiResult],
  );

  const handleDecision = async (decision: ReviewDecision) => {
    if (!submissionId || !detail) return;

    // 解析修正答案并计算 patches
    let patches: ReturnType<typeof computeReviewPatches> = [];
    try {
      const parsed: unknown = JSON.parse(correctedAnswersText);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setCorrectedAnswersParseError("修正答案必须是 JSON 对象，无法提交。");
        return;
      }
      patches = computeReviewPatches(answers, parsed as Record<string, unknown>);
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
      reviewDemoSubmission(decision);
      setDecisionMessage(decision === "PASS" ? "审核通过，结果已进入可导出数据。" : "已打回，等待标注员修改后重新提交。");
      appendReviewSubmittedAuditSafely({
        detail,
        decision,
        response,
        reviewDurationMs: Math.max(0, Date.now() - reviewOpenedAtMsRef.current),
        commentLength: comments.length,
        patchCount: patches.length,
      });
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
  const queueItems = listKnownReviewDisplays().map((item) => ({
    id: item.id,
    title: item.title,
    score: item.recommendation === "建议通过" ? 88 : item.recommendation === "已打回" ? 55 : 62,
    status: item.recommendation,
  }));

  return (
    <div className="review-human-page">
      <Card className="review-human-list">
        <div className="review-human-tabs">
          <button className="review-human-tab review-human-tab--active" type="button">待复核 <strong>47</strong></button>
          <button className="review-human-tab" type="button">建议通过 <strong>128</strong></button>
          <button className="review-human-tab" type="button">转人工 <strong>9</strong></button>
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
          <button type="button">批量通过</button>
          <button type="button">批量打回</button>
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
                {item.id} · 李雷 · 18:01:02
              </span>
              <strong>{item.title}</strong>
              <small>
                <Badge tone={item.score >= 80 ? "success" : "warning"}>AI {item.score}</Badge>
                <Badge tone={item.score >= 80 ? "success" : "warning"}>{item.status}</Badge>
              </small>
            </Link>
          ))}
        </div>
      </Card>

      <main className="review-human-main">
        <Card className="review-human-title-card">
          <section className="review-human-heading">
            <div>
              <h1>{detail.submission.id} · {display.title}</h1>
              <p>题目 {detail.item.id} · {display.taskTitle} · 模板 r{detail.schema.schemaVersionNo ?? 12}</p>
            </div>
            <Badge tone="warning">第 2 轮 · 复审中</Badge>
          </section>
        </Card>

        <div className="review-human-compare">
          <Card className="review-human-compare-card">
            <h3>第 1 轮提交（已打回）</h3>
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
            <h3>第 2 轮提交（本轮修改后）</h3>
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
            <h3>AI 预审 · 本轮重跑结果</h3>
            <Badge tone="primary">v2.3 · doubao-pro-32k</Badge>
          </div>
          <div className="review-human-ai__scores">
            {dimensionScores.map((score) => (
              <span key={score.key}>{score.key} <strong>{score.score}</strong></span>
            ))}
          </div>
          <p>{aiResult?.summary ?? display.issue}</p>
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
            Reviewer 可以在这里修改标注答案；系统会在提交审核时生成字段级 patches。
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
        </Card>

        <Card className="review-human-decision-card">
          <label className="review-human-opinion">
            <span>审核意见（打回时必填）</span>
            <Textarea value={comments} onChange={(event) => setComments(event.target.value)} />
          </label>

          {decisionMessage ? <Badge tone="success">{decisionMessage}</Badge> : null}

          <div className="review-human-tags">
            <button type="button">关键词缺失</button>
            <button type="button">类目错误</button>
            <button type="button">标题超长</button>
            <button type="button">格式不规范</button>
          </div>

          <div className="review-human-decisions">
            <Button tone="danger" onClick={() => requestDecision("RETURN")} disabled={deciding}>
              打回修改
              <span>返回标注员 · 第 3 轮</span>
            </Button>
            <Button disabled={deciding}>
              直接修订
              <span>审核员就地改写</span>
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
          <div><span>我今日已审</span><strong>214</strong></div>
          <div><span>我今日通过率</span><strong className="success-text">87%</strong></div>
          <div><span>待我审核</span><strong className="warning-text">47</strong></div>
          <div><span>SLA 剩余</span><strong className="primary-text">02:14:00</strong></div>
        </Card>

        <Card className="review-human-timeline">
          <h3>审计时间线（{detail.submission.id}）</h3>
          <div className="timeline">
            <div className="timeline-item"><strong>李雷</strong><span>05-16 14:22 · 第 1 轮提交</span></div>
            <div className="timeline-item"><strong>AI Agent</strong><span>05-16 14:22 · 预审 62 分 → 建议打回</span></div>
            <div className="timeline-item"><strong>王芳 · 复审</strong><span>05-16 15:08 · 采纳 AI 结论 → 打回</span></div>
            <div className="timeline-item"><strong>李雷</strong><span>05-16 18:01 · 第 2 轮提交</span></div>
            <div className="timeline-item"><strong>AI Agent</strong><span>05-16 18:01 · 重审 86 分 → 建议通过</span></div>
            <div className="timeline-item"><strong>王芳 · 复审中</strong><span>当前 · 本次决策将写入终审待办</span></div>
          </div>
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
