import type {
  AnswerPayload,
  ChoiceFieldNode,
  ContainerNode,
  FieldNode,
  LabelHubSchema,
  ManualMappingSlot,
  MigrationDryRunReport,
  MigrationOperation,
  MigrationPlan,
  MigrationSkippedSubmission,
  MigrationSubmissionInput,
  RuntimeContextWithOutput,
  SchemaNode,
  ValidationError,
  ValidationRule,
} from "@labelhub/contracts";
import { detectSchemaChanges, type SchemaChangeDetectionOptions } from "./compatibility.ts";
import { normalizeAnswers } from "./normalization.ts";
import { collectFieldNodes } from "./traverse.ts";
import { validateAnswers } from "./validation.ts";

export type CreateMigrationPlanOptions = {
  renameMap?: Record<string, string>;
  defaults?: Record<string, unknown>;
  optionValueMap?: Record<string, Record<string, string>>;
  archiveRemovedFields?: boolean;
  cutoffSubmittedAt?: string;
  includedSubmissionIds?: string[];
};

export type DryRunMigrationOptions = {
  sampleLimit?: number;
  contextFactory?: (submission: MigrationSubmissionInput) => RuntimeContextWithOutput;
};

type FieldMaps = {
  oldFields: FieldNode[];
  newFields: FieldNode[];
  oldFieldsByName: Map<string, FieldNode>;
  newFieldsByName: Map<string, FieldNode>;
};

type ApplyOperationResult = {
  applied: boolean;
  blockedMessage?: string;
  touchedFieldName?: string;
  sampleSignal?: SampleSignal;
};

type SampleSignal =
  | "BLOCKING"
  | "VALIDATION_FAILED"
  | "ARCHIVED"
  | "RENAME_FIELD"
  | "CAST_VALUE"
  | "ADD_DEFAULT"
  | "AFFECTED";

type SampleCandidate = {
  submissionId: string;
  before: AnswerPayload;
  after: AnswerPayload;
  archivedAnswers?: AnswerPayload;
  signals: Set<SampleSignal>;
};

const samplePriorityOrder: SampleSignal[] = [
  "BLOCKING",
  "VALIDATION_FAILED",
  "ARCHIVED",
  "RENAME_FIELD",
  "CAST_VALUE",
  "ADD_DEFAULT",
  "AFFECTED",
];

