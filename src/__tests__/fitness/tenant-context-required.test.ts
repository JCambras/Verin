import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  SyntaxKind,
  ts,
  type CallExpression,
  type Project,
  type Signature,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  authorityPrologueViolations,
  realSemanticProject,
  inMemoryProject,
  detectAppLayerSqlAccess,
  isSqlExecutorCall,
  REPO_ROOT,
  requiredAuthorityPrologue,
  returnedCallableMembers,
  sealedAuthorityParameters,
} from "./_fence-utils";

const REVIEWED_ESCAPES: Array<{ ref: string; why: string }> = [
  { ref: "src/infrastructure/store/db.ts :: createDbFromDump", why: "global database restoration factory" },
  { ref: "src/infrastructure/store/db.ts :: createDb", why: "global database connection factory" },
  { ref: "src/infrastructure/store/db.ts :: getDb", why: "global database singleton factory" },
  { ref: "src/infrastructure/store/db.ts :: createMemoryDb", why: "isolated test database factory" },
  { ref: "src/infrastructure/store/db.ts :: isSqlTransaction", why: "pure transaction-capability predicate that reads no tenant data" },
  { ref: "src/infrastructure/store/migration-support.ts :: migrationLedgerExists", why: "read-only global migration ledger discovery" },
  { ref: "src/infrastructure/store/migrations.ts :: runMigrations", why: "global schema management" },
  { ref: "src/infrastructure/store/readiness.ts :: readStoreReadiness", why: "cross-tenant deployment probe that reads no tenant rows" },
  { ref: "src/infrastructure/identity/identity-store.ts :: findUserByEmail", why: "login resolves the tenant from the identity row" },
  { ref: "src/infrastructure/identity/identity-store.ts :: getPasswordHash", why: "user-PK capability before authentication" },
  { ref: "src/infrastructure/identity/identity-store.ts :: authenticate", why: "identity boundary that produces the sealed tenant" },
  { ref: "src/infrastructure/identity/identity-store.ts :: revokeSession", why: "session-id capability" },
  { ref: "src/infrastructure/identity/identity-store.ts :: renewSession", why: "session-id capability rotation" },
  { ref: "src/infrastructure/identity/identity-store.ts :: deleteDeadSessions", why: "global session maintenance" },
  { ref: "src/infrastructure/identity/session.ts :: resolveSession", why: "signed-cookie identity boundary" },
  { ref: "src/infrastructure/identity/session.ts :: resolveAndRenewSession", why: "signed-cookie identity boundary" },
  { ref: "src/infrastructure/identity/session.ts :: signSessionCookie", why: "pure signed-cookie creation" },
  { ref: "src/infrastructure/identity/session.ts :: parseSignedCookie", why: "pure signed-cookie verification" },
  { ref: "src/infrastructure/identity/session.ts :: requireRole", why: "pure role authorization" },
  { ref: "src/infrastructure/crm/application-store.ts :: getApplicationByToken", why: "e-sign capability load" },
  { ref: "src/infrastructure/store/execution-store.ts :: makeExecutionStore", why: "factory whose returned port is checked independently" },
  { ref: "src/infrastructure/store/execution-store.ts :: makeExecutionStore.loadByToken", why: "unguessable resume-token capability load" },
  { ref: "src/infrastructure/audit/audit-store.ts :: enqueueAudit", why: "transaction-local auditedWrite internal" },
  { ref: "src/infrastructure/audit/audit-store.ts :: discardedAuditEventWork", why: "non-persisting login constant work" },
  { ref: "src/infrastructure/wire.ts :: resumeAccountOpeningByToken", why: "e-sign resume-token capability" },
  { ref: "src/infrastructure/wire.ts :: esignCallback", why: "verified e-sign signature and resume-token capability" },
  { ref: "src/infrastructure/wire.ts :: computeEsignSignature", why: "pure e-sign simulation signer" },
  {
    ref: "src/infrastructure/config/configured-flow.ts :: configuredFlow",
    why: "compiles the PUBLISHED DOCUMENT and reads no row - its only tie to the store is the adapter module that also publishes the supported command vocabulary; the tenant scoping that matters is on the execution the compiled steps then drive, which each step's own port carries",
  },
];

const PORT_ESCAPES = new Set([
  "src/domain/ledger/projections.ts :: foldDecisionProjection.<call>",
  "src/domain/observability/safe-values.ts :: isSafeObservabilityPrimitive.<call>",
  // The configuration DIAGNOSIS names a published document, not a tenant's data:
  // the document is firm-neutral by construction (tenancy enters only at
  // bindDomainConfig), so there is no tenant to scope it by, and the value is
  // shape-checked rather than trusted.
  "src/domain/observability/safe-values.ts :: configurationDiagnosisId.<call>",
  "src/domain/observability/safe-values.ts :: generatedObservabilityId.<call>",
  "src/domain/observability/safe-values.ts :: keyedDigestObservabilityId.<call>",
  "src/domain/observability/safe-values.ts :: observabilityIdOrRedacted.<call>",
  "src/domain/observability/safe-values.ts :: readObservabilityId.<call>",
  "src/domain/observability/safe-values.ts :: registerTestSpanName.<call>",
  "src/domain/observability/safe-values.ts :: safeLogMessage.<call>",
  "src/domain/observability/safe-values.ts :: safeSpanName.<call>",
  "src/domain/pii/projection-resolution.ts :: hasUnresolvedProjectionEvidence.<call>",
  "src/domain/pii/projection-resolution.ts :: hasUnresolvedProjectionText.<call>",
  "src/domain/pii/projection-resolution.ts :: isPlainProjectionData.<call>",
  "src/domain/pii/projection-resolution.ts :: resolveCompleteSensitiveEntities.<call>",
  "src/domain/pii/projection-resolution.ts :: trustedStaticProjectionText.<call>",
  "src/domain/workflow/engine.ts :: ExecutionStore.loadByToken",
  "src/domain/schema/entities.ts :: isAccountType.<call>",
  "src/domain/schema/golden-record.ts :: resolveConflict.<call>",
  // The policy interpreter (prompt 9, ADR-0053) is PURE COMPUTATION over
  // already-tenant-scoped inputs: the facts plane arrives pre-resolved from
  // the immutable DecisionInputBundle (itself tenant-pinned), registries are
  // pinned data, and the module performs no repository or port access at all
  // (the policy-ast fence bans IO/clock/randomness across the module). A
  // TenantContext parameter here would be ambient authority a pure function
  // cannot honor - the same reasoning as foldDecisionProjection above.
  // The household health computation (ADR-0057) is PURE ARITHMETIC over one
  // already-authorized household: its caller reached the world through the
  // `pii.view`-governed evidence port, so the tenant scope was decided before
  // this function saw anything. A TenantContext parameter here would be ambient
  // authority a pure function cannot honor - the same reasoning as
  // foldDecisionProjection and the policy interpreter below.
  "src/domain/world/health.ts :: computeHouseholdHealth.<call>",
  // `healthBand` is that computation's own band cut-offs, exported so the
  // surface grades the six factor cards on the SAME scale it grades the
  // composite with rather than keeping a second copy of the thresholds. It
  // takes a number and returns a word: there is nothing here to scope.
  "src/domain/world/health.ts :: healthBand.<call>",
  "src/domain/policy/conflict.ts :: predicateDnf.<call>",
  "src/domain/policy/conflict.ts :: proveDisjoint.<call>",
  "src/domain/policy/evaluate.ts :: evaluatePolicy.<call>",
  "src/domain/policy/evaluate-primitives.ts :: runPrimitivePhase.<call>",
  "src/domain/policy/facts.ts :: evaluatePredicate.<call>",
  "src/domain/policy/facts.ts :: resolveContextKey.<call>",
  "src/domain/policy/facts.ts :: resolveValue.<call>",
  "src/domain/policy/load.ts :: loadPolicy.<call>",
  "src/domain/policy/load-checks.ts :: checkPredicate.<call>",
  "src/domain/policy/load-checks.ts :: effectTargets.<call>",
  "src/domain/policy/load-checks.ts :: isConfigEffect.<call>",
  "src/domain/policy/load-checks.ts :: IssueSink.<call>",
  "src/domain/policy/load-checks.ts :: primitiveKeyReads.<call>",
  "src/domain/policy/load-checks.ts :: resolveValueType.<call>",
  "src/domain/policy/load-effects.ts :: checkEffects.<call>",
  "src/domain/policy/registries.ts :: catalogPrimitiveMap.<call>",
  // The DOMAIN CONFIGURATION module (prompt 10, ADR-0056) is PURE COMPUTATION
  // over a FIRM-NEUTRAL document. A configuration carries no firm identity by
  // construction - `bindDomainConfig` refuses one found anywhere in the graph -
  // and the module performs no repository or port access at all: it parses,
  // closes references, derives a dataflow order, and projects. Tenancy enters
  // exactly once, as bindDomainConfig's explicit FirmRegistry argument, which is
  // the firm's own declared identifiers rather than ambient authority; the sealed
  // TenantContext exists to scope a REPOSITORY call, and there is none to scope
  // here. Same reasoning as foldDecisionProjection and the prompt-9 policy
  // interpreter above.
  "src/domain/config/bind.ts :: bindDomainConfig.<call>",
  "src/domain/config/bind.ts :: firmIdentityPaths.<call>",
  "src/domain/config/bind.ts :: requiredFirmClasses.<call>",
  "src/domain/config/bindings.ts :: orderBindings.<call>",
  "src/domain/config/diff.ts :: changeDeclarationMismatch.<call>",
  "src/domain/config/diff.ts :: diffDomainConfigs.<call>",
  "src/domain/config/document.ts :: canonicalConfigJson.<call>",
  "src/domain/config/document.ts :: domainConfigVersionId.<call>",
  "src/domain/config/errors.ts :: configError.<call>",
  // The port EVERY configuration refusal is minted through (D-231): each arm
  // carries one typed loader fault out of pure domain code so the composition
  // root can state it to an operator, and reaches no repository. The shipped
  // implementation mints and logs; the tenant scoping that matters there is on
  // the execution the refused work was driving, which its own `invoke` carries.
  "src/domain/config/errors.ts :: ConfiguredRefusal.intakeMismatch",
  "src/domain/config/errors.ts :: ConfiguredRefusal.uncompilable",
  "src/domain/config/errors.ts :: ConfiguredRefusal.unrunnableStep",
  "src/domain/config/evidence.ts :: durationSeconds.<call>",
  "src/domain/config/intake-view.ts :: admitIntakeSubmission.<call>",
  "src/domain/config/intake-view.ts :: optionalIntakeValue.<call>",
  "src/domain/config/intake-view.ts :: requiredIntakeValue.<call>",
  "src/domain/config/intake-view.ts :: unmappedIntakeFault.<call>",
  "src/domain/config/intake.ts :: intakeFormOf.<call>",
  "src/domain/config/labels.ts :: domainLabelsOf.<call>",
  "src/domain/config/load-closure.ts :: checkBucketSource.<call>",
  "src/domain/config/load-closure.ts :: checkEvidenceWindows.<call>",
  "src/domain/config/load-closure.ts :: checkSource.<call>",
  "src/domain/config/load-closure.ts :: requireMember.<call>",
  "src/domain/config/load-closure.ts :: resolveSourceType.<call>",
  "src/domain/config/load-coherence.ts :: checkCopyCompleteness.<call>",
  "src/domain/config/load-coherence.ts :: checkCopyTemplates.<call>",
  "src/domain/config/load-coherence.ts :: checkForm.<call>",
  "src/domain/config/load-coherence.ts :: checkPlanAcyclicity.<call>",
  "src/domain/config/load-coherence.ts :: checkReachability.<call>",
  "src/domain/config/load-references.ts :: checkIdentity.<call>",
  "src/domain/config/load-references.ts :: checkReferences.<call>",
  "src/domain/config/load.ts :: loadDomainConfig.<call>",
  "src/domain/config/load.ts :: shippedConfigEnvironment.<call>",
  "src/domain/config/parameters.ts :: containsParameterRef.<call>",
  "src/domain/config/parameters.ts :: contextKeyReads.<call>",
  "src/domain/config/parameters.ts :: neutralRefResolver.<call>",
  "src/domain/config/parameters.ts :: parameterRefClasses.<call>",
  "src/domain/config/parameters.ts :: ParameterOwner.parseParameters",
  "src/domain/config/parameters.ts :: RefResolver.<call>",
  "src/domain/config/parameters.ts :: resolveParameters.<call>",
  "src/domain/config/plan-compiler.ts :: compileFlowDefinition.<call>",
  "src/domain/config/registries.ts :: policyRegistriesFor.<call>",
  "src/domain/config/segments.ts :: bucketOf.<call>",
  "src/domain/config/segments.ts :: renderKeySegments.<call>",
  "src/domain/config/segments.ts :: renderTemplate.<call>",
  "src/domain/config/segments.ts :: SourceResolver.<call>",
  "src/domain/config/segments.ts :: templateIsInert.<call>",
  "src/domain/config/segments.ts :: templatePlaceholders.<call>",
  "src/domain/config/segments.ts :: TemplateValues.context",
  "src/domain/config/segments.ts :: TemplateValues.slot",
  "src/domain/config/vocabulary.ts :: kebabId.<call>",
  "src/domain/policy/registries.ts :: deriveContextKeys.<call>",
  "src/domain/policy/registries.ts :: evidenceKindDescriptor.<call>",
  "src/domain/policy/registries.ts :: instructionKindDescriptor.<call>",
  "src/domain/policy/temporal.ts :: durationToMillis.<call>",
  "src/domain/policy/temporal.ts :: epochMillisOf.<call>",
  "src/domain/policy/temporal.ts :: isCanonicalDate.<call>",
  "src/domain/policy/temporal.ts :: isCanonicalTimestamp.<call>",
  "src/domain/policy/trace.ts :: compareCanonical.<call>",
  "src/domain/policy/trace.ts :: compareProhibitions.<call>",
  "src/domain/policy/trace.ts :: evidenceRequiredBlockerCode.<call>",
  "src/domain/policy/trace.ts :: ruleUnevaluableBlockerCode.<call>",
  "src/domain/policy/trace.ts :: sortUniqueStrings.<call>",
]);

