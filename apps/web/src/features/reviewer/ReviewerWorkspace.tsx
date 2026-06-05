import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { listReviewQueue, type ReviewQueueItem } from "../../api/reviewer";
import { Badge, Card } from "../../ui/primitives";
import { DEMO_SUBMISSION_ID, getDemoSubmissionFallback } from "../../mocks/demo-workflow-store";
import { getQueueDisplay } from "./review-display";

interface ReviewerWorkspaceProps {
  role: Role;
}

type QueueFilter = "pending" | "passed" | "returned" | "manual" | "failed";

const fallbackQueue: ReviewQueueItem[] = [
  {
    submission: {
      id: DEMO_SUBMISSION_ID,
      assignmentId: "asn_1001",
      taskId: "task_news_quality",
      itemId: "item_news_1",
      labelerId: "李雷",
      schemaVersionId: "sv_news_quality_1",
      attemptNo: 2,
      status: "NEEDS_HUMAN_REVIEW",
      createdAt: "2026-05-16T18:01:02.000Z",
      updatedAt: "2026-05-16T18:01:03.000Z",
    },
    taskId: "task_news_quality",
    taskTitle: "新闻质量标注",
    itemId: "item_news_1",
    aiDecision: "RETURN",
  },
  {
    submission: {
      id: "sub_1002",
      assignmentId: "asn_1001",
      taskId: "task_news_quality",
      itemId: "item_news_2",
      labelerId: "张敏",
      schemaVersionId: "sv_news_quality_1",
      attemptNo: 1,
      status: "AI_PASSED",
      createdAt: "2026-05-16T18:00:48.000Z",
      updatedAt: "2026-05-16T18:00:49.000Z",
    },
    taskId: "task_news_quality",
    taskTitle: "新闻质量标注",
    itemId: "item_news_2",
    aiDecision: "PASS",
  },
  {
    submission: {
      id: "sub_1003",
      assignmentId: "asn_1001",
      taskId: "task_news_quality",
      itemId: "item_news_3",
      labelerId: "王芳",
      schemaVersionId: "sv_news_quality_1",
      attemptNo: 1,
      status: "RETURNED",
      createdAt: "2026-05-16T18:00:31.000Z",
      updatedAt: "2026-05-16T18:00:32.000Z",
    },
    taskId: "task_news_quality",
    taskTitle: "新闻质量标注",
    itemId: "item_news_3",
    aiDecision: "RETURN",
  },
  {
    submission: {
      id: "sub_1004",
      assignmentId: "asn_1001",
      taskId: "task_news_quality",
      itemId: "item_news_4",
      labelerId: "李雷",
      schemaVersionId: "sv_news_quality_1",
      attemptNo: 1,
      status: "NEEDS_HUMAN_REVIEW",
      createdAt: "2026-05-16T17:58:11.000Z",
      updatedAt: "2026-05-16T17:58:12.000Z",
    },
    taskId: "task_news_quality",
    taskTitle: "新闻质量标注",
    itemId: "item_news_4",
    aiDecision: "MANUAL",
  },
];

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

