import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  SyntaxKind,
  ts,
  type Project,
  type Signature,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  realSemanticProject,
  inMemoryProject,
  moduleReferences,
  REPO_ROOT,
  structuralPiiExposures,
  structuralPiiSignatureExposures,
  typeKey,
} from "./_fence-utils";
import { isPIIField } from "@contracts/pii";

/**
 * LLM-PII-BOUNDARY FENCE (v3 §15.1, INVARIANT 1: "No PII-bearing type is
 * reachable from llm/"). Two derived, compile/import-level checks:
 *
 *  1. MARKER COMPLETENESS (the derivation floor): every type declaration in
 *     the platform layers (contracts/domain/infrastructure — the app layer is
 *     structurally unreachable from llm/ via the dependency-rule fence) that
 *     declares a raw PII-named field must carry the PIIBearing marker or be a
 *     reviewed machine-name escape. Interfaces, type-alias object literals,
 *     and classes all count — a `type Client = { firstName: string }` alias is
 *     the same evasion as an unmarked interface. The marked set is therefore
 *     DERIVED, so a new PII-carrying type cannot ship unmarked and slip past
 *     check 2.
 *
 *  2. IMPORT REACHABILITY: the transitive import closure of every file under
 *     an llm/ directory must contain NO module that declares a PIIBearing-
 *     marked type. Type-only imports count — a type leak is exactly what this
 *     fence exists to stop.
 *
 * The runtime half lives in the scrubber factory (tokenize.ts) and the LLM
 * adapter ingress gate (parseMaskedLlmRequest) — scrub-by-construction plus a
 * fail-closed parse, tested in unit/llm-boundary.test.ts.
 */

// Reviewed machine-name escapes (exact `file :: Interface.prop`): fields whose
// name matches the PII regex but whose VALUE is a machine identifier, never a
// person's data. Anything new must be marked or reviewed into this list.
const NON_PII_ESCAPES: Array<{ ref: string; why: string }> = [
  { ref: "src/domain/schema/entities.ts :: Org.name", why: "the firm's own identity, not client PII (audit scrubbing still redacts it belt-and-braces)" },
  { ref: "src/domain/workflow/engine.ts :: FlowDefinition.name", why: "machine-readable flow id" },
  { ref: "src/domain/workflow/engine.ts :: FlowDefinition.steps.name", why: "machine-readable step id, reached as a nested path through FlowDefinition.steps" },
  { ref: "src/domain/workflow/flows/account-opening.ts :: FlowFieldSpec.name", why: "form-field key for the generic renderer" },
  { ref: "src/infrastructure/observability/tracer.ts :: RecordedSpan.name", why: "OTel span name (machine)" },
  { ref: "src/infrastructure/store/migration-errors.ts :: MigrationIdentity.name", why: "migration label (machine)" },
  { ref: "src/infrastructure/store/migrations.ts :: Migration.name", why: "migration label (machine)" },
  // Decision-core (prompt 5, v3 §5) evidence REFERENCES. The PII field rule reads
  // `evidence` as sensitive because the projection layer's `evidence` really is the
  // client payload; these are the other thing that word names - branded ids and
  // request descriptors that point AT evidence. Every one is exact-match and proven
  // load-bearing by the escapes-suppress-something assertion below, so a decision-core
  // field that later starts carrying contents cannot hide behind them.
  { ref: "src/contracts/decision-core/decision.ts :: ExplanationTenantReferences.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/decision.ts :: ExplanationTenantReferences.childNodes.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/decision.ts :: NormalizableDecisionRecord.result.executionPlan.steps.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/decision.ts :: NormalizableDecisionRecord.result.executionPlan.steps.compensatingAction.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/decision.ts :: NormalizableDecisionRecord.result.blockers.resolvingEvidence", why: "EvidenceRequest descriptors (kind + scope) naming what would unblock a decision - a request FOR evidence, never evidence itself" },
  { ref: "src/contracts/decision-core/decision.ts :: BlockedDecision.blockers.resolvingEvidence", why: "EvidenceRequest descriptors (kind + scope) naming what would unblock a decision - a request FOR evidence, never evidence itself" },
  { ref: "src/contracts/decision-core/decision.ts :: DecisionResult.blockers.resolvingEvidence", why: "EvidenceRequest descriptors (kind + scope) naming what would unblock a decision - a request FOR evidence, never evidence itself" },
  { ref: "src/contracts/decision-core/decision.ts :: RevaluationCondition.evidenceKind", why: "a branded EvidenceKind discriminator (which KIND of evidence is wanted), carrying no subject data" },
  { ref: "src/contracts/decision-core/decision.ts :: DecisionRecord.explanationTrace.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/decision.ts :: DecisionRecord.reevaluateWhen.evidenceKind", why: "a branded EvidenceKind discriminator (which KIND of evidence is wanted), carrying no subject data" },
  { ref: "src/contracts/decision-core/evidence.ts :: DecisionInputBundle.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/execution.ts :: NormalizableExecutionPrecondition.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/execution.ts :: ExecutionPrecondition.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/execution.ts :: NormalizableExternalAction.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/execution.ts :: RetrySafeExternalAction.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/execution.ts :: CompensatingAction.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/execution.ts :: ExecutionStep.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/execution.ts :: NormalizableExecutionPlan.steps.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/execution.ts :: NormalizableExecutionPlan.steps.compensatingAction.preconditions.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/explanation.ts :: ExplanationNode.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/explanation.ts :: ExplanationNode.childNodes.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/ids.ts :: ExecutionPreconditionReferenceSet.requiredEvidenceSnapshotRefs", why: "branded EvidenceSnapshotId references an execution precondition must revalidate against - identifiers, not evidence contents" },
  { ref: "src/contracts/decision-core/normalization.ts :: NormalizableExplanationNode.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/normalization.ts :: NormalizableExplanationNode.childNodes.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/serialization.ts :: BundleHashPayload.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/serialization.ts :: DecisionHashPayload.explanationTrace.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/serialization.ts :: DecisionHashPayload.reevaluateWhen.evidenceKind", why: "a branded EvidenceKind discriminator (which KIND of evidence is wanted), carrying no subject data" },
  { ref: "src/contracts/decision-core/serialization.ts :: BundleHashPreimage.payload.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/serialization.ts :: DecisionHashPreimage.payload.explanationTrace.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/serialization.ts :: DecisionHashPreimage.payload.reevaluateWhen.evidenceKind", why: "a branded EvidenceKind discriminator (which KIND of evidence is wanted), carrying no subject data" },
  { ref: "src/contracts/decision-core/serialization.ts :: NormalizableDecisionInputBundle.evidenceSnapshotRefs", why: "a list of branded EvidenceSnapshotId REFERENCES (v3 §5) - the pointer to a snapshot, never the snapshot's contents" },
  { ref: "src/contracts/decision-core/trigger.ts :: EvidenceRequest.evidenceKind", why: "a branded EvidenceKind discriminator (which KIND of evidence is wanted), carrying no subject data" },
  { ref: "src/contracts/decision-core/trigger.ts :: ResolvableBlocker.resolvingEvidence", why: "EvidenceRequest descriptors (kind + scope) naming what would unblock a decision - a request FOR evidence, never evidence itself" },
  { ref: "src/contracts/decision-core/trigger.ts :: ResolvableBlocker.resolvingEvidence.evidenceKind", why: "a branded EvidenceKind discriminator (which KIND of evidence is wanted), carrying no subject data" },
  { ref: "src/contracts/decision-core/trigger.ts :: NormalizableResolvableBlocker.resolvingEvidence", why: "EvidenceRequest descriptors (kind + scope) naming what would unblock a decision - a request FOR evidence, never evidence itself" },
  { ref: "src/contracts/decision-core/trigger.ts :: ResolutionState.gaps.evidenceKind", why: "a branded EvidenceKind discriminator (which KIND of evidence is wanted), carrying no subject data" },
];
const ESCAPE_SET = new Set(NON_PII_ESCAPES.map((e) => e.ref));
const OPAQUE_LLM_INGRESS_ESCAPES = [
  "src/contracts/errors.ts :: isAppError(value)",
  "src/contracts/pii.ts :: assertNoAmbiguousSensitiveText(payload)",
  "src/contracts/pii.ts :: assertNoPIIValues(payload)",
  "src/infrastructure/llm/request-schema.ts :: parseMaskedLlmRequest(input)",
  "src/infrastructure/pii/scrub.ts :: scrub(value)",
  "src/infrastructure/pii/scrub.ts :: scrub.return",
  "src/infrastructure/pii/tokenize.ts :: isSealedTokenized(value)",
] as const;
const OPAQUE_ESCAPE_SET = new Set<string>(OPAQUE_LLM_INGRESS_ESCAPES);

