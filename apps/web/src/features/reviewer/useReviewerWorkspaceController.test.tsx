import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import type { ReviewQueueItem } from "../../api/reviewer";
import { authenticateAs } from "../../test/render";
import { server } from "../../test/server";
import { useReviewerWorkspaceController } from "./useReviewerWorkspaceController";

function queueItem(id: string): ReviewQueueItem {
  return {
    submission: {
      id, assignmentId: "assignment", taskId: "task", itemId: id,
      labelerId: "labeler", schemaVersionId: "schema", attemptNo: 1,
      status: "NEEDS_HUMAN_REVIEW", createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z",
    },
    taskId: "task", taskTitle: "请求生命周期回归", itemId: id, aiDecision: null,
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function detail(reason: string) {
  return HttpResponse.json({
    aiResult: { decision: "PASS", aiResult: { dimensionScores: [{ key: "accuracy", score: 90, reason }] } },
  });
}

describe("审核工作台请求生命周期", () => {
  it("卸载时取消未完成的队列与三项统计，不记录取消错误", async () => {
    const pending = gate();
    const signals: AbortSignal[] = [];
    const warn = vi.spyOn(console, "warn");
    server.use(http.get("*/api/v1/review/queue", async ({ request }) => {
      signals.push(request.signal);
      await pending.promise;
      return HttpResponse.json([queueItem("first")]);
    }));
    authenticateAs("REVIEWER");
    const view = renderHook(useReviewerWorkspaceController);
    try {
      await waitFor(() => expect(signals).toHaveLength(4));
      view.unmount();
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      await act(async () => { pending.release(); await pending.promise; });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      await act(async () => { pending.release(); await pending.promise; });
      warn.mockRestore();
    }
  });

  it("队列已显示但评分与统计仍延迟时，卸载取消全部后续请求", async () => {
    const pending = gate();
    const signals: AbortSignal[] = [];
    const warn = vi.spyOn(console, "warn");
    server.use(
      http.get("*/api/v1/review/queue", async ({ request }) => {
        if (new URL(request.url).searchParams.has("pageSize")) {
          signals.push(request.signal);
          await pending.promise;
        }
        return HttpResponse.json([queueItem("first")]);
      }),
      http.get("*/api/v1/review/submissions/:id", async ({ request }) => {
        signals.push(request.signal);
        await pending.promise;
        return detail("延迟评分");
      }),
    );
    authenticateAs("REVIEWER");
    const view = renderHook(useReviewerWorkspaceController);
    try {
      await waitFor(() => expect(signals).toHaveLength(4));
      expect(view.result.current.loading).toBe(false);
      expect(view.result.current.selectedDimensionScoreState?.status).toBe("loading");
      view.unmount();
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      await act(async () => { pending.release(); await pending.promise; });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      await act(async () => { pending.release(); await pending.promise; });
      warn.mockRestore();
    }
  });

  it("StrictMode 下切换选中项取消旧请求，切回可重新加载且迟到响应不覆盖结果", async () => {
    const pending = gate();
    let firstSignal: AbortSignal | undefined;
    let firstRequests = 0;
    server.use(
      http.get("*/api/v1/review/queue", () => HttpResponse.json([queueItem("first"), queueItem("second")])),
      http.get("*/api/v1/review/submissions/:id", async ({ request, params }) => {
        if (params.id === "first" && ++firstRequests === 1) {
          firstSignal = request.signal;
          await pending.promise;
          return detail("迟到旧评分");
        }
        return detail(`${String(params.id)} 最新评分`);
      }),
    );
    authenticateAs("REVIEWER");
    const view = renderHook(useReviewerWorkspaceController, {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    try {
      await waitFor(() => expect(firstSignal).toBeDefined());
      act(() => view.result.current.setSelectedId("second"));
      expect(firstSignal?.aborted).toBe(true);
      await waitFor(() => expect(view.result.current.selectedDimensionScoreState?.scores[0]?.reason).toBe("second 最新评分"));
      act(() => view.result.current.setSelectedId("first"));
      await waitFor(() => expect(view.result.current.selectedDimensionScoreState?.scores[0]?.reason).toBe("first 最新评分"));
      expect(firstRequests).toBe(2);
      await act(async () => { pending.release(); await pending.promise; });
      expect(view.result.current.selectedDimensionScoreState?.scores[0]?.reason).toBe("first 最新评分");
    } finally {
      view.unmount();
      await act(async () => { pending.release(); await pending.promise; });
    }
  });

  it("未取消的评分接口失败仍进入错误态并保留诊断", async () => {
    const warn = vi.spyOn(console, "warn");
    server.use(
      http.get("*/api/v1/review/queue", () => HttpResponse.json([queueItem("first")])),
      http.get("*/api/v1/review/submissions/:id", () => HttpResponse.json({ message: "评分服务故障" }, { status: 503 })),
    );
    authenticateAs("REVIEWER");
    const view = renderHook(useReviewerWorkspaceController);
    try {
      await waitFor(() => expect(view.result.current.selectedDimensionScoreState?.status).toBe("error"));
      expect(warn).toHaveBeenCalledWith("AI 维度评分加载失败：", expect.objectContaining({ status: 503 }));
    } finally {
      view.unmount();
      warn.mockRestore();
    }
  });
});
