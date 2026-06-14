import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import ReviewDetailPage from "./ReviewDetailPage";
import { listReviewQueue } from "../../mocks/mock-db";
import { authenticateAs, renderRoute } from "../../test/render";

// Layer B —— 审核详情页回归（重点）。
// 背景：该页历史上在真实后端整页白屏（契约缺口 commit ef81987），mock 形状正确而
// 后端返回扁平字段，且 e2e 只打 API 没点 UI，漏到真机。这组测试锁死「详情页能按
// ReviewDetailResponse 的嵌套契约（item/task/schema/aiResult）完整渲染」，
// 任何破坏契约读取的改动都会让它变红。
//
// 注：MSW handler 复用 mock-db 的 getReviewDetail，返回的正是契约形状；本层守的是
// 「前端按契约渲染」这一面。后端是否真按契约返回，由 Phase 2 的真后端 e2e 兜底。
describe("ReviewDetailPage 审核详情页", () => {
  // 从同一套 mock 队列取一个真实 submissionId，避免硬编码易碎的 id。
  const submissionId = listReviewQueue()[0]?.id;

  function renderDetail(id: string) {
    authenticateAs("REVIEWER");
    return renderRoute(<ReviewDetailPage role="REVIEWER" />, {
      initialPath: `/reviewer/items/${id}`,
      routePath: "/reviewer/items/:submissionId",
    });
  }

  it("有可审核的队列样例数据", () => {
    expect(submissionId, "mock 队列应至少有一条待审核提交").toBeTruthy();
  });

  it("详情页非白屏：五大区块齐全", async () => {
    renderDetail(submissionId!);

    // 历史白屏的判据：detail.item.sourcePayload 读取未护导致整页崩。
    // 这里断言契约驱动的各区块标题都渲染出来。
    expect(await screen.findByRole("heading", { name: "原始数据" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "本轮提交" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /AI 评语与预审结果/ })).toBeInTheDocument();
    // 审计时间线是展开抽屉的切换按钮（默认收起）。
    expect(screen.getByRole("button", { name: "审计时间线" })).toBeInTheDocument();
  });

  it("详情页展示审核决策控件（通过 / 打回 / 修订提交）", async () => {
    renderDetail(submissionId!);

    await screen.findByRole("heading", { name: "原始数据" });
    // 审核结论是一组 role=tab（PASS/RETURN/REVISE）。
    expect(screen.getByRole("tab", { name: "通过" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "打回" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "修订提交" })).toBeInTheDocument();
  });
});
