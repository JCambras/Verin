import type {
  AuthorityStageInstanceVM,
  AuthorityStageRequirementVM,
} from "../model";

function requesterEligibility(
  value: AuthorityStageRequirementVM["requesterMayApprove"],
): string {
  if (value === "unbound") {
    return "Awaiting captain decision";
  }
  return value ? "Eligible" : "Ineligible";
}

export function AuthorityRequirementDetails({
  requirement,
  instance,
}: {
  requirement: AuthorityStageRequirementVM;
  instance: AuthorityStageInstanceVM;
}) {
  return (
    <section
      aria-label={`Authority requirement ${requirement.stageId}`}
      className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-3"
      data-testid={`authority-requirement-${requirement.stageId}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
        Original decision requirement
      </p>
      <dl className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-slate-600">Stage identity</dt>
          <dd className="break-all font-mono text-slate-800">
            {requirement.order} · {requirement.stageId}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Execution and roles</dt>
          <dd className="text-slate-800">
            {requirement.executionMode} ·{" "}
            {requirement.eligibleRoleIds.join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Quorum</dt>
          <dd className="text-slate-800">
            {requirement.approvalsRequired} approval
            {requirement.approvalsRequired === 1 ? "" : "s"} ·{" "}
            {requirement.distinctActorsRequired
              ? "distinct actors required"
              : "actor distinctness not required"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Requester eligibility</dt>
          <dd className="text-slate-800">
            {requesterEligibility(
              requirement.requesterMayApprove,
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-600">Expiration rule</dt>
          <dd className="break-all font-mono text-slate-800">
            <time dateTime={requirement.expiresAfter}>
              {requirement.expiresAfter}
            </time>
            {" after this stage arms"}
          </dd>
        </div>
      </dl>
      <div className="mt-2">
        <p className="text-xs text-slate-600">Escalation path</p>
        <ol className="mt-1 flex flex-col gap-1">
          {requirement.escalationPath.map((step) => (
            <li
              key={`${step.after}:${step.reasonCode}`}
              className="break-words font-mono text-xs text-slate-800"
            >
              {step.after} · {step.eligibleRoleIds.join(", ")} ·{" "}
              {step.reasonCode}
            </li>
          ))}
        </ol>
      </div>
      <div
        className="mt-2 rounded border border-slate-200 bg-surface p-2"
        data-testid={`authority-instance-${requirement.stageId}`}
      >
        <p className="text-xs text-slate-600">Stage instance</p>
        {instance.mode === "armed" ? (
          <dl className="mt-1 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-600">Instance identity</dt>
              <dd className="break-all font-mono text-slate-800">
                {instance.instanceId}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Source requirement</dt>
              <dd className="break-all font-mono text-slate-800">
                {instance.sourceStageId}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Armed at</dt>
              <dd className="break-all font-mono text-slate-800">
                <time dateTime={instance.activatedAt}>
                  {instance.activatedAt}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Expires at</dt>
              <dd className="break-all font-mono text-slate-800">
                <time dateTime={instance.expiresAt}>
                  {instance.expiresAt}
                </time>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-1 text-xs text-slate-800">
            Not armed. Its expiration clock starts only after the
            prerequisite stage completes.
          </p>
        )}
      </div>
    </section>
  );
}