function normalizePath(sf: SourceFile): string {
  const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
  return rel.startsWith("..") ? sf.getFilePath().replace(/^\//, "") : rel;
}

interface PIITypeDecl {
  readonly name: string;
  readonly exported: boolean;
  readonly marked: boolean;
  readonly props: ReadonlyArray<{ readonly name: string; readonly type: Type }>;
  readonly nestedExposures: readonly string[];
  readonly callableExposures: readonly string[];
}

function declaredAs(type: Type, file: string, name: string): boolean {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = typeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const symbol of [current.getAliasSymbol(), current.getSymbol()]) {
      if (
        symbol?.getName() === name &&
        symbol.getDeclarations().some((declaration) =>
          normalizePath(declaration.getSourceFile()) === file
        )
      ) {
        return true;
      }
    }
    queue.push(
      ...current.getUnionTypes(),
      ...current.getIntersectionTypes(),
      ...current.getBaseTypes(),
      ...current.getAliasTypeArguments(),
      ...current.getTypeArguments(),
    );
  }
  return false;
}

function isTokenized(type: Type): boolean {
  return declaredAs(type, "src/contracts/tokenized.ts", "Tokenized");
}

function isSecretValue(type: Type): boolean {
  return declaredAs(type, "src/contracts/secret.ts", "SecretValue");
}

function isPIIBearingType(type: Type): boolean {
  return declaredAs(type, "src/contracts/pii.ts", "PIIBearing");
}

function isLeafType(type: Type): boolean {
  return type.isAny() ||
    type.isUnknown() ||
    type.isNever() ||
    type.isString() ||
    type.isStringLiteral() ||
    type.isNumber() ||
    type.isNumberLiteral() ||
    type.isBoolean() ||
    type.isBooleanLiteral() ||
    type.isNull() ||
    type.isUndefined() ||
    type.isVoid();
}

function isLeafComposite(type: Type): boolean {
  if (isLeafType(type)) return true;
  const members = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  return members.length > 0 && members.every(isLeafComposite);
}

function aliasProperties(
  type: Type,
  location: Node,
): Array<{ readonly name: string; readonly type: Type }> {
  if (isLeafComposite(type)) return [];
  const members = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  const candidates = members.length ? members.flatMap((member) =>
    aliasProperties(member, location)
  ) : type.getProperties().map((property) => {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0] ??
      location;
    return {
      name: property.getName(),
      type: property.getTypeAtLocation(declaration),
    };
  });
  const unique = new Map<string, { readonly name: string; readonly type: Type }>();
  for (const property of candidates) {
    unique.set(`${property.name}::${typeKey(property.type)}`, property);
  }
  return [...unique.values()];
}

