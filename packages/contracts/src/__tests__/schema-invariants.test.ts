import { describe, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import type { LabelHubSchema, PublishedLabelHubSchema } from "../index";
import {
  assertAIGeneratedSchemaDraft,
  assertPublishedSchemaImmutable,
  collectSchemaNodes,
  isAllowedRuntimeJsonPath,
  validateSchemaInvariants,
} from "../utils/contract-guards";
import { baseSchema, cloneSchema } from "./fixtures";

describe("Schema 不变量", () => {
  test("一个 schema tree 内 node.id 必须全局唯一", () => {
    const schema = cloneSchema();
    const firstNode = schema.root.children[0];
    if (firstNode === undefined) {
      throw new Error("示例 schema 必须至少包含一个子节点");
    }
    schema.root.children.push({ ...firstNode });

    const violations = validateSchemaInvariants(schema);

    equal(violations.some((item) => item.code === "NODE_ID_DUPLICATED"), true);
  });

  test("一个 schema version 内 FieldNode.name 必须全局唯一", () => {
    const schema = cloneSchema();
    schema.root.children.push({
      id: "duplicate_field_name",
      kind: "FIELD",
      type: "input.text",
      name: "newsCategory",
      title: "重复字段",
    });

    const violations = validateSchemaInvariants(schema);

    equal(violations.some((item) => item.code === "FIELD_NAME_DUPLICATED"), true);
  });

  test("ShowItem、Container、LLMAssist 默认不写入 answers", () => {
    const writableNodes = collectSchemaNodes(baseSchema).filter((node) => node.kind === "FIELD");
    const nonWritableNodes = collectSchemaNodes(baseSchema).filter((node) => node.kind !== "FIELD");

    ok(writableNodes.length > 0);
    equal(nonWritableNodes.every((node) => !("name" in node)), true);
  });

  test("unknown node type 返回 UNKNOWN_NODE_TYPE", () => {
    const schema = cloneSchema();
    const brokenSchema = {
      ...schema,
      root: {
        ...schema.root,
        children: [
          ...schema.root.children,
          {
            id: "unknown_node",
            kind: "FIELD",
            type: "unknown.node",
            name: "unknownNode",
            title: "未知节点",
          },
        ],
      },
    };

    const violations = validateSchemaInvariants(brokenSchema);

    equal(violations.some((item) => item.code === "UNKNOWN_NODE_TYPE"), true);
  });

  test("JsonPath 必须使用 RuntimeContext 命名空间", () => {
    equal(isAllowedRuntimeJsonPath("$.answers.newsCategory"), true);
    equal(isAllowedRuntimeJsonPath("$.item.sourcePayload.title"), true);
    equal(isAllowedRuntimeJsonPath("$.sourcePayload.title"), false);
    equal(isAllowedRuntimeJsonPath("$.output.summary"), false);
    equal(isAllowedRuntimeJsonPath("$.output.summary", { allowOutput: true }), true);
  });

  test("AI-generated schema 只能是 DRAFT", () => {
    const draft = cloneSchema();
    const published = {
      ...cloneSchema(),
      status: "PUBLISHED",
      schemaVersionId: "sv_news_quality_1",
      schemaVersionNo: 1,
    } satisfies LabelHubSchema;

    deepEqual(assertAIGeneratedSchemaDraft(draft), []);
    equal(assertAIGeneratedSchemaDraft(published).some((item) => item.code === "SCHEMA_INVALID"), true);
  });

  test("published schema version 不可变", () => {
    const published = {
      ...cloneSchema(),
      status: "PUBLISHED",
      schemaVersionId: "sv_news_quality_1",
      schemaVersionNo: 1,
    } satisfies PublishedLabelHubSchema;
    const changed = {
      ...published,
      meta: { ...published.meta, name: "被修改的模板" },
    };

    equal(assertPublishedSchemaImmutable(published, published).length, 0);
    equal(assertPublishedSchemaImmutable(published, changed).some((item) => item.code === "SCHEMA_VERSION_IMMUTABLE"), true);
  });
});
