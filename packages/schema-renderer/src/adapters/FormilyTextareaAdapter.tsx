import { TextareaInput } from "../components/TextareaInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyTextareaAdapter(props: FieldComponentProps) {
  return (
    <TextareaInput
      value={props.value}
      placeholder={props["placeholder"] as string | undefined}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      minRows={props["minRows"] as number | undefined}
      maxRows={props["maxRows"] as number | undefined}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