function inlinePIIExposures(
  type: Type,
  path: string,
  seen = new Set<string>(),
  location?: Node,
  includeMarked = false,
  escapes: ReadonlySet<string> = ESCAPE_SET,
): string[] {
  return structuralPiiExposures(type, {
    path,
    seen,
    location,
    includeMarked,
    isEscaped: (propertyPath, declaration) =>
      propertyIsEscaped(propertyPath, declaration, escapes),
  });
}

function signaturePIIExposures(
  signature: Signature,
  path: string,
  seen = new Set<string>(),
  includeMarked = false,
  checkParameterNames = true,
  escapes: ReadonlySet<string> = ESCAPE_SET,
): string[] {
  return structuralPiiSignatureExposures(signature, {
    path,
    seen,
    includeMarked,
    checkParameterNames,
    isEscaped: (propertyPath, declaration) =>
      propertyIsEscaped(propertyPath, declaration, escapes),
  });
}

function callablePIIExposures(
  type: Type,
  includeMarked = false,
  checkParameterNames = true,
  escapes: ReadonlySet<string> = ESCAPE_SET,
): string[] {
  const exposures = type.getCallSignatures().flatMap((signature) =>
    signaturePIIExposures(
      signature,
      "<call>",
      new Set(),
      includeMarked,
      checkParameterNames,
      escapes,
    )
  );
  for (const property of type.getProperties()) {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0];
    if (!declaration) continue;
    // PROJECT members only — the same rule inlinePIIExposures applies one function
    // above. A branded primitive (`type FirmId = string & Brand`) carries the whole
    // String prototype, so without this every branded id in decision-core reported
    // `String.prototype.anchor(name)` as a PII surface: a lib signature nobody wrote,
    // nobody can change, and that carries no tenant data.
    if (!normalizePath(declaration.getSourceFile()).startsWith("src/")) continue;
    const propertyType = property.getTypeAtLocation(declaration);
    for (const signature of propertyType.getCallSignatures()) {
      exposures.push(
        ...signaturePIIExposures(
          signature,
          property.getName(),
          new Set(),
          includeMarked,
          checkParameterNames,
          escapes,
        ),
      );
    }
  }
  return [...new Set(exposures)];
}

/**
 * An escape is keyed on the FULL dotted path the detector emits, not on the
 * property's nearest ancestor declaration: keying on the ancestor would let an
 * escape written for a top-level machine-named field silently cover a
 * same-named field inside any INLINE nested type literal of that declaration.
 */
function propertyIsEscaped(
  propertyPath: string,
  declaration: Node,
  escapes: ReadonlySet<string>,
): boolean {
  const owner = declaration.getFirstAncestor((ancestor) =>
    Node.isInterfaceDeclaration(ancestor) ||
    Node.isClassDeclaration(ancestor) ||
    Node.isTypeAliasDeclaration(ancestor)
  );
  if (!owner) return false;
  const name = Node.isInterfaceDeclaration(owner) ||
      Node.isClassDeclaration(owner) ||
      Node.isTypeAliasDeclaration(owner)
    ? owner.getName()
    : undefined;
  if (!name) return false;
  return escapes.has(
    `${normalizePath(declaration.getSourceFile())} :: ${name}.${propertyPath}`,
  );
}

/** Every property-bearing type declaration — interface, type-alias object literal, or class. */
function piiTypeDeclarations(
  sf: SourceFile,
  escapes: ReadonlySet<string> = ESCAPE_SET,
): PIITypeDecl[] {
  const out: PIITypeDecl[] = [];
  for (const iface of sf.getInterfaces()) {
    if (iface.getName() === "PIIBearing") continue; // the marker itself
    out.push({
      name: iface.getName(),
      exported: iface.isExported(),
      marked: isPIIBearingType(iface.getType()),
      props: iface.getProperties().map((property) => ({
        name: property.getName(),
        type: property.getType(),
      })),
      nestedExposures: iface.getProperties().flatMap((property) =>
        inlinePIIExposures(
          property.getType(),
          property.getName(),
          new Set(),
          property,
          false,
          escapes,
        )
      ),
      callableExposures: callablePIIExposures(iface.getType(), false, true, escapes),
    });
  }
  for (const alias of sf.getTypeAliases()) {
    const aliasType = alias.getType();
    out.push({
      name: alias.getName(),
      exported: alias.isExported(),
      marked: isPIIBearingType(aliasType),
      props: aliasProperties(aliasType, alias),
      nestedExposures: aliasProperties(aliasType, alias).flatMap((property) =>
        inlinePIIExposures(
          property.type,
          property.name,
          new Set(),
          alias,
          false,
          escapes,
        )
      ),
      callableExposures: isLeafComposite(aliasType)
        ? []
        : callablePIIExposures(aliasType, false, true, escapes),
    });
  }
  for (const cls of sf.getClasses()) {
    out.push({
      name: cls.getName() ?? "(anonymous class)",
      exported: cls.isExported(),
      marked: isPIIBearingType(cls.getType()) ||
        cls.getImplements().some((heritage) =>
          isPIIBearingType(heritage.getType())
        ),
      props: cls.getProperties().map((property) => ({
        name: property.getName(),
        type: property.getType(),
      })),
      nestedExposures: cls.getProperties().flatMap((property) =>
        inlinePIIExposures(
          property.getType(),
          property.getName(),
          new Set(),
          property,
          false,
          escapes,
        )
      ),
      callableExposures: callablePIIExposures(cls.getType(), false, true, escapes),
    });
  }
  return out;
}

