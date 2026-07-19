# Fence proof log (adversarial)

Charter non-negotiable #1: "Prove each fence adversarially — inject a violation, show it fail with
`file:line`, revert, commit the proof log." Charter #4: detection is not verification — a fence that has
never been shown to fail on a real violation is unproven.

Each entry: the fence, the invariant, the injected violation, the observed failure (verbatim), and the
revert confirmation. The independent falsification session (Part 2) must be able to re-run each proof from
this repo alone. Re-run any proof with `pnpm test:fitness` after re-injecting the described violation.

---

## PF-001 · charter-drift fence · `src/__tests__/fitness/charter-drift.test.ts`

**Invariant (charter operating model):** CI fails if any `enforced` mapping in `charter-map.json` points
at a fence/gate/procedure that no longer exists or is disabled — the constitution enforces its own
enforcement.

**Injection:** appended an `enforced` operating-model entry whose fitness mechanism referenced a
nonexistent file `src/__tests__/fitness/this-fence-was-deleted.test.ts`.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/charter-drift.test.ts > charter-drift fence > (a) every enforced file/config/fitness mechanism exists on disk
AssertionError: enforced mappings point at missing mechanisms:
INJECTED-DRIFT -> fitness:src/__tests__/fitness/this-fence-was-deleted.test.ts
 ❯ src/__tests__/fitness/charter-drift.test.ts:64:94
```

**Revert:** restored `charter-map.json`; `pnpm test:fitness` → `Tests 5 passed (5)`.

**Date:** 2026-07-18 (Phase 0).

---

<!-- Phase B appends PF-002.. here: dependency-rule, no-process-env, audited-write-required (+ anti-fork),
     line-budget, no-bare-throw, org-id-required, no-client-role-header, no-secret-fallback,
     no-unlabeled-synthetic, provenance-required, and each detection-is-not-verification companion. -->
