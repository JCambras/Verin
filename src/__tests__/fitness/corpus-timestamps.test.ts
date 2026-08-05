import { describe, it, expect } from "vitest";
import {
  addBusinessDays,
  deriveFreshness,
  isLocalWeekend,
  isWithinRecentChangeWindow,
  localOffsetMinutes,
  renderLocal,
} from "../../../scripts/corpus/clock";
import { timestampProblems, validateCorpus } from "../../../scripts/corpus/validate";
import { WorldSpecSchema } from "../../../scripts/corpus/world";

/**
 * CORPUS-TIMESTAMPS FENCE (v3 prompt 11, ADR-0034; charter #1/#4).
 *
 * "Realistic observed and retrieved timestamps" is decorative unless it has a
 * machine meaning. Six checkable rules, applied to every corpus case:
 *
 *  1. ORDERING - `observedAt` strictly precedes `retrievedAt`, and nothing is
 *     observed after the trigger (evidence cannot observe the future);
 *  2. REQUEST CHRONOLOGY - retrieval happens after the trigger, inside the
 *     committed per-kind band;
 *  3. LATENCY BAND - a zero or out-of-band lag fails. This catches the
 *     "every timestamp is the same second" tell of an invented fixture;
 *  4. FRESHNESS IS DERIVED - recomputed from (asOf - observedAt) against the
 *     per-kind window and compared to what was emitted. `EvidenceFreshness`
 *     RECORDS freshness because the contracts layer has no threshold policy; the
 *     corpus has one, so it never trusts the label;
 *  5. RECENT-CHANGE WINDOW - membership is recomputed against the firm window,
 *     from `recordChangedAt` (when the FACT changed) rather than `observedAt`
 *     (when the source looked). Deriving one from the other is what made every
 *     long-standing fact stale before D-078, and `recordChangedAt` may never
 *     postdate the observation that reports it;
 *  6. BUSINESS-DAY AND DST REALISM - "two business days later" lands on a real
 *     weekday in the firm's zone, and local renderings come from pinned tz
 *     transitions.
 *
 * Rule 6 is checked against the PLATFORM TIME-ZONE DATABASE as an independent
 * oracle. The generator may not touch `Intl` (the determinism fence bans it), so
 * this fence is where a wrong committed transition or a hardcoded `-04:00` dies.
 */
const real = validateCorpus();
const clock = real.spec.world.clock;

