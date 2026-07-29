/**
 * The demo launcher: runs the full seven-minute journey (demo contract §3) and
 * exposes all twelve scenario branches (contract §5) without code changes - each
 * card starts the same clickable sequence under a different recorded branch.
 * Everything the journey renders is a labeled fake (charter #5 / ADR-0027).
 */
import Link from "next/link";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { SCENARIOS, DEFAULT_FIRM } from "@app/demo/data";
import { PrimaryLink, demoHref } from "@app/demo/surfaces/shared";

export const runtime = "nodejs";

export default function DemoLauncherPage() {
  return (
    <div data-demo-launcher className="flex flex-col gap-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Money-movement demo</h1>
        <p className="mt-1 text-sm text-slate-600">
          One governed journey: intent, evidence, decision, authority, safety, execution, verification - then the Firm A / Firm B
          comparison and a policy change, all on the same data.
        </p>
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          Every value in this demo is a labeled fake until its real path lands.
          <DevProvenanceBadge label="synthetic fixture" />
        </p>
      </div>

      <PrimaryLink href={demoHref("workspace", "recent-bank-change-block", DEFAULT_FIRM)}>Run the seven-minute journey</PrimaryLink>

      <section aria-label="Scenario branches" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">Scenario branches</h2>
        <p className="text-sm text-slate-600">The twelve contract branches (demo contract §5), each clickable end to end.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SCENARIOS.map((s) => (
            <li key={s.id}>
              <Link
                href={demoHref("workspace", s.id, DEFAULT_FIRM)}
                className="block h-full rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400 focus-visible:border-slate-500"
              >
                <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                <p className="mt-1 text-sm text-slate-600">{s.description}</p>
                <p className="mt-2 text-xs text-slate-600">Outcome class: {s.outcomeClass}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
