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

## v3 phase gate (required — ADR-0023, orchestrator rule 3)

- **Phase/wave:** <!-- Wave 0 / A–I per docs/v3/verin-prompt-sequence-v3.md, or "n/a — governance/docs/tooling only" -->
- **Active v3 invariants served:** <!-- ids from v3-invariants.json (`pnpm v3:invariants`), or "none" -->
- **Demo behavior changed:** <!-- what a demo viewer sees differently, or "none" -->
- **Unresolved architecture contradictions:** <!-- "none", or name each one. A contradiction with docs/v3/verin-architecture-v3.md STOPS work and is raised here — never resolved silently in code (v3 §0.5, orchestrator rule 4). -->

## Charter amendment (only if `CHARTER.md` changed)

- [ ] This PR changes `CHARTER.md`. It references the amending ADR: `docs/adr/____`. (Silent charter edits fail review — charter operating model.)

## v3 index (only if `docs/v3/README.md` changed)

- [ ] This PR changes `docs/v3/README.md`. The change is navigation only - the index originates nothing normative; every rule it states restates a registered document, an ADR, the charter, or a `DECISIONS.md` entry (D-099). That index is not registered in `v3-invariants.json`, so the arch-version fence does not byte-protect it, and a NEW normative statement originates in a registered document, an ADR, the charter, or a `DECISIONS.md` entry instead.

## New `docs/v3/` document (only if a file was ADDED under `docs/v3/`)

- [ ] This PR adds a file under `docs/v3/`. If it is ratified content, it is registered in `v3-invariants.json` with its SHA-256 pin in this same PR; if it is deliberately unregistered navigation, this PR says so and why. The arch-version fence iterates that registry and never reads the directory, so an unregistered document lands byte-unprotected on a green build (D-099).

## AI authorship

- [ ] The AI tool and prompt/task are documented in the commit message(s).

## Verification

<!-- What did you run? typecheck / lint / test / test:e2e / knip / build. Paste the proof-of-life for any flow this PR touches. -->
