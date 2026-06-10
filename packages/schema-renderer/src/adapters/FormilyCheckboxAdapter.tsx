import type { ChoiceFieldNode } from "@labelhub/contracts";
import { CheckboxInput } from "../components/CheckboxInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyCheckboxAdapter(props: FieldComponentProps) {
  const field = props["field"] as ChoiceFieldNode | undefined;
  if (field === undefined) return null;

  return (
    <CheckboxInput
      field={field}
      value={props.value}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
