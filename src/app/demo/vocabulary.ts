/**
 * THE DEMO'S DOMAIN VOCABULARY, READ FROM CONFIGURATION (v3 prompt 10;
 * ADR-0056).
 *
 * The walking skeleton used to carry money-movement's slot labels and evidence
 * row labels as literals inside its builders. They now come from
 * `config/domains/money-movement.yaml`, BOUND for the branch's firm - so the
 * words a reviewer reads on the demo are the words the engine is configured
 * with, and the money-movement configuration is a load-bearing artifact rather
 * than a document nothing reads.
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
 */
import type { FirmRegistry } from "@domain/config/bind";
import type { DomainLabels } from "@domain/config/labels";
import { loadDomainLabels } from "@infra/config/domain-config-source";
import { FIRMS } from "./data";

const MONEY_MOVEMENT = "money-movement";

/** The classes money-movement declares, mapped to the ids a demo firm supplies. */
const demoFirmRegistry = (firmId: string): FirmRegistry => ({
  firmId,
  executionTargets: new Map([["custodian-transfer", `${firmId}-custodian`]]),
  evidenceSources: new Map([["house-crm", `${firmId}-house-crm`]]),
  approvalTemplates: new Map([
    ["ops-dual-approval", `${firmId}-ops-dual-approval`],
    ["bank-change-specialist", `${firmId}-bank-change-specialist`],
    ["elevated-approval", `${firmId}-elevated-approval`],
  ]),
  roles: new Map([
    ["operations", "operations"],
    ["advisor", "advisor"],
    ["bank-change-specialist", "bank-change-specialist"],
  ]),
});

const labels = new Map<string, DomainLabels>();

/**
 * The configured vocabulary for one demo firm. Throws when the configuration is
 * absent or cannot bind: the demo must not render invented labels, and a silent
 * fallback is exactly the dead-configuration failure this prompt exists to
 * prevent. (The no-bare-throw fence governs domain and infrastructure, not the
 * app layer.)
 *
 * The reachable cause - a label id the document no longer declares - is caught
 * at BUILD time by the domain-configuration fence, which binds every id
 * `build-context.ts` asks for to `config/domains/money-movement.yaml`. What is
 * NOT covered is the rendered failure state for a throw that escapes anyway:
 * there is no `error.tsx` under `src/app`, so today it renders Next's default
 * error page. Systematic route error boundaries with recovery are owned by the
 * FRONT-END LANE (verin-frontend-parity-plan, prompt 16), not by this prompt.
 */
function vocabularyFor(firmId: string): DomainLabels {
  const cached = labels.get(firmId);
  if (cached !== undefined) return cached;
  if (!Object.hasOwn(FIRMS, firmId)) {
    throw new Error(`The demo has no firm registry for "${firmId}".`);
  }
  const result = loadDomainLabels(MONEY_MOVEMENT, demoFirmRegistry(firmId));
  if (!result.ok) throw new Error(result.error.message);
  labels.set(firmId, result.value);
  return result.value;
}

const requireLabel = (value: string | undefined, what: string, id: string): string => {
  if (value === undefined) {
    throw new Error(`The money-movement configuration declares no label for ${what} "${id}".`);
  }
  return value;
};

/** The configured label for one intent slot. */
export function slotLabel(firmId: string, slot: string): string {
  return requireLabel(vocabularyFor(firmId).slots[slot], "slot", slot);
}

/** The configured label for one evidence kind. */
export function evidenceLabel(firmId: string, evidenceKind: string): string {
  return requireLabel(vocabularyFor(firmId).evidenceKinds[evidenceKind], "evidence kind", evidenceKind);
}

/** The configured label for the domain's action, as the interpreted intent shows it. */
export function actionLabel(firmId: string, actionId: string): string {
  return requireLabel(vocabularyFor(firmId).intents[actionId], "intent", actionId);
}
