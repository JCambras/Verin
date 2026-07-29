import type { VerificationProofVM } from "./model";
import { fact } from "./provenance";
import type { SignedVerificationData } from "./signed-case-types";
import {
  formatDemoInstant,
  type DemoTimeline,
} from "./timeline";

export function buildVerificationProofs(
  verification: Extract<SignedVerificationData, { reached: true }>,
  timeline: DemoTimeline,
): readonly VerificationProofVM[] {
  const bindings =
    verification.observedStatus === "submitted"
      ? [
          {
            ledgerEvent: "ExecutionSucceeded" as const,
            observedAt: timeline.executionSucceededAt,
          },
        ]
      : verification.observedStatus === "unknown"
        ? [
            {
              ledgerEvent: "ExecutionPartiallySucceeded" as const,
              observedAt: timeline.executionSucceededAt,
            },
            {
              ledgerEvent: "ExecutionPartiallySucceeded" as const,
              observedAt: timeline.executionSucceededAt,
            },
          ]
        : [
            {
              ledgerEvent: "ExecutionSucceeded" as const,
              observedAt: timeline.executionSucceededAt,
            },
            {
              ledgerEvent: "StatusObserved" as const,
              observedAt: verification.observedAt,
            },
          ];
  if (bindings.length !== verification.proves.length) {
    throw new TypeError(
      `Verification proof count does not match ${verification.observedStatus} event bindings`,
    );
  }
  return verification.proves.map((display, index) => {
    const binding = bindings[index]!;
    return {
      ...fact(
        display,
        "fake-adapter-response",
        binding.observedAt,
        formatDemoInstant(binding.observedAt, undefined, true),
      ),
      ledgerEvent: binding.ledgerEvent,
    };
  });
}
