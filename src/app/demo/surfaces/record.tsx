/**
 * Surface 12 - The printable examiner-grade decision artifact (demo contract §4.12;
 * design §9). A document, not a screen: numbered sections in journey order, ALL
 * reasoning expanded as body text (the WhyBubble is a screen affordance), immutable
 * identifiers printed complete in mono, and the ADR-0022 watermark rules: a
 * demonstration-derived artifact carries the watermark chip on screen and the
 * DEMO_WATERMARK string in the running header AND footer of every printed page.
 * There is no suppression path - a demonstration artifact cannot print clean.
 */
import { StatusBadge } from "@app/presentation/ui";
import { Metric } from "@app/presentation/metric";
import { FreshValue } from "@app/presentation/fresh-value";
import { EvidenceConflict, EvidenceMetricRow, EvidenceMissing, EvidenceRow } from "@app/presentation/evidence-row";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, DISPOSITION_LABELS, type EvidenceRowVM, type ExecutionRowVM, type RecordVM, type WhyVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref, type DemoRouteContext } from "./shared";
import { RecordHeader } from "./record-header";

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
          <p className="text-sm text-slate-700">{row.summary}</p>
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

function ExecutionDocRow({ row }: { row: ExecutionRowVM }) {
  return (
    <li className="flex flex-col gap-0.5 text-sm print-avoid-break">
      <span className="text-slate-800">
        {row.step} · {row.target} · {row.statusLabel} · {row.timestamp}
      </span>
      {row.honestyLine ? <span className="text-xs text-slate-600">{row.honestyLine}</span> : null}
      {row.plainClaim ? <span className="text-slate-700">{row.plainClaim}</span> : null}
      <span className="font-mono text-xs text-slate-600">{row.identifiers.map((i) => `${i.label}: ${i.value}`).join(" · ")}</span>
    </li>
  );
}

const NOT_REACHED = "Not reached - this record ends where the journey ended.";

