import type { ChoiceFieldNode } from "@labelhub/contracts";
import type { ChangeEvent } from "react";

export interface RadioInputProps {
  field: ChoiceFieldNode;
  value: unknown;
  readonly: boolean;
  disabled: boolean;
  onChange(value: string): void;
}

export function RadioInput({ field, value, readonly, disabled, onChange }: RadioInputProps) {
  const selectedValue = typeof value === "string" ? value : "";

  return (
    <div role="radiogroup" aria-label={field.title}>
      {field.options.map((option) => (
        <label key={option.value}>
          <input
            checked={selectedValue === option.value}
            disabled={readonly || disabled || option.disabled === true}
            name={field.name}
            type="radio"
            value={option.value}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
