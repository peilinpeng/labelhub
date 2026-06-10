import { useEffect, useMemo, useState } from "react";
import type {
  CompatibilityReport,
  ManualMappingSlot,
  SchemaChange,
  SchemaValidationResult,
} from "@labelhub/contracts";
import type { DeprecationIssue } from "@labelhub/schema-core";
import { Badge, Button } from "../../ui/primitives";

export interface PublishPreviewDialogProps {
  open: boolean;
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
  onCancel(): void;
  onConfirm(): void;
}

export function PublishPreviewDialog({
  open,
  isFirstPublish,
  publishAllowed,
  requiresApproval,
  requiresMigration,
  affectedSubmissionsLabel,
  schemaValidation,
  compatibilityReport,
  deprecationErrors,
  deprecationWarnings,
  manualMappingSlots,
  oldSchemaStatusMessage,
  onCancel,
  onConfirm,
}: PublishPreviewDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const mustConfirm = requiresApproval || requiresMigration || deprecationWarnings.length > 0 || schemaValidation.warnings.length > 0;
  const canConfirm = publishAllowed && (!mustConfirm || confirmed);

  useEffect(() => {
    if (!open) {
      setConfirmed(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  const migrationChanges = useMemo(
    () => compatibilityReport?.changes.filter((change) => change.level === "MIGRATION_REQUIRED") ?? [],
    [compatibilityReport],
  );

  // 把预检结论归纳成一句人话，作为对话框顶部的醒目结论。
  const verdict = useMemo<{ tone: "success" | "warning" | "danger"; text: string }>(() => {
    if (!publishAllowed) return { tone: "danger", text: "存在破坏性变更，已阻断发布。请先调整模板再发布。" };
    if (requiresMigration) return { tone: "warning", text: "存在需要迁移的变更：可发布，但历史答卷需要后续迁移（当前仅预览，不执行迁移）。" };
    if (requiresApproval) return { tone: "warning", text: "存在需要确认的变更：勾选确认后即可发布。" };
    return { tone: "success", text: "向后兼容，可直接发布。" };
  }, [publishAllowed, requiresApproval, requiresMigration]);

  if (!open) {
    return null;
  }

  return (
    <div className="publish-preview-layer" role="presentation">
      <button className="publish-preview-overlay" type="button" aria-label="关闭发布前检查" onClick={onCancel} />
      <section className="publish-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-preview-title">
        <header className="publish-preview-dialog__header">
          <div>
            <span>发布前检查</span>
            <h2 id="publish-preview-title">Schema 版本治理预检</h2>
            <p>{isFirstPublish ? "首次发布，无历史版本对比。" : "已对当前草稿和上一已发布版本进行本地对比。"}</p>
          </div>
          <Badge tone={publishAllowed ? "success" : "danger"}>
            {publishAllowed ? "允许发布" : "阻止发布"}
          </Badge>
        </header>

        {oldSchemaStatusMessage ? <p className="publish-preview-dialog__notice">{oldSchemaStatusMessage}</p> : null}

        <p className={`publish-preview-dialog__verdict publish-preview-dialog__verdict--${verdict.tone}`}>{verdict.text}</p>

        <div className="publish-preview-summary-grid">
          <SummaryItem label="Schema 校验" value={schemaValidation.valid ? "通过" : `${schemaValidation.errors.length} 个错误`} tone={schemaValidation.valid ? "success" : "danger"} />
          <SummaryItem label="阻断性变更" value={String(compatibilityReport?.blockingChanges.length ?? 0)} tone={(compatibilityReport?.blockingChanges.length ?? 0) > 0 ? "danger" : "success"} />
          <SummaryItem label="需要确认" value={requiresApproval ? "是" : "否"} tone={requiresApproval ? "warning" : "success"} />
          <SummaryItem label="需要迁移" value={requiresMigration ? "是" : "否"} tone={requiresMigration ? "warning" : "success"} />
        </div>

        <p className="publish-preview-dialog__affected">受影响答卷数量：{affectedSubmissionsLabel}</p>

        {!publishAllowed ? (
          <section className="publish-preview-section publish-preview-section--danger">
            <h3>检测到阻断性变更，当前不能发布</h3>
            <ChangeList changes={compatibilityReport?.blockingChanges ?? []} emptyText="没有 compatibility blocking change。" />
            <IssueList issues={deprecationErrors} emptyText="没有 deprecation error。" />
            {schemaValidation.errors.length > 0 ? (
              <ul className="publish-preview-list">
                {schemaValidation.errors.map((error, index) => (
                  <li key={`${error.code}-${error.path}-${index}`}>
                    <strong>{error.code}</strong>
                    <span>{error.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <section className="publish-preview-section">
          <h3>检测到需要确认的变更</h3>
          <ChangeList changes={compatibilityReport?.warnings ?? []} emptyText="暂无需要审批确认的 compatibility warning。" />
          <IssueList issues={deprecationWarnings} emptyText="暂无 deprecation warning。" />
        </section>

        <section className="publish-preview-section">
          <h3>检测到需要迁移的变更</h3>
          <ChangeList changes={migrationChanges} emptyText={isFirstPublish ? "首次发布无需迁移。" : "暂无需要迁移的变更。"} />
          {requiresMigration ? (
            <p className="publish-preview-dialog__notice">
              说明：此处仅做迁移影响预览。迁移执行链路（Dry Run 与历史答卷批量迁移）将在后续接入后端 migration pipeline，本次发布不会自动改动历史答卷。
            </p>
          ) : null}
        </section>

        <section className="publish-preview-section">
          <h3>需要人工映射的字段</h3>
          {manualMappingSlots.length > 0 ? (
            <>
              <p className="publish-preview-dialog__notice">
                当前仅展示需要人工映射的字段，正式迁移与 Dry Run 将在后续流程中执行。
              </p>
              <ul className="publish-preview-list">
                {manualMappingSlots.map((slot) => (
                  <li key={slot.slotId}>
                    <strong>{slot.kind}</strong>
                    <span>{slot.reason}</span>
                    {slot.fromFieldName ? <em>来源字段：{slot.fromFieldName}</em> : null}
                    {slot.fromValue ? <em>来源值：{slot.fromValue}</em> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="publish-preview-empty">暂无需要人工映射的字段。</p>
          )}
        </section>

        {mustConfirm ? (
          <label className="publish-preview-confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>我已理解这些变更的影响，并确认继续发布。</span>
          </label>
        ) : null}

        <footer className="publish-preview-dialog__actions">
          <Button type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" tone="primary" disabled={!canConfirm} onClick={onConfirm}>
            确认发布
          </Button>
        </footer>
      </section>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger";
}) {
  return (
    <div className={`publish-preview-summary publish-preview-summary--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChangeList({ changes, emptyText }: { changes: SchemaChange[]; emptyText: string }) {
  if (changes.length === 0) {
    return <p className="publish-preview-empty">{emptyText}</p>;
  }

  return (
    <ul className="publish-preview-list">
      {changes.map((change, index) => (
        <li key={`${change.code}-${change.fieldName ?? "schema"}-${index}`}>
          <strong>{change.code}</strong>
          <span>{change.message}</span>
          {change.fieldName ? <em>字段：{change.fieldName}</em> : null}
          {change.recommendation ? <em>{change.recommendation}</em> : null}
        </li>
      ))}
    </ul>
  );
}

function IssueList({ issues, emptyText }: { issues: DeprecationIssue[]; emptyText: string }) {
  if (issues.length === 0) {
    return <p className="publish-preview-empty">{emptyText}</p>;
  }

  return (
    <ul className="publish-preview-list">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${issue.fieldName ?? "schema"}-${index}`}>
          <strong>{issue.code}</strong>
          <span>{issue.message}</span>
          {issue.fieldName ? <em>字段：{issue.fieldName}</em> : null}
          {issue.recommendation ? <em>{issue.recommendation}</em> : null}
        </li>
      ))}
    </ul>
  );
}
