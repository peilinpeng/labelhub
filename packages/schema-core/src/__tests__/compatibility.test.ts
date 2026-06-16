import { equal, ok } from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChoiceFieldNode, FieldNode, LabelHubSchema, LLMAssistNode } from "@labelhub/contracts";
import {
  checkBackwardCompatibility,
  detectSchemaChanges,
} from "../index.ts";

describe("Breaking Change Detection", () => {
  test("新增非必填字段 → SAFE", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    newSchema.root.children.push(textField("field_optional_note", "optionalNote", false));

    expectChange(oldSchema, newSchema, "OPTIONAL_FIELD_ADDED", "SAFE");
  });

  test("新增必填字段 → NEEDS_APPROVAL", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    newSchema.root.children.push(textField("field_required_note", "requiredNote", true));

    expectChange(oldSchema, newSchema, "REQUIRED_FIELD_ADDED", "NEEDS_APPROVAL");
  });

  test("删除字段 → BREAKING", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");

    expectChange(oldSchema, newSchema, "FIELD_REMOVED", "BREAKING");
  });

  test("字段改名但无 renameMap → BREAKING", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    newSchema.root.children.push(textField("field_news_summary", "newsSummary", true));

    expectChange(oldSchema, newSchema, "FIELD_REMOVED", "BREAKING");
  });

  test("字段改名且有 renameMap → MIGRATION_REQUIRED", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    newSchema.root.children.push(textField("field_news_summary", "newsSummary", true));

    const changes = detectSchemaChanges(oldSchema, newSchema, {
      renameMap: { summary: "newsSummary" },
    });

    equal(findLevel(changes, "FIELD_RENAMED_WITH_MAPPING"), "MIGRATION_REQUIRED");
    equal(changes.some((change) => change.code === "FIELD_REMOVED" && change.fieldName === "summary"), false);
  });

  test("choice.radio → choice.checkbox → MIGRATION_REQUIRED", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    const field = getField(newSchema, "qualityRating");
    if (field.type !== "choice.radio") throw new Error("测试字段必须是 choice.radio");
    field.type = "choice.checkbox";

    expectChange(oldSchema, newSchema, "FIELD_TYPE_CAST_REQUIRED", "MIGRATION_REQUIRED");
  });

  test("input.text → input.textarea → MIGRATION_REQUIRED", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    const field = getField(newSchema, "summary");
    if (field.type !== "input.text") throw new Error("测试字段必须是 input.text");
    field.type = "input.textarea";

    expectChange(oldSchema, newSchema, "FIELD_TYPE_CAST_REQUIRED", "MIGRATION_REQUIRED");
  });

  test("option value 删除 → BREAKING", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getChoiceField(newSchema, "qualityRating").options = [{ label: "通过", value: "pass" }];

    expectChange(oldSchema, newSchema, "OPTION_VALUE_REMOVED", "BREAKING");
  });

  test("option value 删除但有 optionValueMap → MIGRATION_REQUIRED", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getChoiceField(newSchema, "qualityRating").options = [
      { label: "通过", value: "pass" },
      { label: "需要修改", value: "needs_revision_new" },
    ];

    const changes = detectSchemaChanges(oldSchema, newSchema, {
      optionValueMap: {
        qualityRating: {
          needs_revision: "needs_revision_new",
        },
      },
    });

    equal(findLevel(changes, "OPTION_VALUE_MAPPED"), "MIGRATION_REQUIRED");
  });

  test("option label 修改但 value 不变 → SAFE", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getChoiceField(newSchema, "qualityRating").options[0] = { label: "合格", value: "pass" };

    expectChange(oldSchema, newSchema, "OPTION_LABEL_CHANGED", "SAFE");
  });

  test("required: true → false → SAFE", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getField(newSchema, "summary").required = false;

    expectChange(oldSchema, newSchema, "REQUIRED_RELAXED", "SAFE");
  });

  test("required: false → true → NEEDS_APPROVAL", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getField(oldSchema, "summary").required = false;
    getField(newSchema, "summary").required = true;

    expectChange(oldSchema, newSchema, "REQUIRED_TIGHTENED", "NEEDS_APPROVAL");
  });

  test("minLength 变大 → NEEDS_APPROVAL", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    setMinLength(newSchema, "summary", 10);

    expectChange(oldSchema, newSchema, "VALIDATION_MIN_LENGTH_TIGHTENED", "NEEDS_APPROVAL");
  });

  test("minLength 变小 → SAFE", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    setMinLength(newSchema, "summary", 2);

    expectChange(oldSchema, newSchema, "VALIDATION_MIN_LENGTH_RELAXED", "SAFE");
  });

  test("LLM outputBinding 指向被删除字段 → BREAKING", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    newSchema.root.children.push(llmAssistNode("summary"));

    expectChange(oldSchema, newSchema, "LLM_OUTPUT_BINDING_TARGET_REMOVED", "BREAKING");
  });

  test("deprecated 字段被标记但未删除 → NEEDS_APPROVAL", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getField(newSchema, "summary").deprecation = {
      deprecated: true,
      reason: "请使用 newsSummary",
      replacementFieldName: "newsSummary",
    };

    expectChange(oldSchema, newSchema, "DEPRECATED_FIELD_MARKED", "NEEDS_APPROVAL");
  });

  test("deprecated + hideForNewSubmissions 不等于 FIELD_REMOVED", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getField(newSchema, "summary").deprecation = {
      deprecated: true,
      reason: "请使用 newsSummary",
      replacementFieldName: "newsSummary",
      hideForNewSubmissions: true,
    };

    const changes = detectSchemaChanges(oldSchema, newSchema);

    equal(findLevel(changes, "DEPRECATED_FIELD_HIDDEN_FOR_NEW_SUBMISSIONS"), "NEEDS_APPROVAL");
    equal(changes.some((change) => change.code === "FIELD_REMOVED" && change.fieldName === "summary"), false);
  });

  test("checkBackwardCompatibility 正确计算 publishAllowed", () => {
    const oldSchema = createSchema();
    const newSchema = removeField(oldSchema, "summary");
    const report = checkBackwardCompatibility(oldSchema, newSchema);

    equal(report.publishAllowed, false);
    equal(report.blockingChanges.length > 0, true);
  });

  test("checkBackwardCompatibility 正确计算 requiresApproval", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    getField(newSchema, "summary").required = false;
    getField(oldSchema, "summary").required = false;
    getField(newSchema, "summary").required = true;
    const report = checkBackwardCompatibility(oldSchema, newSchema);

    equal(report.requiresApproval, true);
    equal(report.publishAllowed, true);
  });

  test("checkBackwardCompatibility 正确计算 requiresMigration", () => {
    const oldSchema = createSchema();
    const newSchema = cloneSchema(oldSchema);
    const field = getField(newSchema, "summary");
    if (field.type !== "input.text") throw new Error("测试字段必须是 input.text");
    field.type = "input.textarea";
    const report = checkBackwardCompatibility(oldSchema, newSchema);

    equal(report.requiresMigration, true);
    equal(report.publishAllowed, true);
  });
});

