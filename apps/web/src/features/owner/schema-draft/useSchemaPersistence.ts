import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useSearchParams } from "react-router";
import type { LabelHubSchema, SchemaValidationResult, Task } from "@labelhub/contracts";
import { publishSchema, publishTask, saveSchemaDraft, type SchemaVersionHistoryItem } from "../../../api/owner";
import {
  appendPublishPreviewAuditEvents,
  appendPublishRequestedAuditEvent,
  appendSchemaPublishedAuditEvent,
  appendSchemaPublishFailedAuditEvent,
  type OwnerPublishFailureStage,
} from "../audit-events";
import {
  buildPublishPreview,
  createOwnerPublishAuditPreview,
  getPublishFailureMessage,
  getPublishFailureSuggestions,
  readPublishedSchemaVersionId,
  readPublishedSchemaVersionNo,
  resolveTaskId,
  type PublishConfigurationIssue,
} from "../schema-normalization";
import type { NoticeTone, PublishPreviewState } from "../schema-normalization";

export function useSchemaPersistence() {
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [publishNoticeTone, setPublishNoticeTone] = useState<NoticeTone>("info");
  const [publishFailureDetails, setPublishFailureDetails] = useState<string[]>([]);
  const [publishPreviewOpen, setPublishPreviewOpen] = useState(false);
  const [publishPreview, setPublishPreview] = useState<PublishPreviewState | undefined>();
  const [publishPreviewPreparing, setPublishPreviewPreparing] = useState(false);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  const [boundVersionNo, setBoundVersionNo] = useState<number | null>(null);
  const publishIssueListRef = useRef<HTMLDivElement>(null);

  return {
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
  };
}

interface SchemaPersistenceActionsOptions {
  aiConfigStatus: "loading" | "configured" | "missing" | "error";
  aiReady: boolean;
  basicReady: boolean;
  distributionReady: boolean;
  hasAvailableDataset: boolean;
  hasDataset: boolean;
  loading: boolean;
  publishConfigurationIssues: PublishConfigurationIssue[];
  publishIssueListRef: RefObject<HTMLDivElement | null>;
  publishPreview: PublishPreviewState | undefined;
  publishValidationResult: SchemaValidationResult;
  schema: LabelHubSchema;
  setPublishFailureDetails: Dispatch<SetStateAction<string[]>>;
  setActivePresetId: Dispatch<SetStateAction<string>>;
  setPublishing: Dispatch<SetStateAction<boolean>>;
  setPublishPreview: Dispatch<SetStateAction<PublishPreviewState | undefined>>;
  setPublishPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setPublishPreviewPreparing: Dispatch<SetStateAction<boolean>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setSchema: Dispatch<SetStateAction<LabelHubSchema>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  setTask: Dispatch<SetStateAction<Task | undefined>>;
  setVersionRefreshKey: Dispatch<SetStateAction<number>>;
  showNotice: (message: string | null, tone?: NoticeTone) => void;
  task: Task | undefined;
  taskId: string | undefined;
  taskStatsLoaded: boolean;
}

export function useSchemaPersistenceActions({
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
}: SchemaPersistenceActionsOptions) {
  const [searchParams, setSearchParams] = useSearchParams();
  const autoPublishTriggeredRef = useRef(false);

  const handleSaveDraft = async (): Promise<void> => {
    const currentTaskId = resolveTaskId(taskId, schema.meta.taskId);
    try {
      setSaving(true);
      const response = await saveSchemaDraft(currentTaskId, {
        schema,
        baseSchemaDraftRevision: schema.schemaDraftRevision,
      });
      setSchema(response.schema);
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

  return {
    exportSchemaJson,
    handleConfirmPublishPreview,
    handleCopyVersionToDraft,
    handlePublish,
    handleRollbackToVersion,
    handleSaveDraft,
  };
}