/** The oracle: ICU's offset for an instant, in minutes to add to UTC. */
function icuOffsetMinutes(instant: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(
    new Date(instant),
  );
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

const clone = (): typeof real.cases => JSON.parse(JSON.stringify(real.cases)) as typeof real.cases;

describe("corpus-timestamps fence", () => {
  it("enforces: every corpus case satisfies all six timestamp-realism rules", () => {
    const problems = timestampProblems(real.cases, real.spec);
    expect(problems, `timestamp problems:\n${problems.join("\n")}`).toEqual([]);
    expect(real.cases.length).toBeGreaterThan(0);
    expect(real.cases.flatMap((item) => item.evidence).length).toBeGreaterThan(real.cases.length);
  });

  it("enforces: every committed tz transition matches the platform time-zone database", () => {
    const mismatches: string[] = [];
    for (const transition of clock.transitions) {
      const atOracle = icuOffsetMinutes(transition.at, clock.timeZone);
      if (atOracle !== transition.offsetMinutes) {
        mismatches.push(`${transition.at}: spec ${transition.offsetMinutes} vs tzdb ${atOracle}`);
      }
      const justBefore = new Date(new Date(transition.at).getTime() - 1).toISOString();
      if (icuOffsetMinutes(justBefore, clock.timeZone) === atOracle) {
        mismatches.push(`${transition.at}: no offset change occurs here - this is not a real transition`);
      }
    }
    expect(mismatches, `time-zone transitions drifted from the tz database:\n${mismatches.join("\n")}`).toEqual([]);
    expect(clock.transitions.length).toBeGreaterThanOrEqual(4);
  });

  it("enforces: every emitted local rendering agrees with the platform time-zone database", () => {
    const mismatches: string[] = [];
    const check = (instant: string, rendered: string, where: string): void => {
      const expected = icuOffsetMinutes(instant, clock.timeZone);
      const sign = rendered.slice(23, 24);
      const offset = (sign === "-" ? -1 : 1) * (Number(rendered.slice(24, 26)) * 60 + Number(rendered.slice(27, 29)));
      if (offset !== expected) mismatches.push(`${where}: rendered ${rendered.slice(23)} but tzdb says ${expected} minutes`);
    };
    for (const item of real.cases) {
      check(item.trigger.asOf, item.trigger.asOfLocal, `${item.caseId}.trigger`);
      for (const evidence of item.evidence) {
        const at = `${item.caseId}/${evidence.id}`;
        check(evidence.recordChangedAt, evidence.recordChangedAtLocal, `${at}.recordChangedAt`);
        check(evidence.observedAt, evidence.observedAtLocal, `${at}.observedAt`);
        check(evidence.retrievedAt, evidence.retrievedAtLocal, `${at}.retrievedAt`);
      }
    }
    expect(mismatches, `local renderings drifted from the tz database:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("enforces: the corpus actually straddles a DST boundary (both offsets appear)", () => {
    // The BUSINESS instants are what reach back across a transition: observation
    // instants are all recent by construction (a freshly synced record is the
    // normal case), so a straddle asserted over them alone would be vacuous.
    const offsets = new Set(
      real.cases.flatMap((item) =>
        item.evidence.flatMap((e) => [e.recordChangedAtLocal.slice(23), e.observedAtLocal.slice(23)]),
      ),
    );
    expect(offsets, `a corpus rendered entirely at one offset cannot falsify a fixed-offset generator`).toContain("-05:00");
    expect(offsets).toContain("-04:00");
  });

  it("enforces: the settlement horizon never lands on a local weekend", () => {
    for (const item of real.cases) {
      expect(isLocalWeekend(item.request.settlementEarliest, clock.transitions)).toBe(false);
    }
  });
});

describe("detects (companion): unrealistic or mislabeled timestamps CANNOT pass", () => {
  const firstEvidence = (cases: typeof real.cases) => cases[0]!.evidence[0]!;

  it("flags retrievedAt preceding observedAt", () => {
    const broken = clone();
    firstEvidence(broken).retrievedAt = "2020-01-01T00:00:00.000Z";
    const problems = timestampProblems(broken, real.spec);
    expect(problems.some((p) => p.includes("retrievedAt does not follow observedAt"))).toBe(true);
  });

  it("flags evidence observed AFTER the trigger", () => {
    const broken = clone();
    firstEvidence(broken).observedAt = "2027-01-01T00:00:00.000Z";
    expect(
      timestampProblems(broken, real.spec).some((p) => p.includes("evidence cannot observe the future")),
    ).toBe(true);
  });

  it("flags ZERO retrieval latency (the 'all timestamps are the same second' tell)", () => {
    const broken = clone();
    const evidence = firstEvidence(broken);
    evidence.retrievedAt = broken[0]!.trigger.asOf;
    evidence.retrievalLagSeconds = 0;
    const problems = timestampProblems(broken, real.spec);
    expect(problems.some((p) => p.includes("outside the committed"))).toBe(true);
  });

  it("flags a retrieval lag outside the committed per-kind band", () => {
    const broken = clone();
    const evidence = firstEvidence(broken);
    evidence.retrievedAt = "2026-07-26T14:30:00.000Z";
    evidence.retrievalLagSeconds = 3600;
    expect(timestampProblems(broken, real.spec).some((p) => p.includes("outside the committed"))).toBe(true);
  });

  it("flags a retrievalLagSeconds that disagrees with the emitted timestamps", () => {
    const broken = clone();
    firstEvidence(broken).retrievalLagSeconds += 1;
    expect(
      timestampProblems(broken, real.spec).some((p) => p.includes("disagrees with the emitted timestamps")),
    ).toBe(true);
  });

  it("flags a 'fresh' label on evidence beyond its window (the GC-09 hole)", () => {
    const broken = clone();
    const stale = broken
      .flatMap((item) => item.evidence)
      .find((evidence) => evidence.freshness === "stale");
    expect(stale, "the corpus must contain at least one genuinely stale item").toBeDefined();
    stale!.freshness = "fresh";
    expect(timestampProblems(broken, real.spec).some((p) => p.includes('freshness "fresh"'))).toBe(true);
  });

  it("flags a change claimed 'recent' that sits outside the firm window", () => {
    const broken = clone();
    const outside = broken
      .flatMap((item) => item.evidence)
      .find((evidence) => evidence.withinRecentChangeWindow === false);
    expect(outside, "the corpus must contain at least one change outside the recent window").toBeDefined();
    outside!.withinRecentChangeWindow = true;
    expect(
      timestampProblems(broken, real.spec).some((p) => p.includes("withinRecentChangeWindow disagrees")),
    ).toBe(true);
  });

  it("flags a DST-boundary instant rendered with a FIXED -04:00 offset", () => {
    const broken = clone();
    const winter = broken
      .flatMap((item) => item.evidence)
      .find((evidence) => evidence.recordChangedAtLocal.endsWith("-05:00"));
    expect(winter, "the corpus must contain a standard-time business instant").toBeDefined();
    winter!.recordChangedAtLocal = `${winter!.recordChangedAtLocal.slice(0, 23)}-04:00`;
    expect(
      timestampProblems(broken, real.spec).some((p) => p.includes("recordChangedAtLocal does not match")),
    ).toBe(true);
  });

  it("flags an observation instant BACKDATED to its record's business date (the staleness artifact)", () => {
    // The pre-D-078 model derived `observedAt` from a business date, which made
    // every long-standing fact stale. Rewinding one observation is that model in
    // one line - and it is refused, because retrieval lag is measured from the
    // trigger while freshness is measured from the observation.
    const broken = clone();
    const evidence = broken
      .flatMap((item) => item.evidence)
      .find((e) => e.recordChangedAt !== e.observedAt);
    expect(evidence, "the corpus must separate at least one business date from its observation").toBeDefined();
    evidence!.observedAt = evidence!.recordChangedAt;
    const problems = timestampProblems(broken, real.spec);
    expect(problems.some((p) => p.includes("observedAtLocal does not match") || p.includes('freshness "'))).toBe(true);
  });

  it("flags a settlement horizon landing on a weekend", () => {
    const broken = clone();
    // 2026-08-01 is a Saturday in America/New_York.
    broken[0]!.request.settlementEarliest = "2026-08-01T14:00:00.000Z";
    expect(timestampProblems(broken, real.spec).some((p) => p.includes("lands on a weekend"))).toBe(true);
  });

  it("flags a deadlineFeasible flag that contradicts its own dates", () => {
    const broken = clone();
    broken[0]!.request.deadlineFeasible = !broken[0]!.request.deadlineFeasible;
    expect(timestampProblems(broken, real.spec).some((p) => p.includes("deadlineFeasible is"))).toBe(true);
  });

  it("business-day arithmetic skips local weekends, and freshness/window helpers are not constants", () => {
    // Friday 2026-07-24T14:00Z -> +2 business days must be Tuesday, not Sunday.
    const twoDays = addBusinessDays("2026-07-24T14:00:00.000Z", 2, clock.transitions);
    expect(isLocalWeekend(twoDays, clock.transitions)).toBe(false);
    expect(twoDays).toBe("2026-07-28T14:00:00.000Z");
    const timing = { minRetrievalLagSeconds: 1, maxRetrievalLagSeconds: 2, freshnessWindowDays: 30 };
    expect(deriveFreshness(clock.asOf, "2026-07-25T13:30:00.000Z", timing)).toBe("fresh");
    expect(deriveFreshness(clock.asOf, "2026-06-01T13:30:00.000Z", timing)).toBe("stale");
    expect(isWithinRecentChangeWindow(clock.asOf, "2026-07-22T13:30:00.000Z", 7)).toBe(true);
    expect(isWithinRecentChangeWindow(clock.asOf, "2026-06-22T13:30:00.000Z", 7)).toBe(false);
  });

  it("an instant outside the pinned transition table is REFUSED, never defaulted to standard time", () => {
    expect(() => localOffsetMinutes("1999-01-01T00:00:00.000Z", clock.transitions)).toThrow(
      /no pinned time-zone transition covers/,
    );
    expect(renderLocal(clock.asOf, clock.transitions)).toMatch(/^2026-07-26T09:30:00\.000-04:00$/);
  });

  it("transition lookup is order-independent and the world requires canonical chronological input", () => {
    const distinctOffsets = [
      { at: "2026-01-01T00:00:00.000Z", offsetMinutes: -300 },
      { at: "2026-03-08T07:00:00.000Z", offsetMinutes: -240 },
      { at: "2026-11-01T06:00:00.000Z", offsetMinutes: -300 },
    ];
    expect(
      localOffsetMinutes("2026-07-01T00:00:00.000Z", [...distinctOffsets].reverse()),
    ).toBe(-240);
    const descending = structuredClone(real.spec.world);
    descending.clock.transitions.reverse();
    expect(WorldSpecSchema.safeParse(descending).success).toBe(false);
    const duplicate = structuredClone(real.spec.world);
    duplicate.clock.transitions.push(
      structuredClone(duplicate.clock.transitions[0]!),
    );
    expect(WorldSpecSchema.safeParse(duplicate).success).toBe(false);
  });

  it("effective intervals must be ordered for restrictions and authorized signers", () => {
    const restriction = structuredClone(real.spec.world);
    restriction.restrictions[0]!.effectiveTo = "2025-01-01T00:00:00.000Z";
    expect(WorldSpecSchema.safeParse(restriction).success).toBe(false);

    const signer = structuredClone(real.spec.world);
    signer.authorizedSigners[0]!.effectiveTo = "2025-01-01T00:00:00.000Z";
    expect(WorldSpecSchema.safeParse(signer).success).toBe(false);
  });

  it("bank verification follows the current instruction change and source observation", () => {
    const beforeChange = structuredClone(real.spec.world);
    beforeChange.bankInstructions[0]!.verifiedAt =
      "2026-07-20T00:00:00.000Z";
    expect(WorldSpecSchema.safeParse(beforeChange).success).toBe(false);

    const afterObservation = structuredClone(real.spec.world);
    afterObservation.bankInstructions[0]!.verifiedAt =
      "2026-07-27T00:00:00.000Z";
    expect(WorldSpecSchema.safeParse(afterObservation).success).toBe(false);
  });

  it("withdrawal schedules require valid, strictly increasing months", () => {
    const descending = structuredClone(real.spec.world);
    descending.plannedWithdrawals[0]!.segments.reverse();
    expect(WorldSpecSchema.safeParse(descending).success).toBe(false);

    const duplicateMonth = structuredClone(real.spec.world);
    duplicateMonth.plannedWithdrawals[0]!.segments[1]!.fromMonth =
      duplicateMonth.plannedWithdrawals[0]!.segments[0]!.fromMonth;
    expect(WorldSpecSchema.safeParse(duplicateMonth).success).toBe(false);

    const invalidMonth = structuredClone(real.spec.world);
    invalidMonth.plannedWithdrawals[0]!.segments[0]!.fromMonth = "2026-13";
    expect(WorldSpecSchema.safeParse(invalidMonth).success).toBe(false);
  });
});
