import type { ReviewDetailResponse } from "@labelhub/contracts";

// 只用于没有名称元数据的历史响应。自定义维度必须读取服务端配置。
const LEGACY_LABELS: Readonly<Record<string, string>> = {
  relevance: "内容相关性", accuracy: "内容准确性", compliance: "格式合规性",
  safety: "安全性", completeness: "完整性", readability: "可读性",
  content_accuracy: "内容准确性", format_compliance: "格式合规性",
  factuality: "事实准确性", category: "分类一致性", evidence: "证据充分性", format: "格式规范性",
};

export function dimensionLabel(key: string, dimensions?: ReviewDetailResponse["reviewDimensions"]): string {
  const configured = dimensions?.find((dimension) => dimension.key === key)?.label?.trim();
  if (configured) return configured;
  if (Object.hasOwn(LEGACY_LABELS, key)) return LEGACY_LABELS[key];
  return key.trim() || "未提供维度名称";
}
