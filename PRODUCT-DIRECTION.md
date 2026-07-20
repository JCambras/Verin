# PRODUCT-DIRECTION.md - the Verin product experience

> **What this document is.** This is Prompt 1 of the demo build: the product north star the six prompts
> after it build to. It defines *what Verin feels like to use* and *why*, so the world-seed, the flows, the
> presentation ports, and the demo instrument all bend toward one coherent product rather than a pile of
> screens. It is a **product/design doc - no code**.
>
> **Where it sits.** It is subordinate to [`CHARTER.md`](./CHARTER.md) (the constitution) and grounded in
> [`FOUNDATION.md`](./FOUNDATION.md) (what is actually built). Where this doc and the charter appear to
> conflict, the charter wins and the conflict is a defect in this doc. It is the connective tissue between
> the charter, the as-built foundation, and two external design analyses that informed it - the Verin
> post-foundation roadmap analysis and the Verin investor-demo design analysis. It describes the **target
> product**; §"Build honesty" states plainly what
> is built today, what Wave 1 lands, and what is directional - so nothing here reads as a claim that
> unbuilt work exists (charter #5).

---

## 0. Verin in one paragraph

Verin is the practice-intelligence platform an RIA runs its book on: **Iris on the surface, Verin
underneath.** It presents as a calm, comprehensive, flow-based advisor platform - the clean product shape
of Iris - but every surface is powered by Verin's compliance-grade foundation: a real house-CRM system of
record, provenance on every value, a tamper-evident audit chain, real identity and role boundaries, and a
workflow engine that suspends for human judgment. Work is organized around the **household**. The product is
**role-aware** (an advisor, an operations specialist, a principal, and a chief compliance officer each get a
different home over the same book). It is **calm and polished** - one clear decision at a time, nothing
gaudy. And it is **powered by visible RIA judgment**: every automated recommendation shows its reasoning and
cites the regulation behind it. Verin is **conversationally controlled but not a chatbot-first product** -
you can steer it by intent, but the durable, inspectable, examiner-ready artifacts are the product, not a
chat transcript. That is the whole thesis in one line:

> ## "The conversation controls the software. The conversation is not the software."

---

## 1. The seven-part identity (what Verin is, expanded)

Each phrase below is a design constraint the downstream prompts inherit, not a slogan.

### 1.1 Iris on the surface
Iris is the read-only reference for the **product surface and its architecture discipline** (see the charter's
reference list). Verin inherits Iris's shape: a professional advisor platform organized as a **coherent
catalog of workflows over a book of households**, where a workflow is a declarative flow definition rendered
by a generic engine - not a monolith of bespoke screens. That is why Verin can present breadth without
sprawl. What Verin does *not* inherit is Iris's coldness: Iris shipped clean but empty, quiet, and demo-less.
Verin keeps Iris's surface and buys back the *feel* from Meridian (§6).

### 1.2 Verin underneath
Under the familiar advisor-platform surface is the foundation the two prior builds never had:
the house CRM as a **real, durable, editable system of record** (behind the store port, PGlite in dev/CI,
managed Postgres in prod); **provenance on every field** (`source`, `asOf`, `confidence`) with the
no-unlabeled-synthetic fence behind it; a **tamper-evident, hash-chained audit trail** re-verified by CI;
**real authentication and server-side RBAC at the port**; and a **workflow engine that suspends for external
input or human approval and resumes idempotently**. The surface is calm because the substrate is rigorous.

### 1.3 Household-centered
The **household** is the unit of work and the center of the product (§3). Everything - contacts, accounts,
tasks, applications, meetings, exceptions - hangs off a household. Every flow operates *on* a household;
every brief, scan, and audit entry is *about* a household. "The book" is the set of households a role can
see.

### 1.4 Role-aware
Identity is real and roles are a server-enforced authorization boundary, never a UI toggle
(`roles.ts`: `advisor | ops | cco | principal | admin`). Each role gets a **different home over the same
book** (§4). The persona switch in a demo is a real re-authentication, which is exactly what makes it land.

### 1.5 Calm and polished
Verin is quiet by design: OKLCH slate tokens, Geist, the `Verin.` wordmark (the trailing period is brand),
generous whitespace, freshness-as-opacity, restrained motion with a reduced-motion kill-switch, WCAG 2.2 AA
on every primitive. Calm means **one clear decision at a time** and confident restraint - no dashboard
clutter, no gratuitous "AI" sparkle. Polish is a first-class product surface (charter #10), not a coat of
paint scheduled for retirement.

### 1.6 Powered by visible RIA judgment
Every automated decision **explains itself and cites a regulation** - the WhyBubble doctrine (charter #10).
Verin does not ask an advisor or a CCO to *trust* a recommendation; it shows the reasoning and the rule so
they can **audit the advice, not just accept it**. Judgment is surfaced, never manufactured: a value the
system cannot source honestly is shown as unavailable, and a compliance decision is refused outright when its
input is synthetic (charter #3).

### 1.7 Conversationally controlled, but not a chatbot-first product
Verin can be steered by intent - "prep tomorrow's Henderson meeting," "scan the book for drift" - but the
conversation is a **control plane over a real product**, not the product itself (§2, §5). It always hands you
back to a durable, structured, inspectable surface: a household, a brief, a scan, the audit chain. This is
the deliberate opposite of a chatbot-first tool, and it is the posture a regulated firm requires.

---

## 2. The core interaction principle (the spine of the product)

> **"The conversation controls the software. The conversation is not the software."**

Verin is built on three planes. Getting their relationship right is the single most important product
decision in this document.

| Plane | What it is | Rule |
|---|---|---|
| **The surface of record** | The durable, structured, navigable product: households, accounts, flows, briefs, scans, the audit chain, the console. | This *is* the product. It is fully usable with **zero conversation**. |
| **The conversation (control plane)** | A contextual assistant that interprets intent and **drives the surface** - it opens the household, starts the flow, runs the scan, jumps to the audit entry. | It **controls**, never *becomes*, the artifact. Every action it takes is a real, RBAC-checked, idempotent, audited, **human-gated** action. Every claim it renders is provenance-labeled. |
| **The judgment (reasoning plane)** | The engine's recommendations, each citing a regulation and carrying its provenance (WhyBubble). | The conversation *surfaces* judgment; it never invents it. Synthetic input yields "cannot assess," not a confident guess (charter #3). |

**Why this, and not a chatbot.** In a chatbot-first product the transcript *is* the app: state lives in
ephemeral chat, the model's confident prose is the deliverable, and there is nothing to put in front of an
examiner. Verin inverts that. The deliverables are the **examiner-ready artifacts** - a provenance-labeled
brief, a cited compliance exception, a hash-chained audit entry - and the conversation is an accelerant that
must always **resolve to one of them**. You cannot audit a chat transcript; you *can* audit Verin's chain.
That inversion is not a UX preference - it is what lets an AI-driven product clear the SOC 2 / SEC-examiner
bar the charter sets.

**This is the whitespace Iris left open.** Iris shipped a "How can I help?" box (`QueryScreen`) that *looks*
like an assistant but is only keyword routing to a screen - it neither understands intent nor drives the
engine. That is the trap on both sides: a keyword box that pretends to be conversational, or a chatbot that
swallows the product. Verin's control plane is the real thing between them: it genuinely interprets intent
and drives the *real* engine, while the durable surface stays the product.

**What the conversation is allowed to do:** navigate, launch real flows, pre-fill a form from what it read,
run a read-only analysis, and explain. **What it is never allowed to do:** commit a mutation without a human
gate, fabricate a value, assert a compliance finding from synthetic data, or trap the user in a
chat-only view with no inspectable surface underneath. The assistant is a **steering wheel, not a driver**;
the human is always the driver (charter #6, "nothing happens until you say go").

**How the principle expresses itself over time** (charter-#5 honest, no dead scaffold):
- **Today (foundation):** the software is fully usable and every action is human-driven and audited. The
  control plane exists as ordinary navigation.
- **Wave 1 (the demo):** the first form of the control plane - a command/steering surface (a `⌘K`-class
  palette, PORT-LEDGER #8; the presenter driving persona and flow launches) that maps intent to **real**
  flow invocations. Even here, every command resolves to a real, audited surface.
- **The horizon:** the full contextual Verin assistant - natural-language control across the whole catalog,
  still resolving every action to a real, human-gated, provenance-labeled surface. It ships only when it
  drives a real surface (never scaffolded empty, DO-NOT-PORT #2), never fakes work (DO-NOT-PORT #3), and
  carries the charter's audit/provenance/human-gate guarantees on every action.

---

## 3. The primary navigation model

Verin navigates on a **household-centric spine with a workflow catalog**, overlaid by the conversational
control plane. Four levels, one overlay:

```
  ┌───────────────────────────────────────────────────────────────────────┐
  │  Verin.         [ ⌘K / ask Verin ]                        [ persona ▾ ] │  ← app chrome + control plane
  ├───────────┬───────────────────────────────────────────────────────────┤
  │ WORKFLOWS │   ROLE-AWARE HOME  (the book)                              │
  │  catalog  │     → HOUSEHOLD DETAIL   (the center of work)              │
  │  (tiles)  │         → FLOW / BRIEF / SCAN   (do the work)              │
  │           │             → AUDIT CHAIN   (prove the work)               │
  └───────────┴───────────────────────────────────────────────────────────┘
```

1. **Role-aware home = the book.** Landing after login (`/app`). A populated view of the households the role
   can see, plus the **workflow catalog as tiles** (PORT-LEDGER #10) - never a "More tools" settings drawer.
   Every figure carries a `source · as of` label (FreshValue). A NotificationCenter (PORT-LEDGER #7) surfaces
   derived alerts. What the home *contains* differs by role (§4); the *shape* is constant.
2. **Household detail = the center of work.** One household, everything about it, and the flows you can run on
   it (§5). This is the screen the product truly lives on.
3. **Flow / brief / scan = doing the work.** A flow (account opening, money movement) renders through the
   generic engine with `ProgressSteps` + `StepInfoCard`; a read model (meeting brief, compliance scan)
   renders as a one-screen, provenance-labeled result. Human gates suspend the flow until "you say go."
4. **Audit chain = proving the work.** `/app/audit` - the tamper-evident, hash-chained record, inspectable in
   the UI, reachable from any outcome. Proving the work is a first-class destination, not a hidden log.
Alongside these four levels sits one parallel surface, not a fifth nesting level:

5. **House-CRM console** (`/app/console`) - the plain, RBAC-gated CRUD surface that proves records are real
   and editable live (§10). A sibling destination reachable from the chrome, not a rung on the spine.
   Deliberately unpolished; never exempt from auth, audit, or a11y.

**The control-plane overlay (`⌘K` / "ask Verin")** rides above all four levels. It is how you *jump* - "open
Delgado," "run the scan," "show me what changed" - without hunting through nav. Production chrome (nav,
history, toasts; PORT-LEDGER #9) and the CommandPalette (PORT-LEDGER #8) are the near-term seed of this
overlay; the assistant is its full expression. Navigation and conversation are the **same intent, two speeds**
- point-and-click for deliberate work, ask-Verin for velocity - and both land on the same real surfaces.

---

## 4. Role-aware home screens

Same book, same components, different **default question answered on arrival**. Roles are enforced
server-side at the port (charter #12); the home a role sees is a consequence of a real authorization
boundary, not a client flag.

| Role | The question the home answers | What it foregrounds | Seeded |
|---|---|---|---|
| **Advisor** (Alex Rivera) | *"What needs me, and who am I seeing?"* | My book of households; today's/tomorrow's meetings; what changed since last contact; the one-click **meeting-prep** on-ramp; new-account follow-ups. | **Now** (Wave 1) |
| **Operations** (ops) | *"What is in the queue, and what is waiting on me?"* | The work queue across the firm's flows; **money-movement approvals** and step-up gates; exceptions to clear; stuck/suspended flows; the console for live data fixes. | **Designed now, seeded Wave 2** (money-movement) |
| **Principal** (Priya Nair) | *"How is the firm - book, risk, and growth?"* | The **firm-wide** book (every advisor); aggregate AUM and household health, each labeled and formula-shown; risk concentration; the funnel; who needs attention. | **Now** (Wave 1, firm view) |
| **CCO** (Dana Whitfield) | *"Is anything out of compliance right now?"* | The **compliance scan** across the whole book; open exceptions with citations; overdue reviews; the examiner-export path; the audit chain. | **Now** (Wave 1, Act 3) |

Design rules for all four homes:
- **One primary question, answered above the fold.** A calm home resists the temptation to show everything;
  it answers the role's first question and offers the obvious next action (EmptyState on-ramps turn dead ends
  into next steps, PORT-LEDGER #15).
- **Every number is sourced.** No bare metric anywhere - the `metric-provenance` fence forbids it. Health
  scores and AUM totals render with their formula and `asOf`, never as an unattributed figure.
- **The role boundary is the demo beat.** Switching from advisor to CCO is a real re-auth into a genuinely
  different authority over the same records - which is *why* the persona switch is convincing in the room.
- **One role model, honestly.** Iris shipped two role models that disagreed - a 5-role RBAC contract
  (`advisor/ops/cco/principal/admin`) and a 3-value UI enum (`advisor/operations/principal`) with the CCO
  present in code but missing from the interface. Verin has **one** role model, server-enforced, with the CCO
  first-class in the UI. The homes inherit the *shape* Iris got right (an advisor greeting + morning brief,
  an operations queue-and-categories dashboard, a principal firm-overview with a roster), without the split.
- **`ops` is defined but not seeded yet.** Its home is designed here so the product is coherent; the seeded
  ops persona and its money-movement queue land with Wave 2 (charter #5: no persona seeded before it has a
  real surface). The operations home is a **single unified work queue** - the one surface Iris never
  consolidated (its queue was fragmented across a task manager, a triage screen, an activity feed, and a
  compliance list), and exactly what the operator archetype ("lives in the queue") needs.

---

## 5. The household as the center of work

Everything in Verin resolves to a household. The **household detail screen** is the product's true home, and
its design carries the whole thesis.

**What a household is (grounded in the 9 modeled entities).** A `Household` owns `Contact`s and
`FinancialAccount`s, accumulates `Task`s (used as an **event ledger** - meetings, deposits, reviews,
outstanding documents - which is how the flows derive insight without speculative schema), may carry an
`AccountOpeningApplication`, and is bound to an advisor and an org. Its whole history is expressible in those
entities, and it grows flow-by-flow under the provenance fence (charter #2).

**What the household detail screen shows:**
- **Who they are** - contacts, relationships, the household's identity, each value labeled with its source.
- **What they hold** - accounts and balances, each a `FreshValue` (`Verin CRM · as of Jul 16`), dimmed by
  age so staleness is visible at a glance.
- **What changed** - the event ledger read as a timeline, and a **"since your last meeting" summary** of what
  is different (last meeting, a recent deposit, an outstanding beneficiary form, a review coming due). Iris
  proved this diff is the single highest-value element of a meeting brief; Verin makes it a household staple.
- **What Verin thinks** - the derived signals: a meeting-prep on-ramp with the three decisions to make; a
  compliance posture with any open exception and its citation. Every signal is a recommendation with visible
  reasoning (§7), never a bare verdict.
- **What you can do here** - the flows runnable on this household (open an account, move money, prep a
  meeting, run a review), each launching the real engine. The household detail is the **hub every workflow
  launches from** - the pattern Iris landed well (its `HouseholdScreen` was explicitly "the hub all workflows
  launch from," with a prep-meeting / compliance-scan / open-account / move-money launch grid) and Verin
  keeps.

**Why household-centered matters for the product's identity:**
- It is how the product **feels alive**: a populated household with real accounts, a real timeline, and a
  real next action is the single largest driver of "this is a real book, not slides" (the gap-report's #1
  finding).
- It is how **provenance becomes tangible**: labels and freshness live on the household's own numbers, so the
  rule is visibly working, not a footnote.
- It is how the **conversation stays anchored**: "prep this meeting" or "why is this flagged" is always
  *about this household*, and always resolves back to the household's real surface.
- It is the natural home of **role-awareness**: an advisor sees their households; a principal sees every
  advisor's; a CCO scans them all - the same object, different reach.

**"The book"** is the collection of households a role can see, rendered on the home. A believable single
advisor's book (roughly six active households plus a prospect, not an inflated number) reads as real
precisely because "no unlabeled synthetic" is a brand value - a realistic book *is* the honest one.

---

## 6. Where the contextual Verin assistant appears

The assistant is **contextual and subordinate everywhere, dominant nowhere.** It is anchored, dismissible,
and always resolves to a real surface. It is never a full-screen chat that becomes the app (that would make
the conversation the software, which §2 forbids).

| Where | What the assistant does there | Resolves to |
|---|---|---|
| **App chrome (`⌘K` / "ask Verin")** | Steer the whole product by intent: jump to a household, launch a flow, run a scan, recall "what changed this week." | The real home / household / flow / scan surface. |
| **On a home** | Frame the day/queue: "what needs me before tomorrow's meetings," "what's overdue for compliance." | A filtered book or a specific household. |
| **On a household** | Prep the meeting, explain a signal, start a flow on this household, draft (never send) an outreach. | The household's real brief / flow / audit surface. |
| **Inside a flow** | Explain *this* step, pre-fill from what it read, surface the human gate - but never advance the gate itself. | The flow's real next step (the human still says go). |
| **On the audit chain** | Explain an entry in plain language: who did what, when, and why it is provably unedited. | The real, hash-verified audit entry. |

**Invariants the assistant carries wherever it appears** (this is what keeps it charter-legal and makes it a
differentiator rather than a liability):
- **It drives real flows only** - no fabricated screens, no dead abstraction (DO-NOT-PORT #2), no
  `setTimeout` theater standing in for an engine (DO-NOT-PORT #3).
- **It is human-gated** - it can *prepare* a mutation and *ask*; only a human commits it (charter #6). This
  is the "nothing happens until you say go" guarantee, spoken by the assistant instead of buried in a form.
- **Every claim is provenance-labeled** - the assistant renders `FreshValue`s and WhyBubbles, not naked
  prose; a figure it cannot source is shown unavailable.
- **It refuses to fake a compliance answer** - if an input is synthetic, it says "cannot assess" rather than
  guessing (charter #3). The refusal is a *feature* the product says out loud.
- **It is audited like any actor** - anything it does on the user's behalf lands on the hash chain with the
  human as the accountable actor.

**Build discipline (so this section is direction, not vapor).** The assistant is the product's stated
horizon; it ships incrementally under charter #5. Its near-term form is the command/steering surface of §2
and §3. Nothing about it is scaffolded before a real surface uses it. This document defines *where it lives
and what it may do* so that when it is built, it is built right.

---

## 7. How recommendations, reasoning, actions, and outcomes appear

This is the product's visual grammar. It is deliberately the same everywhere so the product reads as one
calm system. Four moments, one language:

### Recommendation - *"here is what I think you should decide"*
A restrained **card**, not an alert storm. It states the suggested decision, ranks it against the others,
and shows every supporting figure as a `FreshValue` with its `source · as of` label. A `StatusBadge`
carries the posture (clear / attention / exception / informational). Recommendations are **decision-ready,
not chatty**: Henderson's brief is "confirm the $250k deposit, sign Patricia's beneficiary form, plan the
$58,200 RMD by Aug 28," each sourced - three decisions, not a paragraph.

### Reasoning - *"here is why, and the rule behind it"*
Every recommendation carries a **WhyBubble**: a "Why did Verin do this?" affordance that opens the reasoning
*and the regulation it rests on* - "James is RMD-age; a required minimum distribution must be taken by
year-end (IRS §401(a)(9) / FINRA)." This is the **visible RIA judgment** that defines Verin (charter #10).
The point is auditability: a CCO can inspect the advice, not merely trust it. Reasoning is always one tap
from the recommendation, never a wall of text you must read first. Two supporting moves complete the grammar,
both proven in Iris and worth keeping: a **tap-to-verify source** on any fact (where it came from, which
record, how fresh, how confident) and **confidence as hierarchy, not badges** (deterministic values render at
full weight and unadorned; anything AI-synthesized is visually set apart and labeled, so a reader always
knows which is which). And Verin never silently omits: a value it cannot source honestly is shown as an
explicit **data-gap** ("missing / stale / unavailable"), because silent omission is the most dangerous
failure a compliance tool can have.

### Action - *"nothing happens until you say go"*
Actions run through the engine with **`ProgressSteps`** for orientation and **`StepInfoCard`** for contextual
teaching. Anything sensitive or irreversible **suspends at a human gate**; the confirm gate confirms the
**payload** (what will actually happen, in dollars and names), not vague metadata (PORT-LEDGER #19). Step-up
auth guards the marquee mutations (money movement) so a stolen session cannot initiate a wire. The human is
always the one who commits.

### Outcome - *"here is what happened, and the proof it is unedited"*
An outcome is an **audited, idempotent write**, surfaced as a clean state change plus a one-tap link to the
**tamper-evident audit chain** that recorded it. Reversible outcomes offer **Undo** (PORT-LEDGER #11). The
outcome is always inspectable and provenance-carried. And because the demo runs over labeled-demo data, any
compliance artifact derived from it is **watermarked "demonstration - not a compliance record"** and excluded
from the real examiner-export (charter #3 extension, ADR-0022) - the labeling runs end to end, which is
itself a trust statement.

**The visual tone underneath all four:** OKLCH slate, Geist, generous whitespace, freshness-as-opacity,
restrained motion (with the reduced-motion kill-switch), WCAG 2.2 AA. Calm, confident, one decision in focus
at a time. Never a dashboard that shouts; never an AI product that sparkles to look smart.

---

## 8. What should feel inherited from Iris (and Meridian)

Verin's surface is a deliberate synthesis: **Iris's product shape and discipline + Meridian's feel + Verin's
foundation.** The charter names Iris and Meridian as the read-only references; here is what each contributes.

**Inherited from Iris (the surface and the discipline):**
- **The advisor-platform shape** - a comprehensive practice platform organized as a **catalog of workflows
  over a book of households**, spanning the real lifecycle (onboarding, service, compliance, operations,
  planning, life events). Iris catalogs a full 40+-flow universe; Verin inherits that *ambition and
  organization* while lighting flows up wave by wave.
- **The flow-as-declarative-definition model** - a workflow is a typed definition rendered by a generic
  engine, which is what lets the product present breadth without becoming a monolith of bespoke screens (the
  counter to DO-NOT-PORT #4, the route monolith).
- **The clean four-layer architecture and reliability posture** - `Result<T,E>` over thrown errors, audited
  writes, the PII boundary - which the user *feels* as a product that does not lie, lose data, or half-fail.
- **The breadth and humanity of a full practice platform** - Iris's catalog spans the real lifecycle, from
  lead capture through onboarding, service, compliance, operations, planning, and even life events (a client
  death, a divorce) handled with an empathetic, careful tone. Verin inherits that ambition and lights it up
  wave by wave.
- **The explainability catalog and the "never silently omit" contract** - Iris matured the reasoning surface
  beyond a single bubble into a small system (tap-to-verify source, confidence-as-hierarchy, an explicit
  data-gap notice, a "what changed" diff). Verin's presentation tier grows toward that catalog. And Iris's
  regulator-legible flow metadata (each flow tagged with its rule areas and retention) is the seed of Verin's
  examiner-readiness.
- **The design discipline that quality compounds** - Iris's own design doctrine ("one shell renders every
  workflow, so every finding multiplies") is why a shared, disciplined presentation tier is worth the
  investment; it is the same logic the charter encodes for accessibility (findings multiply across every
  flow).
- **Professional, non-gimmicky restraint** - Iris's tone is serious software for serious work; Verin keeps
  that and refuses gimmicks.

**Inherited from Meridian (the feel Iris lost):**
- **WhyBubble as doctrine** - every automated decision explains itself and cites a regulation.
- **FreshValue** - freshness-as-opacity, so provenance and staleness are visible, not buried.
- **StepInfoCard / ProgressSteps** - contextual teaching and orientation inside a flow.
- **EmptyState on-ramps** - dead ends become next steps.
- **A populated world** - named households with real balances and real histories, so the product feels alive
  (bought back as *real seeded rows with provenance*, never Meridian's client-side shadow world,
  DO-NOT-PORT #1).
- **The brand** - the `Verin.` wordmark, the calm palette, the confident voice.

The one-line synthesis: **Verin should feel like Iris grown a heartbeat** - the same clean, comprehensive
advisor platform, now alive, explained, and provably real.

---

## 9. What must be materially better than Iris

Iris was clean but cold, empty, quiet, and had quietly regressed (dropped E2E, tautological fences). Verin
must be **decisively better on the axes a buyer and an examiner feel.**

| Dimension | Iris (the reference) | Verin must be |
|---|---|---|
| **Aliveness** | Empty states; no demo tier; nothing to show. | A **populated, labeled book** - real seeded households with real balances and histories, every value provenanced. Alive on real data, not faked. |
| **Visible judgment** | The discipline existed but reasoning was not a rich product surface. | **WhyBubble everywhere**, each recommendation citing its regulation - judgment is a first-class surface a CCO can audit. |
| **Provenance** | Modeled, but not a felt part of the UI. | Provenance is **visible and load-bearing**: `source · as of` on every number, freshness-as-opacity, and the **"Verin won't fake a compliance answer"** refusal as a *feature* no competitor and neither prior build shows. |
| **Compliance** | A concern in the architecture. | **Compliance as a product** - "the scan the SEC would run," exceptions with citations, an honest all-clear, over a book whose chain proves nothing was edited. |
| **Auditability** | An audit trail as a backend detail. | The **tamper-evident hash chain is a product surface** - inspectable in the UI. "The chain proves it; we don't just promise it." |
| **Control model** | A "How can I help?" box that was only keyword routing to a screen - a fake assistant. | A **real conversational control plane** that interprets intent and drives the real engine, while every artifact stays durable and auditable - the next-gen leap neither prior build had. |
| **One product, one model** | A codebase fighting itself: an engine-first thesis but ~48 bespoke screens, and two role models that disagreed. | **One rendering model** (the generic engine + renderer) and **one role model**, server-enforced - a product that is internally consistent, which the user feels as coherence. |
| **Work, queue, and recovery** | No unified inbox (fragmented across four screens); no Undo; no deep links (state-only navigation). | A **single unified work queue** for operations, **Undo** on reversible actions, and real, linkable destinations. |
| **Reliability the user feels** | Regressed on E2E; accessibility was only a fitness test. | Every flow ships **happy + interruption Playwright specs + axe** on a non-UTC clock - polish and trustworthiness you can feel (charter #8, #9). |
| **Integrity of the instance** | No separation of demo vs real. | **Clean-slate integrity** - demo and live cleanly marked (`dataClass`), purgeable in one guarded+audited operation, prod-boot-verified to contain zero demo rows. A trust property that is also a product capability. |

The through-line: **Iris proved you can be disciplined; Verin proves you can be disciplined *and* alive,
explained, and provably real.** That combination is the moat.

---

## 10. What the first investor demo must prove

The demo is a **rehearsed instrument, not a slideshow** - marquee households such as Henderson, Delgado,
Okonkwo, Vance, and Mensah, a scripted click path, and rehearsed kill-lines. Its one job: make an investor
believe Verin is **real, alive, and defensible** in about six minutes. This section states the **proof
obligations** - what each act must *establish*, mapped to the surface that carries it and the charter
guarantee it demonstrates.

| # | The demo must prove | How it is proven on stage | Charter guarantee shown | Belief installed |
|---|---|---|---|---|
| 1 | **It is real, not slides.** | Real persona login (Server Action); a Postgres-backed house CRM; a record edited live in the console; real role boundaries. | #12 identity, #13 audit, house-CRM SoR | "This is a system, not a mockup." |
| 2 | **It is alive.** | A populated book on the home; every AUM figure carries `Verin CRM · as of Jul 16`; the catalog is tiles, not a drawer; freshness dims a stale figure. | #3 provenance, #10 presentation | "Provenance is the product." |
| 3 | **You are in control (human-in-the-loop).** | Open an account: the flow **suspends** at e-sign, a webhook resumes it, the finalize is idempotent and audited. Nothing happened until "go." | #6 suspend/resume, #16 idempotency | "Verin is the assistant, not the replacement." |
| 4 | **It shows its work (visible judgment).** | Meeting-prep in one click assembles who they are, what changed, and three sourced decisions; each suggestion's WhyBubble cites a regulation. | #10 WhyBubble, #3 provenance | "One click - and it shows its work." |
| 5 | **It is examiner-ready and defensible.** | The CCO runs the compliance scan across the book: Delgado's 78%-vs-40% drift and Okonkwo's 14-month-stale KYC surface **with citations**; Vance/Mensah come back honestly all-clear; an estimate-backed item is **refused** ("Verin will not base a compliance finding on synthetic data"); the audit chain proves the records were never edited. | #3 (+ ADR-0022), #13 tamper-evidence | "Most firms find this out when compliance calls." + "Verin won't fake a compliance answer." |
| 6 | **This is a fundable company.** | The close: "Account opening, a meeting brief, and the exact scan an examiner would run - over a real book, in six minutes." | The whole $1B bar | "Examiner-ready, not slide-ready." |

**The single line the demo exists to earn:** *examiner-ready, not slide-ready.* Every wealth-tech can show
account opening and money movement. Almost none can show **exactly what an SEC examiner would find, with the
regulation cited, over a book whose audit chain proves it was never edited** - and can prove it is real,
alive, and honest about its own synthetic data. That is Verin's whole reason to exist, and it is what the
first demo must make an investor believe.

---

## Build honesty (what is real today, so nothing here overclaims)

Per charter #5, this direction doc distinguishes plainly:
- **Built today (foundation):** login + real auth; the account-opening flow (suspend/resume, idempotent
  audited write); the tamper-evident audit chain (`/app/audit`); the house-CRM console (`/app/console`); the
  presentation tier (`brand`, `why-bubble`, `fresh-value`, `metric`, `progress-steps`, `step-info-card`,
  `ui`); provenance on all 9 entities; one populated org with two seeded users.
- **Lands in Wave 1 (the demo this doc anchors):** the populated, labeled world; the CCO persona +
  persona-select login; meeting-prep and compliance-scan flows (read models); the presentation ports the
  demo renders (tiles, chrome, NotificationCenter, one tour journey, presenter tooling); the `dataClass`
  clean-slate marker.
- **Directional (built later, under the same discipline):** the full conversational assistant; the operations
  home and money-movement (Wave 2, human-gate + step-up); the examiner-export path and onboarding depth
  (Wave 3); Salesforce as a second adapter; scheduled/event-driven flows.

Nothing above is scaffolded ahead of a real surface. This document is the north star those waves aim at, not
a claim that they exist.
