# 02 — Wren (accessibility, WCAG 2.2 AA) — foundation audit

Fresh-context review. Method in `docs/personas/wren.md`. The shared primitives were found strong on the
static layer axe enforces (labels, button names, visible focus, reduced-motion, text+colour); the gaps were
the dynamic/perceptual layer axe cannot see. All fixed in the Phase-G pass.

| # | Severity | WCAG | Finding | Disposition |
|---|----------|------|---------|-------------|
| W1 | High | 4.1.3 | Dynamic status changes silent to screen readers (StatusBadge / phase panels / audit verdict) | **Fixed** — `role="status"` on the account-opening awaiting/completed panels and the audit verdict; `role="alert"` when the chain is BROKEN. |
| W2 | High | 1.4.3 | FreshValue opacity drops stale text below 4.5:1 | **Fixed** — opacity floored at 0.7 (faded slate-900 stays ≥ 4.5:1). |
| W3 | Medium | 2.4.6/4.1.2 | "Rename" buttons share one ambiguous name | **Fixed** — `aria-label={`Rename ${name}`}` per row. |
| W4 | Low | 1.3.1 | No `aria-current` on active nav link / progress step | **Fixed** — `aria-current="page"` on the active nav link, `aria-current="step"` on the active step. |
| W5 | Low | 1.4.3 | `.text-slate-400` advertised AA but 4.27:1 | **Fixed** — darkened to ~5:1. |
| W6 | Low | 4.1.2 | WhyBubble disclosure lacks `aria-controls` | **Fixed** — `aria-controls` + region `id` (useId). |
| W7 | Low | 1.3.1 | Audit table `<th>` without `scope`, no `<caption>` | **Fixed** — `scope="col"` + sr-only `<caption>`. |
| Meta | — | — | axe gate never scanned `/app/audit` or the post-submit account-opening states | **Partially fixed** — the axe gate now scans `/app/audit`. **Trigger/follow-up:** scan the account-opening `awaiting`/`completed` states (the happy-path spec renders them; add an axe assertion there). |

Credited as genuinely good: every input bound to a `<label>` via the `Field` primitive; consistent
`role="alert"` on error paths; status is text+colour never colour-alone; global visible focus ring (4.88:1);
the reduced-motion kill-switch; `lang` + `<title>` + landmark structure.
