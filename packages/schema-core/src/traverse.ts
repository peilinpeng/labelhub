import type {
  ContainerNode,
  FieldNode,
  LabelHubSchema,
  LLMAssistNode,
  SchemaNode,
  ShowItemNode,
} from "@labelhub/contracts";

export type SchemaNodeVisitor = (node: SchemaNode, parent: ContainerNode | undefined, depth: number) => void;

export function traverseSchema(schema: LabelHubSchema, visitor?: SchemaNodeVisitor): SchemaNode[] {
  const nodes: SchemaNode[] = [];

  walkNode(schema.root, undefined, 0, (node, parent, depth) => {
    nodes.push(node);
    visitor?.(node, parent, depth);
  });

  return nodes;
}

export function flattenNodes(schema: LabelHubSchema): SchemaNode[] {
  return traverseSchema(schema);
}

export function findNodeById(schema: LabelHubSchema, nodeId: string): SchemaNode | undefined {
  return flattenNodes(schema).find((node) => node.id === nodeId);
}

export function findFieldByName(schema: LabelHubSchema, fieldName: string): FieldNode | undefined {
  return collectFieldNodes(schema).find((node) => node.name === fieldName);
}

export function collectFieldNodes(schema: LabelHubSchema): FieldNode[] {
  return flattenNodes(schema).filter(isFieldNode);
}

export function collectSubmitFieldNames(schema: LabelHubSchema): string[] {
  return collectFieldNodes(schema).map((node) => node.name);
}

export function collectShowItemNodes(schema: LabelHubSchema): ShowItemNode[] {
  return flattenNodes(schema).filter(isShowItemNode);
}

export function collectLLMAssistNodes(schema: LabelHubSchema): LLMAssistNode[] {
  return flattenNodes(schema).filter(isLLMAssistNode);
}

export function isFieldNode(node: SchemaNode): node is FieldNode {
  return node.kind === "FIELD";
}

export function isContainerNode(node: SchemaNode): node is ContainerNode {
  return node.kind === "CONTAINER";
}

export function isShowItemNode(node: SchemaNode): node is ShowItemNode {
  return node.kind === "SHOW_ITEM";
}

export function isLLMAssistNode(node: SchemaNode): node is LLMAssistNode {
  return node.kind === "LLM_ASSIST";
}

function walkNode(
  node: SchemaNode,
  parent: ContainerNode | undefined,
  depth: number,
  visit: SchemaNodeVisitor,
): void {
  visit(node, parent, depth);

  if (node.kind !== "CONTAINER") {
    return;
  }

  for (const child of node.children) {
    walkNode(child, node, depth + 1, visit);
  }
}
