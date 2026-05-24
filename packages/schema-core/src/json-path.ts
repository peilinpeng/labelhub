import type { ErrorCode, JsonPath, LabelHubRuntimeContext } from "@labelhub/contracts";

export interface JsonPathOptions {
  allowOutput?: boolean;
}

export type RuntimeContextWithOutput = LabelHubRuntimeContext & {
  output?: unknown;
};

export class SchemaCoreError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "SchemaCoreError";
    this.code = code;
  }
}

const baseNamespaces = [
  "$.task",
  "$.schema",
  "$.item.sourcePayload",
  "$.answers",
  "$.review",
  "$.system",
  "$.meta",
] as const;

export function isAllowedJsonPath(path: JsonPath, options: JsonPathOptions = {}): boolean {
  if (!isSafeJsonPathSyntax(path)) {
    return false;
  }

  if (baseNamespaces.some((namespace) => isNamespacePath(path, namespace))) {
    return true;
  }

  return options.allowOutput === true && isNamespacePath(path, "$.output");
}

export function assertAllowedJsonPath(path: JsonPath, options: JsonPathOptions = {}): void {
  if (!isAllowedJsonPath(path, options)) {
    throw new SchemaCoreError("INVALID_JSON_PATH", `JsonPath 不在允许的 RuntimeContext 命名空间内：${path}`);
  }
}

export function getByJsonPath(
  context: RuntimeContextWithOutput,
  path: JsonPath,
  options: JsonPathOptions = {},
): unknown {
  assertAllowedJsonPath(path, options);

  const segments = parseJsonPathSegments(path);
  let current: unknown = context;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function isNamespacePath(path: string, namespace: string): boolean {
  return path === namespace || path.startsWith(`${namespace}.`) || path.startsWith(`${namespace}[`);
}

function isSafeJsonPathSyntax(path: string): boolean {
  if (!path.startsWith("$.")) {
    return false;
  }

  const normalized = path.replace(/\[(\d+)\]/g, ".$1");
  if (normalized.includes("..") || normalized.endsWith(".")) {
    return false;
  }

  const segments = normalized.slice(2).split(".");
  return segments.every((segment) => /^[A-Za-z0-9_$-]+$/.test(segment));
}

function parseJsonPathSegments(path: string): string[] {
  return path
    .slice(2)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
