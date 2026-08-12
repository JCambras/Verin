import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  shippedSourceFiles,
  REPO_ROOT,
  toolingSourceFiles,
} from "./_fence-utils";
import { join, relative } from "node:path";

/**
 * LINE-BUDGET FENCE (ADR-0018, charter #1/#10). PER-LAYER ratchet-down ceilings on
 * the platform layers (Vale V17: charter #1 says per-layer, not one combined
 * number) so one layer can't balloon under an aggregate. The presentation tier has
 * its OWN envelope, grown only by an ADR bump — NOT the shrink-only global budget
 * that punished richness in Iris.
 *
 * Ceilings carry interim build headroom and RATCHET DOWN to actual+buffer at
 * foundation close. Raising any ceiling is an ADR amendment, not a code change.
 */
// ADR-0033 amended these to the smallest rounded envelopes that leave BOUNDED room
// for correction; ADR-0034 and ADR-0036 raised infrastructure alone,
// ADR-0035 raised contracts alone for normalized failure snapshots,
// ADR-0037 raised domain alone for pre-load runtime tenant validation,
// ADR-0038 raised domain and infrastructure for identifier provenance,
// ADR-0040 raised contracts for the prompt-8 primitive catalog, and
// ADR-0041 raised all three for the prompt-7 decision ledger. Before
// ADR-0033, domain and infrastructure sat at exactly ZERO headroom, so one added
// line in either failed `pnpm test` on an unrelated ceiling and the only remedy was
// an ADR amendment rather than a code change - which is what compressed doc comments
// across contracts/metric.ts and contracts/provenance.ts and deleted the
// migrations.ts header AGENTS.md still points readers at. A ceiling that cannot
// absorb a correction buys no discipline; it just converts review findings into
// documentation deletions.
//
// ADR-0048 restored the migration prose an earlier correction had compressed away to
// fit this ceiling - the exact anti-pattern the paragraph above names - and raised
// infrastructure to absorb it. ADR-0051 then raised contracts and infrastructure together
// for the scoped rebuild preview, the whole-chain counted provenance, and the shared
// decision-id extractor the dedup moved INTO contracts. MEASURED on the composed tree that
// also carries ADR-0040's prompt-8 primitive catalog: contracts 6064/6110 (46), domain
// 1581/1650 (69), infrastructure 7780/7840 (60), presentation 2240/6000 (re-measured in the
// D-202 review round, which took the register's height cap off the windowing strategy and
// made it the caller's declared layout; 2199 at D-201, which took the landmark name off the
// two compliance captions that assert an order and made a sortable register declare its own;
// 2193 at
// D-200, which separated a register's landmark NAME from the sort disclosure
// it had been carrying, gated "re-sorted" on the reader having moved the rows, and placed
// focus before an explicitly dismissed toast removes the control holding it; 2119 at D-199,
// where the direction stopped reversing the ordering's SCAFFOLDING - the
// band layout and the blanks hold still, only the values inside a kind reverse - and window
// reconciliation moved from the print pass onto the windowing transition itself; 2064 at
// D-198, which gave the tier ONE stated ordering in its own `table-order.ts`; 1970 at D-197,
// 1915 at D-196, 1884 at D-195, 1840 at D-194, 1664 at D-192, 1645
// as the primitives landed). D-193
// recorded
// 1782 for a tree that measured 1804 - the figure was taken before that round finished
// landing, which is the exact staleness the paragraph below names, so D-194 re-took it
// with this file's own algorithm rather than inheriting it, and D-195 re-takes it again
// for the one-action recorded-order restore and the boundary reset key. A figure recorded
// here is a MEASUREMENT, so
// re-measure it in the commit that changes a layer - ADR-0049's import hoist left this
// line reading a stale figure while the layer had moved, and the whole ratchet chain rests
// on the recorded figure being the measured one. Any FURTHER increase remains a measured
// ADR amendment rather than a silent fence edit, and no correction is ever paid for by
// deleting documentation - nor, per ADR-0050, by folding readable code onto fewer lines.
// ADR-0054 raised contracts and domain for the prompt-9 policy AST and
// interpreter (the grammar module policy.ts plus the schema-introspection
// helpers in primitives/values.ts; the nine-file policy module: loader, checks,
// conflict prover, facts plane, four-phase evaluator, temporal math, trace).
// Its first figures were taken before the tree it describes had finished
// landing and went stale by 20/13 lines - the exact condition the paragraph
// above calls "a ceiling with a number nobody re-took". ADR-0054 is amended
// with figures RE-MEASURED on the tree as it lands after the prompt-9 review
// round (atomic Phase-0 unwind, brand-tight temporal bytes, constant-scoped
// temporal widening, single-walk key reads): contracts 6,555 against an
// unchanged 6,600 ceiling, and domain 4,063 - which passed the 4,050 ceiling,
// so the ceiling moved to 4,150. The SECOND review round (cascaded unwind of
// every primitive a rejected rule configured, per-parameter rejection
// attribution, one shared context-key precedence, the fail-closed
// future-observation freshness read, the constant-binding assembly guard)
// added 101 domain lines and passed 4,150 in turn: ADR-0054 is amended again to
// 4,250 against a re-measured 4,164, contracts unmoved at 6,555. The THIRD
// review round (discriminated predicate union, load-time structural nesting
// bound, fail-closed rejection implication, total evidence-requirement
// comparator, structural context-key-collision refusal) landed domain at 4,248
// - INSIDE 4,250 by two lines, which is the ADR-0033 failure mode this header
// exists to prevent, not a pass to bank. ADR-0054 is amended a third time to
// 6,650/4,350 against re-measured 6,567/4,248. Those figures then went stale in
// the very next commit: the FOURTH review round (load-time reservation of the
// synthesized blocker-code namespaces, the fail-closed non-scalar guard on the
// evidence and instruction fact arms, the per-version grammar-schema
// memoization, the integer-depth nesting walk) added 80 domain and 17 contracts
// lines without re-taking either number. ADR-0054 is amended a fourth time with
// figures RE-MEASURED on the tree as that correction lands: contracts 6,584 and
// domain 4,328 against UNCHANGED 6,650/4,350 ceilings - 66 and 22 lines of real
// headroom, named rather than banked, so the next change to `src/domain/**`
// reads as the measured ADR-0054 amendment it now is rather than as a code
// change. The SIXTH review round is that change: making key-shaping parameters
// non-writable added the catalog declaration in contracts and, in domain, the
// load check plus `load-effects.ts` - the module the 500-line PER-FILE ceiling
// forced, since `load-checks.ts` sat at 495 with all of `checkEffects` in it.
// That is one module header and one import block bought to keep the check where
// it belongs instead of folding code to fit (ADR-0050), and it is why the
// domain ceiling moves. ADR-0054 is amended a fifth time to domain 4,500 against
// a re-measured 4,400 (100 lines of correction room), contracts unmoved at 6,650
// against 6,602. The SEVENTH review round spends part of that room - resolving a
// context key by its DECLARED ORIGIN, so an intent entry can never stand in for a
// fact an unevaluable primitive did not publish - and re-takes both figures
// rather than inheriting them: domain 4,444 and contracts 6,602, against
// UNCHANGED 4,500/6,650 ceilings, 56 and 48 lines of headroom NAMED rather than
// banked. The post-merge temporal-canonicality guard (D-186, firm ruling
// p9-temporal-fact-bytes: declared registry types plumbed into resolveValue so
// non-canonical temporal bytes land the reading rule unevaluable) added 70
// domain lines and passed 4,514 - ADR-0054 is amended a sixth time to domain
// 4,550 (36 lines of headroom), contracts unmoved at 6,650 against an
// unchanged 6,602. Re-measure in any commit that
// changes a layer; a raise is always a measured ADR amendment.
// ADR-0057 (the populated world) raises domain, infrastructure and tooling
// together, each against a figure RE-MEASURED on the tree as it lands rather
// than inherited: domain 5,044 (the world model + the six-factor health
// computation), infrastructure 8,136 (the fixture evidence adapter + the CRM
// projection of the world's households, people and open items), tooling 13,784
// (the world generator under `scripts/world/**`, its two runners, and the
// clean-slate sweep). Ceilings moved to 5,150 / 8,250 / 14,000 - 106, 114 and 216
// lines of correction room, NAMED rather than banked. Those are NOT the figures
// this file enforces today: the review rounds beneath this branch moved the
// tooling ceiling again (D-207, 14,200) and moved all three measurements, so the
// current pairing is 5,150 / 8,250 / 14,200 against RE-MEASURED 5,086 / 8,200 /
// 14,168 (D-212) - 64, 50 and 32 lines of correction room. A summary paragraph
// carrying a superseded ceiling is the same defect as a ceiling carrying a stale
// measurement, so it is re-stated here rather than left for a reader to catch.
// D-214 (ADR-0057 amendment, review round nine) raises infrastructure to 8,400
// and tooling to 14,350 against RE-MEASURED 8,283 and 14,232: the RECORD-ORIGIN
// fact arrives as its own vocabulary, its own migration and its own reading of
// the DDL, because the provenance of a value and the origin of a record are two
// facts one flag cannot carry. Domain HOLDS at 5,150 against a re-measured
// 5,093. That leaves 117, 118 and 57 lines of correction room, NAMED rather than
// banked - tooling had 32 left, which is the "the next one-line correction fails
// an unrelated ceiling" condition this header argues against.
// D-219 (ADR-0057 amendment, review round fourteen) raises infrastructure alone
// to 8,600 against a RE-MEASURED 8,489: the corrective migration that reaches
// stores seeded before the demonstration inserts named an origin, the
// demonstration identity both the seed and that migration key on, and the
// statement of where each data-correcting version's reach STOPS - which is
// documentation the ceiling must absorb rather than be paid for by deleting
// (ADR-0048/0050). That is 111 lines of correction room, named rather than
// banked. RE-MEASURED and unmoved in the same round: contracts 6,602/6,650,
// domain 5,093/5,150, presentation 2,240/6,000, tooling 14,311/14,350 - tooling
// has 39 lines left, which is again the condition this header argues against and
// is stated here so the next change to `scripts/**` reads it before spending it.
// `contracts` and `presentation` are untouched by that work and do not move.
//
// ADR-0059 (v3 prompt 10, the domain-configuration schema): the single largest
// domain addition of the build so far, and deliberately so - the whole point of
// prompt 10 is that a decision DOMAIN stops being code. src/domain/config/ is
// the schema for all thirteen ratified sections, the seven-stage loader, the
// firm binder, the prompt-9 registry derivation, the plan compiler, and the
// version diff; against it the hand-coded account-opening flow definition (123
// lines) is DELETED and src/infrastructure/wire.ts shrinks to composition.
// MEASURED on the composed tree: contracts 6,647 / 6,700 (53), domain 8,340 /
// 8,420 (80), infrastructure 8,204 / 8,290 (86), presentation 928 / 6,000,
// tooling 12,140. Every figure here is a MEASUREMENT taken in this commit; a
// further raise stays a measured ADR amendment, and no correction is ever paid
// for by deleting documentation (ADR-0048) or by folding readable code onto
// fewer lines (ADR-0050).
//
// ADR-0059 AMENDMENT (review round 3): `domain`'s 80 lines of correction headroom
// were spent answering review findings in code - the request boundary's checked
// intake reads, the duplicate-transport-field refusal, and the named owner of the
// deferred change-record byte check. RE-MEASURED with this file's own algorithm:
// contracts 6,647 / 6,700 (53), domain 8,433 / 8,520 (87), infrastructure 8,225 /
// 8,290 (65), presentation 928 / 6,000, tooling 12,154 / 12,400. Only `domain`'s
// ceiling moves; the other three are re-taken and still inside their ceilings, so
// those are left where ADR-0059 set them rather than re-baselined for company.
//
// ADR-0059 AMENDMENT (review round 4): five of the six prompt-10 brands were
// DELETED from `contracts` - they had no consumer, and their `brandedString`
// declaration disagreed at runtime with the `kebabId` mint in `src/domain/config/`
// that does the same job. `contracts` therefore RATCHETS DOWN: leaving its ceiling
// where code that no longer exists put it would bank headroom on a deletion.
// `domain` grows past its ceiling answering this round's findings in code (the
// derived firm-class checklist, the reserved trigger-field namespace, the
// deferred-reference walk). RE-MEASURED with this file's own algorithm:
// contracts 6,626 / 6,680 (54), domain 8,578 / 8,660 (82), infrastructure 8,250 /
// 8,290 (40), presentation 928 / 6,000, tooling 12,154 / 12,400. `infrastructure`
// moved but stayed inside, so its ceiling is left alone rather than raised for
// company - the same rule the previous amendment applied.
//
// ADR-0059 AMENDMENT (review round 7): `domain` grows past its ceiling answering
// this round's findings in code - a value source is checked for AVAILABILITY at
// the CONSUMING step rather than against the plan as a whole (so a forward or
// sibling `step-output` reference is a load error, not a mid-plan failure after
// earlier writes have committed), and the flow-data namespace check gains its
// third writer, the awaited observation's own fields. RE-MEASURED with this
// file's own algorithm: contracts 6,638 / 6,680 (42), domain 8,973 / 9,050 (77),
// infrastructure 8,270 / 8,290 (20), presentation 928 / 6,000, tooling 12,154 /
// 12,400. Only `domain`'s ceiling moves; `contracts` and `infrastructure` are
// RE-TAKEN here rather than carried forward - the round-4 and round-6 figures
// had gone stale by twelve and eight lines, which is exactly what this header
// says a number nobody re-took is worth - and both stay inside the ceilings they
// already had, so those are left alone rather than raised for company.
//
// ADR-0059 AMENDMENT (review round 8): BOTH `domain` and `infrastructure` grow
// past their ceilings answering this round's findings in code. In `domain`: the
// context plane is refused at LOAD in both places it would have failed mid-plan,
// `$ref.kind` is checked against its closed vocabulary, the closure stage's scope
// is widened to match the reachability stage's, and a compiled plan carries the
// configuration version it was compiled from. In `infrastructure`: the
// composition root pins that version into flow data at start and refuses to drive
// a stored positional cursor under a different one. The round-9 amendment answers
// that guard's own fallout - the taxonomy's retryability is read at the webhook
// rather than flattened to 5xx, a MISSING recorded version is legacy rather than
// mismatched, and the replay path is held to the same discipline as the two paths
// that drive - and NO ceiling moves for it. RE-MEASURED with this file's own
// algorithm: contracts 6,649 / 6,680 (31), domain 9,085 / 9,150 (65),
// infrastructure 8,341 / 8,360 (19), presentation 928 / 6,000, tooling 12,154 /
// 12,400.
//
// ADR-0059 AMENDMENT (review round 12): `contracts` and `infrastructure` grow
// past their ceilings answering this round's finding in code. In `contracts`: the
// closed client-retry vocabulary, which exists because no error CODE can carry
// what a submitter should do next - this endpoint answers two CONFLICTs whose
// remedies are opposite. In `infrastructure`: every start refusal now names its
// own instruction at the point where the reason is still known. `contracts` is
// RAISED, not ratcheted down as in round 4: that ratchet paid for deleted code,
// and this is added code with a live consumer in three layers. `domain` moved
// (one registered log message, one registered attribute vocabulary) but stayed
// inside, so its ceiling is left alone rather than raised for company.
// RE-MEASURED with this file's own algorithm: contracts 6,682 / 6,710 (28),
// domain 9,183 / 9,240 (57), infrastructure 8,380 / 8,400 (20), presentation
// 928 / 6,000, tooling 12,154 / 12,400.
//
// ADR-0059 amendment (review round 13) raises all three for the THIRD refusal
// category and the correlation-id-joined configuration diagnosis: `contracts`
// carries the `retry-later` arm and its pacing constant, `domain` the
// correlationId/configStage observability vocabulary, the exhaustive value-source
// resolver and the engine's resume guard, `infrastructure` the operator-visible
// parked-callback report and the one place every configuration refusal is minted.
// `contracts` had reached its ceiling EXACTLY (6,710 / 6,710), which is the
// zero-headroom condition the header above exists to prevent, so it moves too.
// RE-MEASURED: contracts 6,710 / 6,740 (30), domain 9,271 / 9,330 (59),
// infrastructure 8,485 / 8,515 (30).
//
// ADR-0059 amendment (review round 14) raises all three for CLASSIFICATION BY
// CAUSE and a diagnosis channel that actually carries the diagnosis: `contracts`
// carries the operator-recoverable marker and the `clientRetryFor` rule stated
// where the categories are defined, `domain` the configuration-diagnosis id
// vocabulary and its shape-checked factory plus the marked compile refusals,
// `infrastructure` the structured refusal emission and a version guard that logs
// the parked execution on every path that can raise one. All three were within
// ~30 lines of their ceilings, which is the zero-headroom condition the header
// above exists to prevent, so none is left to be corrected by an unrelated round.
// RE-MEASURED: contracts 6,752 / 6,782 (30), domain 9,333 / 9,393 (60),
// infrastructure 8,589 / 8,619 (30).
//
// ADR-0059 amendment (review round 15) raises `domain` and `infrastructure` for the
// DERIVED refusal class (D-260): `infrastructure` gains the compile of the published
// document, moved out of the composition root so every configuration refusal lives in
// the configuration modules a fence can derive, plus the step-refusal minter, the
// loader's fault code, the absent-versus-censored path, and a version guard that states
// its two verdicts apart. `domain` gains the refusal port and its two registered stages
// against the deleted loader-error formatter, and had reached 9,388 against 9,393 -
// five lines, the zero-headroom condition this header exists to prevent - so it moves
// too. `contracts` is RE-TAKEN and unchanged at 6,752, well inside its ceiling, so it is
// left alone rather than raised for company.
// RE-MEASURED: contracts 6,752 / 6,782 (30), domain 9,388 / 9,450 (62),
// infrastructure 8,683 / 8,745 (62).
//
// ADR-0059 amendment (review round 16) raises `domain` for making the refusal port
// the ONE mint rather than a mark nine authors applied nine ways: the port grows a
// third arm and a home beside the fault type it converts, the plan compiler's six
// hand-written refusals become typed faults with real document paths, the intake
// view's two become the same, and the diagnosis shape learns the subscripted
// segment its emitters had been producing all along. The DELETED half is real too -
// nine interpolated sentences and two marker imports - so the net is 104 lines for
// a classification that is now structural. `contracts` and `infrastructure` are
// RE-TAKEN: `infrastructure` moved by 18 lines and both stay inside the ceilings
// they already had, so neither is raised for company.
// RE-MEASURED: contracts 6,752 / 6,782 (30), domain 9,492 / 9,555 (63),
// infrastructure 8,701 / 8,745 (44).
//
// ADR-0059 amendment (review round 18) raises `contracts` and `domain` for a fault
// LOCATION that is built rather than interpolated, and for a demo surface that fails
// as a value. In `contracts`: the cause reader a surface with ONE
// instruction-carrying arm needs, so no call site invents a fallback it can never
// send (D-265). In `domain`: the diagnosis channel's capacity stated once beside the
// emitter that must respect it, the fault constructor that carries only what it can
// express, the grammar stage's segment-built location, the parameter walks' refusal
// of a key the channel cannot name, and the refusal port's fourth arm with its
// registered stage (D-266/D-267). `contracts` had 11 lines of headroom and `domain`
// was 80 over - both the zero-headroom condition the header above exists to prevent.
// `infrastructure` moved by two lines and stays well inside, so it is RE-TAKEN
// rather than raised for company; `presentation` is re-taken too, since the 928 this
// header carried had gone several rounds stale.
// RE-MEASURED: contracts 6,771 / 6,810 (39), domain 9,765 / 9,830 (65),
// infrastructure 8,792 / 8,815 (23), presentation 2,240 / 6,000, tooling 12,154 /
// 12,400.
//
// ADR-0059 amendment (review round 19) raises `domain` and `infrastructure` for a
// fault location that NAMES the limit that ended it: `domain` carries the two-limit
// vocabulary, the typed step both parameter walks now discriminate on, one message
// per cause, and the limit `configError` inherits from its own truncation (the two
// drifted truncation walks collapse into one step rule, which is the deleted half);
// `infrastructure` carries that limit on the shared mint's diagnosis and the
// registered `configPathLimit` on the operator's line. Ending a location for two
// reasons with one answer reported a LENGTH truncation as a NAMING problem, at the
// ALLOWED depth, with ordinary camelCase keys (D-268). Both layers were left with
// twelve and thirteen lines - the zero-headroom condition this header exists to
// prevent - so both move; the other three did not move and are RE-TAKEN.
// RE-MEASURED: contracts 6,771 / 6,810 (39), domain 9,818 / 9,880 (62),
// infrastructure 8,802 / 8,850 (48), presentation 2,240 / 6,000, tooling 12,154 /
// 12,400.
//
// ADR-0059 re-measure (review round 20): carrying a fault location and its limit as
// ONE value (`ConfigPath`, D-269) spent 50 of `domain`'s 62 lines of correction
// headroom - the typed step both container kinds now take, the subscript step that
// puts a list POSITION under the same ceiling as a key, and a constructor with no
// limit argument left to overrule. NO ceiling moves: every layer is inside the one
// it already had, and a ceiling raised without its own finding is a ceiling nobody
// is holding. `domain` is now TWELVE lines from its ceiling, which is the
// zero-headroom condition the header above argues against - named here rather than
// banked, so the next change to `src/domain/**` reads it as the ADR amendment it now
// is.
// RE-MEASURED: contracts 6,771 / 6,810 (39), domain 9,868 / 9,880 (12),
// infrastructure 8,802 / 8,850 (48), presentation 2,240 / 6,000, tooling 12,154 /
// 12,400.
// REBASE RE-MEASURE (this branch onto PR #39, the populated world). The merged
// tree contains BOTH bodies of code, so NEITHER side's ceilings covered it:
// domain measured 10,447 against a 9,880 ceiling and infrastructure 9,505
// against 8,850. The per-bucket MAX of the two sides was rejected as the
// resolution - a ceiling set to the larger of two numbers, neither of which was
// measured on this tree, asserts a measurement nobody took, which is the same
// defect as a stale figure. Every ceiling below is RE-MEASURED on the merged
// tree with this file's own algorithm and raised to measurement plus NAMED
// headroom, recorded in ADR-0059 (D-270).
//
// Stated explicitly rather than rounded away: BEFORE this raise the merged tree
// left tooling 20 lines (14,330 against 14,350) and contracts 39 lines (6,771
// against 6,810) of headroom - both the "the next one-line correction fails an
// unrelated ceiling" condition this header argues against, arriving not from
// either branch's work but from their sum. `fu-domain-ceiling-headroom` already
// tracks that condition for the domain layer.
const CEILINGS = {
  contracts: 6900, // ADR-0059 (D-270), re-measured on the merged tree: 6,771 + 129 named
  domain: 10600, // ADR-0059 (D-270), re-measured on the merged tree: 10,447 + 153 named
  infrastructure: 9650, // ADR-0059 (D-270), re-measured on the merged tree: 9,505 + 145 named
  presentation: 6000, // grown only by an ADR bump (ADR-0012); re-measured 2,240
  tooling: 14500, // ADR-0059 (D-270), re-measured on the merged tree: 14,330 + 170 named
} as const;

