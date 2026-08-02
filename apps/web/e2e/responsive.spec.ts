import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { Role } from "../src/app/routes";

async function authenticateInBrowser(page: Page, role: Role): Promise<void> {
  await page.goto("/");
  await page.evaluate((nextRole) => {
    localStorage.setItem("labelhub_token", "responsive-test-token");
    localStorage.setItem("labelhub_role", nextRole);
    localStorage.setItem("labelhub_actor", JSON.stringify({
      id: `usr_${nextRole.toLowerCase()}`,
      role: nextRole,
      displayName: nextRole,
    }));
  }, role);
  const landing = role === "OWNER" ? "/owner/tasks" : role === "LABELER" ? "/labeler/tasks" : "/reviewer/items";
  await page.goto(landing);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({
    viewport: await page.evaluate(() => window.innerWidth),
    document: await page.evaluate(() => window.innerWidth),
  }));
}

async function attachViewportScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test.describe("关键工作台响应式视觉回归", () => {
  test("桌面端 Owner 模板搭建无横向溢出", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await authenticateInBrowser(page, "OWNER");
    await page.goto("/owner/tasks/task_news_quality/designer");
    await expect(page.getByRole("heading", { name: "模板搭建" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, "owner-schema-desktop");
  });

  test("移动端三角色关键页面无横向溢出", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await authenticateInBrowser(page, "LABELER");
    await expect(page.getByRole("heading", { name: "任务市场" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, "labeler-market-mobile");

    await authenticateInBrowser(page, "REVIEWER");
    await expect(page.getByRole("heading", { name: "AI 自动预审队列" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, "reviewer-queue-mobile");

    await authenticateInBrowser(page, "OWNER");
    await page.goto("/owner/tasks/task_news_quality/designer");
    await expect(page.getByRole("heading", { name: "模板搭建" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, "owner-schema-mobile");
  });
});
