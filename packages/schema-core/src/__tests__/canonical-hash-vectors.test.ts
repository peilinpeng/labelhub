// 前后端 canonical-json-v1 + SHA-256 一致性 test vectors（T1-A）。
//
// 这组向量同时被后端 pytest（apps/api/tests/unit/test_hash_vectors.py）断言。
// 两边必须产出**逐字节一致**的 canonical string 与 SHA-256，否则
// finalAnswerHash / beforeAnswerHash / outputHash / promptSnapshotHash /
// passportBatchHash 在前后端对不上。
//
// 黄金值由后端 app/utils/hashing.py 生成（json.dumps sort_keys + separators(",",":")）。
// 修改本文件向量时必须同步修改后端测试，保持两侧一致。
//
// 注意：向量刻意避开浮点数（Python json.dumps(1.0)="1.0" 但 JS JSON.stringify(1.0)="1"，
// 二者不一致），只用整数 / 字符串 / 布尔 / null / 嵌套 / BMP 中文。
import { equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { stableStringify } from "../index.ts";

interface HashVector {
  readonly name: string;
  readonly input: unknown;
  readonly canonical: string;
  readonly sha256: string;
}

// 与 apps/api/tests/unit/test_hash_vectors.py 严格同步
const VECTORS: readonly HashVector[] = [
  {
    name: "key 乱序 + 嵌套",
    input: { b: 2, a: 1, nested: { z: "last", m: "middle" } },
    canonical: '{"a":1,"b":2,"nested":{"m":"middle","z":"last"}}',
    sha256: "888dd66f76e420014cf5dea559f3b7b3a30ea5bdd39ef566c0261bdebb334770",
  },
  {
    name: "中文 key + 数组保序 + bool + null",
    input: { 中文: "值", arr: [3, 1, 2], flag: true, empty: null },
    canonical: '{"arr":[3,1,2],"empty":null,"flag":true,"中文":"值"}',
    sha256: "10fe9686d53911d72c80e73b1f80ba8c1f2dd5ac1c249e3095e1c0d9b416efa3",
  },
  {
    name: "顶层数组含嵌套对象",
    input: ["x", { k2: "v2", k1: "v1" }, 10],
    canonical: '["x",{"k1":"v1","k2":"v2"},10]',
    sha256: "c04a8660d09b5f89f826ff7e0c6306b31488c09ff3fb8b922b4b553a4d408c83",
  },
  {
    name: "深层嵌套",
    input: { a: { d: 4, c: 3 }, b: [{ y: 2, x: 1 }] },
    canonical: '{"a":{"c":3,"d":4},"b":[{"x":1,"y":2}]}',
    sha256: "be7c4247ec8669c74f18acccfe25972754e64977ed6562dace8c61960205b2c3",
  },
  {
    name: "真实 answers 形态",
    input: { summary: "摘要内容", relevance: "5", tags: ["标签a", "标签b"] },
    canonical: '{"relevance":"5","summary":"摘要内容","tags":["标签a","标签b"]}',
    sha256: "9535426da7405d29cdaa07402cc42712edda0863bcb4cc9bab36ba0876d41ed7",
  },
];

describe("canonical-json-v1 + SHA-256 前后端一致性向量", () => {
  for (const v of VECTORS) {
    test(`canonical string 一致：${v.name}`, () => {
      equal(stableStringify(v.input), v.canonical);
    });

    test(`SHA-256 一致：${v.name}`, () => {
      const hash = createHash("sha256").update(stableStringify(v.input), "utf8").digest("hex");
      equal(hash, v.sha256);
    });
  }
});
