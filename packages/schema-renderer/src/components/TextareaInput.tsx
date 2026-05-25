import type { ChangeEvent } from "react";

export interface TextareaInputProps {
  value: unknown;
  placeholder?: string | undefined;
  readonly: boolean;
  disabled: boolean;
  minRows?: number | undefined;
  maxRows?: number | undefined;
  onChange(value: string): void;
}

export function TextareaInput({
  value,
  placeholder,
  readonly,
  disabled,
  minRows,
  maxRows,
  onChange,
}: TextareaInputProps) {
  return (
    <textarea
      aria-label="多行文本输入"
      disabled={readonly || disabled}
      placeholder={placeholder}
      rows={minRows ?? maxRows ?? 3}
      value={typeof value === "string" ? value : ""}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
    />
  );
}