const SQL_ADAPTER_MODULES = ["@electric-sql/pglite"] as const;

export interface TenantFenceViolation {
  ref: string;
  detail: string;
}

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

interface RepositoryEntry {
  readonly name: string;
  readonly signatures: Signature[];
  readonly owners: Node[];
  readonly unresolved?: boolean;
}

function callableImplementations(
  expression: Node,
  seen = new Set<string>(),
): Node[] {
  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
  if (seen.has(key)) return [];
  seen.add(key);
  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return callableImplementations(expression.getExpression(), seen);
  }
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
    return [expression];
  }
  if (Node.isObjectLiteralExpression(expression)) {
    return expression.getProperties().flatMap((property) => {
      if (
        Node.isMethodDeclaration(property) ||
        Node.isGetAccessorDeclaration(property)
      ) return [property];
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return initializer ? callableImplementations(initializer, seen) : [];
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        return callableImplementations(property.getNameNode(), seen);
      }
      return [];
    });
  }
  if (Node.isConditionalExpression(expression)) {
    return [
      ...callableImplementations(expression.getWhenTrue(), seen),
      ...callableImplementations(expression.getWhenFalse(), seen),
    ];
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...callableImplementations(expression.getLeft(), seen),
        ...callableImplementations(expression.getRight(), seen),
      ];
    }
  }
  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    if (
      Node.isPropertyAccessExpression(callee) &&
      callee.getExpression().getText() === "Object" &&
      callee.getName() === "freeze"
    ) {
      const argument = expression.getArguments()[0];
      return argument ? callableImplementations(argument, seen) : [];
    }
  }
  if (Node.isIdentifier(expression)) {
    return expression.getDefinitionNodes().flatMap((declaration) => {
      if (Node.isFunctionDeclaration(declaration)) return [declaration];
      if (Node.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        return initializer ? callableImplementations(initializer, seen) : [];
      }
      return [];
    });
  }
  return [];
}

function callableImplementationMember(node: Node): string | null {
  const member =
    Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node)
      ? node
      : node.getFirstAncestor((ancestor) =>
        Node.isMethodDeclaration(ancestor) ||
        Node.isGetAccessorDeclaration(ancestor) ||
        Node.isPropertyAssignment(ancestor)
      );
  return member &&
      (Node.isMethodDeclaration(member) ||
        Node.isGetAccessorDeclaration(member) ||
        Node.isPropertyAssignment(member))
    ? member.getName()
    : null;
}

function ownersForCallableMember(
  implementations: readonly Node[],
  root: string,
  member: string,
): Node[] {
  const suffix = member === root ? null : member.slice(root.length + 1);
  return implementations.filter((implementation) =>
    callableImplementationMember(implementation) === suffix
  );
}

function callableMembers(
  type: Type,
  owner: string,
): Array<{ name: string; signatures: Signature[] }> {
  const entries: Array<{ name: string; signatures: Signature[] }> = [];
  const direct = type.getCallSignatures();
  if (direct.length) entries.push({ name: owner, signatures: direct });
  if (
    type.isString() ||
    type.isStringLiteral() ||
    type.isNumber() ||
    type.isNumberLiteral() ||
    type.isBoolean() ||
    type.isBooleanLiteral()
  ) {
    return entries;
  }
  // Filter per PROPERTY, never on the type's own symbol: `Object.freeze(repo)`
  // has type `Readonly<T>`, whose ALIAS symbol is declared in lib.es5.d.ts, so a
  // symbol-level bail hides every method of a frozen repository (and the same
  // for a Readonly<>/Partial<>/Record<>/Pick<> annotation). A property DECLARED
  // under src/ is ours regardless of the wrapper; lib members filter themselves out.
  for (const property of type.getProperties()) {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0];
    if (
      !declaration ||
      !normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
    ) {
      continue;
    }
    const signatures = property.getTypeAtLocation(declaration).getCallSignatures();
    if (signatures.length) {
      entries.push({ name: `${owner}.${property.getName()}`, signatures });
    }
  }
  return entries;
}

/**
 * The SHARED authority-prologue rule (requiredAuthorityPrologue in _fence-utils).
 * This fence used to demand its tenant assertion be literally statement #1 while the
 * governed-actions fence demanded the SAME position for its grant assertion, which
 * made a signature carrying both authorities unbuildable. Both now derive the same
 * prologue from ONE implementation over ALL of a signature's sealed parameters:
 * every required assertion runs before anything else, in any order, and a callable
 * carrying both authorities must also prove they name the same scope - including
 * when the tenant arrives WRAPPED in an object parameter, and regardless of which
 * authority happens to be declared first.
 */
