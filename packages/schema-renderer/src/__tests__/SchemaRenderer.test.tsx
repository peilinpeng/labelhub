import type { LabelHubRuntimeContext, LabelHubSchema, SchemaNode } from "@labelhub/contracts";
import { createNewsQualitySchema, findFieldByName } from "@labelhub/schema-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SchemaRenderer } from "../SchemaRenderer";

const baseContext: LabelHubRuntimeContext = {
  task: {
    id: "task_news_quality_core",
    title: "新闻质量标注",
    status: "PUBLISHED",
    activeSchemaVersionId: "sv_news_quality_core_1",
  },
  schema: {
    schemaId: "schema_news_quality_core",
    schemaVersionId: "sv_news_quality_core_1",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: {
    id: "item_news_1",
    sourcePayload: {
      title: "示例新闻标题",
      body: "示例新闻正文",
    },
  },
  answers: {
    qualityRating: "needs_revision",
    summary: "已有摘要内容",
  },
  system: {
    actor: {
      id: "usr_labeler",
      role: "LABELER",
      displayName: "标注员",
    },
    role: "LABELER",
    now: "2026-05-24T00:00:00.000Z",
  },
};

describe("SchemaRenderer", () => {
  test("可以渲染 show text、textarea、radio", () => {
    renderRenderer();

    expect(screen.getByText("示例新闻标题")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "质量判断" })).toBeTruthy();
    expect(screen.getAllByLabelText("多行文本输入").length).toBeGreaterThan(0);
  });

  test("LABELING 模式下字段修改会触发 onAnswersChange", () => {
    const onAnswersChange = vi.fn();
    renderRenderer({ onAnswersChange });

    const textarea = screen.getAllByLabelText("多行文本输入")[0] as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "新的摘要内容足够长" } });

    expect(onAnswersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "新的摘要内容足够长",
      }),
    );
  });

  test("REVIEW_READONLY 模式下字段不可编辑", () => {
    renderRenderer({ mode: "REVIEW_READONLY" });

    const textarea = screen.getAllByLabelText("多行文本输入")[0] as HTMLTextAreaElement;
    const radio = screen.getByLabelText("通过") as HTMLInputElement;

    expect(textarea.disabled).toBe(true);
    expect(radio.disabled).toBe(true);
  });

  test("hidden node 不渲染", () => {
    const schema = cloneSchema();
    schema.root.children.push({
      id: "hidden_note",
      kind: "FIELD",
      type: "input.text",
      name: "hiddenNote",
      title: "隐藏说明",
      hidden: true,
    });

    renderRenderer({ schema });

    expect(screen.queryByText("隐藏说明")).toBeNull();
  });

  test("disabled field 不可编辑", () => {
    const schema = cloneSchema();
    const summary = findFieldByName(schema, "summary");
    if (summary === undefined) {
      throw new Error("示例 schema 必须包含 summary 字段");
    }
    summary.disabled = true;

    renderRenderer({ schema });

    const textarea = screen.getAllByLabelText("多行文本输入")[0] as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  test("ShowItem 通过 JsonPath 显示 item.sourcePayload", () => {
    renderRenderer();

    expect(screen.getByText("示例新闻正文")).toBeTruthy();
  });

  test("LLMAssist 不会自动修改 answers", async () => {
    const onAnswersChange = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 建议摘要",
      suggestedPatch: {
        summary: "AI 生成的摘要",
      },
      callId: "llm_schema_renderer_test",
    });

    renderRenderer({ onAnswersChange, onLLMAssist });

    fireEvent.click(screen.getByRole("button", { name: "检查质量" }));

    await waitFor(() => expect(screen.getByText("AI 建议摘要")).toBeTruthy());
    expect(onAnswersChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "一键采纳" }));

    expect(onAnswersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "AI 生成的摘要",
      }),
    );
  });

  test("LLMAssist 展示 AI 输出时触发 SHOWN outcome", async () => {
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 建议摘要",
      callId: "llm_shown_test",
    });

    renderRenderer({ onAssistOutcome, onLLMAssist });

    fireEvent.click(screen.getByRole("button", { name: "检查质量" }));

    await waitFor(() =>
      expect(onAssistOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "SHOWN",
          callId: "llm_shown_test",
          nodeId: expect.any(String),
        }),
      ),
    );
  });

  test("LLMAssist 一键采纳后触发 ACCEPTED outcome", async () => {
    const onAnswersChange = vi.fn();
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 建议摘要",
      suggestedPatch: {
        summary: "AI 生成的摘要",
      },
      callId: "llm_accepted_test",
    });

    renderRenderer({ onAnswersChange, onAssistOutcome, onLLMAssist });

    fireEvent.click(screen.getByRole("button", { name: "检查质量" }));
    await waitFor(() => expect(screen.getByText("AI 建议摘要")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "一键采纳" }));

    const acceptedOutcome = onAssistOutcome.mock.calls
      .map((call) => call[0])
      .find((outcome) => outcome.action === "ACCEPTED");

    expect(onAnswersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "AI 生成的摘要",
      }),
    );
    expect(acceptedOutcome).toEqual({
      action: "ACCEPTED",
      appliedPatchFieldNames: ["summary"],
      callId: "llm_accepted_test",
      nodeId: expect.any(String),
    });
    expect(Object.keys(acceptedOutcome ?? {}).includes("suggestedPatch")).toBe(false);
  });

  test("LLMAssist 反馈问题是弱操作，不应用 patch", async () => {
    const onAnswersChange = vi.fn();
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 建议摘要",
      suggestedPatch: {
        summary: "AI 生成的摘要",
      },
      callId: "llm_dismissed_test",
    });

    renderRenderer({ onAnswersChange, onAssistOutcome, onLLMAssist });

    fireEvent.click(screen.getByRole("button", { name: "检查质量" }));
    await waitFor(() => expect(screen.getByText("AI 建议摘要")).toBeTruthy());
    const feedbackButton = screen.getByRole("button", { name: "反馈问题" }) as HTMLButtonElement;

    expect(feedbackButton.disabled).toBe(true);
    expect(screen.queryByText("AI 建议摘要")).toBeTruthy();
    expect(onAnswersChange).not.toHaveBeenCalled();
    expect(onAssistOutcome.mock.calls.some((call) => call[0].action === "DISMISSED")).toBe(false);
  });

  test("LLMAssist 同一 callId 不重复触发同一 outcome", async () => {
    const onAssistOutcome = vi.fn();
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 建议摘要",
      callId: "llm_duplicate_test",
    });

    renderRenderer({ onAssistOutcome, onLLMAssist });

    fireEvent.click(screen.getByRole("button", { name: "检查质量" }));
    await waitFor(() => expect(onLLMAssist).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "检查质量" }));
    await waitFor(() => expect(onLLMAssist).toHaveBeenCalledTimes(2));

    const shownOutcomes = onAssistOutcome.mock.calls
      .map((call) => call[0])
      .filter((outcome) => outcome.action === "SHOWN");

    expect(shownOutcomes).toHaveLength(1);
  });

  test("LLMAssist outcome callback 失败不影响 patch 应用", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onAnswersChange = vi.fn();
    const onAssistOutcome = vi.fn(() => {
      throw new Error("callback failed");
    });
    const onLLMAssist = vi.fn().mockResolvedValue({
      output: "AI 建议摘要",
      suggestedPatch: {
        summary: "AI 生成的摘要",
      },
      callId: "llm_callback_error_test",
    });

    renderRenderer({ onAnswersChange, onAssistOutcome, onLLMAssist });

    fireEvent.click(screen.getByRole("button", { name: "检查质量" }));
    await waitFor(() => expect(screen.getByText("AI 建议摘要")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "一键采纳" }));

    expect(onAnswersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "AI 生成的摘要",
      }),
    );
    warn.mockRestore();
  });

  test("unknown node type 会显示 fallback", () => {
    const schema = cloneSchema();
    schema.root.children.push({
      id: "unknown_node",
      kind: "FIELD",
      type: "unknown.node",
      name: "unknownNode",
      title: "未知节点",
    } as unknown as SchemaNode);

    renderRenderer({ schema });

    expect(screen.getByText("组件类型不被当前前端支持：unknown.node")).toBeTruthy();
  });
});

