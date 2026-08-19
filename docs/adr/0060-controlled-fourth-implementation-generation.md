# ADR-0060: One controlled fourth implementation generation; current Verin becomes the legacy oracle

**Status:** Accepted (charter amendment - the opening "THIRD AND FINAL" sentence is superseded, not rewritten)
**Date:** 2026-08-19
**Deciders:** captain (ratification 2026-08-19)
**Relates to:** `CHARTER.md` opening identity sentence and the charter operating model (amended only by ADR); ADR-0023 (v3 adoption - unchanged for current Verin and as oracle evidence, not replacement selection); ADR-0024 (Salesforce deferral - unchanged); ADR-0041 (append-only decision ledger); ADR-0052 (corpus signoff contract, currently `pending-captain`); ADR-0057 (generated populated-world evidence)
**Informed by:** the captain-reviewed Wayfinder report and BASE-0 audit, which are PRIVATE FIRSTMATE
RECORDS held outside the Verin tree. They are NON-NORMATIVE decision inputs, not repository evidence,
and are not required to interpret or enforce F1-F9. Every premise this decision uses from them is stated
below. The BASE-0 premise identifies the divergent published Prompt 10 candidate snapshot on the
unmerged prompt-10 branch at `a99c46ce492d69fe1e56296eaf597b9234f6461c`, whose own fourteen
blocking CI gates were independently re-run from a fresh clone and all passed.

## Context

`CHARTER.md` has opened since 2026-07-18 with "This is the THIRD AND FINAL build of this product." The
captain has since asked for a further ground-up rebuild. That is a direct constitutional conflict, and
the captain ratifies as a premise that it cannot be resolved by reinterpretation: the conflict is real,
and a formal charter amendment is the first blocking decision, ahead of later probes and every
implementation action. This ADR states that premise directly; no external record is needed to apply it.

Three facts shape the amendment's shape rather than its existence.

1. **The external audit premise is scoped to its divergent candidate snapshot.** The captain ratifies
   as an external audit premise that published SHA
   `a99c46ce492d69fe1e56296eaf597b9234f6461c` is only the divergent published Prompt 10 candidate
   snapshot on the unmerged prompt-10 branch. Its own fourteen blocking CI gates were independently
   re-run from a fresh clone and all passed, with two named environment deviations and one named coverage
   gap. This is a captain-ratified premise, not proof supplied by this checkout. The snapshot is not an
   ancestor of this target, and its result does not verify this target, current main, or the current
   system. The oracle authority instead rests on F2.
2. **The architecture question is genuinely open.** The captain ratifies that the prior comparison
   recommended incremental kernel extraction before equivalent evidence existed for every arm, and that
   the evaluation therefore required a rerun: the comparison was unmatched and the clean application
   arm had no equivalent probe. Ratifying an architecture now would repeat that defect.
3. **The failure mode being guarded against is a fifth rebuild.** Meridian, Iris, and current Verin are
   three generations. Without a binding stop rule, "once and for all" is a sentiment rather than a
   constraint, and the same trade the retro found (architecture gained, product experience lost) is
   available again.

Nothing in the repository mechanically resolves any of this. The charter is amended only by ADR, and no
ADR existed for a fourth generation.

## Decision

**Amend `CHARTER.md` to authorize exactly one controlled fourth implementation generation, preserve
current Verin as the read-only legacy oracle, and bind the program with the limits it cannot grant
itself.** The amendment ships as clauses F1-F9 in `CHARTER.md`, immediately below the superseded
sentence:

- **F1** - one further implementation generation is authorized, built beside the current system. What is
  authorized TODAY is this amendment and subsequent disposable architecture experiments. Production
  implementation, durable replacement schemas, data migration, external effects, tenant cutover, and
  legacy retirement are explicitly withheld. Any later activity requires explicit captain authorization,
  with F8 governing durable replacement implementation and F9 governing cutover and legacy retirement.
- **F2** - current Verin at its shipped heads is the read-only behavioral, compatibility, and evidence
  oracle until an explicitly authorized cutover. Source history, signed truth, security semantics,
  decision records, audit evidence, and examiner-readable continuity are preserved intact, and the
  oracle is never edited to agree with the replacement.
- **F3** - destructive replacement and dual external effects are prohibited, including any comparison
  design that would need a second live effect.
- **F4** - there is no fifth rewrite. A proposal whose viability depends on a later rewrite is refused at
  proposal time.
- **F5** - the categories F5 names stay authoritative, and only on F5's individual-falsification terms.
- **F6** - no replacement architecture is selected by this amendment.
- **F7** - the choice is made by a matched disposable comparison of three arms - stabilization,
  incremental kernel extraction, and clean application composition - under identical inputs, timebox, and
  owner and gross-changed-line accounting.
- **F8** - durable replacement implementation is prohibited until a later, separate captain decision is
  identified and rules on the comparison evidence. F8 itself grants no authority.
- **F9** - tenant cutover and legacy retirement each require later explicit captain authorization against
  exact release proof.

F5 is the sole enumeration of its carry-forward categories. F2's oracle-preservation list is a distinct
obligation, not a restatement of F5.

The superseded sentence is left verbatim and carries an inline `[SUPERSEDED BY ADR-0060 ...]` marker.
The charter records what was intended and what replaced it; it does not present the amended state as
though it had always been the plan.

