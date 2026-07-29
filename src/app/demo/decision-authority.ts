import type { AuthorityPlanVM } from "./model";
import type { FirmData, ScenarioData } from "./data";
import { buildAuthorityPlan } from "./build-decision";

export function buildDecisionAuthorityPlan(
  scenario: ScenarioData,
  firm: FirmData,
): AuthorityPlanVM {
  return buildAuthorityPlan(
    {
      ...scenario,
      spec: {
        ...scenario.spec,
        invalidation: false,
        specialistExpired: false,
      },
    },
    firm,
    "gate",
  );
}
