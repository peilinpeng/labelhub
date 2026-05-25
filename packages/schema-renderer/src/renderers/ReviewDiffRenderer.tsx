import type { FieldNode, ReviewPatch } from "@labelhub/contracts";

export interface ReviewDiffRendererProps {
  field: FieldNode;
  originalValue: unknown;
  patchedValue: unknown;
  patches?: ReviewPatch[] | undefined;
}

export function ReviewDiffRenderer({ field, originalValue, patchedValue, patches }: ReviewDiffRendererProps) {
  const fieldPatches = patches?.filter((patch) => patch.fieldName === field.name) ?? [];

  return (
    <div data-field-name={field.name} data-review-diff="true">
      <div>{field.title}</div>
      <div>
        <strong>原始答案</strong>
        <pre>{formatValue(originalValue)}</pre>
      </div>
      <div>
        <strong>修订答案</strong>
        <pre>{formatValue(patchedValue)}</pre>
      </div>
      {fieldPatches.length > 0 ? (
        <ul>
          {fieldPatches.map((patch, index) => (
            <li key={`${patch.fieldName}-${index}`}>{patch.reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "未填写";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "无法展示的值";
  }
}
