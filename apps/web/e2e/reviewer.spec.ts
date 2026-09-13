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

  test("领取待审提交 → 确认通过 → 状态进入已通过", async ({ page }) => {
    await login(page, "REVIEWER");
    await page.goto("/reviewer/items/sub_demo_review_01");
    await expect(page.getByRole("heading", { name: "原始数据" })).toBeVisible();

    const decisionResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/review/submissions/sub_demo_review_01/decision") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /通过入库/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "通过" }).click();

    const response = await decisionResponse;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({
      submissionId: "sub_demo_review_01",
      stage: "HUMAN_REVIEW",
      decision: "PASS",
    });
    const body = await response.json() as { submission?: { status?: string } };
    expect(body.submission?.status).toBe("ACCEPTED");
    await expect(page.getByText("审核通过，结果已进入可导出数据。")).toBeVisible();
  });
});
