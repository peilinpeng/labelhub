import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Role } from "../../app/routes";
import { claimTask, listMarketplaceTasks } from "../../api/labeler";
import { Badge, Button, Card, KpiCard } from "../../ui/primitives";
import type { ClaimTaskResponse, Task } from "@labelhub/contracts";
import { claimDemoAssignment, DEMO_ASSIGNMENT_ID, getDemoWorkflowState } from "../../mocks/demo-workflow-store";

interface LabelerWorkspaceProps {
  role: Role;
}

export default function LabelerWorkspace({ role }: LabelerWorkspaceProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        setError(null);
      } catch (e) {
        setError((e as Error).message);
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

  if (error) {
    return <Card className="state-panel danger-text">错误: {error}</Card>;
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">任务市场</h2>
          <p className="page-subtitle">当前角色：{role}。领取后进入标注工作台，SchemaRenderer 负责渲染与校验。</p>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard label="可领取任务" value={tasks.length} hint="来自 marketplace mock API" />
        <KpiCard label="预计单题奖励" value="0.30" hint="元 / accepted item" />
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
