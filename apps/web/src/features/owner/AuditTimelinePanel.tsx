import type { AuditEventPayload, AuditEventRecord, AuditSeverity } from "@labelhub/contracts";
import { Badge, Button, Card } from "../../ui/primitives";

export interface AuditTimelinePanelProps {
  events: AuditEventRecord[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

const eventTitleMap: Partial<Record<AuditEventRecord["type"], string>> = {
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

export function AuditTimelinePanel({
  events,
  loading = false,
  error = null,
  onRefresh,
}: AuditTimelinePanelProps) {
  return (
    <Card className="schema-audit-card">
      <div className="schema-config-heading">
        <div>
          <h3>审计日志</h3>
          <p>只读展示当前任务相关的 schema 发布审计事件。</p>
        </div>
        {onRefresh ? (
          <Button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "刷新中..." : "刷新审计日志"}
          </Button>
        ) : null}
      </div>

      {error ? <p className="schema-audit-error">{error}</p> : null}
      {loading && events.length === 0 ? <p className="schema-audit-empty">正在加载审计日志...</p> : null}
      {!loading && events.length === 0 ? <p className="schema-audit-empty">暂无审计记录。</p> : null}

      {events.length > 0 ? (
        <ol className="schema-audit-timeline" aria-label="审计事件列表">
          {events.map((event) => (
            <li className="schema-audit-event" key={event.id}>
              <div className="schema-audit-event__header">
                <strong>{eventTitleMap[event.type] ?? `未知事件：${event.type}`}</strong>
                <div className="schema-audit-event__badges">
                  <Badge tone={severityToneMap[event.severity]}>{severityLabelMap[event.severity]}</Badge>
                  <Badge tone="default">{event.source}</Badge>
                </div>
              </div>

              <div className="schema-audit-event__meta">
                <span>{event.actor.displayName ?? event.actor.id}</span>
                <span>{event.actor.role}</span>
                <span>{event.target.entityType}</span>
                <time dateTime={event.createdAt}>{formatAuditTime(event.createdAt)}</time>
              </div>

              <ul className="schema-audit-summary">
                {createPayloadSummary(event.payload).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
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
