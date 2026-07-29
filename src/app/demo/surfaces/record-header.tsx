import { Wordmark } from "@app/presentation/brand";
import type { RecordVM } from "../model";
import { PrintButton } from "./print-button";

export function RecordHeader({ vm }: { vm: RecordVM }) {
  return (
    <header className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4 print-avoid-break">
      <p className="flex flex-wrap items-center gap-2">
        <Wordmark className="text-lg" />
        {vm.header.watermark ? (
          <span
            className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900"
            data-testid="record-watermark"
          >
            {vm.header.watermark}
          </span>
        ) : null}
      </p>
      <dl
        className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2"
        data-testid="record-context"
      >
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">Decision id</dt>
          <dd
            className="font-mono text-xs break-all text-slate-800"
            data-testid="record-decision-id"
          >
            {vm.header.decisionId}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">Created</dt>
          <dd className="text-slate-800">
            <time
              dateTime={vm.header.createdAtIso}
              data-event-instant={vm.header.createdAtIso}
            >
              {vm.header.createdAt}
            </time>
          </dd>
        </div>
        {vm.decisionBindings.map((binding) => {
          const qualifier =
            vm.decisionBindings.length === 1
              ? ""
              : binding.kind === "original"
                ? "Original "
                : "Derived ";
          const bundleQualifier =
            vm.decisionBindings.length === 1
              ? ""
              : binding.kind === "original"
                ? "Original "
                : "Refreshed ";
          return (
            <div
              key={binding.kind}
              className="flex flex-col sm:col-span-2"
              data-testid="decision-binding"
              data-binding-kind={binding.kind}
            >
              <dt className="text-xs text-slate-600">
                {qualifier}decision hash
              </dt>
              <dd className="font-mono text-xs break-all text-slate-800">
                {binding.decisionHash}
              </dd>
              <dt className="mt-1 text-xs text-slate-600">
                {bundleQualifier}input-bundle hash
              </dt>
              <dd className="font-mono text-xs break-all text-slate-800">
                {binding.bundleHash}
              </dd>
            </div>
          );
        })}
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">Scenario</dt>
          <dd className="font-mono text-xs break-all text-slate-800">
            {vm.header.scenarioId}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">Firm</dt>
          <dd className="font-mono text-xs break-all text-slate-800">
            {vm.header.firmId}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">Signed case</dt>
          <dd className="font-mono text-xs break-all text-slate-800">
            {vm.header.sourceCaseId ?? "No exact signed case"}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">Lifecycle pass</dt>
          <dd className="font-mono text-xs text-slate-800">
            {vm.header.pass}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">Policy version</dt>
          <dd className="font-mono text-xs text-slate-800">
            {vm.hashes.policyVersion}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-slate-600">
            Household instructions
          </dt>
          <dd className="font-mono text-xs text-slate-800">
            {vm.hashes.instructionVersion}
          </dd>
        </div>
        <div className="flex flex-col sm:col-span-2">
          <dt className="text-xs text-slate-600">Audit-chain position</dt>
          <dd className="font-mono text-xs text-slate-800">
            {vm.hashes.auditPosition}
          </dd>
        </div>
      </dl>
      <PrintButton />
    </header>
  );
}
