import { RAW_SIGNED_CASES } from "./signed-case-fixtures";
import {
  SIGNED_CASE_IDS,
  type SignedAuthorityStageData,
  type SignedCaseId,
  type SignedCaseVariant,
} from "./signed-case-types";
import {
  asArray,
  asBoolean,
  asNullableString,
  asNumber,
  asPositiveSafeInteger,
  asRecord,
  asString,
  asStringArray,
} from "./signed-case-fields";
import { parseEvidence, parseMoney } from "./signed-case-evidence";
import { signedAuthorityGapFor } from "./signed-case-gaps";
import { parseVerification } from "./signed-verification";

export * from "./signed-case-types";

function parseStage(value: unknown, path: string): SignedAuthorityStageData {
  const stage = asRecord(value, path);
  const mode = asString(stage.executionMode, `${path}.executionMode`);
  if (mode !== "sequential" && mode !== "parallel") {
    throw new TypeError(`${path}.executionMode is unsupported`);
  }
  return {
    stageId: asString(stage.stageId, `${path}.stageId`),
    order: asNumber(stage.order, `${path}.order`),
    executionMode: mode,
    eligibleRoleIds: asStringArray(
      stage.eligibleRoleIds,
      `${path}.eligibleRoleIds`,
    ),
    approvalsRequired: asPositiveSafeInteger(
      stage.approvalsRequired,
      `${path}.approvalsRequired`,
    ),
    distinctActorsRequired: asBoolean(
      stage.distinctActorsRequired,
      `${path}.distinctActorsRequired`,
    ),
    requesterMayApprove: asBoolean(
      stage.requesterMayApprove,
      `${path}.requesterMayApprove`,
    ),
    expiresAfter: asString(stage.expiresAfter, `${path}.expiresAfter`),
    escalationPath: asArray(
      stage.escalationPath,
      `${path}.escalationPath`,
    ).map((entry, index) => {
      const escalation = asRecord(
        entry,
        `${path}.escalationPath[${index}]`,
      );
      return {
        after: asString(
          escalation.after,
          `${path}.escalationPath[${index}].after`,
        ),
        roleIds: asStringArray(
          escalation.roleIds,
          `${path}.escalationPath[${index}].roleIds`,
        ),
        reasonCode: asString(
          escalation.reasonCode,
          `${path}.escalationPath[${index}].reasonCode`,
        ),
      };
    }),
  };
}

