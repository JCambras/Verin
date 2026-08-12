import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { Node, Project, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import { CLIENT_RETRY } from "@contracts/client-retry";
import {
  REPO_ROOT,
  callResolvesToDeclaration,
  inMemoryProject,
  moduleReferences,
  normalizedPath,
  realProject,
  stripComments,
} from "./_fence-utils";
import { canonicalConfigJson, type DomainConfigDocument } from "@domain/config/document";
import { loadDomainConfig } from "@domain/config/load";
import {
  bindDomainConfig,
  requiredFirmClasses,
  type FirmRegistry,
  type RequiredFirmClasses,
} from "@domain/config/bind";
import { ACCOUNT_TYPES } from "@domain/schema/entities";
import { inertnessProblems } from "@infra/config/domain-config-source";

/**
 * DOMAIN-CONFIGURATION FENCE (v3 prompt 10, ADR-0056; the PINNED activation
 * mechanism of v3 invariant 3 - "no core module, directory, or evaluator branch
 * is named for a decision domain").
 *
 * Machine-enforced rules. The first is the invariant; the rest are what stop it
 * being flipped on a document nobody reads, or on refusals nobody can act on:
 *
 *  RULE A - NO DOMAIN NAME IN DECISION-CORE. The forbidden vocabulary is DERIVED
 *    from `config/domains/*.yaml`'s own `domainConfigId` values (plus their word
 *    variants), so adding a third domain cannot leave the fence stale. Scope is
 *    the decision-core modules, per the captain's `invariant-3-scope` ruling
 *    (2026-07-28): shipped house-CRM record vocabulary, table names, audit
 *    codes, public routes and established observability names stay, on a small
 *    enumerated allow-list justified in ADR-0056. An anti-vacuity companion
 *    proves an EMPTIED vocabulary fails rather than silently passing.
 *
 *  RULE B - BOTH DOCUMENTS LOAD AND BIND THROUGH THE SHARED ENGINE. File
 *    existence proves nothing (the invariant registry says so in as many words),
 *    so this runs the REAL loader and the REAL binder over the shipped bytes,
 *    for two firms, and proves the binding differs only by firmId.
 *
 *  RULE C - THE DOCUMENTS ARE INERT AND FIRM-NEUTRAL. Tags, anchors, aliases and
 *    merge keys are the four ways YAML stops being data; a `firmId` anywhere in
 *    the graph would make invariant 26 unprovable. The judge is the SHIPPED
 *    guard (`inertnessProblems`, imported from the config source adapter), never
 *    a copy of it: a copy would keep passing after `merge: false` flipped or the
 *    walk was deleted in the reader that actually runs.
 *
 *  RULE D - A PUBLISHED VERSION IS IMMUTABLE. The SHA-256 over each document's
 *    canonical bytes must equal the hash `config/domains/versions.json` pins, so
 *    editing a published document without bumping its version fails the build
 *    (the arch-version doc-pin mechanism, applied to configuration).
 *
 *  RULE E - ONLY THE CONFIG SOURCE ADAPTER READS `config/domains/`. v3 §16: no
 *    module imports from `config/`. The single-allowed-module idiom, exactly as
 *    `no-process-env` uses it for the environment. Access is recognised by the
 *    path literal OR by a RESOLVED reference to a binding holding it, so a
 *    module that imports the directory constant - under any alias, with the path
 *    appearing nowhere in its own text - is caught rather than read green.
 *
 *  RULE F - EVERY VOCABULARY ID THE DEMO ASKS FOR IS DECLARED BY THE DOCUMENT.
 *    The walking skeleton reads its slot, evidence-kind and action labels from
 *    `money-movement.yaml` through `src/app/demo/vocabulary.ts`, which THROWS on
 *    an id the document does not declare. Left unfenced, renaming a slot in the
 *    configuration would 500 the investor-demo journey at run time; the ids are
 *    resolved by SYMBOL from every call site, so an aliased import cannot evade
 *    the check and a non-literal id fails closed rather than passing unproven.
 *
 *  RULE G - A CONFIGURED ENUM VOCABULARY EQUALS THE STORE VOCABULARY IT FEEDS.
 *    `registration-type`'s declared `values` and `ACCOUNT_TYPES` (the union the
 *    house-CRM's typed column accepts) are TWO copies of one vocabulary, and CD-1
 *    keeps the shipped one unrenamed - so the two must be proven EQUAL rather
 *    than merely both present. Unbound, a registration added to the document
 *    would render a select option the request boundary admits (its admission
 *    rules are the document's own) and the execution adapter then refuses at the
 *    THIRD step, after the household and contact writes have committed. Both
 *    directions are checked, and a document where no single enum slot supplies
 *    the shipped transport field fails closed.
 *
 *  RULE H - THE FIRM-CLASS CHECKLIST A SURFACE BINDS THROUGH IS COMPLETE. The
 *    demo builds its firm registry from `requiredFirmClasses`, so a class the
 *    derivation MISSED would be a binding refusal at request time on a screen
 *    that cannot recover from one. Proven the only way that means anything: a
 *    registry built from nothing but the derivation must BIND each shipped
 *    document, and the companion proves dropping any one derived entry fails.
 *
 *  RULE I - A CONFIGURATION REFUSAL IS MINTED WITH ITS CAUSE MARKED. Every
 *    refusal meaning "this deployment cannot resolve or compile its published
 *    configuration" is operator-recoverable, so it carries `operatorRecoverable`
 *    at the mint (D-228). Unmarked, it reads green everywhere and then tells an
 *    advisor to stop trying about a document an operator rollback repairs. The
 *    candidates are DERIVED from the configuration MODULES - every mint in one is
 *    a candidate, exempted only by its own `VALIDATION` code - because listing
 *    functions let a mint in an unlisted function of a LISTED FILE ship unmarked.
 *    The derivation is COMPLETE rather than merely broad: marking a refusal means
 *    importing the marker, and no module outside those roots may, so there is no
 *    residue to register and nothing to go stale.
 *
 *  RULE J - NO SURFACE STATES AN INSTRUCTION IT COULD READ FROM THE CAUSE.
 *    Assigning a `ClientRetry` per call site is what produced the inconsistency
 *    RULE I closes - the version guard said "come back", the start path said
 *    "resubmitting will not help", and the resume path said nothing, for one
 *    broken document. Every decision goes through `clientRetryFor(error, …)`, and
 *    the deciding files are DERIVED (a file that reads the closed vocabulary, or
 *    writes one of its arms into a `retry` position) rather than listed - a
 *    hand-listed surface set is the same per-site bookkeeping moved into the fence.
 *
 *  RULE K - NO DEPLOYMENT INTERNAL REACHES A USER-FACING SURFACE OR THE WIRE
 *    (D-230). The screen that told an advisor to restore a YAML path survived
 *    D-227 only because it was a STATIC LITERAL rather than a generated message,
 *    so the rule is stated about copy generally - AND about every `AppError`
 *    message, wherever minted, since `toResponse` returns those verbatim to a
 *    browser and to the external e-sign provider. The condition is the whole class
 *    (repository paths, bare file names, environment variable names, digests, and
 *    a message BUILT from a loader fault at run time), not one pattern that
 *    happens to catch some of them. A module specifier is resolution, not copy.
 *

 * NAMED DEFERRALS. `policyRegistriesFor` derives prompt 9's four pinned
 * registries from a loaded configuration and has no SHIPPED caller yet: nothing
 * authors a firm policy until the policy lifecycle lands (prompt 20). It is
 * listed below rather than left silent, because knip cannot see the difference
 * between "waiting for its prompt" and "dead".
 */
const CONFIG_DIRECTORY = "config/domains";
const DOMAIN_FILES = readdirSync(join(REPO_ROOT, CONFIG_DIRECTORY))
  .filter((name) => name.endsWith(".yaml"))
  .sort();

const NAMED_DEFERRALS: Readonly<Record<string, string>> = {
  "src/domain/config/registries.ts :: policyRegistriesFor":
    "prompt 20 - the policy lifecycle is what first loads a firm policy against these derived registries",
};

/**
 * The decision-core scope the captain ruled (`invariant-3-scope`). Everything
 * here is platform substrate: a decision domain may be its DATA, never its
 * module, directory, identifier, or branch.
 */
const DECISION_CORE_ROOTS = [
  "src/contracts/decision-core/",
  "src/contracts/primitives/",
  "src/domain/config/",
  "src/domain/policy/",
] as const;

/**
 * The SMALL, ENUMERATED allow-list the ruling requires, every entry justified in
 * ADR-0056. These are shipped, externally-visible names the ruling explicitly
 * refuses to rename: a public route, a persisted table, audit action codes, and
 * established span names. Growth here is an ADR amendment, and the companion
 * below proves an entry that suppresses nothing fails.
 */
const REVIEWED_DOMAIN_NAME_USES: ReadonlyArray<{ file: string; token: string; why: string }> = [
  {
    file: "src/contracts/primitives/quantity.ts",
    token:
      "A real reserve or commitment rule needing non-sum aggregation (largest monthly gap, inflation-adjusted projection) or irregular schedules the forward horizon-sum cannot express. Hard kill criterion from the captain's OQ-4 ruling: if no second domain (trading cash-needs, life-event required-distribution projection) has bound this primitive by the trading wave, it was a money-movement one-off.",
    why: "prompt 8's FALSIFICATION CRITERION for horizon-projection: the sentence that says this primitive is WRONG if only one domain ever binds it. Naming that domain is the whole content of the criterion - deleting the name would delete the test. It is prose in a data field, never a branch, never a module name (ADR-0056, invariant-3-scope ruling)",
  },
];

type NameUse = {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  readonly detail: string;
};

/** The domains this repository actually publishes, and the word forms of each. */
export function domainVocabulary(files: readonly string[] = DOMAIN_FILES): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const id = file.replace(/\.yaml$/, "");
    out.add(id);
    out.add(id.split("-").join(""));
    out.add(id.split("-").map((part, index) => (index === 0 ? part : part[0]!.toUpperCase() + part.slice(1))).join(""));
    out.add(id.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(""));
    out.add(id.split("_").join(""));
  }
  return [...out].filter((word) => word.length > 3).sort();
}

