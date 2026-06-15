import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { RoutePath, Role } from "../../app/routes";
import { fetchTask, fetchTaskStats, updateTask, type TaskStats } from "../../api/owner";
import { getReviewConfig } from "../../api/reviewer";
import { Badge, Button, Card, Input, Select, Textarea } from "../../ui/primitives";
import { MarkdownPreview, docToMarkdown, markdownToDoc } from "../../ui/markdown";
import type { ID, Task } from "@labelhub/contracts";
import { buildTaskSetupSteps, PublishReadinessPanel, TaskSetupStepper, type ReadinessItem } from "./TaskSetupGuide";

interface OwnerTaskDetailPageProps {
  role: Role;
}

type DistributionType = Task["distributionStrategy"]["type"];

interface TaskEditForm {
  title: string;
  description: string;
  instruction: string;
  quotaTotal: number;
  perLabeler: string;
  deadlineLocal: string;
  distributionType: DistributionType;
  assigneeIds: string;
  claimBatchSize: number;
  tags: string;
}

function statusTone(status: Task["status"]): "success" | "warning" | "default" {
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

function isEndedOrArchivedStatus(status: Task["status"]): boolean {
  return status === "ENDED" || status === "ARCHIVED";
}

function strategyLabel(strategy: Task["distributionStrategy"]): string {
  if (strategy.type === "FIRST_COME_FIRST_SERVED") return "先到先得";
  if (strategy.type === "ASSIGNMENT") return "指派";
  return "配额抢单";
}

function taskDescription(task: Task): string {
  const description = task.description?.trim();
  if (!description || description.startsWith("task_") || description.includes("Owner:")) {
    return "用于组织标注数据、模板配置、任务分发与结果交付。";
  }
  return description;
}

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "无截止时间";
}

function toDateTimeLocalValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function getDeadlineView(value?: string | null): { label: string; tone: "default" | "warning" | "danger"; hint: string } {
  if (!value) return { label: "无截止时间", tone: "default", hint: "未设置领取截止时间" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "无截止时间", tone: "default", hint: "截止时间格式异常" };
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return { label: "已截止", tone: "danger", hint: `截止 ${date.toLocaleString()}` };
  const days = Math.ceil(diffMs / 86_400_000);
  return { label: `截止 ${date.toLocaleString()}`, tone: days <= 1 ? "warning" : "default", hint: `剩余 ${days} 天` };
}

