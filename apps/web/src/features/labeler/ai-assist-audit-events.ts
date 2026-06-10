import type {
  AiAssistOutcomeAuditPayload,
  AssignmentContextResponse,
  AuditActor,
  AuditEventType,
  AuditTarget,
  GenericAuditEventPayload,
  LLMAssistNode,
  LLMRuntimeResponse,
} from "@labelhub/contracts";
import type { LLMAssistOutcome } from "@labelhub/schema-renderer";
import { appendAuditEvent } from "../../api/audit";

export type AiAssistResponseMetadata = Pick<
  LLMRuntimeResponse,
  "promptVersionId" | "modelId" | "assistType" | "latencyMs" | "outputHash" | "promptSnapshotHash"
>;

type AiAssistAuditPayload = Partial<AiAssistOutcomeAuditPayload> & GenericAuditEventPayload & {
  callId?: string;
  appliedPatchFieldNames?: string[];
  editedFieldNames?: string[];
};

export function extractAiAssistResponseMetadata(response: LLMRuntimeResponse): AiAssistResponseMetadata {
  const metadata: AiAssistResponseMetadata = {};
  if (response.promptVersionId !== undefined) metadata.promptVersionId = response.promptVersionId;
  if (response.modelId !== undefined) metadata.modelId = response.modelId;
  if (response.assistType !== undefined) metadata.assistType = response.assistType;
  if (response.latencyMs !== undefined) metadata.latencyMs = response.latencyMs;
  if (response.outputHash !== undefined) metadata.outputHash = response.outputHash;
  if (response.promptSnapshotHash !== undefined) metadata.promptSnapshotHash = response.promptSnapshotHash;
  return metadata;
}

export function appendAiAssistTriggeredAuditSafely(input: {
  assignmentId: string;
  context: AssignmentContextResponse;
  node: LLMAssistNode;
  callAttemptId: string;
}): void {
  const payload = createBasePayload(input.context, input.assignmentId, input.node, "AI 辅助请求已触发");
  payload.triggeredCount = 1;
  payload.codes = ["TRIGGERED"];

  appendAiAssistEventSafely({
    type: "AI_ASSIST_TRIGGERED",
    context: input.context,
    assignmentId: input.assignmentId,
    payload,
    idempotencyKey: `AI_ASSIST:${input.assignmentId}:${input.node.id}:${input.callAttemptId}:TRIGGERED`,
  });
}

export function appendAiAssistOutcomeAuditSafely(input: {
  assignmentId: string;
  context: AssignmentContextResponse;
  outcome: LLMAssistOutcome;
  metadata?: AiAssistResponseMetadata;
}): void {
  const eventType = eventTypeForOutcome(input.outcome.action);
  const payload = createBasePayload(input.context, input.assignmentId, { id: input.outcome.nodeId }, summaryForOutcome(input.outcome.action));
  payload.callId = input.outcome.callId;
  payload.codes = [input.outcome.action];

  if (input.outcome.action === "SHOWN") payload.triggeredCount = 1;
  if (input.outcome.action === "ACCEPTED") payload.acceptedCount = 1;
  if (input.outcome.action === "DISMISSED") payload.dismissedCount = 1;

  if (input.outcome.appliedPatchFieldNames !== undefined) {
    payload.appliedPatchFieldNames = [...input.outcome.appliedPatchFieldNames].sort();
    const onlyFieldName = payload.appliedPatchFieldNames.length === 1 ? payload.appliedPatchFieldNames[0] : undefined;
    if (onlyFieldName !== undefined) {
      payload.fieldName = onlyFieldName;
    }
  }

  applyMetadata(payload, input.metadata);

  appendAiAssistEventSafely({
    type: eventType,
    context: input.context,
    assignmentId: input.assignmentId,
    payload,
    idempotencyKey: `AI_ASSIST:${input.assignmentId}:${input.outcome.callId}:${input.outcome.action}`,
  });
}

