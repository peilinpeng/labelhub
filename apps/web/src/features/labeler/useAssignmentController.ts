import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { runSchemaPreflight } from "@labelhub/schema-compiler";
import { collectFieldNodes } from "@labelhub/schema-core";
import type { LLMAssistOutcome } from "@labelhub/schema-renderer";
import { callLLMAssist, claimTask, getAssignmentContext, listAssignmentItems, saveDraft, submitAssignment } from "../../api/labeler";
import { ApiRequestError } from "../../api/client";
import { CONFIRM_KEYS, shouldSuppressConfirm } from "../../ui/confirm";
import {
  appendAiAssistEditedAuditSafely,
  appendAiAssistOutcomeAuditSafely,
  appendAiAssistTriggeredAuditSafely,
  extractAiAssistResponseMetadata,
  type AiAssistResponseMetadata,
} from "./ai-assist-audit-events";
import { useLabelingTelemetry } from "./useLabelingTelemetry";
import type {
  AnswerPayload,
  AssignmentContextResponse,
  AssignmentStatus,
  DatasetItem,
  ID,
  LabelHubRuntimeContext,
  LLMAssistNode,
  LLMRuntimeResponse,
  ValidationError,
  ValidationResult,
} from "@labelhub/contracts";

interface AcceptedAiAssistPatch {
  callId: string;
  nodeId: string;
  metadata?: AiAssistResponseMetadata;
  appliedPatchFieldNames: string[];
  editedFieldNames: Set<string>;
  editedReported: boolean;
  acceptedOrder: number;
}

const EDITABLE_ASSIGNMENT_STATUSES = new Set<AssignmentStatus>(["CLAIMED", "DRAFTING", "RETURNED"]);

function isEditableAssignmentStatus(status: AssignmentStatus): boolean {
  return EDITABLE_ASSIGNMENT_STATUSES.has(status);
}

function readonlyAssignmentNotice(status: AssignmentStatus): string {
  if (status === "SUBMITTED") return "当前领取记录已经提交，不能重复提交。请回任务市场领取下一条数据。";
  if (status === "ACCEPTED") return "当前领取记录已审核通过，不能继续编辑。请回任务市场领取下一条数据。";
  if (status === "CANCELED") return "当前领取记录已取消，不能继续编辑。请回任务市场重新领取数据。";
  if (status === "EXPIRED") return "当前领取记录已过期，不能继续编辑。请回任务市场重新领取数据。";
  return "当前领取记录暂不可编辑。";
}

function submitFailureNotice(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("不允许提交") || message.includes("SUBMITTED")) {
    return "当前领取记录已经提交，不能重复提交。请回任务市场领取下一条数据。";
  }
  return message.trim() ? `提交失败：${message}` : "提交失败，请稍后重试。";
}


