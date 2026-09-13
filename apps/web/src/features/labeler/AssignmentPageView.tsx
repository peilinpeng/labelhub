import { Link } from "react-router";
import { SchemaRenderer } from "@labelhub/schema-renderer";
import type { AssignmentStatus, DatasetItem } from "@labelhub/contracts";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CONFIRM_KEYS, suppressConfirmForSession } from "../../ui/confirm";
import { Badge, Button, Card } from "../../ui/primitives";
import { MarkdownPreview, docToMarkdown } from "../../ui/markdown";
import { formatBeijingClock } from "../../utils/formatTime";
import type { useAssignmentController } from "./useAssignmentController";

type AssignmentController = ReturnType<typeof useAssignmentController>;

function formatClock(iso: string): string {
  return formatBeijingClock(iso);
}

function getItemTitle(item: DatasetItem): string {
  const payload = item.sourcePayload as Record<string, unknown>;
  const rawTitle = typeof payload.title === "string"
    ? payload.title
    : typeof payload.name === "string"
      ? payload.name
      : item.externalKey ?? item.id;
  return rawTitle.length > 12 ? `${rawTitle.slice(0, 12)}...` : rawTitle;
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

export function AssignmentPageView({ controller }: { controller: AssignmentController }) {
  const {
    answers, claimingItemId, confirmSubmit, context, draftResyncNotice, errors, goToItem,
    handleAssistOutcome, handleLLMAssist, handleRendererAnswersChange, handleSaveDraft,
    handleSubmit, isEditableAssignment, lastSavedAt, loading, missingRequiredFields,
    pendingSubmitAnswers, rendererEngine, requestSubmit, returnNotice, saveErrorKind,
    saveFailed, saving, setPendingSubmitAnswers, setSubmitConfirmOpen, setToggleEngine,
    showRendererToggle, submitConfirmOpen, submitFailed, submitNotice, submitting,
    taskItems, telemetry, toggleEngine, runtimeContext,
  } = controller;
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
  // 右侧「标注须知」仅在任务配置了说明时才有内容；无内容时整列收起，
  // 让作答主面板向右展开，避免右侧预留 280px 空列造成的大片空白。
  const instructionMarkdown = docToMarkdown(context.task.instructionRichText);
  const hasInstruction = instructionMarkdown.trim() !== "";
  const readonlyNotice = isEditableAssignment ? null : readonlyAssignmentNotice(context.assignment.status);
  const draftBadgeText = !isEditableAssignment
    ? "当前领取记录只读"
    : saving
      ? "保存中..."
      : saveFailed
        ? saveErrorKind === "auto"
          ? "自动保存暂时失败，内容已保留，可稍后重试"
          : "保存失败，请稍后重试"
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
          <Badge tone={!isEditableAssignment ? "primary" : saving ? "warning" : saveFailed ? (saveErrorKind === "auto" ? "warning" : "danger") : lastSavedAt ? "success" : "default"}>
            {draftBadgeText}
          </Badge>
          <span className="labeler-runner-avatar">标</span>
          <span>标注员</span>
        </div>
      </header>

      <div className={hasInstruction ? "labeler-runner-layout" : "labeler-runner-layout labeler-runner-layout--no-side"}>
        <aside className="labeler-runner-nav">
          <div className="labeler-runner-panel-head">
            <div>
              <h3>任务数据</h3>
              <p>
                {taskItems.length > 0
                  ? `共 ${taskItems.length} 条 · 待标注 ${taskItems.filter((it) => it.status === "AVAILABLE").length} 条`
                  : "当前领取的数据"}
              </p>
            </div>
          </div>
          <div className="labeler-runner-items">
            {taskItems.length === 0 ? (
              <div className="labeler-runner-item labeler-runner-item--current labeler-runner-item--static">
                <span>#001 {itemTitle}</span>
                <span className="labeler-runner-status">
                  <span className="labeler-runner-dot labeler-runner-dot--primary" />
                  {assignmentStatusLabel(context.assignment.status)}
                </span>
              </div>
            ) : (
              taskItems.map((it, idx) => {
                const isCurrent = it.id === context.item.id;
                const available = it.status === "AVAILABLE";
                const clickable = available && !isCurrent && !claimingItemId;
                const cls = isCurrent
                  ? "labeler-runner-item labeler-runner-item--current"
                  : clickable
                    ? "labeler-runner-item"
                    : "labeler-runner-item labeler-runner-item--static";
                return (
                  <div
                    key={it.id}
                    className={cls}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => void goToItem(it.id) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void goToItem(it.id);
                            }
                          }
                        : undefined
                    }
                    title={getItemTitle(it)}
                  >
                    <span>{`#${String(idx + 1).padStart(3, "0")} ${getItemTitle(it)}`}</span>
                    <span className="labeler-runner-status">
                      <span
                        className={`labeler-runner-dot ${
                          isCurrent ? "labeler-runner-dot--primary" : available ? "labeler-runner-dot--warning" : "labeler-runner-dot--success"
                        }`}
                      />
                      {claimingItemId === it.id
                        ? "领取中…"
                        : isCurrent
                          ? assignmentStatusLabel(context.assignment.status)
                          : available
                            ? "待标注"
                            : "已处理"}
                    </span>
                  </div>
                );
              })
            )}
            <p className="labeler-runner-more">提交当前条后，点选上方「待标注」数据即可继续，无需回任务市场。</p>
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

            {draftResyncNotice ? (
              <div className="labeler-runner-success" role="status">
                {draftResyncNotice}
              </div>
            ) : null}

            {hasGenericSource ? (
              <section className="labeler-runner-source">
                <div className="labeler-runner-section-head labeler-runner-section-head--muted">
                  <h2>原始数据</h2>
                  <span>不可编辑 · {sourceMeta}</span>
                </div>
                {sourceTitle !== "" ? <p>{sourceTitle}</p> : null}
                {sourceBody !== "" ? <small>{sourceBody}</small> : null}
              </section>
            ) : null}

            <section className="labeler-runner-form">
              <div className="labeler-runner-section-head">
                <h2>标注填写</h2>
                <span>完成下列字段后提交审核</span>
              </div>
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

        {hasInstruction ? (
          <aside className="labeler-runner-side">
            <section className="labeler-runner-side-card">
              <h3>标注须知</h3>
              <MarkdownPreview source={instructionMarkdown} />
            </section>
          </aside>
        ) : null}
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
