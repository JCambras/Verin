<!--
Verin change-control gate (SOC 2 CC8.1; charter separation-of-duties).
Protected main, no direct pushes, no self-approval. Every change flows through an
independent gate review (the persona board's fresh-context rule + the no-mistakes
pipeline). Fill this out honestly — a false checkbox is a control failure.
-->

## What & why

<!-- One paragraph. Link the ADR if this is an architectural decision. -->

## Charter compliance (required)

- [ ] **Fence in the same PR (charter #1).** Every invariant this PR states ships with a build-failing fence, proven adversarially (violation injected, failed with `file:line`, reverted, logged in `docs/fences/proof-log.md`).
- [ ] **Detection is not verification (charter #4).** Any new PASS-emitting check has a companion proving incomplete/not-started work cannot pass it.
- [ ] **Nothing built-but-not-shipped (charter #5).** Every capability here is reachable from the UI or a public API in this PR. No dead exports outside the declared vocabulary roots, `contracts/` and `domain/schema/` (D-013) (knip is green).
- [ ] **No unlabeled synthetic data (charter #3).** Any displayed/seeded value carries `source`/`asOf`/provenance and cannot feed a compliance decision.
- [ ] **Reversible decisions logged in `DECISIONS.md`; irreversible/architectural ones went through a `needs-decision`.**

## Charter amendment (only if `CHARTER.md` changed)

- [ ] This PR changes `CHARTER.md`. It references the amending ADR: `docs/adr/____`. (Silent charter edits fail review — charter operating model.)

## AI authorship

- [ ] The AI tool and prompt/task are documented in the commit message(s).

## Verification

<!-- What did you run? typecheck / lint / test / test:e2e / knip / build. Paste the proof-of-life for any flow this PR touches. -->
