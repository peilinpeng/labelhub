import type {
  BaseNode,
  FieldNode,
  RuntimeContextWithOutput,
  SchemaVisibilityMode,
} from "@labelhub/contracts";
import { evaluateExpression } from "./expression.ts";

export interface VisibilityResolveOptions {
  visibilityMode?: SchemaVisibilityMode;
}

export function resolveNodeVisibility(
  node: BaseNode,
  context: RuntimeContextWithOutput,
  options: VisibilityResolveOptions = {},
): boolean {
  if (node.hidden === true) {
    return false;
  }

  const visibilityMode = options.visibilityMode ?? context.visibilityMode;
  if (
    visibilityMode === "CREATE" &&
    isFieldNode(node) &&
    node.deprecation?.deprecated === true &&
    node.deprecation.hideForNewSubmissions === true
  ) {
    return false;
  }

  if (node.visibleWhen !== undefined) {
    return evaluateExpression(node.visibleWhen, context);
  }
  return true;
}

export function resolveNodeDisabled(node: BaseNode, context: RuntimeContextWithOutput): boolean {
  if (node.disabled === true) {
    return true;
  }
  if (node.disabledWhen !== undefined) {
    return evaluateExpression(node.disabledWhen, context);
  }
  return false;
}

function isFieldNode(node: BaseNode): node is FieldNode {
  return "kind" in node && node.kind === "FIELD";
}
