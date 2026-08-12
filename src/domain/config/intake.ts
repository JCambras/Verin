/**
 * THE CONFIGURED INTAKE FORM (v3 prompt 10; ADR-0056).
 *
 * The generic renderer (charter #10) collects a domain's trigger-supplied slots
 * from a declarative field list. That list used to be a hand-written constant
 * beside the hand-written flow; it is now a projection of the configuration's
 * presentation section, so the screen and the plan cannot disagree about what a
 * domain needs - and deleting the configuration leaves the screen with nothing
 * to render, which is the point.
 *
 * Field NAMES are the slots' declared `triggerField`s, and each field carries the
 * slot's declared admission rule, so the projection emits exactly the payload
 * the shipped route validates AND the limits it validates against. The stations
 * come from `presentation.surfaces` in declared order, so the journey's progress
 * rail cannot disagree with the document either.
 *
 * The projected TYPES live in `./intake-view`, the leaf module a screen and a
 * route handler import without reaching this module's document graph (D-193).
 */
import { err, ok, type Result } from "@contracts/result";
import { configError, type DomainConfigError } from "./errors";
import type { IntakeField, IntakeForm } from "./intake-view";
import type { LoadedDomainConfig } from "./load";

export const intakeFormOf = (
  config: LoadedDomainConfig,
): Result<IntakeForm, readonly DomainConfigError[]> => {
  const form = config.document.presentation.form;
  if (form === undefined) {
    return err([configError("incomplete", "presentation.form", "this domain declares no intake form")]);
  }
  const intent = config.intents.get(form.intent);
  if (intent === undefined) {
    return err([configError("unknown-reference", "presentation.form.intent", "no such intent")]);
  }
  const copy = config.document.presentation.copy.slots;
  const fields: IntakeField[] = [];
  for (const field of form.fields) {
    const slot = intent.slots.get(field.slot);
    const label = copy[field.slot]?.label;
    if (slot === undefined || slot.triggerField === undefined || label === undefined) {
      return err([
        configError(
          "incoherent",
          `presentation.form.fields.${field.slot}`,
          "a form field must name a labelled, trigger-supplied slot",
        ),
      ]);
    }
    fields.push({
      slot: field.slot,
      field: slot.triggerField,
      label,
      type: field.input,
      required: slot.required,
      ...(field.hint === undefined ? {} : { hint: field.hint }),
      ...(slot.maxLength === undefined ? {} : { maxLength: slot.maxLength }),
      ...(slot.values === undefined ? {} : { options: [...slot.values] }),
      ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
    });
  }
  const surfaces = [...config.document.presentation.surfaces]
    .sort((left, right) => left.order - right.order)
    .map((surface) => ({ id: surface.id as string, label: surface.label }));
  // The stations the journey stands on are the document's own, so the screen
  // holds no station id of its own to fall out of date. The presentation schema
  // has already refused a form naming a station this document does not declare.
  const stations = {
    form: form.surface as string,
    awaiting: form.awaitingSurface === undefined ? null : (form.awaitingSurface as string),
  };
  return ok({ title: form.title, regulation: form.regulation, surfaces, stations, fields });
};
