import type { LabelHubSchema, NodeType, SchemaNode } from "@labelhub/contracts";
import { findNodeById } from "@labelhub/schema-core";
import { createNodeFromMaterial } from "./materials";
import { insertNode, moveNode, removeNode, updateNode } from "./node-operations";
import type { DesignerActionContext } from "./types";

export function addMaterialNode(context: DesignerActionContext, type: NodeType): void {
  if (context.readonly) {
    return;
  }

  const parentNodeId = resolveInsertParentId(context.schema, context.selectedNodeId);
  const node = createNodeFromMaterial(context.schema, type);
  const nextSchema = insertNode(context.schema, parentNodeId, node);
  context.onSchemaChange(nextSchema);
  context.onSelectNode(node.id);
}

export function deleteSelectedNode(context: DesignerActionContext, nodeId: string): void {
  if (context.readonly || nodeId === context.schema.root.id) {
    return;
  }

  context.onSchemaChange(removeNode(context.schema, nodeId));
  if (context.selectedNodeId === nodeId) {
    context.onSelectNode(undefined);
  }
}

export function moveSelectedNode(context: DesignerActionContext, nodeId: string, direction: "UP" | "DOWN"): void {
  if (context.readonly) {
    return;
  }
  context.onSchemaChange(moveNode(context.schema, nodeId, direction));
}

export function patchNode(context: DesignerActionContext, nodeId: string, patch: Partial<SchemaNode>): void {
  if (context.readonly) {
    return;
  }
  context.onSchemaChange(updateNode(context.schema, nodeId, patch));
}

export function applySchemaChange(
  schema: LabelHubSchema,
  onSchemaChange: (schema: LabelHubSchema) => void,
  nextSchema: LabelHubSchema,
): void {
  if (schema !== nextSchema) {
    onSchemaChange(nextSchema);
  }
}

function resolveInsertParentId(schema: LabelHubSchema, selectedNodeId: string | undefined): string | undefined {
  if (selectedNodeId === undefined) {
    return undefined;
  }
  const selectedNode = findNodeById(schema, selectedNodeId);
  return selectedNode?.kind === "CONTAINER" ? selectedNode.id : undefined;
}
