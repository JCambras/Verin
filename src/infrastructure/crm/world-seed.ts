/**
 * POPULATED-WORLD CRM PROJECTION (ADR-0057).
 *
 * Loads the generated world's households, their people, and their open items
 * into the house CRM so no product surface renders empty in development. Rows
 * land labeled `prov_source = 'fixture'` - NOT `verin-crm` - because that is
 * what the VALUES are (charter #3).
 *
 * They also land with `record_origin = 'world-fixture'`, which is a DIFFERENT
 * fact: where the ROW came from. The clean-slate guarantee is counted off the
 * origin, because value provenance moves the moment an advisor edits a value and
 * the row is still a demonstration record afterwards - a purge keyed on
 * `prov_source` would leave a renamed household behind in production.
 *
 * What is DELIBERATELY not projected: financial accounts and their positions.
 * An account in the house CRM is the OUTPUT of the account-opening flow, minted
 * with the open date its e-signature carries; custodial positions, beneficiary
 * designations, and bank instructions are EVIDENCE that arrives through the
 * evidence port (`HouseholdWorldSource`), not records this firm owns. Seeding
 * them here would put rows in the store that no flow produced and no custodian
 * confirmed - the "shadow world" the charter's DO-NOT-PORT list names.
 *
 * One audited write covers the whole load: it is one operation, and one entry
 * carrying honest counts - rows WRITTEN, never rows offered - is a better audit
 * record than five thousand.
 */
import type { SqlDb, SqlTx } from "@infra/store/db";
import { auditedWrite } from "@infra/audit/audited-write";
import { assertWriteActor, type WriteActor } from "@contracts/principal";
import { appError } from "@contracts/errors";
import type { Result } from "@contracts/result";
import type { WorldHousehold } from "@domain/world/household-world";
import { WORLD_FIXTURE_ORIGIN } from "@infra/store/record-origin";

/** Rows this call actually WROTE, never rows offered. Every insert is
 * `ON CONFLICT DO NOTHING` on ids derived from the world seed, so they are the
 * same ids in every org: a second firm seeding the same world conflicts on every
 * key and writes nothing. Reporting the input length there would book an audit
 * entry claiming a load that never happened. */
export interface WorldSeedCounts {
  readonly households: number;
  readonly contacts: number;
  readonly tasks: number;
}

/** Rows carry the world's own observation instant, so a seeded record's
 * provenance is the evidence date rather than the moment the seed ran. */
const FIXTURE_CONFIDENCE = "medium";

/** A display name split into the store's two columns. A single-token name keeps
 * the whole token as the family name rather than inventing an empty one. */
