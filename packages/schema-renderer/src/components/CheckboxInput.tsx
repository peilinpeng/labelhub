import type { ChoiceFieldNode } from "@labelhub/contracts";
import type { ChangeEvent } from "react";

export interface CheckboxInputProps {
  field: ChoiceFieldNode;
  value: unknown;
  readonly: boolean;
  disabled: boolean;
  onChange(value: string[]): void;
}

export function CheckboxInput({ field, value, readonly, disabled, onChange }: CheckboxInputProps) {
  const selectedValues = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

  return (
    <div role="group" aria-label={field.title}>
      {field.options.map((option) => (
        <label key={option.value}>
          <input
            checked={selectedValues.has(option.value)}
            disabled={readonly || disabled || option.disabled === true}
            type="checkbox"
            value={option.value}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const nextValues = new Set(selectedValues);
              if (event.target.checked) {
                nextValues.add(option.value);
              } else {
                nextValues.delete(option.value);
              }
              onChange([...nextValues]);
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
