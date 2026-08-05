import { pendingActionLiquidityTreatment } from "./pending-actions";

interface SyntheticPendingCase {
  request: { householdRef: string; selectedFundingRefs: string[] };
  records: {
    accounts: Array<{ id: string; householdRef: string }>;
    pendingActions: Array<{
      id: string;
      householdRef: string;
      accountRef: string;
      kind: Parameters<typeof pendingActionLiquidityTreatment>[0];
      state: Parameters<typeof pendingActionLiquidityTreatment>[1];
    }>;
    modelAssignments: Array<{
      id: string; accountRef: string; pendingRebalance: boolean;
    }>;
  };
}

export const selectedCitedPendingActions = <T extends SyntheticPendingCase>(
  item: T,
  citedActions: ReadonlySet<string>,
): T["records"]["pendingActions"] => {
  const selected = new Set(item.request.selectedFundingRefs);
  return item.records.pendingActions.filter((row) =>
    citedActions.has(row.id) &&
    row.householdRef === item.request.householdRef &&
    selected.has(row.accountRef) &&
    item.records.accounts.filter(
      (account) =>
        account.id === row.accountRef &&
        account.householdRef === item.request.householdRef,
    ).length === 1
  );
};

export const syntheticPendingContext = (
  item: SyntheticPendingCase,
  citedActions: ReadonlySet<string>,
  citedModels: ReadonlySet<string>,
): boolean => {
  const selected = new Set(item.request.selectedFundingRefs);
  return selectedCitedPendingActions(item, citedActions).some((row) =>
    !pendingActionLiquidityTreatment(row.kind, row.state)
      .reducesEffectiveLiquidity
  ) || item.records.modelAssignments.some(
    (row) =>
      citedModels.has(row.id) &&
      row.pendingRebalance &&
      selected.has(row.accountRef) &&
      item.records.accounts.filter(
        (account) =>
          account.id === row.accountRef &&
          account.householdRef === item.request.householdRef,
      ).length === 1,
  );
};
