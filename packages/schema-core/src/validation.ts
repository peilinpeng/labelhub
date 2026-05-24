import type {
  AnswerPayload,
  ChoiceFieldNode,
  FieldNode,
  JsonSchemaLike,
  LabelHubSchema,
  ValidationError,
  ValidationResult,
  ValidationRule,
} from "@labelhub/contracts";
import { evaluateExpression, isEmptyValue } from "./expression.ts";
import type { RuntimeContextWithOutput } from "./json-path.ts";
import { collectFieldNodes } from "./traverse.ts";
import { resolveNodeDisabled, resolveNodeVisibility } from "./visibility.ts";

export function validateAnswers(
  schema: LabelHubSchema,
  answers: AnswerPayload,
  context: RuntimeContextWithOutput,
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const field of collectFieldNodes(schema)) {
    const visible = resolveNodeVisibility(field, context);
    const disabled = resolveNodeDisabled(field, context);
    const shouldValidate = (visible || field.validateWhenHidden === true) && (!disabled || field.submitWhenDisabled === true);

    if (!shouldValidate) {
      continue;
    }

    const value = answers[field.name];
    const requiredRules = field.required === true ? [{ type: "required" } satisfies ValidationRule] : [];
    const rules = [...requiredRules, ...(field.validations ?? [])];

    errors.push(...validateFieldValue(field, value));

    for (const rule of rules) {
      errors.push(...validateRule(field, value, rule, context, 0));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateFieldValue(field: FieldNode, value: unknown): ValidationError[] {
  if (isEmptyValue(value)) {
    return [];
  }

  switch (field.type) {
    case "choice.radio":
    case "choice.select":
      if (typeof value !== "string") {
        return [createValidationError(field, "单选字段必须提交 string")];
      }
      return validateChoiceOptions(field, [value]);
    case "choice.checkbox":
    case "choice.tags":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        return [createValidationError(field, "多选字段必须提交 string[]")];
      }
      return validateChoiceOptions(field, value);
    case "data.json":
      return isJsonSerializable(value) ? [] : [createValidationError(field, "data.json 必须可 JSON 序列化")];
    case "upload.file":
    case "upload.image":
      return validateUploadShape(field, value);
    default:
      return [];
  }
}

function validateRule(
  field: FieldNode,
  value: unknown,
  rule: ValidationRule,
  context: RuntimeContextWithOutput,
  depth: number,
): ValidationError[] {
  if (depth > 10) {
    return [createValidationError(field, "conditional validation 嵌套层级过深", "SCHEMA_INVALID")];
  }

  if (rule.type === "required") {
    return isEmptyValue(value) ? [createValidationError(field, rule.message ?? "必填字段不能为空")] : [];
  }

  if (isEmptyValue(value)) {
    return [];
  }

  switch (rule.type) {
    case "minLength":
      return typeof value === "string" && value.length < rule.value
        ? [createValidationError(field, rule.message ?? `文本长度不能小于 ${rule.value}`)]
        : [];
    case "maxLength":
      return typeof value === "string" && value.length > rule.value
        ? [createValidationError(field, rule.message ?? `文本长度不能大于 ${rule.value}`)]
        : [];
    case "regex":
      return validateRegexRule(field, value, rule);
    case "minItems":
      return Array.isArray(value) && value.length < rule.value
        ? [createValidationError(field, rule.message ?? `选项数量不能小于 ${rule.value}`)]
        : [];
    case "maxItems":
      return Array.isArray(value) && value.length > rule.value
        ? [createValidationError(field, rule.message ?? `选项数量不能大于 ${rule.value}`)]
        : [];
    case "jsonSchema":
      return validateJsonSchemaRule(field, value, rule.schema, rule.message);
    case "file":
      return validateFileRule(field, value, rule);
    case "custom":
      return [
        createValidationError(
          field,
          rule.message ?? `custom validation 未注册：${rule.ruleId}`,
          "UNKNOWN_VALIDATION_RULE",
        ),
      ];
    case "conditional":
      if (!evaluateExpression(rule.when, context)) {
        return [];
      }
      return rule.rules.flatMap((childRule) => validateRule(field, value, childRule, context, depth + 1));
  }
}

function validateRegexRule(
  field: FieldNode,
  value: unknown,
  rule: Extract<ValidationRule, { type: "regex" }>,
): ValidationError[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    return new RegExp(rule.pattern, rule.flags).test(value)
      ? []
      : [createValidationError(field, rule.message ?? "文本格式不符合 regex 规则")];
  } catch {
    return [createValidationError(field, "regex validation 配置非法", "SCHEMA_INVALID")];
  }
}

