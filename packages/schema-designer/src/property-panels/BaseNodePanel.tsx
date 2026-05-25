import type { Expression, SchemaNode } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";

export interface BaseNodePanelProps {
  node: SchemaNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function BaseNodePanel({ node, readonly, onPatch, onLocalErrors }: BaseNodePanelProps) {
  return (
    <section>
      <h3>通用属性</h3>
      <label>
        标题
        <input
          disabled={readonly}
          value={node.title}
          onChange={(event) => onPatch({ title: event.target.value })}
        />
      </label>
      <label>
        描述
        <textarea
          disabled={readonly}
          value={node.description ?? ""}
          onChange={(event) => onPatch({ description: event.target.value })}
        />
      </label>
      <label>
        <input
          checked={node.hidden === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ hidden: event.target.checked })}
        />
        隐藏
      </label>
      <label>
        <input
          checked={node.disabled === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ disabled: event.target.checked })}
        />
        禁用
      </label>
      <JsonExpressionEditor
        disabled={readonly}
        label="visibleWhen"
        nodeId={node.id}
        path={`$.nodes.${node.id}.visibleWhen`}
        value={node.visibleWhen}
        onChange={(value) => onPatch({ visibleWhen: value } as Partial<SchemaNode>)}
        onLocalErrors={onLocalErrors}
      />
      <JsonExpressionEditor
        disabled={readonly}
        label="disabledWhen"
        nodeId={node.id}
        path={`$.nodes.${node.id}.disabledWhen`}
        value={node.disabledWhen}
        onChange={(value) => onPatch({ disabledWhen: value } as Partial<SchemaNode>)}
        onLocalErrors={onLocalErrors}
      />
    </section>
  );
}

interface JsonExpressionEditorProps {
  label: string;
  nodeId: string;
  path: string;
  value: Expression | undefined;
  disabled: boolean;
  onChange(value: Expression | undefined): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

function JsonExpressionEditor({
  label,
  nodeId,
  path,
  value,
  disabled,
  onChange,
  onLocalErrors,
}: JsonExpressionEditorProps) {
  return (
    <label>
      {label}
      <textarea
        disabled={disabled}
        defaultValue={formatJson(value)}
        onBlur={(event) => {
          const raw = event.target.value.trim();
          if (raw.length === 0) {
            onLocalErrors([]);
            onChange(undefined);
            return;
          }
          const parsed = parseJson(raw);
          if (parsed.ok) {
            onLocalErrors([]);
            onChange(parsed.value as Expression);
          } else {
            onLocalErrors([createLocalError(nodeId, path, `${label} JSON 解析失败`)]);
          }
        }}
      />
    </label>
  );
}

export function formatJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

export function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}
