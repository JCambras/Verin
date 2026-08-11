/**
 * THE CLOSED VOCABULARIES of the domain-configuration schema (v3 prompt 10,
 * ADR-0056).
 *
 * THE ONE GRAMMAR RULE this module exists to hold: every string in a domain
 * configuration that is not a human LABEL is an identifier drawn from a closed,
 * load-checked vocabulary, and every composite value (conflict keys,
 * idempotency keys, command payloads, copy) is built from a closed SEGMENT
 * GRAMMAR - never from string interpolation. That rule is what stops the
 * configuration from becoming the second expression engine v3 §20 risk 2 bans,
 * and it is what the `domain-configuration` fence proves.
 *
 * Nothing here is domain-specific: `SLOT_TYPES` describes shapes, not
 * money movement; `SUBJECT_KINDS` names entity classes the house CRM and the
 * v3 evidence plane both already carry. A value naming a decision domain would
 * fail invariant 3's fence in this very module.
 */
import { z } from "zod";
import type { PolicyValueType } from "@domain/policy/registries";
import { CLIENT_REQUEST_ID_KEY } from "./intake-view";

/** Kebab-case identifier: the byte form every configured id shares. */
export const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A dotted path of kebab-case segments (`selection.source.selectedRef` uses camel leaves). */
export const kebabId = <B extends string>() =>
  z.string().regex(KEBAB_CASE_RE, "kebab-case identifier").brand<B>();

/**
 * A slot name is KEBAB-CASE, because prompt 8's primitives already put slot
 * names inside published context keys (`selection.<slot>.selectedRef`) through
 * `KeySegmentSchema`, and a dot or a capital inside a segment would make the
 * derived key space ambiguous. The transport's own field names stay camelCase
 * and are bridged by each slot's declared `triggerField`.
 */
export const SlotNameSchema = z.string().regex(KEBAB_CASE_RE, "kebab-case slot name");

/**
 * The request/transport field a `supplied-by-trigger` slot reads. This is the
 * one place the shipped public API's camelCase vocabulary meets the domain's
 * kebab-case slot vocabulary - declared as data so no adapter has to know a
 * domain's field names (CD-1 keeps shipped route payloads unrenamed).
 */
export const TriggerFieldSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "camelCase trigger field");

/** The flow-data key carrying the platform's per-execution idempotency scope. */
export const EXECUTION_SCOPE_KEY = "executionScope";

/** The flow-data key carrying the identity that initiated the request. */
export const INITIATING_ACTOR_KEY = "initiatedBy";

/**
 * The RESERVED transport namespace: keys the platform itself writes into flow
 * data, AFTER a caller's own values. A slot reading one of these would be
 * silently filled with the platform's value instead of what the requester
 * supplied - the only slot mistake in the grammar that would not fail closed -
 * so the intent schema refuses it at load time.
 *
 * Every name in this list is the SAME declaration the module that writes it
 * consumes: the plan compiler and the composition root re-export the two
 * flow-data keys below, and the client-request key is imported from the leaf
 * `intake-view` module the intake route and the journey component both write it
 * through. A second copy of any of these strings would let the reserved list go
 * on protecting a name nothing writes any more.
 */
export const RESERVED_TRIGGER_FIELDS = [
  EXECUTION_SCOPE_KEY,
  INITIATING_ACTOR_KEY,
  CLIENT_REQUEST_ID_KEY,
] as const;

/**
 * A published context key: dot-separated segments, each kebab-case or
 * camelCase. This is the SAME key space prompt 8's `publishedKeys` mints and
 * prompt 9's loader closes over - the configuration may only reference keys
 * that vocabulary produces (D-185: resolution is by declared origin).
 */
export const CONTEXT_KEY_RE = /^[a-zA-Z][A-Za-z0-9]*(?:[.-][a-zA-Z0-9][A-Za-z0-9]*)*$/;
export const ContextKeySchema = z.string().regex(CONTEXT_KEY_RE, "dotted context key");

/** The value shapes a slot may carry. Closed: a new shape is a schema version bump. */
export const SLOT_TYPES = [
  "subject",
  "money",
  "integer",
  "date",
  "duration",
  "enum",
  "text",
  "boolean",
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];
export const SlotTypeSchema = z.enum(SLOT_TYPES);

/**
 * How a slot gets its value. Declared, never inferred - which is what makes an
 * ambiguous subject a CONFIGURED outcome of a selection primitive rather than
 * an evaluator special case.
 */
export const SLOT_RESOLUTIONS = [
  "supplied-by-trigger",
  "bound-by-primitive",
  "derived",
] as const;
export const SlotResolutionSchema = z.enum(SLOT_RESOLUTIONS);

/** Entity classes a `subject` slot may bind. Entity kinds, never decision domains. */
export const SUBJECT_KINDS = [
  "household",
  "person",
  "financial-account",
  "bank-instruction",
  "registration-type",
  "application",
] as const;
export const SubjectKindSchema = z.enum(SUBJECT_KINDS);

/** Money is integers in minor units, end to end (no floats anywhere in the plane). */
export const MONEY_UNITS = ["USD-minor"] as const;
export const MoneyUnitSchema = z.enum(MONEY_UNITS);

/** The two trigger arms `TriggerSchema` already admits (trigger.ts). */
export const TRIGGER_KINDS = ["human_request", "system_event"] as const;
export const TriggerKindSchema = z.enum(TRIGGER_KINDS);

