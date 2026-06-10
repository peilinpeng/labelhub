import type { AssignmentStatus, Submission, Task } from "@labelhub/contracts";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listMarketplaceTasks, listMySubmissions } from "../../api/labeler";
import { Badge, Button, Card, KpiCard } from "../../ui/primitives";
import { formatBeijingDateTime } from "../../utils/formatTime";
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

// 兼容可能出现的审核态/草稿态字符串；未识别一律回退，不向用户暴露 raw code。
const EXTRA_STATUS_LABEL: Record<string, string> = {
  AI_REVIEWING: "AI 预审中",
  AI_PASSED: "AI 预审通过",
  NEEDS_HUMAN_REVIEW: "待人工审核",
  HUMAN_REVIEWING: "审核中",
  FINAL_REVIEWING: "终审中",
  HUMAN_REVIEW_PASSED: "已通过",
  APPROVED: "已通过",
  PASSED: "已通过",
  REJECTED: "打回待修改",
  NEEDS_REVISION: "打回待修改",
  DRAFT: "草稿中",
  IN_PROGRESS: "进行中",
};

// 提交状态说明 / AI 预审反馈：把状态翻译成一句人话，帮助标注员理解下一步，纯展示无操作。
const STATUS_NOTE: Record<string, string> = {
  SUBMITTED: "已提交，等待 AI 预审。",
  AI_REVIEWING: "AI 正在预审，请稍后查看结果。",
  AI_PASSED: "AI 预审通过，等待人工复核或入库。",
  NEEDS_HUMAN_REVIEW: "AI 预审完成，已转人工审核。",
  HUMAN_REVIEWING: "审核员正在审核这条作答。",
  FINAL_REVIEWING: "已进入终审环节。",
  RETURNED: "审核打回，请按意见修改后重新提交。",
  REJECTED: "审核打回，请按意见修改后重新提交。",
  NEEDS_REVISION: "审核打回，请按意见修改后重新提交。",
  ACCEPTED: "已通过审核，可进入导出 / 入库流程。",
  APPROVED: "已通过审核，可进入导出 / 入库流程。",
  PASSED: "已通过审核，可进入导出 / 入库流程。",
  HUMAN_REVIEW_PASSED: "已通过审核，可进入导出 / 入库流程。",
  CLAIMED: "已领取，进行中。",
  DRAFTING: "草稿编辑中，记得提交。",
  DRAFT: "草稿编辑中，记得提交。",
  IN_PROGRESS: "进行中。",
};

function statusNote(status: string): string | undefined {
  return STATUS_NOTE[status];
}

// 进入工作台的入口文案与可达性，依据状态判断标注员现在能否修改这条作答。
// editable=可编辑（打回 / 进行中）；review=审核中或已通过仅可查看；blocked=已取消/过期。
type Entry = { label: string; kind: "editable" | "review" | "blocked" };

const EDITABLE_STATUSES = new Set([
  "RETURNED",
  "REJECTED",
  "NEEDS_REVISION",
  "CLAIMED",
  "DRAFTING",
  "DRAFT",
  "IN_PROGRESS",
]);
const RETURNED_STATUSES = new Set(["RETURNED", "REJECTED", "NEEDS_REVISION"]);
const BLOCKED_STATUSES = new Set(["CANCELED", "EXPIRED"]);

function workspaceEntry(status: string): Entry {
  if (RETURNED_STATUSES.has(status)) return { label: "继续修改", kind: "editable" };
  if (EDITABLE_STATUSES.has(status)) return { label: "进入工作台", kind: "editable" };
  if (BLOCKED_STATUSES.has(status)) return { label: "暂不可修改", kind: "blocked" };
  return { label: "查看提交", kind: "review" };
}

const EXTRA_STATUS_TONE: Record<string, "default" | "primary" | "success" | "warning" | "danger"> = {
  AI_PASSED: "success",
  NEEDS_HUMAN_REVIEW: "warning",
  HUMAN_REVIEWING: "warning",
  FINAL_REVIEWING: "primary",
  HUMAN_REVIEW_PASSED: "success",
  APPROVED: "success",
  PASSED: "success",
  REJECTED: "danger",
  NEEDS_REVISION: "warning",
  DRAFT: "default",
  IN_PROGRESS: "default",
};

const EXTRA_CATEGORY: Record<string, Category> = {
  DRAFT: "inProgress",
  IN_PROGRESS: "inProgress",
  AI_PASSED: "submitted",
  NEEDS_HUMAN_REVIEW: "submitted",
  HUMAN_REVIEWING: "submitted",
  APPROVED: "accepted",
  PASSED: "accepted",
  HUMAN_REVIEW_PASSED: "accepted",
  REJECTED: "returned",
  NEEDS_REVISION: "returned",
};

function humanStatusLabel(status: string): string {
  return STATUS_LABEL[status as AssignmentStatus] ?? EXTRA_STATUS_LABEL[status] ?? "待处理";
}

function humanStatusTone(status: string): "default" | "primary" | "success" | "warning" | "danger" {
  return STATUS_TONE[status as AssignmentStatus] ?? EXTRA_STATUS_TONE[status] ?? "default";
}

function categoryOf(status: string): Category {
  return CATEGORY_OF[status as AssignmentStatus] ?? EXTRA_CATEGORY[status] ?? "other";
}

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
  const [assignments, setAssignments] = useState<Submission[]>([]);
  const [taskTitleById, setTaskTitleById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const items = await listMySubmissions();
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
      acc[categoryOf(a.status)] += 1;
    }
    return acc;
  }, [assignments]);

  const visible = useMemo(() => {
    const rows = filter === "all"
      ? assignments
      : assignments.filter((a) => categoryOf(a.status) === filter);
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

      <div className="kpi-grid labeler-submissions-kpis">
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
            const entry = workspaceEntry(a.status);
            return (
              <Card key={a.id} className="soft-panel info-card">
                <div className="form-stack">
                  <div title={`提交 ${a.id} · 题目 ${a.itemId}`}>
                    <div className="page-actions">
                      <Badge tone={humanStatusTone(a.status)}>
                        {humanStatusLabel(a.status)}
                      </Badge>
                    </div>
                    <h3 className="task-title">{taskTitleById[a.taskId] ?? "当前任务"}</h3>
                    {statusNote(a.status) ? (
                      <p className="labeler-submission-note">{statusNote(a.status)}</p>
                    ) : null}
                  </div>
                  <div className="inset-well">
                    <div className="meta-line">
                      <span>更新于 {formatBeijingDateTime(a.updatedAt)}</span>
                    </div>
                  </div>
                  <Button
                    tone={entry.kind === "editable" ? "success" : "default"}
                    disabled={entry.kind === "blocked"}
                    title={entry.kind === "blocked" ? "该作答已取消或过期，无法再修改" : undefined}
                    onClick={() => navigate(`/labeler/workspace/${a.id}`)}
                  >
                    {entry.label}
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
