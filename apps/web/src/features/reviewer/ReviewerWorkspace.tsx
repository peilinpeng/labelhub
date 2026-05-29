import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Role } from "../../app/routes";
import { listReviewQueue } from "../../api/reviewer";
import { Badge, Card } from "../../ui/primitives";
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

function statusLabel(status: Submission["status"]): string {
  if (status === "AI_PASSED") return "AI 通过";
  if (status === "NEEDS_HUMAN_REVIEW") return "需人工复核";
  if (status === "ACCEPTED") return "已通过";
  if (status === "RETURNED" || status === "REJECTED") return "已打回";
  if (status === "HUMAN_REVIEWING") return "人工审核中";
  return status;
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

  const needsReviewCount = submissions.filter((item) => item.status === "NEEDS_HUMAN_REVIEW").length;
  const aiPassedCount = submissions.filter((item) => item.status === "AI_PASSED" || item.status === "ACCEPTED").length;
  const aiReturnedCount = submissions.filter((item) => item.status === "RETURNED" || item.status === "REJECTED").length;
  const avgScore = submissions.length
    ? Math.round(
        submissions.reduce((sum, submission) => sum + (submission.validationSnapshot.valid ? 91 : 62), 0) /
          submissions.length,
      )
    : 0;
  const tabs = [
    ["全部", submissions.length],
    ["AI 通过", aiPassedCount],
    ["AI 打回", aiReturnedCount],
    ["需要人工复核", needsReviewCount],
    ["已通过", submissions.filter((item) => item.status === "ACCEPTED").length],
    ["已打回", aiReturnedCount],
  ];
  const kpis = [
    { label: "待审核", value: needsReviewCount.toString(), hint: "需要人工复核的提交", tone: "warning" },
    { label: "AI 通过", value: aiPassedCount.toString(), hint: "可快速抽检确认", tone: "success" },
    { label: "AI 打回", value: aiReturnedCount.toString(), hint: "高风险或不合规", tone: "danger" },
    { label: "平均 AI 分数", value: `${avgScore}`, hint: "基于预审快照估算", tone: "primary" },
  ];

  return (
    <div className="reviewer-workbench page-stack">
      <div className="page-header reviewer-page-header">
        <div>
          <Badge tone="primary">Reviewer Queue</Badge>
          <h2 className="page-title">审核工作台</h2>
          <p className="page-subtitle">查看 AI 预审结果，筛选待处理提交并进入人工复核</p>
        </div>
        <Link to="/reviewer/items" className="lh-button lh-button--primary">
          查看待人工审核
        </Link>
      </div>

      <div className="reviewer-kpi-grid">
        {kpis.map((kpi) => (
          <Card className={`reviewer-kpi-card reviewer-kpi-card--${kpi.tone}`} key={kpi.label}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <p>{kpi.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="reviewer-tabs-card">
        <div className="reviewer-tabs" role="tablist" aria-label="审核状态筛选">
          {tabs.map(([label, count], index) => (
            <button className={index === 0 ? "reviewer-tab reviewer-tab--active" : "reviewer-tab"} key={label} type="button">
              <span>{label}</span>
              <strong>{count}</strong>
            </button>
          ))}
        </div>
      </Card>

      <div className="reviewer-queue-layout">
        <Card className="reviewer-table-card">
          <div className="reviewer-table-header">
            <div>
              <h3>审核队列</h3>
              <p>{submissions.length} 条提交等待处理或抽检</p>
            </div>
            <Badge tone="warning">AI 预审后</Badge>
          </div>
          <table className="soft-table reviewer-table">
            <thead>
              <tr>
                <th>提交 ID</th>
                <th>任务</th>
                <th>标注员</th>
                <th>AI 结论</th>
                <th>AI 分数</th>
                <th>人工状态</th>
                <th>提交时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => {
                const score = submission.validationSnapshot.valid ? 91 : 62;
                return (
                  <tr key={submission.id}>
                    <td>
                      <strong className="reviewer-submission-id">{submission.id}</strong>
                      <span className="reviewer-attempt">Attempt #{submission.attemptNo}</span>
                    </td>
                    <td className="owner-table-strong">{submission.taskId}</td>
                    <td>{submission.labelerId}</td>
                    <td>
                      <Badge tone={statusTone(submission.status)}>{statusLabel(submission.status)}</Badge>
                    </td>
                    <td>
                      <div className="reviewer-score">
                        <span>{score}</span>
                        <div className="score-bar">
                          <span style={{ width: `${score}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={submission.status === "NEEDS_HUMAN_REVIEW" ? "warning" : "default"}>
                        {submission.status === "NEEDS_HUMAN_REVIEW" ? "待人工" : "待确认"}
                      </Badge>
                    </td>
                    <td>{new Date(submission.createdAt).toLocaleString()}</td>
                    <td>
                      <Link to={`/reviewer/items/${submission.id}`} className="lh-button lh-button--primary">
                        查看审核
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {submissions.length === 0 ? <div className="empty-state">暂无待审核提交</div> : null}
        </Card>

        <aside className="reviewer-summary-panel">
          <Card className="reviewer-summary-card">
            <div className="reviewer-summary-heading">
              <h3>当前筛选结果</h3>
              <Badge tone="primary">{submissions.length} 条</Badge>
            </div>
            <div className="reviewer-summary-list">
              <div>
                <span>高风险提交</span>
                <strong>{aiReturnedCount}</strong>
              </div>
              <div>
                <span>需要人工复核</span>
                <strong>{needsReviewCount}</strong>
              </div>
              <div>
                <span>平均 AI 分数</span>
                <strong>{avgScore}</strong>
              </div>
            </div>
          </Card>

          <Card className="reviewer-summary-card">
            <div className="reviewer-summary-heading">
              <h3>AI 预审说明</h3>
              <Badge tone="primary">结构化</Badge>
            </div>
            <p className="reviewer-summary-copy">
              AI 已基于相关性、准确性、格式合规和安全性生成初步结论。人工审核应优先处理低分和打回建议。
            </p>
          </Card>

          <Card className="reviewer-summary-card">
            <div className="reviewer-summary-heading">
              <h3>审核建议</h3>
              <Badge tone="warning">{role}</Badge>
            </div>
            <div className="timeline">
              <div className="timeline-item">
                <strong>优先复核</strong>
                <span>AI 分数低于 70 的提交</span>
              </div>
              <div className="timeline-item">
                <strong>抽检通过</strong>
                <span>AI 通过但字段有争议的提交</span>
              </div>
              <div className="timeline-item">
                <strong>记录原因</strong>
                <span>打回时补充可执行修改意见</span>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
