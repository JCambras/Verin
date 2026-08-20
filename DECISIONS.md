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