describe("container.tabs 渲染为可切换标签页", () => {
  test("渲染 tablist + 每个子节点一个 tab，初始仅首个 panel 可见", () => {
    renderRenderer({ schema: buildTabsSchema() });

    expect(screen.getByRole("tablist")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["基础信息", "补充信息"]);
    expect(screen.getByRole("tab", { name: "基础信息" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "补充信息" }).getAttribute("aria-selected")).toBe("false");
    // 隐藏的 panel 被移出无障碍树，仅激活 panel 可见。
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByLabelText("字段 A")).toBeTruthy();
  });

  test("点击 tab 切换激活 panel", () => {
    renderRenderer({ schema: buildTabsSchema() });

    fireEvent.click(screen.getByRole("tab", { name: "补充信息" }));

    expect(screen.getByRole("tab", { name: "基础信息" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "补充信息" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("字段 B")).toBeTruthy();
  });

  test("被隐藏的子节点不产生 tab", () => {
    const schema = buildTabsSchema();
    const tabsNode = schema.root.children[0] as { children: { hidden?: boolean }[] };
    const extraTab = tabsNode.children[1];
    if (extraTab === undefined) {
      throw new Error("tabs schema 必须包含两个子节点");
    }
    extraTab.hidden = true;

    renderRenderer({ schema });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["基础信息"]);
  });
});

