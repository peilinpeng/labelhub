import type {
  ChoiceFieldNode,
  CompatibilityLevel,
  CompatibilityReport,
  Expression,
  ExprValue,
  FieldNode,
  LabelHubSchema,
  SchemaChange,
  SchemaNode,
  ValidationRule,
} from "@labelhub/contracts";
import { isAllowedJsonPath } from "./json-path.ts";
import { collectFieldNodes, collectLLMAssistNodes, flattenNodes } from "./traverse.ts";

export type SchemaChangeDetectionOptions = {
  renameMap?: Record<string, string>;
  optionValueMap?: Record<string, Record<string, string>>;
  archiveRemovedFields?: boolean;
};

export type BackwardCompatibilityOptions = SchemaChangeDetectionOptions;

type SchemaDiff = {
  oldFields: FieldNode[];
  newFields: FieldNode[];
  oldFieldsByName: Map<string, FieldNode>;
  newFieldsByName: Map<string, FieldNode>;
  oldNodesById: Map<string, SchemaNode>;
  newNodesById: Map<string, SchemaNode>;
};

export function detectSchemaChanges(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
  options: SchemaChangeDetectionOptions = {},
): SchemaChange[] {
  const diff = diffSchema(oldSchema, newSchema);
  const changes: SchemaChange[] = [];
  const renamedOldNames = new Set<string>();
  const renamedNewNames = new Set<string>();

  changes.push(...detectDuplicateFieldNames(diff.newFields));
  changes.push(...detectRemovedAndRenamedFields(diff, options, renamedOldNames, renamedNewNames));
  changes.push(...detectAddedFields(diff, renamedNewNames));
  changes.push(...detectExistingFieldChanges(diff, options, renamedOldNames));
  changes.push(...detectLLMOutputBindingChanges(newSchema, diff.newFieldsByName));
  changes.push(...detectInvalidJsonPathChanges(newSchema));
  changes.push(...detectConditionalValidationReferenceChanges(newSchema, diff.newFieldsByName));

  return changes;
}

export function checkBackwardCompatibility(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
  options: BackwardCompatibilityOptions = {},
): CompatibilityReport {
  const changes = detectSchemaChanges(oldSchema, newSchema, options);
  const blockingChanges = changes.filter((change) => change.level === "BREAKING");
  const warnings = changes.filter((change) => change.level === "NEEDS_APPROVAL");
  const recommendations = uniqueStrings(
    changes.map((change) => change.recommendation).filter((item): item is string => item !== undefined),
  );

  return {
    compatible: changes.every((change) => change.level === "SAFE" || change.level === "NEEDS_APPROVAL"),
    publishAllowed: blockingChanges.length === 0,
    requiresApproval: changes.some((change) => change.level === "NEEDS_APPROVAL"),
    requiresMigration: changes.some((change) => change.level === "MIGRATION_REQUIRED"),
    changes,
    blockingChanges,
    warnings,
    recommendations,
  };
}

function diffSchema(oldSchema: LabelHubSchema, newSchema: LabelHubSchema): SchemaDiff {
  const oldFields = collectFieldNodes(oldSchema);
  const newFields = collectFieldNodes(newSchema);

  return {
    oldFields,
    newFields,
    oldFieldsByName: mapFieldsByName(oldFields),
    newFieldsByName: mapFieldsByName(newFields),
    oldNodesById: mapNodesById(flattenNodes(oldSchema)),
    newNodesById: mapNodesById(flattenNodes(newSchema)),
  };
}

function detectDuplicateFieldNames(fields: FieldNode[]): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    if (seen.has(field.name)) {
      changes.push(createChange({
        code: "FIELD_NAME_DUPLICATED",
        level: "BREAKING",
        fieldName: field.name,
        nodeId: field.id,
        message: `FieldNode.name 重复：${field.name}`,
        recommendation: "请保证同一个 schema version 内 FieldNode.name 全局唯一。",
      }));
    }
    seen.add(field.name);
  }

  return changes;
}

