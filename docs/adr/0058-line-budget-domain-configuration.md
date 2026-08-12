# ADR-0058: Line-budget amendment for the domain configuration schema

**Status:** Accepted
**Date:** 2026-08-11
**Deciders:** Founding architect
**Relates to:** ADR-0018 (per-layer line budgets), ADR-0029, ADR-0033, ADR-0048, ADR-0049, ADR-0050,
ADR-0051, ADR-0052, ADR-0054; charter non-negotiables #1 and #10; v3 prompt 10 (ADR-0057)
**Amends:** ADR-0054's ceilings for `contracts`, `domain`, and `infrastructure`

## Context

v3 prompt 10 (ADR-0057) lands the domain-configuration schema: the whole thirteen-section grammar, a
seven-stage loader, the firm binder, the prompt-9 registry derivation, the plan compiler, the version
diff, and the label and intake projections. It is the largest single addition to the `domain` layer of
this build, and deliberately so - the point of the prompt is that a decision DOMAIN stops being code.

Against it, code is DELETED: `src/domain/workflow/flows/account-opening.ts` (123 lines) and the
domain-shaped body of `src/infrastructure/wire.ts`, which becomes composition.

## Decision

MEASURED on the composed tree, in this commit:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,647 | 6,700 | 53 |
| `domain` | 8,340 | 8,420 | 80 |
| `infrastructure` | 8,204 | 8,290 | 86 |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,140 | 12,400 | (ADR-0052 bucket, unchanged) |

`contracts` grows by ~45 lines: six branded identifiers for the configuration vocabulary
(`DomainConfigId`, `ActionId`, `ExecutionCapabilityId`, `CommandType`, `ConflictKeyTemplateId`,
`PlanTemplateId`). The ADR-0029 ratchet-down promise is preserved: this is a bounded, named increment,
not a re-baseline. (Five of the six are deleted by the round-4 amendment below; this paragraph records
what the figure in the table above paid for, not the shipped state.)

`domain` grows by ~3,900 lines, all of it `src/domain/config/`, against the 123 deleted flow lines.
`infrastructure` grows by ~430: the YAML source adapter and the command adapters, against the deleted
`makeDeps` body.

Each ceiling carries BOUNDED correction headroom, for the reason ADR-0048 and ADR-0050 record: a ceiling
that cannot absorb a review finding converts findings into deleted documentation or code folded onto
fewer lines, which is what those ADRs exist to end. A figure recorded here is a MEASUREMENT - re-take it
in any commit that changes a layer.

## Amendment (2026-08-11, review round 3): the `domain` ceiling, RE-MEASURED

The 80 lines of correction headroom this ADR gave `domain` were spent by the two review rounds that
followed it, and the third round spends the rest: closing the account-opening request boundary's
fail-open reads (`requiredIntakeValue` / `optionalIntakeValue` in `src/domain/config/intake-view.ts`),
refusing two slots that read one transport field (`src/domain/config/intents.ts`), and recording which
prompt owns the full change-record byte check at the `checkIdentity` branch that degrades
(`src/domain/config/load-references.ts`). That is exactly the case the paragraph above describes:
headroom exists so a review finding is answered with code, not with deleted prose or folded lines.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,647 | 6,700 | 53 (unchanged) |
| `domain` | 8,433 | **8,520** | 87 |
| `infrastructure` | 8,225 | 8,290 | 65 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Only `domain`'s ceiling moves, by 100 lines, and only because its measurement moved past the old one.
The other three measurements are re-taken and still inside the ceilings this ADR set, so those ceilings
are left alone rather than re-baselined upward for company.

## Amendment (2026-08-11, review round 4): `contracts` RATCHETS DOWN, `domain` re-measured

Five of the six brands the first table paid for - `DomainConfigId`, `ExecutionCapabilityId`,
`CommandType`, `ConflictKeyTemplateId`, `PlanTemplateId` - are DELETED. They had no consumer anywhere in
the repository (`src/domain/config/` re-mints the same brand strings through `kebabId`, which is the
declaration the schema actually uses), and the two declarations disagreed at RUNTIME while agreeing at
compile time: `brandedString` is `z.string().min(1)`, `kebabId` enforces `KEBAB_CASE_RE`. `ActionId`
stays, because `Intent.action` consumes it.

