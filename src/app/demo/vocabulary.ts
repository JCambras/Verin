/**
 * THE DEMO'S DOMAIN VOCABULARY, READ FROM CONFIGURATION (v3 prompt 10;
 * ADR-0057).
 *
 * The walking skeleton used to carry money-movement's slot labels and evidence
 * row labels as literals inside its builders. They now come from the published
 * money-movement configuration, BOUND for the branch's firm - so the words a
 * reviewer reads on the demo are the words the engine is configured with, and
 * that configuration is a load-bearing artifact rather than a document nothing
 * reads.
 *
 * This module supplies LABELS ONLY. It does not move eligibility, disposition,
 * or lifecycle rules into the demo: those stay contract data (data.ts, fenced
 * EQUAL to config/demo/scenarios.yaml).
 *
 * The firm REGISTRY below is a labeled demo fake, exactly like the rest of this
 * module (charter #5 extension, ADR-0027): it maps the configuration's
 * firm-neutral CLASSES to identifiers a demo firm would supply. Binding it is
 * what proves the tenancy seam works - one document binds for both firms, and
 * the bound results differ only by firmId.
 *
 * It is DERIVED from the document, never transcribed from it. A hand-written
 * registry falls behind an ordinary configuration edit - a new capability class,
 * approval template, required role or `role:` evidence supplier - and binding
 * then refuses at REQUEST time, on the one surface that must never render
 * invented labels. Deriving the classes makes that drift unrepresentable rather
 * than merely detected.
 *
 * RESOLUTION IS A VALUE, NEVER A THROW (D-251). This module used to throw when
 * the configuration could not be resolved or bound, on a path the demo station
 * page renders on the SERVER: deleting the published document broke the journey
 * with a stack trace, when the whole point of prompt 10 is that it breaks the
 * journey HONESTLY. Every failure is now a typed refusal the page renders - the
 * generic sentence and quotable reference the shared mint attaches, never a
 * document path, file name or hash (D-227/D-230/D-231/D-243).
 */
import { appError, type AppError } from "@contracts/errors";
import { err, ok, type Result } from "@contracts/result";
import type { FirmRegistry, RequiredFirmClasses } from "@domain/config/bind";
import { configError } from "@domain/config/errors";
import type { DomainLabels } from "@domain/config/labels";
import {
  configuredRefusal,
  loadDomainLabels,
  loadFirmClasses,
} from "@infra/config/domain-config-source";
import { FIRMS } from "./data";

const MONEY_MOVEMENT = "money-movement";

/** One demo firm's own identifier for a class the document names. */
const supplied = (firmId: string, classes: readonly string[]): ReadonlyMap<string, string> =>
  new Map(classes.map((className) => [className, `${firmId}-${className}`]));

/** Every class money-movement declares, mapped to the ids a demo firm supplies. */
const demoFirmRegistry = (firmId: string, classes: RequiredFirmClasses): FirmRegistry => ({
  firmId,
  executionTargets: supplied(firmId, classes.executionTargets),
  evidenceSources: supplied(firmId, classes.evidenceSources),
  approvalTemplates: supplied(firmId, classes.approvalTemplates),
  // A role CLASS is already the demo firm's role name: the seeded workspace and
  // the scenario data speak the same role vocabulary the document requires.
  roles: new Map(classes.roles.map((roleClass) => [roleClass, roleClass])),
});

/**
 * EXACTLY the configured ids this journey renders, declared once so the lookups
 * below are TOTAL: a label is resolved when the vocabulary is, never at the
 * moment a builder needs one. The domain-configuration fence (RULE F) binds these
 * same ids to the published document at BUILD time, resolving each reader's call
 * by symbol, so a renamed slot fails the build rather than a presentation.
 */
const DEMO_SLOT_IDS = ["amount", "deadline", "destination", "household", "purpose"] as const;
const DEMO_EVIDENCE_IDS = [
  "account-balance",
  "bank-instruction",
  "household-instruction",
  "pending-actions",
  "planned-withdrawals",
] as const;
const DEMO_INTENT_IDS = ["distribute-cash"] as const;

