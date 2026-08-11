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
not a re-baseline.

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

## Consequences

- A further increase remains a measured ADR amendment, never a silent fence edit.
- The `domain` layer is now the largest platform layer. That is the intended shape after prompt 10: the
  decision plane's grammar and its loader are domain code, and the domains themselves are not code at all.
- Ratchet-down resumes from these figures at Wave-close, per ADR-0018.
