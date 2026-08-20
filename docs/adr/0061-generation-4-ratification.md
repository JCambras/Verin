# ADR-0061: Generation-4 ratification - F8 discharged, delivery constraints and dependency baseline ratified, one bootstrap push authorized

**Status:** Accepted (captain rulings of 2026-08-20 applied from the ruled decision sheet; no
placeholder remains; the B-6 bootstrap record was appended in place 2026-08-20 by the post-push
amendment PR this ADR itself directs, immediately after the authorized push ran)
**Date:** 2026-08-20
**Deciders:** captain
**Relates to:** `CHARTER.md` F1-F9 (`CHARTER.md:41-52` at the head cited below; this ADR discharges
F8 and touches neither F9 nor the default branch) and non-negotiables #10, #11, #14, #15
(`CHARTER.md:178-206`); ADR-0060 (authorizes the one controlled fourth implementation generation this
ADR rules on; its temporary charter-rule-1 exception is closed by a LATER ADR that prompt 1
deliverable 7 authors once the executable enforcement contract exists - never by this one); D-271;
ADR-0056 (the named-deferral discipline the CD-5d ruling extends to the fourth generation)
**Informed by:** the final rebuild package (`data/verin-rebuild-final-package-v1/` in firstmate:
brief, report, prompts 01-10) and the F7 comparison evidence (`data/verin-f7-ranker-v1/report.md`,
the three arm reports, two falsification reports, one measurement report, and the F8 captain decision
memo under `data/verin-audit-recovery-final/`, all digest-verified). Following ADR-0060's precedent,
these are PRIVATE FIRSTMATE RECORDS held outside the Verin tree: NON-NORMATIVE decision inputs, not
repository evidence. Every premise this ADR uses from them is stated in this ADR's own text, so the
ADR is enforceable without reading them.

## Context

Meridian, Iris, and current Verin are three generations. ADR-0060 amended the charter to authorize
one controlled fourth implementation generation under clauses F1-F9, preserving current Verin as the
read-only legacy oracle. F7 required a matched disposable three-arm comparison before any durable
replacement implementation; that comparison has run and its evidence is summarized under R-1 below.
F8 prohibits durable replacement implementation until a later, separate captain decision rules on
that evidence - and F8 itself grants no authority. This ADR is that separate captain decision.

The rebuild program's first prompt refuses to run unless seven captain-authored records, R-1 through
R-7, exist on `main`, and unless six comparison holds and five produced-versus-signed-outcome
decisions are answered. This ADR carries R-1, R-2, R-3, R-5, R-6 and R-7 under their own headings,
records the hold and produced-versus-signed rulings so the gate can verify them by reading this file,
and is matched by the `DECISIONS.md` entry that carries R-4. Two further decisions the prompts assume
but never ask - X-1, the reviewer requirement, and X-2, PR-1d's placement - are ruled here so neither
becomes an improvisation at the moment it bites.

## Decision

### R-1. F8 is discharged: the fourth-generation direction is a clean application composition beside the current system

The F7 evidence, stated as this ADR's own premises: three disposable arms were built and measured -
C (clean composition beside the base), K (incremental kernel extraction), S (stabilization in place).
The ordinal evidence-strength ordering C > K > S is stable under every reading and weight vector, but
the weighted totals are struck because the pre-declared scoring bands never existed in the frozen
instrument. No arm is rankable: arm C fails the mandatory produced-versus-signed gate at 10 of 16
signed cases (its mismatches concentrated in narration - explanation codes six times, ledger ordering
once, idempotency key once - with all four vertical-slice cases exact), and arms S and K produced no
outcomes at all, so the gate is not established for them. Arm C alone produced a real decision for
all sixteen signed cases through an end-to-end vertical slice, and alone had its security, replay,
accessibility and amplification claims independently re-executed. The falsification layer was
unmatched across arms, so the comparison supports per-arm conclusions and never arm selection. No
arm is ratifiable; a direction is.

The captain rules: ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md).

### R-2. No arm is promoted; arm C, arm K and arm S code is discarded

