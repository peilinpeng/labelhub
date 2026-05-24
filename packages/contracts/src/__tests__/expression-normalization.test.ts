import { describe, test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import type { Expression, LabelHubSchema } from "../index";
import {
  evaluateExpression,
  normalizeAnswers,
  validateRequiredFields,
} from "../utils/contract-guards";
import { baseContext, cloneSchema } from "./fixtures";

describe("表达式求值", () => {
  test("支持 eq / ne / in / notIn / empty / notEmpty / and / or / not", () => {
    const expressions: Array<[Expression, boolean]> = [
      [{ op: "eq", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 1 } }, true],
      [{ op: "ne", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } }, true],
      [{ op: "in", left: { kind: "literal", value: "a" }, right: [{ kind: "literal", value: "a" }] }, true],
      [{ op: "notIn", left: { kind: "literal", value: "b" }, right: [{ kind: "literal", value: "a" }] }, true],
      [{ op: "empty", value: { kind: "literal", value: [] } }, true],
      [{ op: "notEmpty", value: { kind: "literal", value: "x" } }, true],
      [
        {
          op: "and",
          items: [
            { op: "eq", left: { kind: "literal", value: true }, right: { kind: "literal", value: true } },
            { op: "not", item: { op: "eq", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } } },
          ],
        },
        true,
      ],
      [
        {
          op: "or",
          items: [
            { op: "eq", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 2 } },
            { op: "eq", left: { kind: "literal", value: 3 }, right: { kind: "literal", value: 3 } },
          ],
        },
        true,
      ],
    ];

    for (const [expression, expected] of expressions) {
      equal(evaluateExpression(expression, baseContext), expected);
    }
  });

  test("visibleWhen 可以读取 $.answers 与 $.item.sourcePayload", () => {
    equal(
      evaluateExpression(
        { op: "eq", left: { kind: "path", path: "$.answers.qualityScore" }, right: { kind: "literal", value: "2" } },
        baseContext,
      ),
      true,
    );
    equal(
      evaluateExpression(
        { op: "notEmpty", value: { kind: "path", path: "$.item.sourcePayload.title" } },
        baseContext,
      ),
      true,
    );
  });

  test("hidden required 字段默认不阻止提交", () => {
    const schema = schemaWithHiddenRequired(false);
    const errors = validateRequiredFields(schema, { newsCategory: "technology", qualityScore: "5" }, baseContext);

    deepEqual(errors, []);
  });

  test("validateWhenHidden 为 true 时，隐藏字段仍执行校验", () => {
    const schema = schemaWithHiddenRequired(true);
    const errors = validateRequiredFields(schema, { newsCategory: "technology", qualityScore: "5" }, baseContext);

    equal(errors.some((item) => item.fieldName === "hiddenRequired"), true);
  });
});

describe("答案归一化", () => {
  test("answers 只能包含可提交 FieldNode", () => {
    const { answers } = normalizeAnswers(
      cloneSchema(),
      {
        newsCategory: "technology",
        qualityScore: "5",
        show_title: "不应提交",
        ai_quality_helper: "不应提交",
      },
      baseContext,
    );

    deepEqual(Object.keys(answers).sort(), ["newsCategory", "qualityScore"]);
  });

  test("hidden 字段默认移除", () => {
    const schema = schemaWithHiddenField(false);
    const { answers } = normalizeAnswers(schema, { hiddenText: "已有值" }, baseContext);

    deepEqual(answers, {});
  });

  test("preserveWhenHidden 为 true 时保留已有值", () => {
    const schema = schemaWithHiddenField(true);
    const { answers } = normalizeAnswers(schema, { hiddenText: "已有值" }, baseContext);

    deepEqual(answers, { hiddenText: "已有值" });
  });

  test("choice.radio 只接受 string", () => {
    const { errors } = normalizeAnswers(cloneSchema(), { newsCategory: ["technology"] }, baseContext);

    equal(errors.some((item) => item.fieldName === "newsCategory"), true);
  });

  test("choice.checkbox 只接受 string[]", () => {
    const schema = cloneSchema();
    schema.root.children.push({
      id: "checkbox_field",
      kind: "FIELD",
      type: "choice.checkbox",
      name: "checkboxField",
      title: "多选字段",
      options: [
        { label: "选项 A", value: "a" },
        { label: "选项 B", value: "b" },
      ],
    });
    const { errors } = normalizeAnswers(schema, { checkboxField: "a" }, baseContext);

    equal(errors.some((item) => item.fieldName === "checkboxField"), true);
  });

  test("data.json 必须可 JSON 序列化", () => {
    const schema = cloneSchema();
    schema.root.children.push({
      id: "json_payload",
      kind: "FIELD",
      type: "data.json",
      name: "jsonPayload",
      title: "结构化数据",
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const { errors } = normalizeAnswers(schema, { jsonPayload: circular }, baseContext);

    equal(errors.some((item) => item.fieldName === "jsonPayload"), true);
  });
});

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

function schemaWithHiddenField(preserveWhenHidden: boolean): LabelHubSchema {
  const schema = cloneSchema();
  schema.root.children.push({
    id: "hidden_text",
    kind: "FIELD",
    type: "input.text",
    name: "hiddenText",
    title: "隐藏字段",
    hidden: true,
    preserveWhenHidden,
  });
  return schema;
}
