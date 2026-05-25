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
      data-node-id={node.id}
      data-selected={selected ? "true" : "false"}
      style={{ border: selected ? "2px solid #2563eb" : "1px solid #d1d5db", margin: 6, padding: 8 }}
    >
      <div>
        <strong>{node.title}</strong>
        <span> {node.type}</span>
      </div>
      <div>{node.id}</div>
      {node.kind === "FIELD" ? <div>字段：{node.name}</div> : null}
      <div>
        {node.hidden === true ? <span>隐藏 </span> : null}
        {node.disabled === true ? <span>禁用 </span> : null}
        {node.kind === "FIELD" && node.required === true ? <span>必填</span> : null}
      </div>
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
  );
}
