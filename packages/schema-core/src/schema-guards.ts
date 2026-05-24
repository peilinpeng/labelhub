import type {
  ErrorCode,
  Expression,
  ExprValue,
  LabelHubSchema,
  NodeType,
  SchemaNode,
  SchemaValidationError,
  SchemaValidationResult,
  ValidationRule,
} from "@labelhub/contracts";
import { isAllowedJsonPath } from "./json-path.ts";
import { collectFieldNodes, collectLLMAssistNodes, collectShowItemNodes, flattenNodes } from "./traverse.ts";

const allowedNodeTypes = new Set<string>([
  "input.text",
  "input.textarea",
  "input.richtext",
  "choice.radio",
  "choice.checkbox",
  "choice.select",
  "choice.tags",
  "upload.file",
  "upload.image",
  "data.json",
  "show.text",
  "show.richtext",
  "show.image",
  "show.file",
  "show.json",
  "container.group",
  "container.tabs",
  "container.section",
  "llm.assist",
] satisfies NodeType[]);

const answerFieldTypes = new Set<string>([
  "input.text",
  "input.textarea",
  "input.richtext",
  "choice.radio",
  "choice.checkbox",
  "choice.select",
  "choice.tags",
  "upload.file",
  "upload.image",
  "data.json",
] satisfies NodeType[]);

const showItemTypes = new Set<string>([
  "show.text",
  "show.richtext",
  "show.image",
  "show.file",
  "show.json",
] satisfies NodeType[]);

const containerTypes = new Set<string>([
  "container.group",
  "container.tabs",
  "container.section",
] satisfies NodeType[]);

export function assertUniqueNodeIds(schema: LabelHubSchema): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];
  const seen = new Set<string>();

  for (const node of flattenNodes(schema)) {
    if (seen.has(node.id)) {
      errors.push(createSchemaError("NODE_ID_DUPLICATED", "node.id 必须在 schema tree 内全局唯一", node.id, node.id));
      continue;
    }
    seen.add(node.id);
  }

  return createSchemaValidationResult(errors);
}

export function assertUniqueFieldNames(schema: LabelHubSchema): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];
  const seen = new Set<string>();

  for (const field of collectFieldNodes(schema)) {
    if (seen.has(field.name)) {
      errors.push(createSchemaError("FIELD_NAME_DUPLICATED", "FieldNode.name 必须在 schema version 内唯一", field.id, field.name));
      continue;
    }
    seen.add(field.name);
  }

  return createSchemaValidationResult(errors);
}

export function validateSchemaShape(schema: unknown): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];

  if (!isRecord(schema)) {
    return createSchemaValidationResult([
      createSchemaError("SCHEMA_INVALID", "schema 必须是对象", undefined, "$"),
    ]);
  }

  const root = schema.root;
  if (!isRecord(root)) {
    return createSchemaValidationResult([
      createSchemaError("SCHEMA_INVALID", "schema.root 必须是 ContainerNode", undefined, "$.root"),
    ]);
  }

  const unknownNodes = collectUnknownNodes(root);
  errors.push(...validateUnknownNodes(unknownNodes));
  errors.push(...validateUnknownDuplicateNodeIds(unknownNodes));
  errors.push(...validateUnknownDuplicateFieldNames(unknownNodes));

  if (errors.some((error) => error.code === "SCHEMA_INVALID" || error.code === "UNKNOWN_NODE_TYPE")) {
    return createSchemaValidationResult(errors);
  }

  const typedSchema = schema as unknown as LabelHubSchema;
  errors.push(...validateShowItemPaths(typedSchema).errors);
  errors.push(...validateExpressionPaths(typedSchema).errors);
  errors.push(...validateLLMOutputBindings(typedSchema).errors);

  return createSchemaValidationResult(errors);
}

