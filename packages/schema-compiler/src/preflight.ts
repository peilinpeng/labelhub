import type { AnswerPayload, FieldLinkageEffect, LabelHubSchema } from "@labelhub/contracts";
import { collectFieldNodes, evaluateExpression, isEmptyValue } from "@labelhub/schema-core";
import type { RuntimeContextWithOutput } from "@labelhub/schema-core";
import { buildReactionPlan } from "./formily-reaction-visitor.ts";
import type { CompiledReaction } from "./formily-reaction-visitor.ts";

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

export type PreflightPatchOperation =
  | { op: "set"; fieldName: string; value: unknown }
  | { op: "unset"; fieldName: string };

export interface PreflightInput {
  schema: LabelHubSchema;
  currentAnswers: AnswerPayload;
  patch: PreflightPatchOperation[];
}

export interface PreflightFieldState {
  fieldName: string;
  visible: boolean;
  disabled: boolean;
  required: boolean;
}

export type PreflightWarningCode =
  | "PATCH_TARGET_BECOMES_HIDDEN"
  | "PATCH_TARGET_BECOMES_DISABLED"
  | "FIELD_WILL_BE_CLEARED"
  | "OPTIONS_WILL_CHANGE"
  | "SET_WARNING_EFFECT"
  | "SET_READONLY_EFFECT";

export type PreflightErrorCode =
  | "PATCH_TARGET_FIELD_NOT_FOUND"
  | "REQUIRED_FIELD_MISSING";

export interface PreflightWarning {
  code: PreflightWarningCode;
  fieldName?: string;
  ruleId?: string;
  source?: "visibleWhen" | "disabledWhen" | "linkageRule" | "patch" | "validation";
  message: string;
}

