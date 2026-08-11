/**
 * REFERENCE CLOSURE AND TYPE CHECK - stages 3 and 4 of the seven-stage load
 * (v3 prompt 10; ADR-0056).
 *
 * Every lookup here is an own-property Map lookup against a registry built from
 * the document itself, so `__proto__` and `constructor.prototype` are not
 * defended against - they are simply absent and fail closure. No string is ever
 * interpreted. This is the same inertness posture prompt 9's loader has, and it
 * inherits the same proof obligation.
 *
 * The type check enforces the one rule the design report got slightly wrong:
 * user-typed TEXT may reach a command payload (a household name is what a CRM
 * create IS) but may NEVER reach a conflict key or an idempotency key, where
 * unbounded, editable bytes would make a coordination identity unstable
 * (gap register MR-7).
 */
import type { ContextKeyDescriptor } from "@domain/policy/registries";
import { configError, type DomainConfigError } from "./errors";
import { durationSeconds } from "./evidence";
import type { DomainConfigDocument } from "./document";
import type { ConfiguredSlot } from "./intents";
import type { ValueSource } from "./segments";
import { SLOT_TYPE_TO_VALUE_TYPE } from "./vocabulary";

export type ClosureWorld = {
  readonly document: DomainConfigDocument;
  /** Slots of the intent whose plan/keys are being checked, by slot name. */
  readonly slots: ReadonlyMap<string, ConfiguredSlot>;
  readonly contextKeys: ReadonlyMap<string, ContextKeyDescriptor>;
  /** Step id -> the capability it runs, for `step-output` resolution. */
  readonly stepCapability: ReadonlyMap<string, string>;
  /** Whether this intent's plan contains a step whose verification rule awaits. */
  readonly hasAwaitedStep: boolean;
};

const DATE_VALUE_TYPES = new Set(["iso-date", "iso-timestamp"]);
const NUMERIC_VALUE_TYPES = new Set(["integer"]);

export type SourceType =
  | { readonly ok: true; readonly valueType: string; readonly fromTextSlot: boolean }
  | { readonly ok: false; readonly message: string };

/**
 * Resolve what a `ValueSource` refers to and what type it carries. The two
 * platform arms (`execution-scope`, `decision-hash`) are opaque strings the
 * platform supplies - never authored, never a slot, and never date-typed.
 */
export const resolveSourceType = (source: ValueSource, world: ClosureWorld): SourceType => {
  switch (source.from) {
    case "slot": {
      const slot = world.slots.get(source.slot);
      if (slot === undefined) return { ok: false, message: `no slot named ${JSON.stringify(source.slot)}` };
      return {
        ok: true,
        valueType: SLOT_TYPE_TO_VALUE_TYPE[slot.type],
        fromTextSlot: slot.type === "text",
      };
    }
    case "context": {
      const descriptor = world.contextKeys.get(source.key);
      if (descriptor === undefined) {
        return { ok: false, message: `context key ${JSON.stringify(source.key)} is published by nothing this intent binds` };
      }
      return { ok: true, valueType: descriptor.valueType, fromTextSlot: false };
    }
    case "step-output": {
      const capabilityId = world.stepCapability.get(source.step);
      if (capabilityId === undefined) {
        return { ok: false, message: `no plan step named ${JSON.stringify(source.step)}` };
      }
      const capability = world.document.execution.capabilities.find(
        (candidate) => candidate.id === capabilityId,
      );
      const published = capability?.publishes.some((entry) => entry.output === source.output);
      return published === true
        ? { ok: true, valueType: "string", fromTextSlot: false }
        : {
            ok: false,
            message: `step ${JSON.stringify(source.step)} publishes no output named ${JSON.stringify(source.output)}`,
          };
    }
    case "await-observation":
      return world.hasAwaitedStep
        ? { ok: true, valueType: "string", fromTextSlot: false }
        : {
            ok: false,
            message: "this plan has no externally-gated step, so there is no observation to read",
          };
    case "execution-scope":
    case "decision-hash":
    case "initiating-actor":
      return { ok: true, valueType: "string", fromTextSlot: false };
  }
};

/** Where a source appears, which decides whether text is admissible. */
export type SourcePosition = "key" | "payload" | "quantity";

export const checkSource = (
  source: ValueSource,
  position: SourcePosition,
  path: string,
  world: ClosureWorld,
  sink: (error: DomainConfigError) => void,
): SourceType => {
  const resolved = resolveSourceType(source, world);
  if (!resolved.ok) {
    sink(configError("unknown-reference", path, resolved.message));
    return resolved;
  }
  if (position === "key" && resolved.fromTextSlot) {
    sink(
      configError(
        "type-mismatch",
        path,
        "a text slot may not appear in a conflict key or an idempotency key: user-typed bytes would make the coordination identity unstable",
      ),
    );
  }
  if (position === "quantity" && !NUMERIC_VALUE_TYPES.has(resolved.valueType)) {
    sink(
      configError("type-mismatch", path, `a reservation quantity must be integer-typed, received ${resolved.valueType}`),
    );
  }
  return resolved;
};

/** A `bucket` segment needs a date-typed source; anything else is a silent-truncation bug. */
export const checkBucketSource = (
  resolved: SourceType,
  path: string,
  sink: (error: DomainConfigError) => void,
): void => {
  if (resolved.ok && !DATE_VALUE_TYPES.has(resolved.valueType)) {
    sink(
      configError(
        "type-mismatch",
        path,
        `a bucket segment needs a date-typed source, received ${resolved.valueType}`,
      ),
    );
  }
};

/**
 * Stage 4 for the evidence section: a freshness FLOOR must be a strictly
 * positive duration. A zero or negative floor would make every observation
 * stale on arrival, which reads as "evidence is always missing" rather than as
 * the configuration error it is.
 */
export const checkEvidenceWindows = (
  document: DomainConfigDocument,
  sink: (error: DomainConfigError) => void,
): void => {
  for (const requirement of document.evidence) {
    const seconds = durationSeconds(requirement.maxAge);
    const path = `evidence.${requirement.evidenceKind}.maxAge`;
    if (seconds === null) {
      sink(configError("type-mismatch", path, `unparseable duration ${JSON.stringify(requirement.maxAge)}`));
    } else if (seconds <= 0) {
      sink(configError("type-mismatch", path, "an evidence freshness floor must be strictly positive"));
    }
  }
};

/** Membership helper that reports the offending name rather than a boolean. */
export const requireMember = (
  value: string,
  known: ReadonlySet<string>,
  path: string,
  what: string,
  sink: (error: DomainConfigError) => void,
): boolean => {
  if (known.has(value)) return true;
  sink(configError("unknown-reference", path, `${what} ${JSON.stringify(value)} is not declared`));
  return false;
};