interface RenderOptions {
  schema?: LabelHubSchema;
  mode?: "PREVIEW" | "LABELING" | "REVIEW_READONLY" | "REVIEW_DIFF";
  onAnswersChange?: (answers: Record<string, unknown>) => void;
  onLLMAssist?: Parameters<typeof SchemaRenderer>[0]["onLLMAssist"];
  onAssistOutcome?: Parameters<typeof SchemaRenderer>[0]["onAssistOutcome"];
}

function renderRenderer(options: RenderOptions = {}) {
  const schema = options.schema ?? cloneSchema();
  const answers = {
    qualityRating: "needs_revision",
    summary: "已有摘要内容",
  };
  const llmProps =
    options.onLLMAssist === undefined
      ? {}
      : {
          onLLMAssist: options.onLLMAssist,
        };
  const assistOutcomeProps =
    options.onAssistOutcome === undefined
      ? {}
      : {
          onAssistOutcome: options.onAssistOutcome,
        };

  return render(
    <SchemaRenderer
      answers={answers}
      context={{ ...baseContext, answers }}
      mode={options.mode ?? "LABELING"}
      schema={schema}
      onAnswersChange={options.onAnswersChange ?? (() => undefined)}
      {...assistOutcomeProps}
      {...llmProps}
    />,
  );
}

function cloneSchema(): LabelHubSchema {
  return JSON.parse(JSON.stringify(createNewsQualitySchema())) as LabelHubSchema;
}

function buildTabsSchema(): LabelHubSchema {
  const schema = cloneSchema();
  schema.root.children = [
    {
      id: "tabs_main",
      kind: "CONTAINER",
      type: "container.tabs",
      title: "分组标注",
      layout: { tabStyle: "LINE" },
      children: [
        {
          id: "tab_basic",
          kind: "CONTAINER",
          type: "container.group",
          title: "基础信息",
          children: [
            { id: "f_a", kind: "FIELD", type: "input.text", name: "fieldA", title: "字段 A" },
          ],
        },
        {
          id: "tab_extra",
          kind: "CONTAINER",
          type: "container.group",
          title: "补充信息",
          children: [
            { id: "f_b", kind: "FIELD", type: "input.text", name: "fieldB", title: "字段 B" },
          ],
        },
      ],
    },
  ] as unknown as SchemaNode[];
  return schema;
}
