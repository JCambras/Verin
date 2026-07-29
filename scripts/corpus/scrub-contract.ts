import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "../../src/contracts/decision-core/serialization";
import { CONFLICT_FAMILIES } from "./conflict-keys";
import type { GeneratedFile } from "./generate";
import { REAL_DERIVED_DIR } from "./world";

export const REAL_DERIVED_PROVENANCE = "real-derived-fixture";
export const REAL_DERIVED_CASE_ID = /^RD-[0-9a-f]{16}$/;
export const OPAQUE_TOKEN = /^tok:[0-9a-f]{16}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EVIDENCE_KINDS = [
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
] as const;
const TOKEN_COMPONENT = "tok:[0-9a-f]{16}";
const alternatives = (values: readonly string[]): string => `(?:${values.join("|")})`;
const EVIDENCE_ID_PATTERN = new RegExp(
  `^evs:${TOKEN_COMPONENT}:${alternatives(EVIDENCE_KINDS)}$`,
);
const CONFLICT_KEY_PATTERN = new RegExp(
  `^conflict:${TOKEN_COMPONENT}:${alternatives(CONFLICT_FAMILIES)}$`,
);
const DERIVED_ID_PATTERNS = [
  EVIDENCE_ID_PATTERN,
  new RegExp(`^res:${TOKEN_COMPONENT}:${alternatives(CONFLICT_FAMILIES)}$`),
  new RegExp(`^idem:${TOKEN_COMPONENT}:external-submission$`),
  CONFLICT_KEY_PATTERN,
  new RegExp(`^(?:subject|bank-instruction|restriction|hold|pending|change):${TOKEN_COMPONENT}$`),
];
const isDerivedId = (value: string): boolean => DERIVED_ID_PATTERNS.some((pattern) => pattern.test(value));

export const CLOSED_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  partition: ["real-derived"],
  provenance: [REAL_DERIVED_PROVENANCE],
  kind: ["defect", "clean-control"],
  currency: ["USD"],
  freshness: ["fresh", "stale", "unknown"],
  family: CONFLICT_FAMILIES,
  evidenceKind: EVIDENCE_KINDS,
  sourceSystemClass: ["custodian-exception-feed", "crm-case-history", "operations-exception-log"],
  method: ["deterministic-tokenization", "field-suppression", "generalization"],
  controlRationaleId: ["no-defect-present", "defect-class-absent", "resolved-before-execution"],
};

export const ScrubAttestationSchema = z.strictObject({
  sourceSystemClass: z.enum(CLOSED_VOCABULARIES.sourceSystemClass as [string, ...string[]]),
  extractedAt: z.iso.datetime({ precision: 3 }),
  extractedBy: z.string().regex(OPAQUE_TOKEN),
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
        id: z.string().regex(EVIDENCE_ID_PATTERN),
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
      conflictKey: z.string().regex(CONFLICT_KEY_PATTERN),
    }),
  ),
});

const isClosedString = (key: string, value: string, defectClassIds: ReadonlySet<string>): boolean => {
  if (INSTANT.test(value) || OPAQUE_TOKEN.test(value) || isDerivedId(value)) return true;
  if (key === "defectClassId") return defectClassIds.has(value);
  if (key === "caseId") return REAL_DERIVED_CASE_ID.test(value);
  if (key === "corpusVersion") return /^\d{4}\.\d{2}\.\d+$/.test(value);
  return (CLOSED_VOCABULARIES[key] ?? []).includes(value);
};

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
  const chronology = [
    ["occurredAt", parsed.data.occurredAt],
    ["scrubAttestation.extractedAt", attestation.extractedAt],
    ["scrubAttestation.scrubbedAt", attestation.scrubbedAt],
    ["scrubAttestation.reviewedAt", attestation.reviewedAt],
  ] as const;
  for (let index = 1; index < chronology.length; index += 1) {
    const previous = chronology[index - 1]!;
    const current = chronology[index]!;
    if (previous[1] > current[1]) {
      problems.push(`${where}: ${previous[0]} must not postdate ${current[0]}`);
    }
  }
  const subjectCounts = new Map<string, number>();
  for (const subject of parsed.data.subjects) {
    subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
  }
  const evidenceIds = new Set<string>();
  for (const evidence of parsed.data.evidence) {
    const subjectCount = subjectCounts.get(evidence.subjectRef) ?? 0;
    if (subjectCount !== 1) {
      problems.push(
        `${where}: evidence ${evidence.id} subjectRef resolves to ${subjectCount} subjects, expected exactly one`,
      );
    }
    if (evidenceIds.has(evidence.id)) {
      problems.push(`${where}: duplicate evidence id "${evidence.id}"`);
    }
    evidenceIds.add(evidence.id);
    if (!evidence.id.endsWith(`:${evidence.evidenceKind}`)) {
      problems.push(`${where}: evidence ${evidence.id} does not match evidenceKind "${evidence.evidenceKind}"`);
    }
  }
  for (const reservation of parsed.data.reservations) {
    if (!reservation.conflictKey.endsWith(`:${reservation.family}`)) {
      problems.push(
        `${where}: conflictKey ${reservation.conflictKey} does not match family "${reservation.family}"`,
      );
    }
  }
  if (parsed.data.label.kind === "defect" && !defectClassIds.has(parsed.data.label.defectClassId)) {
    problems.push(`${where}: label.defectClassId "${parsed.data.label.defectClassId}" is not in the closed defect taxonomy`);
  }
  return problems;
}

export const readRealDerivedFiles = (dir: string = REAL_DERIVED_DIR): GeneratedFile[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => {
          const bytes = readFileSync(join(dir, name), "utf8");
          return {
            relPath: `real-derived/${name}`,
            bytes,
            value: JSON.parse(bytes) as JsonValue,
          };
        })
    : [];
