import type {
  AppendAuditEventRequest,
  AnswerPayload,
  AuditEventRecord,
  DataQualityPassport,
  ExportArtifactSummary,
  ExportJob,
  ExportMapping,
  ExportRecord,
  ExportRecordMetadata,
  FileObject,
  FinalReviewResultRecord,
  HumanReviewResultRecord,
  ReviewPatch,
  RiskSignalCode,
  Submission,
} from "@labelhub/contracts";
import { hashCanonicalJson } from "../hash-utils";
import { clone, nextId, now } from "../mock-utils";
import { appendAuditEvent, compareAuditEventsDesc } from "./audit";
import { mockDb, type MockExportArtifact } from "./state";

export function createExport(taskId: string, mapping: ExportMapping): ExportJob {
  const exportSubmissions = selectExportSubmissions(taskId, mapping);
  const exportJob: ExportJob = {
    id: nextId("job"),
    taskId: taskId as ExportJob["taskId"],
    schemaVersionId: mapping.schemaVersionId,
    status: "PENDING",
    mapping,
    progress: {
      total: exportSubmissions.length,
      done: 0,
    },
    createdBy: "usr_owner",
    createdAt: now(),
  };
  mockDb.exportJobs.push(exportJob);
  globalThis.setTimeout(() => {
    exportJob.status = "RUNNING";
    exportJob.progress.done = Math.floor(exportJob.progress.total / 2);
  }, 300);
  globalThis.setTimeout(() => {
    const file: FileObject = {
      id: nextId("file"),
      ownerId: exportJob.id,
      ownerType: "EXPORT_JOB",
      purpose: "EXPORT_RESULT",
      mimeType: "application/jsonl",
      size: 1024,
      storageKey: `${exportJob.id}/result.jsonl`,
      status: "READY",
      createdAt: now(),
      confirmedAt: now(),
    };
    mockDb.files.push(file);
    exportJob.status = "SUCCEEDED";
    exportJob.progress.done = exportJob.progress.total;
    exportJob.fileId = file.id;
    exportJob.finishedAt = now();
    void generateExportArtifact(exportJob, exportSubmissions).catch((error: unknown) => {
      console.warn("生成导出质量护照失败：", error);
    });
  }, 900);
  return exportJob;
}

export function getExportArtifactSummary(exportId: string): ExportArtifactSummary | undefined {
  const artifact = mockDb.exportArtifacts.find((item) => item.summary.exportId === exportId);
  return artifact === undefined ? undefined : clone(artifact.summary);
}

export function listExportRecords(exportId: string): ExportRecord[] {
  const artifact = mockDb.exportArtifacts.find((item) => item.summary.exportId === exportId);
  return artifact === undefined ? [] : clone(artifact.records);
}

function selectExportSubmissions(taskId: string, mapping: ExportMapping): Submission[] {
  const requestedStatuses = mapping.filters?.submissionStatus;
  const allowedStatuses = requestedStatuses?.length === 0 ? undefined : requestedStatuses;
  const defaultAcceptedOnly = mapping.filters === undefined || mapping.filters.acceptedOnly !== false;

  return mockDb.submissions.filter((submission) => {
    if (submission.taskId !== taskId) return false;
    if (allowedStatuses !== undefined) return allowedStatuses.includes(submission.status);
    return defaultAcceptedOnly ? submission.status === "ACCEPTED" : true;
  });
}

async function generateExportArtifact(exportJob: ExportJob, submissions: Submission[]): Promise<void> {
  const generatedAt = now();
  let warningCount = 0;
  const preparedRecords: Array<{
    submission: Submission;
    finalAnswers: Record<string, unknown>;
    passport: DataQualityPassport;
  }> = [];

  for (const submission of submissions) {
    const latestPatches = findLatestReviewPatches(submission.id);
    const fallbackDiffSummary = getLatestReviewDiffSummary(submission.id);
    const finalAnswers = applyReviewPatches(submission.answers, latestPatches);
    const finalAnswerHash = await hashCanonicalJson(finalAnswers);
    if (finalAnswerHash === undefined) warningCount += 1;
    const passport = buildDataQualityPassport({
      exportJob,
      submission,
      finalAnswerHash,
      patchCount: latestPatches.length > 0 ? latestPatches.length : fallbackDiffSummary.patchCount,
      changedFieldNames: latestPatches.length > 0 ? latestPatches.map((patch) => patch.fieldName) : fallbackDiffSummary.patchedFieldNames,
    });
    preparedRecords.push({ submission, finalAnswers, passport });
  }

  const passportBatchHash = preparedRecords.length > 0 ? await hashCanonicalJson(preparedRecords.map((item) => item.passport)) : undefined;
  if (preparedRecords.length > 0 && passportBatchHash === undefined) warningCount += 1;

  const summary = buildExportArtifactSummary({
    exportJob,
    recordCount: preparedRecords.length,
    warningCount,
    passportCount: preparedRecords.length,
    passportBatchHash,
    generatedAt,
  });
  const metadata = buildExportRecordMetadata({
    exportJob,
    rowCount: preparedRecords.length,
    warningCount,
    checksum: passportBatchHash,
    exportedAt: generatedAt,
  });
  const records: ExportRecord[] = preparedRecords.map((item, index) => ({
    exportId: exportJob.id,
    submissionId: item.submission.id,
    schemaVersionId: item.submission.schemaVersionId,
    recordIndex: index,
    data: item.finalAnswers,
    metadata,
    passport: item.passport,
  }));

  exportJob.artifactSummary = summary;
  upsertExportArtifact({ summary, records });
  appendDataQualityPassportGeneratedAudit(summary);
}