function splitName(displayName: string): { first: string; last: string } {
  const parts = displayName.trim().split(/\s+/);
  return parts.length === 1
    ? { first: "", last: parts[0]! }
    : { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

/** The open items a person has to clear, projected as real CRM tasks so the
 * work surfaces are populated by the same facts the health breakdown reads. */
function openItemTasks(household: WorldHousehold): { id: string; subject: string; createdAt: string }[] {
  const tasks: { id: string; subject: string; createdAt: string }[] = [];
  for (const instruction of household.bankInstructions) {
    if (instruction.state !== "current" || instruction.verifiedAt !== null) continue;
    tasks.push({
      id: instruction.id,
      subject: `Independently verify the ${instruction.bank} ····${instruction.lastFour} instruction`,
      createdAt: instruction.changedAt ?? instruction.observedAt,
    });
  }
  for (const action of household.pendingActions) {
    if (action.state !== "blocked" && action.state !== "rejected") continue;
    tasks.push({
      id: action.id,
      subject: `Clear the ${action.state} ${action.kind.replace(/-/g, " ")} on ${household.displayName}`,
      createdAt: action.createdAt,
    });
  }
  return tasks;
}

/**
 * The CONDITION this refuses is a conflicting household owned by ANOTHER org -
 * never the symptom that shares it. World record ids are derived from the world
 * seed, so they are the same bytes in every org: the FIRST org to load a world
 * takes those ids, and every later firm's insert conflicts away to nothing.
 * Returning `ok` there hands a second firm a household directory that renders
 * empty with no explanation - the worst available outcome for a product whose
 * headline claim is that another firm differs only by configuration. Making a
 * second firm actually receive its own copy needs org-scoped identifiers, a
 * schema-shaped change recorded as follow-up `fu-world-org-scoped-ids`; until it
 * lands this refuses instead of pretending.
 *
 * The SAME org re-offered a world it already holds is the ordinary development
 * loop - regenerating the world keeps every id and changes only the digest, so
 * the load runs again and conflicts away to nothing - and it writes whatever is
 * genuinely new. Keying on "wrote nothing" broke that on the next regeneration
 * anyone made, and pointed the reader at a follow-up that was not the remedy.
 */
async function conflictingIdsNotHeldBy(
  tx: SqlTx,
  orgId: string,
  offeredIds: readonly string[],
): Promise<string[]> {
  // Asked inside this org's scope: reading another tenant's row to name its
  // owner would widen a tenant-isolation escape for a diagnostic. A row that
  // exists (the insert conflicted) and is not in this org's book is held by
  // some other org, which is all this needs to know. ONE statement, because the
  // ordinary case this runs on is a re-offered world that conflicts on every
  // household: a per-id probe is a hundred sequential round-trips on a
  // connection that serializes them, inside the seed's own transaction.
  const mine = await tx.query<{ id: string }>(
    "SELECT id FROM households WHERE id = ANY($1::text[]) AND org_id = $2",
    [[...offeredIds], orgId],
  );
  const held = new Set(mine.rows.map((row) => row.id));
  return offeredIds.filter((id) => !held.has(id));
}

function collisionRefusal(orgId: string, foreign: readonly string[], offered: number): never {
  throw appError(
    "CONFLICT",
    `world seed refused: ${foreign.length} of the ${offered} household id(s) offered to org ${orgId} already exist and are held by an org other than ${orgId}`
    + ` (${foreign.slice(0, 3).join(", ")}${foreign.length > 3 ? ", ..." : ""}), which loaded this world first.`
    + " World record ids are derived from the world seed rather than scoped to an org, so only the first org to load a world receives it."
    + " Reporting success here would leave this firm's household directory rendering empty with no explanation"
    + " (org-scoped world identifiers are follow-up fu-world-org-scoped-ids).",
  );
}

/**
 * Load the world into the house CRM. Idempotent twice over: the audited write's
 * idempotency key replays a completed load, and every insert is
 * `ON CONFLICT DO NOTHING` on deterministic ids, so a partially-applied load
 * completes rather than duplicating.
 */
export async function seedWorldIntoCrm(
  db: SqlDb,
  actor: WriteActor,
  households: readonly WorldHousehold[],
  worldDigest: string,
): Promise<Result<WorldSeedCounts>> {
  assertWriteActor(actor);
  const orgId = actor.tenant.orgId;
  return auditedWrite<WorldSeedCounts>({
    db,
    actor,
    action: "world.seed",
    entityType: "Org",
    entityId: orgId,
    idempotencyKey: `world-seed:${orgId}:${worldDigest}`,
    // PII-minimized: counts and the world digest, never a household name. The
    // detail states what was OFFERED, because it is fixed before the write runs;
    // what was written is the after-snapshot, which is built from the result.
    detail: `Projected the labeled fixture world (${households.length} households offered, digest ${worldDigest.slice(0, 12)})`,
    buildAfter: (counts) => ({ ...counts, householdsOffered: households.length, worldDigest }),
    perform: async (tx) => {
      const householdRows = households.map((household) => [
        household.id, orgId, household.displayName, null, null, household.state,
        household.provenance.asOf, "fixture", household.provenance.asOf, FIXTURE_CONFIDENCE,
        WORLD_FIXTURE_ORIGIN,
      ] as const);
      const contactRows = households.flatMap((household) =>
        household.members
          .filter((member) => member.kind === "natural-person")
          .map((member) => {
            const { first, last } = splitName(member.displayName);
            return [
              member.id, orgId, household.id, first, last, null, null,
              member.provenance.asOf, "fixture", member.provenance.asOf, FIXTURE_CONFIDENCE,
              WORLD_FIXTURE_ORIGIN,
            ] as const;
          }),
      );
      const taskRows = households.flatMap((household) =>
        openItemTasks(household).map((task) => [
          task.id, orgId, household.id, task.subject, "not-started", null, null,
          task.createdAt, "fixture", task.createdAt, FIXTURE_CONFIDENCE,
          WORLD_FIXTURE_ORIGIN,
        ] as const),
      );
      // One row per statement, every statement a LITERAL. A multi-row VALUES
      // list would have to be assembled from a variable, and SQL assembled from
      // a variable is SQL no static analysis can attribute to a table - which is
      // exactly what the append-only fences read. The whole projection is a few
      // hundred rows inside one transaction, so the trade costs nothing real.
      // `RETURNING id` is what makes the count a count of rows WRITTEN: a row
      // that conflicted away returns nothing.
      const written = { households: 0, contacts: 0, tasks: 0 };
      const conflicted: string[] = [];
      for (const row of householdRows) {
        const rows = await tx.query(
          "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence,record_origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id",
          [...row],
        );
        if (rows.rows.length === 0) conflicted.push(row[0]);
        else written.households += rows.rows.length;
      }
      if (conflicted.length > 0) {
        const foreign = await conflictingIdsNotHeldBy(tx, orgId, conflicted);
        if (foreign.length > 0) collisionRefusal(orgId, foreign, householdRows.length);
      }
      for (const row of contactRows) {
        const rows = await tx.query(
          "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence,record_origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id",
          [...row],
        );
        written.contacts += rows.rows.length;
      }
      for (const row of taskRows) {
        const rows = await tx.query(
          "INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence,record_origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id",
          [...row],
        );
        written.tasks += rows.rows.length;
      }
      return written;
    },
  });
}
