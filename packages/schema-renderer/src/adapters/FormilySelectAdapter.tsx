import type { ChoiceFieldNode } from "@labelhub/contracts";
import { SelectInput } from "../components/SelectInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilySelectAdapter(props: FieldComponentProps) {
  const field = props["field"] as ChoiceFieldNode | undefined;
  if (field === undefined) return null;

  return (
    <SelectInput
      field={field}
      value={props.value}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
