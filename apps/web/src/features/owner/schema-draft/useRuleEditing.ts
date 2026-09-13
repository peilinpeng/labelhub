import { useState, type Dispatch, type DragEvent, type MouseEvent, type SetStateAction } from "react";
import type { FieldNode, LabelHubSchema, NodeType } from "@labelhub/contracts";
import {
  appendNodeToRoot,
  appendShowItemField,
  createConditionRule,
  createValidationRule,
  friendlyFieldTitle,
  type ConditionRuleDraft,
  type NoticeTone,
  type ValidationRuleDraft,
} from "../schema-normalization";

const materialLabels = new Map<NodeType, string>([
  ["input.text", "单行输入"],
  ["input.textarea", "多行文本"],
  ["input.richtext", "富文本"],
  ["choice.radio", "单选"],
  ["choice.checkbox", "多选"],
  ["choice.tags", "标签选择"],
  ["upload.file", "文件上传"],
  ["upload.image", "图片上传"],
  ["data.json", "JSON 编辑器"],
  ["llm.assist", "LLM 交互组件"],
  ["show.text", "展示文本"],
  ["container.group", "分组容器"],
  ["container.tabs", "多 Tab 布局"],
]);

interface RuleEditingOptions {
  getFieldNodes: () => FieldNode[];
  setSchema: Dispatch<SetStateAction<LabelHubSchema>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  showNotice: (message: string | null, tone?: NoticeTone) => void;
}

export function useRuleEditing({ getFieldNodes, setSchema, setStatusMessage, showNotice }: RuleEditingOptions) {
  const [conditionRules, setConditionRules] = useState<ConditionRuleDraft[]>([]);
  const [validationRules, setValidationRules] = useState<ValidationRuleDraft[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dataFieldsOpen, setDataFieldsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const focusIssueNode = (nodeId: string | undefined) => {
    if (nodeId === undefined) return;
    const nodeCard = Array.from(document.querySelectorAll<HTMLElement>(".schema-node-card"))
      .find((element) => element.dataset.nodeId === nodeId);
    if (nodeCard === undefined) return;
    nodeCard.scrollIntoView({ behavior: "smooth", block: "center" });
    Array.from(nodeCard.querySelectorAll("button"))
      .find((button) => button.textContent?.trim().includes("选择"))
      ?.click();
  };

  const handleDesignerCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".schema-designer-preview__surface")) {
      setPreviewExpanded(true);
      return;
    }
    if (!(target instanceof HTMLElement) || target.closest("button, a, input, textarea, select, label")) return;
    const nodeCard = target.closest(".schema-node-card");
    if (!nodeCard) return;
    Array.from(nodeCard.querySelectorAll("button"))
      .find((button) => button.textContent?.trim().includes("选择"))
      ?.click();
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes("application/x-labelhub-node-type")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    }
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    const type = event.dataTransfer.getData("application/x-labelhub-node-type") as NodeType;
    if (!type) return;
    event.preventDefault();
    setDropActive(false);
    setSchema((current) => appendNodeToRoot(current, type));
    setStatusMessage(`已拖拽添加「${materialLabels.get(type) ?? type}」到画布`);
  };

  const addConditionRule = () => setConditionRules((current) => [...current, createConditionRule(getFieldNodes())]);
  const addValidationRule = () => setValidationRules((current) => [...current, createValidationRule(getFieldNodes())]);
  const handleAddShowItemField = (fieldName: string) => {
    setSchema((current) => appendShowItemField(current, fieldName));
    showNotice(`已把「${friendlyFieldTitle(fieldName)}」添加到模板（展示文本）。`, "success");
  };

  return {
    advancedOpen,
    conditionRules,
    dataFieldsOpen,
    dropActive,
    focusIssueNode,
    handleAddShowItemField,
    handleCanvasDragOver,
    handleCanvasDrop,
    handleDesignerCanvasClick,
    previewExpanded,
    setAdvancedOpen,
    setConditionRules,
    setDataFieldsOpen,
    setDropActive,
    setPreviewExpanded,
    setValidationRules,
    validationRules,
    addConditionRule,
    addValidationRule,
  };
}