The arms were disposable probes under F8/E8: no arm may be promoted into production by the fact that
it was built. Arm C's code additionally carries verified weaknesses (a PII proof that substituted
rendered output for logs, a closure check that injected into an in-memory copy rather than the tree,
two domain constants taken from signed expected-outcome sections) and no answer for authorization,
migrations, durable storage or operational controls. Only the arms' measurements and findings
survive, as evidence. No F7 arm tree, bundle or file is copied into the repository.

The captain rules: ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md).

### R-3. The seven generation-4 delivery constraints, DC-1..DC-7, are ratified by name

Reproduced verbatim from the program's prompt 1 section 10 (in DC-7's reproduced words, "this
document" and "this file" refer to that prompt file; the authority DC-7 points at is this ADR):

> - **DC-1.** The product and the GitHub repository stay named **Verin**.
> - **DC-2.** Current `main` and all old history are preserved as the **read-only** behavioral,
>   compatibility, and evidence oracle. The oracle is never edited to agree with the replacement.
> - **DC-3.** After, and **only** after, explicit captain ratification, a clean `generation-4` **orphan**
>   branch is created in the same repository.
> - **DC-4.** All rebuild pull requests target **`generation-4`**, never current `main`.
> - **DC-5.** No unrelated old history is merged into the orphan branch. Only individually justified
>   semantics, tests, or code are ported, after characterization.
> - **DC-6.** No change to the default branch, no tenant cutover, no retirement of the old runtime, and
>   no real external effect, without separate explicit captain approval against exact evidence.
> - **DC-7.** **No branch is authorized by this document, and none exists merely because a prompt
>   describes it.** The authority is the ADR in R-1, not this file.

The captain rules: ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md).

*(R-4 is not a section of this ADR: it is the matching `DECISIONS.md` entry, expected id D-272,
drafted in `decisions-entry-draft.md` with its revert path, landing in the same pull request as this
file.)*

### R-5. Exactly one bootstrap push is authorized, by name and with bounds

A root commit has no parent and no base, so `generation-4` cannot be created by a pull request. This
ADR authorizes the single direct push that creates it - the one operation in the whole ten-prompt
program not delivered through a pull request - under these terms:

- **B-1. Exactly one push, and it is the only one.**
  `git push origin refs/heads/generation-4:refs/heads/generation-4` - no `--force`, no
  `--force-with-lease`, no `+` refspec, no delete-and-recreate, no tag, no second branch, and no
  second direct push by anyone for the lifetime of the program. Force push to `generation-4` is
  prohibited, ever. This push is not a precedent for anything, and no later prompt may cite it as
  one.
- **B-2. The root commit contains exactly one file:** `README.md` at the repository root, and nothing
  else - no `CONSTITUTION.md`, no workflow file, no code, no dependency manifest, no lockfile, no
  fixture, no subdirectory. Bound: 30 reviewable lines preferred, 50 hard. The authorized bytes are
  reproduced in full at the end of this section and are captain-reviewed here, before the push, so
  nothing unreviewed reaches the branch even though the platform reviews nothing.
- **B-3. Stop if the branch exists.** `git ls-remote --heads origin refs/heads/generation-4` is
  re-run immediately before the push; if it returns anything at all, nothing is pushed and the run
  stops and reports.
- **B-4. The exception is closed immediately, before any other commit.** Branch protection on
  `generation-4` requiring a pull request before merge, with force push and branch deletion
  disabled, is enabled in the same sitting. Under the X-1 ruling below, the required approving
  review count is zero: the program's one existing account must be able to merge every PR alone, so
  no protection term may demand an approval no existing account can give. (The program's recommended
  term - at least one approving review from someone other than the author - is amended exactly this
  far by X-1 and no further.) The protection settings are captured as the platform returns them, not
  as requested, and the protection is proven live by attempting a direct push of a trivial commit
  and watching the platform refuse it, recording the refusal text. If any step fails, the run stops:
  an open exception is worse than no branch.
- **B-5. Everything after the root goes through a pull request.** Every commit that follows the root
  commit, in this prompt and all nine that follow, targets `generation-4` through a pull request,
  without exception. There is no second bootstrap.
