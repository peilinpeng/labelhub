import type { ReactNode } from "react";
import type { FileRef, ShowItemNode } from "@labelhub/contracts";
import { getByJsonPath } from "@labelhub/schema-core";
import type { RenderNodeContext } from "../types";
import { MarkdownPreview } from "../markdown";

export interface ShowItemRendererProps {
  node: ShowItemNode;
  renderContext: RenderNodeContext;
}

export function ShowItemRenderer({ node, renderContext }: ShowItemRendererProps) {
  // 解析绑定路径取值；路径异常时兜底为 undefined，绝不让作答页白屏。
  let value: unknown;
  try {
    value = getByJsonPath(renderContext.context, node.sourcePath);
  } catch {
    value = undefined;
  }

  // 字段真的不存在（undefined，区别于空字符串/空数组/null）且为文本类展示时，给出友好提示，
  // 帮助 Owner 发现模板绑定或数据集字段写错；媒体类（图片/视频/文件）仍按空值隐藏，不硬塞提示。
  // 若 Owner 已为 TEXT 显式配置 fallback，则尊重其占位，不覆盖为"字段不存在"。
  const hasExplicitTextFallback = node.transform?.type === "TEXT" && node.transform.fallback !== undefined;
  if (value === undefined && !isMediaShow(node) && !hasExplicitTextFallback) {
    return (
      <section data-node-id={node.id} data-show-type={node.type}>
        <h3>{node.title}</h3>
        {node.description !== undefined ? <p>{node.description}</p> : null}
        <div className="show-item__missing" role="status">
          字段 {jsonPathLeaf(node.sourcePath)} 不存在，请检查模板绑定或数据集字段。
        </div>
      </section>
    );
  }

  const body = renderShowItemBody(node, value);
  // 空值且无 fallback → 整块不展示（匹配 seed：text 题的媒体字段为空时自然不出现）。
  if (body === null) return null;

  return (
    <section data-node-id={node.id} data-show-type={node.type}>
      <h3>{node.title}</h3>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      <div>{body}</div>
    </section>
  );
}

// 媒体类展示：图片 / 文件 / 视频（按 node.type 或 transform 判定）。媒体空值应隐藏而非提示。
function isMediaShow(node: ShowItemNode): boolean {
  if (node.type === "show.image" || node.type === "show.file") return true;
  const t = node.transform?.type;
  return t === "IMAGE_PREVIEW" || t === "FILE_URLS";
}

// 取 JSONPath 末段作为字段名展示，如 $.item.sourcePayload.prompt → prompt。
function jsonPathLeaf(path: string): string {
  const segments = path.split(".").filter((s) => s !== "");
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

// ---------------------------------------------------------------------------
// 渲染分发：按 node.type（媒体语义）+ transform（格式转换）真渲染
// ---------------------------------------------------------------------------

function renderShowItemBody(node: ShowItemNode, value: unknown): ReactNode | null {
  const transform = node.transform;

  if (isEmptyValue(value)) {
    // 仅 TEXT transform 显式给了 fallback 才展示占位，否则整块隐藏
    if (transform?.type === "TEXT" && transform.fallback !== undefined) {
      return <span>{transform.fallback}</span>;
    }
    return null;
  }

  // 图片：show.image 或 IMAGE_PREVIEW transform
  if (node.type === "show.image" || transform?.type === "IMAGE_PREVIEW") {
    const media = toMediaItems(value);
    if (media.length === 0) return null;
    return (
      <div data-media="image">
        {media.map((m, i) => (
          <img key={i} src={m.url} alt={m.name ?? ""} loading="lazy" />
        ))}
      </div>
    );
  }

  // 文件/视频：show.file 或 FILE_URLS transform。视频按扩展名/MIME 渲染 <video>，其余给下载链接。
  if (node.type === "show.file" || transform?.type === "FILE_URLS") {
    const media = toMediaItems(value);
    if (media.length === 0) return null;
    return (
      <div data-media="file">
        {media.map((m, i) =>
          isVideo(m) ? (
            <video key={i} src={m.url} controls preload="metadata" data-media="video" />
          ) : (
            <a key={i} href={m.url} target="_blank" rel="noopener noreferrer">
              {m.name ?? m.url}
            </a>
          ),
        )}
      </div>
    );
  }

  // 富文本/Markdown：show.richtext 或 MARKDOWN transform
  if (node.type === "show.richtext" || transform?.type === "MARKDOWN") {
    return <MarkdownPreview source={toText(value)} />;
  }

  // JSON：show.json 或 JSON_STRINGIFY transform
  if (node.type === "show.json" || transform?.type === "JSON_STRINGIFY") {
    const space = transform?.type === "JSON_STRINGIFY" ? transform.space : 2;
    return <pre>{safeStringify(value, space ?? 2)}</pre>;
  }

  // 纯文本（show.text / 兜底）：
  // - 基础数组（元素均为原始值，如 expected_dimensions）用顿号连接，便于阅读；
  // - 含对象元素的数组及对象仍 JSON 化，避免出现 [object Object]。
  if (Array.isArray(value)) {
    if (value.every(isPrimitiveValue)) {
      return <span>{value.map((item) => formatPrimitive(item)).join("、")}</span>;
    }
    return <pre>{safeStringify(value, 2)}</pre>;
  }
  if (typeof value === "object") {
    return <pre>{safeStringify(value, 2)}</pre>;
  }
  return <span>{formatPrimitive(value)}</span>;
}

// ---------------------------------------------------------------------------
// 媒体值归一：支持 string / string[] / FileRef / FileRef[]
// ---------------------------------------------------------------------------

interface MediaItem {
  url: string;
  name?: string;
  mimeType?: string;
}

function toMediaItems(value: unknown): MediaItem[] {
  const raw = Array.isArray(value) ? value : [value];
  const items: MediaItem[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const url = sanitizeUrl(entry);
      if (url !== undefined) items.push({ url });
    } else if (isFileRef(entry)) {
      const url = entry.url !== undefined ? sanitizeUrl(entry.url) : undefined;
      if (url !== undefined) items.push({ url, name: entry.name, mimeType: entry.mimeType });
    }
  }
  return items;
}

function isFileRef(value: unknown): value is FileRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "fileId" in value &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

function isVideo(m: MediaItem): boolean {
  if (m.mimeType !== undefined && m.mimeType.startsWith("video/")) return true;
  return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(m.url);
}

// http(s)://、协议相对、根/相对路径 允许；javascript: 等危险协议丢弃，防 XSS。
function sanitizeUrl(url: string): string | undefined {
  const u = url.trim();
  if (u === "") return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/\//.test(u)) return u;
  if (/^\//.test(u)) return u;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; // 纯相对路径
  return undefined;
}

// ---------------------------------------------------------------------------
// 文本辅助
// ---------------------------------------------------------------------------

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeStringify(value, 2);
}

function isPrimitiveValue(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function formatPrimitive(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeStringify(value, 2);
}

function safeStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return "";
  }
}
