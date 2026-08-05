/**
 * ApprovalStagePanel (design language §7.2) - one card per approval stage: the
 * requirement in plain words (quorum, distinct-actor, requester exclusion as
 * sentences, never icon grammar), and actor slots as rows with StatusBadges. The
 * requester's approve control is ABSENT, not disabled - eligibility is server-enforced
 * and the UI reflects reality. A voided actor row stays (append-only UI) and recedes
 * to the 0.7 opacity floor - the same grammar as stale data, which a voided approval is.
 */
import { StatusBadge } from "./ui";

export interface ApprovalActorSlot {
  readonly name: string;
  readonly role: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly note?: string;
  readonly requesterExcluded?: boolean;
}
export interface ApprovalStageProps {
  readonly title: string;
  readonly requirement: string;
  readonly actors: readonly ApprovalActorSlot[];
}

export function ApprovalStagePanel({ stage }: { stage: ApprovalStageProps }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-surface p-4" aria-label={stage.title}>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-slate-900">{stage.title}</p>
        <p className="text-sm text-slate-600">{stage.requirement}</p>
      </div>
      <ul className="flex flex-col divide-y divide-slate-100">
        {stage.actors.map((a) => (
          <li key={a.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
            {/* A voided actor's CONTENT recedes to 0.7 (secondary text steps up to
                slate-800 so the WCAG 1.4.3 floor holds - design §12.1); the state
                badge stays at full strength: it announces the void, it is not stale. */}
            <span
              className={`text-sm ${a.status === "voided" ? "text-slate-900" : "text-slate-800"}`}
              style={a.status === "voided" ? { opacity: 0.7 } : undefined}
            >
              {a.name} <span className={a.status === "voided" ? "text-slate-800" : "text-slate-600"}>· {a.role}</span>
              {a.note ? <span className="mt-0.5 block text-xs text-slate-600">{a.note}</span> : null}
            </span>
            {a.requesterExcluded ? null : <StatusBadge status={a.status} label={a.statusLabel} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
