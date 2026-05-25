import type { FieldNode, SchemaNode, ValidationRule } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";
import { formatJson, parseJson } from "./BaseNodePanel";

export interface FieldPropertyPanelProps {
  node: FieldNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function FieldPropertyPanel({ node, readonly, onPatch, onLocalErrors }: FieldPropertyPanelProps) {
  const placeholder = "placeholder" in node ? node.placeholder ?? "" : "";

  return (
    <section>
      <h3>字段属性</h3>
      <label>
        字段 name
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
        隐藏时保留答案
      </label>
      <label>
        <input
          checked={node.validateWhenHidden === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ validateWhenHidden: event.target.checked } as Partial<SchemaNode>)}
        />
        隐藏时仍校验
      </label>
      <label>
        <input
          checked={node.submitWhenDisabled === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ submitWhenDisabled: event.target.checked } as Partial<SchemaNode>)}
        />
        禁用时允许提交
      </label>
      <label>
        validations
        <textarea
          disabled={readonly}
          defaultValue={formatJson(node.validations)}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            if (raw.length === 0) {
              onLocalErrors([]);
              onPatch({ validations: undefined } as Partial<SchemaNode>);
              return;
            }
            const parsed = parseJson(raw);
            if (parsed.ok && Array.isArray(parsed.value)) {
              onLocalErrors([]);
              onPatch({ validations: parsed.value as ValidationRule[] } as Partial<SchemaNode>);
            } else {
              onLocalErrors([createLocalError(node.id, `$.nodes.${node.id}.validations`, "validations JSON 解析失败")]);
            }
          }}
        />
      </label>
    </section>
  );
}