export function createMigrationPlan(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
  options: CreateMigrationPlanOptions = {},
): MigrationPlan {
  const maps = createFieldMaps(oldSchema, newSchema);
  const operations: MigrationOperation[] = [];
  const manualMappingSlots: ManualMappingSlot[] = [];
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const renamedOldFieldNames = new Set<string>();
  const renamedNewFieldNames = new Set<string>();

  for (const oldField of maps.oldFields) {
    const sameNameField = maps.newFieldsByName.get(oldField.name);
    if (sameNameField !== undefined) {
      operations.push(...createExistingFieldOperations(oldField, sameNameField, options, blockingIssues, manualMappingSlots));
      continue;
    }

    const mappedName = options.renameMap?.[oldField.name];
    const mappedField = mappedName === undefined ? undefined : maps.newFieldsByName.get(mappedName);
    if (mappedName !== undefined && mappedField !== undefined) {
      renamedOldFieldNames.add(oldField.name);
      renamedNewFieldNames.add(mappedName);
      operations.push({ op: "RENAME_FIELD", from: oldField.name, to: mappedName });
      const castOperation = createCastOperation(mappedField.name, oldField.type, mappedField.type);
      if (castOperation !== undefined) {
        operations.push(castOperation);
      }
      if (isChoiceField(oldField) && isChoiceField(mappedField)) {
        operations.push(...createOptionValueOperations(
          oldField,
          mappedField,
          options,
          blockingIssues,
          manualMappingSlots,
          mappedField.name,
        ));
      }
      continue;
    }

    if (options.archiveRemovedFields === true) {
      operations.push({ op: "ARCHIVE_FIELD", fieldName: oldField.name });
      continue;
    }

    const candidateFieldNames = maps.newFields.map((field) => field.name);
    const reason = `字段 ${oldField.name} 在目标 schema 中不存在，且没有提供 renameMap 或 archive 策略。`;
    manualMappingSlots.push(createManualMappingSlot({
      slotId: `slot_field_rename_${oldField.name}`,
      kind: "FIELD_RENAME",
      fromFieldName: oldField.name,
      candidateFieldNames,
      reason,
    }));
    operations.push({
      op: "REQUIRE_MANUAL_MAPPING",
      fromFieldName: oldField.name,
      candidateFieldNames,
      reason,
    });
    blockingIssues.push(reason);
  }

  for (const newField of maps.newFields) {
    if (maps.oldFieldsByName.has(newField.name) || renamedNewFieldNames.has(newField.name)) {
      continue;
    }

    const defaultValue = getDefaultValue(newField, options.defaults);
    if (defaultValue.exists) {
      operations.push({
        op: "ADD_DEFAULT",
        fieldName: newField.name,
        defaultValue: cloneUnknown(defaultValue.value),
      });
      continue;
    }

    if (newField.required === true) {
      blockingIssues.push(`新增必填字段 ${newField.name} 缺少 defaultValue，历史提交无法自动迁移。`);
      continue;
    }
  }

  const changeOptions: SchemaChangeDetectionOptions = {};
  if (options.renameMap !== undefined) {
    changeOptions.renameMap = options.renameMap;
  }
  if (options.optionValueMap !== undefined) {
    changeOptions.optionValueMap = options.optionValueMap;
  }
  if (options.archiveRemovedFields !== undefined) {
    changeOptions.archiveRemovedFields = options.archiveRemovedFields;
  }
  const changes = detectSchemaChanges(oldSchema, newSchema, changeOptions);
  warnings.push(
    ...changes
      .filter((change) => change.level === "NEEDS_APPROVAL")
      .map((change) => change.message),
  );

  const plan: MigrationPlan = {
    operations,
    manualMappingSlots,
    executable: manualMappingSlots.length === 0 && blockingIssues.length === 0,
    blockingIssues: uniqueStrings(blockingIssues),
    warnings: uniqueStrings(warnings),
    checksumInput: {
      fromSchemaVersionId: oldSchema.schemaVersionId,
      toSchemaVersionId: newSchema.schemaVersionId,
      operations,
      manualMappingSlots,
      options: {
        renameMap: options.renameMap,
        defaults: options.defaults,
        optionValueMap: options.optionValueMap,
        archiveRemovedFields: options.archiveRemovedFields,
        cutoffSubmittedAt: options.cutoffSubmittedAt,
        includedSubmissionIds: options.includedSubmissionIds,
      },
      changeCodes: changes.map((change) => change.code),
      renamedOldFieldNames: [...renamedOldFieldNames].sort(),
    },
    canonicalSerializationVersion: "canonical-json-v1",
  };

  if (oldSchema.schemaVersionId !== undefined) {
    plan.fromSchemaVersionId = oldSchema.schemaVersionId;
  }
  if (newSchema.schemaVersionId !== undefined) {
    plan.toSchemaVersionId = newSchema.schemaVersionId;
  }
  if (options.cutoffSubmittedAt !== undefined) {
    plan.cutoffSubmittedAt = options.cutoffSubmittedAt;
  }
  if (options.includedSubmissionIds !== undefined) {
    plan.includedSubmissionIds = options.includedSubmissionIds;
  }

  return plan;
}

