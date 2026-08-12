/**
 * REFERENCE CLOSURE ACROSS SECTIONS, AND VERSION IDENTITY - the parts of the
 * load that read the WHOLE document (v3 prompt 10; ADR-0056). Split from
 * `load.ts` for the per-file ceiling; the pipeline order is unchanged and
 * `load.ts` remains the only caller.
 */
import {
  changeDeclarationMismatch,
  diffDomainConfigs,
  EMPTY_CONFIG_BASELINE,
} from "./diff";
import type { DomainConfigDocument } from "./document";
import { configError, type DomainConfigError } from "./errors";
import {
  BEFORE_ANY_STEP,
  checkBucketSource,
  checkSource,
  requireMember,
  type ClosureWorld,
  type SourceAvailability,
} from "./load-closure";
import type { DomainConfigEnvironment, LoadedBinding, LoadedIntent } from "./load";
import { templatePlaceholders } from "./segments";

/**
 * Each plan step's transitive `dependsOn` closure - the steps that have run, and
 * therefore published, by the time that step executes. Computed as a fixpoint
 * rather than by recursion so a cyclic template, which stage 5 refuses on its
 * own, still terminates here instead of overflowing before the cycle is
 * reported.
 */
const transitiveDependencies = (
  steps: readonly { readonly id: string; readonly dependsOn: readonly string[] }[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const closure = new Map<string, Set<string>>(
    steps.map((step) => [step.id, new Set<string>(step.dependsOn)]),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, reached] of closure) {
      for (const dependency of [...reached]) {
        for (const inherited of closure.get(dependency) ?? []) {
          if (inherited === id || reached.has(inherited)) continue;
          reached.add(inherited);
          grew = true;
        }
      }
    }
  }
  return closure;
};

