# Verin demo design language

**Status:** Normative for every Verin demo surface. This is the document the v3 build sequence
means when its prompts 3 and 29 say "read `docs/demo-design-language.md` first."
**Authority chain:** subordinate to [`CHARTER.md`](../CHARTER.md) and
[`PRODUCT-DIRECTION.md`](../PRODUCT-DIRECTION.md) (especially §1.5 calm-and-polished and §7 the
four-moment grammar). Where this doc and either of those appear to conflict, they win and the
conflict is a defect here.
**Ruling constraint (captain directive, 2026-07-26):** the external v3 documents' visual direction
is rejected. The demo's look and feel is the ESTABLISHED Verin design system - Meridian's feel with
Iris's discipline, exactly as already built in this repo: OKLCH slate tokens, Geist, the `Verin.`
wordmark, calm one-clear-decision-at-a-time restraint, freshness-as-opacity, WCAG 2.2 AA, the
reduced-motion kill-switch, no gaudy AI sparkle. This document translates v3's UX **semantics**
(the Decision Spine, proceed/blocked/prohibited, the approval-invalidation moment) into that
established language. It never imports v3's visual prescriptions, and it never forks the token
system.
**External references:** citations to "v3" (the architecture and prompt sequence - v3 §10.2,
prompts 3, 11, 29) resolve to the ratified in-repo copies under [`docs/v3/`](./v3/):
[`verin-architecture-v3.md`](./v3/verin-architecture-v3.md) and
[`verin-prompt-sequence-v3.md`](./v3/verin-prompt-sequence-v3.md). Citations to the "demo
contract" (its §3, §4, §6) resolve to `docs/demo-contract.md`, landing on branch
`fm/verin-contract-j5` (currently in validation); until it merges,
[`docs/v3/verin-demo-contract-v1.md`](./v3/verin-demo-contract-v1.md) is the in-repo source it
derives from.

---

## 1. Design sources (authoritative - this doc adds guidance, never values)

The token system, type, motion, and component recipes live in code. When this document names a
treatment, the file below is the authority for its exact values; do not restate or re-derive them,
and never define a color, font, radius, or keyframe anywhere else.

| Source | Owns |
|---|---|
| [`src/app/globals.css`](../src/app/globals.css) | All tokens (OKLCH slate palette, `--surface`, `--border`, `--ring`, `--destructive`, `--success`, radii), Geist via `--font-sans` / `--font-mono`, the four keyframes (`fade-in`, `slide-down`, `check-pop`, `story-fade-in`), the darkened `slate-400/500` AA overrides, the focus-visible ring, and the reduced-motion kill-switch. Light-only by design; dark mode is deliberately not a goal. |
| [`src/app/presentation/brand.tsx`](../src/app/presentation/brand.tsx) | The `Verin.` wordmark (the trailing period is brand). |
| [`src/app/presentation/ui.tsx`](../src/app/presentation/ui.tsx) | `Field`, `TextInput`, `SelectField`, `Button` (primary / secondary / danger), `StatusBadge` (+ its `STATUS_STYLES` map), `EmptyState`. Accessible by construction; status is always text + color, never color alone. |
| [`src/app/presentation/fresh-value.tsx`](../src/app/presentation/fresh-value.tsx) | `FreshValue`: the `source · as of` label and freshness-as-opacity (floored at 0.7 for the WCAG 1.4.3 contrast floor). |
| [`src/app/presentation/metric.tsx`](../src/app/presentation/metric.tsx) | `Metric`: the only sanctioned metric-class surface; number typography (`font-semibold tabular-nums`) and the demonstration watermark chip. |
| [`src/app/presentation/progress-steps.tsx`](../src/app/presentation/progress-steps.tsx) | `ProgressSteps`: done / active / pending step states, the accessible ordered-list recipe. The Decision Spine's parent (§4). |
| [`src/app/presentation/step-info-card.tsx`](../src/app/presentation/step-info-card.tsx) | `StepInfoCard`: the "Step N of M" kicker idiom and contextual-teaching card recipe. |
| [`src/app/presentation/why-bubble.tsx`](../src/app/presentation/why-bubble.tsx) | `WhyBubble`: the explainability disclosure ("Why did Verin do this?" + regulation citation) and its slate-50 panel recipe. |
| [`src/contracts/provenance.ts`](../src/contracts/provenance.ts) | The provenance vocabulary: `SOURCE_SYSTEMS`, `provenanceLabel`, `DerivedProvenance`, `deriveArtifactProvenance`, `isDemonstration`, `canFeedComplianceDecision`, `DEMO_WATERMARK`. |
| [`src/contracts/metric.ts`](../src/contracts/metric.ts) | `DisplayMetric` / `metric()` / `formatMetricValue` / `metricWatermark`: a metric cannot exist without provenance. |
| [`src/app/app/audit/page.tsx`](../src/app/app/audit/page.tsx) | The **register idiom**: the audit-trail table (uppercase `text-xs tracking-wide` headers on `bg-surface`, `divide-y` rows, `font-mono text-xs` hashes and identifiers, focusable scroll region). The lineage for every tabular/ledger surface in the demo (§8, §9). |
| [`src/app/app/layout.tsx`](../src/app/app/layout.tsx) | Page chrome and measure: `main` at `mx-auto max-w-3xl px-6 py-8`, nav above. |
| [`docs/adr/0012-presentation-tier-and-budgets.md`](./adr/0012-presentation-tier-and-budgets.md) | Why the presentation tier exists, its budget, and the port-on-first-use rule. |
| [`docs/adr/0022-derived-compliance-artifacts-demonstration.md`](./adr/0022-derived-compliance-artifacts-demonstration.md) | The demonstration-watermark doctrine for derived artifacts. |

**Rules of this section:**

1. **No forks.** A demo surface never introduces a color, font, radius, shadow, or keyframe that is
   not already in `globals.css`. If a surface seems to need one, it does not; re-read §1.5 of
   PRODUCT-DIRECTION.md and use hierarchy instead.
