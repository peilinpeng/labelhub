import type {
  AppendAuditEventRequest,
  AppendAuditEventResponse,
  AuditEventQuery,
  AuditEventType,
  QueryAuditEventsResponse,
} from "@labelhub/contracts";
import { apiGet, apiPost } from "./client";

export async function appendAuditEvent(
  request: AppendAuditEventRequest,
): Promise<AppendAuditEventResponse> {
  return apiPost<AppendAuditEventResponse>("/api/v1/audit-events", request);
}

export async function queryAuditEvents(
  query: AuditEventQuery = {},
): Promise<QueryAuditEventsResponse> {
  const search = buildAuditEventSearchParams(query);
  const queryString = search.toString();
  return apiGet<QueryAuditEventsResponse>(`/api/v1/audit-events${queryString ? `?${queryString}` : ""}`);
}

function buildAuditEventSearchParams(query: AuditEventQuery): URLSearchParams {
  const search = new URLSearchParams();

  appendOptional(search, "taskId", query.taskId);
  appendOptional(search, "entityType", query.entityType);
  appendOptional(search, "entityId", query.entityId);
  appendOptional(search, "schemaVersionId", query.schemaVersionId);
  appendOptional(search, "assignmentId", query.assignmentId);
  appendOptional(search, "submissionId", query.submissionId);
  appendOptional(search, "reviewId", query.reviewId);
  appendOptional(search, "exportId", query.exportId);
  appendOptional(search, "migrationPlanId", query.migrationPlanId);
  appendOptional(search, "actorId", query.actorId);
  appendOptional(search, "source", query.source);
  appendOptional(search, "createdFrom", query.createdFrom);
  appendOptional(search, "createdTo", query.createdTo);
  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }
  for (const type of query.types ?? []) {
    search.append("types", type);
  }
  for (const severity of query.severities ?? []) {
    search.append("severities", severity);
  }

  return search;
}

function appendOptional(search: URLSearchParams, key: string, value: AuditEventType | string | number | undefined): void {
  if (value !== undefined) {
    search.set(key, String(value));
  }
}
