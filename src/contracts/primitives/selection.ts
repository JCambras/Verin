/**
 * candidate-selection (v3 prompt 8; ADR-0039): generate -> filter -> rank ->
 * select over a typed candidate set. This primitive exists because applying
 * predicates INSIDE a collection is per-candidate quantification, which the
 * first-order policy AST cannot do by design - filters are closed parameters
 * here, never AST lambdas, and that line is what keeps the AST first-order.
 *
 * The same primitive serves the bind stage (which household?) and the evaluate
 * stage (which source?), so ambiguity semantics stay uniform: the outcome is
 * exactly one of selected, ambiguous (with a typed human question), or empty.
 * The model NEVER guesses between candidates - ambiguity is a structured
 * question for a human, not a probabilistic pick.
 */
import { z } from "zod";
import {
  EvidenceKindSchema,
  ReasonCodeSchema,
  SubjectRefSchema,
  compareScopedReferences,
  hasUniqueScopedReferences,
  normalizeCanonicalStrings,
  type SubjectRef,
} from "../decision-core/ids";
import {
  KeySegmentSchema,
  addSingleTenantIssue,
  parsePrimitiveId,
  publishedCode,
  publishedReference,
  publishedStructured,
  type PrimitiveFalsification,
  type PublishedFactRecord,
  type PublishedKeyMap,
} from "./values";

const SELECTION_STRATEGIES = ["exactly-one", "preference-order", "single-eligible"] as const;

/**
 * Alternatives the household preference list actually ranked behind the winner
 * carry this code; excluded alternatives carry their exclusion's own configured
 * code.
 */
const RANKED_BEHIND_REASON = ReasonCodeSchema.parse("ranked-behind-selection");

/**
 * Alternatives that tie the winner's rank - both absent from the preference
 * list, so nothing ranked either - lose only to the canonical (firmId, id)
 * order, and the trace says exactly that rather than crediting a household
 * preference that never spoke.
 */
const CANONICAL_TIEBREAK_REASON = ReasonCodeSchema.parse("canonical-order-tiebreak");

const CandidateSelectionParameterSchema = z
  .strictObject({
    candidateEvidenceKind: KeySegmentSchema.pipe(EvidenceKindSchema),
    /** The intent slot being selected for - becomes the published-key segment. */
    subjectSlot: KeySegmentSchema,
    /**
     * Closed filter toggles, declared per binding as data: a candidate whose
     * classifications include `classification` is rejected with `reasonCode`.
     * Order matters - the FIRST matching exclusion names the rejection.
     */
    exclusions: z
      .array(
        z
          .strictObject({
            classification: KeySegmentSchema,
            reasonCode: ReasonCodeSchema,
          })
          .readonly(),
      )
      .refine(
        (exclusions) =>
          new Set(exclusions.map((exclusion) => exclusion.classification)).size ===
          exclusions.length,
        "duplicate exclusion classification",
      )
      .readonly(),
    /** The coded human question an ambiguous outcome asks. */
    ambiguityQuestionCode: ReasonCodeSchema,
  })
  .readonly();

const CandidateSchema = z
  .strictObject({
    ref: SubjectRefSchema,
    classifications: z
      .array(KeySegmentSchema)
      .refine((codes) => new Set(codes).size === codes.length, "duplicate classification")
      .overwrite(normalizeCanonicalStrings)
      .readonly(),
  })
  .readonly();

const CandidateSelectionInputSchema = z
  .strictObject({
    parameters: CandidateSelectionParameterSchema,
    evidence: z
      .strictObject({
        candidates: z
          .array(CandidateSchema)
          .refine(
            (candidates) => hasUniqueScopedReferences(candidates.map((c) => c.ref)),
            "duplicate candidate reference",
          )
          // Canonical candidate order at the parse boundary: evaluation must
          // not depend on assembly order, and every downstream tiebreak leans
          // on this sort being already done.
          .overwrite((candidates) =>
            [...candidates].sort((left, right) =>
              compareScopedReferences(left.ref, right.ref),
            ),
          )
          .readonly(),
        /**
         * Household preference-class ranking, best first. Order IS data here,
         * so it is never sorted. Entries need not all be current candidates -
         * a standing preference list may name subjects outside this run.
         */
        preferenceRanking: z
          .array(SubjectRefSchema)
          .refine(hasUniqueScopedReferences, "duplicate preference entry")
          .readonly(),
      })
      .readonly(),
    context: z
      .strictObject({ strategy: z.enum(SELECTION_STRATEGIES) })
      .readonly(),
  })
  .superRefine((input, ctx) => {
    addSingleTenantIssue(
      ctx,
      [
        ...input.evidence.candidates.map((candidate) => candidate.ref),
        ...input.evidence.preferenceRanking,
      ],
      ["evidence"],
    );
    // exactly-one asks whether the RAW set is singular (the bind-stage
    // question); a binding that also configures exclusions is contradicting
    // itself and is refused rather than silently filtered.
    if (input.context.strategy === "exactly-one" && input.parameters.exclusions.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "strategy exactly-one does not admit exclusions",
        path: ["context", "strategy"],
      });
    }
  })
  .readonly();

type Candidate = z.infer<typeof CandidateSchema>;

type RankedCandidate = { candidate: Candidate; rank: number };

