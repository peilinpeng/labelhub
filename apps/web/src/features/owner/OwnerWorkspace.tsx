import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { listTasks } from "../../api/owner";
import { tasksMock } from "../../mocks/data/tasks.mock";
import { Badge, Card, Input, Select } from "../../ui/primitives";
import type { Task } from "@labelhub/contracts";

interface OwnerWorkspaceProps {
  role: Role;
}

function statusTone(status: Task["status"]): "success" | "warning" | "default" {
  if (status === "PUBLISHED") return "success";
  if (status === "DRAFT" || status === "PAUSED") return "warning";
  return "default";
}

function strategyLabel(strategy: Task["distributionStrategy"]): string {
  if (strategy.type === "FIRST_COME_FIRST_SERVED") return "先到先得";
  if (strategy.type === "ASSIGNMENT") return "指派";
  return "配额抢单";
}

function statusLabel(status: Task["status"]): string {
  if (status === "PUBLISHED") return "已发布";
  if (status === "DRAFT") return "草稿";
  if (status === "PAUSED") return "已暂停";
  return "已结束";
}

function taskDescription(task: Task): string {
  const description = task.description?.trim();
  if (!description || description.startsWith("task_") || description.includes("Owner:")) {
    return "用于组织标注数据、模板配置、任务分发与结果交付。";
  }
  return description;
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
        setTasks(data);
        setError(null);
      } catch (e) {
        setTasks(tasksMock);
        setError("后端 API 暂不可用，当前显示本地任务数据。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

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
        const matchesQuery = `${task.title} ${task.description}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesStatus = status === "ALL" || task.status === status;
        return matchesQuery && matchesStatus;
      }),
    [query, status, tasks],
  );

  const selectedTask = selectedTaskId
    ? (visibleTasks.find((task) => task.id === selectedTaskId) ?? tasks.find((task) => task.id === selectedTaskId) ?? null)
    : null;
  const publishedCount = tasks.filter((task) => task.status === "PUBLISHED").length;
  const reviewCount = tasks.filter((task) => task.status === "DRAFT" || task.status === "PAUSED").length;
  const exportableCount = publishedCount;
  const totalQuota = tasks.reduce((sum, task) => sum + task.quota.total, 0);
  const selectedProgress = selectedTask
    ? Math.min(100, Math.round((publishedCount / Math.max(1, tasks.length)) * 100))
    : 0;
  const kpis = [
    { label: "发布中任务", value: publishedCount.toString(), tone: "primary" },
    { label: "草稿", value: reviewCount.toString(), tone: "default" },
    { label: "本周新增提交", value: "3,481", tone: "success" },
  ];

  if (loading) {
    return <Card className="state-panel">加载任务中...</Card>;
  }

  const closeTaskDetail = () => setSelectedTaskId(null);

  return (
    <div className="page-stack">
      {error ? (
        <Card className="owner-fallback-notice">
          <Badge tone="warning">离线模式</Badge>
          <span>{error}</span>
        </Card>
      ) : null}

      <div className="page-header owner-page-header">
        <div>
          <h2 className="page-title">任务管理</h2>
          <p className="page-subtitle">维护任务全生命周期：草稿 → 发布中 → 已暂停 → 已结束</p>
        </div>
      </div>

      <div className="owner-summary-strip" aria-label="任务概览">
        {kpis.map((kpi) => (
          <div className={`owner-summary-item owner-summary-item--${kpi.tone}`} key={kpi.label}>
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
          </div>
        ))}
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
              <span>总配额</span>
              <strong>{totalQuota.toLocaleString()}</strong>
            </div>
          </div>
          <table className="soft-table">
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
                <th>配额 / 进度</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => (
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
                      <span>创建 {new Date(task.createdAt).toLocaleDateString()}</span>
                      <span>{task.deadlineAt ? `截止 ${new Date(task.deadlineAt).toLocaleDateString()}` : "无截止时间"}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                  </td>
                  <td className="owner-table-strong">{strategyLabel(task.distributionStrategy)}</td>
                  <td>
                    <div className="owner-progress-cell">
                      <span>{task.status === "PUBLISHED" ? `2,340 / ${task.quota.total.toLocaleString()}` : task.status === "DRAFT" ? "—" : `980 / ${task.quota.total.toLocaleString()}`}</span>
                      <div className="soft-progress" aria-label="任务进度">
                        <span className="soft-progress__bar" />
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="owner-row-actions" onClick={(event) => event.stopPropagation()}>
                      <Link to={`/owner/tasks/${task.id}`} className="lh-button owner-action-button">
                        查看
                      </Link>
                      <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button owner-action-button">
                        模板
                      </Link>
                      <Link to={`/owner/tasks/${task.id}/export`} className="lh-button owner-action-button">
                        导出
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
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
            onClick={closeTaskDetail}
          />
          <aside className="lh-card soft-panel owner-detail-card owner-detail-modal" role="dialog" aria-modal="true">
            <button type="button" className="owner-detail-close" onClick={closeTaskDetail}>
              关闭
            </button>
          <div className="owner-detail-heading">
            <Badge tone={statusTone(selectedTask?.status ?? "DRAFT")}>
              {selectedTask ? statusLabel(selectedTask.status) : "暂无任务"}
            </Badge>
            <h3>{selectedTask ? `发布任务：${selectedTask.title}` : "暂无任务"}</h3>
            <p>{selectedTask ? taskDescription(selectedTask) : "请选择一个任务查看详情。"}</p>
          </div>

          <div className="owner-publish-note">
            发布后将进入「发布中」状态，标注员将在任务广场看到该任务并可领取。
          </div>

          <div className="owner-detail-form">
            <label>
              <span>任务标题</span>
              <div className="owner-readonly-field">{selectedTask?.title ?? "-"}</div>
            </label>
            <label>
              <span>标签</span>
              <div className="owner-tag-row">
                {(selectedTask?.tags?.length ? selectedTask.tags : ["文本标注"]).map((tag) => (
                  <Badge tone="primary" key={tag}>{tag}</Badge>
                ))}
              </div>
            </label>
            <div className="owner-detail-form-grid">
              <label>
                <span>配额</span>
                <div className="owner-readonly-field">{selectedTask?.quota.total.toLocaleString() ?? "-"}</div>
              </label>
              <label>
                <span>截止时间</span>
                <div className="owner-readonly-field">
                  {selectedTask?.deadlineAt ? new Date(selectedTask.deadlineAt).toLocaleString() : "无截止时间"}
                </div>
              </label>
            </div>
            <label>
              <span>奖励规则</span>
              <div className="owner-readonly-field">
                {selectedTask?.rewardRule
                  ? `${selectedTask.rewardRule.amount} ${selectedTask.rewardRule.currency ?? "CNY"} / 条`
                  : "0.30 CNY / 条"}
              </div>
            </label>
            <label>
              <span>分发策略</span>
              <div className="task-strategy-row">
                <Badge tone={selectedTask?.distributionStrategy.type === "FIRST_COME_FIRST_SERVED" ? "primary" : "default"}>
                  先到先得
                </Badge>
                <Badge tone={selectedTask?.distributionStrategy.type === "ASSIGNMENT" ? "primary" : "default"}>
                  指派
                </Badge>
                <Badge tone={selectedTask?.distributionStrategy.type === "QUOTA_CLAIM" ? "primary" : "default"}>
                  配额抢单
                </Badge>
              </div>
            </label>
            <label>
              <span>关联模板</span>
              <div className="owner-template-row">
                <div className="owner-readonly-field">
                  {selectedTask ? `${selectedTask.title} 模板` : "-"}
                </div>
                <Link to={`/owner/tasks/${selectedTask?.id ?? "task_news_quality"}/designer`} className="lh-button">
                  切换
                </Link>
              </div>
            </label>
            <label>
              <span>启用 AI 预审</span>
              <div className="owner-tag-row">
                <Badge tone="success">已开启</Badge>
                <Badge tone="default">规则：质量相关性</Badge>
              </div>
            </label>
            <div>
              <div className="task-publish-progress-line">
                <span>发布准备度</span>
                <strong>{selectedProgress}%</strong>
              </div>
              <div className="soft-progress soft-progress--wide" aria-label="发布准备度">
                <span className="soft-progress__bar" />
              </div>
            </div>
          </div>

          <div className="owner-detail-actions">
            <Link
              to={`/owner/tasks/${selectedTask?.id ?? "task_news_quality"}`}
              className="lh-button"
            >
              存为草稿
            </Link>
            <Link
              to={`/owner/tasks/${selectedTask?.id ?? "task_news_quality"}/designer`}
              className="lh-button lh-button--primary"
            >
              配置模板 →
            </Link>
          </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
