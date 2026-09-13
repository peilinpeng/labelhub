import { Fragment } from "react";
import { Link } from "react-router";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card, Input, Select, Textarea } from "../../ui/primitives";
import { formatBeijingDateTime } from "../../utils/formatTime";
import { AiAssistPanel } from "./AiAssistPanel";
import {
  actorRoleLabel,
  auditEventLabel,
  reviewDecisionLabel,
  reviewStageLabel as stageLabelText,
} from "./audit-humanize";
import { getReviewerSubmissionDisplay, type ReviewerSubmissionDisplay } from "./review-display";
import type { ReviewActionMode, useReviewDetailController } from "./useReviewDetailController";

type ReviewDetailController = ReturnType<typeof useReviewDetailController>;

function isEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || value === "";
}

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join("，") : "未填写";
  if (value === undefined || value === null || value === "") return "未填写";
  return String(value);
}

const DIMENSION_LABELS: Record<string, string> = {
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

const FIELD_LABELS: Record<string, string> = {
  submission_material: "补充审核材料",
  answer: "标注答案",
  title: "标题",
  content: "内容",
  category: "分类",
  evidence: "证据说明",
  comment: "备注",
  cleaned_title: "清洗后标题",
  news_title: "新闻标题",
  keywords: "关键词",
  issue_tags: "问题标签",
  news_category: "新闻分类",
  // 源数据（题目/参考材料）通用字段
  prompt: "题目 / 提示",
  question: "问题",
  reference: "参考答案",
  model_answer: "模型回答",
  response_a: "回答 A",
  response_b: "回答 B",
  model_a: "模型 A",
  model_b: "模型 B",
  task_type: "任务类型",
  dimensions: "评判维度",
  tags: "标签",
  lang: "语言",
  source: "来源",
  media_url: "媒体链接",
  media_type: "媒体类型",
  content_markdown: "正文",
  difficulty: "难度",
  expected_dimensions: "预期评判维度",
  id: "编号",
  // 问答质量标注 提交字段
  relevance: "相关性评分",
  accuracy: "准确性评分",
  compliance: "合规性评分",
  safety: "安全性评分",
  completeness: "完整性评分",
  readability: "可读性评分",
  issue_types: "问题类型",
  detail_comment: "详细评语",
  one_line_summary: "一句话总结",
  // 偏好对比标注 提交字段
  preferred: "更优回答",
  margin: "优势幅度",
  safety_flag: "安全标记",
  annotator_note: "标注说明",
  judge_dimensions: "评判维度",
  one_line_conclusion: "一句话结论",
};

function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? "未命名维度";
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

// 按当前任务真实 schema 字段动态渲染 payload，而非写死某套字段。
// 这样问答质量 / 偏好对比等不同任务都能正确展示各自的字段。
function PayloadFieldList({ payload, hideEmpty = false }: { payload: Record<string, unknown>; hideEmpty?: boolean }) {
  const entries = Object.entries(payload).filter(([, value]) => !hideEmpty || !isEmptyValue(value));
  if (entries.length === 0) {
    return <div className="empty-state">暂无字段数据</div>;
  }
  return (
    <dl>
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt>{fieldLabel(key)}</dt>
          <dd>{valueText(value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}


export function ReviewDetailView({ controller }: { controller: ReviewDetailController }) {
  const {
    actionMode, aiResult, aiTrace, answers, auditEvents, auditEventsError, comments,
    correctedAnswers, deciding, decisionConfirmCopy, decisionMessage, detail,
    dimensionScores, handleSubmit, loading, pendingMode, previewPatches, queue,
    requestSubmit, setActionMode, setComments, setCorrectedAnswers, setPendingMode,
    setRefreshTick, setTimelineOpen, sourcePayload, timelineOpen,
  } = controller;
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
    issue: humanizeAiReason(aiResult?.summary ?? "该提交需要人工确认字段完整性和审核结论。"),
    recommendation: "待人工复核",
  };
  // 当前正在审核的提交始终出现在队列顶部（即便其状态已不在待审队列里），便于定位与高亮。
  // 注意：此处在早返回之后，必须是普通计算而非 Hook，避免违反 Hooks 调用顺序规则。
  const queueItems: ReviewerSubmissionDisplay[] = queue.some((item) => item.id === detail.submission.id)
    ? queue
    : [
        {
          id: detail.submission.id,
          title: display.title,
          taskTitle: display.taskTitle,
          labeler: display.labeler,
          payload: {},
          previousPayload: {},
          issue: display.issue,
          recommendation: display.recommendation,
        },
        ...queue,
      ];
  const reviewStage = detail.submission.status === "FINAL_REVIEWING" ? "FINAL_REVIEW" : "HUMAN_REVIEW";
  const reviewStageLabel = reviewStage === "FINAL_REVIEW" ? "终审视图" : "复审视图";
  const reviewPolicyLabel = detail.task.reviewPolicy.type === "DOUBLE_REVIEW" ? "双轮审核" : "单轮审核";

  return (
    <div className={timelineOpen ? "review-human-page review-human-page--drawer-open" : "review-human-page"}>
      <aside className="review-human-queue-col" aria-label="审核队列">
        <header className="review-human-queue-col__head">
          <span className="review-human-queue-col__title">审核队列</span>
          <span className="review-human-queue-col__meta">共 {queueItems.length} 条</span>
        </header>
        <nav className="review-human-queue">
          {queueItems.map((item, index) => (
            <Link
              className={item.id === detail.submission.id ? "review-human-queue-item review-human-queue-item--active" : "review-human-queue-item"}
              key={item.id}
              to={`/reviewer/items/${item.id}`}
              title={`提交 ${shortSubmissionId(item.id)}`}
            >
              <span>提交号：{shortSubmissionId(item.id)}</span>
              <strong>{formatSubmissionTitle(item.title, item.id, index + 1)}</strong>
              <small>
                <Badge tone="warning">{item.recommendation}</Badge>
              </small>
            </Link>
          ))}
          {queueItems.length === 0 ? <div className="empty-state">暂无队列摘要</div> : null}
        </nav>
      </aside>

      <main className="review-human-main">
        <div className="review-human-toolbar">
          <div className="review-human-toolbar__title" title={`提交 ${detail.submission.id} · 题目 ${detail.item.id}`}>
            <h1>{formatSubmissionTitle(display.title, detail.submission.id, 1)}</h1>
            <p>{display.taskTitle} · 表单版本 r{detail.schema.schemaVersionNo ?? "-"} · {reviewPolicyLabel}</p>
          </div>
          <div className="review-human-toolbar__actions">
            <Badge tone={reviewStage === "FINAL_REVIEW" ? "primary" : "warning"}>第 {detail.submission.attemptNo} 轮 · {reviewStageLabel}</Badge>
            <button
              type="button"
              className="review-human-timeline-toggle"
              aria-expanded={timelineOpen}
              onClick={() => setTimelineOpen((open) => !open)}
            >
              审计时间线
            </button>
          </div>
        </div>

        <div className="review-human-compare">
          <Card className="review-human-compare-card">
            <h3>原始数据</h3>
            <PayloadFieldList payload={sourcePayload} hideEmpty />
          </Card>
          <Card className="review-human-compare-card">
            <h3>本轮提交</h3>
            <PayloadFieldList payload={answers} />
          </Card>
        </div>

        <Card className="review-human-ai">
          <div className="review-human-ai__head">
            <h3>AI 评语与预审结果</h3>
            <Badge tone="primary">
              {aiTrace?.modelPolicyId ? `AI 预审代理 · ${aiTrace.modelPolicyId}` : "AI 预审代理"}
            </Badge>
          </div>
          {dimensionScores.length > 0 ? (
            <div className="review-human-ai__scores">
              {dimensionScores.map((score) => (
                <span key={score.key}>{dimensionLabel(score.key)}：<strong>{Math.round(normalizeScorePercent(score.score))} 分</strong></span>
              ))}
            </div>
          ) : <div className="empty-state">暂无 AI 维度评分</div>}
          {typeof aiResult?.confidence === "number" ? (
            <p className="review-human-ai__confidence">模型自评置信度 {Math.round(normalizeScorePercent(aiResult.confidence))}%</p>
          ) : null}
          <p>{humanizeAiReason(aiResult?.summary ?? display.issue)}</p>
        </Card>

        <AiAssistPanel
          submissionId={detail.submission.id}
          onActionApplied={() => setRefreshTick((tick) => tick + 1)}
        />

        <Card className="review-human-decision-card">
          <div className="review-human-conclusion">
            <span className="review-human-conclusion__label">审核结论</span>
            <div className="review-human-modeswitch" role="tablist" aria-label="审核结论">
              {([
                ["PASS", "通过"],
                ["RETURN", "打回"],
                ["REVISE", "修订提交"],
              ] as Array<[ReviewActionMode, string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={actionMode === mode}
                  className={actionMode === mode ? "review-human-modeswitch__btn review-human-modeswitch__btn--active" : "review-human-modeswitch__btn"}
                  onClick={() => setActionMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {actionMode === "RETURN" ? (
            <div className="review-human-mode-panel">
              <label className="review-human-opinion">
                <span>审核意见（打回必填）</span>
                <Textarea
                  value={comments}
                  placeholder="请说明打回原因，便于标注员修正"
                  onChange={(event) => setComments(event.target.value)}
                />
              </label>
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
              {comments.trim().length === 0 ? (
                <p className="review-human-mode-warn">未填写审核意见，打回按钮暂不可用。</p>
              ) : null}
            </div>
          ) : null}

          {actionMode === "REVISE" ? (
            <div className="review-human-mode-panel">
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
                        <span title={`字段：${patch.fieldName}`}>{fieldLabel(patch.fieldName)}</span>
                        <em>{valueText(patch.previousValue)} → {valueText(patch.nextValue)}</em>
                      </li>
                    ))}
                  </ul>
                ) : <p>当前未产生字段修订，至少修改一个字段才能提交。</p>}
              </div>
              <details className="review-human-advanced">
                <summary>高级：查看原始结构</summary>
                <pre className="review-human-advanced__json">{JSON.stringify(correctedAnswers, null, 2)}</pre>
              </details>
            </div>
          ) : null}

          {decisionMessage ? <Badge tone="success">{decisionMessage}</Badge> : null}
        </Card>

        <div className="review-human-actionbar">
          {actionMode === "RETURN" ? (
            <Button
              tone="danger"
              onClick={() => requestSubmit("RETURN")}
              disabled={deciding || comments.trim().length === 0}
            >
              打回修改
              <span>{comments.trim().length === 0 ? "请先填写审核意见" : "返回标注员重新提交"}</span>
            </Button>
          ) : actionMode === "REVISE" ? (
            <Button
              onClick={() => requestSubmit("REVISE")}
              disabled={deciding || previewPatches.length === 0}
            >
              保存修订并通过
              <span>{previewPatches.length === 0 ? "请至少修改一个字段" : "生成修订后入库"}</span>
            </Button>
          ) : (
            <Button tone="success" onClick={() => requestSubmit("PASS")} disabled={deciding}>
              通过入库
              <span>进入可导出数据</span>
            </Button>
          )}
        </div>
      </main>

      <aside
        className={timelineOpen ? "review-human-drawer review-human-drawer--open" : "review-human-drawer"}
        aria-label="审计时间线"
        aria-hidden={!timelineOpen}
      >
        <div className="review-human-drawer__head">
          <h3>审计时间线</h3>
          <button
            type="button"
            className="review-human-drawer__close"
            onClick={() => setTimelineOpen(false)}
            aria-label="关闭审计时间线"
          >
            ×
          </button>
        </div>
        <div className="review-human-history">
          {detail.history.map((record, index) => (
            <div key={record.id}>
              <strong>第 {index + 1} 轮 · {stageLabelText(record.stage)}</strong>
              <span>{reviewDecisionLabel(record.decision)} · {formatBeijingDateTime(record.createdAt)}</span>
            </div>
          ))}
          {detail.auditLogs.map((log) => (
            <div key={log.id}>
              <strong>{auditEventLabel(log.action)}</strong>
              <span>{formatBeijingDateTime(log.createdAt)}</span>
            </div>
          ))}
          {auditEvents.map((event) => (
            <div key={event.id}>
              <strong>{auditEventLabel(event.type)}</strong>
              <span>{formatBeijingDateTime(event.createdAt)} · {actorRoleLabel(event.actor.role)}</span>
            </div>
          ))}
        </div>
        {auditEventsError ? <p className="danger-text">{auditEventsError}</p> : null}
        {detail.history.length === 0 && detail.auditLogs.length === 0 && auditEvents.length === 0 && !auditEventsError ? (
          <div className="empty-state">暂无审计时间线</div>
        ) : null}
      </aside>

      {timelineOpen ? (
        <div className="review-human-drawer-backdrop" onClick={() => setTimelineOpen(false)} aria-hidden="true" />
      ) : null}

      <ConfirmDialog
        open={pendingMode !== null}
        title={decisionConfirmCopy.title}
        description={decisionConfirmCopy.description}
        confirmText={decisionConfirmCopy.confirmText}
        cancelText="取消"
        tone={decisionConfirmCopy.tone}
        suppressLabel={decisionConfirmCopy.suppressLabel}
        onCancel={() => setPendingMode(null)}
        onConfirm={(suppress) => {
          const mode = pendingMode;
          if (!mode) return;
          if (suppress) suppressConfirmForSession(decisionConfirmCopy.suppressKey);
          setPendingMode(null);
          void handleSubmit(mode);
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
            <div className="review-correction__field" title={`字段：${key}`}>{fieldLabel(key)}</div>
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

function normalizeScorePercent(rawScore: number | null | undefined): number {
  if (rawScore == null || !Number.isFinite(rawScore)) return 0;
  const normalizedScore = rawScore <= 1 ? rawScore * 100 : rawScore;
  return Math.max(0, Math.min(100, normalizedScore));
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeAiReason(text?: string): string {
  if (!text) return "";
  return text
    .replace(/缺少具体的题目内容、标注答案和对应schema的详细信息，无法进行自动维度评分。/g, "提交内容较少，AI 无法判断答案是否符合题目要求，建议人工复核。")
    .replace(/目标标注schema/g, "目标标注规则")
    .replace(/标注schema/g, "标注规则")
    .replace(/schema/g, "表单规则")
    .replace(/自动维度评分/g, "自动评分")
    .replace(/自动预审打分/g, "自动评分");
}

function shortSubmissionId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}...${id.slice(-4)}` : id;
}

function formatSubmissionTitle(title: string | undefined, submissionId: string, index: number): string {
  if (!title || title === submissionId || /^sub_[a-z0-9]+$/i.test(title) || /^item_[a-z0-9]+$/i.test(title) || /^\d+$/.test(title)) {
    return `第 ${index} 条提交`;
  }
  return title;
}