/**
 * PII reachable through an exported VALUE, not just a callable. `export const
 * DEMO_CLIENT = { firstName: "Ada", ssn: "…" }` has an anonymous object type
 * with no call signature, so a callable-only walk marks nothing and the value is
 * import-reachable from llm/ with the reachability fence green.
 */
function exportedValuePIIExposures(sf: SourceFile): string[] {
  const exposures: string[] = [];
  for (const declaration of sf.getVariableDeclarations().filter((candidate) =>
    candidate.isExported()
  )) {
    exposures.push(...inlinePIIExposures(
      declaration.getType(),
      declaration.getName(),
      new Set(),
      declaration,
      true,
    ));
  }
  return [...new Set(exposures)];
}

function exportedCallablePIIExposures(sf: SourceFile): string[] {
  const exposures = sf.getFunctions()
    .filter((candidate) => candidate.isExported())
    .flatMap((fn) =>
      signaturePIIExposures(
        fn.getSignature(),
        fn.getName() ?? "<call>",
        new Set(),
        true,
        false,
      )
    );
  for (const declaration of sf.getVariableDeclarations().filter((candidate) =>
    candidate.isExported()
  )) {
    exposures.push(
      ...callablePIIExposures(declaration.getType(), true, false),
    );
  }
  return [...new Set(exposures)];
}

function opaqueTypeExposures(
  type: Type,
  path: string,
  seen = new Set<string>(),
  location?: Node,
): string[] {
  if (isTokenized(type) || isSecretValue(type)) return [];
  if (type.isAny() || type.isUnknown()) return [path];
  if (isLeafType(type)) return [];
  const key = typeKey(type);
  if (seen.has(key)) return [];
  const nextSeen = new Set(seen).add(key);
  const composite = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  if (composite.length) {
    return composite.flatMap((member) =>
      opaqueTypeExposures(member, path, nextSeen, location)
    );
  }
  const nestedArguments = [
    ...type.getAliasTypeArguments(),
    ...type.getTypeArguments(),
  ].flatMap((argument) =>
    opaqueTypeExposures(argument, path, nextSeen, location)
  );
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const inspectProperties = !symbol || symbol.getDeclarations().some((declaration) =>
    Node.isTypeLiteral(declaration) ||
    normalizePath(declaration.getSourceFile()).startsWith("src/")
  );
  if (!inspectProperties) return nestedArguments;
  const properties = type.getProperties().flatMap((property) => {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0] ??
      location;
    return declaration
      ? opaqueTypeExposures(
        property.getTypeAtLocation(declaration),
        `${path}.${property.getName()}`,
        nextSeen,
        declaration,
      )
      : [];
  });
  const calls = type.getCallSignatures().flatMap((signature) =>
    signatureOpaqueExposures(signature, `${path}.<call>`, nextSeen)
  );
  return [...nestedArguments, ...properties, ...calls];
}

function signatureOpaqueExposures(
  signature: Signature,
  path: string,
  seen = new Set<string>(),
): string[] {
  const parameters = signature.getParameters().flatMap((parameter) => {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    return declaration
      ? opaqueTypeExposures(
        parameter.getTypeAtLocation(declaration),
        `${path}(${parameter.getName()})`,
        seen,
        declaration,
      )
      : [];
  });
  return [
    ...parameters,
    ...opaqueTypeExposures(
      signature.getReturnType(),
      `${path}.return`,
      seen,
      signature.getDeclaration(),
    ),
  ];
}

function exportedOpaqueRefs(sf: SourceFile): string[] {
  const file = normalizePath(sf);
  const refs: string[] = [];
  const add = (name: string, signature: Signature): void => {
    refs.push(...signatureOpaqueExposures(signature, name).map((exposure) =>
      `${file} :: ${exposure}`
    ));
  };
  for (const fn of sf.getFunctions().filter((candidate) => candidate.isExported())) {
    add(fn.getName() ?? "<call>", fn.getSignature());
  }
  for (const variable of sf.getVariableDeclarations().filter((candidate) =>
    candidate.isExported()
  )) {
    refs.push(...opaqueTypeExposures(
      variable.getType(),
      variable.getName(),
      new Set(),
      variable,
    ).map((exposure) => `${file} :: ${exposure}`));
  }
  for (const cls of sf.getClasses().filter((candidate) => candidate.isExported())) {
    for (const property of cls.getProperties()) {
      refs.push(...opaqueTypeExposures(
        property.getType(),
        `${cls.getName() ?? "<anonymous>"}.${property.getName()}`,
        new Set(),
        property,
      ).map((exposure) => `${file} :: ${exposure}`));
    }
    for (const method of cls.getMethods()) {
      if (method.getScope() === "private" || method.getScope() === "protected") continue;
      add(`${cls.getName() ?? "<anonymous>"}.${method.getName()}`, method.getSignature());
    }
  }
  for (const iface of sf.getInterfaces().filter((candidate) => candidate.isExported())) {
    refs.push(...opaqueTypeExposures(
      iface.getType(),
      iface.getName(),
      new Set(),
      iface,
    ).map((exposure) => `${file} :: ${exposure}`));
  }
  for (const alias of sf.getTypeAliases().filter((candidate) => candidate.isExported())) {
    refs.push(...opaqueTypeExposures(
      alias.getType(),
      alias.getName(),
      new Set(),
      alias,
    ).map((exposure) => `${file} :: ${exposure}`));
  }
  return [...new Set(refs)];
}

