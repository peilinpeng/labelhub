import type { FieldNode, SchemaNode } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";

export interface FieldPropertyPanelProps {
  node: FieldNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function FieldPropertyPanel({ node, readonly, onPatch }: FieldPropertyPanelProps) {
  const placeholder = "placeholder" in node ? node.placeholder ?? "" : "";

  return (
    <section>
      <h3>字段属性</h3>
      <label>
        保存字段
        <input disabled={readonly} value={node.name} onChange={(event) => onPatch({ name: event.target.value } as Partial<SchemaNode>)} />
      </label>
      <label>
        <input
          checked={node.required === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ required: event.target.checked } as Partial<SchemaNode>)}
        />
        必填
      </label>
      {"placeholder" in node ? (
        <label>
          占位提示
          <input
            disabled={readonly}
            value={placeholder}
            onChange={(event) => onPatch({ placeholder: event.target.value } as Partial<SchemaNode>)}
          />
        </label>
      ) : null}
      <label>
        <input
          checked={node.preserveWhenHidden === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ preserveWhenHidden: event.target.checked } as Partial<SchemaNode>)}
        />
        隐藏时保留
      </label>
      <label>
        <input
          checked={node.validateWhenHidden === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ validateWhenHidden: event.target.checked } as Partial<SchemaNode>)}
        />
        隐藏时校验
      </label>
      <label>
        <input
          checked={node.submitWhenDisabled === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ submitWhenDisabled: event.target.checked } as Partial<SchemaNode>)}
        />
        禁用时提交
      </label>
    </section>
  );
}
