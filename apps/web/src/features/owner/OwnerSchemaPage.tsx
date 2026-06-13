import { useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type MouseEvent, type SetStateAction } from "react";
import { Link, useParams } from "react-router-dom";
import { SchemaDesigner, validateDesignerSchema } from "@labelhub/schema-designer";
import {
  checkBackwardCompatibility,
  collectFieldNodes,
  createDefaultNode,
  createMigrationPlan,
  flattenNodes,
  validateDeprecationRules,
  type DeprecationIssue,
} from "@labelhub/schema-core";
import type {
  AuditEventRecord,
  CompatibilityReport,
  DatasetItem,
  FieldNode,
  ID,
  LabelHubRuntimeContext,
  LabelHubSchema,
  ManualMappingSlot,
  NodeType,
  SchemaNode,
  SchemaValidationError,
  SchemaValidationResult,
  ServerComponentRegistryItem,
  ShowItemNode,
  Task,
} from "@labelhub/contracts";
import { RoutePath, Role } from "../../app/routes";
import {
  fetchSchemaDraft,
  fetchSchemaVersion,
  fetchServerRegistry,
  fetchTask,
  fetchTaskStats,
  publishSchema,
  publishTask,
  saveSchemaDraft,
  type SchemaVersionHistoryItem,
  type TaskStats,
} from "../../api/owner";
import { queryAuditEvents } from "../../api/audit";
import { listItems } from "../../api/dataset";
import { getReviewConfig } from "../../api/reviewer";
import { AuditTimelinePanel } from "./AuditTimelinePanel";
import { SchemaVersionPanel } from "./SchemaVersionPanel";
import { Badge, Button, Card } from "../../ui/primitives";
import {
  appendPublishPreviewAuditEvents,
  appendPublishRequestedAuditEvent,
  appendSchemaPublishedAuditEvent,
  appendSchemaPublishFailedAuditEvent,
  type OwnerPublishAuditPreview,
  type OwnerPublishFailureStage,
} from "./audit-events";
import { localServerComponentRegistry } from "./localComponentRegistry";
import { PublishPreviewDialog } from "./PublishPreviewDialog";
import { createSchemaFromPreset, schemaPresetSummaries } from "./schemaPresetLibrary";
import { buildTaskSetupSteps, PublishReadinessPanel, TaskSetupStepper, type ReadinessItem } from "./TaskSetupGuide";

interface OwnerSchemaPageProps {
  role: Role;
}

interface QuickMaterial {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
}

type NoticeTone = "success" | "danger" | "info" | "warning";

type ConditionOperator = "eq" | "ne" | "contains" | "empty" | "notEmpty";
type ConditionAction = "show" | "hide" | "disable";
type VisualValidationType = "required" | "minLength" | "maxLength" | "numberRange" | "regex";

interface ConditionRuleDraft {
  id: string;
  targetField: string;
  conditionField: string;
  operator: ConditionOperator;
  value: string;
  action: ConditionAction;
}

interface ValidationRuleDraft {
  id: string;
  targetField: string;
  type: VisualValidationType;
  value: string;
  message: string;
}

interface PublishPreviewState {
  isFirstPublish: boolean;
  publishAllowed: boolean;
  requiresApproval: boolean;
  requiresMigration: boolean;
  affectedSubmissionsLabel: string;
  schemaValidation: SchemaValidationResult;
  compatibilityReport?: CompatibilityReport;
  deprecationErrors: DeprecationIssue[];
  deprecationWarnings: DeprecationIssue[];
  manualMappingSlots: ManualMappingSlot[];
  oldSchemaStatusMessage?: string;
}

interface PublishConfigurationIssue {
  id: string;
  message: string;
  suggestion: string;
  badge: string;
  nodeId?: string;
}

interface CustomSchemaPreset {
  id: string;
  title: string;
  description: string;
  fields: string;
  schema: LabelHubSchema;
  createdAt: string;
}

type SchemaPresetOption =
  | ((typeof schemaPresetSummaries)[number] & { source: "built-in" })
  | (CustomSchemaPreset & { source: "custom" });

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

const conditionOperatorLabels: Record<ConditionOperator, string> = {
  eq: "等于",
  ne: "不等于",
  contains: "包含",
  empty: "为空",
  notEmpty: "不为空",
};

const conditionActionLabels: Record<ConditionAction, string> = {
  show: "显示",
  hide: "隐藏",
  disable: "禁用",
};

const validationTypeLabels: Record<VisualValidationType, string> = {
  required: "必填",
  minLength: "最小长度",
  maxLength: "最大长度",
  numberRange: "数字范围",
  regex: "正则表达式",
};

