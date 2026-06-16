import type { AuditActor, AuditEventType, AiAssistType } from "./audit";
import type { ID, ISODateTime } from "./global";

// ---------------------------------------------------------------------------
// AI Assist 一键采纳闭环：可操作建议 + 动作 + 状态 + 结构化补丁
//
// 设计原则：
// - 复用已有 AuditActor / AiAssistType / AuditEventType，不重复造身份与类型。
// - structuredPatch 是「字段级修订」而非 raw payload；前端只需展示字段名与值，
//   不应把整段 LLM raw 输出当作必须展示的字段。
// - 三种动作必须支持：accept（一键采纳）/ edit_accept（编辑后采纳）/ dismiss（忽略）。
// ---------------------------------------------------------------------------

/** AI Assist 可执行的三种动作。 */
export type AiAssistActionType = "accept" | "edit_accept" | "dismiss";

/**
 * 建议在经过动作后的状态。
 * - PENDING：尚未处理（默认）
 * - ACCEPTED：一键采纳成功
 * - EDIT_ACCEPTED：编辑后采纳成功
 * - DISMISSED：已忽略
 * - APPLY_FAILED：采纳被记录，但结构化补丁应用失败（不静默，进入失败态）
 */
export type AiAssistSuggestionStatus =
  | "PENDING"
  | "ACCEPTED"
  | "EDIT_ACCEPTED"
  | "DISMISSED"
  | "APPLY_FAILED";

/** 单条结构化补丁操作：字段级 before → after，不携带整段 raw payload。 */
export interface AiAssistPatchOperation {
  fieldName: string;
  /** 当前值（用于展示 diff，可缺省）。 */
  previousValue?: unknown;
  /** 建议写入的目标值；undefined 表示建议清空该字段。 */
  nextValue: unknown;
}

/** 一条建议关联的结构化补丁（可为空数组：建议无字段级改动）。 */
export type AiAssistStructuredPatch = AiAssistPatchOperation[];

/** 建议严重度（与 AIReviewResult.fieldIssues.severity 对齐）。 */
export type AiAssistSuggestionSeverity = "LOW" | "MEDIUM" | "HIGH";

/**
 * 可操作的 AI Assist 建议。
 * 通常由 AIReviewResult.fieldIssues 或 LLM Assist suggestedPatch 派生而来，
 * 但带上 id / status，使其可被采纳 / 编辑采纳 / 忽略并持久化。
 */
export interface AiAssistSuggestion {
  id: ID | string;
  submissionId: ID | string;
  taskId?: ID | string;
  itemId?: ID | string;
  schemaVersionId?: ID | string;
  /** 来源 LLMAssist 节点（若来自标注作答页建议）。 */
  nodeId?: string;
  /** 主要关联字段（若建议聚焦单字段）。 */
  fieldName?: string;
  assistType?: AiAssistType;
  severity: AiAssistSuggestionSeverity;
  /** 0~1，模型置信度（可缺省）。 */
  confidence?: number;
  /** 人话建议摘要，可直接展示给审核员。 */
  summary: string;
  /** 结构化补丁；空数组表示无字段级改动（仍可被采纳/忽略）。 */
  structuredPatch?: AiAssistStructuredPatch;
  status: AiAssistSuggestionStatus;
  createdAt: ISODateTime | string;
  /** 最近一次动作时间（被处理后写入）。 */
  resolvedAt?: ISODateTime | string;
}

/** 一条已发生的 AI Assist 动作记录（持久化 + 审计）。 */
export interface AiAssistActionRecord {
  id: ID | string;
  suggestionId: ID | string;
  submissionId: ID | string;
  action: AiAssistActionType;
  /** 动作执行后建议进入的状态。 */
  resultingStatus: AiAssistSuggestionStatus;
  /** accept / edit_accept 实际应用到的字段名（排序后）。 */
  appliedPatchFieldNames?: string[];
  /** accept / edit_accept 时是否成功应用了结构化补丁。 */
  patchApplied?: boolean;
  /** 补丁应用失败原因（人话），仅在 APPLY_FAILED 时出现。 */
  patchFailureReason?: string;
  /** 审核员备注。 */
  comment?: string;
  actor: AuditActor;
  createdAt: ISODateTime | string;
}

/**
 * POST 请求体：对某条建议执行动作。
 * - accept：editedPatch 必须为 null/缺省（采纳原始建议）。
 * - edit_accept：editedPatch 提供编辑后的字段级补丁。
 * - dismiss：忽略建议，editedPatch 为 null/缺省。
 */
export interface AiAssistActionRequest {
  action: AiAssistActionType;
  editedPatch?: AiAssistStructuredPatch | null;
  comment?: string;
}

/** 动作执行结果：返回更新后的建议 + 动作记录 + 实际写入的审计事件类型。 */
export interface AiAssistActionResponse {
  suggestion: AiAssistSuggestion;
  action: AiAssistActionRecord;
  /** 后端实际写入的主审计事件类型（便于前端追溯，但不强制展示原始 code）。 */
  auditEventType: AuditEventType;
}

/** GET 列表响应：某 submission 下的全部可操作建议。 */
export interface ListAiAssistSuggestionsResponse {
  suggestions: AiAssistSuggestion[];
}