type Bucket = keyof typeof CEILINGS | "other";

function bucket(file: string): Bucket {
  const r = relative(REPO_ROOT, file).replace(/\\/g, "/");
  if (r.startsWith("src/app/presentation/")) return "presentation";
  if (r.startsWith("src/contracts/")) return "contracts";
  if (r.startsWith("src/domain/")) return "domain";
  if (r.startsWith("src/infrastructure/")) return "infrastructure";
  if (r.startsWith("scripts/")) return "tooling";
  return "other";
}

/** Build-time tooling files - the tree the platform fences never walked. */
export function toolingFiles(root?: string): string[] {
  return toolingSourceFiles(root);
}

export function measureBudgets(): Record<keyof typeof CEILINGS, number> {
  const totals = { contracts: 0, domain: 0, infrastructure: 0, presentation: 0, tooling: 0 };
  for (const f of [...shippedSourceFiles(), ...toolingFiles()]) {
    const b = bucket(f);
    if (b !== "other") totals[b] += readFileSync(f, "utf8").split("\n").length;
  }
  return totals;
}

/** The real budget check, callable with synthetic totals by the companion. */
export function budgetViolations(totals: Record<keyof typeof CEILINGS, number>): string[] {
  const out: string[] = [];
  for (const layer of Object.keys(CEILINGS) as (keyof typeof CEILINGS)[]) {
    // A ZERO total means the bucket's path pattern went stale (a renamed layer
    // path silently drops its envelope) — fail loudly, never pass vacuously.
    if (totals[layer] === 0) out.push(`${layer}: 0 lines measured — bucket path went stale (charter #4)`);
    if (totals[layer] > CEILINGS[layer]) out.push(`${layer}: ${totals[layer]} lines exceed ceiling ${CEILINGS[layer]} — shrink or amend ADR-0018`);
  }
  return out;
}

