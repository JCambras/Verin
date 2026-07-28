import type { SetupActivatedSnapshotVM } from "./setup-model";

const shared = globalThis as typeof globalThis & {
  __verinSetupActivationSnapshots?: Map<string, SetupActivatedSnapshotVM>;
};

function snapshots(): Map<string, SetupActivatedSnapshotVM> {
  shared.__verinSetupActivationSnapshots ??= new Map();
  return shared.__verinSetupActivationSnapshots;
}

export function registerActivatedSetupSnapshot(
  snapshot: SetupActivatedSnapshotVM,
): void {
  snapshots().set(snapshot.snapshotHash, snapshot);
}

export function activatedSetupSnapshot(
  snapshotHash: string,
): SetupActivatedSnapshotVM | null {
  return snapshots().get(snapshotHash) ?? null;
}
