import type { ContainerNode, FieldNode, LabelHubSchema, SchemaNode } from "@labelhub/contracts";
import { collectFieldNodes, flattenNodes } from "@labelhub/schema-core";
import type { DesignerState } from "./types";

export type MoveDirection = "UP" | "DOWN";

export function insertNode(
  schema: LabelHubSchema,
  parentNodeId: string | null | undefined,
  node: SchemaNode,
  index?: number,
): LabelHubSchema {
  const parentId = parentNodeId ?? schema.root.id;
  const nextNode = cloneValue(node);

  if (parentId === schema.root.id) {
    return {
      ...schema,
      root: insertIntoContainer(schema.root, nextNode, index),
    };
  }

  return {
    ...schema,
    root: mapContainer(schema.root, (container) => {
      if (container.id !== parentId) {
        return container;
      }
      return insertIntoContainer(container, nextNode, index);
    }),
  };
}

export function removeNode(schema: LabelHubSchema, nodeId: string): LabelHubSchema {
  if (nodeId === schema.root.id) {
    return schema;
  }

  return {
    ...schema,
    root: removeFromContainer(schema.root, nodeId),
  };
}

export function moveNode(schema: LabelHubSchema, nodeId: string, direction: MoveDirection): LabelHubSchema {
  if (nodeId === schema.root.id) {
    return schema;
  }

  return {
    ...schema,
    root: mapContainer(schema.root, (container) => moveChildInContainer(container, nodeId, direction)),
  };
}

/**
 * 拖拽重排：把 draggedId 节点移动到 targetId 节点之前（同一父容器内）。
 * 跨容器或定位失败时原样返回，保证安全。
 */
export function reorderNode(schema: LabelHubSchema, draggedId: string, targetId: string): LabelHubSchema {
  if (draggedId === targetId || draggedId === schema.root.id || targetId === schema.root.id) {
    return schema;
  }
  const dragged = locateNode(schema.root, draggedId);
  const target = locateNode(schema.root, targetId);
  if (dragged === undefined || target === undefined) {
    return schema;
  }
  // MVP：仅支持同一父容器内重排
  if (dragged.parentId !== target.parentId) {
    return schema;
  }
  const without = removeNode(schema, draggedId);
  const targetAfter = locateNode(without.root, targetId);
  if (targetAfter === undefined) {
    return schema;
  }
  return insertNode(without, targetAfter.parentId, dragged.node, targetAfter.index);
}

interface NodeLocation {
  node: SchemaNode;
  parentId: string;
  index: number;
}

function locateNode(container: ContainerNode, nodeId: string): NodeLocation | undefined {
  const index = container.children.findIndex((child) => child.id === nodeId);
  if (index >= 0) {
    return { node: container.children[index] as SchemaNode, parentId: container.id, index };
  }
  for (const child of container.children) {
    if (child.kind === "CONTAINER") {
      const found = locateNode(child, nodeId);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

export function updateNode(schema: LabelHubSchema, nodeId: string, patch: Partial<SchemaNode>): LabelHubSchema {
  return {
    ...schema,
    root: updateNodeInTree(schema.root, nodeId, patch) as ContainerNode,
  };
}

export function duplicateNode(schema: LabelHubSchema, nodeId: string): LabelHubSchema {
  if (nodeId === schema.root.id) {
    return schema;
  }

  const allNodeIds = new Set(flattenNodes(schema).map((node) => node.id));
  const fieldNames = new Set(collectFieldNodes(schema).map((field) => field.name));

  return {
    ...schema,
    root: duplicateChildInContainer(schema.root, nodeId, allNodeIds, fieldNames),
  };
}

export function selectNode(state: DesignerState, nodeId: string | undefined): DesignerState {
  return nodeId === undefined ? { ...state, selectedNodeId: undefined } : { ...state, selectedNodeId: nodeId };
}

export function prepareNodeForInsert(schema: LabelHubSchema, node: SchemaNode): SchemaNode {
  const allNodeIds = new Set(flattenNodes(schema).map((item) => item.id));
  const fieldNames = new Set(collectFieldNodes(schema).map((field) => field.name));
  return withUniqueIdentity(cloneValue(node), allNodeIds, fieldNames);
}

function insertIntoContainer(container: ContainerNode, node: SchemaNode, index?: number): ContainerNode {
  const children = [...container.children];
  const safeIndex = index === undefined ? children.length : Math.max(0, Math.min(index, children.length));
  children.splice(safeIndex, 0, node);
  return { ...container, children };
}

function removeFromContainer(container: ContainerNode, nodeId: string): ContainerNode {
  return {
    ...container,
    children: container.children
      .filter((child) => child.id !== nodeId)
      .map((child) => (child.kind === "CONTAINER" ? removeFromContainer(child, nodeId) : child)),
  };
}

function updateNodeInTree(node: SchemaNode, nodeId: string, patch: Partial<SchemaNode>): SchemaNode {
  if (node.id === nodeId) {
    return { ...node, ...patch } as SchemaNode;
  }

  if (node.kind !== "CONTAINER") {
    return node;
  }

  return {
    ...node,
    children: node.children.map((child) => updateNodeInTree(child, nodeId, patch)),
  };
}

function mapContainer(container: ContainerNode, map: (container: ContainerNode) => ContainerNode): ContainerNode {
  const mappedChildren = container.children.map((child) => {
    if (child.kind !== "CONTAINER") {
      return child;
    }
    return mapContainer(child, map);
  });
  return map({ ...container, children: mappedChildren });
}

function moveChildInContainer(container: ContainerNode, nodeId: string, direction: MoveDirection): ContainerNode {
  const currentIndex = container.children.findIndex((child) => child.id === nodeId);
  if (currentIndex < 0) {
    return container;
  }

  const nextIndex = direction === "UP" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= container.children.length) {
    return container;
  }

  const children = [...container.children];
  const [item] = children.splice(currentIndex, 1);
  if (item === undefined) {
    return container;
  }
  children.splice(nextIndex, 0, item);
  return { ...container, children };
}

function duplicateChildInContainer(
  container: ContainerNode,
  nodeId: string,
  allNodeIds: Set<string>,
  fieldNames: Set<string>,
): ContainerNode {
  const currentIndex = container.children.findIndex((child) => child.id === nodeId);
  if (currentIndex >= 0) {
    const target = container.children[currentIndex];
    if (target === undefined) {
      return container;
    }
    const duplicate = withUniqueIdentity(cloneValue(target), allNodeIds, fieldNames);
    const children = [...container.children];
    children.splice(currentIndex + 1, 0, duplicate);
    return { ...container, children };
  }

  return {
    ...container,
    children: container.children.map((child) =>
      child.kind === "CONTAINER" ? duplicateChildInContainer(child, nodeId, allNodeIds, fieldNames) : child,
    ),
  };
}

function withUniqueIdentity(node: SchemaNode, allNodeIds: Set<string>, fieldNames: Set<string>): SchemaNode {
  const id = uniqueValue(node.id, allNodeIds);
  allNodeIds.add(id);

  if (node.kind === "FIELD") {
    const name = uniqueValue(node.name, fieldNames);
    fieldNames.add(name);
    return { ...node, id, name } as FieldNode;
  }

  if (node.kind === "CONTAINER") {
    return {
      ...node,
      id,
      children: node.children.map((child) => withUniqueIdentity(child, allNodeIds, fieldNames)),
    };
  }

  return { ...node, id };
}

function uniqueValue(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    return base;
  }

  let index = 2;
  while (used.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
