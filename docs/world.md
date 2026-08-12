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
`instrumentReachProblems` beside it, and the fifth is asserted against the rendered surface
(`src/__tests__/unit/household-freshness.test.tsx`):

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
- Every holding's confidence is measured against the world's own `asOf`, never against its own
  observation. A lot on a positions snapshot older than `freshLiquidityWindowDays` is `medium`, so the
  receding treatment on the detail surface is reading a real signal rather than a constant.

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
CRM (households, contacts, tasks)  ──►  who this tenant may see        (pii.view grant, org-scoped)
HouseholdWorldSource (evidence)    ──►  the depth of those households  (pii.view grant)
computeHouseholdHealth             ──►  the figure, as a demonstration artifact
```

Household depth is EVIDENCE - positions, beneficiary designations and bank instructions are owned by
custodians and the CRM of record, not by Verin's house CRM - so it arrives through a port
(`src/domain/world/household-world.ts`) whose Wave 0 adapter reads the generated fixtures. That
adapter is **replaced, not relabeled**, when a real `EvidenceSource` lands (ADR-0024).

`pnpm db:seed` projects households, their people, and their open items into the house CRM, labeled
`prov_source = 'fixture'`. It deliberately does **not** seed financial accounts: an account in the
house CRM is the output of the account-opening flow, and custodial positions are evidence.

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
pnpm fixture:check                          # fails on the FIRST fixture-marked row (run against production)
pnpm fixture:check --report                 # counts them (what a seeded development store wants)
pnpm fixture:check --report --expect-rows=n # the same count as an ASSERTION (CI uses it after the seed)
```

`--report` exits 0 whatever it finds, which is what a developer wants and what a GATE must never be:
`--expect-rows` is how the CI step after the seed proves the world actually landed, because a report
that finds nothing proves nothing (charter #4).

The sweep derives its table list from the shipped DDL - every table whose DDL carries a
`prov_source` column - so a new provenance-bearing table widens the guarantee automatically. A sweep
that finds no such table reports a problem rather than passing vacuously (charter #4).

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