function runtimeGuardViolations(signature: Signature): string[] {
  const { required, captures, unfenceable } = requiredAuthorityPrologue(signature);
  if (required.length === 0) {
    return ["no sealed authority parameter to assert"];
  }
  return [
    ...unfenceable,
    ...authorityPrologueViolations(signature.getDeclaration(), required, captures),
  ];
}

function exportedDomainCallableTypes(
  sf: SourceFile,
): Array<{ name: string; type: Type }> {
  return [
    ...sf.getFunctions()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({
        name: declaration.getName() ?? "<anonymous>",
        type: declaration.getType(),
      })),
    ...sf.getVariableDeclarations()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({
        name: declaration.getName(),
        type: declaration.getType(),
      })),
    ...sf.getInterfaces()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({ name: declaration.getName(), type: declaration.getType() })),
    ...sf.getTypeAliases()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({ name: declaration.getName(), type: declaration.getType() })),
    ...sf.getClasses()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({ name: declaration.getName() ?? "<anonymous>", type: declaration.getType() })),
  ].filter((declaration) =>
    callableMembers(declaration.type, declaration.name).some((member) =>
      member.signatures.some((signature) =>
        normalizedPath(signature.getDeclaration().getSourceFile().getFilePath())
          .startsWith("src/domain/")
      )
    )
  );
}

function sqlBackedInfrastructureModules(project: Project): Set<string> {
  const modules = new Set<string>(["src/infrastructure/store/db.ts"]);
  const isSqlAdapter = (specifier: string): boolean =>
    SQL_ADAPTER_MODULES.some((moduleName) =>
      specifier === moduleName || specifier.startsWith(`${moduleName}/`)
    );
  let changed = true;
  while (changed) {
    changed = false;
    for (const sf of project.getSourceFiles()) {
      const normalized = normalizedPath(sf.getFilePath());
      if (
        !normalized.startsWith("src/infrastructure/") ||
        modules.has(normalized)
      ) {
        continue;
      }
      const staticTargets = sf.getImportDeclarations().flatMap((declaration) => {
        const target = declaration.getModuleSpecifierSourceFile();
        return target ? [normalizedPath(target.getFilePath())] : [];
      });
      const importsSqlAdapter = sf.getImportDeclarations().some((declaration) =>
        isSqlAdapter(declaration.getModuleSpecifierValue())
      );
      const executesSql = sf
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .some(isSqlExecutorCall);
      const dynamicTargets: string[] = [];
      let loadsSqlAdapter = false;
      let unverifiableModuleLoad = false;
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expression = call.getExpression();
        const isModuleLoad = expression.getKind() === SyntaxKind.ImportKeyword ||
          expression.getText() === "require";
        if (!isModuleLoad) continue;
        const argument = call.getArguments()[0];
        if (!argument || !Node.isStringLiteral(argument)) {
          unverifiableModuleLoad = true;
          continue;
        }
        if (isSqlAdapter(argument.getLiteralValue())) {
          loadsSqlAdapter = true;
        }
        const resolved = ts.resolveModuleName(
          argument.getLiteralValue(),
          sf.getFilePath(),
          project.getCompilerOptions(),
          project.getModuleResolutionHost(),
        ).resolvedModule?.resolvedFileName;
        if (resolved) dynamicTargets.push(normalizedPath(resolved));
      }
      const reachesSql = executesSql ||
        importsSqlAdapter ||
        loadsSqlAdapter ||
        unverifiableModuleLoad ||
        [...staticTargets, ...dynamicTargets].some((target) =>
          modules.has(target)
        );
      if (reachesSql) {
        modules.add(normalized);
        changed = true;
      }
    }
  }
  return modules;
}

export function detectMissingTenantParams(
  project: Project,
  escapes: ReadonlySet<string>,
): TenantFenceViolation[] {
  const out: TenantFenceViolation[] = [];
  const repositoryModules = sqlBackedInfrastructureModules(project);
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (!repositoryModules.has(normalized)) continue;

    const entries: RepositoryEntry[] = [];
    const returnedEntries = (declaration: Node, owner: string): RepositoryEntry[] =>
      returnedCallableMembers(declaration, owner, {
        failOpaqueReturn: escapes.has(`${normalized} :: ${owner}`),
      }).map((member) => ({
        name: member.name,
        signatures: member.signature ? [member.signature] : [],
        owners: [member.declaration],
        unresolved: member.signature === null,
      }));
    for (const fn of sf.getFunctions()) {
      if (fn.isExported()) {
        entries.push({
          name: fn.getName() ?? "<anonymous>",
          signatures: [fn.getSignature()],
          owners: [fn],
        });
        entries.push(...returnedEntries(fn, fn.getName() ?? "<anonymous>"));
      }
    }
    for (const declaration of sf.getVariableDeclarations()) {
      if (!declaration.isExported()) continue;
      const initializer = declaration.getInitializer();
      const implementations = initializer
        ? callableImplementations(initializer)
        : [];
      for (const member of callableMembers(declaration.getType(), declaration.getName())) {
        entries.push({
          name: member.name,
          signatures: member.signatures,
          owners: ownersForCallableMember(
            implementations,
            declaration.getName(),
            member.name,
          ),
        });
        for (const signature of member.signatures) {
          entries.push(...returnedEntries(signature.getDeclaration(), member.name));
        }
      }
    }
    for (const assignment of sf.getExportAssignments()) {
      const expression = assignment.getExpression();
      if (Node.isIdentifier(expression)) continue;
      const implementations = callableImplementations(expression);
      for (const member of callableMembers(expression.getType(), "default")) {
        entries.push({
          name: member.name,
          signatures: member.signatures,
          owners: ownersForCallableMember(
            implementations,
            "default",
            member.name,
          ),
        });
        for (const signature of member.signatures) {
          entries.push(...returnedEntries(signature.getDeclaration(), member.name));
        }
      }
    }
    for (const cls of sf.getClasses().filter((candidate) => candidate.isExported())) {
      for (const method of cls.getMethods()) {
        if (method.getScope() === "private" || method.getScope() === "protected") continue;
        entries.push({
          name: `${cls.getName() ?? "<anonymous>"}.${method.getName()}`,
          signatures: [method.getSignature()],
          owners: [method],
        });
        entries.push(...returnedEntries(
          method,
          `${cls.getName() ?? "<anonymous>"}.${method.getName()}`,
        ));
      }
    }

    const ownerDeclarations = new Set(
      entries.flatMap((entry) => [
        ...entry.owners,
        ...entry.signatures.map((signature) => signature.getDeclaration()),
      ]),
    );
    const helperOwned = (declaration: Node, seen: ReadonlySet<string>): boolean => {
      if (ownerDeclarations.has(declaration)) return true;
      if (declaration.getAncestors().some((ancestor) => ownerDeclarations.has(ancestor))) {
        return true;
      }
      if (!Node.isFunctionDeclaration(declaration)) return false;
      const name = declaration.getNameNode();
      if (!name) return false;
      const key = `${normalized}:${declaration.getStart()}`;
      if (seen.has(key)) return false;
      const nextSeen = new Set(seen).add(key);
      const references = name.findReferencesAsNodes().filter((reference) =>
        reference.getSourceFile() === sf &&
        reference.getStart() !== name.getStart()
      );
      return references.length > 0 && references.every((reference) => {
        const parent = reference.getParent();
        if (!Node.isCallExpression(parent) || parent.getExpression() !== reference) {
          return false;
        }
        return parent.getAncestors().some((ancestor) =>
          helperOwned(ancestor, nextSeen)
        );
      });
    };
    const sqlCalls = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter(isSqlExecutorCall);
    const preBodySqlSet = new Set<CallExpression>();
    const visitedPreBodyCallables = new Set<string>();
    const visitPreBodyExecution = (node: Node): void => {
      const calls = [
        ...(Node.isCallExpression(node) ? [node] : []),
        ...node.getDescendantsOfKind(SyntaxKind.CallExpression),
      ];
      for (const call of calls) {
        if (isSqlExecutorCall(call)) {
          preBodySqlSet.add(call);
          continue;
        }
        for (const implementation of callableImplementations(
          call.getExpression(),
        )) {
          if (implementation.getSourceFile() !== sf) continue;
          const key = `${normalized}:${implementation.getStart()}`;
          if (visitedPreBodyCallables.has(key)) continue;
          visitedPreBodyCallables.add(key);
          const implementationBody =
            Node.isFunctionDeclaration(implementation) ||
              Node.isFunctionExpression(implementation) ||
              Node.isArrowFunction(implementation)
              ? implementation.getBody()
              : undefined;
          if (implementationBody) visitPreBodyExecution(implementationBody);
        }
      }
    };
    for (const parameter of sf.getDescendantsOfKind(SyntaxKind.Parameter)) {
      const initializer = parameter.getInitializer();
      if (initializer) visitPreBodyExecution(initializer);
    }
    const preBodySql = sqlCalls.filter((call) => preBodySqlSet.has(call));
    for (const call of preBodySql) {
      out.push({
        ref: `${normalized}:${call.getStartLineNumber()} :: <pre-body-sql>`,
        detail: "SQL executor call runs before the callable authority prologue",
      });
    }
    const unownedSql = sqlCalls
      .filter((call) => !preBodySql.includes(call))
      .filter((call) =>
        !call.getAncestors().some((ancestor) =>
          helperOwned(ancestor, new Set())
        )
      );
    for (const call of unownedSql) {
      out.push({
        ref: `${normalized}:${call.getStartLineNumber()} :: <unowned-sql>`,
        detail: "SQL executor call is not owned by a checked repository callable or reviewed global escape",
      });
    }

    for (const entry of entries) {
      const ref = `${normalized} :: ${entry.name}`;
      if (escapes.has(ref)) continue;
      if (entry.unresolved) {
        out.push({
          ref,
          detail: "returned callable implementation cannot be proven",
        });
        continue;
      }
      const unscoped = entry.signatures.some((signature) =>
        sealedAuthorityParameters(signature).length === 0
      );
      if (unscoped) {
        out.push({
          ref,
          detail: "repository callable has no sealed tenant context",
        });
        continue;
      }
      const missingGuard = entry.signatures.some((signature) => {
        return runtimeGuardViolations(signature).length > 0;
      });
      if (missingGuard) {
        out.push({
          ref,
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        });
      }
    }
  }
  return out;
}

