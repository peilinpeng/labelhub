import type {
  AuditActor,
  AuditTarget,
  CompatibilityReport,
  DeprecationWarningGeneratedAuditPayload,
  GenericAuditEventPayload,
  ID,
  LabelHubSchema,
  ManualMappingSlot,
  SchemaCompatibilityCheckedAuditPayload,
  SchemaPublishBlockedAuditPayload,
  SchemaPublishFailedAuditPayload,
  SchemaPublishedAuditPayload,
  SchemaPublishRequestedAuditPayload,
  SchemaValidationResult,
  Task,
} from "@labelhub/contracts";
import type { DeprecationIssue } from "@labelhub/schema-core";
import { appendAuditEvent } from "../../api/audit";

export type OwnerPublishFailureStage = "SAVE_DRAFT" | "PUBLISH_SCHEMA" | "PUBLISH_TASK" | "UNKNOWN";

export interface OwnerPublishAuditPreview {
  schema: LabelHubSchema;
  task: Task | undefined;
  schemaValidation: SchemaValidationResult;
  compatibilityReport?: CompatibilityReport;
  deprecationErrors: DeprecationIssue[];
  deprecationWarnings: DeprecationIssue[];
  manualMappingSlots: ManualMappingSlot[];
  publishAllowed: boolean;
  requiresApproval: boolean;
  requiresMigration: boolean;
  isFirstPublish: boolean;
}

export async function appendPublishPreviewAuditEvents(preview: OwnerPublishAuditPreview): Promise<void> {
  await safeAppendCompatibilityChecked(preview);

  if (preview.deprecationErrors.length > 0 || preview.deprecationWarnings.length > 0) {
    await safeAppendDeprecationGenerated(preview);
  }

  if (!preview.publishAllowed) {
    await safeAppendPublishBlocked(preview);
  }
}

export async function appendPublishRequestedAuditEvent(preview: OwnerPublishAuditPreview): Promise<void> {
  const payload: SchemaPublishRequestedAuditPayload & GenericAuditEventPayload = {
    schemaDraftRevision: readSchemaDraftRevision(preview.schema),
    isFirstPublish: preview.isFirstPublish,
    requiresApproval: preview.requiresApproval,
    requiresMigration: preview.requiresMigration,
    confirmedByActor: true,
    counters: {
      manualMappingSlotCount: preview.manualMappingSlots.length,
    },
  };

  await appendOwnerAuditEventSafely({
    type: "SCHEMA_PUBLISH_REQUESTED",
    severity: preview.requiresMigration || preview.requiresApproval ? "WARNING" : "INFO",
    schema: preview.schema,
    task: preview.task,
    payload,
    idempotencyKey: createOwnerPublishIdempotencyKey(preview.schema, preview.task, "schema-publish-requested"),
  });
}

export async function appendSchemaPublishedAuditEvent({
  schema,
  task,
  schemaVersionId,
  schemaVersionNo,
}: {
  schema: LabelHubSchema;
  task: Task | undefined;
  schemaVersionId: ID;
  schemaVersionNo?: number;
}): Promise<void> {
  const payload: SchemaPublishedAuditPayload = {
    schemaVersionId,
  };

  if (schemaVersionNo !== undefined) {
    payload.schemaVersionNo = schemaVersionNo;
  }

  await appendOwnerAuditEventSafely({
    type: "SCHEMA_VERSION_PUBLISHED",
    severity: "INFO",
    schema,
    task,
    schemaVersionId,
    payload,
    idempotencyKey: createOwnerPublishIdempotencyKey(schema, task, "schema-published", schemaVersionId),
  });
}

export async function appendSchemaPublishFailedAuditEvent({
  schema,
  task,
  stage,
  error,
}: {
  schema: LabelHubSchema;
  task: Task | undefined;
  stage: OwnerPublishFailureStage;
  error: unknown;
}): Promise<void> {
  const payload: SchemaPublishFailedAuditPayload = {
    stage,
    message: error instanceof Error ? error.message : "发布流程失败。",
  };

  await appendOwnerAuditEventSafely({
    type: "SCHEMA_PUBLISH_FAILED",
    severity: "ERROR",
    schema,
    task,
    payload,
    idempotencyKey: createOwnerPublishIdempotencyKey(schema, task, "schema-publish-failed", stage),
  });
}

