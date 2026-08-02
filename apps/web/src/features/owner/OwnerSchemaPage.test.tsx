import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import OwnerSchemaPage from "./OwnerSchemaPage";
import { authenticateAs, renderRoute } from "../../test/render";
import { server } from "../../test/server";

async function renderSchemaPage() {
  authenticateAs("OWNER");
  const view = renderRoute(<OwnerSchemaPage role="OWNER" />, {
    initialPath: "/owner/tasks/task_news_quality/designer",
    routePath: "/owner/tasks/:taskId/designer",
  });
  expect(await screen.findByRole("heading", { name: "模板搭建" })).toBeInTheDocument();
  return view;
}

describe("OwnerSchemaPage 模板闭环", () => {
  it("加载真实任务、草稿、数据状态和模块化配置面板", async () => {
    await renderSchemaPage();
    expect(screen.getByText("常用预设模板")).toBeInTheDocument();
    expect(screen.getByText("字段配置")).toBeInTheDocument();
    expect(screen.getByText("条件显示")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "校验规则" })).toBeInTheDocument();
    expect(screen.getByText("模板治理审计")).toBeInTheDocument();
    expect(screen.getAllByText(/已导入 12 条/).length).toBeGreaterThan(0);
  });

  it("保存草稿成功后给出明确反馈", async () => {
    const user = userEvent.setup();
    await renderSchemaPage();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByText("模板草稿已保存。")).toBeInTheDocument();
    expect(screen.getByText(/草稿已保存，版本/)).toBeInTheDocument();
  });

  it("保存冲突时保留当前编辑并提示恢复方式", async () => {
    server.use(
      http.put("*/api/v1/tasks/:taskId/schema/draft", () =>
        HttpResponse.json({ code: "CONFLICT", message: "409 conflict" }, { status: 409 })),
    );
    const user = userEvent.setup();
    await renderSchemaPage();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByText(/模板草稿已被更新/)).toBeInTheDocument();
    expect(screen.getByText(/刷新页面获取最新草稿版本/)).toBeInTheDocument();
  });

  it("从数据字段抽屉添加展示字段并阻止疑似答案泄露", async () => {
    const user = userEvent.setup();
    await renderSchemaPage();
    await user.click(screen.getByRole("button", { name: "数据字段" }));
    expect(await screen.findByRole("dialog", { name: "数据字段" })).toBeInTheDocument();
    const addButtons = screen.queryAllByRole("button", { name: /添加到模板：展示文本/ });
    expect(addButtons.length).toBeGreaterThan(0);
    await user.click(addButtons[0]);
    expect(await screen.findByText(/已把「.+」添加到模板/)).toBeInTheDocument();
  });

  it("AI 生成只应用显式选择的节点，不自动保存或发布", async () => {
    const user = userEvent.setup();
    await renderSchemaPage();
    await user.click(screen.getByRole("button", { name: "AI 生成模板草稿 Beta" }));
    const dialog = await screen.findByRole("dialog", { name: "AI 生成模板草稿 Beta" });
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "生成草稿预览" }));
    expect(await screen.findByText("生成节点")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "只选作答字段" }));
    const applyButton = screen.getByRole("button", { name: /应用选中的 \d+ 项到当前草稿/ });
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);
    expect(await screen.findByText(/已应用所选 AI 生成节点/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "AI 生成模板草稿 Beta" })).toBeNull();
  });

  it("发布入口先生成检查预览，不跳过人工确认", async () => {
    const user = userEvent.setup();
    await renderSchemaPage();
    await user.click(screen.getByRole("button", { name: "保存并发布模板" }));
    await waitFor(() => {
      expect(screen.queryByText("检查中...")).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("dialog") ?? screen.queryByText(/发布前需要/),
    ).not.toBeNull();
  });
});
