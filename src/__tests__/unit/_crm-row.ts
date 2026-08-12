import type { Household } from "@domain/schema/entities";
import type { WorldHousehold } from "@domain/world/household-world";

/**
 * The house-CRM row a seeded world household projects to. Shared because the
 * household surfaces now take IDENTITY from the record store and DEPTH from the
 * evidence port, so every test of those surfaces needs both halves - and four
 * private copies of this literal would let four tests disagree about what the
 * CRM says while the code under test cannot.
 */
export const crmRowFor = (household: WorldHousehold, name?: string): Household => ({
  id: household.id,
  orgId: "org-household-tests",
  name: name ?? household.displayName,
  primaryContactId: null,
  advisorUserId: null,
  status: "active",
  createdAt: household.provenance.asOf,
  provenance: household.provenance,
});
