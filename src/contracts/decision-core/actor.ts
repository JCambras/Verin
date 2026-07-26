/**
 * Tenant scope, actor attribution, and the tokenized-value shape (v3 §5; ratified
 * shapes: docs/v3/verin-core-contracts.ts; ADR-0029, D-036).
 *
 * TenantContext is the scoping spine: every persisted decision-core record extends
 * it, so an unscoped record is a PARSE ERROR, not a review comment (v3 invariant 2).
 * All object schemas here and across decision-core are STRICT - unknown keys are
 * rejected, which is what makes "cannot carry" states structurally unrepresentable
 * rather than merely unread.
 */
import { z } from "zod";
import { ActorIdSchema, FirmIdSchema, RoleIdSchema } from "./ids";

/** The tenant scope every persisted decision-core record must carry. */
export const TenantContextSchema = z.strictObject({
  firmId: FirmIdSchema,
});
export type TenantContext = z.infer<typeof TenantContextSchema>;

/** A human actor, tenant-scoped, with the roles attribution recorded at act time. */
export const ActorRefSchema = TenantContextSchema.extend({
  actorId: ActorIdSchema,
  roleIds: z.array(RoleIdSchema),
});
export type ActorRef = z.infer<typeof ActorRefSchema>;

/** A system actor (engine, scheduler, reconciler), tenant-scoped like any human. */
export const SystemActorRefSchema = TenantContextSchema.extend({
  systemId: z.string().min(1),
});
export type SystemActorRef = z.infer<typeof SystemActorRefSchema>;

/**
 * Human or system attribution. The members are strict objects with disjoint keys
 * (actorId vs systemId), so the union is unambiguous without a discriminator.
 */
export const AnyActorRefSchema = z.union([ActorRefSchema, SystemActorRefSchema]);
export type AnyActorRef = z.infer<typeof AnyActorRefSchema>;

/**
 * NORMATIVE (v3 §5): a Tokenized value is constructible ONLY through the scrubbing
 * boundary (the LLM adapter's scrub function - prompt 6's scrubber module exports
 * the sole factory; a reachability fence enforces it there). The `piiFree: true`
 * literal proves nothing by itself - these schemas validate SHAPE at boundaries;
 * provenance of the flag is structural and lives with the scrubber. Direct
 * construction elsewhere is an invariant violation, not a style issue.
 */
export const TokenizedStringSchema = z.strictObject({
  value: z.string(),
  piiFree: z.literal(true),
});
export type TokenizedString = z.infer<typeof TokenizedStringSchema>;

/** Tokenized structured payload (system-event bodies after scrubbing). */
export const TokenizedPayloadSchema = z.strictObject({
  value: z.record(z.string().min(1), z.unknown()),
  piiFree: z.literal(true),
});
export type TokenizedPayload = z.infer<typeof TokenizedPayloadSchema>;
