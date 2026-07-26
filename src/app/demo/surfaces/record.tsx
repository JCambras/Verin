/**
 * Surface 12 - The printable examiner-grade decision artifact (demo contract §4.12;
 * design §9). A document, not a screen: numbered sections in journey order, ALL
 * reasoning expanded as body text (the WhyBubble is a screen affordance), immutable
 * identifiers printed complete in mono, and the ADR-0022 watermark rules: a
 * demonstration-derived artifact carries the watermark chip on screen and the
 * DEMO_WATERMARK string in the running header AND footer of every printed page.
 * There is no suppression path - a demonstration artifact cannot print clean.
 */
import { Wordmark } from "@app/presentation/brand";
import { StatusBadge } from "@app/presentation/ui";
import { Metric } from "@app/presentation/metric";
import { FreshValue } from "@app/presentation/fresh-value";
import { EvidenceConflict, EvidenceMetricRow, EvidenceMissing, EvidenceRow } from "@app/presentation/evidence-row";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type EvidenceRowVM, type RecordVM, type WhyVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref } from "./shared";
import { PrintButton } from "./print-button";

function DocSection({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 print-avoid-break">
      <h2 className="border-b border-border pb-1 text-base font-semibold text-slate-900">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

/** On paper (and on this surface) reasoning prints expanded - never behind a tap. */
function ExpandedWhy({ why }: { why: WhyVM }) {
  return (
    <p className="text-sm text-slate-700">
      {why.reason}
      {why.regulation ? <span className="mt-0.5 block text-xs text-slate-600">Regulation: {why.regulation}</span> : null}
    </p>
  );
}

function EvidenceDocRow({ row }: { row: EvidenceRowVM }) {
  switch (row.kind) {
    case "metric":
      return (
        <EvidenceMetricRow label={row.label} metric={row.metric} retrievedAt={row.retrievedAt} badgeLabel={DEV_BADGE_TEXT[row.fakeClass]}>
          {row.why ? <ExpandedWhy why={row.why} /> : null}
        </EvidenceMetricRow>
      );
    case "fact":
      return (
        <EvidenceRow label={row.label} fact={row.fact} badgeLabel={DEV_BADGE_TEXT[row.fakeClass]}>
          {row.why ? <ExpandedWhy why={row.why} /> : null}
        </EvidenceRow>
      );
    case "conflict":
      return <EvidenceConflict label={row.label} rule={row.rule} a={row.a} b={row.b} badgeLabel={DEV_BADGE_TEXT[row.fakeClass]} />;
    case "missing":
      return <EvidenceMissing text={row.text} />;
  }
}

const NOT_REACHED = "Not reached - this record ends where the journey ended.";

export function RecordSurface({ vm, scenarioId, firmId }: { vm: RecordVM; scenarioId: string; firmId: string }) {
  const running = `${vm.header.watermark ? `${vm.header.watermark} · ` : ""}${vm.header.decisionId}`;
  return (
    <>
      {/* ADR-0022: the running header and footer of EVERY printed page. */}
      <div aria-hidden className="print-running print-running-top">
        <span>{running}</span>
        <span>Verin decision record</span>
      </div>
      <div aria-hidden className="print-running print-running-bottom">
        <span>{running}</span>
        <span>{vm.header.createdAt}</span>
      </div>

      <SurfaceShell title="Decision record" description="Examiner-grade: every section expanded, every identifier complete.">
        <header className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4 print-avoid-break">
          <p className="flex flex-wrap items-center gap-2">
            <Wordmark className="text-lg" />
            {vm.header.watermark ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900" data-testid="record-watermark">
                {vm.header.watermark}
              </span>
            ) : null}
          </p>
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex flex-col">
              <dt className="text-xs text-slate-600">Decision id</dt>
              <dd className="font-mono text-xs text-slate-800">{vm.header.decisionId}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-slate-600">Created</dt>
              <dd className="text-slate-800">{vm.header.createdAt}</dd>
            </div>
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-slate-600">Decision hash</dt>
              <dd className="font-mono text-xs break-all text-slate-800">{vm.hashes.decisionHash}</dd>
            </div>
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-slate-600">Input-bundle hash</dt>
              <dd className="font-mono text-xs break-all text-slate-800">{vm.hashes.bundleHash}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-slate-600">Policy version</dt>
              <dd className="font-mono text-xs text-slate-800">{vm.hashes.policyVersion}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-slate-600">Household instructions</dt>
              <dd className="font-mono text-xs text-slate-800">{vm.hashes.instructionVersion}</dd>
            </div>
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-slate-600">Audit-chain position</dt>
              <dd className="font-mono text-xs text-slate-800">{vm.hashes.auditPosition}</dd>
            </div>
          </dl>
          <PrintButton />
        </header>

        <DocSection n={1} title="Intent">
          <p className="text-sm text-slate-800">
            <FreshValue provenance={vm.intent.requestProvenance}>“{vm.intent.requestText}”</FreshValue>
          </p>
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {vm.intent.interpreted.slots.map((s) => (
              <div key={s.label} className="flex flex-col">
                <dt className="text-xs text-slate-600">{s.label}</dt>
                <dd className="text-sm text-slate-700">{s.metric ? <Metric metric={s.metric} /> : s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="flex items-center gap-2 text-xs text-slate-600">
            Interpretation: {vm.intent.interpreted.draftLabel}
            <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.intent.interpreted.fakeClass]} />
          </p>
        </DocSection>

        <DocSection n={2} title="Evidence">
          <div className="flex flex-col divide-y divide-slate-100">
            {vm.evidence.map((row, i) => (
              <EvidenceDocRow key={i} row={row} />
            ))}
          </div>
        </DocSection>

        <DocSection n={3} title="Decision and disposition">
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge status={vm.disposition.kind} label={vm.disposition.kind} />
            <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.disposition.fakeClass]} />
          </p>
          <p className="text-sm text-slate-800">{vm.disposition.headline}</p>
          {vm.disposition.blockers?.map((b) => (
            <p key={b.condition} className="text-sm text-slate-700">
              Blocker: {b.condition} (resolution: {b.affordanceLabel})
            </p>
          ))}
          {vm.disposition.prohibitedScope ? <p className="text-sm text-slate-700">Prohibited scope: {vm.disposition.prohibitedScope}</p> : null}
          {vm.disposition.source ? (
            <p className="text-sm text-slate-700">
              Source: <span className="font-mono text-xs">{vm.disposition.source.ref}</span>
            </p>
          ) : null}
          <ExpandedWhy why={vm.disposition.why} />
          {vm.disposition.doctrine ? <p className="text-sm text-slate-600">{vm.disposition.doctrine}</p> : null}
        </DocSection>

        <DocSection n={4} title="Precedence trace">
          <ol className="flex flex-col gap-2">
            {vm.precedence.map((r) => (
              <li key={r.order} className="flex flex-col gap-0.5 text-sm">
                <span className="text-slate-800">
                  {r.order}. {r.rule}: {r.result} <span className="font-mono text-xs text-slate-500">({r.version})</span>
                </span>
                {r.why ? <ExpandedWhy why={r.why} /> : null}
              </li>
            ))}
          </ol>
        </DocSection>

        <DocSection n={5} title="Authority and approvals">
          {vm.approvalStages ? (
            vm.approvalStages.map((s) => (
              <div key={s.title} className="flex flex-col gap-1 print-avoid-break">
                <p className="text-sm font-medium text-slate-800">{s.title}</p>
                <p className="text-sm text-slate-600">{s.requirement}</p>
                <ul className="flex flex-col gap-1">
                  {s.actors.map((a) => (
                    // Receded rows use slate-800 so 0.7 opacity keeps the AA floor (§12.1).
                    <li key={a.name} className={`text-sm ${a.status === "voided" ? "text-slate-800" : "text-slate-700"}`} style={a.status === "voided" ? { opacity: 0.7 } : undefined}>
                      {a.name} · {a.role}: {a.requesterExcluded ? (a.note ?? a.statusLabel) : a.statusLabel}
                    </li>
                  ))}
                </ul>
                {s.expiry || s.escalation ? (
                  <p className="text-xs text-slate-600">
                    {s.expiry}
                    {s.expiry && s.escalation ? " · " : ""}
                    {s.escalation}
                  </p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-600">{vm.stopNote ?? NOT_REACHED}</p>
          )}
        </DocSection>

        <DocSection n={6} title="Safety revalidation">
          {vm.safety ? (
            <>
              <p className="text-sm text-slate-800">
                <FreshValue provenance={vm.safety.revalidatedAt.provenance}>{vm.safety.revalidatedAt.display}</FreshValue>
              </p>
              <ul className="flex flex-col gap-1">
                {vm.safety.checks.map((c) => (
                  <li key={c.label} className="text-sm text-slate-700">
                    {c.label}: {c.statusLabel}
                    {c.detail ? ` - ${c.detail}` : ""}
                  </li>
                ))}
              </ul>
              <p className="font-mono text-xs text-slate-600">
                Reservation {vm.safety.reservationId} · conflict keys {vm.safety.conflictKeys.join(", ")} · idempotency key {vm.safety.idempotencyKey}
              </p>
              {vm.safety.invalidation ? (
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-slate-800">
                    Approval by {vm.safety.invalidation.voidedActor.name} ({vm.safety.invalidation.voidedActor.when}) was voided: {vm.safety.invalidation.deltaSentence}
                  </p>
                  <EvidenceRow label="Before" fact={vm.safety.invalidation.before} />
                  <EvidenceRow label="After" fact={vm.safety.invalidation.after} />
                  <ExpandedWhy why={vm.safety.invalidation.why} />
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-600">{vm.stopNote ?? NOT_REACHED}</p>
          )}
        </DocSection>

        <DocSection n={7} title="Execution">
          {vm.execution ? (
            <ul className="flex flex-col gap-2">
              {vm.execution.map((r) => (
                <li key={`${r.step}-${r.timestamp}`} className="flex flex-col gap-0.5 text-sm print-avoid-break">
                  <span className="text-slate-800">
                    {r.step} · {r.target} · {r.statusLabel} · {r.timestamp}
                  </span>
                  {r.honestyLine ? <span className="text-xs text-slate-600">{r.honestyLine}</span> : null}
                  {r.plainClaim ? <span className="text-slate-700">{r.plainClaim}</span> : null}
                  <span className="font-mono text-xs text-slate-600">{r.identifiers.map((i) => `${i.label}: ${i.value}`).join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">{vm.stopNote ?? NOT_REACHED}</p>
          )}
        </DocSection>

        <DocSection n={8} title="Verification state at time of export">
          {vm.verification ? (
            <>
              <ul className="flex flex-col gap-1">
                {vm.verification.proves.map((p) => (
                  <li key={p.display} className="text-sm text-slate-800">
                    Proven: <FreshValue provenance={p.provenance}>{p.display}</FreshValue>{" "}
                    <span className="text-xs text-slate-500">retrieved {p.retrievedAt}</span>
                  </li>
                ))}
                {vm.verification.notProvenYet.map((n) => (
                  <li key={n} className="text-sm text-slate-700">
                    Not yet proven: {n}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-600">{vm.verification.nextPoll}</p>
            </>
          ) : (
            <p className="text-sm text-slate-600">{vm.stopNote ?? NOT_REACHED}</p>
          )}
        </DocSection>

        <DocSection n={9} title="Provenance appendix">
          <p className="text-sm text-slate-700">
            This artifact derives from the following leaf sources (ADR-0022 flattened trace):{" "}
            <span className="font-mono text-xs text-slate-800">{vm.provenanceAppendix.join(", ")}</span>
          </p>
          <p className="text-sm text-slate-600">
            Every input is currently synthetic or demo-entered, so this record is a demonstration and is excluded from the real
            examiner-export. A clean print is earned by real inputs, never granted.
          </p>
        </DocSection>

        <JourneyNav back={{ href: demoHref("policy-authoring", scenarioId, firmId), label: "Back to policy authoring" }} />
      </SurfaceShell>
    </>
  );
}
