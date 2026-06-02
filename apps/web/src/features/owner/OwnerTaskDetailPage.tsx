import { Link, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { getDemoWorkflowState } from "../../mocks/demo-workflow-store";
import { tasksMock } from "../../mocks/data/tasks.mock";
import { Badge, Card } from "../../ui/primitives";
import type { Task } from "@labelhub/contracts";

interface OwnerTaskDetailPageProps {
  role: Role;
}

function statusTone(status: Task["status"]): "success" | "warning" | "default" {
  if (status === "PUBLISHED") return "success";
  if (status === "DRAFT" || status === "PAUSED") return "warning";
  return "default";
}

function statusLabel(status: Task["status"]): string {
  if (status === "PUBLISHED") return "已发布";
  if (status === "DRAFT") return "草稿";
  if (status === "PAUSED") return "已暂停";
  return "已结束";
}

function strategyLabel(strategy: Task["distributionStrategy"]): string {
  if (strategy.type === "FIRST_COME_FIRST_SERVED") return "先到先得";
  if (strategy.type === "ASSIGNMENT") return "指派";
  return "配额抢单";
}

function taskDescription(task: Task): string {
  const description = task.description?.trim();
  if (!description || description.startsWith("task_") || description.includes("Owner:")) {
    return "用于组织标注数据、模板配置、任务分发与结果交付。";
  }
  return description;
}

export default function OwnerTaskDetailPage({ role: _role }: OwnerTaskDetailPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const task = tasksMock.find((item) => item.id === taskId);
  const demoState = getDemoWorkflowState();

  if (!task) {
    return <Card className="state-panel danger-text">任务不存在：{taskId}</Card>;
  }

  const submittedCount = task.id === "task_news_quality" && demoState.assignmentStatus === "SUBMITTED" ? 1 : 0;
  const approvedCount = task.id === "task_news_quality" && demoState.submissionStatus === "ACCEPTED" ? 1 : 0;

  return (
    <div className="page-stack">
      <div className="page-header owner-task-detail-header">
        <div>
          <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
          <h2 className="page-title">{task.title}</h2>
          <p className="page-subtitle">{taskDescription(task)}</p>
          <div className="meta-line">
            <span>创建 {new Date(task.createdAt).toLocaleDateString()}</span>
            <span>{task.deadlineAt ? `截止 ${new Date(task.deadlineAt).toLocaleDateString()}` : "无截止时间"}</span>
            <span>{strategyLabel(task.distributionStrategy)}</span>
          </div>
        </div>
        <div className="page-actions">
          <Link to={RoutePath.OWNER_TASKS} className="lh-button">
            返回任务
          </Link>
          <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button lh-button--primary">
            配置模板
          </Link>
          <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
            导出数据
          </Link>
        </div>
      </div>

      <div className="owner-task-detail-grid">
        <Card className="soft-panel owner-task-detail-main">
          <h3 className="soft-panel__title">任务信息</h3>
          <div className="owner-detail-form">
            <label>
              <span>任务名称</span>
              <div className="owner-readonly-field">{task.title}</div>
            </label>
            <label>
              <span>任务说明</span>
              <div className="owner-readonly-field owner-readonly-field--multiline">{taskDescription(task)}</div>
            </label>
            <div className="owner-detail-form-grid">
              <label>
                <span>任务状态</span>
                <div className="owner-readonly-field">{statusLabel(task.status)}</div>
              </label>
              <label>
                <span>分发策略</span>
                <div className="owner-readonly-field">{strategyLabel(task.distributionStrategy)}</div>
              </label>
              <label>
                <span>总配额</span>
                <div className="owner-readonly-field">{task.quota.total.toLocaleString()}</div>
              </label>
              <label>
                <span>每人上限</span>
                <div className="owner-readonly-field">{task.quota.perLabeler ?? "-"}</div>
              </label>
            </div>
            <label>
              <span>标签</span>
              <div className="owner-tag-row">
                {(task.tags?.length ? task.tags : ["文本标注"]).map((tag) => (
                  <Badge tone="primary" key={tag}>{tag}</Badge>
                ))}
              </div>
            </label>
          </div>
        </Card>

        <Card className="soft-panel owner-task-detail-side">
          <h3 className="soft-panel__title">交付概览</h3>
          <div className="owner-detail-metrics">
            <div>
              <span>已提交</span>
              <strong>{submittedCount}</strong>
            </div>
            <div>
              <span>可导出</span>
              <strong>{approvedCount}</strong>
            </div>
            <div>
              <span>奖励规则</span>
              <strong>
                {task.rewardRule
                  ? `${task.rewardRule.amount} ${task.rewardRule.currency ?? "CNY"} / 条`
                  : "0.30 CNY / 条"}
              </strong>
            </div>
            <div>
              <span>模板</span>
              <strong>{task.title} 模板</strong>
            </div>
          </div>
          <div className="owner-detail-actions">
            <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button lh-button--primary">
              配置模板
            </Link>
            <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
              导出数据
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
