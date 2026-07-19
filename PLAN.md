# PLAN.md — Verin Foundation (read-back gate)

> First deliverable required by `CHARTER.md` ("BEFORE ANY CODE — THE READ-BACK GATE"). No product code
> is written until the captain approves this plan. Sections map 1:1 to the charter's five required parts:
> (a) mission restated, (b) ordered plan, (c) five hardest things, (d) ambiguities/contradictions,
> (e) pre-mortem with every top risk mapped to a live fence or an explicitly-deferred ADR item + trigger.
> An appendix records the reference-study intake and my recommendations on the open decisions.

I have read `CHARTER.md`, both governing reports in full (`min-iris-gap-s4/report.md`,
`min-iris-retro-r7/report.md`), and studied the four read-only reference bodies (Meridian design system,
Meridian data-model + demo engines, Iris architecture + fences, Iris governance + ADRs) with `file:line`
citations captured in the appendix. Nothing below is derived from memory of those repos alone.

---

## (a) Mission, restated in my own words

Verin is the **third and final** build of an RIA (registered investment adviser) practice-intelligence
platform, built to the bar of a **$1B business**: SOC 2 Type II-ready (controls *operating and evidenced
over time*, not bolted on), SEC-examiner-ready, enterprise-security-review-ready, and scalable without a
rewrite. Two prior incarnations are read-only references. **Meridian** (`min-demo`) *feels alive* —
populated, choreographed, explains itself — but rots underneath (fake data shown as real, false-pass
compliance where a 410-day-old "PASSED" task still counts as reviewed, leaky boundaries, a single-custodian
facade, a client-side shadow world). **Iris** fixed the rot (four-layer dependency rule, `Result<T,E>`,
audited writes, PII boundary, 31 ADRs, 41 fitness fences) but *lost the feel* (empty states, no demo tier)
and **quietly regressed** (dropped all E2E, tautological fences, an env-read that walked past an
import-only check, a merge that reverted verified fixes with CI still green, a hardcoded `"system"` actor).

My job is the **foundation only** — one walking skeleton, no product features beyond it — that keeps
Iris's discipline, buys back Meridian's feel **as real seeded data behind a real store** (never a
client-side shadow world), and closes both builds' documented failure modes with **machine-enforced fences
shipped in the same PR that states each invariant**. The single governing lesson from both reports:
*an invariant that isn't fitness-fenced will drift or silently revert, and detection is not verification.*
So every non-negotiable ships as a build-failing rule **proven adversarially**, every PASS-emitting check
gets a companion proving incomplete work cannot pass, and the whole foundation must be **falsifiable from
its artifacts alone** — a fresh-context session (Part 2, not me) must reproduce every proof without asking
me. Where scale or compliance work is deferred, it is deferred **explicitly** — named in an ADR with the
measurable trigger that un-defers it — never silently.

The system of record is **decided** (do not reopen): Verin ships its own **house CRM** as the real system
of record for the PoC — the canonical schema *is* its schema, seeded with the populated world, durable and
editable live in a demo — behind a **CRM port** so Salesforce can later join as a *second adapter*
(mapping maintained from day one, but zero SF adapter code now). The charter itself is code: committed
verbatim as `CHARTER.md`, amended only by ADR, its enforcement self-checked by a **charter-drift fence**
(`charter-map.json` links every non-negotiable ID → its fence/gate/procedure; CI fails if a mapping points
at a fence that no longer exists or is disabled).

---

## (b) Ordered plan

Sequenced to honor "fence every invariant in the same PR that states it" and to deliver the charter's
A–G **in order**. Everything below is **post-approval**; today I commit only `CHARTER.md` + `PLAN.md` and
stop. Reversible choices proceed and are logged in `DECISIONS.md`; irreversible/architectural ones (marked
[STOP] in §d) wait for the captain.

