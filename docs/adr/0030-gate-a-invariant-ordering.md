# ADR-0030: Gate A owns invariants 1, 2, 4, and 5; invariant 3 is gated at B

**Status:** Accepted (amends ADR-0023); amended in place 2026-07-28 and 2026-07-29 by review rulings `gatea-opus-review-1`, `gatea-fix-review-2`, `gatea-review-3`, `gatea-fix-review-3`, the captain-approved outcome-completeness review, the captain-approved earliest-proof/completeness review, the captain-approved enforcement-completeness review, the captain-approved false-green boundary review, the captain-approved execution-reachability review, the captain-approved executable-evidence review, the captain-approved enforcement-integrity review, the captain-approved runner-and-alias review, the captain-approved control-flow, artifact, mechanism, and matrix review, the captain-approved route-and-capture-integrity review, the captain-approved active-ratchet, TestInfo, wrapper, and ratified-surface review, the captain-approved reachability and delivery review, the captain-approved callable-provenance and Gate 0 route-graph review, the captain-approved callback, assertion, renderer-ID, and runner-ratchet review, the captain-approved indirect-call, page-integrity, hook-isolation, and approval-binding review, the captain-approved shared-ratchet, reflective-call, Vitest-registration, and route-inventory review, the captain-approved fitness-inventory and execution-provenance review, the captain-approved recursive-inventory and bound-reflection review, the captain-approved gate-local evaluator proof and single-run fitness review, the captain-approved cross-gate proof and imported Axe-graph review, the captain-approved complete fitness, CommonJS, graph-root, and Vitest-global review, the captain-approved registration-option, declarative-route, and precedence review, the captain-approved callable-member, helper-syntax, and parameterized-registration review, the captain-approved registration-input, computed-member, login, builtin-loader, and container-environment review, and the captain-approved CI provenance, imported-registration, query-helper, and shared-hook review
**Date:** 2026-07-28
**Deciders:** captain (durable ruling, decision key `gate-a-ordering`, 2026-07-28; subsequent review findings approved 2026-07-28), founding architect
**Relates to:** ADR-0023 (v3 adoption - §17 becomes phase-gated commitments); ADR-0010 (generic workflow engine); ADR-0025 (money movement as configuration, never a core module); ADR-0026 (fences land in the wave that creates their subject); charter #1 (fence every invariant in the same PR that states it), #4 (detection is not verification), #5 (nothing built-but-not-shipped / no fake green)
**Informed by:** `docs/v3/verin-prompt-sequence-v3.md` (Gate A at prompt 7; prompt 10 in Wave B), `docs/v3/marriage-map.md` C10 (the account-opening flow definition migrates to `config/domains/`), v3 §17 preamble ("CI reports active, not-yet-active, or failed - never fake green")

## Context

Gate A closes Wave A (prompts 4-7). As ratified, it read "Foundation invariants 1-5 are active and
green," and `v3-invariants.json` registered all five foundation invariants at gate A.

Invariant 3 - "no core module, directory, or evaluator branch is named for a decision domain" - cannot
be activated inside Wave A. Its implementation prerequisite is **prompt 10** (Wave B, prompts 8-11),
where the ADR-0010 account-opening flow definition migrates into the domain-configuration system and
both example domains become data (`config/domains/*.yaml`). ADR-0023 and ADR-0025 already record that
migration as Wave B work, and the registry entry for invariant 3 already carried it as a written
`PRE-CONDITION`.

That produced a circular dependency in the governance itself:

- Gate A cannot go green until invariant 3 is active and green.
- Invariant 3 cannot go active-green until prompt 10 lands.
- Prompt 10 is in Wave B, which cannot begin until Gate A is green.

The cycle has exactly three exits: move prompt 10 ahead of the vocabulary prerequisites it depends on
(prompts 8-9), declare invariant 3 green on Wave A substrate that does not implement it, or move the
invariant's activation requirement to the gate that actually covers its prerequisite. The first
re-orders the build against its own dependencies; the second is fake green, which v3 §17 and charter #5
forbid outright, and would put a false claim into the invariant report, the proof log, and any UI that
renders phase state. The captain ruled for the third.

## Decision

The captain's durable ruling (decision key `gate-a-ordering`, 2026-07-28) is adopted verbatim:

1. **Gate A requires invariants 1, 2, 4, and 5 to be active and green.**
2. **Invariant 3 remains honestly `not-yet-active`** until prompt 10 migrates account opening into the
   domain-configuration system.
3. **Gate B requires invariant 3 to be active and green.**
4. **Wave B may begin only after prompts 5, 6, and 7 have landed and Gate A's corrected requirements
   are green.**
5. **No document, proof, or UI may claim invariant 3 is implemented before prompt 10 exists.**

The ruling is implemented as machine-checked structure, not prose:

- `v3-invariants.json` gains a structured `gates` map covering **every gate of the ratified sequence**
  - `0` (prompts 1-3), `A` (4-7), `B` (8-11), `C` (12-15), `D` (16-19), `E` (20-22), `F` (23-26),
  `G` (27-28), `H` (29), `I` (30). Each gate declares its `wave`, `prompts` `[first, last]` range,
  `requires` list, structural `entryGates`, `entryCondition`, and `outcome`. Invariant 3's `gate` moves
  from `A` to `B`.
- Every not-yet-active invariant declares `activationPrompts` - the prompt numbers whose landing
  activates it - so "later wave" is a decidable relation instead of a reading of prose.
- Every declared `activationPrompts` array is validated regardless of activation status. Active
  invariants cannot retain invalid proof metadata after activation, and the complete proof metadata for
  every cross-gate invariant reference is ratcheted exactly.
- Invariant 3 declares `activationArtifacts`: `config/domains/account-opening.yaml` and
  `config/domains/money-movement.yaml`. It may not be flipped to `active` until those prompt-10
  artifacts exist on disk. That is ruling 5 in mechanical form.

**Two relations, not one (review ruling `gatea-opus-review-1`).** The first cut made
`gates.<G>.requires` a list of invariant ids fenced EQUAL to the set of invariants carrying gate `<G>`.
That conflated two different things and made the model incomplete: gates whose outcome is artifact- or
evidence-based (0, C, I) owned no invariant, so they could not be registered at all - while v3's Gate C
subject ("no PII in LLM artifacts") is invariant **1**, which the ruling pins to Gate A. The two
relations are now separate:

- **Activation ownership** - `invariant.gate` names the one gate at which that invariant's activation
  is proven. The ordering rule is computed against it, and a gate MUST require every invariant it owns,
  so ownership can never drift silently away from the requirement list.
- **Gate requirement** - `gates.<G>.requires` is a list of TYPED requirements: `invariant`, `artifact`,
  `fitness`, `ci-gate` (all machine-checkable) and `evidence` (an outcome clause with no executable
  proof yet, which must carry a note saying why, and which can never read green). A gate may
  additionally REFERENCE an invariant another gate owns, provided that invariant is fully proven by the
  time the referencing gate closes - Gate C restates invariant 1 over the intake and evidence paths
  without taking it from Gate A.

The ordering rule generalizes to every typed requirement: **nothing a gate requires may land after that
gate closes**. A gate declaring no machine-checkable requirement is rejected outright, because an empty
set would read green the moment it was registered - empty sets never prove readiness.

