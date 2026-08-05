import type { AuthorityStageRequirementVM } from "../model";

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
}: {
  requirement: AuthorityStageRequirementVM;
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
          <dt className="text-slate-600">Expires at</dt>
          <dd className="break-all font-mono text-slate-800">
            <time dateTime={requirement.expiresAt}>
              {requirement.expiresAt}
            </time>
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
    </section>
  );
}