function schemaRevisionLabel(schema: LabelHubSchema): string {
  return `r${schema.schemaDraftRevision ?? schema.schemaVersionNo ?? 1}`;
}

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
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
          setSchema(fallbackSchema);
          setActivePresetId(presetIdForSchema(fallbackSchema));
          setStatusMessage("未读取到模板草稿，已创建空白编辑起点");
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
      const publishedTask = await publishTask(currentTaskId, { schemaVersionId });
      setTask(publishedTask.task);
      setVersionRefreshKey((key) => key + 1);
      showNotice("发布成功，任务已进入任务市场。", "success");
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

  if (loading) {
    return <Card className="state-panel">加载模板组件中...</Card>;
  }

  if (!task) {
    const isLocalTask = taskId?.startsWith("task_local_") === true;
    return (
      <Card className="state-panel danger-text">
        {isLocalTask ? "本地临时任务不支持发布，请启动后端 API 后重新创建任务。" : `任务不存在：${taskId}`}
      </Card>
    );
  }

  return (
    <div className={`page-stack schema-workbench-page schema-builder-page${previewExpanded ? " schema-preview-expanded" : ""}`}>
      <Card className="schema-builder-toolbar">
        <div>
          <div className="schema-builder-breadcrumb">
            <Link to={RoutePath.OWNER_TASKS}>任务负责人后台</Link>
            <span>/</span>
            <span>模板搭建</span>
            <span>/</span>
            <strong>{task.title}</strong>
          </div>
          <h2>
            模板搭建
          </h2>
          <p>{task.title}</p>
          <p className="schema-builder-intro">
            配置字段结构、校验规则与联动逻辑。
          </p>
        </div>
        <div className="schema-builder-toolbar__actions">
          <Link to={RoutePath.OWNER_TASKS} className="lh-button">
            返回任务
          </Link>
          {task.status === "DRAFT" ? (
            <Link to={`/owner/tasks/${task.id}?edit=basic`} className="lh-button">
              编辑基础信息
            </Link>
          ) : null}
          <Button type="button" onClick={() => setDataFieldsOpen(true)}>
            数据字段
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSaveDraft()}>
            {saving && !publishing ? "保存中..." : "保存草稿"}
          </Button>
          <Button type="button" onClick={() => setPreviewExpanded(true)}>
            实时预览
          </Button>
          <Button type="button" onClick={exportSchemaJson}>
            导出 JSON
          </Button>
          <Button type="button" tone="primary" disabled={saving || publishPreviewPreparing} onClick={() => void handlePublish()}>
            {publishing ? "发布中..." : publishPreviewPreparing ? "检查中..." : "保存并发布模板"}
          </Button>
        </div>
      </Card>

      {dataFieldsOpen ? (
        <div className="owner-data-fields-overlay" role="presentation">
          <button
            type="button"
            className="owner-data-fields-backdrop"
            aria-label="关闭数据字段面板"
            onClick={() => setDataFieldsOpen(false)}
          />
          <aside className="owner-data-fields-drawer" role="dialog" aria-modal="true" aria-label="数据字段">
            <header className="owner-data-fields-drawer__head">
              <div>
                <h3>数据字段</h3>
                <p>来自当前任务已导入数据，可一键添加为展示文本。</p>
              </div>
              <button
                type="button"
                className="owner-data-fields-drawer__close"
                aria-label="关闭数据字段面板"
                onClick={() => setDataFieldsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="owner-data-fields-drawer__body">
              {datasetFields.length === 0 ? (
                <p className="owner-data-fields-empty">
                  当前任务还没有可读取的数据字段。请先在数据管理导入 JSON / JSONL 数据。
                </p>
              ) : (
                FIELD_SECTIONS.map((section) => {
                  const fields = datasetFields.filter((field) => field.role === section.role);
                  if (fields.length === 0) return null;
                  const isAnswer = section.role === "answer";
                  return (
                    <section className="owner-data-fields-section" key={section.role}>
                      <div className="owner-data-fields-section__head">
                        <h4>{section.title}</h4>
                        <p>{section.desc}</p>
                      </div>
                      {fields.map((field) => (
                        <div
                          className={`owner-data-field-card${isAnswer ? " owner-data-field-card--answer" : ""}`}
                          key={field.name}
                        >
                          <div className="owner-data-field-card__head">
                            <code className="owner-data-field-card__name">{field.name}</code>
                            <Badge tone={isAnswer ? "warning" : "default"}>{field.kind}</Badge>
                          </div>
                          <p className="owner-data-field-card__sample" title={field.sample}>{field.sample}</p>
                          {isAnswer ? (
                            <>
                              <p className="owner-data-field-card__warn">
                                可能是答案或隐藏标签，展示给标注员可能造成泄露。
                              </p>
                              <Button
                                type="button"
                                disabled
                                title="疑似答案 / 隐藏标签字段，默认禁止添加，避免答案泄露。"
                              >
                                默认禁止添加
                              </Button>
                            </>
                          ) : section.role === "recommended" ? (
                            <Button type="button" tone="primary" onClick={() => handleAddShowItemField(field.name)}>
                              添加到模板：展示文本
                            </Button>
                          ) : section.role === "metadata" ? (
                            <Button type="button" onClick={() => handleAddShowItemField(field.name)}>
                              高级添加
                            </Button>
                          ) : (
                            <Button type="button" onClick={() => handleAddShowItemField(field.name)}>
                              添加到模板：展示文本
                            </Button>
                          )}
                        </div>
                      ))}
                    </section>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      ) : null}

      <div className="schema-builder-statusbar">
        <Badge tone={templateStatus.tone}>模板状态：{templateStatus.label}</Badge>
        <span title="草稿每次保存自动递增的修订号，用于并发冲突检测，不等于已发布版本号">
          <Badge tone="primary">草稿修订：第 {schema.schemaDraftRevision ?? 1} 次修改</Badge>
        </span>
        <span
          title={
            task.activeSchemaVersionId
              ? `任务绑定的发布版本 ID：${task.activeSchemaVersionId}`
              : "任务尚未发布任何模板版本"
          }
        >
          <Badge tone={boundVersionNo != null ? "success" : "default"}>
            任务绑定版本：
            {boundVersionNo != null
              ? `第 ${boundVersionNo} 版`
              : task.activeSchemaVersionId
                ? "已绑定已发布版本"
                : "尚未发布"}
          </Badge>
        </span>
        <Badge tone="default">所属任务：{task.title || "当前任务"}</Badge>
        <Badge tone="success">可用字段组件：{serverRegistry.length} 类</Badge>
        <span>{statusMessage}</span>
      </div>
      <p className="schema-builder-status-hint">{templateStatus.hint}</p>

      <TaskSetupStepper steps={setupSteps} />

      {!hasDataset ? (
        <Card className="labeler-return-card owner-flow-warning-card">
          <Badge tone="warning">数据待导入</Badge>
          <p>当前任务还未导入数据，请先完成数据管理。</p>
          <div className="schema-builder-notice-actions">
            <Link to={`/owner/tasks/${resolvedAuditTaskId}/data`} className="lh-button lh-button--primary">
              去导入数据
            </Link>
          </div>
        </Card>
      ) : null}

      <PublishReadinessPanel items={publishReadinessItems} />

      {publishNotice ? (
        <div className="schema-builder-notice-slot" ref={publishIssueListRef}>
          <Card className={`labeler-return-card schema-builder-notice schema-builder-notice--${publishNoticeTone}`}>
            <Badge tone={noticeBadgeTone(publishNoticeTone)}>
              {publishNoticeTone === "danger" ? "操作失败" : publishNoticeTone === "success" ? "已更新" : publishNoticeTone === "warning" ? "待完成" : "提示"}
            </Badge>
            <p>{publishNotice}</p>
            {publishBlockedByDataset || publishBlockedByAiConfig ? (
              <div className="schema-builder-notice-actions">
                {publishBlockedByDataset ? (
                  <Link to={`/owner/tasks/${resolvedAuditTaskId}/data`} className="lh-button lh-button--primary">
                    去导入数据
                  </Link>
                ) : null}
                {publishBlockedByAiConfig ? (
                  <Link to={`/owner/tasks/${resolvedAuditTaskId}/ai-precheck`} className="lh-button">
                    去配置 AI 预审
                  </Link>
                ) : null}
              </div>
            ) : null}
            {(publishNoticeTone === "danger" || publishNoticeTone === "warning") && publishConfigurationIssues.length > 0 ? (
              <div className="schema-builder-publish-issues">
                <strong>请先修复以下问题：</strong>
                <ul>
                  {publishConfigurationIssues.map((issue) => (
                    <li key={issue.id}>
                      <button type="button" onClick={() => focusIssueNode(issue.nodeId)}>
                        <span>{issue.message}</span>
                        <small>{issue.suggestion}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(publishNoticeTone === "danger" || publishNoticeTone === "warning") && publishConfigurationIssues.length === 0 && publishFailureDetails.length > 0 ? (
              <div className="schema-builder-publish-issues">
                <strong>建议处理：</strong>
                <ul>
                  {publishFailureDetails.map((detail) => (
                    <li key={detail}><span>{detail}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      <Card className="schema-preset-panel schema-preset-panel--compact">
        <div className="schema-preset-heading">
          <div>
            <h3>常用预设模板</h3>
          </div>
        </div>
        <div className="schema-preset-grid schema-preset-grid--compact">
          <button
            className="schema-preset-card schema-preset-card--create"
            type="button"
            onClick={handleCreateBlankPresetTemplate}
          >
            <b className="schema-preset-plus" aria-hidden="true" />
            <strong>新建预设</strong>
            <em>空白模板</em>
          </button>
          {presetOptions.map((preset) => (
            <button
              className={["schema-preset-card", activePresetId === preset.id ? "schema-preset-card--active" : ""]
                .filter(Boolean)
                .join(" ")}
              key={preset.id}
              type="button"
              onClick={() => handleLoadPreset(preset)}
            >
              <span>{activePresetId === preset.id ? "当前模板" : preset.source === "custom" ? "自定义预设" : "预设模板"}</span>
              {(presetIssueCounts.get(preset.id) ?? 0) > 0 ? (
                <span className="schema-preset-card__warning">需补充配置 · {presetIssueCounts.get(preset.id)} 项</span>
              ) : null}
              <strong>{preset.title}</strong>
              <em>{preset.fields}</em>
            </button>
          ))}
        </div>
      </Card>

      <Card className="schema-config-card schema-config-card--wide schema-save-preset-card">
        <div className="schema-config-heading">
          <div>
            <h3>当前模板</h3>
            <p>{schema.root.children.length} 个节点 · {fieldNodes.length} 个字段</p>
          </div>
          <Button type="button" onClick={handleSaveAsPreset}>
            另存为预设
          </Button>
        </div>
        <div className="schema-save-preset-form">
          <label>
            预设名称
            <input value={presetTitleInput} onChange={(event) => handlePresetTitleChange(event.target.value)} />
          </label>
          <label>
            说明
            <textarea value={presetDescriptionInput} onChange={(event) => handlePresetDescriptionChange(event.target.value)} />
          </label>
        </div>
      </Card>

      <section className="schema-visual-config">
        <Card className="schema-config-card">
          <div className="schema-config-heading">
            <div>
              <h3>字段配置</h3>
              <p>当前模板中可参与条件和校验的字段。</p>
            </div>
            <Badge tone="default">{fieldNodes.length} 个字段</Badge>
          </div>
          {fieldNodes.length > 0 ? (
            <div className="schema-field-config-list">
              {fieldNodes.map((field) => (
                <div className="schema-field-config-row" key={field.id}>
                  <strong>{field.title}</strong>
                  <span>{field.name}</span>
                  <Badge tone={field.required ? "warning" : "default"}>{field.required ? "必填" : "可选"}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="schema-config-empty">暂无可配置字段。请先从物料区添加输入或选择类字段。</p>
          )}
        </Card>

        <Card className="schema-config-card">
          <div className="schema-config-heading">
            <div>
              <h3>条件显示</h3>
              <p>用表单规则控制字段显示、隐藏或禁用。</p>
            </div>
            <Button type="button" onClick={addConditionRule} disabled={fieldNodes.length === 0}>
              新增规则
            </Button>
          </div>
          {conditionRules.length > 0 ? (
            <div className="schema-rule-list">
              {conditionRules.map((rule, index) => (
                <div className="schema-rule-card" key={rule.id}>
                  <div className="schema-rule-card__title">
                    <strong>条件规则 {index + 1}</strong>
                    <button type="button" onClick={() => setConditionRules((current) => current.filter((item) => item.id !== rule.id))}>
                      删除
                    </button>
                  </div>
                  <div className="schema-rule-grid schema-rule-grid--condition">
                    <SelectField label="目标字段" value={rule.targetField} options={fieldNodes} onChange={(value) => updateConditionRule(setConditionRules, rule.id, { targetField: value })} />
                    <SelectField label="条件字段" value={rule.conditionField} options={fieldNodes} onChange={(value) => updateConditionRule(setConditionRules, rule.id, { conditionField: value })} />
                    <label>
                      判断关系
                      <select value={rule.operator} onChange={(event) => updateConditionRule(setConditionRules, rule.id, { operator: event.target.value as ConditionOperator })}>
                        {Object.entries(conditionOperatorLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      条件值
                      <input
                        disabled={rule.operator === "empty" || rule.operator === "notEmpty"}
                        value={rule.value}
                        onChange={(event) => updateConditionRule(setConditionRules, rule.id, { value: event.target.value })}
                        placeholder="例如 pass"
                      />
                    </label>
                    <label>
                      动作
                      <select value={rule.action} onChange={(event) => updateConditionRule(setConditionRules, rule.id, { action: event.target.value as ConditionAction })}>
                        {Object.entries(conditionActionLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="schema-config-empty">暂无条件规则。可以添加规则，例如“当质量判断等于需要修改时，显示修改建议”。</p>
          )}
        </Card>

        <Card className="schema-config-card">
          <div className="schema-config-heading">
            <div>
              <h3>校验规则</h3>
              <p>用清晰的控件配置必填、长度和格式要求。</p>
            </div>
            <Button type="button" onClick={addValidationRule} disabled={fieldNodes.length === 0}>
              新增规则
            </Button>
          </div>
          {validationRules.length > 0 ? (
            <div className="schema-rule-list">
              {validationRules.map((rule, index) => (
                <div className="schema-rule-card" key={rule.id}>
                  <div className="schema-rule-card__title">
                    <strong>校验规则 {index + 1}</strong>
                    <button type="button" onClick={() => setValidationRules((current) => current.filter((item) => item.id !== rule.id))}>
                      删除
                    </button>
                  </div>
                  <div className="schema-rule-grid">
                    <SelectField label="目标字段" value={rule.targetField} options={fieldNodes} onChange={(value) => updateValidationRule(setValidationRules, rule.id, { targetField: value })} />
                    <label>
                      校验类型
                      <select value={rule.type} onChange={(event) => updateValidationRule(setValidationRules, rule.id, { type: event.target.value as VisualValidationType })}>
                        {Object.entries(validationTypeLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      参数值
                      <input
                        disabled={rule.type === "required"}
                        value={rule.value}
                        onChange={(event) => updateValidationRule(setValidationRules, rule.id, { value: event.target.value })}
                        placeholder={rule.type === "numberRange" ? "例如 1-100" : "例如 10"}
                      />
                    </label>
                    <label>
                      错误提示文案
                      <input
                        value={rule.message}
                        onChange={(event) => updateValidationRule(setValidationRules, rule.id, { message: event.target.value })}
                        placeholder="请输入错误提示"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="schema-config-empty">暂无校验规则。可以添加规则，例如“摘要最少 10 个字”。</p>
          )}
        </Card>

        <Card className="schema-config-card">
          <div className="schema-config-heading">
            <div>
              <h3>表单预览</h3>
              <p>右侧实时预览会使用同一份 SchemaRenderer 渲染当前模板。</p>
            </div>
            <Button type="button" onClick={() => setPreviewExpanded(true)}>
              放大预览
            </Button>
          </div>
          <div className="schema-preview-summary">
            <div><strong>{schema.root.children.length}</strong><span>画布节点</span></div>
            <div><strong>{conditionRules.length}</strong><span>条件规则</span></div>
            <div><strong>{validationRules.length}</strong><span>校验规则</span></div>
          </div>
        </Card>

        <Card className="schema-config-card owner-schema-validation">
          <div className="schema-config-heading">
            <div>
              <h3>校验结果</h3>
              <p>发布前的模板自检：标题、选项、字段配置是否完整。</p>
            </div>
            <Badge tone={validationSummary.tone}>{validationSummary.badge}</Badge>
          </div>
          {validationSummary.errors.length === 0 && validationSummary.warnings.length === 0 ? (
            <p className="schema-config-empty">未发现模板配置问题，可进入发布前检查。</p>
          ) : (
            <div className="owner-schema-issue-list">
              {validationSummary.errors.map((issue, index) => (
                <div className="owner-schema-issue owner-schema-issue--error" key={`error-${index}`}>
                  <span className="owner-schema-issue-tag">必须修复</span>
                  <p>{issue}</p>
                </div>
              ))}
              {validationSummary.warnings.map((issue, index) => (
                <div className="owner-schema-issue owner-schema-issue--warning" key={`warning-${index}`}>
                  <span className="owner-schema-issue-tag">建议检查</span>
                  <p>{issue}</p>
                </div>
              ))}
            </div>
          )}
          {templateReady ? (
            <div className="owner-template-next-step">
              <span>当前模板已通过发布前检查，下一步配置本任务的 AI 预审规则。</span>
              <Link to={`/owner/tasks/${resolvedAuditTaskId}/ai-precheck`} className="lh-button lh-button--primary">
                继续配置 AI 预审
              </Link>
            </div>
          ) : null}
        </Card>

        <Card className="schema-config-card schema-config-card--wide">
          <details open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary>高级 JSON 配置 / 查看 JSON</summary>
            <textarea
              readOnly
              value={JSON.stringify({ schema, visualRules: { conditionRules, validationRules } }, null, 2)}
            />
          </details>
        </Card>

      </section>

      <Card className="schema-designer-shell schema-designer-shell--builder">
        <div className="schema-canvas-header schema-canvas-header--compact">
          <div>
            <Badge tone="primary">任务 {task.id}</Badge>
            <h3>{templateTitle}</h3>
            <p>{schema.meta.description || "暂无说明"}</p>
          </div>
        </div>

        {previewExpanded ? (
          <>
            <button type="button" className="schema-preview-backdrop" aria-label="关闭预览" onClick={() => setPreviewExpanded(false)} />
            <button type="button" className="schema-preview-close" aria-label="关闭实时预览" onClick={() => setPreviewExpanded(false)}>
              关闭
            </button>
          </>
        ) : null}

        <div
          className={`schema-canvas schema-canvas--builder${dropActive ? " schema-canvas--drop-active" : ""}`}
          onClick={handleDesignerCanvasClick}
          onDragLeave={() => setDropActive(false)}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          {dropActive ? <div className="schema-canvas-drop-hint">释放后添加到当前模板画布</div> : null}
          <SchemaDesigner
            key={schema.schemaId}
            schema={schema}
            serverRegistry={serverRegistry}
            sampleContext={sampleContext}
            readonly={false}
            nodeErrors={nodeErrorMap}
            validationResult={publishValidationResult}
            onSchemaChange={setSchema}
          />
        </div>
      </Card>

      <SchemaVersionPanel
        taskId={resolveTaskId(taskId, schema.meta.taskId)}
        activeSchemaVersionId={task?.activeSchemaVersionId}
        refreshKey={versionRefreshKey}
        onActiveVersionResolved={setBoundVersionNo}
        onCopyToDraft={handleCopyVersionToDraft}
        onRollback={(snapshot, version) => void handleRollbackToVersion(snapshot, version)}
      />

      <AuditTimelinePanel
        events={auditEvents}
        loading={auditLoading}
        error={auditError}
        onRefresh={() => void loadAuditTimeline()}
        title="模板治理审计"
        description="记录该任务的模板变更、发布前兼容性检查、Breaking Change 阻断、字段废弃与版本发布事件。"
        emptyText="暂无模板治理事件。保存草稿或发起发布检查后，这里会出现对应记录。"
      />

      {publishPreview ? (
        <PublishPreviewDialog
          affectedSubmissionsLabel={publishPreview.affectedSubmissionsLabel}
          compatibilityReport={publishPreview.compatibilityReport}
          deprecationErrors={publishPreview.deprecationErrors}
          deprecationWarnings={publishPreview.deprecationWarnings}
          isFirstPublish={publishPreview.isFirstPublish}
          manualMappingSlots={publishPreview.manualMappingSlots}
          oldSchemaStatusMessage={publishPreview.oldSchemaStatusMessage}
          open={publishPreviewOpen}
          publishAllowed={publishPreview.publishAllowed}
          requiresApproval={publishPreview.requiresApproval}
          requiresMigration={publishPreview.requiresMigration}
          schemaValidation={publishPreview.schemaValidation}
          onCancel={() => setPublishPreviewOpen(false)}
          onConfirm={handleConfirmPublishPreview}
        />
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FieldNode[];
  onChange(value: string): void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((field) => (
          <option key={field.id} value={field.name}>
            {field.title} ({field.name})
          </option>
        ))}
      </select>
    </label>
  );
}

function noticeBadgeTone(tone: NoticeTone): "success" | "danger" | "primary" | "warning" {
  if (tone === "success") return "success";
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  return "primary";
}

function isDistributionReady(task: Task): boolean {
  if (!task.title.trim() || task.quota.total < 1) return false;
  if (task.distributionStrategy.type === "ASSIGNMENT") {
    return task.distributionStrategy.assigneeIds.length > 0;
  }
  if (task.distributionStrategy.type === "QUOTA_CLAIM") {
    return task.distributionStrategy.claimBatchSize > 0;
  }
  return true;
}

function collectPublishConfigurationIssues(
  schema: LabelHubSchema,
  expectedTaskId?: string,
): PublishConfigurationIssue[] {
  const nodes = flattenNodes(schema).filter((node) => node.id !== schema.root.id);
  const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index + 1]));
  const issues: PublishConfigurationIssue[] = [];
  const seen = new Set<string>();
  const addIssue = (issue: PublishConfigurationIssue) => {
    const key = `${issue.nodeId ?? "schema"}:${issue.badge}:${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };
  const nodePrefix = (node: SchemaNode): string => {
    const index = nodeIndexById.get(node.id);
    const title = node.title.trim() || "未命名组件";
    return index === undefined ? `节点「${title}」` : `第 ${index} 个节点「${title}」`;
  };

  if (schema.meta.name.trim().length === 0 || schema.meta.name.trim() === "未命名预设模板") {
    addIssue({
      id: "schema-name",
      badge: "模板名称未完成",
      message: "模板名称尚未填写。",
      suggestion: "请在“当前模板”的预设名称中填写清晰名称。",
    });
  }

  if (!schema.meta.taskId || (expectedTaskId !== undefined && schema.meta.taskId !== expectedTaskId)) {
    addIssue({
      id: "schema-task-binding",
      badge: "任务绑定异常",
      message: "模板没有正确绑定当前任务。",
      suggestion: "请重新加载当前任务模板后再发布。",
    });
  }

  if (!Number.isInteger(schema.schemaDraftRevision) || (schema.schemaDraftRevision ?? 0) < 1) {
    addIssue({
      id: "schema-draft-revision",
      badge: "草稿版本缺失",
      message: "模板缺少有效的草稿版本号。",
      suggestion: "请刷新页面重新获取最新模板草稿。",
    });
  }

  if (nodes.length === 0) {
    addIssue({
      id: "schema-nodes",
      badge: "画布为空",
      message: "模板画布中还没有组件。",
      suggestion: "请从左侧添加至少一个展示或作答组件。",
    });
  }

  for (const node of nodes) {
    if (node.id.trim().length === 0) {
      addIssue({
        id: `node-id-${nodeIndexById.get(node.id) ?? issues.length}`,
        nodeId: node.id,
        badge: "缺少节点标识",
        message: `${nodePrefix(node)}：缺少节点标识 id。`,
        suggestion: "请删除后重新添加该组件。",
      });
    }
    if (node.title.trim().length === 0) {
      addIssue({
        id: `node-title-${node.id}`,
        nodeId: node.id,
        badge: "缺少组件名称",
        message: `${nodePrefix(node)}：缺少组件名称。`,
        suggestion: "请在右侧属性面板填写组件名称。",
      });
    }
    if (node.kind === "FIELD" && node.name.trim().length === 0) {
      addIssue({
        id: `field-name-${node.id}`,
        nodeId: node.id,
        badge: "缺少字段名",
        message: `${nodePrefix(node)}：缺少字段名称 name。`,
        suggestion: "字段名称用于保存标注结果，不能为空。",
      });
    }
    if (node.kind === "FIELD" && node.type.startsWith("choice.") && "options" in node) {
      if (node.options.length < 2) {
        addIssue({
          id: `choice-options-${node.id}`,
          nodeId: node.id,
          badge: "缺少选项",
          message: `${nodePrefix(node)}：至少需要 2 个选项。`,
          suggestion: "请在右侧属性面板补充可区分的选项文字与保存值。",
        });
      }
      node.options.forEach((option, optionIndex) => {
        if (option.label.trim().length === 0 || option.value.trim().length === 0) {
          addIssue({
            id: `choice-option-${node.id}-${optionIndex}`,
            nodeId: node.id,
            badge: "选项未完成",
            message: `${nodePrefix(node)}：第 ${optionIndex + 1} 个选项信息不完整。`,
            suggestion: "选项文字和保存值都不能为空。",
          });
        }
      });
    }
  }

  let validationResult: SchemaValidationResult | undefined;
  try {
    validationResult = validateDesignerSchema(schema);
  } catch {
    validationResult = undefined;
  }
  for (const error of validationResult?.errors ?? []) {
    const node = error.nodeId === undefined ? undefined : nodes.find((item) => item.id === error.nodeId);
    addIssue({
      id: `schema-${error.code}-${error.nodeId ?? "root"}-${error.path}`,
      ...(error.nodeId === undefined ? {} : { nodeId: error.nodeId }),
      badge: "配置未完成",
      message: node === undefined ? error.message : `${nodePrefix(node)}：${error.message}`,
      suggestion: node === undefined ? "请检查模板基础信息。" : "请在右侧属性面板完成该组件配置。",
    });
  }

  return issues;
}

function createPublishValidationResult(
  schema: LabelHubSchema,
  issues: PublishConfigurationIssue[],
): SchemaValidationResult {
  let baseResult: SchemaValidationResult;
  try {
    baseResult = validateDesignerSchema(schema);
  } catch {
    baseResult = {
      valid: false,
      errors: [{
        code: "SCHEMA_INVALID",
        path: "$",
        message: "模板检查暂时不可用，请刷新页面后重试。",
      }],
      warnings: [],
    };
  }

  const errors: SchemaValidationError[] = issues.map((issue) => ({
    code: "SCHEMA_INVALID",
    path: issue.nodeId === undefined ? "$" : `$.nodes.${issue.nodeId}`,
    message: `${issue.message} ${issue.suggestion}`,
    ...(issue.nodeId === undefined ? {} : { nodeId: issue.nodeId }),
  }));

  return {
    valid: errors.length === 0,
    errors,
    warnings: baseResult.warnings,
  };
}

function getPublishFailureMessage(error: unknown, stage: OwnerPublishFailureStage): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("409") || normalized.includes("conflict") || message.includes("草稿版本")) {
    return "发布失败：模板草稿已被更新，请刷新页面后重新确认本次修改。";
  }

  if (
    normalized.includes("failed to fetch")
    || normalized.includes("networkerror")
    || normalized.includes("internal server error")
    || normalized.includes("服务未连接")
  ) {
    return "发布接口暂不可用，请稍后重试或联系后端确认接口。";
  }

  if (message.includes("数据集") || message.includes("可领取题目")) {
    return "模板版本已发布，但任务还不能进入分发：请先导入至少一条可领取数据。";
  }

  if (message.includes("ReviewConfig") || message.includes("AI 审核") || message.includes("AI 预审")) {
    return "模板版本已发布，但任务还不能进入分发：请先配置 AI 预审规则，或明确关闭 AI 预审。";
  }

  if (
    normalized.includes("422")
    || message.includes("请求参数校验失败")
    || message.includes("schemaDraftRevision")
    || message.includes("校验失败")
  ) {
    return "发布前需要完成标注模板配置。请检查字段名称、字段类型与必填配置。";
  }

  if (stage === "SAVE_DRAFT") {
    return "发布失败：模板草稿保存失败，请稍后重试。";
  }

  return message ? `发布失败：${message}` : "发布失败，请稍后重试。";
}

function getPublishFailureSuggestions(error: unknown, stage: OwnerPublishFailureStage): string[] {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("409") || normalized.includes("conflict") || message.includes("schemaDraftRevision")) {
    return [
      "刷新页面获取最新草稿版本，再重新确认本次修改。",
      "当前页面中的编辑不会被自动覆盖，刷新前可先导出 JSON 留存。",
    ];
  }
  if (message.includes("数据集") || message.includes("可领取题目")) {
    return [
      "进入数据集管理页，上传 JSON / JSONL / Excel 数据文件。",
      "导入后确认至少有 1 条题目处于“可领取”状态，再回到模板页重新发布任务。",
    ];
  }
  if (message.includes("ReviewConfig") || message.includes("AI 审核") || message.includes("AI 预审")) {
    return [
      "进入 AI 预审配置页，保存预审规则，或明确关闭 AI 预审。",
      "配置完成后回到模板页重新发布任务。",
    ];
  }
  if (normalized.includes("422") || message.includes("校验失败")) {
    return [
      "检查“模板检查”中的字段名称、组件类型、选项和任务绑定。",
      "修复全部错误后重新执行发布前检查。",
    ];
  }
  if (stage === "PUBLISH_TASK") {
    return [
      "模板版本可能已经发布，但任务分发条件尚未满足。",
      "请检查数据集、AI 预审配置和任务发布条件。",
    ];
  }
  if (normalized.includes("failed to fetch") || normalized.includes("internal server error")) {
    return ["确认后端服务可用后重试。"];
  }
  return ["保留当前修改并稍后重试；如持续失败，请在审计记录中查看失败阶段。"];
}

async function buildPublishPreview({
  schema,
  task,
  schemaValidation,
}: {
  schema: LabelHubSchema;
  task: Task | undefined;
  schemaValidation: SchemaValidationResult;
}): Promise<PublishPreviewState> {
  const deprecationResult = validateDeprecationRules(schema);
  const activeSchemaVersionId = task?.activeSchemaVersionId;
  let compatibilityReport: CompatibilityReport | undefined;
  let manualMappingSlots: ManualMappingSlot[] = [];
  let isFirstPublish = true;
  let oldSchemaStatusMessage: string | undefined;

  if (activeSchemaVersionId) {
    try {
      const schemaVersion = await fetchSchemaVersion(activeSchemaVersionId);
      const oldSchema = readSchemaVersionSnapshot(schemaVersion);
      if (oldSchema === undefined) {
        throw new Error("SCHEMA_VERSION_SNAPSHOT_MISSING");
      }
      compatibilityReport = checkBackwardCompatibility(oldSchema, schema);
      manualMappingSlots = createMigrationPlan(oldSchema, schema).manualMappingSlots;
      isFirstPublish = false;
    } catch {
      oldSchemaStatusMessage = "未能读取上一已发布版本，本次仅执行当前草稿完整性检查。";
    }
  }

  const compatibilityPublishAllowed = compatibilityReport?.publishAllowed ?? true;
  const publishAllowed = schemaValidation.valid && deprecationResult.valid && compatibilityPublishAllowed;
  const requiresApproval =
    (compatibilityReport?.requiresApproval ?? false) ||
    schemaValidation.warnings.length > 0 ||
    deprecationResult.warnings.length > 0;
  const requiresMigration = (compatibilityReport?.requiresMigration ?? false) || manualMappingSlots.length > 0;

  const result: PublishPreviewState = {
    isFirstPublish,
    publishAllowed,
    requiresApproval,
    requiresMigration,
    affectedSubmissionsLabel: "后端统计暂未接入",
    schemaValidation,
    deprecationErrors: deprecationResult.errors,
    deprecationWarnings: deprecationResult.warnings,
    manualMappingSlots,
  };

  if (compatibilityReport !== undefined) {
    result.compatibilityReport = compatibilityReport;
  }
  if (oldSchemaStatusMessage !== undefined) {
    result.oldSchemaStatusMessage = oldSchemaStatusMessage;
  }

  return result;
}

function readSchemaVersionSnapshot(schemaVersion: unknown): LabelHubSchema | undefined {
  if (!isRecordValue(schemaVersion)) return undefined;
  const candidate = schemaVersion.snapshot ?? schemaVersion.schema;
  if (!isRecordValue(candidate) || !isRecordValue(candidate.root)) return undefined;
  return candidate as unknown as LabelHubSchema;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createOwnerPublishAuditPreview(
  schema: LabelHubSchema,
  task: Task | undefined,
  preview: PublishPreviewState,
): OwnerPublishAuditPreview {
  const auditPreview: OwnerPublishAuditPreview = {
    schema,
    task,
    schemaValidation: preview.schemaValidation,
    deprecationErrors: preview.deprecationErrors,
    deprecationWarnings: preview.deprecationWarnings,
    manualMappingSlots: preview.manualMappingSlots,
    publishAllowed: preview.publishAllowed,
    requiresApproval: preview.requiresApproval,
    requiresMigration: preview.requiresMigration,
    isFirstPublish: preview.isFirstPublish,
  };

  if (preview.compatibilityReport !== undefined) {
    auditPreview.compatibilityReport = preview.compatibilityReport;
  }

  return auditPreview;
}

function readPublishedSchemaVersionId(schemaVersion: unknown, fallbackSchemaVersionId: ID | undefined): ID {
  if (isRecord(schemaVersion) && typeof schemaVersion.id === "string") {
    return schemaVersion.id as ID;
  }

  if (fallbackSchemaVersionId !== undefined) {
    return fallbackSchemaVersionId;
  }

  throw new Error("schema publish response 缺少 schemaVersion.id。");
}

function readPublishedSchemaVersionNo(schemaVersion: unknown, fallbackSchemaVersionNo: number | undefined): number | undefined {
  if (isRecord(schemaVersion) && typeof schemaVersion.schemaVersionNo === "number") {
    return schemaVersion.schemaVersionNo;
  }

  if (isRecord(schemaVersion) && isRecord(schemaVersion.snapshot) && typeof schemaVersion.snapshot.schemaVersionNo === "number") {
    return schemaVersion.snapshot.schemaVersionNo;
  }

  return fallbackSchemaVersionNo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createConditionRule(fields: FieldNode[]): ConditionRuleDraft {
  const firstField = fields[0]?.name ?? "";
  const secondField = fields[1]?.name ?? firstField;
  return {
    id: `condition_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    targetField: secondField,
    conditionField: firstField,
    operator: "eq",
    value: "",
    action: "show",
  };
}

function createValidationRule(fields: FieldNode[]): ValidationRuleDraft {
  return {
    id: `validation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    targetField: fields[0]?.name ?? "",
    type: "required",
    value: "",
    message: "请完成该字段",
  };
}

function updateConditionRule(
  setRules: Dispatch<SetStateAction<ConditionRuleDraft[]>>,
  id: string,
  patch: Partial<ConditionRuleDraft>,
) {
  setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
}

function updateValidationRule(
  setRules: Dispatch<SetStateAction<ValidationRuleDraft[]>>,
  id: string,
  patch: Partial<ValidationRuleDraft>,
) {
  setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
}

function ensureNewsQualityPreviewFields(schema: LabelHubSchema): LabelHubSchema {
  const isNewsTemplate =
    schema.meta.taskId === "task_news_quality" ||
    schema.meta.name.includes("新闻") ||
    schema.root.title?.includes("新闻");

  if (!isNewsTemplate) return schema;

  let changed = false;
  const children = schema.root.children.map((node) => {
    if (node.kind !== "FIELD" || node.name !== "rewriteSuggestion") return node;

    changed = true;
    return {
      ...node,
      id: node.id || ("rewrite_suggestion" as ID),
      title: node.title || "修改建议",
      type: "input.textarea",
      required: true,
      minRows: "minRows" in node ? node.minRows : 3,
      validations: [{ type: "required", message: "请填写修改建议" }],
    } as FieldNode;
  });

  const hasRewriteSuggestion = children.some((node) => node.kind === "FIELD" && node.name === "rewriteSuggestion");
  if (!hasRewriteSuggestion) {
    changed = true;
    children.splice(Math.max(children.length - 1, 0), 0, createRewriteSuggestionNode());
  }

  if (!changed) return schema;

  return {
    ...schema,
    root: {
      ...schema.root,
      children,
    },
  };
}

function createRewriteSuggestionNode(): SchemaNode {
  return {
    id: "rewrite_suggestion" as ID,
    kind: "FIELD",
    type: "input.textarea",
    name: "rewriteSuggestion",
    title: "修改建议",
    required: true,
    minRows: 3,
    validations: [{ type: "required", message: "请填写修改建议" }],
  } as FieldNode;
}

const CUSTOM_SCHEMA_PRESETS_KEY = "labelhub.owner.schema-presets.v1";

function readCustomSchemaPresets(): CustomSchemaPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_SCHEMA_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomSchemaPreset[]) : [];
  } catch {
    return [];
  }
}

function writeCustomSchemaPresets(presets: CustomSchemaPreset[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_SCHEMA_PRESETS_KEY, JSON.stringify(presets.slice(0, 12)));
}

function createBlankSchema(taskId: ID): LabelHubSchema {
  const now = new Date().toISOString();
  return {
    contractVersion: "1.1",
    schemaId: `schema_${taskId}_blank_${Date.now()}` as ID,
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      name: "未命名预设模板",
      description: "空白模板。",
      taskId,
      authorId: "usr_owner" as ID,
      createdAt: now,
      updatedAt: now,
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.section",
      title: "未命名预设模板",
      children: [],
    },
  };
}

function bindPresetToCurrentDraft(
  presetSchema: LabelHubSchema,
  currentSchema: LabelHubSchema,
  taskId: ID,
  taskTitle: string,
): LabelHubSchema {
  const now = new Date().toISOString();
  return {
    ...presetSchema,
    schemaId: currentSchema.schemaId,
    schemaDraftRevision: currentSchema.schemaDraftRevision,
    ...(currentSchema.schemaVersionId === undefined ? {} : { schemaVersionId: currentSchema.schemaVersionId }),
    ...(currentSchema.schemaVersionNo === undefined ? {} : { schemaVersionNo: currentSchema.schemaVersionNo }),
    status: "DRAFT",
    meta: {
      ...presetSchema.meta,
      name: presetSchema.meta.name || `${taskTitle}模板`,
      description: presetSchema.meta.description || `${taskTitle} - 自定义预设模板`,
      taskId,
      authorId: currentSchema.meta.authorId,
      createdAt: currentSchema.meta.createdAt,
      updatedAt: now,
    },
  };
}

function summarizeSchemaFields(schema: LabelHubSchema): string {
  const titles = collectFieldNodes(schema)
    .map((field) => field.title || field.name)
    .filter(Boolean)
    .slice(0, 4);
  return titles.length > 0 ? titles.join(" / ") : "空白模板";
}

function createFallbackSchema(taskId: string | undefined, taskTitle?: string): LabelHubSchema {
  const resolvedTaskId = resolveTaskId(taskId, "task_news_quality" as ID);
  const presetId = presetIdForTask(resolvedTaskId);
  return ensureNewsQualityPreviewFields(createSchemaFromPreset(presetId, resolvedTaskId, taskTitle ?? "当前任务"));
}

function presetIdForTask(taskId: string | undefined): string {
  if (taskId === "task_product_title") return "product_title";
  if (taskId === "task_news_quality") return "news_quality";
  return schemaPresetSummaries[0].id;
}

function presetIdForSchema(schema: LabelHubSchema): string {
  const matchedPreset = schemaPresetSummaries.find((preset) => schema.meta.name.includes(preset.title));
  return matchedPreset?.id ?? presetIdForTask(schema.meta.taskId);
}

function createSampleContext(schema: LabelHubSchema, task: Task | undefined, role: Role): LabelHubRuntimeContext {
  const fallbackSchemaVersionId = "sv_owner_preview" as ID;
  return {
    task: {
      id: task?.id ?? schema.meta.taskId,
      title: task?.title ?? schema.meta.name,
      status: task?.status ?? "DRAFT",
      activeSchemaVersionId: task?.activeSchemaVersionId ?? schema.schemaVersionId ?? fallbackSchemaVersionId,
    },
    schema: {
      schemaId: schema.schemaId,
      schemaVersionId: schema.schemaVersionId ?? fallbackSchemaVersionId,
      schemaVersionNo: schema.schemaVersionNo ?? 1,
      contractVersion: schema.contractVersion,
    },
    item: {
      id: "item_owner_preview",
      sourcePayload: {},
    },
    answers: {},
    system: {
      actor: { id: "usr_owner", role, displayName: "Owner" },
      role,
      now: new Date().toISOString(),
    },
  };
}

function resolveTaskId(taskId: string | undefined, fallbackTaskId: ID): ID {
  return (taskId ?? fallbackTaskId) as ID;
}

function appendNodeToRoot(schema: LabelHubSchema, type: NodeType): LabelHubSchema {
  const node = prepareNodeForAppsWebInsert(schema, createDefaultNode(type));
  return {
    ...schema,
    meta: { ...schema.meta, updatedAt: new Date().toISOString() },
    root: { ...schema.root, children: [...schema.root.children, node] },
  };
}

// ── 数据字段面板 ────────────────────────────────────────────────────────────
// 轻量 Owner 体验：读取已导入数据的 sourcePayload 字段，一键添加为 show.text 展示文本。
// 不做字段转换 / 自动 Schema 生成；友好名映射仅对通用字段名做中文美化，未命中回退字段名。

type DataFieldKind = "文本" | "数字" | "布尔" | "数组" | "对象" | "链接" | "空值";

// 字段角色：推荐展示 / 元数据 / 疑似答案(隐藏标签) / 其他。按字段名启发式归类（通用，不写死数据集）。
type FieldRole = "recommended" | "metadata" | "answer" | "other";

interface DataFieldInfo {
  name: string;
  kind: DataFieldKind;
  sample: string;
  role: FieldRole;
}

const RECOMMENDED_FIELD_NAMES = new Set([
  "prompt", "question", "query", "instruction",
  "content", "content_markdown", "text", "body", "passage",
  "model_answer", "answer", "response",
  "model_a_answer", "model_b_answer", "reference",
]);
const METADATA_FIELD_NAMES = new Set([
  "id", "lang", "language", "category", "difficulty",
  "source", "tags", "created_at", "updated_at", "media_type", "type",
]);
const ANSWER_FIELD_NAMES = new Set([
  "margin", "label", "gold", "ground_truth", "groundtruth", "target",
  "winner", "chosen", "score", "expected_label", "correct_answer",
  "gold_label", "gt", "preference", "preferred", "verdict", "is_correct",
]);

// 安全优先：先判疑似答案/隐藏标签（防答案泄露），再推荐展示，再元数据，最后兜底其他。
function classifyFieldRole(name: string): FieldRole {
  const n = name.toLowerCase();
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  const hasToken = (set: Set<string>) => tokens.some((t) => set.has(t));
  if (
    ANSWER_FIELD_NAMES.has(n) ||
    hasToken(ANSWER_FIELD_NAMES) ||
    /ground_?truth|gold|winner|chosen|correct|expected_label|is_?correct/.test(n)
  ) {
    return "answer";
  }
  if (RECOMMENDED_FIELD_NAMES.has(n) || hasToken(RECOMMENDED_FIELD_NAMES)) return "recommended";
  if (
    METADATA_FIELD_NAMES.has(n) ||
    hasToken(METADATA_FIELD_NAMES) ||
    /^id$|_id$|_at$|^created|^updated/.test(n)
  ) {
    return "metadata";
  }
  return "other";
}

const FIELD_SECTIONS: ReadonlyArray<{ role: FieldRole; title: string; desc: string }> = [
  { role: "recommended", title: "推荐展示字段", desc: "适合直接展示给标注员的内容字段。" },
  { role: "metadata", title: "元数据字段", desc: "数据的辅助信息，一般不必展示给标注员。" },
  { role: "answer", title: "疑似答案 / 隐藏标签字段", desc: "可能是答案或隐藏标签，默认禁止添加以防泄露。" },
  { role: "other", title: "其他字段", desc: "无法自动判断用途的字段，可按需添加。" },
];

const FRIENDLY_FIELD_TITLES: Record<string, string> = {
  prompt: "用户问题",
  model_answer: "模型回答",
  reference: "参考答案",
  expected_dimensions: "期望评估维度",
  content_markdown: "Markdown 内容",
  media_url: "媒体链接",
};

function friendlyFieldTitle(fieldName: string): string {
  return FRIENDLY_FIELD_TITLES[fieldName] ?? fieldName;
}

function isUrlLikeValue(value: string): boolean {
  const v = value.trim();
  return /^https?:\/\//i.test(v) || /^\/\//.test(v);
}

function inferDataFieldKind(value: unknown): DataFieldKind {
  if (value === null || value === undefined || value === "") return "空值";
  if (Array.isArray(value)) return value.length === 0 ? "空值" : "数组";
  if (typeof value === "boolean") return "布尔";
  if (typeof value === "number") return "数字";
  if (typeof value === "object") return "对象";
  if (typeof value === "string") return isUrlLikeValue(value) ? "链接" : "文本";
  return "文本";
}

function formatDataFieldSample(value: unknown): string {
  if (value === null || value === undefined) return "（空值）";
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text === "") return "（空值）";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

// 从已导入 items 派生字段列表：字段名跨条 union（保序），示例值取首个有值样本（无则取首条原值）。
function collectDataFields(items: DatasetItem[]): DataFieldInfo[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const item of items.slice(0, 50)) {
    for (const key of Object.keys(item.sourcePayload ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order.map((name) => {
    let sampleValue: unknown;
    for (const item of items) {
      const v = (item.sourcePayload ?? {})[name];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (!empty) {
        sampleValue = v;
        break;
      }
    }
    if (sampleValue === undefined && items.length > 0) {
      sampleValue = (items[0].sourcePayload ?? {})[name];
    }
    return {
      name,
      kind: inferDataFieldKind(sampleValue),
      sample: formatDataFieldSample(sampleValue),
      role: classifyFieldRole(name),
    };
  });
}

// 一键添加：创建 show.text 节点，绑定原始字段并套用友好标题；去掉默认空 fallback，
// 使字段缺失时能命中 ShowItemRenderer 的"字段不存在"友好提示。
function appendShowItemField(schema: LabelHubSchema, fieldName: string): LabelHubSchema {
  const base = createDefaultNode("show.text") as ShowItemNode;
  const showNode = {
    ...base,
    title: friendlyFieldTitle(fieldName),
    sourcePath: `$.item.sourcePayload.${fieldName}`,
    transform: undefined,
  } as ShowItemNode;
  const node = prepareNodeForAppsWebInsert(schema, showNode);
  return {
    ...schema,
    meta: { ...schema.meta, updatedAt: new Date().toISOString() },
    root: { ...schema.root, children: [...schema.root.children, node] },
  };
}

function prepareNodeForAppsWebInsert(schema: LabelHubSchema, node: SchemaNode): SchemaNode {
  const usedNodeIds = new Set(flattenNodes(schema).map((item) => item.id));
  const usedFieldNames = new Set(collectFieldNodes(schema).map((field) => field.name));
  return withUniqueIdentity(cloneValue(node), usedNodeIds, usedFieldNames);
}

function withUniqueIdentity(node: SchemaNode, usedNodeIds: Set<string>, usedFieldNames: Set<string>): SchemaNode {
  const id = uniqueValue(node.id, usedNodeIds);
  usedNodeIds.add(id);

  if (node.kind === "FIELD") {
    const name = uniqueValue(node.name, usedFieldNames);
    usedFieldNames.add(name);
    return { ...node, id, name } as FieldNode;
  }

  if (node.kind === "CONTAINER") {
    return {
      ...node,
      id,
      children: node.children.map((child) => withUniqueIdentity(child, usedNodeIds, usedFieldNames)),
    };
  }

  return { ...node, id };
}

function uniqueValue(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;

  let index = 2;
  while (used.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