export function dryRunMigration(
  plan: MigrationPlan,
  submissions: MigrationSubmissionInput[],
  newSchema: LabelHubSchema,
  options: DryRunMigrationOptions = {},
): MigrationDryRunReport {
  const sampleLimit = options.sampleLimit ?? 10;
  const operationStats = new Map<string, { op: string; fieldName?: string; count: number }>();
  const archivedFieldStats = new Map<string, number>();
  const validationErrors: MigrationDryRunReport["validationErrors"] = [];
  const skippedSubmissions: MigrationSkippedSubmission[] = [];
  const sampleCandidates: SampleCandidate[] = [];
  const dryRunBlockingIssues = new Set(plan.blockingIssues);
  const sanitizedSchema = removeCustomValidationRules(newSchema);
  let affectedSubmissions = 0;

  for (const submission of submissions) {
    const outOfScopeReason = getOutOfScopeReason(plan, submission);
    if (outOfScopeReason !== undefined) {
      skippedSubmissions.push({
        submissionId: submission.submissionId,
        reason: "OUT_OF_SCOPE",
        message: outOfScopeReason,
      });
      continue;
    }

    const before = cloneAnswerPayload(submission.answers);
    const after = cloneAnswerPayload(submission.answers);
    const archivedAnswers: AnswerPayload = {};
    const signals = new Set<SampleSignal>();
    const blockingMessages: string[] = [];
    let affected = false;

    for (const operation of plan.operations) {
      const result = applyMigrationOperation(operation, after, archivedAnswers);
      if (result.applied) {
        affected = true;
        signals.add(result.sampleSignal ?? "AFFECTED");
        incrementOperationStat(operationStats, operation, result.touchedFieldName);
      }
      if (operation.op === "ARCHIVE_FIELD" && Object.prototype.hasOwnProperty.call(archivedAnswers, operation.fieldName)) {
        incrementArchivedFieldStat(archivedFieldStats, operation.fieldName);
        signals.add("ARCHIVED");
      }
      if (result.blockedMessage !== undefined) {
        blockingMessages.push(result.blockedMessage);
      }
    }

    if (affected || blockingMessages.length > 0) {
      affectedSubmissions += 1;
    }

    if (blockingMessages.length > 0) {
      signals.add("BLOCKING");
      for (const message of blockingMessages) {
        dryRunBlockingIssues.add(message);
      }
      skippedSubmissions.push({
        submissionId: submission.submissionId,
        reason: "BLOCKED",
        message: blockingMessages.join("；"),
      });
    }

    const validationContext = createValidationContext(submission, after, newSchema, options.contextFactory);
    const normalizeResult = normalizeAnswers(sanitizedSchema, after, validationContext);
    const normalizedAnswers = normalizeResult.answers;
    const validationResult = validateAnswers(
      sanitizedSchema,
      normalizedAnswers,
      {
        ...validationContext,
        answers: normalizedAnswers,
      },
    );
    const submissionValidationErrors = [...normalizeResult.errors, ...validationResult.errors];

    if (submissionValidationErrors.length > 0) {
      signals.add("VALIDATION_FAILED");
      validationErrors.push(...submissionValidationErrors.map((error) => createMigrationValidationError(submission, error)));
      skippedSubmissions.push({
        submissionId: submission.submissionId,
        reason: "VALIDATION_FAILED",
        message: "迁移后的 answers 未通过目标 schema 内置校验。",
      });
    }

    if (signals.size > 0) {
      const candidate: SampleCandidate = {
        submissionId: submission.submissionId,
        before,
        after: normalizedAnswers,
        signals,
      };
      if (Object.keys(archivedAnswers).length > 0) {
        candidate.archivedAnswers = archivedAnswers;
      }
      sampleCandidates.push(candidate);
    }
  }

  const sortedOperationStats = [...operationStats.values()].sort(compareOperationStats);
  const sortedArchivedFieldStats = [...archivedFieldStats.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fieldName, count]) => ({ fieldName, count }));
  const sampleBeforeAfter = sampleCandidates
    .sort(compareSampleCandidates)
    .slice(0, sampleLimit)
    .map((candidate) => {
      const sample: MigrationDryRunReport["sampleBeforeAfter"][number] = {
        submissionId: candidate.submissionId,
        before: candidate.before,
        after: candidate.after,
      };
      if (candidate.archivedAnswers !== undefined) {
        sample.archivedAnswers = candidate.archivedAnswers;
      }
      return sample;
    });

  return {
    totalSubmissions: submissions.length,
    affectedSubmissions,
    executable: plan.executable && dryRunBlockingIssues.size === 0 && validationErrors.length === 0,
    operationStats: sortedOperationStats,
    archivedFieldStats: sortedArchivedFieldStats,
    validationErrors,
    sampleBeforeAfter,
    skippedSubmissions,
    blockingIssues: [...dryRunBlockingIssues].sort(),
    samplingPolicy: {
      sampleLimit,
      strategy: "PRIORITIZED_DETERMINISTIC",
      priorityOrder: [...samplePriorityOrder],
    },
  };
}

