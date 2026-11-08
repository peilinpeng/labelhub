/** 服务端 AI 辅助只调用共享内核；模型输出不能指定任意写入目标。 */
import type { AIAssistEngineInput, AIAssistEngineResult, AnswerPayload, JsonSchemaLike, LLMAssistNode, SchemaNode } from "@labelhub/contracts";
import { collectFieldNodes, getByJsonPath, resolveNodeDisabled, resolveNodeVisibility, validateAnswers } from "@labelhub/schema-core";
import { runSchemaPreflight } from "./preflight.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function safePath(path: string): void {
  if (path.split(/[.\[\]]/).some((p) => ["__proto__", "constructor", "prototype"].includes(p))) throw new Error("不允许的字段路径");
}

function assertSupportedSchema(schema: JsonSchemaLike, depth = 0): void {
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "description", "title"]);
  if (depth > 20 || Object.keys(schema).some((key) => !allowed.has(key))) throw new Error("输出 Schema 含不支持的关键字或嵌套过深");
  if (typeof schema.type !== "string" || !["string", "number", "integer", "boolean", "object", "array", "null"].includes(schema.type)) throw new Error("输出 Schema 类型配置非法");
  if (schema.properties !== undefined) {
    if (!record(schema.properties)) throw new Error("properties 配置非法");
    for (const [key, value] of Object.entries(schema.properties)) {
      safePath(key);
      if (!record(value)) throw new Error("属性 Schema 配置非法");
      assertSupportedSchema(value, depth + 1);
    }
  }
  if (schema.items !== undefined) {
    if (!record(schema.items)) throw new Error("items 配置非法");
    assertSupportedSchema(schema.items, depth + 1);
  }
  if (schema.type === "array" && schema.items === undefined) throw new Error("数组缺少 items Schema");
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((k) => typeof k === "string"))) throw new Error("required 配置非法");
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") throw new Error("additionalProperties 配置非法");
}

/** 有界 JSON Schema 子集。未知关键字拒绝，不把不支持误当作通过。 */
export function assertAIOutputSchema(value: unknown, schema: JsonSchemaLike, depth = 0): void {
  assertSupportedSchema(schema, depth);
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "description", "title"]);
  if (Object.keys(schema).some((key) => !allowed.has(key))) throw new Error("输出 Schema 含不支持的关键字");
  const types: Record<string, boolean> = { string: typeof value === "string", number: typeof value === "number" && Number.isFinite(value), integer: typeof value === "number" && Number.isSafeInteger(value), boolean: typeof value === "boolean", object: record(value), array: Array.isArray(value), null: value === null };
  if (typeof schema.type !== "string" || types[schema.type] !== true) throw new Error("输出类型不匹配");
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value)))) throw new Error("输出不在允许选项内");
  for (const [key, lower] of [["minimum", true], ["maximum", false], ["minLength", true], ["maxLength", false], ["minItems", true], ["maxItems", false]] as const) {
    if (schema[key] === undefined) continue;
    const bound = schema[key];
    const size = key.endsWith("Length") ? (typeof value === "string" ? [...value].length : undefined) : key.endsWith("Items") ? (Array.isArray(value) ? value.length : undefined) : value;
    if (typeof bound !== "number" || !Number.isFinite(bound) || typeof size !== "number" || (lower ? size < bound : size > bound)) throw new Error("输出范围不合法");
  }
  if (record(value)) {
    if (schema.properties !== undefined && !record(schema.properties)) throw new Error("properties 配置非法");
    const props = record(schema.properties) ? schema.properties : {};
    if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((k) => typeof k === "string" && Object.hasOwn(value, k)))) throw new Error("输出缺少必填属性");
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") throw new Error("additionalProperties 配置非法");
    for (const [key, item] of Object.entries(value)) {
      safePath(key);
      if (!Object.hasOwn(props, key)) {
        if (schema.additionalProperties === false) throw new Error("输出包含额外属性");
      } else {
        if (!record(props[key])) throw new Error("属性 Schema 配置非法");
        assertAIOutputSchema(item, props[key], depth + 1);
      }
    }
  }
  if (Array.isArray(value)) {
    if (!record(schema.items)) throw new Error("数组缺少 items Schema");
    for (const item of value) assertAIOutputSchema(item, schema.items, depth + 1);
  }
}

