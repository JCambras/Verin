/**
 * `bindDomainConfig` - THE ONLY PLACE A FIRM ENTERS (v3 prompt 10; ADR-0056).
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
  type ExecutionTargetRef,
  type ReservationRef,
  type RoleRef,
  type VerificationRuleRef,
} from "@contracts/decision-core/ids";
import { configError, type DomainConfigError } from "./errors";
import type { LoadedDomainConfig } from "./load";
import { resolveParameters, type RefResolver } from "./parameters";

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
    executionTargets.set(capability.id, ExecutionTargetRefSchema.parse({ firmId, id }));
  }
  const verificationRules = new Map(
    config.document.verification.map((rule) => [
      rule.id as string,
      VerificationRuleRefSchema.parse({ firmId, id: rule.id }),
    ]),
  );
  const reservations = new Map(
    config.document.reservations.map((rule) => [
      rule.id as string,
      ReservationRefSchema.parse({ firmId, id: rule.id }),
    ]),
  );
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
    approvalTemplates.set(template.id, ApprovalTemplateRefSchema.parse({ firmId, id }));
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
      roles.push(RoleRefSchema.parse({ firmId, id }));
    }
    evidenceSupplierRoles.set(requirement.evidenceKind, roles);
  }
  // Deferred tenant-scoped parameter references resolve HERE, and the whole
  // parameter object is re-judged by the primitive's own schema with the firm's
  // real references - the load-time neutral parse proved shape, not tenancy.
  const firmRefResolver: RefResolver = (ref) => {
    if (ref.kind !== "evidence-source") return null;
    const id = firm.evidenceSources.get(ref.class);
    return id === undefined ? null : EvidenceSourceRefSchema.parse({ firmId, id });
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
  if (errors.length > 0) return err(errors);
  return ok({
    config,
    firmId,
    domainConfigVersionRef: DomainConfigVersionRefSchema.parse({
      firmId,
      id: config.domainConfigVersionId,
    }),
    executionTargets,
    verificationRules,
    approvalTemplates,
    reservations,
    evidenceSupplierRoles,
    boundParameters,
  });
};
