"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
      <Button type="button" variant="text" onClick={() => onDismiss(toast.id)} aria-label={`Dismiss ${toast.title}`}>
        Dismiss
      </Button>
    </Card>
  );
}

export function ToastHost({ toasts, onDismiss }: { toasts: readonly ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  const showToast = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    const { durationMs = 5000, ...message } = input;
    setToasts((current) => [...current, { ...message, id }]);
    if (durationMs > 0) timers.current.set(id, window.setTimeout(() => dismissToast(id), durationMs));
    return id;
  }, [dismissToast]);

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}