/**
 * Every place a decision-core file NAMES a domain: its path, an identifier it
 * declares, or a string literal it contains. Pure so the companion can feed it
 * synthetic trees and an emptied vocabulary.
 */
export function domainNameUses(
  project: Project,
  vocabulary: readonly string[],
  roots: readonly string[] = DECISION_CORE_ROOTS,
): NameUse[] {
  const out: NameUse[] = [];
  const matches = (text: string): string | null =>
    vocabulary.find((word) => text.toLowerCase().includes(word.toLowerCase())) ?? null;
  for (const sourceFile of project.getSourceFiles()) {
    const file = normalizedPath(sourceFile.getFilePath());
    if (!roots.some((root) => file.startsWith(root))) continue;
    const inPath = matches(file);
    if (inPath !== null) {
      out.push({ file, line: 1, token: file, detail: `file or directory name contains the domain name "${inPath}"` });
    }
    for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const hit = matches(identifier.getText());
      if (hit === null) continue;
      out.push({
        file,
        line: identifier.getStartLineNumber(),
        token: identifier.getText(),
        detail: `identifier "${identifier.getText()}" contains the domain name "${hit}"`,
      });
    }
    for (const kind of [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral] as const) {
      for (const literal of sourceFile.getDescendantsOfKind(kind)) {
        const hit = matches(literal.getLiteralText());
        if (hit === null) continue;
        out.push({
          file,
          line: literal.getStartLineNumber(),
          token: literal.getLiteralText(),
          detail: `string literal contains the domain name "${hit}"`,
        });
      }
    }
  }
  return out;
}

const documentText = (file: string): string => readFileSync(join(REPO_ROOT, CONFIG_DIRECTORY, file), "utf8");

/** The top-level section ids the published documents declare, longest first. */
function documentSections(files: readonly string[] = DOMAIN_FILES): string[] {
  const sections = new Set<string>();
  for (const file of files) {
    const document = parseDocument(documentText(file), { merge: false }).toJS() as Record<string, unknown>;
    for (const key of Object.keys(document)) if (key.length > 5) sections.add(key);
  }
  return [...sections].sort((left, right) => right.length - left.length || (left < right ? -1 : 1));
}

type VersionPin = { readonly domainConfigId: string; readonly version: string; readonly configHash: string };

/**
 * RULE D's judgement, as a callable so the companion can prove it FAILS CLOSED.
 *
 * This is the only check that binds shipped configuration bytes to the pinned
 * hashes, and it used to `continue` past a document it could not load or
 * canonicalize - passing with an empty drift list while proving nothing about
 * that file. Counting pins does not tie a pin to bytes, so a false proof is
 * exactly what the charter calls worse than no fence. Every document now owes an
 * ANSWER: an unprovable one is drift, naming the file and the reason.
 *
 * `canonicalize` is a parameter only so the companion can exercise the
 * canonicalization branch; every shipped call uses the real one.
 */
export function versionPinDrift(
  documents: readonly { readonly file: string; readonly document: unknown }[],
  pins: readonly VersionPin[],
  canonicalize: (document: DomainConfigDocument) => { readonly ok: boolean; readonly value?: string } =
    canonicalConfigJson,
): string[] {
  const drift: string[] = [];
  for (const { file, document } of documents) {
    const loaded = loadDomainConfig(document);
    if (!loaded.ok) {
      drift.push(`${file} cannot be loaded, so its pinned hash proves nothing: ${JSON.stringify(loaded.error)}`);
      continue;
    }
    const canonical = canonicalize(loaded.value.document);
    if (!canonical.ok || canonical.value === undefined) {
      drift.push(`${file} has no canonical bytes, so its pinned hash proves nothing`);
      continue;
    }
    const hash = createHash("sha256").update(canonical.value, "utf8").digest("hex");
    const pin = pins.find(
      (entry) =>
        entry.domainConfigId === loaded.value.document.domainConfigId &&
        entry.version === loaded.value.document.version,
    );
    if (!pin) drift.push(`${loaded.value.domainConfigVersionId} is not a published version`);
    else if (pin.configHash !== hash) {
      drift.push(`${loaded.value.domainConfigVersionId} changed without a version bump (pinned ${pin.configHash}, computed ${hash})`);
    }
  }
  return drift;
}

const parsed = (file: string): unknown =>
  parseDocument(documentText(file), { merge: false }).toJS() as unknown;

/** A registry supplying every class the shipped documents reference. */
const registryFor = (firmId: string): FirmRegistry => ({
  firmId,
  executionTargets: new Map([
    ["custodian-transfer", `${firmId}-custodian`],
    ["house-crm", `${firmId}-crm`],
    ["esign", `${firmId}-esign`],
  ]),
  evidenceSources: new Map([
    ["house-crm", `${firmId}-crm-source`],
    ["applicant-identity", `${firmId}-identity-source`],
  ]),
  approvalTemplates: new Map([
    ["ops-dual-approval", `${firmId}-ops-dual`],
    ["bank-change-specialist", `${firmId}-bank-specialist`],
    ["elevated-approval", `${firmId}-elevated`],
    ["new-account-review", `${firmId}-new-account-review`],
  ]),
  roles: new Map([
    ["operations", "operations"],
    ["advisor", "advisor"],
    ["bank-change-specialist", "bank-change-specialist"],
  ]),
});

/**
 * A firm registry built from NOTHING but what the document itself declares -
 * the shape every surface uses, so RULE H proves the derivation complete rather
 * than proving one hand-written literal happens to be complete today.
 */
const derivedRegistry = (
  firmId: string,
  classes: RequiredFirmClasses,
  drop?: { readonly registry: keyof RequiredFirmClasses; readonly className: string },
): FirmRegistry => {
  const supplied = (registry: keyof RequiredFirmClasses): ReadonlyMap<string, string> =>
    new Map(
      classes[registry]
        .filter((className) => !(drop?.registry === registry && drop.className === className))
        .map((className) => [className, `${firmId}-${className}`]),
    );
  return {
    firmId,
    executionTargets: supplied("executionTargets"),
    evidenceSources: supplied("evidenceSources"),
    approvalTemplates: supplied("approvalTemplates"),
    roles: supplied("roles"),
  };
};

/** Modules permitted to name the configuration directory (RULE E). */
const CONFIG_READERS = ["src/infrastructure/config/domain-config-source.ts"] as const;

/**
 * A module ACCESSES the configuration directory when it names the path in a
 * filesystem or module-resolution position. Naming it in a message a human
 * reads ("restore config/domains/account-opening.yaml") is not access - it is
 * the opposite, an instruction to the operator - so the rule keys on the verb,
 * not on the mention.
 */
const ACCESS_VERBS = /\b(?:readFileSync|readdirSync|readFile|createReadStream|import|require|join|resolve)\b/;

/**
 * Every line that REFERENCES a binding whose value is the configuration
 * directory, resolved by SYMBOL. The literal is not the only way to name the
 * path: a `const` holding it can be imported - under any local alias - and the
 * directory is then read from a module whose own text never contains it, which
 * is exactly the access a per-line text scan reads green over.
 */
function directoryBindingReferences(project: Project): Map<string, Set<number>> {
  const lines = new Map<string, Set<number>>();
  for (const sourceFile of project.getSourceFiles()) {
    for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const literal = declaration.getInitializer()?.asKind(SyntaxKind.StringLiteral);
      if (literal === undefined || !literal.getLiteralText().includes(CONFIG_DIRECTORY)) continue;
      const name = declaration.getNameNode().asKind(SyntaxKind.Identifier);
      if (name === undefined) continue;
      for (const reference of name.findReferencesAsNodes()) {
        const rel = normalizedPath(reference.getSourceFile().getFilePath());
        const seen = lines.get(rel) ?? new Set<number>();
        seen.add(reference.getStartLineNumber());
        lines.set(rel, seen);
      }
    }
  }
  return lines;
}

