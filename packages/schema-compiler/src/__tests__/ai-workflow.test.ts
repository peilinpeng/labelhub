import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import type { AIAssistEngineInput, LLMAssistNode } from "@labelhub/contracts";
import { baseContext, cloneSchema } from "../../../contracts/src/__tests__/fixtures.ts";
import { runAIAssistEngine, assertAIOutputSchema } from "../ai-workflow.ts";
function input(): AIAssistEngineInput {
  const schema = cloneSchema();
  schema.root.children = [
    { id: "text", kind: "FIELD", type: "input.text", title: "理由", name: "reason", validations: [{ type: "maxLength", value: 10 }] },
    { id: "choice", kind: "FIELD", type: "choice.radio", title: "评分", name: "score", options: [{ label: "好", value: "good" }, { label: "差", value: "bad" }] },
    { id: "ai", kind: "LLM_ASSIST", type: "llm.assist", title: "建议", trigger: "MANUAL", inputBindings: { title: "$.item.sourcePayload.title" }, outputMode: "STRUCTURED", outputBindings: [{ from: "$.reason", toFieldName: "reason", mode: "REPLACE", requireUserConfirm: true }, { from: "$.score", toFieldName: "score", mode: "REPLACE", requireUserConfirm: true }] },
  ];
  return { action: "VALIDATE", schema, context: { ...structuredClone(baseContext), answers: {} }, nodeId: "ai", output: { reason: "依据原文", score: "bad" } };
}
test("输入绑定读取真实材料，补丁保留类型且不改写输入", () => {
  const i = input(); const before = structuredClone(i);
  deepEqual({ ...runAIAssistEngine(i).suggestedPatch }, { reason: "依据原文", score: "bad" });
  deepEqual(i, before);
  deepEqual({ ...runAIAssistEngine(i).bindings }, { title: "示例新闻标题" });
});
test("未知选项、文本类型、长度、缺失绑定输出均拒绝", () => {
  for (const output of [{ reason: "ok", score: "unknown" }, { reason: 1, score: "bad" }, { reason: "a".repeat(11), score: "bad" }, { reason: "ok" }]) throws(() => runAIAssistEngine({ ...input(), output }));
});
test("缺失材料标记、危险路径拒绝", () => {
  const i = input(); i.action = "PREPARE";
  const node = i.schema.root.children[2] as LLMAssistNode;
  node.inputBindings = { missing: "$.item.sourcePayload.absent" };
  deepEqual(runAIAssistEngine(i).missingInputs, ["missing"]);
  node.inputBindings = { bad: "$.answers.__proto__" };
  throws(() => runAIAssistEngine(i));
});
test("静态与材料驱动的禁用字段不能写入", () => {
  const i = input(); i.schema.root.children[0]!.disabledWhen = { op: "eq", left: { kind: "path", path: "$.item.sourcePayload.title" }, right: { kind: "literal", value: "示例新闻标题" } };
  throws(() => runAIAssistEngine(i));
});
test("字段与容器隐藏不允许 AI 调用或写入", () => {
  const i = input(); i.schema.root.hidden = true;
  throws(() => runAIAssistEngine(i));
});
test("输出 Schema 拒绝额外属性、越界、未知关键字和错误数组项", () => {
  const schema = { type: "object", required: ["score"], additionalProperties: false, properties: { score: { type: "number", minimum: 0, maximum: 5 } } };
  assertAIOutputSchema({ score: 3 }, schema);
  for (const value of [{ score: 6 }, { score: "3" }, { score: 3, extra: true }, {}]) throws(() => assertAIOutputSchema(value, schema));
  throws(() => assertAIOutputSchema(1, { type: "number", unsupported: true }));
  throws(() => assertAIOutputSchema([1, "a"], { type: "array", items: { type: "integer" } }));
});
test("APPEND 使用当前值，用户仍需确认最终补丁", () => {
  const i = input(); const node = i.schema.root.children[2] as LLMAssistNode;
  node.outputBindings![0]!.mode = "APPEND"; i.context.answers.reason = "已有";
  deepEqual({ ...runAIAssistEngine(i).suggestedPatch }, { reason: "已有依据原文", score: "bad" });
});
test("输出未包含的属性也不能隐藏不支持的 Schema", () => {
  throws(() => assertAIOutputSchema({}, { type: "object", properties: { optional: { type: "string", pattern: "x" } } }));
});
test("新建议触发必填字段时服务端阻止返回可采纳补丁", () => {
  const i = input();
  const reason = i.schema.root.children[0];
  if (!reason || reason.kind !== "FIELD") throw new Error("测试字段缺失");
  reason.linkageRules = [{ id: "need-extra", when: { op: "eq", left: { kind: "path", path: "$.answers.score" }, right: { kind: "literal", value: "bad" } }, effects: [{ action: "setRequired", target: "extra", value: true }] }];
  i.schema.root.children.push({ id: "extra", kind: "FIELD", type: "input.text", title: "补充说明", name: "extra" });
  throws(() => runAIAssistEngine(i));
});
