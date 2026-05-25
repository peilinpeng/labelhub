import type { LabelHubSchema, SchemaValidationError, SchemaValidationResult } from "@labelhub/contracts";
import {
  assertUniqueFieldNames,
  assertUniqueNodeIds,
  findNodeById,
  validateExpressionPaths,
  validateLLMOutputBindings,
  validateSchemaShape,
  validateShowItemPaths,
} from "@labelhub/schema-core";
import type { DesignerState } from "./types";

export function createDesignerState(schema: LabelHubSchema): DesignerState {
  return {
    validationResult: validateDesignerSchema(schema),
    localErrors: [],
    previewAnswers: {},
    activePanel: "MATERIALS",
  };
}

export function syncDesignerState(schema: LabelHubSchema, state: DesignerState): DesignerState {
  const selectedNodeId =
    state.selectedNodeId !== undefined && findNodeById(schema, state.selectedNodeId) !== undefined
      ? state.selectedNodeId
      : undefined;

  return {
    ...state,
    ...(selectedNodeId === undefined ? {} : { selectedNodeId }),
    ...(selectedNodeId === undefined ? { selectedNodeId: undefined } : {}),
    validationResult: validateDesignerSchema(schema),
  };
}

export function validateDesignerSchema(schema: LabelHubSchema): SchemaValidationResult {
  const results = [
    validateSchemaShape(schema),
    assertUniqueNodeIds(schema),
    assertUniqueFieldNames(schema),
    validateLLMOutputBindings(schema),
    validateExpressionPaths(schema),
    validateShowItemPaths(schema),
  ];

  const errors = dedupeErrors(results.flatMap((result) => result.errors));
  const warnings = dedupeErrors(results.flatMap((result) => result.warnings));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function createLocalError(nodeId: string | undefined, path: string, message: string): SchemaValidationError {
  const error: SchemaValidationError = {
    code: "SCHEMA_INVALID",
    path,
    message,
  };
  return nodeId === undefined ? error : { ...error, nodeId };
}

function dedupeErrors(errors: SchemaValidationError[]): SchemaValidationError[] {
  const seen = new Set<string>();
  const result: SchemaValidationError[] = [];

  for (const error of errors) {
    const key = `${error.code}:${error.nodeId ?? ""}:${error.path}:${error.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(error);
  }

  return result;
}