function buildDataQualityPassport(input: {
  exportJob: ExportJob;
  submission: Submission;
  finalAnswerHash: string | undefined;
  patchCount: number;
  changedFieldNames: string[];
}): DataQualityPassport {
  const relatedEvents = findRelatedAuditEvents(input.submission, input.exportJob.id);
  const labelingEvent = findLatestAuditEvent(relatedEvents, "LABELING_SESSION_SUMMARY");
  const reviewEvent = findLatestAuditEvent(relatedEvents, "REVIEW_SUBMITTED");
  const reviewDiffEvent = findLatestAuditEvent(relatedEvents, "REVIEW_DIFF_GENERATED");
  const exportEvent = findLatestAuditEvent(relatedEvents, "EXPORT_GENERATED");
  const aiAssistEvents = relatedEvents.filter((event) => ["AI_ASSIST_ACCEPTED", "AI_ASSIST_DISMISSED", "AI_ASSIST_EDITED"].includes(event.type));
  const aiReviewEvents = relatedEvents.filter((event) =>
    ["AI_REVIEW_CONFIRMED_BY_REVIEWER", "AI_REVIEW_REJECTED_BY_REVIEWER"].includes(event.type),
  );
  const schemaGovernanceEvents = relatedEvents.filter((event) => isSchemaGovernanceAuditType(event.type));
  const qualityLedgerRef = buildQualityLedgerRef({
    labelingEvent,
    reviewEvent,
    reviewDiffEvent,
    exportEvent,
    aiAssistEvents,
    aiReviewEvents,
    schemaGovernanceEvents,
  });
  const passport: DataQualityPassport = {
    submissionId: input.submission.id,
    schemaVersionId: input.submission.schemaVersionId,
    reviewStatus: inferPassportReviewStatus(input.submission),
    reviewerPatchCount: input.patchCount,
    changedFieldNames: input.changedFieldNames,
    aiAssistUsed: aiAssistEvents.length > 0,
    aiAcceptedCount: countAuditEvents(relatedEvents, "AI_ASSIST_ACCEPTED"),
    aiDismissedCount: countAuditEvents(relatedEvents, "AI_ASSIST_DISMISSED"),
    aiEditedCount: countAuditEvents(relatedEvents, "AI_ASSIST_EDITED"),
    riskCodes: extractRiskCodes(labelingEvent),
    auditEventCount: relatedEvents.length,
    qualityLedgerRef,
  };
  if (input.finalAnswerHash !== undefined) {
    passport.finalAnswerHash = input.finalAnswerHash;
    passport.answerHashAlgorithm = "canonical-json-v1+SHA-256";
  }
  return passport;
}

function buildQualityLedgerRef(input: {
  labelingEvent: AuditEventRecord | undefined;
  reviewEvent: AuditEventRecord | undefined;
  reviewDiffEvent: AuditEventRecord | undefined;
  exportEvent: AuditEventRecord | undefined;
  aiAssistEvents: AuditEventRecord[];
  aiReviewEvents: AuditEventRecord[];
  schemaGovernanceEvents: AuditEventRecord[];
}): NonNullable<DataQualityPassport["qualityLedgerRef"]> {
  const qualityLedgerRef: NonNullable<DataQualityPassport["qualityLedgerRef"]> = {};
  if (input.labelingEvent !== undefined) qualityLedgerRef.labelingEventId = input.labelingEvent.id;
  if (input.reviewEvent !== undefined) qualityLedgerRef.reviewEventId = input.reviewEvent.id;
  if (input.reviewDiffEvent !== undefined) qualityLedgerRef.reviewDiffEventId = input.reviewDiffEvent.id;
  if (input.exportEvent !== undefined) qualityLedgerRef.exportEventId = input.exportEvent.id;
  if (input.aiAssistEvents.length > 0) qualityLedgerRef.aiAssistEventIds = input.aiAssistEvents.map((event) => event.id);
  if (input.aiReviewEvents.length > 0) qualityLedgerRef.aiReviewEventIds = input.aiReviewEvents.map((event) => event.id);
  if (input.schemaGovernanceEvents.length > 0) {
    qualityLedgerRef.schemaGovernanceEventIds = input.schemaGovernanceEvents.slice(0, 8).map((event) => event.id);
    qualityLedgerRef.totalSchemaGovernanceEventCount = input.schemaGovernanceEvents.length;
  }
  return qualityLedgerRef;
}

