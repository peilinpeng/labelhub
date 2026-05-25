import type { BaseNode } from "@labelhub/contracts";
import { evaluateExpression } from "./expression.ts";
import type { RuntimeContextWithOutput } from "./json-path.ts";

export function resolveNodeVisibility(node: BaseNode, context: RuntimeContextWithOutput): boolean {
  if (node.hidden === true) {
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
