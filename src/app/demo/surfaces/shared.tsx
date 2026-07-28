/**
 * Shared shell for the branch-proof demo surfaces: the fade-in container with the
 * DecisionSpine above the page h1 (design §4 placement), journey navigation links,
 * and the honest not-reached state for stations a journey never reached.
 *
 * Surfaces import ONLY this module, ../model (types), and presentation primitives -
 * never the contract data or the fake service. The demo-skeleton-honesty fence
 * enforces that import boundary so no component can recompute a decision.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { DecisionSpine } from "@app/presentation/decision-spine";
import type { ExecutionTimelineRow } from "@app/presentation/execution-timeline";
import { EmptyState } from "@app/presentation/ui";
import { DEV_BADGE_TEXT, type DecisionSpineVM, type ExecutionRowVM } from "../model";

/** Real branch-proof stations. The two removed surfaces survive only as redirect
 * aliases so old rehearsal links cannot reach stale behavior. */
export const DEMO_SEQUENCE = [
  "workspace",
  "intent",
  "evidence",
  "decision",
  "policy-trace",
  "authority",
  "safety",
  "execution",
  "verification",
  "record",
] as const;
export const LEGACY_SETUP_ALIASES = ["comparison", "policy-authoring"] as const;
export type DemoStation =
  | (typeof DEMO_SEQUENCE)[number]
  | (typeof LEGACY_SETUP_ALIASES)[number];

export function demoHref(station: DemoStation, scenarioId: string, firmId: string, extra?: string): string {
  return `/app/demo/${station}?scenario=${scenarioId}&firm=${firmId}${extra ?? ""}`;
}

/** The one ExecutionRowVM -> ExecutionTimeline row mapping, shared by the execution
 * and verification surfaces so the two renders cannot drift. */
export function toTimelineRow(r: ExecutionRowVM): ExecutionTimelineRow {
  return {
    step: r.step,
    target: r.target,
    status: r.status,
    statusLabel: r.statusLabel,
    timestamp: r.timestamp,
    ...(r.honestyLine ? { honestyLine: r.honestyLine } : {}),
    ...(r.plainClaim ? { plainClaim: r.plainClaim } : {}),
    ...(r.affordanceLabel ? { affordanceLabel: r.affordanceLabel } : {}),
    identifiers: r.identifiers.map((i) => ({ label: i.label, value: i.value, mono: true })),
    devBadgeLabel: DEV_BADGE_TEXT[r.fakeClass],
  };
}

/** Link dressed in the Button primary recipe - the surface's one clear next action. */
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
    >
      {children}
    </Link>
  );
}

/** Link dressed in the Button secondary recipe. */
export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

export function SurfaceShell({
  spine,
  title,
  description,
  children,
}: {
  spine?: DecisionSpineVM | null;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {spine ? <DecisionSpine stations={spine.stations} stateSlot={spine.stateSlot ?? null} /> : null}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Bottom-of-surface navigation. At most one primary per surface (design §1 rule 5):
 * pass `forward` only when the surface has no in-content primary action. */
export function JourneyNav({
  back,
  forward,
}: {
  back?: { href: string; label: string };
  forward?: { href: string; label: string };
}) {
  return (
    <nav aria-label="Journey" className="flex items-center justify-between gap-3 border-t border-border pt-4 print-hide">
      {back ? <SecondaryLink href={back.href}>{back.label}</SecondaryLink> : <span />}
      {forward ? <PrimaryLink href={forward.href}>{forward.label}</PrimaryLink> : null}
    </nav>
  );
}

/** The honest dead-end for a station this journey never reached (design §4: never
 * render a station the record has not reached) - EmptyState doctrine, so the dead
 * end becomes a next step. */
export function NotReached({ title, stopNote, backHref }: { title: string; stopNote: string | null; backHref: string }) {
  return (
    <EmptyState
      title={title}
      description={stopNote ?? "This journey has not reached this station."}
      action={<SecondaryLink href={backHref}>Back to the decision</SecondaryLink>}
    />
  );
}
