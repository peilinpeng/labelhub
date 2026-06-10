import type { UploadFieldNode } from "@labelhub/contracts";
import { FileInput } from "../components/FileInput";
import type { FieldComponentProps } from "../ComponentRegistry";

export function FormilyFileAdapter(props: FieldComponentProps) {
  const field = props["field"] as UploadFieldNode | undefined;
  if (field === undefined) return null;

  return (
    <FileInput
      field={field}
      value={props.value}
      readonly={props.readOnly ?? false}
      disabled={props.disabled ?? false}
    />
  );
}
