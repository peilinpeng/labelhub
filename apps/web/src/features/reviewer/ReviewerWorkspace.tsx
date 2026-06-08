import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Role } from "../../app/routes";
import { batchDecideReview, listReviewQueue, type ReviewQueueItem } from "../../api/reviewer";
import type { ReviewDecisionRequest } from "@labelhub/contracts";
import { Badge, Button, Card } from "../../ui/primitives";
import { getQueueDisplay } from "./review-display";

interface ReviewerWorkspaceProps {
  role: Role;
}

type QueueFilter = "pending" | "passed" | "returned" | "manual" | "failed";

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
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listReviewQueue({ status: reviewQueueStatusFor(filter) });
        setSubmissions(data);
        setSelectedId((current) => current ?? data[0]?.submission.id ?? null);
        setSelectedBatchIds([]);
        setOfflineNotice(null);
      } catch (error) {
        setSubmissions([]);
        setSelectedId(null);
        setOfflineNotice(error instanceof Error ? error.message : "审核队列接口暂不可用。");
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
  const selectedBatchItems = filteredSubmissions.filter((item) => selectedBatchIds.includes(item.submission.id) && isBatchReviewable(item));

  const toggleBatchId = (submissionId: string) => {
    setSelectedBatchIds((current) =>
      current.includes(submissionId) ? current.filter((id) => id !== submissionId) : [...current, submissionId],
    );
  };

  const handleBatchDecision = async (decision: "PASS" | "RETURN") => {
    if (selectedBatchItems.length === 0) return;
    try {
      setBatching(true);
      const items: ReviewDecisionRequest[] = selectedBatchItems.map((item) => {
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
            reason: "批量审核打回，等待标注员修改后重新提交。",
            comments: [{ message: "批量审核打回，等待标注员修改后重新提交。" }],
          };
        }
        return {
          ...base,
          decision: "PASS",
          comments: [],
        };
      });
      const response = await batchDecideReview({ items });
      const successCount = response.results.filter((result) => result.success).length;
      setBatchMessage(`批量${decision === "PASS" ? "通过" : "打回"}完成：成功 ${successCount} / ${response.results.length}`);
      const data = await listReviewQueue({ status: reviewQueueStatusFor(filter) });
      setSubmissions(data);
      setSelectedBatchIds([]);
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
              disabled={batching || selectedBatchItems.length === 0}
              onClick={() => void handleBatchDecision("RETURN")}
            >
              批量打回
            </Button>
          </div>
          {batchMessage ? <p className="review-ai-batchbar__message">{batchMessage}</p> : null}

          <div className="review-ai-list">
            {filteredSubmissions.map((item) => {
              const isActive = item.submission.id === selected?.submission.id;
              const display = getQueueDisplay(item);
              const reviewable = isBatchReviewable(item);
              return (
                <div className={isActive ? "review-ai-row review-ai-row--active" : "review-ai-row"} key={item.submission.id}>
                  <label className="review-ai-row__check" title={reviewable ? "选择批量审核" : "需先进入人工审核领取后才能批量提交"}>
                    <input
                      checked={selectedBatchIds.includes(item.submission.id)}
                      disabled={!reviewable}
                      type="checkbox"
                      onChange={() => toggleBatchId(item.submission.id)}
                    />
                  </label>
                  <button
                    className={isActive ? "review-ai-item review-ai-item--active" : "review-ai-item"}
                    type="button"
                    onClick={() => setSelectedId(item.submission.id)}
                  >
                    <span className="review-ai-item__meta">
                      {item.submission.id} · 第 {item.submission.attemptNo} 轮 · {item.submission.labelerId} · {formatTime(item.submission.createdAt)}
                    </span>
                    <strong>{display.title}</strong>
                    <span className="review-ai-item__badges">
                      <Badge tone={statusTone(item.submission.status)}>{statusLabel(item.submission.status)}</Badge>
                      {item.submission.status === "FINAL_REVIEWING" ? <Badge tone="primary">终审</Badge> : <Badge tone="default">复审</Badge>}
                    </span>
                  </button>
                </div>
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
                <pre className="review-ai-json">{JSON.stringify(selectedDisplay?.payload ?? {}, null, 2)}</pre>
              </Card>

              <Card className="review-ai-block">
                <div className="empty-state">队列接口未提供维度评分时不展示模拟分数</div>
              </Card>
            </div>

            <Card className="review-ai-comment">
              <strong>{selectedDisplay?.recommendation ?? statusLabel(selected.submission.status)}</strong>
              <span>{selectedDisplay?.issue ?? "该提交需要人工确认字段完整性和审核结论。"}</span>
              <Link className="lh-button lh-button--primary" to={`/reviewer/items/${selected.submission.id}`}>
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

function isBatchReviewable(item: ReviewQueueItem): boolean {
  return item.submission.status === "HUMAN_REVIEWING" || item.submission.status === "FINAL_REVIEWING";
}
