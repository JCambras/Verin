/**
 * Surface 7 - Pre-execution safety check (demo contract §4.7; design §3 row 7) and
 * the approval-invalidation moment (§7.3). Revalidation timestamp as a FreshValue
 * label; reservation, conflict keys, and the idempotency key inspectable in mono.
 *
 * The invalidation moment lands without narration and without theatrics: the voided
 * approval STAYS (append-only UI) and recedes to 0.7 opacity; what changed appears at
 * full weight beneath it with role="status" and exactly one entry fade; one clear
 * next action. Under reduced motion it reads as a pure state change.
 */
import { FreshValue } from "@app/presentation/fresh-value";
import { StatusBadge } from "@app/presentation/ui";
import { WhyBubble } from "@app/presentation/why-bubble";
import { EvidenceMetricRow } from "@app/presentation/evidence-row";
import { TapToVerify } from "@app/presentation/tap-to-verify";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type SafetyVM } from "../model";
import { JourneyNav, NotReached, PrimaryLink, SurfaceShell, demoHref, type DemoRouteContext } from "./shared";

export function SafetySurface({
  vm,
  stopNote,
  journeyContinues,
  routeContext,
}: {
  vm: SafetyVM | null;
  stopNote: string | null;
  journeyContinues: boolean;
  routeContext: DemoRouteContext;
}) {
  if (!vm) {
    return (
      <SurfaceShell title="Safety before execution" description="Pre-execution revalidation for an in-flight decision.">
        <NotReached title="Safety check not reached" stopNote={stopNote} backHref={demoHref("decision", routeContext)} />
      </SurfaceShell>
    );
  }
  return (
    <SurfaceShell
      spine={vm.spine}
      title="Safety before execution"
      description="After approval and before anything moves, Verin re-checks material evidence, holds a reservation, and refuses to execute on changed facts."
    >
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <FreshValue provenance={vm.revalidatedAt.provenance}>
          <time dateTime={vm.revalidatedAtIso} data-testid="revalidation-timestamp" data-event-instant={vm.revalidatedAtIso}>
            {vm.revalidatedAt.display}
          </time>
        </FreshValue>
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
      </p>

      <section aria-label="Revalidation checks" className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface px-4 py-1">
        {vm.checks.map((c) => (
          <div
            key={c.label}
            className="flex flex-col gap-1 py-2"
            data-related-source-case={c.relatedDecision?.sourceCaseId}
            data-related-disposition={c.relatedDecision?.disposition}
            data-related-request-instant={c.relatedDecision?.requestAtIso}
            data-related-decision-instant={c.relatedDecision?.decidedAtIso}
          >
            <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-800">
              {c.label}
              <StatusBadge status={c.status} label={c.statusLabel} />
            </p>
            {c.detail ? <p className="text-xs text-slate-600">{c.detail}</p> : null}
          </div>
        ))}
      </section>

      {vm.reservationId && vm.idempotencyKey ? (
        <>
          {vm.reservationAt && vm.reservationAtIso ? (
            <p className="text-sm text-slate-700">
              Reservation committed{" "}
              <time
                dateTime={vm.reservationAtIso}
                data-testid="reservation-commit-timestamp"
                data-event-instant={vm.reservationAtIso}
              >
                {vm.reservationAt}
              </time>
            </p>
          ) : null}
          <TapToVerify
            details={[
              ...(vm.executionEligibility?.idempotencyKey
                ? [{ label: "Idempotency key", value: vm.executionEligibility.idempotencyKey, mono: true }]
                : []),
              ...(vm.executionEligibility?.reservations.flatMap((reservation) => [
                { label: "Reservation", value: reservation.reservationId, mono: true },
                { label: "Conflict keys", value: reservation.conflictKeys.join("  ·  "), mono: true },
                { label: "Reservation expiry", value: reservation.expiresAfter, mono: true },
              ]) ?? []),
              ...(vm.executionEligibility?.preconditions.map((precondition) => ({
                label: `Precondition · ${precondition.code}`,
                value: `${precondition.requiredEvidence.join("  ·  ")} · must hold at execution ${String(precondition.mustStillHoldAtExecution)}`,
                mono: true,
              })) ?? []),
            ]}
          />
        </>
      ) : null}

      {vm.invalidation ? (
        <section aria-label="Approval invalidated" className="flex flex-col gap-3">
          {/* 1. The voided approval stays, receded - never removed, never red. */}
          {/* The row's CONTENT recedes to 0.7 (slate-800+ inside, so the AA floor
              holds - design §12.1); the voided badge itself stays at full strength:
              it announces the new state and must not fade with the stale content. */}
          {vm.invalidation.voidedActors.map((actor) => (
            <div
              key={actor.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-surface p-4"
              data-testid="voided-approval"
            >
              <span className="text-sm text-slate-900" style={{ opacity: 0.7 }}>
                {actor.name} <span className="text-slate-800">· {actor.role} · approved {actor.when}</span>
              </span>
              <StatusBadge status="voided" label="Approval voided - evidence changed" />
            </div>
          ))}
          {/* 2. What changed, at full weight; announced politely; one entry fade. */}
          <div role="status" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 animate-fade-in" data-testid="what-changed">
            <p className="text-base font-semibold text-slate-900">{vm.invalidation.deltaSentence}</p>
            <EvidenceMetricRow
              label={vm.invalidation.before.label}
              metric={vm.invalidation.before.metric}
              retrievedAt={vm.invalidation.before.retrievedAt}
              badgeLabel={DEV_BADGE_TEXT["synthetic-fixture"]}
            />
            <EvidenceMetricRow
              label={vm.invalidation.after.label}
              metric={vm.invalidation.after.metric}
              retrievedAt={vm.invalidation.after.retrievedAt}
              badgeLabel={DEV_BADGE_TEXT["synthetic-fixture"]}
            />
            <WhyBubble reason={vm.invalidation.why.reason} {...(vm.invalidation.why.regulation ? { regulation: vm.invalidation.why.regulation } : {})} />
          </div>
          {/* 4. One clear next action. */}
          <PrimaryLink
            href={demoHref("decision", {
              ...routeContext,
              pass: "revalidated",
            })}
          >
            {vm.invalidation.primaryLabel}
          </PrimaryLink>
        </section>
      ) : journeyContinues ? (
        <PrimaryLink href={demoHref("execution", routeContext)}>Execute the movement</PrimaryLink>
      ) : null}

      <JourneyNav back={{ href: demoHref("authority", routeContext), label: "Back to authority" }} />
    </SurfaceShell>
  );
}
