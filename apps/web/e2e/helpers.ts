import { expect, type Page } from "@playwright/test";

export type Role = "OWNER" | "LABELER" | "REVIEWER";

const ROLE_EMAIL: Record<Role, string> = {
  OWNER: "owner@labelhub.com",
  LABELER: "labeler@labelhub.com",
  REVIEWER: "reviewer@labelhub.com",
};

const ROLE_HOME: Record<Role, RegExp> = {
  OWNER: /\/owner\/tasks/,
  LABELER: /\/labeler\/tasks/,
  REVIEWER: /\/reviewer\/items/,
};

/**
 * 用首页的「测试账号」快捷登录真实后端（.com 账号，password123）。
 * 点账号卡 → 弹出预填凭证的登录框 → 点登录 → 等跳转到角色工作台。
 */
export async function login(page: Page, role: Role): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(ROLE_EMAIL[role]) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(ROLE_HOME[role]);
}
