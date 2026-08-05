import type { RearmedAuthorityStageVM } from "../model";

export function RearmedAuthorityStage({
  stage,
}: {
  stage: RearmedAuthorityStageVM;
}) {
  return (
    <section
      aria-label="Current re-armed authority stage"
      className="rounded-md border border-amber-200 bg-amber-50 p-3"
      data-testid="rearmed-authority-stage"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-amber-900">
        Current re-armed stage
      </p>
      <dl className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-amber-900">Stage instance</dt>
          <dd className="break-all font-mono text-amber-900">
            {stage.instanceId}
          </dd>
        </div>
        <div>
          <dt className="text-amber-900">Source decision stage</dt>
          <dd className="break-all font-mono text-amber-900">
            {stage.sourceStageId}
          </dd>
        </div>
        <div>
          <dt className="text-amber-900">Current eligible roles</dt>
          <dd className="font-mono text-amber-900">
            {stage.eligibleRoleIds.join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-amber-900">Activation reason</dt>
          <dd className="break-all font-mono text-amber-900">
            {stage.reasonCode}
          </dd>
        </div>
        <div>
          <dt className="text-amber-900">Re-armed at</dt>
          <dd className="break-all font-mono text-amber-900">
            <time dateTime={stage.activatedAt}>{stage.activatedAt}</time>
          </dd>
        </div>
        <div>
          <dt className="text-amber-900">Fresh expiry</dt>
          <dd className="break-all font-mono text-amber-900">
            <time dateTime={stage.expiresAt}>{stage.expiresAt}</time>
          </dd>
        </div>
      </dl>
    </section>
  );
}
