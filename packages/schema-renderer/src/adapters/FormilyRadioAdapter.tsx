import type { ChoiceFieldNode } from "@labelhub/contracts";
import { RadioInput } from "../components/RadioInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyRadioAdapter(props: FieldComponentProps) {
  const field = props["field"] as ChoiceFieldNode | undefined;
  if (field === undefined) return null;

  return (
    <RadioInput
      field={field}
      value={props.value}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
