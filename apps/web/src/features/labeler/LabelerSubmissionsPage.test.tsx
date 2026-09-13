import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { authenticateAs, renderRoute } from "../../test/render";
import { server } from "../../test/server";
import LabelerSubmissionsPage from "./LabelerSubmissionsPage";

describe("Labeler 我的提交", () => {
  it("按业务状态分类并让不可恢复记录保持只读", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/me/submissions", () => HttpResponse.json([
        submission("sub_review", "NEEDS_HUMAN_REVIEW", "2026-09-13T03:00:00.000Z"),
        submission("sub_accepted", "ACCEPTED", "2026-09-13T02:00:00.000Z"),
        submission("sub_returned", "RETURNED", "2026-09-13T01:00:00.000Z"),
        submission("sub_draft", "DRAFT", "2026-09-13T00:00:00.000Z"),
        submission("sub_expired", "EXPIRED", "2026-09-12T00:00:00.000Z"),
      ])),
    );

    authenticateAs("LABELER");
    renderRoute(<LabelerSubmissionsPage role="LABELER" />, { initialPath: "/labeler/submissions" });
    expect(await screen.findByRole("heading", { name: "我的提交" })).toBeInTheDocument();
    expect(screen.getByText("已通过", { selector: ".lh-kpi-card__label" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打回/待修改" }));
    expect(screen.getByRole("button", { name: "继续修改" })).toBeEnabled();
    expect(screen.queryByText("等待 AI 或人工审核结果")).toBeNull();

    await user.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByRole("button", { name: "暂不可修改" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "查看提交" }).length).toBeGreaterThan(0);
  });

  it("接口失败显示可重试语义，不伪装为空列表", async () => {
    server.use(
      http.get("*/api/v1/me/submissions", () =>
        HttpResponse.json({ code: "TEMPORARY", message: "暂不可用", traceId: "trace-test" }, { status: 503 }),
      ),
    );
    authenticateAs("LABELER");
    renderRoute(<LabelerSubmissionsPage role="LABELER" />, { initialPath: "/labeler/submissions" });
    expect(await screen.findByText("加载作答记录失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/还没有作答记录/)).toBeNull();
  });
});

function submission(id: string, status: string, updatedAt: string) {
  return {
    id,
    assignmentId: `asn_${id}`,
    taskId: "task_news_quality",
    itemId: `item_${id}`,
    labelerId: "usr_labeler",
    schemaVersionId: "sv_news_quality_1",
    attemptNo: 1,
    answers: {},
    status,
    validationSnapshot: { valid: true, errors: [], warnings: [] },
    createdAt: updatedAt,
    updatedAt,
  };
}
