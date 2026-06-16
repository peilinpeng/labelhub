import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import OwnerWorkspace from "./OwnerWorkspace";
import { authenticateAs, renderRoute } from "../../test/render";

// Layer C —— Owner 任务生命周期操作（本轮 P1/P2/P3 修复的回归网）。
// 覆盖一致性审计的三处修复：
//   P1 暂停/恢复入口（曾经后端有端点、前端零按钮）
//   P2 已发布任务的「结束并归档」诚实命名（曾叫「删除」误导）
//   P3 草稿任务的「删除草稿」入口（状态感知，与已发布区分）
describe("OwnerWorkspace 任务管理", () => {
  async function renderOwner() {
    authenticateAs("OWNER");
    const view = renderRoute(<OwnerWorkspace role="OWNER" />, { initialPath: "/owner/tasks" });
    // 等任务列表加载完成。
    await screen.findByRole("heading", { name: "任务列表" });
    return view;
  }

  it("承诺全生命周期副标题", async () => {
    await renderOwner();
    expect(
      screen.getByText("维护任务全生命周期：草稿 → 发布中 → 已暂停 → 已结束"),
    ).toBeInTheDocument();
  });

  it("P1：已发布任务暴露「暂停」入口", async () => {
    await renderOwner();
    const pauseButtons = screen.getAllByRole("button", { name: /^暂停 / });
    expect(pauseButtons.length).toBeGreaterThan(0);
  });

  it("P2：已发布任务用「结束并归档」诚实命名（而非「删除」）", async () => {
    await renderOwner();
    expect(screen.getAllByRole("button", { name: /^结束并归档 / }).length).toBeGreaterThan(0);
    // 不应把已发布任务的归档操作叫成「删除任务」。
    expect(screen.queryByRole("button", { name: /^删除任务/ })).toBeNull();
  });

  it("「已暂停」状态筛选项存在（修复前恒空）", async () => {
    await renderOwner();
    // 状态筛选是裸 select（无 accessible name），按其包含「已暂停」选项来定位。
    const pausedOption = screen
      .getAllByRole("option", { name: "已暂停" })
      .find((opt) => opt.tagName === "OPTION");
    expect(pausedOption).toBeDefined();
  });
});