function detectRemovedAndRenamedFields(
  diff: SchemaDiff,
  options: SchemaChangeDetectionOptions,
  renamedOldNames: Set<string>,
  renamedNewNames: Set<string>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const oldField of diff.oldFields) {
    if (diff.newFieldsByName.has(oldField.name)) {
      continue;
    }

    const mappedName = options.renameMap?.[oldField.name];
    if (mappedName !== undefined && diff.newFieldsByName.has(mappedName)) {
      renamedOldNames.add(oldField.name);
      renamedNewNames.add(mappedName);
      changes.push(createChange({
        code: "FIELD_RENAMED_WITH_MAPPING",
        level: "MIGRATION_REQUIRED",
        fieldName: oldField.name,
        nodeId: oldField.id,
        oldValue: oldField.name,
        newValue: mappedName,
        message: `字段 ${oldField.name} 通过 renameMap 映射为 ${mappedName}。`,
        recommendation: "请进入 Migration Pipeline，并在 Dry Run 后再执行迁移。",
      }));
      continue;
    }

    if (options.archiveRemovedFields === true) {
      changes.push(createChange({
        code: oldField.deprecation?.deprecated === true ? "DEPRECATED_FIELD_REMOVED_WITH_ARCHIVE" : "FIELD_REMOVED_WITH_ARCHIVE",
        level: "MIGRATION_REQUIRED",
        fieldName: oldField.name,
        nodeId: oldField.id,
        message: `字段 ${oldField.name} 被删除，并要求归档旧值。`,
        recommendation: "请通过 Migration Pipeline 将旧值写入 archivedAnswers。",
      }));
      continue;
    }

    changes.push(createChange({
      code: oldField.deprecation?.deprecated === true ? "DEPRECATED_FIELD_REMOVED" : "FIELD_REMOVED",
      level: "BREAKING",
      fieldName: oldField.name,
      nodeId: oldField.id,
      message: `字段 ${oldField.name} 被删除。`,
      recommendation: "不要直接删除字段；请先 deprecate，或提供明确 migration / archive 策略。",
    }));
  }

  return changes;
}

function detectAddedFields(diff: SchemaDiff, renamedNewNames: Set<string>): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const newField of diff.newFields) {
    if (diff.oldFieldsByName.has(newField.name) || renamedNewNames.has(newField.name)) {
      continue;
    }

    if (newField.defaultValue !== undefined) {
      changes.push(createChange({
        code: "FIELD_ADDED_WITH_DEFAULT",
        level: "MIGRATION_REQUIRED",
        fieldName: newField.name,
        nodeId: newField.id,
        newValue: newField.defaultValue,
        message: `新增字段 ${newField.name} 配置了 defaultValue。`,
        recommendation: "如需迁移历史数据，请通过 Migration Pipeline 写入默认值。",
      }));
      continue;
    }

    changes.push(createChange({
      code: newField.required === true ? "REQUIRED_FIELD_ADDED" : "OPTIONAL_FIELD_ADDED",
      level: newField.required === true ? "NEEDS_APPROVAL" : "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      message: newField.required === true
        ? `新增必填字段 ${newField.name}。`
        : `新增非必填字段 ${newField.name}。`,
      recommendation: newField.required === true
        ? "请确认新必填字段不会影响发布后的新提交。"
        : undefined,
    }));
  }

  return changes;
}

function detectExistingFieldChanges(
  diff: SchemaDiff,
  options: SchemaChangeDetectionOptions,
  renamedOldNames: Set<string>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const oldField of diff.oldFields) {
    if (renamedOldNames.has(oldField.name)) {
      continue;
    }

    const newField = diff.newFieldsByName.get(oldField.name);
    if (newField === undefined) {
      continue;
    }

    changes.push(...detectFieldMetadataChanges(oldField, newField));
    changes.push(...detectFieldTypeChanges(oldField, newField));
    changes.push(...detectRequiredChanges(oldField, newField));
    changes.push(...detectValidationChanges(oldField, newField));
    changes.push(...detectRuntimeRuleChanges(oldField, newField));
    changes.push(...detectDeprecationMarkerChanges(oldField, newField));
    changes.push(...detectChoiceOptionChanges(oldField, newField, options));
  }

  return changes;
}

