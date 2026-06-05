import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  ChoiceFieldNode,
  FieldNode,
  LabelHubSchema,
  MigrationOperation,
  MigrationPlan,
  MigrationSubmissionInput,
} from "@labelhub/contracts";
import {
  createMigrationPlan,
  dryRunMigration,
  executeMigrationPlan,
} from "../index.ts";

describe("Migration Plan", () => {
  test("识别 KEEP_FIELD", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema));

    ok(hasOperation(plan, "KEEP_FIELD", "summary"));
    equal(plan.executable, true);
  });

  test("显式 renameMap 生成 RENAME_FIELD", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    addField(newSchema, textareaField("newsSummary", false));

    const plan = createMigrationPlan(oldSchema, newSchema, {
      renameMap: { summary: "newsSummary" },
    });

    ok(plan.operations.some((operation) => operation.op === "RENAME_FIELD" && operation.from === "summary" && operation.to === "newsSummary"));
    equal(plan.executable, true);
  });

  test("无 renameMap 时输出 ManualMappingSlot，不自动猜字段改名", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    addField(newSchema, textareaField("newsSummary", false));

    const plan = createMigrationPlan(oldSchema, newSchema);

    ok(plan.manualMappingSlots.some((slot) => slot.kind === "FIELD_RENAME" && slot.fromFieldName === "summary"));
    ok(plan.operations.some((operation) => operation.op === "REQUIRE_MANUAL_MAPPING" && operation.fromFieldName === "summary"));
    equal(plan.executable, false);
  });

  test("未 resolved 的 ManualMappingSlot 使 plan.executable = false", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");
    const plan = createMigrationPlan(oldSchema, newSchema);

    equal(plan.manualMappingSlots.every((slot) => slot.resolved === false), true);
    equal(plan.executable, false);
  });

  test("choice.radio → choice.checkbox 生成 CAST_VALUE", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.checkbox"));

    const plan = createMigrationPlan(oldSchema, newSchema);

    ok(hasCastOperation(plan, "qualityRating", "choice.radio", "choice.checkbox"));
  });

  test("choice.checkbox → choice.radio 生成 CAST_VALUE", () => {
    const oldSchema = replaceField(createSchema(), choiceField("qualityRating", "choice.checkbox"));
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.radio"));

    const plan = createMigrationPlan(oldSchema, newSchema);

    ok(hasCastOperation(plan, "qualityRating", "choice.checkbox", "choice.radio"));
  });

  test("input.text → input.textarea 生成 CAST_VALUE", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, textareaField("summary", true));

    const plan = createMigrationPlan(oldSchema, newSchema);

    ok(hasCastOperation(plan, "summary", "input.text", "input.textarea"));
  });

  test("删除字段且 archiveRemovedFields = true 生成 ARCHIVE_FIELD", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");

    const plan = createMigrationPlan(oldSchema, newSchema, {
      archiveRemovedFields: true,
    });

    ok(hasOperation(plan, "ARCHIVE_FIELD", "obsoleteNote"));
    equal(plan.executable, true);
  });

  test("删除字段且无 archive 策略时不可执行", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");

    const plan = createMigrationPlan(oldSchema, newSchema);

    equal(plan.executable, false);
    ok(plan.blockingIssues.length > 0);
  });

  test("新增字段有 defaultValue 时生成 ADD_DEFAULT", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    addField(newSchema, {
      ...textField("reviewNote", false),
      defaultValue: "待复核",
    });

    const plan = createMigrationPlan(oldSchema, newSchema);

    ok(plan.operations.some((operation) => operation.op === "ADD_DEFAULT" && operation.fieldName === "reviewNote"));
  });

  test("optionValueMap 生成 MAP_OPTION_VALUE", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, {
      ...choiceField("qualityRating", "choice.radio"),
      options: [
        { label: "通过", value: "pass" },
        { label: "需要复核", value: "review_required" },
      ],
    });

    const plan = createMigrationPlan(oldSchema, newSchema, {
      optionValueMap: {
        qualityRating: {
          needs_revision: "review_required",
        },
      },
    });

    ok(plan.operations.some((operation) =>
      operation.op === "MAP_OPTION_VALUE" &&
      operation.fieldName === "qualityRating" &&
      operation.fromValue === "needs_revision" &&
      operation.toValue === "review_required",
    ));
  });

  test("renameMap + optionValueMap 生成面向新字段的 MAP_OPTION_VALUE", () => {
    const oldSchema = createStatusRenameOldSchema();
    const newSchema = createStatusRenameNewSchema();

    const plan = createMigrationPlan(oldSchema, newSchema, {
      renameMap: { oldStatus: "status" },
      optionValueMap: {
        oldStatus: {
          medium: "normal",
        },
      },
    });

    ok(plan.operations.some((operation) => operation.op === "RENAME_FIELD" && operation.from === "oldStatus" && operation.to === "status"));
    ok(plan.operations.some((operation) =>
      operation.op === "MAP_OPTION_VALUE" &&
      operation.fieldName === "status" &&
      operation.fromValue === "medium" &&
      operation.toValue === "normal",
    ));
    equal(plan.executable, true);
  });

  test("renameMap 缺少 optionValueMap 时输出 manual mapping slot", () => {
    const oldSchema = createStatusRenameOldSchema();
    const newSchema = createStatusRenameNewSchema();

    const plan = createMigrationPlan(oldSchema, newSchema, {
      renameMap: { oldStatus: "status" },
    });

    ok(plan.manualMappingSlots.some((slot) =>
      slot.kind === "OPTION_VALUE_MAP" &&
      slot.fromFieldName === "oldStatus" &&
      slot.fromValue === "medium",
    ));
    equal(plan.executable, false);
  });

  test("cutoffSubmittedAt / includedSubmissionIds 被写入 plan", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema), {
      cutoffSubmittedAt: "2026-05-24T00:00:00.000Z",
      includedSubmissionIds: ["sub_1", "sub_2"],
    });

    equal(plan.cutoffSubmittedAt, "2026-05-24T00:00:00.000Z");
    deepEqual(plan.includedSubmissionIds, ["sub_1", "sub_2"]);
  });
});

