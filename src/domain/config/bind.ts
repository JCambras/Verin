/**
 * `bindDomainConfig` - THE ONLY PLACE A FIRM ENTERS (v3 prompt 10; ADR-0058).
 *
 * The document is firm-neutral. Binding mints every tenant-scoped reference the
 * merged decision contracts already require - `DomainConfigVersionRef`,
 * `ExecutionTargetRef`, `VerificationRuleRef`, `ApprovalTemplateRef`,
 * `ReservationRef`, `RoleRef`, `EvidenceSourceRef` - and REFUSES when the firm
 * does not actually supply something the document references. It never invents
 * a reference.
 *
 * This is what makes invariant 26 ("Firm B differs only through configuration")
 * a property test rather than a promise: binding the same document for two
 * firms must produce structurally identical output modulo `firmId` (P-1). It
 * also resolves the structural tension that would otherwise force per-firm
 * domain files - almost every merged contract reference is tenant-scoped, but
 * the DOCUMENT must be firm-neutral or the invariant is unprovable.
 */
import { err, ok, type Result } from "@contracts/result";
import {
  ApprovalTemplateRefSchema,
  DomainConfigVersionRefSchema,
  EvidenceSourceRefSchema,
  ExecutionTargetRefSchema,
  ReservationRefSchema,
  RoleRefSchema,
  VerificationRuleRefSchema,
  type ApprovalTemplateRef,
  type DomainConfigVersionRef,
  type EvidenceSourceRef,
  type ExecutionTargetRef,
  type ReservationRef,
  type RoleRef,
  type VerificationRuleRef,
} from "@contracts/decision-core/ids";
import { configError, type DomainConfigError } from "./errors";
import type { LoadedDomainConfig } from "./load";
import { parameterRefClasses, resolveParameters, type RefResolver } from "./parameters";

/**
 * What one firm supplies for the firm-neutral CLASSES a document references.
 * Every map is class -> the firm's own identifier; a missing entry is a binding
 * refusal, never a default.
 */
export type FirmRegistry = {
  readonly firmId: string;
  readonly executionTargets: ReadonlyMap<string, string>;
  readonly evidenceSources: ReadonlyMap<string, string>;
  readonly approvalTemplates: ReadonlyMap<string, string>;
  readonly roles: ReadonlyMap<string, string>;
};

export type BoundDomainConfig = {
  readonly config: LoadedDomainConfig;
  readonly firmId: string;
  readonly domainConfigVersionRef: DomainConfigVersionRef;
  /** capability id -> the firm's execution target. */
  readonly executionTargets: ReadonlyMap<string, ExecutionTargetRef>;
  readonly verificationRules: ReadonlyMap<string, VerificationRuleRef>;
  readonly approvalTemplates: ReadonlyMap<string, ApprovalTemplateRef>;
  readonly reservations: ReadonlyMap<string, ReservationRef>;
  /** evidence kind -> the role references its `role:<class>` suppliers resolve to. */
  readonly evidenceSupplierRoles: ReadonlyMap<string, readonly RoleRef[]>;
  /** binding id -> parameters re-parsed with the firm's real references. */
  readonly boundParameters: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
};

/**
 * A firm-neutral document may not carry firm identity anywhere. Checked
 * structurally over the whole document graph rather than at the header, because
 * the interesting failure is a firmId buried in a primitive parameter.
 */
export const firmIdentityPaths = (value: unknown, path = "", out: string[] = []): readonly string[] => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => firmIdentityPaths(entry, `${path}[${index}]`, out));
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "firmId") out.push(path === "" ? key : `${path}.${key}`);
    firmIdentityPaths(entry, path === "" ? key : `${path}.${key}`, out);
  }
  return out;
};

const requireClass = (
  registry: ReadonlyMap<string, string>,
  className: string,
  what: string,
  path: string,
  errors: DomainConfigError[],
): string | null => {
  const id = registry.get(className);
  if (id === undefined) {
    errors.push(configError("firm-binding", path, `this firm supplies no ${what} for class ${JSON.stringify(className)}`));
    return null;
  }
  return id;
};