function detectFieldMetadataChanges(oldField: FieldNode, newField: FieldNode): SchemaChange[] {
  const changes: SchemaChange[] = [];

  if (oldField.title !== newField.title) {
    changes.push(createChange({
      code: "FIELD_TITLE_CHANGED",
      level: "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: oldField.title,
      newValue: newField.title,
      message: `字段 ${newField.name} 的 title 已修改。`,
    }));
  }

  if (oldField.description !== newField.description) {
    changes.push(createChange({
      code: "FIELD_DESCRIPTION_CHANGED",
      level: "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: oldField.description,
      newValue: newField.description,
      message: `字段 ${newField.name} 的 description 已修改。`,
    }));
  }

  if (getFieldPlaceholder(oldField) !== getFieldPlaceholder(newField)) {
    changes.push(createChange({
      code: "FIELD_PLACEHOLDER_CHANGED",
      level: "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: getFieldPlaceholder(oldField),
      newValue: getFieldPlaceholder(newField),
      message: `字段 ${newField.name} 的 placeholder 已修改。`,
    }));
  }

  if (!isStableEqual(oldField.ui?.helpText, newField.ui?.helpText)) {
    changes.push(createChange({
      code: "FIELD_HELP_TEXT_CHANGED",
      level: "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: oldField.ui?.helpText,
      newValue: newField.ui?.helpText,
      message: `字段 ${newField.name} 的 helpText 已修改。`,
    }));
  }

  if (!isStableEqual(oldField.ui, newField.ui)) {
    changes.push(createChange({
      code: "FIELD_UI_CHANGED",
      level: "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: oldField.ui,
      newValue: newField.ui,
      message: `字段 ${newField.name} 的 UI 配置已修改。`,
    }));
  }

  return changes;
}

function detectFieldTypeChanges(oldField: FieldNode, newField: FieldNode): SchemaChange[] {
  if (oldField.type === newField.type) {
    return [];
  }

  if (oldField.type === "choice.radio" && newField.type === "choice.checkbox") {
    return [createChange({
      code: "FIELD_TYPE_CAST_REQUIRED",
      level: "MIGRATION_REQUIRED",
      fieldName: oldField.name,
      nodeId: oldField.id,
      oldValue: oldField.type,
      newValue: newField.type,
      message: `字段 ${oldField.name} 从 choice.radio 变为 choice.checkbox。`,
      recommendation: "需要将历史 string 值迁移为 string[]。",
    })];
  }

  if (oldField.type === "input.text" && newField.type === "input.textarea") {
    return [createChange({
      code: "FIELD_TYPE_CAST_REQUIRED",
      level: "MIGRATION_REQUIRED",
      fieldName: oldField.name,
      nodeId: oldField.id,
      oldValue: oldField.type,
      newValue: newField.type,
      message: `字段 ${oldField.name} 从 input.text 变为 input.textarea。`,
      recommendation: "该变化可迁移，但仍需要通过 Migration Pipeline 显式处理。",
    })];
  }

  return [createChange({
    code: "FIELD_TYPE_CHANGED_INCOMPATIBLE",
    level: "BREAKING",
    fieldName: oldField.name,
    nodeId: oldField.id,
    oldValue: oldField.type,
    newValue: newField.type,
    message: `字段 ${oldField.name} 的 type 从 ${oldField.type} 变为 ${newField.type}。`,
    recommendation: "请提供明确 migration 策略，或避免不兼容类型变化。",
  })];
}

function detectRequiredChanges(oldField: FieldNode, newField: FieldNode): SchemaChange[] {
  const oldRequired = oldField.required === true;
  const newRequired = newField.required === true;

  if (oldRequired === newRequired) {
    return [];
  }

  return [createChange({
    code: newRequired ? "REQUIRED_TIGHTENED" : "REQUIRED_RELAXED",
    level: newRequired ? "NEEDS_APPROVAL" : "SAFE",
    fieldName: newField.name,
    nodeId: newField.id,
    oldValue: oldRequired,
    newValue: newRequired,
    message: newRequired
      ? `字段 ${newField.name} 从非必填变为必填。`
      : `字段 ${newField.name} 从必填变为非必填。`,
    recommendation: newRequired ? "required: false → true 需要管理员确认。" : undefined,
  })];
}