describe("Migration Dry Run", () => {
  test("dryRunMigration 不修改原 submissions", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, textareaField("summary", true));
    const plan = createMigrationPlan(oldSchema, newSchema);
    const submissions = [submission("sub_1", { summary: "原摘要", qualityRating: "pass", obsoleteNote: "旧备注" })];
    const before = cloneSubmissions(submissions);

    dryRunMigration(plan, submissions, newSchema);

    deepEqual(submissions, before);
  });

  test("same schema + only KEEP_FIELD operations 不产生 affectedSubmissions 和 sampleBeforeAfter", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema));
    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], schema);

    equal(plan.operations.every((operation) => operation.op === "KEEP_FIELD"), true);
    equal(report.affectedSubmissions, 0);
    deepEqual(report.sampleBeforeAfter, []);
    deepEqual(report.validationErrors, []);
    equal(report.executable, true);
    equal(report.operationStats.some((stat) => stat.op === "KEEP_FIELD"), false);
  });

  test("RENAME_FIELD 正确迁移字段值", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    addField(newSchema, textareaField("newsSummary", false));
    const plan = createMigrationPlan(oldSchema, newSchema, {
      renameMap: { summary: "newsSummary" },
    });

    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], newSchema);

    equal(report.sampleBeforeAfter[0]?.after.newsSummary, "原摘要");
    equal(Object.prototype.hasOwnProperty.call(report.sampleBeforeAfter[0]?.after ?? {}, "summary"), false);
  });

  test("choice.radio → choice.checkbox 将 string 转 string[]", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.checkbox"));
    const plan = createMigrationPlan(oldSchema, newSchema);

    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], newSchema);

    deepEqual(report.sampleBeforeAfter[0]?.after.qualityRating, ["pass"]);
  });

  test("choice.checkbox → choice.radio 数组长度为 1 时转 string", () => {
    const oldSchema = replaceField(createSchema(), choiceField("qualityRating", "choice.checkbox"));
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.radio"));
    const plan = createMigrationPlan(oldSchema, newSchema);

    const report = dryRunMigration(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: ["pass"], obsoleteNote: "旧备注" })],
      newSchema,
    );

    equal(report.sampleBeforeAfter[0]?.after.qualityRating, "pass");
  });

  test("choice.checkbox → choice.radio 数组长度大于 1 时 blocking", () => {
    const oldSchema = replaceField(createSchema(), choiceField("qualityRating", "choice.checkbox"));
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.radio"));
    const plan = createMigrationPlan(oldSchema, newSchema);

    const report = dryRunMigration(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: ["pass", "needs_revision"], obsoleteNote: "旧备注" })],
      newSchema,
    );

    ok(report.skippedSubmissions.some((item) => item.reason === "BLOCKED"));
    equal(report.executable, false);
  });

  test("ARCHIVE_FIELD 将旧值放入 archivedAnswers，不进入 migrated answers", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");
    const plan = createMigrationPlan(oldSchema, newSchema, {
      archiveRemovedFields: true,
    });

    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], newSchema);

    equal(report.sampleBeforeAfter[0]?.archivedAnswers?.obsoleteNote, "旧备注");
    equal(Object.prototype.hasOwnProperty.call(report.sampleBeforeAfter[0]?.after ?? {}, "obsoleteNote"), false);
  });

  test("ADD_DEFAULT 写入默认值", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    addField(newSchema, {
      ...textField("reviewNote", false),
      defaultValue: "待复核",
    });
    const plan = createMigrationPlan(oldSchema, newSchema);

    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], newSchema);

    equal(report.sampleBeforeAfter[0]?.after.reviewNote, "待复核");
  });

  test("MAP_OPTION_VALUE 替换 option value", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, {
      ...choiceField("qualityRating", "choice.radio"),
      options: [
        { label: "通过", value: "pass" },
        { label: "需要复核", value: "review_required" },
      ],
    });
    const plan = createMigrationPlan(oldSchema, newSchema, {
      optionValueMap: {
        qualityRating: {
          needs_revision: "review_required",
        },
      },
    });

    const report = dryRunMigration(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: "needs_revision", obsoleteNote: "旧备注" })],
      newSchema,
    );

    equal(report.sampleBeforeAfter[0]?.after.qualityRating, "review_required");
  });

  test("renameMap + optionValueMap 在 dry run 中先改名再映射到新字段", () => {
    const oldSchema = createStatusRenameOldSchema();
    const newSchema = createStatusRenameNewSchema();
    const plan = createMigrationPlan(oldSchema, newSchema, {
      renameMap: { oldStatus: "status" },
      optionValueMap: {
        oldStatus: {
          medium: "normal",
        },
      },
    });

    const report = dryRunMigration(
      plan,
      [submission("sub_1", { summary: "原摘要", oldStatus: "medium", obsoleteNote: "旧备注" })],
      newSchema,
    );

    equal(report.sampleBeforeAfter[0]?.after.status, "normal");
    equal(Object.prototype.hasOwnProperty.call(report.sampleBeforeAfter[0]?.after ?? {}, "oldStatus"), false);
    equal(report.executable, true);
  });

  test("dry run 输出 affectedSubmissions / operationStats / archivedFieldStats / sampleBeforeAfter", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");
    addField(newSchema, {
      ...textField("reviewNote", false),
      defaultValue: "待复核",
    });
    const plan = createMigrationPlan(oldSchema, newSchema, {
      archiveRemovedFields: true,
    });

    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], newSchema);

    equal(report.affectedSubmissions, 1);
    ok(report.operationStats.some((stat) => stat.op === "ARCHIVE_FIELD" && stat.fieldName === "obsoleteNote" && stat.count === 1));
    ok(report.operationStats.some((stat) => stat.op === "ADD_DEFAULT" && stat.fieldName === "reviewNote" && stat.count === 1));
    deepEqual(report.archivedFieldStats, [{ fieldName: "obsoleteNote", count: 1 }]);
    equal(report.sampleBeforeAfter.length, 1);
  });

  test("dry run 输出 validationErrors", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    addField(newSchema, textField("requiredNote", true));
    const plan = createMigrationPlan(oldSchema, newSchema);

    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], newSchema);

    ok(report.validationErrors.some((error) => error.fieldName === "requiredNote"));
  });

  test("sampleBeforeAfter 遵守 deterministic prioritized sampling", () => {
    const oldSchema = replaceField(createSchema(), choiceField("qualityRating", "choice.checkbox"));
    const newSchema = replaceField(removeField(oldSchema, "obsoleteNote"), choiceField("qualityRating", "choice.radio"));
    addField(newSchema, textField("requiredNote", true));
    const plan = createMigrationPlan(oldSchema, newSchema, {
      archiveRemovedFields: true,
    });

    const report = dryRunMigration(
      plan,
      [
        submission("sub_c", { summary: "原摘要", qualityRating: ["pass"], obsoleteNote: "旧备注" }),
        submission("sub_b", { summary: "原摘要", qualityRating: ["pass", "needs_revision"], obsoleteNote: "旧备注" }),
        submission("sub_a", { qualityRating: ["pass"], obsoleteNote: "旧备注" }),
      ],
      newSchema,
      { sampleLimit: 2 },
    );

    deepEqual(report.samplingPolicy.priorityOrder, [
      "BLOCKING",
      "VALIDATION_FAILED",
      "ARCHIVED",
      "RENAME_FIELD",
      "CAST_VALUE",
      "ADD_DEFAULT",
      "AFFECTED",
    ]);
    deepEqual(report.sampleBeforeAfter.map((sample) => sample.submissionId), ["sub_b", "sub_a"]);
  });

  test("includedSubmissionIds 外的 submission 被 skipped 为 OUT_OF_SCOPE", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema), {
      includedSubmissionIds: ["sub_1"],
    });

    const report = dryRunMigration(
      plan,
      [submission("sub_1", completeAnswers()), submission("sub_2", completeAnswers())],
      schema,
    );

    ok(report.skippedSubmissions.some((item) => item.submissionId === "sub_2" && item.reason === "OUT_OF_SCOPE"));
  });

  test("cutoffSubmittedAt 之后的 submission 被 skipped 为 OUT_OF_SCOPE", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema), {
      cutoffSubmittedAt: "2026-05-24T00:00:00.000Z",
    });

    const report = dryRunMigration(
      plan,
      [
        submission("sub_1", completeAnswers(), "2026-05-24T00:00:00.000Z"),
        submission("sub_2", completeAnswers(), "2026-05-25T00:00:00.000Z"),
      ],
      schema,
    );

    ok(report.skippedSubmissions.some((item) => item.submissionId === "sub_2" && item.reason === "OUT_OF_SCOPE"));
  });

  test("未执行 custom validation", () => {
    const schema = createSchema();
    const newSchema = cloneSchema(schema);
    getField(newSchema, "summary").validations = [
      { type: "custom", ruleId: "custom_summary_quality", message: "不应在 dry run 执行" },
    ];
    const plan = createMigrationPlan(schema, newSchema);

    const report = dryRunMigration(plan, [submission("sub_1", completeAnswers())], newSchema);

    equal(report.validationErrors.some((error) => error.message.includes("custom validation")), false);
    equal(report.executable, true);
  });
});

