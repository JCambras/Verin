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
import { Card, StatusBadge } from "@app/presentation/ui";
import { WhyBubble } from "@app/presentation/why-bubble";
import { EvidenceRow } from "@app/presentation/evidence-row";
import { TapToVerify } from "@app/presentation/tap-to-verify";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type SafetyVM } from "../model";
import { JourneyNav, NotReached, PrimaryLink, SurfaceShell, demoHref } from "./shared";

export function SafetySurface({
  vm,
  scenarioId,
  firmId,
  stopNote,
  journeyContinues,
}: {
  vm: SafetyVM | null;
  scenarioId: string;
  firmId: string;
  stopNote: string | null;
  journeyContinues: boolean;
}) {
  if (!vm) {
    return (
      <SurfaceShell title="Safety before execution" description="Pre-execution revalidation for an in-flight decision.">
        <NotReached title="Safety check not reached" stopNote={stopNote} backHref={demoHref("decision", scenarioId, firmId)} />
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
        <FreshValue provenance={vm.revalidatedAt.provenance}>{vm.revalidatedAt.display}</FreshValue>
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
      </p>

      <Card as="section" padding="none" aria-label="Revalidation checks" className="flex flex-col divide-y divide-slate-100 px-4 py-1">
        {vm.checks.map((c) => (
          <div key={c.label} className="flex flex-col gap-1 py-2">
            <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-800">
              {c.label}
              <StatusBadge status={c.status} label={c.statusLabel} />
            </p>
            {c.detail ? <p className="text-xs text-slate-600">{c.detail}</p> : null}
          </div>
        ))}
      </Card>

      <TapToVerify
        details={[
          { label: "Reservation", value: vm.reservationId, mono: true },
          { label: "Conflict keys", value: vm.conflictKeys.join("  ·  "), mono: true },
          { label: "Idempotency key", value: vm.idempotencyKey, mono: true },
        ]}
      />

      {vm.invalidation ? (
        <section aria-label="Approval invalidated" className="flex flex-col gap-3">
          {/* 1. The voided approval stays, receded - never removed, never red. */}
          {/* The row's CONTENT recedes to 0.7 (slate-800+ inside, so the AA floor
              holds - design §12.1); the voided badge itself stays at full strength:
              it announces the new state and must not fade with the stale content. */}
          <Card className="flex flex-wrap items-center justify-between gap-2" data-testid="voided-approval">
            <span className="text-sm text-slate-900" style={{ opacity: 0.7 }}>
              {vm.invalidation.voidedActor.name} <span className="text-slate-800">· {vm.invalidation.voidedActor.role} · approved {vm.invalidation.voidedActor.when}</span>
            </span>
            <StatusBadge status="voided" label="Approval voided - evidence changed" />
          </Card>
          {/* 2. What changed, at full weight; announced politely; one entry fade. */}
          <Card variant="white" role="status" className="flex flex-col gap-2 animate-fade-in" data-testid="what-changed">
            <p className="text-base font-semibold text-slate-900">{vm.invalidation.deltaSentence}</p>
            <EvidenceRow label="Before" fact={vm.invalidation.before} badgeLabel={DEV_BADGE_TEXT["synthetic-fixture"]} />
            <EvidenceRow label="After" fact={vm.invalidation.after} badgeLabel={DEV_BADGE_TEXT["synthetic-fixture"]} />
            <WhyBubble reason={vm.invalidation.why.reason} {...(vm.invalidation.why.regulation ? { regulation: vm.invalidation.why.regulation } : {})} />
          </Card>
          {/* 4. One clear next action. */}
          <PrimaryLink href={demoHref("decision", scenarioId, firmId)}>{vm.invalidation.primaryLabel}</PrimaryLink>
        </section>
      ) : journeyContinues ? (
        <PrimaryLink href={demoHref("execution", scenarioId, firmId)}>Execute the movement</PrimaryLink>
      ) : null}

      <JourneyNav back={{ href: demoHref("authority", scenarioId, firmId), label: "Back to authority" }} />
    </SurfaceShell>
  );
}
