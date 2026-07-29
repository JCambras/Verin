# ADR-0029: Decision-core canonical contracts land in `contracts/` as Zod schemas; contracts ceiling re-baselined

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** Founding architect (executing the captain-ratified v3 direction, ADR-0023)
**Relates to:** Charter non-negotiables #1, #2; v3 invariants 2, 7, 8, 9; ADR-0018 (ceiling amendment), ADR-0026 (FirmId ≡ org_id)
**Informed by:** docs/v3/verin-core-contracts.ts (ratified shapes), docs/v3/verin-prompt-sequence-v3.md §5, docs/v3/marriage-map.md §5 (style-merge notes)

## Context

ADR-0023 ratified the v3 architecture; build-sequence prompt 5 lands its §5 canonical core type
system as real code. The ratified reference file is framework-free TypeScript; the prompt directs
implementing the contracts **as Zod schemas with derived types** so illegal states are rejected at
parse time, not by reviewer discipline. Three constraints meet here:

1. The marriage map places the contracts in `src/contracts/decision-core` beside
   `result.ts`/`errors.ts`/`roles.ts` - the dependency-free home every layer may import.
2. `contracts/` has never imported an external package, and the contracts line ceiling (ADR-0018)
   was 600 with 472 used - the ratified surface (~820 lines across seven <500-line files) cannot fit.
3. ADR-0018 is explicit: raising a platform ceiling is an ADR amendment, never a code change.

## Decision

- **Home:** `src/contracts/decision-core/` - `ids.ts` (branded IDs + temporal/integrity
  primitives), `actor.ts` (tenant scope, actor refs, tokenized shapes), `trigger.ts`,
  `evidence.ts`, `authority.ts`, `execution.ts`, `decision.ts`, `explanation.ts` (the recursive
  explanation tree + versioned source citations), `normalization.ts` (the shared pure collection and
  explanation normalizers that parse boundaries and hash preimages both call), `serialization.ts`
  (canonical serializer + versions), plus the shared `src/contracts/time-zone.ts` registry consumed by
  configuration and replay. Zod schemas are the single source; TypeScript types are `z.infer` derived.
- **Structural invariants:** strict objects + discriminated unions make v3 invariants 7–9
  parse-level facts (proceed requires authority + non-empty plan; blocked/prohibited cannot carry
  either; a prohibition has no resolving-evidence channel and a prohibited record admits no
  revaluation conditions). Disposition and authority stay separate planes. Fence:
  `src/__tests__/fitness/decision-core-illegal-states.test.ts` (registered for invariants 7–9;
  proof PF-027). Canonical-serialization fixtures live in `fixtures/decision-core/` (synthetic test
  vectors, labeled in their README).
- **Hash preimages:** bundle and decision hashes use distinct domain-qualified version-1.7.0
  envelopes and explicitly enumerated projections. The bundle projection excludes its identity and
  stored hash; the decision projection excludes only its stored hash. Both projections run through
  the same pure collection normalizers used by their parse boundaries, including recursive
  explanation citations, execution steps, and compensating actions. This defensive normalization
  does not parse a structurally typed or persistence-hydrated record, and non-plain objects still
  reach `canonicalJson`'s refusal unchanged. Exhaustive key lists are checked against the inferred
  schema keys so optional
  schema growth cannot evade a preimage-version bump. Version-keyed recursive schema fingerprints cover
  every nested projected object, array, union arm, and optional property. Explicit undefined optional
  properties normalize to omission, while sparse arrays are rejected. Fixture digests are SHA-256 over
  canonical UTF-8 bytes and must equal the stored hash. A projection change requires its own version bump
  and migration story. The fingerprint digests Zod's JSON Schema EMITTER output, which is a representation
  detail rather than a property of these contracts: a Zod upgrade that changes only how an unchanged schema
  is emitted (`$defs` naming, `additionalProperties`, `required` ordering) is deliberately reviewed and
  RE-PINNED **without** a preimage-version bump and **without** regenerating any recorded
  `bundleHash`/`decisionHash`, which hash canonical payload bytes an emitter change cannot touch. The
  re-pin is permitted only once evidence shows the project-owned schema semantics AND the canonical
  projection bytes are unchanged - the fixture digest tests must pass unmodified. The fingerprint stays
  blocking precisely so a dependency bump forces that review instead of silently altering the contract.
