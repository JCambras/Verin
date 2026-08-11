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
 * Field NAMES are the slots' declared `triggerField`s, so the projection emits
 * exactly the payload the shipped route already validates.
 */
import { err, ok, type Result } from "@contracts/result";
import { configError, type DomainConfigError } from "./errors";
import type { LoadedDomainConfig } from "./load";

export type IntakeField = {
  readonly field: string;
  readonly label: string;
  readonly type: "text" | "email" | "select";
  readonly required: boolean;
  readonly hint?: string;
  readonly options?: readonly string[];
  readonly defaultValue?: string;
};

export type IntakeForm = {
  readonly title: string;
  readonly regulation: string;
  readonly fields: readonly IntakeField[];
};

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
      field: slot.triggerField,
      label,
      type: field.input,
      required: slot.required,
      ...(field.hint === undefined ? {} : { hint: field.hint }),
      ...(slot.values === undefined ? {} : { options: [...slot.values] }),
      ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
    });
  }
  return ok({ title: form.title, regulation: form.regulation, fields });
};
