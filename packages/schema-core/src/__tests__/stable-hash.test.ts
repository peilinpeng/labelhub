import { equal, throws } from "node:assert/strict";
import { describe, test } from "node:test";
import { stableStringify } from "../index.ts";

describe("stableStringify canonical-json-v1", () => {
  test("object key 顺序不同，输出完全一致", () => {
    equal(
      stableStringify({ b: 2, a: 1 }),
      stableStringify({ a: 1, b: 2 }),
    );
    equal(stableStringify({ b: 2, a: 1 }), "{\"a\":1,\"b\":2}");
  });

  test("nested object key 排序稳定", () => {
    equal(
      stableStringify({ outer: { z: 1, a: 2 }, b: 3 }),
      "{\"b\":3,\"outer\":{\"a\":2,\"z\":1}}",
    );
  });

  test("array 顺序保持", () => {
    equal(stableStringify([3, 1, 2]), "[3,1,2]");
  });

  test("Date 转 ISO string", () => {
    equal(
      stableStringify({ at: new Date("2026-05-24T10:00:00.000Z") }),
      "{\"at\":\"2026-05-24T10:00:00.000Z\"}",
    );
  });

  test("object 中 undefined 字段被删除", () => {
    equal(stableStringify({ a: 1, b: undefined }), "{\"a\":1}");
  });

  test("array 中 undefined 转 null", () => {
    equal(stableStringify([1, undefined, 3]), "[1,null,3]");
  });

  test("function 抛错", () => {
    const value: unknown = () => undefined;
    throws(() => stableStringify(value), /不支持 function/);
  });

  test("Symbol 抛错", () => {
    const value: unknown = Symbol("labelhub");
    throws(() => stableStringify(value), /不支持 Symbol/);
  });

  test("BigInt 抛错", () => {
    const value: unknown = BigInt(1);
    throws(() => stableStringify(value), /不支持 BigInt/);
  });

  test("循环引用抛错", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    throws(() => stableStringify(value), /循环引用/);
  });

  test("string escaping 使用 JSON.stringify 语义", () => {
    const value = "第一行\n\"第二行\"";

    equal(stableStringify(value), JSON.stringify(value));
  });

  test("null / boolean / number / string 输出符合 JSON 语义", () => {
    equal(stableStringify(null), "null");
    equal(stableStringify(true), "true");
    equal(stableStringify(3.14), "3.14");
    equal(stableStringify("文本"), "\"文本\"");
  });
});
