import type { Dispatch, SetStateAction } from "react";
import { validateDesignerSchema } from "@labelhub/schema-designer";
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
  ShowItemNode,
  Task,
} from "@labelhub/contracts";
import { Role } from "../../app/routes";
import { fetchSchemaVersion } from "../../api/owner";
import type { OwnerPublishAuditPreview, OwnerPublishFailureStage } from "./audit-events";
import { createSchemaFromPreset, schemaPresetSummaries } from "./schemaPresetLibrary";

export type NoticeTone = "success" | "danger" | "info" | "warning";

export type ConditionOperator = "eq" | "ne" | "contains" | "empty" | "notEmpty";
export type ConditionAction = "show" | "hide" | "disable";
export type VisualValidationType = "required" | "minLength" | "maxLength" | "numberRange" | "regex";

export interface ConditionRuleDraft {
  id: string;
  targetField: string;
  conditionField: string;
  operator: ConditionOperator;
  value: string;
  action: ConditionAction;
}

export interface ValidationRuleDraft {
  id: string;
  targetField: string;
  type: VisualValidationType;
  value: string;
  message: string;
}

export interface PublishPreviewState {
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

export interface PublishConfigurationIssue {
  id: string;
  message: string;
  suggestion: string;
  badge: string;
  nodeId?: string;
}

export interface AiSchemaDraftPreview {
  schema: LabelHubSchema;
  validation: SchemaValidationResult;
  warnings: SchemaValidationError[];
  generatedBy: {
    modelPolicyId: string;
    promptSnapshotHash: string;
    llmCallId: ID;
  };
}

export interface CustomSchemaPreset {
  id: string;
  title: string;
  description: string;
  fields: string;
  schema: LabelHubSchema;
  createdAt: string;
}

export type SchemaPresetOption =
  | ((typeof schemaPresetSummaries)[number] & { source: "built-in" })
  | (CustomSchemaPreset & { source: "custom" });

export const conditionOperatorLabels: Record<ConditionOperator, string> = {
  eq: "等于",
  ne: "不等于",
  contains: "包含",
  empty: "为空",
  notEmpty: "不为空",
};

export const conditionActionLabels: Record<ConditionAction, string> = {
  show: "显示",
  hide: "隐藏",
  disable: "禁用",
};

export const validationTypeLabels: Record<VisualValidationType, string> = {
  required: "必填",
  minLength: "最小长度",
  maxLength: "最大长度",
  numberRange: "数字范围",
  regex: "正则表达式",
};

export function schemaRevisionLabel(schema: LabelHubSchema): string {
  return `r${schema.schemaDraftRevision ?? schema.schemaVersionNo ?? 1}`;
}

export function noticeBadgeTone(tone: NoticeTone): "success" | "danger" | "primary" | "warning" {
  if (tone === "success") return "success";
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  return "primary";
}

export function isDistributionReady(task: Task): boolean {
  if (!task.title.trim() || task.quota.total < 1) return false;
  if (task.distributionStrategy.type === "ASSIGNMENT") {
    return task.distributionStrategy.assigneeIds.length > 0;
  }
  if (task.distributionStrategy.type === "QUOTA_CLAIM") {
    return task.distributionStrategy.claimBatchSize > 0;
  }
  return true;
}

export function collectPublishConfigurationIssues(
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

export function createPublishValidationResult(
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

export function getPublishFailureMessage(error: unknown, stage: OwnerPublishFailureStage): string {
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

export function getPublishFailureSuggestions(error: unknown, stage: OwnerPublishFailureStage): string[] {
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

export async function buildPublishPreview({
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

export function readSchemaVersionSnapshot(schemaVersion: unknown): LabelHubSchema | undefined {
  if (!isRecordValue(schemaVersion)) return undefined;
  const candidate = schemaVersion.snapshot ?? schemaVersion.schema;
  if (!isRecordValue(candidate) || !isRecordValue(candidate.root)) return undefined;
  return candidate as unknown as LabelHubSchema;
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createOwnerPublishAuditPreview(
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

export function readPublishedSchemaVersionId(schemaVersion: unknown, fallbackSchemaVersionId: ID | undefined): ID {
  if (isRecord(schemaVersion) && typeof schemaVersion.id === "string") {
    return schemaVersion.id as ID;
  }

  if (fallbackSchemaVersionId !== undefined) {
    return fallbackSchemaVersionId;
  }

  throw new Error("schema publish response 缺少 schemaVersion.id。");
}

export function readPublishedSchemaVersionNo(schemaVersion: unknown, fallbackSchemaVersionNo: number | undefined): number | undefined {
  if (isRecord(schemaVersion) && typeof schemaVersion.schemaVersionNo === "number") {
    return schemaVersion.schemaVersionNo;
  }

  if (isRecord(schemaVersion) && isRecord(schemaVersion.snapshot) && typeof schemaVersion.snapshot.schemaVersionNo === "number") {
    return schemaVersion.snapshot.schemaVersionNo;
  }

  return fallbackSchemaVersionNo;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeGeneratedSchemaDraft(
  schemaDraft: unknown,
  currentSchema: LabelHubSchema,
  taskId: ID,
  taskTitle: string,
  prompt: string,
  availableFieldNames: string[] = [],
): LabelHubSchema {
  if (!isRecord(schemaDraft)) {
    throw new Error("AI 生成结果不是对象");
  }

  const rootCandidate = isRecord(schemaDraft.root) ? schemaDraft.root : undefined;
  const rawChildren = Array.isArray(rootCandidate?.children)
    ? rootCandidate.children
    : Array.isArray(schemaDraft.nodes)
      ? schemaDraft.nodes
      : undefined;
  if (rawChildren === undefined) {
    throw new Error("AI 生成结果缺少 root.children 或 nodes");
  }

  const usedNodeIds = new Set<string>(["root"]);
  const usedFieldNames = new Set<string>();
  const children = rawChildren.map((node, index) => normalizeGeneratedNode(node, index, usedNodeIds, usedFieldNames, availableFieldNames));
  const now = new Date().toISOString();
  const generatedTitle = readString(schemaDraft, "title")
    ?? (isRecord(schemaDraft.meta) ? readString(schemaDraft.meta, "name") : undefined)
    ?? `${taskTitle} AI 生成模板`;

  return {
    ...currentSchema,
    contractVersion: "1.1",
    schemaId: currentSchema.schemaId,
    schemaDraftRevision: currentSchema.schemaDraftRevision,
    status: "DRAFT",
    meta: {
      ...currentSchema.meta,
      name: generatedTitle,
      description: prompt,
      taskId,
      updatedAt: now,
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.section",
      title: generatedTitle,
      children,
    },
  };
}

// AI 生成节点常见机器字段名 → 人类可读中文标题。只用于「展示名称」，不影响 id / name / sourcePath。
export const GENERATED_TITLE_LABELS: Record<string, string> = {
  show_user_input: "用户输入内容",
  user_input: "用户输入内容",
  show_model_response: "模型回答内容",
  model_response: "模型回答内容",
  show_reference_answer: "参考答案内容",
  reference_answer: "参考答案内容",
  relevance_score: "内容相关性打分",
  accuracy_score: "内容准确性打分",
  content_accuracy: "内容准确性打分",
  format_compliance: "格式合规性打分",
  safety_score: "安全性打分",
  safety_compliance: "安全性打分",
  summary: "总结结论",
  conclusion: "总结结论",
  final_conclusion: "总结结论",
};

// 把 AI 生成节点的「展示标题」转成人类可读中文：
// 1) 优先保留 AI 已给出的自然语言标题（含中文等非字段名字符时原样返回）；
// 2) 命中字典的机器字段名 → 中文；
// 3) 未命中但是 snake_case 机器字段名 → 轻量兜底（去 show_ 前缀、_score 转「打分」）；
// 4) 实在无法判断 → 保留原值，不硬翻译。
// 只改展示用 title，不改 id / 保存字段名 / sourcePath / 数据绑定。
export function humanizeGeneratedNodeTitle(rawTitleOrName: string, _nodeKind?: string): string {
  const value = rawTitleOrName.trim();
  if (value.length === 0) return value;
  const key = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(GENERATED_TITLE_LABELS, key)) {
    return GENERATED_TITLE_LABELS[key];
  }
  // 仅当看起来是机器字段名（全小写 ascii snake_case 标识符）才做兜底转换；否则信任 AI 原文。
  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(value)) {
    return value;
  }
  let core = value.startsWith("show_") ? value.slice("show_".length) : value;
  let suffix = "";
  if (core.endsWith("_score")) {
    core = core.slice(0, -"_score".length);
    suffix = "打分";
  }
  const readable = core.split("_").filter(Boolean).join(" ").trim();
  if (readable.length === 0) return value;
  return suffix ? `${readable} ${suffix}` : readable;
}

// AI 生成 show.* 展示节点的字段别名组：把「中文标题 / 机器名」按语义归类到真实数据字段候选。
// 仅用于推断展示节点的 sourcePath，不影响作答字段。
// 顺序敏感：参考答案组必须排在模型回答组之前——否则 "reference_answer" 会被模型组的裸 "answer" 误命中。
export const SHOW_FIELD_ALIASES: ReadonlyArray<{ canon: RegExp; candidates: string[] }> = [
  {
    canon: /(用户|输入|提问|问题|prompt|question|query|user[_-]?input|instruction|^input$|_input$)/i,
    candidates: ["prompt", "question", "query", "user_input", "instruction", "input"],
  },
  {
    canon: /(参考答案|参考|标准答案|reference[_-]?answer|reference|ground[_-]?truth|gold|expected[_-]?answer)/i,
    candidates: ["reference_answer", "reference", "ground_truth", "gold", "expected_answer"],
  },
  {
    canon: /(模型回答|模型回复|模型输出|回答|回复|输出|model[_-]?response|model[_-]?answer|answer|response|output|completion)/i,
    candidates: ["model_response", "model_answer", "answer", "response", "output", "completion"],
  },
];

// 推断 AI 生成展示节点应绑定的 sourcePath，尽量指向真实数据字段，避免绑定到不存在的机器名（如 show_model_response）。
// 优先级：① AI 已给且指向真实字段的 sourcePath → 保留；② name/id 精确匹配真实字段（含去 show_ 前缀）；
// ③ 别名匹配真实字段；④ 兜底：保留 AI 原 sourcePath，否则 `$.item.sourcePayload.<sanitizedName>`。
export function inferGeneratedShowSourcePath(
  rawNode: Record<string, unknown>,
  fallbackId: string,
  availableFieldNames: string[],
): string {
  const pathFor = (field: string) => `$.item.sourcePayload.${field}`;
  const fieldSet = new Set(availableFieldNames);
  const byLower = new Map(availableFieldNames.map((f) => [f.toLowerCase(), f]));
  const rawSourcePath = readString(rawNode, "sourcePath");

  // ① AI 已给 sourcePath 且解析出的字段真实存在 → 保留
  if (rawSourcePath) {
    const m = /\$\.item\.sourcePayload\.([A-Za-z0-9_]+)/.exec(rawSourcePath);
    if (m && fieldSet.has(m[1])) return rawSourcePath;
  }

  // ② name / id 精确匹配真实字段（也尝试去掉 show_ 前缀）
  const idCandidates = [readString(rawNode, "name"), readString(rawNode, "id"), fallbackId]
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  for (const c of idCandidates) {
    const lc = c.toLowerCase();
    if (byLower.has(lc)) return pathFor(byLower.get(lc)!);
    const stripped = lc.startsWith("show_") ? lc.slice(5) : lc;
    if (stripped !== lc && byLower.has(stripped)) return pathFor(byLower.get(stripped)!);
  }

  // ③ 别名匹配：用 title + name + id 文本命中别名组，再在真实字段里找候选（精确或包含 token）
  if (availableFieldNames.length > 0) {
    const haystack = [readString(rawNode, "title"), ...idCandidates].filter(Boolean).join(" ");
    for (const group of SHOW_FIELD_ALIASES) {
      if (!group.canon.test(haystack)) continue;
      for (const cand of group.candidates) {
        if (byLower.has(cand)) return pathFor(byLower.get(cand)!);
      }
      const tokenHit = availableFieldNames.find((field) =>
        group.candidates.some((cand) => field.toLowerCase().includes(cand)),
      );
      if (tokenHit) return pathFor(tokenHit);
    }
  }

  // ④ 兜底
  if (rawSourcePath) return rawSourcePath;
  return pathFor(sanitizeIdentifier(readString(rawNode, "name") ?? fallbackId, fallbackId));
}

export function normalizeGeneratedNode(
  rawNode: unknown,
  index: number,
  usedNodeIds: Set<string>,
  usedFieldNames: Set<string>,
  availableFieldNames: string[] = [],
): SchemaNode {
  if (!isRecord(rawNode)) {
    throw new Error(`AI 生成的第 ${index + 1} 个节点不是对象`);
  }

  const type = normalizeGeneratedNodeType(readString(rawNode, "type"));
  const baseId = readString(rawNode, "id") ?? readString(rawNode, "name") ?? `ai_node_${index + 1}`;
  const id = uniqueValue(sanitizeIdentifier(baseId, `ai_node_${index + 1}`), usedNodeIds);
  usedNodeIds.add(id);
  const rawTitle = readString(rawNode, "title") ?? readString(rawNode, "label") ?? readString(rawNode, "name") ?? "AI 生成字段";
  const title = humanizeGeneratedNodeTitle(rawTitle, readString(rawNode, "kind"));
  const description = readString(rawNode, "description");
  const baseNode = {
    ...cloneValue(rawNode),
    id,
    type,
    title,
    ...(description === undefined ? {} : { description }),
  };

  if (type === "container.section" || type === "container.group" || type === "container.tabs") {
    const rawChildren = Array.isArray(rawNode.children) ? rawNode.children : [];
    return {
      ...baseNode,
      kind: "CONTAINER",
      children: rawChildren.map((child, childIndex) => normalizeGeneratedNode(child, childIndex, usedNodeIds, usedFieldNames, availableFieldNames)),
    } as SchemaNode;
  }

  if (type.startsWith("show.")) {
    return {
      ...baseNode,
      kind: "SHOW_ITEM",
      // 展示节点优先绑定到真实数据字段（复用「数据字段」抽屉的 sourcePayload 字段名）；无法匹配才回退 sanitized name。
      sourcePath: inferGeneratedShowSourcePath(rawNode, id, availableFieldNames),
    } as SchemaNode;
  }

  if (type === "llm.assist") {
    return {
      ...baseNode,
      kind: "LLM_ASSIST",
      trigger: rawNode.trigger === "ON_FIELD_CHANGE" ? "ON_FIELD_CHANGE" : "MANUAL",
      inputBindings: isRecord(rawNode.inputBindings) ? rawNode.inputBindings : {},
      outputMode: rawNode.outputMode === "PREFILL" || rawNode.outputMode === "STRUCTURED" ? rawNode.outputMode : "SUGGESTION",
    } as SchemaNode;
  }

  const fieldName = uniqueValue(
    sanitizeIdentifier(readString(rawNode, "name") ?? id, `field_${index + 1}`),
    usedFieldNames,
  );
  usedFieldNames.add(fieldName);
  const fieldNode = {
    ...baseNode,
    kind: "FIELD",
    name: fieldName,
    required: typeof rawNode.required === "boolean" ? rawNode.required : false,
  };
  if (type.startsWith("choice.")) {
    return {
      ...fieldNode,
      options: normalizeGeneratedOptions(rawNode.options),
    } as SchemaNode;
  }
  return fieldNode as SchemaNode;
}

export function normalizeGeneratedNodeType(type: string | undefined): NodeType {
  const allowed = new Set<NodeType>([
    "input.text",
    "input.textarea",
    "input.richtext",
    "choice.radio",
    "choice.checkbox",
    "choice.select",
    "choice.tags",
    "upload.file",
    "upload.image",
    "data.json",
    "show.text",
    "show.richtext",
    "show.image",
    "show.file",
    "show.json",
    "container.group",
    "container.tabs",
    "container.section",
    "llm.assist",
  ]);
  return type !== undefined && allowed.has(type as NodeType) ? type as NodeType : "input.textarea";
}

export function normalizeGeneratedOptions(options: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(options) || options.length === 0) {
    return [
      { label: "是", value: "yes" },
      { label: "否", value: "no" },
    ];
  }
  return options.map((option, index) => {
    if (!isRecord(option)) {
      const value = sanitizeIdentifier(String(option), `option_${index + 1}`);
      return { label: String(option), value };
    }
    const label = readString(option, "label") ?? readString(option, "text") ?? readString(option, "value") ?? `选项 ${index + 1}`;
    const value = sanitizeIdentifier(readString(option, "value") ?? label, `option_${index + 1}`);
    return { label, value };
  });
}

export function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// 选择性导入的可选节点列表：只列出顶层节点。container.* 作为整体一项，不展开子节点。
export function collectSelectableNodeSummaries(schema: LabelHubSchema): Array<{
  id: string;
  title: string;
  name: string;
  type: string;
  required: boolean;
}> {
  return schema.root.children.map((node) => ({
    id: node.id,
    title: node.title || "未命名字段",
    name: node.kind === "FIELD" ? node.name : "展示/辅助组件",
    type: node.type,
    required: node.kind === "FIELD" ? node.required === true : false,
  }));
}

// 「只选作答字段」判定：仅 choice.* 与 input.*，不含 show.* 及其它展示/容器类型。
export function isAnswerFieldType(type: string): boolean {
  return type.startsWith("choice.") || type.startsWith("input.");
}

// 根据勾选的顶层节点 id 过滤预览 schema，得到只含选中节点的草稿。
// 预览 schema 已由 normalizeGeneratedSchemaDraft 规范化（id 稳定且唯一），这里只做子集过滤，不重复 normalize。
export function buildSelectedSchemaDraft(schema: LabelHubSchema, selectedNodeIds: Set<string>): LabelHubSchema {
  return {
    ...schema,
    meta: {
      ...schema.meta,
      updatedAt: new Date().toISOString(),
    },
    root: {
      ...schema.root,
      children: schema.root.children.filter((node) => selectedNodeIds.has(node.id)),
    },
  };
}

export function formatSchemaIssue(issue: unknown): string {
  if (typeof issue === "string") return issue;
  if (isRecord(issue)) {
    const message = readString(issue, "message");
    const path = readString(issue, "path");
    if (message !== undefined && path !== undefined) return `${message}（${path}）`;
    if (message !== undefined) return message;
  }
  return "未命名问题";
}

export function createConditionRule(fields: FieldNode[]): ConditionRuleDraft {
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

export function createValidationRule(fields: FieldNode[]): ValidationRuleDraft {
  return {
    id: `validation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    targetField: fields[0]?.name ?? "",
    type: "required",
    value: "",
    message: "请完成该字段",
  };
}

export function updateConditionRule(
  setRules: Dispatch<SetStateAction<ConditionRuleDraft[]>>,
  id: string,
  patch: Partial<ConditionRuleDraft>,
) {
  setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
}

export function updateValidationRule(
  setRules: Dispatch<SetStateAction<ValidationRuleDraft[]>>,
  id: string,
  patch: Partial<ValidationRuleDraft>,
) {
  setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
}

export function ensureNewsQualityPreviewFields(schema: LabelHubSchema): LabelHubSchema {
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

export function createRewriteSuggestionNode(): SchemaNode {
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

export const CUSTOM_SCHEMA_PRESETS_KEY = "labelhub.owner.schema-presets.v1";

export function readCustomSchemaPresets(): CustomSchemaPreset[] {
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

export function writeCustomSchemaPresets(presets: CustomSchemaPreset[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_SCHEMA_PRESETS_KEY, JSON.stringify(presets.slice(0, 12)));
}

export function createBlankSchema(taskId: ID): LabelHubSchema {
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

export function bindPresetToCurrentDraft(
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

export function summarizeSchemaFields(schema: LabelHubSchema): string {
  const titles = collectFieldNodes(schema)
    .map((field) => field.title || field.name)
    .filter(Boolean)
    .slice(0, 4);
  return titles.length > 0 ? titles.join(" / ") : "空白模板";
}

export function createFallbackSchema(taskId: string | undefined, taskTitle?: string): LabelHubSchema {
  const resolvedTaskId = resolveTaskId(taskId, "task_news_quality" as ID);
  const presetId = presetIdForTask(resolvedTaskId);
  return ensureNewsQualityPreviewFields(createSchemaFromPreset(presetId, resolvedTaskId, taskTitle ?? "当前任务"));
}

export function presetIdForTask(taskId: string | undefined): string {
  if (taskId === "task_product_title") return "product_title";
  if (taskId === "task_news_quality") return "news_quality";
  return schemaPresetSummaries[0].id;
}

export function presetIdForSchema(schema: LabelHubSchema): string {
  const matchedPreset = schemaPresetSummaries.find((preset) => schema.meta.name.includes(preset.title));
  return matchedPreset?.id ?? presetIdForTask(schema.meta.taskId);
}

export function createSampleContext(schema: LabelHubSchema, task: Task | undefined, role: Role): LabelHubRuntimeContext {
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

export function resolveTaskId(taskId: string | undefined, fallbackTaskId: ID): ID {
  return (taskId ?? fallbackTaskId) as ID;
}

export function appendNodeToRoot(schema: LabelHubSchema, type: NodeType): LabelHubSchema {
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

export type DataFieldKind = "文本" | "数字" | "布尔" | "数组" | "对象" | "链接" | "空值";

// 字段角色：推荐展示 / 元数据 / 疑似答案(隐藏标签) / 其他。按字段名启发式归类（通用，不写死数据集）。
export type FieldRole = "recommended" | "metadata" | "answer" | "other";

export interface DataFieldInfo {
  name: string;
  kind: DataFieldKind;
  sample: string;
  role: FieldRole;
}

export const RECOMMENDED_FIELD_NAMES = new Set([
  "prompt", "question", "query", "instruction",
  "content", "content_markdown", "text", "body", "passage",
  "model_answer", "answer", "response",
  "model_a_answer", "model_b_answer", "reference",
]);
export const METADATA_FIELD_NAMES = new Set([
  "id", "lang", "language", "category", "difficulty",
  "source", "tags", "created_at", "updated_at", "media_type", "type",
]);
export const ANSWER_FIELD_NAMES = new Set([
  "margin", "label", "gold", "ground_truth", "groundtruth", "target",
  "winner", "chosen", "score", "expected_label", "correct_answer",
  "gold_label", "gt", "preference", "preferred", "verdict", "is_correct",
]);

// 安全优先：先判疑似答案/隐藏标签（防答案泄露），再推荐展示，再元数据，最后兜底其他。
export function classifyFieldRole(name: string): FieldRole {
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

export const FIELD_SECTIONS: ReadonlyArray<{ role: FieldRole; title: string; desc: string }> = [
  { role: "recommended", title: "推荐展示字段", desc: "适合直接展示给标注员的内容字段。" },
  { role: "metadata", title: "元数据字段", desc: "数据的辅助信息，一般不必展示给标注员。" },
  { role: "answer", title: "疑似答案 / 隐藏标签字段", desc: "可能是答案或隐藏标签，默认禁止添加以防泄露。" },
  { role: "other", title: "其他字段", desc: "无法自动判断用途的字段，可按需添加。" },
];

export const FRIENDLY_FIELD_TITLES: Record<string, string> = {
  prompt: "用户问题",
  model_answer: "模型回答",
  reference: "参考答案",
  expected_dimensions: "期望评估维度",
  content_markdown: "Markdown 内容",
  media_url: "媒体链接",
};

export function friendlyFieldTitle(fieldName: string): string {
  return FRIENDLY_FIELD_TITLES[fieldName] ?? fieldName;
}

export function isUrlLikeValue(value: string): boolean {
  const v = value.trim();
  return /^https?:\/\//i.test(v) || /^\/\//.test(v);
}

export function inferDataFieldKind(value: unknown): DataFieldKind {
  if (value === null || value === undefined || value === "") return "空值";
  if (Array.isArray(value)) return value.length === 0 ? "空值" : "数组";
  if (typeof value === "boolean") return "布尔";
  if (typeof value === "number") return "数字";
  if (typeof value === "object") return "对象";
  if (typeof value === "string") return isUrlLikeValue(value) ? "链接" : "文本";
  return "文本";
}

export function formatDataFieldSample(value: unknown): string {
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
export function collectDataFields(items: DatasetItem[]): DataFieldInfo[] {
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
export function appendShowItemField(schema: LabelHubSchema, fieldName: string): LabelHubSchema {
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

export function prepareNodeForAppsWebInsert(schema: LabelHubSchema, node: SchemaNode): SchemaNode {
  const usedNodeIds = new Set(flattenNodes(schema).map((item) => item.id));
  const usedFieldNames = new Set(collectFieldNodes(schema).map((field) => field.name));
  return withUniqueIdentity(cloneValue(node), usedNodeIds, usedFieldNames);
}

export function withUniqueIdentity(node: SchemaNode, usedNodeIds: Set<string>, usedFieldNames: Set<string>): SchemaNode {
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

export function uniqueValue(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;

  let index = 2;
  while (used.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