/**
 * The narrow view of a decision-core reference schema this module needs. Binding
 * is TOTAL (errors.ts), so a reference is MINTED through `safeParse` and a firm
 * that supplies an unusable identifier - a blank `firmId`, a blank mapped id -
 * accumulates a typed `firm-binding` refusal instead of throwing a ZodError out
 * of a Result-returning API.
 */
type ReferenceSchema<T> = {
  safeParse: (value: unknown) => { readonly success: boolean; readonly data?: T };
};

const mintRef = <T>(
  schema: ReferenceSchema<T>,
  firmId: string,
  id: string,
  path: string,
  errors: DomainConfigError[],
): T | null => {
  const parsed = schema.safeParse({ firmId, id });
  if (parsed.success && parsed.data !== undefined) return parsed.data;
  errors.push(
    configError(
      "firm-binding",
      path,
      `${JSON.stringify(firmId)} and ${JSON.stringify(id)} do not form a usable tenant-scoped reference`,
    ),
  );
  return null;
};

/**
 * The firm-neutral CLASSES one document references, per registry. Sorted and
 * de-duplicated, so it reads as the checklist a firm must answer.
 */
export type RequiredFirmClasses = {
  readonly executionTargets: readonly string[];
  readonly evidenceSources: readonly string[];
  readonly approvalTemplates: readonly string[];
  readonly roles: readonly string[];
};

/**
 * What a firm must supply for this document to bind - derived from the document
 * itself, in exactly the positions `bindDomainConfig` reads below.
 *
 * A registry HAND-WRITTEN against a document falls behind it silently: adding a
 * capability, an approval template, a required role class or a `role:` evidence
 * supplier makes binding refuse, and a surface that treats that refusal as
 * unrecoverable (the demo does - it must never render invented labels) fails at
 * REQUEST time on an ordinary configuration edit. A caller that builds its
 * registry from this cannot fall behind, because the checklist is the document.
 */
export const requiredFirmClasses = (config: LoadedDomainConfig): RequiredFirmClasses => {
  const roles = new Set<string>();
  const evidenceSources = new Set<string>();
  for (const template of config.document.authority.templates) {
    for (const roleClass of template.requiredRoleClasses) roles.add(roleClass);
  }
  for (const requirement of config.document.evidence) {
    for (const supplier of requirement.suppliableBy) {
      if (supplier !== "client" && supplier !== "external") roles.add(supplier.slice("role:".length));
    }
  }
  for (const loaded of config.bindings.values()) {
    for (const className of parameterRefClasses(loaded.binding.parameters, "evidence-source")) {
      evidenceSources.add(className);
    }
  }
  const sorted = (values: Iterable<string>): readonly string[] => [...new Set(values)].sort();
  return {
    executionTargets: sorted(config.document.execution.capabilities.map((c) => c.targetCapabilityClass)),
    evidenceSources: sorted(evidenceSources),
    approvalTemplates: sorted(config.document.authority.templates.map((template) => template.id)),
    roles: sorted(roles),
  };
};