/** Stage 3-4 over every section that references a name or a typed value source. */
export const checkReferences = (
  document: DomainConfigDocument,
  intents: ReadonlyMap<string, LoadedIntent>,
  bindings: ReadonlyMap<string, LoadedBinding>,
  sink: (error: DomainConfigError) => void,
): void => {
  const evidenceKinds = new Set(document.evidence.map((entry) => entry.evidenceKind as string));
  const capabilityIds = new Set(document.execution.capabilities.map((entry) => entry.id as string));
  const conflictKeyIds = new Set(document.conflictKeys.map((entry) => entry.id as string));
  const reservationIds = new Set(document.reservations.map((entry) => entry.id as string));
  const verificationIds = new Set(document.verification.map((entry) => entry.id as string));
  const templateIds = new Set(document.authority.templates.map((entry) => entry.id as string));
  const bindingIds = new Set(bindings.keys());
  const commandText = document.presentation.copy.commandText;
  const commandTextKeys = new Set(Object.keys(commandText));
  const allSlots = new Set(document.intents.flatMap((intent) => intent.slots.map((slot) => slot.id)));

  for (const [id, loaded] of intents) {
    const path = `intents.${id}`;
    for (const kind of loaded.intent.requiresEvidence) {
      requireMember(kind, evidenceKinds, `${path}.requiresEvidence`, "evidence kind", sink);
    }
    for (const key of loaded.intent.conflictKeys) {
      requireMember(key, conflictKeyIds, `${path}.conflictKeys`, "conflict key template", sink);
    }
    for (const reservation of loaded.intent.reservations) {
      requireMember(reservation, reservationIds, `${path}.reservations`, "reservation rule", sink);
    }
    if (loaded.intent.policySlot !== undefined) {
      requireMember(
        loaded.intent.policySlot,
        new Set(document.policy.slots.map((slot) => slot.id as string)),
        `${path}.policySlot`,
        "policy slot",
        sink,
      );
    }
    for (const slot of loaded.intent.slots) {
      if (slot.boundBy === undefined) continue;
      const slotPath = `${path}.slots.${slot.id}.boundBy`;
      if (!requireMember(slot.boundBy.binding, new Set(loaded.intent.primitiveBindings), slotPath, "bound primitive binding", sink)) {
        continue;
      }
      const producer = bindings.get(slot.boundBy.binding);
      if (producer !== undefined && !Object.keys(producer.publishedKeys).includes(slot.boundBy.publishes)) {
        sink(
          configError(
            "unknown-reference",
            `${slotPath}.publishes`,
            `binding ${slot.boundBy.binding} publishes no key named ${JSON.stringify(slot.boundBy.publishes)}`,
          ),
        );
      }
    }
    const awaitingRules = new Set(
      document.verification.filter((rule) => rule.awaitsExternal).map((rule) => rule.id as string),
    );
    const steps = document.execution.planTemplates.find((entry) => entry.id === loaded.intent.executionPlan)?.steps ?? [];
    const dependencies = transitiveDependencies(steps);
    const gatedSteps = new Set(
      steps
        .filter((step) => {
          const capability = document.execution.capabilities.find((entry) => entry.id === step.capability);
          return capability !== undefined && awaitingRules.has(capability.verificationRule);
        })
        .map((step) => step.id as string),
    );
    /** What a source may read at the point the CONSUMING step runs, never plan-wide. */
    const availabilityAt = (stepId: string): SourceAvailability => {
      const published = dependencies.get(stepId) ?? new Set<string>();
      return { step: stepId, published, observed: [...published].some((id) => gatedSteps.has(id)) };
    };
    const world: ClosureWorld = {
      document,
      slots: loaded.slots,
      contextKeys: loaded.contextKeys,
      stepCapability: loaded.stepCapability,
      availability: BEFORE_ANY_STEP,
    };
    /**
     * WHAT THIS INTENT REACHES, by EVERY route the reachability check counts.
     * `checkReachability` calls a conflict key live when an intent, a CAPABILITY
     * or a RESERVATION names it, and a reservation live when an intent or a
     * capability names it. Scoping the type check to the intent's own lists left
     * the difference reachable-and-therefore-not-dead while never type-checked -
     * an unknown slot, a text slot inside a coordination key (MR-7), or a bucket
     * over a non-date source would load clean and fail mid-plan, in the very
     * stage that exists to prevent that.
     */
    const planCapabilities = steps.flatMap((step) => {
      const capability = document.execution.capabilities.find((entry) => entry.id === step.capability);
      return capability === undefined ? [] : [capability];
    });
    const reachedReservations = new Set<string>([
      ...loaded.intent.reservations,
      ...planCapabilities.flatMap((capability) => [...capability.reservations]),
    ]);
    const reachedConflictKeys = new Set<string>([
      ...loaded.intent.conflictKeys,
      ...planCapabilities.flatMap((capability) => [...capability.conflictKeys]),
      ...document.reservations
        .filter((reservation) => reachedReservations.has(reservation.id))
        .map((reservation) => reservation.conflictKey as string),
    ]);
    for (const template of document.conflictKeys) {
      if (!reachedConflictKeys.has(template.id)) continue;
      template.segments.forEach((segment, index) => {
        if (segment.kind === "literal") return;
        const at = `conflictKeys.${template.id}.segments[${index}]`;
        const resolved = checkSource(segment.source, "key", at, world, sink);
        if (segment.kind === "bucket") checkBucketSource(resolved, at, sink);
      });
    }
    for (const reservation of document.reservations) {
      if (!reachedReservations.has(reservation.id)) continue;
      const at = `reservations.${reservation.id}`;
      checkSource(reservation.quantity, "quantity", `${at}.quantity`, world, sink);
      requireMember(reservation.conflictKey, conflictKeyIds, `${at}.conflictKey`, "conflict key template", sink);
      if (reservation.visibleAsClaimTo !== undefined) {
        requireMember(reservation.visibleAsClaimTo, bindingIds, `${at}.visibleAsClaimTo`, "primitive binding", sink);
      }
    }
    for (const step of steps) {
      const capability = document.execution.capabilities.find((entry) => entry.id === step.capability);
      const at = `execution.capabilities.${step.capability}`;
      const stepWorld: ClosureWorld = { ...world, availability: availabilityAt(step.id) };
      if (!requireMember(step.capability, capabilityIds, `execution.planTemplates.${loaded.intent.executionPlan}.steps.${step.id}`, "capability", sink)) {
        continue;
      }
      if (capability === undefined) continue;
      requireMember(capability.verificationRule, verificationIds, `${at}.verificationRule`, "verification rule", sink);
      // An externally-gated capability owes a correlation token, and a
      // capability that is not gated may not claim one: a gate with no token to
      // be resumed by would never close, and a token nothing awaits is dead.
      const awaits =
        document.verification.find((rule) => rule.id === capability.verificationRule)?.awaitsExternal === true;
      if (awaits && capability.awaitTokenFrom === undefined) {
        sink(configError("incomplete", `${at}.awaitTokenFrom`, `verification rule ${capability.verificationRule} awaits an external observation, so this capability must publish a correlation token`));
      }
      if (!awaits && capability.awaitTokenFrom !== undefined) {
        sink(configError("incoherent", `${at}.awaitTokenFrom`, `verification rule ${capability.verificationRule} awaits nothing, so a correlation token has no consumer`));
      }
      if (
        capability.awaitTokenFrom !== undefined &&
        !capability.publishes.some((entry) => entry.output === capability.awaitTokenFrom)
      ) {
        sink(configError("unknown-reference", `${at}.awaitTokenFrom`, `this capability publishes no output named ${JSON.stringify(capability.awaitTokenFrom)}`));
      }
      for (const key of capability.conflictKeys) requireMember(key, conflictKeyIds, `${at}.conflictKeys`, "conflict key template", sink);
      for (const id of capability.reservations) requireMember(id, reservationIds, `${at}.reservations`, "reservation rule", sink);
      capability.idempotencyKey.forEach((segment, index) => {
        if (segment.kind === "literal") return;
        const keyPath = `${at}.idempotencyKey[${index}]`;
        const resolved = checkSource(segment.source, "key", keyPath, stepWorld, sink);
        if (segment.kind === "bucket") checkBucketSource(resolved, keyPath, sink);
      });
      for (const field of capability.payload) {
        const fieldPath = `${at}.payload.${field.field}`;
        if (field.kind === "copy") {
          // The copy KEY is domain-wide; the placeholders it renders are NOT.
          // `buildPayload` resolves a `{slot:…}` through THIS intent's resolver,
          // while stage 6 holds copy to the UNION of every intent's slot ids
          // because copy is authored per domain. In a two-intent document that
          // difference is another load-clean-then-fail hole: a template naming
          // intent A's slot, reached from a capability in intent B's plan, closes
          // cleanly and then fails at that step, after earlier steps committed.
          if (requireMember(field.copy, commandTextKeys, fieldPath, "command text key", sink)) {
            for (const placeholder of templatePlaceholders(commandText[field.copy] ?? "")) {
              if (placeholder.kind !== "slot" || loaded.slots.has(placeholder.token)) continue;
              sink(
                configError(
                  "unknown-reference",
                  fieldPath,
                  `command text ${JSON.stringify(field.copy)} reads {slot:${placeholder.token}}, which intent ${id} does not declare`,
                ),
              );
            }
          }
          continue;
        }
        checkSource(field.source, "payload", fieldPath, stepWorld, sink);
      }
    }
  }

  for (const requirement of document.evidence) {
    const at = `evidence.${requirement.evidenceKind}`;
    for (const action of requirement.requiredFor) {
      const intent = intents.get(action);
      if (intent === undefined) {
        sink(configError("unknown-reference", `${at}.requiredFor`, `no intent named ${JSON.stringify(action)}`));
        continue;
      }
      if (!intent.slots.has(requirement.subjectSlot)) {
        sink(
          configError(
            "unknown-reference",
            `${at}.subjectSlot`,
            `intent ${action} has no slot named ${JSON.stringify(requirement.subjectSlot)}`,
          ),
        );
      }
      if (!intent.intent.requiresEvidence.includes(requirement.evidenceKind)) {
        sink(
          configError(
            "incoherent",
            `${at}.requiredFor`,
            `intent ${action} does not list this evidence kind in requiresEvidence`,
          ),
        );
      }
    }
  }

  for (const declaration of document.instructionKinds) {
    const at = `instructionKinds.${declaration.kind}`;
    for (const slot of declaration.appliesToSlots) requireMember(slot, allSlots, `${at}.appliesToSlots`, "slot", sink);
    for (const binding of declaration.consumedBy) requireMember(binding, bindingIds, `${at}.consumedBy`, "primitive binding", sink);
  }
  for (const prohibition of document.prohibitions) {
    requireMember(prohibition.scopeSlot, allSlots, `prohibitions.${prohibition.code}.scopeSlot`, "slot", sink);
  }
  for (const blocker of document.blockers) {
    for (const kind of blocker.resolvingEvidence) {
      requireMember(kind, evidenceKinds, `blockers.${blocker.code}.resolvingEvidence`, "evidence kind", sink);
    }
  }
  for (const slot of document.policy.slots) {
    const at = `policy.slots.${slot.id}`;
    for (const template of slot.referenceableTemplates) {
      requireMember(template, templateIds, `${at}.referenceableTemplates`, "approval template", sink);
    }
    for (const code of slot.referenceableBlockerCodes) {
      requireMember(code, new Set(document.blockers.map((entry) => entry.code as string)), `${at}.referenceableBlockerCodes`, "blocker code", sink);
    }
    for (const code of slot.referenceableProhibitionCodes) {
      requireMember(code, new Set(document.prohibitions.map((entry) => entry.code as string)), `${at}.referenceableProhibitionCodes`, "prohibition code", sink);
    }
    for (const settable of slot.settableParameters) {
      const producer = bindings.get(settable.binding);
      const settablePath = `${at}.settableParameters.${settable.binding}.${settable.parameter}`;
      if (!requireMember(settable.binding, bindingIds, settablePath, "primitive binding", sink) || producer === undefined) continue;
      // OWN property, never `in`: `parameters` is a plain object and the
      // parameter name is an unconstrained string, so a slot naming `constructor`
      // or `toString` would satisfy a prototype-walking check and the loader
      // would admit a policy write to a parameter the primitive never declared -
      // a closure check failing OPEN, in the one module whose posture is that
      // every lookup is own-property (load-closure.ts).
      if (!Object.hasOwn(producer.parameters, settable.parameter)) {
        sink(configError("unknown-reference", settablePath, `binding ${settable.binding} declares no parameter named ${JSON.stringify(settable.parameter)}`));
      }
      // D-184: a key-shaping parameter is CONFIGURATION. A policy write to one
      // would publish a namespace the loader never closed over, so prompt 9's
      // loader refuses it - and this configuration may not offer it either.
      if (producer.primitive.keyShapingParameters.includes(settable.parameter)) {
        sink(
          configError(
            "incoherent",
            settablePath,
            `${settable.parameter} shapes the published key space and is configuration-only (D-184); policy may not be offered a write to it`,
          ),
        );
      }
    }
    for (const selectable of slot.selectableBindings) {
      const producer = bindings.get(selectable.binding);
      const selectablePath = `${at}.selectableBindings.${selectable.binding}`;
      if (!requireMember(selectable.binding, bindingIds, selectablePath, "primitive binding", sink) || producer === undefined) continue;
      for (const strategy of selectable.strategies) {
        if (!producer.primitive.allowedStrategies.includes(strategy)) {
          sink(configError("unknown-reference", `${selectablePath}.strategies`, `strategy ${JSON.stringify(strategy)} is not admitted by ${producer.primitive.id}`));
        }
      }
    }
  }
};

