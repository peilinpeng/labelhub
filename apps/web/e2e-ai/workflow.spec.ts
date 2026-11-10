import { expect, test } from "@playwright/test";
import type { ReviewDecisionResponse, SubmitAssignmentResponse } from "@labelhub/contracts";
import { dimensions, source, suggestion, Workflow } from "./helpers";

test.beforeEach(async ({ request }) => {
  await new Workflow(request).control({ reset: true, mode: "valid", holdReview: false });
});
test.afterEach(async ({ request }) => {
  await new Workflow(request).control({ holdReview: false });
});

test("辅助候选确认、过期与非法输出保护，真实预审快照和人工通过", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const flow = new Workflow(request);
  await flow.login();
  const { task, assignment, schemaVersionId } = await flow.createTask();
  const errors: string[] = [];
  const labeler = await flow.page(browser, "LABELER", errors);
  const reviewer = await flow.page(browser, "REVIEWER", errors);
  try {
    await labeler.goto(`/labeler/workspace/${assignment}`);
    const input = labeler.getByRole("textbox", { name: "文本输入", exact: true });
    await input.fill("人工草稿");
    await expect.poll(async () => (await flow.context(assignment)).draft?.answers).toEqual({ summary: "人工草稿" });
    await labeler.getByRole("button", { name: "检查质量", exact: true }).click();
    await expect(labeler.getByRole("button", { name: "一键采纳" })).toBeEnabled();
    await expect(input).toHaveValue("人工草稿");
    expect((await flow.context(assignment)).draft?.answers).toEqual({ summary: "人工草稿" });
    const assist = (await flow.control()).requests.find((r) => r.kind === "assist")!;
    expect(assist.envelope).toMatchObject({ objective: "SUGGEST_ANNOTATION", sourceMaterial: source, answers: { summary: "人工草稿" }, schema: { schemaVersionId } });
    await input.fill("人工修改后答案");
    await expect(labeler.getByRole("button", { name: "一键采纳" })).toBeDisabled();
    await expect(labeler.getByText("建议生成后相关字段已修改，请重新检查质量。")).toBeVisible();
    await flow.control({ mode: "assist-invalid" });
    const invalid = labeler.waitForResponse((r) => r.url().endsWith("/llm-assist"));
    await labeler.getByRole("button", { name: "检查质量", exact: true }).click();
    expect((await invalid).status()).toBe(502);
    await expect(input).toHaveValue("人工修改后答案");
    await expect.poll(async () => (await flow.context(assignment)).draft?.answers).toEqual({ summary: "人工修改后答案" });
    await flow.control({ mode: "valid" });
    await labeler.getByRole("button", { name: "检查质量", exact: true }).click();
    await expect(labeler.getByRole("button", { name: "一键采纳" })).toBeEnabled();
    await labeler.getByRole("button", { name: "一键采纳" }).click();
    await expect.poll(async () => (await flow.context(assignment)).draft?.answers).toEqual({ summary: suggestion });
    await labeler.reload();
    await expect(input).toHaveValue(suggestion);
    await flow.control({ reset: true, holdReview: true });
    const submitted = labeler.waitForResponse((r) => r.url().endsWith("/submit") && r.request().method() === "POST");
    await labeler.getByRole("button", { name: "提交当前数据" }).click();
    await labeler.getByRole("dialog").getByRole("button", { name: "提交标注" }).click();
    const sub = (await (await submitted).json() as SubmitAssignmentResponse).submission;
    await expect.poll(async () => (await flow.control()).requests.filter((r) => r.kind === "review").length).toBe(1);
    expect((await flow.detail(sub.id)).submission.status).toBe("AI_REVIEWING");
    const review = (await flow.control()).requests.find((r) => r.kind === "review")!;
    expect(review.envelope).toMatchObject({ objective: "VERIFY_ANNOTATION", context: { task: { id: task.id }, item: { sourcePayload: source }, submission: { answers: { summary: suggestion } }, dimensions } });
    await flow.call("OWNER", `/tasks/${task.id}/review-config`, { dimensions: [{ ...dimensions[0], label: "变更后的配置名称" }] }, "PUT");
    await flow.control({ holdReview: false });
    const detail = await flow.settled(sub.id, "NEEDS_HUMAN_REVIEW");
    expect(detail.aiResult?.aiResult.totalScore).toBe(95);
    expect(detail.reviewDimensions).toEqual([{ key: "correctness", label: "标注正确性" }]);
    await reviewer.goto("/reviewer/items");
    await reviewer.getByRole("button", { name: new RegExp(task.title) }).click();
    await expect(reviewer.getByText("标注正确性").first()).toBeVisible();
    await reviewer.goto(`/reviewer/items/${sub.id}`);
    await expect(reviewer.getByText("标注正确性").first()).toBeVisible();
    await expect(reviewer.getByRole("textbox", { name: "文本输入", exact: true })).toHaveCount(0);
    await expect(reviewer.getByText(suggestion, { exact: true }).first()).toBeVisible();
    await reviewer.getByRole("button", { name: /通过入库/ }).click();
    await expect(reviewer.getByRole("dialog")).toBeVisible();
    expect((await flow.detail(sub.id)).submission.status).toBe("NEEDS_HUMAN_REVIEW");
    const decision = reviewer.waitForResponse((r) => r.url().endsWith("/decision") && r.request().method() === "POST");
    await reviewer.getByRole("dialog").getByRole("button", { name: "通过", exact: true }).click();
    expect((await (await decision).json() as ReviewDecisionResponse).submission.status).toBe("ACCEPTED");
    const after = await flow.detail(sub.id);
    expect(after.submission.answers).toEqual({ summary: suggestion });
    expect(after.history.some((r) => r.stage === "HUMAN_REVIEW" && r.decision === "PASS")).toBeTruthy();
    expect(JSON.stringify(after.auditLogs)).not.toContain(suggestion);
    expect(errors).toEqual([]);
  } finally {
    if (!labeler.isClosed()) await labeler.context().close();
    if (!reviewer.isClosed()) await reviewer.context().close();
  }
});

