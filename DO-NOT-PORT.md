# DO-NOT-PORT.md — the "diseases" ledger

These are the anti-patterns the reports flagged in the prior builds; **porting any of them fails Verin's
mission**, so each is named here with a source `file:line` a reviewer can recognize, why it is banned, and
the Verin counter that makes the ban a build-failing fence rather than prose.

All `file:line` citations point at the **Meridian** reference source (read-only, at `min-demo/frontend/…`)
unless marked otherwise.

| # | Disease (pattern) | Source `file:line` | Why banned | Verin's counter |
|---|-------------------|--------------------|-----------|-----------------|
| 1 | **Client-side "demo shadow world"** — a parallel fake state pretending to be the product; the same household re-modeled ≥3 incompatible ways | `src/lib/data-mode-context.tsx:36` (`useDemoData = sfConnected === false`); module-level mutable arrays `src/lib/demo-data.ts:514` (`_demoLeadState`), `:647` (`_demoOppState`) | Not durable, no single schema; UI lies about being real | House CRM is a **real store** behind the store port (ADR-0004); one canonical schema; no shadow world |
| 2 | **Dead `getAIAdapter` abstraction** — a provider-switch factory scaffolded but never called | `src/lib/ai/factory.ts:16-41`; `src/lib/ai/port.ts`; `src/lib/ai/adapters/*` | Built-but-not-shipped waste; a port with no caller | **knip dead-export gate** (charter #5); no AI scaffolding until a real caller exists |
| 3 | **`setTimeout` fake "extraction"** — a hardcoded result returned after an artificial delay to look like work | `src/app/meeting/useMeetingState.ts:203-230` | Mock theater; simulates an engine that does not exist | Critical-path tests exercise the **real** engine; no simulated latency standing in for logic |
| 4 | **Route monolith / if-block routing** — screens as one giant `page.tsx` god-component orchestrating everything | `src/app/page.tsx` (`HomeInner`, ~300-line god-component) | Unmaintainable; every screen tangled in one file | **Generic workflow engine + renderer** (ADR-0010) + a **max-file-size** fence |
| 5 | **`hasTask()`-style existence-not-completion checks** — a PASS on a row *existing*, ignoring its status | `src/lib/home-stats.ts:219-225` (a 410-day-old "COMPLIANCE REVIEW PASSED" task still marks a household "reviewed") | The false-pass class: detection masquerading as verification | **Detection-is-not-verification** fences (charter #4): completion checks assert status, not existence |
| 6 | **Hardcoded firm identity / demo IDs in prod paths / secret fallbacks / live org domains in docs** | e.g. `"AdviceOne"` hardcoded; `SF_COOKIE_SECRET || "…"` fallback | Multi-tenancy and secrets failures baked into prod paths | **config-hygiene fence + no-process-env + org-id-required** (charter #7); `no-secret-fallback` fence |
| 7 | **Shrink-only global line budget** — one budget that *punished* richness where users most wanted it | Iris ADR-0031 pattern | Penalizes the presentation tier; fights every "make it feel better" PR | **Separate, growable presentation budget** vs. ratchet-down platform ceilings (ADR-0018) |
| 8 | **Prose-only invariants of any kind** — rules that live only in docs | (this whole class) | Prose drifts and silently reverts | **Every invariant is a build-failing fence** (charter #1) |

---

Recognizing any of these in a diff is grounds to block the PR: they are not style nits, they are the
mission-failure classes the prior builds shipped.
