import { Fragment, type ReactNode } from "react";
import type { RichTextDocument } from "@labelhub/contracts";
import { Textarea } from "./primitives";

/**
 * 轻量 Markdown 工具：任务「富文本说明」用。
 * 全应用无富文本基建，这里手写一个安全的 Markdown 子集渲染器（用 React 元素，天然防 XSS）。
 *
 * 存储采用契约兼容结构：RichTextDocument = { type:"doc", content:[{type:"markdown", text}] }，
 * 经后端 instructionRichText(dict) 原样往返。
 */

// ---------------------------------------------------------------------------
// doc <-> markdown 往返
// ---------------------------------------------------------------------------

export function markdownToDoc(md: string): RichTextDocument {
  const text = (md ?? "").trim();
  return { type: "doc", content: text ? [{ type: "markdown", text }] : [] };
}

export function docToMarkdown(doc: RichTextDocument | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  for (const node of doc.content) {
    if (node && typeof node === "object" && "text" in node) {
      const t = (node as { text?: unknown }).text;
      if (typeof t === "string") return t;
    }
  }
  return "";
}

export function isDocEmpty(doc: RichTextDocument | null | undefined): boolean {
  return docToMarkdown(doc).trim().length === 0;
}

// ---------------------------------------------------------------------------
// 行内解析：**加粗** 与 `代码`
// ---------------------------------------------------------------------------

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // 依次匹配 **bold** 或 `code`
  const regex = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      out.push(<strong key={`${keyPrefix}-b${i}`}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      out.push(<code key={`${keyPrefix}-c${i}`}>{m[3]}</code>);
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------------------------------------------------------------------------
// 块级解析：标题 / 有序无序列表 / 段落（行内换行）
// ---------------------------------------------------------------------------

function parseBlocks(md: string): ReactNode[] {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isUl = (l: string) => /^\s*[-*]\s+/.test(l);
  const isOl = (l: string) => /^\s*\d+\.\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i += 1; continue; }

    // 标题 #/##/###
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length; // 1->h4, 2->h5, 3->h6（适配面板尺寸）
      const Tag = (level === 1 ? "h4" : level === 2 ? "h5" : "h6") as "h4" | "h5" | "h6";
      blocks.push(<Tag key={`h${key++}`}>{renderInline(h[2], `h${key}`)}</Tag>);
      i += 1;
      continue;
    }

    // 无序列表
    if (isUl(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isUl(lines[i])) {
        const content = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(<li key={`uli${key}-${items.length}`}>{renderInline(content, `uli${key}-${items.length}`)}</li>);
        i += 1;
      }
      blocks.push(<ul key={`ul${key++}`}>{items}</ul>);
      continue;
    }

    // 有序列表
    if (isOl(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isOl(lines[i])) {
        const content = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(<li key={`oli${key}-${items.length}`}>{renderInline(content, `oli${key}-${items.length}`)}</li>);
        i += 1;
      }
      blocks.push(<ol key={`ol${key++}`}>{items}</ol>);
      continue;
    }

    // 段落：聚合连续非空、非标题、非列表行，行间用 <br/>
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !isUl(lines[i]) &&
      !isOl(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    const pk = key++;
    blocks.push(
      <p key={`p${pk}`}>
        {para.map((l, idx) => (
          <Fragment key={`p${pk}-${idx}`}>
            {idx > 0 ? <br /> : null}
            {renderInline(l, `p${pk}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function MarkdownPreview({ source, className = "" }: { source: string; className?: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      {blocks.length > 0 ? blocks : <p className="markdown-empty">（无内容）</p>}
    </div>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 8,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="markdown-editor">
      <div className="markdown-editor__pane">
        <span className="markdown-editor__label">编辑（支持 Markdown）</span>
        <Textarea
          value={value}
          rows={rows}
          placeholder={placeholder ?? "# 标注须知\n\n- 评级标准：高质量 / 中等 / 低质量\n- **注意**：标题党一律判低质量"}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <div className="markdown-editor__pane">
        <span className="markdown-editor__label">预览</span>
        <MarkdownPreview source={value} className="markdown-editor__preview" />
      </div>
    </div>
  );
}
