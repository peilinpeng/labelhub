import type {
  AnswerPayload,
  FieldNode,
  LabelHubSchema,
  NormalizeAnswersResult,
  ValidationError,
} from "@labelhub/contracts";
import { collectFieldNodes } from "./traverse.ts";
import { resolveNodeDisabled, resolveNodeVisibility } from "./visibility.ts";
import type { RuntimeContextWithOutput } from "./json-path.ts";

export function normalizeAnswers(
  schema: LabelHubSchema,
  answers: AnswerPayload,
  context: RuntimeContextWithOutput,
): NormalizeAnswersResult {
  const normalized: AnswerPayload = {};
  const errors: ValidationError[] = [];

  for (const field of collectFieldNodes(schema)) {
    if (!Object.prototype.hasOwnProperty.call(answers, field.name)) {
      continue;
    }

    const value = answers[field.name];
    const visible = resolveNodeVisibility(field, context);
    const disabled = resolveNodeDisabled(field, context);

    if (!visible && field.preserveWhenHidden !== true) {
      continue;
    }

    if (visible && disabled && field.submitWhenDisabled !== true) {
      continue;
    }

    if (!isValueAcceptedByField(field, value)) {
      errors.push(createValidationError(field, "answers 中的字段值不符合 FieldNode.type"));
      continue;
    }

    normalized[field.name] = value;
  }

  return { answers: normalized, errors };
}

function isValueAcceptedByField(field: FieldNode, value: unknown): boolean {
  switch (field.type) {
    case "choice.radio":
    case "choice.select":
      return typeof value === "string";
    case "choice.checkbox":
    case "choice.tags":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "data.json":
      return isJsonSerializable(value);
    case "upload.file":
    case "upload.image":
      return isFileRef(value) || (Array.isArray(value) && value.every(isFileRef));
    default:
      return true;
  }
}

function isFileRef(value: unknown): boolean {
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

function createValidationError(field: FieldNode, message: string): ValidationError {
  return {
    fieldName: field.name,
    nodeId: field.id,
    code: "VALIDATION_FAILED",
    message,
    severity: "ERROR",
  };
}

function isJsonSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
