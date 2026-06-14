import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// ⭐ 真后端回归：审核详情页历史上在真实后端整页白屏（契约缺口），而 mock + 纯 API e2e
// 都看不到。这条用例点真实「进入人工审核」，断言详情页在真后端下完整渲染、非白屏。
test.describe("Reviewer 真后端审核链路", () => {
  test("审核队列可进入人工审核且详情页非白屏", async ({ page }) => {
    await login(page, "REVIEWER");

    // 队列首屏
    await expect(page.getByRole("heading", { name: "AI 自动预审队列" })).toBeVisible();

    // 「进入人工审核」渲染为链接（<a>）。
    const enterBtn = page.getByRole("link", { name: "进入人工审核" }).first();
    await expect(enterBtn).toBeVisible();
    await enterBtn.click();

    // 详情页：契约驱动的核心区块都应渲染（非白屏判据）。
    await expect(page).toHaveURL(/\/reviewer\/items\/sub_/);
    await expect(page.getByRole("heading", { name: "原始数据" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "本轮提交" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /AI 评语与预审结果/ })).toBeVisible();
    // 决策控件存在
    await expect(page.getByRole("tab", { name: "通过" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "打回" })).toBeVisible();
  });
});
