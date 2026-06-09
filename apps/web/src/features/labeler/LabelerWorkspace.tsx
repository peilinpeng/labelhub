import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Role } from "../../app/routes";
import { claimTask, listMarketplaceTasks } from "../../api/labeler";
import { Badge, Button, Card, KpiCard } from "../../ui/primitives";
import type { ClaimTaskResponse, Task } from "@labelhub/contracts";

interface LabelerWorkspaceProps {
  role: Role;
}

export default function LabelerWorkspace({ role }: LabelerWorkspaceProps) {
  void role;
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await listMarketplaceTasks();
        setTasks(data.filter((task) => !isPlaceholderTask(task)));
        setOfflineNotice(null);
      } catch {
        setTasks([]);
        setOfflineNotice("任务市场加载失败，请稍后重试。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleClaimTask = async (taskId: string) => {
    try {
      setClaimingTaskId(taskId);
      const response: ClaimTaskResponse = await claimTask(taskId, {});
      navigate(`/labeler/workspace/${response.context.assignment.id}`);
    } catch (error) {
      setOfflineNotice(error instanceof Error ? error.message : "领取任务失败，请稍后重试。");
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
          <p className="page-subtitle">领取任务后进入标注工作台，填写答案并提交审核。</p>
        </div>
      </div>

      {offlineNotice ? (
        <Card className="labeler-return-card">
          <Badge tone="danger">加载失败</Badge>
          <p>{offlineNotice}</p>
        </Card>
      ) : null}

      <div className="kpi-grid">
        <KpiCard label="可领取任务" value={tasks.length} hint="领取后进入标注工作台" />
      </div>

      <div className="soft-grid">
        {tasks.map((task) => (
          <Card key={task.id} className="soft-panel info-card">
            <div className="form-stack">
              <div>
                <div className="page-actions">
                  <Badge tone="success">{taskStatusLabel(task.status)}</Badge>
                  <Badge tone="primary">{distributionLabel(task.distributionStrategy.type)}</Badge>
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
                {claimingTaskId === task.id ? "领取中..." : "领取任务"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {tasks.length === 0 ? <Card className="empty-state">暂无可领取的任务</Card> : null}
    </div>
  );
}

// 任务状态人话化；市场只展示已发布任务，未知状态回退「可领取」，不暴露 raw code。
function taskStatusLabel(status: Task["status"]): string {
  if (status === "PUBLISHED") return "已发布";
  if (status === "PAUSED") return "已暂停";
  if (status === "DRAFT") return "草稿";
  if (status === "ENDED") return "已结束";
  if (status === "ARCHIVED") return "已归档";
  return "可领取";
}

function distributionLabel(type: Task["distributionStrategy"]["type"]): string {
  if (type === "FIRST_COME_FIRST_SERVED") return "先到先得";
  if (type === "ASSIGNMENT") return "指派";
  return "配额抢单";
}

function isPlaceholderTask(task: Task): boolean {
  const text = `${task.id} ${task.title} ${task.description ?? ""}`;
  return /task_news_quality|task_product_title|新闻质量标注|商品标题清洗|商品标题清洗 v3|\bDemo\s*[A-Z]\b|Breaking Change|Deprecated|安全发布|破坏性模板调整|发布前检查会阻断|字段进入废弃流程/i.test(text);
}
