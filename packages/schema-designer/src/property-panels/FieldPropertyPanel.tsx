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
  const nameMissing = node.name.trim().length === 0;

  return (
    <section>
      <h3>字段属性</h3>
      <label>
        <span>字段名称 <b className="schema-property-required">*</b></span>
        <input
          aria-invalid={nameMissing}
          disabled={readonly}
          value={node.name}
          onChange={(event) => onPatch({ name: event.target.value } as Partial<SchemaNode>)}
        />
        {nameMissing ? <small className="schema-property-error">字段名称用于保存标注结果，不能为空。</small> : null}
      </label>
      <label>
        <span>字段类型 <b className="schema-property-required">*</b></span>
        <input disabled readOnly value={fieldTypeLabel(node.type)} />
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

function fieldTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    "input.text": "单行文本",
    "input.textarea": "多行文本",
    "input.richtext": "富文本",
    "choice.radio": "单选",
    "choice.checkbox": "多选",
    "choice.select": "下拉选择",
    "choice.tags": "标签",
    "upload.file": "文件上传",
    "upload.image": "图片上传",
    "data.json": "JSON 数据",
  };
  return labels[type] ?? type;
}