function detectValidationChanges(oldField: FieldNode, newField: FieldNode): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const oldMinLength = findNumericValidationValue(oldField, "minLength");
  const newMinLength = findNumericValidationValue(newField, "minLength");
  const oldMaxLength = findNumericValidationValue(oldField, "maxLength");
  const newMaxLength = findNumericValidationValue(newField, "maxLength");

  if (oldMinLength !== undefined && newMinLength !== undefined && oldMinLength !== newMinLength) {
    changes.push(createChange({
      code: newMinLength > oldMinLength ? "VALIDATION_MIN_LENGTH_TIGHTENED" : "VALIDATION_MIN_LENGTH_RELAXED",
      level: newMinLength > oldMinLength ? "NEEDS_APPROVAL" : "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: oldMinLength,
      newValue: newMinLength,
      message: `字段 ${newField.name} 的 minLength 从 ${oldMinLength} 变为 ${newMinLength}。`,
    }));
  }

  if (oldMaxLength !== undefined && newMaxLength !== undefined && oldMaxLength !== newMaxLength) {
    changes.push(createChange({
      code: newMaxLength < oldMaxLength ? "VALIDATION_MAX_LENGTH_TIGHTENED" : "VALIDATION_MAX_LENGTH_RELAXED",
      level: newMaxLength < oldMaxLength ? "NEEDS_APPROVAL" : "SAFE",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: oldMaxLength,
      newValue: newMaxLength,
      message: `字段 ${newField.name} 的 maxLength 从 ${oldMaxLength} 变为 ${newMaxLength}。`,
    }));
  }

  return changes;
}

function detectRuntimeRuleChanges(oldField: FieldNode, newField: FieldNode): SchemaChange[] {
  const changes: SchemaChange[] = [];

  changes.push(...detectStableFieldChange(oldField, newField, "visibleWhen", "FIELD_VISIBLE_WHEN_CHANGED"));
  changes.push(...detectStableFieldChange(oldField, newField, "disabledWhen", "FIELD_DISABLED_WHEN_CHANGED"));
  changes.push(...detectStableFieldChange(oldField, newField, "preserveWhenHidden", "FIELD_PRESERVE_WHEN_HIDDEN_CHANGED"));
  changes.push(...detectStableFieldChange(oldField, newField, "submitWhenDisabled", "FIELD_SUBMIT_WHEN_DISABLED_CHANGED"));
  changes.push(...detectStableFieldChange(oldField, newField, "validateWhenHidden", "FIELD_VALIDATE_WHEN_HIDDEN_CHANGED"));

  return changes;
}

function detectDeprecationMarkerChanges(oldField: FieldNode, newField: FieldNode): SchemaChange[] {
  if (oldField.deprecation?.deprecated === true || newField.deprecation?.deprecated !== true) {
    return [];
  }

  return [createChange({
    code: newField.deprecation.hideForNewSubmissions === true
      ? "DEPRECATED_FIELD_HIDDEN_FOR_NEW_SUBMISSIONS"
      : "DEPRECATED_FIELD_MARKED",
    level: "NEEDS_APPROVAL",
    fieldName: newField.name,
    nodeId: newField.id,
    oldValue: oldField.deprecation,
    newValue: newField.deprecation,
    message: newField.deprecation.hideForNewSubmissions === true
      ? `字段 ${newField.name} 被标记 deprecated，并对新提交隐藏。`
      : `字段 ${newField.name} 被标记 deprecated。`,
    recommendation: "deprecated 不等于 deleted；请确认历史回放和新提交行为。",
  })];
}

