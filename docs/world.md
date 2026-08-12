# The populated world

**Normative for `fixtures/world/**`, `scripts/world/**`, and the household surfaces. Governed by
[ADR-0057](./adr/0057-populated-world.md).**

A hundred named households, each genuinely deep. It exists because an empty product cannot be
inspected: nobody can tell whether a household surface handles a blended family, a trust that pays a
different household, or four households called Smith, if there has never been more than one
household to look at.

Everything here is **demonstration data**. Every record carries `source: "fixture"`, so
`canFeedComplianceDecision` refuses it and every figure derived from it renders watermarked
"demonstration - not a compliance record" (charter #3, ADR-0022).

## What a person edits, and what a person never edits

| Path | Owner | Rule |
|---|---|---|
| `fixtures/world/spec/roster.json` | hand-owned | vocabulary, cast, model allocations, world size, the deliberate surname collisions |
| `fixtures/world/spec/featured.json` | hand-owned | the ten hand-authored households, structure and prose |
| `fixtures/world/manifest.json` | **generated** | never hand-edit |
| `fixtures/world/households/*.json` | **generated** | never hand-edit |

```
pnpm world:generate    # rewrite the generated tree from the spec
pnpm world:validate    # regenerate, BYTE-COMPARE, and re-check every rule (CI job `world`)
```

A hand edit to a generated file fails `pnpm world:validate`, the blocking `world` CI job, and the
`world-determinism` fence (proof PF-253). The generator is the source of truth.

## How it is generated

One root seed (`WORLD_SEED` in `scripts/world/spec.ts`) and the replay corpus's own derivation
primitives - `scripts/corpus/seed.ts` (SHA-256 keyed by seed + path + field, never a stream PRNG)
and `scripts/corpus/clock.ts` (instant arithmetic, no wall clock). There is no second derivation
mechanism, and the `world-determinism` fence bans clocks, randomness, locale APIs and environment
reads across `scripts/world/**`.

**Addressing.** A featured household is addressed by its KEY and keeps its bytes forever. A derived
household is addressed by its SLOT within the derived range, so adding a featured household drops
the last derived slot instead of renumbering the rest. Adding a household changes exactly that
household's file - the property the fence checks directly.

**One draft shape, two authors.** Hand-authored and derived households arrive at
`materializeHousehold` in the same shape, so one implementation mints identifiers, attaches
provenance, derives holding lots, and fixes emission order. The ninety are never structurally
thinner than the ten - only less specific, and each household says which it is on its own surface.

**Rules that hold for both authors.** Every one is checked on the generated OUTPUT rather than on a
spec file, so the hand-authored ten cannot quietly break a rule the generator no longer can. The first
three are `accountRuleProblems` in `scripts/world/validate.ts`, the fourth is
`instrumentReachProblems` beside it, the fifth is `crossHouseholdProseProblems` beside those, and the
sixth is asserted against the rendered surface (`src/__tests__/unit/household-freshness.test.tsx`):

- An account never names its own owner as a beneficiary. A sole client with nobody else in the
  household simply has NO designation - which is realistic, is what the detail surface already says,
  and is what the beneficiary health factor is there to score. Naming the owner scored it complete.
- An entity household's people hold no PERSONAL accounts inside it. Enforced as the predicate the
  output can actually be held to: nobody the household records ONLY as an authorized signer appears
  in any account's `ownerKeys`. Its own entity note says they appear only as signers; a joint account
  and two IRAs titled to them contradicted that on the first page a reader opens. The generator's own
  filter is not a check - a hand-authored household reaches the same output through another door.
- No account holds the same instrument twice. The only way to mint one was a model portfolio naming
  an asset class twice, which the roster schema now refuses at spec load.
- Every instrument the roster carries is held by SOME account (`instrumentReachProblems`). A sleeve
  derives WHICH instruments it holds, not only how many, so a roster entry no account can ever hold
  is a world thinner than its own vocabulary claims - and it fails rather than sitting dead.
- A household's own prose names no PERSON from a household it links to
  (`crossHouseholdProseProblems`). A firm that does not hold the counterparty may not be told who is
  in it, and a narrative, an entity note or an activity line that names them anyway discloses through
  a field no authorization guard reads. Words the household itself publishes - the surname two
  Whitfield households share on purpose, an entity paying it income that its own statements name -
  discriminate nothing and are excluded.
- Every holding's confidence is measured against the world's own `asOf`, never against its own
  observation. A lot on a positions snapshot older than `freshLiquidityWindowDays` is `medium`, so the
  receding treatment on the detail surface is reading a real signal rather than a constant.

**A withheld counterparty is withheld WHOLE.** A cross-household link names a second household, and
that name is the same client PII the subject's is: `/api/households/[key]` authorizes it identically,
through the tenant-scoped CRM read. A counterparty outside this firm's book is then resolved to
NOTHING - the view model receives no entry for it and emits an opaque page-local ordinal
(`counterparty-1`) in place of a name, a world key and a link. The key is `<surname>-<given name>` by
construction, so passing it through as a fallback would disclose the party at lower fidelity rather
than withhold it, and the surface renders the neutral sentence as plain text: an affordance that can
only land on a refusal is not one. The ordinal counts the WITHHELD counterparties alone. Numbering
every counterparty, including the ones rendered by name, gave a household with one named and one
withheld link a page that opened at "Counterparty 2" with no first anywhere on it.

**A summary figure is labeled by everything it summarizes.** "Total across all accounts" is a SUM, so
it publishes `foldAccountBalances` - a fold over every account's provenance, the same rule the four
directory cards follow - on the directory row and on the household's own page alike. Publishing the
first account's own record provenance let a total claim a cleanliness the sum does not have, beside
cards that folded correctly. And no metric-class figure reaches a screen outside `<Metric>`: the
directory row's health badge carries the BAND WORD and the panel's factor cards a band, a bar and a
sentence, because a score extracted from its `DisplayMetric` renders with no provenance and no
"demonstration - not a compliance record" watermark - a hundred and six times a page respectively,
and exactly the number a reader would screenshot. The row CARRIES what the row renders: a directory
row holds the band and its word, and the composite figure and the six-factor breakdown belong to the
detail path, where the figure renders once, labeled.

**An empty book is not a search that found nothing.** Those are two questions, and one empty state may
not answer both: the book's own empty state is an honest sentence and the console on-ramp, and it is
`null` whenever there is a book, so the search-miss copy is reached only when a search emptied a list
that has rows. Passing one state for both told a reader that no household matched a search nobody
made, and offered the four Smiths that were not there.

**One instant, one confidence.** A household's `evidence` block carries the PROVENANCE of each class
(`liquidity`, `positions`, `instructions`), not a bare instant: the materializer measures the
observation against the world's `asOf` once, and every record of that class - the account balance,
the lots inside it, the beneficiary designation, and the evidence line the detail surface prints -
carries that exact value. Bare instants let each reader decide the confidence again, and the view
model that did so typed `high` on every page beside a household the materializer had already measured
as `medium`. Nothing outside the materializer mints a world provenance.

## The awkward cases, on purpose

- **Four Smith households and three Whitfields.** Surname search is provably not the same as finding
  a household.
- **A blended family** (`smith-derek-yolanda`) whose beneficiary designations deliberately do not
  mirror each other.
- **A trust registered in one household that pays another** (`whitfield-cordelia` owns the account,
  `whitfield-nathaniel` receives its income and holds no authority over it). Both sides acknowledge
  the link, and the validator fails if only one does.
- **An entity household with no natural-person client** (`larkspur-ridge-partners`), where the
  clients are signers and one signer's authority has lapsed.
- **A household whose evidence is deliberately stale** (`fairweather-colette`), so the freshness
  factor of the health score has something to say.

## Health is computed, never stored

`computeHouseholdHealth` (`src/domain/world/health.ts`) is pure, clock-free and integer-only: six
weighted factors (liquidity, evidence freshness, instruction integrity, beneficiary completeness,
authority currency, operational load), each returning its score, its weight, a sentence a person can
act on, and the records it read.

The generator is **forbidden** from emitting a health field at all - the `world-provenance` fence
fails on one. A stored score is a typed number wearing a computation's clothes; the whole point is
that the figure is earned.

**Two questions about beneficiaries, so TWO sets, and neither answers the other's question.** Both
live in `src/domain/world/household-world.ts`:

| Set | Question | Members |
|---|---|---|
| `BENEFICIARY_CAPABLE_REGISTRATIONS` | CAN this registration carry a designation? | every personally-titled registration - individual and joint included |
| `BENEFICIARY_SCORED_REGISTRATIONS` | Does a MISSING designation count against health? | traditional, Roth, rollover and SEP IRAs, and 529s |

The health factor scores the second; the detail note is worded from the second, so the score and the
sentence beside it cannot disagree. The empty beneficiary panel is worded from the FIRST. That gives
the surface three states: a designation is listed; the registration can carry one and none is on file
(a neutral fact, called a gap only where health scores it); the registration takes none at all.

One set answering both questions got the surface wrong in both directions in turn. Scoring every
registration invented a deficiency on a third of the accounts, on every one of the hundred household
pages, beside a health panel that said the same household was complete. Then wording the empty panel
from the health set told a reader that an individual or joint account cannot take a
transfer-on-death designation - which is just as untrue, in the opposite direction. An absence is
never reported as a gap, and a capability is never denied.

## How it reaches a surface

```
CRM (households, contacts, tasks)  ──►  who this tenant may see, and what each is CALLED
HouseholdWorldSource (evidence)    ──►  the depth of those households  (pii.view grant)
computeHouseholdHealth             ──►  the figure, as a demonstration artifact
```

**The record store owns identity; the evidence supplies depth.** The house CRM owns a household's
name and status and renames them through a governed audited write, so the directory and the household
page render `households.name` - a surface still showing the fixture's name after a rename would put
two shipped surfaces in disagreement about one record, with nothing on either to say so. A household
the CRM holds and no evidence describes (one somebody created in the console a minute ago) is LISTED,
says plainly that nothing has arrived for it yet, and carries a link to the console rather than a dead
end. The three record counts above the list read only the described households, and say so when they
differ from the household count.

Household depth is EVIDENCE - positions, beneficiary designations and bank instructions are owned by
custodians and the CRM of record, not by Verin's house CRM - so it arrives through a port
(`src/domain/world/household-world.ts`) whose Wave 0 adapter reads the generated fixtures. That
adapter is **replaced, not relabeled**, when a real `EvidenceSource` lands (ADR-0024).

`pnpm db:seed` projects households, their people, and their open items into the house CRM, labeled
`prov_source = 'fixture'` and `record_origin = 'world-fixture'`. It deliberately does **not** seed
financial accounts: an account in the house CRM is the output of the account-opening flow, and
custodial positions are evidence. The seeding itself is a function of a store
(`seedDemoStore`, `scripts/seed-demo-store.ts`), and `scripts/db-seed.ts` is the runner that opens and
closes the configured one - so the clean-slate guarantee below is proved against THIS seed rather than
against a re-implementation of part of it.

The same seed writes the scaffolding those rows hang on: the demonstration firm, the two demo accounts
that carry a publicly committed password, and the synthetic decision chain the audit-chain gate needs
in order to verify anything. Those are demonstration records too, so they carry the SECOND
demonstration origin, `demo-seed` - not the world's, because they are not the world, and
`DEMONSTRATION_ORIGINS` is a list precisely so a new demonstration writer has to be classified rather
than fall into the clean half. **Every one of those paths NAMES the column at its own insert** -
`seedWorldIntoCrm`, the org insert in `scripts/seed-demo-store.ts`, `createUser`, and
`recordDecision` / `appendDecisionEvents`, where `recordOrigin` is a REQUIRED input because the
producer knows which kind of row it is minting and the repository never can. A default is a claim
about rows you did not write, and an unnamed insert had the sweep print `decision_ledger 0`, `orgs 0`
and `users 0` over rows `pnpm db:seed` had just put there.

**Two facts, two columns, and neither answers the other's question.** `prov_source` is where a VALUE
came from and it MOVES: an advisor who renames a seeded household has entered that name, so the
rename re-stamps `prov_source = 'user-input'` and their own words render un-watermarked rather than
receded under "Sample data". Every surface that shows the name shows that fact - the console, the
directory row and the household page all render `households.name` through `FreshValue`, because the
one place the split between origin and value is visible at all is the name itself, and a view model
that carries the provenance while the component drops it states nothing. `record_origin` is where the
ROW came from and it NEVER moves, because editing a demonstration record does not make it the firm's
own. The clean-slate sweep
counts the ORIGIN: keyed on `prov_source` it would leave a seeded household in production the moment
somebody typed over it.

A column's DEFAULT cannot answer for rows that already exist. A store that already held the world when
`record_origin` arrived (version 9) stamped every one of those rows `firm-record` and reported clean
while a hundred households rendered - the guarantee failing open through the migration that enforces
it, on precisely the stores the repair exists for. So the corrections version 9's default could not
make ship as **their own versions**, never as an edit to a shipped one: `runMigrations` matches the
ledger on `(version, name)`, so an `UPDATE` appended to a version a store already recorded is dead code
on exactly those stores (D-016/D-029).

| Version | Reaches | By the condition |
|---|---|---|
| 10 `record-origin-backfill` | the world's rows, in the three tables its CRM projection writes | `prov_source = 'fixture'` - the marker those rows were written with |
| 11 `demo-tenant-record-origin` | the demonstration org and its two demonstration accounts | IDENTITY - `orgs.id`, and `users.org_id` plus the two demo emails |

Version 10's condition names exactly the rows a fresh seed gives the demonstration origin, so an
upgraded store and a freshly seeded one agree rather than diverge. Version 11 cannot borrow it: the
demonstration tenant and its users carry `prov_source = 'verin-crm'` like every row this firm's own
flows write, so no value-provenance condition can name them - and re-seeding cannot reach them either
(the org insert is `ON CONFLICT (id) DO NOTHING` and the seed skips a user it already resolves). It
keys on those two accounts rather than on the org's membership, because a developer's own account
inside the demonstration org is a real record and condemning it to the purge is the same false claim in
the other direction. The demonstration identity both the seed and the migration key on is named once,
in `src/infrastructure/store/demo-tenant.ts`.

**Where the repair stops, said by the code that makes it.** Neither version reaches `decision_ledger`,
and no version ever can: `decision_ledger_no_update` is a BEFORE UPDATE trigger that refuses every
update on that table (ADR-0041), so a store that seeded its synthetic chain before `recordOrigin`
became required reports `decision_ledger 0` over that chain permanently, and the only remedy is
recreating the store. Each data-correcting version states its own reach in
`src/infrastructure/store/record-origin-migration.ts` rather than leaving it to be rediscovered. A
store created after this branch walks none of this: the bootstrap applies every version against an
empty schema, and each insert path names its own origin.

The seed counts rows **written** (`RETURNING id`), never rows offered, and **refuses** with a typed
`CONFLICT` naming the collision when a conflicting household is held by ANOTHER org. World record ids
are derived from the world seed, so they are the same bytes in every org: only the first org to load a
world receives it, and a second firm's silently empty household directory is the worst available
outcome. Making a second firm actually receive its own copy needs org-scoped ids - follow-up
`fu-world-org-scoped-ids`.

The refusal tests that CONDITION - a conflicting row owned by a different org - and not the symptom
it shares with a safe case. Household ids are stable across world content while the digest, and so
the idempotency key, is not, so the SAME firm re-offered a regenerated world runs the load again and
conflicts away to nothing. That is the ordinary development loop: it writes whatever is genuinely new
(a person added to a household lands), reports honest counts, and refuses nothing.

## The clean-slate guarantee

```
pnpm fixture:check                          # fails on the FIRST demonstration-origin row (run against production)
pnpm fixture:check --report                 # counts them (what a seeded development store wants)
pnpm fixture:check --report --expect-rows=n # the same count as an ASSERTION (CI uses it after the seed)
```

`--report` exits 0 whatever it finds, which is what a developer wants and what a GATE must never be:
`--expect-rows` is how the CI step after the seed proves the world actually landed, because a report
that finds nothing proves nothing (charter #4). It belongs to that path only, so `--expect-rows`
without `--report` exits 2 naming the mistake rather than being ignored - the run it would otherwise
fall through to asserts the OPPOSITE verdict, and the caller would believe their floor was applied.

**Marking a row makes it VISIBLE, not removable.** The decision and audit chains this seed writes are
append-only by DDL trigger, their replay sources and heads describe entries that cannot be removed, and
the tenant and identities those chains are anchored to cannot be deleted while they exist. The
demonstration seed is therefore IRREVERSIBLE: a store that has run it can never be swept empty again.
The guarantee was never "the seed can be undone" - it is that a production instance was never seeded
(`assertSeedableEnvironment` refuses `APP_ENV=production` before a store is opened, and again before
any write) AND that any demonstration row is COUNTABLE if one is there.

That guarantee end to end is the FIRST case in `src/__tests__/integration/fixture-purge.test.ts`: it
migrates, runs the COMPLETE `seedDemoStore` the CLI runs, purges by a predicate derived from the LIVE
store catalog, and measures EVERY base table's row count before and after - not only the tables
carrying the marker, because the same seed writes into ten tables that carry neither provenance column
and a seeded path landing in one of those was invisible to the case added to catch invisible seeded
paths. Every table the seed grew is back to its pre-seed count OR named in `IRREVERSIBLE_SEED_RESIDUE`
with the mechanism that refuses the delete - the append-only trigger, or the foreign key the store
itself raises - and the list is exact in both directions, so a name the seed no longer earns fails as
loudly as a seeded table missing from it. The other cases are optimisations of that one, never
substitutes: this guarantee has failed open in three shapes so far - a defaulted column that answered
for rows it never wrote, an insert path that named no origin, and a migration that never ran on the
store it was written for - and each time every mechanism check passed, because each checked one
mechanism and nothing ran the whole thing.

What it COUNTS is `record_origin`, never `prov_source` - see the two facts above. What it counts it
IN is derived from the shipped DDL: every table whose DDL carries a `prov_source` column, so a new
provenance-bearing table widens the guarantee automatically. A sweep that finds no such table reports
a problem rather than passing vacuously, and so does a provenance-bearing table the DDL never gives a
`record_origin` - a table that can hold a demonstration row with no origin to count it by cannot be
cleared (charter #4). That pairing is read from the DDL (`recordOriginCoverageProblems`, which sees a
column declared in a `CREATE TABLE` or added by a later `ALTER TABLE`) and again from the store's own
catalog.

That derivation is read THREE ways, and any disagreement is a sweep problem, which fails the runner:

1. a **structural parse** of each table's balanced body and its top-level column items;
2. a **text scan** for every `prov_source` DECLARATION - the column name followed by a column TYPE -
   which shares no code with the parse and therefore catches a declaration shape the parse does not
   recognize (an `ALTER TABLE ... ADD COLUMN`, a `CREATE UNLOGGED TABLE`). It counts DECLARATIONS,
   never mentions: a column-level `CHECK (prov_source IN (...))` names the column twice for one
   declaration, and `CREATE INDEX ... ON t (prov_source)` is the index this cross-tenant sweep would
   itself want. Declaration-versus-reference is decided off the closed set of column types
   (`PROVENANCE_COLUMN_TYPES`), never off a list of keywords that may follow a reference - that list
   is open, and every keyword nobody thought of (`DROP COLUMN prov_source CASCADE`,
   `(prov_source NULLS LAST)`, `GROUP BY prov_source ORDER BY ...`) would fail the check while naming
   an unswept table that does not exist. A declaration naming a type outside the closed set fails the
   OTHER way and says so, so the reading can never go quietly blind;
3. the store's **OWN column catalog** - base tables in `ANY(current_schemas(false))`, the search path
   the sweep's own unqualified `SELECT` resolves through - which is not a reading of the DDL at all
   and catches a provenance-bearing table created outside `MIGRATION_SQL`.

Two readings that resolve a declaration the same way agree by construction and cross-check nothing.
A false alarm here is as corrosive as a false pass: it is the one check that has to be unambiguous.
The fixture adapter additionally refuses to serve anything under `APP_ENV=production`.
Proofs PF-255, PF-260, PF-261.

## Changing the world

1. Edit only `fixtures/world/spec/*.json`.
2. `pnpm world:generate`, then `pnpm world:validate`.
3. Commit the spec **and** the regenerated tree together; the `world` CI job byte-compares them.

Adding a vocabulary term (a registration type, a relationship, an activity kind) means adding it to
`src/domain/world/household-world.ts` first - the generator imports those lists, so a fixture can
never carry a value the product cannot render.
