import type { LabelHubRuntimeContext, ShowItemNode } from "@labelhub/contracts";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ShowItemRenderer } from "../renderers/ShowItemRenderer";
import type { RenderNodeContext } from "../types";

function makeContext(sourcePayload: Record<string, unknown>): LabelHubRuntimeContext {
  return {
    task: { id: "task_1", title: "T", status: "PUBLISHED", activeSchemaVersionId: "sv_1" },
    schema: { schemaId: "schema_1", schemaVersionId: "sv_1", schemaVersionNo: 1, contractVersion: "1.1" },
    item: { id: "item_1", sourcePayload },
    answers: {},
    system: {
      actor: { id: "usr_1", role: "LABELER", displayName: "L" },
      role: "LABELER",
      now: "2026-06-07T00:00:00.000Z",
    },
  };
}

function renderShow(node: ShowItemNode, sourcePayload: Record<string, unknown>) {
  const ctx = makeContext(sourcePayload);
  const renderContext = { context: ctx } as unknown as RenderNodeContext;
  return render(<ShowItemRenderer node={node} renderContext={renderContext} />);
}

function showNode(partial: Partial<ShowItemNode> & Pick<ShowItemNode, "type" | "sourcePath">): ShowItemNode {
  return {
    id: "show_1",
    kind: "SHOW_ITEM",
    title: "媒体素材",
    ...partial,
  } as ShowItemNode;
}

describe("ShowItemRenderer 媒体渲染", () => {
  test("show.image 渲染 <img> 而非 URL 文本", () => {
    const { container } = renderShow(
      showNode({ type: "show.image", sourcePath: "$.item.sourcePayload.media_url" }),
      { media_url: "https://example.com/pic.png" },
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/pic.png");
  });

  test("show.file 视频地址渲染 <video>", () => {
    const { container } = renderShow(
      showNode({ type: "show.file", sourcePath: "$.item.sourcePayload.media_url" }),
      { media_url: "http://vjs.zencdn.net/v/oceans.mp4" },
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("http://vjs.zencdn.net/v/oceans.mp4");
  });

  test("show.file 非视频地址渲染下载链接", () => {
    const { container } = renderShow(
      showNode({ type: "show.file", sourcePath: "$.item.sourcePayload.media_url" }),
      { media_url: "https://example.com/report.pdf" },
    );
    expect(container.querySelector("video")).toBeNull();
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/report.pdf");
  });

  test("show.richtext 渲染 Markdown（标题 + 图片）", () => {
    const md = "# 标题\n\n正文 **加粗** 与图片 ![p](https://example.com/x.png)";
    const { container } = renderShow(
      showNode({ type: "show.richtext", sourcePath: "$.item.sourcePayload.content_markdown" }),
      { content_markdown: md },
    );
    expect(container.querySelector("h4")?.textContent).toContain("标题");
    expect(container.querySelector("strong")?.textContent).toBe("加粗");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/x.png");
  });

  test("空值且无 fallback → 整块不渲染（text 题的媒体字段）", () => {
    const { container } = renderShow(
      showNode({ type: "show.image", sourcePath: "$.item.sourcePayload.media_url" }),
      {}, // 无 media_url
    );
    expect(container.querySelector("section")).toBeNull();
  });

  test("show.text 空值带 TEXT fallback → 显示占位", () => {
    const { container } = renderShow(
      showNode({
        type: "show.text",
        sourcePath: "$.item.sourcePayload.prompt",
        transform: { type: "TEXT", fallback: "（无）" },
      }),
      {},
    );
    expect(container.textContent).toContain("（无）");
  });

  test("文本类字段绑定不存在（undefined）→ 友好提示而非白屏", () => {
    const { container } = renderShow(
      showNode({ type: "show.text", sourcePath: "$.item.sourcePayload.prompt" }),
      {}, // 无 prompt 字段
    );
    expect(container.textContent).toContain("字段 prompt 不存在");
    expect(container.querySelector("section")).not.toBeNull();
  });

  test("字段存在但为空字符串 → 不误报字段不存在", () => {
    const { container } = renderShow(
      showNode({ type: "show.text", sourcePath: "$.item.sourcePayload.prompt" }),
      { prompt: "" },
    );
    // 空值按原逻辑隐藏（无 fallback），不应出现"字段不存在"提示
    expect(container.textContent).not.toContain("不存在");
  });

  test("媒体类字段不存在 → 仍隐藏，不显示字段提示", () => {
    const { container } = renderShow(
      showNode({ type: "show.image", sourcePath: "$.item.sourcePayload.media_url" }),
      {},
    );
    expect(container.querySelector("section")).toBeNull();
    expect(container.textContent).not.toContain("不存在");
  });

  test("基础数组（expected_dimensions）用顿号连接展示", () => {
    const { container } = renderShow(
      showNode({ type: "show.text", sourcePath: "$.item.sourcePayload.expected_dimensions" }),
      { expected_dimensions: ["准确性", "完整性", "流畅度"] },
    );
    expect(container.textContent).toContain("准确性、完整性、流畅度");
  });

  test("空数组按空值处理 → 整块隐藏，不报字段不存在", () => {
    const { container } = renderShow(
      showNode({ type: "show.text", sourcePath: "$.item.sourcePayload.expected_dimensions" }),
      { expected_dimensions: [] },
    );
    expect(container.querySelector("section")).toBeNull();
    expect(container.textContent).not.toContain("不存在");
  });

  test("Markdown 中 javascript: 链接被丢弃（防 XSS）", () => {
    const { container } = renderShow(
      showNode({ type: "show.richtext", sourcePath: "$.item.sourcePayload.content_markdown" }),
      { content_markdown: "[click](javascript:alert(1))" },
    );
    // 危险链接不渲染成 <a>，降级为纯文本
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click");
  });
});
