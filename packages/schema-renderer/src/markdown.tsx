import { Fragment, type ReactNode } from "react";

/**
 * 轻量 Markdown 子集渲染器（零依赖，用 React 元素天然防 XSS）。
 *
 * 移植自 apps/web/src/ui/markdown.tsx 的 MarkdownPreview，额外支持行内**图片**
 * `![alt](url)` 与**链接** `[text](url)`，以渲染 ShowItem 的 content_markdown 图文正文
 * （图文题常内嵌图片/视频链接）。
 *
 * schema-renderer 是被 apps/web 消费的下游包，不能反向 import apps/web，故此处独立一份。
 * 支持子集：# 标题、有序/无序列表、段落、**加粗**、`代码`、![图片]()、[链接]()。
 */

// http(s)://、协议相对 //、根相对 /、相对路径 允许；javascript:/data: 等一律丢弃，防 XSS。
function sanitizeUrl(url: string): string | undefined {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/\//.test(u)) return u;
  if (/^\//.test(u)) return u;
  // 纯相对路径（不含协议冒号）
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return undefined;
}

// ---------------------------------------------------------------------------
// 行内解析：![图片]() / [链接]() / **加粗** / `代码`
// ---------------------------------------------------------------------------

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const regex =
    /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      // 图片
      const src = sanitizeUrl(m[2]);
      out.push(
        src !== undefined ? (
          <img key={`${keyPrefix}-img${i}`} src={src} alt={m[1] ?? ""} loading="lazy" />
        ) : (
          <span key={`${keyPrefix}-img${i}`}>{m[1]}</span>
        ),
      );
    } else if (m[4] !== undefined) {
      // 链接
      const href = sanitizeUrl(m[4]);
      out.push(
        href !== undefined ? (
          <a key={`${keyPrefix}-a${i}`} href={href} target="_blank" rel="noopener noreferrer">
            {m[3]}
          </a>
        ) : (
          <span key={`${keyPrefix}-a${i}`}>{m[3]}</span>
        ),
      );
    } else if (m[5] !== undefined) {
      out.push(<strong key={`${keyPrefix}-b${i}`}>{m[5]}</strong>);
    } else if (m[6] !== undefined) {
      out.push(<code key={`${keyPrefix}-c${i}`}>{m[6]}</code>);
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
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // 标题 #/##/###
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = (h[1] ?? "").length; // 1->h4, 2->h5, 3->h6（适配面板尺寸）
      const Tag = (level === 1 ? "h4" : level === 2 ? "h5" : "h6") as "h4" | "h5" | "h6";
      blocks.push(<Tag key={`h${key++}`}>{renderInline(h[2] ?? "", `h${key}`)}</Tag>);
      i += 1;
      continue;
    }

    // 无序列表
    if (isUl(line)) {
      const items: ReactNode[] = [];
      for (let cur = lines[i]; cur !== undefined && isUl(cur); cur = lines[i]) {
        const content = cur.replace(/^\s*[-*]\s+/, "");
        items.push(
          <li key={`uli${key}-${items.length}`}>
            {renderInline(content, `uli${key}-${items.length}`)}
          </li>,
        );
        i += 1;
      }
      blocks.push(<ul key={`ul${key++}`}>{items}</ul>);
      continue;
    }

    // 有序列表
    if (isOl(line)) {
      const items: ReactNode[] = [];
      for (let cur = lines[i]; cur !== undefined && isOl(cur); cur = lines[i]) {
        const content = cur.replace(/^\s*\d+\.\s+/, "");
        items.push(
          <li key={`oli${key}-${items.length}`}>
            {renderInline(content, `oli${key}-${items.length}`)}
          </li>,
        );
        i += 1;
      }
      blocks.push(<ol key={`ol${key++}`}>{items}</ol>);
      continue;
    }

    // 段落：聚合连续非空、非标题、非列表行，行间用 <br/>
    const para: string[] = [];
    for (let cur = lines[i]; cur !== undefined; cur = lines[i]) {
      if (
        cur.trim() === "" ||
        /^(#{1,3})\s+/.test(cur) ||
        isUl(cur) ||
        isOl(cur)
      ) {
        break;
      }
      para.push(cur);
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

export function MarkdownPreview({ source, className = "" }: { source: string; className?: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      {blocks.length > 0 ? blocks : <p className="markdown-empty">（无内容）</p>}
    </div>
  );
}
