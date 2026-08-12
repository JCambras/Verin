# Domain configuration: the gap report

**Required by v3 prompt 10**: "Report anything that cannot be expressed and classify it as missing
primitive, missing platform capability, or mistaken requirement."

Everything below was found while expressing money movement AND account opening as data
([ADR-0058](./adr/0058-domain-configuration-schema.md)). Nothing here was worked around silently; each
item is either fixed in this PR, deferred to a NAMED prompt, or recorded as a correction to an earlier
design.

---

## 0. The headline finding: no primitive is missing

Both domains express onto the ratified six-primitive catalog (ADR-0039) with **no addition and no
stretch**. That is corroboration of prompt 8's design rather than an absence:

| Domain need | Primitive | Note |
|---|---|---|
| Effective liquidity, sibling-reservation visibility | `net-availability` | money movement |
| Reserve floor over a horizon | `horizon-projection` | money movement only - this is exactly the case its own falsification criterion names as its kill test |
| Reserve preservation | `sufficiency-check` | money movement |
| Household binding, source-account choice, registration choice | `candidate-selection` | BOTH domains |
| Destination, account and jurisdiction screening | `restriction-screen` | BOTH domains |
| Identity name reconciliation across two sources | `evidence-reconciliation` | **account opening gives this primitive its FIRST binding**, which is the corroboration prompt 8's OQ-3 flagged as missing |

Two near-misses that are deliberately NOT primitives: calendar bucketing for conflict keys (pure byte
arithmetic on canonical ISO forms) and copy rendering (one inert placeholder renderer).

---

## 1. Missing platform capability