**Every declared outcome is represented by a typed requirement.** Invariants alone did not cover Gate
B's prompt-11 stable corpus, Gate F's prompt-26 verification reconciler, or Gate H's seven-minute timing,
measured-results, and cold-review clauses. Those clauses now remain explicit `evidence` requirements
until their prompt-owned mechanisms land. They keep the gate non-green and preserve the full outcomes
instead of narrowing the outcomes to whatever the current invariant list happens to prove. Invariant
23's proof point now includes prompt 26 because its subject includes status occurrences, not execution
events alone.

Gate B also carries a prompt-10 `evidence` requirement that both domain YAML files parse against the
domain schema and bind through the shared engine without domain-specific core branches. The two artifact
requirements prove only that files exist. Until prompt 10 lands an adversarial schema-and-binding fitness
mechanism, empty or invalid YAML remains explicitly unverifiable and Gate B cannot turn green.

**Proof points, not status (review ruling `gatea-fix-review-2`).** The first cut of the ordering rule
read an already-`active` invariant as needing no future prompt, which made the reference DIRECTION
undecidable: `gates.A.requires` could name invariant 7, which Gate D owns, and pass. The rule now
compares a requirement's PROOF POINT - the prompt by which it is fully proven - against the requiring
gate's closing prompt. An invariant's proof point is the last of its `activationPrompts`, and, when it
declares none, the closing prompt of the gate that owns it, read off the canonical ordered gate ranges.
This is deliberately STATUS-INDEPENDENT: a rule whose verdict flips the moment an invariant activates is
not a structural rule, and the fallback is fail-closed, so `activationPrompts` is a permanent record of
when an invariant landed rather than a to-do list. Invariants 7, 8, and 9 permanently record prompt 5 as
their proof point, and Gate A requires those structural guarantees at the earliest gate that can fully
prove them. Their activation ownership stays at Gate D, which later re-asserts the distinct evaluator
behavior. Gate D carries a separate prompt-17 typed evidence requirement for evaluator property tests,
so the global `active-pass` produced by the prompt-5 schema fence cannot satisfy both proof contexts.
When prompt 17 lands, that named gap becomes a gate-local `fitness` requirement. Dropping the prompt-5
record makes the proof point fall back to Gate D's close and breaks Gate
A, rather than silently postponing an already-proven invariant.

Validation applies to active and not-yet-active invariants alike. A declared proof list must be
non-empty, contain unique prompt numbers inside the 1-30 sequence, and include every prompt named by
`activatesWhen`. A fourth ratchet derives the complete cross-gate reference inventory and pins its proof
metadata: invariant 1 at prompt 6, invariants 7-9 at prompt 5, invariant 11 at prompt 15, invariant 16 at
prompt 9, and invariants 18-19 at prompt 18. Changing any of them to an earlier valid prompt fails even
when the general ordering rule would still pass, and a new cross-gate reference fails until its proof
metadata is added to the same governed ratchet.
The active-invariant ratchet also pins every complete mechanism tuple, including type, reference, and
CI command where present. An active invariant therefore cannot keep its status while redirecting its
proof to an unrelated passing fitness file. The active invariant ID set must exactly equal the ratchet
key set, so activating another invariant with an unrelated passing mechanism cannot bypass review.
This validator and its ratchet live in `scripts/v3-gates.lib.ts`; both the registry fitness test and
the blocking `scripts/v3-invariants.ts` runner invoke the shared rule. The authoritative command
therefore fails before reporting any newly active or repointed invariant that lacks the reviewed tuple.

**Requirements sit at the earliest gate that can prove the WHOLE invariant** (same ruling), never at the
first gate that touches part of one. Gate A therefore requires invariants 7, 8, and 9 because their
contract-level illegal states are fully excluded at prompt 5. Gate B requires invariant 16 - the closed
policy AST and its load-time validator are complete at prompt 9, inside Wave B - and Gate C requires
invariant 11, whose validation stage is complete at prompt 15, inside Wave C. Ruling
`gatea-fix-review-3` applies the same test to the two remaining outliers:
**Gate D additionally requires invariants 18 and 19**, whose approval-stage
definition and approval-invalidation-on-hash-change are both complete at prompt 18, inside Wave D. None of
these four changes ACTIVATION ownership: 16 stays owned by Gate E, 11 by Gate D, and 18 and 19 by Gate F,
each re-asserting it over the subject that gate builds. Invariant 6 stays a Gate D requirement only,
because it needs BOTH prompt 15's input bundle AND prompt 16's evaluator; requiring it at Gate C would be
the mechanical over-reach this rule rejects. The reason is recorded per invariant in the registry, so the
ownership/requirement distinction survives the edit.