So `contracts`'s ceiling comes DOWN. Leaving it at 6,700 would bank correction headroom on the strength
of code that no longer exists, which is the mirror image of the silent fence edit this ADR exists to
forbid. `domain` moves up: this round answered its review findings in code there - the firm-class
checklist a surface derives its registry from (`requiredFirmClasses`), the reserved trigger-field
namespace the intent schema now refuses, and the deferred-reference walk that checklist reads.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,626 | **6,680** | 54 (ratcheted DOWN from 6,700) |
| `domain` | 8,578 | **8,660** | 82 |
| `infrastructure` | 8,250 | 8,290 | 40 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

`infrastructure`'s measurement moved and stayed inside its ceiling, so that ceiling is left where it was
rather than raised for company - the rule the previous amendment applied, now applied in both directions.

## Amendment (2026-08-11, review round 5): `domain` re-measured

The 82 lines of correction headroom the round-4 amendment left are spent, and by the same kind of work:
this round answered its review findings in `domain` code. Three of the four land there - the top-level
sections now refuse a DUPLICATE id through one collected rule (`src/domain/config/document.ts`), the
journey's live stations become declared data the document names and the projection carries
(`presentation.ts`, `intake.ts`, `intake-view.ts`), and the compiled plan reads an adapter's returned
outputs as OWN properties (`plan-compiler.ts`). The fourth moves the client-request transport key into
the leaf module both of its writers already import, so the reserved-name list and the code that writes
the name are one declaration.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,626 | 6,680 | 54 (unchanged) |
| `domain` | 8,711 | **8,780** | 69 |
| `infrastructure` | 8,255 | 8,290 | 35 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Only `domain`'s ceiling moves, by 120 lines, and only as far as its own measurement plus headroom inside
the band the sibling layers carry. `infrastructure` gained five lines (the own-property read in
`execution-adapters.ts` and its note) and stays inside the ceiling it already had, so that ceiling is
left alone rather than raised for company.

## Amendment (2026-08-11, review round 6): `domain` re-measured

The 69 lines of correction headroom the round-5 amendment left are spent, again on review findings
answered in `domain` code. Five of the round's seven land there: the rendered key becomes an INJECTIVE
encoding of its segment tuple (`segments.ts`), a capability's publication alias may no longer claim a
name the platform or a slot already owns (`document.ts`), a form control over a slot the requester does
not supply is a LOAD failure rather than a live-screen failure (`load-coherence.ts`), the section diff
reads canonical rather than insertion-ordered bytes (`diff.ts`), the settable-parameter check stops
walking `Object.prototype` (`load-references.ts`), and the intake leaf gains the accessor the request
boundary refuses an uncarryable configured field with (`intake-view.ts`).

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,638 | 6,680 | 42 (unchanged ceiling) |
| `domain` | 8,845 | **8,920** | 75 |
| `infrastructure` | 8,263 | 8,290 | 27 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Only `domain`'s ceiling moves, by 140 lines, and only as far as its own measurement plus headroom inside
the band the sibling layers carry. `contracts` gained twelve lines (the narrowed `ActionId` claim, which
now states the disagreement that survives rather than implying it was removed) and `infrastructure`
eight (the exported start-input field set and why the intake boundary refuses against it); both stay
inside the ceilings they already had, so those ceilings are left alone rather than raised for company.

## Amendment (2026-08-11, review round 7): `domain` re-measured