- **B-6. The record.** The exact pushed SHA; the exact file list as `git show --stat --name-only`
  prints it (which must be `README.md` and nothing else); the reviewable line count; the
  `git rev-list --max-parents=0 generation-4` output showing one root; the empty
  `git merge-base --all generation-4 origin/main` result; the platform-returned protection settings;
  and the refused-direct-push transcript are recorded in this ADR and again in `CONSTITUTION.md`
  when PR-1a lands it, before prompt 2 may begin.

**Bootstrap record (B-6).** This ADR merges to `main` before the push exists, so the record below is
appended by a follow-up documentation pull request to `main` that amends this ADR in place
immediately after the push (house precedent: ADR-0055, amended in place with each ruling). These are
post-push facts, not rulings, so they are not decision-sheet placeholders and phase 7 does not fill
them:

- Pushed SHA: `71ef1955c3f65710ab5010832a67f27a2aa76cfe` (pushed 2026-08-20 by
  `git push origin refs/heads/generation-4:refs/heads/generation-4`, after the B-3 recheck
  `git ls-remote --heads origin refs/heads/generation-4` returned nothing).
- File list from `git show --stat --name-only 71ef1955c3f65710ab5010832a67f27a2aa76cfe`: `README.md`
  and nothing else - `1 file changed, 14 insertions(+)`, `create mode 100644 README.md`.
- Reviewable line count: 14, within the 30-preferred/50-hard bound; the pushed bytes are exactly the
  authorized bytes reproduced below (SHA-256
  `a93d9c31b93f28e4336f8a98861708dd5f05b58a9b6452bf32c03bc03bcc44fc`).
- Root-commit and merge-base transcripts: `git rev-list --max-parents=0 generation-4` prints exactly
  `71ef1955c3f65710ab5010832a67f27a2aa76cfe` (one root, no parent);
  `git merge-base --all generation-4 origin/main` prints nothing and exits 1, with `origin/main` at
  `644938fd628e7bdd5842c5b7941b0aba0b1d69ab`.
- Platform-returned protection settings (as returned, not as requested): repository ruleset id
  `21103072`, name `generation-4-protection`, `source: JCambras/Verin`, `target: branch`,
  `enforcement: active`, conditions `ref_name.include = ["refs/heads/generation-4"]`, rules
  `deletion`; `non_fast_forward`; `pull_request` with `required_approving_review_count: 0` (the X-1
  amendment), `dismiss_stale_reviews_on_push: false`, `required_reviewers: []`,
  `require_code_owner_review: false`, `require_last_push_approval: false`,
  `required_review_thread_resolution: false`, `require_extra_approval_for_unattributed_changes: true`
  (platform-added default), `allowed_merge_methods: ["merge", "squash", "rebase"]`;
  `bypass_actors: []`; `current_user_can_bypass: never`; created `2026-08-20T13:47:16.998-04:00`.
- Refused-direct-push transcript (B-4.3, a trivial local commit pushed and refused by the platform):
  `remote: error: GH013: Repository rule violations found for refs/heads/generation-4.` /
  `remote: - Changes must be made through a pull request.` /
  `! [remote rejected] generation-4 -> generation-4 (push declined due to repository rule violations)`
  / `error: failed to push some refs to 'https://github.com/JCambras/Verin'`. The trivial commit was
  reverted; local and remote `generation-4` both stand at the pushed root
  `71ef1955c3f65710ab5010832a67f27a2aa76cfe`, verified by a fresh `git ls-remote` after the reset.

**The authorized `README.md`, verbatim, 14 lines, within the 30-preferred/50-hard bound:**

```
# Verin

This branch, `generation-4`, is the fourth-generation rebuild of Verin. It is not the default branch
and it is not the running system. The `main` branch is the read-only oracle: it holds the current
system, its history, its signed truth, and its audit evidence, and it is never edited to agree with
anything on this branch. `CONSTITUTION.md`, which states the rules every change to this branch obeys,
arrives in the first pull request against this root (PR-1a); until it lands, this file is the only
content here.

This root commit was created by a single authorized push, because a root commit has no parent for a
pull request to review against. Branch protection requiring a reviewed pull request is enabled on this
branch immediately after that push. Every commit after this one arrives through a pull request.

The product and this repository remain named Verin.
```

The captain rules: ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md).

### R-6. Where charter non-negotiables #11, #14 and #15 land