export const bindDomainConfig = (
  config: LoadedDomainConfig,
  firm: FirmRegistry,
): Result<BoundDomainConfig, readonly DomainConfigError[]> => {
  const errors: DomainConfigError[] = [];
  const carried = firmIdentityPaths(config.document);
  for (const path of carried) {
    errors.push(configError("firm-binding", path, "a domain configuration document may not carry firm identity"));
  }
  const firmId = firm.firmId;
  const executionTargets = new Map<string, ExecutionTargetRef>();
  for (const capability of config.document.execution.capabilities) {
    const id = requireClass(
      firm.executionTargets,
      capability.targetCapabilityClass,
      "execution target",
      `execution.capabilities.${capability.id}.targetCapabilityClass`,
      errors,
    );
    if (id === null) continue;
    const path = `execution.capabilities.${capability.id}.targetCapabilityClass`;
    const ref = mintRef(ExecutionTargetRefSchema, firmId, id, path, errors);
    if (ref !== null) executionTargets.set(capability.id, ref);
  }
  const verificationRules = new Map<string, VerificationRuleRef>();
  for (const rule of config.document.verification) {
    const ref = mintRef(VerificationRuleRefSchema, firmId, rule.id, `verification.${rule.id}`, errors);
    if (ref !== null) verificationRules.set(rule.id, ref);
  }
  const reservations = new Map<string, ReservationRef>();
  for (const rule of config.document.reservations) {
    const ref = mintRef(ReservationRefSchema, firmId, rule.id, `reservations.${rule.id}`, errors);
    if (ref !== null) reservations.set(rule.id, ref);
  }
  const approvalTemplates = new Map<string, ApprovalTemplateRef>();
  for (const template of config.document.authority.templates) {
    const id = requireClass(
      firm.approvalTemplates,
      template.id,
      "approval template",
      `authority.templates.${template.id}`,
      errors,
    );
    for (const roleClass of template.requiredRoleClasses) {
      requireClass(firm.roles, roleClass, "role", `authority.templates.${template.id}.requiredRoleClasses`, errors);
    }
    if (id === null) continue;
    const ref = mintRef(ApprovalTemplateRefSchema, firmId, id, `authority.templates.${template.id}`, errors);
    if (ref !== null) approvalTemplates.set(template.id, ref);
  }
  const evidenceSupplierRoles = new Map<string, readonly RoleRef[]>();
  for (const requirement of config.document.evidence) {
    const roles: RoleRef[] = [];
    for (const supplier of requirement.suppliableBy) {
      if (supplier === "client" || supplier === "external") continue;
      const roleClass = supplier.slice("role:".length);
      const id = requireClass(
        firm.roles,
        roleClass,
        "role",
        `evidence.${requirement.evidenceKind}.suppliableBy`,
        errors,
      );
      if (id === null) continue;
      const ref = mintRef(RoleRefSchema, firmId, id, `evidence.${requirement.evidenceKind}.suppliableBy`, errors);
      if (ref !== null) roles.push(ref);
    }
    evidenceSupplierRoles.set(requirement.evidenceKind, roles);
  }
  // Deferred tenant-scoped parameter references resolve HERE, and the whole
  // parameter object is re-judged by the primitive's own schema with the firm's
  // real references - the load-time neutral parse proved shape, not tenancy.
  const firmRefResolver: RefResolver = (ref) => {
    if (ref.kind !== "evidence-source") return null;
    const id = firm.evidenceSources.get(ref.class);
    if (id === undefined) return null;
    const parsed: { readonly success: boolean; readonly data?: EvidenceSourceRef } =
      EvidenceSourceRefSchema.safeParse({ firmId, id });
    return parsed.success && parsed.data !== undefined ? parsed.data : null;
  };
  const boundParameters = new Map<string, Readonly<Record<string, unknown>>>();
  for (const [id, loaded] of config.bindings) {
    const resolved = resolveParameters(
      loaded.owner,
      loaded.binding.parameters,
      firmRefResolver,
      `primitiveBindings.${id}.parameters`,
    );
    if (!resolved.ok) {
      for (const error of resolved.error) errors.push(error);
      continue;
    }
    boundParameters.set(id, resolved.value.parsed);
  }
  const domainConfigVersionRef = mintRef(
    DomainConfigVersionRefSchema,
    firmId,
    config.domainConfigVersionId,
    "version",
    errors,
  );
  if (errors.length > 0 || domainConfigVersionRef === null) return err(errors);
  return ok({
    config,
    firmId,
    domainConfigVersionRef,
    executionTargets,
    verificationRules,
    approvalTemplates,
    reservations,
    evidenceSupplierRoles,
    boundParameters,
  });
};
