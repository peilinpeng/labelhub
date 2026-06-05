import { describe, test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import type {
  AiAssistOutcomeAuditPayload,
  AiReviewGeneratedAuditPayload,
  AppendAuditEventRequest,
  AuditEventType,
  AuditEventQuery,
  AuditEventRecord,
  DataQualityPassportGeneratedAuditPayload,
  ExportGeneratedAuditPayload,
  FormAbandonedAuditPayload,
  LabelerRiskSignalGeneratedAuditPayload,
  LabelingSessionSummaryAuditPayload,
  MigrationExecutedAuditPayload,
  ReviewDiffGeneratedAuditPayload,
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

  test("可以构造 LABELING_SESSION_SUMMARY payload，且不保存完整 answers", () => {
    const payload = {
      taskId: "task_news",
      assignmentId: "asn_news_1",
      labelerId: "usr_labeler",
      schemaVersionId: "sv_news_1",
      clientStartedAt: "2026-06-05T00:00:00.000Z",
      clientSubmittedAt: "2026-06-05T00:04:00.000Z",
      totalWallTimeMs: 240000,
      activeTimeMs: 180000,
      idleTimeMs: 60000,
      blurCount: 1,
      focusLossCount: 1,
      pasteCount: 0,
      changedFieldCount: 4,
      fieldEditCount: 7,
      riskSignals: [],
      answerHash: "sha256:answers",
    } satisfies LabelingSessionSummaryAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_labeling_session_1",
      type: "LABELING_SESSION_SUMMARY",
      severity: "INFO",
      source: "WEB",
      actor: {
        id: "usr_labeler",
        role: "LABELER",
        displayName: "Labeler",
      },
      target: {
        entityType: "ASSIGNMENT",
        entityId: "asn_news_1",
        taskId: "task_news",
        assignmentId: "asn_news_1",
        schemaVersionId: "sv_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:04:00.000Z",
    };

    equal(event.type, "LABELING_SESSION_SUMMARY");
    equal(Object.keys(payload).includes("answers"), false);
  });

  test("可以构造 FORM_ABANDONED payload", () => {
    const payload = {
      taskId: "task_news",
      assignmentId: "asn_news_1",
      labelerId: "usr_labeler",
      schemaVersionId: "sv_news_1",
      totalWallTimeMs: 120000,
      activeTimeMs: 45000,
      idleTimeMs: 75000,
      changedFieldCount: 2,
      riskSignals: ["LOW_ACTIVE_TIME"],
      reason: "PAGE_HIDDEN",
    } satisfies FormAbandonedAuditPayload;

    const request: AppendAuditEventRequest = {
      type: "FORM_ABANDONED",
      severity: "WARNING",
      source: "WEB",
      actor: {
        id: "usr_labeler",
        role: "LABELER",
      },
      target: {
        entityType: "ASSIGNMENT",
        entityId: "asn_news_1",
        taskId: "task_news",
        assignmentId: "asn_news_1",
      },
      payload,
      idempotencyKey: "LABELING:asn_news_1:FORM_ABANDONED:sess_1",
    };

    equal(request.type, "FORM_ABANDONED");
    deepEqual(payload.riskSignals, ["LOW_ACTIVE_TIME"]);
  });

  test("可以构造 LABELER_RISK_SIGNAL_GENERATED payload", () => {
    const payload = {
      taskId: "task_news",
      assignmentId: "asn_news_1",
      labelerId: "usr_labeler",
      riskSignals: ["FAST_SUBMIT", "CLIENT_TIME_DRIFT"],
      clientRiskSignals: ["FAST_SUBMIT"],
      serverRiskSignals: ["FAST_SUBMIT", "CLIENT_TIME_DRIFT"],
      activeTimeMs: 900,
      totalWallTimeMs: 1200,
      serverElapsedMs: 5000,
    } satisfies LabelerRiskSignalGeneratedAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_risk_signal_1",
      type: "LABELER_RISK_SIGNAL_GENERATED",
      severity: "WARNING",
      source: "API",
      actor: {
        id: "usr_system",
        role: "SYSTEM",
      },
      target: {
        entityType: "ASSIGNMENT",
        entityId: "asn_news_1",
        taskId: "task_news",
        assignmentId: "asn_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:04:00.000Z",
    };

    equal(event.type, "LABELER_RISK_SIGNAL_GENERATED");
    equal(payload.riskSignals.includes("CLIENT_TIME_DRIFT"), true);
  });

  test("可以构造 REVIEW_DIFF_GENERATED payload", () => {
    const payload = {
      taskId: "task_news",
      submissionId: "sub_news_1",
      reviewId: "rev_news_1",
      reviewerId: "usr_reviewer",
      labelerId: "usr_labeler",
      schemaVersionId: "sv_news_1",
      decision: "APPROVED_WITH_CHANGES",
      patchedFieldNames: ["summary", "qualityRating"],
      patchCount: 2,
      majorPatchCount: 1,
      minorPatchCount: 1,
      reasonCode: "QUALITY_FIX",
      beforeAnswerHash: "sha256:before",
      afterAnswerHash: "sha256:after",
      diffSummaryHash: "sha256:diff",
      reviewDurationMs: 180000,
      diffMode: "FRONTEND_SHALLOW",
    } satisfies ReviewDiffGeneratedAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_review_diff_1",
      type: "REVIEW_DIFF_GENERATED",
      severity: "INFO",
      source: "WEB",
      actor: {
        id: "usr_reviewer",
        role: "REVIEWER",
      },
      target: {
        entityType: "REVIEW",
        entityId: "rev_news_1",
        taskId: "task_news",
        submissionId: "sub_news_1",
        reviewId: "rev_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:04:00.000Z",
    };

    equal(event.type, "REVIEW_DIFF_GENERATED");
    equal(Object.keys(payload).includes("answers"), false);
  });

  test("可以构造 AI_ASSIST_ACCEPTED / AI_ASSIST_EDITED payload，且不保存 prompt 或 raw output", () => {
    const payload = {
      taskId: "task_news",
      assignmentId: "asn_news_1",
      schemaVersionId: "sv_news_1",
      nodeId: "node_ai_summary",
      fieldName: "summary",
      promptVersionId: "prompt_v1",
      modelId: "model_demo",
      assistType: "SUMMARY",
      triggeredCount: 1,
      acceptedCount: 1,
      editedCount: 1,
      averageLatencyMs: 900,
      outputHash: "sha256:ai-output",
      promptSnapshotHash: "sha256:prompt",
    } satisfies AiAssistOutcomeAuditPayload;

    const acceptedEvent: AuditEventRecord = {
      id: "audit_ai_assist_1",
      type: "AI_ASSIST_ACCEPTED",
      severity: "INFO",
      source: "WEB",
      actor: {
        id: "usr_labeler",
        role: "LABELER",
      },
      target: {
        entityType: "ASSIGNMENT",
        entityId: "asn_news_1",
        taskId: "task_news",
        assignmentId: "asn_news_1",
      },
      payload,
      createdAt: "2026-06-05T00:04:00.000Z",
    };

    const editedType: AuditEventType = "AI_ASSIST_EDITED";

    equal(acceptedEvent.type, "AI_ASSIST_ACCEPTED");
    equal(editedType, "AI_ASSIST_EDITED");
    equal(Object.keys(payload).includes("prompt"), false);
    equal(Object.keys(payload).includes("rawOutput"), false);
  });

  test("可以构造 DATA_QUALITY_PASSPORT_GENERATED payload", () => {
    const payload = {
      exportId: "job_export_1",
      passportCount: 128,
      passportBatchHash: "sha256:passport-batch",
      warningCount: 1,
    } satisfies DataQualityPassportGeneratedAuditPayload;

    const event: AuditEventRecord = {
      id: "audit_passport_1",
      type: "DATA_QUALITY_PASSPORT_GENERATED",
      severity: "INFO",
      source: "WORKER",
      actor: baseActor,
      target: {
        entityType: "EXPORT",
        entityId: "job_export_1",
        taskId: "task_news",
        exportId: "job_export_1",
      },
      payload,
      createdAt: "2026-06-05T00:04:00.000Z",
    };

    equal(event.type, "DATA_QUALITY_PASSPORT_GENERATED");
    equal(payload.passportCount, 128);
  });

  test("AI Review reviewer feedback 使用统一命名", () => {
    const confirmed: AuditEventType = "AI_REVIEW_CONFIRMED_BY_REVIEWER";
    const rejected: AuditEventType = "AI_REVIEW_REJECTED_BY_REVIEWER";

    equal(confirmed, "AI_REVIEW_CONFIRMED_BY_REVIEWER");
    equal(rejected, "AI_REVIEW_REJECTED_BY_REVIEWER");
  });

  test("旧 AI Review reviewer feedback 命名不属于 AuditEventType", () => {
    // @ts-expect-error 旧命名不属于 AuditEventType。
    const oldConfirmed: AuditEventType = "REVIEWER_CONFIRMED_AI_OUTPUT";
    // @ts-expect-error 旧命名不属于 AuditEventType。
    const oldRejected: AuditEventType = "REVIEWER_REJECTED_AI_OUTPUT";

    equal(typeof oldConfirmed, "string");
    equal(typeof oldRejected, "string");
  });
});
