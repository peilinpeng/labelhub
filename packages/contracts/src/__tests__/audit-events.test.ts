import { describe, test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import type {
  AiReviewGeneratedAuditPayload,
  AppendAuditEventRequest,
  AuditEventQuery,
  AuditEventRecord,
  ExportGeneratedAuditPayload,
  MigrationExecutedAuditPayload,
  SchemaCompatibilityCheckedAuditPayload,
  SchemaPublishBlockedAuditPayload,
  SubmissionAuditPayload,
} from "../index";

const baseActor = {
  id: "usr_owner",
  role: "OWNER",
  displayName: "Owner",
};

describe("Audit Event 共享类型", () => {
  test("可以构造 SCHEMA_COMPATIBILITY_CHECKED event", () => {
    const payload = {
      compatible: false,
      publishAllowed: false,
      requiresApproval: true,
      requiresMigration: true,
      changeCodes: ["FIELD_REMOVED"],
      blockingCount: 1,
      warningCount: 2,
      reportChecksum: "sha256:compatibility",
    } satisfies SchemaCompatibilityCheckedAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_schema_compatibility_1",
      type: "SCHEMA_COMPATIBILITY_CHECKED",
      severity: "WARNING",
      source: "WEB",
      actor: baseActor,
      target: {
        entityType: "SCHEMA",
        entityId: "schema_news",
        taskId: "task_news",
        schemaVersionId: "sv_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:00:00.000Z",
    };

    equal(event.type, "SCHEMA_COMPATIBILITY_CHECKED");
    equal(event.target.entityType, "SCHEMA");
    equal(payload.blockingCount, 1);
  });

  test("可以构造 SCHEMA_PUBLISH_BLOCKED event", () => {
    const payload = {
      blockingChangeCodes: ["FIELD_REMOVED"],
      deprecationErrorCodes: ["DEPRECATED_FIELD_REPLACEMENT_NOT_FOUND"],
      schemaValidationErrorCount: 1,
    } satisfies SchemaPublishBlockedAuditPayload;

    const request: AppendAuditEventRequest = {
      type: "SCHEMA_PUBLISH_BLOCKED",
      severity: "ERROR",
      source: "WEB",
      actor: baseActor,
      target: {
        entityType: "SCHEMA",
        entityId: "schema_news",
        taskId: "task_news",
      },
      payload,
      requestId: "req_publish_blocked",
    };

    equal(request.type, "SCHEMA_PUBLISH_BLOCKED");
    deepEqual(payload.blockingChangeCodes, ["FIELD_REMOVED"]);
  });

  test("可以构造 MIGRATION_EXECUTED event", () => {
    const payload = {
      operationCount: 4,
      migratedCount: 20,
      skippedCount: 2,
      conflictCount: 0,
      executionChecksum: "sha256:migration",
    } satisfies MigrationExecutedAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_migration_1",
      type: "MIGRATION_EXECUTED",
      severity: "INFO",
      source: "WORKER",
      actor: {
        id: "usr_system",
        role: "SYSTEM",
        displayName: "Migration Worker",
      },
      target: {
        entityType: "MIGRATION",
        entityId: "migration_plan_1",
        migrationPlanId: "migration_plan_1",
        schemaVersionId: "sv_news_2",
      },
      payload,
      checksum: "sha256:event",
      createdAt: "2026-06-05T00:00:00.000Z",
    };

    equal(event.payload, payload);
    equal(payload.conflictCount, 0);
  });

  test("可以构造 SUBMISSION_CREATED / SUBMISSION_UPDATED event，payload 使用 answerHash", () => {
    const payload = {
      schemaVersionId: "sv_news_1",
      answerHash: "sha256:answers",
      changedFieldNames: ["summary"],
      validationErrorCount: 0,
      attemptNo: 2,
    } satisfies SubmissionAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_submission_1",
      type: "SUBMISSION_CREATED",
      severity: "INFO",
      source: "API",
      actor: {
        id: "usr_labeler",
        role: "LABELER",
        displayName: "Labeler",
      },
      target: {
        entityType: "SUBMISSION",
        entityId: "sub_news_1",
        taskId: "task_news",
        assignmentId: "asn_news_1",
        submissionId: "sub_news_1",
        schemaVersionId: "sv_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:00:00.000Z",
    };

    equal(event.type, "SUBMISSION_CREATED");
    equal(Object.keys(payload).includes("answers"), false);
  });

  test("可以构造 AI_REVIEW_GENERATED event，payload 使用 outputHash", () => {
    const payload = {
      aiReviewJobId: "job_ai_review_1",
      decision: "PASS",
      score: 91,
      confidence: 0.87,
      issueCount: 0,
      outputHash: "sha256:ai-output",
      promptSnapshotHash: "sha256:prompt",
    } satisfies AiReviewGeneratedAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_ai_review_1",
      type: "AI_REVIEW_GENERATED",
      severity: "INFO",
      source: "AI_AGENT",
      actor: {
        id: "usr_system",
        role: "SYSTEM",
        displayName: "AI Review Agent",
      },
      target: {
        entityType: "AI_REVIEW_JOB",
        entityId: "job_ai_review_1",
        submissionId: "sub_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:00:00.000Z",
    };

    equal(event.type, "AI_REVIEW_GENERATED");
    equal(Object.keys(payload).includes("rawOutput"), false);
  });

  test("可以构造 EXPORT_GENERATED event", () => {
    const payload = {
      exportId: "job_export_1",
      format: "JSONL",
      rowCount: 128,
      warningCount: 1,
      mappingChecksum: "sha256:mapping",
    } satisfies ExportGeneratedAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_export_1",
      type: "EXPORT_GENERATED",
      severity: "INFO",
      source: "WORKER",
      actor: baseActor,
      target: {
        entityType: "EXPORT",
        entityId: "job_export_1",
        taskId: "task_news",
        exportId: "job_export_1",
        schemaVersionId: "sv_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:00:00.000Z",
    };

    equal(event.type, "EXPORT_GENERATED");
    equal(payload.rowCount, 128);
  });

  test("可以构造 AuditEventQuery，按 task / entity / type / severity 过滤", () => {
    const query: AuditEventQuery = {
      taskId: "task_news",
      entityType: "SCHEMA",
      entityId: "schema_news",
      types: ["SCHEMA_COMPATIBILITY_CHECKED", "SCHEMA_PUBLISH_BLOCKED"],
      severities: ["WARNING", "ERROR"],
      source: "WEB",
      createdFrom: "2026-06-01T00:00:00.000Z",
      createdTo: "2026-06-05T23:59:59.999Z",
      limit: 50,
    };

    equal(query.entityType, "SCHEMA");
    equal(query.types?.length, 2);
    equal(query.severities?.includes("ERROR"), true);
  });
});
