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
 * blank for a value the form just required.
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
    const value = submitted[field.field];
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

/**
 * Read one admitted value a caller REQUIRES. `admitIntakeSubmission` keys its
 * result by the configured trigger fields, so an absent key means the document
 * no longer declares that field at all - a typed refusal, never an empty string
 * standing in for a value the boundary just declared required.
 */
export const requiredIntakeValue = (
  admitted: Readonly<Record<string, string | null>>,
  field: string,
): Result<string, AppError> => {
  const value = admitted[field];
  return typeof value === "string" && value !== ""
    ? ok(value)
    : err(appError("VALIDATION", `This domain declares no required "${field}" intake field.`));
};

/** The same read for a value the configuration declares OPTIONAL: absent is `null`, undeclared is a refusal. */
export const optionalIntakeValue = (
  admitted: Readonly<Record<string, string | null>>,
  field: string,
): Result<string | null, AppError> =>
  field in admitted
    ? ok(admitted[field] ?? null)
    : err(appError("VALIDATION", `This domain declares no "${field}" intake field.`));
