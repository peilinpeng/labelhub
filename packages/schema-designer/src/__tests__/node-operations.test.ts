import { createEmptySchema, createDefaultNode } from "@labelhub/schema-core";
import { describe, expect, test } from "vitest";
import { insertNode, reorderNode } from "../node-operations";
import { prepareNodeForInsert } from "../node-operations";

function schemaWithNodes(ids: string[]) {
  let schema = createEmptySchema("task_test", "usr_test");
  for (const id of ids) {
    const node = { ...prepareNodeForInsert(schema, createDefaultNode("input.text")), id };
    schema = insertNode(schema, undefined, node);
  }
  return schema;
}

function childIds(schema: ReturnType<typeof createEmptySchema>) {
  return schema.root.children.map((c) => c.id);
}

describe("reorderNode（拖拽重排）", () => {
  test("把后面的节点拖到前面，顺序更新", () => {
    const schema = schemaWithNodes(["a", "b", "c"]);
    const next = reorderNode(schema, "c", "a"); // c 移到 a 之前
    expect(childIds(next)).toEqual(["c", "a", "b"]);
  });

  test("把前面的节点拖到后面（目标在其后），插入到目标之前", () => {
    const schema = schemaWithNodes(["a", "b", "c"]);
    const next = reorderNode(schema, "a", "c"); // a 移到 c 之前
    expect(childIds(next)).toEqual(["b", "a", "c"]);
  });

  test("拖到自身 = 无变化", () => {
    const schema = schemaWithNodes(["a", "b", "c"]);
    const next = reorderNode(schema, "b", "b");
    expect(childIds(next)).toEqual(["a", "b", "c"]);
  });

  test("不存在的节点 = 原样返回", () => {
    const schema = schemaWithNodes(["a", "b"]);
    const next = reorderNode(schema, "x", "a");
    expect(childIds(next)).toEqual(["a", "b"]);
  });
});