The 75 lines of correction headroom the round-6 amendment left are spent, again on review findings
answered in `domain` code. All three of the round's findings touch the load gate or the fence that
guards it, and two land in `domain`: a value source is now checked for AVAILABILITY at the CONSUMING
step rather than against the plan as a whole, so a forward or sibling `step-output` reference - and an
`await-observation` read no gated step precedes - is a load error instead of a mid-plan failure after
earlier writes have committed (`load-closure.ts`, `load-references.ts`); and the flow-data namespace
check gains its third writer, the fields of the observation that closes an awaited rule, which a
publication alias or a trigger field would otherwise shadow in silence (`document.ts`).

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,638 | 6,680 | 42 (unchanged ceiling) |
| `domain` | 8,973 | **9,050** | 77 |
| `infrastructure` | 8,270 | 8,290 | 20 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Only `domain`'s ceiling moves, by 130 lines, and only as far as its own measurement plus headroom
inside the band the sibling layers carry. `infrastructure` gained seven lines (the configuration
directory constant is no longer exported, and the note says why a second way to name that path is the
thing being removed) and stays inside the ceiling it already had, so that ceiling is left alone rather
than raised for company. The round-6 `infrastructure` figure is re-taken here rather than carried
forward: a measurement left stale is the condition the fence header argues against.

## Amendment (2026-08-11, review round 8): `domain` AND `infrastructure` re-measured

The 77 lines of correction headroom the round-7 amendment left are spent, and for the first time on
this branch a second layer moves past its ceiling too.

`domain` answers four of this round's findings in code. Two close the last of the
load-clean-then-fail-mid-plan class: a `{from: context}` value source and a `{context:…}` placeholder in
COMMAND TEXT are refused at LOAD, naming the key and the prompt that makes it resolvable, because the
interim substrate resolves sources out of flow data and would only discover the miss at the step that
consumed it (`load-closure.ts`, `load-coherence.ts`). The third makes the closure stage's scope equal
the reachability stage's, so a conflict-key template or a reservation reachable only through a
CAPABILITY is type-checked exactly like one an intent lists (`load-references.ts`). The fourth checks
`$ref.kind` against its declared-closed vocabulary at load rather than letting a typo diverge at bind
(`parameters.ts`). A compiled plan also now carries the configuration version it was compiled from
(`plan-compiler.ts`, `vocabulary.ts`).

`infrastructure` grows because the composition root pins that version into flow data at start and
REFUSES, with a typed `CONFLICT`, to drive a stored positional cursor under a different one - on the
webhook resume and on the failed-start re-drive alike (`wire.ts`). That is the interim guard for PC-4;
resuming against the pinned document stays owned by prompts 15/19.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,638 | 6,680 | 42 (unchanged ceiling) |
| `domain` | 9,085 | **9,150** | 65 |
| `infrastructure` | 8,315 | **8,360** | 45 |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Two ceilings move, each only as far as its own measurement plus headroom inside the band the sibling
layers carry. `contracts` is re-taken here and is unchanged, so its ceiling is left alone rather than
re-baselined for company.

## Amendment (2026-08-11, review round 9): re-measured, NO ceiling moves

This round answers the version guard's own fallout and pays for it out of the headroom the round-8
figures already carry, so the figures below are recorded and the ceilings are left where they are.

`contracts` gains one accessor: the error taxonomy already recorded whether repeating a request could
plausibly succeed, and a caller deciding what an EXTERNAL system should do with a failure now reads that
flag rather than inferring it from the status class (`errors.ts`).

`infrastructure` gains three things, all one root cause. The webhook stops flattening every failed
callback to 5xx, so a permanent refusal answers its own 4xx instead of asking an e-sign provider to
redeliver, indefinitely, a callback that can never succeed. `versionMismatch` treats a MISSING recorded
version as LEGACY and continues - refusing it would have made the guard's first act on deployment the
stranding of every legitimate in-flight execution - and names the two versions in its refusal instead of
misattributing the cause. And the REPLAY path is held to the same discipline as the two paths that
drive: its awaited rule is read at `awaitingByStep[cursor - 1]`, so under a bumped plan it would name a
step the execution never took.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,649 | 6,680 | 31 (unchanged ceiling) |
| `domain` | 9,085 | 9,150 | 65 (unchanged ceiling) |
| `infrastructure` | 8,341 | 8,360 | 19 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

`infrastructure` is now 19 lines from its ceiling. That is deliberately NOT relieved here: headroom is
bought with a measurement and an argument, never banked in advance against work that has not been
written.

## Amendment (2026-08-11, review round 10): `domain` re-measured

The 65 lines of correction headroom the round-9 figures carried are spent, on the last two members of
the load-clean-then-fail-mid-plan class and on nothing else.