export type DemoSlotId = (typeof DEMO_SLOT_IDS)[number];
export type DemoEvidenceId = (typeof DEMO_EVIDENCE_IDS)[number];
export type DemoIntentId = (typeof DEMO_INTENT_IDS)[number];

export type DemoVocabulary = {
  readonly slots: Readonly<Record<DemoSlotId, string>>;
  readonly evidenceKinds: Readonly<Record<DemoEvidenceId, string>>;
  readonly intents: Readonly<Record<DemoIntentId, string>>;
};

/**
 * The copy section each vocabulary is declared in, so a missing label is reported
 * at the node the operator must look at rather than as prose.
 */
const resolveSection = <Id extends string>(
  ids: readonly Id[],
  declared: Readonly<Record<string, string>>,
  section: string,
  missing: string[],
): Readonly<Record<Id, string>> => {
  const out = {} as Record<Id, string>;
  for (const id of ids) {
    const label = declared[id];
    if (label === undefined) missing.push(`presentation.copy.${section}.${id}`);
    else out[id] = label;
  }
  return out;
};

const vocabularyOf = (labels: DomainLabels, missing: string[]): DemoVocabulary => ({
  slots: resolveSection(DEMO_SLOT_IDS, labels.slots, "slots", missing),
  evidenceKinds: resolveSection(DEMO_EVIDENCE_IDS, labels.evidenceKinds, "evidenceKinds", missing),
  intents: resolveSection(DEMO_INTENT_IDS, labels.intents, "intents", missing),
});

const cache = new Map<string, DemoVocabulary>();

/**
 * The configured vocabulary for one demo firm, or the refusal that says why this
 * deployment cannot supply it.
 *
 * A silent fallback is exactly the dead-configuration failure this prompt exists
 * to prevent, so there is none: the demo renders configured words or it renders
 * the refusal. The reachable causes - an absent or drifted document, a firm the
 * registry cannot bind, a document that no longer declares a label this journey
 * shows - are all resolved HERE, once, so the builders below are total and the
 * page has a single place to answer.
 */
export function demoVocabulary(firmId: string): Result<DemoVocabulary, AppError> {
  const cached = cache.get(firmId);
  if (cached !== undefined) return ok(cached);
  if (!Object.hasOwn(FIRMS, firmId)) {
    // NOT a configuration refusal: the published document is fine, this branch
    // is not one the demo records. It carries no correlation reference for the
    // same reason - there is no operator diagnosis to join to.
    return err(appError("NOT_FOUND", "This demo does not record that firm."));
  }
  const classes = loadFirmClasses(MONEY_MOVEMENT);
  if (!classes.ok) return err(classes.error);
  const labels = loadDomainLabels(MONEY_MOVEMENT, demoFirmRegistry(firmId, classes.value));
  if (!labels.ok) return err(labels.error);
  const missing: string[] = [];
  const resolved = vocabularyOf(labels.value, missing);
  if (missing.length > 0) {
    // STATED as a typed fault and minted by the shared port (D-244/D-245), so
    // this surface carries no second opinion about what a broken document means:
    // the wire gets the one generic sentence plus the reference, and the location
    // goes to the operator's line as a registered path.
    return err(configuredRefusal(MONEY_MOVEMENT).undeclaredCopy(configError(
      "incomplete",
      missing[0]!,
      "the published document declares no copy for a label this journey renders",
    )));
  }
  cache.set(firmId, resolved);
  return ok(resolved);
}

/** The configured label for one intent slot. */
export function slotLabel(vocabulary: DemoVocabulary, slot: DemoSlotId): string {
  return vocabulary.slots[slot];
}

/** The configured label for one evidence kind. */
export function evidenceLabel(vocabulary: DemoVocabulary, evidenceKind: DemoEvidenceId): string {
  return vocabulary.evidenceKinds[evidenceKind];
}

/** The configured label for the domain's action, as the interpreted intent shows it. */
export function actionLabel(vocabulary: DemoVocabulary, actionId: DemoIntentId): string {
  return vocabulary.intents[actionId];
}
