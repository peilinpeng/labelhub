import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SchemaDesigner } from "@labelhub/schema-designer";
import { createNewsQualitySchema } from "@labelhub/schema-core";
import { RoutePath, Role } from "../../app/routes";
import { fetchSchemaDraft, fetchServerRegistry, fetchTask, saveSchemaDraft } from "../../api/owner";
import { tasksMock } from "../../mocks/data/tasks.mock";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card } from "../../ui/primitives";
import type {
  ID,
  LabelHubRuntimeContext,
  LabelHubSchema,
  SchemaValidationResult,
  ServerComponentRegistryItem,
  Task,
} from "@labelhub/contracts";

interface OwnerSchemaPageProps {
  role: Role;
}

function taskDescription(task: Task): string {
  const description = task.description?.trim();
  if (!description || description.startsWith("task_") || description.includes("Owner:")) {
    return "配置当前任务的字段结构、填写说明、校验规则与辅助能力。";
  }
  return description;
}

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>([]);
  const [schema, setSchema] = useState<LabelHubSchema>(() => createFallbackSchema(taskId));
  const [task, setTask] = useState<Task | undefined>(() => tasksMock.find((item) => item.id === taskId));
  const [validation, setValidation] = useState<SchemaValidationResult | undefined>();
  const [statusMessage, setStatusMessage] = useState("正在加载模板设计器");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

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

        if (cancelled) {
          return;
        }

        if (registryResult.status === "fulfilled") {
          setServerRegistry(registryResult.value);
        }

        const resolvedTask = taskResult.status === "fulfilled"
          ? taskResult.value
          : tasksMock.find((item) => item.id === currentTaskId);

        if (resolvedTask) {
          setTask(resolvedTask);
        } else {
          setTask(undefined);
        }

        if (draftResult.status === "fulfilled") {
          setSchema(draftResult.value);
          setStatusMessage("已加载模板草稿");
        } else {
          setSchema(createFallbackSchema(currentTaskId, resolvedTask?.title));
          setStatusMessage("未找到模板草稿，已载入本地模板");
        }
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : "模板设计器加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => {
    if (!previewExpanded) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewExpanded]);

  const sampleContext = useMemo(() => createSampleContext(schema, task, role), [role, schema, task]);
  const templateTitle = task ? `${task.title} 模板` : schema.meta.name;

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
    } catch (error) {
      setStatusMessage(error instanceof Error ? `保存失败：${error.message}` : "保存失败");
      setPublishNotice("草稿已保留在当前页面，请确认后端服务状态。");
    } finally {
      setSaving(false);
    }
  };

  const confirmPublish = () => {
    setPublishNotice("发布成功，任务已回到任务管理列表。");
    window.setTimeout(() => navigate(RoutePath.OWNER_TASKS), 650);
  };

  const handlePublish = () => {
    if (shouldSuppressConfirm(CONFIRM_KEYS.publish)) {
      confirmPublish();
      return;
    }
    setPublishConfirmOpen(true);
  };

  const handleDesignerCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".schema-designer-preview__surface")) {
      setPreviewExpanded(true);
    }
  };

  if (loading) {
    return <Card className="state-panel">加载模板组件中...</Card>;
  }

  if (!task) {
    return <Card className="state-panel danger-text">任务不存在：{taskId}</Card>;
  }

  return (
    <div className={`page-stack schema-workbench-page${previewExpanded ? " schema-preview-expanded" : ""}`}>
      <div className="page-header schema-workbench-header">
        <div>
          <Badge tone="primary">模板配置</Badge>
          <h2 className="page-title">模板配置</h2>
          <p className="page-subtitle">为当前任务配置动态标注 Schema，并预览标注员填写效果</p>
          <div className="meta-line">
            <Badge tone="default">Task {task.id}</Badge>
            <span>{templateTitle}</span>
            <span>{taskDescription(task)}</span>
            <span>{statusMessage}</span>
            <Badge tone={validation?.valid === false ? "danger" : "success"}>
              {validation?.valid === false ? "校验未通过" : `组件库 ${serverRegistry.length} 项`}
            </Badge>
          </div>
        </div>
        <div className="schema-workbench-actions">
          <Button type="button" disabled={saving} onClick={() => void handleSaveDraft()}>
            {saving ? "保存中..." : "保存草稿"}
          </Button>
          <Button type="button" onClick={() => navigate("/labeler/workspace/asn_1001")}>
            预览标注台
          </Button>
          <Button type="button" tone="primary" onClick={handlePublish}>
            发布任务
          </Button>
        </div>
      </div>

      {publishNotice ? (
        <Card className="labeler-return-card">
          <Badge tone="success">已更新</Badge>
          <p>{publishNotice}</p>
        </Card>
      ) : null}

      <Card className="schema-designer-shell">
        <div className="schema-canvas-header">
          <div>
            <Badge tone="primary">Task {task.id}</Badge>
            <h3>{templateTitle}</h3>
            <p>{taskDescription(task)}</p>
          </div>
          <Link to={RoutePath.OWNER_TASKS} className="lh-button">
            返回任务
          </Link>
        </div>

        {previewExpanded ? (
          <>
            <button
              type="button"
              className="schema-preview-backdrop"
              aria-label="关闭预览"
              onClick={() => setPreviewExpanded(false)}
            />
            <button type="button" className="schema-preview-close" onClick={() => setPreviewExpanded(false)}>
              关闭预览
            </button>
          </>
        ) : null}

        <div className="schema-canvas" onClick={handleDesignerCanvasClick}>
          <SchemaDesigner
            schema={schema}
            serverRegistry={serverRegistry}
            sampleContext={sampleContext}
            readonly={false}
            onSchemaChange={setSchema}
          />
        </div>
      </Card>

      <ConfirmDialog
        open={publishConfirmOpen}
        title="确认发布任务？"
        description="发布后，标注员将可以在任务市场领取该任务。"
        confirmText="发布任务"
        cancelText="取消"
        suppressLabel="本次会话不再提醒发布确认"
        onCancel={() => setPublishConfirmOpen(false)}
        onConfirm={(suppress) => {
          if (suppress) {
            suppressConfirmForSession(CONFIRM_KEYS.publish);
          }
          setPublishConfirmOpen(false);
          confirmPublish();
        }}
      />
    </div>
  );
}

function createFallbackSchema(taskId: string | undefined, taskTitle?: string): LabelHubSchema {
  const schema = createNewsQualitySchema();
  const resolvedTaskId = resolveTaskId(taskId, schema.meta.taskId);
  return {
    ...schema,
    meta: {
      ...schema.meta,
      name: taskTitle ? `${taskTitle} 模板` : schema.meta.name,
      taskId: resolvedTaskId,
      updatedAt: new Date().toISOString(),
    },
  };
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
      actor: {
        id: "usr_owner",
        role,
        displayName: "Owner",
      },
      role,
      now: new Date().toISOString(),
    },
  };
}

function resolveTaskId(taskId: string | undefined, fallbackTaskId: ID): ID {
  return (taskId ?? fallbackTaskId) as ID;
}
