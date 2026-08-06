/**
 * The captain-signed golden cases the setup surface projects from.
 *
 * The fixtures are read at RUNTIME from `fixtures/golden` (the same bytes
 * `pnpm golden:validate` checks - there is no second, bundled copy that could
 * drift). Two rules govern that read: it never runs at module init, and it is
 * never anchored on `process.cwd()`. The directory is found by walking up from
 * this module, and every failure - missing directory, unreadable file, malformed
 * JSON, a case that is not captain-signed - becomes a TYPED failure the surface
 * renders fail-closed. A demo route may not die with a raw `fs` error.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SetupFirmId } from "./setup-model";
import type { SetupPolicyEvidence } from "./setup-policy";

export interface GoldenEvidence {
  readonly evidenceKind: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly source: string;
  readonly provenance: string;
  readonly summary: string;
}

interface GoldenFirmConfiguration {
  readonly firmId: SetupFirmId;
  readonly cashReserveMonths: number;
  readonly dualApprovalThresholdUsd: number;
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly eligibleRole: "operations" | null;
  readonly requesterConstraint:
    | "may-not-satisfy-both-approvals"
    | null;
  readonly bankInstructionChangeHandling:
    | "specialist-review"
    | "block-until-independently-verified";
}

interface GoldenAuthorityStage {
  readonly stageId: string;
  readonly order: number;
  readonly executionMode: string;
  readonly eligibleRoleIds: readonly string[];
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  /** Golden fixtures state a boolean. `"unbound"` is the demo's third state, so a
   * case that leaves requester participation unbound can say so rather than being
   * forced to claim an exclusion the captain never signed. */
  readonly requesterMayApprove: boolean | "unbound";
  readonly expiresAfter: string;
  readonly escalationPath: readonly {
    readonly after: string;
    readonly roleIds: readonly string[];
    readonly reasonCode: string;
  }[];
}

interface GoldenExpectedAuthority {
  readonly mode:
    | "automatic"
    | "approval"
    | "specialist_review"
    | "none";
  readonly stages: readonly GoldenAuthorityStage[];
  readonly note: string;
}

export interface SignedSetupCase {
  readonly caseId: string;
  readonly scenarioRef: string | null;
  readonly firm: SetupFirmId;
  readonly trigger: {
    readonly kind: string;
    readonly description: string;
    readonly requesterRole: string;
    readonly requestRef: string;
    readonly maskedRequestSummary: string;
    readonly asOf: string;
  };
  readonly firmConfiguration: GoldenFirmConfiguration;
  readonly householdEvidence: readonly GoldenEvidence[];
  readonly policyVersions: {
    readonly domainConfigVersionId: string;
    readonly firmPolicyVersionId: string;
    readonly householdInstructionVersionIds:
      readonly string[];
    readonly regulatoryVersionId: string | null;
  };
  readonly expectedDisposition:
    | "proceed"
    | "blocked"
    | "prohibited";
  readonly expectedAuthority: GoldenExpectedAuthority;
  readonly signoff: {
    readonly status: string;
    readonly authority: string;
  };
}

// ── The guarded fixture read ────────────────────────────────────────────────────────
const GOLDEN_RELATIVE_DIR = join("fixtures", "golden");
/** How far above this module the repository/app root may sit. Deep enough for a
 * bundled server chunk, bounded so a missing directory ends the walk rather than
 * climbing to the filesystem root. */
const MAX_ROOT_SEARCH_DEPTH = 12;

function resolveGoldenDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth <= MAX_ROOT_SEARCH_DEPTH; depth += 1) {
    const candidate = join(dir, GOLDEN_RELATIVE_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidCase(expectedCaseId: string): Error {
  return new Error(
    `${expectedCaseId} is not a valid captain-signed setup case`,
  );
}

/**
 * Prove the fields this module DEREFERENCES exist and carry the shape it reads,
 * before any dereference. A malformed fixture must produce the named failure
 * above, never an undefined-property throw from deep inside a builder. Exported so
 * the fence can feed it broken fixtures and prove they cannot pass (charter #4).
 */
export function parseSignedSetupCase(
  value: unknown,
  expectedCaseId: string,
  expectedFirm: SetupFirmId,
): SignedSetupCase {
  if (!isRecord(value)) throw invalidCase(expectedCaseId);
  const signoff = value.signoff;
  const trigger = value.trigger;
  const firmConfiguration = value.firmConfiguration;
  const policyVersions = value.policyVersions;
  const expectedAuthority = value.expectedAuthority;
  if (
    value.caseId !== expectedCaseId ||
    value.firm !== expectedFirm ||
    !isRecord(signoff) ||
    signoff.status !== "signed" ||
    signoff.authority !== "captain" ||
    !isRecord(trigger) ||
    typeof trigger.asOf !== "string" ||
    typeof trigger.maskedRequestSummary !== "string" ||
    !isRecord(firmConfiguration) ||
    typeof firmConfiguration.cashReserveMonths !== "number" ||
    typeof firmConfiguration.dualApprovalThresholdUsd !== "number" ||
    typeof firmConfiguration.bankInstructionChangeHandling !== "string" ||
    !isRecord(policyVersions) ||
    !Array.isArray(policyVersions.householdInstructionVersionIds) ||
    !isRecord(expectedAuthority) ||
    typeof expectedAuthority.mode !== "string" ||
    !Array.isArray(expectedAuthority.stages) ||
    typeof value.expectedDisposition !== "string" ||
    !Array.isArray(value.householdEvidence) ||
    value.householdEvidence.some(
      (datum) => !isRecord(datum) || typeof datum.summary !== "string",
    )
  ) {
    throw invalidCase(expectedCaseId);
  }
  return value as unknown as SignedSetupCase;
}

const REQUIRED_CASES = {
  happyA: ["GC-01-firm-a-happy-path", "firm-a"],
  happyB: ["GC-02-firm-b-happy-path", "firm-b"],
  recentA: ["GC-03-recent-bank-change-firm-a", "firm-a"],
  recentB: ["GC-04-recent-bank-change-firm-b", "firm-b"],
  lowHeadroomB: ["GC-05-insufficient-liquidity", "firm-b"],
  staleA: ["GC-09-stale-evidence", "firm-a"],
} as const satisfies Readonly<
  Record<string, readonly [string, SetupFirmId]>
>;

export type SignedSetupCases = Readonly<
  Record<keyof typeof REQUIRED_CASES, SignedSetupCase>
>;

export type SignedSetupCaseLoad =
  | { readonly ok: true; readonly cases: SignedSetupCases }
  | { readonly ok: false; readonly error: string };

const UNAVAILABLE =
  "The captain-signed golden cases this demonstration projects from could not be read. Nothing is shown rather than an unattributed projection.";

function readSignedSetupCases(): SignedSetupCaseLoad {
  const dir = resolveGoldenDir();
  if (!dir) return { ok: false, error: UNAVAILABLE };
  try {
    const cases = Object.fromEntries(
      Object.entries(REQUIRED_CASES).map(([key, [caseId, firmId]]) => [
        key,
        parseSignedSetupCase(
          JSON.parse(readFileSync(join(dir, `${caseId}.json`), "utf8")),
          caseId,
          firmId,
        ),
      ]),
    ) as SignedSetupCases;
    return { ok: true, cases };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

let loaded: SignedSetupCaseLoad | undefined;

/** Memoized on first CALL, never at module init: an unreadable fixture directory
 * must fail the surface closed, not the route's import. */
export function loadSignedSetupCases(): SignedSetupCaseLoad {
  loaded ??= readSignedSetupCases();
  return loaded;
}

// ── Reading the signed case ─────────────────────────────────────────────────────────
function evidence(
  caseFile: SignedSetupCase,
  evidenceKind: string,
): GoldenEvidence | null {
  return (
    caseFile.householdEvidence.find(
      (candidate) => candidate.evidenceKind === evidenceKind,
    ) ?? null
  );
}

function amountFrom(
  text: string,
  pattern: RegExp,
): number | null {
  const match = text.match(pattern);
  return match ? Number(match[1]) * 100 : null;
}

function bankVerification(
  datum: GoldenEvidence,
): boolean | null {
  const summary = datum.summary.toLowerCase();
  if (
    summary.includes("not yet independently verified") ||
    summary.includes("not independently verified")
  ) {
    return false;
  }
  return summary.includes("independently verified")
    ? true
    : null;
}

export interface SignedCaseEvaluationEvidence
  extends SetupPolicyEvidence {
  readonly plannedMonthlyWithdrawal: {
    readonly value: number;
    readonly provenance: { readonly asOf: string };
    readonly canonical: GoldenEvidence;
  };
  readonly bankInstruction: {
    readonly value: {
      readonly independentlyVerified: boolean;
    };
    readonly provenance: { readonly asOf: string };
    readonly canonical: GoldenEvidence;
  };
}

export function signedCaseEvaluationEvidence(
  caseFile: SignedSetupCase,
): SignedCaseEvaluationEvidence | null {
  const planned = evidence(caseFile, "planned-withdrawals");
  const bank = evidence(caseFile, "bank-instruction");
  if (!planned || !bank) return null;
  const plannedMonthlyMinor = amountFrom(
    planned.summary,
    /(\d+)\s+USD\/month/i,
  );
  const independentlyVerified = bankVerification(bank);
  if (
    plannedMonthlyMinor === null ||
    independentlyVerified === null
  ) {
    return null;
  }
  return {
    plannedMonthlyWithdrawal: {
      value: plannedMonthlyMinor,
      provenance: { asOf: planned.observedAt },
      canonical: planned,
    },
    bankInstruction: {
      value: { independentlyVerified },
      provenance: { asOf: bank.observedAt },
      canonical: bank,
    },
  };
}

export function signedCaseMaterialEvidence(
  caseFile: SignedSetupCase,
) {
  const available = evidence(caseFile, "account-balance");
  const pending = evidence(caseFile, "pending-actions");
  const evaluationEvidence =
    signedCaseEvaluationEvidence(caseFile);
  const availableMinor = available
    ? amountFrom(
        available.summary,
        /(?:balance|liquidity)[^\d]*(\d+)\s+USD/i,
      )
    : null;
  const pendingMinor = pending
    ? amountFrom(
        pending.summary,
        /Pending approved distribution of (\d+)\s+USD/i,
      )
    : null;
  const requestMinor = signedCaseRequestMinor(caseFile);
  return {
    caseId: caseFile.caseId,
    canonicalEvidence: caseFile.householdEvidence,
    evaluatorInputs: {
      evaluatedAt: caseFile.trigger.asOf,
      availableMinor,
      pendingMinor,
      requestMinor,
      plannedMonthlyMinor:
        evaluationEvidence?.plannedMonthlyWithdrawal.value ??
        null,
      plannedObservedAt:
        evaluationEvidence?.plannedMonthlyWithdrawal
          .canonical.observedAt ?? null,
      plannedRetrievedAt:
        evaluationEvidence?.plannedMonthlyWithdrawal
          .canonical.retrievedAt ?? null,
      bankInstructionObservedAt:
        evaluationEvidence?.bankInstruction.canonical
          .observedAt ?? null,
      bankInstructionRetrievedAt:
        evaluationEvidence?.bankInstruction.canonical
          .retrievedAt ?? null,
      bankInstructionIndependentlyVerified:
        evaluationEvidence?.bankInstruction.value
          .independentlyVerified ?? null,
    },
  };
}

export function signedCaseRequestMinor(
  caseFile: SignedSetupCase,
): number | null {
  return amountFrom(
    caseFile.trigger.maskedRequestSummary,
    /distribute (\d+)\s+USD/i,
  );
}