function expectChange(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
  code: string,
  level: string,
): void {
  const changes = detectSchemaChanges(oldSchema, newSchema);
  equal(findLevel(changes, code), level);
}

function findLevel(changes: ReturnType<typeof detectSchemaChanges>, code: string): string | undefined {
  return changes.find((change) => change.code === code)?.level;
}

function createSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_compatibility",
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      name: "兼容性测试 schema",
      taskId: "task_compatibility",
      authorId: "usr_compatibility",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
    },
    root: {
      id: "root_compatibility",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        textField("field_summary", "summary", true),
        {
          id: "field_quality",
          kind: "FIELD",
          type: "choice.radio",
          title: "质量判断",
          name: "qualityRating",
          required: true,
          options: [
            { label: "通过", value: "pass" },
            { label: "需要修改", value: "needs_revision" },
          ],
        },
      ],
    },
  };
}

function textField(id: string, name: string, required: boolean): FieldNode {
  return {
    id,
    kind: "FIELD",
    type: "input.text",
    title: name,
    name,
    required,
    validations: [{ type: "minLength", value: 5 }],
  };
}

function llmAssistNode(toFieldName: string): LLMAssistNode {
  return {
    id: "llm_summary",
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

function removeField(schema: LabelHubSchema, fieldName: string): LabelHubSchema {
  const next = cloneSchema(schema);
  next.root.children = next.root.children.filter((node) => node.kind !== "FIELD" || node.name !== fieldName);
  return next;
}

function getField(schema: LabelHubSchema, fieldName: string): FieldNode {
  const field = schema.root.children.find((node) => node.kind === "FIELD" && node.name === fieldName);
  if (field?.kind !== "FIELD") {
    throw new Error(`测试 schema 缺少字段：${fieldName}`);
  }
  return field;
}

function getChoiceField(schema: LabelHubSchema, fieldName: string): ChoiceFieldNode {
  const field = getField(schema, fieldName);
  if (field.type !== "choice.radio" && field.type !== "choice.checkbox" && field.type !== "choice.select" && field.type !== "choice.tags") {
    throw new Error(`测试字段不是 choice field：${fieldName}`);
  }
  return field;
}

function setMinLength(schema: LabelHubSchema, fieldName: string, value: number): void {
  const field = getField(schema, fieldName);
  field.validations = [{ type: "minLength", value }];
}

function cloneSchema(schema: LabelHubSchema): LabelHubSchema {
  return JSON.parse(JSON.stringify(schema)) as LabelHubSchema;
}