- **Replay-input boundary:** `DecisionInputBundle` accepts only the implemented 1.7.0 schema and
  1.0.0 canonical serializer. Its `timeZone` must belong to the registry the bundle's OWN
  `timeZoneDataVersion` names - today all 341 `Zone` identifiers derived from `iana-tzdb/2026b`'s
  primary data files in the SHA-256-locked registry. It canonicalizes
  identifier casing, and rejects `Link` aliases, so replay validation never
  changes with host ICU data or gives aliases distinct replay bytes. Set-like instruction-version
  and evidence-snapshot collections reject duplicates and are sorted in parsed evaluator input,
  not only in the hash projection. The parsed bundle remains deeply frozen.
- **Time-zone registry versions are a MAP, and the map is CONSULTED:** `timeZoneDataVersion` is an
  enum derived from the keys of a supported-release map (`iana-tzdb/2026b` is the only shipped
  entry), and the map's VALUES decide validity: a bundle's `timeZone` is checked against the
  registry that bundle's own recorded version names, while the standalone `TimeZone` admits the
  union of every supported registry. A release carries its version, registries, and placeholders as
  one inseparable value; the supported map derives its key from that embedded version, so no caller
  can label one release's data with another release's version. Each entry carries BOTH halves of its release - the canonical
  `Zone` names AND that release's own `Link` alias table - because tzdb moves names between them; a
  single un-versioned alias table could not follow an adoption that adds "its version key +
  registries" (plural). Both halves are needed. A single-version literal would make
  every persisted bundle unparseable the day a newer release ships; a `TimeZone` closed over only
  the newest registry would do the same to any bundle naming a `Zone` the newer release demoted to
  a `Link` (tzdb does this routinely - `America/Nipigon`, `America/Godthab`, `Europe/Uzhgorod`) -
  and a union with no per-bundle check would let a NEW bundle claim a zone its recorded release
  never had. Entries are ADDITIVE - adopting a future release adds a key and never removes one. The
  version-keyed selection is proven on a CONSTRUCTED two-registry map, because with one shipped
  registry "the recorded version selects the registry" and "there is one registry" are
  indistinguishable through the shipped map alone. (This records the contract only; the replay
  engine itself remains prompt 19.)
- **Link aliases canonicalize at the CONFIGURATION boundary, never at the replay boundary:** the
  pinned release's 257 `Link` names are SHA-256-locked in their own registry alongside the 341
  `Zone` names, resolved to their canonical `Zone` target. `FIRM_TIMEZONE` therefore accepts 597 of
  the CURRENT release's 598 identifiers (`iana-tzdb/2026b` today) - including long-legal
  spellings such as `UTC`, `US/Eastern`, `Asia/Calcutta`, `Europe/Kiev`, and `Africa/Accra` - and
  stores only the canonical `Zone` (`Etc/UTC`, `America/New_York`, `Asia/Kolkata`, `Europe/Kyiv`,
  `Africa/Abidjan`). NEW configuration is held to the CURRENT release, NOT to the cross-release
  union `TimeZone` admits: a new bundle stamps the CURRENT version, so a configured `Zone` that only
  an older supported release shipped would boot and then fail at every bundle parse - fail-late,
  where charter #7's config discipline is fail-closed at boot. Reading an already-persisted record
  and accepting a new operator value are two boundaries, and only the first spans releases.
