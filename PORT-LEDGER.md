# PORT-LEDGER.md — port on first use

This is Verin's **"port on first use" catalog** (charter non-negotiable #10; ADR-0012). Verin ports
Meridian's *feel*, not its populated world. The walking skeleton ports **only what its own screens
render** — everything else worth porting is parked here, with a source `file:line`, what it is, why it
matters, and the **un-defer trigger** that pulls it in. Nothing is scaffolded empty (charter #5): an item
leaves this ledger only when a real surface needs it, and lands wired, not stubbed.

All `file:line` citations point at the **Meridian** reference source (read-only, at
`min-demo/frontend/…`) unless marked otherwise. Verin destinations are named where relevant.

---

## Already ported (live in the skeleton)

Disposition = **port-live**, not deferred: these ship with the skeleton's own first-class presentation
tier (`src/app/presentation/`, ADR-0012) rather than waiting for a trigger. WhyBubble ships live as
*doctrine* — every automated decision explains itself and cites a regulation.

> **Current state (Phase D/E — live):** the presentation tier now exists at `src/app/presentation/`:
> the `Verin.` wordmark (`brand.tsx`), the full OKLCH slate tokens + Geist + keyframes + reduced-motion
> (`src/app/globals.css`), and the micro-components the skeleton renders — WhyBubble (`why-bubble.tsx`),
> StepInfoCard, ProgressSteps, FreshValue (`fresh-value.tsx`, with provenance labels), StatusBadge,
> EmptyState, Field/TextInput/SelectField/Button (`ui.tsx`). All are rendered by the login /
> account-opening / console / audit screens and are axe-clean (WCAG 2.2 AA, enforced in CI). Everything
> below in the deferred table is NOT built (charter #5) — catalogued here, pulled on first real use.

| Component | Meridian source | Verin disposition |
|-----------|-----------------|-------------------|
| **WhyBubble** (explainability doctrine) | `src/components/shared/WhyBubble.tsx`; doctrine `CONVENTIONS.md:106-112` | Live doctrine — every decision cites its reasoning + regulation |
| **StepInfoCard** (contextual teaching) | `src/components/shared/StepInfoCard.tsx` | Port-live (account-opening steps) |
| **ProgressSteps** | `src/components/shared/ProgressSteps.tsx` | Port-live (wizard/flow progress) |
| **FreshValue** (freshness-as-opacity) | `src/components/shared/FreshValue.tsx:56` | Port-live; pervasive usage grows flow-by-flow |
| **StatusBadge** | `src/components/shared/StatusBadge.tsx` | Port-live |
| **EmptyState** | `src/components/shared/EmptyState.tsx` | Port-live; `action` on-ramps grow per surface |
| **FormControls** | `src/components/shared/FormControls.tsx` | Port-live (shared inputs) |
| **`Verin.` wordmark + design tokens** | wordmark treatment from `BrandReveal.tsx`; OKLCH slate + Geist | Live now (wordmark/fonts/seed tokens); full token set Phase D |

---

## The 20 non-data gaps (debrief) — each with source `file:line` + un-defer trigger

Every non-data gap the debrief named is enumerated below — none silently dropped (ADR-0012 consequence).
"First demo milestone" is the single trigger that un-defers the marquee demo machinery *and* the deferred
populated world together (captain D-005 / ADR-0012).

| # | Capability (what / why) | Meridian source `file:line` | Un-defer trigger |
|---|-------------------------|-----------------------------|------------------|
| 1 | **Autopilot / scripted-tour engines** — an `AutopilotScene` engine driving the real UI (4 journeys, ~18/7/6/5 scenes) plus 3 walkthroughs (tour 17 / mm 15 / pe 18 steps) | `src/app/autopilot/autopilot-script.ts` (`AutopilotScene`, `JOURNEY_SCENES`); `walkthrough-script.ts`; `mm-walkthrough-script.ts`; `pe-walkthrough-script.ts`; overlays `AutopilotOverlay.tsx` | First demo milestone (ADR-0012) |
| 2 | **Audio narration** — 50 mp3 (tour 17 + mm 15 + pe 18) synced to playback; await-`ended` advance loop; anti-pop fade-in | `public/audio/{tour,mm,pe}`; loop `MMWalkthroughOverlay.tsx:227-271` | First demo milestone |
| 3 | **Animated demo cursor + click ripples** — a fixed animated pointer with ripple rings; native-setter typing into React-controlled inputs | cursor `WalkthroughOverlay.tsx:302-329`; native setter `WalkthroughOverlay.tsx:39-47` | First demo milestone |
| 4 | **ScreenRecorder / "Record demo"** — `MediaRecorder` over `getDisplayMedia`, downloadable capture | `src/components/shared/ScreenRecorder.tsx:55-91` | First demo milestone |
| 5 | **Persona system as experience** — persona-select login; named households/advisors as demo characters (Thompsons, Jordans, Shakespeares, Becky/Carlos TalkTrack) | Thompsons `DEMO_CHEATSHEET.md:19-65`; Jordans `walkthrough-script.ts:37-39`; Shakespeares `src/app/backstage-builder/data/shakespeare.ts:180-205`; Becky/Carlos `src/app/backstage-builder/components/TalkTrack.tsx:110-117` | First demo milestone (paired with the deferred populated world, ADR-0012) |
| 6 | **Pervasive explainability** — WhyBubble on *every* automated decision, with regulation citations | doctrine `CONVENTIONS.md:106-112`; `src/components/shared/WhyBubble.tsx` | **LIVE** (WhyBubble ships in the skeleton); pervasiveness across flows grows flow-by-flow — N/A as a defer |
| 7 | **NotificationCenter** — derived alerts feed (~181 lines) | `src/components/shared/NotificationCenter.tsx` | When a home/dashboard surface with derived alerts ships |
| 8 | **CommandPalette in production** — ⌘K, 300ms-debounced search (~234 lines) | `src/components/shared/CommandPalette.tsx` | When the app shell has >1 primary surface to navigate |
| 9 | **Production chrome** — nav, execution history, toasts | `src/components/shared/AppHeader.tsx` | When the second flow ships (nav needs >1 destination) |
| 10 | **Workflow-catalog presentation** — flow registry home as tiles, not a drawer | flow registry home | When a 2nd+ flow exists to browse |
| 11 | **Undo (two impls)** — CRM-send undo + triage undo (optimistic, reversible) | CRM-send `WhyDecomposition.tsx:86-102` + `src/lib/data-mode-context.tsx:46-52`; triage `src/app/home/HomeScreen.tsx:259-267` + `src/lib/app-state.ts:215-217` | When a reversible mutation surface ships (triage or send-to-CRM) |
| 12 | **Bespoke screen density / layout-fidelity** — renderer honors `view.layout` for rich per-screen layout | the generic renderer | When the renderer must render >1 layout mode richly |
| 13 | **Contextual teaching** — StepInfoCard + coaching pulses | `src/components/shared/StepInfoCard.tsx:1-77` | **StepInfoCard LIVE** (account-opening steps). Coaching pulses: first demo milestone |
| 14 | **Freshness-as-opacity** — values dim by staleness tier | `src/components/shared/FreshValue.tsx:56`; `src/lib/freshness.ts:53-59` | **FreshValue LIVE**; pervasive usage grows flow-by-flow |
| 15 | **Empty-state on-ramps** — `EmptyState.action` turns dead ends into next steps | `src/components/shared/EmptyState.tsx` | **EmptyState LIVE**; wiring `action` on-ramps grows per surface |
| 16 | **Brand identity & reveal + brand-voice copy** — animated wordmark/tagline/splash + full voice pass | reveal `src/app/home/components/BrandReveal.tsx:60-69`; voice ROADMAP Priority 12 | **`Verin.` wordmark + tokens LIVE**; animated brand-reveal splash + full voice pass: first demo milestone |
| 17 | **Demo-mode ergonomics** — `Ctrl+Shift+D` toggle, `?mode=demo`, booth attract mode, `data-autopilot` CSS hooks | Meridian demo-mode plumbing | First demo milestone |
| 18 | **Presenter tooling** — cheatsheet, kill-lines, checklist | `DEMO_CHEATSHEET.md:122-137` | First demo milestone |
| 19 | **Step-up / confirmation quality** — a wizard confirm gate that confirms the **payload**, not metadata (vs. `window.prompt`) | Meridian confirm gates (`src/components/shared/ConfirmAction.tsx`) | When a sensitive/irreversible action flow ships (money movement / wire) needing step-up auth |
| 20 | **Surfaced integration breadth** — multi-CRM (Redtail, Wealthbox), custodial (Schwab, Pershing, BridgeFT), DocuSign, PDF export, SF-Flow across 52 API routes | Meridian's surfaced adapters | Per integration, when each is wired as a **real** adapter behind its port (never scaffolded empty — charter #5) |

---

Do NOT chase dark mode (debrief: both prior builds lacked it; not a differentiator).
