import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewDetailResponse, ReviewDimension } from "../index";

type Equal<A, B> = [A, B] extends [B, A] ? true : false;
const compatible: Equal<ReviewDetailResponse["reviewDimensions"], Pick<ReviewDimension, "key" | "label">[] | undefined> = true;
test("审核维度名称元数据复用配置字段且对旧响应保持可选", () => {
  assert.equal(compatible, true);
});