function validateJsonSchemaRule(
  field: FieldNode,
  value: unknown,
  schema: JsonSchemaLike,
  message?: string,
): ValidationError[] {
  return matchesJsonSchema(value, schema)
    ? []
    : [createValidationError(field, message ?? "字段值不符合 jsonSchema 规则")];
}

function validateFileRule(
  field: FieldNode,
  value: unknown,
  rule: Extract<ValidationRule, { type: "file" }>,
): ValidationError[] {
  const refs = Array.isArray(value) ? value : [value];
  const errors: ValidationError[] = [];

  if (rule.maxCount !== undefined && refs.length > rule.maxCount) {
    errors.push(createValidationError(field, rule.message ?? `文件数量不能大于 ${rule.maxCount}`));
  }

  for (const ref of refs) {
    if (!isFileRef(ref)) {
      errors.push(createValidationError(field, rule.message ?? "upload 字段只能提交 FileRef"));
      continue;
    }

    if (rule.maxSizeMB !== undefined && ref.size > rule.maxSizeMB * 1024 * 1024) {
      errors.push(createValidationError(field, rule.message ?? `文件大小不能超过 ${rule.maxSizeMB}MB`));
    }

    if (rule.accept !== undefined && !rule.accept.some((accept) => matchesAccept(ref.mimeType, accept))) {
      errors.push(createValidationError(field, rule.message ?? "文件类型不在 accept 范围内"));
    }
  }

  return errors;
}

function validateUploadShape(field: FieldNode, value: unknown): ValidationError[] {
  const values = Array.isArray(value) ? value : [value];
  return values.every(isFileRef) ? [] : [createValidationError(field, "upload 字段只能提交 FileRef")];
}

function validateChoiceOptions(field: ChoiceFieldNode, values: string[]): ValidationError[] {
  const allowedValues = new Set(field.options.map((option) => option.value));
  const invalidValues = values.filter((value) => !allowedValues.has(value));

  return invalidValues.length === 0
    ? []
    : [createValidationError(field, "选项值必须来自 schema.options")];
}

function matchesJsonSchema(value: unknown, schema: JsonSchemaLike): boolean {
  const type = schema.type;
  if (typeof type === "string" && !matchesJsonSchemaType(value, type)) {
    return false;
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((item) => isJsonEqual(item, value))) {
    return false;
  }

  if (isRecord(value)) {
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(value, key)) {
          return false;
        }
      }
    }

    const properties = schema.properties;
    if (isRecord(properties)) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key) && isRecord(childSchema)) {
          if (!matchesJsonSchema(value[key], childSchema)) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value) && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function matchesAccept(mimeType: string, accept: string): boolean {
  if (accept.endsWith("/*")) {
    return mimeType.startsWith(accept.slice(0, -1));
  }
  return mimeType === accept;
}

function isJsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isJsonSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function isFileRef(value: unknown): value is { fileId: string; name: string; mimeType: string; size: number } {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.fileId === "string" &&
    typeof value.name === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.size === "number"
  );
}

function createValidationError(
  field: FieldNode,
  message: string,
  code: ValidationError["code"] = "VALIDATION_FAILED",
): ValidationError {
  return {
    fieldName: field.name,
    nodeId: field.id,
    code,
    message,
    severity: "ERROR",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
