import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AuditEventRecord, AuditEventType, AuditSeverity, Task } from "@labelhub/contracts";
import { Role } from "../../app/routes";
import { queryAuditEvents } from "../../api/audit";
import { listTasks } from "../../api/owner";
import { listReviewQueue } from "../../api/reviewer";
import { Badge, Card } from "../../ui/primitives";

interface OwnerQualityCenterPageProps {
  role: Role;
}

// 审计事件类型 → 人话标签。未覆盖的类型回退到中性「审计记录」，绝不暴露原始 event code。
const AUDIT_TYPE_LABELS: Partial<Record<AuditEventType, string>> = {
  REVIEW_STARTED: "审核开始",
  REVIEW_SUBMITTED: "审核决策提交",
  REVIEW_DIFF_GENERATED: "审核修订 diff 生成",
  REVIEW_PATCH_APPLIED: "审核修订已应用",
  REVIEW_DEEP_DIFF_GENERATED: "审核深度 diff 生成",
  REVIEW_RETURNED: "打回修改",
  REVIEW_ACCEPTED: "审核通过",
  REVIEW_REJECTED: "审核拒绝",
  FINAL_REVIEW_REQUESTED: "进入复审",
  AI_REVIEW_TRIGGERED: "AI 预审触发",
  AI_REVIEW_OUTPUT_GENERATED: "AI 预审输出生成",
  AI_REVIEW_GENERATED: "AI 预审结果生成",
  AI_REVIEW_CONFIRMED_BY_REVIEWER: "AI 预审被审核员采纳",
  AI_REVIEW_REJECTED_BY_REVIEWER: "AI 预审被审核员否决",
  AI_ASSIST_ACCEPTED: "AI 建议已采纳",
  AI_ASSIST_EDITED: "AI 建议编辑后采纳",
  AI_ASSIST_DISMISSED: "AI 建议已忽略",
  AI_ASSIST_PATCH_APPLIED: "AI 修订已应用",
  AI_ASSIST_PATCH_FAILED: "AI 修订应用失败",
  LABELER_RISK_SIGNAL_GENERATED: "标注风险信号",
  EXPORT_GENERATED: "数据导出生成",
  EXPORT_WARNING_RECORDED: "导出质量警告",
  DATA_QUALITY_PASSPORT_GENERATED: "数据质量护照生成",
  SCHEMA_PUBLISH_REQUESTED: "模板发布申请",
  SCHEMA_PUBLISH_BLOCKED: "模板发布被阻断",
  SCHEMA_PUBLISH_FAILED: "模板发布失败",
};

function auditTypeLabel(type: AuditEventType): string {
  return AUDIT_TYPE_LABELS[type] ?? "审计记录";
}

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

// actor role → 人话；未识别回退「系统」，不暴露原始 code。
const ACTOR_ROLE_LABELS: Record<string, string> = {
  OWNER: "任务负责人",
  REVIEWER: "审核员",
  LABELER: "标注员",
  SYSTEM: "系统",
};

