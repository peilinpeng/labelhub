import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { LabelHubSchema, Task } from "@labelhub/contracts";
import { createSchemaFromPreset, schemaPresetSummaries } from "../schemaPresetLibrary";
import {
  bindPresetToCurrentDraft,
  collectPublishConfigurationIssues,
  createBlankSchema,
  ensureNewsQualityPreviewFields,
  presetIdForSchema,
  presetIdForTask,
  readCustomSchemaPresets,
  resolveTaskId,
  summarizeSchemaFields,
  writeCustomSchemaPresets,
  type CustomSchemaPreset,
  type NoticeTone,
  type SchemaPresetOption,
} from "../schema-normalization";

interface PresetManagementOptions {
  loading: boolean;
  schema: LabelHubSchema;
  setSchema: Dispatch<SetStateAction<LabelHubSchema>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  showNotice: (message: string | null, tone?: NoticeTone) => void;
  task: Task | undefined;
  taskId: string | undefined;
}

export function usePresetManagement({
  loading,
  schema,
  setSchema,
  setStatusMessage,
  showNotice,
  task,
  taskId,
}: PresetManagementOptions) {
  const [activePresetId, setActivePresetId] = useState(() => presetIdForTask(taskId));
  const [customPresets, setCustomPresets] = useState<CustomSchemaPreset[]>(() => readCustomSchemaPresets());
  const [presetTitleInput, setPresetTitleInput] = useState("");
  const [presetDescriptionInput, setPresetDescriptionInput] = useState("");

  useEffect(() => {
    setActivePresetId(presetIdForSchema(schema));
    setPresetTitleInput(schema.root.title || schema.meta.name || "未命名预设模板");
    setPresetDescriptionInput(schema.meta.description || "");
  }, [loading, schema.schemaId]);

  const presetOptions = useMemo<SchemaPresetOption[]>(
    () => [
      ...schemaPresetSummaries.map((preset) => ({ ...preset, source: "built-in" as const })),
      ...customPresets.map((preset) => ({ ...preset, source: "custom" as const })),
    ],
    [customPresets],
  );
  const presetIssueCounts = useMemo(() => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    const taskTitle = task?.title ?? "当前任务";
    return new Map(presetOptions.map((preset) => {
      const presetSchema = preset.source === "custom"
        ? preset.schema
        : ensureNewsQualityPreviewFields(createSchemaFromPreset(preset.id, currentTaskId, taskTitle));
      const rebound = bindPresetToCurrentDraft(presetSchema, schema, currentTaskId, taskTitle);
      return [preset.id, collectPublishConfigurationIssues(rebound, currentTaskId).length] as const;
    }));
  }, [presetOptions, schema, task?.title, taskId]);

  const handleLoadPreset = (preset: SchemaPresetOption) => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    const taskTitle = task?.title ?? "当前任务";
    const nextSchema = preset.source === "custom"
      ? bindPresetToCurrentDraft(preset.schema, schema, currentTaskId, taskTitle)
      : bindPresetToCurrentDraft(
        ensureNewsQualityPreviewFields(createSchemaFromPreset(preset.id, currentTaskId, taskTitle)),
        schema,
        currentTaskId,
        taskTitle,
      );
    setActivePresetId(preset.id);
    setSchema(nextSchema);
    setPresetTitleInput(nextSchema.root.title || nextSchema.meta.name);
    setPresetDescriptionInput(nextSchema.meta.description || "");
    setStatusMessage(`已加载「${preset.title}」预设模板`);
    showNotice(`已将「${preset.title}」加载到当前任务「${taskTitle}」下，可继续在画布中调整字段。`, "info");
  };

  const handleCreateBlankPresetTemplate = () => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    const blankSchema = bindPresetToCurrentDraft(
      createBlankSchema(currentTaskId),
      schema,
      currentTaskId,
      task?.title ?? "当前任务",
    );
    setSchema(blankSchema);
    setActivePresetId(`custom_draft_${Date.now()}`);
    setPresetTitleInput("未命名预设模板");
    setPresetDescriptionInput("空白模板。");
    setStatusMessage("已创建空白预设模板起点");
    showNotice("已创建空白模板。请先填写预设名称和说明，再配置画布。", "info");
  };

  const handlePresetTitleChange = (title: string) => {
    setPresetTitleInput(title);
    const resolvedTitle = title.trim() || "未命名预设模板";
    setSchema((current) => ({
      ...current,
      meta: { ...current.meta, name: resolvedTitle, updatedAt: new Date().toISOString() },
      root: { ...current.root, title: resolvedTitle },
    }));
  };

  const handlePresetDescriptionChange = (description: string) => {
    setPresetDescriptionInput(description);
    setSchema((current) => ({
      ...current,
      meta: { ...current.meta, description, updatedAt: new Date().toISOString() },
    }));
  };

  const handleSaveAsPreset = () => {
    const title = presetTitleInput.trim() || schema.root.title || schema.meta.name || "未命名预设模板";
    const description = presetDescriptionInput.trim() || schema.meta.description || "由当前模板另存的预设。";
    const savedPreset: CustomSchemaPreset = {
      id: `custom_preset_${Date.now()}`,
      title,
      description,
      fields: summarizeSchemaFields(schema),
      schema,
      createdAt: new Date().toISOString(),
    };
    const nextPresets = [savedPreset, ...customPresets];
    setCustomPresets(nextPresets);
    writeCustomSchemaPresets(nextPresets);
    setActivePresetId(savedPreset.id);
    showNotice(`已将「${title}」另存为预设模板，可在常用预设模板中直接加载。`, "success");
  };

  return {
    activePresetId,
    handleCreateBlankPresetTemplate,
    handleLoadPreset,
    handlePresetDescriptionChange,
    handlePresetTitleChange,
    handleSaveAsPreset,
    presetDescriptionInput,
    presetIssueCounts,
    presetOptions,
    presetTitleInput,
    setActivePresetId,
    setPresetDescriptionInput,
    setPresetTitleInput,
  };
}
