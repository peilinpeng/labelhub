import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type Tone = "default" | "primary" | "success" | "warning" | "danger";

interface CardProps {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}

export function Card({ children, className = "", interactive = false }: CardProps) {
  const classes = ["lh-card", interactive ? "lh-card--interactive" : "", className]
    .filter(Boolean)
    .join(" ");
  return <section className={classes}>{children}</section>;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Exclude<Tone, "warning"> | "ghost";
}

export function Button({ children, className = "", tone = "default", ...props }: ButtonProps) {
  const toneClass = tone === "default" ? "" : `lh-button--${tone}`;
  const classes = ["lh-button", toneClass, className].filter(Boolean).join(" ");
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={["lh-input", className].filter(Boolean).join(" ")} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={["lh-select", className].filter(Boolean).join(" ")} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={["lh-textarea", className].filter(Boolean).join(" ")} {...props} />;
}

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

export function Badge({ children, tone = "default", className = "" }: BadgeProps) {
  const toneClass = tone === "default" ? "" : `lh-badge--${tone}`;
  return <span className={["lh-badge", toneClass, className].filter(Boolean).join(" ")}>{children}</span>;
}

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
}

export function KpiCard({ label, value, hint }: KpiCardProps) {
  return (
    <Card className="lh-kpi-card">
      <span className="lh-kpi-card__label">{label}</span>
      <strong className="lh-kpi-card__value">{value}</strong>
      {hint ? <span className="lh-kpi-card__hint">{hint}</span> : null}
    </Card>
  );
}

interface AIReviewPanelProps {
  title: string;
  children: ReactNode;
  badge?: ReactNode;
  className?: string;
}

export function AIReviewPanel({ title, children, badge, className = "" }: AIReviewPanelProps) {
  return (
    <section className={["lh-ai-panel", className].filter(Boolean).join(" ")}>
      <div className="lh-ai-panel__header">
        <h3 className="lh-ai-panel__title">{title}</h3>
        {badge}
      </div>
      <div className="lh-ai-panel__body">{children}</div>
    </section>
  );
}
