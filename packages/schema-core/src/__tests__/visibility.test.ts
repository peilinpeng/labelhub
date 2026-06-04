import { equal } from "node:assert/strict";
import { describe, test } from "node:test";
import type { FieldNode, RuntimeContextWithOutput } from "@labelhub/contracts";
import { resolveNodeVisibility } from "../index.ts";

const baseContext: RuntimeContextWithOutput = {
  task: {
    id: "task_visibility",
    title: "可见性测试任务",
    status: "PUBLISHED",
    activeSchemaVersionId: "sv_visibility_1",
  },
  schema: {
    schemaId: "schema_visibility",
    schemaVersionId: "sv_visibility_1",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: {
    id: "item_visibility_1",
    sourcePayload: {},
  },
  answers: {},
  system: {
    actor: {
      id: "usr_visibility",
      role: "OWNER",
      displayName: "可见性测试员",
    },
    role: "OWNER",
    now: "2026-05-24T00:00:00.000Z",
  },
};

describe("SchemaVisibilityMode 可见性", () => {
  test("默认调用方式保持旧行为", () => {
    equal(resolveNodeVisibility(deprecatedHiddenField(), baseContext), true);
  });

  test("CREATE visibility mode 下，deprecated + hideForNewSubmissions 字段隐藏", () => {
    equal(resolveNodeVisibility(deprecatedHiddenField(), baseContext, { visibilityMode: "CREATE" }), false);
  });

  test("HISTORICAL visibility mode 下，deprecated + hideForNewSubmissions 字段仍显示", () => {
    equal(resolveNodeVisibility(deprecatedHiddenField(), baseContext, { visibilityMode: "HISTORICAL" }), true);
  });

  test("REVIEW visibility mode 下，deprecated + hideForNewSubmissions 字段仍显示", () => {
    equal(resolveNodeVisibility(deprecatedHiddenField(), baseContext, { visibilityMode: "REVIEW" }), true);
  });

  test("READONLY visibility mode 下，deprecated + hideForNewSubmissions 字段仍显示", () => {
    equal(resolveNodeVisibility(deprecatedHiddenField(), baseContext, { visibilityMode: "READONLY" }), true);
  });

  test("options.visibilityMode 优先于 context.visibilityMode", () => {
    const context: RuntimeContextWithOutput = {
      ...baseContext,
      visibilityMode: "HISTORICAL",
    };

    equal(resolveNodeVisibility(deprecatedHiddenField(), context, { visibilityMode: "CREATE" }), false);
    equal(resolveNodeVisibility(deprecatedHiddenField(), { ...baseContext, visibilityMode: "CREATE" }, { visibilityMode: "HISTORICAL" }), true);
  });
});

function deprecatedHiddenField(): FieldNode {
  return {
    id: "field_old_summary",
    kind: "FIELD",
    type: "input.text",
    title: "旧摘要",
    name: "oldSummary",
    deprecation: {
      deprecated: true,
      reason: "请使用新摘要",
      replacementFieldName: "newSummary",
      hideForNewSubmissions: true,
    },
  };
}