`CHARTER.md:63-66` places these obligations outside F5's falsification path, so they cannot lapse:
they land, or they are deferred by name with an owner and an expiry, in this section. A silent
deferral is not an answer. The proposed landings: **#15** (supply-chain and security scanning as CI
gates) as prompt 1 enforcement rules E11..E15 - dependency integrity, dependency audit, secret
scanning, static analysis, SBOM - blocking, never advisory; **#14** (observability from commit #1) in
two halves - its emission half as rule E16 plus prompt 2's governed runtime and first instrumented
governed route, where it is actually built, then prompts 3-9 as each slice registers and exercises
its operations under E16, and its SLO-and-alerting half as prompt 10 deliverable 15, with prompt 10
deliverable 14 proving at one candidate what the earlier slices emitted; **#11** (non-functionals
measured, not modeled) - the p95 step-latency, LCP, and 1,000-households-by-2,000-accounts load gate -
as prompt 10 deliverable 6.

The captain rules: ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md).

### R-7. The two dependency allowlists are ratified by exact package name and exact version

The clean branch has no inherited manifest, so a program that does not ratify a baseline has no legal
way to install one. Both lists are exact-pinned with no range anywhere in the manifest; the lockfile
is frozen; the manifest, the lockfile and `CONSTITUTION.md` must carry the same string for every
entry; and every later prompt's dependency budget counts new additions after this baseline (prompt
9's addition ceiling is zero). The enforcement rule reads `process.versions.node`, parses the exact
`@types/node` manifest version, and refuses unless both majors are 22 and equal - `@types/node` is
pinned at exactly 22.20.1 for the Node 22 runtime. Hard counts: eleven application/runtime entries
preferred, thirteen hard; thirteen development entries preferred, fifteen hard.

**Application/runtime direct dependencies - eleven.**

| # | Package | Exact version | The one responsibility it holds |
|---|---|---|---|
| 1 | `next` | 16.3.1 | the application framework: routing, server rendering, server actions, and the entry point of each of the two runtime roles |
| 2 | `react` | 19.2.8 | the UI runtime |
| 3 | `react-dom` | 19.2.8 | the DOM renderer for that runtime |
| 4 | `pg` | 8.23.0 | the PostgreSQL client. The **only** database driver in the program, linked and constructed only inside the private runtime kernel during the one governed-runtime construction |
| 5 | `zod` | 4.4.3 | strict boundary parsing with unknown keys refused: request payloads here, configuration documents at prompt 4, signed-case bytes at prompt 5 |
| 6 | `@opentelemetry/api` | 1.9.1 | the trace and metric API the governed runtime calls. No module calls it directly except the runtime |
| 7 | `@opentelemetry/sdk-trace-base` | 2.10.0 | span processors and the **in-memory span exporter** the `E16` capture reads |
| 8 | `@opentelemetry/sdk-trace-node` | 2.10.0 | the Node tracer provider and its async-context manager, which is what makes parent linkage real rather than reconstructed |
| 9 | `@opentelemetry/sdk-metrics` | 2.10.0 | the meter provider and the **in-memory metric reader** the capture reads |
| 10 | `@opentelemetry/resources` | 2.10.0 | resource attributes identifying each runtime role on every emission |
| 11 | `@opentelemetry/semantic-conventions` | 1.43.0 | the canonical attribute keys, so the naming function does not invent a key that already has a standard name |

**Development/test/build direct dependencies - thirteen.**

| # | Package | Exact version | The one responsibility it holds |
|---|---|---|---|
| 1 | `typescript` | 6.0.3 | the compiler and the type system every sealed-type rule depends on |
| 2 | `@types/node` | 22.20.1 | Node 22 platform types, the exact current Node 22-line release verified from read-only registry metadata on 2026-08-20 |
| 3 | `@types/react` | 19.2.18 | React types |
| 4 | `@types/react-dom` | 19.2.4 | React DOM types |
| 5 | `@types/pg` | 8.23.1 | PostgreSQL client types |
| 6 | `vitest` | 4.1.11 | the unit and integration runner |
| 7 | `@playwright/test` | 1.62.1 | the browser runner: every UI behaviour is proven in a real browser |
| 8 | `@axe-core/playwright` | 4.13.0 | the accessibility scan inside that browser run |
| 9 | `eslint` | 9.39.5 | the edit-time linter |
| 10 | `typescript-eslint` | 8.67.0 | its TypeScript integration, as one package rather than a parser and a plugin |
| 11 | `prettier` | 3.9.6 | one formatter, so formatting is never a review topic |
| 12 | `ts-morph` | 28.0.0 | the typed AST the enforcement contract's construction rules read: sealed-factory, raw-client boundary, reachability, and the production-bundle graph |
| 13 | `tsx` | 4.23.12 | running the repository's own TypeScript tooling and generators without a build step |

