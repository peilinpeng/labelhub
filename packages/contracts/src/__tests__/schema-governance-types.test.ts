import { describe, test } from "node:test";
import { equal, ok } from "node:assert/strict";
import type {
  ChecksumInputEnvelope,
  CompatibilityLevel,
  CompatibilityReport,
  ExportMapping,
  FieldNode,
  FieldLinkageRule,
  MigrationExecutionResult,
  MigrationPlan,
  RuntimeContextWithOutput,
} from "../index";
import { baseContext } from "./fixtures";

describe("Schema Version Management 类型契约", () => {
  test("FieldNode.deprecation 可以被合法赋值", () => {
    const field: FieldNode = {
      id: "field_deprecated_comment",
      kind: "FIELD",
      type: "input.text",
      title: "旧备注",
      name: "oldComment",
      deprecation: {
        deprecated: true,
        reason: "请使用 reviewComment",
        replacementFieldName: "reviewComment",
        hideForNewSubmissions: true,
        plannedRemovalSchemaVersionNo: 3,
      },
    };

    equal(field.deprecation?.deprecated, true);
    equal(field.deprecation?.replacementFieldName, "reviewComment");
  });

  test("FieldNode.linkageRules 可以表达字段名目标和静态 effect", () => {
    const rule: FieldLinkageRule = {
      id: "R-review-reject-reason",
      when: {
        op: "eq",
        left: { kind: "path", path: "$.answers.reviewResult" },
        right: { kind: "literal", value: "reject" },
      },
      effects: [
        {
          action: "setVisible",
          target: "rejectReason",
          value: true,
        },
        {
          action: "setRequired",
          target: "rejectReason",
          value: true,
        },
        {
          action: "setOptions",
          target: "rejectReasonCategory",
          options: [{ label: "事实问题", value: "fact_issue" }],
        },
        {
          action: "setValue",
          target: "reviewStatus",
          value: "needs_reason",
        },
      ],
      otherwise: [
        {
          action: "clearValue",
          target: "rejectReason",
        },
      ],
    };
    const field: FieldNode = {
      id: "review_result",
      kind: "FIELD",
      type: "choice.radio",
      title: "审核结果",
      name: "reviewResult",
      options: [
        { label: "通过", value: "pass" },
        { label: "退回", value: "reject" },
      ],
      linkageRules: [rule],
    };

    equal(field.linkageRules?.[0]?.effects[0]?.target, "rejectReason");
    equal(field.linkageRules?.[0]?.effects[2]?.action, "setOptions");
  });

  test("RuntimeContextWithOutput.visibilityMode 可以被合法赋值", () => {
    const context: RuntimeContextWithOutput = {
      ...baseContext,
      output: {
        summary: "AI 输出",
      },
      visibilityMode: "HISTORICAL",
    };

    equal(context.visibilityMode, "HISTORICAL");
    equal(typeof context.output, "object");
  });

  test("CompatibilityReport 可以表达所有兼容性等级", () => {
    const levels: CompatibilityLevel[] = [
      "SAFE",
      "NEEDS_APPROVAL",
      "BREAKING",
      "MIGRATION_REQUIRED",
    ];
    const report: CompatibilityReport = {
      compatible: false,
      publishAllowed: false,
      requiresApproval: true,
      requiresMigration: true,
      changes: levels.map((level) => ({
        code: `CHANGE_${level}`,
        level,
        message: `检测到 ${level}`,
      })),
      blockingChanges: [
        {
          code: "FIELD_REMOVED",
          level: "BREAKING",
          fieldName: "summary",
          message: "字段被删除",
        },
      ],
      warnings: [
        {
          code: "REQUIRED_TIGHTENED",
          level: "NEEDS_APPROVAL",
          fieldName: "summary",
          message: "required: false → true",
        },
      ],
      recommendations: ["发布前需要管理员确认"],
    };

    equal(report.changes.length, 4);
    equal(report.warnings[0]?.level, "NEEDS_APPROVAL");
  });

  test("MigrationPlan 可以包含未 resolved 的 ManualMappingSlot", () => {
    const plan: MigrationPlan = {
      fromSchemaVersionId: "sv_news_quality_1",
      toSchemaVersionId: "sv_news_quality_2",
      operations: [
        {
          op: "REQUIRE_MANUAL_MAPPING",
          fromFieldName: "summary",
          candidateFieldNames: ["newsSummary"],
          reason: "无法自动判断字段改名",
        },
      ],
      manualMappingSlots: [
        {
          slotId: "slot_summary_mapping",
          kind: "FIELD_RENAME",
          fromFieldName: "summary",
          candidateFieldNames: ["newsSummary"],
          reason: "需要管理员确认字段映射",
          required: true,
          resolved: false,
        },
      ],
      executable: false,
      blockingIssues: ["存在未补全的字段映射"],
      warnings: [],
      checksumInput: {
        fromSchemaVersionId: "sv_news_quality_1",
        toSchemaVersionId: "sv_news_quality_2",
      },
      canonicalSerializationVersion: "canonical-json-v1",
    };

    equal(plan.executable, false);
    equal(plan.manualMappingSlots[0]?.resolved, false);
  });

  test("MigrationExecutionResult 可以包含 skippedSubmissions 和 conflictCount", () => {
    const result: MigrationExecutionResult = {
      migratedSubmissions: [
        {
          submissionId: "sub_migrated_1",
          fromSchemaVersionId: "sv_news_quality_1",
          toSchemaVersionId: "sv_news_quality_2",
          answers: {
            newsSummary: "迁移后的摘要",
          },
          archivedAnswers: {
            oldComment: "旧备注",
          },
          expectedVersion: 1,
        },
      ],
      skippedSubmissions: [
        {
          submissionId: "sub_conflict_1",
          reason: "CONFLICT",
          expectedVersion: 1,
          actualVersion: 2,
          message: "提交已被其他流程更新",
        },
      ],
      conflictCount: 1,
      recordDraft: {
        operationCount: 2,
        migratedCount: 1,
        skippedCount: 1,
        conflictCount: 1,
        generatedAt: "2026-05-24T00:00:00.000Z",
        checksumInput: {
          migrationPlanId: "plan_1",
        },
        canonicalSerializationVersion: "canonical-json-v1",
      },
    };

    equal(result.conflictCount, 1);
    equal(result.skippedSubmissions[0]?.reason, "CONFLICT");
  });

  test("ExportMapping 可以携带版本治理配置", () => {
    const mapping: ExportMapping = {
      schemaVersionId: "sv_news_quality_2",
      format: "CSV",
      answerSource: "ORIGINAL_ANSWERS",
      includeReviewRecords: true,
      columns: [{ header: "摘要", sourcePath: "$.answers.newsSummary" }],
      exportMode: "UNIFIED",
      targetSchemaVersionId: "sv_news_quality_2",
      includedSchemaVersionIds: ["sv_news_quality_1", "sv_news_quality_2"],
      migrationId: "job_migration_1",
      fieldMappings: [
        {
          fromSchemaVersionId: "sv_news_quality_1",
          toSchemaVersionId: "sv_news_quality_2",
          fromFieldName: "summary",
          toFieldName: "newsSummary",
          operation: "RENAME_FIELD",
        },
      ],
    };

    equal(mapping.exportMode, "UNIFIED");
    equal(mapping.fieldMappings?.[0]?.operation, "RENAME_FIELD");
  });

  test("ChecksumInputEnvelope 可以表达 canonical-json-v1 和 SHA-256", () => {
    const envelope: ChecksumInputEnvelope = {
      canonicalSerializationVersion: "canonical-json-v1",
      checksumAlgorithm: "SHA-256",
      checksumInput: {
        planId: "plan_1",
      },
    };

    equal(envelope.canonicalSerializationVersion, "canonical-json-v1");
    ok(envelope.checksumInput);
  });
});
