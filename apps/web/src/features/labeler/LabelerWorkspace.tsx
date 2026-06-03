import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Role } from "../../app/routes";
import { claimTask, listMarketplaceTasks } from "../../api/labeler";
import { Badge, Button, Card, KpiCard } from "../../ui/primitives";
import type { ClaimTaskResponse, Task } from "@labelhub/contracts";
import { claimDemoAssignment, DEMO_ASSIGNMENT_ID, getDemoWorkflowState } from "../../mocks/demo-workflow-store";
import { tasksMock } from "../../mocks/data/tasks.mock";
import { listLocalTasks } from "../../mocks/local-task-store";

interface LabelerWorkspaceProps {
  role: Role;
}

export default function LabelerWorkspace({ role }: LabelerWorkspaceProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);
  const [claimedAssignmentId, setClaimedAssignmentId] = useState<string | null>(() =>
    getDemoWorkflowState().assignmentStatus ? DEMO_ASSIGNMENT_ID : null,
  );

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listMarketplaceTasks();
        setTasks(data);
        setOfflineNotice(null);
      } catch (e) {
        setTasks(getLocalMarketplaceTasks());
        setOfflineNotice(`后端 API 暂不可用，当前显示本地任务数据。${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleClaimTask = async (taskId: string) => {
    try {
      setClaimingTaskId(taskId);
      claimDemoAssignment();
      setClaimedAssignmentId(DEMO_ASSIGNMENT_ID);
      try {
        const response: ClaimTaskResponse = await claimTask(taskId, {});
        navigate(`/labeler/workspace/${response.context.assignment.id}`);
      } catch {
        navigate(`/labeler/workspace/${DEMO_ASSIGNMENT_ID}`);
      }
    } finally {
      setClaimingTaskId(null);
    }
  };

  if (loading) {
    return <Card className="state-panel">加载任务市场中...</Card>;
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">任务市场</h2>
          <p className="page-subtitle">当前角色：{role}。领取任务后进入标注工作台，填写答案并提交审核。</p>
        </div>
      </div>

      {offlineNotice ? (
        <Card className="labeler-return-card">
          <Badge tone="warning">离线模式</Badge>
          <p>{offlineNotice}</p>
        </Card>
      ) : null}

      <div className="kpi-grid">
        <KpiCard label="可领取任务" value={tasks.length} hint={offlineNotice ? "来自本地任务数据" : "来自任务市场"} />
        <KpiCard label="预计单题奖励" value="0.30" hint="元 / 通过 item" />
        <KpiCard label="今日草稿" value="0" hint="保存后由 workflow 更新" />
      </div>

      <div className="soft-grid">
        {tasks.map((task) => (
          <Card key={task.id} className="soft-panel info-card">
            <div className="form-stack">
              <div>
                <div className="page-actions">
                  <Badge tone="success">{task.status}</Badge>
                  <Badge tone="primary">{task.distributionStrategy.type}</Badge>
                </div>
                <h3 className="task-title">{task.title}</h3>
                <p className="page-subtitle">{task.description}</p>
              </div>
              <div className="inset-well">
                <div className="meta-line">
                  <span>配额 {task.quota.total}</span>
                  <span>每人 {task.quota.perLabeler ?? "-"}</span>
                  <span>{task.deadlineAt ? `截止 ${new Date(task.deadlineAt).toLocaleDateString()}` : "无截止时间"}</span>
                </div>
              </div>
              <Button
                tone="success"
                onClick={() => handleClaimTask(task.id)}
                disabled={claimingTaskId === task.id}
              >
                {claimingTaskId === task.id ? "领取中..." : claimedAssignmentId ? "已领取 / 继续标注" : "领取任务"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {tasks.length === 0 ? <Card className="empty-state">暂无可领取的任务</Card> : null}
    </div>
  );
}

function getLocalMarketplaceTasks(): Task[] {
  const byId = new Map<string, Task>();
  [...listLocalTasks(), ...tasksMock].forEach((task) => {
    if (task.status === "PUBLISHED") {
      byId.set(task.id, task);
    }
  });
  return Array.from(byId.values());
}
