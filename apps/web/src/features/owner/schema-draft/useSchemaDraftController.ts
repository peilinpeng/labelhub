import { useEffect } from "react";
import { useParams } from "react-router";
import type { Role } from "../../../app/routes";
import type { NoticeTone } from "../schema-normalization";
import { useAiSchemaDraft } from "./useAiSchemaDraft";
import { useInitialSchemaData } from "./useInitialSchemaData";
import { usePresetManagement } from "./usePresetManagement";
import { useRuleEditing } from "./useRuleEditing";
import { useSchemaAudit } from "./useSchemaAudit";
import { useSchemaPersistence, useSchemaPersistenceActions } from "./useSchemaPersistence";
import { useSchemaReadiness } from "./useSchemaReadiness";

export function useSchemaDraftController(role: Role) {
  const { taskId } = useParams<{ taskId: string }>();
  const {
    boundVersionNo,
    publishFailureDetails,
    publishIssueListRef,
    publishNotice,
    publishNoticeTone,
    publishing,
    publishPreview,
    publishPreviewOpen,
    publishPreviewPreparing,
    saving,
    setBoundVersionNo,
    setPublishFailureDetails,
    setPublishNotice,
    setPublishNoticeTone,
    setPublishing,
    setPublishPreview,
    setPublishPreviewOpen,
    setPublishPreviewPreparing,
    setSaving,
    setVersionRefreshKey,
    versionRefreshKey,
  } = useSchemaPersistence();
  const {
    aiConfigEnabled,
    aiConfigStatus,
    datasetFields,
    datasetItemStats,
    loading,
    resolvedTaskId: resolvedAuditTaskId,
    schema,
    serverRegistry,
    setSchema,
    setStatusMessage,
    setTask,
    statusMessage,
    task,
    taskStats,
    taskStatsLoaded,
  } = useInitialSchemaData(taskId, versionRefreshKey);
  const {
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
  } = usePresetManagement({
    loading,
    schema,
    setSchema,
    setStatusMessage,
    showNotice,
    task,
    taskId,
  });
  const {
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
  } = useRuleEditing({
    getFieldNodes: () => fieldNodes,
    setSchema,
    setStatusMessage,
    showNotice,
  });
  const {
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
    setAiSchemaPrompt,
    toggleAiSchemaNode,
  } = useAiSchemaDraft({
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
  });
  const { auditError, auditEvents, auditLoading, loadAuditTimeline } = useSchemaAudit(
    resolvedAuditTaskId,
    versionRefreshKey,
  );

  useEffect(() => {
    if (!previewExpanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewExpanded]);

  const {
    aiReady,
    basicReady,
    distributionReady,
    fieldNodes,
    hasAvailableDataset,
    hasDataset,
    nodeErrorMap,
    publishBlockedByAiConfig,
    publishBlockedByDataset,
    publishConfigurationIssues,
    publishReadinessItems,
    publishValidationResult,
    sampleContext,
    setupSteps,
    templateReady,
    templateStatus,
    templateTitle,
    validationSummary,
  } = useSchemaReadiness({
    aiConfigEnabled,
    aiConfigStatus,
    datasetItemStats,
    publishNotice,
    role,
    schema,
    task,
    taskId,
    taskStats,
    taskStatsLoaded,
    resolvedAuditTaskId,
  });

  const {
    exportSchemaJson,
    handleConfirmPublishPreview,
    handleCopyVersionToDraft,
    handlePublish,
    handleRollbackToVersion,
    handleSaveDraft,
  } = useSchemaPersistenceActions({
    aiConfigStatus,
    aiReady,
    basicReady,
    distributionReady,
    hasAvailableDataset,
    hasDataset,
    loading,
    publishConfigurationIssues,
    publishIssueListRef,
    publishPreview,
    publishValidationResult,
    schema,
    setActivePresetId,
    setPublishFailureDetails,
    setPublishing,
    setPublishPreview,
    setPublishPreviewOpen,
    setPublishPreviewPreparing,
    setSaving,
    setSchema,
    setStatusMessage,
    setTask,
    setVersionRefreshKey,
    showNotice,
    task,
    taskId,
    taskStatsLoaded,
  });

  // 统一的页面提示出口：区分成功 / 失败 / 中性，避免失败提示仍显示成功样式。
  function showNotice(message: string | null, tone: NoticeTone = "info"): void {
    setPublishNotice(message);
    if (message !== null) setPublishNoticeTone(tone);
    if (tone !== "danger") setPublishFailureDetails([]);
  }

  return {
    taskId, schema, setSchema, task, loading, saving, publishing, publishPreviewPreparing,
    publishNotice, publishIssueListRef, publishNoticeTone, publishFailureDetails,
    previewExpanded, setPreviewExpanded, publishPreviewOpen, setPublishPreviewOpen, publishPreview,
    versionRefreshKey, boundVersionNo, setBoundVersionNo,
    auditEvents, auditLoading, auditError, loadAuditTimeline,
    activePresetId, presetOptions, presetIssueCounts, presetTitleInput, presetDescriptionInput,
    conditionRules, setConditionRules, validationRules, setValidationRules,
    advancedOpen, setAdvancedOpen, dataFieldsOpen, setDataFieldsOpen, datasetFields,
    aiSchemaOpen, aiSchemaPrompt, setAiSchemaPrompt, aiSchemaGenerating, aiSchemaError,
    aiSchemaPreview, aiSchemaSelectedIds, serverRegistry, statusMessage, taskStatsLoaded,
    fieldNodes, templateTitle, templateStatus, setupSteps, publishReadinessItems,
    publishBlockedByDataset, publishBlockedByAiConfig, publishConfigurationIssues,
    nodeErrorMap, validationSummary, hasDataset, templateReady, resolvedAuditTaskId,
    sampleContext, dropActive, setDropActive, publishValidationResult,
    handleSaveDraft, exportSchemaJson, handleCopyVersionToDraft, handleRollbackToVersion,
    handlePublish, handleConfirmPublishPreview, focusIssueNode, handleDesignerCanvasClick,
    handleLoadPreset, handleCreateBlankPresetTemplate, openAiSchemaDraft, closeAiSchemaDraft,
    handleGenerateAiSchemaDraft, handleApplyAiSchemaDraft, handleAiSchemaSelectAll,
    handleAiSchemaSelectAnswerFields, handleAiSchemaClearSelection, toggleAiSchemaNode,
    handlePresetTitleChange, handlePresetDescriptionChange, handleSaveAsPreset,
    handleCanvasDragOver, handleCanvasDrop, addConditionRule, addValidationRule,
    handleAddShowItemField,
  };
}
