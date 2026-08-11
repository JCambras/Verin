# ADR-0057: Line-budget amendment for the domain configuration schema

**Status:** Accepted
**Date:** 2026-08-11
**Deciders:** Founding architect
**Relates to:** ADR-0018 (per-layer line budgets), ADR-0029, ADR-0033, ADR-0048, ADR-0049, ADR-0050,
ADR-0051, ADR-0052, ADR-0054; charter non-negotiables #1 and #10; v3 prompt 10 (ADR-0056)
**Amends:** ADR-0054's ceilings for `contracts`, `domain`, and `infrastructure`

## Context

v3 prompt 10 (ADR-0056) lands the domain-configuration schema: the whole thirteen-section grammar, a
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

## Consequences

- A further increase remains a measured ADR amendment, never a silent fence edit.
- The `domain` layer is now the largest platform layer. That is the intended shape after prompt 10: the
  decision plane's grammar and its loader are domain code, and the domains themselves are not code at all.
- Ratchet-down resumes from these figures at Wave-close, per ADR-0018.