| # | Gap | Status |
|---|---|---|
| **PC-1** | **Runtime YAML loading did not exist.** `yaml` was a devDependency with only test and script consumers. | **FIXED.** Promoted to `dependencies`; read by exactly one adapter (`src/infrastructure/config/domain-config-source.ts`) behind an inert-document guard that refuses tags, anchors, aliases and merge keys. |
| **PC-2** | **`DomainConfigVersionRef` was a dangling reference** - pinned into `Intent` and `DecisionInputBundle` with no entity behind it. | **FIXED.** That entity is this schema. No second version identity was minted. |
| **PC-3** | **Missing brands** for the configuration vocabulary. | **FIXED.** `ActionId` in `contracts/decision-core/ids.ts` (the one `contracts` consumes, through `Intent.action`); the rest are minted where the schema that uses them lives, in `src/domain/config/`. Six were added at first - five had no contracts consumer and disagreed with the domain mint at runtime (`brandedString` admits any non-empty string, `kebabId` does not), so they were deleted rather than left as a second, looser declaration. See `fu-contracts-dead-export-visibility` in §5. `SlotName` was deliberately NOT added: `Intent.slots` keys stay `string`. |
| **PC-3a** | **The retained `ActionId` brand still disagrees with its domain mint.** `ActionIdSchema` is a `brandedString` (any non-empty string) while `src/domain/config/` mints the same `"ActionId"` brand as a `kebabId`, so a non-kebab value parsed in `contracts` is typed `ActionId` and `compileFlowDefinition` could never resolve it against the document's intents. | **DEFERRED to prompt 14**, and named. Narrowing the contracts schema is a real change, not a comment fix: `src/__tests__/unit/decision-core.test.ts` parses an `Intent` whose action is `"primitive:distribute-cash"`, left over from the `PrimitiveId` this field used to carry (D-221). Prompt 14 is the first prompt that CONSTRUCTS an `Intent`, so it is the first to have real values to narrow against; nothing constructs one today, so the disagreement is unreachable. Stated as written at the brand itself. |
| **PC-4** | **No persisted registry of pinned configuration versions.** Replay must load the PINNED version, not the current file (invariant 13). | **DEFERRED to prompts 15/19**, and named. This PR ships the content hash and `config/domains/versions.json`, so the immutability contract exists from day one; persistence is bundle-assembly and replay work. It must exist before Gate D. **Interim guard (D-246, as corrected by D-250):** a suspended execution now records the configuration version it started under, and the composition root REFUSES with a typed `CONFLICT` to drive its stored positional cursor under a KNOWN DIFFERENT one - so a mid-flight version bump fails loudly instead of resuming at the wrong step. A MISSING recorded version is LEGACY, not a mismatch, and continues. The REPLAY path drives nothing, so it DEGRADES instead of refusing (D-253): it reports the execution's real persisted status and resume token and leaves the awaited rule - the one field read from that positional cursor - undetermined. That is a refusal and a degraded report, not the answer: loading the PINNED document so a legitimate bump can be resumed correctly remains this row's obligation. |
| **PC-5** | **No execution-plan TEMPLATE type.** The ratified `ExecutionStep` is an INSTANCE: content-addressed payload ref, payload hash, evidence-snapshot preconditions. | **FIXED for the template half** (`src/domain/config/operations.ts`), **DEFERRED for the compile-to-`ExecutionPlan` half to prompt 25.** The interim compile target is a `FlowDefinition` for the shipped suspend/resume engine, and a `decision-hash` source is REFUSED there rather than faked - in an idempotency-key segment OR a command payload field, which is every position a compiled step resolves (a `copy` field renders only `{slot:…}` and `{context:…}`). The resolver ends in a `never`-typed tail, so a future grammar arm with no interim value is a build failure rather than a silent `absent` mid-plan. |
| **PC-6** | **`ExecutionReceipt` / `ExecutionHandle` / `StatusObservation` are absent from `src/`** (ratified, deferred by ADR-0029), so `observedStatuses` references a vocabulary with no compiled type. | **DEFERRED to prompts 24/26**, and named. Statuses are declared as closed kebab-case ids and are two-sided-checked against presentation copy today; when the compiled union lands, a fence must pin the configuration's vocabulary to it. |
| **PC-7** | **No `domain_config` arm on `VersionedSourceRef`.** | **NOT NEEDED, and must never be added.** A domain-sourced prohibition would carry no version lineage. The configuration declares the prohibition VOCABULARY and the arms permitted to raise each code. |
| **PC-8** | **`src/config/` would be an unclassified fifth top-level directory** - no layer, no budget bucket, and v3 §16 forbids modules importing `config/`. | **FIXED by deviation**, recorded in ADR-0058 §3. |
| **PC-9** | **No deterministic calendar helper** for conflict-key bucketing. | **FIXED**, as pure byte arithmetic on canonical ISO forms (`segments.ts`). Non-canonical bytes are refused, never best-effort parsed - the same posture D-186 gave temporal fact reads. |
| **PC-10** | **No renderer for inert copy templates.** `ExplanationNode.messageTemplate` is a plain string with no renderer anywhere. | **FIXED.** One renderer over the closed `{slot:…}`/`{context:…}` set, shared by command text and reason-code copy. Prompt 16 should route explanation nodes through it rather than growing a second mechanism. |
| **PC-11** | **The interim substrate has no decision hash.** Money movement's idempotency key is anchored on it, correctly. | **DEFERRED to prompt 25**, and named. `compileFlowDefinition` REFUSES such a plan with an explicit message instead of substituting a stand-in identity, which would be an idempotency key that changes between attempts. |

---

## 2. Mistaken requirement