function parseVariant(value: unknown): SignedCaseVariant {
  const fixture = asRecord(value, "fixture");
  const caseId = asString(fixture.caseId, "fixture.caseId");
  if (!SIGNED_CASE_IDS.includes(caseId as SignedCaseId)) {
    throw new TypeError(`fixture.caseId ${caseId} is unsupported`);
  }
  const authorityGap = signedAuthorityGapFor(caseId as SignedCaseId);
  if (authorityGap) {
    const signoff = asRecord(fixture.signoff, `${caseId}.signoff`);
    if (signoff.signedAt !== authorityGap.signedAt) {
      throw new TypeError(`${caseId}.signoff.signedAt drifts from its authority gap`);
    }
  }
  const disposition = asString(
    fixture.expectedDisposition,
    `${caseId}.expectedDisposition`,
  );
  if (
    disposition !== "proceed" &&
    disposition !== "blocked" &&
    disposition !== "prohibited"
  ) {
    throw new TypeError(`${caseId}.expectedDisposition is unsupported`);
  }
  const trigger = asRecord(fixture.trigger, `${caseId}.trigger`);
  const money = parseMoney(
    fixture.signedMoney,
    `${caseId}.signedMoney`,
    authorityGap?.missingAuthorities.includes("structured-money") ?? false,
  );
  const rawProhibition =
    fixture.prohibition === undefined || fixture.prohibition === null
      ? null
      : asRecord(fixture.prohibition, `${caseId}.prohibition`);
  const prohibitionSource = rawProhibition
    ? asRecord(rawProhibition.source, `${caseId}.prohibition.source`)
    : null;
  const prohibitionSourceType = prohibitionSource
    ? asString(
        prohibitionSource.sourceType,
        `${caseId}.prohibition.source.sourceType`,
      )
    : null;
  if (
    prohibitionSourceType !== null &&
    prohibitionSourceType !== "household_instruction" &&
    prohibitionSourceType !== "regulatory" &&
    prohibitionSourceType !== "firm_policy"
  ) {
    throw new TypeError(`${caseId}.prohibition.source.sourceType is unsupported`);
  }
  if (disposition === "prohibited" && !rawProhibition) {
    throw new TypeError(`${caseId}.prohibition is required for a prohibited case`);
  }
  const authority = asRecord(
    fixture.expectedAuthority,
    `${caseId}.expectedAuthority`,
  );
  const mode = asString(authority.mode, `${caseId}.expectedAuthority.mode`);
  if (
    mode !== "none" &&
    mode !== "automatic" &&
    mode !== "approval" &&
    mode !== "specialist_review"
  ) {
    throw new TypeError(`${caseId}.expectedAuthority.mode is unsupported`);
  }
  const eligibility = asRecord(
    fixture.expectedExecutionEligibility,
    `${caseId}.expectedExecutionEligibility`,
  );
  const verification = asRecord(
    fixture.expectedVerificationState,
    `${caseId}.expectedVerificationState`,
  );
  const policyVersions = asRecord(
    fixture.policyVersions,
    `${caseId}.policyVersions`,
  );
  const stages = asArray(
    authority.stages,
    `${caseId}.expectedAuthority.stages`,
  ).map((entry, index) =>
    parseStage(entry, `${caseId}.expectedAuthority.stages[${index}]`),
  );
  const inferredApprovalBindings = stages.flatMap((stage) =>
    Array.from({ length: stage.approvalsRequired }, () => ({
      stageId: stage.stageId,
      lifecyclePass: "initial" as const,
    })),
  );
  let inferredApprovalIndex = 0;
  return {
    caseId: caseId as SignedCaseId,
    scenarioId:
      fixture.scenarioRef === null
        ? null
        : asString(fixture.scenarioRef, `${caseId}.scenarioRef`),
    firmId: asString(fixture.firm, `${caseId}.firm`),
    disposition,
    trigger: {
      description: asString(trigger.description, `${caseId}.trigger.description`),
      requesterRole: asString(
        trigger.requesterRole,
        `${caseId}.trigger.requesterRole`,
      ),
      requestRef: asString(trigger.requestRef, `${caseId}.trigger.requestRef`),
      maskedRequestSummary: asString(
        trigger.maskedRequestSummary,
        `${caseId}.trigger.maskedRequestSummary`,
      ),
      requestAt: asString(trigger.asOf, `${caseId}.trigger.asOf`),
      requestAmountMinor: money.requestAmountMinor,
    },
    money,
    evidence: asArray(
      fixture.householdEvidence,
      `${caseId}.householdEvidence`,
    ).map((entry, index) =>
      parseEvidence(entry, `${caseId}.householdEvidence[${index}]`),
    ),
    policyVersions: {
      domainConfigVersionId: asString(
        policyVersions.domainConfigVersionId,
        `${caseId}.policyVersions.domainConfigVersionId`,
      ),
      firmPolicyVersionId: asString(
        policyVersions.firmPolicyVersionId,
        `${caseId}.policyVersions.firmPolicyVersionId`,
      ),
      householdInstructionVersionIds: asStringArray(
        policyVersions.householdInstructionVersionIds,
        `${caseId}.policyVersions.householdInstructionVersionIds`,
      ),
      regulatoryVersionId: asNullableString(
        policyVersions.regulatoryVersionId,
        `${caseId}.policyVersions.regulatoryVersionId`,
      ),
    },
    householdInstructions: asArray(
      fixture.householdInstructions,
      `${caseId}.householdInstructions`,
    ).map((entry, index) => {
      const instruction = asRecord(
        entry,
        `${caseId}.householdInstructions[${index}]`,
      );
      return {
        instructionKind: asString(
          instruction.instructionKind,
          `${caseId}.householdInstructions[${index}].instructionKind`,
        ),
        versionId: asString(
          instruction.versionId,
          `${caseId}.householdInstructions[${index}].versionId`,
        ),
        summary: asString(
          instruction.summary,
          `${caseId}.householdInstructions[${index}].summary`,
        ),
      };
    }),
    prohibition:
      rawProhibition && prohibitionSource && prohibitionSourceType
        ? {
            source: {
              sourceType: prohibitionSourceType,
              sourceId: asString(
                prohibitionSource.sourceId,
                `${caseId}.prohibition.source.sourceId`,
              ),
              versionId: asString(
                prohibitionSource.versionId,
                `${caseId}.prohibition.source.versionId`,
              ),
            },
            scope: asString(
              rawProhibition.scope,
              `${caseId}.prohibition.scope`,
            ),
            reasonCode: asString(
              rawProhibition.reasonCode,
              `${caseId}.prohibition.reasonCode`,
            ),
            explanation: asString(
              rawProhibition.explanation,
              `${caseId}.prohibition.explanation`,
            ),
          }
        : null,
    authority: {
      mode,
      stages,
      note: asString(authority.note, `${caseId}.expectedAuthority.note`),
    },
    executionEligibility: {
      eligible: asBoolean(
        eligibility.eligible,
        `${caseId}.expectedExecutionEligibility.eligible`,
      ),
      reason: asString(
        eligibility.reason,
        `${caseId}.expectedExecutionEligibility.reason`,
      ),
      idempotencyKey: asNullableString(
        eligibility.idempotencyKey,
        `${caseId}.expectedExecutionEligibility.idempotencyKey`,
      ),
      reservations: asArray(
        eligibility.reservations,
        `${caseId}.expectedExecutionEligibility.reservations`,
      ).map((entry, index) => {
        const reservation = asRecord(
          entry,
          `${caseId}.expectedExecutionEligibility.reservations[${index}]`,
        );
        return {
          reservationId: asString(
            reservation.reservationId,
            `${caseId}.expectedExecutionEligibility.reservations[${index}].reservationId`,
          ),
          conflictKeys: asStringArray(
            reservation.conflictKeys,
            `${caseId}.expectedExecutionEligibility.reservations[${index}].conflictKeys`,
          ),
          expiresAfter: asString(
            reservation.expiresAfter,
            `${caseId}.expectedExecutionEligibility.reservations[${index}].expiresAfter`,
          ),
        };
      }),
      preconditions: asArray(
        eligibility.preconditions,
        `${caseId}.expectedExecutionEligibility.preconditions`,
      ).map((entry, index) => {
        const precondition = asRecord(
          entry,
          `${caseId}.expectedExecutionEligibility.preconditions[${index}]`,
        );
        return {
          code: asString(
            precondition.code,
            `${caseId}.expectedExecutionEligibility.preconditions[${index}].code`,
          ),
          requiredEvidence: asStringArray(
            precondition.requiredEvidence,
            `${caseId}.expectedExecutionEligibility.preconditions[${index}].requiredEvidence`,
          ),
          mustStillHoldAtExecution: asBoolean(
            precondition.mustStillHoldAtExecution,
            `${caseId}.expectedExecutionEligibility.preconditions[${index}].mustStillHoldAtExecution`,
          ),
        };
      }),
    },
    verification: parseVerification(
      verification,
      `${caseId}.expectedVerificationState`,
      authorityGap?.missingAuthorities.includes("verification-detail") ?? false,
    ),
    ledgerEvents: asArray(
      fixture.expectedLedgerEvents,
      `${caseId}.expectedLedgerEvents`,
    ).map((entry, index) => {
      const ledger = asRecord(entry, `${caseId}.expectedLedgerEvents[${index}]`);
      const type = asString(
        ledger.type,
        `${caseId}.expectedLedgerEvents[${index}].type`,
      );
      const inferred =
        type === "ApprovalRecorded" &&
        authorityGap?.missingAuthorities.includes("approval-event-bindings")
          ? inferredApprovalBindings[inferredApprovalIndex++]
          : undefined;
      const stageId =
        ledger.stageId === undefined
          ? (inferred?.stageId ?? null)
          : asString(
              ledger.stageId,
              `${caseId}.expectedLedgerEvents[${index}].stageId`,
            );
      const lifecyclePass =
        ledger.lifecyclePass === undefined
          ? (inferred?.lifecyclePass ?? null)
          : asString(
              ledger.lifecyclePass,
              `${caseId}.expectedLedgerEvents[${index}].lifecyclePass`,
            );
      if (
        lifecyclePass !== null &&
        lifecyclePass !== "initial" &&
        lifecyclePass !== "revalidated"
      ) {
        throw new TypeError(
          `${caseId}.expectedLedgerEvents[${index}].lifecyclePass is unsupported`,
        );
      }
      if (
        type === "ApprovalRecorded" &&
        (stageId === null || lifecyclePass === null)
      ) {
        throw new TypeError(
          `${caseId}.expectedLedgerEvents[${index}] approval binding is incomplete`,
        );
      }
      return {
        type,
        note: asString(
          ledger.note,
          `${caseId}.expectedLedgerEvents[${index}].note`,
        ),
        stageId,
        lifecyclePass,
      };
    }),
    explanations: asArray(
      fixture.expectedExplanationNodes,
      `${caseId}.expectedExplanationNodes`,
    ).map((entry, index) => {
      const explanation = asRecord(
        entry,
        `${caseId}.expectedExplanationNodes[${index}]`,
      );
      return {
        code: asString(
          explanation.code,
          `${caseId}.expectedExplanationNodes[${index}].code`,
        ),
        summary: asString(
          explanation.summary,
          `${caseId}.expectedExplanationNodes[${index}].summary`,
        ),
      };
    }),
    authorityGap: authorityGap
      ? {
          signedAt: authorityGap.signedAt,
          requiredSince: authorityGap.requiredSince,
          status: authorityGap.status,
          execution: authorityGap.execution,
          reason: authorityGap.reason,
          missingAuthorities: authorityGap.missingAuthorities,
        }
      : null,
  };
}

export function parseSignedCaseVariants(
  values: readonly unknown[],
): SignedCaseVariant[] {
  return values.map(parseVariant);
}

export const SIGNED_CASE_VARIANTS =
  parseSignedCaseVariants(RAW_SIGNED_CASES);

export const SIGNED_CASE_BY_ID = Object.fromEntries(
  SIGNED_CASE_VARIANTS.map((variant) => [variant.caseId, variant]),
) as Readonly<Record<SignedCaseId, SignedCaseVariant>>;
