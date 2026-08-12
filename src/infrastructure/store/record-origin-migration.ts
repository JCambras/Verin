/**
 * THE ROW-ORIGIN MIGRATIONS (ADR-0057 amendment), in their own module for the
 * same reason the decision-ledger DDL is in one: `migrations.ts` is the ordered
 * plan, and a version's DDL and the reasoning behind it belong beside each other
 * rather than inside the list.
 *
 * WHERE THESE REPAIRS REACH, AND WHERE THEY STOP. Version 9 adds the column;
 * versions 10 and 11 are the corrections its DEFAULT could not make, and each
 * repairs exactly the rows its CONDITION names - so the boundary is stated here
 * rather than left to be rediscovered by whoever trusts the sweep next:
 *
 *   - Version 10 keys on `prov_source = 'fixture'`, the marker the world's CRM
 *     projection writes and nothing else does. It therefore reaches the three
 *     tables that projection writes (households, contacts, tasks) and no others.
 *   - The demonstration TENANT and its two demonstration USERS carry
 *     `prov_source = 'verin-crm'`, like every row this firm's own flows write, so
 *     NO value-provenance condition can name them. They take an IDENTITY
 *     condition instead - version 11.
 *   - NEITHER reaches `decision_ledger`, and no version ever can. Rows the seed
 *     wrote there before `recordOrigin` became a required input to
 *     `recordDecision` (D-217) took the column's default, and
 *     `decision_ledger_no_update` is a BEFORE UPDATE trigger that refuses EVERY
 *     update on that table (ADR-0041) - a migration that tried would abort the
 *     whole upgrade rather than repair anything. Such a store permanently reports
 *     `decision_ledger 0` over a synthetic chain sitting in it, and the only
 *     remedy is recreating the store. That is the same answer
 *     `IRREVERSIBLE_SEED_RESIDUE` gives for the seeded rows no purge can take
 *     (`src/__tests__/integration/fixture-purge.test.ts`), and it is why the
 *     clean-slate guarantee is "production was never seeded", never "the seed can
 *     be undone".
 *
 * A store CREATED after this branch walks none of this: the bootstrap applies
 * every version against an empty schema and each insert path names its own
 * origin. These versions exist only for the stores that already exist.
 */
import { DEMO_ORG_ID, DEMO_USERS } from "./demo-tenant";
import { DEMO_SEED_ORIGIN, FIRM_RECORD_ORIGIN, RECORD_ORIGIN_COLUMN, WORLD_FIXTURE_ORIGIN } from "./record-origin";

/** A SQL text literal from an in-repo constant. The values below are ours, but
 * an identity that ever grows an apostrophe must break the comparison rather
 * than the statement around it. */
const sqlText = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Version 9 - the ORIGIN of a row, beside the provenance of its values
 * (ADR-0057 amendment). `prov_source` says where a VALUE came from and moves
 * when a human edits it; `record_origin` says who put the ROW here and never
 * moves, because renaming a demonstration household does not make it the firm's
 * own record. The clean-slate sweep counts THIS column, so a seeded row that has
 * since been edited is still removed - otherwise demonstration data would
 * survive into production simply because somebody typed over it.
 *
 * The table list is the provenance-bearing set AS OF THIS VERSION, frozen here
 * like every shipped migration's DDL. A provenance-bearing table added later
 * declares `record_origin` in its own `CREATE TABLE`, and the clean-slate check
 * fails on any table that carries one column without the other, so the pair
 * cannot drift apart unnoticed.
 *
 * THE DEFAULT IS A CLAIM ABOUT EVERY ROW ALREADY IN THE STORE, and here that
 * claim is false for a store carrying the demonstration world. Version 10 is the
 * repair, and it is its own version rather than an edit to this one (D-016/D-029).
 */
