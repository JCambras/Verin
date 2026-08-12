"use client";

import { useState } from "react";
import { Button, Card, Field, Input, Select, StatusBadge } from "@app/presentation/ui";
import { WhyBubble } from "@app/presentation/why-bubble";
import { StepInfoCard } from "@app/presentation/step-info-card";
import { ProgressSteps, type ProgressStep } from "@app/presentation/progress-steps";
import { useHydrated } from "@app/presentation/use-hydrated";
import { CLIENT_REQUEST_ID_KEY, type IntakeForm } from "@domain/config/intake-view";

type Phase = "form" | "awaiting" | "completed";

/**
 * The client half of the shipped account-opening journey. Every field it
 * renders, every key it SUBMITS, and every station its progress rail lights
 * arrives as data from `config/domains/account-opening.yaml` through the server
 * component next door - there is no hard-coded field list, station list or
 * station ID left, so removing the configuration removes the form and the screen
 * cannot drift from the document. The rendered control names and the submitted
 * keys are the same list walked twice, so a renamed or added `triggerField`
 * flows through without a code change instead of posting a blank for a field the
 * user filled; the live station for each phase is likewise the document's own
 * `presentation.form.surface` / `awaitingSurface`, so renaming or reordering a
 * station moves the rail rather than emptying it.
 */
export function IntakeJourney({ view }: { view: IntakeForm }) {
  const hydrated = useHydrated();
  const [phase, setPhase] = useState<Phase>("form");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One UUID per form session (D-027): the server uses it as the executionId, so
  // a double-submit (network retry, second tab re-posting the same session)
  // replays the same execution instead of creating duplicate households. A
  // CLIENT-FAULT refusal burns the id (re-minted in start()), so a user who
  // corrects the form and resubmits gets a genuinely fresh execution - the
  // server refuses to replay a used id with different input.
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());

  // Where a phase's station sits in the declared order, or -1 when the document
  // declares no station for it. `completed` stands past the last one.
  function stationIndex(of: Phase): number {
    if (of === "completed") return view.surfaces.length;
    const liveId = view.stations[of];
    return liveId === null ? -1 : view.surfaces.findIndex((surface) => surface.id === liveId);
  }

  // The stations are the configuration's `presentation.surfaces`, in declared
  // order, and each phase's live station is the one that document names for it,
  // so a renamed or reordered station moves the rail without a code change. A
  // phase the document names no station for lights NONE of them, rather than
  // lighting whichever one now sits at some position.
  function steps(): ProgressStep[] {
    const live = stationIndex(phase);
    return view.surfaces.map((surface, index) => ({
      id: surface.id,
      name: surface.label,
      state: index < live ? "done" : index === live ? "active" : "pending",
    }));
  }

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Read from the form (uncontrolled) so values are correct even if a submit
    // races hydration — no controlled-state timing dependency.
    // The submitted keys ARE the rendered controls: the same `view.fields` list
    // that named every control above is walked again here, so the two cannot
    // disagree. `CLIENT_REQUEST_ID_KEY` stays the one platform-supplied key -
    // the platform's own declaration, not a literal spelled again here - and is
    // written last so a configured field can never displace it.
    const fd = new FormData(e.currentTarget);
    const payload = {
      ...Object.fromEntries(view.fields.map((f) => [f.field, String(fd.get(f.field) ?? "")])),
      [CLIENT_REQUEST_ID_KEY]: clientRequestId,
    };
    try {
      const res = await fetch("/api/flows/account-opening", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // BURN THE SESSION'S IDENTITY ONLY ON A REFUSAL THE USER CAN FIX BY
        // EDITING AND RESUBMITTING (D-224). A fresh id is a fresh EXECUTION, and
        // the per-write idempotency keys are execution-scoped, so re-minting it
        // after a permanent server-side refusal turns one intended account
        // opening into duplicate household, contact and application rows on the
        // next submit. VALIDATION is the one code this endpoint answers that the
        // submitter owns - a configuration defect it cannot carry is reported as
        // an INTERNAL precisely so it is not mistaken for one - and an
        // unreadable body keeps the id, because the conservative answer is to
        // stay attached to the execution that may already exist.
        if (body?.error?.code === "VALIDATION") setClientRequestId(crypto.randomUUID());
        return setError(body?.error?.message ?? "Could not start the flow.");
      }
      // Render what the server reports: a replayed submit can reattach to an
      // execution that already completed, or one still mid-flight (multi-tab
      // race) with nothing to sign yet — never a dead "awaiting" screen.
      if (body.status === "completed") return setPhase("completed");
      if (body.status !== "suspended" || !body.token) {
        return setError("This request is still being processed. Wait a moment, then submit again to check its status.");
      }
      setToken(body.token);
      setPhase("awaiting");
    } catch {
      setError("Could not start the flow. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/esign/simulate-sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body?.error?.message ?? "Signing failed.");
      setPhase("completed");
    } catch {
      setError("Signing failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // The teaching card names the SAME station the rail lights for this phase,
  // resolved by id through the same lookup. Binding it to ordinal 0 instead would
  // let a reordered document title the intake screen "Client e-signature" while
  // the rail correctly showed `intake` active. An undeclared station has no
  // truthful step number, so the card stands down rather than inventing one.
  const formStation = stationIndex("form");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{view.title}</h1>
      <div className="grid gap-6 sm:grid-cols-[1fr_240px]">
        <div className="flex flex-col gap-5">
          {phase === "form" ? (
            <>
              {formStation >= 0 ? (
                <StepInfoCard
                  stepNumber={formStation + 1}
                  totalSteps={view.surfaces.length}
                  title={view.surfaces[formStation]!.label}
                  body={`Verin captures the household, primary contact, and account type. Required before an account can be opened (${view.regulation}).`}
                />
              ) : null}
              {/* View-driven form: fields come from the flow's declarative view. */}
              <form onSubmit={start} className="flex flex-col gap-4" aria-label="Account opening">
                {view.fields.map((f) => (
                  <Field key={f.field} label={f.label} htmlFor={f.field} hint={f.hint}>
                    {f.type === "select" ? (
                      <Select id={f.field} name={f.field} defaultValue={f.defaultValue ?? f.options?.[0]}>
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input id={f.field} name={f.field} type={f.type === "email" ? "email" : "text"} required={f.required} />
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
            <div className="flex flex-col gap-4" data-testid="ao-awaiting" role="status">
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
            <div className="flex flex-col gap-3" data-testid="ao-completed" role="status">
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

        <Card as="aside">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-600">Progress</p>
          <ProgressSteps steps={steps()} />
        </Card>
      </div>
    </div>
  );
}