function buildExportArtifactSummary(input: {
  exportJob: ExportJob;
  recordCount: number;
  warningCount: number;
  passportCount: number;
  passportBatchHash: string | undefined;
  generatedAt: string;
}): ExportArtifactSummary {
  const summary: ExportArtifactSummary = {
    exportId: input.exportJob.id,
    taskId: input.exportJob.taskId,
    format: input.exportJob.mapping.format,
    recordCount: input.recordCount,
    warningCount: input.warningCount,
    passportCount: input.passportCount,
    createdAt: input.generatedAt,
  };
  if (input.exportJob.schemaVersionId !== undefined) summary.schemaVersionId = input.exportJob.schemaVersionId;
  if (input.passportBatchHash !== undefined) summary.passportBatchHash = input.passportBatchHash;
  if (input.exportJob.fileId !== undefined) summary.fileId = input.exportJob.fileId;
  return summary;
}

function buildExportRecordMetadata(input: {
  exportJob: ExportJob;
  rowCount: number;
  warningCount: number;
  checksum: string | undefined;
  exportedAt: string;
}): ExportRecordMetadata {
  const metadata: ExportRecordMetadata = {
    exportId: input.exportJob.id,
    exportMode: input.exportJob.mapping.exportMode ?? "VERSIONED",
    includedSchemaVersionIds: input.exportJob.mapping.includedSchemaVersionIds ?? [input.exportJob.schemaVersionId],
    exportedBy: input.exportJob.createdBy,
    exportedAt: input.exportedAt,
    rowCount: input.rowCount,
    warningCount: input.warningCount,
  };
  if (input.exportJob.mapping.targetSchemaVersionId !== undefined) metadata.targetSchemaVersionId = input.exportJob.mapping.targetSchemaVersionId;
  if (input.exportJob.mapping.migrationId !== undefined) metadata.migrationId = input.exportJob.mapping.migrationId;
  if (input.checksum !== undefined) metadata.checksum = input.checksum;
  return metadata;
}

function upsertExportArtifact(artifact: MockExportArtifact): void {
  mockDb.exportArtifacts = mockDb.exportArtifacts.filter((item) => item.summary.exportId !== artifact.summary.exportId);
  mockDb.exportArtifacts.push(artifact);
}

function appendDataQualityPassportGeneratedAudit(summary: ExportArtifactSummary): void {
  if (summary.passportBatchHash === undefined) {
    console.warn("质量护照批次 hash 缺失，跳过 DATA_QUALITY_PASSPORT_GENERATED 审计事件。");
    return;
  }
  const target: AppendAuditEventRequest["target"] = {
    entityType: "EXPORT",
    entityId: summary.exportId,
    taskId: summary.taskId,
    exportId: summary.exportId,
  };
  if (summary.schemaVersionId !== undefined) target.schemaVersionId = summary.schemaVersionId;

  appendAuditEvent({
    type: "DATA_QUALITY_PASSPORT_GENERATED",
    severity: summary.warningCount > 0 ? "WARNING" : "INFO",
    source: "SYSTEM",
    actor: {
      id: "mock-export-worker",
      role: "SYSTEM",
      displayName: "Mock Export Worker",
    },
    target,
    payload: {
      exportId: summary.exportId,
      passportCount: summary.passportCount ?? 0,
      passportBatchHash: summary.passportBatchHash,
      warningCount: summary.warningCount,
    },
    idempotencyKey: `DATA_QUALITY_PASSPORT:${summary.exportId}:GENERATED`,
  });
}

function applyReviewPatches(answers: AnswerPayload, patches: ReviewPatch[]): Record<string, unknown> {
  const finalAnswers: Record<string, unknown> = { ...answers };
  for (const patch of patches) {
    if (patch.nextValue === undefined) {
      delete finalAnswers[patch.fieldName];
      continue;
    }
    finalAnswers[patch.fieldName] = patch.nextValue;
  }
  return finalAnswers;
}