`domain` answers both. A capability that sources a slot the requester does not supply is refused where
the plan becomes RUNNABLE (`plan-compiler.ts`): the interim resolver reads a slot only through its
declared trigger field, and the intent grammar forbids one on a `bound-by-primitive` or `derived` slot,
so such a plan would commit its earlier steps and then fail at the step that consumed it. The refusal is
at COMPILE rather than at LOAD because the authoring is legitimate - money movement's household and
source account genuinely are selected by primitives, and their values arrive with the evaluator's
context plane (prompt 16) - so refusing the DOCUMENT would reject a shipped deliverable to close a
runtime hole. Second, a command-text placeholder is now checked against the slots of the intent whose
plan actually renders it rather than against the union of every intent's slots
(`load-references.ts`), because `buildPayload` resolves it through one intent's resolver while stage 6
is authored per domain.

`contracts` and `infrastructure` are re-taken and unchanged except for the webhook route, which is app
code in no measured bucket: the status it returns is a message to the provider about redelivery, and
every refusal now takes one dedicated status rather than passing an internal code's own status through
onto a status this endpoint already owns. `domain/observability/safe-values.ts` gains the one registered
log message that carries the diagnosis the narrowed status no longer does.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,649 | 6,680 | 31 (unchanged ceiling) |
| `domain` | 9,176 | **9,240** | 64 |
| `infrastructure` | 8,341 | 8,360 | 19 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Only `domain`'s ceiling moves, by 90 lines, and only as far as its own measurement plus the 64
lines of correction headroom the previous amendment left, less the one line this round added after the figure was first taken - not more, because headroom is bought with a
measurement and an argument rather than banked against work that has not been written.

## Amendment (2026-08-12, review round 11): `infrastructure` re-measured, NO ceiling moves

This round is paid for out of the 19 lines the round-9 figures left, and spends four of them.

`infrastructure` gains one branch and its argument in `wire.ts`: the REPLAY path DEGRADES a
version-disagreeing report - real persisted status and resume token, awaited rule undetermined - rather
than answering `failed`, which corrects the round-9 refusal on that same path. Refusing to DRIVE a stale
positional cursor and refusing to REPORT an execution that plainly exists are different acts, and the
`failed` answer told a browser its submission never happened, whose client then minted a fresh request
id and opened a duplicate execution (D-237). The two paths that drive steps still refuse, unchanged.

`contracts`, `domain` and `presentation` are re-taken and unchanged. The round's other two corrections
are app code in no measured bucket: the intake route reports a configured field this deployment cannot
carry as an INTERNAL rather than a client VALIDATION, and the account-opening journey burns its
per-session request id only on a VALIDATION.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,649 | 6,680 | 31 (unchanged ceiling) |
| `domain` | 9,176 | 9,240 | 64 (unchanged ceiling) |
| `infrastructure` | 8,345 | 8,360 | 15 (unchanged ceiling) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

`infrastructure` runs 15 lines from its ceiling, the narrowest this layer has held. That is recorded, not
relieved: a ceiling raised without a measurement beside it is a ceiling nobody is holding.

## Amendment (2026-08-12, review round 12): `contracts` and `infrastructure` raised for the client instruction

The account-opening endpoint answers two different `CONFLICT`s whose remedies are OPPOSITE: a spent
request identity (an edited resubmit) clears the moment the client mints a new one, while an execution
bound to a superseded configuration version can never be cleared by resubmitting. A client that infers
its next move from the error CODE must get one of the two wrong, and the two mistakes are not symmetric -
minting a fresh identity is minting a fresh EXECUTION, and the per-write idempotency keys are
execution-scoped, so the wrong burn writes duplicate household, contact and application rows. So the
inference is replaced by an INSTRUCTION the server decides where it knows.

`contracts` gains that closed vocabulary (`client-retry.ts`, three members and the argument for why it
cannot be an error code). It is RAISED here rather than ratcheted down as in review round 4: that ratchet
paid for deleted code with no consumer, and this is added code consumed in three layers - the composition
root that decides, the route that answers, and the client that obeys.

