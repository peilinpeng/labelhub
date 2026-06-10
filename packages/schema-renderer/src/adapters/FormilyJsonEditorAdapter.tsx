import { JsonEditorInput } from "../components/JsonEditorInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyJsonEditorAdapter(props: FieldComponentProps) {
  return (
    <JsonEditorInput
      value={props.value}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