function findLatestReviewPatches(submissionId: string): ReviewPatch[] {
  for (let index = mockDb.reviewResults.length - 1; index >= 0; index -= 1) {
    const reviewResult = mockDb.reviewResults[index];
    if (reviewResult.submissionId !== submissionId || reviewResult.stage === "AI_PRECHECK") continue;
    if (reviewResult.patches !== undefined && reviewResult.patches.length > 0) {
      return reviewResult.patches;
    }
  }
  return [];
}

function getLatestReviewDiffSummary(submissionId: string): { patchCount: number; patchedFieldNames: string[] } {
  const reviewDiffEvent = findLatestAuditEvent(
    mockDb.auditEvents.filter((event) => event.target.submissionId === submissionId),
    "REVIEW_DIFF_GENERATED",
  );
  const payload = getAuditPayloadRecord(reviewDiffEvent);
  const patchedFieldNames = Array.isArray(payload?.patchedFieldNames) ? payload.patchedFieldNames.filter((fieldName): fieldName is string => typeof fieldName === "string") : [];
  const patchCount = typeof payload?.patchCount === "number" ? payload.patchCount : patchedFieldNames.length;
  return { patchCount, patchedFieldNames };
}

function inferPassportReviewStatus(submission: Submission): DataQualityPassport["reviewStatus"] {
  const latestReview = findLatestHumanReviewResult(submission.id);
  if (submission.status === "ACCEPTED" || latestReview?.decision === "PASS") return "APPROVED";
  if (submission.status === "RETURNED" || latestReview?.decision === "RETURN") return "RETURNED";
  if (submission.status === "REJECTED" || latestReview?.decision === "REJECT") return "REJECTED";
  return "UNREVIEWED";
}

function findLatestHumanReviewResult(submissionId: string): HumanReviewResultRecord | FinalReviewResultRecord | undefined {
  for (let index = mockDb.reviewResults.length - 1; index >= 0; index -= 1) {
    const reviewResult = mockDb.reviewResults[index];
    if (reviewResult.submissionId === submissionId && reviewResult.stage !== "AI_PRECHECK") {
      return reviewResult;
    }
  }
  return undefined;
}

function findRelatedAuditEvents(submission: Submission, exportId: string): AuditEventRecord[] {
  return mockDb.auditEvents.filter((event) => {
    const target = event.target;
    if (target.submissionId === submission.id) return true;
    if (target.assignmentId === submission.assignmentId) return true;
    if (target.exportId === exportId) return true;
    return target.taskId === submission.taskId && isSchemaGovernanceAuditType(event.type);
  });
}

function findLatestAuditEvent(events: AuditEventRecord[], type: AuditEventRecord["type"]): AuditEventRecord | undefined {
  return events
    .filter((event) => event.type === type)
    .sort(compareAuditEventsDesc)
    .at(0);
}

function countAuditEvents(events: AuditEventRecord[], type: AuditEventRecord["type"]): number {
  return events.filter((event) => event.type === type).length;
}

function getAuditPayloadRecord(event: AuditEventRecord | undefined): Record<string, unknown> | undefined {
  return isRecord(event?.payload) ? event.payload : undefined;
}

function extractRiskCodes(labelingEvent: AuditEventRecord | undefined): RiskSignalCode[] {
  const payload = getAuditPayloadRecord(labelingEvent);
  if (!Array.isArray(payload?.riskSignals)) return [];
  return payload.riskSignals.filter(isRiskSignalCode);
}

function isRiskSignalCode(value: unknown): value is RiskSignalCode {
  return (
    value === "FAST_SUBMIT" ||
    value === "LOW_ACTIVE_TIME" ||
    value === "HIGH_PASTE_COUNT" ||
    value === "LOW_FIELD_CHANGE_COUNT" ||
    value === "REPEATED_ANSWER_HASH" ||
    value === "HIGH_FOCUS_LOSS_COUNT" ||
    value === "SCRIPT_LIKE_SUBMISSION_PATTERN" ||
    value === "CLIENT_TIME_DRIFT"
  );
}

function isSchemaGovernanceAuditType(type: AuditEventRecord["type"]): boolean {
  return [
    "SCHEMA_DRAFT_SAVED",
    "SCHEMA_PUBLISH_REQUESTED",
    "SCHEMA_COMPATIBILITY_CHECKED",
    "SCHEMA_PUBLISH_BLOCKED",
    "SCHEMA_PUBLISH_FAILED",
    "SCHEMA_VERSION_PUBLISHED",
    "DEPRECATION_WARNING_GENERATED",
    "MIGRATION_PLAN_CREATED",
    "MIGRATION_DRY_RUN_COMPLETED",
    "MIGRATION_EXECUTED",
  ].includes(type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
