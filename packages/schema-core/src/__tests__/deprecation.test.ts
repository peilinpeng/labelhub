import { equal } from "node:assert/strict";
import { describe, test } from "node:test";
import type { FieldNode, LabelHubSchema, LLMAssistNode } from "@labelhub/contracts";
import { validateDeprecationRules } from "../index.ts";

describe("Deprecation 规则", () => {
  test("deprecated + required: true → WARNING", () => {
    const schema = schemaWithDeprecatedField({ required: true, reason: "旧字段", replacementFieldName: "newSummary" });
    const result = validateDeprecationRules(schema);

    equal(hasWarning(result, "DEPRECATED_FIELD_REQUIRED"), true);
    equal(result.valid, true);
  });

  test("deprecated 没有 reason → WARNING", () => {
    const schema = schemaWithDeprecatedField({ replacementFieldName: "newSummary" });
    const result = validateDeprecationRules(schema);

    equal(hasWarning(result, "DEPRECATED_FIELD_REASON_MISSING"), true);
  });

  test("deprecated 没有 replacementFieldName → WARNING", () => {
    const schema = schemaWithDeprecatedField({ reason: "旧字段" });
    const result = validateDeprecationRules(schema);

    equal(hasWarning(result, "DEPRECATED_FIELD_REPLACEMENT_MISSING"), true);
  });

  test("replacementFieldName 不存在 → ERROR", () => {
    const schema = schemaWithDeprecatedField({ reason: "旧字段", replacementFieldName: "missingField" });
    const result = validateDeprecationRules(schema);

    equal(hasError(result, "DEPRECATED_FIELD_REPLACEMENT_NOT_FOUND"), true);
    equal(result.valid, false);
  });

  test("replacementFieldName 存在 → 不报 replacement missing error", () => {
    const schema = schemaWithDeprecatedField({ reason: "旧字段", replacementFieldName: "newSummary" });
    const result = validateDeprecationRules(schema);

    equal(hasError(result, "DEPRECATED_FIELD_REPLACEMENT_NOT_FOUND"), false);
    equal(hasWarning(result, "DEPRECATED_FIELD_REPLACEMENT_MISSING"), false);
  });

  test("plannedRemovalSchemaVersionNo 小于或等于当前 schemaVersionNo → ERROR", () => {
    const schema = schemaWithDeprecatedField({
      reason: "旧字段",
      replacementFieldName: "newSummary",
      plannedRemovalSchemaVersionNo: 1,
    });
    schema.schemaVersionNo = 1;
    const result = validateDeprecationRules(schema);

    equal(hasError(result, "DEPRECATED_FIELD_REMOVAL_VERSION_INVALID"), true);
  });

  test("plannedRemovalSchemaVersionNo 大于当前 schemaVersionNo → 通过该规则", () => {
    const schema = schemaWithDeprecatedField({
      reason: "旧字段",
      replacementFieldName: "newSummary",
      plannedRemovalSchemaVersionNo: 2,
    });
    schema.schemaVersionNo = 1;
    const result = validateDeprecationRules(schema);

    equal(hasError(result, "DEPRECATED_FIELD_REMOVAL_VERSION_INVALID"), false);
  });

  test("deprecated 字段被 LLM outputBinding 写入且无 replacementFieldName → ERROR", () => {
    const schema = schemaWithDeprecatedField({ reason: "旧字段" });
    schema.root.children.push(llmNode("oldSummary"));
    const result = validateDeprecationRules(schema);

    equal(hasError(result, "DEPRECATED_FIELD_LLM_OUTPUT_WITHOUT_REPLACEMENT"), true);
  });

  test("deprecated 字段被 LLM outputBinding 写入但有 replacementFieldName → WARNING", () => {
    const schema = schemaWithDeprecatedField({ reason: "旧字段", replacementFieldName: "newSummary" });
    schema.root.children.push(llmNode("oldSummary"));
    const result = validateDeprecationRules(schema);

    equal(hasWarning(result, "DEPRECATED_FIELD_LLM_OUTPUT_WITH_REPLACEMENT"), true);
    equal(hasError(result, "DEPRECATED_FIELD_LLM_OUTPUT_WITHOUT_REPLACEMENT"), false);
  });

  test("输出结果中 errors / warnings / issues 分类正确", () => {
    const schema = schemaWithDeprecatedField({ required: true, replacementFieldName: "missingField", plannedRemovalSchemaVersionNo: 1 });
    schema.schemaVersionNo = 1;
    const result = validateDeprecationRules(schema);

    equal(result.errors.every((issue) => issue.severity === "ERROR"), true);
    equal(result.warnings.every((issue) => issue.severity === "WARNING"), true);
    equal(result.issues.length, result.errors.length + result.warnings.length);
  });
});

function schemaWithDeprecatedField(options: {
  required?: boolean;
  reason?: string;
  replacementFieldName?: string;
  plannedRemovalSchemaVersionNo?: number;
}): LabelHubSchema {
  const oldField: FieldNode = {
    id: "field_old_summary",
    kind: "FIELD",
    type: "input.text",
    title: "旧摘要",
    name: "oldSummary",
    deprecation: {
      deprecated: true,
      hideForNewSubmissions: true,
    },
  };

  if (options.required !== undefined) oldField.required = options.required;
  if (options.reason !== undefined) oldField.deprecation!.reason = options.reason;
  if (options.replacementFieldName !== undefined) oldField.deprecation!.replacementFieldName = options.replacementFieldName;
  if (options.plannedRemovalSchemaVersionNo !== undefined) oldField.deprecation!.plannedRemovalSchemaVersionNo = options.plannedRemovalSchemaVersionNo;

  return {
    contractVersion: "1.1",
    schemaId: "schema_deprecation",
    schemaVersionNo: 1,
    status: "DRAFT",
    meta: {
      name: "Deprecation 测试 schema",
      taskId: "task_deprecation",
      authorId: "usr_deprecation",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
    },
    root: {
      id: "root_deprecation",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        oldField,
        {
          id: "field_new_summary",
          kind: "FIELD",
          type: "input.text",
          title: "新摘要",
          name: "newSummary",
        },
      ],
    },
  };
}

function llmNode(toFieldName: string): LLMAssistNode {
  return {
    id: "llm_deprecation",
    kind: "LLM_ASSIST",
    type: "llm.assist",
    title: "AI 辅助",
    trigger: "MANUAL",
    inputBindings: {
      source: "$.item.sourcePayload.title",
    },
    outputMode: "STRUCTURED",
    outputBindings: [
      {
        from: "$.output.summary",
        toFieldName,
        mode: "REPLACE",
        requireUserConfirm: true,
      },
    ],
  };
}

function hasError(result: ReturnType<typeof validateDeprecationRules>, code: string): boolean {
  return result.errors.some((issue) => issue.code === code);
}

function hasWarning(result: ReturnType<typeof validateDeprecationRules>, code: string): boolean {
  return result.warnings.some((issue) => issue.code === code);
}
