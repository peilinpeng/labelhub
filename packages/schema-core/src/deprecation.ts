import type {
  Expression,
  ExprValue,
  FieldNode,
  LabelHubSchema,
  ValidationRule,
} from "@labelhub/contracts";
import { collectFieldNodes, collectLLMAssistNodes } from "./traverse.ts";

export type SchemaIssueSeverity = "ERROR" | "WARNING";

export type DeprecationIssue = {
  severity: SchemaIssueSeverity;
  code: string;
  fieldName?: string;
  nodeId?: string;
  message: string;
  recommendation?: string;
};

export type DeprecationValidationResult = {
  valid: boolean;
  errors: DeprecationIssue[];
  warnings: DeprecationIssue[];
  issues: DeprecationIssue[];
};

export function validateDeprecationRules(schema: LabelHubSchema): DeprecationValidationResult {
  const fields = collectFieldNodes(schema);
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const deprecatedFields = fields.filter((field) => field.deprecation?.deprecated === true);
  const issues: DeprecationIssue[] = [];

  issues.push(...validateDeprecatedFieldBasics(schema, deprecatedFields, fieldsByName));
  issues.push(...validateDeprecatedFieldReferences(schema, deprecatedFields));
  issues.push(...validateDeprecatedLLMOutputBindings(schema, deprecatedFields));
  issues.push(...validateDeprecatedFieldNameConflicts(fields));

  const errors = issues.filter((issue) => issue.severity === "ERROR");
  const warnings = issues.filter((issue) => issue.severity === "WARNING");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}

function validateDeprecatedFieldBasics(
  schema: LabelHubSchema,
  deprecatedFields: FieldNode[],
  fieldsByName: Map<string, FieldNode>,
): DeprecationIssue[] {
  const issues: DeprecationIssue[] = [];

  for (const field of deprecatedFields) {
    if (field.required === true) {
      issues.push(createIssue("WARNING", "DEPRECATED_FIELD_REQUIRED", field, `deprecated 字段 ${field.name} 不应该继续 required: true。`, "建议先取消 required，再进入字段下线流程。"));
    }

    if (field.deprecation?.reason === undefined || field.deprecation.reason.length === 0) {
      issues.push(createIssue("WARNING", "DEPRECATED_FIELD_REASON_MISSING", field, `deprecated 字段 ${field.name} 缺少 reason。`, "请说明字段废弃原因，方便审核和历史回放。"));
    }

    const replacementFieldName = field.deprecation?.replacementFieldName;
    if (replacementFieldName === undefined || replacementFieldName.length === 0) {
      issues.push(createIssue("WARNING", "DEPRECATED_FIELD_REPLACEMENT_MISSING", field, `deprecated 字段 ${field.name} 缺少 replacementFieldName。`, "建议提供替代字段，避免新提交继续依赖旧字段。"));
    } else if (!fieldsByName.has(replacementFieldName)) {
      issues.push(createIssue("ERROR", "DEPRECATED_FIELD_REPLACEMENT_NOT_FOUND", field, `deprecated 字段 ${field.name} 的 replacementFieldName 不存在：${replacementFieldName}。`, "replacementFieldName 必须指向存在的 FieldNode.name。"));
    }

    if (
      field.deprecation?.plannedRemovalSchemaVersionNo !== undefined &&
      schema.schemaVersionNo !== undefined &&
      field.deprecation.plannedRemovalSchemaVersionNo <= schema.schemaVersionNo
    ) {
      issues.push(createIssue("ERROR", "DEPRECATED_FIELD_REMOVAL_VERSION_INVALID", field, `deprecated 字段 ${field.name} 的 plannedRemovalSchemaVersionNo 必须大于当前 schemaVersionNo。`, "请将 plannedRemovalSchemaVersionNo 设置为未来版本号。"));
    }

    if (field.deprecation?.hideForNewSubmissions !== true && field.hidden !== true) {
      issues.push(createIssue("WARNING", "DEPRECATED_FIELD_VISIBLE_IN_CREATE_MODE", field, `deprecated 字段 ${field.name} 仍会在 CREATE visibility mode 中显示。`, "如需对新提交隐藏，请配置 hideForNewSubmissions: true。"));
    }

    // Migration mapping 尚未在 Batch 4 实现，这里只能提醒，后续 Migration Pipeline 会进一步校验映射完整性。
    issues.push(createIssue("WARNING", "DEPRECATED_FIELD_MIGRATION_MAPPING_NOT_VERIFIED", field, `deprecated 字段 ${field.name} 的 migration mapping 尚未在本阶段校验。`, "请在 Migration Pipeline 中确认该字段不是新字段的唯一数据来源。"));
  }

  return issues;
}

