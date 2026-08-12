/**
 * COHERENCE AND COMPLETENESS - stages 5 and 6 of the seven-stage load (v3
 * prompt 10; ADR-0058).
 *
 * COHERENCE asks whether a document that parses and closes CONTRADICTS itself:
 * a declared evidence requirement no intent needs, a capability no plan runs, a
 * verification rule nothing verifies. Every one of those is dead configuration,
 * and dead configuration is exactly what the X-9 honesty check exists to
 * refuse at a larger scale - a file whose deletion changes nothing.
 *
 * COMPLETENESS is TWO-SIDED on purpose. Every emittable code must have copy AND
 * every copy key must name a declared code. A one-sided check would let the
 * presentation section rot into a bag of strings nobody renders, which is how a
 * demo ends up showing a label the engine can no longer produce.
 */
import { configError, type DomainConfigError } from "./errors";
import type { DomainConfigDocument } from "./document";
import { templateIsInert, templatePlaceholders } from "./segments";

type Sink = (error: DomainConfigError) => void;

const unusedOf = (declared: readonly string[], used: ReadonlySet<string>): readonly string[] =>
  declared.filter((id) => !used.has(id)).sort();

/**
 * Nothing in the document may be unreachable from an intent. This is charter #5
 * applied inside a configuration file: a section entry nothing consumes is
 * built-but-not-shipped, at the granularity where it is cheapest to catch.
 */
export const checkReachability = (document: DomainConfigDocument, sink: Sink): void => {
  const usedEvidence = new Set(document.intents.flatMap((intent) => [...intent.requiresEvidence]));
  const usedBindings = new Set(document.intents.flatMap((intent) => [...intent.primitiveBindings]));
  const usedPlans = new Set(document.intents.map((intent) => intent.executionPlan));
  const usedConflictKeys = new Set([
    ...document.intents.flatMap((intent) => [...intent.conflictKeys]),
    ...document.execution.capabilities.flatMap((capability) => [...capability.conflictKeys]),
    ...document.reservations.map((reservation) => reservation.conflictKey),
  ]);
  const usedReservations = new Set([
    ...document.intents.flatMap((intent) => [...intent.reservations]),
    ...document.execution.capabilities.flatMap((capability) => [...capability.reservations]),
  ]);
  const usedCapabilities = new Set(
    document.execution.planTemplates.flatMap((template) => template.steps.map((step) => step.capability)),
  );
  const usedVerification = new Set(
    document.execution.capabilities.map((capability) => capability.verificationRule),
  );
  const usedPolicySlots = new Set(
    document.intents.flatMap((intent) => (intent.policySlot === undefined ? [] : [intent.policySlot])),
  );

  const unreachable: readonly (readonly [string, readonly string[]])[] = [
    ["evidence", unusedOf(document.evidence.map((entry) => entry.evidenceKind), usedEvidence)],
    ["primitiveBindings", unusedOf(document.primitiveBindings.map((entry) => entry.id), usedBindings)],
    ["execution.planTemplates", unusedOf(document.execution.planTemplates.map((entry) => entry.id), usedPlans)],
    [
      "execution.capabilities",
      unusedOf(document.execution.capabilities.map((entry) => entry.id), usedCapabilities),
    ],
    ["conflictKeys", unusedOf(document.conflictKeys.map((entry) => entry.id), usedConflictKeys)],
    ["reservations", unusedOf(document.reservations.map((entry) => entry.id), usedReservations)],
    ["verification", unusedOf(document.verification.map((entry) => entry.id), usedVerification)],
    ["policy.slots", unusedOf(document.policy.slots.map((entry) => entry.id), usedPolicySlots)],
  ];
  for (const [section, orphans] of unreachable) {
    for (const orphan of orphans) {
      sink(
        configError(
          "incoherent",
          `${section}.${orphan}`,
          "declared but reachable from no intent: dead configuration cannot ship",
        ),
      );
    }
  }
};