const rankSurvivors = (
  survivors: readonly Candidate[],
  ranking: readonly SubjectRef[],
): RankedCandidate[] => {
  // Reference identity is the (firmId, id) pair; the array encoding keeps that
  // pair unambiguous for ids that may themselves contain a separator byte.
  const keyOf = (reference: SubjectRef): string =>
    JSON.stringify([reference.firmId, reference.id]);
  const rankOf = new Map(ranking.map((entry, index) => [keyOf(entry), index]));
  // Stable sort over the already-canonical survivor order: candidates absent
  // from the ranking tie at the end and keep canonical order - the documented
  // deterministic tiebreak every strategy must have. The rank rides along so
  // the trace can tell a real preference rank from that fallback; ranking
  // entries are unique, so only the absent-rank sentinel can tie.
  return survivors
    .map((candidate) => ({
      candidate,
      rank: rankOf.get(keyOf(candidate.ref)) ?? ranking.length,
    }))
    .sort((left, right) => left.rank - right.rank);
};

const candidateSelectionFalsification: PrimitiveFalsification = {
  operatingCase:
    "A real case requiring multi-candidate allocation with quantities (split 75000 across two sources pro-rata) or pairwise-interacting selection such as tax-lot selection - single-winner selection is then wrong. Also: any strategy that cannot guarantee a deterministic total order (unresolvable ties) falsifies the strategy vocabulary.",
  falsifiedResponse:
    "Activate the declared future primitive allocation-vector under a primitive-set version bump; never add quantity parameters to single-winner selection. A strategy without a documented total order is removed, not patched.",
};

export const candidateSelection = {
  id: parsePrimitiveId("candidate-selection"),
  summary:
    "Generate, filter, rank, and select over a typed candidate set with strategies from a closed vocabulary. Outcome is exactly one of selected (winner plus ranked alternatives with rejection reason codes), ambiguous (candidates plus a typed human question), or empty.",
  parameterSchema: CandidateSelectionParameterSchema,
  inputSchema: CandidateSelectionInputSchema,
  evidenceKindParameters: ["candidateEvidenceKind"],
  allowedStrategies: SELECTION_STRATEGIES,
  publishedKeys: (
    parameters: z.infer<typeof CandidateSelectionParameterSchema>,
  ): PublishedKeyMap => {
    const slot = parameters.subjectSlot;
    return {
      [`selection.${slot}.alternatives`]: publishedStructured(
        "Non-selected candidates with their rejection reason codes, on every outcome: present whenever candidates were excluded or ranked behind, absent only when neither happened.",
        "conditional",
      ),
      [`selection.${slot}.openQuestion`]: publishedStructured(
        "Ambiguous outcome only: candidate references plus the coded human question.",
        "conditional",
      ),
      [`selection.${slot}.outcome`]: publishedCode(
        "selected, ambiguous, or empty.",
      ),
      [`selection.${slot}.selectedRef`]: publishedReference(
        "Selected outcome only: the winning subject reference.",
        "conditional",
      ),
    };
  },
  falsification: candidateSelectionFalsification,
  evaluate: (
    input: z.infer<typeof CandidateSelectionInputSchema>,
  ): PublishedFactRecord => {
    const slot = input.parameters.subjectSlot;
    const keyOf = (segment: string): string => `selection.${slot}.${segment}`;
    type Alternative = { ref: SubjectRef; rejectedBecause: string };
    const rejected: Alternative[] = [];
    const survivors: Candidate[] = [];
    for (const candidate of input.evidence.candidates) {
      const exclusion = input.parameters.exclusions.find((entry) =>
        candidate.classifications.includes(entry.classification),
      );
      if (exclusion) {
        rejected.push({ ref: candidate.ref, rejectedBecause: exclusion.reasonCode });
      } else {
        survivors.push(candidate);
      }
    }
    // Every outcome owes its trace: without the reason codes the binding
    // configured, a candidate that was excluded or ranked behind is invisible
    // both to the human answering an ambiguity and to any explanation surface,
    // and "no candidate survived" cannot be explained at all.
    const trace = (alternatives: readonly Alternative[]): PublishedFactRecord =>
      alternatives.length === 0
        ? {}
        : {
            [keyOf("alternatives")]: alternatives.map((alternative) => ({
              ref: { ...alternative.ref },
              rejectedBecause: alternative.rejectedBecause,
            })),
          };
    const ambiguous = (candidates: readonly Candidate[]): PublishedFactRecord => ({
      ...trace(rejected),
      [keyOf("openQuestion")]: {
        candidateRefs: candidates.map((candidate) => ({ ...candidate.ref })),
        humanQuestionCode: input.parameters.ambiguityQuestionCode,
      },
      [keyOf("outcome")]: "ambiguous",
    });
    const selected = (
      winner: Candidate,
      alternatives: readonly Alternative[],
    ): PublishedFactRecord => ({
      ...trace(alternatives),
      [keyOf("outcome")]: "selected",
      [keyOf("selectedRef")]: { ...winner.ref },
    });
    const empty: PublishedFactRecord = {
      ...trace(rejected),
      [keyOf("outcome")]: "empty",
    };

    if (input.context.strategy === "preference-order") {
      if (survivors.length === 0) return empty;
      const [winner, ...behind] = rankSurvivors(survivors, input.evidence.preferenceRanking);
      const winnerRank = winner!.rank;
      return selected(winner!.candidate, [
        ...behind.map((entry) => ({
          ref: entry.candidate.ref,
          rejectedBecause:
            entry.rank > winnerRank ? RANKED_BEHIND_REASON : CANONICAL_TIEBREAK_REASON,
        })),
        ...rejected,
      ]);
    }
    // single-eligible demands uniqueness AFTER exclusions; exactly-one demands
    // the raw set be singular (its exclusions are refused at parse).
    if (survivors.length === 0) return empty;
    if (survivors.length > 1) return ambiguous(survivors);
    return selected(survivors[0]!, rejected);
  },
};