**The captain explicitly authorizes a TEMPORARY EXCEPTION to charter rule #1 for F1-F9.** The
accepted task forbids test changes, while the charter-drift mechanism ratchet is bidirectional: any new
enforced `charter-map.json` mechanism would also require editing `RATCHETED_ENFORCED_MECHANISMS` in
`src/__tests__/fitness/charter-drift.test.ts`. During the exception, the carriers are the charter text,
this ADR, and D-271. The captain knowingly accepts this eyes-open, fail-open interval, which expires
before any durable fourth-generation code, schema, migration, or production-path PR may merge. The
exception expires BEFORE any durable fourth-generation code, schema, migration,
or production-path PR may merge. After architecture ratification, a separate EXECUTABLE enforcement
contract boundary must land first. Disposable experiments may not be promoted into durable work in place
of that enforcement.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Read "THIRD AND FINAL" as compatible with a fourth build (the wording covers repositories, not generations) | The word-game reading contradicts the captain-ratified premise that the constitutional conflict is real. It pretends the conflict does not exist and leaves no stop rule behind |
| Delete or reword the historical sentence | Erases the record of what the captain intended on 2026-07-18. The charter's own amendment discipline exists so history is superseded in the open |
| Amend the charter AND ratify the architecture in one decision | Contradicts the captain-ratified unmatched-comparison premise: equivalent architecture evidence does not exist yet. F6/F7/F8 keep the two decisions separate |
| Authorize the rebuild without a no-fifth-rewrite rule | Leaves the recurring failure unbounded. F4 is the clause that makes "once and for all" a constraint rather than a hope |
| Defer the amendment until after the disposable probes | The probes are themselves replacement work. Under the unamended charter no agent has authority to run them, so the constitutional question has to be settled first |

## Trade-offs and Costs

- **Gained:** an honest constitution; a preserved oracle grounded in F2;
  an architecture decision that stays open until matched evidence closes it; a binding stop rule; and
  explicit withholding of every irreversible step, so no later agent can infer authority it was not
  given.
- **Sacrificed:** the simplicity of a one-line promise. The charter now carries a superseded sentence
  next to its replacement, which costs a reader a paragraph. Also sacrificed is speed: F7 requires three
  arms where one would be faster, and F8 inserts a captain decision before durable work begins.

## Consequences

**What becomes true.** F1-F9 bind every subsequent Verin change. An agent proposing replacement work
cites its authorizing clause or does not proceed. The disposable comparison arms are now authorized and
are the next action; durable implementation is not.

**Temporary enforcement exception and exact expiry.** The captain explicitly authorizes a TEMPORARY
EXCEPTION to charter rule #1 for F1-F9. During it, the carriers are the charter text, this ADR, and D-271.
The accepted task forbids test changes, while the charter-drift mechanism ratchet is bidirectional:
`mechanismRatchetProblems`, beginning at `src/__tests__/fitness/charter-drift.test.ts:313`, emits
`enforced mechanism is absent from the ratchet` for any new enforced `charter-map.json` mechanism absent
from `RATCHETED_ENFORCED_MECHANISMS`. The exception expires BEFORE any durable fourth-generation code,
schema, migration, or production-path PR may merge. After architecture ratification, a separate
EXECUTABLE enforcement contract boundary must land first. Disposable experiments may not be promoted
into durable work in place of that enforcement.

**What this does NOT do.** It selects no architecture (F6). It authorizes no production implementation,
durable replacement schema, data migration, external effect, tenant cutover, or legacy retirement (F1,
F9). It creates no implementation stories. It changes no product code, test, schema, migration, runtime
configuration, fixture, or signed evidence, and it moves no v3 invariant, gate, or SHA pin. The sixteen
non-negotiables are untouched and remain binding. Pre-amendment architecture and composition mandates in
the charter, including architecture ADRs such as ADR-0023..0029 / ADR-0055, continue to govern current
Verin and provide oracle evidence, but do not bind replacement composition unless the later F8 captain
ratification explicitly adopts them.

**Open items this decision deliberately leaves open.** The architecture path; a third-domain falsifier
for the comparison; ledger continuity and governance-archive requirements; product-story authority;
self-configuration observation scope and phase placement; the real Salesforce target; cutover; and
retirement are each unresolved and are not granted by F1.

## Revisit When

- **The matched comparison (F7) completes.** Its evidence triggers the F8 captain decision; this ADR is
  then amended by the ADR that ratifies (or rejects) an architecture.
- **Any durable fourth-generation code, schema, migration, or production-path PR is proposed.** The
  temporary exception expires BEFORE such a PR may merge. After architecture ratification, a separate
  EXECUTABLE enforcement contract boundary must land first, and no disposable experiment may be
  promoted into durable work in place of that enforcement.
- **Any arm cannot be built disposably** - if a comparison arm requires a durable schema, a migration, or
  a live external effect to be meaningful, F7 is unsatisfiable as written and the captain re-scopes it
  rather than an agent relaxing it.
- **A fifth rebuild is proposed under any name** (clean slate, reset, new repository, greenfield
  replacement of the fourth generation). F4 refuses it; reopening F4 is a captain decision recorded as
  its own ADR, and this row exists so that reopening cannot happen silently.
- **Cutover is proposed.** F2's oracle status and F9's authorization requirement are re-read against the
  exact release candidate before any tenant moves.