The one named alternative, visible rather than silent: structured logging is owned, not imported
(the OpenTelemetry Logs SDK, `@opentelemetry/api-logs` and `@opentelemetry/sdk-logs` at 0.221.0, is
experimental 0.x; if the captain prefers it, it is two more runtime entries ratified here).

The captain rules: ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md).

### X-1. Reviewer requirement - RULED 2026-08-20: the reviewer requirement is reduced for this program, as an explicit decision

The repository has exactly one collaborator: JCambras, admin, on a user-owned repository with no
organization behind it and no pending invitations. The platform does not let a pull request's author
approve their own pull request, so a protection rule demanding an approving review from someone other
than the author would make every program PR unmergeable by the only account that exists.

The captain ruled, verbatim: "Just keep me as collaborator for now. For the foreseeable future, it's
just me and you." JCambras stays the sole collaborator - no new collaborator is invited and no second
captain-controlled account is created.

This is the explicit program-level reduction of the reviewer requirement, stated as a decision rather
than a workaround, and it binds every pull request in the program, PR-1a..PR-1d included:

- **The property this ruling preserves:** every program PR must remain mergeable by the captain
  alone. No branch-protection term may require an approval that no existing account can give.
- **Consequence on the bootstrap terms (B-4 above):** protection on `generation-4` requires a pull
  request before merge, disables force push and branch deletion, and sets the required approving
  review count to zero. The recommended term "at least one approving review from someone other than
  the author" is amended exactly this far and no further; the direct-push refusal proof in B-4 is
  unchanged, because requiring pull requests refuses direct pushes regardless of the approval count.
- **Consequence on the program's merge-authority rule:** the two-independent-reviewers requirement
  (one reviewing the seam and ceilings, one attempting to falsify the companion proofs) is reduced
  for this program to review by the captain, who holds sole merge authority. Both review roles are
  the captain's; the companion proofs and their proof-log entries remain mandatory in every PR, so
  what the second reviewer would falsify is still authored, still executable, and still on the
  record for any future reviewer.
- This reduction is temporary in intent ("for now"): see Revisit When. Strengthening protection
  later (adding a required review once a second account exists) is a captain decision and is not
  the weakening that stop condition 10 forbids.

### X-2. PR-1d placement

The E16 rule (governed-runtime observability) lands in PR-1d and is proven against real subjects
authored in disposable scratch clones, before any governed runtime exists in a merged tree; the
runtime it governs merges at prompt 2. Keeping it there front-loads the hardest rule. The
conditional, recorded so a slip is a ruled path rather than a violation: if PR-1d has not merged
when PR-1c merges, E16 lands with prompt 2's governed runtime, and prompt 2's prerequisite is
amended to match.

The captain rules: KEEP AS WRITTEN with the recorded conditional - the recommended option, both parts - ruled 2026-08-20, captain's words: "rule keep-as-written on X-2".

### The six comparison holds and the five produced-versus-signed-outcome decisions

Recorded here so the program's gate can verify them by reading this file on `main`. Each row's
durable hold (registered in firstmate) is answered by the same ruling; the rulings change what
"correct" means for the decision engine's truth gate, which is why they precede any engine.

