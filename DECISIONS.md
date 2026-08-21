# Generation-4 decision journal

Reversible decisions proceed and are logged here; irreversible or architectural ones stop for the
captain (`CONSTITUTION.md`). The oracle's journal on `main` is separate and read-only (DC-2).

### GD-001 - 2026-08-20 - ADR-0060's temporary charter-rule-1 exception is closed by the enforcement contract

**What:** With PR-1d landing `E16` and completing `E1..E16`, generation-4's ADR-0001 closes ADR-0060's
temporary exception by name: F1-F9 are carried by the executable enforcement contract, not prose.
**Why:** ADR-0060 required the exception to expire before any durable fourth-generation code merges;
the contract now exists, is blocking, and is adversarially proven in `docs/proof-log.md`.
**Revert path:** a new captain-ratified ADR on `main` superseding ADR-0061; the contract itself is
never weakened by a revert here.

### GD-002 - 2026-08-20 - the foundation-seam row-set is recorded in E5's vocabulary, with two ruled collector sharpenings

**What:** Prompt 2 section 7's ceilings enter `CONSTITUTION.md` under `E5`'s measure names and formats;
Files touched hard is first-recorded as 32 (the 26 predates `E5`'s file-counting semantics); the owner
collector maps root-level bookkeeping files into one repository-cluster owner, never anything under
`src/` or `enforcement/`; `SEAM_MODULES` gains exactly `src/access/context.ts`.
**Why:** Captain ruling, 2026-08-20 (option A on key `e5-foundation-seam-reconciliation`); both
sharpenings carry companion mutation proofs in `docs/proof-log.md`.
**Revert path:** a captain re-ruling; every recorded value stays a downward-only ratchet meanwhile.

### GD-003 - 2026-08-20 - the E16 PII scan excludes exactly the runtime's own minted correlation ids

**What:** PR-2b's independent pass found the scan ~4 percent value-flaky: a runtime-minted span id is
16 hex chars, and an all-digit one matches the bare-account-reference pattern. The runtime now records
every id it mints (`mintedCorrelationIds` in the capture), and the checker excludes exact matches of
that list - shape-bounded to 16/32 unbroken hex, and only in the correlation keys `requestId`,
`traceId`, `spanId` - from account-reference candidacy. Nothing else changes: genuine account
references in bare, spaced or hyphenated form keep full sensitivity in every position, proven by the
companion in `docs/proof-log.md`.
**Why:** Ruled by the merge authority under the GD-002 pattern, 2026-08-20, on the falsification
pass's recommendation.
**Revert path:** a captain re-ruling; the sharpening only ever narrows the exclusion.

### GD-004 - 2026-08-20 - the evidence slice's ceiling row-set and its two recorded per-slice collector changes

**What:** Prompt 3 section 7's ceilings enter `CONSTITUTION.md` under the slice-specific slug
`ordinary-vertical/evidence` in `E5`'s measure names and formats; `SEAM_MODULES` gains exactly
`src/evidence/bundle.ts` (the EvidenceBundle seam); and the two slice-3 registry rows join the
prompt-owned correlation table the `E16` checker cross-checks, each declaring `RequestCorrelation`.
**Why:** Captain ratification of the revised prompt 3, 2026-08-20 ("Ratify - let prompt 3 sail"),
under the GD-002 pattern; companions in `docs/proof-log.md` (PR-3a).
**Revert path:** a captain re-ruling; every recorded ceiling stays a downward-only ratchet meanwhile.

### GD-005 - 2026-08-21 - the observation read retrieves at the bundle's own instant and refuses truncation

**What:** The observation store effect moves to `observation_list_for_household_v2`: the canonical SQL
filters `observed_at <= asOf`, so a bundle contains exactly what was observable at its own instant (a
replay property prompt 6's hashing relies on, and no negative-age observation can read as fresh), and
the read over-fetches one row past its 200 bound so a truncated result is DETECTED - the assembly
refuses to derive absence or conflict claims from a cut result rather than stating them over unread
rows. Both registry copies changed together; the `SemanticEffectId` moved with the bytes.
**Why:** Two P1 findings from the automated review of merged PR-3a; a reversible product decision
under the standing rules, with companions in `docs/proof-log.md` (PR-3b).
**Revert path:** a later statement version; the registry and admission table pin every shipped tuple.

### GD-006 - 2026-08-21 - the configuration slice's ceiling row-set and its recorded per-slice collector changes

**What:** Prompt 4 section 7's ceilings enter `CONSTITUTION.md` under the slice-specific slug
`ordinary-vertical/configuration` in `E5`'s measure names and formats; `SEAM_MODULES` gains exactly
`src/policy/registry.ts`; the slice-4 registry rows join the prompt-owned correlation table, each
declaring `RequestCorrelation`; and the vocabularies widen by exactly this slice - a Configuration
owner, slice 4, and the declared domains (`documentDigest` bare hex; `refusalReason` closed enum).
**Why:** Captain ratification of the revised prompt 4, 2026-08-21 ("Lets do it"), under the
GD-002/GD-004 pattern; companions in `docs/proof-log.md` (PR-4a).
**Revert path:** a captain re-ruling; every recorded ceiling stays a downward-only ratchet meanwhile.

### GD-007 - 2026-08-21 - the decision slice's ceiling row-set and its recorded per-slice changes

**What:** Prompt 5 section 7's ceilings enter `CONSTITUTION.md` under the slice-specific slug
`core-semantics/decision` in `E5`'s measure names and formats, per PR in the stack; `SEAM_MODULES`
gains exactly `src/decision/outcome.ts`; the runtime widens by exactly `flow-step` (non-effect),
owner `Product`, slice `5`, the per-row declared correlation kind with the sealed
`DecisionId`/`DecisionCorrelation` factories in the kernel, and the `decisionId` digest-domain
attribute (GD-003 unwidened); the decision route joins the permittedParents of the six existing
rows it reuses; and the `AccessContext` action union widens by exactly `decision.evaluate` now and
`conformance.read` when PR-5c lands its surface. The measured PR-5a diff (1,853 H lines against the
900 hard) forces the announced by-surface split PR-5a-i/-ii/-iii (unit count 31 -> 33): the
observation-vocabulary bump and seed states land with PR-5a-ii, with its enumeration correction
(five classes, not three - GC-11's binding disposition and GC-08's blocker force pending-actions
and household-directory) recorded there and in the PR bodies.
**Why:** Captain ratification of the revised prompt 5, 2026-08-21 ("Ratify - let prompt 5 sail"),
under the GD-002/GD-004/GD-006 pattern; companions in `docs/proof-log.md` (PR-5a units).
**Revert path:** a captain re-ruling; every recorded ceiling stays a downward-only ratchet meanwhile.
