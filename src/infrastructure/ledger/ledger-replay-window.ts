import type { LedgerEntry } from "@contracts/decision-core/ledger";
import type { RecordProvenance } from "@contracts/provenance";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import type {
  ReplaySourceOrigins,
  ReplaySourceOriginSequences,
} from "./ledger-source-provenance";

export function verifiedReplayWindowOrigins(
  tenant: TenantContext,
  entries: readonly {
    readonly event: LedgerEntry;
    readonly sequence: number;
    readonly provenance: RecordProvenance;
  }[],
  decisionBundleIds: ReadonlyMap<string, string>,
  sequences: ReplaySourceOriginSequences,
): ReplaySourceOrigins {
  assertTenantContext(tenant);
  const bySequence = new Map(entries.map((entry) => [entry.sequence, entry]));
  const snapshots = new Map<string, RecordProvenance>();
  for (const [id, sequence] of sequences.snapshots) {
    const entry = bySequence.get(sequence);
    if (
      entry?.event.type === "EvidenceSnapshotRecorded" &&
      entry.event.evidenceSnapshotRef.id === id
    ) snapshots.set(id, entry.provenance);
  }
  const bundles = new Map<string, RecordProvenance>();
  for (const [id, sequence] of sequences.bundles) {
    const entry = bySequence.get(sequence);
    if (
      entry?.event.type === "DecisionRecorded" &&
      decisionBundleIds.get(entry.event.decisionRef.id) === id
    ) bundles.set(id, entry.provenance);
  }
  return { snapshots, bundles };
}