export function configDirectoryReaders(project: Project): string[] {
  const referenced = directoryBindingReferences(project);
  const out = new Set<string>();
  for (const sourceFile of project.getSourceFiles()) {
    const rel = normalizedPath(sourceFile.getFilePath());
    if (CONFIG_READERS.includes(rel as (typeof CONFIG_READERS)[number])) continue;
    const resolved = referenced.get(rel) ?? new Set<number>();
    sourceFile.getFullText().split("\n").forEach((line, index) => {
      const code = stripComments(line);
      if (!ACCESS_VERBS.test(code)) return;
      if (code.includes(CONFIG_DIRECTORY) || resolved.has(index + 1)) out.add(`${rel}:${index + 1}`);
    });
  }
  return [...out].sort();
}

/** The module the demo reads its configured vocabulary through (RULE F). */
const DEMO_VOCABULARY_MODULE = "src/app/demo/vocabulary.ts";

/** Each demo label reader, and the configured vocabulary its id must come from. */
const DEMO_LABEL_READERS = [
  ["slotLabel", "slots"],
  ["evidenceLabel", "evidenceKinds"],
  ["actionLabel", "intents"],
] as const;

type LabelVocabulary = (typeof DEMO_LABEL_READERS)[number][1];

type LabelRequest = {
  readonly file: string;
  readonly line: number;
  readonly vocabulary: LabelVocabulary;
  /** `null` when the id is not a literal - unprovable provenance fails closed. */
  readonly id: string | null;
};

/**
 * Every configured label id the shipped tree asks for. Resolved by SYMBOL, so an
 * aliased import or a same-named local helper cannot pose as a reader; pure, so
 * the companion can feed it synthetic trees.
 */
export function demoLabelRequests(
  project: Project,
  module: string = DEMO_VOCABULARY_MODULE,
): LabelRequest[] {
  const out: LabelRequest[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const reader = DEMO_LABEL_READERS.find(([name]) => callResolvesToDeclaration(call, module, name));
      if (reader === undefined) continue;
      const literal = call.getArguments()[1]?.asKind(SyntaxKind.StringLiteral);
      out.push({
        file: normalizedPath(sourceFile.getFilePath()),
        line: call.getStartLineNumber(),
        vocabulary: reader[1],
        id: literal === undefined ? null : literal.getLiteralText(),
      });
    }
  }
  return out;
}

/** The ids each configured copy map declares, as the sets RULE F checks against. */
const declaredVocabulary = (copy: {
  readonly slots: Readonly<Record<string, unknown>>;
  readonly evidenceKinds: Readonly<Record<string, unknown>>;
  readonly intents: Readonly<Record<string, unknown>>;
}): Record<LabelVocabulary, ReadonlySet<string>> => ({
  slots: new Set(Object.keys(copy.slots)),
  evidenceKinds: new Set(Object.keys(copy.evidenceKinds)),
  intents: new Set(Object.keys(copy.intents)),
});

/** The requests the published copy does not answer, as reportable locations. */
export function unboundLabelRequests(
  requests: readonly LabelRequest[],
  declared: Readonly<Record<LabelVocabulary, ReadonlySet<string>>>,
): string[] {
  return requests
    .filter((request) => request.id === null || !declared[request.vocabulary].has(request.id))
    .map((request) => `${request.file}:${request.line} ${request.vocabulary} ${request.id ?? "<not a literal id>"}`);
}

/**
 * The shipped transport field the house-CRM's typed account-type column is
 * written from. CD-1 leaves that shipped vocabulary unrenamed, so the
 * CONFIGURATION binds to it: whichever enum slot supplies this field must declare
 * exactly the values the store accepts (RULE G).
 */
const STORE_VOCABULARY_TRIGGER_FIELD = "accountType";

type SlotDeclaration = {
  readonly id: string;
  readonly triggerField?: string | undefined;
  readonly values?: readonly string[] | undefined;
};

type IntentDeclaration = {
  readonly id: string;
  readonly slots: readonly SlotDeclaration[];
};

/**
 * Where a document's declared enum vocabulary for one transport field and the
 * shipped vocabulary that consumes it disagree - in BOTH directions, since a
 * value only the document declares is a mid-flow refusal after committed writes
 * and a value only the store accepts is unreachable vocabulary. Pure, so the
 * companion can plant either kind of drift.
 */
export function storeVocabularyDrift(
  intents: readonly IntentDeclaration[],
  triggerField: string,
  shipped: readonly string[],
): string[] {
  const suppliers = intents.flatMap((intent) =>
    intent.slots
      .filter((slot) => slot.triggerField === triggerField && slot.values !== undefined)
      .map((slot) => ({ slot: slot.id, values: slot.values ?? [] })),
  );
  if (suppliers.length !== 1) {
    return [
      `exactly one enum slot must supply "${triggerField}"; this document declares ${suppliers.length}`,
    ];
  }
  const supplier = suppliers[0]!;
  return [
    ...supplier.values
      .filter((value) => !shipped.includes(value))
      .map((value) => `${supplier.slot} declares "${value}", which the shipped vocabulary does not accept`),
    ...shipped
      .filter((value) => !supplier.values.includes(value))
      .map((value) => `the shipped vocabulary accepts "${value}", which ${supplier.slot} does not declare`),
  ];
}

/**
 * WHERE A CONFIGURATION REFUSAL CAN BE MINTED (RULE I), DERIVED FROM THE MODULES
 * THAT RESOLVE THE DOCUMENT rather than listed function by function.
 *
 * Everything these roots refuse means "this deployment cannot use the document it
 * publishes", which is operator-recoverable by cause and therefore owes
 * `operatorRecoverable` at the mint (D-228). Listing INCLUSIONS is what let
 * `plan-compiler.ts :: failure` ship unmarked: the old registry keyed on the
 * OWNING FUNCTION's name, so a refusal minted in an unlisted function of a
 * REGISTERED FILE was invisible to a rule whose own docstring claimed a new
 * refusal inherits the classification automatically. A hand-maintained registry
 * drifts and then passes vacuously, which the charter treats as worse than no
 * fence at all.
 */
const CONFIGURATION_MODULE_ROOTS = [
  "src/domain/config/",
  "src/infrastructure/config/",
] as const;

/**
 * The ONE derived exemption, taken from the mint's own error CODE rather than from
 * a list of blessed functions: a `VALIDATION` is by construction a refusal of the
 * SUBMISSION, and marking one operator-recoverable would tell a user to wait for
 * an operator about their own typo. Every other code in these roots is about the
 * document.
 */
const SUBMITTER_REFUSAL_CODE = "VALIDATION";

/**
 * THE MARKER ITSELF, and the module that defines it. A refusal cannot be marked
 * without importing this, which is what turns the root derivation from BROAD into
 * COMPLETE - see `configurationMarkersOutsideModules`.
 */
const CAUSE_MARKER = "operatorRecoverable";
const CLIENT_RETRY_CONTRACT = "src/contracts/client-retry.ts";

const callsNamed = (owner: Node, name: string): CallExpression[] =>
  owner.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => call.getExpression().getText() === name);

/** The code a mint names, or `null` when it is not a literal (which fails closed). */
const mintedCode = (mint: CallExpression): string | null =>
  mint.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ?? null;

const marksCause = (mint: CallExpression): boolean => {
  const parent = mint.getParent();
  return Node.isCallExpression(parent) &&
    parent.getExpression().getText() === "operatorRecoverable" &&
    parent.getArguments()[0] === mint;
};

/**
 * A configuration refusal minted WITHOUT its cause marked - the classification
 * hole this rule closes. An unmarked mint reads green at every gate and then tells
 * an advisor "resubmitting will not help; contact your operations team" about a
 * document an operator rollback repairs.
 *
 * DERIVED over `roots`: every mint in a configuration module is a candidate, so a
 * refusal added in a new function is covered without anyone listing it.
 */
export function unmarkedConfigurationRefusals(
  project: Project,
  roots: readonly string[],
): string[] {
  const out: string[] = [];
  const derived = new Map<string, number>(roots.map((root) => [root, 0]));
  for (const sourceFile of project.getSourceFiles()) {
    const file = normalizedPath(sourceFile.getFilePath());
    const root = roots.find((candidate) => file.startsWith(candidate));
    if (root === undefined || file.includes("/__tests__/")) continue;
    for (const mint of callsNamed(sourceFile, "appError")) {
      if (mintedCode(mint) === SUBMITTER_REFUSAL_CODE) continue;
      derived.set(root, (derived.get(root) ?? 0) + 1);
      if (!marksCause(mint)) {
        out.push(`${file}:${mint.getStartLineNumber()}: a configuration refusal is minted without operatorRecoverable()`);
      }
    }
  }
  // ANTI-VACUITY: a root that refuses nothing is a derivation pointing at nothing.
  for (const [root, mints] of derived) {
    if (mints === 0) out.push(`${root} mints no configuration refusal - the derivation is stale`);
  }
  return out.sort();
}

