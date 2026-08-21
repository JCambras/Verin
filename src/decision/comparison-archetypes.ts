// The two ratified firm-policy archetypes (the demo contract's matrix re-expressions - the exact
// bytes the seed publishes to each firm's shelf; byte-agreement with the seed is asserted by test).
// The comparison surface evaluates the SAME request and the SAME evidence bundle under both,
// side by side: different answers, both correct, from configuration alone. These are committed
// demonstration configurations and every rendering of them is labelled as such (charter #3);
// neither is read across a tenant boundary - a firm's own shelf stays behind RLS.
export const COMPARISON_ARCHETYPES = [
  {
    label: "Firm A archetype (six-month reserve, $25,000 dual-approval threshold, specialist review)",
    document: `{"reserveHorizonMonths":6,"dualApproval":{"thresholdUsd":25000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`,
  },
  {
    label: "Firm B archetype (twelve-month reserve, $100,000 threshold, block until verified, both contract silences)",
    document: `{"reserveHorizonMonths":12,"dualApproval":{"thresholdUsd":100000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"not-stated","requesterRule":"not-stated"},"bankInstructionChange":"block-until-independently-verified","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`,
  },
] as const;
