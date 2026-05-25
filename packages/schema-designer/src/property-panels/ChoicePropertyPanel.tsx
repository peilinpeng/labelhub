import type { ChoiceFieldNode, Option, SchemaNode } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";

export interface ChoicePropertyPanelProps {
  node: ChoiceFieldNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function ChoicePropertyPanel({ node, readonly, onPatch, onLocalErrors }: ChoicePropertyPanelProps) {
  return (
    <section>
      <h3>选项属性</h3>
      {hasDuplicatedValues(node.options) ? <p role="alert">选项 value 必须唯一</p> : null}
      {node.options.map((option, index) => (
        <div key={`${option.value}-${index}`}>
          <input
            aria-label={`选项 ${index + 1} label`}
            disabled={readonly}
            value={option.label}
            onChange={(event) => updateOption(node, index, { ...option, label: event.target.value }, onPatch, onLocalErrors)}
          />
          <input
            aria-label={`选项 ${index + 1} value`}
            disabled={readonly}
            value={option.value}
            onChange={(event) => updateOption(node, index, { ...option, value: event.target.value }, onPatch, onLocalErrors)}
          />
          <button
            disabled={readonly}
            type="button"
            onClick={() => {
              const options = node.options.filter((_, itemIndex) => itemIndex !== index);
              onLocalErrors(validateOptionValues(node.id, options));
              onPatch({ options } as Partial<SchemaNode>);
            }}
          >
            删除选项
          </button>
        </div>
      ))}
      <button
        disabled={readonly}
        type="button"
        onClick={() => {
          const options = [...node.options, { label: "新选项", value: `option_${node.options.length + 1}` }];
          onLocalErrors(validateOptionValues(node.id, options));
          onPatch({ options } as Partial<SchemaNode>);
        }}
      >
        新增选项
      </button>
    </section>
  );
}

function updateOption(
  node: ChoiceFieldNode,
  index: number,
  option: Option,
  onPatch: (patch: Partial<SchemaNode>) => void,
  onLocalErrors: (errors: ReturnType<typeof createLocalError>[]) => void,
): void {
  const options = node.options.map((item, itemIndex) => (itemIndex === index ? option : item));
  onLocalErrors(validateOptionValues(node.id, options));
  onPatch({ options } as Partial<SchemaNode>);
}

function validateOptionValues(nodeId: string, options: Option[]): ReturnType<typeof createLocalError>[] {
  return hasDuplicatedValues(options)
    ? [createLocalError(nodeId, `$.nodes.${nodeId}.options`, "option value 必须唯一")]
    : [];
}

function hasDuplicatedValues(options: Option[]): boolean {
  const values = new Set<string>();
  for (const option of options) {
    if (values.has(option.value)) {
      return true;
    }
    values.add(option.value);
  }
  return false;
}