/** A plan template's dependency graph must be acyclic; `dependsOn` closure is schema-checked. */
export const checkPlanAcyclicity = (document: DomainConfigDocument, sink: Sink): void => {
  for (const template of document.execution.planTemplates) {
    const pending = new Map(template.steps.map((step) => [step.id as string, new Set<string>(step.dependsOn)]));
    let progressed = true;
    while (pending.size > 0 && progressed) {
      progressed = false;
      for (const [id, dependencies] of [...pending]) {
        if ([...dependencies].every((dependency) => !pending.has(dependency))) {
          pending.delete(id);
          progressed = true;
        }
      }
    }
    if (pending.size > 0) {
      sink(
        configError(
          "incoherent",
          `execution.planTemplates.${template.id}`,
          `plan steps form a cycle: ${[...pending.keys()].sort().join(", ")}`,
        ),
      );
    }
  }
};

const checkTwoSided = (
  section: string,
  copyKeys: readonly string[],
  declared: ReadonlySet<string>,
  what: string,
  sink: Sink,
): void => {
  for (const key of copyKeys) {
    if (!declared.has(key)) {
      sink(configError("incomplete", `${section}.${key}`, `copy names ${what} ${JSON.stringify(key)}, which is not declared`));
    }
  }
  for (const value of [...declared].sort()) {
    if (!copyKeys.includes(value)) {
      sink(configError("incomplete", `${section}.${value}`, `${what} ${JSON.stringify(value)} has no presentation copy`));
    }
  }
};

/**
 * Stage 6. Every code the domain can emit renders, and every rendered key names
 * something the domain can emit - checked in both directions, for five
 * vocabularies at once.
 */
export const checkCopyCompleteness = (document: DomainConfigDocument, sink: Sink): void => {
  const copy = document.presentation.copy;
  checkTwoSided(
    "presentation.copy.intents",
    Object.keys(copy.intents),
    new Set(document.intents.map((intent) => intent.id as string)),
    "intent",
    sink,
  );
  checkTwoSided(
    "presentation.copy.slots",
    Object.keys(copy.slots),
    new Set(document.intents.flatMap((intent) => intent.slots.map((slot) => slot.id))),
    "slot",
    sink,
  );
  checkTwoSided(
    "presentation.copy.evidenceKinds",
    Object.keys(copy.evidenceKinds),
    new Set(document.evidence.map((entry) => entry.evidenceKind as string)),
    "evidence kind",
    sink,
  );
  checkTwoSided(
    "presentation.copy.reasonCodes",
    Object.keys(copy.reasonCodes),
    new Set<string>([
      ...document.prohibitions.map((entry) => entry.code as string),
      ...document.blockers.map((entry) => entry.code as string),
    ]),
    "reason code",
    sink,
  );
  checkTwoSided(
    "presentation.copy.statusLabels",
    Object.keys(copy.statusLabels),
    new Set(document.verification.flatMap((rule) => rule.observedStatuses.map(String))),
    "observed status",
    sink,
  );
  checkTwoSided(
    "presentation.copy.commandText",
    Object.keys(copy.commandText),
    new Set(
      document.execution.capabilities.flatMap((capability) =>
        capability.payload.filter((field) => field.kind === "copy").map((field) => field.copy as string),
      ),
    ),
    "command text key",
    sink,
  );
};

/**
 * Every copy template is INERT and its placeholders resolve. `knownSlots` is
 * the union of every intent's slots and `knownContextKeys` the union of every
 * intent's derived keys, because copy is authored per domain, not per intent.
 */
