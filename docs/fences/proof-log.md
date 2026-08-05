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

## Two kinds of proof

1. **Continuous (in-CI) companion.** Every fence ships a co-located `describe("detects …")` companion that
   feeds it a synthetic violation and asserts it is caught — so a green fence can never be vacuous. These run
   on every CI build. The `detection-not-verification` meta-fence fails the build if any fence lacks one.
2. **One-time real-tree injection (below).** For the charter's literal "inject a violation, show it fail with
   `file:line`, revert" requirement, each fence was also exercised against a real file. Re-run any proof by
   recreating the described file and running `pnpm exec vitest run src/__tests__/fitness/<fence>`.

---

## PF-002 · dependency-rule · `src/__tests__/fitness/dependency-rule.test.ts`
**Invariant (ADR-0001):** inner layers never import outer. **Injection:** created `src/domain/_adv.ts` with
`import { x } from "@infra/store";`. **Observed:** `dependency-rule violations: src/domain/_adv.ts: domain
-> infrastructure (@infra/store)`. **Revert:** deleted the file; suite green. Also proven for relative,
dynamic `import()`, and `require()` seams by the in-memory companions.

**Extension (review finding F16):** configured alias suffixes are normalized before layer or external
package classification. Test-first companions reproduced both bypasses against the prior classifier:
```
× alias traversal from contracts into infrastructure is normalized before classification
  expected [] to include 'contracts->infrastructure'
× alias traversal cannot disguise an external package as a contracts import
  expected [] to have a length of 1 but got 0
```
The shared path classifier now accepts only paths inside the repository source root or the explicit
in-memory source root. A third companion proves that an external package containing its own
`src/contracts` directory cannot be mistaken for this repository's contracts layer.

Real-tree injections then proved both requested forms independently:
```
# src/contracts/_adv_alias_traversal.ts
import "@contracts/../infrastructure/store";

dependency-rule violations:
src/contracts/_adv_alias_traversal.ts: contracts -> infrastructure
(@contracts/../infrastructure/store)

# src/contracts/_adv_alias_traversal.ts
import "@contracts/../../node_modules/react/index.js";

contracts external-import violations:
src/contracts/_adv_alias_traversal.ts:1
(@contracts/../../node_modules/react/index.js)
```
**Revert (extension):** deleted the injected file; the focused dependency fence passed all 15 tests.

**Extension (review findings F17-F18):** the shared detector now fails closed on non-literal dynamic
`import()` and `require()` references in inner layers, and it no longer exempts nested `__tests__`
directories that the shipped-source discovery includes. Before the implementation changed, four focused
companions reproduced the bypasses:
```
× non-literal dynamic import() fails closed in an inner layer
× non-literal require() fails closed in an inner layer
× nested __tests__ paths remain subject to layer enforcement
× nested __tests__ paths remain subject to the contracts external allowlist
```
Real-tree injections then proved all four forms after the fix:
```
dependency-rule violations:
src/domain/_adv_unresolved_dynamic.ts:4: domain -> unresolved (<non-literal dynamic-import>)
src/domain/_adv_unresolved_dynamic.ts:5: domain -> unresolved (<non-literal require>)
src/contracts/__tests__/_adv_nested_test.ts:2: contracts -> infrastructure (@infra/store/db)

contracts external-import violations:
src/contracts/__tests__/_adv_nested_test.ts:1 (react)
```
**Revert (extension):** deleted both injected files; the focused dependency fence passed all 19 tests.

**Date:** 2026-07-27 (review hardening of the prompt-5 contracts dependency fence, D-043/D-044).

**Extension (review finding F21):** the shared reference collector now includes TypeScript
triple-slash `types` and `path` directives. Test-first companions reproduced both omissions against
the prior collector:
```
× triple-slash type references cannot evade the contracts allowlist
  expected [] to have a length of 1 but got 0
× triple-slash path references cannot cross project layers
  expected [] to include 'contracts->infrastructure'
```
Real-tree injections then proved both forms independently:
```
# src/contracts/_adv_triple_slash.ts
/// <reference path="../infrastructure/store/db.ts" />

dependency-rule violations:
src/contracts/_adv_triple_slash.ts:2: contracts -> infrastructure
(../infrastructure/store/db.ts)

# src/contracts/_adv_triple_slash.ts
/// <reference types="react" />

contracts external-import violations:
src/contracts/_adv_triple_slash.ts:1 (react)
```
**Revert (extension):** deleted the injected file; the focused dependency fence passed all 21 tests.

**Date:** 2026-07-27 (review hardening of the prompt-5 contracts dependency fence, D-045).

## PF-003 · no-process-env · `src/__tests__/fitness/no-process-env.test.ts`
**Invariant (ADR-0003):** `process.env` only in `infrastructure/config`. **Injection:** `src/domain/_adv_env.ts`
with `export const k = process.env.SECRET_TOKEN;`. **Observed:** `process.env read outside config:
src/domain/_adv_env.ts:1`. **Revert:** deleted; green.

## PF-004 · no-bare-throw · `src/__tests__/fitness/no-bare-throw.test.ts`
**Invariant (ADR-0002):** no `throw new Error()` in domain/infrastructure. **Injection:**
`src/infrastructure/crm/_adv.ts` with `throw new Error("boom")`. **Observed:** `bare throws:
src/infrastructure/crm/_adv.ts:1`. **Revert:** deleted; green.

## PF-005 · no-console · `src/__tests__/fitness/no-console.test.ts`
**Invariant (ADR-0013):** no raw `console.*` in domain/infrastructure (only the pino logger scrubs PII).
**Injection:** `src/domain/_adv_console.ts` with `console.log("leak")`. **Observed:** `raw console.*:
src/domain/_adv_console.ts:1`. **Revert:** deleted; green.

## PF-006 · config-hygiene (no-secret-fallback / no-live-org-domain / placeholder .env) · `no-secret-fallback.test.ts`
**Invariant (ADR-0003/0017, charter #7):** no secret fallbacks, no live org domains, placeholder-only
`.env.example`. **Injection:** `docs/_adv.md` containing a live Salesforce org domain of the form
`https://<org>.my.salesforce[.]com` (bracket added HERE only so this proof log does not itself trip the
fence — the injected file used the real dotted form). **Observed:** `live org domains: docs/_adv.md:2`.
**Revert:** deleted; green. (Secret-fallback and non-placeholder-env
seams proven by the co-located companions.)

## PF-META · detection-is-not-verification meta-fence · `detection-not-verification.test.ts`
**Invariant (charter #4):** every fence ships a companion. **Injection (companion, in-CI):** synthetic fence
text `describe("some fence" …)` with no `detects` block → `hasInlineCompanion === false`. The meta-fence
flags any real fence file missing a companion. Self-referential; carries `@companion:proof-log`.

---

## PF-007 · provenance-required · `src/__tests__/fitness/provenance-required.test.ts`
**Invariant (ADR-0005, charter #2):** every modeled entity field has a provenance annotation in the data
dictionary; no drift either way. **Injection:** added `readonly secretUnlabeled: string;` to the
`Household` interface in `entities.ts` (no dictionary entry). **Observed:** `Household.secretUnlabeled: no
provenance annotation in the data dictionary`. **Revert:** removed the field; green (61 tests).

## PF-008 · no-unlabeled-synthetic · `src/__tests__/fitness/no-unlabeled-synthetic.test.ts`
**Invariant (ADR-0005, charter #3):** a synthetic-sourced field may not feed a compliance decision.
**Injection:** changed the `MONEY` provenance preset's `defaultSource` to `"estimate"` while keeping
`canFeedCompliance: true`. **Observed:** `FinancialAccount.balanceMinorUnits: synthetic source 'estimate'
must not feed a compliance decision`. **Revert:** restored `defaultSource: "verin-crm"`; green.

> Note: PF-007/008 were injected on then-untracked files; `git checkout` cannot revert untracked files, so
> the reverts were applied manually and re-verified green. Future proofs inject on committed code.

## PF-009..PF-016 · Phase-E capability fences (shipped WITH the skeleton, charter #1)

Each ships a co-located `describe("detects …")` companion (continuous in-CI adversarial proof) AND was
injected into the real tree once (revert clean). Notably, several caught real over-strictness/false-positives
in the fences THEMSELVES before shipping — the "detection is not verification" discipline applied to my own
fences:

- **PF-009 org-id-required** — a `SELECT/UPDATE/DELETE` on a tenant data table without `org_id` is caught
  (STRIDE T-I2). The companion also proved the fence must NOT false-positive on capability-keyed lookups
  (esign_token) — which it initially did, and was fixed.
- **PF-010 no-client-role-header** — reading `x-user-role` (or any role/identity header) from the request is
  caught (STRIDE T-S1).
- **PF-011 audited-write-required (+ anti-fork)** — a direct `db.query` mutation in a CRM adapter, or an
  `enqueueAudit` call outside the helper, is caught (retro don't-again #37). The anti-fork check initially
  mis-rejected the real (generic) `auditedWrite<T>(` call — fixed.
- **PF-012 auth-enforcement** — an API route handler with no `resolveSession`/`requirePrincipal` (and not in
  the documented unauthenticated allowlist) is caught (charter #12).
- **PF-013 idempotency-exactly-once** — a replayed idempotency key writes exactly once; a DIFFERENT key
  re-performs (so the test is not vacuously "always once") — charter #16.
- **PF-014 flowstep-suspend-resume** — the engine suspends at a suspend step (step C does NOT run) and runs
  the rest only on resume; a no-suspend flow completes without suspending (proves it is not an
  execute-to-completion stub) — charter #6.
- **PF-015 observability-coverage** — the account-opening flow emits `flow.*` and external-call spans;
  `withSpan` records success and failure to the ring — charter #14.
- **PF-016 no-pii-in-audit-store** — contact email/phone entered into the house CRM is scrubbed out of the
  audit before/after blobs; the companion proves `scrub` actually redacts (not vacuous) — STRIDE T-I1.
  The value backstop also catches E.164-format phones (`+12125550142`), companion-proven; a bare 10-digit
  id without phone context is not a false positive.

The tamper-evident audit chain, exactly-once webhook replay, append-only trigger, and authz denial are ALSO
proven end-to-end in `src/__tests__/integration/*` and the Playwright specs (`e2e/walkthrough.spec.ts`,
`e2e/access-control.spec.ts`).

## PF-017 · bounded-request-body · `src/__tests__/fitness/bounded-request-body.test.ts`

**Invariant (STRIDE T-D1 / Sable F2):** no route reads the body with a raw `req.json()` (use the bounded
`readJsonBody`). Companion: a synthetic `await req.json()` is flagged; `readJsonBody(req)` passes.

## Self-audit hardening (Phase G) — fences that were found VACUOUS and fixed

The fresh-context self-audit (`docs/reviews/`) caught two false-passes in the fences themselves — the
charter's exact "detection is not verification" failure, applied to my own work:
- **`no-pii-in-audit-store`** passed while client NAMES sat raw in the audit store (it only checked
  email/phone and never scanned `detail`). Fixed: PII detection extended to names, `detail` scanned, a
  fail-closed `assertNoPIIValues` backstop wired, and the fence now asserts distinctive names are absent
  from before/after AND detail (Vale V2/V3, Sable F1).
- **`org-id-required`** passed a genuine cross-tenant read with `org_id` in the SELECT projection. Fixed to
  require `org_id` as a `WHERE` predicate; companion added for the evasion (Vale V4).

Both fixes are re-verified green and their companions now reject the previously-passing violation.

## Independent-review hardening (post-Phase G) — fence gaps closed

An independent gate review of the foundation branch found four more weak/vacuous spots in the
enforcement layer itself; each is fixed with a companion that rejects the previously-passing evasion:

- **`org-id-required` scan escapes (3):** the fence only scanned string literals passed DIRECTLY to
  `.query(…)`, only under `src/infrastructure/`, and its `DATA_TABLES` omitted the org-scoped `users`,
  `credentials`, and `audit_log`. It now sweeps EVERY string/template literal (AST) in EVERY shipped
  src file — SQL held in a variable or issued from an app route handler is caught — with the three
  tables added, statement-shaped matching (so trigger DDL like `BEFORE UPDATE ON audit_log` is not a
  false positive), and three justification-carrying reviewed escapes (session-id capability lookup,
  the deferred org-qualified login, org-column-less `credentials`). Reviewed escapes are exact-match
  against the whole normalized statement, so a superset of an escaped query (e.g. the login SQL grown an
  `OR role = $2` arm) is still flagged, companion-proven. **Adversarial proof (executed):**
  planted `const evilSql = "SELECT actor, detail FROM audit_log ORDER BY sequence"; await db.query(evilSql);`
  in `src/app/ready/route.ts` → fence failed naming `src/app/ready/route.ts` and the SQL; reverted; green.
- **`stripComments` string-blindness:** every content-scan fence (no-process-env, no-console,
  no-bare-throw, no-client-role-header, no-secret-fallback) truncated lines at the first `//` even
  inside string literals, so `const u = "http://x"; const k = process.env.SECRET;` passed. Now
  string-aware; companion in `no-process-env.test.ts` proves the evasion is caught.
- **`audited-write-required` stale target list:** the fence looped over two hardcoded adapter paths and
  never asserted they exist — renaming an adapter made the loop body never run (vacuous pass). It now
  sweeps `src/infrastructure/crm/` and FAILS if the directory yields zero adapters.
- **`audit-chain-verify` gate was vacuous:** the seed wrote no audit entries, so the blocking CI gate
  verified one 0-entry chain and printed OK. The seed now writes ONE idempotent audited entry
  (`org.seed`), and the script exits non-zero when it finds no orgs OR verifies zero entries.
  **Executed proof:** unseeded store → exit 1 ("no orgs found"); seeded → OK (1 entries); re-seed →
  still exactly 1 entry (idempotency-key replay). `verifyOrgChain` also now returns BROKEN when
  entries exist without an anchor row (anchor-removal cover-up), covered in the integration suite.

---

## Companion-proven fences (no real-tree injection entry)

`line-budget` and `max-file-size` carry no PF entry: a real-tree injection would mean committing
hundreds of filler lines to breach a ceiling. Their proof is the co-located
`describe("detects (companion)")` blocks, which feed the same check functions synthetic over-budget
totals / over-ceiling files and assert they fail (charter #4); FOUNDATION.md §2 records "companions"
as their proof in the fence table.

---

## Review-round fence hardening (2026-07-19) — executed injection proofs

Each hardened fence was proven against the exact evasion the review named (inject → fence fails naming
the file → revert → green):

- **`auth-enforcement` per-handler + Server Actions:** planted an unauthenticated
  `export async function DELETE` in `src/app/api/audit/route.ts` (whose POST-equivalent GET IS
  authenticated — the old per-file check passed this) → fence failed naming
  `src/app/api/audit/route.ts :: DELETE`; reverted; green. Server-Action coverage and the
  comment-cannot-satisfy property are companion-proven (AST call detection).
- **`charter-drift` ratchet + ci.yml scoping + self-scan:** flipped charter-map id 12 from `enforced`
  to `planned` → the new ratchet check (e) failed with `12: status flipped to 'planned'`; reverted;
  green. The ci-gate presence check now reads ONLY the blocking `ci.yml`, and the disabled-fence scan
  includes `charter-drift.test.ts` itself (matchers assembled at runtime so the patterns cannot
  self-trigger).
- **`bounded-request-body` string-aware + all body readers:** planted
  `const u = "http://example.com"; const evil = await req.json();` in a route (the `//` inside the URL
  literal truncated the old regex's line) → fence failed naming `src/app/api/audit/route.ts`;
  reverted; green. `req.text()/formData()/arrayBuffer()/blob()` coverage is companion-proven.
- **`org-id-required` derived table classification:** added `CREATE TABLE IF NOT EXISTS client_notes`
  to `migrations.ts` with no classification → the new derivation check failed naming `client_notes`;
  reverted; green. `provenance-required` gained the mirror-image check (every exported interface in
  `entities.ts` must be in ENTITY_NAMES), companion-proven.
- **`line-budget` de-tautologized:** the companion now routes synthetic over-budget AND empty-bucket
  measurements through the REAL `budgetViolations` check (the old companion asserted
  `N + 1 <= N === false`, an arithmetic tautology touching nothing).
- **`detection-not-verification` anti-hollow:** the companion requirement is now AST — a
  `describe("detects…")` block must contain at least one live (non-skipped, non-commented) test case;
  empty-stub, commented-out, and skipped-only companions are companion-proven rejected.
- **PII scrub non-string fix (the round's ERROR):** `scrub` now propagates `keyIsPII` through arrays
  and objects and redacts non-string primitives under PII keys; `assertNoPIIValues` throws on any
  unredacted primitive under a PII-named key and pattern-checks numbers. Proven in the
  `no-pii-in-audit-store` companions ({ phone: 5551234567 }, { name: { first: "John" } },
  { phones: [...] } all redacted; the backstop throws when fed the unscrubbed shapes).
- **`license-audit` SPDX parser:** recursive-descent with parens + AND-over-OR precedence, fail-closed
  on unparseable expressions. Executed check: `(MIT OR GPL-2.0-only) AND OpenSSL` → DENIED,
  `(GPL-2.0-only OR MIT) AND (Apache-2.0 OR ISC)` → allowed, unbalanced parens → DENIED; all 598
  installed deps still pass.

---

## Review-round 3 fence hardening (2026-07-19) — executed injection proofs

- **`auth-enforcement` identifier initializers + re-exports + function-level `"use server"`:** the
  hardened per-handler fence skipped any exported variable whose initializer was not a literal
  arrow/function expression (`export const POST = impl` passed silently), never walked
  ExportDeclarations (`export { POST } from "./impl"` / `export { impl as GET }`), and detected only
  file-level directives. It now follows initializer chains (parens/as/satisfies/local identifiers) to
  the handler body, checks re-exports against the target module (per-handler when analyzable),
  detects function-level `"use server"` directives in any app file, and FAILS CLOSED on unanalyzable
  bodies (resolver required in the enclosing/target module), unresolvable re-exports, and wildcard
  re-exports in route files. **Executed proof:** planted three real-tree evasions in one run — an
  identifier-initializer route (`src/app/api/proof-inject/route.ts :: POST`), a cross-module
  re-export (`src/app/api/proof-reexport/route.ts :: DELETE`), and a function-level use-server action
  (`src/app/proof-inject-action.ts :: wipeAll`) — the fence failed naming all three; reverted; green.
  Each evasion (plus imported-identifier, local-alias, unresolvable and wildcard re-exports) is also
  companion-proven in `describe("detects (companion)")`.

---

## Wave-1 prerequisite fences (2026-07-19) — executed injection proofs

### PF-018 · metric-provenance · `src/__tests__/fitness/metric-provenance.test.ts`
**Invariant (charter #3 / ADR-0022; closes Vale V12):** every metric-class value renders with provenance —
the sanctioned renderers (`<Metric>`, `<FreshValue>`) keep their provenance prop REQUIRED (RULE A), and no
metric-class field (derived from the dictionary `display:"metric"` flag) appears in a JSX expression, in
child position or in an attribute/spread of anything but a sanctioned renderer (RULE B).

**RULE B injection:** created `src/app/app/_adv-metric/page.tsx` rendering `<span>{account.balanceMinorUnits}</span>`.
**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/metric-provenance.test.ts > metric-provenance fence > RULE B: no metric field is rendered in JSX without provenance
AssertionError: naked metric renders (charter #3 / Vale V12):
src/app/app/_adv-metric/page.tsx:3 :: metric field 'balanceMinorUnits' rendered without provenance (route it through <Metric>/<FreshValue>)
```
**Revert:** deleted the file; `pnpm exec vitest run …/metric-provenance.test.ts` → `Tests 12 passed`.

**RULE A injection:** made `FreshValue`'s `provenance` prop optional (`provenance?: RecordProvenance`).
**Observed failure (verbatim):**
```
FAIL … > RULE A: every sanctioned metric renderer keeps its provenance prop REQUIRED
AssertionError: renderer contract broken:
FreshValue: 'provenance' prop is OPTIONAL — a metric could render without provenance
```
**Revert:** restored the required prop; suite green. Naked member-access, destructured, one-hop-alias, and
attribute-passing cases are all companion-proven in `describe("detects (companion)")`.

**RULE B attribute-forwarding injection (strengthening, same PR):** RULE B originally exempted ALL JSX
attribute positions, so a metric field forwarded as a prop to a non-sanctioned component (or shown via
`title={…}` on a plain element) escaped the fence. Tightened: attributes are exempt only when the enclosing
element is `<Metric>`/`<FreshValue>`. Injected `src/app/app/_adv-metric/page.tsx` rendering
`<Cell v={account.balanceMinorUnits} />`.
**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/metric-provenance.test.ts > metric-provenance fence > RULE B: no metric field is rendered in JSX without provenance
AssertionError: naked metric renders (charter #3 / Vale V12):
src/app/app/_adv-metric/page.tsx:6 :: metric field 'balanceMinorUnits' rendered without provenance (route it through <Metric>/<FreshValue>)
```
**Revert:** deleted the file; suite green (`Tests 15 passed`). Non-sanctioned-component attribute,
plain-element `title={…}`, and sanctioned `<Metric>`/`<FreshValue>` attribute cases are all
companion-proven.

**RULE B spread-attribute injection (strengthening, same PR):** a JSX spread attribute contains NO
`JsxExpression` node (verified with a ts-morph probe), so the JsxExpression-only scan never saw spreads
at all - the `{...spread}` exemption branch was dead code and a metric field spread onto ANY element
escaped the fence while the comment claimed otherwise. Fixed: `JsxSpreadAttribute` nodes are scanned
directly, exempt only on `<Metric>`/`<FreshValue>`. Injected `src/app/app/_adv-metric/page.tsx` rendering
`const props = { v: account.balanceMinorUnits }; return <Cell {...props} />;`.
**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/metric-provenance.test.ts > metric-provenance fence > RULE B: no metric field is rendered in JSX without provenance
AssertionError: naked metric renders (charter #3 / Vale V12):
src/app/app/_adv-metric/page.tsx:4 :: metric field 'balanceMinorUnits' rendered without provenance (route it through <Metric>/<FreshValue>)
```
**Revert:** deleted the file; suite green (`Tests 18 passed`). Inline-object spread, aliased-props-object
spread, and sanctioned `<Metric {...props}/>` cases are companion-proven.

**Date:** 2026-07-19 (Wave-1 prereq; RULE B strengthened same PR, review rounds 2 and 3).

### PF-019 · derived-provenance · `src/__tests__/fitness/derived-provenance.test.ts`
**Invariant (charter #3 EXTENSION / ADR-0022):** a value derived from any synthetic input, at any depth
(the demonstration flag is TRANSITIVE through chained derivations), is itself a demonstration and can never
feed a compliance decision (`deriveArtifactProvenance` + `canFeedComplianceDecision`).

**Injection:** weakened `canFeedComplianceDecision` back to `return !isSyntheticSource(p.source);` (dropping
`&& !isDemonstration(p)`), so a demonstration artifact derived from synthetic input would be allowed to feed
compliance.
**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/derived-provenance.test.ts > … > enforces: the derivation law holds for the real contract functions
AssertionError: derivation-law violations:
a demonstration derived from 'estimate' must NOT feed a compliance decision
a demonstration derived from 'default' must NOT feed a compliance decision
a demonstration derived from 'fixture' must NOT feed a compliance decision
```
**Revert:** restored the `&& !isDemonstration(p)` clause; suite green. A broken derivation (never marks
synthetic-derived artifacts as demonstrations) and a `canFeed` that ignores `demonstration` are both
companion-proven rejected.

**Transitivity injection (strengthening, same PR):** the derivation originally checked only leaf
`isSyntheticSource(i.source)`, so deriving over a demonstration-derived input (source `computed`,
`demonstration: true`) laundered synthetic data into a compliance-eligible value in two hops. Fixed
(`isSyntheticSource(i.source) || isDemonstration(i)`; `derivedFrom` flattened through nested derivations to
leaf sources) and the law gained a CHAINED clause built from a literal demonstration input. Injected:
reverted the derivation to the leaf-only check.
**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/derived-provenance.test.ts > … > enforces: the derivation law holds for the real contract functions
AssertionError: derivation-law violations:
deriving over a demonstration-derived input must yield a demonstration (transitivity)
a chained demonstration derivation must NOT feed a compliance decision
```
**Revert:** restored the transitive check; suite green (`Tests 7 passed`). A derivation that handles leaf
synthetics but ignores demonstration inputs (chained laundering) is companion-proven rejected.

**Date:** 2026-07-19 (Wave-1 prereq; transitivity strengthened same PR, review round 2).

### PF-020 · no-console (extended to the app layer) · `src/__tests__/fitness/no-console.test.ts`
**Invariant (ADR-0013 / charter #14, deep-review #12):** raw `console.*` is banned in ALL shipped
server-side code — domain, infrastructure, AND `src/app/` (route handlers, server actions, server
components handle raw PII like login email/password; only the pino logger scrubs). Files whose FIRST
statement is a `"use client"` directive are exempt (browser console — a different, lower-stakes
surface); a directive buried after real code does NOT exempt.

**Injection:** planted `console.log("PII leak:", req.headers);` in the app-layer route handler
`src/app/api/audit/route.ts` (previously OUTSIDE the fence's sweep — the exact gap #12 named).
**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/no-console.test.ts > no-console fence > enforces: no raw console.* in server-side code (domain/infrastructure/app)
AssertionError: raw console.* (use the pino logger):
src/app/api/audit/route.ts:24: expected [ 'src/app/api/audit/route.ts:24' ] to deeply equal []
```
**Revert:** removed the planted line; suite green (`Tests 8 passed`). Companions prove the fence catches
a server route handler AND a directive-less server component, allows a leading `"use client"` file,
and refuses a buried directive; the reviewed-allowlist carries a staleness guard (an entry pointing at
a missing file fails).

**Accepted gap (recorded):** the `"use client"` exemption is broader than the invariant strictly
needs — client components ALSO execute server-side during SSR/prerender, so a `console.*` in module
scope or the render body still writes to server stdout; the browser-console rationale fully holds only
for event handlers/effects (which never run on the server). A stricter handlers-only variant was
considered and deliberately not implemented (practical trade-off; the fence text carries the same note).

**Date:** 2026-07-19 (deep-review r6 quality sweep, finding #12).

### PF-021 · store schema hardening (timestamptz + FKs) · `src/__tests__/integration/store-schema.test.ts`
**Invariant (ADR-0004, D-016, deep-review #6):** the store's DDL constraints ARE the fence here (real
Postgres, not a fitness test): every temporal column is `timestamptz` so ordering / `claimed_at < $2`
compare by INSTANT (not lexicographically on whatever offset a writer emitted), reads normalize back to a
canonical UTC ISO-8601 string, and the `contacts.household_id` / `financial_accounts.household_id` /
`sessions.org_id` foreign keys reject orphaned rows. The integration test is each constraint's companion.

**Injection + observed failure (verbatim), each reverted:**
```
# open_date timestamptz -> text:
  × orders by the true instant even when the offset makes the wall-clock string misleading
  × reads normalize any written offset back to a canonical UTC ISO-8601 string     (Tests 2 failed)
# audit_outbox.claimed_at timestamptz -> text (the cited foot-gun, audit-store.ts:97):
  × the audit_outbox reclaim predicate (`claimed_at < $2`, audit-store.ts) compares by instant, not string
# contacts.household_id REFERENCES households(id) removed:
  × contacts.household_id must reference an existing household   (orphan insert silently succeeded)
# sessions.org_id REFERENCES orgs(id) removed:
  × sessions.org_id must reference an existing org
```
**Revert:** restored the DDL; `pnpm test` → `Tests 212 passed` (store-schema file: `Tests 10 passed`).
Each test asserts BOTH halves (the violation is rejected AND the valid row is accepted), so it cannot pass
by always-throwing. The `financial_accounts.household_id` FK is the same REFERENCES mechanism as the
`contacts` one, proven by the same test shape.

**Date:** 2026-07-19 (deep-review r6, finding #6 - schema hardening + D-016 versioned migrations executed).

### PF-022 · session lifecycle (sliding renewal + rotation + cleanup) · `src/__tests__/integration/session-lifecycle.test.ts`
**Invariant (ADR-0008, charter #12, deep-review r6 #8):** the identity chokepoint slides an active
session forward past its half-life (extends `expires_at`), rotates to a NEW session id on each renewal
(anti-fixation, the charter's "rotation" word), and opportunistically deletes long-dead rows - all inside
the single identity read, so the auth fences hold. The real-PGlite integration test is each half's
companion (every case asserts BOTH the positive behavior AND the guard, so it cannot pass by
always-throwing or always-passing).

**Injection + observed failure (verbatim), each reverted:**
```
# rotation removed - renewSession extends expiry but keeps the same id
#   (identity-store.ts: `SET id = $2, expires_at = $3` -> `SET expires_at = $2`, return old id):
  × rotates to a NEW id and extends expires_at in one update; the old id is gone
    AssertionError: expected 's-aging' not to be 's-aging' // Object.is equality
    ❯ src/__tests__/integration/session-lifecycle.test.ts:66
# cleanup neutered - deleteDeadSessions matches nothing
#   (identity-store.ts: `WHERE expires_at < $1 OR (...)` -> `WHERE expires_at < $1 AND FALSE`):
  × deletes rows expired or revoked before the cutoff, sparing live and recently-dead ones
    AssertionError: expected +0 to be 2 // Object.is equality
    ❯ src/__tests__/integration/session-lifecycle.test.ts:103
```
**Revert:** restored both queries; `pnpm test` → `Tests 222 passed` (session-lifecycle file: `10 passed`),
`pnpm test:fitness` → `153 passed`, `pnpm test:e2e` → `12 passed`. Additionally verified end-to-end over
real HTTP (production server, `SESSION_TTL_MINUTES=2`): after crossing the 60s half-life a `GET /api/me`
returned a rotated session cookie (`6a74c374…` → `cdb306d0…`) and the session stayed authenticated past
its original 2-minute hard expiry - proving `cookies().set()` in a Route Handler attaches the renewed
cookie and sliding renewal beats the fixed expiry.

**Date:** 2026-07-20 (deep-review r6, finding #8 - session lifecycle hardened; charter-#12 rotation gap closed).

### PF-023 · arch-version fence (ratified v3 documents SHA-256-pinned) · `src/__tests__/fitness/arch-version.test.ts`
**Invariant (ADR-0023; v3 prompt 4 "architecture checksum"):** every ratified document under `docs/v3/`
must match its SHA-256 pin in `v3-invariants.json`, so build work cannot silently target a stale or
edited copy of the architecture. The inline `detects` companion additionally proves drift, missing-file,
and single-flipped-byte cases against the pure `verifyDocumentPins` core (and that a matching document
passes, so the fence cannot pass by always-failing).

**Injection + observed failure (verbatim), reverted:**
```
# appended "<!-- adversarial drift -->" to docs/v3/verin-architecture-v3.md:
  × enforces: every ratified v3 document matches its SHA-256 pin
    AssertionError: ratified v3 documents drifted from their pins:
    docs/v3/verin-architecture-v3.md: content drifted from its ratified pin.
      pinned:  dc4bf69bcc7582c045d0fa876205788252ca73f034063ea98253127489ce4f6b
      actual:  144574e0c7f1c64813d112b140b560ecf9debc1d0c04f260265df6f012e9f0e1
    ❯ src/__tests__/fitness/arch-version.test.ts:67
# the runner blocks on the same drift (defense in depth):
  v3-invariants: registry/pin problems:
    - docs/v3/verin-architecture-v3.md: drifted from its ratified pin (pinned dc4bf69bcc75…, actual
      144574e0c7f1…) - update the pin in the same PR and review the invariants (ADR-0023)   [exit 1]
```
**Revert:** restored the document from the ratified source (`cmp` byte-identical); fence file
`Tests 6 passed`.

**Date:** 2026-07-26 (v3 ratification "prompt 0", ADR-0023).

### PF-024 · v3-invariant registry fence + three-state runner · `src/__tests__/fitness/v3-invariants.test.ts`, `scripts/v3-invariants.ts`
**Invariant (ADR-0023; v3 §17 preamble "never fake green"):** the registry stores ACTIVATION only
('active' | 'not-yet-active') - a pass/fail can never be stored, an active invariant must map to a
runnable fence, a not-yet-active one must name its trigger, and activation is ratcheted ([2, 5]). The
runner EXECUTES each active invariant's mapped fences and fails CI on active-fail; not-yet-active
renders as `○ not-yet-active` (dim, no checkmark), never as a pass. The inline `detects` companion
covers the stored-result, hollow-active, silent-deferral, ghost-mechanism, missing-ci-gate, ratchet, and
missing-invariant classes plus the honest-registry acceptance case.

**Injection + observed failure (verbatim), each reverted:**
```
# (a) registry ratchet - invariant 2 flipped to not-yet-active in v3-invariants.json:
  × enforces: the registry is complete, honest (activation-only), mapped to live mechanisms, and ratcheted
    AssertionError: v3-invariants.json problems:
    invariant 2: shipped as 'active' but regressed to 'not-yet-active' (the ratchet is monotonic)
    ❯ src/__tests__/fitness/v3-invariants.test.ts:111
# (b) runner active-fail - invariant 2 mapped to a deliberately failing fence file:
    ✗ ACTIVE-FAIL     # 2 Every persisted record and repository operation is tenant-scoped
                         └ fitness src/__tests__/tmp-adversarial-fail.test.ts FAILED
    summary: 1 active-pass · 1 active-fail · 28 not-yet-active (30 total)
    v3-invariants: ACTIVE invariants failing:   [exit 1]
```
**Revert:** restored invariant 2 (active, org-id-required mechanism), deleted the temp failing test;
`vitest run` on both fence files → `Tests 13 passed`; `pnpm v3:invariants` →
`summary: 2 active-pass · 0 active-fail · 28 not-yet-active (30 total)`, exit 0.

**Date:** 2026-07-26 (v3 ratification "prompt 0", ADR-0023).

### PF-025 · demo-scenarios-contract (inert data + stable ids + cross-refs) · `src/__tests__/fitness/demo-scenarios-contract.test.ts`
**Invariant (charter #1, D-034):** `config/demo/scenarios.yaml` states its own invariants in prose - the
STABILITY CONTRACT (every `id` stable: never renamed or reused, additions append) and the inert-data rule
("NO executable content of any kind": plain YAML scalars/maps/lists, no tags) - and its sections
cross-reference each other by id. The fence machine-enforces all three: (a) the file parses clean with NO
YAML tags of any kind (custom or explicit-standard); (b) EVERY id family in the file - contract, firms,
household, household.required_shape, deferral, scenarios, state_vocabulary, provenance_labels, elements,
exactly the scope the STABILITY CONTRACT claims ("every `id` in this file") - is pinned against a
two-directional inline baseline (`PINNED_IDS` - removals and renames fail; an id present in the file but
absent from the baseline fails, so additions must append there in the same PR, review-visible, same
ratchet pattern as charter-drift's `RATCHETED_ENFORCED_IDS`); (c) every cross-reference resolves: scenario dispositions,
`per_firm` entries, and `exercises` to state-vocabulary/firm ids, element `reality_now`/`reality_at_phase1`
to provenance-label ids, and `deferral.deferred_elements` to element ids in BOTH directions. The detectors
are pure functions over YAML text; the companion feeds them violating documents (custom tag, explicit
standard tag, removed/renamed/reused pinned id, a coordinated firm rename consistent across `firms` and
`per_firm` keys, removed household required-shape id, renamed contract/household/deferral singleton ids,
an id appended without a matching baseline append, dangling state/label/deferral references, a gutted
`{}` document) and asserts each is caught, plus the positive appended-id-plus-baseline-append case, so it
can pass neither vacuously nor by always-failing. Registered in `charter-map.json` as
`demo-contract-as-data` (enforced, added to charter-drift's ratchet).

**Injection + observed failure (verbatim), each reverted:**
```
# custom tag injected (`amount_usd: 75000` -> `amount_usd: !exec 75000`):
  × enforces: the scenario matrix is inert - plain scalars/maps/lists, no tags of any kind
    config/demo/scenarios.yaml :: Unresolved tag: !exec at line 32, column 15:
    config/demo/scenarios.yaml :: line 32: tag "!exec" - plain YAML scalars/maps/lists only, no tags of any kind
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:207
# pinned id renamed (`- id: dual-approval` -> `- id: dual-approvals`):
  × enforces: every pinned stable id is present and none is reused (append-only)
    config/demo/scenarios.yaml :: scenarios: pinned id "dual-approval" is missing - ids are never renamed or removed; additions append
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:212
# cross-reference dangled (delayed-nigo `exercises`: nigo -> rejected, the ObservedStatus value the
# vocabulary deliberately excludes):
  × enforces: every cross-reference between sections resolves
    config/demo/scenarios.yaml :: scenarios[delayed-nigo].exercises -> "rejected" is not a state_vocabulary id
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:217
```
**Revert:** restored `config/demo/scenarios.yaml` after each injection; fence file `Tests 13 passed`,
`pnpm test:fitness` → `Tests 166 passed` (23 files), `pnpm typecheck` / `pnpm lint` / `pnpm knip` clean.
YAML parsing uses the `yaml` devDependency (exact-pinned 2.9.0; devDependencies are knip-exempt).

**Extension (gate review round 3 - captain ruling: the fence must enforce the STABILITY CONTRACT's full
claim):** the baseline initially pinned only the four list families, leaving firms, household
required-shape, and the contract/household/deferral singleton ids prose-only (a coordinated `firm-a`
rename across `firms` and every `per_firm` key passed). `PINNED_IDS` now pins every id family and the
baseline check is two-directional. Injections + observed failures (verbatim), each reverted:
```
# coordinated firm rename (firm-a -> firm-alpha in BOTH `firms` and every `per_firm` key -
# internally consistent, so cross-refs alone would pass it):
  × enforces: every pinned stable id is present and none is reused (append-only)
    config/demo/scenarios.yaml :: firms: pinned id "firm-a" is missing - ids are never renamed or removed; additions append
    config/demo/scenarios.yaml :: firms: id "firm-alpha" is not in PINNED_IDS - append it to the baseline in the same PR that adds it
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:243
# singleton renamed (deferral `id: salesforce-sandbox` -> `id: sf-sandbox`):
  × enforces: every pinned stable id is present and none is reused (append-only)
    config/demo/scenarios.yaml :: deferral: pinned id "salesforce-sandbox" is missing - ids are never renamed or removed; additions append
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:243
# scenario `a-new-branch` appended WITHOUT appending it to PINNED_IDS (reverse direction):
  × enforces: every pinned stable id is present and none is reused (append-only)
    config/demo/scenarios.yaml :: scenarios: id "a-new-branch" is not in PINNED_IDS - append it to the baseline in the same PR that adds it
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:243
```
**Revert (extension):** restored `config/demo/scenarios.yaml` after each injection; fence file
`Tests 17 passed`, `pnpm test:fitness` → `Tests 170 passed` (23 files), `pnpm typecheck` / `pnpm lint` /
`pnpm knip` clean.

**Extension (gate review round 4 - structural family discovery + full cross-reference closure):** the
baseline previously extracted ids through nine hand-listed paths, so an id in a NEW section (e.g. a future
`personas:` list) escaped both pinning directions despite the STABILITY CONTRACT's "every `id` in this
file"; and two cross-references were unchecked: the top-level `canonical_request.provenance` /
`household.provenance` labels, and the deferral agreement was only two-thirds enforced (a listed element
whose `deferral:` marking was dropped, or a marking value disagreeing with `deferral.status`, passed).
`collectIdFamilies` now discovers every `id`-keyed value structurally (grouped by key path, non-string ids
kept via `String()` so they cannot slip past unreviewed), and `crossRefViolations` validates the top-level
provenance fields and the deferral sections in full (marked-implies-listed, listed-implies-marked, marking
value matches `deferral.status`). Injections + observed failures (verbatim), each reverted:
```
# NEW id-bearing section appended (`personas:` with `- id: avery-the-advisor`) - no extraction
# path existed for it before, so the old fence passed it:
  × enforces: every pinned stable id is present and none is reused (append-only)
    config/demo/scenarios.yaml :: personas: id "avery-the-advisor" is not in PINNED_IDS - append it to the baseline in the same PR that adds it
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:277
# top-level provenance typo'd (household `provenance: synthetic-fixture` -> `synthetic-fixtures`):
  × enforces: every cross-reference between sections resolves
    config/demo/scenarios.yaml :: household.provenance -> "synthetic-fixtures" is not a provenance_labels id
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:282
# listed element's deferral marking dropped (`returned-status` kept in deferral.deferred_elements,
# its `deferral: deferred-pending-sandbox` line deleted):
  × enforces: every cross-reference between sections resolves
    config/demo/scenarios.yaml :: deferral.deferred_elements lists "returned-status" but elements[returned-status] carries no deferral marking
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:282
```
**Revert (round-4 extension):** restored `config/demo/scenarios.yaml` after each injection; fence file
`Tests 22 passed`, `pnpm test:fitness` → `Tests 175 passed` (23 files), `pnpm typecheck` / `pnpm lint` /
`pnpm knip` clean.

**Extension (gate review round 5 - shape drift is a violation, not a skip):** `crossRefViolations`
previously validated only values that already had the expected container shape: a scenario missing its
`disposition` key entirely, an `exercises` value that was not a list, a disposition object lacking
`per_firm` (or whose `per_firm` was a scalar, a list, or an empty map), and a fully dropped
`canonical_request` section (it carries no pinned id, so the baseline alone never notices) each passed
silently, carrying a possibly unvalidated reference past the fence. The detector now reports every
unexpected shape with its offending path, and the companion feeds it each drift: missing disposition,
scalar and missing exercises, per_firm renamed away / scalar / empty map, an unknown per_firm firm id
and a non-state per_firm value, and dropped canonical_request/household sections. Injections + observed
failures (verbatim), each reverted:
```
# scenario disposition key deleted (permanent-prohibition's `disposition: prohibited` line removed):
  × enforces: every cross-reference between sections resolves
    config/demo/scenarios.yaml :: scenarios[permanent-prohibition].disposition -> expected a state_vocabulary id or a per_firm map, got missing
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:301
# exercises flattened to a scalar (stale-evidence `exercises: [blocked]` -> `exercises: blocked`):
  × enforces: every cross-reference between sections resolves
    config/demo/scenarios.yaml :: scenarios[stale-evidence].exercises -> expected a list of state_vocabulary ids, got string
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:301
# per_firm key renamed away (recent-bank-change-block `per_firm:` -> `firm_split:`):
  × enforces: every cross-reference between sections resolves
    config/demo/scenarios.yaml :: scenarios[recent-bank-change-block].disposition.per_firm -> expected a firm-id to state map, got missing
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:301
# canonical_request section deleted whole (no pinned id in it, so the baseline alone never notices):
  × enforces: every cross-reference between sections resolves
    config/demo/scenarios.yaml :: canonical_request -> expected a section carrying a provenance label, got missing
    ❯ src/__tests__/fitness/demo-scenarios-contract.test.ts:301
```
**Revert (round-5 extension):** restored `config/demo/scenarios.yaml` after each injection; fence file
`Tests 27 passed`, `pnpm test:fitness` → `Tests 180 passed` (23 files), `pnpm typecheck` / `pnpm lint` /
`pnpm knip` clean.

**Date:** 2026-07-26 (gate review round 2 - the D-034 scenario-matrix invariants fenced per charter #1;
prose-only invariants are on the charter's do-not-port list; extended same day in gate review round 3 to
full-scope, two-directional id pinning, in round 4 to structural id-family discovery and full
cross-reference closure, and in round 5 to loud shape-drift reporting in the cross-reference detector).

### PF-026 · golden-cases (prompt-2 truth set: complete, aligned, signoff-gated) · `src/__tests__/fitness/golden-cases.test.ts`, `scripts/golden-cases-validate.ts`
**Invariant (charter #1/#4; v3 build-sequence prompt 2):** the golden cases in `fixtures/golden/*.json`
are the truth set the engine is later judged against, so an incomplete or dishonest case is a build
failure: (a) every case states every required field, populated - trigger, firm configuration, household
evidence, policy versions, household instructions, expected disposition / authority stages / execution
eligibility / explanation nodes / ledger events / verification state, signoff; (b) vocabulary aligns
with the LIVE `config/demo/scenarios.yaml` (firm/scenario/state/provenance/deferral ids) and with the
v3 core-contracts `LedgerEntry` types; (c) structural consistency: blocked/prohibited cases carry no
authority, no execution eligibility, no reached verification (v3 invariants 8/9), and the
partial-Salesforce case carries `deferred-pending-sandbox`; (d) signoff honesty: exactly
`pending-captain` (null attribution) or `signed` (populated attribution) - expected results are product
truth subject to captain signoff, never agent invention, and an agent-"signed" case without attribution
is rejected; (e) doc/fixture sync (every caseId in `docs/golden-cases.md`), filename = caseId, all
twelve spec-enumerated cases covered, at least twelve cases. Validator core is shared
(`scripts/golden-cases.lib.ts`) between the fence (in `pnpm test`) and the `golden-cases` CI job
(`pnpm golden:validate`), so the enforced check and the proven check are the same code. The companion
feeds violating cases cloned from the REAL fixtures (missing field, blank populated field, agent-signed,
unknown status, five vocabulary drifts, three blocked-case contradictions plus a proceed-with-none,
dropped deferral marking, doc drift, dropped spec case, sub-twelve set, duplicate caseId,
recorded-silence abuse, a gutted scenarios.yaml ref set) and asserts each is caught, plus two positive
cases (the real set passes; a properly attributed captain signature passes) so it can pass neither
vacuously nor by always-failing. Registered in `charter-map.json` as `golden-cases-truth-set`
(enforced, added to charter-drift's ratchet).

**Injection + observed failure (verbatim), each reverted:**
```
# required field deleted from a real fixture (GC-01 expectedVerificationState removed):
  × enforces: every golden case is complete, aligned, consistent, and signoff-gated
    fixtures/golden/GC-01-firm-a-happy-path.json :: expectedVerificationState object missing
    ❯ src/__tests__/fitness/golden-cases.test.ts:46
# agent-signed case (GC-02 signoff.status pending-captain -> signed, attribution still null) - the
# RUNNER path this time (defense in depth; CI job golden-cases):
  ✗ GC-02-firm-b-happy-path  disposition=proceed  signoff=signed
      └ signoff.signedBy must name the signer when status is signed
      └ signoff.signedAt must be populated when status is signed
  golden-cases: 2 problem(s) - an incomplete case cannot pass (charter #4)   [exit 1]
# vocabulary drift (GC-03 firm: firm-a -> firm-alpha):
  × enforces: every golden case is complete, aligned, consistent, and signoff-gated
    fixtures/golden/GC-03-recent-bank-change-firm-a.json :: firm must be a scenarios.yaml firm id, got "firm-alpha"
    fixtures/golden/GC-03-recent-bank-change-firm-a.json :: firmConfiguration.firmId "firm-a" does not match case firm "firm-alpha"
    ❯ src/__tests__/fitness/golden-cases.test.ts:46
# doc/fixture drift (docs/golden-cases.md rows for GC-16 renamed to GC-16-review-lapse):
  × enforces: every golden case is complete, aligned, consistent, and signoff-gated
    fixtures/golden/GC-16-specialist-review-expiration.json :: caseId "GC-16-specialist-review-expiration" is not referenced anywhere in docs/golden-cases.md (doc/fixture drift)
    ❯ src/__tests__/fitness/golden-cases.test.ts:46
```
**Revert:** restored each injected file; fence file `Tests 15 passed`, `pnpm test:fitness` →
`Tests 208 passed` (26 files), `pnpm golden:validate` → all 16 cases green, `pnpm typecheck` /
`pnpm lint` / `pnpm knip` clean. The YAML cross-check reuses the `yaml` devDependency (2.9.0).

**Date:** 2026-07-26 (v3 build-sequence prompt 2 - the golden-case specification and signed fixtures;
16 cases, all `pending-captain`; the captain signs against the summary table in `docs/golden-cases.md` §2).

## Walking-skeleton honesty fence (2026-07-26) - executed injection proofs

### demo-skeleton-honesty (v3 prompt 3 Gate 0; charter #4/#5, ADR-0027)

**Fence:** `src/__tests__/fitness/demo-skeleton-honesty.test.ts`. Two rules: (A) the demo
skeleton's static branch data (`src/app/demo/data.ts`) must state EXACTLY the scenario ids,
firm ids, and dispositions (incl. per-firm splits) recorded in `config/demo/scenarios.yaml` -
the UI cannot show an outcome the ratified contract does not state; (B) surface components
(`src/app/demo/surfaces/`) may import only react/next, presentation primitives, the view-model
module, contract types, and surface-local siblings - importing the contract data, the fake
service, or a builder (the road to components recomputing decisions) fails the build with
file:line. Injections + observed failures (verbatim), each reverted:
```
# RULE A: data.ts permanent-prohibition disposition flipped "prohibited" -> "proceed":
  × RULE A enforces: skeleton branch data equals the contract's scenarios, firms, and dispositions
    AssertionError: skeleton/contract drift:
    scenario "permanent-prohibition": contract disposition "prohibited", skeleton says "proceed" - the UI may not invent decisions
# RULE B: `import { SCENARIOS } from "../data";` added to a shipped surface:
  × RULE B enforces: no surface component imports data, the fake service, or builders
    AssertionError: surface import-boundary violations:
    src/app/demo/surfaces/recommendation.tsx:13 :: import "../data" - surfaces render view models only (no data, service, or builder imports)
```
**Revert:** both injections restored; fence file `Tests 11 passed` (incl. 8 companions:
invented branch, dropped branch, drifted disposition, dropped per-firm split, invented firm,
data/service/builder imports flagged with file:line, allowlist passes).

## Walking-skeleton honesty fence hardening (2026-07-26, review round) - executed injection proofs

### demo-skeleton-honesty, hardened RULE A + RULE B (review findings fence-rule-a-perfirm-invention-hole, fence-rule-b-ts-file-bypass)

**Fence:** `src/__tests__/fitness/demo-skeleton-honesty.test.ts`, strengthened in place (no rule weakened).
RULE A now flags a skeleton `perFirm` map on a scenario whose contract disposition is plain, and any
skeleton per-firm key the contract's recorded split does not state - previously `dispositionFor()`
preferred `perFirm`, so a skeleton-only split could change rendered outcomes while the fence stayed
green. RULE B's surfaces walk now includes plain `.ts` files alongside `.tsx` - previously a
`surfaces/*.ts` helper could import `../data` or `../journey` and re-export to surfaces unseen.
Injections + observed failures (verbatim), each reverted:
```
# RULE A: data.ts safe-proceed (contract-plain) given a skeleton-only perFirm: { "firm-b": "blocked" }:
  × RULE A enforces: skeleton branch data equals the contract's scenarios, firms, and dispositions
    AssertionError: skeleton/contract drift:
    scenario "safe-proceed": skeleton records a per-firm split but the contract disposition is plain "proceed" - the UI may not invent decisions
# RULE B: src/app/demo/surfaces/evil-helper.ts created on disk, importing the contract data:
  × RULE B enforces: no surface component imports data, the fake service, or builders
    AssertionError: surface import-boundary violations:
    src/app/demo/surfaces/evil-helper.ts:1 :: import "../data" - surfaces render view models only (no data, service, or builder imports)
```
**Revert:** the data.ts injection restored, the evil-helper.ts file deleted; fence file green with
three new companions (skeleton per-firm split on a contract-plain scenario; skeleton per-firm key
beyond the contract's recorded split; an on-disk `.ts` violator caught by the real walk via a temp
directory). Same PR also lands the captain-authorized specialist-review-expiration per-firm split
(firm-a=proceed / firm-b=blocked) in scenarios.yaml + data.ts, which the hardened RULE A holds equal.

**Date:** 2026-07-26 (review-fix round on the walking-skeleton PR, decision keys nm-review-askuser-s6 / nm-review-rerun-copy-s6).

## Walking-skeleton honesty fence hardening 2 (2026-07-26, review round) - executed injection proofs

### demo-skeleton-honesty, hardened RULE B collector (review finding rule-b-reexport-and-traversal-bypass)

**Fence:** `src/__tests__/fitness/demo-skeleton-honesty.test.ts`, strengthened in place (no rule
weakened). RULE B's specifier collector previously read only static import declarations, so a
re-export (`export { x } from` / `export * from`), a dynamic `import()`, or a `require()` could
reach the contract data or the builders unseen, and a traversal specifier like `"./../data"`
matched the `"./"` sibling allowlist outright. The collector now gathers every module-reaching
form with file:line, records a non-literal dynamic specifier as unverifiable (so it fails the
allowlist instead of slipping past), and any `..` segment beyond the one allowed `"../model"`
is rejected as traversal. Injections + observed failures (verbatim), each reverted:
```
# RULE B: `export { SCENARIOS } from "../data";` appended to a shipped surface:
  × RULE B enforces: no surface component imports data, the fake service, or builders
    AssertionError: surface import-boundary violations:
    src/app/demo/surfaces/execution.tsx:40 :: import "../data" - surfaces render view models only (no data, service, or builder imports)
# RULE B: `export const sneak = import("../journey");` appended to a shipped surface:
    AssertionError: surface import-boundary violations:
    src/app/demo/surfaces/execution.tsx:40 :: import "../journey" - surfaces render view models only (no data, service, or builder imports)
# RULE B: `import { FIRMS } from "./../data";` added to a shipped surface's imports:
    AssertionError: surface import-boundary violations:
    src/app/demo/surfaces/verification.tsx:12 :: import "./../data" - surfaces render view models only (no data, service, or builder imports)
```
**Revert:** all three injections restored; fence file `Tests 18 passed` with four new companions
(a re-export, a dynamic import, a non-literal dynamic specifier, and traversal specifiers incl.
a nested `"./helpers/../../journey"`). The same review round mirrors the voided-approval
treatment in the below-threshold single-approver stage (`build-decision.ts`, so gate, safety,
and record agree under approval-invalidation at Firm B) and extracts the shared
execution-timeline row mapper into `surfaces/shared.tsx` - neither changes any fence rule.

**Date:** 2026-07-26 (review-fix round on the walking-skeleton PR, decision key nm-review-invalidation-s6).

---

### PF-027 · decision-core illegal-states (v3 invariants 7-9, prompt 5) · `src/__tests__/fitness/decision-core-illegal-states.test.ts`
**Invariant (charter #1; v3 §5; ADR-0029, D-040):** the canonical type system makes the decision-core
distinctions structural - a proceed decision REQUIRES an authority requirement and a non-empty
execution plan (inv 7); a blocked decision cannot carry authority or a plan and its blockers must be
genuinely resolvable (inv 8); a prohibited decision carries no resolving condition, authority, or plan,
whether smuggled into the Prohibition or via record-level revaluation conditions (inv 9); disposition
and authority never collapse into one plane. Every rejection is a Zod strict-schema PARSE failure over
`src/contracts/decision-core/` - reviewer discipline is not a mechanism. The registry
(`v3-invariants.json`) maps invariants 7-9 to this fence; the runner (`pnpm v3:invariants`) executes it.
**Companion:** the legal counterpart of every rejection parses (a reject-everything schema cannot pass),
including all three dispositions on a full DecisionRecord and a NON-prohibited record carrying
revaluation conditions.

**Injected violations (each run live, watched fail, reverted):**
```
# 1 - silent weakening: BlockedDecisionSchema z.strictObject -> z.object (unknown keys stripped, not rejected):
  × enforces: invariant 8 - blocked cannot carry authority or an execution plan > rejects authority on a blocked result
    AssertionError: expected rejection naming "authority": expected true to be false
    ❯ expectRejected src/__tests__/fitness/decision-core-illegal-states.test.ts:80:73
    ❯ src/__tests__/fitness/decision-core-illegal-states.test.ts:107:7
  × ... > rejects an execution plan on a blocked result
    ❯ src/__tests__/fitness/decision-core-illegal-states.test.ts:110:7
# 2 - inv-7 hole: ProceedDecisionSchema.executionPlan made .optional():
  × enforces: invariant 7 - proceed requires authority and an execution plan > rejects proceed without an execution plan
    ❯ src/__tests__/fitness/decision-core-illegal-states.test.ts:80:73
```
**Revert:** both injections restored; fence file `Tests 18 passed`. The rejection assertions demand the
error name the offending path/key, so a schema that fails for an unrelated reason cannot green them.

**Date:** 2026-07-26 (v3 build-sequence prompt 5 - the canonical core type system; invariants 7-9
flipped ACTIVE in `v3-invariants.json`, ratchet extended to [2, 5, 7, 8, 9]).

**Extension (selected review correction F6):** invariant 7 now rejects a non-empty execution plan
whose dependency graph contains a cycle. Such a graph has steps but no executable ordering.
Injection + observed failure (verbatim), reverted:
```
# cycle issue emission removed from ExecutionPlanSchema; two-step s1 -> s2 -> s1 supplied:
  × rejects a dependency cycle (an unusable graph is still no executable plan)
    AssertionError: expected rejection naming "steps": expected true to be false
    ❯ expectRejected src/__tests__/fitness/decision-core-illegal-states.test.ts:84:73
    ❯ src/__tests__/fitness/decision-core-illegal-states.test.ts:117:7
```
**Revert (extension):** restored cycle rejection; the fitness and decision-core unit files pass
together (`Tests 37 passed`). The unit suite also accepts an acyclic diamond and rejects two- and
three-step cycles, so the boundary does not enforce only the injected shape.

**Extension (review corrections F2-F5 and F8-F10):** focused boundary tests were added before the
implementation changed and reproduced five independent failures: unsupported schema/serializer
versions parsed, an invalid time zone parsed, replay inputs remained mutable, a sparse array
canonicalized to the same bytes as `[]`, and a parsed decision with explicit undefined optional
properties could not be hashed. Observed failures:
```
× rejects replay metadata versions without a matching implementation
  expected true to be false
× rejects unsupported time zones before replay depends on firm-local time
  expected true to be false
× freezes parsed replay inputs and their nested collections
  expected false to be true
× refuses sparse arrays instead of colliding with dense arrays or emitting invalid JSON
  expected true to be false
× hashes every schema-valid decision even when optional keys were explicitly undefined
  expected false to be true
```
The dependency fence and exhaustive projection-key assertion were then adversarially proven:
```
# Added `import { createElement } from "react"` to serialization.ts:
× dependency-rule fence > enforces: the real src/ tree has zero layer violations
  contracts external-import violations:
  src/contracts/decision-core/serialization.ts:9 (react)

# Added `futureOptional: z.string().optional()` to DecisionInputBundleSchema without
# adding it to BUNDLE_HASH_PAYLOAD_KEYS:
src/contracts/decision-core/serialization.ts(24,82): error TS2345
  Property 'futureOptional' is missing ... but required in type 'Record<"futureOptional", never>'.
```
**Revert (extension):** both planted violations were removed. The focused unit and fitness run passed
58 tests, including companions for non-literal dynamic imports, relative traversal to an external
package, the one-package Zod allowlist, exact runtime schema-key coverage including the optional
`derivedFromDecisionRef`, replay immutability, and canonicalization totality.

**Date:** 2026-07-26 (review hardening of the v3 prompt-5 decision-core contracts, D-041).

**Extension (review corrections F12-F15):** the target commit reproduced all four gaps before
implementation: parsed DecisionRecord, ExecutionPlan, and steps were mutable; duplicate replay IDs
parsed; TypeScript import types and import-equals declarations produced zero dependency violations;
and nested decision values entered the hash projection without a recursive version-shape lock.
The dependency collector and nested projection lock were then adversarially proven:
```
# Added both forms to src/contracts/decision-core/actor.ts:
# import React = require("react");
# type ForbiddenImportType = import("react").ReactNode;
× dependency-rule fence > enforces: the real src/ tree has zero layer violations
  contracts external-import violations:
  src/contracts/decision-core/actor.ts:13 (react)
  src/contracts/decision-core/actor.ts:14 (react)

# Added `futureOptional: z.string().optional()` to nested
# RecommendationAlternativeSchema without changing decision-record/1.0.0:
× binds each preimage version to its complete recursive projection schema
  Expected: 5116bea473ea037d0b8e2be46e087ca658165a084f9672b9b5f1f4a56b100450
  Received: 2c04705b992a3de633eb9addfe9bee9e5d29b0f8fdc99a53affaa7695ec01fcd
```
**Revert (extension):** both planted violations were removed. Focused tests cover deep runtime
freezing, inferred readonly collections, duplicate replay-ID rejection, recursive optional-field
detection, and both previously invisible TypeScript import forms. The contracts layer measures
1480 lines under its unchanged 1550 ceiling.

**Date:** 2026-07-26 (review hardening of the v3 prompt-5 decision-core contracts, D-042).

### PF-028 · decision-core tenant scope (v3 invariant 2) · `src/__tests__/fitness/decision-core-tenant-scope.test.ts`
**Invariant (charter #1/#7; v3 invariant 2 and §3 non-negotiable 11; ADR-0029, D-045/D-046):** every
immutable policy-version, household-instruction-version, evidence-snapshot, intent, input-bundle, and
derived-decision link carries its own `firmId` plus opaque branded ID. The bundle and decision schemas
recursively reject any nested tenant that differs from the enclosing record, including precedence
citations, explanation child nodes, prohibitions, and execution preconditions. The legal companion
parses all four canonical fixtures so a reject-everything schema cannot pass.

The target commit reproduced the missing contract before implementation:
```
{"crossTenantBundleAccepted":true}
```
The focused tests also proved the non-canonical replay context before the time-zone boundary tightened:
```
{"aliasAccepted":true,"timeZone":"US/Eastern"}
```
After the structured references landed, two real schema weakenings were injected together: the
`policyVersionRef` tenant check and the `intentRef` tenant refinement were removed. Observed:
```
× enforces: every immutable bundle reference belongs to the bundle tenant
  expected true to be false
× enforces: intent, bundle, and actor references belong to the decision tenant
  expected true to be false
```
**Revert:** restored both tenant checks; the focused fence passed. The unit suite separately rejects
every bundle-reference class, both decision-record links, non-canonical IANA aliases, duplicate scoped
IDs, and hash-preimage or schema-fingerprint drift.

**Date:** 2026-07-27 (review corrections F20 and F22, D-045).

**Extension (review correction F23):** the target commit accepted cross-tenant policy citations,
explanation evidence, and execution-precondition evidence:
```
{
  policyCitation: true,
  explanationEvidence: true,
  executionEvidence: true
}
```
After scoped recursive references landed, the precedence and execution-precondition tenant checks
were removed together. The real fence failed at the owning paths:
```
× enforces: precedence and explanation references belong to the decision tenant recursively
  expected true to be false
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:119
× enforces: prohibition and execution-precondition references belong to the decision tenant
  expected true to be false
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:162
```
**Revert (extension):** restored both recursive checks; the focused fence and canonical-fixture
companion passed. The schema and hash-preimage envelopes advanced to 1.2.0, with new projection
fingerprints and fixture digests.

**Date:** 2026-07-27 (review correction F23, D-046).

**Extension (review correction F26):** the external-action target tenant check was removed from
`DecisionRecordSchema`. The real fence rejected the weakening:
```
× enforces: approval and external-action references belong to the decision tenant recursively
  expected true to be false
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:390
```
**Revert (extension):** restored the target-reference check. The extended fence also exercises
domain configuration, evidence sources, subjects, approval templates, scopes, reservations,
verification rules, authority stages, blockers, revaluation conditions, and compensating actions.

**Date:** 2026-07-27 (review correction F26, D-047).

### PF-029 · decision-core external-action safety (charter #16) · `src/__tests__/fitness/decision-core-external-action-safety.test.ts`
**Invariant (charter #1/#16; v3 §3 non-negotiable 10; ADR-0029, D-047):** every external
execution action, including a compensating action, carries stable idempotency, conflict control,
tenant-scoped reservations, pre-execution conditions, and a tenant-scoped verification rule.
Parent and compensation idempotency keys cannot alias.

`idempotencyKey` was made optional in the shared action shape. The real fence failed:
```
× enforces: compensation requires idempotencyKey
  expected true to be false
  src/__tests__/fitness/decision-core-external-action-safety.test.ts:43
```
**Revert:** restored the required key. The legal companion parsed the shared action,
compensation, and full execution plan, proving the fence does not reject every plan.

**Date:** 2026-07-27 (review correction F25, D-047).

### PF-002 extension · implicit JSX runtime dependency
**Invariant (charter #1; ADR-0001/0029, D-047):** Zod is the only permitted external dependency
in `contracts/`; JSX cannot add an invisible `react/jsx-runtime` import.

A real `src/contracts/decision-core/jsx-probe.tsx` containing `<div />` was injected. The
dependency fence reported:
```
contracts external-import violations:
src/contracts/decision-core/jsx-probe.tsx:1 (react/jsx-runtime)
```
**Revert:** removed the probe. The in-memory companion keeps the implicit import form covered.

**Date:** 2026-07-27 (review correction F27, D-047).

### PF-027 extension · version-pinned replay time zones
**Invariant (charter #1; v3 replay contract §12.1; ADR-0029, D-047):** bundle validation uses
the persisted time-zone-data version and a closed registry, never host ICU data.

The closed `TimeZoneSchema` was weakened to an arbitrary non-empty string. The focused contract
test failed:
```
× uses a version-pinned time-zone registry independent of host ICU data
  expected true to be false
  src/__tests__/unit/decision-core.test.ts:213
```
**Revert:** restored the closed registry. The same test replaces `Intl.DateTimeFormat` with a
throwing implementation and proves the supported bundle still parses.

**Date:** 2026-07-27 (review correction F28, D-047).

### PF-027 extension · canonical evaluator order, replay registry, and lineage
**Invariant (charter #1/#4; v3 invariants 6/13; ADR-0029, D-048):** one bundle hash exposes one
canonical evaluator order, the pinned IANA registry cannot drift under its version, and a decision
cannot derive from itself.

The target commit reproduced the three gaps before implementation:
```
× canonicalizes set-like replay collections in parsed evaluator input
  expected reversed references to equal canonical references
× uses a version-pinned time-zone registry independent of host ICU data
  expected Europe/London to parse
× rejects direct self-reference in derived-decision lineage
  expected true to be false
```
After implementation, the household-instruction sort and self-lineage refinement were removed, and
`Europe/London` was removed from the pinned registry. The focused tests rejected all three
weakenings; the registry case failed its committed SHA-256 digest before reaching host ICU.
**Revert:** restored the sort, lineage refinement, and registry entry. The focused suite passed.

**Date:** 2026-07-27 (review corrections F30, F34, and F35, D-048).

### PF-028 extension · tenant-scoped secure storage references
**Invariant (charter #7; v3 invariant 2; ADR-0029, D-048):** secure request, event, and blob
pointers carry their own tenant and match the enclosing request, snapshot, execution action, and
decision.

The target commit could not express a pointer tenant. After structured references landed, both the
execution-step payload refinement and the recursive decision payload check were removed. The real
fence failed:
```
× enforces: approval and external-action references belong to the decision tenant recursively
  expected true to be false
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:470
```
**Revert:** restored both checks. Companions separately exercise human request, system event,
snapshot storage, execution payload, and canonical fixture paths.

**Date:** 2026-07-27 (review correction F31, D-048).

### PF-002 extension · compiler-resolved local paths and platform globals
**Invariant (charter #1; ADR-0001/0029, D-048):** dependency classification follows active
TypeScript path configuration, local targets outside the four source layers fail closed, and
contracts cannot couple to implicit DOM or Node globals.

Two real-tree violations were injected independently:
```
src/contracts/time-zone.ts:2: contracts -> unresolved (../../scripts/golden-cases.lib)
contracts external-import violations:
src/contracts/time-zone.ts:5 (<platform-global fetch>)
```
**Revert:** removed both probes. In-memory companions retarget a configured alias into
infrastructure, exercise `fetch`, `Buffer`, and `process.getBuiltinModule`, and prove locally
declared lookalike names remain legal.

**Date:** 2026-07-27 (review corrections F32 and F33, D-048).

### PF-029 extension · duplicate-free execution sets
**Invariant (charter #16; ADR-0029, D-048):** dependency, conflict, reservation, and
precondition-evidence collections are sets at the execution boundary and cannot encode one logical
plan multiple ways.

The duplicate-conflict-key refinement was removed. The real fence failed:
```
× enforces: conflictKeys are duplicate-free
  expected true to be false
  src/__tests__/fitness/decision-core-external-action-safety.test.ts:110
```
**Revert:** restored the refinement. Companions cover every set-like execution collection on both
the shared action and full plan boundaries.

**Date:** 2026-07-27 (review correction F36, D-048).

### PF-029 extension · single-tenant actions and evidence-targeted revalidation
**Invariant (charter #7/#16; v3 non-negotiables 10-11; ADR-0029, D-049):** every
external action is internally single-tenant, every action in one plan shares that tenant, and every
precondition identifies at least one evidence snapshot to revalidate.

The target commit accepted cross-tenant standalone actions, mixed-tenant plans, and empty evidence
targets. After implementation, the tenant checks and evidence minimum were weakened together. The
real fence rejected all three regressions:
```
× enforces: conflict control and pre-execution revalidation cannot be empty or advisory
  src/__tests__/fitness/decision-core-external-action-safety.test.ts:68
× enforces: standalone actions reject a cross-tenant payload reference
× enforces: standalone actions reject a cross-tenant reservation reference
× enforces: standalone actions reject a cross-tenant precondition evidence reference
× enforces: standalone actions reject a cross-tenant verification rule reference
  src/__tests__/fitness/decision-core-external-action-safety.test.ts:169
× enforces: every step and compensation in one plan shares a tenant
  src/__tests__/fitness/decision-core-external-action-safety.test.ts:198
```
**Revert:** restored all action and plan tenant checks plus the non-empty evidence target. The
complete-action companion and focused fence passed.

**Date:** 2026-07-27 (review corrections F37 and F41, D-049).

### PF-027 extension · approval chronology and complete tzdb Zone registry
**Invariant (charter #1/#4; v3 authority §11 and replay §12.1; ADR-0029, D-049):** reusable
approval stages have positive duration, instantiated stages begin unexpired, and the pinned 2026b
registry contains every primary `Zone` record without treating `Link` names as distinct replay values.

The positive-duration and record-relative chronology refinements were disabled. The real fence failed:
```
× rejects a template stage with zero expiration
  src/__tests__/fitness/decision-core-illegal-states.test.ts:150
× rejects an already-expired approval stage on a new decision
× rejects an already-expired specialist_review stage on a new decision
  src/__tests__/fitness/decision-core-illegal-states.test.ts:197
```
`Etc/UTC` was then removed from the pinned registry. Its digest companion failed before parsing:
```
× uses a version-pinned time-zone registry independent of host ICU data
  expected 4361f644... to be 8125f9d8...
  src/__tests__/unit/decision-core.test.ts:222
```
**Revert:** restored the approval refinements and `Etc/UTC`. The registry was also diffed byte for
byte against the sorted `Zone` names from the IANA 2026b primary data files.

**Date:** 2026-07-27 (review corrections F42 and F43, D-049).

### PF-002 extension · lib directives, declarations, and indirect CommonJS loaders
**Invariant (charter #1; ADR-0001/0029, D-049):** source-local declarations receive the same
dependency enforcement as implementation files, triple-slash lib directives cannot restore hidden
platform dependencies, and indirect CommonJS loader forms fail closed.

The three collection paths were disabled together. The dependency companion reported:
```
× indirect CommonJS loaders fail closed (4 forms)
  expected [] to include domain->unresolved
  src/__tests__/fitness/dependency-rule.test.ts:128
× triple-slash lib references cannot restore contracts platform globals
  src/__tests__/fitness/dependency-rule.test.ts:196
× source-local declaration files remain shipped and dependency-enforced
  src/__tests__/fitness/dependency-rule.test.ts:288
```
**Revert:** restored lib-reference collection, source declaration discovery, and untracked
`require` reference rejection. The focused dependency fence passed.

**Date:** 2026-07-27 (review corrections F38-F40, D-049).

### PF-028 extension · tenant-scoped role references
**Invariant (charter #7; v3 invariant 2; ADR-0029, D-050):** actor, approval, specialist,
escalation, and evidence-supplier roles carry structured tenant scope and match the enclosing record.

Actor, authority-stage, and evidence-supplier tenant refinements were disabled together. The real
tenant-scope fence rejected each weakening:
```
× enforces: prompt-5 configuration, source, and subject links are tenant-scoped
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:212
× enforces: every direct decision reference belongs to the decision tenant
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:231
× enforces: blocker, revaluation, and prohibition subject or scope references belong to the decision tenant
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:350
× enforces: approval and external-action references belong to the decision tenant recursively
  src/__tests__/fitness/decision-core-tenant-scope.test.ts:558
```
**Revert:** restored all three refinements. The legal canonical fixtures and scoped counterparts pass.

**Date:** 2026-07-27 (review correction F44, D-050).

### PF-027 extension · canonical role sets and authority-stage order
**Invariant (charter #1/#4; v3 replay §12.1; ADR-0029, D-050):** role collections are
duplicate-free semantic sets with deterministic firm/id order, and explicit stage `order` controls
the parsed authority sequence.

Duplicate-role rejection and the role/stage normalization transforms were removed. The focused
contract suite rejected both regressions independently:
```
× rejects duplicate role sets
  src/__tests__/unit/decision-core.test.ts:614
× canonicalizes role and stage order
  src/__tests__/unit/decision-core.test.ts:651
```
**Revert:** restored duplicate rejection and both normalization transforms. Version-1.6.0 projection
fingerprints and canonical fixture digests pass.

**Date:** 2026-07-27 (review corrections F45-F46, D-050).

### PF-002 extension · TypeScript resolution, createRequire, ambient declarations, and diagnostic codes
**Invariant (charter #1; ADR-0001/0029, D-050):** the authoritative layer fence follows
TypeScript module resolution, untracked Node loaders fail closed, and contracts cannot restore hidden
runtime or platform dependencies with ambient declarations.

Three real-tree probes were injected: a domain import reached infrastructure through `baseUrl`, a
domain module created a CommonJS loader with `createRequire`, and a contracts module declared and used
an ambient `fetch`. The detector reported:
```
src/domain/create-require-probe.ts:1: domain -> unresolved (<non-literal create-require>)
src/domain/dependency-resolution-probe.ts:1: domain -> infrastructure (src/infrastructure/store/db)
src/contracts/ambient-probe.ts:1 (<ambient-declaration fetch>)
```
The reported TS2503 namespace bypass did not reproduce against the target: its old text-prefix check
accidentally matched `Cannot find namespace`. The implementation still replaced message matching with
stable diagnostic codes, and the companion pins TS2503 using `NodeJS.Timeout`.
**Revert:** removed all probes and the temporary `baseUrl`; the real dependency fence and all companion
forms pass.

**Date:** 2026-07-27 (review corrections F47-F50, D-050).

### PF-027 extension · every approval duration is positive, read from the duration itself
**Invariant (charter #1/#4; ADR-0029, D-051):** relative stage expiration AND escalation delay are
strictly positive, decided by reading component magnitudes rather than by inspecting a leading
character.

Two independent regressions were injected. Restoring the raw `DurationSchema` on `EscalationStep.after`
and reverting the predicate to the leading-minus heuristic each failed:
```
× requires EVERY approval duration (after) to be strictly positive, sign placement notwithstanding
AssertionError: PT0S is not strictly positive: expected true to be false

× decides positivity from the duration itself, not from the validator's ISO profile
AssertionError: P-1D: expected true to be false
```
The second probe is the reason the predicate is asserted DIRECTLY: zod 4.4.3's ISO profile already
refuses signed components, so through the schema alone the heuristic and the sound check are
indistinguishable, and the guard's soundness would be an unproven accident of the current library.
**Revert:** restored both; the focused contract suite passes.

**Date:** 2026-07-27 (review correction F51, D-051).

### PF-027 extension · supported tz registries, Link canonicalization, and the TimeZone brand
**Invariant (charter #1/#4; ADR-0029, D-051):** a recorded bundle stays parseable against the registry
version it recorded; `Link` aliases canonicalize at the configuration boundary only; `TimeZone` is a
branded type, not `string`.

Reverting `timeZoneDataVersion` to the single-version literal and dropping Link resolution at the
config boundary each failed:
```
× binds each preimage version to its complete recursive projection schema
AssertionError: expected 'b93536d06590326d1afe6f35aebed042d74b9…' to be '2087306d7834c731420550d14b14128b2ce1a…'

× canonicalizes case and resolves pinned Link aliases to their canonical Zone
```
The brand is a COMPILE-TIME fence: removing `.brand<"TimeZone">()` turns the test's suppression into an
unused directive, so `pnpm typecheck` fails rather than a runtime assertion passing vacuously:
```
src/__tests__/unit/decision-core.test.ts(294,5): error TS2578: Unused '@ts-expect-error' directive.
```
**Revert:** restored all three; typecheck and the focused suites pass.

**Date:** 2026-07-27 (review corrections F52-F54, D-051).

### PF-029 extension · one comparator, one trigger refinement, precise cycle refusal
**Invariant (charter #1/#4; ADR-0029, D-051):** the hash preimage and the parsed record order
tenant-scoped references identically; each trigger arm's tenant checks exist in exactly one place; a
cycle is refused by name, not by stack exhaustion.

The FIRST comparator probe passed vacuously - the bundle's single-tenant refinement makes id-only and
(firm, id) order agree, so the divergence the fence exists to catch was invisible to it. The test was
rewritten to probe the preimage with the cross-tenant lists that constraint currently prevents, which
is exactly the relaxation the invariant protects. Re-injected, all three failed:
```
× orders the hash preimage by THE canonical comparator, not by id alone
AssertionError: expected [ …(2) ] to deeply equal [ …(2) ]

× enforces: human request storage references belong to the request tenant
AssertionError: expected true to be false

× names a cycle precisely instead of relying on the stack running out
AssertionError: expected 'value is not canonically serializable' to contain 'circular reference'
```
**Revert:** restored the shared comparator, the refined union arms, and the ancestor set; all suites pass.

**Date:** 2026-07-27 (review corrections F55-F57, D-051).

### PF-027 extension · the recorded registry SELECTS the registry, and the version type holds
**Invariant (charter #1/#4; ADR-0029, D-052):** a bundle's `timeZone` is validated against the registry
its own `timeZoneDataVersion` names; `timeZoneDataVersion` is the map's key union, never `string`.

The prior companion could only assert that the shipped map's keys were its keys - with one registry,
"the recorded version selects the registry" and "there is one registry" are the same statement. It was
replaced by a probe over a CONSTRUCTED two-registry map. Making the selection version-blind (union
membership) failed:
```
× selects the registry a bundle RECORDS, proven on a constructed multi-registry map
AssertionError: expected true to be false // Object.is equality
```
The bundle-boundary half is unreachable today by construction (one registry ⇒ the union IS that
registry), so its emptiness is asserted rather than left implied. To prove that arm is not hollow, a
synthetic second registry was ADOPTED (adding `America/Nipigon`) - which is the map's documented growth
path - and the bundle's registry check removed. The same test failed on the now-live arm, then passed
again with the check restored. The version type is a COMPILE-TIME fence: reverting the key-union cast to
`[string, ...string[]]` makes the suppression an unused directive, so `pnpm typecheck` fails rather than
a runtime assertion passing vacuously:
```
src/__tests__/unit/decision-core.test.ts(346,5): error TS2578: Unused '@ts-expect-error' directive.
```
**Revert:** restored the union registry, the bundle check, and the key-union cast; typecheck and the full
suite pass (445 tests).

**Date:** 2026-07-27 (review corrections F58-F59, D-052).

### PF-027 extension · one tenant edge per execution step, checked once
**Invariant (charter #1/#4; ADR-0029, D-052):** a decision's execution plan belongs to the decision's
tenant - enforced by ONE record-level edge per step, not by re-walking references `execution.ts` has
already bound.

Collapsing the traversal must not weaken the fence, so the case only the record can see was added first:
an execution plan that is INTERNALLY coherent in `firm-b` inside a `firm-a` decision, which satisfies
every action and plan refinement. Removing the retained step-target check failed:
```
× enforces: approval and external-action references belong to the decision tenant recursively
AssertionError: expected true to be false // Object.is equality
```
Every pre-existing cross-tenant case (payload, reservation, precondition evidence, verification rule,
compensation target) still fails - one layer down, where the rule is stated once.
**Revert:** restored the check; the tenant-scope, external-action, and illegal-state fences pass.

**Date:** 2026-07-27 (review correction F60, D-052).

### PF-027 extension · the configuration boundary is release-scoped, and evidence chronology holds
**Invariant (charter #1/#4/#7; ADR-0029, D-053):** NEW `FIRM_TIMEZONE` configuration is validated
against the CURRENT release only; each release's `Link` table travels with its own `Zone` list; an
evidence snapshot cannot be retrieved before the observation it records.

With one shipped release the config boundary and the cross-release union are the SAME set, so both
timezone arms were proven on constructed conditions rather than on the shipped map alone.

Widening the config factory back to the union (`TimeZoneSchema`) failed on the constructed pair:
```
× holds NEW configuration to the CURRENT release, proven on a constructed two-release pair
AssertionError: expected true to be false // Object.is equality
  src/__tests__/unit/decision-core.test.ts:415  configuredTimeZoneSchema(newer).safeParse("America/Nipigon")
```
The SHIPPED half is unreachable today by construction (one release ⇒ union IS the current release), so
its emptiness is asserted rather than left implied. To prove that arm is not hollow, a synthetic older
release was ADOPTED - the map's documented growth path - and only `LinkResolvedTimeZoneSchema` widened
to the union, leaving the factory correct. The same test failed on the now-live arm:
```
AssertionError: expected true to be false // Object.is equality
  src/__tests__/unit/decision-core.test.ts:429  LinkResolvedTimeZoneSchema.safeParse(zone)
```
Resolving aliases through one un-versioned table instead of the release's own failed:
```
AssertionError: expected 'America/Toronto' to be 'America/Nipigon' // Object.is equality
  src/__tests__/unit/decision-core.test.ts:407  configuredTimeZoneSchema(older).parse("Canada/Eastern")
```
Removing the chronology guard failed, while its companion holds that equality and ordinary ordering
still parse - so the rejection is attributable to the inversion, not to a reject-everything schema:
```
× rejects an evidence snapshot retrieved BEFORE the observation it records
AssertionError: expected true to be false // Object.is equality
```
**Revert:** restored the release-scoped factories, the shipped current-release boundary, the per-release
alias table, and the chronology refinement; typecheck, lint, knip, and the full suite pass.

**Date:** 2026-07-27 (review corrections F62-F64, D-053).

## F65-F68 · decision-core review corrections (D-054)

**Invariants:** the configuration boundary refuses a `Zone` the runtime cannot format; the canonical
serializer's plain-object refusal stays reachable on the PRODUCTION preimage paths.

Removing the placeholder subtraction from `configuredTimeZoneSchema` (`timeZoneNameSchema(release.zones)`)
failed both new companions:
```
× refuses to BOOT on a zone the runtime cannot format, while still reading one that persisted
AssertionError: expected true to be false // Object.is equality
  src/__tests__/unit/decision-core.test.ts:453  LinkResolvedTimeZoneSchema.safeParse(placeholder)
× subtracts placeholders per RELEASE, after alias resolution
AssertionError: expected true to be false // Object.is equality
  src/__tests__/unit/decision-core.test.ts:487  configured.safeParse("Unset")
```
The second case is the general rule, proven on a CONSTRUCTED release: the shipped one has a single
placeholder and no alias pointing at it, so "subtracted per release, after resolution" would otherwise be
indistinguishable from "Factory is hardcoded somewhere". The completeness arm recorded here swept every
identifier the config boundary admits against host ICU; **F69 below replaces it** with a proof that is
deterministic from the pinned registry, and re-proves completeness adversarially.

Removing the prototype check from `normalizeOptionalProperties` (restoring the unconditional
`Object.fromEntries` rebuild) failed the reachability companion:
```
× keeps that refusal REACHABLE on the production preimage paths, not only on a direct call
AssertionError: expected true to be false // Object.is equality
  src/__tests__/unit/decision-core.test.ts:647  canonicalJson(bundleHashPreimage({...})).ok
```
That is the silent failure exactly: with the rebuild in place the `Date`/`Map`/class instance is
flattened to `{}` and the preimage hashes CLEANLY. The pre-existing direct-call test
(`canonicalJson(new Date())`) passes either way, which is why it could not detect this. The companion
carries its own control - the genuinely-`{}` payload still serializes - so the refusals are attributable
to the non-plain value, not to a reject-everything path, and the fixture digest assertion still
reproduces `bundle.bundleHash`.

**Revert:** restored the placeholder subtraction and the shared `isPlainObject` rule; typecheck, lint,
knip, build, v3:invariants, golden:validate, and the full 450-test suite pass, with all four fixture
digests unchanged.

**Date:** 2026-07-27 (review corrections F65-F68, D-054).

## F69-F70 · decision-core review corrections (D-055)

**Invariant:** the configuration boundary admits EXACTLY the pinned release minus its DECLARED
placeholder `Zone`s - proven deterministically from the registry, with no assertion whose result
varies with the host's bundled ICU/tzdata.

The replaced arm swept all 341 `Zone`s + 257 `Link`s through `Intl.DateTimeFormat` and required the
unformattable set to equal the declared list exactly, so a runtime older than the pin (the registry
carries `America/Coyhaique`, tzdata 2025a; `engines.node` is `>=20`) reddened the build with no code
change. Four independent injections were run against the replacement; each failed it:

```
1) placeholder left UNLISTED     IANA_TIME_ZONE_PLACEHOLDER_ZONES = []
   × refuses to BOOT on a declared placeholder zone, while still reading one that persisted
   AssertionError: expected [] to deeply equal [ 'Factory' ]   (decision-core.test.ts:456)

2) OVER-BROAD declaration        [..., "America/Toronto"]
   AssertionError: expected [ 'America/Toronto', 'Factory' ] to deeply equal [ 'Factory' ]

3) subtraction made a NO-OP      timeZoneNameSchema(release.zones)
   × refuses to BOOT ... / × subtracts placeholders per RELEASE, after alias resolution
   AssertionError: expected true to be false   (LinkResolvedTimeZoneSchema admits the placeholder)

4) OVER-BROAD subtraction        !placeholders.has(zone) && zone !== "America/Toronto"
   AssertionError: expected false to be true   (a real Zone the boundary must still admit)
```

Injection 3 was also run against the config suite, where the refusal is now proven through `getConfig()`
itself rather than only through the schema the boundary happens to use:
```
   × refuses a declared placeholder Zone even though it IS a pinned Zone name
   (bootWithTimezone("Factory") no longer throws /firmTimezone/)
```
Injections 3 and 4 are the ones the pinned-list assertions cannot see: they prove the admitted-set
loop itself is live in both directions - an unlisted placeholder still boots, an over-broad
subtraction refuses a real `Zone`. The CONSTRUCTED two-release companion is retained unchanged, so
"subtracted per release, after alias resolution" is still proven against a release that declares a
DIFFERENT placeholder with an alias pointing at it, and cannot pass if the handling were hardcoded to
`Factory`. `Factory` itself stays refused at the configuration boundary and parseable, hashable, and
digest-stable as an already-persisted bundle value.

**Revert:** restored `IANA_TIME_ZONE_PLACEHOLDER_ZONES` and `configuredTimeZoneSchema` after each
injection (`git diff` clean); typecheck, lint, knip, build, v3:invariants, golden:validate, and the
full suite pass, with all four fixture digests unchanged and contracts still at 2364/2400.

**Date:** 2026-07-27 (review corrections F69-F70, D-055).

## F71-F74 · decision-core review corrections (D-056)

**Invariants:** the dependency-rule `require` scan flags CommonJS loaders and only CommonJS loaders;
the configuration boundary admits an alias exactly when it admits that alias's target.

The `require` scan's cross-module false positive is latent - no shipped source contains a `require`
token - so it was proven against the new companion instead. Restoring the pre-fix scan (drop the
member-name-position skip, put `!isDeclaredLocally(receiver)` back on the element-access branch)
failed it:
```
× require-shaped members of values imported from ANOTHER module do not trip the fence
AssertionError: expected [ { …(5) }, { …(5) }, { …(5) }, …(2) ] to deeply equal []
  src/__tests__/fitness/dependency-rule.test.ts:464
```
Five violations, none CommonJS: `cfg.require("x")`, `cfg["require"]("x")`, `cfg.nested["require"]("x")`,
`const { require: renamed } = cfg`, and two accesses through a receiver typed `any`. The pre-existing
companion (`local.require("x")` declared in the file under test) passes either way, which is why it
could not detect this.

The opposite injection proves the narrowing did not go too far. Making the ambient-global arm return
`false` failed six tests, including four of the five ambient cases:
```
× a require member reached through an AMBIENT global still fails closed  (×4)
AssertionError: expected [] to include 'domain->unresolved'
  src/__tests__/fitness/dependency-rule.test.ts:484
× indirect CommonJS loaders fail closed  (module.require / module["require"], ×2)
```
The fifth ambient case (`const loader = module; loader.require(…)`) survived that injection because it
is caught by the OTHER arm - the member's own declaration being ambient - so the two arms are shown to
be independently live rather than one masking the other.

Four independent injections were run against the release-scoped placeholder proofs; each failed:
```
1) placeholder left UNLISTED    IANA_TIME_ZONE_PLACEHOLDER_ZONES = []
   AssertionError: expected [] to deeply equal [ 'Factory' ]            (decision-core.test.ts:462)

2) OVER-BROAD declaration       [..., "America/Toronto"]
   AssertionError: expected [ 'America/Toronto', 'Factory' ] to deeply equal [ 'Factory' ]

3) subtraction made a NO-OP     timeZoneNameSchema(release.zones)
   AssertionError: expected true to be false                            (decision-core.test.ts:468)

4) aliases BYPASS the subtraction (alias resolved against the UNFILTERED zone list)
   AssertionError: expected true to be false                            (decision-core.test.ts:500)
```
Injection 4 is the one the replaced `expect(placeholders.has(target)).toBe(false)` arm could not see:
the pinned release has no alias targeting a placeholder, so that arm was vacuous in its refusing
direction. Under injection 4 every earlier assertion in that test - review record, placeholder
refusal, admitted set, alias equivalence - still PASSES, and the only failure inside it is the
constructed alias-of-a-placeholder assertion at line 500, so the new arm is live on its own rather
than carried by a neighbour. (The separate constructed-release companion at line 517 catches injection
4 as well, which is the cross-check that the two are proving the same rule.) Injections 1 and 2
confirm the release-keyed review record still rejects both an unlisted and an over-broad placeholder
declaration, which is what the removed module-constant equality was doing.

**Revert:** restored `_fence-utils.ts`, `time-zone.ts`, and `IANA_TIME_ZONE_PLACEHOLDER_ZONES` after
each injection (`git diff` clean against the fixed tree); typecheck, lint, knip, build, v3:invariants,
golden:validate, and the full suite pass, with all four fixture digests unchanged, both registry pins
untouched, and contracts at 2360/2400.

**Date:** 2026-07-27 (review corrections F71-F74, D-056).

## F75-F83 · canonical decision-boundary review corrections (D-057)

**Invariants:** every hash-bound set has one duplicate-free canonical representation; both preimage
builders return structured cycle refusals; every direct decision-core scoped-reference collection is
registered with a tenant constraint; timezone refusals are bounded and release-correct; dependency
loaders cannot hide behind type erasure.

Replacing the shared string, scoped-reference, versioned-source, and precondition normalizers with
identity functions, and their uniqueness checks with unconditional success, failed 19 parameterized
companions. The failures covered permutation and duplicate inputs independently for all five
execution collections (`conflictKeys`, `reservationRefs`, `preconditions`,
`requiredEvidenceSnapshotRefs`, `dependsOn`) and both recursive explanation collections
(`evidenceSnapshotRefs`, `sourceRefs`). Restoring schema normalization but bypassing
`normalizeDecisionRecord` in `decisionHashPreimage` then failed all 11 defensive permutation arms:
the five step collections, the four collections also present on compensation, and both recursive
explanation collections.

Removing the ancestor check from optional-property normalization failed both production-path cycle
companions with host stack overflows:
```
× returns a circular-reference AppError through the bundle preimage path
RangeError: Maximum call stack size exceeded
× returns a circular-reference AppError through the decision preimage path
RangeError: Maximum call stack size exceeded
```

Adding `export const TenantFenceProbeSchema = z.array(SubjectRefSchema)` without registering a tenant
constraint failed the inventory companion with the exact new subject:
```
+ "trigger.ts:TenantFenceProbeSchema"
```
Removing only the `candidateRefs` same-tenant refinement failed the functional ambiguity companion
because the mixed `firm-a` / `firm-b` candidate set parsed successfully. The duplicate arm had
already failed under the shared-uniqueness injection above.

Two timezone injections failed independently. Replacing a constructed release's embedded version
with the global current version in the refusal path produced:
```
Expected: "iana-test/refusal"
Received: "\"Not/Test\" is not a Zone in iana-tzdb/2026b"
```
Removing the shared enum error formatter restored Zod's full 341-member option list, failed the
release-name assertion, and made the message exceed the bounded diagnostic contract. The retained
tests also exercise newline and Unicode line-separator removal plus non-string input through the same
formatter and through `getConfig()`.

Removing `AsExpression` from the general expression unwrapper and replacing provenance resolution
with a one-node unwrap failed both dependency companions:
```
× type-asserted node:module loaders cannot evade createRequire detection
AssertionError: expected [] to include 'domain->unresolved'
× an ambient module alias typed as any remains loader provenance
AssertionError: expected [] to include 'domain->unresolved'
```

Finally, the pre-amendment line-budget fence measured the review fix at 2727 and failed against 2400.
The final dependency-direction cleanup reduced the contracts layer to 2726; ADR-0029 now owns the
2800 ceiling with 74 measured lines of headroom. The
shared-normalization rationale is recorded separately from that measurement in D-057 and ADR-0029.

**Revert:** restored every injected defect after its focused failure. All recorded hash fixtures and
registry pins remain unchanged. Fitness (331), the full suite (488), Playwright (17), typecheck,
lint, knip, production build, v3:invariants, and golden:validate all pass.

**Date:** 2026-07-27 (review corrections F75-F83, D-057).

## F84-F91 · complete canonical boundary and fence indirection corrections (D-058)

**Invariants:** every parse-time canonical collection has the same preimage normalization; nested
non-plain objects still reach the canonical serializer refusal; timezone casing and refusal releases
are replay-correct; scoped-reference and dependency discovery follows ordinary syntax indirection;
standalone execution steps enforce compensation tenancy; contracts cannot access DOM globals.

Before the implementation changes, 13 focused companions failed. Permuting actor roles, specialist
roles, approval stages, eligible roles, escalation roles, and blocked evidence suppliers produced
different decision preimages. A lower-case accepted Zone produced a different bundle preimage from its
schema-canonical spelling. Nested class instances in an explanation and an execution step both parsed
through normalization into serializable plain objects instead of returning the expected refusal.
Parsing `ExecutionStepSchema` directly accepted a compensation target from another tenant.

The remaining three failures were dependency-fence bypasses. A destructured ambient loader and its
type-erased form produced no module reference:
```
const { require: load } = module;
load("@infra/store");

const erased: any = module;
const { require: erasedLoad } = erased;
erasedLoad("@infra/store");
```
A contract reference to `document.title` also produced no ES-only diagnostic because diagnostic 2584
was not selected. The focused suite passed only after the shared provenance and diagnostic authorities
covered all three cases.

The tenant inventory companions construct one added schema through each previously invisible form:
an alias of the scoped-reference factory, a `.readonly().array()` wrapper chain, and a composite strict
object. Each is discovered exactly as `probe.ts:AddedSchema`; replacing recursive provenance with direct-call-only discovery made all three
expectations empty and fail. The production inventory also contains `trigger.ts:candidateRefs`, so the ambiguity
collection that prompted the fence cannot disappear from the registry unnoticed.

A constructed two-release bundle schema accepts a Zone under the release that records it and refuses
the same Zone under the release that does not. Replacing the recorded version passed to the shared
formatter with the current release fails the companion because the diagnostic names the wrong release.

The final line-budget measurement is 3016/3100, with 84 lines of measured headroom. D-058 and ADR-0029
record the merit-based shared-normalization rationale separately from that measurement.

**Revert:** restored every incomplete form after its focused failure. All recorded hash fixtures and
registry pins remain unchanged. Fitness (338), the full suite (504), Playwright (17), typecheck, lint,
knip, production build, v3:invariants, golden:validate, and the 3016/3100 line-budget fence pass.

**Date:** 2026-07-27 (review corrections F84-F91, D-058).

## F92-F95 · semantic schema, release, traversal, and loader corrections (D-059)

**Invariants:** scoped-reference inventory follows the exported schema graph rather than source syntax;
release labels cannot separate from release data; valid explanation depth does not depend on the host
stack; destructured loaders retain provenance across computed and assignment forms.

The pre-fix production-boundary reproduction reported all four defects directly:
```
recommendation_cross_tenant_accepted true
detached_timezone_label_accepted true
deep_preimage_threw true Maximum call stack size exceeded
loader_violations 0
loader_violations 0
```

Adding an exported `z.record(z.string(), SubjectRefSchema)` without a registry entry failed the real
tenant inventory with the semantic schema identity:
```
+ "decision.ts:ProofOnlyScopedRecordSchema"
```
The continuous companions also build record and tuple containers through local wrapper factories. Both
are discovered as `probe.ts:AddedSchema`, so changing constructor spelling cannot make the inventory
forget the collection. The production inventory now names
`decision.ts:RecommendationSchema.parameters`.
Adding an unregistered `proof-only.ts` decision-core module failed the same exhaustive test before any
schema within that module could escape inspection:
```
+ "proof-only.ts"
```

Replacing the iterative explanation child task with a recursive
`normalizeExplanationNode(child)` call failed the 12,000-level production preimage companion:
```
× hashes a deeply nested acyclic decision without overflowing
RangeError: Maximum call stack size exceeded
```
The same companion traverses optional-property normalization, explanation normalization, and canonical
serialization in sequence. Existing production-path cycle companions still require the named
`circular reference` AppError, and nested explanation plus execution class instances still require the
`only plain objects` refusal.

Removing the duplicate embedded release-version guard failed the constructed multi-release companion:
```
× selects the registry a bundle RECORDS, proven on a constructed multi-registry map
AssertionError: expected [Function] to throw an error
```
The bundle schema factory accepts only inseparable release values and derives every enum label and
membership table from their embedded `dataVersion`.

Returning `null` for computed property names failed four companions, covering `require` and
`createRequire` through direct and type-erased receivers. Skipping assignment-destructuring provenance
failed four more:
```
× destructured ambient require provenance remains enforced: computed literal
× destructured ambient require provenance remains enforced: assignment
× destructured createRequire provenance remains enforced: computed literal
× destructured createRequire provenance remains enforced: assignment
```
The type-erased counterparts failed in the same injections. Both loader families use the same
destructured receiver-provenance collector.
Preferring a variable's initializer over its latest preceding assignment failed the reassigned-receiver
companions for both loader families:
```
× destructured ambient require provenance remains enforced: reassigned receiver
× destructured createRequire provenance remains enforced: reassigned receiver
```

**Revert:** every injected incomplete form was removed after its focused failure. The iterative
explanation normalizer was split into the shared normalization authority after the max-file-size fence
caught `decision.ts` at 505/500. The final contracts measurement is 3158/3200 with 42 measured lines of
headroom. All decision-core fixture files remain byte-identical and their recorded hashes reproduce
without a schema or preimage version change.

**Date:** 2026-07-27 (review corrections F92-F95, D-059).

## F96-F100 · behavioral tenant, standalone retry, tuple identity, parse depth, and loader-key corrections (D-060)

**Invariants:** every exported scoped-reference collection boundary has an executed mixed-tenant
refusal; standalone steps reject intrinsic retry hazards; scoped-reference identity is a collision-free
tuple; valid explanation depth does not depend on the host stack at parse; locally assigned loader
keys retain provenance.

The pre-fix production-boundary reproduction reported all five defects:
```
selfDependencyAccepted: true
reusedCompensationKeyAccepted: true
collisionAccepted: false
deepParse: RangeError
dependencyResults: [[],[]]
```
The collision refusal included `duplicate ambiguity candidate reference` for the distinct pairs
`("a", "\0b")` and `("a\0", "b")`.

Adding the former `Schema` suffix filter back to the runtime tenant inventory failed all three
completeness companions:
```
× detects an exported boundary without a Schema suffix
× detects an unconstrained wrapper that reuses a registered collection
× executes each probe instead of trusting its registry label
```
The production check inventories each exported Zod value independently, while the synthetic schemas
prove missing and behaviorally false registry entries are reported.

Disabling the two step-local refinements failed the direct-schema companions:
```
× enforces: standalone steps reject compensation idempotency-key aliasing
× enforces: standalone steps reject self-dependencies
```
Both companions parse `ExecutionStepSchema` directly, so a plan-level refusal cannot make them pass.

Restoring NUL-delimited uniqueness failed the tuple companion:
```
× uses collision-free tuple identity for scoped references
AssertionError: expected false to be true
```
The production helper now delegates identity to the same `(firmId, id)` comparator that owns canonical
ordering.

Routing `ExplanationNodeSchema` back through Zod's recursive runner failed the 12,000-level companion
at the production parse boundary:
```
× hashes a deeply nested acyclic decision without overflowing
RangeError: Maximum call stack size exceeded
```
The legal deep payload now passes through `DecisionRecordSchema.safeParse`, iterative tenant traversal,
preimage normalization, and canonical serialization. Existing cycle and non-plain-object refusals
remain production-path assertions.

Replacing shared property-key provenance with direct literal inspection failed the assigned-key
companions:
```
× destructured ambient require provenance remains enforced: assigned computed key
× destructured createRequire provenance remains enforced: assigned computed key
× assigned element-access loader keys remain enforced: ambient require
```
The resolver covers local literals and latest preceding simple assignments for destructuring and
element access. D-060 and ADR-0001 record the residual limit for runtime, conditional, and
configuration-derived keys with a Revisit-When.

**Revert:** every injected incomplete form was removed after its focused failure. The final contracts
measurement is 3412/3500 with 88 measured lines of headroom. All four decision-core fixture files
remain byte-identical to their pre-fix SHA-256 digests.

**Date:** 2026-07-27 (review corrections F96-F100, D-060).

---

## Prompt 6 - tenant, actor, PII, and secret boundaries (D-061)

**Numbering note (rebase):** these entries were authored as PF-027..PF-031 on the prompt-6 branch,
in parallel with prompt 5 claiming PF-027..PF-029 above. On rebase every prompt-6 proof id was
renumbered to continue the log monotonically from PF-030, so each PF id names exactly one proof;
in-branch references were rewritten in the same change. A proof id is never reused.

### PF-030 · tenant-context-required (sealed TenantContext on every repository/port call) · `src/__tests__/fitness/tenant-context-required.test.ts`
**Invariant (v3 §15.2, invariant 2; charter #7 — extends the org-id fence, never displaces it):** every
exported repository function taking the SQL layer (`SqlDb`/`SqlQueryable`/`SqlTx`) must also take the
sealed `TenantContext` (directly or inside a `WriteActor`), so a repository call without tenant scope
does not COMPILE; the runtime seal assert in the factories/adapters makes an impostor context fail to
PARSE. Escapes are exact-match `file :: function` entries (identity minting boundary, capability-keyed
loads, schema management), each with its reason; a stale-escape check fails on drift, and a port-shape
test pins `ExecutionStore.create/save/loadById` to `TenantContext` (with `loadByToken` pinned as THE
capability escape). Companions feed unscoped functions, arrow-declaration evasions, and a renamed
sibling of an escaped function.

**Injection + observed failure (verbatim), each reverted:**
```
# appended an unscoped exported repository function to house-crm.ts:
  × enforces: every exported repository function taking SqlDb also takes the sealed TenantContext (or is a reviewed escape)
    AssertionError: src/infrastructure/crm/house-crm.ts :: listAllHouseholdsUnscoped — takes (SqlDb)
    with no TenantContext/WriteActor: expected [ { …(2) } ] to deeply equal []
    ❯ src/__tests__/fitness/tenant-context-required.test.ts:95
# compile-level half ("missing tenant context cannot compile") — a literal TenantContext in wire.ts:
  src/infrastructure/wire.ts(133,7): error TS2741: Property '[TenantContextBrand]' is missing in type
  '{ orgId: string; }' but required in type 'TenantContext'.   [pnpm typecheck, exit 2]
```
**Revert:** removed both injections; fence file `Tests 10 passed`, `pnpm typecheck` clean. The parse-level
half (cast/spread/JSON impostors refused at runtime by the repository asserts) is locked by
`unit/tenant-context.test.ts` + `integration/tenant-isolation.test.ts` (cross-tenant reads return only
the caller's rows; impostors reject with `INTERNAL` before any SQL).

**Date:** 2026-07-26 (v3 build-sequence prompt 6 — tenant/actor/PII/secret boundaries).

### PF-031 · tokenized-factory-only (sealed security types) · `src/__tests__/fitness/tokenized-factory-only.test.ts`
**Invariant (v3 §15.1 normative comment, invariant 1; ratified in docs/v3/verin-core-contracts.ts):**
`Tokenized<T>`, `TenantContext`, and `ActionGrant` are constructible ONLY inside their factory modules
(`infrastructure/pii/tokenize.ts`, `contracts/tenant.ts`, `contracts/authz.ts`). Anywhere else, an
object literal or a cast (`as` / angle-bracket / `satisfies`) producing one of them fails the build —
`piiFree: true` proves nothing unless the scrubber minted it. ESLint mirrors the rule at edit time
(`noSealedTypeConstruction` in eslint.config.mjs); the fence is authoritative. A factory-liveness check
fails if a factory module stops constructing its type (a moved factory cannot leave the fence passing
vacuously — charter #4). Companions cover all three cast forms, the bare-literal impostor, and the
factory's own sanctioned cast.

**Injection + observed failure (verbatim), reverted:**
```
# appended a hand-built Tokenized (cast + literal) to wire.ts:
  × enforces: no cast or literal produces Tokenized / TenantContext / ActionGrant outside its factory module
    AssertionError: sealed-type constructions:
    src/infrastructure/wire.ts:257 — cast to sealed type 'import("@contracts/tokenized").Tokenized<string>' outside its factory
    src/infrastructure/wire.ts:257 — object literal with 'piiFree' outside the scrubber factory: expected [ …(2) ] to deeply equal []
```
**Revert:** restored wire.ts; fence file `Tests 9 passed`.

**Date:** 2026-07-26 (v3 build-sequence prompt 6).

### PF-032 · llm-pii-boundary (v3 INVARIANT 1: no PII-bearing type reachable from llm/) · `src/__tests__/fitness/llm-pii-boundary.test.ts`
**Invariant (v3 §15.1, invariant 1 — ACTIVATED by this PR):** the marked set is DERIVED (every
platform-layer interface with a raw PII-named field must extend `PIIBearing` or be one of six reviewed
machine-name escapes), and the transitive import closure of every file under `llm/` must contain no
module declaring a marked type — type-only imports count. Runtime half: the Tokenized factory scrubs by
construction and `parseMaskedLlmRequest` (the LLM adapter ingress gate) refuses unsealed impostors and
PII-shaped leaves (`unit/llm-boundary.test.ts`). Companions cover the direct import, the transitive
re-export laundering, the unmarked-interface floor, the Tokenized-typed exemption, and escape
exact-matching.

**Injection + observed failure (verbatim), each reverted:**
```
# imported the marked Contact entity from llm/projection.ts (type-only import):
  × enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it (invariant 1)
    AssertionError: PII-bearing types reachable from llm/:
    src/infrastructure/llm/projection.ts reaches PII-bearing module src/domain/schema/entities.ts
    (via import of '@domain/schema/entities' in src/infrastructure/llm/projection.ts): expected [ Array(1) ] to deeply equal []
# added an UNMARKED interface with a PII field to engine.ts (the derivation floor):
  × enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked (or a reviewed machine-name escape)
    AssertionError: unmarked PII-bearing types (extend PIIBearing or review into NON_PII_ESCAPES):
    src/domain/workflow/engine.ts :: SneakyClient.email: expected [ …(1) ] to deeply equal []
```
**Revert:** removed both injections; fence file `Tests 10 passed`. Registered as the mechanisms of v3
invariant 1 (now active) with `src/__tests__/fitness/tokenized-factory-only.test.ts`; `pnpm v3:invariants`
reports `3 active-pass · 0 active-fail`.

**Addendum (2026-07-26):** review hardening closed a derivation-floor gap - the marked set walked only
interfaces, so a `type Client = { firstName: string }` alias (or a class with PII-named fields) was
neither flagged nor treated as marked. `detectUnmarkedPIITypes`/`markedModules` now cover type-alias
object literals (direct and union/intersection members) and class declarations; escape semantics stay
exact-match. Re-proof, injected into `engine.ts` and reverted:
```
# added an UNMARKED type alias + class with PII fields (the extended derivation floor):
  × enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked (or a reviewed machine-name escape)
    AssertionError: unmarked PII-bearing types (extend PIIBearing or review into NON_PII_ESCAPES):
    src/domain/workflow/engine.ts :: SneakyAliasClient.email
    src/domain/workflow/engine.ts :: SneakyClassClient.phone: expected [ ...(2) ] to deeply equal []
```
Companions now also inject the alias evasion, the union-member evasion, the class evasion, and
marked-alias/marked-class reachability from llm/; fence file `Tests 15 passed`.

**Date:** 2026-07-26 (v3 build-sequence prompt 6).

### PF-033 · governed-actions (per-action authorization hooks) · `src/__tests__/fitness/governed-actions.test.ts`
**Invariant (v3 §15.3; charter #12 — extends route-level RBAC):** the `GOVERNED_ACTIONS` registry covers
exactly the seven §15.3 permission points (eight actions - policy drafting and approval are distinct);
separation of duties is pinned in the registry itself (compliance
authority — `policy.approve`, `decision.override`, `decision.approve` — never includes the IT-admin or
requesting-advisor roles, D-039); and every SURFACED action's route calls
`requireActionGrant(req, "<action>")` with the exact literal. `authorizeGovernedAction` refuses system
actors categorically and mints the sealed `ActionGrant` only for an allowlisted human role
(`unit/authz.test.ts`: unauthorized actors cannot approve or execute). Companions cover the unwired
route, the wrong-literal route, and the deleted-route-file case.

**Injection + observed failure (verbatim), reverted:**
```
# swapped the audit route's action literal to "pii.view":
  × enforces: every surfaced governed action is wired through requireActionGrant in its route
    AssertionError: unwired governed routes:
    src/app/api/audit/route.ts: no requireActionGrant(req, "audit.export") call: expected [ Array(1) ] to deeply equal []
```
**Revert:** restored the route; fence file `Tests 8 passed`.

**Date:** 2026-07-26 (v3 build-sequence prompt 6).

### PF-034 · secret containment (reveal-allowlist extension of the config-hygiene fence) · `src/__tests__/fitness/no-secret-fallback.test.ts`
**Invariant (v3 §15.4; charter #7/#15):** config secrets exist outside the config module only as
`SecretValue` wrappers — every serialization/coercion path (String, template interpolation, JSON.stringify
alone or nested, util.inspect, Object.entries/spread, exception-message interpolation) yields the
redaction sentinel (`unit/secret.test.ts`), so a secret cannot enter config dumps, the ledger, traces, or
exception text. Reading raw bytes is an explicit `.reveal()` call allowed ONLY in the two reviewed
HMAC consumers (session cookie signing, e-sign callback signing); a stale-allowlist check fails if an
allowlisted module stops revealing (charter #4). Companions cover the unsanctioned call, the commented
call, and the allowlisted call.

**Injection + observed failure (verbatim), reverted:**
```
# called getConfig().session.secret.reveal() from wire.ts:
  × enforces: .reveal() appears only in the reviewed secret-consumer modules (v3 §15.4)
    AssertionError: unsanctioned secret reveals:
    src/infrastructure/wire.ts:23: expected [ 'src/infrastructure/wire.ts:23' ] to deeply equal []
```
**Revert:** removed the injection; fence file green (all config-hygiene checks pass).

**Date:** 2026-07-26 (v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening (2026-07-26) - executed injection proofs

The review found real false-green paths in PF-030 through PF-034 and real
cross-tenant relationship gaps below the repository signatures. Each existing
rule was strengthened in place, with the following real-source violations
injected, observed, and reverted.

### PF-030 semantic repository coverage

The repository fence now resolves SQL and tenant types semantically, including
import aliases, inferred contextual parameters, nested options, and public
methods on exported database-bound classes. The exact capability escapes and
stale-escape checks remain.

```
# imported SqlDb as Database and added forbiddenAlias(db: Database) to house-crm.ts:
  × enforces: every exported SQL repository entry requires a sealed tenant context or exact escape
    AssertionError: src/infrastructure/crm/house-crm.ts :: forbiddenAlias - takes
    (import(".../src/infrastructure/store/db").SqlDb) with no sealed tenant context
    ❯ src/__tests__/fitness/tenant-context-required.test.ts:228
```

### PF-031 sealed construction and trusted mint boundaries

`Tokenized`, `TenantContext`, `ActionGrant`, and `Principal` now carry
compile-time brands. The semantic fence rejects aliased casts, contextual
shorthand literals, class implementations, and calls to identity/system minting
factories outside reviewed source and script boundaries.

```
# added a shorthand Tokenized literal to wire.ts:
  × enforces: sealed types are built only in their factory modules
    src/infrastructure/wire.ts:25 - object literal constructs sealed type 'Tokenized'
    src/infrastructure/wire.ts:25 - object literal with 'piiFree' outside the scrubber factory
    ❯ src/__tests__/fitness/tokenized-factory-only.test.ts:225
# called systemTenant from wire.ts:
  × enforces: identity and system minting factories are called only at reviewed boundaries
    src/infrastructure/wire.ts:9 - systemTenant referenced outside its reviewed boundary
    src/infrastructure/wire.ts:23 - systemTenant referenced outside its reviewed boundary
    ❯ src/__tests__/fitness/tokenized-factory-only.test.ts:250
```

### PF-032 raw projection exclusion and fail-closed tokenization

Raw evidence projection contracts now live under `infrastructure/pii`, not
`infrastructure/llm`. The derivation floor recognizes `requestText`, `rawText`,
and `evidence`; a marked declaration inside `llm/` is itself a violation.
Runtime tokenization rejects unresolved person-name and bare account-number
text after deterministic masking.

```
# declared ForbiddenRawRequest extends PIIBearing inside llm/request-schema.ts:
  × enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it
    src/infrastructure/llm/request-schema.ts declares a PII-bearing type inside llm/
    ❯ src/__tests__/fitness/llm-pii-boundary.test.ts:211
```

### PF-033 per-handler governed authorization

Every surfaced HTTP handler must bind the exact `requireActionGrant` call as
its first statement, fail closed on its result as the second statement, and
thread the authorized value into the route's exact governed sink.

```
# moved getDb() before authorization in the audit GET handler:
  × enforces: every surfaced governed action is wired through requireActionGrant in its route
    src/app/api/audit/route.ts :: GET: first statement must bind
    requireActionGrant(req, "audit.export")
    ❯ src/__tests__/fitness/governed-actions.test.ts:154
# kept a superficial tenant reference but removed it from verifyAndListOrgChain:
  × enforces: every surfaced governed action is wired through requireActionGrant in its route
    src/app/api/audit/route.ts :: GET: authorized value does not reach
    'verifyAndListOrgChain'
    ❯ src/__tests__/fitness/governed-actions.test.ts:182
```

### PF-034 semantic secret access

Secret bytes are held in a module-private `WeakMap`; the public object exposes
no raw accessor. The free `revealSecret` function is resolved semantically, so
an aliased call fails outside the two reviewed HMAC consumers. Companions also
prove computed and destructured access would fail if an accessor were
reintroduced.

```
# imported revealSecret as unwrap and called it from wire.ts:
  × enforces: raw secret access appears only in reviewed secret-consumer modules
    AssertionError: unsanctioned secret reveals:
    src/infrastructure/wire.ts:13
    src/infrastructure/wire.ts:25
    ❯ src/__tests__/fitness/no-secret-fallback.test.ts:233
```

### Tenant-qualified relationship constraints

Migration 3 adds tenant-qualified composite foreign keys for sessions,
household parents, contacts, financial accounts, applications, tasks, and user
references. The adapters and session boundary also verify ownership. Real
PGlite integration tests reject crossed relationships through both SQL and the
repository interface.

```
# removed contacts_household_org_fk from migration 3:
  × household references must belong to the row's org
    AssertionError: promise resolved "{ rows: [] }" instead of rejecting
    ❯ src/__tests__/integration/store-schema.test.ts:70
  × tenant-qualified parent relationships reject cross-tenant references
    AssertionError: expected true to be false
    ❯ src/__tests__/integration/tenant-isolation.test.ts:65
# removed sessions_user_org_fk from migration 3:
  × a session user must belong to the session org
    AssertionError: promise resolved "{ rows: [] }" instead of rejecting
    ❯ src/__tests__/integration/store-schema.test.ts:93
```

**Revert:** every injection above was removed. Full verification is green:
`pnpm test` (47 files, 412 tests), `pnpm test:e2e` (17 tests),
`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm knip`,
`pnpm v3:invariants`, `pnpm golden:validate`, and `pnpm load:smoke`.
The CI seed plus `pnpm audit:chain` also verified the migrated store.

**Date:** 2026-07-26 (review-fix round on v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening, round 2 (2026-07-26)

The second review found remaining false-green paths in PF-030 through PF-032.
Each strengthened rule was proven against a real-source injection. The
violations below were injected together, each fence was run independently, and
all injections were then reverted.

### PF-030 callable domain contracts

The tenant fence now discovers callable members and direct call signatures
semantically on every exported domain interface, regardless of the interface
name. The account-opening dependency contract and the generic flow-step
contract carry `TenantContext` on every call.

```
# removed TenantContext from AccountOpeningDeps.createHousehold:
  × enforces: every exported domain port method requires TenantContext unless capability-keyed
    AssertionError:
    src/domain/workflow/flows/account-opening.ts ::
    AccountOpeningDeps.createHousehold
    ❯ src/__tests__/fitness/tenant-context-required.test.ts:290
```

### PF-031 sealed actor and mask authority

`ActorRef` and `EntityMaskBinding` joined the sealed-type registry.
`tokenizeText`, `tokenizeRecord`, and `bindEntityMask` joined the semantic
trusted-factory callsite fence. Runtime authorization refuses an unsealed actor,
and only the projection boundary may construct LLM tokens.

```
# cast an object to ActorRef and called tokenizeText from wire.ts:
  × enforces: sealed types are built only in their factory modules
    src/infrastructure/wire.ts:264 - cast to sealed type 'ActorRef' outside its factory
    src/infrastructure/wire.ts:264 - object literal constructs sealed type 'ActorRef'
    ❯ src/__tests__/fitness/tokenized-factory-only.test.ts:278
  × enforces: identity and system minting factories are called only at reviewed boundaries
    src/infrastructure/wire.ts:22 - tokenizeText referenced outside its reviewed boundary
    src/infrastructure/wire.ts:266 - tokenizeText referenced outside its reviewed boundary
    ❯ src/__tests__/fitness/tokenized-factory-only.test.ts:282
```

### PF-032 callable PII reachability

The marker-completeness floor resolves the real `PIIBearing` and `Tokenized`
declarations semantically. It follows callable parameters, inline object
members, callable properties, direct call signatures, and return types.

```
# added an unmarked callable interface with a nested firstName parameter:
  × enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked
    src/infrastructure/pii/llm-projection.ts ::
    CallableLeak.persist(input).firstName
    ❯ src/__tests__/fitness/llm-pii-boundary.test.ts:367
```

**Revert:** removed the `ActorRef` cast, direct tokenization call, unscoped
dependency method, and callable PII leak. Focused unit, integration, and fence
tests passed after the revert.

**Date:** 2026-07-26 (second review-fix round on v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening, round 3 (2026-07-27)

The third review found five legitimate structural gaps. The tests below were
first added against the vulnerable implementation and failed. Each real-source
violation was then injected after the fix, observed, and reverted.

### PF-030 exported object repositories and non-interface ports

The tenant fence resolves exported repository values semantically, including
callable object members. Exported interfaces, type aliases, and classes under
the domain layer are inspected through the same callable-type path. Companions
cover object repositories, separately exported bindings, mapped function types,
and abstract classes.

```
# added unsafeRepository.listAll(db: SqlDb) to house-crm.ts:
  × enforces: every exported SQL repository entry requires a sealed tenant context or exact escape
    src/infrastructure/crm/house-crm.ts :: unsafeRepository.listAll
    SQL-backed callable has no sealed tenant context
    ❯ src/__tests__/fitness/tenant-context-required.test.ts:292
# before separately exported bindings were resolved:
  × flags separately exported repository object methods
    AssertionError: expected [] to have a length of 1 but got +0
    ❯ src/__tests__/fitness/tenant-context-required.test.ts:410
```

### PF-031 sealed write attribution

`WriteActor` is compile-time branded, runtime sealed, frozen, and asserted at
the audited-write chokepoint. Direct attribution must equal the actor retained
in its sealed tenant. Webhook and login-boundary attribution use the explicit,
callsite-fenced delegated factory.

```
# removed assertWriteActor(actor) from auditedWrite:
  × the write chokepoint refuses actor attribution paired with a borrowed tenant
    AssertionError: promise resolved "{ ok: true, value: ... }" instead of rejecting
    ❯ src/__tests__/integration/tenant-isolation.test.ts:113
# before the runtime seals used factory-identity registries:
  × a caller cannot elevate a sealed principal by fabricating an actor role
    AssertionError: expected true to be false
    ❯ src/__tests__/unit/authz.test.ts:76
  × cannot compile or parse from a literal
    AssertionError: expected true to be false
    ❯ src/__tests__/unit/tenant-context.test.ts:92
```

### PF-032 mapped aliases and persisted workflow PII

The PII fence inspects resolved alias properties across mapped, union, and
intersection types, while excluding primitive-library members. Workflow data,
persisted execution state, and returned flow state retain `PIIBearing`
explicitly.

```
# added type UnsafeMappedContact = Record<"email", string> to engine.ts:
  × enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked
    src/domain/workflow/engine.ts :: UnsafeMappedContact.email
    ❯ src/__tests__/fitness/llm-pii-boundary.test.ts:379
# removed PIIBearing from ExecutionState:
  × enforces: persisted workflow state retains the PII-bearing marker
    AssertionError: ExecutionState must retain PIIBearing
    ❯ src/__tests__/fitness/llm-pii-boundary.test.ts:406
# before Tokenized and entity-binding seals used factory-identity registries:
  × a structural impostor literal is NOT sealed
    AssertionError: expected true to be false
    ❯ src/__tests__/unit/llm-boundary.test.ts:64
  × rejects a prototype clone of a trusted entity binding
    AssertionError: expected true to be false
    ❯ src/__tests__/unit/llm-boundary.test.ts:123
```

### PF-033 action-scoped execution boundary

The account-opening execution API accepts only an
`ActionGrant<"execution.initiate">`, validates the runtime action seal before
work, and derives tenant and write actor from that grant.

```
# removed assertActionGrant(grant, "execution.initiate") from startAccountOpening:
  × refuses a sealed Principal without an execution.initiate grant at the execution boundary
    AssertionError: expected TypeError ... to match object { code: "FORBIDDEN" }
    ❯ src/__tests__/integration/account-opening.test.ts:41
```

**Revert:** every planted violation was removed. Focused validation passed:
10 files and 123 tests across the affected fences, unit tests, and integration
paths.

**Date:** 2026-07-27 (third review-fix round on v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening, round 4 (2026-07-27)

The fourth review exposed five remaining false-green classes and two runtime
failures. The runtime tests were added first and failed against the vulnerable
implementation. Each fence was then proven with a real-source injection and
every injection was reverted.

### Account-opening failed-finalize recovery

A real PGlite flow suspended at e-sign, failed while
`financial_accounts` was unavailable, restored the table, and resubmitted the
identical client request with its original human grant.

```
× a human resubmit recovers a failed webhook finalization after the dependency returns
  AssertionError: expected 'failed' to be 'completed'
  ❯ src/__tests__/integration/account-opening.test.ts:183
```

The matching direct human actor now resumes the saved cursor. The webhook path
still delegates from `esign-webhook`, and the recovered flow proves one account
plus a valid audit chain.

### Canonical opaque LLM slot ids

The adapter previously accepted `Alice` as a slot label. The companion failed
before the schema moved to generated `slot_0001` style ids.

```
× refuses free-text slot names and unknown purposes/slot types
  AssertionError: expected true to be false
  ❯ src/__tests__/unit/llm-boundary.test.ts:101
```

### PF-030 closed repository callable classification

An exported `unsafeListHouseholds()` was planted in `house-crm.ts`. It obtained
`getDb()` internally and exposed no SQL type or tenant parameter.

```
× enforces: every exported SQL repository entry requires a sealed tenant context or exact escape
  src/infrastructure/crm/house-crm.ts :: unsafeListHouseholds
  repository callable has no sealed tenant context
  ❯ src/__tests__/fitness/tenant-context-required.test.ts:312
```

### PF-032 recursive PII and unverifiable LLM loads

`contracts/result.ts` received an exported nested email envelope and an
exported callable with an inline first name. The live LLM schema also received
a computed dynamic import.

```
× enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked
  src/contracts/result.ts :: UnsafeEnvelope.payload.email
  ❯ src/__tests__/fitness/llm-pii-boundary.test.ts:556
× enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it
  src/infrastructure/llm/request-schema.ts reaches an unverifiable module load
  in src/infrastructure/llm/request-schema.ts:100
  src/infrastructure/llm/request-schema.ts reaches PII-bearing module
  src/contracts/result.ts
  ❯ src/__tests__/fitness/llm-pii-boundary.test.ts:594
```

### PF-033 derived governed surfaces and semantic helpers

A new audit route called `verifyAndListOrgChain` without registration or action
authorization. A second injection replaced the real helper import in the live
audit route with a same-named local function.

```
× enforces: every surfaced governed action is wired through requireActionGrant in its route
  src/app/api/unsafe-audit/route.ts :: GET: first statement must bind
  requireActionGrant(req, "audit.export")
  ❯ src/__tests__/fitness/governed-actions.test.ts:319
× enforces: every surfaced governed action is wired through requireActionGrant in its route
  src/app/api/audit/route.ts :: GET: first statement must bind
  requireActionGrant(req, "audit.export")
  ❯ src/__tests__/fitness/governed-actions.test.ts:319
```

### PF-034 exact HMAC secret consumption

The reviewed session-signing function was changed to assign revealed bytes to a
local variable before forwarding them. File and function names still matched,
but the exact-sink fence rejected the laundering step.

```
× enforces: raw secret access appears only in reviewed secret-consumer modules
  src/infrastructure/identity/session.ts:37
  ❯ src/__tests__/fitness/no-secret-fallback.test.ts:272
```

**Revert:** every planted source violation was removed. The seven affected
files passed 121 focused tests after the revert, followed by type checking and
lint. Full validation also passed 447 repository tests, 17 Playwright tests,
the production build with explicit CI-only secrets, Knip, all active v3
invariants, all 16 golden cases, the load budget, audit-chain verification,
the license audit, and the high-severity dependency audit.

**Date:** 2026-07-27 (fourth review-fix round on v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening, round 5 (2026-07-27)

All six findings reproduced against the vulnerable implementation before the
fixes. Seven focused companion and integration assertions failed, covering the
incomplete entity set, reflected tenant and secret access, an unguarded PII
read, repository coverage outside known directories, exported function-valued
ports, and `.js` to `.ts` LLM import substitution.

### Complete trusted sensitive-entity set

The projection boundary now accepts a single factory-sealed
`CompleteEntityMaskSet`. Sensitive slots and bindings must match exactly. Every
trusted raw value is masked in request and evidence, the result is checked for
residual occurrences, and unresolved embedded proper names fail closed.

```
# before the complete-set boundary:
× refuses an incomplete trusted binding set that leaves other names unresolved
  AssertionError: expected true to be false
  src/__tests__/unit/llm-boundary.test.ts:298
```

### PF-031 privileged factory module confinement

Factory references are still resolved semantically. In addition, namespace
imports, re-exports, dynamic module access, and unverifiable module loads are
rejected for every privileged factory module.

```
# planted a namespace import and Reflect.get(..., "systemTenant") in wire.ts:
× enforces: identity and system minting factories are called only at reviewed boundaries
  src/infrastructure/wire.ts:7 - privileged factory module namespace exposes
  tenantFromIdentity, systemTenant
  src/__tests__/fitness/tokenized-factory-only.test.ts:393
```

### PF-034 secret module confinement

`revealSecret` remains usable only as the direct key argument of the two exact
HMAC consumers. Loading its module as a namespace, re-exporting it, or reaching
it through dynamic module access is rejected before reflective access can
launder the symbol.

```
# planted a namespace import and Reflect.get(..., "revealSecret") in esign.ts:
× enforces: raw secret access appears only in reviewed secret-consumer modules
  src/infrastructure/esign/esign.ts:9
  src/__tests__/fitness/no-secret-fallback.test.ts:328
```

### PF-033 action grants at governed sinks

Every registered governed sink requires an action-parameterized `ActionGrant`
and validates it as its first statement. Raw PII reads and audit-row exports
derive tenant scope from the validated grant. A helper outside a route can no
longer turn an ordinary tenant context into governed access. The companion also
rejects an assertion hidden inside a conditional first statement.

```
# removed the runtime grant assertion from listHouseholds:
× enforces: governed sinks validate action-scoped grants at their execution boundaries
  src/infrastructure/crm/house-crm.ts :: listHouseholds:
  first statement must assert ActionGrant<"pii.view">
  src/__tests__/fitness/governed-actions.test.ts:403
# before the sink signature changed:
× a tenant context alone cannot invoke the governed PII read sink
  AssertionError: promise resolved instead of rejecting
  src/__tests__/integration/tenant-isolation.test.ts:52
```

### PF-030 semantic repository and port coverage

Repository modules are derived from the transitive infrastructure SQL import
graph, including literal dynamic loads and conservative rejection of
unverifiable loads. Exported domain functions and function-valued variables
join interfaces, aliases, classes, and object callables under the port check.
The companion covers both a new transitive adapter directory and a repository
that imports the SQL driver directly.

```
# planted an unscoped exported SQL callable in wire.ts:
× enforces: every exported SQL repository entry requires a sealed tenant context or exact escape
  src/infrastructure/wire.ts :: unsafeSqlProbe
  repository callable has no sealed tenant context
  src/__tests__/fitness/tenant-context-required.test.ts:369
# before coverage was semantic across directories and callable forms:
× flags SQL-backed repositories outside the established adapter directories
× flags exported function and function-valued variable port forms
  src/__tests__/fitness/tenant-context-required.test.ts:411
  src/__tests__/fitness/tenant-context-required.test.ts:573
```

### PF-032 TypeScript module resolution for LLM reachability

Import reachability now uses `ts.resolveModuleName` with the project's compiler
options and module-resolution host. Bundler-compatible `.js` specifiers resolve
to their actual `.ts` source declarations.

```
# planted import type { Contact } from "../../domain/schema/entities.js":
× enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it
  src/infrastructure/llm/request-schema.ts reaches PII-bearing module
  src/domain/schema/entities.ts
  via import of '../../domain/schema/entities.js'
  src/__tests__/fitness/llm-pii-boundary.test.ts:587
# before compiler resolution:
× resolves JavaScript import specifiers through TypeScript extension substitution
  AssertionError: expected null to be 'src/domain/contact.ts'
  src/__tests__/fitness/llm-pii-boundary.test.ts:815
```

**Revert:** every planted source violation was removed. The eight affected
focused files passed 137 tests after the revert, together with type checking.
Final validation passed type checking, lint, Knip, all 458 repository tests,
all 17 Playwright and axe checks against the production build, all active v3
invariants, all 16 golden cases, the load budget, audit-chain verification, the
license audit, and the high-severity dependency audit.

**Date:** 2026-07-27 (fifth review-fix round on v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening, round 6 (2026-07-27)

All five findings reproduced before the fixes. The affected runtime and fitness
checks were then proven against fresh source injections, and every injection
was reverted.

### Complete resolved-entity validation and evidence-key scanning

The public completeness seal was removed. Projection now validates resolved
values against slot kinds and the entire request-plus-evidence payload, then
admits only a closed residual vocabulary after tokenization. Three source
injections separately admitted an innocuous subject binding, admitted a
lowercase name into the residual vocabulary, and removed object-key traversal.

```
# allowed "account" as a subject binding and "Alice" as safe residual text:
× refuses an innocuous subject binding that leaves a leading name unresolved
  AssertionError: expected true to be false
  src/__tests__/unit/llm-boundary.test.ts:305
# admitted "alice" into the closed residual vocabulary:
× refuses an omitted lowercase entity outside the closed residual vocabulary
  AssertionError: expected true to be false
  src/__tests__/unit/llm-boundary.test.ts:305
# changed residual scans from Object.entries to Object.values:
× refuses resolved entity values retained in evidence keys
  AssertionError: expected true to be false
  src/__tests__/unit/llm-boundary.test.ts:319
```

### PF-031 exact privileged factory consumers

An exported wrapper around `systemTenant` was planted in the already reviewed
audit-store module. The function-scoped allowance rejected the new owner.

```
× enforces: identity and system minting factories are called only at reviewed boundaries
  src/infrastructure/audit/audit-store.ts:364 - systemTenant referenced outside
  its reviewed boundary (unsafeTenantWrapper)
  src/__tests__/fitness/tokenized-factory-only.test.ts:408
```

### PF-033 semantically derived governed sinks

An exported tenant-only audit query returning action-marked chain rows was
planted without adding any registry entry.

```
× enforces: governed sinks validate action-scoped grants at their execution boundaries
  src/infrastructure/audit/audit-store.ts :: unsafeAuditExport:
  boundary must require ActionGrant<"audit.export">
  src/__tests__/fitness/governed-actions.test.ts:544
```

### PF-030 runtime tenant authority at repository entry

The direct `assertWriteActor(a)` call was removed from `createHousehold` while
its typed WriteActor parameter and audited-write delegation remained intact.

```
× enforces: every exported SQL repository entry requires a sealed tenant context or exact escape
  src/infrastructure/crm/house-crm.ts :: createHousehold -
  repository callable does not assert its sealed tenant authority before SQL access
  src/__tests__/fitness/tenant-context-required.test.ts:499
```

**Revert:** every planted violation was removed. The four focused files passed
81 tests after the reverts. Final validation passed type checking, lint, Knip,
all 464 repository tests, all 17 Playwright and axe checks against the
production build, all active v3 invariants, all 16 golden cases, the load
budget, audit-chain verification, the license audit, and the high-severity
dependency audit.

**Date:** 2026-07-27 (sixth review-fix round on v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening, round 7 (2026-07-27)

All five findings reproduced against the vulnerable implementation. Seven new
runtime and companion assertions failed before the fixes. Three fresh source
injections then proved the hardened tenant, governed-action, and LLM
reachability fences.

### Complete deterministic sensitive-entity resolution

Projection no longer accepts `resolvedEntities`. The domain resolver derives
subjects and account references from the complete request and evidence
payload, matches them exactly to sensitive slots, and the projection scans
every key and primitive leaf after masking.

```
# before caller-provided bindings were removed:
× refuses an account binding that leaves a resolver-ambiguous person name
  AssertionError: expected true to be false
  src/__tests__/unit/llm-boundary.test.ts:307
× refuses unclassified numeric evidence leaves
  AssertionError: expected true to be false
  src/__tests__/unit/llm-boundary.test.ts:321
```

### Closed observability strings

Log fields, log messages, trace attributes, and trace names now admit only
field-specific operational values. Everything else maps to a static sentinel.

```
# before the closed observability vocabulary:
× the production logger rejects single names under generic keys
  expected output not to contain "Alice"
  src/__tests__/integration/pii-observability.test.ts:82
× generic trace keys cannot carry single names
  expected "Alice" to be "[REDACTED]"
  src/__tests__/integration/pii-observability.test.ts:166
```

### PF-030 factory-returned repository guards

The direct `assertTenantContext(tenant)` call was removed from the real
`makeExecutionStore().loadById` implementation. The factory remained reviewed
and the domain port signature remained scoped.

```
× enforces: every exported SQL repository entry requires a sealed tenant context or exact escape
  src/infrastructure/store/execution-store.ts :: makeExecutionStore.loadById
  repository callable does not assert its sealed tenant authority before SQL access
  src/__tests__/fitness/tenant-context-required.test.ts:563
```

### PF-033 governed callable forms

An exported arrow returning `Promise<Household[]>` and accepting only
`TenantContext` was planted in the real house-CRM adapter.

```
× enforces: governed sinks validate action-scoped grants at their execution boundaries
  src/infrastructure/crm/house-crm.ts :: unsafeHouseholdRead:
  boundary must require ActionGrant<"pii.view">
  src/__tests__/fitness/governed-actions.test.ts:660
```

### PF-032 unwrapped opaque LLM exports

An exported `unsafeOpaque(): unknown` was planted in the scrub module already
reachable from `infrastructure/llm`.

```
× enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it
  src/infrastructure/llm/request-schema.ts reaches unverifiable opaque export
  src/infrastructure/pii/scrub.ts :: unsafeOpaque.return
  src/__tests__/fitness/llm-pii-boundary.test.ts:730
```

**Revert:** every planted source violation was removed. Final validation passed
type checking, lint, Knip, all 475 repository tests, all 17 Playwright and axe
checks, the production build, all active v3 invariants, all 16 golden cases,
the load budget, audit-chain verification, the license audit, and the
high-severity dependency audit.

**Date:** 2026-07-27 (seventh review-fix round on v3 build-sequence prompt 6).

## Prompt-6 security-boundary review hardening, round 8 (2026-07-27)

All seven findings reproduced against the vulnerable implementation. Seven new
runtime and in-memory source companions failed before the fixes, then passed
after the boundary and fence changes.

### Trusted LLM evidence schema

A sensitive-length account number was placed under the previously trusted
`plannedWithdrawals` key. The projection accepted and sealed it before numeric
classification became key-independent and masked evidence gained a closed
schema.

```
× refuses sensitive-length numbers under an otherwise safe evidence key
  AssertionError: expected true to be false
  src/__tests__/unit/llm-boundary.test.ts:273
```

### Sealed observability identifiers

An action-shaped client name and an account number were sent under fields the
old regex allowlist trusted. Both appeared in the production log output before
actions became closed values and identifiers required runtime-sealed,
field-bound wrappers.

```
× closed semantic fields reject name and account-number smuggling
  expected output not to contain "alice"
  received action="alice", entityId="941000517334"
  src/__tests__/integration/pii-observability.test.ts:87
```

### PF-034 secret declaration-module confinement

An exported function inside `contracts/secret.ts` returned
`revealSecret(value)`. The prior scan skipped the declaration module.

```
× rejects a reveal wrapper exported by the secret declaration module
  AssertionError: expected 0 to be greater than 0
  src/__tests__/fitness/no-secret-fallback.test.ts:447
```

### PF-031 privileged factory declaration-module confinement

Wrappers around `systemTenant`, `systemWriteActor`, and `tokenizeText` were
exported from their own declaration modules. The previous reviewed-callsite
check exempted those modules.

```
× catches privileged result wrappers exported by factory declaration modules
  AssertionError: systemTenant: expected false to be true
  src/__tests__/fitness/tokenized-factory-only.test.ts:663
```

### PF-030, PF-033, and PF-032 transparent-wrapper coverage

Three in-memory source injections wrapped callable objects in `Object.freeze`.
The tenant fence missed an unguarded returned repository method, the governed
fence missed a PII-returning sink, and the LLM fence missed an `unknown` return.

```
× flags an unguarded method returned through Object.freeze
  expected one runtime-guard violation, received none
  src/__tests__/fitness/tenant-context-required.test.ts:828
× derives PII read sinks from objects wrapped in Object.freeze
  expected one ActionGrant violation, received none
  src/__tests__/fitness/governed-actions.test.ts:880
× rejects opaque callable objects wrapped in Object.freeze
  AssertionError: expected false to be true
  src/__tests__/fitness/llm-pii-boundary.test.ts:984
```

**Revert:** every planted source fixture was in-memory and discarded after its
companion. The seven focused files passed 151 tests after hardening. Type
checking, lint, all 329 fitness assertions, all 484 unit and integration tests,
Knip, the production build, all 17 Playwright journeys, load smoke, the v3
invariant report, and all 16 signed golden cases also passed.

**Date:** 2026-07-27 (eighth review-fix round on v3 build-sequence prompt 6).

## Round 9 — derived observability vocabulary, structural resolution, boundary-honest fences

### PF-035 observability-vocabulary drift (NEW fence)

`withSpan("flow.account-opening.resume", …)` was renamed to
`…reopen` and the "security-event audit could not be recorded" log message was
reworded, both in `src/infrastructure/wire.ts`. Before this fence existed both
values silently degraded to `"operation"` / `"log event"` at runtime with a
green build.

```
× enforces: the production vocabulary matches the shipped call sites exactly
  unregistered span name "flow.account-opening.reopen" — it would be emitted as "operation"
  stale span name "flow.account-opening.resume" — no shipped call site emits it
  unregistered log message "security-event audit was not recorded" — it would be emitted as "log event"
  stale log message "security-event audit could not be recorded" — no shipped call site emits it
  src/__tests__/fitness/observability-vocabulary.test.ts:218
```

### PF-036 test-only span vocabulary cannot leak into production

`registerTestSpanName("test.sneaky")` was called from `src/infrastructure/wire.ts`.

```
× enforces: the test-only injection point has no shipped caller
  src/infrastructure/wire.ts:33 references registerTestSpanName
  src/__tests__/fitness/observability-vocabulary.test.ts:229
```

### PF-037 governed-sink mutation classified from SQL, not from text

`listContacts(db, actor): Promise<Contact[]>` was appended to
`src/infrastructure/crm/house-crm.ts` containing the comment
`// nothing to update here` and `const update = false`. The previous text regex
matched that word and dropped the PII read out of sink derivation entirely.

```
× enforces: governed sinks validate action-scoped grants at their execution boundaries
  src/infrastructure/crm/house-crm.ts :: listContacts: boundary must require ActionGrant<"pii.view">
  src/__tests__/fitness/governed-actions.test.ts:697
```

### PF-038 an LLM escape is keyed on the full dotted path

`readonly client: { name: string }` was added to `FlowDefinition`
(`src/domain/workflow/engine.ts`). Keying the escape on the property's nearest
ancestor let the reviewed `FlowDefinition.name` entry cover a raw client name
inside an inline nested type literal.

```
× enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked
  src/domain/workflow/engine.ts :: FlowDefinition.client.name
  src/__tests__/fitness/llm-pii-boundary.test.ts:701
```

### PF-039 config-hygiene corpus non-vacuity

`SKIP_DIRS` was widened with `"src"` and `"docs"`, collapsing the scanned
corpus. Both detectors previously compared `[] === []` and passed.

```
× enforces: the scanned corpus is real (a collapsed corpus would pass vacuously — charter #4)
  corpus is missing src/infrastructure/config/index.ts
  src/__tests__/fitness/no-secret-fallback.test.ts:355
```

### PF-040 sealed-type ESLint mirror covers the whole pii/ tree except the factory

`export const impostor = { value: "x", piiFree: true } as unknown as Tokenized<string>`
was added to `src/infrastructure/pii/llm-projection.ts`. The override previously
disabled `no-restricted-syntax` for all of `src/infrastructure/pii/**`, so this
cast had no edit-time guard.

```
src/infrastructure/pii/llm-projection.ts
  14:39  error  Sealed type: construct via its factory … no-restricted-syntax
  14:69  error  Sealed type: construct via its factory … no-restricted-syntax
✖ 2 problems (2 errors, 0 warnings)
```

### PF-041 uppercase-hex request id no longer aborts a committed flow

The opaque-id pattern was reverted to its case-SENSITIVE form. The
account-opening flow committed its household/contact/application writes and then
threw out of the "flow started" log line — the unenveloped 500 the surrounding
code documents as impossible.

```
× an UPPERCASE-hex client request id … completes instead of throwing after its writes commit
  Unknown Error: Observability executionId identifiers must be opaque.
  src/__tests__/integration/account-opening.test.ts
```

**Revert:** every planted change was reverted immediately after capturing the
failure (the two source injections were restored from a copy; `git diff` on
`src/infrastructure/wire.ts`, `src/infrastructure/crm/house-crm.ts`,
`src/domain/workflow/engine.ts`, `src/infrastructure/pii/llm-projection.ts`, and
`src/__tests__/fitness/no-secret-fallback.test.ts` was empty afterwards).

**Date:** 2026-07-27 (ninth review-fix round on v3 build-sequence prompt 6).

## Round 10 — leading-name binding, aligned account shape, semantic vocabulary fence

### PF-042 a MULTI-word name that opens the prose is bound whole

`proseSubjectCandidates` was reverted to dropping the first word of ANY
leading title-case run (`words.shift()`), the rule that let a given name reach a
model raw while its surname was masked.

```
× binds a MULTI-word name that OPENS the prose whole, never just its surname
  AssertionError: expected 'Adaeze {{slot_0001}} wants to open an…'
    to be '{{slot_0001}} wants to open an account'
  src/__tests__/unit/llm-boundary.test.ts
```

### PF-043 account candidates are exactly the runs the residual check refuses

`accountCandidates` was reverted to `\b\d{3,18}\b` over currency-stripped text
behind a whole-string `looksLikePIIValue` early return. A year then demanded an
account-ref slot, and a 9-18 digit run alongside a phone number produced a
refusal no caller could satisfy.

```
× an account-ref candidate is EXACTLY what the residual check refuses (9-18 digits)
  AssertionError: expected false to be true
  src/__tests__/unit/llm-boundary.test.ts
```

### PF-044 a mixed-case request id cannot abort a committed flow

The lowercase canonicalization AND the pre-write `observabilityId` proof were
both removed from `startAccountOpening`. A mixed-case UUID (the route's shape
check is case-insensitive) committed its household/contact/application writes and
then threw out of the "flow started" log line — `NAME_SHAPED_RE` reads the
`[A-F][a-f]` adjacency of hex as a person name.

```
× a MIXED-case client request id … completes instead of throwing after its writes commit
× a request id that could never be logged is refused BEFORE any write commits
  Unknown Error: Observability executionId identifiers must be opaque.
  src/__tests__/integration/account-opening.test.ts
```

### PF-045 the test-only injection point is keyed semantically, not by text

The `identifier.getText() !== TEST_INJECTION_POINT` pre-filter was restored ahead
of `resolvesTo`, so shipped code importing the injection point under an alias
(`import { registerTestSpanName as reg }` … `reg("test.sneaky")`) was invisible
to the fence.

```
× catches an ALIASED call to the test-only injection point
  AssertionError: expected [] to deeply equal [ Array(1) ]
  src/__tests__/fitness/observability-vocabulary.test.ts
```

### PF-046 a hoisted message/span constant is checked like an inline literal

`literalText` was reverted to syntax-only matching. `const SPAN = "…"` /
`const MSG = "…"` call sites then produced no vocabulary entry and no
dynamic-identity violation — the exact silent degradation the fence exists to
prevent.

```
× checks a HOISTED span name and log message constant like an inline literal
  AssertionError: expected [] to deeply equal [ 'crm.household.archive' ]
  src/__tests__/fitness/observability-vocabulary.test.ts
```

**Revert:** every planted change was reverted immediately after capturing the
failure (each edited file was restored from a copy taken before the injection;
`git diff` against the restored copies of `src/domain/pii/projection-resolution.ts`,
`src/infrastructure/wire.ts`, and
`src/__tests__/fitness/observability-vocabulary.test.ts` was empty afterwards,
and the full suite is green again).

**Date:** 2026-07-27 (tenth review-fix round on v3 build-sequence prompt 6).

## Round 11 — sealed-type laundering, governed-sink derivation, observability enums

### PF-047 a sub-interface that merely EXTENDS a sealed type is still a mint

`sealedType()`'s BFS was reverted to walking alias/type arguments and
union/intersection members but NOT base types (the shape the sibling
`declaredAs()` in llm-pii-boundary already walked). `interface AnyTenant extends
TenantContext {}` is a different symbol with a different name, so a cast to it
resolved to nothing and passed both the fence and the ESLint mirror.

```
× catches a cast to a sub-interface that merely EXTENDS a sealed type
  AssertionError: expected false to be true
  src/__tests__/fitness/tokenized-factory-only.test.ts
```

### PF-048 the ESLint mirror seals every type the fence seals

`SEALED_TYPES` was narrowed back to the original four
(`Tokenized|TenantContext|ActionGrant|Principal`). A planted
`src/app/api/_evil-proof.ts` casting `body as unknown as WriteActor` — the type
carrying write attribution and tenant scope — then linted CLEAN, while the same
file is reported by ESLint under the seven-type mirror. The fence's own
mirror-agreement assertion catches the divergence that made it possible.

```
$ npx eslint src/app/api/_evil-proof.ts     # 7-type mirror
  3:29  error  Sealed type: construct via its factory …  no-restricted-syntax
$ npx eslint src/app/api/_evil-proof.ts     # 4-type mirror
  (clean)

× enforces: the ESLint edit-time mirror seals exactly the same types and factories
× enforces: sealed types are built only in their factory modules
  src/__tests__/fitness/tokenized-factory-only.test.ts
```

### PF-049 shipped code cannot widen production authority, even through an alias

`src/infrastructure/crm/_evil-proof.ts` was planted with
`import { registerTestSystemActor as reg } … systemTenant(reg("test"), orgId)`,
the aliased form that defeated the observability equivalent in round 10.

```
× enforces: the test-only authority injection point has no shipped caller
  + "src/infrastructure/crm/_evil-proof.ts:2 references registerTestSystemActor"
  src/__tests__/fitness/tokenized-factory-only.test.ts
```

### PF-050 a `FOR UPDATE` row lock does not exempt a PII read

`SQL_MUTATION_RE` was reverted to the unanchored `/\b(?:INSERT\s+INTO|UPDATE|
DELETE\s+FROM)\b/i` over EVERY string argument of every call, and the
`auditedWrite` mutation signal was restored. A read whose only SQL is
`SELECT … FOR UPDATE` — the idiom already live at house-crm.ts:76 — and a read
that merely records a PII-access audit entry both dropped out of governed-sink
derivation, so neither owed its `ActionGrant<"pii.view">`.

```
× does not let a `FOR UPDATE` row lock exempt a PII read sink
× does not let an audit record buy a PII read out of its grant
  AssertionError: expected [] to deeply equal [ Array(1) ]
  src/__tests__/fitness/governed-actions.test.ts
```

### PF-051 a governed sink on a surface that cannot authorize fails the build

`src/app/_evilproof/actions.ts` was planted calling `verifyAndListOrgChain` from
a Server Action. The dedicated unsupported-surface rule names what to do instead
rather than demanding a shape (`requireActionGrant(req, …)`) that a Server Action
can never produce.

```
× enforces: every surfaced governed action is wired through requireActionGrant in its route
  src/app/_evilproof/actions.ts:5: governed sink 'verifyAndListOrgChain' on an
  unsupported surface — governed sinks are reachable only from a route handler …
  src/__tests__/fitness/governed-actions.test.ts
```

### PF-052 authorization is tracked by symbol, and the guard must actually return

`referencesAuthorization` was reverted to identifier-TEXT matching, and
`isFailClosedGuard` to accepting ANY nested return. A route reading
`body.value.grant` from the request body then satisfied the fence because the
client-supplied path contains an identifier spelled `grant`; `auth.valueOf()`
passed the `startsWith("auth.value")` prefix test; and a return buried in a
never-invoked nested function counted as fail-closed. Separately, reverting
`resolveCallTargets` to import-alias-only unwrapping made a one-line local alias
(`const listChain = verifyAndListOrgChain`) hide the route from discovery.

```
× rejects a client-supplied value whose identifier merely SPELLS the authorized name
× rejects a `valueOf()` reference standing in for the authorized value
× rejects a fail-closed return buried in a nested function
× discovers a governed sink reached through a LOCAL alias
  src/__tests__/fitness/governed-actions.test.ts
```

### PF-053 an unregistered audited action degrades to `[REDACTED]`

`house-crm.ts`'s `action: "household.update"` was changed to
`"household.archive"`. The attribute-vocabulary derivation reports it in BOTH
directions — the new value is unregistered, and the registered one is now stale —
so neither half can pass vacuously.

```
× enforces: the attribute vocabularies match the shipped call sites exactly
  src/infrastructure/crm/house-crm.ts:75: unregistered action "household.archive"
    — it would be logged as "[REDACTED]"
  stale action "household.update" — no shipped call site emits it
  src/__tests__/fitness/observability-vocabulary.test.ts
```

### PF-054 a DSN fallback reached through element access

`config/index.ts` was changed to
`process.env["DATABASE_URL"] ?? "postgres://verin:pw@db.internal:5432/verin"` —
element access, which the text regex structurally cannot see, on a name the old
`SECRET_NAME` alternation did not carry even though `sealSecrets` wraps that
value in a `SecretValue`.

```
× enforces: no secret has a hardcoded fallback
  AssertionError: secret fallbacks (AST):
  src/infrastructure/config/index.ts:102
  src/__tests__/fitness/no-secret-fallback.test.ts
```

### PF-055 a frozen repository is still a repository

`src/infrastructure/crm/_evil-repo.ts` was planted exporting
`Object.freeze({ listAll(db) { … } })` with no tenant parameter. `Readonly<T>`'s
alias symbol lives in lib.es5.d.ts, so the previous symbol-level bail enumerated
none of its members.

```
× enforces: every exported SQL repository entry requires a sealed tenant context or exact escape
  src/infrastructure/crm/_evil-repo.ts :: householdRepo.listAll
    - repository callable has no sealed tenant context
  src/__tests__/fitness/tenant-context-required.test.ts
```

### PF-056 a PII-shaped exported VALUE is import-reachable from llm/

`src/domain/_evil-roster.ts` (`export const DEMO_CLIENT = { firstName, email }`)
was planted and imported from `src/infrastructure/llm/_evil-consumer.ts`. The
value has an anonymous object type with no call signature, so the previous
callable-only walk marked nothing and reachability passed.

```
× enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it (invariant 1)
  src/infrastructure/llm/_evil-consumer.ts reaches PII-bearing module src/domain/_evil-roster.ts
  src/__tests__/fitness/llm-pii-boundary.test.ts
```

**Revert:** every planted file was deleted and every edited file restored from a
copy taken before the injection (`git status` shows no `_evil*` artifacts and no
unintended diff in `eslint.config.mjs`, `src/infrastructure/config/index.ts`,
`src/infrastructure/crm/house-crm.ts`, or the three fence files). The full suite
is green again: 48 files, 543 tests.

**Date:** 2026-07-27 (eleventh review-fix round on v3 build-sequence prompt 6).

### PF-057 a PII read moved INLINE into the route

`src/app/api/audit/route.ts` was reverted to the shape this round replaced —
`db.query("SELECT id, email FROM users WHERE org_id = $1", …)` inline in the
handler. It is org-scoped and reached under a valid `audit.export` grant, and
that is the point: governed-sink derivation and tenant-scope derivation both read
repository signatures under `src/infrastructure/`, so an inline query has no
signature to carry an `ActionGrant` or a sealed `TenantContext` and neither fence
could ever see it. Both halves of the rule fire.

```
× enforces: no app-layer module issues raw SQL (it would escape sink derivation entirely)
  src/app/api/audit/route.ts:34 - raw SQL in the app layer bypasses governed-sink
    and tenant-scope derivation; move it behind an infrastructure repository
  src/__tests__/fitness/governed-actions.test.ts

× enforces: tenant scoping cannot be side-stepped by writing the SQL in the app layer
  src/app/api/audit/route.ts:34 - raw SQL in the app layer bypasses governed-sink
    and tenant-scope derivation; move it behind an infrastructure repository
  src/__tests__/fitness/tenant-context-required.test.ts
```

### PF-058 an `any`-sourced sealed annotation

`const forged: ActionGrant<"pii.view"> = JSON.parse("{}")` was added to the audit
route. No cast names a sealed type, so ESLint sees nothing; the previous
annotation rule keyed on the initializer's CALLEE and only ever looked at
`VariableDeclaration`, so `JSON.parse` — and equally a return-type annotation, a
class property, or a bare `body.grant` — walked past it.

```
× enforces: sealed types are built only in their factory modules
  src/app/api/audit/route.ts:33 - sealed type 'ActionGrant' annotated onto a value
    produced outside its factory
  src/__tests__/fitness/tokenized-factory-only.test.ts
```

### PF-059 a client-supplied grant in the grant parameter

The audit route was rewired to `listOrgUserEmails(auth.value as never,
body.value.grant)` — the authorized value present, but in the WRONG argument,
with the grant itself read from the request body. The previous rule asked only
whether SOME argument referenced the authorized value, so this read as correctly
wired.

```
× enforces: every surfaced governed action is wired through requireActionGrant in its route
  src/app/api/audit/route.ts :: GET: authorized value does not reach the
    ActionGrant parameter of 'listOrgUserEmails'
  src/__tests__/fitness/governed-actions.test.ts
```

### PF-060 a governed sink handed out as a value

`void Array.of(listOrgUserEmails);` was added to the same handler. The sink is
never called here, so no route entry exists and the whole first-statement /
fail-closed / authorized-value chain would have applied to nothing.

```
× enforces: every surfaced governed action is wired through requireActionGrant in its route
  src/app/api/audit/route.ts:32: governed sink 'listOrgUserEmails' is passed as a
    VALUE — it has no call site this fence can authorize
  src/__tests__/fitness/governed-actions.test.ts
```

### PF-061 an audit action typed as `string`

`AuditedWriteOpts.action` was reverted from `ObservabilityAction` to `string`.
Both log lines that carry it derived nothing and flagged nothing before this
round, while at runtime `isSafeObservabilityPrimitive` would degrade an unlisted
value to `[REDACTED]` in the one line explaining a failed write.

```
× enforces: the attribute vocabularies match the shipped call sites exactly
  src/infrastructure/audit/audited-write.ts:120: dynamic action value — it cannot
    be checked and would be logged as "[REDACTED]" unless it happens to be registered
  src/infrastructure/audit/audited-write.ts:148: dynamic action value — …
  src/__tests__/fitness/observability-vocabulary.test.ts
```

### PF-062 a compound-assignment secret fallback

A `??=` compound assignment defaulting `process.env.SESSION_SECRET` to a
hardcoded dev string was planted in `config/index.ts` (spelled out here only in
prose — this fence scans its own docs, and PF-054 dodged the same way by using
element access). `??=`/`||=` were in neither the operator set nor the text regex,
whose `\s*` after the operator cannot cross the `=`.

```
× enforces: no secret has a hardcoded fallback
  AssertionError: secret fallbacks:
  src/infrastructure/config/index.ts
  src/__tests__/fitness/no-secret-fallback.test.ts
```

### PF-063 the ESLint mirror unwired from a layer

`...noSealedTypeConstruction` was removed from the `src/app/**` block. Both
name-list assertions stayed green — they compare the mirror's two arrays, which
were untouched — so nothing proved the rule was still applied anywhere. That is
how `src/infrastructure/config/**` came to have no sealed-type rule at all.

```
× enforces: the ESLint mirror is WIRED for every shipped layer, factories excepted
  src/app/api/audit/route.ts is not covered by the sealed-type ESLint rule
  src/__tests__/fitness/tokenized-factory-only.test.ts
```

**Companion-level proofs (this round's other half).** A companion that passes
because of a shared fixture rather than because it detects the planted defect
proves nothing, so three were re-proven by deleting the branch under test rather
than by injecting into shipped code:

- deleting the `cls.getImplements()` branch now fails *catches a class
  implementing an aliased sealed type*. It did NOT before: every `sealedFixture`
  project carried a baseline hit from the fixture's own `principal.ts`
  (`return { tenant: { orgId } }`), so a `toBeGreaterThanOrEqual(2)` count was
  satisfied by the baseline plus the class's `piiFree` property. The fixture now
  builds its tenant through the factory, and the two counting companions assert
  per-branch MESSAGES.
- deleting `objectLiteralOf`'s identifier resolution fails *reads a HOISTED
  attribute bag and a resolvable spread*.
- dropping `PropertyAssignment` from `resolveCallTargets` fails *discovers a
  governed sink held in a literal bag*.

**Revert:** every edited file was restored from a copy taken before its injection
(`git status` shows no unintended diff in `eslint.config.mjs`,
`src/infrastructure/config/index.ts`, `src/infrastructure/audit/audited-write.ts`,
or `src/app/api/audit/route.ts`). The full suite is green again: 48 files, 570 tests.

**Date:** 2026-07-27 (twelfth review-fix round on v3 build-sequence prompt 6).

---

## Round 12 — one identity per request, type-decided mints, shape-decided detectors

Every proof below was EXECUTED by reverting exactly one fix and running the suite,
then restoring from a copy taken first. Where the defect is in production code the
injection is in production code; where it is in a detector, the detector's own
branch is reverted, because a companion that survives its branch's deletion is not
a companion (charter #4).

### PF-064 two grants on one request, past the session half-life

`requirePrincipal`'s per-request memoization was removed, restoring the D-051
shape (`return resolvePrincipalOnce(req)`). `/api/audit` was then driven through
the REAL route handler with a session 20 minutes from a 60-minute expiry: the
first grant rotates the id and writes the new cookie to the RESPONSE, the second
re-reads `req.cookies` and finds a row renewal has deleted.

```
× serves an aged (past half-life) session, rotating exactly once
  AssertionError: expected 401 to be 200
  src/__tests__/integration/audit-route.test.ts
```

The fresh-session and fail-closed cases (advisor without `audit.export` → 403,
no cookie → 401) stayed green throughout, so the fix restores the aged path
without loosening either grant.

### PF-065 a client-shaped entityId must not abort the write's own failure report

`observabilityIdOrRedacted` was reverted to `observabilityId` in `auditedWrite`'s
catch. `auditedWrite({ entityId: "Smith", perform: () => { throw NOT_FOUND } })`
— the exact value `PATCH /api/crm/households` accepts — then threw `PII_VIOLATION`
out of the helper before `failIntent` was enqueued.

```
× a CLIENT-SHAPED entityId still yields the typed error AND the failure-audit entry
  src/__tests__/integration/audited-write.test.ts
```

The passing form asserts BOTH halves: the typed NOT_FOUND result, and a
`task.create.failed` row whose `entity_id` is still `Smith` while the log line
carries `[REDACTED]` — refused from observability, not from the chain.

### PF-066 the sealed-annotation rule, four ways

Each branch reverted separately; each fails a different companion.

```
# restore `if (call.getTypeArguments().length === 0) continue`
× catches a coercion helper whose sealed type argument is INFERRED, not written

# `sealedType(annotation)` -> `sealedValueType(annotation)`  (no container walk)
× catches a PROMISE-wrapped laundering function (the normal async shape)
× catches the four declaration positions the annotation scan used to skip

# drop the source-side awaited() unwrap
× catches a PROMISE-wrapped laundering function (the normal async shape)

# `isUncheckedSource(...)` -> `sealedValueType(source)?.typeName === sealed.typeName`
× enforces: sealed types are built only in their factory modules
× allows the NULLABLE sealed shapes the rule promises to leave alone
```

The fourth is the two-sided proof: the old predicate fails the real repository AND
the nullable companion, so the narrowing is not a deletion.

### PF-067 element-access is the only reference source that fires alone

Dropping `PropertyAccessExpression` from `detectUntrustedFactoryCalls`'s reference
sources changed NOTHING (a member access's NAME node is itself an Identifier that
already resolves), so it was removed as unprovable surface. `ElementAccessExpression`
is different — `principal["principalFromIdentity"]({})` names the factory in a
string, and no identifier on that line resolves to it.

```
# drop ElementAccessExpression
× catches a factory named only in a STRING, through element access
```

### PF-068 detectors keyed on shape, not spelling

```
# isSqlExecutorCall requires a PropertyAccessExpression again
× catches app-layer SQL issued through a DESTRUCTURED or indexed executor

# mutatesPersistence -> "the body contains DML somewhere"
× refuses to let a PII read buy its own exemption with an inline audit write

# stop stripping quoted SQL values
× keeps the write exemption for a locking pre-image read inside an update

# drop index/alias type-argument walking from containsDeclaredType
# (and, separately, drop class-property callables)
× derives a PII sink from a MAP-shaped return and from a class-field arrow

# read a port-annotated repository's DECLARED type instead of its initializer
× checks the IMPLEMENTATION of a repository annotated with its domain port

# authorized-value check: .every(call) -> .some(call)
× rejects a SECOND, unauthorized call to the same sink in one handler

# isAuthorizedValue -> "the subtree mentions the authorization"
× rejects a `valueOf()` reference standing in for the authorized value
× rejects a grant argument that merely MENTIONS the authorized value
× rejects a grant LAUNDERED through a local binding that mixes in client data

# enclosingHandlerName returns null for a non-exported enclosing function
× attributes a sink called from a route-LOCAL helper to its exported handler

# drop the invoked-receiver exemption from detectEscapedGovernedSinks
× does not call a sink INVOKED inside a callback argument an escaped value

# delete `binding.action === entry.action`
× enforces: every surfaced governed action is wired through requireActionGrant in its route
× flags a route wired to the WRONG action literal
× accepts a handler that binds TWO grants before any route work, and rejects one bound after
```

The last one is a companion repair: the old fixture had no fail-closed guard, so
`auth` was undefined regardless and the action comparison was never exercised. It
now plants a COMPLETE prologue binding the wrong action and asserts the exact
message, so only that comparison can produce it.

### PF-069 observability attributes: the message-less form and the sometimes-opaque union

```
# attributesArgument -> `messageArgument(call) === args[1] ? args[0] : null`
× checks the attribute bag of a MESSAGE-LESS log call (pino's single-argument form)

# declaredAsObservabilityId -> members.some(...)
× refuses an attribute that is only SOMETIMES an opaque id, and allows the optional form

# OBSERVABILITY_ID_FACTORIES -> ["observabilityId"]
× enforces: the attribute vocabularies match the shipped call sites exactly
× derives id fields from the REDACTING mint too (an error-path field is not stale)
```

The second proof is two-sided in one test: `ObservabilityId | string` must be
refused, `ObservabilityId | null` must not.

**Revert:** every injected file was restored from a copy taken before its
injection; `git status` shows no unintended diff. The full suite is green again:
49 files, 593 tests. `pnpm typecheck`, `pnpm lint`, `pnpm knip`,
`pnpm v3:invariants` (3 active-pass, 0 active-fail) and `pnpm golden:validate`
(16/16) all pass.

**Date:** 2026-07-27 (thirteenth review-fix round on v3 build-sequence prompt 6).

---

## Round 13 — non-destructive migrations, reviewed pre-auth reads, and a fence suite that finishes

Every proof below was EXECUTED by reverting exactly one branch and running the
suite, then restoring from a copy taken first. Two of them start from a fence that
had never actually finished: the rebase onto main put prompt 5's decision-core
contracts under prompt 6's fences, and `llm-pii-boundary` took **689 seconds** —
three of its assertions blew past the 20s timeout, so the branch was red and the
failures underneath had never been read.

### PF-070 migration 3 refuses an upgrade it cannot apply, and changes nothing

`await assertPreflightClean(db, m)` was deleted from `runMigrations`. The rehearsal
suite drives the SHIPPED runner against a store rewound to version 2 (the v3
constraints dropped, the ledger row removed) with one legacy row planted per
relationship:

```
× refuses the upgrade and preserves the row when sessions_user_org_fk is violated
× … households_advisor_org_fk … contacts_household_org_fk
× … financial_accounts_household_org_fk … applications_household_org_fk
× … applications_contact_household_org_fk … tasks_household_org_fk
× reports EVERY violating relationship at once, not just the first
  8 failed | 4 passed
```

The assertion is deliberately on the PREFLIGHT phrasing (`cannot be applied to this
store; no schema change was made and no row was modified`), not on the relationship
name: without the preflight the constraint still aborts inside the transaction and
the driver error still names the constraint, so a test that only looked for the name
passed with no preflight at all. That weaker form was written first and caught here.

The `households.advisor_user_id` UPDATE that version 3 used to run is gone with it.
A migration that silently NULLs a column a human populated is data loss dressed as an
upgrade; the store is now REPORTED and left byte-for-byte intact, and each of the
seven tests re-reads its planted row afterwards to prove it.

Two constraints were removed rather than proven: `households_primary_contact_org_fk`
and `tasks_assignee_org_fk` reference columns (`primary_contact_id`,
`assignee_user_id`) that `house-crm.ts` writes as a literal NULL and no UPDATE ever
sets. Under MATCH SIMPLE the check is unconditionally skipped, so no adversarial
companion is possible — DDL no shipped code can trip (charter #4/#5).

### PF-071 a failing migration says WHICH migration failed

`runMigrations` now wraps each transaction and rethrows with `{version, name}`. Proven
against a stub driver whose `transaction` throws a bare
`duplicate key value violates unique constraint`: the surfaced error carries
`migration 1 (baseline) failed and was rolled back` AND the driver's own text, so a
constraint abort at Next.js boot is no longer indistinguishable from a dataDir lock.

### PF-072 a data-modifying CTE cannot buy the write-boundary exemption

`classifySql` tested the mutation pattern first and returned a SINGLE kind, so
`WITH logged AS (INSERT INTO pii_access_log …) SELECT c.* FROM contacts c` classified
as `"mutation"` only. `mutatesPersistence` is `includes("mutation") && !includes("read")`,
so merging the audit INSERT into the PII read handed that read the write-boundary
exemption from `pii.view` — the two-statement form was already refused (PF-041's
round), and this was the same evasion with a semicolon removed.

Statements are now classified by what they RETURN, looking past any CTE list:

```
# classifySql -> read only when afterCteList(statement) starts with SELECT
× refuses the exemption when the audit write is MERGED INTO the PII read as a CTE
× classifies CTE statements by what they RETURN, not by which keyword appears first
```

`WITH d AS (DELETE …) INSERT INTO … SELECT * FROM d` stays a pure write (its result is
DML), and `INSERT … SELECT` / `DELETE … WHERE id IN (SELECT …)` still feed the write.

### PF-073 route work decomposed into a helper is checked, not failed

`sinkCalls` searched only the exported handler's own statements, while
`enclosingHandlerName` deliberately attributed a sink called inside a same-file helper
to that handler. The shape the fence DOCUMENTS as supported therefore reported
`authorized value does not reach the ActionGrant parameter` for correctly wired code,
and no companion exercised the disagreement. Reverting the walk to `routeWork`:

```
× accepts route work DECOMPOSED into a same-file helper the grant is passed to
× checks EVERY verb that reaches a shared helper, not just the first
× follows a helper called by another helper (nested decomposition)
```

Authorization travels by ARGUMENT POSITION and a helper parameter counts as authorized
only when every call site this handler reaches passes an authorized value there, so
`loadChain(await getDb(), body.grant)` is still refused.

### PF-074 a helper shared by GET and POST owes BOTH prologues

`exportedHandlerCalling` returned the FIRST matching handler despite its docstring
saying "if exactly one does". Truncating the new `exportedHandlersCalling` result with
`.slice(0, 1)`:

```
× checks EVERY verb that reaches a shared helper, not just the first
```

Discovery now emits one entry per reaching verb; the unauthorized POST is reported
while the correctly wired GET is not.

### PF-075 a PII read with no tenant boundary is REVIEWED, not invisible

The `pii.view` inference required a TenantContext/WriteActor/ActionGrant PARAMETER, so
`findUserByEmail(db, email): Promise<UserRow | null>` derived no sink at all — no grant
required, and invisible to the unsupported-surface rule that keeps governed sinks off
Server Actions. That exemption is real (a `pii.view` grant is minted FROM a Principal,
so the credential lookup that PRODUCES one cannot hold it) but it was implicit and
carried no reason. It is now an exact-match registry with a required `why`, derived
complete both ways. Forcing `unboundedPiiReads` to return nothing:

```
# unboundedPiiReads -> if (true || …) continue
× enforces: every PII read outside a tenant boundary is REVIEWED, with the reason it cannot hold a grant
× catches a NEW unbounded PII read that no one reviewed
```

The companion plants `findUserByPhone(phone): Promise<UserRow | null>` and asserts all
three arms: unreviewed is reported, reviewed-with-a-reason is suppressed, reviewed with
a blank reason is not. A separate case proves a tenant-scoped read is not an escape
CANDIDATE at all, so the registry can never be used to excuse one.

### PF-076 the llm/ walk fails closed on a loader it cannot follow

The reachability walk `continue`d on `specifier === null`, on the stated grounds that
those are "already reported by unverifiableModuleLoadLines". They are not:
that detector fires only on the `import` keyword or a callee literally spelled
`require`, while `createRequire(import.meta.url)` and `module.require` arrive as
`{specifier: null, kind: "create-require" | "require-reference"}`. Restoring the bare
`continue`:

```
× rejects a createRequire loader in llm/ — the walk fails closed on what it cannot follow
```

The planted `src/infrastructure/llm/evil.ts` loads `../../domain/schema/entities` (a
PIIBearing module) through `createRequire` and the fence went green.

### PF-077 the scrubber's file-wide exemption is per-TYPE

`if (normalized === "src/infrastructure/pii/tokenize.ts") continue;` skipped the
invented-type-parameter rule for ALL SEVEN sealed types inside the factory, when the
`normalized !== sealed.factory` guard two lines below already covered the Tokenized
case it was written for. Restoring the file-wide skip:

```
× lets the scrubber mint its OWN sealed type, and nothing else, through a coercion helper
```

The fixture mints `Tokenized<string>` (its own, allowed) and
`const stolen: TenantContext = coerce(JSON.parse("{}"))` (not its own) in the same file;
only the second is reported. The two remaining hardcoded copies of that path are now
derived from the SEALED registry.

### PF-078 a `piiFree` SCHEMA is not a `piiFree` MINT

The object-literal rule fired on any property named `piiFree`, which made
`piiFree: z.literal(true)` — decision-core's Zod schema DESCRIBING the tokenized shape
— a sealed-type construction, in both the fence and its ESLint mirror. It now requires
the flag to BE the flag (a `true` literal, optionally `as const`, or a shorthand name
bound to one). Deleting the `as const` unwrap:

```
# unwrapAssertions(value) -> value
× catches a bare `piiFree: true` bag, but not a SCHEMA that merely validates the flag
```

That companion was written twice: the first version asserted only on the bare literal
and survived the deletion, because `as const` was never planted. The ESLint mirror was
re-proven the same way against a probe file carrying all four shapes — bare, `as const`,
shorthand, and the schema — and reports exactly the first three.

### PF-079 renaming the logger is not an escape

`resolvesTo` followed import aliases but not local bindings, so `const l = log;
l.info({}, msg)` resolved to the local VariableDeclaration and dropped the module out
of BOTH the literal-message requirement and the drift check — while its messages still
degraded to `"log event"` at runtime. `log.child({…}).info(…)` had the same hole (the
inner symbol is `child`). Deleting the local-binding and child-logger arms:

```
× follows a LOCAL alias and a child logger — renaming the logger is not an escape
```

The companion asserts both directions in one fixture: two dynamic messages are caught
and two literal ones are collected, through an alias and through a child logger. The
existing negative case (a same-named local that is NOT the logger is ignored) still
passes, so the walk widened by RESOLUTION, not by spelling.

### PF-080 a preflight probe is the one sanctioned cross-tenant read, and only a read

The version-3 probes are built at module load, so they never appear as a source literal
the org-id fence could scan, and they read every tenant's rows by design — "can this
schema change be applied to this store at all" is a question about the store. That
exemption is now explicit and checked rather than accidental: a probe must be a single
read-only SELECT. Neutering the filter:

```
# nonReadOnlyProbes -> .filter(() => false)
× a preflight probe that mutates is caught (the exemption does not cover writes)
```

The enforcing assertion also carries a non-vacuity floor (`probes.length > 0`), so the
rule cannot go green by there being nothing to check.

### PF-081 a type-only `unique symbol` brand is not a platform dependency

`dependency-rule` treats any ambient declaration in `contracts/` as a re-introduced
platform dependency — the rule that stops `declare const fetch` from restoring a global.
Main's stricter ambient handling met prompt 6's `declare const TenantContextBrand:
unique symbol`, the nominal-brand idiom every sealed type is built from, and the fence
went red on five contracts files. The exemption is now keyed on having no RUNTIME
surface, not on the type node. Deleting it:

```
# ambientContractDeclarations -> (isTypeOnlyBrand check removed)
× enforces: the real src/ tree has zero layer violations
× a type-only `unique symbol` brand is not a platform dependency, but a USED one still is
```

The companion asserts both halves in one test: the branded interface is clean, and the
SAME declaration referenced as a value (`export const key = TenantBrand;`) is still
reported.

### PF-082 lib members are not the project's PII surface

`callablePIIExposures` walked `type.getProperties()` with no filter on where a member
was DECLARED. A branded primitive (`type FirmId = string & Brand`) carries the whole
String prototype, so every branded id in decision-core reported
`String.prototype.anchor(name)` as a PII surface — 27 findings about a lib signature
nobody wrote and nobody can change — and every `.d.ts` in `node_modules` was walked the
same way, which is what made `markedModules` take 33 seconds. Deleting the filter:

```
# callablePIIExposures -> (src/ declaration check removed)
× enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked
× enforces: the marked set is non-empty
× does not read lib members off a BRANDED PRIMITIVE, but still reads the project's own
```

The companion is two-sided: a branded `FirmId` reports no `anchor`, and the project's
own `notify(name: string)` is still reported, so the filter narrowed the SOURCE of the
members, not the rule.

The 36 findings that remained after this are decision-core evidence REFERENCES —
branded `EvidenceSnapshotId` lists, `EvidenceKind` discriminators, and `EvidenceRequest`
descriptors. `evidence` is in the PII field rule because the projection layer's
`evidence` really is the client payload; these are the other thing that word names.
Each is an exact-match escape with its reason, and the pre-existing
"every escape is LOAD-BEARING" assertion proves none of them suppresses nothing.

### PF-083 the fence suite finishes (689s → 4s), with the same answers

Every fence type walk kept a visited set keyed on `${type.getText()}::${flags}`.
`getText()` PRINTS the type: cheap for `string | null`, ruinous for a
`z.infer<typeof …>` alias, and the decision-core contracts are ~3,500 lines of them.
The key is UNCHANGED — still the same string, so two distinct type objects that print
alike still collapse to one visit — but it is now memoized on the interned compiler
type, so each type prints at most once per process. Companion fixtures also stopped
carrying `lib.dom.d.ts` and `@types`, which ~165 of them re-parsed to answer a question
about five lines of synthetic source.

```
llm-pii-boundary      689.03s (3 assertions past the 20s timeout)  ->  3.63s
tokenized-factory-only 65.44s (1 assertion past the 20s timeout)   ->  17.9s
full fitness suite     never completed                             ->  18.1s
full test suite        never completed                             ->  54 files, 851 tests, 40s
```

Behavior-neutrality is the point, and it was checked rather than assumed: the
identity-keyed variant tried first reported the SAME 71 findings as the text key, and
the text key is what shipped.

**Revert:** every injected file was restored from a copy taken before its injection
(`git status` shows no unintended diff in `src/infrastructure/store/migrations.ts`,
`src/__tests__/fitness/_fence-utils.ts`, `governed-actions.test.ts`,
`llm-pii-boundary.test.ts`, `tokenized-factory-only.test.ts`,
`observability-vocabulary.test.ts`, or `org-id-required.test.ts`). The full suite is
green: 54 files, 851 tests. `pnpm typecheck`, `pnpm lint`, `pnpm knip`,
`pnpm v3:invariants` (6 active-pass, 0 active-fail), `pnpm golden:validate` (16/16) and
`next build` all pass.

**Date:** 2026-07-28 (fourteenth review-fix round on v3 build-sequence prompt 6).

---

### PF-084 leading projection text requires exact trusted classification

The unit companion plants single-token and multi-token leading names with no
classification and proves projection refuses both. It also plants an exact identity
span, a reviewed static-template span, forged and stale safe spans, and lowercase
ordinary prose. Only the exact identity span is masked and only the factory-minted
static span remains visible.

### PF-085 indirect loaders and contextual returns cannot mint authority

The `tokenized-factory-only` and `no-secret-fallback` companions plant
`createRequire`, an aliased ambient `require`, and an expression-bodied
`() => TenantContext` that returns `JSON.parse`. The shared module-reference analysis
reports both loaders, and the contextual call signature reports the sealed return.

### PF-086 structural PII return shapes derive governed sinks

The governed-actions companion returns `Promise<Array<{ email: string }>>` without a
`PIIBearing` marker. The shared structural PII walker derives `pii.view` and reports
the missing grant. Existing indexed, mapped, class-field, and marked returns remain
covered, while library prototype callables remain outside the shipped surface.

### PF-087 structural SQL executors are repository behavior

The tenant-context companion plants an infrastructure module whose only database
dependency is a structural `{ query(sql: string) }` parameter. One exported callable
has no tenant parameter and another has a typed but unasserted `TenantContext`; the
detector reports both exact failures without any database-adapter import.

### PF-088 pending migration preflights are atomic and diagnostics are safe

The migration integration companion rewinds a real PGlite store to version 1, plants
a version-3 tenant orphan, and snapshots the migration ledger, indexes, and planted
row. The version-3 preflight refuses the upgrade before version 2 creates its index,
and every snapshot remains byte-for-byte equal. A driver error containing an email is
returned only as the allowlisted `driver-error:23505` category.

```
pnpm exec vitest run src/__tests__/unit/llm-boundary.test.ts \
  src/__tests__/integration/migration-preflight.test.ts \
  src/__tests__/integration/pii-observability.test.ts \
  src/__tests__/fitness/line-budget.test.ts \
  src/__tests__/fitness/tokenized-factory-only.test.ts \
  src/__tests__/fitness/no-secret-fallback.test.ts \
  src/__tests__/fitness/llm-pii-boundary.test.ts \
  src/__tests__/fitness/governed-actions.test.ts \
  src/__tests__/fitness/tenant-context-required.test.ts
# 9 files, 272 tests passed
```

**Date:** 2026-07-28 (fifteenth review-fix round on v3 build-sequence prompt 6).

---

### PF-089 reflected CommonJS loaders are module references

The companions acquire `createRequire` through
`Reflect.get(nodeModule, "createRequire")`, then load a privileged tenant or secret
module. Before the shared analysis changed, all three failed:

```
× createRequire loaders fail closed
× catches reflected createRequire before it can expose factory modules
× catches reflected createRequire before it can expose revealSecret
```

The dependency, privileged-factory, and secret scans now consume the same reflected
module reference.

### PF-090 sealed wrappers do not hide union siblings or opaque outputs

The governed-sink companion returns both
`Tokenized<string> | { email: string }` and
`SecretValue | { email: string }`, plus `Promise<unknown>`. Before the exact-wrapper
and opaque-output rules, all three produced no sink. They now derive `pii.view`.
The shipped opaque exceptions are exact, reasoned, derived-complete, and checked for
staleness.

### PF-091 containers and contextual methods cannot launder sealed authority

The sealed-construction companions plant an unchecked cast and annotation to
`{ tenant: TenantContext }`, an object method contextually implementing
`revive(): TenantContext`, and a class method implementing the same contract. Before
the structural and contextual return walks, none was reported. Each planted line now
reports `TenantContext`, while checked propagation and nullable containers remain
clean.

### PF-092 returned repository methods retain tenant and action boundaries

The tenant companion plants exported object and class factory methods returning
unscoped SQL methods. The governed companion returns PII-bearing methods from the
same forms. Before the shared returned-callable walk, both detectors returned an
empty list. They now report each nested method by its full owner path.

The real `makeExecutionStore.loadById` became the non-vacuity proof: once discovered,
the shipped fence failed until that method required and asserted
`ActionGrant<"pii.view">`. `makeExecutionStore.loadByToken` remains the exact
resume-token escape.

### PF-093 every migration driver phase sanitizes diagnostics

The migration companion injects a driver error containing an email independently at
ledger bootstrap, applied-version read, and preflight query. Before the shared
failure mapper, each raw driver error escaped with code `23503` and its original
message. All three now return `INTERNAL`, the stable `driver-error:23503` category,
their exact stage, and no planted row value. The existing mutation companion remains
green, and the real orphan preflight still preserves its intentional actionable
`AppError`.

```
pnpm exec vitest run src/__tests__/fitness/dependency-rule.test.ts \
  src/__tests__/fitness/tokenized-factory-only.test.ts \
  src/__tests__/fitness/no-secret-fallback.test.ts \
  src/__tests__/fitness/tenant-context-required.test.ts \
  src/__tests__/fitness/governed-actions.test.ts \
  src/__tests__/integration/migration-preflight.test.ts \
  src/__tests__/integration/tenant-isolation.test.ts \
  src/__tests__/integration/account-opening.test.ts
# 8 files, 299 tests passed
```

**Date:** 2026-07-28 (sixteenth review-fix round on v3 build-sequence prompt 6).

## PF-094 - PF-100 - seventeenth review-fix round (all-caps PII, virgin-store proof, shared authority prologue)

### PF-094 all-caps person shapes fail closed at the LLM projection

Every sensitive-text detector composed `TITLE_CASE_WORD_SOURCE`
(`\b\p{Lu}\p{Ll}{1,}`), which requires a lowercase letter immediately after the
capital, so an ALL-CAPS name was invisible to all of them at once. Confirmed by
running the shipped regexes: for `"ALICE SMITH requested a wire transfer"` the
title-case matcher returned zero matches, `subjectCandidates` therefore built no
candidate, the slot-count check passed trivially (`0 === 0`), `maskText` masked
nothing, and `projectForLlm` returned `ok()` with the raw name inside a
`Tokenized<string>` carrying `piiFree: true`. "SMITH, JOHN" is an ordinary CRM
rendering, so this was not a corner case.

The shape is now `PERSON_WORD_SOURCE` (title-case OR all-caps), composed once in
`contracts/pii.ts` and consumed by the candidate walk, the masker, and the residual
check, so a name shape cannot be a candidate in one and invisible in another. The
redaction sentinel is neutralized before shape-testing, since `[REDACTED]` is itself
all-caps.

**Adversarial proof:** replaced the all-caps alternative with an unmatchable pattern
and re-ran; 8 of the new companions failed (`ALICE SMITH`, `SMITH, JOHN`, a leading
single all-caps surname, an evidence-only all-caps name, the two identity-span
masking cases, and both residual-detection cases). Reverted; 53 passed.

**Safe lookalikes that must still pass, and do:** the `[REDACTED]` sentinel and
`{{slot_0001}}` placeholders embedded in prose; ordinary lowercase prose; a trusted
static-template token that stays visible; and an all-caps name whose exact span is
bound to a slot and masked. No acronym allowlist and no caller-supplied safe flag
was introduced.

### PF-095 an empty migration ledger is proven, not trusted

`runMigrations` treated an empty `schema_migrations` as proof the store was virgin
and applied plus RECORDED migration 1 before evaluating any later preflight. On a
store whose tables exist while the ledger does not (a dump restored without its
ledger rows, a dropped ledger) versions were recorded against a schema nobody
verified, so the "a failed preflight leaves the recorded version exactly unchanged"
guarantee did not hold.

`assertManagedSchemaEmpty` now proves the claim before the first mutation, against a
managed-object set DERIVED from the shipped DDL (so a new table cannot escape it).

**Adversarial proof:** disabled the call and re-ran the regression; both new tests
failed with `expected 'migration 3 (tenant-qualified-relatio...' to contain 'the
migration ledger is empty but thi...'`, i.e. without the proof the store proceeded
and recorded versions 1 and 2 before failing at migration 3. Reverted; 20 passed.

**Non-vacuity of the regression itself:** it asserts ZERO mutations, comparing the
full object snapshot (`pg_class` relations, non-internal triggers, routines),
`pg_indexes`, the household rows, and the still-empty ledger before and after.

### PF-096 the test-only authority registries are rename-safe

`TEST_ONLY_INJECTION_POINTS` and the observability twin were hardcoded
`{file, name}` string pairs; nothing asserted the symbol still existed, so a rename
made the detector resolve nothing and pass vacuously while shipped code could call
the renamed function and widen a production authority allowlist.

**Adversarial proof (rename):** renaming `registerTestSystemActor` in
`src/contracts/tenant.ts` now fails at `tokenized-factory-only.test.ts:377`, and
`tsc` reports `TS2724`. **Adversarial proof (move, the half a symbol import cannot
catch):** moving the declaration behind a re-export fails with
`src/contracts/tenant.ts no longer declares an exported 'registerTestSystemActor' -
detectShippedTestAuthorityUse would resolve nothing and pass vacuously`, while the
sibling "has no shipped caller" test still passed, which is the vacuity itself. Same
two proofs for `registerTestSpanName`. All reverted.

### PF-097 a sealed type cast inside a container is a mint

`(row as { tenant: TenantContext }).tenant` escaped the fence entirely: the narrow
walk did not descend into properties, and the unchecked-container branch required
the SOURCE to be `any`/`unknown`/`never` rather than the source's property. The
ESLint mirror flagged the shape, inverting the "the mirror is a strict subset of the
authoritative fence" relationship the fence asserts.

**Adversarial proof:** a scratch module with the container cast and
`consume(JSON.parse("{}"))` against `consume(t: TenantContext)` now reports
`cast to sealed type 'TenantContext' outside its factory` and `sealed type
'TenantContext' minted from an unchecked call argument outside its factory`; HEAD's
copy of the fence run against the same file reported NEITHER. Reverted.

**Safe lookalikes that must still pass, and do:** `new Map<string, TenantContext>()`
(an empty container mints nothing), `const p: Principal | null = null`, the factory
modules' own sanctioned casts, and re-shaping an already-sealed value. No escape was
added: the one real shipped shape that tripped
(`request-schema.ts` parsing a zod-inferred type whose properties are `Tokenized<...>`)
was resolved by tightening the rule, not by exempting the file.

### PF-098 every reviewed factory module must resolve

`detectFactoryResultLaundering` did `if (!sf) continue;`, so a moved factory module
or a path typo silently disabled the laundering check for that whole module.

**Adversarial proof:** typing `src/contracts/tenant.ts` as
`src/contracts/tennant.ts` in `REVIEWED_FACTORY_EXPORTS` now fails with
`reviewed factory module does not resolve, so its laundering check silently does not
run`; with the typo in place the laundering test itself still passed green.
Reverted.

### PF-099 app-layer SQL detection fails closed on an unresolvable executor

`isSqlExecutorCall` read the callee's call signatures and returned false when there
were none, so a callee widened past `SqlDb` (a `Function`-typed local, a cast to an
anonymous function type, an opaque alias) issued the same SQL from the same place
with no repository signature to carry an `ActionGrant` or a sealed `TenantContext`.
This single derivation is asserted by BOTH the governed-actions and
tenant-context-required fences, so it failing open undercut both.

An unresolvable callee whose written name is `query`/`exec`/`execute` is now a
violation. A callee whose signatures DID resolve to some other declared name stays
clean, so the existing "a same-named non-SQL method is not persistence" companion
still passes.

**Adversarial proof:** the new companion plants `const query: Function = db.query`
called through a cast and an opaque `{ exec: unknown }`; both are reported. The
resolved-but-unrelated `cache.query({ id })` lookalike still reports nothing.

### PF-100 one authority prologue, derived by both fences

The tenant fence demanded its `assertTenantContext(tenant)` be literally statement
#1 while the governed-actions fence demanded `assertActionGrant(grant, "...")` be
statement #1 for the SAME callable, so a repository carrying both authorities as
explicit parameters was unbuildable no matter how it was written. Both now derive
`authorityPrologueViolations` from one implementation: every required assertion must
appear in the maximal contiguous LEADING run of authority assertions, in any order,
and a dual-authority signature additionally owes
`assertSameTenant(tenant, grant.tenant)`.

`assertSameTenant` ships with a real caller rather than as fence-only scaffolding:
`createSession` had always written that exact comparison out by hand (same org, same
human actor, against the tenant minted from the authenticated row).

**Adversarial proof, both fences, same shapes:** a correct contiguous prologue passes
(the previously unbuildable case); the same assertions in a different ORDER pass; a
missing `assertSameTenant`, a missing grant assertion, a DELAYED assertion after a
`db.query`, a SIDE EFFECT before the guards, BRANCHING logic interleaved into the
prologue, and a same-tenant proof comparing the WRONG values each fail. The delayed
case reports BOTH displaced assertions rather than only the first.

### PF-094 - PF-100 verification

```
pnpm exec vitest run   # 54 files, 920 tests passed
pnpm exec eslint .     # clean
pnpm exec tsc --noEmit # clean
pnpm knip              # clean
pnpm v3:invariants     # 6 active-pass, 0 active-fail
```

**Date:** 2026-07-28 (seventeenth review-fix round on v3 build-sequence prompt 6).

### PF-101 a sealed cast is judged by POSITION, not by graph reach

`carriesSealedType` asked whether the cast's SOURCE reached the target sealed type
anywhere in its type graph, and it was consulted before any check that the TARGET was
a container. `ActionGrant` carries a `TenantContext` and a `WriteActor`, so
`grant as unknown as TenantContext` was exempted - and since every sealed type is
`unique symbol`-branded, `as unknown as X` is the ONLY compile-legal cast form. The
fence was strictly weaker than the ESLint mirror it is asserted to be a superset of.

Source and target are now compared at the same structural position
(`sealedPositionsOf` / `typeAtPosition`), and the position key carries type arguments.

**Adversarial proof:** five casts off CHECKED sources that merely carry the type -
`grant as unknown as TenantContext`, `map as unknown as Principal` from
`Map<string, Principal>`, `getTenant as unknown as TenantContext` from a function
RETURNING one, `allTenants as unknown as TenantContext` from `readonly TenantContext[]`,
and `grant as unknown as ActionGrant<"decision.approve">` - each reported on its own
line; all five produced ZERO violations before this change. The safe lookalikes still
pass: `held as { tenant: TenantContext }`, `grant as ActionGrant<"pii.view">`, and
`grant.tenant as TenantContext`.

### PF-102 an unchecked value nested inside a composite literal argument is a mint

`consume({ tenant: JSON.parse(x) })` against `consume(a: { tenant: TenantContext })`
left no cast, no `piiFree` literal and no type argument for any other rule to see, and
the object-literal rule reads the contextual type with the NARROW walk.

**Adversarial proof:** the object form and the array form (`consumeAll([JSON.parse(x)])`)
are both reported; `consume({ tenant: systemTenant(...) })` and
`consumeAll([systemTenant(...)])` still pass.

### PF-103 the redaction sentinel is neutralized without erasing its neighbours

Blanking `[REDACTED]` to whitespace erased the "there is preceding content" signal
`embeddedPersonWord` reads, so `tokenizeText("[REDACTED] Alice")` sealed as
`piiFree: true` with the raw name intact while `"wire to Alice"` was refused. The
stand-in is now a non-letter, non-whitespace mark.

**Adversarial proof:** `[REDACTED] Alice`, `[REDACTED]Alice`, `[REDACTED] SMITH`,
`[REDACTED]SMITH`, and a doubled form each fail `hasUnresolvedProjectionText` and throw
`PII_VIOLATION` from `tokenizeText`. The scrubber's own output still passes: the
sentinel alone, and the sentinel followed by lowercase prose.

### PF-104 all-caps person shapes are refused by the observability id predicate too

`NAME_SHAPED_RE` needed a `Lu` immediately followed by a `Ll`, so
`observabilityId("entityId", "SMITH-JOHN")` succeeded and the value was emitted
verbatim into the pino line and over OTLP - and `audited-write` feeds `entityId`
straight from the request body. The predicate now composes `PERSON_WORD_SOURCE`, gated
on the value carrying no digit so uppercase-hex ids keep working.

**Adversarial proof:** "SMITH", "ALICE", "OBRIEN", and "SMITH-JOHN" all throw and
degrade to `[REDACTED]`; every real machine id shape still round-trips, including the
uppercase-hex UUID the account-opening route accepts and the `AB12CD34-EF56` lookalike.

### PF-105 the authority prologue is derived from EVERY sealed parameter

The derivation returned on the first sealed parameter, so declaring the grant before
the tenant asserted only the grant and never cross-checked; a tenant wrapped in an
object escaped both fences; and widening the action type to a union or a type
parameter removed the grant assertion AND the same-tenant proof together.

**Adversarial proof, both fences:** the reversed parameter order fails without the
tenant half and passes with it; `ctx: { tenant: TenantContext }` fails without
`assertSameTenant(ctx.tenant, grant.tenant)` and passes with it; both
`ActionGrant<"pii.view" | "audit.export">` and the generic `ActionGrant<A>` are
refused as unfenceable. `assertActionGrant(grant, 'pii.view')` in the other quote style
passes - the action compares as a VALUE, not as source text. `createSession`, which
takes a `TenantContext` and an `AuthenticatedUser` that CARRIES one, stays buildable.

### PF-106 the SQL fail-closed arm resolves the executor by value

The arm added in PF-099 fell back to the WRITTEN callee name, so a renamed widened
local walked straight through the evasion its own comment named. An unresolvable callee
is now followed back to what it was BOUND from, and a SQL statement handed to an
unresolvable callee is persistence under any name.

**Adversarial proof:** `const run: Function = db.query`, a
`type Runner = (sql: string) => …` alias, a reflected `anyDb.query`, and an opaque
`{ exec: unknown }` are each reported - one assertion per shape plus an exact total of
4, so deleting any single branch fails the companion. `opaque["query"](…)` is reported
through element access, and `cache.lookup({ id })` beside it is not.

### PF-107 the managed-object probe asks what THIS schema owns

`MANAGED_OBJECT_PROBE_SQL` scoped its `pg_class` and `pg_proc` clauses to
`current_schema()` but not its `pg_trigger` clause, so a Verin schema sharing a managed
Postgres with a neighbour owning an `audit_log_no_update` refused to bootstrap, telling
the operator to restore a ledger that never existed.

**Adversarial proof:** a virgin schema beside a `neighbour` schema holding a table,
function, and trigger with OUR names bootstraps every version; reverting the
qualification makes that test fail with the restored-dump diagnostic. The
restored-dump refusal and its zero-mutation proof are unchanged.

### PF-101 - PF-107 verification

```
pnpm exec vitest run   # 54 files, 932 tests passed
pnpm exec eslint .     # clean
pnpm exec tsc --noEmit # clean
pnpm knip              # clean
pnpm v3:invariants     # clean
pnpm golden:validate   # clean
```

**Date:** 2026-07-28 (eighteenth review-fix round on v3 build-sequence prompt 6).

### PF-108 every grant pair agrees before work

`requiredAuthorityPrologue` previously selected only the first `ActionGrant`.
Additional grants received no exact action check and no tenant or actor comparison.

**Adversarial proof:** removing
`assertSameTenant(grant.tenant, piiGrant.tenant)` from
`src/infrastructure/wire.ts` made both authoritative fences fail:

```
src/infrastructure/wire.ts :: startAccountOpening:
assertSameTenant(grant.tenant, piiGrant.tenant) must appear in the contiguous authority prologue
```

The governed-actions enforcement failed at line 1537 and the
tenant-context-required enforcement failed at line 479. Reverted. In-memory
companions cover both grant declaration orders, the opposite symmetric comparison
order, a delayed comparison after SQL, a wrong second action, and all three pairs
among three grants. Omitting any one of the three comparisons produces exactly one
violation.

### PF-109 missing migration ledger is refused without schema mutation

Before the change, a real PGlite store with `schema_migrations` dropped was refused
as non-virgin but gained `schema_migrations` and `schema_migrations_pkey` during the
refusal, while the error claimed no schema change occurred.

**Adversarial proof:** the dropped-ledger regression snapshots all current-schema
relations, indexes, triggers, routines, and seeded household rows before
`runMigrations`. The refusal leaves every snapshot equal and the ledger absent. The
existing empty-ledger, partial-restore, neighbour-schema, and genuinely virgin
bootstrap companions remain green. Driver failures in the new read-only discovery
stage are reduced to the same PII-safe category contract.

### PF-110 sensitive values replace complete occurrences only

Before the change, an exact identity binding for `Ann` projected
`Ann requested an annual review` as
`{{slot_0001}} requested an {{slot_0001}}ual review`.

**Adversarial proof:** the unit companion requires the projected result to equal
`{{slot_0001}} requested an annual review`. The shared complete-occurrence matcher
drives both replacement and the "sensitive entity remained" check, so weakening
only one side fails the same test.

### PF-111 non-plain evidence is refused before and after masking

Before the change, `Date`, `Map`, and class instances were traversed with
`Object.entries`, rebuilt as plain objects, and accepted. A `Date` became `{}` in
the sealed LLM context.

**Adversarial proof:** parameterized unit cases pass each shape nested in evidence
and require `projectForLlm` to fail. The older function-valued evidence case still
proves the post-mask invariant, so moving the check earlier did not replace the
defense-in-depth check.

### PF-108 - PF-111 verification

```
pnpm exec vitest run   # 54 files, 951 tests passed
pnpm exec eslint .     # clean
pnpm exec tsc --noEmit # clean
pnpm knip              # clean
pnpm v3:invariants     # 6 active-pass, 0 active-fail
pnpm golden:validate   # all 16 signed cases passed
pnpm build             # compiled and generated all routes
```

**Date:** 2026-07-28 (nineteenth review-fix round on v3 build-sequence prompt 6).

### PF-112 wrapped authority paths are recursive and complete

The shared authority walker inspected only members named `actor` or `tenant`,
retained at most one wrapped authority of each kind, and suppressed wrapped
authorities whenever a direct one existed.

**Adversarial proof:** test-first companions paired a direct execution grant with
`wrapped.piiGrant` in both parameter orders, then reversed which grant was wrapped.
All four missing pairwise proofs produced zero violations before the change and one
after it. A second companion placed both grants under
`wrapped.authorities`; before the change the repository was reported as carrying no
sealed tenant context, while the complete recursive prologue now passes and omitting
its pairwise comparison fails. Four more permutations destructure a direct or nested
grant before use, preserving its bound name in both parameter orders. Direct and
nested tenant paths likewise fail unless they are compared. Existing integration
coverage proves that `assertSameTenant` refuses both a different tenant and a
different actor in the same tenant.

### PF-113 lowercase identity text requires exact span provenance

`alice requested a transfer` matched no title-case or all-caps person shape, so it
passed the residual check with no subject slot. Supplying an exact identity span did
not help because the resolver never created a candidate for that span.

**Adversarial proof:** the test-first regression required the unbound request and
`hasUnresolvedProjectionText` to fail, then required the exact span for `alice` to
produce `{{slot_0001}} requested a transfer`. Both assertions failed before the
change and pass now. A shortened span is refused, the same unbound shape in untyped
evidence is refused, and ordinary lowercase prose remains accepted.

### PF-114 pending migrations interleave and roll back as one plan

All pending preflights ran before any pending DDL, and each migration then committed
in a separate transaction. A later preflight that queried a relation created by an
earlier pending migration failed with `42P01`.

**Adversarial proof:** synthetic versions 4 and 5 make version 4 create a relation
that version 5 preflights. The valid path failed with `driver-error:42P01` before the
change and now records both versions. The refusing path observes an invalid row
created by version 4, emits the actionable version-5 preflight refusal, and leaves
neither the relation nor any pending ledger row. Repeating the refusal from a
genuinely virgin schema leaves the schema empty, proving that ledger bootstrap and
all baseline DDL roll back too.

### PF-112 - PF-114 verification

```
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false # 54 files, 975 tests passed
pnpm exec eslint .                                          # clean
pnpm exec tsc --noEmit                                      # clean
pnpm knip                                                   # clean
pnpm v3:invariants                                          # 6 active-pass, 0 active-fail
pnpm golden:validate                                        # all 16 signed cases passed
pnpm build                                                   # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

### PF-165 unknown AppError shapes cannot authenticate messages

An object with a recognized `ErrorCode` and attacker-controlled message could
be normalized as trusted and echoed by HTTP responses or retained by failure
classification.

**Adversarial proof:** a test-first dependency-shaped error carries a PII-shaped
message and formatted account context. Accessor variants return changing codes
or throw from the message getter. Before correction, the message reached
`toResponse`. Module-private provenance now preserves messages only for
factory-created errors. Every unknown recognized-code shape returns the static
safe message without reading message or context.

### PF-166 loader provenance survives transparent and fixed wrappers

`Object.freeze(nodeModule).createRequire` and an array-destructured
`Reflect.get` alias both lost loader provenance before dependency, LLM PII,
sealed-factory, and secret-containment analysis.

**Adversarial proof:** both forms were planted in all four consuming fence
companions and initially emitted no `create-require` reference. Transparent
namespace calls and fixed-array builtin aliases now resolve through shared
semantic provenance. Every planted loader is rejected while a guaranteed safe
overwrite remains accepted.

### PF-167 authority provenance survives transparent and fixed wrappers

A stateful carrier getter could be captured and asserted once, then read again
through `Object.freeze(carrier)` or `[carrier][0]` without matching the original
authority path.

**Adversarial proof:** test-first repository fixtures capture and pairwise
assert execution and PII grants, then repeat the PII read through each wrapper
before SQL work. Both initially passed. Exact fixed-element and transparent-call
provenance now resolves both reads to the captured carrier path and rejects each
fixture.

### PF-168 governed call wrappers retain sink and argument ownership

Getter-returned sinks and `bind`, `call`, `apply`, or `Reflect.apply`
invocations produced no governed route entry or treated the invoked target as an
escaped value.

**Adversarial proof:** five test-first routes invoke `verifyAndListOrgChain`
through those forms without authorization. Each initially produced no exact
governed entry. Target, completeness, escape, helper, and effective-argument
analysis now share normalized invocation ownership. Each route derives one
`audit.export` entry and fails the unwired authorization check.

### PF-169 invented generic results expose every sealed position

Generic construction checked only a directly sealed call result. Sealed values
nested in an object, tuple, array, union, overload, or mixed factory-owned
composite disappeared.

**Adversarial proof:** test-first coercion helpers yield all five composite
forms, and a Tokenized factory fixture combines an owned token with a foreign
tenant. Every nested tenant initially passed. Structural yielded-position
inventory now rejects every composite line and both foreign tenant mints while
leaving the owned token and foreign generic validators permitted.

### PF-170 SQL belongs to an exact callable execution phase

All callable members of one exported object shared every implementation owner,
and parameter default SQL inherited body ownership. A guarded sibling could
therefore claim an effectful getter, while a body prologue appeared to authorize
SQL that ran before entry.

**Adversarial proof:** one test-first repository combines a guarded method with
an unguarded SQL getter; another places SQL in a default parameter before a
valid tenant assertion. Both initially passed. Exact member ownership reports
the getter as unowned, and execution-phase analysis reports the default as
pre-body SQL.

### PF-171 final security-boundary verification

```
corepack pnpm vitest run src/__tests__/unit/result.test.ts src/__tests__/fitness/dependency-rule.test.ts src/__tests__/fitness/llm-pii-boundary.test.ts
                                                             # 173 tests passed
corepack pnpm vitest run src/__tests__/fitness/no-secret-fallback.test.ts
                                                             # 40 tests passed
corepack pnpm vitest run src/__tests__/fitness/tenant-context-required.test.ts
                                                             # 143 tests passed
corepack pnpm vitest run src/__tests__/fitness/tokenized-factory-only.test.ts
                                                             # 75 tests passed
corepack pnpm vitest run src/__tests__/fitness/governed-actions.test.ts
                                                             # 118 tests passed
corepack pnpm vitest run src/__tests__/unit/result.test.ts src/__tests__/integration/pii-observability.test.ts src/__tests__/integration/account-opening.test.ts src/__tests__/integration/wire-authority.test.ts
                                                             # 42 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm vitest run src/__tests__/fitness/line-budget.test.ts --reporter=verbose
                                                             # contracts 4,017/4,050; domain 1,259/1,300; infrastructure 3,442/3,450
corepack pnpm test                                           # 56 files, 1,185 tests passed
corepack pnpm knip                                           # clean
corepack pnpm v3:invariants                                  # 6 active-pass, 0 active-fail
corepack pnpm golden:validate                                # all 16 signed cases passed
APP_ENV=development <test-only placeholder env> corepack pnpm build
                                                             # compiled and generated all routes
```

### PF-115 closed authority carriers have one deterministic inventory

Authority discovery previously relied on `type.getProperties()`. Unions expose
only common properties and arrays expose no concrete element path, so a direct
grant beside a conditional, optional, array, or open-record grant could escape
complete discovery.

The shared walker now compares the complete authority-path inventory of every
closed union arm, enumerates fixed tuple positions, and rejects conditional
absence, arrays, open records, and index signatures. It preserves every direct
and nested authority for exact action assertions and pairwise tenant and actor
proofs. Recursive business data remains valid, while a recursive carrier whose
authority cardinality can grow at runtime is refused.

**Adversarial proof:** the equality check between union-arm inventories was
removed while leaving the rest of the walker intact. A synthetic optional
`piiGrant` with a complete-looking assertion and pairwise comparison then passed
with zero violations. The companion failed at
`tenant-context-required.test.ts:813`, expecting one violation and receiving
none. Restoring the inventory comparison made the same test and the full
dual-fence corpus pass.

### PF-116 only factory-owned request structures receive a zero-PII seal

Lowercase identity safety cannot be inferred from the next word or any other
suffix heuristic. `alice must approve the transfer` passed the old heuristic,
while an exact span for `alice` could still be rejected as unused.

`trustedStaticProjectionText` now owns each reviewed literal template and creates
the exact sensitive spans used for masking. The projection accepts only objects
minted by that factory and requires the final masked text to equal the factory's
complete masked structure. Copies, stale text, caller-created provenance,
overlapping spans, and unused spans are refused.

**Adversarial proof:** both factory membership checks were removed while all
other masking and residual checks remained. The arbitrary lowercase request and
ordinary safe prose cases both changed from refusal to successful projection.
Their companion failed at `llm-boundary.test.ts:184`. Restoring both membership
checks made all request-provenance cases pass.

### PF-117 account-reference classification is separator-aware and shared

Account references may be uninterrupted, space-separated, or hyphenated. One
classifier in `contracts/pii.ts` now produces validated spans and derives the
canonical digits used by candidate extraction, request and evidence masking, and
residual refusal. Mixed separators, repeated separators, attached word characters,
and 19-digit runs fail closed as ambiguous.

**Adversarial proof:** the classifier's cluster expression was narrowed back to
uninterrupted digits. The space-separated and hyphenated masking cases then
reported zero candidates, and the residual check accepted
`wire to 1234 5678 9012`. Three companion assertions failed at
`llm-boundary.test.ts:297` and `:453`. Restoring the shared separator-aware
cluster made all account forms and near-misses pass.

### PF-118 dependency write attribution requires complete actor identity

The account-opening dependency adapter compared only organization IDs before
returning the starter's `WriteActor`. A same-organization context for another
human or system actor could therefore be relabeled as the starter.

`actorFor` now calls `assertSameTenant`, which checks organization, actor kind,
and actor ID before any dependency reaches a repository.

**Adversarial proof:** removing only that comparison caused all three real
dependency-call regressions to reach the household repository. Same-org
different-human, human-versus-system, and delegated-actor cases returned
`STORE_CONSTRAINT` instead of the expected pre-work `AUTH_FAILED`; all three
failed at `wire-authority.test.ts:79`. Restoring the comparison made the three
cases pass with zero household writes.

### PF-119 client and observability record IDs share one canonical shape

Generic lowercase slugs are not proof of machine identity. Record families now
parse through one case-insensitive UUID classifier and canonicalize to lowercase.
The household PATCH boundary parses before repository work. Observability's
application, entity, execution, and outbox-row fields accept only the same
machine shape, while invalid failure-path IDs degrade to `[REDACTED]`.

**Adversarial proof:** replacing the household route parser with the former
nonempty-string check changed the lowercase `alice` request from a pre-work 400
to a repository 404; the end-to-end companion failed at
`household-route.test.ts:57`. Separately, allowing invalid record fields to fall
through to the generic slug predicate emitted `alice` instead of `[REDACTED]`;
the observability companion failed at `pii-observability.test.ts:150`. Both
weakening changes were reverted. The mixed-case UUID route still resolves the
lowercase stored row.

### PF-115 - PF-119 verification

```
pnpm test                                                    # 56 files, 996 tests passed
pnpm lint                                                    # clean
pnpm typecheck                                               # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
APP_ENV=development <CI placeholder env> pnpm build          # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

**Date:** 2026-07-28 (twenty-first review-fix round on v3 build-sequence prompt 6).

### PF-120 destructured reflection retains loader provenance

The module-reference walker recognized direct `Reflect.get` but lost the
receiver when `get` was destructured or assigned to another binding. That allowed
a reflected `createRequire` loader to enter an inner layer without a reported
module reference.

**Adversarial proof:** test-first companions acquired `createRequire` through both
`const { get } = Reflect` and `({ get: read } = Reflect)`, including a
`globalThis.Reflect` alias. The dependency
companion reported zero violations before the change. The LLM PII, sealed-factory,
and secret-containment companions likewise missed the same loader. All four scans
now report the shared unresolved loader reference.

### PF-121 wrapped authorities are captured once

Assertions evaluated wrapped authority expressions repeatedly. A stateful getter
could return one grant for validation and another tenant or actor for repository
work.

**Adversarial proof:** a synthetic repository parameter used a class getter for
`carrier.piiGrant`, asserted it directly, compared its tenant directly, and
produced zero violations before the change. It now fails. Capturing the getter
once into a `const`, then using only that binding for the exact action assertion,
pairwise tenant proof, and work passes. Existing direct, destructured-parameter,
closed-union, and fixed-tuple permutations remain covered.

### PF-122 returned callable implementations resolve or fail closed

Returned-callable discovery stopped at object literals and transparent wrappers.
A private class instance, a conditional return, or an opaque local builder made
an escaped factory's methods disappear from tenant and governed-sink inspection.

**Adversarial proof:** test-first factories returned either a private class or an
object literal with the same unguarded method. Both the tenant and governed-sink
detectors reported zero violations before the change and now report both live
implementations. A separate factory returning an interface from an unresolved
builder now reports its method as an unverifiable execution boundary instead of
silently dropping it. A callable getter on a private returned class is likewise
resolved to its returned function and checked.

### PF-123 every sealed union arm agrees at the same position

Sealed reshape analysis accepted the first union arm that exposed a sealed type.
`TenantContext | string` and the nested equivalent could therefore be asserted as
sealed authority.

**Adversarial proof:** direct and nested mixed-arm casts produced zero construction
findings before the change. Both now fail. A union whose every arm carries
`TenantContext` at the same property and an intersection that retains
`TenantContext` both remain clean, proving the correction distinguishes alternative
runtime values from simultaneous constraints.

### PF-120 - PF-123 verification

```
pnpm test                                                    # 56 files, 1,011 tests passed
pnpm lint                                                    # clean
pnpm typecheck                                               # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
pnpm vitest run src/__tests__/fitness/line-budget.test.ts    # contracts 3,998; domain 1,250; infrastructure 3,382
APP_ENV=development <test-only placeholder env> pnpm build   # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

### PF-172 error classification uses authenticated provenance

Observability treated any frozen object as an authenticated `AppError`.
`Object.isFrozen` could execute an untrusted proxy trap, and a frozen SQLSTATE
object lost its driver classification.

**Adversarial proof:** test-first integration cases supplied a frozen
`{ code: "23505" }`, an actual factory-created `AppError`, and a proxy whose
extensibility trap throws PII-shaped text. The frozen driver value initially
became `unexpected-error`, and the proxy escaped classification. The restrictive
trusted-only normalization path now recognizes only module-authenticated
instances. Guarded single reads retain `driver-error:23505`, the proxy cannot
throw, and none of its text reaches the reason.

### PF-173 governed bindings retain sink and argument provenance

Governed target discovery recognized a `bind` wrapper only while it was
immediately invoked. Storing the bound callable in an alias, returning it from a
helper, or placing it in a fixed container erased the route requirement.

**Adversarial proof:** test-first routes invoked `verifyAndListOrgChain` through
a declaration alias, later assignment, helper return, and fixed array. Every
route initially produced no governed entry. The same fixtures now retain the
exact `audit.export` sink. Separate companions compose arguments across direct,
nested-bound, and `call` invocation: authorized grants pass at the effective
parameter, and missing grants fail.

### PF-174 inferred generics expose every sealed position

Invented generic detection traversed composite sealed positions only for
explicit type arguments. A contextual target could infer an object containing a
`TenantContext` while the direct yielded type check saw no seal.

**Adversarial proof:** a test-first fixture assigned `coerce()` to inferred
object, tuple, array, and union targets containing `TenantContext`. All four
initially passed. Complete sealed-position inventory now runs for inferred and
explicit yields alike, and every planted mint fails at its source line.

### PF-175 authority provenance survives aliased fixed containers

Repeated-authority detection resolved only inline fixed arrays. An
accessor-backed carrier stored in an `as const` array, object, or later-assigned
tuple could be read again after the stable prologue capture under a different
source spelling.

**Adversarial proof:** test-first tenant-boundary fixtures captured
`carrier.piiGrant`, then reread it through each of those three aliases before
repository work. Every reread initially escaped. Fixed-member provenance now
follows initializers and all reaching assignments back to the original carrier,
and all three emit the repeated-evaluation violation.

### PF-176 parameter-default effects are transitively pre-body

SQL ownership recognized a query physically inside a parameter initializer but
not one reached by calling a local helper from that initializer. The later body
prologue was incorrectly allowed to authorize work that had already executed.

**Adversarial proof:** a test-first repository fixture called a two-helper chain
from a parameter default, with the final helper issuing `db.query`. It initially
passed. Pre-body execution analysis now follows statically resolved helper calls
transitively and emits one exact `<pre-body-sql>` violation, while ordinary
body-owned SQL remains governed by its callable boundary.

### PF-177 line-budget evidence remains exact

The correction adds narrowly shared contract and analyzer behavior without
changing a measured ceiling or deleting useful material.

**Adversarial proof:** the authoritative real measurement and its synthetic
over-budget and empty-bucket companions pass at contracts 4,021/4,050 (29
headroom), domain 1,260/1,300 (40), infrastructure 3,440/3,450 (10), and
presentation 918/6,000 (5,082). No ceiling amendment is needed.

### PF-178 canonical machine identity outranks partial PII resemblance

The shared formatted-account classifier correctly failed closed on ambiguous
numeric clusters, but a generated UUID could contain such a cluster as only one
part of its complete machine identifier. Those UUIDs failed observability
nondeterministically when used as actor IDs.

**Adversarial proof:** the production walkthrough generated
`63235503-52cc-43df-a81a-2517e7f45884`, then failed account opening with
`PII_VIOLATION` before workflow work. A focused regression reproduced the same
refusal. The observability boundary now accepts the complete canonical machine
UUID first, while existing uninterrupted, space-separated, and hyphenated
account references remain refused. The focused integration case and all 17
end-to-end tests pass.

### PF-172 - PF-178 verification

```
corepack pnpm test                                          # 56 files, 1,198 tests passed
corepack pnpm test:fitness                                  # 35 files, 856 tests passed
corepack pnpm typecheck                                     # clean
corepack pnpm lint                                          # clean
corepack pnpm knip                                          # clean
corepack pnpm v3:invariants                                 # 6 active-pass, 0 active-fail
corepack pnpm golden:validate                               # all 16 signed cases passed
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts --reporter=verbose
                                                             # contracts 4,021/4,050; domain 1,260/1,300; infrastructure 3,440/3,450
APP_ENV=development <CI placeholder env> corepack pnpm build # compiled and generated all routes
corepack pnpm test:e2e                                      # 17 tests passed
```

**Date:** 2026-07-28 (twenty-second review-fix round on v3 build-sequence prompt 6).

### PF-124 every repeated sealed sibling remains a distinct structural path

The sealed-position walker deduplicated visits by type text and depth across the
whole traversal. Two sibling properties with the same sealed type therefore shared
one visited key, and the second path disappeared.

**Adversarial proof:** a source with checked `primary: TenantContext` and unchecked
`secondary` was cast to the same shape with both properties sealed. A second case
passed the same pair through a contextual composite literal. The test-first
companion reported no cast violation before the change and failed at
`tokenized-factory-only.test.ts:1753`. Path-local cycle state makes both the cast and
contextual-literal assertions fail closed while preserving recursive-cycle
termination.

### PF-125 object-literal callable getters reach both execution fences

Returned-callable discovery handled class accessors but silently skipped the same
getter declaration in an object literal. A factory could therefore return a callable
repository getter whose SQL or PII behavior disappeared from analysis.

**Adversarial proof:** tenant and governed-sink companions each returned zero
violations for an object-literal getter returning an unguarded callable. The initial
run failed at `tenant-context-required.test.ts:1444` and
`governed-actions.test.ts:2064`. Both now resolve the returned arrow implementation
and report its missing authority guard.

### PF-126 later destructuring reads cannot re-evaluate a wrapped authority

Stable capture enforcement inspected property, element, and call expressions but
not binding elements or destructuring assignments. A stateful carrier getter could
be captured and asserted in the prologue, then invoked again by destructuring before
repository work.

**Adversarial proof:** both `const { piiGrant: later } = carrier` and
`({ piiGrant: later } = carrier)` produced zero violations after an otherwise valid
captured prologue. Both test-first permutations failed at
`tenant-context-required.test.ts:854`. The analyzer now resolves each destructured
read through aliases and nested member paths back to the captured carrier source,
and both produce the exact once-only violation.

### PF-127 authority-producing dynamic carriers are unfenceable

Authority inventory ignored call signatures, construct signatures, methods, and
callable or constructable properties. A parameter could therefore mint a second
runtime grant after the prologue without an exact action assertion or pairwise tenant
and actor proof.

**Adversarial proof:** five providers - direct call, direct construction, method,
callable property, and constructable property - all produced zero violations before
the change and failed at `tenant-context-required.test.ts:870`. Every form now
produces one unfenceable-inventory violation. Project-owned return shapes and generic
containers are followed semantically, while library method graphs are not expanded.

### PF-124 - PF-127 verification

```
pnpm exec vitest run src/__tests__/fitness/tokenized-factory-only.test.ts \
  src/__tests__/fitness/tenant-context-required.test.ts \
  src/__tests__/fitness/governed-actions.test.ts            # 237 tests passed
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false # 56 files, 1,021 tests passed
pnpm lint                                                    # clean
pnpm typecheck                                               # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # contracts 3,998; domain 1,250; infrastructure 3,382
APP_ENV=development <test-only placeholder env> pnpm build  # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

**Date:** 2026-07-28 (twenty-third review-fix round on v3 build-sequence prompt 6).

### PF-128 wrapped reflection cannot hide a module loader

The module-reference walker recognized direct `Reflect.get` but not its `bind`,
`call`, or `apply` wrappers. Those forms could obtain `node:module.createRequire`
without leaving a reference for any consuming security fence.

**Adversarial proof:** test-first companions acquired `createRequire` through
`Reflect.get.bind(Reflect)`, `Reflect.get.call(...)`, literal
`Reflect.get.apply(...)`, and an unresolved `apply` argument list. Before the
walker change, the dependency companion reported no layer violation and the LLM
PII, sealed-factory, and secret-containment companions reported no unresolved
load. All forms now produce the shared fail-closed module reference.

### PF-129 sealed positions are complete and overload-specific

Sealed-position discovery silently stopped at a recursive cycle or depth limit and
used one unindexed return step for every call and construct overload. A checked
shallow value or first overload could therefore hide an unchecked sealed position.

**Adversarial proof:** test-first casts covered a recursive target, a sealed target
beyond the depth limit, and a two-overload callable whose second source overload
returned `unknown`. All three initially produced no cast finding. The inventory
now records incomplete traversal as a refusal and indexes every call and construct
return, so all three casts fail while complete union and intersection reshapes
remain clean.

### PF-130 nested unchecked values fail every sealed assignment boundary

Annotation enforcement checked whether the whole source was `any` or `unknown`.
An object such as `{ tenant: any }` could initialize, assign, return, default, or
flow into a parameter typed `{ tenant: TenantContext }`.

**Adversarial proof:** one test-first fixture exercised variable initialization,
later assignment, function return, parameter default, and call arguments using
both nested `any` and nested `unknown`. Every boundary initially produced no
unchecked-value finding. The shared sealed-position source-versus-target check now
reports all six sites, while checked composite propagation remains accepted.

### PF-131 asserted authority bindings cannot be reassigned

Direct authority parameters were treated as stable even though JavaScript
parameters are mutable. Repository work could receive a replacement grant or
tenant after the original value passed its prologue assertion.

**Adversarial proof:** direct assignment, destructuring assignment, a `for-of`
loop target, and reassignment of a destructured authority parameter each replaced
an asserted `ActionGrant<"pii.view">` before SQL work. All forms initially produced
zero violations. Symbol-resolved write detection now reports each replacement. A
nested function that assigns its unrelated shadow parameter remains clean.

### PF-132 callback-supplied authorities are dynamic carriers

Authority inventory inspected callable returns but ignored authorities delivered
through callback parameters. A provider could invoke a callback with a second
tenant, grant, actor, or principal after the prologue.

**Adversarial proof:** test-first provider signatures supplied `ActionGrant`,
`TenantContext`, `ActorRef`, `Principal`, and `WriteActor` through callback
parameters, including method and nested-callback forms. Every form initially
produced zero violations. The memoized callable-parameter traversal now marks each
provider unfenceable without expanding ordinary project callback containers such
as workflow definitions.

### PF-133 governed classification follows nested authority paths

Governed-sink derivation and reviewed pre-auth PII escapes classified only direct
parameter types. Wrapping a tenant or PII grant in an object could make a governed
read appear unbounded and eligible for a pre-auth escape.

**Adversarial proof:** test-first PII reads accepted either
`{ tenant: TenantContext }` or
`{ grant: ActionGrant<"pii.view"> }`. Both were initially retained as reviewed
pre-auth reads. Shared recursive classification now makes both escapes stale and
derives `pii.view` governed sinks. Dynamic authority carriers are also treated as
boundaries and cannot regain the escape.

### PF-134 retry ownership is proven before step work

`retryFlow` entered `drive` without checking that the failed execution belonged to
the supplied tenant. A step could write under the supplied tenant before the
execution store rejected the mismatched state on save.

**Adversarial proof:** a real PGlite integration test persisted a failed
organization-A execution, retried it with organization B's sealed tenant, and
gave the step a real organization-B household write. Before the ownership check,
the step ran and the household was committed before the execution save failed.
The retry now returns `AUTH_FAILED`, the step counter remains zero, and no
household row is written.

### PF-128 - PF-134 verification

```
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false # 56 files, 1,044 tests passed
pnpm lint                                                    # clean
pnpm typecheck                                               # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # contracts 3,998; domain 1,250; infrastructure 3,382
APP_ENV=development <test-only placeholder env> pnpm build   # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

**Date:** 2026-07-29 (twenty-fourth review-fix round on v3 build-sequence prompt 6).

### PF-135 cross-tenant retry refusals return no foreign state

The pre-work ownership check stopped execution and writes but returned the
foreign execution's PII-bearing data in its `AUTH_FAILED` result.

**Adversarial proof:** the real PGlite regression persisted a failed organization-A
execution containing a sentinel foreign client name, then retried it with
organization B's sealed tenant. The test-first assertion failed at
`tenant-isolation.test.ts:229` because the sentinel was returned. The refusal now
returns an empty payload, and independent step and execution-store save counters
both remain zero.

### PF-136 property descriptors cannot hide a module loader

The shared module-reference walker recognized direct and reflected
`node:module.createRequire` reads but not descriptor-based property reads.

**Adversarial proof:** a test-first
`Object.getOwnPropertyDescriptor(nodeModule, "createRequire")!.value` loader
produced no layer violation and no unresolved loader finding. The four consuming
companions failed at `dependency-rule.test.ts:223`,
`llm-pii-boundary.test.ts:1130`, `no-secret-fallback.test.ts:766`, and
`tokenized-factory-only.test.ts:2283`. The shared accessor analysis now catches
direct, destructured, bound, call, apply, Object and Reflect descriptor,
plural-descriptor, and unresolved-key forms. A statically different descriptor
property remains clean.

### PF-137 factory ownership is checked at every sealed position

Sealed annotation analysis selected the first reachable sealed type and exempted
the complete target when the current module owned that one factory. A locally
owned `Tokenized` position could therefore hide a forged sibling
`TenantContext`.

**Adversarial proof:** inside the tokenization factory, a test-first composite
annotation filled both `Tokenized<string>` and `TenantContext` from `JSON.parse`.
The expected foreign-seal finding was absent and failed at
`tokenized-factory-only.test.ts:1528`. The position inventory now carries exact
factory ownership, exempts only `Tokenized`, and reports the unchecked
`TenantContext`.

### PF-138 untrusted error codes are captured once

`safeReason` called `isAppError` and then re-read `error.code` for interpolation
or SQLSTATE classification. A stateful getter could change the emitted value, and
a throwing getter could replace the original failure.

**Adversarial proof:** a test-first getter returned `INTERNAL` once and a sentinel
PII value afterward. It failed at `pii-observability.test.ts:78` because repeated
reads changed the classification. The regression now proves app and driver codes
are each read exactly once, while a throwing getter returns
`unexpected-error` after one guarded read.

### PF-135 - PF-138 verification

```
pnpm exec vitest run src/__tests__/integration/tenant-isolation.test.ts \
  src/__tests__/integration/pii-observability.test.ts \
  src/__tests__/fitness/dependency-rule.test.ts \
  src/__tests__/fitness/llm-pii-boundary.test.ts \
  src/__tests__/fitness/no-secret-fallback.test.ts \
  src/__tests__/fitness/tokenized-factory-only.test.ts        # 257 tests passed
pnpm test -- --maxWorkers=1 --fileParallelism=false           # 56 files, 1,057 tests passed
pnpm typecheck                                                # clean
pnpm lint                                                     # clean
pnpm knip                                                     # clean
pnpm v3:invariants                                            # 6 active-pass, 0 active-fail
pnpm golden:validate                                          # all 16 signed cases passed
pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                              # contracts 4,000; domain 1,250; infrastructure 3,383
APP_ENV=development <test-only placeholder env> pnpm build    # compiled and generated all routes
pnpm test:e2e                                                 # 17 tests passed
```

**Date:** 2026-07-29 (twenty-fifth review-fix round on v3 build-sequence prompt 6).

### PF-139 SQL executor wrappers retain persistence semantics

SQL discovery inspected the outer `call`, `apply`, or `bind` signature and could
return clean before reaching the underlying executor. App-layer refusal,
repository discovery, and governed read/write classification could therefore
disagree about the same database operation.

**Adversarial proof:** test-first `db.query.call`, `db.query.apply`,
`db.query.bind`, and `Reflect.apply(db.query, ...)` fixtures initially produced no
app-layer or tenant violations. The shared normalizer now recovers the executor,
receiver, effective argument list, and resolution state. Separate wrapped UPDATE
fixtures prove governed classification consumes the effective SQL argument and
retains the write-only exemption.

### PF-140 authority carrier copies are repeated evaluations

Authority stability tracked direct member and destructuring reads but not copying
an ancestor carrier. Object copies invoke accessor properties again and could
produce a different grant after the prologue.

**Adversarial proof:** test-first object spread, object rest, and
`Object.assign` copies of a stateful getter carrier initially produced zero
violations. The regression now covers direct, assigned, destructured-assigned,
and aliased copy helpers plus `structuredClone`. Every copy is tied back to the
captured authority path, while independent sibling captures remain valid.

### PF-141 node:module namespace copies cannot hide createRequire

Loader provenance followed direct identifiers but stopped at copied module
namespace objects and top-level `Reflect.apply` accessor invocation.

**Adversarial proof:** test-first object spread, `Object.assign`, and
`Reflect.apply(Reflect.get, ..., [nodeModule, "createRequire"])` loaders initially
passed the dependency, LLM PII, sealed-factory, and secret-containment companions.
All four fences now consume the shared copied-namespace and accessor provenance,
and each planted loader emits a `create-require` reference.

### PF-142 opaque factory returns cannot erase repository members

Returned-callable discovery emitted nothing when an escaped factory delegated to
a helper whose declared result was `any` or `unknown`. The escape could therefore
hide every returned repository method.

**Adversarial proof:** test-first escaped SQL and governed factories returned
opaque helper results. Both initially produced no returned member violation. An
opaque declared factory return now emits an explicit unresolved callable finding;
ordinary opaque repository results continue through their existing tenant or
governed-output checks without being misclassified as factories.

### PF-143 observability identifiers share account classification

The observability boundary used an uninterrupted-digit regex while the LLM
boundary used the shared separator-aware account classifier. A hyphenated or
space-separated account reference could therefore be sealed and emitted as an
identifier.

**Adversarial proof:** a test-first `1234-5678-9012` organization and actor value
was accepted by `observabilityId`. Both now throw because every identifier passes
through `hasSensitiveAccountReference`, the same classifier used for extraction,
masking, and residual LLM refusal.

### PF-144 accepted errors become read-once snapshots

`isAppError` validated one `code` read and returned the original object.
Downstream response and audit paths could reread stateful or throwing accessors,
changing the code, leaking a message, or replacing the original failure.

**Adversarial proof:** test-first stateful `code` and `message` accessors showed
multiple reads, while a throwing message accessor escaped response mapping.
`normalizeAppError` now performs guarded single reads and returns a new frozen
snapshot. Stateful values are read once, throwing values degrade to the closed
INTERNAL response, and accepted non-conflict audit errors rethrow the snapshot
rather than the hostile source.

### PF-139 - PF-144 verification

```
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false  # 56 files, 1,085 tests passed
pnpm typecheck                                               # clean
pnpm lint                                                    # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # contracts 4,017/4,050; domain 1,250/1,250; infrastructure 3,390/3,400
APP_ENV=development <test-only placeholder env> pnpm build   # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

**Date:** 2026-07-29 (twenty-sixth review-fix round on v3 build-sequence prompt 6).

### PF-145 migration ledgers are exact shipped prefixes

Migration startup treated recorded versions as an unordered set and ignored
recorded names. A restored ledger with a gap, extra version, swapped name, or
renamed row could skip a shipped migration while startup succeeded.

**Adversarial proof:** test-first restored PGlite stores corrupted the ledger in
all four ways and retained sentinel managed rows. Each case previously reached
startup without an exact-history refusal. Startup now compares every ordered
version and name to the same position in `MIGRATIONS` before pending work. The
regression snapshots relations, indexes, triggers, routines, constraints, rows,
and ledger contents and proves each refusal changes none of them.

### PF-146 multi-action sinks retain every authorization

Governed sink derivation selected only the first `ActionGrant` action and allowed
a governed output to replace it. `startAccountOpening` therefore surfaced only
`execution.initiate`, dropping `pii.view` from route enforcement.

**Adversarial proof:** a test-first two-grant sink and route omitted each
authorization in turn. The omitted second action initially produced no route
violation. Derivation now emits and deduplicates by action, and each permutation
produces exactly one missing-action violation. A route passes only when both
authorized values reach their respective grant parameters.

### PF-147 node module aliases retain every reaching source

Namespace provenance followed the latest textual assignment. A conditionally
replaced alias could therefore look safe even on paths retaining `node:module`,
and `Object.fromEntries(Object.entries(namespace))` copies were invisible.

**Adversarial proof:** test-first conditional-replacement and `fromEntries`
loaders initially disappeared from the module-reference result. Both now emit a
`create-require` reference in the dependency, LLM PII, sealed-factory, and
secret-containment companions.

### PF-148 SQL aliases retain executor and builtin provenance

SQL normalization recognized direct wrappers but not destructured
`Reflect.apply` or executor aliases introduced by later assignments and
destructuring assignments.

**Adversarial proof:** test-first SELECT and UPDATE fixtures called later-bound
executor aliases through a destructured ambient `apply`. App-layer SQL refusal
and repository discovery initially produced no findings for those calls. The
shared normalizer now finds them, preserves the effective SQL argument, and feeds
tenant and governed mutation classification.

### PF-149 authority aliases retain every carrier provenance

Repeated-authority detection converted non-identifier sources to written text and
selected one assignment. Conditional, logical, and later-assigned aliases could
therefore invoke a stateful carrier getter again without matching the captured
authority path.

**Adversarial proof:** test-first aliases using conditional, logical, and later
assignment forms initially produced no repeat-evaluation finding after a valid
capture. The shared source resolver now retains every reaching carrier source,
and each planted getter read fails while the stable captured binding remains
accepted.

### PF-150 unknown driver metadata is captured once

Audited writes and account-opening duplicate handling read untrusted driver
properties independently. Proxy traps and stateful or throwing accessors could
escape a catch, change classification, or replace the original failure.

**Adversarial proof:** test-first stateful and throwing `code` accessors exercised
both end-user paths. Each accessor is now read exactly once behind a guarded
classification whose raw fields never leave the boundary. Audited writes return
`STORE_CONSTRAINT` or `INTERNAL` as appropriate, and account opening returns a
typed INTERNAL failure without throwing or performing replay work.

### PF-151 line-budget growth is measured and bounded

The first complete correction measured 3,413 lines against the 3,400 ceiling.
A genuine simplification of ledger-row comparison removed duplication, while the
final boundary audit replaced exported raw error fields with a safe closed
classification. The final 3,437-line measurement still required an amendment.

**Adversarial proof:** the unchanged ceiling failed both the authoritative real
check and its companion. ADR-0036 raises only infrastructure to the smallest
rounded envelope, 3,450. Final measurements are contracts 4,017/4,050, domain
1,250/1,250, infrastructure 3,437/3,450, and presentation 918/6,000.

### PF-145 - PF-151 verification

```
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false  # 56 files, 1,107 tests passed
pnpm typecheck                                               # clean
pnpm lint                                                    # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # contracts 4,017/4,050; domain 1,250/1,250; infrastructure 3,437/3,450
APP_ENV=development <test-only placeholder env> pnpm build   # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

### PF-152 every SQL call has a checked callable owner

SQL-backed infrastructure discovery checked exported callable signatures but did
not prove that each executor call belonged to one. Module initialization, IIFEs,
static blocks, and exported promise or data initializers could therefore execute
SQL without any callable boundary carrying sealed authority.

**Adversarial proof:** test-first fixtures planted SQL in each of those five
unowned forms. All initially produced no tenant violation. The fence now maps
every executor call to an actual exported, returned, or class callable
implementation, or recursively proves that every call to a local helper is owned
by one. Each planted form emits exactly one `<unowned-sql>` violation, while a
scoped exported boundary and its solely reached local helper remain accepted.

### PF-153 ambient builtin aliases retain every reaching source

SQL wrapper normalization recognized only the literal `Reflect` receiver.
Aliases initialized or assigned from the ambient builtin could invoke
`Reflect.apply` while disappearing from app-layer SQL, repository, tenant, and
governed-action analysis.

**Adversarial proof:** test-first app and repository fixtures invoked SQL through
a constant alias, a later-assigned alias, a six-link alias chain, and an alias
with a conditional safe replacement. The app calls initially emitted no raw-SQL
finding. Shared ambient-builtin resolution now follows every potentially
reaching initializer and assignment source, and each call is normalized
identically to direct `Reflect.apply`.

### PF-154 node module provenance survives named members

The module-reference walker retained namespace provenance through copies but not
through named object properties. A holder could therefore store `node:module`
under a nested member and expose `createRequire` without a module reference.

**Adversarial proof:** test-first direct, nested, later-assigned, and
conditionally keyed holder fixtures initially bypassed dependency analysis.
Named member resolution now follows object literal values and every potentially
reaching property assignment, expanding unresolved keys conservatively. The
dependency, LLM PII, sealed-factory, and secret-containment companions all reject
the indirect loader.

### PF-155 reflective authority reads retain carrier provenance

Repeated-authority analysis tracked direct property, element, destructuring, and
copy reads but not reflective property access. A stateful getter could be invoked
again after a valid prologue capture and return a different tenant or actor.

**Adversarial proof:** test-first fixtures reread a captured `piiGrant` through
direct and aliased `Reflect.get`, constant and unresolved keys, property
descriptors, and `call`, `apply`, `bind`, and `Reflect.apply` wrappers. Every form
initially escaped the repeat-evaluation finding. One normalized builtin
invocation now retains exact literal paths and expands unresolved keys to the
carrier, so every planted reread fails.

### PF-156 governed logical callees retain every arm

Governed call target discovery traversed conditionals but not logical operators.
Its traversal identity also used only a source offset, causing a compound
expression to collide with its leftmost child and silently discard that arm.

**Adversarial proof:** test-first `&&`, `||`, and `??` callees placed a governed
sink in each arm permutation. The affected arm initially produced no route
entry. Traversal now visits every value-producing arm with kind, start, and end
identity, so all three produce the expected route requirement. A known sink
combined with an unresolved callable arm produces an explicit fail-closed
violation.

### PF-157 line-budget evidence remains exact

The correction changes fitness analyzers, adversarial companions, and evidence,
not platform-layer implementation.

**Adversarial proof:** the authoritative real measurement and its synthetic
over-budget and empty-bucket companions pass at contracts 4,017/4,050 (33
headroom), domain 1,250/1,250 (0), infrastructure 3,437/3,450 (13), and
presentation 918/6,000 (5,082). No ceiling amendment is needed.

### PF-152 - PF-157 verification

```
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false  # 56 files, 1,139 tests passed
pnpm typecheck                                               # clean
pnpm lint                                                    # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # contracts 4,017/4,050; domain 1,250/1,250; infrastructure 3,437/3,450
APP_ENV=development <test-only placeholder env> pnpm build   # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

### PF-158 resume validates the runtime tenant seal before capability load

`resumeFlow` loaded a continuation by signed token before validating the runtime
`TenantContext` seal. A forged matching-organization object could therefore
expose PII-bearing state or start work before persistence rejected it.

**Adversarial proof:** a test-first PGlite regression stores sentinel foreign
state behind a continuation token and calls `resumeFlow` with a forged context.
It initially loaded the continuation and started the step. The runtime seal is
now asserted first, and the regression proves zero loads, saves, step runs, and
durable writes while the sentinel remains absent from the failure.

### PF-159 node module provenance survives fixed arrays and tuples

Module-reference discovery followed named object members but not fixed array or
tuple members. A namespace stored at index zero could expose `createRequire`
without appearing in any module-consuming fence.

**Adversarial proof:** test-first fixtures use direct array indexing and array
destructuring to reach `node:module.createRequire`. Both initially produced no
module reference. Shared namespace provenance now resolves exact fixed elements
and expands unresolved indexes conservatively. Dependency, LLM PII,
sealed-factory, and secret-containment companions all reject both loaders.

### PF-160 builtin aliases retain conditional reaching sources

Builtin accessor resolution selected the latest textual assignment. A
conditionally executed safe replacement could therefore erase the reachable
initial `Reflect.get` source.

**Adversarial proof:** test-first fixtures initialize an accessor from
`Reflect.get`, conditionally replace it with a safe function, and then obtain
`createRequire`. Every loader-consuming fence initially accepted the fixture.
Resolution now starts at the latest guaranteed write and retains every later
potential source, so each planted loader fails.

### PF-161 factory ownership is checked at every sealed position

Cast and contextual construction treated the first reachable sealed type as the
owner of a whole composite. Inside the Tokenized factory, a valid
`Tokenized<T>` position could therefore hide a forged sibling `TenantContext`.

**Adversarial proof:** a test-first factory fixture places owned Tokenized and
foreign TenantContext positions together in casts, contextual literals,
initializers, assignments, returns, parameter defaults, and call arguments.
The foreign sibling initially disappeared. Every sealed position now receives
its own factory-ownership and source check, and each planted TenantContext mint
fails while the owned Tokenized position remains permitted.

### PF-162 governed sink values retain later and returned sources

Governed target discovery followed declaration initializers but not later
assignments or helper return values. A route could invoke the same sink through
either form without acquiring a governed route entry.

**Adversarial proof:** test-first routes assign `verifyAndListOrgChain` after
declaration and return that alias from a local selector. Both initially produced
no route entry. Target and completeness analysis now retain those reaching
sources. Correctly authorized routes pass, while matching routes with no
authorization produce one exact `audit.export` failure.

### PF-163 SQL builtin aliases survive fixed arrays

SQL normalization resolved object destructuring but not fixed-array binding or
member aliases. A destructured `Reflect.apply` could execute raw SQL without
reaching app-layer, repository, tenant, or governed-action analysis.

**Adversarial proof:** test-first app and repository fixtures invoke SQL through
`const [apply] = [Reflect.apply]` and `methods[0]`. The app calls initially
produced no raw-SQL finding. Shared SQL provenance now resolves both exact
elements. App-layer refusal reports both calls, repository discovery requires
tenant scope, and mutation classification remains intact for governed analysis.

### PF-164 domain line-budget growth is measured and bounded

The runtime seal correction added one domain line to a layer at its 1,250-line
ceiling. Removing documentation or compressing the assertion into another
statement would manufacture room without simplifying ownership.

**Adversarial proof:** the unchanged ceiling failed both the authoritative real
check and its companion at 1,251 lines. ADR-0037 raises only domain to the
smallest rounded envelope, 1,300. Final measurements are contracts
4,017/4,050, domain 1,251/1,300, infrastructure 3,437/3,450, and presentation
918/6,000.

### PF-158 - PF-164 verification

```
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false  # 56 files, 1,166 tests passed
pnpm typecheck                                               # clean
pnpm lint                                                    # clean
pnpm knip                                                    # clean
pnpm v3:invariants                                           # 6 active-pass, 0 active-fail
pnpm golden:validate                                         # all 16 signed cases passed
pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # contracts 4,017/4,050; domain 1,251/1,300; infrastructure 3,437/3,450
APP_ENV=development <test-only placeholder env> pnpm build   # compiled and generated all routes
pnpm test:e2e                                                # 17 tests passed
```

### PF-179 app-error reasons use the exact reviewed error vocabulary

The reason predicate accepted any uppercase `app-error:` suffix. An
attacker-controlled value such as `app-error:ALICE` could therefore reach logs
while the structural vocabulary check remained green.

**Adversarial proof:** a test-first regression submitted `app-error:ALICE`
beside the real `app-error:INTERNAL`. The former initially passed the predicate.
The predicate now delegates its suffix to the exact `ErrorCode` classifier, so
the planted name is refused and the reviewed code remains accepted.

### PF-180 observable record IDs require mint provenance

Canonical UUID shape was treated as trust authority. A request-derived UUID
containing account digits could therefore be emitted verbatim by the
observability identifier boundary.

**Adversarial proof:** test-first regressions passed raw canonical UUIDs,
including `00000000-0000-0000-0000-941000517334`, and initially received the
same value. Generated IDs now require a runtime-sealed direct `randomUUID` mint.
Request IDs use a tenant- and field-scoped keyed digest, and unclassifiable
values redact. A live shipped-source challenge temporarily called the generated
mint with caller text. The authoritative fence failed at
`src/infrastructure/observability/record-id.ts:41`, naming the missing
`node:crypto randomUUID` provenance. The violation was reverted and the same
36-test fence passed. Additional companions invoke both generated and keyed
factories through `Function.call`; each is refused because wrapped invocation
would hide the argument positions whose provenance the fence verifies.

### PF-181 failure auditing survives identifier refusal

Redacting or hashing a request identifier must not suppress the audit event that
records the failed governed action.

**Adversarial proof:** the household route receives a crafted account-bearing
canonical UUID and reaches its not-found failure. Its operational failure log
contains only the stable keyed identifier with no account digits. The
tamper-evident audit row is still written with
`household.update.failed` and the governed record ID.

### PF-182 evidence cycle detection follows the ancestor path

Candidate collection used one global visited set. Two sibling paths sharing the
same evidence object were therefore rejected as cyclic even though no recursive
path existed.

**Adversarial proof:** a test-first evidence graph places one object in two
household array positions. It initially returned a cycle failure. The walker now
removes each object when its branch unwinds, so the shared DAG yields one
deduplicated slot while an actual ancestor cycle remains refused.

### PF-183 observability provenance growth is measured and bounded

The provenance wrapper and keyed digest boundary raised domain and
infrastructure above their prior ceilings. Removing boundary checks or
compressing documentation would manufacture room without simplifying
ownership.

**Adversarial proof:** the first complete correction failed at domain
1,334/1,300 and infrastructure 3,494/3,450. The sealed-factory gate then exposed
an unnecessary parallel seal; removing it reduced the final measurements to
domain 1,298 and infrastructure 3,484. Leaving 2 and 16 lines under the nearest
unchanged or rounded ceilings would not provide honest correction headroom.
ADR-0038 raises only those layers. Final measurements are contracts
4,021/4,050, domain 1,298/1,350, infrastructure 3,484/3,550, and presentation
918/6,000.

### PF-184 the full gate bounds semantic-project concurrency

Running every file concurrently made several independent ts-morph semantic
projects compete for CPU. Five fitness checks exceeded the unchanged 20-second
per-test timeout even though 1,201 tests passed and none produced an assertion
failure.

**Adversarial proof:** the unconstrained full run failed only the five timed-out
AST checks across three files. The CI-facing `pnpm test` command now uses one
worker with file parallelism disabled. With the same per-test timeout and
assertions, it passed all 56 files and 1,208 tests.

### PF-179 - PF-184 verification

```
corepack pnpm test                                           # 56 files, 1,208 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm knip                                           # clean
corepack pnpm v3:invariants                                  # 6 active-pass, 0 active-fail
corepack pnpm golden:validate                                # all 16 signed cases passed
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # contracts 4,021/4,050; domain 1,298/1,350; infrastructure 3,484/3,550
APP_ENV=development <test-only placeholder env> corepack pnpm build
                                                             # compiled and generated all routes
corepack pnpm test:e2e                                       # 17 tests passed
```

### PF-185 keyed observability digests include the normalized record value

The keyed-record provenance fence searched a digest initializer for any
`createHmac` call. Removing the normalized record value from the HMAC input
therefore collapsed every record in one tenant and field to one digest while
the 36-test fitness file remained green.

**Adversarial proof:** before the correction, the live record-id implementation
was changed from `["v1", tenant.orgId, field, value.toLowerCase()]` to
`["v1", tenant.orgId, field]`. The observability-vocabulary fitness file still
passed all 36 tests. After the correction, the same injection failed at
`src/infrastructure/observability/record-id.ts:33`, naming the untrusted keyed
mint. The integration companion also failed because two distinct canonical
record identifiers in the same tenant and field produced the same digest. The
injection was reverted.

### PF-185 verification

```
corepack pnpm test                                           # 56 files, 1,209 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm knip                                           # clean
corepack pnpm v3:invariants                                  # 6 active-pass, 0 active-fail
corepack pnpm golden:validate                                # all 16 signed cases passed
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # 5 tests passed
corepack pnpm test:e2e                                       # production build and 17 tests passed
```

### PF-186 emitted observability digests use the secret-derived purpose key

The keyed-record provenance fence proved the emitted SHA-256 algorithm and
normalized input but did not inspect the emitted HMAC key. Replacing that key
with a public constant while retaining the secret-derived purpose HMAC therefore
created a recovery oracle while both security fences stayed green.

**Adversarial proof:** before the correction, the live record-id implementation
was changed from `createHmac("sha256", purposeKey)` to
`createHmac("sha256", "public-observability-key")`. The observability and secret
fitness files still passed all 77 tests. After the correction, the same
injection failed the observability fence at
`src/infrastructure/observability/record-id.ts:33`, while the secret-containment
file still passed all 40 tests. The new in-memory companion retains an unused,
valid secret-derived purpose HMAC beside the public emitted key and receives the
same provenance violation. A second companion reassigns a valid purpose key
before emission and is also refused. The injection was reverted, and the
focused observability, secret, and runtime suites passed all 95 tests.

### PF-186 verification

```
corepack pnpm test                                           # 56 files, 1,211 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm knip                                           # clean
corepack pnpm v3:invariants                                  # 6 active-pass, 0 active-fail
corepack pnpm golden:validate                                # all 16 signed cases passed
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # 5 tests passed
APP_ENV=development <test-only placeholder env> corepack pnpm build
                                                             # compiled and generated all routes
corepack pnpm test:e2e                                       # production build and 17 tests passed
```

### PF-187 emitted observability digest bindings are immutable and single-use

The keyed-record provenance fence validated the emitted digest binding's
initializer but not the binding itself. A mutable digest could therefore start
with the required secret-derived HMAC, be reassigned to an unkeyed SHA-256
digest, and emit the replacement while the fence stayed green.

**Adversarial proof:** the new in-memory companion initializes `let digest`
with the complete tenant-, field-, and value-scoped HMAC, reassigns it from
`createHash("sha256")`, and emits the reassigned value. Before the correction,
the detector returned no violations and the focused file failed with one failed
test out of 40. After the correction, the companion passes. The same
reassignment was then injected into the live record-id implementation. The
enforcement assertion failed at
`src/infrastructure/observability/record-id.ts:36`, naming the untrusted keyed
mint. The injection was reverted. A second companion consumes a valid `const`
digest twice and proves that immutable but ambiguous ownership is also refused.

### PF-187 verification

```
corepack pnpm exec vitest run src/__tests__/fitness/observability-vocabulary.test.ts
                                                             # 41 tests passed
corepack pnpm test                                           # 56 files, 1,213 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm knip                                           # clean
corepack pnpm v3:invariants                                  # 6 active-pass, 0 active-fail
corepack pnpm golden:validate                                # all 16 signed cases passed
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # 5 tests passed
APP_ENV=development <test-only placeholder env> corepack pnpm build
                                                             # compiled and generated all routes
corepack pnpm test:e2e                                       # production build and 17 tests passed
```

### PF-188 primitive-catalog fence (v3 prompt 8): registry integrity, doc sync, domain neutrality, purity

The prompt-8 decision-primitive vocabulary (ADR-0039, D-102) introduces four
invariants: primitive-set-version.json mirrors the shipped catalog in both
directions; docs/primitive-rationale.md covers every primitive with no
phantoms; the primitives module stays domain-neutral in identifiers and
non-prose strings (falsification prose is the one reviewed exemption); and the
module references no clock, randomness, tz/locale machinery, or scheduling
globals.

**Adversarial proof (four injections, each reverted after failing):**

1. Renamed the published key `availability.gross` to `availability.cash` in
   the live catalog. The domain-neutrality check failed naming
   `src/contracts/primitives/quantity.ts:136: cash` and `:161: cash`.
2. Removed `net-availability` from primitive-set-version.json. The registry
   check failed with "catalog id net-availability missing from registry", and
   the real-registry companion failed alongside it.
3. Added `export const injectedNow = Date.now();` to the live values module.
   The purity check failed naming `src/contracts/primitives/values.ts:65:
   Date`.
4. Renamed the doc heading for `evidence-reconciliation`. The doc-sync check
   failed with both the missing-section and the phantom-primitive messages.

Companions additionally prove: a registry with an unshipped id, wrong version,
dropped provisional flag, non-canonical order, malformed shape, or a future
primitive colliding with a shipped id all fail; a domain word in an identifier,
string, or template segment is caught with file:line while the same word in
falsification prose is not; Math.random, aliased Math, element-access Math,
and Intl fail closed while pure Math members pass; and the scanned module is
asserted to be the real five files so a renamed path cannot pass vacuously.

### PF-188 verification

```
corepack pnpm exec vitest run src/__tests__/fitness/primitive-catalog.test.ts
                                                             # 18 tests passed
corepack pnpm test                                           # 58 files, 1,277 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm knip                                           # clean
corepack pnpm v3:invariants                                  # 6 active-pass, 0 active-fail
corepack pnpm golden:validate                                # all 16 signed cases passed
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # 5 tests passed (contracts ceiling per ADR-0040)
APP_ENV=development <test-only placeholder env> corepack pnpm build
                                                             # compiled and generated all routes
corepack pnpm test:e2e                                       # production build and 17 tests passed
```

### PF-189 primitive-catalog fence: locale purity and evidence-kind declarations

Review of the prompt-8 vocabulary found the purity check overclaiming and the
evidence-kind declarations unanchored. The fence header, ADR-0039, and PF-188
all say the purity check covers "tz/locale machinery", but `IMPURE_GLOBALS`
only matched the `Intl` IDENTIFIER: `localeCompare` and the `toLocale*`
formatters are the realistic way ICU collation and formatting enter a
comparator, and they name no global at all. Separately,
`CatalogPrimitive.evidenceKindParameters` listed raw parameter NAMES with no
structural link to the entry's own `parameterSchema`, so a rename compiled,
type-checked, and passed every gate while leaving the prompt-9 loader binding a
dangling name. The fence now carries a fifth invariant (e) and a locale-member
check on any receiver, including element-access forms.

**Adversarial proof (three injections, each reverted after failing):**

1. Added `export const compareSegments = (a: KeySegment, b: KeySegment): number
   => a.localeCompare(b);` to the live values module. The purity check failed
   naming `src/contracts/primitives/values.ts:70: localeCompare`.
2. Renamed the live `claimEvidenceKinds` parameter to `renamedClaimKinds`
   throughout quantity.ts, leaving `evidenceKindParameters` untouched - the
   exact silent rename the finding described. The new check failed with
   "net-availability declares evidence-kind parameter claimEvidenceKinds,
   absent from its schema", while typecheck stayed clean - proving the check is
   what catches this class.
3. Reverted the `Object.hasOwn` slot guard in restriction-screen's input schema
   back to `slot in input.context.subjects`. The unit case "refuses an
   inherited slot name rather than screening against Object.prototype" failed,
   proving the guard is load-bearing: without it a binding declaring
   `subjectsInScope: ["constructor"]` with NO bound subject parsed clean, and
   evaluate published a fabricated deny-list match carrying full source
   attribution and `subjectRef: {}`.

Companions additionally prove: an element-access `n["toLocaleString"]()` is
caught while codepoint comparison passes untouched; a dangling evidence-kind
name fails while a name declared by one arm of a discriminated union passes;
and a schema the key walk cannot see through is refused rather than passing
over an empty key set (so the check can never go vacuous).

### PF-189 verification

```
corepack pnpm exec vitest run src/__tests__/fitness/primitive-catalog.test.ts \
  src/__tests__/unit/primitives.test.ts                      # 71 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm knip                                           # clean
corepack pnpm golden:validate                                # all 16 signed cases passed
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # 5 tests passed (contracts under the ADR-0040 ceiling)
```

### PF-190 candidate-selection explains an empty outcome; one restriction list per source version

Review of the prompt-8 vocabulary found two parse/evaluate gaps in the shipped
primitives. `candidate-selection` computed the `rejected` array with each
candidate's configured exclusion reason code and then discarded it on the empty
outcome, publishing only `selection.<slot>.outcome`, so an all-excluded run
could not be explained from its own trace and the reason codes a binding
configured were unreachable by downstream policy or UI (captain ruling
p8-review-askuser-4, option A: reuse the already-declared conditional
`alternatives` key rather than mint a new one). Separately,
`restriction-screen`'s `evidence.restrictions` was the one collection in the
module carrying no uniqueness refinement: two lists agreeing on source type,
source reference, version reference, kind, and slot but differing only in their
entries tie under `compareRestrictionLists` and, when both violate, emit
byte-identical entries in `restrictions.matches` - which the platform maps into
two prohibitions from a single source version.

**Adversarial proof (two injections, each reverted after failing):**

1. Reverted the empty record in `selection.ts` back to
   `{ [keyOf("outcome")]: "empty" }`. The unit case "explains an empty outcome
   with the exclusion trace and its configured reason codes" failed at
   `src/__tests__/unit/primitives.test.ts` with "expected undefined to deeply
   equal [ { ref: {…}, …(1) }, …(1) ]", proving the assertion reads the
   published trace and not merely the outcome code. The case covers BOTH empty
   paths (single-eligible and preference-order) and asserts each configured
   `reasonCode` reaches the published alternatives in canonical order.
2. Removed the `hasUniqueByComparator(lists, compareRestrictionLists)`
   refinement from `RestrictionScreenInputSchema`. The unit case "refuses two
   lists from one source version differing only in their entries" failed
   ("expected true to be false"), proving the refinement is what rejects the
   duplicate at the parse boundary; its second assertion holds a different kind
   from the same source parsing clean, so the refinement cannot pass by
   refusing everything.

The published-key subset invariant is re-proved for the new emission: the
key-discipline case list now evaluates `candidate-selection` on an all-excluded
input as well, so the empty outcome's keys are checked against the declared map
(canonical order, valid descriptors, every produced key declared, every `always`
key produced). The `alternatives` descriptor stays `conditional` - it is absent
only on the ambiguous outcome.

### PF-190 verification

```
corepack pnpm exec vitest run src/__tests__/fitness/primitive-catalog.test.ts \
  src/__tests__/unit/primitives.test.ts                      # 73 tests passed
corepack pnpm typecheck                                      # clean
corepack pnpm lint                                           # clean
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                                             # 2 FAILING: contracts 5411 > the 5400 ceiling.
                                                             # Expected and pre-authorized: these fixes were
                                                             # landed lean but not truncated, and ADR-0040 is
                                                             # amended with the re-measured figure in the
                                                             # follow-up that also lands the rationale-doc updates.
```

### PF-191 the exclusion trace reaches EVERY selection outcome; ADR-0040 re-measured

PF-190 landed the exclusion trace on the empty outcome only, and the key
descriptor codified the gap ("absent only on the ambiguous outcome"). The same
justification applies to ambiguity: `single-eligible` over three candidates
where one carries a configured exclusion classification publishes two candidates
in `openQuestion` and no record that a third was filtered out or why, so the
human answering the structured question cannot see it (captain ruling
`p8-review-askuser-5`). `candidate-selection` now publishes
`selection.<slot>.alternatives` on every outcome through one shared helper, and
the key is genuinely conditional: present whenever candidates were excluded or
ranked behind, absent only when neither happened, which is exactly what the
descriptor now says.

**Adversarial proof (two injections, each reverted after failing):**

1. Dropped the trace spread from the `ambiguous` record. The unit case "explains
   an ambiguous outcome with the exclusion trace of the candidates it filtered
   out" failed at `src/__tests__/unit/primitives.test.ts` with "expected
   undefined to deeply equal [ { ref: {…}, …(1) } ]", proving the assertion reads
   the published trace rather than the outcome code, and that the excluded
   candidate's configured `reasonCode` is what it checks.
2. Forced the trace helper's guard to `false` so alternatives published
   unconditionally (an empty array when nothing was excluded). The unit case
   "omits the trace only when nothing was excluded or ranked behind" failed
   ("expected true to be false"), proving the conditional presence the descriptor
   declares is enforced and not incidentally true.

The published-key subset invariant is re-proved for the new emission: the
key-discipline case list now evaluates `candidate-selection` on an ambiguous
input as well as the selected and all-excluded ones, so all three outcomes are
checked against the declared map (canonical order, valid descriptors, every
produced key declared, every `always` key produced).

`docs/primitive-rationale.md` records this round's rulings alongside the
behavior: the every-outcome `alternatives` semantics, the at-most-once binding
rule with prompt-10's fail-closed double-binding rejection, the
restriction-screen absent-evidence split (`matched.<kind> = false` means
"screened against everything supplied", never "evidence verified present"), and
the 1200-month horizon bound with its totality rationale.

### PF-191 verification

```
corepack pnpm exec vitest run src/__tests__/unit/primitives.test.ts \
  src/__tests__/fitness/primitive-catalog.test.ts               # 75 tests passed
corepack pnpm typecheck                                         # clean
corepack pnpm lint                                              # clean
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                # 5 tests passed. Re-measured with the fence's own
                                # algorithm: contracts 5418, domain 1298,
                                # infrastructure 3484, presentation 928. ADR-0040 is
                                # amended in place (it is part of this unmerged PR) to
                                # a 5,460 contracts ceiling - the measured total plus
                                # bounded correction room. Any further increase stays a
                                # measured ADR amendment, never a code change.
                                # SUPERSEDED by PF-192's final measurement (5433).
```

### PF-192 the closing prompt-8 review round: honest tiebreaks, a frozen id list, year-zero totality, branded reason codes

The last three review rounds changed shipped behavior in `src/contracts/primitives/`
and this entry proves each change adversarially, closing the round. Four items:
(1) `candidate-selection` now publishes a SECOND fixed reason code -
`canonical-order-tiebreak` - so a `preference-order` loser that tied the winner's
rank (both absent from the household preference list, so the canonical
`(firmId, id)` order decided it) is no longer labeled `ranked-behind-selection`,
which asserted a household preference had ranked it behind when nothing ranked it
at all (captain ruling `p8-review-askuser-7`; the ratified total order itself is
unchanged). (2) `PRIMITIVE_CATALOG_IDS` is `readonly PrimitiveId[]` over
`Object.freeze`, so an in-place `sort`/`push` cannot mutate the module-level array
both fences and every consumer read. (3) `addCalendarMonths` saturates only OUTSIDE
the parseable range: year 0000 is inside `IsoDateSchema`'s four-digit range, so it is
now computed exactly instead of jumping FORWARD eleven months to `0001-01-01` - a
silent widening of the half-open horizon window. (4) `Alternative.rejectedBecause`
is `ReasonCode`, not `string`, in the one place the module publishes reason codes.

**Adversarial proof (four injections, each reverted after failing):**

1. Collapsed the tiebreak selector back to `RANKED_BEHIND_REASON` for every losing
   survivor. The unit case "breaks unranked ties by canonical reference order and
   says so - never crediting a silent preference" failed at
   `src/__tests__/unit/primitives.test.ts:490` ("expected [ { ref: {…}, …(1) } ] to
   deeply equal [ { ref: {…}, …(1) } ]"), proving the assertion reads the published
   reason code and not merely the alternatives' order. The sibling case "separates a
   real preference rank from the canonical fallback in one trace" stayed GREEN under
   the injection, so the pair cannot pass by labeling everything with one code: it
   pins the partition, with genuinely-ranked-behind losers keeping the old code.
2. Removed the `readonly` annotation and `Object.freeze` from
   `PRIMITIVE_CATALOG_IDS` and added a `PRIMITIVE_CATALOG_IDS.sort()` before the
   canonical-order assertion. WITH the freeze, `corepack pnpm typecheck` rejected the
   mutation at `src/__tests__/unit/primitives.test.ts(61,27)`: "Property 'sort' does
   not exist on type 'readonly (string & $brand<\"PrimitiveId\">)[]'". WITHOUT it,
   typecheck was clean AND all 55 unit tests passed - proving the annotation is the
   only thing standing between a consumer and a silent in-place reorder of the shared
   array, and that no other gate would have caught it.
3. Reverted the totality guard to `targetYear >= 1` with an `0001-01-01` floor. The
   unit case "stays total at the last representable anchor, saturating the window
   end" failed ("expected '0001-01-01' to be '0000-01-01'"), proving the low-end
   assertion is real; its next line pins the finding's own case
   (`addCalendarMonths("0000-01-01", 1) === "0000-02-01"`), and the 9999-12-31
   saturation assertions stayed green, so the fix did not trade one edge for the other.
4. Pushed an ad-hoc string literal into the published trace
   (`rejectedBecause: "ad-hoc-literal"`). WITH the field narrowed to `ReasonCode`,
   typecheck failed at `src/contracts/primitives/selection.ts(230,45)`: "Type
   'string' is not assignable to type 'string & $brand<\"ReasonCode\">'". WITH the
   field widened back to `string`, the same literal compiled clean - proving the
   narrowing, not any fence or key-discipline case, is what keeps an unregistered
   code out of `selection.<slot>.alternatives`.

`docs/primitive-rationale.md` carries this round's doc obligations: the two-code
partition and when each applies, and one sentence recording that the household
preference ranking is OPTIONAL-BY-DESIGN evidence - advisory ordering whose absence
is indistinguishable from a household holding no standing preference, honestly
labeled by the canonical-tiebreak code rather than gated on, and deliberately NOT a
D-104 obligation (captain ruling `p8-review-askuser-8`). `DECISIONS.md` D-104 carries
the cross-wave obligations that are NOT fenceable today because their subjects do not
exist yet (prompt-10 config-load cross-checks, prompt-14 claim de-duplication,
prompt-15 reconciliation evidence sufficiency).

### PF-192 verification

```
corepack pnpm exec vitest run src/__tests__/unit/primitives.test.ts \
  src/__tests__/fitness/primitive-catalog.test.ts               # 76 tests passed
corepack pnpm typecheck                                         # clean
corepack pnpm lint                                              # clean
corepack pnpm test                                              # full suite green
corepack pnpm knip                                              # clean
corepack pnpm exec vitest run src/__tests__/fitness/line-budget.test.ts
                                # 5 tests passed. FINAL measurement with the fence's
                                # own algorithm: contracts 5433, domain 1298,
                                # infrastructure 3484, presentation 928. The 5,460
                                # ceiling is unchanged; ADR-0040's table and the fence
                                # comment are synced to 5,433 / 27 headroom, which
                                # supersedes PF-191's pre-review 5,418.
```

### PF-193 decision-ledger append-only anti-fork and database protection

**Invariant:** the sibling decision ledger and its evidence, bundle, membership,
and decision source rows are immutable. Raw ledger inserts exist only in the sole
repository and the forward migration; the repository exports no immutable
update/delete surface.

**Injection:** added
`src/infrastructure/ledger/ledger-violation-probe.ts` with a raw
`INSERT INTO decision_ledger`, then ran:

```text
pnpm vitest run src/__tests__/fitness/ledger-append-only.test.ts --reporter=verbose
× anti-fork: only the ledger repository and migration contain raw ledger INSERTs
raw decision-ledger inserts bypass the repository:
src/infrastructure/ledger/ledger-violation-probe.ts:2
```

The production-path integration companions also execute UPDATE, DELETE, and
TRUNCATE against every immutable table in real PGlite, and L1-L4 tampering tests
independently alter stored bytes, canonical form, promoted columns, and the
anchor. Each attack is rejected or detected at its claimed layer.

**Revert:** removed the planted source file. The fence and all companions pass.

**Date:** 2026-07-28 (v3 prompt 7, ADR-0043, D-105).

### PF-194 decision-ledger anti-fork fence widened to every immutable source table
## Decision-ledger anti-fork fence widened to every immutable source table (D-110)

**Invariant:** the anti-fork rule covers ALL immutable source tables, not only the
chain, so splitting the repository into a chain writer and a source writer cannot
silently move `INSERT INTO decision_records` (or evidence/bundle/membership) into a
third module.

**Injection:** appended a raw `INSERT INTO decision_records` string to
`src/infrastructure/ledger/ledger-bindings.ts`, then ran:

```text
pnpm vitest run src/__tests__/fitness/ledger-append-only.test.ts
× anti-fork: only the ledger repository and migration contain raw immutable-source INSERTs
raw decision-ledger inserts bypass the repository:
src/infrastructure/ledger/ledger-bindings.ts:66
```

**Revert:** `git checkout src/infrastructure/ledger/ledger-bindings.ts`. Fence green.

### PF-195 reservation ownership is refused, not resolved arbitrarily

**Invariant:** one live reservation belongs to exactly one decision, and a release
resolves its owner through the keyed index rather than physical row order.

**Injection:** removed the `WHERE decision_reservation_index.decision_id =
EXCLUDED.decision_id OR ... status = 'released'` guard from the claim upsert in
`src/infrastructure/ledger/ledger-projection-store.ts`, then ran:

```text
pnpm vitest run src/__tests__/integration/ledger-projections.test.ts
× releases a reservation against its owning decision and refuses a competing live claim
AssertionError: promise resolved "[ { …(3) } ]" instead of rejecting
```

The same test proves the release resolves through the index and that a rebuild
reproduces the online fold byte-identically.

**Revert:** restored the guard. All four projection companions pass.

**Date:** 2026-07-28 (review follow-up to v3 prompt 7, ADR-0043, D-106).

### PF-196 a swallowed mid-batch refusal leaves a verifiable anchor
## A swallowed mid-batch refusal leaves a verifiable anchor (D-111)

**Superseded by D-107:** later appends are now savepoint-atomic, so a caught refusal
commits no prefix. Per-entry anchors remain as defense in depth.

**Invariant:** the ledger anchor covers exactly the entries that committed, even when a
caller catches the abort and commits its own transaction anyway.

**Injection:** moved the per-entry anchor and checkpoint upserts in
`src/infrastructure/ledger/ledger-store.ts` back out of the append loop (one upsert per
batch, after it), then ran:

```text
pnpm vitest run src/__tests__/integration/decision-ledger.test.ts -t "swallows a mid-batch refusal"
× keeps the anchor verifiable when a producer swallows a mid-batch refusal
AssertionError: ledger anchor count, sequence, or head hash differs: expected false to be true
```

**Revert:** restored the per-entry upserts. L4 verifies the partial append.

### PF-197 replayed decision state is labeled by its least trustworthy event

**Invariant:** a projection folded from any synthetic event renders as a demonstration,
whatever provenance recorded the decision (ADR-0022).

**Injection:** restored the `AND l.event_type = 'DecisionRecorded'` filter on the
provenance join in `src/infrastructure/ledger/ledger-projection-store.ts`, so the label
came from the recording row alone, then ran:

```text
pnpm vitest run src/__tests__/integration/ledger-projections.test.ts -t "least trustworthy"
× labels replayed state by its least trustworthy event, not by the recording one
AssertionError: expected false to be true
```

**Revert:** restored the join over every contributing row.

**Date:** 2026-07-28 (review follow-up to D-106, ADR-0043, D-107).

### PF-198 decision-ledger residual review corrections
## Decision-ledger residual review corrections (D-114)

**Invariants:** later appends require a real transaction and commit no partial
source/event prefix; rebuild refuses any L1-L4 or replay-source corruption before
clearing projections; verification reads under the tenant lock; retained immutable
text is an explicit code/reference projection; reservation reuse is generation-bound;
execution placeholders reconcile by handle.

Before the implementation changes, the focused adversarial suite failed six
production paths:

```text
× repairs corrupted derived state but refuses a truncated ledger
  promise resolved instead of rejecting
× does not let a delayed release affect a reused reservation identifier
  expected active, received released
× replaces an observed execution placeholder when the real step arrives
  duplicate observed and real step remained
× refuses retained names and unformatted account numbers without rewriting bytes
  expected false, received true
× rolls back every event when a producer catches a mid-batch refusal
  expected 5 entries, received 6
× rejects a direct database handle where a transaction capability is required
  direct SqlDb reached the append path
```

The completed companions additionally prove that an unsupported immutable-source
codec fails full integrity while L1-L4 alone remains intact, the first verification
query locks the tenant, evidence collisions are preflighted before any source insert,
cross-owner and unknown-generation releases fail, and a delayed duplicate release
cannot affect a reused reservation.

**Revert:** no planted source remains. The focused typecheck, ledger contract,
integration, and projection suites pass.

**Date:** 2026-07-28 (review corrections F1-F9, ADR-0043, D-110).

## Decision-ledger binding and verified register corrections (D-111)
## Decision-ledger binding and verified register corrections (D-115)

**Invariants:** the recorded decision binds the exact input bundle hash; causal
references point only backward; retained text is a registered code or opaque
reference; PII traversal is stack-safe; the register verifies and replays the exact
immutable window it displays under one tenant lock; immutable-table insert ownership
is exact per table and module.

Before the corrections, the adversarial tests reproduced the bundle substitution,
retained-name, deep-traversal, causal-loop, projection-cache, and split-register
failures:

```text
× binds DecisionRecorded to the exact input bundle hash
  expected a sha256 bundleHash, received undefined
× refuses duplicated free text masquerading as a code or source id
  expected false, received true
× scans deeply nested retained values without recursive stack exhaustion
  RangeError: Maximum call stack size exceeded
× rejects self-causation and non-preceding causal references
  self-referencing events parsed and stored
× serves replayed state from the verified immutable window
  corrupted decision_state_projection bytes were returned
× reads verification, events, and decision state in one locked transaction
  register data was read outside the verification transaction
```

For the anti-fork companion, a raw evidence insert was planted in
`src/infrastructure/ledger/ledger-store.ts`, then the focused fence reported:

```text
× anti-fork: each immutable table has one exact raw-insert owner
raw decision-ledger inserts bypass the repository:
src/infrastructure/ledger/ledger-store.ts:56
```

**Revert:** removed the planted raw insert. The focused correction suite passes.

**Date:** 2026-07-28 (review corrections F1-F7, ADR-0043, D-111).
## Decision-ledger authority, retention, and disclosure corrections (D-112)
## Decision-ledger authority, retention, and disclosure corrections (D-116)

**Invariants:** every ledger SQL boundary receives sealed tenant authority and compares
it before SQL; structural immutable identifiers refuse human-shaped text without
misclassifying evidence references; the register requires `audit.export` and `pii.view`
for one tenant and discloses no bytes after failed verification; displayed counts retain
metric provenance.

The original implementation reproduced the reported failures. A normal evidence-backed
`recordDecision` returned `PII_VIOLATION`, the tenant and governed-action fences reported
28 raw-org ledger repository boundaries plus the role-only register route, the metric
fence reported both naked projection counts, and the observability fence rejected the
unregistered raw-error log call.

Three real-tree injections then proved the corrected runtime boundaries:

```text
# recordDecision validated against the self-asserted record firm instead of tenant.orgId
x refuses a sealed authority for another tenant before opening a transaction
  expected 'INTERNAL' to be 'AUTH_FAILED'
  src/__tests__/integration/decision-ledger.test.ts:192

# structural identifier leaves skipped requireOpaqueIdentifier
x refuses a person name used only as an immutable source identifier
  expected true to be false
  src/__tests__/integration/decision-ledger.test.ts:663

# readVerifiedDecisionRegister listed rows regardless of verification.ok
x suppresses every register row when stored actor metadata fails verification
  expected five ledger rows to deeply equal []
  src/__tests__/integration/ledger-projections.test.ts:512
```

**Revert:** restored all three guards. The focused 164-test boundary suite and the full
1,278-test non-UTC suite pass. Typecheck, lint, knip, the 500-line cap, and the measured
ADR-0044 line ceiling also pass.

**Date:** 2026-08-04 (review corrections F1-F9, ADR-0043/0042, D-112).

### PF-199 decision-ledger retention and constructed-SQL anti-fork coverage

**Invariants:** derived producer provenance cannot lose its demonstration trace before
immutable persistence; retained event codes and references are closed machine
vocabularies; immutable-table inserts have one exact owner even when SQL is assembled;
failed verification discloses no rows and does not present an empty-ledger state.

The focused regression tests first reproduced all three storage failures:

```text
× refuses derived producer provenance that immutable rows cannot retain
  expected false, received true
× refuses an unregistered retained failureCode
  promise resolved instead of rejecting
× refuses a PII-shaped immutable source identifier (robert-smith)
  expected false, received true
```

Two in-memory source injections then assembled the raw insert through concatenation
and a dynamic template table. Before the fence correction both companions failed:

```text
× detects an immutable insert assembled from concatenated fragments
  expected [] to have a length of 1
× fails closed when an INSERT uses a dynamic table identifier
  expected [] to have a length of 1
```

After the correction, both planted sources resolve to the exact diagnostic
`src/infrastructure/evil.ts:2`, and the focused fence and ledger integration suites
pass. The Playwright register companion supplies a failed L1 response with five stored
entries and proves the page renders `ledger-entries-withheld` while the empty-ledger
copy is absent.

**Revert:** no planted production source remains. The companion fixtures stay in the
test suites as the detection-is-not-verification proof.

**Date:** 2026-08-05 (review corrections F1-F4, D-113).

### PF-200 fail-closed ledger SQL, retained values, and bounded evidence replay

**Invariants:** unresolved SQL cannot evade immutable-table insert ownership;
sensitive-length numeric values and unregistered namespaced or versioned references
cannot enter immutable replay bytes; a bounded register decision uses a qualifying
evidence recording inside the verified window and before that decision.

The new companions were added before the production corrections and reproduced the
reported failures:

```text
× detects an immutable insert returned by a helper
  expected [] to deeply equal [{ file: "src/infrastructure/evil.ts", line: 5 }]
× refuses a PII-shaped immutable source identifier (subject:ROBERT-SMITH)
  expected true to be false
× refuses a PII-shaped immutable source identifier (subject:robert-smith)
  expected true to be false
× refuses an unclassified sensitive-length numeric recommendation parameter
  expected true to be false
× uses a repeated evidence recording inside the verified register window
  expected [] to deeply equal ["dec:GC-01:0002"]
```

The anti-fork suite additionally covers a typed imported SQL constant and a wholly
unresolved executor argument. Reviewed dynamic SQL is limited to the database driver
and migration runner; the companion independently checks every shipped migration SQL
value for immutable inserts and every preflight for a read-only `SELECT` head.

After the corrections, the five focused append-only, size, budget, decision-ledger, and
projection suites pass 86 tests. The line-budget companion measures infrastructure at
6,608 lines under the ADR-0043 ceiling.

**Revert:** no planted production source remains. The in-memory SQL sources and runtime
payloads stay as detection-is-not-verification companions.

**Date:** 2026-08-05 (review corrections F10-F14, ADR-0043, D-114).

### PF-201 ledger acceptance, source trust, and batched register replay

**Invariants:** L1-L4 never verifies event bytes the append boundary would refuse;
immutable source reuse cannot upgrade fixture provenance; bounded register I/O scales
with source categories rather than event count.

Five real PGlite regressions were added before the production corrections and failed:

```text
× L2 reapplies the ledger PII boundary to correctly rechained bytes
  expected false, received true
× L2 rechecks immutable decision hashes after a privileged rechain
  expected false, received true
× L2 rejects a correctly rechained causal reference to a later entry
  expected false, received true
× does not relabel a fixture bundle when a real producer reuses it
  expected true, received false
× batch-loads register replay sources before folding the event window
  expected 65 statements to be less than or equal to 13
```

The corrected L2 calls the shared PII and source-binding authorities plus one set-based
causal check. Replay derives source trust from the first chain-bound recording edge and
the current use edge. The batch companion creates fourteen decisions, reads a one-item
display limit, and proves all fourteen are counted without per-event source queries.

**Revert:** no planted production data remains. The correctly rechained rows and
query-count harness remain as detection-is-not-verification companions.

**Date:** 2026-08-05 (review corrections F15-F18, ADR-0044, D-115).

### PF-202 immutable ledger ordering, transaction authenticity, and bounded origin trust

**Invariants:** L2 and append use immutable decision and reservation order; a genuine SQL
transaction remains valid across independently evaluated modules; raw ledger disclosure
requires both governed grants; bounded replay consumes provenance only from verified
origin edges.

Four real PGlite regressions were added before the production corrections and failed:

```text
× L2 rejects a correctly rechained decision event before its recording fact
  expected true to be false
× accepts a transaction capability created by another module evaluation
  promise rejected with VALIDATION instead of resolving
× refuses a competing reservation after its derived index row is deleted
  competing immutable event was accepted
× withholds decisions whose true source origins are outside the verified window
  expected no decisions, received one compliance-eligible projection
```

The corrected ordering authority is category-batched and sequence-aware, including for
bounded verification. The reservation regression deletes the derived index before a
competing append. The transaction regression reevaluates the database module before
passing its driver-issued capability to the original ledger bundle. The provenance
regression edits old origin metadata without rechaining it and proves a verified tail
does not consume those unchecked bytes.

The governed-actions fence also derives both exact grants from every exported row
disclosure and verifies their contiguous authority prologue. The focused integration,
governed-action, tenant-context, append-only, and line-budget suites pass after the
corrections.

**Revert:** no planted production data remains. The reordered chain, deleted cache row,
module reevaluation, and old-origin tamper remain as detection-is-not-verification
companions.

**Date:** 2026-08-05 (review corrections F19-F23, ADR-0045, D-116).

### PF-203 immutable write forms and ledger compatibility bindings

**Invariants:** every PostgreSQL path that can add an immutable ledger row has one
reviewed owner; recorded approval and execution identifiers belong to their immutable
decision; historical encodings remain dispatchable; request verification does not hold
the tenant append lock; bounded omissions are visible.

The companions were added before the production corrections and reproduced the
reported failures:

```text
× detects INSERT INTO ONLY against an immutable table
  expected [] to deeply equal [{ file: "src/infrastructure/evil.ts", line: 2 }]
× detects COPY FROM against an immutable table
  expected [] to deeply equal [{ file: "src/infrastructure/evil.ts", line: 2 }]
× detects MERGE against an immutable table
  expected [] to deeply equal [{ file: "src/infrastructure/evil.ts", line: 2 }]
× refuses approval and execution identifiers absent from the immutable decision
  invalid stage and step events appended successfully
× L2 rejects a correctly rechained event with an unknown approval stage
  expected false, received true
× verifies a consistent register snapshot without holding the tenant write lock
  expected direct queries, received one tenant-locked transaction
× withholds a recent event whose DecisionRecorded prerequisite is outside the window
  expected one withheld decision, received zero
```

The corrected fence resolves all supported row-creation targets and keeps its dynamic
SQL refusal. The structural regressions use real PGlite rows, including a privileged
rechain for L2. Frozen-schema digests and a two-version registry companion protect the
recorded compatibility path. Query instrumentation proves the register captures the
anchor and complete ledger together without `FOR UPDATE` or a transaction.

After correction, the focused append-only, contract, ledger, projection, and budget
suites pass. The line-budget companion measures contracts at 4,598 lines and
infrastructure at 7,652 under the ADR-0047 ceilings.

**Revert:** no planted production SQL or invalid history remains. The in-memory write
forms, privileged rechain, query harness, and frozen-schema pins remain as
detection-is-not-verification companions.

**Date:** 2026-08-05 (review corrections F30-F35, ADR-0047, D-118).
---

### PF-204 ledger-pii-vocabulary + ledger-reachability · `src/__tests__/fitness/ledger-pii-vocabulary.test.ts`, `src/__tests__/fitness/ledger-reachability.test.ts`

**Invariants:** the shipped immutable-source PII allowlists carry reviewed production,
seed, demo, and golden identifiers only; the test-only registration seams have no shipped
caller; and every ledger export is reachable from a shipped surface or is a NAMED
deferral that says which prompt lands its caller.

**Injection 1** (test-shaped entry ships): added `"test:projection:bounded"` to
`REGISTERED_INDEXED_IDENTIFIER_PREFIXES` in `src/infrastructure/ledger/ledger-pii.ts`.

```text
FAIL src/__tests__/fitness/ledger-pii-vocabulary.test.ts > enforces: no shipped allowlist entry lives in the reserved test namespace
AssertionError: expected [ Array(1) ] to deeply equal []
+ "src/infrastructure/ledger/ledger-pii.ts: REGISTERED_INDEXED_IDENTIFIER_PREFIXES ships reserved-namespace entry \"test:projection:bounded\""
```

**Injection 2** (shipped module widens the boundary through an ALIASED import): added
`import { registerTestLedgerIdentifier as widen } … ; widen("test:seed:sneaky");` to
`scripts/seed-decision-ledger.ts`.

```text
FAIL src/__tests__/fitness/ledger-pii-vocabulary.test.ts > enforces: no shipped module can widen the ledger identifier boundary
AssertionError: expected [ Array(1) ] to deeply equal []
+ "scripts/seed-decision-ledger.ts:22 references widen"
```

**Injection 3** (a new ledger export nothing ships can reach): added
`export function unusedLedgerHelper(value: string): string { return value; }` to
`src/infrastructure/ledger/ledger-canonical.ts`.

```text
FAIL src/__tests__/fitness/ledger-reachability.test.ts > enforces: every unreachable ledger export is a NAMED deferral or a fenced seam
AssertionError: expected [ 'appendDecisionEvents', …(1) ] to deeply equal [ 'appendDecisionEvents' ]
+ "unusedLedgerHelper"
```

**Injection 4** (the other direction - a deferral that already has a shipped caller):
added `["recordDecision", "v3 prompt 8"]` to `DEFERRED_EXPORTS`.

```text
FAIL … > enforces: every unreachable ledger export is a NAMED deferral or a fenced seam
AssertionError: expected [ 'appendDecisionEvents' ] to deeply equal [ 'appendDecisionEvents', …(1) ]
FAIL … > enforces: a named deferral that gained a shipped caller must be retired
AssertionError: expected [ 'recordDecision' ] to deeply equal []
```

Each injection was reverted and both fences pass. The in-memory companions (shipped
caller, aliased shipped caller, smuggled test entry, un-exported seam, bare re-export,
test-only caller) remain as detection-is-not-verification proof.

**Revert:** no planted allowlist entry, seam caller, export, or deferral remains.

**Date:** 2026-08-05 (review corrections, D-123).
## Ledger reachability made transitive (D-125)

The one-hop rule counted ANY shipped reference as a caller, and every ledger file is
itself shipped, so an intra-subsystem call satisfied the fence. Reachability now roots
OUTSIDE the subsystem and propagates only through the bodies of reached declarations.

**Injection 1** (an export whose only caller is itself a named deferral - the exact class
the one-hop rule missed): added `export function preflightEvidenceOrigins(...)` to
`ledger-sources.ts` and called it from `appendDecisionEvents` in `ledger-store.ts`.

```text
FAIL src/__tests__/fitness/ledger-reachability.test.ts > enforces: every unreachable ledger export is a NAMED deferral or a fenced seam
AssertionError: expected [ 'appendDecisionEvents', …(2) ] to deeply equal [ 'appendDecisionEvents', …(1) ]
+ "preflightEvidenceOrigins"
```

**Injection 2** (an exported arrow `const`, invisible to the previous `getFunctions()`-only
scan): appended `export const unusedLedgerConst = (value: string): string => value;` to
`ledger-canonical.ts`.

```text
FAIL … > enforces: every unreachable ledger export is a NAMED deferral or a fenced seam
AssertionError: expected [ 'appendDecisionEvents', …(2) ] to deeply equal [ 'appendDecisionEvents', …(1) ]
+ "unusedLedgerConst"
```

**Injection 3** (the other direction - a deferral that already has a shipped caller, and a
deferral its own decision entry does not name): added
`["recordDecision", { prompt: "v3 prompt 8", decision: "D-125" }]` to `DEFERRED_EXPORTS`.

```text
FAIL … > enforces: every unreachable ledger export is a NAMED deferral or a fenced seam
FAIL … > enforces: a named deferral that gained a shipped caller must be retired
AssertionError: expected [ 'recordDecision' ] to deeply equal []
FAIL … > enforces: each deferral names its prompt in its own DECISIONS.md entry
AssertionError: D-125 does not name recordDecision
```

Each injection was reverted and the fence passes (11 tests). The in-memory companions add
the transitive cases directly: an unreachable export cannot vouch for what it calls, a
reached export carries reachability through a private helper, and an exported arrow const
is scanned. The strengthened fence flagged `preflightEvidenceSnapshots` on first run - it
is now a NAMED deferral rather than a silent pass. Its record has since been corrected
twice, so read `DEFERRED_EXPORTS` for the live values rather than this line: the decision
key to D-121 (D-129), and the prompt to v3 prompt 18, the first prompt that lands a
post-decision producer.

**Revert:** no planted export, const, or deferral remains.

**Date:** 2026-08-06 (review corrections, D-125).
---

## Payload fields bound to the immutable plan (D-126)

**Invariants:** an `ExecutionStarted` idempotency key, a `ReservationCreated` reservation
and its conflict keys, and a `VerificationClosed` verification rule are the ones the
immutable execution plan authorizes - at the shared append boundary and again when L2
re-proves stored history; a rebuild proves ledger ordering exactly once; and a savepoint
recovery that fails does not destroy the classified refusal.

**Injection 1** (the binding itself): replaced `planFieldReason(event, record)` with
`null` in `decisionStructureReason`, leaving the stage/step existence checks intact.

```text
FAIL … > refuses payload fields the immutable execution plan does not authorize
  src/__tests__/integration/decision-ledger.test.ts:505
  expected promise to reject, but it resolved
FAIL … > L2 re-proves the plan binding of a correctly rechained ExecutionStarted
FAIL … > L2 re-proves the plan binding of a correctly rechained ReservationCreated
FAIL … > L2 re-proves the plan binding of a correctly rechained VerificationClosed
  src/__tests__/integration/decision-ledger.test.ts:550
  expected true to be false
```

**Injection 2** (the removed per-event ordering re-proof): restored
`assertLedgerHistoryOrdering` inside `prepareProjection`, so a rebuild proves ordering
per entry on top of the set-wide L2 pass.

```text
FAIL … > rebuilds an empty projection store byte-identically using the online fold
  src/__tests__/integration/ledger-projections.test.ts:148
  expected 4 ordering queries to equal 1
```

**Injection 3** (savepoint recovery): restored the awaited
`ROLLBACK TO SAVEPOINT` / `RELEASE SAVEPOINT` pair ahead of the classification.

```text
FAIL … > keeps the classified refusal when savepoint recovery itself fails
  expected { code: "STORE_CONSTRAINT", … }
  actual   TypeError { message: "connection lost mid-recovery" }
```

Each injection was reverted and the ledger, projection, contract, and budget suites pass.
The four refusals carry their own reason ("ledger idempotency key is absent from the
immutable execution step", "ledger reservation is absent from the immutable execution
plan", "ledger conflict keys differ from the immutable execution plan", "ledger
verification rule is absent from the immutable execution plan"), and each is asserted by
message, not only by code. The line-budget companion measures contracts at 4,598 lines
and infrastructure at 7,689 under the ADR-0047 ceilings.

**Revert:** no planted binding bypass, ordering re-proof, or savepoint form remains.

**Date:** 2026-08-06 (review corrections F38, D-126).
---

## The compensating-action widening accepts, not only refuses (D-127)

**Invariant:** the plan binding admits the compensating action a step carries, so an
`ExecutionStarted` citing the compensation's OWN idempotency key is accepted while an
unrelated key is still refused. D-126 proved the refusal; nothing proved the acceptance,
because no recording fixture carried a compensation and the widened branch never ran.

**Injection** (the widening itself): replaced
`step.compensatingAction ? [step, step.compensatingAction] : [step]` with `[step]` in
`planActions`, collapsing the plan to its steps alone.

```text
FAIL … > authorizes the compensating action's own key, and still refuses an unrelated one
  src/__tests__/integration/decision-ledger.test.ts:552
  promise rejected "{ code: 'STORE_CONSTRAINT', …(1) }" instead of resolving
```

The injection was reverted. `compensatedRecordingInput` records the golden proceed plan
with a compensating action whose idempotency key differs from the step's (the schema
refuses a shared key), and the same test asserts the unrelated key is still refused with
"ledger idempotency key is absent from the immutable execution step" - so the branch is
proven in both directions, not merely reached.

The line-budget companion measures contracts 4,598, domain 1,584, infrastructure 7,701,
and presentation 928 under the ADR-0048 ceilings, after restoring the migration prose an
earlier correction had compressed away to fit the previous ceilings. `migrations.ts`
measured 507 lines before that compression, so the per-file ratchet was squeezing it too;
it now carries the first pinned `max-file-size` entry (520 against a measured 510), and
that fence's companion still flags a synthetic file one line over the default.

**Revert:** no planted `planActions` narrowing remains.

**Date:** 2026-08-06 (review corrections, D-127).
---

## The raised per-file pin still fences (D-128)

**Invariant:** the `max-file-size` pin ADR-0049 raises for
`src/infrastructure/store/migrations.ts` (520 to 560, against a measured 510) is a real
ceiling with bounded headroom, not an exemption - the file is still measured and still
fails one line over.

**Injection:** appended 51 padding lines to `src/infrastructure/store/migrations.ts`,
taking it from 510 to 561.

```text
FAIL  src/__tests__/fitness/max-file-size.test.ts > max-file-size fence > enforces: no shipped file exceeds its ceiling (default 500)
AssertionError: oversized files (split them):
src/infrastructure/store/migrations.ts: 561 > 560
```

The injection was reverted and the file measures 510 again. The fence's own companion
still flags a synthetic file one line over the default and passes a small one, so the
default is unaffected by the pin; `migrations.ts` remains the ONLY pinned entry, so no
other file sits near its ceiling under the same squeeze. The line-budget companion
measures contracts 4,598, domain 1,584, and presentation 928 under unmoved ceilings,
since ADR-0049 amends no layer ceiling. **Corrected under D-122:** infrastructure
measured 7,702, not the 7,701 first recorded here - the same commit hoisted the
`appError` import in `recorded-version-registry.ts`, one added infrastructure line.

**Revert:** no planted padding remains in `migrations.ts`.

**Date:** 2026-08-06 (review corrections, D-128).
---

## A prologue failure leaves the append classified (D-129)

**Invariant:** every adapter-boundary failure in `appendDecisionEvents` reaches the caller
as a typed `AppError` with its `"decision ledger append failed"` log line - including the
tenant lock, the evidence preflight, and the `SAVEPOINT` statement, which ran outside the
classification and so could return raw driver prose from the designed contention point for
concurrent appends. Savepoint recovery still runs only against a savepoint that was opened.

**Injection:** restored the pre-fix shape - `lockDecisionLedgerTenant`,
`preflightEvidenceSnapshots`, and the `SAVEPOINT` exec lifted back out of the `try`.

```text
FAIL  src/__tests__/integration/decision-ledger.test.ts > classifies a prologue failure and leaves an unopened savepoint alone
  src/__tests__/integration/decision-ledger.test.ts:1726
  "actual": TypeError { "message": "lock wait timeout on the tenant row" }
  "expected": { "code": "INTERNAL", "message": "decision ledger append failed" }
```

**Second injection** (the recovery guard): weakened `if (savepointOpen)` to
`if (savepointOpen || true)`.

```text
AssertionError: expected [ …(4) ] to deeply equal []
  "actual": [ "ROLLBACK TO SAVEPOINT decision_ledger_append", "RELEASE SAVEPOINT …", … ]
```

Both injections were reverted. The guard assertion is therefore not vacuous: without it the
prologue failure issues a rollback to a savepoint that was never established, which in
Postgres aborts the caller's transaction. The same test also proves a typed `NOT_FOUND` from
the tenant lock still reaches the caller unchanged rather than collapsing into `INTERNAL`.

The line-budget companion measures contracts 4,598, domain 1,584, infrastructure 7,701,
and presentation 928: the classification restructure folded one call onto a single line,
returning the layer to the figure ADR-0048 recorded. No ceiling moved and `migrations.ts`
still measures 510 against its 560 pin.

**Revert:** no planted prologue-outside-the-try shape remains in `ledger-store.ts`.

**Date:** 2026-08-06 (review corrections, D-129).
---

## An empty ledger is honest only where the design made it empty (D-130)

**Invariant:** the decision-ledger operator gates hard-fail whenever rows EXIST but none were
covered, in every environment, and hard-fail an empty ledger in `development`, where they run
against a store seeded in the same job. Only `staging`/`production` emptiness passes, because
the post-decision append surface is deferred there by D-123 - and both scripts say so on stdout
rather than exiting 1 at the operator running a production restore.

**Injection A** (the fail-closed half): `decisionLedgerVacuity` rewritten to return
`"empty-by-design"` for present-but-uncovered rows.

```text
FAIL  src/__tests__/unit/decision-ledger-vacuity.test.ts > decisionLedgerVacuity > fails stored-but-uncovered entries in EVERY environment
  src/__tests__/unit/decision-ledger-vacuity.test.ts:21:51
  AssertionError: expected 'empty-by-design' to be 'vacuous'
```

**Injection B** (the environment half): the `appEnv` discrimination collapsed to a bare
`return "empty-by-design";`.

```text
FAIL  src/__tests__/unit/decision-ledger-vacuity.test.ts > decisionLedgerVacuity > fails an empty ledger in dev/CI, where the gate runs against a seeded store
  src/__tests__/unit/decision-ledger-vacuity.test.ts:11:56
  AssertionError: expected 'empty-by-design' to be 'vacuous'
```

Both injections were reverted. The verdict is therefore not a blanket exit 0: each half of it
is load-bearing on its own.

**End-to-end** against a PGlite store holding one org with a real verified audit chain and zero
`decision_ledger` rows - the exact shape of a deployment before a producer ships:

```text
APP_ENV=staging      audit-chain-verify: decision ledger empty - the post-decision append surface
                     is deferred (D-123) ... exit=0
APP_ENV=development  audit-chain-verify: 0 decision-ledger entries stored and 0 verified ...
                     typed-chain verification is vacuous ... exit=1
APP_ENV=staging      ledger-rebuild: decision ledger empty ... exit=0
APP_ENV=development  ledger-rebuild: 0 entries replayed into 0 decision projection(s) ... exit=1
```

The seeded dev store is unchanged: `db:seed && audit:chain` reports 1 audit and 5 decision
entries at exit 0, and `ledger:rebuild` replays 5 entries into 1 projection at exit 0.

**Revert:** no planted verdict remains in `scripts/decision-ledger-vacuity.ts`.

**Date:** 2026-08-06 (review corrections, D-130).
---

## The second per-file pin still fences (D-131)

**Invariant:** the `max-file-size` pin ADR-0050 adds for
`src/infrastructure/ledger/ledger-store.ts` (550 against a measured 504, with the folded
`insertEvidenceSnapshots(...)` call restored to its multi-line form) is a real ceiling with
bounded headroom, not an exemption - the file is still measured and still fails one line over.

**Injection:** appended 47 padding lines to `src/infrastructure/ledger/ledger-store.ts`,
taking it from 504 to 551.

```text
FAIL  src/__tests__/fitness/max-file-size.test.ts > max-file-size fence > enforces: no shipped file exceeds its ceiling (default 500)
AssertionError: oversized files (split them):
src/infrastructure/ledger/ledger-store.ts: 551 > 550: expected [ Array(1) ] to deeply equal []
```

The injection was reverted and the file measures 504 again. The fence's own companion still
flags a synthetic file one line over the DEFAULT and passes a small one, so neither pin
weakens the default. Every other shipped file was re-measured with this fence's algorithm:
`migrations.ts` 510/560, `ledger-replay-loader.ts` 493/500 (the closest unpinned file, outside
the threshold this correction applies), and nothing else above 445. The line-budget companion
measures contracts 4,598, domain 1,584, infrastructure 7,706, and presentation 928 - the
restored formatting is the +5 on infrastructure, against an unmoved 7,800 ceiling.

**Revert:** no planted padding remains in `ledger-store.ts`.

**Date:** 2026-08-06 (review corrections, D-131).

---

## D-130's production arm is forward-looking, and the record now says so (D-131)

**Invariant:** a DECISIONS entry describes behavior that can occur. D-130 justified the
deferred-empty vacuity verdict with a production restore operator; production cannot reach that
verdict until the managed-Postgres adapter lands (D-006/ADR-0004), so `staging` is the arm
exercised today. Verified against the shipped scripts:

```text
APP_ENV=production VERIN_STORE_DRIVER=postgres DATABASE_URL=postgres://...
  audit-chain-verify error: STORE_UNAVAILABLE: postgres store adapter is deferred
  (ADR-0004/D-006); use VERIN_STORE_DRIVER=pglite for dev/CI

APP_ENV=production VERIN_STORE_DRIVER=pglite
  Error: FATAL: invalid configuration: store.driver: PROD_REQUIRES_POSTGRES:
  production must use the postgres store driver
```

Both refusals land at store creation and config validation respectively - before
`decisionLedgerVacuity` is consulted at all. No guard, verdict, or dev/CI behavior changed:
D-130 carries the correction, the script header names which arm is exercised and which awaits
the adapter, and `docs/runbooks/backup-and-restore.md` marks its steps 3-4 as the procedure
that adapter must satisfy.

**Revert:** documentation and a comment; the shipped verdict is untouched.

**Date:** 2026-08-06 (review corrections, D-131).
---

## A frozen codec arm narrower than its contract is now caught (D-132)

**Invariant:** what the live `LedgerEntrySchema` accepts on the write path, the pinned
`recordedLedgerV1_1` codec accepts on the read path - for every one of the sixteen variants and
all three replay-source classes, byte-for-byte.

**Injection:** dropped the optional `evidenceSnapshotRef` property from the `StatusObserved` arm
of the frozen ledger JSON Schema in `src/infrastructure/ledger/recorded-schemas.ts` - the exact
"dropped optional" narrowing the invariant guards, since the arm carries
`additionalProperties: false`.

```text
FAIL src/__tests__/unit/decision-ledger-contract.test.ts >
  dispatches frozen ledger and replay-source codecs by recorded version
AssertionError: expected 'payload does not match its recorded e…' to be null
```

That is L2's own refusal reason, surfaced at the contract instead of on a stored chain. The
failure lands on `StatusObserved`, and the eleven variants before it still passed under the
injected schema - which is precisely why the previous single-sample form of this test
(`allLedgerEventSamples()[0]`, `DecisionRecorded`) stayed green against the same narrowing. The
content-digest test failed alongside it, as a byte pin must, but it is self-referential: it
detects that the bytes moved, never that they moved somewhere the live contract disagrees with.

**Revert:** the schema file was restored from a pre-injection copy and `git diff` reports it
unchanged; the suite passes 9/9.

**Date:** 2026-08-06 (review corrections, D-132).
---

## The repair cannot run unscoped, and the badge cannot report one fixed class (DECISIONS.md D-129)

> Citation note: from "Ledger reachability made transitive" onward, the `(D-1xx)` parentheticals in
> the entries above run four ahead of the `DECISIONS.md` headers they name (that entry proves
> D-121's work, not D-125's). The drift is pre-existing and left uncorrected here rather than
> bulk-renumbered late in the window; this entry names its decision by file and number to stay
> unambiguous. Recorded under `ledger-followup-recorded-schema-authoring`.

**Invariant A:** `pnpm ledger:rebuild` refuses to run unscoped or to write without `--apply`.
A repair that discards and re-folds derived decision state must not be reachable by accident.

**Injection:** `parseRebuildInvocation` collapsed to
`return { orgId: positional[0] ?? "", apply: true };` - the fleet-wide, write-by-default form the
contract replaced.

```text
× refuses an unscoped run: no argument means no action
  AssertionError: expected { orgId: '', apply: true } to be null
× refuses a fleet-wide run: exactly one tenant, never several
  AssertionError: expected { orgId: 'org-a', apply: true } to be null
× refuses an unrecognized flag rather than silently ignoring it
  AssertionError: expected { orgId: 'org-a', apply: true } to be null
× previews by default and writes only when --apply is explicit
  AssertionError: expected { orgId: 'org-a', apply: true } to deeply equal { orgId: 'org-a', apply: false }
```

All four halves are load-bearing on their own: no single one of them passes under the collapse.

**Invariant B:** a synthetic value badges with the class its producer STORED, never one fixed class.

**Injection:** `syntheticBadgeLabel`'s derived branch replaced by
`return DEV_BADGE_TEXT["synthetic-fixture"];` - exactly the constant the finding reported.

```text
× badges a synthetic value with its OWN class, never one fixed class
  AssertionError: expected 'synthetic fixture' to be 'estimate'
× badges a derivation from the synthetic leaves that made it a demonstration
  AssertionError: expected 'synthetic fixture' to be 'estimate'
```

The `fixture` case still passed under the injection, which is why the seeded ledger looked correct
before this round: the only synthetic producer that ships today is the one the constant named.

**End-to-end** against a seeded PGlite store (one org, five ledger entries, one decision), with
derived state deliberately wiped first:

```text
after wipe             projections=0 [] reservations=0
ledger:rebuild <org>   would rebuild 1 decision projection(s) from 5 replayed entr(ies)
                       PREVIEW only - nothing was written; re-run with --apply to commit
after preview          projections=0 [] reservations=0
ledger:rebuild --apply rebuilt 1 decision projection(s) from 5 replayed entr(ies)
after apply            projections=1 [dec:GC-01:0001] reservations=0
(no argument)          usage: pnpm ledger:rebuild <org-id> [--apply]      exit=1
<org> --force          usage: pnpm ledger:rebuild <org-id> [--apply]      exit=1
ledger:rebuild org-nope  org org-nope REFUSED - NOT_FOUND (app-error:NOT_FOUND, info)  exit=1
```

The preview left the derived tables byte-identical to the wiped state, and the classified per-org
refusal survived the rewrite.

**Revert:** both injected files were restored from pre-injection copies; `git diff` reports
`scripts/ledger-rebuild-args.ts` unchanged and `src/contracts/provenance.ts` carrying only this
round's additions. Suites pass 11/11, and `pnpm test` passes 1,436/1,436.

**Date:** 2026-08-06 (review corrections, DECISIONS.md D-129).

## The preview is proven by the store, not by its carrier (DECISIONS.md D-130)

**Invariant A:** the DEFAULT operator invocation writes nothing. `rebuildDecisionProjections(db,
tenant, { apply: false })` runs the identical replay and leaves the store exactly as it found it.

**Injection:** `if (!apply) throw previewRollback(rebuilt);` replaced by `if (!apply) return
rebuilt;` - the committing refactor the finding described, which leaves the Symbol carrier itself
untouched and every argv test green.

```text
× previews a rebuild without writing, then applies the identical fold
  src/__tests__/integration/ledger-projections.test.ts:215
  AssertionError: expected [ { org_id: 'firm-a', decision_id: 'dec:GC-01:0001', … } ] to deeply equal []
```

The assertion that bit reads `decision_state_projection` back out of the store, so it does not
depend on how the rollback is carried - only on whether the preview wrote.

**Invariant B:** the rebuild's post-condition rejects a fold that did not cover what it replayed.

**Injection:** `if (uncovered) throw appError("STORE_CONSTRAINT", uncovered);` neutered to
`if (false && uncovered) …`.

```text
× rolls a rebuild back on 'a dropped projection write'
  AssertionError: promise resolved instead of rejecting
× rolls a rebuild back on 'a derived row stamped outside the replay'
  AssertionError: promise resolved instead of rejecting
```

Both arms of `replayCoverageReason` are load-bearing: each case injects its own fault into the
projection INSERT inside the replay transaction and matches its own reason string, so neither arm
is passing on the other's behalf.

**Revert:** `src/infrastructure/ledger/ledger-verification.ts` was restored from a pre-injection
copy after each run; `git diff` reports it unchanged by this round. `ledger-projections.test.ts`
passes 22/22.

**Date:** 2026-08-06 (review corrections, DECISIONS.md D-130).

## The named deferral prompt is bound to its own record, not to prose (documentation sync)

The two ledger deferrals cited "v3 prompt 8" - the primitive-vocabulary prompt, already landed and
shipping no ledger producer. Corrected to **v3 prompt 18** (authority, multistage approval, and
override) in `DEFERRED_EXPORTS`, D-119, D-121, D-129, and `PLAN.md` Appendix 4: it is the first
prompt in `docs/v3/verin-prompt-sequence-v3.md` whose deliverables are post-decision facts, which
is the only class `appendDecisionEvents` accepts.

**Injection** (the correction is coupled, not two independent edits): `DEFERRED_EXPORTS` restored
to `{ prompt: "v3 prompt 8", decision: "D-119" }` while DECISIONS.md kept the corrected prose.

```text
× enforces: each deferral names its prompt in its own DECISIONS.md entry
  AssertionError: D-119 does not name v3 prompt 8: expected '### D-119 · 2026-08-05 · reversible ·…'
  to contain 'v3 prompt 8'
```

So the fence's registry cannot drift from the entry that records it in either direction - the
existing PF-204 injections already prove the reachability and stale-deferral arms.

**Revert:** the injection was reverted; `DEFERRED_EXPORTS` carries prompt 18 and the fence passes
11/11. No export, deferral, or seam was added or removed.

**Date:** 2026-08-06 (documentation sync).

## PF-188..PF-191 · replay-corpus fences · v3 prompt 11 (ADR-0034)

**Numbering note.** Upstream assigned the topic branch's proof range before integration. Canonical
mappings are **PF-090..PF-093 -> PF-188..PF-191** and
**PF-094..PF-108 -> PF-192..PF-206**. Earlier corpus references use these mappings. Recorded as D-102.

---

## PF-188 · corpus-determinism · `src/__tests__/fitness/corpus-determinism.test.ts`

**Invariant (ADR-0034):** the same spec and seed produce the same bytes forever; a different seed
produces a different corpus; inserting a household mid-spec changes ONLY that household's cases; no
clock, randomness, locale API or environment read exists under `scripts/corpus/`; and generation is
time-zone independent.

**Injection 1 - randomness at the derivation primitive.** Replaced the path-keyed body of
`deriveIntInRange` (`scripts/corpus/seed.ts:61`) with `min + Math.floor(Math.random() * (max - min + 1))`.

**Observed failure (verbatim, abridged to the distinct assertions):**
```
FAIL src/__tests__/fitness/corpus-determinism.test.ts > (d) enforces: no clock, randomness, locale API, or env read under scripts/corpus/
AssertionError: non-deterministic APIs in the generator:
scripts/corpus/seed.ts:61 Math.random: expected [ { …(3) } ] to deeply equal []

FAIL src/__tests__/fitness/corpus-determinism.test.ts > (a) enforces: two generations of the same spec + seed are byte-identical
AssertionError: expected [ …(26) ] to deeply equal []
+   "synthetic/CS-absent-withdrawal-schedule.json",
+   "synthetic/CS-authority-lapse-inside-retrieval.json",
    … all 26 cases …
```
Five of the fence's assertions failed: the AST ban, double-generation byte identity, the committed-tree
comparison, the mid-spec insertion property, and TZ independence.

**Injection 2 - ORDER-SENSITIVE derivation (the stream-PRNG failure mode).** Changed the derivation
path in `scripts/corpus/generate.ts:303` from the case's stable id to its ORDINAL POSITION in the spec
(`case/${spec.cases.cases.indexOf(corpusCase)}`) - deterministic across runs, but position-keyed.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/corpus-determinism.test.ts > (c) enforces: inserting a household mid-spec changes ONLY that household's cases
AssertionError: expected [ …(14) ] to deeply equal [ Array(1) ]
+   "synthetic/CS-blocked-pending-action.json",
+   "synthetic/CS-clean-ample-liquidity.json",
+   "synthetic/CS-clean-fresh-authority.json",
    … 14 unrelated cases churned by one insertion …

FAIL src/__tests__/fitness/corpus-determinism.test.ts > (a) enforces: the COMMITTED corpus equals a fresh regeneration (no hand edits)
AssertionError: committed corpus drifted:
synthetic/CS-absent-withdrawal-schedule.json: committed bytes differ from regeneration (3511 vs 3511 bytes) - generated files are never hand-edited
```
This is the proof that matters most: a plausible, fully deterministic generator still fails, because
determinism alone is not order-independence.

**Injection 3 - hand edit to a generated file.** Flipped `"kind":"clean-control"` to `"kind":"defect"`
in `fixtures/corpus/synthetic/CS-clean-verified-destination.json` (a label change - the exact edit that
would inflate a coverage figure).

**Observed failure (verbatim, `pnpm corpus:validate`):**
```
  ✗ synthetic/CS-clean-verified-destination.json: committed bytes differ from regeneration (5231 vs 5238 bytes) - generated files are never hand-edited

corpus: 1 problem(s) - a hand-edited or drifted corpus cannot pass (charter #4)
```

**Injection 4 - oversized tooling file** (proving the ADR-0034 extension of `max-file-size` to
`scripts/**` is live). Created `scripts/corpus/_adv-big.ts` with 501 comment lines.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/max-file-size.test.ts > enforces: no shipped or tooling file exceeds its ceiling (default 500)
AssertionError: oversized files (split them):
scripts/corpus/_adv-big.ts: 502 > 500: expected [ Array(1) ] to deeply equal []
```

**Revert:** every injected file restored from a pre-injection copy and byte-compared
(`diff -r` clean over `scripts/corpus` and `fixtures/corpus`); `pnpm test:fitness` →
`Tests 432 passed (432)`; `pnpm corpus:validate` → `regenerated byte-identical; every rule holds`.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a).

---

## PF-189 · corpus-provenance-split · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (architecture v3 §2.4, demo contract §7, ADR-0034):** the corpus metric is split by
provenance and never blended; an empty real-derived partition yields `detectionRate: null` with a reason
code and never borrows the synthetic figure; labeled clean controls exist so a false-positive rate is
reportable beside coverage; the real-derived intake contract is fail-closed; agents never sign.

**Injection 1 - a blending function.** Added `scripts/corpus/_adv-blend.ts`:
`export const headline = (r: CorpusReport): number => r.synthetic.defectCases + r.realDerived.defectCases;`

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/corpus-provenance-split.test.ts > (c) enforces: no code in scripts/ blends the two provenance partitions
AssertionError: blended provenance figures:
scripts/corpus/_adv-blend.ts:3: combines the synthetic and real-derived partitions into one figure: expected [ Array(1) ] to deeply equal []
```

**Injection 2 - substituting a figure for the empty partition.** Changed the empty-partition branch of
`measurePartition` (`scripts/corpus/report.ts:109`) to return `{ value: 1, reasonCode: null }` instead of
withholding - i.e. an empty real-derived partition reporting a perfect rate.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/corpus-provenance-split.test.ts > (d) enforces: with an empty real-derived partition the reporter withholds detectionRate
AssertionError: expected { value: 1, reasonCode: null } to deeply equal { value: null, …(1) }
-   "reasonCode": "real-derived-corpus-absent",
-   "value": null,
+   "reasonCode": null,
+   "value": 1,
```

**Injection 3 - a corpus with no clean controls.** Removed every `clean-control` case from
`fixtures/corpus/spec/cases.json` and regenerated.

**Observed failure (verbatim, `pnpm corpus:validate`):**
```
  ✗ corpus: no labeled clean controls - a coverage figure without a false-positive rate is not a measurement (captain ruling 2026-07-28)
```

**Injection 4 - a stale captain signature.** Set `spec/SIGNOFF.md` to `status: signed` with
`signedDigest: 0000…0000` (i.e. a signature carried across a regeneration).

**Observed failure (verbatim):**
```
  ✗ fixtures/corpus/spec/SIGNOFF.md: signed-but-regenerated - signedDigest 0000000000000000000000000000000000000000000000000000000000000000 does not match the current corpusDigest d3fe7e8164bb7765027910267dfa78d8cbec9e65b37473ca4f0de089172cef7c; regeneration invalidates the signature and requires re-signing
```

**Injection 5 - real-derived cases that leak PII, two ways.** (a) a case carrying an UNANTICIPATED
key `advisorNote` with real-looking prose; (b) a case with prose inside an ANTICIPATED key, `subjects`.

**Observed failures (verbatim):**
```
  ✗ real-derived/RD-0011223344556677.json: (root) - Unrecognized key: "advisorNote"
  ✗ real-derived/RD-00aabbccddeeff00.json: subjects.0 - Invalid string: must match pattern /^tok:[0-9a-f]{16}$/
```
Both halves of fail-closed: an unanticipated field is rejected by the strict shape, and an anticipated
one is rejected by the closed-vocabulary scan.

**Standing companions (run every CI build) that this fence needs to stay non-vacuous:** a POPULATED
real-derived partition produces `detectionRate: {value: 0.5}` (so the `null` is a real branch, not a
stub); a detector that flags every case scores `syntheticDefectCoverage 1.0` **and**
`falsePositiveRate 1.0`; coverage measured with no controls is `interpretable: false`; a VALID
real-derived case is accepted (the intake contract is not a blanket reject); a self-reviewed scrub and
an inflated record count are rejected.

**Revert:** all injected files removed/restored and byte-compared; `pnpm test:fitness` →
`Tests 432 passed (432)`.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a).

---

## PF-190 · corpus-timestamps · `src/__tests__/fitness/corpus-timestamps.test.ts`

**Invariant (ADR-0034, design §4.6):** observation precedes retrieval and never postdates the trigger;
retrieval lands inside the committed per-kind band; freshness and recent-change membership are
RECOMPUTED, never trusted; business-day arithmetic never lands on a local weekend; and local renderings
come from pinned tz transitions, checked against the platform time-zone database.

**Injection - a hardcoded UTC offset.** Replaced the computed offset suffix in `renderLocal`
(`scripts/corpus/clock.ts:132`) with a literal `-04:00` - the single most common real-world version of
this bug, and one that renders plausibly for two-thirds of the year.

**Observed failure (verbatim, abridged):**
```
FAIL src/__tests__/fitness/corpus-timestamps.test.ts > enforces: every emitted local rendering agrees with the platform time-zone database
AssertionError: local renderings drifted from the tz database:
CS-clean-fresh-authority/evs:CS-clean-fresh-authority:authority:daniel-on-okonkwo: rendered -04:00 but tzdb says -300 minutes
CS-dst-straddling-observations/evs:CS-dst-straddling-observations:recent-change:smiths-review-est: rendered -04:00 but tzdb says -300 minutes
CS-expired-and-future-restrictions/evs:CS-expired-and-future-restrictions:restriction:smiths-expired-cap: rendered -04:00 but tzdb says -300 minutes
CS-joint-owners-conflicting-instructions/evs:…:household-instruction:smiths-robert-instruction: rendered -04:00 but tzdb says -300 minutes
```
Two further assertions failed with it: "the corpus actually straddles a DST boundary (both offsets
appear)" and the companion "flags a DST-boundary instant rendered with a FIXED -04:00 offset". The
oracle is ICU, which the generator is forbidden to touch - so the check cannot be satisfied by the same
mistake that produced the data.

**Standing companions:** `retrievedAt` before `observedAt`; evidence observed after the trigger; ZERO
retrieval latency; a lag outside the per-kind band; `retrievalLagSeconds` disagreeing with the emitted
instants; a `fresh` label on genuinely stale evidence (the GC-09 hole nothing checked before); a change
claimed "recent" outside the firm window; a settlement horizon on a weekend; a `deadlineFeasible` flag
contradicting its own dates; and an instant outside the pinned transition table, which is REFUSED rather
than defaulted to standard time.

**Revert:** `scripts/corpus/clock.ts` restored and byte-compared; fence green.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a).

---

## PF-191 · conflict-key-families · `src/__tests__/fitness/conflict-key-families.test.ts`

**Invariant (ADR-0034, design §4.5):** the derivation reproduces every signed `conflict:`/`res:`/`idem:`
literal exactly; same scope + family ⇒ identical key; different scope or different family ⇒ different
key; and one scope under two firms is NEVER the same conflict, because reservation identity is the pair
`(firmId, conflictKey)`.

**Injection 1 - a family-blind key.** Made `conflictKey` (`scripts/corpus/conflict-keys.ts:58`) always
return `conflict:${scopeSlug}-liquidity` - a function that still satisfies the prompt's literal
requirement ("simultaneous-request cases share conflict keys") while collapsing every family.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/conflict-key-families.test.ts > enforces: property 3 - a different family in the same scope yields a different key
AssertionError: expected 1 to be 7 // Object.is equality
- 7
+ 1
```
This is exactly why property 1 alone is not a test: the injected function passes it.

**Injection 2 - string-only conflict identity.** Dropped the `firmId` comparison from `sameConflict`
(`scripts/corpus/conflict-keys.ts:82`), i.e. reservation lookup keyed on the conflict string alone.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/conflict-key-families.test.ts > enforces: property 4 - one scope under two firms is never the same conflict
AssertionError: expected true to be false

FAIL src/__tests__/fitness/conflict-key-families.test.ts > detects (companion): treating a cross-firm key as shared is caught by property 4
AssertionError: expected true to be false
```
Under `FirmId ≡ org_id` (ADR-0026) this bug would let Firm A's reservation on
`conflict:smiths-liquidity` block Firm B's request for the same household - the demo's headline act.
Reservations land at prompt 23; this fence records and holds the requirement now.

**Standing companions:** a constant-returning derivation; a family collision; an unknown family and a
malformed scope (both refused rather than silently keyed); and the proof that a facts-only idempotency
key COLLIDES on live signed data - seven of the eight signed idempotency literals share the facts
`smiths-75000-2026-08-15`, so a
naive derivation collapses seven distinct decisions onto one key, while the shipped decision-keyed
derivation yields one key per case.

**Revert:** `scripts/corpus/conflict-keys.ts` restored and byte-compared; fence green
(`Tests 14 passed`).

**Date:** 2026-07-28 (v3 prompt 11, PR-11a).

---

## PF-192 · corpus-provenance-split (clean-control honesty + taxonomy completeness) · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-078/D-079, ADR-0034 §2b/§6):** a labeled clean control is the false-positive DENOMINATOR,
so it may not carry the defect being measured - not through a stale observation, an authority lapsing
inside the evidence interval, a restriction recorded but out of force, an unverified or
last-four-colliding destination, an evidence item pointing at a record absent from its own subgraph, an
infeasible deadline, or an asserted awkward structure. And every class in the closed taxonomy must be
carried by at least one labeled defect case, mirroring the spec loader's unexercised-assumption rule.

**Injection 1 - the pre-D-078 evidence model.** Restored one line of `observedAtOf`
(`scripts/corpus/generate.ts`) to infer an authority's observation from its business date
(`find(world.authorizedSigners).effectiveFrom`) - the shape the whole generator had before this change,
and the shape that makes a long-standing fact necessarily stale.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/corpus-provenance-split.test.ts > (e) enforces: no clean control carries a defect implicitly (stale, lapsed, expired, or unverified evidence)
AssertionError: clean controls carrying the defect being measured:
CS-clean-fresh-authority/evs:CS-clean-fresh-authority:authority:daniel-on-okonkwo: evidence is "stale" - a control cannot carry evidence-staleness-unnoticed: expected [ Array(1) ] to deeply equal []
```
`CS-clean-fresh-authority` is titled "long-standing, unexpired authority" and its rationale says "no
interval question arises" - and it was shipping `freshness: "stale"`. Four of the five controls did.

**Injection 2 - the unexercised class.** Deleted `AS-21` and `CS-stale-model-assignment-evidence` from
`fixtures/corpus/spec/cases.json`, returning the corpus to the state where one taxonomy class was
carried by no case at all.

**Observed failure (verbatim):**
```
✗ defectClasses[evidence-staleness-unnoticed] is carried by no labeled defect case - an unexercised class is decoration
corpus: 3 problem(s) - a hand-edited or drifted corpus cannot pass (charter #4)
```

**Injection 3 - a drifted un-defer trigger.** Rewrote `corpus_deferral.un_defer_trigger` in
`config/demo/scenarios.yaml` to a DIFFERENT 166-character sentence naming a different authorized source.
The previous assertion was `String(...).length > 40`, which this passes.

**Observed failure (verbatim, abridged):**
```
FAIL src/__tests__/fitness/corpus-provenance-split.test.ts > (d) enforces: the scenario matrix records the same deferral, with the same trigger
AssertionError: expected 'The captain authorizes a scrubbed sou…' to be 'The captain authorizes a scrubbed sou…' // Object.is equality
Expected: "…real NIGO returns, custodian rejections, or operational exceptions…"
Received: "…real operational exception history…"
```

**Standing companions:** five real defect cases relabeled as clean controls, one per mechanical defect
signature (staleness, interval collapse, restriction lifecycle, destination integrity, deadline
feasibility), each required to be caught; a control that still asserts an awkward structure; a control
whose evidence points at a record stripped from its own subgraph; and a taxonomy class dropped from the
case set.

**Revert:** `scripts/corpus/generate.ts`, `fixtures/corpus/spec/cases.json` and
`config/demo/scenarios.yaml` restored and byte-compared; `pnpm corpus:validate` reports "regenerated
byte-identical; every rule holds"; fences green.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a review round 1).

---

## PF-193 · corpus-determinism (prefix-colliding household + input-order neutrality) · `src/__tests__/fitness/corpus-determinism.test.ts`

**Invariant (D-080):** "adding a household changes only that household's bytes" must survive a new
household whose key EXTENDS an existing one, and a semantically neutral reorder of a case's evidence
array must not move a conflict key, a case's bytes, or `corpusDigest`.

**Injection 1 - substring subject resolution.** Restored the unanchored legal-hold filter in
`householdSubgraph` (`row.subjectRef.includes(":" + householdKey)`) in place of the structured
`requireLegalHoldSubject` parse. The fence's inserted household is now keyed `smiths-west` and carries
its own hold `position:smiths-west-taxable:NBRD-2031`.

**Observed failure (verbatim, abridged):**
```
FAIL src/__tests__/fitness/corpus-determinism.test.ts > (c) enforces: inserting a PREFIX-COLLIDING household mid-spec changes ONLY that household's cases
AssertionError: expected [ …(17) ] to deeply equal [ Array(1) ]
+   "synthetic/CS-authority-lapse-inside-retrieval.json",
+   "synthetic/CS-beneficiary-versus-destination-restriction.json",
    … 17 files, all of them `smiths` cases …
```
Seventeen foreign cases changed because one new household's hold leaked into `smiths`. The previous
fence inserted a household keyed `inserted`, which collides with nothing and could not detect this.

**Injection 2 - raw-order conflict scope.** Made `conflictScope` scan `corpusCase.evidence` in spec
order again instead of the sorted list.

**Observed failure (verbatim):**
```
FAIL src/__tests__/fitness/corpus-determinism.test.ts > (a) enforces: the COMMITTED corpus equals a fresh regeneration (no hand edits)
AssertionError: synthetic/CS-joint-owners-conflicting-instructions.json: committed bytes differ from regeneration (9788 vs 9791 bytes) - generated files are never hand-edited
```
Exactly the one case whose conflict scope is chosen from its evidence list.

**Positive control:** with the fix in place, swapping that case's evidence array into a different order
in `fixtures/corpus/spec/cases.json` leaves the whole fence green (`Tests 14 passed`) - the reorder is
byte-neutral, which is the property itself rather than the absence of a symptom.

**Revert:** `scripts/corpus/generate.ts` and `fixtures/corpus/spec/cases.json` restored and
byte-compared; fence green.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a review round 1).

---

## PF-194 · corpus-provenance-split (graph, intake, signoff, and measurement boundaries) · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-081, ADR-0034):** every evidence and request reference resolves to exactly one emitted
record; the active real-derived deferral admits no delivered file; the signed preimage covers taxonomy
semantics; partial detector runs emit no figure; scrub ids and signoff use closed authority vocabularies;
and no `src/` or `scripts/` path blends provenance partitions.

**Injection 1 - dangling evidence.** Changed model-assignment evidence back to the generic `subject:` id
while emitted model records retained the distinct `model-assignment:` id.

**Observed failure (verbatim):**
```
CS-pending-rebalance-during-evaluation/...subjectRef: reference "subject:smiths-joint-model" resolves to 0 emitted records, expected exactly one
CS-stale-model-assignment-evidence/...subjectRef: reference "subject:smiths-ira-model" resolves to 0 emitted records, expected exactly one
```

**Injection 2 - deferral and taxonomy bypasses.** Made the active-deferral check accept every delivered
file and removed `taxonomyDigest` from the signed corpus preimage.

**Observed failures (verbatim):**
```
AssertionError: expected +0 to be 1
AssertionError: expected '4bfd918d...' not to be '4bfd918d...'
```

**Injection 3 - favorable subset.** Replaced the incomplete-outcomes guard with an unreachable condition.

**Observed failure (verbatim):**
```
Expected: {"reasonCode":"detector-outcomes-incomplete","value":null}
Received: {"reasonCode":null,"value":1}
```

**Injection 4 - bypassable provenance split.** Removed call expressions from the repository-wide AST
detector.

**Observed failures (verbatim):**
```
the blending detector catches helper aliases in product source
the blending detector catches array concatenation in product source
AssertionError: expected 0 to be greater than 0
```

**Injection 5 - open scrub and signoff vocabularies.** Broadened evidence ids to any id-shaped string and
disabled the closed captain-authority check.

**Observed failures (verbatim):**
```
a real-derived derived id cannot hide a name or use an open suffix
AssertionError: expected 0 to be greater than 0

signed signoff requires the closed captain authority and canonical signedAt instant
AssertionError: expected '...signedAt "not-a-date"...' to contain 'closed captain authority'
```

**Standing companions:** missing collection, dangling reference, multi-resolving reference, duplicate
spec key, cross-household destination, real-derived inventory after un-deferral, extractor absence,
reversed custody chronology, dangling real-derived evidence, mismatched derived-id suffixes, partial
detector outcomes, wrong-partition outcomes, division, reducers, helper calls, concatenation, imported
alias laundering, opaque-id suffixes, captain authority, and canonical `signedAt`.

**Revert:** all seven injected changes reverted with patch edits; focused fence green
(`Tests 48 passed (48)`).

**Date:** 2026-07-28 (v3 prompt 11, PR-11a review round 2).

---

## PF-195 · corpus-provenance-split (inventory, topology, recursive intake, freshness, and artifact ownership) · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-082, ADR-0034):** reporting is bound to the signed manifest inventory; numeric partition
results stay inside their owner; pending-action liquidity is direction-aware; every household edge
resolves; generated and intake trees are recursive; real-derived freshness is policy-derived; and actual
generated artifacts contain no signature keys.

**Injection 1 - action state ignored.** Replaced the live-state predicate in
`scripts/corpus/pending-actions.ts` with `true`.

**Observed failure:**
```
pending-action liquidity treatment is closed and direction-aware for every kind and state
AssertionError: expected true to be false
```

**Injection 2 - signed inventory detached.** Disabled the recomputed inventory-digest comparison in
`scripts/corpus/report.ts`.

**Observed failure:**
```
the signed corpus digest binds the exact inventory supplied to reporting
AssertionError: expected [Function] to throw an error
```

**Injection 3 - recursive walk removed.** Made `scripts/corpus/tree.ts` ignore directories.

**Observed failure:**
```
(d) enforces: generated and real-derived trees are recursively inventoried, including hidden and nested files
AssertionError: expected [ 'manifest.json' ] to deeply equal [ 'manifest.json', ...(3) ]
```

**Injection 4 - freshness trusted.** Disabled the supplied-versus-derived freshness comparison in
`scripts/corpus/scrub-contract.ts`.

**Observed failure:**
```
real-derived freshness is derived from evaluation.asOf and the versioned per-kind policy
AssertionError: expected false to be true
```

**Injection 5 - generated signature scan emptied.** Replaced the generated signature-key set with an
empty set.

**Observed failure:**
```
recursive signature keys are rejected in actual generated artifacts
AssertionError: expected [] to have a length of 3 but got +0
```

**Injection 6 - referenced household suppressed.** Made the referenced-household collector return before
recording a non-primary household.

**Observed failure:**
```
CS-beneficiary-versus-destination-restriction/...mira-roth.householdRef:
reference "subject:smith-mira" resolves to 0 emitted records, expected exactly one
CS-beneficiary-versus-destination-restriction/...mira-primary.householdRef:
reference "subject:smith-mira" resolves to 0 emitted records, expected exactly one
```

**Injection 7 - structured measurement escaped.** Added `buildCorpusReport` to the shipped report CLI's
imports.

**Observed failure:**
```
scripts/corpus-report.ts:15: structured corpus measurement is private to scripts/corpus/report.ts
```

**Revert:** all seven injections were reverted with patch edits. The focused fence passed
(`Tests 56 passed (56)`), and `pnpm corpus:validate` reported regenerated byte-identical with every rule
holding.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a review round 3).

---

## PF-196 · corpus intake, attribution, privacy, digest, clock, and determinism boundaries · `src/__tests__/fitness/corpus-{provenance-split,timestamps,determinism}.test.ts`

**Invariant (D-083, ADR-0034):** real-derived delivery cannot lose hidden JSON members or disclose
rejected text; replay input is complete and closed; detector credit names the exact signed defect class;
foreign topology is minimal; structured measurement is private; signed inventory binds labels; transition
selection is chronological; and nondeterministic APIs cannot hide behind imports or destructuring.

**Injection 1 - duplicate-key admission.** Removed the canonical-byte equality check after `JSON.parse`.

**Observed failure:**
```
duplicate JSON keys are rejected before a delivered value can enter inventory
AssertionError: expected [ { ... } ] to deeply equal []
"subject": "tok:0123456789abcdef"
```
The lossy parse admitted the last duplicate value and discarded the earlier raw name.

**Injection 2 - diagnostic disclosure.** Returned Zod's raw issue message instead of the redacted
schema-validation description.

**Observed failure:**
```
a real-derived case with a free-text field in an UNANTICIPATED key is rejected (fail-closed)
Expected diagnostic not to contain: "Robert Smith"
Received: Unrecognized key: "Robert Smith"
```

**Injection 3 - case-level detector credit.** Disabled the signed-label contradiction check at the
measurement boundary.

**Observed failure:**
```
coverage credits only the exact signed defect class attribution
AssertionError: expected [Function] to throw an error
```

**Injection 4 - foreign household expansion.** Added projected foreign accounts back into the full
`accounts` collection.

**Observed failure:**
```
CS-beneficiary-versus-destination-restriction/...accountRefs:
reference "subject:mira-roth" resolves to 2 emitted records, expected exactly one
```

**Injection 5 - structured result export.** Exported `buildCorpusReport`.

**Observed failure:**
```
structured partition measurements stay inside the partition-safe report owner
Expected: [ "renderCorpusReport" ]
Received: [ "buildCorpusReport", "renderCorpusReport" ]
```

**Injection 6 - label-free signed preimage.** Removed `labelKind` and `labelId` from the case tuple.

**Observed failure:**
```
the signed digest binds each case label beside its bytes
AssertionError: expected relabeled digest not to equal corpusDigest
```

**Injection 7 - input-order transition lookup.** Restored last-qualifying-input behavior. The companion
uses three explicit transitions with distinct offsets, because reversing the committed table happened to
select two transitions with the same offset and was not adversarial.

**Observed failure:**
```
transition lookup is order-independent and duplicate instants are refused
Expected: -240
Received: -300
```

**Injection 8 - named-import laundering.** Skipped the `node:crypto` named-import origin.

**Observed failure:**
```
flags destructured, aliased, and named-import nondeterministic APIs
Expected set contained "randomUUID"; received set did not
```

**Standing companions:** missing, extra, ambiguous, and incompatible replay-payload fields; duplicate
payload references; pending-action registry mismatch; exact evidence, reservation, and subject
inventories; unknown and contradictory defect attribution; duplicate transition instants; destructured
`Math`, `Date`, and `process` APIs; recursive generated-signature rejection; and malicious free text in
both a value and an unrecognized key.

**Revert:** all eight source injections were reverted with patch edits. Focused fences, typecheck,
canonical regeneration, and the full repository gates are green.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a review round 4).

---

## PF-197 · real-derived truth, diagnostics, signoff, schema, denominator, and determinism boundaries · `src/__tests__/fitness/corpus-{provenance-split,determinism}.test.ts`

**Invariant (D-084, ADR-0034):** real-derived labels match closed replay semantics; clean controls carry
no supported defect signature; unsafe filenames never enter diagnostics; signoff YAML is unambiguous;
both schema meanings and bytes are signed; an active real-derived partition has both measurement
denominators; and callable clocks or crypto randomness cannot bypass deterministic generation.

**Injection 1 - semantic relabeling.** Disabled the defect-label signature check.

**Observed failure:**
```
a real-derived defect label must match its closed replay semantics
expected '' to contain 'label.defectClassId does not match replay semantics'
```

The standing table companion also exercised all 16 taxonomy signatures and refused each relabel as a
clean control.

**Injection 2 - raw delivery path disclosure.** Used the raw relative path as the intake diagnostic
identity before canonical filename validation.

**Observed failure:**
```
unsafe delivery filenames never enter intake diagnostics
expected 'real-derived/Robert-Smith/account-1234.json...' not to contain 'Robert-Smith'
```

**Injection 3 - permissive YAML recovery.** Ignored the YAML parser's duplicate-key errors before
interpreting the signoff record.

**Observed failure:**
```
signoff parsing rejects duplicate keys, aliases, unexpected keys, and multiple blocks
expected '' to contain 'parse error'
```

**Injection 4 - unsigned schema semantics.** Removed both real-derived schema bindings from the corpus
digest payload.

**Observed failure:**
```
the signed digest covers both real-derived schema ids and bytes
expected changed schema digest not to equal corpusDigest
```

**Injection 5 - one-sided real-derived inventory.** Disabled the active-partition requirement for at
least one defect and one clean control.

**Observed failure:**
```
an active real-derived partition requires both measurement denominators
expected '' to contain 'no labeled clean controls'
```

**Injection 6 - callable clock and crypto randomness laundering.** Removed callable `Date` and the
expanded crypto origins from the AST detector.

**Observed failure:**
```
flags callable Date and every supported crypto randomness form
Expected: Date() (callable), generateKey, getRandomValues, randomBytes, randomFill, randomFillSync, randomInt
Received: none
```

**Revert:** all six injections were reverted with patch edits. The focused fences passed
(`Tests 102 passed (102)`), typecheck passed, and canonical corpus validation reported regenerated
byte-identical with every rule holding.

**Date:** 2026-07-28 (v3 prompt 11, PR-11a review round 5).

---

## PF-198 · signed replay semantics, topology, evidence, funding, and strict JSON · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-085, ADR-0034):** the signed preimage changes with declarative or executable replay
semantics; references are entity-kind-scoped; every material plane has exact evidence; selected funding
is explicit, owner-aligned, sufficient in aggregate, and tax-evaluated as a set; and every hand-owned
corpus JSON document rejects duplicate keys before interpretation.

**Injection 1 - executable authority ignored.** Made the semantic binding reread committed source instead
of hashing the supplied authority bytes.

**Observed failure:**
```
semantic data or executable authority changes invalidate corpus signoff
src/__tests__/fitness/corpus-provenance-split.test.ts:1419
expected changedAuthority.digest not to be original.digest
```

**Injection 2 - material evidence disconnected.** Removed the evidence-support authority from replay
topology validation.

**Observed failure:**
```
a material replay plane requires evidence with matching kind, subject, and source
src/__tests__/fitness/corpus-provenance-split.test.ts:1447
expected '' to contain 'destination evidence'
```

**Injection 3 - entity identity de-scoped.** Weakened `requestRef` to a generic token and removed the
subject and evidence topology guards that independently expose the mismatch.

**Observed failure:**
```
entity-kind-scoped references prevent one token from satisfying the replay topology
src/__tests__/fitness/corpus-provenance-split.test.ts:1459
expected '' to contain 'schema validation failed'
```

**Injection 4 - aggregate tax risk reduced to per-account sufficiency.** Considered a retirement source
only when it individually covered the full request and reserve.

**Observed failure:**
```
selected funding is explicit and aggregate sufficiency drives tax risk
src/__tests__/fitness/corpus-provenance-split.test.ts:1508
expected '' to contain 'tax-consequence-blindness'
```

**Injection 5 - funding ownership disabled.** Removed the selected-funding authority, admitting a second
same-household account with an owner unrelated to the request source account.

**Observed failure:**
```
selected funding rejects an additional source owned outside the request source ownership
src/__tests__/fitness/corpus-provenance-split.test.ts:1574
expected '' to contain 'selected funding sources must share an owner with the request source account'
```

**Injection 6 - duplicate-key parser bypassed.** Sent hand-owned JSON directly to `JSON.parse`.

**Observed failure:**
```
duplicate keys in hand-owned corpus schemas are rejected before parsing or hashing
src/__tests__/fitness/corpus-provenance-split.test.ts:1799
expected function to throw an error
```

**Standing companions:** source-account exact resolution; missing, duplicate, unsupported,
cross-household, insufficient, and unknown-tax selections; exact kind, subject, and source evidence
tuples; all 16 defect signatures; schema and semantic data digest mutation; every executable authority
source digest; nested extra-field rejection; and duplicate probes against every hand-owned corpus JSON
file.

**Revert:** all six injections were reverted with patch edits. Canonical regeneration restored
`corpusDigest` `e30aca83e8c443babbc32d765e3deff9de823a631270f7714ea3bfd48bfe0298`, and all six focused
companions passed.

**Date:** 2026-07-29 (v3 prompt 11, PR-11a review round 6).

---

## PF-199 · outcome-based replay truth and request-bound topology · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-086, ADR-0034):** awkward context is not itself a defect; a signed defect requires the
class's typed expected-versus-observed mismatch; instruction conflicts connect to the exact request and
household; identity and every schema-declared unique array fail closed.

**Injection 1 - context treated as failure.** Evaluated a verified cross-household destination using the
old context-only destination predicate.

**Observed failure:**
```
awkward context remains a clean control when every treatment is correct
expected ['destination-integrity-defect'] to deeply equal []
```

**Injection 2 - outcome authority omitted.** Labeled awkward destination context as a defect without a
typed treatment mismatch.

**Observed failure:**
```
awkward context cannot substantiate a defect without an outcome mismatch
expected '' to contain 'expected-versus-observed'
```

**Injection 3 - request topology disconnected.** Used arbitrary same-household instruction and impacted
subject references that did not connect to the governed request.

**Observed failure:**
```
instruction conflict evidence must connect to the exact governed request
expected '' to contain 'instruction conflict'
```

**Injection 4 - identity candidate unrelated.** Declared unique identity resolution with a sole candidate
different from the governed identity subject.

**Observed failure:**
```
unique identity resolution requires exactly the governed subject
expected '' to contain 'unique identity candidate'
```

**Injection 5 - nested uniqueness omitted.** Duplicated one liquidity source owner while relying on the
signed schema's `uniqueItems`.

**Observed failure:**
```
every signed-schema uniqueItems array rejects duplicates
expected '' to contain 'unique items'
```

**Standing companions:** all 16 awkward contexts remain clean with expected treatments; all 16 defect
classes require their closed mismatch; wrong request, household, instruction ownership, and impacted
subjects fail; zero and unrelated unique identity candidates fail; all nested schema unique arrays are
driven adversarially.

**Revert:** all five injections were reverted with patch edits, and the focused companions passed.

**Date:** 2026-07-29 (v3 prompt 11, PR-11a review round 8).

## PF-200 · set-order and nondeterminism-flow closure · `src/__tests__/fitness/corpus-determinism.test.ts`

**Invariant (D-086, ADR-0034):** set-like spec order cannot change emitted bytes, and banned
nondeterministic APIs cannot be laundered through assignments, parameters, local returns, or dynamic
imports.

**Injection 1 - assumptions emitted in source order.** Reversed the hand-owned assumption collection
without sorting the filtered case assumptions.

**Observed failure:**
```
assumption order is semantically neutral
expected changed files to deeply equal []
received ['CS-retirement-only-sufficient-source.json']
```

**Injection 2 - callable origins laundered.** Assigned `Date`, passed `randomBytes` through a function
parameter and return, and called a function obtained through dynamic import.

**Observed failure:**
```
nondeterministic APIs cannot be laundered through assignments, parameters, returns, or dynamic imports
expected [] to deeply equal expected Date and randomBytes findings
```

**Standing companions:** household insertion isolation, complete spec reorder invariance, assumption-only
reorder invariance, direct and imported nondeterministic sources, aliases, destructuring, assignments,
parameters, returns, literal dynamic imports, and nonliteral dynamic-import rejection.

**Revert:** both injections were reverted with patch edits, and the focused companions passed.

**Date:** 2026-07-29 (v3 prompt 11, PR-11a review round 8).

---

## PF-201 · partition-wide outcome and replay selector closure · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-087, ADR-0034):** both partitions require context-bound typed treatment mismatches;
pending actions bind to the request, selected funding, and exact evidence; pending liquidity treatment is
shared; retirement treatment includes review state; reserve and threshold treatments follow signed
selectors; and synthetic source accounts belong to their request household.

**Injection 1 - synthetic mismatch optional.** Allowed a synthetic defect label to carry no treatment
mismatch.

**Observed failure:**
```
a synthetic defect without its typed treatment mismatch fails closed
src/__tests__/fitness/corpus-provenance-split.test.ts:1110
expected '' to contain 'defect label lacks one matching expected-versus-observed treatment mismatch'
```

**Injection 2 - pending topology disabled.** Reversed the present-action guard around the household and
selected-account relationship check.

**Observed failure:**
```
pending actions bind to the request household, selected account, and exact evidence
src/__tests__/fitness/corpus-provenance-split.test.ts:1944
expected '' to match /pending action|pending-action evidence/
```

**Injection 3 - pending authority narrowed.** Excluded settling incoming transfers from the shared
nonreducing treatment rule.

**Observed failure:**
```
a settling incoming transfer uses the shared nonreducing pending authority
src/__tests__/fitness/corpus-provenance-split.test.ts:1968
label.defectClassId does not match replay expected-versus-observed semantics
```

**Injection 4 - tax review ignored.** Treated every selected retirement source as defect context even
when review was completed.

**Observed failure:**
```
retirement treatment requires a completed review or an explicit mismatch
src/__tests__/fitness/corpus-provenance-split.test.ts:1990
expected '' to contain 'claims a defect treatment without its required context'
```

**Injection 5 - reserve selector fixed.** Forced every reserve outcome through the segmented treatment
pair.

**Observed failure:**
```
reserve treatments distinguish scalar, segmented, and missing schedules
src/__tests__/fitness/corpus-provenance-split.test.ts:2052
RD-missing-reserve.json outcome is outside its closed treatment vocabulary
```

**Injection 6 - threshold comparator ignored.** Forced inclusive policy through the strict treatment
pair.

**Observed failure:**
```
threshold treatment follows the signed strict or inclusive comparator
src/__tests__/fitness/corpus-provenance-split.test.ts:2097
RD-inclusive-threshold.json outcome is outside its closed treatment vocabulary
```

**Injection 7 - source ownership disabled.** Removed the request-household check from synthetic source
account resolution.

**Observed failure:**
```
a request source account must belong to the request household
src/__tests__/fitness/corpus-provenance-split.test.ts:1143
expected '' to contain 'belongs to household "smith-mira", not request household "smiths"'
```

**Standing companions:** every synthetic taxonomy class fails when its defect is relabeled as a control;
correctly treated authority and owner-beneficiary context remains clean; pending account, household,
selection, subject, and source mismatches fail; completed and not-required retirement review
contradictions fail; scalar, segmented, and missing reserves use distinct treatments; strict and
inclusive threshold policies swap the expected and defective treatment; and every changed schema and
semantic authority changes the signed digest.

**Revert:** all seven injections were reverted with patch edits. Canonical validation restored
`corpusDigest` `bde8bcd2df731c7cfc95089d099ea884a8d9abd90e58d73ca8d498c9a1f3da5d`,
and all 151 focused corpus companions passed.

**Date:** 2026-07-29 (v3 prompt 11, PR-11a review round 9).

---

## PF-202 · exact corpus outcomes and synthetic funding topology · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-088, ADR-0034):** a real-derived defect label equals the only semantic mismatch; detector
attribution for a defect is empty or the exact signed-label singleton; synthetic funding is explicit,
unique, and request-household-owned; pending action and model semantics use only that exact set; and
missing reserve state comes from emitted schedule absence.

**Injection 1 - extra replay defect accepted.** Added a threshold mismatch beside the signed destination
mismatch while keeping the destination label.

**Observed failure:**
```
a real-derived defect label must equal the only semantic defect
src/__tests__/fitness/corpus-provenance-split.test.ts:1519
expected '' to contain 'exactly one replay semantic defect'
```

**Injection 2 - extra detector class accepted.** Attributed both the signed defect and another known class
to one defect case.

**Observed failure:**
```
coverage credits only the exact signed defect class attribution
src/__tests__/fitness/corpus-provenance-split.test.ts:1334
expected function to throw an error
```

**Injection 3 - selected funding absent.** Required every generated synthetic request to carry a
non-empty selected set.

**Observed failure:**
```
synthetic selected funding is explicit, unique, and owned by the request household
src/__tests__/fitness/corpus-provenance-split.test.ts:2006
expected false to be true
```

**Injection 4 - pending semantics crossed accounts.** Moved the cited blocked action and pending model
assignment to another same-household account outside the selected set.

**Observed failure:**
```
synthetic pending semantics use only the exact selected funding set
src/__tests__/fitness/corpus-provenance-split.test.ts:2058
expected '' to contain 'selected funding'
```

**Injection 5 - missing-schedule assumption contradicted bytes.** Added an emitted schedule while retaining
`AS-12`.

**Observed failure:**
```
synthetic missing reserve state comes from emitted schedule absence
src/__tests__/fitness/corpus-provenance-split.test.ts:2088
expected '' to contain 'AS-12 contradicts emitted withdrawal schedules'
```

**Standing companions:** unrelated extra semantic defects and detector classes fail; selected funding is
present on every synthetic case and rejects duplicates or cross-household accounts; cited pending actions
and model assignments reject unselected accounts; and an asserted missing schedule rejects emitted
schedule bytes.

**Revert:** all five injected states remain only in companions. The production authorities reject each,
and canonical validation restored `corpusDigest`
`fe921fcd64c77e5b10dbff05d8a382eb0fdd2a0b57776586ec582f796ef194de`. All 199 focused companions
passed.

**Date:** 2026-07-29 (v3 prompt 11, PR-11a review round 10).

---

## PF-203 · tenant, observation, funding, and ownership closure · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-089, ADR-0034):** the AS-04 signer is outside the LLC household membership edge;
bank-instruction and pending-action accounts belong to their declared households; selected-funding tax
and pending semantics use all and only the explicit selected set; concrete replay values require observed
evidence; every evidence plane has an observation-state authority; and real-derived case, request, and
reservation scope is one exact opaque firm reference.

**Injection 1 - contradictory AS-04 membership.** Added the cited LLC signer to the request household
membership edge.

**Injection 2 - contradictory owned edges.** Assigned a bank instruction and pending action to accounts
owned by another household.

**Injection 3 - selected funding ignored.** Added retirement funding beside a taxable request source and
moved a cited live outgoing action to an unselected account.

**Injection 4 - missing evidence accepted concrete values.** Changed request, balance, and identity
evidence from observed to missing without changing their concrete replay payloads.

**Injection 5 - tenant scope absent.** Passed a complete real-derived case with no firm reference on the
case, request, or reservation.

**Observed failure:**
```
Test Files  1 failed (1)
Tests       8 failed | 136 passed (144)
AS-04 outside-household signer
bank instruction account belongs to household
request evidence requires observed support
liquidity-source evidence requires observed support
identity evidence requires observed support
firmRef
selected funding
active "tax-consequence-blindness" context lacks a typed treatment
```

**Standing companions:** the outside signer is emitted exactly once as a separate party; inside
membership fails; bank-instruction and pending-action ownership mismatches fail; cited reducing and
nonreducing actions reject unselected accounts; tax context and generator defaults use the same selected
funding authority; concrete request, balance, and identity planes reject missing evidence; explicit
missing reserve payloads accept typed missing evidence; an unclassified future evidence plane fails; and
absent, mismatched-request, and cross-reservation firm scope each fail.

**Revert:** all injected states remain only in companions. Canonical validation restored
`corpusDigest` `81d8426eb9450b59b20880523aecf1deeec212607727e9d9616c842e66903967`.
The real-derived partition remains empty, signoff remains pending, only the three Varn synthetic case
files changed, and all 174 focused corpus, determinism, budget, and file-size tests passed.

**Date:** 2026-07-29 (v3 prompt 11, PR-11a review round 11).

---

## PF-204 · typed identity, tenant subjects, and exact funding · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-090, ADR-0034):** synthetic identity context is derived from typed raw bytes, exact
candidates, and household bindings; real-derived generic subject references exclude firm scope; and
funding aggregates preserve exact safe-integer minor units.

**Injection 1 - assumption-only identity accepted.** Disabled the typed identity-input requirement while
retaining the ambiguity assumption.

**Observed failure:**
```
synthetic identity context derives from exact emitted inputs and bindings
src/__tests__/fitness/corpus-provenance-split.test.ts:2274
expected problems to contain 'identity context requires typed identity input'
```

**Injection 2 - firm admitted as a generic subject.** Added `firmRef` to the replay schema's generic
`entityRef` union and supplied it as an instruction-conflict impacted subject.

**Observed failure:**
```
real-derived cases require one exact firm scope across case, request, and reservations
src/__tests__/fitness/corpus-provenance-split.test.ts:2093
expected problems to contain 'schema validation failed'
```

**Injection 3 - floating-point aggregate accepted.** Replaced exact integer aggregation with JavaScript
number addition for a one-cent shortfall above the safe aggregate boundary.

**Observed failure:**
```
real-derived funding aggregates preserve exact minor-unit arithmetic
src/__tests__/fitness/corpus-provenance-split.test.ts:2133
expected problems to contain 'selected funding aggregate does not cover request, reserve, and pending reductions'
```

**Standing companions:** assumption IDs without typed identity inputs fail; one-candidate ambiguity,
invalid raw-byte relationships, and incorrect household bindings fail; firm references fail in impacted
subjects and the generic subject inventory; unsafe individual amounts fail schema validation; and a
one-cent aggregate shortfall is detected with exact arithmetic.

**Revert:** all three injections were reverted. Canonical generation restored `corpusDigest`
`e1f5dec83c44a807b26eb2c5a812ec41177f29bba8a222cb74c7a106498a17de`. The real-derived partition
remains empty, signoff remains pending, path-keyed isolation passes, and all 195 focused corpus,
determinism, timestamp, budget, and file-size tests passed.

**Date:** 2026-07-29 (v3 prompt 11, PR-11a review round 12).

---

## PF-205 · instruction and signed-authority closure · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-091, ADR-0034):** instruction-conflict truth comes from request-bound typed terms and exact
evidence; the signed executable inventory equals its runtime dependency closure; signoff YAML rejects
warnings and tags; citations remain regular files inside the repository; and both tooling fences discover
every supported TypeScript and JavaScript source extension.

**Injection 1 - runtime authority omitted.** Removed `scripts/corpus/clock.ts` from the executable
authority inventory.

**Injection 2 - termless context accepted.** Treated every cited instruction record as a conflict without
requiring a connected typed term.

**Injection 3 - parser recovery accepted.** Ignored YAML warnings and explicit tags before conversion.

**Injection 4 - citation escaped.** Removed the canonical repository-containment check while retaining
the regular-file check.

**Injection 5 - executable files hidden.** Reduced shared source discovery to `.ts` only.

**Observed failure:**
```
Test Files  3 failed (3)
Tests       6 failed | 158 skipped (164)
missing executable authority dependency scripts/corpus/clock.ts
expected '' to contain 'defect label lacks one matching expected-versus-observed treatment mismatch'
expected '' to contain 'YAML warning'
expected '' to contain 'is not a regular file contained in this repository'
expected [ 'a.ts' ] to deeply equal [ 'a.ts', 'b.tsx', 'c.mts', ... ]
expected discovered files to contain big.mjs
```

**Standing companions:** removing any runtime dependency fails the exact closure comparison; assumption
labels, termless, expired, and source-unconnected restrictions cannot prove conflict; exact Mira
targeting and correctly governed controls remain live; warnings and explicit tags invalidate signoff; traversal
and symlink citation escapes fail; and `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`
all enter both tooling fences.

**Revert:** all five weakenings were reverted. Canonical validation restored `corpusDigest`
`4218a81abc15cd2f90cf20af3bad1c8982e5de27d87d096912a3ed304e89e9a5`. The real-derived partition
remains empty, captain signoff remains pending, and all 164 focused corpus, budget, and file-size tests
passed.

**Date:** 2026-07-29 (v3 prompt 11, D-091 review hardening).

---

## PF-206 · emitted structural context and complete authority closure · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-092, ADR-0034):** DST and shared-instruction blast-radius context derives from exact
emitted signed facts, joint destinations retain target-specific owner semantics, and the signed
executable-authority closure covers every supported runtime loader form.

**Injection 1 - assumption-only context.** Replaced both structural context authorities with checks for
`AS-16` and `AS-06`.

**Injection 2 - global singular owner rule.** Restored the unconditional requirement that every
destination have exactly one owner before analyzing the term target.

**Injection 3 - incomplete module traversal.** Filtered import-equals, createRequire, and indirect
require references out of the shared module-reference results.

**Observed failure:**
```
Test Files  1 failed (1)
Tests       4 failed | 152 skipped (156)
expected [] to include 'missing executable authority dependency scripts/corpus/conflict-keys.ts'
synthetic DST context requires exact zone-bound records crossing a declared transition
synthetic blast radius requires one cited changed instruction with multiple governed accounts
expected problems to deeply equal []
```

**Standing companions:** same-offset and missing-zone temporal records fail; assumption-only temporal
context fails; a one-account, differently changed instruction, or mismatched instruction-change instant
fails blast-radius context; correctly treated shared-instruction context remains a clean control; joint
destinations work for unrelated term
kinds and exact destination-subject members; duplicate owners fail; import-equals reaches a local helper;
and createRequire, aliased require, and module.require fail closed.

**Revert:** all three weakenings were reverted. Canonical validation restored `corpusDigest`
`a4b7ee7cad29d17e697154069a20f09e4215681ea0bbab28a6a37e5994ed07f4`. The real-derived partition
remains empty, captain signoff remains pending, path-keyed generation changes only the DST case, and all
156 corpus-provenance companions pass.

**Date:** 2026-07-29 (v3 prompt 11, D-092 review hardening).

---

## PF-207 · corpus privacy, gateway authority, determinism, and settled credits · `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-093, ADR-0034):** foreign destination owners remain opaque, both acceptance gateways are
signed executable-authority roots, ambient-global access cannot bypass nondeterminism detection, and a
settled incoming credit has a distinct treatment in both corpus partitions.

**Injection 1 - foreign owner expanded.** Changed a cross-household destination instruction to an
otherwise unrelated party and attempted to resolve the owner through the full party collection.

**Injection 2 - validation gateway omitted.** Removed each of `scripts/corpus/real-derived.ts` and
`scripts/corpus/validate.ts` from the signed root set.

**Injection 3 - ambient global clock.** Added
`scripts/corpus/review-globalthis-proof.ts:1` with `globalThis.Date.now()`.

**Injection 4 - settled credit omitted.** Supplied a settled incoming credit in synthetic and
real-derived pending context while recording the generic nonreducing treatment.

**Observed failure:**
```
scripts/corpus/review-globalthis-proof.ts:1 Date.now
missing executable authority gateway root scripts/corpus/real-derived.ts
missing executable authority gateway root scripts/corpus/validate.ts
foreign destination owner appeared in records.parties
expected credit-settled-incoming-availability, observed omit-settled-incoming-availability
```

**Standing companions:** an unrelated foreign owner resolves exactly once through `referencedOwners`
and exposes only an opaque id; a local owner remains a complete party; omitting either gateway root fails;
direct, aliased, destructured, and bracket access through `globalThis` and `global` is detected; and both
partitions select the settled-credit expected-versus-observed pair from the shared pending-action
authority.

**Revert:** all temporary injections were reverted. The proof source was deleted, canonical regeneration
restored `corpusDigest` `c6fe1a9292b5b653d0ae524244d9a5f73ba8c962893da9433169125ec6db773e`,
the real-derived partition remains empty, captain signoff remains pending, and all 1,428 tests pass.

**Date:** 2026-08-05 (v3 prompt 11, D-093 review hardening).

---

## PF-208 · ambient origins and exact-once action accounting · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-122, ADR-0034):** property and element access record the same sensitive ambient origins;
replay bytes state whether reported availability includes the cited action; funding applies that action
exactly once; and captain-facing signoff prose names the semantic contract it asks the captain to attest.

**Injection 1 - bracketed ambient access.** Added `globalThis.Intl.DateTimeFormat("en-US")` and
`globalThis["process"]["env"]["SEED"]` to the in-memory generator companion while the recorder scanned
property access only.

**Injection 2 - ambiguous settled credit.** Added an inclusion field to a settled-credit payload before
the replay schema or treatment selector recognized it.

**Injection 3 - double-countable funding.** Used the same reported availability and settled credit first
as already included and then as excluded, with only the inclusion bit changed.

**Injection 4 - stale attestation scope.** Left the signoff prose on semantic contract 1.7.0 while the
manifest bound 1.8.0.

**Observed failure:**
```
expected Set{} to deeply equal Set{ 'Intl', 'process.env' }
replayPayload.liquidity.pendingAction.(redacted) - schema validation failed
selected funding aggregate does not cover request and reserve after exact-once pending-action accounting
expected signoff prose to contain verin-real-derived-semantics/1.9.0
```

**Standing companions:** direct and bracketed ambient-global paths report the same APIs; an absent
`availableMinorIncludesAction` fails schema validation; an included settled credit selects preservation;
an excluded settled credit selects one credit adjustment; the same reported amount cannot pass both
accounting states; and the signoff document must name the live semantic contract version.

**Revert:** the recorder now scans both access forms, replay schema 1.8.0 requires the inclusion state,
semantic contract 1.9.0 carries both settled-credit treatments, canonical regeneration produced
`corpusDigest` `faf3ce228307841c4038a9c28186ac61acf1d4ae272cff3637daa3afcae8b3ed`, the real-derived partition
remains empty, captain signoff remains pending, and the focused companions pass.

**Date:** 2026-08-05 (v3 prompt 11, D-122 review hardening).

---

## PF-209 · executable provenance and exact availability reconciliation · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-123, ADR-0034):** every supported executable source enters determinism analysis; sensitive
origins remain visible across local modules and fixed containers; pending-action funding reconciles the
expected effect with any directional effect already reflected in reported availability; and the signed
funding clause describes that exact accounting rule.

**Injection 1 - non-TypeScript executable source.** Added
`scripts/corpus/review-extension-proof.mjs:1` with `Math.random()`.

**Injection 2 - local-module and container laundering.** Exported `process` from one local module, read
its environment through an import in another, and placed the same origin in a direct object member.

**Injection 3 - included zero-effect action left reflected.** Replaced the shared reconciliation with
the old zero adjustment for every included action.

**Injection 4 - stale funding authority.** Restored the reducing-only funding clause in the hand-owned
semantic contract while the executable schema required exact-once reconciliation.

**Observed failure:**
```
scripts/corpus/review-extension-proof.mjs:1 Math.random
scripts/corpus/review-origin-consumer.ts:3 process.env
scripts/corpus/review-origin-consumer.ts:4 process.env
expected '' to contain 'exact-once pending-action accounting'
funding.sufficiency: expected selected-aggregate-covers-request-reserve-after-exact-once-pending-action-accounting
```

**Standing companions:** all eight TypeScript and JavaScript source variants enter the project; imported
values and fixed object or array members preserve sensitive origins; included unsettled inflows are
removed before sufficiency, included blocked outflows are restored, included unknown directions fail
closed, and the semantic contract literal cannot revert to reducing-only wording.

**Revert:** every injection was reverted. Canonical regeneration restored `corpusDigest`
`8d01240c5a65b36e2d80ab44d26dcc4e4b4314b6d750f833dd53923d98a33bbf`, the real-derived partition
remains empty, captain signoff remains pending, and the focused companions pass.

**Date:** 2026-08-05 (v3 prompt 11, D-123 review hardening).

---

## PF-210 · alternate origins, parameter bindings, ambient APIs, and settled debits · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-124, ADR-0034):** every possible dataflow origin remains visible; nested parameter
patterns preserve argument provenance; runtime clocks and entropy APIs are closed; and settled outgoing
debits remain reflected exactly once in effective availability.

**Injection 1 - alternate origin hidden.** Selected `Math` before `process` in conditional, logical, and
callable-return alternatives, then read `runtime.env.SEED`.

**Injection 2 - destructured parameter.** Passed `process` through object, nested-object, and array
parameter patterns before reading its environment.

**Injection 3 - unregistered ambient APIs.** Called `process.uptime()`, `crypto.generatePrime()`, and
`crypto.generatePrimeSync()` through direct and imported forms.

**Injection 4 - settled debit reversed.** Reconciled a settled outgoing debit once with the source
balance already reflecting it and once with the source balance excluding it.

**Observed failure:**
```
expected [] to have a length of 3 but got 0
expected Set{} to deeply equal Set{ 'process.uptime', 'generatePrime', 'generatePrimeSync' }
expected 500n to be 0n
```

**Standing companions:** conditional, logical, declaration, container, and callable-return paths merge
all possible origins; cross-module callable parameters recursively bind fixed object and array members;
direct and imported process clocks and crypto prime generation are detected; settled outgoing actions
select direction-specific included or excluded treatments and reconcile to zero or one debit.

**Revert:** every injection was replaced by a standing in-memory companion. Canonical regeneration
produced `corpusDigest` `77388ead4e7cfd738954dc7b9915b32ecdcca7b013208ac20664505c643182c9`,
the real-derived partition remains empty, captain signoff remains pending, and all 1,436 tests pass.

**Date:** 2026-08-05 (v3 prompt 11, D-124 review hardening).

---

## PF-211 · executable closure, callable origins, host state, and restriction lifecycle · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-125, ADR-0034):** determinism analysis covers every local executable dependency and
callable provenance path, process and operating-system host state cannot enter corpus bytes, and
restriction lifecycle context is recomputed from signed effectivity facts at the evaluation instant.

**Injection 1 - dependency outside the scan root.** Imported `process` through a sibling helper outside
the synthetic corpus source root and read its environment from the corpus entry point.

**Injection 2 - callable shape loss.** Returned `process` through a class method, a getter, and an omitted
parameter whose default was `process`, then read `env.SEED` through each result.

**Injection 3 - host-state registry gaps.** Read `process.platform`, `process.argv`,
`node:os.hostname()`, and `node:os.release()`.

**Injection 4 - asserted restriction state.** Claimed an expired restriction while its supplied interval
was in force at `evaluation.asOf`.

**Observed failure:**
```
expected [ SourceFile ] to have a length of 2 but got 1
expected [] to have a length of 3 but got 0
expected Set{} to deeply equal Set{ 'process.platform', 'process.argv', 'os.hostname', 'os.release' }
expected schema validation output to contain 'restriction lifecycle state'
```

**Standing companions:** a sibling executable helper enters the project and preserves its origin;
methods, getters, and default parameters each expose `process.env`; process properties and OS calls are
reported by semantic origin; and a restriction whose enum disagrees with its signed effectivity interval
fails with the lifecycle-specific refusal.

**Revert:** each injection became a standing adversarial companion. Canonical regeneration produced
`corpusDigest` `befa00adb2f5081ba8854e4393a79373a05105078c37f2c872c0b594a271629c`,
the real-derived partition remains empty, captain signoff remains pending, and the focused companions
pass.

**Date:** 2026-08-05 (v3 prompt 11, D-125 review hardening).

---

## PF-212 · defaults, module origins, provenance separation, and synthetic schedule order · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`, `src/__tests__/fitness/corpus-timestamps.test.ts`

**Invariant (D-126, ADR-0034):** every reachable host-state origin is rejected regardless of default
evaluation, callable alias, module syntax, or computed member spelling; product and tooling code never
combine provenance-partition measurements; and synthetic effectivity and withdrawal schedules are
ordered evidence.

**Injection 1 - default evaluation and callable aliases.** Passed explicit `undefined` to a parameter
defaulted to `process`, omitted nested destructured members defaulted to `process`, and invoked a method
returning `process` through a variable alias.

**Injection 2 - module and member spelling.** Loaded operating-system and process built-ins through
import-equals and CommonJS `require`, read `process.env` and `Math.random` through constant property-key
aliases, and indexed `process` through a runtime key.

**Injection 3 - provenance blending.** Added `scripts/corpus/review-blend-proof.ts` with a synthetic plus
real-derived metric whose name did not contain `overallRate`.

**Injection 4 - impossible synthetic evidence.** Set a restriction and an authorized signer to end
before they began, then supplied descending, duplicate, and month-13 planned-withdrawal segments.

**Observed failure:**
```
expected [] to have a length of 3 but got 0
expected [] to have a length of 1 but got 0
expected Set{} to deeply equal Set{ 'os.hostname', 'process.env', 'os.release' }
expected Set{} to deeply equal Set{ 'process.env', 'Math.random', 'process.[computed]' }
scripts/corpus/review-blend-proof.ts:7: combines the synthetic and real-derived partitions into one figure
expected true to be false
```

**Standing companions:** explicit and nested defaults, callable method aliases, import-equals, ambient
CommonJS loaders, local same-named loader controls, constant and dynamic computed members, arithmetic,
reducers, helper calls, concatenation, report-boundary shadows, imported and destructured partition
aliases, rendered templates, inverted effectivity intervals, and invalid or unordered withdrawal months
all exercise the production detectors.

**Revert:** every injection was removed or replaced by a standing in-memory companion. Canonical
regeneration produced `corpusDigest` `67dadb0ecd3eed8c7b9ae0e52fc5c78fd1aa0eca4836b187f0d84e56b20a5f3f`,
the real-derived partition remains empty, captain signoff remains pending, and the tooling bucket measures
8035 lines under its unchanged 8100-line ceiling. All 1,459 unit, integration, and fitness tests pass.

**Date:** 2026-08-05 (v3 prompt 11, D-126 review hardening).

---

## PF-213 · mutable member keys, assignment taint, and replay-state coherence · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-127, ADR-0034):** mutable computed keys cannot hide a sensitive runtime origin,
partition provenance survives assignment and exact member storage across modules, and contradictory
replay states fail at the signed schema boundary before semantic attribution.

**Injection 1 - mutable computed key.** Initialized a `let` key to `"fixed"`, reassigned it to
`"random"`, and invoked `Math[key]()`.

**Injection 2 - assignment provenance loss.** Assigned synthetic and real-derived values into
uninitialized locals, exact object members, and exported variables consumed through imported aliases,
then combined each pair.

**Injection 3 - contradictory replay states.** Supplied two candidates for a unique identity, one
candidate for an ambiguous identity, a non-missing authority without grant or start facts, an absent
legal hold with position scope, a missing reserve with schedule facts, and a segmented reserve without
segments.

**Observed failure:**
```
expected [] to deeply equal [ 'Math.[computed]' ]
expected [] to have a length of 2 but got 0
```

The replay-state injections already returned `schema validation failed` before the analyzer fixes, proving
the four semantic review reports were not live bypasses.

**Standing companions:** mutable sensitive member access fails closed; local, member, and imported
assignment chains retain partition taint to a fixed point; an unrelated member stays untainted; and all
six contradictory replay shapes fail at schema validation.

**Revert:** the injections remain as standing companions. Canonical regeneration stayed byte-identical at
`67dadb0ecd3eed8c7b9ae0e52fc5c78fd1aa0eca4836b187f0d84e56b20a5f3f`, the real-derived partition remains
empty, captain signoff remains pending, and all 1,463 unit, integration, and fitness tests pass.

**Date:** 2026-08-05 (v3 prompt 11, D-127 review hardening).

---

## PF-214 · structured provenance, host inputs, replayable time zones, and canonical trees · `src/__tests__/fitness/corpus-provenance-split.test.ts`, `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-timestamps.test.ts`

**Invariant (D-128, ADR-0034):** structured writes retain partition provenance; ambient host I/O cannot
enter corpus generation or validation outside declared repository-input owners; real-derived time-zone
state derives from signed rule facts; intake roots are real directories; and neutral collection order
cannot alter case bytes.

**Injection 1 - structured provenance loss.** Destructured synthetic and real-derived measurements from
one array, then wrote both partitions into one object through separate `Object.assign` calls before
combining the stored values.

**Injection 2 - ambient host I/O.** Read `/etc/hostname`, executed the host `hostname` command, and fetched
a network resource from an in-memory corpus dependency.

**Injection 3 - asserted time-zone state.** Labeled an ordinary real-derived event as a transition
boundary without zone rules or a reproducible local rendering.

**Injection 4 - filesystem and ordering ambiguity.** Replaced the real-derived intake root with a
symlink, reversed the valid world transition table, and reordered two distinct beneficiary rows that
shared the old partial sort key.

**Observed failure:**
```
expected [] to have a length of 2 but got 0
expected Set{} to deeply equal Set{ 'fs.readFileSync', 'child_process.execFileSync', 'fetch' }
expected '' to contain 'temporal transition state must match replayable time-zone rules'
expected '' to contain 'real-derived intake root must be a regular directory'
expected true to be false
expected [ sixteen changed synthetic paths ] to deeply equal []
```

**Standing companions:** object and array patterns plus mutation helpers retain taint; filesystem,
subprocess, built-in network, and fetch inputs are rejected outside named owners; an unlisted read inside
a corpus module is still rejected; arbitrary boundary claims and wrong local renderings fail; symlinked
intake roots fail before traversal; transition input is chronological; and beneficiary ordering is total
across account, party, tier, and share.

**Revert:** every injection remains as a standing in-memory or temporary-directory companion. Canonical
regeneration produced `corpusDigest` `3cd3c36730bd27adfad0c6b4b94ea065e49b5bf8b06166a4a6b7cd512174e94b`,
the real-derived partition remains empty, captain signoff remains pending, and the focused corpus gates
plus all 1,468 tests pass.

**Date:** 2026-08-05 (v3 prompt 11, D-128 review hardening).

---

## PF-215 · runtime, repository-root, registry, mutation, and request-topology closure · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`

**Invariant (D-129, ADR-0034):** dynamic code and logical compound flow cannot introduce ambient state;
declared repository input owners remain rooted inside the exact repository; container mutation retains
partition provenance; real-derived zones belong to their recorded IANA registry; and request source
accounts belong to the request household.

**Injection 1 - runtime and root escape.** Aliased `eval` and `globalThis.Function`, assigned `process`
through `??=`, called `loadSpec` with an absolute external root directly and through a wrapper, traversed
above the trusted root, and shadowed `join` with a helper that returned an external root.

**Injection 2 - mutation provenance loss.** Inserted synthetic and real-derived defect counts into one
array through separate `push` calls, then reduced the container to one blended figure.

**Injection 3 - asserted registry and foreign topology.** Supplied a self-consistent transition table
under `Mars/Olympus` and `iana-tzdb/9999z`, then moved an unselected request source account to another
household while selecting a different local account.

**Observed failure:**
```
expected Set{} to deeply equal Set{ 'eval', 'Function' }
expected false to be true
expected false to be true
expected 0 to be greater than 0
expected '' to contain 'time zone must belong to its recorded tzdb registry'
expected '' to contain 'request source account must belong to the request household'
```

**Standing companions:** dynamic constructors and their aliases are rejected; compound origins survive
assignment; external literals, forwarded roots, traversal, and shadowed path helpers fail root analysis;
standard container insertions taint their target; an unknown recorded zone/version pair fails before
transition derivation; and a foreign request source fails even when every selected funding account is local.

**Revert:** every injection remains as a standing AST or replay companion. Canonical validation
regenerated byte-identically at `corpusDigest`
`3403293fc63b3026616d9d00572f48ab3d8f00e3d5901b3be108f4730b38874a`, the real-derived partition
remains empty, captain signoff remains pending, and all 1,472 unit, integration, and fitness tests pass.

**Date:** 2026-08-05 (v3 prompt 11, D-129 review hardening).

---

## PF-216 · repository input and synthetic evidence closure · `src/__tests__/fitness/corpus-determinism.test.ts`, `src/__tests__/fitness/corpus-provenance-split.test.ts`, `src/__tests__/fitness/corpus-timestamps.test.ts`

**Invariant (D-130, ADR-0034):** repository roots remain immutable, repository file targets remain
canonical and contained, authority state has one cited owner, and destination verification chronology is
replayable from emitted facts.

**Injection 1 - mutable and canonical root escape.** Initialized a mutable loader root from `REPO_ROOT`,
reassigned it to an external directory, and placed a signoff symlink inside the worktree whose target was
outside the repository.

**Injection 2 - ambiguous authority.** Added a second cited signer with an ineffective scope to a clean
authority control while preserving the original effective signer.

**Injection 3 - impossible verification.** Moved destination verification before the current bank change,
then after both source observation and evaluation.

**Observed failure:**
```
expected false to be true
expected [Function] to throw an error
expected '' to contain 'authority semantics require exactly one cited signer'
expected '' to contain 'destination verification chronology is invalid'
expected true to be false
```

**Standing companions:** mutable loader aliases fail static root analysis; repository readers reject
symlink targets outside the canonical root; multiple cited signers fail semantic validation; emitted
verification after observation or evaluation fails; and the world schema rejects verification before the
current change or after source observation.

**Revert:** every injection remains as an AST, temporary-directory, emitted-case, or schema companion.
Canonical regeneration produced `corpusDigest`
`5e945ae5da8f460f637980d2471d298480a14d84040b671b3bfbf187804e9b01`, the real-derived partition
remains empty, captain signoff remains pending, and all 1,477 unit, integration, and fitness tests pass.

**Date:** 2026-08-05 (v3 prompt 11, D-130 review hardening).
