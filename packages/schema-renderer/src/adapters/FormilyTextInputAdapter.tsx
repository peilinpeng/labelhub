import { TextInput } from "../components/TextInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyTextInputAdapter(props: FieldComponentProps) {
  return (
    <TextInput
      value={props.value}
      placeholder={props["placeholder"] as string | undefined}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
