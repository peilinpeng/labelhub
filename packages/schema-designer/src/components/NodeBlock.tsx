import type { SchemaNode } from "@labelhub/contracts";
import { useState } from "react";

export interface NodeBlockProps {
  node: SchemaNode;
  errors?: string[];
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

const NODE_TYPE_LABELS: Record<string, string> = {
  "show.text": "展示文本",
  "show.richtext": "富文本展示",
  "show.image": "图片展示",
  "show.file": "文件展示",
  "show.json": "JSON 展示",
  "input.text": "单行文本",
  "input.textarea": "多行文本",
  "input.richtext": "富文本",
  "choice.radio": "单选",
  "choice.checkbox": "多选",
  "choice.select": "下拉选择",
  "choice.tags": "标签",
  "upload.file": "文件上传",
  "upload.image": "图片上传",
  "data.json": "JSON 数据",
  "llm.assist": "AI 辅助",
  "container.group": "分组",
  "container.tabs": "分页",
  "container.section": "章节",
};

export function NodeBlock({ node, errors = [], selected, readonly, onSelect, onDelete, onMoveUp, onMoveDown, onReorder }: NodeBlockProps) {
  const [dragOver, setDragOver] = useState(false);
  const reorderEnabled = !readonly && onReorder !== undefined;

  return (
    <div
      className="schema-node-card"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-selected={selected ? "true" : "false"}
      data-invalid={errors.length > 0 ? "true" : "false"}
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
        <div className="schema-node-card__identity">
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
        </div>
        <span className="schema-node-card__type">{NODE_TYPE_LABELS[node.type] ?? "组件"}</span>
      </div>
      <div className="schema-node-card__meta">
        {node.kind === "FIELD" ? <div className="schema-node-card__field">保存字段：{node.name || "未配置"}</div> : null}
        <div className="schema-node-card__badges">
          {errors.slice(0, 2).map((error) => <span className="schema-node-card__error" key={error}>{error}</span>)}
          {errors.length > 2 ? <span className="schema-node-card__error">另有 {errors.length - 2} 项</span> : null}
          {node.hidden === true ? <span>隐藏</span> : null}
          {node.disabled === true ? <span>禁用</span> : null}
          {node.kind === "FIELD" && node.required === true ? <span>必填</span> : null}
        </div>
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
