import { defineConfig, devices } from "@playwright/test";

// 独立入口；不得回退到现有业务端口，隔离凭证由运行器创建并在 globalSetup 核实。
export default defineConfig({
  testDir: "./e2e-ai",
  globalSetup: "./e2e-ai/setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/controlled-ai",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/controlled-ai", open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: "off", // 不在制品保存认证请求；失败截图只含合成材料。
    screenshot: "only-on-failure",
  },
  projects: [{ name: "controlled-chromium", use: { ...devices["Desktop Chrome"] } }],
});