function buildEditForm(task: Task): TaskEditForm {
  const distribution = task.distributionStrategy;
  return {
    title: task.title,
    description: task.description ?? "",
    instruction: docToMarkdown(task.instructionRichText),
    quotaTotal: task.quota.total,
    perLabeler: task.quota.perLabeler ? String(task.quota.perLabeler) : "",
    deadlineLocal: toDateTimeLocalValue(task.deadlineAt),
    distributionType: distribution.type,
    assigneeIds: distribution.type === "ASSIGNMENT" ? distribution.assigneeIds.join(", ") : "",
    claimBatchSize: distribution.type === "QUOTA_CLAIM" ? distribution.claimBatchSize : 10,
    tags: task.tags?.join(", ") ?? "",
  };
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default function OwnerTaskDetailPage({ role: _role }: OwnerTaskDetailPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const [task, setTask] = useState<Task | null>(null);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [editingBasics, setEditingBasics] = useState(false);
  const [editForm, setEditForm] = useState<TaskEditForm | null>(null);
  const [savingBasics, setSavingBasics] = useState(false);
  const [editNotice, setEditNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [autoEditHandled, setAutoEditHandled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!taskId) return;
      try {
        setLoading(true);
        setError(null);
        setTask(await fetchTask(taskId));
      } catch (cause) {
        setTask(null);
        setError(cause instanceof Error ? cause.message : "任务详情接口暂不可用。");
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    // 统计是看板增强项，失败不影响任务详情主体渲染。
    void fetchTaskStats(taskId).then(setStats).catch(() => setStats(null));
    void getReviewConfig(taskId)
      .then((config) => {
        setAiConfigured(true);
        setAiEnabled(config.enabled);
      })
      .catch(() => {
        setAiConfigured(false);
        setAiEnabled(null);
      });
  }, [taskId]);

  useEffect(() => {
    setAutoEditHandled(false);
  }, [taskId]);

  useEffect(() => {
    if (!task || task.status !== "DRAFT" || searchParams.get("edit") !== "basic" || editingBasics || autoEditHandled) return;
    setEditForm(buildEditForm(task));
    setEditingBasics(true);
    setAutoEditHandled(true);
  }, [autoEditHandled, editingBasics, searchParams, task]);

  const startEditingBasics = () => {
    if (!task || task.status !== "DRAFT") return;
    setEditNotice(null);
    setEditForm(buildEditForm(task));
    setEditingBasics(true);
  };

  const cancelEditingBasics = () => {
    setEditNotice(null);
    setEditForm(task ? buildEditForm(task) : null);
    setEditingBasics(false);
  };

  const saveTaskBasics = async () => {
    if (!task || !taskId || !editForm || savingBasics) return;
    const title = editForm.title.trim();
    const description = editForm.description.trim();
    const instruction = editForm.instruction.trim();
    const perLabeler = editForm.perLabeler.trim() ? Number(editForm.perLabeler) : undefined;
    const assigneeIds = editForm.assigneeIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (!title) {
      setEditNotice({ tone: "danger", text: "请输入任务名称。" });
      return;
    }
    if (editForm.quotaTotal < 1) {
      setEditNotice({ tone: "danger", text: "总配额不能小于 1。" });
      return;
    }
    if (perLabeler !== undefined && (!Number.isFinite(perLabeler) || perLabeler < 1)) {
      setEditNotice({ tone: "danger", text: "每人上限需要为大于 0 的整数，或留空。" });
      return;
    }
    if (editForm.distributionType === "ASSIGNMENT" && assigneeIds.length === 0) {
      setEditNotice({ tone: "danger", text: "指派模式下请至少填写一个用户 ID。" });
      return;
    }

    const distributionStrategy: Task["distributionStrategy"] =
      editForm.distributionType === "FIRST_COME_FIRST_SERVED"
        ? { type: "FIRST_COME_FIRST_SERVED" }
        : editForm.distributionType === "ASSIGNMENT"
          ? { type: "ASSIGNMENT", assigneeIds: assigneeIds as ID[] }
          : { type: "QUOTA_CLAIM", claimBatchSize: Math.max(1, Math.floor(editForm.claimBatchSize || 1)) };

    try {
      setSavingBasics(true);
      setEditNotice(null);
      const updatedTask = await updateTask(taskId, {
        title,
        description,
        instructionRichText: markdownToDoc(instruction),
        tags: parseTags(editForm.tags),
        quota: {
          total: Math.max(1, Math.floor(editForm.quotaTotal)),
          ...(perLabeler !== undefined ? { perLabeler: Math.floor(perLabeler) } : {}),
        },
        deadlineAt: editForm.deadlineLocal ? new Date(editForm.deadlineLocal).toISOString() : null,
        distributionStrategy,
      });
      setTask(updatedTask);
      setEditForm(buildEditForm(updatedTask));
      setEditingBasics(false);
      setEditNotice({ tone: "success", text: "基础信息已保存，数据和模板草稿不受影响。" });
      void fetchTaskStats(taskId).then(setStats).catch(() => setStats(null));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "后端暂时无法保存任务基础信息。";
      setEditNotice({
        tone: "danger",
        text: `保存失败：${message || "仅草稿任务允许修改基础信息。"}`,
      });
    } finally {
      setSavingBasics(false);
    }
  };

  if (loading) {
    return <Card className="state-panel">加载任务详情中...</Card>;
  }

  if (!task) {
    return <Card className="state-panel danger-text">任务详情加载失败：{error ?? taskId}</Card>;
  }

  const activeVersionLabel = task.activeSchemaVersionId ?? "尚未绑定版本";
  const deadlineView = getDeadlineView(task.deadlineAt);
  const hasData = (stats?.datasetTotal ?? 0) > 0;
  const hasAvailableData = (stats?.datasetAvailable ?? 0) > 0;
  const templateReady = Boolean(task.activeSchemaVersionId);
  const distributionReady = isDistributionReady(task);
  const readOnlyTask = isEndedOrArchivedStatus(task.status);
  const setupSteps = buildTaskSetupSteps({
    taskId: task.id,
    currentStep: "basic",
    hasData,
    templateReady,
    aiReady: aiConfigured,
    distributionReady,
    dataMeta: stats ? `已导入 ${stats.datasetTotal} 条，可领取 ${stats.datasetAvailable} 条` : "数据状态待检查",
    templateMeta: templateReady ? "已发布模板" : "待配置模板",
    aiMeta: aiConfigured ? (aiEnabled ? "AI 预审已启用" : "已明确不启用 AI 预审") : "待配置规则",
  });
  const readonlySetupSteps = setupSteps.map(({ href: _href, actionLabel: _actionLabel, ...step }) => step);
  const readinessItems: ReadinessItem[] = [
    {
      key: "basic",
      label: "基础信息",
      state: task.title.trim() && task.quota.total > 0 ? "done" : "error",
      detail: task.title.trim() && task.quota.total > 0 ? "任务名称、配额和基础设置已填写。" : "基础信息不完整。",
    },
    {
      key: "data",
      label: "数据管理",
      state: hasData && hasAvailableData ? "done" : "error",
      detail: stats
        ? hasData
          ? hasAvailableData
            ? `已导入 ${stats.datasetTotal} 条，其中 ${stats.datasetAvailable} 条可领取。`
            : `已导入 ${stats.datasetTotal} 条，但暂无可领取数据。`
          : "发布前需要先导入标注数据。"
        : "数据状态待检查。",
      ...(!readOnlyTask ? { href: `/owner/tasks/${task.id}/data`, actionLabel: "去导入数据" } : {}),
    },
    {
      key: "template",
      label: "模板配置",
      state: templateReady ? "done" : "error",
      detail: templateReady ? "已绑定发布模板。" : "发布前需要完成标注模板配置。",
      ...(!readOnlyTask ? { href: `/owner/tasks/${task.id}/designer`, actionLabel: "去配置模板" } : {}),
    },
    {
      key: "ai",
      label: "AI 预审",
      state: aiConfigured ? "done" : "error",
      detail: aiConfigured ? (aiEnabled ? "AI 预审已启用。" : "已明确选择不启用 AI 预审。") : "发布前需要配置 AI 预审规则。",
      ...(!readOnlyTask ? { href: `/owner/tasks/${task.id}/ai-precheck`, actionLabel: "去配置 AI 预审" } : {}),
    },
    {
      key: "distribution",
      label: "分发设置",
      state: distributionReady ? "done" : "error",
      detail: distributionReady ? "分发策略和配额已满足发布要求。" : "分发策略或配额设置不完整。",
    },
  ];

  return (
    <div className="page-stack owner-task-board-page">
      <div className="page-header owner-task-detail-header">
        <div>
          <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
          <h2 className="page-title">{task.title}</h2>
          <p className="page-subtitle">{taskDescription(task)}</p>
          <div className="meta-line">
            <span>创建 {formatDate(task.createdAt)}</span>
            <span>{deadlineView.label}</span>
            {task.deadlineAt ? <span>{deadlineView.hint}</span> : null}
            <span>{strategyLabel(task.distributionStrategy)}</span>
            <span>当前模板 {activeVersionLabel}</span>
          </div>
        </div>
        <div className="page-actions">
          {task.status === "DRAFT" ? (
            <Button type="button" onClick={startEditingBasics} disabled={editingBasics}>
              编辑基础信息
            </Button>
          ) : null}
          <Link to={RoutePath.OWNER_TASKS} className="lh-button">
            返回任务
          </Link>
          {!readOnlyTask ? (
            <>
              <Link to={`/owner/tasks/${task.id}/data`} className="lh-button">
                数据管理
              </Link>
              <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button lh-button--primary">
                配置模板
              </Link>
              <Link to={`/owner/tasks/${task.id}/ai-precheck`} className="lh-button">
                AI 预审配置
              </Link>
            </>
          ) : null}
          <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
            导出数据
          </Link>
        </div>
      </div>

      {editNotice ? (
        <Card className="owner-task-edit-notice">
          <Badge tone={editNotice.tone}>{editNotice.tone === "success" ? "已保存" : "保存失败"}</Badge>
          <p>{editNotice.text}</p>
        </Card>
      ) : null}

      <TaskSetupStepper steps={readOnlyTask ? readonlySetupSteps : setupSteps} />
      <PublishReadinessPanel items={readinessItems} />

      <section className="owner-task-board-grid" aria-label="任务看板">
        <Card className="owner-board-card owner-board-card--primary">
          <span>提交进度</span>
          <strong>{stats ? `${stats.submittedTotal}/${stats.datasetTotal}` : "-"}</strong>
          <p>{stats ? `已提交 ${stats.submittedTotal} / 共 ${stats.datasetTotal} 题` : "等待后端返回真实提交统计"}</p>
          <div className="soft-progress soft-progress--wide">
            <span className="soft-progress__bar" style={{ width: `${stats?.progressPercent ?? 0}%` }} />
          </div>
        </Card>
        <Card className="owner-board-card">
          <span>可导出结果</span>
          <strong>{stats ? stats.accepted : "-"}</strong>
          <p>审核通过后进入导出池</p>
        </Card>
        <Card className="owner-board-card">
          <span>剩余配额</span>
          <strong>{stats?.quotaRemaining ?? "-"}</strong>
          <p>按 {strategyLabel(task.distributionStrategy)} 分发</p>
        </Card>
        <Card className="owner-board-card">
          <span>人均上限</span>
          <strong>{task.quota.perLabeler ?? "-"}</strong>
          <p>{task.rewardRule ? `${task.rewardRule.amount} ${task.rewardRule.currency ?? "CNY"} / 条` : "未配置奖励"}</p>
        </Card>
      </section>

      <div className="owner-task-management-grid">
        <Card className="soft-panel owner-task-detail-main">
          <div className="owner-section-heading">
            <div>
              <h3>详细任务看板</h3>
              <p>{editingBasics ? "草稿任务可修改基础信息，保存后数据和模板草稿会保留。" : "面向任务所有者的概览，不跳转到标注员工作台。"}</p>
            </div>
            <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
          </div>
          {editingBasics && editForm ? (
            <div className="owner-task-edit-form">
              <label className="field-label">
                任务名称 *
                <Input
                  value={editForm.title}
                  onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                  placeholder="请输入任务名称"
                />
              </label>
              <label className="field-label">
                任务说明
                <Textarea
                  value={editForm.description}
                  onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
                  placeholder="一句话简介，显示在任务列表"
                />
              </label>
              <label className="field-label">
                标注员说明（支持 Markdown）
                <Textarea
                  value={editForm.instruction}
                  onChange={(event) => setEditForm({ ...editForm, instruction: event.target.value })}
                  placeholder="例如：评级标准、样例、注意事项"
                />
                <small className="field-hint">这段说明会展示给标注员，用于解释标注标准、样例和注意事项。</small>
              </label>
              <div className="owner-task-edit-grid">
                <label className="field-label">
                  总配额 *
                  <Input
                    type="number"
                    min={1}
                    value={editForm.quotaTotal}
                    onChange={(event) => setEditForm({ ...editForm, quotaTotal: Number(event.target.value) })}
                    placeholder="100"
                  />
                </label>
                <label className="field-label">
                  每人上限
                  <Input
                    type="number"
                    min={1}
                    value={editForm.perLabeler}
                    onChange={(event) => setEditForm({ ...editForm, perLabeler: event.target.value })}
                    placeholder="留空则不限制"
                  />
                </label>
                <label className="field-label">
                  截止时间
                  <Input
                    type="datetime-local"
                    value={editForm.deadlineLocal}
                    onChange={(event) => setEditForm({ ...editForm, deadlineLocal: event.target.value })}
                  />
                  <small className="field-hint">可选。清空后任务将显示为无截止时间。</small>
                </label>
                <label className="field-label">
                  分发策略 *
                  <Select
                    value={editForm.distributionType}
                    onChange={(event) => setEditForm({ ...editForm, distributionType: event.target.value as DistributionType })}
                  >
                    <option value="FIRST_COME_FIRST_SERVED">先到先得</option>
                    <option value="ASSIGNMENT">指派</option>
                    <option value="QUOTA_CLAIM">配额抢单</option>
                  </Select>
                </label>
                {editForm.distributionType === "QUOTA_CLAIM" ? (
                  <label className="field-label">
                    每次领取数量
                    <Input
                      type="number"
                      min={1}
                      value={editForm.claimBatchSize}
                      onChange={(event) => setEditForm({ ...editForm, claimBatchSize: Number(event.target.value) })}
                      placeholder="10"
                    />
                  </label>
                ) : null}
              </div>
              {editForm.distributionType === "ASSIGNMENT" ? (
                <label className="field-label">
                  指派用户 ID *
                  <Input
                    value={editForm.assigneeIds}
                    onChange={(event) => setEditForm({ ...editForm, assigneeIds: event.target.value })}
                    placeholder="逗号分隔，如 usr_xxx, usr_yyy"
                  />
                </label>
              ) : null}
              <label className="field-label">
                标签
                <Input
                  value={editForm.tags}
                  onChange={(event) => setEditForm({ ...editForm, tags: event.target.value })}
                  placeholder="逗号分隔，如 安全合规, 演示任务"
                />
              </label>
              <div className="owner-task-edit-actions">
                <Button type="button" onClick={cancelEditingBasics} disabled={savingBasics}>
                  取消
                </Button>
                <Button type="button" tone="primary" onClick={() => void saveTaskBasics()} disabled={savingBasics}>
                  {savingBasics ? "保存中..." : "保存基础信息"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="owner-detail-form">
              <label>
                <span>任务名称</span>
                <div className="owner-readonly-field">{task.title}</div>
              </label>
              <label>
                <span>任务说明</span>
                <div className="owner-readonly-field owner-readonly-field--multiline">{taskDescription(task)}</div>
              </label>
              <label>
                <span>标注说明（标注员作答时可见）</span>
                {docToMarkdown(task.instructionRichText).trim() ? (
                  <div className="owner-readonly-field owner-readonly-field--multiline">
                    <MarkdownPreview source={docToMarkdown(task.instructionRichText)} />
                  </div>
                ) : (
                  <div className="owner-readonly-field owner-readonly-field--multiline owner-readonly-field--muted">
                    未填写标注说明
                  </div>
                )}
              </label>
              <div className="owner-detail-form-grid">
                <label>
                  <span>任务状态</span>
                  <div className="owner-readonly-field">{statusLabel(task.status)}</div>
                </label>
                <label>
                  <span>分发策略</span>
                  <div className="owner-readonly-field">{strategyLabel(task.distributionStrategy)}</div>
                </label>
                <label>
                  <span>总配额</span>
                  <div className="owner-readonly-field">{task.quota.total.toLocaleString()}</div>
                </label>
                <label>
                  <span>每人上限</span>
                  <div className="owner-readonly-field">{task.quota.perLabeler ?? "-"}</div>
                </label>
                <label>
                  <span>截止时间</span>
                  <div className="owner-readonly-field">{deadlineView.label}{task.deadlineAt ? ` · ${deadlineView.hint}` : ""}</div>
                </label>
              </div>
              <label>
                <span>标签</span>
                <div className="owner-tag-row">
                  {task.tags?.length ? task.tags.map((tag) => (
                    <Badge tone="primary" key={tag}>{tag}</Badge>
                  )) : <span className="page-subtitle">未设置标签</span>}
                </div>
              </label>
            </div>
          )}
        </Card>

        <aside className="owner-task-side-stack">
          <Card className="soft-panel owner-management-card">
            <div className="owner-section-heading">
              <div>
                <h3>标注任务管理</h3>
                <p>跟踪领取、提交、打回与通过情况。</p>
              </div>
            </div>
            <div className="owner-status-list">
              <div><span>进行中</span><strong>{stats?.inProgress ?? "-"}</strong></div>
              <div><span>已提交</span><strong>{stats?.inReview ?? "-"}</strong></div>
              <div><span>已通过</span><strong>{stats?.accepted ?? "-"}</strong></div>
              <div><span>已打回</span><strong>{stats?.returned ?? "-"}</strong></div>
            </div>
            <div className="owner-task-actions-grid">
              {!readOnlyTask ? (
                <>
                  <Link to={`/owner/tasks/${task.id}/data`} className="lh-button">
                    数据管理
                  </Link>
                  <Link to={`/owner/tasks/${task.id}/ai-precheck`} className="lh-button">
                    AI 预审配置
                  </Link>
                </>
              ) : null}
              <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
                查看交付
              </Link>
            </div>
          </Card>

          <Card className="soft-panel owner-labeler-progress-card">
            <div className="owner-section-heading">
              <div>
                <h3>标注员进展</h3>
                <p>按人员查看完成量、通过量、打回量和当前题目。</p>
              </div>
            </div>
            <div className="owner-labeler-progress-list">
              <div className="empty-state">暂无真实标注员进展数据</div>
            </div>
          </Card>

          <Card className="soft-panel owner-version-card">
            <div className="owner-section-heading">
              <div>
                <h3>发布后版本管理</h3>
                <p>发布版本、当前绑定版本和后续升级入口。</p>
              </div>
              <Badge tone="primary">{activeVersionLabel}</Badge>
            </div>
            <div className="owner-version-timeline">
              <div className="owner-version-item owner-version-item--active">
                <strong>当前生产版本</strong>
                <span>{activeVersionLabel}</span>
                <p>标注员领取任务时使用此版本渲染表单。</p>
              </div>
              <div className="owner-version-item">
                <strong>草稿版本</strong>
                <span>{task.status === "PUBLISHED" ? "可继续编辑并发布新版本" : "发布后生成 v1"}</span>
                <p>保存并发布会触发 Schema 版本治理预检。</p>
              </div>
              <div className="owner-version-item">
                <strong>兼容性与迁移</strong>
                <span>发布前检查</span>
                <p>字段变更、弃用和人工映射由发布预检统一处理。</p>
              </div>
            </div>
            <div className="owner-detail-actions">
              {!readOnlyTask ? (
                <Link to={`/owner/tasks/${task.id}/designer`} className="lh-button lh-button--primary">
                  管理模板版本
                </Link>
              ) : null}
              <Link to={`/owner/tasks/${task.id}/export`} className="lh-button">
                导出数据
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function isDistributionReady(task: Task): boolean {
  if (!task.title.trim() || task.quota.total < 1) return false;
  if (task.distributionStrategy.type === "ASSIGNMENT") {
    return task.distributionStrategy.assigneeIds.length > 0;
  }
  if (task.distributionStrategy.type === "QUOTA_CLAIM") {
    return task.distributionStrategy.claimBatchSize > 0;
  }
  return true;
}
