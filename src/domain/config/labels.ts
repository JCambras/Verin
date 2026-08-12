/**
 * THE LABEL PROJECTION (v3 prompt 10; ADR-0058).
 *
 * A surface needs a domain's WORDS, not its document. This module projects a
 * bound configuration onto small, explicitly-typed label maps so a screen can
 * render configured vocabulary without naming - or type-resolving - the whole
 * configuration graph.
 *
 * That boundary is not only tidiness. The schema is ~3,500 lines of composed Zod
 * schemas, and `z.infer` over the assembled document is a very large structural
 * type; the repo's type-resolving fences materialize the types they meet, so
 * carrying `LoadedDomainConfig` into the app layer made a full-repository
 * semantic analysis exhaust its heap. Projecting at the boundary keeps the
 * inferred graph inside the layers that own it (D-222).
 */
import type { BoundDomainConfig } from "./bind";

export type DomainLabels = {
  readonly firmId: string;
  readonly domainLabel: string;
  /** action id -> label. */
  readonly intents: Readonly<Record<string, string>>;
  /** slot id -> label. */
  readonly slots: Readonly<Record<string, string>>;
  /** evidence kind -> label. */
  readonly evidenceKinds: Readonly<Record<string, string>>;
};

export const domainLabelsOf = (bound: BoundDomainConfig): DomainLabels => {
  const presentation = bound.config.document.presentation;
  return {
    firmId: bound.firmId,
    domainLabel: presentation.domainLabel,
    intents: Object.fromEntries(
      Object.entries(presentation.copy.intents).map(([id, copy]) => [id, copy.label]),
    ),
    slots: Object.fromEntries(
      Object.entries(presentation.copy.slots).map(([id, copy]) => [id, copy.label]),
    ),
    evidenceKinds: Object.fromEntries(
      Object.entries(presentation.copy.evidenceKinds).map(([id, copy]) => [id, copy.label]),
    ),
  };
};
