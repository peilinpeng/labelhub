import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { listTasks } from "../../api/owner";
import { Badge, Card, Input, KpiCard, Select } from "../../ui/primitives";
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

export default function OwnerWorkspace({ role }: OwnerWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
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

  const selectedTask = visibleTasks[0] ?? tasks[0];
  const publishedCount = tasks.filter((task) => task.status === "PUBLISHED").length;
  const draftCount = tasks.filter((task) => task.status === "DRAFT").length;
  const totalQuota = tasks.reduce((sum, task) => sum + task.quota.total, 0);
  const selectedProgress = selectedTask
    ? Math.min(100, Math.round((publishedCount / Math.max(1, tasks.length)) * 100))
    : 0;

  if (loading) {
    return <Card className="state-panel">加载任务中...</Card>;
  }

  if (error) {
    return <Card className="state-panel danger-text">错误: {error}</Card>;
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">任务发布</h2>
          <p className="page-subtitle">当前角色：{role}。维护任务生命周期：草稿、发布中、已暂停、已结束。</p>
        </div>
        <Link to={RoutePath.OWNER_TASKS_NEW} className="lh-button lh-button--primary">
          新建任务
        </Link>
      </div>

      <div className="kpi-grid owner-kpi-grid">
        <KpiCard label="发布中任务" value={publishedCount} hint="可被标注员领取" />
        <KpiCard label="草稿" value={draftCount} hint="等待模板和数据集" />
        <KpiCard label="总配额" value={totalQuota.toLocaleString()} hint="MVP mock 数据" />
      </div>

      <Card className="filter-bar">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务名 / ID / 描述" />
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="ALL">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="PUBLISHED">发布中</option>
          <option value="PAUSED">已暂停</option>
          <option value="ENDED">已结束</option>
        </Select>
        <Select defaultValue="ALL">
          <option value="ALL">分发策略：全部</option>
          <option value="FIRST_COME_FIRST_SERVED">先到先得</option>
          <option value="ASSIGNMENT">指派</option>
        </Select>
      </Card>

      <div className="task-publish-layout">
        <Card className="soft-panel owner-table-card">
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
                <tr className="owner-task-row" key={task.id}>
                  <td>
                    <h3 className="task-title owner-task-title">{task.title}</h3>
                    <div className="meta-line">
                      <span>{task.id}</span>
                      <span>Owner: {task.ownerId}</span>
                      <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                  </td>
                  <td className="owner-table-strong">{strategyLabel(task.distributionStrategy)}</td>
                  <td className="owner-table-strong">{task.quota.total.toLocaleString()}</td>
                  <td>
                    <div className="soft-progress" aria-label="任务进度">
                      <span className="soft-progress__bar" />
                    </div>
                  </td>
                  <td>
                    <div className="page-actions">
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

        <Card className="soft-panel task-publish-panel owner-detail-card">
          <div>
            <Badge tone="primary">发布任务</Badge>
            <h3 className="task-publish-panel__title">
              {selectedTask ? selectedTask.title : "暂无任务"}
            </h3>
            <p className="page-subtitle">
              发布后进入「任务市场」，标注员可按分发策略领取。
            </p>
          </div>

          <div className="form-stack owner-detail-groups">
            <label className="field-label">
              任务标题
              <Input value={selectedTask?.title ?? ""} readOnly />
            </label>
            <label className="field-label">
              奖励规则
              <Input
                value={
                  selectedTask?.rewardRule
                    ? `${selectedTask.rewardRule.amount} ${selectedTask.rewardRule.currency ?? "CNY"} / 条`
                    : "0.30 元 / 条 · 月度封顶 1500 元"
                }
                readOnly
              />
            </label>
            <label className="field-label">
              配额
              <Input value={selectedTask?.quota.total.toLocaleString() ?? ""} readOnly />
            </label>
            <label className="field-label">
              分发策略
              <div className="page-actions">
                <Badge tone={selectedTask?.distributionStrategy.type === "FIRST_COME_FIRST_SERVED" ? "primary" : "default"}>
                  先到先得
                </Badge>
                <Badge>指派</Badge>
                <Badge>配额抢单</Badge>
              </div>
            </label>
            <div className="inset-well">
              <div className="task-publish-progress-line">
                <span>发布准备度</span>
                <strong>{selectedProgress}%</strong>
              </div>
              <div className="soft-progress soft-progress--wide" aria-label="发布准备度">
                <span className="soft-progress__bar" />
              </div>
            </div>
            <div className="inset-well">
              <p className="page-subtitle">
                这里不改 mock workflow：当前页面只负责展示发布信息和跳转模板搭建。
              </p>
            </div>
            <Link
              to={`/owner/tasks/${selectedTask?.id ?? "task_news_quality"}/designer`}
              className="lh-button lh-button--primary"
            >
              进入模板搭建
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
