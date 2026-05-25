import type { SchemaNode, ShowItemNode, TransformSpec } from "@labelhub/contracts";
import { isAllowedJsonPath } from "@labelhub/schema-core";
import { createLocalError } from "../designer-state";
import { formatJson, parseJson } from "./BaseNodePanel";

export interface ShowItemPropertyPanelProps {
  node: ShowItemNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function ShowItemPropertyPanel({ node, readonly, onPatch, onLocalErrors }: ShowItemPropertyPanelProps) {
  return (
    <section>
      <h3>展示属性</h3>
      <label>
        sourcePath
        <input
          disabled={readonly}
          value={node.sourcePath}
          onChange={(event) => {
            const sourcePath = event.target.value;
            if (!isAllowedJsonPath(sourcePath)) {
              onLocalErrors([createLocalError(node.id, `$.nodes.${node.id}.sourcePath`, "sourcePath 必须使用 RuntimeContext 命名空间")]);
              return;
            }
            onLocalErrors([]);
            onPatch({ sourcePath } as Partial<SchemaNode>);
          }}
        />
      </label>
      <label>
        transform
        <textarea
          disabled={readonly}
          defaultValue={formatJson(node.transform)}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            if (raw.length === 0) {
              onLocalErrors([]);
              onPatch({ transform: undefined } as Partial<SchemaNode>);
              return;
            }
            const parsed = parseJson(raw);
            if (parsed.ok) {
              onLocalErrors([]);
              onPatch({ transform: parsed.value as TransformSpec } as Partial<SchemaNode>);
            } else {
              onLocalErrors([createLocalError(node.id, `$.nodes.${node.id}.transform`, "transform JSON 解析失败")]);
            }
          }}
        />
      </label>
    </section>
  );
}
