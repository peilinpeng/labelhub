import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  AnswerPayload,
  AssignmentContextResponse,
  AuditActor,
  AuditTarget,
  FormAbandonedAuditPayload,
  LabelingSessionSummaryAuditPayload,
  LabelHubSchema,
  RiskSignalCode,
  SchemaNode,
} from "@labelhub/contracts";
import { appendAuditEvent } from "../../api/audit";

interface UseLabelingTelemetryInput {
  assignmentId?: string;
  context: AssignmentContextResponse | null;
  answers: AnswerPayload;
  onAnswersChange: (answers: AnswerPayload) => void;
}

interface UseLabelingTelemetryResult {
  handleActivity: () => void;
  handleAnswersChange: (nextAnswers: AnswerPayload) => void;
  handlePaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  appendSubmissionSummary: (submitAnswers: AnswerPayload) => void;
}

interface TelemetrySnapshot {
  clientStartedAt: string;
  clientSubmittedAt?: string;
  totalWallTimeMs: number;
  activeTimeMs: number;
  idleTimeMs: number;
  blurCount: number;
  focusLossCount: number;
  pasteCount: number;
  changedFieldCount: number;
  fieldEditCount: number;
  textareaPasteFieldNames: string[];
  riskSignals: RiskSignalCode[];
}

