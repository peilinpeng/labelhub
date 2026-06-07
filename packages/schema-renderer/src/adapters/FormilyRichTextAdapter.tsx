import { RichTextInput } from "../components/RichTextInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyRichTextAdapter(props: FieldComponentProps) {
  return (
    <RichTextInput
      value={props.value}
      placeholder={props["placeholder"] as string | undefined}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
