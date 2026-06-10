import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AuditEventRecord, AuditEventType, AuditSeverity, Task } from "@labelhub/contracts";
import { Role } from "../../app/routes";
import { queryAuditEvents } from "../../api/audit";
import { listTasks } from "../../api/owner";
import { listReviewQueue } from "../../api/reviewer";
import { actorRoleLabel, auditEventLabel } from "../reviewer/audit-humanize";
import { Badge, Card } from "../../ui/primitives";

interface OwnerQualityCenterPageProps {
  role: Role;
}

type QualityTabId = "ai" | "review" | "patch" | "export" | "audit";

// AI Assist 建议状态人话化（看板列展示）。
const AI_ASSIST_STATUS_LABELS: Partial<Record<AuditEventType, string>> = {
  AI_ASSIST_ACCEPTED: "已采纳",
  AI_ASSIST_EDITED: "编辑后采纳",
  AI_ASSIST_DISMISSED: "已忽略",
  AI_ASSIST_PATCH_APPLIED: "已应用",
  AI_ASSIST_PATCH_FAILED: "应用失败",
};

function severityTone(severity: AuditSeverity): "default" | "warning" | "danger" {
  if (severity === "ERROR") return "danger";
  if (severity === "WARNING") return "warning";
  return "default";
}

function isAiSignal(type: AuditEventType): boolean {
  return type.startsWith("AI_REVIEW") || type.startsWith("AI_ASSIST");
}

function isPatchSignal(type: AuditEventType): boolean {
  return (
    type === "REVIEW_PATCH_APPLIED" ||
    type === "REVIEW_DIFF_GENERATED" ||
    type === "REVIEW_DEEP_DIFF_GENERATED" ||
    type === "AI_ASSIST_PATCH_APPLIED" ||
    type === "AI_ASSIST_PATCH_FAILED"
  );
}

function isReviewSignal(type: AuditEventType): boolean {
  return type.startsWith("REVIEW_") || type === "FINAL_REVIEW_REQUESTED";
}

function isExportSignal(type: AuditEventType): boolean {
  return type.startsWith("EXPORT_") || type === "DATA_QUALITY_PASSPORT_GENERATED";
}

function formatEventTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

// 从结构化 payload 中安全提取人话摘要（curated 字符串，非 raw JSON / debug）。
function eventSummary(event: AuditEventRecord): string | undefined {
  const payload = event.payload as Record<string, unknown> | undefined;
  const summary = payload?.summary;
  return typeof summary === "string" && summary.trim().length > 0 ? summary : undefined;
}

// 从结构化 payload 中提取被修改字段名（用于 Patch 看板「修改字段」列）。
function eventFieldNames(event: AuditEventRecord): string[] {
  const payload = event.payload as Record<string, unknown> | undefined;
  const candidates = [payload?.appliedPatchFieldNames, payload?.patchedFieldNames];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      const names = value.filter((item): item is string => typeof item === "string");
      if (names.length > 0) return names;
    }
  }
  return [];
}

// patch 来源人话化：依据 actor.role / 事件类型。
function patchSourceLabel(event: AuditEventRecord): string {
  if (event.type.startsWith("AI_ASSIST")) return "AI 建议";
  if (event.actor.role === "REVIEWER") return "审核员";
  if (event.actor.role === "SYSTEM") return "系统";
  return actorRoleLabel(event.actor.role);
}

// 关联实体（任务 / 标注项 / 提交）——人话化，内部 id 仅放入 tooltip，不作为主视觉文案。
interface RelatedEntity {
  label: string;
  title?: string;
}

function relatedEntities(event: AuditEventRecord, taskTitleOf: (taskId: string) => string | undefined): RelatedEntity[] {
  const target = event.target;
  const parts: RelatedEntity[] = [];
  if (target.taskId) {
    const taskId = String(target.taskId);
    const title = taskTitleOf(taskId);
    parts.push({ label: `任务：${title ?? "当前任务"}`, title: taskId });
  }
  if (target.entityType === "ITEM" && target.entityId) {
    parts.push({ label: "标注项", title: String(target.entityId) });
  }
  if (target.submissionId) {
    parts.push({ label: "提交记录", title: String(target.submissionId) });
  }
  return parts;
}

