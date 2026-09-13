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

  test("领取 → 自动保存 → 提交 → 只读", async ({ page }) => {
    await login(page, "LABELER");

    const claimResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/tasks/") && response.url().endsWith("/claim") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "领取任务" }).first().click();
    expect((await claimResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/\/labeler\/workspace\/asn_/);

    await page.getByRole("radiogroup", { name: "质量评级" }).getByLabel("高质量").check();
    const autosaveResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/assignments/") && response.url().endsWith("/draft") && response.request().method() === "PUT",
      { timeout: 10_000 },
    );
    await page.getByLabel("多行文本输入").fill("E2E：来源完整，表述清晰。");
    const autosave = await autosaveResponse;
    expect(autosave.ok()).toBe(true);
    const autosavePayload = autosave.request().postDataJSON() as { answers: Record<string, unknown> };
    expect(autosavePayload.answers).toMatchObject({ quality: "high", comment: "E2E：来源完整，表述清晰。" });
    await expect(page.getByText(/草稿已自动保存/)).toBeVisible();

    const submitResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/assignments/") && response.url().endsWith("/submit") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "提交当前数据" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "提交标注" }).click();
    const submitted = await submitResponse;
    expect(submitted.ok()).toBe(true);
    expect(submitted.request().postDataJSON()).toMatchObject({
      answers: { quality: "high", comment: "E2E：来源完整，表述清晰。" },
    });
    await expect(page.getByText(/标注已提交，已进入审核流程/)).toBeVisible();
    await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "提交当前数据" })).toBeDisabled();
  });
});