function scoreFor(item: ReviewQueueItem): number {
  if (item.submission.status === "AI_PASSED") return 91;
  if (item.submission.status === "RETURNED" || item.submission.status === "REJECTED") return 55;
  return item.aiDecision === "MANUAL" ? 72 : 62;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function reviewQueueStatusFor(filter: QueueFilter): string | undefined {
  if (filter === "pending" || filter === "manual") return "NEEDS_HUMAN_REVIEW";
  if (filter === "passed") return "ACCEPTED";
  if (filter === "returned") return "RETURNED";
  return undefined;
}

function applyDemoQueueItemState(item: ReviewQueueItem): ReviewQueueItem {
  if (item.submission.id !== DEMO_SUBMISSION_ID) return item;
  const demoSubmission = getDemoSubmissionFallback();
  return {
    ...item,
    submission: {
      ...item.submission,
      status: demoSubmission.status,
      updatedAt: demoSubmission.updatedAt,
    },
  };
}

export default function ReviewerWorkspace({ role }: ReviewerWorkspaceProps) {
  const [submissions, setSubmissions] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listReviewQueue({ status: reviewQueueStatusFor(filter) });
        const withDemoState = data.map(applyDemoQueueItemState);
        const nextSubmissions = withDemoState.some((item) => item.submission.id === DEMO_SUBMISSION_ID)
          ? withDemoState
          : [{ ...fallbackQueue[0], submission: getDemoSubmissionFallback() }, ...withDemoState];
        setSubmissions(nextSubmissions.length > 0 ? nextSubmissions : fallbackQueue);
        setSelectedId((current) => current ?? nextSubmissions[0]?.submission.id ?? fallbackQueue[0].submission.id);
        setOfflineNotice(null);
      } catch (error) {
        setSubmissions(fallbackQueue);
        setSelectedId((current) => current ?? fallbackQueue[0].submission.id);
        setOfflineNotice(error instanceof Error ? error.message : "后端 API 暂不可用，当前显示本地预审队列。");
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
  const selectedScore = selected ? scoreFor(selected) : 0;
  const selectedDisplay = selected ? getQueueDisplay(selected) : null;
  const dimensionScores = [
    { label: "相关性", value: selectedScore >= 80 ? 92 : 78, tone: "success" },
    { label: "准确性", value: selectedScore >= 80 ? 84 : 55, tone: "warning" },
    { label: "格式合规", value: selectedScore >= 80 ? 88 : 70, tone: "warning" },
    { label: "安全性", value: 99, tone: "success" },
    { label: "综合", value: selectedScore, tone: selectedScore >= 80 ? "success" : "warning" },
  ];

  if (loading) {
    return <Card className="state-panel">加载 AI 预审队列中...</Card>;
  }

  return (
    <div className="review-ai-page">
      <section className="review-ai-header">
        <div>
          <h1>AI 自动预审队列</h1>
          <p>异步消费提交数据，按评分维度调用 LLM 结构化输出，通过 / 打回 / 转人工复核。</p>
        </div>
        <div className="review-ai-header__meta">
          <Link className="lh-button" to={RoutePath.OWNER_TASKS_AI_CONFIG.replace(":taskId", "task_news_quality")}>
            AI 预审设置
          </Link>
          <Badge tone="success">服务在线</Badge>
          <span>幂等键 idempotency_key</span>
          <span>当前角色 {role}</span>
        </div>
      </section>

      {offlineNotice ? (
        <div className="offline-banner">
          <strong>离线模式</strong>
          <span>后端 API 暂不可用，当前显示本地预审队列。{offlineNotice}</span>
        </div>
      ) : null}

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

          <div className="review-ai-queue__summary">
            <strong>38 / s</strong>
            <span>平均耗时 1.4s · 重试率 1.2%</span>
            <small>任务 T-2041 · 规则「电商相关性 v2」</small>
          </div>

          <div className="review-ai-list">
            {filteredSubmissions.map((item) => {
              const isActive = item.submission.id === selected?.submission.id;
              const display = getQueueDisplay(item);
              return (
                <button
                  className={isActive ? "review-ai-item review-ai-item--active" : "review-ai-item"}
                  key={item.submission.id}
                  type="button"
                  onClick={() => setSelectedId(item.submission.id)}
                >
                  <span className="review-ai-item__meta">
                    {item.submission.id} · {item.submission.labelerId} · {formatTime(item.submission.createdAt)}
                  </span>
                  <strong>{display.title}</strong>
                  <span className="review-ai-item__badges">
                    <Badge tone={statusTone(item.submission.status)}>{statusLabel(item.submission.status)}</Badge>
                    <Badge tone="default">分数 {scoreFor(item)}</Badge>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {selected ? (
          <main className="review-ai-detail">
            <section className="review-ai-detail__heading">
              <div>
                <h2>{selected.submission.id} · {selectedDisplay?.title}</h2>
                <p>
                  提交于 {formatTime(selected.submission.createdAt)} · 标注员{" "}
                  {selectedDisplay?.labeler ?? selected.submission.labelerId} · {selectedDisplay?.taskTitle ?? selected.taskTitle}
                </p>
              </div>
              <Badge tone={statusTone(selected.submission.status)}>AI 建议：{statusLabel(selected.submission.status)} ({selectedScore})</Badge>
            </section>

            <div className="review-ai-insight-grid">
              <Card className="review-ai-block">
                <div className="review-ai-block__head">
                  <h3>提交内容</h3>
                  <span>JSON 字段视图</span>
                </div>
                <pre className="review-ai-json">{JSON.stringify(selectedDisplay?.payload ?? {}, null, 2)}</pre>
              </Card>

              <Card className="review-ai-block">
                <div className="review-ai-block__head">
                  <h3>维度评分（共 100）</h3>
                  <span>function_calling · 结构化</span>
                </div>
                <div className="review-ai-score-list">
                  {dimensionScores.map((score) => (
                    <div className="review-ai-score-row" key={score.label}>
                      <span>{score.label}</span>
                      <div className="review-ai-score-track">
                        <i className={`review-ai-score-fill review-ai-score-fill--${score.tone}`} style={{ width: `${score.value}%` }} />
                      </div>
                      <strong>{score.value}</strong>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card className={selectedScore >= 80 ? "review-ai-comment review-ai-comment--pass" : "review-ai-comment"}>
              <strong>{selectedDisplay?.recommendation ?? (selectedScore >= 80 ? "建议通过" : "建议打回")}</strong>
              <span>{selectedDisplay?.issue ?? "该提交需要人工确认字段完整性和审核结论。"}</span>
              <Link className="lh-button lh-button--primary" to={`/reviewer/items/${selected.submission.id}`}>
                进入人工审核
              </Link>
            </Card>

            <Card className="review-ai-block">
              <div className="review-ai-block__head">
                <h3>审核 Prompt 模板</h3>
                <Badge tone="primary">规则：电商相关性 v2</Badge>
              </div>
              <pre className="review-ai-prompt">{`你是电商商品标题审核员。请基于以下维度为提交内容打分（0-100）：
[相关性] 标注结果与原始数据是否对齐
[准确性] 类目 / 关键词与商品事实是否一致
[格式合规] 是否满足模板字符 / 正则规则
[安全性] 是否包含敏感 / 违规词

请通过 function_call 返回 JSON：
{ "scores": {...}, "verdict": "pass"|"reject"|"manual", "reason": "..." }`}</pre>
            </Card>

            <Card className="review-ai-block">
              <div className="review-ai-block__head">
                <h3>处理日志 / 审计</h3>
                <span>queue · llm · verdict</span>
              </div>
              <div className="review-ai-log">
                <span>18:01:02 queue 进入 BullMQ 队列 ai-prereview · 优先级 5</span>
                <span>18:01:03 llm 调用 doubao-pro-32k · tokens 1342 · 1.42s</span>
                <span>18:01:03 verdict 结构化输出：reject ({selectedScore})</span>
              </div>
            </Card>
          </main>
        ) : (
          <Card className="state-panel">暂无预审提交。</Card>
        )}
      </div>
    </div>
  );
}
