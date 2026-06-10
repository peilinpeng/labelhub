import type { AuditEventPayload, AuditEventRecord, AuditSeverity } from "@labelhub/contracts";
import { Badge, Button, Card } from "../../ui/primitives";

export interface AuditTimelinePanelProps {
  events: AuditEventRecord[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  title?: string;
  description?: string;
  emptyText?: string;
}

const eventTitleMap: Partial<Record<AuditEventRecord["type"], string>> = {
  SCHEMA_DRAFT_SAVED: "模板草稿已保存",
  SCHEMA_COMPATIBILITY_CHECKED: "发布前兼容性检查",
  DEPRECATION_WARNING_GENERATED: "字段废弃警告",
  SCHEMA_PUBLISH_BLOCKED: "发布被阻断",
  SCHEMA_PUBLISH_REQUESTED: "请求发布 Schema",
  SCHEMA_VERSION_PUBLISHED: "Schema 版本已发布",
  SCHEMA_PUBLISH_FAILED: "Schema 发布失败",
};

const severityLabelMap: Record<AuditSeverity, string> = {
  INFO: "信息",
  WARNING: "警告",
  ERROR: "错误",
};

const severityToneMap: Record<AuditSeverity, "default" | "warning" | "danger"> = {
  INFO: "default",
  WARNING: "warning",
  ERROR: "danger",
};

const eventStatusMap: Partial<Record<AuditEventRecord["type"], { label: string; tone: "success" | "warning" | "danger" | "primary" | "default" }>> = {
  SCHEMA_DRAFT_SAVED: { label: "草稿保存", tone: "default" },
  SCHEMA_PUBLISH_REQUESTED: { label: "发布请求", tone: "primary" },
  SCHEMA_COMPATIBILITY_CHECKED: { label: "校验完成", tone: "success" },
  SCHEMA_VERSION_PUBLISHED: { label: "成功", tone: "success" },
  SCHEMA_PUBLISH_BLOCKED: { label: "已阻断", tone: "warning" },
  SCHEMA_PUBLISH_FAILED: { label: "失败", tone: "danger" },
};

export function AuditTimelinePanel({
  events,
  loading = false,
  error = null,
  onRefresh,
  title = "审计日志",
  description = "只读展示当前任务相关的 schema 发布审计事件。",
  emptyText = "暂无审计记录。",
}: AuditTimelinePanelProps) {
  return (
    <Card className="schema-audit-card">
      <div className="schema-config-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {onRefresh ? (
          <Button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "刷新中..." : "刷新审计日志"}
          </Button>
        ) : null}
      </div>

      {error ? <p className="schema-audit-error">{error}</p> : null}
      {loading && events.length === 0 ? <p className="schema-audit-empty">正在加载审计日志...</p> : null}
      {!loading && events.length === 0 ? <p className="schema-audit-empty">{emptyText}</p> : null}

      {events.length > 0 ? (
        <ol className="schema-audit-timeline" aria-label="审计事件列表">
          {events.map((event) => (
            <li className="schema-audit-event" key={event.id}>
              <div className="schema-audit-event__header">
                <strong title={getEventTitle(event)}>{getEventTitle(event)}</strong>
                <div className="schema-audit-event__badges">
                  {getEventStatus(event) ? (
                    <Badge tone={getEventStatus(event)?.tone}>{getEventStatus(event)?.label}</Badge>
                  ) : null}
                  <Badge tone={severityToneMap[event.severity]}>{severityLabelMap[event.severity]}</Badge>
                </div>
              </div>

              <div className="schema-audit-event__meta">
                <span>{event.actor.displayName ?? event.actor.id}</span>
                <span>{event.actor.role}</span>
                <span title={event.target.entityId}>{event.target.entityType}</span>
                <time dateTime={event.createdAt}>{formatAuditTime(event.createdAt)}</time>
              </div>

              <ul className="schema-audit-summary">
                {createPayloadSummary(event.payload).map((item) => (
                  <li key={item} title={item}>{truncateSummary(item)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

function getEventTitle(event: AuditEventRecord): string {
  if (isTaskPublishFailure(event)) {
    return "任务发布未完成";
  }
  return eventTitleMap[event.type] ?? "审计事件";
}

function getEventStatus(event: AuditEventRecord): { label: string; tone: "success" | "warning" | "danger" | "primary" | "default" } | undefined {
  if (isTaskPublishFailure(event)) {
    return { label: "待补充条件", tone: "warning" };
  }
  return eventStatusMap[event.type];
}

function isTaskPublishFailure(event: AuditEventRecord): boolean {
  const payload: unknown = event.payload;
  return event.type === "SCHEMA_PUBLISH_FAILED" && isRecord(payload) && payload["stage"] === "PUBLISH_TASK";
}

function truncateSummary(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function createPayloadSummary(payload: AuditEventPayload): string[] {
  if (!isRecord(payload)) {
    return ["无摘要字段"];
  }

  const payloadRecord: Record<string, unknown> = payload;
  const summary: string[] = [];
  appendStringArraySummary(summary, payloadRecord, "changeCodes", "变更代码");
  appendStringArraySummary(summary, payloadRecord, "blockingChangeCodes", "阻断代码");
  appendStringArraySummary(summary, payloadRecord, "deprecationErrorCodes", "废弃错误");
  appendStringArraySummary(summary, payloadRecord, "warningCodes", "警告代码");
  appendNumberSummary(summary, payloadRecord, "blockingCount", "阻断数量");
  appendNumberSummary(summary, payloadRecord, "warningCount", "警告数量");
  appendBooleanSummary(summary, payloadRecord, "requiresApproval", "需要确认");
  appendBooleanSummary(summary, payloadRecord, "requiresMigration", "需要迁移");
  appendStringSummary(summary, payloadRecord, "schemaVersionId", "Schema 版本");
  appendNumberSummary(summary, payloadRecord, "schemaVersionNo", "版本号");
  appendStringSummary(summary, payloadRecord, "stage", "阶段");
  appendStringSummary(summary, payloadRecord, "message", "信息");

  const counters = payloadRecord["counters"];
  if (isRecord(counters)) {
    appendCounterSummary(summary, counters, "manualMappingSlotCount", "人工映射数量");
    appendCounterSummary(summary, counters, "errorCount", "错误数量");
    appendCounterSummary(summary, counters, "totalIssueCount", "问题总数");
  }

  return summary.length > 0 ? summary : ["无摘要字段"];
}

function appendStringSummary(
  summary: string[],
  payload: Record<string, unknown>,
  key: string,
  label: string,
): void {
  const value = payload[key];
  if (typeof value === "string" && value.length > 0) {
    summary.push(`${label}：${value}`);
  }
}

function appendNumberSummary(
  summary: string[],
  payload: Record<string, unknown>,
  key: string,
  label: string,
): void {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    summary.push(`${label}：${value}`);
  }
}

function appendCounterSummary(
  summary: string[],
  counters: Record<string, unknown>,
  key: string,
  label: string,
): void {
  appendNumberSummary(summary, counters, key, label);
}

function appendBooleanSummary(
  summary: string[],
  payload: Record<string, unknown>,
  key: string,
  label: string,
): void {
  const value = payload[key];
  if (typeof value === "boolean") {
    summary.push(`${label}：${value ? "是" : "否"}`);
  }
}

function appendStringArraySummary(
  summary: string[],
  payload: Record<string, unknown>,
  key: string,
  label: string,
): void {
  const value = payload[key];
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
    if (items.length > 0) {
      summary.push(`${label}：${items.join("、")}`);
    }
  }
}

function formatAuditTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
