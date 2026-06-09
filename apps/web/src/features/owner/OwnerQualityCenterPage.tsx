import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AuditEventRecord, AuditEventType, AuditSeverity, Task } from "@labelhub/contracts";
import { Role } from "../../app/routes";
import { queryAuditEvents } from "../../api/audit";
import { listTasks } from "../../api/owner";
import { Badge, Card } from "../../ui/primitives";

interface OwnerQualityCenterPageProps {
  role: Role;
}

// 审计事件类型 → 人话标签。未覆盖的类型回退到中性「审计事件」，避免暴露工程代码。
const AUDIT_TYPE_LABELS: Partial<Record<AuditEventType, string>> = {
  REVIEW_STARTED: "审核开始",
  REVIEW_SUBMITTED: "审核决策提交",
  REVIEW_DIFF_GENERATED: "审核修订 diff 生成",
  REVIEW_PATCH_APPLIED: "审核修订已应用",
  REVIEW_DEEP_DIFF_GENERATED: "审核深度 diff 生成",
  AI_REVIEW_TRIGGERED: "AI 预审触发",
  AI_REVIEW_OUTPUT_GENERATED: "AI 预审输出生成",
  AI_REVIEW_GENERATED: "AI 预审结果生成",
  AI_REVIEW_CONFIRMED_BY_REVIEWER: "AI 预审被审核员采纳",
  AI_REVIEW_REJECTED_BY_REVIEWER: "AI 预审被审核员否决",
  AI_ASSIST_ACCEPTED: "AI 建议被采纳",
  AI_ASSIST_EDITED: "AI 建议被修改",
  AI_ASSIST_DISMISSED: "AI 建议被忽略",
  LABELER_RISK_SIGNAL_GENERATED: "标注风险信号",
  EXPORT_GENERATED: "数据导出生成",
  EXPORT_WARNING_RECORDED: "导出质量警告",
  DATA_QUALITY_PASSPORT_GENERATED: "数据质量护照生成",
  SCHEMA_PUBLISH_REQUESTED: "模板发布申请",
  SCHEMA_PUBLISH_BLOCKED: "模板发布被阻断",
  SCHEMA_PUBLISH_FAILED: "模板发布失败",
};

function auditTypeLabel(type: AuditEventType): string {
  return AUDIT_TYPE_LABELS[type] ?? "审计事件";
}

function severityTone(severity: AuditSeverity): "default" | "warning" | "danger" {
  if (severity === "ERROR") return "danger";
  if (severity === "WARNING") return "warning";
  return "default";
}

function isAiSignal(type: AuditEventType): boolean {
  return type.startsWith("AI_REVIEW") || type.startsWith("AI_ASSIST");
}

function isReviewSignal(type: AuditEventType): boolean {
  return type.startsWith("REVIEW_");
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

// 各质量看板复用的事件列表：人话事件名 + 角色 + 时间 + 严重度，绝不展示原始 type/payload。
function QualityBoard({
  title,
  description,
  events,
  emptyText,
  error,
  secondary,
}: {
  title: string;
  description?: string;
  events: AuditEventRecord[];
  emptyText: string;
  error: string | null;
  secondary?: { to?: string; label: string; disabledHint?: string };
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
        <ul className="quality-board__list">
          {events.map((event) => (
            <li className="quality-board__item" key={event.id}>
              <Badge tone={severityTone(event.severity)}>{auditTypeLabel(event.type)}</Badge>
              <span className="quality-board__meta">
                {actorRoleLabel(event.actor.role)} · {formatEventTime(String(event.createdAt))}
              </span>
            </li>
          ))}
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
  const [loading, setLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [tasksResult, eventsResult] = await Promise.allSettled([
        listTasks(),
        queryAuditEvents({ limit: 30 }),
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

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedTaskId = tasks[0]?.id;

  const taskStats = useMemo(() => {
    const published = tasks.filter((task) => task.status === "PUBLISHED").length;
    const draft = tasks.filter((task) => task.status === "DRAFT").length;
    return { total: tasks.length, published, draft };
  }, [tasks]);

  // 风险信号：来自真实审计事件中 severity 非 INFO 的数量，不写死。
  const riskCount = useMemo(() => events.filter((event) => event.severity !== "INFO").length, [events]);

  // 各看板的事件子集，全部来自已加载的真实审计事件，按时间倒序，取最近若干条。
  const aiEvents = useMemo(() => events.filter((event) => isAiSignal(event.type)).slice(0, 8), [events]);
  const reviewEvents = useMemo(() => events.filter((event) => isReviewSignal(event.type)).slice(0, 8), [events]);
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
            集中查看 AI 检查、人工审核、打回修订、导出与审计记录，掌握每批数据的质量来源。
          </p>
        </div>
      </div>

      {tasksError ? (
        <Card className="owner-fallback-notice">
          <Badge tone="danger">加载失败</Badge>
          <span>{tasksError}</span>
        </Card>
      ) : null}

      <div className="owner-summary-strip quality-summary-strip" aria-label="质量总览">
        <div className="owner-summary-item owner-summary-item--primary">
          <span>发布中任务</span>
          <strong>{taskStats.published}</strong>
          <small>当前可进入分发流程</small>
        </div>
        <div className="owner-summary-item">
          <span>草稿任务</span>
          <strong>{taskStats.draft}</strong>
          <small>等待模板或数据配置</small>
        </div>
        <div className="owner-summary-item owner-summary-item--success">
          <span>任务总数</span>
          <strong>{taskStats.total}</strong>
          <small>当前账号创建的任务</small>
        </div>
        <div className="owner-summary-item owner-summary-item--warning">
          <span>最近风险信号</span>
          <strong>{riskCount}</strong>
          <small>来自近期质量审计记录</small>
        </div>
      </div>

      <div className="quality-board-grid">
        <QualityBoard
          title="AI 预审看板"
          description="最近的 AI 预审与 AI 辅助检查记录。"
          events={aiEvents}
          error={eventsError}
          emptyText="暂无 AI 预审质量线索。任务产生 AI 检查结果后，这里会显示相关记录。"
          secondary={{ to: "/owner/ai-config", label: "配置 AI 预审规则" }}
        />

        <QualityBoard
          title="审核与打回看板"
          description="最近的审核开始、提交、修订与打回记录。"
          events={reviewEvents}
          error={eventsError}
          emptyText="暂无审核与打回线索。审核员处理任务后，这里会显示通过、打回和修订记录。"
        />

        <QualityBoard
          title="导出与质量护照"
          description="Data Quality Passport 用于汇总模板版本、审核记录、AI 检查与导出审计，帮助说明数据交付时的质量来源。"
          events={exportEvents}
          error={eventsError}
          emptyText="暂无导出质量记录。生成导出任务后，这里会显示导出与质量护照线索。"
          secondary={resolvedTaskId
            ? { to: `/owner/tasks/${resolvedTaskId}/export`, label: "查看导出中心" }
            : { label: "查看导出中心", disabledHint: "请先创建任务后再查看导出中心。" }}
        />

        <QualityBoard
          title="审计与追溯"
          description="最近的审核、AI 检查、导出与模板发布动作，按时间倒序。"
          events={auditEvents}
          error={eventsError}
          emptyText="暂无审计记录。系统产生审核、AI 检查、导出或模板发布动作后，这里会自动记录。"
        />
      </div>
    </div>
  );
}
