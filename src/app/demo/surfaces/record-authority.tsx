import { Metric } from "@app/presentation/metric";
import type { RecordVM } from "../model";

export function RecordAuthority({
  authority,
  notReached,
}: {
  authority: RecordVM["authority"];
  notReached: string;
}) {
  if (authority === null) {
    return <p className="text-sm text-slate-600">{notReached}</p>;
  }
  if (authority.mode === "automatic") {
    return (
      <div
        className="flex flex-col gap-2 print-avoid-break"
        data-testid="record-automatic-authority"
      >
        <p className="text-sm font-medium text-slate-800">
          {authority.summary}
        </p>
        <p className="text-sm text-slate-700">{authority.detail}</p>
        <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-600">
              Dual-approval threshold
            </dt>
            <dd className="text-slate-800">
              <Metric metric={authority.threshold} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Policy source</dt>
            <dd className="break-all font-mono text-xs text-slate-800">
              {authority.policySource}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Execution mode</dt>
            <dd className="text-slate-800">{authority.executionMode}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">
              Resulting authority state
            </dt>
            <dd className="text-slate-800">{authority.state}</dd>
          </div>
        </dl>
        <p className="text-sm text-slate-700">{authority.rule}</p>
      </div>
    );
  }
  return authority.stages.map((stage) => (
    <div
      key={stage.title}
      className="flex flex-col gap-1 print-avoid-break"
    >
      <p className="text-sm font-medium text-slate-800">{stage.title}</p>
      <p className="text-sm text-slate-600">{stage.requirement}</p>
      <ul className="flex flex-col gap-1">
        {stage.actors.map((actor) => (
          <li
            key={actor.name}
            className={`text-sm ${
              actor.status === "voided"
                ? "text-slate-800"
                : "text-slate-700"
            }`}
            style={
              actor.status === "voided" ? { opacity: 0.7 } : undefined
            }
          >
            {actor.name} · {actor.role}:{" "}
            {actor.requesterExcluded
              ? (actor.note ?? actor.statusLabel)
              : actor.statusLabel}
          </li>
        ))}
      </ul>
      {stage.expiry || stage.escalation ? (
        <p className="text-xs text-slate-600">
          {stage.expiry}
          {stage.expiry && stage.escalation ? " · " : ""}
          {stage.escalation}
        </p>
      ) : null}
    </div>
  ));
}
