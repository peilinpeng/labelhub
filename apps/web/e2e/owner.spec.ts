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
    await expect(page).toHaveURL(/\/owner\/tasks\/[^/]+\/data$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: draftName })).toBeVisible({ timeout: 15_000 });

    // 回任务管理，确认草稿行带「删除草稿」入口（状态感知）
    await page.getByRole("link", { name: "任务管理" }).click();
    await expect(page.getByRole("heading", { name: "任务管理" })).toBeVisible({ timeout: 15_000 });
    const taskRow = page.locator("tbody tr").filter({ hasText: draftName });
    await expect(taskRow).toBeVisible({ timeout: 15_000 });
    const deleteBtn = taskRow.getByRole("button", { name: `删除草稿 ${draftName}` });
    await expect(deleteBtn).toBeVisible();

    // 删除并确认弹窗，断言行消失
    await deleteBtn.click();
    await page.getByRole("dialog").getByRole("button", { name: "确认删除" }).click();
    await expect(taskRow).toHaveCount(0);
  });

  test("创建导出 → 等待完成 → 下载制品", async ({ page }) => {
    await login(page, "OWNER");
    const taskId = "task_demo_news_quality";
    await page.goto(`/owner/tasks/${taskId}/export`);
    await expect(page.getByRole("heading", { name: "导出中心" })).toBeVisible();

    const createResponse = page.waitForResponse(
      (response) => response.url().endsWith(`/api/v1/tasks/${taskId}/exports`) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "开始导出" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "导出" }).click();
    const created = await createResponse;
    expect(created.ok()).toBe(true);
    expect(created.request().postDataJSON()).toMatchObject({
      mapping: {
        schemaVersionId: "sv_demo_news_quality_v1",
        answerSource: "PATCHED_ANSWERS",
        allowPatchedAnswers: true,
        filters: { acceptedOnly: true },
      },
    });
    const createdBody = await created.json() as { exportJob: { id: string } };
    const exportId = createdBody.exportJob.id;

    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/tasks/${taskId}/exports`);
      if (!response.ok()) return "HTTP_ERROR";
      const body = await response.json() as Array<{ id: string; status: string }> | { items?: Array<{ id: string; status: string }> };
      const jobs = Array.isArray(body) ? body : body.items ?? [];
      return jobs.find((job) => job.id === exportId)?.status ?? "MISSING";
    }, { timeout: 30_000 }).toBe("SUCCEEDED");

    await page.reload();
    const completedJob = page.locator(".owner-export-job").filter({ hasText: "已完成" }).first();
    await expect(completedJob).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await completedJob.getByRole("button", { name: "下载", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().length).toBeGreaterThan(0);
  });
});
