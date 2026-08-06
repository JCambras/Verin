function selectedFundingAccounts<T>(
  selectedRefs: readonly string[],
  accounts: readonly T[],
  accountRef: (account: T) => string,
): T[] {
  const selected = new Set(selectedRefs);
  return accounts.filter((account) => selected.has(accountRef(account)));
}

export function selectedFundingHasTaxClass<
  T extends { taxClass: string },
>(
  selectedRefs: readonly string[],
  accounts: readonly T[],
  accountRef: (account: T) => string,
  taxClass: string,
): boolean {
  return selectedFundingAccounts(
    selectedRefs,
    accounts,
    accountRef,
  ).some((account) => account.taxClass === taxClass);
}
