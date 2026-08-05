import { StatusBadge } from "@app/presentation/ui";
import type { ActivatedConfigurationRecordVM } from "../model";

export function RecordActivatedConfiguration({
  configuration,
}: {
  configuration: ActivatedConfigurationRecordVM;
}) {
  return (
    <>
      <div className="flex flex-col">
        <dt className="text-xs text-slate-600">Activated snapshot version</dt>
        <dd className="break-all font-mono text-xs text-slate-800" data-testid="record-identity-snapshot-version">
          {configuration.snapshotVersion}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-slate-600">Configuration provenance</dt>
        <dd className="flex flex-col items-start gap-1 text-xs text-slate-800">
          <StatusBadge
            status={configuration.configurationPostureStatus}
            label={configuration.configurationPostureLabel}
          />
          <span data-testid="record-identity-configuration-provenance">
            {configuration.configurationProvenance}
          </span>
        </dd>
      </div>
      <div className="flex flex-col sm:col-span-2">
        <dt className="text-xs text-slate-600">Activated snapshot hash</dt>
        <dd className="break-all font-mono text-xs text-slate-800" data-testid="record-identity-snapshot-hash">
          {configuration.snapshotHash}
        </dd>
      </div>
      <div className="flex flex-col sm:col-span-2">
        <dt className="text-xs text-slate-600">Configuration hash</dt>
        <dd className="break-all font-mono text-xs text-slate-800" data-testid="record-identity-configuration-hash">
          {configuration.configurationHash}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-slate-600">
          Configured standard-approval role
        </dt>
        <dd
          className="text-xs text-slate-800"
          data-testid="record-identity-standard-approval-role"
        >
          {configuration.standardApprovalRole === "operations"
            ? "Operations"
            : "None configured for this authority mode"}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-slate-600">Requester participation</dt>
        <dd
          className="text-xs text-slate-800"
          data-testid="record-identity-requester-participation"
        >
          {configuration.requesterParticipation === "unbound"
            ? "Unbound in this demonstration"
            : "Requester excluded"}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-slate-600">Authenticated activation actor</dt>
        <dd className="break-all font-mono text-xs text-slate-800" data-testid="record-identity-activation-actor">
          {configuration.activationActorId}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-slate-600">Authenticated role</dt>
        <dd className="text-xs text-slate-800">
          {configuration.activationActorRole}
        </dd>
      </div>
      <div className="flex flex-col sm:col-span-2">
        <dt className="text-xs text-slate-600">Demonstration acknowledgment</dt>
        <dd className="text-xs text-slate-800">
          {configuration.attestationStatement}
        </dd>
      </div>
      <div className="flex flex-col sm:col-span-2">
        <dt className="text-xs text-slate-600">Attestation statement version</dt>
        <dd className="break-all font-mono text-xs text-slate-800">
          {configuration.attestationStatementVersion}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-xs text-slate-600">Acknowledged draft generation</dt>
        <dd className="font-mono text-xs text-slate-800">
          {configuration.attestedDraftGeneration}
        </dd>
      </div>
      <div className="flex flex-col sm:col-span-2">
        <dt className="text-xs text-slate-600">Acknowledged selections hash</dt>
        <dd className="break-all font-mono text-xs text-slate-800">
          {configuration.attestedSelectionsHash}
        </dd>
      </div>
      <div className="flex flex-col sm:col-span-2">
        <dt className="text-xs text-slate-600">Acknowledged setup version digest</dt>
        <dd className="break-all font-mono text-xs text-slate-800">
          {configuration.attestedSetupVersionDigest}
        </dd>
      </div>
    </>
  );
}