export function appendAiAssistEditedAuditSafely(input: {
  assignmentId: string;
  context: AssignmentContextResponse;
  callId: string;
  nodeId: string;
  metadata?: AiAssistResponseMetadata;
  editedFieldNames: string[];
}): void {
  const editedFieldNames = [...new Set(input.editedFieldNames)].sort();
  const payload = createBasePayload(input.context, input.assignmentId, { id: input.nodeId }, "AI 辅助建议已被人工修改");
  payload.callId = input.callId;
  payload.codes = ["EDITED"];
  payload.editedCount = 1;
  payload.editedFieldNames = editedFieldNames;

  const onlyFieldName = editedFieldNames.length === 1 ? editedFieldNames[0] : undefined;
  if (onlyFieldName !== undefined) {
    payload.fieldName = onlyFieldName;
  }

  applyMetadata(payload, input.metadata);

  appendAiAssistEventSafely({
    type: "AI_ASSIST_EDITED",
    context: input.context,
    assignmentId: input.assignmentId,
    payload,
    idempotencyKey: `AI_ASSIST:${input.assignmentId}:${input.callId}:EDITED`,
  });
}

function createBasePayload(
  context: AssignmentContextResponse,
  assignmentId: string,
  node: Pick<LLMAssistNode, "id" | "outputBindings">,
  summary: string,
): AiAssistAuditPayload {
  const payload: AiAssistAuditPayload = {
    summary,
    detailRef: node.id,
    taskId: context.task.id,
    assignmentId,
    schemaVersionId: context.schemaVersionId,
    nodeId: node.id,
  };
  const fieldName = firstOutputFieldName(node);
  if (fieldName !== undefined) {
    payload.fieldName = fieldName;
  }
  return payload;
}

function applyMetadata(payload: AiAssistAuditPayload, metadata: AiAssistResponseMetadata | undefined): void {
  if (metadata === undefined) return;
  if (metadata.promptVersionId !== undefined) payload.promptVersionId = metadata.promptVersionId;
  if (metadata.modelId !== undefined) payload.modelId = metadata.modelId;
  if (metadata.assistType !== undefined) payload.assistType = metadata.assistType;
  if (metadata.latencyMs !== undefined) payload.averageLatencyMs = metadata.latencyMs;
  if (metadata.outputHash !== undefined) payload.outputHash = metadata.outputHash;
  if (metadata.promptSnapshotHash !== undefined) payload.promptSnapshotHash = metadata.promptSnapshotHash;
}

function appendAiAssistEventSafely(input: {
  type: AuditEventType;
  context: AssignmentContextResponse;
  assignmentId: string;
  payload: AiAssistAuditPayload;
  idempotencyKey: string;
}): void {
  void appendAuditEvent({
    type: input.type,
    severity: "INFO",
    source: "WEB",
    actor: createLabelerActor(input.context),
    target: createAiAssistTarget(input.context, input.assignmentId),
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
  }).catch((error) => {
    console.warn("写入 AI 辅助审计事件失败：", error);
  });
}

function createLabelerActor(context: AssignmentContextResponse): AuditActor {
  return {
    id: context.assignment.labelerId,
    role: "LABELER",
    displayName: "标注员",
  };
}

function createAiAssistTarget(context: AssignmentContextResponse, assignmentId: string): AuditTarget {
  return {
    entityType: "ASSIGNMENT",
    entityId: assignmentId,
    taskId: context.task.id,
    assignmentId,
    schemaVersionId: context.schemaVersionId,
  };
}

function eventTypeForOutcome(action: LLMAssistOutcome["action"]): AuditEventType {
  if (action === "ACCEPTED") return "AI_ASSIST_ACCEPTED";
  if (action === "DISMISSED") return "AI_ASSIST_DISMISSED";
  return "AI_ASSIST_SHOWN";
}

function summaryForOutcome(action: LLMAssistOutcome["action"]): string {
  if (action === "ACCEPTED") return "AI 辅助建议已应用";
  if (action === "DISMISSED") return "AI 辅助建议已忽略";
  return "AI 辅助建议已展示";
}

function firstOutputFieldName(node: Pick<LLMAssistNode, "outputBindings">): string | undefined {
  return node.outputBindings?.[0]?.toFieldName;
}
