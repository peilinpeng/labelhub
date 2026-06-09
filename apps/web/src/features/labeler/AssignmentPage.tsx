import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { runSchemaPreflight } from "@labelhub/schema-compiler";
import { collectFieldNodes } from "@labelhub/schema-core";
import { SchemaRenderer, type LLMAssistOutcome } from "@labelhub/schema-renderer";
import { Role } from "../../app/routes";
import { callLLMAssist, getAssignmentContext, listAssignmentItems, saveDraft, submitAssignment } from "../../api/labeler";
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

type LabelerNavigationStatus = "Submitted" | "Returned" | "Current" | "Draft" | "Pending";

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

function getNavigationStatus(
  item: DatasetItem,
  currentItemId: string,
  index: number,
  submittedItemIds: Set<string>,
): LabelerNavigationStatus {
  if (item.id === currentItemId) return "Current";
  if (submittedItemIds.has(item.id)) return "Submitted";
  if (item.status === "COMPLETED") return "Submitted";
  if (item.status === "LOCKED") return index === 0 ? "Draft" : "Pending";
  return "Pending";
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
  const [answersByItemId, setAnswersByItemId] = useState<Record<string, AnswerPayload>>({});
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [pendingSubmitAnswers, setPendingSubmitAnswers] = useState<AnswerPayload | null>(null);
  const [taskItems, setTaskItems] = useState<DatasetItem[]>([]);
  const [submittedItemIds, setSubmittedItemIds] = useState<string[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
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
          try {
            const items = await listAssignmentItems(assignmentId);
            setTaskItems(items.length > 0 ? items : [data.item]);
          } catch {
            setTaskItems([data.item]);
          }
        }
      } catch (e) {
        console.error("Failed to fetch assignment:", e);
        setContext(null);
        setTaskItems([]);
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
    // 切题/换 assignment：重置自动保存基线，下一次 effect 以当前题答案重新建基线，
    // 避免把"导航切换导致的 answers 变化"误判为脏数据触发保存。
    savedSnapshotRef.current = null;
  }, [assignmentId, context?.item.id]);

  // 草稿自动保存：答案变化且与上次已保存内容不同时，空闲 1.2s 后回存草稿（防丢失）。
  // 首次载入草稿时仅建立基线快照、不触发保存；保存成功后刷新基线与时间戳。
  useEffect(() => {
    if (!assignmentId || loading) return;
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
  }, [answers, assignmentId, loading]);

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
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    requestSubmit(submitAnswers);
  };

  const confirmSubmit = async (submitAnswers: AnswerPayload = answers) => {
    if (!context || !assignmentId) return;
    const preflight = runSchemaPreflight({ schema: context.schema, currentAnswers: submitAnswers, patch: [] });
    if (preflight.requiredMissingFieldNames.length > 0) return;
    try {
      setSubmitting(true);
      setSubmitFailed(false);
      await submitAssignment(assignmentId, { answers: submitAnswers, clientRevision: 0 });
    } catch (error) {
      console.warn("提交标注失败：", error);
      setSubmitFailed(true);
      setSubmitNotice("提交失败，请稍后重试。");
      return;
    } finally {
      setSubmitting(false);
    }
    setSubmitFailed(false);
    telemetry.appendSubmissionSummary(submitAnswers);
    const currentItemId = context.item.id;
    const nextAnswersByItem = { ...answersByItemId, [currentItemId]: submitAnswers };
    const nextItem = navigationItems[currentItemIndex + 1];

    setAnswersByItemId(nextAnswersByItem);
    setSubmittedItemIds((current) => (current.includes(currentItemId) ? current : [...current, currentItemId]));
    setTaskItems((current) =>
      current.map((item) =>
        item.id === currentItemId ? { ...item, status: "COMPLETED", updatedAt: new Date().toISOString() } : item,
      ),
    );

    if (nextItem) {
      setSubmitNotice("标注已提交，已进入审核队列。");
      window.setTimeout(() => {
        setContext((current) => (current ? { ...current, item: nextItem } : current));
        setAnswers(nextAnswersByItem[nextItem.id] ?? {});
        setErrors([]);
        setSubmitNotice(null);
      }, 450);
      return;
    }

    setSubmitNotice("标注已提交，已进入审核队列。当前任务所有题目已完成！");
  };

  const requestSubmit = (submitAnswers: AnswerPayload = answers) => {
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
  const navigationItems = taskItems.length > 0 ? taskItems : [context.item];
  const currentItemIndex = Math.max(0, navigationItems.findIndex((item) => item.id === context.item.id));
  const currentItemNumber = currentItemIndex + 1;
  const totalItems = navigationItems.length;
  const previousItem = currentItemIndex > 0 ? navigationItems[currentItemIndex - 1] : null;
  const nextItem = currentItemIndex < navigationItems.length - 1 ? navigationItems[currentItemIndex + 1] : null;
  const progressPercent = Math.round((currentItemNumber / totalItems) * 100);
  const submittedItemSet = new Set(submittedItemIds);
  const switchToItem = (item: DatasetItem) => {
    if (!context || item.id === context.item.id) return;
    const nextAnswersByItem = { ...answersByItemId, [context.item.id]: answers };
    setAnswersByItemId(nextAnswersByItem);
    setContext({ ...context, item });
    setAnswers(nextAnswersByItem[item.id] ?? {});
    setErrors([]);
    setSubmitNotice(null);
    setSubmitFailed(false);
  };
  const itemStatusLabel = (status: LabelerNavigationStatus) =>
    status === "Submitted" ? "已提交" : status === "Returned" ? "已打回" : status === "Current" ? "进行中" : status === "Draft" ? "草稿" : "待标";
  const itemStatusClass = (status: LabelerNavigationStatus) =>
    status === "Submitted"
      ? "labeler-runner-dot--success"
      : status === "Returned"
        ? "labeler-runner-dot--danger"
        : status === "Current"
          ? "labeler-runner-dot--primary"
          : status === "Draft"
            ? "labeler-runner-dot--warning"
            : "";
  const itemNav = navigationItems.map((item, index) => {
    const status = getNavigationStatus(item, context.item.id, index, submittedItemSet);
    return {
      id: item.id,
      item,
      label: `#${String(index + 1).padStart(3, "0")}`,
      title: getItemTitle(item),
      status,
    };
  });

  return (
    <div className="labeler-runner" onClick={telemetry.handleActivity} onPaste={telemetry.handlePaste}>
      <header className="labeler-runner-topbar">
        <div className="labeler-runner-brand">
          <span className="brand-mark brand-mark--small" />
          <strong>LabelHub</strong>
          <span>标注员工作台 / 任务市场 · {context.task.title} / 第 {currentItemNumber} / {totalItems} 题</span>
        </div>
        <div className="labeler-runner-user">
          <Badge tone={saving ? "warning" : saveFailed ? "danger" : lastSavedAt ? "success" : "default"}>
            {saving
              ? "保存中..."
              : saveFailed
                ? "保存失败，请稍后重试"
                : lastSavedAt
                  ? `草稿已自动保存 ${formatClock(lastSavedAt)}`
                  : "草稿未保存"}
          </Badge>
          <span className="labeler-runner-avatar">标</span>
          <span>标注员</span>
        </div>
      </header>

      <div className="labeler-runner-layout">
        <aside className="labeler-runner-nav">
          <div className="labeler-runner-panel-head">
            <div>
              <h3>题目导航</h3>
              <p>{currentItemNumber} / {totalItems} · 进度 {progressPercent}%</p>
            </div>
          </div>
          <div className="labeler-runner-items">
            {itemNav.map((item) => (
              <button
                className={["labeler-runner-item", item.status === "Current" ? "labeler-runner-item--current" : ""]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
                onClick={() => switchToItem(item.item)}
                type="button"
              >
                <span>{item.label} {item.title}</span>
                <span className="labeler-runner-status">
                  <span className={["labeler-runner-dot", itemStatusClass(item.status)].filter(Boolean).join(" ")} />
                  {itemStatusLabel(item.status)}
                </span>
              </button>
            ))}
            {totalItems > itemNav.length ? <p className="labeler-runner-more">还有 {totalItems - itemNav.length} 题</p> : null}
            {totalItems === 1 ? <p className="labeler-runner-more">当前任务仅包含 1 条可标注数据</p> : null}
          </div>
        </aside>

        <main className="labeler-runner-main">
          <section className="labeler-runner-main-head">
            <div title={`题目 ${context.item.id}`}>
              <h1>{context.task.title} · 第 {currentItemNumber} 题</h1>
              <p>模板 r{context.schema.schemaVersionNo ?? "-"} · 第 {currentItemNumber} / {totalItems} 题</p>
            </div>
            <div className="labeler-runner-head-actions">
              <Button disabled title="跳过功能暂未接入，可使用下方「下一题」切换题目">跳过</Button>
              <Button disabled title="题目反馈功能暂未接入">报告题目</Button>
            </div>
          </section>

          <div className="labeler-runner-scroll">
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
                  readonly={false}
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
              <Button
                disabled={!previousItem}
                title={!previousItem ? "已经是第一题" : undefined}
                onClick={() => previousItem && switchToItem(previousItem)}
              >
                ← 上一题
              </Button>
              <Button
                disabled={!nextItem}
                title={!nextItem ? (totalItems === 1 ? "当前任务仅包含 1 条可标注数据" : "已经是最后一题") : undefined}
                onClick={() => nextItem && switchToItem(nextItem)}
              >
                下一题 →
              </Button>
            </div>
            <div className="labeler-runner-submit-group">
              <span>⌘+Enter 提交 · ⌘+S 保存草稿</span>
              {missingRequiredFields.length > 0 ? (
                <span className="labeler-runner-required-warning">
                  请补充必填字段：{missingRequiredFields.map((f) => f.title).join("、")}
                </span>
              ) : null}
              <Button onClick={handleSaveDraft} disabled={saving || submitting}>
                {saving ? "保存中..." : "保存草稿"}
              </Button>
              <Button
                tone="primary"
                disabled={missingRequiredFields.length > 0 || submitting}
                title={missingRequiredFields.length > 0 ? "请先补全必填字段再提交" : undefined}
                onClick={() => requestSubmit()}
              >
                {submitting ? "提交中..." : "提交本题 →"}
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