function detectChoiceOptionChanges(
  oldField: FieldNode,
  newField: FieldNode,
  options: SchemaChangeDetectionOptions,
): SchemaChange[] {
  if (!isChoiceField(oldField) || !isChoiceField(newField)) {
    return [];
  }

  const changes: SchemaChange[] = [];
  const newOptionsByValue = new Map(newField.options.map((option) => [option.value, option]));
  const valueMap = options.optionValueMap?.[oldField.name];

  for (const oldOption of oldField.options) {
    const newOption = newOptionsByValue.get(oldOption.value);
    if (newOption !== undefined) {
      if (oldOption.label !== newOption.label) {
        changes.push(createChange({
          code: "OPTION_LABEL_CHANGED",
          level: "SAFE",
          fieldName: newField.name,
          nodeId: newField.id,
          oldValue: oldOption,
          newValue: newOption,
          message: `字段 ${newField.name} 的 option label 已修改，但 value 保持不变。`,
        }));
      }
      continue;
    }

    const mappedValue = valueMap?.[oldOption.value];
    if (mappedValue !== undefined && newOptionsByValue.has(mappedValue)) {
      changes.push(createChange({
        code: "OPTION_VALUE_MAPPED",
        level: "MIGRATION_REQUIRED",
        fieldName: newField.name,
        nodeId: newField.id,
        oldValue: oldOption.value,
        newValue: mappedValue,
        message: `字段 ${newField.name} 的 option value ${oldOption.value} 映射为 ${mappedValue}。`,
        recommendation: "请通过 Migration Pipeline 执行 option value 映射。",
      }));
      continue;
    }

    changes.push(createChange({
      code: "OPTION_VALUE_REMOVED",
      level: "BREAKING",
      fieldName: newField.name,
      nodeId: newField.id,
      oldValue: oldOption.value,
      message: `字段 ${newField.name} 删除了 option value：${oldOption.value}。`,
      recommendation: "请提供 optionValueMap，或避免删除历史值。",
    }));
  }

  return changes;
}

function detectLLMOutputBindingChanges(
  schema: LabelHubSchema,
  newFieldsByName: Map<string, FieldNode>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const node of collectLLMAssistNodes(schema)) {
    for (const binding of node.outputBindings ?? []) {
      if (!newFieldsByName.has(binding.toFieldName)) {
        changes.push(createChange({
          code: "LLM_OUTPUT_BINDING_TARGET_REMOVED",
          level: "BREAKING",
          fieldName: binding.toFieldName,
          nodeId: node.id,
          oldValue: binding.toFieldName,
          message: `LLM outputBinding.toFieldName 指向不存在字段：${binding.toFieldName}。`,
          recommendation: "请更新 outputBindings，确保目标字段存在。",
        }));
      }
    }
  }

  return changes;
}

function detectInvalidJsonPathChanges(schema: LabelHubSchema): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const node of flattenNodes(schema)) {
    for (const item of collectNodeExpressionPaths(node)) {
      if (!isAllowedJsonPath(item.path)) {
        changes.push(createChange({
          code: "INVALID_JSON_PATH_IN_EXPRESSION",
          level: "BREAKING",
          nodeId: node.id,
          oldValue: item.path,
          message: `Expression 中存在非法 JsonPath：${item.path}。`,
          recommendation: "JsonPath 必须使用 RuntimeContext 命名空间。",
        }));
      }
    }
  }

  return changes;
}

function detectConditionalValidationReferenceChanges(
  schema: LabelHubSchema,
  newFieldsByName: Map<string, FieldNode>,
): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const field of collectFieldNodes(schema)) {
    for (const rule of field.validations ?? []) {
      for (const path of collectValidationRuleAnswerPaths(rule)) {
        const fieldName = readAnswerFieldName(path);
        if (fieldName !== undefined && !newFieldsByName.has(fieldName)) {
          changes.push(createChange({
            code: "CONDITIONAL_VALIDATION_FIELD_MISSING",
            level: "BREAKING",
            fieldName,
            nodeId: field.id,
            oldValue: path,
            message: `conditional validation 引用了不存在字段：${fieldName}。`,
            recommendation: "请更新 conditional validation 引用。",
          }));
        }
      }
    }
  }

  return changes;
}

function detectStableFieldChange(
  oldField: FieldNode,
  newField: FieldNode,
  key: keyof FieldNode,
  code: string,
): SchemaChange[] {
  if (isStableEqual(oldField[key], newField[key])) {
    return [];
  }

  return [createChange({
    code,
    level: "NEEDS_APPROVAL",
    fieldName: newField.name,
    nodeId: newField.id,
    oldValue: oldField[key],
    newValue: newField[key],
    message: `字段 ${newField.name} 的 ${key} 已修改。`,
    recommendation: "请确认运行时规则变化对提交和迁移的影响。",
  })];
}