export interface PreflightError {
  code: PreflightErrorCode;
  fieldName?: string;
  ruleId?: string;
  source?: "visibleWhen" | "disabledWhen" | "linkageRule" | "patch" | "validation";
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  nextAnswers: AnswerPayload;
  changedFieldNames: string[];
  clearedFieldNames: string[];
  hiddenFieldNames: string[];
  disabledFieldNames: string[];
  requiredMissingFieldNames: string[];
  affectedFieldNames: string[];
  warnings: PreflightWarning[];
  errors: PreflightError[];
  fieldStates: Record<string, PreflightFieldState>;
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export function runSchemaPreflight(input: PreflightInput): PreflightResult {
  const { schema, currentAnswers, patch } = input;

  const errors: PreflightError[] = [];
  const warnings: PreflightWarning[] = [];

  // 收集 schema 中所有字段名，用于验证 patch target
  const allFields = collectFieldNodes(schema);
  const fieldNameSet = new Set(allFields.map((f) => f.name));

  // ------------------------------------------------------------------
  // 1. 应用 patch → 生成 nextAnswers（不修改原对象）
  // ------------------------------------------------------------------
  const nextAnswers: AnswerPayload = { ...currentAnswers };
  const patchedFieldNames = new Set<string>();

  for (const op of patch) {
    if (!fieldNameSet.has(op.fieldName)) {
      errors.push({
        code: "PATCH_TARGET_FIELD_NOT_FOUND",
        fieldName: op.fieldName,
        source: "patch",
        message: `patch 目标字段 "${op.fieldName}" 在 schema 中不存在`,
      });
      continue;
    }
    patchedFieldNames.add(op.fieldName);
    if (op.op === "set") {
      nextAnswers[op.fieldName] = op.value;
    } else {
      delete nextAnswers[op.fieldName];
    }
  }

  // ------------------------------------------------------------------
  // 2. 初始化 fieldStates
  // ------------------------------------------------------------------
  const fieldStates: Record<string, PreflightFieldState> = {};
  for (const field of allFields) {
    fieldStates[field.name] = {
      fieldName: field.name,
      visible: field.hidden === true ? false : true,
      disabled: field.disabled === true,
      required: field.required === true,
    };
  }

  // ------------------------------------------------------------------
  // 3. 执行 ReactionPlan
  // ------------------------------------------------------------------
  const reactionPlan = buildReactionPlan(schema);
  const runtimeCtx = buildRuntimeContext(schema, nextAnswers);
  const clearedSet = new Set<string>();
  const changedByReactionSet = new Set<string>();

  for (const reaction of reactionPlan.reactions) {
    const matched = evaluateExpression(reaction.when, runtimeCtx);
    applyEffects(
      matched ? reaction.effects : reaction.otherwise,
      reaction,
      fieldStates,
      nextAnswers,
      clearedSet,
      changedByReactionSet,
      warnings,
    );
  }

  // ------------------------------------------------------------------
  // 4. 计算衍生输出
  // ------------------------------------------------------------------
  const hiddenFieldNames = Object.values(fieldStates)
    .filter((s) => !s.visible)
    .map((s) => s.fieldName)
    .sort();

  const disabledFieldNames = Object.values(fieldStates)
    .filter((s) => s.disabled)
    .map((s) => s.fieldName)
    .sort();

  const clearedFieldNames = [...clearedSet].sort();

  // changedFieldNames：patch 直接写入的字段 + reaction setValue 写入的字段
  const changedFieldNames = [
    ...new Set([...patchedFieldNames, ...changedByReactionSet]),
  ].sort();

  // requiredMissingFieldNames：visible + required + 值为空（disabled 字段不算 blocker）
  const requiredMissingFieldNames: string[] = [];
  for (const state of Object.values(fieldStates)) {
    if (!state.visible) continue;
    if (state.disabled) continue;
    if (!state.required) continue;
    const val = nextAnswers[state.fieldName];
    if (isEmptyValue(val)) {
      requiredMissingFieldNames.push(state.fieldName);
      errors.push({
        code: "REQUIRED_FIELD_MISSING",
        fieldName: state.fieldName,
        source: "validation",
        message: `必填字段 "${state.fieldName}" 在 patch 应用后值为空`,
      });
    }
  }
  requiredMissingFieldNames.sort();

  // 风险 warnings：patch 写入字段最终被隐藏 / 禁用
  for (const fieldName of patchedFieldNames) {
    const state = fieldStates[fieldName];
    if (state === undefined) continue;
    if (!state.visible) {
      warnings.push({
        code: "PATCH_TARGET_BECOMES_HIDDEN",
        fieldName,
        source: "patch",
        message: `patch 写入的字段 "${fieldName}" 在 patch 应用后被隐藏`,
      });
    }
    if (state.disabled) {
      warnings.push({
        code: "PATCH_TARGET_BECOMES_DISABLED",
        fieldName,
        source: "patch",
        message: `patch 写入的字段 "${fieldName}" 在 patch 应用后被禁用`,
      });
    }
  }

  // affectedFieldNames：发生状态变化的字段（changed + cleared + hidden + disabled）
  const affectedFieldNames = [
    ...new Set([
      ...changedFieldNames,
      ...clearedFieldNames,
      ...hiddenFieldNames,
      ...disabledFieldNames,
      ...requiredMissingFieldNames,
    ]),
  ].sort();

  // 稳定排序 warnings / errors
  warnings.sort((a, b) => sortKey(a.fieldName, a.code).localeCompare(sortKey(b.fieldName, b.code)));
  errors.sort((a, b) => sortKey(a.fieldName, a.code).localeCompare(sortKey(b.fieldName, b.code)));

  return {
    ok: errors.length === 0,
    nextAnswers,
    changedFieldNames,
    clearedFieldNames,
    hiddenFieldNames,
    disabledFieldNames,
    requiredMissingFieldNames,
    affectedFieldNames,
    warnings,
    errors,
    fieldStates,
  };
}

// ---------------------------------------------------------------------------
// effect 执行（headless，无 Formily 依赖）
// ---------------------------------------------------------------------------

function applyEffects(
  effects: FieldLinkageEffect[],
  reaction: CompiledReaction,
  fieldStates: Record<string, PreflightFieldState>,
  nextAnswers: AnswerPayload,
  clearedSet: Set<string>,
  changedByReactionSet: Set<string>,
  warnings: PreflightWarning[],
): void {
  for (const effect of effects) {
    switch (effect.action) {
      case "setVisible": {
        const state = fieldStates[effect.target];
        if (state !== undefined) {
          state.visible = effect.value;
        }
        break;
      }

      case "setDisabled": {
        const state = fieldStates[effect.target];
        if (state !== undefined) {
          state.disabled = effect.value;
        }
        break;
      }

      case "setRequired": {
        const state = fieldStates[effect.target];
        if (state !== undefined) {
          state.required = effect.value;
        }
        break;
      }

      case "clearValue": {
        const current = nextAnswers[effect.target];
        if (!isEmptyValue(current)) {
          delete nextAnswers[effect.target];
          if (!clearedSet.has(effect.target)) {
            clearedSet.add(effect.target);
            warnings.push({
              code: "FIELD_WILL_BE_CLEARED",
              fieldName: effect.target,
              ruleId: reaction.ruleId,
              source: reaction.source,
              message: `字段 "${effect.target}" 的值将被规则 "${reaction.ruleId}" 清空`,
            });
          }
        }
        break;
      }

      case "setValue": {
        const current = nextAnswers[effect.target];
        if (current !== effect.value) {
          nextAnswers[effect.target] = effect.value;
          changedByReactionSet.add(effect.target);
        }
        break;
      }

      case "setOptions": {
        // headless preflight 不修改 UI options，记录 affected
        warnings.push({
          code: "OPTIONS_WILL_CHANGE",
          fieldName: effect.target,
          ruleId: reaction.ruleId,
          source: reaction.source,
          message: `字段 "${effect.target}" 的选项将被规则 "${reaction.ruleId}" 修改`,
        });
        break;
      }

      case "setWarning": {
        warnings.push({
          code: "SET_WARNING_EFFECT",
          fieldName: effect.target,
          ruleId: reaction.ruleId,
          source: reaction.source,
          message: `字段 "${effect.target}" 收到来自规则 "${reaction.ruleId}" 的警告`,
        });
        break;
      }

      case "setReadonly": {
        // FE-7 第一版：setReadonly 记录 warning，不阻断
        warnings.push({
          code: "SET_READONLY_EFFECT",
          fieldName: effect.target,
          ruleId: reaction.ruleId,
          source: reaction.source,
          message: `字段 "${effect.target}" 将被规则 "${reaction.ruleId}" 设为只读（headless 预演不支持 setReadonly 状态）`,
        });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function buildRuntimeContext(schema: LabelHubSchema, answers: AnswerPayload): RuntimeContextWithOutput {
  return {
    task: {
      id: schema.meta.taskId,
      title: schema.meta.name,
      status: "PUBLISHED",
      activeSchemaVersionId: schema.schemaVersionId ?? schema.schemaId,
    },
    schema: {
      schemaId: schema.schemaId,
      schemaVersionId: schema.schemaVersionId ?? schema.schemaId,
      schemaVersionNo: schema.schemaVersionNo ?? 0,
      contractVersion: schema.contractVersion,
    },
    item: {
      id: `item_preflight`,
      sourcePayload: {},
    },
    answers,
    system: {
      actor: {
        id: `usr_preflight`,
        role: "LABELER",
        displayName: "preflight",
      },
      role: "LABELER",
      now: new Date().toISOString(),
    },
  };
}

function sortKey(fieldName: string | undefined, code: string): string {
  return `${fieldName ?? ""}::${code}`;
}