/**
 * WHAT MAKES THE DERIVATION ABOVE COMPLETE RATHER THAN MERELY BROAD.
 *
 * A refusal cannot be marked without importing the marker, so a module outside the
 * configuration roots that imports it is a configuration refusal minted where the
 * derivation cannot see it - and the alternative, a hand-listed residue of such
 * sites, is the drifting registry this whole rule replaced. Resolved through the
 * IMPORT's own name so an alias cannot evade it. Anti-vacuous by construction: a
 * marker no configuration module imports is reported, since the rule would then be
 * checking a mark nobody applies.
 */
export function configurationMarkersOutsideModules(
  project: Project,
  roots: readonly string[],
): string[] {
  const out: string[] = [];
  let inside = 0;
  for (const sourceFile of project.getSourceFiles()) {
    const file = normalizedPath(sourceFile.getFilePath());
    if (file === CLIENT_RETRY_CONTRACT || file.includes("/__tests__/")) continue;
    const marks = sourceFile.getImportDeclarations()
      .flatMap((declaration) => declaration.getNamedImports())
      .some((named) => named.getName() === CAUSE_MARKER);
    if (!marks) continue;
    if (roots.some((root) => file.startsWith(root))) inside += 1;
    else out.push(`${file} marks a configuration refusal outside the configuration modules, where the derivation cannot see it`);
  }
  if (inside === 0) out.push(`no configuration module imports ${CAUSE_MARKER}() - the rule checks a mark nobody applies`);
  return out.sort();
}

/**
 * THE CLOSED VOCABULARY A CLIENT INSTRUCTION IS DRAWN FROM, read from the contract
 * so the derivation below cannot fall behind a fourth arm.
 */
const CLIENT_RETRY_VALUES: readonly string[] = Object.values(CLIENT_RETRY);

/**
 * Every file that DECIDES what a submitter does next (RULE J), DERIVED: one that
 * imports the closed vocabulary, or that writes one of its arms into a `retry`
 * position without importing anything at all. Three hand-listed surfaces are
 * exactly the bookkeeping RULE J was written to abolish, moved from the source into
 * the fence - a fourth surface added later would decide freely and unseen.
 */
export function retryDecisionFiles(project: Project, roots: readonly string[]): string[] {
  const out: string[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const file = normalizedPath(sourceFile.getFilePath());
    if (!roots.some((root) => file.startsWith(root)) || file.includes("/__tests__/")) continue;
    if (file === CLIENT_RETRY_CONTRACT) continue;
    const text = sourceFile.getFullText();
    const reads = moduleReferences(sourceFile)
      .some((reference) => (reference.specifier ?? "").includes("contracts/client-retry"));
    if (reads || CLIENT_RETRY_VALUES.some((value) => text.includes(`"${value}"`))) out.push(file);
  }
  return out.sort();
}

/** Every `retry` a file DECIDES - a property or a binding, never a forwarded shorthand. */
function retryDecisions(sourceFile: SourceFile): Node[] {
  return [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)
      .filter((property) => property.getName() === "retry")
      .map((property) => property.getInitializerOrThrow()),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .filter((declaration) => declaration.getName() === "retry")
      .flatMap((declaration) => {
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }),
  ];
}

export function statedRetryInstructions(
  project: Project,
  roots: readonly string[],
): { readonly violations: string[]; readonly decisions: number } {
  const violations: string[] = [];
  let decisions = 0;
  for (const file of retryDecisionFiles(project, roots)) {
    const sourceFile = project.getSourceFiles()
      .find((candidate) => normalizedPath(candidate.getFilePath()) === file);
    if (sourceFile === undefined) continue;
    for (const decision of retryDecisions(sourceFile)) {
      decisions += 1;
      const derived = Node.isCallExpression(decision) &&
        decision.getExpression().getText() === "clientRetryFor";
      if (!derived) {
        violations.push(`${file}:${decision.getStartLineNumber()}: a client instruction is STATED here (${decision.getText()}) rather than read from the refusal's cause via clientRetryFor()`);
      }
    }
  }
  return { violations: violations.sort(), decisions };
}

/**
 * DEPLOYMENT INTERNALS IN ANYTHING A USER OR AN EXTERNAL SENDER READS (RULE K).
 *
 * The CONDITION is "no deployment internal reaches a wire boundary", not "no
 * string matches one convenient pattern". The first form of this rule required a
 * DIRECTORY-SHAPED match against a fixed extension list, so "restore
 * account-opening.yaml", a `SESSION_SECRET`, and a SHA-256 digest all passed
 * clean; and it looked only at `src/app/`, while the messages that actually reach
 * a browser and the e-sign provider are minted in `src/domain/` and
 * `src/infrastructure/` and ride out through `toResponse`.
 */
const DEPLOYMENT_INTERNALS: ReadonlyArray<{ readonly what: string; readonly pattern: RegExp }> = [
  { what: "a repository path", pattern: /(?:[\w-]+\/)+[\w.-]+\.[A-Za-z]{1,6}\b/ },
  {
    what: "a deployment file name",
    pattern: /\b[\w-]+\.(?:ya?ml|jsonc?|tsx?|jsx?|mjs|cjs|env|md|sql|sh|bash|conf|ini|toml|lock|pem|crt|key|log)\b/i,
  },
  { what: "an environment variable name", pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/ },
  { what: "a hash or digest value", pattern: /\b[0-9a-f]{32,}\b/i },
  // A DOTTED DOCUMENT PATH, derived from the published documents' OWN top-level
  // section ids so a renamed section cannot leave this stale. Three segments deep
  // is what makes it a path rather than ordinary prose - `execution.capabilities.x`
  // is the shape the plan compiler put on the wire.
  {
    what: "a dotted configuration-document path",
    pattern: new RegExp(
      `\\b(?:${documentSections().join("|")})\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+`,
    ),
  },
];

/**
 * The reviewed escapes, each justified and each proven to SUPPRESS SOMETHING by
 * the companion below - the same shape RULE A's allow-list uses. Inclusions are
 * derived; only exceptions are listed.
 */
const REVIEWED_WIRE_INTERNALS: ReadonlyArray<{ file: string; token: string; why: string }> = [
  {
    file: "src/infrastructure/store/db.ts",
    token: "VERIN_STORE_DRIVER",
    why: "a BOOT diagnostic for the deferred managed-Postgres adapter, raised where the store is constructed and read by an operator running `pnpm audit-chain-verify` - `scripts/error-message.ts` states the convention that such a failure carries one line naming the fix. It reaches no submitter's screen and no external sender, and the env var IS the action, which is the opposite of the unactionable path D-230 closed",
  },
];

/**
 * The MINTS whose `message` argument is returned to whoever asked: `toResponse`
 * emits an `AppError`'s message verbatim, the webhook returns that body to the
 * external e-sign provider, and the browser reads it on the intake route. A
 * literal in one of these is client-facing copy wherever in the tree it lives.
 */
const WIRE_MESSAGE_MINTS: Readonly<Record<string, number>> = { appError: 1, validationError: 0 };

/**
 * The layers whose mints can REACH a wire boundary. `src/app/` is here for its
 * rendered copy as well; the roots differ only in which nodes each contributes.
 */
const WIRE_MESSAGE_ROOTS = ["src/app/", "src/domain/", "src/infrastructure/"] as const;

/**
 * The LOADER FAULT type whose values carry dotted document paths. A message that
 * interpolates one puts those paths on the wire at run time, which no scan of the
 * authored literals can see - the exact hole the plan compiler shipped through.
 */
const LOADER_FAULT_TYPE = "DomainConfigError";

/**
 * The AUTHORED spans of a literal node - never the raw source of a template, whose
 * `${INTERPOLATED_CONSTANT}` reads as a screaming-snake environment variable it is
 * not. What a span EVALUATES to is the interpolation clause's business.
 */
const LITERAL_KINDS = [
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
] as const;

const authoredText = (node: Node): string | null => {
  for (const kind of LITERAL_KINDS) {
    const literal = node.asKind(kind);
    if (literal !== undefined) return literal.getLiteralText();
  }
  return Node.isJsxText(node) ? node.getText() : null;
};

/** Every authored literal span of a node, ignoring what its interpolations evaluate to. */
function literalSpans(node: Node): string[] {
  const own = authoredText(node);
  return [
    ...(own === null ? [] : [own]),
    ...LITERAL_KINDS.flatMap((kind) =>
      node.getDescendantsOfKind(kind).map((literal) => literal.getLiteralText()),
    ),
  ];
}

/** Does this message BUILD itself from a loader fault, whatever its literals say? */
function interpolatesLoaderFault(node: Node): boolean {
  // A message with no interpolation carries no run-time value, and resolving
  // every identifier of every plain sentence in three layers is what turned this
  // fence from twenty seconds into two minutes.
  const spans = node.getDescendantsOfKind(SyntaxKind.TemplateSpan);
  if (spans.length === 0 && !Node.isTemplateExpression(node) && !Node.isCallExpression(node)) return false;
  for (const identifier of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
    for (const definition of identifier.getDefinitionNodes()) {
      if (definition.getText().includes(LOADER_FAULT_TYPE)) return true;
    }
  }
  return false;
}

