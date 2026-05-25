import type { ContainerNode, LayoutSpec, SchemaNode } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";
import { formatJson, parseJson } from "./BaseNodePanel";

export interface ContainerPropertyPanelProps {
  node: ContainerNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function ContainerPropertyPanel({ node, readonly, onPatch, onLocalErrors }: ContainerPropertyPanelProps) {
  return (
    <section>
      <h3>容器属性</h3>
      <label>
        layout
        <textarea
          disabled={readonly}
          defaultValue={formatJson(node.layout)}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            if (raw.length === 0) {
              onLocalErrors([]);
              onPatch({ layout: undefined } as Partial<SchemaNode>);
              return;
            }
            const parsed = parseJson(raw);
            if (parsed.ok) {
              onLocalErrors([]);
              onPatch({ layout: parsed.value as LayoutSpec } as Partial<SchemaNode>);
            } else {
              onLocalErrors([createLocalError(node.id, `$.nodes.${node.id}.layout`, "layout JSON 解析失败")]);
            }
          }}
        />
      </label>
      <p>children 由画布管理。</p>
    </section>
  );
}
