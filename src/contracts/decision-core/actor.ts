/**
 * Tenant scope, actor attribution, and the tokenized-value shape (v3 §5; ratified
 * shapes: docs/v3/verin-core-contracts.ts; ADR-0029, D-040).
 *
 * TenantContext is the scoping spine: every persisted decision-core record extends
 * it, so an unscoped record is a PARSE ERROR, not a review comment (v3 invariant 2).
 * All object schemas here and across decision-core are STRICT - unknown keys are
 * rejected, which is what makes "cannot carry" states structurally unrepresentable
 * rather than merely unread.
 */
import { z } from "zod";
import {
  ActorIdSchema,
  FirmIdSchema,
  RoleRefSetSchema,
  normalizeScopedReferences,
} from "./ids";
import { isPlainRecord } from "./normalization";

type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function freezeJson<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) freezeJson(nested);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const FrozenJsonValueSchema = z.json().transform(freezeJson);

/** The tenant scope every persisted decision-core record must carry. */
export const TenantContextSchema = z.strictObject({
  firmId: FirmIdSchema,
}).readonly();
export type TenantContext = z.infer<typeof TenantContextSchema>;

/** A human actor, tenant-scoped, with the roles attribution recorded at act time. */
export const ActorRefSchema = TenantContextSchema.unwrap().extend({
  actorId: ActorIdSchema,
  roleIds: RoleRefSetSchema,
})
  .refine((actor) => actor.roleIds.every((role) => role.firmId === actor.firmId), {
    message: "role references must belong to the actor tenant",
    path: ["roleIds"],
  })
  .readonly();
export type ActorRef = z.infer<typeof ActorRefSchema>;

/** A system actor (engine, scheduler, reconciler), tenant-scoped like any human. */
export const SystemActorRefSchema = TenantContextSchema.unwrap().extend({
  systemId: z.string().min(1),
}).readonly();
export type SystemActorRef = z.infer<typeof SystemActorRefSchema>;

/**
 * Human or system attribution. The members are strict objects with disjoint keys
 * (actorId vs systemId), so the union is unambiguous without a discriminator.
 */
export const AnyActorRefSchema = z.union([ActorRefSchema, SystemActorRefSchema]).readonly();
export type AnyActorRef = z.infer<typeof AnyActorRefSchema>;

type NormalizableActorRef = {
  readonly firmId?: string;
  readonly roleIds?: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
};

export const normalizeActorRef = <T extends NormalizableActorRef>(
  actor: T,
): T => {
  if (!isPlainRecord(actor) || actor.roleIds === undefined) return actor;
  return {
    ...actor,
    roleIds: normalizeScopedReferences(actor.roleIds),
  } as T;
};

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
}).readonly();
export type TokenizedString = z.infer<typeof TokenizedStringSchema>;

/** Tokenized structured payload (system-event bodies after scrubbing). */
export const TokenizedPayloadSchema = z.strictObject({
  value: z.record(z.string().min(1), FrozenJsonValueSchema).readonly(),
  piiFree: z.literal(true),
}).readonly();
export type TokenizedPayload = z.infer<typeof TokenizedPayloadSchema>;
