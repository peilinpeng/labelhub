import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import OwnerWorkspace from "../features/owner/OwnerWorkspace";
import LabelerWorkspace from "../features/labeler/LabelerWorkspace";
import ReviewerWorkspace from "../features/reviewer/ReviewerWorkspace";
import { authenticateAs, renderRoute } from "./render";

// Layer A —— 三角色落地页冒烟：渲染不抛错 + 关键标题出现。
// 这是「防白屏」的最低防线：任一角色首屏崩溃，CI 立刻红。
describe("三角色落地页冒烟", () => {
  it("Owner 任务管理首屏渲染", async () => {
    authenticateAs("OWNER");
    renderRoute(<OwnerWorkspace role="OWNER" />, { initialPath: "/owner/tasks" });
    expect(await screen.findByRole("heading", { name: "任务管理" })).toBeInTheDocument();
  });

  it("Labeler 任务市场首屏渲染", async () => {
    authenticateAs("LABELER");
    renderRoute(<LabelerWorkspace role="LABELER" />, { initialPath: "/labeler/tasks" });
    expect(await screen.findByRole("heading", { name: "任务市场" })).toBeInTheDocument();
  });

  it("Reviewer 审核队列首屏渲染", async () => {
    authenticateAs("REVIEWER");
    renderRoute(<ReviewerWorkspace role="REVIEWER" />, { initialPath: "/reviewer/items" });
    expect(
      await screen.findByRole("heading", { name: "AI 自动预审队列" }),
    ).toBeInTheDocument();
  });
});