function validateDeprecatedFieldReferences(
  schema: LabelHubSchema,
  deprecatedFields: FieldNode[],
): DeprecationIssue[] {
  const issues: DeprecationIssue[] = [];
  const deprecatedNames = new Set(deprecatedFields.map((field) => field.name));

  for (const field of collectFieldNodes(schema)) {
    const referencedNames = collectFieldReferenceNames(field);
    for (const fieldName of referencedNames) {
      if (!deprecatedNames.has(fieldName)) {
        continue;
      }
      issues.push(createIssue("WARNING", "DEPRECATED_FIELD_STILL_REFERENCED", field, `deprecated 字段 ${fieldName} 仍被 ${field.name} 的 visibleWhen / disabledWhen / conditional validation 引用。`, "请确认运行时依赖是否仍然必要。"));
    }
  }

  return issues;
}

function validateDeprecatedLLMOutputBindings(
  schema: LabelHubSchema,
  deprecatedFields: FieldNode[],
): DeprecationIssue[] {
  const issues: DeprecationIssue[] = [];
  const deprecatedByName = new Map(deprecatedFields.map((field) => [field.name, field]));

  for (const node of collectLLMAssistNodes(schema)) {
    for (const binding of node.outputBindings ?? []) {
      const deprecatedField = deprecatedByName.get(binding.toFieldName);
      if (deprecatedField === undefined) {
        continue;
      }

      if (deprecatedField.deprecation?.replacementFieldName === undefined) {
        issues.push(createIssue("ERROR", "DEPRECATED_FIELD_LLM_OUTPUT_WITHOUT_REPLACEMENT", deprecatedField, `deprecated 字段 ${deprecatedField.name} 被 LLM outputBinding 写入，且缺少 replacementFieldName。`, "请改写 outputBinding 到替代字段，或先配置 replacementFieldName。"));
        continue;
      }

      issues.push(createIssue("WARNING", "DEPRECATED_FIELD_LLM_OUTPUT_WITH_REPLACEMENT", deprecatedField, `deprecated 字段 ${deprecatedField.name} 仍被 LLM outputBinding 写入。`, "虽然已有 replacementFieldName，仍建议人工确认 LLM 输出目标是否应迁移。"));
    }
  }

  return issues;
}

function validateDeprecatedFieldNameConflicts(fields: FieldNode[]): DeprecationIssue[] {
  const issues: DeprecationIssue[] = [];
  const seen = new Map<string, FieldNode>();

  for (const field of fields) {
    const previous = seen.get(field.name);
    if (previous !== undefined && (previous.deprecation?.deprecated === true || field.deprecation?.deprecated === true)) {
      issues.push(createIssue("ERROR", "DEPRECATED_FIELD_NAME_CONFLICT", field, `deprecated 字段 ${field.name} 与其他字段 name 冲突。`, "FieldNode.name 必须保持唯一，废弃字段也不能和新字段共用 name。"));
    }
    seen.set(field.name, field);
  }

  return issues;
}

function collectFieldReferenceNames(field: FieldNode): Set<string> {
  const names = new Set<string>();

  if (field.visibleWhen !== undefined) {
    collectExpressionFieldReferenceNames(field.visibleWhen, names);
  }
  if (field.disabledWhen !== undefined) {
    collectExpressionFieldReferenceNames(field.disabledWhen, names);
  }
  for (const rule of field.validations ?? []) {
    collectValidationRuleFieldReferenceNames(rule, names);
  }

  return names;
}

function collectValidationRuleFieldReferenceNames(rule: ValidationRule, names: Set<string>): void {
  if (rule.type !== "conditional") {
    return;
  }

  collectExpressionFieldReferenceNames(rule.when, names);
  for (const childRule of rule.rules) {
    collectValidationRuleFieldReferenceNames(childRule, names);
  }
}

function collectExpressionFieldReferenceNames(expression: Expression, names: Set<string>): void {
  switch (expression.op) {
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      collectExprValueFieldReferenceName(expression.left, names);
      collectExprValueFieldReferenceName(expression.right, names);
      return;
    case "in":
    case "notIn":
      collectExprValueFieldReferenceName(expression.left, names);
      for (const item of expression.right) collectExprValueFieldReferenceName(item, names);
      return;
    case "empty":
    case "notEmpty":
      collectExprValueFieldReferenceName(expression.value, names);
      return;
    case "and":
    case "or":
      for (const item of expression.items) collectExpressionFieldReferenceNames(item, names);
      return;
    case "not":
      collectExpressionFieldReferenceNames(expression.item, names);
      return;
  }
}

function collectExprValueFieldReferenceName(value: ExprValue, names: Set<string>): void {
  if (value.kind !== "path" || !value.path.startsWith("$.answers.")) {
    return;
  }

  const fieldName = value.path.slice("$.answers.".length).split(".")[0];
  if (fieldName !== undefined && fieldName.length > 0) {
    names.add(fieldName);
  }
}

function createIssue(
  severity: SchemaIssueSeverity,
  code: string,
  field: FieldNode,
  message: string,
  recommendation?: string,
): DeprecationIssue {
  const issue: DeprecationIssue = {
    severity,
    code,
    fieldName: field.name,
    nodeId: field.id,
    message,
  };

  if (recommendation !== undefined) {
    issue.recommendation = recommendation;
  }

  return issue;
}