**Phase 0 — Scaffold & CI spine (the fences' home).** Four-layer `src/{contracts,domain,infrastructure,app}`
(porting Iris's layout); Next.js + React 19 + TypeScript strict; **pinned lockfile**; Vitest; **Playwright**
(the gap Iris regressed on — a CI gate from the first UI commit); ESLint with `no-restricted-imports`
mirroring the dependency rule; TS path aliases. The CI workflow with **every** gate present as a real job
from commit #1 — fences, unit, E2E on a **non-UTC** runner (`TZ=America/New_York`, per retro don't-again
#39), axe, provenance/config trace, gitleaks (secret scan — a CI gate, not just a regex fitness test),
semgrep (SAST), dependency+license audit, **knip/ts-prune dead-export**, audit-chain verify, load smoke —
each may start with a trivial passing target but the job exists and is non-advisory. `charter-map.json` +
the **charter-drift fence**. `AGENTS.md` whose first line directs every future session to read `CHARTER.md`
first (+ the `## Maintaining this file` self-governance section). `DECISIONS.md` opened. **CC8.1 change
control as code:** protected-main config intent, PR template ("fence proven?"), CODEOWNERS — the governance
files Iris never committed.

**Phase A — ADR set (Deliverable A).** One ADR per architectural decision, using Iris's proven shape
(Context → Decision → Alternatives Rejected table → Trade-offs [Gained/Sacrificed] → Consequences →
**Revisit When** regret-trigger). **Port** the good ADRs (dependency rule, workflow engine, `Result<T,E>`,
Zod config fail-at-boot, PII boundary, sacrificial adapters, outbox audit, idempotency, SLO/error-budget,
retention/DR). **Author the ADRs the prior builds never had:** canonical schema + provenance; house-CRM-as-
system-of-record + CRM port + SF-as-second-adapter object-graph mapping; **tamper-evident hash-chained
audit** (on top of DB append-only triggers + outbox); **identity/auth** (real auth, RBAC at the port,
SSO/OIDC-ready, behind an identity port); **FlowStep suspend/await-external-input/resume** (Iris's admitted
largest gap — an ADR *before* any flow is authored); **presentation tier + its own separate, ADR-bump-only
budget** (fixing the "shrink-only budget punished richness" trap); **STRIDE threat model**; **SOC 2
control-matrix** skeleton; **scale-ladder** (what breaks at 10×/100× + the measurable trigger per item).
Each ADR that closes a prior-build failure cites the report finding it closes.

**Phase B — Fitness-fence suite + adversarial proof log (Deliverable B).** Build-failing tests, upgraded
from Iris's regex/brace scanners to **AST-based (ts-morph)** where feasible for robustness. Cover: the
dependency rule (static **and** relative **and** dynamic `import()` — the three seams Iris closed only
after a leak); no `process.env` outside `infrastructure/config` (scan file **contents**, not imports); no
CRM-native types above the port; **every CRM write through the audited-write helper** (port Iris's strongest
idea — the single-emit-path helper + the *anti-fork* fence that lets audits be called only inside the
helper, making "audit both success and failure paths" true by construction); per-file **and** per-layer
line ceilings that **ratchet down only**; no bare throws in the CRM path; **`org_id` on every query**; no
client-controlled role header; no secret fallback / no live org domain; **no unlabeled synthetic data**.
Every PASS-emitting check gets a **detection-is-not-verification companion** proving not-started/incomplete
work cannot pass (the direct fix for the 410-day "PASSED"-task false-pass class). Prove every fence
adversarially — inject a violation, capture the failure with `file:line`, revert — and commit the proof log
(`docs/fences/proof-log.md`) so the falsifier can re-run each proof.

**Phase C — Canonical schema + provenance dictionary + fence (Deliverable C).** Model **only** the entities
the skeleton + declared day-one flows need (no speculative fields): **Org, User, Session, Household, Contact,
FinancialAccount, AccountOpeningApplication, Task, AuditEntry**. Every field: type, nullability, unit,
**provenance** (source system, `asOf`, confidence, survivorship rule). Derived values (e.g. a household
health score — computed in Meridian from a weighted 4-pillar breakdown) render with the formula and an
`asOf`, never as a bare number. Golden-record conflict policy that anticipates a future second source
(so connecting Salesforce/CSV never corrupts the record — the smell the three divergent Shakespeare schemas
exposed). SF object-graph mapping (read vs write ownership per **modeled** field) as maintained
documentation. Provenance-required fence fails the build on any field lacking a provenance annotation.

**Phase D — Design-system port (Deliverable D).** Port tokens (OKLCH slate, the 5 darkened `slate-*`
readability overrides), Geist fonts, the **"Verin." wordmark** (`text-5xl font-bold tracking-tight`, from
Meridian's `BrandReveal`), the 15 CSS keyframes incl. the reduced-motion kill-switch, and the
`app/presentation/` home. Port **only** the micro-components the two skeleton screens actually render —
projected first-use set: **WhyBubble** (doctrine: every automated decision explains itself + cites a
regulation) + `action-consequence`, **StepInfoCard**, **ProgressSteps**, **FormControls**, **RightPane**
(evidence trail), **FreshValue** + `freshness.ts`, **StatusBadge**, **EmptyState**, **ConfirmAction**.
Everything else worth porting → `PORT-LEDGER.md` (source `file:line`, what, why, when). WCAG 2.2 AA + axe on
every shared shell primitive (findings multiply across every future flow). `DO-NOT-PORT.md` names the
diseases with `file:line`: the shadow world (`data-mode-context.tsx:36`), dead `getAIAdapter`
(`ai/factory.ts:16-41`), `setTimeout` fake extraction (`useMeetingState.ts:203`), the `page.tsx` route
monolith, `hasTask()`-style existence checks (`home-stats.ts:219-225`).

**Phase E — Walking skeleton (Deliverable E).** **ACCOUNT OPENING** through the generic engine + generic
renderer (the 15-step spine: client-type → … → complete), behind **real authentication** (login → session →
RBAC-checked port call), exercising **suspend/resume** via a *simulated* e-sign webhook (fire-and-return,
webhook-driven finalize — no real DocuSign, rule 5 forbids unshipped code), one **audited + idempotent**
house-CRM write against the **seeded store** (replay the webhook → assert exactly-once effect via an
idempotency key), emitting real OpenTelemetry traces/metrics end-to-end, with **one happy-path and one
failure/interruption Playwright spec** (green on main, non-UTC) and a passing axe check. Plus the
**house-CRM console**: one plain, RBAC-gated CRUD screen over the skeleton's entities — every edit through
the audited-write helper, making the console the first live demo of the tamper-evident audit trail.
Non-functionals land here: health + readiness endpoints; p95 step-latency + LCP targets measured.

**Phase F — CI wiring for every gate (Deliverable F).** Promote every Phase-0 job from stub to real:
fences, unit, E2E, axe, config/provenance trace, secret scan, SAST, dependency/license audit, dead-export,
**audit-chain verify** (a scheduled job that re-verifies the hash-chain and produces dated evidence),
**load smoke** against a deterministic pilot-scale seed; **SBOM generated on release**. All failing gates,
none advisory. One **actually-executed backup-restore drill**, documented, with RPO/RTO.

**Phase G — Self-audit before handoff (Deliverable G).** Seat and run the three personas the prior builds
lacked or under-used — a **white-box code-reading auditor** (Iris had a Vale-like seat), an **accessibility
engineer** (the true gap: Iris had none, only a fitness test), and a **security red-team** (Iris had a
Sully-like seat; maintains the STRIDE model, attacks sessions/authz/audit-chain/webhooks) — under the
**fresh-context rule** (a session that authored code never reviews it inline), the **evidence rule** (no
claim without a current `file:line`), and a **board-memory** persona whose dimension scores cannot move
more than ±1 without a named finding. Findings → the report, each fixed or explicitly deferred with a
reason + trigger.

**Acceptance artifact — `FOUNDATION.md` (Part 1).** What exists; every fence with its proof; the self-audit
findings; the control-matrix gap list; the `DECISIONS.md` journal; the open decisions. Written so the
independent falsifier (Part 2) reproduces every claim — each fence proof, the webhook replay, the authz-
bypass and audit-chain-edit attempts, and a ~2-minute proof-of-life walkthrough — from the repo alone.

---

## (c) The five things I predict will be hardest

1. **Making fences un-evadable — closing the exact seams both builds leaked through.** Iris's dependency
   check was import-only and a domain `process.env` read walked straight past it; fences shipped
   tautological (`missing.length <= flows.length`, always true) and substring-evadable. Getting the
   dependency rule to cover static + relative + dynamic `import()`, scanning file *contents* for env reads,
   and giving every PASS a companion that fails on incomplete work — and **proving each adversarially**
   rather than trusting it — is the single highest-stakes, most-repeated risk in both reports. A weak fence
   is worse than none: it manufactures false confidence a Type II auditor will find hollow.

2. **A tamper-evident, hash-chained audit trail that is right on day one — because it is unfixable later.**
   Correct actor attribution everywhere (Iris hardcoded `"system"` at ~30 sites; "after 90 days that
   becomes unfixable"), `org_id` never null, no write bypassing the helper, escape-at-render-not-storage
   (Iris double-escaped `Smith & Co` into stored `&amp;amp;`), and a hash-chain a scheduled CI job
   re-verifies — plus a companion proving a broken chain is *detected*. This is the spine of every SOC 2
   CC7.4 / SEC 17a-4 argument and the falsifier will attack it directly (an audit-chain edit attempt).

3. **Real auth + port-layer RBAC that is SSO/OIDC-ready, built *before* the captain's build-vs-buy
   decision.** The charter demands real authentication in the skeleton (no transitional bootstrap, no
   password constants, no secret fallbacks) yet lists the auth approach as *the captain's open decision*.
   Resolving that tension means building real credential+session auth now **behind an identity port** so a
   later WorkOS/Auth0 swap is an adapter change, not a rewrite — while surviving an authz-bypass attempt in
   the falsification session and never trusting a client-supplied identity anywhere.

4. **Suspend / await-external-input / resume in the core FlowStep contract, proven with an idempotent
   exactly-once external write.** This is Iris's self-admitted *largest architectural gap* ("FlowStep is
   execute-to-completion … recommend an ADR before more flows accrete assumptions that steps never pause").
   Iris's engine runs all steps to completion in one request; there is no continuation persistence. Getting
   the contract right *before* any flow is authored, and proving replay-safety (fire the webhook twice →
   exactly-once effect) under timeout-replay, is genuinely hard and expensive to retrofit if wrong.

5. **Falsifiability from artifacts alone — applying "detection is not verification" to my own
   deliverables.** The foundation only counts if a fresh context can re-run every fence's adversarial
   proof, replay the webhook twice and confirm exactly-once, attempt an authz bypass and an audit-chain
   edit, and record a ~2-minute proof-of-life walkthrough — all *without asking me*. Deterministic seeds, a
   non-UTC-green E2E suite, committed proof logs, and a scripted walkthrough must all exist and actually
   work. If the falsifier cannot reproduce a proof, that is my defect, not theirs.

*(Runner-up, folded into the control matrix: the separation-of-duties answer for a founder-led, agent-built,
agent-reviewed codebase — protected main, no direct push, no self-approval, independent fresh-context review
as the compensating control.)*

---

## (d) Ambiguities & contradictions I see in the charter

Each with my reading and how I proceed. **[STOP]** = architectural/irreversible or explicitly the captain's;
I raise it as a `needs-decision` (surfaced in this PLAN's appendix). **[LOG]** = reversible; I proceed and
record in `DECISIONS.md`.

1. **Auth is required "now" but is also an open captain's decision. [STOP]** Rule 12 mandates real auth in
   the skeleton; the closing open decisions make the auth approach (build vs WorkOS/Auth0) the captain's,
   and the decision protocol lists "auth approach" as STOP-and-ask. **Resolution/recommendation:** build
   real self-hosted credential+session auth now *behind an identity port* — satisfies "real auth now" and
   keeps build-vs-buy a reversible adapter swap. Recommendation in the appendix.

2. **The store / production-database choice. [STOP]** The house CRM needs "genuine persistence" now, but
   the production DB is an explicit open decision and "store choice" is STOP-and-ask. The charter fixes the
   *architecture* (store hides behind the port, stays swappable) but not the pick. **Recommendation:**
   PostgreSQL (real `org_id` RLS, mature triggers for append-only audit, PITR for RPO/RTO), behind the port.
   Reasoning in the appendix.

3. **"Hash-chained audit" (rule 13) vs Iris's praised "DB triggers + outbox" (report do-again #34). [LOG]**
   Not a true conflict: do **both** — DB-level append-only enforcement (UPDATE/DELETE forbidden) *and* a
   hash-chain for tamper-evidence that survives even a DB-level bypass, re-verified by a scheduled CI job.
   Reconciliation logged; no stop.

4. **"Load test at 1,000 households × 2,000 accounts as a CI regression gate" (rule 11) vs "load smoke"
   (deliverable F). [LOG]** Ambiguity in both the *number* ("1,000 × 2,000" — 2,000 accounts total or per
   household) and the *cadence* (a full pilot-scale load test is too slow per-PR; "smoke" implies fast).
   **Plan:** seed a deterministic pilot-scale dataset (I read it as 1,000 households and ~2,000 accounts
   total for the gate, ≈2/household), assert p95 step-latency as a scheduled/nightly regression gate, and
   run a fast subset as the PR "load smoke." Exact multiplier + cadence logged; scale-ladder ADR documents
   10×/100×.

5. **"No unlabeled synthetic data" (rule 3) vs the report's advice to port the 719-line fixture (gap-s4
   §5). [LOG]** Reconciled by the charter's own SoR strategy: port the *data* as **real seed rows in the
   house-CRM store** carrying `source=verin-crm` provenance + visible source/asOf labels — never the
   *client-side shadow-world pattern* the DO-NOT-PORT list forbids (`data-mode-context.tsx:36`). Fixture
   becomes seed, not parallel fake state. No stop.

6. **"Nothing built-but-not-shipped" + dead-export check (rule 5) vs "port on first use" (rule 10). [LOG]**
   Consistent but demands discipline: port a micro-component only when a rendered screen uses it (never a
   dead export); everything else lives in `PORT-LEDGER.md` (a doc, not code). The dead-export check exempts
   `contracts/` per the charter. Noted as an execution constraint.

7. **"Model only what the skeleton needs / no speculative fields" (rule 2) vs the SF object-graph mapping
   (rule 2 & SoR strategy). [LOG]** The SF mapping is *documentation* of read/write ownership for the
   fields we actually model, not speculative schema. I map only modeled fields; the mapping grows
   flow-by-flow. No stop.

8. **"E2E green on main, non-UTC machine" (rule 8) on GitHub Actions (UTC by default). [LOG]** A concrete
   requirement, not a contradiction: CI runners pinned to `TZ=America/New_York` (honoring retro don't-again
   #39 — a UTC-only-green suite trains everyone to ignore failures). Logged.

9. **"CI trace: displayed metric → source" (rule 3) — mechanically enforcing this is under-specified. [LOG]**
   Design: every value rendered by a "metric"-class component must carry a provenance prop (source/asOf)
   enforced by the type system + a fitness test failing on a metric render lacking provenance; the CI
   provenance-trace job asserts the displayed→source mapping. If it cannot be made non-tautological, I
   escalate rather than ship a weak fence.

10. **SOC 2 separation-of-duties for a solo founder + agent-built + agent-reviewed codebase. [LOG, possible
    STOP]** The charter *requires* this answer (protected main, no direct push, no self-approval, every
    change through independent gate review). **Plan:** the compensating control is protected-main +
    no-mistakes independent gate + the persona fresh-context rule + the Part-2 independent falsification
    session as evidence; documented in the control matrix with any residual as an explicit gap (owner +
    date). If the captain wants a *human* reviewer as the control, that is a `needs-decision` — flagged in
    `FOUNDATION.md`'s open decisions.

11. **Charter-vs-reports conflict scan** (charter: "where this prompt and those reports conflict, stop and
    ask me"). I found **no hard conflict** requiring a stop: the audit-trail (item 3), synthetic-data (item
    5), and generic-engine-vs-bespoke-density tensions all reconcile under the charter's explicit
    resolutions (house CRM as real store; presentation tier with its own budget; generic engine is the
    bet). I log the reconciliations and proceed. If deeper work surfaces a true conflict, it becomes a
    `needs-decision`.

12. **The four open decisions (hosting, production DB, auth approach, brand name).** Per the charter these
    are the captain's, answered at review. Production DB (item 2) and auth (item 1) also block Deliverable
    E, so I surface all four with recommendations in the appendix; hosting and brand do not block the
    skeleton.

---

## (e) Pre-mortem — "It is 2027. Verin failed its SOC 2 Type II audit and lost its third customer."

Each risk names the failure, the report precedent, and the **live fence or explicitly-deferred ADR trigger**
that must prevent it. Gaps the pre-mortem found with no existing fence are added to Phase B (noted).

**PM-1 — A fence was green but hollow.** A dependency/provenance/tenant fence passed CI for a year but was
tautological or import-only, so a boundary leak, a domain `process.env` read, or a cross-tenant path
shipped undetected; the Type II auditor tested the control and found it never operated. *Precedent:* retro
don't-again #38 (tautologies), #23/#35 (import-only evasion). *Fence:* every fence proven adversarially
with a committed proof log (rule 1) + a detection-is-not-verification companion per PASS (rule 4) + the
**charter-drift fence** failing the build if any mapped fence is disabled.

**PM-2 — The audit trail could not be proven un-edited.** An examiner asked "prove this record wasn't
altered" and we couldn't — actor was hardcoded `"system"` somewhere, or a write bypassed the helper, or the
chain-verify job never ran. *Precedent:* don't-again #8, #41; AUDIT.md H-1. *Fence:* audited-write-required
fence + anti-fork fence (rules 1, 13) + org_id/actor/before/after asserted + hash-chain + **scheduled CI
chain-verify** + companion proving a tampered chain is detected (rule 4).

**PM-3 — A cross-tenant data leak.** A query missing `org_id`, or a client-controlled role header trusted,
commingled two firms' records → confidentiality control failed, customer churned. *Precedent:* don't-again
#19; prompt #10. *Fence:* org_id-on-every-query fence + no-client-controlled-role-header fence +
tenant-isolation test that is **not** substring-evadable (rule 7).

**PM-4 — Synthetic data fed a real decision.** An estimated/defaulted value rendered without a label, or fed
a compliance verdict; a customer saw a wrong AUM and lost confidence in everything. *Precedent:* the #1
trust-destroyer (don't-again #1, #3); prompt #5. *Fence:* no-unlabeled-synthetic-data fence +
provenance-required-on-every-field fence (rule 2) + CI displayed-metric→source trace (rule 3).

**PM-5 — Separation of duties failed.** A change reached protected main without independent review (a
self-approval), or an author-session reviewed its own code, or main wasn't actually protected. *Precedent:*
the "5 hardest SOC 2 questions" solo-founder problem. *Control:* protected main + no direct push + no
self-approval + no-mistakes independent gate + persona fresh-context rule + Part-2 falsification session as
evidence. **Residual = explicit gap with owner+date if unclosable.**

**PM-6 — Evidence-over-time was missing.** Type II is about controls *operating over time with evidence*; we
had controls but no durable evidence trail — the chain-verify or alerting history didn't exist. *Fence/ADR:*
observability from commit #1 (rule 14: OTel traces/metrics/logs, alerting-as-code, health/readiness) +
scheduled chain-verify producing dated evidence + the control matrix naming an **automated evidence source**
per criterion (Code/Test/Doc/Op columns).

**PM-7 — Availability/DR blew an SLA.** No monitoring, no verified backup — an outage exceeded the SLA and
Type II found no DR evidence. *Precedent:* Availability 1.5/5 (prompt #8). *Fence/ADR:* SLO/error-budget ADR
+ health/readiness endpoints + **one actually-executed backup-restore drill** (rule 11) + RPO/RTO defined;
scale-beyond-pilot items **explicitly deferred** in the scale-ladder ADR with measurable triggers.

**PM-8 — Supply-chain / secret exposure.** An unpinned dep vuln, a leaked secret, or a live org domain in a
committed doc failed the enterprise security review. *Precedent:* `SF_COOKIE_SECRET` fallback, `HANDOFF.md`
real org domain (prompt #10). *Fence:* pinned lockfile + gitleaks + semgrep + dependency/license audit
(rule 15) + `.env.example` placeholder-only + CI-fails-on-live-org-domain (rule 7); SBOM on release.

**PM-9 — The suspend/resume or idempotency contract was wrong.** The e-sign resume double-applied a write
under timeout-replay, or a flow assumed steps never pause and couldn't resume → a duplicated custodian
write. *Precedent:* Iris's largest gap (prompt #9); rule 16. *Fence:* FlowStep suspend/resume in the core
contract (rule 6) + idempotency-key + replay-exactly-once test (rule 16), proven in the skeleton.

**PM-10 — Built-but-not-shipped / dead abstraction rotted.** A scaffolded-but-unwired capability (an AI
layer, a second adapter) drifted and lied about coverage. *Precedent:* dead `getAIAdapter`, unwired
PII-access log (don't-again #20). *Fence:* dead-export check (knip/ts-prune) failing on unreferenced exports
outside `contracts/` (rule 5) + "reachable-from-UI-or-API in the same PR" discipline + no SF adapter code
now.

**Every top risk maps to a live fence, gate, or procedure, or to an explicitly-deferred scale-ladder ADR
item with a measurable trigger.** The two gaps the pre-mortem surfaced with no prior-build fence — the
provenance→display trace (PM-4) and the charter-drift fence (PM-1) — are added to the Phase-B suite. No top
risk is left to prose.

---

## Appendix 1 — What I commit at this gate, and where I stop

- `CHARTER.md` — the charter body, verbatim (firstmate metadata stripped; diff-verified against source).
- `PLAN.md` — this document.

Then I append `needs-decision: PLAN.md ready for captain review` to the status file and **STOP**. No code
until the captain approves. The captain's review of this PLAN is where the open decisions below are
answered; approval + those answers unblock the build in one round.

## Appendix 2 — Open decisions & my recommendations (for the captain, per charter)

The charter asks me to recommend, with reasoning, on hosting, the production database, and the auth
approach, and to surface the real brand name. Two of these (DB, auth) block Deliverable E.

| Decision | Recommendation | Reasoning | Reversibility |
|---|---|---|---|
| **Production DB / store** (blocks E) | **PostgreSQL** behind the CRM/store port | Real per-tenant **row-level security** for `org_id` isolation, mature **triggers** for append-only audit, transactional outbox, **PITR** backup/restore for RPO/RTO, scales past pilot without a rewrite. Iris used libSQL/Turso (SQLite) whose own ADR-0004 defers "real RLS" — below the $1B/SOC2 bar to start on. | Behind the port; swappable. Alt considered: libSQL/Turso (simpler, Iris-proven) — rejected for the compliance bar. |
| **Auth approach** (blocks E) | **Build** real credential+session auth now, **behind an identity port**, SSO/OIDC-ready (httpOnly+SameSite secure cookies, server-side sessions with rotation/expiry/revocation denylist, argon2id hashing, RBAC at the port) | Satisfies "real auth in the skeleton, no secret fallbacks" immediately; avoids a hard external dependency for the foundation + falsification session; keeps WorkOS/Auth0 a clean later **adapter** swap (trigger: first enterprise customer requiring SAML/SSO). | Behind the port; swappable. Alt: adopt WorkOS/Auth0 now — rejected (external dep + cost before needed). |
| **Hosting** (does not block E) | A **container/managed platform** with a stateless app tier + managed Postgres + a queue (Fly/Render/Cloud Run/ECS class) | Rule 16 needs a stateless app tier + queue-backed long-running work with backpressure; rule 11/14 need health/readiness + OTel + backup-restore. Iris's Vercel-serverless + cron drift ("half believes Heroku, half Vercel," retro #44) argues for one explicit, stateful-friendly target. | Deploy target is config; decide at gate. Vercel viable but note the statefulness/queue constraints. |
| **Real brand name** (does not block E) | Captain's to name; **"Verin."** works as a wordmark (trailing period is brand) and I will keep the code name until told otherwise | No basis for me to choose a brand. | Trivially reversible (a wordmark string + copy pass). |

If the captain prefers different picks, I adjust the plan before Phase A; nothing here is built until approval.

---

## Appendix 3 — Reference-study intake (evidence the study happened)

**Port (into `app/` — dependency-rule-safe):** OKLCH slate tokens + 5 darkened `slate-*` overrides + Geist
(`globals.css:6-54`, `layout.tsx:2-13`); the "Verin." wordmark (`BrandReveal.tsx:60-62`); 15 keyframes +
reduced-motion kill-switch (`globals.css:65-366`); WhyBubble doctrine (`CONVENTIONS.md:106-112`); the
first-use micro-components (§Phase D). Data → **seed** the house-CRM store (canonical types at
`crm/types.ts`; the `FinancialAccount` type already carries a `source` field; health is *derived* via
`computeHealth`, `demo-data.ts:42-44` — must be labeled). The 15-step account-opening spine
(`StepInfoCard.tsx:1-77`) + field list (`DEMO_CHEATSHEET.md:19-65`, `walkthrough-script.ts:42-71`).

**Port the discipline (from Iris):** four-layer scaffold + dependency rule (three seams); `Result<T,E>` +
`AppError` taxonomy; Zod config with production `superRefine` fail-at-boot; PII boundary (`assertNoPII` +
scrub at 3 crossings); the **`auditedWrite` single-emit-path + anti-fork fence** (the strongest idea);
outbox audit; per-file + per-layer line ceilings (ratchet-down); ADR shape + Revisit-When; persona
operating rules (Evidence / Neutral-prompt / Fresh-context / ±1 board-memory); SOC2 control matrix's
Code/Test/Doc/Op columns.

**Build new (neither prior build had it):** hash-chained tamper-evident audit *on top of* triggers+outbox;
**FlowStep suspend/await/resume** + webhook-driven finalize + idempotent exactly-once; **E2E as a CI gate
from flow #1** (Iris dropped it); **accessibility persona** (the absent seat); gitleaks + semgrep + knip +
audit-chain-verify + load-smoke as first-class CI gates; charter-drift fence; presentation tier with its
**own separate budget** (fixing the "shrink-only punished richness" trap); provenance→display CI trace;
STRIDE threat model + scale-ladder ADR.

**Do NOT port (the diseases, with `file:line`):** client-side shadow world (`data-mode-context.tsx:36`);
dead `getAIAdapter` (`ai/factory.ts:16-41`); `setTimeout` fake extraction (`useMeetingState.ts:203`); route
monolith (`page.tsx`); `hasTask()` existence-not-completion (`home-stats.ts:219-225`, where a 410-day-old
"PASSED" task still marks a household reviewed — the false-pass class the companion tests must kill);
the shrink-only global line budget; prose-only invariants.

**Demo-choreography engines** (Autopilot / walkthroughs / narration / ScreenRecorder) are **planned by ADR
now, ported at the first demo milestone — never scaffolded empty on day one** (rule 10); their shapes are
captured for the ADR (AutopilotScene, native-setter typing, audio await-`ended` sync, MediaRecorder).
