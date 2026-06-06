import { equal } from "node:assert/strict";
import { describe, test } from "node:test";
import type { LabelHubSchema } from "@labelhub/contracts";
import { validateSchemaShape } from "../index.ts";

describe("Schema guards deprecation 集成", () => {
  test("replacementFieldName 不存在能进入 guard error", () => {
    const schema = createSchema("missingField", false);
    const result = validateSchemaShape(schema);

    equal(result.valid, false);
    equal(result.errors.some((error) => error.message.includes("DEPRECATED_FIELD_REPLACEMENT_NOT_FOUND")), true);
  });

  test("deprecated warning 不破坏现有 schema guard 行为", () => {
    const schema = createSchema("newSummary", true);
    const result = validateSchemaShape(schema);

    equal(result.valid, true);
    equal(result.warnings.some((warning) => warning.message.includes("DEPRECATED_FIELD_REQUIRED")), true);
  });
});

function createSchema(replacementFieldName: string, required: boolean): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_guard_deprecation",
    status: "DRAFT",
    meta: {
      name: "Schema guard deprecation 测试",
      taskId: "task_deprecation",
      authorId: "usr_deprecation",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
    },
    root: {
      id: "root_guard_deprecation",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "field_old_summary",
          kind: "FIELD",
          type: "input.text",
          title: "旧摘要",
          name: "oldSummary",
          required,
          deprecation: {
            deprecated: true,
            reason: "请使用新摘要",
            replacementFieldName,
            hideForNewSubmissions: true,
          },
        },
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