| # | The wording | Why it is mistaken | What was done |
|---|---|---|---|
| **MR-1** | Deliverable `src/config/domain-schema.ts` | A fifth top-level directory has no layer and no budget, and v3 §16's own rule forbids importing `config/`. | Schema in `src/domain/config/`, adapter in `src/infrastructure/config/`, data at repo-root `config/domains/`. ADR-0058 §3. |
| **MR-2** | The configuration contains "prohibitions" | A prohibition INSTANCE needs a `VersionedSourceRef` with version lineage; a config-sourced one would have none. | The configuration declares the prohibition VOCABULARY: codes, permitted source arms, scope slot, copy. |
| **MR-3** | The configuration contains "approval templates" | `ApprovalTemplate` carries `firmId` and a non-empty role-ref set - both firm data. | The configuration declares template SLOTS and their kind; the firm supplies the record. |
| **MR-4** | `Intent.action: PrimitiveId` | It conflates a domain's action vocabulary with the primitive catalog's ids, making prompt 9's unknown-primitive check ambiguous. | `ActionId` added; `Intent.action` retyped. Compile-time only - no hash preimage, no stored bytes, no fixture change. |
| **MR-5** | Required test: "a test that GREPS core code for domain-specific branching" | A regex over `src/` is either vacuous or fires on legitimate house-CRM vocabulary, and a weak fence is worse than none. | A ts-morph fence whose forbidden vocabulary is DERIVED from the published documents' own ids, scoped by the captain's `invariant-3-scope` ruling, with an anti-vacuity companion proving an emptied vocabulary cannot read clean. |
| **MR-6** | "with zero supporting domain code" | Read literally, unsatisfiable: a loader, a binder and a compiler are code. | The testable claim is zero domain-SPECIFIC code: deleting `config/domains/account-opening.yaml` breaks the shipped flow, and no identifier, literal, file or directory name in decision-core names a domain. Both are enforced. |
| **MR-7** | The design report's rule "a `text` slot may never appear in a command payload" | **Falsified by account opening.** Its payloads ARE user-typed text - a household name and a contact name are what a CRM create is. | Corrected: a `text` slot may reach a PAYLOAD, never a conflict key or an idempotency key, where unbounded editable bytes would make a coordination identity unstable. Load-checked. |
| **MR-8** | The ratified `ExecutionStep` requires at least one conflict key per external action | **Falsified by account opening.** A conflict key names the resource two requests contend for, and account opening's subject - the household - does not exist until its own first step creates it. | `conflictKeys: []` for that domain, with double submission guarded by the per-execution idempotency scope instead. **This is a real constraint handed to prompt 25**: an existence-CREATING action needs a decided answer for what it collides on. |

---

## 3. Dependencies on later prompts (named, not silent)

| Depends on | What is missing until then |
|---|---|
| **Prompt 15 / 19** | The persisted configuration-version registry (PC-4). Replay must load the pinned version. **And the full change-record byte check**: `checkIdentity` compares `authorship.changeFromParent` against the diff it computes from the parent's bytes, and `shippedConfigEnvironment()` supplies those bytes only for the empty baseline a FIRST version diffs against - so a version declaring a parent is held to a non-empty record and no more. Making it real means deciding where a superseded document's canonical bytes live, and that storage question belongs to the persisted registry, not to prompt 10. Stated as written in `docs/domain-config.md` §8 and at the `checkIdentity` branch itself. |
| **Prompt 12** | **The generic intake pipeline** - one pipeline for human and system triggers, deriving a flow's start input from the configured trigger fields. Until it lands, `startAccountOpening` takes a FIXED five-field shape, so `src/app/api/flows/account-opening/route.ts` REFUSES an admitted intake field that shape cannot carry, naming it, rather than dropping it and failing at whatever step sources the slot (D-239). |
| **Prompt 14** | The narrowing of `ActionIdSchema` to the kebab shape its domain mint already enforces (PC-3a). Prompt 14 is the first to construct an `Intent`. |
| **Prompt 16 / 17** | The evaluator. The decision half of both documents is VALIDATED, NOT YET EVALUATED - stated in the files themselves. **And the CONTEXT PLANE** (D-247): a `{from: context}` value source and a `{context:…}` placeholder in COMMAND TEXT are refused at load today, because the interim substrate resolves sources out of flow data - transport fields, the platform's reserved keys, publication aliases - and a context read there would load clean and fail at the step that consumed it, after earlier steps had committed. The grammar arm is kept, not deleted: the evaluator is what makes it resolvable, and reason-code copy (which the evaluator renders) still admits `{context:…}` today. **And the SLOT TRANSPORT the plane supplies**: a `{from: slot}` source over a slot that is not `supplied-by-trigger` is refused when the plan is COMPILED, naming the slot and its resolution. Refused there rather than at load because the authoring is legitimate - money movement's `household` and `source-account` are `bound-by-primitive`, and the interim resolver reads a slot only through the trigger field the grammar forbids such a slot to declare - so the document stays loadable while a plan carrying a source nothing can resolve stays unrunnable. Money movement is refused today for its `decision-hash` segment as well; removing that segment at prompt 25 must not make this one silent. |
| **Prompt 16 (front-end lane)** | Systematic route error boundaries with recovery. The configuration side of this row is CLOSED (D-267): `src/app/demo/vocabulary.ts` throws nowhere - it resolves as a `Result` and `/app/demo/[station]` renders `DemoUnavailable` - and RULE F of the domain-configuration fence still makes an undeclared label id a build failure rather than a request-time one (proof PF-296). What remains is the general gap: there is no `error.tsx` under `src/app`, so a throw from anywhere else still renders Next's default error page rather than a styled state. Owned by the front-end parity lane, not by this prompt. |
| **Prompt 20** | The first shipped caller of `policyRegistriesFor`, carried as a named deferral in the domain-configuration fence rather than left silent. |
| **Prompt 15** (`fu-restriction-evidence-required`) | **A D-104 obligation prompt 10 OWED and did not land** (D-264). A configuration binding `restriction-screen` must declare a restriction-source evidence kind as REQUIRED evidence for every bound restriction kind, checked fail-closed at load. It is not checked, and it is not expressible: a `restrictionKinds[]` entry carries `kind` and `polarity` only, so no document can name the evidence kind that supplies a bound kind's list. `account-opening.yaml` binds the screen for `jurisdiction-restriction` with no restriction-source evidence and loads clean. Landing it means prompt 8's own declared falsification path - `sourceEvidenceKinds` on `restrictionKinds[]` under a primitive-set version bump - consumed by prompt 15's evidence-sufficiency contract, beside D-104 obligation 4 (the identical fail-open-on-absent-evidence shape). |
| **Prompt 16** (`fu-binding-multiplicity-check`) | **The second D-104 obligation prompt 10 owed and did not land** (D-264). An unscoped-key primitive binds at most once per configuration and a parameter-scoped one repeats only with distinct key scopes, both halves rejected naming the primitive and both bindings. Nothing groups `primitiveBindings` by `primitiveId`. This one IS expressible today - it simply was not built. The nearest shipped behavior is `deriveContextKeys`, which refuses two bindings whose published keys collide within ONE intent, reported against the colliding key and worded as a slot-versus-primitive clash: it names neither the primitive nor the two bindings and does not see bindings on different intents. Both shipped documents satisfy the rule by authorship, not by enforcement. |
| **Prompt 24 / 26** | The compiled `ObservedStatus` union (PC-6) and the reconciler that closes an awaited verification rule. Today the shipped engine's suspend/resume is the interim implementation. |
| **Prompt 25** | Compilation to the ratified `ExecutionPlan` (PC-5), the decision-hash idempotency anchor (PC-11), the finalize fan-out split, and MR-8's conflict-key question. |

