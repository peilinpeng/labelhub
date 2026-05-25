import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";

export interface JsonEditorInputProps {
  value: unknown;
  readonly: boolean;
  disabled: boolean;
  onChange(value: unknown): void;
}

export function JsonEditorInput({ value, readonly, disabled, onChange }: JsonEditorInputProps) {
  const [draft, setDraft] = useState(() => stringifyJson(value));
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setDraft(stringifyJson(value));
  }, [value]);

  return (
    <div>
      <textarea
        aria-label="JSON 编辑器"
        disabled={readonly || disabled}
        rows={6}
        value={draft}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          try {
            const parsed = JSON.parse(nextDraft) as unknown;
            setError(undefined);
            onChange(parsed);
          } catch {
            setError("JSON 格式无效");
          }
        }}
      />
      {error !== undefined ? <div role="alert">{error}</div> : null}
    </div>
  );
}

function stringifyJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