export function RecordSurface({
  vm,
  routeContext,
}: { vm: RecordVM; routeContext: DemoRouteContext }) {
  const running = `${vm.header.watermark ? `${vm.header.watermark} · ` : ""}${vm.header.decisionId}`;
  return (
    /* ADR-0022: the running header and footer of EVERY printed page. thead/tfoot
       repeat on each page AND reserve their space (fixed strips overlap content),
       while on screen the .print-doc wrapper is layout-inert (globals.css). */
    <table className="print-doc" role="presentation">
      <thead>
        <tr>
          <td>
            <div aria-hidden className="print-running">
              <span>{running}</span>
              <span>Verin decision record</span>
            </div>
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <SurfaceShell title="Decision record" description="Examiner-grade: every section expanded, every identifier complete.">
              <RecordHeader vm={vm} />

              {vm.policyApproval ? (
                <section aria-label="Demonstration policy approval" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 print-avoid-break">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    Attributed demonstration policy approval
                    <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.policyApproval.fakeClass]} />
                  </p>
                  <p className="font-mono text-xs break-all text-slate-800">
                    {vm.policyApproval.fromVersion} → {vm.policyApproval.toVersion} · actor {vm.policyApproval.actorId} ({vm.policyApproval.actorRole}) · policy hash {vm.policyApproval.policyHash}
                  </p>
                  <p className="text-xs font-medium text-amber-900">{vm.policyApproval.watermark}</p>
                </section>
              ) : null}

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
                  <StatusBadge status={vm.disposition.kind} label={DISPOSITION_LABELS[vm.disposition.kind]} />
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
                  <dl className="grid gap-1 text-sm text-slate-700">
                    <div>
                      <dt className="inline">Source: </dt>
                      <dd className="inline font-mono text-xs">{vm.disposition.source.ref}</dd>
                    </div>
                    <div>
                      <dt className="inline">Source identity: </dt>
                      <dd className="inline font-mono text-xs">{vm.disposition.source.id}</dd>
                    </div>
                    <div>
                      <dt className="inline">Reason code: </dt>
                      <dd className="inline font-mono text-xs">{vm.disposition.source.reasonCode}</dd>
                    </div>
                  </dl>
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
                {vm.authorityMode === "automatic" && vm.automaticAuthority ? (
                  <div className="flex flex-col gap-1 print-avoid-break" data-testid="automatic-authority">
                    <p className="text-sm font-medium text-slate-800">{vm.automaticAuthority.title}</p>
                    <p className="text-sm text-slate-700">{vm.automaticAuthority.summary}</p>
                    <p className="font-mono text-xs text-slate-600">{vm.automaticAuthority.policyRef}</p>
                  </div>
                ) : vm.authorityMode === "staged" && vm.approvalStages ? (
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
                      <p className="text-xs text-slate-600">
                        Execution mode {s.executionMode} · expires after {s.expiresAfter}
                      </p>
                      {s.escalationPath.map((escalation) => (
                        <p
                          key={`${s.stageId}-${escalation.after}-${escalation.reasonCode}`}
                          className="text-xs text-slate-600"
                        >
                          Escalates after {escalation.after} to {escalation.roleIds.join(", ")} · {escalation.reasonCode}
                        </p>
                      ))}
                      {s.authorityEvents ? (
                        <ol className="flex flex-col gap-1 text-xs text-slate-600">
                          {s.authorityEvents.map((event) => (
                            <li key={event.type}>{event.display}</li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-600">{vm.stopNote ?? NOT_REACHED}</p>
                )}
              </DocSection>

              <DocSection n={6} title="Safety revalidation">
                {vm.executionEligibility ? (
                  <div className="flex flex-col gap-1 print-avoid-break">
                    <p className="text-sm text-slate-700">
                      Execution eligible: {vm.executionEligibility.eligible ? "yes" : "no"} · {vm.executionEligibility.reason}
                    </p>
                    {vm.executionEligibility.idempotencyKey ? (
                      <p className="font-mono text-xs text-slate-600">
                        Idempotency key {vm.executionEligibility.idempotencyKey}
                      </p>
                    ) : null}
                    {vm.executionEligibility.reservations.map((reservation) => (
                      <p key={reservation.reservationId} className="font-mono text-xs text-slate-600">
                        Reservation {reservation.reservationId} · conflict keys {reservation.conflictKeys.join(", ")} · expires after {reservation.expiresAfter}
                      </p>
                    ))}
                    {vm.executionEligibility.preconditions.map((precondition) => (
                      <p key={precondition.code} className="font-mono text-xs text-slate-600">
                        Precondition {precondition.code} · evidence {precondition.requiredEvidence.join(", ")} · must hold at execution {String(precondition.mustStillHoldAtExecution)}
                      </p>
                    ))}
                  </div>
                ) : null}
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
                    {vm.safety.executionEligibility && !vm.executionEligibility ? (
                      <>
                        {vm.safety.reservationAt && vm.safety.reservationAtIso ? (
                          <p className="text-sm text-slate-700">
                            Reservation committed{" "}
                            <time
                              dateTime={vm.safety.reservationAtIso}
                              data-testid="record-reservation-commit-timestamp"
                              data-event-instant={vm.safety.reservationAtIso}
                            >
                              {vm.safety.reservationAt}
                            </time>
                          </p>
                        ) : null}
                        <p className="text-xs text-slate-700">
                          Execution eligible: {vm.safety.executionEligibility.eligible ? "yes" : "no"} · {vm.safety.executionEligibility.reason}
                        </p>
                        {vm.safety.executionEligibility.idempotencyKey ? (
                          <p className="font-mono text-xs text-slate-600">
                            Idempotency key {vm.safety.executionEligibility.idempotencyKey}
                          </p>
                        ) : null}
                        {vm.safety.executionEligibility.reservations.map((reservation) => (
                          <p key={reservation.reservationId} className="font-mono text-xs text-slate-600">
                            Reservation {reservation.reservationId} · conflict keys {reservation.conflictKeys.join(", ")} · expires after {reservation.expiresAfter}
                          </p>
                        ))}
                        {vm.safety.executionEligibility.preconditions.map((precondition) => (
                          <p key={precondition.code} className="font-mono text-xs text-slate-600">
                            Precondition {precondition.code} · evidence {precondition.requiredEvidence.join(", ")} · must hold at execution {String(precondition.mustStillHoldAtExecution)}
                          </p>
                        ))}
                      </>
                    ) : null}
                    {vm.safety.invalidation ? (
                      <div className="flex flex-col gap-1">
                        {vm.safety.invalidation.voidedActors.map((actor) => (
                          <p key={actor.name} className="text-sm text-slate-800">
                            Approval by {actor.name} ({actor.when}) was voided: {vm.safety!.invalidation!.deltaSentence}
                          </p>
                        ))}
                        <EvidenceMetricRow
                          label={vm.safety.invalidation.before.label}
                          metric={vm.safety.invalidation.before.metric}
                          retrievedAt={vm.safety.invalidation.before.retrievedAt}
                        />
                        <EvidenceMetricRow
                          label={vm.safety.invalidation.after.label}
                          metric={vm.safety.invalidation.after.metric}
                          retrievedAt={vm.safety.invalidation.after.retrievedAt}
                        />
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
                      <ExecutionDocRow key={`${r.step}-${r.timestamp}`} row={r} />
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
                        <li
                          key={p.display}
                          className="text-sm text-slate-800"
                          data-proof-event={p.ledgerEvent}
                          data-event-instant={p.provenance.asOf}
                        >
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
                    <p className="text-xs text-slate-600">{vm.verification.polling.display}</p>
                    {vm.verification.appended.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium text-slate-800">Later arrivals, appended to the same register</p>
                        <ul className="flex flex-col gap-2">
                          {vm.verification.appended.map((r) => (
                            <ExecutionDocRow key={`${r.step}-${r.timestamp}`} row={r} />
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {vm.verification.exceptionDecision ? (
                      <div
                        className="flex flex-col gap-1 print-avoid-break"
                        data-testid="exception-decision-requested"
                      >
                        <p className="text-sm font-medium text-slate-800">
                          Exception decision requested
                        </p>
                        <p className="text-sm text-slate-700">
                          {vm.verification.exceptionDecision.summary}
                        </p>
                        <p className="font-mono text-xs text-slate-600">
                          {vm.verification.exceptionDecision.eventType} · reason{" "}
                          {vm.verification.exceptionDecision.reason} · trigger{" "}
                          {vm.verification.exceptionDecision.triggeringLedgerEvent} · prior decision{" "}
                          {vm.verification.exceptionDecision.priorDecisionId} ·{" "}
                          <time dateTime={vm.verification.exceptionDecision.requestedAtIso}>
                            {vm.verification.exceptionDecision.requestedAt}
                          </time>
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-slate-600">{vm.stopNote ?? NOT_REACHED}</p>
                )}
              </DocSection>

              {vm.lifecycle.length > 0 ? (
                <DocSection
                  n={9}
                  title={vm.lifecycleKind === "signed" ? "Signed lifecycle" : "Demonstration policy-rerun lifecycle"}
                >
                  {vm.lifecycleKind === "demonstration-policy-rerun" ? (
                    <p className="flex items-center gap-2 text-xs text-slate-600">
                      This lifecycle is demonstration provenance, not a captain-signed ledger.
                      <DevProvenanceBadge label={DEV_BADGE_TEXT["deterministic-engine-output"]} />
                    </p>
                  ) : null}
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
                </DocSection>
              ) : null}

              <DocSection n={vm.lifecycle.length > 0 ? 10 : 9} title="Provenance appendix">
                <p className="text-sm text-slate-700">
                  This artifact derives from the following leaf sources (ADR-0022 flattened trace):{" "}
                  <span className="font-mono text-xs text-slate-800">{vm.provenanceAppendix.join(", ")}</span>
                </p>
                <p className="text-sm text-slate-600">
                  Every input is currently synthetic or demo-entered, so this record is a demonstration and is excluded from the real
                  examiner-export. A clean print is earned by real inputs, never granted.
                </p>
              </DocSection>

              <JourneyNav back={{ href: demoHref("policy-authoring", routeContext), label: "Back to policy authoring" }} />
            </SurfaceShell>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td>
            <div aria-hidden className="print-running">
              <span>{running}</span>
              <time dateTime={vm.header.createdAtIso}>{vm.header.createdAt}</time>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
