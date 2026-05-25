import type { ShowItemNode, TransformSpec } from "@labelhub/contracts";
import { getByJsonPath } from "@labelhub/schema-core";
import type { RenderNodeContext } from "../types";

export interface ShowItemRendererProps {
  node: ShowItemNode;
  renderContext: RenderNodeContext;
}

export function ShowItemRenderer({ node, renderContext }: ShowItemRendererProps) {
  const value = getByJsonPath(renderContext.context, node.sourcePath);
  const displayValue = formatDisplayValue(value, node.transform);

  return (
    <section data-node-id={node.id}>
      <h3>{node.title}</h3>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      <div>{displayValue}</div>
    </section>
  );
}

function formatDisplayValue(value: unknown, transform?: TransformSpec): string {
  if (value === undefined || value === null) {
    return transform?.type === "TEXT" && transform.fallback !== undefined ? transform.fallback : "";
  }

  if (transform?.type === "JSON_STRINGIFY") {
    return safeStringify(value, transform.space);
  }

  if (transform?.type === "FILE_URLS") {
    return Array.isArray(value) ? value.map(formatPrimitive).join("\n") : formatPrimitive(value);
  }

  if (typeof value === "object") {
    return safeStringify(value, 2);
  }

  return formatPrimitive(value);
}

function formatPrimitive(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return safeStringify(value, 2);
}

function safeStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return "";
  }
}
