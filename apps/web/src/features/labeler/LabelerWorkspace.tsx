import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Role } from "../../app/routes";
import { claimTask, listMarketplaceTasks, listMyAssignments } from "../../api/labeler";
import { ApiRequestError } from "../../api/client";
import { Badge, Button, Card, KpiCard } from "../../ui/primitives";
import type { ClaimTaskResponse, Task } from "@labelhub/contracts";

// 该 assignment 仍可继续作答（未提交完成），用于"已领取"时跳回原作答记录。
const ACTIVE_ASSIGNMENT_STATUSES = new Set(["CLAIMED", "DRAFTING", "RETURNED"]);

interface LabelerWorkspaceProps {
  role: Role;
}

export default function LabelerWorkspace({ role }: LabelerWorkspaceProps) {
  void role;
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  // 领取提示：区分"真错误"(danger) 与"已领取/友好引导"(info)，避免把正常业务规则当红错。
  const [claimNotice, setClaimNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
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
      setClaimNotice(null);
      const response: ClaimTaskResponse = await claimTask(taskId, {});
      navigate(`/labeler/workspace/${response.context.assignment.id}`);
    } catch (error) {
      // 422「您已领取该任务」是正常业务规则，不是错误：直接把用户带回已有作答记录。
      const alreadyClaimed =
        error instanceof ApiRequestError && error.status === 422 && error.message.includes("已领取");
      if (alreadyClaimed) {
        const existing = await findActiveAssignment(taskId);
        if (existing) {
          navigate(`/labeler/workspace/${existing}`);
          return;
        }
        setClaimNotice({ tone: "info", text: "你已领取该任务，请先完成当前作答后再领取下一条。" });
        return;
      }
      setClaimNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "领取任务失败，请稍后重试。",
      });
    } finally {
      setClaimingTaskId(null);
    }
  };

  // 查找当前用户在该任务下仍可继续作答的 assignment（用于"已领取"时跳回）。
  const findActiveAssignment = async (taskId: string): Promise<string | null> => {
    try {
      const mine = await listMyAssignments();
      const active = mine.find(
        (a) => a.taskId === taskId && ACTIVE_ASSIGNMENT_STATUSES.has(a.status),
      );
      return active?.id ?? null;
    } catch {
      return null;
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

      {claimNotice ? (
        <Card className="labeler-return-card">
          <Badge tone={claimNotice.tone === "danger" ? "danger" : "primary"}>
            {claimNotice.tone === "danger" ? "领取失败" : "提示"}
          </Badge>
          <p>{claimNotice.text}</p>
        </Card>
      ) : null}

      <div className="kpi-grid">
        <KpiCard label="可领取任务" value={tasks.length} hint="领取后进入标注工作台" />
      </div>

      <div className="soft-grid">
        {tasks.map((task) => {
          const deadlineView = getDeadlineView(task.deadlineAt);
          return (
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
                    <span>{deadlineView.label}</span>
                    {deadlineView.hint ? <span>{deadlineView.hint}</span> : null}
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
          );
        })}
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

function getDeadlineView(value?: string | null): { label: string; hint?: string } {
  if (!value) return { label: "无截止时间" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "无截止时间" };
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return { label: "已截止", hint: `截止 ${date.toLocaleString()}` };
  return { label: `截止 ${date.toLocaleDateString()}`, hint: `剩余 ${Math.ceil(diffMs / 86_400_000)} 天` };
}

function isPlaceholderTask(task: Task): boolean {
  const text = `${task.id} ${task.title} ${task.description ?? ""}`;
  // 仅隐藏自动化测试 / 压测产生的脏任务；真实任务与演示任务（含举办方数据集）正常展示。
  return /E2E测试|端到端测试|并发测试|压力测试|压测|烟雾测试|冒烟测试|smoke[\s_-]*test/i.test(text);
}
