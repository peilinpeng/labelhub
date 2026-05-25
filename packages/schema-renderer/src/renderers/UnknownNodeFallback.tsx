export interface UnknownNodeFallbackProps {
  node: unknown;
  labelingMode: boolean;
}

export function UnknownNodeFallback({ node, labelingMode }: UnknownNodeFallbackProps) {
  const type = readString(node, "type") ?? "unknown";
  const id = readString(node, "id") ?? "unknown";

  return (
    <div data-node-id={id} data-unsupported={labelingMode ? "true" : "false"} role="note">
      组件类型不被当前前端支持：{type}
    </div>
  );
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record[key] === "string" ? record[key] : undefined;
}
