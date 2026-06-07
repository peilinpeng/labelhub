import type { SchemaNode } from "@labelhub/contracts";
import { useState } from "react";

export interface NodeBlockProps {
  node: SchemaNode;
  selected: boolean;
  readonly: boolean;
  onSelect(nodeId: string): void;
  onDelete(nodeId: string): void;
  onMoveUp(nodeId: string): void;
  onMoveDown(nodeId: string): void;
  onReorder?: ((draggedId: string, targetId: string) => void) | undefined;
}

/** 画布内节点拖拽重排的 dataTransfer key（与物料拖拽 key 区分，避免冲突）。 */
export const NODE_MOVE_DRAG_TYPE = "application/x-labelhub-node-move";

export function NodeBlock({ node, selected, readonly, onSelect, onDelete, onMoveUp, onMoveDown, onReorder }: NodeBlockProps) {
  const [dragOver, setDragOver] = useState(false);
  const reorderEnabled = !readonly && onReorder !== undefined;

  return (
    <div
      className="schema-node-card"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-selected={selected ? "true" : "false"}
      data-drag-over={dragOver ? "true" : "false"}
      onDragOver={(event) => {
        if (!reorderEnabled || !event.dataTransfer.types.includes(NODE_MOVE_DRAG_TYPE)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!reorderEnabled) {
          return;
        }
        const draggedId = event.dataTransfer.getData(NODE_MOVE_DRAG_TYPE);
        if (!draggedId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        if (draggedId !== node.id) {
          onReorder?.(draggedId, node.id);
        }
      }}
    >
      <div className="schema-node-card__topline">
        {reorderEnabled ? (
          <span
            aria-label="拖拽重排"
            className="schema-node-card__drag-handle"
            draggable
            title="拖拽重排"
            onDragStart={(event) => {
              event.dataTransfer.setData(NODE_MOVE_DRAG_TYPE, node.id);
              event.dataTransfer.effectAllowed = "move";
            }}
          >
            ⠿
          </span>
        ) : null}
        <strong>{node.title}</strong>
        <span>{node.type}</span>
      </div>
      <div className="schema-node-card__meta">{node.id}</div>
      {node.kind === "FIELD" ? <div className="schema-node-card__field">字段：{node.name}</div> : null}
      <div className="schema-node-card__badges">
        {node.hidden === true ? <span>隐藏</span> : null}
        {node.disabled === true ? <span>禁用</span> : null}
        {node.kind === "FIELD" && node.required === true ? <span>必填</span> : null}
      </div>
      <div className="schema-node-card__actions">
        <button type="button" onClick={() => onSelect(node.id)}>
          选择
        </button>
        <button disabled={readonly} type="button" onClick={() => onMoveUp(node.id)}>
          上移
        </button>
        <button disabled={readonly} type="button" onClick={() => onMoveDown(node.id)}>
          下移
        </button>
        <button disabled={readonly} type="button" onClick={() => onDelete(node.id)}>
          删除
        </button>
      </div>
    </div>
  );
}
