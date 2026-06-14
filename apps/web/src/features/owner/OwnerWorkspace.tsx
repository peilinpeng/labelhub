import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { archiveTask, endTask, fetchTaskStats, listTasks } from "../../api/owner";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Badge, Button, Card, Input, Select } from "../../ui/primitives";
import type { Task } from "@labelhub/contracts";
import type { TaskStats } from "../../api/owner";

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

function DataIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <ellipse cx="12" cy="5.5" rx="7" ry="3" />
      <path d="M5 5.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      <path d="M5 11.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
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

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

type BadgeTone = "success" | "warning" | "default";

type TaskStatsState =
  | { status: "loading" }
  | { status: "ready"; stats: TaskStats }
  | { status: "error" };

function statusTone(status: Task["status"]): BadgeTone {
  if (status === "PUBLISHED") return "success";
  if (status === "DRAFT" || status === "PAUSED") return "warning";
  return "default";
}

function statusLabel(status: Task["status"]): string {
  if (status === "PUBLISHED") return "发布中";
  if (status === "DRAFT") return "草稿任务";
  if (status === "PAUSED") return "已暂停";
  if (status === "ARCHIVED") return "已归档";
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

function getDeadlineView(value?: string | null): { label: string; hint?: string } {
  if (!value) return { label: "无截止时间" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "无截止时间" };
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return { label: "已截止", hint: `截止 ${date.toLocaleString()}` };
  return { label: `截止 ${date.toLocaleDateString()}`, hint: `剩余 ${Math.ceil(diffMs / 86_400_000)} 天` };
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
  // 仅隐藏自动化测试 / 压测产生的脏任务；真实任务与演示任务（含举办方数据集）正常展示。
  return /E2E测试|端到端测试|并发测试|压力测试|压测|烟雾测试|冒烟测试|smoke[\s_-]*test/i.test(text);
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function progressTotal(task: Task, stats: TaskStats): number {
  return stats.datasetTotal > 0 ? stats.datasetTotal : task.quota.total;
}

function quotaProgressLabel(task: Task, stats: TaskStats): string {
  if (stats.quotaRemaining !== null && stats.quotaTotal !== null) {
    return `配额剩余 ${stats.quotaRemaining.toLocaleString()} / ${stats.quotaTotal.toLocaleString()}`;
  }
  if (stats.datasetTotal > 0) {
    return `可领取 ${stats.datasetAvailable.toLocaleString()} / ${stats.datasetTotal.toLocaleString()}`;
  }
  return `配额 ${task.quota.total.toLocaleString()}`;
}

function TaskProgressSummary({ task, state }: { task: Task; state?: TaskStatsState }) {
  if (task.status === "DRAFT") {
    return <div className="owner-progress-note">草稿任务，发布后开始统计进度</div>;
  }
  if (!state || state.status === "loading") {
    return <div className="owner-progress-note">进度加载中</div>;
  }
  if (state.status === "error") {
    return <div className="owner-progress-note owner-progress-note--error">进度暂不可用</div>;
  }

  const stats = state.stats;
  const total = progressTotal(task, stats);
  if (total <= 0) {
    return <div className="owner-progress-note">暂无数据</div>;
  }

  const progress = clampProgress(stats.progressPercent);
  return (
    <div className="owner-progress-cell" aria-label={`${task.title} 任务进度`}>
      <div className="owner-progress-cell__top">
        <strong>完成 {progress}%</strong>
        <span>已提交 {stats.submittedTotal.toLocaleString()} / {total.toLocaleString()}</span>
      </div>
      <div className="owner-task-progress-bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="owner-progress-cell__split">
        <span>进行中 {stats.inProgress.toLocaleString()}</span>
        <span>待审核 {stats.inReview.toLocaleString()}</span>
        <span>已通过 {stats.accepted.toLocaleString()}</span>
        <span>已打回 {stats.returned.toLocaleString()}</span>
      </div>
      <small>{quotaProgressLabel(task, stats)}</small>
    </div>
  );
}

export default function OwnerWorkspace({ role: _role }: OwnerWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskStats, setTaskStats] = useState<Record<string, TaskStatsState>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [strategy, setStrategy] = useState("ALL");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listTasks();
        setTasks(data.filter((task) => task.status !== "ARCHIVED" && !isPlaceholderTask(task)));
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
    const statTasks = tasks.filter((task) => task.status !== "DRAFT");
    if (statTasks.length === 0) {
      setTaskStats({});
      return;
    }

    let cancelled = false;
    setTaskStats(
      Object.fromEntries(statTasks.map((task) => [task.id, { status: "loading" } satisfies TaskStatsState])),
    );

    void Promise.all(
      statTasks.map(async (task) => {
        try {
          const stats = await fetchTaskStats(task.id);
          if (!cancelled) {
            setTaskStats((current) => ({ ...current, [task.id]: { status: "ready", stats } }));
          }
        } catch {
          if (!cancelled) {
            setTaskStats((current) => ({ ...current, [task.id]: { status: "error" } }));
          }
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [tasks]);

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
        const matchesStrategy = strategy === "ALL" || task.distributionStrategy.type === strategy;
        return matchesQuery && matchesStatus && matchesStrategy;
      }),
    [query, status, strategy, tasks],
  );

  const selectedTask = selectedTaskId
    ? (tasks.find((task) => task.id === selectedTaskId) ?? null)
    : null;
  const selectedDeadlineView = selectedTask ? getDeadlineView(selectedTask.deadlineAt) : null;

  const publishedCount = tasks.filter((task) => task.status === "PUBLISHED").length;
  const draftTasks = tasks.filter((task) => task.status === "DRAFT");
  const draftCount = draftTasks.length;
  const totalQuota = tasks.reduce((sum, task) => sum + task.quota.total, 0);

  const handleDeleteTask = async () => {
    if (!deleteTarget || deleting) return;

    const reason = "Owner 在任务管理页确认删除任务。";
    try {
      setDeleting(true);
      if (deleteTarget.status === "DRAFT") {
        throw new Error("当前后端暂未开放草稿任务删除接口，任务未删除。");
      }
      if (deleteTarget.status === "PUBLISHED" || deleteTarget.status === "PAUSED") {
        await endTask(deleteTarget.id, reason);
      }
      await archiveTask(deleteTarget.id, reason);
      setTasks((current) => current.filter((task) => task.id !== deleteTarget.id));
      setSelectedTaskId((current) => (current === deleteTarget.id ? null : current));
      setDeleteMessage({ tone: "success", text: `任务「${deleteTarget.title}」已删除，并保留后端审计记录。` });
      setDeleteTarget(null);
    } catch (cause) {
      setDeleteMessage({
        tone: "danger",
        text: cause instanceof Error ? `删除失败：${cause.message}` : "删除失败：后端未完成该操作。",
      });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const deleteDialogDescription = deleteTarget
    ? deleteTarget.status === "DRAFT"
      ? `当前任务「${deleteTarget.title}」仍是草稿。现有后端只允许删除已发布后结束的任务，因此确认后如果后端不支持草稿删除，任务会保留在列表中。`
      : `确定要删除任务「${deleteTarget.title}」吗？删除会通过后端状态机结束并归档任务，任务将从当前列表隐藏，已有标注、审核和审计记录仍会保留。`
    : "";

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

      {deleteMessage ? (
        <Card className="owner-fallback-notice">
          <Badge tone={deleteMessage.tone}>{deleteMessage.tone === "success" ? "已删除" : "删除失败"}</Badge>
          <span>{deleteMessage.text}</span>
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

      <Card className="soft-panel owner-draft-card">
        <div className="owner-draft-head">
          <div>
            <h3>任务草稿 · 待完成配置流程</h3>
            <p>创建任务后先导入数据，再配置模板、AI 预审和发布检查。</p>
          </div>
          <Badge tone="warning">{draftCount} 个草稿</Badge>
        </div>
        {draftTasks.length === 0 ? (
          <div className="empty-state">暂无任务草稿。新建任务后，可在这里继续配置模板。</div>
        ) : (
          <div className="owner-draft-list">
            {draftTasks.map((task) => (
              <div className="owner-draft-item" key={task.id}>
                <div className="owner-draft-item__info">
                  <strong>{task.title}</strong>
                  <div className="owner-draft-item__tags">
                    <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                    <Badge tone={task.activeSchemaVersionId ? "success" : "warning"}>
                      {task.activeSchemaVersionId ? "已发布模板" : "未发布模板"}
                    </Badge>
                  </div>
                </div>
                <Link className="lh-button lh-button--primary" to={`/owner/tasks/${task.id}/data`}>
                  继续数据管理
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

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
            <Select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
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
                <th>进度</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => {
                const deadlineView = getDeadlineView(task.deadlineAt);
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
                        <span>{deadlineView.label}</span>
                        {deadlineView.hint ? <span>{deadlineView.hint}</span> : null}
                        <span>数据量 {task.quota.total.toLocaleString()}</span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                    </td>
                    <td className="owner-table-strong">{strategyLabel(task.distributionStrategy)}</td>
                    <td>
                      <TaskProgressSummary task={task} state={taskStats[task.id]} />
                    </td>
                    <td>
                      <div
                        className="owner-row-actions"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Link
                          to={`/owner/tasks/${task.id}`}
                          className="owner-icon-action"
                          aria-label="查看"
                          data-tooltip="查看"
                        >
                          <EyeIcon />
                        </Link>
                        <Link
                          to={`/owner/tasks/${task.id}/data`}
                          className="owner-icon-action"
                          aria-label="数据管理"
                          data-tooltip="数据"
                        >
                          <DataIcon />
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
                        <button
                          type="button"
                          className="owner-icon-action owner-icon-action--danger"
                          aria-label={`删除 ${task.title}`}
                          data-tooltip="删除"
                          onClick={() => {
                            setDeleteMessage(null);
                            setDeleteTarget(task);
                          }}
                        >
                          <TrashIcon />
                        </button>
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
              <label>
                <span>截止时间</span>
                <div className="owner-readonly-field">
                  {selectedDeadlineView?.label ?? "无截止时间"}
                  {selectedDeadlineView?.hint ? ` · ${selectedDeadlineView.hint}` : ""}
                </div>
              </label>
            </div>

            <div className="owner-detail-actions">
              <Link to={`/owner/tasks/${selectedTask.id}/data`} className="lh-button">
                数据管理
              </Link>
              <Link to={`/owner/tasks/${selectedTask.id}/designer`} className="lh-button lh-button--primary">
                配置模板
              </Link>
              <Link to={`/owner/tasks/${selectedTask.id}/ai-precheck`} className="lh-button">
                AI 预审配置
              </Link>
              <Link to={`/owner/tasks/${selectedTask.id}/export`} className="lh-button">
                导出数据
              </Link>
              <Button
                type="button"
                tone="danger"
                onClick={() => {
                  setDeleteMessage(null);
                  setDeleteTarget(selectedTask);
                }}
              >
                删除任务
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除任务"
        description={deleteDialogDescription}
        confirmText={deleting ? "删除中" : "确认删除"}
        cancelText="取消"
        tone="danger"
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDeleteTask()}
      />
    </div>
  );
}