export function detectUnscopedPortMethods(
  project: Project,
  escapes: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (!normalized.startsWith("src/domain/")) continue;
    const declarations = exportedDomainCallableTypes(sf);
    for (const declaration of declarations) {
      const members = callableMembers(declaration.type, declaration.name)
        .map((member) => ({
          ref: `${normalized} :: ${member.name === declaration.name ? `${declaration.name}.<call>` : member.name}`,
          signatures: member.signatures.filter((signature) =>
            normalizedPath(signature.getDeclaration().getSourceFile().getFilePath())
              .startsWith("src/domain/")
          ),
        }))
        .filter((member) => member.signatures.length > 0);
      for (const member of members) {
        if (escapes.has(member.ref)) continue;
        const unscoped = member.signatures.some((signature) =>
          sealedAuthorityParameters(signature).length === 0 ||
          requiredAuthorityPrologue(signature).unfenceable.length > 0
        );
        if (unscoped) out.push(member.ref);
      }
    }
  }
  return out;
}

const ESCAPE_SET = new Set(REVIEWED_ESCAPES.map((entry) => entry.ref));

function repositoryFixture(
  source: string,
  extras: Record<string, string> = {},
): Project {
  return inMemoryProject({
    "/src/infrastructure/store/db.ts": `
      export interface SqlQueryable { query(sql: string): unknown }
      export interface SqlTx extends SqlQueryable {}
      export interface SqlDb extends SqlQueryable {}
    `,
    "/src/contracts/tenant.ts": `
      export interface TenantContext { orgId: string }
      export function assertTenantContext(value: unknown): asserts value is TenantContext {
        void value;
      }
      export function assertSameTenant(a: unknown, b: unknown): void { void a; void b; }
    `,
    "/src/contracts/principal.ts": `
      import type { TenantContext } from "./tenant";
      export interface Principal { tenant: TenantContext; userId: string }
      export interface WriteActor { tenant: TenantContext; actorUserId: string }
      export function assertWriteActor(value: unknown): asserts value is WriteActor {
        void value;
      }
    `,
    "/src/infrastructure/crm/subject.ts": source,
    ...extras,
  });
}

