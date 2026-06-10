import type { ChoiceFieldNode } from "@labelhub/contracts";
import { TagsInput } from "../components/TagsInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyTagsAdapter(props: FieldComponentProps) {
  const field = props["field"] as ChoiceFieldNode | undefined;
  if (field === undefined) return null;

  return (
    <TagsInput
      field={field}
      value={props.value}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
      onChange={(v) => props.onChange?.(v)}
    />
  );
}