export function useLabelingTelemetry({
  assignmentId,
  context,
  answers,
  onAnswersChange,
}: UseLabelingTelemetryInput): UseLabelingTelemetryResult {
  const sessionIdRef = useRef(createSessionId());
  const clientStartedAtRef = useRef(new Date().toISOString());
  const startedAtMsRef = useRef(Date.now());
  const idleStartedAtMsRef = useRef<number | null>(null);
  const idleMsRef = useRef(0);
  const blurCountRef = useRef(0);
  const focusLossCountRef = useRef(0);
  const pasteCountRef = useRef(0);
  const changedFieldNamesRef = useRef<Set<string>>(new Set());
  const fieldEditCountRef = useRef(0);
  const textareaPasteFieldNamesRef = useRef<Set<string>>(new Set());
  const submittedRef = useRef(false);
  const abandonedReportedRef = useRef(false);
  const answersRef = useRef<AnswerPayload>(answers);
  const contextRef = useRef<AssignmentContextResponse | null>(context);
  const assignmentIdRef = useRef<string | undefined>(assignmentId);

  const sessionKey = `${assignmentId ?? "assignment_empty"}:${context?.item.id ?? "item_empty"}`;
  const requiredFieldCount = useMemo(() => (context ? countRequiredFields(context.schema) : 0), [context]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    contextRef.current = context;
    assignmentIdRef.current = assignmentId;
  }, [assignmentId, context]);

  useEffect(() => {
    sessionIdRef.current = createSessionId();
    clientStartedAtRef.current = new Date().toISOString();
    startedAtMsRef.current = Date.now();
    idleStartedAtMsRef.current = null;
    idleMsRef.current = 0;
    blurCountRef.current = 0;
    focusLossCountRef.current = 0;
    pasteCountRef.current = 0;
    changedFieldNamesRef.current = new Set();
    fieldEditCountRef.current = 0;
    textareaPasteFieldNamesRef.current = new Set();
    submittedRef.current = false;
    abandonedReportedRef.current = false;
  }, [sessionKey]);

  const markActive = useCallback(() => {
    closeIdlePeriod();
  }, []);

  const appendAbandoned = useCallback((reason: FormAbandonedAuditPayload["reason"]) => {
    const currentContext = contextRef.current;
    const currentAssignmentId = assignmentIdRef.current;
    if (currentContext === null || currentAssignmentId === undefined || submittedRef.current || abandonedReportedRef.current) {
      return;
    }

    abandonedReportedRef.current = true;
    const snapshot = buildSnapshot(requiredFieldCount);
    const payload: FormAbandonedAuditPayload = {
      taskId: currentContext.task.id,
      assignmentId: currentAssignmentId,
      labelerId: currentContext.assignment.labelerId,
      schemaVersionId: currentContext.schemaVersionId,
      totalWallTimeMs: snapshot.totalWallTimeMs,
      activeTimeMs: snapshot.activeTimeMs,
      idleTimeMs: snapshot.idleTimeMs,
      changedFieldCount: snapshot.changedFieldCount,
      riskSignals: snapshot.riskSignals,
      reason,
    };

    void appendAuditEvent({
      type: "FORM_ABANDONED",
      severity: snapshot.riskSignals.length > 0 ? "WARNING" : "INFO",
      source: "WEB",
      actor: createLabelerActor(currentContext),
      target: createAssignmentTarget(currentContext, currentAssignmentId),
      payload,
      idempotencyKey: `LABELING:${currentAssignmentId}:FORM_ABANDONED:${sessionIdRef.current}`,
    }).catch((error) => {
      console.warn("写入标注放弃审计事件失败：", error);
    });
  }, [requiredFieldCount]);

  useEffect(() => {
    const handleBlur = () => {
      blurCountRef.current += 1;
      startIdlePeriod();
    };
    const handleFocus = () => {
      markActive();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        focusLossCountRef.current += 1;
        startIdlePeriod();
        appendAbandoned("PAGE_HIDDEN");
        return;
      }
      markActive();
    };
    const handlePageHide = () => {
      appendAbandoned("UNLOAD");
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [appendAbandoned, markActive]);

  const handleAnswersChange = useCallback((nextAnswers: AnswerPayload) => {
    markActive();
    const changedFields = collectChangedFields(answersRef.current, nextAnswers);
    for (const fieldName of changedFields) {
      changedFieldNamesRef.current.add(fieldName);
    }
    fieldEditCountRef.current += changedFields.length;
    answersRef.current = nextAnswers;
    onAnswersChange(nextAnswers);
  }, [markActive, onAnswersChange]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    markActive();
    pasteCountRef.current += 1;
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      const fieldName = target.name || target.getAttribute("data-field-name") || target.id;
      if (fieldName) {
        textareaPasteFieldNamesRef.current.add(fieldName);
      }
    }
  }, [markActive]);

  const appendSubmissionSummary = useCallback((submitAnswers: AnswerPayload) => {
    const currentContext = contextRef.current;
    const currentAssignmentId = assignmentIdRef.current;
    if (currentContext === null || currentAssignmentId === undefined) {
      return;
    }

    submittedRef.current = true;
    const snapshot = buildSnapshot(requiredFieldCount, new Date().toISOString());
    const payload: LabelingSessionSummaryAuditPayload = {
      taskId: currentContext.task.id,
      assignmentId: currentAssignmentId,
      labelerId: currentContext.assignment.labelerId,
      schemaVersionId: currentContext.schemaVersionId,
      clientStartedAt: snapshot.clientStartedAt,
      clientSubmittedAt: snapshot.clientSubmittedAt,
      totalWallTimeMs: snapshot.totalWallTimeMs,
      activeTimeMs: snapshot.activeTimeMs,
      idleTimeMs: snapshot.idleTimeMs,
      blurCount: snapshot.blurCount,
      focusLossCount: snapshot.focusLossCount,
      pasteCount: snapshot.pasteCount,
      changedFieldCount: snapshot.changedFieldCount,
      fieldEditCount: snapshot.fieldEditCount,
      textareaPasteFieldNames: snapshot.textareaPasteFieldNames,
      riskSignals: snapshot.riskSignals,
    };

    void submitAnswers;
    void appendAuditEvent({
      type: "LABELING_SESSION_SUMMARY",
      severity: snapshot.riskSignals.length > 0 ? "WARNING" : "INFO",
      source: "WEB",
      actor: createLabelerActor(currentContext),
      target: createAssignmentTarget(currentContext, currentAssignmentId),
      payload,
      idempotencyKey: `LABELING:${currentAssignmentId}:LABELING_SESSION_SUMMARY:${snapshot.clientSubmittedAt ?? sessionIdRef.current}`,
    }).catch((error) => {
      console.warn("写入标注会话摘要审计事件失败：", error);
    });
  }, [requiredFieldCount]);

  function buildSnapshot(requiredCount: number, clientSubmittedAt?: string): TelemetrySnapshot {
    const nowMs = Date.now();
    const totalWallTimeMs = Math.max(0, nowMs - startedAtMsRef.current);
    const idleTimeMs = Math.min(totalWallTimeMs, Math.max(0, idleMsRef.current + getCurrentIdleMs(nowMs)));
    const activeTimeMs = Math.max(0, totalWallTimeMs - idleTimeMs);
    const changedFieldCount = changedFieldNamesRef.current.size;
    const riskSignals = calculateRiskSignals({
      activeTimeMs,
      totalWallTimeMs,
      pasteCount: pasteCountRef.current,
      changedFieldCount,
      requiredFieldCount: requiredCount,
    });

    return {
      clientStartedAt: clientStartedAtRef.current,
      clientSubmittedAt,
      totalWallTimeMs,
      activeTimeMs,
      idleTimeMs,
      blurCount: blurCountRef.current,
      focusLossCount: focusLossCountRef.current,
      pasteCount: pasteCountRef.current,
      changedFieldCount,
      fieldEditCount: fieldEditCountRef.current,
      textareaPasteFieldNames: Array.from(textareaPasteFieldNamesRef.current).sort(),
      riskSignals,
    };
  }

  function startIdlePeriod(): void {
    if (idleStartedAtMsRef.current === null) {
      idleStartedAtMsRef.current = Date.now();
    }
  }

  function closeIdlePeriod(): void {
    if (idleStartedAtMsRef.current === null) {
      return;
    }
    idleMsRef.current += Math.max(0, Date.now() - idleStartedAtMsRef.current);
    idleStartedAtMsRef.current = null;
  }

  function getCurrentIdleMs(nowMs: number): number {
    return idleStartedAtMsRef.current === null ? 0 : Math.max(0, nowMs - idleStartedAtMsRef.current);
  }

  return {
    handleActivity: markActive,
    handleAnswersChange,
    handlePaste,
    appendSubmissionSummary,
  };
}

function createSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLabelerActor(context: AssignmentContextResponse): AuditActor {
  return {
    id: context.assignment.labelerId,
    role: "LABELER",
    displayName: "标注员",
  };
}

function createAssignmentTarget(context: AssignmentContextResponse, assignmentId: string): AuditTarget {
  return {
    entityType: "ASSIGNMENT",
    entityId: assignmentId,
    taskId: context.task.id,
    assignmentId,
    schemaVersionId: context.schemaVersionId,
  };
}

function collectChangedFields(previous: AnswerPayload, next: AnswerPayload): string[] {
  const fieldNames = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return Array.from(fieldNames).filter((fieldName) => !isSameValue(previous[fieldName], next[fieldName]));
}

function isSameValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return Object.is(left, right);
  }
}

function calculateRiskSignals(input: {
  activeTimeMs: number;
  totalWallTimeMs: number;
  pasteCount: number;
  changedFieldCount: number;
  requiredFieldCount: number;
}): RiskSignalCode[] {
  const signals: RiskSignalCode[] = [];
  if (input.activeTimeMs < 3000) {
    signals.push("FAST_SUBMIT");
  }
  if (input.totalWallTimeMs > 0 && input.activeTimeMs < input.totalWallTimeMs * 0.1) {
    signals.push("LOW_ACTIVE_TIME");
  }
  if (input.pasteCount >= 3 && input.pasteCount / Math.max(input.changedFieldCount, 1) > 0.5) {
    signals.push("HIGH_PASTE_COUNT");
  }
  if (input.changedFieldCount <= 1 && input.requiredFieldCount > 3) {
    signals.push("LOW_FIELD_CHANGE_COUNT");
  }
  return signals;
}

function countRequiredFields(schema: LabelHubSchema): number {
  return countRequiredNodes(schema.root);
}

function countRequiredNodes(node: SchemaNode): number {
  if (node.kind === "FIELD") {
    return node.required === true ? 1 : 0;
  }
  if (node.kind === "CONTAINER") {
    return node.children.reduce((total, child) => total + countRequiredNodes(child), 0);
  }
  return 0;
}