2. **New primitives derive.** Where the twelve contract surfaces genuinely need a primitive the
   tier lacks, it is specified in this document as **to-be-built** with its token derivation
   (§13). This doc specifies; the build prompt that first renders the surface builds it (charter
   #5: nothing built before a real surface uses it).
3. **The consolidated type scale** (cited, not invented - each entry names its source): page title
   `text-2xl font-semibold text-slate-900` (audit page); card/section title `text-base
   font-semibold text-slate-900` (StepInfoCard); body `text-sm` in `slate-600/700/800`; microcopy
   and labels `text-xs text-slate-600`; kicker `text-xs font-medium uppercase tracking-wide
   text-slate-600` (StepInfoCard, audit table headers); numbers `font-semibold tabular-nums
   text-slate-900` (Metric); identifiers, hashes, policy versions, idempotency keys `font-mono
   text-xs` (audit page). One `h1` per page.
4. **The card recipe** is StepInfoCard's: `rounded-lg border border-slate-200 bg-surface p-4`
   (white `bg-white` when the card must sit above `bg-surface`). Page-level vertical rhythm is
   `gap-6`; intra-card rhythm `gap-2` / `gap-3` (audit page, ProgressSteps).
5. **One clear decision at a time** (PRODUCT-DIRECTION §1.5): each surface renders **exactly one
   primary `Button`**. Everything else is `secondary` or a text link. If a design draft has two
   primary actions, the surface is two surfaces.

---

## 2. Translation table - v3 vocabulary into the established language

v3's visual vocabulary appears in this document only through the deliberate translations below.
Anything from v3's demo-design prescriptions not listed here (color systems, "ledger-register"
typography, stamp/seal metaphors, orchestrated motion set-pieces) is rejected outright.

| v3 said | Verin renders it as |
|---|---|
| Decision Spine as a styled persistent top rail | `DecisionSpine`, a horizontal `ProgressSteps` derivative - calm, secondary, one line (§4) |
| Prohibited shows "the stamp" | A solid `slate-900` StatusBadge plus doctrine copy - authority, not theatrics (§5) |
| "Ledger-register" display style | The existing audit-trail register idiom (§1 table, `src/app/app/audit/page.tsx`) |
| Three orchestrated motion moments (evidence stagger, revalidation sweep, hash seal-and-void) | The established motion budget only: container fade, disclosure slide, check-pop, one fade at invalidation. No sweeps, no seals, no stagger choreography (§12) |
| Disposition color coding | `StatusBadge` lineage in the established palette (§5) |
| Approval-invalidation as "seal void" animation | A state change that lands through content and restraint, not animation (§7.3) |

---

## 3. The four-moment grammar across the twelve contract surfaces

PRODUCT-DIRECTION §7 defines the product's visual grammar - four moments, one language:
**recommendation** ("here is what I think you should decide"), **reasoning** ("here is why, and the
rule behind it"), **action** ("nothing happens until you say go"), **outcome** ("here is what
happened, and the proof it is unedited"). The demo journey (demo contract §3: intent → evidence →
decision → authority → safety → execution → verification → comparison → policy authoring) is that
same grammar stretched across a pipeline. Every one of the twelve required surfaces (demo contract
§4) is built from the four moments and the primitives already named in §1:

| # | Contract surface | Dominant moment(s) | Primitives that carry it |
|---|---|---|---|
| 1 | Household workspace | Recommendation (context) | Cards, `Metric` / `FreshValue` on every figure, `EmptyState` on-ramps, `DecisionSpine` absent (no decision in flight yet) |
| 2 | Contextual intent panel | Action (initiate) | `Field` + `TextInput`, one primary `Button`; anchored panel attached to the workspace, never a 50/50 chat layout (PRODUCT-DIRECTION §2, §6); the interpreted intent echoes back as typed slots, each a labeled value |
| 3 | Evidence and conflict view | Reasoning (facts) | `EvidenceRow` (built, §6) = `FreshValue` + observed/retrieved times; conflict and missing-item variants; `WhyBubble` on derived items |
| 4 | Recommendation and alternatives | Recommendation + Reasoning | `DispositionNotice` (built, §5), ranked alternative cards, `WhyBubble` per rejection reason, every figure a `FreshValue` |
| 5 | Policy and precedence trace | Reasoning (rules) | Register idiom rows; policy/instruction versions in `font-mono text-xs`; `WhyBubble` per precedence step |
| 6 | Approval stages and actor status | Action (human gate) | `ProgressSteps` for stages, `ApprovalStagePanel` (built, §7), `StatusBadge` per actor slot |
| 7 | Pre-execution safety check | Action → Outcome hinge | Check rows with `StatusBadge`, revalidation timestamp as a `FreshValue`-style label, reservation + conflict keys in `font-mono text-xs`; the invalidation moment (§7.3) lives here |
| 8 | Execution timeline | Outcome | `ExecutionTimeline` (built, §8) in the register idiom; honest `StatusBadge` states; idempotency made visible in plain words |
| 9 | Verification state | Outcome (honest) | "Proven / not yet proven" lists, next-poll label, NIGO and stuck rows first-class (§8) |
| 10 | Firm A / Firm B comparison | Reasoning (policy difference) | `ComparisonColumns` (built, §10), difference-as-hierarchy, `WhyBubble` per differing row |
| 11 | Policy draft and simulation impact | Recommendation + Action | Draft AST rendered as structured rows (never raw code as the primary view), LLM-drafted wording set apart (§6.5), simulation delta in the register idiom, human approval gate per §7 |
| 12 | Printable examiner-grade decision artifact | Outcome (proof) | Document-styled surface (§9), all reasoning expanded, hashes in full, ADR-0022 watermark rules |

Two standing rules across all twelve:

