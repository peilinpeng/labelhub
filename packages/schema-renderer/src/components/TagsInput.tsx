import type { ChoiceFieldNode } from "@labelhub/contracts";
import { CheckboxInput } from "./CheckboxInput";

export interface TagsInputProps {
  field: ChoiceFieldNode;
  value: unknown;
  readonly: boolean;
  disabled: boolean;
  onChange(value: string[]): void;
}

export function TagsInput(props: TagsInputProps) {
  return <CheckboxInput {...props} />;
}
