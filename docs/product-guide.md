# Verin Product Guide - the Differentiating Thesis

**Status:** Captured from the captain, 2026-08-05 (captain directive, logged as D-098). This is the
standing statement of what makes Verin different - the thesis every design decision, prompt brief, and
demo choice is tested against.

**Authority chain:** subordinate to [`CHARTER.md`](../CHARTER.md) (the constitution), to the ratified v3
direction ([`docs/v3/verin-architecture-v3.md`](./v3/verin-architecture-v3.md), the SHA-256-pinned
architecture document; indexed at [`docs/v3/README.md`](./v3/README.md)), and to the two normative demo
documents - [`docs/demo-contract.md`](./demo-contract.md) (the Phase 1 investor-demo contract, D-034) and
[`docs/demo-design-language.md`](./demo-design-language.md) (normative for every demo/UI surface,
ADR-0028). It is the differentiating thesis *inside* the one existing north-star chain, not a rival to
[`PRODUCT-DIRECTION.md`](../PRODUCT-DIRECTION.md): PRODUCT-DIRECTION.md remains the product north star
for the demo build and describes what Verin feels like to use; this doc states the thesis that direction
serves. This doc binds nothing on its own. Where it appears to conflict with any document named here -
including PRODUCT-DIRECTION.md - that document wins, and the conflict is a defect here to be fixed or
escalated to the captain, never resolved by overriding them.

**ADR-0060 scope.** The chain above is CURRENT VERIN's. Under `CHARTER.md` clauses F1-F9 the ratified
v3 direction and the current composition stay binding on current Verin and stand as fourth-generation
oracle evidence; neither binds fourth-generation composition unless the later F8 captain ratification
explicitly adopts it. The thesis below is not scoped by that: it states what the product must become
in any generation, and it still binds nothing on its own.

**Relation to ADR-0023 C7:** orthogonal. This doc does **not** satisfy the open C7 item (a
`PRODUCT-DIRECTION.md` v2 restating the product story under the v3 framing). That item stays open.

**Build honesty (charter #5):** the thesis below is the product *aim*, not a description of what is
built. No continuous-learning or self-configuration subsystem exists today, and none is scaffolded ahead
of a real surface; the invariants that would govern one - v3 invariants 15, 16 and 17 in
[`v3-invariants.json`](../v3-invariants.json), covering policy mutability, executable configuration, and
LLM-driven activation - are registered `not-yet-active` behind gate E. Nothing here is a claim that
unbuilt work exists.

## The thesis

In traditional software, you configure the software, and then the software runs your business.

Verin inverts that: **you run your business, and Verin continuously and in real time learns how your
business operates and increasingly configures itself around you.** That inversion is the differentiating
factor - the one sentence every other product choice in this repo answers to.

## The restaurant analogy (captain's words, cleaned)

Three people want to start amazing restaurants. They go to a provider for all the restaurant-y things they don't know how to do - how to operate a kitchen, how to run the front desk. The provider hands each of them the equivalent of a diner menu and says: take a look at this diner menu and come up with your amazing fancy restaurant.

It's just never going to be great. That's what small businesses run into. They can take the diner menu and make it look really fancy, but at the end of the day it's run on a duct-taped diner menu - a bunch of diner menus duct-taped together - and it just is what it is.

If you have the willpower to configure everything yourself, you can get to amazing. But if you don't, it's overwhelming and you never really know what to do.

## Captain's mandate

"This is what we need to build into the core system."

## How this shapes the build

Configuration in Verin is not a one-time operator setup surface. The **directional design principle** - direction, deliberately not a normative rule, and not something a review can hold anyone to today - is that configuration surfaces should be shaped so the system can PROPOSE refinements from observed operation and a human APPROVES them. It becomes machine-enforced when the self-configuration capability is actually designed: the PR that introduces it states the invariant and fences it in the same PR (charter #1), alongside the already-registered invariants 15-17 that govern policy mutability, executable configuration, and LLM-driven activation.

Where that path ends is fixed by the ratified v3 direction - [`docs/v3/verin-architecture-v3.md`](./v3/verin-architecture-v3.md) §3 non-negotiables 1, 4 and 11, and its §17 invariants 14, 15, 17, 18, 19 and 21 (the pinned document; indexed at [`docs/v3/README.md`](./v3/README.md)) - and it is directional on the same terms: activation of any configuration is to be a governed, attributed act - the system may learn and suggest, but what runs the business is something a human signed off on, with full provenance of who activated what and when. Ratified is not enforced. Every invariant that would hold this is registered `not-yet-active` in [`v3-invariants.json`](../v3-invariants.json) - 14, 15 and 17 (simulation before approval, active-policy immutability, and no direct LLM activation; gate E) and 18, 19 and 21 (approval-stage definition, approval invalidation on material input change, and pre-execution revalidation; gate F) - so no mechanism enforces it in the build today. It stops being directional when those invariants activate with live mechanisms behind them, not when this doc asserts it.
