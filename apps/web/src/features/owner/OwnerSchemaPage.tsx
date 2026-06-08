import { useCallback, useEffect, useMemo, useState, type Dispatch, type DragEvent, type MouseEvent, type SetStateAction } from "react";
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
  Task,
} from "@labelhub/contracts";
import { RoutePath, Role } from "../../app/routes";
import { queryAuditEvents } from "../../api/audit";
import { fetchSchemaDraft, fetchSchemaVersion, fetchServerRegistry, fetchTask, publishSchema, publishTask, saveSchemaDraft } from "../../api/owner";
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

interface OwnerSchemaPageProps {
  role: Role;
}

interface QuickMaterial {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
}

type NoticeTone = "success" | "danger" | "info";

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
  const [, setValidation] = useState<SchemaValidationResult | undefined>();
  const [statusMessage, setStatusMessage] = useState("正在加载模板编辑器");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [publishNoticeTone, setPublishNoticeTone] = useState<NoticeTone>("info");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [publishPreviewOpen, setPublishPreviewOpen] = useState(false);
  const [publishPreview, setPublishPreview] = useState<PublishPreviewState | undefined>();
  const [publishPreviewPreparing, setPublishPreviewPreparing] = useState(false);
  const [activePresetId, setActivePresetId] = useState(() => presetIdForTask(taskId));
  const [dropActive, setDropActive] = useState(false);
  const [conditionRules, setConditionRules] = useState<ConditionRuleDraft[]>([]);
  const [validationRules, setValidationRules] = useState<ValidationRuleDraft[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditEventsLoading, setAuditEventsLoading] = useState(false);
  const [auditEventsError, setAuditEventsError] = useState<string | null>(null);
  const [customPresets, setCustomPresets] = useState<CustomSchemaPreset[]>(() => readCustomSchemaPresets());
  const [presetTitleInput, setPresetTitleInput] = useState("");
  const [presetDescriptionInput, setPresetDescriptionInput] = useState("");

  const loadAuditEvents = useCallback(async (): Promise<void> => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    try {
      setAuditEventsLoading(true);
      setAuditEventsError(null);
      const response = await queryAuditEvents({ taskId: currentTaskId, limit: 20 });
      setAuditEvents(response.events);
    } catch (error) {
      const message = error instanceof Error ? error.message : "审计日志加载失败。";
      setAuditEventsError(`审计日志加载失败：${message}`);
    } finally {
      setAuditEventsLoading(false);
    }
  }, [schema.meta.taskId, taskId]);

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

  useEffect(() => {
    void loadAuditEvents();
  }, [loadAuditEvents]);

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

  // 模板状态人话化：草稿 / 已发布 / 有未发布修改。仅依据真实 schema.status 与
  // task.activeSchemaVersionId 推导，数据不足时退回「本地编辑草稿」，不伪造已发布。
  const templateStatus = useMemo<{ label: string; tone: "success" | "warning" | "primary"; hint: string }>(() => {
    if (schema.status === "PUBLISHED") {
      return { label: "已发布", tone: "success", hint: `当前版本 ${schemaRevisionLabel(schema)}，可用于任务分发与标注。` };
    }
    if (task?.activeSchemaVersionId !== undefined) {
      return { label: "有未发布修改", tone: "warning", hint: "已存在发布版本，当前为草稿修改，发布后才会对标注员生效。" };
    }
    return { label: "草稿", tone: "primary", hint: "当前模板状态来自本地编辑草稿，保存草稿不等于发布。" };
  }, [schema, task]);

  // 发布前的本地自检结果人话化：只展示可读 message（必要时带字段标题），不暴露 code / path / 原始对象。
  const validationSummary = useMemo<{ tone: "success" | "warning" | "danger"; badge: string; errors: string[]; warnings: string[] }>(() => {
    let result: SchemaValidationResult;
    try {
      result = validateDesignerSchema(schema);
    } catch {
      return { tone: "warning", badge: "暂时无法自检", errors: [], warnings: ["模板自检暂时不可用，可继续在画布中调整。"] };
    }
    const titleByNodeId = new Map(fieldNodes.map((field) => [field.id, field.title || field.name]));
    const toText = (issue: SchemaValidationError): string => {
      const fieldTitle = issue.nodeId !== undefined ? titleByNodeId.get(issue.nodeId) : undefined;
      return fieldTitle ? `「${fieldTitle}」${issue.message}` : issue.message;
    };
    const errors = result.errors.map(toText);
    const warnings = result.warnings.map(toText);
    if (!result.valid) {
      return { tone: "danger", badge: "暂不可发布", errors, warnings };
    }
    return { tone: warnings.length > 0 ? "warning" : "success", badge: warnings.length > 0 ? "可发布 · 有提醒" : "可以发布", errors, warnings };
  }, [schema, fieldNodes]);

  // 统一的页面提示出口：区分成功 / 失败 / 中性，避免失败提示仍显示成功样式。
  const showNotice = (message: string | null, tone: NoticeTone = "info"): void => {
    setPublishNotice(message);
    if (message !== null) setPublishNoticeTone(tone);
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
    } catch {
      setStatusMessage("草稿保存失败，当前修改仍保留在本页。");
      showNotice("草稿保存失败，请稍后重试。当前修改仍保留在本页，可重试保存。", "danger");
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
      const published = await publishSchema(currentTaskId);
      const schemaVersionId = readPublishedSchemaVersionId(published.schemaVersion, draftResponse.schema.schemaVersionId);

      failureStage = "PUBLISH_TASK";
      const publishedTask = await publishTask(currentTaskId, { schemaVersionId });
      setTask(publishedTask.task);
      await appendSchemaPublishedAuditEvent({
        schema: draftResponse.schema,
        task: publishedTask.task,
        schemaVersionId,
        schemaVersionNo: readPublishedSchemaVersionNo(published.schemaVersion, draftResponse.schema.schemaVersionNo),
      });
      await loadAuditEvents();
      showNotice("发布成功，任务已进入任务市场，审计日志已刷新。", "success");
    } catch (error) {
      await appendSchemaPublishFailedAuditEvent({
        schema,
        task,
        stage: failureStage,
        error,
      });
      await loadAuditEvents();
      const message = error instanceof Error ? error.message : "发布失败，请稍后重试。";
      setStatusMessage("发布失败，请检查后端服务或当前 schema 状态。");
      showNotice(`发布失败：${message}`, "danger");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (): Promise<void> => {
    try {
      setPublishPreviewPreparing(true);
      showNotice(null);
      const preview = await buildPublishPreview({
        schema,
        task,
      });
      await appendPublishPreviewAuditEvents(createOwnerPublishAuditPreview(schema, task, preview));
      await loadAuditEvents();
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
    setActivePresetId(preset.id);
    if (preset.source === "custom") {
      setSchema(rebindPresetSchema(preset.schema, currentTaskId, taskTitle));
    } else {
      setSchema(ensureNewsQualityPreviewFields(createSchemaFromPreset(preset.id, currentTaskId, taskTitle)));
    }
    setValidation(undefined);
    setStatusMessage(`已加载「${preset.title}」预设模板`);
    showNotice(`已将「${preset.title}」加载到当前任务「${taskTitle}」下，可继续在画布中调整字段。`, "info");
  };

  const handleCreateBlankPresetTemplate = () => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    const blankSchema = createBlankSchema(currentTaskId);
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
            这里配置标注任务模板，决定标注员作答时看到哪些字段与校验。保存草稿不等于发布；发布后该版本才能用于任务创建、分发与标注。
          </p>
        </div>
        <div className="schema-builder-toolbar__actions">
          <Button type="button" onClick={() => setPreviewExpanded(true)}>
            预览
          </Button>
          <Button type="button" onClick={exportSchemaJson}>
            导出 JSON
          </Button>
          <Button type="button" tone="primary" disabled={saving || publishPreviewPreparing} onClick={() => void handlePublish()}>
            {publishPreviewPreparing ? "检查中..." : "保存并发布模板"}
          </Button>
        </div>
      </Card>

      <div className="schema-builder-statusbar">
        <Badge tone={templateStatus.tone}>模板状态：{templateStatus.label}</Badge>
        <Badge tone="primary">当前模板版本：第 {schema.schemaDraftRevision ?? schema.schemaVersionNo ?? 1} 版</Badge>
        <Badge tone="default">绑定任务：{task.title || "当前任务"}</Badge>
        <Badge tone="success">可用字段组件：{serverRegistry.length} 类</Badge>
        <span>{statusMessage}</span>
      </div>
      <p className="schema-builder-status-hint">{templateStatus.hint}</p>

      {publishNotice ? (
        <Card className={`labeler-return-card schema-builder-notice schema-builder-notice--${publishNoticeTone}`}>
          <Badge tone={publishNoticeTone === "danger" ? "danger" : publishNoticeTone === "success" ? "success" : "primary"}>
            {publishNoticeTone === "danger" ? "操作失败" : publishNoticeTone === "success" ? "已更新" : "提示"}
          </Badge>
          <p>{publishNotice}</p>
        </Card>
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
          <div className="schema-canvas-header__actions">
            <Button type="button" disabled={saving} onClick={() => void handleSaveDraft()}>
              {saving ? "保存中..." : "保存草稿"}
            </Button>
            <Link to={RoutePath.OWNER_TASKS} className="lh-button">
              返回任务
            </Link>
          </div>
        </div>

        {previewExpanded ? (
          <>
            <button type="button" className="schema-preview-backdrop" aria-label="关闭预览" onClick={() => setPreviewExpanded(false)} />
            <button type="button" className="schema-preview-close" onClick={() => setPreviewExpanded(false)}>
              关闭预览
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
            onSchemaChange={setSchema}
          />
        </div>
      </Card>

      <Card className="schema-audit-entry">
        <div>
          <strong>发布与审计记录</strong>
          <p>
            {auditEventsError
              ? "审计记录加载失败，完整记录可在质量中心查看。"
              : auditEventsLoading
                ? "正在同步审计记录..."
                : `本任务已有 ${auditEvents.length} 条审计记录。发布与审计记录可在质量中心查看。`}
          </p>
        </div>
        <Link to="/owner/quality" className="lh-button">
          查看质量中心 →
        </Link>
      </Card>

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

async function buildPublishPreview({
  schema,
  task,
}: {
  schema: LabelHubSchema;
  task: Task | undefined;
}): Promise<PublishPreviewState> {
  const schemaValidation = validateDesignerSchema(schema);
  const deprecationResult = validateDeprecationRules(schema);
  const activeSchemaVersionId = task?.activeSchemaVersionId;
  let compatibilityReport: CompatibilityReport | undefined;
  let manualMappingSlots: ManualMappingSlot[] = [];
  let isFirstPublish = true;
  let oldSchemaStatusMessage: string | undefined;

  if (activeSchemaVersionId !== undefined) {
    try {
      const schemaVersion = await fetchSchemaVersion(activeSchemaVersionId);
      const oldSchema = schemaVersion.snapshot;
      compatibilityReport = checkBackwardCompatibility(oldSchema, schema);
      manualMappingSlots = createMigrationPlan(oldSchema, schema).manualMappingSlots;
      isFirstPublish = false;
    } catch (error) {
      oldSchemaStatusMessage = error instanceof Error
        ? `未能加载上一已发布版本，本次仅执行当前草稿本地检查：${error.message}`
        : "未能加载上一已发布版本，本次仅执行当前草稿本地检查。";
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

function rebindPresetSchema(schema: LabelHubSchema, taskId: ID, taskTitle: string): LabelHubSchema {
  const now = new Date().toISOString();
  return {
    ...schema,
    schemaId: `schema_${taskId}_${Date.now()}` as ID,
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      ...schema.meta,
      name: schema.meta.name || `${taskTitle}模板`,
      description: schema.meta.description || `${taskTitle} - 自定义预设模板`,
      taskId,
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
