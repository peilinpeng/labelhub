import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SchemaDesigner } from "@labelhub/schema-designer";
import { createNewsQualitySchema } from "@labelhub/schema-core";
import { RoutePath, Role } from "../../app/routes";
import { fetchSchemaDraft, fetchServerRegistry, fetchTask, saveSchemaDraft } from "../../api/owner";
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

export default function OwnerSchemaPage({ role }: OwnerSchemaPageProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>([]);
  const [schema, setSchema] = useState<LabelHubSchema>(() => createFallbackSchema(taskId));
  const [task, setTask] = useState<Task | undefined>();
  const [validation, setValidation] = useState<SchemaValidationResult | undefined>();
  const [statusMessage, setStatusMessage] = useState("正在加载模板设计器");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

        if (taskResult.status === "fulfilled") {
          setTask(taskResult.value);
        }

        if (draftResult.status === "fulfilled") {
          setSchema(draftResult.value);
          setStatusMessage("已加载 schema draft");
        } else {
          setSchema(createFallbackSchema(currentTaskId));
          setStatusMessage("未找到 schema draft，已载入演示模板");
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

  const sampleContext = useMemo(
    () => createSampleContext(schema, task, role),
    [role, schema, task],
  );

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
      setStatusMessage(`草稿已保存，修订号 ${response.schemaDraftRevision}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? `保存失败：${error.message}` : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Card className="state-panel">加载模板物料中...</Card>;
  }

  return (
    <div className="page-stack schema-workbench-page">
      <div className="page-header schema-workbench-header">
        <div>
          <Badge tone="primary">Owner Template</Badge>
          <h2 className="page-title">模板配置</h2>
          <p className="page-subtitle">为当前任务配置动态标注 Schema，并预览标注员填写效果</p>
          <div className="meta-line">
            <span>{task?.title ?? schema.meta.name}</span>
            <span>{statusMessage}</span>
            <Badge tone={validation?.valid === false ? "danger" : "success"}>
              {validation?.valid === false ? "校验未通过" : `${serverRegistry.length} 物料可用`}
            </Badge>
          </div>
        </div>
        <div className="schema-workbench-actions">
          <Button type="button" disabled={saving} onClick={() => void handleSaveDraft()}>
            {saving ? "保存中..." : "保存草稿"}
          </Button>
          <Button type="button" onClick={() => setStatusMessage("预览区域已在设计器中实时更新")}>
            预览标注台
          </Button>
          <Button type="button" tone="primary" onClick={() => setStatusMessage("发布流程保持当前占位，后续接入两阶段发布 API")}>
            发布任务
          </Button>
        </div>
      </div>

      <Card className="schema-designer-shell">
        <div className="schema-canvas-header">
          <div>
            <Badge tone="primary">Task {resolveTaskId(taskId, schema.meta.taskId)}</Badge>
            <h3>{schema.meta.name}</h3>
            <p>使用真实 SchemaDesigner 编辑 schema、配置属性并实时预览</p>
          </div>
          <Link to={RoutePath.OWNER_TASKS} className="lh-button">
            返回任务
          </Link>
        </div>

        <SchemaDesigner
          schema={schema}
          serverRegistry={serverRegistry}
          sampleContext={sampleContext}
          readonly={false}
          onSchemaChange={setSchema}
        />
      </Card>
    </div>
  );
}

function createFallbackSchema(taskId: string | undefined): LabelHubSchema {
  const schema = createNewsQualitySchema();
  const resolvedTaskId = resolveTaskId(taskId, schema.meta.taskId);
  return {
    ...schema,
    meta: {
      ...schema.meta,
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
