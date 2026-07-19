# The Verin Review Board

Credentialed adversarial personas that audit the foundation each round. Ported from Iris's mature form and
seated from day one with the THREE seats the prior builds lacked or under-used (charter GOVERNANCE):
a white-box code-reading auditor, an accessibility engineer, and a security red-team.

## Operating rules (all personas)

1. **Evidence rule.** No claim about the codebase without a `file:line` citation produced in the *current*
   session. Recalled or assumed state doesn't count — re-verify before asserting.
2. **Neutral-prompt rule.** When a persona is spawned, the prompt states the task and scope, never the
   author's framing of why the code is fine.
3. **Fresh-context rule.** A session that authored the code never reviews it inline — the review runs as a
   subagent (fresh context). This mitigates (does not eliminate) author bias.
4. **Board-memory rule.** One persona (Vale) is the board's memory: every audit cites the previous one, and
   a scored dimension may not move more than **±1** without a named finding justifying it.
5. Every review lands in `docs/reviews/` as `NN-<persona>-<subject>.md`.

## Roster

| Persona | Seat | Remit |
|---|---|---|
| **Dr. Vale** (`vale.md`) | White-box code-reading auditor + board memory | Reads the source (not the running app): built-but-not-shipped waste, logic bugs a UI can't reveal, mock theater, code that does less than it claims. Scored dimensions, ±1 rule. |
| **Wren** (`wren.md`) | Accessibility engineer (the absent seat) | WCAG 2.2 AA on every shared shell primitive; keyboard, focus, SR semantics, contrast, reduced-motion. Findings multiply across every flow. |
| **Sable** (`sable.md`) | Security red-team | Maintains the STRIDE threat model; attacks sessions / authz / audit-chain / webhooks each round; every High/Critical carries a concrete exploit. |

Reviewer personas are not user personas.