- **Placeholder `Zone`s are readable but not configurable:** the 598th identifier is tzdb's
  `Factory`, the placeholder for a system whose zone was never set. CLDR/ICU deliberately omits it,
  so `Intl.DateTimeFormat` throws `RangeError` on it - it is the ONE name in the shipped release the
  runtime cannot use. It stays
  in the `Zone` list so a record that already persisted it parses and hash-verifies, and is
  subtracted at the CONFIGURATION boundary, where admitting it would boot a firm whose first
  local-time render throws - the same fail-late shape the release scoping above refuses. Each
  release carries its OWN placeholder list beside its `Zone`s and `Link`s, subtracted AFTER alias
  resolution so an alias of a placeholder is refused too. Which names are placeholders is DECLARED
  by the release and reviewed when that release is adopted - never probed from the host at test
  time: a blocking assertion that swept the registry through `Intl` would demand the running
  runtime's bundled tzdata be at least as new as the pinned release (which already carries
  `America/Coyhaique`, added in tzdata 2025a), re-introducing on the test side the OS coupling the
  pinned registry exists to remove. The companions are non-vacuous against the pinned data instead:
  the admitted set is EXACTLY the release minus its declared placeholders (an unlisted placeholder
  still boots, an over-broad subtraction refuses a real `Zone` - both fail), an alias is admitted
  exactly when its target is and only then resolves to it - asserted as that EQUIVALENCE rather than
  as this release's incidental "no `Link` targets a placeholder", so a future release whose alias
  table does target one passes on data this code already handles correctly - and on a CONSTRUCTED
  release the subtraction is release-scoped rather than hardcoded.
  `TimeZone` itself stays closed over supported-release `Zone` names (341 today), so one zone still
  has exactly one persisted and hashed spelling. **Migration:** no deployment action is required for
  any IANA spelling - a `FIRM_TIMEZONE` naming a `Zone` or a `Link` alias (`UTC`, `GMT`, `EST5EDT`,
  `US/Pacific`, `Asia/Calcutta`, `Europe/Kiev`, `America/Nipigon`, `W-SU`, `Etc/GMT+12`) still boots,
  and an alias-valued one now resolves to its canonical Zone rather than failing closed. Exactly ONE
  value class the superseded host-`Intl` guard accepted no longer boots: ECMA-402 fixed-offset
  identifiers such as `+05:30` or `-08:00`. Admitting them is an explicit NON-GOAL - an offset
  carries no DST rules, belongs to no tzdb release, and has no canonical `Zone` to persist and hash,
  so it can never carry the release-scoped replay semantics every accepted value does; a deployment
  configured with one fails FATAL at boot and must name the IANA Zone for that offset instead.
  `TimeZone` is branded and `timeZoneDataVersion` is
  typed by the release map's key union, so neither a bare `string` nor an unshipped version string
  can reach a replay field without parsing. Every rejected configured value uses one release-aware
  formatter that removes line-breaking control characters, bounds echoed text, and distinguishes
  non-string inputs without rendering their payload.
- **Tenant-owned links:** domain configuration, evidence source, policy, instruction version, evidence
  snapshot, intent, input bundle, derived decision, approval template, subject, scope, execution target,
  reservation, verification-rule, secure request, secure event, and secure blob links are strict
  structured references carrying `firmId` plus the opaque branded ID. Approval templates are
  tenant-scoped records. Firm-configured roles use the same structured reference shape, and role
  collections reject duplicates and normalize by firm then opaque ID. Ambiguity candidates are a
  duplicate-free canonical set constrained to one tenant. The tenant-scope fence inventories every
  exported Zod value, regardless of its name, whose runtime schema graph contains a scoped-reference
  collection. Every discovered export must have an exact registry entry whose legal and mixed-tenant
  payloads are parsed through that exported schema; a new alias or wrapper fails until its behavior is
  registered and rejects the mixed payload. Decision-record refinements iteratively
  check precedence, explanation children, blockers, revaluation conditions, prohibitions, authority stages,
  actor roles, authority roles, and evidence-supplier roles, rejecting every cross-tenant link. For the
  execution plan the record binds ONE edge per step - the step's `targetRef` - because the action and plan
  refinements below already bind every reference inside an action to that action's target and every
  step's and compensation's target to the first step's; re-walking them here would be a second copy of
  the same rule to keep in sync by hand. Approval-stage arrays normalize by their explicit `order`.
  Every parsed decision-core object and nested collection is recursively readonly and frozen, so a
  validated decision cannot be mutated into an illegal or hash-divergent state.
- **Retry-safe external actions:** execution steps and their non-recursive compensating actions share one
  external-action shape requiring a stable idempotency key, conflict keys, tenant-scoped reservations,
  pre-execution conditions naming at least one evidence snapshot, and a tenant-scoped verification rule.
  Every reference within an action matches its target tenant, every step and compensation in a plan shares
  one tenant, and parent and compensation idempotency keys must be distinct across the plan. Set-like
  dependency, conflict, reservation, precondition, and precondition-evidence collections reject
  duplicates and normalize canonically, and a
  derived decision cannot name itself as its parent.
- **Approval chronology:** EVERY approval duration - relative stage expiration and escalation
  delay alike - is strictly positive, decided by reading the duration's own component magnitudes
  and refusing any sign, never by inspecting a leading character. A "does not start with `-`" rule
  silently inherits whichever ISO-8601 profile the validator ships (8601-2 permits a sign per
  component), so it would admit `PT-1H` as positive the day that profile widens. Every approval or
  specialist-review stage instantiated on a decision expires later than that decision's recorded
  creation timestamp. Positivity is ALL this layer constrains on `EscalationStep.after`: whether a
  delay must fall inside its stage's own expiry, and whether two steps in one path may share a
  delay, are approval-BINDING semantics owned by prompts 18/24 and are deliberately deferred
  (D-054), not overlooked.
