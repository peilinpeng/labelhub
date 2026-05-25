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

    fireEvent.click(screen.getByRole("button", { name: "AI 辅助" }));

    await waitFor(() => expect(screen.getByText("AI 建议摘要")).toBeTruthy());
    expect(onAnswersChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认应用建议" }));

    expect(onAnswersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "AI 生成的摘要",
      }),
    );
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

interface RenderOptions {
  schema?: LabelHubSchema;
  mode?: "PREVIEW" | "LABELING" | "REVIEW_READONLY" | "REVIEW_DIFF";
  onAnswersChange?: (answers: Record<string, unknown>) => void;
  onLLMAssist?: Parameters<typeof SchemaRenderer>[0]["onLLMAssist"];
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

  return render(
    <SchemaRenderer
      answers={answers}
      context={{ ...baseContext, answers }}
      mode={options.mode ?? "LABELING"}
      schema={schema}
      onAnswersChange={options.onAnswersChange ?? (() => undefined)}
      {...llmProps}
    />,
  );
}

function cloneSchema(): LabelHubSchema {
  return JSON.parse(JSON.stringify(createNewsQualitySchema())) as LabelHubSchema;
}
