import type { NodeType, ServerComponentRegistryItem } from "@labelhub/contracts";
import { defaultMaterials, filterMaterialsByServerRegistry } from "../materials";

export interface MaterialPanelProps {
  serverRegistry: ServerComponentRegistryItem[];
  readonly: boolean;
  onAdd(type: NodeType): void;
}

/** 物料拖拽 dataTransfer key（与画布 drop 区一致）。 */
export const MATERIAL_DRAG_TYPE = "application/x-labelhub-node-type";

export function MaterialPanel({ serverRegistry, readonly, onAdd }: MaterialPanelProps) {
  const materials = filterMaterialsByServerRegistry(defaultMaterials, serverRegistry);

  return (
    <section aria-label="组件物料" className="schema-designer-panel schema-designer-materials">
      <div className="schema-designer-panel__header">
        <div>
          <h2>组件物料</h2>
          <p>拖拽到画布，或点击添加</p>
        </div>
        <span>{materials.length}</span>
      </div>
      <div className="schema-designer-materials__list">
        {materials.map((material) => (
          <button
            aria-label={material.label}
            className="schema-designer-material"
            key={material.type}
            disabled={readonly}
            draggable={!readonly}
            title={material.description}
            type="button"
            onClick={() => onAdd(material.type)}
            onDragStart={(event) => {
              if (readonly) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData(MATERIAL_DRAG_TYPE, material.type);
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <span className="schema-designer-material__icon">{material.label.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{material.label}</strong>
              <small>{material.description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
