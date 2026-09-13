import { useState, type Dispatch, type SetStateAction } from "react";
import type { LabelHubSchema, Task } from "@labelhub/contracts";
import { generateSchema } from "../../../api/owner";
import {
  buildSelectedSchemaDraft,
  isAnswerFieldType,
  normalizeGeneratedSchemaDraft,
  resolveTaskId,
  type AiSchemaDraftPreview,
  type DataFieldInfo,
  type NoticeTone,
} from "../schema-normalization";

interface AiSchemaDraftOptions {
  datasetFields: DataFieldInfo[];
  schema: LabelHubSchema;
  setActivePresetId: Dispatch<SetStateAction<string>>;
  setPresetDescriptionInput: Dispatch<SetStateAction<string>>;
  setPresetTitleInput: Dispatch<SetStateAction<string>>;
  setSchema: Dispatch<SetStateAction<LabelHubSchema>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  showNotice: (message: string | null, tone?: NoticeTone) => void;
  task: Task | undefined;
  taskId: string | undefined;
}

export function useAiSchemaDraft({
  datasetFields,
  schema,
  setActivePresetId,
  setPresetDescriptionInput,
  setPresetTitleInput,
  setSchema,
  setStatusMessage,
  showNotice,
  task,
  taskId,
}: AiSchemaDraftOptions) {
  const [aiSchemaOpen, setAiSchemaOpen] = useState(false);
  const [aiSchemaPrompt, setAiSchemaPrompt] = useState("");
  const [aiSchemaGenerating, setAiSchemaGenerating] = useState(false);
  const [aiSchemaError, setAiSchemaError] = useState<string | null>(null);
  const [aiSchemaPreview, setAiSchemaPreview] = useState<AiSchemaDraftPreview | null>(null);
  const [aiSchemaSelectedIds, setAiSchemaSelectedIds] = useState<Set<string>>(() => new Set());

  const openAiSchemaDraft = () => {
    setAiSchemaOpen(true);
    setAiSchemaError(null);
    setAiSchemaPreview(null);
    setAiSchemaSelectedIds(new Set());
    if (aiSchemaPrompt.trim().length === 0) {
      setAiSchemaPrompt(task?.description?.trim() || task?.title || schema.meta.description || "");
    }
  };

  const closeAiSchemaDraft = () => {
    if (!aiSchemaGenerating) setAiSchemaOpen(false);
  };

  const handleGenerateAiSchemaDraft = async () => {
    const description = aiSchemaPrompt.trim();
    if (description.length === 0) {
      setAiSchemaError("请先描述你想标注什么，以及希望标注员填写哪些内容。");
      return;
    }
    try {
      setAiSchemaGenerating(true);
      setAiSchemaError(null);
      setAiSchemaPreview(null);
      setAiSchemaSelectedIds(new Set());
      const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
      const result = await generateSchema(currentTaskId, {
        taskDescription: description,
        preferredNodeTypes: ["show.text", "choice.radio", "choice.checkbox", "input.textarea"],
      });
      const normalized = normalizeGeneratedSchemaDraft(
        result.schemaDraft,
        schema,
        currentTaskId,
        task?.title ?? schema.meta.name,
        description,
        datasetFields.map((field) => field.name),
      );
      setAiSchemaPreview({
        schema: normalized,
        validation: result.validation,
        warnings: result.warnings ?? [],
        generatedBy: result.generatedBy,
      });
      setAiSchemaSelectedIds(new Set(normalized.root.children.map((node) => node.id)));
    } catch (error) {
      console.error("AI Schema Draft 生成失败", error);
      setAiSchemaError("AI 生成失败，请稍后重试。当前手动配置不受影响。");
    } finally {
      setAiSchemaGenerating(false);
    }
  };

  const handleApplyAiSchemaDraft = () => {
    if (aiSchemaPreview === null || aiSchemaSelectedIds.size === 0) return;
    const selectedSchema = buildSelectedSchemaDraft(aiSchemaPreview.schema, aiSchemaSelectedIds);
    setSchema(selectedSchema);
    setActivePresetId(`ai_schema_draft_${Date.now()}`);
    setPresetTitleInput(selectedSchema.meta.name || "AI 生成模板草稿");
    setPresetDescriptionInput(selectedSchema.meta.description ?? aiSchemaPrompt.trim());
    setStatusMessage(`已应用 AI 生成的 ${selectedSchema.root.children.length} 项节点，保存草稿前不会写入后端。`);
    setAiSchemaOpen(false);
    showNotice("已应用所选 AI 生成节点。请检查字段后手动保存草稿。", "info");
  };

  const selectableNodes = aiSchemaPreview?.schema.root.children ?? [];
  const handleAiSchemaSelectAll = () => setAiSchemaSelectedIds(new Set(selectableNodes.map((node) => node.id)));
  const handleAiSchemaSelectAnswerFields = () => {
    setAiSchemaSelectedIds(new Set(selectableNodes.filter((node) => isAnswerFieldType(node.type)).map((node) => node.id)));
  };
  const handleAiSchemaClearSelection = () => setAiSchemaSelectedIds(new Set());
  const toggleAiSchemaNode = (nodeId: string) => {
    setAiSchemaSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return {
    aiSchemaError,
    aiSchemaGenerating,
    aiSchemaOpen,
    aiSchemaPreview,
    aiSchemaPrompt,
    aiSchemaSelectedIds,
    closeAiSchemaDraft,
    handleAiSchemaClearSelection,
    handleAiSchemaSelectAll,
    handleAiSchemaSelectAnswerFields,
    handleApplyAiSchemaDraft,
    handleGenerateAiSchemaDraft,
    openAiSchemaDraft,
    setAiSchemaError,
    setAiSchemaGenerating,
    setAiSchemaOpen,
    setAiSchemaPreview,
    setAiSchemaPrompt,
    setAiSchemaSelectedIds,
    toggleAiSchemaNode,
  };
}