/** Platform-layer type declarations with raw PII-named fields that are neither marked nor escaped. */
export function detectUnmarkedPIITypes(project: Project, escapes: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizePath(sf);
    if (!/^src\/(contracts|domain|infrastructure)\//.test(normalized)) continue;
    for (const decl of piiTypeDeclarations(sf, escapes)) {
      if (decl.marked) continue;
      for (const prop of decl.props) {
        if (!isPIIField(prop.name) || isTokenized(prop.type)) continue;
        const ref = `${normalized} :: ${decl.name}.${prop.name}`;
        if (!escapes.has(ref)) out.push(ref);
      }
      for (const exposure of decl.nestedExposures) {
        const ref = `${normalized} :: ${decl.name}.${exposure}`;
        if (!escapes.has(ref)) out.push(ref);
      }
      for (const exposure of decl.callableExposures) {
        const ref = `${normalized} :: ${decl.name}.${exposure}`;
        if (!escapes.has(ref)) out.push(ref);
      }
    }
  }
  return [...new Set(out)];
}

/** Modules that declare at least one PIIBearing-marked type (interface, alias, or class). */
export function markedModules(project: Project): Set<string> {
  const out = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizePath(sf);
    if (exportedCallablePIIExposures(sf).length > 0 ||
      exportedValuePIIExposures(sf).length > 0 ||
      piiTypeDeclarations(sf).some((declaration) => {
        if (declaration.marked) return true;
        if (!declaration.exported) return false;
        return declaration.nestedExposures.length > 0 ||
          declaration.callableExposures.length > 0 ||
          declaration.props.some((property) =>
            isPIIField(property.name) &&
            !isTokenized(property.type) &&
            !isSecretValue(property.type) &&
            !ESCAPE_SET.has(`${normalized} :: ${declaration.name}.${property.name}`)
          );
      })) {
      out.add(normalized);
    }
  }
  return out;
}

function unverifiableModuleLoadLines(sf: SourceFile): number[] {
  const lines: number[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    const isModuleLoad = expression.getKindName() === "ImportKeyword" ||
      expression.getText() === "require";
    if (!isModuleLoad) continue;
    const argument = call.getArguments()[0];
    if (!argument || !Node.isStringLiteral(argument)) {
      lines.push(call.getStartLineNumber());
    }
  }
  return lines;
}

/**
 * The project's files indexed by normalized path - the "is this path in the
 * project?" set and the "which file is it?" lookup in one structure.
 *
 * Keyed on the Project OBJECT, never module-global: the companions below each
 * build their own in-memory Project, and one shared index would answer a
 * fixture's resolution question with another fixture's files. First declaration
 * wins, matching the `find` this replaces.
 */
const SOURCE_FILES_BY_PATH = new WeakMap<Project, ReadonlyMap<string, SourceFile>>();

function sourceFilesByNormalizedPath(project: Project): ReadonlyMap<string, SourceFile> {
  const cached = SOURCE_FILES_BY_PATH.get(project);
  if (cached) return cached;
  const index = new Map<string, SourceFile>();
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizePath(sf);
    if (!index.has(normalized)) index.set(normalized, sf);
  }
  SOURCE_FILES_BY_PATH.set(project, index);
  return index;
}

/**
 * Resolve an import specifier to a project file's normalized path (alias,
 * @/-prefix, and relative forms; .ts/.tsx/index.ts candidates), or null for
 * external modules.
 */
export function resolveToProjectPath(project: Project, fromNormalized: string, spec: string): string | null {
  const known = sourceFilesByNormalizedPath(project);
  const sourceFile = known.get(fromNormalized);
  if (!sourceFile) return null;
  const resolved = ts.resolveModuleName(
    spec,
    sourceFile.getFilePath(),
    project.getCompilerOptions(),
    project.getModuleResolutionHost(),
  ).resolvedModule?.resolvedFileName;
  if (!resolved) return null;
  const target = project.getSourceFile(resolved);
  const normalized = target
    ? normalizePath(target)
    : relative(REPO_ROOT, resolved).replace(/\\/g, "/");
  return known.has(normalized) ? normalized : null;
}