function mapFieldsByName(fields: FieldNode[]): Map<string, FieldNode> {
  const map = new Map<string, FieldNode>();
  for (const field of fields) {
    if (!map.has(field.name)) {
      map.set(field.name, field);
    }
  }
  return map;
}

function mapNodesById(nodes: SchemaNode[]): Map<string, SchemaNode> {
  const map = new Map<string, SchemaNode>();
  for (const node of nodes) {
    if (!map.has(node.id)) {
      map.set(node.id, node);
    }
  }
  return map;
}

function createChange(input: {
  code: string;
  level: CompatibilityLevel;
  fieldName?: string | undefined;
  nodeId?: string | undefined;
  oldValue?: unknown;
  newValue?: unknown;
  message: string;
  recommendation?: string | undefined;
}): SchemaChange {
  const change: SchemaChange = {
    code: input.code,
    level: input.level,
    message: input.message,
  };

  if (input.fieldName !== undefined) change.fieldName = input.fieldName;
  if (input.nodeId !== undefined) change.nodeId = input.nodeId;
  if (input.oldValue !== undefined) change.oldValue = input.oldValue;
  if (input.newValue !== undefined) change.newValue = input.newValue;
  if (input.recommendation !== undefined) change.recommendation = input.recommendation;

  return change;
}

function findNumericValidationValue(
  field: FieldNode,
  type: "minLength" | "maxLength",
): number | undefined {
  for (const rule of field.validations ?? []) {
    if (rule.type === type) {
      return rule.value;
    }
  }
  return undefined;
}

function getFieldPlaceholder(field: FieldNode): string | undefined {
  if ("placeholder" in field) {
    return field.placeholder;
  }
  return undefined;
}

function isChoiceField(field: FieldNode): field is ChoiceFieldNode {
  return field.type === "choice.radio" ||
    field.type === "choice.checkbox" ||
    field.type === "choice.select" ||
    field.type === "choice.tags";
}

function collectNodeExpressionPaths(node: SchemaNode): Array<{ path: string }> {
  const paths: Array<{ path: string }> = [];

  if (node.visibleWhen !== undefined) {
    paths.push(...collectExpressionPaths(node.visibleWhen));
  }

  if (node.disabledWhen !== undefined) {
    paths.push(...collectExpressionPaths(node.disabledWhen));
  }

  if (node.kind === "FIELD") {
    for (const rule of node.validations ?? []) {
      paths.push(...collectValidationRuleExpressionPaths(rule));
    }
  }

  return paths;
}

function collectValidationRuleExpressionPaths(rule: ValidationRule): Array<{ path: string }> {
  if (rule.type !== "conditional") {
    return [];
  }

  return [
    ...collectExpressionPaths(rule.when),
    ...rule.rules.flatMap((childRule) => collectValidationRuleExpressionPaths(childRule)),
  ];
}

function collectValidationRuleAnswerPaths(rule: ValidationRule): string[] {
  return collectValidationRuleExpressionPaths(rule).map((item) => item.path);
}

function collectExpressionPaths(expression: Expression): Array<{ path: string }> {
  switch (expression.op) {
    case "eq":
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return [
        ...collectExprValuePaths(expression.left),
        ...collectExprValuePaths(expression.right),
      ];
    case "in":
    case "notIn":
      return [
        ...collectExprValuePaths(expression.left),
        ...expression.right.flatMap((item) => collectExprValuePaths(item)),
      ];
    case "empty":
    case "notEmpty":
      return collectExprValuePaths(expression.value);
    case "and":
    case "or":
      return expression.items.flatMap((item) => collectExpressionPaths(item));
    case "not":
      return collectExpressionPaths(expression.item);
  }
}

function collectExprValuePaths(value: ExprValue): Array<{ path: string }> {
  if (value.kind !== "path") {
    return [];
  }

  return [{ path: value.path }];
}

function readAnswerFieldName(path: string): string | undefined {
  if (!path.startsWith("$.answers.")) {
    return undefined;
  }

  const fieldName = path.slice("$.answers.".length).split(".")[0];
  return fieldName === undefined || fieldName.length === 0 ? undefined : fieldName;
}

function isStableEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) {
        normalized[key] = toStableJsonValue(child);
      }
    }
    return normalized;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