**`fu-restriction-evidence-required` and `fu-binding-multiplicity-check` are different in kind from every
other row, and are listed anyway.** The rest are capabilities a LATER prompt owns and prompt 10 was never
asked to build. Those two are obligations prompt 10 ITSELF owed under D-104 and did not discharge - the
first blocked by a catalog shape only a primitive-set
version bump can change, the second buildable today and simply not built. They are also the only deferrals
on this page that **no fence enforces**: `ledger-reachability` and the `policy-ast` and
`domain-configuration` fences hold their named deferrals in registries that fail both when an orphan
appears and when a deferred entry point gains its caller, but a MISSING CHECK offers no symbol to key on,
so D-264's un-defer triggers are the whole mechanism. A published document claiming a fail-closed check
that does not exist is worse than no claim at all, which is why they are named here rather than left to be
rediscovered.

---

## 4. Falsifiers run

| # | Falsifier | Result |
|---|---|---|
| **X-1** | The account-opening plan cannot be a DAG with an externally-gated step | **Did not fire.** Five steps, `dependsOn`, one `awaitsExternal` verification rule; money movement is one step. The DAG is necessary and sufficient. |
| **X-3 / X-4** | Producing the Firm A / Firm B divergence needs an edit to `money-movement.yaml`; or binding differs by more than `firmId` | **Did not fire.** Neither firm's reserve horizon, threshold, or bank-change handling appears in the document; the two-firm binding property is asserted in both the unit tests and the fence. |
| **X-6** | The migration needs a configuration field for ENGINE semantics (trusted-context precedence, cursor behavior, retry policy) | **Did not fire.** Those stayed in the engine. Two platform value sources were needed - the initiating actor and the awaited observation's fields - and both are declared as PLATFORM arms, not as slots, precisely so a configuration cannot configure the interpreter. |
| **X-9** | Deleting `config/domains/account-opening.yaml` leaves `/app/account-opening` working | **Did not fire - the check passed.** With the file removed, the integration suite fails 12 of its cases, the POST route returns a typed failure, and the page renders an explicit configuration-failure state with no form (its copy now states the failure generically and shows the refusal's correlation id - D-259 - rather than naming the file). Restored immediately. Re-run on the demo side (D-267): with `config/domains/money-movement.yaml` moved aside, `/app/demo/[station]` renders `DemoUnavailable` - the generic sentence plus the refusal's quotable reference, never a stack trace - while the operator's line carries `configStage=unpublished` and the same correlation id. Restored immediately. |
| **X-11** | Loading requires a network, a clock, or `Date.now()` | **Did not fire.** The loader and every schema module are clock-free; temporal handling is byte arithmetic on canonical forms. |
| **X-2** | A third domain needs a section neither of these two used | **Not runnable yet** - it needs a third domain. Recorded as the standing falsifier to re-run before Gate B is claimed complete. |

---

## 5. Findings about the repository's own tooling

Naming a **Zod schema type, or any deeply recursive type, as a parameter of an exported `src/domain/`
function** makes the sealed-authority fences' structural type walk explode: it expands a parameter type
member by member, and a schema generic drags its whole nested shape through dozens of method signatures.
With ~20 composed schemas in one module, a fence worker exhausted its heap and DIED mid-file - which
vitest reports as a partial run, not a failure.

Fixed on this side (named export types, narrow ports, an unexported adapter at the one place a schema is
touched) and recorded in D-222 and `docs/domain-config.md` §9. The residual hazard is that a fence which
stops running looks green in the summary line; that is worth a separate hardening item and is NOT claimed
as fixed here.

### `fu-contracts-dead-export-visibility` - charter #5's dead-export gate does not reach `contracts/`

`knip.json` declares `src/contracts/**` an ENTRY POINT (D-220 records why: the layer is the published
contract surface, and treating it as reachable is what lets a contract exist before its consumer does).
The cost is that an export under `contracts/` with **zero consumers repo-wide is invisible** to charter
#5's "nothing built-but-not-shipped" gate. That is not theoretical: this prompt added six branded
identifiers there, five of which had no consumer at all - `src/domain/config/` re-minted the same brand
strings through `kebabId` - and `pnpm knip` stayed green through four review rounds. The five were
deleted; the exemption that hid them was not.

Worse than the invisibility, the two declarations agreed at COMPILE time and disagreed at RUNTIME:
`brandedString` is `z.string().min(1)` while `kebabId` enforces `KEBAB_CASE_RE`, so a value one layer
parsed the other would refuse under the same nominal type.

**NOT FIXED, and deliberately not fenced here** - no new invariant is being asserted by this prompt, and
a reachability rule for the contract surface needs its own decision about what "shipped" means for a type
that exists to be consumed later (the named-deferral idiom `ledger-reachability` uses is the likely
shape). Recorded so the trade-off is owned rather than rediscovered: today, an unused `contracts/` export
is caught only by review.

### `fu-intake-spent-id-recovery` - a spent request identity has no in-page remedy - CLOSED (D-254)

The account-opening journey mints one client request id per form session, and a fresh id is a fresh
EXECUTION whose per-write idempotency keys are execution-scoped: re-minting one in answer to a refusal
the user cannot fix converts that refusal into duplicate household, contact and application rows (D-253).
Burning the id on a VALIDATION and keeping it otherwise avoided that, but it left the other direction
open - a user whose id is KEPT, who then EDITS the form and resubmits, met the D-027 edited-replay
`CONFLICT` with no way forward but a reload.

That residual was banked for prompt 12 on the reasoning that a structured "this identity is spent, mint
another" signal needed the generic intake pipeline's transport. It did not: this endpoint answers two
different `CONFLICT`s whose remedies are OPPOSITE (a spent identity clears with a new one, a superseded
configuration version never clears), so no rule reading the error CODE could ever serve both, and no
amount of later transport work makes one possible. **CLOSED by D-254**: the response carries a typed
`retry` instruction from the closed `CLIENT_RETRY` vocabulary, decided server-side where the reason is
still known, and the client burns its identity if and only if it is told to.