`infrastructure` gains, in `wire.ts`, one instruction per refusal, decided at the point where the reason
is still known: a spent identity says mint a new one, a superseded configuration version says stop, and
every mid-flow step failure says resubmit unchanged - because that re-drives the SAME execution and its
committed writes replay under their existing idempotency keys.

`domain` moved and stayed inside its ceiling: one registered log message and one registered attribute
vocabulary in `observability/safe-values.ts`, so the diagnosis the browser no longer receives is not lost
but relocated to the log line, un-degraded. The route and the journey are app code in no measured bucket.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,682 | **6,710** | 28 |
| `domain` | 9,183 | 9,240 | 57 (unchanged ceiling) |
| `infrastructure` | 8,380 | **8,400** | 20 |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Both ceilings move as far as their own measurement plus the correction headroom a review round needs and
no further - 28 and 20 lines, the same order as every figure above them.

## Consequences

- A further increase remains a measured ADR amendment, never a silent fence edit.
- The `domain` layer is now the largest platform layer. That is the intended shape after prompt 10: the
  decision plane's grammar and its loader are domain code, and the domains themselves are not code at all.
- Ratchet-down resumes from these figures at Wave-close, per ADR-0018.

## Amendment (2026-08-12, review round 13): all three raised for the third refusal category

The permanent-versus-transient split the previous amendment shipped was a FALSE BINARY, and the case that
proves it is the configuration-version mismatch: it is neither, because it clears the moment an operator
rolls the published document back. Answering it "do not redeliver" DISCARDS A SIGNATURE the client already
gave, which is strictly worse than the unbounded redelivery that status was introduced to stop. So the
vocabulary gains a third arm and the surfaces gain the machinery to express it to two audiences.

`contracts` gains `retry-later` and the pacing constant every surface answering it puts on the wire
(`Retry-After`), plus the paragraph recording why the binary was wrong. It is raised rather than held
because it had reached its previous ceiling EXACTLY - 6,710 against 6,710 - which is the zero-headroom
condition ADR-0033 exists to prevent, where the next one-line correction fails an unrelated gate and the
only remedy is deleting documentation.

`domain` gains three things. The observability vocabulary gains a `correlationId` id field and a closed
`configStage` enum, so the reference a narrowed client message carries can appear in the operator's log
line un-degraded rather than as `[REDACTED]`. `plan-compiler.ts` gains an EXHAUSTIVE value-source
resolver: the `decision-hash` arm is written out and a `never`-typed tail makes a future grammar arm with
no resolver a BUILD failure instead of a silent run-time `absent`, which is the exact shape the payload
gap had. `engine.ts` gains the resume guard - a caller precondition judged against the one snapshot the
drive uses, which is what let the composition root stop loading the row a second time.

`infrastructure` gains the operator-visible parked-callback report (a signature waiting on a rollback must
never be discovered by a client phoning to ask why nothing happened), and the single place every
configuration refusal is minted: one generic sentence and a correlation id on the wire, the dotted document
paths and SHA-256 hashes in the error's `context`, which `toResponse` has never returned. The version guard
moved out of `wire.ts` into `config/execution-version.ts` - the composition root had passed the 500-line
per-file ceiling, and the rule it holds is a fact about the document, not about how a request is wired.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,710 | **6,740** | 30 |
| `domain` | 9,271 | **9,330** | 59 |
| `infrastructure` | 8,485 | **8,515** | 30 |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

Each ceiling moves to its own measurement plus the correction headroom a review round needs and no
further, the same order as every figure above it.

---

## Amendment (2026-08-12, review round 14): all three raised for classification by cause

The previous amendment answered a false binary at the webhook and left two holes behind it. The category
was still being assigned PER CALL SITE, so one broken document produced three different instructions - the
version guard said "come back", the start path said "resubmitting will not help; contact your operations
team", and the resume path said nothing at all and fell through to an unpaced 500. And the diagnosis the
previous round routed away from the wire went into `AppError.context` as prose, which nothing reads and
which this repository's log formatter would have censored anyway: the observability vocabulary admits only
registered enums and sealed ids, precisely so an unregistered value degrades to `[REDACTED]`. The
information did not exist and everyone believed it did.