export const checkCopyTemplates = (
  document: DomainConfigDocument,
  knownSlots: ReadonlySet<string>,
  knownContextKeys: ReadonlySet<string>,
  sink: Sink,
): void => {
  const copy = document.presentation.copy;
  /**
   * The third element is whether the PLAN COMPILER renders this template. Command
   * text is rendered mid-plan, against flow data; reason-code copy is rendered by
   * the evaluator against the decision's context plane (prompts 16/17). Only the
   * first has to be held to what the interim substrate can actually resolve.
   */
  const templates: readonly (readonly [string, string, boolean])[] = [
    ...Object.entries(copy.commandText).map(
      ([key, text]) => [`presentation.copy.commandText.${key}`, text, true] as const,
    ),
    ...Object.entries(copy.reasonCodes).flatMap(([key, entry]) =>
      [
        [`presentation.copy.reasonCodes.${key}.title`, entry.title, false] as const,
        [`presentation.copy.reasonCodes.${key}.body`, entry.body, false] as const,
        [`presentation.copy.reasonCodes.${key}.resolution`, entry.resolution, false] as const,
      ],
    ),
  ];
  for (const [path, template, renderedByPlan] of templates) {
    if (!templateIsInert(template)) {
      sink(
        configError("not-inert", path, "a copy template may contain only {slot:…} and {context:…} placeholders"),
      );
      continue;
    }
    for (const placeholder of templatePlaceholders(template)) {
      const known = placeholder.kind === "slot" ? knownSlots : knownContextKeys;
      if (!known.has(placeholder.token)) {
        sink(
          configError(
            "unknown-reference",
            path,
            `placeholder {${placeholder.kind}:${placeholder.token}} names nothing this domain publishes`,
          ),
        );
        continue;
      }
      // The same refusal `resolveSourceType` gives a `{from: context}` value
      // source, for the same reason: command text is rendered mid-plan through
      // the flow-data resolver, so a context placeholder there loads clean and
      // then fails at the step that consumes it, after earlier steps committed.
      if (placeholder.kind === "context" && renderedByPlan) {
        sink(
          configError(
            "unknown-reference",
            path,
            `placeholder {context:${placeholder.token}} reads the context plane, which the evaluator assembles (prompt 16); command text is rendered mid-plan against flow data, so it may reference only {slot:…} until then`,
          ),
        );
      }
    }
  }
};

/**
 * The generic renderer's form must be able to collect everything the intent
 * requires from a human: a required trigger-supplied slot with no control is a
 * screen that cannot submit, and a select control over a non-enum slot has no
 * options to render.
 */
export const checkForm = (document: DomainConfigDocument, sink: Sink): void => {
  const form = document.presentation.form;
  if (form === undefined) return;
  const intent = document.intents.find((candidate) => candidate.id === form.intent);
  if (intent === undefined) {
    sink(configError("unknown-reference", "presentation.form.intent", `no intent named ${JSON.stringify(form.intent)}`));
    return;
  }
  const slots = new Map(intent.slots.map((slot) => [slot.id, slot]));
  for (const field of form.fields) {
    const slot = slots.get(field.slot);
    const path = `presentation.form.fields.${field.slot}`;
    if (slot === undefined) {
      sink(configError("unknown-reference", path, `intent ${intent.id} has no slot named ${JSON.stringify(field.slot)}`));
      continue;
    }
    // A control can only COLLECT a value the requester supplies. A
    // `bound-by-primitive` or `derived` slot carries no transport field (the
    // intent schema forbids one), so the projector refuses it at request time -
    // which would ship a document that loads clean, passes every fence, and then
    // renders the "configuration could not be loaded" state on the live screen.
    if (slot.resolution !== "supplied-by-trigger") {
      sink(
        configError(
          "incomplete",
          path,
          `slot ${JSON.stringify(field.slot)} resolves ${slot.resolution}, so it has no transport field a form control could collect`,
        ),
      );
      continue;
    }
    if (field.input === "select" && slot.type !== "enum") {
      sink(configError("type-mismatch", path, "a select control needs an enum slot to draw its options from"));
    }
    if (field.defaultValue !== undefined && slot.type === "enum" && !slot.values?.includes(field.defaultValue)) {
      sink(configError("type-mismatch", path, `default ${JSON.stringify(field.defaultValue)} is not one of the slot's values`));
    }
  }
  const rendered = new Set(form.fields.map((field) => field.slot));
  for (const slot of intent.slots) {
    if (slot.required && slot.resolution === "supplied-by-trigger" && !rendered.has(slot.id)) {
      sink(
        configError(
          "incomplete",
          `presentation.form.fields.${slot.id}`,
          "a required trigger-supplied slot has no form control, so the screen can never submit",
        ),
      );
    }
  }
};
