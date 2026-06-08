import type { Assignment, AssignmentStatus, Task } from "@labelhub/contracts";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listMarketplaceTasks, listMyAssignments } from "../../api/labeler";
import { Badge, Button, Card, KpiCard } from "../../ui/primitives";
import type { Role } from "../../app/routes";

interface LabelerSubmissionsPageProps {
  role: Role;
}

// 作答状态 → 展示分类（对齐 4.3「已提交/通过/打回/待修改」）
type Category = "submitted" | "accepted" | "returned" | "inProgress" | "other";

const CATEGORY_OF: Record<AssignmentStatus, Category> = {
  SUBMITTED: "submitted",
  ACCEPTED: "accepted",
  RETURNED: "returned",
  CLAIMED: "inProgress",
  DRAFTING: "inProgress",
  CANCELED: "other",
  EXPIRED: "other",
};

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  SUBMITTED: "已提交 · 审核中",
  ACCEPTED: "已通过",
  RETURNED: "已打回 · 待修改",
  CLAIMED: "进行中",
  DRAFTING: "草稿中",
  CANCELED: "已取消",
  EXPIRED: "已过期",
};

const STATUS_TONE: Record<AssignmentStatus, "default" | "primary" | "success" | "warning" | "danger"> = {
  SUBMITTED: "primary",
  ACCEPTED: "success",
  RETURNED: "warning",
  CLAIMED: "default",
  DRAFTING: "default",
  CANCELED: "danger",
  EXPIRED: "danger",
};

type FilterKey = "all" | Category;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "submitted", label: "已提交" },
  { key: "accepted", label: "已通过" },
  { key: "returned", label: "打回/待修改" },
  { key: "inProgress", label: "进行中" },
];

export default function LabelerSubmissionsPage({ role }: LabelerSubmissionsPageProps) {
  void role;
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [taskTitleById, setTaskTitleById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const items = await listMyAssignments();
        setAssignments(items);
        // 尽力补全任务标题（市场任务里能查到就用，查不到回退 taskId）
        try {
          const tasks: Task[] = await listMarketplaceTasks();
          setTaskTitleById(Object.fromEntries(tasks.map((t) => [t.id, t.title])));
        } catch {
          /* 标题补全失败不影响列表 */
        }
      } catch (e) {
        console.error("Failed to load my submissions:", e);
        setError("加载作答记录失败，请稍后重试。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const acc = { submitted: 0, accepted: 0, returned: 0, inProgress: 0, other: 0 };
    for (const a of assignments) {
      acc[CATEGORY_OF[a.status as AssignmentStatus] ?? "other"] += 1;
    }
    return acc;
  }, [assignments]);

  const visible = useMemo(() => {
    const rows = filter === "all"
      ? assignments
      : assignments.filter((a) => CATEGORY_OF[a.status as AssignmentStatus] === filter);
    return [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [assignments, filter]);

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">我的提交</h2>
          <p className="page-subtitle">
            这里汇总你的全部作答记录与状态，打回的题目可直接进入工作台修改。
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard label="已提交 · 审核中" value={stats.submitted} hint="等待 AI/人工审核" />
        <KpiCard label="已通过" value={stats.accepted} hint="已入库 / 可导出" />
        <KpiCard label="打回 · 待修改" value={stats.returned} hint="需查看意见后修改" />
        <KpiCard label="进行中" value={stats.inProgress} hint="已领取 / 草稿中" />
      </div>

      <div className="page-actions">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            tone={filter === f.key ? "primary" : "ghost"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <Card className="empty-state">加载中...</Card>
      ) : error ? (
        <Card className="empty-state">{error}</Card>
      ) : visible.length === 0 ? (
        <Card className="empty-state">
          {filter === "all" ? "还没有作答记录。去任务市场领取任务开始标注吧。" : "该分类下暂无记录。"}
        </Card>
      ) : (
        <div className="soft-grid">
          {visible.map((a) => {
            const status = a.status as AssignmentStatus;
            return (
              <Card key={a.id} className="soft-panel info-card">
                <div className="form-stack">
                  <div>
                    <div className="page-actions">
                      <Badge tone={STATUS_TONE[status] ?? "default"}>
                        {STATUS_LABEL[status] ?? status}
                      </Badge>
                    </div>
                    <h3 className="task-title">{taskTitleById[a.taskId] ?? a.taskId}</h3>
                    <p className="page-subtitle">题目：{a.itemId}</p>
                  </div>
                  <div className="inset-well">
                    <div className="meta-line">
                      <span>更新于 {new Date(a.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                    </div>
                  </div>
                  <Button
                    tone={status === "RETURNED" ? "success" : "default"}
                    onClick={() => navigate(`/labeler/workspace/${a.id}`)}
                  >
                    {status === "RETURNED" ? "查看意见并修改" : "进入工作台"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
