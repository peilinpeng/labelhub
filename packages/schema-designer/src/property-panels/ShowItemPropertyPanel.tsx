import type { SchemaNode, ShowItemNode } from "@labelhub/contracts";
import { isAllowedJsonPath } from "@labelhub/schema-core";
import { createLocalError } from "../designer-state";

export interface ShowItemPropertyPanelProps {
  node: ShowItemNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

export function ShowItemPropertyPanel({ node, readonly, onPatch, onLocalErrors }: ShowItemPropertyPanelProps) {
  const matchedSource = sourceOptions.some((option) => option.value === node.sourcePath) ? node.sourcePath : "__custom";

  return (
    <section>
      <h3>展示内容</h3>
      <label>
        读取内容
        <select
          disabled={readonly}
          value={matchedSource}
          onChange={(event) => {
            const sourcePath = event.target.value;
            if (sourcePath === "__custom") return;
            onLocalErrors([]);
            onPatch({ sourcePath } as Partial<SchemaNode>);
          }}
        >
          {sourceOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
          <option value="__custom">自定义</option>
        </select>
      </label>
      {matchedSource === "__custom" ? (
        <label>
          自定义来源
          <input
            disabled={readonly}
            value={node.sourcePath}
            onChange={(event) => {
              const sourcePath = event.target.value;
              if (!isAllowedJsonPath(sourcePath)) {
                onLocalErrors([createLocalError(node.id, `$.nodes.${node.id}.sourcePath`, "读取来源格式不正确")]);
                return;
              }
              onLocalErrors([]);
              onPatch({ sourcePath } as Partial<SchemaNode>);
            }}
          />
        </label>
      ) : null}
    </section>
  );
}

const sourceOptions = [
  { label: "标题", value: "$.item.sourcePayload.title" },
  { label: "正文", value: "$.item.sourcePayload.text" },
  { label: "内容", value: "$.item.sourcePayload.content" },
  { label: "图片", value: "$.item.sourcePayload.imageUrl" },
  { label: "视频", value: "$.item.sourcePayload.videoUrl" },
  { label: "OCR 文本", value: "$.item.sourcePayload.ocrText" },
] as const;
