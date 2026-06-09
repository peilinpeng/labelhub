import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { queryAuditEvents } from "../../api/audit";
import { claimReview, decideReview, getReviewDetail } from "../../api/reviewer";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Input, Select, Textarea } from "../../ui/primitives";
import type { AuditEventRecord, ReviewDecisionRequest, ReviewDetailResponse, ReviewPatch } from "@labelhub/contracts";
import { AiAssistPanel } from "./AiAssistPanel";
import {
  actorRoleLabel,
  auditEventLabel,
  reviewDecisionLabel,
  reviewStageLabel as stageLabelText,
} from "./audit-humanize";
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
  const selectedIds = submissionId ? [submissionId] : [];
  const [aiReviewFeedback, setAiReviewFeedback] = useState<AiReviewFeedback>("NOT_USED");
  // 字段级修订：维护一个修订后的答案对象（按字段编辑），提交时与原答案做 shallow diff 生成 patches。
  const [correctedAnswers, setCorrectedAnswers] = useState<Record<string, unknown>>({});
  const [queueOpen, setQueueOpen] = useState(false);
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

  const handleDecision = async (decision: ReviewDecision) => {
    if (!submissionId || !detail) return;

    // 字段级修订直接对比原答案与修订对象生成 patches（无需解析 JSON 文本）。
    const parsedCorrectedAnswers: Record<string, unknown> = correctedAnswers;
    const patches = computeReviewPatches(answers, parsedCorrectedAnswers);

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
      <main className="review-human-main">
        <Card className="review-human-queue-bar">
          <button
            type="button"
            className="review-human-queue-bar__toggle"
            aria-expanded={queueOpen}
            onClick={() => setQueueOpen((open) => !open)}
          >
            <span className="review-human-queue-bar__title">审核队列</span>
            <span className="review-human-queue-bar__meta">已选 {selectedIds.length} 条 · 共 {queueItems.length} 条</span>
            <span className="review-human-queue-bar__chevron">{queueOpen ? "收起 ▲" : "展开 ▼"}</span>
          </button>
          {queueOpen ? (
            <div className="review-human-queue">
              {queueItems.map((item) => (
                <Link
                  className={item.id === detail.submission.id ? "review-human-queue-item review-human-queue-item--active" : "review-human-queue-item"}
                  key={item.id}
                  to={`/reviewer/items/${item.id}`}
                  title={`提交 ${item.id}`}
                >
                  <span>{item.taskTitle}</span>
                  <strong>{item.title}</strong>
                  <small>
                    <Badge tone="warning">{item.recommendation}</Badge>
                  </small>
                </Link>
              ))}
              {queueItems.length === 0 ? <div className="empty-state">暂无队列摘要</div> : null}
            </div>
          ) : null}
        </Card>

        <Card className="review-human-title-card">
          <section className="review-human-heading">
            <div className="review-human-heading__title" title={`提交 ${detail.submission.id} · 题目 ${detail.item.id}`}>
              <h1>{display.title}</h1>
              <p>{display.taskTitle} · 模板 r{detail.schema.schemaVersionNo ?? "-"} · {reviewPolicyLabel}</p>
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
          ) : <div className="empty-state">暂无 AI 维度评分</div>}
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

        <AiAssistPanel
          submissionId={detail.submission.id}
          onActionApplied={() => setRefreshTick((tick) => tick + 1)}
        />

        <Card className="review-human-corrected-answers">
          <h3>字段级修订</h3>
          <p className="review-human-corrected-answers__desc">
            审核员可以按字段修改提交内容，系统会在通过时生成字段级修订记录。
          </p>
          <FieldCorrectionPanel
            original={answers}
            corrected={correctedAnswers}
            onChange={setCorrectedAnswers}
          />
          <div className="review-human-diff-preview">
            <strong>本轮修订（{previewPatches.length}）</strong>
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
          <details className="review-human-advanced">
            <summary>高级：查看原始结构</summary>
            <pre className="review-human-advanced__json">{JSON.stringify(correctedAnswers, null, 2)}</pre>
          </details>
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
        </Card>

        <div className="review-human-actionbar">
          <Button tone="danger" onClick={() => requestDecision("RETURN")} disabled={deciding}>
            打回修改
            <span>返回标注员重新提交</span>
          </Button>
          <Button disabled={deciding} onClick={() => requestDecision("PASS")}>
            保存修订并通过
            <span>生成修订后入库</span>
          </Button>
          <Button tone="success" onClick={() => requestDecision("PASS")} disabled={deciding}>
            通过入库
            <span>进入可导出数据</span>
          </Button>
        </div>
      </main>

      <aside className="review-human-aside">
        <Card className="review-human-metrics">
          <div><span>审核统计</span><strong>—</strong></div>
          <p className="page-subtitle">暂无个人审核统计</p>
        </Card>

        <Card className="review-human-timeline">
          <h3>审计时间线</h3>
          <div className="review-human-history">
            {detail.history.map((record, index) => (
              <div key={record.id}>
                <strong>第 {index + 1} 轮 · {stageLabelText(record.stage)}</strong>
                <span>{reviewDecisionLabel(record.decision)} · {new Date(record.createdAt).toLocaleString("zh-CN")}</span>
              </div>
            ))}
            {detail.auditLogs.map((log) => (
              <div key={log.id}>
                <strong>{auditEventLabel(log.action)}</strong>
                <span>{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
              </div>
            ))}
            {auditEvents.map((event) => (
              <div key={event.id}>
                <strong>{auditEventLabel(event.type)}</strong>
                <span>{new Date(event.createdAt).toLocaleString("zh-CN")} · {actorRoleLabel(event.actor.role)}</span>
              </div>
            ))}
          </div>
          {auditEventsError ? <p className="danger-text">{auditEventsError}</p> : null}
          {detail.history.length === 0 && detail.auditLogs.length === 0 && auditEvents.length === 0 && !auditEventsError ? (
            <div className="empty-state">暂无审计时间线</div>
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

// 字段类型判定：决定行内编辑器形态。复杂对象/嵌套数组只读，避免在审核界面塞大 JSON。
type FieldKind = "boolean" | "number" | "string" | "array" | "complex";

function classifyField(value: unknown): FieldKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string" || typeof item === "number") ? "array" : "complex";
  }
  return "complex";
}

// 字段级修订面板：逐字段展示「当前值」并提供与原类型一致的修订输入，
// 写回 correctedAnswers 后由 computeReviewPatches 生成 patches，不暴露 raw JSON、不改 API。
function FieldCorrectionPanel({
  original,
  corrected,
  onChange,
}: {
  original: Record<string, unknown>;
  corrected: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const keys = Object.keys(original);
  if (keys.length === 0) {
    return <div className="empty-state">本次提交暂无可修订字段。</div>;
  }
  const setField = (key: string, value: unknown) => onChange({ ...corrected, [key]: value });

  return (
    <div className="review-correction">
      {keys.map((key) => {
        const kind = classifyField(original[key]);
        const current = original[key];
        const value = corrected[key];
        const changed = JSON.stringify(current) !== JSON.stringify(value);
        return (
          <div
            className={changed ? "review-correction__row review-correction__row--changed" : "review-correction__row"}
            key={key}
          >
            <div className="review-correction__field">{key}</div>
            <div className="review-correction__current">
              <span className="review-correction__tag">当前值</span>
              <span className="review-correction__value">{valueText(current)}</span>
            </div>
            <div className="review-correction__edit">
              <span className="review-correction__tag">修订值</span>
              <FieldEditor kind={kind} value={value} onChange={(next) => setField(key, next)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldEditor({
  kind,
  value,
  onChange,
}: {
  kind: FieldKind;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (kind === "boolean") {
    return (
      <Select value={value === true ? "true" : "false"} onChange={(event) => onChange(event.target.value === "true")}>
        <option value="true">是</option>
        <option value="false">否</option>
      </Select>
    );
  }
  if (kind === "number") {
    return (
      <Input
        type="number"
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(event) => {
          const text = event.target.value;
          onChange(text === "" ? "" : Number(text));
        }}
      />
    );
  }
  if (kind === "array") {
    const arr = Array.isArray(value) ? value : [];
    const numeric = arr.length > 0 && arr.every((item) => typeof item === "number");
    return (
      <Textarea
        rows={Math.min(4, Math.max(2, arr.length))}
        value={arr.map((item) => String(item)).join("\n")}
        onChange={(event) => {
          const items = event.target.value
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          onChange(numeric ? items.map((item) => Number(item)) : items);
        }}
      />
    );
  }
  if (kind === "complex") {
    return <div className="review-correction__readonly">复杂结构，请用下方「高级」查看，暂不支持行内编辑。</div>;
  }
  const text = value === undefined || value === null ? "" : String(value);
  if (text.length > 60) {
    return <Textarea rows={3} value={text} onChange={(event) => onChange(event.target.value)} />;
  }
  return <Input value={text} onChange={(event) => onChange(event.target.value)} />;
}