function isReturnEvent(event: AuditEventRecord): boolean {
  if (event.type === "REVIEW_RETURNED" || event.type === "REVIEW_REJECTED") return true;
  if (event.type === "REVIEW_SUBMITTED") {
    const decision = (event.payload as Record<string, unknown> | undefined)?.decision;
    return decision === "RETURN" || decision === "REJECT";
  }
  return false;
}

function countType(events: AuditEventRecord[], type: AuditEventType): number {
  return events.filter((event) => event.type === type).length;
}

// 富事件看板：人话事件名 + 角色 + 时间 + 严重度 + 摘要 + 关联实体，绝不展示原始 type/payload。
function QualityEventBoard({
  title,
  description,
  events,
  emptyText,
  error,
  variant = "default",
  secondary,
  taskTitleOf,
}: {
  title: string;
  description?: string;
  events: AuditEventRecord[];
  emptyText: string;
  error: string | null;
  variant?: "default" | "ai" | "patch";
  secondary?: { to?: string; label: string; disabledHint?: string };
  taskTitleOf: (taskId: string) => string | undefined;
}) {
  return (
    <Card className="quality-board">
      <div className="quality-board__head">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        <div className="quality-board__head-aside">
          <Badge tone={events.length > 0 ? "primary" : "default"}>最近 {events.length} 条</Badge>
          {secondary?.to ? (
            <Link className="quality-board__link" to={secondary.to}>
              {secondary.label} →
            </Link>
          ) : secondary ? (
            <span className="quality-board__link quality-board__link--disabled" title={secondary.disabledHint}>
              {secondary.label}
            </span>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="empty-state">{error}</div>
      ) : events.length === 0 ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <ul className="quality-board__rows">
          {events.map((event) => {
            const summary = eventSummary(event);
            const related = relatedEntities(event, taskTitleOf);
            const fieldNames = eventFieldNames(event);
            const statusLabel = AI_ASSIST_STATUS_LABELS[event.type];
            return (
              <li className="quality-board__row" key={event.id}>
                <div className="quality-board__row-head">
                  <Badge tone={severityTone(event.severity)}>{auditEventLabel(event.type)}</Badge>
                  {variant === "ai" && statusLabel ? (
                    <Badge tone="default">{statusLabel}</Badge>
                  ) : null}
                  {variant === "patch" ? (
                    <Badge tone="default">来源：{patchSourceLabel(event)}</Badge>
                  ) : null}
                  <span className="quality-board__row-meta">
                    {actorRoleLabel(event.actor.role)} · {formatEventTime(String(event.createdAt))}
                  </span>
                </div>
                {summary ? <p className="quality-board__row-summary">{summary}</p> : null}
                {variant === "patch" && fieldNames.length > 0 ? (
                  <div className="quality-board__row-fields">
                    修改字段：{fieldNames.map((name) => (
                      <code key={name}>{name}</code>
                    ))}
                  </div>
                ) : null}
                {related.length > 0 ? (
                  <div className="quality-board__row-related">
                    {related.map((entity, index) => (
                      <span key={`${entity.label}-${index}`} title={entity.title}>
                        {index > 0 ? " · " : ""}
                        {entity.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function OwnerQualityCenterPage({ role }: OwnerQualityCenterPageProps) {
  if (role !== "OWNER") {
    return (
      <Card className="state-panel">
        质量中心仅对任务 Owner 开放。Reviewer 可在审核工作台查看自己的审核概览，Labeler 可在标注任务内查看即时反馈。
      </Card>
    );
  }
  return <OwnerQualityCenterContent />;
}

function OwnerQualityCenterContent() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [reviewQueueCount, setReviewQueueCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<QualityTabId>("ai");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [tasksResult, eventsResult, queueResult] = await Promise.allSettled([
        listTasks(),
        queryAuditEvents({ limit: 100 }),
        listReviewQueue({ pageSize: 100 }),
      ]);
      if (cancelled) return;

      if (tasksResult.status === "fulfilled") {
        setTasks(tasksResult.value);
        setTasksError(null);
      } else {
        setTasks([]);
        setTasksError("任务接口加载失败，请稍后重试。");
      }

      if (eventsResult.status === "fulfilled") {
        setEvents(eventsResult.value.events);
        setEventsError(null);
      } else {
        setEvents([]);
        setEventsError("质量线索加载失败，请稍后重试。");
      }

      setReviewQueueCount(queueResult.status === "fulfilled" ? queueResult.value.length : null);

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedTaskId = tasks[0]?.id;

  const taskTitleOf = useMemo(() => {
    const byId = new Map<string, string>(tasks.map((task) => [String(task.id), task.title]));
    return (taskId: string) => byId.get(taskId);
  }, [tasks]);

  const taskStats = useMemo(() => {
    const published = tasks.filter((task) => task.status === "PUBLISHED").length;
    const draft = tasks.filter((task) => task.status === "DRAFT").length;
    return { total: tasks.length, published, draft };
  }, [tasks]);

  // 全部统计来自真实任务 / 审计事件 / 审核队列，按类型实时计数，不写死。
  const stats = useMemo(() => {
    return {
      recentAudit: events.length,
      risk: events.filter((event) => event.severity !== "INFO").length,
      aiAccepted: countType(events, "AI_ASSIST_ACCEPTED"),
      aiEditAccepted: countType(events, "AI_ASSIST_EDITED"),
      aiDismissed: countType(events, "AI_ASSIST_DISMISSED"),
      returned: events.filter(isReturnEvent).length,
    };
  }, [events]);

  // 各看板的完整分类（用于 tab 上的真实数量），展示时再各自截取最近记录。
  const aiEvents = useMemo(
    () => events.filter((event) => isAiSignal(event.type) && !isPatchSignal(event.type)),
    [events],
  );
  const reviewEvents = useMemo(
    () => events.filter((event) => isReviewSignal(event.type) && !isPatchSignal(event.type)),
    [events],
  );
  const patchEvents = useMemo(() => events.filter((event) => isPatchSignal(event.type)), [events]);
  const exportEvents = useMemo(() => events.filter((event) => isExportSignal(event.type)), [events]);
  const auditEvents = events;

  // 分段看板配置：一次只展示一个，tab 上的数量来自真实 events。默认 AI 预审。
  const boards = useMemo(
    () => [
      {
        id: "ai" as const,
        label: "AI 预审 / AI Assist",
        count: aiEvents.length,
        node: (
          <QualityEventBoard
            title="AI 预审 / AI Assist 看板"
            description="最近的 AI 预审结果与 AI Assist 建议处理（采纳 / 编辑后采纳 / 忽略）。"
            events={aiEvents.slice(0, 8)}
            variant="ai"
            error={eventsError}
            emptyText="暂无 AI 质量线索。AI 预审产出或审核员处理 AI 建议后，这里会显示相关记录。"
            secondary={resolvedTaskId
              ? { to: `/owner/tasks/${resolvedTaskId}/ai-precheck`, label: "配置 AI 预审规则" }
              : { label: "配置 AI 预审规则", disabledHint: "请先创建任务后再配置 AI 预审规则。" }}
            taskTitleOf={taskTitleOf}
          />
        ),
      },
      {
        id: "review" as const,
        label: "审核与打回",
        count: reviewEvents.length,
        node: (
          <QualityEventBoard
            title="审核与打回看板"
            description="最近的审核开始、决策提交、通过、打回与复审记录。"
            events={reviewEvents.slice(0, 8)}
            error={eventsError}
            emptyText="暂无审核与打回线索。审核员处理任务后，这里会显示通过、打回和复审记录。"
            taskTitleOf={taskTitleOf}
          />
        ),
      },
      {
        id: "patch" as const,
        label: "数据修订",
        count: patchEvents.length,
        node: (
          <QualityEventBoard
            title="数据修订 / Patch 看板"
            description="patch 生成 / 应用 / 失败记录，含修改字段与来源（AI / 审核员 / 系统）。"
            events={patchEvents.slice(0, 8)}
            variant="patch"
            error={eventsError}
            emptyText="暂无数据修订记录。审核修订或 AI 修订应用后，这里会显示字段级 patch 线索。"
            taskTitleOf={taskTitleOf}
          />
        ),
      },
      {
        id: "export" as const,
        label: "导出与护照",
        count: exportEvents.length,
        node: (
          <QualityEventBoard
            title="导出与质量护照"
            description="Data Quality Passport 用于汇总模板版本、审核记录、AI 检查、人工修订与导出审计，帮助说明数据交付时的质量来源。"
            events={exportEvents.slice(0, 8)}
            error={eventsError}
            emptyText="暂无导出质量记录。生成导出任务后，这里会显示导出与质量护照线索。"
            secondary={resolvedTaskId
              ? { to: `/owner/tasks/${resolvedTaskId}/export`, label: "查看导出中心" }
              : { label: "查看导出中心", disabledHint: "请先创建任务后再查看导出中心。" }}
            taskTitleOf={taskTitleOf}
          />
        ),
      },
      {
        id: "audit" as const,
        label: "审计追溯",
        count: auditEvents.length,
        node: (
          <QualityEventBoard
            title="审计与追溯"
            description="最近的标注、审核、AI 检查、导出与模板发布动作，按时间倒序。"
            events={auditEvents.slice(0, 8)}
            error={eventsError}
            emptyText="暂无审计记录。系统产生标注、审核、AI 检查、导出或模板发布动作后，这里会自动记录。"
            taskTitleOf={taskTitleOf}
          />
        ),
      },
    ],
    [aiEvents, reviewEvents, patchEvents, exportEvents, auditEvents, eventsError, resolvedTaskId, taskTitleOf],
  );

  const activeBoard = boards.find((board) => board.id === activeTab) ?? boards[0];

  if (loading) {
    return <Card className="state-panel">加载质量中心中...</Card>;
  }

  return (
    <div className="page-stack quality-center-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">质量中心</h2>
          <p className="page-subtitle">
            集中查看 AI 检查、AI Assist 采纳、人工审核、打回修订、数据修订、导出与审计记录，掌握每批数据的质量来源。
          </p>
        </div>
      </div>

      {tasksError ? (
        <Card className="owner-fallback-notice">
          <Badge tone="danger">加载失败</Badge>
          <span>{tasksError}</span>
        </Card>
      ) : null}

      <section aria-label="质量总览" className="quality-overview">
        <h3 className="quality-section-title">总览</h3>
        <div className="quality-overview-groups">
          <OverviewGroup title="核心概览">
            <OverviewStat label="任务总数" value={taskStats.total} tone="success" />
            <OverviewStat label="发布中任务" value={taskStats.published} tone="primary" />
            <OverviewStat label="草稿任务" value={taskStats.draft} />
            <OverviewStat label="待人工审核" value={reviewQueueCount ?? "—"} tone="primary" />
          </OverviewGroup>
          <OverviewGroup title="质量动作">
            <OverviewStat label="AI 建议采纳" value={stats.aiAccepted} tone="success" />
            <OverviewStat label="AI 编辑后采纳" value={stats.aiEditAccepted} tone="success" />
            <OverviewStat label="AI 建议忽略" value={stats.aiDismissed} />
            <OverviewStat label="打回 / 需要修订" value={stats.returned} tone="warning" />
          </OverviewGroup>
          <OverviewGroup title="追溯记录">
            <OverviewStat label="最近审计事件" value={stats.recentAudit} />
            <OverviewStat label="最近风险信号" value={stats.risk} tone="warning" />
          </OverviewGroup>
        </div>
      </section>

      <section aria-label="质量看板" className="quality-board-section">
        <div className="quality-tabs" role="tablist" aria-label="质量看板分类">
          {boards.map((board) => (
            <button
              key={board.id}
              type="button"
              role="tab"
              aria-selected={board.id === activeBoard.id}
              className={
                board.id === activeBoard.id
                  ? "quality-tab quality-tab--active"
                  : "quality-tab"
              }
              onClick={() => setActiveTab(board.id)}
            >
              <span className="quality-tab__label">{board.label}</span>
              <span className="quality-tab__count">{board.count}</span>
            </button>
          ))}
        </div>
        <p className="quality-board-section__hint">每个看板仅展示最近记录，便于快速浏览质量来源。</p>
        {activeBoard.node}
      </section>
    </div>
  );
}

function OverviewGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="quality-overview-group">
      <span className="quality-overview-group__title">{title}</span>
      <div className="quality-overview-group__grid">{children}</div>
    </div>
  );
}

function OverviewStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "primary" | "success" | "warning";
}) {
  return (
    <div className={`quality-overview-stat quality-overview-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
