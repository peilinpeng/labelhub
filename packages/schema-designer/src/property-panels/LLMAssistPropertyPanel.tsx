import type { LLMAssistNode, LLMOutputBinding, SchemaNode } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";
import { formatJson, parseJson } from "./BaseNodePanel";

export interface LLMAssistPropertyPanelProps {
  node: LLMAssistNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function LLMAssistPropertyPanel({ node, readonly, onPatch, onLocalErrors }: LLMAssistPropertyPanelProps) {
  return (
    <section>
      <h3>AI 辅助属性</h3>
      <label>
        promptTemplate
        <textarea
          disabled={readonly}
          value={node.promptTemplate ?? ""}
          onChange={(event) => onPatch({ promptTemplate: event.target.value } as Partial<SchemaNode>)}
        />
      </label>
      <label>
        outputBindings
        <textarea
          disabled={readonly}
          defaultValue={formatJson(node.outputBindings)}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            if (raw.length === 0) {
              onLocalErrors([]);
              onPatch({ outputBindings: undefined } as Partial<SchemaNode>);
              return;
            }
            const parsed = parseJson(raw);
            if (parsed.ok && Array.isArray(parsed.value)) {
              onLocalErrors([]);
              onPatch({ outputBindings: normalizeOutputBindings(parsed.value) } as Partial<SchemaNode>);
            } else {
              onLocalErrors([createLocalError(node.id, `$.nodes.${node.id}.outputBindings`, "outputBindings JSON 解析失败")]);
            }
          }}
        />
      </label>
    </section>
  );
}

function normalizeOutputBindings(value: unknown[]): LLMOutputBinding[] {
  return value.map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      from: typeof record.from === "string" ? record.from : "$.output.value",
      toFieldName: typeof record.toFieldName === "string" ? record.toFieldName : "",
      mode: record.mode === "APPEND" || record.mode === "MERGE" ? record.mode : "REPLACE",
      requireUserConfirm: true,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