/**
 * The JSX attributes that CARRY COPY. Every other attribute value is machinery -
 * a class name, an href, a test hook - so a path in one is not something a person
 * reads, and holding it to this rule would flag the demo surface manifest's own
 * component paths (structure, correctly spelled).
 */
const COPY_ATTRIBUTES = new Set(["alt", "aria-label", "label", "placeholder", "title"]);

/**
 * The app-layer modules whose string values BECOME client-facing copy without
 * passing through JSX - the wire's `error.message`. Registered explicitly because
 * "a string in a server module" is otherwise indistinguishable from machinery.
 */
const CLIENT_MESSAGE_MODULES = ["src/app/_server/refusal.ts"] as const;

/** Is this literal rendered, rather than machinery a user never sees? */
function isUserFacing(node: Node): boolean {
  const attribute = node.getFirstAncestorByKind(SyntaxKind.JsxAttribute);
  if (attribute !== undefined) return COPY_ATTRIBUTES.has(attribute.getNameNode().getText());
  return node.getFirstAncestorByKind(SyntaxKind.JsxElement) !== undefined ||
    node.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
    node.getFirstAncestorByKind(SyntaxKind.JsxFragment) !== undefined;
}

const namesAnInternal = (text: string): string | null =>
  DEPLOYMENT_INTERNALS.find((internal) => internal.pattern.test(text))?.what ?? null;

