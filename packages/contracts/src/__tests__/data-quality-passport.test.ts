import { describe, test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import type {
  AuditEventRecord,
  DataQualityPassport,
  DataQualityPassportAnswerHashAlgorithm,
  DataQualityPassportGeneratedAuditPayload,
  DataQualityPassportQualityLedgerRef,
  ExportArtifactSummary,
  ExportJob,
  ExportRecord,
  GetExportArtifactRecordsResponse,
} from "../index";

// @ts-expect-error 不应新增与 AuditEventRecord 平行的 Ledger 事件类型。
import type { QualityLedgerEvent } from "../index";

describe("Data Quality Passport 契约", () => {
  test("可以构造最小 DataQualityPassport", () => {
    const passport = {
      submissionId: "sub_news_1",
      schemaVersionId: "sv_news_1",
      reviewStatus: "UNREVIEWED",
    } satisfies DataQualityPassport;

    equal(passport.submissionId, "sub_news_1");
    equal(passport.reviewStatus, "UNREVIEWED");
    equal(Object.keys(passport).includes("answers"), false);
  });

  test("可以构造带 hash、trust、risk 和 AI 计数的 DataQualityPassport", () => {
    const algorithm: DataQualityPassportAnswerHashAlgorithm = "canonical-json-v1+SHA-256";
    const passport = {
      submissionId: "sub_news_2",
      schemaVersionId: "sv_news_1",
      finalAnswerHash: "sha256:final-answer",
      answerHashAlgorithm: algorithm,
      labelerTrustLevel: "MEDIUM",
      trustLevelSnapshotAt: "2026-06-06T00:00:00.000Z",
      reviewStatus: "APPROVED",
      reviewerPatchCount: 2,
      changedFieldNames: ["summary", "qualityRating"],
      aiAssistUsed: true,
      aiAcceptedCount: 1,
      aiDismissedCount: 0,
      aiEditedCount: 1,
      riskCodes: ["FAST_SUBMIT"],
      auditEventCount: 8,
    } satisfies DataQualityPassport;

    equal(passport.answerHashAlgorithm, "canonical-json-v1+SHA-256");
    equal(passport.labelerTrustLevel, "MEDIUM");
    deepEqual(passport.changedFieldNames, ["summary", "qualityRating"]);
    equal(Object.keys(passport).includes("sourcePayload"), false);
    equal(Object.keys(passport).includes("prompt"), false);
  });

  test("可以构造 DataQualityPassportQualityLedgerRef 并表达 Schema Governance 总数", () => {
    const ref = {
      labelingEventId: "audit_labeling_1",
      reviewEventId: "audit_review_1",
      reviewDiffEventId: "audit_review_diff_1",
      exportEventId: "audit_export_1",
      aiAssistEventIds: ["audit_ai_assist_1"],
      aiReviewEventIds: ["audit_ai_review_1"],
      schemaGovernanceEventIds: ["audit_schema_1", "audit_schema_2"],
      totalSchemaGovernanceEventCount: 12,
    } satisfies DataQualityPassportQualityLedgerRef;

    equal(ref.schemaGovernanceEventIds?.length, 2);
    equal(ref.totalSchemaGovernanceEventCount, 12);
  });

  test("可以构造带 passport 的 ExportRecord", () => {
    const record = {
      exportId: "job_export_1",
      submissionId: "sub_news_1",
      schemaVersionId: "sv_news_1",
      recordIndex: 0,
      data: {
        summary: "导出摘要",
        qualityRating: "pass",
      },
      passport: {
        submissionId: "sub_news_1",
        schemaVersionId: "sv_news_1",
        finalAnswerHash: "sha256:final-answer",
        answerHashAlgorithm: "canonical-json-v1+SHA-256",
        reviewStatus: "APPROVED",
      },
    } satisfies ExportRecord;

    equal(record.exportId, "job_export_1");
    equal(record.passport?.finalAnswerHash, "sha256:final-answer");
  });

  test("可以构造 ExportArtifactSummary", () => {
    const summary = {
      exportId: "job_export_1",
      taskId: "task_news",
      format: "JSONL",
      schemaVersionId: "sv_news_1",
      recordCount: 128,
      warningCount: 1,
      passportCount: 128,
      passportBatchHash: "sha256:passport-batch",
      createdAt: "2026-06-06T00:00:00.000Z",
      fileId: "file_export_1",
    } satisfies ExportArtifactSummary;

    equal(summary.format, "JSONL");
    equal(summary.passportCount, 128);
  });

  test("可以构造 export artifact records 查询响应", () => {
    const response = {
      exportId: "job_export_1",
      records: [
        {
          exportId: "job_export_1",
          submissionId: "sub_news_1",
          schemaVersionId: "sv_news_1",
          recordIndex: 0,
          data: {
            summary: "导出摘要",
          },
        },
      ],
      artifactSummary: {
        exportId: "job_export_1",
        taskId: "task_news",
        format: "JSON",
        recordCount: 1,
        warningCount: 0,
        createdAt: "2026-06-06T00:00:00.000Z",
      },
    } satisfies GetExportArtifactRecordsResponse;

    equal(response.records.length, 1);
    equal(response.artifactSummary?.recordCount, 1);
  });

  test("可以构造 DATA_QUALITY_PASSPORT_GENERATED audit payload，且不包含 Passport 全文", () => {
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
      actor: {
        id: "usr_system",
        role: "SYSTEM",
      },
      target: {
        entityType: "EXPORT",
        entityId: "job_export_1",
        taskId: "task_news",
        exportId: "job_export_1",
      },
      payload,
      createdAt: "2026-06-06T00:00:00.000Z",
    };

    equal(event.type, "DATA_QUALITY_PASSPORT_GENERATED");
    equal(Object.keys(payload).includes("passport"), false);
    equal(Object.keys(payload).includes("records"), false);
  });

  test("ExportJob 仍可按旧字段构造，保持向后兼容", () => {
    const job: ExportJob = {
      id: "job_export_legacy",
      taskId: "task_news",
      schemaVersionId: "sv_news_1",
      status: "PENDING",
      mapping: {
        schemaVersionId: "sv_news_1",
        format: "JSONL",
        answerSource: "ORIGINAL_ANSWERS",
        includeReviewRecords: true,
        columns: [{ header: "摘要", sourcePath: "$.answers.summary" }],
      },
      progress: {
        total: 10,
        done: 0,
      },
      createdBy: "usr_owner",
      createdAt: "2026-06-06T00:00:00.000Z",
    };

    equal(job.artifactSummary, undefined);
    equal(job.status, "PENDING");
  });

  test("没有新增 QualityLedgerEvent 平行类型", () => {
    const typeName = "QualityLedgerEvent" satisfies string;

    equal(typeName, "QualityLedgerEvent");
  });
});
