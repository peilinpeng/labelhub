import { deepEqual, equal, notEqual, ok, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import type { LabelHubSchema } from "@labelhub/contracts";
import { runSchemaPreflight } from "../preflight.ts";

// ---------------------------------------------------------------------------
// 测试 schema 构造工具
// ---------------------------------------------------------------------------

function makeSimpleSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_preflight_test",
    status: "DRAFT",
    meta: {
      name: "Preflight 测试",
      taskId: "task_preflight_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "field_a",
          kind: "FIELD",
          type: "input.text",
          name: "fieldA",
          title: "字段 A",
        },
        {
          id: "field_b",
          kind: "FIELD",
          type: "input.text",
          name: "fieldB",
          title: "字段 B",
        },
      ],
    },
  };
}

function makeVisibleWhenSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_vw_test",
    status: "DRAFT",
    meta: {
      name: "VisibleWhen 测试",
      taskId: "task_preflight_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "trigger",
          kind: "FIELD",
          type: "choice.radio",
          name: "trigger",
          title: "触发器",
          options: [
            { label: "是", value: "yes" },
            { label: "否", value: "no" },
          ],
          disabledWhen: {
            op: "eq",
            left: { kind: "path", path: "$.answers.trigger" },
            right: { kind: "literal", value: "no" },
          },
        },
        {
          id: "target",
          kind: "FIELD",
          type: "input.text",
          name: "target",
          title: "目标字段",
          required: true,
          visibleWhen: {
            op: "eq",
            left: { kind: "path", path: "$.answers.trigger" },
            right: { kind: "literal", value: "yes" },
          },
        },
      ],
    },
  };
}

function makeLinkageRulesSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_lr_test",
    status: "DRAFT",
    meta: {
      name: "LinkageRules 测试",
      taskId: "task_preflight_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "score",
          kind: "FIELD",
          type: "choice.radio",
          name: "score",
          title: "评分",
          options: [
            { label: "低", value: "low" },
            { label: "高", value: "high" },
          ],
          linkageRules: [
            {
              id: "R-score-note",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.score" },
                right: { kind: "literal", value: "low" },
              },
              effects: [
                { action: "setVisible", target: "note", value: true },
                { action: "setRequired", target: "note", value: true },
              ],
              otherwise: [
                { action: "setVisible", target: "note", value: false },
                { action: "setRequired", target: "note", value: false },
                { action: "clearValue", target: "note" },
              ],
            },
          ],
        },
        {
          id: "note",
          kind: "FIELD",
          type: "input.text",
          name: "note",
          title: "备注",
        },
        {
          id: "options_field",
          kind: "FIELD",
          type: "choice.radio",
          name: "optionsField",
          title: "选项字段",
          options: [],
          linkageRules: [
            {
              id: "R-set-options",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.score" },
                right: { kind: "literal", value: "low" },
              },
              effects: [
                {
                  action: "setOptions",
                  target: "optionsField",
                  options: [{ label: "X", value: "x" }],
                },
              ],
              otherwise: [],
            },
          ],
        },
      ],
    },
  };
}

function makeSetValueSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_sv_test",
    status: "DRAFT",
    meta: {
      name: "setValue 测试",
      taskId: "task_preflight_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "trigger",
          kind: "FIELD",
          type: "input.text",
          name: "trigger",
          title: "触发器",
          linkageRules: [
            {
              id: "R-set-value",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.trigger" },
                right: { kind: "literal", value: "auto" },
              },
              effects: [{ action: "setValue", target: "output", value: "已自动填充" }],
              otherwise: [],
            },
          ],
        },
        {
          id: "output",
          kind: "FIELD",
          type: "input.text",
          name: "output",
          title: "输出字段",
        },
      ],
    },
  };
}

function makeSetWarningSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_sw_test",
    status: "DRAFT",
    meta: {
      name: "setWarning 测试",
      taskId: "task_preflight_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根",
      children: [
        {
          id: "fld",
          kind: "FIELD",
          type: "input.text",
          name: "fld",
          title: "字段",
          linkageRules: [
            {
              id: "R-warn",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.fld" },
                right: { kind: "literal", value: "warn" },
              },
              effects: [{ action: "setWarning", target: "fld", message: "注意这个值" }],
              otherwise: [],
            },
          ],
        },
      ],
    },
  };
}

function makeSetReadonlySchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_sr_test",
    status: "DRAFT",
    meta: {
      name: "setReadonly 测试",
      taskId: "task_preflight_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根",
      children: [
        {
          id: "fld",
          kind: "FIELD",
          type: "input.text",
          name: "fld",
          title: "字段",
          linkageRules: [
            {
              id: "R-readonly",
              when: {
                op: "eq",
                left: { kind: "path", path: "$.answers.fld" },
                right: { kind: "literal", value: "lock" },
              },
              effects: [{ action: "setReadonly", target: "fld", value: true }],
              otherwise: [],
            },
          ],
        },
      ],
    },
  };
}

function makeDisabledRequiredSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_disabled_req",
    status: "DRAFT",
    meta: {
      name: "测试",
      taskId: "task_preflight_test",
      authorId: "usr_owner",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.group",
      title: "根",
      children: [
        {
          id: "fld",
          kind: "FIELD",
          type: "input.text",
          name: "fld",
          title: "字段",
          required: true,
          disabled: true,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("runSchemaPreflight", () => {
  test("无联动 schema 可以正常返回 ok", () => {
    const result = runSchemaPreflight({
      schema: makeSimpleSchema(),
      currentAnswers: {},
      patch: [],
    });
    strictEqual(result.ok, true);
    strictEqual(result.errors.length, 0);
    strictEqual(result.changedFieldNames.length, 0);
  });

  test("set patch 写入 nextAnswers 并记录 changedFieldNames", () => {
    const result = runSchemaPreflight({
      schema: makeSimpleSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "fieldA", value: "hello" }],
    });
    strictEqual(result.nextAnswers["fieldA"], "hello");
    ok(result.changedFieldNames.includes("fieldA"));
    strictEqual(result.ok, true);
  });

  test("unset patch 删除字段并记录 changedFieldNames", () => {
    const result = runSchemaPreflight({
      schema: makeSimpleSchema(),
      currentAnswers: { fieldA: "旧值" },
      patch: [{ op: "unset", fieldName: "fieldA" }],
    });
    strictEqual(result.nextAnswers["fieldA"], undefined);
    ok(result.changedFieldNames.includes("fieldA"));
  });

  test("patch target 不存在时返回 blocking error", () => {
    const result = runSchemaPreflight({
      schema: makeSimpleSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "notExists", value: "x" }],
    });
    strictEqual(result.ok, false);
    ok(result.errors.some((e) => e.code === "PATCH_TARGET_FIELD_NOT_FOUND"));
  });

  test("visibleWhen 导致字段 hidden", () => {
    // trigger=no → target visibleWhen(trigger=yes) 不满足 → hidden
    const result = runSchemaPreflight({
      schema: makeVisibleWhenSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "trigger", value: "no" }],
    });
    ok(result.hiddenFieldNames.includes("target"), "target 应在 hiddenFieldNames");
    strictEqual(result.fieldStates["target"]?.visible, false);
  });

  test("disabledWhen 导致字段 disabled", () => {
    // trigger=no → disabledWhen 满足 → trigger 被禁用
    const result = runSchemaPreflight({
      schema: makeVisibleWhenSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "trigger", value: "no" }],
    });
    ok(result.disabledFieldNames.includes("trigger"), "trigger 应在 disabledFieldNames");
    strictEqual(result.fieldStates["trigger"]?.disabled, true);
  });

  test("linkageRules setVisible+setRequired 导致 REQUIRED_FIELD_MISSING", () => {
    // score=low → note visible+required，但 note 值为空
    const result = runSchemaPreflight({
      schema: makeLinkageRulesSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "score", value: "low" }],
    });
    ok(result.requiredMissingFieldNames.includes("note"));
    ok(result.errors.some((e) => e.code === "REQUIRED_FIELD_MISSING" && e.fieldName === "note"));
    strictEqual(result.ok, false);
  });

  test("linkageRules clearValue 清空已有值并记录 FIELD_WILL_BE_CLEARED warning", () => {
    // note 有旧值，切换到 score=high → clearValue(note) 触发
    const result = runSchemaPreflight({
      schema: makeLinkageRulesSchema(),
      currentAnswers: { score: "low", note: "旧内容" },
      patch: [{ op: "set", fieldName: "score", value: "high" }],
    });
    ok(result.clearedFieldNames.includes("note"));
    strictEqual(result.nextAnswers["note"], undefined);
    ok(result.warnings.some((w) => w.code === "FIELD_WILL_BE_CLEARED" && w.fieldName === "note"));
  });

  test("hidden required 字段不产生 REQUIRED_FIELD_MISSING", () => {
    // score=high → otherwise → note hidden
    const result = runSchemaPreflight({
      schema: makeLinkageRulesSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "score", value: "high" }],
    });
    ok(result.hiddenFieldNames.includes("note"), "note 应被隐藏");
    ok(!result.requiredMissingFieldNames.includes("note"), "hidden 字段不应出现在 requiredMissingFieldNames");
  });

  test("disabled required 字段不作为 requiredMissingFieldNames blocker", () => {
    const result = runSchemaPreflight({
      schema: makeDisabledRequiredSchema(),
      currentAnswers: {},
      patch: [],
    });
    ok(!result.requiredMissingFieldNames.includes("fld"), "disabled 字段不应为 required missing blocker");
    strictEqual(result.ok, true);
  });

  test("setValue 静态值写入 nextAnswers", () => {
    const result = runSchemaPreflight({
      schema: makeSetValueSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "trigger", value: "auto" }],
    });
    strictEqual(result.nextAnswers["output"], "已自动填充");
    ok(result.changedFieldNames.includes("output"));
  });

  test("setOptions 不阻断，但产生 OPTIONS_WILL_CHANGE warning", () => {
    const result = runSchemaPreflight({
      schema: makeLinkageRulesSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "score", value: "low" }],
    });
    // setOptions 本身不 blocking；ok=false 是因为 REQUIRED_FIELD_MISSING
    ok(result.warnings.some((w) => w.code === "OPTIONS_WILL_CHANGE"));
  });

  test("setWarning 不阻断", () => {
    const result = runSchemaPreflight({
      schema: makeSetWarningSchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "fld", value: "warn" }],
    });
    strictEqual(result.ok, true);
    ok(result.warnings.some((w) => w.code === "SET_WARNING_EFFECT"));
  });

  test("setReadonly 不阻断", () => {
    const result = runSchemaPreflight({
      schema: makeSetReadonlySchema(),
      currentAnswers: {},
      patch: [{ op: "set", fieldName: "fld", value: "lock" }],
    });
    strictEqual(result.ok, true);
    ok(result.warnings.some((w) => w.code === "SET_READONLY_EFFECT"));
  });

  test("输出数组稳定排序", () => {
    const result = runSchemaPreflight({
      schema: makeSimpleSchema(),
      currentAnswers: {},
      patch: [
        { op: "set", fieldName: "fieldB", value: "b" },
        { op: "set", fieldName: "fieldA", value: "a" },
      ],
    });
    const sorted = [...result.changedFieldNames].sort();
    deepEqual(result.changedFieldNames, sorted);
  });

  test("不修改原始 currentAnswers", () => {
    const currentAnswers = { fieldA: "原始值" };
    runSchemaPreflight({
      schema: makeSimpleSchema(),
      currentAnswers,
      patch: [{ op: "set", fieldName: "fieldB", value: "新值" }],
    });
    deepEqual(currentAnswers, { fieldA: "原始值" });
  });

  test("patch 写入的字段被隐藏时产生 PATCH_TARGET_BECOMES_HIDDEN warning", () => {
    // trigger 初始值为 no（→ target hidden），patch 直接写 target
    const result = runSchemaPreflight({
      schema: makeVisibleWhenSchema(),
      currentAnswers: { trigger: "no" },
      patch: [{ op: "set", fieldName: "target", value: "x" }],
    });
    ok(
      result.warnings.some((w) => w.code === "PATCH_TARGET_BECOMES_HIDDEN" && w.fieldName === "target"),
      "应有 PATCH_TARGET_BECOMES_HIDDEN warning",
    );
  });
});
