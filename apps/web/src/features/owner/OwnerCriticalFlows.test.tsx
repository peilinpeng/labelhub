import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { mockDb } from "../../mocks/mock-db";
import { authenticateAs, renderRoute } from "../../test/render";
import { server } from "../../test/server";
import OwnerAIPage from "./OwnerAIPage";
import OwnerAnalyticsPage from "./OwnerAnalyticsPage";
import OwnerDatasetPage from "./OwnerDatasetPage";
import OwnerExportPage from "./OwnerExportPage";
import OwnerNewTaskPage from "./OwnerNewTaskPage";
import OwnerQualityCenterPage from "./OwnerQualityCenterPage";
import OwnerTaskDetailPage from "./OwnerTaskDetailPage";

const draftTask = mockDb.tasks.find((task) => task.id === "task_product_title")!;

describe("Owner 关键链路", () => {
  it("新建任务先校验，再提交去空白后的业务载荷", async () => {
    const user = userEvent.setup();
    let requestBody: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/v1/tasks", async ({ request }) => {
        requestBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...draftTask, id: "task_created", title: "质量任务" }, { status: 201 });
      }),
    );

    authenticateAs("OWNER");
    renderRoute(<OwnerNewTaskPage role="OWNER" />, { initialPath: "/owner/tasks/new" });

    await user.click(screen.getByRole("button", { name: "创建任务并导入数据" }));
    expect(screen.getByText("请输入任务名称。")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/任务名称/), "  质量任务  ");
    await user.type(screen.getByLabelText("任务描述"), "  用于验证创建载荷  ");
    await user.type(screen.getByLabelText(/标注员说明/), "# 规则");
    await user.selectOptions(screen.getByLabelText(/分发策略/), "ASSIGNMENT");
    await user.click(screen.getByRole("button", { name: "创建任务并导入数据" }));
    expect(screen.getByText("指派模式下请至少填写一个用户 ID。")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/指派用户 ID/), " usr_a, usr_b ");
    await user.selectOptions(screen.getByLabelText(/审核策略/), "DOUBLE_REVIEW");
    await user.click(screen.getByRole("button", { name: "创建任务并导入数据" }));
    await user.click(screen.getByRole("button", { name: "创建草稿" }));

    await waitFor(() => expect(requestBody).toBeDefined());
    expect(requestBody).toMatchObject({
      title: "质量任务",
      description: "用于验证创建载荷",
      quota: { total: 100 },
      distributionStrategy: { type: "ASSIGNMENT", assigneeIds: ["usr_a", "usr_b"] },
      reviewPolicy: { type: "DOUBLE_REVIEW", requireFinalReview: true },
    });
  });

  it("数据导入会确认文件并刷新列表，失败时给出可见错误", async () => {
    const user = userEvent.setup();
    let importBody: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/v1/tasks/:taskId/dataset/import", async ({ request }) => {
        importBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          taskId: "task_news_quality",
          importedCount: 2,
          skippedCount: 1,
          failedCount: 0,
          previewItems: [],
        });
      }),
    );

    authenticateAs("OWNER");
    renderRoute(<OwnerDatasetPage role="OWNER" />, {
      initialPath: "/owner/tasks/task_news_quality/data",
      routePath: "/owner/tasks/:taskId/data",
    });
    expect(await screen.findByRole("heading", { name: "数据管理" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "数据字段预览" })).toBeInTheDocument();

    const file = new File(['{"id":1}'], "items.jsonl", { type: "application/x-ndjson" });
    await user.upload(screen.getByLabelText(/选择文件/), file);
    await user.type(screen.getByLabelText(/外部主键路径/), " meta.id ");
    await user.click(screen.getByRole("button", { name: "导入" }));

    expect(await screen.findByText("✅ 导入成功：新增 2，跳过 1")).toBeInTheDocument();
    expect(importBody).toMatchObject({ format: "JSONL", externalKeyPath: "meta.id" });

    server.use(
      http.get("*/api/v1/tasks/:taskId/items", () =>
        HttpResponse.json({ code: "TEMPORARY", message: "列表暂不可用", traceId: "trace-test" }, { status: 503 }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText(/列表暂不可用/)).toBeInTheDocument();
  });

  it("AI 配置切换自动流转并保存标准化权重", async () => {
    const user = userEvent.setup();
    let saved: Record<string, unknown> | undefined;
    server.use(
      http.put("*/api/v1/tasks/:taskId/review-config", async ({ request }) => {
        saved = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ reviewConfig: { id: "rc_test", taskId: "task_news_quality", ...saved } });
      }),
    );

    authenticateAs("OWNER");
    renderRoute(<OwnerAIPage role="OWNER" />, {
      initialPath: "/owner/tasks/task_news_quality/ai-precheck",
      routePath: "/owner/tasks/:taskId/ai-precheck",
    });
    expect(await screen.findByRole("heading", { name: "AI 预审配置" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("审核流转"), "AUTO_PASS_RETURN");
    fireEvent.change(screen.getByLabelText("事实完整性 权重"), { target: { value: "0.5" } });
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(saved).toBeDefined());
    const dimensions = saved?.dimensions as Array<{ weight: number }>;
    expect(dimensions.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 5);
    expect(saved).toMatchObject({ enabled: true, maxRetries: 3 });
    expect(await screen.findByText(/AI 预审配置已保存/)).toBeInTheDocument();
  });

  it("数据看板支持任务范围切换并诚实展示接口失败", async () => {
    const user = userEvent.setup();
    authenticateAs("OWNER");
    renderRoute(<OwnerAnalyticsPage role="OWNER" />, { initialPath: "/owner/analytics" });
    expect(await screen.findByRole("heading", { name: "AI 调用概览" })).toBeInTheDocument();
    expect(screen.getByText("72,750")).toBeInTheDocument();

    server.use(
      http.get("*/api/v1/analytics/dashboard", () =>
        HttpResponse.json({ code: "TEMPORARY", message: "统计服务暂不可用", traceId: "trace-test" }, { status: 503 }),
      ),
    );
    await user.selectOptions(screen.getByLabelText("统计范围"), "task_news_quality");
    expect(await screen.findByText(/统计服务暂不可用/)).toBeInTheDocument();
  });

  it("草稿任务基础信息校验后保存真实 PATCH 载荷", async () => {
    const user = userEvent.setup();
    let patchBody: Record<string, unknown> | undefined;
    server.use(
      http.patch("*/api/v1/tasks/:taskId", async ({ request }) => {
        patchBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...draftTask, ...patchBody, title: String(patchBody.title) });
      }),
    );
    authenticateAs("OWNER");
    renderRoute(<OwnerTaskDetailPage role="OWNER" />, {
      initialPath: "/owner/tasks/task_product_title?edit=basic",
      routePath: "/owner/tasks/:taskId",
    });

    const titleInput = await screen.findByLabelText(/任务名称/);
    await user.clear(titleInput);
    await user.click(screen.getByRole("button", { name: "保存基础信息" }));
    expect(screen.getByText("请输入任务名称。")).toBeInTheDocument();
    await user.type(titleInput, "新版商品标题任务");
    await user.selectOptions(screen.getByLabelText(/分发策略/), "QUOTA_CLAIM");
    const batchInput = screen.getByLabelText("每次领取数量");
    await user.clear(batchInput);
    await user.type(batchInput, "7");
    await user.click(screen.getByRole("button", { name: "保存基础信息" }));

    await waitFor(() => expect(patchBody).toBeDefined());
    expect(patchBody).toMatchObject({
      title: "新版商品标题任务",
      distributionStrategy: { type: "QUOTA_CLAIM", claimBatchSize: 7 },
    });
    expect(await screen.findByText("基础信息已保存，数据和模板草稿不受影响。")).toBeInTheDocument();
  });

  it("导出中心校验 schema、提交映射并下载已完成制品", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    let exportBody: Record<string, unknown> | undefined;
    server.use(
      http.get("*/api/v1/tasks/:taskId/exports", () => HttpResponse.json([{
        id: "exp_done",
        taskId: "task_news_quality",
        status: "SUCCEEDED",
        mapping: { format: "JSONL" },
        progress: { total: 4, done: 4 },
        createdAt: "2026-09-13T00:00:00.000Z",
        fileName: "accepted.jsonl",
      }])),
      http.post("*/api/v1/tasks/:taskId/exports", async ({ request }) => {
        exportBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          exportJob: {
            id: "exp_new",
            taskId: "task_news_quality",
            status: "PENDING",
            mapping: { ...(exportBody?.mapping as object), includedSchemaVersionIds: ["sv_news_quality_1"] },
            progress: { total: 4, done: 0 },
            createdAt: "2026-09-13T00:00:00.000Z",
          },
          auditLog: {},
        }, { status: 201 });
      }),
      http.get("*/api/v1/exports/exp_done/download/file", () =>
        new HttpResponse('{"ok":true}\n', {
          headers: { "Content-Type": "application/x-ndjson", "Content-Disposition": 'attachment; filename="server.jsonl"' },
        }),
      ),
    );

    authenticateAs("OWNER");
    renderRoute(<OwnerExportPage role="OWNER" />, {
      initialPath: "/owner/tasks/task_news_quality/export",
      routePath: "/owner/tasks/:taskId/export",
    });
    expect(await screen.findByRole("heading", { name: "导出中心" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /CSV/ }));
    await user.clear(screen.getByLabelText("数据 ID 导出列名"));
    await user.type(screen.getByLabelText("数据 ID 导出列名"), "record_id");
    await user.click(screen.getByRole("button", { name: "开始导出" }));
    await user.click(screen.getByRole("button", { name: "导出" }));

    await waitFor(() => expect(exportBody).toBeDefined());
    expect(exportBody).toMatchObject({
      mapping: {
        schemaVersionId: "sv_news_quality_1",
        format: "CSV",
        answerSource: "PATCHED_ANSWERS",
        allowPatchedAnswers: true,
      },
    });
    const downloadButtons = screen.getAllByRole("button", { name: "下载" });
    await user.click(downloadButtons.find((button) => !button.hasAttribute("disabled"))!);
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
  });

  it("质量中心可按风险线索切换审计视图", async () => {
    const user = userEvent.setup();
    authenticateAs("OWNER");
    renderRoute(<OwnerQualityCenterPage role="OWNER" />, { initialPath: "/owner/quality" });
    expect(await screen.findByRole("heading", { name: "质量中心" })).toBeInTheDocument();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    await user.click(screen.getByRole("tab", { name: /审计追溯/ }));
    expect(screen.getByText(/当前已加载/)).toBeInTheDocument();
  });
});
