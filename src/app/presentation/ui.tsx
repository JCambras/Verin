/**
 * Canonical product-surface primitives (ADR-0012). Visual recipes live here so
 * feature code composes layout and content without restating control, card, or
 * status styling. Status is always text plus colour, never colour alone.
 */
import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

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
  const element = isValidElement(children) ? children as ReactElement<Record<string, unknown>> : null;
  const existingDescription = typeof element?.props["aria-describedby"] === "string"
    ? element.props["aria-describedby"]
    : null;
  const describedBy = [existingDescription, hint ? hintId : null, error ? errId : null]
    .filter(Boolean)
    .join(" ") || undefined;
  const control = element
    ? cloneElement(element, {
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : element.props["aria-invalid"],
      })
    : children;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {hint ? <span id={hintId} className="text-xs text-slate-600">{hint}</span> : null}
      {control}
      {error ? <span id={errId} role="alert" className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-500 focus-visible:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} {...props} className={classes(inputClass, className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { children, className, ...props },
  ref,
) {
  return <select ref={ref} {...props} className={classes(inputClass, className)}>{children}</select>;
});

const choiceClass =
  "h-4 w-4 shrink-0 border-slate-300 accent-slate-900 disabled:cursor-not-allowed disabled:opacity-50";

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox(
  { className, label, ...props },
  ref,
) {
  return (
    <label className="inline-flex items-start gap-2 text-sm text-slate-700">
      <input ref={ref} {...props} type="checkbox" className={classes(choiceClass, "mt-0.5 rounded", className)} />
      <span>{label}</span>
    </label>
  );
});

export const Radio = forwardRef<HTMLInputElement, ChoiceProps>(function Radio(
  { className, label, ...props },
  ref,
) {
  return (
    <label className="inline-flex items-start gap-2 text-sm text-slate-700">
      <input ref={ref} {...props} type="radio" className={classes(choiceClass, "mt-0.5 rounded-full", className)} />
      <span>{label}</span>
    </label>
  );
});

export type ButtonVariant = "primary" | "secondary" | "danger" | "text" | "ghost";
export type ButtonSize = "default" | "compact" | "text" | "table";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50",
  danger: "bg-destructive text-white hover:opacity-90 disabled:opacity-50",
  text: "text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50",
  ghost: "text-slate-600 hover:text-slate-900 disabled:opacity-50",
};

/**
 * Exactly one size may contribute a `justify-*` token and the base recipe contributes
 * none: class strings are joined, not conflict-resolved, so a base justification would
 * silently outrank the per-call alignment a caller passes (a right-aligned register
 * column, say) wherever Tailwind happens to order the two utilities.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: "justify-center px-4 py-2 text-sm font-medium",
  compact: "justify-center px-3 py-1.5 text-sm font-medium",
  text: "p-0 text-sm font-normal",
  table: "p-0 text-xs font-medium uppercase tracking-wide",
};

export function buttonClassName({
  variant = "primary",
  size = variant === "text" ? "text" : "default",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return classes(
    "inline-flex items-center gap-2 rounded-md transition-colors disabled:cursor-not-allowed",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ variant = "primary", size, className, children, ...props }, ref) {
  return (
    <button ref={ref} type="button" {...props} className={buttonClassName({ variant, ...(size ? { size } : {}), className })}>
      {children}
    </button>
  );
});

export type BadgeTone = "neutral" | "warning" | "provenance";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  warning: "bg-amber-100 text-amber-900",
  provenance: "border border-dashed border-slate-400 text-slate-600",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={classes(
        "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type PillTone = "neutral" | "success" | "attention" | "progress" | "failure" | "authority";

const PILL_TONES: Record<PillTone, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  success: "bg-green-50 text-green-800 border-green-200",
  attention: "bg-amber-50 text-amber-900 border-amber-200",
  progress: "bg-blue-50 text-blue-800 border-blue-200",
  failure: "bg-red-50 text-red-800 border-red-200",
  authority: "bg-slate-900 text-white border-slate-900",
};

export function Pill({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  return (
    <span
      {...props}
      className={classes(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_STYLES: Record<string, PillTone> = {
  done: "success",
  completed: "success",
  suspended: "attention",
  "awaiting-signature": "attention",
  pending: "neutral",
  running: "progress",
  failed: "failure",
  proceed: "success",
  blocked: "attention",
  prohibited: "authority",
  submitted: "progress",
  "in-flight": "progress",
  settled: "success",
  rejected: "failure",
  nigo: "failure",
  unknown: "attention",
  stuck: "attention",
  "duplicate-suppressed": "neutral",
  expired: "attention",
  voided: "attention",
  conflict: "attention",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Pill tone={STATUS_STYLES[status] ?? "neutral"}>{label ?? status}</Pill>;
}

export type CardVariant = "surface" | "white" | "attention" | "dashed";
export type CardPadding = "none" | "compact" | "default" | "roomy";

const CARD_VARIANTS: Record<CardVariant, string> = {
  surface: "border-slate-200 bg-surface",
  white: "border-slate-200 bg-white",
  attention: "border-amber-200 bg-amber-50",
  dashed: "border-dashed border-slate-300 bg-surface",
};

const CARD_PADDING: Record<CardPadding, string> = {
  none: "",
  compact: "px-4 py-3",
  default: "p-4",
  roomy: "px-6 py-10",
};

export function cardClassName({
  variant = "surface",
  padding = "default",
  interactive = false,
  className,
}: {
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
  className?: string;
} = {}): string {
  return classes(
    "rounded-lg border",
    CARD_VARIANTS[variant],
    CARD_PADDING[padding],
    interactive && "transition-colors hover:border-slate-400 focus-visible:border-slate-500",
    className,
  );
}

type CardTag = "div" | "section" | "article" | "aside" | "header" | "li" | "ul";

export function Card({
  as = "div",
  variant = "surface",
  padding = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: CardTag; variant?: CardVariant; padding?: CardPadding }) {
  const Tag = as as ElementType;
  return <Tag {...props} className={cardClassName({ variant, padding, className })}>{children}</Tag>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <Card variant="dashed" padding="roomy" className="flex flex-col items-center gap-2 text-center animate-fade-in">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="max-w-sm text-sm text-slate-600">{description}</p>
      <div className="mt-1">{action}</div>
    </Card>
  );
}
