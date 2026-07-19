"use client";

import { useState } from "react";
import { Field, TextInput, SelectField, Button, StatusBadge } from "@app/presentation/ui";
import { WhyBubble } from "@app/presentation/why-bubble";
import { StepInfoCard } from "@app/presentation/step-info-card";
import { ProgressSteps, type ProgressStep } from "@app/presentation/progress-steps";
import { useHydrated } from "@app/presentation/use-hydrated";
import { accountOpeningView } from "@domain/workflow/flows/account-opening";

type Phase = "form" | "awaiting" | "completed";

export default function AccountOpeningPage() {
  const hydrated = useHydrated();
  const [phase, setPhase] = useState<Phase>("form");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function steps(): ProgressStep[] {
    return [
      { id: "kyc", name: "Client & account details", state: phase === "form" ? "active" : "done" },
      { id: "esign", name: "Client e-signature", state: phase === "form" ? "pending" : phase === "awaiting" ? "active" : "done" },
      { id: "finalize", name: "Open account & finalize", state: phase === "completed" ? "done" : "pending" },
    ];
  }

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Read from the form (uncontrolled) so values are correct even if a submit
    // races hydration — no controlled-state timing dependency.
    const fd = new FormData(e.currentTarget);
    const payload = {
      householdName: String(fd.get("householdName") ?? ""),
      firstName: String(fd.get("firstName") ?? ""),
      lastName: String(fd.get("lastName") ?? ""),
      email: String(fd.get("email") ?? ""),
      accountType: String(fd.get("accountType") ?? ""),
    };
    const res = await fetch("/api/flows/account-opening", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body?.error?.message ?? "Could not start the flow.");
    setToken(body.token);
    setPhase("awaiting");
  }

  async function sign() {
    if (!token) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/esign/simulate-sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body?.error?.message ?? "Signing failed.");
    setPhase("completed");
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Open an account</h1>
      <div className="grid gap-6 sm:grid-cols-[1fr_240px]">
        <div className="flex flex-col gap-5">
          {phase === "form" ? (
            <>
              <StepInfoCard
                stepNumber={1}
                totalSteps={3}
                title="Client & account details"
                body={`Verin captures the household, primary contact, and account type. Required before an account can be opened (${accountOpeningView.regulation}).`}
              />
              {/* View-driven form: fields come from the flow's declarative view. */}
              <form onSubmit={start} className="flex flex-col gap-4" aria-label="Account opening">
                {accountOpeningView.fields.map((f) => (
                  <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.hint}>
                    {f.type === "select" ? (
                      <SelectField id={f.name} name={f.name} defaultValue="ira-roth">
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </SelectField>
                    ) : (
                      <TextInput id={f.name} name={f.name} type={f.type === "email" ? "email" : "text"} required={f.required} />
                    )}
                  </Field>
                ))}
                <Button type="submit" disabled={busy || !hydrated}>
                  {busy ? "Sending…" : "Send for e-signature"}
                </Button>
              </form>
            </>
          ) : null}

          {phase === "awaiting" ? (
            <div className="flex flex-col gap-4" data-testid="ao-awaiting">
              <div className="flex items-center gap-3">
                <StatusBadge status="awaiting-signature" label="Awaiting client e-signature" />
              </div>
              <p className="text-sm text-slate-700">
                The application was sent for signature and the flow is <strong>suspended</strong> until the client
                signs. Nothing is finalized until the signature webhook returns.
              </p>
              <WhyBubble
                reason="Verin suspends the flow at e-signature and finalizes only when the signed document webhook returns, so an account is never opened before the client has agreed."
                regulation="SEC Reg BI (Care Obligation)"
              />
              <div>
                <Button onClick={sign} disabled={busy} data-testid="ao-sign">
                  {busy ? "Signing…" : "Simulate client signing"}
                </Button>
              </div>
            </div>
          ) : null}

          {phase === "completed" ? (
            <div className="flex flex-col gap-3" data-testid="ao-completed">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white animate-check-pop">
                  ✓
                </span>
                <StatusBadge status="completed" label="Account opened" />
              </div>
              <p className="text-sm text-slate-700">
                The e-signature was received, the account was opened, and a funding task was created — all through
                one audited, exactly-once write.
              </p>
              <WhyBubble
                reason="On finalize, Verin created the financial account and a funding task with an idempotency key, so a doubly-fired signature webhook has exactly-once effect."
                regulation="SEC 17a-4 (records integrity)"
              />
              <a href="/app/audit" className="text-sm text-slate-800 underline hover:text-slate-900">
                Inspect the audit trail →
              </a>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <aside className="rounded-lg border border-slate-200 bg-surface p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-600">Progress</p>
          <ProgressSteps steps={steps()} />
        </aside>
      </div>
    </div>
  );
}
