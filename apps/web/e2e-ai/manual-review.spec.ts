import { expect, test } from "@playwright/test";
import type { SubmitAssignmentResponse } from "@labelhub/contracts";
import { Workflow } from "./helpers";

test("关闭 AI 后直接人工审核，退回修改重提并通过，零模型调用", async ({ browser, request }) => {
  const flow = new Workflow(request);
  await flow.control({ reset: true, mode: "valid", holdReview: false });
  await flow.login();
  const { assignment } = await flow.createTask("HUMAN_REVIEW_ONLY", false);
  const errors: string[] = [];
  const labeler = await flow.page(browser, "LABELER", errors);
  const reviewer = await flow.page(browser, "REVIEWER", errors);
  async function submit(answer: string) {
    await labeler.goto(`/labeler/workspace/${assignment}`);
    await labeler.getByRole("textbox", { name: "文本输入", exact: true }).fill(answer);
    const response = labeler.waitForResponse((r) => r.url().endsWith("/submit") && r.request().method() === "POST");
    await labeler.getByRole("button", { name: "提交当前数据" }).click();
    await labeler.getByRole("dialog").getByRole("button", { name: "提交标注" }).click();
    const body = await (await response).json() as SubmitAssignmentResponse;
    expect(body.submission.status).toBe("NEEDS_HUMAN_REVIEW");
    return body.submission;
  }
  try {
    const original = await submit("合成初稿：需补充数量");
    await reviewer.goto(`/reviewer/items/${original.id}`);
    await reviewer.getByRole("tab", { name: "打回", exact: true }).click();
    await reviewer.getByPlaceholder("请说明打回原因，便于标注员修正").fill("请补充季度销量 120 台的依据");
    await reviewer.getByRole("button", { name: /打回修改/ }).click();
    await expect(reviewer.getByRole("dialog")).toBeVisible();
    expect((await flow.detail(original.id)).submission.status).toBe("NEEDS_HUMAN_REVIEW");
    await reviewer.getByRole("dialog").getByRole("button", { name: "打回", exact: true }).click();
    await flow.settled(original.id, "RETURNED");
    const revised = await submit("合成修订：材料说明季度销量为 120 台");
    expect(revised.attemptNo).toBe(2);
    await reviewer.goto(`/reviewer/items/${revised.id}`);
    await reviewer.getByRole("button", { name: /通过入库/ }).click();
    await reviewer.getByRole("dialog").getByRole("button", { name: "通过", exact: true }).click();
    const accepted = await flow.settled(revised.id, "ACCEPTED");
    expect(accepted.aiResult ?? null).toBeNull();
    const old = await flow.detail(original.id);
    expect(old.submission.status).toBe("RETURNED");
    expect(old.submission.answers).toEqual({ summary: "合成初稿：需补充数量" });
    expect((await flow.control()).requests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    if (!labeler.isClosed()) await labeler.context().close();
    if (!reviewer.isClosed()) await reviewer.context().close();
  }
});
