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
  onReorder?: ((draggedId: string, targetId: string) => void) | undefined;
}

export function DesignerCanvas(props: DesignerCanvasProps) {
  return (
    <section aria-label="模板画布" className="schema-designer-panel schema-designer-canvas-panel">
      <div className="schema-designer-panel__header">
        <div>
          <h2>模板画布</h2>
          <p>从左侧拖拽组件到此处；拖拽节点手柄可重排</p>
        </div>
        <span>{props.nodes.length}</span>
      </div>
      <div className="schema-designer-canvas-surface">
        {props.nodes.length === 0 ? <p className="schema-designer-empty">暂无节点，请从左侧拖拽或点击添加组件。</p> : null}
        {props.nodes.map((node) => (
          <TreeNode key={node.id} node={node} depth={0} {...props} />
        ))}
      </div>
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
  onReorder,
}: DesignerCanvasProps & { node: SchemaNode; depth: number }) {
  return (
    <div className="schema-designer-tree-node" style={{ marginLeft: depth * 18 }}>
      <NodeBlock
        node={node}
        readonly={readonly}
        selected={selectedNodeId === node.id}
        onDelete={onDelete}
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
        onReorder={onReorder}
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
              onReorder={onReorder}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}
