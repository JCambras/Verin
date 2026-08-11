/**
 * THE DOMAIN-CONFIGURATION DOCUMENT (v3 prompt 10; ADR-0056).
 *
 * One immutable document per (domain, version), authored by Verin, carrying no
 * firm identity, no household data, and no judgment. Its identity is the
 * canonical serialization of its own bytes, so a published version cannot
 * change without announcing itself.
 *
 * AUTHORSHIP PROVENANCE AND DIFFABILITY ARE PART OF VERSION ONE (captain
 * direction, 2026-08-11). Every version records who or what drafted it and from
 * what basis, and states its change against a parent version AS DATA. Both
 * serve the ratified thesis that the system will eventually PROPOSE
 * configuration: a drafted clause must be able to cite its source, and a
 * proposed change must be renderable as a reviewable diff. Retrofitting either
 * onto history that lacks it is the expensive version, so they ship now.
 *
 * The declared change record is not decorative: the loader recomputes the diff
 * against the parent (the EMPTY document when a version declares no parent) and
 * refuses a document whose declaration disagrees with its own bytes.
 */
import { z } from "zod";
import { canonicalJson, type JsonValue } from "@contracts/decision-core/serialization";
import { TimestampSchema } from "@contracts/decision-core/ids";
import type { AppError } from "@contracts/errors";
import type { Result } from "@contracts/result";
import { EvidenceRequirementSchema } from "./evidence";
import {
  AuthoritySectionSchema,
  BlockerSchema,
  InstructionKindDeclarationSchema,
  PolicySlotSchema,
  ProhibitionSchema,
} from "./governance";
import { IntentSchema } from "./intents";
import {
  ConflictKeyTemplateSchema,
  ExecutionSectionSchema,
  ReservationRuleSchema,
  VerificationRuleSchema,
} from "./operations";
import { PresentationSchema } from "./presentation";
import { PrimitiveBindingSchema } from "./bindings";
import {
  AuthorKindSchema,
  BasisKindSchema,
  ChangeOpSchema,
  ConfigSectionSchema,
  kebabId,
} from "./vocabulary";

/** Pinned literal, exactly as DECISION_CORE_SCHEMA_VERSION is pinned. */
export const DOMAIN_CONFIG_FORMAT_VERSION = "domain-config/1.0.0";

/** Format versions this loader accepts. A new entry is a migration, never a widening. */
export const SUPPORTED_FORMAT_VERSIONS = [DOMAIN_CONFIG_FORMAT_VERSION] as const;

/** `2026.07.0` - calendar-major, so a version is orderable by eye in a review. */
export const CONFIG_VERSION_RE = /^\d{4}\.\d{2}\.\d+$/;

const BasisSchema = z
  .strictObject({
    kind: BasisKindSchema,
    ref: z.string().min(1),
    describes: z.string().min(1),
  })
  .readonly();

/** One stated change against the parent version, as data a reviewer can render. */
const configChangeSchemaImpl = z
  .strictObject({
    op: ChangeOpSchema,
    section: ConfigSectionSchema,
    describes: z.string().min(1),
  })
  .readonly();

const authorshipSchemaImpl = z
  .strictObject({
    authoredBy: z
      .strictObject({ kind: AuthorKindSchema, id: kebabId<"AuthorId">() })
      .readonly(),
    authoredAt: TimestampSchema,
    basis: z.array(BasisSchema).min(1).readonly(),
    /** The version this one supersedes, or null for the first published version. */
    parentVersion: z.string().regex(CONFIG_VERSION_RE, "calendar version").nullable(),
    changeFromParent: z.array(configChangeSchemaImpl).readonly(),
  })
  .readonly();

const domainConfigDocumentSchemaImpl = z
  .strictObject({
    formatVersion: z.enum(SUPPORTED_FORMAT_VERSIONS),
    domainConfigId: kebabId<"DomainConfigId">(),
    version: z.string().regex(CONFIG_VERSION_RE, "calendar version"),
    primitiveSetVersion: z.string().min(1),
    policyGrammarVersion: z.string().min(1),
    authorship: authorshipSchemaImpl,
    intents: z.array(IntentSchema).min(1).readonly(),
    evidence: z.array(EvidenceRequirementSchema).readonly(),
    primitiveBindings: z.array(PrimitiveBindingSchema).readonly(),
    policy: z.strictObject({ slots: z.array(PolicySlotSchema).readonly() }).readonly(),
    instructionKinds: z.array(InstructionKindDeclarationSchema).readonly(),
    prohibitions: z.array(ProhibitionSchema).readonly(),
    blockers: z.array(BlockerSchema).readonly(),
    authority: AuthoritySectionSchema,
    execution: ExecutionSectionSchema,
    conflictKeys: z.array(ConflictKeyTemplateSchema).readonly(),
    reservations: z.array(ReservationRuleSchema).readonly(),
    verification: z.array(VerificationRuleSchema).min(1).readonly(),
    presentation: PresentationSchema,
  })
  .readonly();
/**
 * NAMED, not an inferred alias. `z.infer` produces an anonymous structural type,
 * and the repo's type-resolving fences PRINT the types they meet - printing this
 * document's inferred graph expanded ~3,500 lines of composed schemas at every
 * reference and exhausted a fence worker's heap. An interface has a symbol, so
 * it prints and resolves by NAME while still deriving its members from the one
 * schema that defines them (D-193).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a named alias for the inferred document; see above
export interface DomainConfigDocument extends z.infer<typeof domainConfigDocumentSchemaImpl> {}

/** `${domainConfigId}@${version}` - the identity every golden fixture already pins. */
export const domainConfigVersionId = (document: {
  readonly domainConfigId: string;
  readonly version: string;
}): string => `${document.domainConfigId}@${document.version}`;

/**
 * The document's canonical bytes. The SHA-256 over these bytes is the document's
 * true identity; it is computed by the infrastructure source (where crypto
 * lives) so this layer stays pure. `canonicalJson` already refuses non-finite
 * numbers, cycles, non-plain objects, and sparse holes.
 */
export const canonicalConfigJson = (
  document: DomainConfigDocument,
): Result<string, AppError> => canonicalJson(document as unknown as JsonValue);



/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-193)
export interface DomainConfigDocument extends z.infer<typeof domainConfigDocumentSchemaImpl> {}
export const DomainConfigDocumentSchema: z.ZodType<DomainConfigDocument> = domainConfigDocumentSchemaImpl;
