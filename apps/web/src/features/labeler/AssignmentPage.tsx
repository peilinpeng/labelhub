import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { runSchemaPreflight } from "@labelhub/schema-compiler";
import { collectFieldNodes } from "@labelhub/schema-core";
import { SchemaRenderer, type LLMAssistOutcome } from "@labelhub/schema-renderer";
import { Role } from "../../app/routes";
import { callLLMAssist, getAssignmentContext, saveDraft, submitAssignment } from "../../api/labeler";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, shouldSuppressConfirm, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card } from "../../ui/primitives";
import { MarkdownPreview, docToMarkdown } from "../../ui/markdown";
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
  LabelHubRuntimeContext,
  LLMAssistNode,
  LLMRuntimeResponse,
  ValidationError,
  ValidationResult,
} from "@labelhub/contracts";

interface AssignmentPageProps {
  role: Role;
}

interface AcceptedAiAssistPatch {
  callId: string;
  nodeId: string;
  metadata?: AiAssistResponseMetadata;
  appliedPatchFieldNames: string[];
  editedFieldNames: Set<string>;
  editedReported: boolean;
  acceptedOrder: number;
}

// 自动保存徽章用：ISO 时间 → 本地 HH:MM:SS
function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function getItemTitle(item: DatasetItem): string {
  const payload = item.sourcePayload as Record<string, unknown>;
  const rawTitle =
    typeof payload.title === "string"
      ? payload.title
      : typeof payload.name === "string"
        ? payload.name
        : item.externalKey ?? item.id;
  return rawTitle.length > 12 ? `${rawTitle.slice(0, 12)}...` : rawTitle;
}

const EDITABLE_ASSIGNMENT_STATUSES = new Set<AssignmentStatus>(["CLAIMED", "DRAFTING", "RETURNED"]);

function isEditableAssignmentStatus(status: AssignmentStatus): boolean {
  return EDITABLE_ASSIGNMENT_STATUSES.has(status);
}

function assignmentStatusLabel(status: AssignmentStatus): string {
  if (status === "CLAIMED") return "已领取";
  if (status === "DRAFTING") return "草稿中";
  if (status === "SUBMITTED") return "已提交";
  if (status === "RETURNED") return "已打回";
  if (status === "ACCEPTED") return "已通过";
  if (status === "CANCELED") return "已取消";
  if (status === "EXPIRED") return "已过期";
  return "待处理";
}