/** Which timestamp an evidence freshness floor is measured from (v3 §13). */
export const FRESHNESS_BASES = ["observedAt", "retrievedAt"] as const;
export const FreshnessBasisSchema = z.enum(FRESHNESS_BASES);

/** What the absence of a required evidence kind means. */
export const EVIDENCE_ABSENCE_MODES = ["block", "specialist_review", "optional"] as const;
export const EvidenceAbsenceSchema = z.enum(EVIDENCE_ABSENCE_MODES);

/** The declared type of one evidence or instruction path (prompt 9's operand types). */
export const PATH_VALUE_TYPES = [
  "integer",
  "boolean",
  "string",
  "iso-date",
  "iso-timestamp",
  "reference",
  "structured",
] as const;
export type PathValueType = (typeof PATH_VALUE_TYPES)[number];
export const PathValueTypeSchema = z.enum(PATH_VALUE_TYPES);

/**
 * The four household-instruction classes (v3 §10). The class-to-EFFECT mapping
 * stays platform code: a firm must never be able to reinterpret a client
 * mandate, so the configuration declares which kinds exist and nothing about
 * what a violation does beyond naming its coded outcome.
 */
export const INSTRUCTION_CLASSES = [
  "commitment",
  "preference",
  "restriction",
  "exception",
] as const;
export const InstructionClassSchema = z.enum(INSTRUCTION_CLASSES);

/** How an instruction may move the admissible set relative to firm policy. */
export const INSTRUCTION_PRECEDENCES = [
  "narrowing-only",
  "widening-requires-exception",
] as const;
export const InstructionPrecedenceSchema = z.enum(INSTRUCTION_PRECEDENCES);

/**
 * The three ratified `VersionedSourceRef` arms (explanation.ts). There is no
 * `domain_config` arm and there must not be one: a domain-sourced prohibition
 * would carry no version lineage a firm or an examiner could inspect.
 */
export const PROHIBITION_SOURCES = [
  "firm_policy",
  "household_instruction",
  "regulatory",
] as const;
export const ProhibitionSourceSchema = z.enum(PROHIBITION_SOURCES);

/** Authority template kinds (authority.ts). The firm supplies the record. */
export const APPROVAL_TEMPLATE_KINDS = ["approval", "specialist_review"] as const;
export const ApprovalTemplateKindSchema = z.enum(APPROVAL_TEMPLATE_KINDS);

/** When a reservation is created relative to the decision it belongs to. */
export const RESERVATION_CREATE_POINTS = ["decision-commit", "post-approval"] as const;
export const ReservationCreatePointSchema = z.enum(RESERVATION_CREATE_POINTS);

/** Events that release a reservation. */
export const RESERVATION_RELEASE_EVENTS = [
  "execution-succeeded",
  "execution-failed",
  "decision-superseded",
  "expiry",
] as const;
export const ReservationReleaseEventSchema = z.enum(RESERVATION_RELEASE_EVENTS);

/**
 * v3 §14's honesty rule as data: a verification rule may never report a state
 * stronger than its source observed.
 */
export const INFERENCE_CEILINGS = ["source"] as const;
export const InferenceCeilingSchema = z.enum(INFERENCE_CEILINGS);

/** Calendar granularities a conflict-key bucket segment may use. */
export const BUCKET_GRANULARITIES = ["year", "month", "day"] as const;
export type BucketGranularity = (typeof BUCKET_GRANULARITIES)[number];
export const BucketGranularitySchema = z.enum(BUCKET_GRANULARITIES);

/** The thirteen top-level sections a change record may name (see diff.ts). */
export const CONFIG_SECTIONS = [
  "intents",
  "evidence",
  "primitiveBindings",
  "policy",
  "instructionKinds",
  "prohibitions",
  "blockers",
  "authority",
  "execution",
  "conflictKeys",
  "reservations",
  "verification",
  "presentation",
  "header",
] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];
export const ConfigSectionSchema = z.enum(CONFIG_SECTIONS);

/** How a candidate version's change against its parent is stated (captain direction, 2026-08-11). */
export const CHANGE_OPS = ["add", "replace", "remove"] as const;
export const ChangeOpSchema = z.enum(CHANGE_OPS);

/**
 * Who or what drafted a configuration version. `genesis-interview` and
 * `proposed-by-system` are named now, unused by the shipped documents, because
 * the thesis (docs/product-guide.md, D-098) is that the system eventually
 * PROPOSES configuration: a drafted clause must be able to cite its source from
 * the first version, or the provenance is retrofitted onto history that lacks it.
 */
export const AUTHOR_KINDS = [
  "platform-team",
  "genesis-interview",
  "proposed-by-system",
] as const;
export const AuthorKindSchema = z.enum(AUTHOR_KINDS);

/** What a drafted version was drafted FROM. */
export const BASIS_KINDS = [
  "ratified-document",
  "shipped-implementation",
  "signed-truth-set",
  "firm-interview",
  "observed-operation",
] as const;
export const BasisKindSchema = z.enum(BASIS_KINDS);

/** Slot type -> the operand type prompt 9's load-time type check reasons over. */
export const SLOT_TYPE_TO_VALUE_TYPE = {
  subject: "reference",
  money: "integer",
  integer: "integer",
  date: "iso-date",
  duration: "string",
  enum: "string",
  text: "string",
  boolean: "boolean",
} as const satisfies Record<SlotType, PolicyValueType>;