function createFieldMaps(oldSchema: LabelHubSchema, newSchema: LabelHubSchema): FieldMaps {
  const oldFields = collectFieldNodes(oldSchema);
  const newFields = collectFieldNodes(newSchema);
  return {
    oldFields,
    newFields,
    oldFieldsByName: mapFieldsByName(oldFields),
    newFieldsByName: mapFieldsByName(newFields),
  };
}

function createExistingFieldOperations(
  oldField: FieldNode,
  newField: FieldNode,
  options: CreateMigrationPlanOptions,
  blockingIssues: string[],
  manualMappingSlots: ManualMappingSlot[],
): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  const castOperation = createCastOperation(newField.name, oldField.type, newField.type);

  if (castOperation === undefined) {
    operations.push({ op: "KEEP_FIELD", fieldName: newField.name });
  } else {
    operations.push(castOperation);
  }

  if (isChoiceField(oldField) && isChoiceField(newField)) {
    operations.push(...createOptionValueOperations(oldField, newField, options, blockingIssues, manualMappingSlots));
  }

  return operations;
}

function createCastOperation(
  fieldName: string,
  fromType: FieldNode["type"],
  toType: FieldNode["type"],
): MigrationOperation | undefined {
  if (fromType === toType) {
    return undefined;
  }

  if (
    (fromType === "choice.radio" && toType === "choice.checkbox") ||
    (fromType === "choice.checkbox" && toType === "choice.radio") ||
    (fromType === "input.text" && toType === "input.textarea")
  ) {
    return {
      op: "CAST_VALUE",
      fieldName,
      fromType,
      toType,
    };
  }

  return undefined;
}

function createOptionValueOperations(
  oldField: ChoiceFieldNode,
  newField: ChoiceFieldNode,
  options: CreateMigrationPlanOptions,
  blockingIssues: string[],
  manualMappingSlots: ManualMappingSlot[],
  targetFieldName = oldField.name,
): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  const newValues = new Set(newField.options.map((option) => option.value));
  const optionMap = options.optionValueMap?.[oldField.name];

  for (const oldOption of oldField.options) {
    if (newValues.has(oldOption.value)) {
      continue;
    }

    const mappedValue = optionMap?.[oldOption.value];
    if (mappedValue !== undefined && newValues.has(mappedValue)) {
      operations.push({
        op: "MAP_OPTION_VALUE",
        fieldName: targetFieldName,
        fromValue: oldOption.value,
        toValue: mappedValue,
      });
      continue;
    }

    const candidateValues = newField.options.map((option) => option.value);
    const reason = `字段 ${oldField.name} 的选项值 ${oldOption.value} 在目标 schema 中不存在，且没有提供 optionValueMap。`;
    manualMappingSlots.push(createManualMappingSlot({
      slotId: `slot_option_value_${oldField.name}_${oldOption.value}`,
      kind: "OPTION_VALUE_MAP",
      fromFieldName: oldField.name,
      fromValue: oldOption.value,
      candidateValues,
      reason,
    }));
    blockingIssues.push(reason);
  }

  return operations;
}

