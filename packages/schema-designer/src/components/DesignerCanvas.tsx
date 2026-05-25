import type { SchemaNode } from "@labelhub/contracts";
import { NodeBlock } from "./NodeBlock";

export interface DesignerCanvasProps {
  nodes: SchemaNode[];
  selectedNodeId?: string | undefined;
  readonly: boolean;
  onSelect(nodeId: string): void;
  onDelete(nodeId: string): void;
  onMoveUp(nodeId: string): void;
  onMoveDown(nodeId: string): void;
}

export function DesignerCanvas(props: DesignerCanvasProps) {
  return (
    <section aria-label="Schema 画布">
      <h2>Schema 画布</h2>
      {props.nodes.length === 0 ? <p>暂无节点，请从左侧添加组件。</p> : null}
      {props.nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} {...props} />
      ))}
    </section>
  );
}

function TreeNode({
  node,
  depth,
  selectedNodeId,
  readonly,
  onSelect,
  onDelete,
  onMoveUp,
  onMoveDown,
}: DesignerCanvasProps & { node: SchemaNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth * 16 }}>
      <NodeBlock
        node={node}
        readonly={readonly}
        selected={selectedNodeId === node.id}
        onDelete={onDelete}
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
        onSelect={onSelect}
      />
      {node.kind === "CONTAINER"
        ? node.children.map((child) => (
            <TreeNode
              key={child.id}
              depth={depth + 1}
              node={child}
              nodes={[]}
              readonly={readonly}
              selectedNodeId={selectedNodeId}
              onDelete={onDelete}
              onMoveDown={onMoveDown}
              onMoveUp={onMoveUp}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}
