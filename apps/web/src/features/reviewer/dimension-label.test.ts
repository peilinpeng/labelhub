import { describe, expect, it } from "vitest";
import { dimensionLabel } from "./dimension-label";

describe("审核维度名称", () => {
  it("配置名称优先于固定字典，支持自定义和同名 key 的任务差异", () => {
    expect(dimensionLabel("accuracy", [{ key: "accuracy", label: "证据一致性" }])).toBe("证据一致性");
    expect(dimensionLabel("correctness", [{ key: "correctness", label: "标注正确性" }])).toBe("标注正确性");
    expect(dimensionLabel("correctness", [{ key: "correctness", label: "偏好判断" }])).toBe("偏好判断");
  });
  it("旧响应和空名称保留标准回退，未知 key 可区分且不读取原型属性", () => {
    expect(dimensionLabel("accuracy")).toBe("内容准确性");
    expect(dimensionLabel("custom", [{ key: "custom", label: " " }])).toBe("custom");
    expect(dimensionLabel("constructor")).toBe("constructor");
  });
});