| Id | Hold or decision | Captain ruling |
|---|---|---|
| CD-5a | `missing-bands` - post-hoc scoring bands or ordinal-only F7 result | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-5b | `ga-applicability` - is the produced-versus-expected gate three-valued | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-5c | `gd-sc7-scope` - figure-scoped or bundle-scoped reproducibility | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-5d | `dq6-sk` - does DQ-6 fire; the forward deferral rule | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-5e | `amp-accounting` - both amplification regimes, always | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-5f | `falsification-asymmetry` - unmatched falsification cannot select an arm | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-4a | binding fields for a signed-case match | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-4b | standing of `expectedExplanationNodes` | ACCEPT RECOMMENDATION on the main direction (demote from independent binding truth; re-derive explanation codes from the rules that fire) - ruled 2026-08-20 via "Accept all the package defaults". SUB-CHOICE: option (i) RE-SIGN - the re-derived sets are re-signed as outputs of the ratified rule set, keeping explanations falsifiable; the captain signs; ruled 2026-08-20 by firstmate under the captain's explicit delegation, captain's words: "Go with your recommendations and keep moving" (see captain-rulings-2026-08-20.md addendum). |
| CD-4c | prose quantities republished as typed fields | ACCEPT RECOMMENDATION - ruled 2026-08-20, captain's words: "Accept all the package defaults, and rule keep-as-written on X-2" (recorded by firstmate; scope: every gating entry carrying a package recommendation; see captain-rulings-2026-08-20.md). |
| CD-4d | the `execution.idempotencyKey` grammar | STATE THE GRAMMAR NORMATIVELY. GC-10 is re-signed to conform to the uniform grammar rather than carrying a one-case exception no rule justifies. The normative statement must define every segment, its order, and what an absent optional segment means, and a regression test pins the grammar; ruled 2026-08-20 by firstmate under the captain's explicit delegation, captain's words: "Go with your recommendations and keep moving" (see captain-rulings-2026-08-20.md addendum). |
| CD-4e | the GC-15 ledger ordering | RESERVE ONLY AFTER RE-APPROVAL - the signed GC-15 ordering stands unedited. Authority-complete-before-commitment is the compliance-coherent rule, the oracle is preserved per DC-2 rather than re-signed to match the replacement, and the concurrency risk is owned by execution-time revalidation either way; ruled 2026-08-20 by firstmate under the captain's explicit delegation, captain's words: "Go with your recommendations and keep moving" (see captain-rulings-2026-08-20.md addendum). |

## Consequences

- With this ADR Accepted on `main` and its matching `DECISIONS.md` entry landed, the program's
  prompt 1 ratification gate can pass by reading files, and the program may begin. Nothing begins
  before that.
- The `generation-4` branch is created only under R-5's bounds, protected under B-4 as amended by
  X-1, and changed only by pull request thereafter. This ADR changes nothing on `main` beyond its
  own documentation PR, changes no default branch, and performs no cutover; F9 remains untouched.
- The B-6 bootstrap record is appended to this ADR by a follow-up documentation PR immediately after
  the push, and again to `CONSTITUTION.md` in PR-1a, before prompt 2 may begin.
- ADR-0060's temporary charter-rule-1 exception is NOT closed by this ADR. It expires before any
  durable fourth-generation code, schema, migration, or production-path PR may merge; the executable
  enforcement contract that replaces it lands in prompt 1, and the ADR that closes the exception by
  name is prompt 1 deliverable 7's, recorded on `generation-4`.
- Every later prompt's dependency ceiling counts additions after the R-7 baseline; a package not on
  a ratified allowlist requires a new captain ratification before it may appear.
- Under X-1, every program PR is reviewed and merged by the captain alone until the captain rules
  otherwise; companion proofs and proof-log entries remain mandatory so the falsification record
  survives the reduction.

## Revisit When

- **A second collaborator or account exists on the repository.** The X-1 reduction was ruled "for
  now"; the captain may then restore the approving-review requirement and the two-reviewer merge
  authority by a recorded decision. Protection may be strengthened then; it is never weakened or
  switched off mid-program.
- **PR-1d has not merged when PR-1c merges.** The X-2 conditional activates as ruled above.
- **Either dependency allowlist needs any change.** Each addition, removal or version move is a
  re-ratification of the exact string set, recorded against this ADR.
- **Any ruled hold or produced-versus-signed decision is re-opened.** The re-opening is a new captain
  decision superseding the affected row, never an edit to this record.
- **The bootstrap push completes.** The follow-up amendment PR appends the B-6 record; until it
  lands, prompt 2 may not begin.
