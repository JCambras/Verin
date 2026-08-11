/**
 * DispositionNotice (design language §5.2) - the card that heads the recommendation
 * view and any surface that must state a disposition. The three treatments are
 * distinguishable at a glance with body copy unread:
 *
 *  - proceed: standard card, green badge, the action in one sentence, figures as
 *    provenanced metrics, the authority requirement in body text.
 *  - blocked: amber attention card; EVERY blocker is a row with its resolving
 *    affordance (dead ends become next steps). Never an approve/override substitute.
 *  - prohibited: the calm slate card (deliberately NOT red, NOT amber), the solid
 *    slate-900 badge, scope + versioned source + reasoning, and ZERO resolving
 *    affordances - only inspective links. A refusal reads as integrity, not breakage.
 *
 * Pure rendering of a typed disposition view model: the disposition arrives decided;
 * nothing here computes or branches on evidence.
 */
import type { ReactNode } from "react";
import type { DisplayMetric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";
import Link from "next/link";
import { FreshValue } from "./fresh-value";
import { Metric } from "./metric";
import { Button, Card, StatusBadge } from "./ui";
import { WhyBubble } from "./why-bubble";
import { DevProvenanceBadge } from "./dev-provenance-badge";

export interface DispositionFigure {
  readonly label: string;
  readonly metric: DisplayMetric;
}
export interface DispositionBlocker {
  readonly condition: string;
  readonly affordanceLabel: string;
}
export interface DispositionProps {
  readonly kind: "proceed" | "blocked" | "prohibited";
  readonly headline: string;
  readonly why: { readonly reason: string; readonly regulation?: string };
  readonly badgeLabel: string;
  readonly figures?: readonly DispositionFigure[];
  readonly authoritySummary?: string;
  readonly blockers?: readonly DispositionBlocker[];
  readonly prohibitedScope?: string;
  readonly source?: { readonly ref: string; readonly provenance: RecordProvenance; readonly kindLabel: string };
  readonly doctrine?: string;
  /** Prohibited only: the inspective links (view the trace, print the record). */
  readonly inspective?: ReactNode;
  readonly devBadgeLabel: string;
}

function Figures({ figures }: { figures: readonly DispositionFigure[] }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2">
      {figures.map((f) => (
        <div key={f.label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-slate-600">{f.label}</dt>
          <dd className="text-sm">
            <Metric metric={f.metric} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DispositionNotice(p: DispositionProps) {
  return (
    <Card as="section" variant={p.kind === "blocked" ? "attention" : "surface"} className="flex flex-col gap-3" data-testid={`disposition-${p.kind}`} aria-label={`Disposition: ${p.badgeLabel}`}>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge status={p.kind} label={p.badgeLabel} />
        <DevProvenanceBadge label={p.devBadgeLabel} />
      </p>
      <p className="text-base font-semibold text-slate-900">{p.headline}</p>

      {p.kind === "proceed" ? (
        <>
          {p.figures ? <Figures figures={p.figures} /> : null}
          {p.authoritySummary ? <p className="text-sm text-slate-600">{p.authoritySummary}</p> : null}
        </>
      ) : null}

      {p.kind === "blocked" && p.blockers ? (
        <ul className="flex flex-col gap-2">
          {p.blockers.map((b) => (
            <li key={b.condition} className="flex flex-col items-start gap-1.5 border-t border-amber-200 pt-2" data-testid="blocker-row">
              <span className="text-sm text-amber-900">{b.condition}</span>
              {/* The resolving affordance: derived from the blocker itself. Wired to a
                  real resolution path when that path lands (walking skeleton). */}
              <Button type="button" variant="secondary">
                {b.affordanceLabel}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {p.kind === "prohibited" ? (
        <>
          <p className="text-sm text-slate-800">
            <span className="text-slate-600">Prohibited scope: </span>
            {p.prohibitedScope}
          </p>
          {p.source ? (
            <p className="flex flex-wrap items-baseline gap-2 text-sm text-slate-800">
              <span className="text-slate-600">Source ({p.source.kindLabel}):</span>
              <FreshValue provenance={p.source.provenance}>
                <span className="font-mono text-xs">{p.source.ref}</span>
              </FreshValue>
            </p>
          ) : null}
        </>
      ) : null}

      <WhyBubble reason={p.why.reason} {...(p.why.regulation ? { regulation: p.why.regulation } : {})} />

      {p.kind === "prohibited" ? (
        <>
          {p.doctrine ? <p className="text-sm text-slate-600">{p.doctrine}</p> : null}
          {p.inspective}
        </>
      ) : null}
    </Card>
  );
}

/** The inspective link row a prohibited card may carry (never a resolving affordance). */
export function InspectiveLinks({ links }: { links: readonly { label: string; href: string }[] }) {
  return (
    <p className="flex flex-wrap gap-4">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900">
          {l.label}
        </Link>
      ))}
    </p>
  );
}