**Gate G and Gate H are two gates, as ratified** (same ruling). The registry inherited a merged `G/H`
[27, 29] label from before this ADR, and the first cut promoted that label to an authoritative prompt
range asserted as ratified - which the wave map is not: it declares **Gate G over prompts 27-28** ("the
full journey uses a real Salesforce invocation and an honestly labeled returned status") and **Gate H
over prompt 29** (investor demo hardening) separately. Under the merged label, invariants 26 and 30 -
provable at prompt 28 - were required only by a gate closing at 29, the same hole the earliest-gate rule
closes elsewhere. Split: Gate G owns and requires 26, 28, and 30; Gate H owns and requires 27 and 29,
whose proof points are prompt 29. This moves the registry TOWARD the ratified sequence, so it needs no
reading key; ADR-0024's prompt-27 Salesforce deferral still governs Gate G, and Phase 1 is never declared
complete on fakes.

Where those two clauses meet, the ruling's own general statement ("a gate may reference an invariant
owned by the same or an earlier gate, never a later gate") and its specific instruction ("Gate B must
REQUIRE invariant 16 ... invariant 16 stays owned by gate E") cannot both hold literally. The specific
instruction governs, and the general rule is implemented in its provable form: a gate may reference an
invariant any gate owns **as long as that invariant's proof point is at or before the referencing gate's
close**. Gate A therefore legally references the active, Gate-D-owned invariants 7, 8, and 9 at their
recorded prompt-5 proof point, and the same rule stays correct when invariant 16 activates.

**A CI job NAME is not evidence** (same ruling). `ci-gate` requirements and `ci-gate` invariant
mechanisms previously matched by substring, so a three-character token like `e2e` stayed "met" off a
comment or a file path after the blocking job was deleted. The workflow is now parsed structurally into
`job -> the commands its steps run`, and every `ci-gate` must name the `command` its job actually runs.

**That parse is a real YAML parse, and a restricted shell parse on top of it.** The first
structural cut was a hand-rolled line scanner, which is the same class of defect one level down: it read
a column-0 comment as leaving the `jobs:` block, silently dropping every job declared after it - including
the blocking `v3-invariants` job itself - and it collected block-scalar lines indiscriminately, so a
commented-out command still proved its own gate. `parseCiJobs` now uses the `yaml` package and walks
`jobs.<key>.steps[].run`. YAML alone is NOT enough: inside a `|` block scalar a `#` is literal script
text, so the parser correctly hands over `# pnpm audit:chain temporarily disabled` and only the SHELL
treats it as disabled. Each `run` script is split into logical lines with shell comments stripped
(quote-aware) and `\` continuations rejoined. A requirement is proven only by a dedicated simple command
whose exit status controls its step. An echo argument, `false && command`, a heredoc, `command || true`,
or any other compound or multi-command script may mention the required bytes but cannot prove the
command executes and gates the step. The audit seed and chain verification therefore run in separate CI
steps. A workflow that cannot be parsed yields no jobs, so every `ci-gate` reads unmet.

The parser resolves the effective shell through workflow `defaults.run.shell`, job
`defaults.run.shell`, and step `shell` precedence. It supports the implicit POSIX shell only on a
literal Ubuntu or macOS hosted runner and the built-in `bash` and `sh` shells. Unsupported runners,
non-string shells, and custom shell templates such as `echo {0}` fail closed because the restricted
command grammar cannot prove their execution or exit-status semantics.

The workflow itself must run on every normal `push` and `pull_request`. Manual-only activation and
branch, path, or event filters make every mapped command non-evidence. Effective
`working-directory` is resolved through workflow defaults, job defaults, and step overrides; mapped
commands must execute at the repository root. Every CI-backed requirement invokes its owned binary or
entry point directly, so changing a same-named `package.json` script to a no-op cannot preserve proof.

**A present command that cannot fail the build is not a blocking gate** (ruling `gatea-fix-review-3`).
Parsing `jobs.<key>.steps[].run` proves a command is THERE; the failure message, the registry, and this
ADR all claim more than that - a BLOCKING job. `continue-on-error: true` at either the job or the step
level leaves the command running and its failure ignored, and a step or job `if:` can exclude it from the
normal push/PR run entirely; either way `audit-chain-verify` kept proving invariant 5 while chain
verification no longer gated anything. `parseCiJobs` now records what neutralizes a job or a step, and a
neutralized one proves nothing. This is fail-closed on `if:` deliberately: a GitHub expression is not
decidable here, so an always-true condition must be restated in the registry's terms rather than trusted.
Present-but-disabled is now closed at all three levels it was reachable - the job (`continue-on-error`,
`if:`), the step (the same two), and the script (comments, compound control flow, or exit-status
neutralization). Missing jobs, missing dedicated commands, unsafe shell mentions, and neutralized
commands are diagnosed distinctly.

An evidence job with a non-empty `needs` dependency is also non-blocking under the restricted evidence
contract. A dependency can be skipped by its own condition and cause the evidence job never to run while
the workflow remains successful. `parseCiJobs` therefore rejects dependency-bearing evidence jobs rather
than attempting to model GitHub's transitive job-result semantics.
An evidence job using `strategy.matrix` is rejected for the same reason. Matrix exclusions can eliminate
every job combination while GitHub reports the skipped job successfully, so the restricted contract
does not treat a local command as executed when matrix reachability is undecidable.

**One structural CI authority, three call sites** (same ruling). `charter-map.json`'s enforced `ci-gate`
mechanisms were still proven by `ci.includes(ref)` in the charter-drift fence, so a deleted job matched
its own leftover comment (proved: injection 24). Check (a') now goes through the same `parseCiJobs`.
Every enforced charter-map entry names and ratchets its exact direct command. The lower-level
`ciJobBlocks` query still fails unless a job contains at least one valid non-neutralized executable
step, so an empty job cannot satisfy even the weaker job-level claim. Charter rule 9 now names `e2e`
plus `pnpm exec playwright test` and maps an
Axe-specific fitness fence that proves the public, authenticated, and demo E2E specifications execute
Axe through an enabled and reachable Playwright test. The required specifications await one sanctioned
helper, and the fence pins that helper to the exact non-mutating document-animation settlement, a complete
WCAG-tagged analysis, and a direct assertion over the unmodified `results.violations` array. The assertion
cannot be caught, filtered, mapped, emptied, hidden behind extra statements, or masked through a
side-effecting optional assertion message. Test registration is
accepted only at module scope or directly inside an enabled module-scope `test.describe` callback.
Skipped descriptions, file or describe scope skip/fixme annotations, expected failures, runtime skips,
statically dead branches, unawaited helper calls, caught helper calls, and tests inside uncalled
functions prove nothing.
Keeping an ordinary Playwright job while deleting or neutralizing every Axe scan can no longer leave
charter-drift green. Both v3 governance mappings are ratcheted to the exact blocking
`pnpm exec tsx scripts/v3-invariants.ts` command, so either mapping cannot regress to a name-only job
check. The fence also parses `playwright.config.ts`, forbids focused-test exclusion, rejects selectors that exclude required tests,
binds each required specification to its typed route group and loaded-state assertion, and resolves
direct, computed, destructured, aliased, and namespace-imported Playwright neutralization calls through
their imported symbols. Parentheses and TypeScript assertion wrappers are normalized before symbol
resolution. Required tests and their directly registered hooks reject `testInfo.skip`,
`testInfo.fixme`, and `testInfo.fail`, including member aliases, destructured callback parameters, and
TestInfo values returned by `test.info()`. A multi-argument `defineConfig` is
rejected because later arguments override
earlier selection settings. Each sanctioned route loop is a direct statement of its enabled registered
test, outside uncalled functions and caught branches. Its route collection must come from a stable import
or immutable alias rather than a later assignment, and any reachable callback exit before the loop makes
the scan non-evidence. The shared AST control-flow proof applies the same rule to canonical screenshots.
Positive Axe-helper proof also requires stable imported callable provenance: a later assignment, including
one hidden in unreachable control flow, cannot turn a no-op alias into evidence. Neutralizer provenance
follows Playwright members invoked through `bind`, `call`, or `apply` and transitively invoked local
helpers. Reflective provenance also follows `Reflect.apply.bind(...)` directly, through stable aliases,
and when the bound callable is invoked through `call` or `apply`; unresolved local callable indirection fails closed. A required route-scan callback admits only
its typed route loops and a stable canonical login call. The login helper is pinned to its uninstrumented
browser flow, and required specifications may register no Playwright hooks. `addInitScript`, response
replacement, or comparable caller-side page setup therefore cannot mask the surfaces before analysis.
The fence follows every runtime local import reachable from the required specifications and sanctioned
helpers, including side-effect imports, re-exports, configured TypeScript aliases, literal dynamic
imports, and direct CommonJS imports. Indirect CommonJS loader provenance, including aliases of
`require`, ambient `module.require` members, unresolved computed members on ambient `module`, and
destructured loader members, is non-evidence until the
graph can resolve the invoked target completely. Every reachable local module, including every named
graph root, is subject to the same prohibition on Playwright hook registration and may not import the
Axe runtime outside the exact sanctioned helper. The complete graph also rejects Playwright
`skip`, `fixme`, and `fail` neutralizers, including side-effect modules whose only purpose is to
neutralize a required scan during import. Unresolved local imports and non-literal runtime
imports are non-evidence. Bare runtime imports must
either resolve through the directly parseable TypeScript path configuration or belong to the exact
Playwright/Axe dependency allowlist.
Playwright hook provenance also follows callable values through statically named object properties,
member assignments, and direct or aliased `Object.assign` calls, including when the object itself is
invoked through an alias. Binding a hook into a mutable wrapper therefore cannot hide registration.
The sanctioned Axe helper has exactly two plain parameters and its builder receives exactly the
side-effect-free shorthand object `{ page }`; parameter defaults, rest or destructured parameters,
computed configuration, spreads, and extra properties are non-evidence. The four Axe route
collections are accepted only as non-empty, directly frozen literal lists of directly frozen literal
entries in a runtime-branch-free module. Their contents therefore cannot differ between the Vitest and
Playwright processes. Route inventory uses Next's installed route ordering to assign each concrete URL
to its winning static, dynamic, catch-all, or optional catch-all page, and every page must win at least
one scanned URL.
Configuration property names are normalized across direct and computed literal syntax at the root and
project levels. A computed name that cannot be resolved statically makes the configuration non-evidence
instead of leaving open a hidden selection override.

**Registration and execution inputs are immutable and explicit.** Vitest registration option objects and
parameterized case collections are accepted only as immediate literals or direct frozen literals, so a
later member assignment or array mutation cannot change the registration after the fence has read its
initializer. Playwright member names resolve static concatenation and stable literal aliases, while an
unresolved computed member rooted at the imported Playwright API makes the complete Axe graph
non-evidence. The canonical login helper has exactly two plain required parameters with no defaults,
rest, optional, or destructured form, and every authenticated route scan passes the stable principal
explicitly. Ambient `process.getBuiltinModule("module")` construction, including stable aliases, is
rejected anywhere in the required runtime graph because it can manufacture an untracked `createRequire`
loader. Governed CI commands resolve environment configuration across workflow, job, job-container, and
step scope; an execution-affecting container environment override is non-evidence under the same rule as
the other inherited scopes.
Every predecessor of a governed command must be one exact ratcheted checkout, toolchain setup,
dependency install, or already-governed command step. Unreviewed actions, commands, step fields, action
inputs, and environment values are non-evidence because they can alter `GITHUB_PATH`, `GITHUB_ENV`,
repository files, or the governed entry point before the exact command runs. Container evidence is
restricted to the ratcheted `semgrep/semgrep` image and rejects additional execution-shaping fields;
an unapproved, non-literal, or augmented container is non-evidence.

**Fitness registration ownership includes the local runtime import graph.** Charter-drift resolves every
local runtime import reachable from each fitness entry. Imported fitness helpers may not import the
Vitest runtime or register suites or tests. Enforcement registration stays owned by the inventoried
entry file, so moving a disabled registration behind a side-effect import cannot preserve a passing
companion in the entry file.

**Gate 0 surface completeness is executable.** The prompt-3 evidence gap is replaced by
`demo-surface-completeness.test.ts`. A typed twelve-surface manifest is equal to the normative
`docs/demo-contract.md` section 4 list, and both are ratcheted to the exact twelve identities in the
SHA-pinned `docs/v3/verin-demo-contract-v1.md` section 4 contract. Every dynamic route case returns the
component imported from the manifest's exact component path, every component exists, and the dynamic
page's validated return must be provably reachable. The page passes the exact resolved scenario and firm
identifiers to `getJourney`, and an exhaustive scenario-by-firm proof checks that the service preserves
the recorded branch, firm, outcome class, and disposition. The renderer's approval input is bound by
symbol to the exact `first(sp.approved) === "1"` query-derived declaration. The `first` helper itself
is pinned to one plain parameter and the exact identity-preserving
`Array.isArray(v) ? v[0] : v` return, with the unshadowed built-in `Array`. The canonical journey must
click the complete ordered set of accessible product controls, including the source-verification button.
Its complete top-level statement graph is restricted to those clicks, read-only loaded-state assertions,
and sanctioned helpers, and the specification may register no Playwright hooks. Gate 0 and the Axe
import-graph fence use the same shared hook-provenance authority, including object-property storage,
member writes, `Object.assign`, `Object.defineProperty`, `Reflect.set`, and invocation wrappers. DOM mutation, injected
controls, screenshot stubbing, or alternate navigation therefore cannot manufacture the route graph or
its evidence.
It directly awaits each surface
screenshot in order. Each `snap` call names its manifest station,
and the helper verifies the station URL plus its surface-specific loaded marker before directly awaiting
`page.screenshot` into `demo-screens` and asserting that the returned capture is non-empty. The
blocking E2E gate reaches every typed demo route and waits for its surface-specific loaded marker.
After Playwright completes, a dedicated blocking command checks that every canonical screenshot exists
and is non-empty. The artifact upload sets `if-no-files-found: error`, rejects
`continue-on-error`, and accepts only unconditional execution or the existing `!cancelled()` predicate,
so an early test return, false condition, or swallowed upload failure cannot leave the job green with no
deliverable.
Gate 0 now computes green, and remains the structural predecessor of Gate A.

**Entry conditions are executable dependencies, not display copy.** Every gate declares structural
`entryGates` alongside its human-readable `entryCondition`. The rule set requires both forms to agree,
requires every predecessor to be registered and earlier, and ratchets the chain
`0 -> A -> B -> C -> D -> E -> F -> G -> H -> I`. Readiness is computed in that order and a gate remains
non-green while any predecessor is non-green. Gate B therefore cannot report green while Gate A is
non-green, even when every local Gate B requirement is met. The same metadata ratchet pins each gate's
`wave`, `entryGates`, `entryCondition`, and `outcome`, so a material outcome cannot be added or narrowed
without the corresponding typed requirements and ADR amendment.

**A gate's `awaiting:` line names everything holding it back** (ruling `gatea-review-3`). The report previously
listed the unmet requirements OR, only when there were none, the undecidable ones - so gate C printed
`awaiting: #1 · #11` and stayed silent about the `evidence` clause that will hold it below green after
those two go green. `GateView.blocking` is now the full set, with the undecidable subset exposed
separately so the report can name it as such. The state machine is unchanged: green still requires zero
unmet AND zero undecidable requirements.

**One rule set, two callers.** The rules live in `scripts/v3-gates.lib.ts` (the same split as
`scripts/golden-cases.lib.ts`). `src/__tests__/fitness/v3-gate-ordering.test.ts` owns the adversarial
half - it proves each rule rejects a real violation - and `scripts/v3-invariants.ts` runs the identical
set before it prints anything. The report is itself a document bound by ruling clause 5, so it may not
emit a claim the fence would reject; enforcing a subset there (the first cut re-checked only the
ordering rule) left the report free to make claims about activation artifacts and gate integrity that
nothing verified. The runner computes per-gate readiness from the typed requirements: **green only when
every requirement is met, every requirement is decidable here, AND every structural predecessor is
green.**

**The activation and enforcement boundaries fail closed.** Invariant 3 declares the two prompt-10
domain YAML files and the exact future `src/__tests__/fitness/domain-configuration.test.ts` mechanism as
activation prerequisites. Marking it active requires that exact fitness mechanism to exist and appear in
the invariant's live mechanism list, so an unrelated naming fence cannot produce `active-pass`.
Charter CI mappings all name and ratchet their exact commands; malformed, empty, unsupported-shell, or
fully skipped jobs prove nothing. Required Axe tests reject module- and describe-scope skip/fixme
annotations, `test.fail`, wrapped imported neutralizers, and TestInfo neutralizers in required tests or
their registered hooks, including TestInfo obtained from `test.info()`. The sanctioned helper pins the
exact non-mutating document-animation settlement
before its complete WCAG scan. Playwright selection settings, route groups, loaded-state markers, and
imported annotation aliases are part of that proof.

**Reading key for the ratified documents.** `docs/v3/verin-prompt-sequence-v3.md:186` still reads
"Gate A: Foundation invariants 1-5 are active and green." The ratified v3 documents are committed
verbatim and SHA-256-pinned; per `docs/v3/README.md` and v3 orchestrator rule 4, a conflict between v3's
letter and this repo is resolved by an ADR, never by a silent edit to the ratified text (the same
mechanism used by ADR-0024 for prompt 27 and ADR-0026 for §18's stack). That sentence is therefore read
through this ADR: **Gate A owns foundation invariants `{1, 2, 4, 5}` and also requires the prompt-5
structural guarantees `{7, 8, 9}` at their earliest proof point; `v3-invariants.json` is the
authoritative, executable statement of every gate's complete requirements.** Invariant 3 is not
weakened, waived, or deferred without a trigger - it is required, in full, at Gate B.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Move prompt 10 into Wave A to satisfy Gate A | Domain configuration binds primitives (prompt 8) and the policy AST (prompt 9); pulling it forward runs the build against its own dependency order and would overfit the primitive vocabulary to whatever prompt 10 needed first (v3 §20 risk 3). |
| Declare invariant 3 active-green on the Wave A scaffold (no domain-named directories exist *yet*) | Fake green. The invariant's subject - decision domains expressed as data - does not exist in Wave A, so a fence over it would pass vacuously, which charter #4 names as worse than no fence. It would also put a false "implemented" claim into the report, the proof log, and any phase-state UI. |
| Waive invariant 3 from every gate | A silent deferral with no trigger, forbidden by the charter; invariant 3 is the transferability guarantee (v3 non-negotiable 7, ADR-0025) and is exactly what must be proven when the domains become configuration. |
| Edit `docs/v3/verin-prompt-sequence-v3.md` line 186 and re-pin its SHA-256 | Rewrites a captain-ratified source document to say something it did not say. The pins exist so the ratified text stays fixed and conflicts surface as ADRs (`docs/v3/README.md`); ADR-0024 and ADR-0026 already override v3's letter without touching its bytes. |
| Register only the gates that own an invariant (leave 0, C, and I out) | Gate D's own entry condition cites "Gate C is green" - a precondition nothing could compute. An unregistered gate is not an absent requirement, it is an unverifiable one. |
| Give gates 0, C, and I an invariant of their own so `requires` can stay an id list | v3's Gate C subject IS invariant 1, which the ruling pins to Gate A; manufacturing a second owner would contradict the ruled set, and §17's 30 invariants are fixed - none may be added or restated to make a gate registrable. |
| Let a requirement-less gate render green and rely on review to catch it | Registration would confer readiness. A gate with nothing to decide is exactly the fake green this ADR exists to remove. |
| Keep deciding the ordering rule from `status: "active"` (treat an active invariant as needing no future prompt) | The verdict then flips when an invariant activates - a reference legal today becomes illegal at the moment the work lands - and the reference DIRECTION is undecidable in the meantime, so a gate could read green on an invariant a later gate owns. |
| Move invariant 16 to Gate B and invariant 11 to Gate C so "reference only earlier-owned invariants" holds literally | That changes ACTIVATION OWNERSHIP, which the ruling forbids: Gate E must still be the gate that proves invariant 16 over the policy lifecycle it builds. Ownership and requirement are separate relations precisely so this trade is not necessary. |
| Prove a `ci-gate` by searching ci.yml for the job name | A three-character token like `e2e` matches a comment, a path, or a `pnpm test:e2e` invocation in an unrelated job, so the requirement keeps reading "met" after the blocking job is deleted - the weak/tautological check charter #4 calls worse than no check. |
| Keep the hand-rolled line scanner and patch the two reported holes | A regex scanner pretending to understand YAML has an open-ended tail of holes, and this one is load-bearing for both gate readiness and invariant mechanisms. Two were confirmed by repro (a column-0 comment dropping four jobs; a block-scalar comment proving its own disabled command) and a third was reachable by indentation alone. `yaml` is already a declared dependency used by three other fences. |
| Parse the workflow with YAML and stop there | Inside a `\|` block scalar a `#` is script text, not YAML syntax, so a correct YAML parse still returns `# pnpm audit:chain temporarily disabled` as the run value. Counting it would let one PR switch a blocking gate off and keep its invariant reading `active-pass` (proved: injection 17). |
| Leave `awaiting:` listing only the unmet requirements | A gate's `evidence` clauses hold it below green after everything else goes green, so omitting them tells a reader planning the wave less than the gate actually needs - understating an obligation in the report the honesty ruling binds. |
| Pin only Gate A and Gate B in the fence and trust review for the rest | Gate assignment decides which gate can never go green without an invariant. Moving one to a later gate while updating both `requires` lists passes every structural rule (proved: injection 14), so nothing would surface it. |
| Ratchet each gate's invariant ids and leave its artifact/fitness/ci-gate/evidence requirements unpinned | Gate 0's only unmet requirement was its `evidence` clause; deleting that one entry left every structural rule passing, both prior ratchets passing, and the report printing `✓ green` for a gate whose §4 surface completeness nothing decides (proved: injection 21). A gate must not be able to earn readiness by dropping what it cannot prove. |
| Keep the merged `G/H` gate and record the divergence as a reading key instead | A reading key is for a conflict this repo cannot resolve without rewriting ratified bytes. Here the ratified wave map is right and the registry label was inherited: splitting it needs no permission, and the merge was hiding a real hole (invariants 26 and 30 provable at 28, required only at 29). |
| Prove a `ci-gate` by finding the job and its command, without checking whether the job blocks | "Blocking" is the claim the failure message, the registry, and this ADR make. `continue-on-error: true` is a one-line edit that keeps every structural check green while the gate stops gating (proved: injections 22 and 23) - present-but-disabled, one level up from the shell comment. |
| Let charter-drift keep its substring check because charter-map names no command | The weaker claim is still checkable structurally: a job KEY exists and is not neutralized. A substring matched a deleted job's own leftover comment (proved: injection 24), which is the tautological shape charter #4 rejects regardless of how much else the entry declares. |
| Resolve a charter-map `ci-gate` ref against job DISPLAY names, so `axe` and `unit` keep matching | A display name is text, not a gate: deleting the axe scans while keeping the job title "e2e (Playwright + axe)" would still pass. Naming the blocking job key that runs them is the honest form, and the entry titles still record which capability each gate is mapped for. |
| Treat a dependency-bearing evidence job as blocking by inspecting only its own steps | A skipped or failed dependency can prevent the mapped command from running. Modeling every transitive GitHub job-result rule is broader than this evidence parser; the stricter contract is simple and fail-closed. |
| Infer arbitrary per-spec Axe result transformations and assertions | Dataflow inference admitted filters that erased every violation and assertions swallowed by `catch`. One sanctioned helper makes the executable accessibility contract small enough to fence structurally. |
| Let a name-only charter CI mapping prove an empty job | A job key with no executable blocking step says nothing about enforcement, and setup commands do not prove the named control. Every enforced mapping now binds and ratchets the exact command it claims. |
| Let any awaited `page.evaluate` count as animation settlement | An evaluate callback can clear or rewrite the DOM before Axe scans it. The helper has one sanctioned, non-mutating settlement expression, so masking callbacks fail structurally. |
| Treat a filtered or manual-only workflow as normal CI evidence | A valid command that does not run for ordinary pushes and pull requests is not a blocking repository control. Trigger filters therefore invalidate the whole workflow as evidence. |
| Accept package-script names as owned entry points | A script body can become `true` while the workflow and every exact command mapping stay unchanged. Mapped controls invoke their binary or owned source entry point directly. |
| Prove Axe from required spec source without parsing Playwright selection or route state | `testIgnore`, `testMatch`, `grep`, a wrong route, or a pre-load scan can leave source text intact while the required UI never gates. Configuration, route groups, and loaded markers are one structural proof. |
| Inspect only the directly named Axe files | A side-effect import can patch `AxeBuilder.prototype.analyze` or register a Playwright hook before the required scan. The complete runtime local import graph is part of the evidence boundary. |
| Exempt named Axe graph roots from imported-runtime and hook checks | The shared login helper is a root, but only its function body was pinned. A module-scope hook or Axe patch beside that function could still run before every required scan. |
| Follow only direct CommonJS `require()` calls | `const load = require; load("./poison")` and ambient `module.require("./poison")` execute the same module while leaving the direct-call graph unchanged. Unresolved loader provenance must fail closed. |
| Ignore `process.getBuiltinModule("module")` because it is not CommonJS syntax | The returned module namespace constructs `createRequire`, so an untracked local module executes with the same authority as direct CommonJS loading. |
| Inventory only `.test.ts` fitness files | Vitest also admits `.test.tsx`, `.spec.ts`, and `.spec.tsx`; a second matcher silently drops those files from execution completeness, disabled-registration checks, and companion enforcement. |
| Resolve disabled Vitest registrations only through imports | `globals: true` makes unshadowed `describe`, `suite`, `test`, and `it` registration authorities. Import-only provenance lets a global `suite.skip` disable a fence without detection. |
| Trust a mutable registration alias because its initializer was safe | `opts.skip = true` and `cases.pop()` change what Vitest registers after the initializer was inspected. Immediate literal inputs keep the proof boundary small and deterministic. |
| Allow implicit login credentials or executable parameter defaults | A default can call `test.skip()` before the pinned body executes. Explicit `login(page, PRINCIPAL)` binds the authenticated scan to the reviewed identity. |
| Inspect workflow, job, and step environments but not `job.container.env` | A job-container environment is inherited by the governed command and can preload or redirect its runtime exactly like the other scopes. |

## Trade-offs and Costs

- **Gained:** Gate A becomes reachable, so Wave A can close honestly. Invariant 3 keeps its full
  strength at the gate where it can actually be proven. The gate/wave ordering relation becomes
  structural: the same class of circular gate cannot be re-introduced by prose, because the ordering
  fence decides it from the registry.
- **Sacrificed:** the registry's `gates` map is now structured data rather than one line of prose per
  gate; every not-yet-active invariant must carry `activationPrompts`, and every gate requirement must
  be typed and name the prompt that produces it - a small, fenced maintenance obligation on anyone
  adding or re-gating an invariant. The repo diverges from one sentence of the ratified prompt sequence,
  so every reader of that sentence needs this ADR (hence the pointers in `docs/v3/README.md`,
  `CLAUDE.md`, and the registry description).

## Consequences

- `v3-invariants.json`: all TEN gates of the ratified sequence are registered with typed requirement
  lists; invariant 3 moves to gate B with pinned `activationArtifacts` and `activationMechanisms`;
  invariant 4's `activatesWhen` now names
  its Wave A activation subjects (prompts 5-7) explicitly, since Gate A requires it - later waves extend
  the same §16 fence family without re-gating it (ADR-0026).
- Gate A owns invariants `{1, 2, 4, 5}` and additionally requires the prompt-5 structural guarantees
  `{7, 8, 9}` without moving their Gate D activation ownership. Gate B requires invariants 3 and 16,
  prompt 10's two `config/domains/*.yaml` artifacts, prompt 10's schema-and-shared-engine binding
  evidence, and prompt 11's stable-corpus evidence. Gate C requires
  invariants 1 and 11. Gate D requires 6-13 plus 18 and 19; Gate E still requires 14-17; Gate F still
  requires 18-25 plus prompt 26 verification-reconciler evidence. The merged `G/H` becomes Gate G
  (26, 28, 30) and Gate H (27, 29) plus timing, measured-results, and cold-review evidence. Beyond that split, no
  invariant changed ACTIVATION ownership: 16 is owned by E, 11 by D, and 18 and 19 by F, each additionally
  required at the earlier gate that can prove it.
- Five RATCHETS live in the shared gate library and are exercised by the fence: the complete 30-invariant
  activation-ownership map, the complete proof metadata for every cross-gate invariant reference, invariant 3's
  exact activation artifacts and fitness mechanism, complete gate metadata (`wave`, predecessor chain,
  `entryCondition`, `outcome`), and every gate's COMPLETE TYPED requirement set - `kind` plus id/ref and
  proof prompt, and the `command` for a `ci-gate`, not invariant ids alone. The ratified ten-gate prompt
  ranges are pinned beside them. Both the blocking runner and the fitness fence invoke this exact
  constitution validator. Changing any of them fails CI until the ratchet, this
  ADR, ADR-0023 where applicable, and the proof evidence are amended together. Deleting an `evidence`
  clause is therefore a governance amendment, not a registry edit.
- The active-invariant mechanism ratchet in `scripts/v3-gates.lib.ts` is exact in both dimensions:
  every active invariant has its complete mechanism tuple set pinned, and no invariant may become active
  until its ID is added to that ratchet in the same reviewed change. The registry fence and blocking
  v3 runner both invoke the same validator.
- Every `ci-gate`, in a gate requirement and in an invariant mechanism alike, names the `command` its
  blocking job runs, checked against a real YAML parse of `.github/workflows/ci.yml` plus a restricted
  shell-command parse. The workflow must carry unfiltered normal `push` and `pull_request` triggers,
  effective working directories must resolve to the repository root, and mapped controls invoke direct
  owned entry points rather than `package.json` scripts. Only a dedicated simple command can prove execution. Comments, echo arguments,
  short-circuited expressions, heredocs, compound commands, step names, environment values, and `uses:`
  paths are rejected; so is a job or step carrying `continue-on-error`, any `if:`, an unsupported
  effective shell, any missing, dynamic, invalid, or unsupported runner regardless of an explicit
  shell, a job carrying a non-empty `needs` dependency, or an evidence job using `strategy.matrix`.
  Workflow, job, job-container, and step environment maps are resolved together. Non-literal maps and overrides of
  execution-affecting shell, loader, package-manager, or runtime variables are non-evidence, including
  `BASH_ENV`, `ENV`, `PATH`, `NODE_OPTIONS`, loader preload paths, and equivalent language-tool options.
  An unparseable
  workflow yields no jobs, so every `ci-gate` reads unmet rather than passing on a file nothing could read.
- `parseCiJobs` is the repo's one structured CI authority, read by three call sites - the gate
  requirements, the invariant mechanisms (`v3-invariants.test.ts`), and charter-drift check (a'). The
  charter mappings all name and ratchet their exact commands. The weakest `ciJobBlocks` query also
  requires at least one valid non-neutralized executable step, so malformed, empty, unsupported-shell,
  and fully skipped jobs are not blocking evidence. Charter rule 9 additionally names
  `pnpm exec playwright test`
  and the Axe-specific fitness fence. All required surface specifications await `e2e/axe.ts`, whose
  non-mutating animation settlement, complete scan, and direct unmodified-violations assertion are
  structurally pinned by that fence. Module/file/describe scope annotations and expected-failure tests
  cannot neutralize the required scans, including computed, destructured, aliased, and namespace-imported
  annotation calls and aliases introduced by later simple assignments. Playwright configuration must be one effective configuration object, reject
  focused-test exclusion, and select the required specifications. Typed public, authenticated,
  and demo route groups bind each directly owned route loop to navigation plus its loaded-state marker.
  Route collections and their entries are frozen, and reassignment, descendant mutation, array-mutator
  calls, and conditional callback exits before the loop are non-evidence. Neutralizer aliases are
  rejected if any preceding assignment source resolves to `test.skip`, `test.fixme`, or `test.fail`,
  including when a later unreachable assignment appears benign.
  TestInfo neutralizers are also resolved from callback parameters and from `test.info()` return values,
  including aliases and destructuring. Sanctioned Axe-helper aliases must have stable, unreassigned
  imported provenance. Neutralizers invoked through `bind`, `call`, or `apply`, plus local helpers that
  invoke neutralizers, are followed transitively, while unresolved local callable indirection is
  non-evidence. Required route callbacks admit only their typed loops and stable canonical login call;
  the login helper itself is pinned to exactly two plain required parameters and the uninstrumented
  browser flow, every authenticated scan passes `PRINCIPAL` explicitly, and required specifications may
  register no Playwright hooks. The same prohibition applies to every named graph root and extends
  through the complete runtime local import graph of required specifications and sanctioned helpers.
  No reachable module may import the Axe runtime outside `e2e/axe.ts`, register a Playwright hook, hide
  behind a side-effect import, or depend on an unresolved, unclassified, non-literal, or indirect
  CommonJS runtime import. Ambient `process.getBuiltinModule("module")` loader construction is rejected.
  Static computed Playwright members are resolved, and unresolved computed members rooted at the imported
  Playwright API make the graph non-evidence. Hook provenance includes object-member assignments, `Object.assign`,
  `Object.defineProperty`, and `Reflect.set` through stable aliases and `bind` / `call` / `apply`
  wrappers. Unresolved reflective property writes fail closed.
  Direct, aliased, and reflective `Reflect.apply` invocations are resolved through the same callable
  provenance, so neither a neutralizer nor a registered hook can hide behind reflective dispatch.
  Optional assertion messages must be structurally side-effect-free. The
  `v3-invariants-phase-gated` and `v3-gate-ordering` mappings both name and ratchet
  `pnpm exec tsx scripts/v3-invariants.ts`.
- The blocking test job directly runs `scripts/fitness-tests.ts` as its single complete Vitest
  invocation. That command runs unit, integration, and fitness tests together, recursively enumerates
  every fitness test file through the same matcher and include glob consumed by Vitest, covering
  `.test.ts`, `.test.tsx`, `.spec.ts`, and `.spec.tsx`. It supplies that one complete inventory to
  charter-drift disabled/orphan analysis and the companion meta-fence, parses the per-file report, and
  fails when an expected file is missing, duplicated, failed, or omitted by configuration.
  The charter map and mechanism ratchet pin the runner and its exact blocking command.
- Vitest registration analysis follows computed and aliased `todo`, `fails`, `skipIf`, and `runIf`
  chains from imported authorities and the unshadowed `describe`, `suite`, `test`, and `it` globals
  enabled by the repository configuration. Locally shadowed application callables remain outside the
  Vitest provenance graph. The same provenance follows unshadowed `globalThis` and Node `global` member paths and inspects
  registration option objects for `skip`, `only`, `todo`, and `fails`. Dynamic option keys, spreads, and
  neutralizing values that are not statically false are non-evidence. Unknown conditional state is
  non-evidence. Registration options and parameterized inputs must be immediate literals or direct frozen
  literals, so mutable aliases are non-evidence. Parameterized `.each` and `.for` registrations require a statically non-empty collection;
  empty, spread-derived, or unresolved collections are non-evidence, while tagged tables require a
  header and at least one static row. Registrations must be direct reachable module-scope statements or
  direct statements inside an enabled reachable module-scope `describe` / `suite` callback. Registrations
  hidden in uncalled functions, unresolved control flow, or non-registration callbacks are non-evidence.
  The Axe helper admits no
  module-scope executable statement that could replace its analysis method, and required specifications
  cannot import the Axe runtime directly.
- Reflective callable resolution composes direct or bound `Reflect.apply`, `Function.call`, and
  `Function.apply` layers before returning the invoked target, including stable aliases and bound
  callables invoked through `call` or `apply`. Gate 0 also requires `snap` and `snapLauncher` to remain
  unreassigned and proves every supported URL scenario and firm resolver preserves the supplied identity.
- The v3 runner accepts an explicit registry path for validation tooling. Its companion executes the
  real runner against injected gate-ratchet drift and requires process exit 1, so a syntactic descendant
  `fail` call is not accepted as proof of blocking behavior.
- A gate's `awaiting:` line lists EVERY requirement holding it back, undecidable ones included, with a
  second `no mechanism decides:` line naming the subset nothing here can close. The report can no longer
  understate what a gate needs.
- Registering a gate cannot make it green, and neither can deleting what it cannot prove. Gate 0 now
  reads `green`: `demo-surface-completeness.test.ts` binds the normative section 4 list to the typed
  manifest, each route case's imported component, the dynamic page's resolved station argument and loaded
  marker through a provably reachable return, the resolved scenario and firm inputs to `getJourney`,
  every supported scenario-by-firm outcome, the exact query-derived approval input, the complete ordered
  clickable-control route graph, and direct awaited ordered screenshots with no `page.goto` substitute.
  The canonical specification cannot register hooks that inject controls or replace screenshots. Both
  the launcher and station screenshot helpers verify
  their corresponding URL and loaded marker, use exactly the sanctioned `path` and `fullPage: true`
  screenshot options, write only to the pinned artifact directory, and reject an empty capture. A
  dedicated post-Playwright command validates every canonical artifact,
  and upload-artifact fails when the directory is missing or its execution or failure is neutralized.
  Gates A through I remain non-green against
  their own unmet requirements.
- `scripts/v3-gates.lib.ts` is the single rule set; the fence and the blocking runner both import it, so
  a rule or exact ratchet cannot be enforced in one and missing in the other. The runner places each
  shared ratchet result behind an immediate fail guard before reporting and exits nonzero when the shared
  Vitest invocation fails or any mapped fitness file, including a gate-only fence, fails or produces no
  result.
- `charter-map.json` gains the `v3-gate-ordering` operating-model entry, so the charter-drift fence's
  orphan and ratchet checks cover the new fence. Charter drift pins the complete set of effective
  enforced mechanism tuples, including type, reference, command, and status, so a mechanism-level
  `planned` override or deletion cannot bypass an entry-level ratchet.
- Wave B's entry condition is recorded on gate B: prompts 5, 6, and 7 landed and Gate A is green,
  including owned invariants 1, 2, 4, and 5 plus earliest-proof references 7, 8, and 9. The structural
  `entryGates` chain makes that state control readiness. Prompt 5 landed with ADR-0029; prompts 6 and 7
  remain open.
- The accessibility fence derives the complete `src/app/**/page.tsx` inventory, classifies every static
  and dynamic route into its public, login, authenticated, or demo scan group, applies Next route
  precedence to every concrete scan URL, and requires every page to own a URL that actually resolves to
  it. The frozen Axe collections are declarative, non-empty, and process-stable. Adding an unscanned page
  or a page shadowed by a more specific route fails the fence.
- Charter-drift disabled-fence detection parses Vitest registrations with symbol-aware AST provenance,
  including computed members, namespace imports, imported aliases, assigned aliases, unshadowed globals,
  `globalThis` and Node `global` member paths, the `suite` alias, x-prefixed registrations, and neutralizing registration
  options. String mentions and unrelated local functions are not evidence.
- The adversarial proof for the gate-ordering fence is PF-030 in `docs/fences/proof-log.md`; the
  Axe-specific charter proof is PF-031.
- This does **not** change what invariant 3 requires, when prompt 10 runs, or the deferral of prompt 27
  (ADR-0024). It changes only which gate holds invariant 3.

## Revisit When

- A future invariant's activation prerequisite legitimately spans two waves (activation begins in one,
  completes in another): the ordering fence's single `max(activationPrompts) <= gate.lastPrompt` rule
  needs a per-invariant partial-activation model rather than a wider tolerance.
- Prompt 10 lands: invariant 3 flips to `active` with its naming fence in the same PR, its
  `activationArtifacts` and pinned `activationMechanisms` become real, and Gate B is evaluated for green.
  The exact `domain-configuration` fitness must adversarially prove schema validation and shared-engine
  binding for both YAML files. The same PR must add invariant 3 and its complete mechanism tuple to the
  shared active-invariant ratchet before flipping the status; the registry fence and blocking runner
  both reject an unratcheted activation. If the fence cannot be written without domain-named exceptions,
  the primitive vocabulary is overfit and ADR-0025's revisit trigger fires first.
- A mechanism lands that decides an `evidence` requirement (gate B's domain-schema/shared-engine
  binding or stable-corpus clauses, gate C's validated-bundle, Gate D's prompt-17 evaluator property-test
  clause, gate F's verification-reconciler clause, Gate H's timing/measurement/cold-review clauses, or gate I's severity verdict): replace that entry with the
  `invariant` / `fitness` / `artifact` requirement that decides it, in the same PR. An `evidence` entry
  is a named gap, never a permanent excuse.
- Any gate's `requires` list - of ANY requirement kind - its `wave`, `entryGates`, `entryCondition`,
  `outcome`, or any invariant's `gate`, is proposed for
  change: that is an amendment to this ADR, to ADR-0023's phase-gated commitment, and to all five ratchets in
  `scripts/v3-gates.lib.ts`, with fresh proof-log evidence - never a registry edit
  alone. A registry-only edit fails CI (proved: PF-030).
- A blocking job legitimately needs a condition or `continue-on-error` (a matrix leg, a fork-PR guard):
  the `ci-gate` rules read either as neutralizing, so that job stops being evidence. Point the requirement
  at a job that does block, or extend `parseCiJobs` to decide the specific expression - do NOT drop the
  neutralization check, which is what "blocking" means in every claim this ADR makes.
- A blocking evidence job legitimately needs another job: point the requirement at a dependency-free
  blocking job, or extend `parseCiJobs` with complete transitive reachability semantics and adversarial
  companions. Do not treat a local command as executed when `needs` can skip its job.
- A blocking evidence job legitimately needs `strategy.matrix`: move the mapped proof to a
  matrix-independent blocking job, or extend `parseCiJobs` with complete combination expansion,
  exclusion, and reachability semantics plus adversarial companions.
- A blocking job needs a runner or shell outside the supported implicit Ubuntu/macOS, `bash`, or `sh`
  semantics: extend the restricted parser to decide that exact execution model and add adversarial
  companions before using it as evidence. Unsupported custom shells remain non-evidence.
- A mapped command must legitimately run outside the repository root: add a typed governed-root field
  and validate its complete ownership boundary before relaxing the current root-only contract.
- The required demo surface list changes: update the typed manifest, route, canonical screenshots,
  loaded-state route group, runtime artifact expectation, Gate 0 requirement ratchet, and PF-032
  evidence together.
- A `charter-map.json` `ci-gate` entry changes its command: update the mapping, its exact-command ratchet,
  and the proof evidence in the same PR. Name-only enforced mappings are invalid.
- An invariant that has been referenced by an earlier gate is activated: keep its `activationPrompts`.
  They are the permanent record of the prompt at which it landed, and the ordering rule falls back to its
  owner gate's close without them, which would make the earlier gate's requirement illegal. If a future
  invariant genuinely has no single landing prompt, the proof-point model needs the partial-activation
  extension named in the first bullet above rather than a dropped field.
- A required Axe specification or sanctioned helper needs a non-literal runtime local import or an
  indirect CommonJS loader: extend the import-graph resolver with a complete, adversarially proven
  execution model before admitting it.
- A required Axe module legitimately needs `process.getBuiltinModule("module")`, a runtime-computed
  Playwright member, or implicit login credentials: extend the relevant provenance model and its
  adversarial companions before admitting the form. Do not weaken the current fail-closed boundary.
- A governed CI job legitimately needs an execution-affecting `job.container.env` override: isolate the
  mapped command in a clean blocking job or add a typed, adversarially proven allowance for that exact
  variable. Do not exempt container scope from inherited environment validation.
- A governed command needs a new predecessor action, setup input, install command, step field, or
  container image: ratchet the exact prerequisite or image with adversarial proof in the same ADR
  amendment. Do not accept an open-ended setup chain before evidence.
- A fitness entry needs imported Vitest registration: move the registration back to the inventoried
  entry or extend the import-ownership model with complete reachability and per-file result semantics.
- The demo query extraction semantics change: amend the exact helper proof and its identity-preservation
  companion before changing the route.
- A `ci-gate` job is renamed or its command changes: update the registry's `ref`/`command` in the same
  PR and keep the required command in a dedicated simple step. The structural check reads the workflow,
  so a stale or compound form fails rather than silently matching.
- The blocking workflow moves off a single `.github/workflows/ci.yml`, or a `ci-gate` command has to be
  proven inside a composite action or a reusable workflow: `parseCiJobs` reads one file and only that
  file's `jobs.<key>.steps[].run`, so a job that delegates its command to `uses:` reads unmet. Extend the
  parse to follow the reference - do NOT relax the match back toward substring presence.