`contracts` gains the classification rule stated where the categories are defined: an
`operatorRecoverable` marker a mint applies at the point that knows why, and a `clientRetryFor` every
surface asks instead of naming a category. Assigning by cause is what makes a refusal added later inherit
the instruction without anyone remembering to.

`domain` gains the configuration-diagnosis id vocabulary - the document id, the offending dotted path, the
version, and the pinned and read hashes - with a shape-checked factory: these are values the deployment's
own published document carries, so the provenance rule is a declared shape per field rather than a mint
ceremony, and anything outside it degrades exactly as an unregistered value does. `plan-compiler.ts` gains
the marks that make every compile refusal inherit the classification.

`infrastructure` gains the structured emission of that diagnosis at the single mint, and a version guard
that now logs the parked execution itself - on the start path as well as the webhook's - with the two
version ids as registered id fields rather than interpolated into a message the external e-sign provider
was reading verbatim.

All three layers sat within ~30 lines of their ceilings, which is the zero-headroom condition ADR-0033
exists to prevent, so each moves to its own measurement plus the correction headroom a review round needs.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,752 | **6,782** | 30 |
| `domain` | 9,333 | **9,393** | 60 |
| `infrastructure` | 8,589 | **8,619** | 30 |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

## Amendment (2026-08-12, review round 15): `domain` and `infrastructure` raised for the derived refusal class

`infrastructure` grows past its ceiling and `domain` reaches its own exactly, answering this round's
findings in code (D-244).

`infrastructure` gains `config/configured-flow.ts` - the compile of the published document, moved out of
the composition root because everything it refuses is a fact about the DOCUMENT, and because holding it
outside the configuration modules was what forced the domain-configuration fence to keep a hand-listed
residue of refusal sites at all. It also gains the step-refusal minter the plan compiler is handed, the
loader's own fault code on the operator's line, the absent-versus-censored path distinction, and a version
guard that states its `superseded` and `unreadable` verdicts apart instead of collapsing them.

`domain` gains the `ConfiguredStepRefusal` port and the two registered stages the new diagnosis carries,
against the deletion of `formatDomainConfigErrors` and its leaked message. It measured 9,388 against a
9,393 ceiling - five lines, which is the zero-headroom condition ADR-0033 exists to prevent and not a pass
to bank - so it moves too. `contracts` is RE-TAKEN here rather than carried forward and is unchanged at
6,752, comfortably inside the ceiling it already had, so that one is left alone rather than raised for
company.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,752 | 6,782 | 30 (unchanged) |
| `domain` | 9,388 | **9,450** | 62 |
| `infrastructure` | 8,683 | **8,745** | 62 |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

## Amendment (2026-08-12, review round 16): `domain` raised for the one-mint refusal port

`domain` grows past its ceiling answering this round's finding in code: the classification the previous
amendment shipped was correct and was still a CONVENTION. Nine refusals - six in the plan compiler, two in
the intake view, one in the composition root - each marked themselves `operatorRecoverable` and then wrote
their own sentence, interpolating the intent, capability, slot or trigger-field id they concerned. So the
browser got a server error with nothing to quote, the external e-sign provider got those ids verbatim, and
the operator got no log line at all. A tenth author would have written a tenth variant.

`domain` gains a third arm on the refusal port and a home for it beside the fault type it converts, the
plan compiler's six hand-written refusals rewritten as typed faults carrying real document paths, the
intake view's two rewritten the same way, and the `configPath` shape widened to the subscripted segment
its emitters had been producing all along (the loader subscripts every list it walks, so the shape sealed
exactly the run-time faults it exists to report). The deleted half is real - nine interpolated sentences,
two marker imports, one formatted message - so the net is 104 lines for a classification that is now
structural rather than remembered.

`contracts` and `infrastructure` are RE-TAKEN rather than carried forward. `infrastructure` moved by 18
lines and both stay inside the ceilings they already hold, so neither is raised for company.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,752 | 6,782 | 30 (unchanged) |
| `domain` | 9,492 | **9,555** | 63 |
| `infrastructure` | 8,701 | 8,745 | 44 (unchanged) |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