export function validateLLMOutputBindings(schema: LabelHubSchema): SchemaValidationResult {
  const fieldNames = new Set(collectFieldNodes(schema).map((field) => field.name));
  const errors: SchemaValidationError[] = [];

  for (const node of collectLLMAssistNodes(schema)) {
    for (const [key, pathValue] of Object.entries(node.inputBindings)) {
      if (!isAllowedJsonPath(pathValue)) {
        errors.push(createSchemaError("INVALID_JSON_PATH", "LLMAssistNode.inputBindings 必须使用 RuntimeContext 命名空间", node.id, `$.nodes.${node.id}.inputBindings.${key}`));
      }
    }

    for (const [index, binding] of (node.outputBindings ?? []).entries()) {
      const path = `$.nodes.${node.id}.outputBindings.${index}`;

      if (!isAllowedJsonPath(binding.from, { allowOutput: true }) || !binding.from.startsWith("$.output.")) {
        errors.push(createSchemaError("INVALID_JSON_PATH", "LLMOutputBinding.from 必须使用 $.output 命名空间", node.id, `${path}.from`));
      }

      if (!fieldNames.has(binding.toFieldName)) {
        errors.push(createSchemaError("SCHEMA_INVALID", "LLMOutputBinding.toFieldName 必须指向存在的 FieldNode.name", node.id, `${path}.toFieldName`));
      }

      if (binding.requireUserConfirm !== true) {
        errors.push(createSchemaError("SCHEMA_INVALID", "LLMOutputBinding.requireUserConfirm 必须为 true", node.id, `${path}.requireUserConfirm`));
      }
    }
  }

  return createSchemaValidationResult(errors);
}

export function validateExpressionPaths(schema: LabelHubSchema): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];

  for (const node of flattenNodes(schema)) {
    for (const item of collectNodeExpressionPaths(node)) {
      if (!isAllowedJsonPath(item.path)) {
        errors.push(createSchemaError("INVALID_JSON_PATH", "Expression 中的 JsonPath 必须使用 RuntimeContext 命名空间", node.id, item.location));
      }
    }
  }

  return createSchemaValidationResult(errors);
}

export function validateShowItemPaths(schema: LabelHubSchema): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];

  for (const node of collectShowItemNodes(schema)) {
    if (!isAllowedJsonPath(node.sourcePath)) {
      errors.push(createSchemaError("INVALID_JSON_PATH", "ShowItem.sourcePath 必须使用 RuntimeContext 命名空间", node.id, `$.nodes.${node.id}.sourcePath`));
    }
  }

  return createSchemaValidationResult(errors);
}

function validateUnknownNodes(nodes: UnknownNodeEntry[]): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  for (const entry of nodes) {
    const id = readString(entry.node, "id");
    const kind = readString(entry.node, "kind");
    const type = readString(entry.node, "type");

    if (id === undefined || id.length === 0) {
      errors.push(createSchemaError("SCHEMA_INVALID", "node.id 必须是非空字符串", undefined, `${entry.path}.id`));
    }

    if (type === undefined || !allowedNodeTypes.has(type)) {
      errors.push(createSchemaError("UNKNOWN_NODE_TYPE", "node.type 必须来自 server registry 支持的 NodeType", id, `${entry.path}.type`));
      continue;
    }

    if (kind === "FIELD") {
      if (!answerFieldTypes.has(type)) {
        errors.push(createSchemaError("SCHEMA_INVALID", "FieldNode.type 必须是 AnswerFieldType", id, `${entry.path}.type`));
      }
      const name = readString(entry.node, "name");
      if (name === undefined || name.length === 0) {
        errors.push(createSchemaError("SCHEMA_INVALID", "FieldNode.name 必须是非空字符串", id, `${entry.path}.name`));
      }
      continue;
    }

    if (kind === "SHOW_ITEM") {
      if (!showItemTypes.has(type)) {
        errors.push(createSchemaError("SCHEMA_INVALID", "ShowItemNode.type 必须是 ShowItemType", id, `${entry.path}.type`));
      }
      if (readString(entry.node, "sourcePath") === undefined) {
        errors.push(createSchemaError("SCHEMA_INVALID", "ShowItemNode.sourcePath 必须是 JsonPath", id, `${entry.path}.sourcePath`));
      }
      continue;
    }

    if (kind === "LLM_ASSIST") {
      if (type !== "llm.assist") {
        errors.push(createSchemaError("SCHEMA_INVALID", "LLMAssistNode.type 必须固定为 llm.assist", id, `${entry.path}.type`));
      }
      continue;
    }

    if (kind === "CONTAINER") {
      if (!containerTypes.has(type)) {
        errors.push(createSchemaError("SCHEMA_INVALID", "ContainerNode.type 必须是 ContainerType", id, `${entry.path}.type`));
      }
      if (!Array.isArray(entry.node.children)) {
        errors.push(createSchemaError("SCHEMA_INVALID", "ContainerNode.children 必须是数组", id, `${entry.path}.children`));
      }
      continue;
    }

    errors.push(createSchemaError("SCHEMA_INVALID", "node.kind 必须是契约支持的节点职责", id, `${entry.path}.kind`));
  }

  return errors;
}

