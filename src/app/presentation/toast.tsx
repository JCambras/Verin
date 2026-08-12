"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { Button, Card, StatusBadge } from "./ui";

export interface ToastMessage {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly tone?: "success" | "attention" | "failure";
}

export interface ToastInput extends Omit<ToastMessage, "id"> {
  readonly durationMs?: number;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STATUS = {
  success: { status: "done", label: "Done" },
  attention: { status: "suspended", label: "Attention" },
  failure: { status: "failed", label: "Failed" },
} as const;

export function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const status = TONE_STATUS[toast.tone ?? "success"];
  return (
    <Card variant="white" className="flex min-w-72 max-w-sm items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status.status} label={status.label} />
          <p className="text-sm font-medium text-slate-900">{toast.title}</p>
        </div>
        {toast.description ? <p className="mt-1 text-sm text-slate-600">{toast.description}</p> : null}
      </div>
      <Button
        type="button"
        variant="text"
        data-toast-dismiss=""
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss ${toast.title}`}
      >
        Dismiss
      </Button>
    </Card>
  );
}

export function ToastHost({
  toasts,
  onDismiss,
  onHold,
  onRelease,
}: {
  toasts: readonly ToastMessage[];
  onDismiss: (id: string) => void;
  onHold?: (id: string) => void;
  onRelease?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  /**
   * Where focus came from, so a dismissal that empties the host can hand it back -
   * `<body>` excluded, since handing focus back to it is the stranding this exists to
   * prevent rather than a place to return to.
   */
  function rememberOrigin(event: FocusEvent<HTMLDivElement>) {
    const previous = event.relatedTarget;
    if (!(previous instanceof HTMLElement) || previous === document.body) return;
    if (!hostRef.current?.contains(previous)) returnFocus.current = previous;
  }

  /**
   * A toast's own Dismiss control REMOVES the element holding focus, dropping a keyboard
   * user on <body> and losing their place in the tab order - the same stranding the
   * restore control and the auto-dismiss hold already answer, by the one path a hold
   * cannot cover (the reader asked for this toast to go). Focus is placed BEFORE the
   * removal and ONLY when the toast being removed is the one holding it, so an
   * auto-dismiss, or a pointer dismissal with focus elsewhere, never takes it. It goes to
   * the next remaining toast's dismiss control, else the previous one's, else back to
   * whatever held focus before it entered the host, else the host itself - never <body>.
   */
  function dismiss(id: string) {
    const host = hostRef.current;
    const entries = host ? Array.from(host.children).filter((node): node is HTMLElement => node instanceof HTMLElement) : [];
    const index = toasts.findIndex((toast) => toast.id === id);
    const leaving = index >= 0 ? entries[index] : undefined;
    const focused = document.activeElement;
    if (host && leaving && focused instanceof HTMLElement && leaving.contains(focused)) {
      const sibling = entries[index + 1] ?? entries[index - 1];
      const control = sibling?.querySelector<HTMLElement>("[data-toast-dismiss]") ?? null;
      const origin = returnFocus.current;
      (control ?? (origin?.isConnected ? origin : null) ?? host).focus();
    }
    onDismiss(id);
  }

  return (
    <div
      ref={hostRef}
      tabIndex={-1}
      onFocusCapture={rememberOrigin}
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className="pointer-events-auto"
          onMouseEnter={() => onHold?.(toast.id)}
          onMouseLeave={() => onRelease?.(toast.id)}
          onFocusCapture={() => onHold?.(toast.id)}
          onBlurCapture={() => onRelease?.(toast.id)}
        >
          <Toast toast={toast} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}

/**
 * A held toast keeps its remaining time and never unmounts while the pointer rests on it
 * or it holds focus: auto-dismissing a toast the keyboard is currently inside drops focus
 * to <body> and loses the user's place in the tab order (WCAG 2.2.1).
 */
interface ToastTimer {
  readonly handle: number | null;
  readonly remainingMs: number;
  readonly resumedAt: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<string, ToastTimer>());
  const holds = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer && timer.handle !== null) window.clearTimeout(timer.handle);
    timers.current.delete(id);
    holds.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const scheduleDismiss = useCallback((id: string, remainingMs: number) => {
    timers.current.set(id, {
      handle: window.setTimeout(() => dismissToast(id), remainingMs),
      remainingMs,
      resumedAt: Date.now(),
    });
  }, [dismissToast]);

  const holdToast = useCallback((id: string) => {
    holds.current.set(id, (holds.current.get(id) ?? 0) + 1);
    const timer = timers.current.get(id);
    if (!timer || timer.handle === null) return;
    window.clearTimeout(timer.handle);
    timers.current.set(id, {
      handle: null,
      remainingMs: Math.max(0, timer.remainingMs - (Date.now() - timer.resumedAt)),
      resumedAt: timer.resumedAt,
    });
  }, []);

  const releaseToast = useCallback((id: string) => {
    const remainingHolds = (holds.current.get(id) ?? 0) - 1;
    if (remainingHolds > 0) {
      holds.current.set(id, remainingHolds);
      return;
    }
    holds.current.delete(id);
    const timer = timers.current.get(id);
    if (!timer || timer.handle !== null) return;
    scheduleDismiss(id, timer.remainingMs);
  }, [scheduleDismiss]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) {
      if (timer.handle !== null) window.clearTimeout(timer.handle);
    }
    timers.current.clear();
    holds.current.clear();
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    const { durationMs = 5000, ...message } = input;
    setToasts((current) => [...current, { ...message, id }]);
    if (durationMs > 0) scheduleDismiss(id, durationMs);
    return id;
  }, [scheduleDismiss]);

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismissToast} onHold={holdToast} onRelease={releaseToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}
