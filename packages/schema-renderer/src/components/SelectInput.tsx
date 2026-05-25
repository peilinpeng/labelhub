import type { ChoiceFieldNode } from "@labelhub/contracts";
import type { ChangeEvent } from "react";

export interface SelectInputProps {
  field: ChoiceFieldNode;
  value: unknown;
  readonly: boolean;
  disabled: boolean;
  onChange(value: string): void;
}

export function SelectInput({ field, value, readonly, disabled, onChange }: SelectInputProps) {
  return (
    <select
      aria-label={field.title}
      disabled={readonly || disabled}
      value={typeof value === "string" ? value : ""}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    >
      <option value="">请选择</option>
      {field.options.map((option) => (
        <option key={option.value} disabled={option.disabled === true} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