- **Reasoning is always one tap away, never a wall of text first** (PRODUCT-DIRECTION §7). The
  `WhyBubble` is the only reasoning disclosure; do not invent accordions, tooltips, or popovers.
- **Every displayed value carries provenance.** Metric-class values go through `Metric` (the
  `metric-provenance` fence fails the build otherwise); other sourced values through `FreshValue`.
  There are no bare numbers anywhere in the demo.

---

## 4. The Decision Spine

The persistent orientation element (v3's UX semantic, kept): on every surface of a decision
journey the viewer can see **where this request is in the pipeline** without being told. It is
calm and secondary - a quiet line, never a dashboard that shouts.

**`DecisionSpine` (built, D-036)** - a horizontal derivative of `ProgressSteps`
(`src/app/presentation/progress-steps.tsx`), sharing its state vocabulary and accessibility
recipe:

- **Stations (fixed, seven):** Intent, Evidence, Decision, Authority, Safety, Execution,
  Verification.
- **Structure:** an `<ol>` laid out `flex flex-row items-center gap-2`; between stations a
  connector `<span aria-hidden className="min-w-4 flex-1 border-t border-border" />`.
- **Station states are ProgressSteps' three, at reduced size:** dot `h-5 w-5 rounded-full text-xs
  font-semibold`; `done` = `bg-green-600 text-white` with "✓"; `active` = `bg-slate-900
  text-white` with the station number; `pending` = `bg-slate-100 text-slate-600` with the station
  number. Station label `text-xs`, `text-slate-800` for done/active, `text-slate-500` for pending.
  No other states, no other colors.
- **Placement:** directly below the app chrome and above the page `h1`, inside the `max-w-3xl`
  measure, on every surface of an in-flight decision journey (contract surfaces 2 through 9, plus
  11 while a draft decision is being simulated). Bottom-bordered with `border-b border-border
  pb-3`. It is part of the page flow - never `fixed`, never `sticky`, never elevated with a
  shadow. One line tall, always.
- **Narrow viewports (below `sm`):** collapse to the StepInfoCard kicker idiom - a single line
  `text-xs font-medium uppercase tracking-wide text-slate-600` reading "Station 3 of 7 ·
  Decision".
- **Accessibility:** the ProgressSteps recipe - `aria-current="step"` on the active station and
  `sr-only` state text per station - plus one requirement this spec adds beyond that recipe:
  `aria-label="Decision progress"` on the `<ol>`.
- **The spine shows position, never disposition.** It has no blocked/prohibited/failed rendering.
  Disposition belongs to the surface body (§5); at most, a single standard `StatusBadge` may sit
  at the spine's right end as its state slot (e.g. `Blocked - resolvable`). When a decision is
  blocked, the active station simply stays active and downstream stations stay pending. When a
  decision is prohibited, the spine never advances past Decision (prohibition short-circuits
  before authority - v3 §10.2 semantics), and downstream stations remain pending; the spine never
  invents a "dead" station style.
- **The spine is generated from the typed decision view model only.** It never computes state
  itself and never renders a station the record has not reached (detection is not verification -
  charter #4 applies to UI honesty too).

---

## 5. Disposition treatments - proceed, blocked, prohibited

The semantics are v3 §10.2, kept exactly; the rendering is StatusBadge lineage in the established
palette.

| Disposition | Meaning | Resolvable? | Approval contract? | Execution plan? |
|---|---|---:|---:|---:|
| `proceed` | permitted, subject to authority requirements | n/a | yes | yes |
| `blocked` | may proceed after named conditions are satisfied | yes | no | no |
| `prohibited` | never permitted within the stated scope | no | no | no |

### 5.1 Badges

Three entries are **added to the existing `STATUS_STYLES` map** in
`src/app/presentation/ui.tsx` (same shape, same file - built with surface #4, D-036):

- `proceed`: `bg-green-50 text-green-800 border-green-200` (the `done` family), label
  **"Proceed"**.
- `blocked`: `bg-amber-50 text-amber-900 border-amber-200` (the `suspended` family - amber is
  already this system's "waiting on a condition" color), label **"Blocked - resolvable"**.
- `prohibited`: `bg-slate-900 text-white border-slate-900` (the `Button` primary recipe worn as a
  badge - slate-900 is this system's voice of authority), label **"Prohibited"**.

**Red is reserved for failure** (`failed`, rejected executions, a broken chain). Prohibition is
not a failure or an error: it is Verin working. Styling a refusal in failure-red would say the
system malfunctioned; the solid slate badge says the system decided. This is the same doctrine as
"Verin won't fake a compliance answer" (PRODUCT-DIRECTION §9): **a refusal reads as integrity,
not as breakage.**

### 5.2 `DispositionNotice` (built, D-036)

The card that heads the recommendation view (surface #4) and any surface that must state a
disposition:

- **Proceed:** the standard card recipe (§1 rule 4), the `proceed` badge, the recommended action
  stated in one sentence with every figure a `FreshValue`, then the authority requirement summary
  ("requires 2 distinct operations approvers") in body text. Its `WhyBubble` cites the governing
  policy provision and version.
- **Blocked:** card variant `border-amber-200 bg-amber-50` (the established attention surface -
  see the audit page's error panel), the `blocked` badge, then **each blocker as a row**: the
  named condition in `text-sm text-amber-900`, followed by its **resolving affordance** - a
  `secondary` `Button` or text link whose action is derived from the blocker itself ("Request
  independent verification of the bank instruction", "Refresh liquidity evidence"). **A blocked
  surface ALWAYS presents its resolving conditions as affordances** - this is the EmptyState
  doctrine (dead ends become next steps) applied to governance. A blocked result never offers an
  approval button as a substitute for missing evidence (v3 §10.2), and never an "override" or
  "approve anyway" affordance of any kind.
- **Prohibited:** the standard calm card (`border-slate-200 bg-surface` - deliberately NOT red,
  NOT amber), the solid `prohibited` badge, then three things and nothing else:
  1. **What is prohibited**, in one plain sentence naming the scope.
  2. **The prohibition source**: firm policy, household instruction, or regulatory, with its
     versioned reference in `font-mono text-xs` and its `source · as of` label.
  3. **The reasoning**: a `WhyBubble` carrying the explanation and, where regulatory, the
     citation.
  **Zero resolving affordances.** No buttons that change the outcome, no escalation path, no
  contact-an-admin CTA. The only interactive elements permitted are inspective: view the policy
  trace, view the audit entry, print the record. No error iconography, no apology copy. The card
  may close with the doctrine register, e.g. "Verin will not route this for approval: the
  restriction is not resolvable by evidence or authority." A prohibited decision that is easy to
  read, cited, and visibly final is the demo's integrity statement - the same voice as refusing
  to base a compliance finding on synthetic data.

The **blocked vs prohibited distinction must be legible in one glance without reading body copy**:
amber-with-affordances versus solid-slate-with-none. A viewer who has seen both once should never
confuse them again.

---

## 6. Evidence surfaces

Surface #3 (evidence and conflict view) and every place evidence appears inline. The doctrine:
**FreshValue everywhere**; the demo's evidence minute (demo contract §3, 0:45-1:30) is carried
entirely by provenance rendering the product already has.

### 6.1 `EvidenceRow` (built, D-036)

A composition (not a fork) for one evidence item:

- The value through `FreshValue` - which yields the `source · as of` label from
  `provenanceLabel()` and freshness-as-opacity from `opacityForAge()` (floor 0.7). `asOf` is the
  **observed** time - when the fact was true at its source - and it is what freshness keys off.
- The **retrieved** time as a trailing `text-xs text-slate-500` suffix: "retrieved Jul 26,
  09:14". Observed versus retrieved is the contract's requirement; observed governs opacity,
  retrieved is metadata. The retrieved timestamp comes from the evidence view model backed by
  `EvidenceSnapshotRef` (`observedAt` / `retrievedAt` in the v3 contracts), landing with the
  evidence-snapshot build work - it is not a `RecordProvenance` field.
- Metric-class values inside evidence go through `Metric` (never `FreshValue` alone) so the
  provenance fence and watermark rules apply.

### 6.2 Conflicts

When two sources disagree (demo contract §3: "missing or conflicting information"):

- Render **both** values, each a full `EvidenceRow` with its own source, observed, and retrieved
  labels. Never silently pick a winner.
- A `StatusBadge` in the `suspended` (amber) family labeled **"Conflict"** heads the pair.
- Name the survivorship rule in play (`SURVIVORSHIP_RULES` in `src/contracts/provenance.ts`) in
  body text: "Resolution rule: most recent observation wins" - or, when the rule is `manual`,
  the conflict is blocked-class and carries its resolving affordance ("Choose the governing
  value") per §5.2.

### 6.3 Missing items

Silent omission is the most dangerous failure a compliance tool can have (PRODUCT-DIRECTION §7).
A value Verin cannot source renders as an explicit data-gap row: the EmptyState idiom at row
scale - `rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600` -
reading "Missing - planned-withdrawal schedule unavailable from Verin CRM". When the gap blocks
the decision, it also appears as a blocker with its affordance in the `DispositionNotice`.

### 6.4 No unexplained AI-confidence scores

Per the demo contract's evidence requirements: **no numeric "AI confidence" appears anywhere in
the demo.** No percentages on interpretations, no score chips on recommendations, no gauges. The
`Confidence` field in `RecordProvenance` is a closed vocabulary (`high | medium | low`) used by
survivorship logic; it may appear inside the `TapToVerify` provenance detail (§6.6) as a word, never as
a headline number, and never styled as a claim of model certainty.

### 6.5 Confidence as hierarchy (deterministic vs LLM-drafted)

The established doctrine (PRODUCT-DIRECTION §7): confidence is expressed by **typographic
hierarchy, not badges**.

- **Deterministic values render at full weight and unadorned**: `font-semibold tabular-nums
  text-slate-900` through `Metric`. Deterministic engine output is the product's voice.
- **Anything LLM-drafted is visually set apart and labeled.** LLM-drafted wording (the interpreted
  intent echo, a drafted policy sentence, proposed explanation prose) renders inside the WhyBubble
  panel recipe - `rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700` -
  with a `text-xs text-slate-600` label reading **"Drafted - not yet reviewed"** (or "Drafted -
  approved by {actor}" once a human has). It never renders inline at full weight as if it were
  deterministic output.
- **A number is never LLM-drafted.** Every figure on screen comes from the deterministic engine or
  a sourced record; the LLM proposes wording and structure only (v3 non-negotiable 1, kept as a
  design rule: AI proposes, deterministic code disposes - and the typography makes the boundary
  visible).

### 6.6 `TapToVerify` (built, D-036)

The tap-to-verify-source affordance of PRODUCT-DIRECTION §7 - the provenance of one fact (where
it came from, which record, how fresh, how confident), one tap from the value - and the
disclosure that §6.4, §8.1, §8.3, §11.3, and §12.2 rely on as the `TapToVerify` detail.
The interaction derives from the WhyBubble disclosure recipe in `why-bubble.tsx`: an underlined
`text-sm text-slate-600` text trigger reading **"Verify source"**, wired with
`aria-expanded`/`aria-controls`, opening an `animate-slide-down` panel in the `rounded-md border
border-slate-200 bg-slate-50 p-3` recipe. The panel contains provenance metadata only - source
system and record identifiers (`font-mono text-xs`), observed and retrieved times, the §6.4
confidence word, and, under the §11.3 collapse mode, the fake-class taxonomy label. It stays
distinct from `WhyBubble` (reasoning plus the regulation citation): PRODUCT-DIRECTION §7 keeps
provenance-of-a-fact and reasoning-for-a-decision as separate doctrines, and the two disclosures
never merge.

---

## 7. Authority and approval surfaces

Surface #6. Calm rendering of real governance: stages, quorum, eligibility, requester exclusion,
expiry, escalation - all of it stated plainly, none of it shouting.

### 7.1 Stages

Approval stages render through the existing `ProgressSteps` (vertical): one step per stage,
`done` when satisfied, `active` for the current stage, `pending` beyond it. Sequential versus
parallel stage groups are stated in the stage title text ("Stage 2 - either order"), not with
novel diagram graphics.

### 7.2 `ApprovalStagePanel` (built, D-036)

One card per stage (standard card recipe), containing:

- **The requirement, in plain words** as the card body: "2 approvals required from distinct
  operations approvers. The requester cannot approve." Quorum, distinct-actor, and
  requester-exclusion rules are sentences in `text-sm text-slate-600` (the `Field` hint idiom),
  never icon grammar.
- **Actor slots as rows**: actor name/role, then a `StatusBadge` - `pending` ("Awaiting
  approval"), `done` ("Approved · Jul 26, 10:02"), or the amber family for expiry-adjacent
  states. The requester's own row states "You requested this - you cannot approve" in
  `text-xs text-slate-600`, and **their approve button is absent, not disabled** - eligibility is
  server-enforced (charter #12), and the UI reflects reality instead of teasing a dead control.
- **Expiry** as a quiet trailing label: "expires Aug 12" in `text-xs text-slate-600`; when
  expiry has passed, the stage's badge moves to the amber family ("Expired - escalated") and the
  escalation path is stated in body text ("Escalates to: principal"). Escalation is information,
  not an alarm.
- **The binding**: "Approval binds to decision `a3f9c2…`" with the decision hash and input-bundle
  hash in `font-mono text-xs text-slate-500` (the audit-register hash treatment). This one line
  is what makes §7.3 land later.
- **The gate confirms the payload, not metadata** (PRODUCT-DIRECTION §7, action moment): the
  approve control sits under a restatement of what will actually happen, in dollars and names -
  "Approve moving $75,000 from the Smith taxable account to Chase ····4417" - with each figure a
  `FreshValue`. The approve button is the surface's one primary `Button`.

### 7.3 The approval-invalidation moment

The demo's most memorable beat (v3 prompt 29 semantic, kept): an approval already given is
visibly voided because a material fact changed. **It must land without narration AND without
theatrics.** The room watches an approved thing become void because the evidence moved - the
state change itself is the memorable part, and any added drama would compete with it.

The specification, in full:

1. **The voided approval stays.** The ledger is append-only and the UI honors that: the approval
   row is never removed or replaced. Its badge changes to the amber family:
   **"Approval voided - evidence changed"**, and the row's content recedes to `opacity: 0.7` -
   freshness-as-opacity applied to a superseded state (the same visual grammar as stale data,
   which is exactly what a voided approval is). No strikethrough, no red, no shake.
2. **What changed appears at full weight** directly beneath: a block stating the delta in one
   sentence - "The bank instruction changed after this approval was given" - followed by the
   changed evidence as before/after `EvidenceRow`s (old value at receded opacity per its now-stale
   `asOf`, new value at full weight, each with observed and retrieved times).
3. **Why, on tap:** a `WhyBubble` citing the binding rule - approval binds to the decision hash
   and input bundle hash; the bundle changed, so the approval cannot stand.
4. **One clear next action:** a single primary `Button` - "Re-evaluate with current evidence" -
   which starts a new decision. Nothing else on the surface competes with it.
5. **Motion:** exactly one `animate-fade-in` (the standard 0.4s entry fade from `globals.css`) on
   the newly appearing "what changed" block. Nothing else animates. Under
   `prefers-reduced-motion` the global kill-switch zeroes it and the moment is a pure state
   change - which must read just as clearly, because the content, not the motion, carries it.
6. **Announcement:** the "what changed" block carries `role="status"` (`aria-live="polite"`) so
   the state change is announced to assistive tech - the audit page's verdict precedent.

Test of success: a viewer who missed the presenter's sentence still understands, from the surface
alone, that the approval no longer stands and why.

---

## 8. Execution timeline and verification

Surfaces #7, #8, #9. The doctrine is **honest status**: the UI never claims a stronger state than
the underlying source proves. Submitted is not settled. Signed is not submitted. Green is earned.

### 8.1 `ExecutionTimeline` (built, D-036)

The register idiom (audit-trail table lineage, §1): uppercase `text-xs tracking-wide` headers on
`bg-surface`, `divide-y` rows, one row per execution step - step name, target, `StatusBadge`,
timestamp, and identifiers (`font-mono text-xs`: idempotency key, conflict key, reservation id)
in a `TapToVerify` detail (§6.6) rather than cluttering the row.

### 8.2 Status vocabulary

Added to `STATUS_STYLES` (built with surface #8, D-036), mapped onto the existing families -
**blue = in progress, green = proven done, amber = waiting/unconfirmed, red = failed, slate =
neutral**:

| Status | Family (existing recipe) | Label | Rule |
|---|---|---|---|
| `submitted` | blue (`running`) | "Submitted" | NEVER green, never "complete". Wherever it headlines, an adjacent `text-xs text-slate-600` line states what remains unproven: "Accepted for processing - settlement not yet confirmed." |
| `in-flight` | blue (`running`) | "In flight" | Same honesty line pattern. |
| `settled` / `completed` | green (`done`) | "Settled · verified" | Green ONLY when the status source proves completion. The label names the proof, e.g. "verified against custodian status Jul 27". |
| `rejected` | red (`failed`) | "Rejected" | With the returned reason in plain language. |
| `nigo` | red (`failed`) | "Returned NIGO" | First-class, never buried: the row states the deficiency in plain words ("returned - the beneficiary form is not in good order: signature missing") and carries its resolving affordance (NIGO is blocked-class: fixable). |
| `unknown` | amber (`suspended`) | "Unconfirmed" | With elapsed time: "no status for 2 days". |
| `stuck` (prolonged unknown) | amber (`suspended`) | "Stuck" | First-class row, states the stuck-state rule that fired and the escalation affordance (blocked-class: has affordances). |
| `duplicate-suppressed` | slate (`pending`) | "Duplicate suppressed" | See §8.3. |

Every status above is its own `STATUS_STYLES` key, never a label override on an existing one -
honest-status doctrine forbids merging semantic identities that operators and fences must
distinguish. `rejected` (an outcome returned by the external system) is not `failed` (an internal
step that errored); `stuck` (verification cannot progress and needs attention) is not `suspended`
(a healthy wait at a human gate). Each key only borrows the visual recipe of the family named in
its row.

### 8.3 Idempotency, visible without jargon

The demo must show that a retry or double-click cannot cause a second movement, in words a
non-engineer trusts:

- The suppressed row's body copy: **"Already submitted once - Verin did not send it again."**
  That sentence is the product claim; "idempotency" never appears in primary copy.
- The mechanism stays inspectable for the technical viewer: the idempotency key in `font-mono
  text-xs` inside the row's `TapToVerify` detail (§6.6), matching byte-for-byte across the original and
  suppressed rows - the visible proof they are the same instruction.
- A duplicate-suppressed row is styled neutrally (slate), not as success and not as failure: it
  is a non-event, and calm styling says so.

### 8.4 Verification state (surface #9)

Two plain lists under the register, no gauges, no percent-complete:

- **"What this status proves"** and **"What it does not prove yet"** - `text-sm` items, each
  provable claim sourced ("submission accepted - Salesforce response, retrieved Jul 26 14:02" as
  a FreshValue-labeled line).
- The **next expectation** as a quiet label: "Next status poll: Jul 27, 06:00" in `text-xs
  text-slate-600`.
- Delayed NIGO arrivals and stuck-state transitions append rows to the same register - the
  timeline is append-only in presentation just as the ledger is in storage; a status never
  edits history, it adds to it.

---

## 9. The printable examiner-grade decision artifact

Surface #12. A document, not a screen: it must read as something that goes in a compliance
binder, with the same seriousness as the audit-chain surface it descends from.

- **It is a real route** rendering a document-styled page in the established system: Geist
  (`--font-sans`) for headings and body, Geist Mono (`--font-mono`) for every identifier and
  hash, black-on-white (the slate-900-on-white system prints correctly as-is), generous margins
  inside a print-appropriate measure. No serif is introduced - token discipline holds even on
  paper.
- **Structure:** a document header carrying the `Verin.` wordmark (from `brand.tsx`), the title
  "Decision record", the decision id, and created-at; then numbered sections in journey order -
  intent, evidence (every item with source, observed, and retrieved times), decision and
  disposition, precedence trace, authority and approvals (including any voided approval, which
  prints with its "voided" state - the paper record is as append-only as the ledger), safety
  revalidation, execution, verification state at time of export.
- **All reasoning prints expanded.** The WhyBubble is a screen affordance; on paper every
  explanation and citation renders in full as body text under its section. Nothing the screen
  can disclose is absent from the document.
- **Immutable identifiers in full:** decision hash, input-bundle hash, policy and instruction
  version refs, audit-chain position - `font-mono`, printed complete, never truncated (the
  screen's `hash…` truncation idiom does not apply here; this is the artifact whose hashes an
  examiner checks).
- **Print CSS posture:** an `@media print` stylesheet that hides app chrome, the DecisionSpine,
  and every interactive control; expands all disclosures; keeps rows unbroken across pages
  (`break-inside: avoid` on rows and cards); and puts the decision id + page number in a running
  footer. The screen preview of the artifact must itself pass axe (§11) - print posture never
  excuses the on-screen surface.
- **Watermark rules (ADR-0022, normative):** if the artifact's provenance is a demonstration
  (`isDemonstration(deriveArtifactProvenance(inputs, asOf))` - i.e. any input anywhere in its
  derivation was synthetic), then:
  1. On screen, the artifact header carries the existing watermark chip exactly as `Metric`
     renders it (`metric.tsx` recipe, `DEMO_WATERMARK` text: "Demonstration - not a compliance
     record").
  2. In print, the `DEMO_WATERMARK` string renders in the running header AND footer of **every
     page**, so no single cropped page can pass as a real record.
  3. The provenance appendix lists the flattened `derivedFrom` sources, so the trace to leaf
     sources survives on paper.
  4. There is no suppression path: a demonstration artifact cannot print clean, and it is
     excluded from the real examiner-export (charter #3 extension). Conversely, an artifact with
     no synthetic input prints with no watermark - a clean print is earned, never granted.

---

## 10. Firm A / Firm B comparison

Surface #10. The claim on stage: same household, same request, different approved policy,
materially different outcome, zero code change. The design's job is to make the **difference**
legible and its **cause** (policy-version provenance) inspectable.

**`ComparisonColumns` (built, D-036):**

- **Layout:** `grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2`; stacks on narrow viewports.
  Each column headed by the firm name (`text-base font-semibold text-slate-900`) and its **active
  policy version** in `font-mono text-xs` with a `FreshValue`-style "active since" label - the
  version provenance is the header, because it is the entire explanation of the columns.
- **Row model:** aligned rows per compared dimension (cash-reserve requirement, approval
  threshold, quorum, disposition, outcome), so the eye reads across.
- **Difference as hierarchy, not highlighter** (the confidence-as-hierarchy doctrine applied to
  diffing): rows where the firms agree render receded - `text-sm text-slate-500`, regular
  weight. Rows where they differ render at full weight - `text-sm text-slate-900` - with a
  `border-l-2 border-slate-900 pl-3` marker on each differing cell. No fills, no yellow, no
  green/red judgment colors: neither firm is "right", they are differently governed, and the
  palette must not editorialize.
- **Cause on tap:** every differing row carries a `WhyBubble` citing, for each side, the policy
  provision and version that produced its value ("Firm B reserve: 12 months of planned
  withdrawals - policy FB-2.1 §3"). The difference is **driven by policy-version provenance**,
  never by text-diffing rendered output.
- Dispositions inside the comparison use the standard §5 badges; figures use `Metric` /
  `FreshValue` as everywhere. Established tokens only - the comparison introduces a layout, not
  a look.

---

## 11. Provenance labeling of fakes (demo contract §6)

During the build, surfaces run on fakes before real paths land. The labeling doctrine of charter
#3 applies to fakes exactly as it applies to synthetic data: **nothing unlabeled, ever** - and
the label's removal is earned by building the real thing.

### 11.1 The internal taxonomy

Every visible data element or status carries one of the contract's seven labels internally,
mapped onto the repo's vocabulary:

| Contract label | Repo vocabulary | Notes |
|---|---|---|
| Synthetic fixture | `source: "fixture"` (`SOURCE_SYSTEMS`) | Already renders as "Sample data · as of …" via `provenanceLabel` |
| Real-derived fixture (anonymized history) | `fixture` + corpus provenance metadata | The corpus intake (v3 prompt 11) extends the vocabulary; until then the interim string is the `DevProvenanceBadge` text for this row, in the badge's established lowercase style (§11.2): "sample data - anonymized history" - the `FreshValue` `provenanceLabel` output ("Sample data · as of …") is unchanged |
| Fake adapter response | dev-only view-model class (not a `SourceSystem`) | Exists only while the real adapter is pending; carried by the typed view model |
| Real Salesforce sandbox response | `source: "salesforce"` | |
| User-entered demo input | `source: "user-input"` + demo `dataClass` | |
| Deterministic engine output | `source: "computed"` (`DerivedProvenance`) | Full-weight rendering per §6.5 |
| LLM-proposed draft or wording | new class, to be added with the first LLM surface | Set-apart treatment per §6.5; never a number |

Extending the machine vocabulary (`SOURCE_SYSTEMS`, the view-model classes) is build work owned
by the prompt that lands each path; this section fixes the labels and their renderings so no
build prompt invents its own.

### 11.2 `DevProvenanceBadge` (built, D-036)

The visible development-only badge on every fake-backed element:

- **Recipe:** `inline-flex items-center rounded border border-dashed border-slate-400 px-1.5
  py-0.5 text-xs text-slate-600`. The dashed border is the established "not yet real" idiom
  (EmptyState's `border-dashed`); the chip shape follows the watermark chip in `metric.tsx`.
- **Text:** the taxonomy label, lowercase and plain - "fake adapter", "synthetic fixture",
  "LLM draft".
- Placed adjacent to the value or panel it labels, in normal flow - visible, not decorative,
  never overlapping content.

### 11.3 The removal rule

- A `DevProvenanceBadge` is removed **only in the PR that lands the corresponding real path** -
  the badge's presence in the codebase is the honest inventory of what is still fake, and its
  removal diff is the proof the real path arrived. Removing a badge any other way is a charter
  #3 violation in spirit and fails review.
- **Badges render inline by default, in every environment.** For final-presentation surfaces, a
  **badge-collapse mode (to-be-built)** may let a remaining fake-class badge collapse into the
  value's `TapToVerify` provenance detail (§6.6) instead of rendering inline, honoring demo contract
  §6 - provided the `FreshValue` source label (e.g. "Sample data · as of …") remains visible as
  always. That mode is an explicitly designed deliverable of the build work that lands it, and
  its trigger mechanism is decided in that work - it is never a silent default. `FreshValue`
  labels and ADR-0022 demonstration watermarks are **never** suppressible anywhere, in any
  environment.
- There is no "hide provenance" mode. The uncluttered final demo is achieved by landing real
  paths, not by hiding labels - and the presenter must never state simulated behavior as real
  (demo contract §6).

---

## 12. Accessibility and motion

Non-negotiable (charter #9): **WCAG 2.2 AA on every new surface**, axe wired into CI, from the
first primitive. The demo is not exempt because it is a demo; the demo is the surface where the
standard is most on display.

### 12.1 Accessibility rules for every demo surface

- **Text + color, never color alone**: every state renders words (`StatusBadge` labels, the
  `sr-only` state text in ProgressSteps/DecisionSpine). The §5 dispositions and §8 statuses are
  distinguishable with color removed entirely.
- **Contrast floors are already encoded - respect them**: the 0.7 opacity floor
  (`fresh-value.tsx`) and the darkened slate-400/500 utilities (`globals.css`). New surfaces
  putting slate text on non-white backgrounds (`amber-50`, `slate-50`, `bg-surface`) must verify
  4.5:1; the pairings used in this doc (`amber-900` on `amber-50`, `slate-700` on `slate-50`,
  white on `slate-900`) are the established passing ones.
- **Focus**: the global `:focus-visible` ring (`globals.css`) covers every interactive element;
  scrollable regions get `tabIndex={0}` + `aria-label` (audit-page precedent).
- **Structure**: one `h1` per page; tables with `caption` + `scope`; the DecisionSpine's `<ol>`
  + `aria-current="step"`; errors with `role="alert"` attached via `aria-describedby` (`Field`);
  state changes that matter (§7.3 invalidation, chain verdicts) announced with
  `role="status"` / `role="alert"`.
- **Forms**: only through `Field` - label association, hints, and error wiring are its recipe.
- **Targets**: no icon-only controls on demo surfaces; `Button` padding meets target-size
  minimums as shipped.
- **Print**: the examiner artifact's screen rendering passes axe like any page (§9).

### 12.2 The motion budget - the complete inventory

Restrained motion is a token-level commitment (PRODUCT-DIRECTION §1.5). These four are the
**only** motion moments in the entire demo; each uses an existing `globals.css` utility:

1. **Surface entry:** `animate-fade-in` (0.4s) on a surface's main container when it first
   appears - container-level only, once per navigation. v3's "evidence stagger" is rejected:
   **no per-row stagger choreography**; an evidence list fades in as one calm unit.
2. **Disclosure:** `animate-slide-down` (0.25s) on WhyBubble panels and `TapToVerify` details
   (§6.6) - as already shipped in `why-bubble.tsx`.
3. **Step completion:** `animate-check-pop` on a ProgressSteps or DecisionSpine dot at the moment
   a station transitions to done.
4. **The invalidation moment:** exactly one `animate-fade-in` on the "what changed" block
   (§7.3.5). v3's "hash seal and void" and "revalidation sweep" set-pieces are rejected; the
   revalidation surface is static content with, at most, a check-pop on a completed check.

Nothing else moves. No loops, no sweeps, no parallax, no attention-seeking pulses; loading states
are text ("Loading…", the audit-page idiom), not spinners.

**Reduced motion:** every animation MUST be expressed through the `animate-*` utilities (or a
CSS transition), so the global `prefers-reduced-motion` kill-switch in `globals.css` zeroes all
of it with no per-component work. No inline JS-driven animation, no animation library. Every
moment above must read correctly as a pure state change with motion removed - that is the test a
motion moment must pass to exist at all.

---

## 13. To-be-built primitive register

The complete inventory of what the twelve surfaces need beyond the pre-skeleton tier. Each
derives from named existing recipes; none introduces a token. Each row is built in the prompt that
first renders its surface (charter #5), in `src/app/presentation/`, within the presentation-tier
budget (ADR-0012). The walking skeleton (D-036) built every row below except the
`DevProvenanceBadge` collapse mode, which stays to-be-built until a final-presentation surface
first needs it (§11.3).

| Primitive | Derives from | First used by | Spec |
|---|---|---|---|
| `DecisionSpine` | `ProgressSteps` states + a11y recipe; StepInfoCard kicker (collapsed form) | Surfaces 2-9, 11 | §4 |
| `StatusBadge` map additions (`proceed`, `blocked`, `prohibited`, `submitted`, `in-flight`, `settled`, `rejected`, `nigo`, `unknown`, `stuck`, `duplicate-suppressed`) | Existing `STATUS_STYLES` families in `ui.tsx` | Surfaces 4, 6-9 | §5.1, §8.2 |
| `DispositionNotice` | Card recipe; audit-page amber panel; `Button` primary recipe as badge | Surface 4 | §5.2 |
| `EvidenceRow` (+ conflict, missing variants) | `FreshValue`, `Metric`, EmptyState dashed idiom | Surface 3 | §6.1-6.3 |
| `TapToVerify` | `WhyBubble` disclosure recipe (`why-bubble.tsx`): text trigger + `animate-slide-down` `bg-slate-50` panel; distinct from `WhyBubble` per PRODUCT-DIRECTION §7 | Surfaces 3, 7-9 (and the §11.3 collapse mode) | §6.6 |
| `ApprovalStagePanel` | Card recipe, `ProgressSteps`, `StatusBadge`, `Field` hint idiom | Surface 6 | §7.2 |
| `ExecutionTimeline` | Audit-page register idiom | Surfaces 7-9 | §8.1 |
| `ComparisonColumns` | Grid layout; type scale; `WhyBubble` | Surface 10 | §10 |
| `DevProvenanceBadge` | Watermark chip recipe (`metric.tsx`) + EmptyState dashed border | All fake-backed surfaces during build | §11.2 |
| `DevProvenanceBadge` collapse mode | `DevProvenanceBadge` + the `TapToVerify` provenance detail | Final-presentation surfaces (demo contract §6) | §11.3 |
| Print stylesheet for the decision artifact | `globals.css` tokens; audit-register idiom; `brand.tsx` | Surface 12 | §9 |

---

## 14. Acceptance checklist (for the walking-skeleton build and the prompt-29 audit)

A build or audit pass against this document verifies, at minimum:

- [ ] No color, font, radius, shadow, or keyframe exists outside `globals.css`; every treatment
      traces to a §1 source file or a §13 spec.
- [ ] Every displayed value carries provenance (`Metric` / `FreshValue`); zero bare numbers; the
      `metric-provenance` fence is green.
- [ ] The DecisionSpine appears on every in-flight journey surface, one line, in-flow, position
      only - and never renders a station the record has not reached.
- [ ] Blocked and prohibited are distinguishable at a glance with body copy unread; every blocker
      carries a resolving affordance; a prohibited surface contains zero resolving affordances
      and cites its versioned source.
- [ ] No numeric AI-confidence appears anywhere; LLM-drafted wording is set apart and labeled; no
      figure is LLM-drafted.
- [ ] A voided approval remains visible, recedes to 0.7 opacity, and the "what changed" block
      reads without narration and without motion (reduced-motion check).
- [ ] `submitted` never renders green or "complete"; NIGO and stuck states are first-class rows
      with affordances; the duplicate-suppressed row says "Verin did not send it again" with
      matching keys inspectable.
- [ ] The printed artifact expands all reasoning, prints full hashes, and - when
      demonstration-derived - watermarks every page (ADR-0022); the screen rendering passes axe.
- [ ] Firm A/B differences are hierarchy-marked, cause-cited by policy version, and free of
      judgment colors.
- [ ] Every fake-backed element carries its taxonomy label; badges render inline by default and
      collapse only through the explicitly built §11.3 mode; badge removals appear only in the PR
      landing the real path; `FreshValue` labels and watermarks are never suppressed.
- [ ] axe passes on every new surface; every animation dies under `prefers-reduced-motion` and
      the surface still reads correctly.

A UI engineer holding this document and the §1 source files should reach the end of the walking
skeleton without inventing a single visual decision. If a surface forces an invention, that is a
defect in this document - amend it here first, then build.
