import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { listTasks } from "../../api/owner";
import { Badge, Button, Card, Input, Select } from "../../ui/primitives";
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
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesQuery = `${task.title} ${task.description} ${task.id}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesStatus = status === "ALL" || task.status === status;
        return matchesQuery && matchesStatus;
      }),
    [query, status, tasks],
  );

  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0] ?? tasks[0];
  const publishedCount = tasks.filter((task) => task.status === "PUBLISHED").length;
  const reviewCount = tasks.filter((task) => task.status === "DRAFT" || task.status === "PAUSED").length;
  const exportableCount = publishedCount;
  const totalQuota = tasks.reduce((sum, task) => sum + task.quota.total, 0);
  const selectedProgress = selectedTask
    ? Math.min(100, Math.round((publishedCount / Math.max(1, tasks.length)) * 100))
    : 0;
  const kpis = [
    { label: "总任务", value: tasks.length.toString(), hint: "覆盖全部任务状态", icon: "总", tone: "primary" },
    { label: "已发布", value: publishedCount.toString(), hint: "可被标注员领取", icon: "发", tone: "success" },
    { label: "待审核", value: reviewCount.toString(), hint: "需要继续配置或复核", icon: "审", tone: "warning" },
    { label: "可导出", value: exportableCount.toString(), hint: "具备交付数据", icon: "出", tone: "violet" },
  ];

  if (loading) {
    return <Card className="state-panel">加载任务中...</Card>;
  }

  if (error) {
    return <Card className="state-panel danger-text">错误: {error}</Card>;
  }

  return (
    <div className="page-stack">
      <div className="page-header owner-page-header">
        <div>
          <Badge tone="primary">Owner Workspace</Badge>
          <h2 className="page-title">任务管理</h2>
          <p className="page-subtitle">创建、发布、追踪标注任务交付状态</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS_NEW} className="lh-button lh-button--primary">
          新建任务
        </Link>
      </div>

      <div className="owner-kpi-grid">
        {kpis.map((kpi) => (
          <Card className={`owner-kpi-card owner-kpi-card--${kpi.tone}`} key={kpi.label}>
            <div className="owner-kpi-card__topline">
              <span className="owner-kpi-icon">{kpi.icon}</span>
              <span>{kpi.label}</span>
            </div>
            <strong>{kpi.value}</strong>
            <p>{kpi.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="filter-bar owner-filter-bar">
        <div className="owner-filter-label">
          <strong>筛选</strong>
          <span>快速定位任务</span>
        </div>
        <label className="owner-filter-search">
          <span>搜索</span>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务名 / ID / 描述" />
        </label>
        <label>
          <span>状态</span>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">全部状态</option>
            <option value="DRAFT">草稿</option>
            <option value="PUBLISHED">已发布</option>
            <option value="PAUSED">已暂停</option>
            <option value="ENDED">已结束</option>
          </Select>
        </label>
        <label>
          <span>任务类型</span>
          <Select defaultValue="ALL">
            <option value="ALL">全部类型</option>
            <option value="TEXT">文本标注</option>
            <option value="QUALITY">质量评估</option>
          </Select>
        </label>
        <label>
          <span>分发策略</span>
          <Select defaultValue="ALL">
            <option value="ALL">全部策略</option>
            <option value="FIRST_COME_FIRST_SERVED">先到先得</option>
            <option value="ASSIGNMENT">指派</option>
            <option value="QUOTA_CLAIM">配额抢单</option>
          </Select>
        </label>
      </Card>

      <div className="owner-management-layout">
        <Card className="soft-panel owner-table-card">
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
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>分发策略</th>
                <th>配额</th>
                <th>进度</th>
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
                >
                  <td>
                    <h3 className="task-title owner-task-title">{task.title}</h3>
                    <div className="meta-line">
                      <span>{task.id}</span>
                      <span>Owner: {task.ownerId}</span>
                      <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                  </td>
                  <td className="owner-table-strong">{strategyLabel(task.distributionStrategy)}</td>
                  <td className="owner-table-strong">{task.quota.total.toLocaleString()}</td>
                  <td>
                    <div className="owner-progress-cell">
                      <div className="soft-progress" aria-label="任务进度">
                        <span className="soft-progress__bar" />
                      </div>
                      <span>{task.status === "PUBLISHED" ? "62%" : "28%"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="owner-row-actions">
                      <Button onClick={() => setSelectedTaskId(task.id)}>
                        查看
                      </Button>
                      <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button">
                        模板
                      </Link>
                      <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
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

        <Card className="soft-panel owner-detail-card">
          <div className="owner-detail-hero">
            <div>
              <div className="owner-detail-kicker">
                <span>当前任务</span>
                <Badge tone={statusTone(selectedTask?.status ?? "DRAFT")}>
                  {selectedTask ? statusLabel(selectedTask.status) : "暂无任务"}
                </Badge>
              </div>
              <h3>{selectedTask ? selectedTask.title : "暂无任务"}</h3>
              <p>发布后进入任务市场，标注员可按分发策略领取。</p>
            </div>
          </div>

          <div className="owner-detail-section">
            <div className="owner-detail-section__title">任务信息</div>
            <div className="owner-detail-metrics">
              <div>
                <span>任务 ID</span>
                <strong>{selectedTask?.id ?? "-"}</strong>
              </div>
              <div>
                <span>创建日期</span>
                <strong>{selectedTask ? new Date(selectedTask.createdAt).toLocaleDateString() : "-"}</strong>
              </div>
            </div>
          </div>

          <div className="owner-detail-section">
            <div className="owner-detail-section__title">奖励与配额</div>
            <div className="owner-detail-metrics">
              <div>
                <span>奖励</span>
                <strong>
                  {selectedTask?.rewardRule
                    ? `${selectedTask.rewardRule.amount} ${selectedTask.rewardRule.currency ?? "CNY"} / 条`
                    : "0.30 CNY / 条"}
                </strong>
              </div>
              <div>
                <span>总配额</span>
                <strong>{selectedTask?.quota.total.toLocaleString() ?? "-"}</strong>
              </div>
            </div>
          </div>

          <div className="owner-detail-section">
            <div className="owner-detail-section__title">分发策略</div>
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
          </div>

          <div className="owner-detail-section">
            <div className="task-publish-progress-line">
              <span>发布准备度</span>
              <strong>{selectedProgress}%</strong>
            </div>
            <div className="soft-progress soft-progress--wide" aria-label="发布准备度">
              <span className="soft-progress__bar" />
            </div>
          </div>

          <div className="owner-detail-actions">
            <Link
              to={`/owner/tasks/${selectedTask?.id ?? "task_news_quality"}/designer`}
              className="lh-button lh-button--primary"
            >
              配置模板
            </Link>
            <Link
              to={`/owner/tasks/${selectedTask?.id ?? "task_news_quality"}/export`}
              className="lh-button"
            >
              导出数据
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
