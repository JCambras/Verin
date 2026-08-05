# Verin Product Guide - the Differentiating Thesis

Captured from the captain, 2026-08-05. This is the standing product guide: every design decision, prompt brief, and demo choice should be tested against it.

## The thesis

In traditional software, you configure the software, and then the software runs your business.

Verin inverts that: **you run your business, and Verin continuously and in real time learns how your business operates and increasingly configures itself around you.**

## The restaurant analogy (captain's words, cleaned)

Three people want to start amazing restaurants. They go to a provider for all the restaurant-y things they don't know how to do - how to operate a kitchen, how to run the front desk. The provider hands each of them the equivalent of a diner menu and says: take a look at this diner menu and come up with your amazing fancy restaurant.

It's just never going to be great. That's what small businesses run into. They can take the diner menu and make it look really fancy, but at the end of the day it's run on a duct-taped diner menu - a bunch of diner menus duct-taped together - and it just is what it is.

If you have the willpower to configure everything yourself, you can get to amazing. But if you don't, it's overwhelming and you never really know what to do.

## The differentiating factor

Traditional world: configure the software, then the software runs your business.

Verin: you run your business; Verin learns how your business operates and increasingly configures itself around you.

## Captain's mandate

"This is what we need to build into the core system."

## How this shapes the build

Configuration in Verin is not a one-time operator setup surface. Every configuration surface must be shaped so the system can PROPOSE refinements from observed operation - and a human APPROVES them. Activation of any proposed configuration remains a governed, attributed act, consistent with the ratified invariants (see [`docs/v3/README.md`](./v3/README.md)): the system may learn and suggest, but what runs the business is always something a human signed off on, with full provenance of who activated what and when.
