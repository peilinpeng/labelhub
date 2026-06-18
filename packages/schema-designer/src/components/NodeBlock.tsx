import type { SchemaNode } from "@labelhub/contracts";

export interface NodeBlockProps {
  node: SchemaNode;
  selected: boolean;
  readonly: boolean;
  onSelect(nodeId: string): void;
  onDelete(nodeId: string): void;
  onMoveUp(nodeId: string): void;
  onMoveDown(nodeId: string): void;
}

export function NodeBlock({ node, selected, readonly, onSelect, onDelete, onMoveUp, onMoveDown }: NodeBlockProps) {
  return (
    <div
      className="schema-node-card"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-selected={selected ? "true" : "false"}
    >
      <div className="schema-node-card__topline">
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
