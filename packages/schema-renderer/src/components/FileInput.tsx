import type { FileRef, UploadFieldNode } from "@labelhub/contracts";

export interface FileInputProps {
  field: UploadFieldNode;
  value: unknown;
  readonly: boolean;
  disabled: boolean;
}

export function FileInput({ field, value, readonly, disabled }: FileInputProps) {
  const files = normalizeFileRefs(value);

  return (
    <div>
      <input
        aria-label={field.title}
        accept={field.accept?.join(",")}
        disabled={true}
        multiple={(field.maxCount ?? 1) > 1}
        type="file"
      />
      <div>{readonly || disabled ? "文件只读" : "文件上传需由宿主应用接入"}</div>
      {files.length > 0 ? (
        <ul>
          {files.map((file) => (
            <li key={file.fileId}>
              {file.name}（{file.mimeType}）
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function normalizeFileRefs(value: unknown): FileRef[] {
  if (isFileRef(value)) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter(isFileRef);
  }
  return [];
}

function isFileRef(value: unknown): value is FileRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.fileId === "string" &&
    typeof record.name === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.size === "number"
  );
}
