export type StableStringifyErrorCode =
  | "CANONICAL_UNSUPPORTED_VALUE"
  | "CANONICAL_CIRCULAR_REFERENCE";

export class StableStringifyError extends Error {
  readonly code: StableStringifyErrorCode;

  constructor(code: StableStringifyErrorCode, message: string) {
    super(message);
    this.name = "StableStringifyError";
    this.code = code;
  }
}

export function stableStringify(value: unknown): string {
  const normalized = toCanonicalJsonValue(value, "$", new WeakSet<object>());
  const result = JSON.stringify(normalized);

  if (result === undefined) {
    throw new StableStringifyError("CANONICAL_UNSUPPORTED_VALUE", "canonical-json-v1 不支持顶层 undefined。");
  }

  return result;
}

function toCanonicalJsonValue(value: unknown, path: string, seen: WeakSet<object>): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    throw new StableStringifyError("CANONICAL_UNSUPPORTED_VALUE", `canonical-json-v1 不支持 BigInt：${path}`);
  }

  if (typeof value === "function") {
    throw new StableStringifyError("CANONICAL_UNSUPPORTED_VALUE", `canonical-json-v1 不支持 function：${path}`);
  }

  if (typeof value === "symbol") {
    throw new StableStringifyError("CANONICAL_UNSUPPORTED_VALUE", `canonical-json-v1 不支持 Symbol：${path}`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new StableStringifyError("CANONICAL_UNSUPPORTED_VALUE", `canonical-json-v1 不支持非法 Date：${path}`);
    }
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    assertNoCircularReference(value, path, seen);
    const normalized = value.map((item, index) => {
      const child = toCanonicalJsonValue(item, `${path}[${index}]`, seen);
      return child === undefined ? null : child;
    });
    seen.delete(value);
    return normalized;
  }

  if (isRecord(value)) {
    assertNoCircularReference(value, path, seen);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = toCanonicalJsonValue(value[key], `${path}.${key}`, seen);
      if (child !== undefined) {
        normalized[key] = child;
      }
    }
    seen.delete(value);
    return normalized;
  }

  throw new StableStringifyError("CANONICAL_UNSUPPORTED_VALUE", `canonical-json-v1 不支持该值：${path}`);
}

function assertNoCircularReference(value: object, path: string, seen: WeakSet<object>): void {
  if (seen.has(value)) {
    throw new StableStringifyError("CANONICAL_CIRCULAR_REFERENCE", `canonical-json-v1 不支持循环引用：${path}`);
  }
  seen.add(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
