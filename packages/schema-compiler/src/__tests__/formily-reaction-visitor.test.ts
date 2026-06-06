import { deepEqual, equal, ok } from "node:assert/strict";
import { describe, test } from "node:test";
import type { FieldNode, LabelHubSchema, SchemaNode } from "@labelhub/contracts";
import {
  buildReactionPlan,
  FormilyReactionVisitor,
} from "../formily-reaction-visitor.ts";

describe("FormilyReactionVisitor", () => {
  test("visibleWhen 生成正确的 CompiledReaction", () => {
    const schema = createSchema([
      textField("trigger", "trigger"),
      {
        ...textField("target", "target"),
        visibleWhen: {
          op: "eq",
          left: { kind: "path", path: "$.answers.trigger" },
          right: { kind: "literal", value: "show" },
        },
      },
    ]);

    const plan = new FormilyReactionVisitor().visit(schema);

    equal(plan.reactions.length, 1);
    const r = plan.reactions[0];
    ok(r !== undefined);
    equal(r.source, "visibleWhen");
    equal(r.ruleId, "visibleWhen:target");
    deepEqual(r.triggerFieldNames, ["trigger"]);
    deepEqual(r.effects, [{ action: "setVisible", target: "target", value: true }]);
    deepEqual(r.otherwise, [{ action: "setVisible", target: "target", value: false }]);
  });

  test("disabledWhen 生成正确的 CompiledReaction", () => {
    const schema = createSchema([
      textField("flag", "flag"),
      {
        ...textField("guarded", "guarded"),
        disabledWhen: {
          op: "notEmpty",
          value: { kind: "path", path: "$.answers.flag" },
        },
      },
    ]);

    const plan = buildReactionPlan(schema);

    equal(plan.reactions.length, 1);
    const r = plan.reactions[0];
    ok(r !== undefined);
    equal(r.source, "disabledWhen");
    equal(r.ruleId, "disabledWhen:guarded");
    deepEqual(r.triggerFieldNames, ["flag"]);
    deepEqual(r.effects, [{ action: "setDisabled", target: "guarded", value: true }]);
    deepEqual(r.otherwise, [{ action: "setDisabled", target: "guarded", value: false }]);
  });

  test("linkageRules 直通 effects 和 otherwise", () => {
    const schema = createSchema([
      {
        ...choiceField("result", "result"),
        linkageRules: [
          {
            id: "R-show-reason",
            when: {
              op: "eq",
              left: { kind: "path", path: "$.answers.result" },
              right: { kind: "literal", value: "reject" },
            },
            effects: [
              { action: "setVisible", target: "reason", value: true },
              { action: "setRequired", target: "reason", value: true },
            ],
            otherwise: [
              { action: "setVisible", target: "reason", value: false },
              { action: "clearValue", target: "reason" },
            ],
          },
        ],
      },
      textField("reason_node", "reason"),
    ]);

    const plan = buildReactionPlan(schema);

    equal(plan.reactions.length, 1);
    const r = plan.reactions[0];
    ok(r !== undefined);
    equal(r.source, "linkageRule");
    equal(r.ruleId, "R-show-reason");
    deepEqual(r.triggerFieldNames, ["result"]);
    deepEqual(r.effects, [
      { action: "setVisible", target: "reason", value: true },
      { action: "setRequired", target: "reason", value: true },
    ]);
    deepEqual(r.otherwise, [
      { action: "setVisible", target: "reason", value: false },
      { action: "clearValue", target: "reason" },
    ]);
  });

  test("linkageRule 无 otherwise 时 otherwise 为空数组", () => {
    const schema = createSchema([
      {
        ...choiceField("flag", "flag"),
        linkageRules: [
          {
            id: "R-no-otherwise",
            when: {
              op: "notEmpty",
              value: { kind: "path", path: "$.answers.flag" },
            },
            effects: [{ action: "setRequired", target: "note", value: true }],
          },
        ],
      },
      textField("note_node", "note"),
    ]);

    const plan = buildReactionPlan(schema);
    const r = plan.reactions[0];
    ok(r !== undefined);
    deepEqual(r.otherwise, []);
  });

  test("字段同时有 visibleWhen 和 linkageRules 时生成多条 reaction", () => {
    const schema = createSchema([
      textField("a", "a"),
      {
        ...textField("b", "b"),
        visibleWhen: {
          op: "notEmpty",
          value: { kind: "path", path: "$.answers.a" },
        },
        linkageRules: [
          {
            id: "R-b-rule",
            when: {
              op: "eq",
              left: { kind: "path", path: "$.answers.a" },
              right: { kind: "literal", value: "x" },
            },
            effects: [{ action: "setDisabled", target: "b", value: true }],
          },
        ],
      },
    ]);

    const plan = buildReactionPlan(schema);
    equal(plan.reactions.length, 2);
    equal(plan.reactions[0]?.source, "visibleWhen");
    equal(plan.reactions[1]?.source, "linkageRule");
  });

  test("ContainerNode 的 visibleWhen 不生成 reaction", () => {
    const schema = createSchema([
      textField("cat", "cat"),
      {
        id: "group",
        kind: "CONTAINER",
        type: "container.group",
        title: "条件容器",
        visibleWhen: {
          op: "eq",
          left: { kind: "path", path: "$.answers.cat" },
          right: { kind: "literal", value: "A" },
        },
        children: [textField("inner", "inner")],
      },
    ]);

    const plan = buildReactionPlan(schema);
    equal(plan.reactions.length, 0);
  });

  test("schema 无任何联动时返回空 reactions", () => {
    const schema = createSchema([
      textField("a", "a"),
      textField("b", "b"),
    ]);

    const plan = buildReactionPlan(schema);
    deepEqual(plan.reactions, []);
  });

  test("triggerFieldNames 只收集 $.answers 下的字段名，排除其他命名空间", () => {
    const schema = createSchema([
      {
        ...textField("target_node", "target"),
        visibleWhen: {
          op: "and",
          items: [
            {
              op: "eq",
              left: { kind: "path", path: "$.answers.trigger" },
              right: { kind: "literal", value: "yes" },
            },
            {
              op: "notEmpty",
              value: { kind: "path", path: "$.item.sourcePayload.title" },
            },
          ],
        },
      },
    ]);

    const plan = buildReactionPlan(schema);
    const r = plan.reactions[0];
    ok(r !== undefined);
    deepEqual(r.triggerFieldNames, ["trigger"]);
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
