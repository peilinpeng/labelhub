import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listTasks } from "../../api/owner";
import { Badge, Card, Input, Select } from "../../ui/primitives";
import type { Task } from "@labelhub/contracts";

interface OwnerWorkspaceProps {
  role: "OWNER" | "LABELER" | "REVIEWER";
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M8.5 4v16M8.5 9.5h12M13 14h4.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 18.5h15" />
    </svg>
  );
}

type BadgeTone = "success" | "warning" | "default";

function statusTone(status: Task["status"]): BadgeTone {
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

function formatDate(value?: string | null): string {
  if (!value) return "无截止时间";
  return new Date(value).toLocaleDateString();
}

function taskDescription(task: Task): string {
  const description = task.description?.trim();
  const looksInternal =
    !description ||
    description.startsWith("task_") ||
    description.includes("Owner:") ||
    /[a-f0-9]{16,}/i.test(description);

  if (looksInternal) {
    return "用于组织标注数据、模板配置、任务分发与结果交付。";
  }
  return description;
}

function isPlaceholderTask(task: Task): boolean {
  const text = `${task.id} ${task.title} ${task.description ?? ""}`;
  return /task_news_quality|task_product_title|新闻质量标注|商品标题清洗|商品标题清洗 v3|\bDemo\s*[A-Z]\b|Breaking Change|Deprecated|安全发布|破坏性模板调整|发布前检查会阻断|字段进入废弃流程/i.test(text);
}

export default function OwnerWorkspace({ role: _role }: OwnerWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listTasks();
        setTasks(data.filter((task) => !isPlaceholderTask(task)));
        setError(null);
      } catch (cause) {
        setTasks([]);
        setError(cause instanceof Error ? cause.message : "任务接口暂不可用，请检查后端服务。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedTaskId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTaskId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTaskId]);

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const searchable = `${task.title} ${taskDescription(task)}`.toLowerCase();
        const matchesQuery = searchable.includes(query.toLowerCase());
        const matchesStatus = status === "ALL" || task.status === status;
        return matchesQuery && matchesStatus;
      }),
    [query, status, tasks],
  );

  const selectedTask = selectedTaskId
    ? (tasks.find((task) => task.id === selectedTaskId) ?? null)
    : null;

  const publishedCount = tasks.filter((task) => task.status === "PUBLISHED").length;
  const draftCount = tasks.filter((task) => task.status === "DRAFT").length;
  const totalQuota = tasks.reduce((sum, task) => sum + task.quota.total, 0);

  if (loading) {
    return <Card className="state-panel">加载任务中...</Card>;
  }

  return (
    <div className="page-stack">
      {error ? (
        <Card className="owner-fallback-notice">
          <Badge tone="danger">加载失败</Badge>
          <span>未加载任何占位数据。{error}</span>
        </Card>
      ) : null}

      <div className="page-header owner-page-header">
        <div>
          <h2 className="page-title">任务管理</h2>
          <p className="page-subtitle">维护任务全生命周期：草稿 → 发布中 → 已暂停 → 已结束</p>
        </div>
      </div>

      <div className="owner-summary-strip" aria-label="任务概览">
        <div className="owner-summary-item owner-summary-item--primary">
          <span>发布中任务</span>
          <strong>{publishedCount}</strong>
        </div>
        <div className="owner-summary-item">
          <span>草稿</span>
          <strong>{draftCount}</strong>
        </div>
        <div className="owner-summary-item owner-summary-item--success">
          <span>任务总数</span>
          <strong>{tasks.length}</strong>
        </div>
      </div>

      <div className="owner-management-layout">
        <Card className="soft-panel owner-table-card">
          <div className="owner-filter-toolbar">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务名 / 描述" />
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ALL">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="PUBLISHED">已发布</option>
              <option value="PAUSED">已暂停</option>
              <option value="ENDED">已结束</option>
            </Select>
            <Select defaultValue="ALL">
              <option value="ALL">分发策略：全部</option>
              <option value="FIRST_COME_FIRST_SERVED">先到先得</option>
              <option value="ASSIGNMENT">指派</option>
              <option value="QUOTA_CLAIM">配额抢单</option>
            </Select>
          </div>

          <div className="owner-table-header">
            <div>
              <h3>任务列表</h3>
              <p>{visibleTasks.length} 个任务匹配当前筛选</p>
            </div>
            <div className="owner-table-summary">
              <span>总数据量</span>
              <strong>{totalQuota.toLocaleString()}</strong>
            </div>
          </div>

          <table className="soft-table owner-task-table">
            <colgroup>
              <col className="owner-col-task" />
              <col className="owner-col-status" />
              <col className="owner-col-strategy" />
              <col className="owner-col-progress" />
              <col className="owner-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>分发策略</th>
                <th>数据量</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => {
                return (
                  <tr
                    className={["owner-task-row", selectedTask?.id === task.id ? "owner-task-row--selected" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTaskId(task.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td>
                      <h3 className="task-title owner-task-title">{task.title}</h3>
                      <p className="owner-task-description">{taskDescription(task)}</p>
                      <div className="meta-line owner-task-meta">
                        <span>创建 {formatDate(task.createdAt)}</span>
                        <span>截止 {formatDate(task.deadlineAt)}</span>
                        <span>数据量 {task.quota.total.toLocaleString()}</span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                    </td>
                    <td className="owner-table-strong">{strategyLabel(task.distributionStrategy)}</td>
                    <td>
                      <div className="owner-progress-cell">
                        <span>{task.quota.total.toLocaleString()} 条</span>
                      </div>
                    </td>
                    <td>
                      <div className="owner-row-actions" onClick={(event) => event.stopPropagation()}>
                        <Link
                          to={`/owner/tasks/${task.id}`}
                          className="owner-icon-action"
                          aria-label="查看"
                          data-tooltip="查看"
                        >
                          <EyeIcon />
                        </Link>
                        <Link
                          to={`/owner/tasks/${task.id}/designer`}
                          className="owner-icon-action"
                          aria-label="模板"
                          data-tooltip="模板"
                        >
                          <TemplateIcon />
                        </Link>
                        <Link
                          to={`/owner/tasks/${task.id}/export`}
                          className="owner-icon-action"
                          aria-label="导出"
                          data-tooltip="导出"
                        >
                          <DownloadIcon />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibleTasks.length === 0 ? <div className="empty-state">暂无匹配任务</div> : null}
        </Card>
      </div>

      {selectedTask ? (
        <div className="owner-detail-modal-layer" role="presentation">
          <button
            type="button"
            className="owner-detail-modal-overlay"
            aria-label="关闭任务详情"
            onClick={() => setSelectedTaskId(null)}
          />
          <aside className="lh-card soft-panel owner-detail-card owner-detail-modal" role="dialog" aria-modal="true">
            <button
              type="button"
              className="owner-detail-close"
              aria-label="关闭任务详情"
              title="关闭"
              onClick={() => setSelectedTaskId(null)}
            >
              ×
            </button>

            <div className="owner-detail-heading">
              <Badge tone={statusTone(selectedTask.status)}>{statusLabel(selectedTask.status)}</Badge>
              <h3>{selectedTask.title}</h3>
              <p>{taskDescription(selectedTask)}</p>
            </div>

            <div className="owner-detail-form">
              <label>
                <span>任务名称</span>
                <div className="owner-readonly-field">{selectedTask.title}</div>
              </label>
              <label>
                <span>任务描述</span>
                <div className="owner-readonly-field owner-readonly-field--multiline">{taskDescription(selectedTask)}</div>
              </label>
              <div className="owner-detail-form-grid">
                <label>
                  <span>状态</span>
                  <div className="owner-readonly-field">{statusLabel(selectedTask.status)}</div>
                </label>
                <label>
                  <span>配额</span>
                  <div className="owner-readonly-field">{selectedTask.quota.total.toLocaleString()}</div>
                </label>
              </div>
              <label>
                <span>奖励</span>
                <div className="owner-readonly-field">
                  {selectedTask.rewardRule
                    ? `${selectedTask.rewardRule.amount} ${selectedTask.rewardRule.currency ?? "CNY"} / 条`
                    : "未配置"}
                </div>
              </label>
              <label>
                <span>分发策略</span>
                <div className="owner-readonly-field">{strategyLabel(selectedTask.distributionStrategy)}</div>
              </label>
            </div>

            <div className="owner-detail-actions">
              <Link to={`/owner/tasks/${selectedTask.id}/designer`} className="lh-button lh-button--primary">
                配置模板
              </Link>
              <Link to={`/owner/tasks/${selectedTask.id}/export`} className="lh-button">
                导出数据
              </Link>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
