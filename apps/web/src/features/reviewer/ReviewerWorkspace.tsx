import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Role } from "../../app/routes";
import { listReviewQueue } from "../../api/reviewer";
import { AIReviewPanel, Badge, Card, KpiCard } from "../../ui/primitives";
import type { Submission } from "@labelhub/contracts";

interface ReviewerWorkspaceProps {
  role: Role;
}

function statusTone(status: Submission["status"]): "success" | "warning" | "danger" | "default" {
  if (status === "AI_PASSED" || status === "ACCEPTED") return "success";
  if (status === "NEEDS_HUMAN_REVIEW" || status === "HUMAN_REVIEWING") return "warning";
  if (status === "REJECTED" || status === "RETURNED") return "danger";
  return "default";
}

export default function ReviewerWorkspace({ role }: ReviewerWorkspaceProps) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listReviewQueue();
        setSubmissions(data);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Card className="state-panel">加载 AI 预审队列中...</Card>;
  }

  if (error) {
    return <Card className="state-panel danger-text">错误: {error}</Card>;
  }

  return (
    <div className="review-layout">
      <Card className="soft-panel">
        <h3 className="soft-panel__title">AI 自动预审队列</h3>
        <div className="soft-list">
          {submissions.map((submission) => (
            <Link key={submission.id} to={`/reviewer/items/${submission.id}`} className="soft-list-item">
              <div className="meta-line">
                <span>{submission.id}</span>
                <span>{new Date(submission.createdAt).toLocaleTimeString()}</span>
              </div>
              <h3 className="task-title">提交 #{submission.attemptNo}</h3>
              <div className="page-actions">
                <Badge tone={statusTone(submission.status)}>{submission.status}</Badge>
                <Badge tone="primary">AI {submission.validationSnapshot.valid ? "91" : "62"}</Badge>
              </div>
            </Link>
          ))}
        </div>
        {submissions.length === 0 ? <div className="empty-state">暂无待审核提交</div> : null}
      </Card>

      <div className="page-stack">
        <div className="page-header">
          <div>
            <h2 className="page-title">AI Review</h2>
            <p className="page-subtitle">当前角色：{role}。队列展示 AI 预审后的 submission，点击进入人工复核。</p>
          </div>
        </div>

        <div className="kpi-grid">
          <KpiCard label="待审核" value={submissions.length} hint="AI_PASSED / NEEDS_HUMAN_REVIEW" />
          <KpiCard label="建议通过率" value="87%" hint="示例质检指标" />
          <KpiCard label="SLA 剩余" value="02:14" hint="队列服务指标" />
        </div>

        <AIReviewPanel title="预审评分示例" badge={<Badge tone="primary">function_calling · 结构化</Badge>}>
          <div className="form-stack">
            {[
              ["相关性", 78],
              ["准确性", 55],
              ["格式合规", 70],
              ["安全性", 99],
              ["综合", 62],
            ].map(([label, score]) => (
              <div className="score-row" key={label}>
                <span>{label}</span>
                <div className="score-bar">
                  <span style={{ width: `${score}%` }} />
                </div>
                <strong>{score}</strong>
              </div>
            ))}
          </div>
        </AIReviewPanel>

        <Card className="soft-panel">
          <h3 className="soft-panel__title">审核 Prompt 模板</h3>
          <div className="inset-well">
            <pre className="source-json">{`你是电商商品标题审核员。请基于相关性、准确性、格式合规、安全性对提交内容打分，并输出 pass / reject / manual 结论。`}</pre>
          </div>
        </Card>
      </div>

      <Card className="soft-panel">
        <h3 className="soft-panel__title">处理日志 / 审计</h3>
        <div className="timeline">
          <div className="timeline-item">
            <strong>queue</strong>
            <span>进入 BullMQ 队列 ai-prereview</span>
          </div>
          <div className="timeline-item">
            <strong>llm</strong>
            <span>调用模型并生成结构化结果</span>
          </div>
          <div className="timeline-item">
            <strong>verdict</strong>
            <span>输出建议：通过 / 打回 / 转人工</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