/** Stage 7: version identity, catalog agreement, and authorship provenance. */
export const checkIdentity = (
  document: DomainConfigDocument,
  environment: DomainConfigEnvironment,
  sink: (error: DomainConfigError) => void,
): void => {
  if (document.primitiveSetVersion !== environment.primitiveSetVersion) {
    sink(
      configError(
        "identity",
        "primitiveSetVersion",
        `document targets primitive set ${document.primitiveSetVersion}; the loaded catalog is ${environment.primitiveSetVersion}`,
      ),
    );
  }
  if (!environment.supportedPolicyGrammarVersions.includes(document.policyGrammarVersion)) {
    sink(
      configError(
        "identity",
        "policyGrammarVersion",
        `unsupported policy grammar ${document.policyGrammarVersion}`,
      ),
    );
  }
  const authorship = document.authorship;
  if (authorship.parentVersion === document.version) {
    sink(configError("identity", "authorship.parentVersion", "a version cannot be its own parent"));
  }
  const parent = authorship.parentVersion === null ? EMPTY_CONFIG_BASELINE : environment.parent;
  if (parent === undefined) {
    // The parent bytes are not available to this loader, so the declaration is
    // held only to being NON-EMPTY - a version that supersedes another and states
    // no change is either wrong or pointless, but which change it states cannot
    // be checked from here. A first version always takes the branch below against
    // the empty baseline; the shipped environment supplies no other parent, so the
    // full byte check for a PARENTED version waits on the persisted
    // configuration-version registry that decides where a superseded document's
    // canonical bytes live (prompts 15/19, PC-4 in docs/domain-config-gaps.md).
    if (authorship.changeFromParent.length === 0) {
      sink(configError("identity", "authorship.changeFromParent", "a version declaring a parent must state its change"));
    }
    return;
  }
  const mismatch = changeDeclarationMismatch(
    authorship.changeFromParent,
    diffDomainConfigs(parent, document as unknown as Readonly<Record<string, unknown>>),
  );
  for (const key of mismatch.unsupported) {
    sink(configError("identity", "authorship.changeFromParent", `declares ${key}, which its own bytes do not show`));
  }
  for (const key of mismatch.undeclared) {
    sink(configError("identity", "authorship.changeFromParent", `does not declare ${key}, which its own bytes show`));
  }
};

