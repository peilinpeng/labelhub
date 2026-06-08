import type { SchemaNode } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";

export interface BaseNodePanelProps {
  node: SchemaNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function BaseNodePanel({ node, readonly, onPatch }: BaseNodePanelProps) {
  return (
    <section>
      <h3>基础</h3>
      <label>
        名称
        <input
          disabled={readonly}
          value={node.title}
          onChange={(event) => onPatch({ title: event.target.value })}
        />
      </label>
      <label>
        说明
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
        默认隐藏
      </label>
      <label>
        <input
          checked={node.disabled === true}
          disabled={readonly}
          type="checkbox"
          onChange={(event) => onPatch({ disabled: event.target.checked })}
        />
        默认禁用
      </label>
    </section>
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