describe("Migration Execute", () => {
  test("plan.executable = false 时拒绝执行", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");
    const plan = createMigrationPlan(oldSchema, newSchema);

    throws(() => executeMigrationPlan(plan, [submission("sub_1", completeAnswers())]), /MigrationPlan 不可执行/);
  });

  test("KEEP_FIELD 保留字段值", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema));

    const result = executeMigrationPlan(plan, [submission("sub_1", completeAnswers())]);

    equal(result.migratedSubmissions[0]?.answers.summary, "原摘要");
    equal(result.skippedSubmissions.length, 0);
  });

  test("RENAME_FIELD 移动字段值并删除 old field", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    addField(newSchema, textareaField("newsSummary", false));
    const plan = createMigrationPlan(oldSchema, newSchema, {
      renameMap: { summary: "newsSummary" },
    });

    const result = executeMigrationPlan(plan, [submission("sub_1", completeAnswers())]);

    equal(result.migratedSubmissions[0]?.answers.newsSummary, "原摘要");
    equal(Object.prototype.hasOwnProperty.call(result.migratedSubmissions[0]?.answers ?? {}, "summary"), false);
  });

  test("choice.radio → choice.checkbox 执行 string → string[]", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.checkbox"));
    const plan = createMigrationPlan(oldSchema, newSchema);

    const result = executeMigrationPlan(plan, [submission("sub_1", completeAnswers())]);

    deepEqual(result.migratedSubmissions[0]?.answers.qualityRating, ["pass"]);
  });

  test("choice.checkbox → choice.radio 数组长度为 1 时执行 string[] → string", () => {
    const oldSchema = replaceField(createSchema(), choiceField("qualityRating", "choice.checkbox"));
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.radio"));
    const plan = createMigrationPlan(oldSchema, newSchema);

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: ["pass"], obsoleteNote: "旧备注" })],
    );

    equal(result.migratedSubmissions[0]?.answers.qualityRating, "pass");
  });

  test("choice.checkbox → choice.radio 数组长度大于 1 时 skipped / BLOCKED", () => {
    const oldSchema = replaceField(createSchema(), choiceField("qualityRating", "choice.checkbox"));
    const newSchema = replaceField(oldSchema, choiceField("qualityRating", "choice.radio"));
    const plan = createMigrationPlan(oldSchema, newSchema);

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: ["pass", "needs_revision"], obsoleteNote: "旧备注" })],
    );

    equal(result.migratedSubmissions.length, 0);
    ok(result.skippedSubmissions.some((item) => item.reason === "BLOCKED"));
  });

  test("ARCHIVE_FIELD 输出 archivedAnswers，且 migrated answers 不包含旧字段", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");
    const plan = createMigrationPlan(oldSchema, newSchema, {
      archiveRemovedFields: true,
    });

    const result = executeMigrationPlan(plan, [submission("sub_1", completeAnswers())]);

    equal(result.migratedSubmissions[0]?.archivedAnswers?.obsoleteNote, "旧备注");
    equal(Object.prototype.hasOwnProperty.call(result.migratedSubmissions[0]?.answers ?? {}, "obsoleteNote"), false);
  });

  test("ADD_DEFAULT 写入默认值", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    addField(newSchema, {
      ...textField("reviewNote", false),
      defaultValue: "待复核",
    });
    const plan = createMigrationPlan(oldSchema, newSchema);

    const result = executeMigrationPlan(plan, [submission("sub_1", completeAnswers())]);

    equal(result.migratedSubmissions[0]?.answers.reviewNote, "待复核");
  });

  test("MAP_OPTION_VALUE 替换 string 值", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, {
      ...choiceField("qualityRating", "choice.radio"),
      options: [
        { label: "通过", value: "pass" },
        { label: "需要复核", value: "review_required" },
      ],
    });
    const plan = createMigrationPlan(oldSchema, newSchema, {
      optionValueMap: {
        qualityRating: {
          needs_revision: "review_required",
        },
      },
    });

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: "needs_revision", obsoleteNote: "旧备注" })],
    );

    equal(result.migratedSubmissions[0]?.answers.qualityRating, "review_required");
  });

  test("MAP_OPTION_VALUE 替换 string[] 中的值", () => {
    const oldSchema = replaceField(createSchema(), choiceField("qualityRating", "choice.checkbox"));
    const newSchema = replaceField(oldSchema, {
      ...choiceField("qualityRating", "choice.checkbox"),
      options: [
        { label: "通过", value: "pass" },
        { label: "需要复核", value: "review_required" },
      ],
    });
    const plan = createMigrationPlan(oldSchema, newSchema, {
      optionValueMap: {
        qualityRating: {
          needs_revision: "review_required",
        },
      },
    });

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: ["pass", "needs_revision"], obsoleteNote: "旧备注" })],
    );

    deepEqual(result.migratedSubmissions[0]?.answers.qualityRating, ["pass", "review_required"]);
  });

  test("无法映射的 option value 使该 submission skipped / BLOCKED", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, {
      ...choiceField("qualityRating", "choice.radio"),
      options: [
        { label: "通过", value: "pass" },
        { label: "需要复核", value: "review_required" },
      ],
    });
    const plan = createMigrationPlan(oldSchema, newSchema, {
      optionValueMap: {
        qualityRating: {
          needs_revision: "review_required",
        },
      },
    });

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", { summary: "原摘要", qualityRating: 123, obsoleteNote: "旧备注" })],
    );

    equal(result.migratedSubmissions.length, 0);
    ok(result.skippedSubmissions.some((item) => item.reason === "BLOCKED"));
  });

  test("executeMigrationPlan 不修改原 submissions", () => {
    const oldSchema = createSchema();
    const newSchema = replaceField(oldSchema, textareaField("summary", true));
    const plan = createMigrationPlan(oldSchema, newSchema);
    const submissions = [submission("sub_1", completeAnswers())];
    const before = cloneSubmissions(submissions);

    executeMigrationPlan(plan, submissions);

    deepEqual(submissions, before);
  });

  test("includedSubmissionIds 外的 submission skipped 为 OUT_OF_SCOPE", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema), {
      includedSubmissionIds: ["sub_1"],
    });

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", completeAnswers()), submission("sub_2", completeAnswers())],
    );

    ok(result.skippedSubmissions.some((item) => item.submissionId === "sub_2" && item.reason === "OUT_OF_SCOPE"));
    equal(result.migratedSubmissions.length, 1);
  });

  test("cutoffSubmittedAt 之后的 submission skipped 为 OUT_OF_SCOPE", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema), {
      cutoffSubmittedAt: "2026-05-24T00:00:00.000Z",
    });

    const result = executeMigrationPlan(
      plan,
      [
        submission("sub_1", completeAnswers(), "2026-05-24T00:00:00.000Z"),
        submission("sub_2", completeAnswers(), "2026-05-25T00:00:00.000Z"),
      ],
    );

    ok(result.skippedSubmissions.some((item) => item.submissionId === "sub_2" && item.reason === "OUT_OF_SCOPE"));
    equal(result.migratedSubmissions.length, 1);
  });

  test("migratedSubmissions 携带 expectedVersion / expectedUpdatedAt", () => {
    const schema = createSchema();
    const plan = createMigrationPlan(schema, cloneSchema(schema));

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", completeAnswers(), "2026-05-24T00:00:00.000Z", {
        version: 7,
        updatedAt: "2026-05-24T10:00:00.000Z",
      })],
    );

    equal(result.migratedSubmissions[0]?.expectedVersion, 7);
    equal(result.migratedSubmissions[0]?.expectedUpdatedAt, "2026-05-24T10:00:00.000Z");
  });

  test("recordDraft 正确统计并包含 checksumInput，conflictCount 默认为 0", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "obsoleteNote");
    const plan = createMigrationPlan(oldSchema, newSchema, {
      archiveRemovedFields: true,
      includedSubmissionIds: ["sub_1"],
    });

    const result = executeMigrationPlan(
      plan,
      [submission("sub_1", completeAnswers()), submission("sub_2", completeAnswers())],
    );

    equal(result.recordDraft.operationCount, plan.operations.length);
    equal(result.recordDraft.migratedCount, 1);
    equal(result.recordDraft.skippedCount, 1);
    equal(result.recordDraft.conflictCount, 0);
    equal(result.conflictCount, 0);
    ok(typeof result.recordDraft.generatedAt === "string");
    deepEqual(result.recordDraft.checksumInput, {
      archivedFieldSummary: [{ fieldName: "obsoleteNote", count: 1 }],
      fromSchemaVersionId: "sv_migration_1",
      migratedSubmissionIds: ["sub_1"],
      operationCount: plan.operations.length,
      operations: plan.operations,
      skippedSubmissionIds: ["sub_2"],
      toSchemaVersionId: "sv_migration_1",
    });
  });
});

function createSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_migration",
    schemaVersionId: "sv_migration_1",
    schemaVersionNo: 1,
    schemaDraftRevision: 1,
    status: "PUBLISHED",
    meta: {
      name: "迁移测试 schema",
      taskId: "task_migration",
      authorId: "usr_migration",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
      publishedAt: "2026-05-24T00:00:00.000Z",
    },
    root: {
      id: "root_migration",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        textField("summary", true),
        choiceField("qualityRating", "choice.radio"),
        textField("obsoleteNote", false),
      ],
    },
  };
}

function createStatusRenameOldSchema(): LabelHubSchema {
  const schema = removeField(createSchema(), "qualityRating");
  addField(schema, statusChoiceField("oldStatus", [
    { label: "中等", value: "medium" },
    { label: "高", value: "high" },
  ]));
  return schema;
}

function createStatusRenameNewSchema(): LabelHubSchema {
  const schema = removeField(createStatusRenameOldSchema(), "oldStatus");
  addField(schema, statusChoiceField("status", [
    { label: "正常", value: "normal" },
    { label: "高", value: "high" },
  ]));
  return schema;
}

function textField(name: string, required: boolean): FieldNode {
  return {
    id: `field_${name}`,
    kind: "FIELD",
    type: "input.text",
    title: name,
    name,
    required,
  };
}