function applyMigrationOperation(
  operation: MigrationOperation,
  answers: AnswerPayload,
  archivedAnswers: AnswerPayload,
): ApplyOperationResult {
  switch (operation.op) {
    case "KEEP_FIELD":
      return { applied: false };
    case "RENAME_FIELD":
      if (!Object.prototype.hasOwnProperty.call(answers, operation.from)) {
        return { applied: false };
      }
      answers[operation.to] = answers[operation.from];
      delete answers[operation.from];
      return { applied: true, touchedFieldName: operation.to, sampleSignal: "RENAME_FIELD" };
    case "CAST_VALUE":
      return applyCastOperation(operation, answers);
    case "ARCHIVE_FIELD":
      if (!Object.prototype.hasOwnProperty.call(answers, operation.fieldName)) {
        return { applied: false };
      }
      archivedAnswers[operation.fieldName] = answers[operation.fieldName];
      delete answers[operation.fieldName];
      return { applied: true, touchedFieldName: operation.fieldName, sampleSignal: "ARCHIVED" };
    case "ADD_DEFAULT":
      if (Object.prototype.hasOwnProperty.call(answers, operation.fieldName)) {
        return { applied: false };
      }
      answers[operation.fieldName] = cloneUnknown(operation.defaultValue);
      return { applied: true, touchedFieldName: operation.fieldName, sampleSignal: "ADD_DEFAULT" };
    case "MAP_OPTION_VALUE":
      return applyOptionValueMapping(operation, answers);
    case "REQUIRE_MANUAL_MAPPING":
      return {
        applied: false,
        blockedMessage: `字段 ${operation.fromFieldName} 需要人工映射：${operation.reason}`,
      };
    case "CUSTOM_TRANSFORM":
      return {
        applied: false,
        blockedMessage: `CUSTOM_TRANSFORM ${operation.transformFnId} 不能在 dry run 中执行。`,
      };
  }
}

function applyCastOperation(
  operation: Extract<MigrationOperation, { op: "CAST_VALUE" }>,
  answers: AnswerPayload,
): ApplyOperationResult {
  if (!Object.prototype.hasOwnProperty.call(answers, operation.fieldName)) {
    return { applied: false };
  }

  const value = answers[operation.fieldName];
  if (operation.fromType === "choice.radio" && operation.toType === "choice.checkbox") {
    if (typeof value !== "string") {
      return {
        applied: false,
        blockedMessage: `字段 ${operation.fieldName} 无法从 choice.radio 转为 choice.checkbox：原值不是 string。`,
      };
    }
    answers[operation.fieldName] = [value];
    return { applied: true, touchedFieldName: operation.fieldName, sampleSignal: "CAST_VALUE" };
  }

  if (operation.fromType === "choice.checkbox" && operation.toType === "choice.radio") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      return {
        applied: false,
        blockedMessage: `字段 ${operation.fieldName} 无法从 choice.checkbox 转为 choice.radio：原值不是 string[]。`,
      };
    }
    if (value.length !== 1) {
      return {
        applied: false,
        blockedMessage: `字段 ${operation.fieldName} 无法从 choice.checkbox 转为 choice.radio：只能迁移单选数组。`,
      };
    }
    const firstValue = value[0];
    if (firstValue === undefined) {
      return {
        applied: false,
        blockedMessage: `字段 ${operation.fieldName} 无法从 choice.checkbox 转为 choice.radio：缺少可迁移选项。`,
      };
    }
    answers[operation.fieldName] = firstValue;
    return { applied: true, touchedFieldName: operation.fieldName, sampleSignal: "CAST_VALUE" };
  }

  if (operation.fromType === "input.text" && operation.toType === "input.textarea") {
    return { applied: true, touchedFieldName: operation.fieldName, sampleSignal: "CAST_VALUE" };
  }

  return {
    applied: false,
    blockedMessage: `字段 ${operation.fieldName} 不支持从 ${operation.fromType} 转为 ${operation.toType}。`,
  };
}

function applyOptionValueMapping(
  operation: Extract<MigrationOperation, { op: "MAP_OPTION_VALUE" }>,
  answers: AnswerPayload,
): ApplyOperationResult {
  if (!Object.prototype.hasOwnProperty.call(answers, operation.fieldName)) {
    return { applied: false };
  }

  const value = answers[operation.fieldName];
  if (value === operation.fromValue) {
    answers[operation.fieldName] = operation.toValue;
    return { applied: true, touchedFieldName: operation.fieldName, sampleSignal: "AFFECTED" };
  }

  if (Array.isArray(value) && value.some((item) => item === operation.fromValue)) {
    answers[operation.fieldName] = value.map((item) => (item === operation.fromValue ? operation.toValue : item));
    return { applied: true, touchedFieldName: operation.fieldName, sampleSignal: "AFFECTED" };
  }

  return { applied: false };
}

