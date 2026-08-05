import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type RecordVM } from "../model";

function LifecycleSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 print-avoid-break">
      <h2 className="border-b border-border pb-1 text-base font-semibold text-slate-900">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

export function RecordLifecycleSections({ vm }: { vm: RecordVM }) {
  return (
    <>
      {vm.lifecycle.length > 0 ? (
        <LifecycleSection
          n={9}
          title={vm.lifecycleKind === "signed" ? "Occurred lifecycle" : "Demonstration policy-rerun lifecycle"}
        >
          {vm.lifecycleKind === "demonstration-policy-rerun" ? (
            <p className="flex items-center gap-2 text-xs text-slate-600">
              This lifecycle is demonstration provenance, not a captain-signed ledger.
              <DevProvenanceBadge label={DEV_BADGE_TEXT["deterministic-engine-output"]} />
            </p>
          ) : (
            <p className="text-xs text-slate-600">
              Only events established through the reached stage are presented as occurred.
            </p>
          )}
          <ol className="flex flex-col gap-2">
            {vm.lifecycle.map((event, index) => (
              <li
                key={`${event.type}-${event.timestampIso}`}
                className="grid gap-1 text-sm sm:grid-cols-[2rem_13rem_1fr]"
                data-testid="signed-lifecycle-event"
                data-event-type={event.type}
                data-event-instant={event.timestampIso}
              >
                <span className="text-slate-500">{index + 1}.</span>
                <span className="font-mono text-xs text-slate-800">{event.type}</span>
                <span className="text-slate-700">
                  <time dateTime={event.timestampIso}>{event.display}</time> · {event.note}
                </span>
              </li>
            ))}
          </ol>
        </LifecycleSection>
      ) : null}

      {vm.expectedLifecycle.length > 0 ? (
        <LifecycleSection
          n={vm.lifecycle.length > 0 ? 10 : 9}
          title="Signed expected outcomes beyond the reached stage"
        >
          <p className="text-xs text-slate-600">
            These captain-signed events describe expected outcomes. They did not occur in this demo run and are excluded from occurred-lifecycle, reached-state, and occurred-hash claims. Associated hashes are labeled signed expected bindings.
          </p>
          <ol className="flex flex-col gap-2">
            {vm.expectedLifecycle.map((event, index) => (
              <li
                key={`${event.type}-${event.timestampIso}`}
                className="grid gap-1 text-sm sm:grid-cols-[2rem_13rem_1fr]"
                data-testid="signed-expected-lifecycle-event"
                data-event-type={event.type}
                data-event-instant={event.timestampIso}
              >
                <span className="text-slate-500">{index + 1}.</span>
                <span className="font-mono text-xs text-slate-800">{event.type}</span>
                <span className="text-slate-700">
                  <time dateTime={event.timestampIso}>{event.display}</time> · {event.note}
                </span>
              </li>
            ))}
          </ol>
        </LifecycleSection>
      ) : null}
    </>
  );
}