export function copyNamingDeploymentInternals(project: Project, roots: readonly string[]): string[] {
  const out: string[] = [];
  const report = (file: string, node: Node, text: string, where: string): void => {
    const what = namesAnInternal(text);
    if (what !== null) {
      out.push(`${file}:${node.getStartLineNumber()}: ${where} names ${what} (${text.trim().slice(0, 80)})`);
    }
  };
  for (const sourceFile of project.getSourceFiles()) {
    const file = normalizedPath(sourceFile.getFilePath());
    if (!roots.some((root) => file.startsWith(root)) || file.includes("/__tests__/")) continue;
    const everyLiteral = CLIENT_MESSAGE_MODULES.includes(file as (typeof CLIENT_MESSAGE_MODULES)[number]);
    // EVERY MESSAGE THAT CAN REACH THE WIRE, wherever it is minted: `toResponse`
    // returns it verbatim to a browser and the webhook returns it to the external
    // provider, so a dotted document path here is the same class as one on screen.
    for (const mint of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const index = WIRE_MESSAGE_MINTS[mint.getExpression().getText()];
      const message = index === undefined ? undefined : mint.getArguments()[index];
      if (message === undefined) continue;
      for (const span of literalSpans(message)) report(file, message, span, "a client-facing message");
      if (interpolatesLoaderFault(message)) {
        out.push(`${file}:${message.getStartLineNumber()}: a client-facing message is built from a ${LOADER_FAULT_TYPE}, whose paths reach the wire at run time`);
      }
    }
    for (const node of sourceFile.getDescendants()) {
      // A module specifier is resolution, not copy - and it is the ONE place an
      // app-layer file legitimately spells a path.
      if (node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
      if (node.getFirstAncestorByKind(SyntaxKind.ExportDeclaration)) continue;
      const text = authoredText(node);
      if (text === null) continue;
      if (!everyLiteral && !isUserFacing(node)) continue;
      report(file, node, text, "user-facing copy");
    }
  }
  return [...new Set(out)].sort();
}

describe("domain-configuration fence (v3 invariant 3, prompt 10)", () => {
  const vocabulary = domainVocabulary();

  it("enforces: the repository publishes both ratified domains as configuration", () => {
    expect(DOMAIN_FILES).toEqual(["account-opening.yaml", "money-movement.yaml"]);
    expect(vocabulary).toContain("account-opening");
    expect(vocabulary).toContain("money-movement");
  });

  it("(A) enforces: no decision-core module, directory, identifier, or literal names a domain", () => {
    const reviewed = new Set(REVIEWED_DOMAIN_NAME_USES.map((entry) => `${entry.file}\u0000${entry.token}`));
    const uses = domainNameUses(realProject(), vocabulary)
      .filter((use) => !reviewed.has(`${use.file}\u0000${use.token}`));
    expect(
      uses,
      `decision-core names a decision domain (invariant 3):\n${uses.map((use) => `${use.file}:${use.line} ${use.detail}`).join("\n")}`,
    ).toEqual([]);
  });

  it("(A') enforces: every reviewed domain-name escape is justified and load-bearing", () => {
    for (const entry of REVIEWED_DOMAIN_NAME_USES) {
      expect(entry.why.trim().length, `${entry.file} needs a reason`).toBeGreaterThan(20);
    }
    const detected = new Set(domainNameUses(realProject(), vocabulary).map((use) => `${use.file}\u0000${use.token}`));
    const stale = REVIEWED_DOMAIN_NAME_USES
      .filter((entry) => !detected.has(`${entry.file}\u0000${entry.token}`))
      .map((entry) => entry.file);
    expect(stale, `escapes that suppress nothing:\n${stale.join("\n")}`).toEqual([]);
  });

  it.each(DOMAIN_FILES)("(B) enforces: %s loads through the REAL shared engine loader", (file) => {
    const result = loadDomainConfig(parsed(file));
    expect(
      result.ok,
      result.ok ? "" : result.error.map((error) => `${error.code} at ${error.path}: ${error.message}`).join("\n"),
    ).toBe(true);
  });

  it.each(DOMAIN_FILES)("(B) enforces: %s binds for two firms and differs only by firmId", (file) => {
    const loaded = loadDomainConfig(parsed(file));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const project = (firmId: string): string => {
      const bound = bindDomainConfig(loaded.value, registryFor(firmId));
      expect(bound.ok, bound.ok ? "" : JSON.stringify(bound.error)).toBe(true);
      if (!bound.ok) return "";
      return JSON.stringify({
        versionRef: bound.value.domainConfigVersionRef,
        executionTargets: [...bound.value.executionTargets].sort(),
        approvalTemplates: [...bound.value.approvalTemplates].sort(),
        evidenceSupplierRoles: [...bound.value.evidenceSupplierRoles].sort(),
        boundParameters: [...bound.value.boundParameters].sort(),
      });
    };
    const one = project("tenant-one");
    const two = project("tenant-two");
    expect(one.length).toBeGreaterThan(0);
    expect(two.split("tenant-two").join("F")).toEqual(one.split("tenant-one").join("F"));
  });

  it.each(DOMAIN_FILES)("(C) enforces: %s is inert data and carries no firm identity", (file) => {
    expect(inertnessProblems(documentText(file))).toEqual([]);
    expect(documentText(file)).not.toMatch(/^\s*firmId\s*:/m);
  });

  it("(D) enforces: every published version's canonical bytes match its pinned hash", () => {
    const pins = JSON.parse(readFileSync(join(REPO_ROOT, CONFIG_DIRECTORY, "versions.json"), "utf8")) as {
      versions: VersionPin[];
    };
    const drift = versionPinDrift(
      DOMAIN_FILES.map((file) => ({ file, document: parsed(file) })),
      pins.versions,
    );
    expect(drift, drift.join("\n")).toEqual([]);
    expect(pins.versions.length).toBe(DOMAIN_FILES.length);
  });

  it("(E) enforces: only the config source adapter names config/domains/", () => {
    const project = realProject();
    const offenders = configDirectoryReaders(project);
    expect(offenders, `only ${CONFIG_READERS.join(", ")} may read the configuration directory:\n${offenders.join("\n")}`).toEqual([]);
    expect(
      project
        .getSourceFiles()
        .some((file) => CONFIG_READERS.includes(normalizedPath(file.getFilePath()) as (typeof CONFIG_READERS)[number])),
      "the allowed reader must exist, or this rule passes vacuously",
    ).toBe(true);
  });

  it("(F) enforces: every label id the demo asks for is declared by money-movement.yaml", () => {
    const requests = demoLabelRequests(realProject());
    expect(
      [...new Set(requests.map((request) => request.vocabulary))].sort(),
      "the demo must read its slot, evidence-kind AND action labels from the configuration",
    ).toEqual(["evidenceKinds", "intents", "slots"]);
    const loaded = loadDomainConfig(parsed("money-movement.yaml"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const unbound = unboundLabelRequests(requests, declaredVocabulary(loaded.value.document.presentation.copy));
    expect(
      unbound,
      `the demo asks for a label the money-movement configuration does not declare (renaming one would 500 the demo journey):\n${unbound.join("\n")}`,
    ).toEqual([]);
  });

  it("(G) enforces: the configured registration vocabulary equals the vocabulary the store accepts", () => {
    const loaded = loadDomainConfig(parsed("account-opening.yaml"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const drift = storeVocabularyDrift(
      loaded.value.document.intents,
      STORE_VOCABULARY_TRIGGER_FIELD,
      ACCOUNT_TYPES,
    );
    expect(
      drift,
      "the configuration and src/domain/schema/entities.ts disagree about the registration vocabulary, so a configured option the request boundary admits would be refused at the third execution step - after the household and contact writes have committed:\n" +
        drift.join("\n"),
    ).toEqual([]);
  });

  it.each(DOMAIN_FILES)("(H) enforces: %s binds through a registry DERIVED from itself", (file) => {
    const loaded = loadDomainConfig(parsed(file));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const classes = requiredFirmClasses(loaded.value);
    const bound = bindDomainConfig(loaded.value, derivedRegistry("tenant-one", classes));
    expect(
      bound.ok,
      bound.ok
        ? ""
        : "requiredFirmClasses does not report every class this document references, so a surface that builds its registry from it (the demo) refuses to bind at REQUEST time:\n" +
          bound.error.map((error) => `${error.path}: ${error.message}`).join("\n"),
    ).toBe(true);
    // A derivation that reported nothing would make the assertion above vacuous.
    expect(Object.values(classes).every((entry) => Array.isArray(entry))).toBe(true);
    expect(Object.values(classes).flat().length).toBeGreaterThan(0);
  });

  it("(I) enforces: every configuration refusal is minted with its cause marked", () => {
    const project = realProject();
    const unmarked = unmarkedConfigurationRefusals(project, CONFIGURATION_MODULE_ROOTS);
    expect(unmarked, `configuration refusals whose cause is unmarked:\n${unmarked.join("\n")}`).toEqual([]);
    // ...and the derivation is COMPLETE: nothing marks a configuration refusal
    // where a rule derived from the configuration modules could not see it.
    const outside = configurationMarkersOutsideModules(project, CONFIGURATION_MODULE_ROOTS);
    expect(outside, `configuration refusals minted outside the configuration modules:\n${outside.join("\n")}`).toEqual([]);
  });

  it("(J) enforces: no surface STATES a client instruction it could read from the cause", () => {
    const project = realProject();
    const stated = statedRetryInstructions(project, WIRE_MESSAGE_ROOTS);
    expect(stated.violations, `instructions chosen per call site:\n${stated.violations.join("\n")}`).toEqual([]);
    // ANTI-VACUITY, now that the sites are DERIVED: a derivation that found no
    // file, or no decision inside one, would report an empty violation list about
    // nothing at all.
    expect(retryDecisionFiles(project, WIRE_MESSAGE_ROOTS).length).toBeGreaterThan(0);
    expect(stated.decisions).toBeGreaterThan(0);
  });

  it("(K) enforces: no deployment internal reaches a user-facing surface or the wire", () => {
    const named = copyNamingDeploymentInternals(realProject(), WIRE_MESSAGE_ROOTS).filter((hit) =>
      !REVIEWED_WIRE_INTERNALS.some((entry) => hit.startsWith(entry.file + ":") && hit.includes(entry.token)));
    expect(named, `deployment internals in what a user or a sender reads:\n${named.join("\n")}`).toEqual([]);
  });

  it("(K') enforces: every reviewed wire-internal escape is justified and load-bearing", () => {
    const detected = copyNamingDeploymentInternals(realProject(), WIRE_MESSAGE_ROOTS);
    for (const entry of REVIEWED_WIRE_INTERNALS) {
      expect(entry.why.trim().length, `${entry.file} needs a reason`).toBeGreaterThan(20);
    }
    const stale = REVIEWED_WIRE_INTERNALS
      .filter((entry) =>
        !detected.some((hit) => hit.startsWith(`${entry.file}:`) && hit.includes(entry.token)))
      .map((entry) => `${entry.file} :: ${entry.token}`);
    expect(stale, `escapes that suppress nothing:\n${stale.join("\n")}`).toEqual([]);
  });

  it("enforces: every named deferral still has no shipped caller", () => {
    const stale: string[] = [];
    for (const [entry, reason] of Object.entries(NAMED_DEFERRALS)) {
      expect(reason.length).toBeGreaterThan(20);
      const [file, name] = entry.split(" :: ");
      const importers = realProject()
        .getSourceFiles()
        .filter((sourceFile) => {
          const rel = normalizedPath(sourceFile.getFilePath());
          return rel !== file && !rel.startsWith("src/__tests__/");
        })
        .filter((sourceFile) =>
          moduleReferences(sourceFile).some((reference) =>
            (reference.specifier ?? "").includes("config/registries"),
          ) && sourceFile.getFullText().includes(name!),
        );
      if (importers.length > 0) stale.push(`${entry} now has a caller - remove the deferral`);
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  describe("detects (companion): incomplete or dishonest work CANNOT pass", () => {
    it("(I) catches a configuration refusal minted in an UNLISTED function of a config module", () => {
      // The live counterexample the hand-listed registry could not see: a mint in
      // a registered FILE but an unregistered FUNCTION. The derivation names no
      // function at all, so this is caught without anyone adding it.
      const project = inMemoryProject({
        "/src/domain/config/plan-compiler.ts":
          `const failure = (errors) => ({ kind: "fail", error: appError("INTERNAL", "step: " + fmt(errors)) });\n` +
          `export const compileFlowDefinition = () => err(operatorRecoverable(appError("INTERNAL", "no such intent")));`,
      });
      const unmarked = unmarkedConfigurationRefusals(project, ["src/domain/config/"]);
      expect(unmarked).toEqual([
        "src/domain/config/plan-compiler.ts:1: a configuration refusal is minted without operatorRecoverable()",
      ]);
      const marked = inMemoryProject({
        "/src/domain/config/plan-compiler.ts":
          `const failure = (errors) => ({ kind: "fail", error: operatorRecoverable(appError("INTERNAL", "step")) });`,
      });
      expect(unmarkedConfigurationRefusals(marked, ["src/domain/config/"])).toEqual([]);
    });

    it("(I) exempts a SUBMITTER refusal by its code, not by a blessed-function list", () => {
      const project = inMemoryProject({
        "/src/domain/config/intake-view.ts":
          `export const admit = (f) => err(appError("VALIDATION", f.label + " is required."));`,
      });
      // A submitter's own typo is not operator-recoverable, so the VALIDATION is
      // clean - but the root then refuses nothing, which is reported rather than
      // read as proof.
      expect(unmarkedConfigurationRefusals(project, ["src/domain/config/"])).toEqual([
        "src/domain/config/ mints no configuration refusal - the derivation is stale",
      ]);
    });

    it("(I) catches a configuration refusal marked where the derivation cannot see it", () => {
      // The completeness half: a mint outside the roots can only be MARKED by
      // importing the marker, so the import is what the rule keys on - and it
      // resolves the import's own name, so an alias does not evade it.
      const outside = inMemoryProject({
        "/src/infrastructure/wire.ts":
          `import { operatorRecoverable as mark } from "@contracts/client-retry";\n` +
          `export const flow = () => err(mark(appError("INTERNAL", "no adapter")));`,
        "/src/domain/config/load.ts":
          `import { operatorRecoverable } from "@contracts/client-retry";\n` +
          `export const load = () => err(operatorRecoverable(appError("INTERNAL", "bad")));`,
      });
      expect(configurationMarkersOutsideModules(outside, ["src/domain/config/"])).toEqual([
        "src/infrastructure/wire.ts marks a configuration refusal outside the configuration modules, where the derivation cannot see it",
      ]);
      // Inside the roots it is exactly where it belongs, so the rule stays silent.
      expect(configurationMarkersOutsideModules(outside, ["src/domain/config/", "src/infrastructure/"])).toEqual([]);
    });

    it("(I) ANTI-VACUITY: an empty root, and a marker nobody applies, are both reported", () => {
      const project = inMemoryProject({
        "/src/domain/config/load.ts": `export const load = () => ok(1);`,
      });
      expect(unmarkedConfigurationRefusals(project, ["src/domain/config/"])).toEqual([
        "src/domain/config/ mints no configuration refusal - the derivation is stale",
      ]);
      expect(configurationMarkersOutsideModules(project, ["src/domain/config/"])).toEqual([
        "no configuration module imports operatorRecoverable() - the rule checks a mark nobody applies",
      ]);
    });

    it("(J) catches an instruction STATED in a file NO registry lists", () => {
      // The derivation is what makes this bite: this surface is new, nobody
      // registered it, and it decides a category instead of asking the cause.
      const project = inMemoryProject({
        "/src/app/api/flows/other/route.ts":
          `import { CLIENT_RETRY } from "@contracts/client-retry";\n` +
          `export const POST = (e) => ({ retry: CLIENT_RETRY.none });`,
      });
      const stated = statedRetryInstructions(project, ["src/app/"]);
      expect(stated.violations.some((hit) => hit.includes("CLIENT_RETRY.none"))).toBe(true);
      expect(stated.decisions).toBe(1);
      const derived = inMemoryProject({
        "/src/app/api/flows/other/route.ts":
          `import { clientRetryFor, CLIENT_RETRY } from "@contracts/client-retry";\n` +
          `export const POST = (e) => ({ retry: clientRetryFor(e, CLIENT_RETRY.none) });`,
      });
      expect(statedRetryInstructions(derived, ["src/app/"]).violations).toEqual([]);
    });

    it("(J) catches a RAW instruction literal in a file that imports nothing", () => {
      const project = inMemoryProject({
        "/src/infrastructure/other.ts": `export const refused = () => ({ retry: "do-not-retry" });`,
      });
      expect(retryDecisionFiles(project, ["src/infrastructure/"])).toEqual(["src/infrastructure/other.ts"]);
      expect(statedRetryInstructions(project, ["src/infrastructure/"]).violations).toHaveLength(1);
    });

    it("(J) ANTI-VACUITY: a tree that decides nothing reports no decisions to check", () => {
      const project = inMemoryProject({ "/src/infrastructure/wire.ts": `export const x = 1;` });
      expect(retryDecisionFiles(project, ["src/infrastructure/"])).toEqual([]);
      expect(statedRetryInstructions(project, ["src/infrastructure/"]).decisions).toBe(0);
    });

    it("(K) catches every deployment-internal FORM the first pattern let through", () => {
      // A BARE FILENAME - no directory - which the directory-shaped pattern missed.
      const bare = inMemoryProject({
        "/src/app/app/account-opening/page.tsx":
          `export const P = () => <p>Restore account-opening.yaml and reload.</p>;`,
      });
      expect(copyNamingDeploymentInternals(bare, ["src/app/"])).toHaveLength(1);
      // An extension outside the old fixed list.
      const other = inMemoryProject({
        "/src/app/app/account-opening/page.tsx":
          `export const P = () => <p>See docs/runbook.md, then re-run migrate.sql.</p>;`,
      });
      expect(copyNamingDeploymentInternals(other, ["src/app/"])).toHaveLength(1);
      // AN ENVIRONMENT VARIABLE NAME, equally an internal and equally unactionable.
      const env = inMemoryProject({
        "/src/app/_server/refusal.ts": `export const M = { later: "Ask an operator to set SESSION_SECRET." };`,
      });
      expect(copyNamingDeploymentInternals(env, ["src/app/"])).toHaveLength(1);
      // A DIGEST, which is what the pinned/read hashes are.
      const digest = inMemoryProject({
        "/src/infrastructure/config/domain-config-source.ts":
          `export const r = () => appError("INTERNAL", "pinned 9f2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809");`,
      });
      expect(copyNamingDeploymentInternals(digest, ["src/infrastructure/"])).toHaveLength(1);
    });

    it("(K) catches a wire message minted OUTSIDE src/app/, literally and by interpolation", () => {
      // The scope gap: these reach a browser and the e-sign provider through
      // `toResponse`, and the app-only rule structurally could not see them.
      const literal = inMemoryProject({
        "/src/domain/config/plan-compiler.ts":
          `export const f = () => appError("INTERNAL", \`could not prepare execution.capabilities.x.payload.y\`);`,
      });
      expect(copyNamingDeploymentInternals(literal, ["src/domain/"])).toHaveLength(1);
      // ...and the run-time form no literal scan can see: the paths arrive from a
      // loader fault, which is exactly how the plan compiler shipped them.
      const interpolated = inMemoryProject({
        "/src/domain/config/errors.ts":
          `export type DomainConfigError = { code: string; path: string; message: string };\n` +
          `export const fmt = (errors: readonly DomainConfigError[]): string => errors.map((e) => e.path).join("; ");`,
        "/src/domain/config/plan-compiler.ts":
          `import { fmt } from "./errors";\n` +
          `export const f = (errors) => appError("INTERNAL", \`The configured step could not be prepared: \${fmt(errors)}\`);`,
      });
      expect(
        copyNamingDeploymentInternals(interpolated, ["src/domain/"]).some((hit) =>
          hit.includes("is built from a DomainConfigError")),
      ).toBe(true);
    });

    it("(K) catches a deployment path in copy a user reads, in JSX text and in a message map", () => {
      const jsx = inMemoryProject({
        "/src/app/app/account-opening/page.tsx":
          `export const P = () => <p>Restore config/domains/account-opening.yaml and reload.</p>;`,
      });
      expect(copyNamingDeploymentInternals(jsx, ["src/app/"]).length).toBe(1);
      const message = inMemoryProject({
        "/src/app/_server/refusal.ts":
          `export const M = { later: "Ask an operator to restore config/domains/account-opening.yaml." };`,
      });
      expect(copyNamingDeploymentInternals(message, ["src/app/"]).length).toBe(1);
      // A module specifier is resolution, not copy - the one place a path belongs.
      const imports = inMemoryProject({
        "/src/app/app/account-opening/page.tsx":
          `import { x } from "../../_server/refusal.ts";\nexport const P = () => <p>Ask your operations team.</p>;`,
      });
      expect(copyNamingDeploymentInternals(imports, ["src/app/"])).toEqual([]);
    });

    it("catches a domain-named evaluator branch inside decision-core", () => {
      const project = inMemoryProject({
        "/src/domain/config/bind.ts": `export const f = (id: string): boolean => id === "money-movement";`,
      });
      const uses = domainNameUses(project, ["money-movement"], ["src/domain/config/"]);
      expect(uses.some((use) => use.detail.includes("string literal"))).toBe(true);
    });

    it("catches a domain-named module file inside decision-core", () => {
      const project = inMemoryProject({
        "/src/domain/config/money-movement-defaults.ts": `export const x = 1;`,
      });
      expect(domainNameUses(project, ["money-movement"], ["src/domain/config/"]).some(
        (use) => use.detail.includes("file or directory name"),
      )).toBe(true);
    });

    it("catches a domain-named identifier inside decision-core", () => {
      const project = inMemoryProject({
        "/src/domain/config/load.ts": `export const accountOpeningDefaults = 1;`,
      });
      expect(domainNameUses(project, ["accountOpening"], ["src/domain/config/"]).some(
        (use) => use.detail.includes("identifier"),
      )).toBe(true);
    });

    it("ANTI-VACUITY: an emptied vocabulary can never be reported as clean", () => {
      // The derivation must come from real published documents. An empty
      // vocabulary would make RULE A pass over any tree at all, which is the
      // exact false-pass this fence exists to refuse.
      expect(domainVocabulary([])).toEqual([]);
      expect(domainVocabulary()).not.toEqual([]);
      const project = inMemoryProject({
        "/src/domain/config/money-movement.ts": `export const x = "money-movement";`,
      });
      expect(domainNameUses(project, [], ["src/domain/config/"])).toEqual([]);
      expect(domainNameUses(project, domainVocabulary(), ["src/domain/config/"]).length).toBeGreaterThan(0);
    });

    it("catches a configuration that does not load (the REAL loader is the judge)", () => {
      const broken = parsed(DOMAIN_FILES[0]!) as Record<string, unknown>;
      broken["intents"] = [];
      expect(loadDomainConfig(broken).ok).toBe(false);
    });

    it("catches a configuration that cannot bind because the firm supplies nothing", () => {
      const loaded = loadDomainConfig(parsed(DOMAIN_FILES[0]!));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const bound = bindDomainConfig(loaded.value, {
        firmId: "tenant-one",
        executionTargets: new Map(),
        evidenceSources: new Map(),
        approvalTemplates: new Map(),
        roles: new Map(),
      });
      expect(bound.ok).toBe(false);
    });

    it("catches every non-inert YAML feature", () => {
      expect(inertnessProblems("a: !!js/function 'x'").length).toBeGreaterThan(0);
      expect(inertnessProblems("a: &anchor 1\nb: *anchor").length).toBeGreaterThan(0);
      expect(inertnessProblems("base: &b { x: 1 }\nchild:\n  <<: *b").length).toBeGreaterThan(0);
      expect(inertnessProblems("a: 1\nb: two")).toEqual([]);
    });

    it("catches a module other than the config source naming the configuration directory", () => {
      expect(configDirectoryReaders(inMemoryProject({
        "/src/domain/config/load.ts": `export const t = readFileSync("config/domains/x.yaml");`,
      }))).toEqual(["src/domain/config/load.ts:1"]);
      expect(configDirectoryReaders(inMemoryProject({
        "/src/domain/config/load.ts": `// reads config/domains/ elsewhere\nexport const t = 1;`,
      }))).toEqual([]);
      // A message naming the file is not ACCESS, so this rule stays silent on it.
      // RULE K is what forbids it, and for the other reason: a user cannot act on
      // a path, and naming one crosses the same trust boundary D-227 closed.
      expect(configDirectoryReaders(inMemoryProject({
        "/src/app/page.ts": `export const help = "Restore config/domains/account-opening.yaml and reload.";`,
      }))).toEqual([]);
      expect(configDirectoryReaders(inMemoryProject({
        [`/${CONFIG_READERS[0]}`]: `export const p = join("config/domains", "x");`,
      }))).toEqual([]);
    });

    it("catches the directory reached through an IMPORTED constant, whose text names no path", () => {
      // The evasion the literal scan cannot see: the path lives in a `const` in
      // the allowed module, and the offender imports it under another name, so
      // "config/domains" appears nowhere in the offender's own bytes.
      const project = inMemoryProject({
        [`/${CONFIG_READERS[0]}`]: `export const DIR = "config/domains";\nexport const own = join(DIR, "a.yaml");`,
        "/src/domain/config/sneaky.ts":
          `import { DIR as anywhere } from "@infra/config/domain-config-source";\n` +
          `export const text = readFileSync(join(anywhere, "account-opening.yaml"), "utf8");`,
      });
      expect(configDirectoryReaders(project)).toEqual([
        "src/domain/config/sneaky.ts:1",
        "src/domain/config/sneaky.ts:2",
      ]);
      // The allowed module's own use of the same constant is still permitted, so
      // the rule is rejecting the ESCAPE rather than the constant.
      expect(configDirectoryReaders(inMemoryProject({
        [`/${CONFIG_READERS[0]}`]: `const DIR = "config/domains";\nexport const own = join(DIR, "a.yaml");`,
      }))).toEqual([]);
    });

    it("catches a demo label id money-movement.yaml no longer declares", () => {
      const project = inMemoryProject({
        "/src/app/demo/vocabulary.ts":
          `export function evidenceLabel(firmId: string, kind: string): string { return firmId + kind; }`,
        // Aliased on purpose: the reader is resolved by symbol, not by call text.
        "/src/app/demo/build-context.ts":
          `import { evidenceLabel as row } from "./vocabulary";\nexport const label = row("firm-a", "pending-actions-renamed");`,
      });
      const requests = demoLabelRequests(project, "src/app/demo/vocabulary.ts");
      expect(requests).toEqual([
        { file: "src/app/demo/build-context.ts", line: 2, vocabulary: "evidenceKinds", id: "pending-actions-renamed" },
      ]);
      const loaded = loadDomainConfig(parsed("money-movement.yaml"));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const declared = declaredVocabulary(loaded.value.document.presentation.copy);
      expect(unboundLabelRequests(requests, declared)).toHaveLength(1);
      // The id the shipped demo actually asks for still binds, so the rule is
      // rejecting the RENAME rather than rejecting everything.
      expect(
        unboundLabelRequests([{ ...requests[0]!, id: "pending-actions" }], declared),
      ).toEqual([]);
    });

    it("FAILS CLOSED on a demo label id that is not a literal", () => {
      const project = inMemoryProject({
        "/src/app/demo/vocabulary.ts":
          `export function slotLabel(firmId: string, slot: string): string { return firmId + slot; }`,
        "/src/app/demo/build-context.ts":
          `import { slotLabel } from "./vocabulary";\nconst chosen = "amount";\nexport const label = slotLabel("firm-a", chosen);`,
      });
      const requests = demoLabelRequests(project, "src/app/demo/vocabulary.ts");
      expect(requests.map((request) => request.id)).toEqual([null]);
      expect(
        unboundLabelRequests(requests, { slots: new Set(["amount"]), evidenceKinds: new Set(), intents: new Set() }),
      ).toHaveLength(1);
    });

    it("does not credit a same-named helper from another module", () => {
      const project = inMemoryProject({
        "/src/app/demo/vocabulary.ts":
          `export function slotLabel(firmId: string, slot: string): string { return firmId + slot; }`,
        "/src/app/demo/build-context.ts":
          `function slotLabel(firmId: string, slot: string): string { return slot; }\nexport const label = slotLabel("firm-a", "invented");`,
      });
      expect(demoLabelRequests(project, "src/app/demo/vocabulary.ts")).toEqual([]);
    });

    it("catches registration-vocabulary drift in BOTH directions, against the REAL document", () => {
      const loaded = loadDomainConfig(parsed("account-opening.yaml"));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const intents = loaded.value.document.intents;
      // A registration added to the configuration and not to the store: the case
      // that would render an admitted select option and then refuse mid-flow.
      const storeMissingOne = ACCOUNT_TYPES.filter((type) => type !== "trust");
      expect(
        storeVocabularyDrift(intents, STORE_VOCABULARY_TRIGGER_FIELD, storeMissingOne),
      ).toEqual(['registration-type declares "trust", which the shipped vocabulary does not accept']);
      // And the reverse: a registration the store accepts that no document offers.
      const documentMissingOne = intents.map((intent) => ({
        ...intent,
        slots: intent.slots.map((slot) =>
          slot.triggerField === STORE_VOCABULARY_TRIGGER_FIELD
            ? { ...slot, values: (slot.values ?? []).filter((value) => value !== "joint") }
            : slot,
        ),
      }));
      expect(
        storeVocabularyDrift(documentMissingOne, STORE_VOCABULARY_TRIGGER_FIELD, ACCOUNT_TYPES),
      ).toEqual(['the shipped vocabulary accepts "joint", which registration-type does not declare']);
      // The shipped pair still agrees, so the rule rejects the DRIFT, not everything.
      expect(storeVocabularyDrift(intents, STORE_VOCABULARY_TRIGGER_FIELD, ACCOUNT_TYPES)).toEqual([]);
    });

    it("FAILS CLOSED when no single enum slot supplies the shipped transport field", () => {
      const values = ["individual", "joint"] as const;
      const supplier: SlotDeclaration = { id: "registration-type", triggerField: "accountType", values };
      expect(storeVocabularyDrift([{ id: "open-account", slots: [supplier] }], "accountType", values)).toEqual([]);
      // Renamed away: nothing supplies the field the store's column is written from.
      expect(
        storeVocabularyDrift(
          [{ id: "open-account", slots: [{ ...supplier, triggerField: "registrationKind" }] }],
          "accountType",
          values,
        ),
      ).toEqual(['exactly one enum slot must supply "accountType"; this document declares 0']);
      // Two suppliers make the binding ambiguous, which is equally unprovable.
      expect(
        storeVocabularyDrift(
          [{ id: "open-account", slots: [supplier, { ...supplier, id: "registration-type-2" }] }],
          "accountType",
          values,
        ),
      ).toEqual(['exactly one enum slot must supply "accountType"; this document declares 2']);
    });

    it("catches a firm-class checklist that misses ANY class the document references", () => {
      const registries = ["executionTargets", "evidenceSources", "approvalTemplates", "roles"] as const;
      const exercised = new Set<(typeof registries)[number]>();
      for (const file of DOMAIN_FILES) {
        const loaded = loadDomainConfig(parsed(file));
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        const classes = requiredFirmClasses(loaded.value);
        // EVERY derived entry must be load-bearing: dropping one - the exact
        // shape of a derivation that forgot a position `bindDomainConfig` reads
        // - must refuse rather than bind on the remainder.
        for (const registry of registries) {
          for (const className of classes[registry]) {
            exercised.add(registry);
            const bound = bindDomainConfig(loaded.value, derivedRegistry("t", classes, { registry, className }));
            expect(bound.ok, `${file}: dropping ${registry}.${className} still bound`).toBe(false);
          }
        }
        expect(bindDomainConfig(loaded.value, derivedRegistry("t", classes)).ok).toBe(true);
      }
      // No registry may go unproven: an untested one is a derivation nobody checked.
      expect([...exercised].sort()).toEqual([...registries].sort());
    });

    it("catches a published document edited without a version bump", () => {
      const loaded = loadDomainConfig(parsed(DOMAIN_FILES[0]!));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const edited = {
        ...loaded.value.document,
        presentation: {
          ...loaded.value.document.presentation,
          domainLabel: `${loaded.value.document.presentation.domainLabel} (edited)`,
        },
      };
      const before = canonicalConfigJson(loaded.value.document);
      const after = canonicalConfigJson(edited);
      expect(before.ok && after.ok && before.value !== after.value).toBe(true);
      // The edited bytes must FAIL rule D against the shipped pins, not merely
      // hash differently: proving the bytes moved is not proving the rule bites.
      const pins = JSON.parse(readFileSync(join(REPO_ROOT, CONFIG_DIRECTORY, "versions.json"), "utf8")) as {
        versions: VersionPin[];
      };
      expect(
        versionPinDrift([{ file: DOMAIN_FILES[0]!, document: edited }], pins.versions),
      ).toHaveLength(1);
    });

    it("catches a document RULE D cannot PROVE: an unloadable or uncanonicalizable one fails, never skips", () => {
      const pins = JSON.parse(readFileSync(join(REPO_ROOT, CONFIG_DIRECTORY, "versions.json"), "utf8")) as {
        versions: VersionPin[];
      };
      const shipped = DOMAIN_FILES.map((file) => ({ file, document: parsed(file) }));
      // Baseline: the shipped documents pass, so the two refusals below are the
      // rule biting rather than the rule being broken.
      expect(versionPinDrift(shipped, pins.versions)).toEqual([]);
      // A document the loader refuses has no proven bytes behind its pin.
      const unloadable = versionPinDrift([{ file: "unloadable.yaml", document: { not: "a document" } }], pins.versions);
      expect(unloadable).toHaveLength(1);
      expect(unloadable[0]).toContain("unloadable.yaml");
      // A document whose canonical bytes cannot be produced is the branch that
      // used to `continue`: rule D passed with an empty drift list while proving
      // nothing at all about that file.
      const uncanonicalizable = versionPinDrift(shipped, pins.versions, () => ({ ok: false }));
      expect(uncanonicalizable).toHaveLength(DOMAIN_FILES.length);
      for (const file of DOMAIN_FILES) {
        expect(uncanonicalizable.some((entry) => entry.includes(file))).toBe(true);
      }
    });
  });
});
