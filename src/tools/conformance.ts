// The evidence-retrieval conformance suite (prompt 3 deliverable 5, landed whole in PR-3b). There is
// deliberately no EvidenceSource port in this slice - one implementation exists - so this suite IS
// the future port's contract: prompt 9's real adapter must pass it unchanged, supplying its own
// EvidenceRetrieval. Evidence tooling under src/tools/, proven absent from the web bundle.
import { describe, expect, it } from "vitest";
import type { Deadline, EvidenceBundle, HouseholdRef, Instant } from "../evidence/bundle";
import { bundleDigest, serializeBundle } from "../evidence/bundle";
import { OBSERVATION_KINDS } from "../evidence/vocabulary";

type EvidenceRetrieval = {
  retrieve(subject: HouseholdRef, asOf: Instant, deadline: Deadline): Promise<EvidenceBundle>;
  /** A household every vocabulary kind has been observed for recently - the present case. */
  presentSubject(): Promise<HouseholdRef>;
  /** A household whose evidence has receded: at least one stale and one aging observation, and one subject observed twice in disagreement. */
  recededSubject(): Promise<HouseholdRef>;
  /** A household with no observations at all - the vacuity case. */
  absentSubject(): Promise<HouseholdRef>;
  /** Plant one observation carrying the given raw text OUTSIDE the guarded write path; returns the undo. */
  injectRawReference(subject: HouseholdRef, rawReference: string): Promise<() => Promise<void>>;
};

const DEADLINE: Deadline = { milliseconds: 2_000 };
const RAW_REFERENCE_FORMS: readonly (readonly [string, string])[] = [
  ["bare-account-reference", "48219930117455"],
  ["spaced-account-reference", "4821 9930 1174 5588"],
  ["hyphenated-account-reference", "4821-9930-1174-5588"],
];

function evidenceRetrievalConformance(label: string, source: EvidenceRetrieval) {
  describe(`evidence-retrieval conformance: ${label}`, () => {
    it("returns every observation typed whole: kind, subject, provenance pair, freshness and PII classification", async () => {
      const bundle = await source.retrieve(await source.presentSubject(), new Date().toISOString(), DEADLINE);
      expect(bundle.version).toBe("evb.v1");
      expect(bundle.observations.length).toBeGreaterThan(0);
      for (const o of bundle.observations) {
        expect(OBSERVATION_KINDS).toContain(o.kind);
        expect(o.subject.length).toBeGreaterThan(0);
        expect(o.provenance.source.length).toBeGreaterThan(0);
        expect(Date.parse(o.provenance.retrievedAt)).toBeGreaterThanOrEqual(Date.parse(o.provenance.observedAt));
        expect(["fresh", "aging", "stale"]).toContain(o.freshness);
        expect(["personal-identity", "masked-financial-reference"]).toContain(o.pii);
      }
      expect(bundle.absences).toEqual([]); // the present case: nothing missing, and nothing silently filled
    });
    it("measures freshness against the supplied asOf, never the observation's own clock", async () => {
      const subject = await source.presentSubject();
      const now = new Date().toISOString();
      const later = new Date(Date.parse(now) + 300 * 86_400_000).toISOString();
      const today = await source.retrieve(subject, now, DEADLINE);
      const receded = await source.retrieve(subject, later, DEADLINE);
      expect(today.observations.map((o) => o.freshness)).toEqual(today.observations.map(() => "fresh"));
      expect(receded.observations.map((o) => o.freshness)).toEqual(receded.observations.map(() => "stale"));
    });
    it("retrieves at the bundle's own instant: an observation recorded after asOf does not exist yet", async () => {
      const bundle = await source.retrieve(await source.presentSubject(), "2000-01-01T00:00:00.000Z", DEADLINE);
      expect(bundle.observations).toEqual([]); // nothing had been observed by that asOf - and nothing reads as freshly observed
      expect(bundle.absences.map((a) => a.kind)).toEqual([...OBSERVATION_KINDS]);
    });
    it("returns typed absence for a household with no observations - never an empty success that reads as fine", async () => {
      const bundle = await source.retrieve(await source.absentSubject(), new Date().toISOString(), DEADLINE);
      expect(bundle.observations).toEqual([]);
      expect(bundle.absences).toEqual(OBSERVATION_KINDS.map((kind) => ({ kind, status: "not-observed", reason: "no-observation-in-house-records" })));
    });
    it("carries the receded household's bands as computed against asOf: stale and aging both present", async () => {
      const bundle = await source.retrieve(await source.recededSubject(), new Date().toISOString(), DEADLINE);
      const bands = bundle.observations.map((o) => o.freshness);
      expect(bands).toContain("stale");
      expect(bands).toContain("aging");
    });
    it("retains BOTH sides of a disagreement as a typed conflict, never reconciled by recency", async () => {
      const bundle = await source.retrieve(await source.recededSubject(), new Date().toISOString(), DEADLINE);
      expect(bundle.conflicts.length).toBeGreaterThan(0);
      for (const conflict of bundle.conflicts) {
        expect(conflict.observationIds.length).toBeGreaterThanOrEqual(2);
        const sides = bundle.observations.filter((o) => conflict.observationIds.includes(o.id));
        expect(sides.length).toBe(conflict.observationIds.length); // every disagreeing observation survives into the bundle
        expect(new Set(sides.map((o) => JSON.stringify(o.body))).size).toBeGreaterThan(1); // they genuinely disagree
      }
    });
    it("serializes canonically: the same inputs give byte-identical evb.v1 bytes and one digest", async () => {
      const subject = await source.presentSubject();
      const asOf = new Date().toISOString();
      const first = await source.retrieve(subject, asOf, DEADLINE);
      const second = await source.retrieve(subject, asOf, DEADLINE);
      expect(serializeBundle(first).startsWith("evb.v1|")).toBe(true);
      expect(serializeBundle(second)).toBe(serializeBundle(first));
      expect(bundleDigest(second)).toBe(bundleDigest(first));
      expect(bundleDigest(first).startsWith("evb.v1:")).toBe(true);
    });
    it("refuses a raw account reference into the bundle in all three forms, naming the operation", async () => {
      const subject = await source.presentSubject();
      for (const [form, raw] of RAW_REFERENCE_FORMS) {
        const undo = await source.injectRawReference(subject, raw);
        try {
          await expect(source.retrieve(subject, new Date().toISOString(), DEADLINE)).rejects.toThrow(new RegExp(`evidence\\.assemble.*${form}`));
        } finally {
          await undo();
        }
      }
    });
    it("accepts no call without a usable deadline (stop condition 3)", async () => {
      const subject = await source.presentSubject();
      await expect(source.retrieve(subject, new Date().toISOString(), { milliseconds: 0 })).rejects.toThrow(/deadline/);
    });
  });
}

export type { EvidenceRetrieval };
export { evidenceRetrievalConformance };
