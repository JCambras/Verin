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

### GD-008 - 2026-08-21 - PR-5b's recorded per-slice changes: the comparison rows and the two identity artifacts

**What:** The registry gains `route.decision-compare` (use-case, Request) and `decision.compareSide`
(flow-step, Decision - entered once per firm side, each side its own minted identity); the compare
route joins the permittedParents of `access.authenticate`, `access.authorize`, `access.withTenant`
and `evidence.assemble`; and two generated-deterministic artifacts enter the regeneration registry:
`src/decision/engine-identity.json` (den.v1 - SHA-256 over the exact closure DecisionPureClosure
resolves, one mechanism two uses) and `docs/evidence/decision-replay-manifest.json` (per case the
complete resolved identity set, attested byte-identical under America/New_York and Asia/Tokyo).
The comparison surface evaluates the two COMMITTED archetype documents (byte-equal to the seed's
per-firm publishes, asserted by test, labelled demonstrations) - no tenant boundary is crossed.
**Why:** Prompt 5 PR-5b's deliverables under the ratified prompt; companions in `docs/proof-log.md`.
**Revert path:** a captain re-ruling; rows and artifacts retire only with their surfaces.

### GD-009 - 2026-08-21 - PR-5c-i's recorded per-slice changes: the sixteen graded in public

