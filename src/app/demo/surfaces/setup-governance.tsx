"use client";

import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { StatusBadge } from "@app/presentation/ui";
import { DEV_BADGE_TEXT } from "../model";
import type { MoneyMovementSetupVM } from "../setup-model";
import { CategoryLabel, DemoNotice } from "./setup-shared";

export function ProfilesBody({ vm }: { vm: MoneyMovementSetupVM }) {
  return (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        {vm.profiles.map((profile) => (
          <article
            key={profile.firmId}
            className="min-w-0 rounded-lg border border-slate-200 bg-white p-5"
            data-testid={`profile-${profile.firmId}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{profile.firmLabel}</h2>
              <StatusBadge status="pending" label="New draft" />
            </div>
            <p className="mt-1 text-sm font-medium text-slate-800">{profile.name}</p>
            <p className="mt-2 text-sm text-slate-600">{profile.description}</p>
            <dl className="mt-4 grid gap-2 text-sm">
              <div>
                <dt className="text-xs text-slate-600">Draft identity</dt>
                <dd className="break-all font-mono text-xs text-slate-800">{profile.draftVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-600">Current active version</dt>
                <dd className="break-all font-mono text-xs text-slate-800">{profile.activeVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-600">Last human approval</dt>
                <dd className="text-sm text-slate-800">{profile.lastApproval}</dd>
              </div>
            </dl>
            <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <DevProvenanceBadge label={DEV_BADGE_TEXT[profile.fakeClass]} />
              Demonstration profile
            </p>
          </article>
        ))}
      </div>
      <DemoNotice
        vm={vm}
        text="Drafts in this replacement are presentation-only. Nothing here governs a production request until the real policy lifecycle lands."
      />
    </>
  );
}

export function ControlsBody({ vm }: { vm: MoneyMovementSetupVM }) {
  return (
    <>
      <section aria-labelledby="universal-safety-title" className="flex flex-col gap-3">
        <div>
          <CategoryLabel>Universal safety</CategoryLabel>
          <h2 id="universal-safety-title" className="mt-2 text-base font-semibold text-slate-900">
            Required guarantees
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            These controls have accountable proof, but no firm administrator receives an off switch.
          </p>
        </div>
        <ol className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {vm.controls.map((control, index) => (
            <li key={control.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  {index + 1}. {control.title}
                </p>
                <StatusBadge status="done" label="Required" />
              </div>
              <p className="mt-2 text-sm text-slate-600">{control.description}</p>
              <p className="mt-2 text-xs text-slate-700">
                <span className="font-medium">Proof:</span> {control.proof}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="accountable-roles-title" className="flex flex-col gap-3">
        <div>
          <CategoryLabel>Accountable roles</CategoryLabel>
          <h2 id="accountable-roles-title" className="mt-2 text-base font-semibold text-slate-900">
            Named responsibility
          </h2>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {vm.roles.map((role) => (
            <article key={role.responsibility} className="min-w-0 rounded-lg border border-slate-200 bg-surface p-4">
              <h3 className="text-sm font-semibold text-slate-900">{role.responsibility}</h3>
              <dl className="mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="text-xs font-medium text-slate-600">Firm A</dt>
                  <dd className="text-slate-800">{role.firmA}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-600">Firm B</dt>
                  <dd className="text-slate-800">{role.firmB}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-slate-600">{role.rule}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export function PostureBody({ vm }: { vm: MoneyMovementSetupVM }) {
  return (
    <>
      <section aria-labelledby="baseline-title" className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CategoryLabel>Firm policy starting posture</CategoryLabel>
            <h2 id="baseline-title" className="mt-2 text-base font-semibold text-slate-900">
              Conservative baseline
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              A draft shortcut, not legal advice or an industry claim. Every exact value stays visible through review.
            </p>
          </div>
          <StatusBadge status="done" label="Recommended" />
        </div>
        <dl className="mt-5 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {vm.baseline.map((value) => (
            <div key={value.label} className="min-w-0 rounded-md border border-slate-200 bg-surface p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-600">{value.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{value.value}</dd>
              {value.detail ? <dd className="mt-1 text-xs text-slate-600">{value.detail}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="ownership-boundaries-title" className="flex flex-col gap-3">
        <h2 id="ownership-boundaries-title" className="text-base font-semibold text-slate-900">
          What this setup does not own
        </h2>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
          <article className="rounded-lg border border-slate-200 bg-surface p-4">
            <CategoryLabel>Household instruction</CategoryLabel>
            <p className="mt-2 text-sm text-slate-700">
              Withdrawal schedules, destination restrictions, and bank verification stay with the household record.
            </p>
          </article>
          <article className="rounded-lg border border-slate-200 bg-surface p-4">
            <CategoryLabel>Regulatory or product constraint</CategoryLabel>
            <p className="mt-2 text-sm text-slate-700">
              Legal holds, disposition structure, immutable versions, and provenance refusal cannot become preferences.
            </p>
          </article>
          <article className="rounded-lg border border-slate-200 bg-surface p-4">
            <CategoryLabel>Adapter fact</CategoryLabel>
            <p className="mt-2 text-sm text-slate-700">
              Channels and status meanings come from verified capabilities. Administrators cannot invent support.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
