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

**Date:** 2026-07-19 (deep-review r6 quality sweep, finding #12).
