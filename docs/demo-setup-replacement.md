# Setup-first demo replacement scope

This delivery is the one bounded fake-scope exception authorized by the setup
addendum. It replaces the old policy-authoring, query activation, and overlapping
comparison behavior with one setup-to-run journey. It does not claim a real policy
lifecycle, evaluator, ledger, or Salesforce adapter.

## Reproducible scope measurements

The delivery-parent baseline is commit
`04184843e276cf1b0990203c4e869a2231e71ab4`. Counts below are tracked TypeScript
and TSX physical lines from `wc -l`. Generated files, dependencies, screenshots,
and test output are excluded. `DevProvenanceBadge` is the exact count of JSX call
sites under `src/app/demo` and `src/app/app/demo`.

The earlier synthesis audit separately recorded 2,527 demo-app code lines at
commit `2ef71b3`. Its lexical code-line count and this physical-line count are
different measures, so they are not presented as one time series.

| Scope | Delivery parent | After replacement | Change |
|---|---:|---:|---:|
| Runtime, `src` excluding `src/__tests__` | 11,304 | 12,612 | +1,308 |
| Tests, `src/__tests__` plus `e2e` | 10,257 | 11,063 | +806 |
| Fake runtime, `src/app/demo` | 2,824 | 4,156 | +1,332 |
| Setup presentation only | 0 | 1,182 | +1,182 |
| Total presentation scope | 2,306 | 3,265 | +959 |
| Contracts | 3,394 | 3,394 | 0 |
| Domain | 714 | 748 | +34 |
| Infrastructure | 2,210 | 2,212 | +2 |
| `DevProvenanceBadge` call sites | 14 | 16 | +2 |

Setup presentation means `src/app/demo/surfaces/setup*.tsx` plus
`src/app/app/demo/setup/page.tsx`. Total presentation is shared presentation,
demo surfaces, and demo route entries. The line-budget fence now measures that
full scope, correcting the prior route and demo-surface omission without raising
the 6,000-line ceiling.

## Exact replacement and deletion map

| Removed or replaced behavior | Exact deletion or replacement |
|---|---|
| Free-form policy authoring surface | Deleted `src/app/demo/surfaces/policy-authoring.tsx`. |
| Desktop comparison surface | Deleted `src/app/demo/surfaces/comparison.tsx`. |
| Comparison-only shared primitive | Deleted unused `src/app/presentation/comparison-columns.tsx`. The replacement uses semantic firm cards and no desktop table abstraction. |
| Query-string activation | Removed `approved` parsing and the `approved=1` render branch from `src/app/app/demo/[station]/page.tsx`. Both legacy routes now redirect to `/app/demo/setup`; query parameters cannot activate local state. |
| Policy-authoring fake service | Deleted `buildPolicyAuthoring` from `src/app/demo/build-summary.ts`, its journey field, and its view-model types. |
| Overlapping comparison fake service | Deleted `buildComparison` from `src/app/demo/build-summary.ts`, its journey field, and its view-model types. |
| Redundant reserve arithmetic | Removed the twelve-month multiplication from the old authoring builder and app-local multiplication from `build-decision.ts`. Reserve projection now has one domain function, `src/domain/money-movement/reserve-projection.ts`. |
| Stale monthly schedule | Replaced the old $6,000 demo value with the captain-signed $8,000 schedule. The $48,000 and $96,000 floors are derived, not stored. |
| Legacy journey links | Launcher, home card, verification forward link, and record back link now enter the setup-first journey. |
| Legacy behavior proof | Playwright proves both old route aliases redirect and that `approved=1` cannot create an activated setup. |

The replacement itself is:

- `src/app/demo/build-setup.ts` for labeled presentation-ready fake view models
- `src/app/demo/setup-model.ts` for typed render-only view models
- `src/app/demo/surfaces/setup*.tsx` for the nine setup-to-proof steps
- `src/domain/money-movement/reserve-projection.ts` for reserve arithmetic
- `src/__tests__/fitness/demo-semantic-truth.test.ts` for signed-case equality

No disposition, lifecycle transition, stop condition, or external next-action
rule is evaluated by a surface. Surfaces select prebuilt closed-choice effects
and render typed view models only.

## Deletion map when real slices land

| Real capability | Fake removed in the same delivery |
|---|---|
| Closed policy AST, signed-case simulator, review, activation, version pinning, and supersession | Delete `build-setup.ts` policy choice and impact builders, client-local activation state, demonstration profile identities, and their setup badges. Replace the setup view model with a projection from the real lifecycle. |
| Deterministic evaluator and explanation trace | Delete the pre-authored Smiths effects and outcome comparison from the setup builder. Render evaluator and ledger projections while preserving the current firm-labeled card structure. |
| Authority runtime and pre-execution safety | Delete the pre-authored authority reachability and proof text. Render real stages, invalidation, revalidation, reservation, and conflict receipts. |
| Execution and verification ports | Delete the fake submitted receipt and no-call proof text. Render port-conformance-backed status and remove the matching fake-adapter badges only when the real capability is reachable. |
| Ledger-derived examiner export | Replace the current setup export target and legacy fake record builder with the ledger projection, then delete the remaining setup proof builder and demonstration export badge. |

## Browser evidence

`e2e/demo-setup-responsive.spec.ts` captures every primary step at 390 by 844,
768 by 1024, 1024 by 900, and 1440 by 1100 CSS pixels. That is 36 blocking
screenshots uploaded by the existing `demo-screens` CI artifact. At each step it
checks page overflow, axe, 44 by 44 action targets, input label targets, and
safe-area clearance. The input-label check is scoped by test id and each step
declares whether it renders choice inputs, so a selector that matches nothing
fails instead of passing vacuously (charter #4; proof log PF-setup-05).
Companion paths prove question to Firm A to Firm B phone
order, no comparison table or carousel, keyboard-only completion, announced
activation errors, 200 percent text, reduced motion, and the absence of
software-keyboard-triggering free-text controls.
