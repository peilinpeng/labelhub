import { deepEqual, equal } from "node:assert/strict";
import { describe, test } from "node:test";
import type { FieldNode, LabelHubSchema, SchemaNode } from "@labelhub/contracts";
import {
  buildDependencyGraph,
  collectExpressionFieldNames,
  DependencyGraphVisitor,
} from "../dependency-graph.ts";
import { collectLinkageRules, parseSchemaToCompilerInput } from "../linkage-rules.ts";

describe("DependencyGraphVisitor", () => {
  test("visibleWhen 和 disabledWhen 会生成字段依赖边", () => {
    const schema = createSchema([
      textField("review_result", "reviewResult"),
      {
        ...textField("reject_reason", "rejectReason"),
        visibleWhen: {
          op: "eq",
          left: { kind: "path", path: "$.answers.reviewResult" },
          right: { kind: "literal", value: "reject" },
        },
      },
      {
        ...textField("review_note", "reviewNote"),
        disabledWhen: {
          op: "notEmpty",
          value: { kind: "path", path: "$.answers.rejectReason" },
        },
      },
    ]);

    const graph = new DependencyGraphVisitor().visit(schema);

    deepEqual(graph.edges, [
      {
        fromFieldName: "reviewResult",
        toFieldName: "rejectReason",
        ruleId: "visibleWhen:reject_reason",
        source: "visibleWhen",
        effectActions: ["setVisible"],
      },
      {
        fromFieldName: "rejectReason",
        toFieldName: "reviewNote",
        ruleId: "disabledWhen:review_note",
        source: "disabledWhen",
        effectActions: ["setDisabled"],
      },
    ]);
  });

  test("linkageRules 会从 when 收集读取字段，并从 effects 和 otherwise 收集目标字段", () => {
    const schema = createSchema([
      {
        ...choiceField("review_result", "reviewResult"),
        linkageRules: [
          {
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
            ],
            otherwise: [
              {
                action: "clearValue",
                target: "rejectReason",
              },
            ],
          },
        ],
      },
      textField("reject_reason_node_id", "rejectReason"),
    ]);

    const graph = buildDependencyGraph(schema);

    deepEqual(graph.edges, [
      {
        fromFieldName: "reviewResult",
        toFieldName: "rejectReason",
        ruleId: "R-review-reject-reason",
        source: "linkageRule",
        effectActions: ["setVisible", "setRequired", "clearValue"],
      },
    ]);
  });

  test("effect.target 表示 FieldNode.name，不按 nodeId 建图", () => {
    const schema = createSchema([
      {
        ...choiceField("review_result_node_id", "reviewResult"),
        linkageRules: [
          {
            id: "R-target-field-name",
            when: {
              op: "eq",
              left: { kind: "path", path: "$.answers.reviewResult" },
              right: { kind: "literal", value: "reject" },
            },
            effects: [
              {
                action: "setDisabled",
                target: "rejectReason",
                value: true,
              },
            ],
          },
        ],
      },
      textField("reject_reason_node_id", "rejectReason"),
    ]);

    const graph = buildDependencyGraph(schema);

    equal(graph.edges[0]?.toFieldName, "rejectReason");
  });

  test("第一版不为 ContainerNode 的 visibleWhen 生成 field edge", () => {
    const schema = createSchema([
      textField("category", "category"),
      {
        id: "conditional_container",
        kind: "CONTAINER",
        type: "container.group",
        title: "条件容器",
        visibleWhen: {
          op: "eq",
          left: { kind: "path", path: "$.answers.category" },
          right: { kind: "literal", value: "A" },
        },
        children: [textField("inside_container", "insideContainer")],
      },
    ]);

    const graph = buildDependencyGraph(schema);

    deepEqual(graph.edges, []);
  });

  test("parseSchemaToCompilerInput 会收集字段和 linkageRules", () => {
    const schema = createSchema([
      {
        ...choiceField("status", "status"),
        linkageRules: [
          {
            id: "R-status-warning",
            when: {
              op: "notEmpty",
              value: { kind: "path", path: "$.answers.status" },
            },
            effects: [
              {
                action: "setWarning",
                target: "comment",
                message: "请检查备注",
              },
            ],
          },
        ],
      },
      textField("comment", "comment"),
    ]);

    const input = parseSchemaToCompilerInput(schema);

    equal(input.fields.length, 2);
    equal(collectLinkageRules(schema).length, 1);
    equal(input.linkageRules[0]?.ownerFieldName, "status");
  });

  test("collectExpressionFieldNames 只收集 $.answers 下的字段名", () => {
    const fieldNames = collectExpressionFieldNames({
      op: "and",
      items: [
        {
          op: "eq",
          left: { kind: "path", path: "$.answers.category" },
          right: { kind: "literal", value: "A" },
        },
        {
          op: "notEmpty",
          value: { kind: "path", path: "$.item.sourcePayload.title" },
        },
        {
          op: "notEmpty",
          value: { kind: "path", path: "$.answers.rejectReason.text" },
        },
      ],
    });

    deepEqual(fieldNames, ["category", "rejectReason"]);
  });
});

function createSchema(children: SchemaNode[]): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_test",
    status: "DRAFT",
    meta: {
      name: "测试 schema",
      taskId: "task_test",
      authorId: "usr_owner",
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children,
    },
  };
}

function textField(id: string, name: string): FieldNode {
  return {
    id,
    kind: "FIELD",
    type: "input.text",
    title: name,
    name,
  };
}

function choiceField(id: string, name: string): FieldNode {
  return {
    id,
    kind: "FIELD",
    type: "choice.radio",
    title: name,
    name,
    options: [
      { label: "通过", value: "pass" },
      { label: "退回", value: "reject" },
    ],
  };
}
