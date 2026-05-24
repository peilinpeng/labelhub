import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { describe, test } from "node:test";
import type { Expression, LabelHubRuntimeContext, LabelHubSchema } from "@labelhub/contracts";
import {
  assertAllowedJsonPath,
  assertUniqueFieldNames,
  assertUniqueNodeIds,
  collectFieldNodes,
  collectLLMAssistNodes,
  collectShowItemNodes,
  createNewsQualitySchema,
  evaluateExpression,
  findFieldByName,
  getByJsonPath,
  isAllowedJsonPath,
  normalizeAnswers,
  resolveNodeDisabled,
  resolveNodeVisibility,
  validateAnswers,
  validateLLMOutputBindings,
  validateSchemaShape,
  validateShowItemPaths,
} from "../index.ts";

const baseContext: LabelHubRuntimeContext = {
  task: {
    id: "task_news_quality_core",
    title: "新闻质量标注",
    status: "PUBLISHED",
    activeSchemaVersionId: "sv_news_quality_core_1",
  },
  schema: {
    schemaId: "schema_news_quality_core",
    schemaVersionId: "sv_news_quality_core_1",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: {
    id: "item_news_1",
    externalKey: "news-1",
    sourcePayload: {
      title: "示例新闻标题",
      body: "示例新闻正文",
      score: 90,
    },
  },
  answers: {
    qualityRating: "needs_revision",
    summary: "这是一段已经填写的新闻摘要",
    rewriteSuggestion: "建议补充来源",
  },
  system: {
    actor: {
      id: "usr_labeler",
      role: "LABELER",
      displayName: "标注员",
    },
    role: "LABELER",
    now: "2026-05-24T00:00:00.000Z",
    timezone: "Europe/Zurich",
  },
};

describe("Schema traversal 与不变量", () => {
  test("node.id 必须全局唯一", () => {
    const schema = cloneSchema();
    const first = schema.root.children[0];
    if (first === undefined) {
      throw new Error("示例 schema 必须包含子节点");
    }
    schema.root.children.push({ ...first });

    const result = assertUniqueNodeIds(schema);

    equal(result.valid, false);
    equal(result.errors.some((error) => error.code === "NODE_ID_DUPLICATED"), true);
  });

  test("FieldNode.name 必须全局唯一", () => {
    const schema = cloneSchema();
    schema.root.children.push({
      id: "duplicate_summary",
      kind: "FIELD",
      type: "input.text",
      name: "summary",
      title: "重复摘要",
    });

    const result = assertUniqueFieldNames(schema);

    equal(result.valid, false);
    equal(result.errors.some((error) => error.code === "FIELD_NAME_DUPLICATED"), true);
  });

  test("只有 FieldNode 会进入可提交字段集合", () => {
    const schema = cloneSchema();
    const fieldNames = collectFieldNodes(schema).map((field) => field.name);
    const showItems = collectShowItemNodes(schema);
    const llmNodes = collectLLMAssistNodes(schema);

    ok(fieldNames.includes("summary"));
    equal(showItems.some((node) => "name" in node), false);
    equal(llmNodes.some((node) => "name" in node), false);
  });

  test("unknown node type 会被识别为 UNKNOWN_NODE_TYPE", () => {
    const schema = cloneSchema() as unknown as Record<string, unknown>;
    const root = schema.root as { children: unknown[] };
    root.children.push({
      id: "unknown_node",
      kind: "FIELD",
      type: "unknown.node",
      name: "unknownNode",
      title: "未知节点",
    });

    const result = validateSchemaShape(schema);

    equal(result.valid, false);
    equal(result.errors.some((error) => error.code === "UNKNOWN_NODE_TYPE"), true);
  });
});

describe("JsonPath 工具", () => {
  test("JsonPath 必须使用 RuntimeContext 命名空间", () => {
    equal(isAllowedJsonPath("$.item.sourcePayload.title"), true);
    equal(isAllowedJsonPath("$.answers.summary"), true);
    equal(isAllowedJsonPath("$.sourcePayload.title"), false);
    equal(isAllowedJsonPath("$.item.title"), false);
    equal(isAllowedJsonPath("answers.summary"), false);
    equal(isAllowedJsonPath("$.output.summary"), false);
    equal(isAllowedJsonPath("$.output.summary", { allowOutput: true }), true);
    throws(() => assertAllowedJsonPath("$.sourcePayload.title"));
  });

  test("getByJsonPath 可以读取 $.item.sourcePayload 与 $.answers", () => {
    equal(getByJsonPath(baseContext, "$.item.sourcePayload.title"), "示例新闻标题");
    equal(getByJsonPath(baseContext, "$.answers.summary"), "这是一段已经填写的新闻摘要");
    equal(getByJsonPath(baseContext, "$.answers.missing"), undefined);
  });
});

describe("Expression evaluator", () => {
  test("支持 eq / ne / in / notIn / empty / notEmpty / and / or / not", () => {
    const checks: Array<[Expression, boolean]> = [
      [expression("eq", 1, 1), true],
      [expression("ne", 1, 2), true],
      [
        { op: "in", left: { kind: "literal", value: "a" }, right: [{ kind: "literal", value: "a" }] },
        true,
      ],
      [
        { op: "notIn", left: { kind: "literal", value: "b" }, right: [{ kind: "literal", value: "a" }] },
        true,
      ],
      [{ op: "empty", value: { kind: "literal", value: [] } }, true],
      [{ op: "notEmpty", value: { kind: "path", path: "$.item.sourcePayload.title" } }, true],
      [
        {
          op: "and",
          items: [expression("eq", 1, 1), { op: "not", item: expression("eq", 1, 2) }],
        },
        true,
      ],
      [
        {
          op: "or",
          items: [expression("eq", 1, 2), expression("eq", 3, 3)],
        },
        true,
      ],
    ];

    for (const [item, expected] of checks) {
      equal(evaluateExpression(item, baseContext), expected);
    }
  });
});

describe("Visibility 与 disabled 解析", () => {
  test("hidden 优先级高于 visibleWhen", () => {
    const field = fieldByName("rewriteSuggestion");
    const node = { ...field, hidden: true };

    equal(resolveNodeVisibility(node, baseContext), false);
  });

  test("visibleWhen 可以控制运行时可见性", () => {
    const field = fieldByName("rewriteSuggestion");

    equal(resolveNodeVisibility(field, baseContext), true);
    equal(resolveNodeVisibility(field, { ...baseContext, answers: { qualityRating: "pass" } }), false);
  });

  test("disabled 优先级高于 disabledWhen", () => {
    const field = fieldByName("summary");

    equal(resolveNodeDisabled({ ...field, disabled: true }, baseContext), true);
    equal(
      resolveNodeDisabled(
        {
          ...field,
          disabledWhen: {
            op: "eq",
            left: { kind: "path", path: "$.answers.qualityRating" },
            right: { kind: "literal", value: "needs_revision" },
          },
        },
        baseContext,
      ),
      true,
    );
  });
});

describe("Answer normalization", () => {
  test("normalizeAnswers 会移除 unknown field", () => {
    const result = normalizeAnswers(
      cloneSchema(),
      { qualityRating: "pass", summary: "有效摘要内容", unknownField: "会被移除" },
      baseContext,
    );

    deepEqual(Object.keys(result.answers).sort(), ["qualityRating", "summary"]);
  });

  test("normalizeAnswers 默认移除 hidden field", () => {
    const schema = schemaWithHiddenField(false);
    const result = normalizeAnswers(schema, { hiddenNote: "隐藏值" }, baseContext);

    deepEqual(result.answers, {});
  });

  test("preserveWhenHidden 为 true 时保留 hidden field", () => {
    const schema = schemaWithHiddenField(true);
    const result = normalizeAnswers(schema, { hiddenNote: "隐藏值" }, baseContext);

    deepEqual(result.answers, { hiddenNote: "隐藏值" });
  });
});

describe("Answer validation", () => {
  test("validateAnswers 校验 required / minLength / radio option", () => {
    const schema = cloneSchema();

    const missing = validateAnswers(schema, {}, baseContext);
    const tooShort = validateAnswers(schema, { qualityRating: "pass", summary: "太短" }, baseContext);
    const invalidOption = validateAnswers(schema, { qualityRating: "unknown", summary: "这是一段足够长的摘要" }, baseContext);

    equal(missing.errors.some((error) => error.fieldName === "qualityRating"), true);
    equal(tooShort.errors.some((error) => error.fieldName === "summary"), true);
    equal(invalidOption.errors.some((error) => error.fieldName === "qualityRating"), true);
  });

  test("hidden required 字段默认跳过，validateWhenHidden 为 true 时仍校验", () => {
    const skipped = validateAnswers(schemaWithHiddenRequired(false), {}, baseContext);
    const enforced = validateAnswers(schemaWithHiddenRequired(true), {}, baseContext);

    equal(skipped.errors.some((error) => error.fieldName === "hiddenRequired"), false);
    equal(enforced.errors.some((error) => error.fieldName === "hiddenRequired"), true);
  });
});

describe("Schema guards", () => {
  test("LLM output binding 指向不存在 FieldNode.name 时失败", () => {
    const schema = cloneSchema();
    const llmNode = collectLLMAssistNodes(schema)[0];
    if (llmNode === undefined || llmNode.outputBindings === undefined) {
      throw new Error("示例 schema 必须包含 LLM output binding");
    }
    llmNode.outputBindings[0] = {
      from: "$.output.summary",
      toFieldName: "missingField",
      mode: "REPLACE",
      requireUserConfirm: true,
    };

    const result = validateLLMOutputBindings(schema);

    equal(result.valid, false);
    equal(result.errors.some((error) => error.code === "SCHEMA_INVALID"), true);
  });

  test("ShowItem path 使用非法 namespace 时失败", () => {
    const schema = cloneSchema();
    const showItem = collectShowItemNodes(schema)[0];
    if (showItem === undefined) {
      throw new Error("示例 schema 必须包含 ShowItem");
    }
    showItem.sourcePath = "$.sourcePayload.title";

    const result = validateShowItemPaths(schema);

    equal(result.valid, false);
    equal(result.errors.some((error) => error.code === "INVALID_JSON_PATH"), true);
  });
});

function cloneSchema(): LabelHubSchema {
  return JSON.parse(JSON.stringify(createNewsQualitySchema())) as LabelHubSchema;
}

function fieldByName(name: string) {
  const field = findFieldByName(cloneSchema(), name);
  if (field === undefined) {
    throw new Error(`示例 schema 缺少字段：${name}`);
  }
  return field;
}

function schemaWithHiddenField(preserveWhenHidden: boolean): LabelHubSchema {
  const schema = cloneSchema();
  schema.root.children.push({
    id: "hidden_note",
    kind: "FIELD",
    type: "input.text",
    name: "hiddenNote",
    title: "隐藏说明",
    hidden: true,
    preserveWhenHidden,
  });
  return schema;
}

function schemaWithHiddenRequired(validateWhenHidden: boolean): LabelHubSchema {
  const schema = cloneSchema();
  schema.root.children.push({
    id: "hidden_required",
    kind: "FIELD",
    type: "input.text",
    name: "hiddenRequired",
    title: "隐藏必填",
    hidden: true,
    validateWhenHidden,
    required: true,
  });
  return schema;
}

function expression(op: "eq" | "ne", left: unknown, right: unknown): Expression {
  return {
    op,
    left: { kind: "literal", value: left },
    right: { kind: "literal", value: right },
  };
}