- **Evidence chronology:** an `EvidenceSnapshotRef` cannot claim it was retrieved BEFORE the
  observation it records (`retrievedAt >= observedAt`; equality is legal - a source whose as-of
  instant is its fetch instant is ordinary). The pair is a hash-bound immutable decision input every
  downstream evaluator reads as an interval, so an inverted pair is an illegal state, not a lenient
  one. `freshness` is the evaluator's RECORDED verdict, NOT re-derived here: the staleness threshold
  is per-evidence-kind policy this layer does not have, so the contract stores the label without
  claiming to check it.
- **One comparator, one uniqueness rule for tenant-scoped references:** `contracts/decision-core/ids.ts`
  exports THE canonical `{firmId, id}` order (firm, then opaque id) and THE set-identity helper.
  It also owns the composite order for versioned source citations and execution preconditions.
  Role sets, evidence-supplier sets, ambiguity candidates, execution collections, replay
  collections, explanation citations, and both hash preimages consume these shared authorities, so
  a parsed record and its hash preimage cannot order the same list two ways once references stop
  being single-tenant. Trigger arms carry their own tenant refinements
  and the discriminated union is composed FROM the refined arms, so no check exists in two places
  where only one copy runs.
- **Canonical serialization refuses precisely and in bounded space:** cycles are detected against
  the set of ancestors on the current path and named by their location, rather than surfacing as a
  host-dependent `RangeError`; the diagnostic path is a parent link built into a readable string
  only when a refusal is actually raised. This serializer will run over explanation trees whose
  depth is data-driven, not schema-bounded, so optional-property normalization, explanation
  normalization, and canonical serialization all use iterative traversal. Its "only plain objects"
  refusal stays REACHABLE on the
  paths that actually reach it: optional-property normalization passes non-plain objects through
  untouched (one shared prototype rule), because rebuilding them from their own entries would
  flatten a `Date`/`Map`/class instance to `{}` and hash it as `{}` - different decision inputs
  collapsing onto one `bundleHash`. Optional-property normalization tracks ancestors before it
  rebuilds arrays or plain objects, leaving a back-edge intact for `canonicalJson` to return the
  documented circular-reference `AppError` instead of overflowing the host stack. Both preimage
  builders project once, remove explicit undefined values once, then use the shared pure payload
  normalizers. Proven through both preimage builders, not by calling the serializer directly - the
  direct call cannot see either normalization gap.
- **`contracts/` may import Zod** - and only Zod. The layer's discipline is restated as: no
  project-local imports from outer layers (unchanged, fenced), no I/O, no platform coupling; Zod is
  a pure validation library and is what makes the contracts self-enforcing at every boundary.
  The dependency fence enforces the external allowlist across static imports, re-exports, dynamic
  imports, direct and indirect CommonJS loaders, TypeScript import types, import-equals declarations,
  source-local declaration files, and triple-slash type/path/lib references. It resolves path aliases
  plus baseUrl, package imports, and package self-references through the active TypeScript compiler
  configuration, rejects `createRequire` and local paths outside the four source layers, rejects
  ambient runtime or namespace declarations, and type-checks contracts against the ES-only library
  surface using diagnostic codes so implicit DOM and Node globals cannot add platform coupling.
  Destructured `require` and `createRequire` references share receiver-provenance resolution across
  declarations, computed literal keys, type-erased aliases, and assignment destructuring. Computed
  keys follow local literal declarations and preceding simple assignments; runtime, conditional, and
  configuration-derived keys remain outside this static fence's documented proof boundary.
  JSX in `contracts/` is rejected because `jsx: react-jsx`
  would add an implicit `react/jsx-runtime` dependency.
  Any further external import into `contracts/` requires its own ADR.
- **Shared normalization authority:** independently of any line measurement, parse boundaries and
  hash preimages must call the same pure normalization functions. A separate hand-maintained
  decision-preimage field walk would duplicate roughly 65 lines of recursive execution and
  explanation structure, then drift whenever either schema grows. Parsing inside a hash builder
  would instead change the accepted runtime object boundary and hide non-plain object refusals.
  Shared pure authorities avoid both defects while preserving explicit versioned projections.
