# ADR-0057: The domain configuration schema - a decision domain is data

**Status:** Accepted
**Date:** 2026-08-11
**Deciders:** Founding architect (implementation), captain (the two rulings this ADR executes)
**Relates to:** v3 prompt 10; v3 §5, §6, §8, §10, §13, §14, §16; invariant 3 (activation), invariant 20,
invariant 26; charter non-negotiables #1, #2, #4, #5, #10; ADR-0010 (amended below), ADR-0011 (amended
below), ADR-0023, ADR-0026, ADR-0029, ADR-0039, ADR-0053, ADR-0055
**Amends:** ADR-0010 (the hand-coded account-opening flow definition is deleted; see "Amendment to
ADR-0010"); ADR-0011 (`resumeFlow` takes an optional caller-supplied `ResumeGuard`; see "Amendment to
ADR-0011")

## Context

v3 prompt 10 requires that an entire decision domain be expressible as DATA: supported intents, slot
requirements, evidence requirements and freshness, primitive bindings, policy references, household
instruction kinds, prohibitions, approval templates, execution adapter bindings, conflict keys,
reservation rules, verification rules, and UI presentation metadata - proved against BOTH money movement
and account opening. Invariant 3 ("no core module, directory, or evaluator branch is named for a decision
domain") activates on it, and Gate B requires it.

Two captain rulings set the shape of the work:

- **`invariant-3-scope` (2026-07-28).** The naming rule covers DECISION-CORE - the decision-core
  contracts, `domain/config`, and the primitives/policy/decision/precedence/authority/evidence/execution/
  verification subsystems as they land. Shipped house-CRM record vocabulary, persisted table names, audit
  action codes, public routes and established observability names stay, on a small enumerated,
  ADR-justified allow-list with a fence that detects unreviewed growth. No shipped URL, migration, or
  record is renamed.
- **`account-opening-migration-depth` (2026-07-28).** Behavior-preserving migration: express the shipped
  five-step CRM + e-sign flow as configuration compiled to an execution-plan template, DELETE the
  hand-coded flow definition, genericise the wiring, and keep the integration test, the e2e walkthrough
  and the load smoke passing. Author and load-validate the decision-half sections now, honestly labeled
  validated-but-not-yet-evaluated until the Wave D evaluator. Add no new approval or evidence behavior.

A third instruction arrived with the dispatch (captain direction, 2026-08-11): **every configuration
version carries authorship provenance, and a candidate version states its change against a parent version
AS DATA.** Both serve the ratified thesis that the system will eventually PROPOSE configuration - a
drafted clause must be able to cite its source, and a proposed change must be renderable as a reviewable
diff. Retrofitting either onto history that lacks it is the expensive version, so both ship in version one.

## Decision

### 1. One firm-neutral document per (domain, version); tenancy enters exactly once

A domain configuration is an immutable, inert YAML document carrying no firm identity, no household data,
and no judgment. Two pure functions turn it into engine-usable form:

- `loadDomainConfig(input, environment) -> Result<LoadedDomainConfig, DomainConfigError[]>`
- `bindDomainConfig(loaded, firmRegistry) -> Result<BoundDomainConfig, DomainConfigError[]>`

`bindDomainConfig` is the ONLY place a firm enters. It mints the tenant-scoped references the merged
decision contracts already require and REFUSES a document that carries a `firmId` anywhere in its graph.
That is what makes invariant 26 ("Firm B differs only through configuration") a property test rather than
a promise: binding the same document for two firms produces structurally identical output modulo `firmId`.

### 2. The one grammar rule

Every string that is not a human LABEL is an identifier from a closed, load-checked vocabulary, and every
composite value - conflict keys, idempotency keys, command payload fields, copy - is built from a closed
SEGMENT GRAMMAR, never from string interpolation. There is exactly one interpolation mechanism in the
system: the `{slot:…}` / `{context:…}` placeholder set, rendered deterministically against already
published values. Anything else in a copy template is a load error.

This is what stops configuration from becoming the second expression engine v3 §20 risk 2 bans.

### 3. Where the schema lives (deviation from the prompt's literal file list)

The ratified prompt names `src/config/domain-schema.ts`. A fifth top-level `src/` directory has no layer
in the dependency-rule fence, no line-budget bucket, and v3 §16's own rule is that no module imports from
`config/` - so a `src/config/` module everything imports would contradict the module map it comes from.

The schema, loader, binder, registry derivation, plan compiler and diff live in `src/domain/config/`; the
YAML adapter lives in `src/infrastructure/config/domain-config-source.ts`; the DATA lives at repo-root
`config/domains/`, which nothing imports and exactly one module reads. Recorded as a deviation exactly as
ADR-0026 recorded the stack deviation.

### 4. `Intent.action` becomes `ActionId`

`Intent.action` was `PrimitiveId`, which conflated a domain's ACTION vocabulary (`distribute-cash`,
`open-account`) with the primitive catalog's ids. Prompt 9's loader rejects an unknown `primitiveId`
against the catalog; sharing the brand made that check ambiguous and parked a domain-named value inside a
type whose name says "primitive". Both are branded `string` at runtime, so this is a compile-time
separation only: no hash preimage, no stored bytes, and no fixture changes.

### 5. The e-sign gate is a verification rule, not a new step kind

An externally-gated step is modelled as a verification rule with `awaitsExternal: true`. Adding an
await/human kind to `ExecutionStep` would change `ExecutionPlan`, which sits inside `DecisionRecord` and
therefore inside the decision-hash preimage, forcing a schema-version bump and a fingerprint re-pin for a
gate the ratified reconciler model already expresses.

### 6. Account opening runs FROM configuration

`src/domain/workflow/flows/account-opening.ts` is deleted. `config/domains/account-opening.yaml` compiles
to a `FlowDefinition` the shipped generic engine drives; `src/infrastructure/wire.ts` composes rather
than describes; command adapters own what a configured `commandType` means, so span names, SQL and audit
codes stay where their fences see them and never come from a file. The shipped page renders its form from
the configuration, with no fallback field list.

The honesty check: **deleting `config/domains/account-opening.yaml` breaks the shipped flow.** It was run.

### 7. Invariant 3's scope and its allow-list

The fence (`src/__tests__/fitness/domain-configuration.test.ts`) derives its forbidden vocabulary from the
published documents' own ids, so a third domain cannot leave it stale, and scopes it to
`contracts/decision-core/`, `contracts/primitives/`, `domain/config/` and `domain/policy/`.

The allow-list required by the ruling currently holds ONE entry: prompt 8's falsification criterion for
`horizon-projection`, whose entire content is "this primitive is wrong if only money movement ever binds
it". Deleting the name would delete the test. It is prose in a data field - never a branch, never a module
name. Growth of this list is an ADR amendment, and the fence proves an entry that suppresses nothing
fails.

## Consequences

- Adding a domain means adding a configuration file, plus a command adapter only if it touches a new
  external system. It never means a flow definition or an engine branch.
- The decision half of `account-opening.yaml` is VALIDATED, NOT YET EVALUATED. Its evaluator arrives in
  Wave D (prompts 16-17) and its proof arrives with the replay corpus. The document says so, in the file.
- Money movement has no execution adapter and no evaluator yet. What is reachable today is its
  VOCABULARY: the demo journey renders its intent slots and evidence rows from the document, bound for
  the branch's firm.
- `yaml` moves from `devDependencies` to `dependencies`: it is now read at runtime by exactly one adapter.
- Nine gaps and corrections are recorded in `docs/domain-config-gaps.md`, classified as the ratified
  prompt requires. Two are corrections to this repo's own earlier design report, and one is a real
  constraint handed to prompt 25.

## Amendment to ADR-0010

ADR-0010 decided that a flow is a declarative `FlowDefinition` plus a per-flow declarative VIEW export,
both authored in TypeScript. Its reasoning stands and its mechanism is unchanged - the generic engine
still interprets declarative flows, and the generic renderer still iterates a declarative field list.

What changes is WHERE the declaration lives. A flow definition and its view are no longer authored as
code; they are COMPILED from a domain configuration document. `accountOpeningFlow` and
`accountOpeningView` are deleted, and `FlowFieldSpec` is replaced by the configuration's own intake
projection. ADR-0010's budget claim ("a workflow costs ~200 lines") becomes stronger, not weaker: a
workflow now costs a configuration file and no TypeScript at all.

## Amendment to ADR-0011

ADR-0011 decided the suspend / await-external / resume contract: a step suspends, an external event calls
`resumeFlow` with a sealed `TenantContext`, token and payload, and resume is idempotent. That mechanism is
unchanged.

What this ADR adds is a caller PRECONDITION on the drive. A configuration is versioned, so a persisted
execution may only be driven by the version it started on - a fact the composition root knows and the
engine cannot. `resumeFlow` therefore takes an optional `ResumeGuard`, evaluated against the state the
engine has just loaded and tenant-checked, and only for the two DRIVEABLE states; returning an `AppError`
refuses the drive, returning `null` proceeds. Checking the version in the caller instead would load the
row twice, and the version checked would not provably be the version driven (D-230/D-239). A MISSING
version is LEGACY and resumes - it predates the pinning, so refusing it would strand every in-flight
execution on deploy; a KNOWN and DIFFERENT one refuses, and a recorded value that is not a version string
fails closed as its own stage. Those refusals are operator-recoverable, so they reach the provider as
`retry-later` (503 plus `Retry-After`) rather than as a discarded signature.

## Alternatives considered

- **Schema in `contracts/`.** Rejected: there is no contracts-layer consumer (`DecisionInputBundle` pins
  only a ref), it would spend the ADR-0029 ratchet-down promise, and `knip.json` treats `src/contracts/**`
  as an entry point, which would silently exempt ~2,000 lines from charter #5's dead-export gate.
- **A decision-shaped account opening** (real identity evidence, registration eligibility, approvals).
  Rejected by the captain's ruling: it changes shipped user-facing behavior and needs evidence sources
  not planned until Wave C.
- **Splitting the finalize fan-out into three capabilities.** Deferred to prompt 25 and recorded in the
  gap report: the ruling is behavior-preserving, and splitting changes the audit and span shape the
  shipped observability fence and integration test pin.
- **A `domain_config` arm on `VersionedSourceRef`.** Rejected: a domain-sourced prohibition would carry
  no version lineage a firm or an examiner could inspect. The configuration declares the prohibition
  VOCABULARY; instances always cite one of the three ratified arms.

## Revert path

Restore `src/domain/workflow/flows/account-opening.ts` from git history, restore the direct
`accountOpeningFlow` wiring in `src/infrastructure/wire.ts`, and revert `v3-invariants.json` invariant 3
to `not-yet-active` with its ratchet entry. The configuration files and the schema can remain: they would
become inert, which the fence would then report as dead configuration - so the revert is loud, not quiet.