function actorRoleLabel(role: string): string {
  return ACTOR_ROLE_LABELS[role] ?? "系统";
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

// 关联实体（任务 / 标注项 / 提交）——展示引用 id，不展示 raw payload。
function relatedEntities(event: AuditEventRecord): string[] {
  const target = event.target;
  const parts: string[] = [];
  if (target.taskId) parts.push(`任务 ${target.taskId}`);
  if (target.entityType === "ITEM" && target.entityId) parts.push(`标注项 ${target.entityId}`);
  if (target.submissionId) parts.push(`提交 ${target.submissionId}`);
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
}: {
  title: string;
  description?: string;
  events: AuditEventRecord[];
  emptyText: string;
  error: string | null;
  variant?: "default" | "ai" | "patch";
  secondary?: { to: string; label: string };
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
          {secondary ? (
            <Link className="quality-board__link" to={secondary.to}>
              {secondary.label} →
            </Link>
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
            const related = relatedEntities(event);
            const fieldNames = eventFieldNames(event);
            const statusLabel = AI_ASSIST_STATUS_LABELS[event.type];
            return (
              <li className="quality-board__row" key={event.id}>
                <div className="quality-board__row-head">
                  <Badge tone={severityTone(event.severity)}>{auditTypeLabel(event.type)}</Badge>
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
                  <div className="quality-board__row-related">{related.join(" · ")}</div>
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

  const resolvedTaskId = tasks[0]?.id ?? "task_news_quality";

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

  const aiEvents = useMemo(
    () => events.filter((event) => isAiSignal(event.type) && !isPatchSignal(event.type)).slice(0, 8),
    [events],
  );
  const reviewEvents = useMemo(
    () => events.filter((event) => isReviewSignal(event.type) && !isPatchSignal(event.type)).slice(0, 8),
    [events],
  );
  const patchEvents = useMemo(() => events.filter((event) => isPatchSignal(event.type)).slice(0, 8), [events]);
  const exportEvents = useMemo(() => events.filter((event) => isExportSignal(event.type)).slice(0, 8), [events]);
  const auditEvents = useMemo(() => events.slice(0, 12), [events]);

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
        <div className="quality-overview-grid">
          <OverviewStat label="任务总数" value={taskStats.total} tone="success" />
          <OverviewStat label="发布中任务" value={taskStats.published} tone="primary" />
          <OverviewStat label="草稿任务" value={taskStats.draft} />
          <OverviewStat label="待人工审核" value={reviewQueueCount ?? "—"} tone="primary" />
          <OverviewStat label="打回 / 需要修订" value={stats.returned} tone="warning" />
          <OverviewStat label="AI 建议采纳" value={stats.aiAccepted} tone="success" />
          <OverviewStat label="AI 编辑后采纳" value={stats.aiEditAccepted} tone="success" />
          <OverviewStat label="AI 建议忽略" value={stats.aiDismissed} />
          <OverviewStat label="最近审计事件" value={stats.recentAudit} />
          <OverviewStat label="最近风险信号" value={stats.risk} tone="warning" />
        </div>
      </section>

      <div className="quality-board-grid">
        <QualityEventBoard
          title="AI 预审 / AI Assist 看板"
          description="最近的 AI 预审结果与 AI Assist 建议处理（采纳 / 编辑后采纳 / 忽略）。"
          events={aiEvents}
          variant="ai"
          error={eventsError}
          emptyText="暂无 AI 质量线索。AI 预审产出或审核员处理 AI 建议后，这里会显示相关记录。"
          secondary={{ to: `/owner/tasks/${resolvedTaskId}/ai-config`, label: "配置 AI 预审规则" }}
        />

        <QualityEventBoard
          title="审核与打回看板"
          description="最近的审核开始、决策提交、通过、打回与复审记录。"
          events={reviewEvents}
          error={eventsError}
          emptyText="暂无审核与打回线索。审核员处理任务后，这里会显示通过、打回和复审记录。"
        />

        <QualityEventBoard
          title="数据修订 / Patch 看板"
          description="patch 生成 / 应用 / 失败记录，含修改字段与来源（AI / 审核员 / 系统）。"
          events={patchEvents}
          variant="patch"
          error={eventsError}
          emptyText="暂无数据修订记录。审核修订或 AI 修订应用后，这里会显示字段级 patch 线索。"
        />

        <QualityEventBoard
          title="导出与质量护照"
          description="Data Quality Passport 用于汇总模板版本、审核记录、AI 检查、人工修订与导出审计，帮助说明数据交付时的质量来源。"
          events={exportEvents}
          error={eventsError}
          emptyText="暂无导出质量记录。生成导出任务后，这里会显示导出与质量护照线索。"
          secondary={{ to: `/owner/tasks/${resolvedTaskId}/export`, label: "查看导出中心" }}
        />

        <QualityEventBoard
          title="审计与追溯"
          description="最近的标注、审核、AI 检查、导出与模板发布动作，按时间倒序。"
          events={auditEvents}
          error={eventsError}
          emptyText="暂无审计记录。系统产生标注、审核、AI 检查、导出或模板发布动作后，这里会自动记录。"
        />
      </div>
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