async function safeAppendCompatibilityChecked(preview: OwnerPublishAuditPreview): Promise<void> {
  const report = preview.compatibilityReport;
  const payload: SchemaCompatibilityCheckedAuditPayload = {
    compatible: report?.compatible ?? preview.publishAllowed,
    publishAllowed: report?.publishAllowed ?? preview.publishAllowed,
    requiresApproval: report?.requiresApproval ?? preview.requiresApproval,
    requiresMigration: report?.requiresMigration ?? preview.requiresMigration,
    changeCodes: collectChangeCodes(report),
    blockingCount: report?.blockingChanges.length ?? 0,
    warningCount: report?.warnings.length ?? 0,
  };

  await appendOwnerAuditEventSafely({
    type: "SCHEMA_COMPATIBILITY_CHECKED",
    severity: preview.publishAllowed ? "INFO" : "WARNING",
    schema: preview.schema,
    task: preview.task,
    payload,
    idempotencyKey: createOwnerPublishIdempotencyKey(preview.schema, preview.task, "schema-publish-preview"),
  });
}

async function safeAppendDeprecationGenerated(preview: OwnerPublishAuditPreview): Promise<void> {
  const issues = [...preview.deprecationErrors, ...preview.deprecationWarnings];
  const payload: DeprecationWarningGeneratedAuditPayload & GenericAuditEventPayload = {
    warningCodes: uniqueStrings(issues.map((issue) => issue.code)),
    fieldNames: uniqueStrings(issues.map((issue) => issue.fieldName).filter(isDefinedString)),
    warningCount: preview.deprecationWarnings.length,
    counters: {
      warningCount: preview.deprecationWarnings.length,
      errorCount: preview.deprecationErrors.length,
      totalIssueCount: issues.length,
    },
  };

  await appendOwnerAuditEventSafely({
    type: "DEPRECATION_WARNING_GENERATED",
    severity: preview.deprecationErrors.length > 0 ? "ERROR" : "WARNING",
    schema: preview.schema,
    task: preview.task,
    payload,
    idempotencyKey: createOwnerPublishIdempotencyKey(preview.schema, preview.task, "schema-deprecation"),
  });
}

async function safeAppendPublishBlocked(preview: OwnerPublishAuditPreview): Promise<void> {
  const payload: SchemaPublishBlockedAuditPayload = {
    blockingChangeCodes: preview.compatibilityReport?.blockingChanges.map((change) => change.code) ?? [],
    deprecationErrorCodes: uniqueStrings(preview.deprecationErrors.map((issue) => issue.code)),
    schemaValidationErrorCount: preview.schemaValidation.errors.length,
  };

  await appendOwnerAuditEventSafely({
    type: "SCHEMA_PUBLISH_BLOCKED",
    severity: "ERROR",
    schema: preview.schema,
    task: preview.task,
    payload,
    idempotencyKey: createOwnerPublishIdempotencyKey(preview.schema, preview.task, "schema-publish-blocked"),
  });
}

async function appendOwnerAuditEventSafely({
  type,
  severity,
  schema,
  task,
  schemaVersionId,
  payload,
  idempotencyKey,
}: {
  type: Parameters<typeof appendAuditEvent>[0]["type"];
  severity: Parameters<typeof appendAuditEvent>[0]["severity"];
  schema: LabelHubSchema;
  task: Task | undefined;
  schemaVersionId?: ID;
  payload: Parameters<typeof appendAuditEvent>[0]["payload"];
  idempotencyKey: string;
}): Promise<void> {
  try {
    await appendAuditEvent({
      type,
      severity,
      source: "WEB",
      actor: createOwnerAuditActor(),
      target: createOwnerAuditTarget(schema, task, schemaVersionId),
      payload,
      idempotencyKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn(`Owner schema publish audit event 写入失败：${message}`);
  }
}

function createOwnerAuditActor(): AuditActor {
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

function createOwnerAuditTarget(schema: LabelHubSchema, task: Task | undefined, schemaVersionId?: ID): AuditTarget {
  const taskId = task?.id ?? schema.meta.taskId;
  const resolvedSchemaVersionId = schemaVersionId ?? schema.schemaVersionId ?? task?.activeSchemaVersionId;

  const target: AuditTarget = {
    entityType: "SCHEMA",
    entityId: schema.schemaId,
    taskId,
    schemaId: schema.schemaId,
  };

  if (resolvedSchemaVersionId !== undefined) {
    target.schemaVersionId = resolvedSchemaVersionId;
  }

  return target;
}

function createOwnerPublishIdempotencyKey(
  schema: LabelHubSchema,
  task: Task | undefined,
  eventName: string,
  suffix?: string,
): string {
  const taskId = task?.id ?? schema.meta.taskId;
  const revision = String(readSchemaDraftRevision(schema));
  return ["owner", taskId, eventName, revision, suffix].filter(isDefinedString).join(":");
}

function readSchemaDraftRevision(schema: LabelHubSchema): number {
  return schema.schemaDraftRevision ?? schema.schemaVersionNo ?? 1;
}

function collectChangeCodes(report: CompatibilityReport | undefined): string[] {
  return report ? uniqueStrings(report.changes.map((change) => change.code)) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isDefinedString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}