function getOutOfScopeReason(plan: MigrationPlan, submission: MigrationSubmissionInput): string | undefined {
  if (plan.includedSubmissionIds !== undefined && !plan.includedSubmissionIds.includes(submission.submissionId)) {
    return `submission ${submission.submissionId} 不在 includedSubmissionIds 范围内。`;
  }

  if (plan.cutoffSubmittedAt !== undefined) {
    if (submission.submittedAt === undefined) {
      return `submission ${submission.submissionId} 缺少 submittedAt，无法确认 cutoffSubmittedAt。`;
    }
    if (submission.submittedAt > plan.cutoffSubmittedAt) {
      return `submission ${submission.submissionId} 晚于 cutoffSubmittedAt。`;
    }
  }

  return undefined;
}

function createValidationContext(
  submission: MigrationSubmissionInput,
  answers: AnswerPayload,
  newSchema: LabelHubSchema,
  contextFactory?: (submission: MigrationSubmissionInput) => RuntimeContextWithOutput,
): RuntimeContextWithOutput {
  const baseContext = contextFactory?.(submission) ?? createDefaultRuntimeContext(submission, newSchema);
  return {
    ...baseContext,
    answers,
  };
}

function createDefaultRuntimeContext(
  submission: MigrationSubmissionInput,
  schema: LabelHubSchema,
): RuntimeContextWithOutput {
  const schemaVersionId = schema.schemaVersionId ?? "sv_migration_target";
  return {
    task: {
      id: schema.meta.taskId,
      title: schema.meta.name,
      status: "PUBLISHED",
      activeSchemaVersionId: schemaVersionId,
    },
    schema: {
      schemaId: schema.schemaId,
      schemaVersionId,
      schemaVersionNo: schema.schemaVersionNo ?? 1,
      contractVersion: schema.contractVersion,
    },
    item: {
      id: `item_migration_${submission.submissionId}`,
      sourcePayload: {},
    },
    answers: submission.answers,
    system: {
      actor: {
        id: "usr_migration_system",
        role: "SYSTEM",
        displayName: "Migration Dry Run",
      },
      role: "SYSTEM",
      now: "2026-05-24T00:00:00.000Z",
    },
  };
}

function removeCustomValidationRules(schema: LabelHubSchema): LabelHubSchema {
  return {
    ...schema,
    root: removeCustomValidationRulesFromContainer(schema.root),
  };
}

function removeCustomValidationRulesFromContainer(node: ContainerNode): ContainerNode {
  return {
    ...node,
    children: node.children.map(removeCustomValidationRulesFromNode),
  };
}

function removeCustomValidationRulesFromNode(node: SchemaNode): SchemaNode {
  if (node.kind === "CONTAINER") {
    return removeCustomValidationRulesFromContainer(node);
  }

  if (node.kind !== "FIELD") {
    return node;
  }

  const nextField: FieldNode = { ...node };
  const filteredRules = filterCustomValidationRules(node.validations);
  if (filteredRules === undefined) {
    delete nextField.validations;
  } else {
    nextField.validations = filteredRules;
  }
  return nextField;
}

function filterCustomValidationRules(rules: ValidationRule[] | undefined): ValidationRule[] | undefined {
  if (rules === undefined) {
    return undefined;
  }

  const filtered = rules.flatMap((rule): ValidationRule[] => {
    if (rule.type === "custom") {
      return [];
    }
    if (rule.type === "conditional") {
      return [
        {
          ...rule,
          rules: filterCustomValidationRules(rule.rules) ?? [],
        },
      ];
    }
    return [rule];
  });

  return filtered.length > 0 ? filtered : undefined;
}

function createMigrationValidationError(
  submission: MigrationSubmissionInput,
  error: ValidationError,
): MigrationDryRunReport["validationErrors"][number] {
  const result: MigrationDryRunReport["validationErrors"][number] = {
    submissionId: submission.submissionId,
    message: error.message,
  };
  if (error.fieldName !== undefined) {
    result.fieldName = error.fieldName;
  }
  return result;
}

