import type {
  AuditActor,
  AuditTarget,
  ExportFormat,
  ExportGeneratedAuditPayload,
  ExportJob,
  GenericAuditEventPayload,
  ID,
} from "@labelhub/contracts";
import { appendAuditEvent } from "../../api/audit";

type ExportSummaryAuditPayload = ExportGeneratedAuditPayload & GenericAuditEventPayload & {
  taskId: string;
  stage: "JOB_CREATED";
  targetSchemaVersionId?: ID | string;
  includedSchemaVersionIds?: Array<ID | string>;
  includeAudit: boolean;
  statusFilter: string;
  createdAt: string;
};

export function appendExportGeneratedAuditSafely({
  taskId,
  exportJob,
  format,
  rowCount,
  warningCount,
  targetSchemaVersionId,
  includedSchemaVersionIds,
  includeAudit,
  statusFilter,
  stage,
}: {
  taskId: string;
  exportJob: ExportJob;
  format: ExportFormat;
  rowCount?: number;
  warningCount?: number;
  targetSchemaVersionId?: ID | string;
  includedSchemaVersionIds?: Array<ID | string>;
  includeAudit: boolean;
  statusFilter: string;
  stage: "JOB_CREATED";
}): void {
  const payload: ExportSummaryAuditPayload = {
    exportId: exportJob.id,
    format,
    warningCount: warningCount ?? 0,
    summary: "导出任务已创建",
    detailRef: exportJob.id,
    codes: [stage],
    counters: {
      rowCount: rowCount ?? exportJob.progress.total,
      includeAudit: includeAudit ? 1 : 0,
    },
    taskId,
    stage,
    includeAudit,
    statusFilter,
    createdAt: exportJob.createdAt,
  };

  if (rowCount !== undefined) {
    payload.rowCount = rowCount;
  }
  if (targetSchemaVersionId !== undefined) {
    payload.targetSchemaVersionId = targetSchemaVersionId;
  }
  if (includedSchemaVersionIds !== undefined) {
    payload.includedSchemaVersionIds = includedSchemaVersionIds;
  }

  void appendAuditEvent({
    type: "EXPORT_GENERATED",
    severity: warningCount && warningCount > 0 ? "WARNING" : "INFO",
    source: "WEB",
    actor: createOwnerActor(),
    target: createExportTarget({
      taskId,
      exportJob,
      targetSchemaVersionId,
    }),
    payload,
    idempotencyKey: `EXPORT:${exportJob.id}:EXPORT_GENERATED:${stage}`,
  }).catch((error) => {
    console.warn("写入导出摘要审计事件失败：", error);
  });
}

function createOwnerActor(): AuditActor {
  const actor = readStoredActor();
  return { id: actor?.id ?? "owner", role: "OWNER", displayName: actor?.displayName ?? "任务负责人" };
}

function readStoredActor(): { id?: string; displayName?: string } | null {
  try {
    const value = localStorage.getItem("labelhub_actor");
    return value ? JSON.parse(value) as { id?: string; displayName?: string } : null;
  } catch {
    return null;
  }
}

function createExportTarget({
  taskId,
  exportJob,
  targetSchemaVersionId,
}: {
  taskId: string;
  exportJob: ExportJob;
  targetSchemaVersionId?: ID | string;
}): AuditTarget {
  const target: AuditTarget = {
    entityType: "EXPORT",
    entityId: exportJob.id,
    taskId,
    exportId: exportJob.id,
  };

  if (targetSchemaVersionId !== undefined) {
    target.schemaVersionId = targetSchemaVersionId;
  }

  return target;
}
