import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// 真后端 Labeler 任务市场。只读断言，不领取，避免改动演示数据。
// （领取 + 提交的完整链路已在手测中验证；此处守「市场首屏在真后端可渲染且有可领取项」。）
test.describe("Labeler 真后端任务市场", () => {
  test("任务市场渲染且有可领取任务", async ({ page }) => {
    await login(page, "LABELER");
    await expect(page.getByRole("heading", { name: "任务市场" })).toBeVisible();
    await expect(page.getByRole("button", { name: /领取任务/ }).first()).toBeVisible();
  });
});
