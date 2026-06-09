import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { fetchTask, fetchTaskStats, type TaskStats } from "../../api/owner";
import { Badge, Card } from "../../ui/primitives";
import { MarkdownPreview, docToMarkdown } from "../../ui/markdown";
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

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "无截止时间";
}

export default function OwnerTaskDetailPage({ role: _role }: OwnerTaskDetailPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!taskId) return;
      try {
        setLoading(true);
        setError(null);
        setTask(await fetchTask(taskId));
      } catch (cause) {
        setTask(null);
        setError(cause instanceof Error ? cause.message : "任务详情接口暂不可用。");
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    // 统计是看板增强项，失败不影响任务详情主体渲染。
    void fetchTaskStats(taskId).then(setStats).catch(() => setStats(null));
  }, [taskId]);

  if (loading) {
    return <Card className="state-panel">加载任务详情中...</Card>;
  }

  if (!task) {
    return <Card className="state-panel danger-text">任务详情加载失败：{error ?? taskId}</Card>;
  }

  const activeVersionLabel = task.activeSchemaVersionId ?? "尚未绑定版本";

  return (
    <div className="page-stack owner-task-board-page">
      <div className="page-header owner-task-detail-header">
        <div>
          <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
          <h2 className="page-title">{task.title}</h2>
          <p className="page-subtitle">{taskDescription(task)}</p>
          <div className="meta-line">
            <span>创建 {formatDate(task.createdAt)}</span>
            <span>截止 {formatDate(task.deadlineAt)}</span>
            <span>{strategyLabel(task.distributionStrategy)}</span>
            <span>当前模板 {activeVersionLabel}</span>
          </div>
        </div>
        <div className="page-actions">
          <Link to={RoutePath.OWNER_TASKS} className="lh-button">
            返回任务
          </Link>
          <Link to={`/owner/tasks/${task.id}/dataset`} className="lh-button">
            管理数据集
          </Link>
          <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button lh-button--primary">
            配置模板
          </Link>
          <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
            导出数据
          </Link>
        </div>
      </div>

      <section className="owner-task-board-grid" aria-label="任务看板">
        <Card className="owner-board-card owner-board-card--primary">
          <span>提交进度</span>
          <strong>{stats ? `${stats.submittedTotal}/${stats.datasetTotal}` : "-"}</strong>
          <p>{stats ? `已提交 ${stats.submittedTotal} / 共 ${stats.datasetTotal} 题` : "等待后端返回真实提交统计"}</p>
          <div className="soft-progress soft-progress--wide">
            <span className="soft-progress__bar" style={{ width: `${stats?.progressPercent ?? 0}%` }} />
          </div>
        </Card>
        <Card className="owner-board-card">
          <span>可导出结果</span>
          <strong>{stats ? stats.accepted : "-"}</strong>
          <p>审核通过后进入导出池</p>
        </Card>
        <Card className="owner-board-card">
          <span>剩余配额</span>
          <strong>{stats?.quotaRemaining ?? "-"}</strong>
          <p>按 {strategyLabel(task.distributionStrategy)} 分发</p>
        </Card>
        <Card className="owner-board-card">
          <span>人均上限</span>
          <strong>{task.quota.perLabeler ?? "-"}</strong>
          <p>{task.rewardRule ? `${task.rewardRule.amount} ${task.rewardRule.currency ?? "CNY"} / 条` : "未配置奖励"}</p>
        </Card>
      </section>

      <div className="owner-task-management-grid">
        <Card className="soft-panel owner-task-detail-main">
          <div className="owner-section-heading">
            <div>
              <h3>详细任务看板</h3>
              <p>面向任务所有者的概览，不跳转到标注员工作台。</p>
            </div>
            <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
          </div>
          <div className="owner-detail-form">
            <label>
              <span>任务名称</span>
              <div className="owner-readonly-field">{task.title}</div>
            </label>
            <label>
              <span>任务说明</span>
              <div className="owner-readonly-field owner-readonly-field--multiline">{taskDescription(task)}</div>
            </label>
            <label>
              <span>标注说明（标注员作答时可见）</span>
              {docToMarkdown(task.instructionRichText).trim() ? (
                <div className="owner-readonly-field owner-readonly-field--multiline">
                  <MarkdownPreview source={docToMarkdown(task.instructionRichText)} />
                </div>
              ) : (
                <div className="owner-readonly-field owner-readonly-field--multiline owner-readonly-field--muted">
                  未填写标注说明
                </div>
              )}
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
                {task.tags?.length ? task.tags.map((tag) => (
                  <Badge tone="primary" key={tag}>{tag}</Badge>
                )) : <span className="page-subtitle">未设置标签</span>}
              </div>
            </label>
          </div>
        </Card>

        <aside className="owner-task-side-stack">
          <Card className="soft-panel owner-management-card">
            <div className="owner-section-heading">
              <div>
                <h3>标注任务管理</h3>
                <p>跟踪领取、提交、打回与通过情况。</p>
              </div>
            </div>
            <div className="owner-status-list">
              <div><span>进行中</span><strong>{stats?.inProgress ?? "-"}</strong></div>
              <div><span>已提交</span><strong>{stats?.inReview ?? "-"}</strong></div>
              <div><span>已通过</span><strong>{stats?.accepted ?? "-"}</strong></div>
              <div><span>已打回</span><strong>{stats?.returned ?? "-"}</strong></div>
            </div>
            <div className="owner-task-actions-grid">
              <Link to={`/owner/tasks/${task.id}/dataset`} className="lh-button">
                管理数据集
              </Link>
              <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
                查看交付
              </Link>
            </div>
          </Card>

          <Card className="soft-panel owner-labeler-progress-card">
            <div className="owner-section-heading">
              <div>
                <h3>标注员进展</h3>
                <p>按人员查看完成量、通过量、打回量和当前题目。</p>
              </div>
            </div>
            <div className="owner-labeler-progress-list">
              <div className="empty-state">暂无真实标注员进展数据</div>
            </div>
          </Card>

          <Card className="soft-panel owner-version-card">
            <div className="owner-section-heading">
              <div>
                <h3>发布后版本管理</h3>
                <p>发布版本、当前绑定版本和后续升级入口。</p>
              </div>
              <Badge tone="primary">{activeVersionLabel}</Badge>
            </div>
            <div className="owner-version-timeline">
              <div className="owner-version-item owner-version-item--active">
                <strong>当前生产版本</strong>
                <span>{activeVersionLabel}</span>
                <p>标注员领取任务时使用此版本渲染表单。</p>
              </div>
              <div className="owner-version-item">
                <strong>草稿版本</strong>
                <span>{task.status === "PUBLISHED" ? "可继续编辑并发布新版本" : "发布后生成 v1"}</span>
                <p>保存并发布会触发 Schema 版本治理预检。</p>
              </div>
              <div className="owner-version-item">
                <strong>兼容性与迁移</strong>
                <span>发布前检查</span>
                <p>字段变更、弃用和人工映射由发布预检统一处理。</p>
              </div>
            </div>
            <div className="owner-detail-actions">
              <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button lh-button--primary">
                管理模板版本
              </Link>
              <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
                导出数据
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