function textareaField(name: string, required: boolean): FieldNode {
  return {
    id: `field_${name}`,
    kind: "FIELD",
    type: "input.textarea",
    title: name,
    name,
    required,
  };
}

function choiceField(name: string, type: "choice.radio" | "choice.checkbox"): ChoiceFieldNode {
  return {
    id: `field_${name}`,
    kind: "FIELD",
    type,
    title: name,
    name,
    required: true,
    options: [
      { label: "通过", value: "pass" },
      { label: "需要修改", value: "needs_revision" },
    ],
  };
}

function statusChoiceField(name: string, options: ChoiceFieldNode["options"]): ChoiceFieldNode {
  return {
    id: `field_${name}`,
    kind: "FIELD",
    type: "choice.radio",
    title: name,
    name,
    required: true,
    options,
  };
}

function completeAnswers(): Record<string, unknown> {
  return {
    summary: "原摘要",
    qualityRating: "pass",
    obsoleteNote: "旧备注",
  };
}

function submission(
  submissionId: string,
  answers: Record<string, unknown>,
  submittedAt = "2026-05-24T00:00:00.000Z",
  metadata: {
    version?: number;
    updatedAt?: string;
  } = {},
): MigrationSubmissionInput {
  const result: MigrationSubmissionInput = {
    submissionId,
    schemaVersionId: "sv_migration_1",
    answers,
    submittedAt,
  };
  if (metadata.version !== undefined) {
    result.version = metadata.version;
  }
  if (metadata.updatedAt !== undefined) {
    result.updatedAt = metadata.updatedAt;
  }
  return result;
}

