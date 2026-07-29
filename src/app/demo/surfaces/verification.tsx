/**
 * Surface 9 - Verification state (demo contract §4.9; design §3 row 9, §8.4). Two
 * plain lists - what this status proves and what it does not prove yet - with the
 * next expectation as a quiet label. Delayed NIGO and stuck transitions APPEND rows
 * to the same register: a status never edits history, it adds to it.
 */
import { FreshValue } from "@app/presentation/fresh-value";
import { ExecutionTimeline } from "@app/presentation/execution-timeline";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type VerificationVM } from "../model";
import { JourneyNav, NotReached, SurfaceShell, demoHref, toTimelineRow } from "./shared";

export function VerificationSurface({
  vm,
  scenarioId,
  firmId,
  stopNote,
  querySuffix,
}: {
  vm: VerificationVM | null;
  scenarioId: string;
  firmId: string;
  stopNote: string | null;
  querySuffix?: string;
}) {
  if (!vm) {
    return (
      <SurfaceShell title="Verification" description="What the returned status proves for an in-flight decision.">
        <NotReached title="Verification not reached" stopNote={stopNote} backHref={demoHref("decision", scenarioId, firmId)} />
      </SurfaceShell>
    );
  }
  return (
    <SurfaceShell
      spine={vm.spine}
      title="Verification"
      description="What the returned status actually proves, and what remains open. Green is earned, never assumed."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-label="What this status proves" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4">
          <h2 className="text-base font-semibold text-slate-900">What this status proves</h2>
          <ul className="flex flex-col gap-2">
            {vm.proves.map((p) => (
              <li key={p.display} className="flex flex-col gap-0.5 text-sm text-slate-800">
                <FreshValue provenance={p.provenance}>{p.display}</FreshValue>
                <span className="text-xs text-slate-500">retrieved {p.retrievedAt}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 text-xs text-slate-600">
            <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
          </p>
        </section>
        <section aria-label="What it does not prove yet" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4">
          <h2 className="text-base font-semibold text-slate-900">What it does not prove yet</h2>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-slate-700">
            {vm.notProvenYet.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="text-xs text-slate-600">{vm.polling.display}</p>
        </section>
      </div>

      {vm.appended.length > 0 ? (
        <section aria-label="Later arrivals" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-900">Later arrivals</h2>
          <ExecutionTimeline caption="Later status arrivals, appended to the same register" rows={vm.appended.map((r) => toTimelineRow(r))} />
        </section>
      ) : null}

      {vm.exceptionDecision ? (
        <section
          aria-label="Exception decision"
          className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4"
          data-testid="exception-decision-requested"
        >
          <h2 className="text-base font-semibold text-slate-900">Exception decision requested</h2>
          <p className="text-sm text-slate-700">{vm.exceptionDecision.summary}</p>
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-600">Ledger event</dt>
              <dd className="font-mono text-xs text-slate-800">{vm.exceptionDecision.eventType}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Reason</dt>
              <dd className="font-mono text-xs text-slate-800">{vm.exceptionDecision.reason}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Triggering event</dt>
              <dd className="font-mono text-xs text-slate-800">{vm.exceptionDecision.triggeringLedgerEvent}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Requested</dt>
              <dd className="text-slate-800">
                <time dateTime={vm.exceptionDecision.requestedAtIso}>{vm.exceptionDecision.requestedAt}</time>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <JourneyNav
        back={{ href: demoHref("execution", scenarioId, firmId, querySuffix), label: "Back to execution" }}
        forward={{ href: demoHref("comparison", scenarioId, firmId, querySuffix), label: "Compare Firm A and Firm B" }}
      />
    </SurfaceShell>
  );
}
