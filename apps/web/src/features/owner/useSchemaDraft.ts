import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { collectFieldNodes } from "@labelhub/schema-core";
import type {
  AuditEventRecord,
  LabelHubSchema,
  NodeType,
  SchemaValidationError,
  SchemaValidationResult,
  ServerComponentRegistryItem,
  Task,
} from "@labelhub/contracts";
import { Role } from "../../app/routes";
import {
  fetchSchemaDraft,
  fetchServerRegistry,
  fetchTask,
  fetchTaskStats,
  generateSchema,
  publishSchema,
  publishTask,
  saveSchemaDraft,
  type SchemaVersionHistoryItem,
  type TaskStats,
} from "../../api/owner";
import { queryAuditEvents } from "../../api/audit";
import { listItems } from "../../api/dataset";
import { getReviewConfig } from "../../api/reviewer";
import {
  appendPublishPreviewAuditEvents,
  appendPublishRequestedAuditEvent,
  appendSchemaPublishedAuditEvent,
  appendSchemaPublishFailedAuditEvent,
  type OwnerPublishFailureStage,
} from "./audit-events";
import { localServerComponentRegistry } from "./localComponentRegistry";
import { createSchemaFromPreset, schemaPresetSummaries } from "./schemaPresetLibrary";
import {
  appendNodeToRoot,
  appendShowItemField,
  bindPresetToCurrentDraft,
  buildPublishPreview,
  buildSelectedSchemaDraft,
  collectDataFields,
  collectPublishConfigurationIssues,
  createBlankSchema,
  createConditionRule,
  createFallbackSchema,
  createOwnerPublishAuditPreview,
  createPublishValidationResult,
  createSampleContext,
  createValidationRule,
  ensureNewsQualityPreviewFields,
  friendlyFieldTitle,
  getPublishFailureMessage,
  getPublishFailureSuggestions,
  isAnswerFieldType,
  isDistributionReady,
  normalizeGeneratedSchemaDraft,
  presetIdForSchema,
  presetIdForTask,
  readCustomSchemaPresets,
  readPublishedSchemaVersionId,
  readPublishedSchemaVersionNo,
  resolveTaskId,
  schemaRevisionLabel,
  summarizeSchemaFields,
  writeCustomSchemaPresets,
  type AiSchemaDraftPreview,
  type ConditionRuleDraft,
  type CustomSchemaPreset,
  type DataFieldInfo,
  type NoticeTone,
  type PublishPreviewState,
  type SchemaPresetOption,
  type ValidationRuleDraft,
} from "./schema-normalization";
import { buildTaskSetupSteps, type ReadinessItem } from "./TaskSetupGuide";

interface QuickMaterial {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
}

const quickMaterials: QuickMaterial[] = [
  { type: "input.text", label: "单行输入", description: "基础短文本采集", icon: "Aa" },
  { type: "input.textarea", label: "多行文本", description: "长文本答案", icon: "Tx" },
  { type: "input.richtext", label: "富文本", description: "长文本带格式", icon: "R" },
  { type: "choice.radio", label: "单选", description: "枚举类标注", icon: "O" },
  { type: "choice.checkbox", label: "多选", description: "多枚举选择", icon: "Ck" },
  { type: "choice.tags", label: "标签选择", description: "多标签标注", icon: "#" },
  { type: "upload.file", label: "文件上传", description: "多媒体素材", icon: "Up" },
  { type: "upload.image", label: "图片上传", description: "图片素材", icon: "Img" },
  { type: "data.json", label: "JSON 编辑器", description: "结构化数据", icon: "{}" },
  { type: "llm.assist", label: "LLM 交互组件", description: "模型建议/预填", icon: "AI" },
  { type: "show.text", label: "展示文本", description: "原始数据展示", icon: "Show" },
  { type: "container.group", label: "分组容器", description: "组织字段", icon: "Grp" },
  { type: "container.tabs", label: "多 Tab 布局", description: "分 Tab 组织内容", icon: "Tab" },
];