- **Ceiling re-baseline (amends ADR-0018):** contracts 600 → **3500**. The final implementation
  measures **3413** lines by the line-budget fence's own metric, leaving **87 lines of headroom**.
  This is the final post-review figure and the only current-state measurement to plan against. The
  former 3200 ceiling could not contain the required prompt-5 correctness fixes. The ratchet-down doctrine
  resumes from 3500; later contract-layer prompts
  (8–9: primitives, policy AST) re-baseline by their own ADRs when their scope lands. The headroom
  is a budget for finishing prompt 5's contract, NOT standing permission to grow `contracts/`.
- **Runtime registry data budget (D-099):** the two runtime-imported 2026b IANA JSON registries are
  generated release data, not executable contract source. Their 602 physical lines have a separate
  620-line ceiling with 18 lines of headroom. Import discovery and the ceiling are blocking in the
  `line-budget` fence. The contracts-source ceiling remains 3500.
- **Scope (charter #2 - declared need only):** exactly the prompt-5 list plus transitive
  dependencies and the template/instance approval split the marriage map calls out. Deferred to
  their owning prompts: policy AST + PolicyRuleId (9), typed ledger events + LedgerEntryId +
  ExecutionHandleId + ObservedStatus (7/26), the three ports + their request/receipt shapes
  (14/24), instruction/config vocabularies (9–10). The Tokenized factory and its reachability
  fence are prompt 6 (parallel worker); only the SHAPE lands here.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Land in `domain/` to spare the contracts ceiling | The marriage map names `contracts/` as the home; domain would also need a bump; every layer (incl. future `llm/`) must import these without reaching into domain. |
| Pure types in `contracts/`, Zod wrappers in `infrastructure/` | Two sources of truth for one contract; the illegal-state guarantees would live apart from the types they guarantee and could drift. |
| Keep the 600 ceiling and land a trimmed surface | Trimming ratified shapes to fit a budget inverts the constitution: the ceiling exists to prevent sprawl, not to veto the captain-ratified architecture. |
| Hand-rolled validators instead of Zod | Re-implements a well-tested library, invites divergence between validator and type - the exact class of drift branded schemas eliminate. |

## Trade-offs and Costs

- **Gained:** illegal decision states are unrepresentable at every parse boundary; invariants 7–9
  flip active with a runnable mechanism; replay gets a versioned canonical serializer and
  non-self-referential hash projections with committed byte-form and digest fixtures.
- **Sacrificed:** `contracts/` is no longer import-free (Zod, by exception); the contracts ceiling
  grew 600 → 3500 (a real growth, honestly sized and ratcheted).

## Consequences

- `line-budget` fence: contracts-source ceiling 3500 plus a separate 620-line runtime JSON
  data-artifact ceiling (D-099).
- `charter-map.json` #7 and `v3-invariants.json` invariant 2 execute
  `decision-core-tenant-scope`, which proves the registered prompt-5 reference boundaries reject
  their executable mixed-tenant probes and the registry exactly matches every exported Zod value
  whose runtime schema graph contains a scoped-reference collection, independently of export naming,
  aliasing, or wrapper reuse. Its exact module inventory prevents a newly added decision-core source
  module from escaping that graph walk.
- `charter-map.json` #16 executes `decision-core-external-action-safety`, which rejects incomplete
  compensating actions and idempotency-key aliasing.
- `v3-invariants.json`: 7, 8, 9 active → `decision-core-illegal-states` fence; ratchet extended
  to [2, 5, 7, 8, 9].
- Consumers (prompts 7, 9–19, 25–26) import from `@contracts/decision-core/*`; the store boundary
  keeps ISO-string timestamps both ways (Timestamp admits only canonical UTC `Z` instants).

## Revisit When

- Prompt 8/9 land primitives + policy AST (next contracts re-baseline ADR), or
- the canonical serializer or either hash projection must change form (matching version bump +
  migration story for recorded hashes), or
- a newer IANA release is adopted (ADD its version key + registries, DECLARING that release's own
  placeholder `Zone`s in the same entry; never remove a supported one, or already-persisted bundles
  stop being replayable against the release they recorded, and explicitly review the separate
  runtime data-artifact ceiling), or
- a second external import is proposed for `contracts/` (needs its own ADR).
