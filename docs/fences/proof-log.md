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
