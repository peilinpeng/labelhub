import type { NodeType, ServerComponentRegistryItem } from "@labelhub/contracts";
import { defaultMaterials, filterMaterialsByServerRegistry } from "../materials";

export interface MaterialPanelProps {
  serverRegistry: ServerComponentRegistryItem[];
  readonly: boolean;
  onAdd(type: NodeType): void;
}

export function MaterialPanel({ serverRegistry, readonly, onAdd }: MaterialPanelProps) {
  const materials = filterMaterialsByServerRegistry(defaultMaterials, serverRegistry);

  return (
    <section aria-label="组件物料" className="schema-designer-panel schema-designer-materials">
      <div className="schema-designer-panel__header">
        <div>
          <h2>组件物料</h2>
          <p>点击添加到当前 schema</p>
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
            title={material.description}
            type="button"
            onClick={() => onAdd(material.type)}
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