export function useAssignmentController() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [searchParams] = useSearchParams();
  // URL: ?renderer=legacy → legacy; ?renderer=smart or default → formily-v2
  const rendererParam = searchParams.get("renderer");
  const showRendererToggle = searchParams.get("showRendererToggle") === "1";
  const urlEngine: "legacy" | "formily-v2" = rendererParam === "legacy" ? "legacy" : "formily-v2";
  // 开发者切换控件（仅 ?showRendererToggle=1 时可见）
  const [toggleEngine, setToggleEngine] = useState<"legacy" | "formily-v2">(urlEngine);
  const rendererEngine = showRendererToggle ? toggleEngine : urlEngine;
  const navigate = useNavigate();
  const [context, setContext] = useState<AssignmentContextResponse | null>(null);
  // 当前任务的全部数据（供左侧列出、逐条标注、提交后切下一条）
  const [taskItems, setTaskItems] = useState<DatasetItem[]>([]);
  const [claimingItemId, setClaimingItemId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerPayload>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // 区分失败来源：autosave 失败用柔和提示（内容已保留），手动保存失败显示明确错误
  const [saveErrorKind, setSaveErrorKind] = useState<"auto" | "manual" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [pendingSubmitAnswers, setPendingSubmitAnswers] = useState<AnswerPayload | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  // 草稿版本冲突后的一次性提示：服务端草稿被其它会话更新，已自动重新同步版本号
  const [draftResyncNotice, setDraftResyncNotice] = useState<string | null>(null);
  const isEditableAssignment = context ? isEditableAssignmentStatus(context.assignment.status) : false;
  // 已保存内容的基线快照：用于自动保存的脏检查，避免把"刚载入的草稿"重复回存
  const savedSnapshotRef = useRef<string | null>(null);
  // 当前服务端草稿版本号（乐观锁）：载入时取服务端值，每次保存成功后更新为返回值。
  // 不再写死 0，否则服务端已是 v1 时自动保存会永远 409 REVISION_CONFLICT。
  const serverRevisionRef = useRef(0);
  const aiAssistMetadataByCallIdRef = useRef<Map<string, AiAssistResponseMetadata>>(new Map());
  const acceptedAiAssistPatchesRef = useRef<Map<string, AcceptedAiAssistPatch>>(new Map());
  const aiAssistCallAttemptCounterRef = useRef(0);
  const aiAssistAcceptedOrderCounterRef = useRef(0);
  const telemetry = useLabelingTelemetry({
    assignmentId,
    context,
    answers,
    onAnswersChange: setAnswers,
  });

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        if (assignmentId) {
          const data = await getAssignmentContext(assignmentId);
          setContext(data);
          setAnswers(data.draft?.answers ?? {});
          serverRevisionRef.current = data.draft?.serverRevision ?? 0;
          // 拉取任务全部数据，供左侧导航逐条标注（失败不阻断作答）
          listAssignmentItems(assignmentId)
            .then(setTaskItems)
            .catch((err) => console.warn("加载任务数据列表失败：", err));
        }
      } catch (e) {
        console.error("Failed to fetch assignment:", e);
        setContext(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [assignmentId]);

  useEffect(() => {
    aiAssistMetadataByCallIdRef.current.clear();
    acceptedAiAssistPatchesRef.current.clear();
    aiAssistCallAttemptCounterRef.current = 0;
    aiAssistAcceptedOrderCounterRef.current = 0;
    // 换 assignment：重置自动保存基线，下一次 effect 以当前答案重新建基线。
    savedSnapshotRef.current = null;
  }, [assignmentId, context?.item.id]);

  // 保存草稿并维护乐观锁版本号：clientRevision 取当前服务端版本，成功后更新为返回值。
  // 若返回 409 REVISION_CONFLICT（服务端草稿已被更新），重新拉取最新版本号后保留本地
  // 答案重试一次（last-write-wins），并给出"已重新同步"的提示，而不是持续用旧版本失败。
  const persistDraft = async (draftAnswers: AnswerPayload): Promise<void> => {
    if (!assignmentId) return;
    try {
      const resp = await saveDraft(assignmentId, { answers: draftAnswers, clientRevision: serverRevisionRef.current });
      serverRevisionRef.current = resp.draft.serverRevision;
    } catch (e) {
      const conflict = e instanceof ApiRequestError && (e.status === 409 || e.code === "REVISION_CONFLICT");
      if (!conflict) throw e;
      const latest = await getAssignmentContext(assignmentId);
      serverRevisionRef.current = latest.draft?.serverRevision ?? serverRevisionRef.current;
      const resp = await saveDraft(assignmentId, { answers: draftAnswers, clientRevision: serverRevisionRef.current });
      serverRevisionRef.current = resp.draft.serverRevision;
      setDraftResyncNotice("草稿已在服务端更新，已重新同步最新版本，你的当前内容已保存。");
    }
  };

  // 草稿自动保存：答案变化且与上次已保存内容不同时，空闲 1.2s 后回存草稿（防丢失）。
  // 首次载入草稿时仅建立基线快照、不触发保存；保存成功后刷新基线与时间戳。
  useEffect(() => {
    if (!assignmentId || loading || !isEditableAssignment) return;
    const snapshot = JSON.stringify(answers);
    if (savedSnapshotRef.current === null) {
      savedSnapshotRef.current = snapshot; // 建立基线（载入的草稿）
      return;
    }
    if (snapshot === savedSnapshotRef.current) return; // 无改动，跳过
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setSaving(true);
          setSaveFailed(false);
          await persistDraft(answers);
          savedSnapshotRef.current = snapshot;
          setLastSavedAt(new Date().toISOString());
          setSaveErrorKind(null);
        } catch (e) {
          console.error("Auto-save draft failed:", e);
          setSaveFailed(true);
          setSaveErrorKind("auto");
        } finally {
          setSaving(false);
        }
      })();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [answers, assignmentId, loading, isEditableAssignment]);

  const runtimeContext: LabelHubRuntimeContext = context
    ? {
        task: {
          id: context.task.id,
          title: context.task.title,
          status: context.task.status,
          activeSchemaVersionId: context.schemaVersionId,
        },
        schema: {
          schemaId: context.schema.schemaId,
          schemaVersionId: context.schemaVersionId,
          schemaVersionNo: context.schema.schemaVersionNo,
          contractVersion: "1.1",
        },
        item: {
          id: context.item.id,
          sourcePayload: context.item.sourcePayload,
        },
        answers,
        system: {
          actor: {
            id: "usr_labeler",
            role: "LABELER",
            displayName: "标注员",
          },
          role: "LABELER",
          now: new Date().toISOString(),
        },
      }
    : {
        task: { id: "task_empty", title: "", status: "DRAFT", activeSchemaVersionId: "sv_empty" },
        schema: { schemaId: "schema_empty", schemaVersionId: "sv_empty", schemaVersionNo: 1, contractVersion: "1.1" },
        item: { id: "item_empty", sourcePayload: {} },
        answers: {},
        system: {
          actor: { id: "usr_empty", role: "LABELER", displayName: "" },
          role: "LABELER",
          now: new Date().toISOString(),
        },
      };

  const fieldTitleMap = useMemo<Map<string, string>>(() => {
    if (!context) return new Map();
    return new Map(collectFieldNodes(context.schema).map((n) => [n.name, n.title]));
  }, [context]);

  const missingRequiredFields = useMemo<Array<{ name: string; title: string }>>(() => {
    if (!context) return [];
    const result = runSchemaPreflight({ schema: context.schema, currentAnswers: answers, patch: [] });
    return result.requiredMissingFieldNames.map((name) => ({
      name,
      title: fieldTitleMap.get(name) ?? name,
    }));
  }, [context, answers, fieldTitleMap]);

  // 打回提示：把上一轮审核打回的意见拆成「整体说明」与「需要修改的字段」，
  // 只展示人话内容（审核意见 + 字段标题），不暴露任何审计 / 原始 payload。
  const returnNotice = useMemo(() => {
    const review = context?.lastReturnReason;
    if (!review) return null;
    const generalMessages: string[] = [];
    const fieldComments: Array<{ title: string; message: string }> = [];
    for (const comment of review.comments ?? []) {
      const message = comment.message?.trim() ?? "";
      if (comment.fieldName) {
        fieldComments.push({ title: fieldTitleMap.get(comment.fieldName) ?? comment.fieldName, message });
      } else if (message !== "") {
        generalMessages.push(message);
      }
    }
    return { generalMessages, fieldComments };
  }, [context, fieldTitleMap]);

  const handleSaveDraft = async () => {
    if (!assignmentId) return;
    if (!isEditableAssignment) {
      setSaveFailed(false);
      setSaveErrorKind(null);
      setSubmitFailed(true);
      setSubmitNotice(context ? readonlyAssignmentNotice(context.assignment.status) : "当前领取记录暂不可编辑。");
      return;
    }
    try {
      setSaving(true);
      setSaveFailed(false);
      await persistDraft(answers);
      savedSnapshotRef.current = JSON.stringify(answers);
      setLastSavedAt(new Date().toISOString());
      setSaveErrorKind(null);
    } catch (e) {
      console.error("Failed to save draft:", e);
      setSaveFailed(true);
      setSaveErrorKind("manual");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (submitAnswers: AnswerPayload, validation: ValidationResult) => {
    if (!assignmentId) return;
    if (!isEditableAssignment) {
      setSubmitFailed(true);
      setSubmitNotice(context ? readonlyAssignmentNotice(context.assignment.status) : "当前领取记录暂不可编辑。");
      return;
    }
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    requestSubmit(submitAnswers);
  };

  const confirmSubmit = async (submitAnswers: AnswerPayload = answers) => {
    if (!context || !assignmentId) return;
    if (!isEditableAssignment) {
      setSubmitFailed(true);
      setSubmitNotice(readonlyAssignmentNotice(context.assignment.status));
      return;
    }
    const preflight = runSchemaPreflight({ schema: context.schema, currentAnswers: submitAnswers, patch: [] });
    if (preflight.requiredMissingFieldNames.length > 0) return;
    let response: Awaited<ReturnType<typeof submitAssignment>>;
    try {
      setSubmitting(true);
      setSubmitFailed(false);
      response = await submitAssignment(assignmentId, { answers: submitAnswers, clientRevision: serverRevisionRef.current });
    } catch (error) {
      console.warn("提交标注失败：", error);
      setSubmitFailed(true);
      setSubmitNotice(submitFailureNotice(error));
      return;
    } finally {
      setSubmitting(false);
    }
    setSubmitFailed(false);
    telemetry.appendSubmissionSummary(submitAnswers);
    savedSnapshotRef.current = JSON.stringify(submitAnswers);
    setContext((current) => (current ? { ...current, assignment: response.assignment } : current));
    setErrors([]);
    // 刷新任务数据列表（当前条已变为已锁定/完成），并提示在左侧继续标注下一条
    if (assignmentId) {
      listAssignmentItems(assignmentId).then(setTaskItems).catch(() => undefined);
    }
    const remaining = taskItems.filter(
      (it) => it.status === "AVAILABLE" && it.id !== context?.item.id,
    ).length;
    setSubmitNotice(
      remaining > 0
        ? `标注已提交，已进入审核流程。本任务还有 ${remaining} 条待标注，可在左侧「任务数据」中点选下一条继续。`
        : "标注已提交，已进入审核流程。本任务数据已全部标注完成。",
    );
  };

  // 在工作台内切换/领取本任务的另一条数据：领取该题并跳转到其作答页，无需回任务市场。
  const goToItem = async (itemId: string) => {
    if (!context || itemId === context.item.id || claimingItemId) return;
    try {
      setClaimingItemId(itemId);
      const res = await claimTask(context.task.id, { preferredItemId: itemId as ID });
      navigate(`/labeler/workspace/${res.context.assignment.id}`);
    } catch (error) {
      setSubmitFailed(true);
      setSubmitNotice(
        error instanceof Error ? `领取该条数据失败：${error.message}` : "领取该条数据失败，请稍后重试。",
      );
    } finally {
      setClaimingItemId(null);
    }
  };

  const requestSubmit = (submitAnswers: AnswerPayload = answers) => {
    if (context && !isEditableAssignment) {
      setSubmitFailed(true);
      setSubmitNotice(readonlyAssignmentNotice(context.assignment.status));
      return;
    }
    if (shouldSuppressConfirm(CONFIRM_KEYS.submit)) {
      void confirmSubmit(submitAnswers);
      return;
    }
    setPendingSubmitAnswers(submitAnswers);
    setSubmitConfirmOpen(true);
  };

  const handleLLMAssist = async (
    node: LLMAssistNode,
    _runtimeCtx: LabelHubRuntimeContext,
    currentAnswers: AnswerPayload,
  ): Promise<LLMRuntimeResponse> => {
    if (!assignmentId || !context) {
      return { output: { summary: "请先选择任务" }, suggestedPatch: {}, callId: "llm_unavailable" };
    }
    if (!isEditableAssignment) {
      return { output: { summary: readonlyAssignmentNotice(context.assignment.status) }, suggestedPatch: {}, callId: "llm_readonly" };
    }
    const callAttemptId = String((aiAssistCallAttemptCounterRef.current += 1));
    appendAiAssistTriggeredAuditSafely({
      assignmentId,
      context,
      node,
      callAttemptId,
    });
    try {
      const response = await callLLMAssist(assignmentId, { nodeId: node.id, answers: currentAnswers });
      aiAssistMetadataByCallIdRef.current.set(response.callId, extractAiAssistResponseMetadata(response));
      return response;
    } catch {
      const fallbackResponse: LLMRuntimeResponse = {
        output: { summary: "AI 辅助暂时不可用，你仍可继续人工作答。" },
        suggestedPatch: {},
        callId: `llm_unavailable_${callAttemptId}` as LLMRuntimeResponse["callId"],
      };
      aiAssistMetadataByCallIdRef.current.set(fallbackResponse.callId, extractAiAssistResponseMetadata(fallbackResponse));
      return fallbackResponse;
    }
  };

  const handleAssistOutcome = (outcome: LLMAssistOutcome) => {
    if (!assignmentId || !context) return;
    const metadata = aiAssistMetadataByCallIdRef.current.get(outcome.callId);
    appendAiAssistOutcomeAuditSafely({
      assignmentId,
      context,
      outcome,
      metadata,
    });

    if (outcome.action !== "ACCEPTED" || outcome.appliedPatchFieldNames === undefined) {
      return;
    }

    const appliedPatchFieldNames = [...new Set(outcome.appliedPatchFieldNames)].sort();
    if (appliedPatchFieldNames.length === 0) {
      return;
    }

    acceptedAiAssistPatchesRef.current.set(outcome.callId, {
      callId: outcome.callId,
      nodeId: outcome.nodeId,
      metadata,
      appliedPatchFieldNames,
      editedFieldNames: new Set(),
      editedReported: false,
      acceptedOrder: (aiAssistAcceptedOrderCounterRef.current += 1),
    });
  };

  const handleRendererAnswersChange = (nextAnswers: AnswerPayload) => {
    if (!isEditableAssignment) return;
    const changedFieldNames = collectChangedAnswerFields(answers, nextAnswers);
    telemetry.handleAnswersChange(nextAnswers);
    reportAiAssistEditedFields(changedFieldNames);
  };

  const reportAiAssistEditedFields = (changedFieldNames: string[]) => {
    if (!assignmentId || !context || changedFieldNames.length === 0) return;

    const changedFieldSet = new Set(changedFieldNames);
    const claimedFieldNames = new Set<string>();
    const acceptedPatches = Array.from(acceptedAiAssistPatchesRef.current.values())
      .filter((patch) => !patch.editedReported)
      .sort((left, right) => right.acceptedOrder - left.acceptedOrder);

    for (const patch of acceptedPatches) {
      const editedFieldNames = patch.appliedPatchFieldNames.filter((fieldName) =>
        changedFieldSet.has(fieldName) && !claimedFieldNames.has(fieldName),
      );
      if (editedFieldNames.length === 0) {
        continue;
      }

      for (const fieldName of editedFieldNames) {
        claimedFieldNames.add(fieldName);
        patch.editedFieldNames.add(fieldName);
      }
      patch.editedReported = true;
      appendAiAssistEditedAuditSafely({
        assignmentId,
        context,
        callId: patch.callId,
        nodeId: patch.nodeId,
        metadata: patch.metadata,
        editedFieldNames: Array.from(patch.editedFieldNames),
      });
    }
  };

  return {
    answers,
    claimingItemId,
    confirmSubmit,
    context,
    draftResyncNotice,
    errors,
    goToItem,
    handleAssistOutcome,
    handleLLMAssist,
    handleRendererAnswersChange,
    handleSaveDraft,
    handleSubmit,
    isEditableAssignment,
    lastSavedAt,
    loading,
    missingRequiredFields,
    pendingSubmitAnswers,
    rendererEngine,
    requestSubmit,
    returnNotice,
    saveErrorKind,
    saveFailed,
    saving,
    setPendingSubmitAnswers,
    setSubmitConfirmOpen,
    setToggleEngine,
    showRendererToggle,
    submitConfirmOpen,
    submitFailed,
    submitNotice,
    submitting,
    taskItems,
    telemetry,
    toggleEngine,
    runtimeContext,
  };
}
function collectChangedAnswerFields(previous: AnswerPayload, next: AnswerPayload): string[] {
  const fieldNames = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return Array.from(fieldNames).filter((fieldName) => !isSameAnswerValue(previous[fieldName], next[fieldName]));
}

function isSameAnswerValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return Object.is(left, right);
  }
}