## Amendment (2026-08-12, review round 17): `domain` and `infrastructure` raised for the adapter mint and the emitter-derived shape

Both layers grow past their ceilings answering this round's findings in code. The classification the two
previous amendments made structural still had one site outside it: the COMMAND ADAPTERS, which live in
neither configuration directory and so were invisible to a rule derived from those directories. They
answered a published-configuration defect in their own words - a payload field the compiled command did
not carry, a registration outside the vocabulary the store accepts, a command type with no runner - so the
configured command type and payload field id went to the EXTERNAL e-sign provider verbatim, the provider
was told to redeliver forever with no pacing against a fault only an operator clears, and the operator got
no line at all.

`infrastructure` gains the adapters' three faults restated through the injected `ConfiguredRefusal` port,
the document path each reports, and the context threading that carries the mint to them. `domain` gains
the mint on the compiled plan (so the adapters and the plan's own steps provably share ONE port rather
than two built beside each other), the slot the intake projection carries so a fault addresses the node
the document really has, and the emitter-side depth bound that makes the `configPath` shape a consequence
of an admission rather than a second opinion about it: the shape had been widened once and capped at three
subscripts per segment against a substitution walk with no bound at all, which is the same defect the
widening fixed, one dimension over.

`contracts` is RE-TAKEN rather than carried forward and is unchanged at 6,752, comfortably inside the
ceiling it already holds, so it is left alone rather than raised for company.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,752 | 6,782 | 30 (unchanged) |
| `domain` | 9,622 | **9,685** | 63 |
| `infrastructure` | 8,769 | **8,815** | 46 |
| `presentation` | 928 | 6,000 | (ADR-0012 envelope, unchanged) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |

## Amendment (2026-08-12, review round 18): `contracts` and `domain` raised for the built fault location and the demo's value-shaped failure

Two layers grow past their ceilings answering this round's findings in code.

`contracts` gains the second cause reader (`causeRetryFor`). A surface whose OTHER arm carries no
instruction at all - the intake accessor answers a submitter's own omission with a plain VALIDATION, which
has no `retry` field - had nothing to fall back TO, so the fallback it passed was unsendable by
construction, and the one it named would have told a browser to burn the form session's request id over a
blank required field. Asking the cause directly removes the false branch instead of renaming it (D-249).

`domain` gains the statement of the diagnosis channel's capacity - the segment grammar and the length
ceiling - beside the emitter that must respect it, the carry inside `configError` (the ONE constructor of
every fault in the system), the grammar stage's segment-built location, the parameter walks' refusal of a
key the channel cannot name as one segment, and the refusal port's fourth arm with its registered
`undeclared-copy` stage. The defect being closed is the third form of one already fixed twice: the shape
could not express a document KEY, which is author-chosen and may carry whitespace (censoring the location
whole) or a `.` (shaping perfectly while naming a node the document does not have). A location is now
BUILT from segments rather than interpolated (D-250), and the demo station page resolves its configured
vocabulary and renders that refusal rather than throwing inside a builder on a server-rendered route
(D-251).

`contracts` had ELEVEN lines of headroom and `domain` was eighty lines over - both the zero-headroom
condition this ADR's header argues against, where the next one-line correction fails an unrelated ceiling.
`infrastructure` moved by two lines and stays well inside, so it is RE-TAKEN rather than raised for
company. `presentation` is re-taken too: the 928 carried forward since ADR-0058 had gone several rounds
stale, which is exactly what this ADR says a number nobody re-took is worth. The demo surfaces and route
live under `src/app/demo/` and `src/app/app/`, which no bucket measures - that gap is the pre-existing one
this ADR does not change.

RE-MEASURED on the composed tree, in this commit, with the fence's own algorithm:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| `contracts` | 6,771 | **6,810** | 39 |
| `domain` | 9,765 | **9,830** | 65 |
| `infrastructure` | 8,792 | 8,815 | 23 (unchanged) |
| `presentation` | 2,240 | 6,000 | (ADR-0012 envelope, unchanged; re-taken) |
| `tooling` | 12,154 | 12,400 | (ADR-0052 bucket, unchanged) |