export function runAIAssistEngine(input: AIAssistEngineInput): AIAssistEngineResult {
  const { schema, context } = input;
  let node: LLMAssistNode | undefined;
  const unavailable = new Set<string>();
  function visit(current: SchemaNode, blocked = false): void {
    blocked ||= !resolveNodeVisibility(current, context) || resolveNodeDisabled(current, context);
    if (current.id === input.nodeId && current.kind === "LLM_ASSIST" && !blocked) node = current;
    if (current.kind === "FIELD" && blocked) unavailable.add(current.name);
    if (current.kind === "CONTAINER") current.children.forEach((child) => visit(child, blocked));
  }
  visit(schema.root);
  if (!node) throw new Error("AI 节点不存在或不可用");
  const assist: LLMAssistNode = node;
  if (assist.outputSchema) assertSupportedSchema(assist.outputSchema);
  const bindings: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const missingInputs: string[] = [];
  for (const [key, path] of Object.entries(assist.inputBindings ?? {})) {
    safePath(key); safePath(path);
    const value = getByJsonPath(context, path);
    if (value === undefined || value === null) missingInputs.push(key);
    else bindings[key] = value;
  }
  if (input.action === "PREPARE") return { bindings, missingInputs, suggestedPatch: null };
  if (input.action !== "VALIDATE") throw new Error("未知 AI 校验动作");
  if (assist.outputSchema) assertAIOutputSchema(input.output, assist.outputSchema);
  const patch: AnswerPayload = Object.create(null) as AnswerPayload;
  const fields = collectFieldNodes(schema);
  if (Object.keys(context.answers).some((key) => !fields.some((f) => f.name === key))) throw new Error("答案包含未知字段");
  for (const binding of assist.outputBindings ?? []) {
    safePath(binding.toFieldName);
    const field = fields.find((f) => f.name === binding.toFieldName);
    if (!field || unavailable.has(field.name) || Object.hasOwn(patch, field.name)) throw new Error("AI 输出目标不可写或重复");

    let value: unknown;
    if (binding.from === "$") value = input.output;
    else {
      safePath(binding.from);
      // 兼容历史 $.field 与标准 $.output.field。
      const path = binding.from.startsWith("$.output") ? binding.from : `$.output${binding.from.slice(1)}`;
      value = getByJsonPath({ ...context, output: input.output }, path, { allowOutput: true });
    }
    if (value === undefined) throw new Error("AI 输出缺少绑定字段");
    if (binding.mode === "APPEND") {
      const previous = context.answers[field.name];
      if (typeof value === "string" && (previous === undefined || typeof previous === "string")) value = `${previous ?? ""}${value}`;
      else if (Array.isArray(value) && (previous === undefined || Array.isArray(previous))) value = [...(previous ?? []), ...value];
      else throw new Error("APPEND 只支持同类型文本或数组");
    } else if (binding.mode !== "REPLACE") throw new Error("不支持的输出绑定模式");
    if (field.type.startsWith("upload.")) throw new Error("AI 不能创建文件引用");
    if (field.type === "data.json" && field.jsonSchema) assertAIOutputSchema(value, field.jsonSchema);
    if (field.type.startsWith("input.") && typeof value !== "string") throw new Error("文本字段必须是字符串");
    patch[field.name] = value;
  }
  if (!Object.keys(patch).length) return { bindings, missingInputs, suggestedPatch: null };
  const preflight = runSchemaPreflight({ schema, context, currentAnswers: context.answers, patch: Object.entries(patch).map(([fieldName, value]) => ({ op: "set", fieldName, value })) });
  if (!preflight.ok || preflight.warnings.some((w) => w.code !== "SET_WARNING_EFFECT")) throw new Error("AI 候选未通过联动预检");
  // 在共享预检计算后的有效状态上执行完整字段校验，避免重新采用旧 visibleWhen。
  const effective = structuredClone(schema);
  for (const field of collectFieldNodes(effective)) {
    const state = preflight.fieldStates[field.name];
    if (!state) throw new Error("联动预检缺少字段状态");
    field.hidden = !state.visible; field.disabled = state.disabled; field.required = state.required;
    delete field.visibleWhen; delete field.disabledWhen;
  }
  const validation = validateAnswers(effective, preflight.nextAnswers, { ...context, answers: preflight.nextAnswers });
  if (!validation.valid) throw new Error("AI 候选未通过字段校验");
  return { bindings, missingInputs, suggestedPatch: patch };
}
