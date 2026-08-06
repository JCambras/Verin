/**
 * Vacuity verdict shared by the decision-ledger operator gates (charter #4, D-116).
 *
 * Prompt 7 deliberately ships the post-decision append surface UNWIRED, so a real
 * deployment holds zero `decision_ledger` rows by design until a later prompt lands a
 * producer. The restore runbook points operators at these same scripts under RTO
 * pressure, where an exit(1) reads as a corrupted chain. Dev/CI runs them against a
 * store SEEDED in the same job, where an empty ledger instead means the seed never ran.
 *
 * Emptiness is therefore only honest where it is the ratified design; rows that exist
 * but were never covered are vacuous in EVERY environment - that is the failure the
 * guard exists for, so it stays fail-closed there.
 */
import type { Config } from "../src/infrastructure/config";

export type LedgerVacuity = "covered" | "empty-by-design" | "vacuous";

export function decisionLedgerVacuity(
  appEnv: Config["appEnv"],
  rowsPresent: number,
  rowsCovered: number,
): LedgerVacuity {
  if (rowsPresent > 0) return rowsCovered > 0 ? "covered" : "vacuous";
  return appEnv === "development" ? "vacuous" : "empty-by-design";
}
