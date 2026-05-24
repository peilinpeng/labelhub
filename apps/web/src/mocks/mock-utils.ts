import { HttpResponse } from "msw";
import type { ApiError, ErrorCode, ID, ISODateTime } from "@labelhub/contracts";

export type MockParams = Record<string, string | readonly string[]>;

export interface IdempotencyRecord {
  requestHash: string;
  response: unknown;
  status: number;
}

let sequence = 1000;

export function now(): ISODateTime {
  return new Date().toISOString();
}

export function nextId(prefix: "task" | "schema" | "sv" | "item" | "asn" | "sub" | "rev" | "job" | "file" | "audit" | "llm"): ID {
  sequence += 1;
  return `${prefix}_${sequence}` as ID;
}

export async function readJson<T>(request: Request): Promise<T> {
  const body = await request.json();
  return body as T;
}

export function okJson<T>(body: T, status = 200): Response {
  return HttpResponse.json(body, { status });
}

export function errorJson(code: ErrorCode, message: string, status = 400, details?: unknown): Response {
  const body: ApiError = {
    code,
    message,
    details,
    traceId: `trace_${Date.now()}`,
  };
  return HttpResponse.json(body, { status });
}

export function getParam(params: MockParams, key: string): string {
  const value = params[key];
  if (typeof value === "string") {
    return value;
  }
  return value?.[0] ?? "";
}

export function requestHash(body: unknown): string {
  return stableStringify(body);
}

export function idempotencyScope(request: Request): string | undefined {
  const key = request.headers.get("Idempotency-Key");
  if (key === null || key.length === 0) {
    return undefined;
  }
  return `mock-actor:${request.method}:${new URL(request.url).pathname}:${key}`;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue(value[key]);
      return acc;
    }, {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
