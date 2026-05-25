import type { ChangeEvent } from "react";

export interface TextInputProps {
  value: unknown;
  placeholder?: string | undefined;
  readonly: boolean;
  disabled: boolean;
  onChange(value: string): void;
}

export function TextInput({ value, placeholder, readonly, disabled, onChange }: TextInputProps) {
  return (
    <input
      aria-label="文本输入"
      disabled={readonly || disabled}
      placeholder={placeholder}
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  );
}
