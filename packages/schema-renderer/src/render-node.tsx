import type { ReactNode } from "react";
import type { SchemaNode } from "@labelhub/contracts";
import { resolveNodeVisibility } from "@labelhub/schema-core";
import { ContainerRenderer } from "./renderers/ContainerRenderer";
import { FieldRenderer } from "./renderers/FieldRenderer";
import { LLMAssistRenderer } from "./renderers/LLMAssistRenderer";
import { ShowItemRenderer } from "./renderers/ShowItemRenderer";
import { UnknownNodeFallback } from "./renderers/UnknownNodeFallback";
import type { RenderNodeContext } from "./types";

const fieldTypes = new Set<string>([
  "input.text",
  "input.textarea",
  "input.richtext",
  "choice.radio",
  "choice.checkbox",
  "choice.select",
  "choice.tags",
  "upload.file",
  "upload.image",
  "data.json",
]);

const showItemTypes = new Set<string>(["show.text", "show.richtext", "show.image", "show.file", "show.json"]);
const containerTypes = new Set<string>(["container.group", "container.tabs", "container.section"]);

export function renderNode(node: unknown, renderContext: RenderNodeContext): ReactNode {
  if (!isKnownSchemaNode(node)) {
    return <UnknownNodeFallback labelingMode={renderContext.mode === "LABELING"} node={node} />;
  }

  if (!resolveNodeVisibility(node, renderContext.context)) {
    return null;
  }

  switch (node.kind) {
    case "CONTAINER":
      return <ContainerRenderer node={node} renderContext={renderContext} />;
    case "FIELD":
      return <FieldRenderer node={node} renderContext={renderContext} />;
    case "SHOW_ITEM":
      return <ShowItemRenderer node={node} renderContext={renderContext} />;
    case "LLM_ASSIST":
      return <LLMAssistRenderer node={node} renderContext={renderContext} />;
  }
}

function isKnownSchemaNode(node: unknown): node is SchemaNode {
  if (!isRecord(node)) {
    return false;
  }

  const kind = node.kind;
  const type = node.type;

  if (typeof kind !== "string" || typeof type !== "string") {
    return false;
  }

  if (kind === "FIELD") {
    return fieldTypes.has(type);
  }
  if (kind === "SHOW_ITEM") {
    return showItemTypes.has(type);
  }
  if (kind === "CONTAINER") {
    return containerTypes.has(type) && Array.isArray(node.children);
  }
  if (kind === "LLM_ASSIST") {
    return type === "llm.assist";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
