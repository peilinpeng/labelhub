import { useEffect, useState } from "react";
import { Button } from "./primitives";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  tone?: "primary" | "danger";
  suppressLabel?: string;
  onConfirm: (suppressForSession: boolean) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  tone = "primary",
  suppressLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [suppressForSession, setSuppressForSession] = useState(false);

  useEffect(() => {
    if (!open) {
      setSuppressForSession(false);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog-layer" role="presentation">
      <button className="confirm-dialog-overlay" type="button" aria-label="关闭确认弹窗" onClick={onCancel} />
      <section
        className={`confirm-dialog confirm-dialog--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="confirm-dialog__header">
          <span className="confirm-dialog__mark" aria-hidden="true" />
          <div>
            <h2 id="confirm-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
        </div>

        {suppressLabel ? (
          <label className="confirm-dialog__checkbox">
            <input
              type="checkbox"
              checked={suppressForSession}
              onChange={(event) => setSuppressForSession(event.target.checked)}
            />
            <span>{suppressLabel}</span>
          </label>
        ) : null}

        <div className="confirm-dialog__actions">
          <Button type="button" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button type="button" tone={tone === "danger" ? "danger" : "primary"} onClick={() => onConfirm(suppressForSession)}>
            {confirmText}
          </Button>
        </div>
      </section>
    </div>
  );
}
