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
    <section aria-label="组件物料">
      <h2>组件物料</h2>
      {materials.map((material) => (
        <button
          key={material.type}
          disabled={readonly}
          title={material.description}
          type="button"
          onClick={() => onAdd(material.type)}
        >
          {material.label}
        </button>
      ))}
    </section>
  );
}
