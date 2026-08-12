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
 * blank for a value the form just required. That refusal is a CONFIGURATION
 * refusal, minted through the injected port every other one goes through (D-231)
 * rather than spelled here: a caller asking for a field no document declares is a
 * DEPLOYMENT defect, so it owes the same generic sentence plus correlation
 * reference on the wire and the same registered diagnosis on the operator's line.
 * Only a value the document DOES declare, and that the submission left absent, is
 * the ordinary VALIDATION a user can act on - and it carries the same declared
 * label the form's own required check uses.
 *
 * Declaration is read from the form, and presence - in the submitted payload as
 * well as in the admitted map - with `Object.hasOwn`, never `in` and never a
 * bare index: both are plain object literals, so either would walk
 * `Object.prototype` and hand back `toString` for a document that declared a
 * trigger field of that name.
 */
import { appError, type AppError } from "@contracts/errors";
import { err, ok, type Result } from "@contracts/result";
import { configError, type ConfiguredRefusal } from "./errors";

/**
 * The transport key a client mints once per form session so a re-submit replays
 * one execution instead of opening a second household (D-027).
 *
 * It is declared in THIS leaf rather than beside the other reserved flow-data
 * keys in `vocabulary.ts` because the two modules that WRITE it - the intake
 * route and the client journey component - are the ones that must agree with
 * it, and a client bundle may not pull the schema module's zod graph to learn
 * one string. `RESERVED_TRIGGER_FIELDS` imports it from here, so the name the
 * platform writes and the name the loader refuses a slot for stay ONE
 * declaration.
 */
export const CLIENT_REQUEST_ID_KEY = "clientRequestId";

export type IntakeField = {
  /**
   * The SLOT this field projects, carried because it is the id the DOCUMENT keys
   * the form's field list by. The projection is keyed by `field` (the transport
   * name a submission carries), so without this a fault about one of these fields
   * could only name the transport token - and `presentation.form.fields.<trigger
   * field>` addresses no node in the document at all.
   */
  readonly slot: string;
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

/**
 * Which declared station the journey stands on in each of its live phases, by
 * station ID. The document names both, so a renderer never transcribes a station
 * id: renaming or reordering `presentation.surfaces` moves the rail from the
 * document, and a station the document stopped declaring is a LOAD refusal
 * rather than a rail with nothing lit on it.
 */
export type IntakeStations = {
  readonly form: string;
  /** `null` for a domain whose plan never suspends on an external observation. */
  readonly awaiting: string | null;
};

export type IntakeForm = {
  readonly title: string;
  readonly regulation: string;
  readonly surfaces: readonly IntakeSurface[];
  readonly stations: IntakeStations;
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

/**
 * THE DOCUMENT NODE THAT HOLDS THE FORM'S FIELD LIST - the path a fault about
 * one of them is addressed under.
 *
 * The document keys that list by SLOT (`presentation.form.fields` is a list of
 * `{slot, input}`), which is the addressing convention every other emitter uses
 * for a list of identified entries, and `intakeFormOf` emits exactly this path
 * for the same node. The projection is keyed by TRIGGER FIELD, so naming that
 * token here produced `presentation.form.fields.householdName` - a location the
 * document does not contain, in the channel that exists to be authoritative. A
 * confidently wrong answer is worse than a sealed one: the operator cannot tell
 * it is wrong.
 */
const FORM_FIELDS_PATH = "presentation.form.fields";
const fieldPath = (slot: string): string => `${FORM_FIELDS_PATH}.${slot}`;

/** The slot a projected field came from, or `null` when the document declares no such field. */
const declaredSlot = (form: IntakeForm, field: string): string | null =>
  form.fields.find((declared) => declared.field === field)?.slot ?? null;

/**
 * The FIRST admitted field a caller's FIXED input shape has no room for, as a
 * refusal minted through the shared port - or `null` when every admitted field
 * lands.
 *
 * A boundary that judges the whole configured field list and then reads back a
 * fixed subset would silently drop the rest: the screen renders the new control,
 * the boundary admits its value, and the value vanishes - to be missed at
 * whatever step sources it, by which point earlier steps have committed. The
 * field that caused it reaches the operator as the fault's own path rather than
 * the wire as prose (D-229) - and because every admitted key came from the
 * projected form, that path is always the slot-keyed node the document really has.
 */
export const unmappedIntakeFault = (
  form: IntakeForm,
  admitted: Readonly<Record<string, string | null>>,
  carried: readonly string[],
  refuse: ConfiguredRefusal,
): AppError | null => {
  const known = new Set<string>(carried);
  const unmapped = Object.keys(admitted).filter((field) => !known.has(field)).sort();
  const first = unmapped[0];
  if (first === undefined) return null;
  const slot = declaredSlot(form, first);
  return refuse.intakeMismatch(
    configError(
      "incoherent",
      slot === null ? FORM_FIELDS_PATH : fieldPath(slot),
      "this deployment's fixed start input has no room for a field the document declares",
    ),
  );
};

/** The label the document declares for a trigger field, or `undefined` if it declares none. */
const declaredLabel = (form: IntakeForm, field: string): string | undefined =>
  form.fields.find((declared) => declared.field === field)?.label;

/**
 * A caller named a transport field this document does not declare: a configuration
 * defect, not client input. OPERATOR-RECOVERABLE by cause (D-228) - a rolled-back
 * document restores the trigger field and the next submit works - so the surface
 * inherits "come back" rather than answering a bare server error to a submitter
 * who did nothing wrong and can do nothing about it. The instruction is inherited
 * from the shared mint rather than marked here, which is what keeps this refusal
 * from drifting apart from the eight others that say the same thing.
 *
 * The path is the FIELD LIST rather than an entry in it, because that is the
 * honest location: no entry holds the token the caller named - that is the fault.
 * Naming `presentation.form.fields.<the token>` would send an operator to a node
 * the document does not have.
 */
const undeclared = (refuse: ConfiguredRefusal): AppError =>
  refuse.intakeMismatch(
    configError("unknown-reference", FORM_FIELDS_PATH, "this document declares no intake field of that name"),
  );

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
  refuse: ConfiguredRefusal,
): Result<string, AppError> => {
  const label = declaredLabel(form, field);
  if (label === undefined || !Object.hasOwn(admitted, field)) return err(undeclared(refuse));
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
  refuse: ConfiguredRefusal,
): Result<string | null, AppError> => {
  if (declaredLabel(form, field) === undefined || !Object.hasOwn(admitted, field)) {
    return err(undeclared(refuse));
  }
  const value = admitted[field];
  return ok(typeof value === "string" && value !== "" ? value : null);
};
