// The EvidenceBundle seam (prompt 3 section 4) - slice 3's one named contract seam. assemble() turns
// a household and a request into one canonical, provenance-complete bundle in which absence and
// conflict are typed values, read from the ONE evidence source through the governed runtime's
// admitted store operation; deliberately no EvidenceSource port until prompt 9 justifies a second
// implementation. asOf and the deadline are minted exactly once at the route boundary; nothing here
// reads a clock, which keeps the evb.v1 bytes identical across process time zones. DC-5:
// observedAt/retrievedAt, its no-inverted-interval rule and recorded freshness vocabulary port from
// main:src/contracts/decision-core/evidence.ts:44-47,51-90.
import { createHash } from "node:crypto";
import { z } from "zod";
import { getGateway, type RequestCorrelation } from "../runtime/governed";
import type { ActionGrant } from "../access/context";
import { refuseAccountReferences, type PIIBearing } from "./pii";
import * as vocab from "./vocabulary";
import type { AbsenceReason, FreshnessBand, ObservationKind, ObservationOrigin } from "./vocabulary";
import { KIND_LABELS, formatObservationDate } from "./projection";

type Instant = string; // ISO-8601 UTC, minted at the route boundary from the process clock
type Deadline = { readonly milliseconds: number };
type HouseholdRef = { readonly householdId: string };
// Every identifier INSIDE the bundle is letter-prefixed unbroken hex (the runtime's idiom,
// src/runtime/governed.ts:26): a stored uuid whose middle groups are all digits would false-fire the
// hyphenated form on ~0.5 percent of mints - the GD-003 flake class - and the ruled exclusion may not widen.
const safeId = (prefix: string, uuid: string) => `${prefix}${uuid.replaceAll("-", "")}`;
interface EvidenceObservation extends PIIBearing {
  readonly id: string;
  readonly kind: ObservationKind;
  readonly subject: string;
  readonly body: Readonly<Record<string, string>>;
  readonly provenance: { readonly source: string; readonly observedAt: Instant; readonly retrievedAt: Instant };
  readonly freshness: FreshnessBand;
  readonly pii: (typeof vocab.KIND_PII_CLASS)[ObservationKind];
  readonly origin: ObservationOrigin;
}
type TypedAbsence = { readonly kind: ObservationKind; readonly status: "not-observed"; readonly reason: AbsenceReason };
type TypedConflict = { readonly kind: ObservationKind; readonly subject: string; readonly observationIds: readonly string[] };
interface EvidenceBundle extends PIIBearing {
  readonly version: "evb.v1";
  readonly vocabulary: typeof vocab.OBSERVATION_VOCABULARY_VERSION;
  readonly subject: { readonly household: string };
  readonly asOf: Instant;
  readonly source: typeof vocab.EVIDENCE_SOURCE;
  readonly observations: readonly EvidenceObservation[];
  readonly absences: readonly TypedAbsence[];
  readonly conflicts: readonly TypedConflict[];
}

const str = z.string();
const observationRow = z.strictObject({ id: str, kind: str, subject: str, body_json: z.record(str, str), source: str, observed_at: z.date(), retrieved_at: z.date(), record_origin: str });
// A value the product cannot render cannot be produced: stored vocabulary is validated on the way in.
const inVocabulary = <const T extends readonly string[]>(list: T, value: string, what: string): T[number] => {
  if (!(list as readonly string[]).includes(value)) throw new Error(`evidence.assemble refuses ${what} '${value}' outside the closed vocabulary ${vocab.OBSERVATION_VOCABULARY_VERSION}`);
  return value as T[number];
};

