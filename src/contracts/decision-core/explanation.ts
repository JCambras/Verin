import { z } from "zod";
import {
  EvidenceSnapshotIdRefSchema,
  HouseholdInstructionRefSchema,
  HouseholdInstructionVersionRefSchema,
  PolicyRefSchema,
  PolicyVersionRefSchema,
  ReasonCodeSchema,
  RegulatorySourceRefSchema,
  RegulatoryVersionRefSchema,
  compareVersionedScopedReferences,
  hasUniqueByComparator,
  hasUniqueScopedReferences,
  normalizeScopedReferences,
  normalizeVersionedScopedReferences,
} from "./ids";

export const VersionedSourceRefSchema = z
  .discriminatedUnion("sourceType", [
    z.strictObject({
      sourceType: z.literal("firm_policy"),
      sourceRef: PolicyRefSchema,
      versionRef: PolicyVersionRefSchema,
    }),
    z.strictObject({
      sourceType: z.literal("household_instruction"),
      sourceRef: HouseholdInstructionRefSchema,
      versionRef: HouseholdInstructionVersionRefSchema,
    }),
    z.strictObject({
      sourceType: z.literal("regulatory"),
      sourceRef: RegulatorySourceRefSchema,
      versionRef: RegulatoryVersionRefSchema,
    }),
  ])
  .refine((source) => source.sourceRef.firmId === source.versionRef.firmId, {
    message: "sourceRef.firmId and versionRef.firmId must match",
    path: ["sourceRef", "firmId"],
  })
  .readonly();
export type VersionedSourceRef = z.infer<typeof VersionedSourceRefSchema>;

export const PrecedenceStepSchema = z.strictObject({
  left: VersionedSourceRefSchema,
  right: VersionedSourceRefSchema,
  resolution: z.enum([
    "left_wins",
    "right_wins",
    "narrowed",
    "exception_required",
    "blocked",
  ]),
  reasonCode: ReasonCodeSchema,
}).readonly();
export type PrecedenceStep = z.infer<typeof PrecedenceStepSchema>;

const explanationNodeFields = {
  code: z.string().min(1),
  messageTemplate: z.string().min(1),
  evidenceSnapshotRefs: z
    .array(EvidenceSnapshotIdRefSchema)
    .refine(
      hasUniqueScopedReferences,
      "duplicate explanation evidence snapshot reference",
    )
    .overwrite(normalizeScopedReferences)
    .readonly(),
  sourceRefs: z
    .array(VersionedSourceRefSchema)
    .refine(
      (refs) =>
        hasUniqueByComparator(refs, compareVersionedScopedReferences),
      "duplicate explanation source reference",
    )
    .overwrite(normalizeVersionedScopedReferences)
    .readonly(),
};

const requireExplanationNodeTenant = (
  node: {
    evidenceSnapshotRefs: readonly { firmId: string }[];
    sourceRefs: readonly VersionedSourceRef[];
  },
  ctx: z.RefinementCtx,
): void => {
  const firmIds = [
    ...node.evidenceSnapshotRefs.map((ref) => ref.firmId),
    ...node.sourceRefs.flatMap((source) => [
      source.sourceRef.firmId,
      source.versionRef.firmId,
    ]),
  ];
  if (firmIds.some((firmId) => firmId !== firmIds[0])) {
    ctx.addIssue({
      code: "custom",
      message: "explanation references must belong to one tenant",
      path: ["evidenceSnapshotRefs"],
    });
  }
};

const ShallowExplanationNodeSchema = z
  .strictObject({
    ...explanationNodeFields,
    childNodes: z.array(z.unknown()),
  })
  .superRefine(requireExplanationNodeTenant);

export type ExplanationNode = Readonly<{
  code: string;
  messageTemplate: string;
  evidenceSnapshotRefs: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
  sourceRefs: readonly VersionedSourceRef[];
  childNodes: readonly ExplanationNode[];
}>;

export const ExplanationNodeSchema: z.ZodType<ExplanationNode> = z
  .strictObject({
    ...explanationNodeFields,
    get childNodes(): z.ZodReadonly<
      z.ZodArray<z.ZodType<ExplanationNode>>
    > {
      return z.array(ExplanationNodeSchema).readonly();
    },
  })
  .superRefine(requireExplanationNodeTenant)
  .readonly();

type ExplanationPath = {
  readonly parent?: ExplanationPath;
  readonly segment: string | number;
};

const materializePath = (
  path: ExplanationPath | undefined,
): (string | number)[] => {
  const segments: (string | number)[] = [];
  for (let cursor = path; cursor !== undefined; cursor = cursor.parent) {
    segments.push(cursor.segment);
  }
  return segments.reverse();
};

const recursiveExplanationRun =
  ExplanationNodeSchema._zod.run.bind(ExplanationNodeSchema._zod);

ExplanationNodeSchema._zod.run = ((payload, ctx) => {
  if (ctx.direction === "backward") {
    return recursiveExplanationRun(payload, ctx);
  }
  type Output = z.infer<typeof ShallowExplanationNodeSchema>;
  type Task =
    | {
        readonly kind: "visit";
        readonly input: unknown;
        readonly path?: ExplanationPath;
        readonly assign: (value: unknown) => void;
      }
    | {
        readonly kind: "leave";
        readonly input: object;
        readonly output: Output;
      };
  const ancestors = new Set<object>();
  let output: unknown = payload.value;
  const tasks: Task[] = [{
    kind: "visit",
    input: payload.value,
    assign: (value) => {
      output = value;
    },
  }];
  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "leave") {
      ancestors.delete(task.input);
      Object.freeze(task.output.childNodes);
      Object.freeze(task.output);
      continue;
    }
    if (
      task.input !== null &&
      typeof task.input === "object" &&
      ancestors.has(task.input)
    ) {
      payload.issues.push({
        code: "custom",
        message: "circular explanation reference",
        input: task.input,
        inst: ExplanationNodeSchema,
        path: materializePath(task.path),
      });
      continue;
    }
    const parsed = ShallowExplanationNodeSchema._zod.run(
      { value: task.input, issues: [] },
      ctx,
    );
    if (parsed instanceof Promise) {
      throw new Error("explanation validation must remain synchronous");
    }
    if (parsed.issues.length > 0) {
      const prefix = materializePath(task.path);
      payload.issues.push(
        ...parsed.issues.map((issue) => ({
          ...issue,
          path: [...prefix, ...(issue.path ?? [])],
        })),
      );
      continue;
    }
    const input = task.input as object;
    const parsedNode = parsed.value as Output;
    const rawChildren = parsedNode.childNodes;
    parsedNode.childNodes = new Array(rawChildren.length);
    task.assign(parsedNode);
    ancestors.add(input);
    tasks.push({ kind: "leave", input, output: parsedNode });
    for (let index = rawChildren.length - 1; index >= 0; index -= 1) {
      tasks.push({
        kind: "visit",
        input: rawChildren[index],
        path: {
          parent: {
            parent: task.path,
            segment: "childNodes",
          },
          segment: index,
        },
        assign: (child) => {
          parsedNode.childNodes[index] = child;
        },
      });
    }
  }
  payload.value = output;
  return payload;
}) as typeof ExplanationNodeSchema._zod.run;
