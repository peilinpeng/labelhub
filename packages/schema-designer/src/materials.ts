import type { LabelHubSchema, NodeType, SchemaNode, ServerComponentRegistryItem } from "@labelhub/contracts";
import { createDefaultNode } from "@labelhub/schema-core";
import type { MaterialItem } from "./types";
import { prepareNodeForInsert } from "./node-operations";

export const defaultMaterials: MaterialItem[] = [
  { type: "show.text", label: "展示文本", description: "展示原文内容" },
  { type: "input.text", label: "单行文本", description: "填写短文本答案" },
  { type: "input.textarea", label: "多行文本", description: "填写长文本答案" },
  { type: "input.richtext", label: "富文本", description: "填写富文本答案" },
  { type: "choice.radio", label: "单选", description: "从选项中选择一个值" },
  { type: "choice.checkbox", label: "多选", description: "从选项中选择多个值" },
  { type: "choice.select", label: "下拉选择", description: "用下拉框选择一个值" },
  { type: "choice.tags", label: "标签", description: "选择多个标签值" },
  { type: "data.json", label: "JSON 数据", description: "填写结构化 JSON" },
  { type: "upload.file", label: "文件上传", description: "提交文件附件引用" },
  { type: "upload.image", label: "图片上传", description: "提交图片附件引用" },
  { type: "llm.assist", label: "AI 辅助", description: "调用后端 LLM Runtime 生成建议" },
  { type: "container.section", label: "章节", description: "组织一组节点" },
  { type: "container.group", label: "分组", description: "组织子节点" },
];

export function filterMaterialsByServerRegistry(
  materials: MaterialItem[],
  serverRegistry: ServerComponentRegistryItem[],
): MaterialItem[] {
  const supportedTypes = new Set(serverRegistry.map((item) => item.type));
  return materials.filter((material) => supportedTypes.has(material.type));
}

export function isMaterialSupported(type: NodeType, serverRegistry: ServerComponentRegistryItem[]): boolean {
  return serverRegistry.some((item) => item.type === type);
}

export function createNodeFromMaterial(schema: LabelHubSchema, type: NodeType): SchemaNode {
  return prepareNodeForInsert(schema, createDefaultNode(type));
}