function removeField(schema: LabelHubSchema, fieldName: string): LabelHubSchema {
  const next = cloneSchema(schema);
  next.root.children = next.root.children.filter((node) => node.kind !== "FIELD" || node.name !== fieldName);
  return next;
}

function addField(schema: LabelHubSchema, field: FieldNode): void {
  schema.root.children.push(field);
}

function replaceField(schema: LabelHubSchema, field: FieldNode): LabelHubSchema {
  const next = cloneSchema(schema);
  next.root.children = next.root.children.map((node) => {
    if (node.kind === "FIELD" && node.name === field.name) {
      return field;
    }
    return node;
  });
  return next;
}

function getField(schema: LabelHubSchema, fieldName: string): FieldNode {
  const field = schema.root.children.find((node) => node.kind === "FIELD" && node.name === fieldName);
  if (field?.kind !== "FIELD") {
    throw new Error(`测试 schema 缺少字段：${fieldName}`);
  }
  return field;
}

function hasOperation(plan: MigrationPlan, op: MigrationOperation["op"], fieldName: string): boolean {
  return plan.operations.some((operation) => operation.op === op && getOperationFieldName(operation) === fieldName);
}

function hasCastOperation(
  plan: MigrationPlan,
  fieldName: string,
  fromType: string,
  toType: string,
): boolean {
  return plan.operations.some((operation) =>
    operation.op === "CAST_VALUE" &&
    operation.fieldName === fieldName &&
    operation.fromType === fromType &&
    operation.toType === toType,
  );
}

function getOperationFieldName(operation: MigrationOperation): string | undefined {
  switch (operation.op) {
    case "KEEP_FIELD":
    case "CAST_VALUE":
    case "ARCHIVE_FIELD":
    case "ADD_DEFAULT":
    case "MAP_OPTION_VALUE":
      return operation.fieldName;
    case "RENAME_FIELD":
      return operation.to;
    case "REQUIRE_MANUAL_MAPPING":
      return operation.fromFieldName;
    case "CUSTOM_TRANSFORM":
      return operation.fieldNames[0];
  }
}

function cloneSchema(schema: LabelHubSchema): LabelHubSchema {
  return JSON.parse(JSON.stringify(schema)) as LabelHubSchema;
}

function cloneSubmissions(submissions: MigrationSubmissionInput[]): MigrationSubmissionInput[] {
  return JSON.parse(JSON.stringify(submissions)) as MigrationSubmissionInput[];
}
