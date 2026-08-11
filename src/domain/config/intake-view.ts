/**
 * THE INTAKE VIEW (v3 prompt 10; ADR-0056) - a LEAF module by design.
 *
 * These types are what a screen renders AND what the domain's own request
 * boundary admits; `admitIntakeSubmission` is the total function that judges one
 * submission against them. They live apart from the projector (`intake.ts`) so a
 * client component and a route handler can import the shape - and the check -
 * without pulling the configuration document's inferred type graph into the app
 * layer, which is what kept a full-repository semantic analysis inside its heap
 * (D-193).
 *
 * The check reads the SAME projected field list the form renders, so a text
 * slot's declared `maxLength` and an enum slot's declared `values` are enforced
 * at the boundary that declares them: adding a registration to the configuration
 * can never render an option the API then refuses with a 400.
 *
 * The admitted values are read back through `requiredIntakeValue` /
 * `optionalIntakeValue` rather than indexed with a default, so a caller naming a
 * transport field the document no longer declares is refused instead of handed a
 * blank for a value the form just required. That refusal is an INTERNAL: a
 * caller asking for a field no document declares is a DEPLOYMENT defect, and
 * reporting it as a client VALIDATION would bury a broken configuration in
 * client-error noise. Only a value the document DOES declare, and that the
 * submission left absent, is the ordinary VALIDATION a user can act on - and it
 * carries the same declared label the form's own required check uses.
 *
 * Declaration is read from the form, and presence - in the submitted payload as
 * well as in the admitted map - with `Object.hasOwn`, never `in` and never a
 * bare index: both are plain object literals, so either would walk
 * `Object.prototype` and hand back `toString` for a document that declared a
 * trigger field of that name.
 */
import { appError, type AppError } from "@contracts/errors";
import { err, ok, type Result } from "@contracts/result";

export type IntakeField = {
  readonly field: string;
  readonly label: string;
  readonly type: "text" | "email" | "select";
  readonly required: boolean;
  readonly hint?: string;
  readonly maxLength?: number;
  readonly options?: readonly string[];
  readonly defaultValue?: string;
};

/** One journey station the domain presents, in its declared order. */
export type IntakeSurface = {
  readonly id: string;
  readonly label: string;
};

export type IntakeForm = {
  readonly title: string;
  readonly regulation: string;
  readonly surfaces: readonly IntakeSurface[];
  readonly fields: readonly IntakeField[];
};

/** Nothing was supplied: an absent optional field, never a blank required one. */
const isAbsent = (value: unknown): boolean => value === undefined || value === null || value === "";

/**
 * Judge one submitted payload against the configured field list. Returns the
 * admitted values keyed by trigger field (an absent optional field as `null`),
 * or the first violation as a typed VALIDATION error.
 */
export const admitIntakeSubmission = (
  form: IntakeForm,
  submitted: Readonly<Record<string, unknown>>,
): Result<Readonly<Record<string, string | null>>, AppError> => {
  const admitted: Record<string, string | null> = {};
  for (const field of form.fields) {
    const value = Object.hasOwn(submitted, field.field) ? submitted[field.field] : undefined;
    if (isAbsent(value)) {
      if (field.required) return err(appError("VALIDATION", `${field.label} is required.`));
      admitted[field.field] = null;
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") {
      return err(appError("VALIDATION", `${field.label} must be supplied as text.`));
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      return err(appError("VALIDATION", `${field.label} must be at most ${field.maxLength} characters.`));
    }
    if (field.options !== undefined && !field.options.includes(value)) {
      return err(appError("VALIDATION", `${field.label} must be one of: ${field.options.join(", ")}.`));
    }
    admitted[field.field] = value;
  }
  return ok(admitted);
};

/** The label the document declares for a trigger field, or `undefined` if it declares none. */
const declaredLabel = (form: IntakeForm, field: string): string | undefined =>
  form.fields.find((declared) => declared.field === field)?.label;

/** A caller named a transport field this document does not declare: a configuration defect, not client input. */
const undeclared = (field: string): AppError =>
  appError("INTERNAL", `This domain declares no "${field}" intake field.`);

/**
 * Read one admitted value a caller REQUIRES. An undeclared field is an INTERNAL
 * refusal; a DECLARED field the submission left absent is the ordinary
 * required-field VALIDATION, worded exactly as `admitIntakeSubmission` words it,
 * so flipping a slot to `required: false` turns an omission into the friendly
 * 400 the user already gets rather than a misleading configuration message.
 */
export const requiredIntakeValue = (
  form: IntakeForm,
  admitted: Readonly<Record<string, string | null>>,
  field: string,
): Result<string, AppError> => {
  const label = declaredLabel(form, field);
  if (label === undefined || !Object.hasOwn(admitted, field)) return err(undeclared(field));
  const value = admitted[field];
  return typeof value === "string" && value !== ""
    ? ok(value)
    : err(appError("VALIDATION", `${label} is required.`));
};

/** The same read for a value the configuration declares OPTIONAL: absent is `null`, undeclared is a refusal. */
export const optionalIntakeValue = (
  form: IntakeForm,
  admitted: Readonly<Record<string, string | null>>,
  field: string,
): Result<string | null, AppError> => {
  if (declaredLabel(form, field) === undefined || !Object.hasOwn(admitted, field)) {
    return err(undeclared(field));
  }
  const value = admitted[field];
  return ok(typeof value === "string" && value !== "" ? value : null);
};