function validateUnknownDuplicateNodeIds(nodes: UnknownNodeEntry[]): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];
  const seen = new Set<string>();

  for (const entry of nodes) {
    const id = readString(entry.node, "id");
    if (id === undefined) {
      continue;
    }
    if (seen.has(id)) {
      errors.push(createSchemaError("NODE_ID_DUPLICATED", "node.id 必须在 schema tree 内全局唯一", id, `${entry.path}.id`));
      continue;
    }
    seen.add(id);
  }

  return errors;
}

function validateUnknownDuplicateFieldNames(nodes: UnknownNodeEntry[]): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];
  const seen = new Set<string>();

  for (const entry of nodes) {
    if (readString(entry.node, "kind") !== "FIELD") {
      continue;
    }
    const name = readString(entry.node, "name");
    if (name === undefined) {
      continue;
    }
    if (seen.has(name)) {
      errors.push(createSchemaError("FIELD_NAME_DUPLICATED", "FieldNode.name 必须在 schema version 内唯一", readString(entry.node, "id"), `${entry.path}.name`));
      continue;
    }
    seen.add(name);
  }

  return errors;
}

function collectNodeExpressionPaths(node: SchemaNode): Array<{ path: string; location: string }> {
  const items: Array<{ path: string; location: string }> = [];

  if (node.visibleWhen !== undefined) {
    items.push(...collectExpressionPaths(node.visibleWhen, `$.nodes.${node.id}.visibleWhen`));
  }
  if (node.disabledWhen !== undefined) {
    items.push(...collectExpressionPaths(node.disabledWhen, `$.nodes.${node.id}.disabledWhen`));
  }
  if (node.kind === "FIELD") {
    for (const [index, rule] of (node.validations ?? []).entries()) {
      items.push(...collectValidationRuleExpressionPaths(rule, `$.nodes.${node.id}.validations.${index}`));
    }
  }

  return items;
}

function collectValidationRuleExpressionPaths(rule: ValidationRule, location: string): Array<{ path: string; location: string }> {
  if (rule.type !== "conditional") {
    return [];
  }

  return [
    ...collectExpressionPaths(rule.when, `${location}.when`),
    ...rule.rules.flatMap((childRule, index) => collectValidationRuleExpressionPaths(childRule, `${location}.rules.${index}`)),
  ];
}

function collectExpressionPaths(expression: Expression, location: string): Array<{ path: string; location: string }> {
  switch (expression.op) {
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return [
        ...collectExprValuePaths(expression.left, `${location}.left`),
        ...collectExprValuePaths(expression.right, `${location}.right`),
      ];
    case "in":
    case "notIn":
      return [
        ...collectExprValuePaths(expression.left, `${location}.left`),
        ...expression.right.flatMap((item, index) => collectExprValuePaths(item, `${location}.right.${index}`)),
      ];
    case "empty":
    case "notEmpty":
      return collectExprValuePaths(expression.value, `${location}.value`);
    case "and":
    case "or":
      return expression.items.flatMap((item, index) => collectExpressionPaths(item, `${location}.items.${index}`));
    case "not":
      return collectExpressionPaths(expression.item, `${location}.item`);
  }
}

function collectExprValuePaths(value: ExprValue, location: string): Array<{ path: string; location: string }> {
  return value.kind === "path" ? [{ path: value.path, location }] : [];
}

interface UnknownNodeEntry {
  node: Record<string, unknown>;
  path: string;
}

function collectUnknownNodes(root: unknown): UnknownNodeEntry[] {
  const nodes: UnknownNodeEntry[] = [];
  walkUnknownNode(root, "$.root", nodes);
  return nodes;
}

function walkUnknownNode(node: unknown, path: string, nodes: UnknownNodeEntry[]): void {
  if (!isRecord(node)) {
    return;
  }

  nodes.push({ node, path });
  const children = node.children;
  if (!Array.isArray(children)) {
    return;
  }

  for (const [index, child] of children.entries()) {
    walkUnknownNode(child, `${path}.children.${index}`, nodes);
  }
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  return typeof item === "string" ? item : undefined;
}

function createSchemaValidationResult(errors: SchemaValidationError[]): SchemaValidationResult {
  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

function createSchemaError(
  code: ErrorCode,
  message: string,
  nodeId: string | undefined,
  path: string,
): SchemaValidationError {
  const error: SchemaValidationError = { code, message, path };
  return nodeId === undefined ? error : { ...error, nodeId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