describe("tenant-context-required fence", () => {
  it("enforces: every exported SQL repository entry requires a sealed tenant context or exact escape", () => {
    const violations = detectMissingTenantParams(realSemanticProject(), ESCAPE_SET);
    expect(
      violations,
      violations.map((violation) => `${violation.ref} - ${violation.detail}`).join("\n"),
    ).toEqual([]);
  });

  it("enforces: no stale repository escapes", () => {
    const project = realSemanticProject();
    const unescaped = new Set(
      detectMissingTenantParams(project, new Set())
        .map((violation) => violation.ref),
    );
    expect(
      REVIEWED_ESCAPES
        .filter((entry) => !unescaped.has(entry.ref))
        .map((entry) => entry.ref),
    ).toEqual([]);
  });

  it("enforces: tenant scoping cannot be side-stepped by writing the SQL in the app layer", () => {
    // This fence derives tenant scope from repository SIGNATURES under
    // src/infrastructure/, so an inline `db.query("… WHERE org_id = $1")` in a
    // route is not a smaller version of a repository call — it is outside the
    // fence entirely, with no signature to carry a sealed TenantContext.
    const violations = detectAppLayerSqlAccess(realSemanticProject());
    expect(
      violations,
      `app-layer persistence access:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("enforces: every exported domain port method requires TenantContext unless capability-keyed", () => {
    const project = realSemanticProject();
    const callableTypes = project.getSourceFiles()
      .filter((sf) => normalizedPath(sf.getFilePath()).startsWith("src/domain/"))
      .flatMap(exportedDomainCallableTypes);
    expect(callableTypes.length).toBeGreaterThanOrEqual(3);
    expect(detectUnscopedPortMethods(project, PORT_ESCAPES)).toEqual([]);
  });

  it("enforces: no stale domain-port escapes", () => {
    const project = realSemanticProject();
    const live = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      const normalized = normalizedPath(sf.getFilePath());
      if (!normalized.startsWith("src/domain/")) continue;
      for (const declaration of exportedDomainCallableTypes(sf)) {
        for (const member of callableMembers(declaration.type, declaration.name)) {
          // Same domain-declaration filter detectUnscopedPortMethods applies:
          // without it a member the detector can NEVER emit still counts as
          // live, so its escape could sit in PORT_ESCAPES forever unflagged.
          const domainSignatures = member.signatures.filter((signature) =>
            normalizedPath(signature.getDeclaration().getSourceFile().getFilePath())
              .startsWith("src/domain/")
          );
          if (domainSignatures.length === 0) continue;
          live.add(
            `${normalized} :: ${member.name === declaration.name ? `${declaration.name}.<call>` : member.name}`,
          );
        }
      }
    }
    expect([...PORT_ESCAPES].filter((ref) => !live.has(ref))).toEqual([]);
  });

  describe("detects (companion): semantic and declaration-form evasions are caught", () => {
    it("flags a tenant-scoped read moved INLINE into an app-layer route", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        // Scoped by org_id and authorized upstream — and still invisible to every
        // signature-based check, which is exactly the escape.
        "/src/app/api/audit/route.ts": `
          import { getDb } from "@infra/store/db";
          export async function GET() {
            const db = await getDb();
            return db.query<{ email: string }>("SELECT email FROM users WHERE org_id = $1", ["org"]);
          }
        `,
      });
      expect(detectAppLayerSqlAccess(project)).toHaveLength(1);
      // The same read behind a repository is what the fence CAN check.
      expect(detectAppLayerSqlAccess(inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
        `,
        "/src/infrastructure/identity/identity-store.ts": `
          import type { SqlDb } from "../store/db";
          export async function listEmails(db: SqlDb, orgId: string) {
            return db.query<{ email: string }>("SELECT email FROM users WHERE org_id = $1", [orgId]);
          }
        `,
      }))).toEqual([]);
    });

    it.each([
      `db.query.call(db, "SELECT email FROM users")`,
      `db.query.apply(db, ["SELECT email FROM users"])`,
      `db.query.bind(db)("SELECT email FROM users")`,
      `Reflect.apply(db.query, db, ["SELECT email FROM users"])`,
    ])("discovers SQL repositories through normalized executor wrappers: %s", (statement) => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export function listAll(db: SqlDb) {
          return ${statement};
        }
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("discovers SQL repositories through destructured builtins and later executor aliases", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export async function listAll(db: SqlDb) {
          const { apply } = Reflect;
          let run: typeof db.query;
          run = db.query;
          await apply(run, db, ["SELECT email FROM users"]);
          let later: typeof db.query;
          ({ query: later } = db);
          return later("SELECT email FROM users");
        }
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("discovers SQL repositories through fixed-array builtin aliases", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export async function listAll(db: SqlDb) {
          const methods = [Reflect.apply] as const;
          const selected = methods;
          const [apply] = selected;
          await apply(db.query, db, ["SELECT email FROM users"]);
          return selected[0](db.query, db, ["SELECT email FROM users"]);
        }
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it.each([
      `const R = Reflect;
          return R.apply(db.query, db, ["SELECT email FROM users"]);`,
      `let R: typeof Reflect;
          R = Reflect;
          return R.apply(db.query, db, ["SELECT email FROM users"]);`,
    ])("discovers SQL repositories through ambient builtin receiver aliases", (body) => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export function listAll(db: SqlDb) {
          ${body}
        }
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it.each([
      `declare const db: SqlDb;
        db.query("SELECT email FROM users");`,
      `declare const db: SqlDb;
        export const rows = db.query("SELECT email FROM users");`,
      `declare const db: SqlDb;
        export const rows = (() => db.query("SELECT email FROM users"))();`,
      `declare const db: SqlDb;
        export const rows = Promise.resolve().then(() =>
          db.query("SELECT email FROM users")
        );`,
      `declare const db: SqlDb;
        export class Bootstrap {
          static {
            db.query("SELECT email FROM users");
          }
        }`,
    ])("rejects SQL that is not owned by a checked callable", (source) => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        ${source}
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: expect.stringMatching(
            /^src\/infrastructure\/crm\/subject\.ts:\d+ :: <unowned-sql>$/,
          ),
          detail: "SQL executor call is not owned by a checked repository callable or reviewed global escape",
        },
      ]);
    });

    it("accepts a local SQL helper reached only from a checked scoped callable", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import {
          assertTenantContext,
          type TenantContext,
        } from "../../contracts/tenant";
        function load(db: SqlDb, orgId: string) {
          return db.query("SELECT email FROM users WHERE org_id = $1", [orgId]);
        }
        export function listAll(db: SqlDb, tenant: TenantContext) {
          assertTenantContext(tenant);
          return load(db, tenant.orgId);
        }
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([]);
    });

    it("rejects SQL in an exported object getter even when a guarded sibling is callable", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import {
          assertTenantContext,
          type TenantContext,
        } from "../../contracts/tenant";
        declare const db: SqlDb;
        export const repository = {
          safe(tenant: TenantContext) {
            assertTenantContext(tenant);
            return db.query("SELECT 1");
          },
          get rows() {
            return db.query("SELECT email FROM users");
          },
        };
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: expect.stringMatching(
            /^src\/infrastructure\/crm\/subject\.ts:\d+ :: <unowned-sql>$/,
          ),
          detail: "SQL executor call is not owned by a checked repository callable or reviewed global escape",
        },
      ]);
    });

    it("rejects SQL in a parameter default before the authority prologue can run", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import {
          assertTenantContext,
          type TenantContext,
        } from "../../contracts/tenant";
        export function listAll(
          db: SqlDb,
          tenant: TenantContext,
          rows = db.query("SELECT email FROM users"),
        ) {
          assertTenantContext(tenant);
          return rows;
        }
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: expect.stringMatching(
            /^src\/infrastructure\/crm\/subject\.ts:\d+ :: <pre-body-sql>$/,
          ),
          detail: "SQL executor call runs before the callable authority prologue",
        },
      ]);
    });

    it("rejects SQL reached transitively from a parameter default", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import {
          assertTenantContext,
          type TenantContext,
        } from "../../contracts/tenant";
        function load(db: SqlDb) {
          return db.query("SELECT email FROM users");
        }
        function indirect(db: SqlDb) {
          return load(db);
        }
        export function listAll(
          db: SqlDb,
          tenant: TenantContext,
          rows = indirect(db),
        ) {
          assertTenantContext(tenant);
          return rows;
        }
      `);
      expect(detectMissingTenantParams(project, new Set())).toEqual([
        {
          ref: expect.stringMatching(
            /^src\/infrastructure\/crm\/subject\.ts:\d+ :: <pre-body-sql>$/,
          ),
          detail: "SQL executor call runs before the callable authority prologue",
        },
      ]);
    });

    /**
     * THE AUTHORITY PROLOGUE, from the tenant side. Both this fence and the
     * governed-actions fence used to demand their own assertion be literally
     * statement #1, which made a repository carrying BOTH authorities as explicit
     * parameters unbuildable no matter how it was written. The shared rule requires
     * the assertions to run before anything else, in any order, plus proof the two
     * authorities name the same scope.
     */
    const DUAL_AUTHORITY_PARAMS = `
          db: SqlDb,
          tenant: TenantContext,
          grant: ActionGrant<"pii.view">,`;

    const dualAuthorityFixture = (
      body: string,
      params = DUAL_AUTHORITY_PARAMS,
      prelude = "",
    ): Project =>
      repositoryFixture(
        `
        import type { SqlDb } from "../store/db";
        import { assertSameTenant, assertTenantContext, type TenantContext } from "../../contracts/tenant";
        import { assertActionGrant, type ActionGrant, type ActorRef } from "../../contracts/authz";
        import type { Principal, WriteActor } from "../../contracts/principal";
        ${prelude}
        export function listPeople<A extends string = never>(${params}
        ): unknown {
${body}
        }
      `,
        {
          "/src/contracts/authz.ts": `
            import type { TenantContext } from "./tenant";
          export interface ActionGrant<A extends string> { action: A; tenant: TenantContext }
          export interface ActorRef { tenant: TenantContext; actorId: string }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> {
            void value; void action;
          }
          `,
        },
      );

    const dualAuthorityViolations = (
      body: string,
      params?: string,
      prelude?: string,
    ): unknown[] =>
      detectMissingTenantParams(dualAuthorityFixture(body, params, prelude), new Set());

    it("PASSES a dual-authority signature whose prologue is contiguous (previously unbuildable)", () => {
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          assertActionGrant(grant, "pii.view");
          assertSameTenant(tenant, grant.tenant);
          return db.query("SELECT 1");
      `)).toEqual([]);
    });

    it("PASSES the same prologue in a different order (the rule is 'before anything else', not 'first')", () => {
      expect(dualAuthorityViolations(`
          assertActionGrant(grant, "pii.view");
          assertSameTenant(tenant, grant.tenant);
          assertTenantContext(tenant);
          return db.query("SELECT 1");
      `)).toEqual([]);
    });

    it("rejects a dual-authority signature that never proves the two name the same tenant", () => {
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          assertActionGrant(grant, "pii.view");
          return db.query("SELECT 1");
      `)).toHaveLength(1);
    });

    it("rejects a dual-authority signature missing the grant assertion", () => {
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          assertSameTenant(tenant, grant.tenant);
          return db.query("SELECT 1");
      `)).toHaveLength(1);
    });

    it("rejects a DELAYED guard: an assertion after the prologue has already ended", () => {
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          assertActionGrant(grant, "pii.view");
          const rows = db.query("SELECT 1");
          assertSameTenant(tenant, grant.tenant);
          return rows;
      `)).toHaveLength(1);
    });

    it("rejects a SIDE EFFECT before the guards", () => {
      expect(dualAuthorityViolations(`
          db.query("DELETE FROM audit_log");
          assertTenantContext(tenant);
          assertActionGrant(grant, "pii.view");
          assertSameTenant(tenant, grant.tenant);
          return db.query("SELECT 1");
      `)).toHaveLength(1);
    });

    it("rejects BRANCHING business logic interleaved into the prologue", () => {
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          if (grant.action !== "pii.view") return null;
          assertActionGrant(grant, "pii.view");
          assertSameTenant(tenant, grant.tenant);
          return db.query("SELECT 1");
      `)).toHaveLength(1);
    });

    it("rejects a same-tenant proof that compares the WRONG values", () => {
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          assertActionGrant(grant, "pii.view");
          assertSameTenant(grant.tenant, grant.tenant);
          return db.query("SELECT 1");
      `)).toHaveLength(1);
    });

    it("PASSES an action written with the other QUOTE style (a value, not source text)", () => {
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          assertActionGrant(grant, 'pii.view');
          assertSameTenant(tenant, grant.tenant);
          return db.query("SELECT 1");
      `)).toEqual([]);
    });

    describe.each(Object.freeze([
      `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          piiGrant: ActionGrant<"pii.view">,`,
      `db: SqlDb,
          piiGrant: ActionGrant<"pii.view">,
          executionGrant: ActionGrant<"execution.initiate">,`,
    ]))("a grant pair in either parameter order", (params) => {
      it("PASSES when both are asserted and compared", () => {
        expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(piiGrant.tenant, executionGrant.tenant);
          return db.query("SELECT 1");
        `, params)).toEqual([]);
      });

      it("rejects without the cross-authority proof", () => {
        expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          return db.query("SELECT 1");
        `, params)).toHaveLength(1);
      });
    });

    describe.each(Object.freeze([
      {
        params: `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          wrapped: { piiGrant: ActionGrant<"pii.view"> },`,
        execution: "executionGrant",
        pii: "wrapped.piiGrant",
      },
      {
        params: `db: SqlDb,
          wrapped: { piiGrant: ActionGrant<"pii.view"> },
          executionGrant: ActionGrant<"execution.initiate">,`,
        execution: "executionGrant",
        pii: "wrapped.piiGrant",
      },
      {
        params: `db: SqlDb,
          piiGrant: ActionGrant<"pii.view">,
          wrapped: { executionGrant: ActionGrant<"execution.initiate"> },`,
        execution: "wrapped.executionGrant",
        pii: "piiGrant",
      },
      {
        params: `db: SqlDb,
          wrapped: { executionGrant: ActionGrant<"execution.initiate"> },
          piiGrant: ActionGrant<"pii.view">,`,
        execution: "wrapped.executionGrant",
        pii: "piiGrant",
      },
      {
        params: `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          { piiGrant }: { piiGrant: ActionGrant<"pii.view"> },`,
        execution: "executionGrant",
        pii: "piiGrant",
      },
      {
        params: `db: SqlDb,
          { piiGrant }: { piiGrant: ActionGrant<"pii.view"> },
          executionGrant: ActionGrant<"execution.initiate">,`,
        execution: "executionGrant",
        pii: "piiGrant",
      },
      {
        params: `db: SqlDb,
          piiGrant: ActionGrant<"pii.view">,
          { authority: { executionGrant } }: {
            authority: { executionGrant: ActionGrant<"execution.initiate"> }
          },`,
        execution: "executionGrant",
        pii: "piiGrant",
      },
      {
        params: `db: SqlDb,
          { authority: { executionGrant } }: {
            authority: { executionGrant: ActionGrant<"execution.initiate"> }
          },
          piiGrant: ActionGrant<"pii.view">,`,
        execution: "executionGrant",
        pii: "piiGrant",
      },
    ]))(
      "a mixed direct/wrapped grant pair",
      ({ params, execution, pii }) => {
        it("rejects without its pairwise scope proof", () => {
        expect(dualAuthorityViolations(`
          assertActionGrant(${execution}, "execution.initiate");
          assertActionGrant(${pii}, "pii.view");
          return db.query("SELECT 1");
        `, params)).toHaveLength(1);
        });

        it("accepts both assertions with its scope proof", () => {
        const executionRef = execution.includes(".") ? "capturedExecutionGrant" : execution;
        const piiRef = pii.includes(".") ? "capturedPiiGrant" : pii;
        const captures = [
          execution.includes(".")
            ? `const ${executionRef} = ${execution};`
            : "",
          pii.includes(".")
            ? `const ${piiRef} = ${pii};`
            : "",
        ].filter(Boolean).join("\n          ");
        expect(dualAuthorityViolations(`
          ${captures}
          assertActionGrant(${executionRef}, "execution.initiate");
          assertActionGrant(${piiRef}, "pii.view");
          assertSameTenant(${executionRef}.tenant, ${piiRef}.tenant);
          return db.query("SELECT 1");
        `, params)).toEqual([]);
        });
      },
    );

    it("recursively preserves every distinct wrapped grant path", () => {
      const params = `db: SqlDb,
          wrapped: {
            authorities: {
              executionGrant: ActionGrant<"execution.initiate">,
              piiGrant: ActionGrant<"pii.view">
            }
          },`;
      expect(dualAuthorityViolations(`
          assertActionGrant(wrapped.authorities.executionGrant, "execution.initiate");
          assertActionGrant(wrapped.authorities.piiGrant, "pii.view");
          return db.query("SELECT 1");
      `, params)).toHaveLength(1);
      expect(dualAuthorityViolations(`
          const executionGrant = wrapped.authorities.executionGrant;
          const piiGrant = wrapped.authorities.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(
            executionGrant.tenant,
            piiGrant.tenant
          );
          return db.query("SELECT 1");
      `, params)).toEqual([]);
    });

    it("rejects repeated evaluation of an accessor-backed wrapped authority", () => {
      const prelude = `
        class GrantCarrier {
          get piiGrant(): ActionGrant<"pii.view"> {
            throw new Error("stateful getter");
          }
        }`;
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          carrier: GrantCarrier,`;
      expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(carrier.piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, carrier.piiGrant.tenant);
          return db.query("SELECT 1");
      `, params, prelude)).toHaveLength(1);
      expect(dualAuthorityViolations(`
          const piiGrant = carrier.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          return db.query("SELECT 1");
      `, params, prelude)).toEqual([]);
      expect(dualAuthorityViolations(`
          const piiGrant = carrier.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          const alias = carrier;
          return db.query(alias.piiGrant.tenant.orgId);
      `, params, prelude)).toHaveLength(1);
    });

    it.each([
      `const { piiGrant: later } = carrier;
          return db.query(later.tenant.orgId);`,
      `let later: ActionGrant<"pii.view">;
          ({ piiGrant: later } = carrier);
          return db.query(later.tenant.orgId);`,
    ])("rejects a later destructuring read of a captured authority", (laterRead) => {
      const prelude = `
        class GrantCarrier {
          get piiGrant(): ActionGrant<"pii.view"> {
            throw new Error("stateful getter");
          }
        }`;
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          carrier: GrantCarrier,`;
      expect(dualAuthorityViolations(`
          const piiGrant = carrier.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          ${laterRead}
      `, params, prelude)).toHaveLength(1);
    });

    it.each([
      `const copy = { ...carrier };
          return db.query(copy.piiGrant.tenant.orgId);`,
      `const copy = Object.assign({}, carrier);
          return db.query(copy.piiGrant.tenant.orgId);`,
      `const assign = Object.assign;
          const copy = assign({}, carrier);
          return db.query(copy.piiGrant.tenant.orgId);`,
      `const { assign } = Object;
          const copy = assign({}, carrier);
          return db.query(copy.piiGrant.tenant.orgId);`,
      `const copy = structuredClone(carrier);
          return db.query(copy.piiGrant.tenant.orgId);`,
      `const { ...copy } = carrier;
          return db.query(copy.piiGrant.tenant.orgId);`,
    ])("rejects copying a captured authority carrier", (laterRead) => {
      const prelude = `
        class GrantCarrier {
          get piiGrant(): ActionGrant<"pii.view"> {
            throw new Error("stateful getter");
          }
        }`;
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          carrier: GrantCarrier,`;
      expect(dualAuthorityViolations(`
          const piiGrant = carrier.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          ${laterRead}
      `, params, prelude)).toHaveLength(1);
    });

    it.each([
      `const alias = flag ? carrier : carrier;
          return db.query(alias.piiGrant.tenant.orgId);`,
      `const alias = carrier || carrier;
          return db.query(alias.piiGrant.tenant.orgId);`,
      `let alias = carrier;
          if (flag) alias = carrier;
          return db.query(alias.piiGrant.tenant.orgId);`,
    ])("rejects authority re-reads through conditional, logical, and assigned aliases", (laterRead) => {
      const prelude = `
        class GrantCarrier {
          get piiGrant(): ActionGrant<"pii.view"> {
            throw new Error("stateful getter");
          }
        }`;
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          carrier: GrantCarrier,
          flag: boolean,`;
      expect(dualAuthorityViolations(`
          const piiGrant = carrier.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          ${laterRead}
      `, params, prelude)).toHaveLength(1);
    });

    it.each([
      `const later = Object.freeze(carrier).piiGrant;
          return db.query(later.tenant.orgId);`,
      `const later = [carrier][0]!.piiGrant;
          return db.query(later.tenant.orgId);`,
      `const box = [carrier] as const;
          const later = box[0].piiGrant;
          return db.query(later.tenant.orgId);`,
      `const box = { held: carrier } as const;
          const later = box.held.piiGrant;
          return db.query(later.tenant.orgId);`,
      `let box: readonly [GrantCarrier];
          box = [carrier] as const;
          const later = box[0].piiGrant;
          return db.query(later.tenant.orgId);`,
    ])("rejects authority re-reads through transparent wrappers and fixed containers", (laterRead) => {
      const prelude = `
        class GrantCarrier {
          get piiGrant(): ActionGrant<"pii.view"> {
            throw new Error("stateful getter");
          }
        }`;
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          carrier: GrantCarrier,`;
      expect(dualAuthorityViolations(`
          const piiGrant = carrier.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          ${laterRead}
      `, params, prelude)).toHaveLength(1);
    });

    it.each([
      `const later = Reflect.get(carrier, "piiGrant");
          return db.query(later.tenant.orgId);`,
      `const R = Reflect;
          const later = R.get(carrier, "piiGrant");
          return db.query(later.tenant.orgId);`,
      `const { get } = Reflect;
          const later = get(carrier, "piiGrant");
          return db.query(later.tenant.orgId);`,
      `const key = "piiGrant";
          const later = Reflect.get(carrier, key);
          return db.query(later.tenant.orgId);`,
      `const later = Object.getOwnPropertyDescriptor(carrier, "piiGrant")?.value;
          return db.query(later.tenant.orgId);`,
      `const descriptors = Object.getOwnPropertyDescriptors(carrier);
          return db.query(descriptors.piiGrant.value.tenant.orgId);`,
      `const later = Reflect.get.call(Reflect, carrier, "piiGrant");
          return db.query(later.tenant.orgId);`,
      `const later = Reflect.get.apply(Reflect, [carrier, "piiGrant"]);
          return db.query(later.tenant.orgId);`,
      `const later = Reflect.apply(Reflect.get, Reflect, [carrier, "piiGrant"]);
          return db.query(later.tenant.orgId);`,
      `const later = Reflect.get.bind(Reflect)(carrier, "piiGrant");
          return db.query(later.tenant.orgId);`,
      `const key = flag ? "piiGrant" : "other";
          const later = Reflect.get(carrier, key);
          return db.query(later.tenant.orgId);`,
    ])("rejects reflective reads of a captured authority carrier", (laterRead) => {
      const prelude = `
        class GrantCarrier {
          get piiGrant(): ActionGrant<"pii.view"> {
            throw new Error("stateful getter");
          }
        }`;
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          carrier: GrantCarrier,
          flag: boolean,`;
      expect(dualAuthorityViolations(`
          const piiGrant = carrier.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          ${laterRead}
      `, params, prelude)).toHaveLength(1);
    });

    it.each([
      `provider: () => ActionGrant<"pii.view">`,
      `provider: new () => ActionGrant<"pii.view">`,
      `provider: { grant(): ActionGrant<"pii.view"> }`,
      `provider: { grant: () => ActionGrant<"pii.view"> }`,
      `provider: { Grant: new () => ActionGrant<"pii.view"> }`,
    ])("rejects an authority-producing dynamic carrier: %s", (provider) => {
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          ${provider},`;
      expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          return db.query("SELECT 1");
      `, params)).toHaveLength(1);
    });

    it.each([
      `provider: (accept: (grant: ActionGrant<"pii.view">) => void) => void`,
      `provider: { withGrant(accept: (grant: ActionGrant<"pii.view">) => void): void }`,
      `provider: (accept: (tenant: TenantContext) => void) => void`,
      `provider: (accept: (actor: ActorRef) => void) => void`,
      `provider: (accept: (principal: Principal) => void) => void`,
      `provider: (accept: (actor: WriteActor) => void) => void`,
      `provider: (accept: (nested: (grant: ActionGrant<"pii.view">) => void) => void) => void`,
    ])("rejects an authority supplied through a callback parameter: %s", (provider) => {
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          ${provider},`;
      expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          return db.query("SELECT 1");
      `, params)).toHaveLength(1);
    });

    it.each([
      `grant = replacementGrant;`,
      `({ grant } = { grant: replacementGrant });`,
      `for (grant of [replacementGrant]) { void grant; }`,
    ])("rejects reassignment of a direct authority after its prologue assertion", (write) => {
      const prelude = `declare const replacementGrant: ActionGrant<"pii.view">;`;
      const params = `db: SqlDb,
          grant: ActionGrant<"pii.view">,`;
      expect(dualAuthorityViolations(`
          assertActionGrant(grant, "pii.view");
          ${write}
          return db.query("SELECT 1");
      `, params, prelude)).toHaveLength(1);
    });

    it("rejects reassignment of an authority from a destructured parameter", () => {
      const prelude = `declare const replacementGrant: ActionGrant<"pii.view">;`;
      const params = `db: SqlDb,
          { grant }: { grant: ActionGrant<"pii.view"> },`;
      expect(dualAuthorityViolations(`
          assertActionGrant(grant, "pii.view");
          grant = replacementGrant;
          return db.query("SELECT 1");
      `, params, prelude)).toHaveLength(1);
    });

    it("allows writes to a nested shadow that is not the asserted authority binding", () => {
      const params = `db: SqlDb,
          grant: ActionGrant<"pii.view">,`;
      expect(dualAuthorityViolations(`
          assertActionGrant(grant, "pii.view");
          function normalize(grant: string): string {
            grant = grant.trim();
            return grant;
          }
          return db.query(normalize("value"));
      `, params)).toEqual([]);
    });

    it("accepts a closed union only when every arm has the same authority inventory", () => {
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          wrapped:
            | { piiGrant: ActionGrant<"pii.view">; mode: "one" }
            | { piiGrant: ActionGrant<"pii.view">; mode: "two" },`;
      expect(dualAuthorityViolations(`
          const piiGrant = wrapped.piiGrant;
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          return db.query("SELECT 1");
      `, params)).toEqual([]);
    });

    it.each([
      `wrapped: { piiGrant: ActionGrant<"pii.view"> } | { token: string }`,
      `wrapped: { piiGrant?: ActionGrant<"pii.view"> }`,
      `wrapped: Array<ActionGrant<"pii.view">>`,
      `wrapped: readonly ActionGrant<"pii.view">[]`,
      `wrapped: [ActionGrant<"pii.view">, ...ActionGrant<"pii.view">[]]`,
      `wrapped: Record<string, ActionGrant<"pii.view">>`,
      `wrapped: { [key: string]: ActionGrant<"pii.view"> }`,
    ])("rejects a runtime-dynamic authority carrier: %s", (carrier) => {
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          ${carrier},`;
      expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          return db.query("SELECT 1");
      `, params)).toHaveLength(1);
    });

    it("rejects conditional absence even when the present arm is fully asserted", () => {
      const params = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          wrapped: { piiGrant?: ActionGrant<"pii.view"> },`;
      expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(wrapped.piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, wrapped.piiGrant.tenant);
          return db.query("SELECT 1");
      `, params)).toHaveLength(1);
    });

    it("enumerates every fixed tuple authority path", () => {
      const params = `db: SqlDb,
          grants: readonly [
            ActionGrant<"execution.initiate">,
            ActionGrant<"pii.view">
          ],`;
      expect(dualAuthorityViolations(`
          assertActionGrant(grants[0], "execution.initiate");
          assertActionGrant(grants[1], "pii.view");
          return db.query("SELECT 1");
      `, params)).toHaveLength(1);
      expect(dualAuthorityViolations(`
          const executionGrant = grants[0];
          const piiGrant = grants[1];
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          return db.query("SELECT 1");
      `, params)).toEqual([]);
    });

    it("rejects recursive authority cardinality without rejecting recursive business data", () => {
      const authorityPrelude = `
        interface RecursiveAuthority {
          piiGrant: ActionGrant<"pii.view">;
          next?: RecursiveAuthority;
        }`;
      const authorityParams = `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          wrapped: RecursiveAuthority,`;
      expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(wrapped.piiGrant, "pii.view");
          assertSameTenant(executionGrant.tenant, wrapped.piiGrant.tenant);
          return db.query("SELECT 1");
      `, authorityParams, authorityPrelude)).toHaveLength(1);

      const businessPrelude = `
        interface RecursiveBusiness {
          value: string;
          next?: RecursiveBusiness;
        }`;
      const businessParams = `db: SqlDb,
          tenant: TenantContext,
          input: RecursiveBusiness,`;
      expect(dualAuthorityViolations(`
          assertTenantContext(tenant);
          void input;
          return db.query("SELECT 1");
      `, businessParams, businessPrelude)).toEqual([]);
    });

    it("rejects a grant-pair proof delayed until after repository work", () => {
      expect(dualAuthorityViolations(`
          assertActionGrant(executionGrant, "execution.initiate");
          assertActionGrant(piiGrant, "pii.view");
          const rows = db.query("SELECT 1");
          assertSameTenant(executionGrant.tenant, piiGrant.tenant);
          return rows;
      `, `db: SqlDb,
          executionGrant: ActionGrant<"execution.initiate">,
          piiGrant: ActionGrant<"pii.view">,`)).toHaveLength(1);
    });

    it("rejects the same omission when the GRANT is declared before the tenant", () => {
      // The cross-check must not be opt-out by declaration order: deriving the
      // prologue from the FIRST sealed parameter meant swapping these two positions
      // dropped both the tenant assertion and the same-tenant proof entirely.
      const reversed = `
          db: SqlDb,
          grant: ActionGrant<"pii.view">,
          tenant: TenantContext,`;
      expect(dualAuthorityViolations(
        `
          assertActionGrant(grant, "pii.view");
          return db.query("SELECT 1");
        `,
        reversed,
      )).toHaveLength(1);
      expect(dualAuthorityViolations(
        `
          assertActionGrant(grant, "pii.view");
          assertTenantContext(tenant);
          assertSameTenant(tenant, grant.tenant);
          return db.query("SELECT 1");
        `,
        reversed,
      )).toEqual([]);
    });

    it("rejects a tenant WRAPPED in an object parameter that never proves the same scope", () => {
      const wrapped = `
          db: SqlDb,
          ctx: { tenant: TenantContext },
          grant: ActionGrant<"pii.view">,`;
      expect(dualAuthorityViolations(
        `
          assertTenantContext(ctx.tenant);
          assertActionGrant(grant, "pii.view");
          return db.query("SELECT 1");
        `,
        wrapped,
      )).toHaveLength(1);
      expect(dualAuthorityViolations(
        `
          const tenant = ctx.tenant;
          assertTenantContext(tenant);
          assertActionGrant(grant, "pii.view");
          assertSameTenant(tenant, grant.tenant);
          return db.query("SELECT 1");
        `,
        wrapped,
      )).toEqual([]);
    });

    it("requires every direct and wrapped tenant path to agree", () => {
      const params = `
          db: SqlDb,
          tenant: TenantContext,
          wrapped: { authority: { tenant: TenantContext } },`;
      expect(dualAuthorityViolations(
        `
          assertTenantContext(tenant);
          assertTenantContext(wrapped.authority.tenant);
          return db.query("SELECT 1");
        `,
        params,
      )).toHaveLength(1);
      expect(dualAuthorityViolations(
        `
          const wrappedTenant = wrapped.authority.tenant;
          assertTenantContext(tenant);
          assertTenantContext(wrappedTenant);
          assertSameTenant(tenant, wrappedTenant);
          return db.query("SELECT 1");
        `,
        params,
      )).toEqual([]);
    });

    it("rejects a grant whose action is a UNION or a type parameter, not one literal", () => {
      // Widening the action type used to drop BOTH the grant assertion and the
      // same-tenant proof, so a one-token signature change removed the whole
      // cross-authority requirement. There is no single assertion that proves a
      // union, so the signature is refused instead.
      for (
        const params of [
          `
          db: SqlDb,
          tenant: TenantContext,
          grant: ActionGrant<"pii.view" | "audit.export">,`,
          `
          db: SqlDb,
          tenant: TenantContext,
          grant: ActionGrant<A>,`,
        ]
      ) {
        expect(
          dualAuthorityViolations(
            `
          assertTenantContext(tenant);
          return db.query("SELECT 1");
        `,
            params,
          ),
          params,
        ).toHaveLength(1);
      }
    });

    it("flags an exported repository function without tenant scope", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export function listAll(db: SqlDb) { return db.query("SELECT 1"); }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags an imported SQL type alias", () => {
      const project = repositoryFixture(`
        import type { SqlDb as Database } from "../store/db";
        export function listAll(db: Database) { return db.query("SELECT 1"); }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags a contextually inferred SQL parameter", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        type Read = (db: SqlDb) => unknown;
        export const listAll: Read = (db) => db.query("SELECT 1");
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags a structural SQL executor without an adapter import", () => {
      const project = inMemoryProject({
        "/src/infrastructure/new-adapter/repository.ts": `
          interface Executor {
            query(sql: string, params?: unknown[]): Promise<unknown>;
          }
          export function listAll(db: Executor) {
            return db.query("SELECT 1");
          }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/new-adapter/repository.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("requires runtime tenant proof for a structural SQL executor", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
          export function assertTenantContext(
            value: unknown,
          ): asserts value is TenantContext {}
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { TenantContext } from "../../contracts/tenant";
          interface Executor {
            query(sql: string, params?: unknown[]): Promise<unknown>;
          }
          export function listAll(db: Executor, tenant: TenantContext) {
            return db.query("SELECT 1", [tenant.orgId]);
          }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/new-adapter/repository.ts :: listAll",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("flags an exported repository function that obtains its database internally", () => {
      const project = repositoryFixture(`
        import { getDb } from "../store/db";
        export async function listAll() {
          const db = await getDb();
          return db.query("SELECT 1");
        }
      `, {
        "/src/infrastructure/store/db.ts": `
          export interface SqlQueryable { query(sql: string): unknown }
          export interface SqlTx extends SqlQueryable {}
          export interface SqlDb extends SqlQueryable {}
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags SQL-backed repositories outside the established adapter directories", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query(sql: string): unknown }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import { getDb } from "../store/db";
          export async function listAll() {
            const db = await getDb();
            return db.query("SELECT 1");
          }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/new-adapter/repository.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags repositories that import the SQL adapter directly", () => {
      const project = inMemoryProject({
        "/src/infrastructure/direct/repository.ts": `
          import { PGlite } from "@electric-sql/pglite";
          export async function listAll() {
            const db = new PGlite();
            return db.query("SELECT 1");
          }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/direct/repository.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags an exported repository class method with a bound database", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export class Repo {
          constructor(private db: SqlDb) {}
          listAll() { return this.db.query("SELECT 1"); }
        }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags exported repository object methods", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export const repo = {
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        };
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags default-exported repository object methods", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        const repo = {
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        };
        export default repo;
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags separately exported repository object methods", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        const repo = {
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        };
        export { repo };
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("allows direct TenantContext, aliased TenantContext, and WriteActor", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import { assertTenantContext, type TenantContext as Scope } from "../../contracts/tenant";
        import { assertWriteActor, type WriteActor } from "../../contracts/principal";
        export function listGood(db: SqlDb, tenant: Scope) {
          assertTenantContext(tenant);
          return db.query("SELECT 1");
        }
        export function writeGood(db: SqlDb, actor: WriteActor) {
          assertWriteActor(actor);
          return db.query("SELECT 1");
        }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([]);
    });

    it("flags a typed tenant parameter whose runtime seal is never asserted", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        export function listAll(db: SqlDb, tenant: TenantContext) {
          return db.query("SELECT 1");
        }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: listAll",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("flags an unguarded method returned by an escaped repository factory", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        interface Repo {
          loadById(id: string, tenant: TenantContext): unknown;
        }
        export function makeRepo(db: SqlDb): Repo {
          return {
            loadById(id, tenant) {
              return db.query("SELECT 1");
            },
          };
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.loadById",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });
    it("fails closed when an escaped SQL factory returns an opaque helper result", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        declare function buildRepo(db: SqlDb): any;
        export function makeRepo(db: SqlDb): any {
          return buildRepo(db);
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.<unresolved>",
          detail: "returned callable implementation cannot be proven",
        },
      ]);
    });
    it("flags an unguarded method returned through Object.freeze", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        interface Repo {
          loadById(id: string, tenant: TenantContext): unknown;
        }
        export function makeRepo(db: SqlDb): Repo {
          return Object.freeze({
            loadById(id: string, tenant: TenantContext) {
              return db.query("SELECT 1");
            },
          });
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.loadById",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("flags methods returned by private class and conditional factory implementations", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        interface Repo {
          loadById(id: string, tenant: TenantContext): unknown;
        }
        class PrivateRepo implements Repo {
          constructor(private readonly db: SqlDb) {}
          loadById(id: string, tenant: TenantContext) {
            return this.db.query("SELECT 1");
          }
        }
        export function makeRepo(db: SqlDb, useClass: boolean): Repo {
          return useClass
            ? new PrivateRepo(db)
            : {
                loadById(id, tenant) {
                  return db.query("SELECT 1");
                },
              };
        }
      `);
      const violations = detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      );
      expect(violations.filter((violation) =>
        violation.ref === "src/infrastructure/crm/subject.ts :: makeRepo.loadById"
      )).toHaveLength(2);
    });

    it("fails closed when a factory's callable implementation cannot be resolved", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        interface Repo {
          loadById(id: string, tenant: TenantContext): unknown;
        }
        declare function buildRepo(db: SqlDb): Repo;
        export function makeRepo(db: SqlDb): Repo {
          return buildRepo(db);
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.loadById",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("resolves callable getters returned by private class factories", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        interface Repo {
          readonly loadById: (id: string, tenant: TenantContext) => unknown;
        }
        class PrivateRepo implements Repo {
          constructor(private readonly db: SqlDb) {}
          get loadById() {
            return (id: string, tenant: TenantContext) =>
              this.db.query("SELECT 1");
          }
        }
        export function makeRepo(db: SqlDb): Repo {
          return new PrivateRepo(db);
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.loadById.<call>",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("resolves callable getters returned by object-literal factories", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        interface Repo {
          readonly loadById: (id: string, tenant: TenantContext) => unknown;
        }
        export function makeRepo(db: SqlDb): Repo {
          return {
            get loadById() {
              return (id: string, tenant: TenantContext) =>
                db.query("SELECT 1");
            },
          };
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.loadById.<call>",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("flags unscoped methods returned by exported object and class factories", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export const factories = {
          make(db: SqlDb) {
            return { load() { return db.query("SELECT 1"); } };
          },
        };
        export class Factory {
          make(db: SqlDb) {
            return { save() { return db.query("SELECT 1"); } };
          }
        }
      `);
      const escapes = new Set([
        ...ESCAPE_SET,
        "src/infrastructure/crm/subject.ts :: factories.make",
        "src/infrastructure/crm/subject.ts :: Factory.make",
      ]);
      expect(detectMissingTenantParams(project, escapes)).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: factories.make.load",
          detail: "repository callable has no sealed tenant context",
        },
        {
          ref: "src/infrastructure/crm/subject.ts :: Factory.make.save",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags an unscoped method returned by SHORTHAND property", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export function makeRepo(db: SqlDb) {
          function listAll() { return db.query("SELECT 1"); }
          const loadById = (id: string) => db.query("SELECT 1");
          return { listAll, loadById };
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.listAll",
          detail: "repository callable has no sealed tenant context",
        },
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.loadById",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags an unscoped method returned through a SPREAD", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export function makeRepo(db: SqlDb) {
          const base = {
            listAll() { return db.query("SELECT 1"); },
          };
          return { ...base };
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags an unscoped repository object wrapped in Object.freeze", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export const householdRepo = Object.freeze({
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        });
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: householdRepo.listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags an unscoped repository behind a Readonly<> annotation", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        interface Repo { listAll(db: SqlDb): unknown }
        export const householdRepo: Readonly<Repo> = {
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        };
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: householdRepo.listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("keeps repository escapes exact-match", () => {
      const project = repositoryFixture(
        `import type { SqlDb } from "../store/db"; export function findUserByEmailOrRole(db: SqlDb) { return db.query("SELECT 1"); }`,
        {
          "/src/infrastructure/identity/identity-store.ts": `
            import type { SqlDb } from "../store/db";
            export function findUserByEmailOrRole(db: SqlDb) { return db.query("SELECT 1"); }
          `,
        },
      );
      expect(detectMissingTenantParams(project, ESCAPE_SET).some((violation) =>
        violation.ref.includes("findUserByEmailOrRole")
      )).toBe(true);
    });

    it("flags an unscoped exported port method", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `export interface EvidencePort { load(id: string): unknown }`,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: EvidencePort.load",
      ]);
    });

    it("flags dependency-shaped interfaces regardless of their name", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export interface AccountOpeningDeps {
            createContact(input: { firstName: string }): Promise<void>;
          }
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: AccountOpeningDeps.createContact",
      ]);
    });

    it("flags callable-property and direct-call port signatures", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export interface LoaderDeps {
            load: (id: string) => unknown;
          }
          export interface Resolver {
            (id: string): unknown;
          }
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: LoaderDeps.load",
        "src/domain/evil.ts :: Resolver.<call>",
      ]);
    });

    it("flags type-alias and abstract-class port forms", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/domain/evil.ts": `
          export type LoaderPort = {
            load(id: string): unknown;
          };
          export abstract class WriterPort {
            abstract save(id: string): Promise<void>;
          }
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: LoaderPort.load",
        "src/domain/evil.ts :: WriterPort.save",
      ]);
    });

    it("flags separately exported type-alias and abstract-class ports", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/domain/evil.ts": `
          type LoaderPort = {
            load(id: string): unknown;
          };
          abstract class WriterPort {
            abstract save(id: string): Promise<void>;
          }
          export { LoaderPort, WriterPort };
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: LoaderPort.load",
        "src/domain/evil.ts :: WriterPort.save",
      ]);
    });

    it("flags exported function and function-valued variable port forms", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export function load(id: string): unknown {
            return id;
          }
          export const save: (id: string) => Promise<void> = async () => {};
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: load.<call>",
        "src/domain/evil.ts :: save.<call>",
      ]);
    });
  });
});
