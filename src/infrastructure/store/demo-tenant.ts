/**
 * THE DEMONSTRATION TENANT'S IDENTITY, named ONCE (ADR-0057, D-219).
 *
 * Two places have to agree on "which org, and which users, are the
 * demonstration ones": the seed that WRITES them (`scripts/seed-demo-store.ts`,
 * which names their `record_origin` at the insert) and the corrective migration
 * that RE-STAMPS them on a store seeded before that insert named anything
 * (version 11 in `record-origin-migration.ts`). A second copy would let the two
 * drift, and a repair keyed on an org id the seed no longer writes repairs
 * nothing while reporting success - the failure mode this whole column exists to
 * prevent, one level up.
 *
 * It lives here rather than beside the seed because a shipped migration cannot
 * import from `scripts/`: the store runs it, and `scripts/` is build-time
 * tooling that no deployment carries.
 *
 * Emails are stored NORMALIZED - `createUser` trims and lowercases before the
 * INSERT - so these literals are the bytes actually in the column, which is what
 * lets the migration compare against them directly.
 */
import type { PIIBearing } from "@contracts/pii";
import type { Role } from "@contracts/roles";

/** The demonstration firm every seeded row belongs to. */
export const DEMO_ORG_ID = "org-verin-demo";

/** PIIBearing: the fields are a raw email and display name, and the marker is
 * structural rather than a claim about these particular values - a shape the
 * LLM boundary must never ingest stays refused whatever is in it. */
export interface DemoUser extends PIIBearing {
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
}

/**
 * The demonstration accounts, and ONLY those. They carry a publicly committed
 * password (ADR-0020), which is exactly why they must count as demonstration
 * records - and why the list is these two rather than "everybody in the demo
 * org": a developer's own account in that org is a real record, and sweeping it
 * into the purge is the same false claim in the other direction.
 */
export const DEMO_USERS: readonly DemoUser[] = [
  { email: "principal@verin.test", displayName: "Priya Nair (Principal)", role: "principal" },
  { email: "advisor@verin.test", displayName: "Alex Rivera (Advisor)", role: "advisor" },
];