**What:** The signed-case reader widens to ALL SIXTEEN cases (three reader corrections it forced are
recorded in the PR body: the stale-before-missing precedence inside the reserve rule, the "still
shows" balance pattern, attestation read independent of the figure); the registry gains
`route.conformance` (use-case, Request - renders the COMMITTED conformance file),
`conformance.runner` (module-operation), `conformance.readSignedCase` (module-operation, one
pin-verified oracle read per case) and `conformance.grade` (flow-step, Decision - each grade under
the DecisionCorrelation of the outcome it grades); the conformance route joins the permittedParents
of `access.authenticate` and `access.authorize`; `conformance.read` enters the closed Action union,
held by advisor. Two artifacts land: `docs/evidence/decision-conformance.json` (generated - the
three-valued per-field grade, regenerated and byte-compared; its generator REFUSES an unreconciled
ledger) and `docs/decision-reconciliation-ledger.json` (hand-owned - the 31 captain rulings, one per
DIFFERS: 10 CD-4b explanation sets, 16 CD-4c prose-quantity pendencies, GC-10's CD-4d key, 4 CD-4e
reservation orderings), reconciled in BOTH directions in suite - an unledgered difference and a
stale entry both fail. The replay manifest widens with the reader to eighteen rows.
**Why:** Prompt 5 PR-5c-i's deliverables under the ratified prompt: the engine re-derives every
signed disposition from evidence and configuration alone, and every field-level difference is
public, ruled, and awaiting the captain's signature sitting - never absorbed.
**Revert path:** a captain re-ruling; the register retires only with the slice.

### GD-010 - 2026-08-21 - PR-5c-ii: the pin move to the captain's signing commit

**What:** `oracleHead` moves from 644938fd to 5542c999 - the captain's ONE amendment PR (#63) of
the 2026-08-21 signature sitting, rulings CD-4b/CD-4c/CD-4d applied - and the seventeen pins
regenerate byte-identically via the registered command. The grader consumes the amendment's
typedQuantities tables: the CD-4c verdict is now a real one-for-one comparison of the signed typed
table against the reader's asserted parse table (booleans admitted in the value union), MATCHED on
exact agreement. `KNOWN_KEY_DIVERGENCES_BEFORE_SIGNATURE` empties - M-J passes with no exceptions
list and pins the convergence. Exactly the 27 converged reconciliation-ledger entries are deleted
(10 CD-4b, 16 CD-4c, 1 CD-4d); the 4 CD-4e reservation-ordering entries remain, the oracle
standing unedited by the recorded ruling. Conformance totals move 183/31/28 to 210/4/28. The
replay manifest is byte-unchanged - the amendment added typed tables without touching prose, so
every parsed input, evidence digest and outcome digest is identical. This commit closes the
deliberate E10-red window; no signed byte was ever touched from generation-4.
**Why:** Prompt 5 section 5C steps 5-6 under the ratified protocol; M-D's two-directional rule is
the proof of convergence - the suite fails until exactly the right entries are gone.
**Revert path:** a captain re-ruling; the pins only ever move forward with a signing act.

### GD-011 - 2026-08-21 - PR-6-pre makes signed typed quantities the only DecisionInput source

**What:** Direct prerequisite inspection found that the signed-case reader still derived engine inputs
from regular-expression matches over summary prose, then compared those values with the signed
`typedQuantities` rows. Under the recorded CD-4c intent, PR-6-pre deletes that load-bearing prose parse.
Every previously parsed `DecisionInput` value now comes from exactly one signed typed row; a missing,
duplicate, wrong-kind, or unused row fails closed naming its case, reference, and field. Summary prose
is not an engine input. The prompt 6 `core-semantics/record` E5 row-set is therefore recorded now,
before this preliminary product diff, and `SEAM_MODULES` gains exactly
`src/record/decision-record.ts` for the later DecisionRecord seam.

**Stack and aggregate recomputation:** This bounded prerequisite correction moves the program count
**36 -> 37**. The revised order is PR-6-pre, PR-6a, PR-6b, PR-6c. Across those four units, the per-PR
row-set sums to H 2,400 preferred / 3,600 hard; files 56 / 80; canonical owners 8 / 12; public seam
symbols 16 / 24; database objects 32 / 56; direct dependencies 0 / 0 in both allowlists; G 32 files / 12
MB preferred and 64 files / 32 MB hard; B 32 files / 24 MB preferred and 56 files / 40 MB hard. The
aggregate review formula is 316 preferred minutes and 478 hard minutes; summing the table's individually
rounded hard rows reports 480 minutes because each 119.5-minute row displays as 120.

**Why:** The product owner resolved the Prompt 6 prerequisite stop under CD-4c's stated intent: no engine
input may ride on a regular expression again. The committed mutation battery proves a changed typed value
is detected after the exact clean-tree control passes, while the replay manifest remains byte-identical.
**Revert path:** a later product-owner ruling; restoring prose-derived inputs would reopen Prompt 6's
signed-input prerequisite and is not an implementation-level revert.

### GD-012 - 2026-08-21 - PR-6a splits at the committed E5 hard ceiling

**What:** The smallest compileable record/load/verify skeleton was committed at `6dcc0288` and measured
by the committed E5 collector over the exact `72f69161..6dcc0288` range. It measured H 1,162 against
900 hard and a 145-minute review surface against 120 hard. No further product code proceeded on that
shape. PR-6a is split into PR-6a-i for the governed atomic record path and its reachable decision
surface, then PR-6a-ii for bounded pre-identity reads, load, whole-chain verification and the examiner
surface. PR-6b replay/conformance and PR-6c continuity retain their order and scope.

**Stack and aggregate recomputation:** This mandatory split moves the program count **37 -> 38**. The
order is PR-6-pre, PR-6a-i, PR-6a-ii, PR-6b, PR-6c. Across five units, the per-PR row-set sums to H 3,000
preferred / 4,500 hard; files 70 / 100; canonical owners 10 / 15; public seam symbols 20 / 30; database
objects 40 / 70; direct dependencies 0 / 0 in both allowlists; G 40 files / 15 MB preferred and 80 files
/ 40 MB hard; B 40 files / 30 MB preferred and 70 files / 50 MB hard. The aggregate review formula is
395 preferred minutes and 598 hard minutes; summing the table's individually rounded hard rows reports
600 minutes.

**Why:** Prompt 6 section 9 makes every hard ceiling a stop and specifically anticipates a split between
atomic record and full verification/product examination. The measured skeleton proved that split was
required, not optional.
**Revert path:** recombine only if the committed collector proves the complete unit remains below every
downward-only hard ceiling; review convenience cannot waive a measured stop.

### GD-013 - 2026-08-22 - PR-6a-iii closes the verifier-proof stop before replay

**What:** PR-6a-iii is a dedicated corrective unit after PR-6a-ii and before PR-6b. It adds a second
behavioral jaw, independently invocable through `pnpm test:decision-record-verifier`, which exercises
the public `DecisionRecord.verify()` seam against a same-length, valid-JSON rewrite of the genesis
continuity citation and a separate stored-hash rewrite. The command is its own blocking workflow step,
between the instrumented suite and the closure proof, so test-discovery drift cannot remove it. The
earlier source-text check remains only a cheap third check. The unit also proves Axe on the examiner
loaded state and corrects the demonstration watermark's flex alignment.

**UNIT COUNT CHANGE - 38 -> 39:** The ordered stack is PR-6-pre, PR-6a-i, PR-6a-ii, PR-6a-iii, PR-6b,
PR-6c. Across six units, the per-PR row-set sums to H 3,600 preferred / 5,400 hard; files 84 / 120;
canonical owners 12 / 18; public seam symbols 24 / 36; database objects 48 / 84; direct dependencies
0 / 0 in both allowlists; G 48 files / 18 MB preferred and 96 files / 48 MB hard; B 48 files / 36 MB
preferred and 84 files / 60 MB hard. The aggregate review formula is 474 preferred minutes and 717
hard minutes; summing the table's individually rounded hard rows reports 720 minutes.

**Why:** A total early return could leave the previous text companion's searched verifier body present
as dead code. A second pass then proved that identically malformed-byte damage did not reach the
entry-identity or chain-hash bindings. The corrected jaw covers both named failures, rejects the three
exact content-binding hollowings, and runs in the blocking gate before any replay code can depend on it.
**Revert path:** only after a replacement independently invocable behavioral check proves the same
public-seam damaged-chain refusal under both recorded stubs.
