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

  // 入口链接需要一个任务上下文：优先用真实任务，回退到默认演示任务，避免链接落空。
  const resolvedTaskId = tasks[0]?.id ?? "task_news_quality";

  const taskStats = useMemo(() => {
    const published = tasks.filter((task) => task.status === "PUBLISHED").length;
    const draft = tasks.filter((task) => task.status === "DRAFT").length;
    return { total: tasks.length, published, draft };
  }, [tasks]);

  // 以下计数全部来自真实审计事件，仅统计「最近拉取到的审计记录」，不伪造比率或总量。
  const signalCounts = useMemo(() => {
    let ai = 0;
    let review = 0;
    let exportSignal = 0;
    let risk = 0;
    for (const event of events) {
      if (isAiSignal(event.type)) ai += 1;
      if (isReviewSignal(event.type)) review += 1;
      if (isExportSignal(event.type)) exportSignal += 1;
      if (event.severity !== "INFO") risk += 1;
    }
    return { ai, review, exportSignal, risk };
  }, [events]);

  const recentClues = useMemo(() => events.slice(0, 8), [events]);

  const entryCards: Array<{ to: string; title: string; description: string; count: number; countLabel: string }> = [
    {
      to: `/owner/tasks/${resolvedTaskId}/ai-config`,
      title: "AI 预审 / AI 检查",
      description: "维护异步预审规则、维度评分与人工兜底策略。",
      count: signalCounts.ai,
      countLabel: "最近 AI 相关审计",
    },
    {
      to: "/owner/tasks",
      title: "审核与打回线索",
      description: "进入任务管理查看各任务的发布与审核状态。",
      count: signalCounts.review,
      countLabel: "最近审核相关审计",
    },
    {
      to: `/owner/tasks/${resolvedTaskId}/export`,
      title: "导出与质量护照",
      description: "查看导出任务状态，并下钻数据质量护照摘要。",
      count: signalCounts.exportSignal,
      countLabel: "最近导出相关审计",
    },
    {
      to: `/owner/tasks/${resolvedTaskId}/designer`,
      title: "模板与审计日志",
      description: "在模板搭建页查看版本审计时间线与发布前检查。",
      count: events.length,
      countLabel: "最近审计事件",
    },
  ];

  if (loading) {
    return <Card className="state-panel">加载质量中心中...</Card>;
  }

  return (
    <div className="page-stack quality-center-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">质量中心</h2>
          <p className="page-subtitle">
            集中查看 AI 检查、人工审核、打回修订、导出与审计相关的质量信号。当前版本只展示已有任务产生的真实质量线索，不伪造统计指标。
          </p>
        </div>
      </div>

      {tasksError ? (
        <Card className="owner-fallback-notice">
          <Badge tone="danger">加载失败</Badge>
          <span>{tasksError}</span>
        </Card>
      ) : null}

      <div className="owner-summary-strip" aria-label="任务概览">
        <div className="owner-summary-item owner-summary-item--primary">
          <span>发布中任务</span>
          <strong>{taskStats.published}</strong>
        </div>
        <div className="owner-summary-item">
          <span>草稿任务</span>
          <strong>{taskStats.draft}</strong>
        </div>
        <div className="owner-summary-item owner-summary-item--success">
          <span>任务总数</span>
          <strong>{taskStats.total}</strong>
        </div>
        <div className="owner-summary-item owner-summary-item--warning">
          <span>最近审计风险信号</span>
          <strong>{signalCounts.risk}</strong>
        </div>
      </div>

      <section className="quality-center-grid" aria-label="质量信号入口">
        {entryCards.map((card) => (
          <Link className="quality-center-entry" key={card.title} to={card.to}>
            <div className="quality-center-entry__head">
              <strong>{card.title}</strong>
              <Badge tone={card.count > 0 ? "primary" : "default"}>
                {card.countLabel} {card.count}
              </Badge>
            </div>
            <p>{card.description}</p>
            <span className="quality-center-entry__cta">进入 →</span>
          </Link>
        ))}
      </section>

      <Card className="quality-center-passport">
        <div className="quality-center-passport__head">
          <div>
            <h3>Data Quality Passport</h3>
            <p>
              数据质量护照汇总模板版本、审核记录、AI 检查与导出审计，用于交付时说明数据质量来源。生成导出任务后，可在导出中心查看每批数据的真实质量护照。
            </p>
          </div>
          <Link className="lh-button lh-button--primary" to={`/owner/tasks/${resolvedTaskId}/export`}>
            前往导出中心
          </Link>
        </div>
      </Card>

      <Card className="quality-center-clues">
        <div className="quality-center-clues__head">
          <div>
            <h3>最近质量线索</h3>
            <p>来自真实审计事件，按时间倒序展示最近的审核、AI 检查与导出动作。</p>
          </div>
        </div>
        {eventsError ? (
          <div className="empty-state">{eventsError}</div>
        ) : recentClues.length === 0 ? (
          <div className="empty-state">
            暂无质量问题。任务产生审核结果后，这里会显示风险信号与修订线索。
          </div>
        ) : (
          <ul className="quality-center-clue-list">
            {recentClues.map((event) => (
              <li className="quality-center-clue" key={event.id}>
                <Badge tone={severityTone(event.severity)}>{auditTypeLabel(event.type)}</Badge>
                <span className="quality-center-clue__meta">
                  {event.actor.role} · {new Date(event.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
