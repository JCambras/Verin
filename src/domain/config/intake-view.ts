/**
 * THE INTAKE VIEW TYPES (v3 prompt 10; ADR-0056) - a LEAF module by design.
 *
 * These two types are what a screen renders. They live apart from the projector
 * (`intake.ts`) so a client component can import the shape without pulling the
 * configuration document's inferred type graph into the app layer, which is what
 * kept a full-repository semantic analysis inside its heap (D-193).
 */
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