/** Marked modules reachable (transitively) from any file under an llm/ directory. */
export function detectPIIReachableFromLlm(project: Project): string[] {
  const marked = markedModules(project);
  const byPath = new Map(project.getSourceFiles().map((sf) => [normalizePath(sf), sf] as const));
  const violations: string[] = [];
  const llmFiles = [...byPath.keys()].filter((p) => /\/llm\//.test(p));
  for (const origin of llmFiles) {
    if (marked.has(origin)) {
      violations.push(`${origin} declares a PII-bearing type inside llm/`);
    }
    const visited = new Set<string>([origin]);
    const queue = [origin];
    while (queue.length) {
      const current = queue.shift()!;
      const sf = byPath.get(current);
      if (!sf) continue;
      for (const ref of exportedOpaqueRefs(sf)) {
        if (!OPAQUE_ESCAPE_SET.has(ref)) {
          violations.push(`${origin} reaches unverifiable opaque export ${ref}`);
        }
      }
      for (const line of unverifiableModuleLoadLines(sf)) {
        violations.push(
          `${origin} reaches an unverifiable module load in ${current}:${line}`,
        );
      }
      for (const { specifier: spec, line, kind } of moduleReferences(sf)) {
        // A null specifier is a load this walk CANNOT follow, so it fails closed
        // here rather than being assumed reported elsewhere. It is not:
        // unverifiableModuleLoadLines only fires on the `import` keyword or a callee
        // literally named `require`, while a `createRequire(import.meta.url)` loader
        // — or `module.require` — arrives as {specifier: null, kind: "create-require"
        // | "require-reference"} and would otherwise walk straight past a
        // PIIBearing module with the fence green.
        if (spec === null) {
          violations.push(
            `${origin} reaches an unresolvable ${kind} module load in ${current}:${line}`,
          );
          continue;
        }
        const target = resolveToProjectPath(project, current, spec);
        if (!target || visited.has(target)) continue;
        visited.add(target);
        if (marked.has(target)) {
          violations.push(`${origin} reaches PII-bearing module ${target} (via import of '${spec}' in ${current})`);
          continue; // report, but keep walking other branches
        }
        queue.push(target);
      }
    }
  }
  return violations;
}

describe("llm-pii-boundary fence (v3 invariant 1)", () => {
  const project = realSemanticProject();

  it("enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked (or a reviewed machine-name escape)", () => {
    const unmarked = detectUnmarkedPIITypes(project, ESCAPE_SET);
    expect(unmarked, `unmarked PII-bearing types (extend PIIBearing or review into NON_PII_ESCAPES):\n${unmarked.join("\n")}`).toEqual([]);
  });

  it("enforces: every escape is LOAD-BEARING (it suppresses a finding the detector really emits)", () => {
    // Proving the property is merely DECLARED lets a dead escape (one whose
    // declaration is PIIBearing-marked, and therefore skipped before its
    // properties are read) live forever. Run the detector with NO escapes: an
    // entry that does not appear there suppresses nothing.
    const unescaped = new Set(detectUnmarkedPIITypes(project, new Set()));
    const stale = NON_PII_ESCAPES.filter((e) => !unescaped.has(e.ref)).map((e) => e.ref);
    expect(stale, `escapes that suppress nothing:\n${stale.join("\n")}`).toEqual([]);
  });

  it("enforces: opaque ingress escapes are exact and live", () => {
    const live = new Set(
      project.getSourceFiles().flatMap(exportedOpaqueRefs),
    );
    expect(
      OPAQUE_LLM_INGRESS_ESCAPES.filter((ref) => !live.has(ref)),
    ).toEqual([]);
  });

  it("enforces: the marked set is non-empty (a gutted marker would pass reachability vacuously — charter #4)", () => {
    expect(markedModules(project).size).toBeGreaterThanOrEqual(4);
  });

  it("enforces: persisted workflow state retains the PII-bearing marker", () => {
    const engine = project.getSourceFiles().find((sf) =>
      normalizePath(sf) === "src/domain/workflow/engine.ts"
    );
    expect(engine).toBeTruthy();
    const declarations = piiTypeDeclarations(engine!);
    for (const name of ["FlowData", "ExecutionState", "FlowRunResult"]) {
      expect(
        declarations.find((declaration) => declaration.name === name)?.marked,
        `${name} must retain PIIBearing`,
      ).toBe(true);
    }
  });

  it("enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it (invariant 1)", () => {
    const llmFiles = project.getSourceFiles().filter((sf) => /\/llm\//.test(normalizePath(sf)));
    expect(
      llmFiles.map(normalizePath),
      "the masked request boundary is missing - invariant 1 would be vacuous",
    ).toContain("src/infrastructure/llm/request-schema.ts");
    const reached = detectPIIReachableFromLlm(project);
    expect(reached, `PII-bearing types reachable from llm/:\n${reached.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): planted leaks are caught", () => {
    const marker = `export interface PIIBearing { readonly __pii?: "pii-bearing" }`;
    const entities = `import type { PIIBearing } from "@contracts/pii";\nexport interface Contact extends PIIBearing { firstName: string }`;

    it("flags an llm file importing a marked module DIRECTLY (even type-only)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/entities.ts": entities,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "@domain/schema/entities";\nexport type Leak = Contact;`,
      });
      const v = detectPIIReachableFromLlm(project);
      expect(v.some((violation) => violation.includes("entities"))).toBe(true);
    });
    it("flags a PII-bearing type declared inside llm itself", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/infrastructure/llm/evil.ts": `import type { PIIBearing } from "@contracts/pii"; export interface RawRequest extends PIIBearing { requestText: string }`,
      });
      expect(detectPIIReachableFromLlm(project)).toEqual([
        "src/infrastructure/llm/evil.ts declares a PII-bearing type inside llm/",
      ]);
    });
    it("treats requestText, rawText, and evidence as PII-bearing fields", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts": `export interface Raw { requestText: string; rawText: string; evidence: object }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/infrastructure/evil.ts :: Raw.requestText",
        "src/infrastructure/evil.ts :: Raw.rawText",
        "src/infrastructure/evil.ts :: Raw.evidence",
      ]);
    });
    it("flags a TRANSITIVE leak (llm -> helper -> marked module)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/entities.ts": entities,
        "/src/infrastructure/helper.ts": `export { type Contact } from "../domain/schema/entities";`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "../helper";\nexport type Leak = Contact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBeGreaterThanOrEqual(1);
    });
    it("allows llm importing the marker-DECLARING module (contracts/pii declares no marked type)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/infrastructure/llm/fine.ts": `import type { PIIBearing } from "@contracts/pii";\nexport const ok = 1;`,
      });
      expect(detectPIIReachableFromLlm(project)).toEqual([]);
    });
    it("flags an UNMARKED interface with a raw PII field (completeness floor)", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky.ts": `export interface Client { firstName: string }`,
      });
      const v = detectUnmarkedPIITypes(project, ESCAPE_SET);
      expect(v).toEqual(["src/domain/sneaky.ts :: Client.firstName"]);
    });
    it("does not flag a Tokenized-typed PII-named field (tokens are the point)", () => {
      const project = inMemoryProject({
        "/src/contracts/tokenized.ts": `export interface Tokenized<T> { value: T; piiFree: true }`,
        "/src/domain/fine.ts": `import type { Tokenized } from "@contracts/tokenized";\nexport interface Masked { firstName: Tokenized<string> }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([]);
    });
    it("resolves Tokenized aliases semantically and rejects same-named impostors", () => {
      const project = inMemoryProject({
        "/src/contracts/tokenized.ts": `export interface Tokenized<T> { value: T; piiFree: true }`,
        "/src/domain/fine.ts": `
          import type { Tokenized as Sealed } from "@contracts/tokenized";
          export interface Masked { firstName: Sealed<string> }
        `,
        "/src/domain/evil.ts": `
          interface Tokenized<T> { value: T }
          export interface Raw { firstName: Tokenized<string> }
        `,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: Raw.firstName",
      ]);
    });
    it("flags PII nested in method parameters and callable signatures", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export interface DependencyShape {
            persist(input: { firstName: string }): Promise<void>;
          }
          export interface CallableShape {
            (input: { accountNumber: string }): void;
          }
          export type FunctionShape = (input: { email: string }) => void;
        `,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: DependencyShape.persist(input).firstName",
        "src/domain/evil.ts :: CallableShape.<call>(input).accountNumber",
        "src/domain/evil.ts :: FunctionShape.<call>(input).email",
      ]);
    });
    it("flags PII nested in exported functions and named envelopes", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export interface Envelope {
            payload: { email: string };
          }
          export function submit(input: { firstName: string }): void {
            void input;
          }
        `,
        "/src/infrastructure/llm/consumer.ts": `
          import { submit } from "@domain/evil";
          export const use = submit;
        `,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: Envelope.payload.email",
      ]);
      expect(markedModules(project)).toContain("src/domain/evil.ts");
      expect(detectPIIReachableFromLlm(project).some((violation) =>
        violation.includes("src/domain/evil.ts")
      )).toBe(true);
    });
    it("does not flag Tokenized values nested in callable parameters", () => {
      const project = inMemoryProject({
        "/src/contracts/tokenized.ts": `export interface Tokenized<T> { value: T; piiFree: true }`,
        "/src/domain/fine.ts": `
          import type { Tokenized as Sealed } from "@contracts/tokenized";
          export interface Handler {
            submit(input: { firstName: Sealed<string> }): void;
          }
        `,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([]);
    });
    it("an escape is EXACT-match: a new PII prop on an escaped interface is still flagged", () => {
      const project = inMemoryProject({
        "/src/domain/workflow/engine.ts": `export interface FlowDefinition { name: string; email: string }`,
      });
      const v = detectUnmarkedPIITypes(project, ESCAPE_SET);
      expect(v).toEqual(["src/domain/workflow/engine.ts :: FlowDefinition.email"]);
    });
    it("an escape does NOT cover a same-named field in an inline nested type literal", () => {
      const project = inMemoryProject({
        "/src/domain/workflow/engine.ts": `export interface FlowDefinition { name: string; client: { name: string } }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/workflow/engine.ts :: FlowDefinition.client.name",
      ]);
    });
    it("honours the INJECTED escape set for nested paths, not a hardcoded module constant", () => {
      const project = inMemoryProject({
        "/src/infrastructure/observability/tracer.ts": `export interface RecordedSpan { name: string; attributes: { name: string } }`,
      });
      const nested = "src/infrastructure/observability/tracer.ts :: RecordedSpan.attributes.name";
      // With NO escapes both the top-level and the nested field are reported —
      // which is what makes the "every escape is load-bearing" companion able to
      // see a nested escape at all.
      expect(detectUnmarkedPIITypes(project, new Set())).toContain(nested);
      // With the nested escape injected, only it is suppressed.
      expect(detectUnmarkedPIITypes(
        project,
        new Set([...ESCAPE_SET, nested]),
      )).toEqual([]);
    });

    it("flags an exported PII-shaped VALUE and its reachability from llm/", () => {
      const project = inMemoryProject({
        "/src/domain/demo-roster.ts": `
          export const DEMO_CLIENT = { firstName: "Ada", email: "ada@example.com" };
        `,
        "/src/infrastructure/llm/evil.ts": `
          import { DEMO_CLIENT } from "@domain/demo-roster";
          export const use = DEMO_CLIENT;
        `,
      });
      expect(markedModules(project)).toContain("src/domain/demo-roster.ts");
      expect(detectPIIReachableFromLlm(project).some((violation) =>
        violation.includes("src/domain/demo-roster.ts")
      )).toBe(true);
    });

    it("flags an UNMARKED type-alias object literal with a raw PII field (alias evasion)", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky-alias.ts": `export type Client = { firstName: string }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual(["src/domain/sneaky-alias.ts :: Client.firstName"]);
    });
    it("flags an UNMARKED type-alias union/intersection member with a raw PII field", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky-union.ts": `export type Party = { kind: "org" } | { kind: "person"; email: string }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual(["src/domain/sneaky-union.ts :: Party.email"]);
    });
    it("flags an UNMARKED class with a raw PII field (class evasion)", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky-class.ts": `export class Client { firstName = "" }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual(["src/domain/sneaky-class.ts :: Client.firstName"]);
    });
    it("flags llm reaching a module whose PII type is a MARKED type alias (markedModules covers aliases)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/alias-entities.ts": `import type { PIIBearing } from "@contracts/pii";\nexport type Contact = PIIBearing & { firstName: string };`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "@domain/schema/alias-entities";\nexport type Leak = Contact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBeGreaterThanOrEqual(1);
    });
    it("flags a marked mapped alias with no syntactic object literal", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/contact.ts": `export interface Contact { firstName: string; lastName: string }`,
        "/src/domain/alias.ts": `import type { PIIBearing } from "@contracts/pii"; import type { Contact } from "./contact"; export type NamedContact = PIIBearing & Pick<Contact, "firstName">;`,
        "/src/infrastructure/llm/evil.ts": `import type { NamedContact } from "@domain/alias"; export type Leak = NamedContact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBeGreaterThanOrEqual(1);
    });
    it("flags an unmarked mapped alias with a PII key", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `export type RawContact = Record<"email", string>;`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: RawContact.email",
      ]);
    });
    it("flags a mapped PII type nested in a callable parameter", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `export interface Handler { submit(input: Record<"email", string>): void }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: Handler.submit(input).email",
      ]);
    });
    it("flags llm reaching a module whose PII type is a MARKED class (markedModules covers classes)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/class-entities.ts": `import type { PIIBearing } from "@contracts/pii";\nexport class Contact implements PIIBearing { firstName = "" }`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "@domain/schema/class-entities";\nexport type Leak = Contact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBeGreaterThanOrEqual(1);
    });
    it("rejects nonliteral module loads in the LLM import closure", () => {
      const project = inMemoryProject({
        "/src/infrastructure/llm/evil.ts": `
          const target = "@domain/schema/entities";
          export const load = () => import(target);
        `,
      });
      expect(detectPIIReachableFromLlm(project)).toContain(
        "src/infrastructure/llm/evil.ts reaches an unverifiable module load in src/infrastructure/llm/evil.ts:3",
      );
    });
    it("does not read lib members off a BRANDED PRIMITIVE, but still reads the project's own", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/contracts/ids.ts": `
          declare const Brand: unique symbol;
          export type FirmId = string & { readonly [Brand]: "FirmId" };
          export interface Holder { readonly firmId: FirmId }
        `,
        "/src/domain/own.ts": `
          export interface Callbacks { readonly notify: (name: string) => void }
        `,
      });
      // A branded string carries the WHOLE String prototype, including
      // \`anchor(name: string)\` — a lib signature nobody wrote and nobody can change.
      const unmarked = detectUnmarkedPIITypes(project, new Set());
      expect(unmarked.some((ref) => ref.includes("anchor")), unmarked.join("\n")).toBe(false);
      // The project's OWN callable parameter named for PII is still reported, so the
      // filter narrowed the source of the members, not the rule.
      expect(unmarked).toContain("src/domain/own.ts :: Callbacks.notify(name)");
    });

    it("rejects a createRequire loader in llm/ — the walk fails closed on what it cannot follow", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/entities.ts": `import type { PIIBearing } from "@contracts/pii"; export interface Contact extends PIIBearing { firstName: string }`,
        "/src/infrastructure/llm/evil.ts": `
          import { createRequire } from "node:module";
          const req = createRequire(import.meta.url);
          export const load = () => req("../../domain/schema/entities") as unknown;
        `,
      });
      // unverifiableModuleLoadLines only fires on the \`import\` keyword or a callee
      // spelled \`require\`; this loader is neither, so if the walk skipped its null
      // specifier the PII module would load with the fence green.
      const violations = detectPIIReachableFromLlm(project);
      expect(violations.some((violation) =>
        violation.includes("unresolvable") && violation.includes("src/infrastructure/llm/evil.ts")
      ), violations.join("\n")).toBe(true);
    });

    it("resolves JavaScript import specifiers through TypeScript extension substitution", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/contact.ts": `import type { PIIBearing } from "@contracts/pii"; export interface Contact extends PIIBearing { firstName: string }`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "../../domain/contact.js"; export type Leak = Contact;`,
      });
      expect(resolveToProjectPath(
        project,
        "src/infrastructure/llm/evil.ts",
        "../../domain/contact.js",
      )).toBe("src/domain/contact.ts");
      expect(detectPIIReachableFromLlm(project).some((violation) =>
        violation.includes("src/domain/contact.ts")
      )).toBe(true);
    });
    it("rejects unwrapped unknown returns reachable from llm", () => {
      const project = inMemoryProject({
        "/src/infrastructure/helper.ts": `
          export function loadClient(): unknown {
            return { firstName: "Alice" };
          }
        `,
        "/src/infrastructure/llm/evil.ts": `
          import { loadClient } from "../helper";
          export const value = loadClient();
        `,
      });
      expect(detectPIIReachableFromLlm(project).some((violation) =>
        violation.includes("loadClient.return")
      )).toBe(true);
    });
    it("rejects opaque callable objects wrapped in Object.freeze", () => {
      const project = inMemoryProject({
        "/src/infrastructure/helper.ts": `
          export const clients = Object.freeze({
            loadClient(): unknown {
              return { firstName: "Alice" };
            },
          });
        `,
        "/src/infrastructure/llm/evil.ts": `
          import { clients } from "../helper";
          export const value = clients.loadClient();
        `,
      });
      expect(detectPIIReachableFromLlm(project).some((violation) =>
        violation.includes("clients.loadClient")
      )).toBe(true);
    });
    it("rejects unwrapped opaque aliases reachable from llm", () => {
      const project = inMemoryProject({
        "/src/infrastructure/helper.ts": `export type HiddenClient = unknown;`,
        "/src/infrastructure/llm/evil.ts": `
          import type { HiddenClient } from "../helper";
          export type Value = HiddenClient;
        `,
      });
      expect(detectPIIReachableFromLlm(project).some((violation) =>
        violation.includes("HiddenClient")
      )).toBe(true);
    });
  });
});
