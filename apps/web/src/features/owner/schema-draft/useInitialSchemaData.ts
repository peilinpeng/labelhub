import { useEffect, useState } from "react";
import type { LabelHubSchema, ServerComponentRegistryItem, Task } from "@labelhub/contracts";
import {
  fetchSchemaDraft,
  fetchServerRegistry,
  fetchTask,
  fetchTaskStats,
  type TaskStats,
} from "../../../api/owner";
import { listItems } from "../../../api/dataset";
import { getReviewConfig } from "../../../api/reviewer";
import { localServerComponentRegistry } from "../localComponentRegistry";
import {
  collectDataFields,
  createFallbackSchema,
  ensureNewsQualityPreviewFields,
  resolveTaskId,
  type DataFieldInfo,
} from "../schema-normalization";

export function useInitialSchemaData(taskId: string | undefined, versionRefreshKey: number) {
  const [serverRegistry, setServerRegistry] = useState<ServerComponentRegistryItem[]>(localServerComponentRegistry);
  const [schema, setSchema] = useState<LabelHubSchema>(() => createFallbackSchema(taskId));
  const [task, setTask] = useState<Task | undefined>();
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [datasetItemStats, setDatasetItemStats] = useState<{ total: number; available: number } | null>(null);
  const [datasetFields, setDatasetFields] = useState<DataFieldInfo[]>([]);
  const [taskStatsLoaded, setTaskStatsLoaded] = useState(false);
  const [aiConfigStatus, setAiConfigStatus] = useState<"loading" | "configured" | "missing" | "error">("loading");
  const [aiConfigEnabled, setAiConfigEnabled] = useState<boolean | null>(null);
  const [statusMessage, setStatusMessage] = useState("正在加载模板编辑器");
  const [loading, setLoading] = useState(true);

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

        setServerRegistry(
          registryResult.status === "fulfilled" && registryResult.value.length > 0
            ? registryResult.value
            : localServerComponentRegistry,
        );
        const resolvedTask = taskResult.status === "fulfilled" ? taskResult.value : undefined;
        setTask(resolvedTask);

        if (draftResult.status === "fulfilled") {
          setSchema(ensureNewsQualityPreviewFields(draftResult.value));
          setStatusMessage("已加载模板草稿");
        } else if (resolvedTask !== undefined) {
          const fallbackSchema = createFallbackSchema(currentTaskId, resolvedTask.title);
          setSchema({
            ...fallbackSchema,
            meta: {
              ...fallbackSchema.meta,
              name: resolvedTask.title || fallbackSchema.meta.name,
              description: resolvedTask.description || fallbackSchema.meta.description,
            },
            root: { ...fallbackSchema.root, title: resolvedTask.title || fallbackSchema.root.title },
          });
          setStatusMessage("未读取到模板草稿，已带入任务标题与说明作为起点");
        } else {
          setStatusMessage("任务或模板草稿加载失败，请检查后端服务。");
        }
      } catch (error) {
        if (!cancelled) setStatusMessage(error instanceof Error ? error.message : "模板编辑器加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // The route task id identifies the load boundary; schema changes are local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const resolvedTaskId = resolveTaskId(taskId, schema.meta.taskId);
  useEffect(() => {
    let cancelled = false;
    setTaskStatsLoaded(false);
    setDatasetItemStats(null);
    setAiConfigStatus("loading");
    setAiConfigEnabled(null);

    void (async () => {
      const [statsResult, itemsResult, configResult] = await Promise.allSettled([
        fetchTaskStats(resolvedTaskId),
        listItems(resolvedTaskId, 1, 200),
        getReviewConfig(resolvedTaskId),
      ]);
      if (cancelled) return;

      setTaskStats(statsResult.status === "fulfilled" ? statsResult.value : null);
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
  }, [resolvedTaskId, versionRefreshKey]);

  return {
    aiConfigEnabled,
    aiConfigStatus,
    datasetFields,
    datasetItemStats,
    loading,
    resolvedTaskId,
    schema,
    serverRegistry,
    setSchema,
    setStatusMessage,
    setTask,
    statusMessage,
    task,
    taskStats,
    taskStatsLoaded,
  };
}
