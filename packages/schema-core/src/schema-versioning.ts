import type {
  AnswerPayload,
  LabelHubSchema,
  RuntimeContextWithOutput,
  ValidationError,
} from "@labelhub/contracts";
import { SchemaCoreError } from "./json-path.ts";
import { normalizeAnswers } from "./normalization.ts";
import { validateAnswers } from "./validation.ts";

export function assertPublishedSchemaImmutable(
  previousSchema: LabelHubSchema,
  nextSchema: LabelHubSchema,
): void {
  if (previousSchema.status !== "PUBLISHED") {
    return;
  }

  if (stableStringifyForVersionFreeze(previousSchema) !== stableStringifyForVersionFreeze(nextSchema)) {
    throw new SchemaCoreError(
      "SCHEMA_VERSION_IMMUTABLE",
      "已发布的 SchemaVersion snapshot 不允许被修改。",
    );
  }
}

export function assertSchemaVersionMatched(
  schemaInfo: { schemaVersionId?: string },
  submission: { schemaVersionId?: string },
): void {
  if (schemaInfo.schemaVersionId === undefined && submission.schemaVersionId === undefined) {
    throw new SchemaCoreError("SCHEMA_INVALID", "无法确认 schemaVersionId 绑定：schema 与 submission 均缺少 schemaVersionId。");
  }

  if (schemaInfo.schemaVersionId === undefined) {
    throw new SchemaCoreError("SCHEMA_INVALID", "无法确认 schemaVersionId 绑定：schema 缺少 schemaVersionId。");
  }

  if (submission.schemaVersionId === undefined) {
    throw new SchemaCoreError("SCHEMA_INVALID", "无法确认 schemaVersionId 绑定：submission 缺少 schemaVersionId。");
  }

  if (schemaInfo.schemaVersionId !== submission.schemaVersionId) {
    throw new SchemaCoreError(
      "SCHEMA_INVALID",
      `schemaVersionId 不匹配：schema=${schemaInfo.schemaVersionId}，submission=${submission.schemaVersionId}。`,
    );
  }
}

export function validateSubmissionSchemaBinding(
  schema: LabelHubSchema,
  submission: {
    schemaVersionId: string;
    answers: AnswerPayload;
  },
  context: RuntimeContextWithOutput,
): {
  valid: boolean;
  normalizedAnswers?: AnswerPayload;
  errors: ValidationError[];
} {
  try {
    assertSchemaVersionMatched(schema, submission);
  } catch (error) {
    return {
      valid: false,
      errors: [versionBindingError(error)],
    };
  }

  const normalized = normalizeAnswers(schema, submission.answers, context);
  const normalizedContext = {
    ...context,
    answers: normalized.answers,
  };
  const validation = validateAnswers(schema, normalized.answers, normalizedContext);
  const errors = [...normalized.errors, ...validation.errors];

  return {
    valid: errors.length === 0,
    normalizedAnswers: normalized.answers,
    errors,
  };
}

function versionBindingError(error: unknown): ValidationError {
  if (error instanceof SchemaCoreError) {
    return {
      code: error.code,
      message: error.message,
      severity: "ERROR",
    };
  }

  return {
    code: "SCHEMA_INVALID",
    message: "schemaVersionId 绑定校验失败。",
    severity: "ERROR",
  };
}

function stableStringifyForVersionFreeze(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();

    for (const key of keys) {
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
