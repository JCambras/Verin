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

## The clean-slate guarantee

```
pnpm fixture:check            # fails on the FIRST fixture-marked row (run against production)
pnpm fixture:check --report   # counts them (what a seeded development store wants)
```

The sweep derives its table list from the shipped DDL - every table whose DDL carries a
`prov_source` column - so a new provenance-bearing table widens the guarantee automatically. A sweep
that finds no such table reports a problem rather than passing vacuously (charter #4). The fixture
adapter additionally refuses to serve anything under `APP_ENV=production`. Proof PF-255.

## Changing the world

1. Edit only `fixtures/world/spec/*.json`.
2. `pnpm world:generate`, then `pnpm world:validate`.
3. Commit the spec **and** the regenerated tree together; the `world` CI job byte-compares them.

Adding a vocabulary term (a registration type, a relationship, an activity kind) means adding it to
`src/domain/world/household-world.ts` first - the generator imports those lists, so a fixture can
never carry a value the product cannot render.
