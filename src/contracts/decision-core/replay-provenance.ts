import type { DecisionRecord } from "./decision";
import type { DecisionInputBundle } from "./evidence";
import {
  deriveArtifactProvenance,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";

function latestAsOf(
  inputs: readonly RecordProvenance[],
  fallback: string,
): string {
  return inputs.reduce(
    (latest, input) => input.asOf > latest ? input.asOf : latest,
    fallback,
  );
}

export function deriveDecisionReplayProvenance(
  bundle: DecisionInputBundle,
  record: DecisionRecord,
  snapshotOrigins: readonly RecordProvenance[],
  bundleOrigin: RecordProvenance,
  decisionOrigin: RecordProvenance,
): DerivedProvenance {
  const bundleInputs = [...snapshotOrigins, bundleOrigin];
  const bundleProvenance = deriveArtifactProvenance(
    bundleInputs,
    latestAsOf(bundleInputs, bundle.asOf),
  );
  const decisionInputs = [bundleProvenance, decisionOrigin];
  return deriveArtifactProvenance(
    decisionInputs,
    latestAsOf(decisionInputs, record.createdAt),
  );
}