async function assembleEvidence(c: RequestCorrelation, grant: ActionGrant, subject: HouseholdRef, asOf: Instant, deadline: Deadline): Promise<EvidenceBundle> {
  const gw = getGateway();
  return gw.enterEvidenceAssemble(c, async () => {
    if (!Number.isInteger(deadline?.milliseconds) || deadline.milliseconds <= 0) throw new Error("evidence.assemble accepts no call without a usable deadline; the route boundary mints it (stop 3)");
    if (!z.uuid().safeParse(subject?.householdId).success) throw new Error("evidence.assemble refuses a malformed household reference before any store work");
    const raw = await gw.enterObservationListForHousehold(c, { orgId: grant.principal.tenant.orgId, householdId: subject.householdId, statementTimeoutMs: String(deadline.milliseconds) });
    const observations = z
      .array(observationRow)
      .parse(raw)
      .map((row): EvidenceObservation => {
        const kind = inVocabulary(vocab.OBSERVATION_KINDS, row.kind, "an observation kind");
        if (row.retrieved_at.getTime() < row.observed_at.getTime()) throw new Error(`evidence.assemble refuses observation '${safeId("o", row.id)}': retrieval cannot precede observation`);
        return {
          id: safeId("o", row.id),
          kind,
          subject: row.subject,
          body: row.body_json,
          provenance: { source: row.source, observedAt: row.observed_at.toISOString(), retrievedAt: row.retrieved_at.toISOString() },
          freshness: vocab.freshnessBand(asOf, row.observed_at.toISOString()),
          pii: vocab.KIND_PII_CLASS[kind],
          origin: inVocabulary(vocab.OBSERVATION_ORIGINS, row.record_origin, "an observation origin"),
        };
      });
    const bySubject = new Map<string, EvidenceObservation[]>();
    for (const o of observations) bySubject.set(`${o.kind} ${o.subject}`, [...(bySubject.get(`${o.kind} ${o.subject}`) ?? []), o]);
    const conflicts: TypedConflict[] = [...bySubject.values()]
      .filter((group) => new Set(group.map((o) => canonical(o.body))).size > 1)
      .map((group) => ({ kind: group[0].kind, subject: group[0].subject, observationIds: group.map((o) => o.id).sort() }));
    const seen = new Set(observations.map((o) => o.kind));
    const absences = vocab.OBSERVATION_KINDS.filter((k) => !seen.has(k)).map((kind): TypedAbsence => ({ kind, status: "not-observed", reason: "no-observation-in-house-records" }));
    const bundle: EvidenceBundle = {
      version: "evb.v1",
      vocabulary: "1.0.0",
      subject: { household: safeId("h", subject.householdId) },
      asOf,
      source: "house-record-store",
      observations,
      absences,
      conflicts,
    };
    refuseAccountReferences(bundle, { operation: "evidence.assemble", boundary: "bundle" });
    return bundle;
  });
}

// Canonical bytes: sorted keys, closed scalar set, no clock, locale or environment reachable -
// versioned from the first byte because prompt 6 will hash exactly these bytes into an immutable
// record (the checker's own semfx.v1 precedent, enforcement/rules-e16.mjs:50).
function canonical(x: unknown): string {
  if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",") + "}";
  }
  throw new Error(`the canonical serializer refuses open data (${typeof x}); the bundle is a closed value`);
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function serializeBundle(bundle: EvidenceBundle): string {
  const ordered = {
    ...bundle,
    observations: [...bundle.observations].sort((x, y) => cmp(x.id, y.id)),
    absences: [...bundle.absences].sort((x, y) => cmp(x.kind, y.kind)),
    conflicts: [...bundle.conflicts].sort((x, y) => cmp(`${x.kind} ${x.subject}`, `${y.kind} ${y.subject}`)),
  };
  const bytes = "evb.v1|" + canonical(ordered);
  refuseAccountReferences(bytes, { operation: "evidence.assemble", boundary: "serialization" });
  return bytes;
}
const bundleDigest = (bundle: EvidenceBundle): string => "evb.v1:" + createHash("sha256").update(serializeBundle(bundle)).digest("hex");

type RenderableItem = { id: string; label: string; entries: [string, string][]; provenanceLine: string; band: FreshnessBand; demonstration: boolean };
type RenderableEvidence = { assembledLine: string; items: RenderableItem[]; absent: string[] };
// The render boundary: the surface renders THIS view model and nothing else from the bundle, so the
// same detector that guards the bundle guards every rendered string.
function renderableBundle(bundle: EvidenceBundle): RenderableEvidence {
  const view: RenderableEvidence = {
    assembledLine: `Assembled from the house record store as of ${formatObservationDate(bundle.asOf)}`,
    items: bundle.observations.map((o) => ({
      id: o.id,
      label: KIND_LABELS[o.kind],
      entries: Object.entries(o.body),
      provenanceLine: `House record store · observed ${formatObservationDate(o.provenance.observedAt)} · retrieved ${formatObservationDate(o.provenance.retrievedAt)} · ${o.freshness}`,
      band: o.freshness,
      demonstration: o.origin === "demo-seed",
    })),
    absent: bundle.absences.map((a) => KIND_LABELS[a.kind]),
  };
  refuseAccountReferences(view, { operation: "evidence.assemble", boundary: "render" });
  return view;
}

export type { EvidenceBundle, EvidenceObservation, TypedAbsence, TypedConflict, HouseholdRef, Instant, Deadline, RenderableEvidence };
export { assembleEvidence, serializeBundle, bundleDigest, renderableBundle };
