import { defineConfig, devices } from "@playwright/test";

// Phase 2 —— 真后端 e2e。
// 与 Vitest 组件测试互补：组件测试用 MSW（守前端按契约渲染），e2e 打真实后端
// （守 mock 与真后端的契约不漂移——审核详情页白屏正是这一类，组件测试看不到）。
//
// baseURL 默认指向本地 Docker 栈的 web 容器（:5173，vite dev proxy 到 api:3000，
// 即「真后端」）；CI 用 docker compose 起全栈后同样跑在 5173。可经环境变量覆盖。
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // e2e 改真实数据，串行更可控（pause/resume、草稿建删需有序）
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
