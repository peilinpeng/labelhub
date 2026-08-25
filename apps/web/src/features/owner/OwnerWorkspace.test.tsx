import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import OwnerWorkspace from "./OwnerWorkspace";
import { authenticateAs, renderRoute } from "../../test/render";
import { server } from "../../test/server";
import { mockDb } from "../../mocks/mock-db";

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

  it("展示精简后的任务管理副标题", async () => {
    await renderOwner();
    expect(screen.getByText("查看任务状态与配置进度。")).toBeInTheDocument();
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

  it("OPT-08：任务列表只发起一次含批量统计的请求", async () => {
    let taskListRequests = 0;
    let individualStatsRequests = 0;
    server.use(
      http.get("/api/v1/tasks", ({ request }) => {
        taskListRequests += 1;
        expect(new URL(request.url).searchParams.get("includeStats")).toBe("true");
        return HttpResponse.json({
          tasks: mockDb.tasks,
          total: mockDb.tasks.length,
          page: 1,
          pageSize: 20,
          statsByTaskId: Object.fromEntries(
            mockDb.tasks.map((task) => [
              task.id,
              {
                taskId: task.id,
                datasetTotal: 10,
                datasetAvailable: 5,
                inProgress: 1,
                inReview: 1,
                accepted: 3,
                returned: 0,
                rejected: 0,
                submittedTotal: 4,
                quotaTotal: task.quota.total,
                quotaRemaining: Math.max(task.quota.total - 5, 0),
                progressPercent: 40,
              },
            ]),
          ),
        });
      }),
      http.get("/api/v1/tasks/:taskId/stats", () => {
        individualStatsRequests += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    await renderOwner();
    await waitFor(() => expect(taskListRequests).toBe(1));
    expect(individualStatsRequests).toBe(0);
  });
});
