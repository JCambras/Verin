# ADR-0056: A presentation foundation primitive lands ahead of its first caller only under a named, expiring deferral

**Status:** Accepted (amends ADR-0012)
**Date:** 2026-08-12
**Deciders:** Supervising authority (documentation-gate ruling `document-ask-user`, 2026-08-12); build
agent records it
**Relates to:** charter #5 (nothing built-but-not-shipped), #10; ADR-0012, ADR-0028, ADR-0031 (the
precedent for a reviewed, expiring charter-#5 exception); D-116, D-191, D-192, D-201; `PORT-LEDGER.md`
**Informed by:** ADR-0012's "port on first use only" bullet read against the tree Wave A prompt 2 landed

## Context

ADR-0012 states the rule without qualification: "**Port on first use only:** the skeleton ports just the
components its screens render; everything else worth porting is catalogued in `PORT-LEDGER.md` ... and
pulled when a real surface needs it (charter #5: no dead components)."

Wave A prompt 2 (D-191) landed the canonical primitive foundation in `src/app/presentation/` as the one
visual grammar every product surface composes. Five members of that foundation have no product caller:
`Checkbox`, `Radio` (`ui.tsx`), `Tabs` (`tabs.tsx`), `Tooltip` (`tooltip.tsx`), and a DIRECTLY composed
`Pill`. The explicit brief asked for the complete control foundation as a SET; inventing a workflow to
showcase a control would change product behavior to satisfy a gate, and deleting five recipes guarantees
five separate re-derivations of exactly the drift the library exists to end. D-192 therefore recorded
each as a named deferral carrying the front-end prompt that lands its first honest caller; `PORT-LEDGER.md`
says so (D-201 corrected the paragraph there that had counted `Tabs`, `Tooltip`, `Checkbox` and `Radio`
among the rendered, axe-clean primitives); and `docs/demo-design-language.md` §1 rule 2 states the
exception where UI prompts read it first.

Those are `DECISIONS.md` entries, and a reversible decision entry cannot amend an accepted ADR. So the
governing text still read as absolute while the tree contradicted it - the split-authority condition D-195
names, where the next author obeys whichever half they read first and either deletes the foundation or
concludes "port on first use" is advisory. Both readings are wrong, and only an ADR can say which.

The nearest precedent is ADR-0031: the evidence-to-LLM projection boundary landed ahead of its first
caller as a reviewed, named exception that expires at a stated prompt. This amendment does the same for
the shared control foundation, on the same terms, and no wider.

## Decision

ADR-0012's "Port on first use only" bullet gains ONE exception, exhaustively conditioned. A presentation
FOUNDATION primitive - a control in the shared grammar `docs/demo-design-language.md` §1 names as the
tier's canonical vocabulary - may land ahead of its first product caller ONLY when ALL of the following
hold in the PR that lands it:

1. It belongs to a foundation set an explicit, ratified brief asked for **as a set**, not a component an
   author found useful along the way.
2. It is entered as a NAMED DEFERRAL in `PORT-LEDGER.md` and in a `DECISIONS.md` entry, citing the
   SPECIFIC front-end prompt that lands its first honest caller.
3. That citation **is its expiry**: when the named prompt lands, the primitive acquires its real product
   caller or is DELETED in that same work. It is never re-deferred to a later prompt (D-192's un-defer
   trigger), so the table can never become a standing amnesty.
4. Its contract is executable now - a direct unit contract test, labeled as what it is, because an e2e
   axe scan cannot reach a component no route renders (D-201).
5. No caller is manufactured to satisfy a gate. Changing product behavior to showcase a control is a
   worse failure than naming the gap.

**This is not a blanket exemption and not permission to build ahead generally.** It is not available to a
convenience component (ADR-0031's line holds: convenience code never qualifies), it does not widen the
presentation budget (ADR-0012's ADR-bump rule is untouched), and it does not weaken charter #5, which
keeps meaning what D-116's ledger-export deferrals and ADR-0031 already made it mean: a capability either
has a caller or has a named, expiring deferral a reviewer can check against a prompt number.

The complete list of primitives holding this exception is D-192's table, mirrored in `PORT-LEDGER.md`:

| Primitive | First caller lands at | Expires |
| --- | --- | --- |
| `Tooltip` | Prompt 3, application shell | Prompt 3 |
| `Pill` (directly composed) | Prompt 5, role homes | Prompt 5 |
| `Tabs` | Prompt 7, household context surface | Prompt 7 |
| `Checkbox` | Prompt 8, the table system | Prompt 8 |
| `Radio` | Prompt 11, configuration authoring | Prompt 11 |

Adding a sixth row is another amendment to this ADR, never an author's judgment call at edit time.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Delete the five, re-land each with its caller | Discards the foundation the ratified brief asked for as a set, and buys five re-derivations of the recipes the library exists to unify. |
| Manufacture a caller (tabs on a single-section page, a checkbox nobody needs) | Mock theater - product behavior changed to satisfy a gate. D-191 and ADR-0031 rejected the same shape. |
| Leave D-191/D-192 as the whole record | A reversible decision entry cannot amend an accepted ADR; the constitution would keep contradicting the tree. |
| Restate the bullet as "port when useful" | A blanket exemption. Charter #5 stops being falsifiable the moment an exception has no expiry. |
| Fence it now (a build failure on a callerless primitive) | The fence must read the deferral register to tell a named deferral from a dead component, and the first retirement it could be proven against has not happened yet; recorded as a keyed follow-up rather than half-built (Consequences). |

## Trade-offs and Costs

- **Gained:** one visual grammar landed as a set; an ADR-level rule a later author can apply; an exception
  whose expiry a reviewer checks against a prompt number rather than against taste.
- **Sacrificed:** five primitives carry unit contracts but no e2e axe coverage until their prompt lands,
  and each expiry retires three records together (this ADR's table, `PORT-LEDGER.md`, `DECISIONS.md`).

## Consequences

ADR-0012's Status line and its "Port on first use only" bullet now name this amendment, so a reader who
lands there first cannot read the absolute rule the tree contradicts. `PORT-LEDGER.md`'s "Built, and
honestly not yet rendered" paragraph and `docs/demo-design-language.md` §1 rule 2 cite it as their
authority; the charter-map entry for #10 is unchanged, because this amends how ADR-0012's port rule reads,
not which mechanism enforces the presentation tier.

Enforcement is DOCUMENTARY today, and this ADR says so rather than implying a fence exists: `knip` cannot
see this class (every primitive has a unit test, which is a reference), and no fitness fence yet proves a
presentation primitive is either called or named-deferred. The check is the expiry review at each prompt
in the table above. That gap is recorded as follow-up key `fu-primitive-deferral-expiry-fence` (D-203),
whose un-defer trigger is the first expiry - prompt 3, `Tooltip` - which is the first prompt that must
retire a row and therefore the first that can prove a fence against a real retirement.

## Revisit When

The last row of the table expires (prompt 11, `Radio`) with every row retired: this exception then has no
holders and ADR-0012's bullet stands unqualified again. Or a sixth primitive is proposed to land ahead of
its caller - which is a new amendment here, not a row someone adds. Or `fu-primitive-deferral-expiry-fence`
lands, at which point the procedure above becomes a build failure rather than a review obligation.
