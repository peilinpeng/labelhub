import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { apiGet, ApiRequestError } from "./client";
import { importDataset, inferFormat, listItems, updateItem } from "./dataset";
import { createExportJob, downloadExportFile, listExportJobs } from "./owner";
import { authenticateAs } from "../test/render";
import { server } from "../test/server";

describe("关键 API 工作流", () => {
  it("识别数据文件格式并完成上传、确认、导入链路", async () => {
    authenticateAs("OWNER");
    expect(inferFormat("records.jsonl")).toBe("JSONL");
    expect(inferFormat("records.xlsx")).toBe("EXCEL");
    expect(inferFormat("records.json")).toBe("JSON");

    const stages: string[] = [];
    server.use(
      http.post("*/api/v1/files/upload-url", () => {
        stages.push("create");
        return HttpResponse.json({
          file: { id: "file_opt11" },
          uploadUrl: "/mock-upload/file_opt11",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }, { status: 201 });
      }),
      http.post("*/api/v1/files/file_opt11/upload", () => {
        stages.push("upload");
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/api/v1/files/file_opt11/confirm", () => {
        stages.push("confirm");
        return HttpResponse.json({ file: { id: "file_opt11", status: "READY" } });
      }),
      http.post("*/api/v1/tasks/task_news_quality/dataset/import", async ({ request }) => {
        stages.push("import");
        expect(await request.json()).toMatchObject({ fileId: "file_opt11", format: "JSONL" });
        return HttpResponse.json({
          taskId: "task_news_quality",
          importedCount: 2,
          skippedCount: 0,
          failedCount: 0,
          previewItems: [],
        });
      }),
    );
    const result = await importDataset(
      "task_news_quality",
      new File(['{"prompt":"hello"}'], "records.jsonl", { type: "application/x-ndjson" }),
      "JSONL",
    );
    expect(stages).toEqual(["create", "upload", "confirm", "import"]);
    expect(result.importedCount).toBe(2);
  });

  it("分页读取数据并批量更新状态", async () => {
    authenticateAs("OWNER");
    const listed = await listItems("task_news_quality", 1, 2);
    expect(listed.items).toHaveLength(2);
    expect(listed.total).toBeGreaterThanOrEqual(2);

    const patched: string[] = [];
    server.use(
      http.patch("*/api/v1/items/:itemId", async ({ params, request }) => {
        patched.push(String(params.itemId));
        const body = await request.json() as { status: string };
        return HttpResponse.json({ id: params.itemId, status: body.status });
      }),
    );
    await Promise.all(listed.items.map((item) => updateItem(item.id, { status: "DISABLED" })));
    expect(patched).toEqual(listed.items.map((item) => item.id));
  });

  it("创建导出任务、读取历史并下载带文件名的制品", async () => {
    authenticateAs("OWNER");
    const job = {
      id: "job_opt11",
      taskId: "task_news_quality",
      status: "SUCCEEDED",
      format: "JSONL",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    server.use(
      http.post("*/api/v1/tasks/task_news_quality/exports", () =>
        HttpResponse.json({ exportJob: job, auditLog: {} }, { status: 201 })),
      http.get("*/api/v1/tasks/task_news_quality/exports", () => HttpResponse.json([job])),
      http.get("*/api/v1/exports/job_opt11/download/file", () =>
        new HttpResponse('{"ok":true}\n', {
          headers: {
            "content-type": "application/x-ndjson",
            "content-disposition": "attachment; filename*=UTF-8''LabelHub%20Export.jsonl",
          },
        })),
    );
    const created = await createExportJob("task_news_quality", {
      mapping: {
        schemaVersionId: "sv_news_quality_1",
        format: "JSONL",
        answerSource: "PATCHED_ANSWERS",
        allowPatchedAnswers: true,
        includeReviewRecords: true,
        columns: [{ header: "备注", sourcePath: "$.answers.note" }],
        filters: { acceptedOnly: true },
      },
    });
    expect(created.exportJob.id).toBe("job_opt11");
    expect(await listExportJobs("task_news_quality")).toHaveLength(1);
    const downloaded = await downloadExportFile("job_opt11");
    expect(downloaded.filename).toBe("LabelHub Export.jsonl");
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("读取导出制品失败"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(downloaded.blob);
    });
    expect(content).toContain('"ok":true');
  });

  it("会话过期不误清登录态，瞬时错误可由调用方重试恢复", async () => {
    authenticateAs("OWNER");
    server.use(
      http.get("*/api/v1/session-check", () =>
        HttpResponse.json({ code: "UNAUTHORIZED", message: "会话已过期" }, { status: 401 })),
    );
    await expect(apiGet("/api/v1/session-check")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    } satisfies Partial<ApiRequestError>);
    expect(localStorage.getItem("labelhub_token")).toBe("test-token");

    let attempts = 0;
    server.use(
      http.get("*/api/v1/retryable", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ code: "INTERNAL_ERROR", message: "暂时不可用" }, { status: 500 })
          : HttpResponse.json({ recovered: true });
      }),
    );
    await expect(apiGet("/api/v1/retryable")).rejects.toBeInstanceOf(ApiRequestError);
    await expect(apiGet<{ recovered: boolean }>("/api/v1/retryable")).resolves.toEqual({ recovered: true });
  });
});
