import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// 真后端 Owner 生命周期。用例自清理 / 可逆，跑完不污染演示数据。
test.describe("Owner 真后端任务生命周期", () => {
  test("暂停 → 恢复闭环（可逆）", async ({ page }) => {
    await login(page, "OWNER");
    await expect(page.getByRole("heading", { name: "任务管理" })).toBeVisible();

    // 对第一个发布中任务暂停
    const pauseBtn = page.getByRole("button", { name: /^暂停 / }).first();
    await expect(pauseBtn).toBeVisible();
    const taskTitle = (await pauseBtn.getAttribute("aria-label"))!.replace(/^暂停 /, "");
    await pauseBtn.click();

    // 同一行出现「恢复」按钮 → 已进入 PAUSED
    const resumeBtn = page.getByRole("button", { name: `恢复 ${taskTitle}` });
    await expect(resumeBtn).toBeVisible();

    // 恢复，复原数据
    await resumeBtn.click();
    await expect(page.getByRole("button", { name: `暂停 ${taskTitle}` })).toBeVisible();
  });

  test("新建草稿 → 删除草稿（自清理）", async ({ page }) => {
    await login(page, "OWNER");

    const draftName = `__e2e_草稿_${Date.now()}`;

    // 新建任务 → 创建草稿
    await page.getByRole("link", { name: "新建任务" }).click();
    await page.getByPlaceholder("请输入任务名称").fill(draftName);
    await page.getByRole("button", { name: "创建任务并导入数据" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "创建草稿" }).click();

    // 回任务管理，确认草稿行带「删除草稿」入口（状态感知）
    await page.getByRole("link", { name: "任务管理" }).click();
    const deleteBtn = page.getByRole("button", { name: `删除草稿 ${draftName}` });
    await expect(deleteBtn).toBeVisible();

    // 删除并确认弹窗，断言行消失
    await deleteBtn.click();
    await page.getByRole("dialog").getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByRole("button", { name: `删除草稿 ${draftName}` })).toHaveCount(0);
  });
});
