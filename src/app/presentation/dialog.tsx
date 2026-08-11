"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Button, Card } from "./ui";

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  initialFocusRef,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [initialFocusRef, open]);

  function restoreFocus() {
    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={restoreFocus}
      className="m-auto w-[min(32rem,calc(100%-3rem))] max-w-full bg-transparent p-0 backdrop:bg-slate-900/40"
    >
      <Card variant="white" className="flex max-h-[calc(100dvh-3rem)] flex-col gap-4 overflow-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm text-slate-600">{description}</p> : null}
          </div>
          <Button type="button" variant="text" onClick={onClose}>Close</Button>
        </div>
        {children}
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">{footer}</div> : null}
      </Card>
    </dialog>
  );
}