test("人工退回必须确认，保留原答案及预审和审核历史", async ({ browser, request }) => {
  const flow = new Workflow(request);
  await flow.login();
  const { assignment } = await flow.createTask();
  const answer = "合成标注：季度销量为 120 台。";
  const { submission } = await flow.submit(assignment, answer);
  await flow.settled(submission.id, "NEEDS_HUMAN_REVIEW");
  const errors: string[] = [];
  const page = await flow.page(browser, "REVIEWER", errors);
  try {
    await page.goto(`/reviewer/items/${submission.id}`);
    await page.getByRole("tab", { name: "打回", exact: true }).click();
    await page.getByPlaceholder("请说明打回原因，便于标注员修正").fill("合成验收：请补充来源说明");
    await page.getByRole("button", { name: /打回修改/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await flow.detail(submission.id)).submission.status).toBe("NEEDS_HUMAN_REVIEW");
    await page.getByRole("dialog").getByRole("button", { name: "打回", exact: true }).click();
    const after = await flow.settled(submission.id, "RETURNED");
    expect(after.submission.answers).toEqual({ summary: answer });
    expect(after.aiResult?.aiResult.totalScore).toBe(95);
    expect(after.history.some((r) => r.stage === "HUMAN_REVIEW" && r.decision === "RETURN")).toBeTruthy();
    expect(JSON.stringify(after.auditLogs)).not.toContain(answer);
    expect(errors).toEqual([]);
  } finally { if (!page.isClosed()) await page.context().close(); }
});

for (const [mode, status] of [
  ["valid", "ACCEPTED"], ["review-return", "RETURNED"], ["review-invalid", "NEEDS_HUMAN_REVIEW"],
  ["review-low-confidence", "NEEDS_HUMAN_REVIEW"], ["review-contradiction", "NEEDS_HUMAN_REVIEW"],
] as const) {
  test(`真实 worker 自动路由：${mode} → ${status}`, async ({ request }) => {
    const flow = new Workflow(request);
    await flow.login();
    const { assignment } = await flow.createTask("AUTO_PASS_RETURN");
    await flow.control({ mode });
    const answer = "合成自动路由标注";
    const { submission } = await flow.submit(assignment, answer);
    const detail = await flow.settled(submission.id, status);
    expect(detail.submission.answers).toEqual({ summary: answer });
    const calls = (await flow.control()).requests;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((r) => r.kind === "review" && r.mode === mode)).toBeTruthy();
    if (mode === "review-invalid") expect(detail.aiResult ?? null).toBeNull();
    else expect(detail.aiResult).toBeTruthy();
    expect(JSON.stringify(detail.auditLogs)).not.toContain(answer);
  });
}