export function useSchemaDraft(role: Role) {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // 从 AI 预审页「下一步：发布任务」带 ?publish=1 进入时，自动触发发布前检查（只触发一次）。
  const autoPublishTriggeredRef = useRef(false);
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>(localServerComponentRegistry);
  const [schema, setSchema] = useState<LabelHubSchema>(() => createFallbackSchema(taskId));
  const [task, setTask] = useState<Task | undefined>();
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [datasetItemStats, setDatasetItemStats] = useState<{ total: number; available: number } | null>(null);
  // 数据字段面板：从已导入数据派生的字段列表 + Drawer 开关（轻量 Owner 体验优化，纯前端）
  const [datasetFields, setDatasetFields] = useState<DataFieldInfo[]>([]);
  const [dataFieldsOpen, setDataFieldsOpen] = useState(false);
  const [taskStatsLoaded, setTaskStatsLoaded] = useState(false);
  const [aiConfigStatus, setAiConfigStatus] = useState<"loading" | "configured" | "missing" | "error">("loading");
  const [aiConfigEnabled, setAiConfigEnabled] = useState<boolean | null>(null);
  const [, setValidation] = useState<SchemaValidationResult | undefined>();
  const [statusMessage, setStatusMessage] = useState("正在加载模板编辑器");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [publishNoticeTone, setPublishNoticeTone] = useState<NoticeTone>("info");
  const [publishFailureDetails, setPublishFailureDetails] = useState<string[]>([]);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [publishPreviewOpen, setPublishPreviewOpen] = useState(false);
  const [publishPreview, setPublishPreview] = useState<PublishPreviewState | undefined>();
  const [publishPreviewPreparing, setPublishPreviewPreparing] = useState(false);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  // 任务当前绑定（已发布）的版本号，由 SchemaVersionPanel 在加载真实版本历史后回传。
  // 仅用于状态条显化，null 表示尚未发布版本或无法解析，不伪造版本号。
  const [boundVersionNo, setBoundVersionNo] = useState<number | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState(() => presetIdForTask(taskId));
  const [dropActive, setDropActive] = useState(false);
  const [conditionRules, setConditionRules] = useState<ConditionRuleDraft[]>([]);
  const [validationRules, setValidationRules] = useState<ValidationRuleDraft[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customPresets, setCustomPresets] = useState<CustomSchemaPreset[]>(() => readCustomSchemaPresets());
  const [presetTitleInput, setPresetTitleInput] = useState("");
  const [presetDescriptionInput, setPresetDescriptionInput] = useState("");
  const [aiSchemaOpen, setAiSchemaOpen] = useState(false);
  const [aiSchemaPrompt, setAiSchemaPrompt] = useState("");
  const [aiSchemaGenerating, setAiSchemaGenerating] = useState(false);
  const [aiSchemaError, setAiSchemaError] = useState<string | null>(null);
  const [aiSchemaPreview, setAiSchemaPreview] = useState<AiSchemaDraftPreview | null>(null);
  // 选择性导入：记录预览里被勾选的「顶层」节点 id。group/section 作为整体勾选，不做父子联动。
  const [aiSchemaSelectedIds, setAiSchemaSelectedIds] = useState<Set<string>>(() => new Set());
  const publishIssueListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);

    void (async () => {
      try {
        setLoading(true);
        const [registryResult, taskResult, draftResult] = await Promise.allSettled([
          fetchServerRegistry(),
          fetchTask(currentTaskId),
          fetchSchemaDraft(currentTaskId),
        ]);

        if (cancelled) return;

        if (registryResult.status === "fulfilled" && registryResult.value.length > 0) {
          setServerRegistry(registryResult.value);
        } else {
          setServerRegistry(localServerComponentRegistry);
        }

        const resolvedTask =
          taskResult.status === "fulfilled"
            ? taskResult.value
            : undefined;
        setTask(resolvedTask);

        if (draftResult.status === "fulfilled") {
          setSchema(ensureNewsQualityPreviewFields(draftResult.value));
          setActivePresetId(presetIdForSchema(draftResult.value));
          setStatusMessage("已加载模板草稿");
        } else if (resolvedTask !== undefined) {
          const fallbackSchema = createFallbackSchema(currentTaskId, resolvedTask?.title);
          // 未读取到草稿时，默认把上一步「新建任务」的标题与说明带入模板名称/说明，
          // 方便 Owner 直接发布；后续点击「一键配置模版」套预设时由 handleLoadPreset 覆盖。
          const prefilledSchema: LabelHubSchema = {
            ...fallbackSchema,
            meta: {
              ...fallbackSchema.meta,
              name: resolvedTask.title || fallbackSchema.meta.name,
              description: resolvedTask.description || fallbackSchema.meta.description,
            },
            root: {
              ...fallbackSchema.root,
              title: resolvedTask.title || fallbackSchema.root.title,
            },
          };
          setSchema(prefilledSchema);
          // 预设高亮仍按原始 fallback 判定，避免改了名称后匹配不到内置预设。
          setActivePresetId(presetIdForSchema(fallbackSchema));
          setStatusMessage("未读取到模板草稿，已带入任务标题与说明作为起点");
        } else {
          setStatusMessage("任务或模板草稿加载失败，请检查后端服务。");
        }
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : "模板编辑器加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const resolvedAuditTaskId = resolveTaskId(taskId, schema.meta.taskId);

  useEffect(() => {
    let cancelled = false;
    setTaskStatsLoaded(false);
    setDatasetItemStats(null);
    setAiConfigStatus("loading");
    setAiConfigEnabled(null);

    void (async () => {
      const [statsResult, itemsResult, configResult] = await Promise.allSettled([
        fetchTaskStats(resolvedAuditTaskId),
        listItems(resolvedAuditTaskId, 1, 200),
        getReviewConfig(resolvedAuditTaskId),
      ]);
      if (cancelled) return;

      if (statsResult.status === "fulfilled") {
        setTaskStats(statsResult.value);
      } else {
        setTaskStats(null);
      }

      if (itemsResult.status === "fulfilled") {
        setDatasetItemStats({
          total: itemsResult.value.total,
          available: itemsResult.value.items.filter((item) => item.status === "AVAILABLE").length,
        });
        setDatasetFields(collectDataFields(itemsResult.value.items));
      } else {
        setDatasetItemStats(null);
        setDatasetFields([]);
      }
      setTaskStatsLoaded(true);

      if (configResult.status === "fulfilled") {
        setAiConfigStatus("configured");
        setAiConfigEnabled(configResult.value.enabled);
      } else {
        const message = configResult.reason instanceof Error ? configResult.reason.message : "";
        setAiConfigStatus(message.includes("404") || message.includes("尚未配置") ? "missing" : "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedAuditTaskId, versionRefreshKey]);

  // 读取当前任务的 schema 治理审计事件（草稿保存、兼容性检查、阻断、废弃、发布等），只读展示。
  const loadAuditTimeline = async (): Promise<void> => {
    try {
      setAuditLoading(true);
      setAuditError(null);
      const response = await queryAuditEvents({ taskId: resolvedAuditTaskId, entityType: "SCHEMA", limit: 50 });
      setAuditEvents(response.events);
    } catch (error) {
      console.warn("Owner schema 审计日志加载失败", error);
      setAuditError("审计日志加载失败，请稍后刷新重试。");
    } finally {
      setAuditLoading(false);
    }
  };

  // 首次进入与每次发布/回滚后（versionRefreshKey 变化）刷新审计时间线。
  useEffect(() => {
    void loadAuditTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedAuditTaskId, versionRefreshKey]);

  useEffect(() => {
    setPresetTitleInput(schema.root.title || schema.meta.name || "未命名预设模板");
    setPresetDescriptionInput(schema.meta.description || "");
  }, [schema.schemaId]);

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

  const sampleContext = useMemo(() => createSampleContext(schema, task, role), [role, schema, task]);
  const fieldNodes = useMemo(() => collectFieldNodes(schema), [schema]);
  const templateTitle = schema.meta.name;
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

  // 模板状态人话化：草稿 / 已发布 / 有未发布修改。仅依据真实 schema.status 与
  // task.activeSchemaVersionId 推导，数据不足时退回「本地编辑草稿」，不伪造已发布。
  const templateStatus = useMemo<{ label: string; tone: "success" | "warning" | "primary"; hint: string }>(() => {
    if (schema.status === "PUBLISHED") {
      return { label: "已发布", tone: "success", hint: `当前版本 ${schemaRevisionLabel(schema)}，可用于任务分发与标注。` };
    }
    if (task?.activeSchemaVersionId) {
      return { label: "有未发布修改", tone: "warning", hint: "已存在发布版本，当前为草稿修改，发布后才会对标注员生效。" };
    }
    return { label: "草稿", tone: "primary", hint: "当前模板状态来自本地编辑草稿，保存草稿不等于发布。" };
  }, [schema, task]);

  const publishConfigurationIssues = useMemo(
    () => collectPublishConfigurationIssues(schema, task?.id ?? taskId),
    [schema, task?.id, taskId],
  );
  const publishValidationResult = useMemo(
    () => createPublishValidationResult(schema, publishConfigurationIssues),
    [schema, publishConfigurationIssues],
  );
  const datasetImportedCount = Math.max(taskStats?.datasetTotal ?? 0, datasetItemStats?.total ?? 0);
  const datasetAvailableCount = Math.max(taskStats?.datasetAvailable ?? 0, datasetItemStats?.available ?? 0);
  const hasDataset = datasetImportedCount > 0;
  const hasAvailableDataset = datasetAvailableCount > 0;
  const templateReady = publishValidationResult.valid && publishConfigurationIssues.length === 0 && fieldNodes.length > 0;
  const aiReady = aiConfigStatus === "configured";
  const basicReady = Boolean(task?.title?.trim()) && (task?.quota.total ?? 0) > 0;
  const distributionReady = task === undefined ? false : isDistributionReady(task);
  const setupSteps = buildTaskSetupSteps({
    taskId: resolvedAuditTaskId,
    currentStep: "template",
    basicReady,
    hasData: hasDataset,
    templateReady,
    aiReady,
    distributionReady,
    dataMeta: taskStatsLoaded
      ? hasDataset
        ? `已导入 ${datasetImportedCount} 条，可领取 ${datasetAvailableCount} 条`
        : "还未导入数据"
      : "正在读取数据状态",
    templateMeta: templateReady ? "模板检查已通过" : "模板配置待完成",
    aiMeta: aiReady ? (aiConfigEnabled ? "AI 预审已启用" : "已明确不启用 AI 预审") : "待配置规则",
  });
  const publishReadinessItems = useMemo<ReadinessItem[]>(() => [
    {
      key: "basic",
      label: "基础信息",
      state: basicReady ? "done" : "error",
      detail: basicReady ? "任务名称、配额和基础设置已填写。" : "发布前需要补齐任务名称、配额等基础信息。",
      href: `/owner/tasks/${resolvedAuditTaskId}`,
      actionLabel: "查看基础信息",
    },
    {
      key: "data",
      label: "数据管理",
      state: hasDataset && hasAvailableDataset ? "done" : "error",
      detail: taskStatsLoaded
        ? hasDataset
          ? hasAvailableDataset
            ? `已导入 ${datasetImportedCount} 条，其中 ${datasetAvailableCount} 条可领取。`
            : `已导入 ${datasetImportedCount} 条，但暂无可领取数据。`
          : "发布前需要先导入标注数据。"
        : "正在读取数据导入状态。",
      href: `/owner/tasks/${resolvedAuditTaskId}/data`,
      actionLabel: "去导入数据",
    },
    {
      key: "template",
      label: "模板配置",
      state: templateReady ? "done" : "error",
      detail: templateReady ? "模板检查已通过，可以进入下一步。" : "发布前需要完成标注模板配置。",
      href: `/owner/tasks/${resolvedAuditTaskId}/designer`,
      actionLabel: "去配置模板",
    },
    {
      key: "ai",
      label: "AI 预审",
      state: aiReady ? "done" : "error",
      detail: aiReady
        ? (aiConfigEnabled ? "AI 预审已启用。" : "已明确选择不启用 AI 预审。")
        : "发布前需要配置 AI 预审规则，或明确选择不启用 AI 预审。",
      href: `/owner/tasks/${resolvedAuditTaskId}/ai-precheck`,
      actionLabel: "去配置 AI 预审",
    },
    {
      key: "distribution",
      label: "分发设置",
      state: distributionReady ? "done" : "error",
      detail: distributionReady ? "分发策略和配额已满足发布要求。" : "分发策略或配额设置不完整。",
      href: `/owner/tasks/${resolvedAuditTaskId}`,
      actionLabel: "查看分发设置",
    },
  ], [
    aiConfigEnabled,
    aiReady,
    basicReady,
    datasetAvailableCount,
    datasetImportedCount,
    distributionReady,
    hasAvailableDataset,
    hasDataset,
    resolvedAuditTaskId,
    taskStatsLoaded,
    templateReady,
  ]);
  const publishBlockedByDataset =
    publishNotice?.includes("导入标注数据") ||
    publishNotice?.includes("数据管理") ||
    publishNotice?.includes("可领取数据") ||
    false;
  const publishBlockedByAiConfig = publishNotice?.includes("AI 预审") ?? false;
  const nodeErrorMap = useMemo<Record<string, string[]>>(() => {
    const result: Record<string, string[]> = {};
    for (const issue of publishConfigurationIssues) {
      if (issue.nodeId === undefined) continue;
      result[issue.nodeId] = [...(result[issue.nodeId] ?? []), issue.badge];
    }
    return result;
  }, [publishConfigurationIssues]);

  // 发布前的本地自检结果人话化：只展示可读 message（必要时带字段标题），不暴露 code / path / 原始对象。
  const validationSummary = useMemo<{ tone: "success" | "warning" | "danger"; badge: string; errors: string[]; warnings: string[] }>(() => {
    const titleByNodeId = new Map(fieldNodes.map((field) => [field.id, field.title || field.name]));
    const toText = (issue: SchemaValidationError): string => {
      const fieldTitle = issue.nodeId !== undefined ? titleByNodeId.get(issue.nodeId) : undefined;
      return fieldTitle ? `「${fieldTitle}」${issue.message}` : issue.message;
    };
    const errors = publishConfigurationIssues.map((issue) => `${issue.message} ${issue.suggestion}`);
    const warnings = publishValidationResult.warnings.map(toText);
    if (errors.length > 0) {
      return { tone: "danger", badge: "暂不可发布", errors, warnings };
    }
    return { tone: warnings.length > 0 ? "warning" : "success", badge: warnings.length > 0 ? "可发布 · 有提醒" : "可以发布", errors, warnings };
  }, [fieldNodes, publishConfigurationIssues, publishValidationResult.warnings]);

  // 统一的页面提示出口：区分成功 / 失败 / 中性，避免失败提示仍显示成功样式。
  const showNotice = (message: string | null, tone: NoticeTone = "info"): void => {
    setPublishNotice(message);
    if (message !== null) setPublishNoticeTone(tone);
    if (tone !== "danger") setPublishFailureDetails([]);
  };

  const handleSaveDraft = async (): Promise<void> => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    try {
      setSaving(true);
      const response = await saveSchemaDraft(currentTaskId, {
        schema,
        baseSchemaDraftRevision: schema.schemaDraftRevision,
      });
      setSchema(response.schema);
      setValidation(response.validation);
      setStatusMessage(`草稿已保存，版本 ${response.schemaDraftRevision}`);
      showNotice("模板草稿已保存。", "success");
    } catch (error) {
      console.error("Owner 模板草稿保存失败", error);
      setStatusMessage("草稿保存失败，当前修改仍保留在本页。");
      const message = getPublishFailureMessage(error, "SAVE_DRAFT");
      setPublishFailureDetails(getPublishFailureSuggestions(error, "SAVE_DRAFT"));
      showNotice(message, "danger");
    } finally {
      setSaving(false);
    }
  };

  const exportSchemaJson = () => {
    const fileName = `${schema.meta.name || "labelhub-schema"}.json`;
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    showNotice("Schema JSON 已导出。", "success");
  };

  const confirmPublish = async (preview: PublishPreviewState | undefined): Promise<void> => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    let failureStage: OwnerPublishFailureStage = "SAVE_DRAFT";
    try {
      setSaving(true);
      setPublishing(true);
      showNotice(null);
      if (preview !== undefined) {
        await appendPublishRequestedAuditEvent(createOwnerPublishAuditPreview(schema, task, preview));
      }

      failureStage = "SAVE_DRAFT";
      const draftResponse = await saveSchemaDraft(currentTaskId, {
        schema,
        baseSchemaDraftRevision: schema.schemaDraftRevision,
      });
      setSchema(draftResponse.schema);
      setValidation(draftResponse.validation);

      failureStage = "PUBLISH_SCHEMA";
      const published = await publishSchema(currentTaskId, draftResponse.schemaDraftRevision);
      const schemaVersionId = readPublishedSchemaVersionId(published.schemaVersion, draftResponse.schema.schemaVersionId);
      await appendSchemaPublishedAuditEvent({
        schema: draftResponse.schema,
        task,
        schemaVersionId,
        schemaVersionNo: readPublishedSchemaVersionNo(published.schemaVersion, draftResponse.schema.schemaVersionNo),
      });

      failureStage = "PUBLISH_TASK";
      // publishTask 合法迁移仅 ('DRAFT','publishTask')：DRAFT 任务发布后进入任务市场；
      // 已发布/暂停等任务再次绑定会被状态机拒绝——这是版本冻结的预期行为，不算发布失败。
      // 新模板版本已通过上一步 publishSchema 入历史，已发布任务保留原绑定（与“复制为新草稿/回滚”一致）。
      if (task && task.status !== "DRAFT") {
        setVersionRefreshKey((key) => key + 1);
        showNotice(
          "模板新版本已发布并入版本历史。该任务已是发布状态，按版本冻结策略保留原绑定；如需启用新版本，请在“版本管理”中操作。",
          "success",
        );
      } else {
        const publishedTask = await publishTask(currentTaskId, { schemaVersionId });
        setTask(publishedTask.task);
        setVersionRefreshKey((key) => key + 1);
        showNotice("发布成功，任务已进入任务市场。", "success");
      }
    } catch (error) {
      console.error("Owner 模板发布失败", error);
      await appendSchemaPublishFailedAuditEvent({
        schema,
        task,
        stage: failureStage,
        error,
      });
      const message = getPublishFailureMessage(error, failureStage);
      setPublishFailureDetails(getPublishFailureSuggestions(error, failureStage));
      setStatusMessage(message);
      showNotice(message, failureStage === "PUBLISH_TASK" ? "info" : "danger");
    } finally {
      setPublishing(false);
      setSaving(false);
    }
  };

  // 复制为新草稿：把某历史版本快照载入编辑器（保留当前草稿修订号以便后续保存不冲突），不自动发布。
  const handleCopyVersionToDraft = (snapshot: LabelHubSchema, version: SchemaVersionHistoryItem): void => {
    setSchema({ ...snapshot, schemaDraftRevision: schema.schemaDraftRevision });
    setActivePresetId(`version_${version.id}`);
    setStatusMessage(`已载入第 ${version.schemaVersionNo} 版为编辑草稿`);
    showNotice(`已把第 ${version.schemaVersionNo} 版载入为草稿，可继续编辑后保存或发布。`, "info");
  };

  // 历史保留式回滚：以旧版本快照重新发布，生成一个内容等同旧版的新版本入历史。
  // 绑定遵循“版本冻结”原则——仅 DRAFT 任务会绑定到新版本；已发布任务保留原绑定（不报错）。
  const handleRollbackToVersion = async (snapshot: LabelHubSchema, version: SchemaVersionHistoryItem): Promise<void> => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    const rollbackSchema = { ...snapshot, schemaDraftRevision: schema.schemaDraftRevision };
    try {
      setSaving(true);
      setPublishing(true);
      showNotice(null);
      const draftResponse = await saveSchemaDraft(currentTaskId, {
        schema: rollbackSchema,
        baseSchemaDraftRevision: schema.schemaDraftRevision,
      });
      setSchema(draftResponse.schema);
      setValidation(draftResponse.validation);

      const published = await publishSchema(currentTaskId, draftResponse.schemaDraftRevision);
      const schemaVersionId = readPublishedSchemaVersionId(published.schemaVersion, draftResponse.schema.schemaVersionId);
      const newVersionNo = readPublishedSchemaVersionNo(published.schemaVersion, draftResponse.schema.schemaVersionNo);
      await appendSchemaPublishedAuditEvent({
        schema: draftResponse.schema,
        task,
        schemaVersionId,
        schemaVersionNo: newVersionNo,
      });

      // 尝试把任务绑定到新版本：仅 DRAFT 任务允许（契约 publishTask）。
      // 已发布任务按“默认不迁移”的版本冻结策略保留原绑定，此处的拒绝属预期、不计为失败。
      let rebound = false;
      try {
        const publishedTask = await publishTask(currentTaskId, { schemaVersionId });
        setTask(publishedTask.task);
        rebound = true;
      } catch (bindError) {
        console.info("回滚未重绑（版本冻结：任务已发布，保留原绑定）", bindError);
      }

      setVersionRefreshKey((key) => key + 1);
      showNotice(
        rebound
          ? `已回滚：以第 ${version.schemaVersionNo} 版快照重新发布为第 ${newVersionNo} 版，并绑定到该任务。`
          : `已基于第 ${version.schemaVersionNo} 版生成第 ${newVersionNo} 版快照并入历史。该任务已发布，按版本冻结策略保留原绑定；如需启用可“复制为新草稿”后用于新任务。`,
        "success",
      );
    } catch (error) {
      console.error("Owner 模板回滚失败", error);
      const message = getPublishFailureMessage(error, "PUBLISH_SCHEMA");
      setPublishFailureDetails(getPublishFailureSuggestions(error, "PUBLISH_SCHEMA"));
      showNotice(message, "danger");
    } finally {
      setPublishing(false);
      setSaving(false);
    }
  };

  const handlePublish = async (): Promise<void> => {
    if (!basicReady) {
      showNotice("发布前需要先补齐任务基础信息。", "warning");
      window.requestAnimationFrame(() => {
        publishIssueListRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (!hasDataset) {
      showNotice("发布前需要先导入标注数据。", "warning");
      window.requestAnimationFrame(() => {
        publishIssueListRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (!hasAvailableDataset) {
      showNotice("发布前需要至少 1 条可领取数据。请在数据管理中启用或重新导入数据。", "warning");
      window.requestAnimationFrame(() => {
        publishIssueListRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (publishConfigurationIssues.length > 0) {
      setPublishFailureDetails([]);
      showNotice("发布前需要完成标注模板配置。", "warning");
      window.requestAnimationFrame(() => {
        publishIssueListRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (!aiReady) {
      showNotice("发布前需要配置 AI 预审规则，或明确选择不启用 AI 预审。", "warning");
      window.requestAnimationFrame(() => {
        publishIssueListRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (!distributionReady) {
      showNotice("发布前需要完成分发策略和配额设置。", "warning");
      window.requestAnimationFrame(() => {
        publishIssueListRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    try {
      setPublishPreviewPreparing(true);
      showNotice(null);
      const preview = await buildPublishPreview({
        schema,
        task,
        schemaValidation: publishValidationResult,
      });
      await appendPublishPreviewAuditEvents(createOwnerPublishAuditPreview(schema, task, preview));
      setPublishPreview(preview);
      setPublishPreviewOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成发布前检查失败。";
      showNotice(`发布前检查失败：${message}`, "danger");
    } finally {
      setPublishPreviewPreparing(false);
    }
  };

  const handleConfirmPublishPreview = () => {
    const preview = publishPreview;
    setPublishPreviewOpen(false);
    void confirmPublish(preview);
  };

  // 从 AI 预审页带 ?publish=1 进入：数据加载完成后自动跑发布前检查（弹出 PublishPreviewDialog
  // 或在前置未满足时给出明确提示），并清掉 query 防止刷新/返回重复触发。
  useEffect(() => {
    if (autoPublishTriggeredRef.current) return;
    if (searchParams.get("publish") !== "1") return;
    if (loading || !taskStatsLoaded || aiConfigStatus === "loading") return;
    autoPublishTriggeredRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("publish");
        return next;
      },
      { replace: true },
    );
    void handlePublish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, taskStatsLoaded, aiConfigStatus]);

  const focusIssueNode = (nodeId: string | undefined) => {
    if (nodeId === undefined) return;
    const nodeCard = Array.from(document.querySelectorAll<HTMLElement>(".schema-node-card"))
      .find((element) => element.dataset.nodeId === nodeId);
    if (nodeCard === undefined) return;
    nodeCard.scrollIntoView({ behavior: "smooth", block: "center" });
    const selectButton = Array.from(nodeCard.querySelectorAll("button"))
      .find((button) => button.textContent?.trim().includes("选择"));
    selectButton?.click();
  };

  const handleDesignerCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".schema-designer-preview__surface")) {
      setPreviewExpanded(true);
      return;
    }

    if (!(target instanceof HTMLElement)) return;

    const nodeCard = target.closest(".schema-node-card");
    const directControl = target.closest("button, a, input, textarea, select, label");
    if (directControl) {
      return;
    }

    if (!nodeCard) return;

    const selectButton = Array.from(nodeCard.querySelectorAll("button")).find((button) =>
      button.textContent?.trim().includes("选择"),
    );
    selectButton?.click();
  };

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
    setValidation(undefined);
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
    setValidation(undefined);
    setActivePresetId(`custom_draft_${Date.now()}`);
    setPresetTitleInput("未命名预设模板");
    setPresetDescriptionInput("空白模板。");
    setStatusMessage("已创建空白预设模板起点");
    showNotice("已创建空白模板。请先填写预设名称和说明，再配置画布。", "info");
  };

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
    if (aiSchemaGenerating) return;
    setAiSchemaOpen(false);
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
      const result = await generateSchema(resolveTaskId(taskId, schema.meta.taskId), {
        taskDescription: description,
        preferredNodeTypes: ["show.text", "choice.radio", "choice.checkbox", "input.textarea"],
      });
      const normalized = normalizeGeneratedSchemaDraft(
        result.schemaDraft,
        schema,
        resolveTaskId(taskId, schema.meta.taskId),
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
      // 默认全选生成的全部顶层节点。
      setAiSchemaSelectedIds(new Set(normalized.root.children.map((node) => node.id)));
    } catch (error) {
      console.error("AI Schema Draft 生成失败", error);
      setAiSchemaError("AI 生成失败，请稍后重试。当前手动配置不受影响。");
    } finally {
      setAiSchemaGenerating(false);
    }
  };

  const handleApplyAiSchemaDraft = () => {
    if (aiSchemaPreview === null) return;
    if (aiSchemaSelectedIds.size === 0) return;
    // 只把勾选的节点写入当前草稿；未勾选的不进入。仍然不自动保存、不自动发布。
    const selectedSchema = buildSelectedSchemaDraft(aiSchemaPreview.schema, aiSchemaSelectedIds);
    setSchema(selectedSchema);
    setValidation(undefined);
    setActivePresetId(`ai_schema_draft_${Date.now()}`);
    setPresetTitleInput(selectedSchema.meta.name || "AI 生成模板草稿");
    setPresetDescriptionInput(selectedSchema.meta.description ?? aiSchemaPrompt.trim());
    setStatusMessage(`已应用 AI 生成的 ${selectedSchema.root.children.length} 项节点，保存草稿前不会写入后端。`);
    setAiSchemaOpen(false);
    showNotice("已应用所选 AI 生成节点。请检查字段后手动保存草稿。", "info");
  };

  // 选择性导入快捷操作。
  const aiSchemaSelectableNodes = aiSchemaPreview?.schema.root.children ?? [];
  const handleAiSchemaSelectAll = () => {
    setAiSchemaSelectedIds(new Set(aiSchemaSelectableNodes.map((node) => node.id)));
  };
  const handleAiSchemaSelectAnswerFields = () => {
    setAiSchemaSelectedIds(
      new Set(aiSchemaSelectableNodes.filter((node) => isAnswerFieldType(node.type)).map((node) => node.id)),
    );
  };
  const handleAiSchemaClearSelection = () => {
    setAiSchemaSelectedIds(new Set());
  };
  const toggleAiSchemaNode = (nodeId: string) => {
    setAiSchemaSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handlePresetTitleChange = (title: string) => {
    setPresetTitleInput(title);
    const resolvedTitle = title.trim() || "未命名预设模板";
    setSchema((current) => ({
      ...current,
      meta: {
        ...current.meta,
        name: resolvedTitle,
        updatedAt: new Date().toISOString(),
      },
      root: {
        ...current.root,
        title: resolvedTitle,
      },
    }));
  };

  const handlePresetDescriptionChange = (description: string) => {
    setPresetDescriptionInput(description);
    setSchema((current) => ({
      ...current,
      meta: {
        ...current.meta,
        description,
        updatedAt: new Date().toISOString(),
      },
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
    const material = quickMaterials.find((item) => item.type === type);
    setSchema((current) => appendNodeToRoot(current, type));
    setValidation(undefined);
    setStatusMessage(`已拖拽添加「${material?.label ?? type}」到画布`);
  };

  const addConditionRule = () => {
    setConditionRules((current) => [...current, createConditionRule(fieldNodes)]);
  };

  const addValidationRule = () => {
    setValidationRules((current) => [...current, createValidationRule(fieldNodes)]);
  };

  // 数据字段 → 一键添加为展示文本：在画布新增 show.text 节点并绑定 $.item.sourcePayload.<字段>。
  const handleAddShowItemField = (fieldName: string) => {
    setSchema((current) => appendShowItemField(current, fieldName));
    setValidation(undefined);
    showNotice(`已把「${friendlyFieldTitle(fieldName)}」添加到模板（展示文本）。`, "success");
  };

  return {
    taskId,
    schema,
    setSchema,
    task,
    loading,
    saving,
    publishing,
    publishPreviewPreparing,
    publishNotice,
    publishIssueListRef,
    publishNoticeTone,
    publishFailureDetails,
    previewExpanded,
    setPreviewExpanded,
    publishPreviewOpen,
    setPublishPreviewOpen,
    publishPreview,
    versionRefreshKey,
    boundVersionNo,
    setBoundVersionNo,
    auditEvents,
    auditLoading,
    auditError,
    activePresetId,
    conditionRules,
    setConditionRules,
    validationRules,
    setValidationRules,
    advancedOpen,
    setAdvancedOpen,
    dataFieldsOpen,
    setDataFieldsOpen,
    datasetFields,
    aiSchemaOpen,
    aiSchemaPrompt,
    setAiSchemaPrompt,
    aiSchemaGenerating,
    aiSchemaError,
    aiSchemaPreview,
    aiSchemaSelectedIds,
    serverRegistry,
    statusMessage,
    taskStatsLoaded,
    fieldNodes,
    templateTitle,
    presetOptions,
    presetIssueCounts,
    templateStatus,
    setupSteps,
    publishReadinessItems,
    publishBlockedByDataset,
    publishBlockedByAiConfig,
    publishConfigurationIssues,
    nodeErrorMap,
    validationSummary,
    hasDataset,
    templateReady,
    resolvedAuditTaskId,
    sampleContext,
    dropActive,
    setDropActive,
    publishValidationResult,
    loadAuditTimeline,
    handleSaveDraft,
    exportSchemaJson,
    handleCopyVersionToDraft,
    handleRollbackToVersion,
    handlePublish,
    handleConfirmPublishPreview,
    focusIssueNode,
    handleDesignerCanvasClick,
    handleLoadPreset,
    handleCreateBlankPresetTemplate,
    openAiSchemaDraft,
    closeAiSchemaDraft,
    handleGenerateAiSchemaDraft,
    handleApplyAiSchemaDraft,
    handleAiSchemaSelectAll,
    handleAiSchemaSelectAnswerFields,
    handleAiSchemaClearSelection,
    toggleAiSchemaNode,
    presetTitleInput,
    presetDescriptionInput,
    handlePresetTitleChange,
    handlePresetDescriptionChange,
    handleSaveAsPreset,
    handleCanvasDragOver,
    handleCanvasDrop,
    addConditionRule,
    addValidationRule,
    handleAddShowItemField,
  };
}
