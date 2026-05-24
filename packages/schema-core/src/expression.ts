import type { ExprValue, Expression } from "@labelhub/contracts";
import { getByJsonPath, type RuntimeContextWithOutput } from "./json-path.ts";

export function evaluateExpression(expression: Expression, context: RuntimeContextWithOutput): boolean {
  try {
    switch (expression.op) {
      case "eq":
        return isEqual(resolveExprValue(expression.left, context), resolveExprValue(expression.right, context));
      case "ne":
        return !isEqual(resolveExprValue(expression.left, context), resolveExprValue(expression.right, context));
      case "gt":
        return compareValues(expression.left, expression.right, context, (left, right) => left > right);
      case "gte":
        return compareValues(expression.left, expression.right, context, (left, right) => left >= right);
      case "lt":
        return compareValues(expression.left, expression.right, context, (left, right) => left < right);
      case "lte":
        return compareValues(expression.left, expression.right, context, (left, right) => left <= right);
      case "in":
        return isInList(
          resolveExprValue(expression.left, context),
          expression.right.map((item) => resolveExprValue(item, context)),
        );
      case "notIn":
        return !isInList(
          resolveExprValue(expression.left, context),
          expression.right.map((item) => resolveExprValue(item, context)),
        );
      case "empty":
        return isEmptyValue(resolveExprValue(expression.value, context));
      case "notEmpty":
        return !isEmptyValue(resolveExprValue(expression.value, context));
      case "and":
        return expression.items.every((item) => evaluateExpression(item, context));
      case "or":
        return expression.items.some((item) => evaluateExpression(item, context));
      case "not":
        return !evaluateExpression(expression.item, context);
    }
  } catch {
    return false;
  }
}

export function resolveExprValue(value: ExprValue, context: RuntimeContextWithOutput): unknown {
  if (value.kind === "literal") {
    return value.value;
  }
  return getByJsonPath(context, value.path);
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function compareValues(
  left: ExprValue,
  right: ExprValue,
  context: RuntimeContextWithOutput,
  compare: (left: number, right: number) => boolean,
): boolean {
  const leftValue = resolveExprValue(left, context);
  const rightValue = resolveExprValue(right, context);
  return typeof leftValue === "number" && typeof rightValue === "number" && compare(leftValue, rightValue);
}

function isInList(left: unknown, right: unknown[]): boolean {
  if (Array.isArray(left)) {
    return left.some((item) => right.some((candidate) => isEqual(item, candidate)));
  }
  return right.some((candidate) => isEqual(left, candidate));
}

function isEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (!isJsonSerializable(left) || !isJsonSerializable(right)) {
    return false;
  }
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
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