function assignmentStatusTone(status: AssignmentStatus): "default" | "primary" | "success" | "warning" | "danger" {
  if (status === "ACCEPTED") return "success";
  if (status === "SUBMITTED") return "primary";
  if (status === "RETURNED") return "warning";
  if (status === "CANCELED" || status === "EXPIRED") return "danger";
  return "default";
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

export default function AssignmentPage({ role: _role }: AssignmentPageProps) {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [searchParams] = useSearchParams();
  // URL: ?renderer=legacy → legacy; ?renderer=smart or default → formily-v2
  const rendererParam = searchParams.get("renderer");
  const showRendererToggle = searchParams.get("showRendererToggle") === "1";
  const urlEngine: "legacy" | "formily-v2" = rendererParam === "legacy" ? "legacy" : "formily-v2";
  // 开发者切换控件（仅 ?showRendererToggle=1 时可见）
  const [toggleEngine, setToggleEngine] = useState<"legacy" | "formily-v2">(urlEngine);
  const rendererEngine = showRendererToggle ? toggleEngine : urlEngine;
  const [context, setContext] = useState<AssignmentContextResponse | null>(null);
  const [answers, setAnswers] = useState<AnswerPayload>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [pendingSubmitAnswers, setPendingSubmitAnswers] = useState<AnswerPayload | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const isEditableAssignment = context ? isEditableAssignmentStatus(context.assignment.status) : false;
  // 已保存内容的基线快照：用于自动保存的脏检查，避免把"刚载入的草稿"重复回存
  const savedSnapshotRef = useRef<string | null>(null);
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
          await saveDraft(assignmentId, { answers, clientRevision: 0 });
          savedSnapshotRef.current = snapshot;
          setLastSavedAt(new Date().toISOString());
        } catch (e) {
          console.error("Auto-save draft failed:", e);
          setSaveFailed(true);
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
      setSubmitFailed(true);
      setSubmitNotice(context ? readonlyAssignmentNotice(context.assignment.status) : "当前领取记录暂不可编辑。");
      return;
    }
    try {
      setSaving(true);
      setSaveFailed(false);
      await saveDraft(assignmentId, { answers, clientRevision: 0 });
      savedSnapshotRef.current = JSON.stringify(answers);
      setLastSavedAt(new Date().toISOString());
    } catch (e) {
      console.error("Failed to save draft:", e);
      setSaveFailed(true);
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
      response = await submitAssignment(assignmentId, { answers: submitAnswers, clientRevision: 0 });
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
    setSubmitNotice(
      response.nextStatus === "NEEDS_HUMAN_REVIEW" || response.nextStatus === "HUMAN_REVIEWING"
        ? "标注已提交，已进入人工审核队列。可回任务市场继续领取下一条数据。"
        : "标注已提交，已进入 AI 预审/审核流程。可回任务市场继续领取下一条数据。",
    );
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
        output: { summary: "LLM 辅助暂时不可用" },
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

  if (loading) {
    return <Card className="state-panel">加载标注工作台中...</Card>;
  }

  if (!context) {
    return <Card className="state-panel danger-text">任务不存在</Card>;
  }

  const sourcePayload = context.item.sourcePayload as Record<string, unknown>;
  // 通用源数据预览：仅对带 title/name + body/text 的数据集（如商品标注 demo）展示。
  // 问答/偏好类数据集的源数据（prompt/answer/媒体）由 schema 的 ShowItem 节点承载渲染，
  // 不走此面板，避免出现空的「商品标题」残留卡片。
  const sourceTitle =
    typeof sourcePayload.title === "string"
      ? sourcePayload.title
      : typeof sourcePayload.name === "string"
        ? sourcePayload.name
        : "";
  const sourceBody =
    typeof sourcePayload.body === "string"
      ? sourcePayload.body
      : typeof sourcePayload.text === "string"
        ? sourcePayload.text
        : "";
  const hasGenericSource = sourceTitle !== "" || sourceBody !== "";
  const sourceMeta = typeof sourcePayload.source === "string" ? sourcePayload.source : "任务数据";
  const itemTitle = getItemTitle(context.item);
  const readonlyNotice = isEditableAssignment ? null : readonlyAssignmentNotice(context.assignment.status);
  const draftBadgeText = !isEditableAssignment
    ? "当前领取记录只读"
    : saving
      ? "保存中..."
      : saveFailed
        ? "保存失败，请稍后重试"
        : lastSavedAt
          ? `草稿已自动保存 ${formatClock(lastSavedAt)}`
          : "草稿未保存";

  return (
    <div className="labeler-runner" onClick={telemetry.handleActivity} onPaste={telemetry.handlePaste}>
      <header className="labeler-runner-topbar">
        <div className="labeler-runner-brand">
          <span className="brand-mark brand-mark--small" />
          <strong>LabelHub</strong>
          <span>标注员工作台 / 任务市场 · {context.task.title} / 当前领取数据</span>
        </div>
        <div className="labeler-runner-user">
          <Badge tone={!isEditableAssignment ? "primary" : saving ? "warning" : saveFailed ? "danger" : lastSavedAt ? "success" : "default"}>
            {draftBadgeText}
          </Badge>
          <span className="labeler-runner-avatar">标</span>
          <span>标注员</span>
        </div>
      </header>

      <div className="labeler-runner-layout">
        <aside className="labeler-runner-nav">
          <div className="labeler-runner-panel-head">
            <div>
              <h3>当前数据</h3>
              <p>一个领取记录只绑定一条真实数据</p>
            </div>
          </div>
          <div className="labeler-runner-items">
            <div className="labeler-runner-item labeler-runner-item--current labeler-runner-item--static">
              <span>#001 {itemTitle}</span>
              <span className="labeler-runner-status">
                <span className="labeler-runner-dot labeler-runner-dot--primary" />
                {assignmentStatusLabel(context.assignment.status)}
              </span>
            </div>
            <p className="labeler-runner-more">提交后请回任务市场重新领取下一条数据。</p>
          </div>
        </aside>

        <main className="labeler-runner-main">
          <section className="labeler-runner-main-head">
            <div title={`数据 ${context.item.id}`}>
              <h1>{context.task.title} · 当前领取数据</h1>
              <p>模板 r{context.schema.schemaVersionNo ?? "-"} · 领取记录 {context.assignment.id}</p>
            </div>
            <div className="labeler-runner-head-actions">
              <Badge tone={assignmentStatusTone(context.assignment.status)}>
                {assignmentStatusLabel(context.assignment.status)}
              </Badge>
              <Link className="lh-button" to="/labeler/tasks">任务市场</Link>
              <Link className="lh-button" to="/labeler/submissions">我的提交</Link>
            </div>
          </section>

          <div className="labeler-runner-scroll">
            {readonlyNotice ? (
              <div className="labeler-runner-alert" role="status">
                <div className="labeler-runner-alert-head">
                  <span className="labeler-runner-alert-tag">只读</span>
                  <strong>{readonlyNotice}</strong>
                </div>
              </div>
            ) : null}

            {returnNotice ? (
              <div className="labeler-runner-alert" role="status">
                <div className="labeler-runner-alert-head">
                  <span className="labeler-runner-alert-tag">已打回 · 待修改</span>
                  <strong>请根据审核意见修订后重新提交</strong>
                </div>
                {returnNotice.generalMessages.length > 0 ? (
                  <ul className="labeler-runner-alert-list">
                    {returnNotice.generalMessages.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                ) : null}
                {returnNotice.fieldComments.length > 0 ? (
                  <div className="labeler-runner-alert-fields">
                    <span>需要修改的字段</span>
                    <ul>
                      {returnNotice.fieldComments.map((field, index) => (
                        <li key={index}>
                          <strong>{field.title}</strong>
                          {field.message !== "" ? `：${field.message}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {submitNotice ? (
              <div
                className={submitFailed ? "labeler-runner-fail" : "labeler-runner-success"}
                role={submitFailed ? "alert" : "status"}
              >
                {submitNotice}
              </div>
            ) : null}

            {hasGenericSource ? (
              <section className="labeler-runner-source">
                <div className="labeler-runner-source-label">原始数据（不可编辑） · {sourceMeta}</div>
                {sourceTitle !== "" ? <p>{sourceTitle}</p> : null}
                {sourceBody !== "" ? <small>{sourceBody}</small> : null}
              </section>
            ) : null}

            <section className="labeler-runner-form">
              {showRendererToggle ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "4px 0" }}>
                  <span style={{ fontSize: 12, color: "#666" }}>表单运行模式</span>
                  <Button
                    onClick={() => setToggleEngine((e) => (e === "legacy" ? "formily-v2" : "legacy"))}
                  >
                    {toggleEngine === "legacy" ? "经典渲染" : "智能联动渲染"}
                  </Button>
                </div>
              ) : null}
              <div className="renderer-frame labeler-renderer-frame labeler-schema-renderer-surface">
                <SchemaRenderer
                  schema={context.schema}
                  context={runtimeContext}
                  answers={answers}
                  mode="LABELING"
                  readonly={!isEditableAssignment}
                  errors={errors}
                  engine={rendererEngine}
                  onAnswersChange={handleRendererAnswersChange}
                  onSubmit={handleSubmit}
                  onLLMAssist={handleLLMAssist}
                  onAssistOutcome={handleAssistOutcome}
                />
              </div>
            </section>
          </div>

          <footer className="labeler-runner-actions">
            <div>
              <Link className="lh-button" to="/labeler/tasks">返回任务市场</Link>
              <Link className="lh-button" to="/labeler/submissions">查看我的提交</Link>
            </div>
            <div className="labeler-runner-submit-group">
              <span>{isEditableAssignment ? "当前领取记录可保存草稿并提交审核" : "当前领取记录已锁定为只读"}</span>
              {missingRequiredFields.length > 0 ? (
                <span className="labeler-runner-required-warning">
                  请补充必填字段：{missingRequiredFields.map((f) => f.title).join("、")}
                </span>
              ) : null}
              <Button onClick={handleSaveDraft} disabled={!isEditableAssignment || saving || submitting}>
                {saving ? "保存中..." : "保存草稿"}
              </Button>
              <Button
                tone="primary"
                disabled={!isEditableAssignment || missingRequiredFields.length > 0 || submitting}
                title={
                  !isEditableAssignment
                    ? readonlyAssignmentNotice(context.assignment.status)
                    : missingRequiredFields.length > 0
                      ? "请先补全必填字段再提交"
                      : undefined
                }
                onClick={() => requestSubmit()}
              >
                {submitting ? "提交中..." : "提交当前数据"}
              </Button>
            </div>
          </footer>
        </main>

        <aside className="labeler-runner-side">
          {docToMarkdown(context.task.instructionRichText).trim() ? (
            <section className="labeler-runner-side-card">
              <h3>标注须知</h3>
              <MarkdownPreview source={docToMarkdown(context.task.instructionRichText)} />
            </section>
          ) : null}

        </aside>
      </div>

      <ConfirmDialog
        open={submitConfirmOpen}
        title="确认提交标注？"
        description="提交后将进入 AI 预审与人工审核流程。"
        confirmText="提交标注"
        cancelText="继续编辑"
        suppressLabel="本次会话不再提醒提交确认"
        onCancel={() => {
          setSubmitConfirmOpen(false);
          setPendingSubmitAnswers(null);
        }}
        onConfirm={(suppress) => {
          if (suppress) {
            suppressConfirmForSession(CONFIRM_KEYS.submit);
          }
          setSubmitConfirmOpen(false);
          void confirmSubmit(pendingSubmitAnswers ?? answers);
          setPendingSubmitAnswers(null);
        }}
      />
    </div>
  );
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