describe("line-budget fence (per-layer)", () => {
  const totals = measureBudgets();

  it(`enforces: every layer is measured (non-zero) and within its ceiling [now ${JSON.stringify(totals)}]`, () => {
    const violations = budgetViolations(totals);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  describe("detects (companion): the REAL check fails synthetic violations", () => {
    it("an over-budget layer total fails through budgetViolations", () => {
      const v = budgetViolations({ ...totals, contracts: CEILINGS.contracts + 1 });
      expect(v.some((m) => m.startsWith("contracts:") && m.includes("exceed"))).toBe(true);
    });
    it("an EMPTY bucket (renamed layer path) fails instead of passing vacuously", () => {
      const v = budgetViolations({ ...totals, presentation: 0 });
      expect(v.some((m) => m.startsWith("presentation:") && m.includes("stale"))).toBe(true);
    });
    it("the current real measurement passes (the companion is not asserting on a broken baseline)", () => {
      expect(budgetViolations(totals)).toEqual([]);
    });
    it("presentation growth is charged only to presentation, never the platform layers", () => {
      expect(bucket(`${REPO_ROOT}src/app/presentation/x.tsx`)).toBe("presentation");
      expect(bucket(`${REPO_ROOT}src/domain/x.ts`)).toBe("domain");
    });
    it("build-time tooling is charged to `tooling`, never to a platform layer (ADR-0052)", () => {
      expect(bucket(`${REPO_ROOT}scripts/corpus/generate.ts`)).toBe("tooling");
      expect(bucket(`${REPO_ROOT}scripts/db-seed.ts`)).toBe("tooling");
      expect(bucket(`${REPO_ROOT}src/contracts/x.ts`)).toBe("contracts");
    });
    it("the tooling bucket measures a NON-EMPTY tree, so moving code to scripts/ cannot hide it", () => {
      expect(toolingFiles().length).toBeGreaterThanOrEqual(10);
      expect(totals.tooling).toBeGreaterThan(0);
      const v = budgetViolations({ ...totals, tooling: 0 });
      expect(v.some((m) => m.startsWith("tooling:") && m.includes("stale"))).toBe(true);
    });
    it("the tooling aggregate discovers every supported executable source extension", () => {
      const dir = mkdtempSync(join(tmpdir(), "verin-tooling-budget-"));
      try {
        const names = [
          "a.ts",
          "b.tsx",
          "c.mts",
          "d.cts",
          "e.js",
          "f.jsx",
          "g.mjs",
          "h.cjs",
        ];
        for (const name of [...names, "ignored.txt"]) {
          writeFileSync(join(dir, name), "// source\n");
        }
        expect(
          toolingFiles(dir)
            .map((file) => relative(dir, file))
            .sort(),
        ).toEqual(names.sort());
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
