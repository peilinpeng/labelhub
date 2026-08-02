import { expect, type APIResponse, type Page } from "@playwright/test";

export type Role = "OWNER" | "LABELER" | "REVIEWER";

const ROLE_EMAIL: Record<Role, string> = {
  OWNER: "owner@labelhub.com",
  LABELER: "labeler@labelhub.com",
  REVIEWER: "reviewer@labelhub.com",
};

const PASSWORD = "password123";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

const ROLE_HOME: Record<Role, RegExp> = {
  OWNER: /\/owner\/tasks/,
  LABELER: /\/labeler\/tasks/,
  REVIEWER: /\/reviewer\/items/,
};

async function responseText(response: APIResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unable to read response body>";
  }
}

async function ensureBackendLoginReady(page: Page, role: Role): Promise<void> {
  const loginPayload = { email: ROLE_EMAIL[role], password: PASSWORD };
  const probe = await page.request.post("/api/v1/auth/login", {
    data: loginPayload,
    failOnStatusCode: false,
  });
  expect(
    probe.ok(),
    [
      `E2E 登录预检失败：${ROLE_EMAIL[role]} 返回 ${probe.status()}`,
      `响应：${await responseText(probe)}`,
      `请先执行：docker compose --profile tools run --rm seed`,
      `baseURL：${BASE_URL}`,
    ].join("\n"),
  ).toBe(true);
}

/**
 * 用首页的「测试账号」快捷登录真实后端（.com 账号，password123）。
 * 点账号卡 → 弹出预填凭证的登录框 → 点登录 → 等跳转到角色工作台。
 */
export async function login(page: Page, role: Role): Promise<void> {
  await ensureBackendLoginReady(page, role);
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(ROLE_EMAIL[role]) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const loginResponse = page.waitForResponse(
    (response) => response.url().includes("/api/v1/auth/login") && response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  const response = await loginResponse;
  expect(response.ok(), `登录接口返回 ${response.status()}`).toBe(true);
  await expect(page).toHaveURL(ROLE_HOME[role], { timeout: 15_000 });
}
