"use client";

/**
 * THE HOUSEHOLD SURFACE (ADR-0057) - one household, in the depth an adviser
 * actually needs: who is in it and how they are related, what entities sit
 * inside it, every account with its registration, holdings, beneficiaries and
 * signers, the bank instructions and their change history, the planned
 * withdrawals, the restrictions and standing instructions, what is pending, and
 * what has happened lately.
 *
 * The health score is expanded rather than asserted: six factors, each with its
 * weight, the sentence explaining it, and the records it read. A score a person
 * cannot interrogate is a number somebody typed.
 *
 * Every value here is fixture-sourced, so every metric renders through
 * `<Metric>` with its provenance, and the health figures carry the
 * "demonstration - not a compliance record" watermark (charter #3, ADR-0022).
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { StatusBadge } from "@app/presentation/ui";
import { Metric } from "@app/presentation/metric";
import { FreshValue } from "@app/presentation/fresh-value";
import type { AccountVM, HouseholdDetailVM } from "./model";

const BAND_STATUS: Record<string, string> = {
  healthy: "proceed", watch: "blocked", "needs-attention": "rejected",
};
const PENDING_STATUS: Record<string, string> = {
  pending: "pending", settling: "in-flight", settled: "settled",
  blocked: "stuck", rejected: "rejected", cancelled: "voided",
};

function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {caption ? <p className="mt-0.5 text-sm text-slate-600">{caption}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function HealthPanel({ health }: { health: HouseholdDetailVM["health"] }) {
  return (
    <Section title="Health" caption={health.summary}>
      {/* ONE rendering of the score. The metric itself carries the large type,
          so the figure a reader sees is the figure that states its provenance -
          a big number beside a labeled copy of itself is two numbers. */}
      <div className="flex flex-wrap items-baseline gap-3 text-3xl">
        <Metric metric={health.score} />
        <StatusBadge status={BAND_STATUS[health.band] ?? "pending"} label={health.bandLabel} />
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {health.factors.map((factor) => (
          <li key={factor.id} className="rounded-md border border-slate-200 bg-surface p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">{factor.label}</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{factor.score.value}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={factor.band === "healthy" ? "h-full bg-green-600" : factor.band === "watch" ? "h-full bg-amber-500" : "h-full bg-red-600"}
                style={{ width: `${factor.score.value}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-slate-800">{factor.statement}</p>
            <p className="mt-1 text-xs text-slate-600">
              {factor.weightLabel} · read {factor.readRecords.join(", ")}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AccountCard({ account }: { account: AccountVM }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-slate-200 bg-surface p-4" data-account-card={account.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{account.title}</p>
          <p className="text-xs text-slate-600">
            {account.registrationLabel} · {account.taxClassLabel} · {account.custodian} {account.accountNumberMasked} · opened {account.openedOn}
          </p>
          <p className="text-xs text-slate-600">
            {account.modelPortfolio}
            {account.ownerNames.length > 0 ? ` · held by ${account.ownerNames.join(", ")}` : ""}
          </p>
        </div>
        <Metric metric={account.balance} />
      </div>
      {account.rebalanceLabel ? <p className="mt-2 text-xs text-amber-900">{account.rebalanceLabel}</p> : null}
      {account.beneficiaryNote ? <p className="mt-2 text-xs text-slate-800">{account.beneficiaryNote}</p> : null}
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="mt-3 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
      >
        {open ? "Hide" : "Show"} holdings, beneficiaries and signers
      </button>
      {open ? (
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Holdings</p>
            {/* Full width, one row per lot: three narrow columns turned a
                five-lot account into a wall of wrapped text. */}
            <ul className="mt-2 flex flex-col gap-2">
              {account.holdings.map((holding) => (
                <li key={holding.symbol} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 pb-2 text-xs text-slate-800 last:border-b-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{holding.symbol}</span> · {holding.description}
                    <span className="block text-slate-600">{holding.assetClassLabel} · {holding.units} units · {holding.unrealizedLabel}</span>
                  </span>
                  <Metric metric={holding.marketValue} />
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Beneficiaries</p>
            {account.beneficiaries.length === 0 ? (
              <p className="mt-2 text-xs text-slate-800">{account.beneficiaryEmptyLabel}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {account.beneficiaries.map((beneficiary) => (
                  <li key={`${beneficiary.tierLabel}-${beneficiary.displayName}`} className="text-xs text-slate-800">
                    <span className="font-medium text-slate-900">{beneficiary.displayName}</span> · {beneficiary.tierLabel}
                    <span className="block"><Metric metric={beneficiary.share} /></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Authorized signers</p>
            {account.signers.length === 0 ? (
              <p className="mt-2 text-xs text-slate-800">Only the owners may instruct this account.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {account.signers.map((signer) => (
                  <li key={signer.displayName} className="text-xs text-slate-800">
                    <span className="font-medium text-slate-900">{signer.displayName}</span> · {signer.authorityLabel}
                    <span className="block">{signer.effectiveLabel}</span>
                    {signer.lapsed ? <StatusBadge status="expired" label="Authority lapsed" /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function HouseholdDetail({ household }: { household: HouseholdDetailVM }) {
  return (
    <div className="flex flex-col gap-5" data-testid="household-detail">
      <div>
        <Link href="/app/households" className="text-sm text-slate-700 underline underline-offset-2 hover:text-slate-900">
          ← All households
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{household.displayName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <StatusBadge status={household.state === "active" ? "proceed" : "unknown"} label={household.stateLabel} />
          <span>{household.advisorLabel}</span>
          <span>· {household.city}</span>
          <span>· {household.serviceTierLabel}</span>
          <span>· {household.openedOn}</span>
          <span>· {household.authoringLabel}</span>
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-800">{household.narrative}</p>
        <p className="mt-2 text-sm text-slate-600">Total across all accounts: <Metric metric={household.totalBalance} /></p>
      </div>

      <HealthPanel health={household.health} />

      <Section title="People" caption="Who is in this household, and how they are related.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {household.people.map((person) => (
            <li key={person.key} className="rounded-md border border-slate-200 bg-surface p-3">
              <p className="text-sm font-medium text-slate-900">{person.displayName}</p>
              <p className="text-xs text-slate-600">{person.roleLabel} · {person.kindLabel}</p>
              {person.relationshipLabels.length > 0 ? (
                <p className="mt-1 text-xs text-slate-800">{person.relationshipLabels.join("; ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
        {household.entities.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {household.entities.map((entity) => (
              <li key={entity.key} className="rounded-md border border-slate-200 bg-surface p-3">
                <p className="text-sm font-medium text-slate-900">{entity.name}</p>
                <p className="text-xs text-slate-600">{entity.kindLabel} · formed {entity.formedOn} · controlled by {entity.controllerNames.join(", ")}</p>
                <p className="mt-1 text-xs text-slate-800">{entity.note}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Accounts" caption="Registration decides who may instruct an account and how a distribution is taxed.">
        <ul className="flex flex-col gap-3">
          {household.accounts.map((account) => <AccountCard key={account.key} account={account} />)}
        </ul>
      </Section>

      <Section title="Bank instructions" caption="Where money may go, and when each instruction was last independently verified.">
        <ul className="flex flex-col gap-3">
          {household.bankInstructions.map((instruction) => (
            <li key={instruction.key} className="rounded-md border border-slate-200 bg-surface p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                {instruction.label}
                <StatusBadge status={instruction.state === "current" ? "proceed" : "voided"} label={instruction.stateLabel} />
              </p>
              <p className="text-xs text-slate-600">Titled to {instruction.titledTo} · {instruction.accountTitles.join(", ")}</p>
              <p className="mt-1 text-xs text-slate-800">{instruction.statusStatement}</p>
              {instruction.supersedesLabel ? <p className="text-xs text-slate-800">{instruction.supersedesLabel}</p> : null}
            </li>
          ))}
        </ul>
        {household.bankInstructions.length === 0 ? (
          <p className="text-sm text-slate-800">No bank instruction is on file, so nothing can be distributed out of this household yet.</p>
        ) : null}
      </Section>

      <Section title="Instructions and restrictions" caption="What this household has told the firm it may and may not do.">
        {household.instructions.length === 0 ? (
          <p className="text-sm text-slate-800">No household-specific instruction is on file; only firm policy applies.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {household.instructions.map((instruction) => (
              <li key={instruction.key} className="rounded-md border border-slate-200 bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                  <StatusBadge status={instruction.polarity === "forbidden" ? "prohibited" : "submitted"} label={instruction.polarityLabel} />
                  {instruction.kindLabel} · {instruction.scopeLabel}
                </p>
                <p className="mt-1 text-sm text-slate-800">{instruction.text}</p>
                <p className="mt-1 text-xs text-slate-600">{instruction.sourceRef} · {instruction.effectiveLabel}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Money in motion" caption="Planned withdrawals and everything currently pending.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Planned withdrawals</p>
            {household.plannedWithdrawals.length === 0 ? (
              <p className="mt-2 text-sm text-slate-800">Nothing is scheduled to leave this household.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {household.plannedWithdrawals.map((withdrawal) => (
                  <li key={withdrawal.key} className="text-sm text-slate-800">
                    <Metric metric={withdrawal.monthly} /> monthly for {withdrawal.purpose}
                    <span className="block text-xs text-slate-600">{withdrawal.accountTitle} · {withdrawal.fromLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Pending</p>
            {household.pendingActions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-800">Nothing is in flight.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {household.pendingActions.map((action) => (
                  <li key={action.key} className="text-sm text-slate-800">
                    <span className="flex flex-wrap items-center gap-2">
                      <Metric metric={action.amount} />
                      <StatusBadge status={PENDING_STATUS[action.state] ?? "pending"} label={action.stateLabel} />
                    </span>
                    <span className="block text-xs text-slate-600">{action.kindLabel} · {action.accountTitle} · {action.expectedLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      {household.crossHouseholdLinks.length > 0 ? (
        <Section title="Touches another household" caption="Records here are not owned by this household alone.">
          <ul className="flex flex-col gap-3">
            {household.crossHouseholdLinks.map((link) => (
              <li key={`${link.counterpartyKey}/${link.kindLabel}`} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">{link.kindLabel}</p>
                <p className="mt-1 text-sm text-slate-900">{link.note}</p>
                <Link href={`/app/households/${link.counterpartyKey}`} className="mt-1 inline-block text-sm text-slate-800 underline underline-offset-2">
                  Open {link.counterpartyName}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Recent activity" caption="What has happened on this household lately.">
        <ul className="flex flex-col gap-3">
          {household.activity.map((entry) => (
            <li key={entry.key} className="border-l-2 border-slate-200 pl-3">
              <p className="text-sm text-slate-900">{entry.summary}</p>
              <p className="text-xs text-slate-600">{entry.occurredLabel} · {entry.kindLabel} · {entry.actorLabel}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Evidence behind this page" caption="Nothing above is newer than the observation it came from.">
        <ul className="flex flex-col gap-2">
          {household.evidenceLines.map((line) => (
            <li key={line.label} className="text-sm text-slate-800">
              <FreshValue provenance={line.provenance}>{line.label}</FreshValue>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
