import { useEffect, useMemo, useState, type Dispatch, type DragEvent, type MouseEvent, type SetStateAction } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  CompatibilityReport,
  FieldNode,
  ID,
  LabelHubRuntimeContext,
  LabelHubSchema,
  ManualMappingSlot,
  NodeType,
  SchemaNode,
  SchemaValidationResult,
  ServerComponentRegistryItem,
  Task,
} from "@labelhub/contracts";
import { RoutePath, Role } from "../../app/routes";
import { fetchSchemaDraft, fetchSchemaVersion, fetchServerRegistry, fetchTask, publishSchema, publishTask, saveSchemaDraft } from "../../api/owner";
import { tasksMock } from "../../mocks/data/tasks.mock";
import { findLocalTaskById } from "../../mocks/local-task-store";
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

function taskDescription(task: Task): string {
  const description = task.description?.trim();
  if (!description || description.startsWith("task_") || description.includes("Owner:")) {
    return "配置当前任务的字段结构、填写说明、校验规则与辅助能力。";
  }
  return description;
}

function schemaRevisionLabel(schema: LabelHubSchema): string {
  return `r${schema.schemaDraftRevision ?? schema.schemaVersionNo ?? 1}`;
}

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>(localServerComponentRegistry);
  const [schema, setSchema] = useState<LabelHubSchema>(() => createFallbackSchema(taskId));
  const [task, setTask] = useState<Task | undefined>(() => findLocalTaskById(taskId) ?? tasksMock.find((item) => item.id === taskId));
  const [, setValidation] = useState<SchemaValidationResult | undefined>();
  const [statusMessage, setStatusMessage] = useState("正在加载模板编辑器");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [publishPreviewOpen, setPublishPreviewOpen] = useState(false);
  const [publishPreview, setPublishPreview] = useState<PublishPreviewState | undefined>();
  const [publishPreviewPreparing, setPublishPreviewPreparing] = useState(false);
  const [activePresetId, setActivePresetId] = useState(() => presetIdForTask(taskId));
  const [dropActive, setDropActive] = useState(false);
  const [conditionRules, setConditionRules] = useState<ConditionRuleDraft[]>([]);
  const [validationRules, setValidationRules] = useState<ValidationRuleDraft[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedMaterialLabel, setSelectedMaterialLabel] = useState<string | null>(null);

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
            : findLocalTaskById(currentTaskId) ?? tasksMock.find((item) => item.id === currentTaskId);
        setTask(resolvedTask);

        if (draftResult.status === "fulfilled") {
          setSchema(ensureNewsQualityPreviewFields(draftResult.value));
          setActivePresetId(presetIdForSchema(draftResult.value));
          setStatusMessage("已加载模板草稿");
        } else {
          const fallbackSchema = createFallbackSchema(currentTaskId, resolvedTask?.title);
          setSchema(fallbackSchema);
          setActivePresetId(presetIdForSchema(fallbackSchema));
          setStatusMessage("已加载本地模板");
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
    if (!previewExpanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewExpanded]);

  useEffect(() => {
    if (!selectedMaterialLabel) return;

    const timer = window.setTimeout(() => {
      replaceInspectorSubtitle(selectedMaterialLabel);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [schema, selectedMaterialLabel]);

  const sampleContext = useMemo(() => createSampleContext(schema, task, role), [role, schema, task]);
  const fieldNodes = useMemo(() => collectFieldNodes(schema), [schema]);
  const templateTitle = schema.meta.name;
  const registrySourceLabel = serverRegistry === localServerComponentRegistry ? "本地组件库" : "服务端组件库";

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
      setPublishNotice("模板草稿已保存。");
    } catch {
      setStatusMessage("后端暂不可用，当前模板保留在页面中。");
      setPublishNotice("后端暂不可用，当前修改已保留在本页，可继续预览和发布演示。");
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
    setPublishNotice("Schema JSON 已导出。");
  };

  const confirmPublish = async (preview: PublishPreviewState | undefined): Promise<void> => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    let failureStage: OwnerPublishFailureStage = "SAVE_DRAFT";
    try {
      setSaving(true);
      setPublishNotice(null);
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
      await publishTask(currentTaskId, { schemaVersionId });
      await appendSchemaPublishedAuditEvent({
        schema: draftResponse.schema,
        task,
        schemaVersionId,
        schemaVersionNo: readPublishedSchemaVersionNo(published.schemaVersion, draftResponse.schema.schemaVersionNo),
      });
      setPublishNotice("发布成功，任务已进入任务市场。");
      window.setTimeout(() => navigate(RoutePath.OWNER_TASKS), 650);
    } catch (error) {
      await appendSchemaPublishFailedAuditEvent({
        schema,
        task,
        stage: failureStage,
        error,
      });
      const message = error instanceof Error ? error.message : "发布失败，请稍后重试。";
      setStatusMessage("发布失败，请检查后端服务或当前 schema 状态。");
      setPublishNotice(`发布失败：${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (): Promise<void> => {
    try {
      setPublishPreviewPreparing(true);
      setPublishNotice(null);
      const preview = await buildPublishPreview({
        schema,
        task,
      });
      await appendPublishPreviewAuditEvents(createOwnerPublishAuditPreview(schema, task, preview));
      setPublishPreview(preview);
      setPublishPreviewOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成发布前检查失败。";
      setPublishNotice(`发布前检查失败：${message}`);
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
    const materialLabel = nodeCard ? getMaterialLabelFromNodeCard(nodeCard) : null;
    const directControl = target.closest("button, a, input, textarea, select, label");
    if (directControl) {
      if (directControl.textContent?.trim().includes("选择") && materialLabel) {
        setSelectedMaterialLabel(materialLabel);
        window.setTimeout(() => replaceInspectorSubtitle(materialLabel), 0);
      }
      return;
    }

    if (!nodeCard) return;

    const selectButton = Array.from(nodeCard.querySelectorAll("button")).find((button) =>
      button.textContent?.trim().includes("选择"),
    );
    if (materialLabel) {
      setSelectedMaterialLabel(materialLabel);
      window.setTimeout(() => replaceInspectorSubtitle(materialLabel), 0);
    }
    selectButton?.click();
  };

  const handleLoadPreset = (preset: (typeof schemaPresetSummaries)[number]) => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    const taskTitle = task?.title ?? "当前任务";
    setActivePresetId(preset.id);
    setSchema(ensureNewsQualityPreviewFields(createSchemaFromPreset(preset.id, currentTaskId, taskTitle)));
    setValidation(undefined);
    setStatusMessage(`已加载「${preset.title}」预设模板`);
    setPublishNotice(`已将「${preset.title}」加载到当前任务「${taskTitle}」下，可继续在画布中调整字段。`);
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
    return <Card className="state-panel danger-text">任务不存在：{taskId}</Card>;
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
            模板搭建器 <span>(Designer)</span>
          </h2>
          <p>Schema 与渲染解耦：左侧组件库，中间画布，右侧属性与预览。</p>
        </div>
        <div className="schema-builder-toolbar__actions">
          <Button type="button" onClick={() => navigate("/labeler/workspace/asn_1001")}>
            预览
          </Button>
          <Button type="button" onClick={exportSchemaJson}>
            导出 Schema JSON
          </Button>
          <Button type="button" tone="primary" disabled={saving || publishPreviewPreparing} onClick={() => void handlePublish()}>
            {publishPreviewPreparing ? "检查中..." : `保存并发布版本 ${schemaRevisionLabel(schema)}`}
          </Button>
        </div>
      </Card>

      <div className="schema-builder-statusbar">
        <Badge tone="primary">当前版本 {schemaRevisionLabel(schema)}</Badge>
        <Badge tone="default">绑定任务 {task.id}</Badge>
        <Badge tone="success">
          {registrySourceLabel} {serverRegistry.length} 项
        </Badge>
        <span>{statusMessage}</span>
      </div>

      {publishNotice ? (
        <Card className="labeler-return-card schema-builder-notice">
          <Badge tone="success">已更新</Badge>
          <p>{publishNotice}</p>
        </Card>
      ) : null}

      <Card className="schema-preset-panel schema-preset-panel--compact">
        <div className="schema-preset-heading">
          <div>
            <h3>常用预设模板</h3>
            <p>选择一个起点加载到当前任务，任务归属不变，后续仍可在 Schema 画布中继续编辑。</p>
          </div>
          <Badge tone="primary">可直接加载</Badge>
        </div>
        <div className="schema-preset-grid schema-preset-grid--compact">
          {schemaPresetSummaries.map((preset) => (
            <button
              className={["schema-preset-card", activePresetId === preset.id ? "schema-preset-card--active" : ""]
                .filter(Boolean)
                .join(" ")}
              key={preset.id}
              type="button"
              onClick={() => handleLoadPreset(preset)}
            >
              <span>{activePresetId === preset.id ? "当前模板" : "预设模板"}</span>
              <strong>{preset.title}</strong>
              <small>{preset.description}</small>
              <em>{preset.fields}</em>
            </button>
          ))}
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
            <Badge tone="primary">Task {task.id}</Badge>
            <h3>{templateTitle}</h3>
            <p>{taskDescription(task)}</p>
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

function getMaterialLabelFromNodeCard(nodeCard: Element): string | null {
  const text = nodeCard.textContent ?? "";
  const material = quickMaterials.find((item) => text.includes(item.type));
  return material?.label ?? null;
}

function replaceInspectorSubtitle(materialLabel: string): void {
  const subtitle = document.querySelector<HTMLParagraphElement>(
    ".schema-builder-page .schema-designer-layout__inspector .schema-designer-panel__header p",
  );
  if (subtitle) {
    subtitle.textContent = materialLabel;
  }

  const badge = document.querySelector<HTMLSpanElement>(
    ".schema-builder-page .schema-designer-layout__inspector .schema-designer-panel__header > span",
  );
  if (badge && badge.textContent?.trim() === "SHOW_ITEM") {
    badge.textContent = materialLabel;
  }
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
      sourcePayload: {
        title: "示例新闻标题",
        body: "这是一段用于模板预览的新闻正文，Owner 可以用它检查 ShowItem、字段输入和 AI Assist 的展示效果。",
        source: "Mock Preview",
      },
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
