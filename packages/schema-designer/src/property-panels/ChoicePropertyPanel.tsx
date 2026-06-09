import type { ChoiceFieldNode, Option, SchemaNode } from "@labelhub/contracts";
import { createLocalError } from "../designer-state";

export interface ChoicePropertyPanelProps {
  node: ChoiceFieldNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function ChoicePropertyPanel({ node, readonly, onPatch, onLocalErrors }: ChoicePropertyPanelProps) {
  const insufficientOptions = node.options.length < 2;
  const incompleteOptions = node.options.some((option) => option.label.trim().length === 0 || option.value.trim().length === 0);
  return (
    <section>
      <h3>选项 <b className="schema-property-required">*</b></h3>
      {insufficientOptions ? <p className="schema-property-error" role="alert">至少需要 2 个选项。</p> : null}
      {incompleteOptions ? <p className="schema-property-error" role="alert">选项文字和保存值不能为空。</p> : null}
      {hasDuplicatedValues(node.options) ? <p className="schema-property-error" role="alert">选项保存值不能重复。</p> : null}
      {node.options.map((option, index) => (
        <div className="schema-option-editor" key={`${option.value}-${index}`}>
          <label>
            选项文字
            <textarea
              aria-invalid={option.label.trim().length === 0}
              aria-label={`选项 ${index + 1} 文字`}
              disabled={readonly}
              rows={2}
              value={option.label}
              onChange={(event) => updateOption(node, index, { ...option, label: event.target.value }, onPatch, onLocalErrors)}
            />
          </label>
          <label>
            保存值
            <input
              aria-invalid={option.value.trim().length === 0}
              aria-label={`选项 ${index + 1} 保存值`}
              disabled={readonly}
              value={option.value}
              onChange={(event) => updateOption(node, index, { ...option, value: event.target.value }, onPatch, onLocalErrors)}
            />
          </label>
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
    ? [createLocalError(nodeId, `$.nodes.${nodeId}.options`, "选项保存值不能重复")]
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
