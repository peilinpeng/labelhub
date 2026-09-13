import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { authenticateAs, renderRoute } from "../../test/render";
import { server } from "../../test/server";
import ReviewerWorkspace from "./ReviewerWorkspace";

const queueItem = {
  submission: {
    id: "sub_batch",
    assignmentId: "asn_batch",
    taskId: "task_news_quality",
    itemId: "item_batch",
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    attemptNo: 1,
    status: "NEEDS_HUMAN_REVIEW",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
  },
  taskId: "task_news_quality",
  taskTitle: "新闻质量标注",
  itemId: "item_batch",
  aiDecision: "RETURN",
  humanDecided: false,
  flowMode: "AI_THEN_HUMAN",
};

describe("Reviewer 队列与批量决策", () => {
  it("筛选请求携带状态，批量打回先认领并提交真实原因", async () => {
    const user = userEvent.setup();
    const statuses: Array<string | null> = [];
    let batchBody: Record<string, unknown> | undefined;
    let claims = 0;
    server.use(
      http.get("*/api/v1/review/queue", ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get("status"));
        return HttpResponse.json([queueItem]);
      }),
      http.get("*/api/v1/review/submissions/:submissionId", () => HttpResponse.json({
        aiResult: { decision: "RETURN", aiResult: { dimensionScores: [{ key: "accuracy", score: 42, reason: "证据不足" }] } },
      })),
      http.post("*/api/v1/review/submissions/:submissionId/claim", () => {
        claims += 1;
        return HttpResponse.json({ ...queueItem.submission, status: "HUMAN_REVIEWING" });
      }),
      http.post("*/api/v1/review/batch-decision", async ({ request }) => {
        batchBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ results: [{ submissionId: "sub_batch", success: true }] });
      }),
    );

    authenticateAs("REVIEWER");
    const view = renderRoute(<ReviewerWorkspace role="REVIEWER" />, { initialPath: "/reviewer/items" });
    expect(await screen.findByRole("heading", { name: "AI 自动预审队列" })).toBeInTheDocument();
    expect(await screen.findByText("证据不足")).toBeInTheDocument();

    const checkbox = view.container.querySelector<HTMLInputElement>(".review-ai-row__check input");
    expect(checkbox).not.toBeNull();
    await user.click(checkbox!);
    expect(screen.getByRole("button", { name: "批量打回" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/请说明打回原因/), "事实来源无法核验");
    await user.click(screen.getByRole("button", { name: "批量打回" }));

    await waitFor(() => expect(batchBody).toBeDefined());
    expect(claims).toBe(1);
    expect(batchBody).toEqual({
      items: [{
        submissionId: "sub_batch",
        stage: "HUMAN_REVIEW",
        decision: "RETURN",
        reason: "事实来源无法核验",
        comments: [{ message: "事实来源无法核验" }],
      }],
    });
    expect(await screen.findByText("批量打回：成功 1 / 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /已通过/ }));
    await waitFor(() => expect(statuses).toContain("ACCEPTED"));
  });

  it("队列接口失败时不渲染占位审核数据", async () => {
    server.use(
      http.get("*/api/v1/review/queue", () =>
        HttpResponse.json({ code: "TEMPORARY", message: "队列暂不可用", traceId: "trace-test" }, { status: 503 }),
      ),
    );
    authenticateAs("REVIEWER");
    renderRoute(<ReviewerWorkspace role="REVIEWER" />, { initialPath: "/reviewer/items" });
    expect(await screen.findByText(/未加载任何占位队列/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "进入人工审核" })).toBeNull();
  });
});
