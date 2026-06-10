import { useRef, useState, type ChangeEvent } from "react";
import { MarkdownPreview } from "../markdown";

export interface RichTextInputProps {
  value: unknown;
  placeholder?: string | undefined;
  readonly: boolean;
  disabled: boolean;
  minRows?: number | undefined;
  maxRows?: number | undefined;
  onChange(value: string): void;
}

/**
 * 轻量富文本编辑器（零依赖）。
 *
 * 不引入 TipTap/Quill 等重型 WYSIWYG（仓库一贯零依赖、防 XSS、控制包体）。
 * 实现为「Markdown 编辑器」：工具栏插入语法 + 文本域编辑 + 实时预览（复用 MarkdownPreview）。
 * 字段值即 Markdown 文本，与展示侧 show.richtext 渲染一致，存储/对比无额外格式。
 */
export function RichTextInput({
  value,
  placeholder,
  readonly,
  disabled,
  minRows,
  maxRows,
  onChange,
}: RichTextInputProps) {
  const text = typeof value === "string" ? value : "";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const isReadonly = readonly || disabled;

  // 只读态：直接渲染富文本，不展示编辑器
  if (isReadonly) {
    return (
      <div className="lh-richtext lh-richtext-readonly" data-richtext-readonly="true">
        <MarkdownPreview source={text} />
      </div>
    );
  }

  // 在当前选区应用一个 Markdown 变换，应用后保持焦点与选区
  function applyEdit(transform: (sel: Selection) => { next: string; cursor: number }) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const { next, cursor } = transform({
      before: text.slice(0, start),
      selected: text.slice(start, end),
      after: text.slice(end),
    });
    onChange(next);
    requestAnimationFrame(() => {
      if (el === null) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  // 行内环绕（加粗）：选中→**选中**，未选中→插入占位
  function wrapInline(marker: string, placeholderText: string) {
    applyEdit(({ before, selected, after }) => {
      const inner = selected || placeholderText;
      const next = `${before}${marker}${inner}${marker}${after}`;
      return { next, cursor: before.length + marker.length + inner.length + marker.length };
    });
  }

  // 行首前缀（标题 / 列表）：作用在选区所在行的行首
  function prefixLine(prefix: string) {
    applyEdit(({ before, selected, after }) => {
      const lineStart = before.lastIndexOf("\n") + 1;
      const head = before.slice(0, lineStart);
      const lineRest = before.slice(lineStart);
      const next = `${head}${prefix}${lineRest}${selected}${after}`;
      return { next, cursor: before.length + prefix.length + selected.length };
    });
  }

  function insertLink() {
    applyEdit(({ before, selected, after }) => {
      const label = selected || "链接文字";
      const snippet = `[${label}](https://)`;
      const next = `${before}${snippet}${after}`;
      // 光标落在 url 占位处，方便接着输入
      return { next, cursor: before.length + label.length + 4 };
    });
  }

  return (
    <div className="lh-richtext" data-richtext="true">
      <div className="lh-richtext-toolbar" role="toolbar" aria-label="富文本工具栏">
        <button type="button" aria-label="加粗" title="加粗" onClick={() => wrapInline("**", "加粗文字")}>
          <strong>B</strong>
        </button>
        <button type="button" aria-label="标题" title="标题" onClick={() => prefixLine("## ")}>
          H
        </button>
        <button type="button" aria-label="无序列表" title="无序列表" onClick={() => prefixLine("- ")}>
          ••
        </button>
        <button type="button" aria-label="行内代码" title="行内代码" onClick={() => wrapInline("`", "code")}>
          {"</>"}
        </button>
        <button type="button" aria-label="链接" title="链接" onClick={insertLink}>
          🔗
        </button>
        <button
          type="button"
          aria-pressed={showPreview}
          className="lh-richtext-preview-toggle"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? "编辑" : "预览"}
        </button>
      </div>

      {showPreview ? (
        <div className="lh-richtext-preview" data-richtext-preview="true">
          <MarkdownPreview source={text} />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          aria-label="富文本输入（Markdown）"
          placeholder={placeholder ?? "支持 Markdown：**加粗**、## 标题、- 列表、[链接]()"}
          rows={minRows ?? maxRows ?? 4}
          value={text}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

interface Selection {
  before: string;
  selected: string;
  after: string;
}