export const RECORD_ORIGIN_SQL = [
  "orgs", "users", "households", "contacts", "financial_accounts",
  "account_opening_applications", "tasks", "decision_ledger",
]
  .map((table) => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${RECORD_ORIGIN_COLUMN} text NOT NULL DEFAULT '${FIRM_RECORD_ORIGIN}';`)
  .join("\n");

/**
 * Version 10 - the backfill version 9's default could not make (D-215's rule,
 * shipped where `runMigrations` can actually reach it; D-217).
 *
 * A store that already held the demonstration world when version 9 ran took
 * `firm-record` on every one of those rows, so the clean-slate check reports a
 * fully populated instance clean - the guarantee failing OPEN, silently, through
 * the migration that enforces it (charter #4).
 *
 * It is a SEPARATE version because version 9's DDL is shipped: `runMigrations`
 * matches the ledger on `(version, name)`, so a store that recorded version 9
 * before this existed never re-runs it, the `ALTER` is `IF NOT EXISTS`, and an
 * appended `UPDATE` would be dead code on exactly the stores needing repair.
 *
 * The condition is the marker those rows were written with, not a default:
 * `prov_source = 'fixture'` is what the world's CRM projection wrote, in the
 * three tables it writes, and nothing before version 9 re-stamped that column,
 * so it still names exactly the rows a fresh seed would mark - which is what
 * makes an upgraded store and a freshly seeded one agree. A virgin store matches
 * nothing here, so this is a no-op there.
 *
 * That condition is also this version's LIMIT: it is the world's marker, so the
 * demonstration tenant and identities it never touched are version 11's, and
 * `decision_ledger` is nobody's. See the module docstring above.
 */
export const RECORD_ORIGIN_BACKFILL_SQL = ["households", "contacts", "tasks"]
  .map((table) => `UPDATE ${table} SET ${RECORD_ORIGIN_COLUMN} = '${WORLD_FIXTURE_ORIGIN}' WHERE prov_source = 'fixture';`)
  .join("\n");

/**
 * Version 11 - the demonstration TENANT and its two demonstration USERS on a
 * store seeded before those inserts named an origin (D-218, D-219).
 *
 * Version 10 cannot reach them: they are `prov_source = 'verin-crm'` rows like
 * every record this firm's own flows write, so the world's value-provenance
 * marker names nothing here. RE-SEEDING cannot reach them either - the org
 * insert is `ON CONFLICT (id) DO NOTHING` and `seedDemoStore` skips any user
 * `findUserByEmail` already resolves - so both rows keep the `firm-record`
 * version 9's default handed them, and `pnpm fixture:check` on a fully seeded
 * store prints `orgs 0` and `users 0` over the demonstration firm and the two
 * accounts carrying a publicly committed password. That is precisely the
 * fail-open D-218 closed AT THE INSERT, surviving on exactly the stores the fix
 * was written for.
 *
 * It is its own version because 9 and 10 are shipped: `runMigrations` matches the
 * ledger on `(version, name)`, so an `UPDATE` appended to either is dead code on
 * every store that already recorded it (D-016/D-029) - the mistake D-217 had to
 * correct once already.
 *
 * The condition is IDENTITY, and it is these two accounts rather than the org's
 * membership: a developer's own user in the demonstration org is a real record,
 * and condemning it to the purge is the same false claim in the other direction.
 * The `users` statement stays ONE literal so the org-id-required fence can read
 * its tenant scope: a cross-tenant `UPDATE users` assembled from fragments is
 * exactly what that fence exists to refuse, and this one is org-scoped in fact.
 */
const DEMO_USER_EMAILS = DEMO_USERS.map((user) => sqlText(user.email)).join(", ");

export const DEMO_TENANT_ORIGIN_BACKFILL_SQL = [
  `UPDATE orgs SET ${RECORD_ORIGIN_COLUMN} = '${DEMO_SEED_ORIGIN}' WHERE id = ${sqlText(DEMO_ORG_ID)};`,
  `UPDATE users SET ${RECORD_ORIGIN_COLUMN} = '${DEMO_SEED_ORIGIN}' WHERE org_id = ${sqlText(DEMO_ORG_ID)} AND email IN (${DEMO_USER_EMAILS});`,
].join("\n");
