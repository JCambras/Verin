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
