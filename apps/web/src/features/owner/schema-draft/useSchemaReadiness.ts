import { useMemo } from "react";
import { collectFieldNodes } from "@labelhub/schema-core";
import type { LabelHubSchema, SchemaValidationError, Task } from "@labelhub/contracts";
import type { Role } from "../../../app/routes";
import type { TaskStats } from "../../../api/owner";
import {
  collectPublishConfigurationIssues,
  createPublishValidationResult,
  createSampleContext,
  isDistributionReady,
  schemaRevisionLabel,
} from "../schema-normalization";
import { buildTaskSetupSteps, type ReadinessItem } from "../TaskSetupGuide";

interface SchemaReadinessOptions {
  aiConfigEnabled: boolean | null;
  aiConfigStatus: "loading" | "configured" | "missing" | "error";
  datasetItemStats: { total: number; available: number } | null;
  publishNotice: string | null;
  role: Role;
  schema: LabelHubSchema;
  task: Task | undefined;
  taskId: string | undefined;
  taskStats: TaskStats | null;
  taskStatsLoaded: boolean;
  resolvedAuditTaskId: string;
}

export function useSchemaReadiness({
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
}: SchemaReadinessOptions) {
  const sampleContext = useMemo(() => createSampleContext(schema, task, role), [role, schema, task]);
  const fieldNodes = useMemo(() => collectFieldNodes(schema), [schema]);
  const templateTitle = schema.meta.name;
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

  return {
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
  };
}
