/**
 * REAL-DERIVED INTAKE CONTRACT (v3 prompt 11, ADR-0034; captain ruling
 * `corpus-real-derived-provenance`, 2026-07-28).
 *
 * The real-derived partition ships EMPTY and this file is the pipeline that
 * stands ready for it. Two rules make a scrubbing miss impossible to hide:
 *
 *  1. ATTESTATION REQUIRED. Every real-derived case carries who extracted it,
 *     who scrubbed it, who reviewed it, when, by what method, and how many
 *     records went in and came out.
 *  2. CLOSED VOCABULARY ONLY. A real-derived case may contain NO free text at
 *     all - every string is a canonical instant, an opaque token, a derived id
 *     built from tokens, or a member of a declared closed vocabulary. An unknown
 *     string fails by default, so the contract is fail-CLOSED: a field nobody
 *     anticipated is rejected rather than waved through.
 *
 * Nothing here invents defect history. The validator runs over the empty
 * partition in CI and its companion drives it with synthetic violating cases,
 * which is what makes a shipped-but-unpopulated capability charter-#5-legal.
 */
import { z } from "zod";
import { CONFLICT_FAMILIES } from "./conflict-keys";

export const REAL_DERIVED_PROVENANCE = "real-derived-fixture";
export const REAL_DERIVED_CASE_ID = /^RD-[0-9a-f]{16}$/;
export const OPAQUE_TOKEN = /^tok:[0-9a-f]{16}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DERIVED_ID = /^(evs|res|idem|conflict|subject|bank-instruction|restriction|hold|pending|change):[a-z0-9:_-]+$/;

/** Closed vocabularies, keyed by the JSON property the value appears under. */
export const CLOSED_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  partition: ["real-derived"],
  provenance: [REAL_DERIVED_PROVENANCE],
  kind: ["defect", "clean-control"],
  currency: ["USD"],
  freshness: ["fresh", "stale", "unknown"],
  family: CONFLICT_FAMILIES,
  evidenceKind: [
    "balance",
    "bank-instruction",
    "household-instruction",
    "planned-withdrawals",
    "pending-actions",
    "restriction",
    "authority",
    "model-assignment",
    "legal-hold",
    "recent-change",
  ],
  sourceSystemClass: ["custodian-exception-feed", "crm-case-history", "operations-exception-log"],
  method: ["deterministic-tokenization", "field-suppression", "generalization"],
  controlRationaleId: ["no-defect-present", "defect-class-absent", "resolved-before-execution"],
};

export const ScrubAttestationSchema = z.strictObject({
  sourceSystemClass: z.enum(CLOSED_VOCABULARIES.sourceSystemClass as [string, ...string[]]),
  extractedAt: z.iso.datetime({ precision: 3 }),
  scrubbedBy: z.string().regex(OPAQUE_TOKEN),
  scrubbedAt: z.iso.datetime({ precision: 3 }),
  reviewedBy: z.string().regex(OPAQUE_TOKEN),
  reviewedAt: z.iso.datetime({ precision: 3 }),
  recordsBefore: z.int().positive(),
  recordsAfter: z.int().positive(),
  method: z.enum(CLOSED_VOCABULARIES.method as [string, ...string[]]),
});

export const RealDerivedCaseSchema = z.strictObject({
  caseId: z.string().regex(REAL_DERIVED_CASE_ID),
  corpusVersion: z.string().min(1),
  partition: z.literal("real-derived"),
  provenance: z.literal(REAL_DERIVED_PROVENANCE),
  scrubAttestation: ScrubAttestationSchema,
  label: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("defect"), defectClassId: z.string().min(1) }),
    z.strictObject({
      kind: z.literal("clean-control"),
      controlRationaleId: z.enum(CLOSED_VOCABULARIES.controlRationaleId as [string, ...string[]]),
    }),
  ]),
  occurredAt: z.iso.datetime({ precision: 3 }),
  subjects: z.array(z.string().regex(OPAQUE_TOKEN)).min(1),
  evidence: z
    .array(
      z.strictObject({
        id: z.string().regex(DERIVED_ID),
        evidenceKind: z.enum(CLOSED_VOCABULARIES.evidenceKind as [string, ...string[]]),
        subjectRef: z.string().regex(OPAQUE_TOKEN),
        observedAt: z.iso.datetime({ precision: 3 }),
        retrievedAt: z.iso.datetime({ precision: 3 }),
        freshness: z.enum(CLOSED_VOCABULARIES.freshness as [string, ...string[]]),
      }),
    )
    .min(1),
  reservations: z.array(
    z.strictObject({
      family: z.enum(CONFLICT_FAMILIES as unknown as [string, ...string[]]),
      conflictKey: z.string().regex(DERIVED_ID),
    }),
  ),
});

const isClosedString = (key: string, value: string, defectClassIds: ReadonlySet<string>): boolean => {
  if (INSTANT.test(value) || OPAQUE_TOKEN.test(value) || DERIVED_ID.test(value)) return true;
  if (key === "defectClassId") return defectClassIds.has(value);
  if (key === "caseId") return REAL_DERIVED_CASE_ID.test(value);
  if (key === "corpusVersion") return /^\d{4}\.\d{2}\.\d+$/.test(value);
  return (CLOSED_VOCABULARIES[key] ?? []).includes(value);
};

/**
 * Fail-closed free-text scan. Every string in the document must satisfy a
 * declared closed form; anything else is reported with its path, so a scrubbing
 * miss has nowhere to live.
 */
export function freeTextViolations(value: unknown, defectClassIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string, key: string): void => {
    if (typeof node === "string") {
      if (!isClosedString(key, node, defectClassIds)) {
        problems.push(`${path}: "${node}" is not a closed-vocabulary value, an opaque token, a derived id, or an instant`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [childKey, child] of Object.entries(node)) {
        walk(child, path === "" ? childKey : `${path}.${childKey}`, childKey);
      }
    }
  };
  walk(value, "", "");
  return problems;
}

/** The whole intake contract for ONE case: attestation, shape, and no free text. */
export function realDerivedCaseProblems(
  value: unknown,
  defectClassIds: ReadonlySet<string>,
  where: string,
): string[] {
  const parsed = RealDerivedCaseSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `${where}: ${issue.path.join(".") || "(root)"} - ${issue.message}`,
    );
  }
  const attestation = parsed.data.scrubAttestation;
  const problems = freeTextViolations(parsed.data, defectClassIds).map((problem) => `${where}: ${problem}`);
  if (attestation.recordsAfter > attestation.recordsBefore) {
    problems.push(`${where}: scrubAttestation.recordsAfter exceeds recordsBefore - scrubbing cannot add records`);
  }
  if (attestation.scrubbedBy === attestation.reviewedBy) {
    problems.push(`${where}: scrubAttestation.reviewedBy must differ from scrubbedBy - review is a second pair of eyes`);
  }
  if (!defectClassIds.has(parsed.data.label.kind === "defect" ? parsed.data.label.defectClassId : "")) {
    if (parsed.data.label.kind === "defect") {
      problems.push(`${where}: label.defectClassId "${parsed.data.label.defectClassId}" is not in the closed defect taxonomy`);
    }
  }
  return problems;
}
