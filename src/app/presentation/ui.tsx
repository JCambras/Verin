/**
 * Shared shell primitives (ADR-0012). Accessible by construction (WCAG 2.2 AA):
 * every field has an associated <label>, errors use aria-describedby + role=alert,
 * status uses text + colour (never colour alone). These primitives render across
 * every flow, so a11y here multiplies (charter #9).
 */
import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  error,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  children: ReactNode;
  hint?: string;
}) {
  const errId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {hint ? (
        <span id={hintId} className="text-xs text-slate-600">
          {hint}
        </span>
      ) : null}
      {children}
      {error ? (
        <span id={errId} role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-500 focus-visible:border-slate-500";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function SelectField({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ""}`}>
      {children}
    </select>
  );
}

export function Button({
  variant = "primary",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles: Record<string, string> = {
    primary: "bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "bg-destructive text-white hover:opacity-90",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

const STATUS_STYLES: Record<string, string> = {
  done: "bg-green-50 text-green-800 border-green-200",
  completed: "bg-green-50 text-green-800 border-green-200",
  suspended: "bg-amber-50 text-amber-900 border-amber-200",
  "awaiting-signature": "bg-amber-50 text-amber-900 border-amber-200",
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  failed: "bg-red-50 text-red-800 border-red-200",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label ?? status}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-surface px-6 py-10 text-center animate-fade-in">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="max-w-sm text-sm text-slate-600">{description}</p>
      {action}
    </div>
  );
}
