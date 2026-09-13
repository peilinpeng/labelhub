import type {
  AppendAuditEventRequest,
  AuditEventQuery,
  AuditEventRecord,
  AuditLogSummary,
  QueryAuditEventsResponse,
} from "@labelhub/contracts";
import { clone, nextId, now } from "../mock-utils";
import { mockDb } from "./state";

export function audit(action: AuditLogSummary["action"]): AuditLogSummary {
  return {
    id: nextId("audit"),
    action,
    createdAt: now(),
  };
}

export function appendAuditEvent(request: AppendAuditEventRequest): AuditEventRecord {
  if (request.idempotencyKey !== undefined) {
    const existing = mockDb.auditEvents.find((event) => event.idempotencyKey === request.idempotencyKey);
    if (existing !== undefined) {
      return clone(existing);
    }
  }

  const record: AuditEventRecord = {
    id: nextId("audit"),
    type: request.type,
    severity: request.severity ?? "INFO",
    source: request.source,
    actor: request.actor,
    target: request.target,
    payload: sanitizeAuditPayload(request.payload),
    createdAt: now(),
  };
  if (request.requestId !== undefined) record.requestId = request.requestId;
  if (request.idempotencyKey !== undefined) record.idempotencyKey = request.idempotencyKey;
  if (request.checksum !== undefined) record.checksum = request.checksum;

  mockDb.auditEvents.push(record);
  return clone(record);
}

export function queryAuditEvents(query: AuditEventQuery = {}): QueryAuditEventsResponse {
  const matchingEvents = mockDb.auditEvents
    .filter((event) => matchesAuditQuery(event, query))
    .sort(compareAuditEventsDesc);
  const cursorIndex = query.cursor === undefined
    ? -1
    : matchingEvents.findIndex((event) => event.id === query.cursor);
  const pageStart = cursorIndex < 0 ? 0 : cursorIndex + 1;
  const limit = query.limit ?? matchingEvents.length;
  const page = matchingEvents.slice(pageStart, pageStart + limit + 1);
  const events = page
    .slice(0, limit)
    .map((event) => clone(event));

  return {
    events,
    total: matchingEvents.length,
    ...(page.length > limit && events.length > 0
      ? { nextCursor: String(events[events.length - 1]?.id) }
      : {}),
  };
}

function matchesAuditQuery(event: AuditEventRecord, query: AuditEventQuery): boolean {
  if (query.taskId !== undefined && event.target.taskId !== query.taskId) return false;
  if (query.entityType !== undefined && event.target.entityType !== query.entityType) return false;
  if (query.entityId !== undefined && event.target.entityId !== query.entityId) return false;
  if (query.schemaVersionId !== undefined && event.target.schemaVersionId !== query.schemaVersionId) return false;
  if (query.assignmentId !== undefined && event.target.assignmentId !== query.assignmentId) return false;
  if (query.submissionId !== undefined && event.target.submissionId !== query.submissionId) return false;
  if (query.reviewId !== undefined && event.target.reviewId !== query.reviewId) return false;
  if (query.exportId !== undefined && event.target.exportId !== query.exportId) return false;
  if (query.migrationPlanId !== undefined && event.target.migrationPlanId !== query.migrationPlanId) return false;
  if (query.actorId !== undefined && event.actor.id !== query.actorId) return false;
  if (query.types !== undefined && !query.types.includes(event.type)) return false;
  if (query.severities !== undefined && !query.severities.includes(event.severity)) return false;
  if (query.source !== undefined && event.source !== query.source) return false;
  if (query.createdFrom !== undefined && event.createdAt < query.createdFrom) return false;
  if (query.createdTo !== undefined && event.createdAt > query.createdTo) return false;
  return true;
}

export function compareAuditEventsDesc(left: AuditEventRecord, right: AuditEventRecord): number {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
  return byCreatedAt === 0 ? String(right.id).localeCompare(String(left.id)) : byCreatedAt;
}

function sanitizeAuditPayload(payload: AppendAuditEventRequest["payload"]): AppendAuditEventRequest["payload"] {
  return sanitizeAuditValue(payload) as AppendAuditEventRequest["payload"];
}

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (isSensitiveAuditPayloadKey(key)) {
      continue;
    }
    sanitized[key] = sanitizeAuditValue(childValue);
  }
  return sanitized;
}

function isSensitiveAuditPayloadKey(key: string): boolean {
  return [
    "answers",
    "beforeAnswers",
    "afterAnswers",
    "fullAnswers",
    "sourcePayload",
    "rawOutput",
    "rawLlmOutput",
    "rawPrompt",
    "rawResponse",
    "fullOutput",
    "prompt",
    "renderedPrompt",
    "exportContent",
    "fileContent",
  ].includes(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