function mapFieldsByName(fields: FieldNode[]): Map<string, FieldNode> {
  return new Map(fields.map((field) => [field.name, field]));
}

function isChoiceField(field: FieldNode): field is ChoiceFieldNode {
  return (
    field.type === "choice.radio" ||
    field.type === "choice.checkbox" ||
    field.type === "choice.select" ||
    field.type === "choice.tags"
  );
}

function createManualMappingSlot(input: {
  slotId: string;
  kind: ManualMappingSlot["kind"];
  fromFieldName?: string;
  candidateFieldNames?: string[];
  fromValue?: string;
  candidateValues?: string[];
  reason: string;
}): ManualMappingSlot {
  const slot: ManualMappingSlot = {
    slotId: input.slotId,
    kind: input.kind,
    reason: input.reason,
    required: true,
    resolved: false,
  };

  if (input.fromFieldName !== undefined) {
    slot.fromFieldName = input.fromFieldName;
  }
  if (input.candidateFieldNames !== undefined) {
    slot.candidateFieldNames = input.candidateFieldNames;
  }
  if (input.fromValue !== undefined) {
    slot.fromValue = input.fromValue;
  }
  if (input.candidateValues !== undefined) {
    slot.candidateValues = input.candidateValues;
  }

  return slot;
}

function getDefaultValue(
  field: FieldNode,
  defaults: Record<string, unknown> | undefined,
): { exists: true; value: unknown } | { exists: false } {
  if (defaults !== undefined && Object.prototype.hasOwnProperty.call(defaults, field.name)) {
    return { exists: true, value: defaults[field.name] };
  }

  if (field.defaultValue !== undefined) {
    return { exists: true, value: field.defaultValue };
  }

  return { exists: false };
}

function incrementOperationStat(
  stats: Map<string, { op: string; fieldName?: string; count: number }>,
  operation: MigrationOperation,
  touchedFieldName?: string,
): void {
  const fieldName = touchedFieldName ?? getOperationFieldName(operation);
  const key = `${operation.op}:${fieldName ?? ""}`;
  const current = stats.get(key);
  if (current === undefined) {
    const stat: { op: string; fieldName?: string; count: number } = {
      op: operation.op,
      count: 1,
    };
    if (fieldName !== undefined) {
      stat.fieldName = fieldName;
    }
    stats.set(key, stat);
    return;
  }

  current.count += 1;
}

function incrementArchivedFieldStat(stats: Map<string, number>, fieldName: string): void {
  stats.set(fieldName, (stats.get(fieldName) ?? 0) + 1);
}

function getOperationFieldName(operation: MigrationOperation): string | undefined {
  switch (operation.op) {
    case "KEEP_FIELD":
    case "CAST_VALUE":
    case "ARCHIVE_FIELD":
    case "ADD_DEFAULT":
    case "MAP_OPTION_VALUE":
      return operation.fieldName;
    case "RENAME_FIELD":
      return operation.to;
    case "REQUIRE_MANUAL_MAPPING":
      return operation.fromFieldName;
    case "CUSTOM_TRANSFORM":
      return operation.fieldNames[0];
  }
}

function compareOperationStats(
  left: { op: string; fieldName?: string; count: number },
  right: { op: string; fieldName?: string; count: number },
): number {
  const opCompare = left.op.localeCompare(right.op);
  if (opCompare !== 0) {
    return opCompare;
  }
  return (left.fieldName ?? "").localeCompare(right.fieldName ?? "");
}

function compareSampleCandidates(left: SampleCandidate, right: SampleCandidate): number {
  const priorityCompare = getSamplePriority(left) - getSamplePriority(right);
  if (priorityCompare !== 0) {
    return priorityCompare;
  }
  return left.submissionId.localeCompare(right.submissionId);
}

function getSamplePriority(candidate: SampleCandidate): number {
  const priorities = [...candidate.signals].map((signal) => samplePriorityOrder.indexOf(signal));
  return Math.min(...priorities);
}

function cloneAnswerPayload(value: AnswerPayload): AnswerPayload {
  return cloneUnknown(value) as AnswerPayload;
}

function cloneUnknown(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}
