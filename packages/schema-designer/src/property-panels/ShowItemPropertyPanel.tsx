import type { SchemaNode, ShowItemNode } from "@labelhub/contracts";
import { isAllowedJsonPath } from "@labelhub/schema-core";
import { useEffect, useState } from "react";
import { createLocalError } from "../designer-state";

export interface ShowItemPropertyPanelProps {
  node: ShowItemNode;
  readonly: boolean;
  onPatch(patch: Partial<SchemaNode>): void;
  onLocalErrors(errors: ReturnType<typeof createLocalError>[]): void;
}

// 裸字段名（如 prompt）规范化为绑定原始数据的完整 JSONPath；已是完整 JSONPath（以 $ 开头）则原样保留。
// 这样 Owner 既能直接填数据集字段名，也能填 $.item.sourcePayload.x / $.answers.x 等完整路径（向后兼容）。
function normalizeSourcePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.startsWith("$")) return trimmed;
  return `$.item.sourcePayload.${trimmed}`;
}

export function ShowItemPropertyPanel({ node, readonly, onPatch, onLocalErrors }: ShowItemPropertyPanelProps) {
  const matchedSource = sourceOptions.some((option) => option.value === node.sourcePath) ? node.sourcePath : "__custom";
  // 自定义来源用本地草稿态：允许 Owner 边输入裸字段名边显示原文，保存时再规范化为完整 JSONPath。
  // 仅在切换到不同节点时重置，避免输入过程中被规范化后的完整路径覆盖。
  const [customDraft, setCustomDraft] = useState(node.sourcePath);
  useEffect(() => {
    setCustomDraft(node.sourcePath);
  }, [node.id]);

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
          绑定数据字段
          <input
            disabled={readonly}
            placeholder="例如 prompt / model_answer / reference，或完整 JSONPath"
            value={customDraft}
            onChange={(event) => {
              const raw = event.target.value;
              setCustomDraft(raw);
              const sourcePath = normalizeSourcePath(raw);
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
